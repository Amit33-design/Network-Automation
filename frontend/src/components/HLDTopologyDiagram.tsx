import { useState, useMemo } from 'react'
import type { AppType, BOMDevice, DeviceMetrics, UseCase } from '@/types'
import { formatUptime } from '@/lib/utils'
import {
  generateAllConfigs, fabricInterfaceView, physicalPortMap, borderLeaves, peerLinkPorts,
  CAMPUS_VLANS, ORAN_FRONTHAUL_VLAN, ORAN_PTP_DOMAIN,
} from '@/lib/configgen'
import { buildCabling, LAYER_ADJACENCY } from '@/lib/bom'
import { extractFacts, factPlatform, type DeviceFacts } from '@/lib/config-facts'
import { evaluateDevice, BGP_LAYERS } from '@/lib/monitoring'
import { deviceIcon, IconGlobe } from '@/components/icons'
import { CloseButton } from '@/components/ui/CloseButton'
import { EmptyState } from '@/components/ui/EmptyState'

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
  /** FHRP virtual-gateway IP for this node's pair, if any (D1) */
  fhrpVip?: string
  /** What the FHRP is, as the config configures it, e.g. "VRRP VIP (Vlan99 mgmt)" (AQ1). */
  fhrpLabel?: string
  /** The pairing construct the config uses: vPC, MLAG, VLT, EVPN ESI, Peer-link (AQ1). */
  pairTech?: string
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

/**
 * Tier bifurcation (user request): the security zones give coarse trust
 * bands, but an engineer reading a spine-leaf diagram wants the ROW names —
 * Spine, Leaf, Border Leaf, Server Farm — called out on the edge, the fabric
 * itself enclosed and labelled with its protocol, and the two traffic axes
 * annotated. All optional, so the builders that do not set them are unchanged.
 */
interface TierLabel {
  id: string
  /** Row centre-line this label belongs to. */
  y: number
  label: string
  /** 'left' sits in the zone gutter, 'right' outside the node area. */
  side: 'left' | 'right'
  color: string
}

/** A translucent enclosure over a contiguous span of rows (e.g. the fabric). */
interface TopoRegion {
  id: string
  yStart: number
  yEnd: number
  label: string
  /** Rendered centred inside the region — e.g. "BGP with VXLAN". */
  protocol?: string
  fill: string
  stroke: string
}

/** Dashed callout around a named subset of nodes (e.g. the border-leaf pair). */
interface NodeGroup {
  id: string
  nodeIds: string[]
  label: string
  color: string
}

/** North-south / east-west traffic annotation. */
interface TrafficAxis {
  id: string
  axis: 'ns' | 'ew'
  label: string
  color: string
  /** ns: x of the vertical rail, and y span. ew: y of the rail, and x span. */
  at: number
  from: number
  to: number
}

interface Topo {
  nodes: HLDNode[]
  links: HLDLink[]
  zones: SecurityZone[]
  flows: PacketFlow[]
  title: string
  subtitle: string
  svgH: number
  tiers?: TierLabel[]
  regions?: TopoRegion[]
  groups?: NodeGroup[]
  traffic?: TrafficAxis[]
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
/**
 * Device glyph inside an HLD node.
 *
 * Reuses the shared icon set rather than drawing a second one — the BOM table
 * and the diagram should agree about what a spine looks like. Scaled from the
 * icons' 24px grid to 18px and tinted with the node's own border colour.
 */
function NodeGlyph({ layer, color }: { layer: string; color: string }) {
  const Glyph = deviceIcon(layer)
  return (
    <g transform="scale(0.75)" color={color}>
      <Glyph size={24} />
    </g>
  )
}

const NW = 136  // node width
const NH = 66   // node height

// Overlay protocol names for display. The store holds raw enum values
// (`vxlan_evpn`); a diagram caption should read like a protocol name.
function overlayLabel(overlay: string[]): string {
  return overlay.map(o => o.replace(/_/g, '/').toUpperCase()).join(' + ') || 'VXLAN/EVPN'
}

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
// AK2 — now sourced from lib/monitoring, which also owns the heuristic it overrides.
const HEALTH_BGP_LAYERS = BGP_LAYERS

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

  // Status + alerts come from the SHARED monitoring engine (lib/monitoring.ts)
  // so the design-time overlay and the Step 6 Monitoring tab agree on health
  // semantics (thresholds, control-plane-down, cpu-pegged). This overlay only
  // owns the deterministic metric *generation*; `expectsBgp` is passed
  // explicitly because we know exactly which layers run BGP.
  const dm: DeviceMetrics = {
    cpu_util: Math.round(cpu * 10) / 10,
    mem_util: Math.round(mem * 10) / 10,
    interface_errors_in: ifaceErrors,
    interface_errors_out: 0,
    bgp_sessions_up: bgpSessionsUp,
    bgp_prefixes_received: bgpSessionsUp * 300,
    pfc_drops: pfcDrops,
    throughput_mbps: 0,
  }
  const ev = evaluateDevice(node.label, node.layer, dm, undefined, HEALTH_BGP_LAYERS.has(node.layer))

  return {
    status: ev.status,
    cpu: dm.cpu_util,
    mem: dm.mem_util,
    uptimeSec,
    bgpSessionsUp,
    ifaceErrors,
    pfcDrops,
    alerts: ev.alerts.map(a => a.message),
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
    mlagPairId?: number; mlagPeerLabel?: string; fhrpVip?: string; fhrpLabel?: string; pairTech?: string
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
    fhrpLabel: opts.fhrpLabel,
    pairTech: opts.pairTech,
    features: opts.features ?? [],
    ...s,
  }
}

// ─── Design-driven HLD (AQ1) ──────────────────────────────────────────────────
//
// The HLD used to be a fixed reference architecture per use case: two WAN
// routers, four firewalls (one a hardcoded Cisco FPR-4150), a DGX A100, a 25G
// spine↔leaf full mesh with invented /31s, and firewalls cabled to the spines
// — none of it the user's design (0 of 25 DC nodes were BOM devices; 87 of 100
// addresses appeared in no config). It is now drawn from the design the way
// AO4 redrew the LLD: every node is a BOM device, addresses and ports come
// from the same allocators the configs use, link speeds from the cabling, and
// every protocol caption from the generated configs rather than the store's
// underlay selection.

interface HldRowSpec {
  sub: string
  /** LAYER_STYLE key for the node colours. */
  layer: string
  label: string
  cap: number
  group: 'cloud' | 'edge' | 'fabric' | 'compute' | 'ran'
}

const HLD_ROWS: HldRowSpec[] = [
  { sub: 'cloud-transit',    layer: 'cloud-gw',     label: 'CLOUD TRANSIT',      cap: 4, group: 'cloud' },
  { sub: 'cloud-gw',         layer: 'cloud-gw',     label: 'CLOUD GATEWAYS',     cap: 6, group: 'cloud' },
  { sub: 'sdwan-controller', layer: 'core',         label: 'SD-WAN CONTROLLERS', cap: 5, group: 'edge' },
  { sub: 'wan-edge',         layer: 'wan-edge',     label: 'WAN EDGE',           cap: 6, group: 'edge' },
  { sub: 'firewall',         layer: 'corp-fw',      label: 'FIREWALL',           cap: 2, group: 'edge' },
  { sub: 'core',             layer: 'core',         label: 'CORE',               cap: 2, group: 'fabric' },
  { sub: 'spine',            layer: 'spine',        label: 'SPINE',              cap: 4, group: 'fabric' },
  { sub: 'distribution',     layer: 'distribution', label: 'DISTRIBUTION',       cap: 4, group: 'fabric' },
  { sub: 'leaf',             layer: 'leaf',         label: 'LEAF',               cap: 6, group: 'fabric' },
  { sub: 'access',           layer: 'access',       label: 'ACCESS',             cap: 6, group: 'fabric' },
  { sub: 'gpu-compute',      layer: 'gpu',          label: 'GPU COMPUTE',        cap: 6, group: 'compute' },
  { sub: 'oran-core',        layer: 'oran-core',    label: '5GC / UPF',          cap: 2, group: 'ran' },
  { sub: 'oran-midhaul',     layer: 'oran-midhaul', label: 'MIDHAUL',            cap: 2, group: 'ran' },
  { sub: 'oran-cu',          layer: 'oran-cu',      label: 'O-CU',               cap: 2, group: 'ran' },
  { sub: 'oran-timing',      layer: 'oran-timing',  label: 'PTP TIMING',         cap: 2, group: 'ran' },
  { sub: 'oran-fronthaul',   layer: 'oran-fronthaul', label: 'FRONTHAUL SW',     cap: 4, group: 'ran' },
  { sub: 'oran-du',          layer: 'oran-du',      label: 'O-DU',               cap: 4, group: 'ran' },
  { sub: 'oran-ru',          layer: 'oran-ru',      label: 'O-RU (RADIO)',       cap: 6, group: 'ran' },
]

const GROUP_ZONE: Record<HldRowSpec['group'], { fill: string; stroke: string }> = {
  cloud:   { fill: 'rgba(13,148,136,0.18)', stroke: '#0D9488' },
  edge:    { fill: 'rgba(127,29,29,0.26)',  stroke: '#B91C1C' },
  fabric:  { fill: 'rgba(29,78,216,0.24)',  stroke: '#1D4ED8' },
  compute: { fill: 'rgba(21,128,61,0.24)',  stroke: '#15803D' },
  ran:     { fill: 'rgba(91,33,182,0.22)',  stroke: '#7C3AED' },
}

/** Read the BGP ASN a config declares, in any of the generated dialects. */
function configAsn(cfg: string): string | undefined {
  const m = cfg.match(/^\s*router bgp (\d+)/m)
    ?? cfg.match(/^set routing-options autonomous-system (\d+)/m)
    ?? cfg.match(/^configure bgp AS-number (\d+)/m)
    ?? cfg.match(/^nv set router bgp autonomous-system (\d+)/m)
    ?? cfg.match(/^\s*autonomous-system (\d+)/m)
  return m?.[1]
}

/** The construct a config uses to pair two devices (AP5 / AN7 / AN10). */
function pairTech(cfg: string): string | undefined {
  if (/^\s*vpc peer-link/m.test(cfg)) return 'vPC'
  if (/^mlag configuration/m.test(cfg) || /^create mlag peer/m.test(cfg)) return 'MLAG'
  if (/^vlt-domain /m.test(cfg)) return 'VLT'
  if (/esi \S+|ethernet-segment|evpn multihoming segment/.test(cfg)) return 'EVPN ESI'
  return undefined
}

function fhrpKind(cfg: string): string | undefined {
  if (/^\s*standby \d+ ip /m.test(cfg)) return 'HSRP'
  if (/vrrp/i.test(cfg) || /ip virtual-router/.test(cfg) || /virtual-gateway-address/.test(cfg)) return 'VRRP'
  return undefined
}

/** Feature chips for a node, read from its own generated config (AQ1/AQ4). */
function nodeFeatures(dev: BOMDevice, cfg: string, f: DeviceFacts | undefined, border: boolean): string[] {
  const out: string[] = []
  const on = (n: keyof DeviceFacts) => f?.[n]?.state === 'present'
  if (on('isis')) out.push('IS-IS')
  if (on('ospf')) out.push('OSPF')
  if (on('bgp')) out.push(/unnumbered/.test(cfg) ? 'eBGP unnumbered' : 'BGP')
  if (on('vxlan')) out.push('VXLAN VTEP')
  if (on('evpn')) out.push('EVPN')
  if (on('bfd')) out.push('BFD')
  if (on('jumboMtu')) out.push('Jumbo MTU')
  if (on('pfc')) out.push('PFC no-drop')
  if (on('ecnLossless')) out.push('ECN (RoCE)')
  const pt = pairTech(cfg)
  if (pt) out.push(`${pt} pair`)
  const fh = dev.subLayer === 'distribution' ? fhrpKind(cfg) : undefined
  if (fh) out.push(fh)
  if (/^\s*(ipv6 address|.*family inet6 address|nv set interface \S+ ip address [0-9a-f:]+\/|.*ipv6-unicast)/m.test(cfg)) out.push('IPv6 dual-stack')
  if (/ISCSI|NVME|FCOE|vsan \d+|STORAGE/i.test(cfg) && dev.subLayer === 'leaf') out.push('Storage lossless class')
  if (/dot1x|authentication port-control|802\.1X/i.test(cfg) && dev.subLayer === 'access') out.push('802.1X')
  if (/high-availability|chassis cluster|config system ha|failover/i.test(cfg) && dev.subLayer === 'firewall') out.push('HA cluster')
  if (border) out.push('Firewall handoff (border leaf)')
  if (dev.subLayer.startsWith('cloud-')) out.push('Provisioned by Terraform')
  return out
}

/**
 * Caption for designs with no switching fabric — WAN, multi-cloud, O-RAN —
 * read from the edge / RAN configs. The store's underlay selection is shown
 * only when no device has a config at all, and is labelled as a selection.
 */
function transportCaption(devs: BOMDevice[], facts: Map<string, DeviceFacts>, configs: Record<string, string>, fallback: string): string {
  const net = devs.filter(d => !d.subLayer.startsWith('cloud-') && configs[d.id])
  const parts: string[] = []
  if (devs.some(d => d.subLayer.startsWith('cloud-'))) parts.push('Cloud transit (Terraform)')
  if (!net.length) return parts.join(' · ') || fallback
  const text = net.map(d => configs[d.id]).join('\n')
  const has = (n: keyof DeviceFacts) => net.some(d => facts.get(d.id)?.[n]?.state === 'present')
  if (/tunnel mode sdwan|^\s*sdwan\b|^\s*omp\b|vbond/m.test(text)) parts.push('SD-WAN overlay (OMP · IPsec)')
  if (has('isis')) parts.push(/segment-routing|prefix-sid/.test(text) ? 'IS-IS + Segment Routing' : 'IS-IS')
  else if (has('ospf')) parts.push('OSPF')
  if (has('bgp') && !parts.some(p => p.startsWith('SD-WAN'))) parts.push('BGP')
  if (/\bptp\b/i.test(text)) parts.push('PTP timing')
  return parts.join(' · ') || fallback
}

/** One-line protocol summary of the fabric, from the configs (never the selection). */
function fabricCaption(devs: BOMDevice[], facts: Map<string, DeviceFacts>, configs: Record<string, string>, fallback: string): string {
  const fab = devs.filter(d => ['spine', 'leaf', 'core', 'distribution'].includes(d.subLayer))
  if (!fab.length) return transportCaption(devs, facts, configs, fallback)
  const has = (n: keyof DeviceFacts) => fab.some(d => facts.get(d.id)?.[n]?.state === 'present')
  const parts: string[] = []
  if (has('isis')) parts.push('IS-IS underlay')
  else if (has('ospf')) parts.push('OSPF')
  else if (has('bgp')) parts.push(fab.some(d => /unnumbered/.test(configs[d.id] ?? '')) ? 'eBGP unnumbered (RFC 7938)' : 'eBGP underlay')
  if (has('vxlan') && has('evpn')) parts.push('VXLAN/EVPN overlay')
  else if (fab.some(d => d.subLayer === 'spine') && has('bgp')) parts.push('pure L3 fabric')
  if (has('pfc')) parts.push('RoCEv2 lossless (PFC · ECN)')
  const fh = fab.map(d => d.subLayer === 'distribution' ? fhrpKind(configs[d.id] ?? '') : undefined).find(Boolean)
  if (fh) parts.push(`${fh} first hop`)
  return parts.join(' · ') || fallback
}

export function buildDesignTopology(
  devices: BOMDevice[], useCase: string, sc: string,
  configs?: Record<string, string>,
  selection: { underlay?: string; overlay?: string[] } = {},
): Topo {
  const uc = useCase as UseCase
  const cfgs = configs ?? generateAllConfigs(devices, uc)
  const facts = new Map(devices.map(d => [d.id, extractFacts(cfgs[d.id] ?? '', factPlatform(d))]))
  const border = new Set(useCase === 'dc' || useCase === 'multisite' ? borderLeaves(devices).map(d => d.id) : [])

  const pick = (r: HldRowSpec): BOMDevice[] => {
    const all = devices.filter(d => d.subLayer === r.sub)
    if (r.sub === 'leaf') {
      // The first pairs plus the border pair, so the handoff is visible.
      const head = all.filter(d => !border.has(d.id)).slice(0, Math.max(2, r.cap - border.size))
      return [...head, ...all.filter(d => border.has(d.id))].slice(0, r.cap)
    }
    return all.slice(0, r.cap)
  }
  const rows = HLD_ROWS
    .filter(r => devices.some(d => d.subLayer === r.sub))
    .map(r => ({ r, devs: pick(r), total: devices.filter(d => d.subLayer === r.sub).length }))

  const ROW_H = 124
  // Clear of the title and subtitle, which sit at the top of the canvas.
  const TOP = 104
  const yOf = (i: number) => TOP + i * ROW_H
  const shown = new Map<string, BOMDevice>()
  const nodes: HLDNode[] = []
  const nodeId = (d: BOMDevice) => `n-${d.id}`
  rows.forEach(({ r, devs }, ri) => {
    const gap = devs.length > 4 ? 16 : devs.length > 2 ? 40 : 200
    const xs = xCentered(devs.length, gap)
    devs.forEach((d, i) => {
      const cfg = cfgs[d.id] ?? ''
      const view = fabricInterfaceView(d, devices, uc)
      const lo = view.find(v => v.kind === 'loopback')
      const tier = devices.filter(x => x.subLayer === d.subLayer)
      const ti = tier.findIndex(x => x.id === d.id)
      const pt = pairTech(cfg)
      const paired = (d.subLayer === 'leaf' && pt) || (d.subLayer === 'distribution' && peerLinkPorts(d).length > 0)
      const peer = paired ? tier[ti % 2 === 0 ? ti + 1 : ti - 1] : undefined
      const fh = d.subLayer === 'distribution' ? fhrpKind(cfg) : undefined
      nodes.push(mkNode(nodeId(d), d.hostname, d.model, r.layer, d.vendor, lo?.ip ?? '—', '<CHANGE-ME-mgmt-ip>', xs[i], yOf(ri), {
        isCloud: d.subLayer.startsWith('cloud-'),
        haRole: d.subLayer === 'firewall' && tier.length >= 2 ? (ti % 2 === 0 ? 'active' : 'standby') : 'none',
        asn: configAsn(cfg),
        features: nodeFeatures(d, cfg, facts.get(d.id), border.has(d.id)),
        mlagPairId: peer ? Math.floor(ti / 2) + 1 : undefined,
        mlagPeerLabel: peer?.hostname,
        pairTech: d.subLayer === 'distribution' ? (pt ?? 'Peer-link') : pt,
        fhrpVip: fh ? CAMPUS_VLANS.mgmt.vip : undefined,
        fhrpLabel: fh ? `${fh} VIP (Vlan${CAMPUS_VLANS.mgmt.id} mgmt)` : undefined,
      }))
      shown.set(d.hostname, d)
    })
  })

  // ── Links ─────────────────────────────────────────────────────────────────
  const cabling = buildCabling(devices, {} as Parameters<typeof buildCabling>[1])
  const speedOf = (a: string, b: string) =>
    cabling.find(c => (c.fromLayer === a && c.toLayer === b) || (c.fromLayer === b && c.toLayer === a))?.speed ?? ''
  // Link labels are narrow: the underlay in its short form ("IS-IS", "eBGP /31").
  const underlayShort = ({ 'IS-IS underlay': 'IS-IS', 'eBGP underlay': 'eBGP /31', 'eBGP unnumbered (RFC 7938)': 'eBGP unnumbered' } as Record<string, string>)[
    fabricCaption(devices, facts, cfgs, '').split(' · ')[0]] ?? 'Routed'
  const byPair = new Map<string, { a: BOMDevice; b: BOMDevice; ports: [string, string]; n: number; kind: string }>()
  for (const p of physicalPortMap(devices, uc)) {
    const a = shown.get(p.a.device), b = shown.get(p.b.device)
    if (!a || !b) continue
    const key = [a.id, b.id].sort().join('|') + '|' + p.kind
    const e = byPair.get(key)
    if (e) e.n++
    else byPair.set(key, { a, b, ports: [p.a.iface, p.b.iface], n: 1, kind: p.kind })
  }
  const links: HLDLink[] = []
  const linked = new Set<string>()
  const tierLinked = new Set<string>()
  for (const { a, b, ports, n, kind } of byPair.values()) {
    const sp = speedOf(a.subLayer, b.subLayer)
    const speed = n > 1 ? `${n}×${sp}` : sp
    const va = fabricInterfaceView(a, devices, uc)
    const subnet = va.find(v => v.peer === b.hostname && v.ip.includes('.'))?.ip
      ?? fabricInterfaceView(b, devices, uc).find(v => v.peer === a.hostname && v.ip.includes('.'))?.ip ?? ''
    const protocol = kind === 'fabric' ? `${underlayShort}`
      : kind === 'firewall' ? 'Routed handoff (transit VLAN)'
      : kind === 'peer-link' ? `${pairTech(cfgs[a.id] ?? '') ?? 'HA'} peer-link`
      : kind === 'campus' ? '802.1Q trunk'
      : kind === 'host' ? 'Server access' : kind
    links.push(mkLink(nodeId(a), nodeId(b), speed, protocol, ports[0], ports[1], subnet, { isHaSync: kind === 'peer-link' }))
    linked.add([a.id, b.id].sort().join('|'))
    tierLinked.add([a.subLayer, b.subLayer].sort().join('|'))
  }
  // HA control link between firewall cluster members (AN10).
  const fws = rows.find(x => x.r.sub === 'firewall')?.devs ?? []
  for (let i = 0; i + 1 < fws.length; i += 2) {
    links.push(mkLink(nodeId(fws[i]), nodeId(fws[i + 1]), '', 'HA control / state sync', '', '', '', { isHaSync: true }))
  }
  // Tier pairs the BOM cables that no configured port already drew.
  for (const c of LAYER_ADJACENCY) {
    if (c.from === 'firewall' && c.to === 'firewall') continue
    const froms = rows.find(x => x.r.sub === c.from)?.devs ?? []
    const tos = rows.find(x => x.r.sub === c.to)?.devs ?? []
    if (!froms.length || !tos.length) continue
    if (tierLinked.has([c.from, c.to].sort().join('|'))) continue
    const sp = speedOf(c.from, c.to)
    if (c.from === c.to) {
      for (let i = 0; i + 1 < froms.length; i += 2) links.push(mkLink(nodeId(froms[i]), nodeId(froms[i + 1]), sp, 'Site pair', '', '', '', { isHaSync: true }))
      continue
    }
    tos.forEach((t, i) => {
      const f = froms[i % froms.length]
      if (linked.has([f.id, t.id].sort().join('|'))) return
      links.push(mkLink(nodeId(f), nodeId(t), sp, 'Cabled (BOM)', '', '', ''))
    })
  }
  // Overlay sessions with no cable of their own (cloud transit).
  const overlay = (fromSub: string, toSub: string, protocol: string) => {
    const froms = rows.find(x => x.r.sub === fromSub)?.devs ?? []
    const tos = rows.find(x => x.r.sub === toSub)?.devs ?? []
    tos.forEach((t, i) => froms.length && links.push(mkLink(nodeId(froms[i % froms.length]), nodeId(t), '', protocol, '', '', '', { isOob: true })))
  }
  overlay('cloud-transit', 'cloud-gw', 'Transit peering')
  overlay('cloud-transit', 'wan-edge', 'IPsec / BGP')

  // ── Zones, regions, tiers ─────────────────────────────────────────────────
  const caption = fabricCaption(devices, facts, cfgs,
    selection.underlay ? `${selection.underlay.toUpperCase()} underlay · ${overlayLabel(selection.overlay ?? [])} overlay (selected)` : '')
  const fabricLabel = useCase === 'campus' ? 'CAMPUS LAN'
    : useCase === 'gpu' ? (caption.includes('lossless') ? 'LOSSLESS FABRIC' : 'GPU FABRIC') : 'FABRIC'
  const zones: SecurityZone[] = []
  const groups = [...new Set(rows.map(x => x.r.group))]
  for (const g of groups) {
    const idx = rows.map((x, i) => (x.r.group === g ? i : -1)).filter(i => i >= 0)
    const label = g === 'cloud' ? 'CLOUD' : g === 'edge' ? 'EDGE / PERIMETER' : g === 'compute' ? 'COMPUTE' : g === 'ran' ? 'RAN' : fabricLabel
    const sub = g === 'fabric' ? caption
      : g === 'edge' ? (fws.length ? 'Firewall HA cluster · routed handoff' : 'WAN transport')
      : g === 'cloud' ? 'Provider-managed · Terraform'
      : g === 'compute' ? 'Hosts attached to the leaves'
      : `eCPRI VLAN ${ORAN_FRONTHAUL_VLAN} · PTP domain ${ORAN_PTP_DOMAIN}`
    zones.push({ id: `z-${g}`, label, sublabel: sub, yStart: yOf(idx[0]) - ROW_H / 2 + 6, yEnd: yOf(idx[idx.length - 1]) + ROW_H / 2 + 6, ...GROUP_ZONE[g], icon: '' })
  }
  const fabricIdx = rows.map((x, i) => (x.r.group === 'fabric' ? i : -1)).filter(i => i >= 0)
  const regions: TopoRegion[] = fabricIdx.length
    ? [{ id: 'r-fabric', yStart: yOf(fabricIdx[0]) - 46, yEnd: yOf(fabricIdx[fabricIdx.length - 1]) + NH + 12, label: fabricLabel, protocol: caption || undefined, fill: 'rgba(56,189,248,0.10)', stroke: '#38BDF8' }]
    : []
  const tiers: TierLabel[] = rows.map(({ r }, i) => ({
    id: `t-${r.sub}`, y: yOf(i), side: 'right',
    label: useCase === 'gpu' && r.sub === 'leaf' ? 'ToR / LEAF' : r.label,
    color: LAYER_STYLE[r.layer]?.border ?? '#9CA3AF',
  }))
  const borderIds = nodes.filter(n => border.has(n.id.slice(2))).map(n => n.id)
  const nodeGroups: NodeGroup[] = borderIds.length ? [{ id: 'g-border', nodeIds: borderIds, label: 'BORDER LEAF', color: '#F87171' }] : []
  const lastY = yOf(Math.max(0, rows.length - 1))
  const traffic: TrafficAxis[] = rows.length > 1 ? [
    { id: 'tr-ns', axis: 'ns', label: 'NORTH–SOUTH', color: '#F87171', at: LEFT_W + 14, from: yOf(0), to: lastY },
    ...(fabricIdx.length ? [{ id: 'tr-ew', axis: 'ew' as const, label: 'EAST–WEST', color: '#38BDF8', at: lastY + NH + 24, from: LEFT_W + 40, to: SVG_W - 40 }] : []),
  ] : []

  // ── Packet flows, only through nodes the design has ──────────────────────
  const first = (sub: string, n = 0) => rows.find(x => x.r.sub === sub)?.devs[n]
  const id = (d?: BOMDevice) => (d ? nodeId(d) : '')
  const leaves = rows.find(x => x.r.sub === 'leaf')?.devs ?? []
  const otherPairLeaf = leaves.find((_, i) => i >= 2) ?? leaves[1]
  const candidates: PacketFlow[] = [
    { id: 'ns', icon: '⬇', label: 'North–South', color: '#F59E0B', animDur: 2.2,
      desc: 'Perimeter → border leaf → spine → leaf (the configured firewall handoff path)',
      nodeSeq: [id(first('firewall')), id(leaves.find(l => border.has(l.id))), id(first('spine')), id(leaves[0])] },
    { id: 'ew', icon: '↔', label: 'East–West', color: '#3B82F6', animDur: 1.8,
      desc: 'Leaf → spine → leaf in another pair',
      nodeSeq: [id(leaves[0]), id(first('spine')), id(otherPairLeaf)] },
    { id: 'gpu', icon: '⚡', label: 'GPU RDMA', color: '#10B981', animDur: 1.2,
      desc: 'GPU server → ToR → spine → ToR → GPU server',
      nodeSeq: [id(first('gpu-compute')), id(leaves[0]), id(first('spine')), id(leaves[1]), id(first('gpu-compute', 1))] },
    { id: 'campus', icon: '⬆', label: 'Campus egress', color: '#8B5CF6', animDur: 2.0,
      desc: 'Access → distribution → firewall',
      nodeSeq: [id(first('access')), id(first('distribution')), id(first('firewall'))] },
    { id: 'wan', icon: '↔', label: 'Site to site', color: '#F59E0B', animDur: 2.0,
      desc: 'WAN edge pair at a site',
      nodeSeq: [id(first('wan-edge')), id(first('wan-edge', 1))] },
    { id: 'ran', icon: '📶', label: 'RAN uplink', color: '#A78BFA', animDur: 2.4,
      desc: 'Radio → DU → CU → core',
      nodeSeq: [id(first('oran-ru')), id(first('oran-du')), id(first('oran-cu')), id(first('oran-core'))] },
    { id: 'ha', icon: '🔄', label: 'HA failover', color: '#EF4444', animDur: 1.5,
      desc: 'Firewall cluster: active → standby over the HA control link',
      nodeSeq: [id(first('firewall')), id(first('firewall', 1))] },
  ]
  const flows = candidates.filter(f => f.nodeSeq.every(Boolean) && new Set(f.nodeSeq).size === f.nodeSeq.length)

  const counts = rows.map(x => `${x.total} ${x.r.label.toLowerCase()}${x.total > x.devs.length ? ` (showing ${x.devs.length})` : ''}`)
  return {
    nodes, links, zones, flows, tiers, regions, groups: nodeGroups, traffic,
    title: `${(USE_CASE_TITLE[useCase] ?? 'Network')} HLD${sc ? ` — ${sc}` : ''}`,
    subtitle: [counts.join(' · '), caption].filter(Boolean).join(' · '),
    svgH: Math.max(rows.length, 1) * ROW_H + TOP + 70,
  }
}

const USE_CASE_TITLE: Record<string, string> = {
  dc: 'DC Spine-Leaf', gpu: 'GPU Fabric', campus: 'Campus', wan: 'WAN', multisite: 'Multisite DCI',
  multicloud: 'Multi-Cloud', aviatrix: 'Aviatrix Multi-Cloud', oran: 'O-RAN / Private 5G',
}

// ─── Topology dispatcher ──────────────────────────────────────────────────────

export function buildTopology(
  devices: BOMDevice[], useCase: string, underlay: string, overlay: string[], sc: string,
  configs?: Record<string, string>,
): Topo {
  return buildDesignTopology(devices, useCase, sc, configs, { underlay, overlay })
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
  /** Used only as a labelled fallback when no generated config states a protocol (AQ1). */
  underlayProtocol?: string
  overlayProtocols?: string[]
  siteCode?: string
  /** Wizard inputs the configs honour, so the diagram shows what they produce (AQ4). */
  appTypes?: AppType[]
  protoFeatures?: string[]
}

export function HLDTopologyDiagram({
  devices, useCase = 'dc', underlayProtocol = 'isis', overlayProtocols = ['vxlan_evpn'], siteCode = '',
  appTypes = [], protoFeatures = [],
}: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)
  const [primaryPathOnly, setPrimaryPathOnly] = useState(false)
  const [showHealth, setShowHealth] = useState(false)

  // The configs the diagram describes — generated from the same inputs the
  // Config Gen step uses, so a selection that changes the configs changes the
  // diagram too (AQ4).
  const configs = useMemo(
    () => generateAllConfigs(devices, useCase as UseCase, [], appTypes, protoFeatures),
    [devices, useCase, appTypes, protoFeatures],
  )
  const topo = useMemo(
    () => buildTopology(devices, useCase, underlayProtocol, overlayProtocols, siteCode, configs),
    [devices, useCase, underlayProtocol, overlayProtocols, siteCode, configs],
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

  if (!devices.length) {
    return (
      <EmptyState
        Icon={deviceIcon('spine')}
        title="No devices in the design yet"
        description="The HLD is drawn from the BOM and the configs it generates. Choose a use case and requirements to build one."
      />
    )
  }

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
            <marker id="axisArrowDown" viewBox="0 0 10 10" refX="5" refY="9"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L5 10 L10 0 z" fill="#F87171" />
            </marker>
            <marker id="axisArrowUp" viewBox="0 0 10 10" refX="5" refY="1"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 10 L5 0 L10 10 z" fill="#F87171" />
            </marker>
            <marker id="axisArrowRight" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#38BDF8" />
            </marker>
            <marker id="axisArrowLeft" viewBox="0 0 10 10" refX="1" refY="5"
                    markerWidth="5" markerHeight="5" orient="auto">
              <path d="M10 0 L0 5 L10 10 z" fill="#38BDF8" />
            </marker>
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
              {/* Left zone label.
                  The swatch used to be a coloured-circle EMOJI in a <text>.
                  These diagrams are exported as SVG into design documents,
                  where emoji depend on the viewing application's font and
                  frequently render as tofu; a real circle also matches the
                  zone's own stroke exactly rather than approximating it. */}
              <circle cx={13.5} cy={z.yStart + 12.5} r={3.5} fill={z.stroke} />
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

          {/* ── Fabric / tier regions (behind links and nodes) ── */}
          {(topo.regions ?? []).map(r => (
            <g key={r.id}>
              <rect
                x={LEFT_W + 6} y={r.yStart} width={SVG_W - LEFT_W - 74} height={r.yEnd - r.yStart}
                rx={14} fill={r.fill} stroke={r.stroke} strokeWidth={1.1} strokeDasharray="6 4" />
              <text x={SVG_W - 82} y={r.yStart + 15} textAnchor="end"
                    fill={r.stroke} fontSize={9} fontWeight="700" letterSpacing="0.08em">
                {r.label}
              </text>
              {r.protocol && (
                <text x={SVG_W - 82} y={r.yStart + 28} textAnchor="end"
                      fill="#CBD5E1" fontSize={7.5} fontWeight="500" opacity={0.9}>
                  {r.protocol}
                </text>
              )}
            </g>
          ))}

          {/* ── Traffic axes (north-south rail, east-west rail) ── */}
          {(topo.traffic ?? []).map(t => t.axis === 'ns' ? (
            <g key={t.id} opacity={0.85}>
              <line x1={t.at} y1={t.from} x2={t.at} y2={t.to}
                    stroke={t.color} strokeWidth={1.4} strokeDasharray="7 5"
                    markerStart="url(#axisArrowUp)" markerEnd="url(#axisArrowDown)" />
              <text x={t.at - 6} y={(t.from + t.to) / 2} fill={t.color}
                    fontSize={8} fontWeight="700" letterSpacing="0.1em" textAnchor="middle"
                    transform={`rotate(-90 ${t.at - 6} ${(t.from + t.to) / 2})`}>
                {t.label}
              </text>
            </g>
          ) : (
            <g key={t.id} opacity={0.85}>
              <line x1={t.from} y1={t.at} x2={t.to} y2={t.at}
                    stroke={t.color} strokeWidth={1.4} strokeDasharray="7 5"
                    markerStart="url(#axisArrowLeft)" markerEnd="url(#axisArrowRight)" />
              <text x={(t.from + t.to) / 2} y={t.at + 14} fill={t.color}
                    fontSize={8} fontWeight="700" letterSpacing="0.1em" textAnchor="middle">
                {t.label}
              </text>
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

          {/* ── Tier row labels (right edge) ── */}
          {(topo.tiers ?? []).map(t => (
            <g key={t.id}>
              {/* Right-aligned to the edge so long tier names (DISTRIBUTION,
                  SD-WAN CONTROLLERS) are never clipped by the viewBox. */}
              <line x1={SVG_W - 90} y1={t.y + 3} x2={SVG_W - 8} y2={t.y + 3}
                    stroke={t.color} strokeWidth={1} opacity={0.5} />
              <text x={SVG_W - 8} y={t.y - 1} fill={t.color} textAnchor="end"
                    fontSize={8.5} fontWeight="700" letterSpacing="0.06em">
                {t.label}
              </text>
            </g>
          ))}

          {/* ── Group callouts (border leaf) ── */}
          {(topo.groups ?? []).map(g => {
            const members = topo.nodes.filter(n => g.nodeIds.includes(n.id))
            if (!members.length) return null
            const pad = 9
            const x1 = Math.min(...members.map(n => n.x)) - NW / 2 - pad
            const x2 = Math.max(...members.map(n => n.x)) + NW / 2 + pad
            const y1 = Math.min(...members.map(n => n.y)) - NH / 2 - pad
            const y2 = Math.max(...members.map(n => n.y)) + NH / 2 + pad
            return (
              <g key={g.id}>
                <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={8}
                      fill="none" stroke={g.color} strokeWidth={1.5} strokeDasharray="5 4" />
                <text x={x1} y={y1 - 5} fill={g.color} fontSize={8} fontWeight="700"
                      letterSpacing="0.08em">
                  {g.label}
                </text>
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
                  {/* Drawn, not typed: this SVG gets exported into design
                      documents where an emoji glyph may not resolve. */}
                  <g transform={`translate(${NW / 2 - 40},22)`} color={isInFlow ? '#BAE6FD' : '#9CA3AF'}>
                    <g transform="scale(0.62)"><IconGlobe size={24} /></g>
                  </g>
                  <text x={NW / 2 + 6} y={34} textAnchor="middle" fill={isInFlow ? '#BAE6FD' : '#9CA3AF'} fontSize={11}>{node.label}</text>
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
                {/* Device glyph — the diagram is the artefact people put in
                    design documents, and a row of identical boxes makes the
                    reader work out the tier from the text every time (AH4). */}
                <g transform="translate(9,15)" opacity={0.9}>
                  <NodeGlyph layer={node.layer} color={node.border} />
                </g>
                {/* Hostname */}
                <text x={NW / 2 + 11} y={24} textAnchor="middle"
                  fill={node.textColor} fontSize={8.5} fontWeight="700">
                  {node.label}
                </text>
                {/* Model */}
                <text x={NW / 2 + 11} y={38} textAnchor="middle"
                  fill={node.border} fontSize={7.5} opacity={0.95}>
                  {node.model}
                </text>
                {/* Loopback IP */}
                {node.loopback && node.loopback !== '—' && node.loopback !== '' && (
                  <text x={NW / 2} y={52} textAnchor="middle"
                    fill="#94A3B8" fontSize={6.5}>
                    {node.loopback.includes("/") ? node.loopback : `${node.loopback}/32`}
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
            NetDesign AI · HLD
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
            <CloseButton onClick={() => setSelectedNode(null)} label="Close device details" />
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
                  {selectedNodeObj.pairTech ?? 'HA'} pair #{selectedNodeObj.mlagPairId}
                  {selectedNodeObj.mlagPeerLabel && <> — peer: {selectedNodeObj.mlagPeerLabel}</>}
                </div>
              </div>
            )}
            {/* D1: FHRP (HSRP) virtual gateway */}
            {selectedNodeObj.fhrpVip && (
              <div>
                <div className="text-gray-600 uppercase tracking-wider text-xs">FHRP Gateway</div>
                <div className="text-cyan-400 mt-0.5">{selectedNodeObj.fhrpLabel ?? 'FHRP VIP'}: {selectedNodeObj.fhrpVip}</div>
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
