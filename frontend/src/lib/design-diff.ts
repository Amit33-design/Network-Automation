// ── Design diff / change review (group W) ─────────────────────────────────────
//
// Compares two serialized designs (DesignExport, from lib/design-export.ts) so
// an operator can review exactly what a redeploy will change: which intent /
// requirement fields changed, which devices were added/removed/re-sized (with
// the capex delta), and a per-device unified config diff. Pure + deterministic.

import type { DesignExport } from '@/lib/design-export'
import type { BOMDevice, CableLink } from '@/types'

export interface FieldChange {
  field: string
  before: string
  after: string
}

export interface DeviceChange {
  id: string
  hostname: string
  status: 'added' | 'removed' | 'changed'
  /** Field-level changes for a 'changed' device (model/vendor/count/price/…). */
  changes: FieldChange[]
  priceBefore: number
  priceAfter: number
}

export interface ConfigHunk {
  /** '+' added line, '-' removed line, ' ' context. */
  sign: '+' | '-' | ' '
  text: string
}

export interface ConfigDiff {
  id: string
  status: 'added' | 'removed' | 'modified'
  addedLines: number
  removedLines: number
  hunks: ConfigHunk[]
}

/** A change to the cable plant — the most physically disruptive kind. */
export interface CableChange {
  key: string
  status: 'added' | 'removed' | 'changed'
  before?: { quantity: number; cableType: string; medium?: string; lengthM: number; totalPrice: number }
  after?: { quantity: number; cableType: string; medium?: string; lengthM: number; totalPrice: number }
}

export interface DesignDiff {
  intentChanges: FieldChange[]
  requirementChanges: FieldChange[]
  /** Design inputs outside intent/requirements — run lengths, deploy policy,
   *  ZTP settings (AG3). Omitting these reported "nothing changed" while the
   *  whole cable plant had been re-specified (AG4). */
  inputChanges: FieldChange[]
  bomDelta: DeviceChange[]
  cableDelta: CableChange[]
  configDelta: ConfigDiff[]
  summary: {
    intentChanged: number
    requirementsChanged: number
    inputsChanged: number
    devicesAdded: number
    devicesRemoved: number
    devicesChanged: number
    cablesChanged: number
    capexBefore: number
    capexAfter: number
    capexDelta: number
    /** Cabling + optics, which `capex` (device price) does not include. */
    plantBefore: number
    plantAfter: number
    plantDelta: number
    configsAdded: number
    configsRemoved: number
    configsModified: number
    hasChanges: boolean
  }
}

const fmt = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Field-level diff of two flat records. Keys present in either side are compared. */
function diffRecord(a: Record<string, unknown>, b: Record<string, unknown>): FieldChange[] {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort()
  const out: FieldChange[] = []
  for (const k of keys) {
    const before = fmt(a?.[k])
    const after = fmt(b?.[k])
    if (before !== after) out.push({ field: k, before, after })
  }
  return out
}

function indexDevices(devs: BOMDevice[]): Map<string, BOMDevice> {
  const m = new Map<string, BOMDevice>()
  for (const d of devs) m.set(d.id || d.hostname, d)
  return m
}

const DEVICE_FIELDS: (keyof BOMDevice)[] = ['hostname', 'vendor', 'model', 'role', 'subLayer', 'count', 'speed', 'ports', 'uplinks', 'unitPrice']

function diffDevices(a: BOMDevice[], b: BOMDevice[]): DeviceChange[] {
  const ai = indexDevices(a)
  const bi = indexDevices(b)
  const ids = [...new Set([...ai.keys(), ...bi.keys()])].sort()
  const out: DeviceChange[] = []

  for (const id of ids) {
    const da = ai.get(id)
    const db = bi.get(id)
    if (da && !db) {
      out.push({ id, hostname: da.hostname, status: 'removed', changes: [], priceBefore: da.totalPrice ?? 0, priceAfter: 0 })
    } else if (!da && db) {
      out.push({ id, hostname: db.hostname, status: 'added', changes: [], priceBefore: 0, priceAfter: db.totalPrice ?? 0 })
    } else if (da && db) {
      const changes: FieldChange[] = []
      for (const f of DEVICE_FIELDS) {
        const before = fmt(da[f]); const after = fmt(db[f])
        if (before !== after) changes.push({ field: String(f), before, after })
      }
      if (changes.length) {
        out.push({ id, hostname: db.hostname, status: 'changed', changes, priceBefore: da.totalPrice ?? 0, priceAfter: db.totalPrice ?? 0 })
      }
    }
  }
  return out
}

/**
 * Minimal line-level diff (LCS) between two config texts → unified hunks with
 * a few lines of surrounding context. Deterministic; no external deps.
 */
function diffConfigText(before: string, after: string, context = 2): { hunks: ConfigHunk[]; added: number; removed: number } {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length, m = b.length

  // LCS length table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  // Backtrack into a raw op list
  const raw: ConfigHunk[] = []
  let i = 0, j = 0
  let added = 0, removed = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { raw.push({ sign: ' ', text: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { raw.push({ sign: '-', text: a[i] }); removed++; i++ }
    else { raw.push({ sign: '+', text: b[j] }); added++; j++ }
  }
  while (i < n) { raw.push({ sign: '-', text: a[i] }); removed++; i++ }
  while (j < m) { raw.push({ sign: '+', text: b[j] }); added++; j++ }

  // Collapse long runs of unchanged context into elisions.
  const hunks: ConfigHunk[] = []
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].sign !== ' ') { hunks.push(raw[k]); continue }
    // count the context run
    let end = k
    while (end < raw.length && raw[end].sign === ' ') end++
    const runLen = end - k
    const nearStart = hunks.some(h => h.sign !== ' ')  // keep trailing context only after a change
    if (runLen <= context * 2) {
      for (let x = k; x < end; x++) hunks.push(raw[x])
    } else {
      // keep `context` after the previous change, elide, keep `context` before the next
      if (nearStart) for (let x = k; x < k + context; x++) hunks.push(raw[x])
      if (end < raw.length) {
        hunks.push({ sign: ' ', text: `… ${runLen - (nearStart ? context : 0) - context} unchanged lines …` })
        for (let x = end - context; x < end; x++) hunks.push(raw[x])
      }
    }
    k = end - 1
  }
  return { hunks, added, removed }
}

function diffConfigs(a: Record<string, string>, b: Record<string, string>): ConfigDiff[] {
  const ids = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort()
  const out: ConfigDiff[] = []
  for (const id of ids) {
    const ca = a?.[id]; const cb = b?.[id]
    if (ca !== undefined && cb === undefined) {
      out.push({ id, status: 'removed', addedLines: 0, removedLines: ca.split('\n').length, hunks: [] })
    } else if (ca === undefined && cb !== undefined) {
      out.push({ id, status: 'added', addedLines: cb.split('\n').length, removedLines: 0, hunks: [] })
    } else if (ca !== undefined && cb !== undefined && ca !== cb) {
      const { hunks, added, removed } = diffConfigText(ca, cb)
      out.push({ id, status: 'modified', addedLines: added, removedLines: removed, hunks })
    }
  }
  return out
}

/**
 * Cable-plant delta, keyed by tier pair.
 *
 * The diff covered devices and configs but not the CABLING, and the run
 * lengths that drive it were not even serialized. Comparing a 3 m baseline
 * against a 400 m candidate — $4,690 of cable against $71,622 — reported
 * `hasChanges: false`. Re-cabling a site is the most disruptive change a
 * redeploy can make, and the change review said nothing (AG4).
 */
function diffCabling(a: CableLink[], b: CableLink[]): CableChange[] {
  const key = (c: CableLink) => `${c.fromLayer} → ${c.toLayer}`
  const snap = (c: CableLink) => ({
    quantity: c.quantity, cableType: c.cableType, medium: c.medium,
    lengthM: c.lengthM, totalPrice: c.totalPrice,
  })
  const byKeyA = new Map(a.map(c => [key(c), c]))
  const byKeyB = new Map(b.map(c => [key(c), c]))
  const out: CableChange[] = []

  for (const [k, ca] of byKeyA) {
    const cb = byKeyB.get(k)
    if (!cb) { out.push({ key: k, status: 'removed', before: snap(ca) }); continue }
    if (JSON.stringify(snap(ca)) !== JSON.stringify(snap(cb))) {
      out.push({ key: k, status: 'changed', before: snap(ca), after: snap(cb) })
    }
  }
  for (const [k, cb] of byKeyB) {
    if (!byKeyA.has(k)) out.push({ key: k, status: 'added', after: snap(cb) })
  }
  return out
}

const plantCost = (d: DesignExport): number =>
  (d.bom?.cabling ?? []).reduce((s, c) => s + (c.totalPrice ?? 0), 0)
  + (d.bom?.optics ?? []).reduce((s, o) => s + (o.totalPrice ?? 0), 0)

/** Compare a baseline design (a) against a candidate design (b). */
export function diffDesigns(a: DesignExport, b: DesignExport): DesignDiff {
  const intentChanges = diffRecord(a.intent as Record<string, unknown>, b.intent as Record<string, unknown>)
  const requirementChanges = diffRecord(a.requirements as Record<string, unknown>, b.requirements as Record<string, unknown>)
  const inputChanges = diffRecord(
    (a.inputs ?? {}) as Record<string, unknown>,
    (b.inputs ?? {}) as Record<string, unknown>,
  )
  const bomDelta = diffDevices(a.bom?.devices ?? [], b.bom?.devices ?? [])
  const cableDelta = diffCabling(a.bom?.cabling ?? [], b.bom?.cabling ?? [])
  const configDelta = diffConfigs(a.configs ?? {}, b.configs ?? {})

  const capexBefore = (a.bom?.devices ?? []).reduce((s, d) => s + (d.totalPrice ?? 0), 0)
  const capexAfter = (b.bom?.devices ?? []).reduce((s, d) => s + (d.totalPrice ?? 0), 0)

  const plantBefore = plantCost(a)
  const plantAfter = plantCost(b)

  const summary = {
    intentChanged: intentChanges.length,
    requirementsChanged: requirementChanges.length,
    inputsChanged: inputChanges.length,
    devicesAdded: bomDelta.filter(d => d.status === 'added').length,
    devicesRemoved: bomDelta.filter(d => d.status === 'removed').length,
    devicesChanged: bomDelta.filter(d => d.status === 'changed').length,
    cablesChanged: cableDelta.length,
    capexBefore,
    capexAfter,
    capexDelta: capexAfter - capexBefore,
    plantBefore,
    plantAfter,
    plantDelta: plantAfter - plantBefore,
    configsAdded: configDelta.filter(c => c.status === 'added').length,
    configsRemoved: configDelta.filter(c => c.status === 'removed').length,
    configsModified: configDelta.filter(c => c.status === 'modified').length,
    hasChanges: false,
  }
  summary.hasChanges =
    intentChanges.length + requirementChanges.length + inputChanges.length
    + bomDelta.length + cableDelta.length + configDelta.length > 0

  return { intentChanges, requirementChanges, inputChanges, bomDelta, cableDelta, configDelta, summary }
}

/** Render a diff as a Markdown change-review report. */
export function diffToMarkdown(diff: DesignDiff): string {
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`
  const L: string[] = ['# Design Change Review', '']

  if (!diff.summary.hasChanges) {
    L.push('_No changes — the two designs are identical._', '')
    return L.join('\n')
  }

  const s = diff.summary
  L.push('## Summary', '')
  L.push(`- Intent fields changed: **${s.intentChanged}**`)
  L.push(`- Requirement fields changed: **${s.requirementsChanged}**`)
  L.push(`- Devices: **+${s.devicesAdded} / -${s.devicesRemoved} / ~${s.devicesChanged}**`)
  L.push(`- Configs: **+${s.configsAdded} / -${s.configsRemoved} / ~${s.configsModified}**`)
  L.push(`- Design inputs changed: **${s.inputsChanged}** (run lengths, deploy policy, ZTP settings)`)
  L.push(`- Cable runs changed: **${s.cablesChanged}**`)
  L.push(`- CapEx (devices): ${usd(s.capexBefore)} → ${usd(s.capexAfter)} (**${s.capexDelta >= 0 ? '+' : ''}${usd(s.capexDelta)}**)`)
  L.push(`- Cable plant (cabling + optics): ${usd(s.plantBefore)} → ${usd(s.plantAfter)} (**${s.plantDelta >= 0 ? '+' : ''}${usd(s.plantDelta)}**)`)
  L.push('')

  const fieldTable = (title: string, rows: FieldChange[]) => {
    if (!rows.length) return
    L.push(`## ${title}`, '', '| Field | Before | After |', '|---|---|---|')
    for (const c of rows) L.push(`| ${c.field} | ${c.before || '—'} | ${c.after || '—'} |`)
    L.push('')
  }
  fieldTable('Intent changes', diff.intentChanges)
  fieldTable('Requirement changes', diff.requirementChanges)
  fieldTable('Design input changes', diff.inputChanges)

  if (diff.cableDelta.length) {
    L.push('## Cable plant delta', '')
    L.push('Re-cabling is the most physically disruptive change a redeploy can make.', '')
    L.push('| Run | Change | Qty | Type | Medium | Length | Cost |', '|---|---|---|---|---|---|---|')
    for (const c of diff.cableDelta) {
      const fmt = (x?: { quantity: number; cableType: string; medium?: string; lengthM: number; totalPrice: number }) =>
        x ? [String(x.quantity), x.cableType, x.medium ?? '—', `${x.lengthM} m`, usd(x.totalPrice)] : ['—', '—', '—', '—', '—']
      const bf = fmt(c.before), af = fmt(c.after)
      const cell = (i: number) => (c.status === 'changed' && bf[i] !== af[i]) ? `${bf[i]} → ${af[i]}` : (af[i] === '—' ? bf[i] : af[i])
      L.push(`| ${c.key} | ${c.status} | ${cell(0)} | ${cell(1)} | ${cell(2)} | ${cell(3)} | ${cell(4)} |`)
    }
    L.push('')
  }

  if (diff.bomDelta.length) {
    L.push('## BOM delta', '')
    for (const d of diff.bomDelta) {
      const tag = d.status === 'added' ? '➕' : d.status === 'removed' ? '➖' : '✏️'
      L.push(`### ${tag} ${d.hostname} (${d.status})`)
      for (const c of d.changes) L.push(`- ${c.field}: ${c.before} → ${c.after}`)
      if (d.status !== 'changed') L.push(`- price: ${usd(d.priceBefore)} → ${usd(d.priceAfter)}`)
      L.push('')
    }
  }

  if (diff.configDelta.length) {
    L.push('## Config delta', '')
    for (const c of diff.configDelta) {
      L.push(`### ${c.id} (${c.status}, +${c.addedLines}/-${c.removedLines})`)
      if (c.hunks.length) {
        L.push('```diff')
        for (const h of c.hunks) L.push(`${h.sign}${h.text}`)
        L.push('```')
      }
      L.push('')
    }
  }

  return L.join('\n')
}
