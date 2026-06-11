import { describe, it, expect } from 'vitest'
import { genComputedTopology } from '@/pages/Step4NetworkDesign'
import { haPairInfo, DCI_RT_ASN } from '@/lib/configgen'
import type { BOMDevice } from '@/types'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'd1', hostname: 'IAD-LEAF-A01', role: 'leaf', subLayer: 'leaf',
    model: 'N9K-C93180YC-FX3', vendor: 'Cisco', count: 1,
    unitPrice: 0, totalPrice: 0, speed: '25G', ports: 48, uplinks: 6, features: [],
    ...overrides,
  }
}

function leafPair(idx: number): [BOMDevice, BOMDevice] {
  const rack = String.fromCharCode(65 + idx)
  return [
    makeDevice({ id: `lf${idx * 2 + 1}`, hostname: `IAD-LEAF-${rack}01`, subLayer: 'leaf' }),
    makeDevice({ id: `lf${idx * 2 + 2}`, hostname: `IAD-LEAF-${rack}02`, subLayer: 'leaf' }),
  ]
}

function distPair(idx: number): [BOMDevice, BOMDevice] {
  const rack = String.fromCharCode(65 + idx)
  return [
    makeDevice({ id: `dist${idx * 2 + 1}`, hostname: `IAD-DIST-${rack}01`, subLayer: 'distribution', role: 'distribution' }),
    makeDevice({ id: `dist${idx * 2 + 2}`, hostname: `IAD-DIST-${rack}02`, subLayer: 'distribution', role: 'distribution' }),
  ]
}

describe('genComputedTopology — DC/GPU/multisite/multicloud/aviatrix fabric (D1)', () => {
  it('pairs leaves into vPC/MLAG pairs using haPairInfo', () => {
    const devices = [...leafPair(0), ...leafPair(1)]
    const topo = genComputedTopology('dc', devices, [])
    expect(topo.mlagPairs).toEqual([
      { pairId: 1, primary: 'IAD-LEAF-A01', secondary: 'IAD-LEAF-A02', domainId: 'IAD-LEAF-A' },
      { pairId: 2, primary: 'IAD-LEAF-B01', secondary: 'IAD-LEAF-B02', domainId: 'IAD-LEAF-B' },
    ])
  })

  it('matches haPairInfo output directly for the first leaf pair', () => {
    const devices = leafPair(0)
    const expected = haPairInfo(devices[0], 0)
    const topo = genComputedTopology('dc', devices, [])
    expect(topo.mlagPairs[0]).toEqual({
      pairId: expected.pairId,
      primary: devices[0].hostname,
      secondary: devices[1].hostname,
      domainId: expected.domainId,
    })
  })

  it('ignores an unpaired trailing leaf', () => {
    const devices = [...leafPair(0), makeDevice({ id: 'lf3', hostname: 'IAD-LEAF-B01', subLayer: 'leaf' })]
    const topo = genComputedTopology('dc', devices, [])
    expect(topo.mlagPairs).toHaveLength(1)
  })

  it('does not produce DCI info for non-multisite use cases', () => {
    const devices = [...leafPair(0)]
    const topo = genComputedTopology('dc', devices, [])
    expect(topo.dci).toBeNull()
  })

  it('produces stretched DCI route-targets for multisite leaves', () => {
    const devices = [...leafPair(0), ...leafPair(1)]
    const topo = genComputedTopology('multisite', devices, [])
    expect(topo.dci).toEqual({
      rtAsn: DCI_RT_ASN,
      l2Rt: `${DCI_RT_ASN}:10010`,
      l3Rt: `${DCI_RT_ASN}:50000`,
      leaves: devices.map(d => d.hostname),
    })
  })

  it('pairs GPU ToR leaves the same way as DC leaves', () => {
    const devices = [...leafPair(0)]
    const topo = genComputedTopology('gpu', devices, [])
    expect(topo.mlagPairs).toEqual([
      { pairId: 1, primary: 'IAD-LEAF-A01', secondary: 'IAD-LEAF-A02', domainId: 'IAD-LEAF-A' },
    ])
  })

  it('returns no pairs/FHRP/DCI when there are no leaves', () => {
    const topo = genComputedTopology('dc', [], [])
    expect(topo).toEqual({ mlagPairs: [], fhrpVips: [], dci: null })
  })
})

describe('genComputedTopology — campus distribution (D1)', () => {
  it('pairs distribution switches and adds an HSRP DATA VIP per pair', () => {
    const devices = [...distPair(0), ...distPair(1)]
    const topo = genComputedTopology('campus', devices, [])
    expect(topo.mlagPairs).toEqual([
      { pairId: 1, primary: 'IAD-DIST-A01', secondary: 'IAD-DIST-A02', domainId: 'IAD-DIST-A' },
      { pairId: 2, primary: 'IAD-DIST-B01', secondary: 'IAD-DIST-B02', domainId: 'IAD-DIST-B' },
    ])
    expect(topo.fhrpVips).toEqual([
      { pairId: 1, vlan: '10', name: 'DATA', vip: '10.10.0.1', primary: 'IAD-DIST-A01', secondary: 'IAD-DIST-A02' },
      { pairId: 2, vlan: '10', name: 'DATA', vip: '10.10.1.1', primary: 'IAD-DIST-B01', secondary: 'IAD-DIST-B02' },
    ])
  })

  it('adds a VOICE VIP per pair when the design includes voice', () => {
    const devices = [...distPair(0)]
    const topo = genComputedTopology('campus', devices, ['voice'])
    expect(topo.fhrpVips).toEqual([
      { pairId: 1, vlan: '10', name: 'DATA', vip: '10.10.0.1', primary: 'IAD-DIST-A01', secondary: 'IAD-DIST-A02' },
      { pairId: 1, vlan: '20', name: 'VOICE', vip: '10.20.0.1', primary: 'IAD-DIST-A01', secondary: 'IAD-DIST-A02' },
    ])
  })

  it('does not pair non-distribution devices', () => {
    const devices = [...leafPair(0), ...distPair(0)]
    const topo = genComputedTopology('campus', devices, [])
    expect(topo.mlagPairs).toHaveLength(1)
    expect(topo.mlagPairs[0].primary).toBe('IAD-DIST-A01')
  })
})
