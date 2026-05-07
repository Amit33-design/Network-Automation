"""
NetDesign AI — MCP (Model Context Protocol) Server
====================================================
Exposes the full NetDesign AI platform as a structured, AI-native service.

AI models (Claude, GPT, Gemini, etc.) can call these tools directly to:
  • Translate natural-language descriptions → structured network state
  • Generate production-ready device configs (NX-OS / EOS / SONiC / IOS-XE / JunOS)
  • Run policy validation, EVPN/BGP checks, and compliance gates
  • Simulate device and link failures with impact analysis
  • Evaluate deployment readiness via the confidence gate

Requirements:
  Python >= 3.10   (mcp SDK constraint)
  pip install "mcp[cli]>=1.0.0"

Run standalone (stdio transport — for Claude Desktop):
  python mcp_server.py

Run with SSE transport (for remote / multi-client use):
  python mcp_server.py --transport sse --port 8001
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Any

# ---------------------------------------------------------------------------
# FastMCP import guard — gives a clear error on Python < 3.10
# ---------------------------------------------------------------------------
if sys.version_info < (3, 10):
    sys.exit(
        "NetDesign AI MCP server requires Python 3.10+. "
        f"You are running {sys.version}. "
        "Use the Docker image (python:3.11-slim) or upgrade your interpreter."
    )

try:
    from mcp.server.fastmcp import FastMCP, Context
except ImportError:
    sys.exit(
        "The 'mcp' package is not installed.\n"
        "  pip install 'mcp[cli]>=1.0.0'\n"
        "Or add it to requirements.txt and rebuild the Docker image."
    )

# ---------------------------------------------------------------------------
# Internal engine imports
# ---------------------------------------------------------------------------
from nl_parser import parse_intent, describe_intent
from design_engine import (
    generate_full_design,
    generate_ip_plan,
    generate_vlan_plan,
    generate_bgp_design,
    generate_topology,
    generate_design_rationale,
)
from sim_engine import simulate_failure, simulate_link_failure
from gate_engine import run_policies, compute_confidence, can_deploy
from config_gen import generate_all_configs
from monitor_engine import (
    diagnose as _monitor_diagnose,
    health_check as _monitor_health_check,
    get_issue as _monitor_get_issue,
    list_categories as _monitor_list_categories,
    list_issues_by_category as _monitor_list_by_cat,
    DiagnosticMatch,
)
from troubleshoot_engine import quick_triage as _quick_triage
from static_analysis import run_analysis as _run_static_analysis
from nornir_tasks import run_post_checks as _run_post_checks

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NetDesign-MCP] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("netdesign.mcp")

# ---------------------------------------------------------------------------
# Product catalogue (single source of truth shown to LLMs via resource)
# ---------------------------------------------------------------------------
PRODUCT_CATALOGUE: dict[str, dict] = {
    "cisco_nexus": {
        "vendor": "Cisco",
        "family": "Nexus 9000",
        "platform": "nxos",
        "use_cases": ["dc_fabric", "gpu_cluster"],
        "roles": ["spine", "leaf", "tor"],
        "speeds": ["10G", "25G", "40G", "100G", "400G"],
        "features": ["EVPN", "VXLAN", "BGP", "OSPF", "IS-IS", "PFC", "ECN", "DCQCN"],
        "notes": "Industry-standard DC/CLOS fabric switch. Best for NX-OS shops.",
    },
    "arista_eos": {
        "vendor": "Arista",
        "family": "7050X / 7280R3",
        "platform": "eos",
        "use_cases": ["dc_fabric", "gpu_cluster"],
        "roles": ["spine", "leaf", "tor"],
        "speeds": ["25G", "100G", "400G", "800G"],
        "features": ["EVPN", "VXLAN", "BGP", "OSPF", "IS-IS", "PFC", "ECN", "DCQCN"],
        "notes": "Preferred for AI/ML GPU fabrics (CloudVision, eAPI). EOS syntax.",
    },
    "sonic_onie": {
        "vendor": "Open / SONiC",
        "family": "SONiC-ONIE",
        "platform": "sonic",
        "use_cases": ["gpu_cluster"],
        "roles": ["tor", "leaf"],
        "speeds": ["100G", "200G", "400G"],
        "features": ["EVPN", "VXLAN", "FRR-BGP", "PFC", "ECN", "DCQCN", "SAI"],
        "notes": "Open-source NOS for GPU TOR. CONFIG_DB + FRR. Zero-vendor lock-in.",
    },
    "cisco_cat9k": {
        "vendor": "Cisco",
        "family": "Catalyst 9000",
        "platform": "iosxe",
        "use_cases": ["campus", "branch"],
        "roles": ["core", "distribution", "access"],
        "speeds": ["1G", "2.5G", "10G", "25G"],
        "features": ["SDA", "VXLAN", "LISP", "802.1X", "MACSEC", "QoS", "PBR"],
        "notes": "Campus SD-Access fabric. Best for enterprise campus deployments.",
    },
    "juniper_qfx": {
        "vendor": "Juniper",
        "family": "QFX5120 / QFX10002",
        "platform": "junos",
        "use_cases": ["dc_fabric", "campus"],
        "roles": ["spine", "leaf", "core"],
        "speeds": ["10G", "25G", "100G", "400G"],
        "features": ["EVPN", "VXLAN", "BGP", "OSPF", "IS-IS", "MPLS"],
        "notes": "JunOS set-command syntax. IP Fabric with Apstra automation-ready.",
    },
    "fortinet_fortigate": {
        "vendor": "Fortinet",
        "family": "FortiGate",
        "platform": "fortios",
        "use_cases": ["dc_fabric", "campus", "branch"],
        "roles": ["firewall", "edge"],
        "speeds": ["1G", "10G", "25G", "40G"],
        "features": ["NGFW", "IPS", "SSL-Inspect", "SD-WAN", "VPN", "UTM"],
        "notes": "FortiOS policy-based NGFW. FortiManager for centralised management.",
    },
    "palo_alto_pan": {
        "vendor": "Palo Alto",
        "family": "PA-Series / VM-Series",
        "platform": "panos",
        "use_cases": ["dc_fabric", "campus"],
        "roles": ["firewall", "edge"],
        "speeds": ["1G", "10G", "25G", "100G"],
        "features": ["App-ID", "User-ID", "Threat Prevention", "SSL Decryption", "Zero-Trust"],
        "notes": "App-ID + User-ID NGFW. Panorama for multi-device management.",
    },
}

# ---------------------------------------------------------------------------
# Architecture reference cards (shown via resource: netdesign://architectures/{uc})
# ---------------------------------------------------------------------------
ARCH_CARDS: dict[str, dict] = {
    "dc_fabric": {
        "name": "Data Centre CLOS Fabric",
        "tiers": ["spine", "leaf"],
        "underlay": ["ospf", "isis"],
        "overlay": ["evpn", "vxlan"],
        "typical_scale": "2–4 spines, 8–64 leaves, 100s of servers",
        "ip_scheme": "Loopbacks /32, P2P /31, L2VNI 10000+vlan, L3VNI 19000+vrf",
        "bgp_scheme": "iBGP full mesh via spine RR, EVPN AF l2vpn evpn",
        "community_scheme": "AS:100 primary, AS:300 backup, AS:1000 spine-orig, AS:9999 RTBH",
        "redundancy": "ECMP across all spines, anycast VTEP, PIM bidir optional",
    },
    "gpu_cluster": {
        "name": "AI/ML GPU Cluster Fabric",
        "tiers": ["spine", "tor"],
        "underlay": ["bgp"],
        "overlay": ["rdma", "roce-v2"],
        "typical_scale": "2 spines, 8–32 TOR switches, 8 H100s per rack",
        "ip_scheme": "TOR loopbacks /32, P2P /31, GPU host /30 (4 IPs per rack)",
        "bgp_scheme": "eBGP spine-TOR-host, private ASNs 65200+ spine 65300+ TOR 65400+ hosts",
        "community_scheme": "AS:100 GPU-primary, AS:200 GPU-backup, AS:999 blackhole",
        "lossless": "PFC priority 3+4, DCQCN ECN Kmin=50K Kmax=100K, MTU 9214",
    },
    "campus": {
        "name": "Enterprise Campus Network",
        "tiers": ["core", "distribution", "access"],
        "underlay": ["ospf", "eigrp"],
        "overlay": ["vlan", "sda"],
        "typical_scale": "2 core, 4–16 distribution, 32–256 access switches",
        "ip_scheme": "Campus /16, per-floor /24, management /24, wireless /22",
        "bgp_scheme": "Not applicable (IGP only unless SD-WAN edge)",
        "community_scheme": "Not applicable",
        "redundancy": "Spanning-tree or L3 routed distribution, VSS/StackWise core HA",
    },
    "branch": {
        "name": "Branch / Remote Office",
        "tiers": ["router", "switch"],
        "underlay": ["ospf", "bgp"],
        "overlay": ["sdwan", "mpls"],
        "typical_scale": "1–2 routers, 1–4 switches, 10–200 users",
        "ip_scheme": "Branch /24 per site, voice /26, data /25, guest /26",
        "bgp_scheme": "eBGP to SD-WAN hub or MPLS PE",
        "community_scheme": "Carrier communities for traffic engineering",
        "redundancy": "Dual WAN with SD-WAN / ECMP failover",
    },
}

# ---------------------------------------------------------------------------
# Policy rules reference (shown via resource: netdesign://policy-rules)
# ---------------------------------------------------------------------------
POLICY_RULES_REF = [
    {"id": "P001", "name": "BGP_ASN_RANGE", "action": "BLOCK", "description": "BGP ASN must be 1-65535 (16-bit) or 65536-4294967295 (32-bit)"},
    {"id": "P002", "name": "EVPN_REQUIRES_VRF", "action": "BLOCK", "description": "EVPN overlay requires at least one tenant VRF"},
    {"id": "P003", "name": "REDUNDANCY_REQUIRED", "action": "FAIL", "description": "Spine count must be >= 2 for HA — single spine is SPOF"},
    {"id": "P004", "name": "MTU_VXLAN_HEADROOM", "action": "FAIL", "description": "Host MTU must be >= 9000 when VXLAN overlay is enabled"},
    {"id": "P005", "name": "PFC_LOSSLESS_CONFIG", "action": "FAIL", "description": "GPU/RDMA workloads require PFC priorities 3+4 and DCQCN ECN"},
    {"id": "P006", "name": "VLAN_RANGE", "action": "BLOCK", "description": "VLAN IDs must be 1-4094"},
    {"id": "P007", "name": "SUBNET_OVERLAP", "action": "BLOCK", "description": "No two network segments may use overlapping IP prefixes"},
    {"id": "P008", "name": "BGP_TIMER_AGGRESSIVE", "action": "SUGGEST", "description": "BGP timers < 3/9 recommended only with BFD enabled"},
    {"id": "P009", "name": "MGMT_OOB_ISOLATION", "action": "WARN", "description": "Management plane should be in dedicated OOB VRF"},
    {"id": "P010", "name": "BFD_ENABLED", "action": "SUGGEST", "description": "BFD should be enabled on all BGP/OSPF adjacencies for fast failover"},
    {"id": "P011", "name": "NTP_SERVERS", "action": "WARN", "description": "At least 2 NTP servers required for clock redundancy"},
    {"id": "P012", "name": "LOGGING_CONFIGURED", "action": "INFO", "description": "Syslog server and log levels should be configured"},
    {"id": "P013", "name": "AAA_TACACS", "action": "SUGGEST", "description": "TACACS+/RADIUS for device authentication recommended"},
    {"id": "P014", "name": "SPINE_RR_REQUIRED", "action": "FAIL", "description": "EVPN RR must be configured on all spines for l2vpn evpn AF"},
    {"id": "P015", "name": "VNI_UNIQUENESS", "action": "BLOCK", "description": "Each VLAN must map to a unique VNI — no duplicates allowed"},
]

# ===========================================================================
# FastMCP server instantiation
# ===========================================================================
mcp = FastMCP(
    name="NetDesign AI",
    instructions="""
NetDesign AI is an expert network design and automation platform.

## IMPORTANT: Auto-chaining workflow

design_network() now does EVERYTHING automatically in one call:
  1. Parses natural language → structured intent
  2. Generates IP plan, VLAN/VNI table, BGP topology, adjacency graph
  3. Explains every architectural decision (the "why")
  4. Validates all 15 policy rules (returns gate_status, blocked count)
  5. Simulates worst-case spine failure (returns severity, ECMP, partition bool)
  6. Returns deployment confidence score (0-100) and gate decision
  7. Provides next_steps guidance

So for most requests, call design_network() FIRST and show:
  - gate.confidence and gate.gate_decision prominently
  - rationale.decisions as "Why this design:" bullets
  - simulation.ecmp for "What if SPINE-01 fails?"
  - validation.issues for any policy concerns

Then call generate_configs(state) if gate.can_deploy is True.

## Tool reference

| Tool | When to use |
|---|---|
| design_network | ALWAYS first — auto-chains design+validate+simulate+gate |
| generate_configs | After design_network, when gate.can_deploy = True |
| explain_design | For deeper architecture rationale on any existing state |
| validate_policies | For re-validation after manual state changes |
| simulate_failure | To test specific failure scenarios beyond worst-case spine |
| simulate_link_failure_tool | For single link failure analysis |
| check_deployment_gate | For final go/no-go with pre-check results |
| get_ip_plan | To extract just the IP addressing table |
| get_vlan_plan | To extract just the VLAN/VNI table |
| get_bgp_topology | To extract just the BGP design |
| get_topology_graph | To extract just the topology graph |
| list_products | To browse supported hardware catalogue |
| full_automation_pipeline | End-to-end with config generation included |
| diagnose_network | Symptom → ranked issue list with CLI commands + remediation |
| run_health_check | Proactive static health check — no live devices needed |
| get_issue_detail | Full drill-down on a specific issue ID (all platforms) |
| troubleshoot | Multi-symptom RCA → root cause + runbook + fault-tree diagram |
| run_static_analysis | 26 deterministic design checks across 6 domains — score + findings |
| run_post_checks | Post-deploy: BGP + LLDP JSON + ECN thresholds + PFC storm + MTU-9000 ping |
| monitor_network | **Unified monitor**: health_check + static_analysis + optional diagnose + RCA in one call |

## Response formatting guidance

Always surface these fields prominently in your response:
  - gate.confidence (show as "Deployment Confidence: 82/100")
  - gate.gate_decision (show as "Gate: APPROVED ✅" or "BLOCKED ❌")
  - rationale.summary (show as "Why this design:" section)
  - simulation.ecmp (show as "If SPINE-01 fails: X→Y ECMP paths")
  - next_steps (show as "Recommended next steps:")

## State passing

All state dicts are JSON-serialisable. Pass the 'state' key from design_network
into subsequent tools (generate_configs, simulate_failure, etc.) unchanged.
""",
)

# ===========================================================================
# ── TOOL 1 — design_network ─────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def design_network(description: str) -> dict[str, Any]:
    """
    Convert a plain-language network description into a complete network design,
    then automatically validate policies, simulate worst-case failure, and
    return a deployment gate decision — all in one call.

    This is the primary entry point. Use it first, then call generate_configs()
    if can_deploy is True (or acknowledge_warnings=True in check_deployment_gate).

    Args:
        description: Free-form text. Examples:
          "2-spine 8-leaf Cisco NX-OS DC fabric, EVPN/VXLAN, OSPF underlay,
           3 VRFs: PROD DEV STORAGE, BGP ASN 65000, HA"
          "64 H100 GPUs across 8 racks, SONiC TOR switches, 2 Arista spines,
           RoCEv2 lossless, PFC priority 3+4"
          "Campus network for 500 users, 3 floors, Cisco Catalyst 9k, VoIP,
           guest WiFi, 802.1X"

    Returns:
        state:          Full structured intent (pass this to other tools unchanged)
        design:         IP plan, VLAN/VNI table, BGP topology, adjacency graph
        rationale:      Why each design decision was made (architecture explanations)
        validation:     Policy gate results — gate_status, blocked count, warnings
        simulation:     Worst-case spine failure impact (severity, ECMP, partition)
        gate:           Deployment confidence score (0-100) and APPROVED/BLOCKED decision
        summary:        Human-readable design brief
        next_steps:     Recommended follow-on actions based on gate decision
    """
    log.info("design_network called — %d chars", len(description))

    # ── Phase 1: Parse NL → structured state ────────────────────────────────
    state = parse_intent(description)
    log.info("NL parse: uc=%s spines=%s leaves=%s vendor=%s",
             state.get("uc"), state.get("spine_count"), state.get("leaf_count"),
             state.get("_detected_vendor"))

    # ── Phase 2: Generate full design (IP, VLAN, BGP, topology, rationale) ──
    design = generate_full_design(state)

    # ── Phase 3: Auto-validate policies ─────────────────────────────────────
    validation_summary: dict[str, Any] = {}
    policy_results = None
    try:
        policy_results = run_policies(state)
        blocked   = len(policy_results.blocks) + len(policy_results.violations)
        all_issues = (
            [{"category": "BLOCK", **i} for i in policy_results.blocks] +
            [{"category": "FAIL",  **i} for i in policy_results.violations] +
            [{"category": "WARN",  **i} for i in policy_results.warnings]
        )
        validation_summary = {
            "gate_status": policy_results.gate_status,
            "can_proceed": blocked == 0,
            "blocked":     blocked,
            "auto_fixed":  len(policy_results.fixes),
            "warnings":    len(policy_results.warnings),
            "issues":      all_issues,
        }
        log.info("Validation: gate=%s blocked=%d", policy_results.gate_status, blocked)
    except Exception as exc:
        log.warning("Policy validation skipped: %s", exc)
        validation_summary = {"gate_status": "SKIPPED", "error": str(exc)}

    # ── Phase 4: Auto-simulate worst-case spine failure ──────────────────────
    simulation_summary: dict[str, Any] = {}
    sim_severity_gate = "PENDING"
    try:
        spine_count = state.get("spine_count") or 2
        worst_spine = f"SPINE-{1:02d}" if state.get("uc") != "gpu" else "GPU-SPINE-01"
        sim = simulate_failure(state, [worst_spine])
        sim_severity_gate = {
            "none": "PASS", "minor": "WARN", "major": "WARN", "critical": "FAIL"
        }.get(sim.get("severity", "none"), "WARN")
        simulation_summary = {
            "scenario":     f"{worst_spine} failure ({spine_count}-spine fabric)",
            "severity":     sim.get("severity", "none"),
            "partitioned":  sim.get("partitioned", False),
            "ecmp":         sim.get("ecmp", {}),
            "impacted":     sim.get("impacted", []),
            "remediation":  sim.get("remediation", [])[:3],
            "summary":      sim.get("summary", ""),
        }
        log.info("Simulation: severity=%s partitioned=%s", sim.get("severity"), sim.get("partitioned"))
    except Exception as exc:
        log.warning("Simulation skipped: %s", exc)
        simulation_summary = {"severity": "unknown", "error": str(exc)}

    # ── Phase 5: Deployment gate ─────────────────────────────────────────────
    gate_summary: dict[str, Any] = {}
    try:
        if policy_results:
            conf_data  = compute_confidence(policy_results, sim_severity_gate, "PENDING")
            confidence = conf_data.get("score", 0) if isinstance(conf_data, dict) else conf_data
            gate       = can_deploy(policy_results, sim_severity_gate, "PENDING", False)
            gate_summary = {
                "can_deploy":        gate.get("allowed", False),
                "gate_decision":     gate.get("status", "BLOCKED"),
                "confidence":        confidence,
                "confidence_label":  conf_data.get("label", "") if isinstance(conf_data, dict) else "",
                "confidence_breakdown": conf_data.get("breakdown", []) if isinstance(conf_data, dict) else [],
                "blockers":          gate.get("blockers", []),
                "gate_warnings":     gate.get("warnings", []),
            }
            log.info("Gate: %s confidence=%d", gate_summary["gate_decision"], confidence)
    except Exception as exc:
        log.warning("Gate skipped: %s", exc)
        gate_summary = {"can_deploy": False, "gate_decision": "ERROR", "error": str(exc)}

    # ── Phase 6: Build next-steps guidance ──────────────────────────────────
    gd = gate_summary.get("gate_decision", "")
    if gd == "CLEAR_TO_DEPLOY":
        next_steps = [
            "✅ Call generate_configs() to produce production-ready device configs",
            "Run pre-deployment checks on physical devices (SSH reachability, BGP state)",
            "Review rationale decisions with your team before change window",
        ]
    elif gd == "PROCEED_WITH_CAUTION":
        next_steps = [
            "⚠️ Call validate_policies() for the full warning detail",
            "Address WARN items or call check_deployment_gate(acknowledge_warnings=True)",
            "Then call generate_configs() to produce device configs",
        ]
    else:
        blockers = gate_summary.get("blockers", [])
        next_steps = [
            f"❌ Fix: {b}" for b in blockers[:3]
        ] or ["❌ Fix BLOCK/FAIL policy violations before proceeding"]

    return {
        "ok":         True,
        "state":      state,
        "design":     design,
        "rationale":  design.get("rationale", {}),
        "validation": validation_summary,
        "simulation": simulation_summary,
        "gate":       gate_summary,
        "summary":    describe_intent(state),
        "next_steps": next_steps,
    }


# ===========================================================================
# ── TOOL 2 — generate_configs ───────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def generate_configs(
    state: dict[str, Any],
    platforms: list[str] | None = None,
) -> dict[str, Any]:
    """
    Generate production-ready device configurations from a design state.

    Supported platforms: nxos, eos, sonic, iosxe, junos, panos, fortios

    Args:
        state:     The 'state' dict returned by design_network (or manually built).
        platforms: Optional list of platforms to generate (e.g. ["nxos", "sonic"]).
                   Defaults to all platforms inferred from state.

    Returns:
        configs: Dict keyed by device hostname → rendered configuration text.
        Each config is a complete, copy-paste-ready device configuration.
    """
    log.info("generate_configs called — state keys: %s", list(state.keys()))

    if platforms:
        state = dict(state)
        state["_platform_filter"] = platforms

    try:
        configs = generate_all_configs(state)
    except Exception as exc:
        log.exception("Config generation failed")
        return {"ok": False, "error": str(exc), "configs": {}}

    log.info("generate_configs produced %d device configs", len(configs))
    return {
        "ok": True,
        "configs": configs,
        "device_count": len(configs),
        "platforms_generated": list({v.get("platform", "unknown") for v in configs.values() if isinstance(v, dict)}),
    }


# ===========================================================================
# ── TOOL 3 — validate_policies ──────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def validate_policies(state: dict[str, Any]) -> dict[str, Any]:
    """
    Run all 15 NetDesign policy rules against a design state.

    Checks include:
      - BGP ASN validity, EVPN VRF requirements, spine redundancy
      - MTU headroom for VXLAN, PFC/DCQCN for GPU/RDMA workloads
      - VLAN range, subnet overlap, VNI uniqueness
      - BFD, NTP, logging, AAA best-practice suggestions

    Args:
        state: The 'state' dict from design_network.

    Returns:
        results:     Full PolicyResults with per-rule outcomes
        passed:      Number of rules that PASSED / INFO / SUGGEST
        blocked:     Number of BLOCK/FAIL rules that fired
        auto_fixed:  Number of issues auto-remediated (AUTO_FIX rules)
        warnings:    Number of WARN rules that fired
        can_proceed: True if no BLOCK or FAIL rules fired
        details:     List of rule results with action, message, fix applied
    """
    log.info("validate_policies called")

    try:
        results = run_policies(state)
    except Exception as exc:
        log.exception("Policy validation failed")
        return {"ok": False, "error": str(exc)}

    # PolicyResults fields: violations, warnings, infos, fixes, blocks, gate_status, resolved_state
    blocked   = len(results.blocks) + len(results.violations)
    auto_fixed = len(results.fixes)
    warned    = len(results.warnings)
    info_count = len(results.infos)

    # Build unified details list from all categories
    details = []
    for item in results.blocks:
        details.append({**item, "category": "BLOCK"})
    for item in results.violations:
        details.append({**item, "category": "FAIL"})
    for item in results.warnings:
        details.append({**item, "category": "WARN"})
    for item in results.fixes:
        details.append({**item, "category": "AUTO_FIX"})
    for item in results.infos:
        details.append({**item, "category": "INFO"})

    return {
        "ok": True,
        "can_proceed": blocked == 0,
        "gate_status": results.gate_status,
        "blocked": blocked,
        "auto_fixed": auto_fixed,
        "warnings": warned,
        "info": info_count,
        "total_issues": len(details),
        "details": details,
        "resolved_state": results.resolved_state,
    }


# ===========================================================================
# ── TOOL 3b — explain_design ────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def explain_design(state: dict[str, Any]) -> dict[str, Any]:
    """
    Explain every major architectural decision in the design — the 'why' layer.

    Returns structured rationale for topology choice, underlay/overlay protocol
    selection, BGP design, redundancy model, vendor choice, compliance, and
    GPU lossless configuration. Each decision includes alternatives considered.

    Use this after design_network() to get a credible explanation you can share
    with stakeholders, include in HLD documents, or use for peer review.

    Args:
        state: The 'state' dict from design_network.

    Returns:
        decisions:      List of {area, choice, rationale, alternatives}
        summary:        Prose paragraph summarising all decisions
        warnings:       Design trade-offs and considerations to be aware of
        decision_count: Total number of documented decisions
    """
    log.info("explain_design called — uc=%s spines=%s leaves=%s",
             state.get("uc"), state.get("spine_count"), state.get("leaf_count"))
    try:
        rationale = generate_design_rationale(state)
        return {"ok": True, **rationale}
    except Exception as exc:
        log.exception("explain_design failed")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 4 — simulate_failure ───────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def simulate_failure(
    state: dict[str, Any],
    failed_devices: list[str],
) -> dict[str, Any]:
    """
    Simulate the impact of one or more device failures on the network.

    Performs:
      - BFS-based network partition detection
      - Per-role impact analysis (spine / leaf / firewall / server)
      - BGP/EVPN control-plane status after failure
      - ECMP path count reduction
      - Remediation action suggestions

    Args:
        state:          The design state dict.
        failed_devices: List of device hostnames to fail (e.g. ["SPINE-01"]).

    Returns:
        severity:       "critical" | "major" | "minor" | "none"
        partitioned:    True if the failure causes a network partition
        impacted:       List of impacted device roles/segments
        bgp_impact:     BGP/EVPN session count lost, ECMP reduction
        evpn_impact:    VTEP count lost, L2/L3 VNI reachability affected
        remediation:    Suggested corrective actions
        summary:        Human-readable impact summary
    """
    log.info("simulate_failure called — failed_devices=%s", failed_devices)

    try:
        result = simulate_failure(state, failed_devices)
    except Exception as exc:
        log.exception("Failure simulation error")
        return {"ok": False, "error": str(exc)}

    # Normalise fields for consistent MCP response shape
    return {
        "ok":               True,
        "failed_devices":   result.get("failed", failed_devices),
        "found_in_topology":result.get("found_in_topology", []),
        "not_found":        result.get("not_found", []),
        "severity":         result.get("severity", "none"),
        "partitioned":      result.get("partitioned", False),      # ← always a bool
        "impacted":         result.get("impacted", []),             # ← rich list
        "ecmp":             result.get("ecmp", {}),                 # ← ECMP before/after
        "bgp_impact":       result.get("bgp_impact", {}),
        "evpn_impact":      result.get("evpn_impact", {}),
        "surviving_paths":  result.get("surviving_paths", []),
        "remediation":      result.get("remediation", []),
        "confidence_delta": result.get("confidence_delta", 0),
        "summary":          result.get("summary", ""),
    }


# ===========================================================================
# ── TOOL 5 — simulate_link_failure ──────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def simulate_link_failure_tool(
    state: dict[str, Any],
    link_a: str,
    link_b: str,
) -> dict[str, Any]:
    """
    Simulate a single link failure between two directly connected devices.

    Finds alternate paths via BFS and reports traffic impact.

    Args:
        state:  The design state dict.
        link_a: Hostname of one end of the link (e.g. "SPINE-01").
        link_b: Hostname of the other end (e.g. "LEAF-PROD-01").

    Returns:
        link_down:      The failed link pair
        alternate_paths: Number of remaining ECMP paths
        rerouted:       True if traffic can be rerouted
        severity:       Impact severity
        latency_delta:  Estimated additional latency in ms (if rerouted)
        summary:        Human-readable impact
    """
    log.info("simulate_link_failure called — %s ↔ %s", link_a, link_b)

    try:
        result = simulate_link_failure(state, link_a, link_b)
    except Exception as exc:
        log.exception("Link failure simulation error")
        return {"ok": False, "error": str(exc)}

    return {"ok": True, **result}


# ===========================================================================
# ── TOOL 6 — check_deployment_gate ──────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def check_deployment_gate(
    state: dict[str, Any],
    sim_severity: str = "none",
    precheck_status: str = "pass",
    acknowledge_warnings: bool = False,
) -> dict[str, Any]:
    """
    Evaluate deployment readiness and return a confidence score + go/no-go decision.

    Combines policy results, simulation severity, and pre-check status into a
    0-100 confidence score with a binary can_deploy decision.

    Args:
        state:                Design state dict (policy check is run internally).
        sim_severity:         Worst failure simulation severity seen:
                              "none" | "minor" | "major" | "critical"
        precheck_status:      Pre-deployment reachability/lab check status:
                              "pass" | "warn" | "fail" | "skipped"
        acknowledge_warnings: Set True to proceed despite WARN-only issues.
                              BLOCK/FAIL rules are never overridden.

    Returns:
        can_deploy:     True if deployment is approved
        confidence:     0-100 score
        gate_decision:  "APPROVED" | "CONDITIONAL" | "BLOCKED"
        blocking_rules: List of BLOCK/FAIL rule IDs that fired
        acknowledged:   Whether warnings were acknowledged
        rationale:      Explanation of the decision
    """
    log.info(
        "check_deployment_gate called — sim=%s precheck=%s ack=%s",
        sim_severity, precheck_status, acknowledge_warnings,
    )

    try:
        policy_results = run_policies(state)
        confidence_data = compute_confidence(policy_results, sim_severity, precheck_status)
        gate = can_deploy(policy_results, sim_severity, precheck_status, acknowledge_warnings)
    except Exception as exc:
        log.exception("Deployment gate error")
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "can_deploy": gate.get("allowed", False),
        "gate_decision": gate.get("status", "BLOCKED"),
        "confidence": confidence_data.get("score") if isinstance(confidence_data, dict) else confidence_data,
        "confidence_label": confidence_data.get("label", "") if isinstance(confidence_data, dict) else "",
        "confidence_breakdown": confidence_data.get("breakdown", []) if isinstance(confidence_data, dict) else [],
        "blockers": gate.get("blockers", []),
        "gate_warnings": gate.get("warnings", []),
    }


# ===========================================================================
# ── TOOL 7 — get_ip_plan ────────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def get_ip_plan(state: dict[str, Any]) -> dict[str, Any]:
    """
    Extract the IP addressing plan from a design state.

    Returns loopback addresses, P2P /31 links, management IPs, VTEP anycast
    addresses, and H100 host session IPs.

    Args:
        state: The design state dict from design_network.

    Returns:
        loopbacks:    Dict of device → loopback0/loopback1 IPs
        p2p_links:    List of spine↔leaf /31 link pairs with IPs
        management:   Management subnet and per-device IPs
        vtep_pool:    Anycast VTEP address pool
        host_sessions: GPU host BGP session IPs (if use_case=gpu_cluster)
    """
    log.info("get_ip_plan called")
    try:
        plan = generate_ip_plan(state)
        return {"ok": True, "ip_plan": plan}
    except Exception as exc:
        log.exception("IP plan generation failed")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 8 — get_vlan_plan ──────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def get_vlan_plan(state: dict[str, Any]) -> dict[str, Any]:
    """
    Extract the VLAN/VNI table from a design state.

    For DC fabric designs, includes:
      - VLAN ID, name, VNI (L2), L3VNI, VRF assignment
      - Route-target import/export values
      - Anycast gateway IP
      - Transit VLANs for symmetric IRB

    Args:
        state: The design state dict from design_network.

    Returns:
        vlans:        List of VLAN records with full EVPN attributes
        l3vni_table:  Dict of VRF → L3VNI transit VLAN mapping
        vrf_summary:  Unique VRFs with their L3VNI and gateway addresses
    """
    log.info("get_vlan_plan called")
    try:
        plan = generate_vlan_plan(state)
        return {"ok": True, "vlan_plan": plan}
    except Exception as exc:
        log.exception("VLAN plan generation failed")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 9 — get_bgp_topology ───────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def get_bgp_topology(state: dict[str, Any]) -> dict[str, Any]:
    """
    Extract the BGP design and community colouring scheme.

    Returns AS assignments, peer topology (iBGP / eBGP), EVPN address-family
    config, route-reflector assignments, community definitions, and a Mermaid
    diagram of the BGP peering graph.

    Args:
        state: The design state dict from design_network.

    Returns:
        asn_table:       Dict of device role → ASN
        peer_topology:   List of BGP session pairs with AF and role
        rr_nodes:        Route reflectors (spines for iBGP DC designs)
        communities:     Standard and extended community definitions
        evpn_rts:        Route-target table per VNI
        mermaid_diagram: Mermaid graph notation for BGP topology
    """
    log.info("get_bgp_topology called")
    try:
        bgp = generate_bgp_design(state)
        return {"ok": True, "bgp_design": bgp}
    except Exception as exc:
        log.exception("BGP design generation failed")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 10 — get_topology_graph ────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def get_topology_graph(state: dict[str, Any]) -> dict[str, Any]:
    """
    Get the network topology as a structured adjacency graph.

    Returns nodes (devices with role, vendor, platform), edges (links with
    interface labels and speeds), critical nodes (single points of failure),
    and a Mermaid diagram for visualisation.

    Args:
        state: The design state dict from design_network.

    Returns:
        nodes:          List of device nodes with metadata
        edges:          List of link pairs with interface and speed
        critical_nodes: Devices whose failure would partition the network
        spof_risk:      True if any single-point-of-failure exists
        mermaid_diagram: Mermaid graph for rendering in markdown
    """
    log.info("get_topology_graph called")
    try:
        topo = generate_topology(state)
        return {"ok": True, "topology": topo}
    except Exception as exc:
        log.exception("Topology generation failed")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 11 — list_products ─────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def list_products(
    use_case: str | None = None,
    vendor: str | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    """
    Browse the NetDesign AI supported hardware/software product catalogue.

    Args:
        use_case: Filter by use-case: "dc_fabric" | "gpu_cluster" | "campus" | "branch"
        vendor:   Filter by vendor name (case-insensitive): "cisco" | "arista" | "juniper" | …
        platform: Filter by platform slug: "nxos" | "eos" | "sonic" | "iosxe" | "junos"

    Returns:
        products: Filtered product list with features, roles, and deployment notes.
    """
    products = dict(PRODUCT_CATALOGUE)

    if use_case:
        products = {k: v for k, v in products.items() if use_case in v.get("use_cases", [])}
    if vendor:
        products = {k: v for k, v in products.items() if vendor.lower() in v["vendor"].lower()}
    if platform:
        products = {k: v for k, v in products.items() if v.get("platform") == platform}

    return {
        "ok": True,
        "count": len(products),
        "products": products,
    }


# ===========================================================================
# ── TOOL 13 — diagnose_network ──────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def diagnose_network(
    state: dict[str, Any],
    symptoms: list[str],
    top_n: int = 8,
) -> dict[str, Any]:
    """
    Diagnose network issues from a list of observed symptoms.

    Matches symptoms against 45+ issue types across 12 categories:
      L2/VLAN, L3/Routing, BGP, EVPN, VXLAN/VTEP, DHCP, Data-Plane,
      RDMA/RoCEv2/GPU, Control-Plane, End-to-End, WiFi, Infrastructure.

    Returns ranked matches with root causes, per-platform CLI diagnostic
    commands, step-by-step remediation, and verification commands.

    Args:
        state:    Design state dict (from design_network). Drives platform
                  selection and use-case context scoring.
        symptoms: List of symptom strings in plain English. Examples:
                    ["vtep unreachable", "nve peer down"]
                    ["bgp neighbor not established", "route missing"]
                    ["rdma drops", "pfc watchdog triggered"]
                    ["wifi clients cannot connect", "802.1x failure"]
        top_n:    Maximum matches to return (default 8).

    Returns:
        matches:    Ranked list of probable issues with full diagnostic detail.
        categories: Issue categories present in results.
        summary:    Brief text synopsis of top findings.
    """
    log.info("diagnose_network called — symptoms=%s", symptoms)
    try:
        matches = _monitor_diagnose(state, symptoms, top_n=top_n)
    except Exception as exc:
        log.exception("diagnose_network error")
        return {"ok": False, "error": str(exc)}

    def _match_to_dict(m: DiagnosticMatch) -> dict:
        return {
            "issue_id":   m.issue_id,
            "name":       m.name,
            "category":   m.category,
            "severity":   m.severity,
            "confidence": round(m.score * 100),
            "root_causes": m.root_causes,
            "diagnostic_commands": m.commands,
            "remediation_steps": m.remediation,
            "verification_commands": m.verification,
            "tags": m.tags,
        }

    result_dicts = [_match_to_dict(m) for m in matches]
    categories   = list({m.category for m in matches})
    top          = matches[0] if matches else None
    summary = (
        f"Top match: {top.name} ({top.category}, {top.severity} severity, "
        f"{round(top.score*100)}% confidence). "
        f"{len(matches)} total issue(s) identified across: {', '.join(categories)}."
        if top else "No matching issues found for the provided symptoms."
    )
    return {
        "ok": True,
        "match_count": len(matches),
        "matches": result_dicts,
        "categories": categories,
        "summary": summary,
    }


# ===========================================================================
# ── TOOL 14 — run_health_check ──────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def run_health_check(state: dict[str, Any]) -> dict[str, Any]:
    """
    Run a proactive static health check against a design state.

    Evaluates design-time configuration patterns for common misconfigurations
    without requiring live device access:
      - Spine redundancy (SPOF risk)
      - EVPN VRF / L3VNI completeness
      - VXLAN MTU headroom
      - GPU PFC / lossless configuration
      - BGP ASN validity
      - NTP redundancy
      - OSPF adjacency count expectation

    Args:
        state: Design state dict (from design_network).

    Returns:
        overall:  "healthy" | "degraded" | "critical"
        score:    0-100 health score
        items:    Per-check results with status (pass/warn/fail) and message
        summary:  Plain-English health report
    """
    log.info("run_health_check called — uc=%s", state.get("uc"))
    try:
        report = _monitor_health_check(state)
    except Exception as exc:
        log.exception("run_health_check error")
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "overall": report.overall,
        "score": report.score,
        "summary": report.summary,
        "items": [
            {
                "check":    item.check,
                "status":   item.status,
                "message":  item.message,
                "issue_id": item.issue_id,
            }
            for item in report.items
        ],
        "failed_checks":  [i.check for i in report.items if i.status == "fail"],
        "warning_checks": [i.check for i in report.items if i.status == "warn"],
    }


# ===========================================================================
# ── TOOL 15 — get_issue_detail ──────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def get_issue_detail(
    issue_id: str,
    platform: str = "nxos",
) -> dict[str, Any]:
    """
    Get full diagnostic detail for a specific known issue ID.

    Use after diagnose_network() to drill into a specific issue with
    platform-specific commands, all root causes, and full remediation steps.

    Args:
        issue_id: Issue identifier, e.g. "VTEP_UNREACHABLE", "PFC_STORM",
                  "EVPN_RT_MISMATCH". Get IDs from diagnose_network results.
        platform: Target platform for commands: nxos | eos | iosxe | sonic | junos.

    Returns:
        Full issue detail including all platforms' diagnostic commands,
        ordered remediation steps, and verification commands.

    Available issue IDs (45 total across 12 categories):
      VLAN: VLAN_MISMATCH, NATIVE_VLAN_MISMATCH, STP_TOPOLOGY_CHANGE,
            PORT_ERRORDISABLED, MAC_TABLE_EXHAUSTION
      Routing: ROUTE_MISSING, ROUTE_BLACKHOLE, ASYMMETRIC_ROUTING, NO_DEFAULT_ROUTE
      BGP: BGP_NEIGHBOR_DOWN, BGP_PREFIX_NOT_SENT, BGP_MAX_PREFIX, BGP_AS_PATH_LOOP
      EVPN: EVPN_TYPE2_MISSING, EVPN_TYPE3_MISSING, EVPN_TYPE5_MISSING, EVPN_RT_MISMATCH
      VXLAN: VTEP_UNREACHABLE, VNI_MISMATCH, NVE_INTERFACE_DOWN,
             L3VNI_MISSING, ANYCAST_GW_NOT_RESPONDING
      DHCP: DHCP_NO_ADDRESS, DHCP_SNOOPING_DROP, DHCP_POOL_EXHAUSTED
      DataPlane: MTU_MISMATCH, ACL_BLOCKING, INTERFACE_ERRORS, ECMP_IMBALANCE
      RDMA/GPU: PFC_STORM, DCQCN_NOT_CONFIGURED, RDMA_LOSSLESS_DROPS, PFC_PRIORITY_WRONG
      ControlPlane: CPU_HIGH_COPP, OSPF_NEIGHBOR_DOWN, NTP_OUT_OF_SYNC
      E2E: PING_FAILURE, PORT_NOT_OPEN, TRACEROUTE_LOOP
      WiFi: AP_NOT_JOINING, WIFI_AUTH_FAILURE, SSID_VLAN_MISMATCH
      Infra: INTERFACE_DOWN, LINK_FLAPPING, OPTICS_LOW_POWER
    """
    issue = _monitor_get_issue(issue_id)
    if not issue:
        available = list(_monitor_list_by_cat("l2_vlan")) + list(_monitor_list_by_cat("bgp"))
        return {
            "ok": False,
            "error": f"Issue ID '{issue_id}' not found.",
            "hint": f"Sample valid IDs: {available[:6]}",
        }

    cmds = issue["diagnostic_commands"].get(
        platform,
        list(issue["diagnostic_commands"].values())[0]
    )
    return {
        "ok": True,
        "issue_id":    issue_id,
        "name":        issue["name"],
        "category":    issue["category"],
        "severity":    issue["severity"],
        "affected_layers": issue["affected_layers"],
        "symptoms":    issue["symptoms"],
        "root_causes": issue["root_causes"],
        "diagnostic_commands": {
            "requested_platform": {platform: cmds},
            "all_platforms": issue["diagnostic_commands"],
        },
        "remediation_steps":   issue["remediation_steps"],
        "verification_commands": issue.get("verification_commands", {}),
        "tags": issue.get("tags", []),
    }


# ===========================================================================
# ── TOOL 16 — troubleshoot ──────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def troubleshoot(
    state: dict[str, Any],
    symptoms: list[str],
) -> dict[str, Any]:
    """
    Root-cause analysis: correlate multiple symptoms into a single most-likely
    root cause, then generate a step-by-step investigation runbook and a
    Mermaid fault-tree diagram.

    Unlike diagnose_network() (which returns individual issue matches),
    troubleshoot() looks at symptoms collectively and identifies which single
    underlying fault best explains all of them together.

    Supports 11 root-cause patterns:
      - UNDERLAY_FAILURE       — OSPF/IS-IS adjacency lost → BGP/NVE cascade
      - SPINE_FAILURE          — Spine hardware failure → ECMP loss
      - EVPN_POLICY_MISCONFIGURATION — RT/VNI mismatch → routes not imported
      - PFC_DEADLOCK_GPU       — PFC storm → RDMA stall (GPU fabric)
      - VXLAN_ENCAP_MISCONFIGURATION — NVE/VNI config missing
      - L2_DOMAIN_ISOLATION    — VLAN/trunk misconfiguration
      - MTU_BLACKHOLE          — Path MTU < VXLAN overhead → silent drops
      - BGP_POLICY_FILTER      — Route-map/prefix-list blocking routes
      - DHCP_INFRASTRUCTURE_FAILURE — Relay/snooping/pool failure
      - PHYSICAL_LAYER_FAILURE — Cable/optics/port hardware issue
      - WIRELESS_INFRASTRUCTURE — AP/RADIUS/CAPWAP failure

    Args:
        state:    Design state dict (from design_network).
        symptoms: List of observed symptom strings. More symptoms = better
                  correlation accuracy. Examples:
                    ["bgp neighbor down", "vtep unreachable", "ospf adjacency lost"]
                    ["pfc storm", "rdma drops", "gpu training stuck"]
                    ["vlan mismatch", "hosts cannot communicate", "mac not learned"]

    Returns:
        root_cause:            Top hypothesis with confidence, explanation, evidence
        alternative_hypotheses: Next-best hypotheses
        runbook:               Ordered steps (verify → isolate → fix → confirm)
        fault_tree_diagram:    Mermaid flowchart of the fault chain
        confidence_summary:    Plain-English RCA summary
    """
    log.info("troubleshoot called — %d symptoms", len(symptoms))
    try:
        return _quick_triage(state, symptoms)
    except Exception as exc:
        log.exception("troubleshoot error")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 17 — run_static_analysis ───────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def run_static_analysis(state: dict[str, Any]) -> dict[str, Any]:
    """
    Run 26 deterministic static design-quality checks against the network state.

    Unlike live monitoring (diagnose_network / run_health_check), this tool
    analyses the *design intent* stored in state — no devices needed. It flags
    configuration risks, policy gaps, and best-practice violations before
    anything is deployed.

    Checks span 6 domains:
      • ip       — address overlap, loopback plan, /31 P2P, RFC-1918
      • vlan     — reserved VLANs, VNI-VLAN mapping, L3VNI transit VLANs
      • bgp      — AS number, iBGP RR pairs, EVPN AF, timer tuning
      • evpn     — symmetric IRB, ARP suppression, RT format, BUM control
      • fabric   — MTU for VXLAN, BFD, ECMP link count, PFC for GPU
      • security — in-band mgmt risk, plaintext AAA, no ACL on mgmt VRF

    Args:
        state: Network state dict from design_network (or any partial state).

    Returns:
        overall:       "pass" | "warn" | "fail" | "critical"
        score:         0-100 quality score
        summary:       Plain-text executive summary
        check_count:   Total checks run
        fail_count:    Checks that failed
        warn_count:    Checks that warned
        pass_count:    Checks that passed
        domain_scores: Per-domain score breakdown
        findings:      List of Finding dicts — each has:
                         check_id, domain, severity, status, title, detail, fix, affected
    """
    log.info("run_static_analysis called — state keys=%s", list(state.keys()))
    try:
        report = _run_static_analysis(state)
        return {
            "ok":           True,
            "overall":      report.overall,
            "score":        report.score,
            "summary":      report.summary,
            "check_count":  report.check_count,
            "fail_count":   report.fail_count,
            "warn_count":   report.warn_count,
            "pass_count":   report.pass_count,
            "domain_scores": report.domain_scores,
            "findings": [
                {
                    "check_id":  f.check_id,
                    "domain":    f.domain,
                    "severity":  f.severity,
                    "status":    f.status,
                    "title":     f.title,
                    "detail":    f.detail,
                    "fix":       f.fix,
                    "affected":  f.affected,
                }
                for f in report.findings
            ],
        }
    except Exception as exc:
        log.exception("run_static_analysis error")
        return {"ok": False, "error": str(exc)}


# ===========================================================================
# ── TOOL 18 — run_post_checks ────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def run_post_checks(
    state: dict[str, Any],
    inventory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run post-deployment validation checks against live devices (or simulation).

    When inventory is provided, connects via SSH (Nornir + Netmiko) and runs:
      1. BGP summary / routing table / interface error counters
      2. LLDP neighbor collection (JSON-structured; regex fallback for IOS)
      3. ECN threshold check — verifies WRED/ECN is configured per interface
      4. PFC storm counter check — flags non-zero PFC storm drops
      5. End-to-end jumbo MTU probe — DF-bit ping at 9000 bytes to peer_ip

    When inventory is empty/None, returns simulated pass results (demo mode).

    Args:
        state:     Network state dict (used for UC — DC/GPU get MTU checks).
        inventory: Dict of host_name → {hostname, platform, username, password,
                   peer_ip (optional, required for MTU probe)}.
                   Example:
                     {
                       "SPINE-01": {
                         "hostname": "10.0.1.1",
                         "platform": "cisco_nxos",
                         "username": "admin",
                         "password": "...",
                         "peer_ip":  "10.2.1.0"
                       }
                     }

    Returns:
        ok:      True if all checks passed
        results: List of check result dicts — each has:
                   host, check, passed, detail
                   neighbors (LLDP only): [{local_port, remote_host, remote_port}]
        summary: Pass/fail counts and any failed check names
    """
    log.info("run_post_checks called — inventory hosts=%d", len(inventory or {}))
    try:
        results = _run_post_checks(state, inventory or {})
        passed  = [r for r in results if r.get("passed")]
        failed  = [r for r in results if not r.get("passed")]
        return {
            "ok":      len(failed) == 0,
            "results": results,
            "summary": {
                "total":  len(results),
                "passed": len(passed),
                "failed": len(failed),
                "failed_checks": [f"{r['host']}/{r['check']}" for r in failed],
            },
        }
    except Exception as exc:
        log.exception("run_post_checks error")
        return {"ok": False, "error": str(exc), "results": []}


# ===========================================================================
# ── TOOL 20 — monitor_network ────────────────────────────────────────────────
# ===========================================================================
@mcp.tool()
def monitor_network(
    state: dict[str, Any],
    symptoms: list[str] | None = None,
    include_troubleshoot: bool = True,
    top_n: int = 5,
) -> dict[str, Any]:
    """
    Unified network monitoring tool — always runs health_check + static_analysis,
    then optionally adds diagnose and RCA troubleshoot when symptoms are provided.

    This replaces calling run_health_check(), run_static_analysis(),
    diagnose_network(), and troubleshoot() as separate tool calls.

    Args:
        state:                Design state dict (from design_network).
        symptoms:             Optional list of observed symptom strings.
                              When provided, diagnose_network() is run automatically.
                              When 2+ symptoms, troubleshoot() RCA is also run
                              (unless include_troubleshoot=False).
                              Examples:
                                ["bgp neighbor down", "vtep unreachable"]
                                ["pfc storm", "rdma drops", "gpu training stuck"]
        include_troubleshoot: Set False to skip the RCA step even when 2+ symptoms
                              are given (faster, returns diagnosis only).
        top_n:                Max diagnosis matches to return (default 5).

    Returns:
        monitor_status:   "healthy" | "degraded" | "critical"
        monitor_score:    0-100 combined health+quality score
        health:           run_health_check() result — per-check items, score, overall
        analysis:         run_static_analysis() result — 26 checks, domain scores
        diagnosis:        diagnose_network() result (only when symptoms provided)
        rca:              troubleshoot() result (only when 2+ symptoms and include_troubleshoot)
        action_items:     Deduplicated priority list of recommended fixes across all checks
        summary:          Single plain-English paragraph combining all findings
    """
    log.info(
        "monitor_network called — uc=%s symptoms=%d include_ts=%s",
        state.get("uc"), len(symptoms or []), include_troubleshoot,
    )

    result: dict[str, Any] = {"ok": True}
    errors: list[str] = []

    # ── Phase 1: Health check (always) ──────────────────────────────────────
    health_result: dict[str, Any] = {}
    try:
        report = _monitor_health_check(state)
        health_result = {
            "overall":        report.overall,
            "score":          report.score,
            "summary":        report.summary,
            "items": [
                {
                    "check":    item.check,
                    "status":   item.status,
                    "message":  item.message,
                    "issue_id": item.issue_id,
                }
                for item in report.items
            ],
            "failed_checks":  [i.check for i in report.items if i.status == "fail"],
            "warning_checks": [i.check for i in report.items if i.status == "warn"],
        }
        log.info("Health check: %s score=%d", report.overall, report.score)
    except Exception as exc:
        log.warning("monitor_network health_check failed: %s", exc)
        errors.append(f"health_check: {exc}")
        health_result = {"overall": "unknown", "score": 0, "error": str(exc)}

    # ── Phase 2: Static analysis (always) ───────────────────────────────────
    analysis_result: dict[str, Any] = {}
    try:
        sa = _run_static_analysis(state)
        analysis_result = {
            "overall":      sa.overall,
            "score":        sa.score,
            "summary":      sa.summary,
            "check_count":  sa.check_count,
            "fail_count":   sa.fail_count,
            "warn_count":   sa.warn_count,
            "pass_count":   sa.pass_count,
            "domain_scores": sa.domain_scores,
            "findings": [
                {
                    "check_id": f.check_id,
                    "domain":   f.domain,
                    "severity": f.severity,
                    "status":   f.status,
                    "title":    f.title,
                    "detail":   f.detail,
                    "fix":      f.fix,
                    "affected": f.affected,
                }
                for f in sa.findings
            ],
        }
        log.info("Static analysis: %s score=%d", sa.overall, sa.score)
    except Exception as exc:
        log.warning("monitor_network static_analysis failed: %s", exc)
        errors.append(f"static_analysis: {exc}")
        analysis_result = {"overall": "unknown", "score": 0, "error": str(exc)}

    # ── Phase 3: Diagnose (when symptoms provided) ───────────────────────────
    diagnosis_result: dict[str, Any] = {}
    if symptoms:
        try:
            matches = _monitor_diagnose(state, symptoms, top_n=top_n)

            def _match_to_dict(m: DiagnosticMatch) -> dict:
                return {
                    "issue_id":             m.issue_id,
                    "name":                 m.name,
                    "category":             m.category,
                    "severity":             m.severity,
                    "confidence":           round(m.score * 100),
                    "root_causes":          m.root_causes,
                    "diagnostic_commands":  m.commands,
                    "remediation_steps":    m.remediation,
                    "verification_commands": m.verification,
                    "tags":                 m.tags,
                }

            result_dicts = [_match_to_dict(m) for m in matches]
            categories   = list({m.category for m in matches})
            top_match    = matches[0] if matches else None
            diag_summary = (
                f"Top match: {top_match.name} ({top_match.category}, "
                f"{top_match.severity} severity, {round(top_match.score*100)}% confidence). "
                f"{len(matches)} issue(s) across: {', '.join(categories)}."
                if top_match else "No matching issues found for the provided symptoms."
            )
            diagnosis_result = {
                "match_count": len(matches),
                "matches":     result_dicts,
                "categories":  categories,
                "summary":     diag_summary,
            }
            log.info("Diagnosis: %d matches top=%s", len(matches),
                     top_match.issue_id if top_match else "none")
        except Exception as exc:
            log.warning("monitor_network diagnose failed: %s", exc)
            errors.append(f"diagnose: {exc}")
            diagnosis_result = {"match_count": 0, "error": str(exc)}

    # ── Phase 4: RCA troubleshoot (when 2+ symptoms and enabled) ────────────
    rca_result: dict[str, Any] = {}
    if symptoms and len(symptoms) >= 2 and include_troubleshoot:
        try:
            rca_result = _quick_triage(state, symptoms)
            log.info("RCA complete — root_cause=%s",
                     rca_result.get("root_cause", {}).get("root_cause_id", "?"))
        except Exception as exc:
            log.warning("monitor_network troubleshoot failed: %s", exc)
            errors.append(f"troubleshoot: {exc}")
            rca_result = {"error": str(exc)}

    # ── Phase 5: Compute unified monitor_status and monitor_score ────────────
    h_score = health_result.get("score", 0)
    a_score = analysis_result.get("score", 0)

    # Diagnosis penalty: critical=−20, high=−10, medium=−5 (top match only)
    diag_penalty = 0
    if diagnosis_result.get("matches"):
        top_sev = diagnosis_result["matches"][0].get("severity", "")
        diag_penalty = {"critical": 20, "high": 10, "medium": 5}.get(top_sev, 0)

    # Weighted combined score: 45% health, 45% analysis, −diag_penalty
    monitor_score = max(0, round(h_score * 0.45 + a_score * 0.45 - diag_penalty))

    # Status is worst of health + analysis overall (plus diagnosis bump if critical)
    _status_rank = {"healthy": 0, "pass": 0, "warn": 1, "degraded": 1, "fail": 2, "critical": 2, "unknown": 1}
    h_rank = _status_rank.get(health_result.get("overall", "unknown"), 1)
    a_rank = _status_rank.get(analysis_result.get("overall", "unknown"), 1)
    worst  = max(h_rank, a_rank)
    if diag_penalty >= 20:
        worst = max(worst, 2)
    monitor_status = {0: "healthy", 1: "degraded", 2: "critical"}[worst]

    # ── Phase 6: Build deduplicated action_items list ────────────────────────
    action_items: list[dict[str, str]] = []

    # From health failed/warn checks
    for item in health_result.get("items", []):
        if item["status"] in ("fail", "warn"):
            action_items.append({
                "source":   "health_check",
                "priority": "high" if item["status"] == "fail" else "medium",
                "check":    item["check"],
                "message":  item["message"],
                "issue_id": item.get("issue_id", ""),
            })

    # From static analysis findings (fail/warn only)
    for f in analysis_result.get("findings", []):
        if f["status"] in ("fail", "warn"):
            action_items.append({
                "source":   "static_analysis",
                "priority": "high" if f["status"] == "fail" else "medium",
                "check":    f["check_id"],
                "message":  f["title"],
                "fix":      f.get("fix", ""),
            })

    # From top diagnosis match remediation
    if diagnosis_result.get("matches"):
        top_diag = diagnosis_result["matches"][0]
        for step in top_diag.get("remediation_steps", [])[:3]:
            action_items.append({
                "source":   "diagnosis",
                "priority": "high" if top_diag.get("severity") in ("critical", "high") else "medium",
                "check":    top_diag["issue_id"],
                "message":  step,
            })

    # Sort: high priority first
    action_items.sort(key=lambda x: 0 if x["priority"] == "high" else 1)

    # ── Phase 7: Combined summary ────────────────────────────────────────────
    parts = [
        f"Monitor status: {monitor_status.upper()} (score {monitor_score}/100). ",
        f"Health: {health_result.get('overall', '?')} ({h_score}/100) — "
        f"{len(health_result.get('failed_checks', []))} failed, "
        f"{len(health_result.get('warning_checks', []))} warnings. ",
        f"Static analysis: {analysis_result.get('overall', '?')} ({a_score}/100) — "
        f"{analysis_result.get('fail_count', 0)} fail, "
        f"{analysis_result.get('warn_count', 0)} warn across "
        f"{analysis_result.get('check_count', 0)} checks.",
    ]
    if diagnosis_result.get("summary"):
        parts.append(f" Diagnosis: {diagnosis_result['summary']}")
    if rca_result.get("confidence_summary"):
        parts.append(f" RCA: {rca_result['confidence_summary']}")

    result.update({
        "monitor_status": monitor_status,
        "monitor_score":  monitor_score,
        "health":         health_result,
        "analysis":       analysis_result,
        "diagnosis":      diagnosis_result if symptoms else {},
        "rca":            rca_result if (symptoms and len(symptoms) >= 2 and include_troubleshoot) else {},
        "action_items":   action_items,
        "summary":        "".join(parts),
        "errors":         errors,
    })
    return result


# ===========================================================================
# ── TOOL 12 — full_automation_pipeline ──────────────────────────────────────
# ===========================================================================
@mcp.tool()
def full_automation_pipeline(
    description: str,
    acknowledge_warnings: bool = False,
    generate_device_configs: bool = True,
) -> dict[str, Any]:
    """
    End-to-end automation pipeline: description → design → validate → simulate → gate → configs.

    This is the single-call entry point for fully autonomous network design and
    validation. It chains all tools in the correct order and returns a
    consolidated report.

    Args:
        description:           Plain-language network description.
        acknowledge_warnings:  Allow deployment past WARN-only issues.
        generate_device_configs: Set False to skip config rendering (faster).

    Returns:
        stage_results:   Dict with outputs from each pipeline stage
        gate_decision:   Final deployment decision
        confidence:      0-100 score
        can_deploy:      Boolean go/no-go
        configs:         Device configs (if generate_device_configs=True)
        summary:         Full narrative report
    """
    log.info("full_automation_pipeline started — description=%d chars", len(description))
    stages: dict[str, Any] = {}
    errors: list[str] = []

    # ── Stage 1: Parse & Design ──────────────────────────────────────────────
    try:
        state = parse_intent(description)
        design = generate_full_design(state)
        stages["design"] = {
            "use_case": state.get("use_case"),
            "scale": state.get("scale"),
            "vendor": state.get("vendor"),
            "device_count": len(state.get("devices", [])),
            "vlan_count": len(state.get("vlans", [])),
            "summary": describe_intent(state),
        }
        log.info("Stage 1 complete — design generated")
    except Exception as exc:
        log.exception("Stage 1 (design) failed")
        errors.append(f"design: {exc}")
        return {"ok": False, "error": f"Design stage failed: {exc}", "stages": stages}

    # ── Stage 2: Policy Validation ───────────────────────────────────────────
    try:
        policy_results = run_policies(state)
        blocked   = len(policy_results.blocks) + len(policy_results.violations)
        auto_fixed = len(policy_results.fixes)
        all_issues = (
            [dict(c="BLOCK", **i) for i in policy_results.blocks] +
            [dict(c="FAIL",  **i) for i in policy_results.violations] +
            [dict(c="WARN",  **i) for i in policy_results.warnings]
        )
        stages["validation"] = {
            "gate_status": policy_results.gate_status,
            "blocked": blocked,
            "auto_fixed": auto_fixed,
            "warnings": len(policy_results.warnings),
            "can_proceed": blocked == 0,
            "issues": all_issues[:10],   # cap for readability
        }
        log.info("Stage 2 complete — policy gate=%s blocked=%d fixed=%d",
                 policy_results.gate_status, blocked, auto_fixed)
    except Exception as exc:
        log.exception("Stage 2 (validation) failed")
        errors.append(f"validation: {exc}")
        stages["validation"] = {"error": str(exc)}
        policy_results = None

    # ── Stage 3: Failure Simulation (worst-case: first spine) ────────────────
    sim_severity = "none"
    try:
        spines = [d for d in state.get("devices", []) if "spine" in d.get("role", "").lower()]
        if spines:
            first_spine = spines[0].get("hostname", spines[0].get("name", "SPINE-01"))
            sim_result = simulate_failure(state, [first_spine])
            sim_severity = sim_result.get("severity", "none")
            stages["simulation"] = {
                "scenario": f"Failure of {first_spine}",
                "severity": sim_severity,
                "partitioned": sim_result.get("partitioned", False),
                "impacted_segments": sim_result.get("impacted", []),
                "remediation": sim_result.get("remediation", [])[:3],
            }
            log.info("Stage 3 complete — sim severity=%s", sim_severity)
        else:
            stages["simulation"] = {"skipped": "No spine devices found in state"}
    except Exception as exc:
        log.exception("Stage 3 (simulation) failed")
        errors.append(f"simulation: {exc}")
        stages["simulation"] = {"error": str(exc)}

    # ── Stage 4: Deployment Gate ─────────────────────────────────────────────
    confidence = 0
    gate_decision = "BLOCKED"
    deploy_ok = False
    try:
        if policy_results:
            conf_data = compute_confidence(policy_results, sim_severity, "PASS")
            confidence = conf_data.get("score", 0) if isinstance(conf_data, dict) else conf_data
            gate = can_deploy(policy_results, sim_severity, "PASS", acknowledge_warnings)
            deploy_ok = gate.get("allowed", False)
            gate_decision = gate.get("status", "BLOCKED")
            stages["gate"] = {
                "confidence": confidence,
                "confidence_label": conf_data.get("label", "") if isinstance(conf_data, dict) else "",
                "gate_decision": gate_decision,
                "can_deploy": deploy_ok,
                "blockers": gate.get("blockers", []),
                "gate_warnings": gate.get("warnings", []),
            }
            log.info("Stage 4 complete — gate=%s confidence=%d", gate_decision, confidence)
    except Exception as exc:
        log.exception("Stage 4 (gate) failed")
        errors.append(f"gate: {exc}")
        stages["gate"] = {"error": str(exc)}

    # ── Stage 5: Config Generation (optional) ────────────────────────────────
    configs: dict = {}
    if generate_device_configs and (deploy_ok or acknowledge_warnings):
        try:
            configs = generate_all_configs(state)
            stages["configs"] = {
                "device_count": len(configs),
                "hostnames": list(configs.keys()),
            }
            log.info("Stage 5 complete — %d configs generated", len(configs))
        except Exception as exc:
            log.exception("Stage 5 (configs) failed")
            errors.append(f"configs: {exc}")
            stages["configs"] = {"error": str(exc)}
    elif generate_device_configs:
        stages["configs"] = {
            "skipped": "Config generation skipped — deployment gate not approved. "
                       "Set acknowledge_warnings=True to force, or fix blocking issues first."
        }

    # ── Build summary narrative ───────────────────────────────────────────────
    summary_parts = [
        f"NetDesign AI — Full Automation Pipeline Report",
        f"{'='*50}",
        f"Description : {description[:120]}{'…' if len(description) > 120 else ''}",
        f"Use Case    : {state.get('use_case', 'unknown')}",
        f"Scale       : {state.get('scale', 'unknown')}",
        f"Vendor      : {state.get('vendor', 'unknown')}",
        f"Devices     : {len(state.get('devices', []))}",
        f"VLANs       : {len(state.get('vlans', []))}",
        f"",
        f"Policy Gate : {'✅ PASSED' if stages.get('validation', {}).get('can_proceed') else '❌ FAILED'}",
        f"Sim Severity: {sim_severity.upper()}",
        f"Confidence  : {confidence}/100",
        f"Decision    : {gate_decision}",
        f"Configs     : {len(configs)} devices generated" if configs else "Configs: not generated",
    ]
    if errors:
        summary_parts += ["", "Errors:", *[f"  • {e}" for e in errors]]

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "stage_results": stages,
        "gate_decision": gate_decision,          # CLEAR_TO_DEPLOY | PROCEED_WITH_CAUTION | BLOCKED
        "confidence": confidence,                # 0-100
        "can_deploy": deploy_ok,                 # bool
        "state": state,
        "configs": configs,
        "summary": "\n".join(summary_parts),
    }


# ===========================================================================
# ── RESOURCES ────────────────────────────────────────────────────────────────
# ===========================================================================

@mcp.resource("netdesign://products")
def resource_products() -> str:
    """Full product catalogue — all supported vendors, platforms, and features."""
    return json.dumps(PRODUCT_CATALOGUE, indent=2)


@mcp.resource("netdesign://architectures/{use_case}")
def resource_architecture(use_case: str) -> str:
    """
    Architecture reference card for a specific use-case.
    Available use_cases: dc_fabric, gpu_cluster, campus, branch
    """
    card = ARCH_CARDS.get(use_case)
    if card is None:
        available = list(ARCH_CARDS.keys())
        return json.dumps({"error": f"Unknown use_case '{use_case}'", "available": available})
    return json.dumps(card, indent=2)


@mcp.resource("netdesign://policy-rules")
def resource_policy_rules() -> str:
    """All 15 NetDesign policy rules with IDs, actions, and descriptions."""
    return json.dumps(POLICY_RULES_REF, indent=2)


@mcp.resource("netdesign://community-scheme")
def resource_community_scheme() -> str:
    """BGP community colouring scheme used across all DC and GPU designs."""
    scheme = {
        "standard_communities": {
            "AS:100":  "Primary path — local-preference 200",
            "AS:300":  "Backup path — local-preference 100",
            "AS:1000": "Spine-originated tag (RR reflected routes)",
            "AS:200":  "L2VNI routes (data-plane overlay)",
            "AS:500":  "L3VNI routes (IRB / inter-VRF routing)",
            "AS:9999": "RTBH — remotely-triggered blackhole (LP=5000, NH=null0)",
        },
        "evpn_route_targets": {
            "format": "AS:VNI",
            "l2vni_example": "65000:10010 for VLAN 10, VNI 10010",
            "l3vni_example": "65000:19001 for VRF PROD, L3VNI 19001",
        },
        "gpu_communities": {
            "AS:100":  "GPU primary path",
            "AS:200":  "GPU backup path",
            "AS:999":  "GPU fabric blackhole",
        },
        "notes": [
            "AS is replaced by the actual BGP ASN in rendered configs",
            "Spine RR uses 'retain route-target all' — no filtering on RR",
            "ECL (extended community lists) match RT values for per-VNI policy",
        ],
    }
    return json.dumps(scheme, indent=2)


# ===========================================================================
# ── PROMPTS ─────────────────────────────────────────────────────────────────
# ===========================================================================

@mcp.prompt()
def design_campus_network(
    org_name: str,
    floors: int = 3,
    users_per_floor: int = 100,
    wireless: bool = True,
    redundancy: str = "high",
) -> str:
    """
    Generate a campus network design prompt.

    Args:
        org_name:        Organisation name.
        floors:          Number of floors / distribution zones.
        users_per_floor: Estimated users per floor.
        wireless:        Include wireless infrastructure.
        redundancy:      Redundancy level: "high" | "medium" | "low"
    """
    wireless_str = "with wireless 802.11ax (Wi-Fi 6E) access points" if wireless else "wired-only"
    return (
        f"Design an enterprise campus network for {org_name}. "
        f"The building has {floors} floors with approximately {users_per_floor} users per floor. "
        f"Use a 3-tier architecture (core / distribution / access) {wireless_str}. "
        f"Redundancy level: {redundancy}. "
        f"Include VLANs for data, voice (VoIP), management, and guest WiFi. "
        f"Enable 802.1X port authentication with TACACS+ AAA. "
        f"Use OSPF as the underlay IGP with BFD for fast failover. "
        f"Vendor preference: Cisco Catalyst 9000. "
        f"Generate full design with IP plan, VLAN table, and IOS-XE configs."
    )


@mcp.prompt()
def design_dc_fabric(
    org_name: str,
    spine_count: int = 2,
    leaf_count: int = 8,
    tenant_vrfs: list[str] | None = None,
    underlay: str = "ospf",
    vendor: str = "cisco",
) -> str:
    """
    Generate a data centre EVPN/VXLAN fabric design prompt.

    Args:
        org_name:     Organisation name.
        spine_count:  Number of spine switches (≥2 for HA).
        leaf_count:   Number of leaf switches.
        tenant_vrfs:  List of tenant VRF names (e.g. ["PROD", "DEV", "STORAGE"]).
        underlay:     Underlay IGP: "ospf" | "isis" | "bgp"
        vendor:       Hardware vendor: "cisco" | "arista" | "juniper"
    """
    vrfs = tenant_vrfs or ["PROD", "DEV", "STORAGE"]
    vrf_str = ", ".join(vrfs)
    return (
        f"Design a data centre CLOS fabric for {org_name}. "
        f"Architecture: {spine_count} spine switches + {leaf_count} leaf switches. "
        f"Underlay: {underlay.upper()} with /31 P2P links and /32 loopbacks. "
        f"Overlay: EVPN/VXLAN with symmetric IRB. "
        f"Tenant VRFs: {vrf_str}. "
        f"Spines act as BGP Route Reflectors with 'retain route-target all'. "
        f"BGP community colouring: AS:100 primary (LP=200), AS:300 backup (LP=100), AS:9999 RTBH. "
        f"EVPN route-targets: AS:VNI format per VNI. "
        f"Vendor: {vendor} (NX-OS syntax if Cisco, EOS if Arista). "
        f"Include BFD, NTP, LLDP, management OOB VRF. "
        f"Generate full design with IP plan, VLAN/VNI table, BGP topology, and device configs."
    )


@mcp.prompt()
def design_gpu_cluster(
    org_name: str,
    gpu_model: str = "H100",
    gpus_per_rack: int = 8,
    rack_count: int = 8,
    spine_count: int = 2,
    vendor: str = "sonic",
) -> str:
    """
    Generate an AI/ML GPU cluster network design prompt.

    Args:
        org_name:      Organisation name.
        gpu_model:     GPU model: "H100" | "A100" | "H200"
        gpus_per_rack: Number of GPUs per rack (8 = 1 DGX H100 node).
        rack_count:    Number of GPU racks (= number of TOR switches).
        spine_count:   Number of spine switches.
        vendor:        TOR vendor: "sonic" | "arista" | "cisco"
    """
    total_gpus = gpus_per_rack * rack_count
    return (
        f"Design an AI/ML GPU cluster network for {org_name}. "
        f"Hardware: {total_gpus}× NVIDIA {gpu_model} GPUs across {rack_count} racks "
        f"({gpus_per_rack} per rack). "
        f"Fabric: {spine_count} spine switches + {rack_count} TOR switches ({vendor}). "
        f"Host ports: 400GbE per GPU, MTU 9214, RS-FEC enabled. "
        f"Lossless RDMA (RoCE v2): PFC priority 3+4, DCQCN ECN Kmin=50KB Kmax=100KB. "
        f"Underlay: eBGP (spine-TOR-host), private ASNs. "
        f"BGP community scheme: AS:100 GPU-primary, AS:200 GPU-backup, AS:999 blackhole. "
        f"QoS: DSCP 24/26 → TC3 lossless, DSCP 46 → TC5 strict priority. "
        f"Generate full design with IP plan, SONiC CONFIG_DB, FRR BGP config, "
        f"PFC watchdog, and {gpu_model} host port configs."
    )


@mcp.prompt()
def validate_and_deploy(
    state_json: str,
    environment: str = "production",
    change_window: str = "Saturday 02:00-06:00 UTC",
) -> str:
    """
    Generate a validate-and-deploy workflow prompt for an existing design state.

    Args:
        state_json:    JSON string of the design state dict.
        environment:   Target environment: "production" | "staging" | "lab"
        change_window: Maintenance window description.
    """
    return (
        f"Validate and prepare deployment for the following network design state:\n\n"
        f"```json\n{state_json[:500]}{'…' if len(state_json) > 500 else ''}\n```\n\n"
        f"Target environment: {environment}\n"
        f"Change window: {change_window}\n\n"
        f"Perform these steps in order:\n"
        f"1. Run validate_policies() — fix any AUTO_FIX issues, report BLOCK/FAIL\n"
        f"2. Run simulate_failure() for worst-case spine failure scenario\n"
        f"3. Run check_deployment_gate() with the policy and simulation results\n"
        f"4. If gate_decision = APPROVED or CONDITIONAL, run generate_configs()\n"
        f"5. Summarise: confidence score, blocking issues, configs ready for deployment\n"
        f"Do not proceed to configs if any BLOCK or FAIL rules fire."
    )


# ===========================================================================
# ── Entry point ──────────────────────────────────────────────────────────────
# ===========================================================================
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="NetDesign AI MCP Server")
    p.add_argument(
        "--transport",
        choices=["stdio", "sse"],
        default="stdio",
        help="Transport protocol (stdio for Claude Desktop, sse for remote clients)",
    )
    p.add_argument(
        "--port",
        type=int,
        default=8001,
        help="Port for SSE transport (default: 8001)",
    )
    p.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host for SSE transport (default: 0.0.0.0)",
    )
    p.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
        help="Logging verbosity",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    log.info(
        "NetDesign AI MCP Server starting — transport=%s%s",
        args.transport,
        f" host={args.host} port={args.port}" if args.transport == "sse" else " (stdin/stdout)",
    )

    if args.transport == "sse":
        # For SSE, host/port are configured on the FastMCP instance before run()
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.run(transport="sse")
    else:
        mcp.run(transport="stdio")
