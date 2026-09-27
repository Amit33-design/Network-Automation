import { describe, it, expect } from 'vitest'
import {
  ztpPlatform, ztpRole, identifyDevice, generateDay0Config,
  generateDhcpConfig, buildZTPPlan, ztpPlanToCsv, ZTP_VENDOR_PROFILES,
  type ZTPPlatform,
} from '@/lib/ztp'
import type { BOMDevice } from '@/types'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'

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

// ── Provisioning paths other than DHCP switch ZTP ───────────────────────────
describe('provisioning path (how a device is really onboarded)', () => {
  const plan = (uc: Parameters<typeof buildDeviceList>[0]['useCase'], vendorPrefs: string[] = []) => {
    const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs })
    return buildZTPPlan(devs, generateAllConfigs(devs, uc))
  }

  it('an Aviatrix cloud gateway is Terraform-provisioned, with no Day-0 and no DHCP class', () => {
    const p = plan('multicloud')
    const cloud = p.entries.filter(e => e.identity.vendor === 'Aviatrix')
    expect(cloud.length).toBeGreaterThan(0)
    for (const e of cloud) {
      expect(e.identity.method).toBe('Terraform')
      expect(e.day0).toBe('')
      expect(e.identity.dhcpVendorClass).toBe('')
    }
  })

  it('a Firepower onboards via FMC low-touch provisioning, not IOS-XE PnP', () => {
    const fw = plan('dc').entries.filter(e => /firepower/i.test(e.identity.model))
    expect(fw.length).toBeGreaterThan(0)
    for (const e of fw) {
      expect(e.identity.method).toBe('FMC-LTP')
      expect(e.day0).toMatch(/^configure manager add /m)
      expect(e.day0).not.toMatch(/^ip ssh|^aaa new-model|pnp/im)
    }
  })

  it('a vEdge onboards via Viptela ZTP / vBond with a Viptela bootstrap', () => {
    const v = plan('multisite').entries.filter(e => /vedge/i.test(e.identity.model))
    expect(v.length).toBeGreaterThan(0)
    for (const e of v) {
      expect(e.identity.method).toBe('Viptela-ZTP')
      expect(e.day0).toMatch(/^ vbond /m)
    }
  })

  it('O-RAN servers, radios and the grandmaster are not given switch ZTP', () => {
    const p = plan('oran')
    const want: Record<string, string> = { 'oran-cu': 'PXE', 'oran-du': 'PXE', 'oran-core': 'PXE', 'oran-ru': 'O-RAN-Callhome', 'oran-timing': 'Manual' }
    const devs = buildDeviceList({ useCase: 'oran', scale: 'medium', siteCode: 'T' })
    for (const e of p.entries) {
      const d = devs.find(x => x.id === e.identity.id)!
      if (want[d.subLayer]) {
        expect(e.identity.method, d.subLayer).toBe(want[d.subLayer])
        expect(e.path).toBe('external')
      }
    }
  })

  it('the DHCP config carries no class for externally onboarded devices', () => {
    const p = plan('multicloud')
    const dhcp = generateDhcpConfig(p.entries.map(e => e.identity))
    expect(dhcp).not.toMatch(/class ""/)
    expect(dhcp).not.toMatch(/Aviatrix/)
  })

  it('no device outside Cisco IOS-XE hardware is handed a PnP Day-0', () => {
    // The old behaviour: every unrecognised device fell to ios-xe PnP.
    const bad: string[] = []
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks', 'Fortinet', 'Palo Alto', 'HPE Aruba']) {
      for (const uc of ['dc', 'gpu', 'campus', 'wan', 'multisite', 'multicloud', 'oran'] as const) {
        for (const e of plan(uc, [vendor]).entries) {
          if (e.identity.method !== 'PnP') continue
          if (e.identity.vendor !== 'Cisco' || /firepower|ftd|vedge/i.test(e.identity.model)) {
            bad.push(`${uc}/${vendor}: ${e.identity.vendor} ${e.identity.model}`)
          }
        }
      }
    }
    expect([...new Set(bad)]).toEqual([])
  })
})

// ── AN2: Day-0 boots into the management VRF the Day-N push expects ─────────
describe('Day-0 and Day-N agree on the management VRF', () => {
  // Day-N travels over the session Day-0 creates. Moving the management
  // interface to another VRF cuts that session: EOS clears the address on a
  // VRF change, and Cumulus/Junos re-home the default route.
  const vrf: Partial<Record<ZTPPlatform, (cfg: string) => string | null>> = {
    eos: c => /^interface Management1\n/m.test(c) ? (c.match(/^interface Management1\n(?:[ \t]+.*\n)*?[ \t]+vrf (\S+)/m)?.[1] ?? 'default') : null,
    junos: c => /^set interfaces (?:fxp0|em0|me0) /m.test(c) ? (/^set system management-instance$/m.test(c) ? 'mgmt_junos' : 'default') : null,
    cumulus: c => /interface eth0 ip address/.test(c) ? (c.match(/nv set interface eth0 ip vrf (\S+)/)?.[1] ?? 'default') : null,
    nxos: c => /^interface mgmt0\n/m.test(c) ? (c.match(/^interface mgmt0\n(?:\s+.*\n)*?\s+vrf member (\S+)/m)?.[1] ?? 'default') : null,
  }

  it('for every platform whose Day-N restates its management interface', () => {
    const bad: string[] = []
    let compared = 0
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'NVIDIA']) {
      for (const uc of ['dc', 'gpu', 'campus', 'wan'] as const) {
        const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
        const cfgs = generateAllConfigs(devs, uc)
        for (const e of buildZTPPlan(devs, cfgs).entries) {
          const f = vrf[e.identity.platform]
          const dayN = cfgs[e.identity.id]
          if (!f || e.path !== 'ztp' || !dayN) continue
          const d0 = f(e.day0), dn = f(dayN)
          if (!d0 || !dn) continue
          compared++
          if (d0 !== dn) bad.push(`${uc}/${vendor} ${e.identity.hostname} (${e.identity.platform}): Day-0 ${d0}, Day-N ${dn}`)
        }
      }
    }
    expect(compared).toBeGreaterThan(20)   // guard: the extractors really matched
    expect([...new Set(bad)]).toEqual([])
  })

  it('EOS Day-0 puts the management route in the VRF of the management interface', () => {
    const d0 = generateDay0Config(identifyDevice({ id: 'a', hostname: 'A-01', role: 'leaf', subLayer: 'leaf', model: '7050CX3', vendor: 'Arista', count: 1, unitPrice: 0, totalPrice: 0, speed: '100G', ports: 32, features: [] } as BOMDevice))
    expect(d0).toMatch(/^vrf instance MGMT$/m)
    expect(d0).toMatch(/^ip route vrf MGMT 0\.0\.0\.0\/0 /m)
  })

  it('Cumulus Day-0 is NVUE, not the removed NCLU', () => {
    const d0 = generateDay0Config(identifyDevice({ id: 'n', hostname: 'N-01', role: 'leaf', subLayer: 'leaf', model: 'SN4600C', vendor: 'NVIDIA', count: 1, unitPrice: 0, totalPrice: 0, speed: '100G', ports: 64, features: [] } as BOMDevice))
    expect(d0).not.toMatch(/^net add/m)
    expect(d0).toMatch(/^nv set interface eth0 ip vrf mgmt$/m)
  })
})


// ── AN3: a DHCP class only names a file it can share ────────────────────────
describe('DHCP boot files', () => {
  const ids = (vendor: string, uc: Parameters<typeof buildDeviceList>[0]['useCase']) => {
    const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
    return buildZTPPlan(devs, generateAllConfigs(devs, uc)).entries.map(e => e.identity)
  }

  it('never points a vendor class at a file for a host literally named "device"', () => {
    for (const [vendor, uc] of [['Fortinet', 'campus'], ['HPE Aruba', 'campus'], ['Extreme Networks', 'dc'], ['Palo Alto', 'dc'], ['Nokia', 'dc']] as const) {
      expect(generateDhcpConfig(ids(vendor, uc)), vendor).not.toMatch(/configs\/device\./)
    }
  })

  it('cloud-claimed platforms get address + DNS only, with no boot file', () => {
    const conf = generateDhcpConfig(ids('Fortinet', 'campus'))
    const cls = conf.match(/class "FortiGate[^"]*" \{[\s\S]*?\n\}/)?.[0] ?? conf.match(/class "Forti[^"]*" \{[\s\S]*?\n\}/)?.[0]
    expect(cls).toBeTruthy()
    expect(cls).not.toMatch(/filename/)
  })

  it('SR Linux gets one host reservation per device, each with its own file', () => {
    const srl = ids('Nokia', 'dc').filter(i => i.platform === 'srl')
    const conf = generateDhcpConfig(srl)
    expect(srl.length).toBeGreaterThan(1)
    for (const i of srl) {
      expect(conf).toContain(`host ${i.hostname} {`)
      expect(conf).toContain(`filename "${i.bootFile}";`)
    }
    expect(new Set(srl.map(i => i.bootFile)).size).toBe(srl.length)
  })
})
