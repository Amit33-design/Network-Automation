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
import { generateAllConfigs, firewallHandoffs } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

function build(useCase: UseCase, vendor: string) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AN8', vendorPrefs: [vendor], totalEndpoints: 512 })
  return { devices, configs: generateAllConfigs(devices, useCase) }
}

/** A firewall holds its address as live config — or, for FMC-managed FTD, as a manifest `ip=` entry. */
function fwHolds(cfg: string, ip: string): boolean {
  return stripComments(cfg).includes(`${ip}/`) || stripComments(cfg).includes(`${ip} `) || cfg.includes(`ip=${ip}/`)
}

// SRX runs a chassis cluster — a single logical firewall on reth interfaces —
// which does not fit a per-firewall routed /31; tracked as AN10.
const isSrx = (model: string) => /srx/i.test(model)

const SCENARIOS: Array<[UseCase, string]> = [
  ['campus', 'Cisco'], ['campus', 'Arista'], ['campus', 'Fortinet'],
  ['campus', 'HPE Aruba'], ['campus', 'Palo Alto'],
  ['dc', 'Cisco'], ['dc', 'Arista'], ['dc', 'Nokia'], ['dc', 'Palo Alto'], ['dc', 'Fortinet'],
]

describe('firewall handoff — both ends (AN8)', () => {
  it.each(SCENARIOS)('%s / %s: every handoff is configured at both ends', (useCase, vendor) => {
    const { devices, configs } = build(useCase, vendor)
    const byId = new Map(devices.map(d => [d.id, configs[d.id] ?? '']))
    const fws = devices.filter(d => d.subLayer === 'firewall' && !isSrx(d.model))
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

  it.each(['Cisco', 'Arista', 'Juniper', 'Fortinet', 'HPE Aruba'])(
    '%s campus: every distribution switch configures a handoff per firewall', vendor => {
      const { devices, configs } = build('campus', vendor)
      const nFw = devices.filter(d => d.subLayer === 'firewall').length
      expect(nFw).toBeGreaterThan(0)
      for (const d of devices.filter(x => x.subLayer === 'distribution')) {
        const handoffIps = new Set(stripComments(configs[d.id]).match(/\b10\.98\.\d+\.\d+/g) ?? [])
        // Each /31 contributes its own address plus the firewall next-hop.
        expect(handoffIps.size, `${d.hostname}`).toBeGreaterThanOrEqual(nFw)
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
