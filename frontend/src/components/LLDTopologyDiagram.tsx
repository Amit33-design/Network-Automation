import { useState, useMemo } from 'react'
import type { BOMDevice, UseCase } from '@/types'
import { fabricInterfaceView, borderLeaves, TENANT_OVERLAY, CAMPUS_VLANS, ORAN_FRONTHAUL_VLAN, ORAN_PTP_DOMAIN } from '@/lib/configgen'
import { LAYER_ADJACENCY } from '@/lib/bom'
import { tierIcon } from '@/components/icons'
import { CloseButton } from '@/components/ui/CloseButton'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LLDInterface {
  name: string
  ip: string
  vlan?: string
  mac?: string
  speed?: string
}

function LldGlyph({ tier }: { tier: string }) {
  const Glyph = tierIcon(tier)
  return <Glyph size={24} />
}

interface LLDNode {
  id: string
  hostname: string
  model: string
  tier: string
  vendor: string
  interfaces: LLDInterface[]
  configLines: string[]
  services: string[]
  specs: string
  haRole?: 'active' | 'standby'
  x: number
  y: number
  w: number
  h: number
  color: string
  border: string
  textColor: string
}

interface LLDLink {
  id: string
  from: string
  to: string
  fromPort: string
  toPort: string
  speed: string
  vlan?: string
  subnet?: string
  protocol: string
  isDashed?: boolean
}

interface LLDZone {
  id: string
  label: string
  sublabel: string
  yStart: number
  yEnd: number
  fill: string
  stroke: string
}

interface CablingEntry {
  server: string
  serverPort: string
  ipv4: string
  switchPort: string
  mgmtPort: string
  vlan: string
}

interface LLDTopo {
  nodes: LLDNode[]
  links: LLDLink[]
  zones: LLDZone[]
  cabling: CablingEntry[]
  title: string
  subtitle: string
  svgH: number
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const SVG_W = 1400
const LEFT_W = 160
const RIGHT_PAD = 16
const CONTENT_W = SVG_W - LEFT_W - RIGHT_PAD

// ─── Style palette ────────────────────────────────────────────────────────────

const TIER_STYLE: Record<string, { color: string; border: string; textColor: string }> = {
  internet:     { color: '#1A2535', border: '#94A3B8', textColor: '#E2E8F0' },
  dmz:          { color: '#3D1010', border: '#F87171', textColor: '#FCA5A5' },
  internal:     { color: '#0E2B5C', border: '#60A5FA', textColor: '#BAE6FD' },
  loadbalancer: { color: '#2A1A05', border: '#F59E0B', textColor: '#FCD34D' },
  server:       { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  application:  { color: '#2D1B4E', border: '#A78BFA', textColor: '#DDD6FE' },
  database:     { color: '#2D1B4E', border: '#C084FC', textColor: '#E9D5FF' },
  wan:          { color: '#2A1A05', border: '#F59E0B', textColor: '#FCD34D' },
  core:         { color: '#1E0D50', border: '#A78BFA', textColor: '#DDD6FE' },
  distribution: { color: '#082840', border: '#38BDF8', textColor: '#BAE6FD' },
  access:       { color: '#062A12', border: '#22C55E', textColor: '#86EFAC' },
  endpoint:     { color: '#252219', border: '#A8A29E', textColor: '#E7E5E4' },
  spine:        { color: '#0E2B5C', border: '#60A5FA', textColor: '#BAE6FD' },
  leaf:         { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  gpu:          { color: '#083B25', border: '#34D399', textColor: '#A7F3D0' },
  storage:      { color: '#0F0C35', border: '#818CF8', textColor: '#C7D2FE' },
  oob:          { color: '#252219', border: '#78716C', textColor: '#D6D3D1' },
  cloud:        { color: '#062D2A', border: '#2DD4BF', textColor: '#99F6E4' },
  transit:      { color: '#1E3A5F', border: '#38BDF8', textColor: '#BAE6FD' },
  spoke:        { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  branch:       { color: '#082840', border: '#38BDF8', textColor: '#BAE6FD' },
  // O-RAN / Private 5G tiers (G-A10)
  'oran-core':  { color: '#1E0D50', border: '#A78BFA', textColor: '#DDD6FE' },
  'oran-cu':    { color: '#0E2B5C', border: '#60A5FA', textColor: '#BAE6FD' },
  'oran-du':    { color: '#082840', border: '#38BDF8', textColor: '#BAE6FD' },
  'oran-fronthaul': { color: '#0B3D1E', border: '#4ADE80', textColor: '#BBF7D0' },
  'oran-midhaul':   { color: '#2A1A05', border: '#F59E0B', textColor: '#FCD34D' },
  'oran-ru':    { color: '#3D1E08', border: '#FB923C', textColor: '#FDBA74' },
  'oran-timing': { color: '#3D1010', border: '#F87171', textColor: '#FCA5A5' },
}

function sty(tier: string) {
  return TIER_STYLE[tier] ?? TIER_STYLE.endpoint
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xCenter(count: number, gap: number, nodeW: number): number[] {
  const totalW = count * nodeW + (count - 1) * gap
  const start = LEFT_W + (CONTENT_W - totalW) / 2
  return Array.from({ length: count }, (_, i) => start + i * (nodeW + gap))
}

function mkNode(
  id: string, hostname: string, model: string, tier: string, vendor: string,
  x: number, y: number, w: number, h: number,
  opts: {
    interfaces?: LLDInterface[]
    configLines?: string[]
    services?: string[]
    specs?: string
    haRole?: 'active' | 'standby'
  } = {},
): LLDNode {
  const s = sty(tier)
  return {
    id, hostname, model, tier, vendor, x, y, w, h, ...s,
    interfaces: opts.interfaces ?? [],
    configLines: opts.configLines ?? [],
    services: opts.services ?? [],
    specs: opts.specs ?? '',
    haRole: opts.haRole,
  }
}

function mkLink(
  from: string, to: string, fromPort: string, toPort: string,
  speed: string, protocol: string,
  opts: { vlan?: string; subnet?: string; isDashed?: boolean } = {},
): LLDLink {
  return {
    id: `${from}--${to}--${fromPort}`,
    from, to, fromPort, toPort, speed, protocol,
    vlan: opts.vlan, subnet: opts.subnet, isDashed: opts.isDashed,
  }
}

// ─── DC LLD ───────────────────────────────────────────────────────────────────

function buildDCLLD(devices: BOMDevice[], sc: string, useCase = 'dc'): LLDTopo {
  // AO1: this used to draw a fixed three-tier enterprise topology — internet,
  // firewalls, routers, an F5 pair and web/app servers — and ignored the BOM
  // entirely, so a spine-leaf design's LLD showed no spine or leaf at all, and
  // none of its 23 interface addresses appeared in any generated config. Every
  // node and address below now comes from the design and the config allocators.
  const IF_CAP = 6
  const Y = { fw: 60, spine: 240, leaf: 440, srv: 650 }
  const spineDevs = devices.filter(d => d.subLayer === 'spine')
  const leafDevs = devices.filter(d => d.subLayer === 'leaf')
  const fwDevs = devices.filter(d => d.subLayer === 'firewall')
  const border = borderLeaves(devices)
  // Shown: every spine up to 4; the first leaf pair plus the border pair.
  const shownSpines = spineDevs.slice(0, 4)
  const shownLeaves = [...new Map([...leafDevs.slice(0, 2), ...border].map(d => [d.id, d])).values()].slice(0, 4)
  const shownFws = fwDevs.slice(0, 2)
  const view = (d: BOMDevice) => fabricInterfaceView(d, devices, useCase as UseCase)
  const ifaces = (d: BOMDevice, shown: Set<string>): LLDInterface[] => {
    const all = view(d)
    // Prefer interfaces toward devices that are on the diagram.
    const ordered = [...all.filter(i => i.kind === 'loopback'), ...all.filter(i => i.peer && shown.has(i.peer)), ...all.filter(i => i.kind !== 'loopback' && !(i.peer && shown.has(i.peer)))]
    const rows: LLDInterface[] = ordered.slice(0, IF_CAP).map(i => ({ name: i.name, ip: i.ip, vlan: i.peer ? `→ ${i.peer}` : undefined }))
    if (ordered.length > IF_CAP) rows.push({ name: `+${ordered.length - IF_CAP} more`, ip: '—' })
    return rows
  }
  const shownHosts = new Set([...shownSpines, ...shownLeaves, ...shownFws].map(d => d.hostname))
  const t = TENANT_OVERLAY
  // A Cumulus GPU fabric is pure eBGP L3 to the host (Y6) — no VXLAN, no VNI,
  // no EVPN — so the overlay captions would be false there (AN11).
  const pureL3 = useCase === 'gpu' && leafDevs.some(d => d.vendor === 'NVIDIA')

  const zones: LLDZone[] = [
    { id: 'z-fw', label: 'PERIMETER', sublabel: 'Firewalls · routed /31 handoff to the border leaves',
      yStart: 0, yEnd: 180, fill: 'rgba(127,29,29,0.22)', stroke: '#B91C1C' },
    { id: 'z-spine', label: 'SPINE', sublabel: pureL3 ? 'eBGP unnumbered · ECMP (pure L3, RFC 7938)' : 'eBGP underlay /31s · EVPN route exchange (not a VTEP)',
      yStart: 180, yEnd: 380, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-leaf', label: pureL3 ? 'LEAF / ToR' : 'LEAF / VTEP', sublabel: pureL3 ? 'eBGP unnumbered uplinks · routed host ports' : `VXLAN · VLAN ${t.vlan} ↔ VNI ${t.l2vni} · ${t.vrf} L3VNI ${t.l3vni}`,
      yStart: 380, yEnd: 590, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-srv', label: `SERVERS · VLAN ${t.vlan} ${t.vlanName}`, sublabel: 'Access ports on every leaf · anycast gateway',
      yStart: 590, yEnd: 740, fill: 'rgba(88,28,135,0.20)', stroke: '#7E22CE' },
  ]

  const NW = 200
  const fwXs = xCenter(Math.max(1, shownFws.length), 160, NW)
  const fwNodes = shownFws.map((d, i) => mkNode(`fw${i}`, d.hostname, d.model, 'firewall', d.vendor, fwXs[i], Y.fw, NW, 110, {
    interfaces: ifaces(d, shownHosts), services: ['NGFW', 'Routed handoff'],
  }))
  const spXs = xCenter(Math.max(1, shownSpines.length), 40, NW)
  const spNodes = shownSpines.map((d, i) => mkNode(`sp${i}`, d.hostname, d.model, 'spine', d.vendor, spXs[i], Y.spine, NW, 130, {
    interfaces: ifaces(d, shownHosts), services: pureL3 ? ['eBGP', 'BFD'] : ['eBGP', 'EVPN', 'BFD'],
  }))
  const LW = 220
  const lfXs = xCenter(Math.max(1, shownLeaves.length), 30, LW)
  const lfNodes = shownLeaves.map((d, i) => mkNode(`lf${i}`, d.hostname, d.model, 'leaf', d.vendor, lfXs[i], Y.leaf, LW, 140, {
    interfaces: ifaces(d, shownHosts),
    configLines: [...(pureL3 ? ['eBGP unnumbered · ECMP'] : [`VLAN ${t.vlan} → VNI ${t.l2vni}`, `${t.vrf} · L3VNI ${t.l3vni}`]),
      ...(border.some(b => b.id === d.id) ? ['Border leaf — firewall handoff'] : [])],
    services: pureL3 ? ['eBGP', 'ECMP'] : ['VXLAN', 'BGP EVPN', 'Anycast GW'],
  }))
  const nodeOf = new Map<string, LLDNode>()
  ;[...shownFws, ...shownSpines, ...shownLeaves].forEach((d, i) => nodeOf.set(d.hostname, [...fwNodes, ...spNodes, ...lfNodes][i]))

  // Links: one per fabric /31 between devices that are both on the diagram.
  const links: LLDLink[] = []
  for (const lf of shownLeaves) {
    for (const up of view(lf).filter(i => i.kind === 'fabric' && i.peer && shownHosts.has(i.peer))) {
      const sp = devices.find(d => d.hostname === up.peer)!
      const spSide = view(sp).find(i => i.kind === 'fabric' && i.peer === lf.hostname)
      links.push(mkLink(nodeOf.get(sp.hostname)!.id, nodeOf.get(lf.hostname)!.id, spSide?.name ?? '—', up.name, lf.uplinkSpeed ?? lf.speed ?? '', 'eBGP underlay', { subnet: up.ip }))
    }
    for (const h of view(lf).filter(i => i.kind === 'handoff' && i.peer && shownHosts.has(i.peer))) {
      const fw = devices.find(d => d.hostname === h.peer)!
      const fwSide = view(fw).find(i => i.peer === lf.hostname)
      links.push(mkLink(nodeOf.get(fw.hostname)!.id, nodeOf.get(lf.hostname)!.id, fwSide?.name ?? '—', h.name, '', 'Routed handoff', { subnet: h.ip }))
    }
  }

  const more = (shown: number, all: number, what: string) => all > shown ? ` (showing ${shown} of ${all} ${what})` : ''
  return {
    nodes: [...fwNodes, ...spNodes, ...lfNodes], links,
    // No perimeter band on a design that has no firewall.
    zones: zones.filter(z => z.id !== 'z-fw' || shownFws.length > 0), cabling: [],
    title: `DATA CENTER FABRIC LLD${sc ? ` · ${sc}` : ''}`,
    subtitle: `${spineDevs.length} spine · ${leafDevs.length} leaf · ${fwDevs.length} firewall` +
      more(shownSpines.length, spineDevs.length, 'spines') + more(shownLeaves.length, leafDevs.length, 'leaves') +
      ' · addresses from the generated configs',
    svgH: 760,
  }
}

// ─── Campus LLD ───────────────────────────────────────────────────────────────

function buildCampusLLD(devices: BOMDevice[], sc: string): LLDTopo {
  // AO3: the campus LLD drew a core pair and two WAN routers the campus BOM does
  // not contain, and none of its 23 addresses was in any config. It now draws
  // the BOM's firewalls, distribution and access switches with addresses from
  // the campus allocators (AN7 VLAN plan, AN8 firewall handoff).
  const IF_CAP = 6
  const Y = { fw: 60, dist: 240, access: 440 }
  const fwDevs = devices.filter(d => d.subLayer === 'firewall')
  const distDevs = devices.filter(d => d.subLayer === 'distribution')
  const accDevs = devices.filter(d => d.subLayer === 'access')
  const shownFws = fwDevs.slice(0, 2)
  const shownDist = distDevs.slice(0, 4)
  const shownAcc = accDevs.slice(0, 4)
  const shownHosts = new Set([...shownFws, ...shownDist, ...shownAcc].map(d => d.hostname))
  const { data, voice, mgmt } = CAMPUS_VLANS
  const ifaces = (d: BOMDevice): LLDInterface[] => {
    const all = fabricInterfaceView(d, devices, 'campus')
    const rows: LLDInterface[] = all.slice(0, IF_CAP).map(i => ({ name: i.name, ip: i.ip, vlan: i.peer ? `→ ${i.peer}` : undefined }))
    if (all.length > IF_CAP) rows.push({ name: `+${all.length - IF_CAP} more`, ip: '—' })
    return rows
  }

  const zones: LLDZone[] = ([
    { id: 'z-fw', label: 'PERIMETER', sublabel: 'Firewalls · routed /31 handoff to the distribution pair',
      yStart: 0, yEnd: 180, fill: 'rgba(127,29,29,0.22)', stroke: '#B91C1C' },
    { id: 'z-dist', label: 'DISTRIBUTION', sublabel: `OSPF area 0 · FHRP VIP ${mgmt.vip} on VLAN ${mgmt.id} · L3 gateway for VLAN ${data.id}`,
      yStart: 180, yEnd: 380, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-access', label: 'ACCESS', sublabel: '802.1X · PoE · split uplinks to the distribution pair',
      yStart: 380, yEnd: 590, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-ep', label: 'ENDPOINTS', sublabel: `VLAN ${data.id} ${data.name} · VLAN ${voice.id} ${voice.name} (with voice) · native VLAN ${mgmt.id}`,
      yStart: 590, yEnd: 740, fill: 'rgba(28,25,23,0.20)', stroke: '#57534E' },
  ] as LLDZone[]).filter(z => z.id !== 'z-fw' || shownFws.length > 0)

  const NW = 210
  const fwXs = xCenter(Math.max(1, shownFws.length), 160, NW)
  const fwNodes = shownFws.map((d, i) => mkNode(`fw${i}`, d.hostname, d.model, 'firewall', d.vendor, fwXs[i], Y.fw, NW, 110, {
    interfaces: ifaces(d), services: ['NGFW', 'Routed handoff'],
  }))
  const dXs = xCenter(Math.max(1, shownDist.length), 30, NW)
  const distNodes = shownDist.map((d, i) => mkNode(`dist${i}`, d.hostname, d.model, 'distribution', d.vendor, dXs[i], Y.dist, NW, 130, {
    interfaces: ifaces(d), configLines: [`VLAN ${data.id} SVI + FHRP`, `VLAN ${mgmt.id} mgmt · VIP ${mgmt.vip}`, 'OSPF area 0'],
    services: ['OSPF', 'FHRP', 'STP root'],
  }))
  const aXs = xCenter(Math.max(1, shownAcc.length), 30, NW)
  const accNodes = shownAcc.map((d, i) => mkNode(`acc${i}`, d.hostname, d.model, 'access', d.vendor, aXs[i], Y.access, NW, 110, {
    interfaces: ifaces(d), configLines: [`VLAN ${data.id} access · 802.1X`, `Default → ${mgmt.vip}`], services: ['802.1X', 'PoE'],
  }))
  const nodeOf = new Map<string, LLDNode>()
  ;[...shownFws, ...shownDist, ...shownAcc].forEach((d, i) => nodeOf.set(d.hostname, [...fwNodes, ...distNodes, ...accNodes][i]))

  const links: LLDLink[] = []
  // Firewall handoffs, read from the distribution side's own plan.
  for (const d of shownDist) for (const h of fabricInterfaceView(d, devices, 'campus').filter(i => i.kind === 'handoff' && i.peer && shownHosts.has(i.peer))) {
    links.push(mkLink(nodeOf.get(h.peer!)!.id, nodeOf.get(d.hostname)!.id, 'inside', h.name, '', 'Routed handoff', { subnet: h.ip }))
  }
  // Access uplinks: UPLINK-1 / UPLINK-2 to the first distribution pair, as the
  // access configs describe them.
  const pair = shownDist.slice(0, 2)
  for (const a of shownAcc) pair.forEach((d, k) => links.push(mkLink(nodeOf.get(d.hostname)!.id, nodeOf.get(a.hostname)!.id, 'downlink trunk', `UPLINK-${k + 1}`, '', `Trunk · native ${mgmt.id}`)))

  const more = (shown: number, all: number, what: string) => all > shown ? ` (showing ${shown} of ${all} ${what})` : ''
  return {
    nodes: [...fwNodes, ...distNodes, ...accNodes], links, zones, cabling: [],
    title: `CAMPUS LLD${sc ? ` · ${sc}` : ''}`,
    subtitle: `${distDevs.length} distribution · ${accDevs.length} access · ${fwDevs.length} firewall` +
      more(shownDist.length, distDevs.length, 'distribution') + more(shownAcc.length, accDevs.length, 'access') +
      ' · addresses from the generated configs',
    svgH: 760,
  }
}

// ─── GPU AI Fabric LLD ────────────────────────────────────────────────────────

function buildGPULLD(devices: BOMDevice[], sc: string): LLDTopo {
  // AO2: the GPU LLD invented an OOB switch, four DGX A100 servers and a NetApp
  // storage pair — none in the BOM — and 13 of its 19 addresses were in no
  // config. It now reuses the design-driven fabric view (AO1) and adds the
  // BOM's own GPU servers as the host tier.
  const base = buildDCLLD(devices, sc, 'gpu')
  const leafNodes = base.nodes.filter(n => n.tier === 'leaf')
  const servers = devices.filter(d => d.subLayer === 'gpu-compute')
  const shown = servers.slice(0, Math.max(1, Math.min(4, leafNodes.length || 1)))
  const routedHost = devices.some(d => d.subLayer === 'leaf' && d.vendor === 'NVIDIA')
  const W = 200
  const xs = xCenter(Math.max(1, shown.length), 30, W)
  const gpuNodes = shown.map((d, i) => mkNode(`gpu${i}`, d.hostname, d.model, 'gpu', d.vendor, xs[i], 650, W, 100, {
    interfaces: [{
      name: 'RDMA NIC',
      ip: routedHost ? '<CHANGE-ME-host-p2p>/31' : `VLAN ${TENANT_OVERLAY.vlan} (<CHANGE-ME-tenant-ip>)`,
      vlan: leafNodes.length ? `→ ${leafNodes[i % leafNodes.length].hostname}` : undefined,
    }],
    configLines: ['RoCEv2 · DSCP 26 / PFC priority 3', 'mlnx_qos --trust dscp'],
    services: ['RDMA', 'RoCEv2'],
  }))
  const hostLinks = gpuNodes.map((g, i) => leafNodes.length
    ? mkLink(leafNodes[i % leafNodes.length].id, g.id, 'host port', 'RDMA NIC', '', 'RoCEv2 lossless')
    : null).filter((l): l is LLDLink => l !== null)
  const zones = base.zones.map(z => z.id === 'z-srv'
    ? { ...z, label: 'GPU COMPUTE', sublabel: routedHost ? 'Routed /31 to the host · PFC priority 3 lossless' : `VLAN ${TENANT_OVERLAY.vlan} access · PFC priority 3 lossless` }
    : z.id === 'z-leaf' ? { ...z, sublabel: `${z.sublabel} · RoCEv2 PFC/ECN` } : z)
  return {
    ...base,
    nodes: [...base.nodes, ...gpuNodes],
    links: [...base.links, ...hostLinks],
    zones,
    title: `GPU AI FABRIC LLD${sc ? ` · ${sc}` : ''}`,
    subtitle: `${base.subtitle.replace(' · addresses from the generated configs', '')} · ${servers.length} GPU servers` +
      (servers.length > shown.length ? ` (showing ${shown.length})` : '') + ' · addresses from the generated configs',
  }
}

// ─── Tiered LLD (WAN · multisite · multicloud · Aviatrix · O-RAN) ─────────────

interface RowSpec {
  subLayer: string
  tier: string
  label: string
  sublabel: string
  cap: number
  fill: string
  stroke: string
}

const ROW_FILLS: Record<string, [string, string]> = {
  red:    ['rgba(127,29,29,0.22)', '#B91C1C'],
  blue:   ['rgba(29,78,216,0.20)', '#1D4ED8'],
  green:  ['rgba(21,128,61,0.20)', '#15803D'],
  amber:  ['rgba(146,64,14,0.22)', '#B45309'],
  purple: ['rgba(88,28,135,0.20)', '#7E22CE'],
  teal:   ['rgba(17,94,89,0.22)',  '#0F766E'],
}
const row = (subLayer: string, tier: string, label: string, sublabel: string, colour: keyof typeof ROW_FILLS, cap = 4): RowSpec =>
  ({ subLayer, tier, label, sublabel, cap, fill: ROW_FILLS[colour][0], stroke: ROW_FILLS[colour][1] })

/**
 * AO4: the WAN, multisite, multicloud, Aviatrix and O-RAN LLDs drew fixed
 * topologies — SP backbones, branch CPEs, `DC-SPINE-01`, AWS/Azure/GCP VPCs,
 * an `O-CU-01` — none of them BOM devices, and 106 of 108 addresses were in no
 * config. Every node below is a BOM device, every address comes from the
 * allocator its config uses (`fabricInterfaceView`), and a link is drawn only
 * where the design really connects two devices: a peer named by the config
 * (fabric /31, firewall handoff, F1 home CU, served DU) or a tier pair the BOM
 * cables (`LAYER_ADJACENCY`) — never an invented one.
 */
function buildTieredLLD(
  devices: BOMDevice[], sc: string, useCase: string, rows: RowSpec[],
  head: { title: string; overlay?: Array<{ from: string; to: string; protocol: string }> },
): LLDTopo {
  const ROW_H = 200
  const present = rows.filter(r => devices.some(d => d.subLayer === r.subLayer))
  const border = new Set(borderLeaves(devices).map(d => d.id))
  const pick = (r: RowSpec): BOMDevice[] => {
    const all = devices.filter(d => d.subLayer === r.subLayer)
    // Leaves: the first pair plus the border pair, as the DC LLD does.
    if (r.subLayer === 'leaf') return [...new Map([...all.slice(0, 2), ...all.filter(d => border.has(d.id))].map(d => [d.id, d])).values()].slice(0, r.cap)
    return all.slice(0, r.cap)
  }
  const shownRows = present.map(r => ({ r, devs: pick(r), total: devices.filter(d => d.subLayer === r.subLayer).length }))
  const shownHosts = new Set(shownRows.flatMap(x => x.devs.map(d => d.hostname)))
  const view = new Map(shownRows.flatMap(x => x.devs).map(d => [d.hostname, fabricInterfaceView(d, devices, useCase as UseCase)]))

  const nodes: LLDNode[] = []
  const nodeOf = new Map<string, LLDNode>()
  const zones: LLDZone[] = []
  shownRows.forEach(({ r, devs }, ri) => {
    const y0 = ri * ROW_H
    zones.push({ id: `z-${r.subLayer}`, label: r.label, sublabel: r.sublabel, yStart: y0, yEnd: y0 + ROW_H, fill: r.fill, stroke: r.stroke })
    const W = devs.length > 4 ? 170 : 210
    const xs = xCenter(devs.length, devs.length > 4 ? 20 : 40, W)
    devs.forEach((d, i) => {
      const ifs = view.get(d.hostname) ?? []
      const rowsIf: LLDInterface[] = ifs.slice(0, 5).map(x => ({ name: x.name, ip: x.ip, vlan: x.peer ? `→ ${x.peer}` : undefined }))
      if (ifs.length > 5) rowsIf.push({ name: `+${ifs.length - 5} more`, ip: '—' })
      const cloud = r.subLayer.startsWith('cloud-')
      const n = mkNode(`${r.subLayer}-${i}`, d.hostname, d.model, r.tier, d.vendor, xs[i], y0 + 50, W, 120, {
        interfaces: rowsIf,
        configLines: cloud ? ['Provisioned by Terraform — no device CLI'] : border.has(d.id) ? ['Border leaf — firewall handoff'] : [],
      })
      nodes.push(n); nodeOf.set(d.hostname, n)
    })
  })

  const links: LLDLink[] = []
  const seen = new Set<string>()
  const add = (a: string, b: string, ap: string, bp: string, protocol: string, opts: { subnet?: string; isDashed?: boolean } = {}) => {
    const key = [a, b].sort().join('|') + '|' + protocol + '|' + ap + bp
    if (seen.has(key) || !nodeOf.has(a) || !nodeOf.has(b) || a === b) return
    seen.add(key)
    links.push(mkLink(nodeOf.get(a)!.id, nodeOf.get(b)!.id, ap, bp, '', protocol, opts))
  }
  // 1. Peers the configs name.
  const peered = new Set<string>()
  for (const [host, ifs] of view) for (const x of ifs) {
    if (!x.peer || !shownHosts.has(x.peer)) continue
    const back = view.get(x.peer)?.find(y => y.peer === host)
    const proto = x.kind === 'handoff' ? 'Routed handoff' : /F1/.test(x.name) ? 'F1 (SCTP / GTP-U)' : /eCPRI/.test(x.name) ? 'eCPRI 7.2x' : 'eBGP underlay'
    add(x.peer, host, back?.name ?? '—', x.name, proto, { subnet: x.ip })
    peered.add([host, x.peer].sort().join('|'))
  }
  // 2. Tier pairs the BOM cables, where no config peer already drew them.
  for (const c of LAYER_ADJACENCY) {
    const froms = shownRows.find(x => x.r.subLayer === c.from)?.devs ?? []
    const tos = shownRows.find(x => x.r.subLayer === c.to)?.devs ?? []
    if (!froms.length || !tos.length) continue
    if (c.from === c.to) {
      // Same-tier runs pair consecutive members (an HA / site pair).
      for (let i = 0; i + 1 < froms.length; i += 2) add(froms[i].hostname, froms[i + 1].hostname, '—', '—', 'HA pair', { isDashed: true })
      continue
    }
    if (froms.some(f => tos.some(t => peered.has([f.hostname, t.hostname].sort().join('|'))))) continue
    tos.forEach((t, i) => add(froms[i % froms.length].hostname, t.hostname, '—', '—', 'cabled (BOM)', { isDashed: true }))
  }
  // 3. Overlay sessions with no physical cable (IPsec to cloud transit).
  for (const o of head.overlay ?? []) {
    const froms = shownRows.find(x => x.r.subLayer === o.from)?.devs ?? []
    const tos = shownRows.find(x => x.r.subLayer === o.to)?.devs ?? []
    tos.forEach((t, i) => froms.length && add(froms[i % froms.length].hostname, t.hostname, '—', '—', o.protocol, { isDashed: true }))
  }

  const counts = shownRows.map(x => `${x.total} ${x.r.label.toLowerCase()}${x.total > x.devs.length ? ` (showing ${x.devs.length})` : ''}`)
  return {
    nodes, links, zones, cabling: [],
    title: `${head.title}${sc ? ` · ${sc}` : ''}`,
    subtitle: `${counts.join(' · ')} · addresses from the generated configs`,
    svgH: Math.max(1, shownRows.length) * ROW_H + 40,
  }
}

function buildWANLLD(devices: BOMDevice[], sc: string): LLDTopo {
  return buildTieredLLD(devices, sc, 'wan', [
    row('sdwan-controller', 'core', 'SD-WAN CONTROLLERS', 'vManage · vSmart · vBond', 'purple'),
    row('wan-edge', 'wan', 'WAN EDGE', 'Dual-router sites · system-ip · VPN 1 LAN / VPN 2 guest', 'amber', 6),
  ], { title: 'WAN LLD' })
}

function buildMultisiteLLD(devices: BOMDevice[], sc: string): LLDTopo {
  return buildTieredLLD(devices, sc, 'multisite', [
    row('sdwan-controller', 'core', 'SD-WAN CONTROLLERS', 'vManage · vSmart · vBond', 'purple'),
    row('wan-edge', 'wan', 'DCI / WAN EDGE', 'Inter-site transport · stretched EVPN RTs 65100:<vni>', 'amber'),
    row('firewall', 'dmz', 'PERIMETER', 'Firewalls · routed /31 handoff to the border leaves', 'red', 2),
    row('spine', 'spine', 'SPINE', 'eBGP underlay /31s · EVPN route exchange (not a VTEP)', 'blue'),
    row('leaf', 'leaf', 'LEAF / VTEP', `VXLAN · VLAN ${TENANT_OVERLAY.vlan} ↔ VNI ${TENANT_OVERLAY.l2vni} · ${TENANT_OVERLAY.vrf} L3VNI ${TENANT_OVERLAY.l3vni}`, 'green'),
  ], { title: 'MULTISITE DCI LLD' })
}

const cloudRows = (edgeLabel: string): RowSpec[] => [
  row('cloud-transit', 'transit', 'CLOUD TRANSIT', 'Transit gateways · provider-managed routing (Terraform)', 'teal'),
  row('cloud-gw', 'cloud', 'CLOUD GATEWAYS', 'Spoke / VPC gateways (Terraform)', 'blue'),
  row('sdwan-controller', 'core', 'SD-WAN CONTROLLERS', 'vManage · vSmart · vBond', 'purple'),
  row('wan-edge', 'wan', edgeLabel, 'On-prem on-ramp pair per site · IPsec to the cloud transit', 'amber'),
]
const CLOUD_OVERLAY = [
  { from: 'cloud-transit', to: 'cloud-gw', protocol: 'Transit peering' },
  { from: 'cloud-transit', to: 'wan-edge', protocol: 'IPsec / BGP' },
]

function buildMulticloudLLD(devices: BOMDevice[], sc: string): LLDTopo {
  return buildTieredLLD(devices, sc, 'multicloud', cloudRows('ON-PREM EDGE'), { title: 'MULTI-CLOUD LLD', overlay: CLOUD_OVERLAY })
}

function buildAviatrixLLD(devices: BOMDevice[], sc: string): LLDTopo {
  return buildTieredLLD(devices, sc, 'aviatrix', cloudRows('ON-PREM EDGE'), { title: 'AVIATRIX MULTI-CLOUD LLD', overlay: CLOUD_OVERLAY })
}

function buildORANLLD(devices: BOMDevice[], sc: string): LLDTopo {
  return buildTieredLLD(devices, sc, 'oran', [
    row('oran-core', 'oran-core', '5G CORE', 'UPF · N3 / N6 / N9', 'purple', 2),
    row('oran-midhaul', 'oran-midhaul', 'MIDHAUL', 'IS-IS + SR · PTP boundary clock', 'amber', 2),
    row('oran-cu', 'oran-cu', 'O-CU', 'F1-C / F1-U toward the DUs', 'blue', 2),
    row('oran-timing', 'oran-timing', 'TIMING', `PTP grandmaster · G.8275.1 domain ${ORAN_PTP_DOMAIN}`, 'red', 2),
    row('oran-fronthaul', 'oran-fronthaul', 'FRONTHAUL SW', `eCPRI VLAN ${ORAN_FRONTHAUL_VLAN} · PTP transparent clock`, 'green', 2),
    row('oran-du', 'oran-du', 'O-DU', 'Split 7.2x · homed round-robin to a CU', 'teal', 2),
    row('oran-ru', 'oran-ru', 'O-RU', 'Three radios per DU · eCPRI + M-plane', 'red', 6),
  ], { title: 'O-RAN / PRIVATE 5G LLD' })
}

// ─── Topology dispatcher ─────────────────────────────────────────────────────

export function buildLLDTopology(devices: BOMDevice[], useCase: string, sc: string): LLDTopo {
  switch (useCase) {
    case 'campus':     return buildCampusLLD(devices, sc)
    case 'gpu':        return buildGPULLD(devices, sc)
    case 'wan':        return buildWANLLD(devices, sc)
    case 'multisite':  return buildMultisiteLLD(devices, sc)
    case 'multicloud': return buildMulticloudLLD(devices, sc)
    case 'aviatrix':   return buildAviatrixLLD(devices, sc)
    case 'oran':       return buildORANLLD(devices, sc)
    default:           return buildDCLLD(devices, sc, useCase)
  }
}

// ─── SVG link path ────────────────────────────────────────────────────────────

function lldLinkPath(n1: LLDNode, n2: LLDNode, isDashed?: boolean): string {
  const x1 = n1.x + n1.w / 2
  const y1 = n1.y + n1.h
  const x2 = n2.x + n2.w / 2
  const y2 = n2.y

  if (isDashed && Math.abs(y1 - n2.y - n2.h/2) < n1.h) {
    const sy = Math.min(n1.y, n2.y) + Math.min(n1.h, n2.h) / 2
    return `M${n1.x + n1.w},${sy} L${n2.x},${sy}`
  }
  const my = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  devices: BOMDevice[]
  useCase?: string
  siteCode?: string
}

export function LLDTopologyDiagram({ devices, useCase = 'dc', siteCode = '' }: Props) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredLink, setHoveredLink] = useState<string | null>(null)

  const topo = useMemo(
    () => buildLLDTopology(devices.length ? devices : [], useCase, siteCode),
    [devices, useCase, siteCode],
  )

  const nodeMap: Record<string, LLDNode> = useMemo(
    () => Object.fromEntries(topo.nodes.map(n => [n.id, n])),
    [topo.nodes],
  )

  const selectedNodeObj = selectedNode ? nodeMap[selectedNode] : null

  return (
    <div className="space-y-3">
      {/* ── SVG canvas ── */}
      <div className="overflow-x-auto rounded-xl bg-[#080E1A] relative">
        <svg
          viewBox={`0 0 ${SVG_W} ${topo.svgH}`}
          style={{ width: '100%', height: 'auto', display: 'block', fontFamily: 'monospace' }}
          role="img"
          aria-label={`Low-level network topology diagram for ${useCase} design with ${topo.nodes.length} devices showing IP addresses and interface mappings`}
          onClick={(e) => { if (e.currentTarget === e.target) setSelectedNode(null) }}
        >
          <title>LLD Network Topology — {useCase.toUpperCase()}</title>
          {/* Background */}
          <rect width={SVG_W} height={topo.svgH} fill="#080E1A" />

          {/* Security zones */}
          {topo.zones.map(z => (
            <g key={z.id}>
              <rect x={0} y={z.yStart} width={SVG_W} height={z.yEnd - z.yStart}
                fill={z.fill} stroke={z.stroke} strokeWidth={0.8} opacity={1} />
              {/* Left accent rail for clear zone separation */}
              <rect x={0} y={z.yStart} width={3} height={z.yEnd - z.yStart} fill={z.stroke} opacity={0.85} />
              <text x={10} y={z.yStart + 18} fill={z.stroke} fontSize={8.5} fontWeight="700" opacity={1}>
                {z.label}
              </text>
              <text x={10} y={z.yStart + 32} fill="#CBD5E1" fontSize={7} fontWeight="500" opacity={0.9}>
                {z.sublabel}
              </text>
              <line x1={LEFT_W - 4} y1={z.yStart} x2={LEFT_W - 4} y2={z.yEnd}
                stroke={z.stroke} strokeWidth={0.5} opacity={0.5} />
            </g>
          ))}

          {/* Title */}
          <text x={LEFT_W + 8} y={22} fill="#E2E8F0" fontSize={12} fontWeight="700">{topo.title}</text>
          <text x={LEFT_W + 8} y={38} fill="#94A3B8" fontSize={8.5}>{topo.subtitle}</text>

          {/* Links */}
          {topo.links.map(link => {
            const n1 = nodeMap[link.from]
            const n2 = nodeMap[link.to]
            if (!n1 || !n2) return null
            const d = lldLinkPath(n1, n2, link.isDashed)
            const isHovered = hoveredLink === link.id

            const x1 = n1.x + n1.w / 2, y1n = n1.y + n1.h
            const x2 = n2.x + n2.w / 2, y2n = n2.y
            const isHoriz = link.isDashed && Math.abs(y1n - n2.y - n2.h/2) < n1.h
            const midX = (x1 + x2) / 2
            const midY = isHoriz ? Math.min(n1.y, n2.y) + Math.min(n1.h, n2.h) / 2 : (y1n + y2n) / 2

            const strokeColor = isHovered ? '#94A3B8' : link.isDashed ? '#4B5563' : '#334155'
            const strokeW = isHovered ? 1.8 : 1
            const dashArray = link.isDashed ? '4 4' : 'none'

            return (
              <g
                key={link.id}
                onMouseEnter={() => setHoveredLink(link.id)}
                onMouseLeave={() => setHoveredLink(null)}
                style={{ cursor: 'default' }}
              >
                <path d={d} stroke={strokeColor} strokeWidth={strokeW} fill="none"
                  strokeDasharray={dashArray} opacity={0.65} />

                {/* Port labels at endpoints */}
                {!isHoriz && (
                  <>
                    <text x={x1 + (x2 > x1 ? 8 : -8)} y={y1n + 10}
                      textAnchor={x2 > x1 ? 'start' : 'end'} fill="#94A3B8" fontSize={5.5}>
                      {link.fromPort}
                    </text>
                    <text x={x2 + (x1 > x2 ? 8 : -8)} y={y2n - 4}
                      textAnchor={x1 > x2 ? 'start' : 'end'} fill="#94A3B8" fontSize={5.5}>
                      {link.toPort}
                    </text>
                  </>
                )}

                {/* Hover label with full link details */}
                {isHovered && (
                  <g>
                    <rect x={midX - 55} y={midY - 14} width={110} height={28}
                      rx={4} fill="#0F172A" stroke={strokeColor} strokeWidth={0.6} opacity={0.95} />
                    <text x={midX} y={midY - 2} textAnchor="middle" fill="#BAE6FD" fontSize={6.5} fontWeight="600">
                      {link.speed} · {link.protocol}
                    </text>
                    <text x={midX} y={midY + 10} textAnchor="middle" fill="#94A3B8" fontSize={6}>
                      {[link.vlan, link.subnet].filter(Boolean).join(' · ') || `${link.fromPort} → ${link.toPort}`}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Device nodes */}
          {topo.nodes.map(node => {
            const isSelected = selectedNode === node.id
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                onClick={(e) => { e.stopPropagation(); setSelectedNode(isSelected ? null : node.id) }}
                style={{ cursor: 'pointer' }}
              >
                {/* Node box */}
                <rect width={node.w} height={node.h} rx={6}
                  fill={node.color} stroke={isSelected ? '#FFFFFF' : node.border}
                  strokeWidth={isSelected ? 2.5 : 1.2} />

                {/* HA badge */}
                {node.haRole && (
                  <rect x={node.w - 45} y={3} width={42} height={12} rx={3}
                    fill={node.haRole === 'active' ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.25)'}
                    stroke={node.haRole === 'active' ? '#22C55E' : '#64748B'} strokeWidth={0.6} />
                )}
                {node.haRole && (
                  <text x={node.w - 24} y={12} textAnchor="middle"
                    fill={node.haRole === 'active' ? '#22C55E' : '#64748B'} fontSize={6.5} fontWeight="700">
                    {node.haRole === 'active' ? 'ACTIVE' : 'STBY'}
                  </text>
                )}

                {/* Device glyph — the emoji here rendered at a different
                    size on every OS and could not take the node's colour.
                    Shares the icon set with the BOM table and the HLD, so
                    both diagrams agree on what a spine looks like (AH4). */}
                <g transform="translate(5,7) scale(0.55)" color={node.border} opacity={0.9}>
                  <LldGlyph tier={node.tier} />
                </g>
                <text x={node.w / 2} y={16} textAnchor="middle"
                  fill={node.textColor} fontSize={8.5} fontWeight="700">
                  {node.hostname}
                </text>

                {/* Model */}
                <text x={node.w / 2} y={28} textAnchor="middle"
                  fill={node.border} fontSize={7} opacity={0.8}>
                  {node.model} {node.vendor !== '—' && node.vendor !== 'ISP' ? `(${node.vendor})` : ''}
                </text>

                {/* Interfaces (up to 3) */}
                {node.interfaces.slice(0, 3).map((iface, i) => (
                  <g key={iface.name}>
                    <text x={6} y={42 + i * 11} fill="#94A3B8" fontSize={5.5} fontWeight="600">
                      {iface.name}
                    </text>
                    <text x={node.w / 2 - 10} y={42 + i * 11} fill="#60A5FA" fontSize={5.5}>
                      {iface.ip}
                    </text>
                    {iface.vlan && (
                      <text x={node.w - 6} y={42 + i * 11} textAnchor="end" fill="#9CA3AF" fontSize={5}>
                        {iface.vlan}
                      </text>
                    )}
                  </g>
                ))}

                {/* Config lines */}
                {node.configLines.slice(0, 2).map((line, i) => (
                  <text key={line} x={6} y={42 + Math.min(node.interfaces.length, 3) * 11 + i * 10}
                    fill="#CBD5E1" fontSize={5.5} opacity={0.9}>
                    {line.length > 40 ? line.slice(0, 40) + '…' : line}
                  </text>
                ))}

                {/* Port indicator dots */}
                {!node.haRole && (
                  <>
                    <circle cx={0} cy={node.h / 2} r={3} fill={node.border} opacity={0.5} />
                    <circle cx={node.w} cy={node.h / 2} r={3} fill={node.border} opacity={0.5} />
                  </>
                )}
                <circle cx={node.w / 2} cy={0} r={3} fill={node.border} opacity={0.5} />
                <circle cx={node.w / 2} cy={node.h} r={3} fill={node.border} opacity={0.5} />

                {isSelected && (
                  <rect width={node.w} height={node.h} rx={6} fill="none" stroke="#FFFFFF" strokeWidth={0.5} opacity={0.5} />
                )}
              </g>
            )
          })}

          {/* Legend */}
          <line x1={LEFT_W} y1={topo.svgH - 36} x2={SVG_W - RIGHT_PAD} y2={topo.svgH - 36}
            stroke="#1E293B" strokeWidth={0.8} />
          <text x={LEFT_W + 8} y={topo.svgH - 22} fill="#94A3B8" fontSize={7}>
            ━━ Active link  · · · HA sync / Peer  ·  Hover link for port details  ·  Click device for full specs
          </text>
          <text x={SVG_W - RIGHT_PAD} y={topo.svgH - 22} textAnchor="end" fill="#7E22CE" fontSize={7} opacity={0.6}>
            NetDesign AI · LLD
          </text>
        </svg>
      </div>

      {/* ── Device detail panel ── */}
      {selectedNodeObj && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs font-mono space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-white text-sm">{selectedNodeObj.hostname}</span>
              <span className="ml-3 text-gray-500">{selectedNodeObj.model}</span>
              <span className="ml-2 text-gray-600">({selectedNodeObj.vendor})</span>
              {selectedNodeObj.haRole && (
                <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-semibold ${
                  selectedNodeObj.haRole === 'active' ? 'text-green-400 bg-green-900/30' : 'text-gray-400 bg-gray-800'
                }`}>
                  {selectedNodeObj.haRole.toUpperCase()}
                </span>
              )}
            </div>
            <CloseButton onClick={() => setSelectedNode(null)} label="Close device details" />
          </div>

          {/* Interfaces table */}
          {selectedNodeObj.interfaces.length > 0 && (
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs mb-2 font-semibold">Interfaces</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-600 border-b border-white/5">
                      <th className="text-left py-1 pr-4">Interface</th>
                      <th className="text-left py-1 pr-4">IPv4 Address</th>
                      <th className="text-left py-1 pr-4">Speed</th>
                      <th className="text-left py-1 pr-4">VLAN / Zone</th>
                      {selectedNodeObj.interfaces.some(i => i.mac) && <th className="text-left py-1">MAC</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedNodeObj.interfaces.map(iface => (
                      <tr key={iface.name} className="border-b border-white/[0.03]">
                        <td className="py-1 pr-4 text-yellow-400 font-semibold">{iface.name}</td>
                        <td className="py-1 pr-4 text-blue-400">{iface.ip}</td>
                        <td className="py-1 pr-4 text-gray-400">{iface.speed ?? '—'}</td>
                        <td className="py-1 pr-4 text-gray-500">{iface.vlan ?? '—'}</td>
                        {selectedNodeObj.interfaces.some(i => i.mac) && <td className="py-1 text-gray-600">{iface.mac ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Config snippet */}
          {selectedNodeObj.configLines.length > 0 && (
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs mb-1.5 font-semibold">Configuration</div>
              <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-green-400 text-xs leading-relaxed">
                {selectedNodeObj.configLines.map(line => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </div>
          )}

          {/* Services */}
          {selectedNodeObj.services.length > 0 && (
            <div>
              <div className="text-gray-600 uppercase tracking-wider text-xs mb-1.5 font-semibold">Services / Protocols</div>
              <div className="flex flex-wrap gap-1.5">
                {selectedNodeObj.services.map(s => (
                  <span key={s} className="px-2 py-0.5 rounded-full text-xs bg-white/5 border border-white/10 text-gray-300">{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Connected links */}
          <div>
            <div className="text-gray-600 uppercase tracking-wider text-xs mb-1.5 font-semibold">Connected Links</div>
            <div className="space-y-0.5">
              {topo.links.filter(l => l.from === selectedNodeObj.id || l.to === selectedNodeObj.id).map(l => {
                const peer = nodeMap[l.from === selectedNodeObj.id ? l.to : l.from]
                return (
                  <div key={l.id} className="flex gap-3 text-gray-400">
                    <span className="text-yellow-600">{l.from === selectedNodeObj.id ? l.fromPort : l.toPort}</span>
                    <span className="text-blue-500">→</span>
                    <span className="text-gray-300">{peer?.hostname ?? '?'}</span>
                    <span className="text-yellow-600">{l.to === selectedNodeObj.id ? l.fromPort : l.toPort}</span>
                    <span className="text-gray-600 ml-auto">{l.speed}</span>
                    <span className="text-gray-600">{l.protocol}</span>
                    {l.subnet && <span className="text-gray-700 font-mono">{l.subnet}</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {selectedNodeObj.specs && (
            <div className="text-gray-500 text-xs pt-1 border-t border-white/5">
              Specs: {selectedNodeObj.specs}
            </div>
          )}
        </div>
      )}

      {/* ── Physical Cabling Matrix ── */}
      {topo.cabling.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Physical Cabling Matrix</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 pr-4">Server / Device</th>
                  <th className="text-left py-2 pr-4">Port</th>
                  <th className="text-left py-2 pr-4">IPv4</th>
                  <th className="text-left py-2 pr-4">Switch Port</th>
                  <th className="text-left py-2 pr-4">Management</th>
                  <th className="text-left py-2">VLAN</th>
                </tr>
              </thead>
              <tbody>
                {topo.cabling.map((c, i) => (
                  <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-1.5 pr-4 text-gray-300 font-semibold">{c.server}</td>
                    <td className="py-1.5 pr-4 text-yellow-400">{c.serverPort}</td>
                    <td className="py-1.5 pr-4 text-blue-400">{c.ipv4}</td>
                    <td className="py-1.5 pr-4 text-gray-400">{c.switchPort}</td>
                    <td className="py-1.5 pr-4 text-gray-500">{c.mgmtPort}</td>
                    <td className="py-1.5 text-gray-500">{c.vlan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
