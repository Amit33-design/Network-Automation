import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import {
  troubleshootCoverage,
  toTroubleshootPlatform,
  TROUBLESHOOT_PLATFORMS,
  UNCOVERED_PLATFORM_LABEL,
} from '@/lib/troubleshoot-coverage'
import { ztpPlatform } from '@/lib/ztp'
import type { BOMDevice } from '@/types'

function dev(partial: Partial<BOMDevice>): BOMDevice {
  return {
    id: 'd1', hostname: 'TEST-01', role: 'leaf', subLayer: 'leaf',
    model: 'm', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
    speed: '', ports: 0, features: [], ...partial,
  }
}

describe('troubleshootCoverage (AG10)', () => {
  it('reports full coverage on an all-Cisco design', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const cov = troubleshootCoverage(devices)
    expect(cov.uncovered).toEqual([])
    expect(cov.uncoveredCount).toBe(0)
    expect(cov.coveredCount).toBeGreaterThan(0)
    expect(TROUBLESHOOT_PLATFORMS).toContain(cov.suggested)
  })

  it('names the NOSes the playbooks cannot serve, and how many devices that is', () => {
    const devices = [
      dev({ id: 'a', hostname: 'LEAF-01', vendor: 'Cisco', model: 'Nexus 9336C', count: 2 }),
      dev({ id: 'b', hostname: 'SRL-01', vendor: 'Nokia', count: 4 }),
      dev({ id: 'c', hostname: 'EXOS-01', vendor: 'Extreme Networks', count: 1 }),
    ]
    const cov = troubleshootCoverage(devices)
    expect(cov.covered).toEqual(['nxos'])
    expect(cov.uncovered).toEqual(['exos', 'srl'])
    expect(cov.uncoveredLabels).toEqual(['Extreme EXOS', 'Nokia SR Linux'])
    // Counts are by DEVICE, not by BOM row — the operator cares how much of
    // the fleet is dark, and a 4x row is four boxes.
    expect(cov.coveredCount).toBe(2)
    expect(cov.uncoveredCount).toBe(5)
    expect(cov.uncoveredDevices).toEqual(['SRL-01', 'EXOS-01'])
  })

  it('suggests a platform the fleet actually runs, not a hardcoded default', () => {
    const juniper = troubleshootCoverage([dev({ vendor: 'Juniper' })])
    expect(juniper.suggested).toBe('junos')
    const arista = troubleshootCoverage([dev({ vendor: 'Arista' })])
    expect(arista.suggested).toBe('eos')
  })

  it('falls back to nxos only when nothing in the fleet is covered', () => {
    const cov = troubleshootCoverage([dev({ vendor: 'Nokia' }), dev({ vendor: 'NVIDIA' })])
    expect(cov.covered).toEqual([])
    expect(cov.suggested).toBe('nxos')
    // and the banner has something to say
    expect(cov.uncoveredCount).toBe(2)
  })

  it('never silently maps an uncovered NOS onto a covered one', () => {
    for (const nos of Object.keys(UNCOVERED_PLATFORM_LABEL)) {
      expect(toTroubleshootPlatform(nos as never)).toBeNull()
    }
  })

  it('every NOS ztpPlatform can produce is either covered or explicitly labelled', () => {
    // Guards the gap this module exists to close: a NOS that is neither
    // covered nor named would show up in the banner as a raw id like "srl".
    const vendors = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC',
      'Fortinet', 'HPE Aruba', 'Extreme Networks', 'Palo Alto']
    for (const vendor of vendors) {
      const nos = ztpPlatform(dev({ vendor: vendor as never }))
      const tp = toTroubleshootPlatform(nos)
      if (!tp) expect(UNCOVERED_PLATFORM_LABEL[nos], `${vendor} -> ${nos}`).toBeTruthy()
    }
  })

  it('measures the real gap on a Nokia DC design', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Nokia'] })
    const cov = troubleshootCoverage(devices)
    // The reason AG10 exists: a Nokia fabric gets Cisco commands, and until
    // now nothing said so.
    expect(cov.uncoveredCount).toBeGreaterThan(0)
    expect(cov.uncoveredLabels).toContain('Nokia SR Linux')
  })
})
