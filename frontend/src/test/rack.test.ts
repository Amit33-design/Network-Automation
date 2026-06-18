import { describe, it, expect } from 'vitest'
import { computeRackLayout, buildCableSchedule } from '@/components/RackElevation'
import type { BOMDevice, CableLink } from '@/types'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'test-1',
    hostname: 'IAD-SPINE-A01',
    role: 'spine',
    subLayer: 'spine',
    model: 'Nexus 9336C-FX2',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 28000,
    totalPrice: 28000,
    speed: '100G',
    ports: 36,
    features: ['BGP', 'VXLAN'],
    ...overrides,
  }
}

describe('computeRackLayout (G-A14)', () => {
  it('assigns devices to rack slots in role order', () => {
    const devices = [
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 'f1', hostname: 'FW-A01', subLayer: 'firewall' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks).toHaveLength(1)
    expect(racks[0].slots[0].device.subLayer).toBe('firewall')
    expect(racks[0].slots[1].device.subLayer).toBe('spine')
    expect(racks[0].slots[2].device.subLayer).toBe('leaf')
  })

  it('assigns correct RU heights per role', () => {
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
      makeDevice({ id: 'f1', subLayer: 'firewall' }),
    ]
    const racks = computeRackLayout(devices)
    const spine = racks[0].slots.find(s => s.device.subLayer === 'spine')
    const leaf = racks[0].slots.find(s => s.device.subLayer === 'leaf')
    const fw = racks[0].slots.find(s => s.device.subLayer === 'firewall')
    expect(spine?.heightU).toBe(2)
    expect(leaf?.heightU).toBe(1)
    expect(fw?.heightU).toBe(1)
  })

  it('calculates total power consumption', () => {
    const devices = [
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 's2', subLayer: 'spine' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].totalPowerW).toBe(1600)
  })

  it('splits into multiple racks when exceeding 42U', () => {
    const devices = Array.from({ length: 44 }, (_, i) =>
      makeDevice({ id: `l${i}`, hostname: `LEAF-${i}`, subLayer: 'leaf' })
    )
    const racks = computeRackLayout(devices)
    expect(racks.length).toBeGreaterThan(1)
    expect(racks[0].usedU).toBeLessThanOrEqual(42)
  })

  it('excludes cloud devices (0 RU) from rack layout', () => {
    const devices = [
      makeDevice({ id: 'cg1', subLayer: 'cloud-gw' }),
      makeDevice({ id: 's1', subLayer: 'spine' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots).toHaveLength(1)
    expect(racks[0].slots[0].device.subLayer).toBe('spine')
  })

  it('assigns sequential U positions', () => {
    const devices = [
      makeDevice({ id: 'f1', subLayer: 'firewall' }),
      makeDevice({ id: 's1', subLayer: 'spine' }),
      makeDevice({ id: 'l1', subLayer: 'leaf' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots[0].startU).toBe(1)
    expect(racks[0].slots[1].startU).toBe(2)
    expect(racks[0].slots[2].startU).toBe(4)
  })

  it('returns at least one rack even with no devices', () => {
    const racks = computeRackLayout([])
    expect(racks).toHaveLength(1)
    expect(racks[0].usedU).toBe(0)
  })

  it('places SD-WAN controllers before WAN edges', () => {
    const devices = [
      makeDevice({ id: 'w1', subLayer: 'wan-edge', hostname: 'WAN-A01' }),
      makeDevice({ id: 'c1', subLayer: 'sdwan-controller', hostname: 'SDCTL-A01' }),
    ]
    const racks = computeRackLayout(devices)
    expect(racks[0].slots[0].device.subLayer).toBe('sdwan-controller')
    expect(racks[0].slots[1].device.subLayer).toBe('wan-edge')
  })
})

describe('buildCableSchedule (G-A14)', () => {
  it('generates cable runs from cabling data', () => {
    const devices = [
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
    ]
    const cabling: CableLink[] = [{
      id: 'c1', fromLayer: 'spine', toLayer: 'leaf',
      fromDevice: '1x spine', toDevice: '1x leaf',
      cableType: 'DAC', speed: '100G', lengthM: 3,
      quantity: 1, pricePerUnit: 80, totalPrice: 80,
    }]
    const runs = buildCableSchedule(devices, cabling)
    expect(runs).toHaveLength(1)
    expect(runs[0].from).toBe('SPINE-A01')
    expect(runs[0].to).toBe('LEAF-A01')
    expect(runs[0].cableType).toBe('DAC')
  })

  it('generates cross-product cable runs for multi-device layers', () => {
    const devices = [
      makeDevice({ id: 's1', hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ id: 's2', hostname: 'SPINE-B01', subLayer: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'LEAF-A01', subLayer: 'leaf' }),
      makeDevice({ id: 'l2', hostname: 'LEAF-B01', subLayer: 'leaf' }),
    ]
    const cabling: CableLink[] = [{
      id: 'c1', fromLayer: 'spine', toLayer: 'leaf',
      fromDevice: '2x spine', toDevice: '2x leaf',
      cableType: 'DAC', speed: '100G', lengthM: 3,
      quantity: 4, pricePerUnit: 80, totalPrice: 320,
    }]
    const runs = buildCableSchedule(devices, cabling)
    expect(runs).toHaveLength(4)
  })

  it('returns empty array when no cabling data', () => {
    const runs = buildCableSchedule([], [])
    expect(runs).toHaveLength(0)
  })
})
