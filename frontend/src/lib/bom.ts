import type { AppState, BOMDevice, Scale, UseCase } from '@/types'
import { PRODUCTS } from './products'

// ── Scale definitions ────────────────────────────────────────────────────────

type RoleCounts = Record<string, number>

const SCALE_DEFS: Record<Scale, Record<UseCase, RoleCounts>> = {
  small: {
    dc:         { spine: 2, leaf: 4 },
    gpu:        { spine: 2, leaf: 4 },
    campus:     { distribution: 2, access: 4 },
    wan:        { 'wan-edge': 2 },
    multisite:  { spine: 2, leaf: 4, 'wan-edge': 2 },
    multicloud: { 'cloud-transit': 1, 'cloud-gw': 2 },
    aviatrix:   { 'cloud-transit': 1, 'cloud-gw': 2 },
    oran:       { 'oran-cu': 1, 'oran-du': 2, 'oran-ru': 4, 'oran-fronthaul': 1, 'oran-midhaul': 1, 'oran-core': 1, 'oran-timing': 1 },
  },
  medium: {
    dc:         { spine: 4, leaf: 8, firewall: 2 },
    gpu:        { spine: 4, leaf: 8 },
    campus:     { distribution: 4, access: 12, firewall: 2 },
    wan:        { 'wan-edge': 4 },
    multisite:  { spine: 4, leaf: 8, 'wan-edge': 4, firewall: 2 },
    multicloud: { 'cloud-transit': 2, 'cloud-gw': 4 },
    aviatrix:   { 'cloud-transit': 2, 'cloud-gw': 4 },
    oran:       { 'oran-cu': 2, 'oran-du': 4, 'oran-ru': 12, 'oran-fronthaul': 2, 'oran-midhaul': 2, 'oran-core': 2, 'oran-timing': 1 },
  },
  large: {
    dc:         { spine: 8, leaf: 24, firewall: 4 },
    gpu:        { spine: 8, leaf: 16 },
    campus:     { distribution: 8, access: 32, firewall: 4 },
    wan:        { 'wan-edge': 8 },
    multisite:  { spine: 8, leaf: 24, 'wan-edge': 8, firewall: 4 },
    multicloud: { 'cloud-transit': 4, 'cloud-gw': 8 },
    aviatrix:   { 'cloud-transit': 4, 'cloud-gw': 8 },
    oran:       { 'oran-cu': 4, 'oran-du': 8, 'oran-ru': 32, 'oran-fronthaul': 4, 'oran-midhaul': 4, 'oran-core': 4, 'oran-timing': 2 },
  },
}

const PREFERRED_PRODUCTS: Record<UseCase, Record<string, string>> = {
  dc:         { spine: 'nxos-9336c',   leaf: 'nxos-93180yc', firewall: 'ftd4145' },
  gpu:        { spine: 'nxos-9364c',   leaf: 'nxos-9332c' },
  campus:     { distribution: 'cat9500', access: 'cat9200',  firewall: 'ftd4145' },
  wan:        { 'wan-edge': 'asr1002hx' },
  multisite:  { spine: 'nxos-9336c',   leaf: 'nxos-93180yc', 'wan-edge': 'viptela-vedge', firewall: 'ftd4145' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  aviatrix:   { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  oran:       { 'oran-cu': 'oran-cu', 'oran-du': 'oran-du', 'oran-ru': 'oran-ru', 'oran-fronthaul': 'oran-fronthaul-sw', 'oran-midhaul': 'oran-midhaul-rtr', 'oran-core': 'oran-core-upf', 'oran-timing': 'ptp-grandmaster' },
}

// Maps vendor → use-case → role → product ID
// Used when vendorPrefs overrides the Cisco defaults above
const VENDOR_PRODUCT_MAP: Record<string, Partial<Record<UseCase, Record<string, string>>>> = {
  'Arista': {
    dc:        { spine: 'arista-7800r3',    leaf: 'arista-7050cx3' },
    gpu:       { spine: 'arista-7800r3',    leaf: 'arista-7050cx3' },
    multisite: { spine: 'arista-7800r3',    leaf: 'arista-7050cx3' },
  },
  'Juniper': {
    dc:        { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
    gpu:       { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
    multisite: { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  },
  'Palo Alto': {
    dc:        { firewall: 'panos-pa5260' },
    campus:    { firewall: 'panos-pa5260' },
    multisite: { firewall: 'panos-pa5260' },
    multicloud: { firewall: 'panos-pa5260' },
  },
  'Fortinet': {
    dc:        { firewall: 'fortinet-fg2600f' },
    campus:    { firewall: 'fortinet-fg2600f', distribution: 'fortinet-fst1024e', access: 'fortinet-fst148f' },
    multisite: { firewall: 'fortinet-fg2600f' },
    multicloud: { firewall: 'fortinet-fg2600f' },
  },
  'Dell EMC': {
    dc:        { spine: 'dell-z9332f',  leaf: 'dell-s5248f' },
    gpu:       { spine: 'dell-z9332f',  leaf: 'dell-s5248f' },
    multisite: { spine: 'dell-z9332f',  leaf: 'dell-s5248f' },
  },
  'HPE Aruba': {
    campus:    { distribution: 'aruba-cx6400', access: 'aruba-cx6300' },
    dc:        { spine: 'aruba-cx10000', leaf: 'aruba-cx6400' },
    multisite: { spine: 'aruba-cx10000', leaf: 'aruba-cx6400' },
  },
  'NVIDIA': {
    gpu:       { spine: 'nvidia-sn5600', leaf: 'nvidia-sn4600c' },
    dc:        { spine: 'nvidia-sn5600', leaf: 'nvidia-sn4600c' },
  },
  'Extreme Networks': {
    dc:        { spine: 'extreme-8720',  leaf: 'extreme-8520' },
    multisite: { spine: 'extreme-8720',  leaf: 'extreme-8520' },
    campus:    { distribution: 'extreme-5720', access: 'extreme-5420' },
  },
}

/** Build role→productId prefs by layering vendorPrefs on top of Cisco defaults. */
function resolvePrefs(useCase: UseCase, vendorPrefs: string[]): Record<string, string> {
  const base = { ...(PREFERRED_PRODUCTS[useCase] ?? PREFERRED_PRODUCTS.dc) }
  for (const vendor of vendorPrefs) {
    const vendorMap = VENDOR_PRODUCT_MAP[vendor]
    if (!vendorMap) continue
    const ucMap = vendorMap[useCase]
    if (!ucMap) continue
    for (const [role, prodId] of Object.entries(ucMap)) {
      base[role] = prodId
    }
  }
  return base
}

// ── Role codes for hostnames ─────────────────────────────────────────────────

const ROLE_CODE: Record<string, string> = {
  spine:              'SPINE',
  leaf:               'LEAF',
  distribution:       'DIST',
  access:             'ACC',
  'wan-edge':         'WAN',
  'sdwan-controller': 'SDCTL',
  firewall:           'FW',
  'cloud-gw':         'CGW',
  'cloud-transit':    'CTGW',
  core:               'CORE',
  'oran-cu':          'OCU',
  'oran-du':          'ODU',
  'oran-ru':          'ORU',
  'oran-fronthaul':   'OFH',
  'oran-midhaul':     'OMH',
  'oran-core':        'OC5G',
  'oran-timing':      'OPTM',
  'gpu-compute':      'GPU',
}

export const GPUS_PER_SERVER = 8

/** Bijective base-26 column label: 0→A … 25→Z, 26→AA, 27→AB … (no overflow). */
export function alphaLabel(n: number): string {
  let s = ''
  let x = n + 1
  while (x > 0) {
    const rem = (x - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

function rackLabel(idx: number): string {
  return alphaLabel(Math.floor(idx / 2))
}

const SEQUENTIAL_ROLES = new Set(['gpu-compute'])

export function generateHostnames(devices: BOMDevice[], siteCode: string): BOMDevice[] {
  const site = (siteCode || 'SITE').toUpperCase().slice(0, 5)
  const counters: Record<string, number> = {}

  return devices.map(dev => {
    const code = ROLE_CODE[dev.subLayer] ?? dev.subLayer.toUpperCase().slice(0, 4)
    if (!counters[code]) counters[code] = 0
    const idx = counters[code]++
    if (SEQUENTIAL_ROLES.has(dev.subLayer)) {
      const num = String(idx + 1).padStart(3, '0')
      return { ...dev, hostname: `${site}-${code}-${num}` }
    }
    const rack = rackLabel(idx)
    const num = String((idx % 2) + 1).padStart(2, '0')
    return { ...dev, hostname: `${site}-${code}-${rack}${num}` }
  })
}

// ── Device list builder ───────────────────────────────────────────────────────

export function buildDeviceList(state: Pick<AppState, 'useCase' | 'scale' | 'siteCode'> & {
  totalEndpoints?: number
  bandwidthPerServer?: string
  oversubscription?: number
  vendorPrefs?: string[]
  trafficPattern?: string
  firewallModel?: string
  overlayProtocols?: string[]
}): BOMDevice[] {
  const useCase = (state.useCase || 'dc') as UseCase
  const scale = (state.scale || 'small') as Scale

  const prefs = state.vendorPrefs?.length
    ? resolvePrefs(useCase, state.vendorPrefs)
    : (PREFERRED_PRODUCTS[useCase] ?? PREFERRED_PRODUCTS.dc)

  // Firewall needed when: medium/large scale OR intent explicitly includes N-S traffic
  const nsTraffic = state.trafficPattern === 'ns' || state.trafficPattern === 'both'
  const fwAllowed = prefs['firewall'] && state.firewallModel !== 'none'
  const needFirewall = fwAllowed && (scale !== 'small' || nsTraffic)

  // Port-math: derive device counts from topology inputs when totalEndpoints > 0
  let scaleDef: RoleCounts
  const endpointCount = state.totalEndpoints ?? 0
  if (endpointCount > 0 && (useCase === 'dc' || useCase === 'gpu' || useCase === 'campus' || useCase === 'multisite')) {
    const bwGbps = parseInt(state.bandwidthPerServer ?? '25') || 25
    const oversub = Math.max(1, state.oversubscription ?? 3)

    if (useCase === 'dc' || useCase === 'gpu') {
      const leafProdId = prefs['leaf']
      const spineProdId = prefs['spine']
      const leafSku = leafProdId ? PRODUCTS.find(p => p.id === leafProdId) : undefined
      const spineSku = spineProdId ? PRODUCTS.find(p => p.id === spineProdId) : undefined

      if (leafSku && spineSku) {
        // Use only downlink ports for endpoint capacity (uplink ports connect to spine)
        const downlinkPorts = Math.max(1, leafSku.ports - (leafSku.uplinks || 0))
        const rawLeaves = Math.ceil(endpointCount / downlinkPorts)
        const leafCount = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1

        // Uplinks needed per leaf based on the oversubscription target.
        // In a Clos fabric each leaf connects to each spine, so
        // spineCount ≈ uplinksPerLeaf. We must NOT cap at the SKU's
        // physical uplink count here — doing so silently degrades the
        // oversubscription ratio and under-provisions spines.
        const serverCapacityPerLeaf = downlinkPorts * bwGbps
        const spinePortSpeed = Math.max(1, parseInt(spineSku.speed) || 100)
        const rawUplinksNeeded = Math.max(1, Math.ceil(serverCapacityPerLeaf / oversub / spinePortSpeed))

        // Spine count: in a true Clos every leaf connects to every spine,
        // so spineCount = rawUplinksNeeded. Additionally each spine must
        // have enough ports to accept one link from every leaf.
        const spinesByUplinks = rawUplinksNeeded
        const spinesByFanout = Math.ceil(leafCount / spineSku.ports)
        const spineCount = Math.max(spinesByUplinks, spinesByFanout, 2)

        scaleDef = { spine: spineCount, leaf: leafCount }
        if (needFirewall) {
          scaleDef['firewall'] = spineCount <= 4 ? 2 : 4
        }
      } else {
        scaleDef = (SCALE_DEFS[scale] ?? SCALE_DEFS.small)[useCase] ?? SCALE_DEFS.small.dc
        if (needFirewall && !scaleDef['firewall']) scaleDef = { ...scaleDef, firewall: 2 }
      }
    } else if (useCase === 'campus') {
      const accessProdId = prefs['access']
      const accessSku = accessProdId ? PRODUCTS.find(p => p.id === accessProdId) : undefined
      const accessPorts = Math.max(1, (accessSku?.ports ?? 48) - (accessSku?.uplinks ?? 4))

      const rawAccess = Math.ceil(endpointCount / accessPorts)
      const accessCount = rawAccess % 2 === 0 ? rawAccess : rawAccess + 1
      const rawDist = Math.max(2, Math.ceil(accessCount / 8))
      const distCount = rawDist % 2 === 0 ? rawDist : rawDist + 1

      scaleDef = { distribution: distCount, access: accessCount }
      if (needFirewall) {
        scaleDef['firewall'] = distCount <= 4 ? 2 : 4
      }
    } else {
      scaleDef = (SCALE_DEFS[scale] ?? SCALE_DEFS.small)[useCase] ?? SCALE_DEFS.small.dc
      if (needFirewall && !scaleDef['firewall']) scaleDef = { ...scaleDef, firewall: 2 }
    }
  } else {
    scaleDef = (SCALE_DEFS[scale] ?? SCALE_DEFS.small)[useCase] ?? SCALE_DEFS.small.dc
    if (needFirewall && !scaleDef['firewall']) scaleDef = { ...scaleDef, firewall: 2 }
  }

  const devices: BOMDevice[] = []
  let globalIdx = 0

  for (const [role, qty] of Object.entries(scaleDef)) {
    const prodId = prefs[role]
    const product = prodId
      ? PRODUCTS.find(p => p.id === prodId)
      : PRODUCTS.find(p => p.subLayer === role && p.useCases.includes(useCase))

    if (!product) continue

    for (let i = 0; i < qty; i++) {
      devices.push({
        id: `${product.id}-${++globalIdx}`,
        hostname: '',
        role,
        subLayer: product.subLayer,
        model: product.model,
        vendor: product.vendor,
        count: 1,
        unitPrice: product.priceUSD,
        totalPrice: product.priceUSD,
        speed: product.speed,
        ports: product.ports,
        uplinks: product.uplinks,
        features: product.features,
      })
    }
  }

  // GPU compute server injection: derive server count from GPU endpoint count
  if (useCase === 'gpu' && endpointCount > 0) {
    const gpuServerProd = PRODUCTS.find(p => p.id === 'gpu-server-4u')
    if (gpuServerProd) {
      const numServers = Math.ceil(endpointCount / GPUS_PER_SERVER)
      for (let i = 0; i < numServers; i++) {
        devices.push({
          id: `gpu-server-4u-${++globalIdx}`,
          hostname: '',
          role: 'gpu-compute',
          subLayer: gpuServerProd.subLayer,
          model: gpuServerProd.model,
          vendor: gpuServerProd.vendor,
          count: 1,
          unitPrice: gpuServerProd.priceUSD,
          totalPrice: gpuServerProd.priceUSD,
          speed: gpuServerProd.speed,
          ports: gpuServerProd.ports,
          uplinks: gpuServerProd.uplinks,
          features: gpuServerProd.features,
        })
      }
    }
  }

  // SD-WAN controller injection: when overlay includes SD-WAN and use case is
  // WAN / multisite / multicloud, add vManage (1) + vSmart (2 HA) + vBond (2 HA)
  const hasSdWan = (state.overlayProtocols ?? []).some(
    o => o.toLowerCase().includes('sd-wan') || o.toLowerCase().includes('sdwan'),
  )
  if (hasSdWan && (useCase === 'wan' || useCase === 'multisite' || useCase === 'multicloud')) {
    const ctrlDefs: Array<{ id: string; qty: number }> = [
      { id: 'sdwan-vmanage', qty: 1 },
      { id: 'sdwan-vsmart',  qty: 2 },
      { id: 'sdwan-vbond',   qty: 2 },
    ]
    for (const def of ctrlDefs) {
      const product = PRODUCTS.find(p => p.id === def.id)
      if (!product) continue
      for (let i = 0; i < def.qty; i++) {
        devices.push({
          id: `${product.id}-${++globalIdx}`,
          hostname: '',
          role: 'sdwan-controller',
          subLayer: product.subLayer,
          model: product.model,
          vendor: product.vendor,
          count: 1,
          unitPrice: product.priceUSD,
          totalPrice: product.priceUSD,
          speed: product.speed,
          ports: product.ports,
          uplinks: product.uplinks,
          features: product.features,
        })
      }
    }
    // Swap traditional WAN edges to Catalyst 8300 cEdge for SD-WAN.
    // Purpose-built SD-WAN edges have AppQoE/DPI; traditional routers (ASR 1002-HX)
    // may list "SD-WAN" as a supported mode but are not native cEdge/vEdge platforms.
    const cat8300 = PRODUCTS.find(p => p.id === 'cat8300-edge')
    if (cat8300) {
      for (let d = 0; d < devices.length; d++) {
        if (devices[d].subLayer === 'wan-edge' && !devices[d].features.includes('AppQoE')) {
          devices[d] = {
            ...devices[d],
            id: `cat8300-edge-${d + 100}`,
            model: cat8300.model,
            unitPrice: cat8300.priceUSD,
            totalPrice: cat8300.priceUSD,
            speed: cat8300.speed,
            ports: cat8300.ports,
            uplinks: cat8300.uplinks,
            features: cat8300.features,
          }
        }
      }
    }
  }

  return generateHostnames(devices, state.siteCode)
}

// ── BOM summary ───────────────────────────────────────────────────────────────

export interface BOMSummaryRow {
  model: string
  vendor: string
  subLayer: string
  unitCost: number
  qty: number
  totalCost: number
  speed: string
  ports: number
  uplinks: number
  features: string[]
  detail: string
}

export function buildBOM(state: Pick<AppState, 'useCase' | 'scale' | 'siteCode'> & {
  totalEndpoints?: number
  bandwidthPerServer?: string
  oversubscription?: number
  vendorPrefs?: string[]
  trafficPattern?: string
  firewallModel?: string
  overlayProtocols?: string[]
}): {
  devices: BOMDevice[]
  summary: Record<string, BOMSummaryRow>
  grandTotal: number
} {
  const devices = buildDeviceList(state)
  const summary: Record<string, BOMSummaryRow> = {}

  for (const dev of devices) {
    if (!summary[dev.model]) {
      const product = PRODUCTS.find(p => p.model === dev.model)
      summary[dev.model] = {
        model: dev.model,
        vendor: dev.vendor,
        subLayer: dev.subLayer,
        unitCost: dev.unitPrice,
        qty: 0,
        totalCost: 0,
        speed: dev.speed,
        ports: dev.ports,
        uplinks: dev.uplinks ?? (product?.uplinks ?? 0),
        features: dev.features,
        detail: product?.detail ?? '',
      }
    }
    summary[dev.model].qty++
    summary[dev.model].totalCost += dev.unitPrice
  }

  const grandTotal = Object.values(summary).reduce((s, r) => s + r.totalCost, 0)
  return { devices, summary, grandTotal }
}

export { SCALE_DEFS }

// ── 3-Year TCO model (G-A13) ───────────────────────────────────────────────────
// Layers a Total-Cost-of-Ownership model on top of the existing BOM (capex).
// Purely additive — does NOT change device-count or capex math. Capex equals
// the same `grandTotal` the BOM already computes (sum of device prices).

/** Configurable TCO rates. Each default documents the assumption behind it. */
export interface TCOOpts {
  /** Blended utility electricity price. Default $0.12/kWh — US commercial avg. */
  energyCostPerKwh: number
  /** Power Usage Effectiveness — facility power ÷ IT power. Default 1.5
   *  (typical enterprise DC cooling/distribution overhead; hyperscale ≈1.1). */
  pue: number
  /** Annual support/maintenance contract as a fraction of hardware capex.
   *  Default 0.15 (15%/yr — SmartNet/TAC/eos-style vendor support). */
  supportRatePerYear: number
  /** Colocation / rack-space rent per rack-unit per month. Default $150/RU/mo. */
  rackCostPerRuMonth: number
  /** Number of years to model. Default 3. */
  years: number
  /** Fallback power draw (W) when a device model is not found in PRODUCTS. */
  defaultPowerW: number
}

export const DEFAULT_TCO_OPTS: TCOOpts = {
  energyCostPerKwh: 0.12,
  pue: 1.5,
  supportRatePerYear: 0.15,
  rackCostPerRuMonth: 150,
  years: 3,
  defaultPowerW: 400,
}

/** Per-role fallback power draw (W) when a model has no powerW in PRODUCTS. */
const ROLE_DEFAULT_POWER_W: Record<string, number> = {
  spine: 800,
  core: 800,
  leaf: 480,
  distribution: 600,
  access: 400,
  'wan-edge': 300,
  'sdwan-controller': 300,
  firewall: 800,
  'cloud-gw': 0,
  'cloud-transit': 0,
  'oran-cu': 800,
  'oran-du': 600,
  'oran-ru': 350,
  'oran-fronthaul': 480,
  'oran-midhaul': 600,
  'oran-core': 1000,
  'oran-timing': 50,
  'gpu-compute': 6500,
}

/** Rack units consumed by a device, derived from its sub-layer role. */
function rackUnitsFor(subLayer: string): number {
  switch (subLayer) {
    case 'spine':
    case 'core':
    case 'wan-edge':
    case 'sdwan-controller':
      return 2
    case 'firewall':
      return 1
    case 'cloud-gw':
    case 'cloud-transit':
      return 0 // cloud-native — no physical RU
    case 'oran-cu':
    case 'oran-du':
    case 'oran-core':
      return 2 // COTS servers — 2RU
    case 'oran-ru':
    case 'oran-timing':
      return 0 // field-mounted — no rack RU
    case 'oran-midhaul':
      return 2
    case 'gpu-compute':
      return 4
    default:
      return 1 // leaf / distribution / access — 1RU ToR/fixed
  }
}

/** Power draw (W) for a device — look up model in PRODUCTS, else role/global fallback. */
function devicePowerW(dev: BOMDevice, defaultPowerW: number): number {
  const product = PRODUCTS.find(p => p.model === dev.model || p.id === dev.id.replace(/-\d+$/, ''))
  if (product && typeof product.powerW === 'number') return product.powerW
  return ROLE_DEFAULT_POWER_W[dev.subLayer] ?? defaultPowerW
}

export interface TCOYear {
  year: number
  power: number
  support: number
  rackspace: number
  total: number
}

export interface TCOModel {
  /** Hardware capex — sum of device prices (matches BOM grandTotal). */
  capex: number
  /** Total power cost over the modeled period. */
  power: number
  /** Total support/maintenance cost over the modeled period. */
  support: number
  /** Total rack/colo cost over the modeled period. */
  rackspace: number
  /** Total opex over the modeled period (power + support + rackspace). */
  opex: number
  /** Grand total: capex + opex over the modeled period. */
  total: number
  /** Annual opex (single year) — convenience breakdown. */
  annual: { power: number; support: number; rackspace: number; total: number }
  /** Year-by-year opex breakdown. */
  byYear: TCOYear[]
  /** Derived totals useful for the UI. */
  totalPowerW: number
  totalRackUnits: number
  /** Echo of the resolved rates so the number is defensible. */
  rates: TCOOpts
}

/**
 * Compute a multi-year (default 3-year) TCO breakdown for a device list.
 * Pure & deterministic; capex equals the sum of device prices.
 */
export function computeTCO(devices: BOMDevice[], opts: Partial<TCOOpts> = {}): TCOModel {
  const rates: TCOOpts = { ...DEFAULT_TCO_OPTS, ...opts }
  const years = Math.max(0, rates.years)

  // Capex — sum of device prices (same basis as BOM grandTotal).
  const capex = devices.reduce((s, d) => s + d.totalPrice, 0)

  // Aggregate power draw and rack footprint.
  const totalPowerW = devices.reduce((s, d) => s + devicePowerW(d, rates.defaultPowerW), 0)
  const totalRackUnits = devices.reduce((s, d) => s + rackUnitsFor(d.subLayer), 0)

  // Annual power: W → kWh/yr (×24×365÷1000), × PUE (cooling overhead), × $/kWh.
  const kWhPerYear = (totalPowerW * 24 * 365) / 1000
  const annualPower = kWhPerYear * rates.pue * rates.energyCostPerKwh

  // Annual support: fixed % of hardware capex.
  const annualSupport = capex * rates.supportRatePerYear

  // Annual rack/colo: RU × $/RU/month × 12.
  const annualRackspace = totalRackUnits * rates.rackCostPerRuMonth * 12

  const annualTotal = annualPower + annualSupport + annualRackspace

  const byYear: TCOYear[] = []
  for (let y = 1; y <= years; y++) {
    byYear.push({
      year: y,
      power: annualPower,
      support: annualSupport,
      rackspace: annualRackspace,
      total: annualTotal,
    })
  }

  const power = annualPower * years
  const support = annualSupport * years
  const rackspace = annualRackspace * years
  const opex = power + support + rackspace

  return {
    capex,
    power,
    support,
    rackspace,
    opex,
    total: capex + opex,
    annual: { power: annualPower, support: annualSupport, rackspace: annualRackspace, total: annualTotal },
    byYear,
    totalPowerW,
    totalRackUnits,
    rates,
  }
}

// ── Cable catalog ─────────────────────────────────────────────────────────────

interface CableSpec {
  type: 'DAC' | 'AOC' | 'LC-LC' | 'MPO'
  maxDist: number
  speeds: string[]
  unitCost: number
  costPerM: number
}

const CABLE_SPECS: CableSpec[] = [
  { type: 'DAC',   maxDist: 1,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 25,  costPerM: 0   },
  { type: 'DAC',   maxDist: 3,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 35,  costPerM: 0   },
  { type: 'DAC',   maxDist: 5,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 45,  costPerM: 0   },
  { type: 'DAC',   maxDist: 3,     speeds: ['40G','100G','400G'],           unitCost: 65,  costPerM: 0   },
  { type: 'AOC',   maxDist: 10,    speeds: ['10G','25G','40G','100G'],      unitCost: 80,  costPerM: 8   },
  { type: 'AOC',   maxDist: 30,    speeds: ['10G','25G','40G','100G'],      unitCost: 240, costPerM: 8   },
  { type: 'MPO',   maxDist: 100,   speeds: ['40G','100G','400G'],           unitCost: 20,  costPerM: 1.2 },
  { type: 'LC-LC', maxDist: 10000, speeds: ['1G','10G','25G','100G'],       unitCost: 15,  costPerM: 0.5 },
]

const CABLE_PRIORITY: Record<string, number> = { DAC: 0, AOC: 1, MPO: 2, 'LC-LC': 3 }

function selectCable(distM: number, speed: string): CableSpec {
  const candidates = CABLE_SPECS.filter(c => c.maxDist >= distM && c.speeds.includes(speed))
  if (!candidates.length) return CABLE_SPECS.find(c => c.type === 'LC-LC')!
  return candidates.sort((a, b) => CABLE_PRIORITY[a.type] - CABLE_PRIORITY[b.type])[0]
}

const LAYER_CONNECTS: Array<{ from: string; to: string; key: string }> = [
  { from: 'spine',        to: 'leaf',         key: 'spine-leaf'  },
  { from: 'leaf',         to: 'gpu-compute',  key: 'spine-leaf'  },
  { from: 'core',         to: 'distribution', key: 'core-dist'   },
  { from: 'distribution', to: 'access',       key: 'dist-access' },
  { from: 'wan-edge',     to: 'distribution', key: 'wan-edge'    },
  { from: 'wan-edge',     to: 'spine',        key: 'wan-edge'    },
  { from: 'firewall',     to: 'distribution', key: 'wan-edge'    },
  { from: 'firewall',     to: 'spine',        key: 'spine-leaf'  },
]

export function buildCabling(
  devices: BOMDevice[],
  linkDistances: AppState['linkDistances'],
): import('@/types').CableLink[] {
  const byLayer = devices.reduce<Record<string, BOMDevice[]>>((acc, d) => {
    acc[d.subLayer] = [...(acc[d.subLayer] ?? []), d]
    return acc
  }, {})

  const links: import('@/types').CableLink[] = []
  let id = 1

  for (const conn of LAYER_CONNECTS) {
    const froms = byLayer[conn.from] ?? []
    const tos   = byLayer[conn.to]   ?? []
    if (!froms.length || !tos.length) continue

    const distM  = linkDistances[conn.key] ?? 5
    const speed  = froms[0].speed ?? '100G'
    const cable  = selectCable(distM, speed)
    const qty    = froms.length * tos.length
    const unit   = cable.unitCost + cable.costPerM * distM

    links.push({
      id:           `cable-${id++}`,
      fromLayer:    conn.from,
      toLayer:      conn.to,
      fromDevice:   `${froms.length}x ${conn.from}`,
      toDevice:     `${tos.length}x ${conn.to}`,
      cableType:    cable.type,
      speed,
      lengthM:      distM,
      quantity:     qty,
      pricePerUnit: Math.round(unit),
      totalPrice:   Math.round(unit * qty),
    })
  }

  return links
}

// ── Optics catalog ────────────────────────────────────────────────────────────

interface OpticSpec {
  formFactor: string
  speed:      string
  reach:      string
  reachM:     number
  priceUSD:   number
  vendor:     string
  partNumber: string
}

const OPTIC_CATALOG: OpticSpec[] = [
  { formFactor: 'SFP+',    speed: '10G',  reach: '300m',  reachM: 300,   priceUSD: 25,   vendor: 'Generic', partNumber: 'SFP-10G-SR'       },
  { formFactor: 'SFP+',    speed: '10G',  reach: '10km',  reachM: 10000, priceUSD: 55,   vendor: 'Generic', partNumber: 'SFP-10G-LR'       },
  { formFactor: 'SFP28',   speed: '25G',  reach: '100m',  reachM: 100,   priceUSD: 45,   vendor: 'Generic', partNumber: 'SFP28-25G-SR'     },
  { formFactor: 'SFP28',   speed: '25G',  reach: '10km',  reachM: 10000, priceUSD: 120,  vendor: 'Generic', partNumber: 'SFP28-25G-LR'     },
  { formFactor: 'QSFP28',  speed: '100G', reach: '100m',  reachM: 100,   priceUSD: 180,  vendor: 'Generic', partNumber: 'QSFP-100G-SR4'    },
  { formFactor: 'QSFP28',  speed: '100G', reach: '10km',  reachM: 10000, priceUSD: 420,  vendor: 'Generic', partNumber: 'QSFP-100G-LR4'    },
  { formFactor: 'QSFP28',  speed: '100G', reach: '500m',  reachM: 500,   priceUSD: 95,   vendor: 'Generic', partNumber: 'QSFP-100G-PSM4'   },
  { formFactor: 'QSFP-DD', speed: '400G', reach: '100m',  reachM: 100,   priceUSD: 950,  vendor: 'Generic', partNumber: 'QSFP-DD-400G-SR4' },
  { formFactor: 'QSFP-DD', speed: '400G', reach: '2km',   reachM: 2000,  priceUSD: 1800, vendor: 'Generic', partNumber: 'QSFP-DD-400G-FR4' },
]

export function buildOptics(
  devices: BOMDevice[],
  linkDistances: AppState['linkDistances'],
): import('@/types').OpticsEntry[] {
  const cabling = buildCabling(devices, linkDistances)
  const entries: import('@/types').OpticsEntry[] = []

  for (const link of cabling) {
    const optic = OPTIC_CATALOG
      .filter(o => o.speed === link.speed && o.reachM >= link.lengthM)
      .sort((a, b) => a.priceUSD - b.priceUSD)[0]
    if (!optic) continue

    const qty        = link.quantity * 2
    const totalPrice = optic.priceUSD * qty

    entries.push({
      id:          `optic-${link.id}`,
      linkGroup:   `${link.fromLayer} → ${link.toLayer}`,
      formFactor:  optic.formFactor,
      speed:       optic.speed,
      reach:       optic.reach,
      priceUSD:    optic.priceUSD,
      quantity:    qty,
      totalPrice,
      vendor:      optic.vendor,
      partNumber:  optic.partNumber,
    })
  }

  return entries
}

// ── BOM design validation ───────────────────────────────────────────────────

export interface BOMValidationIssue {
  severity: 'error' | 'warning' | 'info'
  category: 'oversubscription' | 'fan-out' | 'power' | 'redundancy' | 'capacity'
  message: string
}

export function validateBOM(
  devices: BOMDevice[],
  state: {
    useCase?: string
    totalEndpoints?: number
    bandwidthPerServer?: string
    oversubscription?: number
  } = {},
): BOMValidationIssue[] {
  const issues: BOMValidationIssue[] = []
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const spines = devices.filter(d => d.subLayer === 'spine')

  if (leaves.length === 0 || spines.length === 0) return issues

  const leafSample = leaves[0]
  const spineSample = spines[0]
  const leafUplinks = leafSample.uplinks ?? 0
  const leafDownlinks = Math.max(1, leafSample.ports - leafUplinks)
  const bwGbps = parseInt(state.bandwidthPerServer ?? '25') || 25
  const requestedOversub = Math.max(1, state.oversubscription ?? 3)
  const spinePortSpeed = Math.max(1, parseInt(spineSample.speed) || 100)

  const serverCapPerLeaf = leafDownlinks * bwGbps
  const rawUplinksNeeded = Math.ceil(serverCapPerLeaf / requestedOversub / spinePortSpeed)

  if (rawUplinksNeeded > leafUplinks && leafUplinks > 0) {
    const effectiveOversub = serverCapPerLeaf / (leafUplinks * spinePortSpeed)
    issues.push({
      severity: 'warning',
      category: 'oversubscription',
      message: `Requested ${requestedOversub}:1 oversubscription needs ${rawUplinksNeeded} uplinks per leaf, but ${leafSample.model} has ${leafUplinks}. Effective ratio: ${effectiveOversub.toFixed(1)}:1. Consider a leaf with more uplink ports.`,
    })
  }

  if (leaves.length > spineSample.ports) {
    issues.push({
      severity: 'warning',
      category: 'fan-out',
      message: `${leaves.length} leaves exceed ${spineSample.model} port count (${spineSample.ports}). Multi-plane or higher-radix spines needed for full Clos connectivity.`,
    })
  }

  if (spines.length > leafUplinks && leafUplinks > 0) {
    issues.push({
      severity: 'warning',
      category: 'fan-out',
      message: `${spines.length} spines exceed ${leafSample.model} uplink count (${leafUplinks}). Not all leaves can connect to all spines — partial Clos fabric.`,
    })
  }

  if (leaves.length < 2) {
    issues.push({
      severity: 'error',
      category: 'redundancy',
      message: 'Only 1 leaf switch — no host redundancy. Minimum 2 leaves recommended for MLAG/vPC.',
    })
  }

  if (spines.length < 2) {
    issues.push({
      severity: 'error',
      category: 'redundancy',
      message: 'Only 1 spine switch — single point of failure in the fabric.',
    })
  }

  const endpoints = state.totalEndpoints ?? 0
  const totalDownlinks = leaves.length * leafDownlinks
  if (endpoints > 0 && endpoints > totalDownlinks) {
    issues.push({
      severity: 'error',
      category: 'capacity',
      message: `${endpoints} endpoints exceed total leaf downlink capacity (${totalDownlinks} ports). Add more leaf switches or use higher-density models.`,
    })
  }

  if (endpoints > 0 && totalDownlinks > 0) {
    const util = endpoints / totalDownlinks
    if (util < 0.2) {
      issues.push({
        severity: 'info',
        category: 'capacity',
        message: `Leaf port utilization is ${Math.round(util * 100)}% — heavily over-provisioned. Consider fewer or smaller leaf switches to reduce cost.`,
      })
    }
  }

  const totalPowerW = devices.reduce((s, d) => {
    const prod = PRODUCTS.find(p => p.model === d.model)
    return s + (prod?.powerW ?? 500)
  }, 0)
  if (totalPowerW > 40000) {
    issues.push({
      severity: 'info',
      category: 'power',
      message: `Total power draw is ${(totalPowerW / 1000).toFixed(1)} kW. Verify data center power and cooling capacity.`,
    })
  }

  return issues
}
