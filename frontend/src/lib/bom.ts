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
