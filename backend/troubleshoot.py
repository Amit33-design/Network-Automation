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
                "description": "Check BGP neighbor session state and uptime",
                "command": {
                    "nxos":  "show ip bgp summary",
                    "iosxe": "show ip bgp summary",
                    "eos":   "show ip bgp summary",
                    "junos": "show bgp summary",
                },
                "look_for": "State/PfxRcd column — Idle/Active/Connect means session not Established",
            },
            {
                "description": "Inspect neighbor-specific details and last reset reason",
                "command": {
                    "nxos":  "show ip bgp neighbors",
                    "iosxe": "show ip bgp neighbors",
                    "eos":   "show ip bgp neighbors",
                    "junos": "show bgp neighbor",
                },
                "look_for": "Last reset reason, hold-time expired, peer AS, and configured vs received AS",
            },
            {
                "description": "Verify L3 reachability to the BGP peer address",
                "command": {
                    "nxos":  "ping <peer-ip> vrf <vrf>",
                    "iosxe": "ping <peer-ip>",
                    "eos":   "ping <peer-ip>",
                    "junos": "ping <peer-ip>",
                },
                "look_for": "Packet loss or unreachable — underlay/IGP problem blocking the TCP/179 session",
            },
            {
                "description": "Check BFD session state for the peer (fast failure detection)",
                "command": {
                    "nxos":  "show bfd neighbors",
                    "iosxe": "show bfd neighbors",
                    "eos":   "show bfd peers",
                    "junos": "show bfd session",
                },
                "look_for": "BFD Down can tear the BGP session even when the link is physically up",
            },
            {
                "description": "Review route-map / prefix-list policy applied to the neighbor",
                "command": {
                    "nxos":  "show route-map",
                    "iosxe": "show route-map",
                    "eos":   "show route-map",
                    "junos": "show policy-options",
                },
                "look_for": "Policy that filters all prefixes or a recently changed import/export policy",
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
                "description": "Check EVPN BGP address-family neighbor state",
                "command": {
                    "nxos":  "show bgp l2vpn evpn summary",
                    "iosxe": "show bgp l2vpn evpn summary",
                    "eos":   "show bgp evpn summary",
                    "junos": "show bgp summary",
                },
                "look_for": "EVPN AF Established and PfxRcd > 0 toward spines/route-reflectors",
            },
            {
                "description": "Verify NVE/VTEP interface and peer reachability",
                "command": {
                    "nxos":  "show nve peers",
                    "iosxe": "show nve peers",
                    "eos":   "show vxlan vtep",
                    "junos": "show interfaces vtep",
                },
                "look_for": "VTEP peers present and Up; source loopback reachable in the underlay",
            },
            {
                "description": "Check VNI-to-VLAN bindings and VNI state",
                "command": {
                    "nxos":  "show nve vni",
                    "iosxe": "show nve vni",
                    "eos":   "show vxlan vni",
                    "junos": "show ethernet-switching vxlan-tunnel-end-point remote",
                },
                "look_for": "VNI Up and mapped to the correct VLAN/bridge-domain on all leaves",
            },
            {
                "description": "Inspect EVPN route-targets (import/export) for the L2/L3 VNI",
                "command": {
                    "nxos":  "show bgp l2vpn evpn",
                    "iosxe": "show bgp l2vpn evpn",
                    "eos":   "show bgp evpn route-type mac-ip",
                    "junos": "show route table bgp.evpn.0",
                },
                "look_for": "Route-target mismatch — type-2/type-5 routes received but not imported",
            },
            {
                "description": "Validate learned MAC/host (type-2) routes for the VNI",
                "command": {
                    "nxos":  "show l2route evpn mac all",
                    "iosxe": "show l2route evpn mac all",
                    "eos":   "show bgp evpn route-type mac-ip",
                    "junos": "show evpn database",
                },
                "look_for": "Remote MACs/hosts present; missing entries mean type-2 routes not propagated",
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
