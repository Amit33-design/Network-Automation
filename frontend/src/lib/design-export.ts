import type {
  AppState, BOMDevice, CableLink, OpticsEntry,
  UseCase, Scale, Compliance, TrafficPattern,
  BandwidthPerServer, UnderlayProtocol, RedundancyModel,
  VpnType, FirewallModel, DcTopology, OrgSize, BudgetTier,
  AppType, Redundancy,
} from '@/types'
import { computeTCO } from '@/lib/bom'

const EXPORT_VERSION = 1
const MAGIC = 'netdesign-ai-design'

export interface DesignExport {
  _magic: typeof MAGIC
  _version: number
  _exportedAt: string
  intent: {
    useCase: UseCase | ''
    appTypes: AppType[]
    scale: Scale
    redundancy: Redundancy
    siteName: string
    siteCode: string
    orgName: string
    orgSize: OrgSize
    budgetTier: BudgetTier
    vendorPrefs: string[]
    industry: string
    primaryContact: string
    compliance: Compliance[]
  }
  requirements: {
    trafficPattern: TrafficPattern
    totalEndpoints: number
    bandwidthPerServer: BandwidthPerServer
    oversubscription: number
    underlayProtocol: UnderlayProtocol
    overlayProtocols: string[]
    protoFeatures: string[]
    firewallModel: FirewallModel
    redundancyModel: RedundancyModel
    numSites: number
    vpnType: VpnType
    nacOptions: string[]
    additionalNotes: string
    cloudProviders: string[]
    dcTopology: DcTopology
    coloProvider: string
    dcEdgeVendor: string
    bgpAsn: string
    orgCidr: string
    aviatrixOptions: string[]
  }
  bom: {
    devices: BOMDevice[]
    cabling: CableLink[]
    optics: OpticsEntry[]
  }
  configs: Record<string, string>
}

export function serializeDesign(state: AppState): DesignExport {
  return {
    _magic: MAGIC,
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
    intent: {
      useCase: state.useCase,
      appTypes: state.appTypes,
      scale: state.scale,
      redundancy: state.redundancy,
      siteName: state.siteName,
      siteCode: state.siteCode,
      orgName: state.orgName,
      orgSize: state.orgSize,
      budgetTier: state.budgetTier,
      vendorPrefs: state.vendorPrefs,
      industry: state.industry,
      primaryContact: state.primaryContact,
      compliance: state.compliance,
    },
    requirements: {
      trafficPattern: state.trafficPattern,
      totalEndpoints: state.totalEndpoints,
      bandwidthPerServer: state.bandwidthPerServer,
      oversubscription: state.oversubscription,
      underlayProtocol: state.underlayProtocol,
      overlayProtocols: state.overlayProtocols,
      protoFeatures: state.protoFeatures,
      firewallModel: state.firewallModel,
      redundancyModel: state.redundancyModel,
      numSites: state.numSites,
      vpnType: state.vpnType,
      nacOptions: state.nacOptions,
      additionalNotes: state.additionalNotes,
      cloudProviders: state.cloudProviders,
      dcTopology: state.dcTopology,
      coloProvider: state.coloProvider,
      dcEdgeVendor: state.dcEdgeVendor,
      bgpAsn: state.bgpAsn,
      orgCidr: state.orgCidr,
      aviatrixOptions: state.aviatrixOptions,
    },
    bom: {
      devices: state.devices,
      cabling: state.cabling,
      optics: state.optics,
    },
    configs: state.configs,
  }
}

export interface ImportResult {
  ok: boolean
  error?: string
  warnings: string[]
}

export function validateDesignImport(data: unknown): ImportResult {
  const warnings: string[] = []

  if (!data || typeof data !== 'object')
    return { ok: false, error: 'Invalid file: not a JSON object', warnings }

  const d = data as Record<string, unknown>
  if (d._magic !== MAGIC)
    return { ok: false, error: 'Not a NetDesign AI export file', warnings }

  if (typeof d._version !== 'number')
    return { ok: false, error: 'Missing version field', warnings }

  if (d._version > EXPORT_VERSION)
    warnings.push(`File version ${d._version} is newer than supported (${EXPORT_VERSION}). Some fields may be ignored.`)

  if (!d.intent || typeof d.intent !== 'object')
    return { ok: false, error: 'Missing intent section', warnings }

  if (!d.requirements || typeof d.requirements !== 'object')
    return { ok: false, error: 'Missing requirements section', warnings }

  const intent = d.intent as Record<string, unknown>
  const validUseCases = ['', 'campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix', 'oran']
  if (intent.useCase && !validUseCases.includes(intent.useCase as string))
    warnings.push(`Unknown use case "${intent.useCase}" — may not generate correct configs.`)

  return { ok: true, warnings }
}

export function applyDesignImport(data: DesignExport): Partial<AppState> {
  const state: Partial<AppState> = {}

  const i = data.intent
  if (i) {
    if (i.useCase !== undefined) state.useCase = i.useCase
    if (i.appTypes) state.appTypes = i.appTypes
    if (i.scale) state.scale = i.scale
    if (i.redundancy) state.redundancy = i.redundancy
    if (i.siteName !== undefined) state.siteName = i.siteName
    if (i.siteCode !== undefined) state.siteCode = i.siteCode
    if (i.orgName !== undefined) state.orgName = i.orgName
    if (i.orgSize !== undefined) state.orgSize = i.orgSize
    if (i.budgetTier !== undefined) state.budgetTier = i.budgetTier
    if (i.vendorPrefs) state.vendorPrefs = i.vendorPrefs
    if (i.industry !== undefined) state.industry = i.industry
    if (i.primaryContact !== undefined) state.primaryContact = i.primaryContact
    if (i.compliance) state.compliance = i.compliance
  }

  const r = data.requirements
  if (r) {
    if (r.trafficPattern) state.trafficPattern = r.trafficPattern
    if (r.totalEndpoints !== undefined) state.totalEndpoints = r.totalEndpoints
    if (r.bandwidthPerServer) state.bandwidthPerServer = r.bandwidthPerServer
    if (r.oversubscription !== undefined) state.oversubscription = r.oversubscription
    if (r.underlayProtocol) state.underlayProtocol = r.underlayProtocol
    if (r.overlayProtocols) state.overlayProtocols = r.overlayProtocols
    if (r.protoFeatures) state.protoFeatures = r.protoFeatures
    if (r.firewallModel !== undefined) state.firewallModel = r.firewallModel
    if (r.redundancyModel) state.redundancyModel = r.redundancyModel
    if (r.numSites !== undefined) state.numSites = r.numSites
    if (r.vpnType !== undefined) state.vpnType = r.vpnType
    if (r.nacOptions) state.nacOptions = r.nacOptions
    if (r.additionalNotes !== undefined) state.additionalNotes = r.additionalNotes
    if (r.cloudProviders) state.cloudProviders = r.cloudProviders
    if (r.dcTopology !== undefined) state.dcTopology = r.dcTopology
    if (r.coloProvider !== undefined) state.coloProvider = r.coloProvider
    if (r.dcEdgeVendor !== undefined) state.dcEdgeVendor = r.dcEdgeVendor
    if (r.bgpAsn !== undefined) state.bgpAsn = r.bgpAsn
    if (r.orgCidr !== undefined) state.orgCidr = r.orgCidr
    if (r.aviatrixOptions) state.aviatrixOptions = r.aviatrixOptions
  }

  if (data.bom) {
    if (data.bom.devices) state.devices = data.bom.devices
    if (data.bom.cabling) state.cabling = data.bom.cabling
    if (data.bom.optics) state.optics = data.bom.optics
  }

  if (data.configs) state.configs = data.configs

  return state
}

const USE_CASE_LABELS: Record<string, string> = {
  campus: 'Campus / Enterprise', dc: 'Data Center Leaf-Spine',
  gpu: 'AI / GPU Cluster', wan: 'WAN / SD-WAN',
  multisite: 'Multi-Site DCI', multicloud: 'Multi-Cloud',
  aviatrix: 'Aviatrix Overlay', oran: 'Private 5G / O-RAN',
}

export function buildDesignMarkdown(state: AppState): string {
  const uc = USE_CASE_LABELS[state.useCase] || state.useCase || 'Not selected'
  const date = new Date().toISOString().slice(0, 10)

  const devicesByLayer = state.devices.reduce<Record<string, { count: number; model: string; vendor: string; price: number }>>((acc, d) => {
    const k = d.subLayer
    if (!acc[k]) acc[k] = { count: 0, model: d.model, vendor: d.vendor, price: 0 }
    acc[k].count += d.count
    acc[k].price += d.totalPrice
    return acc
  }, {})

  const grandTotal = state.devices.reduce((s, d) => s + d.totalPrice, 0)

  const tco = state.devices.length > 0 ? computeTCO(state.devices) : null

  const lines: string[] = [
    `# Network Design Report`,
    ``,
    `**Generated by:** NetDesign AI`,
    `**Date:** ${date}`,
    `**Organization:** ${state.orgName || 'N/A'}`,
    `**Site:** ${state.siteName || 'N/A'} (${state.siteCode || 'N/A'})`,
    ``,
    `---`,
    ``,
    `## 1. Design Intent`,
    ``,
    `| Parameter | Value |`,
    `|-----------|-------|`,
    `| Use Case | ${uc} |`,
    `| Scale | ${state.scale.charAt(0).toUpperCase() + state.scale.slice(1)} |`,
    `| Redundancy | ${state.redundancy} |`,
    `| Redundancy Model | ${state.redundancyModel} |`,
    `| Traffic Pattern | ${state.trafficPattern === 'ew' ? 'East-West' : state.trafficPattern === 'ns' ? 'North-South' : 'Both'} |`,
    `| Total Endpoints | ${state.totalEndpoints.toLocaleString()} |`,
    `| Number of Sites | ${state.numSites} |`,
    `| Industry | ${state.industry || 'N/A'} |`,
    ``,
    `## 2. Network Requirements`,
    ``,
    `| Parameter | Value |`,
    `|-----------|-------|`,
    `| Bandwidth per Server | ${state.bandwidthPerServer} |`,
    `| Oversubscription | ${state.oversubscription}:1 |`,
    `| Underlay Protocol | ${state.underlayProtocol.toUpperCase()} |`,
    `| Overlay Protocols | ${state.overlayProtocols.length ? state.overlayProtocols.join(', ') : 'None'} |`,
    `| Protocol Features | ${state.protoFeatures.length ? state.protoFeatures.join(', ') : 'None'} |`,
    `| Firewall Model | ${state.firewallModel || 'None'} |`,
    `| VPN Type | ${state.vpnType || 'None'} |`,
    `| NAC Options | ${state.nacOptions.length ? state.nacOptions.join(', ') : 'None'} |`,
  ]

  if (state.compliance.length > 0) {
    lines.push(``, `### Compliance Frameworks`, ``)
    state.compliance.forEach(c => lines.push(`- ${c}`))
  }

  if (state.vendorPrefs.length > 0) {
    lines.push(``, `### Vendor Preferences`, ``)
    state.vendorPrefs.forEach(v => lines.push(`- ${v}`))
  }

  if (state.cloudProviders.length > 0) {
    lines.push(``, `### Multi-Cloud Configuration`, ``,
      `| Parameter | Value |`,
      `|-----------|-------|`,
      `| Cloud Providers | ${state.cloudProviders.join(', ')} |`,
      `| DC Topology | ${state.dcTopology || 'N/A'} |`,
      `| Colo Provider | ${state.coloProvider || 'N/A'} |`,
      `| DC Edge Vendor | ${state.dcEdgeVendor || 'N/A'} |`,
      `| BGP ASN | ${state.bgpAsn || 'N/A'} |`,
      `| Org CIDR | ${state.orgCidr || 'N/A'} |`,
    )
  }

  lines.push(``, `## 3. Bill of Materials`, ``,
    `| Layer | Model | Vendor | Qty | Unit Price | Total |`,
    `|-------|-------|--------|-----|-----------|-------|`,
  )

  Object.entries(devicesByLayer).forEach(([layer, d]) => {
    lines.push(`| ${layer} | ${d.model} | ${d.vendor} | ${d.count} | $${(d.price / d.count).toLocaleString()} | $${d.price.toLocaleString()} |`)
  })

  const totalDevices = state.devices.reduce((s, d) => s + d.count, 0)
  lines.push(`| **Total** | | | **${totalDevices}** | | **$${grandTotal.toLocaleString()}** |`)

  if (tco) {
    lines.push(``, `### 3-Year Total Cost of Ownership`, ``,
      `| Category | Cost |`,
      `|----------|------|`,
      `| CapEx (Hardware) | $${tco.capex.toLocaleString()} |`,
      `| Power (3yr) | $${tco.power.toLocaleString()} |`,
      `| Support (3yr) | $${tco.support.toLocaleString()} |`,
      `| Rack/Colo (3yr) | $${tco.rackspace.toLocaleString()} |`,
      `| **3-Year TCO** | **$${tco.total.toLocaleString()}** |`,
    )
  }

  if (state.additionalNotes) {
    lines.push(``, `## 4. Additional Notes`, ``, state.additionalNotes)
  }

  lines.push(``, `---`, ``, `*This report was generated by NetDesign AI (netdesignai.com) on ${date}.*`)

  return lines.join('\n')
}

export function downloadDesignJSON(state: AppState) {
  const design = serializeDesign(state)
  const json = JSON.stringify(design, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `netdesign-${state.siteCode || state.useCase || 'design'}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadDesignMarkdown(state: AppState) {
  const md = buildDesignMarkdown(state)
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `netdesign-report-${state.siteCode || state.useCase || 'design'}-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}
