import { useState, useMemo } from 'react'
import type { BOMDevice, UseCase } from '@/types'
import { fabricInterfaceView, borderLeaves, TENANT_OVERLAY, CAMPUS_VLANS } from '@/lib/configgen'
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

// Derive the actual BOM hardware (vendor/model/hostname) for the i-th device
// of a given role, so LLD nodes reflect the user's vendor selection instead of
// a hardcoded Cisco model. Falls back to the supplied defaults when the BOM has
// no device for that role (mirrors the GPU LLD / HLD vendor-derivation pattern).
function bomRole(
  devices: BOMDevice[], subLayer: string,
  fallback: { vendor: string; model: string; name: (i: number) => string },
) {
  const matches = devices.filter(d => d.subLayer === subLayer)
  return {
    vendor: (i: number) => matches[i]?.vendor ?? fallback.vendor,
    model: (i: number) => matches[i]?.model ?? fallback.model,
    name: (i: number) => matches[i]?.hostname ?? fallback.name(i),
    count: matches.length,
  }
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

// ─── WAN LLD ──────────────────────────────────────────────────────────────────

function buildWANLLD(devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 190
  const Y = { sp: 50, hub: 190, cpe: 370, branch: 530, ep: 680 }

  // PE/CE routers reflect the BOM's actual WAN-edge vendor/model selection.
  const wanRole = bomRole(devices, 'wan-edge', { vendor: 'Cisco', model: 'ASR-9001', name: i => `HQ-PE-RTR-0${i + 1}` })

  const zones: LLDZone[] = [
    { id: 'z-sp', label: 'SP BACKBONE', sublabel: 'MPLS / Internet Transit · BGP full-table',
      yStart: 0, yEnd: 140, fill: 'rgba(17,17,17,0.9)', stroke: '#374151' },
    { id: 'z-hub', label: 'HQ / HUB SITE', sublabel: 'PE Routers · BGP Route Reflector · MPLS LDP',
      yStart: 140, yEnd: 320, fill: 'rgba(127,29,29,0.20)', stroke: '#B91C1C' },
    { id: 'z-wan', label: 'WAN TRANSPORT', sublabel: 'MPLS L3VPN · SD-WAN · QoS DSCP 6-class',
      yStart: 320, yEnd: 480, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-branch', label: 'BRANCH SITES', sublabel: 'CE Router · Local FW · OSPF Area 10',
      yStart: 480, yEnd: 640, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-ep', label: 'BRANCH ENDPOINTS', sublabel: 'Desktops · VoIP · Local Servers',
      yStart: 640, yEnd: 790, fill: 'rgba(28,25,23,0.20)', stroke: '#57534E' },
  ]

  const [spX] = xCenter(1, 0, 200)
  const sp = mkNode('sp', 'SP-BACKBONE', 'MPLS/Internet', 'internet', 'ISP', spX, Y.sp, 200, 80, {
    interfaces: [
      { name: 'PE1', ip: '203.0.0.1/30', vlan: 'MPLS Core' },
      { name: 'PE2', ip: '203.0.0.5/30', vlan: 'MPLS Core' },
    ],
    configLines: ['MPLS L3VPN', 'BGP full-table', 'Internet Transit'],
    services: ['MPLS', 'BGP', 'Internet Transit'],
  })

  const [h1x, h2x] = xCenter(2, 200, NW)
  const hub1 = mkNode('hub1', wanRole.name(0), wanRole.model(0), 'wan', wanRole.vendor(0), h1x, Y.hub, NW, 110, {
    haRole: 'active',    interfaces: [
      { name: 'Gi0/0/0', ip: '203.0.0.2/30', vlan: 'SP-uplink' },
      { name: 'Gi0/1', ip: '10.0.0.1/30', vlan: 'iBGP peer' },
      { name: 'Lo0', ip: '10.0.0.1/32' },
    ],
    configLines: ['BGP Route Reflector', 'MPLS PE · LDP', 'SR-MPLS Adj-SID', 'BFD multihop 50ms'],
    services: ['BGP RR', 'MPLS', 'SR-MPLS', 'BFD'],
  })
  const hub2 = mkNode('hub2', wanRole.name(1), wanRole.model(1), 'wan', wanRole.vendor(1), h2x, Y.hub, NW, 110, {
    haRole: 'standby',    interfaces: [
      { name: 'Gi0/0/0', ip: '203.0.0.6/30', vlan: 'SP-uplink' },
      { name: 'Gi0/1', ip: '10.0.0.2/30', vlan: 'iBGP peer' },
      { name: 'Lo0', ip: '10.0.0.2/32' },
    ],
    configLines: ['BGP RR standby', 'MPLS PE backup', 'SR-MPLS', 'BFD'],
    services: ['BGP RR', 'MPLS', 'SR-MPLS'],
  })

  const cpeW = 170
  const cpeXs = xCenter(3, 40, cpeW)
  const cpes = cpeXs.map((x, i) => mkNode(
    `cpe${i+1}`, `WAN-CPE-0${i+1}`, 'ISR-4331', 'branch', 'Cisco', x, Y.cpe, cpeW, 110, {
      interfaces: [
        { name: 'Gi0/0/0', ip: `10.100.${i}.1/30`, vlan: 'MPLS PE-link' },
        { name: 'Gi0/0/1', ip: `10.100.${i}.5/30`, vlan: 'MPLS backup' },
        { name: 'Gi0/1', ip: `10.10.${i+1}.1/24`, vlan: 'Branch LAN' },
        { name: 'Lo0', ip: `10.0.1.${i+1}/32` },
      ],
      configLines: [
        'L3VPN PE · VRF BRANCH',
        'QoS DSCP 6-class marking',
        'BFD sub-second detection',
        'SD-WAN overlay tunnel',
      ],
      services: ['L3VPN', 'QoS', 'BFD', 'SD-WAN'],
    },
  ))

  const brW = 160
  const brXs = xCenter(3, 40, brW)
  const branches = brXs.map((x, i) => mkNode(
    `br${i+1}`, `BR-RTR-0${i+1}`, 'ISR-1100', 'distribution', 'Cisco', x, Y.branch, brW, 100, {
      interfaces: [
        { name: 'Gi0/0', ip: `10.10.${i+1}.2/24`, vlan: 'WAN-link' },
        { name: 'Gi0/1', ip: `10.10.${i+1}.1/24`, vlan: 'LAN' },
      ],
      configLines: ['OSPF Area 10', 'IPSec fallback tunnel', 'Local internet breakout', 'ZBF firewall'],
      services: ['OSPF', 'IPSec', 'ZBF', 'NAT'],
    },
  ))

  const epW = 100
  const epXs = xCenter(3, 120, epW)
  const eps = epXs.map((x, i) => mkNode(
    `ep${i+1}`, `BR${i+1}-HOST`, 'Endpoint', 'endpoint', '—', x, Y.ep, epW, 60, {
      interfaces: [{ name: 'eth0', ip: `10.10.${i+1}.10/24`, vlan: 'VLAN20' }],
      configLines: ['DHCP Client'],
    },
  ))

  const nodes = [sp, hub1, hub2, ...cpes, ...branches, ...eps]

  const links: LLDLink[] = [
    mkLink('sp', 'hub1', 'PE1', 'Gi0/0/0', '10G', 'MPLS / BGP', { subnet: '203.0.0.0/30' }),
    mkLink('sp', 'hub2', 'PE2', 'Gi0/0/0', '10G', 'MPLS / BGP', { subnet: '203.0.0.4/30' }),
    mkLink('hub1', 'hub2', 'Gi0/1', 'Gi0/1', '1G', 'iBGP RR peer', { isDashed: true }),
    ...cpes.map((c, i) => mkLink('hub1', c.id, `Gi0/${i+2}`, 'Gi0/0/0', '1G', 'MPLS L3VPN', { subnet: `10.100.${i}.0/30` })),
    ...cpes.map((c, i) => mkLink('hub2', c.id, `Gi0/${i+2}`, 'Gi0/0/1', '1G', 'MPLS backup', { subnet: `10.101.${i}.0/30`, isDashed: true })),
    ...cpes.map((c, i) => mkLink(c.id, branches[i].id, 'Gi0/1', 'Gi0/0', '100M', 'OSPF / QoS', { subnet: `10.10.${i+1}.0/24` })),
    ...branches.map((b, i) => mkLink(b.id, eps[i].id, 'Gi0/1', 'eth0', '1G', '802.1Q Trunk', { vlan: 'VLAN20' })),
  ]

  const cabling: CablingEntry[] = [
    ...cpes.map((c, i) => ({ server: c.hostname, serverPort: 'Gi0/0/0', ipv4: c.interfaces[0]?.ip ?? '', switchPort: `HQ-PE Gi0/${i+2}`, mgmtPort: 'Lo0', vlan: 'MPLS' })),
    ...branches.map((b) => ({ server: b.hostname, serverPort: 'Gi0/0', ipv4: b.interfaces[0]?.ip ?? '', switchPort: `CPE Gi0/1`, mgmtPort: 'Lo0', vlan: 'LAN' })),
  ]

  return {
    nodes, links, zones, cabling,
    title: `WAN LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: 'MPLS L3VPN Hub-and-Spoke · 3 Branch Sites · PE HA · QoS · SD-WAN overlay',
    svgH: 800,
  }
}

// ─── Multisite LLD ────────────────────────────────────────────────────────────

function buildMultisiteLLD(devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { dci: 50, spine: 190, leaf: 340, srv: 490 }

  // Both sites share the BOM's fabric hardware; derive vendor/model from it
  // (keep the site-specific hostnames). DCI gateways follow the BOM wan-edge,
  // falling back to the spine vendor + a chassis SKU when none is present.
  const spineRole = bomRole(devices, 'spine', { vendor: 'Cisco', model: 'N9K-C9508', name: i => `SPINE-0${i + 1}` })
  const leafRole = bomRole(devices, 'leaf', { vendor: 'Cisco', model: 'N9K-C9332C', name: i => `LEAF-0${i + 1}` })
  const dciRole = bomRole(devices, 'wan-edge', { vendor: spineRole.vendor(0), model: 'N9K-C9504', name: i => `DCI-GW-0${i + 1}` })

  const zones: LLDZone[] = [
    { id: 'z-dci', label: 'DCI INTERCONNECT', sublabel: 'EVPN Type-5 · RT 65100:<vni> · BGP multi-AS',
      yStart: 0, yEnd: 140, fill: 'rgba(127,29,29,0.20)', stroke: '#B91C1C' },
    { id: 'z-spine', label: 'SPINE FABRIC', sublabel: 'IS-IS underlay · BGP EVPN overlay · ECMP',
      yStart: 140, yEnd: 290, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-leaf', label: 'LEAF / ToR', sublabel: 'VXLAN NVE · Anycast-GW · vPC domain',
      yStart: 290, yEnd: 430, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-srv', label: 'COMPUTE / STORAGE', sublabel: 'Dual-homed LAG · jumbo 9000 · 25G',
      yStart: 430, yEnd: 600, fill: 'rgba(28,25,23,0.20)', stroke: '#57534E' },
  ]

  const siteASpineXs = xCenter(2, 40, NW)
  const siteBSpineXs = [siteASpineXs[0] + 480, siteASpineXs[1] + 480]

  const dciGw1 = mkNode('dci1', 'DCI-GW-SITE-A', dciRole.model(0), 'wan', dciRole.vendor(0),
    siteASpineXs[0] + NW/2, Y.dci, NW, 90, { haRole: 'active',
      interfaces: [
        { name: 'e1/1', ip: '172.16.0.1/30', speed: '100G', vlan: 'DCI trunk' },
        { name: 'Lo0', ip: '10.255.0.100/32' },
      ],
      configLines: ['EVPN Type-5 stretched RT', 'RT 65100:10010 (L2)', 'RT 65100:50000 (L3)'],
      services: ['EVPN DCI', 'BGP Multi-AS'],
    })
  const dciGw2 = mkNode('dci2', 'DCI-GW-SITE-B', dciRole.model(0), 'wan', dciRole.vendor(0),
    siteBSpineXs[0] + NW/2, Y.dci, NW, 90, { haRole: 'active',
      interfaces: [
        { name: 'e1/1', ip: '172.16.0.2/30', speed: '100G', vlan: 'DCI trunk' },
        { name: 'Lo0', ip: '10.255.0.200/32' },
      ],
      configLines: ['EVPN Type-5 stretched RT', 'RT 65100:10010 (L2)', 'RT 65100:50000 (L3)'],
      services: ['EVPN DCI', 'BGP Multi-AS'],
    })

  const mkSiteSpine = (site: string, xs: number[], baseIp: number) =>
    xs.map((x, i) => mkNode(
      `${site}sp${i+1}`, `${site.toUpperCase()}-SPINE-0${i+1}`, spineRole.model(i), 'spine', spineRole.vendor(i), x, Y.spine, NW, 100, {
        interfaces: [
          { name: `e1/1-4`, ip: `10.${baseIp}.0.${i*4}/31`, speed: '100G' },
          { name: 'Lo0', ip: `10.255.${baseIp}.${i+1}/32` },
        ],
        configLines: ['IS-IS level-2', 'BGP EVPN', `ASN 6500${baseIp}`],
        services: ['IS-IS', 'BGP EVPN', 'ECMP'],
      },
    ))

  const mkSiteLeaf = (site: string, baseIp: number) => {
    const xs = site === 'a' ? xCenter(2, 40, NW) : [siteASpineXs[0] + 480, siteASpineXs[1] + 480]
    return xs.map((x, i) => mkNode(
      `${site}lf${i+1}`, `${site.toUpperCase()}-LEAF-0${i+1}`, leafRole.model(i), 'leaf', leafRole.vendor(i), x, Y.leaf, NW, 100, {
        interfaces: [
          { name: 'e1/1-2', ip: `10.${baseIp}.1.${i*4}/31`, speed: '25G' },
          { name: 'nve1', ip: `10.255.${baseIp+10}.${i+1}/32` },
          { name: 'Po1', ip: '—', vlan: `vPC Domain ${Math.floor(i/2)+1}` },
        ],
        configLines: [
          'VXLAN NVE · BGP EVPN',
          `vPC Pair #${Math.floor(i/2)+1}`,
          'Anycast-GW 10.100.x.1',
          `Stretched RT 65100:<vni>`,
        ],
        services: ['VXLAN', 'BGP EVPN', 'vPC', 'Anycast-GW'],
      },
    ))
  }

  const mkSiteSrv = (site: string, baseIp: number) => {
    const xs = site === 'a' ? xCenter(2, 40, 160) : [siteASpineXs[0] + 480, siteASpineXs[1] + 470]
    return xs.map((x, i) => mkNode(
      `${site}srv${i+1}`, `${site.toUpperCase()}-SRV-0${i+1}`, 'x86 2U', 'endpoint', 'Dell', x, Y.srv, 160, 80, {
        interfaces: [{ name: 'eth0', ip: `10.100.${baseIp}.${i+10}/24`, speed: '25G' }],
        configLines: ['25GE dual-homed LAG', 'jumbo 9000'],
      },
    ))
  }

  const aspines = mkSiteSpine('a', siteASpineXs, 1)
  const bspines = mkSiteSpine('b', siteBSpineXs, 2)
  const aleaves = mkSiteLeaf('a', 1)
  const bleaves = mkSiteLeaf('b', 2)
  const asrvs = mkSiteSrv('a', 1)
  const bsrvs = mkSiteSrv('b', 2)

  const nodes = [dciGw1, dciGw2, ...aspines, ...bspines, ...aleaves, ...bleaves, ...asrvs, ...bsrvs]

  const links: LLDLink[] = [
    mkLink('dci1', 'dci2', 'e1/1', 'e1/1', '100G', 'DCI EVPN Type-5', { subnet: '172.16.0.0/30', isDashed: false }),
    mkLink('dci1', 'asp1', 'e1/2', 'e1/5', '100G', 'IS-IS / BGP', { subnet: '10.1.0.100/31' }),
    mkLink('dci2', 'bsp1', 'e1/2', 'e1/5', '100G', 'IS-IS / BGP', { subnet: '10.2.0.100/31' }),
    ...aspines.flatMap((sp, si) => aleaves.map((lf, li) => mkLink(sp.id, lf.id, `e1/${li+1}`, `e1/${si+1}`, '100G', 'IS-IS / VXLAN', { subnet: `10.1.${si}.${li*4}/31` }))),
    ...bspines.flatMap((sp, si) => bleaves.map((lf, li) => mkLink(sp.id, lf.id, `e1/${li+1}`, `e1/${si+1}`, '100G', 'IS-IS / VXLAN', { subnet: `10.2.${si}.${li*4}/31` }))),
    mkLink('alf1', 'alf2', 'Po1', 'Po1', '2×40G', 'vPC Peer', { isDashed: true }),
    mkLink('blf1', 'blf2', 'Po1', 'Po1', '2×40G', 'vPC Peer', { isDashed: true }),
    ...aleaves.map((lf, i) => mkLink(lf.id, asrvs[i].id, 'e1/49', 'eth0', '25G', 'LAG', { subnet: `10.100.1.${i*4}/30` })),
    ...bleaves.map((lf, i) => mkLink(lf.id, bsrvs[i].id, 'e1/49', 'eth0', '25G', 'LAG', { subnet: `10.100.2.${i*4}/30` })),
  ]

  const cabling: CablingEntry[] = [
    { server: 'DCI-GW-A', serverPort: 'e1/1', ipv4: '172.16.0.1', switchPort: 'DCI-GW-B e1/1', mgmtPort: 'Lo0', vlan: 'DCI' },
    ...asrvs.map((s, i) => ({ server: s.hostname, serverPort: 'eth0', ipv4: s.interfaces[0]?.ip ?? '', switchPort: `A-LEAF-0${i+1} e1/49`, mgmtPort: '—', vlan: 'LAG' })),
    ...bsrvs.map((s, i) => ({ server: s.hostname, serverPort: 'eth0', ipv4: s.interfaces[0]?.ip ?? '', switchPort: `B-LEAF-0${i+1} e1/49`, mgmtPort: '—', vlan: 'LAG' })),
  ]

  return {
    nodes, links, zones, cabling,
    title: `MULTISITE EVPN DCI LLD${sc ? ` · ${sc}` : ''}`,
    subtitle: 'Site A + Site B · EVPN Type-5 DCI · Stretched VNI RT 65100 · vPC domains',
    svgH: 620,
  }
}

// ─── Multicloud LLD ───────────────────────────────────────────────────────────

function buildMulticloudLLD(devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { onprem: 50, gw: 200, cloud: 380, workload: 530 }

  // On-prem DC spine reflects the BOM (cloud GW/VPC/workload nodes stay
  // provider-native — AWS/Azure/GCP are correct as-is).
  const spineRole = bomRole(devices, 'spine', { vendor: 'Cisco', model: 'N9K-C9508', name: i => `DC-SPINE-0${i + 1}` })

  const zones: LLDZone[] = [
    { id: 'z-onprem', label: 'ON-PREMISES DC', sublabel: 'Spine-Leaf · VXLAN/EVPN · BGP',
      yStart: 0, yEnd: 150, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-gw', label: 'CLOUD GATEWAY', sublabel: 'DirectConnect · ExpressRoute · Cloud Interconnect',
      yStart: 150, yEnd: 320, fill: 'rgba(180,83,9,0.20)', stroke: '#B45309' },
    { id: 'z-cloud', label: 'CLOUD PROVIDERS', sublabel: 'AWS VPC · Azure VNet · GCP VPC',
      yStart: 320, yEnd: 470, fill: 'rgba(6,78,59,0.20)', stroke: '#065F46' },
    { id: 'z-wl', label: 'CLOUD WORKLOADS', sublabel: 'EC2 · AKS · GKE · Serverless',
      yStart: 470, yEnd: 640, fill: 'rgba(88,28,135,0.20)', stroke: '#7E22CE' },
  ]

  const [s1x, s2x] = xCenter(2, 200, NW)
  const dcSpine1 = mkNode('dcsp1', 'DC-SPINE-01', spineRole.model(0), 'spine', spineRole.vendor(0), s1x, Y.onprem, NW, 90, {
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.0.x/31', speed: '100G' },
      { name: 'Lo0', ip: '10.255.1.1/32' },
    ],
    configLines: ['IS-IS · BGP EVPN', 'VXLAN NVE overlay'],
    services: ['IS-IS', 'BGP EVPN', 'VXLAN'],
  })
  const dcSpine2 = mkNode('dcsp2', 'DC-SPINE-02', spineRole.model(1), 'spine', spineRole.vendor(1), s2x, Y.onprem, NW, 90, {
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.1.x/31', speed: '100G' },
      { name: 'Lo0', ip: '10.255.1.2/32' },
    ],
    configLines: ['IS-IS · BGP EVPN', 'VXLAN NVE overlay'],
    services: ['IS-IS', 'BGP EVPN', 'VXLAN'],
  })

  const gwXs = xCenter(3, 40, NW)
  const awsGw = mkNode('awsgw', 'AWS DX Gateway', 'DirectConnect', 'cloud', 'AWS', gwXs[0], Y.gw, NW, 100, {
    interfaces: [
      { name: 'dxcon-01', ip: '169.254.0.1/30', speed: '10G', vlan: 'VLAN 100' },
      { name: 'vgw', ip: '10.200.0.1/24', vlan: 'VPC CIDR' },
    ],
    configLines: ['AWS DirectConnect 10G', 'BGP AS64512', 'Private VIF → VPC'],
    services: ['DirectConnect', 'BGP', 'Private VIF'],
  })
  const azureGw = mkNode('azuregw', 'Azure ER Gateway', 'ExpressRoute', 'cloud', 'Azure', gwXs[1], Y.gw, NW, 100, {
    interfaces: [
      { name: 'er-circuit', ip: '169.254.1.1/30', speed: '10G', vlan: 'VLAN 200' },
      { name: 'vnet-gw', ip: '10.201.0.1/24', vlan: 'VNet CIDR' },
    ],
    configLines: ['ExpressRoute Premium', 'BGP AS12076', 'Private Peering'],
    services: ['ExpressRoute', 'BGP', 'Private Peering'],
  })
  const gcpGw = mkNode('gcpgw', 'GCP Interconnect', 'Cloud Interconnect', 'cloud', 'GCP', gwXs[2], Y.gw, NW, 100, {
    interfaces: [
      { name: 'attach-01', ip: '169.254.2.1/30', speed: '10G', vlan: 'VLAN 300' },
      { name: 'vpc-gw', ip: '10.202.0.1/24', vlan: 'VPC CIDR' },
    ],
    configLines: ['Dedicated Interconnect', 'BGP AS16550', 'Cloud Router'],
    services: ['Dedicated IC', 'BGP', 'Cloud Router'],
  })

  const cloudXs = xCenter(3, 40, NW)
  const awsVpc = mkNode('awsvpc', 'AWS VPC', 'us-east-1', 'cloud', 'AWS', cloudXs[0], Y.cloud, NW, 80, {
    interfaces: [{ name: 'subnet-a', ip: '10.200.1.0/24', vlan: 'Private' }],
    configLines: ['VPC 10.200.0.0/16', 'Security Groups', 'NACLs'],
    services: ['VPC', 'SG', 'NACL'],
  })
  const azureVnet = mkNode('azurevnet', 'Azure VNet', 'eastus2', 'cloud', 'Azure', cloudXs[1], Y.cloud, NW, 80, {
    interfaces: [{ name: 'subnet-a', ip: '10.201.1.0/24', vlan: 'Private' }],
    configLines: ['VNet 10.201.0.0/16', 'NSG · UDR', 'Private Endpoints'],
    services: ['VNet', 'NSG', 'PE'],
  })
  const gcpVpc = mkNode('gcpvpc', 'GCP VPC', 'us-central1', 'cloud', 'GCP', cloudXs[2], Y.cloud, NW, 80, {
    interfaces: [{ name: 'subnet-a', ip: '10.202.1.0/24', vlan: 'Private' }],
    configLines: ['VPC 10.202.0.0/16', 'Firewall Rules', 'Private Google Access'],
    services: ['VPC', 'FW Rules'],
  })

  const wlXs = xCenter(3, 40, 160)
  const awsWl = mkNode('awswl', 'EC2 / EKS', 'i3.2xlarge', 'application', 'AWS', wlXs[0], Y.workload, 160, 80, {
    interfaces: [{ name: 'eni-0', ip: '10.200.1.10/24' }],
    configLines: ['K8s cluster (EKS)', 'Auto Scaling Group'],
  })
  const azureWl = mkNode('azurewl', 'AKS / VMs', 'Standard_D4', 'application', 'Azure', wlXs[1], Y.workload, 160, 80, {
    interfaces: [{ name: 'nic-0', ip: '10.201.1.10/24' }],
    configLines: ['AKS managed K8s', 'VM Scale Sets'],
  })
  const gcpWl = mkNode('gcpwl', 'GKE / VMs', 'n2-standard-4', 'application', 'GCP', wlXs[2], Y.workload, 160, 80, {
    interfaces: [{ name: 'nic0', ip: '10.202.1.10/24' }],
    configLines: ['GKE Autopilot', 'Managed Instance Groups'],
  })

  const nodes = [dcSpine1, dcSpine2, awsGw, azureGw, gcpGw, awsVpc, azureVnet, gcpVpc, awsWl, azureWl, gcpWl]

  const links: LLDLink[] = [
    mkLink('dcsp1', 'awsgw', 'e1/5', 'dxcon-01', '10G', 'DirectConnect', { vlan: 'VLAN100', subnet: '169.254.0.0/30' }),
    mkLink('dcsp1', 'azuregw', 'e1/6', 'er-circuit', '10G', 'ExpressRoute', { vlan: 'VLAN200', subnet: '169.254.1.0/30' }),
    mkLink('dcsp2', 'gcpgw', 'e1/5', 'attach-01', '10G', 'Cloud IC', { vlan: 'VLAN300', subnet: '169.254.2.0/30' }),
    mkLink('dcsp1', 'dcsp2', 'e1/48', 'e1/48', '100G', 'IS-IS peer', { isDashed: true }),
    mkLink('awsgw', 'awsvpc', 'vgw', 'rtb', '—', 'VPC Attachment', { subnet: '10.200.0.0/16' }),
    mkLink('azuregw', 'azurevnet', 'vnet-gw', 'rtb', '—', 'VNet Peering', { subnet: '10.201.0.0/16' }),
    mkLink('gcpgw', 'gcpvpc', 'vpc-gw', 'rtb', '—', 'Cloud Router', { subnet: '10.202.0.0/16' }),
    mkLink('awsvpc', 'awswl', 'subnet-a', 'eni-0', '—', 'ENI attach', { subnet: '10.200.1.0/24' }),
    mkLink('azurevnet', 'azurewl', 'subnet-a', 'nic-0', '—', 'NIC attach', { subnet: '10.201.1.0/24' }),
    mkLink('gcpvpc', 'gcpwl', 'subnet-a', 'nic0', '—', 'NIC attach', { subnet: '10.202.1.0/24' }),
  ]

  const cabling: CablingEntry[] = [
    { server: 'DC-SPINE-01', serverPort: 'e1/5', ipv4: '169.254.0.2', switchPort: 'AWS DX dxcon-01', mgmtPort: 'Lo0', vlan: 'VLAN100' },
    { server: 'DC-SPINE-01', serverPort: 'e1/6', ipv4: '169.254.1.2', switchPort: 'Azure ER circuit', mgmtPort: 'Lo0', vlan: 'VLAN200' },
    { server: 'DC-SPINE-02', serverPort: 'e1/5', ipv4: '169.254.2.2', switchPort: 'GCP IC attach-01', mgmtPort: 'Lo0', vlan: 'VLAN300' },
  ]

  return {
    nodes, links, zones, cabling,
    title: `MULTICLOUD LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: 'On-prem DC · AWS DirectConnect · Azure ExpressRoute · GCP Cloud Interconnect',
    svgH: 660,
  }
}

// ─── Aviatrix LLD ─────────────────────────────────────────────────────────────

function buildAviatrixLLD(devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { onprem: 50, transit: 200, spoke: 370, workload: 520 }

  // On-prem DC-edge routers reflect the BOM wan-edge selection (transit/spoke
  // gateways stay Aviatrix-native — correct as-is).
  const edgeRole = bomRole(devices, 'wan-edge', { vendor: 'Cisco', model: 'ASR-1002-HX', name: i => `DC-EDGE-RTR-0${i + 1}` })

  const zones: LLDZone[] = [
    { id: 'z-onprem', label: 'ON-PREMISES', sublabel: 'DC Edge · BGP · IPSec tunnel',
      yStart: 0, yEnd: 150, fill: 'rgba(29,78,216,0.20)', stroke: '#1D4ED8' },
    { id: 'z-transit', label: 'AVIATRIX TRANSIT', sublabel: 'Transit Gateway · BGP over IPSec · FQDN Filter',
      yStart: 150, yEnd: 320, fill: 'rgba(180,83,9,0.20)', stroke: '#B45309' },
    { id: 'z-spoke', label: 'AVIATRIX SPOKES', sublabel: 'Spoke Gateways · Network Segmentation · NAT',
      yStart: 320, yEnd: 460, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-wl', label: 'CLOUD WORKLOADS', sublabel: 'EC2 · AKS · GKE · Cloud-native',
      yStart: 460, yEnd: 640, fill: 'rgba(88,28,135,0.20)', stroke: '#7E22CE' },
  ]

  const [e1x, e2x] = xCenter(2, 200, NW)
  const edge1 = mkNode('edge1', 'DC-EDGE-RTR-01', edgeRole.model(0), 'wan', edgeRole.vendor(0), e1x, Y.onprem, NW, 90, {
    haRole: 'active',    interfaces: [
      { name: 'Gi0/0/0', ip: '10.0.0.1/30', vlan: 'WAN' },
      { name: 'Tu1', ip: '169.254.10.1/30', vlan: 'IPSec to Transit' },
      { name: 'Lo0', ip: '10.255.0.1/32' },
    ],
    configLines: ['BGP AS65000', 'IPSec IKEv2 tunnel', 'BFD over tunnel'],
    services: ['BGP', 'IPSec', 'BFD'],
  })
  const edge2 = mkNode('edge2', 'DC-EDGE-RTR-02', edgeRole.model(1), 'wan', edgeRole.vendor(1), e2x, Y.onprem, NW, 90, {
    haRole: 'standby',    interfaces: [
      { name: 'Gi0/0/0', ip: '10.0.0.5/30', vlan: 'WAN' },
      { name: 'Tu1', ip: '169.254.10.5/30', vlan: 'IPSec to Transit' },
      { name: 'Lo0', ip: '10.255.0.2/32' },
    ],
    configLines: ['BGP AS65000', 'IPSec IKEv2 backup', 'BFD'],
    services: ['BGP', 'IPSec', 'BFD'],
  })

  const txXs = xCenter(3, 40, NW)
  const txAws = mkNode('txaws', 'Aviatrix Transit GW', 'AWS us-east-1', 'transit', 'Aviatrix', txXs[0], Y.transit, NW, 100, {
    interfaces: [
      { name: 'eth0', ip: '10.200.0.10/24', vlan: 'Transit VPC' },
      { name: 'tun-onprem', ip: '169.254.10.2/30', vlan: 'IPSec' },
    ],
    configLines: ['Transit Gateway (HA)', 'BGP AS64512', 'FQDN Egress Filter', 'HPE (High Perf Encryption)'],
    services: ['BGP', 'IPSec', 'FQDN', 'HPE'],
  })
  const txAzure = mkNode('txazure', 'Aviatrix Transit GW', 'Azure eastus2', 'transit', 'Aviatrix', txXs[1], Y.transit, NW, 100, {
    interfaces: [
      { name: 'eth0', ip: '10.201.0.10/24', vlan: 'Transit VNet' },
      { name: 'peering', ip: '10.201.0.100/30', vlan: 'Multi-cloud peering' },
    ],
    configLines: ['Transit Gateway', 'BGP AS64513', 'Connected Transit', 'Multi-cloud peering'],
    services: ['BGP', 'Connected Transit'],
  })
  const txGcp = mkNode('txgcp', 'Aviatrix Transit GW', 'GCP us-central1', 'transit', 'Aviatrix', txXs[2], Y.transit, NW, 100, {
    interfaces: [
      { name: 'eth0', ip: '10.202.0.10/24', vlan: 'Transit VPC' },
      { name: 'peering', ip: '10.202.0.100/30', vlan: 'Multi-cloud peering' },
    ],
    configLines: ['Transit Gateway', 'BGP AS64514', 'Segmentation Domain', 'Network Domain: Prod'],
    services: ['BGP', 'Segmentation'],
  })

  const spXs = xCenter(3, 40, NW)
  const spAws = mkNode('spaws', 'AWS Spoke GW', 'us-east-1a/b', 'spoke', 'Aviatrix', spXs[0], Y.spoke, NW, 80, {
    interfaces: [{ name: 'eth0', ip: '10.200.1.10/24', vlan: 'Spoke VPC' }],
    configLines: ['Spoke Gateway (HA)', 'Network Domain: Prod', 'NAT + SNAT'],
  })
  const spAzure = mkNode('spazure', 'Azure Spoke GW', 'eastus2', 'spoke', 'Aviatrix', spXs[1], Y.spoke, NW, 80, {
    interfaces: [{ name: 'eth0', ip: '10.201.1.10/24', vlan: 'Spoke VNet' }],
    configLines: ['Spoke Gateway', 'Network Domain: Dev', 'FQDN Filter'],
  })
  const spGcp = mkNode('spgcp', 'GCP Spoke GW', 'us-central1', 'spoke', 'Aviatrix', spXs[2], Y.spoke, NW, 80, {
    interfaces: [{ name: 'eth0', ip: '10.202.1.10/24', vlan: 'Spoke VPC' }],
    configLines: ['Spoke Gateway', 'Network Domain: Staging', 'Smart Egress'],
  })

  const wlXs = xCenter(3, 40, 160)
  const wlAws = mkNode('wlaws', 'EC2 / EKS', 'Prod workloads', 'application', 'AWS', wlXs[0], Y.workload, 160, 80, {
    interfaces: [{ name: 'eni-0', ip: '10.200.1.100/24' }],
    configLines: ['Production EKS', 'Auto Scaling Group'],
  })
  const wlAzure = mkNode('wlazure', 'AKS / VMs', 'Dev workloads', 'application', 'Azure', wlXs[1], Y.workload, 160, 80, {
    interfaces: [{ name: 'nic-0', ip: '10.201.1.100/24' }],
    configLines: ['Development AKS', 'VM Scale Sets'],
  })
  const wlGcp = mkNode('wlgcp', 'GKE / VMs', 'Staging workloads', 'application', 'GCP', wlXs[2], Y.workload, 160, 80, {
    interfaces: [{ name: 'nic0', ip: '10.202.1.100/24' }],
    configLines: ['Staging GKE', 'Managed Instance Groups'],
  })

  const nodes = [edge1, edge2, txAws, txAzure, txGcp, spAws, spAzure, spGcp, wlAws, wlAzure, wlGcp]

  const links: LLDLink[] = [
    mkLink('edge1', 'txaws', 'Tu1', 'tun-onprem', '1G', 'IPSec / BGP', { subnet: '169.254.10.0/30' }),
    mkLink('edge2', 'txaws', 'Tu1', 'tun-onprem', '1G', 'IPSec backup', { subnet: '169.254.10.4/30', isDashed: true }),
    mkLink('edge1', 'edge2', 'Gi0/1', 'Gi0/1', '10G', 'iBGP peer', { isDashed: true }),
    mkLink('txaws', 'txazure', 'peering', 'peering', '—', 'Multi-cloud peering', { subnet: 'BGP over IPSec' }),
    mkLink('txazure', 'txgcp', 'peering', 'peering', '—', 'Multi-cloud peering', { subnet: 'BGP over IPSec' }),
    mkLink('txaws', 'spaws', 'spoke-attach', 'eth0', '—', 'Spoke attachment', { subnet: '10.200.0.0/16' }),
    mkLink('txazure', 'spazure', 'spoke-attach', 'eth0', '—', 'Spoke attachment', { subnet: '10.201.0.0/16' }),
    mkLink('txgcp', 'spgcp', 'spoke-attach', 'eth0', '—', 'Spoke attachment', { subnet: '10.202.0.0/16' }),
    mkLink('spaws', 'wlaws', 'eth0', 'eni-0', '—', 'VPC routing', { subnet: '10.200.1.0/24' }),
    mkLink('spazure', 'wlazure', 'eth0', 'nic-0', '—', 'VNet routing', { subnet: '10.201.1.0/24' }),
    mkLink('spgcp', 'wlgcp', 'eth0', 'nic0', '—', 'VPC routing', { subnet: '10.202.1.0/24' }),
  ]

  const cabling: CablingEntry[] = [
    { server: 'DC-EDGE-01', serverPort: 'Tu1', ipv4: '169.254.10.1', switchPort: 'Aviatrix Transit', mgmtPort: 'Lo0', vlan: 'IPSec' },
    { server: 'DC-EDGE-02', serverPort: 'Tu1', ipv4: '169.254.10.5', switchPort: 'Aviatrix Transit', mgmtPort: 'Lo0', vlan: 'IPSec' },
  ]

  return {
    nodes, links, zones, cabling,
    title: `AVIATRIX MULTI-CLOUD LLD${sc ? ` · ${sc}` : ''}`,
    subtitle: 'On-prem → Aviatrix Transit GW → Spoke GWs → AWS/Azure/GCP workloads · Network Segmentation',
    svgH: 660,
  }
}

// ─── O-RAN / Private 5G LLD (G-A10) ──────────────────────────────────────────

function buildORANLLD(devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 200
  const Y = { core: 50, mid: 200, fh: 360, du: 530, ru: 700 }

  const nDU = Math.min(Math.max(devices.filter(d => d.subLayer === 'oran-du').length, 2), 4)
  const nRU = Math.min(Math.max(devices.filter(d => d.subLayer === 'oran-ru').length, 4), 6)

  const zones: LLDZone[] = [
    { id: 'z-core', label: '5G CORE + PTP GRANDMASTER', sublabel: 'UPF N3/N6 · GNSS-locked PTP GM · G.8275.1 PRC',
      yStart: 0, yEnd: 140, fill: 'rgba(30,13,80,0.20)', stroke: '#3730A3' },
    { id: 'z-mid', label: 'MIDHAUL + O-CU', sublabel: 'SR-MPLS transport · PTP boundary-clock · F1/E1 · NG to AMF',
      yStart: 140, yEnd: 300, fill: 'rgba(146,64,14,0.20)', stroke: '#92400E' },
    { id: 'z-fh', label: 'FRONTHAUL SWITCH', sublabel: 'eCPRI Class C7 · PTP transparent-clock · PFC · 9216 MTU',
      yStart: 300, yEnd: 470, fill: 'rgba(21,128,61,0.20)', stroke: '#15803D' },
    { id: 'z-du', label: 'O-DU (DISTRIBUTED UNIT)', sublabel: 'High-PHY/MAC/RLC · FAPI · L1 FPGA offload · eCPRI 25G',
      yStart: 470, yEnd: 640, fill: 'rgba(8,40,64,0.20)', stroke: '#0E7490' },
    { id: 'z-ru', label: 'O-RU (RADIO UNIT)', sublabel: 'Low-PHY/RF · 64T64R mMIMO · n78 3.5GHz · beamforming',
      yStart: 640, yEnd: 810, fill: 'rgba(61,30,8,0.20)', stroke: '#9A3412' },
  ]

  const [coreX, gmX] = xCenter(2, 260, NW)
  const upf = mkNode('upf', '5GC-UPF-01', '5G Core UPF', 'oran-core', 'Dell EMC', coreX, Y.core, NW, 110, {
    haRole: 'active',    interfaces: [
      { name: 'N3', ip: '10.250.0.1/30', speed: '100G', vlan: 'GTP-U' },
      { name: 'N6', ip: '10.250.6.1/24', speed: '100G', vlan: 'Data Network' },
      { name: 'N4', ip: '10.250.4.1/30', vlan: 'PFCP' },
    ],
    configLines: ['N3 GTP-U decap · DPDK', 'N6 → enterprise DNN', 'N4 PFCP to SMF', '5QI→DSCP QoS map'],
    services: ['UPF', 'GTP-U', 'PFCP', 'DPDK'],
    specs: 'COTS + SmartNIC offload',
  })
  const gm = mkNode('ptpgm', 'PTP-GM-01', 'Calnex PTP GM', 'oran-timing', 'Calnex', gmX, Y.core, NW, 110, {
    interfaces: [
      { name: 'GNSS', ip: 'GPS+Galileo', vlan: 'Antenna' },
      { name: 'p1-4', ip: '10.250.9.1/24', speed: '1G', vlan: 'PTP master' },
    ],
    configLines: ['G.8275.1 domain 24', 'clock-class GM · ±100ns', 'SyncE PRC · ESMC', 'announce -3 · sync -4'],
    services: ['PTP', 'GNSS', 'SyncE'],
    specs: 'Class A grandmaster',
  })

  const [mhX, cuX] = xCenter(2, 260, NW)
  const mh = mkNode('mh1', '5G-MH-RTR-01', 'ASR 9901', 'oran-midhaul', 'Cisco', mhX, Y.mid, NW, 120, {
    haRole: 'active',    interfaces: [
      { name: 'Gi0/0/0/0', ip: '10.250.10.1/30', speed: '100G', vlan: 'upstream/core' },
      { name: 'Gi0/0/0/1', ip: '10.250.11.1/30', speed: '100G', vlan: 'midhaul/DU' },
      { name: 'Lo0', ip: '10.250.1.1/32' },
    ],
    configLines: ['IS-IS + SR-MPLS', 'PTP boundary-clock', 'SyncE freq-sync', 'prefix-sid index 100'],
    services: ['SR-MPLS', 'IS-IS', 'PTP-BC', 'SyncE'],
    specs: 'Timing-grade aggregation',
  })
  const cu = mkNode('cu1', 'O-CU-01', 'O-CU Server', 'oran-cu', 'Dell EMC', cuX, Y.mid, NW, 120, {
    interfaces: [
      { name: 'F1-C/U', ip: '10.250.2.1/24', speed: '25G', vlan: 'F1 to DU' },
      { name: 'E1', ip: '10.250.2.5/30', vlan: 'CU-CP↔CU-UP' },
      { name: 'NG', ip: '10.250.2.9/30', vlan: 'to AMF/UPF' },
    ],
    configLines: ['CU-CP + CU-UP split', 'F1 SCTP 38472', 'E1 SCTP 38462', 'NG to 5GC AMF'],
    services: ['CU-CP', 'CU-UP', 'F1', 'E1', 'NG'],
    specs: 'COTS · RT-PHY',
  })

  const fhW = 220
  const [fhX] = xCenter(1, 0, fhW)
  const fh = mkNode('fh1', '5G-FH-SW-01', 'N9K-93180YC-FX3', 'oran-fronthaul', 'Cisco', fhX, Y.fh, fhW, 110, {
    interfaces: [
      { name: 'e1/1-48', ip: '—', speed: '25G', vlan: 'eCPRI fronthaul' },
      { name: 'e1/49-54', ip: '10.250.3.1/24', speed: '100G', vlan: 'uplink to DU/MH' },
    ],
    configLines: ['PTP transparent-clock', 'eCPRI Class C7 QoS', 'PFC priority 7', 'jumbo MTU 9216'],
    services: ['PTP-TC', 'eCPRI', 'PFC'],
    specs: '48×25G + 6×100G',
  })

  const duW = 190
  const duXs = xCenter(nDU, 24, duW)
  const dus = duXs.map((x, i) => mkNode(
    `du${i+1}`, `O-DU-0${i+1}`, 'O-DU Server', 'oran-du', 'Dell EMC', x, Y.du, duW, 120, {
      interfaces: [
        { name: 'eth0', ip: `10.250.4.${i+1}/24`, speed: '25G', vlan: 'F1 to CU' },
        { name: 'ecpri', ip: `10.250.14.${i*4}/30`, speed: '25G', vlan: 'eCPRI to RU' },
      ],
      configLines: ['High-PHY + MAC + RLC', 'eCPRI 7.2x split', 'FAPI · L1 FPGA offload', 'n78 100MHz · SCS 30kHz'],
      services: ['DU', 'eCPRI', 'FAPI', 'PTP'],
      specs: 'x86 + FPGA · DPDK cores 4-11',
    },
  ))

  const ruW = 180
  const ruXs = xCenter(nRU, 16, ruW)
  const rus = ruXs.map((x, i) => mkNode(
    `ru${i+1}`, `O-RU-0${i+1}`, 'O-RU Radio', 'oran-ru', 'Fujitsu', x, Y.ru, ruW, 110, {
      interfaces: [
        { name: 'sfp0', ip: `10.250.15.${i*4+1}/30`, speed: '25G', vlan: 'eCPRI to DU' },
        { name: 'mgmt', ip: `10.250.5.${i+1}/24`, vlan: 'O1/M-plane' },
      ],
      configLines: ['Low-PHY + RF', '64T64R mMIMO', 'digital beamforming', 'PTP slave G.8275.1'],
      services: ['RU', 'eCPRI', 'beamforming', 'PTP'],
      specs: 'n78 3.5GHz · 64T64R',
    },
  ))

  const nodes = [upf, gm, mh, cu, fh, ...dus, ...rus]

  const links: LLDLink[] = [
    mkLink('ptpgm', 'mh1', 'p1', 'Gi0/0/0/0', '1G', 'PTP G.8275.1', { isDashed: true, vlan: 'timing' }),
    mkLink('upf', 'mh1', 'N3', 'Gi0/0/0/0', '100G', 'N3 GTP-U', { subnet: '10.250.10.0/30' }),
    mkLink('mh1', 'cu1', 'Gi0/0/0/1', 'NG', '100G', 'F1/NG SR-MPLS', { subnet: '10.250.11.0/30' }),
    mkLink('cu1', 'fh1', 'F1-C/U', 'e1/49', '100G', 'F1-U/C', { subnet: '10.250.12.0/30' }),
    mkLink('mh1', 'fh1', 'Gi0/0/0/1', 'e1/50', '100G', 'PTP TC / SR', { isDashed: true, vlan: 'timing' }),
    ...dus.map((du, i) => mkLink('fh1', du.id, `e1/${i+1}`, 'eth0', '25G', 'eCPRI fronthaul', { subnet: `10.250.14.${i*4}/30` })),
    ...rus.map((ru, i) => mkLink(dus[Math.floor(i / Math.ceil(nRU / nDU))]?.id ?? dus[0].id, ru.id, 'ecpri', 'sfp0', '25G', 'eCPRI 7.2x', { subnet: `10.250.15.${i*4}/30` })),
  ]

  const cabling: CablingEntry[] = [
    ...rus.map((ru, i) => ({
      server: ru.hostname, serverPort: 'sfp0', ipv4: `10.250.15.${i*4+1}`,
      switchPort: `O-DU-0${Math.floor(i / Math.ceil(nRU / nDU)) + 1} ecpri`, mgmtPort: 'O1 M-plane', vlan: 'eCPRI',
    })),
    ...dus.map((du, i) => ({
      server: du.hostname, serverPort: 'eth0', ipv4: `10.250.4.${i+1}`,
      switchPort: `5G-FH-SW-01 e1/${i+1}`, mgmtPort: 'OOB', vlan: 'F1',
    })),
    { server: 'O-CU-01', serverPort: 'F1-C/U', ipv4: '10.250.2.1', switchPort: '5G-FH-SW-01 e1/49', mgmtPort: 'OOB', vlan: 'F1' },
  ]

  return {
    nodes, links, zones, cabling,
    title: `PRIVATE 5G / O-RAN LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: `5GC UPF · PTP GM · O-CU · ${nDU} O-DU · ${nRU} O-RU · eCPRI 7.2x · G.8275.1 timing`,
    svgH: 850,
  }
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
