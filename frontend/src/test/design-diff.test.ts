import { describe, it, expect } from 'vitest'
import { diffDesigns, diffToMarkdown } from '@/lib/design-diff'
import type { DesignExport } from '@/lib/design-export'
import type { BOMDevice } from '@/types'

function dev(p: Partial<BOMDevice>): BOMDevice {
  return {
    id: p.id || 'd', hostname: p.hostname || 'H', role: 'leaf', subLayer: 'leaf',
    model: 'N9K', vendor: 'Cisco', count: 1, unitPrice: 1000, totalPrice: 1000,
    speed: '100G', ports: 48, features: [], ...p,
  }
}

function design(over: Partial<DesignExport> = {}): DesignExport {
  const base = {
    _magic: 'NDAI_DESIGN',
    _version: 1,
    _exportedAt: '2026-07-07T00:00:00Z',
    intent: {
      useCase: 'dc', appTypes: [], scale: 'medium', redundancy: 'dual',
      siteName: 'Ashburn', siteCode: 'IAD', orgName: 'Acme', orgSize: 'large',
      budgetTier: 'enterprise', vendorPrefs: ['Cisco'], industry: 'tech',
      primaryContact: 'a@b.c', compliance: [],
    },
    requirements: {
      trafficPattern: 'ew', totalEndpoints: 500, bandwidthPerServer: '25G',
      oversubscription: 3, underlayProtocol: 'isis', overlayProtocols: ['vxlan_evpn'],
      protoFeatures: [], firewallModel: 'perimeter', redundancyModel: 'dual',
      numSites: 1, vpnType: 'ipsec', nacOptions: [], additionalNotes: '',
      cloudProviders: [], dcTopology: 'clos', coloProvider: '', dcEdgeVendor: '',
      bgpAsn: '65000', orgCidr: '10.0.0.0/8', aviatrixOptions: [],
    },
    bom: {
      devices: [dev({ id: 's1', hostname: 'IAD-SPINE-01', role: 'spine', subLayer: 'spine' }),
                dev({ id: 'l1', hostname: 'IAD-LEAF-01' })],
      cabling: [], optics: [],
    },
    configs: { s1: 'hostname IAD-SPINE-01\nrouter bgp 65000\n', l1: 'hostname IAD-LEAF-01\n' },
  } as unknown as DesignExport
  return { ...base, ...over }
}

describe('diffDesigns — no changes', () => {
  it('reports identical designs as unchanged', () => {
    const d = diffDesigns(design(), design())
    expect(d.summary.hasChanges).toBe(false)
    expect(d.intentChanges).toEqual([])
    expect(d.bomDelta).toEqual([])
    expect(d.configDelta).toEqual([])
  })
})

describe('diffDesigns — intent & requirements', () => {
  it('detects an intent field change with before→after', () => {
    const b = design()
    b.intent = { ...b.intent, scale: 'large' }
    const d = diffDesigns(design(), b)
    const c = d.intentChanges.find(x => x.field === 'scale')
    expect(c).toEqual({ field: 'scale', before: 'medium', after: 'large' })
    expect(d.summary.intentChanged).toBe(1)
    expect(d.summary.hasChanges).toBe(true)
  })

  it('detects a requirements change', () => {
    const b = design()
    b.requirements = { ...b.requirements, totalEndpoints: 1000, oversubscription: 4 }
    const d = diffDesigns(design(), b)
    expect(d.summary.requirementsChanged).toBe(2)
    expect(d.requirementChanges.map(c => c.field).sort()).toEqual(['oversubscription', 'totalEndpoints'])
  })
})

describe('diffDesigns — BOM delta', () => {
  it('detects added, removed and changed devices with capex delta', () => {
    const b = design()
    b.bom = {
      devices: [
        dev({ id: 's1', hostname: 'IAD-SPINE-01', role: 'spine', subLayer: 'spine' }), // unchanged
        dev({ id: 'l1', hostname: 'IAD-LEAF-01', count: 2, totalPrice: 2000 }),         // changed
        dev({ id: 'l2', hostname: 'IAD-LEAF-02', totalPrice: 1500 }),                   // added
      ],
      cabling: [], optics: [],
    }
    const d = diffDesigns(design(), b)
    expect(d.summary.devicesAdded).toBe(1)
    expect(d.summary.devicesRemoved).toBe(0)
    expect(d.summary.devicesChanged).toBe(1)

    const changed = d.bomDelta.find(x => x.id === 'l1')!
    expect(changed.status).toBe('changed')
    expect(changed.changes.some(c => c.field === 'count' && c.before === '1' && c.after === '2')).toBe(true)

    // baseline capex 2000 (s1+l1), candidate 1000+2000+1500 = 4500
    expect(d.summary.capexBefore).toBe(2000)
    expect(d.summary.capexAfter).toBe(4500)
    expect(d.summary.capexDelta).toBe(2500)
  })

  it('detects a removed device', () => {
    const b = design()
    b.bom = { devices: [dev({ id: 's1', hostname: 'IAD-SPINE-01', role: 'spine', subLayer: 'spine' })], cabling: [], optics: [] }
    const d = diffDesigns(design(), b)
    expect(d.summary.devicesRemoved).toBe(1)
    expect(d.bomDelta.find(x => x.id === 'l1')!.status).toBe('removed')
  })
})

describe('diffDesigns — config delta', () => {
  it('detects an added and removed config file', () => {
    const b = design()
    b.configs = { s1: b.configs.s1, l2: 'hostname IAD-LEAF-02\n' } // l1 removed, l2 added
    const d = diffDesigns(design(), b)
    expect(d.summary.configsAdded).toBe(1)
    expect(d.summary.configsRemoved).toBe(1)
    expect(d.configDelta.find(c => c.id === 'l2')!.status).toBe('added')
    expect(d.configDelta.find(c => c.id === 'l1')!.status).toBe('removed')
  })

  it('produces a line-level hunk for a modified config', () => {
    const b = design()
    b.configs = { ...b.configs, s1: 'hostname IAD-SPINE-01\nrouter bgp 65001\nbfd\n' }
    const d = diffDesigns(design(), b)
    const cd = d.configDelta.find(c => c.id === 's1')!
    expect(cd.status).toBe('modified')
    expect(cd.addedLines).toBeGreaterThan(0)
    const signs = cd.hunks.map(h => h.sign)
    expect(signs).toContain('+')
    expect(signs).toContain('-')
    // the changed ASN must appear
    expect(cd.hunks.some(h => h.sign === '+' && h.text.includes('65001'))).toBe(true)
    expect(cd.hunks.some(h => h.sign === '-' && h.text.includes('65000'))).toBe(true)
  })

  it('elides long unchanged runs in a large config', () => {
    const a = design()
    const big = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    a.configs = { ...a.configs, s1: big }
    const b = design()
    b.configs = { ...b.configs, s1: big.replace('line 25', 'line 25 CHANGED') }
    const d = diffDesigns(a, b)
    const cd = d.configDelta.find(c => c.id === 's1')!
    expect(cd.hunks.some(h => /unchanged lines/.test(h.text))).toBe(true)
    // context around the change is preserved
    expect(cd.hunks.some(h => h.sign === '+' && h.text.includes('CHANGED'))).toBe(true)
  })
})

describe('diffToMarkdown', () => {
  it('renders "no changes" for identical designs', () => {
    const md = diffToMarkdown(diffDesigns(design(), design()))
    expect(md).toContain('No changes')
  })

  it('renders a full report with summary, tables and diff blocks', () => {
    const b = design()
    b.intent = { ...b.intent, scale: 'large' }
    b.bom = { devices: [...b.bom.devices, dev({ id: 'l2', hostname: 'IAD-LEAF-02', totalPrice: 1500 })], cabling: [], optics: [] }
    b.configs = { ...b.configs, s1: 'hostname IAD-SPINE-01\nrouter bgp 65001\n' }
    const md = diffToMarkdown(diffDesigns(design(), b))
    expect(md).toContain('# Design Change Review')
    expect(md).toContain('## Summary')
    expect(md).toContain('Intent changes')
    expect(md).toContain('BOM delta')
    expect(md).toContain('```diff')
    expect(md).toContain('CapEx')
  })
})
