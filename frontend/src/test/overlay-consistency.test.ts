import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'
import { TENANT_OVERLAY } from '@/lib/configgen'
import { genVNIs } from '@/lib/ipam'
/** Overlay parameters every leaf of a fabric must agree on, per dialect. */
const X: Record<string, (c: string) => Record<string, string>> = {
  Cisco: c => ({
    vlanVni: [...c.matchAll(/^vlan (\d+)\n\s+vn-segment (\d+)/gm)].map(m => `${m[1]}=${m[2]}`).sort().join(','),
    rts: [...c.matchAll(/route-target (?:import|export|both) (\S+)/g)].map(m => m[1]).sort().join(','),
    agwMac: c.match(/anycast-gateway-mac (\S+)/)?.[1] ?? '',
    l3vni: c.match(/^vrf context \S+\n\s+vni (\d+)/m)?.[1] ?? '',
  }),
  Arista: c => ({
    vlanVni: [...c.matchAll(/vxlan vlan (\d+) vni (\d+)/g)].map(m => `${m[1]}=${m[2]}`).sort().join(','),
    rts: [...c.matchAll(/route-target (?:import|export|both)(?: evpn)? (\S+)/g)].map(m => m[1]).sort().join(','),
    agwMac: c.match(/ip virtual-router mac-address (\S+)/)?.[1] ?? '',
    l3vni: c.match(/vxlan vrf \S+ vni (\d+)/)?.[1] ?? '',
  }),
  Juniper: c => ({
    vlanVni: [...c.matchAll(/set vlans \S+ vlan-id (\d+)[\s\S]*?set vlans \S+ vxlan vni (\d+)/g)].map(m => `${m[1]}=${m[2]}`).sort().join(','),
    rts: [...c.matchAll(/vrf-target (?:target:)?(\S+)/g)].map(m => m[1]).sort().join(','),
    agwMac: c.match(/virtual-gateway-v4-mac (\S+)/)?.[1] ?? '',
    l3vni: c.match(/ip-prefix-routes vni (\d+)/)?.[1] ?? '',
  }),
  Nokia: c => ({
    vlanVni: [...c.matchAll(/vni (\d+)/g)].map(m => m[1]).sort().join(','),
    rts: [...c.matchAll(/(?:export|import)-rt target:(\S+)/g)].map(m => m[1]).sort().join(','),
    agwMac: '', l3vni: '',
  }),
  'Dell EMC': c => ({ vlanVni: [...c.matchAll(/vxlan-vni (\d+)/g)].map(m => m[1]).join(','), rts: [...c.matchAll(/route-target (\S+)/g)].map(m => m[1]).sort().join(','), agwMac: '', l3vni: '' }),
  'Extreme Networks': c => ({ vlanVni: [...c.matchAll(/vxlan vni (\d+)/g)].map(m => m[1]).join(','), rts: '', agwMac: '', l3vni: '' }),
  'HPE Aruba': c => ({ vlanVni: [...c.matchAll(/vni (\d+)\n\s+vlan (\d+)/g)].map(m => `${m[2]}=${m[1]}`).join(','), rts: [...c.matchAll(/route-target (?:import|export) (\S+)/g)].map(m => m[1]).sort().join(','), agwMac: '', l3vni: '' }),
}

/**
 * AN5 — every leaf in an EVPN fabric must agree on its overlay: VLAN↔VNI,
 * route-targets, L3VNI and anycast-gateway MAC, and the route-targets must be
 * EXPLICIT. Auto RTs derive from the local AS, and each leaf pair has its own
 * AS (Z5/Z8), so auto RTs meant no leaf imported another pair's routes — the
 * defect Y1 fixed for NX-OS, found here still open on Nokia and Dell.
 * Extreme EXOS is excluded: its RT command is unverified (AM8).
 */
function disagreements(vendor: string, cfgs: Record<string, string>, leaves: { id: string; hostname: string }[]) {
  const vals: Record<string, Set<string>> = {}
  for (const l of leaves) for (const [k, v] of Object.entries(X[vendor](stripComments(cfgs[l.id])))) (vals[k] ??= new Set()).add(v)
  return Object.entries(vals).filter(([, s]) => s.size > 1).map(([k]) => k)
}

const EXPLICIT_RT = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'Dell EMC', 'HPE Aruba']

describe('EVPN overlay is consistent across leaves, with explicit route-targets (AN5)', () => {
  for (const vendor of EXPLICIT_RT) for (const uc of ['dc', 'multisite'] as const) {
    it(`${vendor} ${uc}`, () => {
      const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const cfgs = generateAllConfigs(devs, uc)
      const leaves = devs.filter(d => d.subLayer === 'leaf' && cfgs[d.id])
      expect(leaves.length).toBeGreaterThan(1)
      expect(disagreements(vendor, cfgs, leaves)).toEqual([])
      for (const l of leaves) {
        const live = stripComments(cfgs[l.id])
        expect(live, `${vendor} ${l.hostname}: no explicit route-target`).toMatch(/\b(?:target:)?6[0-9]{4}:\d+\b/)
        expect(live, `${vendor} ${l.hostname}: auto route-target`).not.toMatch(/vrf-target auto|route-target (?:both |import |export )?auto\b/)
      }
    })
  }

  it('Juniper multisite sets its DCI L3 RT on the real tenant VRF', () => {
    const devs = buildDeviceList({ useCase: 'multisite', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'] })
    const cfgs = generateAllConfigs(devs, 'multisite')
    const leaf = devs.find(d => d.subLayer === 'leaf')!
    expect(cfgs[leaf.id]).not.toMatch(/routing-instances EVPN-L3/)
    expect(cfgs[leaf.id]).toMatch(/set routing-instances TENANT-A vrf-export TENANT-A-EXPORT/)
  })

  it('guard: one leaf with a different route-target is caught', () => {
    const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Nokia'] })
    const cfgs = generateAllConfigs(devs, 'dc')
    const leaves = devs.filter(d => d.subLayer === 'leaf')
    cfgs[leaves[0].id] = cfgs[leaves[0].id].replace(/target:65000:10010/g, 'target:65001:10010')
    expect(disagreements('Nokia', cfgs, leaves)).toContain('rts')
  })

  it('AN6: every fabric vendor runs the same tenant overlay as the IPAM plan', () => {
    for (const vendor of [...EXPLICIT_RT, 'Extreme Networks']) {
      const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const cfgs = generateAllConfigs(devs, 'dc')
      for (const l of devs.filter(d => d.subLayer === 'leaf')) {
        const live = stripComments(cfgs[l.id])
        expect(live, `${vendor} ${l.hostname}`).toMatch(new RegExp(`\\b${TENANT_OVERLAY.l2vni}\\b`))
        expect(live, `${vendor} ${l.hostname}: old VNI`).not.toMatch(/\b10001\b/)
      }
    }
    expect(genVNIs().map(v => v.vni)).toEqual([TENANT_OVERLAY.l2vni, TENANT_OVERLAY.l3vni])
  })
})

