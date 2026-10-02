/**
 * The LLD describes the network the configs build (AO1).
 *
 * The DC LLD drew a fixed three-tier enterprise topology — internet, firewalls,
 * routers, F5 and web/app servers — and ignored the BOM, so a spine-leaf design
 * showed no spine or leaf, and none of its interface addresses appeared in any
 * generated config. Across all use cases 177 of 181 LLD addresses were in no
 * config. These invariants pin every LLD builder to the design (AO1–AO4).
 */
import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, fabricInterfaceView, generateConfig } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'
import { buildLLDTopology } from '@/components/LLDTopologyDiagram'

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks', 'HPE Aruba', 'Palo Alto', 'Fortinet']

function design(vendor: string, useCase: 'dc' | 'gpu' | 'campus' = 'dc') {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AO1', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, useCase)
  return { devices, configs, lld: buildLLDTopology(devices, useCase, 'AO1') }
}

/** True when `ip` (no mask) occurs as a whole address in `text`. */
const hasAddr = (text: string, ip: string) =>
  new RegExp(`(?<![\\d.])${ip.replace(/\./g, '\\.')}(?![\\d])`).test(text)

describe('DC LLD is drawn from the design (AO1)', () => {
  it.each(VENDORS)('%s: every node is a BOM device and the fabric tiers are present', vendor => {
    const { devices, lld } = design(vendor)
    const byHost = new Map(devices.map(d => [d.hostname, d]))
    expect(lld.nodes.length).toBeGreaterThan(0)
    for (const n of lld.nodes) expect(byHost.has(n.hostname), `${n.hostname} is not in the BOM`).toBe(true)
    const tiers = new Set(lld.nodes.map(n => byHost.get(n.hostname)!.subLayer))
    expect(tiers.has('spine') && tiers.has('leaf')).toBe(true)
  })

  it.each(VENDORS)('%s: every address on the diagram is in that device\'s own config', vendor => {
    const { devices, configs, lld } = design(vendor)
    const cfgOf = new Map(devices.map(d => [d.hostname, `${stripComments(configs[d.id] ?? '')}\n${configs[d.id] ?? ''}`]))
    let checked = 0
    for (const n of lld.nodes) for (const i of n.interfaces) {
      if (!/^10\./.test(i.ip)) continue
      checked++
      expect(hasAddr(cfgOf.get(n.hostname)!, i.ip.split('/')[0]), `${n.hostname} ${i.name} ${i.ip}`).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it.each(['Cisco', 'Arista', 'NVIDIA'])('%s: interface names on the diagram exist in the config', vendor => {
    const { devices, configs, lld } = design(vendor)
    const cfgOf = new Map(devices.map(d => [d.hostname, stripComments(configs[d.id] ?? '')]))
    for (const n of lld.nodes) for (const i of n.interfaces) {
      if (!/^(Ethernet|swp)\d/.test(i.name)) continue
      expect(cfgOf.get(n.hostname)!, `${n.hostname} ${i.name}`).toMatch(new RegExp(`\\b${i.name.replace(/\//g, '\\/')}\\b`))
    }
  })

  it.each(VENDORS)('%s: each spine-leaf link is a real fabric /31 between shown devices', vendor => {
    const { devices, lld } = design(vendor)
    const host = new Map(lld.nodes.map(n => [n.id, n.hostname]))
    const dev = new Map(devices.map(d => [d.hostname, d]))
    const fabric = lld.links.filter(l => l.protocol === 'eBGP underlay')
    expect(fabric.length).toBeGreaterThan(0)
    for (const l of fabric) {
      const leaf = dev.get(host.get(l.to)!)!
      const spine = host.get(l.from)!
      const up = fabricInterfaceView(leaf, devices, 'dc').find(i => i.kind === 'fabric' && i.peer === spine && i.name === l.toPort)
      expect(up, `${leaf.hostname} has no uplink ${l.toPort} to ${spine}`).toBeDefined()
    }
  })

  // AO2: the GPU LLD invented an OOB switch, DGX servers and NetApp storage.
  it.each(['Cisco', 'Arista', 'Juniper', 'NVIDIA', 'Dell EMC'])('%s GPU: only BOM devices, only config addresses', vendor => {
    const { devices, configs, lld } = design(vendor, 'gpu')
    const byHost = new Map(devices.map(d => [d.hostname, d]))
    const cfgOf = new Map(devices.map(d => [d.hostname, `${stripComments(configs[d.id] ?? '')}\n${configs[d.id] ?? ''}`]))
    for (const n of lld.nodes) {
      expect(byHost.has(n.hostname), `${n.hostname} is not in the BOM`).toBe(true)
      for (const i of n.interfaces) if (/^10\./.test(i.ip)) expect(hasAddr(cfgOf.get(n.hostname)!, i.ip.split('/')[0]), `${n.hostname} ${i.ip}`).toBe(true)
    }
    expect(lld.nodes.some(n => byHost.get(n.hostname)!.subLayer === 'gpu-compute')).toBe(true)
  })

  // AO3: the campus LLD drew a core pair and WAN routers the BOM lacks.
  it.each(['Cisco', 'Arista', 'Juniper', 'Fortinet', 'HPE Aruba', 'Extreme Networks'])('%s campus: only BOM devices, only config addresses', vendor => {
    const { devices, configs, lld } = design(vendor, 'campus')
    const byHost = new Map(devices.map(d => [d.hostname, d]))
    const cfgOf = new Map(devices.map(d => [d.hostname, `${stripComments(configs[d.id] ?? '')}\n${configs[d.id] ?? ''}`]))
    let checked = 0
    for (const n of lld.nodes) {
      expect(byHost.has(n.hostname), `${n.hostname} is not in the BOM`).toBe(true)
      for (const i of n.interfaces) if (/^10\./.test(i.ip)) { checked++; expect(hasAddr(cfgOf.get(n.hostname)!, i.ip.split('/')[0]), `${n.hostname} ${i.ip}`).toBe(true) }
    }
    expect(checked).toBeGreaterThan(0)
    const tiers = new Set(lld.nodes.map(n => byHost.get(n.hostname)!.subLayer))
    expect(tiers.has('distribution') && tiers.has('access')).toBe(true)
  })

  it('a pure-L3 NVIDIA GPU fabric is not captioned as VXLAN/EVPN', () => {
    const { lld } = design('NVIDIA', 'gpu')
    const text = JSON.stringify(lld.zones) + JSON.stringify(lld.nodes.map(n => [n.configLines, n.services]))
    expect(text).not.toMatch(/VXLAN|EVPN|VNI/)
  })

  it('the address check catches an invented address (mutation guard)', () => {
    const { devices, configs } = design('Cisco')
    const spine = devices.find(d => d.subLayer === 'spine')!
    expect(hasAddr(configs[spine.id], '10.255.1.1')).toBe(true)
    expect(hasAddr(configs[spine.id], '10.21.10.1')).toBe(false)
  })
})

// AO4: WAN, multisite, multicloud, Aviatrix and O-RAN drew fixed topologies —
// SP backbones, branch CPEs, AWS/Azure VPCs, O-CU-01 — no node was a BOM device
// and 106 of 108 addresses were in no config.
type Uc = 'wan' | 'multisite' | 'multicloud' | 'aviatrix' | 'oran'
function tiered(vendor: string, useCase: Uc, totalEndpoints = 512) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AO4', vendorPrefs: [vendor], totalEndpoints, numSites: 3 })
  return { devices, configs: generateAllConfigs(devices, useCase), lld: buildLLDTopology(devices, useCase, 'AO4') }
}
const MUST_SHOW: Record<Uc, string[]> = {
  wan: ['wan-edge'],
  multisite: ['wan-edge', 'spine', 'leaf'],
  multicloud: ['cloud-transit', 'wan-edge'],
  aviatrix: ['cloud-transit', 'wan-edge'],
  oran: ['oran-cu', 'oran-du', 'oran-ru', 'oran-fronthaul', 'oran-midhaul'],
}
const CASES = (Object.keys(MUST_SHOW) as Uc[]).flatMap(uc => ['Cisco', 'Juniper', 'Arista'].map(v => [uc, v] as const))

describe('WAN / multisite / cloud / O-RAN LLDs are drawn from the design (AO4)', () => {
  it.each(CASES)('%s %s: only BOM devices, only config addresses, the design tiers present', (uc, vendor) => {
    const { devices, configs, lld } = tiered(vendor, uc)
    const byHost = new Map(devices.map(d => [d.hostname, d]))
    const cfgOf = new Map(devices.map(d => [d.hostname, `${stripComments(configs[d.id] ?? '')}\n${configs[d.id] ?? ''}`]))
    let checked = 0
    for (const n of lld.nodes) {
      expect(byHost.has(n.hostname), `${n.hostname} is not in the BOM`).toBe(true)
      for (const i of n.interfaces) if (/^10\./.test(i.ip)) { checked++; expect(hasAddr(cfgOf.get(n.hostname)!, i.ip.split('/')[0]), `${n.hostname} ${i.name} ${i.ip}`).toBe(true) }
    }
    expect(checked).toBeGreaterThan(0)
    const tiers = new Set(lld.nodes.map(n => byHost.get(n.hostname)!.subLayer))
    for (const t of MUST_SHOW[uc]) expect(tiers.has(t), `${uc} LLD has no ${t}`).toBe(true)
    expect(lld.links.length).toBeGreaterThan(0)
  })

  it('O-RAN F1 links join each DU to the CU its config homes it to', () => {
    const { devices, configs, lld } = tiered('Cisco', 'oran')
    const host = new Map(lld.nodes.map(n => [n.id, n.hostname]))
    const dev = new Map(devices.map(d => [d.hostname, d]))
    const f1 = lld.links.filter(l => l.protocol.startsWith('F1'))
    expect(f1.length).toBeGreaterThan(0)
    for (const l of f1) {
      const [a, b] = [dev.get(host.get(l.from)!)!, dev.get(host.get(l.to)!)!]
      const du = a.subLayer === 'oran-du' ? a : b
      const cu = a.subLayer === 'oran-du' ? b : a
      expect(configs[du.id]).toContain(`# ${cu.hostname}`)
    }
  })
})

describe('WAN-edge and O-RAN identity is tier-scoped (AO4)', () => {
  it.each(['wan', 'multisite', 'multicloud'] as const)('Juniper %s: WAN loopbacks are unique, outside the MLAG pool, and start at .1', uc => {
    const { devices, configs } = tiered('Juniper', uc)
    const los = devices.filter(d => d.subLayer === 'wan-edge').map(d => /lo0 unit 0 family inet address (\S+)\/32/.exec(configs[d.id])![1])
    expect(los[0]).toBe('10.255.4.1')
    expect(new Set(los).size).toBe(los.length)
    for (const ip of los) expect(ip.startsWith('10.253.')).toBe(false)
  })

  it('IOS-XE WAN edge has a real loopback and router-id, not placeholders', () => {
    const dev = { id: 'w1', hostname: 'W-A01', vendor: 'Cisco', model: 'ISR 4331', subLayer: 'wan-edge', count: 1, ports: 4, speed: '1G' } as never
    const cfg = generateConfig(dev, 7, 'wan', [], [dev])
    expect(cfg).not.toContain('<CHANGE-ME-loopback-ip>')
    expect(cfg).not.toContain('<CHANGE-ME-router-id>')
    expect(cfg).toContain('ip address 10.255.4.1 255.255.255.255')
  })

  it('a large O-RAN design keeps every PTP priority2 inside 0-255', () => {
    const { devices, configs } = tiered('Cisco', 'oran', 4096)
    const gms = devices.filter(d => d.subLayer === 'oran-timing')
    expect(gms.length).toBeGreaterThan(0)
    for (const g of gms) {
      const p = Number(/priority2 (\d+)/.exec(configs[g.id])![1])
      expect(p).toBeLessThanOrEqual(255)
    }
  })
})
