"""
NetDesign AI — Monitoring & Troubleshooting Engine
====================================================
80+ issue taxonomy across 11 categories.
Each issue has: symptoms, root_causes, diagnostic_commands (per-platform),
remediation_steps, verification_commands, severity, affected_layers.

Public API:
    diagnose(state, symptoms)  → list of ranked DiagnosticMatch
    health_check(state)        → HealthReport
    get_issue(issue_id)        → Issue dict
    list_categories()          → list of category names
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DiagnosticMatch:
    issue_id:   str
    name:       str
    category:   str
    severity:   str
    score:      float          # 0-1 match confidence
    root_causes: list[str]
    commands:   dict[str, list[str]]   # platform → CLI list
    remediation: list[str]
    verification: dict[str, list[str]]
    tags:       list[str]

@dataclass
class HealthItem:
    check:    str
    status:   str   # "pass" | "warn" | "fail"
    message:  str
    issue_id: str = ""

@dataclass
class HealthReport:
    overall:  str            # "healthy" | "degraded" | "critical"
    score:    int            # 0-100
    items:    list[HealthItem] = field(default_factory=list)
    summary:  str = ""

# ─────────────────────────────────────────────────────────────────────────────
# Issue registry — 80+ entries
# ─────────────────────────────────────────────────────────────────────────────
# fmt: off
ISSUES: dict[str, dict] = {

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: L2 / VLAN
# ══════════════════════════════════════════════════════════════════════════════

"VLAN_MISMATCH": {
    "name": "VLAN Mismatch",
    "category": "l2_vlan",
    "severity": "high",
    "affected_layers": ["L2"],
    "symptoms": [
        "vlan mismatch", "hosts in same vlan cannot communicate",
        "traffic not passing between ports", "mac not learned",
        "access vlan wrong", "trunk vlan missing",
    ],
    "root_causes": [
        "Access port configured with wrong VLAN ID",
        "VLAN not allowed on trunk link",
        "VLAN exists on one switch but not the other (VLAN DB mismatch)",
        "VTP domain mismatch pruning the VLAN",
    ],
    "diagnostic_commands": {
        "nxos":  ["show vlan id <vlan>", "show int <intf> trunk", "show vlan brief", "show mac address-table vlan <vlan>"],
        "eos":   ["show vlan <vlan>", "show interfaces <intf> trunk", "show vlan brief", "show mac address-table vlan <vlan>"],
        "iosxe": ["show vlan id <vlan>", "show interfaces <intf> trunk", "show vlan brief", "show mac address-table vlan <vlan>"],
        "sonic": ["show vlan brief", "show interfaces status", "bridge fdb show"],
    },
    "remediation_steps": [
        "1. Confirm intended VLAN on both ends: `show vlan brief`",
        "2. On access port: `switchport access vlan <correct-vlan>`",
        "3. On trunk port: `switchport trunk allowed vlan add <vlan>`",
        "4. Verify VLAN exists in VLAN DB on both switches; create if missing: `vlan <id>`",
        "5. Check VTP mode — if transparent, VLAN DB is local only",
    ],
    "verification_commands": {
        "nxos":  ["show vlan id <vlan>", "show int <intf> switchport", "ping vrf <vrf> <host>"],
        "eos":   ["show vlan <vlan>", "show interfaces <intf> switchport", "ping vrf <vrf> <host>"],
        "iosxe": ["show vlan id <vlan>", "show int <intf> switchport"],
    },
    "tags": ["l2", "vlan", "access", "trunk", "switching"],
},

"NATIVE_VLAN_MISMATCH": {
    "name": "Native VLAN Mismatch (802.1Q)",
    "category": "l2_vlan",
    "severity": "medium",
    "affected_layers": ["L2"],
    "symptoms": [
        "native vlan mismatch", "cdp native vlan mismatch", "stp inconsistency",
        "untagged traffic in wrong vlan", "vlan hopping risk",
    ],
    "root_causes": [
        "Native VLAN configured differently on both ends of trunk",
        "One end is access port, other is trunk (mode mismatch)",
        "Native VLAN not consistent after VLAN DB change",
    ],
    "diagnostic_commands": {
        "nxos":  ["show int <intf> trunk", "show cdp neighbors detail", "show spanning-tree inconsistentports"],
        "eos":   ["show interfaces <intf> trunk", "show lldp neighbors detail"],
        "iosxe": ["show int <intf> trunk", "show cdp neighbors detail", "show spanning-tree inconsistentports"],
    },
    "remediation_steps": [
        "1. Identify native VLAN on both ends: `show interfaces <intf> trunk`",
        "2. Align native VLAN: `switchport trunk native vlan <same-vlan>`",
        "3. Best practice: use a dedicated unused VLAN as native (e.g. VLAN 999)",
        "4. Or tag native VLAN: `vlan dot1q tag native` (global, NX-OS/EOS)",
    ],
    "verification_commands": {
        "nxos":  ["show int <intf> trunk", "show spanning-tree vlan <vlan>"],
        "eos":   ["show interfaces <intf> trunk"],
        "iosxe": ["show int <intf> trunk"],
    },
    "tags": ["l2", "vlan", "native", "trunk", "802.1q"],
},

"STP_TOPOLOGY_CHANGE": {
    "name": "Spanning Tree Topology Change Storm",
    "category": "l2_vlan",
    "severity": "high",
    "affected_layers": ["L2"],
    "symptoms": [
        "mac table flushing", "stp topology change", "tc bpdu flood",
        "intermittent connectivity", "high cpu from stp", "mac flapping",
    ],
    "root_causes": [
        "Edge port (server-facing) not configured as PortFast — generates TC on link up/down",
        "BPDU from unauthorised switch triggering topology change",
        "Physical link flapping on trunk port",
        "vPC peer-link or MLAG ISL instability",
    ],
    "diagnostic_commands": {
        "nxos":  ["show spanning-tree detail | grep 'topology change'", "show spanning-tree vlan <vlan> detail", "show spanning-tree counters vlan <vlan>"],
        "eos":   ["show spanning-tree topology change detail", "show spanning-tree vlan <vlan> detail"],
        "iosxe": ["show spanning-tree detail | inc topology", "show spanning-tree vlan <vlan> detail"],
    },
    "remediation_steps": [
        "1. Enable PortFast on all edge/server-facing ports: `spanning-tree portfast`",
        "2. Enable BPDU Guard on PortFast ports: `spanning-tree bpduguard enable`",
        "3. Check for rogue switches: `show cdp/lldp neighbors` on edge ports",
        "4. If vPC: verify peer-link health: `show vpc`",
        "5. Consider MSTP with topology-change guard: `spanning-tree guard root`",
    ],
    "verification_commands": {
        "nxos":  ["show spanning-tree detail | grep 'topology change'"],
        "eos":   ["show spanning-tree topology change detail"],
        "iosxe": ["show spanning-tree detail | inc topology"],
    },
    "tags": ["l2", "stp", "topology-change", "portfast", "bpduguard"],
},

"PORT_ERRORDISABLED": {
    "name": "Port in err-disabled State",
    "category": "l2_vlan",
    "severity": "high",
    "affected_layers": ["L1", "L2"],
    "symptoms": [
        "port err-disabled", "interface error-disabled", "bpduguard violation",
        "port security violation", "interface stuck down", "errdisable",
    ],
    "root_causes": [
        "BPDU Guard triggered — switch connected to PortFast port",
        "Port Security violation — MAC limit exceeded",
        "UDLD unidirectional link detected",
        "DHCP snooping rate-limit exceeded",
        "Loop guard triggered",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface status err-disabled", "show errdisable recovery", "show errdisable detect"],
        "eos":   ["show interfaces status err-disabled", "show errdisable"],
        "iosxe": ["show interfaces status err-disabled", "show errdisable recovery", "show errdisable detect"],
    },
    "remediation_steps": [
        "1. Identify cause: `show errdisable detect` / `show log | grep errdisable`",
        "2. Remediate root cause (remove rogue switch, fix port security, etc.)",
        "3. Re-enable: `shutdown` then `no shutdown` on interface",
        "4. Or auto-recover: `errdisable recovery cause <reason>` + `errdisable recovery interval 300`",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> status", "show log last 20"],
        "eos":   ["show interfaces <intf> status"],
        "iosxe": ["show interface <intf> status"],
    },
    "tags": ["l2", "errdisable", "portfast", "bpduguard", "port-security"],
},

"MAC_TABLE_EXHAUSTION": {
    "name": "MAC Table Exhaustion",
    "category": "l2_vlan",
    "severity": "medium",
    "affected_layers": ["L2"],
    "symptoms": [
        "mac table full", "unicast flooding", "broadcast storm",
        "high bandwidth on all ports", "mac limit exceeded",
    ],
    "root_causes": [
        "Too many hosts in a flat L2 domain — exceeded TCAM capacity",
        "MAC spoofing / MAC randomisation flooding table",
        "Misconfigured VM mobility generating many source MACs",
    ],
    "diagnostic_commands": {
        "nxos":  ["show mac address-table count", "show hardware capacity forwarding", "show mac address-table aging-time"],
        "eos":   ["show mac address-table count", "show platform trident forwarding-table utilization"],
        "iosxe": ["show mac address-table count", "show platform resources"],
    },
    "remediation_steps": [
        "1. Check table utilisation: `show mac address-table count`",
        "2. Reduce L2 domain size — break into smaller VLANs with L3 boundaries",
        "3. Enable MAC learning limit per port: `mac-address-table limit`",
        "4. Investigate MAC randomisation on VMs/endpoints",
    ],
    "verification_commands": {
        "nxos":  ["show mac address-table count"],
        "eos":   ["show mac address-table count"],
        "iosxe": ["show mac address-table count"],
    },
    "tags": ["l2", "mac", "tcam", "flooding", "capacity"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: L3 / ROUTING
# ══════════════════════════════════════════════════════════════════════════════

"ROUTE_MISSING": {
    "name": "Expected Route Missing from RIB",
    "category": "l3_routing",
    "severity": "critical",
    "affected_layers": ["L3"],
    "symptoms": [
        "route missing", "prefix not in routing table", "route not advertised",
        "route not received", "destination unreachable", "traffic black-holed",
        "no route to host",
    ],
    "root_causes": [
        "Route filtered by inbound or outbound route-map / prefix-list",
        "BGP/OSPF/ISIS neighbour not established",
        "Network statement or redistribute missing",
        "Route suppressed by summary (auto-summary or manual aggregate)",
        "Route withdrawn by originating device",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip route <prefix>", "show bgp ipv4 unicast <prefix>", "show ip bgp neighbors <peer> advertised-routes | inc <prefix>", "show ip bgp neighbors <peer> received-routes | inc <prefix>"],
        "eos":   ["show ip route <prefix>", "show bgp ipv4 unicast <prefix>", "show bgp neighbors <peer> advertised-routes", "show bgp neighbors <peer> received-routes"],
        "iosxe": ["show ip route <prefix>", "show bgp ipv4 unicast <prefix>", "show ip bgp neighbors <peer> advertised-routes"],
        "sonic": ["vtysh -c 'show ip route <prefix>'", "vtysh -c 'show bgp ipv4 unicast <prefix>'"],
    },
    "remediation_steps": [
        "1. Confirm route exists on originating device: `show ip route <prefix>`",
        "2. Check outbound filter on sender: `show ip bgp neighbors <peer> advertised-routes | inc <prefix>`",
        "3. Check inbound filter on receiver: `show ip bgp neighbors <peer> received-routes | inc <prefix>`",
        "4. Inspect route-map: `show route-map <name>`",
        "5. Inspect prefix-list: `show ip prefix-list <name>`",
        "6. If OSPF: verify area type, LSA present: `show ospf database`",
    ],
    "verification_commands": {
        "nxos":  ["show ip route <prefix>", "show bgp ipv4 unicast <prefix>"],
        "eos":   ["show ip route <prefix>", "show bgp ipv4 unicast <prefix>"],
        "iosxe": ["show ip route <prefix>"],
    },
    "tags": ["l3", "routing", "bgp", "ospf", "prefix", "route-map", "prefix-list"],
},

"ROUTE_BLACKHOLE": {
    "name": "Black-Hole Route (Null or Unreachable Next-Hop)",
    "category": "l3_routing",
    "severity": "critical",
    "affected_layers": ["L3"],
    "symptoms": [
        "traffic dropped silently", "route exists but traffic not forwarded",
        "null route", "discard route", "next hop unreachable", "ping fails route exists",
    ],
    "root_causes": [
        "Aggregate/summary route pointing to Null0 (discard aggregate)",
        "BGP next-hop not resolvable in underlay",
        "Static route with unavailable next-hop",
        "ECMP member with failed next-hop still in FIB",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip route <prefix>", "show ip route <next-hop>", "show forwarding ipv4 route <prefix>", "show ip bgp <prefix> | grep 'Next Hop'"],
        "eos":   ["show ip route <prefix>", "show ip route <next-hop>", "show ip bgp <prefix>", "show platform fib route <prefix>"],
        "iosxe": ["show ip route <prefix>", "show ip cef <prefix>", "show ip bgp <prefix>"],
        "sonic": ["vtysh -c 'show ip route <prefix>'", "ip route show <prefix>"],
    },
    "remediation_steps": [
        "1. Check RIB: `show ip route <prefix>` — look for 'via Null0' or unreachable",
        "2. Verify next-hop reachability: `show ip route <next-hop>`",
        "3. For BGP: ensure next-hop is resolved in underlay (OSPF/ISIS loopback route)",
        "4. Remove or fix static discard route",
        "5. For aggregate: add `summary-only` to suppress more-specifics if intended",
    ],
    "verification_commands": {
        "nxos":  ["show ip route <prefix>", "ping <dest> source <src>"],
        "eos":   ["show ip route <prefix>", "ping <dest> source <src>"],
        "iosxe": ["show ip route <prefix>", "ping <dest> source <src>"],
    },
    "tags": ["l3", "routing", "null0", "blackhole", "next-hop", "aggregate"],
},

"ASYMMETRIC_ROUTING": {
    "name": "Asymmetric Routing",
    "category": "l3_routing",
    "severity": "medium",
    "affected_layers": ["L3"],
    "symptoms": [
        "asymmetric routing", "return path different", "stateful firewall dropping",
        "tcp session reset", "one-way traffic", "urpf drops", "nat asymmetry",
    ],
    "root_causes": [
        "Different metrics/preferences for same prefix on forward vs return path",
        "uRPF strict mode dropping asymmetric return traffic",
        "Policy-based routing (PBR) applied on one direction only",
        "ECMP hashing sending flows on different paths",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip route <src>", "show ip route <dst>", "traceroute <dst> source <src>", "show ip interface <intf> | grep uRPF"],
        "eos":   ["show ip route <src>", "show ip route <dst>", "traceroute <dst> source <src>"],
        "iosxe": ["show ip route <src>", "show ip route <dst>", "traceroute <dst> source <src>", "show ip interface <intf>"],
    },
    "remediation_steps": [
        "1. Trace both directions: `traceroute <dst> source <src>` and reverse",
        "2. If uRPF: consider `ip verify unicast source reachable-via any` (loose mode)",
        "3. Align routing metrics/preferences on both paths",
        "4. If stateful FW: ensure symmetric routing or configure active/standby FW with state sync",
    ],
    "verification_commands": {
        "nxos":  ["traceroute <dst> source <src>"],
        "eos":   ["traceroute <dst> source <src>"],
        "iosxe": ["traceroute <dst> source <src>"],
    },
    "tags": ["l3", "routing", "asymmetric", "urpf", "ecmp", "firewall"],
},

"NO_DEFAULT_ROUTE": {
    "name": "Missing Default Route",
    "category": "l3_routing",
    "severity": "high",
    "affected_layers": ["L3"],
    "symptoms": [
        "no default route", "internet not reachable", "0.0.0.0/0 missing",
        "external traffic dropped", "default gateway missing",
    ],
    "root_causes": [
        "Default route not redistributed into IGP",
        "BGP default-originate not configured on edge",
        "Static default route pointing to failed next-hop",
        "VRF missing default route (inter-VRF leaking not configured)",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip route 0.0.0.0/0", "show bgp ipv4 unicast 0.0.0.0/0", "show ip ospf database external | grep 0.0.0.0"],
        "eos":   ["show ip route 0.0.0.0/0", "show bgp ipv4 unicast 0.0.0.0/0"],
        "iosxe": ["show ip route 0.0.0.0", "show bgp ipv4 unicast 0.0.0.0"],
        "sonic": ["vtysh -c 'show ip route 0.0.0.0/0'"],
    },
    "remediation_steps": [
        "1. Check default route: `show ip route 0.0.0.0/0`",
        "2. BGP: add `default-originate` on edge router toward internal peers",
        "3. OSPF: `default-information originate always` on ASBR",
        "4. Static: `ip route 0.0.0.0/0 <next-hop>` with tracking",
    ],
    "verification_commands": {
        "nxos":  ["show ip route 0.0.0.0/0", "ping 8.8.8.8 vrf <vrf>"],
        "eos":   ["show ip route 0.0.0.0/0", "ping 8.8.8.8"],
        "iosxe": ["show ip route 0.0.0.0"],
    },
    "tags": ["l3", "routing", "default-route", "bgp", "ospf", "internet"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: BGP
# ══════════════════════════════════════════════════════════════════════════════

"BGP_NEIGHBOR_DOWN": {
    "name": "BGP Neighbor Not Established",
    "category": "bgp",
    "severity": "critical",
    "affected_layers": ["L3", "Control-Plane"],
    "symptoms": [
        "bgp neighbor down", "bgp session not established", "bgp idle",
        "bgp active state", "bgp opensent stuck", "bgp hold timer expired",
        "bgp connection refused", "bgp peer not reachable",
    ],
    "root_causes": [
        "TCP port 179 blocked by ACL or firewall",
        "BGP neighbor IP or remote-AS misconfigured",
        "Loopback not advertised in underlay (iBGP sessions)",
        "MD5 authentication password mismatch",
        "TTL security (GTSM) hop-count misconfigured",
        "Interface/route to peer is down",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp neighbors <peer>", "show bgp summary", "show ip route <peer-loopback>", "debug ip bgp <peer> events"],
        "eos":   ["show bgp neighbors <peer>", "show bgp summary", "show ip route <peer-loopback>"],
        "iosxe": ["show bgp neighbors <peer>", "show bgp summary", "show ip route <peer>"],
        "sonic": ["vtysh -c 'show bgp neighbors <peer>'", "vtysh -c 'show bgp summary'"],
        "junos": ["show bgp neighbor <peer>", "show bgp summary"],
    },
    "remediation_steps": [
        "1. Check session state: `show bgp neighbors <peer>` — note Last Error",
        "2. Verify reachability: `ping <peer-loopback>` from correct source interface",
        "3. Check remote-as matches: `show bgp neighbors | grep remote`",
        "4. Test TCP 179: `telnet <peer> 179`",
        "5. Check ACLs on management path: `show ip access-lists`",
        "6. If MD5: verify password matches on both sides",
        "7. If GTSM: `neighbor <peer> ttl-security hops <n>` must match",
    ],
    "verification_commands": {
        "nxos":  ["show bgp neighbors <peer> | grep state", "show bgp summary | grep <peer>"],
        "eos":   ["show bgp neighbors <peer> | grep state", "show bgp summary"],
        "iosxe": ["show bgp neighbors <peer> | include state"],
        "sonic": ["vtysh -c 'show bgp summary'"],
    },
    "tags": ["bgp", "neighbor", "session", "tcp179", "auth", "gtsm", "ibgp", "ebgp"],
},

"BGP_PREFIX_NOT_SENT": {
    "name": "BGP Prefix Not Advertised to Peer",
    "category": "bgp",
    "severity": "high",
    "affected_layers": ["L3", "Control-Plane"],
    "symptoms": [
        "route not advertised", "prefix not sent", "bgp not advertising",
        "missing from neighbor advertised routes", "outbound filter dropping",
    ],
    "root_causes": [
        "Outbound route-map denying the prefix",
        "Outbound prefix-list filtering the prefix",
        "Prefix not in BGP local RIB (not installed / not best)",
        "next-hop-self not configured for iBGP reflector",
        "Split-horizon preventing advertisement back to iBGP client",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp neighbors <peer> advertised-routes", "show bgp ipv4 unicast <prefix>", "show route-map <name>", "show ip prefix-list <name>"],
        "eos":   ["show bgp neighbors <peer> advertised-routes", "show bgp ipv4 unicast <prefix>", "show route-map <name>"],
        "iosxe": ["show bgp neighbors <peer> advertised-routes | inc <prefix>", "show bgp ipv4 unicast <prefix>"],
        "sonic": ["vtysh -c 'show bgp neighbors <peer> advertised-routes'"],
    },
    "remediation_steps": [
        "1. Check if prefix is in BGP RIB as best: `show bgp ipv4 unicast <prefix>`",
        "2. Check outbound route-map: `show bgp neighbors <peer> | grep route-map`",
        "3. Trace route-map evaluation: `debug ip bgp <peer> updates out`",
        "4. For iBGP: ensure `next-hop-self` on RR or add `neighbor <peer> next-hop-self`",
        "5. For redistribution: verify `redistribute <proto> route-map <name>`",
    ],
    "verification_commands": {
        "nxos":  ["show bgp neighbors <peer> advertised-routes | inc <prefix>"],
        "eos":   ["show bgp neighbors <peer> advertised-routes | grep <prefix>"],
        "iosxe": ["show bgp neighbors <peer> advertised-routes | inc <prefix>"],
    },
    "tags": ["bgp", "prefix", "outbound", "route-map", "prefix-list", "advertisement"],
},

"BGP_MAX_PREFIX": {
    "name": "BGP Max-Prefix Limit Exceeded",
    "category": "bgp",
    "severity": "high",
    "affected_layers": ["L3", "Control-Plane"],
    "symptoms": [
        "max prefix", "bgp session torn down", "prefix limit exceeded",
        "neighbor maximum-prefix", "session reset max-prefix",
    ],
    "root_causes": [
        "Peer sending more prefixes than the configured maximum",
        "Route leak from full Internet table into internal session",
        "max-prefix threshold set too low",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp neighbors <peer> | grep 'maximum-prefix'", "show bgp summary", "show log | grep max-prefix"],
        "eos":   ["show bgp neighbors <peer> | grep maximum", "show bgp summary", "show log | grep maximum"],
        "iosxe": ["show bgp neighbors <peer> | inc maximum", "show bgp summary"],
    },
    "remediation_steps": [
        "1. Check current count: `show bgp neighbors <peer>` → Prefixes Received",
        "2. If legitimate growth: `neighbor <peer> maximum-prefix <new-limit> <threshold>`",
        "3. If leak: investigate outbound policy on sending side",
        "4. Reset session after fix: `clear ip bgp <peer> soft`",
    ],
    "verification_commands": {
        "nxos":  ["show bgp summary | grep <peer>"],
        "eos":   ["show bgp summary | grep <peer>"],
        "iosxe": ["show bgp summary | inc <peer>"],
    },
    "tags": ["bgp", "max-prefix", "session-reset", "prefix-limit"],
},

"BGP_AS_PATH_LOOP": {
    "name": "BGP AS-Path Loop (Own ASN in Path)",
    "category": "bgp",
    "severity": "medium",
    "affected_layers": ["L3", "Control-Plane"],
    "symptoms": [
        "route not installed as loop", "as path contains local as",
        "bgp loop prevention", "route received but not best",
    ],
    "root_causes": [
        "eBGP route received with own ASN in AS_PATH (loop prevention working correctly)",
        "Route confederation mis-configuration causing false loop detection",
        "allow-as-in not configured for intended multi-homed scenarios",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp ipv4 unicast <prefix>", "show bgp neighbors <peer> received-routes | inc <prefix>"],
        "eos":   ["show bgp ipv4 unicast <prefix>", "show bgp neighbors <peer> received-routes"],
        "iosxe": ["show bgp ipv4 unicast <prefix>", "show bgp neighbors <peer> received-routes | inc <prefix>"],
    },
    "remediation_steps": [
        "1. Verify AS numbers are correctly assigned",
        "2. For intentional multi-homed loop: `neighbor <peer> allowas-in <count>`",
        "3. For confederation: verify confederation peers and sub-AS numbers",
    ],
    "verification_commands": {
        "nxos":  ["show bgp ipv4 unicast <prefix>"],
        "eos":   ["show bgp ipv4 unicast <prefix>"],
        "iosxe": ["show bgp ipv4 unicast <prefix>"],
    },
    "tags": ["bgp", "as-path", "loop", "allowas-in", "confederation"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: EVPN
# ══════════════════════════════════════════════════════════════════════════════

"EVPN_TYPE2_MISSING": {
    "name": "EVPN Type-2 Route Missing (MAC/IP)",
    "category": "evpn",
    "severity": "critical",
    "affected_layers": ["L2", "L3", "Overlay"],
    "symptoms": [
        "evpn type-2 missing", "mac not in evpn table", "arp not suppressed",
        "host not reachable across vxlan", "mac ip route missing",
        "endpoint not in bgp evpn",
    ],
    "root_causes": [
        "VTEP not configured for the VLAN/VNI",
        "BGP EVPN session not established to RR",
        "MAC address not learned locally on VTEP",
        "ARP suppression not enabled — type-2 with IP not generated",
        "Route-target mismatch — route not imported on remote VTEP",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp l2vpn evpn type-2 | grep <mac>", "show l2route evpn mac-ip all", "show nve peers", "show nve vni"],
        "eos":   ["show bgp evpn route-type mac-ip", "show evpn mac-ip detail", "show vxlan address-table"],
        "sonic": ["vtysh -c 'show bgp l2vpn evpn'", "bridge fdb show", "ip neigh show"],
    },
    "remediation_steps": [
        "1. Verify MAC learned locally: `show mac address-table vlan <vlan>`",
        "2. Check BGP EVPN session to RR: `show bgp summary`",
        "3. Check VNI is configured and up: `show nve vni` / `show vxlan vni`",
        "4. Verify RT import/export matches remote VTEP: `show bgp l2vpn evpn route-type mac-ip <mac>`",
        "5. Enable ARP suppression if not set: `ip arp suppression` under NVE VNI",
    ],
    "verification_commands": {
        "nxos":  ["show bgp l2vpn evpn type-2 | grep <mac>", "ping <host-ip> vrf <vrf>"],
        "eos":   ["show bgp evpn route-type mac-ip | grep <mac>", "ping vrf <vrf> <host-ip>"],
    },
    "tags": ["evpn", "type-2", "mac", "ip", "vtep", "vxlan", "arp-suppression"],
},

"EVPN_TYPE3_MISSING": {
    "name": "EVPN Type-3 IMET Route Missing (BUM Traffic)",
    "category": "evpn",
    "severity": "high",
    "affected_layers": ["L2", "Overlay"],
    "symptoms": [
        "evpn type-3 missing", "imet route missing", "bum traffic not flooding",
        "broadcast not reaching remote vtep", "arp not working across fabric",
        "multicast/broadcast issue vxlan",
    ],
    "root_causes": [
        "NVE interface not operational",
        "BGP EVPN session not established",
        "VNI not configured under NVE for the VLAN",
        "Ingress replication list incomplete",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp l2vpn evpn type-3", "show nve vni", "show nve peers", "show interface nve1"],
        "eos":   ["show bgp evpn route-type imet", "show vxlan vni", "show vxlan vtep"],
        "sonic": ["vtysh -c 'show bgp l2vpn evpn route-type 3'", "vtysh -c 'show evpn vni detail'"],
    },
    "remediation_steps": [
        "1. Check NVE interface is up: `show interface nve1`",
        "2. Check BGP EVPN session: `show bgp summary`",
        "3. Verify VNI is in NVE VNI list: `show nve vni`",
        "4. Check IMET route on remote: `show bgp l2vpn evpn type-3 | grep <vtep-ip>`",
        "5. If multicast underlay: verify PIM adjacency and RP reachability",
    ],
    "verification_commands": {
        "nxos":  ["show bgp l2vpn evpn type-3", "show nve peers"],
        "eos":   ["show bgp evpn route-type imet", "show vxlan vtep"],
    },
    "tags": ["evpn", "type-3", "imet", "bum", "flood-and-learn", "vxlan", "nve"],
},

"EVPN_TYPE5_MISSING": {
    "name": "EVPN Type-5 IP Prefix Route Missing (Inter-VRF Routing)",
    "category": "evpn",
    "severity": "critical",
    "affected_layers": ["L3", "Overlay"],
    "symptoms": [
        "evpn type-5 missing", "ip prefix route missing", "inter-vrf routing broken",
        "vrf to vrf not working", "type5 route absent", "host route not advertised",
    ],
    "root_causes": [
        "L3VNI not configured on VTEP for the VRF",
        "VRF missing `advertise l2vpn evpn` under BGP",
        "Route-target mismatch for L3VNI",
        "No IP address on SVI (anycast gateway) for the VRF",
        "redistribute connected missing under BGP VRF AF",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp l2vpn evpn type-5", "show vrf <vrf>", "show nve vni", "show bgp vrf <vrf> ipv4 unicast"],
        "eos":   ["show bgp evpn route-type ip-prefix ipv4", "show vxlan vni", "show bgp evpn detail"],
        "sonic": ["vtysh -c 'show bgp l2vpn evpn route-type 5'", "vtysh -c 'show evpn vni detail'"],
    },
    "remediation_steps": [
        "1. Verify L3VNI configured: `show nve vni` — VRF should show L3VNI",
        "2. Check BGP VRF AF: `show bgp vrf <vrf> ipv4 unicast`",
        "3. Add if missing: `address-family ipv4 unicast` under `vrf <vrf>` in BGP, add `advertise l2vpn evpn`",
        "4. Verify RT import/export: `show bgp l2vpn evpn type-5 | grep RT`",
        "5. Check SVI has anycast IP: `show interface vlan <l3vni-vlan>`",
    ],
    "verification_commands": {
        "nxos":  ["show bgp l2vpn evpn type-5 | grep <prefix>", "ping <remote-vrf-host> vrf <vrf>"],
        "eos":   ["show bgp evpn route-type ip-prefix ipv4 | grep <prefix>"],
    },
    "tags": ["evpn", "type-5", "l3vni", "vrf", "inter-vrf", "ip-prefix", "symmetric-irb"],
},

"EVPN_RT_MISMATCH": {
    "name": "EVPN Route-Target Import/Export Mismatch",
    "category": "evpn",
    "severity": "critical",
    "affected_layers": ["L3", "Overlay"],
    "symptoms": [
        "route-target mismatch", "evpn routes not imported", "vni not receiving routes",
        "rt mismatch", "evpn import not working", "routes in bgp but not in vrf",
    ],
    "root_causes": [
        "RT export on sender does not match RT import on receiver",
        "Auto-derived RT differs between VTEPs (different AS or VNI base)",
        "Manual RT configured on some VTEPs but not others",
        "L2VNI RT and L3VNI RT transposed",
    ],
    "diagnostic_commands": {
        "nxos":  ["show bgp l2vpn evpn <prefix> detail | grep 'Extended Community'", "show nve vni detail", "show vrf <vrf> detail"],
        "eos":   ["show bgp evpn detail | grep -A5 'Route Target'", "show vxlan vni detail"],
        "sonic": ["vtysh -c 'show bgp l2vpn evpn detail'"],
    },
    "remediation_steps": [
        "1. Show RT on sender: `show bgp l2vpn evpn <prefix> detail | grep RT`",
        "2. Show RT import on receiver: `show vrf <vrf> detail | grep import`",
        "3. Align RTs — either use auto-derived (same AS:VNI) or manually match",
        "4. NX-OS: `vni <vni> l2 / rd auto / route-target import auto / route-target export auto`",
        "5. After change: `clear bgp l2vpn evpn * soft` to re-import",
    ],
    "verification_commands": {
        "nxos":  ["show bgp l2vpn evpn type-2", "show l2route evpn mac all"],
        "eos":   ["show bgp evpn route-type mac-ip"],
    },
    "tags": ["evpn", "route-target", "rt", "import", "export", "vni", "vrf"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: VXLAN / VTEP
# ══════════════════════════════════════════════════════════════════════════════

"VTEP_UNREACHABLE": {
    "name": "VTEP IP Not Reachable in Underlay",
    "category": "vxlan_vtep",
    "severity": "critical",
    "affected_layers": ["L3", "Overlay"],
    "symptoms": [
        "vtep unreachable", "nve peer down", "vxlan tunnel down",
        "vtep ip not in routing table", "nve peer not established",
        "remote vtep not reachable",
    ],
    "root_causes": [
        "VTEP loopback IP not redistributed into OSPF/ISIS underlay",
        "BGP next-hop resolution failure (loopback not in RIB)",
        "MTU issue causing fragmentation of VXLAN-encapped packets",
        "Physical connectivity or ECMP hashing issue",
    ],
    "diagnostic_commands": {
        "nxos":  ["show nve peers", "show ip route <vtep-ip>", "ping <vtep-ip> source loopback1", "show interface nve1"],
        "eos":   ["show vxlan vtep", "show ip route <vtep-ip>", "ping <vtep-ip> source loopback1", "show interface Vxlan1"],
        "sonic": ["vtysh -c 'show ip route <vtep-ip>'", "ip link show vxlan0", "bridge fdb show dev vxlan0"],
    },
    "remediation_steps": [
        "1. Check NVE peer state: `show nve peers` — look for 'Up' state",
        "2. Verify VTEP loopback in underlay: `show ip route <vtep-ip>`",
        "3. Ping VTEP from NVE source: `ping <vtep-ip> source loopback1`",
        "4. Check NVE source interface is up: `show interface loopback1`",
        "5. Verify OSPF/ISIS is advertising the loopback: `show ospf database | grep <vtep-ip>`",
        "6. Test VXLAN MTU: ping with 1550-byte payload (VXLAN adds ~50B overhead)",
    ],
    "verification_commands": {
        "nxos":  ["show nve peers", "ping <vtep-ip> source loopback1"],
        "eos":   ["show vxlan vtep", "ping <vtep-ip> source Loopback1"],
        "sonic": ["vtysh -c 'show evpn vni detail'"],
    },
    "tags": ["vxlan", "vtep", "nve", "underlay", "loopback", "tunnel"],
},

"VNI_MISMATCH": {
    "name": "VNI Mismatch Between VTEPs",
    "category": "vxlan_vtep",
    "severity": "critical",
    "affected_layers": ["L2", "Overlay"],
    "symptoms": [
        "vni mismatch", "vxlan decap fail", "traffic drops in vxlan fabric",
        "same vlan different vni", "vni not matching", "vxlan flood not working",
    ],
    "root_causes": [
        "VLAN-to-VNI mapping configured differently on two VTEPs",
        "Manual VNI assignment inconsistency across switches",
        "Template/provisioning error during fabric build",
    ],
    "diagnostic_commands": {
        "nxos":  ["show nve vni", "show running-config | grep vn-segment", "show vlan id <vlan>"],
        "eos":   ["show vxlan vni", "show running-config | grep vni", "show vlan <vlan>"],
        "sonic": ["vtysh -c 'show evpn vni detail'", "bridge vlan show"],
    },
    "remediation_steps": [
        "1. Collect VNI mapping from all VTEPs: `show nve vni` / `show vxlan vni`",
        "2. Identify discrepancy — same VLAN should have identical VNI everywhere",
        "3. Correct mapping: `vn-segment <correct-vni>` under VLAN on offending VTEP",
        "4. NVE: `member vni <correct-vni>` under interface nve1",
        "5. Clear EVPN: `clear bgp l2vpn evpn * soft`",
    ],
    "verification_commands": {
        "nxos":  ["show nve vni", "show bgp l2vpn evpn type-2 | grep <vni>"],
        "eos":   ["show vxlan vni", "show bgp evpn route-type mac-ip"],
    },
    "tags": ["vxlan", "vni", "l2vni", "mismatch", "vtep", "vlan"],
},

"NVE_INTERFACE_DOWN": {
    "name": "NVE/VTEP Interface Down",
    "category": "vxlan_vtep",
    "severity": "critical",
    "affected_layers": ["Overlay"],
    "symptoms": [
        "nve interface down", "vtep interface down", "vxlan interface down",
        "nve1 down", "vxlan1 down", "overlay not operational",
    ],
    "root_causes": [
        "NVE source interface (loopback) is down",
        "BGP EVPN session not established (NVE waits for BGP on some platforms)",
        "`feature nv overlay` not enabled (NX-OS)",
        "VXLAN feature not configured",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface nve1", "show interface loopback1", "show feature | grep nv", "show bgp summary"],
        "eos":   ["show interface Vxlan1", "show interface Loopback1", "show vxlan vni"],
        "sonic": ["ip link show vxlan0", "ip link show lo"],
    },
    "remediation_steps": [
        "1. Check NVE/Vxlan1 interface: `show interface nve1`",
        "2. Ensure source loopback is up: `show interface loopback1`",
        "3. NX-OS: verify `feature nv overlay` is enabled",
        "4. Verify BGP EVPN session is Established (required for NVE to come up on NX-OS)",
        "5. Check NVE config: `show running-config interface nve1`",
    ],
    "verification_commands": {
        "nxos":  ["show interface nve1", "show nve peers"],
        "eos":   ["show interface Vxlan1", "show vxlan vtep"],
    },
    "tags": ["vxlan", "nve", "vtep", "interface", "loopback", "overlay"],
},

"L3VNI_MISSING": {
    "name": "L3VNI Not Configured — Inter-VRF Routing Broken",
    "category": "vxlan_vtep",
    "severity": "critical",
    "affected_layers": ["L3", "Overlay"],
    "symptoms": [
        "l3vni missing", "inter-vrf routing not working", "vrf routing broken",
        "symmetric irb not working", "l3 gateway not responding",
        "vxlan l3 not working", "vrf has no vni",
    ],
    "root_causes": [
        "L3VNI not assigned to VRF: `vni <l3vni> l3` missing",
        "Transit VLAN for L3VNI not created",
        "SVI for L3VNI transit VLAN missing or down",
        "L3VNI not added to NVE VNI list",
    ],
    "diagnostic_commands": {
        "nxos":  ["show nve vni | grep L3", "show vrf <vrf>", "show vlan id <l3vni-vlan>", "show interface vlan <l3vni-vlan>"],
        "eos":   ["show vxlan vni | grep L3", "show interface Vlan <l3vni-vlan>", "show vxlan control-plane"],
        "sonic": ["vtysh -c 'show evpn vni detail'", "ip vrf show"],
    },
    "remediation_steps": [
        "1. Check NVE has L3VNI: `show nve vni | grep L3`",
        "2. Verify VRF has VNI: `vrf context <vrf>` → `vni <l3vni>`",
        "3. Create transit VLAN if missing: `vlan <l3vni-transit-vlan>`",
        "4. Create SVI: `interface vlan <l3vni-transit-vlan>` → `vrf member <vrf>` → `ip forward`",
        "5. Add to NVE: `member vni <l3vni> associate-vrf`",
        "6. BGP: add VRF AF with `advertise l2vpn evpn`",
    ],
    "verification_commands": {
        "nxos":  ["show nve vni | grep L3", "show bgp l2vpn evpn type-5"],
        "eos":   ["show vxlan vni | grep L3", "show bgp evpn route-type ip-prefix"],
    },
    "tags": ["vxlan", "l3vni", "vrf", "symmetric-irb", "overlay", "inter-vrf"],
},

"ANYCAST_GW_NOT_RESPONDING": {
    "name": "Anycast Gateway Not Responding",
    "category": "vxlan_vtep",
    "severity": "high",
    "affected_layers": ["L3"],
    "symptoms": [
        "anycast gateway not responding", "virtual ip not reachable",
        "default gateway unreachable", "svi not responding",
        "ip virtual-router not responding", "fabric anycast-gateway down",
    ],
    "root_causes": [
        "Anycast gateway MAC not configured globally",
        "SVI down or missing IP address",
        "VRF membership missing on SVI",
        "ARP entry for gateway IP not present on host",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface vlan <vlan>", "show ip arp vrf <vrf> | grep <gateway-ip>", "show fabric forwarding anycast-gateway-mac"],
        "eos":   ["show interface Vlan <vlan>", "show arp vrf <vrf>", "show ip virtual-router"],
        "iosxe": ["show interface vlan <vlan>", "show ip arp <gateway-ip>"],
    },
    "remediation_steps": [
        "1. Verify SVI is up: `show interface vlan <vlan>`",
        "2. Check anycast MAC configured: `fabric forwarding anycast-gateway-mac 0000.2222.3333` (NX-OS)",
        "3. Add `fabric forwarding mode anycast-gateway` under SVI",
        "4. EOS: verify `ip virtual-router mac-address` is configured globally",
        "5. Test ARP: `ping <gateway-ip> vrf <vrf>` from attached host",
    ],
    "verification_commands": {
        "nxos":  ["show interface vlan <vlan>", "ping <gateway-ip> vrf <vrf>"],
        "eos":   ["show interface Vlan <vlan>", "ping vrf <vrf> <gateway-ip>"],
    },
    "tags": ["vxlan", "anycast", "gateway", "svi", "arp", "vtep"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: DHCP
# ══════════════════════════════════════════════════════════════════════════════

"DHCP_NO_ADDRESS": {
    "name": "DHCP Client Not Getting IP Address",
    "category": "dhcp",
    "severity": "high",
    "affected_layers": ["L3", "Application"],
    "symptoms": [
        "dhcp not working", "client not getting ip", "dhcp discover no response",
        "apipa address 169.254", "no dhcp offer", "dhcp timeout",
        "dhcp failure", "host cannot get ip address",
    ],
    "root_causes": [
        "DHCP relay (ip helper-address) not configured on SVI",
        "DHCP server unreachable from relay",
        "DHCP pool exhausted",
        "DHCP snooping blocking discover/offer",
        "Wrong VLAN — client in different VLAN than DHCP scope",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface vlan <vlan> | grep helper", "show ip dhcp snooping", "show ip dhcp snooping binding", "show ip dhcp snooping statistics"],
        "eos":   ["show interfaces Vlan <vlan> | grep helper", "show dhcp lease | grep <vlan>"],
        "iosxe": ["show running-config interface vlan <vlan> | grep helper", "show ip dhcp binding", "show ip dhcp pool", "show ip dhcp conflict"],
    },
    "remediation_steps": [
        "1. Check relay config on SVI: `show running-config interface vlan <vlan> | grep helper`",
        "2. Add relay if missing: `ip helper-address <dhcp-server-ip>`",
        "3. Verify DHCP server reachable: `ping <dhcp-server-ip> vrf <vrf>`",
        "4. Check pool: `show ip dhcp pool` — verify addresses available",
        "5. Check snooping stats for drops: `show ip dhcp snooping statistics`",
        "6. Verify client VLAN matches DHCP scope subnet",
    ],
    "verification_commands": {
        "nxos":  ["show ip dhcp snooping binding | grep <client-mac>"],
        "eos":   ["show dhcp lease"],
        "iosxe": ["show ip dhcp binding | grep <client-ip>"],
    },
    "tags": ["dhcp", "relay", "helper-address", "snooping", "pool", "client"],
},

"DHCP_SNOOPING_DROP": {
    "name": "DHCP Snooping Dropping Legitimate Packets",
    "category": "dhcp",
    "severity": "high",
    "affected_layers": ["L2", "L3"],
    "symptoms": [
        "dhcp snooping drop", "dhcp offer dropped", "untrusted port dropping dhcp",
        "dhcp server on untrusted port", "dhcp snooping blocking", "dhcp not working snooping",
    ],
    "root_causes": [
        "DHCP server connected to untrusted port — offers dropped",
        "Rate limit too aggressive on DHCP snooping port",
        "Option-82 insertion causing server to reject offer",
        "Port not in correct VLAN for binding check",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip dhcp snooping statistics", "show ip dhcp snooping binding", "show run int <intf> | grep trust"],
        "eos":   ["show dhcp snooping statistics", "show dhcp snooping binding"],
        "iosxe": ["show ip dhcp snooping statistics", "show ip dhcp snooping binding", "show run int <intf> | inc trust"],
    },
    "remediation_steps": [
        "1. Check snooping drop counters: `show ip dhcp snooping statistics`",
        "2. Mark uplink/server port as trusted: `ip dhcp snooping trust`",
        "3. If rate-limit issue: `ip dhcp snooping limit rate <pps>` or `no ip dhcp snooping limit rate`",
        "4. Check Option-82: if server rejects, disable: `no ip dhcp snooping information option`",
    ],
    "verification_commands": {
        "nxos":  ["show ip dhcp snooping statistics", "show ip dhcp snooping binding"],
        "eos":   ["show dhcp snooping statistics"],
        "iosxe": ["show ip dhcp snooping statistics"],
    },
    "tags": ["dhcp", "snooping", "trust", "rate-limit", "option82"],
},

"DHCP_POOL_EXHAUSTED": {
    "name": "DHCP Pool Exhausted",
    "category": "dhcp",
    "severity": "high",
    "affected_layers": ["Application"],
    "symptoms": [
        "dhcp pool full", "no available addresses", "dhcp exhausted",
        "all addresses in use", "cannot get ip pool empty",
    ],
    "root_causes": [
        "Too many clients for pool size",
        "Stale leases not expiring (short lease time)",
        "Duplicate/rogue DHCP server consuming addresses",
        "DHCP lease time too long for dynamic environment",
    ],
    "diagnostic_commands": {
        "iosxe": ["show ip dhcp pool", "show ip dhcp binding | count", "show ip dhcp conflict"],
        "nxos":  ["show ip dhcp relay address statistics", "show ip dhcp snooping binding | count"],
    },
    "remediation_steps": [
        "1. Check utilisation: `show ip dhcp pool` — available / total",
        "2. Expand pool subnet or add secondary pool",
        "3. Reduce lease time for dynamic clients: `lease <days> <hours>`",
        "4. Clear stale bindings: `clear ip dhcp binding *` (during maintenance)",
        "5. Check for DHCP conflicts: `show ip dhcp conflict`",
    ],
    "verification_commands": {
        "iosxe": ["show ip dhcp pool"],
        "nxos":  ["show ip dhcp snooping binding | count"],
    },
    "tags": ["dhcp", "pool", "exhausted", "lease", "capacity"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: DATA PLANE
# ══════════════════════════════════════════════════════════════════════════════

"MTU_MISMATCH": {
    "name": "MTU Mismatch / PMTUD Black Hole",
    "category": "data_plane",
    "severity": "high",
    "affected_layers": ["L3"],
    "symptoms": [
        "mtu mismatch", "large packets dropped", "ping works small fails large",
        "tcp session slow", "pmtud black hole", "fragmentation needed df set",
        "vxlan mtu", "jumbo frame", "9000 mtu", "packet loss large frames",
    ],
    "root_causes": [
        "VXLAN encapsulation adds 50B overhead but host MTU not increased to 9000+",
        "Interface MTU not set consistently along path",
        "DF bit set on packets — fragmentation blocked",
        "QinQ double-tagging not accounted for in MTU",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> | grep MTU", "ping <dst> df-bit packet-size 8972 count 5", "show ip interface <intf> | grep MTU"],
        "eos":   ["show interfaces <intf> | grep MTU", "ping <dst> df-bit size 8972 repeat 5"],
        "iosxe": ["show interface <intf> | inc MTU", "ping <dst> df-bit size 1472"],
        "sonic": ["ip link show <intf> | grep mtu", "ping -M do -s 8972 <dst>"],
    },
    "remediation_steps": [
        "1. Identify path MTU: `ping <dst> df-bit packet-size 8972` — decrease until success",
        "2. Set MTU on all fabric interfaces: `mtu 9216` (NX-OS) / `mtu 9214` (EOS)",
        "3. Set host MTU: `mtu 9000` on server NICs (or 9214 for GPU/RoCEv2)",
        "4. Enable PMTUD on hosts: `sysctl -w net.ipv4.ip_no_pmtu_disc=0`",
        "5. For VXLAN: verify all underlay links are 9216 MTU minimum",
    ],
    "verification_commands": {
        "nxos":  ["ping <dst> df-bit packet-size 8972 count 3"],
        "eos":   ["ping <dst> df-bit size 8972 repeat 3"],
        "sonic": ["ping -M do -s 8972 <dst> -c 3"],
    },
    "tags": ["mtu", "pmtud", "vxlan", "jumbo", "fragmentation", "df-bit"],
},

"ACL_BLOCKING": {
    "name": "ACL Blocking Legitimate Traffic",
    "category": "data_plane",
    "severity": "high",
    "affected_layers": ["L3", "L4"],
    "symptoms": [
        "acl blocking", "access list dropping traffic", "traffic denied",
        "ping fails acl", "port blocked by acl", "traffic filtered",
        "implicit deny", "access control list dropping",
    ],
    "root_causes": [
        "Implicit deny at end of ACL",
        "ACL applied in wrong direction (in vs out)",
        "ACL on wrong interface",
        "Overly broad deny statement",
        "VLAN ACL (VACL) misconfiguration",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip access-lists <acl-name>", "show interface <intf> | grep access-group", "show statistics access-list <acl-name>"],
        "eos":   ["show ip access-lists <acl-name>", "show interfaces <intf> | grep access-group"],
        "iosxe": ["show ip access-lists <acl-name>", "show interface <intf> | inc access list"],
    },
    "remediation_steps": [
        "1. Show ACL hit counts: `show ip access-lists <name>` — look for high-hit deny",
        "2. Verify direction: in = inbound to switch, out = outbound from switch",
        "3. Add explicit permit before implicit deny",
        "4. Test with temporary: `show ip access-lists <name>` after traffic attempt",
        "5. Use packet-tracer (ASA/FTD) or ELAM (NX-OS) to trace",
    ],
    "verification_commands": {
        "nxos":  ["show ip access-lists <name>", "ping <dst> source <src>"],
        "eos":   ["show ip access-lists <name>"],
        "iosxe": ["show ip access-lists <name>"],
    },
    "tags": ["acl", "access-list", "deny", "filter", "vacl", "security"],
},

"INTERFACE_ERRORS": {
    "name": "Interface Physical Errors (CRC / Input Errors)",
    "category": "data_plane",
    "severity": "high",
    "affected_layers": ["L1"],
    "symptoms": [
        "interface errors", "crc errors", "input errors", "output errors",
        "runts", "giants", "packet loss physical", "flapping interface",
        "error counter incrementing", "bad optics",
    ],
    "root_causes": [
        "Bad cable or SFP/QSFP optic",
        "Duplex mismatch causing collisions",
        "Faulty NIC or switch port ASIC",
        "Dirty fiber connector",
        "Cable too long for speed (passive DAC beyond spec)",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf>", "show interface <intf> counters errors", "show interface <intf> transceiver details"],
        "eos":   ["show interfaces <intf>", "show interfaces <intf> counters errors", "show interfaces <intf> transceiver"],
        "iosxe": ["show interface <intf>", "show interface <intf> counters", "show interface <intf> transceiver"],
        "sonic": ["show interface counters errors", "ethtool -S <intf>", "show interfaces transceiver"],
    },
    "remediation_steps": [
        "1. Check counters: `show interface <intf>` — input/CRC errors",
        "2. Check optic DOM: `show interface <intf> transceiver` — Rx/Tx power",
        "3. Swap SFP/cable to test isolation",
        "4. Check duplex: `show interface <intf> | grep duplex`",
        "5. Clean fiber connectors",
        "6. If persistent, replace port or move to spare",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> counters errors", "show interface <intf>"],
        "eos":   ["show interfaces <intf> counters errors"],
        "sonic": ["show interface counters errors"],
    },
    "tags": ["l1", "crc", "errors", "optics", "sfp", "cable", "duplex", "physical"],
},

"ECMP_IMBALANCE": {
    "name": "ECMP Load-Balancing Imbalance",
    "category": "data_plane",
    "severity": "medium",
    "affected_layers": ["L3"],
    "symptoms": [
        "ecmp imbalance", "unequal load balancing", "one link congested",
        "ecmp hashing poor", "traffic not spread evenly", "elephant flow",
        "single path saturated", "polarization ecmp",
    ],
    "root_causes": [
        "ECMP hash polarisation (using only src-IP — few distinct flows)",
        "Hash asymmetry between spine and leaf (tuple mismatch)",
        "All traffic from one IP pair hashing to same path",
        "5-tuple hashing not enabled for TCP/UDP flows",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> counters | grep rate", "show ip load-sharing", "show hardware profile load-balance"],
        "eos":   ["show interfaces <intf> counters rates", "show load-balance profile ecmp"],
        "sonic": ["show platform ecmp hash", "show interfaces counters rates"],
    },
    "remediation_steps": [
        "1. Enable 5-tuple hashing: `ip load-sharing source-dest-port` (NX-OS)",
        "2. EOS: `ip load-sharing trident fields ip dst-ip src-ip ip-proto l4-dst-port l4-src-port`",
        "3. Enable resilient hashing (EOS/NX-OS) to avoid rehashing on member removal",
        "4. For elephant flows: consider flowlet switching or WCMP",
        "5. Verify symmetric hashing on both spine and leaf (same seed)",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> counters | grep rate"],
        "eos":   ["show interfaces <intf> counters rates"],
    },
    "tags": ["ecmp", "load-balancing", "hashing", "polarization", "elephant-flow"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: RDMA / RoCEv2 / GPU
# ══════════════════════════════════════════════════════════════════════════════

"PFC_STORM": {
    "name": "PFC Storm / Deadlock",
    "category": "rdma_gpu",
    "severity": "critical",
    "affected_layers": ["L2", "L3"],
    "symptoms": [
        "pfc storm", "pfc deadlock", "fabric frozen", "rdma traffic stopped",
        "all queues paused", "gpu training stuck", "roce throughput zero",
        "lossless queue paused", "pfc watchdog",
    ],
    "root_causes": [
        "Circular buffer dependency creating PFC deadlock",
        "PFC watchdog not enabled — deadlock not broken",
        "Misconfigured PFC priorities causing head-of-line blocking",
        "Insufficient buffer allocation for lossless queues",
        "Too many hops causing cumulative pause propagation",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> priority-flow-control", "show queuing interface <intf>", "show hardware internal buffer info pkt-stats"],
        "eos":   ["show interfaces <intf> pfc detail", "show platform environment queue all", "show queue counters <intf>"],
        "sonic": ["show pfc counters", "pfcstat -s all", "show queue counters"],
    },
    "remediation_steps": [
        "1. Enable PFC watchdog: `priority-flow-control watch-dog-interval 200` (NX-OS)",
        "2. EOS: `priority-flow-control watchdog polling-interval 10`",
        "3. SONiC: `pfcwd start --action drop --restoration-time 200`",
        "4. Check dead-end flows: `show pfc watchdog stats`",
        "5. Ensure only one lossless priority (3 or 4, not both unless DCQCN tuned)",
        "6. Review buffer allocation: `show hardware buffers` — increase MMU buffer for lossless queue",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> priority-flow-control", "show queuing interface <intf>"],
        "eos":   ["show interfaces <intf> pfc detail"],
        "sonic": ["pfcstat -s all"],
    },
    "tags": ["pfc", "rdma", "roce", "gpu", "deadlock", "lossless", "watchdog"],
},

"DCQCN_NOT_CONFIGURED": {
    "name": "DCQCN / ECN Not Configured for RoCEv2",
    "category": "rdma_gpu",
    "severity": "high",
    "affected_layers": ["L3"],
    "symptoms": [
        "dcqcn not configured", "ecn not enabled", "rdma drops", "roce congestion",
        "no congestion notification", "ecn marks absent", "cnp not generated",
        "rdma throughput low", "gpu utilisation low",
    ],
    "root_causes": [
        "ECN marking not enabled on switch ports",
        "DCQCN thresholds (Kmin/Kmax) not configured",
        "DSCP marking on RoCEv2 traffic wrong — not hitting lossless queue",
        "NIC DCQCN parameters not configured",
    ],
    "diagnostic_commands": {
        "nxos":  ["show queuing interface <intf> | grep ecn", "show hardware qos", "show running-config | grep dcqcn"],
        "eos":   ["show qos interface <intf>", "show platform environment queue all", "show running-config | grep ecn"],
        "sonic": ["show ecn", "show queue counters", "show pfc counters"],
    },
    "remediation_steps": [
        "1. Verify ECN on egress queues: `show queuing interface <intf>`",
        "2. NX-OS: `random-detect minimum-threshold 50000 bytes maximum-threshold 100000 bytes` on queue 3",
        "3. EOS: `random-detect ecn minimum-threshold 50000 maximum-threshold 100000 drop-probability 0`",
        "4. SONiC: `ecnconfig -p RDMA -gmin 50000 -gmax 100000`",
        "5. Verify DSCP 24/26 mapped to TC3 (lossless queue)",
        "6. Check CNP generation on NIC: `rdma stat show <dev>`",
    ],
    "verification_commands": {
        "nxos":  ["show queuing interface <intf> | grep ecn"],
        "eos":   ["show qos interface <intf> | grep ECN"],
        "sonic": ["show ecn"],
    },
    "tags": ["dcqcn", "ecn", "rdma", "roce", "gpu", "congestion", "cnp"],
},

"RDMA_LOSSLESS_DROPS": {
    "name": "Drops in Lossless (PFC-Protected) Queue",
    "category": "rdma_gpu",
    "severity": "critical",
    "affected_layers": ["L2"],
    "symptoms": [
        "lossless queue drops", "rdma packet drops", "roce drops",
        "pfc queue drops", "priority 3 drops", "priority 4 drops",
        "gpu training slow unexpected", "rdma retransmission",
    ],
    "root_causes": [
        "Buffer overflow — PFC not propagating upstream fast enough",
        "PFC watchdog disabling port after detecting storm",
        "XOFF threshold set too low for buffer depth",
        "Ingress buffer not reserved for lossless priority",
        "Headroom buffer miscalculated for cable/port speed",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> counters | grep drop", "show hardware internal buffer info pkt-stats detailed", "show queuing interface <intf>"],
        "eos":   ["show interfaces <intf> counters discards", "show platform environment queue", "show interfaces <intf> pfc detail"],
        "sonic": ["show queue counters", "pfcstat -s all", "show interface counters rif"],
    },
    "remediation_steps": [
        "1. Verify lossless queue has zero drops — any drop = misconfiguration",
        "2. Calculate headroom: `headroom = 2 × (cable_delay_cells + switch_pipeline_cells)`",
        "3. Increase XOFF threshold: reserve more headroom buffer for PFC",
        "4. SONiC: `buffer_pool` and `buffer_profile` in CONFIG_DB",
        "5. Check PFC watchdog hasn't disabled port: `show pfc watchdog stats`",
        "6. Ensure lossless priority is same end-to-end (NIC → TOR → Spine)",
    ],
    "verification_commands": {
        "nxos":  ["show queuing interface <intf>"],
        "eos":   ["show interfaces <intf> pfc detail"],
        "sonic": ["pfcstat -s all", "show queue counters"],
    },
    "tags": ["pfc", "lossless", "rdma", "roce", "drops", "buffer", "headroom"],
},

"PFC_PRIORITY_WRONG": {
    "name": "PFC Priority Misconfigured for RoCEv2",
    "category": "rdma_gpu",
    "severity": "high",
    "affected_layers": ["L2"],
    "symptoms": [
        "pfc priority wrong", "roce not lossless", "wrong pfc queue",
        "rdma not in lossless queue", "pfc priority 3 not set",
    ],
    "root_causes": [
        "PFC enabled on wrong priority (should be 3 for RoCEv2)",
        "NIC configured for priority 4 but switch uses priority 3",
        "DSCP-to-TC mapping not directing RoCEv2 to lossless TC",
        "QoS trust not set to DSCP on switch port",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> priority-flow-control", "show qos interface <intf>", "show running-config | grep pfc"],
        "eos":   ["show interfaces <intf> pfc detail", "show qos interface <intf>"],
        "sonic": ["show pfc counters", "pfcstat -s all"],
    },
    "remediation_steps": [
        "1. Agree on lossless priority — standard is 3 for RoCEv2",
        "2. NX-OS: `priority-flow-control mode on` + `priority-flow-control priority 3 no-drop`",
        "3. EOS: `priority-flow-control mode on` + `priority-flow-control priority 3 no-drop`",
        "4. SONiC: `pfcwd start --action drop` on lossless queue",
        "5. Configure NIC: `mlnx_qos -i <intf> --pfc 0,0,0,1,0,0,0,0` (priority 3)",
        "6. Verify DSCP 24/26 maps to TC3 on switch",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> priority-flow-control"],
        "eos":   ["show interfaces <intf> pfc detail"],
        "sonic": ["pfcstat -s all"],
    },
    "tags": ["pfc", "priority", "rdma", "roce", "gpu", "lossless", "dscp"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: CONTROL PLANE
# ══════════════════════════════════════════════════════════════════════════════

"CPU_HIGH_COPP": {
    "name": "High CPU / CoPP Drops Causing Protocol Instability",
    "category": "control_plane",
    "severity": "high",
    "affected_layers": ["Control-Plane"],
    "symptoms": [
        "high cpu", "copp drops", "bgp keepalive dropped", "ospf hello dropped",
        "control plane overloaded", "cpu spike", "routing protocol flapping",
        "management session slow", "ssh timeout",
    ],
    "root_causes": [
        "DDoS or broadcast storm hitting control-plane CPU",
        "CoPP policy rate-limit too aggressive for BGP/OSPF session count",
        "Misconfigured ACL sending all traffic to CPU",
        "BGP scanner process overloaded (large RIB)",
        "SNMP polling rate too high",
    ],
    "diagnostic_commands": {
        "nxos":  ["show processes cpu sort | head -20", "show policy-map interface control-plane", "show hardware rate-limiter"],
        "eos":   ["show processes top", "show policy-map copp", "show control-plane traffic"],
        "iosxe": ["show processes cpu sort | head -20", "show policy-map control-plane", "show platform resources"],
    },
    "remediation_steps": [
        "1. Identify top CPU consumers: `show processes cpu sort | head -20`",
        "2. Check CoPP drops: `show policy-map interface control-plane` — increments?",
        "3. Increase CoPP rate-limit for BGP/OSPF if legitimate: adjust `police rate`",
        "4. Suppress route scanning: tune `bgp scan-time`",
        "5. Rate-limit SNMP, syslog, NTP sources using CoPP or ACL",
        "6. If broadcast storm: find source port via `show mac address-table dynamic`",
    ],
    "verification_commands": {
        "nxos":  ["show processes cpu | head -10", "show policy-map interface control-plane | grep drop"],
        "eos":   ["show processes top", "show policy-map copp"],
        "iosxe": ["show processes cpu | head -10"],
    },
    "tags": ["cpu", "copp", "control-plane", "bgp", "ospf", "rate-limit", "ddos"],
},

"OSPF_NEIGHBOR_DOWN": {
    "name": "OSPF Neighbor Not Forming",
    "category": "control_plane",
    "severity": "critical",
    "affected_layers": ["L3", "Control-Plane"],
    "symptoms": [
        "ospf neighbor down", "ospf adjacency not forming", "ospf stuck in exstart",
        "ospf hello not received", "ospf dead interval", "ospf mtu mismatch",
        "ospf authentication failure",
    ],
    "root_causes": [
        "MTU mismatch — OSPF database exchange (DD) packet dropped",
        "Hello/dead timer mismatch",
        "Authentication password mismatch",
        "Area type mismatch (stub vs non-stub)",
        "Interface not in same OSPF area",
        "ACL blocking OSPF multicast (224.0.0.5/6)",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip ospf neighbors", "show ip ospf interface <intf>", "debug ip ospf hello", "show ip ospf statistics"],
        "eos":   ["show ip ospf neighbor", "show ip ospf interface <intf>", "show ip ospf"],
        "iosxe": ["show ip ospf neighbor", "show ip ospf interface <intf>"],
        "sonic": ["vtysh -c 'show ip ospf neighbor'", "vtysh -c 'show ip ospf interface <intf>'"],
    },
    "remediation_steps": [
        "1. Check neighbor table: `show ip ospf neighbors` — should show Full/DR/BDR",
        "2. Check interface config: `show ip ospf interface <intf>` — timers, area, auth",
        "3. Fix MTU: add `ip ospf mtu-ignore` or align MTU on both sides",
        "4. Fix timers: `ip ospf hello-interval` / `ip ospf dead-interval` must match",
        "5. Fix auth: `ip ospf authentication-key` or `ip ospf authentication message-digest`",
        "6. Verify ACL not blocking 224.0.0.5 and 224.0.0.6",
    ],
    "verification_commands": {
        "nxos":  ["show ip ospf neighbors", "show ip route ospf"],
        "eos":   ["show ip ospf neighbor", "show ip route ospf"],
        "iosxe": ["show ip ospf neighbor", "show ip route ospf"],
    },
    "tags": ["ospf", "neighbor", "adjacency", "mtu", "authentication", "timers"],
},

"NTP_OUT_OF_SYNC": {
    "name": "NTP Out of Sync",
    "category": "control_plane",
    "severity": "medium",
    "affected_layers": ["Management"],
    "symptoms": [
        "ntp out of sync", "clock skew", "ntp not synchronized", "time drift",
        "authentication failing ntp", "log timestamps wrong", "certificate expiry wrong",
    ],
    "root_causes": [
        "NTP server unreachable (ACL, routing, VRF issue)",
        "NTP authentication key mismatch",
        "NTP source interface not configured — wrong interface used",
        "Hardware clock drift too large for NTP to correct",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ntp status", "show ntp peer-status", "show clock"],
        "eos":   ["show ntp status", "show ntp associations"],
        "iosxe": ["show ntp status", "show ntp associations", "show clock"],
        "sonic": ["timedatectl status", "chronyc tracking"],
    },
    "remediation_steps": [
        "1. Check NTP status: `show ntp status` — stratum, synchronized?",
        "2. Ping NTP server: `ping <ntp-server> vrf management`",
        "3. Check source interface: `ntp source <loopback/mgmt>`",
        "4. Check auth: `ntp authentication-key <id> md5 <key>`",
        "5. Force time sync: `ntp sync-retry` or `clock update-calendar`",
    ],
    "verification_commands": {
        "nxos":  ["show ntp status", "show clock"],
        "eos":   ["show ntp status"],
        "iosxe": ["show ntp status", "show clock"],
        "sonic": ["timedatectl status"],
    },
    "tags": ["ntp", "clock", "sync", "stratum", "management"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: END-TO-END CONNECTIVITY
# ══════════════════════════════════════════════════════════════════════════════

"PING_FAILURE": {
    "name": "End-to-End Ping Failure",
    "category": "e2e_connectivity",
    "severity": "critical",
    "affected_layers": ["L2", "L3"],
    "symptoms": [
        "ping fails", "end to end not working", "connectivity broken",
        "host unreachable", "no response to ping", "icmp not working",
        "network not reachable",
    ],
    "root_causes": [
        "Routing issue — no route to destination",
        "ACL blocking ICMP",
        "VLAN mismatch — hosts in different L2 domains",
        "ARP failure — host not resolving MAC of gateway",
        "Firewall blocking",
        "VXLAN tunnel down",
    ],
    "diagnostic_commands": {
        "nxos":  ["ping <dst> vrf <vrf> count 5", "ping <dst> vrf <vrf> source <src-ip>", "traceroute <dst> vrf <vrf>", "show ip arp <dst> vrf <vrf>"],
        "eos":   ["ping vrf <vrf> <dst> repeat 5", "traceroute vrf <vrf> <dst>", "show arp vrf <vrf>"],
        "iosxe": ["ping <dst> source <src>", "traceroute <dst>", "show ip arp <dst>"],
        "sonic": ["ping -c 5 -I <src-intf> <dst>", "traceroute <dst>", "ip neigh show"],
    },
    "remediation_steps": [
        "1. Ping with verbose: `ping <dst> vrf <vrf> count 5` — note % loss",
        "2. Traceroute to find where traffic stops: `traceroute <dst> vrf <vrf>`",
        "3. Check ARP: `show ip arp <dst> vrf <vrf>` — does MAC resolve?",
        "4. Check route: `show ip route <dst>`",
        "5. Check ICMP not blocked by ACL: `show ip access-lists`",
        "6. If VXLAN: check NVE peer state: `show nve peers`",
    ],
    "verification_commands": {
        "nxos":  ["ping <dst> vrf <vrf>", "traceroute <dst> vrf <vrf>"],
        "eos":   ["ping vrf <vrf> <dst>", "traceroute vrf <vrf> <dst>"],
        "iosxe": ["ping <dst> source <src>", "traceroute <dst>"],
    },
    "tags": ["ping", "icmp", "connectivity", "arp", "routing", "e2e"],
},

"PORT_NOT_OPEN": {
    "name": "TCP/UDP Port Not Reachable",
    "category": "e2e_connectivity",
    "severity": "high",
    "affected_layers": ["L4", "Application"],
    "symptoms": [
        "port not open", "connection refused", "tcp timeout", "port filtered",
        "service not reachable", "application not accessible", "tcp syn not answered",
    ],
    "root_causes": [
        "ACL blocking specific port",
        "Security group / firewall rule missing",
        "Service not running on target host",
        "Port in LISTEN state but bound to wrong IP (0.0.0.0 vs specific IP)",
        "NAT / PAT not translating correctly",
    ],
    "diagnostic_commands": {
        "nxos":  ["show ip access-lists | grep <port>", "telnet <host> <port>"],
        "eos":   ["show ip access-lists | grep <port>"],
        "iosxe": ["show ip access-lists | inc <port>", "telnet <host> <port>"],
        "linux": ["nc -zv <host> <port>", "ss -tlnp | grep <port>", "nmap -p <port> <host>"],
    },
    "remediation_steps": [
        "1. Test reachability: `nc -zv <host> <port>` from network device or host",
        "2. On target host: `ss -tlnp | grep <port>` — is service listening?",
        "3. Check ACL on switch/firewall: `show ip access-lists | grep <port>`",
        "4. Check firewall rules: allow TCP/UDP <port> from <src-range> to <dst-ip>",
        "5. If NAT: verify translation table: `show ip nat translations`",
    ],
    "verification_commands": {
        "linux": ["nc -zv <host> <port>", "curl -v telnet://<host>:<port>"],
        "nxos":  ["telnet <host> <port>"],
    },
    "tags": ["tcp", "udp", "port", "firewall", "acl", "nat", "application"],
},

"TRACEROUTE_LOOP": {
    "name": "Routing Loop Detected",
    "category": "e2e_connectivity",
    "severity": "critical",
    "affected_layers": ["L3"],
    "symptoms": [
        "routing loop", "traceroute loop", "ttl exceeded storm", "packet bouncing",
        "high cpu from forwarding loop", "same hop repeated in traceroute",
    ],
    "root_causes": [
        "Two routers point default route at each other",
        "Redistribution loop (OSPF ↔ BGP mutual redistribution)",
        "Static route misconfiguration",
        "IGP split-horizon disabled accidentally",
    ],
    "diagnostic_commands": {
        "nxos":  ["traceroute <dst> vrf <vrf>", "show ip route <dst>", "show ip bgp <dst>"],
        "eos":   ["traceroute vrf <vrf> <dst>", "show ip route <dst>"],
        "iosxe": ["traceroute <dst>", "show ip route <dst>", "show ip cef <dst>"],
    },
    "remediation_steps": [
        "1. Traceroute to identify loop: look for repeated IPs",
        "2. Check routes on both routers in loop: `show ip route <dst>`",
        "3. Fix default route: ensure only one router points to another",
        "4. Fix redistribution: add tag on redistribution and deny tagged routes on return",
        "5. Check administrative distance — ensure preferred route wins",
    ],
    "verification_commands": {
        "nxos":  ["traceroute <dst> vrf <vrf>"],
        "eos":   ["traceroute vrf <vrf> <dst>"],
        "iosxe": ["traceroute <dst>"],
    },
    "tags": ["loop", "routing", "redistribution", "default-route", "ttl"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: WIFI / WIRELESS
# ══════════════════════════════════════════════════════════════════════════════

"AP_NOT_JOINING": {
    "name": "Access Point Not Joining Controller",
    "category": "wifi",
    "severity": "high",
    "affected_layers": ["L2", "L3", "Management"],
    "symptoms": [
        "ap not joining controller", "ap not discovered", "capwap not establishing",
        "ap stuck in discovery", "ap not registering", "lwapp failure",
        "ap leds red", "ap cannot reach wlc",
    ],
    "root_causes": [
        "CAPWAP/LWAPP UDP 5246/5247 blocked by ACL",
        "AP cannot get DHCP address",
        "AP VLAN not correctly trunked to switch port",
        "WLC unreachable from AP network",
        "Certificate mismatch (AP vs controller)",
        "AP time skew > 30s causing cert validation failure",
    ],
    "diagnostic_commands": {
        "iosxe": ["show ap summary", "show ap join stats summary all", "show ap config general <ap-name>", "show capwap client rcb"],
        "nxos":  ["show mac address-table | grep <ap-mac>", "show ip dhcp snooping binding | grep <ap-mac>"],
        "linux": ["tcpdump -i <intf> udp port 5246 or 5247"],
    },
    "remediation_steps": [
        "1. Check AP join stats: `show ap join stats summary all`",
        "2. Verify AP gets DHCP: `show ip dhcp binding | grep <ap-ip>`",
        "3. Check CAPWAP reachability: `ping <wlc-ip>` from AP network",
        "4. Verify port mode: AP port should be trunk with native VLAN = AP VLAN",
        "5. Check ACL allows UDP 5246/5247 from AP subnet to WLC",
        "6. Sync NTP — time skew > 30s blocks certificate validation",
    ],
    "verification_commands": {
        "iosxe": ["show ap summary", "show ap join stats summary all"],
    },
    "tags": ["wifi", "ap", "capwap", "lwapp", "wlc", "controller", "wireless"],
},

"WIFI_AUTH_FAILURE": {
    "name": "WiFi Client Authentication Failure",
    "category": "wifi",
    "severity": "high",
    "affected_layers": ["L2", "Application"],
    "symptoms": [
        "wifi auth failure", "802.1x failing", "client cannot connect wifi",
        "wrong password wifi", "radius reject", "eap failure",
        "authentication failed wireless", "dot1x failure",
    ],
    "root_causes": [
        "Wrong PSK on client",
        "RADIUS server unreachable from WLC",
        "RADIUS shared secret mismatch between WLC and RADIUS",
        "User not in RADIUS group / certificate expired",
        "EAP type mismatch (PEAP vs EAP-TLS)",
        "VLAN assignment from RADIUS returns wrong VLAN",
    ],
    "diagnostic_commands": {
        "iosxe": ["show wireless client mac-address <mac> detail", "debug dot11 aaa authenticator all", "show aaa servers"],
        "nxos":  ["show radius server", "show aaa authentication"],
    },
    "remediation_steps": [
        "1. Check client detail: `show wireless client mac-address <mac> detail`",
        "2. Verify RADIUS reachable: `ping <radius-ip>` from WLC",
        "3. Test RADIUS auth: `test aaa group radius <user> <pass> new-code`",
        "4. Check shared secret matches on WLC and RADIUS server",
        "5. Verify EAP type matches client supplicant and RADIUS policy",
        "6. Check VLAN assignment: RADIUS must return correct VLAN attribute (tunnel-private-group-id)",
    ],
    "verification_commands": {
        "iosxe": ["show wireless client mac-address <mac> detail", "show aaa servers"],
    },
    "tags": ["wifi", "authentication", "802.1x", "eap", "radius", "psk", "wireless"],
},

"SSID_VLAN_MISMATCH": {
    "name": "SSID Mapped to Wrong VLAN",
    "category": "wifi",
    "severity": "high",
    "affected_layers": ["L2", "L3"],
    "symptoms": [
        "ssid wrong vlan", "wifi client wrong subnet", "wireless vlan mismatch",
        "clients in wrong network wifi", "ssid vlan incorrect",
    ],
    "root_causes": [
        "WLAN profile mapped to wrong VLAN/interface on WLC",
        "AP VLAN override misconfigured",
        "Trunk port missing the correct VLAN",
    ],
    "diagnostic_commands": {
        "iosxe": ["show wlan id <wlan-id>", "show wlan name <ssid> detail", "show wireless client mac-address <mac> detail"],
        "nxos":  ["show vlan brief", "show int <ap-port> trunk"],
    },
    "remediation_steps": [
        "1. Check WLAN-to-VLAN mapping: `show wlan id <wlan-id>` — Client VLAN correct?",
        "2. Update WLAN VLAN: WLC GUI → WLAN → Edit → General → VLAN",
        "3. Verify AP switchport trunks correct VLAN: `show int <intf> trunk`",
        "4. Check RADIUS VLAN assignment overriding WLC default",
    ],
    "verification_commands": {
        "iosxe": ["show wireless client mac-address <mac> detail | inc VLAN"],
    },
    "tags": ["wifi", "ssid", "vlan", "wlan", "wireless", "mapping"],
},

# ══════════════════════════════════════════════════════════════════════════════
# CATEGORY: INFRASTRUCTURE / HARDWARE
# ══════════════════════════════════════════════════════════════════════════════

"INTERFACE_DOWN": {
    "name": "Physical Interface Down",
    "category": "infrastructure",
    "severity": "critical",
    "affected_layers": ["L1"],
    "symptoms": [
        "interface down", "link down", "port down", "physical link failure",
        "no carrier", "interface not connected", "copper down", "fiber down",
    ],
    "root_causes": [
        "Cable unplugged or damaged",
        "SFP/QSFP not seated or incompatible",
        "Speed/duplex auto-negotiation failure",
        "Remote end administratively shut down",
        "err-disabled (see PORT_ERRORDISABLED)",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf>", "show interface <intf> transceiver", "show cdp neighbors"],
        "eos":   ["show interfaces <intf>", "show interfaces <intf> transceiver", "show lldp neighbors"],
        "iosxe": ["show interface <intf>", "show interface <intf> transceiver", "show cdp neighbors"],
        "sonic": ["ip link show <intf>", "ethtool <intf>", "show interfaces status"],
    },
    "remediation_steps": [
        "1. Check physical: is cable connected? SFP seated?",
        "2. Check DOM: `show interface <intf> transceiver` — Rx power OK?",
        "3. Check remote end: is it `shutdown`?",
        "4. Check auto-neg: force speed/duplex if negotiation fails",
        "5. Try different SFP or cable",
        "6. Check err-disabled: `show interface status err-disabled`",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf>"],
        "eos":   ["show interfaces <intf>"],
        "iosxe": ["show interface <intf>"],
        "sonic": ["ip link show <intf>"],
    },
    "tags": ["l1", "interface", "down", "cable", "sfp", "optics", "physical"],
},

"LINK_FLAPPING": {
    "name": "Interface Link Flapping",
    "category": "infrastructure",
    "severity": "high",
    "affected_layers": ["L1", "L2"],
    "symptoms": [
        "link flapping", "interface flapping", "up down up down",
        "interface cycling", "syslog interface up down", "carrier lost",
    ],
    "root_causes": [
        "Faulty cable (intermittent contact)",
        "Bad SFP — marginal receive power",
        "Speed negotiation failure causing repeated reset",
        "BFD killing session on high-latency path",
        "Power issue on switch port",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf>", "show interface <intf> transceiver", "show log | grep '<intf>'", "show interface <intf> counters errors"],
        "eos":   ["show interfaces <intf>", "show interfaces <intf> transceiver", "show logging | grep <intf>"],
        "iosxe": ["show interface <intf>", "show log | inc <intf>"],
    },
    "remediation_steps": [
        "1. Check syslog for up/down frequency: `show log | grep <intf>`",
        "2. Check optic power: `show interface <intf> transceiver` — stable Rx power?",
        "3. Check error counters — CRC/input errors correlating with flap?",
        "4. Swap cable and SFP",
        "5. Configure carrier-delay to debounce: `carrier-delay msec 500`",
        "6. If BFD related: increase BFD minimum interval",
    ],
    "verification_commands": {
        "nxos":  ["show log | grep <intf> | tail -20", "show interface <intf> transceiver"],
        "eos":   ["show logging | grep <intf> | tail -20"],
    },
    "tags": ["l1", "flapping", "link", "sfp", "bfd", "carrier-delay", "optics"],
},

"OPTICS_LOW_POWER": {
    "name": "Optical Power Below Threshold (DOM)",
    "category": "infrastructure",
    "severity": "high",
    "affected_layers": ["L1"],
    "symptoms": [
        "optics low power", "sfp rx low", "dom alarm", "optical power warning",
        "tx power low", "rx power low", "los optical", "fiber problem",
    ],
    "root_causes": [
        "Dirty or damaged fiber connector",
        "Fiber bend radius exceeded",
        "Cable too long for optic type",
        "Failing SFP/QSFP transmitter",
        "Attenuator missing or wrong value",
    ],
    "diagnostic_commands": {
        "nxos":  ["show interface <intf> transceiver details", "show interface <intf> transceiver calibrations"],
        "eos":   ["show interfaces <intf> transceiver", "show platform environment all"],
        "iosxe": ["show interface <intf> transceiver"],
        "sonic": ["show interfaces transceiver <intf>", "sfputil show eeprom -p <intf>"],
    },
    "remediation_steps": [
        "1. Check DOM: `show interface <intf> transceiver details` — Rx/Tx power dBm",
        "2. Normal Rx range: typically -3 to -20 dBm (check optic datasheet)",
        "3. Clean fiber connectors with IEC 61300-3-35 wipe",
        "4. Inspect cable for tight bends",
        "5. Test with loopback to verify Tx power is OK",
        "6. Replace SFP if Tx power low",
    ],
    "verification_commands": {
        "nxos":  ["show interface <intf> transceiver details"],
        "eos":   ["show interfaces <intf> transceiver"],
    },
    "tags": ["optics", "sfp", "qsfp", "dom", "rx-power", "fiber", "physical"],
},

}  # end ISSUES
# fmt: on

# ─────────────────────────────────────────────────────────────────────────────
# Symptom → Issue matching engine
# ─────────────────────────────────────────────────────────────────────────────

def _score(issue: dict, symptom_text: str, state: dict[str, Any]) -> float:
    """Return 0-1 match score for an issue against symptom text + state context."""
    text = symptom_text.lower()
    score = 0.0

    # Keyword match against issue symptoms list
    for kw in issue.get("symptoms", []):
        if kw in text:
            score += 0.15

    # Use-case context boost
    uc = state.get("uc", "")
    if uc == "gpu" and issue["category"] in ("rdma_gpu", "vxlan_vtep", "bgp", "evpn"):
        score += 0.1
    if uc in ("dc", "hybrid") and issue["category"] in ("vxlan_vtep", "evpn", "bgp", "l3_routing"):
        score += 0.05
    if uc == "campus" and issue["category"] in ("l2_vlan", "wifi", "dhcp", "control_plane"):
        score += 0.1

    # Severity boost — critical issues shown higher
    severity_boost = {"critical": 0.05, "high": 0.03, "medium": 0.01, "low": 0.0}
    score += severity_boost.get(issue.get("severity", "low"), 0)

    return min(score, 1.0)


def diagnose(
    state: dict[str, Any],
    symptoms: list[str],
    top_n: int = 10,
) -> list[DiagnosticMatch]:
    """
    Given a state dict and list of symptom strings, return top_n ranked matches.

    Args:
        state:    Design/operational state dict.
        symptoms: Free-text symptom descriptions.
        top_n:    Maximum results to return.

    Returns:
        List of DiagnosticMatch sorted by score descending.
    """
    combined = " ".join(symptoms).lower()
    scored: list[tuple[float, str]] = []

    for issue_id, issue in ISSUES.items():
        s = _score(issue, combined, state)
        if s > 0:
            scored.append((s, issue_id))

    scored.sort(key=lambda x: x[0], reverse=True)

    results: list[DiagnosticMatch] = []
    for score_val, issue_id in scored[:top_n]:
        iss = ISSUES[issue_id]
        # Pick best platform commands
        platform = _best_platform(state)
        cmds = iss["diagnostic_commands"].get(platform, list(iss["diagnostic_commands"].values())[0])
        verify = iss.get("verification_commands", {})
        results.append(DiagnosticMatch(
            issue_id=issue_id,
            name=iss["name"],
            category=iss["category"],
            severity=iss["severity"],
            score=round(score_val, 3),
            root_causes=iss["root_causes"],
            commands={platform: cmds},
            remediation=iss["remediation_steps"],
            verification=verify,
            tags=iss.get("tags", []),
        ))
    return results


def _best_platform(state: dict[str, Any]) -> str:
    vendor = state.get("_detected_vendor", "")
    uc     = state.get("uc", "dc")
    if vendor == "Arista":
        return "eos"
    if vendor == "Juniper":
        return "junos"
    if uc == "gpu":
        products = state.get("selectedProducts", {})
        if "sonic" in str(products).lower():
            return "sonic"
        return "sonic"
    if uc == "campus":
        return "iosxe"
    return "nxos"


# ─────────────────────────────────────────────────────────────────────────────
# Static health check — runs against design state (no live devices needed)
# ─────────────────────────────────────────────────────────────────────────────

def health_check(state: dict[str, Any]) -> HealthReport:
    """
    Run static health checks derivable from design state alone.
    Returns a HealthReport with pass/warn/fail items and an overall score.
    """
    items: list[HealthItem] = []
    uc       = state.get("uc", "dc")
    protocols = [p.upper() for p in state.get("protocols", [])]
    products  = state.get("selectedProducts", {})
    spine_count = state.get("spine_count") or 0
    has_evpn  = "EVPN" in protocols or "VXLAN" in protocols
    redundancy = state.get("redundancy", "none")

    # ── Redundancy ──────────────────────────────────────────────────────────
    if spine_count < 2 and uc in ("dc", "hybrid", "gpu"):
        items.append(HealthItem("Spine Redundancy", "fail",
            f"Only {spine_count} spine(s) — single point of failure. Minimum 2 required.",
            "ROUTE_MISSING"))
    else:
        items.append(HealthItem("Spine Redundancy", "pass",
            f"{spine_count} spine(s) — ECMP redundancy OK"))

    # ── EVPN requires VRFs ────────────────────────────────────────────────
    if has_evpn:
        vrfs = state.get("vlans", [])
        if not vrfs:
            items.append(HealthItem("EVPN VRF Config", "warn",
                "EVPN enabled but no tenant VRFs defined — L3VNI routing will not function.",
                "L3VNI_MISSING"))
        else:
            items.append(HealthItem("EVPN VRF Config", "pass",
                f"EVPN enabled with VRFs defined"))

    # ── MTU for VXLAN ────────────────────────────────────────────────────
    if has_evpn and uc in ("dc", "hybrid", "gpu"):
        items.append(HealthItem("VXLAN MTU", "warn",
            "Ensure all fabric interfaces are MTU 9216+ (VXLAN adds ~50B overhead). "
            "Verify host MTU ≥ 9000.",
            "MTU_MISMATCH"))

    # ── PFC for GPU ──────────────────────────────────────────────────────
    if uc == "gpu":
        gpu_spec = state.get("gpuSpecifics", {})
        pfc = gpu_spec.get("pfc", False) if isinstance(gpu_spec, dict) else False
        if not pfc:
            items.append(HealthItem("GPU PFC/Lossless", "fail",
                "GPU/RDMA fabric detected but PFC lossless config not found in state. "
                "Set gpuSpecifics.pfc=true and configure priority 3.",
                "PFC_PRIORITY_WRONG"))
        else:
            items.append(HealthItem("GPU PFC/Lossless", "pass", "PFC lossless configured"))

    # ── BGP ASN ──────────────────────────────────────────────────────────
    bgp_asn = state.get("bgp_asn") or 0
    if bgp_asn and not (1 <= bgp_asn <= 4294967295):
        items.append(HealthItem("BGP ASN Range", "fail",
            f"BGP ASN {bgp_asn} out of valid range (1-4294967295)",
            "BGP_NEIGHBOR_DOWN"))
    elif bgp_asn:
        items.append(HealthItem("BGP ASN Range", "pass", f"BGP ASN {bgp_asn} valid"))

    # ── Anycast gateway check ────────────────────────────────────────────
    if has_evpn and uc in ("dc", "hybrid"):
        items.append(HealthItem("Anycast Gateway", "pass",
            "Verify `fabric forwarding anycast-gateway-mac` configured on all leaf VTEPs"))

    # ── NTP ───────────────────────────────────────────────────────────────
    items.append(HealthItem("NTP Redundancy", "warn",
        "Ensure ≥ 2 NTP servers configured per device. "
        "Time skew > 128s breaks BGP auth and certificates.",
        "NTP_OUT_OF_SYNC"))

    # ── OSPF neighbour count ─────────────────────────────────────────────
    underlay_raw = state.get("underlayProto", "")
    underlay = (underlay_raw[0] if isinstance(underlay_raw, list) and underlay_raw else underlay_raw if isinstance(underlay_raw, str) else "").upper()
    leaf_count = state.get("leaf_count") or 0
    if underlay == "OSPF" and leaf_count > 0 and spine_count > 0:
        expected_adj = spine_count * leaf_count
        items.append(HealthItem("OSPF Adjacencies", "pass",
            f"Expected {expected_adj} OSPF adjacencies ({spine_count} spines × {leaf_count} leaves). "
            "Verify all are in Full state."))

    # ── Score ─────────────────────────────────────────────────────────────
    fails  = sum(1 for i in items if i.status == "fail")
    warns  = sum(1 for i in items if i.status == "warn")
    total  = len(items)
    score  = max(0, 100 - fails * 20 - warns * 5)
    overall = "critical" if fails > 0 else "degraded" if warns > 2 else "healthy"

    summary = (
        f"{total} checks: {total - fails - warns} passed, {warns} warning(s), {fails} failed. "
        f"Health score: {score}/100."
    )

    return HealthReport(overall=overall, score=score, items=items, summary=summary)


# ─────────────────────────────────────────────────────────────────────────────
# Public helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_issue(issue_id: str) -> dict | None:
    return ISSUES.get(issue_id)

def list_categories() -> list[str]:
    return sorted({v["category"] for v in ISSUES.values()})

def list_issues_by_category(category: str) -> list[str]:
    return [k for k, v in ISSUES.items() if v["category"] == category]
