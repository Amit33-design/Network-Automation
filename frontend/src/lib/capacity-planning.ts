import type { BOMDevice } from '@/types'

export interface GrowthProjection {
  year: number
  endpoints: number
  leafUtilization: number
  spineUtilization: number
  portCapacity: number
  portsUsed: number
  status: 'ok' | 'warn' | 'critical' | 'exceeded'
  /** Offered load at the leaf tier (endpoints × bandwidth/endpoint), Gbps. Null when the bandwidth model is inactive. */
  offeredGbps: number | null
  /** Effective oversubscription ratio (offered ÷ fixed uplink capacity). Null when the bandwidth model is inactive. */
  effectiveOversub: number | null
  oversubStatus: 'ok' | 'warn' | 'critical' | null
}

export interface CapacityOpts {
  /** Bandwidth per endpoint — '25G' or 25 (Gbps). Enables the oversubscription model. */
  bandwidthPerServer?: string | number
  /** Design oversubscription target (e.g. 3 for 3:1). Default 3. */
  oversubTarget?: number
}

export interface CapacityPlan {
  currentEndpoints: number
  growthRate: number
  projections: GrowthProjection[]
  maxCapacityYear: number | null
  warnYear: number | null
  recommendations: string[]
  /** True when bandwidth/oversubscription was modeled (bandwidthPerServer given + uplinks in BOM). */
  hasBandwidthModel: boolean
  oversubTarget: number
  /** First year the effective oversubscription exceeds the design target (null = never in window). */
  oversubExceededYear: number | null
  /** Total leaf uplink capacity, Gbps (fixed — uplinks don't grow with endpoints). */
  uplinkCapacityGbps: number
}

/** Parse a speed string like '400G', '25G', '10G' to Gbps. Numbers pass through. */
export function parseSpeedGbps(speed: string | number | undefined): number {
  if (typeof speed === 'number') return isFinite(speed) && speed > 0 ? speed : 0
  const m = /([\d.]+)\s*(t|g|m)?/i.exec((speed || '').trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!isFinite(n) || n <= 0) return 0
  const unit = (m[2] || 'g').toLowerCase()
  return unit === 't' ? n * 1000 : unit === 'm' ? n / 1000 : n
}

export function computeCapacityPlan(
  devices: BOMDevice[],
  currentEndpoints: number,
  growthRate: number = 0.20,
  years: number = 5,
  opts: CapacityOpts = {},
): CapacityPlan {
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const spines = devices.filter(d => d.subLayer === 'spine')

  const totalLeafDownlinks = leaves.reduce((s, d) => s + d.ports * d.count, 0)
  const totalLeafUplinks = leaves.reduce((s, d) => s + (d.uplinks ?? 0) * d.count, 0)
  const totalSpinePorts = spines.reduce((s, d) => s + d.ports * d.count, 0)

  // ── Bandwidth / oversubscription model (H6) ────────────────────────────────
  // Offered load grows with endpoints; uplink capacity is FIXED — so the
  // effective oversubscription ratio drifts past the design target long
  // before ports run out. Uplinks run at the spine's fabric speed.
  const bwPerEndpoint = parseSpeedGbps(opts.bandwidthPerServer)
  const oversubTarget = opts.oversubTarget && opts.oversubTarget > 0 ? opts.oversubTarget : 3
  const uplinkSpeedGbps = parseSpeedGbps(spines[0]?.speed) || parseSpeedGbps(leaves[0]?.speed)
  const uplinkCapacityGbps = totalLeafUplinks * uplinkSpeedGbps
  const hasBandwidthModel = bwPerEndpoint > 0 && uplinkCapacityGbps > 0

  const projections: GrowthProjection[] = []
  let maxCapacityYear: number | null = null
  let warnYear: number | null = null
  let oversubExceededYear: number | null = null

  for (let y = 0; y <= years; y++) {
    const endpoints = Math.ceil(currentEndpoints * Math.pow(1 + growthRate, y))
    const portsUsed = endpoints
    const portCapacity = totalLeafDownlinks

    const leafUtil = portCapacity > 0 ? portsUsed / portCapacity : 0
    const spineUtil = totalSpinePorts > 0 ? totalLeafUplinks / totalSpinePorts : 0

    let status: GrowthProjection['status'] = 'ok'
    if (leafUtil > 1.0) status = 'exceeded'
    else if (leafUtil > 0.85) status = 'critical'
    else if (leafUtil > 0.70) status = 'warn'

    if (status === 'warn' && warnYear === null) warnYear = y
    if (status === 'exceeded' && maxCapacityYear === null) maxCapacityYear = y

    let offeredGbps: number | null = null
    let effectiveOversub: number | null = null
    let oversubStatus: GrowthProjection['oversubStatus'] = null
    if (hasBandwidthModel) {
      offeredGbps = endpoints * bwPerEndpoint
      effectiveOversub = offeredGbps / uplinkCapacityGbps
      oversubStatus = effectiveOversub <= oversubTarget ? 'ok'
        : effectiveOversub <= oversubTarget * 1.5 ? 'warn'
        : 'critical'
      if (oversubStatus !== 'ok' && oversubExceededYear === null) oversubExceededYear = y
    }

    projections.push({
      year: y,
      endpoints,
      leafUtilization: Math.min(leafUtil, 1.5),
      spineUtilization: spineUtil,
      portCapacity,
      portsUsed,
      status,
      offeredGbps,
      effectiveOversub,
      oversubStatus,
    })
  }

  const recommendations: string[] = []

  if (maxCapacityYear !== null && maxCapacityYear <= 2) {
    recommendations.push(`Port capacity will be exceeded in Year ${maxCapacityYear}. Consider adding leaf switches or upgrading to higher-density models.`)
  } else if (maxCapacityYear !== null) {
    recommendations.push(`Port capacity will be exceeded in Year ${maxCapacityYear}. Plan a leaf-tier expansion before then.`)
  }

  if (warnYear !== null && warnYear <= 1) {
    recommendations.push(`Leaf utilization exceeds 70% in Year ${warnYear}. Consider pre-ordering expansion hardware.`)
  }

  if (oversubExceededYear !== null) {
    const os0 = projections[oversubExceededYear]?.effectiveOversub
    const ratio = os0 ? `${os0.toFixed(1)}:1` : ''
    if (oversubExceededYear === 0) {
      recommendations.push(`Effective oversubscription ${ratio} already exceeds the ${oversubTarget}:1 design target — add leaf uplinks or spine capacity now.`)
    } else {
      recommendations.push(`Effective oversubscription exceeds the ${oversubTarget}:1 design target in Year ${oversubExceededYear} (${ratio}) — plan additional uplinks/spines before then; growing endpoints without growing uplinks degrades east-west performance even while ports remain free.`)
    }
  }

  const currentUtil = totalLeafDownlinks > 0 ? currentEndpoints / totalLeafDownlinks : 0
  if (currentUtil < 0.3 && devices.length > 0) {
    recommendations.push('Current design is heavily over-provisioned. Consider a smaller scale to reduce CapEx.')
  }

  if (spines.length > 0 && totalSpinePorts > 0) {
    const spUtil = totalLeafUplinks / totalSpinePorts
    if (spUtil > 0.8) {
      recommendations.push('Spine-tier utilization is high. Adding more leaves will require additional spines.')
    }
  }

  if (leaves.length === 0) {
    recommendations.push('No leaf switches in the BOM — capacity planning requires a leaf-spine topology.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Design has adequate capacity headroom for the projected growth period.')
  }

  return {
    currentEndpoints,
    growthRate,
    projections,
    maxCapacityYear,
    warnYear,
    recommendations,
    hasBandwidthModel,
    oversubTarget,
    oversubExceededYear,
    uplinkCapacityGbps,
  }
}
