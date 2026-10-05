// AQ6 — lossless RoCEv2 QoS follows the inputs, never the vendor. A GPU design
// is always lossless; any other design only when HPC / AI is selected. Before
// this, every Dell EMC and NVIDIA DC fabric got PFC no-drop that nothing asked
// for, while the same design on Cisco/Arista/Juniper got none.
import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, needsLosslessFabric } from '@/lib/configgen'
import { extractFacts, factPlatform } from '@/lib/config-facts'
import { validateConfigs } from '@/lib/config-validator'
import type { AppType, UseCase } from '@/types'

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'NVIDIA', 'Dell EMC'] as const

function fabricPfc(vendor: string, useCase: UseCase, appTypes: AppType[]) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ6', vendorPrefs: [vendor], totalEndpoints: 256 })
  const configs = generateAllConfigs(devices, useCase, [], appTypes)
  const fabric = devices.filter(d => d.subLayer === 'spine' || d.subLayer === 'leaf')
  expect(fabric.length, `${vendor} ${useCase} has a fabric`).toBeGreaterThan(0)
  const withPfc = fabric.filter(d => extractFacts(configs[d.id] ?? '', factPlatform(d)).pfc.state === 'present')
  return { fabric, withPfc, devices, configs }
}

describe('lossless QoS follows the inputs, not the vendor (AQ6)', () => {
  it('the rule: GPU always, HPC / AI on any other design, nothing else', () => {
    expect(needsLosslessFabric('gpu')).toBe(true)
    expect(needsLosslessFabric('dc')).toBe(false)
    expect(needsLosslessFabric('dc', ['hpc'])).toBe(true)
    expect(needsLosslessFabric('multisite', ['hpc'])).toBe(true)
    expect(needsLosslessFabric('dc', ['storage', 'voice', 'video', 'internet'])).toBe(false)
  })

  for (const vendor of VENDORS) {
    it(`${vendor}: a general-purpose DC fabric carries no PFC`, () => {
      const { withPfc } = fabricPfc(vendor, 'dc', [])
      expect(withPfc.map(d => d.hostname)).toEqual([])
    })

    it(`${vendor}: selecting HPC / AI makes every DC fabric device lossless`, () => {
      const { fabric, withPfc, devices, configs } = fabricPfc(vendor, 'dc', ['hpc'])
      expect(withPfc.length).toBe(fabric.length)
      // and the validator holds it to the same standard as a GPU fabric
      const v09 = validateConfigs({ configs, devices, useCase: 'dc', appTypes: ['hpc'] }).checks.find(c => c.id === 'V-09')!
      expect(v09.severity).not.toBe('fail')
      expect(v09.severity).not.toBe('info')
    })

    it(`${vendor}: a GPU fabric is lossless without any app type`, () => {
      const { fabric, withPfc } = fabricPfc(vendor, 'gpu', [])
      expect(withPfc.length).toBe(fabric.length)
    })
  }

  it('the validator skips V-09 on a general-purpose DC', () => {
    const { devices, configs } = fabricPfc('Cisco', 'dc', [])
    const v09 = validateConfigs({ configs, devices, useCase: 'dc' }).checks.find(c => c.id === 'V-09')!
    expect(v09.severity).toBe('info')
  })
})
