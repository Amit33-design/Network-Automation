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
// AD2: this block used to assert Viptela OS syntax (top-level `vpn 0`,
// `zone-based-fw`, `qos-map`) against a Catalyst 8300 fixture — which is an
// IOS-XE cEdge, where none of that syntax exists. The generator emitted one
// OS's CLI under a header claiming the other. The two dialects are now
// asserted separately, against a device that actually runs each.
/** Comment lines are not configuration (Z6) — an absence assertion that reads
 *  them would trip on a comment saying which dialect this is NOT. */
const bodyOf = (cfg: string) =>
  cfg.split('\n').filter(l => !/^\s*[!#]/.test(l)).join('\n')

const cedge = (o: Partial<BOMDevice> = {}) => makeDevice(o)                        // Catalyst 8300
const vedge = (o: Partial<BOMDevice> = {}) =>
  makeDevice({ model: 'Catalyst SD-WAN vEdge 2000', ...o })

describe('SD-WAN cEdge (IOS-XE SD-WAN) config generation', () => {
  it('identifies itself as IOS-XE SD-WAN, not Viptela OS', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('! OS     : Cisco IOS-XE SD-WAN')
    expect(cfg).not.toContain('! OS     : Viptela OS')
  })

  it('never emits Viptela-only syntax the platform would reject', () => {
    const cfg = bodyOf(generateConfig(cedge(), 0))
    for (const viptelaOnly of [
      /^vpn \d+$/m,            // IOS-XE uses `vrf definition`
      /^omp$/m,                 // lives inside the `sdwan` submode
      /^  zone-based-policy/m,  // IOS-XE ZBF is `policy-map type inspect`
      /^  qos-map /m,           // IOS-XE QoS is MQC
    ]) {
      expect(cfg, `emitted Viptela syntax ${viptelaOnly}`).not.toMatch(viptelaOnly)
    }
  })

  it('carries the controller bring-up every cEdge needs', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('system-ip')
    expect(cfg).toContain('site-id')
    expect(cfg).toContain('organization-name')
    expect(cfg).toContain('vbond <CHANGE-ME-vbond-ip> port 12346')
  })

  it('uses IOS-XE VRFs and SD-WAN tunnel interfaces', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('vrf definition Mgmt-intf')
    expect(cfg).toContain('vrf definition 1')
    expect(cfg).toContain('vrf forwarding 1')
    expect(cfg).toContain('tunnel mode sdwan')
    expect(cfg).toMatch(/^sdwan$/m)
    expect(cfg).toMatch(/^ omp$/m)
  })

  it('uses IOS-XE zone-based firewall, not the Viptela policy container', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('policy-map type inspect PM-LAN-TO-WAN')
    expect(cfg).toContain('zone security LAN')
    expect(cfg).toContain('zone-pair security ZP-LAN-WAN')
    expect(cfg).toContain('zone-member security LAN')
  })

  it('uses IOS-XE MQC for QoS', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('policy-map PM-WAN-EDGE')
    expect(cfg).toContain('class CM-VOICE')
    expect(cfg).toContain('service-policy output PM-WAN-EDGE')
  })

  it('keeps app-aware routing and SLA classes', () => {
    const cfg = generateConfig(cedge(), 0)
    expect(cfg).toContain('app-route-policy BUSINESS-CRITICAL')
    expect(cfg).toContain('sla-class VOICE-SLA')
    expect(cfg).toContain('latency 150')
  })

  it('configures NTP, syslog and SNMP exactly once each', () => {
    // AA1 added these under the system block without removing the trailing
    // top-level ones, so the file carried two time sources with different
    // placeholders.
    const cfg = generateConfig(cedge(), 0)
    expect(cfg.match(/^ntp server/gm)?.length).toBe(2)   // primary + secondary
    expect(cfg.match(/^logging host/gm)?.length).toBe(1)
    expect(cfg.match(/^snmp-server host/gm)?.length).toBe(1)
    expect(cfg).not.toMatch(/^ntp$/m)                    // no Viptela block too
  })
})

describe('SD-WAN vEdge (Viptela OS) config generation (G-A12)', () => {
  it('identifies itself as Viptela OS', () => {
    const cfg = generateConfig(vedge(), 0)
    expect(cfg).toContain('! OS     : Viptela OS')
    expect(cfg).not.toContain('! OS     : Cisco IOS-XE SD-WAN')
  })

  it('generates the VPN transport, management and service segments', () => {
    const cfg = generateConfig(vedge(), 0)
    expect(cfg).toContain('vpn 0')
    expect(cfg).toContain('tunnel-interface')
    expect(cfg).toContain('encapsulation ipsec')
    expect(cfg).toContain('color biz-internet')
    expect(cfg).toContain('vpn 512')
    expect(cfg).toContain('MGMT-OUT-OF-BAND')
    expect(cfg).toContain('vpn 1')
    expect(cfg).toContain('CORPORATE-LAN')
  })

  it('uses Viptela interface names, not IOS-XE ones', () => {
    const cfg = generateConfig(vedge(), 0)
    expect(cfg).toContain('interface ge0/0')
    expect(cfg).toContain('interface mgmt0')
    expect(cfg).not.toContain('GigabitEthernet')
  })

  it('generates OMP without advertising a protocol it does not run', () => {
    const cfg = bodyOf(generateConfig(vedge(), 0))
    expect(cfg).toContain('graceful-restart')
    expect(cfg).toContain('advertise connected')
    expect(cfg).not.toContain('advertise ospf')
    expect(cfg).not.toMatch(/^router ospf/m)
  })

  it('opens the policy container exactly once', () => {
    // The firewall, app-route policy, SLA classes and QoS map each used to
    // re-open a top-level `policy` block — three of them in one file.
    const cfg = generateConfig(vedge(), 0)
    expect(cfg.match(/^policy$/gm)?.length).toBe(1)
    expect(cfg).toContain('zone-based-policy EDGE-FW')
    expect(cfg).toContain('qos-map QOS-POLICY')
    expect(cfg).toContain('app-route-policy BUSINESS-CRITICAL')
  })

  it('keeps the zone model in Viptela syntax', () => {
    const cfg = bodyOf(generateConfig(vedge(), 0))
    expect(cfg).toContain('zone LAN-ZONE')
    expect(cfg).toContain('zone-pair ZP-LAN-WAN')
    expect(cfg).not.toContain('zone security')      // IOS-XE spelling
    expect(cfg).not.toContain('policy-map type inspect')
  })

  it('configures NTP and syslog once, under system', () => {
    const cfg = generateConfig(vedge(), 0)
    expect(cfg.match(/^ntp$/gm) ?? []).toHaveLength(0)   // no top-level block
    expect(cfg.match(/^logging$/gm) ?? []).toHaveLength(0)
    expect(cfg).toContain('<CHANGE-ME-ntp-primary>')
    expect(cfg).not.toContain('<CHANGE-ME-ntp-server-1>')
  })
})

describe('SD-WAN edge — shared behaviour', () => {
  for (const [name, make] of [['cEdge', cedge], ['vEdge', vedge]] as const) {
    it(`${name}: uses no hardcoded secrets`, () => {
      const cfg = generateConfig(make(), 0)
      for (const p of cfg.match(/password\s+\S+/g) ?? []) expect(p).toContain('<CHANGE-ME')
      for (const p of cfg.match(/secret\s+\S+/g) ?? []) expect(p).toContain('<CHANGE-ME')
    })

    it(`${name}: gives an HA pair one shared site-id and distinct system-ips`, () => {
      // The original test asserted that A01 and A02 — the HA PAIR at one site
      // — were given two DIFFERENT site-ids, which is not what an SD-WAN site
      // is. A dual-router site shares one site-id; the routers differ by
      // system-ip and the next site takes the next id.
      const a01 = generateConfig(make({ hostname: 'SITE-WAN-A01' }), 0)
      const a02 = generateConfig(make({ hostname: 'SITE-WAN-A02' }), 1)
      const b01 = generateConfig(make({ hostname: 'SITE-WAN-B01' }), 2)
      const site = (c: string) => /site-id\s+(\d+)/.exec(c)?.[1]
      const sys = (c: string) => /system-ip\s+(\S+)/.exec(c)?.[1]
      expect([site(a01), site(a02), site(b01)]).toEqual(['101', '101', '102'])
      expect([sys(a01), sys(a02), sys(b01)]).toEqual(['10.10.101.1', '10.10.101.2', '10.10.102.1'])
    })
  }

  it('scopes the site-id to the WAN tier, not the whole BOM', () => {
    // AA2: a multicloud BOM holds cloud appliances before the on-ramps. With a
    // global index those four routers became sites 104-107 — four SD-WAN sites
    // for a two-site design.
    const cloud = [1, 2, 3, 4].map(n => makeDevice({
      hostname: `SITE-CGW-A0${n}`, subLayer: 'cloud-gw', id: `cloud-${n}`,
    }))
    const edges = [1, 2, 3, 4].map(n => makeDevice({
      hostname: `SITE-WAN-${n <= 2 ? 'A' : 'B'}0${n <= 2 ? n : n - 2}`, id: `edge-${n}`,
    }))
    const all = [...cloud, ...edges]
    const ids = edges.map((d, i) =>
      /site-id\s+(\d+)/.exec(generateConfig(d, cloud.length + i, '', [], all))?.[1])
    expect(ids).toEqual(['101', '101', '102', '102'])
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
    // ...and to the cEdge dialect, because a Catalyst 8300 runs IOS-XE. This
    // assertion used to require `vpn 0`, which is Viptela-only syntax.
    expect(cfg).toContain('tunnel mode sdwan')
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
