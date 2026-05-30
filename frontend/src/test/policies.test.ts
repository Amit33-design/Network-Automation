import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import {
  POLICY_CATALOG,
  applicablePolicies,
  applyPolicies,
  policyByCategory,
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
