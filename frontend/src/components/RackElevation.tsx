import { useMemo } from 'react'
import { alphaLabel, devicePowerW, deviceRackUnits, rackUnitsAssumed } from '@/lib/bom'
import type { BOMDevice, CableLink, UseCase } from '@/types'
import { expandCablePlan } from '@/lib/netbox-dcim'

// ── Rack assignment types ──────────────────────────────────────────────────────

export interface RackSlot {
  startU: number
  heightU: number
  device: BOMDevice
  powerW: number
}

export interface RackAssignment {
  rackId: string
  label: string
  slots: RackSlot[]
  totalU: number
  usedU: number
  totalPowerW: number
  /** Fault domain this rack belongs to when redundancy is dual (AQ3). */
  side?: 'A' | 'B'
}

/** Inputs that shape the layout (AQ3). */
export interface RackLayoutOpts {
  /** The Step 1 redundancy selection. `dual` splits every HA pair across two fault domains. */
  redundancy?: 'single' | 'dual'
}

/**
 * Tiers whose pair members are redundant FOR EACH OTHER, so they must not
 * share a rack (AQ3): a rack losing power would otherwise take out both
 * firewalls of the cluster, both spines, both distribution switches. A leaf
 * pair is different — it is the top-of-rack pair for the servers in that same
 * rack, so it stays together and pairs alternate between domains instead.
 */
const SPLIT_PAIR_TIERS = new Set(['firewall', 'wan-edge', 'core', 'spine', 'distribution', 'sdwan-controller', 'oran-midhaul', 'oran-core', 'oran-timing', 'oran-cu'])

/**
 * The layout's redundancy from the two wizard selections (AQ3). Step 2's
 * redundancy model is the more specific choice, so it wins when set (HA/full
 * split pairs; none/basic keep them together); Step 1's single/dual is the
 * fallback.
 */
export function rackRedundancy(redundancy?: string, redundancyModel?: string): 'single' | 'dual' {
  if (redundancyModel === 'ha' || redundancyModel === 'full') return 'dual'
  if (redundancyModel === 'none' || redundancyModel === 'basic') return 'single'
  return redundancy === 'dual' ? 'dual' : 'single'
}

/** Which fault domain a device belongs to under dual redundancy. */
export function faultDomain(dev: BOMDevice, devices: BOMDevice[]): 'A' | 'B' {
  const tier = devices.filter(d => d.subLayer === dev.subLayer)
  const i = Math.max(0, tier.findIndex(d => d.id === dev.id))
  return (SPLIT_PAIR_TIERS.has(dev.subLayer) ? i % 2 : Math.floor(i / 2) % 2) === 0 ? 'A' : 'B'
}

export interface CableRun {
  id: string
  from: string
  to: string
  fromPort: string
  toPort: string
  /** Rack each end sits in, from the rack layout (AQ2). */
  fromRack?: string
  toRack?: string
  /** True when the generated config configures this end's interface (AP1). */
  fromConfigured?: boolean
  toConfigured?: boolean
  medium?: string
  cableType: string
  speed: string
  lengthM: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const RACK_U = 42

/**
 * Power a cabinet can actually be given, in watts (AF2).
 *
 * The layout tracked `totalPowerW` and never used it, packing purely by rack
 * units — so a 1024-endpoint DC put 32 devices and **17.3 kW** into one 42U
 * rack, and a 512-GPU design produced a **66 kW** compute rack. A standard
 * colo cabinet is sold at 5–10 kW; 15–20 kW is high-density and needs
 * specific cooling and busway. Nothing delivers 66 kW to a standard rack.
 *
 * 10 kW is the common enterprise/colo cabinet. High-density GPU rows are
 * genuinely provisioned higher, so the compute layout is allowed more — but
 * a number, not infinity.
 */
export const RACK_POWER_BUDGET_W = 10_000
export const GPU_RACK_POWER_BUDGET_W = 40_000
const U_HEIGHT = 14
const RACK_W = 320
const LABEL_W = 30
const SLOT_W = RACK_W - LABEL_W - 10
const MARGIN_TOP = 40
const MARGIN_BOTTOM = 30
const RACK_TOTAL_H = RACK_U * U_HEIGHT + MARGIN_TOP + MARGIN_BOTTOM

const ROLE_ORDER = [
  'sdwan-controller', 'firewall', 'wan-edge', 'core', 'spine',
  'distribution', 'leaf', 'access', 'gpu-compute', 'cloud-gw', 'cloud-transit',
]

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  spine:              { bg: '#1E3A5F', border: '#60A5FA', text: '#BAE6FD' },
  core:               { bg: '#1E3A5F', border: '#60A5FA', text: '#BAE6FD' },
  leaf:               { bg: '#0F4A2A', border: '#4ADE80', text: '#BBF7D0' },
  access:             { bg: '#0F4A2A', border: '#4ADE80', text: '#BBF7D0' },
  distribution:       { bg: '#3B1D60', border: '#A78BFA', text: '#DDD6FE' },
  'wan-edge':         { bg: '#4A2A0A', border: '#F59E0B', text: '#FDE68A' },
  'sdwan-controller': { bg: '#4A0A2A', border: '#F472B6', text: '#FBCFE8' },
  firewall:           { bg: '#5C1010', border: '#EF4444', text: '#FECACA' },
  'gpu-compute':      { bg: '#4A0E4E', border: '#E879F9', text: '#F5D0FE' },
  'cloud-gw':         { bg: '#0A3A4A', border: '#22D3EE', text: '#CFFAFE' },
  'cloud-transit':    { bg: '#0A3A4A', border: '#22D3EE', text: '#CFFAFE' },
}

function roleColor(subLayer: string) {
  return ROLE_COLORS[subLayer] ?? { bg: '#1F2937', border: '#6B7280', text: '#D1D5DB' }
}

const ROLE_POWER: Record<string, number> = {
  spine: 800, core: 800, leaf: 480, distribution: 600, access: 400,
  'wan-edge': 300, 'sdwan-controller': 300, firewall: 800,
  'gpu-compute': 6500, 'cloud-gw': 0, 'cloud-transit': 0,
}

function devicePower(d: BOMDevice): number {
  // One power lookup for the whole codebase (AF2). This used to be a private
  // role-average table that ignored the catalogue, so the rack layout — the
  // thing that decides how many cabinets you buy — ran on the least accurate
  // of the three power numbers in the repo.
  return devicePowerW(d, ROLE_POWER[d.subLayer] ?? 400)
}

// ── Rack layout computation ──────────────────────────────────────────────────

export function computeRackLayout(devices: BOMDevice[], opts: RackLayoutOpts = {}): RackAssignment[] {
  const hasCompute = devices.some(d => d.subLayer === 'gpu-compute')
  return hasCompute ? computeToRLayout(devices, opts) : computeDenseLayout(devices, opts)
}

/**
 * Pack `devices` into racks, and under dual redundancy pack each fault domain
 * separately so no HA pair shares a rack (AQ3). Domains interleave (A, B, A,
 * B…) so adjacent racks are the two halves of the design.
 */
function packByDomain(
  devices: BOMDevice[], all: BOMDevice[], opts: RackLayoutOpts,
  pack: (devs: BOMDevice[]) => RackAssignment[], relabel: (r: RackAssignment, n: number) => void,
): RackAssignment[] {
  if (opts.redundancy !== 'dual') return pack(devices)
  const a = pack(devices.filter(d => faultDomain(d, all) === 'A')).filter(r => r.slots.length)
  const b = pack(devices.filter(d => faultDomain(d, all) === 'B')).filter(r => r.slots.length)
  a.forEach(r => { r.side = 'A' }); b.forEach(r => { r.side = 'B' })
  const out: RackAssignment[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  out.forEach((r, i) => relabel(r, i + 1))
  return out
}

function computeDenseLayout(devices: BOMDevice[], opts: RackLayoutOpts = {}): RackAssignment[] {
  const racks = packByDomain(
    devices.filter(d => deviceRackUnits(d) > 0), devices, opts, packDense,
    (r, n) => { r.rackId = `R${n}`; r.label = `Rack ${alphaLabel(n - 1)}` },
  )
  return racks.length ? racks : [{ rackId: 'R1', label: 'Rack A', slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0 }]
}

function packDense(devices: BOMDevice[]): RackAssignment[] {
  const physical = devices

  const sorted = [...physical].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.subLayer)
    const bi = ROLE_ORDER.indexOf(b.subLayer)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  const racks: RackAssignment[] = []
  let currentRack: RackAssignment = {
    rackId: 'R1', label: `Rack ${alphaLabel(0)}`, slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0,
  }
  let currentU = 1

  for (const dev of sorted) {
    const h = deviceRackUnits(dev)
    const pwNext = devicePower(dev)
    // A rack is full when it runs out of EITHER units or power. `hasSlots`
    // keeps a single device that exceeds the budget on its own from looping
    // forever — it is placed alone and validateBOM reports the density.
    const hasSlots = currentRack.slots.length > 0
    const outOfPower = hasSlots && currentRack.totalPowerW + pwNext > RACK_POWER_BUDGET_W
    if (currentU + h - 1 > RACK_U || outOfPower) {
      racks.push(currentRack)
      const nextIdx = racks.length + 1
      currentRack = {
        rackId: `R${nextIdx}`,
        label: `Rack ${alphaLabel(nextIdx - 1)}`,
        slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0,
      }
      currentU = 1
    }
    const pw = devicePower(dev)
    currentRack.slots.push({ startU: currentU, heightU: h, device: dev, powerW: pw })
    currentRack.usedU += h
    currentRack.totalPowerW += pw
    currentU += h
  }
  if (currentRack.slots.length > 0) racks.push(currentRack)
  return racks
}

function addSlot(rack: RackAssignment, startU: number, dev: BOMDevice): number {
  const h = deviceRackUnits(dev)
  const pw = devicePower(dev)
  rack.slots.push({ startU, heightU: h, device: dev, powerW: pw })
  rack.usedU += h
  rack.totalPowerW += pw
  return startU + h
}

/** Network racks of the ToR layout: role order, closed on units OR power (AF2). */
function packNetwork(devices: BOMDevice[]): RackAssignment[] {
  const sorted = [...devices].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.subLayer)
    const bi = ROLE_ORDER.indexOf(b.subLayer)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
  const racks: RackAssignment[] = []
  const fresh = (): RackAssignment => ({
    rackId: `NW${racks.length + 1}`, label: `Network Rack ${racks.length + 1}`,
    slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0,
  })
  let rack = fresh()
  let currentU = 1
  for (const dev of sorted) {
    const h = deviceRackUnits(dev)
    const overPower = rack.slots.length > 0 && rack.totalPowerW + devicePower(dev) > RACK_POWER_BUDGET_W
    if (currentU + h - 1 > RACK_U || overPower) {
      racks.push(rack)
      rack = fresh()
      currentU = 1
    }
    currentU = addSlot(rack, currentU, dev)
  }
  if (rack.slots.length > 0) racks.push(rack)
  return racks
}

function computeToRLayout(devices: BOMDevice[], opts: RackLayoutOpts = {}): RackAssignment[] {
  const dual = opts.redundancy === 'dual'
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const compute = devices.filter(d => d.subLayer === 'gpu-compute')
  const network = devices.filter(d =>
    d.subLayer !== 'leaf' && d.subLayer !== 'gpu-compute' && deviceRackUnits(d) > 0,
  )

  const leafPairs: BOMDevice[][] = []
  for (let i = 0; i < leaves.length; i += 2) {
    leafPairs.push(leaves.slice(i, Math.min(i + 2, leaves.length)))
  }

  // Heights from the SKUs actually in the design (AQ5) — an SN4600C leaf is 2U.
  const computeRU = compute.length ? deviceRackUnits(compute[0]) : deviceRackUnits({ subLayer: 'gpu-compute' })
  const leafRU = leaves.length ? Math.max(...leaves.map(deviceRackUnits)) : deviceRackUnits({ subLayer: 'leaf' })
  const torU = leafRU * 2
  // How many servers FIT is not how many can be POWERED. Eight H100 nodes at
  // 6.5 kW each is 52 kW; the U-only answer was 10, i.e. 66 kW with the ToR
  // pair on top — which no cabinet delivers.
  const serverPowerW = compute.length ? devicePower(compute[0]) : ROLE_POWER['gpu-compute']
  const torPowerW = leaves.length ? devicePower(leaves[0]) * 2 : ROLE_POWER['leaf'] * 2
  const byUnits = Math.floor((RACK_U - torU) / computeRU)
  const byPower = Math.floor((GPU_RACK_POWER_BUDGET_W - torPowerW) / Math.max(1, serverPowerW))
  const serversPerRack = Math.max(1, Math.min(byUnits, byPower))

  const racks: RackAssignment[] = []
  let computeIdx = 0
  let pairIdx = 0

  while (computeIdx < compute.length) {
    const rn = racks.length + 1
    const rack: RackAssignment = {
      rackId: `CR${rn}`, label: `Compute ${alphaLabel(rn - 1)}`,
      slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0,
      // AQ3: a compute rack is its leaf pair plus servers, so it takes the
      // pair's fault domain — alternating, the same rule faultDomain() uses.
      ...(dual ? { side: pairIdx % 2 === 0 ? 'A' as const : 'B' as const } : {}),
    }
    let currentU = 1

    if (pairIdx < leafPairs.length) {
      for (const leaf of leafPairs[pairIdx]) {
        currentU = addSlot(rack, currentU, leaf)
      }
      pairIdx++
    }

    let placed = 0
    while (computeIdx < compute.length && placed < serversPerRack && currentU + computeRU - 1 <= RACK_U) {
      currentU = addSlot(rack, currentU, compute[computeIdx])
      computeIdx++
      placed++
    }

    racks.push(rack)
  }

  // Remaining leaf pairs without compute servers
  while (pairIdx < leafPairs.length) {
    const rn = racks.length + 1
    const rack: RackAssignment = {
      rackId: `LR${rn}`, label: `Leaf Rack ${alphaLabel(rn - 1)}`,
      slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0,
      ...(dual ? { side: pairIdx % 2 === 0 ? 'A' as const : 'B' as const } : {}),
    }
    let currentU = 1
    for (const leaf of leafPairs[pairIdx]) {
      currentU = addSlot(rack, currentU, leaf)
    }
    pairIdx++
    racks.push(rack)
  }

  // Network rack(s) for spines, firewalls
  if (network.length > 0) {
    racks.push(...packByDomain(network, devices, opts, packNetwork,
      (r, n) => { r.rackId = `NW${n}`; r.label = `Network Rack ${n}` }))
  }

  if (racks.length === 0) {
    racks.push({ rackId: 'R1', label: 'Rack A', slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0 })
  }
  return racks
}

// ── Cable schedule computation ───────────────────────────────────────────────

/**
 * The cable schedule a contractor pulls from (AQ2). It used to be its own
 * froms×tos full mesh with `100G uplink` / `100G downlink` for every port —
 * the AG2 defect, fixed in the NetBox export but never here — so a 20-device
 * DC listed 280 runs for 74 billed cables, none with a real interface. It now
 * reads `expandCablePlan`, the same expansion the NetBox DCIM export uses:
 * exactly the billed quantity, landed on the interfaces the configs configure
 * (AP1–AP4), with each end's rack from the rack layout.
 */
export function buildCableSchedule(
  devices: BOMDevice[], cabling: CableLink[], useCase: UseCase | '' = '', racks?: RackAssignment[],
): CableRun[] {
  const rackOf = new Map<string, string>()
  for (const r of racks ?? computeRackLayout(devices)) for (const s of r.slots) rackOf.set(s.device.hostname, r.label)
  return expandCablePlan(devices, cabling, useCase).map((c, i) => ({
    id: `cable-${i + 1}`,
    from: c.a.device, to: c.b.device,
    fromPort: c.a.iface, toPort: c.b.iface,
    fromRack: rackOf.get(c.a.device), toRack: rackOf.get(c.b.device),
    fromConfigured: !!c.a.mapped, toConfigured: !!c.b.mapped,
    cableType: c.cableType, medium: c.medium, speed: c.speed, lengthM: c.lengthM,
  }))
}

// ── SVG Rack Component ───────────────────────────────────────────────────────

function RackSVG({ rack }: { rack: RackAssignment }) {
  const svgH = RACK_TOTAL_H
  const freeU = rack.totalU - rack.usedU
  const pctUsed = Math.round((rack.usedU / rack.totalU) * 100)

  return (
    <svg
      viewBox={`0 0 ${RACK_W + 60} ${svgH}`}
      style={{ width: '100%', maxWidth: RACK_W + 60, height: 'auto', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Rack elevation for ${rack.label}: ${rack.usedU}U of ${rack.totalU}U used (${pctUsed}%) with ${rack.slots.length} devices`}
    >
      <title>{rack.label} — {rack.usedU}U / {rack.totalU}U ({pctUsed}% utilized)</title>
      {/* Rack title */}
      <text x={RACK_W / 2 + 30} y={18} textAnchor="middle" fill="#E5E7EB" fontSize={13} fontWeight="bold">
        {rack.label}{rack.side ? ` · domain ${rack.side}` : ''} — {rack.usedU}U / {rack.totalU}U ({pctUsed}%)
      </text>
      <text x={RACK_W / 2 + 30} y={32} textAnchor="middle" fill="#9CA3AF" fontSize={10}>
        Power: {rack.totalPowerW.toLocaleString()}W
      </text>

      {/* Rack frame */}
      <rect
        x={LABEL_W} y={MARGIN_TOP}
        width={SLOT_W + 10} height={RACK_U * U_HEIGHT}
        rx={3} fill="#111827" stroke="#374151" strokeWidth={1.5}
      />

      {/* U labels */}
      {Array.from({ length: RACK_U }, (_, i) => (
        <text
          key={`u-${i}`}
          x={LABEL_W - 4}
          y={MARGIN_TOP + i * U_HEIGHT + U_HEIGHT / 2 + 3}
          textAnchor="end"
          fill="#6B7280" fontSize={7}
        >
          {i + 1}
        </text>
      ))}

      {/* U gridlines */}
      {Array.from({ length: RACK_U + 1 }, (_, i) => (
        <line
          key={`grid-${i}`}
          x1={LABEL_W} y1={MARGIN_TOP + i * U_HEIGHT}
          x2={LABEL_W + SLOT_W + 10} y2={MARGIN_TOP + i * U_HEIGHT}
          stroke="#1F2937" strokeWidth={0.5}
        />
      ))}

      {/* Device slots */}
      {rack.slots.map((slot, si) => {
        const c = roleColor(slot.device.subLayer)
        const y = MARGIN_TOP + (slot.startU - 1) * U_HEIGHT + 1
        const h = slot.heightU * U_HEIGHT - 2
        const x = LABEL_W + 3
        const w = SLOT_W + 4
        const hostname = slot.device.hostname || slot.device.model
        const label = hostname.length > 22 ? hostname.slice(0, 20) + '…' : hostname
        const detail = `${slot.device.model} · ${slot.powerW}W`
        const detailTrunc = detail.length > 30 ? detail.slice(0, 28) + '…' : detail
        return (
          <g key={`slot-${si}`}>
            <rect x={x} y={y} width={w} height={h} rx={2} fill={c.bg} stroke={c.border} strokeWidth={1} />
            {slot.heightU >= 2 ? (
              <>
                <text x={x + 6} y={y + 10} fill={c.text} fontSize={9} fontWeight="bold">{label}</text>
                <text x={x + 6} y={y + 21} fill={c.text} fontSize={7} opacity={0.7}>{detailTrunc}</text>
              </>
            ) : (
              <text x={x + 6} y={y + 10} fill={c.text} fontSize={8} fontWeight="bold">{label}</text>
            )}
            {/* Port indicators */}
            {slot.device.ports > 0 && (
              <text x={x + w - 4} y={y + 10} textAnchor="end" fill={c.text} fontSize={7} opacity={0.6}>
                {slot.device.ports}p
              </text>
            )}
          </g>
        )
      })}

      {/* Free space indicator */}
      {freeU > 0 && (() => {
        const lastSlot = rack.slots[rack.slots.length - 1]
        const freeStartU = lastSlot ? lastSlot.startU + lastSlot.heightU : 1
        const y = MARGIN_TOP + (freeStartU - 1) * U_HEIGHT + 1
        const h = freeU * U_HEIGHT - 2
        return (
          <g>
            <rect x={LABEL_W + 3} y={y} width={SLOT_W + 4} height={h} rx={2} fill="#0A0A0A" stroke="#1F2937" strokeWidth={0.5} strokeDasharray="4 2" />
            <text x={RACK_W / 2} y={y + h / 2 + 3} textAnchor="middle" fill="#374151" fontSize={10}>
              {freeU}U free
            </text>
          </g>
        )
      })()}

      {/* Power bar */}
      <rect x={RACK_W + 20} y={MARGIN_TOP} width={8} height={RACK_U * U_HEIGHT} rx={3} fill="#111827" stroke="#374151" strokeWidth={0.5} />
      {rack.totalPowerW > 0 && (() => {
        const maxW = 12000
        const pct = Math.min(rack.totalPowerW / maxW, 1)
        const barH = RACK_U * U_HEIGHT * pct
        const barColor = pct > 0.8 ? '#EF4444' : pct > 0.6 ? '#F59E0B' : '#22C55E'
        return (
          <rect
            x={RACK_W + 20}
            y={MARGIN_TOP + RACK_U * U_HEIGHT - barH}
            width={8} height={barH} rx={3} fill={barColor} opacity={0.7}
          />
        )
      })()}
      <text x={RACK_W + 24} y={MARGIN_TOP + RACK_U * U_HEIGHT + 12} textAnchor="middle" fill="#6B7280" fontSize={7}>
        kW
      </text>
    </svg>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function RackLegend() {
  const items = [
    { label: 'Spine / Core', subLayer: 'spine' },
    { label: 'Leaf / Access', subLayer: 'leaf' },
    { label: 'GPU Compute', subLayer: 'gpu-compute' },
    { label: 'Distribution', subLayer: 'distribution' },
    { label: 'WAN Edge', subLayer: 'wan-edge' },
    { label: 'SD-WAN Controller', subLayer: 'sdwan-controller' },
    { label: 'Firewall', subLayer: 'firewall' },
    { label: 'Cloud GW', subLayer: 'cloud-gw' },
  ]
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {items.map(it => {
        const c = roleColor(it.subLayer)
        return (
          <div key={it.subLayer} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: c.bg, border: `1px solid ${c.border}` }} />
            <span className="text-gray-400">{it.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

interface Props {
  devices: BOMDevice[]
  cabling: CableLink[]
  siteCode: string
  useCase?: UseCase | ''
  /** The redundancy selection; `dual` splits every HA pair across racks (AQ3). */
  redundancy?: 'single' | 'dual'
}

/** A model whose drawn height is the role default, not its datasheet (AQ5). */
export interface AssumedHeight { model: string; heightU: number; count: number; note: string }

/**
 * Models drawn at an assumed height — modular chassis families whose height
 * depends on the slot count, or SKUs the catalogue gives no height for. Shown
 * beside the elevation so a reader never takes a guessed U count as measured.
 */
export function assumedHeights(devices: BOMDevice[]): AssumedHeight[] {
  const byModel = new Map<string, AssumedHeight>()
  for (const d of devices) {
    if (!rackUnitsAssumed(d)) continue
    const e = byModel.get(d.model)
    if (e) { e.count += d.count ?? 1; continue }
    byModel.set(d.model, {
      model: d.model, heightU: deviceRackUnits(d), count: d.count ?? 1,
      note: d.rackUnitsNote ?? 'no datasheet height in the catalogue',
    })
  }
  return [...byModel.values()]
}

export function RackElevation({ devices, cabling, siteCode, useCase = '', redundancy = 'single' }: Props) {
  const racks = useMemo(() => computeRackLayout(devices, { redundancy }), [devices, redundancy])
  const cableRuns = useMemo(() => buildCableSchedule(devices, cabling, useCase, racks), [devices, cabling, useCase, racks])

  const totalPower = racks.reduce((s, r) => s + r.totalPowerW, 0)
  const totalUsedU = racks.reduce((s, r) => s + r.usedU, 0)
  const totalCapacity = racks.reduce((s, r) => s + r.totalU, 0)
  const assumed = useMemo(() => assumedHeights(devices), [devices])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Rack Elevation — {siteCode || 'SITE'}</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {racks.length} rack{racks.length !== 1 ? 's' : ''} · {totalUsedU}U / {totalCapacity}U · {(totalPower / 1000).toFixed(1)} kW total
          </p>
        </div>
        <RackLegend />
      </div>

      {assumed.length > 0 && (
        <div className="text-xs text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2" data-testid="assumed-heights">
          <span className="font-semibold">Assumed heights — confirm before ordering racks:</span>
          <ul className="mt-1 space-y-0.5">
            {assumed.map(a => (
              <li key={a.model}>
                <span className="font-mono text-amber-200">{a.model}</span> ×{a.count} drawn at {a.heightU}U — {a.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rack SVGs */}
      {(() => {
        const MAX_SVG = 12
        const display = racks.length <= MAX_SVG ? racks : racks.slice(0, MAX_SVG)
        const cols = Math.min(display.length, racks.length > 6 ? 4 : 3)
        return (
          <>
            <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {display.map(rack => (
                <div key={rack.rackId} className="bg-black/40 border border-white/10 rounded-xl p-3">
                  <RackSVG rack={rack} />
                </div>
              ))}
            </div>
            {racks.length > MAX_SVG && (
              <p className="text-xs text-gray-500 text-center mt-2">
                Showing {MAX_SVG} of {racks.length} racks — see table below for full schedule
              </p>
            )}
          </>
        )
      })()}

      {/* Cable Schedule Table */}
      {cableRuns.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-100 mb-1">Cable Schedule</h3>
          <p className="text-xs text-gray-500 mb-2">
            {cableRuns.length} runs — the billed quantity, on the interfaces the generated configs configure.
            Ports in amber are not assigned by the config engine and need confirming on site.
          </p>
          <div className="overflow-x-auto border border-white/10 rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 text-gray-400">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-left">Rack</th>
                  <th className="px-3 py-2 text-left">From Port</th>
                  <th className="px-3 py-2 text-left">To</th>
                  <th className="px-3 py-2 text-left">Rack</th>
                  <th className="px-3 py-2 text-left">To Port</th>
                  <th className="px-3 py-2 text-left">Cable</th>
                  <th className="px-3 py-2 text-left">Speed</th>
                  <th className="px-3 py-2 text-right">Length</th>
                </tr>
              </thead>
              <tbody>
                {cableRuns.slice(0, 100).map((run, i) => (
                  <tr key={run.id} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                    <td className="px-3 py-1.5 text-gray-500">{i + 1}</td>
                    <td className="px-3 py-1.5 text-gray-200 font-mono">{run.from}</td>
                    <td className="px-3 py-1.5 text-gray-500">{run.fromRack ?? '—'}</td>
                    <td className={`px-3 py-1.5 font-mono ${run.fromConfigured ? 'text-gray-300' : 'text-amber-400'}`} title={run.fromConfigured ? 'Configured in the generated config' : 'Not assigned by the config engine — confirm on site'}>{run.fromPort}</td>
                    <td className="px-3 py-1.5 text-gray-200 font-mono">{run.to}</td>
                    <td className="px-3 py-1.5 text-gray-500">{run.toRack ?? '—'}</td>
                    <td className={`px-3 py-1.5 font-mono ${run.toConfigured ? 'text-gray-300' : 'text-amber-400'}`} title={run.toConfigured ? 'Configured in the generated config' : 'Not assigned by the config engine — confirm on site'}>{run.toPort}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        run.cableType === 'DAC' ? 'bg-blue-900/50 text-blue-300' :
                        run.cableType === 'AOC' ? 'bg-purple-900/50 text-purple-300' :
                        run.cableType === 'MPO' ? 'bg-green-900/50 text-green-300' :
                        'bg-gray-700/50 text-gray-300'
                      }`}>
                        {run.cableType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-300">{run.speed}</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">{run.lengthM}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cableRuns.length > 100 && (
              <div className="px-3 py-2 text-xs text-gray-500 border-t border-white/10">
                Showing first 100 of {cableRuns.length} cable runs
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rack Assignment Table */}
      <div>
        <h3 className="text-sm font-semibold text-gray-100 mb-2">Rack Assignment Schedule</h3>
        <div className="overflow-x-auto border border-white/10 rounded-xl">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/5 text-gray-400">
                <th className="px-3 py-2 text-left">Rack</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">Hostname</th>
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-right">RU</th>
                <th className="px-3 py-2 text-right">Power</th>
                <th className="px-3 py-2 text-right">Ports</th>
              </tr>
            </thead>
            <tbody>
              {racks.flatMap(rack =>
                rack.slots.map((slot, si) => {
                  const c = roleColor(slot.device.subLayer)
                  return (
                    <tr key={`${rack.rackId}-${si}`} className={si % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                      <td className="px-3 py-1.5 text-gray-400">{rack.label}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-300">
                        U{slot.startU}{slot.heightU > 1 ? `–U${slot.startU + slot.heightU - 1}` : ''}
                      </td>
                      <td className="px-3 py-1.5 font-mono" style={{ color: c.text }}>
                        {slot.device.hostname || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-gray-300">{slot.device.model}</td>
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
                          {slot.device.subLayer}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-400">{slot.heightU}U</td>
                      <td className="px-3 py-1.5 text-right text-gray-400">{slot.powerW}W</td>
                      <td className="px-3 py-1.5 text-right text-gray-400">{slot.device.ports}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
            <tfoot>
              <tr className="bg-white/5 font-semibold">
                <td className="px-3 py-2 text-gray-300" colSpan={5}>Total</td>
                <td className="px-3 py-2 text-right text-gray-300">{totalUsedU}U</td>
                <td className="px-3 py-2 text-right text-gray-300">{(totalPower / 1000).toFixed(1)} kW</td>
                <td className="px-3 py-2 text-right text-gray-300">{devices.reduce((s, d) => s + d.ports, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
