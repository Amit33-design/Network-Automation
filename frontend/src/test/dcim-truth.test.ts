/**
 * The NetBox cable plant names the interfaces the configs configure (AP1).
 *
 * `expandCablePlan` named every interface sequentially (`Ethernet1/1`,
 * `Ethernet1/2`, …) regardless of vendor or of what the generated config
 * configures: on a DC design 0 of the DCIM interface names existed in the
 * configs for seven of eight fabric vendors (Cisco's matches were
 * coincidental — the right name on the wrong cable), and the firewall cables
 * walked EVERY leaf instead of the two border leaves the configs wire. The
 * cable plant is what a customer imports into NetBox as the source of truth.
 */
import { describe, it, expect } from 'vitest'
import type { UseCase } from '@/types'
import { buildDeviceList, buildCabling } from '@/lib/bom'
import { generateAllConfigs, fabricInterfaceView, borderLeaves, leafHostPortMax, fwHandoffPlan } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'
import { expandCablePlan, toNetBoxInterfaceCsv } from '@/lib/netbox-dcim'

const FABRIC_VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks', 'HPE Aruba']

function design(vendor: string, useCase: UseCase) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AP1', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, useCase)
  const cables = expandCablePlan(devices, buildCabling(devices, {} as never), useCase)
  return { devices, configs, cables, byHost: new Map(devices.map(d => [d.hostname, d])) }
}

/** The interface is configured in this device's config (or, for FMC-managed FTD, named in its manifest). */
function configures(cfg: string, iface: string): boolean {
  const text = cfg.includes('FMC POLICY MANIFEST') ? cfg : stripComments(cfg)
  const esc = iface.replace(/[/.]/g, m => '\\' + m)
  if (new RegExp(`(^|[^\\w/.-])${esc}(?![\\w/])`, 'm').test(text)) return true
  // EXOS names ports by number and configures them in ranges (`grouping 49-50`).
  if (/^\d+$/.test(iface)) {
    const n = Number(iface)
    return [...text.matchAll(/\b(\d+)-(\d+)\b/g)].some(m => Number(m[1]) <= n && n <= Number(m[2]))
  }
  return false
}

describe('DCIM cable plant lands on configured interfaces (AP1)', () => {
  it.each(FABRIC_VENDORS)('%s DC: every spine-leaf and firewall cable joins interfaces the configs configure', vendor => {
    const { configs, cables, byHost } = design(vendor, 'dc')
    let checked = 0
    for (const c of cables) {
      const la = byHost.get(c.a.device)!.subLayer, lb = byHost.get(c.b.device)!.subLayer
      const fabricOrFw = (la === 'spine' && lb === 'leaf') || la === 'firewall' || lb === 'firewall'
      if (!fabricOrFw) continue
      checked++
      expect(c.a.mapped && c.b.mapped, `${c.a.device}:${c.a.iface} ↔ ${c.b.device}:${c.b.iface} is not config-mapped`).toBe(true)
      for (const e of [c.a, c.b]) {
        expect(configures(configs[byHost.get(e.device)!.id], e.iface), `${e.device} does not configure ${e.iface}`).toBe(true)
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each(FABRIC_VENDORS.filter(v => v !== 'NVIDIA'))('%s DC: each spine-leaf cable joins the two ends of the same /31', vendor => {
    const { devices, cables, byHost } = design(vendor, 'dc')
    for (const c of cables) {
      const spine = byHost.get(c.a.device)!, leaf = byHost.get(c.b.device)!
      if (spine.subLayer !== 'spine' || leaf.subLayer !== 'leaf') continue
      const leafEnd = fabricInterfaceView(leaf, devices, 'dc').find(i => i.kind === 'fabric' && i.name === c.b.iface)
      const spineEnd = fabricInterfaceView(spine, devices, 'dc').find(i => i.kind === 'fabric' && i.name === c.a.iface)
      expect(leafEnd?.peer, `${leaf.hostname} ${c.b.iface}`).toBe(spine.hostname)
      expect(spineEnd?.peer, `${spine.hostname} ${c.a.iface}`).toBe(leaf.hostname)
      // the two interfaces carry the two addresses of one /31
      const [x, y] = [leafEnd!.ip, spineEnd!.ip].map(ip => ip.split('/')[0].split('.').map(Number))
      expect(Math.floor(x[3] / 2)).toBe(Math.floor(y[3] / 2))
      expect(x.slice(0, 3)).toEqual(y.slice(0, 3))
    }
  })

  it.each(['dc', 'multisite'] as const)('%s: firewall cables land only on the border leaves the configs wire', uc => {
    const { devices, cables, byHost } = design('Cisco', uc)
    const border = new Set(borderLeaves(devices).map(d => d.hostname))
    const fwCables = cables.filter(c => byHost.get(c.a.device)!.subLayer === 'firewall' || byHost.get(c.b.device)!.subLayer === 'firewall')
    expect(fwCables.length).toBeGreaterThan(0)
    for (const c of fwCables) {
      const sw = byHost.get(c.a.device)!.subLayer === 'firewall' ? c.b.device : c.a.device
      expect(border.has(sw), `${sw} is not a border leaf`).toBe(true)
    }
  })

  it.each(['dc', 'campus', 'gpu'] as const)('%s: no device has one interface on two cables', uc => {
    for (const vendor of ['Cisco', 'Juniper', 'Arista']) {
      const { cables } = design(vendor, uc)
      const seen = new Set<string>()
      for (const c of cables) for (const e of [c.a, c.b]) {
        const k = `${e.device}|${e.iface}`
        expect(seen.has(k), `${vendor} ${uc}: ${k} used twice`).toBe(false)
        seen.add(k)
      }
    }
  })

  it('the interface CSV says which ports the configs assign and which need confirming on site', () => {
    // GPU server links are not yet port-assigned (AP4), so both labels appear.
    const { cables } = design('Cisco', 'gpu')
    const csv = toNetBoxInterfaceCsv(cables)
    expect(csv).toContain('Configured in the generated config')
    expect(csv).toContain('Port not assigned by the config engine — confirm on site')
  })
})

// ── AP2: peer-links are billed only where a config builds one ───────────────
describe('HA peer-link cables agree with the configs (AP2)', () => {
  const CASES: Array<[UseCase, string, string]> = [
    ['dc', 'Cisco', 'leaf'], ['dc', 'Arista', 'leaf'], ['dc', 'Juniper', 'leaf'], ['dc', 'Nokia', 'leaf'],
    ['dc', 'Dell EMC', 'leaf'], ['dc', 'Extreme Networks', 'leaf'], ['dc', 'HPE Aruba', 'leaf'], ['dc', 'NVIDIA', 'leaf'],
    ['campus', 'Cisco', 'distribution'], ['campus', 'Extreme Networks', 'distribution'], ['campus', 'Juniper', 'distribution'],
    ['campus', 'Arista', 'distribution'], ['campus', 'HPE Aruba', 'distribution'], ['campus', 'Fortinet', 'distribution'],
  ]
  /** A config builds a peer-link: an LACP/sharing bundle labelled as one, EXOS's peer-link sharing group, or an OS10 VLTi (AP5). */
  const buildsPeerLink = (cfg: string) => /PEER[-_]LINK member|enable sharing \d+ grouping \d+-\d+|^\s*discovery-interface /m.test(stripComments(cfg))

  it.each(CASES)('%s %s: peer-link cables are billed exactly where the %s configs build a peer-link', (uc, vendor, tier) => {
    const { devices, configs, cables, byHost } = design(vendor, uc)
    const pairDevs = devices.filter(d => d.subLayer === tier)
    const built = pairDevs.some(d => buildsPeerLink(configs[d.id]))
    const peerCables = cables.filter(c => byHost.get(c.a.device)!.subLayer === tier && byHost.get(c.b.device)!.subLayer === tier)
    if (built) {
      expect(peerCables.length, `${vendor} builds a peer-link but none is cabled`).toBe(Math.floor(pairDevs.length / 2) * 2)
      for (const c of peerCables) {
        expect(c.a.mapped && c.b.mapped).toBe(true)
        for (const e of [c.a, c.b]) {
          const cfg = configs[byHost.get(e.device)!.id]
          expect(configures(cfg, e.iface) || inHostRange(cfg, e.iface), `${e.device} ${e.iface}`).toBe(true)
        }
      }
    } else {
      expect(peerCables.length, `${vendor} ${tier} configs build no peer-link, yet ${peerCables.length} peer-link cables are billed`).toBe(0)
    }
  })

  it('Junos and SR Linux leaves multihome with EVPN ESI, so no leaf↔leaf cable is billed', () => {
    for (const vendor of ['Juniper', 'Nokia']) {
      const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AP2', vendorPrefs: [vendor], totalEndpoints: 512 })
      const leafLeaf = buildCabling(devices, {} as never).filter(l => l.fromLayer === 'leaf' && l.toLayer === 'leaf')
      expect(leafLeaf, vendor).toEqual([])
    }
  })
})

// ── AP3: campus access↔distribution cables land on configured ports ────────
describe('campus access uplinks and distribution downlinks (AP3)', () => {
  const CAMPUS = ['Cisco', 'Arista', 'Juniper', 'Fortinet', 'HPE Aruba', 'Extreme Networks']
  // Each access SKU's real uplink block (vendor listings): the uplinks follow
  // the 48 host ports, or sit on a module.
  const EXPECTED_UPLINKS: Record<string, [string, string]> = {
    Cisco: ['TenGigabitEthernet1/1/1', 'TenGigabitEthernet1/1/2'],
    Arista: ['Ethernet49', 'Ethernet50'],
    Juniper: ['et-0/2/0', 'et-0/2/1'],
    Fortinet: ['port49', 'port50'],
    'HPE Aruba': ['1/1/49', '1/1/50'],
    'Extreme Networks': ['49', '50'],
  }

  it.each(CAMPUS)('%s: every access↔distribution cable is mapped and the access end is configured', vendor => {
    const { configs, cables, byHost } = design(vendor, 'campus')
    const runs = cables.filter(c => byHost.get(c.a.device)!.subLayer === 'distribution' && byHost.get(c.b.device)!.subLayer === 'access')
    expect(runs.length).toBeGreaterThan(0)
    for (const c of runs) {
      expect(c.a.mapped && c.b.mapped, `${c.a.device}:${c.a.iface} ↔ ${c.b.device}:${c.b.iface}`).toBe(true)
      expect(configures(configs[byHost.get(c.b.device)!.id], c.b.iface), `${c.b.device} does not configure ${c.b.iface}`).toBe(true)
    }
  })

  it.each(CAMPUS)('%s: access switches uplink on the SKU uplink block, not on host ports', vendor => {
    const { devices, configs } = design(vendor, 'campus')
    for (const acc of devices.filter(d => d.subLayer === 'access')) {
      const cfg = configs[acc.id]
      for (const up of EXPECTED_UPLINKS[vendor]) expect(configures(cfg, up), `${acc.hostname} lacks uplink ${up}`).toBe(true)
    }
  })

  it('Arista and Juniper access no longer uplink on 1G host ports', () => {
    const arista = design('Arista', 'campus')
    const a = arista.configs[arista.devices.find(d => d.subLayer === 'access')!.id]
    expect(a).not.toMatch(/interface Ethernet4[78]\n\s+description "UPLINK/)
    const juniper = design('Juniper', 'campus')
    const j = juniper.configs[juniper.devices.find(d => d.subLayer === 'access')!.id]
    expect(j).not.toMatch(/set interfaces ge-0\/0\/4[67] unit 0 family ethernet-switching interface-mode trunk/)
  })

  it('FortiSwitch: distribution configures every downlink, access has both split uplinks and all edge ports', () => {
    const { devices, configs } = design('Fortinet', 'campus')
    const dist = devices.find(d => d.subLayer === 'distribution')!
    const acc = devices.find(d => d.subLayer === 'access')!
    const downlinks = [...configs[dist.id].matchAll(/edit "port(\d+)"\n\s+set native-vlan 99\n\s+set allowed-vlans/g)].length
    expect(downlinks).toBeGreaterThan(1)
    expect(configs[acc.id]).toContain('UPLINK-1 to distribution A01')
    expect(configs[acc.id]).toContain('UPLINK-2 to distribution A02')
    expect([...configs[acc.id].matchAll(/set security-mode 802\.1X/g)].length).toBe(acc.ports || 48)
  })
})

/**
 * Port `iface` falls inside a host range as each dialect writes one (AP4):
 * NX-OS `Ethernet1/1-30`, EOS `Ethernet1-30`, Cumulus `swp1-60`, OS10
 * `ethernet 1/1/1-1/1/44`, Junos `member-range xe-0/0/0 to xe-0/0/42`.
 */
function inHostRange(cfg: string, iface: string): boolean {
  const text = stripComments(cfg)
  const m = iface.match(/^(.*?)(\d+)$/)
  if (!m) return false
  const [, prefix, num] = m, n = Number(num)
  const esc = (x: string) => x.replace(/[/.]/g, c => '\\' + c)
  const p = esc(prefix).replace(/^([a-z]+)/i, '$1\\s?')
  const pNum = esc(prefix.replace(/^[a-z-]+/i, ''))
  const forms = [
    new RegExp(`(?:^|[^\\w/.-])${p}(\\d+)-(?:${pNum})?(\\d+)\\b`, 'gm'),
    new RegExp(`member-range ${p}(\\d+) to ${p}(\\d+)`, 'g'),
  ]
  return forms.some(re => [...text.matchAll(re)].some(x => Number(x[1]) <= n && n <= Number(x[2])))
}

describe('leaf↔server cables land on configured leaf host ports (AP4)', () => {
  const GPU_VENDORS = ['Cisco', 'Arista', 'Juniper', 'NVIDIA', 'Dell EMC']

  it.each(GPU_VENDORS)('%s GPU: every host cable lands on a host port the leaf config configures', vendor => {
    const { devices, configs, cables, byHost } = design(vendor, 'gpu')
    const host = cables.filter(c => byHost.get(c.b.device)?.subLayer === 'gpu-compute' || byHost.get(c.a.device)?.subLayer === 'gpu-compute')
    expect(host.length).toBeGreaterThan(0)
    const perLeaf = new Map<string, number>()
    for (const c of host) {
      const [leaf, srv] = byHost.get(c.a.device)!.subLayer === 'leaf' ? [c.a, c.b] : [c.b, c.a]
      expect(leaf.mapped, `${leaf.device}:${leaf.iface} not config-mapped`).toBe(true)
      // The server has no generated config, so its NIC is never claimed as configured.
      expect(srv.mapped).toBe(false)
      const cfg = configs[byHost.get(leaf.device)!.id]
      expect(configures(cfg, leaf.iface) || inHostRange(cfg, leaf.iface), `${leaf.device} does not configure ${leaf.iface}`).toBe(true)
      perLeaf.set(leaf.device, (perLeaf.get(leaf.device) ?? 0) + 1)
    }
    for (const [h, n] of perLeaf) expect(n).toBeLessThanOrEqual(leafHostPortMax(byHost.get(h)!, devices))
  })

  it.each(GPU_VENDORS)('%s GPU: no leaf interface carries two cables, and host ports never take a firewall port', vendor => {
    const { devices, cables } = design(vendor, 'gpu')
    const seen = new Set<string>()
    for (const c of cables) for (const e of [c.a, c.b]) {
      const k = `${e.device}|${e.iface}`
      expect(seen.has(k), `${k} used twice`).toBe(false)
      seen.add(k)
    }
    for (const bl of borderLeaves(devices)) {
      const fwPorts = new Set(fwHandoffPlan(bl, devices, 'border-leaf').map(x => x.name))
      for (const c of cables) {
        const e = c.a.device === bl.hostname ? c.a : c.b.device === bl.hostname ? c.b : null
        if (e && fwPorts.has(e.iface)) expect(devices.find(d => d.hostname === (e === c.a ? c.b : c.a).device)!.subLayer).toBe('firewall')
      }
    }
  })

  it('a server\'s NICs land on more than one leaf, so it survives a leaf failure', () => {
    const { cables, byHost } = design('Cisco', 'gpu')
    const leavesOf = new Map<string, Set<string>>()
    for (const c of cables) {
      if (byHost.get(c.b.device)?.subLayer !== 'gpu-compute') continue
      if (!leavesOf.has(c.b.device)) leavesOf.set(c.b.device, new Set())
      leavesOf.get(c.b.device)!.add(c.a.device)
    }
    expect(leavesOf.size).toBeGreaterThan(0)
    for (const [srv, ls] of leavesOf) expect(ls.size, `${srv} is single-homed`).toBeGreaterThan(1)
  })

  it('Juniper: the server-access range and the ESI member never overlap the firewall handoff', () => {
    const { devices, configs } = design('Juniper', 'dc')
    for (const bl of borderLeaves(devices)) {
      const cfg = configs[bl.id]
      for (const x of fwHandoffPlan(bl, devices, 'border-leaf')) {
        expect(inHostRange(cfg, x.name), `${bl.hostname} ${x.name} is in SERVER-ACCESS`).toBe(false)
        expect(cfg).not.toMatch(new RegExp(`set interfaces ${x.name.replace(/\//g, '\\/')} ether-options 802\\.3ad`))
      }
    }
  })
})
