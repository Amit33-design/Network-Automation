/**
 * NetDesign AI — Client-side Policy Catalog
 * ==========================================
 * Mirrors the backend policy generators (backend/policies/*.py) for demo mode.
 * Each policy is role-aware and platform-aware: it returns realistic CLI for the
 * given device, or null when it does not apply to that device's role/use-case.
 *
 * Selected policy IDs live in useAppStore().policyBlocks and are applied by
 * generateAllConfigs() as dedicated `! ====== POLICY: <LABEL> ======` sections,
 * so they appear individually in the Step-3 section navigator.
 *
 * Rules (CLAUDE.md):
 *   - All secrets use <CHANGE-ME-*> placeholders.
 *   - Pure TypeScript, no new npm packages.
 */
import type { BOMDevice, UseCase } from '@/types'

export type PolicyCategory =
  | 'Management'
  | 'Security'
  | 'L2 Switching'
  | 'L3 Routing'
  | 'QoS & Voice'

export interface PolicyDef {
  id: string
  label: string
  icon: string
  category: PolicyCategory
  description: string
  /** Device subLayers this applies to. '*' = every device. */
  appliesTo: string[]
  /** Use cases this is relevant for. Empty/undefined = all use cases. */
  useCases?: UseCase[]
  /** Render platform-aware CLI for a device, or null when not applicable. */
  render: (dev: BOMDevice, useCase: UseCase | '') => string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCisco(d: BOMDevice): boolean {
  return d.vendor === 'Cisco'
}
function isArista(d: BOMDevice): boolean {
  return d.vendor === 'Arista'
}
function isJuniper(d: BOMDevice): boolean {
  return d.vendor === 'Juniper'
}
function roleIn(d: BOMDevice, roles: string[]): boolean {
  const l = (d.subLayer || '').toLowerCase()
  const r = (d.role || '').toLowerCase()
  return roles.some(x => l.includes(x) || r.includes(x))
}

const L3_ROLES = ['spine', 'leaf', 'core', 'distribution', 'wan-edge', 'border']
const ACCESS_ROLES = ['access']
const EDGE_ROLES = ['access', 'distribution']
const ROUTING_ROLES = ['spine', 'leaf', 'wan-edge', 'border', 'core']

// ── Policy catalog ──────────────────────────────────────────────────────────────

export const POLICY_CATALOG: PolicyDef[] = [
  // ════════════════════════════════ MANAGEMENT ════════════════════════════════
  {
    id: 'ntp',
    label: 'NTP (authenticated)',
    icon: '🕐',
    category: 'Management',
    description: 'NTP server with MD5 authentication and loopback source',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set system ntp authentication-key 1 type md5 value <CHANGE-ME-NTP-KEY>
set system ntp server <NTP-SERVER-IP> key 1 prefer
set system ntp trusted-key 1`
      }
      return `ntp authenticate
ntp authentication-key 1 md5 <CHANGE-ME-NTP-KEY>
ntp trusted-key 1
ntp server <NTP-SERVER-IP> key 1 prefer
ntp source Loopback0`
    },
  },
  {
    id: 'snmp',
    label: 'SNMPv3',
    icon: '📡',
    category: 'Management',
    description: 'SNMPv3 auth/priv user, group, and trap receiver (no v2c community)',
    appliesTo: ['*'],
    render: (d) => {
      if (isArista(d)) {
        return `snmp-server group NETOPS v3 priv
snmp-server user netops NETOPS v3 auth sha <CHANGE-ME-SNMP-AUTH> priv aes <CHANGE-ME-SNMP-PRIV>
snmp-server host <CHANGE-ME-TRAP-HOST> version 3 priv netops
snmp-server enable traps`
      }
      return `snmp-server group NETOPS v3 priv
snmp-server user netops NETOPS v3 auth sha <CHANGE-ME-SNMP-AUTH> priv aes 128 <CHANGE-ME-SNMP-PRIV>
snmp-server source-interface traps Loopback0
snmp-server host <CHANGE-ME-TRAP-HOST> version 3 priv netops
snmp-server enable traps`
    },
  },
  {
    id: 'syslog',
    label: 'Syslog',
    icon: '📋',
    category: 'Management',
    description: 'Remote syslog at informational level with loopback source',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set system syslog host <CHANGE-ME-SYSLOG-HOST> any info
set system syslog host <CHANGE-ME-SYSLOG-HOST> source-address <LOOPBACK-IP>`
      }
      return `logging host <CHANGE-ME-SYSLOG-HOST>
logging trap informational
logging source-interface Loopback0
logging buffered 65536 informational
logging on`
    },
  },
  {
    id: 'lldp',
    label: 'LLDP',
    icon: '🔗',
    category: 'Management',
    description: 'Enable LLDP for neighbor discovery (CDP disabled on Cisco)',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) return `set protocols lldp interface all`
      if (isArista(d)) return `lldp run`
      return `lldp run
no cdp run`
    },
  },
  {
    id: 'banner',
    label: 'Login Banner',
    icon: '⚠️',
    category: 'Management',
    description: 'Unauthorized-access warning banner (MOTD + login)',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set system login message "AUTHORIZED ACCESS ONLY. Activity is monitored and logged."`
      }
      return `banner login ^
*****************************************************************************
*  AUTHORIZED ACCESS ONLY                                                   *
*  This system is restricted to authorized users. All activity is logged   *
*  and monitored. Unauthorized access will be prosecuted.                   *
*****************************************************************************
^`
    },
  },
  {
    id: 'archive',
    label: 'Config Archive / Rollback',
    icon: '💾',
    category: 'Management',
    description: 'Automatic config archive on change for rollback safety',
    appliesTo: ['*'],
    render: (d) => {
      if (!isCisco(d)) return null
      return `archive
 path flash:archive/config-$h-$t
 maximum 14
 time-period 1440
 write-memory
 log config
  logging enable
  notify syslog contenttype plaintext
  hidekeys`
    },
  },

  // ════════════════════════════════ SECURITY ══════════════════════════════════
  {
    id: 'aaa',
    label: 'AAA / TACACS+',
    icon: '🔐',
    category: 'Security',
    description: 'TACACS+ authentication, authorization, accounting with local fallback',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set system tacplus-server <CHANGE-ME-TACACS-IP> secret <CHANGE-ME-TACACS-KEY>
set system authentication-order [ tacplus password ]
set system accounting events [ login change-log interactive-commands ]`
      }
      return `tacacs server TAC1
 address ipv4 <CHANGE-ME-TACACS-IP>
 key <CHANGE-ME-TACACS-KEY>
aaa group server tacacs+ TACACS
 server name TAC1
 ip tacacs source-interface Loopback0
aaa new-model
aaa authentication login default group TACACS local
aaa authorization exec default group TACACS local
aaa authorization commands 15 default group TACACS local
aaa accounting commands 15 default start-stop group TACACS
aaa accounting exec default start-stop group TACACS`
    },
  },
  {
    id: 'ssh',
    label: 'SSH Hardening',
    icon: '🛡️',
    category: 'Security',
    description: 'SSHv2 only, timeouts, retries, strong KEX, no Telnet',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set system services ssh protocol-version v2
set system services ssh connection-limit 10
set system services ssh rate-limit 4
delete system services telnet`
      }
      return `ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
ip ssh maxstartups 10
ip ssh server algorithm encryption aes256-ctr aes192-ctr
ip ssh server algorithm mac hmac-sha2-256 hmac-sha2-512
no ip ssh version 1
line vty 0 15
 transport input ssh
 exec-timeout 10 0
 session-timeout 15`
    },
  },
  {
    id: 'copp',
    label: 'Control-Plane Policing (CoPP)',
    icon: '🚦',
    category: 'Security',
    description: 'CoPP to protect the route processor from control-plane DoS',
    appliesTo: L3_ROLES,
    render: (d) => {
      if (!isCisco(d)) {
        if (isArista(d)) {
          return `! Arista EOS uses a built-in, tunable control-plane policy map
control-plane
   ip access-group CPP-ACL in
policy-map type control-plane copp-system-policy
   class copp-system-bgp
      shape pps 2000
   class copp-system-arp
      shape pps 1000`
        }
        return null
      }
      return `ip access-list extended ACL-COPP-CRITICAL
 permit tcp any any eq bgp
 permit tcp any eq bgp any
 permit ospf any any
class-map match-all CM-COPP-CRITICAL
 match access-group name ACL-COPP-CRITICAL
class-map match-all CM-COPP-MGMT
 match protocol ssh
 match protocol snmp
policy-map PM-COPP
 class CM-COPP-CRITICAL
  police 2000000 conform-action transmit exceed-action transmit
 class CM-COPP-MGMT
  police 500000 conform-action transmit exceed-action drop
 class class-default
  police 100000 conform-action transmit exceed-action drop
control-plane
 service-policy input PM-COPP`
    },
  },
  {
    id: 'dot1x',
    label: '802.1X / NAC',
    icon: '🪪',
    category: 'Security',
    description: 'IBNS 2.0 802.1X with MAB fallback, RADIUS CoA, critical auth',
    appliesTo: ACCESS_ROLES,
    useCases: ['campus', 'multisite'],
    render: (d) => {
      if (!isCisco(d)) return null
      return `aaa authentication dot1x default group RADIUS
aaa authorization network default group RADIUS
aaa accounting dot1x default start-stop group RADIUS
radius server RAD1
 address ipv4 <CHANGE-ME-RADIUS-IP> auth-port 1812 acct-port 1813
 key <CHANGE-ME-RADIUS-KEY>
aaa server radius dynamic-author
 client <CHANGE-ME-RADIUS-IP> server-key <CHANGE-ME-RADIUS-KEY>
dot1x system-auth-control
policy-map type control subscriber DOT1X-MAB
 event session-started match-all
  10 class always do-until-failure
   10 authenticate using dot1x priority 10
 event authentication-failure match-first
  10 class DOT1X-FAILED do-until-failure
   10 authenticate using mab priority 20
! Apply on access edge ports:
interface range <ACCESS-PORTS>
 access-session host-mode multi-auth
 access-session closed
 access-session port-control auto
 mab
 dot1x pae authenticator
 service-policy type control subscriber DOT1X-MAB`
    },
  },
  {
    id: 'dhcp-snooping',
    label: 'DHCP Snooping + DAI + IPSG',
    icon: '🧱',
    category: 'Security',
    description: 'DHCP snooping, Dynamic ARP Inspection, IP Source Guard on access edge',
    appliesTo: EDGE_ROLES,
    useCases: ['campus', 'multisite', 'dc'],
    render: (d) => {
      if (!isCisco(d)) return null
      return `ip dhcp snooping
ip dhcp snooping vlan 10-100
no ip dhcp snooping information option
ip arp inspection vlan 10-100
! Trust uplinks toward DHCP server / distribution:
interface range <UPLINK-PORTS>
 ip dhcp snooping trust
 ip arp inspection trust
! Protect access ports:
interface range <ACCESS-PORTS>
 ip dhcp snooping limit rate 15
 ip verify source
 ip arp inspection limit rate 15`
    },
  },
  {
    id: 'port-security',
    label: 'Port Security',
    icon: '🔒',
    category: 'Security',
    description: 'MAC limiting with sticky learning and restrict violation on access ports',
    appliesTo: ACCESS_ROLES,
    render: (d) => {
      if (!isCisco(d)) return null
      return `interface range <ACCESS-PORTS>
 switchport port-security
 switchport port-security maximum 3
 switchport port-security violation restrict
 switchport port-security mac-address sticky
 switchport port-security aging time 120
 switchport port-security aging type inactivity`
    },
  },
  {
    id: 'storm-control',
    label: 'Storm Control',
    icon: '🌩️',
    category: 'Security',
    description: 'Broadcast/multicast/unknown-unicast storm suppression on edge ports',
    appliesTo: EDGE_ROLES,
    render: (d) => {
      if (isArista(d)) {
        return `interface range <ACCESS-PORTS>
   storm-control broadcast level 1
   storm-control multicast level 2
   storm-control unknown-unicast level 5`
      }
      if (!isCisco(d)) return null
      return `interface range <ACCESS-PORTS>
 storm-control broadcast level 1.00
 storm-control multicast level 2.00
 storm-control unicast level 5.00
 storm-control action trap`
    },
  },
  {
    id: 'mgmt-acl',
    label: 'Management-Plane ACL',
    icon: '🚧',
    category: 'Security',
    description: 'Restrict SSH/SNMP to management subnets on the VTY / mgmt plane',
    appliesTo: ['*'],
    render: (d) => {
      if (isJuniper(d)) {
        return `set firewall family inet filter MGMT-PROTECT term allow-mgmt from source-address <MGMT-SUBNET>/24
set firewall family inet filter MGMT-PROTECT term allow-mgmt then accept
set firewall family inet filter MGMT-PROTECT term drop then discard`
      }
      return `ip access-list standard ACL-MGMT-ACCESS
 permit <MGMT-SUBNET> 0.0.0.255
 deny   any log
line vty 0 15
 access-class ACL-MGMT-ACCESS in
 transport input ssh`
    },
  },

  // ════════════════════════════════ L2 SWITCHING ══════════════════════════════
  {
    id: 'stp-harden',
    label: 'STP Hardening',
    icon: '🌳',
    category: 'L2 Switching',
    description: 'Rapid-PVST, BPDU Guard on edge, Root Guard + Loop Guard on uplinks',
    appliesTo: EDGE_ROLES,
    render: (d) => {
      if (!isCisco(d)) {
        if (isArista(d)) {
          return `spanning-tree mode rapid-pvst
spanning-tree edge-port bpduguard default
interface range <ACCESS-PORTS>
   spanning-tree portfast
   spanning-tree bpduguard enable`
        }
        return null
      }
      return `spanning-tree mode rapid-pvst
spanning-tree portfast bpduguard default
spanning-tree loopguard default
! Edge (host) ports:
interface range <ACCESS-PORTS>
 spanning-tree portfast
 spanning-tree bpduguard enable
! Uplinks toward distribution/core:
interface range <UPLINK-PORTS>
 spanning-tree guard root`
    },
  },
  {
    id: 'vlan-policy',
    label: 'VLAN Hygiene',
    icon: '🏷️',
    category: 'L2 Switching',
    description: 'Prune unused VLANs, disable DTP, dedicated native VLAN on trunks',
    appliesTo: EDGE_ROLES,
    render: (d) => {
      if (!isCisco(d)) return null
      return `vlan 999
 name NATIVE-UNUSED
! Trunk hardening — no auto-negotiation, explicit allowed list:
interface range <TRUNK-PORTS>
 switchport mode trunk
 switchport trunk native vlan 999
 switchport trunk allowed vlan 10,20,30,100
 switchport nonegotiate
! Shut + park unused access ports:
interface range <UNUSED-PORTS>
 switchport access vlan 999
 shutdown`
    },
  },

  // ════════════════════════════════ L3 ROUTING ════════════════════════════════
  {
    id: 'bgp-policy',
    label: 'BGP Route Policy',
    icon: '🗺️',
    category: 'L3 Routing',
    description: 'Prefix-lists, route-maps, max-prefix guard, and dampening for BGP',
    appliesTo: ROUTING_ROLES,
    render: (d) => {
      if (isArista(d)) {
        return `ip prefix-list PL-FABRIC-IN seq 10 permit 10.0.0.0/8 le 32
route-map RM-FABRIC-IN permit 10
   match ip address prefix-list PL-FABRIC-IN
   set local-preference 200
router bgp <ASN>
   neighbor FABRIC maximum-routes 12000 warning-limit 80
   address-family ipv4
      neighbor FABRIC route-map RM-FABRIC-IN in`
      }
      if (!isCisco(d)) return null
      return `ip prefix-list PL-FABRIC-IN seq 10 permit 10.0.0.0/8 le 32
ip prefix-list PL-BOGONS seq 10 deny 0.0.0.0/0
route-map RM-FABRIC-IN permit 10
 match ip address prefix-list PL-FABRIC-IN
 set local-preference 200
route-map RM-FABRIC-OUT permit 10
 set community 65000:100
router bgp <ASN>
 bgp dampening 15 750 2000 60
 address-family ipv4 unicast
  neighbor FABRIC maximum-prefix 12000 80 restart 30
  neighbor FABRIC route-map RM-FABRIC-IN in
  neighbor FABRIC route-map RM-FABRIC-OUT out`
    },
  },
  {
    id: 'igp-auth',
    label: 'IGP Authentication',
    icon: '🔑',
    category: 'L3 Routing',
    description: 'OSPF / IS-IS interface authentication (HMAC-SHA / MD5)',
    appliesTo: ROUTING_ROLES,
    render: (d, uc) => {
      const isis = uc === 'dc' || uc === 'gpu'
      if (!isCisco(d) && !isArista(d)) return null
      if (isis) {
        return `key chain ISIS-KEY
 key 1
  key-string <CHANGE-ME-ISIS-KEY>
  cryptographic-algorithm hmac-sha-256
router isis
 authentication mode md5 level-2
 authentication key-chain ISIS-KEY level-2`
      }
      return `key chain OSPF-KEY
 key 1
  key-string <CHANGE-ME-OSPF-KEY>
  cryptographic-algorithm hmac-sha-256
! Apply per P2P interface:
interface range <P2P-LINKS>
 ip ospf authentication key-chain OSPF-KEY
 ip ospf network point-to-point`
    },
  },
  {
    id: 'static-track',
    label: 'Floating Static + IP SLA Track',
    icon: '🛟',
    category: 'L3 Routing',
    description: 'Backup floating static route with IP SLA reachability tracking',
    appliesTo: ['wan-edge', 'distribution', 'border'],
    useCases: ['wan', 'campus', 'multisite', 'multicloud'],
    render: (d) => {
      if (!isCisco(d)) return null
      return `ip sla 1
 icmp-echo <PRIMARY-NEXTHOP> source-interface <WAN-PRIMARY>
 frequency 5
ip sla schedule 1 life forever start-time now
track 1 ip sla 1 reachability
! Primary with tracking, backup floating static (AD 200):
ip route 0.0.0.0 0.0.0.0 <PRIMARY-NEXTHOP> track 1
ip route 0.0.0.0 0.0.0.0 <BACKUP-NEXTHOP> 200`
    },
  },

  // ════════════════════════════════ QoS & VOICE ═══════════════════════════════
  {
    id: 'qos',
    label: 'QoS Marking & Queuing',
    icon: '📶',
    category: 'QoS & Voice',
    description: 'DSCP trust, traffic classification, and egress queuing (campus/DC)',
    appliesTo: ['access', 'distribution', 'leaf', 'spine'],
    render: (d, uc) => {
      if (uc === 'gpu') return null // GPU uses dedicated RoCEv2/PFC QoS in base config
      if (!isCisco(d)) return null
      return `class-map match-any CM-VOICE
 match dscp ef
class-map match-any CM-VIDEO
 match dscp af41
class-map match-any CM-CRITICAL-DATA
 match dscp af31
policy-map PM-QOS-OUT
 class CM-VOICE
  priority percent 10
 class CM-VIDEO
  bandwidth percent 20
 class CM-CRITICAL-DATA
  bandwidth percent 25
 class class-default
  bandwidth percent 45
  random-detect dscp-based
! Trust + apply on uplinks:
interface range <UPLINK-PORTS>
 service-policy output PM-QOS-OUT`
    },
  },
  {
    id: 'voice',
    label: 'Voice VLAN + LLDP-MED',
    icon: '☎️',
    category: 'QoS & Voice',
    description: 'IP-phone voice VLAN, LLDP-MED, CoS/DSCP trust, and PoE on access ports',
    appliesTo: ACCESS_ROLES,
    useCases: ['campus', 'multisite'],
    render: (d) => {
      if (!isCisco(d)) return null
      return `! Voice VLAN auto-provisions IP phones via LLDP-MED / CDP:
interface range <ACCESS-PORTS>
 switchport mode access
 switchport access vlan 10
 switchport voice vlan 20
 trust device cisco-phone
 mls qos trust dscp
 power inline auto
 spanning-tree portfast
 lldp med-tlv-select network-policy
network-policy profile 1
 voice vlan 20 cos 5
 voice signaling vlan 20 cos 3`
    },
  },
]

// ── Application ─────────────────────────────────────────────────────────────────

/** Policies that apply to a given device + use case, in catalog order. */
export function applicablePolicies(
  dev: BOMDevice,
  useCase: UseCase | '',
  selectedIds: string[],
): PolicyDef[] {
  const sel = new Set(selectedIds)
  return POLICY_CATALOG.filter(p => {
    if (!sel.has(p.id)) return false
    if (p.useCases && useCase && !p.useCases.includes(useCase as UseCase)) return false
    const roleOk = p.appliesTo.includes('*') || roleIn(dev, p.appliesTo)
    if (!roleOk) return false
    // render returns null when not applicable to this platform/role
    return p.render(dev, useCase) != null
  })
}

/**
 * Append selected policy overlay sections to a base device config.
 * Each policy renders as its own `! ====== POLICY: <LABEL> ======` section so
 * it shows up individually in the Step-3 section navigator.
 */
export function applyPolicies(
  baseConfig: string,
  dev: BOMDevice,
  useCase: UseCase | '',
  selectedIds: string[],
): string {
  if (!selectedIds.length) return baseConfig
  const policies = applicablePolicies(dev, useCase, selectedIds)
  if (!policies.length) return baseConfig

  const blocks = policies.map(p => {
    const cli = p.render(dev, useCase) ?? ''
    return `! ====== POLICY: ${p.label.toUpperCase()} ======\n! ${p.description}\n${cli}`
  })

  return `${baseConfig.trimEnd()}\n\n! ╔══════════════════════════════════════════════════════════════╗
! ║  POLICY OVERLAY — ${policies.length} selected polic${policies.length === 1 ? 'y' : 'ies'} applied to this device
! ╚══════════════════════════════════════════════════════════════╝\n\n${blocks.join('\n\n')}\n`
}

/** Group catalog by category for UI rendering. */
export function policyByCategory(): Record<PolicyCategory, PolicyDef[]> {
  const out = {} as Record<PolicyCategory, PolicyDef[]>
  for (const p of POLICY_CATALOG) {
    ;(out[p.category] ||= []).push(p)
  }
  return out
}

export const POLICY_CATEGORIES: PolicyCategory[] = [
  'Management',
  'Security',
  'L2 Switching',
  'L3 Routing',
  'QoS & Voice',
]
