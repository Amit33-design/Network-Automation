import { useMemo } from 'react'
import { alphaLabel } from '@/lib/bom'
import type { BOMDevice, CableLink } from '@/types'

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
}

export interface CableRun {
  id: string
  from: string
  to: string
  fromPort: string
  toPort: string
  cableType: string
  speed: string
  lengthM: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const RACK_U = 42
const U_HEIGHT = 14
const RACK_W = 320
const LABEL_W = 30
const SLOT_W = RACK_W - LABEL_W - 10
const MARGIN_TOP = 40
const MARGIN_BOTTOM = 30
const RACK_TOTAL_H = RACK_U * U_HEIGHT + MARGIN_TOP + MARGIN_BOTTOM

const ROLE_ORDER = [
  'sdwan-controller', 'firewall', 'wan-edge', 'core', 'spine',
  'distribution', 'leaf', 'access', 'cloud-gw', 'cloud-transit',
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
  'cloud-gw':         { bg: '#0A3A4A', border: '#22D3EE', text: '#CFFAFE' },
  'cloud-transit':    { bg: '#0A3A4A', border: '#22D3EE', text: '#CFFAFE' },
}

function roleColor(subLayer: string) {
  return ROLE_COLORS[subLayer] ?? { bg: '#1F2937', border: '#6B7280', text: '#D1D5DB' }
}

function ruForRole(subLayer: string): number {
  switch (subLayer) {
    case 'spine': case 'core': case 'wan-edge': case 'sdwan-controller':
      return 2
    case 'firewall':
      return 1
    case 'cloud-gw': case 'cloud-transit':
      return 0
    default:
      return 1
  }
}

const ROLE_POWER: Record<string, number> = {
  spine: 800, core: 800, leaf: 480, distribution: 600, access: 400,
  'wan-edge': 300, 'sdwan-controller': 300, firewall: 800,
  'cloud-gw': 0, 'cloud-transit': 0,
}

function devicePower(d: BOMDevice): number {
  return ROLE_POWER[d.subLayer] ?? 400
}

// ── Rack layout computation ──────────────────────────────────────────────────

export function computeRackLayout(devices: BOMDevice[]): RackAssignment[] {
  const physical = devices.filter(d => ruForRole(d.subLayer) > 0)

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
    const h = ruForRole(dev.subLayer)
    if (currentU + h - 1 > RACK_U) {
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
  if (racks.length === 0) {
    racks.push({ rackId: 'R1', label: 'Rack A', slots: [], totalU: RACK_U, usedU: 0, totalPowerW: 0 })
  }
  return racks
}

// ── Cable schedule computation ───────────────────────────────────────────────

export function buildCableSchedule(devices: BOMDevice[], cabling: CableLink[]): CableRun[] {
  const runs: CableRun[] = []
  let idx = 0
  for (const link of cabling) {
    const fromDevs = devices.filter(d => d.subLayer === link.fromLayer)
    const toDevs = devices.filter(d => d.subLayer === link.toLayer)
    if (fromDevs.length === 0 || toDevs.length === 0) {
      runs.push({
        id: `cable-${++idx}`,
        from: link.fromDevice, to: link.toDevice,
        fromPort: `${link.speed} uplink`, toPort: `${link.speed} downlink`,
        cableType: link.cableType, speed: link.speed, lengthM: link.lengthM,
      })
      continue
    }
    for (const fd of fromDevs) {
      for (const td of toDevs) {
        runs.push({
          id: `cable-${++idx}`,
          from: fd.hostname || fd.model,
          to: td.hostname || td.model,
          fromPort: `${link.speed} uplink`,
          toPort: `${link.speed} downlink`,
          cableType: link.cableType,
          speed: link.speed,
          lengthM: link.lengthM,
        })
      }
    }
  }
  return runs
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
    >
      {/* Rack title */}
      <text x={RACK_W / 2 + 30} y={18} textAnchor="middle" fill="#E5E7EB" fontSize={13} fontWeight="bold">
        {rack.label} — {rack.usedU}U / {rack.totalU}U ({pctUsed}%)
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
}

export function RackElevation({ devices, cabling, siteCode }: Props) {
  const racks = useMemo(() => computeRackLayout(devices), [devices])
  const cableRuns = useMemo(() => buildCableSchedule(devices, cabling), [devices, cabling])

  const totalPower = racks.reduce((s, r) => s + r.totalPowerW, 0)
  const totalUsedU = racks.reduce((s, r) => s + r.usedU, 0)
  const totalCapacity = racks.reduce((s, r) => s + r.totalU, 0)

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

      {/* Rack SVGs */}
      <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${Math.min(racks.length, 3)}, minmax(0, 1fr))` }}>
        {racks.map(rack => (
          <div key={rack.rackId} className="bg-black/40 border border-white/10 rounded-xl p-3">
            <RackSVG rack={rack} />
          </div>
        ))}
      </div>

      {/* Cable Schedule Table */}
      {cableRuns.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-100 mb-2">Cable Schedule</h3>
          <div className="overflow-x-auto border border-white/10 rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 text-gray-400">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-left">From Port</th>
                  <th className="px-3 py-2 text-left">To</th>
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
                    <td className="px-3 py-1.5 text-gray-400">{run.fromPort}</td>
                    <td className="px-3 py-1.5 text-gray-200 font-mono">{run.to}</td>
                    <td className="px-3 py-1.5 text-gray-400">{run.toPort}</td>
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
