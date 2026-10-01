/**
 * The LLD describes the network the configs build (AO1).
 *
 * The DC LLD drew a fixed three-tier enterprise topology — internet, firewalls,
 * routers, F5 and web/app servers — and ignored the BOM, so a spine-leaf design
 * showed no spine or leaf, and none of its interface addresses appeared in any
 * generated config. Across all use cases 177 of 181 LLD addresses were in no
 * config. These invariants pin the DC LLD to the design; the remaining
 * builders are tracked as AO2.
 */
import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, fabricInterfaceView } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'
import { buildLLDTopology } from '@/components/LLDTopologyDiagram'

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks', 'HPE Aruba', 'Palo Alto', 'Fortinet']

function design(vendor: string) {
  const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AO1', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, 'dc')
  return { devices, configs, lld: buildLLDTopology(devices, 'dc', 'AO1') }
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

  it('the address check catches an invented address (mutation guard)', () => {
    const { devices, configs } = design('Cisco')
    const spine = devices.find(d => d.subLayer === 'spine')!
    expect(hasAddr(configs[spine.id], '10.255.1.1')).toBe(true)
    expect(hasAddr(configs[spine.id], '10.21.10.1')).toBe(false)
  })
})
