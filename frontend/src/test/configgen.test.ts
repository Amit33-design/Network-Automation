import { describe, it, expect } from 'vitest'
import { generateConfig, generateAllConfigs } from '@/lib/configgen'
import type { BOMDevice } from '@/types'

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

describe('generateConfig', () => {
  it('cisco spine includes hostname', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-SPINE-A01')
    expect(cfg).toContain('router bgp')
  })

  it('cisco leaf includes VXLAN NVE config', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-LEAF-A01')
    expect(cfg).toContain('interface nve1')
  })

  it('arista spine uses EOS syntax', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-B01', vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-SPINE-B01')
    expect(cfg).toContain('router bgp')
  })

  it('juniper leaf uses set commands', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-B01', vendor: 'Juniper', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set system host-name TST-LEAF-B01')
  })

  it('generic config falls back for unknown vendor', () => {
    const dev = makeDevice({ hostname: 'TST-FW-A01', vendor: 'Palo Alto', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-FW-A01')
  })
})

describe('generateAllConfigs', () => {
  it('returns one config per device keyed by id', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'dev-1', hostname: 'IAD-SPINE-A01' }),
      makeDevice({ id: 'dev-2', hostname: 'IAD-LEAF-A01', subLayer: 'leaf' }),
    ]
    const configs = generateAllConfigs(devices)
    expect(Object.keys(configs)).toHaveLength(2)
    expect(configs['dev-1']).toContain('IAD-SPINE-A01')
    expect(configs['dev-2']).toContain('IAD-LEAF-A01')
  })

  it('returns empty object for empty array', () => {
    expect(generateAllConfigs([])).toEqual({})
  })
})
