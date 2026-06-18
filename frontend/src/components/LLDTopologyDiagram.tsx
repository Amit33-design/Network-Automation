import { useState, useMemo } from 'react'
import type { BOMDevice } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LLDInterface {
  name: string
  ip: string
  vlan?: string
  mac?: string
  speed?: string
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
  icon: string
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
    icon?: string
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
    icon: opts.icon ?? '',
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

function buildDCLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 200
  const Y = { inet: 60, fw: 180, router: 340, lb: 490, web: 640, app: 810 }

  const zones: LLDZone[] = [
    { id: 'z-inet', label: 'INTERNET / UNTRUSTED ZONE', sublabel: 'External Networks',
      yStart: 0, yEnd: 130, fill: 'rgba(17,17,17,0.9)', stroke: '#374151' },
    { id: 'z-dmz', label: 'DMZ — PERIMETER', sublabel: 'Firewall HA Cluster · IPS · TLS Inspect',
      yStart: 130, yEnd: 290, fill: 'rgba(127,29,29,0.12)', stroke: '#B91C1C' },
    { id: 'z-int', label: 'INTERNAL NETWORK', sublabel: 'Core Routing · BGP · OSPF · QoS',
      yStart: 290, yEnd: 440, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-lb', label: 'LOAD BALANCED TIER', sublabel: 'F5 HA · SSL Offload · L7 Routing',
      yStart: 440, yEnd: 590, fill: 'rgba(180,83,9,0.10)', stroke: '#B45309' },
    { id: 'z-srv', label: 'SERVER TIER · 10.3.1.0/24', sublabel: 'Web Servers · Frontside + Backside VLAN',
      yStart: 590, yEnd: 740, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-app', label: 'APPLICATION TIER · 10.3.1.0/24', sublabel: 'API Gateway · App Server · Database',
      yStart: 740, yEnd: 920, fill: 'rgba(88,28,135,0.10)', stroke: '#7E22CE' },
  ]

  const [ix] = xCenter(1, 0, NW)
  const inet = mkNode('inet', 'INTERNET', 'Dual-ISP', 'internet', 'ISP',
    ix + NW/2 - 60, Y.inet, 120, 50, {
      icon: '🌐',
      interfaces: [
        { name: 'Egress ISP', ip: '10.21.10/30', speed: '1G' },
        { name: 'Ingress ISP', ip: '10.21.10/30', speed: '1G' },
      ],
    })

  const [fw1x, fw2x] = xCenter(2, 160, NW)
  const fw1 = mkNode('fw1', 'FW-01', 'PA-5450', 'dmz', 'Palo Alto', fw1x, Y.fw, NW, 120, {
    haRole: 'active',
    icon: '🛡',
    interfaces: [
      { name: 'port 1', ip: '10.1.1.1/24', vlan: 'Outside' },
      { name: 'port 2', ip: '10.1.2.1/24', vlan: 'Inside' },
      { name: 'ha1', ip: '10.10.0.1/30', vlan: 'HA' },
    ],
    configLines: ['DMZ zone', 'External Heartbeat', 'External Egress IP 10.1.1.0/24'],
    services: ['NGFW', 'IPS', 'App-ID', 'TLS Decrypt'],
  })
  const fw2 = mkNode('fw2', 'FW-02', 'PA-5450', 'dmz', 'Palo Alto', fw2x, Y.fw, NW, 120, {
    haRole: 'standby',
    icon: '🛡',
    interfaces: [
      { name: 'port 1', ip: '10.1.1.2/24', vlan: 'Outside' },
      { name: 'port 2', ip: '10.1.2.2/24', vlan: 'Inside' },
      { name: 'ha1', ip: '10.10.0.2/30', vlan: 'HA' },
    ],
    configLines: ['Internal zone', 'ACL Inside', 'Internal IP 10.1.2.0/24'],
    services: ['NGFW', 'HA-Sync', 'State-Sync'],
  })

  const [r1x, r2x] = xCenter(2, 160, NW)
  const rtr1 = mkNode('rtr1', 'ROUTER-CORE', 'ASR-1002-HX', 'internal', 'Cisco', r1x, Y.router, NW, 120, {
    icon: '🔀',
    interfaces: [
      { name: 'Gi0/0', ip: '10.2.1.1/30', vlan: 'vlan_trunks' },
      { name: 'Gi0/1', ip: '10.2.1.5/30', vlan: 'vlanI01' },
    ],
    configLines: [
      'BGP neighbor 1',
      'neighbor 222.12.110',
      'bgp-cluster 10.1.1.0/24',
      'neighbors-external 10.1.1.0/24',
    ],
    services: ['BGP', 'OSPF', 'QoS', 'Redundant Path A'],
  })
  const rtr2 = mkNode('rtr2', 'ROUTER-EDGE', 'ASR-1002-HX', 'internal', 'Cisco', r2x, Y.router, NW, 120, {
    icon: '🔀',
    interfaces: [
      { name: 'Gi0/0', ip: '10.2.1.2/30', vlan: 'vlan_trunks' },
      { name: 'Gi0/1', ip: '10.2.1.6/30', vlan: 'vlanI01' },
    ],
    configLines: [
      'BGP neighbor 2',
      'neighbor 222.15.128.0',
      'bgp-cluster 10.1.2.0/24',
      'neighbors-external-size 10.1.2.0/25',
    ],
    services: ['BGP', 'OSPF', 'QoS', 'Redundant Path B'],
    haRole: 'standby',
  })

  const [lbx] = xCenter(1, 0, 260)
  const lb = mkNode('lb', 'F5-HA Cluster', 'BIG-IP i5800', 'loadbalancer', 'F5', lbx, Y.lb, 260, 110, {
    haRole: 'active',
    icon: '⚖',
    interfaces: [
      { name: 'vlan101', ip: '10.2.1.0/30', vlan: 'Frontside VLAN' },
      { name: 'vlan102', ip: '10.2.1.0/30', vlan: 'Backside VLAN' },
    ],
    configLines: [
      'SSL Offload · L7 Routing · Health Checks',
      'Round Robin · Least Conn · Persistence',
      'Active-Standby HA Pair · MAF',
    ],
    services: ['SSL', 'L7 LB', 'WAF', 'Persistence'],
  })

  const webW = 170
  const webXs = xCenter(3, 30, webW)
  const webs = webXs.map((x, i) => mkNode(
    `web${i+1}`, `WEB SERVER 0${i+1}`, 'Dell R750', 'server', 'Dell', x, Y.web, webW, 110, {
      icon: '🖥',
      interfaces: [
        { name: 'eth0', ip: `192.168.10.1${i+1}`, mac: '00:0c:29:ab:cd:ef' },
        { name: 'eth1', ip: '10.3.1.1', vlan: 'Backside VLAN' },
      ],
      configLines: [`nginx · TLS 1.3`, `8 vCPU · 32GB RAM`],
      services: ['nginx', 'TLS 1.3'],
      specs: '8 vCPU · 32GB RAM',
    },
  ))

  const appW = 180
  const appXs = xCenter(3, 40, appW)
  const apiGw = mkNode('apigw', 'API GATEWAY', 'Kong / Envoy', 'application', 'OSS', appXs[0], Y.app, appW, 110, {
    icon: '🔌',
    interfaces: [
      { name: 'eth0', ip: '10.3.1.11', mac: '00:0c:29:ab:cd:ef' },
      { name: 'eth1', ip: '10.3.1.1', vlan: 'API' },
    ],
    configLines: ['Auth · Rate Limit', 'GraphQL · JWT', 'Routing · Versioning'],
    services: ['Auth', 'Rate Limit', 'Routing'],
  })
  const appSrv = mkNode('appsrv', 'APP SERVER', 'Dell R750', 'application', 'Dell', appXs[1], Y.app, appW, 110, {
    icon: '⚙',
    interfaces: [
      { name: 'eth0', ip: '10.3.1.11', mac: '00:0c:29:ab:cd:ef' },
      { name: 'eth1', ip: '10.3.1.1', vlan: 'App' },
    ],
    configLines: ['Node.js / Python / Java', 'Business Logic', 'Cache · Session Mgmt'],
    services: ['App Runtime', 'Cache'],
    specs: '16 vCPU · 64GB RAM',
  })
  const db = mkNode('db', 'DATABASE', 'Dell R750', 'database', 'Dell', appXs[2], Y.app, appW, 110, {
    icon: '🗄',
    interfaces: [
      { name: 'eth0', ip: '10.3.1.35', mac: '00:0c:29:ab:cd:ef' },
      { name: 'eth1', ip: '10.3.1.32', vlan: 'DB' },
    ],
    configLines: ['PostgreSQL · Redis', 'Primary / Replica', 'Encrypted at Rest'],
    services: ['PostgreSQL', 'Redis', 'Replication'],
    specs: '32 vCPU · 128GB RAM',
  })

  const nodes = [inet, fw1, fw2, rtr1, rtr2, lb, ...webs, apiGw, appSrv, db]

  const links: LLDLink[] = [
    mkLink('inet', 'fw1', '—', 'port 1', '1G', 'BGP', { subnet: '10.1.1.0/24' }),
    mkLink('inet', 'fw2', '—', 'port 1', '1G', 'BGP', { subnet: '10.1.1.0/24' }),
    mkLink('fw1', 'fw2', 'ha1', 'ha1', '10G', 'Cluster Heartbeat', { isDashed: true }),
    mkLink('fw1', 'rtr1', 'port 2', 'Gi0/0', '10G', 'L3 Routed', { subnet: '10.1.2.0/24', vlan: 'vlanI01' }),
    mkLink('fw2', 'rtr2', 'port 2', 'Gi0/0', '10G', 'L3 Routed', { subnet: '10.1.2.0/24', vlan: 'vlanI01' }),
    mkLink('rtr1', 'rtr2', 'Gi0/1', 'Gi0/1', '10G', 'iBGP / OSPF', { isDashed: true }),
    mkLink('rtr1', 'lb', 'Gi0/0', 'vlan101', '10G', 'Frontside VLAN', { vlan: 'vlan101', subnet: '10.2.1.0/30' }),
    mkLink('rtr2', 'lb', 'Gi0/1', 'vlan101', '10G', 'Frontside VLAN', { vlan: 'vlan101', subnet: '10.2.1.0/30' }),
    ...webs.map((w, i) => mkLink('lb', w.id, 'vlan102', 'eth0', '25G', 'Backside VLAN', { vlan: 'vlan102', subnet: `192.168.10.${10+i}/24` })),
    ...webs.map((w, i) => mkLink(w.id, i === 0 ? 'apigw' : i === 1 ? 'appsrv' : 'db', 'eth1', 'eth0', '25G', 'API / DB Conn', { vlan: 'App' })),
    mkLink('apigw', 'appsrv', 'eth1', 'eth0', '25G', 'API calls', { vlan: 'App' }),
    mkLink('appsrv', 'db', 'eth1', 'eth0', '25G', 'DB Connection', { vlan: 'DB' }),
  ]

  const cabling: CablingEntry[] = [
    ...webs.map((w, i) => ({
      server: w.hostname, serverPort: 'eth0', ipv4: w.interfaces[0]?.ip ?? '', switchPort: `POE_${i+1}`, mgmtPort: `vlan02`, vlan: 'vlan102',
    })),
    { server: 'API GW', serverPort: 'eth0', ipv4: '10.3.1.11', switchPort: 'POT_3', mgmtPort: 'vlan02', vlan: 'App' },
    { server: 'APP SRV', serverPort: 'eth0', ipv4: '10.3.1.11', switchPort: 'POT_4', mgmtPort: 'vlan02', vlan: 'App' },
    { server: 'DATABASE', serverPort: 'eth0', ipv4: '10.3.1.35', switchPort: 'POT_5', mgmtPort: 'vlan02', vlan: 'DB' },
    { server: 'FW-01', serverPort: 'port 1', ipv4: '10.1.1.1', switchPort: 'POT_6', mgmtPort: 'HA', vlan: 'Outside' },
    { server: 'FW-02', serverPort: 'port 1', ipv4: '10.1.1.2', switchPort: 'POT_7', mgmtPort: 'HA', vlan: 'Outside' },
    { server: 'RTR-CORE', serverPort: 'Gi0/0', ipv4: '10.2.1.1', switchPort: 'POT_8', mgmtPort: 'BLOM', vlan: 'vlan101' },
    { server: 'RTR-EDGE', serverPort: 'Gi0/0', ipv4: '10.2.1.2', switchPort: 'POT_9', mgmtPort: 'BLOM', vlan: 'vlan101' },
  ]

  return {
    nodes, links, zones, cabling,
    title: `DATACENTER LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: 'Firewall HA · Core Routing · F5 LB · Web/App/DB tiers · Full port-level detail',
    svgH: 960,
  }
}

// ─── Campus LLD ───────────────────────────────────────────────────────────────

function buildCampusLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 190
  const Y = { wan: 60, core: 200, dist: 370, access: 530, hosts: 700 }

  const zones: LLDZone[] = [
    { id: 'z-wan', label: 'WAN EDGE', sublabel: 'Dual ISP · BGP eBGP · BFD',
      yStart: 0, yEnd: 150, fill: 'rgba(180,83,9,0.10)', stroke: '#B45309' },
    { id: 'z-core', label: 'CAMPUS CORE', sublabel: 'OSPF Area 0 · VSS · HSRP · L3 GW',
      yStart: 150, yEnd: 320, fill: 'rgba(88,28,135,0.10)', stroke: '#7E22CE' },
    { id: 'z-dist', label: 'DISTRIBUTION LAYER', sublabel: 'MLAG Pairs · DHCP Relay · Inter-VLAN',
      yStart: 320, yEnd: 480, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-access', label: 'ACCESS LAYER', sublabel: '802.1X · PoE+ · DAI · LLDP · Voice VLAN',
      yStart: 480, yEnd: 650, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-ep', label: 'ENDPOINTS', sublabel: 'PCs · IP Phones · APs · Printers',
      yStart: 650, yEnd: 810, fill: 'rgba(28,25,23,0.10)', stroke: '#57534E' },
  ]

  const [w1x, w2x] = xCenter(2, 200, NW)
  const wan1 = mkNode('wan1', 'WAN-RTR-01', 'ASR-1001X', 'wan', 'Cisco', w1x, Y.wan, NW, 100, {
    haRole: 'active', icon: '🌐',
    interfaces: [
      { name: 'Gi0/0/0', ip: '203.0.113.1/30', vlan: 'ISP-A' },
      { name: 'Gi0/0/1', ip: '10.0.0.1/30', vlan: 'Core-uplink' },
      { name: 'Lo0', ip: '10.255.0.1/32' },
    ],
    configLines: ['BGP AS65000', 'OSPF Area 0', 'BFD multihop'],
    services: ['BGP eBGP', 'OSPF', 'BFD'],
  })
  const wan2 = mkNode('wan2', 'WAN-RTR-02', 'ASR-1001X', 'wan', 'Cisco', w2x, Y.wan, NW, 100, {
    haRole: 'standby', icon: '🌐',
    interfaces: [
      { name: 'Gi0/0/0', ip: '198.51.100.1/30', vlan: 'ISP-B' },
      { name: 'Gi0/0/1', ip: '10.0.0.5/30', vlan: 'Core-uplink' },
      { name: 'Lo0', ip: '10.255.0.2/32' },
    ],
    configLines: ['BGP AS65000', 'OSPF Area 0', 'iBGP peer'],
    services: ['BGP eBGP', 'OSPF', 'BFD'],
  })

  const [c1x, c2x] = xCenter(2, 200, NW)
  const core1 = mkNode('core1', 'CORE-SW-01', 'C9500-32QC', 'core', 'Cisco', c1x, Y.core, NW, 120, {
    haRole: 'active', icon: '🏛',
    interfaces: [
      { name: 'Te1/0/1', ip: '10.0.0.2/30', vlan: 'WAN-uplink' },
      { name: 'Te1/0/48', ip: '—', vlan: 'VSS link' },
      { name: 'Lo0', ip: '10.255.0.21/32' },
      { name: 'Vlan10', ip: '10.10.0.2/24', vlan: 'DATA HSRP VIP: 10.10.0.1' },
    ],
    configLines: ['VSS Active', 'OSPF Area 0 DR', 'HSRP Priority 110', 'DHCP Server'],
    services: ['VSS', 'OSPF', 'HSRP', 'DHCP'],
  })
  const core2 = mkNode('core2', 'CORE-SW-02', 'C9500-32QC', 'core', 'Cisco', c2x, Y.core, NW, 120, {
    haRole: 'standby', icon: '🏛',
    interfaces: [
      { name: 'Te1/0/1', ip: '10.0.0.6/30', vlan: 'WAN-uplink' },
      { name: 'Te1/0/48', ip: '—', vlan: 'VSS link' },
      { name: 'Lo0', ip: '10.255.0.22/32' },
      { name: 'Vlan10', ip: '10.10.0.3/24', vlan: 'DATA HSRP Standby' },
    ],
    configLines: ['VSS Standby', 'OSPF Area 0 BDR', 'HSRP Priority 100'],
    services: ['VSS', 'OSPF', 'HSRP'],
  })

  const distW = 180
  const [d1x, d2x, d3x, d4x] = xCenter(4, 20, distW)
  const dists = [d1x, d2x, d3x, d4x].map((x, i) => mkNode(
    `dist${i+1}`, `DIST-SW-0${i+1}`, 'C9500-48Y4C', 'distribution', 'Cisco', x, Y.dist, distW, 110, {
      icon: '🔗',
      interfaces: [
        { name: 'Te1/0/1', ip: `10.0.${1+Math.floor(i/2)*2}.${i%2 === 0 ? 1 : 2}/31`, vlan: 'Core-uplink' },
        { name: 'Po1', ip: '—', vlan: 'MLAG Peer-Link' },
        { name: `Vlan2${i}`, ip: `10.10.${i}.1/24`, vlan: `Data Vlan2${i}` },
      ],
      configLines: [
        `MLAG Pair #${Math.floor(i/2)+1}`,
        'OSPF Area 0',
        'DHCP Relay → Core',
        `STP Root Prio ${i < 2 ? '4096' : '8192'}`,
      ],
      services: ['MLAG', 'OSPF', 'DHCP Relay', 'STP'],
    },
  ))

  const accW = 160
  const accXs = xCenter(4, 20, accW)
  const accs = accXs.map((x, i) => mkNode(
    `acc${i+1}`, `ACC-SW-0${i+1}`, 'C9300-48P', 'access', 'Cisco', x, Y.access, accW, 120, {
      icon: '🔌',
      interfaces: [
        { name: 'Gi0/1', ip: '—', vlan: 'Trunk to Dist' },
        { name: 'Gi1/0/1-24', ip: '—', vlan: 'VLAN 20 Data' },
        { name: 'Gi1/0/25-48', ip: '—', vlan: 'VLAN 30 Voice' },
      ],
      configLines: [
        '802.1X port-auth',
        'PoE+ 30W per port',
        'DAI + DHCP Snooping',
        `VLAN 20 Data · VLAN 30 Voice`,
      ],
      services: ['802.1X', 'PoE+', 'DAI', 'LLDP-MED'],
      specs: '48× 1G PoE+ · 4× 10G uplink',
    },
  ))

  const epW = 100
  const epXs = xCenter(5, 30, epW)
  const epLabels = ['PC-01', 'IP-PHONE', 'AP-01', 'PRINTER', 'SERVER']
  const epIcons = ['💻', '📞', '📡', '🖨', '🖥']
  const eps = epXs.map((x, i) => mkNode(
    `ep${i+1}`, epLabels[i], 'Endpoint', 'endpoint', '—', x, Y.hosts, epW, 70, {
      icon: epIcons[i],
      interfaces: [{ name: 'eth0', ip: `10.10.0.${10+i}/24`, vlan: i === 1 ? 'VLAN30 Voice' : 'VLAN20 Data' }],
      configLines: [i === 1 ? 'LLDP-MED Voice' : i === 2 ? 'WPA3-Enterprise' : '802.1X MAB'],
    },
  ))

  const nodes = [wan1, wan2, core1, core2, ...dists, ...accs, ...eps]

  const links: LLDLink[] = [
    mkLink('wan1', 'wan2', 'Gi0/1', 'Gi0/1', '1G', 'iBGP peer', { isDashed: true }),
    mkLink('wan1', 'core1', 'Gi0/0/1', 'Te1/0/1', '10G', 'OSPF Area 0', { subnet: '10.0.0.0/30' }),
    mkLink('wan2', 'core2', 'Gi0/0/1', 'Te1/0/1', '10G', 'OSPF Area 0', { subnet: '10.0.0.4/30' }),
    mkLink('core1', 'core2', 'Te1/0/48', 'Te1/0/48', '40G', 'VSS / MEC', { isDashed: true }),
    ...dists.map((d, i) => mkLink('core1', d.id, `Te1/0/${i+2}`, 'Te1/0/1', '40G', 'OSPF · MLAG', { subnet: `10.0.${1+i*2}.0/31` })),
    ...dists.map((d, i) => mkLink('core2', d.id, `Te1/0/${i+2}`, 'Te1/0/2', '40G', 'OSPF · MLAG', { subnet: `10.0.${2+i*2}.0/31` })),
    mkLink('dist1', 'dist2', 'Po1', 'Po1', '2×40G', 'MLAG Peer-Link', { isDashed: true }),
    mkLink('dist3', 'dist4', 'Po1', 'Po1', '2×40G', 'MLAG Peer-Link', { isDashed: true }),
    ...accs.map((a, i) => mkLink(dists[i].id, a.id, 'Te1/0/3', 'Gi0/1', '10G', '802.1Q Trunk')),
    ...eps.map((e, i) => mkLink(accs[Math.min(i, 3)].id, e.id, `Gi1/0/${i+1}`, 'eth0', '1G', '802.1X Access', { vlan: i === 1 ? 'VLAN30' : 'VLAN20' })),
  ]

  const cabling: CablingEntry[] = [
    ...dists.map((d, i) => ({ server: d.hostname, serverPort: 'Te1/0/1', ipv4: d.interfaces[0]?.ip ?? '', switchPort: `Core Te1/0/${i+2}`, mgmtPort: 'Lo0', vlan: 'Trunk' })),
    ...accs.map((a) => ({ server: a.hostname, serverPort: 'Gi0/1', ipv4: '—', switchPort: `Dist Te1/0/3`, mgmtPort: 'VLAN99', vlan: 'Trunk' })),
    ...eps.map((e, i) => ({ server: e.hostname, serverPort: 'eth0', ipv4: e.interfaces[0]?.ip ?? '', switchPort: `Acc Gi1/0/${i+1}`, mgmtPort: '—', vlan: i === 1 ? 'VLAN30' : 'VLAN20' })),
  ]

  return {
    nodes, links, zones, cabling,
    title: `CAMPUS LAN LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: 'WAN Edge · Core VSS · Distribution MLAG · Access 802.1X/PoE+ · VLAN/HSRP detail',
    svgH: 830,
  }
}

// ─── GPU AI Fabric LLD ────────────────────────────────────────────────────────

function buildGPULLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 190
  const Y = { oob: 50, spine: 180, leaf: 340, gpu: 510, stor: 680 }

  const zones: LLDZone[] = [
    { id: 'z-oob', label: 'OOB MANAGEMENT', sublabel: 'SSH · SNMPv3 · Syslog · VLAN 10',
      yStart: 0, yEnd: 130, fill: 'rgba(28,25,23,0.10)', stroke: '#57534E' },
    { id: 'z-spine', label: 'SPINE FABRIC', sublabel: 'IS-IS underlay · 400G QSFP-DD · ECMP 16-path',
      yStart: 130, yEnd: 290, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-leaf', label: 'LEAF / ToR', sublabel: 'VXLAN NVE · BGP EVPN · Anycast-GW · PFC P3',
      yStart: 290, yEnd: 460, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-gpu', label: 'GPU COMPUTE', sublabel: 'NVIDIA A100/H100 · NVLink · GPUDirect RDMA · PFC lossless',
      yStart: 460, yEnd: 630, fill: 'rgba(6,78,59,0.10)', stroke: '#065F46' },
    { id: 'z-stor', label: 'STORAGE', sublabel: 'NVMe-oF TCP · GPUDirect Storage · RDMA',
      yStart: 630, yEnd: 790, fill: 'rgba(30,27,75,0.10)', stroke: '#3730A3' },
  ]

  const [oobX] = xCenter(1, 0, 200)
  const oob = mkNode('oob', 'OOB-MGMT-SW', 'C9300-24T', 'oob', 'Cisco', oobX, Y.oob, 200, 90, {
    icon: '⚙',
    interfaces: [
      { name: 'Gi0/1-8', ip: '10.0.0.250/24', vlan: 'VLAN 10 OOB' },
    ],
    configLines: ['VLAN 10 OOB · SSH · SNMPv3', 'Syslog → 10.0.0.100'],
    services: ['SSH', 'SNMPv3', 'Syslog'],
  })

  const [s1x, s2x] = xCenter(2, 280, NW)
  const sp1 = mkNode('sp1', 'GPU-SPINE-01', 'SN4800', 'spine', 'NVIDIA', s1x, Y.spine, NW, 110, {
    haRole: 'active', icon: '🔷',
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.0.x/31', speed: '400G' },
      { name: 'Lo0', ip: '10.255.1.1/32' },
      { name: 'Gi0/48', ip: '10.0.0.31/24', vlan: 'OOB VLAN10' },
    ],
    configLines: ['IS-IS level-2', 'BFD interval 100ms', 'PFC priority 3 no-drop', 'ECN DCQCN enabled'],
    services: ['IS-IS', 'BFD', 'PFC', 'ECN', 'DCQCN'],
  })
  const sp2 = mkNode('sp2', 'GPU-SPINE-02', 'SN4800', 'spine', 'NVIDIA', s2x, Y.spine, NW, 110, {
    haRole: 'active', icon: '🔷',
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.1.x/31', speed: '400G' },
      { name: 'Lo0', ip: '10.255.1.2/32' },
      { name: 'Gi0/48', ip: '10.0.0.32/24', vlan: 'OOB VLAN10' },
    ],
    configLines: ['IS-IS level-2', 'BFD interval 100ms', 'PFC priority 3 no-drop', 'ECN DCQCN enabled'],
    services: ['IS-IS', 'BFD', 'PFC', 'ECN', 'DCQCN'],
  })

  const leafW = 180
  const leafXs = xCenter(4, 20, leafW)
  const leaves = leafXs.map((x, i) => mkNode(
    `lf${i+1}`, `GPU-LEAF-0${i+1}`, 'SN4600C', 'leaf', 'NVIDIA', x, Y.leaf, leafW, 120, {
      icon: '🟢',
      interfaces: [
        { name: 'e1/1', ip: `10.1.0.${i*4+1}/31`, speed: '400G', vlan: 'Spine-01 uplink' },
        { name: 'e1/2', ip: `10.1.1.${i*4+1}/31`, speed: '400G', vlan: 'Spine-02 uplink' },
        { name: `e1/20-21`, ip: `192.168.100.${i*4}/30`, speed: '400G', vlan: 'GPU host' },
        { name: 'Po1', ip: '—', vlan: `MLAG Pair #${Math.floor(i/2)+1}` },
        { name: 'Lo0', ip: `10.255.2.${i+1}/32` },
      ],
      configLines: [
        'VXLAN NVE · BGP EVPN',
        'PFC priority 3 no-drop',
        'ECN · DCQCN · WRED',
        `MLAG Pair #${Math.floor(i/2)+1}`,
      ],
      services: ['VXLAN', 'BGP EVPN', 'PFC', 'ECN'],
    },
  ))

  const gpuW = 170
  const gpuXs = xCenter(4, 20, gpuW)
  const gpus = gpuXs.map((x, i) => mkNode(
    `gpu${i+1}`, `A100-SRV-0${i+1}`, 'DGX A100', 'gpu', 'NVIDIA', x, Y.gpu, gpuW, 110, {
      icon: '⚡',
      interfaces: [
        { name: 'mlx0', ip: `192.168.100.${i*4+1}/30`, speed: '400G', vlan: 'RoCEv2' },
        { name: 'mlx1', ip: `192.168.100.${i*4+5}/30`, speed: '400G', vlan: 'RoCEv2 backup' },
      ],
      configLines: [
        '8× A100 80GB GPU',
        'NVLink 4th gen · 600GB/s',
        'GPUDirect RDMA · RoCEv2',
        'PFC priority 3 lossless',
      ],
      services: ['RDMA', 'GPUDirect', 'NVLink'],
      specs: '8× A100 · 2TB RAM · 15TB NVMe',
    },
  ))

  const storW = 180
  const [st1x, st2x] = xCenter(2, 200, storW)
  const stor1 = mkNode('stor1', 'NVMe-STOR-01', 'EF-570', 'storage', 'NetApp', st1x, Y.stor, storW, 90, {
    icon: '💾',
    interfaces: [
      { name: 'e0a', ip: '192.168.200.1/30', speed: '400G' },
      { name: 'e0b', ip: '192.168.200.5/30', speed: '400G' },
    ],
    configLines: ['NVMe-oF TCP · 24×7.68TB NVMe', 'GPUDirect Storage · RDMA'],
    services: ['NVMe-oF', 'GPUDirect Storage'],
  })
  const stor2 = mkNode('stor2', 'NVMe-STOR-02', 'EF-570', 'storage', 'NetApp', st2x, Y.stor, storW, 90, {
    icon: '💾',
    interfaces: [
      { name: 'e0a', ip: '192.168.200.9/30', speed: '400G' },
      { name: 'e0b', ip: '192.168.200.13/30', speed: '400G' },
    ],
    configLines: ['NVMe-oF TCP · 24×7.68TB NVMe', 'GPUDirect Storage · RDMA'],
    services: ['NVMe-oF', 'GPUDirect Storage'],
  })

  const nodes = [oob, sp1, sp2, ...leaves, ...gpus, stor1, stor2]

  const links: LLDLink[] = [
    mkLink('oob', 'sp1', 'Gi0/1', 'Gi0/48', '1G', 'OOB Mgmt', { isDashed: true, vlan: 'VLAN10' }),
    mkLink('oob', 'sp2', 'Gi0/2', 'Gi0/48', '1G', 'OOB Mgmt', { isDashed: true, vlan: 'VLAN10' }),
    ...leaves.map((lf, i) => mkLink('sp1', lf.id, `e1/${i+1}`, 'e1/1', '400G', 'IS-IS / RoCEv2', { subnet: `10.1.0.${i*4}/31` })),
    ...leaves.map((lf, i) => mkLink('sp2', lf.id, `e1/${i+1}`, 'e1/2', '400G', 'IS-IS / RoCEv2', { subnet: `10.1.1.${i*4}/31` })),
    mkLink('lf1', 'lf2', 'Po1', 'Po1', '2×100G', 'MLAG Peer', { isDashed: true }),
    mkLink('lf3', 'lf4', 'Po1', 'Po1', '2×100G', 'MLAG Peer', { isDashed: true }),
    ...gpus.map((g, i) => mkLink(leaves[i].id, g.id, `e1/20`, 'mlx0', '400G', 'RoCEv2 PFC lossless', { subnet: `192.168.100.${i*4}/30` })),
    mkLink('lf1', 'stor1', 'e1/40', 'e0a', '400G', 'NVMe-oF TCP', { subnet: '192.168.200.0/30' }),
    mkLink('lf2', 'stor2', 'e1/40', 'e0a', '400G', 'NVMe-oF TCP', { subnet: '192.168.200.8/30' }),
  ]

  const cabling: CablingEntry[] = [
    ...gpus.map((g, i) => ({ server: g.hostname, serverPort: 'mlx0', ipv4: g.interfaces[0]?.ip ?? '', switchPort: `LEAF-0${i+1} e1/20`, mgmtPort: 'OOB', vlan: 'RoCEv2' })),
    { server: 'NVMe-STOR-01', serverPort: 'e0a', ipv4: '192.168.200.1', switchPort: 'LEAF-01 e1/40', mgmtPort: 'OOB', vlan: 'NVMe-oF' },
    { server: 'NVMe-STOR-02', serverPort: 'e0a', ipv4: '192.168.200.9', switchPort: 'LEAF-02 e1/40', mgmtPort: 'OOB', vlan: 'NVMe-oF' },
  ]

  return {
    nodes, links, zones, cabling,
    title: `GPU AI FABRIC LLD — SPECIFIC IMPLEMENTATION${sc ? ` · ${sc}` : ''}`,
    subtitle: '2 Spine · 4 Leaf ToR · 4 GPU Nodes · NVMe-oF Storage · RoCEv2 lossless · PFC P3',
    svgH: 830,
  }
}

// ─── WAN LLD ──────────────────────────────────────────────────────────────────

function buildWANLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 190
  const Y = { sp: 50, hub: 190, cpe: 370, branch: 530, ep: 680 }

  const zones: LLDZone[] = [
    { id: 'z-sp', label: 'SP BACKBONE', sublabel: 'MPLS / Internet Transit · BGP full-table',
      yStart: 0, yEnd: 140, fill: 'rgba(17,17,17,0.9)', stroke: '#374151' },
    { id: 'z-hub', label: 'HQ / HUB SITE', sublabel: 'PE Routers · BGP Route Reflector · MPLS LDP',
      yStart: 140, yEnd: 320, fill: 'rgba(127,29,29,0.10)', stroke: '#B91C1C' },
    { id: 'z-wan', label: 'WAN TRANSPORT', sublabel: 'MPLS L3VPN · SD-WAN · QoS DSCP 6-class',
      yStart: 320, yEnd: 480, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-branch', label: 'BRANCH SITES', sublabel: 'CE Router · Local FW · OSPF Area 10',
      yStart: 480, yEnd: 640, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-ep', label: 'BRANCH ENDPOINTS', sublabel: 'Desktops · VoIP · Local Servers',
      yStart: 640, yEnd: 790, fill: 'rgba(28,25,23,0.10)', stroke: '#57534E' },
  ]

  const [spX] = xCenter(1, 0, 200)
  const sp = mkNode('sp', 'SP-BACKBONE', 'MPLS/Internet', 'internet', 'ISP', spX, Y.sp, 200, 80, {
    icon: '🌐',
    interfaces: [
      { name: 'PE1', ip: '203.0.0.1/30', vlan: 'MPLS Core' },
      { name: 'PE2', ip: '203.0.0.5/30', vlan: 'MPLS Core' },
    ],
    configLines: ['MPLS L3VPN', 'BGP full-table', 'Internet Transit'],
    services: ['MPLS', 'BGP', 'Internet Transit'],
  })

  const [h1x, h2x] = xCenter(2, 200, NW)
  const hub1 = mkNode('hub1', 'HQ-PE-RTR-01', 'ASR-9001', 'wan', 'Cisco', h1x, Y.hub, NW, 110, {
    haRole: 'active', icon: '🔷',
    interfaces: [
      { name: 'Gi0/0/0', ip: '203.0.0.2/30', vlan: 'SP-uplink' },
      { name: 'Gi0/1', ip: '10.0.0.1/30', vlan: 'iBGP peer' },
      { name: 'Lo0', ip: '10.0.0.1/32' },
    ],
    configLines: ['BGP Route Reflector', 'MPLS PE · LDP', 'SR-MPLS Adj-SID', 'BFD multihop 50ms'],
    services: ['BGP RR', 'MPLS', 'SR-MPLS', 'BFD'],
  })
  const hub2 = mkNode('hub2', 'HQ-PE-RTR-02', 'ASR-9001', 'wan', 'Cisco', h2x, Y.hub, NW, 110, {
    haRole: 'standby', icon: '🔷',
    interfaces: [
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
      icon: '🔗',
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
      icon: '🏢',
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
      icon: '💻',
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

function buildMultisiteLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { dci: 50, spine: 190, leaf: 340, srv: 490 }

  const zones: LLDZone[] = [
    { id: 'z-dci', label: 'DCI INTERCONNECT', sublabel: 'EVPN Type-5 · RT 65100:<vni> · BGP multi-AS',
      yStart: 0, yEnd: 140, fill: 'rgba(127,29,29,0.10)', stroke: '#B91C1C' },
    { id: 'z-spine', label: 'SPINE FABRIC', sublabel: 'IS-IS underlay · BGP EVPN overlay · ECMP',
      yStart: 140, yEnd: 290, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-leaf', label: 'LEAF / ToR', sublabel: 'VXLAN NVE · Anycast-GW · vPC domain',
      yStart: 290, yEnd: 430, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-srv', label: 'COMPUTE / STORAGE', sublabel: 'Dual-homed LAG · jumbo 9000 · 25G',
      yStart: 430, yEnd: 600, fill: 'rgba(28,25,23,0.10)', stroke: '#57534E' },
  ]

  const siteASpineXs = xCenter(2, 40, NW)
  const siteBSpineXs = [siteASpineXs[0] + 480, siteASpineXs[1] + 480]

  const dciGw1 = mkNode('dci1', 'DCI-GW-SITE-A', 'N9K-C9504', 'wan', 'Cisco',
    siteASpineXs[0] + NW/2, Y.dci, NW, 90, {
      icon: '🔗', haRole: 'active',
      interfaces: [
        { name: 'e1/1', ip: '172.16.0.1/30', speed: '100G', vlan: 'DCI trunk' },
        { name: 'Lo0', ip: '10.255.0.100/32' },
      ],
      configLines: ['EVPN Type-5 stretched RT', 'RT 65100:10010 (L2)', 'RT 65100:50000 (L3)'],
      services: ['EVPN DCI', 'BGP Multi-AS'],
    })
  const dciGw2 = mkNode('dci2', 'DCI-GW-SITE-B', 'N9K-C9504', 'wan', 'Cisco',
    siteBSpineXs[0] + NW/2, Y.dci, NW, 90, {
      icon: '🔗', haRole: 'active',
      interfaces: [
        { name: 'e1/1', ip: '172.16.0.2/30', speed: '100G', vlan: 'DCI trunk' },
        { name: 'Lo0', ip: '10.255.0.200/32' },
      ],
      configLines: ['EVPN Type-5 stretched RT', 'RT 65100:10010 (L2)', 'RT 65100:50000 (L3)'],
      services: ['EVPN DCI', 'BGP Multi-AS'],
    })

  const mkSiteSpine = (site: string, xs: number[], baseIp: number) =>
    xs.map((x, i) => mkNode(
      `${site}sp${i+1}`, `${site.toUpperCase()}-SPINE-0${i+1}`, 'N9K-C9508', 'spine', 'Cisco', x, Y.spine, NW, 100, {
        icon: '🔷',
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
      `${site}lf${i+1}`, `${site.toUpperCase()}-LEAF-0${i+1}`, 'N9K-C9332C', 'leaf', 'Cisco', x, Y.leaf, NW, 100, {
        icon: '🟢',
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
        icon: '🖥',
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

function buildMulticloudLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { onprem: 50, gw: 200, cloud: 380, workload: 530 }

  const zones: LLDZone[] = [
    { id: 'z-onprem', label: 'ON-PREMISES DC', sublabel: 'Spine-Leaf · VXLAN/EVPN · BGP',
      yStart: 0, yEnd: 150, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-gw', label: 'CLOUD GATEWAY', sublabel: 'DirectConnect · ExpressRoute · Cloud Interconnect',
      yStart: 150, yEnd: 320, fill: 'rgba(180,83,9,0.10)', stroke: '#B45309' },
    { id: 'z-cloud', label: 'CLOUD PROVIDERS', sublabel: 'AWS VPC · Azure VNet · GCP VPC',
      yStart: 320, yEnd: 470, fill: 'rgba(6,78,59,0.10)', stroke: '#065F46' },
    { id: 'z-wl', label: 'CLOUD WORKLOADS', sublabel: 'EC2 · AKS · GKE · Serverless',
      yStart: 470, yEnd: 640, fill: 'rgba(88,28,135,0.10)', stroke: '#7E22CE' },
  ]

  const [s1x, s2x] = xCenter(2, 200, NW)
  const dcSpine1 = mkNode('dcsp1', 'DC-SPINE-01', 'N9K-C9508', 'spine', 'Cisco', s1x, Y.onprem, NW, 90, {
    icon: '🔷',
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.0.x/31', speed: '100G' },
      { name: 'Lo0', ip: '10.255.1.1/32' },
    ],
    configLines: ['IS-IS · BGP EVPN', 'VXLAN NVE overlay'],
    services: ['IS-IS', 'BGP EVPN', 'VXLAN'],
  })
  const dcSpine2 = mkNode('dcsp2', 'DC-SPINE-02', 'N9K-C9508', 'spine', 'Cisco', s2x, Y.onprem, NW, 90, {
    icon: '🔷',
    interfaces: [
      { name: 'e1/1-4', ip: '10.1.1.x/31', speed: '100G' },
      { name: 'Lo0', ip: '10.255.1.2/32' },
    ],
    configLines: ['IS-IS · BGP EVPN', 'VXLAN NVE overlay'],
    services: ['IS-IS', 'BGP EVPN', 'VXLAN'],
  })

  const gwXs = xCenter(3, 40, NW)
  const awsGw = mkNode('awsgw', 'AWS DX Gateway', 'DirectConnect', 'cloud', 'AWS', gwXs[0], Y.gw, NW, 100, {
    icon: '☁',
    interfaces: [
      { name: 'dxcon-01', ip: '169.254.0.1/30', speed: '10G', vlan: 'VLAN 100' },
      { name: 'vgw', ip: '10.200.0.1/24', vlan: 'VPC CIDR' },
    ],
    configLines: ['AWS DirectConnect 10G', 'BGP AS64512', 'Private VIF → VPC'],
    services: ['DirectConnect', 'BGP', 'Private VIF'],
  })
  const azureGw = mkNode('azuregw', 'Azure ER Gateway', 'ExpressRoute', 'cloud', 'Azure', gwXs[1], Y.gw, NW, 100, {
    icon: '☁',
    interfaces: [
      { name: 'er-circuit', ip: '169.254.1.1/30', speed: '10G', vlan: 'VLAN 200' },
      { name: 'vnet-gw', ip: '10.201.0.1/24', vlan: 'VNet CIDR' },
    ],
    configLines: ['ExpressRoute Premium', 'BGP AS12076', 'Private Peering'],
    services: ['ExpressRoute', 'BGP', 'Private Peering'],
  })
  const gcpGw = mkNode('gcpgw', 'GCP Interconnect', 'Cloud Interconnect', 'cloud', 'GCP', gwXs[2], Y.gw, NW, 100, {
    icon: '☁',
    interfaces: [
      { name: 'attach-01', ip: '169.254.2.1/30', speed: '10G', vlan: 'VLAN 300' },
      { name: 'vpc-gw', ip: '10.202.0.1/24', vlan: 'VPC CIDR' },
    ],
    configLines: ['Dedicated Interconnect', 'BGP AS16550', 'Cloud Router'],
    services: ['Dedicated IC', 'BGP', 'Cloud Router'],
  })

  const cloudXs = xCenter(3, 40, NW)
  const awsVpc = mkNode('awsvpc', 'AWS VPC', 'us-east-1', 'cloud', 'AWS', cloudXs[0], Y.cloud, NW, 80, {
    icon: '☁',
    interfaces: [{ name: 'subnet-a', ip: '10.200.1.0/24', vlan: 'Private' }],
    configLines: ['VPC 10.200.0.0/16', 'Security Groups', 'NACLs'],
    services: ['VPC', 'SG', 'NACL'],
  })
  const azureVnet = mkNode('azurevnet', 'Azure VNet', 'eastus2', 'cloud', 'Azure', cloudXs[1], Y.cloud, NW, 80, {
    icon: '☁',
    interfaces: [{ name: 'subnet-a', ip: '10.201.1.0/24', vlan: 'Private' }],
    configLines: ['VNet 10.201.0.0/16', 'NSG · UDR', 'Private Endpoints'],
    services: ['VNet', 'NSG', 'PE'],
  })
  const gcpVpc = mkNode('gcpvpc', 'GCP VPC', 'us-central1', 'cloud', 'GCP', cloudXs[2], Y.cloud, NW, 80, {
    icon: '☁',
    interfaces: [{ name: 'subnet-a', ip: '10.202.1.0/24', vlan: 'Private' }],
    configLines: ['VPC 10.202.0.0/16', 'Firewall Rules', 'Private Google Access'],
    services: ['VPC', 'FW Rules'],
  })

  const wlXs = xCenter(3, 40, 160)
  const awsWl = mkNode('awswl', 'EC2 / EKS', 'i3.2xlarge', 'application', 'AWS', wlXs[0], Y.workload, 160, 80, {
    icon: '⚙',
    interfaces: [{ name: 'eni-0', ip: '10.200.1.10/24' }],
    configLines: ['K8s cluster (EKS)', 'Auto Scaling Group'],
  })
  const azureWl = mkNode('azurewl', 'AKS / VMs', 'Standard_D4', 'application', 'Azure', wlXs[1], Y.workload, 160, 80, {
    icon: '⚙',
    interfaces: [{ name: 'nic-0', ip: '10.201.1.10/24' }],
    configLines: ['AKS managed K8s', 'VM Scale Sets'],
  })
  const gcpWl = mkNode('gcpwl', 'GKE / VMs', 'n2-standard-4', 'application', 'GCP', wlXs[2], Y.workload, 160, 80, {
    icon: '⚙',
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

function buildAviatrixLLD(_devices: BOMDevice[], sc: string): LLDTopo {
  const NW = 180
  const Y = { onprem: 50, transit: 200, spoke: 370, workload: 520 }

  const zones: LLDZone[] = [
    { id: 'z-onprem', label: 'ON-PREMISES', sublabel: 'DC Edge · BGP · IPSec tunnel',
      yStart: 0, yEnd: 150, fill: 'rgba(29,78,216,0.10)', stroke: '#1D4ED8' },
    { id: 'z-transit', label: 'AVIATRIX TRANSIT', sublabel: 'Transit Gateway · BGP over IPSec · FQDN Filter',
      yStart: 150, yEnd: 320, fill: 'rgba(180,83,9,0.10)', stroke: '#B45309' },
    { id: 'z-spoke', label: 'AVIATRIX SPOKES', sublabel: 'Spoke Gateways · Network Segmentation · NAT',
      yStart: 320, yEnd: 460, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-wl', label: 'CLOUD WORKLOADS', sublabel: 'EC2 · AKS · GKE · Cloud-native',
      yStart: 460, yEnd: 640, fill: 'rgba(88,28,135,0.10)', stroke: '#7E22CE' },
  ]

  const [e1x, e2x] = xCenter(2, 200, NW)
  const edge1 = mkNode('edge1', 'DC-EDGE-RTR-01', 'ASR-1002-HX', 'wan', 'Cisco', e1x, Y.onprem, NW, 90, {
    haRole: 'active', icon: '🔷',
    interfaces: [
      { name: 'Gi0/0/0', ip: '10.0.0.1/30', vlan: 'WAN' },
      { name: 'Tu1', ip: '169.254.10.1/30', vlan: 'IPSec to Transit' },
      { name: 'Lo0', ip: '10.255.0.1/32' },
    ],
    configLines: ['BGP AS65000', 'IPSec IKEv2 tunnel', 'BFD over tunnel'],
    services: ['BGP', 'IPSec', 'BFD'],
  })
  const edge2 = mkNode('edge2', 'DC-EDGE-RTR-02', 'ASR-1002-HX', 'wan', 'Cisco', e2x, Y.onprem, NW, 90, {
    haRole: 'standby', icon: '🔷',
    interfaces: [
      { name: 'Gi0/0/0', ip: '10.0.0.5/30', vlan: 'WAN' },
      { name: 'Tu1', ip: '169.254.10.5/30', vlan: 'IPSec to Transit' },
      { name: 'Lo0', ip: '10.255.0.2/32' },
    ],
    configLines: ['BGP AS65000', 'IPSec IKEv2 backup', 'BFD'],
    services: ['BGP', 'IPSec', 'BFD'],
  })

  const txXs = xCenter(3, 40, NW)
  const txAws = mkNode('txaws', 'Aviatrix Transit GW', 'AWS us-east-1', 'transit', 'Aviatrix', txXs[0], Y.transit, NW, 100, {
    icon: '🔶',
    interfaces: [
      { name: 'eth0', ip: '10.200.0.10/24', vlan: 'Transit VPC' },
      { name: 'tun-onprem', ip: '169.254.10.2/30', vlan: 'IPSec' },
    ],
    configLines: ['Transit Gateway (HA)', 'BGP AS64512', 'FQDN Egress Filter', 'HPE (High Perf Encryption)'],
    services: ['BGP', 'IPSec', 'FQDN', 'HPE'],
  })
  const txAzure = mkNode('txazure', 'Aviatrix Transit GW', 'Azure eastus2', 'transit', 'Aviatrix', txXs[1], Y.transit, NW, 100, {
    icon: '🔶',
    interfaces: [
      { name: 'eth0', ip: '10.201.0.10/24', vlan: 'Transit VNet' },
      { name: 'peering', ip: '10.201.0.100/30', vlan: 'Multi-cloud peering' },
    ],
    configLines: ['Transit Gateway', 'BGP AS64513', 'Connected Transit', 'Multi-cloud peering'],
    services: ['BGP', 'Connected Transit'],
  })
  const txGcp = mkNode('txgcp', 'Aviatrix Transit GW', 'GCP us-central1', 'transit', 'Aviatrix', txXs[2], Y.transit, NW, 100, {
    icon: '🔶',
    interfaces: [
      { name: 'eth0', ip: '10.202.0.10/24', vlan: 'Transit VPC' },
      { name: 'peering', ip: '10.202.0.100/30', vlan: 'Multi-cloud peering' },
    ],
    configLines: ['Transit Gateway', 'BGP AS64514', 'Segmentation Domain', 'Network Domain: Prod'],
    services: ['BGP', 'Segmentation'],
  })

  const spXs = xCenter(3, 40, NW)
  const spAws = mkNode('spaws', 'AWS Spoke GW', 'us-east-1a/b', 'spoke', 'Aviatrix', spXs[0], Y.spoke, NW, 80, {
    icon: '🟢',
    interfaces: [{ name: 'eth0', ip: '10.200.1.10/24', vlan: 'Spoke VPC' }],
    configLines: ['Spoke Gateway (HA)', 'Network Domain: Prod', 'NAT + SNAT'],
  })
  const spAzure = mkNode('spazure', 'Azure Spoke GW', 'eastus2', 'spoke', 'Aviatrix', spXs[1], Y.spoke, NW, 80, {
    icon: '🟢',
    interfaces: [{ name: 'eth0', ip: '10.201.1.10/24', vlan: 'Spoke VNet' }],
    configLines: ['Spoke Gateway', 'Network Domain: Dev', 'FQDN Filter'],
  })
  const spGcp = mkNode('spgcp', 'GCP Spoke GW', 'us-central1', 'spoke', 'Aviatrix', spXs[2], Y.spoke, NW, 80, {
    icon: '🟢',
    interfaces: [{ name: 'eth0', ip: '10.202.1.10/24', vlan: 'Spoke VPC' }],
    configLines: ['Spoke Gateway', 'Network Domain: Staging', 'Smart Egress'],
  })

  const wlXs = xCenter(3, 40, 160)
  const wlAws = mkNode('wlaws', 'EC2 / EKS', 'Prod workloads', 'application', 'AWS', wlXs[0], Y.workload, 160, 80, {
    icon: '⚙',
    interfaces: [{ name: 'eni-0', ip: '10.200.1.100/24' }],
    configLines: ['Production EKS', 'Auto Scaling Group'],
  })
  const wlAzure = mkNode('wlazure', 'AKS / VMs', 'Dev workloads', 'application', 'Azure', wlXs[1], Y.workload, 160, 80, {
    icon: '⚙',
    interfaces: [{ name: 'nic-0', ip: '10.201.1.100/24' }],
    configLines: ['Development AKS', 'VM Scale Sets'],
  })
  const wlGcp = mkNode('wlgcp', 'GKE / VMs', 'Staging workloads', 'application', 'GCP', wlXs[2], Y.workload, 160, 80, {
    icon: '⚙',
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
      yStart: 0, yEnd: 140, fill: 'rgba(30,13,80,0.10)', stroke: '#3730A3' },
    { id: 'z-mid', label: 'MIDHAUL + O-CU', sublabel: 'SR-MPLS transport · PTP boundary-clock · F1/E1 · NG to AMF',
      yStart: 140, yEnd: 300, fill: 'rgba(146,64,14,0.10)', stroke: '#92400E' },
    { id: 'z-fh', label: 'FRONTHAUL SWITCH', sublabel: 'eCPRI Class C7 · PTP transparent-clock · PFC · 9216 MTU',
      yStart: 300, yEnd: 470, fill: 'rgba(21,128,61,0.10)', stroke: '#15803D' },
    { id: 'z-du', label: 'O-DU (DISTRIBUTED UNIT)', sublabel: 'High-PHY/MAC/RLC · FAPI · L1 FPGA offload · eCPRI 25G',
      yStart: 470, yEnd: 640, fill: 'rgba(8,40,64,0.10)', stroke: '#0E7490' },
    { id: 'z-ru', label: 'O-RU (RADIO UNIT)', sublabel: 'Low-PHY/RF · 64T64R mMIMO · n78 3.5GHz · beamforming',
      yStart: 640, yEnd: 810, fill: 'rgba(61,30,8,0.10)', stroke: '#9A3412' },
  ]

  const [coreX, gmX] = xCenter(2, 260, NW)
  const upf = mkNode('upf', '5GC-UPF-01', '5G Core UPF', 'oran-core', 'Dell EMC', coreX, Y.core, NW, 110, {
    haRole: 'active', icon: '🛰',
    interfaces: [
      { name: 'N3', ip: '10.250.0.1/30', speed: '100G', vlan: 'GTP-U' },
      { name: 'N6', ip: '10.250.6.1/24', speed: '100G', vlan: 'Data Network' },
      { name: 'N4', ip: '10.250.4.1/30', vlan: 'PFCP' },
    ],
    configLines: ['N3 GTP-U decap · DPDK', 'N6 → enterprise DNN', 'N4 PFCP to SMF', '5QI→DSCP QoS map'],
    services: ['UPF', 'GTP-U', 'PFCP', 'DPDK'],
    specs: 'COTS + SmartNIC offload',
  })
  const gm = mkNode('ptpgm', 'PTP-GM-01', 'Calnex PTP GM', 'oran-timing', 'Calnex', gmX, Y.core, NW, 110, {
    icon: '⏱',
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
    haRole: 'active', icon: '🔗',
    interfaces: [
      { name: 'Gi0/0/0/0', ip: '10.250.10.1/30', speed: '100G', vlan: 'upstream/core' },
      { name: 'Gi0/0/0/1', ip: '10.250.11.1/30', speed: '100G', vlan: 'midhaul/DU' },
      { name: 'Lo0', ip: '10.250.1.1/32' },
    ],
    configLines: ['IS-IS + SR-MPLS', 'PTP boundary-clock', 'SyncE freq-sync', 'prefix-sid index 100'],
    services: ['SR-MPLS', 'IS-IS', 'PTP-BC', 'SyncE'],
    specs: 'Timing-grade aggregation',
  })
  const cu = mkNode('cu1', 'O-CU-01', 'O-CU Server', 'oran-cu', 'Dell EMC', cuX, Y.mid, NW, 120, {
    icon: '🧠',
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
    icon: '📡',
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
      icon: '🖥',
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
      icon: '📶',
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

function buildLLDTopology(devices: BOMDevice[], useCase: string, sc: string): LLDTopo {
  switch (useCase) {
    case 'campus':     return buildCampusLLD(devices, sc)
    case 'gpu':        return buildGPULLD(devices, sc)
    case 'wan':        return buildWANLLD(devices, sc)
    case 'multisite':  return buildMultisiteLLD(devices, sc)
    case 'multicloud': return buildMulticloudLLD(devices, sc)
    case 'aviatrix':   return buildAviatrixLLD(devices, sc)
    case 'oran':       return buildORANLLD(devices, sc)
    default:           return buildDCLLD(devices, sc)
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
          onClick={(e) => { if (e.currentTarget === e.target) setSelectedNode(null) }}
        >
          {/* Background */}
          <rect width={SVG_W} height={topo.svgH} fill="#080E1A" />

          {/* Security zones */}
          {topo.zones.map(z => (
            <g key={z.id}>
              <rect x={0} y={z.yStart} width={SVG_W} height={z.yEnd - z.yStart}
                fill={z.fill} stroke={z.stroke} strokeWidth={0.5} opacity={0.9} />
              <text x={8} y={z.yStart + 18} fill={z.stroke} fontSize={8} fontWeight="700" opacity={0.85}>
                {z.label}
              </text>
              <text x={8} y={z.yStart + 32} fill={z.stroke} fontSize={6.5} opacity={0.55}>
                {z.sublabel}
              </text>
              <line x1={LEFT_W - 4} y1={z.yStart} x2={LEFT_W - 4} y2={z.yEnd}
                stroke={z.stroke} strokeWidth={0.4} opacity={0.3} />
            </g>
          ))}

          {/* Title */}
          <text x={LEFT_W + 8} y={22} fill="#E2E8F0" fontSize={12} fontWeight="700">{topo.title}</text>
          <text x={LEFT_W + 8} y={38} fill="#64748B" fontSize={8.5}>{topo.subtitle}</text>

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
                      textAnchor={x2 > x1 ? 'start' : 'end'} fill="#64748B" fontSize={5.5}>
                      {link.fromPort}
                    </text>
                    <text x={x2 + (x1 > x2 ? 8 : -8)} y={y2n - 4}
                      textAnchor={x1 > x2 ? 'start' : 'end'} fill="#64748B" fontSize={5.5}>
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
                    <text x={midX} y={midY + 10} textAnchor="middle" fill="#475569" fontSize={6}>
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

                {/* Icon + hostname */}
                <text x={6} y={16} fill={node.textColor} fontSize={6}>
                  {node.icon}
                </text>
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
                    <text x={6} y={42 + i * 11} fill="#475569" fontSize={5.5} fontWeight="600">
                      {iface.name}
                    </text>
                    <text x={node.w / 2 - 10} y={42 + i * 11} fill="#60A5FA" fontSize={5.5}>
                      {iface.ip}
                    </text>
                    {iface.vlan && (
                      <text x={node.w - 6} y={42 + i * 11} textAnchor="end" fill="#6B7280" fontSize={5}>
                        {iface.vlan}
                      </text>
                    )}
                  </g>
                ))}

                {/* Config lines */}
                {node.configLines.slice(0, 2).map((line, i) => (
                  <text key={line} x={6} y={42 + Math.min(node.interfaces.length, 3) * 11 + i * 10}
                    fill="#9CA3AF" fontSize={5.5} opacity={0.7}>
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
          <text x={LEFT_W + 8} y={topo.svgH - 22} fill="#475569" fontSize={7}>
            ━━ Active link  · · · HA sync / Peer  ·  Hover link for port details  ·  Click device for full specs
          </text>
          <text x={SVG_W - RIGHT_PAD} y={topo.svgH - 22} textAnchor="end" fill="#7E22CE" fontSize={7} opacity={0.6}>
            ⚡ NetDesign AI LLD
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
            <button onClick={() => setSelectedNode(null)}
              className="text-gray-600 hover:text-gray-300 transition-colors text-base cursor-pointer">✕</button>
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
