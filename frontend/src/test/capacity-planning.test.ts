import { describe, it, expect } from 'vitest'
import { computeCapacityPlan } from '../lib/capacity-planning'
import type { BOMDevice } from '../types'

function makeDevices(leafCount: number, leafPorts: number, spineCount: number, spinePorts: number, leafUplinks: number = 6): BOMDevice[] {
  return [
    { id: 'leaf', hostname: 'LF', role: 'leaf', subLayer: 'leaf', model: 'Test Leaf', vendor: 'Test', count: leafCount, unitPrice: 10000, totalPrice: leafCount * 10000, speed: '25G', ports: leafPorts, uplinks: leafUplinks, features: [] },
    { id: 'spine', hostname: 'SP', role: 'spine', subLayer: 'spine', model: 'Test Spine', vendor: 'Test', count: spineCount, unitPrice: 30000, totalPrice: spineCount * 30000, speed: '100G', ports: spinePorts, uplinks: 0, features: [] },
  ]
}

describe('computeCapacityPlan', () => {
  it('projects growth over 5 years', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 100, 0.20, 5)
    expect(plan.projections).toHaveLength(6)
    expect(plan.projections[0].year).toBe(0)
    expect(plan.projections[5].year).toBe(5)
  })

  it('year 0 matches current endpoints', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 100, 0.20, 5)
    expect(plan.projections[0].endpoints).toBe(100)
  })

  it('endpoints grow by the specified rate', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 100, 0.50, 3)
    expect(plan.projections[1].endpoints).toBe(150)
    expect(plan.projections[2].endpoints).toBe(225)
  })

  it('port capacity equals total leaf downlinks', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 100, 0.20, 5)
    expect(plan.projections[0].portCapacity).toBe(4 * 48)
  })

  it('detects ok status when utilization low', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 50, 0.10, 3)
    expect(plan.projections[0].status).toBe('ok')
  })

  it('detects warn when utilization exceeds 70%', () => {
    const devices = makeDevices(2, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 70, 0.05, 5)
    const warnProj = plan.projections.find(p => p.status === 'warn')
    expect(warnProj).toBeTruthy()
  })

  it('detects exceeded when over capacity', () => {
    const devices = makeDevices(2, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 80, 0.30, 5)
    const exceeded = plan.projections.find(p => p.status === 'exceeded')
    expect(exceeded).toBeTruthy()
  })

  it('sets maxCapacityYear when exceeded', () => {
    const devices = makeDevices(2, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 80, 0.30, 5)
    expect(plan.maxCapacityYear).not.toBeNull()
  })

  it('no maxCapacityYear when plenty of headroom', () => {
    const devices = makeDevices(10, 48, 4, 64)
    const plan = computeCapacityPlan(devices, 50, 0.10, 5)
    expect(plan.maxCapacityYear).toBeNull()
  })

  it('recommends over-provisioning note for low utilization', () => {
    const devices = makeDevices(10, 48, 4, 64)
    const plan = computeCapacityPlan(devices, 20, 0.05, 3)
    expect(plan.recommendations.some(r => r.includes('over-provisioned'))).toBe(true)
  })

  it('recommends expansion for near-capacity', () => {
    const devices = makeDevices(2, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 80, 0.30, 5)
    expect(plan.recommendations.some(r => r.includes('exceeded') || r.includes('expansion') || r.includes('adding'))).toBe(true)
  })

  it('handles empty device list', () => {
    const plan = computeCapacityPlan([], 100, 0.20, 3)
    expect(plan.projections).toHaveLength(4)
    expect(plan.recommendations.some(r => r.includes('No leaf'))).toBe(true)
  })

  it('handles zero endpoints', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 0, 0.20, 3)
    expect(plan.projections[0].endpoints).toBe(0)
    expect(plan.projections[0].leafUtilization).toBe(0)
  })

  it('spine utilization reflects uplink ratio', () => {
    const devices = makeDevices(4, 48, 2, 64, 8)
    const plan = computeCapacityPlan(devices, 100, 0.10, 1)
    const spineUtil = plan.projections[0].spineUtilization
    expect(spineUtil).toBe((4 * 8) / (2 * 64))
  })

  it('growth rate 0 produces flat line', () => {
    const devices = makeDevices(4, 48, 2, 64)
    const plan = computeCapacityPlan(devices, 100, 0, 3)
    expect(plan.projections.every(p => p.endpoints === 100)).toBe(true)
  })
})

// ── H6: bandwidth / oversubscription model ─────────────────────────────────────

import { parseSpeedGbps } from '../lib/capacity-planning'

describe('parseSpeedGbps', () => {
  it('parses common speed strings', () => {
    expect(parseSpeedGbps('400G')).toBe(400)
    expect(parseSpeedGbps('25G')).toBe(25)
    expect(parseSpeedGbps('1T')).toBe(1000)
    expect(parseSpeedGbps('100M')).toBe(0.1)
    expect(parseSpeedGbps(25)).toBe(25)
  })
  it('returns 0 on garbage / missing', () => {
    expect(parseSpeedGbps('')).toBe(0)
    expect(parseSpeedGbps(undefined)).toBe(0)
    expect(parseSpeedGbps('fast')).toBe(0)
  })
})

describe('computeCapacityPlan — oversubscription model (H6)', () => {
  // 4 leaves × 8 uplinks × 100G spine speed = 3200G uplink capacity.
  const devices = makeDevices(4, 48, 2, 64, 8)

  it('is inactive without bandwidthPerServer (backward compatible)', () => {
    const plan = computeCapacityPlan(devices, 100, 0.20, 3)
    expect(plan.hasBandwidthModel).toBe(false)
    expect(plan.oversubExceededYear).toBeNull()
    expect(plan.projections[0].offeredGbps).toBeNull()
    expect(plan.projections[0].effectiveOversub).toBeNull()
    expect(plan.projections[0].oversubStatus).toBeNull()
  })

  it('computes offered load and effective oversubscription per year', () => {
    // 100 endpoints × 25G = 2500G offered; 2500/3200 = 0.78:1 → ok vs 3:1.
    const plan = computeCapacityPlan(devices, 100, 0, 2, { bandwidthPerServer: '25G', oversubTarget: 3 })
    expect(plan.hasBandwidthModel).toBe(true)
    expect(plan.uplinkCapacityGbps).toBe(3200)
    expect(plan.projections[0].offeredGbps).toBe(2500)
    expect(plan.projections[0].effectiveOversub).toBeCloseTo(2500 / 3200)
    expect(plan.projections[0].oversubStatus).toBe('ok')
    expect(plan.oversubExceededYear).toBeNull()
  })

  it('flags the year the ratio drifts past the design target', () => {
    // 400 endpoints × 25G = 10000G → 3.125:1 (>3, warn) already at year 0.
    const plan = computeCapacityPlan(devices, 400, 0.20, 3, { bandwidthPerServer: '25G', oversubTarget: 3 })
    expect(plan.projections[0].oversubStatus).toBe('warn')
    expect(plan.oversubExceededYear).toBe(0)
    expect(plan.recommendations.some(r => r.includes('oversubscription') && r.includes('3:1'))).toBe(true)
  })

  it('escalates to critical past 1.5× the target', () => {
    // 600 endpoints × 25G = 15000G → 4.7:1 vs 3:1 (>4.5 = 1.5×3) → critical.
    const plan = computeCapacityPlan(devices, 600, 0, 1, { bandwidthPerServer: '25G', oversubTarget: 3 })
    expect(plan.projections[0].oversubStatus).toBe('critical')
  })

  it('detects future oversubscription drift while ports remain free', () => {
    // 150 eps × 25G = 3750G → 1.17:1 ok at year 0; at 30% growth year 4 has
    // ceil(150·1.3⁴)=429 eps → 10725G → 3.35:1 → first breach in year 4.
    const plan = computeCapacityPlan(devices, 150, 0.30, 4, { bandwidthPerServer: '25G', oversubTarget: 3 })
    expect(plan.projections[0].oversubStatus).toBe('ok')
    expect(plan.oversubExceededYear).toBe(4)
  })

  it('inactive when the BOM has no leaf uplinks', () => {
    const noUplinks = makeDevices(4, 48, 2, 64, 0)
    const plan = computeCapacityPlan(noUplinks, 100, 0.20, 3, { bandwidthPerServer: '25G' })
    expect(plan.hasBandwidthModel).toBe(false)
  })

  it('defaults oversubTarget to 3 when not given', () => {
    const plan = computeCapacityPlan(devices, 100, 0.20, 3, { bandwidthPerServer: '25G' })
    expect(plan.oversubTarget).toBe(3)
  })
})
