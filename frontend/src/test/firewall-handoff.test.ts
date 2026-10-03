/**
 * Both ends of every firewall handoff are configured (AN8).
 *
 * Y7/Z3 gave the fabric side of the firewall handoff to Cisco distribution and
 * to every border-leaf vendor, but no campus distribution other than Cisco
 * configured it, and of the firewalls only the FTD manifest named its side —
 * PAN-OS and FortiGate kept one placeholder inside interface. So a cabled /31
 * existed at one end or neither, and the design had no north-south path.
 */
import { describe, it, expect } from 'vitest'
import type { UseCase } from '@/types'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, firewallHandoffs, firewallClusters, firewallTransitPlan } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

function build(useCase: UseCase, vendor: string) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AN8', vendorPrefs: [vendor], totalEndpoints: 512 })
  return { devices, configs: generateAllConfigs(devices, useCase) }
}

/** A firewall holds its address as live config — or, for FMC-managed FTD, as a manifest `ip=` entry. */
function fwHolds(cfg: string, ip: string): boolean {
  return stripComments(cfg).includes(`${ip}/`) || stripComments(cfg).includes(`${ip} `) || cfg.includes(`ip=${ip}/`)
}

const SCENARIOS: Array<[UseCase, string]> = [
  ['campus', 'Cisco'], ['campus', 'Arista'], ['campus', 'Fortinet'],
  ['campus', 'HPE Aruba'], ['campus', 'Extreme Networks'], ['campus', 'Palo Alto'],
  ['dc', 'Cisco'], ['dc', 'Arista'], ['dc', 'Nokia'], ['dc', 'Palo Alto'], ['dc', 'Fortinet'],
  // AN10: the SRX chassis cluster now fits the shared model, so it is checked too.
  ['dc', 'Juniper'], ['campus', 'Juniper'],
]

describe('firewall handoff — both ends (AN8)', () => {
  it.each(SCENARIOS)('%s / %s: every handoff is configured at both ends', (useCase, vendor) => {
    const { devices, configs } = build(useCase, vendor)
    const byId = new Map(devices.map(d => [d.id, configs[d.id] ?? '']))
    const fws = devices.filter(d => d.subLayer === 'firewall')
    let checked = 0
    for (const fw of fws) {
      const handoffs = firewallHandoffs(fw, devices, useCase)
      expect(handoffs.length, `${fw.hostname} (${fw.model}) terminates no handoff`).toBeGreaterThan(0)
      for (const h of handoffs) {
        expect(stripComments(byId.get(h.peer.id)!), `${h.peer.hostname} lacks its end ${h.peerIp}`).toContain(h.peerIp)
        expect(fwHolds(byId.get(fw.id)!, h.fwIp), `${fw.hostname} (${fw.model}) lacks its end ${h.fwIp}`).toBe(true)
        checked++
      }
    }
    expect(checked, 'no handoff was checked').toBeGreaterThan(0)
  })

  it.each(['Cisco', 'Arista', 'Juniper', 'Fortinet', 'HPE Aruba', 'Extreme Networks'])(
    '%s campus: every distribution switch configures a handoff per firewall', vendor => {
      const { devices, configs } = build('campus', vendor)
      const nFw = devices.filter(d => d.subLayer === 'firewall').length
      expect(nFw).toBeGreaterThan(0)
      for (const d of devices.filter(x => x.subLayer === 'distribution')) {
        const handoffIps = new Set(stripComments(configs[d.id]).match(/\b10\.98\.\d+\.\d+/g) ?? [])
        // Each cluster's /29 contributes the SVI address plus the floating next-hop.
        expect(handoffIps.size, `${d.hostname}`).toBeGreaterThanOrEqual(2 * Math.ceil(nFw / 2))
      }
    })

  it('the check fails when a firewall drops its end (mutation guard)', () => {
    const { devices, configs } = build('campus', 'Palo Alto')
    const fw = devices.find(d => d.subLayer === 'firewall')!
    const h = firewallHandoffs(fw, devices, 'campus')[0]
    expect(fwHolds(configs[fw.id], h.fwIp)).toBe(true)
    expect(fwHolds(configs[fw.id].split(h.fwIp).join('<CHANGE-ME-inside-ip>'), h.fwIp)).toBe(false)
  })
})

/**
 * AN10 — a firewall pair is ONE active/passive HA cluster, per every vendor's
 * manual: Juniper SRX chassis cluster (reth), PAN-OS HA, FortiGate FGCP and
 * FTD failover all float one data-plane address between the units. Before
 * this, each unit held its own routed /31 on each switch and only the SRX had
 * HA config at all — the fabric ECMP'd across two firewalls that shared no
 * state, so return traffic landing on the other unit was dropped.
 */
const HA_VENDORS: Array<[UseCase, string, RegExp]> = [
  ['dc', 'Palo Alto', /set deviceconfig high-availability enabled yes/],
  ['dc', 'Fortinet', /config system ha\n\s+set group-id \d+[\s\S]*?set mode a-p/],
  ['dc', 'Juniper', /set chassis cluster redundancy-group 1 node 1 priority/],
  ['dc', 'Cisco', /\[High Availability\][\s\S]*?failover link: Ethernet1\/\d+/],
  ['campus', 'Palo Alto', /set deviceconfig high-availability enabled yes/],
  ['campus', 'Juniper', /set chassis cluster redundancy-group 1 node 1 priority/],
]

describe('firewall HA clusters (AN10)', () => {
  it.each(HA_VENDORS)('%s / %s: both units are configured as one HA cluster', (useCase, vendor, haRe) => {
    const { devices, configs } = build(useCase, vendor)
    const clusters = firewallClusters(devices).filter(c => c.members.length === 2)
    expect(clusters.length, 'design has no firewall pair').toBeGreaterThan(0)
    for (const c of clusters) {
      for (const fw of c.members) expect(configs[fw.id], `${fw.hostname} (${fw.model}) has no HA config`).toMatch(haRe)
      // the two units hold the SAME inside addresses — the floating ones
      const a = firewallHandoffs(c.members[0], devices, useCase).map(h => h.fwIp)
      const b = firewallHandoffs(c.members[1], devices, useCase).map(h => h.fwIp)
      expect(a.length).toBeGreaterThan(0)
      expect(b).toEqual(a)
    }
  })

  it.each(SCENARIOS)('%s / %s: each switch puts both units in one transit VLAN with one SVI and one next hop', (useCase, vendor) => {
    const { devices, configs } = build(useCase, vendor)
    const plan = firewallTransitPlan(devices, useCase)
    expect(plan.length).toBeGreaterThan(0)
    for (const seg of plan) {
      const cfg = stripComments(configs[seg.peer.id])
      expect(cfg, `${seg.peer.hostname}: no SVI ${seg.ip}`).toContain(seg.ip)
      expect(cfg, `${seg.peer.hostname}: no route to the floating ${seg.fwIp}`).toContain(seg.fwIp)
      expect(cfg, `${seg.peer.hostname}: transit VLAN ${seg.vlan} missing`).toMatch(new RegExp(`\\b${seg.vlan}\\b`))
      expect(seg.fws.length, 'one switch port per unit').toBe(firewallClusters(devices)[seg.cluster].members.length)
      // a /31 toward a firewall is the old per-unit model and cannot fail over
      expect(cfg, `${seg.peer.hostname}: still routes a /31 toward a firewall`).not.toMatch(/10\.98\.\d+\.\d+\/31|10\.98\.\d+\.\d+ 255\.255\.255\.254/)
      // the standby address is never used as a next hop
      expect(cfg).not.toContain(` ${seg.fwStandbyIp}\n`)
    }
  })

  it('PAN-OS: each unit points its HA1 peer-ip at the OTHER unit\'s HA1 address', () => {
    const { devices, configs } = build('dc', 'Palo Alto')
    const [c] = firewallClusters(devices)
    const own = (id: string) => /interface ha1 ip-address (\S+)/.exec(configs[id])![1]
    const peer = (id: string) => /group peer-ip (\S+)/.exec(configs[id])![1]
    expect(peer(c.members[0].id)).toBe(own(c.members[1].id))
    expect(peer(c.members[1].id)).toBe(own(c.members[0].id))
    // and the first unit wins the election (lower device-priority)
    const prio = (id: string) => Number(/device-priority (\d+)/.exec(configs[id])![1])
    expect(prio(c.members[0].id)).toBeLessThan(prio(c.members[1].id))
  })

  it('FortiGate: both units share group-id and group-name, and differ in priority', () => {
    const { devices, configs } = build('dc', 'Fortinet')
    const [c] = firewallClusters(devices)
    const f = (id: string, k: string) => new RegExp(`set ${k} (\\S+)`).exec(configs[id].split('config system ha')[1])![1]
    expect(f(c.members[0].id, 'group-id')).toBe(f(c.members[1].id, 'group-id'))
    expect(f(c.members[0].id, 'group-name')).toBe(f(c.members[1].id, 'group-name'))
    expect(f(c.members[0].id, 'priority')).not.toBe(f(c.members[1].id, 'priority'))
  })

  it('SRX4600: no data port on the dedicated HA control (xe-0/0/0-1) or fabric (xe-0/0/2-3) ports', () => {
    const { devices, configs } = build('dc', 'Juniper')
    const srx = devices.find(d => d.subLayer === 'firewall' && /4600/.test(d.model))!
    expect(configs[srx.id]).not.toMatch(/xe-0\/0\/[0-3] gigether-options/)
    expect(configs[srx.id]).toMatch(/set interfaces fab0 fabric-options member-interfaces xe-0\/0\/2/)
    // both nodes carry the one shared configuration, apart from the header
    const [c] = firewallClusters(devices)
    const body = (id: string) => configs[id].split('\n').filter(l => !l.startsWith('# Device')).join('\n')
    expect(body(c.members[0].id)).toBe(body(c.members[1].id))
  })
})

