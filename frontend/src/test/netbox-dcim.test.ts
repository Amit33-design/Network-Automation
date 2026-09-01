import { describe, it, expect } from 'vitest'
import {
  expandCablePlan,
  toNetBoxDeviceCsv,
  toNetBoxInterfaceCsv,
  toNetBoxCableCsv,
  buildNetBoxDcimExport,
  netboxInterfaceType,
  netboxCableType,
} from '@/lib/netbox-dcim'
import { buildDeviceList, buildCabling } from '@/lib/bom'
import type { BOMDevice, CableLink } from '@/types'

function dev(p: Partial<BOMDevice>): BOMDevice {
  return {
    id: p.hostname || 'x', hostname: '', role: 'leaf', subLayer: 'leaf',
    model: 'N9K-C93180YC', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
    speed: '100G', ports: 48, features: [], ...p,
  }
}

const devices: BOMDevice[] = [
  dev({ hostname: 'IAD-SPINE-01', role: 'spine', subLayer: 'spine', speed: '400G' }),
  dev({ hostname: 'IAD-SPINE-02', role: 'spine', subLayer: 'spine', speed: '400G' }),
  dev({ hostname: 'IAD-LEAF-01', role: 'leaf', subLayer: 'leaf', speed: '100G' }),
  dev({ hostname: 'IAD-LEAF-02', role: 'leaf', subLayer: 'leaf', speed: '100G' }),
]

const cabling: CableLink[] = [{
  id: 'c1', fromLayer: 'leaf', toLayer: 'spine',
  fromDevice: 'leaf', toDevice: 'spine',
  cableType: 'DAC', speed: '100G', lengthM: 3, quantity: 4,
  pricePerUnit: 50, totalPrice: 200,
}]

describe('expandCablePlan', () => {
  it('expands the aggregate link into leaf×spine concrete runs with unique per-device interfaces', () => {
    const cables = expandCablePlan(devices, cabling)
    expect(cables.length).toBe(4) // 2 leaves × 2 spines

    // Every interface on a given device is unique.
    const seen = new Set<string>()
    for (const c of cables) {
      for (const ep of [c.a, c.b]) {
        const key = `${ep.device} ${ep.iface}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
        expect(ep.iface).toMatch(/^Ethernet1\/\d+$/)
      }
    }
    // Each leaf has 2 uplinks (to the 2 spines); each spine has 2 downlinks.
    expect(cables.filter(c => c.a.device === 'IAD-LEAF-01').length).toBe(2)
    expect(cables.filter(c => c.b.device === 'IAD-SPINE-01').length).toBe(2)
  })

  it('falls back to aggregate labels when a layer is absent from the BOM', () => {
    // Still `quantity` runs, not one: expanding a plan that says four cables
    // into a single row is the same under-count the main path used to
    // over-count (AG2). Only the endpoint NAMES fall back here.
    const orphan: CableLink[] = [{ ...cabling[0], fromLayer: 'core', toLayer: 'nowhere', fromDevice: 'CORE-01', toDevice: 'EDGE-01' }]
    const cables = expandCablePlan(devices, orphan)
    expect(cables.length).toBe(orphan[0].quantity)
    expect(cables[0].a.device).toBe('CORE-01')
    expect(cables[0].b.device).toBe('EDGE-01')
  })
})

describe('CSV emitters', () => {
  it('device CSV has the NetBox header and one active row per device', () => {
    const csv = toNetBoxDeviceCsv(devices, 'Ashburn')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,device_role,manufacturer,device_type,site,status')
    expect(lines.length).toBe(1 + 4)
    expect(lines[1]).toContain('IAD-SPINE-01,spine,Cisco,N9K-C93180YC,Ashburn,active')
  })

  it('interface CSV de-dups by (device, name) and maps speed to a NetBox type', () => {
    const cables = expandCablePlan(devices, cabling)
    const csv = toNetBoxInterfaceCsv(cables)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('device,name,type,enabled')
    // 4 cables × 2 endpoints = 8 unique interfaces (2 per leaf, 2 per spine).
    expect(lines.length).toBe(1 + 8)
    // Leaf interfaces are 100G; spine endpoints inherit the run speed (100G).
    expect(csv).toContain('IAD-LEAF-01,Ethernet1/1,100gbase-x-qsfp28,true')
  })

  it('cable CSV uses side_a/side_b interface endpoints + mapped cable type + length', () => {
    const cables = expandCablePlan(devices, cabling)
    const csv = toNetBoxCableCsv(cables)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,length,length_unit')
    expect(lines[1]).toContain('dcim.interface')
    expect(lines[1]).toContain('dac-passive')
    expect(lines[1]).toMatch(/,3,m$/)
  })
})

describe('enum mappings', () => {
  it('netboxInterfaceType', () => {
    expect(netboxInterfaceType('400G')).toBe('400gbase-x-qsfpdd')
    expect(netboxInterfaceType('100G')).toBe('100gbase-x-qsfp28')
    expect(netboxInterfaceType('25G')).toBe('25gbase-x-sfp28')
    expect(netboxInterfaceType('1G')).toBe('1000base-t')
    expect(netboxInterfaceType('weird')).toBe('other')
  })
  it('netboxCableType', () => {
    expect(netboxCableType('DAC')).toBe('dac-passive')
    expect(netboxCableType('AOC')).toBe('aoc')
    expect(netboxCableType('SMF fiber')).toBe('smf')
    expect(netboxCableType('Cat6')).toBe('cat6')
  })
})

describe('buildNetBoxDcimExport', () => {
  it('bundles all three CSVs + cable count', () => {
    const out = buildNetBoxDcimExport(devices, cabling)
    expect(out.cableCount).toBe(4)
    expect(out.devicesCsv).toContain('name,device_role')
    expect(out.interfacesCsv).toContain('device,name,type,enabled')
    expect(out.cablesCsv).toContain('side_a_device')
  })

  it('handles an empty design without throwing', () => {
    const out = buildNetBoxDcimExport([], [])
    expect(out.cableCount).toBe(0)
    expect(out.devicesCsv.trim()).toBe('name,device_role,manufacturer,device_type,site,status')
  })
})

// ── F3: rack + device-position export ──────────────────────────────────────────

import { toNetBoxRackCsv, netboxRackPosition, type RackExport } from '@/lib/netbox-dcim'

const racks: RackExport[] = [{
  label: 'Rack A', totalU: 42,
  slots: [
    { startU: 1, heightU: 1, device: { hostname: 'IAD-SPINE-01', model: 'X' } },
    { startU: 2, heightU: 2, device: { hostname: 'IAD-LEAF-01', model: 'Y' } },
  ],
}, {
  label: 'Rack B', totalU: 42,
  slots: [{ startU: 1, heightU: 1, device: { hostname: 'IAD-LEAF-02', model: 'Y' } }],
}]

describe('rack export (F3)', () => {
  it('netboxRackPosition converts top-counted startU to bottom-counted NetBox position', () => {
    // Top slot (startU 1, 1U) in a 42U rack occupies U42 from the bottom.
    expect(netboxRackPosition(racks[0].slots[0], 42)).toBe(42)
    // 2U device at top-U2..U3 occupies bottom U40-41 → lowest = 40.
    expect(netboxRackPosition(racks[0].slots[1], 42)).toBe(40)
  })

  it('toNetBoxRackCsv emits one dcim.rack row per rack', () => {
    const csv = toNetBoxRackCsv(racks, 'Ashburn')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,site,status,u_height')
    expect(lines.length).toBe(3)
    expect(lines[1]).toBe('Rack A,Ashburn,active,42')
  })

  it('device CSV gains rack/position/face columns when racks are provided', () => {
    const csv = toNetBoxDeviceCsv(devices, 'Ashburn', racks)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,device_role,manufacturer,device_type,site,status,rack,position,face')
    expect(lines.find(l => l.startsWith('IAD-SPINE-01'))).toContain('Rack A,42,front')
    expect(lines.find(l => l.startsWith('IAD-LEAF-02'))).toContain('Rack B,42,front')
    // Device not placed in any rack → empty placement cells.
    expect(lines.find(l => l.startsWith('IAD-SPINE-02'))).toMatch(/active,,,$/)
  })

  it('device CSV keeps the original header without racks (backward compatible)', () => {
    const csv = toNetBoxDeviceCsv(devices, 'Ashburn')
    expect(csv.trim().split('\n')[0]).toBe('name,device_role,manufacturer,device_type,site,status')
  })

  it('buildNetBoxDcimExport bundles racksCsv + rackCount when racks given', () => {
    const out = buildNetBoxDcimExport(devices, cabling, 'Ashburn', racks)
    expect(out.rackCount).toBe(2)
    expect(out.racksCsv).toContain('Rack A')
    // and omits them when not
    const bare = buildNetBoxDcimExport(devices, cabling, 'Ashburn')
    expect(bare.racksCsv).toBeUndefined()
  })
})

// ── AF1 ──────────────────────────────────────────────────────────────────────
describe('cable medium in the DCIM export (AF1)', () => {
  it('records an OM4 trunk as mmf, not the smf default', () => {
    // "MPO" is a CONNECTOR, not a glass, so type-sniffing matched none of the
    // branches and every MPO run fell through to `return 'smf'`. A customer
    // importing this into NetBox got a fibre plant that was wrong about the
    // one property that decides which optics they can buy.
    expect(netboxCableType('MPO'), 'the old, inferred answer').toBe('smf')
    expect(netboxCableType('MPO', 'mmf')).toBe('mmf')
    expect(netboxCableType('MPO', 'smf')).toBe('smf')
  })

  it('lets the declared medium win over the type name', () => {
    expect(netboxCableType('DAC', 'copper')).toBe('dac-passive')
    expect(netboxCableType('AOC', 'aoc')).toBe('aoc')
    expect(netboxCableType('LC-LC', 'mmf')).toBe('mmf')
  })

  it('carries the medium of every real run through to the CSV', () => {
    const devices = buildDeviceList({
      useCase: 'dc', scale: 'medium', siteCode: 'AF1', totalEndpoints: 1024,
    })
    const cabling = buildCabling(devices, {
      'spine-leaf': 100, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000,
    })
    const csv = toNetBoxCableCsv(expandCablePlan(devices, cabling))
    const types = new Set(csv.trim().split('\n').slice(1)
      .map(r => r.split(',')[6]?.replace(/"/g, '')))
    // The 100 m spine-leaf trunks are OM4 and the peer-links are twinax; with
    // the old inference BOTH came back as plain smf.
    expect(types.has('mmf'), 'no multimode run reached the CSV').toBe(true)
    expect(types.has('dac-passive')).toBe(true)
  })
})
