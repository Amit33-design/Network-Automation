import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { ztpPlatform } from '@/lib/ztp'
import {
  NETCONF_PROFILES,
  NON_NETCONF_PLATFORMS,
  buildNetconfRpc,
  netconfAlternative,
  netconfCoverage,
  netconfOps,
  netconfProfile,
  netconfSupported,
} from '@/lib/netconf'
import type { BOMDevice } from '@/types'

function dev(partial: Partial<BOMDevice>): BOMDevice {
  return {
    id: 'd1', hostname: 'TEST-01', role: 'leaf', subLayer: 'leaf',
    model: 'm', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
    speed: '', ports: 0, features: [], ...partial,
  }
}

describe('NETCONF capability (AK1)', () => {
  it('does not offer NETCONF to platforms with no NETCONF server', () => {
    // Measured before AK1: an NVIDIA DC design offered it on 12 of 14 Cumulus
    // boxes and a Fortinet campus design on 18 of 18 — every one producing a
    // Cisco-flavoured ietf-interfaces RPC that can never run.
    for (const vendor of ['NVIDIA', 'Fortinet', 'Palo Alto', 'Extreme Networks', 'HPE Aruba']) {
      const d = dev({ vendor: vendor as never })
      expect(netconfSupported(d), vendor).toBe(false)
      const alt = netconfAlternative(d)
      expect(alt, `${vendor} must say what it speaks instead`).toBeTruthy()
      expect(alt!.instead.length).toBeGreaterThan(0)
    }
  })

  it('offers it to the platforms that do run one', () => {
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'Dell EMC']) {
      expect(netconfSupported(dev({ vendor: vendor as never })), vendor).toBe(true)
    }
  })

  it('every catalogue platform is either profiled or has a stated alternative', () => {
    // A platform in neither map would silently fall through as "unsupported,
    // reason unknown" — the gap this module exists to close.
    const vendors = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC',
      'Extreme Networks', 'HPE Aruba', 'Fortinet', 'Palo Alto']
    for (const vendor of vendors) {
      const plat = ztpPlatform(dev({ vendor: vendor as never }))
      const known = plat in NETCONF_PROFILES || plat in NON_NETCONF_PLATFORMS
      expect(known, `${vendor} → ${plat} is in neither map`).toBe(true)
    }
  })

  it('NX-OS exposes running only, and offers no commit', () => {
    // NX-OS has no candidate datastore; the dropdown used to offer it on every
    // device, so selecting it returned an RPC error.
    const p = NETCONF_PROFILES.nxos!
    expect(p.datastores).toEqual(['running'])
    expect(p.needsCommit).toBe(false)
    expect(netconfOps(p)).not.toContain('commit')
    // and asking for candidate anyway falls back rather than emitting it
    expect(buildNetconfRpc('get-config', 'candidate', p)).toContain('<running/>')
  })

  it('offers commit exactly where a candidate is committed', () => {
    for (const [plat, p] of Object.entries(NETCONF_PROFILES)) {
      const ops = netconfOps(p!)
      expect(ops.includes('commit'), plat).toBe(p!.needsCommit)
      if (p!.needsCommit) {
        expect(p!.datastores, `${plat} commits but has no candidate`).toContain('candidate')
      }
    }
  })

  it('uses each platform its own YANG model and a real interface name', () => {
    // Before AK1 only edit-config branched on Juniper, so a Juniper get-config
    // asked for ietf-interfaces while its own edit used the xnm model — the
    // panel disagreed with itself — and every other platform got
    // `GigabitEthernet1`, an interface name none of them have.
    const cases: Array<[keyof typeof NETCONF_PROFILES, string, string]> = [
      ['junos', 'xml.juniper.net/xnm', 'ge-0/0/0'],
      ['eos', 'openconfig.net/yang/interfaces', 'Ethernet1'],
      ['srl', 'nokia.com:srlinux', 'ethernet-1/1'],
      ['nxos', 'ietf-interfaces', 'Ethernet1/1'],
    ]
    for (const [plat, ns, iface] of cases) {
      const p = NETCONF_PROFILES[plat]!
      const edit = buildNetconfRpc('edit-config', p.datastores[0], p)
      expect(edit, `${plat} edit namespace`).toContain(ns)
      expect(edit, `${plat} edit iface`).toContain(iface)
      // get-config must use the SAME model as edit-config
      expect(buildNetconfRpc('get-config', p.datastores[0], p), `${plat} get namespace`).toContain(ns)
    }
  })

  it('never emits a Cisco interface name on a non-Cisco platform', () => {
    for (const [plat, p] of Object.entries(NETCONF_PROFILES)) {
      if (plat.startsWith('ios') || plat === 'nxos' || plat === 'iosxr') continue
      for (const op of netconfOps(p!)) {
        expect(buildNetconfRpc(op, p!.datastores[0], p!), `${plat}/${op}`)
          .not.toMatch(/GigabitEthernet/)
      }
    }
  })

  it('produces well-formed XML for every platform and operation', () => {
    // Parsed rather than regex-counted: a hand-rolled tag-balance check trips
    // over the `/` in namespace URLs and reports nonsense.
    const parser = new DOMParser()
    for (const [plat, p] of Object.entries(NETCONF_PROFILES)) {
      for (const op of netconfOps(p!)) {
        for (const ds of p!.datastores) {
          const xml = buildNetconfRpc(op, ds, p!)
          const doc = parser.parseFromString(xml, 'application/xml')
          expect(doc.querySelector('parsererror'), `${plat}/${op}/${ds} is not well-formed`).toBeNull()
          expect(doc.documentElement.nodeName, `${plat}/${op}`).toBe('rpc')
        }
      }
    }
  })

  it('guard: the well-formedness check can actually fail', () => {
    // Otherwise a parser that never reports an error would pass everything.
    const doc = new DOMParser().parseFromString('<rpc><unclosed></rpc>', 'application/xml')
    expect(doc.querySelector('parsererror')).not.toBeNull()
  })

  it('counts coverage against a real BOM and names the alternatives', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Fortinet'] })
    const cov = netconfCoverage(devices)
    expect(devices.length).toBeGreaterThan(0)
    expect(cov.supported).toEqual([])
    expect(cov.unsupported.length).toBe(devices.length)
    expect(cov.alternatives.join(' ')).toMatch(/FortiOS REST API/)
  })

  it('splits a mixed fleet correctly', () => {
    const devices = [
      dev({ id: 'a', hostname: 'LEAF-01', vendor: 'Cisco', model: 'Nexus 9336C' }),
      dev({ id: 'b', hostname: 'CUM-01', vendor: 'NVIDIA' }),
      dev({ id: 'c', hostname: 'FW-01', vendor: 'Palo Alto', subLayer: 'firewall' }),
    ]
    const cov = netconfCoverage(devices)
    expect(cov.supported.map(d => d.hostname)).toEqual(['LEAF-01'])
    expect(cov.unsupported.map(d => d.hostname)).toEqual(['CUM-01', 'FW-01'])
    expect(cov.alternatives.length).toBe(2)
  })

  it('resolves Cisco by model, not by vendor alone', () => {
    // ztpPlatform is the single vendor map (AG5/AG6/AG10); a Catalyst is
    // IOS-XE and a Nexus is NX-OS, and their datastore support differs.
    const nexus = netconfProfile(dev({ vendor: 'Cisco', model: 'Nexus 9336C-FX2' }))!
    const cat = netconfProfile(dev({ vendor: 'Cisco', model: 'Catalyst 9300L' }))!
    expect(nexus.label).toMatch(/NX-OS/)
    expect(cat.label).toMatch(/IOS-XE/)
    expect(nexus.datastores).not.toEqual(cat.datastores)
  })
})
