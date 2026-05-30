import { describe, it, expect } from 'vitest'
import {
  parseRules,
  evalWhen,
  evaluateCustomPolicy,
  type EvalContext,
} from '@/lib/customPolicy'

const ctx: EvalContext = {
  intent: {
    useCase: 'dc',
    scale: 'medium',
    protoFeatures: ['ECMP', 'PFC'],          // note: no BFD
    overlayProtocols: ['VXLAN'],             // note: no EVPN
    oversubscription: 6,
    compliance: ['PCI'],
  },
  configBlob: 'router bgp 65000\n feature bfd\n',
}

describe('parseRules', () => {
  it('parses a well-formed ruleset', () => {
    const y = `rules:
  - id: "R1"
    severity: "error"
    message: "m1"
    when: "protoFeatures not_contains BFD"
  - id: "R2"
    severity: "warning"
    message: "m2"
    when: "overlayProtocols contains EVPN"`
    const r = parseRules(y)
    expect(r.ok).toBe(true)
    expect(r.rules).toHaveLength(2)
    expect(r.rules[0].severity).toBe('FAIL')
    expect(r.rules[1].severity).toBe('WARN')
  })

  it('rejects missing rules: key', () => {
    expect(parseRules('foo: bar').ok).toBe(false)
  })

  it('flags an unknown op', () => {
    const r = parseRules(`rules:
  - id: "R1"
    severity: "info"
    when: "useCase frobnicate dc"`)
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/unknown op/)
  })

  it('maps severity synonyms', () => {
    const r = parseRules(`rules:
  - id: "R1"
    severity: "block"
    when: "useCase eq dc"`)
    expect(r.rules[0].severity).toBe('BLOCK')
  })
})

describe('evalWhen operators', () => {
  it('contains / not_contains on arrays', () => {
    expect(evalWhen('protoFeatures contains PFC', ctx)).toBe(true)
    expect(evalWhen('protoFeatures not_contains BFD', ctx)).toBe(true)
    expect(evalWhen('protoFeatures contains BFD', ctx)).toBe(false)
  })

  it('eq / neq on scalars', () => {
    expect(evalWhen('useCase eq dc', ctx)).toBe(true)
    expect(evalWhen('useCase neq campus', ctx)).toBe(true)
    expect(evalWhen('useCase eq campus', ctx)).toBe(false)
  })

  it('numeric comparisons', () => {
    expect(evalWhen('oversubscription gt 4', ctx)).toBe(true)
    expect(evalWhen('oversubscription lte 6', ctx)).toBe(true)
    expect(evalWhen('oversubscription lt 3', ctx)).toBe(false)
  })

  it('is_empty / is_not_empty', () => {
    expect(evalWhen('protoFeatures is_not_empty', ctx)).toBe(true)
    expect(evalWhen('compliance is_empty', ctx)).toBe(false)
  })

  it('config_contains scans the config blob', () => {
    expect(evalWhen('x config_contains feature bfd', ctx)).toBe(true)
    expect(evalWhen('x config_not_contains feature isis', ctx)).toBe(true)
  })
})

describe('evaluateCustomPolicy', () => {
  it('fires violations and sets gate status', () => {
    const y = `rules:
  - id: "BFD-REQ"
    severity: "error"
    message: "BFD required"
    when: "protoFeatures not_contains BFD"
  - id: "EVPN-REC"
    severity: "warning"
    message: "EVPN recommended"
    when: "overlayProtocols not_contains EVPN"
  - id: "OK-RULE"
    severity: "error"
    message: "should not fire"
    when: "useCase eq campus"`
    const res = evaluateCustomPolicy(y, ctx)
    expect(res.ruleCount).toBe(3)
    expect(res.firedCount).toBe(2)
    expect(res.violations.map(v => v.id)).toContain('BFD-REQ')
    expect(res.warnings.map(w => w.id)).toContain('EVPN-REC')
    expect(res.gateStatus).toBe('FAIL')
  })

  it('BLOCK severity drives gate to BLOCK', () => {
    const y = `rules:
  - id: "HARD"
    severity: "block"
    message: "blocked"
    when: "oversubscription gt 4"`
    expect(evaluateCustomPolicy(y, ctx).gateStatus).toBe('BLOCK')
  })

  it('a clean design yields PASS with no fired rules', () => {
    const y = `rules:
  - id: "R1"
    severity: "error"
    message: "x"
    when: "protoFeatures contains BFD"`
    const res = evaluateCustomPolicy(y, ctx)
    expect(res.firedCount).toBe(0)
    expect(res.gateStatus).toBe('PASS')
  })

  it('documentation-only rules (no when) never fire', () => {
    const y = `rules:
  - id: "DOC"
    severity: "info"
    message: "just docs"`
    const res = evaluateCustomPolicy(y, ctx)
    expect(res.firedCount).toBe(0)
  })
})
