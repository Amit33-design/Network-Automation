import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, generateConfig } from '@/lib/configgen'
import { factPlatform, type FactPlatform } from '@/lib/config-facts'
import { stripComments } from '@/lib/config-text'
import type { BOMDevice } from '@/types'

/**
 * AM3 — every interface a config SOURCES a service from must be one that
 * config defines. Found by measurement, not by review: the IOS-XE access
 * switch sourced NTP/syslog from a Loopback0 it never created, the ISR
 * firewall and WAN router sourced everything from a Vlan10 and a Loopback0
 * they never created (and configured NTP twice, once from each), the Arista
 * campus switch sourced from an undefined Vlan10, and the O-RAN fronthaul
 * sourced SSH from an undefined mgmt0.
 *
 * Scoped to the dialects where `interface X` IS the definition. Junos
 * (`set interfaces`), EXOS (`create vlan`), SR Linux and NVUE declare
 * interfaces differently and are not parsed here.
 */
const IOS_SHAPED = new Set<FactPlatform>(['nxos', 'ios-xe', 'iosxr', 'eos', 'dellos10', 'arubaoscx'])

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/** Interfaces the config sources from, with any `vrf NAME` skipped. */
function sourcedInterfaces(live: string): string[] {
  const out: string[] = []
  const re = /(?:source-interface|ntp source|update-source)\s+(?:vrf\s+\S+\s+)?([A-Za-z][\w/.-]*(?:\s+\d[\w/.]*)?)/gi
  for (const m of live.matchAll(re)) out.push(norm(m[1]))
  return out
}

function definedInterfaces(live: string): Set<string> {
  return new Set([...live.matchAll(/^\s*interface\s+([A-Za-z][\w/.-]*(?:\s+\d[\w/.]*)?)/gmi)].map(m => norm(m[1])))
}

function undefinedSources(cfg: string): string[] {
  const live = stripComments(cfg)
  const defined = definedInterfaces(live)
  return sourcedInterfaces(live).filter(i => !defined.has(i))
}

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC',
  'Extreme Networks', 'Fortinet', 'Palo Alto', 'HPE Aruba']
const USE_CASES = ['dc', 'gpu', 'campus', 'wan', 'multisite', 'multicloud', 'oran'] as const

describe('source interfaces are defined (AM3)', () => {
  it('guard: the parser finds sources and definitions it should', () => {
    // A parser that matched nothing would pass every config vacuously.
    const cfg = 'interface Loopback0\nntp source Loopback0\nlogging vrf MGMT source-interface Management1\nupdate-source loopback 0'
    expect(sourcedInterfaces(cfg)).toEqual(['loopback0', 'management1', 'loopback0'])
    expect(undefinedSources(cfg)).toEqual(['management1'])
  })

  it('no generated IOS-shaped config sources from an interface it does not define', () => {
    const bad: string[] = []
    for (const vendor of VENDORS) for (const uc of USE_CASES) {
      const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const cfgs = generateAllConfigs(devs, uc)
      for (const d of devs) {
        if (!cfgs[d.id] || !IOS_SHAPED.has(factPlatform(d))) continue
        const missing = undefinedSources(cfgs[d.id])
        if (missing.length) bad.push(`${vendor}/${uc} ${d.hostname} (${d.model}): ${[...new Set(missing)].join(', ')}`)
      }
    }
    expect([...new Set(bad)].slice(0, 10)).toEqual([])
  })

  it('the IOS-XE routers that use mgmtBlock source from a loopback they define, once', () => {
    const dev = (p: Partial<BOMDevice>) => ({ id: 'x', hostname: 'R-01', role: 'r', subLayer: 'wan-edge',
      model: 'ASR 1001-X', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0, speed: '10G', ports: 8,
      features: [], ...p }) as BOMDevice
    for (const d of [dev({}), dev({ subLayer: 'firewall', model: 'ISR 4451' })]) {
      const live = stripComments(generateConfig(d, 0, 'wan'))
      expect(undefinedSources(live), d.model).toEqual([])
      // NTP was configured twice, from two different interfaces.
      expect(live.match(/^ntp source /gm), d.model).toHaveLength(1)
      expect(live.match(/^logging source-interface /gm), d.model).toHaveLength(1)
      expect(live).not.toMatch(/8\.8\.8\.8/)
    }
  })

  it('Arista campus uses the EOS management plane, not IOS-XE', () => {
    const devs = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Arista'] })
    const cfgs = generateAllConfigs(devs, 'campus')
    const eos = devs.filter(d => d.vendor === 'Arista')
    expect(eos.length).toBeGreaterThan(0)
    for (const d of eos) {
      const live = stripComments(cfgs[d.id])
      // IOS-XE statements EOS rejects.
      expect(live, d.hostname).not.toMatch(/^aaa new-model|^tacacs server |^ip http secure-server|^login block-for|^service password-encryption/m)
      expect(live, d.hostname).toMatch(/^tacacs-server host \S+ vrf MGMT/m)
      expect(live.match(/^hostname /gm), d.hostname).toHaveLength(1)
    }
  })
})
