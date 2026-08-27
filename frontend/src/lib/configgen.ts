/**
 * configgen.ts — Device configuration generators
 *
 * Design rules (enforced here):
 *  1. Each function emits ONE complete, self-contained config block — no
 *     "POLICY BLOCKS appended" sections that duplicate AAA/SNMP/NTP.
 *  2. Underlay = IS-IS for DC/GPU spine-leaf; OSPF for campus/WAN.
 *     Never both simultaneously.
 *  3. All credentials use <CHANGE-ME-*> placeholders. Never commit real secrets.
 *  4. Firewall roles produce zone-based / vendor-native configs, not router configs.
 *  5. GPU QoS includes ECN, WRED, PFC priority-3, DCQCN buffer carving.
 */

import type { AppType, BOMDevice, UseCase } from '@/types'
import { applyPolicies } from '@/lib/policies'

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Single management block used exactly once per config. */
function mgmtBlock(hostname: string, mgmtVlan = 10): string {
  return `
! ── MANAGEMENT ──────────────────────────────────────────────────────────────────
hostname ${hostname}
!
ip domain-name <CHANGE-ME-domain.example.com>
ip name-server 8.8.8.8
service timestamps log datetime msec localtime show-timezone
service timestamps debug datetime msec
service password-encryption
no service pad
no ip http server
ip http secure-server
ip http authentication aaa
no ip source-route
no ip bootp server
login block-for 60 attempts 5 within 30
login delay 2
!
! ── MANAGEMENT SERVICES (AA1) ───────────────────────────────────────────────
! mgmtBlock previously had NO ntp/syslog/snmp at all — V-07 only passed
! because RE_MGMT matched the word MANAGEMENT in the comment banner above.
! Once Z6 stopped counting comments as configuration, every device built on
! this block was correctly reported as having no management plane.
ntp server <CHANGE-ME-ntp-primary> prefer
ntp server <CHANGE-ME-ntp-secondary>
ntp source Loopback0
!
logging host <CHANGE-ME-syslog-ip>
logging source-interface Loopback0
logging trap informational
!
snmp-server group NETDESIGN-RO v3 priv
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes 128 <CHANGE-ME-snmp-priv-pass>
snmp-server host <CHANGE-ME-nms-ip> version 3 priv netmon
snmp-server location <CHANGE-ME-site-location>
snmp-server contact <CHANGE-ME-noc-email>
!
banner motd ^
*******************************************************************************
*  ${hostname} — Authorized access only.  All activity is monitored.        *
*  Disconnect IMMEDIATELY if not an authorized user.                           *
*******************************************************************************
^
!
ip access-list standard MGMT-ACL
 permit <CHANGE-ME-mgmt-subnet> 0.0.0.255
 deny   any log
!
! Credentials — replace placeholders before deploying
username admin privilege 15 algorithm-type sha256 secret <CHANGE-ME-admin-password>
enable  algorithm-type sha256 secret <CHANGE-ME-enable-secret>
!
aaa new-model
!
tacacs server TACACS-PRIMARY
 address ipv4 <CHANGE-ME-tacacs-primary-ip>
 key <CHANGE-ME-tacacs-key>
 timeout 3
 single-connection
!
tacacs server TACACS-SECONDARY
 address ipv4 <CHANGE-ME-tacacs-secondary-ip>
 key <CHANGE-ME-tacacs-key>
 timeout 3
!
aaa group server tacacs+ TACACS-GROUP
 server name TACACS-PRIMARY
 server name TACACS-SECONDARY
 ip tacacs source-interface Vlan${mgmtVlan}
!
aaa authentication login default group TACACS-GROUP local
aaa authentication enable default group TACACS-GROUP enable
aaa authorization console
aaa authorization exec     default group TACACS-GROUP local if-authenticated
aaa authorization commands  1 default group TACACS-GROUP local if-authenticated
aaa authorization commands 15 default group TACACS-GROUP local if-authenticated
aaa accounting exec     default start-stop group TACACS-GROUP
aaa accounting commands  1 default start-stop group TACACS-GROUP
aaa accounting commands 15 default start-stop group TACACS-GROUP
!
! SNMP v3 only — no community strings
no snmp-server system-shutdown
snmp-server view NETDESIGN-VIEW iso included
snmp-server group NETDESIGN-RO v3 priv read  NETDESIGN-VIEW
snmp-server group NETDESIGN-RW v3 priv write NETDESIGN-VIEW
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes 128 <CHANGE-ME-snmp-priv-pass>
snmp-server host <CHANGE-ME-nms-ip> traps version 3 priv netmon
snmp-server enable traps bgp
snmp-server enable traps envmon
snmp-server enable traps interface
!
ntp authenticate
ntp authentication-key 1 md5 <CHANGE-ME-ntp-key>
ntp trusted-key 1
ntp source Vlan${mgmtVlan}
ntp server <CHANGE-ME-ntp-primary> prefer key 1
ntp server <CHANGE-ME-ntp-secondary> key 1
clock timezone UTC 0 0
!
logging host <CHANGE-ME-syslog-ip>
logging trap informational
logging source-interface Vlan${mgmtVlan}
!
ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
ip ssh source-interface Vlan${mgmtVlan}
!
line vty 0 15
 access-class MGMT-ACL in
 exec-timeout 10 0
 transport input ssh
 logging synchronous
!`
}

// ── NX-OS Spine ───────────────────────────────────────────────────────────────

function nxosSpineConfig(dev: BOMDevice, idx: number, isGpu: boolean, allDevices: BOMDevice[] = [], protoFeatures: string[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const spineAsn = 65000
  const routerId = roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
  // Real eBGP leaf peers derived from the fabric (leaf lo0 = 10.255.2.(i+1),
  // leaf ASN = 65001+i — matches nxosLeafConfig). eBGP EVPN: per-leaf remote-as,
  // NO route-reflector-client (RR is iBGP-only).
  const leafPeerLines = allDevices
    .filter(d => d.subLayer === 'leaf')
    .map((d, i) => `  neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)}\n    inherit peer LEAF-PEER\n    remote-as ${65000 + Math.floor(i / 2) + 1}\n    description ${d.hostname || `LEAF-${i + 1}`}`)
    .join('\n')
  const spineBgpNeighbors = leafPeerLines || '  ! No leaves in fabric — add: neighbor <leaf-lo0>\\n    inherit peer LEAF-PEER\\n    remote-as <leaf-asn>'
  const isisNet  = `49.0001.0102.5500.${String(idx + 1).padStart(4, '0')}.00`
  const ipv6Underlay = protoFeatures.includes('IPv6 Dual-Stack')
  const routerIdV6 = `fd00:255:1::${idx + 1}`
  const fabricLinks = renderNxosFabricLinks('spine', dev, allDevices, ipv6Underlay)
  // Z3: the firewall handoff moved OFF the spine. An eBGP spine is not a VTEP
  // and holds no tenant VRF, so it could never route firewall traffic into
  // TENANT-A — the handoff now lives on the border leaves.
  const fwHandoffBlock = ''

  // GPU fabric: ECN + DCQCN + PFC lossless queuing.
  // Non-GPU: standard 4-class DSCP queuing.
  const qosBlock = isGpu ? nxosGpuQoS() : nxosStdQoS()

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : DC Spine (Route-Reflector + IS-IS ABR)
! Model  : ${dev.model}
! Vendor : ${dev.vendor}
! Generated by NetDesign AI — $(date -u +%Y-%m-%dT%H:%MZ)
! IMPORTANT: Replace all <CHANGE-ME-*> tokens before deploying.
! ═══════════════════════════════════════════════════════════════

version 10.3(x) Bios:version
!
hostname ${dev.hostname}
!
! ── FEATURES ────────────────────────────────────────────────────────────────────
feature isis
feature bgp
feature pim
feature nxapi
feature interface-vlan
feature vn-segment-vlan-based
feature nv overlay
!
! Enables the EVPN control plane (§10) — without it the l2vpn evpn AF,
! the evpn MAC-VRF block and host-reachability protocol bgp are inert (Z1).
nv overlay evpn
feature lldp
feature lacp
feature bfd
!
! Multihop BFD parameters for the loopback-sourced eBGP sessions (Z5b/M-4).
bfd multihop interval 250 min_rx 250 multiplier 3
feature telemetry
!
! ── MANAGEMENT ──────────────────────────────────────────────────────────────────
ip domain-name <CHANGE-ME-domain.example.com>
ip name-server <CHANGE-ME-dns-ip>
!
banner motd ^
*******************************************************************************
*  ${dev.hostname} — Authorized access only. All sessions are monitored.    *
*  Disconnect immediately if not an authorized user.                           *
*******************************************************************************
^
!
username admin password <CHANGE-ME-admin-password> role network-admin
!
feature tacacs+
tacacs-server host <CHANGE-ME-tacacs-primary-ip> key <CHANGE-ME-tacacs-key>
tacacs-server host <CHANGE-ME-tacacs-secondary-ip> key <CHANGE-ME-tacacs-key>
aaa group server tacacs+ TACACS-GROUP
  server <CHANGE-ME-tacacs-primary-ip>
  server <CHANGE-ME-tacacs-secondary-ip>
aaa authentication login default group TACACS-GROUP local
aaa authorization exec default group TACACS-GROUP local
aaa accounting default group TACACS-GROUP
!
snmp-server user netmon network-operator auth sha <CHANGE-ME-snmp-auth-pass> priv <CHANGE-ME-snmp-priv-pass>
!
ntp server <CHANGE-ME-ntp-primary> prefer
ntp server <CHANGE-ME-ntp-secondary>
ntp source-interface mgmt0
!
logging server <CHANGE-ME-syslog-ip> 6 use-vrf management
logging source-interface mgmt0
!
ssh version 2
ip ssh source-interface mgmt0
!
! ── MANAGEMENT VRF ───────────────────────────────────────────────────────────
vrf context management
  ip route 0.0.0.0/0 <CHANGE-ME-oob-gateway>
!
interface mgmt0
  vrf member management
  ip address <CHANGE-ME-mgmt-ip>/24
  no shutdown
!
! ── LOOPBACK INTERFACES ───────────────────────────────────────────────────────
interface loopback0
  description ROUTER-ID / BGP / IS-IS SOURCE
  ip address ${routerId}/32
  ip router isis 1${nxosIpv6LoopbackLines(routerIdV6, ipv6Underlay)}
  no shutdown
!
! ── UNDERLAY: IS-IS (single protocol — not combined with OSPF) ───────────────
! IS-IS is selected for DC spine-leaf: faster convergence, no DR election,
! lower overhead than OSPF in large-scale flat networks.
router isis 1
  net ${isisNet}
  is-type level-2-only
  address-family ipv4 unicast
    maximum-paths 64
    redistribute direct route-map CONNECTED-TO-ISIS
${nxosIsisIpv6AddressFamily(ipv6Underlay, true)}  log-adjacency-changes
  metric-style transition
!
! ── BGP / EVPN OVERLAY ───────────────────────────────────────────────────────
router bgp ${spineAsn}
  router-id ${routerId}
  bestpath as-path multipath-relax
  log-neighbor-changes
  address-family ipv4 unicast
    maximum-paths 64
    redistribute direct route-map CONNECTED-TO-BGP
  address-family l2vpn evpn
    retain route-target all
  !
  ! eBGP EVPN spine — peer template holds the common config; each leaf
  ! neighbor sets its own remote-as (unique leaf ASN). No route-reflector-
  ! client (that is iBGP-only; this is an eBGP Clos fabric per RFC 7938).
  ! ebgp-multihop: loopback-to-loopback eBGP is 2 hops (Y1).
  ! NH-UNCHANGED: the spine must NOT rewrite the EVPN next-hop to itself —
  ! it is not a VTEP; leaves must tunnel directly to the remote VTEP (Y1).
  template peer LEAF-PEER
    update-source loopback0
    ebgp-multihop 2
    timers 3 9
    ! Z5b/M-4: a plain bfd statement only arms SINGLE-hop BFD. These sessions
    ! run over the loopback (ebgp-multihop 2), so without the multihop keyword
    ! — and the matching global bfd multihop interval — the session has no BFD
    ! at all and falls back to the 9s hold timer.
    bfd multihop
    address-family ipv4 unicast
      soft-reconfiguration inbound always
    address-family l2vpn evpn
      send-community both
      route-map NH-UNCHANGED out
  !
  ! ── Leaf eBGP peers (auto-generated from the fabric) ──────────────────────
${spineBgpNeighbors}
!
! ── SPINE FABRIC INTERFACES (topology-driven from BOM port-math) ────────────
${fabricLinks}
${fwHandoffBlock}
!
${qosBlock}
!
! ── TELEMETRY (gRPC to collector) ────────────────────────────────────────────
telemetry
  destination-group 1
    ip address <CHANGE-ME-telemetry-collector-ip> port 57500 protocol gRPC encoding GPB
  sensor-group 1
    data-source NX-API
    path sys/intf depth unbounded
  sensor-group 2
    data-source NX-API
    path sys/bgp depth unbounded
  sensor-group 3
    data-source NX-API
    path sys/isis depth unbounded
  subscription 1
    dst-grp 1
    snsr-grp 1 sample-interval 10000
    snsr-grp 2 sample-interval 30000
    snsr-grp 3 sample-interval 30000
!
! ── ROUTE MAPS ───────────────────────────────────────────────────────────────
route-map CONNECTED-TO-ISIS permit 10
  match tag 100
route-map CONNECTED-TO-BGP  permit 10
  match ip address prefix-list LOOPBACKS
route-map NH-UNCHANGED permit 10
  set ip next-hop unchanged
ip prefix-list LOOPBACKS seq 5 permit 10.255.0.0/16 ge 32
ip prefix-list LOOPBACKS seq 10 permit 10.254.0.0/16 ge 32
`
}

// ── HA-pair helper (vPC / MLAG / HSRP / VRRP / STP root pairing) ───────────────
// Devices within a layer are deployed as HA pairs: idx 0&1 share pair 1, idx
// 2&3 share pair 2, etc. (matches generateHostnames() in bom.ts, which assigns
// rack letters per pair and alternates the trailing 01/02 unit number within a
// pair). isPrimary (even idx) is the active/root member of the pair.
/**
 * Index of a device WITHIN ITS OWN TIER (Z5/M-7). Everything role-scoped — the
 * vPC/MLAG pair id, the loopback, the ASN — used the GLOBAL device index, so
 * an ODD number of preceding devices (three spines, say) split an HA pair
 * across two pairIds: mismatched vPC domain, anycast VTEP, peer-link and ASN.
 * Fabric-fatal and completely silent. Falls back to the caller's index when
 * `allDevices` is empty (single-device calls).
 */
export function roleIndex(dev: BOMDevice, allDevices: BOMDevice[], fallback: number): number {
  if (!allDevices.length) return fallback
  const i = allDevices.filter(d => d.subLayer === dev.subLayer).findIndex(d => d.id === dev.id)
  return i >= 0 ? i : fallback
}

export function haPairInfo(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): { pairId: number; isPrimary: boolean; peerHostname: string; domainId: string } {
  const tierIdx = roleIndex(dev, allDevices, idx)
  const pairId = Math.floor(tierIdx / 2) + 1
  const isPrimary = tierIdx % 2 === 0
  const peerHostname = dev.hostname.replace(/0([12])$/, (_m, n) => (n === '1' ? '02' : '01'))
  const domainId = dev.hostname.replace(/0[12]$/, '')
  return { pairId, isPrimary, peerHostname, domainId }
}

// ── CLOS fabric link plan (Enterprise upgrade A5) ──────────────────────────────
// Derives real spine↔leaf P2P links from buildDeviceList() port-math
// (dev.uplinks / dev.ports) instead of a single static "replicate per cabling
// matrix" comment. Each leaf's uplink ports are distributed round-robin across
// the spines; spine configs derive the matching reverse links so both ends of
// every link agree on the /31 subnet without manual cabling notes.
interface FabricLink {
  /** 0-based index among this device's fabric-facing ports */
  ifIndex: number
  peerHostname: string
  /** human-readable peer description, e.g. "spine 1" or "leaf 3" */
  peerLabel: string
  /** 0-based parallel-link number between this device and its peer */
  linkNum: number
  /** local-side P2P /31 address, e.g. "10.99.3.17/31" */
  localIp: string
  /** local-side P2P IPv6 /127 address (Enterprise upgrade A6), e.g. "fd00:99:3::11/127" */
  localIpv6: string
}

function closFabricLinks(role: 'spine' | 'leaf', dev: BOMDevice, allDevices: BOMDevice[]): FabricLink[] {
  const spines = allDevices.filter(d => d.subLayer === 'spine')
  const leaves = allDevices.filter(d => d.subLayer === 'leaf')
  const spineCount = spines.length || 2
  const leafCount = leaves.length || 1
  const leafUplinks = leaves[0]?.uplinks || dev.uplinks || 2

  const links: FabricLink[] = []

  // Y2: leaf uplink i lands on spine (leafIdx + i) % spineCount — STAGGERED
  // round-robin. The old `i % spineCount` start-at-spine-1 scheme meant every
  // leaf wired the same first `uplinks` spines: with uplinks < spineCount the
  // remaining spines were completely dark (yet still BGP-peered), and the
  // first spines absorbed more links than they have ports.
  // Z7: a FLAT /31 index inside 10.99.0.0/16 (32 768 links). The old
  // `10.99.<leafNum>.<(spineNum-1)*16 + linkNum*2>` scheme silently emitted
  // invalid addresses past 254 leaves or 16 spines. Both ends derive the same
  // index from (leafIdx, spineIdx, linkNum), so the /31 still matches.
  const maxParallel = Math.max(1, Math.ceil(leafUplinks / spineCount))
  const perLeaf = spineCount * maxParallel
  const p2pIndex = (leafIdx: number, spineIdx: number, linkNum: number) =>
    leafIdx * perLeaf + spineIdx * maxParallel + linkNum

  if (role === 'leaf') {
    const leafIdx = Math.max(0, leaves.findIndex(d => d.id === dev.id))
    const leafNum = leafIdx + 1
    for (let i = 0; i < leafUplinks; i++) {
      const spineIdx = (leafIdx + i) % spineCount
      const linkNum = Math.floor(i / spineCount)
      const spineNum = spineIdx + 1
      const octet = (spineNum - 1) * 16 + linkNum * 2
      links.push({
        ifIndex: i,
        peerHostname: spines[spineIdx]?.hostname || `SPINE-${spineNum}`,
        peerLabel: `spine ${spineNum}`,
        linkNum,
        localIp: `${ipAdd('10.99.1.0', p2pIndex(leafIdx, spineIdx, linkNum) * 2 + 1)}/31`,
        localIpv6: `fd00:99:${leafNum}::${octet + 1}/127`,
      })
    }
  } else {
    const spineIdx = Math.max(0, spines.findIndex(d => d.id === dev.id))
    const spineNum = spineIdx + 1
    let ifIndex = 0
    for (let leafNum = 1; leafNum <= leafCount; leafNum++) {
      const leafIdx = leafNum - 1
      for (let i = 0; i < leafUplinks; i++) {
        if ((leafIdx + i) % spineCount !== spineIdx) continue
        const linkNum = Math.floor(i / spineCount)
        const octet = (spineNum - 1) * 16 + linkNum * 2
        links.push({
          ifIndex: ifIndex++,
          peerHostname: leaves[leafNum - 1]?.hostname || `LEAF-${leafNum}`,
          peerLabel: `leaf ${leafNum}`,
          linkNum,
          localIp: `${ipAdd('10.99.1.0', p2pIndex(leafIdx, spineIdx, linkNum) * 2)}/31`,
          localIpv6: `fd00:99:${leafNum}::${octet}/127`,
        })
      }
    }
    // A spine cannot terminate more links than it has ports; anything beyond
    // is a design error already flagged by validateBOM's fan-out warning.
    if (dev.ports && links.length > dev.ports) links.length = dev.ports
  }
  return links
}

/** Gbps value of a speed label ('400G'→400, '1T'→1000, '10G'→10). */
function speedToGbps(speed: string | undefined): number {
  const m = /([\d.]+)\s*(t|g|m)?/i.exec((speed || '').trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  if (!isFinite(n) || n <= 0) return 0
  const u = (m[2] || 'g').toLowerCase()
  return u === 't' ? n * 1000 : u === 'm' ? n / 1000 : n
}

/**
 * Fabric rate mismatch (Z2). Most spine SKUs in the catalog are 400G while
 * leaf uplinks are 100G, so the spine's QSFP-DD cage has to be told to run the
 * 100G optic the BOM bills — left on its native rate the port simply never
 * links. Returns the rate to pin on the LOCAL side, or null when both ends of
 * the fabric link already run at the same speed.
 */
function fabricRateMismatch(
  role: 'spine' | 'leaf',
  dev: BOMDevice,
  allDevices: BOMDevice[],
): { localGbps: number; linkGbps: number; linkSpeed: string } | null {
  const peers = allDevices.filter(d => d.subLayer === (role === 'spine' ? 'leaf' : 'spine'))
  if (!peers.length) return null
  // A leaf reaches the fabric on its dedicated uplink block when it has one.
  const localSpeed = role === 'leaf' ? (dev.uplinkSpeed ?? dev.speed) : dev.speed
  const peerSpeed = role === 'spine' ? (peers[0].uplinkSpeed ?? peers[0].speed) : peers[0].speed
  const localGbps = speedToGbps(localSpeed)
  const peerGbps = speedToGbps(peerSpeed)
  if (!localGbps || !peerGbps || localGbps <= peerGbps) return null
  return { localGbps, linkGbps: peerGbps, linkSpeed: peerSpeed }
}

/**
 * Renders CLOS fabric links as NX-OS (IS-IS, `Ethernet1/N`) interface stanzas.
 * `ipv6Enabled` (Enterprise upgrade A6) adds a matching IPv6 /127 address and
 * `ipv6 router isis 1` for dual-stack underlay.
 */
function renderNxosFabricLinks(role: 'spine' | 'leaf', dev: BOMDevice, allDevices: BOMDevice[], ipv6Enabled = false): string {
  const links = closFabricLinks(role, dev, allDevices)
  // Leaf uplinks go on the SKU's DEDICATED uplink range when it has one
  // (93180YC-FX: Eth1/49-54 — fabric links on 25G server ports won't come up
  // against 100G spine ports, Y2); otherwise the top of the shared port block.
  const portBase = role === 'leaf'
    ? (dev.uplinkStart ? dev.uplinkStart - 1 : Math.max(0, (dev.ports || 48) - (dev.uplinks || 0)))
    : 0
  const dirLabel = role === 'leaf' ? 'UPLINK' : 'DOWNLINK'
  const rate = fabricRateMismatch(role, dev, allDevices)
  // Z2: pin the rate when the two ends are not native-matched (400G cage
  // running the 100G optic the BOM bills). `speed` is in Mbps on NX-OS.
  const rateLine = rate ? `
  speed ${rate.linkGbps * 1000}` : ''
  return links.map(link => `interface Ethernet1/${portBase + link.ifIndex + 1}
  description ${dirLabel}: ${link.peerHostname} (${link.peerLabel}, link ${link.linkNum + 1})
  no switchport${rateLine}
  mtu 9216
  ip address ${link.localIp}
  ip router isis 1${ipv6Enabled ? `
  ipv6 address ${link.localIpv6}
  ipv6 router isis 1` : ''}
  isis network point-to-point
  isis metric 10
  no shutdown`).join('\n!\n')
}

/**
 * Renders CLOS fabric links as Arista EOS (IS-IS, `EthernetN`) interface stanzas.
 * `ipv6Enabled` (Enterprise upgrade A6) adds a matching IPv6 /127 address —
 * `isis enable UNDERLAY` already covers both AFs once IS-IS IPv6 AF is active.
 */
function renderAristaFabricLinks(role: 'spine' | 'leaf', dev: BOMDevice, allDevices: BOMDevice[], ipv6Enabled = false): string {
  const links = closFabricLinks(role, dev, allDevices)
  const portBase = role === 'leaf'
    ? (dev.uplinkStart ? dev.uplinkStart - 1 : Math.max(0, (dev.ports || 32) - (dev.uplinks || 0)))
    : 0
  const dirLabel = role === 'leaf' ? 'UPLINK' : 'DOWNLINK'
  const rate = fabricRateMismatch(role, dev, allDevices)
  const rateLine = rate ? `
  speed forced ${rate.linkGbps}gfull` : ''
  return links.map(link => `interface ${aristaIf(dev, portBase + link.ifIndex + 1)}
  description ${dirLabel}: ${link.peerHostname} (${link.peerLabel}, link ${link.linkNum + 1})
  no switchport${rateLine}
  mtu 9214
  ip address ${link.localIp}${ipv6Enabled ? `
  ipv6 address ${link.localIpv6}` : ''}
  isis enable UNDERLAY
  isis network point-to-point
  isis metric 10
  no shutdown`).join('\n!\n')
}

/**
 * Border leaves (Z3) — the leaves that own the north-south handoff. The
 * firewall used to attach to the SPINES, which cannot work in any design: an
 * eBGP spine is not a VTEP and carries no tenant VRF, so it has nothing to
 * route the firewall's traffic INTO. Attaching to the last leaf pair (already
 * a vPC/MLAG pair, so the handoff is redundant) puts the firewall next to the
 * TENANT-A VRF and the type-5 default it needs to originate.
 */
export function borderLeaves(allDevices: BOMDevice[]): BOMDevice[] {
  const leaves = allDevices.filter(d => d.subLayer === 'leaf')
  if (leaves.length <= 2) return leaves
  // Last MLAG pair. Leaves are emitted in pair order (idx 0&1, 2&3, …), so an
  // even leaf count makes the final two a complete pair.
  return leaves.slice(-2)
}

/** True when this leaf owns the firewall handoff. */
export function isBorderLeaf(dev: BOMDevice, allDevices: BOMDevice[]): boolean {
  return borderLeaves(allDevices).some(d => d.id === dev.id)
}

/**
 * Firewall↔fabric handoff plan (Y7/A-M3, re-homed in Z3): the BOM cables every
 * firewall to the border leaves (DC) or every distribution switch (campus),
 * and both ends must configure those ports — they used to land on unconfigured
 * interfaces. Each handoff is a routed /31: fabric side .0
 * (10.98.<myIdx+1>.<fwIdx*2>), FW side .1. Border-leaf ports sit just above
 * the host block; distribution ports after the core uplink. Ports beyond the
 * SKU are dropped rather than overflowed (validateBOM errors on that).
 */
function fwHandoffPlan(
  dev: BOMDevice,
  allDevices: BOMDevice[],
  role: 'border-leaf' | 'distribution',
): Array<{ port: number; fw: BOMDevice; ip: string }> {
  const fws = allDevices.filter(d => d.subLayer === 'firewall')
  if (!fws.length) return []
  if (role === 'border-leaf' && !isBorderLeaf(dev, allDevices)) return []
  const peers = role === 'border-leaf'
    ? borderLeaves(allDevices)
    : allDevices.filter(d => d.subLayer === role)
  const myIdx = Math.max(0, peers.findIndex(d => d.id === dev.id))
  // Both roles take the TOP of the host/access block, leaving the uplink block
  // free for the fabric/core links and the peer-link (Z3/Z4).
  const firstFree = role === 'border-leaf'
    ? leafHostPortMax(dev, allDevices) + 1
    : Math.max(1, (dev.ports || 48) - fws.length + 1)
  return fws
    .map((fw, fi) => ({ port: firstFree + fi, fw, ip: fwHandoffIp(myIdx, fi, fws.length) }))
    .filter(x => x.port <= (dev.ports || 48))
}

/**
 * IOS-style interface-name prefix implied by a port speed (Z4). A campus SKU
 * whose commands name a port type the chassis does not have is rejected
 * outright — the C9500-48Y4C has TwentyFiveGigE1/0/x + HundredGigE1/0/49-52
 * and NO TenGigabitEthernet at all, so every data-plane line the generator
 * previously emitted for it failed.
 */
function iosIfPrefix(speed: string | undefined): string {
  const g = speedToGbps(speed)
  if (g >= 100) return 'HundredGigE1/0/'
  if (g >= 40)  return 'FortyGigabitEthernet1/0/'
  if (g >= 25)  return 'TwentyFiveGigE1/0/'
  if (g >= 10)  return 'TenGigabitEthernet1/0/'
  return 'GigabitEthernet1/0/'
}

/**
 * Arista interface name for port `n` (Z5b/A3-6). The 7800R3 is a MODULAR
 * chassis — its ports are `Ethernet<slot>/<port>`, and a flat `Ethernet1`
 * simply does not exist on it. Fixed-config boxes keep the flat form.
 */
function aristaIf(dev: BOMDevice, n: number | string): string {
  return `${dev.portIf ?? 'Ethernet'}${n}`
}

/** Host/access-port interface name for port `n` (1-based). */
function hostIf(dev: BOMDevice, n: number): string {
  return `${dev.portIf ?? iosIfPrefix(dev.speed)}${n}`
}

/**
 * Uplink-port interface name for uplink `n` (1-based within the uplink block).
 * `uplinkStart` is where that block begins: 49 for an in-chassis block
 * (C9500 HundredGigE1/0/49-52), 1 for a separate uplink module
 * (C9200-NM-4X → TenGigabitEthernet1/1/1-4).
 */
function uplinkIf(dev: BOMDevice, n: number): string {
  const prefix = dev.uplinkIf ?? iosIfPrefix(dev.uplinkSpeed ?? dev.speed)
  return `${prefix}${(dev.uplinkStart ?? 1) + n - 1}`
}

// ── Address plan arithmetic (Z7) ──────────────────────────────────────────────
// Every scheme used to build addresses by string interpolation into a single
// octet — `10.99.${leafNum}.${(spineNum-1)*16 + linkNum*2}`, `10.255.2.${idx+1}`
// — so past 254 leaves / 16 spines / ~250 devices the generator SILENTLY
// emitted invalid IPs like `10.255.2.300`. All of it now goes through real
// 32-bit arithmetic, and the roles whose /24 can fill up spill into a
// dedicated overflow supernet instead of overflowing an octet.

function ipToInt(ip: string): number {
  const o = ip.split('.').map(Number)
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]
}

function intToIp(n: number): string {
  const v = n >>> 0
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.')
}

/** `base` advanced by `offset` addresses — never produces an octet > 255. */
function ipAdd(base: string, offset: number): string {
  return intToIp(ipToInt(base) + Math.max(0, Math.trunc(offset)))
}

/**
 * Scale-overflow supernet: 10.100.0.0/14 (10.100–10.103), reserved and used by
 * no other scheme. A role's first 254 devices keep their documented /24
 * (10.255.1.x spines, 10.255.2.x leaves, 10.254.0.x VTEPs, …) so existing
 * designs are byte-identical; device 255 onward continues here.
 */
// Well clear of every allocated block. It used to be 10.100.0.0, and with six
// role slots of 16384 it spans into 10.101.x — which is where the SD-WAN
// service VPNs live, so a fabric with more than 254 leaves would have put
// loopbacks on top of site LANs. Writing the plan down as ADDRESS_PLAN is
// what surfaced it (AF3).
const OVERFLOW_SUPERNET = '10.128.0.0'
const OVERFLOW_SLOT_SIZE = 16384
const ROLE_POOL = 254

/** Overflow slots — one per role that addresses out of a single /24. */
/**
 * Every address range the generators can emit — the one place that says so.
 *
 * `lib/ipam.ts` used to author its own list, so the artifact whose entire job
 * is to be the source of truth contradicted the running config on every
 * documented block, and declared `10.100.0.0/23` as P2P fabric — which is
 * OVERFLOW_SUPERNET, the range reserved below for loopbacks past device 254.
 * NetBox would have handed out addresses the generators were already using.
 *
 * Anything added to a generator belongs here too; the IPAM export is built
 * from this list and a test asserts no generated IP falls outside it (AF3).
 */
export interface AddressRange {
  label: string
  /** CIDR the generators allocate from. */
  prefix: string
  purpose: string
  /** Use cases this range appears in; omitted = all. */
  useCases?: string[]
}

export const ADDRESS_PLAN: AddressRange[] = [
  { label: 'FIREWALL HANDOFF',   prefix: '10.98.0.0/16',  purpose: '/31 per firewall↔border-leaf link (Z3)' },
  { label: 'P2P FABRIC LINKS',   prefix: '10.99.0.0/16',  purpose: '/31 per leaf↔spine link, flat index (Z7)' },
  { label: 'ROLE OVERFLOW',      prefix: '10.128.0.0/14', purpose: 'Reserved — loopbacks past the 254th device of a role (Z7). Do NOT allocate.' },
  { label: 'SD-WAN SERVICE VPN', prefix: '10.101.0.0/16', purpose: 'Per-site LAN (10.101.<site>.x) and guest (10.101.<128+site>.x) on an SD-WAN edge',
    useCases: ['wan', 'multisite', 'multicloud', 'aviatrix'] },
  { label: 'O-RAN F1 / eCPRI',   prefix: '10.240.0.0/14', purpose: 'CU F1-C/F1-U (.240.x), DU F1-C/F1-U (.241.x), RU fronthaul (.242.x), RU + switch mgmt (.243.x) (AD1)',
    useCases: ['oran'] },
  { label: 'O-RAN MIDHAUL',      prefix: '10.250.1.0/24', purpose: 'Midhaul router-ids (AD1)',
    useCases: ['oran'] },
  { label: 'MLAG PEERING',       prefix: '10.253.0.0/16', purpose: '/31 per MLAG pair across the peer-link (Z7)' },
  { label: 'VTEP / vPC VIP',     prefix: '10.254.0.0/16', purpose: 'Anycast VTEP source and vPC virtual IP (X7)' },
  { label: 'LOOPBACKS + MGMT SVI', prefix: '10.255.0.0/16', purpose: 'Router-IDs (spine .1.x, leaf .2.x, campus .3.x) and the campus management SVI (.99.x, HSRP VIP .99.254)' },
  { label: 'TENANT / SERVER',    prefix: '10.10.0.0/16',  purpose: 'Anycast gateway and tenant subnets behind the fabric; also the SD-WAN system-ip block at 10.10.101.x' },
]

export const RoleSlot = {
  SpineLoopback:  0,
  LeafLoopback:   1,
  Vtep:           2,
  VpcVip:         3,
  CampusLoopback: 4,
  CampusMgmt:     5,
} as const
type RoleSlot = (typeof RoleSlot)[keyof typeof RoleSlot]

/** Nth address of a role (0-based), overflowing safely past the /24. */
export function roleIp(primary: string, slot: RoleSlot, idx: number): string {
  if (idx < ROLE_POOL) return ipAdd(primary, idx)
  return ipAdd(ipAdd(OVERFLOW_SUPERNET, slot * OVERFLOW_SLOT_SIZE), idx - ROLE_POOL)
}

/**
 * Firewall↔fabric handoff /31, shared by BOTH ends (the fabric generator and
 * the FTD manifest) so they can never drift. Flat index inside 10.98.0.0/16.
 */
export function fwHandoffIp(peerIdx: number, fwIdx: number, fwCount: number): string {
  return ipAdd('10.98.1.0', (peerIdx * Math.max(1, fwCount) + fwIdx) * 2)
}

/** The far side of a /31 whose near side is `ip` (…​.0 → …​.1). */
function nextIp(ip: string): string {
  const o = ip.split('.')
  return [...o.slice(0, 3), String(Number(o[3]) + 1)].join('.')
}

/**
 * Highest server-facing port on a leaf: the access block below the fabric
 * uplinks. A border leaf gives up the top of that block to the firewall
 * handoffs (Z3), so the two never claim the same interface.
 */
function leafHostPortMax(dev: BOMDevice, allDevices: BOMDevice[] = []): number {
  const base = dev.uplinkStart
    ? (dev.ports || 48)
    : Math.max(1, (dev.ports || 48) - (dev.uplinks || 0) - 2)
  if (!isBorderLeaf(dev, allDevices)) return base
  const fwCount = allDevices.filter(d => d.subLayer === 'firewall').length
  return Math.max(1, base - fwCount)
}

/**
 * Renders CLOS fabric links as Junos set-commands (Y5/J-C1/J-C2): every fabric
 * interface gets a `family inet` /31 (the underlay carried no IPv4 before —
 * IS-IS formed ISO adjacencies but BGP-over-loopback could never establish),
 * `family iso` for IS-IS, jumbo MTU, and its IS-IS interface statement. Junos
 * ports are 0-based; leaf uplinks sit after the access ports (QFX5120-48Y:
 * et-0/0/48+); spine downlinks fill from et-0/0/0, topology-driven.
 */
function renderJuniperFabricLinks(role: 'spine' | 'leaf', dev: BOMDevice, allDevices: BOMDevice[]): string {
  const links = closFabricLinks(role, dev, allDevices)
  const portBase = role === 'leaf' ? (dev.ports || 48) : 0
  const dirLabel = role === 'leaf' ? 'UPLINK' : 'DOWNLINK'
  const rate = fabricRateMismatch(role, dev, allDevices)
  const lines: string[] = []
  for (const link of links) {
    const ifName = `et-0/0/${portBase + link.ifIndex}`
    lines.push(
      `set interfaces ${ifName} description "${dirLabel}: ${link.peerHostname} (${link.peerLabel}, link ${link.linkNum + 1})"`,
      ...(rate ? [`set interfaces ${ifName} speed ${rate.linkGbps}g`] : []),
      `set interfaces ${ifName} mtu 9216`,
      `set interfaces ${ifName} unit 0 family inet address ${link.localIp}`,
      `set interfaces ${ifName} unit 0 family iso`,
      `set protocols isis interface ${ifName}.0 point-to-point`,
    )
  }
  return lines.join('\n')
}

// ── IPv6 dual-stack underlay helpers (Enterprise upgrade A6) ───────────────────
// Gated by protoFeatures.includes('IPv6 Dual-Stack'); applies to NX-OS + Arista
// IS-IS spine-leaf underlay only (loopbacks + fabric P2P links). ULA prefix
// fd00:255:<role>::<idx> mirrors the 10.255.<role>.<idx> router-id scheme.
function nxosIpv6LoopbackLines(addr: string, ipv6Enabled: boolean): string {
  return ipv6Enabled ? `
  ipv6 address ${addr}/128
  ipv6 router isis 1` : ''
}

function nxosIsisIpv6AddressFamily(ipv6Enabled: boolean, redistribute = false): string {
  if (!ipv6Enabled) return ''
  return `  address-family ipv6 unicast
    maximum-paths 64
${redistribute ? '    redistribute direct route-map CONNECTED-TO-ISIS\n' : ''}`
}

function aristaIpv6LoopbackLines(addr: string, ipv6Enabled: boolean): string {
  return ipv6Enabled ? `
  ipv6 address ${addr}/128` : ''
}

function aristaIsisIpv6AddressFamily(ipv6Enabled: boolean): string {
  return ipv6Enabled ? `  address-family ipv6 unicast
    maximum-paths 64
` : ''
}

// ── Multisite EVPN DCI route-targets (Enterprise upgrade A7) ───────────────────
// Shared DCI route-target namespace stretched across all sites. Site-local
// routes keep `auto` RTs (scoped to each site's ASN); VNIs that must be
// extended over the DCI additionally import/export `${DCI_RT_ASN}:<vni>`,
// which is identical on every site — so cross-site leaking is opt-in per VNI.
export const DCI_RT_ASN = 65100

// ── NX-OS Leaf ────────────────────────────────────────────────────────────────

function nxosLeafConfig(dev: BOMDevice, idx: number, isGpu: boolean, allDevices: BOMDevice[] = [], protoFeatures: string[] = [], isMultisite = false, appTypes: AppType[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  // Z5/M-6: PAIR-based ASN — both vPC members share one AS (parity with the
  // Arista Y4 fix). With different ASNs the pair's shared anycast VTEP is
  // advertised from two ASes, so remote leaves see it as two distinct origins.
  const leafAsn  = 65000 + Math.floor(roleIndex(dev, allDevices, idx) / 2) + 1
  const routerId = roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  const vtepIp   = roleIp('10.254.0.1', RoleSlot.Vtep, idx)
  // Host/server ports: the access block below the fabric uplinks (a border
  // leaf gives up the top of it to the firewall handoffs — Z3).
  const hostPortMax = leafHostPortMax(dev, allDevices)
  // Real spine eBGP peers — ONLY the spines this leaf actually has a link to
  // (Z1): with uplinks < spineCount the staggered planner wires a subset, and
  // peering the rest left permanently-Idle sessions whose loopbacks are >2 hops
  // away (ebgp-multihop 2 can never reach them).
  const linkedSpineNames = new Set(closFabricLinks('leaf', dev, allDevices).map(l => l.peerHostname))
  const spinePeerLines = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => linkedSpineNames.size === 0 || linkedSpineNames.has(x.d.hostname))
    .map(x => `  neighbor ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)}\n    inherit peer SPINE-PEER\n    description ${x.d.hostname || `SPINE-${x.i + 1}`}`)
    .join('\n')
  const leafBgpNeighbors = spinePeerLines || '  ! No spines in fabric — add: neighbor <spine-lo0>\\n    inherit peer SPINE-PEER'
  const isisNet  = `49.0001.0102.5501.${String(idx + 1).padStart(4, '0')}.00`
  const ipv6Underlay = protoFeatures.includes('IPv6 Dual-Stack')
  const routerIdV6 = `fd00:255:2::${idx + 1}`
  const qosBlock = isGpu ? nxosGpuQoS() : nxosStdQoS()
  const fabricLinks = renderNxosFabricLinks('leaf', dev, allDevices, ipv6Underlay)
  // Z3 — north-south handoff. The firewall used to attach to the SPINES, which
  // have no tenant VRF and are not VTEPs, so nothing could route into TENANT-A
  // and no default was ever originated into the fabric. The border leaves now
  // own the handoff inside the VRF and originate the type-5 default.
  const fwLinks = fwHandoffPlan(dev, allDevices, 'border-leaf')
  const fwHandoffBlock = fwLinks.length ? `
! ── FIREWALL HANDOFF (border leaf, routed /31 inside TENANT-A — FW side .1) ──
${fwLinks.map(x => `interface Ethernet1/${x.port}
  description FW-HANDOFF: ${x.fw.hostname}
  no switchport
  vrf member TENANT-A
  mtu 9216
  ip address ${x.ip}/31
  no shutdown`).join('\n!\n')}
!
! Default route toward the perimeter firewall, inside the tenant VRF.
vrf context TENANT-A
${fwLinks.map(x => `  ip route 0.0.0.0/0 ${nextIp(x.ip)}`).join('\n')}
!` : ''
  // The tenant VRF BGP block: without it no type-5 (IP-prefix) routes are
  // advertised at all. On a border leaf it also originates the default the
  // rest of the fabric needs for north-south traffic (Z3).
  const tenantVrfBgp = `  !
  vrf TENANT-A
    address-family ipv4 unicast
      advertise l2vpn evpn
      redistribute direct route-map ALLOW-ALL
      maximum-paths 64${fwLinks.length ? `
      ! Border leaf: inject the perimeter default into EVPN as a type-5 route.
      default-information originate always
      redistribute static route-map ALLOW-ALL` : ''}`
  const { pairId, isPrimary, peerHostname } = haPairInfo(dev, idx, allDevices)
  const vpcRolePriority = isPrimary ? 8192 : 16384
  // vPC anycast VTEP VIP — shared secondary on loopback1 for the HA pair, so
  // multihomed traffic hashes to one logical VTEP (X7).
  const vpcVtepVip = roleIp('10.254.1.1', RoleSlot.VpcVip, pairId - 1)
  // Backup L3 peering /31 across the peer-link, in the same 10.253/16 pool the
  // Arista MLAG peering uses (flat index, Z7).
  const vpcBackupLocalIp = ipAdd('10.253.1.0', (pairId - 1) * 2 + (isPrimary ? 0 : 1))
  const vpcBackupPeerIp  = ipAdd('10.253.1.0', (pairId - 1) * 2 + (isPrimary ? 1 : 0))
  // Peer-link members: on SKUs with a dedicated uplink range, use the
  // leftover dedicated high-speed ports (93180: uplinks on 49-52 → peer-link
  // 53-54); otherwise the two ports just below the fabric uplinks.
  const plPort1 = dev.uplinkStart
    ? dev.uplinkStart + (dev.uplinks || 0)
    : Math.max(1, (dev.ports || 48) - (dev.uplinks || 0) - 1)
  const plPort2 = plPort1 + 1
  const dciL3RtLines = isMultisite ? `
    route-target import ${DCI_RT_ASN}:50000 evpn
    route-target export ${DCI_RT_ASN}:50000 evpn` : ''
  const dciL2RtLines = isMultisite ? `
    route-target import ${DCI_RT_ASN}:10010
    route-target export ${DCI_RT_ASN}:10010` : ''
  const dciComment = isMultisite ? `
! Multisite DCI: site-local routes use auto RTs (per-site ASN scope); the
! explicit ${DCI_RT_ASN}:<vni> RTs below are the shared DCI namespace stretched
! across all sites — only VNIs carrying these RTs are leaked over the DCI.` : ''

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : DC Leaf (ToR / VTEP)
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

version 10.3(x) Bios:version
!
hostname ${dev.hostname}
!
feature isis
feature bgp
feature vn-segment-vlan-based
feature nv overlay
!
! Enables the EVPN control plane (§10) — without it the l2vpn evpn AF,
! the evpn MAC-VRF block and host-reachability protocol bgp are inert (Z1).
nv overlay evpn
feature interface-vlan
feature lacp
feature vpc
feature lldp
feature telemetry
feature bfd
!
! Multihop BFD parameters for the loopback-sourced eBGP sessions (Z5b/M-4).
bfd multihop interval 250 min_rx 250 multiplier 3
!
username admin password <CHANGE-ME-admin-password> role network-admin
!
feature tacacs+
tacacs-server host <CHANGE-ME-tacacs-primary-ip> key <CHANGE-ME-tacacs-key>
tacacs-server host <CHANGE-ME-tacacs-secondary-ip> key <CHANGE-ME-tacacs-key>
aaa group server tacacs+ TACACS-GROUP
  server <CHANGE-ME-tacacs-primary-ip>
  server <CHANGE-ME-tacacs-secondary-ip>
aaa authentication login default group TACACS-GROUP local
aaa authorization exec default group TACACS-GROUP local
aaa accounting default group TACACS-GROUP
!
ntp server <CHANGE-ME-ntp-primary> prefer
ntp server <CHANGE-ME-ntp-secondary>
ntp source-interface mgmt0
!
logging server <CHANGE-ME-syslog-ip> 6 use-vrf management
!
! ── MANAGEMENT VRF ───────────────────────────────────────────────────────────
vrf context management
  ip route 0.0.0.0/0 <CHANGE-ME-oob-gateway>
!
interface mgmt0
  vrf member management
  ip address <CHANGE-ME-mgmt-ip>/24
  no shutdown
!
! ── TENANT VRF / VNI (example — replicate per tenant) ────────────────────────${dciComment}
vrf context TENANT-A
  vni 50000
  rd auto
  address-family ipv4 unicast
    ! Explicit fabric-wide RTs (65000:<vni>) — auto-RT derives ASN:VNI, and
    ! with unique per-leaf eBGP ASNs no leaf would import any other leaf (Y1).
    route-target import 65000:50000 evpn
    route-target export 65000:50000 evpn${dciL3RtLines}
!
vlan 10
  name SERVERS
  vn-segment 10010
vlan 900
  name L3VNI-TENANT-A
  vn-segment 50000
!
! ── ANYCAST GATEWAY (distributed default gateway on every leaf) ──────────────
fabric forwarding anycast-gateway-mac 0000.0aaa.0001
!
! Tenant SVI — same anycast IP on every leaf (edit subnet per tenant/VNI).
interface Vlan10
  no shutdown
  vrf member TENANT-A
  ip address <CHANGE-ME-tenant-anycast-gw>/24
  fabric forwarding mode anycast-gateway
!
! L3VNI core SVI — inter-VNI (symmetric IRB) routing for VRF TENANT-A.
interface Vlan900
  no shutdown
  vrf member TENANT-A
  ip forward
!
! ── LOOPBACKS ────────────────────────────────────────────────────────────────
interface loopback0
  description ROUTER-ID / BGP SOURCE
  ip address ${routerId}/32
  ip router isis 1${nxosIpv6LoopbackLines(routerIdV6, ipv6Underlay)}
  no shutdown
!
interface loopback1
  description VTEP SOURCE (secondary = vPC anycast VTEP VIP shared with ${peerHostname})
  ip address ${vtepIp}/32
  ip address ${vpcVtepVip}/32 secondary
  ip router isis 1
  no shutdown
!
! ── UNDERLAY: IS-IS only (no OSPF — one routing protocol per domain) ─────────
router isis 1
  net ${isisNet}
  is-type level-2-only
  address-family ipv4 unicast
    maximum-paths 64
${nxosIsisIpv6AddressFamily(ipv6Underlay)}  log-adjacency-changes
  metric-style transition
!
! ── BGP / EVPN ───────────────────────────────────────────────────────────────
router bgp ${leafAsn}
  router-id ${routerId}
  bestpath as-path multipath-relax
  log-neighbor-changes
  address-family ipv4 unicast
    network ${routerId}/32
    network ${vtepIp}/32
    network ${vpcVtepVip}/32
    maximum-paths 64
  address-family l2vpn evpn
  !
  ! Z5/M-2: with a PIP (loopback1 primary) + VIP (secondary) vPC VTEP AND an
  ! L3VNI, type-5 routes must be sourced from the PIP and carry the pair's
  ! virtual RMAC — otherwise the peer imports them with the VIP next-hop and
  ! symmetric-IRB traffic is dropped by the wrong-MAC check.
  advertise-pip
  advertise virtual-rmac
  !
  template peer SPINE-PEER
    remote-as 65000
    update-source loopback0
    ebgp-multihop 2
    timers 3 9
    ! Z5b/M-4: a plain bfd statement only arms SINGLE-hop BFD. These sessions
    ! run over the loopback (ebgp-multihop 2), so without the multihop keyword
    ! — and the matching global bfd multihop interval — the session has no BFD
    ! at all and falls back to the 9s hold timer.
    bfd multihop
    address-family ipv4 unicast
      soft-reconfiguration inbound always
    address-family l2vpn evpn
      send-community both
  !
  ! ── Spine eBGP peers (auto-generated from the fabric) ─────────────────────
${leafBgpNeighbors}
  !
  ! Z5/M-6: iBGP across the vPC peer-link. A member that loses every fabric
  ! uplink still reaches the fabric through its peer instead of black-holing.
  neighbor ${vpcBackupPeerIp}
    remote-as ${leafAsn}
    description vPC-PEER ${peerHostname}
    update-source Vlan3999
    address-family ipv4 unicast
      next-hop-self
    address-family l2vpn evpn
      send-community both
${tenantVrfBgp}
!
route-map ALLOW-ALL permit 10
!
! ── VXLAN NVE (VTEP) ─────────────────────────────────────────────────────────
interface nve1
  no shutdown
  host-reachability protocol bgp
  source-interface loopback1
  member vni 10010
    ingress-replication protocol bgp
  member vni 50000 associate-vrf
!
! ── EVPN MAC-VRF (L2VNI route-targets) ───────────────────────────────────────
evpn
  vni 10010 l2
    rd auto
    route-target import 65000:10010
    route-target export 65000:10010${dciL2RtLines}
!
! ── UPLINKS (topology-driven from BOM port-math) ─────────────────────────────
${fabricLinks}
!
! ── SERVER / HOST PORTS (Z1 — the tenant VLAN had no member ports, so VLAN 10,
! the anycast gateway and the NVE served nothing that could physically attach) ─
interface Ethernet1/1-${hostPortMax}
  description SERVER-ACCESS (tenant VLAN 10)
  switchport
  switchport mode access
  switchport access vlan 10
  spanning-tree port type edge
  spanning-tree bpduguard enable
  mtu 9216
  no shutdown
!
! Dual-homed servers: bundle the pair member's matching port into a vPC
! port-channel, e.g.  interface port-channel101 / vpc 101 / switchport access vlan 10
vpc orphan-port suspend
${fwHandoffBlock}
!
${qosBlock}
!
! ── vPC BACKUP ROUTED PATH (Z5/M-6 — iBGP peering VLAN over the peer-link) ───
vlan 3999
  name VPC-PEER-L3
!
interface Vlan3999
  description VPC-PEER-L3 to ${peerHostname}
  no shutdown
  mtu 9216
  ip address ${vpcBackupLocalIp}/31
  ip router isis 1
  isis network point-to-point
!
! ── vPC PEER-LINK (HA pair with ${peerHostname}) ──────────────────────────────
vpc domain ${pairId}
  role priority ${vpcRolePriority}
  peer-switch
  peer-keepalive destination <CHANGE-ME-${peerHostname}-mgmt-ip> source <CHANGE-ME-${dev.hostname}-mgmt-ip> vrf management
  peer-gateway
  ip arp synchronize
  auto-recovery
  delay restore 150
!
interface port-channel${pairId}
  description vPC-PEER-LINK to ${peerHostname}
  switchport
  switchport mode trunk
  spanning-tree port type network
  vpc peer-link
!
interface Ethernet1/${plPort1}
  description vPC-PEER-LINK member 1 to ${peerHostname}
  switchport
  switchport mode trunk
  channel-group ${pairId} mode active
  no shutdown
!
interface Ethernet1/${plPort2}
  description vPC-PEER-LINK member 2 to ${peerHostname}
  switchport
  switchport mode trunk
  channel-group ${pairId} mode active
  no shutdown
!
telemetry
  destination-group 1
    ip address <CHANGE-ME-telemetry-collector-ip> port 57500 protocol gRPC encoding GPB
  sensor-group 1
    data-source NX-API
    path sys/intf depth unbounded
  sensor-group 2
    data-source NX-API
    path sys/bgp depth unbounded
  subscription 1
    dst-grp 1
    snsr-grp 1 sample-interval 10000
    snsr-grp 2 sample-interval 30000
${nxosStorageBlock(appTypes)}`
}

// ── Storage networking blocks (G-A11) ────────────────────────────────────────

function nxosStorageBlock(appTypes: AppType[]): string {
  if (!appTypes.includes('storage')) return ''
  return `
! ── STORAGE NETWORKING (NVMe-oF / FCoE / iSCSI) ─────────────────────────────
! Enables lossless Ethernet for storage protocols. Priority 6 = storage class,
! no-drop via PFC. FCoE requires FIP snooping; NVMe-oF rides RoCEv2 (priority 3).
!
feature fcoe
feature lldp
!
! ── FCoE VLANs and VSANs ────────────────────────────────────────────────────
vlan 200
  name STORAGE-FCOE
  fcoe vsan 100
!
vsan database
  vsan 100 name STORAGE-VSAN
  vsan 100 interface vfc1
!
interface vfc1
  bind interface Ethernet1/48
  switchport trunk allowed vsan 100
  no shutdown
!
! ── iSCSI VLAN ───────────────────────────────────────────────────────────────
vlan 201
  name STORAGE-ISCSI
!
interface Vlan201
  description iSCSI-STORAGE-NETWORK
  ip address <CHANGE-ME-iscsi-gw-ip>/24
  no shutdown
  mtu 9216
!
! ── NVMe-oF / RoCEv2 VLAN ───────────────────────────────────────────────────
vlan 202
  name STORAGE-NVMEOF
!
interface Vlan202
  description NVMe-over-Fabrics-RoCEv2
  ip address <CHANGE-ME-nvmeof-gw-ip>/24
  no shutdown
  mtu 9216
!
! ── Storage QoS — PFC no-drop for priority 6 (FCoE/NVMe-oF) ─────────────────
class-map type qos match-any CM-STORAGE-FCOE
  match cos 6
class-map type qos match-any CM-STORAGE-ISCSI
  match access-group name ACL-ISCSI
!
ip access-list ACL-ISCSI
  permit tcp any any eq 3260
  permit tcp any eq 3260 any
!
policy-map type qos PM-STORAGE-CLASSIFY
  class CM-STORAGE-FCOE
    set qos-group 6
  class CM-STORAGE-ISCSI
    set qos-group 5
!
policy-map type queuing PM-STORAGE-QUEUING
  class type queuing c-out-q6
    priority level 1
    bandwidth percent 20
  class type queuing c-out-q5
    bandwidth percent 15
  class type queuing c-out-q-default
    bandwidth remaining percent 100
!
! ── Jumbo MTU for storage interfaces ─────────────────────────────────────────
system jumbomtu 9216
!
! ── FIP snooping (FCoE fabric provisioning) ──────────────────────────────────
feature fip-snooping
fcoe fcmap 0E:FC:00
`
}

function aristaStorageBlock(appTypes: AppType[]): string {
  if (!appTypes.includes('storage')) return ''
  return `
! ── STORAGE NETWORKING (NVMe-oF / iSCSI) ────────────────────────────────────
! Arista supports NVMe-oF via RoCEv2 and iSCSI; FCoE is not supported natively.
! Priority 6 = storage lossless class via PFC.
!
! ── iSCSI VLAN ───────────────────────────────────────────────────────────────
vlan 201
  name STORAGE-ISCSI
!
interface Vlan201
  description iSCSI-STORAGE-NETWORK
  ip address <CHANGE-ME-iscsi-gw-ip>/24
  mtu 9214
  no shutdown
!
! ── NVMe-oF / RoCEv2 VLAN ───────────────────────────────────────────────────
vlan 202
  name STORAGE-NVMEOF
!
interface Vlan202
  description NVMe-over-Fabrics-RoCEv2
  ip address <CHANGE-ME-nvmeof-gw-ip>/24
  mtu 9214
  no shutdown
!
! ── Storage QoS — lossless for priority 6 ────────────────────────────────────
ip access-list ACL-ISCSI
  permit tcp any any eq 3260
  permit tcp any eq 3260 any
!
class-map type qos CM-STORAGE-ISCSI
  match ip access-group ACL-ISCSI
!
policy-map type quality-of-service PM-STORAGE
  class CM-STORAGE-ISCSI
    set traffic-class 5
!
priority-flow-control priority 6 no-drop
!
! ── Jumbo MTU ────────────────────────────────────────────────────────────────
system mtu jumbo 9214
`
}

// ── NX-OS QoS blocks ──────────────────────────────────────────────────────────

function nxosStdQoS(): string {
  return `! ── QoS — Standard 4-class DSCP (non-GPU) ──────────────────────────────────
class-map type qos match-any CM-VOICE
  match dscp ef
class-map type qos match-any CM-VIDEO
  match dscp af41 af42
class-map type qos match-any CM-CRITICAL
  match dscp af31 af32 cs3
class-map type qos match-any CM-BULK
  match dscp af11 af12 cs1
!
class-map type queuing CM-VOICE-Q
  match qos-group 6
class-map type queuing CM-VIDEO-Q
  match qos-group 5
class-map type queuing CM-CRITICAL-Q
  match qos-group 4
!
policy-map type qos PM-INGRESS-CLASSIFY
  class CM-VOICE
    set qos-group 6
  class CM-VIDEO
    set qos-group 5
  class CM-CRITICAL
    set qos-group 4
  class class-default
    set qos-group 0
!
policy-map type queuing PM-EGRESS-QUEUING
  class type queuing CM-VOICE-Q
    priority percent 15
  class type queuing CM-VIDEO-Q
    bandwidth percent 20
  class type queuing CM-CRITICAL-Q
    bandwidth percent 30
  class type queuing class-default
    bandwidth percent 35
    random-detect dscp-based
!
! Z5/M-5: the routed fabric ports set MTU per-interface, but the L2 paths —
! the vPC peer-link and the server access ports — inherit the system default
! of 1500, so a VXLAN-encapsulated frame is dropped on those paths. A
! network-qos jumbo MTU covers every switched port.
policy-map type network-qos PM-JUMBO
  class type network-qos class-default
    mtu 9216
!
system qos
  service-policy type qos          input  PM-INGRESS-CLASSIFY
  service-policy type queuing      output PM-EGRESS-QUEUING
  service-policy type network-qos  PM-JUMBO`
}

function nxosGpuQoS(): string {
  return `! ── QoS — GPU/RoCEv2 Fabric (IS-IS underlay, ECN + DCQCN + PFC) ────────────
! Priority mapping:
!   PFC priority 3 → RoCEv2 / RDMA (lossless, no-drop)
!   PFC priority 6 → Storage (FCoE/NVMe-oF, lossless)
!   PFC priority 0-2,4,5,7 → lossy (ECN-marked)
!
! DSCP → qos-group mapping:
!   DSCP 26 (AF31) — RoCEv2 → qos-group 3 (PFC priority 3, lossless)
!   DSCP 46 (EF)   — Voice/ctrl → qos-group 6
!   DSCP 34 (AF41) — Video  → qos-group 5
!   DSCP  0 (CS0)  — Default → qos-group 0
!
class-map type qos match-any CM-RDMA
  match dscp 26 28
class-map type qos match-any CM-STORAGE
  match dscp 24 16
class-map type qos match-any CM-VOICE
  match dscp 46
class-map type qos match-any CM-VIDEO
  match dscp 34 32
class-map type qos match-any CM-BULK
  match dscp 10 12
class-map type qos match-any CM-SCAVENGER
  match dscp 8
!
class-map type queuing CM-RDMA-Q
  match qos-group 3
class-map type queuing CM-STORAGE-Q
  match qos-group 6
class-map type queuing CM-VOICE-Q
  match qos-group 5
class-map type queuing CM-VIDEO-Q
  match qos-group 4
class-map type queuing CM-BULK-Q
  match qos-group 1
!
policy-map type qos PM-INGRESS-CLASSIFY
  class CM-RDMA
    set qos-group 3
    set dscp 26
  class CM-STORAGE
    set qos-group 6
  class CM-VOICE
    set qos-group 5
  class CM-VIDEO
    set qos-group 4
  class CM-BULK
    set qos-group 1
  class CM-SCAVENGER
    set qos-group 0
    set dscp 8
  class class-default
    set qos-group 0
!
! Egress queuing — buffer carving:
!   RDMA   : 60% guaranteed BW, PFC enabled (lossless)
!   Storage: 10% guaranteed BW, PFC enabled (lossless)
!   Lossy  : remaining BW with ECN + WRED for congestion isolation
policy-map type queuing PM-EGRESS-QUEUING
  class type queuing CM-RDMA-Q
    bandwidth percent 60
    pause buffer-size 300
  class type queuing CM-STORAGE-Q
    bandwidth percent 10
    pause buffer-size 150
  class type queuing CM-VOICE-Q
    priority percent 5
  class type queuing CM-VIDEO-Q
    bandwidth percent 10
    random-detect dscp-based
    random-detect dscp 34 minimum-threshold 2000 maximum-threshold 8000
  class type queuing CM-BULK-Q
    bandwidth percent 5
    random-detect dscp-based
    random-detect dscp 10 minimum-threshold 500  maximum-threshold 4000
  class type queuing class-default
    bandwidth percent 10
    random-detect dscp-based
    random-detect dscp 0 minimum-threshold 1000 maximum-threshold 6000
!
! Network-QoS: PFC lossless + ECN on congestion queues
! PFC priority 3 = RDMA (RoCEv2), priority 6 = storage
policy-map type network-qos PM-PFC-LOSSLESS
  class type network-qos CM-RDMA-Q
    pause no-drop
    mtu 9216
    congestion-control ecn
  class type network-qos CM-STORAGE-Q
    pause no-drop
    mtu 9216
  class type network-qos CM-VIDEO-Q
    congestion-control ecn
    mtu 9216
  class type network-qos CM-BULK-Q
    congestion-control ecn
    mtu 9216
  class type network-qos class-default
    congestion-control ecn
    mtu 9216
!
system qos
  service-policy type qos         input PM-INGRESS-CLASSIFY
  service-policy type queuing     output PM-EGRESS-QUEUING
  service-policy type network-qos PM-PFC-LOSSLESS
!
! ── DCQCN parameters (RoCEv2 congestion control) ────────────────────────────
! These must be consistent across ALL switches in the GPU fabric.
! Adjust thresholds to match actual ASIC buffer size (see vendor datasheet).
hardware qos dcbx default
hardware qos pfc-watchdog on
hardware profile forwarding-mode fabricpath
!
! Per-port PFC/ECN settings (apply to every GPU-connected interface):
! interface Ethernet<N>
!   priority-flow-control mode on
!   priority-flow-control watch-dog-interval on
!   congestion-control ecn mark
!   no flowcontrol receive off
!   no flowcontrol send off`
}

// ── Arista EOS ────────────────────────────────────────────────────────────────

function aristaSpineConfig(dev: BOMDevice, idx: number, isGpu: boolean, allDevices: BOMDevice[] = [], protoFeatures: string[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const asn      = 65000
  const routerId = roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
  // System-ID must be exactly 12 hex digits (3×4). padStart avoids the overflow
  // past `000${n}` for idx≥9 that produced an invalid 13/14-digit NET.
  const isisNet  = `0101.0255.${String(idx + 1).padStart(4, '0')}`
  const ipv6Underlay = protoFeatures.includes('IPv6 Dual-Stack')
  const routerIdV6 = `fd00:255:1::${idx + 1}`
  const qos      = isGpu ? aristaGpuQoS() : ''
  const fabricLinks = renderAristaFabricLinks('spine', dev, allDevices, ipv6Underlay)
  // Z3: firewall handoff moved to the border leaves (a spine has no tenant VRF).
  const fwHandoffBlock = ''
  // Real eBGP leaf peers from the fabric (leaf lo0 10.255.2.(i+1)). Leaf ASNs
  // are PAIR-based (65000 + pairId — an MLAG pair shares one ASN, Y4/A-M2).
  const spineLeafPeers = allDevices
    .filter(d => d.subLayer === 'leaf')
    .flatMap((d, i) => [
      `  neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)} peer group LEAF-PEER`,
      `  neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)} remote-as ${65000 + Math.floor(i / 2) + 1}`,
      `  neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)} description ${d.hostname || `LEAF-${i + 1}`}`,
    ])
    .join('\n')
  const spineLeafPeerBlock = spineLeafPeers || '  ! No leaves in fabric — add: neighbor <leaf-lo0> peer group LEAF-PEER / remote-as <leaf-asn>'

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : DC Spine
! OS     : Arista EOS
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
! ── MANAGEMENT ──────────────────────────────────────────────────────────────
ip domain-name <CHANGE-ME-domain.example.com>
ip name-server <CHANGE-ME-dns-ip>
!
username admin privilege 15 role network-admin secret sha512 <CHANGE-ME-admin-password>
!
aaa authentication login default group tacacs+ local
aaa authorization exec default group tacacs+ local
aaa accounting exec default start-stop group tacacs+
!
! Z5b/A3-3: every mgmt service must be pinned to the SAME VRF as Management1.
! Left in the default VRF (as they were) they have no route to the OOB
! network at all, so TACACS, NTP, syslog and SNMP were all non-functional.
tacacs-server host <CHANGE-ME-tacacs-primary-ip> vrf MGMT key <CHANGE-ME-tacacs-key>
tacacs-server host <CHANGE-ME-tacacs-secondary-ip> vrf MGMT key <CHANGE-ME-tacacs-key>
ip tacacs vrf MGMT source-interface Management1
!
snmp-server engineID local f5717f000001
snmp-server vrf MGMT
snmp-server group NETDESIGN-RO v3 priv
snmp-server user NETDESIGN-USER NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes <CHANGE-ME-snmp-priv-pass>
!
ntp server vrf MGMT <CHANGE-ME-ntp-primary> prefer iburst
ntp server vrf MGMT <CHANGE-ME-ntp-secondary> iburst
ntp source vrf MGMT Management1
!
logging vrf MGMT host <CHANGE-ME-syslog-ip>
logging vrf MGMT source-interface Management1
!
management ssh
  idle-timeout 10
  authentication mode password
!
! ── MANAGEMENT INTERFACE (OOB, dedicated VRF) ───────────────────────────────
vrf instance MGMT
!
interface Management1
  description OOB-MANAGEMENT
  vrf MGMT
  ip address <CHANGE-ME-mgmt-ip>/24
!
ip route vrf MGMT 0.0.0.0/0 <CHANGE-ME-oob-gateway>
!
! ── ROUTING: IS-IS underlay (single protocol — no OSPF) ─────────────────────
! EOS defaults to L2-only — without ip routing the box will not forward (Y1).
ip routing
ip routing vrf MGMT
service routing protocols model multi-agent
!
router isis UNDERLAY
  net 49.0001.${isisNet}.00
  is-type level-2
  address-family ipv4 unicast
    maximum-paths 64
    fast-reroute ti-lfa
${aristaIsisIpv6AddressFamily(ipv6Underlay)}!
! ── LOOPBACK ────────────────────────────────────────────────────────────────
interface Loopback0
  description ROUTER-ID / BGP SOURCE
  ip address ${routerId}/32${aristaIpv6LoopbackLines(routerIdV6, ipv6Underlay)}
  isis enable UNDERLAY
  isis passive
!
! ── DOWNLINK INTERFACES (topology-driven from BOM port-math) ────────────────
${fabricLinks}
${fwHandoffBlock}
!
! ── BGP / EVPN OVERLAY ───────────────────────────────────────────────────────
router bgp ${asn}
  router-id ${routerId}
  no bgp default ipv4-unicast
  distance bgp 20 200 200
  maximum-paths 64
  graceful-restart
  !
  ! eBGP EVPN spine — flat EOS peer-group syntax; per-leaf remote-as (unique
  ! leaf ASN). No route-reflector-client (RR is iBGP-only).
  neighbor LEAF-PEER peer group
  neighbor LEAF-PEER update-source Loopback0
  neighbor LEAF-PEER bfd
  neighbor LEAF-PEER ebgp-multihop 3
  neighbor LEAF-PEER send-community extended
  neighbor LEAF-PEER maximum-routes 12000
  ! ── Leaf eBGP peers (auto-generated from the fabric) ──────────────────────
${spineLeafPeerBlock}
  !
  address-family ipv4
    neighbor LEAF-PEER activate
  address-family evpn
    neighbor LEAF-PEER activate
    ! The spine is NOT a VTEP: it must re-advertise EVPN routes with the
    ! ORIGINATING leaf's VTEP as next-hop. Without this an eBGP spine rewrites
    ! next-hop to its own Loopback0 and every VXLAN tunnel black-holes (Z1 —
    ! parity with the NX-OS NH-UNCHANGED route-map from Y1).
    neighbor LEAF-PEER next-hop-unchanged
!
${qos}
!
${aristaTelemetryBlock()}
!
! ── BANNER ───────────────────────────────────────────────────────────────────
banner login
*******************************************************************************
*  ${dev.hostname} — Authorized access only.                               *
*******************************************************************************
EOF
`
}

function aristaLeafConfig(dev: BOMDevice, idx: number, isGpu: boolean, allDevices: BOMDevice[] = [], protoFeatures: string[] = [], isMultisite = false, appTypes: AppType[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const { pairId, isPrimary, peerHostname, domainId } = haPairInfo(dev, idx, allDevices)
  // EOS/AVD practice: an MLAG pair shares ONE ASN (Y4/A-M2) — with per-device
  // ASNs the shared anycast VTEP is advertised from two different AS numbers
  // and the pair cannot run the required peer-link iBGP session.
  const leafAsn  = 65000 + pairId
  const routerId = roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  // EOS MLAG + EVPN: BOTH pair members share ONE Loopback1 VTEP IP (anycast
  // VTEP) — with unique VTEPs the pair appears as two separate VTEPs and
  // multihomed traffic is black-holed/duplicated (X7 / audit A-M4).
  const vtepIp   = roleIp('10.254.0.1', RoleSlot.Vtep, pairId - 1)
  // Deterministic MLAG peer /31 on Vlan4094 (primary .0, secondary .1).
  const mlagLocalIp = ipAdd('10.253.1.0', (pairId - 1) * 2 + (isPrimary ? 0 : 1))
  const mlagPeerIp  = ipAdd('10.253.1.0', (pairId - 1) * 2 + (isPrimary ? 1 : 0))
  // Peer-link members: leftover dedicated uplink ports when the SKU has a
  // dedicated range, else the two ports just below the fabric uplinks.
  const plPort1 = dev.uplinkStart
    ? dev.uplinkStart + (dev.uplinks || 0)
    : Math.max(1, (dev.ports || 32) - (dev.uplinks || 0) - 1)
  const plPort2 = plPort1 + 1
  // Valid 12-hex system-id (padStart); the old `000${idx+101}` overflowed to
  // 13/14 digits and EOS rejected the NET, so the underlay never started.
  const isisNet  = `0102.5500.${String(idx + 1).padStart(4, '0')}`
  const ipv6Underlay = protoFeatures.includes('IPv6 Dual-Stack')
  const routerIdV6 = `fd00:255:2::${idx + 1}`
  const qos      = isGpu ? aristaGpuQoS() : ''
  const fabricLinks = renderAristaFabricLinks('leaf', dev, allDevices, ipv6Underlay)
  // Real spine peers from the fabric (spine lo0 10.255.1.(i+1), ASN 65000).
  // Host/server ports: the access block below the uplinks + peer-link members
  // (a border leaf gives up its top ports to the firewall handoffs — Z3).
  const hostPortMax = leafHostPortMax(dev, allDevices)
  // Z3 — north-south handoff on the border leaves, inside TENANT-A.
  const fwLinks = fwHandoffPlan(dev, allDevices, 'border-leaf')
  const fwHandoffBlock = fwLinks.length ? `
! ── FIREWALL HANDOFF (border leaf, routed /31 inside TENANT-A — FW side .1) ──
${fwLinks.map(x => `interface ${aristaIf(dev, x.port)}
  description FW-HANDOFF: ${x.fw.hostname}
  no switchport
  vrf TENANT-A
  mtu 9214
  ip address ${x.ip}/31
  no shutdown`).join('\n!\n')}
!
${fwLinks.map(x => `ip route vrf TENANT-A 0.0.0.0/0 ${nextIp(x.ip)}`).join('\n')}
!` : ''
  // Border leaf injects the perimeter default into EVPN as a type-5 route so
  // the rest of the fabric has a north-south path (Z3).
  const tenantDefaultOriginate = fwLinks.length ? `
    ! Border leaf: originate the perimeter default into the tenant VRF.
    redistribute static
    network 0.0.0.0/0` : ''
  // Only the spines this leaf actually links to (Z1 — see nxosLeafConfig).
  const linkedSpines = new Set(closFabricLinks('leaf', dev, allDevices).map(l => l.peerHostname))
  const leafSpinePeers = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => linkedSpines.size === 0 || linkedSpines.has(x.d.hostname))
    .map(x => `  neighbor ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)} peer group SPINE-PEER`)
    .join('\n')
  const leafSpinePeerBlock = leafSpinePeers || '  ! No spines in fabric — add: neighbor <spine-lo0> peer group SPINE-PEER'
  // Site-local MAC-VRF RT uses the fabric (spine) ASN so all leaves in the
  // site share it; the DCI RT is the cross-site stretched namespace (A7).
  const dciL2RtLines = isMultisite ? `
    route-target import evpn ${DCI_RT_ASN}:10010
    route-target export evpn ${DCI_RT_ASN}:10010` : ''
  const dciL3RtLines = isMultisite ? `
    route-target import evpn ${DCI_RT_ASN}:50000
    route-target export evpn ${DCI_RT_ASN}:50000` : ''

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : DC Leaf (VTEP)
! OS     : Arista EOS
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
service routing protocols model multi-agent
!
username admin privilege 15 role network-admin secret sha512 <CHANGE-ME-admin-password>
!
aaa authentication login default group tacacs+ local
aaa authorization exec default group tacacs+ local
aaa accounting exec default start-stop group tacacs+
! Z5b/A3-4: the leaf mgmt plane was a strict SUBSET of the spine's — no
! syslog and no SNMP at all, so half the fleet was invisible to the NOC.
! Z5b/A3-3: every service is pinned to the same VRF as Management1.
tacacs-server host <CHANGE-ME-tacacs-primary-ip> vrf MGMT key <CHANGE-ME-tacacs-key>
tacacs-server host <CHANGE-ME-tacacs-secondary-ip> vrf MGMT key <CHANGE-ME-tacacs-key>
ip tacacs vrf MGMT source-interface Management1
!
snmp-server engineID local f5717f000001
snmp-server vrf MGMT
snmp-server group NETDESIGN-RO v3 priv
snmp-server user NETDESIGN-USER NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes <CHANGE-ME-snmp-priv-pass>
!
ntp server vrf MGMT <CHANGE-ME-ntp-primary> prefer iburst
ntp server vrf MGMT <CHANGE-ME-ntp-secondary> iburst
ntp source vrf MGMT Management1
!
logging vrf MGMT host <CHANGE-ME-syslog-ip>
logging vrf MGMT source-interface Management1
!
! ── MANAGEMENT INTERFACE (OOB, dedicated VRF) ───────────────────────────────
vrf instance MGMT
!
interface Management1
  description OOB-MANAGEMENT
  vrf MGMT
  ip address <CHANGE-ME-mgmt-ip>/24
!
ip route vrf MGMT 0.0.0.0/0 <CHANGE-ME-oob-gateway>
!
! EOS defaults to L2-only — without ip routing the box will not forward (Y1).
ip routing
ip routing vrf MGMT
!
! ── IS-IS UNDERLAY (single protocol) ────────────────────────────────────────
router isis UNDERLAY
  net 49.0001.${isisNet}.00
  is-type level-2
  address-family ipv4 unicast
    maximum-paths 64
${aristaIsisIpv6AddressFamily(ipv6Underlay)}!
interface Loopback0
  ip address ${routerId}/32${aristaIpv6LoopbackLines(routerIdV6, ipv6Underlay)}
  isis enable UNDERLAY
  isis passive
!
interface Loopback1
  description VTEP SOURCE
  ip address ${vtepIp}/32
  isis enable UNDERLAY
  isis passive
!
! ── UPLINKS to spines (topology-driven from BOM port-math) ──────────────────
${fabricLinks}
!
! ── VLANs (tenant L2 domains — mapped to VNIs on Vxlan1) ────────────────────
vlan 10
  name SERVERS
  ! EOS trunk-group semantics: once a trunk group is applied to the peer-link,
  ! ONLY VLANs carrying that group traverse it. Without this VLAN 10 is filtered
  ! off the MLAG peer-link, breaking orphan-port and failover bridging (Z1).
  trunk group MLAG_PEER
!
! ── SERVER / HOST PORTS (Z1 — the tenant VLAN had no member ports) ───────────
interface ${aristaIf(dev, `1-${hostPortMax}`)}
  description SERVER-ACCESS (tenant VLAN 10)
  switchport mode access
  switchport access vlan 10
  spanning-tree portfast
  spanning-tree bpduguard enable
  mtu 9214
  no shutdown
!${fwHandoffBlock}
! ── BGP / EVPN ───────────────────────────────────────────────────────────────
router bgp ${leafAsn}
  router-id ${routerId}
  no bgp default ipv4-unicast
  maximum-paths 64 ecmp 64
  !
  ! eBGP EVPN leaf — flat EOS peer-group syntax; all spines share ASN 65000.
  neighbor SPINE-PEER peer group
  neighbor SPINE-PEER remote-as 65000
  neighbor SPINE-PEER update-source Loopback0
  neighbor SPINE-PEER bfd
  neighbor SPINE-PEER ebgp-multihop 3
  neighbor SPINE-PEER send-community extended
  neighbor SPINE-PEER maximum-routes 12000
  ! ── Spine eBGP peers (auto-generated from the fabric) ─────────────────────
${leafSpinePeerBlock}
  !
  ! MLAG peer-link iBGP (Y4/A-M2): if one member loses all uplinks, routes
  ! still reach it across Vlan4094 through its pair peer.
  neighbor MLAG-PEER peer group
  neighbor MLAG-PEER remote-as ${leafAsn}
  neighbor MLAG-PEER next-hop-self
  neighbor ${mlagPeerIp} peer group MLAG-PEER
  neighbor ${mlagPeerIp} description ${peerHostname}
  !
  address-family ipv4
    neighbor SPINE-PEER activate
    neighbor MLAG-PEER activate
    ! Z5b/A3-5: both loopbacks are already advertised by IS-IS (each carries
    ! isis enable UNDERLAY). Re-originating them into BGP makes every overlay
    ! next-hop resolve through a BGP route — a recursive next-hop that EOS
    ! will not install, so the VXLAN tunnels never come up.
  address-family evpn
    neighbor SPINE-PEER activate
  !
  vlan 10
    rd ${routerId}:10010
    route-target both 65000:10010${dciL2RtLines}
    redistribute learned
  !
  vrf TENANT-A
    rd ${routerId}:50000
    route-target import evpn 65000:50000
    route-target export evpn 65000:50000${dciL3RtLines}
    redistribute connected${tenantDefaultOriginate}
!
! ── TENANT VRF / ANYCAST GATEWAY (Y4/A-M1 — parity with NX-OS X1) ───────────
vrf instance TENANT-A
ip routing vrf TENANT-A
!
ip virtual-router mac-address 00:1c:73:00:00:99
!
interface Vlan10
  description TENANT-A-ANYCAST-GW
  vrf TENANT-A
  ip address virtual <CHANGE-ME-tenant-anycast-gw>/24
!
! ── VXLAN ────────────────────────────────────────────────────────────────────
interface Vxlan1
  description VTEP
  vxlan source-interface Loopback1
  vxlan udp-port 4789
  vxlan vlan 10 vni 10010
  vxlan vrf TENANT-A vni 50000
  vxlan learn-restrict any
!
! ── MLAG (HA pair with ${peerHostname}) ─────────────────────────────────────
vlan 4094
  name MLAG_PEER
  trunk group MLAG_PEER
!
interface Vlan4094
  description MLAG_PEER_L3_PEERING
  no autostate
  ip address ${mlagLocalIp}/31
!
interface Port-Channel${pairId}00
  description MLAG_PEER_LINK to ${peerHostname}
  switchport mode trunk
  switchport trunk group MLAG_PEER
!
interface ${aristaIf(dev, plPort1)}
  description MLAG_PEER_LINK member 1 to ${peerHostname}
  channel-group ${pairId}00 mode active
!
interface ${aristaIf(dev, plPort2)}
  description MLAG_PEER_LINK member 2 to ${peerHostname}
  channel-group ${pairId}00 mode active
!
mlag configuration
  domain-id ${domainId}MLAG${pairId}
  local-interface Vlan4094
  peer-address ${mlagPeerIp}
  peer-link Port-Channel${pairId}00
  reload-delay mlag 300
  reload-delay non-mlag 330
!
${qos}
!
${aristaTelemetryBlock()}
${aristaStorageBlock(appTypes)}`
}

function aristaTelemetryBlock(): string {
  return `! ── TELEMETRY (gNMI streaming + eAPI) ───────────────────────────────────────
management api gnmi
  transport grpc default
    port 6030
  provider eos-native
!
management api http-commands
  protocol https port 443
  no shutdown
  vrf MGMT
    no shutdown
!
daemon TerminAttr
  exec /usr/bin/TerminAttr -ingestgrpcurl=<CHANGE-ME-telemetry-collector-ip>:9910 -smashexcludes=ale,flexCounter,hardware,kni,pulse,strata -ingestexclude=/Sysdb/cell/1/agent,/Sysdb/cell/2/agent -taillogs
  no shutdown`
}

function aristaGpuQoS(): string {
  return `! ── QoS — Arista EOS GPU/RoCEv2 (ECN + PFC + DCQCN) ────────────────────────
! PFC priority 3 for RoCEv2, ECN on all lossy queues.
!
qos map dscp 26 28 to traffic-class 3    ! RoCEv2 → TC3 (lossless)
qos map dscp 46     to traffic-class 6    ! Voice  → TC6
qos map dscp 34 32  to traffic-class 5    ! Video  → TC5 (ECN)
qos map dscp 0      to traffic-class 0    ! Default
!
qos profile RDMA-TC3
  tx-queue 3
    bandwidth percent 60
    no priority
    pfc pause disable
  tx-queue 0
    bandwidth percent 40
    random-detect ecn
!
interface profile GPU-PORT
  pfc enable
  pfc mode on
  pfc priority 3 no-drop
  pfc priority 6 no-drop
  qos trust dscp
  qos profile RDMA-TC3
  flowcontrol receive off
  flowcontrol send off
!
! Apply profile to all GPU-connected ports:
! interface EthernetN
!   inherit profile GPU-PORT`
}

// ── Juniper QFX ───────────────────────────────────────────────────────────────

// Junos RoCEv2 / DCB lossless block for GPU/AI fabrics — PFC on the RDMA
// no-loss forwarding class (priority 3 / DSCP 26), ECN via WRED drop-profile,
// and a guaranteed-bandwidth scheduler. Mirrors the NX-OS/Arista lossless
// intent so a Juniper GPU fabric passes validator V-09 and is deployable.
function juniperRoceBlock(): string {
  return `
!
# ── RoCEv2 / DCB lossless fabric (PFC pri-3 no-drop · ECN · DCQCN) ──────────
set class-of-service forwarding-classes class RDMA queue-num 3 no-loss
set class-of-service forwarding-classes class STORAGE queue-num 5 no-loss
set class-of-service classifiers dscp RDMA-DSCP forwarding-class RDMA loss-priority low code-points 011010
set class-of-service congestion-notification-profile RDMA-PFC input dscp code-point 011010 pfc
set class-of-service drop-profiles ECN-WRED interpolate fill-level [ 70 90 ] drop-probability [ 0 100 ]
set class-of-service schedulers RDMA-SCHED transmit-rate percent 60
set class-of-service schedulers RDMA-SCHED explicit-congestion-notification
set class-of-service schedulers RDMA-SCHED drop-profile-map loss-priority low protocol any drop-profile ECN-WRED
set class-of-service scheduler-maps RDMA-MAP forwarding-class RDMA scheduler RDMA-SCHED
set class-of-service interfaces et-* unit 0 classifiers dscp RDMA-DSCP
set class-of-service interfaces et-* congestion-notification-profile RDMA-PFC
set class-of-service interfaces et-* scheduler-map RDMA-MAP
`
}

// Juniper QFX spine — IS-IS underlay + eBGP EVPN route-reflection to leaves.
// A spine is NOT a VTEP: no switch-options vtep-source / vrf-target here.
function juniperSpineConfig(dev: BOMDevice, idx: number, protoFeatures: string[] = [], needsRoce = false, allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const lo0ip = roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
  const isoNet = `49.0001.0101.0255.${String(idx + 1).padStart(4, '0')}.00`
  const roceBlock = needsRoce ? juniperRoceBlock() : ''
  const fabricLinks = renderJuniperFabricLinks('spine', dev, allDevices)
  // Real eBGP leaf peers from the fabric (leaf lo0 10.255.2.(i+1), ASN 65001+i).
  const leafNeighborLines = allDevices
    .filter(d => d.subLayer === 'leaf')
    .map((_d, i) => `set protocols bgp group LEAVES neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)} peer-as ${65001 + i}`)
    .join('\n')
  const spineLeafNeighbors = leafNeighborLines || 'set protocols bgp group LEAVES neighbor <CHANGE-ME-leaf-lo0> peer-as <CHANGE-ME-leaf-asn>'
  const ipv6 = protoFeatures.includes('IPv6 Dual-Stack')
  const v6Block = ipv6 ? `
!
# ── IPv6 dual-stack underlay (IS-IS multi-topology) ────────────────────────
set interfaces lo0 unit 0 family inet6 address <CHANGE-ME-lo0-v6>/128
set interfaces et-0/0/0 unit 0 family inet6 address <CHANGE-ME-fabric-v6-a>/127
set interfaces et-0/0/1 unit 0 family inet6 address <CHANGE-ME-fabric-v6-b>/127
set protocols isis topologies ipv6-unicast
` : ''

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : DC Spine (EVPN route-reflector / underlay)
# OS     : Juniper Junos (QFX)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

set system host-name ${dev.hostname}
set system domain-name <CHANGE-ME-domain.example.com>
set system name-server <CHANGE-ME-dns-ip>
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services netconf ssh
!
# ── AAA (single block — no duplication) ────────────────────────────────────
set system authentication-order [ tacplus password ]
set access tacacs-server <CHANGE-ME-tacacs-primary-ip> secret "<CHANGE-ME-tacacs-key>"
set access tacacs-server <CHANGE-ME-tacacs-primary-ip> single-connection
set access profile TACACS-PROFILE authentication-order tacplus
!
set system syslog host <CHANGE-ME-syslog-ip> any info
set system ntp server <CHANGE-ME-ntp-primary> prefer
set system ntp server <CHANGE-ME-ntp-secondary>
!
# ── MANAGEMENT ──────────────────────────────────────────────────────────────
set interfaces fxp0 unit 0 description "OOB-MANAGEMENT"
set interfaces fxp0 unit 0 family inet address <CHANGE-ME-mgmt-ip>/24
# Z5b/J3-4: the OOB default used to sit in inet.0 — a DATA-PLANE default route
# pointed out the management port, so any unresolved production traffic was
# sent to the OOB network. The management-instance knob puts fxp0 and its
# default route in the dedicated mgmt_junos routing instance instead.
set system management-instance
set routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop <CHANGE-ME-oob-gateway>
!
# ── LOOPBACK (family iso carries the IS-IS NET / system-id) ─────────────────
set interfaces lo0 unit 0 description "ROUTER-ID/BGP/ISIS-SOURCE"
set interfaces lo0 unit 0 family inet address ${lo0ip}/32
set interfaces lo0 unit 0 family iso address ${isoNet}
!
# ── FABRIC DOWNLINKS (topology-driven from the BOM — family inet /31 +
# family iso on every link; the underlay carried no IPv4 before, Y5/J-C1) ────
${fabricLinks}
!
# ── UNDERLAY: IS-IS only (no OSPF) ───────────────────────────────────────────
set protocols isis interface lo0.0 passive
set protocols isis level 1 disable
set protocols isis level 2 authentication-type md5
set protocols isis level 2 authentication-key "<CHANGE-ME-isis-auth-key>"
set protocols isis export LOOPBACKS-TO-ISIS
!
# ── BGP / EVPN (spine peers DOWN to leaves; multipath; not a VTEP) ──────────
set routing-options autonomous-system 65000
set protocols bgp group LEAVES type external
set protocols bgp group LEAVES local-address lo0.0
set protocols bgp group LEAVES multihop ttl 3
# The spine is NOT a VTEP: no-nexthop-change preserves the originating leaf's
# VTEP as the EVPN next-hop. Without it the spine rewrites next-hop to its own
# lo0 and every VXLAN tunnel black-holes (Z1 — parity with NX-OS Y1).
set protocols bgp group LEAVES multihop no-nexthop-change
set protocols bgp group LEAVES multipath
set protocols bgp group LEAVES family evpn signaling
set protocols bgp group LEAVES family inet unicast
set protocols bgp group LEAVES export LOOPBACKS-TO-BGP
set protocols bgp group LEAVES bfd-liveness-detection minimum-interval 300 multiplier 3
# ── Leaf eBGP peers (auto-generated from the fabric; peer-as = leaf ASN) ────
${spineLeafNeighbors}
!
# ── POLICY ───────────────────────────────────────────────────────────────────
set policy-options policy-statement LOOPBACKS-TO-ISIS term 1 from interface lo0.0
set policy-options policy-statement LOOPBACKS-TO-ISIS term 1 then accept
set policy-options policy-statement LOOPBACKS-TO-BGP  term 1 from interface lo0.0
set policy-options policy-statement LOOPBACKS-TO-BGP  term 1 then accept
${v6Block}${roceBlock}`.replace(/^!$/gm, '#')
}

// Junos storage lossless block for DC fabrics carrying NVMe-oF/iSCSI/FCoE.
// Priority-6 no-drop class via PFC (separate from RoCEv2 priority 3). Emitted
// for the `storage` app type when the RoCE block isn't already present (the
// RoCE block already defines a STORAGE no-loss class for GPU fabrics).
function juniperStorageBlock(): string {
  return `
!
# ── Storage lossless (NVMe-oF / iSCSI / FCoE — PFC priority 6 no-drop) ──────
set class-of-service forwarding-classes class STORAGE queue-num 5 no-loss
set class-of-service classifiers dscp STORAGE-DSCP forwarding-class STORAGE loss-priority low code-points 110000
set class-of-service congestion-notification-profile STORAGE-PFC input dscp code-point 110000 pfc
set class-of-service interfaces et-* unit 0 classifiers dscp STORAGE-DSCP
set class-of-service interfaces et-* congestion-notification-profile STORAGE-PFC
`
}

function juniperLeafConfig(dev: BOMDevice, idx: number, isMultisite = false, protoFeatures: string[] = [], needsRoce = false, appTypes: AppType[] = [], allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const leafAsn = 65001 + idx
  const isoNet  = `49.0001.0102.5500.${String(idx + 1).padStart(4, '0')}.00`
  // Real spine peers from the fabric (spine lo0 10.255.1.(i+1), ASN 65000).
  // Only the spines this leaf actually links to (Z1 — see nxosLeafConfig).
  const linkedSpineSet = new Set(closFabricLinks('leaf', dev, allDevices).map(l => l.peerHostname))
  const spineNeighborLines = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => linkedSpineSet.size === 0 || linkedSpineSet.has(x.d.hostname))
    .map(x => `set protocols bgp group SPINE-RR neighbor ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)} peer-as 65000`)
    .join('\n')
  const leafSpineNeighbors = spineNeighborLines || 'set protocols bgp group SPINE-RR neighbor <CHANGE-ME-spine-lo0> peer-as 65000'
  const fabricLinks = renderJuniperFabricLinks('leaf', dev, allDevices)
  // Z3 — north-south handoff on the border leaves, inside the TENANT-A vrf,
  // with the perimeter default originated into EVPN as a type-5 route. It used
  // to hang off the spines, which carry no tenant VRF at all.
  const { pairId: esiPair, peerHostname: esiPeer } = haPairInfo(dev, idx, allDevices)
  const fwLinks = fwHandoffPlan(dev, allDevices, 'border-leaf')
  const fwHandoffBlock = fwLinks.length ? `#
# ── FIREWALL HANDOFF (border leaf, routed /31 inside TENANT-A — FW side .1) ──
${fwLinks.flatMap(x => [
  `set interfaces xe-0/0/${x.port - 1} description "FW-HANDOFF: ${x.fw.hostname}"`,
  `set interfaces xe-0/0/${x.port - 1} unit 0 family inet address ${x.ip}/31`,
  `set routing-instances TENANT-A interface xe-0/0/${x.port - 1}.0`,
  `set routing-instances TENANT-A routing-options static route 0.0.0.0/0 next-hop ${nextIp(x.ip)}`,
]).join('\n')}
set policy-options policy-statement ORIGINATE-DEFAULT from route-filter 0.0.0.0/0 exact
set policy-options policy-statement ORIGINATE-DEFAULT then accept
set routing-instances TENANT-A protocols evpn ip-prefix-routes export ORIGINATE-DEFAULT
` : ''
  const ipv6 = protoFeatures.includes('IPv6 Dual-Stack')
  const roceBlock = needsRoce ? juniperRoceBlock() : ''
  // Storage lossless only when the RoCE block (which already has a STORAGE
  // class) isn't present, to avoid a duplicate forwarding-class definition.
  const storageBlock = (!needsRoce && appTypes.includes('storage')) ? juniperStorageBlock() : ''
  const v6Block = ipv6 ? `
!
# ── IPv6 dual-stack underlay (IS-IS multi-topology) ────────────────────────
set interfaces lo0 unit 0 family inet6 address <CHANGE-ME-lo0-v6>/128
set interfaces et-0/0/48 unit 0 family inet6 address <CHANGE-ME-fabric-v6-a>/127
set interfaces et-0/0/49 unit 0 family inet6 address <CHANGE-ME-fabric-v6-b>/127
set protocols isis topologies ipv6-unicast
` : ''
  const lo0ip   = roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  // Multisite DCI: site-local VNIs use the auto/site RT; VNIs stretched across
  // sites additionally carry the shared ${DCI_RT_ASN}:<vni> RT so only those
  // VNIs are leaked over the DCI (mirrors the NX-OS/Arista A7 behavior).
  const dciBlock = isMultisite ? `
!
# ── Multisite DCI: stretched RT ${DCI_RT_ASN}:<vni> on extended VNIs ────────
set protocols evpn vni-options vni 10010 vrf-target target:${DCI_RT_ASN}:10010
set switch-options vrf-target auto
set routing-instances EVPN-L3 vrf-target target:${DCI_RT_ASN}:50000
` : ''

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : DC Leaf (ToR / VTEP)
# OS     : Juniper Junos (QFX)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

set system host-name ${dev.hostname}
set system domain-name <CHANGE-ME-domain.example.com>
set system name-server <CHANGE-ME-dns-ip>
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services netconf ssh
!
# ── AAA (single block — no duplication) ────────────────────────────────────
set system authentication-order [ tacplus password ]
set access tacacs-server <CHANGE-ME-tacacs-primary-ip> secret "<CHANGE-ME-tacacs-key>"
set access tacacs-server <CHANGE-ME-tacacs-primary-ip> single-connection
set access tacacs-server <CHANGE-ME-tacacs-secondary-ip> secret "<CHANGE-ME-tacacs-key>"
set access profile TACACS-PROFILE authentication-order tacplus
!
set system syslog host <CHANGE-ME-syslog-ip> any info
set system ntp server <CHANGE-ME-ntp-primary> prefer
set system ntp server <CHANGE-ME-ntp-secondary>
!
# ── MANAGEMENT ──────────────────────────────────────────────────────────────
set interfaces fxp0 unit 0 description "OOB-MANAGEMENT"
set interfaces fxp0 unit 0 family inet address <CHANGE-ME-mgmt-ip>/24
# Z5b/J3-4: the OOB default used to sit in inet.0 — a DATA-PLANE default route
# pointed out the management port, so any unresolved production traffic was
# sent to the OOB network. The management-instance knob puts fxp0 and its
# default route in the dedicated mgmt_junos routing instance instead.
set system management-instance
set routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop <CHANGE-ME-oob-gateway>
!
# ── LOOPBACK (family iso carries the IS-IS NET / system-id) ─────────────────
set interfaces lo0 unit 0 description "ROUTER-ID/BGP/ISIS-SOURCE"
set interfaces lo0 unit 0 family inet address ${lo0ip}/32
set interfaces lo0 unit 0 family iso address ${isoNet}
!
# ── FABRIC UPLINKS (topology-driven from the BOM — family inet /31 +
# family iso on every link; the underlay carried no IPv4 before, Y5/J-C1) ────
${fabricLinks}
!
# ── UNDERLAY: IS-IS only (no OSPF) ───────────────────────────────────────────
set protocols isis interface lo0.0 passive
set protocols isis level 1 disable
set protocols isis level 2 authentication-type md5
set protocols isis level 2 authentication-key "<CHANGE-ME-isis-auth-key>"
set protocols isis export LOOPBACKS-TO-ISIS
!
# ── BGP / EVPN (eBGP over loopback needs local-address + multihop) ──────────
set routing-options autonomous-system ${leafAsn}
set protocols bgp group SPINE-RR type external
set protocols bgp group SPINE-RR local-address lo0.0
set protocols bgp group SPINE-RR multihop ttl 3
${leafSpineNeighbors}
set protocols bgp group SPINE-RR multipath
set protocols bgp group SPINE-RR export LOOPBACKS-TO-BGP
set protocols bgp group SPINE-RR family evpn signaling
set protocols bgp group SPINE-RR family inet unicast
set protocols bgp group SPINE-RR bfd-liveness-detection minimum-interval 300 multiplier 3
!
# ── EVPN / VXLAN ─────────────────────────────────────────────────────────────
set vlans V10 vlan-id 10
set vlans V10 vxlan vni 10010
set vlans V10 l3-interface irb.10
#
# ── SERVER / HOST PORTS + IRB ANYCAST GATEWAY (Z1 — Juniper was the only
# vendor with no tenant gateway and no access ports; NX-OS got this in X1,
# Arista in Y4) ──────────────────────────────────────────────────────────────
set interfaces xe-0/0/0 unit 0 family ethernet-switching interface-mode access
set interfaces xe-0/0/0 unit 0 family ethernet-switching vlan members V10
# … repeat for each single-homed server port xe-0/0/1 .. xe-0/0/${(dev.ports || 48) - 1}
#
# ── ESI-LAG: DUAL-HOMED SERVERS (J3-3) ──────────────────────────────────────
# Junos EVPN multihomes a server with an ESI-LAG, NOT a peer-link — that is
# why this leaf has no MLAG. Both members of the pair (with ${esiPeer}) must
# advertise the SAME ESI and the SAME LACP system-id, or the server sees two
# independent links instead of one bundle and half its traffic is dropped.
set interfaces xe-0/0/1 ether-options 802.3ad ae0
set interfaces ae0 description "ESI-LAG to dual-homed server (pair ${esiPair})"
set interfaces ae0 esi 00:00:00:00:00:00:00:00:${String(esiPair).padStart(2, '0')}:01
set interfaces ae0 esi all-active
set interfaces ae0 aggregated-ether-options lacp active
set interfaces ae0 aggregated-ether-options lacp system-id 00:00:5e:00:53:${String(esiPair).padStart(2, '0')}
set interfaces ae0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ae0 unit 0 family ethernet-switching vlan members V10
set chassis aggregated-devices ethernet device-count 8
set interfaces irb unit 10 family inet address <CHANGE-ME-tenant-anycast-gw>/24 virtual-gateway-address <CHANGE-ME-tenant-anycast-vip>
set routing-instances TENANT-A instance-type vrf
set routing-instances TENANT-A interface irb.10
set routing-instances TENANT-A route-distinguisher ${lo0ip}:50000
set routing-instances TENANT-A vrf-target target:65000:50000
set routing-instances TENANT-A protocols evpn ip-prefix-routes advertise direct-nexthop
set routing-instances TENANT-A protocols evpn ip-prefix-routes encapsulation vxlan
set routing-instances TENANT-A protocols evpn ip-prefix-routes vni 50000
set switch-options vxlan-routing overlay-ecmp
${fwHandoffBlock}
#
# ── FIB ECMP (Junos needs an explicit forwarding-table policy — multipath
# alone installs multiple RIB routes but programs ONE next-hop; Z1/J3-6) ─────
set policy-options policy-statement LOAD-BALANCE then load-balance per-packet
set routing-options forwarding-table export LOAD-BALANCE
set protocols evpn encapsulation vxlan
set protocols evpn extended-vni-list all
set protocols evpn default-gateway no-gateway-community
set switch-options vtep-source-interface lo0.0
set switch-options route-distinguisher ${lo0ip}:1
set switch-options vrf-target target:65000:1
!
# ── POLICY ───────────────────────────────────────────────────────────────────
set policy-options policy-statement LOOPBACKS-TO-ISIS term 1 from interface lo0.0
set policy-options policy-statement LOOPBACKS-TO-ISIS term 1 then accept
set policy-options policy-statement LOOPBACKS-TO-BGP  term 1 from interface lo0.0
set policy-options policy-statement LOOPBACKS-TO-BGP  term 1 then accept
!
${dciBlock}${v6Block}${roceBlock}${storageBlock}`.replace(/^!$/gm, '#')
}

// ── Cisco Firewall (Zone-Based / FTD intent) ──────────────────────────────────

/** Firepower/FTD hardware — policy is FMC/FDM-managed, never flat CLI (X6). */
export function isFtdModel(model: string): boolean {
  return /\b(ftd|firepower|fpr)[-\s]?\d*/i.test(model || '')
}

// Cisco Secure Firewall (FTD): the ONLY CLI a real FTD box accepts is the
// initial bootstrap (mgmt network + manager registration). Everything else —
// zones, access control, NAT, platform settings — lives in FMC. Emitting
// IOS-XE ZBF for this hardware was the audit's "wrong OS" finding; instead we
// emit the genuine bootstrap plus a declarative FMC policy manifest the
// operator implements (or imports) in FMC.
function ciscoFtdFirewallConfig(dev: BOMDevice, _idx: number, useCase: UseCase | '' = '', allDevices: BOMDevice[] = []): string {
  // Y7: the manifest was byte-identical across every design. Derive the real
  // INSIDE side from the fabric this FW is actually cabled to — DC/GPU fabrics
  // hand off to the BORDER LEAVES (Z3 — a spine has no tenant VRF to route
  // into), campus to the distribution pair (VLAN 10 data + the mgmt VLAN).
  const isFabric = useCase === 'dc' || useCase === 'gpu' || useCase === 'multisite'
  const peers = isFabric
    ? borderLeaves(allDevices)
    : allDevices.filter(d => d.subLayer === 'distribution')
  const fws = allDevices.filter(d => d.subLayer === 'firewall')
  const fwIdx = Math.max(0, fws.findIndex(d => d.id === dev.id))
  // Mirror of fwHandoffPlan: the fabric side owns .0, the firewall side .1.
  const handoffLines = peers.length
    ? peers.map((p, pi) => `!   Ethernet1/${2 + pi}  zone=INSIDE  ip=${nextIp(fwHandoffIp(pi, fwIdx, fws.length))}/31  ← ${p.hostname} (fabric handoff)`).join('\n')
    : `!   Ethernet1/2  zone=INSIDE   ip=<CHANGE-ME-inside-ip>/<CHANGE-ME-inside-prefix>  desc=TRUSTED-LAN`
  const insideNets = isFabric
    ? '10.10.0.0/16 (tenant subnets), 10.255.0.0/16 (fabric loopbacks)'
    : '10.10.10.0/24 (VLAN 10 DATA), 10.255.99.0/24 (campus MGMT)'
  const dmzPort = 2 + Math.max(peers.length, 1)
  const routingLines = peers.length
    ? peers.map((p, pi) => `!   ${isFabric ? '10.10.0.0/16' : '10.10.10.0/24'} via ${fwHandoffIp(pi, fwIdx, fws.length)} (${p.hostname}) — ECMP across the ${peers.length} handoff link(s)`).join('\n')
    : '!   <CHANGE-ME-inside-net> via <CHANGE-ME-inside-gateway>'

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : Internet Perimeter Firewall (NGFW)
! OS     : Cisco Secure Firewall Threat Defense (FTD) — FMC-managed
! Model  : ${dev.model}
! NOTE   : FTD security policy is NOT CLI-configurable. Section 1 is the
!          real FTD CLI bootstrap; section 2 is the FMC policy manifest
!          to implement in Firepower Management Center.
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

! ── 1. FTD CLI BOOTSTRAP (console / SSH to the FTD box) ──────────────────────
configure network hostname ${dev.hostname}
configure network ipv4 manual <CHANGE-ME-mgmt-ip> <CHANGE-ME-mgmt-mask> <CHANGE-ME-oob-gateway>
configure network dns servers <CHANGE-ME-dns-ip>
configure network dns searchdomains <CHANGE-ME-domain.example.com>
configure ssh-access-list <CHANGE-ME-mgmt-subnet>
configure ntp servers <CHANGE-ME-ntp-primary> <CHANGE-ME-ntp-secondary>
configure manager add <CHANGE-ME-fmc-ip> <CHANGE-ME-registration-key>
!
! ── 2. FMC POLICY MANIFEST (implement in Firepower Management Center) ────────
!
! [Interfaces]  (FMC > Devices > Interface)
!   Ethernet1/1  zone=OUTSIDE  ip=<CHANGE-ME-outside-ip>/<CHANGE-ME-outside-prefix>  desc=UNTRUSTED-INTERNET
${handoffLines}
!   Ethernet1/${dmzPort}  zone=DMZ      ip=<CHANGE-ME-dmz-ip>/<CHANGE-ME-dmz-prefix>          desc=PUBLIC-SERVERS
!
! [Routing]     (FMC > Devices > Routing)
!   static 0.0.0.0/0 via <CHANGE-ME-upstream-gateway> (interface Ethernet1/1)
${routingLines}
!
! [Access Control Policy: ACP-${dev.hostname}]  default action: BLOCK ALL
!   10  allow  INSIDE  -> OUTSIDE  apps: HTTP,HTTPS,DNS,NTP,SSH   inspect: IPS+file policy
!   20  allow  INSIDE  -> DMZ      ports: tcp/443,tcp/22           inspect: IPS
!   30  allow  OUTSIDE -> DMZ      ports: tcp/443,tcp/25,udp/53    inspect: IPS+file policy
!   40  deny   any     -> any      log at end of ACP (implicit)
!
! [Object: INSIDE-NETS]  ${insideNets}
!
! [NAT Policy]  (FMC > Devices > NAT)
!   auto  dynamic  source INSIDE-NETS -> interface Ethernet1/1 (PAT)
!   static        <CHANGE-ME-dmz-server-ip> <-> <CHANGE-ME-public-ip> (tcp/443)
!
! [Platform Settings: PS-${dev.hostname}]
!   ntp server <CHANGE-ME-ntp-primary> prefer
!   ntp server <CHANGE-ME-ntp-secondary>
!   syslog: logging host <CHANGE-ME-syslog-ip> (level informational, mgmt intf)
!   ssh access: <CHANGE-ME-mgmt-subnet> on management interface only
!   banner: authorized access only
!
! [Health / Telemetry]
!   SNMPv3 user netmon auth sha <CHANGE-ME-snmp-auth-pass> priv <CHANGE-ME-snmp-priv-pass>
!   health policy: default + interface status + CPU/memory thresholds
`
}

function ciscoFirewallConfig(dev: BOMDevice, _idx: number): string {
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : Internet Perimeter Firewall (Zone-Based)
! OS     : Cisco IOS-XE (Zone-Based Firewall)
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

${mgmtBlock(dev.hostname, 10)}
!
! ── SECURITY ZONES ───────────────────────────────────────────────────────────
zone security OUTSIDE
  description UNTRUSTED-INTERNET
zone security DMZ
  description SEMI-TRUSTED-SERVERS
zone security INSIDE
  description TRUSTED-CORP-NETWORK
zone security MGMT
  description MANAGEMENT-PLANE
!
! ── CLASS MAPS (traffic classification) ──────────────────────────────────────
ip access-list extended ACL-INSIDE-TO-OUTSIDE
  permit ip 10.0.0.0 0.255.255.255 any
  permit ip 172.16.0.0 0.15.255.255 any
  permit ip 192.168.0.0 0.0.255.255 any
!
ip access-list extended ACL-INSIDE-TO-DMZ
  permit tcp 10.0.0.0 0.255.255.255 10.100.0.0 0.0.255.255 eq 443
  permit tcp 10.0.0.0 0.255.255.255 10.100.0.0 0.0.255.255 eq 80
!
ip access-list extended ACL-OUTSIDE-TO-DMZ
  permit tcp any 10.100.0.10 0.0.0.255 eq 443
  permit tcp any 10.100.0.10 0.0.0.255 eq 80
!
class-map type inspect match-all CM-INSIDE-TO-OUTSIDE
  match access-group name ACL-INSIDE-TO-OUTSIDE
class-map type inspect match-all CM-INSIDE-TO-DMZ
  match access-group name ACL-INSIDE-TO-DMZ
class-map type inspect match-all CM-OUTSIDE-TO-DMZ
  match access-group name ACL-OUTSIDE-TO-DMZ
!
! ── POLICY MAPS (stateful inspection per zone-pair) ──────────────────────────
policy-map type inspect PM-INSIDE-TO-OUTSIDE
  class type inspect CM-INSIDE-TO-OUTSIDE
    inspect
  class class-default
    drop log
!
policy-map type inspect PM-INSIDE-TO-DMZ
  class type inspect CM-INSIDE-TO-DMZ
    inspect
  class class-default
    drop log
!
policy-map type inspect PM-OUTSIDE-TO-DMZ
  class type inspect CM-OUTSIDE-TO-DMZ
    inspect
  class class-default
    drop log
!
! ── ZONE-PAIRS (bidirectional — explicit deny is default) ────────────────────
zone-pair security ZP-INSIDE-TO-OUTSIDE source INSIDE destination OUTSIDE
  service-policy type inspect PM-INSIDE-TO-OUTSIDE
!
zone-pair security ZP-INSIDE-TO-DMZ source INSIDE destination DMZ
  service-policy type inspect PM-INSIDE-TO-DMZ
!
zone-pair security ZP-OUTSIDE-TO-DMZ source OUTSIDE destination DMZ
  service-policy type inspect PM-OUTSIDE-TO-DMZ
!
! ── INTERFACES ───────────────────────────────────────────────────────────────
interface GigabitEthernet0/0/0
  description OUTSIDE-INTERNET
  zone-member security OUTSIDE
  ip address <CHANGE-ME-outside-ip> <CHANGE-ME-outside-mask>
  ip nat outside
  no ip proxy-arp
  no shutdown
!
interface GigabitEthernet0/0/1
  description INSIDE-CORE-SWITCH
  zone-member security INSIDE
  ip address <CHANGE-ME-inside-ip> <CHANGE-ME-inside-mask>
  ip nat inside
  no shutdown
!
interface GigabitEthernet0/0/2
  description DMZ-SERVERS
  zone-member security DMZ
  ip address <CHANGE-ME-dmz-ip> <CHANGE-ME-dmz-mask>
  no shutdown
!
! ── NAT (outside → inside PAT for INSIDE zone) ───────────────────────────────
ip nat pool INSIDE-NAT <CHANGE-ME-nat-pool-start> <CHANGE-ME-nat-pool-end> netmask 255.255.255.0
ip nat inside source route-map RM-NAT pool INSIDE-NAT overload
!
route-map RM-NAT permit 10
  match ip address ACL-INSIDE-TO-OUTSIDE
!
! ── ROUTING ───────────────────────────────────────────────────────────────────
ip route 0.0.0.0 0.0.0.0 <CHANGE-ME-default-gateway>
!
! ── IPS (if inline IDS/IPS sensor enabled) ───────────────────────────────────
! ip ips signature-category
!   category all
!     retired true
!   category ios_ips basic
!     retired false
! interface GigabitEthernet0/0/0
!   ip ips OUTSIDE-IPS in
!
! ── VRF SEGMENTATION (for multi-tenant or PCI isolation) ────────────────────
! vrf definition PCI-ZONE
!   rd 1:1
!   address-family ipv4
!     route-target export 1:1
!     route-target import 1:1
!
! ── OBJECT TRACKING (HA failover) ────────────────────────────────────────────
track 1 ip sla 1 reachability
ip sla 1
  icmp-echo <CHANGE-ME-default-gateway> source-interface GigabitEthernet0/0/0
  frequency 5
ip sla schedule 1 life forever start-time now
`
}

// ── Palo Alto PAN-OS ──────────────────────────────────────────────────────────

function paloAltoFirewallConfig(dev: BOMDevice, _idx: number): string {
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : Internet Perimeter Firewall
# OS     : Palo Alto PAN-OS
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# Syntax : PAN-OS set commands (CLI)
# ═══════════════════════════════════════════════════════════════

# ── DEVICE SETTINGS ──────────────────────────────────────────────────────────
set deviceconfig system hostname ${dev.hostname}
set deviceconfig system domain <CHANGE-ME-domain.example.com>
set deviceconfig system dns-setting servers primary <CHANGE-ME-dns-ip>
set deviceconfig system login-banner "Authorized access only. All activity monitored."
!
# ── ADMIN + AAA ──────────────────────────────────────────────────────────────
set mgt-config users admin phash <CHANGE-ME-admin-phash>
set mgt-config users admin permissions role-based superuser yes
!
set server-profile tacacs TACACS-PROFILE server TACACS-PRIMARY server-address <CHANGE-ME-tacacs-primary-ip>
set server-profile tacacs TACACS-PROFILE server TACACS-PRIMARY secret <CHANGE-ME-tacacs-key>
set server-profile tacacs TACACS-PROFILE server TACACS-SECONDARY server-address <CHANGE-ME-tacacs-secondary-ip>
set server-profile tacacs TACACS-PROFILE server TACACS-SECONDARY secret <CHANGE-ME-tacacs-key>
set server-profile tacacs TACACS-PROFILE use-radius-for-users no
!
set authentication-profile TACACS-AUTH method tacacs server-profile TACACS-PROFILE
set authentication-profile TACACS-AUTH allow-list all
set authentication-sequence TACACS-THEN-LOCAL authentication-profiles [ TACACS-AUTH ]
!
# ── SNMP / SYSLOG / NTP ───────────────────────────────────────────────────────
set deviceconfig system ntp-servers primary-ntp-server ntp-server-address <CHANGE-ME-ntp-primary>
set deviceconfig system ntp-servers secondary-ntp-server ntp-server-address <CHANGE-ME-ntp-secondary>
!
set server-profile syslog SYSLOG-PROFILE servers SYSLOG1 server <CHANGE-ME-syslog-ip>
set server-profile syslog SYSLOG-PROFILE servers SYSLOG1 transport UDP
set server-profile syslog SYSLOG-PROFILE servers SYSLOG1 port 514
set server-profile syslog SYSLOG-PROFILE servers SYSLOG1 facility LOG_USER
!
set server-profile snmp SNMP-PROFILE version v3 users NETDESIGN-USER authpwd <CHANGE-ME-snmp-auth-pass>
set server-profile snmp SNMP-PROFILE version v3 users NETDESIGN-USER privpwd <CHANGE-ME-snmp-priv-pass>
!
# ── INTERFACES ───────────────────────────────────────────────────────────────
set network interface ethernet ethernet1/1 layer3 ipv4 addr primary ip-address <CHANGE-ME-outside-ip>/<CHANGE-ME-prefix>
set network interface ethernet ethernet1/1 comment "OUTSIDE-INTERNET"
!
set network interface ethernet ethernet1/2 layer3 ipv4 addr primary ip-address <CHANGE-ME-inside-ip>/<CHANGE-ME-prefix>
set network interface ethernet ethernet1/2 comment "INSIDE-CORP"
!
set network interface ethernet ethernet1/3 layer3 ipv4 addr primary ip-address <CHANGE-ME-dmz-ip>/<CHANGE-ME-prefix>
set network interface ethernet ethernet1/3 comment "DMZ-SERVERS"
!
# ── ZONES ─────────────────────────────────────────────────────────────────────
set zone OUTSIDE network layer3 ethernet1/1
set zone OUTSIDE enable-user-identification no
set zone INSIDE  network layer3 ethernet1/2
set zone INSIDE  enable-user-identification yes
set zone DMZ     network layer3 ethernet1/3
set zone DMZ     enable-user-identification no
!
# ── SECURITY POLICY ───────────────────────────────────────────────────────────
# Rule 1: Allow INSIDE → OUTSIDE with Threat Prevention + URL filtering
set rulebase security rules INSIDE-TO-OUTSIDE from INSIDE
set rulebase security rules INSIDE-TO-OUTSIDE to OUTSIDE
set rulebase security rules INSIDE-TO-OUTSIDE source any
set rulebase security rules INSIDE-TO-OUTSIDE destination any
set rulebase security rules INSIDE-TO-OUTSIDE application any
set rulebase security rules INSIDE-TO-OUTSIDE service application-default
set rulebase security rules INSIDE-TO-OUTSIDE action allow
set rulebase security rules INSIDE-TO-OUTSIDE profile-setting profiles virus default
set rulebase security rules INSIDE-TO-OUTSIDE profile-setting profiles spyware default
set rulebase security rules INSIDE-TO-OUTSIDE profile-setting profiles vulnerability default
set rulebase security rules INSIDE-TO-OUTSIDE profile-setting profiles url-filtering default
set rulebase security rules INSIDE-TO-OUTSIDE profile-setting profiles file-blocking basic-file-blocking
set rulebase security rules INSIDE-TO-OUTSIDE log-end yes
!
# Rule 2: Allow OUTSIDE → DMZ (HTTPS/HTTP only)
set rulebase security rules OUTSIDE-TO-DMZ from OUTSIDE
set rulebase security rules OUTSIDE-TO-DMZ to DMZ
set rulebase security rules OUTSIDE-TO-DMZ destination <CHANGE-ME-dmz-server-ip>
set rulebase security rules OUTSIDE-TO-DMZ application ssl
set rulebase security rules OUTSIDE-TO-DMZ service application-default
set rulebase security rules OUTSIDE-TO-DMZ action allow
set rulebase security rules OUTSIDE-TO-DMZ profile-setting profiles vulnerability default
set rulebase security rules OUTSIDE-TO-DMZ log-end yes
!
# Rule 3: Implicit deny all — logged
set rulebase security rules DENY-ALL from any
set rulebase security rules DENY-ALL to any
set rulebase security rules DENY-ALL source any
set rulebase security rules DENY-ALL destination any
set rulebase security rules DENY-ALL application any
set rulebase security rules DENY-ALL service any
set rulebase security rules DENY-ALL action deny
set rulebase security rules DENY-ALL log-end yes
!
# ── NAT ───────────────────────────────────────────────────────────────────────
set rulebase nat rules INSIDE-PAT from INSIDE
set rulebase nat rules INSIDE-PAT to OUTSIDE
set rulebase nat rules INSIDE-PAT source any
set rulebase nat rules INSIDE-PAT destination any
set rulebase nat rules INSIDE-PAT source-translation dynamic-ip-and-port interface-address interface ethernet1/1
!
# ── THREAT PREVENTION ─────────────────────────────────────────────────────────
set profiles virus default action reset-both alert wildfire-action reset-both
set profiles spyware default action reset-both botnet-domains dns-security-policy sinkhole
set profiles vulnerability default action reset-both threat-exception any
!
# ── WILDFIRE ─────────────────────────────────────────────────────────────────
set deviceconfig setting wildfire file-size-limit pe 16
set deviceconfig setting wildfire file-size-limit elf 16
!
# ── ROUTING ───────────────────────────────────────────────────────────────────
set network virtual-router default routing-table ip static-route DEFAULT-ROUTE destination 0.0.0.0/0
set network virtual-router default routing-table ip static-route DEFAULT-ROUTE nexthop ip-address <CHANGE-ME-default-gateway>
!
# ── HA (Active/Passive) ────────────────────────────────────────────────────────
# set high-availability mode active-passive
# set high-availability group 1 peer-ip <CHANGE-ME-peer-ha-ip>
# set high-availability group 1 election-option priority 100
# set high-availability group 1 interface ha1 ip-address <CHANGE-ME-ha1-ip>
`
}

// ── Cisco IOS-XE WAN Edge ─────────────────────────────────────────────────────

function iosxeWanConfig(dev: BOMDevice, _idx: number): string {
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : WAN Edge Router
! OS     : Cisco IOS-XE
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

${mgmtBlock(dev.hostname, 10)}
!
! ── UNDERLAY: OSPF only (no IS-IS on WAN edge) ──────────────────────────────
router ospf 1
  router-id <CHANGE-ME-router-id>
  passive-interface default
  no passive-interface GigabitEthernet0/0/0
  no passive-interface GigabitEthernet0/0/1
  area 0 authentication message-digest
  log-adjacency-changes detail
!
interface GigabitEthernet0/0/0
  description WAN-UPLINK-TO-PROVIDER
  ip address <CHANGE-ME-wan-ip> <CHANGE-ME-wan-mask>
  ip ospf 1 area 0
  ip ospf message-digest-key 1 md5 <CHANGE-ME-ospf-auth-key>
  no ip ospf passive-interface
  no shutdown
!
interface GigabitEthernet0/0/1
  description LAN-DOWNLINK-TO-CORE
  ip address <CHANGE-ME-lan-ip> <CHANGE-ME-lan-mask>
  ip ospf 1 area 0
  no shutdown
!
! ── BGP (eBGP to SP, iBGP to DC if multisite) ────────────────────────────────
router bgp <CHANGE-ME-local-asn>
  bgp router-id <CHANGE-ME-router-id>
  bgp log-neighbor-changes
  !
  neighbor <CHANGE-ME-sp-peer-ip> remote-as <CHANGE-ME-sp-asn>
  neighbor <CHANGE-ME-sp-peer-ip> description ISP-eBGP-PEER
  neighbor <CHANGE-ME-sp-peer-ip> password 7 <CHANGE-ME-bgp-password>
  neighbor <CHANGE-ME-sp-peer-ip> send-community
  !
  address-family ipv4
    neighbor <CHANGE-ME-sp-peer-ip> activate
    neighbor <CHANGE-ME-sp-peer-ip> prefix-list PL-OUT out
    neighbor <CHANGE-ME-sp-peer-ip> prefix-list PL-IN  in
    network <CHANGE-ME-advertised-prefix>
!
ip prefix-list PL-OUT seq 10 permit <CHANGE-ME-advertised-prefix>
ip prefix-list PL-IN  seq 5  permit 0.0.0.0/0
ip prefix-list PL-IN  seq 99 deny   0.0.0.0/0 le 32
!
! ── IPSec / DMVPN (if SD-WAN overlay required) ───────────────────────────────
! crypto isakmp policy 10
!   encr aes 256
!   authentication pre-share
!   group 14
!   lifetime 28800
! crypto isakmp key <CHANGE-ME-psk> address 0.0.0.0
!
! ── QoS (WAN egress shaping) ─────────────────────────────────────────────────
class-map match-any CM-VOICE
  match dscp ef
class-map match-any CM-CRITICAL
  match dscp af31 af32
class-map match-any CM-BULK
  match dscp af11 af12
!
policy-map PM-WAN-SHAPING
  class CM-VOICE
    priority percent 15
  class CM-CRITICAL
    bandwidth percent 30
    random-detect dscp-based
  class CM-BULK
    bandwidth percent 10
    random-detect dscp-based
  class class-default
    fair-queue
    random-detect
!
interface GigabitEthernet0/0/0
  service-policy output PM-WAN-SHAPING
`
}

// ── Cisco IOS-XR SP/WAN PE Router (G-A9) ───────────────────────────────────────
// IOS-XR is Cisco's carrier-class OS for ASR 9000 / NCS / CRS platforms used as
// PE/P routers in SP/WAN cores. Emits true IOS-XR hierarchical syntax (NOT
// IOS-XE): GigabitEthernet0/0/0/0 interface naming, explicit `!` separators,
// `commit`-style config groups, `route-policy` instead of route-map.
//
// Underlay: a SINGLE IGP — IS-IS with Segment Routing (SR-MPLS). IS-IS+SR is
// the canonical SP-core choice (prefix-SID on Loopback0, TI-LFA fast-reroute);
// OSPF is intentionally NOT emitted so the single-underlay rule (CLAUDE.md §6
// rule 4) holds. The BGP overlay carries L3VPN (VPNv4) for customer VRFs, with
// a route-reflector client design toward the SP core.
function iosxrPeConfig(dev: BOMDevice, idx: number): string {
  const loopback0 = `10.255.10.${idx + 1}`
  const isisNet   = `49.0001.0102.5510.${String(idx + 1).padStart(4, '0')}.00`
  const prefixSid = 16000 + idx + 1          // global SR label block index
  const localAsn  = 65000

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : SP/WAN PE Router (Provider Edge — L3VPN + SR-MPLS)
! OS     : Cisco IOS-XR
! Model  : ${dev.model}
! Vendor : ${dev.vendor}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! Underlay: IS-IS + Segment Routing (SR-MPLS). No OSPF (single IGP).
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
! ── MANAGEMENT / AAA (single block — no duplication) ─────────────────────────
domain name <CHANGE-ME-domain.example.com>
domain name-server <CHANGE-ME-dns-ip>
!
banner motd ^
*******************************************************************************
*  ${dev.hostname} — Authorized access only. All activity is monitored.     *
*  Disconnect immediately if not an authorized user.                          *
*******************************************************************************
^
!
username admin
 group root-lr
 group cisco-support
 secret 10 <CHANGE-ME-admin-password>
!
aaa authentication login default group tacacs+ local
aaa authorization exec default group tacacs+ local
aaa accounting exec default start-stop group tacacs+
!
tacacs-server host <CHANGE-ME-tacacs-primary-ip> port 49
 key 7 <CHANGE-ME-tacacs-key>
!
tacacs-server host <CHANGE-ME-tacacs-secondary-ip> port 49
 key 7 <CHANGE-ME-tacacs-key>
!
tacacs source-interface MgmtEth0/RP0/CPU0/0
!
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes 128 <CHANGE-ME-snmp-priv-pass>
snmp-server group NETDESIGN-RO v3 priv read NETDESIGN-VIEW
snmp-server view NETDESIGN-VIEW 1.3.6.1 included
snmp-server host <CHANGE-ME-nms-ip> traps version 3 priv netmon
!
ntp
 server <CHANGE-ME-ntp-primary> prefer
 server <CHANGE-ME-ntp-secondary>
 source MgmtEth0/RP0/CPU0/0
!
logging <CHANGE-ME-syslog-ip> vrf default severity info
logging source-interface MgmtEth0/RP0/CPU0/0
!
ssh server v2
ssh server vrf default
!
line default
 transport input ssh
 exec-timeout 10 0
!
! ── OUT-OF-BAND MANAGEMENT ───────────────────────────────────────────────────
interface MgmtEth0/RP0/CPU0/0
 description OOB-MANAGEMENT
 ipv4 address <CHANGE-ME-mgmt-ip> 255.255.255.0
!
router static
 address-family ipv4 unicast
  0.0.0.0/0 <CHANGE-ME-oob-gateway>
 !
!
! ── LOOPBACK0 — ROUTER-ID / SR PREFIX-SID SOURCE ─────────────────────────────
interface Loopback0
 description ROUTER-ID / BGP / IS-IS / SR-PREFIX-SID
 ipv4 address ${loopback0} 255.255.255.255
!
! ── CORE-FACING INTERFACE (P2P to SP core) ───────────────────────────────────
interface GigabitEthernet0/0/0/0
 description CORE-UPLINK (IS-IS SR-MPLS underlay)
 cdp
 mtu 9216
 ipv4 address <CHANGE-ME-core-p2p-ip> 255.255.255.254
!
! ── CUSTOMER-FACING INTERFACE (PE-CE, in customer VRF) ───────────────────────
interface GigabitEthernet0/0/0/1
 description PE-CE-LINK :: VRF CUST-A
 vrf CUST-A
 ipv4 address <CHANGE-ME-pe-ce-ip> 255.255.255.252
!
! ── SEGMENT ROUTING (SR-MPLS global block) ───────────────────────────────────
segment-routing
 global-block 16000 23999
!
mpls oam
!
! ── UNDERLAY: IS-IS + Segment Routing (single IGP — no OSPF) ─────────────────
! Prefix-SID ${prefixSid} is advertised on Loopback0; TI-LFA gives sub-50ms
! fast-reroute. metric-style wide is mandatory for SR-MPLS.
router isis CORE
 is-type level-2-only
 net ${isisNet}
 nsr
 log adjacency changes
 address-family ipv4 unicast
  metric-style wide
  segment-routing mpls
  maximum-paths 32
 !
 interface Loopback0
  passive
  address-family ipv4 unicast
   prefix-sid index ${idx + 1}
  !
 !
 interface GigabitEthernet0/0/0/0
  point-to-point
  address-family ipv4 unicast
   metric 10
   fast-reroute per-prefix
   fast-reroute per-prefix ti-lfa
  !
 !
!
! ── L3VPN — customer VRF (replicate per tenant) ──────────────────────────────
vrf CUST-A
 address-family ipv4 unicast
  import route-target
   ${localAsn}:100
  !
  export route-target
   ${localAsn}:100
  !
 !
!
route-policy PASS-ALL
  pass
end-policy
!
route-policy CUST-A-IN
  set local-preference 200
  pass
end-policy
!
! ── BGP — VPNv4 overlay for L3VPN + PE-CE per VRF ────────────────────────────
router bgp ${localAsn}
 bgp router-id ${loopback0}
 nsr
 bgp graceful-restart
 address-family vpnv4 unicast
 !
 ! iBGP toward SP route-reflectors (VPNv4 carries all L3VPN routes)
 neighbor-group RR-CLIENTS
  remote-as ${localAsn}
  update-source Loopback0
  address-family vpnv4 unicast
   route-policy PASS-ALL in
   route-policy PASS-ALL out
   soft-reconfiguration inbound always
  !
 !
 neighbor <CHANGE-ME-rr1-loopback0>
  use neighbor-group RR-CLIENTS
  description SP-ROUTE-REFLECTOR-1
 !
 neighbor <CHANGE-ME-rr2-loopback0>
  use neighbor-group RR-CLIENTS
  description SP-ROUTE-REFLECTOR-2
 !
 ! PE-CE eBGP inside the customer VRF
 vrf CUST-A
  rd ${localAsn}:100
  address-family ipv4 unicast
   redistribute connected
  !
  neighbor <CHANGE-ME-ce-peer-ip>
   remote-as <CHANGE-ME-customer-asn>
   description CE-ROUTER :: CUST-A
   address-family ipv4 unicast
    route-policy CUST-A-IN in
    route-policy PASS-ALL out
    as-override
   !
  !
 !
!
! ── QoS — SP core egress (per-class queuing) ─────────────────────────────────
class-map match-any CM-EF
 match dscp ef
 end-class-map
!
class-map match-any CM-AF4
 match dscp af41 af42 af43
 end-class-map
!
policy-map PM-CORE-EGRESS
 class CM-EF
  priority level 1
  police rate percent 15
  !
 !
 class CM-AF4
  bandwidth percent 30
  random-detect dscp af41 1000 packets 8000 packets
 !
 class class-default
  bandwidth percent 40
  random-detect default
 !
 end-policy-map
!
! Apply egress shaping to the core uplink:
! interface GigabitEthernet0/0/0/0
!  service-policy output PM-CORE-EGRESS
!
! ── STREAMING TELEMETRY (gNMI / MDT to collector) ────────────────────────────
telemetry model-driven
 destination-group DG1
  address-family ipv4 <CHANGE-ME-telemetry-collector-ip> port 57400
   encoding self-describing-gpb
   protocol grpc no-tls
  !
 !
 sensor-group SG1
  sensor-path Cisco-IOS-XR-infra-statsd-oper:infra-statistics/interfaces/interface/latest/generic-counters
  sensor-path Cisco-IOS-XR-ip-rib-ipv4-oper:rib/vrfs/vrf/afs/af/safs/saf/ip-rib-route-table-names/ip-rib-route-table-name/protocol/bgp
 !
 subscription SUB1
  sensor-group-id SG1 sample-interval 30000
  destination-id DG1
 !
!
commit
`
}

// ── Cisco IOS-XE Campus Distribution / Access ──────────────────────────────────
// STP priority hierarchy: distribution-primary=4096 (root), distribution-
// secondary=8192 (secondary root), access=32768 (never root) — access ports
// get PortFast + BPDU Guard. Distribution pair runs HSRPv2 for the SVI default
// gateways (active/standby). IGMP snooping (+ querier on distribution) is added
// when voice/video app types are present.
function iosxeCampusConfig(dev: BOMDevice, idx: number, appTypes: AppType[], allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const isDist = dev.subLayer === 'distribution'
  // Both tiers address the mgmt SVI out of ONE /24, and both were indexed
  // from 0 within their own tier — so C-DIST-A01 and C-ACC-A01 were both
  // given 10.255.99.1. Two devices fighting for one management address, in
  // every campus design. Access starts after the distribution block (AF3).
  const nDist = allDevices.filter(d => d.subLayer === 'distribution').length
  const mgmtIdx = isDist ? idx : nDist + idx
  const { pairId, isPrimary, peerHostname } = haPairInfo(dev, idx, allDevices)
  const hasVoice = appTypes.includes('voice')
  const hasVideo = appTypes.includes('video')
  const needsIgmp = hasVoice || hasVideo

  const vlanBlock = `vlan 10
  name DATA
${hasVoice ? `vlan 20
  name VOICE
` : ''}vlan 99
  name MGMT-NATIVE`

  if (isDist) {
    const stpPriority = isPrimary ? 4096 : 8192
    const hsrpPriority = isPrimary ? 110 : 90
    // Deterministic router-id loopback (campus dist range 10.255.3.x) — V-12
    // flagged OSPF routers with no loopback interface.
    const lo0ip = roleIp('10.255.3.1', RoleSlot.CampusLoopback, idx)
    // Z4 — platform-correct port allocation. A C9500-48Y4C is 48x25G in
    // chassis + a 4x100G uplink block: the peer-link and the core uplink
    // belong on the 100G ports, the access downlinks and the firewall
    // handoff on the 25G ports. Previously every one of these commands named
    // TenGigabitEthernet, a port type the chassis does not have.
    const upCount = dev.uplinks || 4
    const peerLinkIf1 = uplinkIf(dev, 1)
    const peerLinkIf2 = uplinkIf(dev, Math.min(2, upCount))
    const coreUplinkIf = uplinkIf(dev, Math.min(3, upCount))
    // Firewall handoff eats the TOP of the host block (same discipline as the
    // border leaf, Z3), so it can never collide with the access downlinks.
    const fwLinks = fwHandoffPlan(dev, allDevices, 'distribution')
    const downlinkMax = Math.max(1, (dev.ports || 48) - fwLinks.length)
    const fwHandoffBlock = fwLinks.length ? `
! ── FIREWALL HANDOFF (routed /31 per FW — FW side is the .1 of each pair) ────
! Z3: the handoff /31s sit in OSPF (they were in no IGP, so no other campus
! device could reach the perimeter) and the default is originated from here.
${fwLinks.map(x => `interface ${hostIf(dev, x.port)}
  description FW-HANDOFF: ${x.fw.hostname}
  no switchport
  ip address ${x.ip} 255.255.255.254
  ip ospf 10 area 0
  no shutdown`).join('\n!\n')}
!
${fwLinks.map(x => `ip route 0.0.0.0 0.0.0.0 ${nextIp(x.ip)}`).join('\n')}
!
router ospf 10
${fwLinks.map(x => `  network ${x.ip} 0.0.0.1 area 0`).join('\n')}
  default-information originate
!` : ''
    const igmpBlock = needsIgmp ? `
! ── IGMP SNOOPING / QUERIER (voice/video app types present) ──────────────────
ip igmp snooping
ip igmp snooping querier
ip igmp snooping vlan 10 querier address <CHANGE-ME-igmp-querier-ip>
!` : ''
    const voiceSvi = hasVoice ? `!
interface Vlan20
  description VOICE-GATEWAY
  ip address <CHANGE-ME-vlan20-ip> <CHANGE-ME-vlan20-mask>
  ip helper-address <CHANGE-ME-dhcp-server-ip>
  no ip redirects
  standby version 2
  standby 20 ip <CHANGE-ME-vlan20-vip>
  standby 20 priority ${hsrpPriority}
  standby 20 preempt delay minimum 60
  standby 20 track 1 decrement 20
` : ''

    return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : Campus Distribution (HA pair with ${peerHostname})
! OS     : Cisco IOS-XE
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

${mgmtBlock(dev.hostname, 99)}
!
! ── VLANs ─────────────────────────────────────────────────────────────────────
${vlanBlock}
!
! ── SPANNING TREE — distribution is root / secondary-root for HA pair with ${peerHostname} ──
spanning-tree mode rapid-pvst
spanning-tree extend system-id
spanning-tree vlan 1-4094 priority ${stpPriority}
!
! ── SVIs + HSRPv2 (active/standby pair with ${peerHostname}) ─────────────────
interface Vlan10
  description DATA-GATEWAY
  ip address <CHANGE-ME-vlan10-ip> <CHANGE-ME-vlan10-mask>
  ip helper-address <CHANGE-ME-dhcp-server-ip>
  no ip redirects
  standby version 2
  standby 10 ip <CHANGE-ME-vlan10-vip>
  standby 10 priority ${hsrpPriority}
  standby 10 preempt delay minimum 60
  standby 10 authentication md5 key-string <CHANGE-ME-hsrp-key>
  standby 10 track 1 decrement 20
${voiceSvi}!
! ── MGMT SVI (Vlan99 — the mgmt plane sources from this; C-1) ────────────────
! Z4/C-7: the .254 the access switches point at was owned by NOBODY, so the
! whole campus mgmt plane (and therefore RADIUS) was unreachable and every
! 802.1X port failed closed. HSRP on Vlan99 now actually owns that address.
interface Vlan99
  description MGMT
  ip address ${roleIp('10.255.99.1', RoleSlot.CampusMgmt, mgmtIdx)} 255.255.255.0
  standby version 2
  standby 99 ip 10.255.99.254
  standby 99 priority ${hsrpPriority}
  standby 99 preempt delay minimum 60
!
track 1 interface ${coreUplinkIf} line-protocol
!
! ── LOOPBACK (router-id) ─────────────────────────────────────────────────────
interface Loopback0
  description ROUTER-ID
  ip address ${lo0ip} 255.255.255.255
!
! ── UPLINK TO CORE (routed, OSPF w/ md5 — C-5) ───────────────────────────────
interface ${coreUplinkIf}
  description UPLINK-TO-CORE
  no switchport
  ip address <CHANGE-ME-core-uplink-ip> <CHANGE-ME-core-uplink-mask>
  ip ospf message-digest-key 1 md5 <CHANGE-ME-ospf-md5-key>
  ip ospf network point-to-point
  no shutdown
!
! ── UNDERLAY: OSPF only (no IS-IS on campus) ─────────────────────────────────
router ospf 1
  router-id ${lo0ip}
  passive-interface default
  no passive-interface ${coreUplinkIf}
  network ${lo0ip} 0.0.0.0 area 0
  network <CHANGE-ME-core-uplink-ip> <CHANGE-ME-wildcard> area 0
  network <CHANGE-ME-vlan10-ip> <CHANGE-ME-wildcard> area 0
  ! Z4/C-7: the mgmt subnet was in NO network statement, so nothing outside
  ! the local VLAN could reach it — RADIUS, TACACS, syslog and NTP all dead.
  network 10.255.99.0 0.0.0.255 area 0
  area 0 authentication message-digest
!
! ── DOWNLINK TRUNKS to access switches (C-2) ─────────────────────────────────
interface range ${hostIf(dev, 1)}-${downlinkMax}
  description DOWNLINK-TO-ACCESS
  switchport mode trunk
  switchport trunk native vlan 99
  switchport trunk allowed vlan 10${hasVoice ? ',20' : ''},99
  no shutdown
!${fwHandoffBlock}
! ── PEER LINK to ${peerHostname} (L2 trunk for SVI / HSRP heartbeat) ─────────
interface Port-channel${pairId}
  description PEER-LINK to ${peerHostname}
  switchport mode trunk
  switchport trunk native vlan 99
  switchport trunk allowed vlan 10${hasVoice ? ',20' : ''},99
!
interface ${peerLinkIf1}
  description PEER-LINK member 1 to ${peerHostname}
  switchport mode trunk
  channel-group ${pairId} mode active
!
interface ${peerLinkIf2}
  description PEER-LINK member 2 to ${peerHostname}
  switchport mode trunk
  channel-group ${pairId} mode active
!
${igmpBlock}
`
  }

  // ── Access switch ──────────────────────────────────────────────────────────
  // Z4 — a C9200-48P's uplinks are the C9200-NM-4X module (TenGigabitEthernet
  // 1/1/1-4), NOT front-panel copper: all 48 in-chassis ports stay access.
  const accessPorts = dev.uplinkStart ? dev.ports : Math.max(1, dev.ports - 2)
  const accessUplink1 = uplinkIf(dev, 1)
  const accessUplink2 = uplinkIf(dev, Math.min(2, dev.uplinks || 2))
  const igmpBlock = needsIgmp ? `
! ── IGMP SNOOPING (voice/video app types present) ────────────────────────────
ip igmp snooping
ip igmp snooping vlan 10
${hasVoice ? 'ip igmp snooping vlan 20\n' : ''}!
` : ''

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : Campus Access (HA-uplink pair with ${peerHostname})
! OS     : Cisco IOS-XE
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

${mgmtBlock(dev.hostname, 99)}
!
! ── VLANs ─────────────────────────────────────────────────────────────────────
${vlanBlock}
!
! ── SPANNING TREE — access is never root ──────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree extend system-id
spanning-tree vlan 1-4094 priority 32768
spanning-tree portfast bpduguard default
!
! ── MGMT SVI (Vlan99 — the mgmt plane sources from this; C-1) ────────────────
interface Vlan99
  description MGMT
  ip address ${roleIp('10.255.99.1', RoleSlot.CampusMgmt, mgmtIdx)} 255.255.255.0
!
ip default-gateway 10.255.99.254
!
! ── DHCP SNOOPING / PORT SECURITY ─────────────────────────────────────────────
ip dhcp snooping
ip dhcp snooping vlan 10${hasVoice ? ',20' : ''}
no ip dhcp snooping information option
!
! ── 802.1X / NAC (C-6) ────────────────────────────────────────────────────────
aaa authentication dot1x default group radius
aaa authorization network default group radius
radius server NAC-1
  address ipv4 <CHANGE-ME-radius-ip> auth-port 1812 acct-port 1813
  key <CHANGE-ME-radius-key>
dot1x system-auth-control
!
! ── ACCESS PORTS (edge — PortFast + BPDU Guard + 802.1X w/ MAB fallback) ──────
interface range ${hostIf(dev, 1)}-${accessPorts}
  switchport mode access
  switchport access vlan 10
${hasVoice ? '  switchport voice vlan 20\n' : ''}  switchport port-security
  switchport port-security maximum 2
  switchport port-security violation restrict
  authentication host-mode multi-auth
  authentication port-control auto
  dot1x pae authenticator
  mab
  ! Z4/C-7: without a critical-auth fallback a RADIUS outage locks every port.
  authentication event server dead action authorize vlan 10
  authentication event server alive action reinitialize
  spanning-tree portfast
  spanning-tree bpduguard enable
  ip dhcp snooping limit rate 15
  storm-control broadcast level 1.00
  no shutdown
!
${igmpBlock}! ── UPLINKS to distribution (SPLIT trunks — one per dist member; the dist
! pair are standalone chassis, so a cross-chassis LACP MEC would suspend a
! member (C-3). STP blocks one path; HSRP + RPVST handle failover.) ──────────
interface ${accessUplink1}
  description UPLINK-1 to distribution A01
  switchport mode trunk
  switchport trunk native vlan 99
  switchport trunk allowed vlan 10${hasVoice ? ',20' : ''},99
  ip dhcp snooping trust
  no shutdown
!
interface ${accessUplink2}
  description UPLINK-2 to distribution A02
  switchport mode trunk
  switchport trunk native vlan 99
  switchport trunk allowed vlan 10${hasVoice ? ',20' : ''},99
  ip dhcp snooping trust
  no shutdown
`
}

// ── Fortinet FortiOS ─────────────────────────────────────────────────────────

function fortinetFirewallConfig(dev: BOMDevice, _idx: number): string {
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : NGFW (FortiGate)
# Model  : ${dev.model}
# OS     : Fortinet FortiOS 7.x
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

config system global
    set hostname "${dev.hostname}"
    set timezone 00
    set admintimeout 10
    set admin-ssh-v1 disable
    set admin-telnet disable
    set strong-crypto enable
    set password-policy-status enable
    set password-policy-min-length 12
    set password-policy-must-contain upper-case-letter lower-case-letter number non-alphanumeric
end

config system admin
    edit "admin"
        set password <CHANGE-ME-admin-password>
        set trusthost1 <CHANGE-ME-mgmt-subnet>/24
        set accprofile "super_admin"
    next
end

config system interface
    edit "mgmt"
        set mode static
        set ip <CHANGE-ME-mgmt-ip>/24
        set allowaccess ping https ssh
        set type physical
        set role lan
    next
    edit "port1"
        set mode static
        set ip <CHANGE-ME-outside-ip>/30
        set allowaccess ping
        set type physical
        set role wan
    next
    edit "port2"
        set mode static
        set ip <CHANGE-ME-inside-ip>/30
        set allowaccess ping
        set type physical
        set role lan
    next
end

config router static
    edit 1
        set gateway <CHANGE-ME-default-gw>
        set device "port1"
    next
end

config system dns
    set primary 8.8.8.8
    set secondary 8.8.4.4
end

config log syslogd setting
    set status enable
    set server "<CHANGE-ME-syslog-ip>"
    set facility local7
    set format default
end

config system ntp
    set ntpsync enable
    set type custom
    config ntpserver
        edit 1
            set server "<CHANGE-ME-ntp-primary>"
        next
        edit 2
            set server "<CHANGE-ME-ntp-secondary>"
        next
    end
end

config system snmp sysinfo
    set status enable
    set description "${dev.hostname} — NetDesign AI managed"
    set contact-info "<CHANGE-ME-noc-email>"
    set location "<CHANGE-ME-site-location>"
end

config system snmp user
    edit "netmon"
        set status enable
        set queries enable
        set query-port 161
        set notify-hosts <CHANGE-ME-nms-ip>
        set security-level auth-priv
        set auth-proto sha256
        set auth-pwd <CHANGE-ME-snmp-auth-pass>
        set priv-proto aes256
        set priv-pwd <CHANGE-ME-snmp-priv-pass>
    next
end

# ── Firewall Policies ────────────────────────────────────────────────────────
config firewall policy
    edit 1
        set name "Allow-Outbound"
        set srcintf "port2"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set logtraffic all
        set utm-status enable
        set av-profile "default"
        set ips-sensor "default"
        set ssl-ssh-profile "certificate-inspection"
    next
    edit 2
        set name "Deny-Inbound"
        set srcintf "port1"
        set dstintf "port2"
        set srcaddr "all"
        set dstaddr "all"
        set action deny
        set schedule "always"
        set service "ALL"
        set logtraffic all
    next
end

# ── IPS / Application Control ────────────────────────────────────────────────
config ips sensor
    edit "default"
        set comment "Default IPS sensor — high security"
        config entries
            edit 1
                set rule all
                set action block
                set severity high critical
            next
        end
    next
end
`
}

// ── Fortinet FortiSwitch Campus (distribution / access) ──────────────────────

function fortinetCampusConfig(dev: BOMDevice, idx: number, appTypes: AppType[] = []): string {
  const isDist = dev.subLayer === 'distribution'
  const role = isDist ? 'Campus Distribution (FortiSwitch)' : 'Campus Access (FortiSwitch)'
  const hasVoice = appTypes.includes('voice')
  const sviBase = `10.${10 + idx}`
  const vrrpPrio = idx % 2 === 0 ? 200 : 100

  // VLAN database — Data + Mgmt always; Voice when the voice app type is set.
  const vlanDb = `config switch vlan
    edit 10
        set description "Data"
    next${hasVoice ? `
    edit 20
        set description "Voice"
    next` : ''}
    edit 30
        set description "IoT"
    next
    edit 999
        set description "Mgmt"
    next
end`

  // Distribution gets L3 SVIs with VRRP first-hop redundancy + OSPF uplinks;
  // access is pure L2 with FortiLink trunk uplinks to the distribution pair.
  const l3Block = isDist
    ? `# ── L3 SVIs + VRRP (first-hop redundancy) ───────────────────────────────────
config system interface
    edit "vlan10"
        set vdom "root"
        set ip ${sviBase}.10.2 255.255.255.0
        set allowaccess ping
        set vlanid 10
        set interface "internal"
        config vrrp
            edit 10
                set vrip ${sviBase}.10.1
                set priority ${vrrpPrio}
                set adv-interval 1
                set preempt enable
            next
        end
    next${hasVoice ? `
    edit "vlan20"
        set vdom "root"
        set ip ${sviBase}.20.2 255.255.255.0
        set allowaccess ping
        set vlanid 20
        set interface "internal"
        config vrrp
            edit 20
                set vrip ${sviBase}.20.1
                set priority ${vrrpPrio}
                set preempt enable
            next
        end
    next` : ''}
end

# ── OSPF underlay to campus core ────────────────────────────────────────────
config router ospf
    set router-id ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)}
    config area
        edit 0.0.0.0
        next
    end
    config ospf-interface
        edit "core-uplink"
            set interface "port49"
            set network-type point-to-point
            set dead-interval 12
            set hello-interval 3
            set bfd enable
        next
    end
    config network
        edit 1
            set prefix ${sviBase}.10.0 255.255.255.0
        next
    end
end`
    : `# ── Access layer — L2 only, default GW via distribution VRRP VIP ─────────────
config system interface
    edit "vlan999"
        set vdom "root"
        set ip ${sviBase}.99.${idx + 10} 255.255.255.0
        set allowaccess ping https ssh
        set vlanid 999
        set interface "internal"
    next
end

config router static
    edit 1
        set gateway ${sviBase}.99.1
        set device "vlan999"
    next
end`

  // Access edge ports: PoE + port-security; voice VLAN tagging when enabled.
  const edgePorts = isDist
    ? `# ── Downlink trunks to access switches (FortiLink) ──────────────────────────
config switch interface
    edit "port1"
        set native-vlan 999
        set allowed-vlans 10,30${hasVoice ? ',20' : ''},999
        set stp-state enabled
        set edge-port disabled
    next
end`
    : `# ── Access edge ports — 802.1X + PoE+ + port-security ────────────────────────
config switch interface
    edit "port1"
        set native-vlan 10${hasVoice ? `
        set voice-vlan 20` : ''}
        set stp-state enabled
        set edge-port enabled
        set stp-bpdu-guard enabled
        set poe-status enable
        set poe-max-power 30000
        set security-mode 802.1X
    next
end

# ── Uplink trunk to distribution ────────────────────────────────────────────
config switch interface
    edit "port49"
        set native-vlan 999
        set allowed-vlans 10,30${hasVoice ? ',20' : ''},999
        set stp-state enabled
        set edge-port disabled
    next
end`

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : ${role}
# Model  : ${dev.model}
# OS     : Fortinet FortiSwitchOS 7.x (FortiLink-managed)
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

config system global
    set hostname "${dev.hostname}"
    set timezone 00
    set admin-ssh-v1 disable
    set admin-telnet disable
    set strong-crypto enable
    set admintimeout 10
end

config system admin
    edit "admin"
        set password <CHANGE-ME-admin-password>
        set accprofile "super_admin"
    next
end

# ── Management ──────────────────────────────────────────────────────────────
config system dns
    set primary <CHANGE-ME-dns-ip>
end

config log syslogd setting
    set status enable
    set server "<CHANGE-ME-syslog-ip>"
    set facility local7
end

config system ntp
    set ntpsync enable
    set type custom
    config ntpserver
        edit 1
            set server "<CHANGE-ME-ntp-primary>"
        next
    end
end

config system snmp sysinfo
    set status enable
    set contact-info "<CHANGE-ME-noc-email>"
    set location "<CHANGE-ME-site-location>"
end

config system snmp user
    edit "netmon"
        set status enable
        set queries enable
        set security-level auth-priv
        set auth-proto sha256
        set auth-pwd <CHANGE-ME-snmp-auth-pass>
        set priv-proto aes256
        set priv-pwd <CHANGE-ME-snmp-priv-pass>
    next
end

# ── VLAN database ───────────────────────────────────────────────────────────
${vlanDb}

# ── Spanning Tree (MSTP) ────────────────────────────────────────────────────
config switch stp settings
    set status enable
    set revision 1
    set forward-time 15
    set max-age 20
end
config switch stp instance
    edit "0"
        set priority ${isDist ? '4096' : '32768'}
    next
end

${l3Block}

${edgePorts}

# ── Storm control + LLDP ────────────────────────────────────────────────────
config switch storm-control
    set rate 500
    set broadcast enable
    set unknown-unicast enable
    set unknown-multicast enable
end

config switch lldp settings
    set status enable
    set management-interface internal
end
`
}

// ── Dell EMC OS10 ────────────────────────────────────────────────────────────

function dellOs10SwitchConfig(dev: BOMDevice, idx: number, isGpu = false, allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const isSpine = dev.subLayer === 'spine'
  // Z8 — real identity + real peers, the treatment X1/X3/X4 gave the other
  // vendors. Dell shipped `router bgp <CHANGE-ME-asn>` on BOTH roles (so even
  // if an operator filled them in, identical ASNs make eBGP impossible) and
  // `neighbor <CHANGE-ME-spine1-ip>` placeholders, so the fabric was dead.
  const asn = isSpine ? 65000 : 65000 + Math.floor(idx / 2) + 1
  const lo0ip = isSpine
    ? roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
    : roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  const dellLinks = closFabricLinks(isSpine ? 'spine' : 'leaf', dev, allDevices)
  const dellPortBase = isSpine
    ? 0
    : (dev.uplinkStart ? dev.uplinkStart - 1 : Math.max(0, (dev.ports || 32) - (dev.uplinks || 0)))
  const dellFabricIfaces = dellLinks.map(l => `interface ethernet1/1/${dellPortBase + l.ifIndex + 1}
  description ${isSpine ? 'DOWNLINK' : 'UPLINK'}: ${l.peerHostname}
  no switchport
  mtu 9216
  ip address ${l.localIp}
  no shutdown
!`).join('\n')
  const dellLeafPeers = allDevices
    .filter(d => d.subLayer === 'leaf')
    .map((_d, i) => `  neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)}
    remote-as ${65000 + Math.floor(i / 2) + 1}
    ebgp-multihop 2
    update-source loopback 0
    advertisement-interval 0
    timers 3 9
    bfd
    send-community extended
    no shutdown
    address-family l2vpn evpn
      activate
      route-map NH-UNCHANGED out
  !`).join('\n')
  const dellLinkedSpines = new Set(dellLinks.map(l => l.peerHostname))
  const dellSpinePeers = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => dellLinkedSpines.size === 0 || dellLinkedSpines.has(x.d.hostname))
    .map(x => `  neighbor ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)}
    remote-as 65000
    ebgp-multihop 2
    update-source loopback 0
    advertisement-interval 0
    timers 3 9
    bfd
    send-community extended
    no shutdown
    address-family l2vpn evpn
      activate
  !`).join('\n')
  const dellHostMax = isSpine ? 0 : leafHostPortMax(dev, allDevices)
  const dellFwLinks = isSpine ? [] : fwHandoffPlan(dev, allDevices, 'border-leaf')
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : ${isSpine ? 'Spine' : 'Leaf / ToR'}
! Model  : ${dev.model}
! OS     : Dell EMC OS10 (Enterprise SONiC compatible)
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
ip name-server 8.8.8.8
!
username admin password <CHANGE-ME-admin-password> role sysadmin
!
interface mgmt 1/1/1
  no shutdown
  ip address <CHANGE-ME-mgmt-ip>/24
!
management route 0.0.0.0/0 <CHANGE-ME-mgmt-gw>
!
! ── Loopback (router-id / BGP / VTEP source) ─────────────────────────────────
interface loopback 0
  no shutdown
  ip address ${lo0ip}/32
!
! ── NTP ─────────────────────────────────────────────────────────────────────
ntp server <CHANGE-ME-ntp-primary>
ntp server <CHANGE-ME-ntp-secondary>
!
! ── SNMP v3 ─────────────────────────────────────────────────────────────────
snmp-server group NETDESIGN-RO v3 priv read NETDESIGN-VIEW
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes-256 <CHANGE-ME-snmp-priv-pass>
snmp-server host <CHANGE-ME-nms-ip> traps version 3 priv netmon
!
! ── Syslog ──────────────────────────────────────────────────────────────────
logging server <CHANGE-ME-syslog-ip>
!
! ── LLDP ────────────────────────────────────────────────────────────────────
lldp enable
!
! ── FABRIC LINKS (topology-driven from BOM port-math, Z8) ───────────────────
${dellFabricIfaces || '! No fabric peers in this design'}
! ── UNDERLAY: eBGP over the /31s, overlay eBGP over loopback 0 ───────────────
! ── BGP (eBGP spine-leaf) ───────────────────────────────────────────────────
router bgp ${asn}
  router-id ${lo0ip}
  bestpath as-path multipath-relax
  !
  address-family ipv4 unicast
    maximum-paths 64
    network ${lo0ip}/32
  !
  address-family l2vpn evpn
    advertise-all-vni
  !
${isSpine
  ? `  ! ── Spine: one eBGP session per leaf, derived from the BOM ──────────────
${dellLeafPeers || '  ! No leaves in fabric'}`
  : `  ! ── Leaf: one eBGP session per LINKED spine ─────────────────────────────
${dellSpinePeers || '  ! No spines in fabric'}`}
!
${isSpine ? `! The spine is NOT a VTEP — it must re-advertise EVPN routes with the
! originating leaf's next-hop, or the overlay black-holes at the spine.
route-map NH-UNCHANGED permit 10
!` : ''}
! ── VXLAN ───────────────────────────────────────────────────────────────────
interface virtual-network 1
  vxlan-vni 10001
!
${dellHostMax > 0 ? `! ── SERVER / HOST PORTS (the VNI had no member ports before Z8) ──────────────
interface range ethernet 1/1/1-1/1/${dellHostMax}
  switchport access vlan 10
  mtu 9216
  no shutdown
!` : ''}${dellFwLinks.length ? `
! ── FIREWALL HANDOFF (border leaf, routed /31 — FW side is the .1) ───────────
${dellFwLinks.map(x => `interface ethernet1/1/${x.port}
  description FW-HANDOFF: ${x.fw.hostname}
  no switchport
  ip vrf forwarding TENANT-A
  ip address ${x.ip}/31
  no shutdown
!`).join('\n')}
ip vrf TENANT-A
!
${dellFwLinks.map(x => `ip route vrf TENANT-A 0.0.0.0/0 ${nextIp(x.ip)}`).join('\n')}
!` : ''}
${isGpu ? `! ── RoCEv2 / DCB / ECN — Full Lossless Fabric (OS10) ───────────────────────
!   Priority 3 → RoCEv2/RDMA (lossless, PFC no-drop)
!   Priority 6 → Storage/NVMe-oF (lossless, PFC no-drop)
!   Priority 0-2,4,5,7 → Lossy (ECN-marked, WRED)
!
! DSCP → Traffic Class mapping
qos-map dscp-tc RDMA-DSCP-MAP
  dscp 26 28 traffic-class 3    ! AF31/AF32 → TC3 (RoCEv2 lossless)
  dscp 34 36 traffic-class 5    ! AF41/AF42 → TC5 (Storage lossless)
  dscp 46    traffic-class 6    ! EF        → TC6 (Latency-sensitive)
  dscp 0     traffic-class 0    ! BE        → TC0 (Lossy)
!
! ETS (Enhanced Transmission Selection) — bandwidth carving per TC
qos-map tc-bandwidth-map RDMA-ETS
  traffic-class 3 bandwidth-percent 40   ! RDMA guaranteed 40%
  traffic-class 5 bandwidth-percent 10   ! Storage guaranteed 10%
  traffic-class 6 bandwidth-percent 10   ! Low-latency guaranteed 10%
  traffic-class 0 bandwidth-percent 40   ! Lossy best-effort 40%
!
! DCB map binding DSCP + ETS + PFC
dcb-map RDMA-LOSSLESS
  dscp-tc-map RDMA-DSCP-MAP
  tc-bandwidth-map RDMA-ETS
  priority-flow-control mode on
    priority 3 no-drop
    priority 6 no-drop
!
! ECN thresholds on lossy queues (TC0, TC6)
qos-map wred-profile LOSSY-ECN
  traffic-class 0 green  min-threshold 40 max-threshold 80 drop-probability 100
  traffic-class 0 yellow min-threshold 35 max-threshold 70 drop-probability 100
  traffic-class 6 green  min-threshold 50 max-threshold 90 drop-probability 100
!
! Apply DCB map + DSCP trust + ECN to all fabric ports
interface range ethernet 1/1/1-1/1/${dev.ports}
  trust dscp
  dcb-map RDMA-LOSSLESS
  pfc-watchdog on
  ecn
!
! Buffer management — dynamic threshold with lossless headroom
buffer dynamic-threshold
  pause-threshold 122880
  resume-threshold 81920
!` : ''}
`
}

// ── HPE Aruba CX ─────────────────────────────────────────────────────────────

function arubaOsCxConfig(dev: BOMDevice, _idx: number): string {
  const isSpine = dev.subLayer === 'spine'
  const isDist  = dev.subLayer === 'distribution'
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : ${dev.subLayer}
! Model  : ${dev.model}
! OS     : ArubaOS-CX 10.x
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
user admin group administrators password ciphertext <CHANGE-ME-admin-password>
!
interface mgmt
  shutdown
  ip static <CHANGE-ME-mgmt-ip>/24
  default-gateway <CHANGE-ME-mgmt-gw>
no interface mgmt shutdown
!
ntp server <CHANGE-ME-ntp-primary> iburst
ntp server <CHANGE-ME-ntp-secondary> iburst
ntp enable
!
! ── LLDP ────────────────────────────────────────────────────────────────────
lldp enable
!
! ── SSH ─────────────────────────────────────────────────────────────────────
ssh server vrf mgmt
aaa authentication login default local
!
! ── SNMP v3 ─────────────────────────────────────────────────────────────────
snmp-server vrf default
snmp-server group NETDESIGN-RO v3 priv
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes <CHANGE-ME-snmp-priv-pass>
!
! ── Logging ─────────────────────────────────────────────────────────────────
logging <CHANGE-ME-syslog-ip> vrf default severity informational
!
${isSpine || isDist ? `! ── BGP + EVPN ───────────────────────────────────────────────────────────────
router bgp <CHANGE-ME-asn>
  bgp router-id <CHANGE-ME-loopback-ip>
  maximum-paths 64
  !
  address-family l2vpn evpn
    advertise-all-vni
  !
  neighbor SPINES peer-group
    remote-as external
    timers 3 9
    send-community
    send-community extended
    address-family ipv4 unicast
      activate
    address-family l2vpn evpn
      activate
  !
  neighbor <CHANGE-ME-peer-ip> peer-group SPINES
!
! ── VXLAN ────────────────────────────────────────────────────────────────────
interface loopback 0
  ip address <CHANGE-ME-loopback-ip>/32
!
interface vxlan 1
  source ip <CHANGE-ME-loopback-ip>
  no shutdown` : `! ── Access layer: VLANs + PoE ───────────────────────────────────────────────
vlan 10
  name Management
vlan 20
  name Data
vlan 30
  name Voice
!
interface 1/1/1-1/1/${dev.ports}
  no shutdown
  vlan access 20
  spanning-tree bpduguard enable
  spanning-tree port-type admin-edge`}
`
}

// ── NVIDIA Cumulus Linux ──────────────────────────────────────────────────────

// Cumulus Linux 5.x speaks NVUE (`nv set`) — NCLU (`net add`) was removed in
// 5.x and /etc/network/interfaces range stanzas like `iface swp1-64` never
// parsed. Rewritten per the Y6 audit: real identity (auto ASN/loopback like
// every other vendor), per-port BGP-unnumbered neighbors derived from the BOM
// topology, `nv set qos roce` for a genuinely lossless GPU fabric (the old
// output had PFC/ECN only as comments — §6.5 violation), and no empty EVPN
// (a GPU fabric is standard pure eBGP L3; RFC 7938).
function nvidiaSpectrumConfig(dev: BOMDevice, idx: number, isGpu = false, allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const isSpine = dev.subLayer === 'spine'
  const asn = isSpine ? 65000 : 65000 + Math.floor(idx / 2) + 1
  const lo0ip = isSpine
    ? roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
    : roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  const ports = dev.ports || 64
  const uplinks = Math.max(2, dev.uplinks || 2)

  // Fabric peer ports: leaf uplinks are the TOP `uplinks` swp ports; the
  // spine peers on one port per assigned leaf link (staggered round-robin
  // via the shared planner; falls back to the full port block standalone).
  let peerPorts: number[]
  if (isSpine) {
    const linkCount = closFabricLinks('spine', dev, allDevices).length || Math.min(ports, 32)
    peerPorts = Array.from({ length: Math.min(linkCount, ports) }, (_, i) => i + 1)
  } else {
    peerPorts = Array.from({ length: uplinks }, (_, i) => ports - uplinks + i + 1)
  }
  // Z3b — border-leaf firewall handoff. Cumulus is a pure eBGP L3 fabric
  // (Y6, RFC 7938) with no tenant VRF, so the handoff lives in the default
  // VRF as a routed /31 with a static default that BGP redistributes — the
  // rest of the fabric had no north-south path at all before this.
  const nvFwLinks = isSpine ? [] : fwHandoffPlan(dev, allDevices, 'border-leaf')
  // Host ports stop below the handoff ports so the two never collide — same
  // helper the other vendors use, so the two allocators can never drift.
  const nvHostMax = isSpine ? ports : leafHostPortMax(dev, allDevices)
  const nvFwBlock = nvFwLinks.length ? `#
# ── FIREWALL HANDOFF (border leaf — routed /31, FW side is the .1) ───────────
${nvFwLinks.map(x => `nv set interface swp${x.port} ip address ${x.ip}/31
nv set interface swp${x.port} description FW-HANDOFF: ${x.fw.hostname}`).join('\n')}
${nvFwLinks.map(x => `nv set vrf default router static 0.0.0.0/0 via ${nextIp(x.ip)}`).join('\n')}
nv set vrf default router bgp address-family ipv4-unicast redistribute static enable on
#` : ''
  const neighborLines = peerPorts.map(p => `nv set vrf default router bgp neighbor swp${p} remote-as external
nv set vrf default router bgp neighbor swp${p} type unnumbered
nv set vrf default router bgp neighbor swp${p} timers keepalive 3
nv set vrf default router bgp neighbor swp${p} timers hold 9
nv set vrf default router bgp neighbor swp${p} bfd enable on`).join('\n')

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : ${isSpine ? 'Spine' : 'Leaf / ToR'}
# Model  : ${dev.model}
# OS     : NVIDIA Cumulus Linux 5.x (NVUE)
# Apply  : source this file into the shell — it is a script of nv set lines,
#          NOT an nv config replace YAML snapshot — then apply:
#            bash <this-file> && nv config apply
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── SYSTEM / MANAGEMENT (eth0 in the mgmt VRF) ───────────────────────────────
nv set system hostname ${dev.hostname}
nv set system aaa user admin password <CHANGE-ME-admin-password>
nv set system aaa user admin role system-admin
nv set interface eth0 ip vrf mgmt
# Z5b/N3-5: static OOB addressing, matching every other vendor. DHCP on the
# management port makes the device's address unpredictable, which breaks the
# NMS/syslog/ZTP-callback records the rest of the pipeline generates.
nv set interface eth0 ip address <CHANGE-ME-mgmt-ip>/24
nv set vrf mgmt router static 0.0.0.0/0 via <CHANGE-ME-oob-gateway>
nv set service ntp mgmt server <CHANGE-ME-ntp-primary> iburst on
nv set service ntp mgmt server <CHANGE-ME-ntp-secondary> iburst on
nv set service syslog mgmt server <CHANGE-ME-syslog-ip> port 514
nv set service snmp-server enable on
nv set service snmp-server username netmon auth-sha <CHANGE-ME-snmp-auth-pass> encrypt-aes <CHANGE-ME-snmp-priv-pass>

# ── LOOPBACK / FABRIC PORTS (jumbo MTU for RoCE/VXLAN payloads) ──────────────
nv set interface lo ip address ${lo0ip}/32
nv set interface swp1-${ports} link mtu 9216
nv set interface swp1-${ports} link state up
${isSpine ? '' : `#
# ── GPU SERVER PORTS (Z1 — swp1-${nvHostMax} are cabled to compute nodes but had no
# L3 config at all: 512 GPUs had no network. Rail-optimized L3-to-the-host:
# each server port is a routed /31 in the default VRF, RoCE DSCP trust is
# inherited from the qos roce profile below.) ────────────────────────────────
nv set interface swp1-${nvHostMax} ip address <CHANGE-ME-host-p2p>/31
nv set vrf default router bgp address-family ipv4-unicast network <CHANGE-ME-host-subnet>
# (the host prefixes reach the fabric via the redistribute-connected above)
#`}${nvFwBlock}

# ── BGP eBGP spine-leaf, unnumbered (RFC 7938) ───────────────────────────────
nv set router bgp enable on
nv set router bgp autonomous-system ${asn}
nv set router bgp router-id ${lo0ip}
nv set vrf default router bgp address-family ipv4-unicast enable on
nv set vrf default router bgp address-family ipv4-unicast redistribute connected enable on
nv set vrf default router bgp address-family ipv4-unicast multipaths ebgp 64
nv set vrf default router bgp path-selection multipath aspath-ignore on
${neighborLines}
${isGpu ? `
# ── RoCEv2 LOSSLESS (Spectrum — programs PFC priority 3 no-drop, ECN/WRED
# on lossy queues, buffer carving and DSCP trust in one switchd profile;
# the §6.5 requirement. This was previously comments only — the fabric
# shipped LOSSY.) ────────────────────────────────────────────────────────────
nv set qos roce enable on
nv set qos roce mode lossless
#
# ── HOST-SIDE RoCE (N3-4) ────────────────────────────────────────────────────
# Lossless is a CONTRACT: the switch half above is inert unless every attached
# GPU server marks and honours the same priority. These are the matching
# ConnectX/BlueField settings, run once per RDMA NIC on each compute node —
# not switch config, but the design is not deployable without them.
#   mlnx_qos -i <nic> --trust dscp                 # trust DSCP, not 802.1p
#   mlnx_qos -i <nic> --pfc 0,0,0,1,0,0,0,0        # PFC on priority 3 only
#   cma_roce_tos -d <ib-dev> -t 106                # RoCE DSCP 26 (TC3)
#   echo 106 > /sys/class/infiniband/<ib-dev>/tc/1/traffic_class
#   sysctl -w net.ipv4.tcp_ecn=1                   # ECN participation
# Verify end to end: mlnx_qos -i <nic> on the host and
# nv show qos roce counters on this switch must agree on priority 3.
` : ''}
# ── APPLY ────────────────────────────────────────────────────────────────────
nv config apply
`
}

// ── Extreme Networks EXOS / Switch Engine ─────────────────────────────────────

function extremeExosConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const isSpine = dev.subLayer === 'spine'
  const isAccess = dev.subLayer === 'access'
  // Z8 — real identity + real peers. EXOS shipped `configure bgp AS-number
  // <CHANGE-ME-asn>` on both roles and `<CHANGE-ME-leaf-range>` /
  // `<CHANGE-ME-spine1-ip>` peers, so the fabric never formed a session.
  const asn = isSpine ? 65000 : 65000 + Math.floor(idx / 2) + 1
  const lo0ip = isSpine
    ? roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
    : roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  const exosLinks = isAccess ? [] : closFabricLinks(isSpine ? 'spine' : 'leaf', dev, allDevices)
  const exosPortBase = isSpine
    ? 0
    : (dev.uplinkStart ? dev.uplinkStart - 1 : Math.max(0, (dev.ports || 32) - (dev.uplinks || 0)))
  const exosFabricIfaces = exosLinks.map(l => {
    const port = exosPortBase + l.ifIndex + 1
    const vlanName = `P2P-${port}`
    return `create vlan ${vlanName}
configure vlan ${vlanName} add ports ${port} untagged
configure vlan ${vlanName} ipaddress ${l.localIp.replace('/31', ' 255.255.255.254')}
configure ports ${port} description-string "${isSpine ? 'DOWNLINK' : 'UPLINK'}: ${l.peerHostname}"
enable ipforwarding vlan ${vlanName}`
  }).join('\n')
  const exosLeafPeers = allDevices
    .filter(d => d.subLayer === 'leaf')
    .map((_d, i) => {
      const ip = roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)
      return `configure bgp add neighbor ${ip} remote-AS-number ${65000 + Math.floor(i / 2) + 1}
configure bgp neighbor ${ip} no-next-hop-self
enable bgp neighbor ${ip} capability evpn`
    }).join('\n')
  const exosLinkedSpines = new Set(exosLinks.map(l => l.peerHostname))
  const exosSpinePeers = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => exosLinkedSpines.size === 0 || exosLinkedSpines.has(x.d.hostname))
    .map(x => {
      const ip = roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)
      return `configure bgp add neighbor ${ip} remote-AS-number 65000
configure bgp neighbor ${ip} source-interface vlan Loopback0
enable bgp neighbor ${ip} capability evpn`
    }).join('\n')
  const exosFwLinks = (isSpine || isAccess) ? [] : fwHandoffPlan(dev, allDevices, 'border-leaf')
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : ${dev.subLayer}
# Model  : ${dev.model}
# OS     : Extreme Switch Engine (EXOS) 32.x
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

configure snmp sysName "${dev.hostname}"
configure snmp sysLocation "<CHANGE-ME-site-location>"
configure snmp sysContact "<CHANGE-ME-noc-email>"
#
# ── Management ────────────────────────────────────────────────────────────────
configure vlan Mgmt ipaddress <CHANGE-ME-mgmt-ip>/24
configure iproute add default <CHANGE-ME-mgmt-gw> vr VR-Mgmt
enable ssh2
disable telnet
#
# ── AAA ───────────────────────────────────────────────────────────────────────
create account admin admin encrypted "<CHANGE-ME-admin-password>"
configure radius mgmt-access primary server <CHANGE-ME-radius-ip> 1812 client-ip <CHANGE-ME-mgmt-ip> vr VR-Mgmt
configure radius mgmt-access primary shared-secret "<CHANGE-ME-radius-key>"
enable radius mgmt-access
#
# ── NTP / Syslog ──────────────────────────────────────────────────────────────
configure ntp server add <CHANGE-ME-ntp-primary> vr VR-Mgmt
configure ntp server add <CHANGE-ME-ntp-secondary> vr VR-Mgmt
enable ntp
configure syslog add <CHANGE-ME-syslog-ip>:514 vr VR-Mgmt local0
enable syslog
#
# ── SNMP v3 ───────────────────────────────────────────────────────────────────
configure snmpv3 add user netmon authentication sha <CHANGE-ME-snmp-auth-pass> privacy aes <CHANGE-ME-snmp-priv-pass>
configure snmpv3 add group NETDESIGN-RO user netmon sec-model usm
disable snmp access snmp-v1v2c
#
# ── LLDP ──────────────────────────────────────────────────────────────────────
enable lldp ports all
#
${isAccess ? `# ── Access VLANs + PoE ────────────────────────────────────────────────────────
create vlan Data tag 20
create vlan Voice tag 30
configure vlan Data add ports 1-${dev.ports} untagged
configure vlan Voice add ports 1-${dev.ports} tagged
enable inline-power
configure inline-power usage-threshold 85
enable stpd s0 ports 1-${dev.ports}
configure stpd s0 ports edge-safeguard enable 1-${dev.ports}` : `# ── Loopback (router-id / BGP source) ────────────────────────────────────────
create vlan Loopback0
enable loopback-mode vlan Loopback0
configure vlan Loopback0 ipaddress ${lo0ip} 255.255.255.255
#
# ── FABRIC LINKS (topology-driven from BOM port-math, Z8) ─────────────────────
${exosFabricIfaces || '# No fabric peers in this design'}
#
# ── BGP + EVPN / Fabric ───────────────────────────────────────────────────────
configure bgp AS-number ${asn}
configure bgp routerid ${lo0ip}
enable bgp
${isSpine
  ? `# Spine: one eBGP session per leaf, derived from the BOM. no-next-hop-self is
# mandatory — the spine is not a VTEP, so rewriting the EVPN next-hop to itself
# black-holes every overlay route.
${exosLeafPeers || '# No leaves in fabric'}`
  : `# Leaf: one eBGP session per LINKED spine
${exosSpinePeers || '# No spines in fabric'}`}
configure bgp neighbor all timer 3 9
configure bgp neighbor all bfd on
enable bgp neighbor all
#${exosFwLinks.length ? `
# ── FIREWALL HANDOFF (border leaf, routed /31 — FW side is the .1) ───────────
create vrf TENANT-A
${exosFwLinks.map(x => `create vlan FW-${x.port} vr TENANT-A
configure vlan FW-${x.port} add ports ${x.port} untagged
configure vlan FW-${x.port} ipaddress ${x.ip} 255.255.255.254
configure ports ${x.port} description-string "FW-HANDOFF: ${x.fw.hostname}"
enable ipforwarding vlan FW-${x.port}`).join('\n')}
${exosFwLinks.map(x => `configure iproute add default ${nextIp(x.ip)} vr TENANT-A`).join('\n')}
#` : ''}
# ── Jumbo MTU (VXLAN 50B overhead → underlay must be jumbo) ───────────────────
enable jumbo-frame ports all
configure jumbo-frame-size 9216
#
# VXLAN / EVPN
create virtual-network "VNI-10001" vxlan vni 10001
configure virtual-network "VNI-10001" add vlan Data`}
`
}

// ── Nokia SR Linux Config ───────────────────────────────────────────────────

function nokiaSrLinuxConfig(dev: BOMDevice, idx: number, isMultisite = false, protoFeatures: string[] = [], appTypes: AppType[] = [], allDevices: BOMDevice[] = []): string {
  idx = roleIndex(dev, allDevices, idx)
  const isSpine = dev.subLayer === 'spine'
  // Storage lossless (NVMe-oF/iSCSI) — PFC priority-6 no-drop, leaf only.
  const storageBlock = (!isSpine && appTypes.includes('storage')) ? `

    # ── Storage lossless QoS (NVMe-oF / iSCSI — PFC priority 6 no-drop) ─────
    qos {
        forwarding-classes {
            forwarding-class storage {
                forwarding-class-index 6
            }
        }
        interfaces {
            interface ethernet-1/1 {
                output {
                    pfc {
                        priority [ 6 ]
                    }
                }
            }
        }
    }` : ''
  const asn = isSpine ? 65000 : 65001 + idx
  const lo0ip = isSpine
    ? roleIp('10.255.1.1', RoleSlot.SpineLoopback, idx)
    : roleIp('10.255.2.1', RoleSlot.LeafLoopback, idx)
  const role = isSpine ? 'Spine (Route-Reflector)' : 'Leaf (ToR / VTEP)'
  const ipv6 = protoFeatures.includes('IPv6 Dual-Stack')
  // IPv6 dual-stack underlay: a system0 v6 loopback + IS-IS ipv6-unicast AF.
  const sys0v6 = ipv6 ? `
            ipv6 {
                address <CHANGE-ME-system0-v6>/128 { }
            }` : ''
  const isisV6 = ipv6 ? `
                ipv6-unicast {
                    admin-state enable
                }` : ''
  // Multisite DCI: stretch the mac-vrf across sites with the shared
  // ${DCI_RT_ASN}:<vni> route-target namespace (A7 parity with NX-OS/Arista).
  const dciRt = isMultisite
    ? `route-target {
                        export-rt target:${DCI_RT_ASN}:10010
                        import-rt target:${DCI_RT_ASN}:10010
                    }`
    : ''

  // Z8 — real eBGP peers derived from the BOM, the same treatment X1/X3/X4
  // gave Cisco/Arista/Juniper. The spine had NO neighbors at all (just an
  // empty peer-group with an iBGP `route-reflector client` on an eBGP
  // session), and the leaf peered two `<CHANGE-ME-spine*-lo0>` placeholders,
  // so a Nokia fabric never formed a single session.
  const nokiaLeafPeers = allDevices
    .filter(d => d.subLayer === 'leaf')
    .map((_d, i) => `                neighbor ${roleIp('10.255.2.1', RoleSlot.LeafLoopback, i)} {
                    peer-as ${65000 + Math.floor(i / 2) + 1}
                }`)
    .join('\n')
  const nokiaLinkedSpines = new Set(closFabricLinks('leaf', dev, allDevices).map(l => l.peerHostname))
  const nokiaSpinePeers = allDevices
    .filter(d => d.subLayer === 'spine')
    .map((d, i) => ({ d, i }))
    .filter(x => nokiaLinkedSpines.size === 0 || nokiaLinkedSpines.has(x.d.hostname))
    .map(x => `                neighbor ${roleIp('10.255.1.1', RoleSlot.SpineLoopback, x.i)} {
                    peer-as 65000
                }`)
    .join('\n')
  // Topology-driven fabric interfaces (Z8): the generator used to hardcode
  // ethernet-1/1 and 1/2 no matter how many links the BOM actually planned.
  const nokiaLinks = closFabricLinks(isSpine ? 'spine' : 'leaf', dev, allDevices)
  const nokiaPortBase = isSpine
    ? 0
    : (dev.uplinkStart ? dev.uplinkStart - 1 : Math.max(0, (dev.ports || 32) - (dev.uplinks || 0)))
  const nokiaFabricIfaces = nokiaLinks.map(l => `    interface ethernet-1/${nokiaPortBase + l.ifIndex + 1} {
        description "${isSpine ? 'DOWNLINK' : 'UPLINK'}: ${l.peerHostname}"
        admin-state enable
        mtu 9232
        subinterface 0 {
            ipv4 {
                address ${l.localIp} { }
            }
        }
    }`).join('\n') || `    interface ethernet-1/1 {
        admin-state enable
        mtu 9232
    }`
  const nokiaFabricNiIfaces = nokiaLinks
    .map(l => `        interface ethernet-1/${nokiaPortBase + l.ifIndex + 1}.0 { }`).join('\n')
  // Server-facing ports — the mac-vrf and its VNI had no member ports (Z1 class).
  const nokiaHostMax = isSpine ? 0 : leafHostPortMax(dev, allDevices)
  const nokiaHostIfaces = nokiaHostMax > 0 ? `    # ── SERVER / HOST PORTS (tenant VLAN 10) ────────────────────────────────
    interface ethernet-1/{1..${nokiaHostMax}} {
        description "SERVER-ACCESS"
        admin-state enable
        vlan-tagging false
        subinterface 0 {
            type bridged
        }
    }` : ''
  // Border-leaf firewall handoff (Z3b) — routed /31 inside the tenant ip-vrf.
  const nokiaFwLinks = isSpine ? [] : fwHandoffPlan(dev, allDevices, 'border-leaf')
  const nokiaFwIfaces = nokiaFwLinks.length ? `
    # ── FIREWALL HANDOFF (border leaf, routed /31 — FW side is the .1) ──────
${nokiaFwLinks.map(x => `    interface ethernet-1/${x.port} {
        description "FW-HANDOFF: ${x.fw.hostname}"
        admin-state enable
        subinterface 0 {
            ipv4 {
                address ${x.ip}/31 { }
            }
        }
    }`).join('\n')}

    network-instance TENANT-A {
        type ip-vrf
${nokiaFwLinks.map(x => `        interface ethernet-1/${x.port}.0 { }`).join('\n')}
        static-routes {
            route 0.0.0.0/0 {
                next-hop-group fw-perimeter
            }
        }
        next-hop-groups {
            group fw-perimeter {
${nokiaFwLinks.map((x, i) => `                nexthop ${i + 1} {
                    ip-address ${nextIp(x.ip)}
                }`).join('\n')}
            }
        }
    }` : ''

  const bgpNeighbors = isSpine
    ? `            group leaf-peers {
                family {
                    evpn true
                    ipv4-unicast true
                }
                multihop {
                    admin-state enable
                    maximum-hops 2
                }
                # eBGP spine is NOT a VTEP — preserve the originating next-hop
                # or every overlay route is tunnelled to the spine and dropped.
                route-advertisement {
                    next-hop-self false
                }
            }
${nokiaLeafPeers || '                # No leaves in fabric'}`
    : `            group spine-rr {
                peer-as 65000
                family {
                    evpn true
                    ipv4-unicast true
                }
                multihop {
                    admin-state enable
                    maximum-hops 2
                }
            }
${nokiaSpinePeers || '                # No spines in fabric'}`

  const evpnBlock = isSpine ? '' : `
    network-instance vxlan-default {
        type mac-vrf
${nokiaHostMax > 0 ? `        interface ethernet-1/{1..${nokiaHostMax}}.0 { }` : ''}
        protocols {
            bgp-evpn {
                bgp-instance 1 {
                    vxlan-interface vxlan1.1
                    evi 1
                }
            }
            bgp-vpn {
                bgp-instance 1 {
                    ${dciRt}
                }
            }
        }
        vxlan-interface vxlan1.1 {
            type bridged
            ingress {
                vni 10001
            }
        }
    }`

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : DC ${role}
# OS     : Nokia SR Linux
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

    system {
        hostname ${dev.hostname}
        dns {
            server-list [ <CHANGE-ME-dns-ip> ]
        }
        ntp {
            server <CHANGE-ME-ntp-primary> { }
            server <CHANGE-ME-ntp-secondary> { }
        }
        logging {
            remote-server <CHANGE-ME-syslog-ip> {
                transport udp
            }
        }
        aaa {
            authentication {
                user admin {
                    password "<CHANGE-ME-admin-password>"
                    role admin
                }
            }
        }
        ssh-server {
            network-instance mgmt
        }
        grpc-server mgmt {
            admin-state enable
            rate-limit 65000
            network-instance mgmt
        }
        gnmi-server {
            admin-state enable
            network-instance mgmt
        }
    }

    interface mgmt0 {
        admin-state enable
        subinterface 0 {
            ipv4 {
                address <CHANGE-ME-mgmt-ip>/24 { }
            }
        }
    }

    interface system0 {
        admin-state enable
        subinterface 0 {
            ipv4 {
                address ${lo0ip}/32 { }
            }${sys0v6}
        }
    }

    # ── FABRIC LINKS (topology-driven from BOM port-math, Z8) ───────────────
    # Jumbo MTU — VXLAN adds 50B, so the underlay must be jumbo.
${nokiaFabricIfaces}
${nokiaHostIfaces}${nokiaFwIfaces}

    network-instance mgmt {
        type ip-vrf
        interface mgmt0.0 { }
        protocols {
            linux {
                import-routes true
                export-routes true
            }
        }
        static-routes {
            route 0.0.0.0/0 {
                next-hop-group mgmt-gw
            }
        }
        next-hop-groups {
            group mgmt-gw {
                nexthop 1 {
                    ip-address <CHANGE-ME-oob-gateway>
                }
            }
        }
    }

    network-instance default {
        type default
        interface system0.0 { }
${nokiaFabricNiIfaces}
        protocols {
            isis {
                instance default {
                    admin-state enable
                    level-capability L2
                    net [ 49.0001.0${lo0ip.replace(/\./g, '')}.00 ]
                    interface system0.0 {
                        passive true
                    }${isisV6}
                }
            }
            bgp {
                autonomous-system ${asn}
                router-id ${lo0ip}
                failure-detection {
                    enable-bfd true
                    fast-failover true
                }
                afi-safi evpn {
                    admin-state enable
                }
                afi-safi ipv4-unicast {
                    admin-state enable
                    multipath {
                        max-paths-level-1 64
                    }
                }
${bgpNeighbors}
            }
        }
    }
${evpnBlock}${storageBlock}
`
}

// ── Juniper Campus Config (distribution / access) ────────────────────────────

function juniperCampusConfig(dev: BOMDevice, idx: number): string {
  const isDist = dev.subLayer === 'distribution'
  const role = isDist ? 'Campus Distribution' : 'Campus Access'
  const lo0ip = isDist ? `10.254.1.${idx + 1}` : `10.254.2.${idx + 1}`
  const vlanBlock = isDist
    ? `set vlans Data vlan-id 100
set vlans Voice vlan-id 200
set vlans IoT vlan-id 300
set vlans Guest vlan-id 400
set vlans Mgmt vlan-id 999
!
set interfaces irb unit 100 family inet address 10.100.${idx}.1/24
set interfaces irb unit 100 description "Data VLAN"
set interfaces irb unit 200 family inet address 10.200.${idx}.1/24
set interfaces irb unit 200 description "Voice VLAN"
set interfaces irb unit 999 family inet address 10.254.${idx}.1/24
set interfaces irb unit 999 description "Management VLAN"`
    : `set vlans Data vlan-id 100
set vlans Voice vlan-id 200
set vlans IoT vlan-id 300
set vlans Guest vlan-id 400
!
set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members Data
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members Voice`

  const routingBlock = isDist
    ? `# ── OSPF UNDERLAY ────────────────────────────────────────────────────────
set protocols ospf area 0.0.0.0 interface lo0.0 passive
set protocols ospf area 0.0.0.0 interface irb.100
set protocols ospf area 0.0.0.0 interface irb.200
set protocols ospf area 0.0.0.0 interface et-0/0/48.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface et-0/0/49.0 interface-type p2p
!
# ── FHRP (VRRP) ─────────────────────────────────────────────────────────
set interfaces irb unit 100 family inet address 10.100.${idx}.1/24 vrrp-group 100 virtual-address 10.100.0.1 priority ${idx % 2 === 0 ? 110 : 100}
set interfaces irb unit 200 family inet address 10.200.${idx}.1/24 vrrp-group 200 virtual-address 10.200.0.1 priority ${idx % 2 === 0 ? 110 : 100}`
    : `# ── ACCESS LAYER (no routing, trunk to distribution) ────────────────────
set interfaces ge-0/0/46 unit 0 family ethernet-switching port-mode trunk
set interfaces ge-0/0/46 unit 0 family ethernet-switching vlan members [ Data Voice IoT Guest ]
set interfaces ge-0/0/47 unit 0 family ethernet-switching port-mode trunk
set interfaces ge-0/0/47 unit 0 family ethernet-switching vlan members [ Data Voice IoT Guest ]`

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : ${role}
# OS     : Juniper Junos (EX series)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

set system host-name ${dev.hostname}
set system domain-name <CHANGE-ME-domain.example.com>
set system name-server <CHANGE-ME-dns-ip>
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services netconf ssh
!
set system authentication-order [ tacplus password ]
set access tacacs-server <CHANGE-ME-tacacs-primary-ip> secret "<CHANGE-ME-tacacs-key>"
set access profile TACACS-PROFILE authentication-order tacplus
!
set system syslog host <CHANGE-ME-syslog-ip> any info
set system ntp server <CHANGE-ME-ntp-primary> prefer
set system ntp server <CHANGE-ME-ntp-secondary>
!
# ── MANAGEMENT ──────────────────────────────────────────────────────────
set interfaces fxp0 unit 0 description "OOB-MANAGEMENT"
set interfaces fxp0 unit 0 family inet address <CHANGE-ME-mgmt-ip>/24
# Z5b/J3-4: the OOB default used to sit in inet.0 — a DATA-PLANE default route
# pointed out the management port, so any unresolved production traffic was
# sent to the OOB network. The management-instance knob puts fxp0 and its
# default route in the dedicated mgmt_junos routing instance instead.
set system management-instance
set routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop <CHANGE-ME-oob-gateway>
!
# ── LOOPBACK ────────────────────────────────────────────────────────────
set interfaces lo0 unit 0 description "ROUTER-ID"
set interfaces lo0 unit 0 family inet address ${lo0ip}/32
!
# ── VLANs ────────────────────────────────────────────────────────────────
${vlanBlock}
!
${routingBlock}
!
# ── SPANNING TREE ────────────────────────────────────────────────────────
set protocols rstp bridge-priority ${isDist ? '4096' : '32768'}
set protocols rstp interface all
!
# ── STORM CONTROL ────────────────────────────────────────────────────────
set forwarding-options storm-control-profiles default all bandwidth-percentage 80
!
# ── LLDP ─────────────────────────────────────────────────────────────────
set protocols lldp interface all
`
}

// ── Juniper SRX Firewall Config ──────────────────────────────────────────────

/**
 * Node-1 FPC slot for an SRX chassis cluster (Z5b/J3-8). Junos renumbers
 * node 1 by adding the platform's TOTAL FPC count to each original FPC
 * number, so the offset is model-specific — the generator previously
 * hardcoded 7 for every SRX, which is wrong on any platform that isn't a
 * 7-FPC box. Models we cannot state with confidence get a <CHANGE-ME-*>
 * placeholder rather than a plausible-but-wrong slot number; see Juniper's
 * "Chassis Cluster Slot Numbering and Logical Interface Naming".
 */
const SRX_NODE1_FPC: Array<[RegExp, number]> = [
  [/SRX\s?3(00|20)\b/i, 3],
  [/SRX\s?3(40|45)\b/i, 5],
  [/SRX\s?550\b/i,      9],
  [/SRX\s?1500\b/i,     7],
]

function srxNode1Fpc(model: string): string {
  for (const [re, fpc] of SRX_NODE1_FPC) if (re.test(model)) return String(fpc)
  return '<CHANGE-ME-node1-fpc>'
}

function juniperSrxConfig(dev: BOMDevice, _idx: number): string {
  const n1 = srxNode1Fpc(dev.model)
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : Firewall (NGFW)
# OS     : Juniper Junos (SRX)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

set system host-name ${dev.hostname}
set system domain-name <CHANGE-ME-domain.example.com>
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services web-management https system-generated-certificate
!
set system syslog host <CHANGE-ME-syslog-ip> any info
set system ntp server <CHANGE-ME-ntp-primary> prefer
!
# ── DATA-PLANE INTERFACES (cluster reths — J-M3: zones must bind reth units,
# and SRX4600 ports are xe-/et-, not ge-) ─────────────────────────────────
set interfaces xe-0/0/0 gigether-options redundant-parent reth0
set interfaces xe-${n1}/0/0 gigether-options redundant-parent reth0
set interfaces xe-0/0/1 gigether-options redundant-parent reth1
set interfaces xe-${n1}/0/1 gigether-options redundant-parent reth1
set interfaces xe-0/0/3 gigether-options redundant-parent reth2
set interfaces xe-${n1}/0/3 gigether-options redundant-parent reth2
set interfaces reth0 redundant-ether-options redundancy-group 1
set interfaces reth0 unit 0 description "UNTRUST-INTERNET"
set interfaces reth0 unit 0 family inet address <CHANGE-ME-untrust-ip>/30
set interfaces reth1 redundant-ether-options redundancy-group 1
set interfaces reth1 unit 0 description "TRUST-LAN"
set interfaces reth1 unit 0 family inet address <CHANGE-ME-trust-ip>/24
set interfaces reth2 redundant-ether-options redundancy-group 1
set interfaces reth2 unit 0 description "DMZ-SERVERS"
set interfaces reth2 unit 0 family inet address <CHANGE-ME-dmz-ip>/24
!
# ── SECURITY ZONES ───────────────────────────────────────────────────────
set security zones security-zone TRUST host-inbound-traffic system-services [ ping ssh dhcp ntp ]
set security zones security-zone TRUST host-inbound-traffic protocols [ bgp ]
set security zones security-zone TRUST interfaces reth1.0
set security zones security-zone UNTRUST host-inbound-traffic system-services [ ping ike ]
set security zones security-zone UNTRUST interfaces reth0.0
set security zones security-zone DMZ host-inbound-traffic system-services [ ping ]
set security zones security-zone DMZ interfaces reth2.0
!
# ── SECURITY POLICIES ───────────────────────────────────────────────────
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUTBOUND match source-address any destination-address any application any
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUTBOUND then permit
set security policies from-zone UNTRUST to-zone TRUST policy DENY-INBOUND match source-address any destination-address any application any
set security policies from-zone UNTRUST to-zone TRUST policy DENY-INBOUND then deny
set security policies from-zone TRUST to-zone DMZ policy ALLOW-DMZ match source-address any destination-address any application [ junos-http junos-https ]
set security policies from-zone TRUST to-zone DMZ policy ALLOW-DMZ then permit
!
# ── IPS ──────────────────────────────────────────────────────────────────
set security idp idp-policy RECOMMENDED rulebase-ips rule 1 match from-zone any to-zone any source-address any destination-address any application default
set security idp idp-policy RECOMMENDED rulebase-ips rule 1 then action recommended
set security idp active-policy RECOMMENDED
!
# ── NAT ──────────────────────────────────────────────────────────────────
set security nat source rule-set TRUST-TO-UNTRUST from zone TRUST
set security nat source rule-set TRUST-TO-UNTRUST to zone UNTRUST
set security nat source rule-set TRUST-TO-UNTRUST rule SNAT match source-address 0.0.0.0/0
set security nat source rule-set TRUST-TO-UNTRUST rule SNAT then source-nat interface
!
# ── HA CLUSTER (fab links carry the data-plane sync — J-M3) ───────────────
set chassis cluster reth-count 4
set chassis cluster redundancy-group 0 node 0 priority 200
set chassis cluster redundancy-group 0 node 1 priority 100
set chassis cluster redundancy-group 1 node 0 priority 200
set chassis cluster redundancy-group 1 node 1 priority 100
set interfaces fab0 fabric-options member-interfaces xe-0/0/2
set interfaces fab1 fabric-options member-interfaces xe-${n1}/0/2
`.replace(/^!$/gm, '#')
}

// ── Juniper MX WAN Edge Config ───────────────────────────────────────────────

function juniperWanConfig(dev: BOMDevice, idx: number): string {
  const lo0ip = `10.253.1.${idx + 1}`
  const asn = 65100 + idx

  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : WAN Edge Router
# OS     : Juniper Junos (MX)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

set system host-name ${dev.hostname}
set system domain-name <CHANGE-ME-domain.example.com>
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services netconf ssh
!
set system syslog host <CHANGE-ME-syslog-ip> any info
set system ntp server <CHANGE-ME-ntp-primary> prefer
set system ntp server <CHANGE-ME-ntp-secondary>
!
# ── MANAGEMENT ──────────────────────────────────────────────────────────
set interfaces fxp0 unit 0 description "OOB-MANAGEMENT"
set interfaces fxp0 unit 0 family inet address <CHANGE-ME-mgmt-ip>/24
# Z5b/J3-4: the OOB default used to sit in inet.0 — a DATA-PLANE default route
# pointed out the management port, so any unresolved production traffic was
# sent to the OOB network. The management-instance knob puts fxp0 and its
# default route in the dedicated mgmt_junos routing instance instead.
set system management-instance
set routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop <CHANGE-ME-oob-gateway>
!
# ── LOOPBACK ────────────────────────────────────────────────────────────
set interfaces lo0 unit 0 family inet address ${lo0ip}/32
!
# ── WAN INTERFACES ──────────────────────────────────────────────────────
set interfaces et-0/0/0 description "WAN-UPLINK-PRIMARY"
set interfaces et-0/0/0 unit 0 family inet address <CHANGE-ME-wan-primary-ip>/30
set interfaces et-0/0/0 unit 0 family mpls
set interfaces et-0/0/1 description "WAN-UPLINK-SECONDARY"
set interfaces et-0/0/1 unit 0 family inet address <CHANGE-ME-wan-secondary-ip>/30
set interfaces et-0/0/1 unit 0 family mpls
!
# ── OSPF UNDERLAY ────────────────────────────────────────────────────────
set protocols ospf area 0.0.0.0 interface lo0.0 passive
set protocols ospf area 0.0.0.0 interface et-0/0/0.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface et-0/0/1.0 interface-type p2p
!
# ── BGP ──────────────────────────────────────────────────────────────────
set protocols bgp group WAN-PEERS type external
set protocols bgp group WAN-PEERS local-as ${asn}
set protocols bgp group WAN-PEERS neighbor <CHANGE-ME-peer-ip-1> peer-as <CHANGE-ME-peer-asn>
set protocols bgp group WAN-PEERS neighbor <CHANGE-ME-peer-ip-2> peer-as <CHANGE-ME-peer-asn>
set protocols bgp group WAN-PEERS family inet unicast
set protocols bgp group WAN-PEERS multipath
set protocols bgp group WAN-PEERS bfd-liveness-detection minimum-interval 300
!
# ── MPLS / LDP ───────────────────────────────────────────────────────────
set protocols mpls interface et-0/0/0.0
set protocols mpls interface et-0/0/1.0
set protocols ldp interface et-0/0/0.0
set protocols ldp interface et-0/0/1.0
!
# ── LLDP ─────────────────────────────────────────────────────────────────
set protocols lldp interface all
`
}

// ── Arista Campus Config (distribution / access) ─────────────────────────────

function aristaCampusConfig(dev: BOMDevice, idx: number): string {
  const isDist = dev.subLayer === 'distribution'
  const role = isDist ? 'Campus Distribution' : 'Campus Access'
  const lo0ip = isDist ? `10.254.1.${idx + 1}` : `10.254.2.${idx + 1}`

  const vlanBlock = `vlan 100
   name Data
vlan 200
   name Voice
vlan 300
   name IoT
vlan 400
   name Guest
vlan 999
   name Management`

  const routingBlock = isDist
    ? `!
interface Vlan100
   description Data
   ip address 10.100.${idx}.1/24
   ip virtual-router address 10.100.0.1
!
interface Vlan200
   description Voice
   ip address 10.200.${idx}.1/24
   ip virtual-router address 10.200.0.1
!
ip virtual-router mac-address 00:1c:73:00:00:01
!
ip routing
!
router ospf 1
   router-id ${lo0ip}
   network ${lo0ip}/32 area 0.0.0.0
   network 10.100.${idx}.0/24 area 0.0.0.0
   network 10.200.${idx}.0/24 area 0.0.0.0
   max-lsa 12000`
    : `!
interface Ethernet1
   switchport access vlan 100
   spanning-tree portfast
!
interface Ethernet2
   switchport access vlan 200
   spanning-tree portfast
!
interface Ethernet47
   description "UPLINK-TO-DIST"
   switchport mode trunk
   switchport trunk allowed vlan 100,200,300,400,999
!
interface Ethernet48
   description "UPLINK-TO-DIST"
   switchport mode trunk
   switchport trunk allowed vlan 100,200,300,400,999`

  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : ${role}
! OS     : Arista EOS
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
${mgmtBlock(dev.hostname, 10)}
!
${vlanBlock}
!
interface Loopback0
   description ROUTER-ID
   ip address ${lo0ip}/32
!
spanning-tree mode rapid-pvst
spanning-tree priority ${isDist ? '4096' : '32768'}
!
${routingBlock}
!
lldp run
`
}

// ── Generic fallback ─────────────────────────────────────────────────────────

function genericConfig(dev: BOMDevice): string {
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : ${dev.subLayer}
! Model  : ${dev.model} (${dev.vendor})
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

${mgmtBlock(dev.hostname, 10)}
!
! ── TODO: Add ${dev.vendor} ${dev.subLayer}-specific configuration ────────────
! This template provides management plane hardening.
! Add data-plane config (routing, switching, VLANs) for your deployment.
`
}

// ── Cisco Catalyst SD-WAN cEdge / vEdge Config (G-A12) ───────────────────────

function isSdWanEdge(dev: BOMDevice): boolean {
  return dev.subLayer === 'wan-edge' && (dev.features || []).includes('SD-WAN')
    && !(dev.features || []).includes('IOS-XR')
}
/**
 * Viptela OS (vEdge hardware) and IOS-XE SD-WAN (cEdge) are different
 * operating systems with different CLIs. `sdwanEdgeConfig` emitted Viptela's
 * — top-level `vpn 0`, `system-ip`, a bare `omp` container — under a header
 * that claimed IOS-XE. Two of the three SD-WAN SKUs in the catalogue are
 * cEdges (the ASR 1002-HX, which is the DEFAULT WAN edge, and the Catalyst
 * 8300, which is the AA2 cloud on-ramp), and on those boxes none of that
 * syntax exists. Cisco has end-of-sale'd the vEdge line in favour of cEdge,
 * so IOS-XE is the default and Viptela OS is opt-in by model.
 */
export function isViptelaOs(dev: BOMDevice): boolean {
  return /vedge/i.test(dev.model || '')
}

interface SdWanCtx {
  dev: BOMDevice
  siteId: number
  sysIp: string
  wanIp: string
  wanGw: string
  lanIp: string
  guestIp: string
}

function sdwanEdgeConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  // Identity is tier-scoped and SITE-scoped (Z5). The site-id used to come
  // from the GLOBAL device index, so a 2-site multicloud design whose BOM
  // also holds four cloud appliances produced site-ids 104-107: four SD-WAN
  // sites for two real ones, and the pair at each site did not agree. Both
  // routers at a site now share the site-id — which is how SD-WAN models a
  // dual-router site — and differ by system-ip.
  const tierIdx = roleIndex(dev, allDevices, idx)
  const siteOrd = Math.floor(tierIdx / 2)
  const member = tierIdx % 2
  // Addresses go through ipAdd so a large site count walks into the next
  // octet instead of emitting 10.10.300.1 (the Z7 overflow class).
  const ctx: SdWanCtx = {
    dev,
    siteId: 101 + siteOrd,
    sysIp: ipAdd('10.10.101.0', siteOrd * 256 + member + 1),
    wanIp: ipAdd('203.0.113.0', tierIdx * 4 + 1),
    wanGw: ipAdd('203.0.113.0', tierIdx * 4 + 2),
    // A /24 per site inside 10.101.0.0/16, guest in the upper half — the old
    // stride was a whole /16 PER SITE, so an 8-site design reached 10.108.x
    // and straight through the reserved overflow supernet (AF3).
    lanIp: ipAdd('10.101.0.0', siteOrd * 256 + member + 1),
    guestIp: ipAdd('10.101.128.0', siteOrd * 256 + member + 1),
  }
  return isViptelaOs(dev) ? sdwanVedgeConfig(ctx) : sdwanCedgeConfig(ctx)
}

/** Cisco IOS-XE SD-WAN (cEdge) — ASR 1000, Catalyst 8000, ISR 1000/4000. */
function sdwanCedgeConfig(c: SdWanCtx): string {
  const { dev, siteId, sysIp, wanIp, wanGw, lanIp, guestIp } = c
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : SD-WAN Edge (cEdge)
! OS     : Cisco IOS-XE SD-WAN
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════
! IOS-XE SD-WAN, not Viptela OS: interfaces, VRFs, ZBF and QoS are standard
! IOS-XE; only the controller bring-up and the overlay live under 'sdwan'.

! ── SYSTEM / CONTROLLER BRING-UP ────────────────────────────────────────────
hostname ${dev.hostname}
system
 system-ip            ${sysIp}
 site-id              ${siteId}
 organization-name    <CHANGE-ME-org-name>
 vbond <CHANGE-ME-vbond-ip> port 12346
!
clock timezone <CHANGE-ME-timezone> 0 0
service timestamps debug datetime msec localtime show-timezone
service timestamps log   datetime msec localtime show-timezone
service password-encryption
no ip domain lookup
ip domain name <CHANGE-ME-domain>
!
! ── VRFs (IOS-XE names them; VPN numbers are the Viptela OS spelling) ───────
vrf definition Mgmt-intf
 description OUT-OF-BAND-MANAGEMENT
 address-family ipv4
 exit-address-family
!
vrf definition 1
 description CORPORATE-LAN
 rd 1:${siteId}
 address-family ipv4
  route-target export 1:1
  route-target import 1:1
 exit-address-family
!
vrf definition 2
 description GUEST-IOT
 rd 2:${siteId}
 address-family ipv4
 exit-address-family
!
! ── TRANSPORT (global table = VPN 0) ────────────────────────────────────────
interface GigabitEthernet0/0/0
 description INET-TRANSPORT
 ip address ${wanIp} 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/0/1
 description MPLS-TRANSPORT
 ip address <CHANGE-ME-mpls-ip> 255.255.255.252
 no shutdown
!
interface Tunnel1
 description SDWAN-INET
 ip unnumbered GigabitEthernet0/0/0
 tunnel source GigabitEthernet0/0/0
 tunnel mode sdwan
 no shutdown
!
interface Tunnel2
 description SDWAN-MPLS
 ip unnumbered GigabitEthernet0/0/1
 tunnel source GigabitEthernet0/0/1
 tunnel mode sdwan
 no shutdown
!
ip route 0.0.0.0 0.0.0.0 ${wanGw}
!
! ── MANAGEMENT (VPN 512) ────────────────────────────────────────────────────
interface GigabitEthernet0
 description MGMT-OUT-OF-BAND
 vrf forwarding Mgmt-intf
 ip address <CHANGE-ME-mgmt-ip> 255.255.255.0
 no shutdown
!
ip route vrf Mgmt-intf 0.0.0.0 0.0.0.0 <CHANGE-ME-mgmt-gw>
!
! ── SERVICE-SIDE ────────────────────────────────────────────────────────────
interface GigabitEthernet0/0/2
 description LAN-INTERFACE
 vrf forwarding 1
 ip address ${lanIp} 255.255.255.0
 no shutdown
!
interface GigabitEthernet0/0/3
 description GUEST-SEGMENT
 vrf forwarding 2
 ip address ${guestIp} 255.255.255.0
 no shutdown
!
! ── SD-WAN OVERLAY ──────────────────────────────────────────────────────────
sdwan
 interface GigabitEthernet0/0/0
  tunnel-interface
   encapsulation ipsec weight 1
   color biz-internet
   allow-service all
   no allow-service netconf
  exit
 exit
 interface GigabitEthernet0/0/1
  tunnel-interface
   encapsulation ipsec weight 1
   color mpls restrict
   allow-service all
  exit
 exit
 omp
  no shutdown
  graceful-restart
  address-family ipv4
   advertise connected
   advertise static
  exit
 exit
 appqoe
  no dreopt enable
 exit
!
! ── AAA ─────────────────────────────────────────────────────────────────────
aaa new-model
aaa authentication login default local
aaa authorization exec default local
username admin privilege 15 secret <CHANGE-ME-admin-password>
!
ip ssh version 2
line vty 0 4
 transport input ssh
 exec-timeout 10 0
!
! ── ZONE-BASED FIREWALL (IOS-XE ZBF — not the Viptela policy container) ─────
class-map type inspect match-any CM-LAN-TO-WAN
 match protocol tcp
 match protocol udp
 match protocol icmp
!
policy-map type inspect PM-LAN-TO-WAN
 class type inspect CM-LAN-TO-WAN
  inspect
 class class-default
  drop log
!
zone security LAN
zone security WAN
zone security GUEST
!
zone-pair security ZP-LAN-WAN source LAN destination WAN
 service-policy type inspect PM-LAN-TO-WAN
!
zone-pair security ZP-GUEST-WAN source GUEST destination WAN
 service-policy type inspect PM-LAN-TO-WAN
!
interface GigabitEthernet0/0/2
 zone-member security LAN
!
interface GigabitEthernet0/0/3
 zone-member security GUEST
!
interface Tunnel1
 zone-member security WAN
!
! ── APPLICATION-AWARE ROUTING + SLA ─────────────────────────────────────────
policy
 sla-class VOICE-SLA
  latency 150
  loss    1
  jitter  30
 !
 sla-class DATA-SLA
  latency 250
  loss    5
  jitter  100
 !
 app-route-policy BUSINESS-CRITICAL
  vpn-list VPN-1-LIST
  sequence 10
   match
    app-list VOICE-VIDEO
   !
   action
    sla-class VOICE-SLA preferred-color mpls
   !
  !
  sequence 20
   match
    app-list SAAS-APPS
   !
   action
    sla-class DATA-SLA preferred-color biz-internet
   !
  !
 !
 lists
  vpn-list VPN-1-LIST
   vpn 1
  !
 !
!
! ── QoS (standard IOS-XE MQC) ───────────────────────────────────────────────
class-map match-any CM-VOICE
 match dscp ef
class-map match-any CM-VIDEO
 match dscp af41
class-map match-any CM-CRITICAL
 match dscp af31
!
policy-map PM-WAN-EDGE
 class CM-VOICE
  priority level 1
  police rate percent 20
 class CM-VIDEO
  bandwidth remaining percent 25
 class CM-CRITICAL
  bandwidth remaining percent 25
 class class-default
  bandwidth remaining percent 30
  random-detect
!
interface GigabitEthernet0/0/0
 service-policy output PM-WAN-EDGE
!
! ── MANAGEMENT SERVICES ─────────────────────────────────────────────────────
ntp server vrf Mgmt-intf <CHANGE-ME-ntp-primary> prefer
ntp server vrf Mgmt-intf <CHANGE-ME-ntp-secondary>
!
logging host <CHANGE-ME-syslog-ip> vrf Mgmt-intf
logging trap informational
logging source-interface GigabitEthernet0
!
snmp-server group NETDESIGN-RO v3 priv read NETDESIGN-VIEW
snmp-server view NETDESIGN-VIEW 1.3.6.1 included
snmp-server user netmon NETDESIGN-RO v3 auth sha <CHANGE-ME-snmp-auth-pass> priv aes 128 <CHANGE-ME-snmp-priv-pass>
snmp-server host <CHANGE-ME-nms-ip> vrf Mgmt-intf version 3 priv netmon
snmp-server location <CHANGE-ME-site-location>
snmp-server contact <CHANGE-ME-noc-email>
!
`
}

/** Viptela OS — vEdge hardware and the vEdge Cloud virtual appliance. */
function sdwanVedgeConfig(c: SdWanCtx): string {
  const { dev, siteId, sysIp, wanIp, wanGw, lanIp, guestIp } = c
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : SD-WAN Edge (vEdge)
! OS     : Viptela OS
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

! ── SYSTEM SETTINGS ──────────────────────────────────────────────────────────
system
  system-ip             ${sysIp}
  site-id               ${siteId}
  organization-name     <CHANGE-ME-org-name>
  sp-organization-name  <CHANGE-ME-sp-org-name>
  vbond <CHANGE-ME-vbond-ip>
  clock timezone <CHANGE-ME-timezone>
  host-name ${dev.hostname}
  ! NTP and syslog belong under 'system' on Viptela OS. They used to ALSO be
  ! emitted as top-level blocks at the end of the file, with different
  ! placeholders — two conflicting time sources in one config.
  ntp
    server <CHANGE-ME-ntp-primary>
      version 4
      prefer
    !
    server <CHANGE-ME-ntp-secondary>
      version 4
    !
  !
  logging
    disk
      enable
    !
    server <CHANGE-ME-syslog-ip>
      vpn 512
      priority information
    !
  !
  aaa
    auth-order local radius
    usergroup basic
      task system read write
      task interface read write
    !
    user admin
      password <CHANGE-ME-admin-password>
    !
  !
!
snmp
  contact <CHANGE-ME-noc-email>
  location <CHANGE-ME-site-location>
  view NETDESIGN-VIEW oid 1.3.6.1
  !
  group NETDESIGN-RO auth-priv view NETDESIGN-VIEW
  !
  user netmon
    auth sha auth-password <CHANGE-ME-snmp-auth-pass>
    priv aes-cfb-128 priv-password <CHANGE-ME-snmp-priv-pass>
    group NETDESIGN-RO
  !
  trap target vpn 512 <CHANGE-ME-nms-ip> 162
    group-name NETDESIGN-RO
    community-name netmon
  !
!
! ── VPN 0 — TRANSPORT (WAN underlay) ────────────────────────────────────────
vpn 0
  interface ge0/0
    description INET-TRANSPORT
    ip address ${wanIp}/30
    tunnel-interface
      encapsulation ipsec weight 1
      color biz-internet
      allow-service all
      no allow-service netconf
    !
    no shutdown
  !
  interface ge0/1
    description MPLS-TRANSPORT
    ip address <CHANGE-ME-mpls-ip>/30
    tunnel-interface
      encapsulation ipsec weight 1
      color mpls
      restrict
      allow-service all
    !
    no shutdown
  !
  ip route 0.0.0.0/0 ${wanGw}
!
! ── VPN 512 — MANAGEMENT ────────────────────────────────────────────────────
vpn 512
  interface mgmt0
    description MGMT-OUT-OF-BAND
    ip address <CHANGE-ME-mgmt-ip>/24
    no shutdown
  !
  ip route 0.0.0.0/0 <CHANGE-ME-mgmt-gw>
!
! ── VPN 1 — SERVICE (LAN-side) ──────────────────────────────────────────────
vpn 1
  name CORPORATE-LAN
  interface ge0/2
    description LAN-INTERFACE
    ip address ${lanIp}/24
    no shutdown
  !
  ip route 0.0.0.0/0 vpn 0
  dns <CHANGE-ME-dns-primary> primary
  dns <CHANGE-ME-dns-secondary> secondary
!
! ── VPN 2 — GUEST / IOT ─────────────────────────────────────────────────────
vpn 2
  name GUEST-IOT
  interface ge0/3
    description GUEST-SEGMENT
    ip address ${guestIp}/24
    no shutdown
  !
  ip route 0.0.0.0/0 vpn 0
!
! ── OMP (Overlay Management Protocol) ───────────────────────────────────────
omp
  no shutdown
  graceful-restart
  advertise connected
  advertise static
  ! No 'advertise ospf external': nothing here runs OSPF, and advertising a
  ! protocol the device does not run is a dangling reference.
!
! ── POLICY ──────────────────────────────────────────────────────────────────
! One container. The zone firewall, the app-route policy, the SLA classes and
! the QoS map used to each re-open a top-level 'policy' block, and the zone
! definitions were written in IOS-XE syntax (zone security / zone-pair),
! which Viptela OS does not accept.
policy
  lists
    vpn-list VPN-1-LIST
      vpn 1
    !
    zone LAN-ZONE
      vpn 1
    !
    zone WAN-ZONE
      vpn 0
    !
  !
  zone-based-policy EDGE-FW
    sequence 10
      match
        source-data-prefix-list INTERNAL-NETS
      !
      action inspect
    !
    sequence 20
      match
        protocol 17
        destination-port 53
      !
      action inspect
    !
    default-action drop
  !
  zone-pair ZP-LAN-WAN
    source-zone LAN-ZONE
    destination-zone WAN-ZONE
    zone-policy EDGE-FW
  !
  sla-class VOICE-SLA
    latency 150
    loss 1
    jitter 30
  !
  sla-class DATA-SLA
    latency 250
    loss 5
    jitter 100
  !
  app-route-policy BUSINESS-CRITICAL
    vpn-list VPN-1-LIST
    sequence 10
      match
        app-list VOICE-VIDEO
      !
      action
        sla-class VOICE-SLA preferred-color mpls
      !
    !
    sequence 20
      match
        app-list SAAS-APPS
      !
      action
        sla-class DATA-SLA preferred-color biz-internet
      !
    !
    sequence 30
      action
        sla-class BEST-EFFORT
      !
    !
  !
  qos-map QOS-POLICY
    queue 0
      class VOICE
      bandwidth-percent 20
      scheduling llq
    !
    queue 1
      class INTERACTIVE-VIDEO
      bandwidth-percent 25
      scheduling wrr
    !
    queue 2
      class CRITICAL-DATA
      bandwidth-percent 25
      scheduling wrr
    !
    queue 3
      class BEST-EFFORT
      bandwidth-percent 30
      scheduling wrr
    !
  !
!
`
}

function sdwanControllerConfig(dev: BOMDevice, idx: number): string {
  const model = dev.model || ''
  const isVsmart = model.toLowerCase().includes('vsmart')
  const isVbond = model.toLowerCase().includes('vbond')

  const sysIp = isVsmart
    ? `10.255.0.${idx + 1}`
    : isVbond
      ? `10.255.0.${idx + 10}`
      : `10.255.0.${idx + 20}`

  const role = isVsmart ? 'vSmart Controller' : isVbond ? 'vBond Orchestrator' : 'vManage NMS'

  let body = `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : SD-WAN ${role}
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

! ── SYSTEM ───────────────────────────────────────────────────────────────────
system
  host-name             ${dev.hostname}
  system-ip             ${sysIp}
  site-id               1000
  organization-name     <CHANGE-ME-org-name>
  sp-organization-name  <CHANGE-ME-sp-org-name>
  vbond <CHANGE-ME-vbond-ip>${isVbond ? ' local' : ''}
  clock timezone <CHANGE-ME-timezone>
  logging
    disk
      enable
  !
!
`

  if (isVbond) {
    body += `! ── VPN 0 — TRANSPORT ────────────────────────────────────────────────────────
vpn 0
  interface ge0/0
    description WAN-FACING-ORCHESTRATION
    ip address <CHANGE-ME-vbond-wan-ip>/24
    tunnel-interface
      encapsulation ipsec
      allow-service all
    !
    no shutdown
  !
  ip route 0.0.0.0/0 <CHANGE-ME-vbond-gw>
!
`
  } else if (isVsmart) {
    body += `! ── VPN 0 — TRANSPORT ────────────────────────────────────────────────────────
vpn 0
  interface eth0
    description CONTROL-PLANE
    ip address <CHANGE-ME-vsmart-ip>/24
    tunnel-interface
      allow-service all
    !
    no shutdown
  !
  ip route 0.0.0.0/0 <CHANGE-ME-vsmart-gw>
!
! ── OMP (vSmart route reflector) ────────────────────────────────────────────
omp
  no shutdown
  graceful-restart
  send-path-limit  4
  ecmp-limit       4
  send-backup-paths
  advertise connected
  advertise static
!
`
  } else {
    body += `! ── VPN 0 — TRANSPORT ────────────────────────────────────────────────────────
vpn 0
  interface eth0
    description CONTROL-PLANE
    ip address <CHANGE-ME-vmanage-ip>/24
    tunnel-interface
      allow-service all
    !
    no shutdown
  !
  ip route 0.0.0.0/0 <CHANGE-ME-vmanage-gw>
!
! ── VPN 512 — MANAGEMENT ────────────────────────────────────────────────────
vpn 512
  interface eth1
    description OOB-MANAGEMENT
    ip address <CHANGE-ME-vmanage-mgmt-ip>/24
    no shutdown
  !
  ip route 0.0.0.0/0 <CHANGE-ME-vmanage-mgmt-gw>
!
`
  }

  body += `! ── AAA ──────────────────────────────────────────────────────────────────────
aaa
  auth-order local radius
  usergroup basic
    task system read write
    task interface read write
  !
!
user admin
  password <CHANGE-ME-admin-password>
!
! ── NTP / LOGGING ───────────────────────────────────────────────────────────
ntp
  server <CHANGE-ME-ntp-server> vpn 0
!
logging
  server <CHANGE-ME-syslog-server> vpn 0
!
`
  return body
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Detect Cisco SP/WAN routers that run IOS-XR (vs IOS-XE). IOS-XR platforms are
 * the ASR 9000 family, NCS (Network Convergence System), CRS, and XRv/IOS-XRv —
 * matched via model string or an explicit "IOS-XR" feature flag. ASR 1000-series
 * (e.g. ASR 1002-HX) and Catalyst SD-WAN vEdge run IOS-XE, so they fall through
 * to iosxeWanConfig().
 */
function isIosXrPlatform(dev: BOMDevice): boolean {
  const model = (dev.model || '').toUpperCase()
  const features = (dev.features || []).map(f => f.toUpperCase())
  if (features.includes('IOS-XR') || features.includes('IOSXR')) return true
  // ASR 1xxx is IOS-XE; ASR 9xxx is IOS-XR.
  if (/\bASR\s*9\d{3}\b/.test(model)) return true
  if (/\bNCS\b|\bNCS\d/.test(model)) return true
  if (/\bCRS\b/.test(model)) return true
  if (/IOS-?XRV?\b/.test(model)) return true
  return false
}

// ── O-RAN / Private 5G config generators (G-A10) ─────────────────────────────

/**
 * O-RAN fronthaul is a SHARED broadcast domain, so its VLAN is a property of
 * the fabric, not of any one switch. `oranFronthaulConfig` used to derive it
 * from the GLOBAL device index (`idx + 100`), so in a 41-device design the two
 * fronthaul switches at one cell site came out as VLAN 134 and 135 — a radio
 * homed to one and its DU reached via the other could never exchange eCPRI.
 * The radios and DUs carried a `<CHANGE-ME-ecpri-vlan>` placeholder, so
 * nothing reconciled the two ends either.
 */
export const ORAN_FRONTHAUL_VLAN = 134
export const ORAN_PTP_VLAN = 900
export const ORAN_MGMT_VLAN = 999
export const ORAN_PTP_DOMAIN = 24

/** Physical Cell Identity range in 5G NR (TS 38.211): 0..1007. */
const NR_PCI_MAX = 1008

/**
 * PCI for the nth radio. Consecutive assignment is deliberate: PCI mod 3 sets
 * the SSB frequency-domain shift, so neighbouring cells — which are adjacent
 * in this ordering — land on different shifts. The generated config still
 * tells the operator to validate the plan against the real neighbour list;
 * PCI collision/confusion is the classic 5G RAN outage.
 */
function oranPci(ruIdx: number): number {
  return ruIdx % NR_PCI_MAX
}

/** The CU an O-DU homes to, round-robin over the CUs actually in the BOM. */
function oranHomeCu(duIdx: number, allDevices: BOMDevice[]): { idx: number; hostname: string } {
  const cus = allDevices.filter(d => d.subLayer === 'oran-cu')
  if (!cus.length) return { idx: 0, hostname: '<CHANGE-ME-cu-hostname>' }
  const i = duIdx % cus.length
  return { idx: i, hostname: cus[i].hostname }
}

function oranCuConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  // Tier-scoped (Z5): the id used to come from the global device index.
  const cuIdx = roleIndex(dev, allDevices, idx)
  const cuId = cuIdx + 1
  const f1cIp = ipAdd('10.240.1.0', cuIdx + 1)
  const f1uIp = ipAdd('10.240.2.0', cuIdx + 1)
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : O-RAN Centralized Unit (O-CU-CP + O-CU-UP)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── System Identity ──────────────────────────────────────────────────────────
hostname ${dev.hostname}
gnb-cu-id ${cuId}
plmn-id mcc <CHANGE-ME-mcc> mnc <CHANGE-ME-mnc>
tracking-area-code <CHANGE-ME-tac>
cell-id <CHANGE-ME-nci>

# ── F1 Interface (CU ↔ DU) ──────────────────────────────────────────────────
f1-c:
  local-address ${f1cIp}
  sctp-port 38472
f1-u:
  local-address ${f1uIp}
  gtp-u-port 2152

# ── E1 Interface (CU-CP ↔ CU-UP) ───────────────────────────────────────────
e1:
  cu-cp-address <CHANGE-ME-cu-cp-e1-ip>
  cu-up-address <CHANGE-ME-cu-up-e1-ip>
  sctp-port 38462

# ── NG Interface (CU ↔ 5GC AMF) ─────────────────────────────────────────────
ng-c:
  amf-address <CHANGE-ME-amf-ip>
  sctp-port 38412
ng-u:
  upf-address <CHANGE-ME-upf-ip>
  gtp-u-port 2152

# ── PTP Timing (ITU-T G.8275.1 Telecom Profile) ─────────────────────────────
ptp:
  profile g8275.1
  domain ${ORAN_PTP_DOMAIN}
  clock-class slave
  transport ethernet
  announce-interval -3
  sync-interval -4
  delay-request-interval -4
  grandmaster <CHANGE-ME-ptp-gm-ip>
  priority1 128
  priority2 128

# ── Management ───────────────────────────────────────────────────────────────
management:
  ip-address <CHANGE-ME-mgmt-ip>/24
  gateway <CHANGE-ME-mgmt-gw>
  ssh-server enabled
  ntp-server <CHANGE-ME-ntp-primary>
  syslog-server <CHANGE-ME-syslog-ip>
  netconf enabled port 830
  o1-interface:
    ves-collector <CHANGE-ME-ves-collector-ip>:8443

# ── QoS (5QI Mapping) ───────────────────────────────────────────────────────
qos:
  5qi-1:   # Conversational Voice
    dscp ef
    priority 1
  5qi-5:   # IMS Signaling
    dscp af31
    priority 2
  5qi-9:   # Default data bearer
    dscp 0
    priority 9
  5qi-85:  # URLLC (ultra-reliable low-latency)
    dscp 46
    priority 0
`
}

function oranDuConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  // Tier-scoped (Z5): with two CUs ahead of them in the BOM the DU ids used
  // to start at 3, and every DU shared one <CHANGE-ME-du-f1c-ip> and pointed
  // at one <CHANGE-ME-cu-f1c-ip> even though the design has two CUs.
  const duIdx = roleIndex(dev, allDevices, idx)
  const duId = duIdx + 1
  const cu = oranHomeCu(duIdx, allDevices)
  const duF1c = ipAdd('10.241.1.0', duIdx + 1)
  const duF1u = ipAdd('10.241.2.0', duIdx + 1)
  const cuF1c = ipAdd('10.240.1.0', cu.idx + 1)
  const cuF1u = ipAdd('10.240.2.0', cu.idx + 1)
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : O-RAN Distributed Unit (O-DU)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── System Identity ──────────────────────────────────────────────────────────
hostname ${dev.hostname}
gnb-du-id ${duId}
plmn-id mcc <CHANGE-ME-mcc> mnc <CHANGE-ME-mnc>

# ── F1 Interface (DU → CU) ──────────────────────────────────────────────────
f1-c:
  local-address ${duF1c}
  cu-address ${cuF1c}            # ${cu.hostname}
  sctp-port 38472
f1-u:
  local-address ${duF1u}
  cu-address ${cuF1u}            # ${cu.hostname}
  gtp-u-port 2152

# ── eCPRI Fronthaul (DU ↔ RU — O-RAN 7.2x split) ───────────────────────────
ecpri:
  transport ethernet
  vlan-id ${ORAN_FRONTHAUL_VLAN}
  local-address ${ipAdd('10.242.0.0', duIdx + 1)}
  message-type iq-data
  # O-RAN 7.2x lower-layer split: RU handles RF + low-PHY (FFT/beamforming),
  # DU handles high-PHY + MAC + RLC
  compression:
    type block-floating-point
    bit-width 9
  max-sections-per-symbol 273    # 100 MHz NR
  ul-channels 4
  dl-channels 4

# ── PTP Timing (ITU-T G.8275.1 Telecom Profile) ─────────────────────────────
ptp:
  profile g8275.1
  domain ${ORAN_PTP_DOMAIN}
  clock-class slave
  transport ethernet
  sync-interval -4
  delay-request-interval -4
  grandmaster <CHANGE-ME-ptp-gm-ip>
  # DU is the timing reference for connected O-RUs
  # Stratum: GM → switch (TC) → DU → RU

# ── Cell Configuration ──────────────────────────────────────────────────────
nr-cell:
  band n78                       # 3.5 GHz (C-band)
  bandwidth 100                  # MHz
  scs 30                         # kHz subcarrier spacing
  duplex tdd
  tdd-pattern:
    dl-slots 7
    ul-slots 2
    special-slots 1
    # DDDDDDDSUDDDDDDDDSU — 2.5ms periodicity
  arfcn <CHANGE-ME-dl-arfcn>

# ── Real-Time Processing ────────────────────────────────────────────────────
l1-offload:
  type fpga
  dpdk-cores 4-11               # isolated CPUs for L1 processing
  huge-pages 16G
  fapi-interface:
    slot-indication-timer 500us  # 500µs for 30kHz SCS

# ── Management ───────────────────────────────────────────────────────────────
management:
  ip-address <CHANGE-ME-mgmt-ip>/24
  gateway <CHANGE-ME-mgmt-gw>
  ssh-server enabled
  ntp-server <CHANGE-ME-ntp-primary>
  syslog-server <CHANGE-ME-syslog-ip>
  o1-interface:
    ves-collector <CHANGE-ME-ves-collector-ip>:8443
`
}

function oranRuConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  // Every O-RU in the dumped design was byte-identical apart from its
  // hostname: no ru-id, no cell identity and no PCI. PCI planning is the
  // defining O-RU parameter and PCI collision is the classic 5G RAN outage.
  const ruIdx = roleIndex(dev, allDevices, idx)
  const ruId = ruIdx + 1
  const pci = oranPci(ruIdx)
  // PCI reuse across a large deployment is normal and unavoidable — the space
  // is 1008 wide. Silent reuse is not: say so on the radio that is reusing.
  const ruTotal = allDevices.filter(d => d.subLayer === 'oran-ru').length
  const pciReused = ruTotal > NR_PCI_MAX
    ? `\n# PCI REUSE: this design has ${ruTotal} radios in a 1008-wide PCI space.
# This PCI repeats every ${NR_PCI_MAX} radios. Confirm the reusing cells are far
# enough apart that neither appears in the other's neighbour list.`
    : ''
  const ruIp = ipAdd('10.242.128.0', ruIdx + 1)
  const mgmtIp = ipAdd('10.243.0.0', ruIdx + 1)
  // Each radio homes to a DU; sectors are grouped three to a DU, which is the
  // ratio buildDeviceList sizes the DU tier with.
  const dus = allDevices.filter(d => d.subLayer === 'oran-du')
  const duHost = dus.length ? dus[Math.floor(ruIdx / 3) % dus.length].hostname : '<CHANGE-ME-du-hostname>'
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : O-RAN Radio Unit (O-RU)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── System Identity ──────────────────────────────────────────────────────────
hostname ${dev.hostname}
ru-id ${ruId}
# Physical Cell Identity — 0..1007 (TS 38.211). PCI mod 3 sets the SSB
# frequency-domain shift, so adjacent radios are given adjacent PCIs and
# therefore different shifts. VALIDATE this plan against the real neighbour
# list before go-live: a PCI collision is a silent, hard-to-find outage.${pciReused}
pci ${pci}
cell-id <CHANGE-ME-nci-prefix>${String(ruId).padStart(3, '0')}
served-by ${duHost}

# ── eCPRI Fronthaul (RU → DU — O-RAN 7.2x split) ───────────────────────────
ecpri:
  transport ethernet
  vlan-id ${ORAN_FRONTHAUL_VLAN}
  local-address ${ruIp}
  du-mac <CHANGE-ME-du-mac-address>
  ru-mac <CHANGE-ME-ru-mac-address>
  # O-RAN 7.2x split: RU performs RF + low-PHY (FFT, iFFT, beamforming)
  compression:
    type block-floating-point
    bit-width 9

# ── PTP Timing (G.8275.1 — slave to DU/switch) ──────────────────────────────
ptp:
  profile g8275.1
  domain ${ORAN_PTP_DOMAIN}
  clock-class slave-only
  transport ethernet
  sync-interval -4
  delay-request-interval -4
  # RU syncs to DU via fronthaul switch PTP transparent-clock path

# ── Radio Configuration ─────────────────────────────────────────────────────
radio:
  band n78
  bandwidth 100                  # MHz
  center-frequency <CHANGE-ME-center-freq-mhz>
  tx-power <CHANGE-ME-tx-power-dbm>
  mimo-config 64T64R
  beamforming:
    type digital
    max-beams 8
    codebook-mode type-II
  antenna:
    azimuth <CHANGE-ME-azimuth-deg>
    tilt <CHANGE-ME-electrical-tilt-deg>
    height <CHANGE-ME-height-m>

# ── Management ───────────────────────────────────────────────────────────────
management:
  ip-address ${mgmtIp}/24
  gateway <CHANGE-ME-mgmt-gw>
  o1-interface:
    ves-collector <CHANGE-ME-ves-collector-ip>:8443
  # ZTP: DHCP option 43 for initial O-RU bootstrap
  ztp:
    dhcp-vendor-class O-RAN-FHM
    config-url <CHANGE-ME-ztp-server>/oran-ru-bootstrap.json
`
}

function oranFronthaulConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  const fhIdx = roleIndex(dev, allDevices, idx)
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : O-RAN Fronthaul Switch (PTP Transparent-Clock)
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
feature lldp
feature ptp
!
username admin privilege 15 role network-admin password 5 <CHANGE-ME-admin-password>
!
ntp server <CHANGE-ME-ntp-primary> prefer
ntp server <CHANGE-ME-ntp-secondary>
!
! ── PTP — IEEE 1588 Transparent Clock (G.8275.1 telecom profile) ────────────
! Fronthaul switches MUST be transparent-clocks to preserve timing accuracy
! from PTP GM → DU → RU chain. Boundary-clock mode introduces unacceptable
! jitter for eCPRI Class C7 (±65ns requirement).
ptp mode transparent
ptp profile g8275.1
ptp domain ${ORAN_PTP_DOMAIN}
ptp vlan ${ORAN_FRONTHAUL_VLAN}
!
! ── eCPRI Fronthaul VLANs ────────────────────────────────────────────────────
! Fronthaul is ONE broadcast domain across the site: every fronthaul switch,
! every O-RU and every O-DU must agree on this VLAN. It used to be derived
! from the switch's global device index, so the two switches at a site came
! out as VLAN 134 and 135 and a radio homed to one could not reach a DU
! behind the other.
vlan ${ORAN_FRONTHAUL_VLAN}
  name ECPRI-FRONTHAUL
!
vlan ${ORAN_PTP_VLAN}
  name PTP-TIMING
!
vlan ${ORAN_MGMT_VLAN}
  name MGMT-OOB
!
! ── Downlink interfaces (to O-RUs) ──────────────────────────────────────────
interface range Ethernet1/1-48
  description O-RU-DOWNLINK
  switchport mode trunk
  switchport trunk allowed vlan ${ORAN_FRONTHAUL_VLAN},${ORAN_PTP_VLAN},${ORAN_MGMT_VLAN}
  spanning-tree port type edge trunk
  priority-flow-control mode on
  mtu 9216
  lldp transmit
  lldp receive
  no shutdown
!
! ── Uplink interfaces (to DU / midhaul) ─────────────────────────────────────
interface range Ethernet1/49-54
  description UPLINK-TO-DU-MIDHAUL
  switchport mode trunk
  switchport trunk allowed vlan ${ORAN_FRONTHAUL_VLAN},${ORAN_PTP_VLAN},${ORAN_MGMT_VLAN}
  mtu 9216
  priority-flow-control mode on
  no shutdown
!
! ── QoS — eCPRI Class C7 (low-latency scheduling) ──────────────────────────
class-map type qos match-any CM-ECPRI
  match cos 7
class-map type qos match-any CM-PTP
  match cos 6
!
policy-map type qos PM-FRONTHAUL
  class CM-ECPRI
    set qos-group 7
  class CM-PTP
    set qos-group 6
!
policy-map type queuing PM-FRONTHAUL-QUEUING
  class type queuing c-out-q7
    priority level 1
    bandwidth percent 60
  class type queuing c-out-q6
    priority level 2
    bandwidth percent 10
  class type queuing c-out-q-default
    bandwidth remaining percent 100
!
! ── Management ───────────────────────────────────────────────────────────────
interface Vlan${ORAN_MGMT_VLAN}
  ip address ${ipAdd('10.243.128.0', fhIdx + 1)}/24
  no shutdown
!
ip route 0.0.0.0/0 <CHANGE-ME-mgmt-gw>
!
logging server <CHANGE-ME-syslog-ip>
!
line vty
  access-class MGMT-ACL in
!
ip access-list MGMT-ACL
  permit ip <CHANGE-ME-mgmt-subnet> any
  deny ip any any log
`
}

function oranMidhaulConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  // Tier-scoped (Z5): the router-id and NET came from the global device
  // index, so in a 41-device design the two midhaul routers were numbered
  // 37 and 38 rather than 1 and 2.
  const mhIdx = roleIndex(dev, allDevices, idx)
  const routerId = ipAdd('10.250.1.0', mhIdx + 1)
  const isisNet = `49.0001.0102.5001.${String(mhIdx + 1).padStart(4, '0')}.00`
  return `! ═══════════════════════════════════════════════════════════════
! Device : ${dev.hostname}
! Role   : O-RAN Midhaul/Backhaul Router (PTP Boundary-Clock)
! Model  : ${dev.model}
! Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
! ═══════════════════════════════════════════════════════════════

hostname ${dev.hostname}
!
! ── PTP — IEEE 1588 Boundary Clock (G.8275.1) ────────────────────────────────
! Midhaul routers operate as boundary-clocks, regenerating PTP timing for
! each segment. SyncE provides physical-layer frequency reference.
ptp clock boundary domain ${ORAN_PTP_DOMAIN}
  clock-port GM-UPSTREAM master
    transport ethernet multicast
    announce interval -3
    sync interval -4
    delay-req interval -4
  clock-port DU-DOWNSTREAM slave
    transport ethernet multicast
    announce interval -3
    sync interval -4
    delay-req interval -4
!
frequency synchronization
  quality itu-t option 1
  clock-interface timing-mode system
!
interface GigabitEthernet0/0/0/0
  description UPSTREAM-TO-CORE
  ipv4 address <CHANGE-ME-upstream-ip>/30
  frequency synchronization
    selection input
    priority 1
    wait-to-restore 5
  ptp
    profile slave g.8275.1
  no shutdown
!
! ── IS-IS + Segment Routing (transport underlay) ─────────────────────────────
router isis XHAUL
  is-type level-2-only
  net ${isisNet}
  address-family ipv4 unicast
    metric-style wide
    segment-routing mpls sr-prefer
  interface Loopback0
    address-family ipv4 unicast
      prefix-sid index ${idx + 100}
!
interface Loopback0
  ipv4 address ${routerId}/32
  no shutdown
!
! ── F1 / midhaul interfaces ──────────────────────────────────────────────────
interface GigabitEthernet0/0/0/1
  description MIDHAUL-TO-DU-CU
  ipv4 address <CHANGE-ME-midhaul-ip>/30
  frequency synchronization
    selection input
    priority 2
  ptp
    profile master g.8275.1
  no shutdown
!
interface GigabitEthernet0/0/0/2
  description BACKHAUL-TO-5GC
  ipv4 address <CHANGE-ME-backhaul-ip>/30
  no shutdown
!
! ── QoS — differentiated transport for CU/DU/RU traffic ────────────────────
class-map match-any CM-F1-CONTROL
  match dscp af31
class-map match-any CM-F1-USER
  match dscp ef
class-map match-any CM-TIMING
  match dscp cs7
!
policy-map PM-XHAUL
  class CM-TIMING
    priority level 1
    police rate percent 5
  class CM-F1-CONTROL
    bandwidth percent 15
  class CM-F1-USER
    bandwidth percent 60
  class class-default
    bandwidth percent 20
!
! ── Management ───────────────────────────────────────────────────────────────
interface MgmtEth0/RP0/CPU0/0
  ipv4 address <CHANGE-ME-mgmt-ip>/24
  no shutdown
!
router static
  address-family ipv4 unicast
    0.0.0.0/0 <CHANGE-ME-mgmt-gw>
!
ssh server v2
logging <CHANGE-ME-syslog-ip>
ntp server <CHANGE-ME-ntp-primary>
!
telemetry model-driven
  sensor-group XHAUL-HEALTH
    sensor-path Cisco-IOS-XR-ptp-oper:ptp/local-clock
    sensor-path Cisco-IOS-XR-freqsync-oper:frequency-synchronization
    sensor-path Cisco-IOS-XR-infra-statsd-oper:infra-statistics/interfaces
  subscription XHAUL-SUB
    sensor-group-id XHAUL-HEALTH sample-interval 10000
    destination-id COLLECTOR
  destination-group COLLECTOR
    address-family ipv4 <CHANGE-ME-telemetry-collector-ip> port 57500
      encoding self-describing-gpb
      protocol grpc
`
}

function oranCoreConfig(dev: BOMDevice, idx: number): string {
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : 5G Core — User Plane Function (UPF)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── System Identity ──────────────────────────────────────────────────────────
hostname ${dev.hostname}
upf-id ${idx + 1}

# ── N3 Interface (gNB → UPF — user-plane GTP-U tunnel) ──────────────────────
n3:
  local-address <CHANGE-ME-n3-ip>
  gtp-u-port 2152
  mtu 9000
  # Receives GTP-U encapsulated user data from CU-UP

# ── N6 Interface (UPF → Data Network / Internet) ────────────────────────────
n6:
  local-address <CHANGE-ME-n6-ip>
  data-network:
    dnn internet
      ip-pool <CHANGE-ME-ue-pool-cidr>
    dnn enterprise
      ip-pool <CHANGE-ME-enterprise-pool-cidr>

# ── N9 Interface (UPF ↔ UPF — inter-UPF forwarding) ────────────────────────
n9:
  local-address <CHANGE-ME-n9-ip>
  gtp-u-port 2152

# ── N4 Interface (SMF → UPF — PFCP control) ────────────────────────────────
n4:
  smf-address <CHANGE-ME-smf-ip>
  local-address <CHANGE-ME-n4-ip>
  pfcp-port 8805
  heartbeat-interval 10

# ── DPDK / SmartNIC Offload ──────────────────────────────────────────────────
dataplane:
  type dpdk
  pci-devices:
    - <CHANGE-ME-smartnic-pci-addr>
  cores 4-15                     # isolated CPUs for packet processing
  huge-pages 32G
  rx-queues 8
  tx-queues 8
  flow-offload:
    gtp-u-decap enabled
    header-enrichment enabled

# ── QoS Enforcement ─────────────────────────────────────────────────────────
qos:
  ambr-enforcement enabled
  5qi-to-dscp:
    5qi-1: ef                    # Conversational Voice
    5qi-5: af31                  # IMS Signaling
    5qi-9: be                    # Default
    5qi-85: 46                   # URLLC
  rate-limiting:
    per-session-max-bitrate <CHANGE-ME-max-bps>
    aggregate-max-bitrate <CHANGE-ME-aggregate-bps>

# ── Management ───────────────────────────────────────────────────────────────
management:
  ip-address <CHANGE-ME-mgmt-ip>/24
  gateway <CHANGE-ME-mgmt-gw>
  ssh-server enabled
  ntp-server <CHANGE-ME-ntp-primary>
  syslog-server <CHANGE-ME-syslog-ip>
  prometheus-exporter:
    port 9090
    metrics: [sessions, throughput, latency, packet_drops, gtp_tunnels]
`
}

function oranTimingConfig(dev: BOMDevice, idx: number): string {
  return `# ═══════════════════════════════════════════════════════════════
# Device : ${dev.hostname}
# Role   : PTP Grandmaster Clock (GNSS-synced)
# Model  : ${dev.model}
# Generated by NetDesign AI — replace <CHANGE-ME-*> before deploying.
# ═══════════════════════════════════════════════════════════════

# ── GNSS Receiver ────────────────────────────────────────────────────────────
gnss:
  constellation GPS+Galileo+BeiDou
  antenna-cable-delay <CHANGE-ME-cable-delay-ns>
  survey-mode:
    type self-survey
    duration 86400               # 24h position averaging
  anti-spoofing enabled

# ── PTP Configuration (ITU-T G.8275.1 Telecom Profile) ──────────────────────
ptp:
  profile g8275.1
  domain ${ORAN_PTP_DOMAIN}
  clock-class grandmaster
  clock-accuracy 0x21            # ±100ns (GNSS-locked)
  time-source gps
  priority1 128
  priority2 ${128 + idx}         # GM selection tiebreaker
  transport ethernet
  announce-interval -3           # 8 per second
  sync-interval -4               # 16 per second
  delay-request-interval -4

# ── Output Ports ─────────────────────────────────────────────────────────────
ports:
  - id 1
    description TO-FRONTHAUL-SWITCH
    mode master
    profile g8275.1
    transport ethernet
  - id 2
    description TO-MIDHAUL-ROUTER
    mode master
    profile g8275.1
    transport ethernet
  - id 3
    description TO-CU-SERVER
    mode master
    profile g8275.1
    transport ethernet
  - id 4
    description TO-DU-SERVER
    mode master
    profile g8275.1
    transport ethernet

# ── SyncE (physical layer frequency) ────────────────────────────────────────
synce:
  enabled true
  quality-level prc              # Primary Reference Clock
  esmc enabled

# ── Monitoring & Alarms ─────────────────────────────────────────────────────
monitoring:
  gnss-lock-alarm:
    holdover-timeout 60          # seconds before alarm
  clock-drift-threshold 100      # ns before warning
  snmp:
    community <CHANGE-ME-snmp-community>
    trap-receiver <CHANGE-ME-snmp-trap-ip>

# ── Management ───────────────────────────────────────────────────────────────
management:
  hostname ${dev.hostname}
  ip-address <CHANGE-ME-mgmt-ip>/24
  gateway <CHANGE-ME-mgmt-gw>
  ssh enabled
  ntp-server <CHANGE-ME-ntp-primary>
  syslog-server <CHANGE-ME-syslog-ip>
  snmp:
    version v3
    user netmon auth sha <CHANGE-ME-snmp-auth-pass> priv aes <CHANGE-ME-snmp-priv-pass>
`
}

function isOranSubLayer(subLayer: string): boolean {
  return subLayer.startsWith('oran-')
}

function oranConfig(dev: BOMDevice, idx: number, allDevices: BOMDevice[] = []): string {
  switch (dev.subLayer) {
    case 'oran-cu':        return oranCuConfig(dev, idx, allDevices)
    case 'oran-du':        return oranDuConfig(dev, idx, allDevices)
    case 'oran-ru':        return oranRuConfig(dev, idx, allDevices)
    case 'oran-fronthaul': return oranFronthaulConfig(dev, idx, allDevices)
    case 'oran-midhaul':   return oranMidhaulConfig(dev, idx, allDevices)
    case 'oran-core':      return oranCoreConfig(dev, idx)
    case 'oran-timing':    return oranTimingConfig(dev, idx)
    default:               return genericConfig(dev)
  }
}

const NON_NETWORK_LAYERS = new Set(['gpu-compute', 'cloud-gw', 'cloud-transit'])

export function generateConfig(dev: BOMDevice, idx: number, useCase: UseCase | '' = '', appTypes: AppType[] = [], allDevices: BOMDevice[] = [], protoFeatures: string[] = []): string {
  if (NON_NETWORK_LAYERS.has(dev.subLayer)) return ''
  const isGpu = useCase === 'gpu'
  const v = dev.vendor
  const l = dev.subLayer
  // Dell EMC and NVIDIA DC fabrics are lossless-first; always enable full RoCEv2/DCB config.
  // Other vendors (Cisco/Arista) only get the lossless path when use case is explicitly gpu.
  const needsRoce = isGpu || ((v === 'Dell EMC' || v === 'NVIDIA') && useCase === 'dc')

  if (v === 'Palo Alto' && l === 'firewall')                        return paloAltoFirewallConfig(dev, idx)
  if (isOranSubLayer(l))                                             return oranConfig(dev, idx, allDevices)
  if (v === 'Cisco'     && l === 'firewall')                         return isFtdModel(dev.model) ? ciscoFtdFirewallConfig(dev, idx, useCase, allDevices) : ciscoFirewallConfig(dev, idx)
  if (v === 'Cisco'     && l === 'sdwan-controller')                 return sdwanControllerConfig(dev, idx)
  if (v === 'Cisco'     && l === 'wan-edge' && isSdWanEdge(dev))     return sdwanEdgeConfig(dev, idx, allDevices)
  if (v === 'Cisco'     && l === 'wan-edge' && isIosXrPlatform(dev))  return iosxrPeConfig(dev, idx)
  if (v === 'Cisco'     && l === 'wan-edge')                         return iosxeWanConfig(dev, idx)
  if (v === 'Cisco'     && l === 'spine')                            return nxosSpineConfig(dev, idx, needsRoce, allDevices, protoFeatures)
  if (v === 'Cisco'     && l === 'leaf')                             return nxosLeafConfig(dev, idx, needsRoce, allDevices, protoFeatures, useCase === 'multisite', appTypes)
  if (v === 'Cisco'     && (l === 'distribution' || l === 'access')) return iosxeCampusConfig(dev, idx, appTypes, allDevices)
  if (v === 'Arista'    && l === 'spine')                            return aristaSpineConfig(dev, idx, needsRoce, allDevices, protoFeatures)
  if (v === 'Arista'    && l === 'leaf')                             return aristaLeafConfig(dev, idx, needsRoce, allDevices, protoFeatures, useCase === 'multisite', appTypes)
  if (v === 'Arista'    && (l === 'distribution' || l === 'access')) return aristaCampusConfig(dev, idx)
  if (v === 'Juniper'   && l === 'spine')                            return juniperSpineConfig(dev, idx, protoFeatures, needsRoce, allDevices)
  if (v === 'Juniper'   && l === 'leaf')                             return juniperLeafConfig(dev, idx, useCase === 'multisite', protoFeatures, needsRoce, appTypes, allDevices)
  if (v === 'Juniper'   && (l === 'distribution' || l === 'access')) return juniperCampusConfig(dev, idx)
  if (v === 'Juniper'   && l === 'firewall')                         return juniperSrxConfig(dev, idx)
  if (v === 'Juniper'   && l === 'wan-edge')                         return juniperWanConfig(dev, idx)
  if (v === 'Nokia'     && (l === 'spine' || l === 'leaf'))          return nokiaSrLinuxConfig(dev, idx, useCase === 'multisite', protoFeatures, appTypes, allDevices)
  if (v === 'Fortinet'  && l === 'firewall')                         return fortinetFirewallConfig(dev, idx)
  if (v === 'Fortinet'  && (l === 'distribution' || l === 'access')) return fortinetCampusConfig(dev, idx, appTypes)
  if (v === 'Dell EMC'  && (l === 'spine' || l === 'leaf'))          return dellOs10SwitchConfig(dev, idx, needsRoce, allDevices)
  if (v === 'HPE Aruba')                                             return arubaOsCxConfig(dev, idx)
  if (v === 'NVIDIA'    && (l === 'spine' || l === 'leaf'))          return nvidiaSpectrumConfig(dev, idx, needsRoce, allDevices)
  if (v === 'Extreme Networks')                                      return extremeExosConfig(dev, idx, allDevices)
  return genericConfig(dev)
}

export function generateAllConfigs(
  devices: BOMDevice[],
  useCase: UseCase | '' = '',
  policyBlocks: string[] = [],
  appTypes: AppType[] = [],
  protoFeatures: string[] = [],
): Record<string, string> {
  const entries: [string, string][] = []
  for (let i = 0; i < devices.length; i++) {
    const dev = devices[i]
    const base = generateConfig(dev, i, useCase, appTypes, devices, protoFeatures)
    if (!base) continue
    const withPolicies = policyBlocks.length
      ? applyPolicies(base, dev, useCase, policyBlocks)
      : base
    entries.push([dev.id, withPolicies])
  }
  return Object.fromEntries(entries)
}
