import { useMemo, useState, useRef } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildBOM } from '@/lib/bom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import { formatUSD, cn } from '@/lib/utils'
import type { BOMDevice } from '@/types'

// ── Tab types ────────────────────────────────────────────────────
type DesignTab = 'hld' | 'ipplan' | 'vlan' | 'routing'

const TAB_LABELS: Array<{ id: DesignTab; label: string }> = [
  { id: 'hld',     label: '📐 High Level Design' },
  { id: 'ipplan',  label: '🌐 IP Plan' },
  { id: 'vlan',    label: '🏷 VLAN Design' },
  { id: 'routing', label: '🔀 Routing & Protocols' },
]

// ── IP Plan data generator ───────────────────────────────────────
interface IPBlock { label: string; subnet: string; detail: string; range: string }

function genIPBlocks(useCase: string, totalEndpoints: number, numSites: number, devices: BOMDevice[]): IPBlock[] {
  const isDC    = useCase === 'dc' || useCase === 'multisite'
  const isGPU   = useCase === 'gpu'
  const nSpines = devices.filter(d => d.subLayer === 'spine').length
  const nLeaves = devices.filter(d => d.subLayer === 'leaf').length
  const nDist   = devices.filter(d => d.subLayer === 'distribution').length
  const nAccess = devices.filter(d => d.subLayer === 'access').length
  const totalInfra = devices.length

  const p2pTotal = isDC ? nLeaves * nSpines : nAccess + nDist
  const p2pPrefix = p2pTotal <= 256 ? '/23' : '/21'

  const blocks: IPBlock[] = [
    { label: 'MANAGEMENT OOB',   subnet: '10.0.0.0/24',  detail: `VLAN 10 · ${totalInfra} network devices across ${numSites} site(s)`, range: `10.0.0.1 – 10.0.0.${Math.min(totalInfra + 1, 254)}` },
    { label: 'LOOPBACKS',        subnet: '10.255.0.0/24',detail: `/32 per device · ${totalInfra} addresses needed`, range: `10.255.0.1 – 10.255.0.${Math.min(totalInfra, 254)}` },
    { label: 'P2P FABRIC LINKS', subnet: `10.100.0.0${p2pPrefix}`, detail: `/31 per link · ${p2pTotal} links`, range: `10.100.0.0 – covers ${p2pTotal} /31 pairs` },
    { label: 'CORPORATE DATA',   subnet: '10.10.0.0/22', detail: `VLAN 20 · ${totalEndpoints || 0} endpoints`, range: '10.10.0.1 – 10.10.3.254 (1022 hosts)' },
    { label: 'VOICE / UC',       subnet: '10.20.0.0/23', detail: 'VLAN 30 · IP Phones, UC', range: '10.20.0.1 – 10.20.1.254 (510 hosts)' },
    { label: 'SERVER / DMZ',     subnet: '10.50.0.0/22', detail: 'VLAN 50/60 · Physical & VM servers', range: '10.50.0.1 – 10.50.3.254 (1022 hosts)' },
    { label: 'IoT / GUEST',      subnet: '10.60.0.0/23', detail: 'VLAN 61/21 · Isolated · internet-only ACL', range: '10.60.0.1 – 10.60.1.254 (510 hosts)' },
  ]

  if (isDC) {
    blocks.push({ label: `DC UNDERLAY /31 (${nLeaves} leaf × ${nSpines} spine = ${nLeaves * nSpines} links)`, subnet: '10.1.0.0/20', detail: `P2P /31 links · ECMP · BFD`, range: `10.1.0.0 – covers ${nLeaves * nSpines} /31 pairs` })
    blocks.push({ label: 'DC OVERLAY — VXLAN tenant subnets', subnet: '10.200.0.0/14', detail: `VXLAN VNI space · PROD/STOR/DEV tenants · ${nLeaves} VTEPs`, range: '10.200.0.0 – 10.203.255.255 (262K hosts)' })
  }
  if (isGPU) {
    blocks.push({ label: `GPU COMPUTE fabric`, subnet: '192.168.100.0/22', detail: `RoCEv2 RDMA fabric · lossless · PFC priority 3`, range: '192.168.100.1 – 192.168.103.254' })
    blocks.push({ label: 'STORAGE — NVMe-oF / GPUDirect', subnet: '192.168.200.0/23', detail: 'NVMe-oF storage fabric · GPUDirect RDMA', range: '192.168.200.1 – 192.168.201.254' })
  }
  return blocks
}

interface IPRow { device: string; layer: string; iface: string; ip: string; prefix: string; purpose: string }

function genIPRows(_useCase: string, devices: BOMDevice[]): IPRow[] {
  const rows: IPRow[] = []
  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const dists  = devices.filter(d => d.subLayer === 'distribution')
  const access = devices.filter(d => d.subLayer === 'access')
  const fws    = devices.filter(d => d.subLayer === 'firewall')

  fws.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Firewall', iface: 'Loopback0', ip: `10.255.0.${i + 1}`, prefix: '/32', purpose: 'Router-ID / BGP peering' })
    rows.push({ device: d.hostname, layer: 'Firewall', iface: 'Gi0/0', ip: `10.0.0.${i + 1}`, prefix: '/30', purpose: 'Outside / Internet uplink' })
  })

  spines.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Spine', iface: 'Loopback0', ip: `10.255.1.${i + 1}`, prefix: '/32', purpose: `BGP Router-ID · spine ${i + 1} of ${spines.length}` })
  })

  const showLeaves = leaves.slice(0, 10)
  showLeaves.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Leaf', iface: 'Loopback0', ip: `10.255.2.${i + 1}`, prefix: '/32', purpose: `BGP Router-ID · leaf ${i + 1} of ${leaves.length}` })
    rows.push({ device: d.hostname, layer: 'Leaf', iface: 'Loopback1 (VTEP)', ip: `10.255.3.${i + 1}`, prefix: '/32', purpose: 'VXLAN NVE source (anycast)' })
  })
  if (leaves.length > 10) {
    rows.push({ device: `… +${leaves.length - 10} more`, layer: 'Leaf', iface: '—', ip: `10.255.2.11 – 10.255.2.${leaves.length}`, prefix: '/32', purpose: 'Same scheme continues' })
  }

  dists.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Distribution', iface: 'Loopback0', ip: `10.255.0.${20 + i}`, prefix: '/32', purpose: `Router-ID · device ${i + 1} of ${dists.length}` })
  })

  const showAccess = access.slice(0, 8)
  showAccess.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Access', iface: 'Vlan10', ip: `10.0.0.${31 + i}`, prefix: '/24', purpose: 'OOB management' })
  })
  if (access.length > 8) {
    rows.push({ device: `… +${access.length - 8} more`, layer: 'Access', iface: 'Vlan10', ip: `10.0.0.${31 + 8} – .${Math.min(30 + access.length, 254)}`, prefix: '/24', purpose: 'OOB management — same scheme' })
  }

  return rows
}

// ── VLAN data generator ──────────────────────────────────────────
interface VLANRow { id: number; name: string; subnet: string; gw: string; dhcp: string; purpose: string; layer: string }
interface VNIRow  { vni: number; vlan: string; type: string; vrf: string; irb: string; rt: string }

function genVLANs(useCase: string): VLANRow[] {
  const isDC = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu'
  const base: VLANRow[] = [
    { id: 10,  name: 'MGMT',          subnet: '10.0.0.0/24',   gw: '10.0.0.1',   dhcp: '10.0.0.10–250',   purpose: 'Network device OOB management',  layer: 'mgmt'  },
    { id: 20,  name: 'CORP-DATA',     subnet: '10.10.0.0/22',  gw: '10.10.0.1',  dhcp: '10.10.0.10–1000', purpose: 'Corporate user endpoints',        layer: 'access'},
    { id: 21,  name: 'GUEST',         subnet: '10.11.0.0/23',  gw: '10.11.0.1',  dhcp: '10.11.0.10–500',  purpose: 'Guest / BYOD (internet only)',    layer: 'access'},
    { id: 30,  name: 'VOICE',         subnet: '10.20.0.0/23',  gw: '10.20.0.1',  dhcp: '10.20.0.10–500',  purpose: 'IP Telephony / UC',               layer: 'dist'  },
    { id: 40,  name: 'WIRELESS-CORP', subnet: '10.30.0.0/22',  gw: '10.30.0.1',  dhcp: '10.30.0.10–1000', purpose: 'Corporate SSID (802.1X)',         layer: 'access'},
    { id: 50,  name: 'SERVER-FARM',   subnet: '10.50.0.0/22',  gw: '10.50.0.1',  dhcp: 'Static only',     purpose: 'Physical & VM servers',          layer: 'dist'  },
    { id: 60,  name: 'DMZ',           subnet: '10.60.0.0/24',  gw: '10.60.0.1',  dhcp: 'Static only',     purpose: 'Internet-facing / public SVC',   layer: 'fw'    },
    { id: 99,  name: 'NATIVE-TRUNK',  subnet: '—',             gw: '—',          dhcp: '—',               purpose: 'Native VLAN on trunk links',     layer: 'mgmt'  },
  ]
  if (isDC) {
    base.push({ id: 100, name: 'DC-TENANT-A', subnet: '10.200.0.0/22', gw: '10.200.0.1', dhcp: 'Dynamic', purpose: 'DC tenant A (VNI 100000)', layer: 'leaf' })
    base.push({ id: 101, name: 'DC-TENANT-B', subnet: '10.200.4.0/22', gw: '10.200.4.1', dhcp: 'Dynamic', purpose: 'DC tenant B (VNI 100001)', layer: 'leaf' })
    base.push({ id: 200, name: 'DC-STORAGE',  subnet: '10.201.0.0/22', gw: '10.201.0.1', dhcp: 'Static',  purpose: 'Storage network (iSCSI/NFS)', layer: 'dist' })
  }
  return base
}

function genVNIs(): VNIRow[] {
  return [
    { vni: 100000, vlan: '100', type: 'L2',       vrf: 'TENANT-A', irb: '10.200.0.1/22',   rt: '65000:100'  },
    { vni: 100001, vlan: '101', type: 'L2',       vrf: 'TENANT-B', irb: '10.200.4.1/22',   rt: '65000:101'  },
    { vni: 100050, vlan: '50',  type: 'L2',       vrf: 'DEFAULT',  irb: '10.50.0.1/22',    rt: '65000:50'   },
    { vni: 999000, vlan: '—',   type: 'L3 IP-VRF',vrf: 'TENANT-A', irb: 'Anycast 10.200.0.1', rt: '65000:9000' },
    { vni: 999001, vlan: '—',   type: 'L3 IP-VRF',vrf: 'TENANT-B', irb: 'Anycast 10.200.4.1', rt: '65000:9001' },
  ]
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

// ── CSV export helpers ───────────────────────────────────────────
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

export function Step4NetworkDesign() {
  const {
    useCase, scale, siteCode, numSites,
    underlayProtocol, overlayProtocols, redundancyModel,
    totalEndpoints, bandwidthPerServer, oversubscription,
    devices, setDevices, nextStep, prevStep,
  } = useAppStore()

  const [activeTab, setActiveTab] = useState<DesignTab>('hld')
  const svgRef = useRef<HTMLDivElement>(null)

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription }),
    [useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription]
  )

  useMemo(() => { setDevices(generatedDevices) }, [generatedDevices, setDevices])

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
            <h3 className="text-sm font-semibold text-gray-300">HLD Topology Diagram</h3>
            <button onClick={() => setDevices(generatedDevices)}
              className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
              ↺ Regenerate
            </button>
          </div>
          <div ref={svgRef}>
            <TopologyDiagram devices={generatedDevices} underlayProtocol={underlayProtocol} overlayProtocols={overlayProtocols} />
          </div>
        </Card>
      )}

      {/* ── IP Plan tab ──────────────────────────────────────────────── */}
      {activeTab === 'ipplan' && (
        <div className="space-y-4">
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
