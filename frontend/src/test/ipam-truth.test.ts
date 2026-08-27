/**
 * The IPAM export must describe the network the configs actually build (AF3).
 *
 * `genIPBlocks` was authored independently of the generators, so the artifact
 * whose entire purpose is to be the source of truth contradicted the running
 * config on every documented block — and declared `10.100.0.0/23` as P2P
 * fabric, which is the supernet reserved for loopback overflow. A customer
 * importing that into NetBox gets an IPAM that will hand out addresses their
 * own devices are already using.
 *
 * The invariant below is the thing that keeps the two together: every address
 * a generated config contains must fall inside a prefix the export declares.
 */
import { describe, it, expect } from 'vitest'
import type { UseCase } from '@/types'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs, ADDRESS_PLAN } from '@/lib/configgen'
import { genIPBlocks, genIPRows } from '@/lib/ipam'

function ipToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
}

function inPrefix(ip: string, cidr: string): boolean {
  const [net, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipToInt(ip) & mask) === (ipToInt(net) & mask)
}

/** Private-range IPv4 literals in a config, minus the ones we do not plan. */
function addressesIn(cfg: string): string[] {
  const found = new Set<string>()
  for (const m of cfg.matchAll(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g)) {
    // Comment lines are documentation, not allocation (Z6).
    found.add(m[0])
  }
  return [...found]
}

const stripComments = (cfg: string) =>
  cfg.split('\n').filter(l => !/^\s*[!#]/.test(l)).join('\n')

const design = (useCase: UseCase, endpoints = 512) => {
  const state = {
    useCase, scale: 'medium' as const, siteCode: 'AF3',
    totalEndpoints: endpoints, numSites: 2,
    bandwidthPerServer: '25G', oversubscription: 3,
  }
  const devices = buildDeviceList(state)
  return {
    devices,
    configs: generateAllConfigs(devices, useCase),
    blocks: genIPBlocks(useCase, endpoints, 2, devices),
  }
}

describe('IPAM export vs generated configs (AF3)', () => {
  const CASES: UseCase[] = ['dc', 'gpu', 'campus', 'wan', 'multisite', 'oran']

  it('declares no prefix that overlaps the reserved overflow supernet', () => {
    // `10.100.0.0/14` is handed out to role loopbacks past the 254th device.
    // An IPAM that also calls it P2P fabric will double-allocate it.
    const reserved = ADDRESS_PLAN.find(r => r.label === 'ROLE OVERFLOW')!
    for (const useCase of CASES) {
      for (const b of design(useCase).blocks) {
        if (b.label === reserved.label) continue
        const net = b.subnet.split('/')[0]
        expect(
          inPrefix(net, reserved.prefix),
          `${useCase}: block "${b.label}" (${b.subnet}) sits inside the reserved ${reserved.prefix}`,
        ).toBe(false)
      }
    }
  })

  it('covers every address the generated configs actually use', () => {
    const misses: string[] = []
    for (const useCase of CASES) {
      const { configs, blocks } = design(useCase)
      const declared = blocks.map(b => b.subnet)
      for (const [id, cfg] of Object.entries(configs)) {
        for (const ip of addressesIn(stripComments(cfg))) {
          if (!declared.some(p => inPrefix(ip, p))) {
            misses.push(`${useCase}/${id}: ${ip} is in no declared prefix`)
          }
        }
      }
    }
    // Report a bounded sample — an undeclared /16 produces thousands.
    expect(misses.slice(0, 12), `${misses.length} undeclared addresses`).toEqual([])
  })

  it('allocates each device the address its own config actually carries', () => {
    // The strongest form: not "in some declared block" but "this exact string
    // appears in that device's config". The per-device table used to invent a
    // firewall loopback in 10.0.0.0/24 that no generator emits, and a leaf
    // "VTEP" at 10.255.3.x — which is the CAMPUS loopback range.
    const wrong: string[] = []
    for (const useCase of ['dc', 'campus'] as UseCase[]) {
      const { devices, configs } = design(useCase)
      const byHost = new Map(devices.map(d => [d.hostname, configs[d.id] ?? '']))
      for (const row of genIPRows(useCase, devices)) {
        const cfg = byHost.get(row.device)
        // Summary rows ("… +N more") and ranges are not single allocations.
        if (!cfg || row.ip.includes('–')) continue
        if (!cfg.includes(row.ip)) {
          wrong.push(`${useCase}/${row.device} ${row.iface}: plan says ${row.ip}, config does not contain it`)
        }
      }
    }
    expect(wrong.slice(0, 10), `${wrong.length} devices disagree with the plan`).toEqual([])
  })

  it('never gives two devices the same management address', () => {
    // Found by the plan-vs-config check above: distribution and access both
    // addressed the mgmt SVI from one /24, each indexed from 0 within its own
    // tier, so DIST-A01 and ACC-A01 were both 10.255.99.1 — two devices
    // fighting for one address in every campus design ever generated.
    const { devices, configs } = design('campus', 500)
    const owners = new Map<string, string[]>()
    for (const d of devices) {
      const m = /interface Vlan99[\s\S]{0,120}?ip address (\S+)/.exec(configs[d.id] ?? '')
      if (!m) continue
      owners.set(m[1], [...(owners.get(m[1]) ?? []), d.hostname])
    }
    expect(owners.size, 'no device configured a mgmt SVI').toBeGreaterThan(2)
    const dupes = [...owners].filter(([, hosts]) => hosts.length > 1)
      .map(([ip, hosts]) => `${ip} claimed by ${hosts.join(' and ')}`)
    expect(dupes).toEqual([])
  })

  it('declares each plan range exactly once, with no self-overlap', () => {
    for (let i = 0; i < ADDRESS_PLAN.length; i++) {
      for (let j = i + 1; j < ADDRESS_PLAN.length; j++) {
        const a = ADDRESS_PLAN[i], b = ADDRESS_PLAN[j]
        const overlap = inPrefix(a.prefix.split('/')[0], b.prefix)
          || inPrefix(b.prefix.split('/')[0], a.prefix)
        expect(overlap, `${a.label} ${a.prefix} overlaps ${b.label} ${b.prefix}`).toBe(false)
      }
    }
  })
})
