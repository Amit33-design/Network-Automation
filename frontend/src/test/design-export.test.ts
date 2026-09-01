import { describe, it, expect } from 'vitest'
import {
  serializeDesign,
  validateDesignImport,
  applyDesignImport,
  buildDesignMarkdown,
} from '../lib/design-export'
import type { AppState } from '../types'
import { useAppStore } from '@/store/useAppStore'
import { buildDeviceList, buildCabling, buildOptics } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'

const MOCK_STATE: AppState = {
  useCase: 'dc',
  appTypes: ['storage', 'hpc'],
  siteName: 'Ashburn DC',
  siteCode: 'IAD',
  scale: 'medium',
  redundancy: 'dual',
  linkDistances: { 'spine-leaf': 100, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000 },
  devices: [
    { id: 'spine-1', hostname: 'IAD-SP-01', role: 'spine', subLayer: 'spine', model: 'N9K-C9364C', vendor: 'Cisco', count: 2, unitPrice: 35000, totalPrice: 70000, speed: '100G', ports: 64, uplinks: 0, features: [] },
    { id: 'leaf-1', hostname: 'IAD-LF-01', role: 'leaf', subLayer: 'leaf', model: 'N9K-C93180YC-FX', vendor: 'Cisco', count: 4, unitPrice: 18000, totalPrice: 72000, speed: '25G', ports: 48, uplinks: 6, features: [] },
  ],
  cabling: [],
  optics: [],
  configs: { 'IAD-SP-01': 'hostname IAD-SP-01' },
  ztpConfig: {},
  policies: [],
  preCheckScript: '',
  postCheckScript: '',
  prometheusAlerts: '',
  grafanaDashboard: {},
  ansiblePlaybook: {},
  compliance: ['PCI', 'SOC2'],
  step: 4,
  orgName: 'Acme Corp',
  orgSize: 'enterprise',
  budgetTier: 'enterprise',
  vendorPrefs: ['Cisco'],
  industry: 'Finance',
  primaryContact: 'admin@acme.com',
  customPolicyRules: '',
  activeDeployTab: 'deploy',
  theme: 'dark',
  trafficPattern: 'ew',
  totalEndpoints: 500,
  bandwidthPerServer: '25G',
  oversubscription: 3,
  underlayProtocol: 'isis',
  overlayProtocols: ['VXLAN/EVPN'],
  protoFeatures: ['ECMP', 'BFD'],
  firewallModel: 'perimeter',
  redundancyModel: 'ha',
  numSites: 1,
  vpnType: 'none',
  nacOptions: [],
  additionalNotes: 'Test design',
  policyBlocks: [],
  cloudProviders: [],
  dcTopology: '',
  coloProvider: '',
  dcEdgeVendor: '',
  bgpAsn: '',
  orgCidr: '',
  aviatrixOptions: [],
  demoTopologyId: '',
  netboxDevices: [],
  _savedAt: Date.now(),
}

describe('serializeDesign', () => {
  it('produces valid export structure', () => {
    const exported = serializeDesign(MOCK_STATE)
    expect(exported._magic).toBe('netdesign-ai-design')
    expect(exported._version).toBe(1)
    expect(exported._exportedAt).toBeTruthy()
    expect(exported.intent.useCase).toBe('dc')
    expect(exported.intent.siteCode).toBe('IAD')
    expect(exported.intent.orgName).toBe('Acme Corp')
    expect(exported.requirements.underlayProtocol).toBe('isis')
    expect(exported.requirements.totalEndpoints).toBe(500)
    expect(exported.bom.devices).toHaveLength(2)
    expect(exported.configs['IAD-SP-01']).toBe('hostname IAD-SP-01')
  })

  it('round-trips through validate + apply', () => {
    const exported = serializeDesign(MOCK_STATE)
    const json = JSON.stringify(exported)
    const parsed = JSON.parse(json)
    const result = validateDesignImport(parsed)
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(0)
    const patch = applyDesignImport(parsed)
    expect(patch.useCase).toBe('dc')
    expect(patch.totalEndpoints).toBe(500)
    expect(patch.devices).toHaveLength(2)
  })
})

describe('validateDesignImport', () => {
  it('rejects non-object', () => {
    expect(validateDesignImport('foo').ok).toBe(false)
    expect(validateDesignImport(null).ok).toBe(false)
    expect(validateDesignImport(42).ok).toBe(false)
  })

  it('rejects wrong magic', () => {
    const result = validateDesignImport({ _magic: 'wrong', _version: 1, intent: {}, requirements: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('NetDesign AI')
  })

  it('rejects missing intent', () => {
    const result = validateDesignImport({ _magic: 'netdesign-ai-design', _version: 1, requirements: {} })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('intent')
  })

  it('warns on newer version', () => {
    const result = validateDesignImport({ _magic: 'netdesign-ai-design', _version: 999, intent: {}, requirements: {} })
    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('999')
  })

  it('warns on unknown use case', () => {
    const result = validateDesignImport({ _magic: 'netdesign-ai-design', _version: 1, intent: { useCase: 'quantum' }, requirements: {} })
    expect(result.ok).toBe(true)
    expect(result.warnings.some(w => w.includes('quantum'))).toBe(true)
  })

  it('accepts valid export', () => {
    const exported = serializeDesign(MOCK_STATE)
    const result = validateDesignImport(exported)
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('applyDesignImport', () => {
  it('maps all intent fields', () => {
    const exported = serializeDesign(MOCK_STATE)
    const patch = applyDesignImport(exported)
    expect(patch.useCase).toBe('dc')
    expect(patch.appTypes).toEqual(['storage', 'hpc'])
    expect(patch.scale).toBe('medium')
    expect(patch.redundancy).toBe('dual')
    expect(patch.compliance).toEqual(['PCI', 'SOC2'])
    expect(patch.vendorPrefs).toEqual(['Cisco'])
  })

  it('maps all requirement fields', () => {
    const exported = serializeDesign(MOCK_STATE)
    const patch = applyDesignImport(exported)
    expect(patch.trafficPattern).toBe('ew')
    expect(patch.bandwidthPerServer).toBe('25G')
    expect(patch.oversubscription).toBe(3)
    expect(patch.underlayProtocol).toBe('isis')
    expect(patch.overlayProtocols).toEqual(['VXLAN/EVPN'])
    expect(patch.protoFeatures).toEqual(['ECMP', 'BFD'])
    expect(patch.firewallModel).toBe('perimeter')
  })

  it('preserves configs', () => {
    const exported = serializeDesign(MOCK_STATE)
    const patch = applyDesignImport(exported)
    expect(patch.configs).toEqual({ 'IAD-SP-01': 'hostname IAD-SP-01' })
  })
})

describe('buildDesignMarkdown', () => {
  it('generates valid markdown', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('# Network Design Report')
    expect(md).toContain('Acme Corp')
    expect(md).toContain('IAD')
    expect(md).toContain('Data Center Leaf-Spine')
    expect(md).toContain('ISIS')
    expect(md).toContain('500')
  })

  it('includes compliance frameworks', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('PCI')
    expect(md).toContain('SOC2')
  })

  it('includes vendor preferences', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('Cisco')
  })

  it('includes BOM table', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('Bill of Materials')
    expect(md).toContain('spine')
    expect(md).toContain('leaf')
    expect(md).toContain('N9K-C9364C')
  })

  it('includes TCO', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('Total Cost of Ownership')
    expect(md).toContain('CapEx')
    expect(md).toContain('Power')
  })

  it('includes additional notes', () => {
    const md = buildDesignMarkdown(MOCK_STATE)
    expect(md).toContain('Test design')
  })

  it('handles empty state gracefully', () => {
    const empty: AppState = {
      ...MOCK_STATE,
      useCase: '',
      devices: [],
      compliance: [],
      vendorPrefs: [],
      additionalNotes: '',
    }
    const md = buildDesignMarkdown(empty)
    expect(md).toContain('# Network Design Report')
    expect(md).not.toContain('Compliance Frameworks')
    expect(md).not.toContain('Vendor Preferences')
    expect(md).not.toContain('Additional Notes')
  })
})

// ── AG3: a saved design must come back as the same design ────────────────────
// The export dropped `linkDistances` — the run lengths the user typed, which
// drive cable selection, fibre medium, optic choice and cost. A design
// exported with 400 m spine-leaf runs reimported as 3 m DAC: $63,180 of
// cabling and $18,720 of optics became $5,680 and $0, silently, with the
// import reporting success. Also dropped: the custom deploy-gate policy, the
// selected policy blocks, the ZTP settings and any NetBox-imported inventory.
describe('AG3 — round-trip fidelity against the real store', () => {
  const populate = () => {
    useAppStore.setState({
      useCase: 'dc', siteCode: 'AG3', siteName: 'Round Trip', orgName: 'Acme',
      scale: 'medium', totalEndpoints: 1024, oversubscription: 3,
      bandwidthPerServer: '25G', vendorPrefs: ['Arista'], budgetTier: 'enterprise',
      redundancy: 'dual', compliance: ['PCI'], protoFeatures: ['BFD'],
      overlayProtocols: ['vxlan_evpn'], appTypes: ['storage'], numSites: 3,
      customPolicyRules: 'no deploy on friday',
      policyBlocks: ['hardening'],
      linkDistances: { 'spine-leaf': 400, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000 },
    } as never)
    const devices = buildDeviceList(useAppStore.getState() as never)
    useAppStore.setState({ devices, configs: generateAllConfigs(devices, 'dc') } as never)
    return useAppStore.getState() as never as Record<string, unknown>
  }

  const roundTrip = (before: Record<string, unknown>) => {
    const ser = serializeDesign(before as never)
    const wire = JSON.parse(JSON.stringify(ser))
    expect(validateDesignImport(wire).ok, 'export did not validate').toBe(true)
    return applyDesignImport(wire) as Record<string, unknown>
  }

  it('preserves every design INPUT, keeping only derived output out', () => {
    const before = populate()
    const after = roundTrip(before)
    // Regenerable artifacts and UI state are deliberately not carried.
    const DERIVED = new Set([
      'policies', 'preCheckScript', 'postCheckScript', 'prometheusAlerts',
      'grafanaDashboard', 'ansiblePlaybook', 'ansibleInventory',
      'step', 'activeDeployTab', 'theme', 'demoTopologyId', '_savedAt',
    ])
    const dataKeys = Object.keys(before).filter(k => typeof before[k] !== 'function')
    const dropped = dataKeys.filter(k => !(k in after) && !DERIVED.has(k))
    expect(dropped, 'these design inputs do not survive a save/load').toEqual([])
  })

  it('never changes the value of a field it does carry', () => {
    const before = populate()
    const after = roundTrip(before)
    const changed = Object.keys(after).filter(k =>
      JSON.stringify(after[k]) !== JSON.stringify(before[k]))
    expect(changed).toEqual([])
  })

  it('rebuilds the identical cable and optics BOM after a reload', () => {
    // The property that actually matters: reload a design and procurement
    // gets the same quote. Losing linkDistances quietly changed both.
    const before = populate()
    const after = roundTrip(before)
    const devices = before.devices as never
    const cost = (ld: never) => ({
      cabling: buildCabling(devices, ld).reduce((n, c) => n + c.totalPrice, 0),
      optics: buildOptics(devices, ld).reduce((n, o) => n + o.totalPrice, 0),
      medium: buildCabling(devices, ld)
        .find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')?.medium,
    })
    expect(cost(after.linkDistances as never)).toEqual(cost(before.linkDistances as never))
    expect((cost(after.linkDistances as never)).cabling).toBeGreaterThan(0)
  })

  it('still imports a file written before the inputs section existed', () => {
    const before = populate()
    const legacy = JSON.parse(JSON.stringify(serializeDesign(before as never)))
    delete legacy.inputs
    expect(validateDesignImport(legacy).ok).toBe(true)
    const after = applyDesignImport(legacy) as Record<string, unknown>
    expect(after.devices).toBeTruthy()
    expect('linkDistances' in after, 'must not clobber with undefined').toBe(false)
  })
})
