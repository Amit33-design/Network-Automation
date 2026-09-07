import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import {
  POLICY_CATALOG,
  applicablePolicies,
  applyPolicies,
  policyByCategory,
  policyCoverage,
  POLICY_CATEGORIES,
} from '@/lib/policies'
import type { BOMDevice } from '@/types'

function dev(partial: Partial<BOMDevice>): BOMDevice {
  return {
    id: 'd1', hostname: 'TEST-01', role: 'leaf', subLayer: 'leaf',
    model: 'm', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
    speed: '', ports: 0, features: [], ...partial,
  }
}

describe('policy catalog', () => {
  it('has a rich, categorized catalog (>= 18 policies across 5 categories)', () => {
    expect(POLICY_CATALOG.length).toBeGreaterThanOrEqual(18)
    const cats = new Set(POLICY_CATALOG.map(p => p.category))
    expect(cats.size).toBe(5)
    for (const c of POLICY_CATEGORIES) {
      expect((policyByCategory()[c] ?? []).length).toBeGreaterThan(0)
    }
  })

  it('every policy id is unique', () => {
    const ids = POLICY_CATALOG.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the key enterprise policies the user asked for', () => {
    const ids = new Set(POLICY_CATALOG.map(p => p.id))
    for (const id of ['bgp-policy', 'vlan-policy', 'voice', 'dot1x', 'qos', 'copp']) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('role-awareness', () => {
  it('802.1x and voice apply to access, not to spine', () => {
    const access = dev({ subLayer: 'access', role: 'access' })
    const spine  = dev({ subLayer: 'spine', role: 'spine' })
    const accessIds = applicablePolicies(access, 'campus', ['dot1x', 'voice']).map(p => p.id)
    const spineIds  = applicablePolicies(spine, 'campus', ['dot1x', 'voice']).map(p => p.id)
    expect(accessIds).toContain('dot1x')
    expect(accessIds).toContain('voice')
    expect(spineIds).not.toContain('dot1x')
    expect(spineIds).not.toContain('voice')
  })

  it('BGP policy applies to routing roles (leaf), not to access', () => {
    const leaf   = dev({ subLayer: 'leaf', role: 'leaf' })
    const access = dev({ subLayer: 'access', role: 'access' })
    expect(applicablePolicies(leaf, 'dc', ['bgp-policy']).map(p => p.id)).toContain('bgp-policy')
    expect(applicablePolicies(access, 'campus', ['bgp-policy']).map(p => p.id)).not.toContain('bgp-policy')
  })

  it('GPU QoS is suppressed (GPU base config owns RoCEv2 QoS)', () => {
    const leaf = dev({ subLayer: 'leaf', role: 'leaf' })
    expect(applicablePolicies(leaf, 'gpu', ['qos']).map(p => p.id)).not.toContain('qos')
    expect(applicablePolicies(leaf, 'dc', ['qos']).map(p => p.id)).toContain('qos')
  })
})

describe('applyPolicies output', () => {
  it('appends a POLICY OVERLAY section with per-policy headers', () => {
    const leaf = dev({ subLayer: 'leaf', role: 'leaf', vendor: 'Cisco' })
    const out = applyPolicies('hostname TEST-01\n', leaf, 'dc', ['bgp-policy', 'copp'])
    expect(out).toContain('POLICY OVERLAY')
    expect(out).toContain('! ====== POLICY: BGP ROUTE POLICY ======')
    expect(out).toContain('! ====== POLICY: CONTROL-PLANE POLICING (COPP) ======')
    expect(out).toContain('router bgp')
  })

  it('returns the base config unchanged when no policies selected', () => {
    const leaf = dev({ subLayer: 'leaf' })
    const base = 'hostname TEST-01\n'
    expect(applyPolicies(base, leaf, 'dc', [])).toBe(base)
  })

  it('does not add an overlay when none of the selected policies apply to the device', () => {
    const access = dev({ subLayer: 'access', role: 'access' })
    // bgp-policy never applies to access → no overlay header
    const out = applyPolicies('hostname A\n', access, 'campus', ['bgp-policy'])
    expect(out).not.toContain('POLICY OVERLAY')
  })
})

describe('generateAllConfigs policy integration', () => {
  it('injects selected policies into generated device configs', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const withPolicy = generateAllConfigs(devices, 'dc', ['ntp', 'bgp-policy'])
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    expect(withPolicy[leaf.id]).toContain('POLICY: NTP')
    expect(withPolicy[leaf.id]).toContain('POLICY: BGP ROUTE POLICY')
  })

  it('omitting policyBlocks keeps configs identical to the no-policy path', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const a = generateAllConfigs(devices, 'dc')
    const b = generateAllConfigs(devices, 'dc', [])
    expect(a).toEqual(b)
    // and no overlay leaked in
    for (const cfg of Object.values(a)) {
      expect(cfg).not.toContain('POLICY OVERLAY')
    }
  })
})

// ── AG7: coverage is stated, not silently skipped ────────────────────────────
describe('policyCoverage', () => {
  it('reports full coverage when every eligible device renders', () => {
    const devices = [dev({ id: 'a', vendor: 'Cisco' }), dev({ id: 'b', vendor: 'Cisco' })]
    const ntp = POLICY_CATALOG.find(p => p.id === 'ntp')!
    const cov = policyCoverage(ntp, devices, 'dc')
    expect(cov.eligible).toBe(2)
    expect(cov.covered).toBe(2)
    expect(cov.missingVendors).toEqual([])
  })

  it('names the vendors a policy has no template for', () => {
    const devices = [
      dev({ id: 'a', vendor: 'Cisco' }),
      dev({ id: 'b', vendor: 'Juniper' }),
      dev({ id: 'c', vendor: 'Nokia' }),
    ]
    // Find a policy that is Cisco-only for the leaf role — most are.
    const partial = POLICY_CATALOG.find(p => {
      const c = policyCoverage(p, devices, 'dc')
      return c.eligible === 3 && c.covered > 0 && c.covered < 3
    })
    expect(partial, 'expected at least one Cisco-only leaf policy').toBeTruthy()
    const cov = policyCoverage(partial!, devices, 'dc')
    expect(cov.missingVendors.length).toBeGreaterThan(0)
    // Every named vendor is one present in the design, and is not double-counted.
    for (const v of cov.missingVendors) expect(['Juniper', 'Nokia']).toContain(v)
    expect(new Set(cov.missingVendors).size).toBe(cov.missingVendors.length)
    // The arithmetic has to close: covered + (devices of missing vendors) = eligible
    expect(cov.covered).toBe(cov.eligible - devices.filter(d => cov.missingVendors.includes(d.vendor)).length)
  })

  it('reports zero eligible when the policy does not apply to this use case', () => {
    const scoped = POLICY_CATALOG.find(p => p.useCases && p.useCases.length && !p.useCases.includes('gpu'))
    expect(scoped, 'expected at least one use-case-scoped policy').toBeTruthy()
    const cov = policyCoverage(scoped!, [dev({ vendor: 'Cisco' })], 'gpu')
    expect(cov.eligible).toBe(0)
    expect(cov.covered).toBe(0)
  })

  it('counts only devices whose role the policy targets', () => {
    const devices = [
      dev({ id: 'a', role: 'leaf', subLayer: 'leaf', vendor: 'Cisco' }),
      dev({ id: 'b', role: 'firewall', subLayer: 'firewall', vendor: 'Cisco' }),
    ]
    for (const p of POLICY_CATALOG) {
      const cov = policyCoverage(p, devices, 'dc')
      expect(cov.eligible).toBeLessThanOrEqual(devices.length)
      expect(cov.covered).toBeLessThanOrEqual(cov.eligible)
    }
  })

  it('measures the real Juniper gap on a generated DC design', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'] })
    const gaps = POLICY_CATALOG.filter(p => {
      const c = policyCoverage(p, devices, 'dc')
      return c.eligible > 0 && c.covered < c.eligible
    })
    // The whole point of AG7: on a non-Cisco fabric this is NOT zero, and the
    // UI must be able to say so rather than silently applying nothing.
    expect(gaps.length).toBeGreaterThan(0)
  })
})
