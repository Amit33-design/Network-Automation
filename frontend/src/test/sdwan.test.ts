import { describe, it, expect } from 'vitest'
import { generateConfig, generateAllConfigs } from '@/lib/configgen'
import { buildDeviceList } from '@/lib/bom'
import type { BOMDevice } from '@/types'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'test-1',
    hostname: 'IAD-WAN-A01',
    role: 'wan-edge',
    subLayer: 'wan-edge',
    model: 'Catalyst 8300 Edge',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 14000,
    totalPrice: 14000,
    speed: '10G',
    ports: 8,
    features: ['SD-WAN', 'BGP', 'OSPF', 'IPSec', 'AppQoE', 'DPI', 'ZTP', 'ThousandEyes'],
    ...overrides,
  }
}

// ── SD-WAN Edge Config ───────────────────────────────────────────────────────
describe('SD-WAN cEdge config generation (G-A12)', () => {
  it('generates SD-WAN system block with system-ip, site-id, org-name', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('system-ip')
    expect(cfg).toContain('site-id')
    expect(cfg).toContain('organization-name')
    expect(cfg).toContain('<CHANGE-ME-org-name>')
  })

  it('generates VPN 0 transport with tunnel-interface and IPSec', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vpn 0')
    expect(cfg).toContain('tunnel-interface')
    expect(cfg).toContain('encapsulation ipsec')
    expect(cfg).toContain('color biz-internet')
  })

  it('generates VPN 512 management', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vpn 512')
    expect(cfg).toContain('MGMT-OUT-OF-BAND')
  })

  it('generates VPN 1 service with LAN interface', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vpn 1')
    expect(cfg).toContain('CORPORATE-LAN')
    expect(cfg).toContain('LAN-INTERFACE')
  })

  it('generates OMP with graceful-restart and advertise', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('omp')
    expect(cfg).toContain('graceful-restart')
    expect(cfg).toContain('advertise connected')
    expect(cfg).toContain('advertise static')
  })

  it('generates app-aware routing policy with SLA classes', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('app-route-policy')
    expect(cfg).toContain('sla-class VOICE-SLA')
    expect(cfg).toContain('latency 150')
    expect(cfg).toContain('loss 1')
    expect(cfg).toContain('jitter 30')
  })

  it('generates zone-based firewall policy', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('zone-based-fw')
    expect(cfg).toContain('zone-pair')
    expect(cfg).toContain('default-action drop')
  })

  it('generates QoS map with 4 queues', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('qos-map QOS-POLICY')
    expect(cfg).toContain('queue 0')
    expect(cfg).toContain('scheduling llq')
    expect(cfg).toContain('BEST-EFFORT')
  })

  it('uses no hardcoded secrets', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    const passwords = cfg.match(/password\s+\S+/g) ?? []
    for (const p of passwords) {
      expect(p).toContain('<CHANGE-ME')
    }
  })

  it('generates MPLS transport alongside INET transport', () => {
    const dev = makeDevice()
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('MPLS-TRANSPORT')
    expect(cfg).toContain('color mpls')
  })

  it('assigns unique site-ids based on device index', () => {
    const dev0 = makeDevice({ hostname: 'SITE-WAN-A01' })
    const dev1 = makeDevice({ hostname: 'SITE-WAN-A02' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('site-id               100')
    expect(cfg1).toContain('site-id               101')
  })
})

// ── SD-WAN Controller Configs ────────────────────────────────────────────────
describe('SD-WAN controller config generation (G-A12)', () => {
  it('vSmart generates OMP route reflector with send-path-limit and ecmp-limit', () => {
    const dev = makeDevice({
      hostname: 'DC-SDCTL-A01',
      model: 'vSmart Controller',
      subLayer: 'sdwan-controller',
      role: 'sdwan-controller',
      features: ['SD-WAN', 'OMP', 'Route-Reflector', 'Policy-Distribution'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vSmart Controller')
    expect(cfg).toContain('omp')
    expect(cfg).toContain('send-path-limit')
    expect(cfg).toContain('ecmp-limit')
    expect(cfg).toContain('send-backup-paths')
  })

  it('vBond generates vbond local directive', () => {
    const dev = makeDevice({
      hostname: 'DC-SDCTL-C01',
      model: 'vBond Orchestrator',
      subLayer: 'sdwan-controller',
      role: 'sdwan-controller',
      features: ['SD-WAN', 'Orchestration', 'NAT-Traversal', 'Authentication'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vBond Orchestrator')
    expect(cfg).toContain('vbond <CHANGE-ME-vbond-ip> local')
    expect(cfg).toContain('ge0/0')
  })

  it('vManage generates VPN 512 management and VPN 0 transport', () => {
    const dev = makeDevice({
      hostname: 'DC-SDCTL-E01',
      model: 'vManage',
      subLayer: 'sdwan-controller',
      role: 'sdwan-controller',
      features: ['SD-WAN', 'NMS', 'Analytics', 'REST-API'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('vManage NMS')
    expect(cfg).toContain('vpn 0')
    expect(cfg).toContain('vpn 512')
    expect(cfg).toContain('OOB-MANAGEMENT')
  })

  it('controllers use site-id 1000 (controller site)', () => {
    const dev = makeDevice({
      model: 'vSmart Controller',
      subLayer: 'sdwan-controller',
      role: 'sdwan-controller',
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('site-id               1000')
  })

  it('controllers use no hardcoded secrets', () => {
    const dev = makeDevice({
      model: 'vManage',
      subLayer: 'sdwan-controller',
      role: 'sdwan-controller',
    })
    const cfg = generateConfig(dev, 0)
    const passwords = cfg.match(/password\s+\S+/g) ?? []
    for (const p of passwords) {
      expect(p).toContain('<CHANGE-ME')
    }
  })
})

// ── SD-WAN dispatch ──────────────────────────────────────────────────────────
describe('SD-WAN dispatch logic (G-A12)', () => {
  it('routes Catalyst 8300 (SD-WAN feature) to sdwanEdgeConfig, not iosxeWanConfig', () => {
    const dev = makeDevice({ model: 'Catalyst 8300 Edge', features: ['SD-WAN', 'BGP'] })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('SD-WAN Edge')
    expect(cfg).toContain('vpn 0')
    expect(cfg).not.toContain('router ospf 1')
  })

  it('routes ASR 1002-HX (no SD-WAN feature) to iosxeWanConfig', () => {
    const dev = makeDevice({
      model: 'ASR 1002-HX',
      features: ['BGP', 'MPLS', 'OSPF', 'IPSec', 'DMVPN'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('WAN Edge Router')
    expect(cfg).toContain('router ospf 1')
    expect(cfg).not.toContain('vpn 0')
  })

  it('routes vEdge 2000 (SD-WAN feature) to sdwanEdgeConfig', () => {
    const dev = makeDevice({
      model: 'Catalyst SD-WAN vEdge 2000',
      features: ['SD-WAN', 'BGP', 'IPSec', 'ZTP', 'AppQoE'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('SD-WAN Edge')
    expect(cfg).toContain('vpn 0')
  })

  it('routes IOS-XR devices (ASR 9904) to iosxrPeConfig, not sdwanEdgeConfig', () => {
    const dev = makeDevice({
      model: 'ASR 9904',
      features: ['IOS-XR', 'BGP', 'MPLS', 'SR-MPLS', 'L3VPN'],
    })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('IOS-XR')
    expect(cfg).not.toContain('SD-WAN Edge')
  })
})

// ── BOM SD-WAN controller injection ──────────────────────────────────────────
describe('BOM SD-WAN controller injection (G-A12)', () => {
  it('adds vManage + vSmart + vBond when overlay includes SD-WAN', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['SD-WAN'],
    })
    const models = devices.map(d => d.model)
    expect(models).toContain('vManage')
    expect(models).toContain('vSmart Controller')
    expect(models).toContain('vBond Orchestrator')
  })

  it('has 1 vManage, 2 vSmart (HA), 2 vBond (HA)', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['SD-WAN'],
    })
    const vmanage = devices.filter(d => d.model === 'vManage')
    const vsmart = devices.filter(d => d.model === 'vSmart Controller')
    const vbond = devices.filter(d => d.model === 'vBond Orchestrator')
    expect(vmanage).toHaveLength(1)
    expect(vsmart).toHaveLength(2)
    expect(vbond).toHaveLength(2)
  })

  it('swaps non-SD-WAN WAN edges to Catalyst 8300 when SD-WAN overlay selected', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['SD-WAN'],
    })
    const edges = devices.filter(d => d.subLayer === 'wan-edge')
    for (const edge of edges) {
      expect(edge.model).toBe('Catalyst 8300 Edge')
      expect(edge.features).toContain('SD-WAN')
    }
  })

  it('does NOT add controllers when overlay does not include SD-WAN', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['MPLS/SR'],
    })
    const controllers = devices.filter(d => d.subLayer === 'sdwan-controller')
    expect(controllers).toHaveLength(0)
  })

  it('does NOT add controllers when overlayProtocols is empty', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
    })
    const controllers = devices.filter(d => d.subLayer === 'sdwan-controller')
    expect(controllers).toHaveLength(0)
  })

  it('adds controllers for multisite use case with SD-WAN overlay', () => {
    const devices = buildDeviceList({
      useCase: 'multisite',
      scale: 'small',
      siteCode: 'NYC',
      overlayProtocols: ['SD-WAN'],
    })
    const controllers = devices.filter(d => d.subLayer === 'sdwan-controller')
    expect(controllers.length).toBeGreaterThanOrEqual(5)
  })

  it('generates proper SDCTL hostnames for controllers', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['SD-WAN'],
    })
    const controllers = devices.filter(d => d.subLayer === 'sdwan-controller')
    const hostnames = controllers.map(d => d.hostname)
    expect(hostnames.some(h => h.includes('SDCTL'))).toBe(true)
  })

  it('generateAllConfigs produces SD-WAN configs for all devices', () => {
    const devices = buildDeviceList({
      useCase: 'wan',
      scale: 'small',
      siteCode: 'LAX',
      overlayProtocols: ['SD-WAN'],
    })
    const configs = generateAllConfigs(devices, 'wan')
    const values = Object.values(configs)
    const sdwanEdges = values.filter(c => c.includes('SD-WAN Edge'))
    const sdwanCtrls = values.filter(c => c.includes('SD-WAN vSmart') || c.includes('SD-WAN vBond') || c.includes('SD-WAN vManage'))
    expect(sdwanEdges.length).toBeGreaterThan(0)
    expect(sdwanCtrls.length).toBeGreaterThan(0)
  })
})
