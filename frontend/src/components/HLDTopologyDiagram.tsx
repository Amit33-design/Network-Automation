import { useState, useMemo } from 'react'
import type { BOMDevice } from '@/types'
import { formatUptime } from '@/lib/utils'
import { DCI_RT_ASN } from '@/lib/configgen'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HLDNode {
  id: string
  label: string
  model: string
  layer: string
  vendor: string
  loopback: string
  mgmtIp: string
  asn?: string
  role: string
  x: number
  y: number
  w: number
  h: number
  isCloud?: boolean
  haRole?: 'active' | 'standby' | 'none'
  /** vPC/MLAG/MEC pair number (Enterprise Upgrade D1 — mirrors configgen.ts haPairInfo()) */
  mlagPairId?: number
  /** Label of this node's vPC/MLAG peer, if any (D1) */
  mlagPeerLabel?: string
  /** FHRP (HSRP) virtual-gateway IP for this node's pair, if any (D1) */
  fhrpVip?: string
  features: string[]
  color: string
  border: string
  textColor: string
}

interface HLDLink {
  id: string
  from: string
  to: string
  speed: string
  protocol: string
  fromPort: string
  toPort: string
  linkSubnet: string
  isHaSync?: boolean
  isOob?: boolean
}

interface SecurityZone {
  id: string
  label: string
  sublabel: string
  yStart: number
  yEnd: number
  fill: string
  stroke: string
  icon: string
}

interface PacketFlow {
  id: string
  icon: string
  label: string
  desc: string
  nodeSeq: string[]
  color: string
  animDur: number
}

interface Topo {
  nodes: HLDNode[]
  links: HLDLink[]
  zones: SecurityZone[]
  flows: PacketFlow[]
  title: string
  subtitle: string
  svgH: number
}

// ─── Health overlay (C2) ────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export interface NodeHealth {
  status: HealthStatus
  cpu: number
  mem: number
  uptimeSec: number
  bgpSessionsUp: number
  ifaceErrors: number
  pfcDrops: number
  alerts: string[]
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const SVG_W    = 1280
const LEFT_W   = 148   // zone label column
const RIGHT_PAD = 16
const CONTENT_W = SVG_W - LEFT_W - RIGHT_PAD
const NW = 136  // node width
const NH = 66   // node height

// ─── Style palette by layer ───────────────────────────────────────────────────
// Node fills must be clearly distinct from the SVG background (#080E1A = rgb(8,14,26))

const LAYER_STYLE: Record<string, { color: string; border: string; textColor: string }> = {
  internet:     { color: '#1A2535', border: '#94A3B8', textColor: '#E2E8F0' },
  'wan-edge':   { color: '#2A1A05', border: '#F59E0B', textColor: '#FCD34D' },
  'corp-fw':    { color: '#3D1010', border: '#F87171', textColor: '#FCA5A5' },
  'edge-fw':    { color: '#3D1E08', border: '#FB923C', textColor: '#FDBA74' },
  spine:        { color: '#0E2B5C', border: '#60A5FA', textColor: '#BAE6FD' },
  core:         { color: '#1E0D50', border: '#A78BFA', textColor: '#DDD6FE' },
  distribution: { color: '#082840', border: '#38BDF8', textColor: '#BAE6FD' },
  leaf:         { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  access:       { color: '#062A12', border: '#22C55E', textColor: '#86EFAC' },
  host:         { color: '#252219', border: '#A8A29E', textColor: '#E7E5E4' },
  gpu:          { color: '#083B25', border: '#34D399', textColor: '#A7F3D0' },
  storage:      { color: '#0F0C35', border: '#818CF8', textColor: '#C7D2FE' },
  oob:          { color: '#252219', border: '#78716C', textColor: '#D6D3D1' },
  'cloud-gw':   { color: '#062D2A', border: '#2DD4BF', textColor: '#99F6E4' },
  // O-RAN / Private 5G layers (G-A10)
  'oran-core':  { color: '#1E0D50', border: '#A78BFA', textColor: '#DDD6FE' },
  'oran-cu':    { color: '#0E2B5C', border: '#60A5FA', textColor: '#BAE6FD' },
  'oran-du':    { color: '#082840', border: '#38BDF8', textColor: '#BAE6FD' },
  'oran-fronthaul': { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  'oran-midhaul':   { color: '#2A1A05', border: '#F59E0B', textColor: '#FCD34D' },
  'oran-ru':    { color: '#3D1E08', border: '#FB923C', textColor: '#FDBA74' },
  'oran-timing': { color: '#3D1010', border: '#F87171', textColor: '#FCA5A5' },
}

// ─── Health overlay palette + simulation (C2) ──────────────────────────────
// Colors mirror MonitoringResult statuses (healthy/degraded/down/unknown) so
// the HLD overlay is visually consistent with the Step 6 Monitoring tab.

export const HEALTH_COLOR: Record<HealthStatus, string> = {
  healthy:  '#22C55E',
  degraded: '#F59E0B',
  down:     '#EF4444',
  unknown:  '#6B7280',
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  healthy: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'Unknown',
}

// Baseline CPU% per layer — GPU/spine/core run hotter than access/OOB.
const HEALTH_BASELINE_CPU: Record<string, number> = {
  gpu: 64, spine: 46, core: 46, leaf: 32, distribution: 30,
  'corp-fw': 28, 'edge-fw': 28, 'wan-edge': 35, access: 20, storage: 24, oob: 12, host: 18,
  'oran-core': 55, 'oran-cu': 48, 'oran-du': 58, 'oran-fronthaul': 30, 'oran-midhaul': 35, 'oran-ru': 40, 'oran-timing': 10,
}

// Layers that run a routing control-plane (eligible for BGP session metrics).
const HEALTH_BGP_LAYERS = new Set(['spine', 'core', 'leaf', 'distribution', 'wan-edge'])

function _seed(s: string): number {
  return s.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
}

function _pseudoRandom(seed: number, offset = 0): number {
  const x = Math.sin(seed + offset) * 10000
  return x - Math.floor(x)
}

// Deterministic per-node "live telemetry" snapshot — keeps the design-time
// HLD overlay self-contained (no backend dependency) while following the
// same status thresholds as the Step 6 Monitoring tab / Prometheus alert
// rules (genPrometheusAlertRules in lib/telemetry-gen.ts).
export function simulateNodeHealth(node: HLDNode): NodeHealth {
  const s = _seed(node.id)
  const baseCpu = HEALTH_BASELINE_CPU[node.layer] ?? 22
  const r0 = _pseudoRandom(s, 11)
  const r1 = _pseudoRandom(s, 22)
  const r2 = _pseudoRandom(s, 33)
  const r3 = _pseudoRandom(s, 44)
  const r4 = _pseudoRandom(s, 55)

  const cpu = Math.min(99, Math.max(1, baseCpu + (r0 - 0.5) * baseCpu * 0.7))
  const mem = Math.min(99, Math.max(5, 50 + (r1 - 0.5) * 36))
  const ifaceErrors = Math.floor(r2 * 14)
  const pfcDrops = node.layer === 'gpu' ? Math.floor(r3 * 260) : 0
  const bgpSessionsUp = HEALTH_BGP_LAYERS.has(node.layer) ? Math.floor(2 + r4 * 4) : 0
  const uptimeSec = Math.floor(3600 * (4 + r2 * 2000))

  const alerts: string[] = []
  let status: HealthStatus = 'healthy'
  if (cpu > 85 || pfcDrops > 200) {
    status = 'down'
    if (cpu > 85) alerts.push(`CPU utilization critical: ${cpu.toFixed(0)}%`)
    if (pfcDrops > 200) alerts.push(`PFC watchdog triggered: ${pfcDrops} drops`)
  } else if (cpu > 65 || ifaceErrors > 8 || pfcDrops > 100) {
    status = 'degraded'
    if (cpu > 65) alerts.push(`CPU utilization elevated: ${cpu.toFixed(0)}%`)
    if (ifaceErrors > 8) alerts.push(`Interface error rate high: ${ifaceErrors}/min`)
    if (pfcDrops > 100) alerts.push(`RoCEv2 CNP rate high: ${pfcDrops} drops`)
  }

  return {
    status,
    cpu: Math.round(cpu * 10) / 10,
    mem: Math.round(mem * 10) / 10,
    uptimeSec,
    bgpSessionsUp,
    ifaceErrors,
    pfcDrops,
    alerts,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function style(layer: string) {
  return LAYER_STYLE[layer] ?? LAYER_STYLE.host
}

function xCentered(count: number, gap: number): number[] {
  const totalW = count * NW + (count - 1) * gap
  const start  = LEFT_W + (CONTENT_W - totalW) / 2
  return Array.from({ length: count }, (_, i) => start + i * (NW + gap))
}

function mkLink(
  from: string, to: string,
  speed: string, protocol: string,
  fromPort = '', toPort = '',
  linkSubnet = '',
  opts: { isHaSync?: boolean; isOob?: boolean } = {},
): HLDLink {
  return { id: `${from}--${to}`, from, to, speed, protocol, fromPort, toPort, linkSubnet, ...opts }
}

function mkNode(
  id: string, label: string, model: string, layer: string,
  vendor: string, loopback: string, mgmtIp: string,
  x: number, y: number,
  opts: {
    isCloud?: boolean; haRole?: 'active' | 'standby' | 'none'; asn?: string; role?: string; features?: string[]
    mlagPairId?: number; mlagPeerLabel?: string; fhrpVip?: string
  } = {},
): HLDNode {
  const s = style(layer)
  return {
    id, label, model, layer, vendor, loopback, mgmtIp,
    role: opts.role ?? layer, x, y, w: NW, h: NH,
    isCloud: opts.isCloud ?? false,
    haRole: opts.haRole ?? 'none',
    asn: opts.asn,
    mlagPairId: opts.mlagPairId,
    mlagPeerLabel: opts.mlagPeerLabel,
    fhrpVip: opts.fhrpVip,
    features: opts.features ?? [],
    ...s,
  }
}

// ─── vPC / MLAG pairing helper (Enterprise Upgrade D1) ─────────────────────────
// Mirrors configgen.ts haPairInfo()'s pairId/isPrimary formula
// (Math.floor(idx/2)+1, idx%2===0) for the synthetic, sequentially-numbered HLD
// node lists, which don't fit haPairInfo's 01/02-suffix hostname regex.
// `count` is the total number of nodes in the layer — a node has no peer (and
// is excluded from pairing) when its computed peer index would fall outside
// [0, count). Callers resolve `peerIdx` to a label by indexing into the same
// node array (label formats vary by layer, so no string formula is assumed).
function pairInfo(i: number, count: number): { pairId: number; isPrimary: boolean; peerIdx: number } | null {
  const pairId = Math.floor(i / 2) + 1
  const isPrimary = i % 2 === 0
  const peerIdx = isPrimary ? i + 1 : i - 1
  if (peerIdx < 0 || peerIdx >= count) return null
  return { pairId, isPrimary, peerIdx }
}

// ─── DC / Multisite topology ──────────────────────────────────────────────────

function buildDCTopology(devices: BOMDevice[], underlay: string, overlay: string[], sc: string, useCase = 'dc'): Topo {
  const spineDevs = devices.filter(d => d.subLayer === 'spine')
  const leafDevs  = devices.filter(d => d.subLayer === 'leaf')
  const nSpines = Math.min(Math.max(spineDevs.length, 2), 4)
  const nLeaves = Math.min(Math.max(leafDevs.length, 4), 8)
  const spineModel = spineDevs[0]?.model ?? 'N9K-C9508'
  const leafModel  = leafDevs[0]?.model  ?? 'N9K-C9332C'

  // Layer Y-centers
  const Y: Record<string, number> = {
    internet: 72,
    wan:      188,
    corpfw:   308,
    edgefw:   428,
    spine:    548,
    leaf:     672,
    servers:  796,
  }

  const zones: SecurityZone[] = [
    { id:'z-internet', label:'INTERNET', sublabel:'Untrusted / Public',
      yStart:0, yEnd:136, fill:'rgba(17,17,17,0.9)', stroke:'#374151', icon:'🌐' },
    { id:'z-edge', label:'EDGE / UNTRUST', sublabel:'WAN · Corp FW · BGP eBGP',
      yStart:136, yEnd:380, fill:'rgba(127,29,29,0.26)', stroke:'#B91C1C', icon:'🔴' },
    { id:'z-dmz', label:'DMZ', sublabel:'Perimeter FW · IPS · TLS Inspect',
      yStart:380, yEnd:500, fill:'rgba(154,52,18,0.26)', stroke:'#C2410C', icon:'🟠' },
    { id:'z-fabric', label:'DC FABRIC / TRUST', sublabel:`${underlay.toUpperCase()} underlay · ${overlay.join('/') || 'VXLAN/EVPN'} overlay`,
      yStart:500, yEnd:746, fill:'rgba(29,78,216,0.24)', stroke:'#1D4ED8', icon:'🔵' },
    { id:'z-compute', label:'COMPUTE', sublabel:'Servers · GPU · Storage',
      yStart:746, yEnd:860, fill:'rgba(21,128,61,0.24)', stroke:'#15803D', icon:'🟢' },
  ]

  // WAN routers (always 2 for HA)
  const [wx1, wx2] = xCentered(2, 240)
  const wan1 = mkNode('wan1','WAN-RTR-01','ASR-1002-HX','wan-edge','Cisco','10.255.0.1','10.0.0.1',wx1,Y.wan,
    { haRole:'active', asn:'65000', features:['BGP eBGP','BFD','ECMP','RPKI'] })
  const wan2 = mkNode('wan2','WAN-RTR-02','ASR-1002-HX','wan-edge','Cisco','10.255.0.2','10.0.0.2',wx2,Y.wan,
    { haRole:'standby', asn:'65000', features:['BGP eBGP','BFD','ECMP','RPKI'] })

  // Corp firewalls (HA pair)
  const [fx1, fx2] = xCentered(2, 240)
  const cfw1 = mkNode('cfw1','CORP-FW-01','PA-5450','corp-fw','Palo Alto','10.255.0.11','10.0.0.11',fx1,Y.corpfw,
    { haRole:'active', features:['NGFW','IPS','URL-Filter','TLS-Decrypt','App-ID'] })
  const cfw2 = mkNode('cfw2','CORP-FW-02','PA-5450','corp-fw','Palo Alto','10.255.0.12','10.0.0.12',fx2,Y.corpfw,
    { haRole:'standby', features:['NGFW','HA-Sync','State-Sync'] })

  // Edge / Perimeter firewalls
  const [ef1x, ef2x] = xCentered(2, 240)
  const efw1 = mkNode('efw1','EDGE-FW-01','FPR-4150','edge-fw','Cisco','10.255.0.21','10.0.0.21',ef1x,Y.edgefw,
    { haRole:'active', features:['NGFW','IPS/IDS','AntiMalware','AMP'] })
  const efw2 = mkNode('efw2','EDGE-FW-02','FPR-4150','edge-fw','Cisco','10.255.0.22','10.0.0.22',ef2x,Y.edgefw,
    { haRole:'standby', features:['NGFW','HA-Sync','Stateful-Failover'] })

  // Spines
  const spineGap = nSpines <= 2 ? 280 : 90
  const spineXs = xCentered(nSpines, spineGap)
  const spines = spineXs.map((x, i) => mkNode(
    `sp${i+1}`, `SPINE-0${i+1}`, spineModel, 'spine', spineDevs[i]?.vendor ?? 'Cisco',
    `10.255.1.${i+1}`, `10.0.0.${31+i}`, x, Y.spine,
    { asn: `6500${i+1}`, features: ['BGP ECMP','VXLAN','BFD','ECMP 16-path'] },
  ))

  // Leaves
  const leafGap = nLeaves <= 4 ? 30 : 16
  const leafXs = xCentered(nLeaves, leafGap)
  const leaves = leafXs.map((x, i) => {
    const pair = pairInfo(i, nLeaves)
    const features = ['VXLAN NVE','BGP EVPN','Anycast-GW','BFD']
    if (pair) features.push(`vPC/MLAG Pair #${pair.pairId}`)
    if (useCase === 'multisite') {
      features.push(`EVPN DCI Type-5 · RT ${DCI_RT_ASN}:10010 (L2) / ${DCI_RT_ASN}:50000 (L3)`)
    }
    return mkNode(
      `lf${i+1}`, `LEAF-0${i+1 < 10 ? '0' : ''}${i+1}`, leafModel, 'leaf', leafDevs[i]?.vendor ?? 'Cisco',
      `10.255.2.${i+1}`, `10.0.0.${51+i}`, x, Y.leaf,
      { asn: `65100`, features, mlagPairId: pair?.pairId },
    )
  })
  leaves.forEach((node, i) => {
    const pair = pairInfo(i, nLeaves)
    if (pair) node.mlagPeerLabel = leaves[pair.peerIdx].label
  })

  // vPC/MLAG peer-links between adjacent leaf pairs
  const leafPeerLinks: HLDLink[] = []
  for (let i = 0; i + 1 < nLeaves; i += 2) {
    leafPeerLinks.push(mkLink(leaves[i].id, leaves[i+1].id, '2x40G LAG', 'vPC/MLAG Peer-Link', 'Po1', 'Po1', '—', { isHaSync: true }))
  }

  // Servers (representative)
  const serverXs = xCentered(Math.min(nLeaves, 6), leafGap)
  const servers = serverXs.slice(0, nLeaves - 1).map((x, i) => mkNode(
    `srv${i+1}`, `SRV-0${i+1 < 10 ? '0' : ''}${i+1}`, 'x86 2U', 'host', 'Dell',
    '', `10.200.0.${i+1}`, x, Y.servers,
    { features: ['25GE dual-homed', 'LAG', 'jumbo 9000'] },
  ))
  // Add 1 GPU server at the end
  const gpuX = serverXs[serverXs.length - 1] ?? (LEFT_W + CONTENT_W - NW)
  const gpuSrv = mkNode('gpusrv1', 'GPU-SRV-01', 'DGX A100', 'gpu', 'NVIDIA',
    '', `10.200.1.1`, gpuX, Y.servers,
    { features: ['400GE RoCEv2','PFC P3','GPUDirect RDMA','NVLink'] },
  )

  // Internet cloud node (centered)
  const [icx] = xCentered(1, 0)
  const inet = mkNode('inet','INTERNET','Dual-ISP','internet','ISP','—','—',icx - NW/2 + CONTENT_W/2 - NW,Y.internet,
    { isCloud:true, features:['BGP eBGP ISP-A (AS64512)','BGP eBGP ISP-B (AS64513)','Anycast DNS'] },
  )

  const nodes = [inet, wan1, wan2, cfw1, cfw2, efw1, efw2, ...spines, ...leaves, ...servers, gpuSrv]

  // ── Links ───────────────────────────────────────────────────────

  const links: HLDLink[] = [
    // Internet → WAN routers
    mkLink('inet','wan1','100G','BGP eBGP (ISP-A)','—','Gi0/0/0','203.0.113.0/30'),
    mkLink('inet','wan2','100G','BGP eBGP (ISP-B)','—','Gi0/0/0','198.51.100.0/30'),
    // WAN iBGP peer
    mkLink('wan1','wan2','10G','iBGP / BFD','Gi0/1','Gi0/1','192.168.0.0/30', { isHaSync:true }),
    // WAN → Corp FW (full cross-mesh)
    mkLink('wan1','cfw1','100G LAG','L3 Routed','Po10','eth1/1','10.100.0.0/30'),
    mkLink('wan1','cfw2','100G LAG','L3 Routed','Po11','eth1/1','10.100.0.4/30'),
    mkLink('wan2','cfw1','100G LAG','L3 Routed','Po10','eth1/2','10.100.0.8/30'),
    mkLink('wan2','cfw2','100G LAG','L3 Routed','Po11','eth1/2','10.100.0.12/30'),
    // Corp FW HA sync
    mkLink('cfw1','cfw2','10G','HA-Sync / State','ha1','ha1','10.10.0.0/30', { isHaSync:true }),
    // Corp FW → Edge FW
    mkLink('cfw1','efw1','100G','L3 Routed · IPS','eth1/3','Gi0/0','10.100.1.0/30'),
    mkLink('cfw2','efw2','100G','L3 Routed · IPS','eth1/3','Gi0/0','10.100.1.4/30'),
    // Edge FW HA
    mkLink('efw1','efw2','10G','HA-Sync','ha1','ha1','10.10.1.0/30', { isHaSync:true }),
    // Edge FW → Spines
    ...spines.map((sp, i) => mkLink('efw1', sp.id, '40G', 'L3 Routed', `eth1/${4+i}`, 'e1/1', `10.1.0.${i*4}/30`)),
    ...spines.map((sp, i) => mkLink('efw2', sp.id, '40G', 'L3 Routed', `eth1/${4+i}`, 'e1/2', `10.1.0.${16+i*4}/30`)),
    // Spine → Leaf (full mesh)
    ...spines.flatMap((sp, si) =>
      leaves.map((lf, li) => mkLink(sp.id, lf.id, '25G', `${underlay.toUpperCase()} / VXLAN`, `e1/${li+1}`, `e1/${si+1}`, `10.1.${si+1}.${li*4}/31`))
    ),
    // Leaf → servers (dual-homed: each server connects to leaf pair)
    ...servers.map((s, i) => mkLink(leaves[Math.min(i, nLeaves-1)].id, s.id, '25G', 'LACP LAG', `e1/49`, `eth0`, `10.200.0.${i*4}/30`)),
    mkLink(leaves[nLeaves > 1 ? nLeaves - 1 : 0].id, 'gpusrv1', '400G RoCEv2', 'PFC P3 lossless', 'e1/49', 'mlx0', '192.168.100.0/30'),
    // vPC/MLAG peer-links between adjacent leaf pairs (D1)
    ...leafPeerLinks,
  ]

  // ── Packet flow scenarios ────────────────────────────────────────

  const flows: PacketFlow[] = [
    {
      id:'ns-inbound', icon:'⬇', label:'N-S Inbound',
      desc:'Internet → Corp FW → Edge FW → Spine → Leaf → Server (HTTP/HTTPS)',
      nodeSeq:['inet','wan1','cfw1','efw1','sp1','lf1','srv1'],
      color:'#F59E0B', animDur: 2.2,
    },
    {
      id:'ew-vxlan', icon:'↔', label:'E-W VXLAN',
      desc:'Server-to-Server east-west via VXLAN overlay (same fabric, different leaf)',
      nodeSeq:['srv1','lf1','sp1','lf2','srv2'],
      color:'#3B82F6', animDur: 1.8,
    },
    {
      id:'ns-egress', icon:'⬆', label:'N-S Egress',
      desc:'Server → Edge FW → Corp FW → WAN → Internet (SNAT)',
      nodeSeq:['srv1','lf1','sp1','efw1','cfw1','wan1','inet'],
      color:'#8B5CF6', animDur: 2.4,
    },
    {
      id:'ha-failover', icon:'🔄', label:'HA Failover',
      desc:'Corp FW active→standby failover via HA sync link (sub-second)',
      nodeSeq:['wan1','cfw1','cfw2','efw1'],
      color:'#EF4444', animDur: 1.5,
    },
    {
      id:'gpu-rdma', icon:'⚡', label:'GPU RoCEv2',
      desc:'GPU-to-GPU RDMA (RoCEv2) via lossless PFC fabric (zero packet loss)',
      nodeSeq:['gpusrv1','lf' + nLeaves,'sp1','lf1','srv1'],
      color:'#10B981', animDur: 1.2,
    },
    {
      id:'mgmt', icon:'🔧', label:'OOB Mgmt',
      desc:'Out-of-band SSH/SNMP management to all devices via MGMT VLAN 10',
      nodeSeq:['wan1','cfw1','efw1','sp1','lf1'],
      color:'#6B7280', animDur: 3.0,
    },
  ]

  return {
    nodes, links, zones, flows,
    title: `DC Spine-Leaf HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: `${nSpines} Spine · ${nLeaves} Leaf · ${underlay.toUpperCase()} underlay · ${overlay.join('/') || 'VXLAN/EVPN'} overlay`,
    svgH: 920,
  }
}

// ─── Campus topology ──────────────────────────────────────────────────────────

function buildCampusTopology(devices: BOMDevice[], underlay: string, sc: string): Topo {
  const distDevs   = devices.filter(d => d.subLayer === 'distribution')
  const accessDevs = devices.filter(d => d.subLayer === 'access')
  const nDist   = Math.min(Math.max(distDevs.length, 4), 6)
  const nAccess = Math.min(Math.max(accessDevs.length, 6), 10)
  const distModel   = distDevs[0]?.model ?? 'C9500-48Y4C'
  const accessModel = accessDevs[0]?.model ?? 'C9300-48P'

  const Y: Record<string, number> = {
    internet: 72, wan: 192, fw: 312, core: 432, dist: 552, access: 672, hosts: 800,
  }

  const zones: SecurityZone[] = [
    { id:'z-int',  label:'INTERNET', sublabel:'Dual ISP BGP',
      yStart:0,   yEnd:140, fill:'rgba(17,17,17,0.9)', stroke:'#374151', icon:'🌐' },
    { id:'z-edge', label:'EDGE / UNTRUST', sublabel:'WAN Edge · BGP eBGP',
      yStart:140, yEnd:260, fill:'rgba(127,29,29,0.26)', stroke:'#B91C1C', icon:'🔴' },
    { id:'z-fw',   label:'PERIMETER FW', sublabel:'NGFW · IPS · 802.1X NAC',
      yStart:260, yEnd:380, fill:'rgba(154,52,18,0.26)', stroke:'#C2410C', icon:'🟠' },
    { id:'z-core', label:'CAMPUS CORE', sublabel:`${underlay.toUpperCase()} Area 0 · VSS/StackWise · L3 GW`,
      yStart:380, yEnd:620, fill:'rgba(88,28,135,0.24)', stroke:'#7E22CE', icon:'🟣' },
    { id:'z-access', label:'ACCESS', sublabel:'802.1X · PoE+ · DAI · LLDP',
      yStart:620, yEnd:870, fill:'rgba(21,128,61,0.24)', stroke:'#15803D', icon:'🟢' },
  ]

  const [icx] = xCentered(1, 0)
  const inet = mkNode('inet','INTERNET','Dual-ISP','internet','ISP','—','—', icx - NW/2 + CONTENT_W/2 - NW, Y.internet,
    { isCloud:true, features:['BGP ISP-A (AS64512)', 'BGP ISP-B (AS64513)'] })
  const [wx1, wx2] = xCentered(2, 240)
  const wan1 = mkNode('wan1','WAN-RTR-01','ASR-1001X','wan-edge','Cisco','10.255.0.1','10.0.0.1',wx1,Y.wan,
    { haRole:'active', asn:'65000', features:['BGP eBGP','OSPF Area 0','BFD'] })
  const wan2 = mkNode('wan2','WAN-RTR-02','ASR-1001X','wan-edge','Cisco','10.255.0.2','10.0.0.2',wx2,Y.wan,
    { haRole:'standby', asn:'65000', features:['BGP eBGP','OSPF Area 0','BFD'] })
  const [fw1x, fw2x] = xCentered(2, 240)
  const fw1 = mkNode('fw1','CORP-FW-01','PA-3430','corp-fw','Palo Alto','10.255.0.11','10.0.0.11',fw1x,Y.fw,
    { haRole:'active', features:['NGFW','IPS','URL-Filter','App-ID','802.1X NAC'] })
  const fw2 = mkNode('fw2','CORP-FW-02','PA-3430','corp-fw','Palo Alto','10.255.0.12','10.0.0.12',fw2x,Y.fw,
    { haRole:'standby', features:['NGFW','HA-Sync'] })
  const [c1x, c2x] = xCentered(2, 240)
  const core1 = mkNode('core1','CORE-SW-01','C9500-32QC','core','Cisco','10.255.0.21','10.0.0.21',c1x,Y.core,
    { haRole:'active', features:['VSS','OSPF Area0','HSRP','DHCP-Server','VLAN trunk'] })
  const core2 = mkNode('core2','CORE-SW-02','C9500-32QC','core','Cisco','10.255.0.22','10.0.0.22',c2x,Y.core,
    { haRole:'standby', features:['VSS member','OSPF Area0','HSRP standby'] })

  const distGap = nDist <= 4 ? 60 : 28
  const distXs = xCentered(nDist, distGap)
  const dists = distXs.map((x, i) => {
    const pair = pairInfo(i, nDist)
    const features = ['MLAG','OSPF Area0','DHCP-Relay','Inter-VLAN']
    let fhrpVip: string | undefined
    if (pair) {
      features.push(`vPC/MLAG Pair #${pair.pairId}`)
      fhrpVip = `10.10.${pair.pairId - 1}.1`
    }
    return mkNode(
      `dist${i+1}`, `DIST-SW-0${i+1}`, distModel, 'distribution', distDevs[i]?.vendor ?? 'Cisco',
      `10.255.0.${30+i}`, `10.0.0.${31+i}`, x, Y.dist,
      { features, mlagPairId: pair?.pairId, fhrpVip },
    )
  })
  dists.forEach((node, i) => {
    const pair = pairInfo(i, nDist)
    if (pair) node.mlagPeerLabel = dists[pair.peerIdx].label
  })

  // vPC/MLAG peer-links between adjacent distribution pairs (D1)
  const distPeerLinks: HLDLink[] = []
  for (let i = 0; i + 1 < nDist; i += 2) {
    distPeerLinks.push(mkLink(dists[i].id, dists[i+1].id, '2x40G LAG', 'vPC/MLAG Peer-Link', 'Po1', 'Po1', '—', { isHaSync: true }))
  }

  // Each access switch's MEC uplink lands on the dist switch it's wired to
  // below (perDist-sized slices of `dists`); annotate with that dist's vPC pair.
  const perDist = Math.ceil(nAccess / nDist)
  const accessGap = nAccess <= 6 ? 28 : 14
  const accessXs = xCentered(nAccess, accessGap)
  const accesses = accessXs.map((x, i) => {
    const di = Math.min(Math.floor(i / perDist), nDist - 1)
    const distPairId = Math.floor(di / 2) + 1
    const features = ['802.1X','PoE+','DAI','LLDP','VLAN', `MEC uplink: Port-channel${i+1} → DIST-SW-0${di+1} (vPC pair #${distPairId})`]
    return mkNode(
      `acc${i+1}`, `ACC-SW-0${i+1 < 10 ? '0' : ''}${i+1}`, accessModel, 'access', accessDevs[i]?.vendor ?? 'Cisco',
      `10.255.0.${50+i}`, `10.0.0.${51+i}`, x, Y.access,
      { features },
    )
  })

  // Host icons (representative)
  const hostXs = xCentered(5, 80)
  const hostLabels = ['PC-01','PHONE-01','AP-01','PRINTER','SERVER']
  const hosts = hostLabels.map((label, i) => mkNode(
    `host${i+1}`, label, 'Endpoint', 'host', '—', '', `10.10.0.${i+1}`, hostXs[i], Y.hosts,
    { features:['VLAN20 Corp'] },
  ))

  const nodes = [inet, wan1, wan2, fw1, fw2, core1, core2, ...dists, ...accesses, ...hosts]

  const links: HLDLink[] = [
    mkLink('inet','wan1','1G','BGP ISP-A','—','Gi0/0/0','203.0.113.0/30'),
    mkLink('inet','wan2','1G','BGP ISP-B','—','Gi0/0/0','198.51.100.0/30'),
    mkLink('wan1','wan2','1G','iBGP peer','Gi0/1','Gi0/1','192.168.0.0/30', { isHaSync:true }),
    mkLink('wan1','fw1','10G','L3 Routed','Te0/0/0','eth1/1','10.100.0.0/30'),
    mkLink('wan2','fw2','10G','L3 Routed','Te0/0/0','eth1/1','10.100.0.4/30'),
    mkLink('fw1','fw2','1G','HA-Sync','ha1','ha1','10.10.0.0/30', { isHaSync:true }),
    mkLink('fw1','core1','10G',`L3 · ${underlay.toUpperCase()}`,'eth1/3','Te1/0/1','10.100.1.0/30'),
    mkLink('fw2','core2','10G',`L3 · ${underlay.toUpperCase()}`,'eth1/3','Te1/0/1','10.100.1.4/30'),
    mkLink('core1','core2','40G','VSS / MEC','Te1/0/48','Te1/0/48','—', { isHaSync:true }),
    ...dists.map((d, i) => mkLink('core1', d.id, '40G', `${underlay.toUpperCase()} · MLAG`, `Te1/0/${i+2}`, 'Te1/0/1', `10.0.${1+i*2}.0/31`)),
    ...dists.map((d, i) => mkLink('core2', d.id, '40G', `${underlay.toUpperCase()} · MLAG`, `Te1/0/${i+2}`, 'Te1/0/2', `10.0.${2+i*2}.0/31`)),
    ...dists.flatMap((dist, di) =>
      accesses.slice(di * perDist, (di+1) * perDist).map((acc) =>
        mkLink(dist.id, acc.id, '10G', '802.1Q Trunk', 'Te1/0/3', 'Gi0/1', '—')
      )
    ),
    ...hosts.map((h, i) => mkLink(accesses[Math.min(i, nAccess-1)].id, h.id, '1G', '802.1X Access', 'Gi1/0/1', 'eth0', '—')),
    // vPC/MLAG peer-links between adjacent distribution pairs (D1)
    ...distPeerLinks,
  ]

  const flows: PacketFlow[] = [
    {
      id:'ns-inbound', icon:'⬇', label:'N-S Inbound',
      desc:'Internet → WAN → Corp FW → Core → Distribution → PC (HTTP)',
      nodeSeq:['inet','wan1','fw1','core1','dist1','acc1','host1'],
      color:'#F59E0B', animDur: 2.5,
    },
    {
      id:'intra-campus', icon:'↔', label:'Intra-Campus',
      desc:'PC-to-PC traffic routed at core via OSPF inter-VLAN',
      nodeSeq:['host1','acc1','dist1','core1','dist2','acc2','host2'],
      color:'#3B82F6', animDur: 2.0,
    },
    {
      id:'ns-egress', icon:'⬆', label:'Internet Egress',
      desc:'PC → Core → FW (SNAT) → WAN → Internet',
      nodeSeq:['host1','acc1','dist1','core1','fw1','wan1','inet'],
      color:'#8B5CF6', animDur: 2.4,
    },
    {
      id:'voice', icon:'📞', label:'Voice / UC',
      desc:'IP Phone → Access (VLAN 30) → Distribution → Core → UC Server',
      nodeSeq:['host2','acc2','dist2','core2','dist1','acc1'],
      color:'#22C55E', animDur: 1.8,
    },
    {
      id:'ha-failover', icon:'🔄', label:'HA Failover',
      desc:'Corp FW active→standby switchover via HA sync link',
      nodeSeq:['wan1','fw1','fw2','core1'],
      color:'#EF4444', animDur: 1.5,
    },
    {
      id:'8021x-auth', icon:'🔐', label:'802.1X Auth',
      desc:'Endpoint authentication via 802.1X → RADIUS → FW → Identity Policy',
      nodeSeq:['host1','acc1','dist1','fw1'],
      color:'#F97316', animDur: 2.2,
    },
  ]

  return {
    nodes, links, zones, flows,
    title: `Campus LAN HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: `2 Core · ${nDist} Distribution · ${nAccess} Access · ${underlay.toUpperCase()} · OSPF Area 0`,
    svgH: 900,
  }
}

// ─── GPU topology ─────────────────────────────────────────────────────────────

function buildGPUTopology(devices: BOMDevice[], sc: string): Topo {
  const spineDevs = devices.filter(d => d.subLayer === 'spine')
  const leafDevs = devices.filter(d => d.subLayer === 'leaf')
  const nLeaves  = Math.min(Math.max(leafDevs.length, 4), 8)
  const nGPU     = Math.min(nLeaves * 2, 8)
  // Reflect the actual BOM hardware rather than hardcoding one vendor.
  const leafModel    = leafDevs[0]?.model  ?? 'SN4600C'
  const leafVendor   = leafDevs[0]?.vendor ?? 'NVIDIA'
  const spineModel   = spineDevs[0]?.model  ?? 'SN4800'
  const spineVendor  = spineDevs[0]?.vendor ?? 'NVIDIA'

  const Y: Record<string, number> = {
    oob: 72, spine: 220, leaf: 360, gpu: 500, storage: 630,
  }

  const zones: SecurityZone[] = [
    { id:'z-oob',  label:'OOB MGMT', sublabel:'Out-of-band · SSH · SNMP · Syslog',
      yStart:0,   yEnd:148, fill:'rgba(28,25,23,0.9)', stroke:'#57534E', icon:'⚙' },
    { id:'z-fabric', label:'GPU FABRIC', sublabel:'RoCEv2 lossless · PFC priority 3 · ECN/DCQCN · BFD',
      yStart:148, yEnd:580, fill:'rgba(6,78,59,0.26)', stroke:'#065F46', icon:'🟢' },
    { id:'z-compute', label:'GPU COMPUTE', sublabel:'NVIDIA A100/H100 · NVLink · GPUDirect RDMA · NVMe-oF',
      yStart:580, yEnd:730, fill:'rgba(30,27,75,0.28)', stroke:'#3730A3', icon:'⚡' },
  ]

  const oob = mkNode('oob','OOB-MGMT-SW','C9300-24T','oob','Cisco','10.0.0.250','10.0.0.250',
    LEFT_W + CONTENT_W/2 - NW/2, Y.oob,
    { features:['VLAN10 OOB','SSH','SNMPv3','Syslog'] })

  const [sx1, sx2] = xCentered(2, 320)
  const sp1 = mkNode('sp1',spineDevs[0]?.hostname ?? 'GPU-SPINE-01',spineModel,'spine',spineVendor,'10.255.1.1','10.0.0.31',sx1,Y.spine,
    { haRole:'active', asn:'65001', features:['400G QSFP-DD','RoCEv2 lossless','ECN','DCQCN'] })
  const sp2 = mkNode('sp2',spineDevs[1]?.hostname ?? 'GPU-SPINE-02',spineModel,'spine',spineVendor,'10.255.1.2','10.0.0.32',sx2,Y.spine,
    { haRole:'active', asn:'65001', features:['400G QSFP-DD','RoCEv2 lossless','ECN','DCQCN'] })

  const leafGap = nLeaves <= 4 ? 30 : 16
  const leafXs = xCentered(nLeaves, leafGap)
  const leaves = leafXs.map((x, i) => {
    const pair = pairInfo(i, nLeaves)
    const features = ['400G ToR','PFC P3','ECN','VXLAN NVE','BFD']
    if (pair) features.push(`vPC/MLAG Pair #${pair.pairId}`)
    return mkNode(
      `lf${i+1}`, leafDevs[i]?.hostname ?? `GPU-LEAF-0${i+1}`, leafModel, 'leaf', leafVendor,
      `10.255.2.${i+1}`, `10.0.0.${51+i}`, x, Y.leaf,
      { features, mlagPairId: pair?.pairId },
    )
  })
  leaves.forEach((node, i) => {
    const pair = pairInfo(i, nLeaves)
    if (pair) node.mlagPeerLabel = leaves[pair.peerIdx].label
  })

  // vPC/MLAG peer-links between adjacent ToR pairs (D1)
  const leafPeerLinks: HLDLink[] = []
  for (let i = 0; i + 1 < nLeaves; i += 2) {
    leafPeerLinks.push(mkLink(leaves[i].id, leaves[i+1].id, '2x100G LAG', 'vPC/MLAG Peer-Link', 'Po1', 'Po1', '—', { isHaSync: true }))
  }

  const gpuXs = xCentered(nGPU, 16)
  const gpuNodes = gpuXs.map((x, i) => mkNode(
    `gpu${i+1}`, `A100-SRV-0${i+1}`, 'DGX A100', 'gpu', 'NVIDIA',
    '', `192.168.100.${i+1}`, x, Y.gpu,
    { features:['8× A100 GPU','NVLink 4th','400GE dual-port','RDMA GPUDirect'] },
  ))

  const [st1x, st2x] = xCentered(2, 200)
  const stor1 = mkNode('stor1','NVMe-STOR-01','EF-570','storage','NetApp','','192.168.200.1',st1x,Y.storage,
    { features:['NVMe-oF TCP','24×7.68TB NVMe','GPUDirect Storage'] })
  const stor2 = mkNode('stor2','NVMe-STOR-02','EF-570','storage','NetApp','','192.168.200.2',st2x,Y.storage,
    { features:['NVMe-oF TCP','24×7.68TB NVMe','GPUDirect Storage'] })

  const nodes = [oob, sp1, sp2, ...leaves, ...gpuNodes, stor1, stor2]

  const links: HLDLink[] = [
    mkLink('oob','sp1','1G','OOB Mgmt','Gi0/1','Gi0/48','—', { isOob:true }),
    mkLink('oob','sp2','1G','OOB Mgmt','Gi0/2','Gi0/48','—', { isOob:true }),
    ...leaves.map((lf, i) => mkLink('oob', lf.id, '1G', 'OOB Mgmt', `Gi0/${3+i}`, 'Gi0/48', '—', { isOob:true })),
    ...leaves.map((lf, i) => mkLink('sp1', lf.id, '400G', 'IS-IS / RoCEv2', `e1/${i+1}`, 'e1/1', `10.1.0.${i*4}/31`)),
    ...leaves.map((lf, i) => mkLink('sp2', lf.id, '400G', 'IS-IS / RoCEv2', `e1/${i+1}`, 'e1/2', `10.1.1.${i*4}/31`)),
    ...gpuNodes.map((g, i) => mkLink(leaves[Math.floor(i / 2)].id, g.id, '400G', 'RoCEv2 PFC lossless', `e1/${20+i}`, 'mmc0', `192.168.100.${i*4}/30`)),
    mkLink(leaves[0].id, 'stor1', '400G', 'NVMe-oF TCP / RDMA', 'e1/40', 'e0a', '192.168.200.0/30'),
    mkLink(leaves[nLeaves > 1 ? 1 : 0].id, 'stor2', '400G', 'NVMe-oF TCP / RDMA', 'e1/40', 'e0a', '192.168.200.4/30'),
    // vPC/MLAG peer-links between adjacent ToR pairs (D1)
    ...leafPeerLinks,
  ]

  const flows: PacketFlow[] = [
    {
      id:'gpu-rdma', icon:'⚡', label:'GPU↔GPU RDMA',
      desc:'RoCEv2 RDMA between GPU servers via lossless PFC fabric (sub-μs latency)',
      nodeSeq:['gpu1','lf1','sp1','lf2','gpu3'],
      color:'#10B981', animDur: 0.9,
    },
    {
      id:'nvme-read', icon:'💾', label:'NVMe-oF Read',
      desc:'GPU server reads training data from NVMe-oF storage via GPUDirect Storage',
      nodeSeq:['gpu1','lf1','sp1','lf1','stor1'],
      color:'#6366F1', animDur: 1.2,
    },
    {
      id:'allreduce', icon:'🔁', label:'AllReduce',
      desc:'NCCL AllReduce gradient sync across all GPUs (ring / tree algorithm)',
      nodeSeq:['gpu1','lf1','sp1','sp2','lf2','gpu3'],
      color:'#F59E0B', animDur: 1.0,
    },
    {
      id:'oob-mgmt', icon:'🔧', label:'OOB Mgmt',
      desc:'Out-of-band SSH/SNMPv3 management to all network devices',
      nodeSeq:['oob','sp1','lf1','gpu1'],
      color:'#6B7280', animDur: 3.0,
    },
  ]

  return {
    nodes, links, zones, flows,
    title: `GPU AI Fabric HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: `2 Spine · ${nLeaves} ToR · ${nGPU} GPU Servers · RoCEv2 lossless · PFC priority 3`,
    svgH: 760,
  }
}

// ─── WAN topology ─────────────────────────────────────────────────────────────

function buildWANTopology(devices: BOMDevice[], underlay: string, sc: string): Topo {
  const nBranches = Math.min(Math.max(devices.filter(d => d.subLayer === 'wan-edge' || d.role === 'wan').length, 3), 5)

  const Y: Record<string, number> = {
    isp: 72, hub: 200, wan: 340, branch: 490, hosts: 640,
  }

  const zones: SecurityZone[] = [
    { id:'z-isp', label:'SP BACKBONE', sublabel:'MPLS / Internet Transit',
      yStart:0, yEnd:140, fill:'rgba(17,17,17,0.9)', stroke:'#374151', icon:'🌐' },
    { id:'z-hub', label:'HQ / HUB', sublabel:'BGP Route Reflector · PE handoff',
      yStart:140, yEnd:280, fill:'rgba(127,29,29,0.26)', stroke:'#B91C1C', icon:'🔴' },
    { id:'z-wan', label:'WAN TRANSPORT', sublabel:`${underlay.toUpperCase()} · SD-WAN · MPLS · BFD`,
      yStart:280, yEnd:430, fill:'rgba(29,78,216,0.24)', stroke:'#1D4ED8', icon:'🔵' },
    { id:'z-branch', label:'BRANCH SITES', sublabel:'CPE · L3 VPN · QoS · Local Internet Breakout',
      yStart:430, yEnd:720, fill:'rgba(21,128,61,0.24)', stroke:'#15803D', icon:'🟢' },
  ]

  const ispX = LEFT_W + CONTENT_W/2 - NW/2
  const isp = mkNode('isp','SP-BACKBONE','MPLS/Internet','internet','ISP','—','—', ispX, Y.isp,
    { isCloud:true, features:['MPLS L3VPN','Internet Transit','BGP full-table'] })

  const [hub1x, hub2x] = xCentered(2, 200)
  const hub1 = mkNode('hub1','HQ-PE-RTR-01','ASR-9001','wan-edge','Cisco','10.0.0.1','10.0.0.1',hub1x,Y.hub,
    { haRole:'active', asn:'65000', features:['BGP RR','MPLS PE','SR-MPLS','BFD'] })
  const hub2 = mkNode('hub2','HQ-PE-RTR-02','ASR-9001','wan-edge','Cisco','10.0.0.2','10.0.0.2',hub2x,Y.hub,
    { haRole:'standby', asn:'65000', features:['BGP RR standby','MPLS PE','SR-MPLS'] })

  const wanXs = xCentered(nBranches, 40)
  const wanRtrs = wanXs.map((x, i) => mkNode(
    `wan${i+1}`, `WAN-CPE-0${i+1}`, 'ISR-4331', 'wan-edge', 'Cisco',
    `10.0.1.${i+1}`, `10.0.0.${11+i}`, x, Y.wan,
    { features: ['L3VPN PE','QoS DSCP 6-class','BFD','SD-WAN overlay'] },
  ))

  const branchXs = xCentered(nBranches, 40)
  const branches = branchXs.map((x, i) => mkNode(
    `br${i+1}`, `BR-RTR-0${i+1}`, 'ISR-1100', 'distribution', 'Cisco',
    `10.10.${i+1}.1`, `10.0.0.${51+i}`, x, Y.branch,
    { features: ['OSPF Area 10','IPSec fallback','Local-breakout','ZBF'] },
  ))

  const hostXs = xCentered(nBranches, 40)
  const branchHosts = hostXs.map((x, i) => mkNode(
    `brhost${i+1}`, `BR${i+1}-HOST`, 'Endpoint', 'host', '—', '', `10.10.${i+1}.10`,
    x, Y.hosts, { features: ['VLAN20'] },
  ))

  const nodes = [isp, hub1, hub2, ...wanRtrs, ...branches, ...branchHosts]

  const links: HLDLink[] = [
    mkLink('isp','hub1','10G','MPLS / BGP full-table','—','Gi0/0/0','203.0.0.0/30'),
    mkLink('isp','hub2','10G','MPLS / BGP full-table','—','Gi0/0/0','203.0.0.4/30'),
    mkLink('hub1','hub2','1G','iBGP RR peering','Gi0/1','Gi0/1','10.0.0.0/30', { isHaSync:true }),
    ...wanRtrs.map((w, i) => mkLink('hub1', w.id, '1G', 'MPLS L3VPN / SR', `Gi0/${i+2}`, 'Gi0/0/0', `10.100.${i}.0/30`)),
    ...wanRtrs.map((w, i) => mkLink('hub2', w.id, '1G', 'MPLS backup', `Gi0/${i+2}`, 'Gi0/0/1', `10.101.${i}.0/30`)),
    ...wanRtrs.map((w, i) => mkLink(w.id, branches[i].id, '100M', 'OSPF / QoS', 'Gi0/1', 'Gi0/0', `10.10.${i+1}.0/30`)),
    ...branches.map((b, i) => mkLink(b.id, branchHosts[i].id, '1G', '802.1Q Trunk', 'Gi0/1', 'eth0', '—')),
  ]

  const flows: PacketFlow[] = [
    {
      id:'hq-branch', icon:'⬇', label:'HQ → Branch',
      desc:'HQ server to branch user via MPLS L3VPN (guaranteed bandwidth, QoS)',
      nodeSeq:['hub1','wan1','br1','brhost1'],
      color:'#F59E0B', animDur: 2.5,
    },
    {
      id:'branch-internet', icon:'⬆', label:'Local Breakout',
      desc:'Branch internet breakout — direct internet without hairpinning to HQ',
      nodeSeq:['brhost2','br2','isp'],
      color:'#3B82F6', animDur: 2.0,
    },
    {
      id:'ha-failover', icon:'🔄', label:'PE Failover',
      desc:'HQ PE router failover — traffic reroutes via secondary PE (BFD sub-second)',
      nodeSeq:['wan1','hub1','hub2','wan2'],
      color:'#EF4444', animDur: 1.5,
    },
    {
      id:'b2b', icon:'↔', label:'Branch-to-Branch',
      desc:'Branch-to-branch MPLS L3VPN (via hub) or SD-WAN direct tunnel',
      nodeSeq:['brhost1','br1','wan1','hub1','wan2','br2','brhost2'],
      color:'#8B5CF6', animDur: 3.0,
    },
  ]

  return {
    nodes, links, zones, flows,
    title: `WAN HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: `Hub-and-Spoke · ${nBranches} branch sites · ${underlay.toUpperCase()} · MPLS L3VPN`,
    svgH: 760,
  }
}

// ─── O-RAN / Private 5G topology (G-A10) ──────────────────────────────────────

function buildORANTopology(devices: BOMDevice[], sc: string): Topo {
  const duDevs = devices.filter(d => d.subLayer === 'oran-du')
  const ruDevs = devices.filter(d => d.subLayer === 'oran-ru')
  const fhDevs = devices.filter(d => d.subLayer === 'oran-fronthaul')
  const nDU = Math.min(Math.max(duDevs.length, 2), 4)
  const nRU = Math.min(Math.max(ruDevs.length, 4), 8)
  const nFH = Math.min(Math.max(fhDevs.length, 1), 2)

  const Y: Record<string, number> = {
    timing: 78, core: 78, midhaul: 230, cu: 230, fronthaul: 380, du: 530, ru: 680,
  }

  const zones: SecurityZone[] = [
    { id:'z-core', label:'5G CORE + TIMING', sublabel:'UPF (N3/N6) · PTP Grandmaster (G.8275.1) · GNSS-locked PRC',
      yStart:0, yEnd:170, fill:'rgba(30,13,80,0.28)', stroke:'#3730A3', icon:'🛰' },
    { id:'z-transport', label:'TRANSPORT (MIDHAUL + CU)', sublabel:'SR-MPLS · PTP boundary-clock · F1/E1 · SyncE',
      yStart:170, yEnd:460, fill:'rgba(42,26,5,0.26)', stroke:'#92400E', icon:'🔗' },
    { id:'z-fronthaul', label:'FRONTHAUL (O-RAN 7.2x)', sublabel:'eCPRI Class C7 · PTP transparent-clock · DU↔RU lossless',
      yStart:460, yEnd:760, fill:'rgba(6,78,59,0.26)', stroke:'#065F46', icon:'📡' },
  ]

  // ── 5G Core (UPF) + PTP Grandmaster ──
  const [coreX, gmX] = xCentered(2, 280)
  const core = mkNode('upf','5GC-UPF-01','5G Core UPF','oran-core','Dell EMC','10.250.0.1','10.250.0.1',coreX,Y.core,
    { haRole:'active', features:['N3 GTP-U','N6 DN','N4 PFCP','DPDK','SmartNIC'] })
  const gm = mkNode('ptpgm','PTP-GM-01','Calnex PTP GM','oran-timing','Calnex','10.250.9.1','10.250.9.1',gmX,Y.timing,
    { features:['GNSS GPS+Galileo','G.8275.1','PRC SyncE','Class A ±100ns'] })

  // ── Midhaul routers + CU ──
  const [mhX, cuX] = xCentered(2, 280)
  const mh = mkNode('mh1','5G-MH-RTR-01','ASR 9901','oran-midhaul','Cisco','10.250.1.1','10.250.1.1',mhX,Y.midhaul,
    { asn:'65200', features:['SR-MPLS','PTP BC','SyncE','FlexE','TI-LFA'] })
  const cu = mkNode('cu1','O-CU-01','O-CU Server','oran-cu','Dell EMC','10.250.2.1','10.250.2.1',cuX,Y.cu,
    { features:['CU-CP','CU-UP','F1/E1','NG to AMF','PTP slave'] })

  // ── Fronthaul switches ──
  const fhXs = xCentered(nFH, 80)
  const fhSwitches = fhXs.map((x, i) => mkNode(
    `fh${i+1}`, `5G-FH-SW-0${i+1}`, fhDevs[i]?.model ?? 'N9K-93180YC-FX3', 'oran-fronthaul', 'Cisco',
    `10.250.3.${i+1}`, `10.250.3.${i+1}`, x, Y.fronthaul,
    { features:['PTP TC','eCPRI C7','PFC','9216 MTU','25/100G'] },
  ))

  // ── O-DU servers ──
  const duXs = xCentered(nDU, 22)
  const duNodes = duXs.map((x, i) => mkNode(
    `du${i+1}`, `O-DU-0${i+1}`, duDevs[i]?.model ?? 'O-DU Server', 'oran-du', 'Dell EMC',
    `10.250.4.${i+1}`, `10.250.4.${i+1}`, x, Y.du,
    { features:['High-PHY/MAC/RLC','eCPRI 25G','FAPI','L1 FPGA','PTP slave'] },
  ))

  // ── O-RU radios ──
  const ruXs = xCentered(nRU, 16)
  const ruNodes = ruXs.map((x, i) => mkNode(
    `ru${i+1}`, `O-RU-0${i+1}`, ruDevs[i]?.model ?? 'O-RU Radio', 'oran-ru', 'Fujitsu',
    '', `10.250.5.${i+1}`, x, Y.ru,
    { features:['64T64R mMIMO','n78 3.5GHz','Low-PHY/RF','beamforming','PTP slave'] },
  ))

  const nodes = [core, gm, mh, cu, ...fhSwitches, ...duNodes, ...ruNodes]

  const links: HLDLink[] = [
    // Timing distribution (PTP) — GM is the root of the timing tree
    mkLink('ptpgm','mh1','1G','PTP G.8275.1','p1','Gi0/0','—', { isHaSync:false }),
    mkLink('ptpgm','upf','1G','SyncE / NTP','p3','eth0','—', { isOob:true }),
    // Core ↔ CU (NG / N3) and CU ↔ midhaul
    mkLink('upf','mh1','100G','N3 GTP-U','eth1','Te0/1','10.250.10.0/30'),
    mkLink('mh1','cu1','100G','F1/NG SR-MPLS','Te0/2','eth1','10.250.11.0/30'),
    // CU ↔ Fronthaul switches (F1)
    ...fhSwitches.map((fh, i) => mkLink('cu1', fh.id, '100G', 'F1-U/C', `eth${2+i}`, 'e1/49', `10.250.12.${i*4}/30`)),
    // Midhaul ↔ Fronthaul (timing + transport)
    ...fhSwitches.map((fh, i) => mkLink('mh1', fh.id, '100G', 'PTP TC / SR', `Te0/${3+i}`, 'e1/50', `10.250.13.${i*4}/30`)),
    // Fronthaul switches ↔ O-DU
    ...duNodes.map((du, i) => mkLink(fhSwitches[i % nFH].id, du.id, '25G', 'eCPRI fronthaul', `e1/${1+i}`, 'eth0', `10.250.14.${i*4}/30`)),
    // O-DU ↔ O-RU (eCPRI 7.2x split)
    ...ruNodes.map((ru, i) => mkLink(duNodes[Math.floor(i / Math.ceil(nRU / nDU))]?.id ?? duNodes[0].id, ru.id, '25G', 'eCPRI 7.2x', `eth${1+i}`, 'sfp0', `10.250.15.${i*4}/30`)),
  ]

  const flows: PacketFlow[] = [
    {
      id:'uplink-ue', icon:'📱', label:'UE Uplink',
      desc:'User equipment uplink: O-RU → O-DU → O-CU → UPF → data network (N6)',
      nodeSeq:['ru1','du1','fh1','cu1','mh1','upf'],
      color:'#34D399', animDur: 1.1,
    },
    {
      id:'downlink-ue', icon:'📶', label:'UE Downlink',
      desc:'Downlink user-plane: UPF (N3 GTP-U) → CU → DU → RU → air interface',
      nodeSeq:['upf','mh1','cu1','fh1','du1','ru1'],
      color:'#60A5FA', animDur: 1.1,
    },
    {
      id:'ptp-sync', icon:'🛰', label:'PTP Timing',
      desc:'IEEE 1588 PTP timing distribution: GNSS grandmaster → boundary/transparent clocks → DU/RU (±65ns fronthaul budget)',
      nodeSeq:['ptpgm','mh1','fh1','du1','ru1'],
      color:'#F87171', animDur: 2.4,
    },
    {
      id:'ecpri-fh', icon:'📡', label:'eCPRI Fronthaul',
      desc:'O-RAN 7.2x split eCPRI IQ-data between O-DU (high-PHY) and O-RU (low-PHY/RF)',
      nodeSeq:['du1','fh1','ru1'],
      color:'#FB923C', animDur: 0.9,
    },
  ]

  return {
    nodes, links, zones, flows,
    title: `Private 5G / O-RAN HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: `5GC UPF · 1 O-CU · ${nDU} O-DU · ${nRU} O-RU · eCPRI 7.2x fronthaul · PTP G.8275.1 timing`,
    svgH: 800,
  }
}

// ─── Topology dispatcher ──────────────────────────────────────────────────────

function buildTopology(devices: BOMDevice[], useCase: string, underlay: string, overlay: string[], sc: string): Topo {
  if (useCase === 'gpu')       return buildGPUTopology(devices, sc)
  if (useCase === 'campus')    return buildCampusTopology(devices, underlay, sc)
  if (useCase === 'wan')       return buildWANTopology(devices, underlay, sc)
  if (useCase === 'oran')      return buildORANTopology(devices, sc)
  return buildDCTopology(devices, underlay, overlay, sc, useCase)  // dc, multisite, multicloud, aviatrix
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function linkPath(n1: HLDNode, n2: HLDNode, isHa?: boolean): string {
  const x1 = n1.x + n1.w / 2
  const y1 = n1.y + n1.h
  const x2 = n2.x + n2.w / 2
  const y2 = n2.y
  if (isHa) {
    // horizontal HA sync line between siblings
    const sy = Math.min(n1.y, n2.y) + NH / 2
    return `M${n1.x + n1.w},${sy} L${n2.x},${sy}`
  }
  const my = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  devices: BOMDevice[]
  useCase?: string
  underlayProtocol?: string
  overlayProtocols?: string[]
  siteCode?: string
}

export function HLDTopologyDiagram({ devices, useCase = 'dc', underlayProtocol = 'isis', overlayProtocols = ['vxlan_evpn'], siteCode = '' }: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [primaryPathOnly, setPrimaryPathOnly] = useState(false)
  const [showHealth, setShowHealth] = useState(false)

  const topo = useMemo(
    () => buildTopology(devices.length ? devices : [], useCase, underlayProtocol, overlayProtocols, siteCode),
    [devices, useCase, underlayProtocol, overlayProtocols, siteCode],
  )

  // C2: per-node health overlay — simulated telemetry snapshot, keyed by node id.
  const healthMap: Record<string, NodeHealth> = useMemo(
    () => Object.fromEntries(topo.nodes.filter(n => !n.isCloud).map(n => [n.id, simulateNodeHealth(n)])),
    [topo.nodes],
  )

  // Default to first flow scenario so packets are always animated on load
  const [activeFlow, setActiveFlow] = useState<string>(() => topo.flows[0]?.id ?? '')

  const nodeMap: Record<string, HLDNode> = useMemo(
    () => Object.fromEntries(topo.nodes.map(n => [n.id, n])),
    [topo.nodes],
  )

  const selectedNodeObj = selectedNode ? nodeMap[selectedNode] : null
  const activeFlowObj   = activeFlow ? (topo.flows.find(f => f.id === activeFlow) ?? topo.flows[0] ?? null) : null

  // Build set of link IDs in the active flow path
  const flowLinkIds = useMemo(() => {
    if (!activeFlowObj) return new Set<string>()
    const seq = activeFlowObj.nodeSeq
    const ids = new Set<string>()
    for (let i = 0; i < seq.length - 1; i++) {
      ids.add(`${seq[i]}--${seq[i+1]}`)
      ids.add(`${seq[i+1]}--${seq[i]}`)
    }
    return ids
  }, [activeFlowObj])

  const flowNodeIds = useMemo(() => new Set(activeFlowObj?.nodeSeq ?? []), [activeFlowObj])

  // Build animated path for active flow (chained bezier segments)
  const flowPath = useMemo(() => {
    if (!activeFlowObj) return ''
    const seq = activeFlowObj.nodeSeq
    const segs: string[] = []
    for (let i = 0; i < seq.length - 1; i++) {
      const n1 = nodeMap[seq[i]]
      const n2 = nodeMap[seq[i+1]]
      if (!n1 || !n2) continue
      const link = topo.links.find(l => (l.from === seq[i] && l.to === seq[i+1]) || (l.from === seq[i+1] && l.to === seq[i]))
      segs.push(linkPath(n1, n2, link?.isHaSync))
    }
    return segs.join(' ')
  }, [activeFlowObj, nodeMap, topo.links])

  const LEGEND_Y = topo.svgH - 56

  return (
    <div className="space-y-3">
      {/* ── Flow scenario bar ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-1">
        <span className="text-xs text-gray-500 self-center mr-1 font-semibold uppercase tracking-wider">Packet Flow:</span>
        {topo.flows.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFlow(activeFlow === f.id ? '' : f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
              activeFlow === f.id
                ? 'border-white/30 text-white'
                : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300 bg-white/[0.02]'
            }`}
            style={activeFlow === f.id ? { borderColor: f.color, color: f.color, backgroundColor: `${f.color}18` } : {}}
          >
            {f.icon} {f.label}
          </button>
        ))}
        {activeFlow && (
          <span className="text-xs text-gray-500 self-center ml-2 italic">
            {activeFlowObj?.desc}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowHealth(v => !v)}
          className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
            showHealth
              ? 'bg-emerald-600/20 border-emerald-400 text-emerald-300'
              : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300 bg-white/[0.02]'
          }`}
        >
          {showHealth ? '🩺 Health Overlay: On' : '🩺 Health Overlay: Off'}
        </button>
        {activeFlow && (
          <button
            type="button"
            onClick={() => setPrimaryPathOnly(v => !v)}
            className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
              primaryPathOnly
                ? 'bg-blue-600/20 border-blue-400 text-blue-300'
                : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300 bg-white/[0.02]'
            }`}
          >
            {primaryPathOnly ? '⬡ Primary Path Only' : '⬡ Show All Devices'}
          </button>
        )}
      </div>

      {/* ── SVG canvas ────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl bg-[#080E1A] relative">
        <svg
          viewBox={`0 0 ${SVG_W} ${topo.svgH}`}
          style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'monospace' }}
          role="img"
          aria-label={`High-level network topology diagram for ${useCase} design with ${topo.nodes.length} devices across ${topo.zones.length} security zones`}
          onClick={(e) => { if (e.currentTarget === e.target) setSelectedNode(null) }}
        >
          <title>HLD Network Topology — {useCase.toUpperCase()}</title>
          <defs>
            {/* Animated flow path */}
            {flowPath && <path id="flow-path" d={flowPath} />}
            {/* Gradient backgrounds for zones */}
            <linearGradient id="zone-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#080E1A" stopOpacity="1" />
              <stop offset="100%" stopColor="#080E1A" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* ── Background ── */}
          <rect width={SVG_W} height={topo.svgH} fill="#080E1A" />

          {/* ── Security zones ── */}
          {topo.zones.map(z => (
            <g key={z.id}>
              <rect
                x={0} y={z.yStart} width={SVG_W} height={z.yEnd - z.yStart}
                fill={z.fill} stroke={z.stroke} strokeWidth={0.8} opacity={1} />
              {/* Left accent rail for clear zone separation */}
              <rect x={0} y={z.yStart} width={3} height={z.yEnd - z.yStart} fill={z.stroke} opacity={0.85} />
              {/* Left zone label */}
              <text x={10} y={z.yStart + 16} fill={z.stroke} fontSize={8.5} fontWeight="700" opacity={1}>
                {z.icon}
              </text>
              <text x={10} y={z.yStart + 28} fill={z.stroke} fontSize={8} fontWeight="700" opacity={1}>
                {z.label}
              </text>
              <text x={10} y={z.yStart + 40} fill="#CBD5E1" fontSize={7} fontWeight="500" opacity={0.9} style={{ maxWidth: 130 }}>
                {z.sublabel}
              </text>
              {/* Right separator line */}
              <line x1={LEFT_W - 4} y1={z.yStart} x2={LEFT_W - 4} y2={z.yEnd} stroke={z.stroke} strokeWidth={0.5} opacity={0.5} />
            </g>
          ))}

          {/* ── Title ── */}
          <text x={LEFT_W + 8} y={22} fill="#E2E8F0" fontSize={12} fontWeight="700">{topo.title}</text>
          <text x={LEFT_W + 8} y={38} fill="#94A3B8" fontSize={8.5}>{topo.subtitle}</text>

          {/* ── Links (behind nodes) ── */}
          {(primaryPathOnly ? topo.links.filter(l => flowLinkIds.has(l.id)) : topo.links).map(link => {
            const n1 = nodeMap[link.from]
            const n2 = nodeMap[link.to]
            if (!n1 || !n2) return null
            const d = linkPath(n1, n2, link.isHaSync)
            const isInFlow = flowLinkIds.has(link.id)
            const isHovered = hoveredLink === link.id

            // Label midpoint
            const x1 = n1.x + n1.w / 2, y1 = n1.y + n1.h
            const x2 = n2.x + n2.w / 2, y2 = n2.y
            const midX = (x1 + x2) / 2, midY = link.isHaSync ? n1.y + NH / 2 : (y1 + y2) / 2

            const strokeColor = link.isHaSync ? '#6B7280'
              : link.isOob ? '#44403C'
              : isInFlow ? activeFlowObj!.color
              : isHovered ? '#94A3B8'
              : '#334155'
            const strokeW = isInFlow ? 2.5 : isHovered ? 1.5 : link.isHaSync ? 1 : 0.8
            const dashArray = link.isHaSync ? '4 4' : link.isOob ? '3 5' : 'none'

            return (
              <g
                key={link.id}
                onMouseEnter={() => setHoveredLink(link.id)}
                onMouseLeave={() => setHoveredLink(null)}
                style={{ cursor: 'default' }}
              >
                <path d={d} stroke={strokeColor} strokeWidth={strokeW} fill="none" strokeDasharray={dashArray} opacity={isInFlow ? 1 : 0.55} />
                {/* Link label (shown on hover or when in flow) */}
                {(isHovered || isInFlow) && (
                  <g>
                    <rect
                      x={midX - 38} y={midY - 10} width={76} height={18}
                      rx={4} fill="#0F172A" stroke={strokeColor} strokeWidth={0.6} opacity={0.95}
                    />
                    <text x={midX} y={midY + 3} textAnchor="middle" fill={strokeColor} fontSize={7} fontWeight="600">
                      {link.speed} · {link.protocol.length > 20 ? link.protocol.slice(0, 20) : link.protocol}
                    </text>
                    {link.linkSubnet && link.linkSubnet !== '—' && (
                      <text x={midX} y={midY + 13} textAnchor="middle" fill="#94A3B8" fontSize={6}>
                        {link.linkSubnet}
                      </text>
                    )}
                  </g>
                )}
              </g>
            )
          })}

          {/* ── Ambient packet flow on ALL links (always-on background animation) ── */}
          {(primaryPathOnly ? topo.links.filter(l => flowLinkIds.has(l.id)) : topo.links).map((link, li) => {
            const n1 = nodeMap[link.from]
            const n2 = nodeMap[link.to]
            if (!n1 || !n2 || link.isOob) return null
            const isInFlow = flowLinkIds.has(link.id)
            if (isInFlow) return null   // active flow renders its own packets below
            const d = linkPath(n1, n2, link.isHaSync)
            const ambId = `amb-${link.id}`
            const dur = 2.5 + (li % 5) * 0.6
            const begin = (li % 7) * 0.4
            const col = link.isHaSync ? '#4B5563' : '#1E40AF'
            return (
              <g key={ambId}>
                <defs><path id={ambId} d={d} /></defs>
                <circle r="2" fill={col} opacity={0.45}>
                  <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${begin}s`}>
                    <mpath href={`#${ambId}`} />
                  </animateMotion>
                </circle>
              </g>
            )
          })}

          {/* ── Animated flow packets ── */}
          {activeFlowObj && flowPath && (
            <>
              {/* Glowing trail */}
              <path id="flow-path-vis" d={flowPath} stroke={activeFlowObj.color} strokeWidth={3} fill="none" opacity={0.25} />
              {/* Packet 1 */}
              <circle r="5" fill={activeFlowObj.color} opacity={0.95} filter="url(#glow)">
                <animateMotion dur={`${activeFlowObj.animDur}s`} repeatCount="indefinite" begin="0s">
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
              {/* Packet 2 (offset) */}
              <circle r="3.5" fill={activeFlowObj.color} opacity={0.7}>
                <animateMotion dur={`${activeFlowObj.animDur}s`} repeatCount="indefinite" begin={`${activeFlowObj.animDur * 0.4}s`}>
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
              {/* Packet 3 (small, more offset) */}
              <circle r="2.5" fill={activeFlowObj.color} opacity={0.5}>
                <animateMotion dur={`${activeFlowObj.animDur}s`} repeatCount="indefinite" begin={`${activeFlowObj.animDur * 0.7}s`}>
                  <mpath href="#flow-path" />
                </animateMotion>
              </circle>
            </>
          )}

          {/* ── Device nodes ── */}
          {(primaryPathOnly ? topo.nodes.filter(n => flowNodeIds.has(n.id)) : topo.nodes).map(node => {
            const isSelected = selectedNode === node.id
            const isInFlow   = flowNodeIds.has(node.id)

            if (node.isCloud) {
              return (
                <g key={node.id} transform={`translate(${node.x},${node.y - 10})`}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(isSelected ? null : node.id) }}
                  style={{ cursor: 'pointer' }}>
                  <ellipse cx={NW / 2} cy={30} rx={64} ry={22} fill={isInFlow ? '#111827' : '#0F172A'} stroke={isInFlow ? '#60A5FA' : '#374151'} strokeWidth={isSelected ? 2 : 1} />
                  <text x={NW / 2} y={34} textAnchor="middle" fill={isInFlow ? '#BAE6FD' : '#9CA3AF'} fontSize={11}>🌐 {node.label}</text>
                </g>
              )
            }

            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onClick={(e) => { e.stopPropagation(); setSelectedNode(isSelected ? null : node.id) }}
                style={{ cursor: 'pointer' }}
              >
                {/* Node box */}
                <rect width={NW} height={NH} rx={6}
                  fill={node.color} stroke={isSelected ? '#FFFFFF' : isInFlow ? activeFlowObj!.color : node.border}
                  strokeWidth={isSelected ? 2.5 : isInFlow ? 2 : 1.2}
                />
                {/* HA badge */}
                {node.haRole && node.haRole !== 'none' && (
                  <rect x={NW - 38} y={3} width={35} height={12} rx={3}
                    fill={node.haRole === 'active' ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.25)'}
                    stroke={node.haRole === 'active' ? '#22C55E' : '#64748B'} strokeWidth={0.6}
                  />
                )}
                {node.haRole && node.haRole !== 'none' && (
                  <text x={NW - 20} y={12} textAnchor="middle"
                    fill={node.haRole === 'active' ? '#22C55E' : '#64748B'} fontSize={6.5} fontWeight="700">
                    {node.haRole === 'active' ? 'ACTIVE' : 'STBY'}
                  </text>
                )}
                {/* Hostname */}
                <text x={NW / 2} y={24} textAnchor="middle"
                  fill={node.textColor} fontSize={8.5} fontWeight="700">
                  {node.label}
                </text>
                {/* Model */}
                <text x={NW / 2} y={38} textAnchor="middle"
                  fill={node.border} fontSize={7.5} opacity={0.95}>
                  {node.model}
                </text>
                {/* Loopback IP */}
                {node.loopback && node.loopback !== '—' && node.loopback !== '' && (
                  <text x={NW / 2} y={52} textAnchor="middle"
                    fill="#94A3B8" fontSize={6.5}>
                    {node.loopback}/32
                  </text>
                )}
                {/* ASN badge */}
                {node.asn && (
                  <text x={6} y={NH - 6} fill="#94A3B8" fontSize={6} fontWeight="600">
                    AS{node.asn}
                  </text>
                )}
                {/* Selected glow border */}
                {isSelected && (
                  <rect width={NW} height={NH} rx={6} fill="none" stroke="#FFFFFF" strokeWidth={0.5} opacity={0.5} />
                )}
                {/* C2: health status badge (top-left corner) */}
                {showHealth && healthMap[node.id] && (
                  <g>
                    {healthMap[node.id].status === 'down' && (
                      <circle cx={9} cy={9} r={7} fill="none" stroke={HEALTH_COLOR.down} strokeWidth={1.5}>
                        <animate attributeName="r" values="7;11;7" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                    <circle cx={9} cy={9} r={5} fill={HEALTH_COLOR[healthMap[node.id].status]} stroke="#080E1A" strokeWidth={1.5} />
                  </g>
                )}
              </g>
            )
          })}

          {/* ── Legend ── */}
          <line x1={LEFT_W} y1={LEGEND_Y} x2={SVG_W - RIGHT_PAD} y2={LEGEND_Y} stroke="#1E293B" strokeWidth={0.8} />
          <text x={LEFT_W + 8} y={LEGEND_Y + 14} fill="#94A3B8" fontSize={7}>
            ━━ Active path  · · · HA sync / OOB  ·  Click device for details  ·  Select flow scenario above to animate packet path
          </text>
          <text x={SVG_W - RIGHT_PAD} y={LEGEND_Y + 14} textAnchor="end" fill="#1D4ED8" fontSize={7} opacity={0.6}>
            ⚡ NetDesign AI HLD
          </text>
        </svg>
      </div>

      {/* ── Device detail panel ────────────────────────────────────── */}
      {selectedNodeObj && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-white text-sm">{selectedNodeObj.label}</span>
              <span className="ml-3 text-gray-500">{selectedNodeObj.model}</span>
              {selectedNodeObj.haRole && selectedNodeObj.haRole !== 'none' && (
                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-semibold ${
                  selectedNodeObj.haRole === 'active' ? 'text-green-400 bg-green-900/30' : 'text-gray-400 bg-gray-800'
                }`}>
                  {selectedNodeObj.haRole.toUpperCase()}
                </span>
              )}
            </div>
            <button onClick={() => setSelectedNode(null)}
              className="text-gray-600 hover:text-gray-300 transition-colors text-base cursor-pointer">✕</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs">Layer</div>
              <div className="text-gray-200 mt-0.5">{selectedNodeObj.layer}</div>
            </div>
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs">Vendor</div>
              <div className="text-gray-200 mt-0.5">{selectedNodeObj.vendor}</div>
            </div>
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs">Loopback</div>
              <div className="text-blue-400 mt-0.5">{selectedNodeObj.loopback || '—'}</div>
            </div>
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs">Mgmt IP</div>
              <div className="text-blue-400 mt-0.5">{selectedNodeObj.mgmtIp || '—'}</div>
            </div>
            {selectedNodeObj.asn && (
              <div>
                <div className="text-gray-600 uppercase tracking-wider text-xs">BGP ASN</div>
                <div className="text-yellow-400 mt-0.5">AS{selectedNodeObj.asn}</div>
              </div>
            )}
            {/* D1: vPC/MLAG fabric pairing */}
            {selectedNodeObj.mlagPairId !== undefined && (
              <div>
                <div className="text-gray-600 uppercase tracking-wider text-xs">Fabric Pairing</div>
                <div className="text-cyan-400 mt-0.5">
                  vPC/MLAG Pair #{selectedNodeObj.mlagPairId}
                  {selectedNodeObj.mlagPeerLabel && <> — peer: {selectedNodeObj.mlagPeerLabel}</>}
                </div>
              </div>
            )}
            {/* D1: FHRP (HSRP) virtual gateway */}
            {selectedNodeObj.fhrpVip && (
              <div>
                <div className="text-gray-600 uppercase tracking-wider text-xs">FHRP Gateway</div>
                <div className="text-cyan-400 mt-0.5">HSRP VIP (Vlan10/DATA): {selectedNodeObj.fhrpVip}</div>
              </div>
            )}
          </div>
          {selectedNodeObj.features.length > 0 && (
            <div className="pt-1">
              <div className="text-gray-600 uppercase tracking-wider text-xs mb-1.5">Features / Protocols</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedNodeObj.features.map(f => (
                  <span key={f} className="px-2 py-0.5 rounded-full text-xs bg-white/5 border border-white/10 text-gray-300">{f}</span>
                ))}
              </div>
            </div>
          )}
          {/* C2: health drill-down */}
          {showHealth && healthMap[selectedNodeObj.id] && (() => {
            const h = healthMap[selectedNodeObj.id]
            return (
              <div className="pt-1 border-t border-white/5 mt-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-gray-600 uppercase tracking-wider text-xs">Live Health</div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold"
                    style={{ color: HEALTH_COLOR[h.status], backgroundColor: `${HEALTH_COLOR[h.status]}22`, border: `1px solid ${HEALTH_COLOR[h.status]}55` }}>
                    {HEALTH_LABEL[h.status]}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-gray-600 uppercase tracking-wider text-xs">CPU</div>
                    <div className={`mt-0.5 ${h.cpu > 85 ? 'text-red-400' : h.cpu > 65 ? 'text-yellow-400' : 'text-gray-200'}`}>{h.cpu}%</div>
                  </div>
                  <div>
                    <div className="text-gray-600 uppercase tracking-wider text-xs">Memory</div>
                    <div className="text-gray-200 mt-0.5">{h.mem}%</div>
                  </div>
                  <div>
                    <div className="text-gray-600 uppercase tracking-wider text-xs">Uptime</div>
                    <div className="text-gray-200 mt-0.5">{formatUptime(h.uptimeSec)}</div>
                  </div>
                  {h.bgpSessionsUp > 0 && (
                    <div>
                      <div className="text-gray-600 uppercase tracking-wider text-xs">BGP Sessions</div>
                      <div className="text-green-400 mt-0.5">{h.bgpSessionsUp} up</div>
                    </div>
                  )}
                  <div>
                    <div className="text-gray-600 uppercase tracking-wider text-xs">Iface Errors</div>
                    <div className={`mt-0.5 ${h.ifaceErrors > 8 ? 'text-yellow-400' : 'text-gray-200'}`}>{h.ifaceErrors}/min</div>
                  </div>
                  {h.pfcDrops > 0 && (
                    <div>
                      <div className="text-gray-600 uppercase tracking-wider text-xs">PFC Drops</div>
                      <div className={`mt-0.5 ${h.pfcDrops > 100 ? 'text-purple-400' : 'text-gray-200'}`}>{h.pfcDrops}</div>
                    </div>
                  )}
                </div>
                {h.alerts.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {h.alerts.map(a => (
                      <div key={a} className="text-yellow-400 text-xs">⚠ {a}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
          <div className="pt-1">
            <div className="text-gray-600 uppercase tracking-wider text-xs mb-1.5">Connected Links</div>
            <div className="space-y-0.5">
              {topo.links.filter(l => l.from === selectedNodeObj.id || l.to === selectedNodeObj.id).map(l => {
                const peer = nodeMap[l.from === selectedNodeObj.id ? l.to : l.from]
                return (
                  <div key={l.id} className="flex gap-3 text-gray-400">
                    <span className="text-gray-600">{l.from === selectedNodeObj.id ? l.fromPort : l.toPort}</span>
                    <span className="text-blue-500">→</span>
                    <span className="text-gray-300">{peer?.label ?? l.to}</span>
                    <span className="text-gray-600">{l.to === selectedNodeObj.id ? l.fromPort : l.toPort}</span>
                    <span className="text-yellow-600/80 ml-auto">{l.speed}</span>
                    <span className="text-gray-600">{l.protocol}</span>
                    {l.linkSubnet && l.linkSubnet !== '—' && <span className="text-gray-700 font-mono text-xs">{l.linkSubnet}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
