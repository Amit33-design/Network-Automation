/**
 * Every DC leaf pair multihomes servers (AP5).
 *
 * Leaves come in pairs (Z5 pair ASN), but measured on generated designs only
 * Cisco (vPC), Arista (MLAG) and Juniper (ESI-LAG) configured anything that
 * lets one server attach to both leaves of a pair. Dell OS10, Extreme EXOS,
 * HPE Aruba, Nokia SR Linux and NVIDIA Cumulus pairs shared an ASN and nothing
 * else, so a dual-homed server had no multihoming at all.
 *
 * Each vendor now uses the method its own documentation describes: Dell VLT
 * and Extreme MLAG (each with a shared VTEP address, as both vendors require),
 * and EVPN Ethernet segments on Aruba, Nokia and NVIDIA.
 */
import { describe, it, expect } from 'vitest'
import type { UseCase } from '@/types'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

function leaves(vendor: string, useCase: UseCase = 'dc') {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AP5', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, useCase)
  const ls = devices.filter(d => d.subLayer === 'leaf' && d.vendor === vendor)
  return ls.map(d => ({ host: d.hostname, cfg: stripComments(configs[d.id]) }))
}

/** The construct each dialect uses to put one server on two leaves. */
const MULTIHOMING: Record<string, RegExp> = {
  Cisco: /^\s*vpc peer-link/m,
  Arista: /^mlag configuration/m,
  Juniper: /^set interfaces ae\d+ esi \S+/m,
  'Dell EMC': /^\s*vlt-port-channel \d+/m,
  'Extreme Networks': /^enable mlag port \d+ peer /m,
  'HPE Aruba': /^\s*evpn-ethernet-segment esi type-0 \S+/m,
  Nokia: /^\s*multi-homing-mode all-active/m,
  NVIDIA: /^nv set interface bond\d+ evpn multihoming segment mac-address \S+/m,
}

/** What the two members of a pair must share for the server to see one partner. */
const SHARED: Record<string, (cfg: string) => string[]> = {
  'Dell EMC': c => [
    c.match(/^vlt-domain (\d+)/m)?.[1] ?? '',
    c.match(/^\s*vlt-mac (\S+)/m)?.[1] ?? '',
    c.match(/interface loopback 1\n(?:.*\n)*?\s+ip address (\S+)/)?.[1] ?? '',
  ],
  'Extreme Networks': c => [
    c.match(/^configure virtual-network local-endpoint ipaddress (\S+)/m)?.[1] ?? '',
    c.match(/^configure mlag peer "\S+" lacp-mac (\S+)/m)?.[1] ?? '',
  ],
  'HPE Aruba': c => [c.match(/evpn-ethernet-segment esi type-0 (\S+)/)?.[1] ?? ''],
  Nokia: c => [c.match(/^\s*esi (\S+)/m)?.[1] ?? '', c.match(/system-id-mac (\S+)/)?.[1] ?? ''],
  NVIDIA: c => [
    c.match(/evpn multihoming segment mac-address (\S+)/)?.[1] ?? '',
    c.match(/evpn multihoming segment local-id (\d+)/)?.[1] ?? '',
  ],
}

describe('every DC leaf pair multihomes servers (AP5)', () => {
  it.each(Object.keys(MULTIHOMING))('%s: every leaf configures its multihoming construct', vendor => {
    const ls = leaves(vendor)
    expect(ls.length).toBeGreaterThan(1)
    for (const l of ls) expect(l.cfg, `${l.host} has no multihoming`).toMatch(MULTIHOMING[vendor])
  })

  it.each(Object.keys(SHARED))('%s: both members of a pair share one identity, and pairs differ', vendor => {
    const ls = leaves(vendor)
    const ids = ls.map(l => SHARED[vendor](l.cfg))
    for (const id of ids) for (const v of id) expect(v, `${vendor} identity not found`).not.toBe('')
    const seen = new Set<string>()
    for (let i = 0; i + 1 < ids.length; i += 2) {
      expect(ids[i + 1], `${ls[i].host} / ${ls[i + 1].host}`).toEqual(ids[i])
      const key = ids[i].join('|')
      expect(seen.has(key), `pair ${ls[i].host} reuses another pair's identity`).toBe(false)
      seen.add(key)
    }
  })

  it.each(['Dell EMC', 'Extreme Networks'])('%s: the pair sources VXLAN from its shared address and peers with each other', vendor => {
    const ls = leaves(vendor)
    for (let i = 0; i + 1 < ls.length; i += 2) {
      const [a, b] = [ls[i], ls[i + 1]]
      if (vendor === 'Dell EMC') {
        for (const x of [a, b]) expect(x.cfg).toMatch(/^nve\n\s+source-interface loopback 1/m)
        const vlanIp = (c: string) => c.match(/interface vlan3999\n(?:.*\n)*?\s+ip address (\S+)\/31/)?.[1]
        const peerOf = (c: string) => c.match(/neighbor (\S+)\n\s+description VLT-PEER/)?.[1]
        expect(peerOf(a.cfg)).toBe(vlanIp(b.cfg))
        expect(peerOf(b.cfg)).toBe(vlanIp(a.cfg))
        expect(a.cfg).toMatch(new RegExp(`backup destination <CHANGE-ME-${b.host.toLowerCase()}-mgmt-ip>`))
      } else {
        const iscIp = (c: string) => c.match(/^configure vlan ISC ipaddress (\S+)/m)?.[1]
        const mlagPeer = (c: string) => c.match(/^configure mlag peer "(\S+)" ipaddress (\S+)/m)
        expect(mlagPeer(a.cfg)?.[1]).toBe(b.host)
        expect(mlagPeer(a.cfg)?.[2]).toBe(iscIp(b.cfg))
        expect(mlagPeer(b.cfg)?.[2]).toBe(iscIp(a.cfg))
        expect(a.cfg).toMatch(new RegExp(`^create bgp neighbor ${iscIp(b.cfg)!.replace(/\./g, '\\.')} remote-AS-number`, 'm'))
      }
    }
  })

  it('NVIDIA GPU fabrics route to the host, so they carry no Ethernet segment', () => {
    for (const l of leaves('NVIDIA', 'gpu')) expect(l.cfg).not.toMatch(/evpn multihoming/)
  })
})
