// ── NetBox / Nautobot DCIM cable-plant export (group F2) ─────────────────────
//
// Companion to lib/ipam.ts (IPAM CSV export). Devices + IPAM already sync to
// NetBox, but the designed physical layer — interfaces and the cable plant —
// did not. This module turns the BOM devices + computed cabling into
// NetBox-importable dcim.device / dcim.interface / dcim.cable CSVs so the
// spine↔leaf (and edge/border) cable plant lands in NetBox DCIM as a
// source-of-truth. Pure + deterministic (mirrors the RackElevation cable
// schedule expansion; no component imports).

import type { BOMDevice, CableLink } from '@/types'

// ── CSV helpers (RFC 4180, same convention as ipam.ts) ────────────────────────

function csvCell(value: string): string {
  const v = value ?? ''
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

const slug = (s: string): string =>
  (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ── Vendor / speed / cable-type → NetBox enum mappings ────────────────────────

/** Map a device speed string ("100G", "400G", "25G"…) to a NetBox interface type. */
export function netboxInterfaceType(speed: string): string {
  const s = (speed || '').toLowerCase().replace(/\s+/g, '')
  if (s.includes('400g')) return '400gbase-x-qsfpdd'
  if (s.includes('200g')) return '200gbase-x-qsfp56'
  if (s.includes('100g')) return '100gbase-x-qsfp28'
  if (s.includes('40g'))  return '40gbase-x-qsfpp'
  if (s.includes('25g'))  return '25gbase-x-sfp28'
  if (s.includes('10g'))  return '10gbase-x-sfpp'
  if (s.includes('1g') || s.includes('1000')) return '1000base-t'
  return 'other'
}

/** Map a cable type ("DAC", "AOC", "SMF", "MMF", "Cat6"…) to a NetBox cable type. */
export function netboxCableType(cableType: string, medium?: string): string {
  // Prefer the link's declared medium (AF1). Inferring from the cable TYPE
  // alone cannot work: "MPO" is a connector, not a glass, so every MPO run
  // used to fall through to the `smf` default below and NetBox recorded a
  // multimode OM4 trunk as single-mode.
  if (medium === 'copper') return 'dac-passive'
  if (medium === 'aoc') return 'aoc'
  if (medium === 'mmf') return 'mmf'
  if (medium === 'smf') return 'smf'

  const c = (cableType || '').toLowerCase()
  if (c.includes('aoc')) return 'aoc'
  if (c.includes('dac') || c.includes('twinax') || c.includes('copper')) return 'dac-passive'
  if (c.includes('smf') || c.includes('single')) return 'smf'
  if (c.includes('mmf') || c.includes('multi') || c.includes('om4') || c.includes('om3')) return 'mmf'
  if (c.includes('cat') || c.includes('rj45') || c.includes('utp')) return 'cat6'
  if (c.includes('fiber') || c.includes('fibre') || c.includes('optic')) return 'smf'
  return 'smf'
}

// ── Cable-plant expansion (pure mirror of RackElevation.buildCableSchedule) ────

export interface DcimEndpoint { device: string; iface: string }
export interface DcimCable {
  a: DcimEndpoint
  b: DcimEndpoint
  cableType: string
  /** OM4 vs OS2 vs copper — see `CableLink.medium` (AF1). */
  medium?: string
  speed: string
  lengthM: number
}

/**
 * Expand the aggregate CableLink plan into concrete device-to-device runs with
 * UNIQUE per-device interface names (NetBox cables require distinct named
 * endpoints). Interface names are allocated sequentially per device as the
 * cabling is walked (deterministic given the same device/cabling order).
 */
/**
 * Expand the aggregate cable plan into concrete device-to-device runs.
 *
 * This used to emit a full `fromDevs x toDevs` mesh and ignore `quantity`
 * entirely, so a 20-device DC design whose BOM billed **74** runs exported
 * **280**: every leaf cabled to every other leaf and to itself (196 runs for
 * a 14-member peer-link tier), and every firewall cabled to every leaf rather
 * than to the two border leaves Z3 actually wires. A customer importing that
 * into NetBox received a fabricated cable plant nearly four times the real
 * size — in the artifact whose purpose is to be the source of truth (AG2).
 *
 * The count is now exactly `link.quantity`, always. Pair ORDER is chosen to
 * match how the fabric is really wired so the endpoints are meaningful too:
 * spine-leaf is staggered the way `closFabricLinks` assigns uplinks, a
 * same-layer peer-link runs between consecutive HA pair members, and anything
 * else walks the cross-product in order.
 */
function candidatePairs(
  link: CableLink, fromDevs: BOMDevice[], toDevs: BOMDevice[],
): Array<[BOMDevice, BOMDevice]> {
  const pairs: Array<[BOMDevice, BOMDevice]> = []

  // Same-layer runs are HA peer-links: A01<->A02, B01<->B02, ...
  if (link.fromLayer === link.toLayer) {
    for (let i = 0; i + 1 < fromDevs.length; i += 2) pairs.push([fromDevs[i], fromDevs[i + 1]])
    return pairs
  }

  const isSpineLeaf =
    (link.fromLayer === 'spine' && link.toLayer === 'leaf') ||
    (link.fromLayer === 'leaf' && link.toLayer === 'spine')
  if (isSpineLeaf) {
    const leaves = link.fromLayer === 'leaf' ? fromDevs : toDevs
    const spines = link.fromLayer === 'leaf' ? toDevs : fromDevs
    const uplinks = Math.max(1, leaves[0]?.uplinks ?? 1)
    // Staggered round-robin, matching configgen's closFabricLinks: leaf i's
    // k-th uplink lands on spine (i + k) % spineCount, so no spine goes dark.
    for (let i = 0; i < leaves.length; i++) {
      for (let k = 0; k < uplinks; k++) {
        const spine = spines[(i + k) % spines.length]
        if (!spine) continue
        pairs.push(link.fromLayer === 'leaf' ? [leaves[i], spine] : [spine, leaves[i]])
      }
    }
    return pairs
  }

  for (const fd of fromDevs) for (const td of toDevs) pairs.push([fd, td])
  return pairs
}

export function expandCablePlan(devices: BOMDevice[], cabling: CableLink[]): DcimCable[] {
  const cables: DcimCable[] = []
  const portCounter = new Map<string, number>()
  const nextIface = (device: string): string => {
    const n = (portCounter.get(device) ?? 0) + 1
    portCounter.set(device, n)
    return `Ethernet1/${n}`
  }
  const push = (a: string, b: string, link: CableLink) => cables.push({
    a: { device: a, iface: nextIface(a) },
    b: { device: b, iface: nextIface(b) },
    cableType: link.cableType, medium: link.medium, speed: link.speed, lengthM: link.lengthM,
  })

  for (const link of cabling) {
    const fromDevs = devices.filter(d => d.subLayer === link.fromLayer)
    const toDevs   = devices.filter(d => d.subLayer === link.toLayer)
    const qty = Math.max(0, link.quantity)

    if (fromDevs.length === 0 || toDevs.length === 0) {
      // Fall back to the aggregate labels when the layer isn't in the BOM.
      const a = link.fromDevice || link.fromLayer
      const b = link.toDevice || link.toLayer
      for (let i = 0; i < qty; i++) push(a, b, link)
      continue
    }

    const pairs = candidatePairs(link, fromDevs, toDevs)
    if (!pairs.length) continue
    // Exactly `quantity` runs: the plan and the schedule must agree on how
    // many cables a contractor is being asked to pull.
    for (let i = 0; i < qty; i++) {
      const [fd, td] = pairs[i % pairs.length]
      push(fd.hostname || fd.model, td.hostname || td.model, link)
    }
  }
  return cables
}


// ── Rack layout structural types (F3) ─────────────────────────────────────────
// Structurally compatible with RackElevation's RackAssignment/RackSlot so the
// page can pass computeRackLayout(...) straight in without this lib importing
// from a component file.

export interface RackExportSlot {
  /** 1-based U position counting from the TOP of the rack (RackElevation convention). */
  startU: number
  heightU: number
  device: { hostname: string; model: string }
}

export interface RackExport {
  label: string
  totalU: number
  slots: RackExportSlot[]
}

/**
 * Convert a top-counted slot to NetBox `position` — the LOWEST occupied U,
 * counting from the BOTTOM of the rack (NetBox convention, 1-based).
 */
export function netboxRackPosition(slot: RackExportSlot, totalU: number): number {
  return totalU - slot.startU - slot.heightU + 2
}

/** NetBox `dcim.rack` import CSV. */
export function toNetBoxRackCsv(racks: RackExport[], siteName = 'NDAI Site'): string {
  const header = 'name,site,status,u_height'
  const site = siteName || 'NDAI Site'
  const lines = racks.map(r => csvRow([r.label, site, 'active', String(r.totalU)]))
  return [header, ...lines].join('\n') + '\n'
}

// ── CSV emitters ──────────────────────────────────────────────────────────────

/**
 * NetBox `dcim.device` import CSV (one row per BOM device). When `racks` is
 * given, each row also carries its rack placement (`rack,position,face` —
 * position bottom-counted per NetBox convention).
 */
export function toNetBoxDeviceCsv(
  devices: BOMDevice[],
  siteName = 'NDAI Site',
  racks?: RackExport[],
): string {
  const withRacks = !!racks && racks.length > 0
  const header = 'name,device_role,manufacturer,device_type,site,status'
    + (withRacks ? ',rack,position,face' : '')
  const site = siteName || 'NDAI Site'

  const placement = new Map<string, { rack: string; position: number }>()
  if (withRacks) {
    for (const r of racks) {
      for (const s of r.slots) {
        const name = s.device.hostname || s.device.model
        if (name && !placement.has(name)) {
          placement.set(name, { rack: r.label, position: netboxRackPosition(s, r.totalU) })
        }
      }
    }
  }

  const seen = new Set<string>()
  const lines: string[] = []
  for (const d of devices) {
    const name = d.hostname || d.model
    if (!name || seen.has(name)) continue
    seen.add(name)
    const cells = [name, slug(d.role), d.vendor, d.model, site, 'active']
    if (withRacks) {
      const p = placement.get(name)
      cells.push(p?.rack ?? '', p ? String(p.position) : '', p ? 'front' : '')
    }
    lines.push(csvRow(cells))
  }
  return [header, ...lines].join('\n') + '\n'
}

/**
 * NetBox `dcim.interface` import CSV — the union of every interface referenced
 * by the cable plan, de-duplicated by (device, name).
 */
export function toNetBoxInterfaceCsv(cables: DcimCable[]): string {
  const header = 'device,name,type,enabled'
  const seen = new Set<string>()
  const lines: string[] = []
  const add = (ep: DcimEndpoint, speed: string) => {
    const key = `${ep.device} ${ep.iface}`
    if (seen.has(key)) return
    seen.add(key)
    lines.push(csvRow([ep.device, ep.iface, netboxInterfaceType(speed), 'true']))
  }
  for (const c of cables) { add(c.a, c.speed); add(c.b, c.speed) }
  return [header, ...lines].join('\n') + '\n'
}

/** NetBox `dcim.cable` import CSV (4.x side_a/side_b columns). */
export function toNetBoxCableCsv(cables: DcimCable[]): string {
  const header = 'side_a_device,side_a_type,side_a_name,side_b_device,side_b_type,side_b_name,type,status,length,length_unit'
  const lines = cables.map(c => csvRow([
    c.a.device, 'dcim.interface', c.a.iface,
    c.b.device, 'dcim.interface', c.b.iface,
    netboxCableType(c.cableType, c.medium), 'connected',
    c.lengthM > 0 ? String(c.lengthM) : '', c.lengthM > 0 ? 'm' : '',
  ]))
  return [header, ...lines].join('\n') + '\n'
}

export interface NetBoxDcimExport {
  devicesCsv: string
  interfacesCsv: string
  cablesCsv: string
  cableCount: number
  /** Present when a rack layout was supplied (F3). */
  racksCsv?: string
  rackCount?: number
}

/**
 * Build the NetBox DCIM CSVs from the BOM devices + computed cabling.
 * Pass `racks` (from RackElevation's computeRackLayout) to also emit the
 * dcim.rack CSV and enrich the device CSV with rack/position/face.
 */
export function buildNetBoxDcimExport(
  devices: BOMDevice[],
  cabling: CableLink[],
  siteName = 'NDAI Site',
  racks?: RackExport[],
): NetBoxDcimExport {
  const cables = expandCablePlan(devices, cabling)
  const out: NetBoxDcimExport = {
    devicesCsv: toNetBoxDeviceCsv(devices, siteName, racks),
    interfacesCsv: toNetBoxInterfaceCsv(cables),
    cablesCsv: toNetBoxCableCsv(cables),
    cableCount: cables.length,
  }
  if (racks && racks.length > 0) {
    out.racksCsv = toNetBoxRackCsv(racks, siteName)
    out.rackCount = racks.length
  }
  return out
}
