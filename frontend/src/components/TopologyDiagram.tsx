import type { BOMDevice } from '@/types'

interface Props {
  devices: BOMDevice[]
  underlayProtocol?: string
  overlayProtocols?: string[]
}

const ZONE_CFG: Record<string, {
  bg: string; border: string; shortLabel: string; annotation: string
  nodeStroke: string; nodeFill: string; nodeText: string
}> = {
  'wan-edge':      { bg:'rgba(39,39,42,0.5)',   border:'#71717A', shortLabel:'WAN EDGE',      annotation:'BGP eBGP · Dual-ISP · PATH-hardening',  nodeStroke:'#9CA3AF', nodeFill:'#18181B', nodeText:'#E4E4E7' },
  firewall:        { bg:'rgba(127,29,29,0.3)',   border:'#EF4444', shortLabel:'PERIMETER FW',  annotation:'NGFW · IPS · TLS-inspect · Anti-Recon',  nodeStroke:'#EF4444', nodeFill:'#450A0A', nodeText:'#FCA5A5' },
  core:            { bg:'rgba(76,29,149,0.25)',  border:'#8B5CF6', shortLabel:'CAMPUS CORE',   annotation:'OSPF Area 0 · VSS/StackWise · L3 GW',    nodeStroke:'#A78BFA', nodeFill:'#2E1065', nodeText:'#DDD6FE' },
  spine:           { bg:'rgba(29,78,216,0.25)',  border:'#3B82F6', shortLabel:'DC SPINE',      annotation:'eBGP ECMP · VXLAN/EVPN underlay · BFD',  nodeStroke:'#60A5FA', nodeFill:'#1E3A5F', nodeText:'#BAE6FD' },
  distribution:    { bg:'rgba(2,132,199,0.18)',  border:'#0EA5E9', shortLabel:'DISTRIBUTION',  annotation:'MLAG · BCPFE zone · DHCP Relay · Inter-VLAN routing', nodeStroke:'#38BDF8', nodeFill:'#082F49', nodeText:'#BAE6FD' },
  leaf:            { bg:'rgba(21,128,61,0.25)',  border:'#22C55E', shortLabel:'LEAF / ToR',    annotation:'VXLAN NVE · BGP EVPN · Anycast-GW · BFD', nodeStroke:'#4ADE80', nodeFill:'#14532D', nodeText:'#BBF7D0' },
  access:          { bg:'rgba(5,46,22,0.35)',    border:'#16A34A', shortLabel:'ACCESS',        annotation:'802.1X · PoE+ · Security · DAI · LLDP',  nodeStroke:'#22C55E', nodeFill:'#052E16', nodeText:'#86EFAC' },
  'cloud-transit': { bg:'rgba(29,78,216,0.2)',   border:'#2563EB', shortLabel:'CLOUD TRANSIT', annotation:'BGP · EVPN · FireNet · TGW peering',     nodeStroke:'#60A5FA', nodeFill:'#1E3A5F', nodeText:'#BAE6FD' },
  'cloud-gw':      { bg:'rgba(13,148,136,0.2)',  border:'#14B8A6', shortLabel:'CLOUD GW',      annotation:'IPSec/GRE overlay · SNAT/DNAT · SD-WAN', nodeStroke:'#2DD4BF', nodeFill:'#042F2E', nodeText:'#99F6E4' },
}

const ZONE_ORDER = ['wan-edge','cloud-transit','core','spine','firewall','distribution','cloud-gw','leaf','access']

const ZONE_ICONS: Record<string, string> = {
  'wan-edge':'⟳', firewall:'🛡', core:'◈', spine:'⬡', distribution:'⬢',
  leaf:'⬡', access:'⬡', 'cloud-transit':'☁', 'cloud-gw':'⬡',
}

const CONNECTS: Array<[string, string]> = [
  ['wan-edge','firewall'],['wan-edge','spine'],['wan-edge','core'],
  ['firewall','spine'],['firewall','distribution'],['firewall','core'],
  ['core','distribution'],['spine','leaf'],['distribution','access'],
  ['cloud-transit','cloud-gw'],
]

const CONN_COLORS: Record<string, string> = {
  'wan-edge|firewall':'#FB923C','wan-edge|spine':'#FCD34D','wan-edge|core':'#FCD34D',
  'firewall|spine':'#F87171','firewall|distribution':'#F87171','firewall|core':'#F87171',
  'core|distribution':'#A78BFA','spine|leaf':'#60A5FA',
  'distribution|access':'#38BDF8','cloud-transit|cloud-gw':'#2DD4BF',
}

const MAX_PER_ROW = 6
const NODE_W = 118
const NODE_H = 56
const ZONE_PAD_Y = 12
const GAP_X = 10
const ZONE_GAP = 6
const LEFT_W = 140
const RIGHT_PAD = 16
const DIAGRAM_W = 900
const CONTENT_W = DIAGRAM_W - LEFT_W - RIGHT_PAD

export function TopologyDiagram({ devices, underlayProtocol, overlayProtocols }: Props) {
  if (!devices.length) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-500 border border-white/10 rounded-xl">
        Generate a BOM first to see the topology diagram.
      </div>
    )
  }

  const byLayer: Record<string, BOMDevice[]> = {}
  for (const d of devices) {
    const k = d.subLayer || d.role
    ;(byLayer[k] = byLayer[k] ?? []).push(d)
  }

  const orderedZones = ZONE_ORDER.filter(l => byLayer[l]?.length)

  // Layout computation
  interface NodeLayout { device: BOMDevice; x: number; y: number }
  interface ZoneLayout {
    id: string; y: number; h: number; centerY: number; midX: number
    nodes: NodeLayout[]; overflow: number
    cfg: typeof ZONE_CFG[string]
  }

  const zoneLayouts: ZoneLayout[] = []
  let curY = 50

  for (const zoneId of orderedZones) {
    const all = byLayer[zoneId]
    const showCount = Math.min(all.length, MAX_PER_ROW)
    const overflow = all.length - showCount
    const displayCount = overflow > 0 ? showCount - 1 : showCount // last slot = overflow badge
    const totalSlots = displayCount + (overflow > 0 ? 1 : 0)

    const totalW = totalSlots * NODE_W + (totalSlots - 1) * GAP_X
    const startX = LEFT_W + (CONTENT_W - totalW) / 2
    const nodeY = curY + ZONE_PAD_Y

    const nodes: NodeLayout[] = all.slice(0, displayCount).map((dev, i) => ({
      device: dev,
      x: startX + i * (NODE_W + GAP_X),
      y: nodeY,
    }))

    const zoneH = NODE_H + ZONE_PAD_Y * 2
    const midX = startX + totalW / 2

    const cfg = ZONE_CFG[zoneId] ?? {
      bg:'rgba(30,30,30,0.3)', border:'#6B7280', shortLabel:zoneId,
      annotation:'', nodeStroke:'#9CA3AF', nodeFill:'#1F2937', nodeText:'#D1D5DB',
    }

    zoneLayouts.push({ id:zoneId, y:curY, h:zoneH, centerY:curY+zoneH/2, midX, nodes, overflow, cfg })
    curY += zoneH + ZONE_GAP
  }

  const legendY = curY + 12
  const svgH = legendY + 52

  // Connection paths between zone centers
  interface ConnPath { id: string; d: string; color: string; dur1: number; dur2: number; begin2: number }
  const connPaths: ConnPath[] = []
  let connIdx = 0
  for (const [fl, tl] of CONNECTS) {
    const fz = zoneLayouts.find(z => z.id === fl)
    const tz = zoneLayouts.find(z => z.id === tl)
    if (!fz || !tz) continue
    const above = fz.y < tz.y
    const x1 = fz.midX, y1 = above ? fz.y + fz.h : fz.y
    const x2 = tz.midX, y2 = above ? tz.y : tz.y + tz.h
    const my = (y1 + y2) / 2
    const d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
    const dur1 = 1.8 + (connIdx % 4) * 0.4
    const dur2 = 2.0 + (connIdx % 3) * 0.5
    const begin2 = dur1 / 2
    connPaths.push({ id:`lnk-${fl}-${tl}`, d, color:CONN_COLORS[`${fl}|${tl}`] ?? '#4B5563', dur1, dur2, begin2 })
    connIdx++
  }

  // Role summary
  const summary = orderedZones.map(z => `${byLayer[z].length}× ${ZONE_CFG[z]?.shortLabel ?? z}`).join(' · ')
  const overlayStr = overlayProtocols?.length ? ` · ${overlayProtocols.join('/')}` : ''
  const underlayStr = underlayProtocol ? ` · ${underlayProtocol.toUpperCase()} underlay` : ''
  const capacityLine = summary + underlayStr + overlayStr

  return (
    <div className="overflow-x-auto rounded-xl bg-[#080E1A]" style={{ lineHeight:1 }}>
      <svg viewBox={`0 0 ${DIAGRAM_W} ${svgH}`} width={DIAGRAM_W} height={svgH}
           style={{ fontFamily:'monospace', maxWidth:'100%', display:'block' }}>
        <defs>
          {connPaths.map(c => (
            <path key={`def-${c.id}`} id={c.id} d={c.d} />
          ))}
        </defs>

        {/* Background */}
        <rect width={DIAGRAM_W} height={svgH} fill="#080E1A" />

        {/* Capacity summary */}
        <text x={LEFT_W} y={28} fill="#64748B" fontSize={9.5} fontWeight="500">{capacityLine}</text>
        <text x={DIAGRAM_W - RIGHT_PAD} y={28} textAnchor="end" fill="#1D4ED8" fontSize={9} opacity={0.7}>&#9889; Animated packet flow</text>

        {/* Connection paths (drawn first, behind zones) */}
        {connPaths.map(c => (
          <g key={c.id}>
            <path d={c.d} stroke={c.color} strokeWidth={1} fill="none" strokeDasharray="5 4" opacity={0.35}/>
            {/* Packet 1 */}
            <circle r="3.5" fill={c.color} opacity={0.9}>
              <animateMotion dur={`${c.dur1}s`} repeatCount="indefinite" begin="0s">
                <mpath href={`#${c.id}`}/>
              </animateMotion>
            </circle>
            {/* Packet 2 */}
            <circle r="2.5" fill={c.color} opacity={0.6}>
              <animateMotion dur={`${c.dur2}s`} repeatCount="indefinite" begin={`${c.begin2}s`}>
                <mpath href={`#${c.id}`}/>
              </animateMotion>
            </circle>
          </g>
        ))}

        {/* Zone bands + devices */}
        {zoneLayouts.map(zone => (
          <g key={zone.id}>
            {/* Band background */}
            <rect x={LEFT_W} y={zone.y} width={CONTENT_W} height={zone.h}
                  fill={zone.cfg.bg} stroke={zone.cfg.border} strokeWidth={0.6} rx={5} opacity={0.9}/>
            {/* Left label */}
            <text x={LEFT_W - 6} y={zone.centerY - 4} textAnchor="end"
                  fill={zone.cfg.border} fontSize={8.5} fontWeight="700">
              {zone.cfg.shortLabel}
            </text>
            {/* Annotation inside band (top-right) */}
            <text x={LEFT_W + CONTENT_W - 8} y={zone.y + 12} textAnchor="end"
                  fill={zone.cfg.border} fontSize={7.5} opacity={0.7}>
              {zone.cfg.annotation}
            </text>

            {/* Device nodes */}
            {zone.nodes.map(n => {
              const icon = ZONE_ICONS[zone.id] ?? '⬡'
              const hostname = (n.device.hostname || n.device.id).slice(0, 15)
              const model = n.device.model.slice(0, 17)
              return (
                <g key={n.device.id} transform={`translate(${n.x},${n.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={7}
                        fill={zone.cfg.nodeFill} stroke={zone.cfg.nodeStroke} strokeWidth={1.5}/>
                  <text x={NODE_W/2} y={15} textAnchor="middle"
                        fill={zone.cfg.nodeStroke} fontSize={12}>{icon}</text>
                  <text x={NODE_W/2} y={31} textAnchor="middle"
                        fill={zone.cfg.nodeText} fontSize={8.5} fontWeight="700">{hostname}</text>
                  <text x={NODE_W/2} y={44} textAnchor="middle"
                        fill="#64748B" fontSize={7.5}>{model}</text>
                </g>
              )
            })}

            {/* Overflow badge */}
            {zone.overflow > 0 && zone.nodes.length > 0 && (() => {
              const lastNode = zone.nodes[zone.nodes.length - 1]
              const ox = lastNode.x + NODE_W + GAP_X
              return (
                <g transform={`translate(${ox},${lastNode.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={7}
                        fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)"
                        strokeWidth={1} strokeDasharray="5 3"/>
                  <text x={NODE_W/2} y={NODE_H/2+4} textAnchor="middle" fill="#64748B" fontSize={11}>
                    +{zone.overflow} more
                  </text>
                </g>
              )
            })()}
          </g>
        ))}

        {/* Legend */}
        {(() => {
          const entries = orderedZones.map(z => ({ color:(ZONE_CFG[z]?.border ?? '#6B7280'), label:(ZONE_CFG[z]?.shortLabel ?? z) }))
          const colW = 120
          const totalLegW = entries.length * colW
          const lx = LEFT_W + (CONTENT_W - totalLegW) / 2
          return (
            <g>
              <line x1={LEFT_W} y1={legendY} x2={LEFT_W+CONTENT_W} y2={legendY} stroke="#1E293B" strokeWidth={1}/>
              {entries.map((e, i) => (
                <g key={e.label} transform={`translate(${lx + i*colW},${legendY + 10})`}>
                  <circle cx={5} cy={7} r={5} fill={e.color} opacity={0.85}/>
                  <text x={14} y={11} fill="#94A3B8" fontSize={8}>{e.label}</text>
                </g>
              ))}
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
