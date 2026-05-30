/**
 * NetDesign AI — Client-side Customer Policy Engine
 * ==================================================
 * Demo-mode counterpart to backend/policies/user_rule_engine.py.
 *
 * Lets users author governance rules that are actually EVALUATED against the
 * current design intent + generated configs (previously the editor only did a
 * regex "looks-like-YAML" check and never ran anything).
 *
 * Rule format (constrained, robustly parseable without a YAML dependency):
 *
 *   rules:
 *     - id: "CUSTOM-01"
 *       severity: "error"          # info | warning | error | block
 *       message: "BFD required with aggressive BGP timers"
 *       fix: "Add BFD to Protocol Features"
 *       when: "protoFeatures not_contains BFD"
 *
 * A rule FIRES (becomes a finding) when its `when` expression evaluates true —
 * matching the backend semantics where condition-met ⇒ record emitted.
 * `when` is a single "<field> <op> <value>" expression. Supported ops mirror the
 * backend DSL subset: eq, neq, contains, not_contains, in, not_in, gt, lt, gte,
 * lte, is_empty, is_not_empty, config_contains, config_not_contains.
 */

export type RuleSeverity = 'INFO' | 'WARN' | 'FAIL' | 'BLOCK'

export interface ParsedRule {
  id: string
  severity: RuleSeverity
  message: string
  fix: string
  when: string | null
  lineNo: number
}

export interface RuleFinding {
  id: string
  severity: RuleSeverity
  message: string
  fix: string
}

export interface EvalResult {
  ruleCount: number
  firedCount: number
  violations: RuleFinding[]   // FAIL + BLOCK
  warnings: RuleFinding[]     // WARN
  infos: RuleFinding[]        // INFO
  gateStatus: 'PASS' | 'WARN' | 'FAIL' | 'BLOCK'
  evaluatedRules: { id: string; fired: boolean; severity: RuleSeverity }[]
}

export interface ParseOutcome {
  ok: boolean
  rules: ParsedRule[]
  errors: string[]
}

const SEVERITY_MAP: Record<string, RuleSeverity> = {
  info: 'INFO',
  warn: 'WARN',
  warning: 'WARN',
  error: 'FAIL',
  fail: 'FAIL',
  block: 'BLOCK',
}

const VALID_OPS = new Set([
  'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in',
  'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty',
  'config_contains', 'config_not_contains',
])

function stripQuotes(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/** Parse the constrained rule YAML. Robust to comments/blank lines. */
export function parseRules(yamlText: string): ParseOutcome {
  const errors: string[] = []
  const lines = yamlText.split('\n')

  if (!/^\s*rules\s*:/m.test(yamlText)) {
    return { ok: false, rules: [], errors: ['Missing top-level "rules:" key'] }
  }

  const rules: ParsedRule[] = []
  let current: Partial<ParsedRule> & { lineNo?: number } | null = null

  const flush = () => {
    if (!current) return
    const id = current.id ?? `rule-${rules.length + 1}`
    if (!current.id) errors.push(`Rule near line ${current.lineNo}: missing "id"`)
    if (!current.severity) errors.push(`Rule "${id}": missing or invalid "severity"`)
    rules.push({
      id,
      severity: (current.severity as RuleSeverity) ?? 'INFO',
      message: current.message ?? '',
      fix: current.fix ?? '',
      when: current.when ?? null,
      lineNo: current.lineNo ?? 0,
    })
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\s+#.*$/, '') // strip trailing comments
    if (!line.trim() || line.trim().startsWith('#')) continue

    // New rule starts with "- id:" or "-" then key on same/next lines
    const dashKey = line.match(/^\s*-\s*([a-zA-Z_]+)\s*:\s*(.*)$/)
    if (dashKey) {
      flush()
      current = { lineNo: i + 1 }
      assignField(current, dashKey[1], dashKey[2], errors, i + 1)
      continue
    }

    const kv = line.match(/^\s+([a-zA-Z_]+)\s*:\s*(.*)$/)
    if (kv && current) {
      assignField(current, kv[1], kv[2], errors, i + 1)
    }
  }
  flush()

  if (rules.length === 0) {
    errors.push('No rules found — add at least one "- id:" entry')
  }
  return { ok: errors.length === 0, rules, errors }
}

function assignField(
  rule: Partial<ParsedRule> & { lineNo?: number },
  key: string,
  value: string,
  errors: string[],
  lineNo: number,
): void {
  const v = stripQuotes(value)
  switch (key) {
    case 'id': rule.id = v; break
    case 'severity': {
      const mapped = SEVERITY_MAP[v.toLowerCase()]
      if (!mapped) errors.push(`Rule "${rule.id ?? '?'}" line ${lineNo}: unknown severity "${v}" (use info|warning|error|block)`)
      else rule.severity = mapped
      break
    }
    case 'message': rule.message = v; break
    case 'description': if (!rule.message) rule.message = v; break
    case 'fix': rule.fix = v; break
    case 'when': {
      rule.when = v
      const parts = v.split(/\s+/)
      const op = parts[1]
      // is_empty / is_not_empty take no value; others need one
      if (op && !VALID_OPS.has(op)) {
        errors.push(`Rule "${rule.id ?? '?'}" line ${lineNo}: unknown op "${op}" in when-expression`)
      }
      break
    }
    default: /* ignore unknown keys (forward-compat) */ break
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export interface EvalContext {
  /** Flat intent fields, e.g. { useCase, scale, protoFeatures: [...], ... } */
  intent: Record<string, unknown>
  /** Concatenated generated configs for config_contains checks. */
  configBlob: string
}

function getField(ctx: EvalContext, field: string): unknown {
  // dotted path traversal over the intent object
  const parts = field.split('.')
  let obj: unknown = ctx.intent
  for (const p of parts) {
    if (obj && typeof obj === 'object' && p in (obj as Record<string, unknown>)) {
      obj = (obj as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return obj
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** Evaluate a single "<field> <op> <value>" expression. */
export function evalWhen(expr: string, ctx: EvalContext): boolean {
  const tokens = expr.trim().split(/\s+/)
  if (tokens.length < 2) return false
  const field = tokens[0]
  const op = tokens[1]
  const value = tokens.slice(2).join(' ')

  if (op === 'config_contains') return ctx.configBlob.includes(value)
  if (op === 'config_not_contains') return !ctx.configBlob.includes(value)

  const actual = getField(ctx, field)
  const arr = Array.isArray(actual) ? actual.map(x => String(x)) : null
  const str = actual == null ? '' : String(actual)

  switch (op) {
    case 'eq':  return str === value
    case 'neq': return str !== value
    case 'contains':     return arr ? arr.includes(value) : str.includes(value)
    case 'not_contains': return arr ? !arr.includes(value) : !str.includes(value)
    case 'in':     return value.split(',').map(s => s.trim()).includes(str)
    case 'not_in': return !value.split(',').map(s => s.trim()).includes(str)
    case 'gt':  { const a = asNumber(actual), b = asNumber(value); return a != null && b != null && a > b }
    case 'lt':  { const a = asNumber(actual), b = asNumber(value); return a != null && b != null && a < b }
    case 'gte': { const a = asNumber(actual), b = asNumber(value); return a != null && b != null && a >= b }
    case 'lte': { const a = asNumber(actual), b = asNumber(value); return a != null && b != null && a <= b }
    case 'is_empty':     return arr ? arr.length === 0 : !str
    case 'is_not_empty': return arr ? arr.length > 0 : !!str
    default: return false
  }
}

/** Parse + evaluate a ruleset against the design context. */
export function evaluateCustomPolicy(yamlText: string, ctx: EvalContext): EvalResult & { parseErrors: string[] } {
  const parsed = parseRules(yamlText)
  const result: EvalResult & { parseErrors: string[] } = {
    ruleCount: parsed.rules.length,
    firedCount: 0,
    violations: [],
    warnings: [],
    infos: [],
    gateStatus: 'PASS',
    evaluatedRules: [],
    parseErrors: parsed.errors,
  }

  for (const rule of parsed.rules) {
    // A rule with no `when` is documentation-only — never fires.
    const fired = rule.when ? safeEval(rule.when, ctx) : false
    result.evaluatedRules.push({ id: rule.id, fired, severity: rule.severity })
    if (!fired) continue

    result.firedCount++
    const finding: RuleFinding = {
      id: rule.id, severity: rule.severity, message: rule.message, fix: rule.fix,
    }
    if (rule.severity === 'FAIL' || rule.severity === 'BLOCK') result.violations.push(finding)
    else if (rule.severity === 'WARN') result.warnings.push(finding)
    else result.infos.push(finding)
  }

  if (result.violations.some(v => v.severity === 'BLOCK')) result.gateStatus = 'BLOCK'
  else if (result.violations.length) result.gateStatus = 'FAIL'
  else if (result.warnings.length) result.gateStatus = 'WARN'
  else result.gateStatus = 'PASS'

  return result
}

function safeEval(expr: string, ctx: EvalContext): boolean {
  try {
    return evalWhen(expr, ctx)
  } catch {
    return false
  }
}
