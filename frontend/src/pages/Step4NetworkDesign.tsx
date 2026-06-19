import { useEffect, useMemo, useState, useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildBOM, buildCabling, computeTCO, validateBOM } from '@/lib/bom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { HLDTopologyDiagram } from '@/components/HLDTopologyDiagram'
import { LLDTopologyDiagram } from '@/components/LLDTopologyDiagram'
import { RackElevation } from '@/components/RackElevation'
import { formatUSD, cn } from '@/lib/utils'
import { haPairInfo, DCI_RT_ASN } from '@/lib/configgen'
import { genIPBlocks, genIPRows, genVLANs, genVNIs, buildNetBoxIpamExport } from '@/lib/ipam'
import { downloadDesignJSON, downloadDesignMarkdown, validateDesignImport, applyDesignImport } from '@/lib/design-export'
import { computeCapacityPlan } from '@/lib/capacity-planning'
import type { DesignExport } from '@/lib/design-export'
import type { BOMDevice, AppType, AppState } from '@/types'

// ── Tab types ────────────────────────────────────────────────────
type DesignTab = 'hld' | 'lld' | 'ipplan' | 'vlan' | 'routing' | 'physical' | 'rack' | 'mermaid' | 'simulate' | 'summary' | 'refdesigns'

const TAB_LABELS: Array<{ id: DesignTab; label: string }> = [
  { id: 'hld',        label: '📐 High Level Design' },
  { id: 'lld',        label: '📋 Low Level Design' },
  { id: 'ipplan',     label: '🌐 IP Plan' },
  { id: 'vlan',       label: '🏷 VLAN Design' },
  { id: 'routing',    label: '🔀 Routing & Protocols' },
  { id: 'physical',   label: '🔌 Physical Links' },
  { id: 'rack',       label: '🗄 Rack & Cabling' },
  { id: 'mermaid',    label: '📊 Mermaid Diagram' },
  { id: 'simulate',   label: '⚡ Simulate' },
  { id: 'summary',    label: '📋 Summary' },
  { id: 'refdesigns', label: '📚 Reference Designs' },
]

// ── Reference Designs data (M-24) ────────────────────────────────
interface RefDesign {
  title: string
  vendor: string
  description: string
  keyDecisions: string[]
  doc: string
}

const REF_DESIGNS: Record<string, RefDesign> = {
  campus: {
    title: 'Cisco CVD Campus LAN Design',
    vendor: 'Cisco',
    description: 'Hierarchical campus with access/distribution/core layers, 802.1X NAC, QoS marking at access',
    keyDecisions: ['STP with RSTP/MSTP', 'OSPF underlay', 'VSS/StackWise for core redundancy', 'RADIUS AAA'],
    doc: 'https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cvd-campus-lan-design.html',
  },
  dc: {
    title: 'Cisco NDFC Spine-Leaf DC Design',
    vendor: 'Cisco',
    description: 'BGP EVPN/VXLAN spine-leaf fabric with NX-OS, IS-IS underlay, ECMP, BFD',
    keyDecisions: ['IS-IS underlay', 'iBGP EVPN overlay', 'Anycast Gateway', 'ECMP 16-path', 'BFD 300ms'],
    doc: 'https://www.cisco.com/c/en/us/td/docs/dcn/whitepapers/cisco-ndfc-fabric-builder.html',
  },
  gpu: {
    title: 'NVIDIA Air GPU Fabric Design',
    vendor: 'NVIDIA',
    description: 'RoCEv2 lossless Ethernet fabric for GPU clusters, PFC priority 3, ECN/DCQCN, 400G',
    keyDecisions: ['PFC priority 3 no-drop', 'ECN DSCP marking', 'DCQCN congestion control', 'RDMA 60% BW'],
    doc: 'https://air.nvidia.com/guides/networking',
  },
  wan: {
    title: 'Juniper WAN SD-WAN/BGP Design',
    vendor: 'Juniper',
    description: 'Hub-spoke WAN with BGP route reflectors, MPLS/SR underlay, QoS per-application',
    keyDecisions: ['BGP route reflectors', 'MPLS/SR underlay', 'DSCP QoS 6-class', 'BFD 1s timers'],
    doc: 'https://www.juniper.net/documentation/us/en/software/junos/mpls/index.html',
  },
  multisite: {
    title: 'Arista AVD Multi-Site Design',
    vendor: 'Arista',
    description: 'Multi-site EVPN/VXLAN with DCI, BGP between sites, anycast gateway per site',
    keyDecisions: ['EVPN type-5 DCI routes', 'Per-site anycast GW', 'BGP between sites', 'PIM-SM multicast'],
    doc: 'https://avd.arista.com/4.x/docs/getting-started/multi-site.html',
  },
  multicloud: {
    title: 'Aviatrix Multi-Cloud Transit Design',
    vendor: 'Aviatrix',
    description: 'Multi-cloud transit hub with FQDN egress control, BGP to on-premises via AWS Transit GW',
    keyDecisions: ['Transit GW peering', 'FQDN egress filter', 'BGP to on-prem', 'High-performance encryption'],
    doc: 'https://docs.aviatrix.com/documentation/latest/network-design/multi-cloud-transit-design.html',
  },
}

const VENDOR_BADGE_COLORS: Record<string, string> = {
  Cisco:    'bg-blue-900/60 text-blue-300 border border-blue-700/30',
  NVIDIA:   'bg-green-900/60 text-green-300 border border-green-700/30',
  Juniper:  'bg-orange-900/60 text-orange-300 border border-orange-700/30',
  Arista:   'bg-teal-900/60 text-teal-300 border border-teal-700/30',
  Aviatrix: 'bg-purple-900/60 text-purple-300 border border-purple-700/30',
}

// ── Routing data generator ───────────────────────────────────────
interface BGPRow   { device: string; layer: string; asn: string; role: string; peers: string; af: string }
interface ProtoRow { proto: string; domain: string; config: string; timers: string; note: string }
interface OSPFRow  { area: string; devices: string; type: string; auth: string; timers: string; note: string }

function genRoutingData(useCase: string, underlayProtocol: string, overlayProtocols: string[], devices: BOMDevice[]) {
  const isDC     = useCase === 'dc' || useCase === 'multisite'
  const isCampus = useCase === 'campus'
  const isGPU    = useCase === 'gpu'
  const hasVXLAN = overlayProtocols.some(o => /vxlan/i.test(o))
  const hasMPLS  = overlayProtocols.some(o => /mpls/i.test(o))

  const bgpRows:   BGPRow[]   = []
  const protoRows: ProtoRow[] = []
  const ospfRows:  OSPFRow[]  = []

  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')

  if (isDC) {
    const af = hasVXLAN ? 'IPv4 Unicast, L2VPN EVPN' : hasMPLS ? 'IPv4 Unicast, VPNv4' : 'IPv4 Unicast'
    spines.slice(0, 4).forEach(d => {
      bgpRows.push({ device: d.hostname, layer: 'Spine', asn: '65000', role: 'eBGP Route Reflector', peers: leaves.map(l => l.hostname).slice(0, 4).join(', ') + (leaves.length > 4 ? '…' : ''), af })
    })
    leaves.slice(0, 6).forEach((d, i) => {
      bgpRows.push({ device: d.hostname, layer: 'Leaf', asn: `6500${i + 1}`, role: 'eBGP (dual-homed)', peers: spines.map(s => s.hostname).join(', '), af })
    })
    if (leaves.length > 6) bgpRows.push({ device: `+${leaves.length - 6} more leaves`, layer: 'Leaf', asn: '6500X', role: 'eBGP (dual-homed)', peers: 'Same spine peers', af })

    if (underlayProtocol === 'ospf') {
      ospfRows.push({ area: '0 (Backbone)', devices: `All ${spines.length} spines + ${leaves.length} leaves`, type: 'Normal', auth: 'MD5 / SHA-1', timers: '3s / Dead 9s', note: 'Point-to-point /31 links — no DR/BDR election' })
      protoRows.push({ proto: 'OSPF v2', domain: 'DC Underlay', config: 'Area 0 · /31 P2P links · Loopback0 /32 · BFD co-req', timers: '3s / Dead 9s', note: 'Loopbacks reachable → VTEP tunnels up' })
    }
    if (underlayProtocol === 'isis') {
      protoRows.push({ proto: 'IS-IS L2', domain: 'DC Underlay', config: 'NET 49.0001.xxxx · wide metrics · BFD · loopback0', timers: '3s / Dead 9s', note: 'All spines + leaves · loopback /32 redistribution' })
    }
    if (underlayProtocol === 'ebgp') {
      protoRows.push({ proto: 'eBGP Underlay', domain: 'DC Underlay', config: 'BGP unnumbered · multipath relax · BFD · 64-way ECMP', timers: '3s / Hold 9s', note: 'No IGP — pure BGP underlay + EVPN overlay' })
    }
    if (hasVXLAN) protoRows.push({ proto: 'BGP EVPN', domain: 'Overlay — VXLAN', config: 'Type-2 MAC-IP · Type-3 IMET · Type-5 IP Prefix · Anycast GW · per-tenant L3VNI', timers: '3s / Hold 9s', note: 'VNI 100000+ for L2 · VNI 999000+ for L3VRF' })
    if (hasMPLS)  protoRows.push({ proto: 'BGP + LDP/SR', domain: 'Overlay — MPLS', config: 'VPNv4/VPNv6 · SR-MPLS label stack · RSVP-TE optional', timers: '5s / Hold 15s', note: 'Per-VRF label · traffic-engineering paths' })
  }

  if (isCampus) {
    bgpRows.push({ device: 'CORE-01/02', layer: 'Core', asn: '65100', role: 'iBGP Route Reflector', peers: 'DIST-01..04, FW-01', af: 'IPv4 Unicast' })
    bgpRows.push({ device: 'FW-01', layer: 'Firewall', asn: '65200', role: 'eBGP upstream (ISP)', peers: 'ISP AS / MPLS PE', af: 'IPv4 Unicast, default' })
    if (underlayProtocol === 'ospf') {
      ospfRows.push({ area: '0 (Backbone)', devices: 'CORE-01, CORE-02, DIST-01..04', type: 'Normal', auth: 'MD5 Auth', timers: '10s / Dead 40s', note: 'All distribution & core links in Area 0' })
      ospfRows.push({ area: '1 (Access-Bldg-A)', devices: 'DIST-01, ACC-01, ACC-02', type: 'Stub', auth: 'MD5 Auth', timers: '10s / Dead 40s', note: 'Stub area — no external routes' })
      ospfRows.push({ area: '2 (Access-Bldg-B)', devices: 'DIST-02, ACC-03, ACC-04', type: 'Stub', auth: 'MD5 Auth', timers: '10s / Dead 40s', note: 'Stub area — default route only' })
      protoRows.push({ proto: 'OSPF v2', domain: 'Underlay — Campus', config: 'Process 1 · Areas 0,1,2 · Router-ID = Loopback0 · BFD', timers: '10s / Dead 40s', note: 'Area 0 backbone · stub areas at access' })
    }
    if (underlayProtocol === 'isis') {
      protoRows.push({ proto: 'IS-IS L2', domain: 'Underlay — Campus', config: 'Single area · wide metrics · loopback0 NET addr', timers: '3s / Dead 9s', note: 'Uncommon for campus — CVD recommends OSPF' })
    }
  }

  if (isGPU) {
    bgpRows.push({ device: 'GPU-SPINE-01/02', layer: 'Spine', asn: '65010', role: 'eBGP RR · ECMP 64-way', peers: 'All TOR switches', af: 'IPv4 Unicast' })
    leaves.slice(0, 4).forEach((d, i) => {
      bgpRows.push({ device: d.hostname, layer: 'GPU TOR', asn: `6501${i + 1}`, role: 'eBGP dual-homed', peers: 'GPU-SPINE-01, GPU-SPINE-02', af: 'IPv4 Unicast' })
    })
    protoRows.push({ proto: 'BGP (unnumbered)', domain: 'GPU Fabric', config: 'Unnumbered eBGP on P2P interfaces · no IP on fabric links · ECMP 64-way', timers: '1s / Hold 3s', note: 'GPU server loopbacks + storage subnets' })
    protoRows.push({ proto: 'PFC / ECN / DSCP', domain: 'RoCEv2 QoS', config: 'PFC on priority 3 (DSCP 26) · ECN threshold 150 KB · DCQCN · lossless queues', timers: 'QoS map', note: 'All GPU and storage-facing ports on TOR' })
  }

  return { bgpRows, protoRows, ospfRows }
}

// ── Computed topology (Enterprise Upgrade D1) ────────────────────
// Reflects the vPC/MLAG pairing (haPairInfo, A1-A3), FHRP gateways, and
// multisite DCI route-targets (A7) that configgen.ts now derives from the
// real BOM device list, so the design summary matches the generated configs.
export interface MlagPairSummary { pairId: number; primary: string; secondary: string; domainId: string }
export interface FhrpVipSummary  { pairId: number; vlan: string; name: string; vip: string; primary: string; secondary: string }
export interface DciSummary      { rtAsn: number; l2Rt: string; l3Rt: string; leaves: string[] }
export interface ComputedTopology {
  mlagPairs: MlagPairSummary[]
  fhrpVips: FhrpVipSummary[]
  dci: DciSummary | null
}

export function genComputedTopology(useCase: string, devices: BOMDevice[], appTypes: AppType[]): ComputedTopology {
  const isFabric = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu' || useCase === 'multicloud' || useCase === 'aviatrix'
  const isCampus = useCase === 'campus'

  const mlagPairs: MlagPairSummary[] = []
  const fhrpVips: FhrpVipSummary[] = []
  let dci: DciSummary | null = null

  if (isFabric) {
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    leaves.forEach((dev, idx) => {
      if (idx % 2 !== 0) return
      const peer = leaves[idx + 1]
      if (!peer) return
      const { pairId, domainId } = haPairInfo(dev, idx)
      mlagPairs.push({ pairId, primary: dev.hostname, secondary: peer.hostname, domainId })
    })
    if (useCase === 'multisite' && leaves.length > 0) {
      dci = {
        rtAsn: DCI_RT_ASN,
        l2Rt: `${DCI_RT_ASN}:10010`,
        l3Rt: `${DCI_RT_ASN}:50000`,
        leaves: leaves.map(l => l.hostname),
      }
    }
  }

  if (isCampus) {
    const dists = devices.filter(d => d.subLayer === 'distribution')
    const hasVoice = appTypes.includes('voice')
    dists.forEach((dev, idx) => {
      if (idx % 2 !== 0) return
      const peer = dists[idx + 1]
      if (!peer) return
      const { pairId, domainId } = haPairInfo(dev, idx)
      mlagPairs.push({ pairId, primary: dev.hostname, secondary: peer.hostname, domainId })
      fhrpVips.push({ pairId, vlan: '10', name: 'DATA', vip: `10.10.${pairId - 1}.1`, primary: dev.hostname, secondary: peer.hostname })
      if (hasVoice) {
        fhrpVips.push({ pairId, vlan: '20', name: 'VOICE', vip: `10.20.${pairId - 1}.1`, primary: dev.hostname, secondary: peer.hostname })
      }
    })
  }

  return { mlagPairs, fhrpVips, dci }
}

// ── CSV export helpers ───────────────────────────────────────────
function downloadCsv(content: string, baseName: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportLLDCSV(useCase: string, devices: BOMDevice[], totalEndpoints: number, numSites: number, underlayProtocol: string, overlayProtocols: string[]) {
  const sections: string[] = []

  // IP Plan
  const ipBlocks = genIPBlocks(useCase, totalEndpoints, numSites, devices)
  sections.push('IP PLAN')
  sections.push('Label,Subnet,Detail,Range')
  ipBlocks.forEach(b => sections.push(`"${b.label}","${b.subnet}","${b.detail}","${b.range}"`))
  sections.push('')

  // VLAN Design
  sections.push('VLAN DESIGN')
  sections.push('VLAN ID,Name,Subnet,Gateway,DHCP,Purpose,Layer')
  genVLANs(useCase).forEach(v => sections.push(`${v.id},"${v.name}","${v.subnet}","${v.gw}","${v.dhcp}","${v.purpose}","${v.layer}"`))
  sections.push('')

  // BGP/Routing
  const { bgpRows } = genRoutingData(useCase, underlayProtocol, overlayProtocols, devices)
  sections.push('BGP DESIGN')
  sections.push('Device,Layer,ASN,Role,Peers,Address Families')
  bgpRows.forEach(r => sections.push(`"${r.device}","${r.layer}","${r.asn}","${r.role}","${r.peers}","${r.af}"`))
  sections.push('')

  // Device list
  sections.push('DEVICE LIST')
  sections.push('Hostname,Role,Model,Vendor,Speed,Ports,Unit Cost')
  devices.forEach(d => sections.push(`"${d.hostname}","${d.subLayer}","${d.model}","${d.vendor}","${d.speed}","${d.ports}","${d.unitPrice}"`))

  const blob = new Blob([sections.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `lld-${useCase}-${new Date().toISOString().slice(0,10)}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ── Layer badge colors ───────────────────────────────────────────
const LAYER_BADGE: Record<string, string> = {
  spine: 'bg-blue-900/60 text-blue-300', leaf: 'bg-green-900/60 text-green-300',
  distribution: 'bg-cyan-900/60 text-cyan-300', access: 'bg-emerald-900/60 text-emerald-300',
  firewall: 'bg-red-900/60 text-red-300', 'wan-edge': 'bg-gray-700 text-gray-300',
  'cloud-transit': 'bg-blue-900/60 text-blue-300', 'cloud-gw': 'bg-teal-900/60 text-teal-300',
  Core: 'bg-purple-900/60 text-purple-300', Spine: 'bg-blue-900/60 text-blue-300',
  Leaf: 'bg-green-900/60 text-green-300', Distribution: 'bg-cyan-900/60 text-cyan-300',
  Firewall: 'bg-red-900/60 text-red-300', 'GPU TOR': 'bg-orange-900/60 text-orange-300',
}

const USE_CASE_LABELS: Record<string, string> = {
  campus: 'Campus / Enterprise', dc: 'Data Center Leaf-Spine',
  gpu: 'AI / GPU Cluster', wan: 'WAN / SD-WAN',
  multisite: 'Multi-Site DCI', multicloud: 'Multi-Cloud', aviatrix: 'Aviatrix Overlay',
}

// ── Physical Links helpers (M-23) ────────────────────────────────
interface CableRow {
  from: string; to: string; port: string; speed: string
  cableType: string; sfp: string; lengthM: string
}

function genPhysicalLinks(useCase: string, devices: BOMDevice[]): CableRow[] {
  const rows: CableRow[] = []
  const isDC     = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu'
  const isCampus = useCase === 'campus'

  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const dists  = devices.filter(d => d.subLayer === 'distribution')
  const access = devices.filter(d => d.subLayer === 'access')
  const fws    = devices.filter(d => d.subLayer === 'firewall')

  if (isDC) {
    // Leaf-Spine links
    const showLeaves = leaves.slice(0, 8)
    showLeaves.forEach(leaf => {
      spines.slice(0, 4).forEach((spine, si) => {
        rows.push({
          from: leaf.hostname,
          to: spine.hostname,
          port: `Eth1/${si + 49}`,
          speed: '100G',
          cableType: 'DAC / Fiber OM4',
          sfp: 'QSFP-100G-SR4',
          lengthM: '3m',
        })
      })
    })
    if (leaves.length > 8) {
      rows.push({ from: `+${leaves.length - 8} more leaves`, to: 'all spines', port: 'Eth1/49–52', speed: '100G', cableType: 'DAC / OM4', sfp: 'QSFP-100G-SR4', lengthM: '3m' })
    }

    // Server-Leaf links (simulated servers)
    const showLeaves2 = leaves.slice(0, 4)
    showLeaves2.forEach(leaf => {
      for (let sv = 1; sv <= 2; sv++) {
        rows.push({
          from: `${leaf.hostname.replace('LEAF', 'SRV')}-${String(sv).padStart(2, '0')}`,
          to: leaf.hostname,
          port: `Eth1/${sv}`,
          speed: '25G / 10G',
          cableType: 'Fiber OM3',
          sfp: 'SFP-10G-SR',
          lengthM: '10m',
        })
      }
    })

    // Firewall-Spine links
    fws.forEach((fw, fi) => {
      spines.slice(0, 2).forEach((spine, si) => {
        rows.push({
          from: fw.hostname,
          to: spine.hostname,
          port: `Eth1/${si + 1}`,
          speed: '100G',
          cableType: 'Fiber OS2',
          sfp: 'QSFP-100G-LR4',
          lengthM: `${(fi + 1) * 5}m`,
        })
      })
    })
  }

  if (isCampus) {
    // Access-Distribution links
    const showAccess = access.slice(0, 8)
    showAccess.forEach((acc, ai) => {
      dists.slice(0, 2).forEach((dist, di) => {
        rows.push({
          from: acc.hostname,
          to: dist.hostname,
          port: `Gi0/${di + 1}`,
          speed: '1G / 10G',
          cableType: 'Cat6A (copper)',
          sfp: 'SFP+ / RJ-45',
          lengthM: `${50 + (ai % 3) * 30}m`,
        })
      })
    })
    if (access.length > 8) {
      rows.push({ from: `+${access.length - 8} more access`, to: 'dist switches', port: 'Gi0/1–2', speed: '10G', cableType: 'Cat6A', sfp: 'SFP+ / RJ-45', lengthM: '≤100m' })
    }

    // Dist-Core (or dist-spine) links
    dists.forEach((dist, di) => {
      spines.slice(0, 2).forEach((sp, si) => {
        rows.push({
          from: dist.hostname,
          to: sp.hostname,
          port: `Te0/${si + 1}`,
          speed: '40G',
          cableType: 'Fiber OM4',
          sfp: '40G QSFP+',
          lengthM: `${(di + 1) * 20}m`,
        })
      })
    })

    // Firewall-Dist links
    fws.forEach((fw, fi) => {
      dists.slice(0, 2).forEach((dist, di) => {
        rows.push({
          from: fw.hostname,
          to: dist.hostname,
          port: `Gi0/${di + fi * 2}`,
          speed: '10G',
          cableType: 'Fiber OM3',
          sfp: 'SFP-10G-SR',
          lengthM: '5m',
        })
      })
    })
  }

  return rows
}

// ── Mermaid Diagram helpers (M-25) ──────────────────────────────
function genMermaidDiagram(useCase: string, devices: BOMDevice[], trafficPattern: string): string {
  const isEW = trafficPattern === 'ew' || useCase === 'dc' || useCase === 'gpu'
  const dir  = isEW ? 'graph LR' : 'graph TD'

  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const dists  = devices.filter(d => d.subLayer === 'distribution')
  const access = devices.filter(d => d.subLayer === 'access')
  const fws    = devices.filter(d => d.subLayer === 'firewall')
  const wans   = devices.filter(d => d.subLayer === 'wan-edge')

  const lines: string[] = [dir, '']

  // Node definitions
  if (fws.length > 0) {
    lines.push('  %% Firewalls')
    fws.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🔥 ${d.hostname}\\n${d.model}"]`))
    lines.push('')
  }
  if (spines.length > 0) {
    lines.push('  %% Spines / Core')
    spines.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🔵 ${d.hostname}\\n${d.model}"]`))
    lines.push('')
  }
  if (leaves.length > 0) {
    const show = leaves.slice(0, 8)
    lines.push('  %% Leaf / Distribution')
    show.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🟢 ${d.hostname}\\n${d.model}"]`))
    if (leaves.length > 8) {
      lines.push(`  LEAVES_MORE["… +${leaves.length - 8} more leaves"]`)
    }
    lines.push('')
  }
  if (dists.length > 0 && leaves.length === 0) {
    lines.push('  %% Distribution')
    dists.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🔷 ${d.hostname}\\n${d.model}"]`))
    lines.push('')
  }
  if (access.length > 0) {
    const show = access.slice(0, 6)
    lines.push('  %% Access')
    show.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🟡 ${d.hostname}\\n${d.model}"]`))
    if (access.length > 6) {
      lines.push(`  ACCESS_MORE["… +${access.length - 6} more access"]`)
    }
    lines.push('')
  }
  if (wans.length > 0) {
    lines.push('  %% WAN Edge')
    wans.forEach(d => lines.push(`  ${sanitizeId(d.hostname)}["🌐 ${d.hostname}\\n${d.model}"]`))
    lines.push('')
  }

  // Virtual endpoint nodes
  if (leaves.length > 0) {
    lines.push('  SERVERS["💻 Servers / Endpoints"]')
    lines.push('')
  } else if (access.length > 0) {
    lines.push('  ENDPOINTS["💻 Users / Endpoints"]')
    lines.push('')
  }

  // Edges: FW → Spine
  fws.forEach(fw => {
    spines.forEach(sp => {
      lines.push(`  ${sanitizeId(fw.hostname)} -->|100G| ${sanitizeId(sp.hostname)}`)
    })
  })

  // Edges: Spine → Leaf
  spines.forEach(sp => {
    leaves.slice(0, 8).forEach(lf => {
      lines.push(`  ${sanitizeId(sp.hostname)} -->|100G| ${sanitizeId(lf.hostname)}`)
    })
    if (leaves.length > 8) {
      lines.push(`  ${sanitizeId(sp.hostname)} -->|100G| LEAVES_MORE`)
    }
  })

  // Edges: Spine/Core → Dist (campus)
  if (leaves.length === 0) {
    spines.forEach(sp => {
      dists.forEach(d => {
        lines.push(`  ${sanitizeId(sp.hostname)} -->|40G| ${sanitizeId(d.hostname)}`)
      })
    })
    dists.forEach(d => {
      access.slice(0, 6).forEach(ac => {
        lines.push(`  ${sanitizeId(d.hostname)} -->|10G| ${sanitizeId(ac.hostname)}`)
      })
      if (access.length > 6) lines.push(`  ${sanitizeId(d.hostname)} -->|10G| ACCESS_MORE`)
    })
    if (access.length > 0) {
      access.slice(0, 6).forEach(ac => {
        lines.push(`  ${sanitizeId(ac.hostname)} -->|1G| ENDPOINTS`)
      })
      if (access.length > 6) lines.push(`  ACCESS_MORE -->|1G| ENDPOINTS`)
    }
  } else {
    // Leaf → Servers
    leaves.slice(0, 8).forEach(lf => {
      lines.push(`  ${sanitizeId(lf.hostname)} -->|25G| SERVERS`)
    })
    if (leaves.length > 8) lines.push(`  LEAVES_MORE -->|25G| SERVERS`)
  }

  // WAN edge → FW or Spine
  wans.forEach(w => {
    if (fws.length > 0) lines.push(`  ${sanitizeId(w.hostname)} -->|WAN| ${sanitizeId(fws[0].hostname)}`)
    else if (spines.length > 0) lines.push(`  ${sanitizeId(w.hostname)} -->|WAN| ${sanitizeId(spines[0].hostname)}`)
  })

  return lines.join('\n')
}

function sanitizeId(hostname: string): string {
  return hostname.replace(/[^a-zA-Z0-9_]/g, '_')
}

// ── Simulate helpers (M-26) ──────────────────────────────────────
interface ReachabilityEntry { from: string; to: string; reachable: boolean; path: string }
interface RoutePropRow { device: string; prefix: string; nextHop: string; protocol: string; metric: string }

function getTopDevices(devices: BOMDevice[], n = 6): BOMDevice[] {
  // Priority order: firewall > spine > leaf > distribution > access > others
  const order: Record<string, number> = { firewall: 0, spine: 1, leaf: 2, distribution: 3, access: 4 }
  const sorted = [...devices].sort((a, b) => (order[a.subLayer] ?? 9) - (order[b.subLayer] ?? 9))
  return sorted.slice(0, n)
}

function simulateFailure(failedDevice: BOMDevice, allDevices: BOMDevice[], useCase: string): { affected: string[]; vlans: number[]; convergenceMs: number } {
  const isSpine   = failedDevice.subLayer === 'spine'
  const isLeaf    = failedDevice.subLayer === 'leaf'
  const isFirewall= failedDevice.subLayer === 'firewall'
  const isDC      = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu'

  const spineCount = allDevices.filter(d => d.subLayer === 'spine').length

  let affected: string[] = []
  let vlans: number[] = []
  let convergenceMs = 500

  if (isSpine) {
    // If only 1 spine left after failure, traffic disrupted
    if (spineCount <= 1) {
      affected = allDevices.filter(d => d.subLayer === 'leaf').map(d => d.hostname)
      vlans = [100, 101, 200, 30, 20]
    } else {
      affected = [`ECMP reduced from ${spineCount} to ${spineCount - 1} paths`]
      vlans = []
    }
    convergenceMs = isDC ? 150 : 800
  } else if (isLeaf) {
    affected = [`Servers connected to ${failedDevice.hostname}`, `VLANs on ${failedDevice.hostname}`]
    vlans = [100, 101]
    convergenceMs = isDC ? 200 : 600
  } else if (isFirewall) {
    affected = ['All internet-bound traffic', 'Default-route dependent subnets']
    vlans = [60, 21]
    convergenceMs = 2000
  } else {
    affected = [`Devices connected to ${failedDevice.hostname}`]
    vlans = [20, 30]
    convergenceMs = 300
  }

  // HA: if spare exists, convergence is fast
  const spareExists = allDevices.some(d => d.subLayer === failedDevice.subLayer && d.id !== failedDevice.id)
  if (spareExists) convergenceMs = Math.min(convergenceMs, 300)

  return { affected, vlans, convergenceMs }
}

function genReachabilityMatrix(topDevices: BOMDevice[], failedId: string | null): ReachabilityEntry[] {
  const entries: ReachabilityEntry[] = []
  for (const src of topDevices) {
    for (const dst of topDevices) {
      if (src.id === dst.id) continue
      const srcFailed = src.id === failedId
      const dstFailed = dst.id === failedId
      const reachable = !srcFailed && !dstFailed
      const path = srcFailed || dstFailed
        ? '—'
        : `${src.subLayer} → ${dst.subLayer}`
      entries.push({ from: src.hostname, to: dst.hostname, reachable, path })
    }
  }
  return entries
}

function genRoutePropagation(devices: BOMDevice[], useCase: string, underlayProtocol: string): RoutePropRow[] {
  const isDC = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu'
  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const rows: RoutePropRow[] = []

  const samplePrefix = isDC ? '10.255.2.1/32' : '10.0.0.1/32'
  const proto = isDC ? (underlayProtocol === 'isis' ? 'IS-IS' : 'eBGP') : 'OSPF'
  const metric = isDC ? 'MED 0' : 'Cost 10'

  if (leaves.length > 0) {
    rows.push({ device: leaves[0].hostname, prefix: samplePrefix, nextHop: 'Connected', protocol: 'Direct', metric: '0' })
    spines.slice(0, 2).forEach((sp, i) => {
      rows.push({ device: sp.hostname, prefix: samplePrefix, nextHop: `10.100.0.${i * 2}`, protocol: proto, metric })
    })
    if (leaves.length > 1) {
      rows.push({ device: leaves[1].hostname, prefix: samplePrefix, nextHop: spines[0]?.hostname ?? 'spine', protocol: proto, metric })
    }
  }

  if (isDC) {
    rows.push({ device: 'EVPN Control Plane', prefix: 'Type-5 route: ' + samplePrefix, nextHop: 'L3VNI 999000', protocol: 'BGP EVPN', metric: 'RT 65000:9000' })
  }

  return rows
}

// ── Summary helpers (M-27) ──────────────────────────────────────
function buildSummaryText(
  useCase: string, scale: string, siteCode: string, numSites: number,
  totalEndpoints: number, underlayProtocol: string, overlayProtocols: string[],
  protoFeatures: string[], compliance: string[], devices: BOMDevice[], grandTotal: number,
  computedTopology: ComputedTopology
): string {
  const label = USE_CASE_LABELS[useCase] || useCase || '—'
  const devLines = Object.values(
    devices.reduce<Record<string, { subLayer: string; count: number; model: string }>>((acc, d) => {
      const k = d.subLayer
      if (!acc[k]) acc[k] = { subLayer: d.subLayer, count: 0, model: d.model }
      acc[k].count += d.count
      return acc
    }, {})
  )

  const lines = [
    '╔══════════════════════════════════════════════╗',
    '║        NetDesign AI — Design Summary          ║',
    '╚══════════════════════════════════════════════╝',
    '',
    '── INTENT ──',
    `Use Case    : ${label}`,
    `Scale       : ${scale.charAt(0).toUpperCase() + scale.slice(1)}`,
    `Site Code   : ${siteCode || '—'}`,
    `Sites       : ${numSites}`,
    `Endpoints   : ${totalEndpoints}`,
    '',
    '── TOPOLOGY ──',
    `Underlay    : ${underlayProtocol.toUpperCase()}`,
    `Overlay     : ${overlayProtocols.join(', ') || 'none'}`,
    `Features    : ${protoFeatures.length ? protoFeatures.join(', ') : 'none'}`,
    '',
    '── BOM SUMMARY ──',
    ...devLines.map(d => `  ${d.subLayer.padEnd(16)}: ${String(d.count).padStart(3)} × ${d.model}`),
    `  ${'TOTAL DEVICES'.padEnd(16)}: ${devices.reduce((s, d) => s + d.count, 0)}`,
    `  Est. Cost       : $${grandTotal.toLocaleString()}`,
    '',
    ...(computedTopology.mlagPairs.length > 0 || computedTopology.dci ? [
      '── COMPUTED TOPOLOGY (D1) ──',
      ...computedTopology.mlagPairs.map(p => `  vPC/MLAG Pair #${p.pairId}  : ${p.primary} <-> ${p.secondary} (domain ${p.domainId})`),
      ...computedTopology.fhrpVips.map(v => `  HSRP Vlan${v.vlan}/${v.name} VIP : ${v.vip}  (pair #${v.pairId}: ${v.primary}/${v.secondary})`),
      ...(computedTopology.dci ? [
        `  EVPN DCI RTs (ASN ${computedTopology.dci.rtAsn}) : L2 ${computedTopology.dci.l2Rt} · L3 ${computedTopology.dci.l3Rt}`,
        `  DCI-stretched leaves : ${computedTopology.dci.leaves.join(', ')}`,
      ] : []),
      '',
    ] : []),
    '── COMPLIANCE ──',
    compliance.length ? compliance.map(c => `  ✓ ${c}`).join('\n') : '  None selected',
    '',
    `Generated by NetDesign AI — ${new Date().toISOString().slice(0, 10)}`,
  ]
  return lines.join('\n')
}

export function Step4NetworkDesign() {
  const {
    useCase, scale, siteCode, numSites, linkDistances,
    underlayProtocol, overlayProtocols, protoFeatures, redundancyModel,
    totalEndpoints, bandwidthPerServer, oversubscription,
    trafficPattern, firewallModel, compliance, vendorPrefs, appTypes,
    devices, setDevices, nextStep, prevStep,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState<DesignTab>('hld')
  const [failedDeviceId, setFailedDeviceId] = useState<string | null>(null)
  const [summaryCopied, setSummaryCopied] = useState(false)
  const [mermaidCopied, setMermaidCopied] = useState(false)
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const svgRef = useRef<HTMLDivElement>(null)

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription, vendorPrefs, trafficPattern, firewallModel, overlayProtocols, numSites }),
    [useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription, vendorPrefs, trafficPattern, firewallModel, overlayProtocols, numSites]
  )

  useEffect(() => { setDevices(generatedDevices) }, [generatedDevices, setDevices])

  const bomIssues = useMemo(
    () => validateBOM(generatedDevices, { useCase, totalEndpoints, bandwidthPerServer, oversubscription }),
    [generatedDevices, useCase, totalEndpoints, bandwidthPerServer, oversubscription]
  )

  const useCaseLabel = (useCase && USE_CASE_LABELS[useCase]) || useCase || '—'
  const uniqueModels = Object.values(summary).length
  const scaleLabel   = scale ? scale.charAt(0).toUpperCase() + scale.slice(1) : '—'

  // Derived data for tabs
  const ipBlocks  = useMemo(() => genIPBlocks(useCase, totalEndpoints, numSites, generatedDevices), [useCase, totalEndpoints, numSites, generatedDevices])
  const ipRows    = useMemo(() => genIPRows(useCase, generatedDevices), [useCase, generatedDevices])
  const vlans     = useMemo(() => genVLANs(useCase), [useCase])
  const vnis      = useMemo(() => genVNIs(), [])
  const isDC      = useCase === 'dc' || useCase === 'multisite'
  const routing   = useMemo(() => genRoutingData(useCase, underlayProtocol, overlayProtocols, generatedDevices), [useCase, underlayProtocol, overlayProtocols, generatedDevices])

  // M-23: Physical Links
  const physicalLinks = useMemo(() => genPhysicalLinks(useCase, generatedDevices), [useCase, generatedDevices])

  // G-A14: Cabling for Rack & Cable tab
  const cablingData = useMemo(() => buildCabling(generatedDevices, linkDistances), [generatedDevices, linkDistances])

  // M-25: Mermaid Diagram
  const mermaidCode = useMemo(() => genMermaidDiagram(useCase, generatedDevices, trafficPattern), [useCase, generatedDevices, trafficPattern])

  // M-26: Simulate
  const topDevices = useMemo(() => getTopDevices(generatedDevices, 6), [generatedDevices])
  const failedDevice = failedDeviceId ? generatedDevices.find(d => d.id === failedDeviceId) ?? null : null
  const failureSim   = useMemo(
    () => failedDevice ? simulateFailure(failedDevice, generatedDevices, useCase) : null,
    [failedDevice, generatedDevices, useCase]
  )
  const reachMatrix = useMemo(() => genReachabilityMatrix(topDevices, failedDeviceId), [topDevices, failedDeviceId])
  const routeProp   = useMemo(() => genRoutePropagation(generatedDevices, useCase, underlayProtocol), [generatedDevices, useCase, underlayProtocol])

  // D1: Computed topology — vPC/MLAG pairs, FHRP gateways, multisite DCI route-targets
  const computedTopology = useMemo(
    () => genComputedTopology(useCase, generatedDevices, appTypes),
    [useCase, generatedDevices, appTypes]
  )

  // G-A13: 3-year TCO model (capex + power + support + rack/colo)
  const tco = useMemo(() => computeTCO(generatedDevices), [generatedDevices])

  // H3: Capacity planning
  const [growthRate, setGrowthRate] = useState(20)
  const capacityPlan = useMemo(
    () => computeCapacityPlan(generatedDevices, totalEndpoints, growthRate / 100, 5),
    [generatedDevices, totalEndpoints, growthRate]
  )

  // M-27: Summary
  const summaryText = useMemo(
    () => buildSummaryText(useCase, scale, siteCode, numSites, totalEndpoints, underlayProtocol, overlayProtocols, protoFeatures, compliance, generatedDevices, grandTotal, computedTopology),
    [useCase, scale, siteCode, numSites, totalEndpoints, underlayProtocol, overlayProtocols, protoFeatures, compliance, generatedDevices, grandTotal, computedTopology]
  )

  function handleExportSVG() {
    const svgEl = svgRef.current?.querySelector('svg')
    if (!svgEl) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svgEl)
    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `hld-${useCase || 'topology'}-${new Date().toISOString().slice(0,10)}.svg`
    a.click(); URL.revokeObjectURL(url)
  }

  function handleExportCSV() {
    exportLLDCSV(useCase, generatedDevices, totalEndpoints, numSites, underlayProtocol, overlayProtocols)
  }

  const thCls = 'px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider'
  const tdCls = 'px-4 py-2 text-sm'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Network Design</h2>
          <p className="text-sm text-gray-400">Auto-generated HLD topology, IP plan, VLAN design and routing tables</p>
        </div>
        {/* Export action bar */}
        <div className="flex gap-2 shrink-0">
          <button onClick={handleExportSVG}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
            ⬇ HLD (SVG)
          </button>
          <button onClick={handleExportCSV}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
            ⬇ LLD (CSV)
          </button>
          <button onClick={() => window.print()}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
            🖨 Print
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="text-center">
          <div className="text-xl font-bold text-blue-400">{generatedDevices.length}</div>
          <div className="text-xs text-gray-500 mt-1">Devices</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-purple-400">{uniqueModels}</div>
          <div className="text-xs text-gray-500 mt-1">Unique Models</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-green-400">{formatUSD(grandTotal)}</div>
          <div className="text-xs text-gray-500 mt-1">Est. Hardware Cost</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-orange-400">{scaleLabel}</div>
          <div className="text-xs text-gray-500 mt-1">Scale</div>
        </Card>
      </div>

      {/* BOM design validation */}
      {bomIssues.length > 0 && (
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300">Design Validation</h3>
          {bomIssues.map((issue, idx) => (
            <div key={idx} className={cn(
              'flex items-start gap-2 text-xs rounded px-3 py-2',
              issue.severity === 'error'   && 'bg-red-900/30 text-red-300',
              issue.severity === 'warning' && 'bg-yellow-900/30 text-yellow-300',
              issue.severity === 'info'    && 'bg-blue-900/30 text-blue-300',
            )}>
              <span className="font-bold uppercase shrink-0">{issue.severity}</span>
              <span>{issue.message}</span>
            </div>
          ))}
        </Card>
      )}

      {/* Design tab bar */}
      <div className="flex gap-0 border-b border-white/10 overflow-x-auto">
        {TAB_LABELS.map(t => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap',
              activeTab === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── HLD tab ─────────────────────────────────────────────────── */}
      {activeTab === 'hld' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-300">High Level Design — Topology</h3>
              <p className="text-xs text-gray-600 mt-0.5">
                All layers interlinked · click a device for details · select a flow to animate packet path
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExportSVG}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                ⬇ SVG
              </button>
              <button onClick={() => setDevices(generatedDevices)}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                ↺ Regenerate
              </button>
            </div>
          </div>
          <div ref={svgRef}>
            <HLDTopologyDiagram
              devices={generatedDevices}
              useCase={useCase}
              underlayProtocol={underlayProtocol}
              overlayProtocols={overlayProtocols}
              siteCode={siteCode}
            />
          </div>
        </Card>
      )}

      {/* ── LLD tab ────────────────────────────────────────────────── */}
      {activeTab === 'lld' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-purple-300">Low Level Design — Port-level detail</h3>
              <p className="text-xs text-gray-500 mt-1">IP addresses, interface mappings, VLANs, config snippets, and physical cabling matrix</p>
            </div>
          </div>
          <LLDTopologyDiagram
            devices={generatedDevices}
            useCase={useCase}
            siteCode={siteCode}
          />
        </Card>
      )}

      {/* ── IP Plan tab ──────────────────────────────────────────────── */}
      {activeTab === 'ipplan' && (
        <div className="space-y-4">
          {/* NetBox IPAM export */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-300">NetBox / Nautobot IPAM Export</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Bulk-import CSVs for IPAM source-of-truth sync (prefixes, VLANs, IP addresses).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => {
                  const x = buildNetBoxIpamExport(useCase, totalEndpoints, numSites, generatedDevices)
                  downloadCsv(x.prefixesCsv, `netbox-prefixes-${useCase || 'network'}`)
                }}>↓ Prefixes CSV</Button>
                <Button variant="secondary" onClick={() => {
                  const x = buildNetBoxIpamExport(useCase, totalEndpoints, numSites, generatedDevices)
                  downloadCsv(x.vlansCsv, `netbox-vlans-${useCase || 'network'}`)
                }}>↓ VLANs CSV</Button>
                <Button variant="secondary" onClick={() => {
                  const x = buildNetBoxIpamExport(useCase, totalEndpoints, numSites, generatedDevices)
                  downloadCsv(x.ipAddressesCsv, `netbox-ip-addresses-${useCase || 'network'}`)
                }}>↓ IP Addresses CSV</Button>
              </div>
            </div>
          </Card>
          {/* IP block cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ipBlocks.map(b => (
              <div key={b.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">{b.label}</div>
                <div className="text-base font-mono font-bold text-white mb-1">{b.subnet}</div>
                <div className="text-xs text-gray-400 mb-1">{b.detail}</div>
                <div className="text-xs text-gray-500 font-mono">{b.range}</div>
              </div>
            ))}
          </div>
          {/* Per-device IP table */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Per-Device IP Assignment</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Layer', 'Interface', 'IP Address', 'Prefix', 'Purpose'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ipRows.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className={`${tdCls} font-semibold text-gray-100 font-mono`}>{r.device}</td>
                      <td className={tdCls}>
                        <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', LAYER_BADGE[r.layer] ?? 'bg-gray-700 text-gray-300')}>{r.layer}</span>
                      </td>
                      <td className={`${tdCls} font-mono text-xs text-blue-300`}>{r.iface}</td>
                      <td className={`${tdCls} font-mono text-green-400`}>{r.ip}</td>
                      <td className={`${tdCls} font-mono text-gray-400`}>{r.prefix}</td>
                      <td className={`${tdCls} text-gray-400 text-xs`}>{r.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── VLAN Design tab ──────────────────────────────────────────── */}
      {activeTab === 'vlan' && (
        <div className="space-y-4">
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">VLAN Design</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['VLAN ID', 'Name', 'Subnet', 'Gateway', 'DHCP Range', 'Purpose', 'Layer'].map(h => (
                      <th key={h} className={thCls}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vlans.map(v => (
                    <tr key={v.id} className="border-b border-white/5">
                      <td className={`${tdCls} font-bold text-orange-400`}>{v.id}</td>
                      <td className={`${tdCls} font-semibold text-gray-100`}>{v.name}</td>
                      <td className={`${tdCls} font-mono text-xs text-blue-300`}>{v.subnet}</td>
                      <td className={`${tdCls} font-mono text-xs text-green-400`}>{v.gw}</td>
                      <td className={`${tdCls} font-mono text-xs text-gray-400`}>{v.dhcp}</td>
                      <td className={`${tdCls} text-gray-300 text-xs`}>{v.purpose}</td>
                      <td className={tdCls}>
                        <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', LAYER_BADGE[v.layer] ?? 'bg-gray-700 text-gray-300')}>{v.layer}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {isDC && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">VNI Table (VXLAN/EVPN)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['VNI', 'VLAN', 'Type', 'VRF', 'IRB / Anycast GW', 'Route-Target'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vnis.map(v => (
                      <tr key={v.vni} className="border-b border-white/5">
                        <td className={`${tdCls} font-mono font-bold text-orange-400`}>{v.vni}</td>
                        <td className={`${tdCls} text-gray-300`}>{v.vlan}</td>
                        <td className={tdCls}>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-900/60 text-green-300">{v.type}</span>
                        </td>
                        <td className={`${tdCls} text-gray-200`}>{v.vrf}</td>
                        <td className={`${tdCls} font-mono text-xs text-blue-300`}>{v.irb}</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{v.rt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Routing & Protocols tab ──────────────────────────────────── */}
      {activeTab === 'routing' && (
        <div className="space-y-4">
          {/* BGP Peer table */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">BGP Peer Design</h3>
            {routing.bgpRows.length === 0 ? (
              <p className="text-sm text-gray-500">BGP not selected as underlay — see protocol summary below.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Device', 'Layer', 'ASN', 'BGP Role', 'Peers', 'Address Families'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routing.bgpRows.map((r, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className={`${tdCls} font-semibold text-gray-100 font-mono`}>{r.device}</td>
                        <td className={tdCls}><span className={cn('px-2 py-0.5 rounded text-xs font-semibold', LAYER_BADGE[r.layer] ?? 'bg-gray-700 text-gray-300')}>{r.layer}</span></td>
                        <td className={tdCls}><span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-900/50 text-blue-300 font-mono">{r.asn}</span></td>
                        <td className={`${tdCls} text-gray-300`}>{r.role}</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.peers}</td>
                        <td className={`${tdCls} text-xs text-gray-400`}>{r.af}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Protocol summary */}
          {routing.protoRows.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Protocol Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Protocol', 'Domain', 'Configuration', 'Timers', 'Notes'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routing.protoRows.map((r, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className={`${tdCls} font-bold text-blue-300`}>{r.proto}</td>
                        <td className={`${tdCls} text-gray-300`}>{r.domain}</td>
                        <td className={`${tdCls} text-xs text-gray-400`}>{r.config}</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.timers}</td>
                        <td className={`${tdCls} text-xs text-gray-500`}>{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* OSPF areas */}
          {routing.ospfRows.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">OSPF Area Design</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Area', 'Devices', 'Type', 'Auth', 'Timers', 'Notes'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routing.ospfRows.map((r, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className={tdCls}><span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-900/50 text-purple-300">Area {r.area}</span></td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.devices}</td>
                        <td className={`${tdCls} text-gray-300`}>{r.type}</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.auth}</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.timers}</td>
                        <td className={`${tdCls} text-xs text-gray-500`}>{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Physical Links tab (M-23) ──────────────────────────────── */}
      {activeTab === 'physical' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Cabling Schedule</h3>
              <span className="text-xs text-gray-500">{physicalLinks.length} cable runs</span>
            </div>
            {physicalLinks.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No physical links generated for this use case. Select a DC or Campus use case.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['From Device', 'To Device', 'Port', 'Speed', 'Cable Type', 'SFP / QSFP', 'Length'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {physicalLinks.map((r, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className={`${tdCls} font-semibold text-gray-100 font-mono text-xs`}>{r.from}</td>
                        <td className={`${tdCls} font-semibold text-gray-100 font-mono text-xs`}>{r.to}</td>
                        <td className={`${tdCls} font-mono text-xs text-blue-300`}>{r.port}</td>
                        <td className={tdCls}>
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-900/50 text-purple-300">{r.speed}</span>
                        </td>
                        <td className={`${tdCls} text-gray-300 text-xs`}>{r.cableType}</td>
                        <td className={`${tdCls} font-mono text-xs text-green-400`}>{r.sfp}</td>
                        <td className={`${tdCls} font-mono text-xs text-orange-400`}>{r.lengthM}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <div className="rounded-xl border border-white/10 bg-blue-950/20 p-4 text-xs text-blue-300 space-y-1">
            <div className="font-semibold mb-2">Cable Type Guide</div>
            <div>• <span className="text-white">QSFP-100G-SR4</span> — 100G multi-mode OM4 fiber, up to 100m (leaf-spine links)</div>
            <div>• <span className="text-white">SFP-10G-SR</span> — 10G multi-mode OM3 fiber, up to 300m (server-leaf links)</div>
            <div>• <span className="text-white">40G QSFP+</span> — 40G multi-mode OM4 fiber (dist-core campus links)</div>
            <div>• <span className="text-white">Cat6A</span> — copper 10GbE, up to 100m (access-distribution campus)</div>
            <div>• <span className="text-white">QSFP-100G-LR4</span> — 100G single-mode OS2 fiber, up to 10km (FW-spine, inter-DC)</div>
          </div>
        </div>
      )}

      {/* ── Rack & Cabling tab (G-A14) ──────────────────────────────── */}
      {activeTab === 'rack' && (
        <Card>
          <RackElevation devices={generatedDevices} cabling={cablingData} siteCode={siteCode} />
        </Card>
      )}

      {/* ── Mermaid Diagram tab (M-25) ──────────────────────────────── */}
      {activeTab === 'mermaid' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-300">Mermaid Topology Diagram</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(mermaidCode).then(() => {
                      setMermaidCopied(true)
                      setTimeout(() => setMermaidCopied(false), 2000)
                    })
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                  {mermaidCopied ? '✓ Copied!' : '📋 Copy'}
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([mermaidCode], { type: 'text/plain' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `topology-${useCase || 'network'}-${new Date().toISOString().slice(0, 10)}.mmd`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                  ⬇ Download .mmd
                </button>
              </div>
            </div>
            <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre leading-relaxed">{mermaidCode}</pre>
          </Card>
          <div className="rounded-xl border border-white/10 bg-green-950/20 p-4 text-xs text-green-300 space-y-1">
            <div className="font-semibold mb-2">How to render this diagram</div>
            <div>1. Copy the code above (📋 Copy button)</div>
            <div>2. Open <span className="text-white underline cursor-pointer" onClick={() => window.open('https://mermaid.live', '_blank')}>mermaid.live</span> in a new tab</div>
            <div>3. Paste the code in the editor — the diagram renders instantly</div>
            <div>4. Export as SVG, PNG, or share a permalink</div>
          </div>
        </div>
      )}

      {/* ── Simulate tab (M-26) ─────────────────────────────────────── */}
      {activeTab === 'simulate' && (
        <div className="space-y-4">
          {/* Failure simulation panel */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Simulate Device Failure</h3>
            <div className="flex items-center gap-3 mb-4">
              <select
                value={failedDeviceId ?? ''}
                onChange={e => setFailedDeviceId(e.target.value || null)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 text-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 cursor-pointer">
                <option value="">— Select a device to fail —</option>
                {generatedDevices.map(d => (
                  <option key={d.id} value={d.id}>{d.hostname} ({d.subLayer} · {d.model})</option>
                ))}
              </select>
              {failedDeviceId && (
                <button
                  onClick={() => setFailedDeviceId(null)}
                  className="px-3 py-2 text-xs rounded-lg border border-red-500/30 bg-red-950/20 text-red-400 hover:border-red-500/60 transition-colors cursor-pointer">
                  ✕ Clear
                </button>
              )}
            </div>
            {failureSim && failedDevice && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-400 font-semibold text-sm">💀 {failedDevice.hostname} failed</span>
                    <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', LAYER_BADGE[failedDevice.subLayer] ?? 'bg-gray-700 text-gray-300')}>{failedDevice.subLayer}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-gray-400 mb-1 font-semibold">Affected paths / devices</div>
                      {failureSim.affected.length === 0
                        ? <div className="text-green-400">No traffic impact (HA redundancy active)</div>
                        : failureSim.affected.map((a, i) => <div key={i} className="text-red-300">• {a}</div>)
                      }
                    </div>
                    <div>
                      <div className="text-gray-400 mb-1 font-semibold">Affected VLANs</div>
                      {failureSim.vlans.length === 0
                        ? <div className="text-green-400">No VLAN impact</div>
                        : failureSim.vlans.map(v => <div key={v} className="text-orange-300">• VLAN {v}</div>)
                      }
                    </div>
                    <div>
                      <div className="text-gray-400 mb-1 font-semibold">Est. Convergence</div>
                      <div className={cn('text-xl font-bold', failureSim.convergenceMs < 500 ? 'text-green-400' : failureSim.convergenceMs < 1000 ? 'text-yellow-400' : 'text-red-400')}>
                        {failureSim.convergenceMs < 1000
                          ? `${failureSim.convergenceMs} ms`
                          : `${(failureSim.convergenceMs / 1000).toFixed(1)} s`
                        }
                      </div>
                      <div className="text-gray-500 text-xs mt-1">BFD + fast-reroute</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!failedDeviceId && (
              <p className="text-xs text-gray-500 italic">Select a device above to simulate its failure and see the blast radius.</p>
            )}
          </Card>

          {/* Reachability matrix */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Reachability Matrix
              <span className="ml-2 text-xs text-gray-500 font-normal">Top {topDevices.length} devices</span>
              {failedDeviceId && <span className="ml-2 text-xs text-red-400 font-normal">(simulating failure)</span>}
            </h3>
            {topDevices.length < 2 ? (
              <p className="text-sm text-gray-500">Not enough devices to build a matrix.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-gray-500 text-right min-w-[80px]">From \ To</th>
                      {topDevices.map(d => (
                        <th key={d.id} className={cn('px-2 py-1 font-mono text-center min-w-[70px]', d.id === failedDeviceId ? 'text-red-400' : 'text-gray-300')}>
                          {d.hostname.length > 10 ? d.hostname.slice(0, 9) + '…' : d.hostname}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topDevices.map(src => (
                      <tr key={src.id} className="border-b border-white/5">
                        <td className={cn('px-2 py-1 font-mono font-semibold text-right', src.id === failedDeviceId ? 'text-red-400' : 'text-gray-300')}>
                          {src.hostname.length > 10 ? src.hostname.slice(0, 9) + '…' : src.hostname}
                        </td>
                        {topDevices.map(dst => {
                          if (src.id === dst.id) {
                            return <td key={dst.id} className="px-2 py-1 text-center text-gray-600">—</td>
                          }
                          const entry = reachMatrix.find(e => e.from === src.hostname && e.to === dst.hostname)
                          const ok = entry ? entry.reachable : true
                          return (
                            <td key={dst.id} className="px-2 py-1 text-center">
                              {ok
                                ? <span className="text-green-400 text-base" title={entry?.path}>✓</span>
                                : <span className="text-red-400 text-base" title="unreachable">✗</span>
                              }
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Route propagation */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Route Propagation</h3>
            {routeProp.length === 0 ? (
              <p className="text-sm text-gray-500">No route propagation data for this topology.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Device', 'Prefix', 'Next-Hop', 'Protocol', 'Metric'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routeProp.map((r, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className={`${tdCls} font-semibold text-gray-100 font-mono text-xs`}>{r.device}</td>
                        <td className={`${tdCls} font-mono text-xs text-blue-300`}>{r.prefix}</td>
                        <td className={`${tdCls} font-mono text-xs text-green-400`}>{r.nextHop}</td>
                        <td className={tdCls}>
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-900/50 text-purple-300">{r.protocol}</span>
                        </td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{r.metric}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Summary tab (M-27) ──────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">Full Design Summary</h3>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(summaryText).then(() => {
                    setSummaryCopied(true)
                    setTimeout(() => setSummaryCopied(false), 2000)
                  })
                }}
                className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                {summaryCopied ? '✓ Copied!' : '📋 Copy Summary'}
              </button>
            </div>

            {/* Intent section */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
              <div>
                <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-3">Intent</div>
                <div className="space-y-2">
                  {[
                    ['Use Case', USE_CASE_LABELS[useCase] || useCase || '—'],
                    ['Scale', scale.charAt(0).toUpperCase() + scale.slice(1)],
                    ['Site Code', siteCode || '—'],
                    ['Sites', String(numSites)],
                    ['Endpoints', String(totalEndpoints)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="text-gray-500">{k}</span>
                      <span className="text-gray-200 font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3">Topology</div>
                <div className="space-y-2">
                  {[
                    ['Underlay', underlayProtocol.toUpperCase()],
                    ['Overlay', overlayProtocols.join(', ') || 'none'],
                    ['Features', protoFeatures.length ? protoFeatures.join(', ') : 'none'],
                    ['Redundancy', redundancyModel],
                    ['Traffic Pattern', trafficPattern],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-sm">
                      <span className="text-gray-500">{k}</span>
                      <span className="text-gray-200 font-mono text-xs">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* BOM summary */}
            <div className="mb-6">
              <div className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3">Bill of Materials</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Layer', 'Model', 'Count', 'Unit Price', 'Total'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {generatedDevices.map(d => (
                      <tr key={d.id} className="border-b border-white/5">
                        <td className={tdCls}>
                          <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', LAYER_BADGE[d.subLayer] ?? 'bg-gray-700 text-gray-300')}>{d.subLayer}</span>
                        </td>
                        <td className={`${tdCls} font-semibold text-gray-100`}>{d.model}</td>
                        <td className={`${tdCls} font-bold text-orange-400`}>{d.count}×</td>
                        <td className={`${tdCls} font-mono text-xs text-gray-400`}>{formatUSD(d.unitPrice)}</td>
                        <td className={`${tdCls} font-mono text-xs text-green-400`}>{formatUSD(d.totalPrice)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/20 bg-white/5">
                      <td colSpan={3} className={`${tdCls} font-bold text-gray-200`}>TOTAL</td>
                      <td className={tdCls}></td>
                      <td className={`${tdCls} font-bold text-green-300 font-mono`}>{formatUSD(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* G-A13: 3-Year TCO model */}
            <div className="mb-6">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3">3-Year Total Cost of Ownership</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Category', 'Basis', '3-Year Cost'].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-white/5">
                      <td className={`${tdCls} font-semibold text-gray-100`}>Capex — Hardware</td>
                      <td className={`${tdCls} text-xs text-gray-500`}>{generatedDevices.length} devices, one-time</td>
                      <td className={`${tdCls} font-mono text-xs text-gray-200`}>{formatUSD(tco.capex)}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className={`${tdCls} font-semibold text-gray-100`}>Opex — Power &amp; Cooling</td>
                      <td className={`${tdCls} text-xs text-gray-500`}>{(tco.totalPowerW / 1000).toFixed(1)} kW · PUE {tco.rates.pue} · ${tco.rates.energyCostPerKwh}/kWh</td>
                      <td className={`${tdCls} font-mono text-xs text-gray-200`}>{formatUSD(tco.power)}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className={`${tdCls} font-semibold text-gray-100`}>Opex — Support / Maintenance</td>
                      <td className={`${tdCls} text-xs text-gray-500`}>{(tco.rates.supportRatePerYear * 100).toFixed(0)}%/yr of capex</td>
                      <td className={`${tdCls} font-mono text-xs text-gray-200`}>{formatUSD(tco.support)}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className={`${tdCls} font-semibold text-gray-100`}>Opex — Rack / Colo</td>
                      <td className={`${tdCls} text-xs text-gray-500`}>{tco.totalRackUnits} RU · ${tco.rates.rackCostPerRuMonth}/RU/mo</td>
                      <td className={`${tdCls} font-mono text-xs text-gray-200`}>{formatUSD(tco.rackspace)}</td>
                    </tr>
                    <tr className="border-t border-white/20 bg-white/5">
                      <td className={`${tdCls} font-bold text-gray-200`}>3-Year TCO</td>
                      <td className={tdCls}></td>
                      <td className={`${tdCls} font-bold text-amber-300 font-mono`}>{formatUSD(tco.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-600 mt-2 leading-relaxed">
                Assumptions: PUE {tco.rates.pue} (cooling/power overhead) · ${tco.rates.energyCostPerKwh}/kWh blended energy ·
                {' '}{(tco.rates.supportRatePerYear * 100).toFixed(0)}%/yr vendor support (SmartNet/TAC-style) ·
                {' '}${tco.rates.rackCostPerRuMonth}/RU/month colo. Capex is one-time; opex shown is summed over {tco.rates.years} years.
                Power looked up per model from the product catalog.
              </p>
            </div>

            {/* D1: Computed Topology — vPC/MLAG pairs, FHRP gateways, DCI route-targets */}
            {(computedTopology.mlagPairs.length > 0 || computedTopology.dci) && (
              <div className="mb-6">
                <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">Computed Topology</div>
                {computedTopology.mlagPairs.length > 0 && (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          {['vPC/MLAG Pair', 'Primary', 'Secondary', 'Domain ID'].map(h => (
                            <th key={h} className={thCls}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {computedTopology.mlagPairs.map(p => (
                          <tr key={p.pairId} className="border-b border-white/5">
                            <td className={`${tdCls} font-bold text-orange-400`}>#{p.pairId}</td>
                            <td className={`${tdCls} font-mono text-xs text-gray-200`}>{p.primary}</td>
                            <td className={`${tdCls} font-mono text-xs text-gray-200`}>{p.secondary}</td>
                            <td className={`${tdCls} font-mono text-xs text-gray-500`}>{p.domainId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {computedTopology.fhrpVips.length > 0 && (
                  <div className="overflow-x-auto mb-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 bg-white/5">
                          {['FHRP Gateway', 'Pair', 'VIP', 'Active', 'Standby'].map(h => (
                            <th key={h} className={thCls}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {computedTopology.fhrpVips.map(v => (
                          <tr key={`${v.pairId}-${v.vlan}`} className="border-b border-white/5">
                            <td className={`${tdCls} font-semibold text-gray-100`}>HSRP Vlan{v.vlan}/{v.name}</td>
                            <td className={`${tdCls} font-bold text-orange-400`}>#{v.pairId}</td>
                            <td className={`${tdCls} font-mono text-xs text-blue-400`}>{v.vip}</td>
                            <td className={`${tdCls} font-mono text-xs text-gray-200`}>{v.primary}</td>
                            <td className={`${tdCls} font-mono text-xs text-gray-500`}>{v.secondary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {computedTopology.dci && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-gray-500">EVPN DCI Route-Targets (ASN {computedTopology.dci.rtAsn})</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">L2 (Type-5 host routes)</span><span className="text-gray-200 font-mono text-xs">{computedTopology.dci.l2Rt}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">L3 (IP-VRF prefix routes)</span><span className="text-gray-200 font-mono text-xs">{computedTopology.dci.l3Rt}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Stretched leaves</span><span className="text-gray-200 font-mono text-xs">{computedTopology.dci.leaves.join(', ')}</span></div>
                  </div>
                )}
              </div>
            )}

            {/* Compliance */}
            <div>
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wider mb-3">Compliance Requirements</div>
              {compliance.length === 0 ? (
                <p className="text-sm text-gray-500">No compliance frameworks selected.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {compliance.map(c => (
                    <span key={c} className="px-3 py-1 rounded-lg text-xs font-semibold bg-orange-900/40 text-orange-300 border border-orange-700/30">{c}</span>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* H3: Capacity Planning */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">Capacity Planning & Growth Projection</h3>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Annual growth:</label>
                <select
                  value={growthRate}
                  onChange={e => setGrowthRate(Number(e.target.value))}
                  className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  {[10, 15, 20, 25, 30, 40, 50].map(r => (
                    <option key={r} value={r}>{r}%</option>
                  ))}
                </select>
              </div>
            </div>

            {generatedDevices.length > 0 ? (
              <>
                {/* Projection table */}
                <div className="overflow-x-auto mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {['Year', 'Endpoints', 'Port Capacity', 'Leaf Util %', 'Status'].map(h => (
                          <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {capacityPlan.projections.map(p => (
                        <tr key={p.year} className="border-b border-white/5">
                          <td className="px-4 py-2 text-gray-300 font-medium">
                            {p.year === 0 ? 'Now' : `Year ${p.year}`}
                          </td>
                          <td className="px-4 py-2 text-gray-200 font-mono text-xs">
                            {p.endpoints.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-gray-400 font-mono text-xs">
                            {p.portCapacity.toLocaleString()}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    'h-full rounded-full transition-all',
                                    p.status === 'ok' ? 'bg-green-500' : p.status === 'warn' ? 'bg-yellow-500' : p.status === 'critical' ? 'bg-orange-500' : 'bg-red-500'
                                  )}
                                  style={{ width: `${Math.min(p.leafUtilization * 100, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-400 font-mono">
                                {Math.round(p.leafUtilization * 100)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={cn(
                              'text-xs font-semibold rounded px-2 py-0.5',
                              p.status === 'ok' ? 'text-green-400 bg-green-500/10'
                                : p.status === 'warn' ? 'text-yellow-400 bg-yellow-500/10'
                                : p.status === 'critical' ? 'text-orange-400 bg-orange-500/10'
                                : 'text-red-400 bg-red-500/10'
                            )}>
                              {p.status === 'ok' ? 'OK' : p.status === 'warn' ? 'WARN' : p.status === 'critical' ? 'CRITICAL' : 'EXCEEDED'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Recommendations */}
                <div>
                  <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Recommendations</div>
                  <div className="space-y-1.5">
                    {capacityPlan.recommendations.map((r, i) => (
                      <div key={i} className="flex gap-2 text-sm">
                        <span className="text-blue-400 shrink-0">-</span>
                        <span className="text-gray-300">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">No devices in BOM — capacity projection requires a generated design.</p>
            )}
          </Card>

          {/* Export / Import */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Export & Import Design</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <button
                onClick={() => downloadDesignJSON(useAppStore.getState() as AppState)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-blue-500/40 bg-blue-600/20 text-blue-300 text-sm font-medium hover:bg-blue-600/30 transition-colors cursor-pointer"
              >
                Export JSON
              </button>
              <button
                onClick={() => downloadDesignMarkdown(useAppStore.getState() as AppState)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-green-500/40 bg-green-600/20 text-green-300 text-sm font-medium hover:bg-green-600/30 transition-colors cursor-pointer"
              >
                Export Report (.md)
              </button>
              <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-purple-500/40 bg-purple-600/20 text-purple-300 text-sm font-medium hover:bg-purple-600/30 transition-colors cursor-pointer">
                Import Design
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                      try {
                        const data = JSON.parse(reader.result as string)
                        const result = validateDesignImport(data)
                        if (!result.ok) {
                          setImportStatus({ type: 'error', message: result.error! })
                          return
                        }
                        const patch = applyDesignImport(data as DesignExport)
                        useAppStore.setState(patch)
                        const warnText = result.warnings.length > 0 ? ` (${result.warnings.join('; ')})` : ''
                        setImportStatus({ type: 'success', message: `Design imported successfully${warnText}` })
                      } catch {
                        setImportStatus({ type: 'error', message: 'Failed to parse JSON file' })
                      }
                    }
                    reader.readAsText(file)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            {importStatus && (
              <div className={cn(
                'p-3 rounded-lg text-sm border',
                importStatus.type === 'success' ? 'bg-green-900/30 border-green-700/50 text-green-300' : 'bg-red-900/30 border-red-700/50 text-red-300'
              )}>
                {importStatus.message}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              Export your full design as JSON (re-importable) or as a Markdown report for documentation and change management reviews.
            </p>
          </Card>

          {/* Printable text version */}
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Text Version (for copy / docs)</h3>
            <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre leading-relaxed">{summaryText}</pre>
          </Card>
        </div>
      )}

      {/* M-24: Reference Designs tab */}
      {activeTab === 'refdesigns' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">Reference architectures for the selected use case and adjacent designs.</p>
          {Object.entries(REF_DESIGNS)
            .filter(([key]) => !useCase || key === useCase)
            .concat(Object.entries(REF_DESIGNS).filter(([key]) => !useCase || key !== useCase))
            .slice(0, 4)
            .map(([key, rd]) => (
              <Card key={key}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${VENDOR_BADGE_COLORS[rd.vendor] ?? 'bg-white/10 text-gray-300 border border-white/10'}`}>{rd.vendor}</span>
                      {key === useCase && <span className="text-xs px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 border border-blue-500/40 font-semibold">Selected Use Case</span>}
                    </div>
                    <h3 className="text-sm font-semibold text-gray-200">{rd.title}</h3>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mb-3">{rd.description}</p>
                <div className="mb-3">
                  <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-1.5">Key Design Decisions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {rd.keyDecisions.map((d, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-300">{d}</span>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-gray-600 font-mono break-all">{rd.doc}</div>
              </Card>
            ))}
        </div>
      )}

      {/* Design summary (always visible at bottom) */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Design Summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            {[['Use Case', useCaseLabel], ['Scale', scaleLabel], ['Site Code', siteCode || '—'], ['Redundancy', redundancyModel]].map(([k,v]) => (
              <div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="text-gray-200 font-medium capitalize">{v}</span></div>
            ))}
          </div>
          <div className="space-y-2">
            {[['Underlay', underlayProtocol.toUpperCase()], ['Overlay', overlayProtocols.join(', ') || '—'], ['Endpoints', String(totalEndpoints || 0)], ['Sites', String(numSites)]].map(([k,v]) => (
              <div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="text-gray-200 font-mono text-xs">{v}</span></div>
            ))}
          </div>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep} disabled={devices.length === 0}>Next: Config Gen →</Button>
      </div>
    </div>
  )
}
