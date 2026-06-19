import type { BOMDevice } from '@/types'

export interface GrowthProjection {
  year: number
  endpoints: number
  leafUtilization: number
  spineUtilization: number
  portCapacity: number
  portsUsed: number
  status: 'ok' | 'warn' | 'critical' | 'exceeded'
}

export interface CapacityPlan {
  currentEndpoints: number
  growthRate: number
  projections: GrowthProjection[]
  maxCapacityYear: number | null
  warnYear: number | null
  recommendations: string[]
}

export function computeCapacityPlan(
  devices: BOMDevice[],
  currentEndpoints: number,
  growthRate: number = 0.20,
  years: number = 5,
): CapacityPlan {
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const spines = devices.filter(d => d.subLayer === 'spine')

  const totalLeafDownlinks = leaves.reduce((s, d) => s + d.ports * d.count, 0)
  const totalLeafUplinks = leaves.reduce((s, d) => s + (d.uplinks ?? 0) * d.count, 0)
  const totalSpinePorts = spines.reduce((s, d) => s + d.ports * d.count, 0)

  const projections: GrowthProjection[] = []
  let maxCapacityYear: number | null = null
  let warnYear: number | null = null

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

    projections.push({
      year: y,
      endpoints,
      leafUtilization: Math.min(leafUtil, 1.5),
      spineUtilization: spineUtil,
      portCapacity,
      portsUsed,
      status,
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
  }
}
