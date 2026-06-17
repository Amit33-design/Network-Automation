// ─────────────────────────────────────────────────────────────────────────────
// NetBox / Nautobot inventory import (Enterprise upgrade B1)
//
// Reads existing inventory from a NetBox or Nautobot instance and maps it to
// Step 1 form fields (org name, number of sites, org size, vendor prefs) plus
// a normalized device list stored for the Step 6 ZTP tab (B2).
//
// Nautobot uses the same REST paths as NetBox (/api/dcim/sites/,
// /api/dcim/devices/, /api/ipam/prefixes/, /api/tenancy/tenants/) so a single
// implementation covers both. Browser fetch requires the instance to have
// CORS configured for this app's origin (NetBox → Administration → CORS).
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgSize, UseCase, NetBoxImportedDevice } from '@/types'

// ── Raw API shapes (subset of fields we read) ────────────────────────────────
export interface NetBoxRawDevice {
  name?: string | null
  device_type?: {
    model?: string | null
    manufacturer?: { name?: string | null } | null
  } | null
  /** NetBox ≥3.6 / Nautobot */
  role?: { slug?: string | null; name?: string | null } | null
  /** NetBox <3.6 legacy field */
  device_role?: { slug?: string | null; name?: string | null } | null
  site?: { name?: string | null } | null
  primary_ip?: { address?: string | null } | null
}

export interface NetBoxRawSite { name?: string | null }
export interface NetBoxRawTenant { name?: string | null }
export interface NetBoxRawPrefix { prefix?: string | null }

export interface NetBoxInventory {
  sites: NetBoxRawSite[]
  devices: NetBoxRawDevice[]
  prefixes: NetBoxRawPrefix[]
  tenants: NetBoxRawTenant[]
}

// ── Vendor name normalization (manufacturer → app vendor label) ─────────────
const VENDOR_MAP: Record<string, string> = {
  cisco: 'Cisco',
  cisco_systems: 'Cisco',
  arista: 'Arista',
  arista_networks: 'Arista',
  juniper: 'Juniper',
  juniper_networks: 'Juniper',
  fortinet: 'Fortinet',
  palo_alto: 'Palo Alto',
  palo_alto_networks: 'Palo Alto',
  hpe: 'HPE Aruba',
  hpe_aruba: 'HPE Aruba',
  aruba: 'HPE Aruba',
  aruba_networks: 'HPE Aruba',
  dell: 'Dell EMC',
  dell_emc: 'Dell EMC',
  dell_technologies: 'Dell EMC',
  nvidia: 'NVIDIA',
  mellanox: 'NVIDIA',
  extreme: 'Extreme Networks',
  extreme_networks: 'Extreme Networks',
}

export function normalizeVendor(name: string | null | undefined): string | null {
  if (!name) return null
  const slug = name.toLowerCase().replace(/[\s\-./]+/g, '_')
  return VENDOR_MAP[slug] ?? null
}

// ── Device role → use-case heuristic ────────────────────────────────────────
const ROLE_UC_MAP: Record<string, UseCase> = {
  'access': 'campus',
  'access-switch': 'campus',
  'distribution': 'campus',
  'dist-switch': 'campus',
  'core': 'campus',
  'core-switch': 'campus',
  'wlc': 'campus',
  'leaf': 'dc',
  'spine': 'dc',
  'tor': 'dc',
  'top-of-rack': 'dc',
  'superspine': 'dc',
  'border': 'dc',
  'gpu': 'gpu',
  'compute': 'gpu',
  'storage': 'gpu',
  'wan': 'wan',
  'cpe': 'wan',
  'branch': 'wan',
  'sdwan': 'wan',
  'edge-router': 'wan',
  'router': 'wan',
}

export function roleToUseCase(roleSlug: string | null | undefined): UseCase | null {
  if (!roleSlug) return null
  const key = roleSlug.toLowerCase().replace(/[\s/]+/g, '-')
  return ROLE_UC_MAP[key] ?? null
}

// ── Device count → org size (matches the OrgSize select in Step 1) ──────────
export function orgSizeFromDeviceCount(n: number): OrgSize {
  if (n < 15) return 'startup'
  if (n < 80) return 'smb'
  if (n < 400) return 'midmarket'
  if (n < 2000) return 'enterprise'
  return 'hyperscale'
}

// ── Fetch + pagination ───────────────────────────────────────────────────────
type FetchLike = typeof fetch
const PAGE_SIZE = 200

interface NetBoxListResponse<T> {
  count?: number
  results?: T[]
  detail?: string
}

async function nbFetch<T>(base: string, token: string, path: string, fetchImpl: FetchLike): Promise<NetBoxListResponse<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Token ${token}`
  const res = await fetchImpl(base.replace(/\/$/, '') + path, { headers })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as NetBoxListResponse<unknown>
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
  return res.json() as Promise<NetBoxListResponse<T>>
}

async function nbFetchAll<T>(base: string, token: string, path: string, fetchImpl: FetchLike): Promise<T[]> {
  const first = await nbFetch<T>(base, token, `${path}?limit=${PAGE_SIZE}&offset=0`, fetchImpl)
  let results = first.results ?? []
  const count = first.count ?? 0
  if (count <= PAGE_SIZE) return results

  const pages: Promise<NetBoxListResponse<T>>[] = []
  for (let offset = PAGE_SIZE; offset < count; offset += PAGE_SIZE) {
    pages.push(nbFetch<T>(base, token, `${path}?limit=${PAGE_SIZE}&offset=${offset}`, fetchImpl))
  }
  for (const chunk of await Promise.all(pages)) {
    results = results.concat(chunk.results ?? [])
  }
  return results
}

/** Fetches sites, devices, prefixes, and tenants. Prefixes/tenants are optional
 *  (some instances restrict those endpoints) and fail soft to `[]`. */
export async function fetchNetBoxInventory(url: string, token: string, fetchImpl: FetchLike = fetch): Promise<NetBoxInventory> {
  const base = url.replace(/\/$/, '')
  const [sites, devices, prefixes, tenants] = await Promise.all([
    nbFetchAll<NetBoxRawSite>(base, token, '/api/dcim/sites/', fetchImpl),
    nbFetchAll<NetBoxRawDevice>(base, token, '/api/dcim/devices/', fetchImpl),
    nbFetchAll<NetBoxRawPrefix>(base, token, '/api/ipam/prefixes/', fetchImpl).catch(() => []),
    nbFetchAll<NetBoxRawTenant>(base, token, '/api/tenancy/tenants/', fetchImpl).catch(() => []),
  ])
  return { sites, devices, prefixes, tenants }
}

// ── Summarize for the preview table ──────────────────────────────────────────
export interface NetBoxImportPreview {
  orgName: string
  siteCount: number
  deviceCount: number
  orgSize: OrgSize
  vendors: string[]
  useCaseHint: UseCase | null
  useCaseVotes: number
}

function deviceRoleSlug(d: NetBoxRawDevice): string {
  return d.role?.slug || d.role?.name || d.device_role?.slug || d.device_role?.name || ''
}

export function summarizeInventory(inv: NetBoxInventory): NetBoxImportPreview {
  const vendorSet = new Set<string>()
  const ucVotes: Partial<Record<UseCase, number>> = {}

  for (const d of inv.devices) {
    const vendor = normalizeVendor(d.device_type?.manufacturer?.name)
    if (vendor) vendorSet.add(vendor)
    const uc = roleToUseCase(deviceRoleSlug(d))
    if (uc) ucVotes[uc] = (ucVotes[uc] ?? 0) + 1
  }

  let useCaseHint: UseCase | null = null
  let useCaseVotes = 0
  for (const [uc, votes] of Object.entries(ucVotes) as Array<[UseCase, number]>) {
    if (votes > useCaseVotes) { useCaseVotes = votes; useCaseHint = uc }
  }

  return {
    orgName: inv.tenants[0]?.name || inv.sites[0]?.name || '',
    siteCount: inv.sites.length,
    deviceCount: inv.devices.length,
    orgSize: inv.devices.length ? orgSizeFromDeviceCount(inv.devices.length) : '',
    vendors: [...vendorSet],
    useCaseHint,
    useCaseVotes,
  }
}

// ── Map inventory → store patch (applied by the panel via store setters) ────
export interface NetBoxStorePatch {
  orgName?: string
  numSites?: number
  orgSize?: OrgSize
  vendorPrefs?: string[]
  netboxDevices: NetBoxImportedDevice[]
}

export function toImportedDevices(inv: NetBoxInventory): NetBoxImportedDevice[] {
  return inv.devices
    .filter(d => d.name)
    .map(d => ({
      name: d.name as string,
      vendor: normalizeVendor(d.device_type?.manufacturer?.name) || (d.device_type?.manufacturer?.name ?? ''),
      model: d.device_type?.model ?? '',
      role: deviceRoleSlug(d),
      site: d.site?.name ?? '',
      primaryIp: d.primary_ip?.address ?? '',
    }))
}

export function inventoryToStorePatch(inv: NetBoxInventory): NetBoxStorePatch {
  const preview = summarizeInventory(inv)
  const patch: NetBoxStorePatch = { netboxDevices: toImportedDevices(inv) }
  if (preview.orgName) patch.orgName = preview.orgName
  if (preview.siteCount) patch.numSites = preview.siteCount
  if (preview.orgSize) patch.orgSize = preview.orgSize
  if (preview.vendors.length) patch.vendorPrefs = preview.vendors
  return patch
}

// ── Sample inventory (demo mode — no NetBox instance required) ──────────────
export const SAMPLE_INVENTORY: NetBoxInventory = {
  tenants: [{ name: 'Acme Corporation' }],
  sites: [{ name: 'IAD — Ashburn DC' }, { name: 'PDX — Hillsboro DC' }],
  prefixes: [{ prefix: '10.0.0.0/8' }],
  devices: [
    ...Array.from({ length: 4 }, (_, i) => ({
      name: `IAD-SPINE-A0${i + 1}`,
      device_type: { model: 'N9K-C9336C-FX2', manufacturer: { name: 'Cisco' } },
      role: { slug: 'spine' },
      site: { name: 'IAD — Ashburn DC' },
      primary_ip: { address: `10.255.1.${i + 1}/32` },
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      name: `IAD-LEAF-A${String(i + 1).padStart(2, '0')}`,
      device_type: { model: 'N9K-C93180YC-FX3', manufacturer: { name: 'Cisco' } },
      role: { slug: 'leaf' },
      site: { name: 'IAD — Ashburn DC' },
      primary_ip: { address: `10.255.2.${i + 1}/32` },
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      name: `PDX-LEAF-A${String(i + 1).padStart(2, '0')}`,
      device_type: { model: 'DCS-7050CX3-32S', manufacturer: { name: 'Arista Networks' } },
      role: { slug: 'leaf' },
      site: { name: 'PDX — Hillsboro DC' },
      primary_ip: { address: `10.255.3.${i + 1}/32` },
    })),
  ],
}
