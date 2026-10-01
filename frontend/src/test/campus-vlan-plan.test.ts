/**
 * One campus VLAN plan across every campus vendor, matching the IPAM export
 * (AN7). Each generator used to invent its own — Cisco 10/20/99, Arista and
 * Juniper 100/200/300/400/999, Aruba 10 MANAGEMENT / 20 DATA, Fortinet
 * 10/20/30/999, and EXOS distribution ran the fabric-leaf config (AN9) — while `genVLANs('campus')` declared yet another, and the
 * non-Cisco distribution pairs addressed their SVIs from per-switch subnets,
 * so the FHRP VIP was never shared and VRRP could not form.
 */
import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, CAMPUS_VLANS } from '@/lib/configgen'
import { genVLANs, genIPRows } from '@/lib/ipam'
import { stripComments } from '@/lib/config-text'
import { validateConfigs } from '@/lib/config-validator'
import type { BOMDevice } from '@/types'

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Fortinet', 'HPE Aruba', 'Extreme Networks']

function build(vendor: string) {
  const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'AN7', vendorPrefs: [vendor] })
  return { devices, configs: generateAllConfigs(devices, 'campus', [], ['voice']) }
}

/** VLAN ids a config creates, across the five campus dialects. */
function vlansOf(cfg: string): Set<number> {
  const c = stripComments(cfg)
  const ids = new Set<number>()
  for (const m of c.matchAll(/^vlan (\d+)\s*$/gm)) ids.add(Number(m[1]))            // IOS / EOS / AOS-CX
  for (const m of c.matchAll(/^set vlans \S+ vlan-id (\d+)/gm)) ids.add(Number(m[1])) // Junos
  for (const m of c.matchAll(/^create vlan \S+ tag (\d+)/gm)) ids.add(Number(m[1]))    // EXOS
  const forti = /config switch vlan\n([\s\S]*?)\nend/.exec(c)                        // FortiSwitchOS
  if (forti) for (const m of forti[1].matchAll(/^\s+edit (\d+)/gm)) ids.add(Number(m[1]))
  return ids
}

/** Address + FHRP VIP of a distribution switch's management SVI. */
function mgmtSvi(cfg: string): { ip?: string, vip?: string } {
  const c = stripComments(cfg)
  const ip = /\b(10\.255\.99\.\d+)(?:\/24| 255\.255\.255\.0)/.exec(c)?.[1]
  const vip = /(?:standby \d+ ip|virtual-router address|virtual-address|address|vrip|vrid \d+ add) (10\.255\.99\.254)\b/.exec(c)?.[1]
  return { ip, vip }
}

const campusSwitches = (devices: BOMDevice[]) =>
  devices.filter(d => d.subLayer === 'distribution' || d.subLayer === 'access')

/**
 * Whether a config carries an address as a live allocation. Comments do not
 * count (Z6) — with one exception: a Firepower's data interfaces are managed
 * by FMC, so the generator states them in the FMC manifest as `ip=<addr>/<len>`
 * entries. That structured form counts; a next-hop mentioned in prose does not.
 */
function carries(cfg: string, layer: string, ip: string): boolean {
  if (stripComments(cfg).includes(ip)) return true
  return layer === 'Firewall' && cfg.includes(`ip=${ip}/`)
}

describe('campus VLAN plan (AN7)', () => {
  const planned = new Set(genVLANs('campus').map(v => v.id))

  it('the IPAM plan is the config engine constant', () => {
    expect([...planned].sort((a, b) => a - b)).toEqual(
      [CAMPUS_VLANS.data.id, CAMPUS_VLANS.voice.id, CAMPUS_VLANS.mgmt.id].sort((a, b) => a - b))
  })

  it.each(VENDORS)('%s creates exactly the planned VLANs on every switch', vendor => {
    const { devices, configs } = build(vendor)
    const sw = campusSwitches(devices)
    expect(sw.length).toBeGreaterThan(2)
    for (const d of sw) {
      const ids = vlansOf(configs[d.id])
      expect(ids.size, `${d.hostname}: parser found no VLANs`).toBeGreaterThan(0)
      expect([...ids].filter(i => !planned.has(i)), `${d.hostname} creates VLANs the plan does not declare`).toEqual([])
      for (const need of [CAMPUS_VLANS.data.id, CAMPUS_VLANS.voice.id, CAMPUS_VLANS.mgmt.id]) {
        expect(ids.has(need), `${d.hostname} lacks VLAN ${need}`).toBe(true)
      }
    }
  })

  it.each(VENDORS)('%s distribution pair shares the management subnet and VIP', vendor => {
    const { devices, configs } = build(vendor)
    const dist = devices.filter(d => d.subLayer === 'distribution')
    expect(dist.length).toBeGreaterThanOrEqual(2)
    const ips = new Set<string>()
    for (const d of dist) {
      const { ip, vip } = mgmtSvi(configs[d.id])
      expect(ip, `${d.hostname}: no mgmt SVI in ${CAMPUS_VLANS.mgmt.subnet}`).toBeDefined()
      expect(vip, `${d.hostname}: FHRP VIP is not ${CAMPUS_VLANS.mgmt.vip}`).toBe(CAMPUS_VLANS.mgmt.vip)
      ips.add(ip!)
    }
    expect(ips.size, 'two distribution switches share one address').toBe(dist.length)
  })

  it.each(VENDORS)('%s switches carry the addresses the IPAM rows assign', vendor => {
    const { devices, configs } = build(vendor)
    const byHost = new Map(devices.map(d => [d.hostname, configs[d.id] ?? '']))
    const wrong: string[] = []
    for (const row of genIPRows('campus', devices)) {
      const cfg = byHost.get(row.device)
      if (!cfg || row.ip.includes('–')) continue
      // Switch rows only: the campus firewall handoff is configured by Cisco
      // distribution alone today, tracked separately as AN8.
      if (row.layer !== 'Distribution' && row.layer !== 'Access') continue
      if (!carries(cfg, row.layer, row.ip)) wrong.push(`${row.device} ${row.iface}: ${row.ip}`)
    }
    expect(wrong).toEqual([])
  })

  it.each(VENDORS)('%s uses no address from the VTEP block or a per-switch /16', vendor => {
    const { devices, configs } = build(vendor)
    for (const d of campusSwitches(devices)) {
      const c = stripComments(configs[d.id])
      expect(c, `${d.hostname}`).not.toMatch(/\b10\.254\.\d+\.\d+/)
      expect(c, `${d.hostname}`).not.toMatch(/\b10\.(1\d|100|200)\.\d+\.\d+/)
    }
  })

  // AN12: FortiSwitch distribution set an OSPF router-id that no interface
  // carried. Every routing campus switch must own a loopback.
  it.each(VENDORS)('%s campus routers all carry a loopback (V-12)', vendor => {
    const { devices, configs } = build(vendor)
    const v12 = validateConfigs({ configs, devices, useCase: 'campus' }).checks.find(c => c.id === 'V-12')
    expect(v12?.severity, v12?.detail).toBe('pass')
  })

  it('the VLAN parser catches a VLAN outside the plan (mutation guard)', () => {
    const { devices, configs } = build('Arista')
    const d = campusSwitches(devices)[0]
    const bad = vlansOf(configs[d.id].replace(/^vlan 10$/m, 'vlan 100'))
    expect([...bad].some(i => !planned.has(i))).toBe(true)
  })
})
