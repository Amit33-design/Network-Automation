import { describe, it, expect } from 'vitest'
import {
  ztpPlatform, ztpRole, identifyDevice, generateDay0Config,
  generateDhcpConfig, buildZTPPlan, ztpPlanToCsv, ZTP_VENDOR_PROFILES,
  type ZTPPlatform,
} from '@/lib/ztp'
import type { BOMDevice } from '@/types'

const dev = (o: Partial<BOMDevice>): BOMDevice => ({
  id: o.hostname ?? o.id ?? 'd', hostname: 'H', role: 'leaf', subLayer: 'leaf',
  model: 'M', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
  speed: '100G', ports: 32, uplinks: 4, features: [], ...o,
})

// ── Platform identification ────────────────────────────────────────────────
describe('ztpPlatform — vendor + model → platform', () => {
  const cases: Array<[string, string, ZTPPlatform]> = [
    ['Cisco', 'Nexus 9336C-FX2', 'nxos'],
    ['Cisco', 'N9K-C93180YC-FX', 'nxos'],
    ['Cisco', 'Catalyst 9300', 'ios-xe'],
    ['Cisco', 'ISR 4331', 'ios-xe'],
    ['Cisco', 'ASR 9904', 'iosxr'],
    ['Cisco', 'NCS 540', 'iosxr'],
    ['Arista', '7050CX3', 'eos'],
    ['Juniper', 'QFX5120', 'junos'],
    ['Nokia', '7220 IXR-D3', 'srl'],
    ['NVIDIA', 'Spectrum SN4600C', 'cumulus'],
    ['Dell EMC', 'S5248F', 'dellos10'],
    ['Fortinet', 'FortiGate 600F', 'fortios'],
    ['HPE Aruba', 'CX 6300', 'arubaoscx'],
    ['Extreme Networks', '8520', 'exos'],
    ['Palo Alto', 'PA-5450', 'panos'],
  ]
  for (const [vendor, model, expected] of cases) {
    it(`${vendor} ${model} → ${expected}`, () => {
      expect(ztpPlatform(dev({ vendor, model }))).toBe(expected)
    })
  }

  it('every catalog vendor has a ZTP profile', () => {
    for (const p of Object.keys(ZTP_VENDOR_PROFILES) as ZTPPlatform[]) {
      const prof = ZTP_VENDOR_PROFILES[p]
      expect(prof.method).toBeTruthy()
      expect(prof.dhcpVendorClass).toBeTruthy()
      expect(prof.platform).toBe(p)
    }
  })
})

describe('ztpRole — subLayer → role label', () => {
  it('maps known roles to labels', () => {
    expect(ztpRole(dev({ subLayer: 'spine' })).label).toBe('Spine')
    expect(ztpRole(dev({ subLayer: 'wan-edge' })).label).toBe('WAN Edge')
    expect(ztpRole(dev({ subLayer: 'firewall' })).label).toBe('Firewall')
  })
})

// ── Device identification ──────────────────────────────────────────────────
describe('identifyDevice', () => {
  it('produces a full identity with method + vendor-class + boot file', () => {
    const id = identifyDevice(dev({ hostname: 'DC-LEAF-01', vendor: 'Arista', model: '7050CX3', subLayer: 'leaf' }))
    expect(id).toMatchObject({
      hostname: 'DC-LEAF-01', vendor: 'Arista', platform: 'eos',
      method: 'eZTP', role: 'leaf', roleLabel: 'Leaf / ToR',
    })
    expect(id.dhcpVendorClass).toBe('Arista')
    expect(id.bootFile).toContain('eos')
  })

  it('Cisco Nexus identifies as POAP, Catalyst as PnP, ASR9k as ZTP', () => {
    expect(identifyDevice(dev({ vendor: 'Cisco', model: 'Nexus 9336C' })).method).toBe('POAP')
    expect(identifyDevice(dev({ vendor: 'Cisco', model: 'Catalyst 9300', subLayer: 'access' })).method).toBe('PnP')
    expect(identifyDevice(dev({ vendor: 'Cisco', model: 'ASR 9904', subLayer: 'wan-edge' })).method).toBe('ZTP')
  })
})

// ── Day-0 management-plane bootstrap ───────────────────────────────────────
describe('generateDay0Config', () => {
  const platforms: ZTPPlatform[] = [
    'nxos', 'ios-xe', 'iosxr', 'eos', 'junos', 'srl',
    'cumulus', 'dellos10', 'fortios', 'arubaoscx', 'exos', 'panos',
  ]

  for (const platform of platforms) {
    it(`${platform}: mgmt-plane only, no hardcoded secrets, no production config`, () => {
      const id = identifyDevice(dev({
        hostname: `T-${platform}`,
        vendor: ZTP_VENDOR_PROFILES[platform].vendor,
        model: 'TEST',
        subLayer: 'leaf',
      }))
      // force the platform (vendor→platform may differ for the Cisco trio)
      id.platform = platform
      const cfg = generateDay0Config(id)

      // identity + mgmt plane present
      expect(cfg).toContain('T-' + platform)
      expect(cfg.toLowerCase()).toMatch(/ssh/)
      expect(cfg).toContain('<CHANGE-ME-mgmt-ip>')
      expect(cfg).toContain('<CHANGE-ME-admin-password>')

      // NO hardcoded credentials (the backend-template bug we're fixing)
      expect(cfg).not.toMatch(/ChangeMe!/)
      expect(cfg).not.toMatch(/NetDesignZTP1!/)

      // Day-0 is management plane ONLY — no production constructs
      expect(cfg).not.toMatch(/\brouter bgp\b/i)
      expect(cfg).not.toMatch(/interface nve|vxlan|vn-segment/i)
      expect(cfg).not.toMatch(/\bvlan 1\d\d\b/i)
    })
  }

  it('uses the right comment char per family (Junos/Nokia use #)', () => {
    const j = generateDay0Config(identifyDevice(dev({ vendor: 'Juniper', model: 'QFX5120' })))
    expect(j).toContain('set system host-name')
    expect(j).toContain('# Device')
  })

  it('substitutes provided mgmt options', () => {
    const id = identifyDevice(dev({ vendor: 'Arista', model: '7050CX3' }))
    const cfg = generateDay0Config(id, { mgmtIp: '10.0.0.9', ntp: '1.1.1.1' })
    expect(cfg).toContain('10.0.0.9')
    expect(cfg).toContain('1.1.1.1')
  })
})

// ── DHCP config (option-60 multi-vendor) ───────────────────────────────────
describe('generateDhcpConfig', () => {
  it('emits one option-60 class per distinct vendor-class', () => {
    const ids = [
      identifyDevice(dev({ vendor: 'Cisco', model: 'Nexus 9336C', hostname: 'A' })),
      identifyDevice(dev({ vendor: 'Arista', model: '7050CX3', hostname: 'B' })),
      identifyDevice(dev({ vendor: 'Juniper', model: 'QFX5120', hostname: 'C' })),
    ]
    const conf = generateDhcpConfig(ids, { ztpServerIp: '10.0.0.100' })
    expect(conf).toContain('class "Cisco-POAP"')
    expect(conf).toContain('class "Arista"')
    expect(conf).toContain('class "Juniper"')
    expect(conf).toContain('option vendor-class-identifier')
    expect(conf).toContain('next-server 10.0.0.100')
  })

  it('IOS-XE class carries the ciscopnp option-43 redirect', () => {
    const ids = [identifyDevice(dev({ vendor: 'Cisco', model: 'Catalyst 9300', subLayer: 'access', hostname: 'C1' }))]
    const conf = generateDhcpConfig(ids, { ztpServerIp: '10.9.9.9' })
    expect(conf).toContain('ciscopnp')
    expect(conf).toContain('5A;K4;B2;I10.9.9.9;J80')
  })

  it('dedupes the class list across many same-vendor devices', () => {
    const ids = Array.from({ length: 6 }, (_, i) =>
      identifyDevice(dev({ vendor: 'Nokia', model: '7220', hostname: `N${i}` })))
    const conf = generateDhcpConfig(ids)
    expect((conf.match(/class "Nokia-SRLinux"/g) ?? []).length).toBe(1)
  })
})

// ── Full provisioning plan ─────────────────────────────────────────────────
describe('buildZTPPlan', () => {
  const devices = [
    dev({ id: 's1', hostname: 'SP-01', vendor: 'Cisco', model: 'Nexus 9336C', subLayer: 'spine' }),
    dev({ id: 'l1', hostname: 'LF-01', vendor: 'Arista', model: '7050CX3', subLayer: 'leaf' }),
    dev({ id: 'f1', hostname: 'FW-01', vendor: 'Palo Alto', model: 'PA-5450', subLayer: 'firewall' }),
  ]

  it('identifies every device + generates a Day-0 for each', () => {
    const plan = buildZTPPlan(devices)
    expect(plan.entries).toHaveLength(3)
    for (const e of plan.entries) {
      expect(e.day0.length).toBeGreaterThan(50)
      expect(e.identity.method).toBeTruthy()
    }
    expect(plan.summary.byVendor).toMatchObject({ Cisco: 1, Arista: 1, 'Palo Alto': 1 })
    expect(plan.summary.byMethod).toMatchObject({ POAP: 1, eZTP: 1, 'Panorama-ZTP': 1 })
  })

  it('pairs each device with its Day-N production config by BOM id', () => {
    const configs = { s1: 'hostname SP-01\nrouter bgp 65000', l1: 'hostname LF-01\nrouter bgp 65001' }
    const plan = buildZTPPlan(devices, configs)
    const sp = plan.entries.find(e => e.identity.id === 's1')!
    const fw = plan.entries.find(e => e.identity.id === 'f1')!
    expect(sp.hasDayN).toBe(true)
    expect(sp.dayNConfigId).toBe('s1')
    expect(fw.hasDayN).toBe(false)      // no config provided for the firewall
    expect(fw.dayNConfigId).toBeNull()
    expect(plan.summary.withDayN).toBe(2)
  })

  it('CSV export has a header + one row per device', () => {
    const csv = ztpPlanToCsv(buildZTPPlan(devices))
    const lines = csv.trim().split('\n')
    expect(lines[0]).toContain('hostname,vendor,model,role,platform,ztp_method')
    expect(lines).toHaveLength(4)
    expect(csv).toContain('SP-01')
    expect(csv).toContain('POAP')
  })
})
