import type { AppState, BOMDevice, Scale, UseCase, CableLink, OpticsEntry } from '@/types'
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
  },
  medium: {
    dc:         { spine: 4, leaf: 8, firewall: 2 },
    gpu:        { spine: 4, leaf: 8 },
    campus:     { distribution: 4, access: 12, firewall: 2 },
    wan:        { 'wan-edge': 4 },
    multisite:  { spine: 4, leaf: 8, 'wan-edge': 4, firewall: 2 },
    multicloud: { 'cloud-transit': 2, 'cloud-gw': 4 },
    aviatrix:   { 'cloud-transit': 2, 'cloud-gw': 4 },
  },
  large: {
    dc:         { spine: 8, leaf: 24, firewall: 4 },
    gpu:        { spine: 8, leaf: 16 },
    campus:     { distribution: 8, access: 32, firewall: 4 },
    wan:        { 'wan-edge': 8 },
    multisite:  { spine: 8, leaf: 24, 'wan-edge': 8, firewall: 4 },
    multicloud: { 'cloud-transit': 4, 'cloud-gw': 8 },
    aviatrix:   { 'cloud-transit': 4, 'cloud-gw': 8 },
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
}

// ── Role codes for hostnames ─────────────────────────────────────────────────

const ROLE_CODE: Record<string, string> = {
  spine:          'SPINE',
  leaf:           'LEAF',
  distribution:   'DIST',
  access:         'ACC',
  'wan-edge':     'WAN',
  firewall:       'FW',
  'cloud-gw':     'CGW',
  'cloud-transit':'CTGW',
  core:           'CORE',
}

function rackLabel(idx: number): string {
  return String.fromCharCode(65 + Math.floor(idx / 2))
}

export function generateHostnames(devices: BOMDevice[], siteCode: string): BOMDevice[] {
  const site = (siteCode || 'SITE').toUpperCase().slice(0, 5)
  const counters: Record<string, number> = {}

  return devices.map(dev => {
    const code = ROLE_CODE[dev.subLayer] ?? dev.subLayer.toUpperCase().slice(0, 4)
    if (!counters[code]) counters[code] = 0
    const idx = counters[code]++
    const rack = rackLabel(idx)
    const num = String((idx % 2) + 1).padStart(2, '0')
    return { ...dev, hostname: `${site}-${code}-${rack}${num}` }
  })
}

// ── Device list builder ───────────────────────────────────────────────────────

export function buildDeviceList(state: Pick<AppState, 'useCase' | 'scale' | 'siteCode'>): BOMDevice[] {
  const useCase = (state.useCase || 'dc') as UseCase
  const scale = (state.scale || 'small') as Scale

  const scaleDef = (SCALE_DEFS[scale] ?? SCALE_DEFS.small)[useCase] ?? SCALE_DEFS.small.dc
  const prefs = PREFERRED_PRODUCTS[useCase] ?? PREFERRED_PRODUCTS.dc

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
        features: product.features,
      })
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
  features: string[]
  detail: string
}

export function buildBOM(state: Pick<AppState, 'useCase' | 'scale' | 'siteCode'>): {
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

// ── Cable catalog ─────────────────────────────────────────────────────────────

interface CableSpec {
  type: 'DAC' | 'AOC' | 'LC-LC' | 'MPO'
  desc: string
  maxDist: number
  speeds: string[]
  unitCost: number
  costPerM: number
}

const CABLE_SPECS: CableSpec[] = [
  { type: 'DAC',   desc: 'Direct Attach Copper 1m',     maxDist: 1,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 25,  costPerM: 0   },
  { type: 'DAC',   desc: 'Direct Attach Copper 3m',     maxDist: 3,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 35,  costPerM: 0   },
  { type: 'DAC',   desc: 'Direct Attach Copper 5m',     maxDist: 5,     speeds: ['1G','10G','25G','40G','100G'], unitCost: 45,  costPerM: 0   },
  { type: 'DAC',   desc: 'QSFP DAC 3m',                 maxDist: 3,     speeds: ['40G','100G','400G'],           unitCost: 65,  costPerM: 0   },
  { type: 'AOC',   desc: 'Active Optical Cable 10m',    maxDist: 10,    speeds: ['10G','25G','40G','100G'],      unitCost: 80,  costPerM: 8   },
  { type: 'AOC',   desc: 'Active Optical Cable 30m',    maxDist: 30,    speeds: ['10G','25G','40G','100G'],      unitCost: 240, costPerM: 8   },
  { type: 'MPO',   desc: 'MPO-12 OM4 100m',             maxDist: 100,   speeds: ['40G','100G','400G'],           unitCost: 20,  costPerM: 1.2 },
  { type: 'LC-LC', desc: 'LC-LC Single-mode Fiber',     maxDist: 10000, speeds: ['1G','10G','25G','100G'],       unitCost: 15,  costPerM: 0.5 },
]

const CABLE_PRIORITY: Record<string, number> = { DAC: 0, AOC: 1, MPO: 2, 'LC-LC': 3 }

function selectCable(distM: number, speed: string): CableSpec {
  const candidates = CABLE_SPECS.filter(c => c.maxDist >= distM && c.speeds.includes(speed))
  if (!candidates.length) return CABLE_SPECS.find(c => c.type === 'LC-LC')!
  return candidates.sort((a, b) => CABLE_PRIORITY[a.type] - CABLE_PRIORITY[b.type])[0]
}

const LAYER_CONNECTS: Array<{ from: string; to: string; key: string }> = [
  { from: 'spine',         to: 'leaf',         key: 'spine-leaf'  },
  { from: 'core',          to: 'distribution', key: 'core-dist'   },
  { from: 'distribution',  to: 'access',       key: 'dist-access' },
  { from: 'wan-edge',      to: 'distribution', key: 'wan-edge'    },
  { from: 'wan-edge',      to: 'spine',        key: 'wan-edge'    },
  { from: 'firewall',      to: 'distribution', key: 'wan-edge'    },
  { from: 'firewall',      to: 'spine',        key: 'spine-leaf'  },
]

export function buildCabling(
  devices: BOMDevice[],
  linkDistances: AppState['linkDistances'],
): CableLink[] {
  const byLayer = devices.reduce<Record<string, BOMDevice[]>>((acc, d) => {
    acc[d.subLayer] = [...(acc[d.subLayer] ?? []), d]
    return acc
  }, {})

  const links: CableLink[] = []
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
  subLayers:  string[]
}

const OPTIC_CATALOG: OpticSpec[] = [
  { formFactor: 'SFP+',   speed: '10G',  reach: '300m',  reachM: 300,   priceUSD: 25,  vendor: 'Generic', partNumber: 'SFP-10G-SR',      subLayers: ['leaf','access','distribution'] },
  { formFactor: 'SFP+',   speed: '10G',  reach: '10km',  reachM: 10000, priceUSD: 55,  vendor: 'Generic', partNumber: 'SFP-10G-LR',      subLayers: ['leaf','distribution','wan-edge','firewall'] },
  { formFactor: 'SFP28',  speed: '25G',  reach: '100m',  reachM: 100,   priceUSD: 45,  vendor: 'Generic', partNumber: 'SFP28-25G-SR',    subLayers: ['leaf','distribution'] },
  { formFactor: 'SFP28',  speed: '25G',  reach: '10km',  reachM: 10000, priceUSD: 120, vendor: 'Generic', partNumber: 'SFP28-25G-LR',    subLayers: ['leaf','distribution','wan-edge'] },
  { formFactor: 'QSFP28', speed: '100G', reach: '100m',  reachM: 100,   priceUSD: 180, vendor: 'Generic', partNumber: 'QSFP-100G-SR4',   subLayers: ['spine','leaf','distribution'] },
  { formFactor: 'QSFP28', speed: '100G', reach: '10km',  reachM: 10000, priceUSD: 420, vendor: 'Generic', partNumber: 'QSFP-100G-LR4',   subLayers: ['spine','wan-edge'] },
  { formFactor: 'QSFP28', speed: '100G', reach: '500m',  reachM: 500,   priceUSD: 95,  vendor: 'Generic', partNumber: 'QSFP-100G-PSM4',  subLayers: ['spine','leaf'] },
  { formFactor: 'QSFP-DD', speed: '400G', reach: '100m', reachM: 100,   priceUSD: 950, vendor: 'Generic', partNumber: 'QSFP-DD-400G-SR4',subLayers: ['spine'] },
  { formFactor: 'QSFP-DD', speed: '400G', reach: '2km',  reachM: 2000,  priceUSD: 1800,vendor: 'Generic', partNumber: 'QSFP-DD-400G-FR4',subLayers: ['spine','wan-edge'] },
]

export function buildOptics(
  devices: BOMDevice[],
  linkDistances: AppState['linkDistances'],
): OpticsEntry[] {
  const cabling = buildCabling(devices, linkDistances)
  const entries: OpticsEntry[] = []

  for (const link of cabling) {
    const speed   = link.speed
    const distM   = link.lengthM

    const optic = OPTIC_CATALOG
      .filter(o => o.speed === speed && o.reachM >= distM)
      .sort((a, b) => a.priceUSD - b.priceUSD)[0]

    if (!optic) continue

    const qty        = link.quantity * 2  // both ends
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
