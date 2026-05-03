"""
NetDesign AI — Troubleshooting Engine (Step 2)
================================================
Root-cause analysis (RCA) correlator that takes multiple observed symptoms,
maps them to probable root causes, and produces:

  1. RootCauseAnalysis  — ranked root-cause hypotheses with evidence chains
  2. Runbook            — ordered investigation steps for the top hypothesis
  3. Mermaid fault-tree — visual diagram of the fault chain

Public API:
    correlate(state, symptom_texts)       → RootCauseAnalysis
    build_runbook(state, rca)             → Runbook
    fault_tree_mermaid(rca)               → str (Mermaid diagram)
    quick_triage(state, symptom_texts)    → dict (one-shot triage result)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from monitor_engine import diagnose as _diagnose, ISSUES

# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Hypothesis:
    """A single root-cause hypothesis."""
    root_cause_id:  str          # e.g. "UNDERLAY_FAILURE"
    title:          str
    confidence:     int          # 0-100
    evidence:       list[str]    # issue IDs that support this hypothesis
    explanation:    str          # plain-English why these symptoms → this cause
    blast_radius:   str          # "isolated" | "rack" | "fabric" | "full-network"
    urgency:        str          # "critical" | "high" | "medium" | "low"
    first_check:    str          # single most important command to run first
    resolution_path: list[str]   # ordered fix steps (high-level)

@dataclass
class RootCauseAnalysis:
    """Output of correlate()."""
    hypotheses:     list[Hypothesis]   # ranked, best first
    top:            Hypothesis | None
    supporting_issues: list[str]       # issue IDs from diagnose() matches
    categories_hit: list[str]
    symptom_count:  int
    confidence_summary: str

@dataclass
class RunbookStep:
    phase:        str    # "verify" | "isolate" | "fix" | "confirm"
    step_num:     int
    title:        str
    description:  str
    commands:     dict[str, list[str]]   # platform → CLI
    expected:     str    # what to expect if hypothesis is correct
    escalate_if:  str    # what to do if this step shows something unexpected

@dataclass
class Runbook:
    title:       str
    hypothesis:  str
    platform:    str
    steps:       list[RunbookStep]
    total_steps: int
    estimated_minutes: int


# ─────────────────────────────────────────────────────────────────────────────
# Root-cause correlation rules
# ─────────────────────────────────────────────────────────────────────────────
# Each rule maps a set of issue IDs (evidence) to a root-cause hypothesis.
# Score = sum of weights for each matching evidence issue.
# ─────────────────────────────────────────────────────────────────────────────

_RCA_RULES: list[dict] = [
    {
        "id": "UNDERLAY_FAILURE",
        "title": "Underlay IGP Failure (OSPF/IS-IS Adjacency Lost)",
        "description": (
            "The underlay routing protocol (OSPF/ISIS) has lost adjacency on one or more "
            "links. This causes BGP loopbacks to become unreachable, which tears down iBGP "
            "sessions and collapses VXLAN NVE peer state — producing a cascade of L2/L3/EVPN "
            "symptoms from a single physical or configuration fault."
        ),
        "evidence_weights": {
            "BGP_NEIGHBOR_DOWN":    0.35,
            "VTEP_UNREACHABLE":     0.30,
            "EVPN_TYPE2_MISSING":   0.15,
            "EVPN_TYPE3_MISSING":   0.15,
            "ROUTE_MISSING":        0.20,
            "OSPF_NEIGHBOR_DOWN":   0.45,
            "PING_FAILURE":         0.10,
        },
        "blast_radius": "fabric",
        "urgency": "critical",
        "first_check": "show ip ospf neighbors",
        "resolution_path": [
            "Verify OSPF/ISIS adjacency: `show ip ospf neighbors` / `show isis neighbors`",
            "Check P2P link status and MTU: `show interface <p2p-link>`",
            "Verify OSPF area, auth, and timers on both ends",
            "Restore adjacency → BGP sessions will re-establish automatically",
            "Verify NVE peers recover: `show nve peers`",
        ],
        "uc_relevance": ["dc", "hybrid", "gpu"],
    },
    {
        "id": "SPINE_FAILURE",
        "title": "Spine Switch Failure or Overload",
        "description": (
            "A spine switch has failed or is severely degraded. All leaf switches lose "
            "the ECMP path through that spine, halving available bandwidth. If only one "
            "spine remains, the remaining VTEP peer sessions re-converge via BFD/BGP GR, "
            "but bandwidth is reduced until the spine is restored."
        ),
        "evidence_weights": {
            "BGP_NEIGHBOR_DOWN":    0.30,
            "VTEP_UNREACHABLE":     0.25,
            "ECMP_IMBALANCE":       0.30,
            "ROUTE_MISSING":        0.15,
            "CPU_HIGH_COPP":        0.20,
            "INTERFACE_DOWN":       0.25,
        },
        "blast_radius": "fabric",
        "urgency": "critical",
        "first_check": "show interface status | grep down",
        "resolution_path": [
            "Identify failed spine: `show interface status | grep down`",
            "Check chassis health: `show environment`",
            "Verify surviving spine carries all traffic: `show bgp summary`",
            "Replace/restore spine hardware",
            "Re-verify ECMP convergence: `show ip route <prefix>` — should show 2+ paths",
        ],
        "uc_relevance": ["dc", "hybrid", "gpu"],
    },
    {
        "id": "EVPN_POLICY_MISCONFIGURATION",
        "title": "EVPN Route-Target / VNI Policy Misconfiguration",
        "description": (
            "EVPN routes are present in BGP but not being imported into the correct VRFs "
            "or VLANs. This indicates a route-target (RT) import/export mismatch or VNI "
            "mapping inconsistency between VTEPs. The control plane is healthy; the fault "
            "is a configuration discrepancy."
        ),
        "evidence_weights": {
            "EVPN_RT_MISMATCH":     0.50,
            "EVPN_TYPE2_MISSING":   0.25,
            "EVPN_TYPE5_MISSING":   0.35,
            "L3VNI_MISSING":        0.30,
            "VNI_MISMATCH":         0.40,
            "ROUTE_MISSING":        0.10,
        },
        "blast_radius": "rack",
        "urgency": "high",
        "first_check": "show bgp l2vpn evpn | grep 'Route Target'",
        "resolution_path": [
            "Collect RT from all VTEPs: `show nve vni detail` / `show vxlan vni`",
            "Confirm RT export on sender matches RT import on receiver",
            "Fix RT: `route-target import/export auto` or explicit manual match",
            "Verify L3VNI: `show nve vni | grep L3`",
            "Clear and re-import: `clear bgp l2vpn evpn * soft`",
        ],
        "uc_relevance": ["dc", "hybrid"],
    },
    {
        "id": "PFC_DEADLOCK_GPU",
        "title": "PFC Deadlock / Lossless Queue Storm (GPU Fabric)",
        "description": (
            "The PFC (Priority Flow Control) mechanism has entered a deadlock state: "
            "all lossless queues are paused waiting for each other to drain. GPU-to-GPU "
            "RDMA traffic stalls completely. PFC watchdog should break this automatically "
            "but may not be configured or its action may be set to 'forward' instead of 'drop'."
        ),
        "evidence_weights": {
            "PFC_STORM":            0.60,
            "RDMA_LOSSLESS_DROPS":  0.40,
            "DCQCN_NOT_CONFIGURED": 0.25,
            "PFC_PRIORITY_WRONG":   0.30,
            "ECMP_IMBALANCE":       0.10,
        },
        "blast_radius": "fabric",
        "urgency": "critical",
        "first_check": "show pfc watchdog stats",
        "resolution_path": [
            "Check PFC watchdog: `show pfc watchdog stats` / `pfcstat -s all`",
            "Enable watchdog with 'drop' action: `pfcwd start --action drop --restoration-time 200`",
            "Verify DCQCN ECN thresholds: Kmin=50KB Kmax=100KB on queue 3",
            "Confirm PFC priority 3 end-to-end (NIC → TOR → Spine)",
            "Restart RDMA workload after fabric clears",
        ],
        "uc_relevance": ["gpu"],
    },
    {
        "id": "VXLAN_ENCAP_MISCONFIGURATION",
        "title": "VXLAN Encapsulation / NVE Misconfiguration",
        "description": (
            "The VXLAN overlay is not functioning due to a configuration gap on the VTEP. "
            "The NVE interface may be down (loopback source down, feature not enabled), "
            "VNIs may be missing or mismatched, or L3VNI transit SVIs are absent. "
            "The underlay is healthy — this is a pure overlay config problem."
        ),
        "evidence_weights": {
            "NVE_INTERFACE_DOWN":       0.50,
            "L3VNI_MISSING":            0.40,
            "VNI_MISMATCH":             0.35,
            "ANYCAST_GW_NOT_RESPONDING":0.25,
            "EVPN_TYPE3_MISSING":       0.20,
        },
        "blast_radius": "rack",
        "urgency": "high",
        "first_check": "show interface nve1",
        "resolution_path": [
            "Check NVE/Vxlan1 interface: `show interface nve1`",
            "Verify NVE source loopback is up: `show interface loopback1`",
            "Check all VNIs configured: `show nve vni` — should show member VNIs",
            "Check L3VNI transit VLAN and SVI exist",
            "Verify BGP EVPN AF is active: `show bgp summary`",
        ],
        "uc_relevance": ["dc", "hybrid", "gpu"],
    },
    {
        "id": "L2_DOMAIN_ISOLATION",
        "title": "L2 Domain Isolation (VLAN / Trunk Misconfiguration)",
        "description": (
            "Hosts that should be in the same broadcast domain cannot communicate. "
            "The VLAN is either not configured on one switch, not allowed on a trunk, "
            "or the access port is in the wrong VLAN. This is a pure L2 configuration "
            "fault with no impact beyond the affected VLAN."
        ),
        "evidence_weights": {
            "VLAN_MISMATCH":        0.55,
            "NATIVE_VLAN_MISMATCH": 0.25,
            "STP_TOPOLOGY_CHANGE":  0.20,
            "PORT_ERRORDISABLED":   0.20,
            "PING_FAILURE":         0.10,
            "DHCP_NO_ADDRESS":      0.15,
        },
        "blast_radius": "isolated",
        "urgency": "high",
        "first_check": "show vlan brief",
        "resolution_path": [
            "Verify VLAN exists on both switches: `show vlan brief`",
            "Check trunk allows the VLAN: `show interface <trunk> trunk`",
            "Check access port assignment: `show interface <port> switchport`",
            "Check for STP blocking: `show spanning-tree vlan <vlan>`",
            "Verify MAC learned: `show mac address-table vlan <vlan>`",
        ],
        "uc_relevance": ["dc", "campus", "hybrid"],
    },
    {
        "id": "MTU_BLACKHOLE",
        "title": "Path MTU Black Hole (VXLAN/Jumbo Frame Mismatch)",
        "description": (
            "Large packets are silently dropped along the path because the effective "
            "MTU is less than the packet size. ICMP PMTUD messages are either not "
            "generated (DF bit not set) or are blocked. VXLAN adds 50B overhead, "
            "requiring fabric interfaces to be at least MTU 9216. If any hop is "
            "under this value, TCP/RDMA sessions degrade silently."
        ),
        "evidence_weights": {
            "MTU_MISMATCH":          0.60,
            "RDMA_LOSSLESS_DROPS":   0.15,
            "VTEP_UNREACHABLE":      0.10,
            "PING_FAILURE":          0.15,
            "INTERFACE_ERRORS":      0.05,
        },
        "blast_radius": "fabric",
        "urgency": "high",
        "first_check": "ping <dst> df-bit packet-size 8972",
        "resolution_path": [
            "Binary-search MTU: `ping <dst> df-bit packet-size 8972` → decrease until pass",
            "Find bottleneck hop via: `traceroute <dst>` then check MTU on each hop",
            "Set fabric MTU: `mtu 9216` on all P2P and NVE source interfaces",
            "Set host MTU: NIC mtu 9000 (or 9214 for GPU/RoCEv2)",
            "Verify: `ping <dst> df-bit packet-size 8972` should succeed end-to-end",
        ],
        "uc_relevance": ["dc", "hybrid", "gpu"],
    },
    {
        "id": "BGP_POLICY_FILTER",
        "title": "BGP Route Filtered by Policy (Route-Map / Prefix-List)",
        "description": (
            "A BGP prefix is present on the originating router but not reaching "
            "the intended peer. The BGP session is established and healthy, but an "
            "outbound or inbound route-map/prefix-list is silently dropping the route. "
            "This is a common misconfiguration after policy changes or new prefix additions."
        ),
        "evidence_weights": {
            "BGP_PREFIX_NOT_SENT":  0.55,
            "ROUTE_MISSING":        0.30,
            "ROUTE_BLACKHOLE":      0.15,
            "EVPN_TYPE5_MISSING":   0.15,
        },
        "blast_radius": "isolated",
        "urgency": "high",
        "first_check": "show bgp neighbors <peer> advertised-routes | grep <prefix>",
        "resolution_path": [
            "Verify prefix in local BGP RIB: `show bgp ipv4 unicast <prefix>`",
            "Check outbound policy: `show bgp neighbors <peer> | grep route-map`",
            "Trace route-map: `show route-map <name>` — which seq matches and what action?",
            "Add explicit permit before implicit deny or update prefix-list",
            "Soft-reset to apply: `clear ip bgp <peer> soft out`",
        ],
        "uc_relevance": ["dc", "campus", "hybrid", "gpu"],
    },
    {
        "id": "DHCP_INFRASTRUCTURE_FAILURE",
        "title": "DHCP Infrastructure Failure (Relay / Server / Snooping)",
        "description": (
            "Clients cannot obtain IP addresses via DHCP. This may be caused by a "
            "missing relay (ip helper-address) on the SVI, DHCP snooping blocking "
            "discovers/offers, an exhausted pool, or the DHCP server being unreachable. "
            "The symptom cascade: no IP → APIPA address → cannot reach gateway → L3 issues."
        ),
        "evidence_weights": {
            "DHCP_NO_ADDRESS":      0.55,
            "DHCP_SNOOPING_DROP":   0.35,
            "DHCP_POOL_EXHAUSTED":  0.30,
            "PING_FAILURE":         0.10,
            "WIFI_AUTH_FAILURE":    0.10,
        },
        "blast_radius": "rack",
        "urgency": "high",
        "first_check": "show ip dhcp snooping statistics",
        "resolution_path": [
            "Check relay on SVI: `show run interface vlan <vlan> | grep helper`",
            "Add relay if missing: `ip helper-address <dhcp-server>`",
            "Check snooping drops: `show ip dhcp snooping statistics`",
            "Mark uplinks trusted if snooping is dropping: `ip dhcp snooping trust`",
            "Check pool on DHCP server: `show ip dhcp pool`",
        ],
        "uc_relevance": ["dc", "campus", "hybrid"],
    },
    {
        "id": "PHYSICAL_LAYER_FAILURE",
        "title": "Physical Layer Failure (Cable / Optics / Port)",
        "description": (
            "Physical signal integrity issues are causing packet loss and interface "
            "instability. This produces a cascade of higher-layer symptoms: interface "
            "errors lead to link flaps, which cause OSPF/BGP adjacency loss, which "
            "causes routing and EVPN failures. The fix is hardware replacement, not config."
        ),
        "evidence_weights": {
            "INTERFACE_ERRORS":     0.50,
            "LINK_FLAPPING":        0.45,
            "OPTICS_LOW_POWER":     0.50,
            "INTERFACE_DOWN":       0.30,
            "OSPF_NEIGHBOR_DOWN":   0.15,
            "BGP_NEIGHBOR_DOWN":    0.10,
        },
        "blast_radius": "isolated",
        "urgency": "high",
        "first_check": "show interface <intf> transceiver details",
        "resolution_path": [
            "Check DOM: `show interface <intf> transceiver details` — Rx/Tx power OK?",
            "Count errors: `show interface <intf> counters errors` — incrementing?",
            "Clean fiber connector / reseat SFP",
            "Swap cable and SFP with known-good units",
            "Move to spare port if switch ASIC issue suspected",
        ],
        "uc_relevance": ["dc", "campus", "hybrid", "gpu"],
    },
    {
        "id": "WIRELESS_INFRASTRUCTURE",
        "title": "Wireless Infrastructure Failure (AP / RADIUS / CAPWAP)",
        "description": (
            "WiFi clients cannot connect due to a failure in the wireless infrastructure: "
            "APs not joining the controller, RADIUS authentication failing, or SSID/VLAN "
            "misconfiguration. The wired network may be healthy; the fault is in the "
            "wireless control plane or policy configuration."
        ),
        "evidence_weights": {
            "AP_NOT_JOINING":       0.50,
            "WIFI_AUTH_FAILURE":    0.45,
            "SSID_VLAN_MISMATCH":   0.30,
            "DHCP_NO_ADDRESS":      0.15,
            "PING_FAILURE":         0.05,
        },
        "blast_radius": "rack",
        "urgency": "high",
        "first_check": "show ap join stats summary all",
        "resolution_path": [
            "Check AP join status: `show ap join stats summary all`",
            "Verify CAPWAP reachability: ping WLC from AP VLAN",
            "Check RADIUS server: `show aaa servers`",
            "Test auth manually: `test aaa group radius <user> <pass> new-code`",
            "Verify SSID-to-VLAN mapping: `show wlan id <id>`",
        ],
        "uc_relevance": ["campus"],
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Correlator
# ─────────────────────────────────────────────────────────────────────────────

def correlate(
    state: dict[str, Any],
    symptom_texts: list[str],
    top_n: int = 5,
) -> RootCauseAnalysis:
    """
    Correlate symptoms → ranked root-cause hypotheses.

    1. Run monitor_engine.diagnose() to get matching issue IDs.
    2. Score each RCA rule by how many of its evidence issues appear.
    3. Apply use-case context weight (GPU rules boosted for GPU fabrics, etc.).
    4. Return top_n hypotheses.
    """
    # Step 1: get matching issues from symptom text
    # Only use issues with score >= 0.15 (at least one keyword matched).
    # Pure context-boost hits (score=0.10) are excluded from evidence to avoid
    # false correlations (e.g. GPU context boost elevating VXLAN issues for PFC symptoms).
    matches = _diagnose(state, symptom_texts, top_n=20)
    matched_issue_ids = {m.issue_id for m in matches if m.score >= 0.15}
    categories_hit    = list({m.category for m in matches if m.score >= 0.15})

    uc = state.get("uc", "dc")

    # Step 2: score each RCA rule
    scored: list[tuple[float, dict]] = []
    for rule in _RCA_RULES:
        # Only consider rules relevant to this use-case
        if uc not in rule.get("uc_relevance", [uc]):
            # Still include but with reduced weight
            uc_factor = 0.4
        else:
            uc_factor = 1.0

        score = 0.0
        evidence_found: list[str] = []
        weights = rule["evidence_weights"]
        for issue_id, weight in weights.items():
            if issue_id in matched_issue_ids:
                score += weight
                evidence_found.append(issue_id)

        # Normalise by max possible score for this rule
        max_score = sum(weights.values())
        norm_score = (score / max_score) * uc_factor if max_score > 0 else 0

        if norm_score > 0:
            scored.append((norm_score, rule, evidence_found))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Step 3: build Hypothesis objects
    hypotheses: list[Hypothesis] = []
    for norm_score, rule, evidence_found in scored[:top_n]:
        confidence = min(int(norm_score * 100), 95)  # cap at 95% — we're never certain
        blast = rule["blast_radius"]
        hypotheses.append(Hypothesis(
            root_cause_id=rule["id"],
            title=rule["title"],
            confidence=confidence,
            evidence=evidence_found,
            explanation=rule["description"],
            blast_radius=blast,
            urgency=rule["urgency"],
            first_check=rule["first_check"],
            resolution_path=rule["resolution_path"],
        ))

    top = hypotheses[0] if hypotheses else None

    if top:
        conf_word = "high" if top.confidence >= 60 else "moderate" if top.confidence >= 35 else "low"
        summary = (
            f"{conf_word.title()} confidence ({top.confidence}%) that root cause is: "
            f"{top.title}. "
            f"Evidence: {len(top.evidence)} matching issue type(s). "
            f"Blast radius: {top.blast_radius}. "
            f"Start with: `{top.first_check}`"
        )
    else:
        summary = (
            "Could not identify a dominant root cause from the provided symptoms. "
            "Check individual issue diagnoses for standalone investigation paths."
        )

    return RootCauseAnalysis(
        hypotheses=hypotheses,
        top=top,
        supporting_issues=list(matched_issue_ids),
        categories_hit=categories_hit,
        symptom_count=len(symptom_texts),
        confidence_summary=summary,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Runbook builder
# ─────────────────────────────────────────────────────────────────────────────

# Per-rule runbook steps (platform-aware)
_RUNBOOKS: dict[str, list[dict]] = {
    "UNDERLAY_FAILURE": [
        {
            "phase": "verify",
            "title": "Confirm underlay adjacency state",
            "description": "Check OSPF/ISIS neighbor table — look for missing or stuck adjacencies.",
            "commands": {
                "nxos":  ["show ip ospf neighbors", "show isis neighbors"],
                "eos":   ["show ip ospf neighbor", "show isis neighbors"],
                "sonic": ["vtysh -c 'show ip ospf neighbor'", "vtysh -c 'show isis neighbor'"],
            },
            "expected": "All spine-leaf pairs showing Full/UP state",
            "escalate_if": "All adjacencies look fine → underlay not the cause, check BGP auth or ACL",
        },
        {
            "phase": "verify",
            "title": "Check BGP session state",
            "description": "Verify iBGP sessions from leaf to spine RR — should all be Established.",
            "commands": {
                "nxos":  ["show bgp summary", "show bgp neighbors | grep -E 'BGP state|Description'"],
                "eos":   ["show bgp summary", "show bgp neighbors | grep -E 'BGP state|Description'"],
                "sonic": ["vtysh -c 'show bgp summary'"],
            },
            "expected": "All leaf-to-spine BGP sessions in Established state",
            "escalate_if": "BGP is up but EVPN routes missing → check EVPN policy (EVPN_RT_MISMATCH)",
        },
        {
            "phase": "isolate",
            "title": "Identify which P2P link lost OSPF",
            "description": "Check per-interface OSPF state to find the broken adjacency.",
            "commands": {
                "nxos":  ["show ip ospf interface brief", "show ip ospf neighbors detail"],
                "eos":   ["show ip ospf interface brief", "show ip ospf neighbor detail"],
                "sonic": ["vtysh -c 'show ip ospf interface brief'"],
            },
            "expected": "All P2P interfaces show DR/BDR or P2P state",
            "escalate_if": "Interface shows WAITING or DOWN → check physical link / MTU mismatch",
        },
        {
            "phase": "isolate",
            "title": "Check interface MTU on P2P links",
            "description": "MTU mismatch causes OSPF to stick in ExStart/Exchange — check both ends.",
            "commands": {
                "nxos":  ["show interface Ethernet1/1 | grep MTU", "show ip ospf interface Ethernet1/1"],
                "eos":   ["show interfaces Ethernet1 | grep MTU", "show ip ospf interface Ethernet1"],
                "sonic": ["ip link show | grep mtu"],
            },
            "expected": "MTU identical on both ends of each P2P link (typically 9216)",
            "escalate_if": "MTU matches → check OSPF auth password or area type mismatch",
        },
        {
            "phase": "fix",
            "title": "Restore OSPF adjacency",
            "description": "Apply the fix — MTU, auth, or area — and watch adjacency re-form.",
            "commands": {
                "nxos":  ["! Fix MTU: interface Eth1/1 → mtu 9216",
                          "! Fix auth: ip ospf authentication message-digest",
                          "! Verify: show ip ospf neighbors"],
                "eos":   ["! Fix MTU: interface Eth1 → mtu 9216",
                          "! Verify: show ip ospf neighbor"],
                "sonic": ["! Fix via FRR: vtysh → interface <intf> → ip ospf mtu-ignore"],
            },
            "expected": "Adjacency reaches Full state within 10s",
            "escalate_if": "Still not forming after MTU/auth fix → hardware or ACL issue",
        },
        {
            "phase": "confirm",
            "title": "Verify full fabric recovery",
            "description": "Confirm BGP sessions re-establish and NVE peers recover.",
            "commands": {
                "nxos":  ["show bgp summary", "show nve peers", "show ip route 10.0.0.0/8"],
                "eos":   ["show bgp summary", "show vxlan vtep", "show ip route 10.0.0.0/8"],
                "sonic": ["vtysh -c 'show bgp summary'", "vtysh -c 'show evpn vni detail'"],
            },
            "expected": "All BGP sessions Established, NVE peers Up, routes present",
            "escalate_if": "BGP/NVE still down → may need `clear bgp * soft` to re-trigger sessions",
        },
    ],

    "PFC_DEADLOCK_GPU": [
        {
            "phase": "verify",
            "title": "Check PFC watchdog state",
            "description": "Determine if watchdog is running and has detected/broken a deadlock.",
            "commands": {
                "nxos":  ["show priority-flow-control watch-dog", "show interface <intf> priority-flow-control"],
                "eos":   ["show interfaces <intf> pfc detail", "show priority-flow-control"],
                "sonic": ["pfcstat -s all", "show pfc counters"],
            },
            "expected": "Watchdog enabled; no sustained pause counters",
            "escalate_if": "Watchdog not configured → enable it immediately",
        },
        {
            "phase": "verify",
            "title": "Check lossless queue drop counters",
            "description": "Any drops in PFC-protected priority 3 queue indicate a problem.",
            "commands": {
                "nxos":  ["show queuing interface <intf>"],
                "eos":   ["show queue counters <intf>", "show platform environment queue"],
                "sonic": ["show queue counters", "show interface counters detailed"],
            },
            "expected": "Zero drops on lossless queue (priority 3/4)",
            "escalate_if": "Drops present with PFC enabled → buffer headroom too small",
        },
        {
            "phase": "fix",
            "title": "Enable PFC watchdog with drop action",
            "description": "Force watchdog to drop PFC-stuck packets and break the deadlock.",
            "commands": {
                "nxos":  ["priority-flow-control watch-dog-interval 200",
                          "priority-flow-control watch-dog on"],
                "eos":   ["priority-flow-control watchdog polling-interval 10 ms",
                          "priority-flow-control watchdog action drop"],
                "sonic": ["pfcwd start --action drop --restoration-time 200 --detect-time 200",
                          "pfcwd start --port all --action drop"],
            },
            "expected": "Watchdog breaks deadlock; RDMA traffic resumes within seconds",
            "escalate_if": "Traffic doesn't resume → check DCQCN thresholds and NIC config",
        },
        {
            "phase": "fix",
            "title": "Verify DCQCN ECN thresholds",
            "description": "Ensure ECN marks early before buffers fill (prevents future deadlock).",
            "commands": {
                "nxos":  ["show queuing interface <intf> | grep ecn",
                          "show running-config | grep random-detect"],
                "eos":   ["show qos interface <intf> | grep ECN"],
                "sonic": ["show ecn", "ecnconfig -p RDMA -gmin 50000 -gmax 100000"],
            },
            "expected": "ECN Kmin=50KB, Kmax=100KB on queue 3",
            "escalate_if": "Deadlock recurs → check for circular dependency in fabric topology",
        },
        {
            "phase": "confirm",
            "title": "Verify RDMA traffic flows",
            "description": "Confirm GPU-to-GPU RDMA bandwidth recovers.",
            "commands": {
                "sonic": ["rdma stat show", "ib_write_bw -a -d <mlx-dev>"],
                "nxos":  ["show interface <intf> counters | grep rate"],
                "eos":   ["show interfaces <intf> counters rates"],
            },
            "expected": "RDMA bandwidth at expected level (400Gbps+ per GPU port)",
            "escalate_if": "Traffic not recovered → restart RDMA workload; check NIC state",
        },
    ],

    "EVPN_POLICY_MISCONFIGURATION": [
        {
            "phase": "verify",
            "title": "Collect RT from all VTEPs",
            "description": "Check that every VTEP exports the same RT for each VNI.",
            "commands": {
                "nxos":  ["show nve vni detail", "show bgp l2vpn evpn | grep 'Route Target'"],
                "eos":   ["show vxlan vni", "show bgp evpn detail | grep -A3 'Route Target'"],
                "sonic": ["vtysh -c 'show bgp l2vpn evpn detail'"],
            },
            "expected": "All VTEPs show identical RT for same VNI (e.g. 65000:10010)",
            "escalate_if": "RTs differ → proceed to fix step",
        },
        {
            "phase": "isolate",
            "title": "Identify mismatched VTEP",
            "description": "Compare `show nve vni` output across all leaf switches.",
            "commands": {
                "nxos":  ["show nve vni", "show vrf detail | grep vni"],
                "eos":   ["show vxlan vni", "show vxlan control-plane"],
                "sonic": ["vtysh -c 'show evpn vni detail'"],
            },
            "expected": "Same VNI mapping on all VTEPs for each VLAN",
            "escalate_if": "All VNIs match → check L3VNI or VRF RT",
        },
        {
            "phase": "fix",
            "title": "Align route-targets",
            "description": "Correct RT configuration on the offending VTEP.",
            "commands": {
                "nxos":  ["! Under: vni <vni> l2", "  rd auto",
                          "  route-target import auto", "  route-target export auto"],
                "eos":   ["! Under: vlan <vlan>", "  vxlan vlan <vlan> vni <vni>",
                          "! Under: bgp AS:", "  vlan <vlan>", "  rd auto",
                          "  route-target both auto"],
                "sonic": ["vtysh -c 'conf t' → router bgp → address-family l2vpn evpn → vni <vni> → route-target both auto"],
            },
            "expected": "RT now matches remote VTEPs",
            "escalate_if": "Auto RT doesn't match → use explicit manual RT matching remote",
        },
        {
            "phase": "confirm",
            "title": "Verify EVPN routes imported",
            "description": "Confirm type-2 and type-5 routes now present.",
            "commands": {
                "nxos":  ["clear bgp l2vpn evpn * soft", "show bgp l2vpn evpn type-2",
                          "show l2route evpn mac-ip all"],
                "eos":   ["clear bgp evpn soft", "show bgp evpn route-type mac-ip"],
                "sonic": ["vtysh -c 'clear bgp l2vpn evpn * soft'"],
            },
            "expected": "Type-2 routes present for each VTEP; L3 routing functional",
            "escalate_if": "Still missing → check BGP session state and NVE peer",
        },
    ],

    "L2_DOMAIN_ISOLATION": [
        {
            "phase": "verify",
            "title": "Confirm VLAN exists on both switches",
            "description": "VLAN must be in the VLAN database on every switch in the path.",
            "commands": {
                "nxos":  ["show vlan brief | grep <vlan>"],
                "eos":   ["show vlan brief | grep <vlan>"],
                "iosxe": ["show vlan brief | inc <vlan>"],
            },
            "expected": "VLAN shows as active on all switches",
            "escalate_if": "VLAN missing on one switch → create it: `vlan <id>`",
        },
        {
            "phase": "verify",
            "title": "Verify trunk allows the VLAN",
            "description": "Uplinks must explicitly allow the VLAN (or use 'all').",
            "commands": {
                "nxos":  ["show interface <trunk> trunk | grep <vlan>"],
                "eos":   ["show interfaces <trunk> trunk | grep <vlan>"],
                "iosxe": ["show interface <trunk> trunk | inc <vlan>"],
            },
            "expected": "VLAN listed in 'VLANs allowed and active in management domain'",
            "escalate_if": "VLAN not in trunk list → `switchport trunk allowed vlan add <vlan>`",
        },
        {
            "phase": "isolate",
            "title": "Check STP state for the VLAN",
            "description": "STP may be blocking the VLAN on an expected forwarding port.",
            "commands": {
                "nxos":  ["show spanning-tree vlan <vlan>"],
                "eos":   ["show spanning-tree vlan <vlan>"],
                "iosxe": ["show spanning-tree vlan <vlan>"],
            },
            "expected": "No ports in BLK state on a port that should forward",
            "escalate_if": "Port blocking → check for topology change cause",
        },
        {
            "phase": "confirm",
            "title": "Verify MAC learning and connectivity",
            "description": "Confirm hosts learn each other's MACs and ping succeeds.",
            "commands": {
                "nxos":  ["show mac address-table vlan <vlan>", "ping <host-b> vrf <vrf>"],
                "eos":   ["show mac address-table vlan <vlan>", "ping vrf <vrf> <host-b>"],
                "iosxe": ["show mac address-table vlan <vlan>"],
            },
            "expected": "Both host MACs present; ping succeeds",
            "escalate_if": "Still failing → check ACL or firewall between hosts",
        },
    ],
}

# Fallback generic runbook for any hypothesis without a dedicated runbook
_GENERIC_RUNBOOK: list[dict] = [
    {
        "phase": "verify",
        "title": "Confirm symptom",
        "description": "Reproduce the symptom and collect baseline data.",
        "commands": {"all": ["ping <dst>", "traceroute <dst>", "show interface status"]},
        "expected": "Symptom reproducible and captured",
        "escalate_if": "Symptom intermittent → enable debug logging and monitor",
    },
    {
        "phase": "isolate",
        "title": "Check control plane",
        "description": "Verify BGP/OSPF neighbors, route table, ARP.",
        "commands": {
            "nxos":  ["show bgp summary", "show ip ospf neighbors", "show ip arp"],
            "eos":   ["show bgp summary", "show ip ospf neighbor", "show arp"],
            "iosxe": ["show bgp summary", "show ip ospf neighbor", "show ip arp"],
        },
        "expected": "Protocols healthy",
        "escalate_if": "Protocol down → follow protocol-specific runbook",
    },
    {
        "phase": "fix",
        "title": "Apply targeted fix",
        "description": "Apply the fix identified during isolation phase.",
        "commands": {"all": ["! Apply fix based on isolation findings"]},
        "expected": "Symptom resolves",
        "escalate_if": "Not resolved → escalate to senior engineer",
    },
    {
        "phase": "confirm",
        "title": "Verify resolution",
        "description": "Re-run original symptom test to confirm resolution.",
        "commands": {"all": ["ping <dst>", "traceroute <dst>"]},
        "expected": "No packet loss; full connectivity",
        "escalate_if": "Still failing → open vendor TAC case",
    },
]


def build_runbook(state: dict[str, Any], rca: RootCauseAnalysis) -> Runbook:
    """
    Build an ordered investigation runbook for the top RCA hypothesis.
    """
    top = rca.top
    if not top:
        return Runbook(
            title="Generic Network Investigation Runbook",
            hypothesis="Unknown",
            platform="nxos",
            steps=[_step_from_dict(i+1, s, "nxos") for i, s in enumerate(_GENERIC_RUNBOOK)],
            total_steps=len(_GENERIC_RUNBOOK),
            estimated_minutes=20,
        )

    platform = _best_platform(state)
    raw_steps = _RUNBOOKS.get(top.root_cause_id, _GENERIC_RUNBOOK)
    steps = [_step_from_dict(i+1, s, platform) for i, s in enumerate(raw_steps)]

    # Estimate: ~3-5 min per step
    est_mins = len(steps) * 4

    return Runbook(
        title=f"Investigation Runbook: {top.title}",
        hypothesis=top.root_cause_id,
        platform=platform,
        steps=steps,
        total_steps=len(steps),
        estimated_minutes=est_mins,
    )


def _step_from_dict(num: int, d: dict, platform: str) -> RunbookStep:
    cmds_dict = d["commands"]
    # Pick platform commands, fallback to "all" or first available
    cmds = cmds_dict.get(platform) or cmds_dict.get("all") or list(cmds_dict.values())[0]
    return RunbookStep(
        phase=d["phase"],
        step_num=num,
        title=d["title"],
        description=d["description"],
        commands={platform: cmds},
        expected=d["expected"],
        escalate_if=d["escalate_if"],
    )


def _best_platform(state: dict[str, Any]) -> str:
    vendor = state.get("_detected_vendor", "")
    uc     = state.get("uc", "dc")
    if vendor == "Arista":  return "eos"
    if vendor == "Juniper": return "junos"
    if uc == "gpu":         return "sonic"
    if uc == "campus":      return "iosxe"
    return "nxos"


# ─────────────────────────────────────────────────────────────────────────────
# Mermaid fault-tree diagram
# ─────────────────────────────────────────────────────────────────────────────

def fault_tree_mermaid(rca: RootCauseAnalysis) -> str:
    """
    Generate a Mermaid flowchart showing the fault tree:
    Root Cause → Contributing Issues → Observed Symptoms
    """
    if not rca.top:
        return "graph TD\n    A[No root cause identified]\n"

    lines = ["graph TD"]
    top   = rca.top

    # Root cause node
    rc_id  = top.root_cause_id
    rc_lbl = top.title.replace('"', "'")
    conf   = top.confidence
    lines.append(f'    RC["{rc_lbl}<br/>Confidence: {conf}%"]:::rootcause')

    # Blast radius and urgency node
    lines.append(f'    META["Blast: {top.blast_radius} | Urgency: {top.urgency}"]:::meta')
    lines.append(f'    RC --> META')

    # Evidence issues
    for iss_id in top.evidence:
        iss = ISSUES.get(iss_id, {})
        name = iss.get("name", iss_id).replace('"', "'")
        sev  = iss.get("severity", "")
        css  = {"critical": "critnode", "high": "highnode", "medium": "mednode"}.get(sev, "lownode")
        safe_id = iss_id.replace("_", "")
        lines.append(f'    {safe_id}["{name}"]:::{css}')
        lines.append(f'    RC --> {safe_id}')

    # Alternate hypotheses (greyed out)
    for hyp in rca.hypotheses[1:3]:
        alt_id  = hyp.root_cause_id.replace("_", "")
        alt_lbl = hyp.title[:50].replace('"', "'")
        lines.append(f'    ALT{alt_id}["{alt_lbl}<br/>({hyp.confidence}%)"]:::altnode')
        lines.append(f'    RC -.->|"alternative"| ALT{alt_id}')

    # First check call-out
    first_check = top.first_check.replace('"', "'").replace("<", "‹").replace(">", "›")
    lines.append(f'    FC["▶ Start: {first_check}"]:::actionnode')
    lines.append(f'    RC --> FC')

    # Styles
    lines += [
        "    classDef rootcause fill:#c0392b,stroke:#922b21,color:#fff,font-weight:bold",
        "    classDef critnode  fill:#e74c3c,stroke:#c0392b,color:#fff",
        "    classDef highnode  fill:#e67e22,stroke:#ca6f1e,color:#fff",
        "    classDef mednode   fill:#f1c40f,stroke:#d4ac0d,color:#000",
        "    classDef lownode   fill:#95a5a6,stroke:#7f8c8d,color:#fff",
        "    classDef altnode   fill:#bdc3c7,stroke:#95a5a6,color:#555,stroke-dasharray:4",
        "    classDef meta      fill:#2980b9,stroke:#1a5276,color:#fff",
        "    classDef actionnode fill:#27ae60,stroke:#1e8449,color:#fff,font-weight:bold",
    ]

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# One-shot triage
# ─────────────────────────────────────────────────────────────────────────────

def quick_triage(
    state: dict[str, Any],
    symptom_texts: list[str],
) -> dict[str, Any]:
    """
    One-shot entry point: symptoms → RCA + runbook + Mermaid diagram.

    Returns a single dict ready to be serialised as a JSON MCP response.
    """
    rca      = correlate(state, symptom_texts)
    runbook  = build_runbook(state, rca)
    diagram  = fault_tree_mermaid(rca)

    top = rca.top

    return {
        "ok": True,
        "root_cause": {
            "id":           top.root_cause_id if top else None,
            "title":        top.title          if top else "Unknown",
            "confidence":   top.confidence     if top else 0,
            "urgency":      top.urgency        if top else "unknown",
            "blast_radius": top.blast_radius   if top else "unknown",
            "explanation":  top.explanation    if top else "",
            "first_check":  top.first_check    if top else "",
            "resolution_path": top.resolution_path if top else [],
            "evidence_issues": top.evidence    if top else [],
        } if top else None,
        "alternative_hypotheses": [
            {
                "id":         h.root_cause_id,
                "title":      h.title,
                "confidence": h.confidence,
                "urgency":    h.urgency,
            }
            for h in rca.hypotheses[1:3]
        ],
        "runbook": {
            "title":             runbook.title,
            "platform":          runbook.platform,
            "total_steps":       runbook.total_steps,
            "estimated_minutes": runbook.estimated_minutes,
            "steps": [
                {
                    "step":        s.step_num,
                    "phase":       s.phase,
                    "title":       s.title,
                    "description": s.description,
                    "commands":    s.commands,
                    "expected":    s.expected,
                    "escalate_if": s.escalate_if,
                }
                for s in runbook.steps
            ],
        },
        "fault_tree_diagram": diagram,
        "confidence_summary": rca.confidence_summary,
        "supporting_issues":  rca.supporting_issues,
        "categories_affected": rca.categories_hit,
    }
