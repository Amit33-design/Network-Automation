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
import { generateAllConfigs, fabricInterfaceView, borderLeaves } from '@/lib/configgen'
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
    const { cables } = design('Cisco', 'campus')
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
  /** A config builds a peer-link: an LACP/sharing bundle labelled as one, or EXOS's peer-link sharing group. */
  const buildsPeerLink = (cfg: string) => /PEER[-_]LINK member|enable sharing \d+ grouping/.test(stripComments(cfg))

  it.each(CASES)('%s %s: peer-link cables are billed exactly where the %s configs build a peer-link', (uc, vendor, tier) => {
    const { devices, configs, cables, byHost } = design(vendor, uc)
    const pairDevs = devices.filter(d => d.subLayer === tier)
    const built = pairDevs.some(d => buildsPeerLink(configs[d.id]))
    const peerCables = cables.filter(c => byHost.get(c.a.device)!.subLayer === tier && byHost.get(c.b.device)!.subLayer === tier)
    if (built) {
      expect(peerCables.length, `${vendor} builds a peer-link but none is cabled`).toBe(Math.floor(pairDevs.length / 2) * 2)
      for (const c of peerCables) {
        expect(c.a.mapped && c.b.mapped).toBe(true)
        for (const e of [c.a, c.b]) expect(configures(configs[byHost.get(e.device)!.id], e.iface), `${e.device} ${e.iface}`).toBe(true)
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
