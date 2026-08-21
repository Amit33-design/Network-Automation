"""
Troubleshooting Tooling Engine (gap G-A19).

Given a symptom key, a list of affected devices, and a target platform,
returns a structured troubleshooting playbook:

  - category          : human-readable category label (BGP, OSPF, ...)
  - summary           : one-line description of the symptom
  - diagnostic_steps  : ordered steps with PLATFORM-SPECIFIC show commands
  - likely_causes     : ranked causes (confidence desc) with indicators
  - remediation       : concrete remediation steps

This is a pure-Python module with no external dependencies. Show commands
are resolved per platform (nxos | iosxe | eos | junos) where they differ.
Style mirrors backend/rca/engine.py.
"""
from __future__ import annotations

from typing import Any

SUPPORTED_PLATFORMS = ("nxos", "iosxe", "eos", "junos")
DEFAULT_PLATFORM = "nxos"


# A command spec is either a plain string (same on every platform) or a dict
# keyed by platform. Use _cmd() to resolve it for a given platform.
def _cmd(spec: Any, platform: str) -> str:
    """Resolve a per-platform command spec to a single command string."""
    if isinstance(spec, dict):
        return spec.get(platform) or spec.get(DEFAULT_PLATFORM) or next(iter(spec.values()), "")
    return spec or ""


# ── Playbook catalog ───────────────────────────────────────────────────────
# Each playbook: category, summary, steps[{description, command, look_for}],
# causes[{cause, confidence, indicators[]}], remediation[].
# Commands may be per-platform dicts.

PLAYBOOKS: dict[str, dict[str, Any]] = {
    "bgp_down": {
        "category": "BGP",
        "summary": "BGP neighbor session is down or stuck in Idle/Active/Connect.",
        "steps": [
            {
                "description": "Check the BGP neighbor summary and session state",
                "command": {
                    "nxos": "show ip bgp summary",
                    "iosxe": "show ip bgp summary",
                    "eos": "show ip bgp summary",
                    "junos": "show bgp summary",
                },
                "look_for": "Neighbor stuck in Idle/Active/Connect rather than Established; check the State/PfxRcd column",
            },
            {
                "description": "Verify L3 reachability to the neighbor address",
                "command": {
                    "nxos": "ping <neighbor-ip>",
                    "iosxe": "ping <neighbor-ip>",
                    "eos": "ping <neighbor-ip>",
                    "junos": "ping <neighbor-ip>",
                },
                "look_for": "Packet loss or unreachable — a routing/underlay problem prevents the TCP session",
            },
            {
                "description": "Inspect detailed neighbor state, configured vs received AS, and timers",
                "command": {
                    "nxos": "show ip bgp neighbors <neighbor-ip>",
                    "iosxe": "show ip bgp neighbors <neighbor-ip>",
                    "eos": "show ip bgp neighbors <neighbor-ip>",
                    "junos": "show bgp neighbor <neighbor-ip>",
                },
                "look_for": "AS mismatch (\"remote AS\" vs configured), hold-time mismatch, or \"Connection refused\"",
            },
            {
                "description": "Check for MTU / path-MTU issues that break large BGP updates",
                "command": {
                    "nxos": "ping <neighbor-ip> df-bit packet-size 8972",
                    "iosxe": "ping <neighbor-ip> df-bit size 8972",
                    "eos": "ping <neighbor-ip> df-bit size 8972",
                    "junos": "ping <neighbor-ip> do-not-fragment size 8972",
                },
                "look_for": "Fragmentation-needed / drops — an MTU mismatch can wedge the session in OpenSent/OpenConfirm",
            },
            {
                "description": "Check BFD session state for the peer (fast failure detection)",
                "command": {
                    "nxos": "show bfd neighbors",
                    "iosxe": "show bfd neighbors",
                    "eos": "show bfd peers",
                    "junos": "show bfd session",
                },
                "look_for": "BFD Down on a session the BGP peer depends on — BGP follows BFD, so this fails first",
            },
            {
                "description": "Review route-map / prefix-list policy applied to the neighbor",
                "command": {
                    "nxos": "show route-map",
                    "iosxe": "show route-map",
                    "eos": "show route-map",
                    "junos": "show policy-options policy-statement",
                },
                "look_for": "A policy denying everything — the session establishes but no prefixes are exchanged",
            },
        ],
        "causes": [
            {
                "cause": "AS number mismatch (configured remote-as != peer local-as)",
                "confidence": 0.85,
                "indicators": ["Session stuck in Active/Connect", "Last reset: peer AS mismatch / OpenSent"],
            },
            {
                "cause": "Underlay/IGP reachability lost to peer loopback/P2P address",
                "confidence": 0.72,
                "indicators": ["Ping to peer fails", "BGP stuck in Idle", "TCP/179 never establishes"],
            },
            {
                "cause": "BFD session down causing BGP fast-fallover teardown",
                "confidence": 0.55,
                "indicators": ["BFD neighbor Down", "BGP flaps coincide with BFD timeouts"],
            },
            {
                "cause": "Hold timer expired / asymmetric timers between peers",
                "confidence": 0.40,
                "indicators": ["Last reset: hold timer expired", "Keepalives not received"],
            },
        ],
        "remediation": [
            "Correct the remote-as on the neighbor statement to match the peer's local ASN.",
            "Restore underlay reachability (IGP adjacency / static route) to the peer address.",
            "Re-enable or fix BFD timers; verify both ends use compatible intervals.",
            "Clear the session after the fix: 'clear ip bgp <peer>' (soft if policy-only change).",
        ],
    },

    "ospf_adjacency": {
        "category": "OSPF",
        "summary": "OSPF neighbor adjacency is not reaching FULL state (stuck in Init/2-Way/ExStart).",
        "steps": [
            {
                "description": "Check OSPF neighbor state",
                "command": {
                    "nxos":  "show ip ospf neighbors",
                    "iosxe": "show ip ospf neighbor",
                    "eos":   "show ip ospf neighbor",
                    "junos": "show ospf neighbor",
                },
                "look_for": "Stuck in Init (one-way hellos), 2-Way (DR/BDR), or ExStart/Exchange (MTU)",
            },
            {
                "description": "Verify OSPF interface parameters (area, hello/dead, network type)",
                "command": {
                    "nxos":  "show ip ospf interface",
                    "iosxe": "show ip ospf interface",
                    "eos":   "show ip ospf interface",
                    "junos": "show ospf interface detail",
                },
                "look_for": "Mismatched area ID, hello/dead timers, or network type between neighbors",
            },
            {
                "description": "Check interface MTU on both ends",
                "command": {
                    "nxos":  "show interface",
                    "iosxe": "show interfaces",
                    "eos":   "show interfaces",
                    "junos": "show interfaces extensive",
                },
                "look_for": "MTU mismatch — adjacency stuck in ExStart/Exchange is the classic symptom",
            },
            {
                "description": "Confirm OSPF authentication settings match",
                "command": {
                    "nxos":  "show ip ospf interface",
                    "iosxe": "show ip ospf interface",
                    "eos":   "show ip ospf interface detail",
                    "junos": "show ospf interface detail",
                },
                "look_for": "Authentication type/key mismatch silently drops hellos",
            },
        ],
        "causes": [
            {
                "cause": "MTU mismatch between adjacent interfaces",
                "confidence": 0.80,
                "indicators": ["Adjacency stuck in ExStart/Exchange", "DBD packets retransmitted"],
            },
            {
                "cause": "Area ID or hello/dead timer mismatch",
                "confidence": 0.68,
                "indicators": ["Neighbor stuck in Init", "Hellos seen but no adjacency"],
            },
            {
                "cause": "Authentication type/key mismatch",
                "confidence": 0.50,
                "indicators": ["No neighbor entry despite L1/L2 up", "Auth failure log events"],
            },
            {
                "cause": "Network type mismatch (broadcast vs point-to-point) / DR election issue",
                "confidence": 0.38,
                "indicators": ["Neighbors stuck in 2-Way", "Unexpected DR/BDR roles"],
            },
        ],
        "remediation": [
            "Align interface MTU on both ends (or set 'ip ospf mtu-ignore' as a temporary workaround).",
            "Match OSPF area ID and hello/dead timers on both interfaces.",
            "Ensure authentication mode and keys are identical on the link.",
            "Set a consistent OSPF network type; use point-to-point on routed P2P links.",
        ],
    },

    "interface_flap": {
        "category": "Interface",
        "summary": "Physical interface is flapping (repeated up/down transitions).",
        "steps": [
            {
                "description": "Check interface status and flap/last-change counters",
                "command": {
                    "nxos":  "show interface status",
                    "iosxe": "show interfaces status",
                    "eos":   "show interfaces status",
                    "junos": "show interfaces terse",
                },
                "look_for": "Recent 'last link flapped' time and number of transitions",
            },
            {
                "description": "Inspect error counters (CRC, input errors, runts/giants)",
                "command": {
                    "nxos":  "show interface counters errors",
                    "iosxe": "show interfaces counters errors",
                    "eos":   "show interfaces counters errors",
                    "junos": "show interfaces extensive",
                },
                "look_for": "Rising CRC/input errors point to a bad cable, SFP, or dirty fiber",
            },
            {
                "description": "Verify transceiver/optics health (DOM levels)",
                "command": {
                    "nxos":  "show interface transceiver details",
                    "iosxe": "show interfaces transceiver detail",
                    "eos":   "show interfaces transceiver",
                    "junos": "show interfaces diagnostics optics",
                },
                "look_for": "Rx/Tx power outside thresholds, high-alarm/low-warning flags",
            },
            {
                "description": "Check speed/duplex negotiation",
                "command": {
                    "nxos":  "show interface status",
                    "iosxe": "show interfaces status",
                    "eos":   "show interfaces status",
                    "junos": "show interfaces media",
                },
                "look_for": "Duplex mismatch (half/full) or auto-neg failure on copper links",
            },
        ],
        "causes": [
            {
                "cause": "Faulty cable / dirty or failing optic causing CRC errors",
                "confidence": 0.78,
                "indicators": ["Rising CRC and input errors", "DOM Rx power out of range"],
            },
            {
                "cause": "Speed/duplex mismatch on the link",
                "confidence": 0.55,
                "indicators": ["Late collisions", "Half-duplex on one end", "Input errors with low throughput"],
            },
            {
                "cause": "Unstable transceiver / loose connector seating",
                "confidence": 0.45,
                "indicators": ["Intermittent link-down with no error counters", "Reseat clears it temporarily"],
            },
            {
                "cause": "Far-end device or port-channel member instability",
                "confidence": 0.30,
                "indicators": ["Flaps correlate with peer reloads", "LACP member bouncing"],
            },
        ],
        "remediation": [
            "Replace the cable/optic and clean fiber connectors; re-seat the transceiver.",
            "Hard-set speed and duplex on both ends to eliminate auto-negotiation issues.",
            "Move the link to a known-good port to isolate the failing component.",
            "Enable error-disable recovery / dampening to limit churn while replacing hardware.",
        ],
    },

    "high_latency": {
        "category": "Performance",
        "summary": "End-to-end latency is elevated above baseline for affected paths.",
        "steps": [
            {
                "description": "Measure hop-by-hop latency to the destination",
                "command": {
                    "nxos":  "traceroute <dest-ip>",
                    "iosxe": "traceroute <dest-ip>",
                    "eos":   "traceroute <dest-ip>",
                    "junos": "traceroute <dest-ip>",
                },
                "look_for": "The hop where RTT jumps — pinpoints the congested/oversubscribed segment",
            },
            {
                "description": "Check interface utilization and output queue drops",
                "command": {
                    "nxos":  "show interface counters detailed",
                    "iosxe": "show interfaces | include rate|drops",
                    "eos":   "show interfaces counters rates",
                    "junos": "show interfaces extensive",
                },
                "look_for": "Links near line-rate, output drops, or output-queue depth building up",
            },
            {
                "description": "Inspect QoS queue statistics and buffer occupancy",
                "command": {
                    "nxos":  "show queuing interface",
                    "iosxe": "show policy-map interface",
                    "eos":   "show qos interfaces",
                    "junos": "show class-of-service interface",
                },
                "look_for": "Tail drops in priority queues and high buffer utilization",
            },
            {
                "description": "Verify control-plane health is not adding processing delay",
                "command": {
                    "nxos":  "show system resources",
                    "iosxe": "show processes cpu sorted",
                    "eos":   "show processes top once",
                    "junos": "show chassis routing-engine",
                },
                "look_for": "High CPU causing punt/process-switching of latency-sensitive traffic",
            },
        ],
        "causes": [
            {
                "cause": "Link congestion / oversubscription on the transit path",
                "confidence": 0.75,
                "indicators": ["Utilization near 100%", "Output drops at a specific hop"],
            },
            {
                "cause": "Suboptimal routing / asymmetric or longer path",
                "confidence": 0.55,
                "indicators": ["Traceroute takes unexpected hops", "ECMP imbalance"],
            },
            {
                "cause": "QoS buffer/queue tail-drops on latency-sensitive class",
                "confidence": 0.45,
                "indicators": ["Priority-queue tail drops", "Jitter spikes under load"],
            },
            {
                "cause": "Control-plane punting due to high CPU",
                "confidence": 0.30,
                "indicators": ["High CPU on transit node", "Process-switched flows"],
            },
        ],
        "remediation": [
            "Add capacity or rebalance ECMP across the congested links.",
            "Tune routing metrics / fix asymmetric paths to use the shortest route.",
            "Adjust QoS buffers and priority-queue policing for latency-sensitive traffic.",
            "Offload control-plane load and ensure hardware (not software) forwarding.",
        ],
    },

    "packet_loss": {
        "category": "Performance",
        "summary": "Intermittent or sustained packet loss across affected paths.",
        "steps": [
            {
                "description": "Run a sustained ping with size variation to characterize loss",
                "command": {
                    "nxos":  "ping <dest-ip> count 1000",
                    "iosxe": "ping <dest-ip> repeat 1000",
                    "eos":   "ping <dest-ip> repeat 1000",
                    "junos": "ping <dest-ip> count 1000 rapid",
                },
                "look_for": "Loss percentage and whether large packets fail (MTU/fragmentation)",
            },
            {
                "description": "Check interface drops (input/output, ingress/egress queues)",
                "command": {
                    "nxos":  "show interface counters errors",
                    "iosxe": "show interfaces | include drops|errors",
                    "eos":   "show interfaces counters discards",
                    "junos": "show interfaces extensive",
                },
                "look_for": "Output drops (egress congestion) vs input errors (L1 problem)",
            },
            {
                "description": "Inspect buffer / microburst statistics on egress ports",
                "command": {
                    "nxos":  "show hardware internal buffer info pkt-stats",
                    "iosxe": "show platform hardware ... buffer",
                    "eos":   "show interfaces counters queue",
                    "junos": "show interfaces queue",
                },
                "look_for": "Microburst-driven tail drops even when average utilization is low",
            },
            {
                "description": "Verify forwarding/adjacency consistency across the path",
                "command": {
                    "nxos":  "show forwarding ipv4 route",
                    "iosxe": "show ip cef",
                    "eos":   "show ip route summary",
                    "junos": "show route forwarding-table",
                },
                "look_for": "Blackhole/incomplete adjacency or inconsistent ECMP hashing",
            },
        ],
        "causes": [
            {
                "cause": "Egress congestion / microbursts overflowing shallow buffers",
                "confidence": 0.72,
                "indicators": ["Output/queue tail drops", "Loss only under bursty load"],
            },
            {
                "cause": "Physical-layer errors (bad cable/optic) causing input errors",
                "confidence": 0.60,
                "indicators": ["Rising input/CRC errors", "Loss correlates with one interface"],
            },
            {
                "cause": "MTU mismatch dropping large/fragmented packets",
                "confidence": 0.45,
                "indicators": ["Small pings pass, large pings fail", "DF-bit drops"],
            },
            {
                "cause": "Forwarding inconsistency / partial blackhole in ECMP",
                "confidence": 0.32,
                "indicators": ["Loss only on certain flows/hashes", "Incomplete adjacency"],
            },
        ],
        "remediation": [
            "Increase buffer allocation / enable dynamic buffer sharing for bursty egress ports.",
            "Replace faulty cable/optic and clear physical-layer errors.",
            "Align MTU end-to-end (including jumbo settings) across the path.",
            "Verify ECMP hashing and forwarding tables; clear stale adjacencies.",
        ],
    },

    "high_cpu": {
        "category": "Performance",
        "summary": "Device control-plane CPU utilization is abnormally high.",
        "steps": [
            {
                "description": "Identify top CPU-consuming processes",
                "command": {
                    "nxos":  "show processes cpu sort",
                    "iosxe": "show processes cpu sorted",
                    "eos":   "show processes top once",
                    "junos": "show system processes extensive",
                },
                "look_for": "The process consuming CPU (BGP, OSPF, ARP/ND, netstack, or a punt handler)",
            },
            {
                "description": "Check control-plane policing (CoPP) drops",
                "command": {
                    "nxos":  "show policy-map interface control-plane",
                    "iosxe": "show policy-map control-plane",
                    "eos":   "show policy-map interface control-plane copp-system-policy",
                    "junos": "show ddos-protection protocols statistics",
                },
                "look_for": "High CoPP/DDoS-protection drops indicate a punt storm hitting the CPU",
            },
            {
                "description": "Inspect punted traffic to the CPU",
                "command": {
                    "nxos":  "show system internal access-list resource utilization",
                    "iosxe": "show platform software infrastructure punt",
                    "eos":   "show cpu counters queue",
                    "junos": "show pfe statistics traffic",
                },
                "look_for": "Excessive traffic punted to the CPU (TTL-expiry, glean, ARP floods, ACL logging)",
            },
            {
                "description": "Check for routing churn / flapping driving recomputation",
                "command": {
                    "nxos":  "show ip route summary",
                    "iosxe": "show ip route summary",
                    "eos":   "show ip route summary",
                    "junos": "show route summary",
                },
                "look_for": "Rapidly changing route counts indicating SPF/BGP recomputation storms",
            },
        ],
        "causes": [
            {
                "cause": "Control-plane punt storm (ARP/ND flood, ACL logging, TTL-expiry)",
                "confidence": 0.78,
                "indicators": ["High CoPP drops", "Punt queue saturated", "ARP/netstack process high"],
            },
            {
                "cause": "Routing protocol churn driving repeated SPF/best-path recomputation",
                "confidence": 0.58,
                "indicators": ["BGP/OSPF process at top of CPU", "Flapping routes/neighbors"],
            },
            {
                "cause": "Software/process bug or memory leak spinning a process",
                "confidence": 0.40,
                "indicators": ["One process pinned at ~100%", "Climbing memory usage"],
            },
            {
                "cause": "Excessive SNMP/telemetry polling load",
                "confidence": 0.28,
                "indicators": ["SNMP process high", "CPU spikes align with polling intervals"],
            },
        ],
        "remediation": [
            "Apply/tighten CoPP to rate-limit punted control-plane traffic.",
            "Suppress the source of the punt storm (fix ARP flood, disable noisy ACL logging).",
            "Stabilize routing (dampening, BFD timer tuning) to stop recomputation churn.",
            "Reduce SNMP/telemetry polling rate or upgrade software to fix a known CPU bug.",
        ],
    },

    "vxlan_evpn": {
        "category": "Overlay",
        "summary": "VXLAN/EVPN overlay fault — VTEP unreachable or hosts not learned across the fabric.",
        "steps": [
            {
                "description": "Check NVE interface and VTEP peer state",
                "command": {
                    "nxos": "show nve peers",
                    "iosxe": "show nve peers",
                    "eos": "show vxlan vtep",
                    "junos": "show interfaces vtep",
                },
                "look_for": "Expected remote VTEPs present and Up; missing peer = no overlay path",
            },
            {
                "description": "Verify L2VPN EVPN routes are being learned",
                "command": {
                    "nxos": "show bgp l2vpn evpn summary",
                    "iosxe": "show bgp l2vpn evpn summary",
                    "eos": "show bgp evpn summary",
                    "junos": "show bgp summary",
                },
                "look_for": "EVPN address-family Established and prefixes received (>0)",
            },
            {
                "description": "Confirm Type-2 (MAC/IP) routes for the host",
                "command": {
                    "nxos": "show bgp l2vpn evpn",
                    "iosxe": "show bgp l2vpn evpn",
                    "eos": "show bgp evpn route-type mac-ip",
                    "junos": "show route table bgp.evpn.0",
                },
                "look_for": "Missing Type-2 routes for the affected MAC/IP — host not advertised or RT-filtered",
            },
            {
                "description": "Check VNI status and VLAN-to-VNI mapping",
                "command": {
                    "nxos": "show nve vni",
                    "iosxe": "show nve vni",
                    "eos": "show vxlan vni",
                    "junos": "show ethernet-switching vxlan-tunnel-end-point remote",
                },
                "look_for": "VNI Up and mapped to the correct VLAN; route-target import/export mismatch",
            },
            {
                "description": "Inspect EVPN route-targets (import/export) for the L2/L3 VNI",
                "command": {
                    "nxos": "show bgp l2vpn evpn",
                    "iosxe": "show bgp l2vpn evpn",
                    "eos": "show bgp evpn route-type mac-ip",
                    "junos": "show route table bgp.evpn.0 extensive",
                },
                "look_for": "Import/export RTs that do not match the far leaf — with per-leaf eBGP ASNs, auto-RT derives ASN:VNI and no leaf imports any other leaf (Y1)",
            },
        ],
        "causes": [
            {
                "cause": "Route-target import/export mismatch between leaves (VNI not stitched)",
                "confidence": 0.82,
                "indicators": ["EVPN routes received but not imported", "Hosts local-only, not learned remotely"],
            },
            {
                "cause": "VTEP source loopback unreachable in the underlay",
                "confidence": 0.68,
                "indicators": ["NVE peer Down", "Ping to remote VTEP loopback fails"],
            },
            {
                "cause": "EVPN BGP session down to spine / route-reflector",
                "confidence": 0.55,
                "indicators": ["l2vpn evpn AF not Established", "PfxRcd = 0 on EVPN AF"],
            },
            {
                "cause": "VNI-to-VLAN mapping mismatch or VNI down on a leaf",
                "confidence": 0.40,
                "indicators": ["VNI Down state", "Inconsistent VLAN/VNI map across leaves"],
            },
        ],
        "remediation": [
            "Align EVPN route-targets (or use 'route-target both auto') consistently across all leaves.",
            "Restore underlay reachability to the VTEP source loopback (IGP/BGP underlay).",
            "Fix the EVPN BGP session to the spine/route-reflector and confirm AF activation.",
            "Correct VNI-to-VLAN bindings and ensure the VNI is up on every participating leaf.",
        ],
    },

    "pfc_rocev2": {
        "category": "QoS/RoCEv2",
        "summary": "RoCEv2 / RDMA fabric impairment — PFC storms, watchdog drops, or ECN/DCQCN misconfiguration.",
        "steps": [
            {
                "description": "Check PFC counters and per-priority pause frames",
                "command": {
                    "nxos":  "show interface priority-flow-control",
                    "iosxe": "show interface priority-flow-control",
                    "eos":   "show interfaces priority-flow-control",
                    "junos": "show interfaces priority-flow-control",
                },
                "look_for": "Pause frames TX/RX on the lossless priority (typically priority 3 for RoCEv2)",
            },
            {
                "description": "Inspect PFC watchdog status for stuck/deadlocked queues",
                "command": {
                    "nxos":  "show queuing pfc-queue interface",
                    "iosxe": "show platform hardware ... pfc-watchdog",
                    "eos":   "show qos interface counters",
                    "junos": "show class-of-service interface detail",
                },
                "look_for": "Watchdog-triggered queue drops indicating a PFC deadlock/storm",
            },
            {
                "description": "Verify ECN marking and DCQCN configuration on lossless queues",
                "command": {
                    "nxos":  "show policy-map interface type queuing",
                    "iosxe": "show policy-map interface",
                    "eos":   "show qos interface random-detect",
                    "junos": "show class-of-service interface detail",
                },
                "look_for": "ECN/WRED thresholds and that no-drop is set on the RoCEv2 priority",
            },
            {
                "description": "Confirm consistent QoS / no-drop class mapping fabric-wide",
                "command": {
                    "nxos":  "show policy-map system type network-qos",
                    "iosxe": "show policy-map",
                    "eos":   "show qos maps",
                    "junos": "show class-of-service",
                },
                "look_for": "Mismatched DSCP/CoS-to-queue maps or no-drop class between leaf and spine",
            },
        ],
        "causes": [
            {
                "cause": "PFC priority / no-drop class misconfigured or inconsistent across the fabric",
                "confidence": 0.83,
                "indicators": ["Pause frames on wrong priority", "no-drop not applied to RoCEv2 queue"],
            },
            {
                "cause": "PFC deadlock / storm tripping the watchdog (cyclic buffer dependency)",
                "confidence": 0.66,
                "indicators": ["PFC watchdog drops climbing", "Lossless queue stuck, traffic stalls"],
            },
            {
                "cause": "ECN/DCQCN misconfiguration causing congestion not to be signaled",
                "confidence": 0.52,
                "indicators": ["No CNP/ECN marks under congestion", "Tail drops on lossless queue"],
            },
            {
                "cause": "Headroom/buffer too small for the link distance/MTU",
                "confidence": 0.35,
                "indicators": ["Drops on lossless queue despite PFC", "Long-distance/jumbo links affected"],
            },
        ],
        "remediation": [
            "Apply PFC no-drop consistently on the RoCEv2 priority (priority 3) across every device.",
            "Tune/clear the PFC watchdog and resolve the cyclic dependency causing the deadlock.",
            "Configure ECN/WRED thresholds and DCQCN so congestion is marked, not dropped.",
            "Increase ingress buffer headroom to match link length and MTU for lossless transport.",
        ],
    },

    # ── Spine-Leaf Fabric workflow (Cisco + Juniper) — mirrors frontend O2 ────
    "loopback_reachability": {
        "category": "Spine-Leaf Fabric",
        "summary": "A leaf/spine loopback (BGP/VTEP source) is not reachable across the underlay. Confirm it is configured, advertised into the underlay, and reachable from the remote loopback with the correct source.",
        "steps": [
            {"description": "Confirm the local loopback is up and addressed",
             "command": {"nxos": "show ip interface brief | include Loopback", "iosxe": "show ip interface brief | include Loopback", "eos": "show ip interface brief | include Loopback", "junos": "show interfaces terse | match lo0"},
             "look_for": "Loopback0/lo0 up/up with the expected /32; a down/missing loopback breaks BGP/VTEP sourcing"},
            {"description": "Verify the remote loopback is in the route table (advertised in underlay)",
             "command": {"nxos": "show ip route <remote-loopback>", "iosxe": "show ip route <remote-loopback>", "eos": "show ip route <remote-loopback>", "junos": "show route <remote-loopback>"},
             "look_for": "A /32 via the underlay (IS-IS/OSPF/eBGP); missing = not advertised or filtered"},
            {"description": "Ping the remote loopback sourced from the local loopback",
             "command": {"nxos": "ping <remote-loopback> source <local-loopback>", "iosxe": "ping <remote-loopback> source <local-loopback>", "eos": "ping <remote-loopback> source <local-loopback>", "junos": "ping <remote-loopback> source <local-loopback>"},
             "look_for": "Loss/unreachable — the control-plane/VTEP source cannot reach the peer"},
            {"description": "Trace the path to localize where the loopback route is lost",
             "command": {"nxos": "traceroute <remote-loopback> source <local-loopback>", "iosxe": "traceroute <remote-loopback> source <local-loopback>", "eos": "traceroute <remote-loopback> source <local-loopback>", "junos": "traceroute <remote-loopback> source <local-loopback>"},
             "look_for": "The hop where the trace stops — that node is missing/filtering the loopback prefix"},
        ],
        "causes": [
            {"cause": "Loopback not advertised into the underlay (missing network/redistribute/export policy)", "confidence": 0.80,
             "indicators": ["Remote /32 absent from RIB", "Local loopback fine but peers cannot reach it"]},
            {"cause": "Route filtering / prefix-list dropping the loopback range", "confidence": 0.60,
             "indicators": ["Loopback in IGP database but not RIB", "Inbound prefix-list/route-map denies the /32"]},
            {"cause": "Wrong source interface for BGP/VTEP (update-source / source-interface)", "confidence": 0.50,
             "indicators": ["Ping fails only when sourced from loopback", "VTEP source-interface misconfigured"]},
        ],
        "remediation": [
            "Advertise the loopback in the underlay (passive-interface + network statement, or export policy).",
            "Remove/loosen prefix filtering so the loopback /32 range is permitted end-to-end.",
            "Set BGP update-source / NVE source-interface to the correct loopback.",
            "Re-verify with a loopback-sourced ping once the /32 appears in the remote RIB.",
        ],
    },

    "ecmp_inconsistency": {
        "category": "Spine-Leaf Fabric",
        "summary": "Leaf-to-leaf traffic is not load-balancing across all spines (missing ECMP next-hops or polarization). Confirm all equal-cost paths are installed and hardware hashing is healthy.",
        "steps": [
            {"description": "Check the route has multiple equal-cost next-hops (one per spine)",
             "command": {"nxos": "show ip route <destination>", "iosxe": "show ip route <destination>", "eos": "show ip route <destination>", "junos": "show route <destination>"},
             "look_for": "Fewer next-hops than spines = missing ECMP path (max-paths or a down underlay adjacency)"},
            {"description": "Confirm the FIB/forwarding table installed all paths",
             "command": {"nxos": "show ip cef <destination>", "iosxe": "show ip cef <destination>", "eos": "show ip route <destination> detail", "junos": "show route forwarding-table destination <destination>"},
             "look_for": "RIB shows N paths but FIB installs fewer — a hardware/max-paths limit"},
            {"description": "Verify the exact path a flow will take (hashing/polarization)",
             "command": {"nxos": "show ip cef exact-route <src-ip> <dst-ip>", "iosxe": "show ip cef exact-route <src-ip> <dst-ip>", "eos": "show route exact-route <src-ip> <dst-ip>", "junos": "show route extensive <destination>"},
             "look_for": "All flows resolving to one spine = polarization (identical hash seed across tiers)"},
            {"description": "Check port-channel / LAG member load-balance hashing",
             "command": {"nxos": "show port-channel load-balance", "iosxe": "show etherchannel load-balance", "eos": "show port-channel load-balance", "junos": "show chassis forwarding-options"},
             "look_for": "Hashing not including L4/SIP-DIP, or all members carrying one flow"},
        ],
        "causes": [
            {"cause": "maximum-paths too low — not all spine paths installed", "confidence": 0.75,
             "indicators": ["RIB has fewer next-hops than spines", "Throughput capped to one uplink"]},
            {"cause": "ECMP polarization (same hash across leaf->spine->leaf)", "confidence": 0.60,
             "indicators": ["All flows take one spine", "Uneven spine utilization"]},
            {"cause": "A spine uplink/underlay adjacency is down", "confidence": 0.55,
             "indicators": ["One next-hop missing", "IGP/BGP adjacency down to a spine"]},
        ],
        "remediation": [
            "Raise maximum-paths (and bestpath as-path multipath-relax for eBGP) to the spine count.",
            "Vary the load-balance hash seed/inputs per tier to break polarization (include L4 ports).",
            "Restore the down spine adjacency so all equal-cost next-hops reinstall.",
            "Confirm with exact-route that flows now spread across all spines.",
        ],
    },

    "border_leaf": {
        "category": "Spine-Leaf Fabric",
        "summary": "External / DCI / WAN prefixes are not reaching the fabric (or fabric prefixes are not leaving). Troubleshoot the border-leaf external peering, route import/export, prefix filtering, and the return path.",
        "steps": [
            {"description": "Check the external/default route is present and learned correctly",
             "command": {"nxos": "show ip route <prefix>", "iosxe": "show ip route <prefix>", "eos": "show ip route <prefix>", "junos": "show route <prefix>"},
             "look_for": "Missing external prefix / no default — import policy or peering issue"},
            {"description": "Verify the external BGP peering is up and exchanging routes",
             "command": {"nxos": "show bgp ipv4 unicast summary", "iosxe": "show ip bgp summary", "eos": "show ip bgp summary", "junos": "show bgp summary"},
             "look_for": "External/DCI peer not Established, or PfxRcd 0 — no external routes coming in"},
            {"description": "Confirm which prefixes are advertised to the external/DCI peer",
             "command": {"nxos": "show ip bgp neighbors <peer> advertised-routes", "iosxe": "show ip bgp neighbors <peer> advertised-routes", "eos": "show ip bgp neighbors <peer> advertised-routes", "junos": "show route advertising-protocol bgp <peer>"},
             "look_for": "Fabric/tenant prefixes missing from the advertisement — export policy gap (no return path)"},
            {"description": "Inspect the route-map / policy controlling import/export + filtering",
             "command": {"nxos": "show route-map", "iosxe": "show route-map", "eos": "show route-map", "junos": "show configuration policy-options"},
             "look_for": "Prefix-list/route-map denying the prefix, or missing community match for leaking"},
        ],
        "causes": [
            {"cause": "Import policy drops external/DCI prefixes (or no default originated)", "confidence": 0.75,
             "indicators": ["External prefix absent from RIB", "Inbound route-map deny", "No default-route toward WAN"]},
            {"cause": "Export policy omits fabric prefixes — broken return path", "confidence": 0.65,
             "indicators": ["advertised-routes missing tenant prefixes", "One-way reachability"]},
            {"cause": "External BGP session down / prefix limit hit", "confidence": 0.50,
             "indicators": ["DCI/WAN peer not Established", "PfxRcd 0 or maxed"]},
        ],
        "remediation": [
            "Fix the import policy / originate the default toward the fabric as intended.",
            "Add the fabric/tenant prefixes to the export policy so the return path exists.",
            "Restore the external/DCI BGP session and raise/clear the prefix limit if hit.",
            "Re-check advertised-routes and the RIB on both sides for symmetric reachability.",
        ],
    },

    "services_leaf": {
        "category": "Spine-Leaf Fabric",
        "summary": "Traffic to a service appended at a services-leaf (firewall/LB/NAT) fails. Verify the service interface, VLAN/VRF association, routing into the service VRF, and that the path is symmetric.",
        "steps": [
            {"description": "Check the service-facing interface and VLAN are up/associated",
             "command": {"nxos": "show ip interface brief", "iosxe": "show ip interface brief", "eos": "show ip interface brief", "junos": "show interfaces terse"},
             "look_for": "Service interface down, or not in the expected VLAN/VRF"},
            {"description": "Confirm VLAN <-> VRF association",
             "command": {"nxos": "show vrf", "iosxe": "show vrf", "eos": "show vrf", "junos": "show route instance"},
             "look_for": "SVI/interface not bound to the service VRF, or VLAN missing from the VLAN db"},
            {"description": "Verify routing to the service subnet inside the VRF",
             "command": {"nxos": "show ip route vrf <vrf-name>", "iosxe": "show ip route vrf <vrf-name>", "eos": "show ip route vrf <vrf-name>", "junos": "show route table <vrf-name>.inet.0"},
             "look_for": "No route to the service/firewall/LB subnet within the tenant VRF"},
            {"description": "Test reachability to the service IP from within the VRF",
             "command": {"nxos": "ping vrf <vrf-name> <service-ip>", "iosxe": "ping vrf <vrf-name> <service-ip>", "eos": "ping vrf <vrf-name> <service-ip>", "junos": "ping routing-instance <vrf-name> <service-ip>"},
             "look_for": "Loss/unreachable, or asymmetric routing (firewall drops the return flow)"},
        ],
        "causes": [
            {"cause": "VLAN/VRF association wrong on the service interface", "confidence": 0.75,
             "indicators": ["Service SVI in wrong/global VRF", "Route present in global not tenant VRF"]},
            {"cause": "No route to the service subnet inside the tenant VRF", "confidence": 0.60,
             "indicators": ["show ip route vrf missing the subnet", "Missing import RT for the service"]},
            {"cause": "Asymmetric routing breaking stateful firewall/NAT/LB", "confidence": 0.55,
             "indicators": ["One-direction works", "Firewall drops out-of-state"]},
        ],
        "remediation": [
            "Bind the service interface/SVI to the correct VLAN and tenant VRF.",
            "Leak/import the service subnet into the tenant VRF (route-target / static).",
            "Make the forward and return paths symmetric (or enable firewall asymmetric handling).",
            "Re-test with an in-VRF ping/traceroute to the service IP.",
        ],
    },
    # ── Ported from the frontend engine (parity fix) ───────────────────────
    # These 12 playbooks existed only in lib/Step6Deploy.tsx, so POST
    # /api/troubleshoot fell through to GENERIC_PLAYBOOK for them — live mode
    # gave a materially worse answer than demo mode. Transcribed mechanically
    # from the TSX source so the wording cannot drift during the port.
    "stp_loop": {
        "category": "L2 / Spanning Tree",
        "summary": "A spanning-tree loop or root-bridge election issue is causing "
                       "broadcast storms, MAC flapping, or ports stuck in blocking. "
                       "Verify root-bridge priority, BPDU guard, and loop-guard.",
        "steps": [
            {
                "description": "Check the STP root bridge for each VLAN",
                "command": {
                    "nxos": "show spanning-tree root",
                    "iosxe": "show spanning-tree root",
                    "eos": "show spanning-tree root all",
                    "junos": "show spanning-tree bridge",
                },
                "look_for": "Unexpected root bridge — a rogue switch with lower "
                                "priority hijacking root",
            },
            {
                "description": "Look for ports in err-disabled / BPDU-guard violation",
                "command": {
                    "nxos": "show interface status err-disabled",
                    "iosxe": "show interfaces status err-disabled",
                    "eos": "show errdisabled",
                    "junos": "show ethernet-switching interface | match block",
                },
                "look_for": "Ports shut by BPDU guard — an upstream switch is sending "
                                "BPDUs into an access port",
            },
            {
                "description": "Verify loop guard / root guard status",
                "command": {
                    "nxos": "show spanning-tree detail | include guard",
                    "iosxe": "show spanning-tree detail | include guard",
                    "eos": "show spanning-tree detail | include guard",
                    "junos": "show spanning-tree interface detail",
                },
                "look_for": "Loop-guard or root-guard triggered — indicates a "
                                "unidirectional link or topology misconfiguration",
            },
            {
                "description": "Check for broadcast storm / high CPU from L2 flooding",
                "command": {
                    "nxos": "show interface counters storm-control",
                    "iosxe": "show storm-control broadcast",
                    "eos": "show storm-control",
                    "junos": "show ethernet-switching flood-statistics",
                },
                "look_for": "Storm-control drops rising — active broadcast storm; "
                                "locate the source port",
            },
            {
                "description": "Review STP topology change (TC) history",
                "command": {
                    "nxos": "show spanning-tree detail | include topology",
                    "iosxe": "show spanning-tree detail | include topology",
                    "eos": "show spanning-tree topology-change detail",
                    "junos": "show spanning-tree bridge detail",
                },
                "look_for": "Excessive topology changes — an unstable port is "
                                "triggering continuous MAC re-learning",
            },
        ],
        "causes": [
            {
                "cause": "Rogue root bridge (lower priority device elected root)",
                "confidence": 0.8,
                "indicators": [
                    "Unexpected root bridge ID",
                    "Traffic taking suboptimal path",
                    "Root on an access switch",
                ],
            },
            {
                "cause": "Unidirectional link causing loop-guard trigger",
                "confidence": 0.65,
                "indicators": [
                    "Loop-guard inconsistent state",
                    "Fiber rx ok / tx dark",
                    "One-way BPDUs",
                ],
            },
            {
                "cause": "BPDU guard violation on an access port",
                "confidence": 0.55,
                "indicators": [
                    "Port err-disabled",
                    "BPDU received on portfast interface",
                    "Rogue switch plugged in",
                ],
            },
            {
                "cause": "Missing or inconsistent STP configuration across VLANs",
                "confidence": 0.4,
                "indicators": [
                    "Different root per VLAN",
                    "No root-guard on designated ports",
                    "PVST+/RPVST mismatch",
                ],
            },
        ],
        "remediation": [
            "Set explicit root-bridge priority on the intended root (priority 4096/8192)",
            "Enable root guard on all designated ports facing access/distribution",
            "Enable BPDU guard + portfast on all host-facing access ports",
            "Fix unidirectional links (replace fiber/SFP) and enable UDLD",
            "Enable storm-control on access ports to limit broadcast/multicast flooding",
        ],
    },
    "dhcp_failure": {
        "category": "Services",
        "summary": "DHCP clients are not obtaining IP addresses. The issue may be at "
                       "the DHCP server, relay agent, or client VLAN. Check relay config, "
                       "pool exhaustion, snooping trust, and Option 82.",
        "steps": [
            {
                "description": "Verify the DHCP relay (ip helper-address) configuration",
                "command": {
                    "nxos": "show ip interface <vlan-intf> | include helper",
                    "iosxe": "show ip interface <vlan-intf> | include helper",
                    "eos": "show ip interface <vlan-intf> | include helper",
                    "junos": "show forwarding-options dhcp-relay interface <vlan-intf>",
                },
                "look_for": "Missing or incorrect ip helper-address pointing to the "
                                "DHCP server",
            },
            {
                "description": "Check DHCP snooping status and trust configuration",
                "command": {
                    "nxos": "show ip dhcp snooping",
                    "iosxe": "show ip dhcp snooping",
                    "eos": "show ip dhcp snooping",
                    "junos": "show dhcp-security binding",
                },
                "look_for": "Snooping enabled but uplink/server port not trusted — "
                                "DHCP offers get dropped",
            },
            {
                "description": "Verify DHCP server pool and lease availability",
                "command": {
                    "nxos": "show ip dhcp relay statistics",
                    "iosxe": "show ip dhcp pool",
                    "eos": "show ip dhcp relay counters",
                    "junos": "show system services dhcp pool",
                },
                "look_for": "Pool exhaustion (0 addresses available) or relay "
                                "drops/no-response counters",
            },
            {
                "description": "Capture or count DHCP discover/offer/request/ack",
                "command": {
                    "nxos": "show ip dhcp relay statistics",
                    "iosxe": "show ip dhcp server statistics",
                    "eos": "show ip dhcp relay counters",
                    "junos": "show dhcp-security statistics",
                },
                "look_for": "Discovers sent but no Offers received — relay not "
                                "forwarding, or server unreachable",
            },
        ],
        "causes": [
            {
                "cause": "Missing or incorrect ip helper-address / relay configuration",
                "confidence": 0.8,
                "indicators": [
                    "No helper-address on SVI",
                    "Wrong server IP",
                    "Relay not relaying Discovers",
                ],
            },
            {
                "cause": "DHCP snooping dropping server replies (uplink not trusted)",
                "confidence": 0.7,
                "indicators": [
                    "Snooping enabled, uplink untrusted",
                    "Offer/Ack drops in snooping stats",
                    "Works when snooping disabled",
                ],
            },
            {
                "cause": "DHCP pool exhaustion (no available addresses)",
                "confidence": 0.55,
                "indicators": [
                    "Pool shows 0 free",
                    "Stale leases not reclaimed",
                    "Scope too small for clients",
                ],
            },
            {
                "cause": "Option 82 / relay-information policy mismatch",
                "confidence": 0.4,
                "indicators": [
                    "Server rejects relayed packets",
                    "Option 82 insert vs drop conflict",
                    "Works from server VLAN directly",
                ],
            },
        ],
        "remediation": [
            "Add the correct ip helper-address on the client VLAN SVI",
            "Trust the DHCP snooping uplink port(s) where the server responds",
            "Expand the DHCP pool or reduce lease time to reclaim stale addresses",
            "Align Option 82 handling between the relay and the server",
        ],
    },
    "mtu_blackhole": {
        "category": "Performance",
        "summary": "Large packets (>1500 or >9000) are silently dropped mid-path due "
                       "to an MTU mismatch. TCP connections stall on large transfers "
                       "while small packets/pings succeed.",
        "steps": [
            {
                "description": "Test path MTU with DF-bit set at incremental sizes",
                "command": {
                    "nxos": "ping <dest> df-bit packet-size 1500",
                    "iosxe": "ping <dest> df-bit size 1500",
                    "eos": "ping <dest> df-bit size 1500",
                    "junos": "ping <dest> do-not-fragment size 1500",
                },
                "look_for": "Success at 1500 but failure at 9000 (or vice versa) "
                                "pinpoints the MTU boundary",
            },
            {
                "description": "Check interface MTU on each hop in the path",
                "command": {
                    "nxos": "show interface <intf> | include MTU",
                    "iosxe": "show interfaces <intf> | include MTU",
                    "eos": "show interfaces <intf> | include MTU",
                    "junos": "show interfaces <intf> | match mtu",
                },
                "look_for": "A link with MTU 1500 in a jumbo-frame path, or vice versa",
            },
            {
                "description": "Look for ICMP \"fragmentation needed\" responses",
                "command": {
                    "nxos": "show ip icmp statistics | include frag",
                    "iosxe": "show ip icmp statistics | include frag",
                    "eos": "show ip icmp counters | include frag",
                    "junos": "show system statistics icmp | match frag",
                },
                "look_for": "Outbound \"frag needed but DF set\" — the device "
                                "generating the ICMP is the MTU bottleneck",
            },
            {
                "description": "Verify TCP MSS clamping if configured",
                "command": {
                    "nxos": "show running-config | include tcp.*mss",
                    "iosxe": "show running-config | include ip tcp adjust-mss",
                    "eos": "show running-config | include mss",
                    "junos": "show configuration class-of-service | match tcp-mss",
                },
                "look_for": "TCP MSS adjust may be a workaround in place — or may "
                                "need to be added",
            },
        ],
        "causes": [
            {
                "cause": "Inconsistent MTU on one link in the path (1500 vs 9216)",
                "confidence": 0.85,
                "indicators": [
                    "DF-bit ping fails at certain sizes",
                    "TCP stalls on large transfers",
                    "Small pings succeed",
                ],
            },
            {
                "cause": "Firewall / middle-box dropping ICMP \"frag needed\" messages",
                "confidence": 0.6,
                "indicators": [
                    "No ICMP unreachable returned",
                    "PMTUD fails silently",
                    "Works when DF-bit cleared",
                ],
            },
            {
                "cause": "GRE/VXLAN/IPsec overhead reducing effective MTU",
                "confidence": 0.5,
                "indicators": [
                    "Tunnel interface in path",
                    "Drops at exactly MTU − overhead",
                    "Inner packet too large",
                ],
            },
        ],
        "remediation": [
            "Set consistent MTU end-to-end (9216 for DC fabric, 1500 for WAN)",
            "Allow ICMP type 3 code 4 (fragmentation needed) through all firewalls",
            "Apply \"ip tcp adjust-mss 1400\" on tunnel interfaces to clamp TCP MSS",
            "Account for encapsulation overhead (VXLAN=50, GRE=24, IPsec=58-73)",
        ],
    },
    "aaa_auth_failure": {
        "category": "Services",
        "summary": "AAA/RADIUS/TACACS+ authentication is failing. Users cannot log "
                       "in, or commands are being denied. Verify server reachability, "
                       "shared secret, and the AAA method list.",
        "steps": [
            {
                "description": "Test reachability to the AAA server",
                "command": {
                    "nxos": "ping <aaa-server-ip>",
                    "iosxe": "ping <aaa-server-ip>",
                    "eos": "ping <aaa-server-ip>",
                    "junos": "ping <aaa-server-ip>",
                },
                "look_for": "Packet loss or unreachable — server or routing issue",
            },
            {
                "description": "Check AAA server configuration and status",
                "command": {
                    "nxos": "show aaa authentication",
                    "iosxe": "show aaa servers",
                    "eos": "show aaa",
                    "junos": "show system aaa",
                },
                "look_for": "Server marked dead, high timeout count, or wrong "
                                "port/protocol configured",
            },
            {
                "description": "Verify RADIUS/TACACS+ statistics for success vs failure",
                "command": {
                    "nxos": "show radius-server statistics",
                    "iosxe": "show aaa servers",
                    "eos": "show radius counters",
                    "junos": "show network-access aaa statistics",
                },
                "look_for": "High reject/timeout count — shared-secret mismatch or "
                                "server-side policy denying",
            },
            {
                "description": "Check the fallback method list (local auth as backup)",
                "command": {
                    "nxos": "show aaa authentication",
                    "iosxe": "show running-config | section aaa",
                    "eos": "show running-config | section aaa",
                    "junos": "show configuration system authentication-order",
                },
                "look_for": "\"local\" not in the method list — if RADIUS is down, no "
                                "login at all",
            },
        ],
        "causes": [
            {
                "cause": "RADIUS/TACACS+ server unreachable (routing or firewall)",
                "confidence": 0.8,
                "indicators": [
                    "Ping fails",
                    "Timeout counters rising",
                    "Server marked dead",
                ],
            },
            {
                "cause": "Shared secret mismatch between device and server",
                "confidence": 0.7,
                "indicators": [
                    "Access-Reject immediately",
                    "Wireshark shows bad-authenticator",
                    "\"Invalid shared secret\" in server logs",
                ],
            },
            {
                "cause": "AAA method list missing \"local\" fallback",
                "confidence": 0.55,
                "indicators": [
                    "Cannot login when server is down",
                    "Only remote method in aaa authentication",
                    "Console locked out",
                ],
            },
            {
                "cause": "Server-side policy denying the user/group",
                "confidence": 0.4,
                "indicators": [
                    "Access-Reject with valid credentials",
                    "Works with a different user",
                    "Policy/ACL on RADIUS server",
                ],
            },
        ],
        "remediation": [
            "Restore L3 reachability to the AAA server; check any firewall rules on "
                "UDP 1812/1813 or TCP 49",
            "Align the shared secret on both the device and the server (re-key if needed)",
            "Always include \"local\" as the last method in the aaa authentication "
                "method list",
            "Review the AAA server policy/group membership for the affected users",
        ],
    },
    "hsrp_vrrp": {
        "category": "Redundancy",
        "summary": "The HSRP/VRRP virtual gateway is down or both routers think they "
                       "are active (dual-active). Check priority, preemption, tracking, "
                       "and the keepalive path.",
        "steps": [
            {
                "description": "Check HSRP/VRRP group state on both routers",
                "command": {
                    "nxos": "show hsrp brief",
                    "iosxe": "show standby brief",
                    "eos": "show vrrp",
                    "junos": "show vrrp summary",
                },
                "look_for": "Both routers Active/Master (dual-active) or no Active at "
                                "all (VIP unreachable)",
            },
            {
                "description": "Verify priority and preemption configuration",
                "command": {
                    "nxos": "show hsrp detail",
                    "iosxe": "show standby detail",
                    "eos": "show vrrp detail",
                    "junos": "show vrrp detail",
                },
                "look_for": "Priority mismatch, preempt disabled when it should be "
                                "enabled, or track objects decrementing priority",
            },
            {
                "description": "Check the keepalive / hello path between peers",
                "command": {
                    "nxos": "ping <peer-ip>",
                    "iosxe": "ping <peer-ip>",
                    "eos": "ping <peer-ip>",
                    "junos": "ping <peer-ip>",
                },
                "look_for": "Loss between peers — if hellos do not cross, both go "
                                "Active (split-brain)",
            },
            {
                "description": "Look for tracked interface/object state changes",
                "command": {
                    "nxos": "show track",
                    "iosxe": "show track",
                    "eos": "show track",
                    "junos": "show vrrp track",
                },
                "look_for": "A tracked interface going down decrementing priority "
                                "below the peer — unexpected failover",
            },
        ],
        "causes": [
            {
                "cause": "Dual-active / split-brain (keepalives not crossing)",
                "confidence": 0.85,
                "indicators": [
                    "Both routers Active/Master",
                    "Duplicate VIP ARP",
                    "L2 path between peers broken",
                ],
            },
            {
                "cause": "Track object decrementing priority causing unexpected failover",
                "confidence": 0.65,
                "indicators": [
                    "Tracked interface down",
                    "Priority decremented",
                    "Standby became Active after track change",
                ],
            },
            {
                "cause": "Preemption misconfiguration (failback not happening)",
                "confidence": 0.5,
                "indicators": [
                    "Original primary stays Standby after recovery",
                    "preempt not configured",
                    "Lower-priority stays Active",
                ],
            },
            {
                "cause": "Timer mismatch (hello/hold differ between peers)",
                "confidence": 0.35,
                "indicators": [
                    "Intermittent VIP unreachable",
                    "Aggressive timers on one side",
                    "Flapping Active/Standby",
                ],
            },
        ],
        "remediation": [
            "Restore L2 reachability between HSRP/VRRP peers (fix the shared segment)",
            "Review tracked objects and their decrement values — align with desired "
                "failover behavior",
            "Enable preempt on the intended primary with appropriate delay",
            "Match HSRP/VRRP hello and hold timers on both peers",
        ],
    },
    "mac_flap": {
        "category": "L2 / Switching",
        "summary": "A MAC address is being learned on multiple ports, causing the "
                       "switch to flap the entry back and forth. Typically indicates a "
                       "loop, a VM migration, or an incorrect VLAN trunk.",
        "steps": [
            {
                "description": "Check syslog for MAC move/flap notifications",
                "command": {
                    "nxos": "show logging | include MAC_MOVE|flap",
                    "iosxe": "show logging | include MAC_MOVE|FLAP",
                    "eos": "show logging | include MAC_MOVE|FLAP",
                    "junos": "show log messages | match \"MAC move\"",
                },
                "look_for": "Repeated MAC move messages between two ports — "
                                "identifies the flapping MAC and ports",
            },
            {
                "description": "Verify the MAC address table for the affected address",
                "command": {
                    "nxos": "show mac address-table address <mac>",
                    "iosxe": "show mac address-table address <mac>",
                    "eos": "show mac address-table address <mac>",
                    "junos": "show ethernet-switching table <mac>",
                },
                "look_for": "The MAC alternating between two ports — one is the "
                                "correct path, the other is the loop/mirror",
            },
            {
                "description": "Check for STP state and VLAN membership on both ports",
                "command": {
                    "nxos": "show spanning-tree interface <intf>",
                    "iosxe": "show spanning-tree interface <intf>",
                    "eos": "show spanning-tree interface <intf>",
                    "junos": "show spanning-tree interface <intf>",
                },
                "look_for": "Both ports forwarding in the same VLAN — one should be "
                                "blocking if STP is working",
            },
            {
                "description": "Look for SPAN/RSPAN or other mirroring sessions",
                "command": {
                    "nxos": "show monitor session all",
                    "iosxe": "show monitor session all",
                    "eos": "show monitor session",
                    "junos": "show forwarding-options analyzer",
                },
                "look_for": "An active SPAN session reflecting traffic can cause MAC "
                                "flaps on the destination port",
            },
        ],
        "causes": [
            {
                "cause": "Layer-2 loop (STP not blocking a redundant path)",
                "confidence": 0.8,
                "indicators": [
                    "Two ports forwarding in same VLAN",
                    "Broadcast storm",
                    "High CPU from flooding",
                ],
            },
            {
                "cause": "VM / workload migration (legitimate MAC move)",
                "confidence": 0.55,
                "indicators": [
                    "MAC moves once then stabilizes",
                    "vMotion/live-migration event",
                    "No loop symptoms",
                ],
            },
            {
                "cause": "Incorrect VLAN trunking (VLAN leaking across domains)",
                "confidence": 0.5,
                "indicators": [
                    "VLAN present on unexpected trunk",
                    "MAC seen from an uplink that shouldn't carry it",
                ],
            },
            {
                "cause": "SPAN/mirror session reflecting traffic",
                "confidence": 0.35,
                "indicators": [
                    "Monitor session active",
                    "Flapping stops when SPAN disabled",
                    "Destination port shows the MAC",
                ],
            },
        ],
        "remediation": [
            "If a loop: shut the offending port, fix STP (enable BPDU guard, loop guard)",
            "For VM migration: configure MAC-move allow or increase mac-address-table "
                "aging for the VLAN",
            "Prune the VLAN from trunks where it should not be carried",
            "Remove or fix SPAN sessions that inject traffic and cause MAC confusion",
        ],
    },
    "vpc_mlag": {
        "category": "Redundancy",
        "summary": "The vPC (Cisco) or MLAG (Arista) peer link or keepalive is down, "
                       "causing split-brain or port suspension. Check peer-link, "
                       "keepalive, domain consistency, and port-channel hashing.",
        "steps": [
            {
                "description": "Check vPC/MLAG domain status and peer reachability",
                "command": {
                    "nxos": "show vpc",
                    "iosxe": "show etherchannel summary",
                    "eos": "show mlag",
                    "junos": "show multi-chassis mc-lag status",
                },
                "look_for": "Peer not reachable, peer-link down, or dual-active "
                                "detection triggered",
            },
            {
                "description": "Verify the keepalive link status and messages",
                "command": {
                    "nxos": "show vpc peer-keepalive",
                    "iosxe": "show redundancy",
                    "eos": "show mlag detail",
                    "junos": "show multi-chassis mc-lag status",
                },
                "look_for": "Keepalive timeout / peer unreachable — triggers "
                                "secondary to suspend vPC ports",
            },
            {
                "description": "Check for type-1 consistency violations",
                "command": {
                    "nxos": "show vpc consistency-parameters global",
                    "iosxe": "show etherchannel detail",
                    "eos": "show mlag config-sanity",
                    "junos": "show multi-chassis mc-lag configuration",
                },
                "look_for": "STP mode, VLAN list, or MTU mismatch — type-1 violations "
                                "suspend the vPC/MLAG",
            },
            {
                "description": "Verify individual member port-channel status",
                "command": {
                    "nxos": "show vpc brief",
                    "iosxe": "show etherchannel summary",
                    "eos": "show mlag interfaces",
                    "junos": "show multi-chassis mc-lag interfaces",
                },
                "look_for": "vPC/MLAG port suspended or only active on one side",
            },
        ],
        "causes": [
            {
                "cause": "Peer-link down (L2 trunk between vPC/MLAG peers failed)",
                "confidence": 0.85,
                "indicators": [
                    "Peer-link admin/oper down",
                    "Orphan ports active",
                    "Secondary suspends all vPCs",
                ],
            },
            {
                "cause": "Keepalive timeout / management path failure",
                "confidence": 0.7,
                "indicators": [
                    "Keepalive lost",
                    "Peer assumed dead",
                    "Both peers go primary (split-brain)",
                ],
            },
            {
                "cause": "Type-1 consistency check failure (STP/VLAN/MTU mismatch)",
                "confidence": 0.6,
                "indicators": [
                    "Consistency check failed",
                    "Specific vPCs suspended",
                    "\"Type 1\" in show vpc",
                ],
            },
            {
                "cause": "Port-channel member mismatch (LACP negotiation issue)",
                "confidence": 0.4,
                "indicators": [
                    "LACP not converging",
                    "Member ports suspended individually",
                    "Speed/duplex mismatch",
                ],
            },
        ],
        "remediation": [
            "Restore the peer-link (check fiber, trunk allowed VLANs, STP on peer-link)",
            "Fix the keepalive path (mgmt VRF routing, interface status)",
            "Resolve type-1 consistency violations (align STP mode, VLAN, MTU on both "
                "peers)",
            "Verify LACP system-id, priority, and member interface config matches",
        ],
    },
    "ntp_sync": {
        "category": "Services",
        "summary": "NTP is not synchronized — the device clock is drifting. This "
                       "affects syslog timestamps, certificate validation, DNSSEC, and "
                       "Kerberos/AAA. Verify NTP server reachability and stratum.",
        "steps": [
            {
                "description": "Check NTP association and synchronization status",
                "command": {
                    "nxos": "show ntp peer-status",
                    "iosxe": "show ntp associations",
                    "eos": "show ntp status",
                    "junos": "show ntp associations",
                },
                "look_for": "No \"*\" (selected source), all peers showing \".INIT.\" or "
                                "\"reject\" — no valid time source",
            },
            {
                "description": "Verify reachability to the NTP server",
                "command": {
                    "nxos": "ping <ntp-server-ip>",
                    "iosxe": "ping <ntp-server-ip>",
                    "eos": "ping <ntp-server-ip>",
                    "junos": "ping <ntp-server-ip>",
                },
                "look_for": "Packet loss or unreachable — routing/firewall issue "
                                "blocking UDP 123",
            },
            {
                "description": "Check the NTP source interface configuration",
                "command": {
                    "nxos": "show running-config | include ntp",
                    "iosxe": "show running-config | include ntp",
                    "eos": "show running-config | section ntp",
                    "junos": "show configuration system ntp",
                },
                "look_for": "Source interface not in the routing table, or wrong VRF "
                                "for the NTP server",
            },
            {
                "description": "Verify the clock offset and stratum",
                "command": {
                    "nxos": "show ntp peer-status",
                    "iosxe": "show ntp status",
                    "eos": "show ntp status",
                    "junos": "show ntp status",
                },
                "look_for": "Large offset (>1000 ms) may prevent sync; stratum 16 = "
                                "unsynchronized",
            },
        ],
        "causes": [
            {
                "cause": "NTP server unreachable (routing/firewall blocking UDP 123)",
                "confidence": 0.8,
                "indicators": [
                    "Ping fails",
                    "Reach = 0",
                    ".INIT. state",
                    "ACL dropping UDP 123",
                ],
            },
            {
                "cause": "NTP source interface down or in wrong VRF",
                "confidence": 0.6,
                "indicators": [
                    "Source interface specified but down",
                    "NTP server in different VRF",
                    "Packets never sent",
                ],
            },
            {
                "cause": "Clock offset too large for NTP to sync (>1000s)",
                "confidence": 0.5,
                "indicators": [
                    "Stratum 16",
                    "Huge offset in show ntp",
                    "Device time way off",
                    "Need manual clock set",
                ],
            },
            {
                "cause": "NTP authentication key mismatch",
                "confidence": 0.35,
                "indicators": [
                    "Auth enabled, key mismatch",
                    "Rejected packets in NTP stats",
                    "Works without auth",
                ],
            },
        ],
        "remediation": [
            "Restore reachability to the NTP server (fix routing, allow UDP 123)",
            "Set the NTP source interface to a reachable loopback in the correct VRF",
            "If offset > 1000s, manually set the clock close to correct time, then "
                "NTP will sync",
            "Align NTP authentication keys between device and server",
        ],
    },
    "hardware_failure": {
        "category": "Device Health",
        "summary": "A hardware component (PSU, fan, line card, supervisor, or optic) "
                       "is failing or degraded. Check environmental sensors, module "
                       "status, and syslog for hardware alarms.",
        "steps": [
            {
                "description": "Check power supply status",
                "command": {
                    "nxos": "show environment power",
                    "iosxe": "show environment power",
                    "eos": "show environment power",
                    "junos": "show chassis power",
                },
                "look_for": "PSU failed/absent — risk of single-PSU operation or "
                                "total power loss",
            },
            {
                "description": "Verify fan tray status and temperature",
                "command": {
                    "nxos": "show environment fan",
                    "iosxe": "show environment",
                    "eos": "show environment cooling",
                    "junos": "show chassis environment",
                },
                "look_for": "Fan failed or temperature critical — device may "
                                "thermal-shutdown",
            },
            {
                "description": "Check line card / module operational status",
                "command": {
                    "nxos": "show module",
                    "iosxe": "show module",
                    "eos": "show module",
                    "junos": "show chassis fpc",
                },
                "look_for": "Module powered-off/failed/inserted but not online — a "
                                "linecard failure",
            },
            {
                "description": "Look for transceiver / optic alarms",
                "command": {
                    "nxos": "show interface transceiver details",
                    "iosxe": "show interfaces transceiver detail",
                    "eos": "show interfaces transceiver",
                    "junos": "show interfaces diagnostics optics",
                },
                "look_for": "DOM high/low alarm on Rx/Tx power, temperature, or "
                                "voltage — failing optic",
            },
            {
                "description": "Review syslog for hardware error events",
                "command": {
                    "nxos": "show logging | include HARDWARE|POWER|FAN|SENSOR",
                    "iosxe": "show logging | include ENVIRONMENT|POWER|FAN",
                    "eos": "show logging | include hardware|power|fan",
                    "junos": "show log messages | match \"CHASSIS|ALARM|FPC\"",
                },
                "look_for": "Hardware alarm events with timestamps — correlate with "
                                "the observed issue",
            },
        ],
        "causes": [
            {
                "cause": "Power supply failure (single PSU operation)",
                "confidence": 0.75,
                "indicators": [
                    "PSU status: failed/absent",
                    "Power alarm in syslog",
                    "Reduced power budget",
                ],
            },
            {
                "cause": "Fan failure causing thermal shutdown risk",
                "confidence": 0.65,
                "indicators": [
                    "Fan status: failed",
                    "Temperature rising",
                    "Thermal alarm syslog",
                ],
            },
            {
                "cause": "Line card / FPC offline or failing",
                "confidence": 0.55,
                "indicators": [
                    "Module not online",
                    "Ports on the module down",
                    "FPC restarting",
                ],
            },
            {
                "cause": "Failing optical transceiver (DOM alarms)",
                "confidence": 0.5,
                "indicators": [
                    "Rx/Tx power outside spec",
                    "Temperature alarm",
                    "CRC errors on that port",
                ],
            },
        ],
        "remediation": [
            "Replace the failed PSU immediately to restore redundant power",
            "Replace the failed fan tray and verify temperature normalizes",
            "Reseat or replace the failed line card; check for software compatibility",
            "Replace the failing optic; verify DOM levels return to normal after swap",
        ],
    },
    "memory_exhaustion": {
        "category": "Device Health",
        "summary": "Device memory is critically high or exhausted. This can cause "
                       "process crashes, routing instability, and loss of management "
                       "access. Identify the top memory consumer.",
        "steps": [
            {
                "description": "Check overall system memory utilization",
                "command": {
                    "nxos": "show system resources",
                    "iosxe": "show processes memory sorted",
                    "eos": "show processes top once",
                    "junos": "show chassis routing-engine",
                },
                "look_for": "Memory utilization above 85% — risk of OOM kills and "
                                "process instability",
            },
            {
                "description": "Identify the top memory-consuming process",
                "command": {
                    "nxos": "show processes memory | head 20",
                    "iosxe": "show processes memory sorted | head 20",
                    "eos": "show processes top once",
                    "junos": "show system processes extensive | match \"PID|Mem\"",
                },
                "look_for": "A single process consuming disproportionate memory — "
                                "potential memory leak",
            },
            {
                "description": "Check the routing table size (BGP RIB scale)",
                "command": {
                    "nxos": "show ip route summary",
                    "iosxe": "show ip route summary",
                    "eos": "show ip route summary",
                    "junos": "show route summary",
                },
                "look_for": "Very large route count (full DFZ table without enough "
                                "memory) can exhaust memory",
            },
            {
                "description": "Look for memory-related syslog events",
                "command": {
                    "nxos": "show logging | include memory|MEM|OOM",
                    "iosxe": "show logging | include MALLOCFAIL|SYS-2-MALLOCFAIL",
                    "eos": "show logging | include memory|oom",
                    "junos": "show log messages | match \"memory|KERNEL\"",
                },
                "look_for": "MALLOCFAIL / OOM events — process was denied memory "
                                "allocation",
            },
        ],
        "causes": [
            {
                "cause": "Memory leak in a process (gradual increase over time)",
                "confidence": 0.75,
                "indicators": [
                    "One process memory growing over days",
                    "Resolves after process restart",
                    "Known software bug",
                ],
            },
            {
                "cause": "Route table exhaustion (full Internet table on undersized "
                             "platform)",
                "confidence": 0.65,
                "indicators": [
                    "500K+ routes in RIB",
                    "BGP process is top memory consumer",
                    "Platform has limited RAM",
                ],
            },
            {
                "cause": "Configuration bloat (very large ACLs, prefix-lists, or "
                             "object-groups)",
                "confidence": 0.45,
                "indicators": [
                    "Large running-config",
                    "Config process high memory",
                    "Thousands of ACL entries",
                ],
            },
            {
                "cause": "ARP/MAC/FIB table explosion from broadcast domain too large",
                "confidence": 0.4,
                "indicators": [
                    "show arp count very high",
                    "Flat L2 domain",
                    "ARP process memory growing",
                ],
            },
        ],
        "remediation": [
            "If a memory leak: restart the affected process, then plan a software "
                "upgrade with the fix",
            "For route exhaustion: add ORF/filter to limit received prefixes, or "
                "upgrade platform RAM",
            "Reduce configuration size (consolidate ACLs, use object-groups, remove "
                "unused entries)",
            "Segment large broadcast domains with VLANs to reduce ARP/MAC table pressure",
        ],
    },
    "routing_loop": {
        "category": "Routing",
        "summary": "Traffic is looping between hops — packets hit TTL expiry and are "
                       "dropped. Traceroute shows the same hops repeating. Usually caused "
                       "by asymmetric static routes or redistribution.",
        "steps": [
            {
                "description": "Trace the path to the destination and look for loops",
                "command": {
                    "nxos": "traceroute <dest>",
                    "iosxe": "traceroute <dest>",
                    "eos": "traceroute <dest>",
                    "junos": "traceroute <dest>",
                },
                "look_for": "Hops repeating (A → B → A → B) — the loop point is "
                                "between these two devices",
            },
            {
                "description": "Check the routing table on each device in the loop",
                "command": {
                    "nxos": "show ip route <dest>",
                    "iosxe": "show ip route <dest>",
                    "eos": "show ip route <dest>",
                    "junos": "show route <dest>",
                },
                "look_for": "Each device points to the other as next-hop — recursive "
                                "or mutual static routes",
            },
            {
                "description": "Look for route redistribution or default route injection",
                "command": {
                    "nxos": "show ip route <dest> detail",
                    "iosxe": "show ip route <dest>",
                    "eos": "show ip route <dest> detail",
                    "junos": "show route <dest> detail",
                },
                "look_for": "Route learned via redistribution from a routing protocol "
                                "that should not advertise it",
            },
            {
                "description": "Check ICMP TTL-exceeded counters",
                "command": {
                    "nxos": "show ip icmp statistics",
                    "iosxe": "show ip icmp statistics",
                    "eos": "show ip icmp counters",
                    "junos": "show system statistics icmp | match \"time exceed\"",
                },
                "look_for": "High TTL-exceeded count — confirms packets are looping "
                                "and being dropped",
            },
        ],
        "causes": [
            {
                "cause": "Mutual static/default routes creating a forwarding loop",
                "confidence": 0.8,
                "indicators": [
                    "Static route to peer, peer has static back",
                    "No dynamic routing for the prefix",
                    "Asymmetric next-hops",
                ],
            },
            {
                "cause": "Route redistribution feedback loop",
                "confidence": 0.65,
                "indicators": [
                    "Route redistributed into the protocol it came from",
                    "No route-map filtering redistribution",
                    "Suboptimal route installed",
                ],
            },
            {
                "cause": "Policy-based routing (PBR) overriding the RIB",
                "confidence": 0.45,
                "indicators": [
                    "PBR on one device, RIB on the other",
                    "Packets match PBR and loop back",
                    "Works when PBR disabled",
                ],
            },
            {
                "cause": "Summarization or default-route causing a less-specific match",
                "confidence": 0.4,
                "indicators": [
                    "Summary route attracts traffic meant for a more-specific",
                    "Null0 / discard route missing",
                    "Asymmetric summarization",
                ],
            },
        ],
        "remediation": [
            "Remove or fix the conflicting static routes; use a dynamic protocol if "
                "possible",
            "Add route-map tags and deny on redistribution to prevent feedback loops",
            "If PBR is involved, ensure both directions are consistent or add a PBR "
                "deny for return traffic",
            "Add a Null0 / discard route for the summary to prevent routing loops on "
                "less-specific matches",
        ],
    },
    "isis_adjacency": {
        "category": "Routing",
        "summary": "IS-IS neighbors are not forming or are stuck. Common in DC "
                       "spine-leaf fabrics. Check system-id, area, level, authentication, "
                       "and interface IS-IS enablement.",
        "steps": [
            {
                "description": "Check IS-IS adjacency state",
                "command": {
                    "nxos": "show isis adjacency",
                    "iosxe": "show isis neighbors",
                    "eos": "show isis neighbors",
                    "junos": "show isis adjacency",
                },
                "look_for": "Missing neighbor or state DOWN — adjacency not forming",
            },
            {
                "description": "Verify IS-IS is enabled on the interface",
                "command": {
                    "nxos": "show isis interface brief",
                    "iosxe": "show isis interface brief",
                    "eos": "show isis interface brief",
                    "junos": "show isis interface",
                },
                "look_for": "Interface not listed — IS-IS not enabled on the link, or "
                                "wrong IS-IS instance",
            },
            {
                "description": "Compare NET (network entity title) and IS-type on "
                                   "both sides",
                "command": {
                    "nxos": "show isis",
                    "iosxe": "show isis protocol",
                    "eos": "show isis summary",
                    "junos": "show isis overview",
                },
                "look_for": "Area mismatch (NET area-id differs) or level mismatch "
                                "(L1 vs L2 on opposite sides)",
            },
            {
                "description": "Check IS-IS authentication configuration",
                "command": {
                    "nxos": "show running-config router isis",
                    "iosxe": "show running-config | section router isis",
                    "eos": "show running-config | section router isis",
                    "junos": "show configuration protocols isis",
                },
                "look_for": "Authentication key mismatch — IS-IS hellos silently rejected",
            },
            {
                "description": "Verify MTU compatibility for IS-IS",
                "command": {
                    "nxos": "show interface <intf> | include MTU",
                    "iosxe": "show interfaces <intf> | include MTU",
                    "eos": "show interfaces <intf> | include MTU",
                    "junos": "show interfaces <intf> | match mtu",
                },
                "look_for": "MTU mismatch — IS-IS padding detects this but it can "
                                "still cause adjacency issues",
            },
        ],
        "causes": [
            {
                "cause": "IS-IS not enabled on the interface",
                "confidence": 0.8,
                "indicators": [
                    "Interface not in \"show isis interface\"",
                    "No \"isis enable\" under interface",
                    "Wrong instance name",
                ],
            },
            {
                "cause": "Area (NET) mismatch between neighbors",
                "confidence": 0.7,
                "indicators": [
                    "Different area-id in NET",
                    "L1 adjacency requires same area",
                    "show isis shows different NET",
                ],
            },
            {
                "cause": "IS-IS level mismatch (L1-only vs L2-only)",
                "confidence": 0.6,
                "indicators": [
                    "One side L1-only, other L2-only",
                    "No common level",
                    "Adjacency never forms",
                ],
            },
            {
                "cause": "Authentication key/type mismatch",
                "confidence": 0.45,
                "indicators": [
                    "Auth configured but key differs",
                    "PDU rejected counter incrementing",
                    "Hellos sent but no response",
                ],
            },
        ],
        "remediation": [
            "Enable IS-IS on the interface under the correct instance (\"isis enable "
                "<tag>\")",
            "Align the NET area-id on neighbors that need L1 adjacency",
            "Set a compatible IS-IS level (both L2 for spine-leaf fabric, or both L1-2)",
            "Match the IS-IS authentication type and key on both sides",
        ],
    },
}


GENERIC_PLAYBOOK: dict[str, Any] = {
    "category": "General",
    "summary": "Unrecognized symptom — running a generic network triage workflow.",
    "steps": [
        {
            "description": "Confirm device reachability and management access",
            "command": {
                "nxos":  "ping <device-ip>",
                "iosxe": "ping <device-ip>",
                "eos":   "ping <device-ip>",
                "junos": "ping <device-ip>",
            },
            "look_for": "Whether the affected device is reachable on the management plane at all",
        },
        {
            "description": "Review recent log messages for errors/events",
            "command": {
                "nxos":  "show logging last 100",
                "iosxe": "show logging",
                "eos":   "show logging last 100",
                "junos": "show log messages",
            },
            "look_for": "Interface flaps, protocol resets, hardware faults, or syslog errors",
        },
        {
            "description": "Check interface status across the device",
            "command": {
                "nxos":  "show interface status",
                "iosxe": "show interfaces status",
                "eos":   "show interfaces status",
                "junos": "show interfaces terse",
            },
            "look_for": "Down/err-disabled interfaces and high error counters",
        },
        {
            "description": "Check overall control-plane / system health",
            "command": {
                "nxos":  "show system resources",
                "iosxe": "show processes cpu sorted",
                "eos":   "show processes top once",
                "junos": "show chassis routing-engine",
            },
            "look_for": "High CPU/memory, environmental alarms, or process crashes",
        },
    ],
    "causes": [
        {
            "cause": "Configuration or recent change introduced the fault",
            "confidence": 0.40,
            "indicators": ["Issue started after a change window", "Diff vs last-good config"],
        },
        {
            "cause": "Physical-layer or hardware fault",
            "confidence": 0.35,
            "indicators": ["Interface errors", "Environmental/PSU/fan alarms in logs"],
        },
        {
            "cause": "Transient / load-related condition",
            "confidence": 0.25,
            "indicators": ["Intermittent symptoms", "Correlates with traffic peaks"],
        },
    ],
    "remediation": [
        "Capture the current state and compare against the last-known-good baseline.",
        "Isolate the failing layer (physical → L2 → L3 → application) methodically.",
        "Roll back the most recent change if the issue began after a deployment.",
        "Escalate with collected show outputs if the root cause remains unconfirmed.",
    ],
}


def _normalize_platform(platform: str | None) -> str:
    p = (platform or "").strip().lower()
    return p if p in SUPPORTED_PLATFORMS else DEFAULT_PLATFORM


def _normalize_symptom(symptom: str | None) -> str:
    return (symptom or "").strip().lower().replace("-", "_").replace(" ", "_")


def _render_steps(raw_steps: list[dict[str, Any]], platform: str) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for idx, step in enumerate(raw_steps, start=1):
        steps.append({
            "order": idx,
            "description": step["description"],
            "command": _cmd(step.get("command", ""), platform),
            "look_for": step.get("look_for", ""),
        })
    return steps


def _render_causes(raw_causes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    causes = [
        {
            "cause": c["cause"],
            "confidence": round(float(c.get("confidence", 0.0)), 2),
            "indicators": list(c.get("indicators", [])),
        }
        for c in raw_causes
    ]
    return sorted(causes, key=lambda c: c["confidence"], reverse=True)


def build_troubleshooting(
    symptom: str,
    affected_devices: list[str] | None = None,
    platform: str = "nxos",
) -> dict[str, Any]:
    """
    Build a structured troubleshooting playbook for a symptom on a platform.

    Unknown symptoms fall back to the generic ("General") playbook.
    Platform defaults to nxos if unknown/unspecified.
    """
    affected = list(affected_devices or [])
    plat = _normalize_platform(platform)
    key = _normalize_symptom(symptom)

    playbook = PLAYBOOKS.get(key, GENERIC_PLAYBOOK)

    summary = playbook["summary"]
    if affected:
        summary = f"{summary} Affected device(s): {', '.join(affected)}."

    return {
        "symptom": key or "unknown",
        "category": playbook["category"],
        "summary": summary,
        "diagnostic_steps": _render_steps(playbook["steps"], plat),
        "likely_causes": _render_causes(playbook["causes"]),
        "remediation": list(playbook["remediation"]),
    }
