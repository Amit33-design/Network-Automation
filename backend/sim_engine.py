"""
NetDesign AI — Failure Simulation Engine
==========================================
Simulates device failures against a topology graph and calculates:
  • Affected paths and traffic flows
  • Topology partition risk (network split detection)
  • Surviving redundant paths
  • EVPN/VTEP reachability impact
  • BGP session impact (RR loss, peer count)
  • Recommended remediation actions

Works entirely from the state dict — no live device queries.
"""
from __future__ import annotations

import itertools
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def simulate_failure(
    state: dict[str, Any],
    failed_devices: list[str],
) -> dict[str, Any]:
    """
    Simulate failure of one or more devices in the topology.

    Args:
        state:          Design state dict (from parse_intent / design_engine).
        failed_devices: List of device identifiers (e.g. ["SPINE-01", "LEAF-02"]).

    Returns:
        {
          "failed":          list of device IDs,
          "impact":          list of impact records,
          "partition_risk":  bool,
          "severity":        "PASS" | "WARN" | "FAIL",
          "surviving_paths": list of surviving path descriptions,
          "bgp_impact":      dict,
          "evpn_impact":     dict,
          "remediation":     list of action strings,
          "confidence_delta":int,   # how much this drops the confidence score
          "summary":         str,
        }
    """
    uc         = state.get("uc", "dc")
    redundancy = state.get("redundancy", "ha")
    dual       = redundancy in ("ha", "full")
    protocols  = state.get("protocols", [])
    has_evpn   = "EVPN" in protocols or "VXLAN" in protocols
    products   = state.get("selectedProducts", {})

    # Build simplified topology graph from state
    graph = _build_graph(state)
    all_nodes = set(graph.keys())

    # Validate failed devices exist in topology
    unknown = [d for d in failed_devices if d not in all_nodes]
    found   = [d for d in failed_devices if d in all_nodes]

    impact_records:  list[dict] = []
    surviving_paths: list[str]  = []
    remediation:     list[str]  = []

    # ── Per-device impact analysis ─────────────────────────────────────────
    for device in found:
        role  = _device_role(device, uc)
        peers = graph.get(device, [])
        rec   = _analyze_device_failure(device, role, peers, graph, state, dual, has_evpn)
        impact_records.append(rec)

    # ── Topology partition detection ───────────────────────────────────────
    partition_risk = _check_partition(graph, found)

    # ── BGP impact ─────────────────────────────────────────────────────────
    bgp_impact = _analyze_bgp_impact(found, state, has_evpn)

    # ── EVPN impact ────────────────────────────────────────────────────────
    evpn_impact = _analyze_evpn_impact(found, state, has_evpn)

    # ── Surviving paths ────────────────────────────────────────────────────
    surviving_paths = _surviving_paths(graph, found, uc, dual)

    # ── Severity scoring ───────────────────────────────────────────────────
    critical_failed = [r for r in impact_records if r.get("critical")]
    if partition_risk or any(r.get("severity") == "FAIL" for r in impact_records):
        severity = "FAIL"
    elif critical_failed:
        severity = "WARN"
    else:
        severity = "PASS"

    # ── Remediation ────────────────────────────────────────────────────────
    remediation = _build_remediation(impact_records, bgp_impact, evpn_impact,
                                     partition_risk, dual, uc)

    # Confidence delta: how much does this failure reduce confidence
    confidence_delta = (
        40 if severity == "FAIL" else
        20 if severity == "WARN" else
        5
    )

    if unknown:
        impact_records.append({
            "device":      ", ".join(unknown),
            "severity":    "INFO",
            "description": f"Device(s) not found in topology model: {unknown}. "
                           f"Known nodes: {sorted(all_nodes)[:10]}{'…' if len(all_nodes) > 10 else ''}",
        })

    # ── Build rich impacted list (human-readable segments) ─────────────────
    impacted_segments = _build_impacted_segments(impact_records, bgp_impact, evpn_impact, uc)

    # ── ECMP summary ───────────────────────────────────────────────────────
    spine_count  = state.get("spine_count") or 2
    leaf_count   = state.get("leaf_count") or 4
    failed_spines = [d for d in found if "spine" in d.lower()]
    failed_leaves = [d for d in found if "leaf" in d.lower() or "tor" in d.lower()]
    ecmp_before  = spine_count
    ecmp_after   = max(0, spine_count - len(failed_spines))
    ecmp_summary = {
        "paths_before":  ecmp_before,
        "paths_after":   ecmp_after,
        "paths_lost":    len(failed_spines),
        "still_redundant": ecmp_after >= 1,
        "bandwidth_remaining_pct": int(100 * ecmp_after / max(ecmp_before, 1)),
    }

    return {
        "failed":              failed_devices,
        "found_in_topology":   found,
        "not_found":           unknown,
        "partitioned":         partition_risk,          # ← boolean (was missing)
        "partition_risk":      partition_risk,
        "severity":            severity.lower().replace("pass", "none").replace("warn", "minor").replace("fail", "critical"),
        "impacted":            impacted_segments,        # ← rich list (was [])
        "impact_records":      impact_records,
        "surviving_paths":     surviving_paths,
        "ecmp":                ecmp_summary,             # ← new: ECMP before/after
        "bgp_impact":          bgp_impact,
        "evpn_impact":         evpn_impact,
        "remediation":         remediation,
        "confidence_delta":    confidence_delta,
        "summary":             _sim_summary(found, severity, partition_risk, surviving_paths, ecmp_summary),
    }


def simulate_link_failure(
    state: dict[str, Any],
    link_a: str,
    link_b: str,
) -> dict[str, Any]:
    """Simulate a single link failure between two devices."""
    graph     = _build_graph(state)
    dual      = state.get("redundancy", "ha") in ("ha", "full")
    uc        = state.get("uc", "dc")
    has_evpn  = "EVPN" in state.get("protocols", [])

    # Remove the link from graph
    temp_graph = {k: [n for n in v if n != link_b] if k == link_a
                  else [n for n in v if n != link_a] if k == link_b
                  else v
                  for k, v in graph.items()}

    # Check if alternate paths exist
    alt_paths = _bfs_paths(temp_graph, link_a, link_b, max_depth=6)
    severity  = "PASS" if alt_paths else ("WARN" if dual else "FAIL")

    return {
        "link": f"{link_a} ↔ {link_b}",
        "alternate_paths": alt_paths,
        "alternate_path_count": len(alt_paths),
        "severity": severity,
        "partition_risk": not alt_paths and not dual,
        "summary": (
            f"Link {link_a}↔{link_b} failed. "
            f"{len(alt_paths)} alternate path(s) available. "
            f"Severity: {severity}"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Graph builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_graph(state: dict[str, Any]) -> dict[str, list[str]]:
    """Build adjacency list from design state."""
    uc        = state.get("uc", "dc")
    dual      = state.get("redundancy", "ha") in ("ha", "full")
    products  = state.get("selectedProducts", {})
    graph: dict[str, list[str]] = {}

    def add_edge(a: str, b: str) -> None:
        graph.setdefault(a, []).append(b)
        graph.setdefault(b, []).append(a)

    if uc in ("dc", "hybrid"):
        spine_count = state.get("spine_count") or 2
        leaf_count  = state.get("leaf_count") or 4
        # Import leaf label helper to keep naming consistent with design_engine
        try:
            from design_engine import _make_leaf_labels
            leaves = _make_leaf_labels(leaf_count)
        except ImportError:
            leaves = [f"LEAF-{i:02d}" for i in range(1, leaf_count + 1)]
        spines = [f"SPINE-{i:02d}" for i in range(1, spine_count + 1)]
        # Spine ISL (full mesh)
        for s1 in spines:
            for s2 in spines:
                if s1 < s2:
                    add_edge(s1, s2)
        # CLOS full mesh
        for sp in spines:
            for lf in leaves:
                add_edge(sp, lf)
        # Firewall
        if "fw" in products:
            add_edge("CORP-FW-01", "SPINE-01")
            add_edge("CORP-FW-01", "SPINE-02")
            add_edge("CORP-FW-02", "SPINE-01")
            add_edge("CORP-FW-02", "SPINE-02")
            add_edge("CORP-FW-01", "CORP-FW-02")
            add_edge("INET-FW-01", "CORP-FW-01")
            add_edge("INET-FW-02", "CORP-FW-02")
            add_edge("INET-FW-01", "INET-FW-02")
            add_edge("WAN-EDGE-01", "INET-FW-01")
            add_edge("WAN-EDGE-02", "INET-FW-02")
        # Servers per leaf
        for i, lf in enumerate(leaves, 1):
            for s in range(1, 3):
                add_edge(lf, f"SRV-{i}-{s:02d}")

    elif uc == "gpu":
        spine_count = state.get("spine_count") or 2
        tor_count   = state.get("leaf_count") or state.get("tor_count") or 8
        spines = [f"GPU-SPINE-{i:02d}" for i in range(1, spine_count + 1)]
        tors   = [f"GPU-TOR-{i:02d}" for i in range(1, tor_count + 1)]
        for s1 in spines:
            for s2 in spines:
                if s1 < s2:
                    add_edge(s1, s2)
        for sp in spines:
            for tor in tors:
                add_edge(sp, tor)
        gpus_per_rack = (state.get("gpu_count") or 0) // max(tor_count, 1) or 8
        for i, tor in enumerate(tors, 1):
            for g in range(1, gpus_per_rack + 1):
                add_edge(tor, f"H100-R{i}-GPU{g}")

    elif uc == "campus":
        core_count = 2 if dual else 1
        cores = [f"CORE-{i:02d}" for i in range(1, core_count + 1)]
        if dual:
            add_edge("CORE-01", "CORE-02")
        dists = [f"DIST-{z}" for z in ["FL1", "FL2", "SRV", "IoT"]]
        for dist in dists:
            for core in cores:
                add_edge(core, dist)
            add_edge(dist, dist.replace("DIST-", "ACC-"))
        # Firewall
        if "fw" in products:
            add_edge("FW-01", "CORE-01")
            if dual:
                add_edge("FW-02", "CORE-02")
                add_edge("FW-01", "FW-02")
            add_edge("INTERNET", "FW-01")
            if dual:
                add_edge("INTERNET", "FW-02")
        else:
            add_edge("INTERNET", cores[0])

    return graph


# ─────────────────────────────────────────────────────────────────────────────
# Analysis helpers
# ─────────────────────────────────────────────────────────────────────────────

_CRITICAL_ROLES = {"campus-core", "dc-spine", "gpu-spine", "fw", "wan-hub"}

def _device_role(device_id: str, uc: str) -> str:
    d = device_id.lower()
    if "spine" in d:
        return "dc-spine" if "gpu" not in d else "gpu-spine"
    if "core" in d:
        return "campus-core"
    if "leaf" in d or "tor" in d:
        return "dc-leaf" if "gpu" not in d else "gpu-tor"
    if "dist" in d:
        return "campus-dist"
    if "fw" in d or "firewall" in d:
        return "fw"
    if "wan" in d:
        return "wan-hub"
    if "h100" in d or "srv" in d or "server" in d:
        return "server"
    return "unknown"


def _analyze_device_failure(
    device: str, role: str, peers: list[str],
    graph: dict[str, list[str]], state: dict[str, Any],
    dual: bool, has_evpn: bool,
) -> dict[str, Any]:
    """Return an impact record for a single failed device."""
    is_critical = role in _CRITICAL_ROLES
    affected    = peers.copy()

    if role == "dc-spine":
        surviving_rr = [n for n in graph if "spine" in n.lower() and n != device]
        if surviving_rr:
            severity = "WARN"
            desc = (
                f"Spine {device} failed. "
                f"Surviving RR: {surviving_rr[0]}. "
                f"EVPN sessions re-established via remaining spine. "
                f"Traffic converges via remaining {len(surviving_rr)} spine(s)."
            )
            evpn_affected = True
        else:
            severity = "FAIL"
            desc = (
                f"ALL spines failed. EVPN control plane lost. "
                f"No BGP RR available. Fabric BLACK-HOLED."
            )
            evpn_affected = True
    elif role == "gpu-spine":
        surviving_spines = [n for n in graph if "gpu-spine" in n.lower() and n != device]
        severity = "WARN" if surviving_spines else "FAIL"
        desc = (
            f"GPU Spine {device} failed. "
            + (f"ECMP continues via {surviving_spines}. Some BW reduction."
               if surviving_spines else "All GPU spines failed — fabric partitioned.")
        )
        evpn_affected = False
    elif role == "campus-core":
        surviving_cores = [n for n in graph if "core" in n.lower() and n != device]
        severity = "WARN" if (dual and surviving_cores) else "FAIL"
        desc = (
            f"Campus Core {device} failed. "
            + (f"Failover to {surviving_cores[0]}. VSS/StackWise-Virtual re-converges."
               if surviving_cores else "Single core — full campus outage.")
        )
        evpn_affected = False
    elif role in ("dc-leaf", "gpu-tor"):
        severity = "WARN"
        desc = (
            f"{'Leaf' if role=='dc-leaf' else 'TOR'} {device} failed. "
            f"Servers directly attached lose connectivity. "
            f"Workloads on {affected[:3]} affected. "
            f"vPC/MLAG peer continues serving remaining servers."
        )
        evpn_affected = has_evpn
    elif role == "fw":
        surviving_fw = [n for n in graph if "fw" in n.lower() and n != device]
        severity = "WARN" if surviving_fw else "FAIL"
        desc = (
            f"Firewall {device} failed. "
            + (f"HA failover to {surviving_fw[0]}. ~1-3s convergence."
               if surviving_fw else "All firewalls failed — internet connectivity lost.")
        )
        evpn_affected = False
    elif role == "server":
        severity = "PASS"
        desc = f"Server {device} failed. Impact limited to this host. No fabric change."
        evpn_affected = False
    else:
        severity = "WARN"
        desc = f"Device {device} (role: {role}) failed. Assess impact manually."
        evpn_affected = False

    return {
        "device":        device,
        "role":          role,
        "critical":      is_critical,
        "severity":      severity,
        "description":   desc,
        "affected_peers": affected[:8],  # cap list for readability
        "evpn_impacted": evpn_affected,
    }


def _check_partition(graph: dict[str, list[str]], failed: list[str]) -> bool:
    """Return True if removing failed nodes disconnects the graph."""
    remaining = {n: [nb for nb in nb_list if nb not in failed]
                 for n, nb_list in graph.items() if n not in failed}
    if not remaining:
        return True
    # BFS from first remaining node
    start     = next(iter(remaining))
    visited   = set()
    queue     = [start]
    while queue:
        node = queue.pop()
        if node in visited:
            continue
        visited.add(node)
        for nb in remaining.get(node, []):
            if nb not in visited and nb not in failed:
                queue.append(nb)
    return visited != set(remaining.keys())


def _analyze_bgp_impact(
    failed: list[str], state: dict[str, Any], has_evpn: bool
) -> dict[str, Any]:
    uc = state.get("uc", "dc")
    rr_failed  = [d for d in failed if "spine" in d.lower() and uc in ("dc", "hybrid")]
    all_spines = ["SPINE-01", "SPINE-02"]
    surviving_rr = [s for s in all_spines if s not in failed]

    if uc in ("dc", "hybrid"):
        return {
            "rr_failed":     rr_failed,
            "surviving_rr":  surviving_rr,
            "evpn_control_plane": "DEGRADED" if rr_failed and surviving_rr else
                                  "DOWN"     if rr_failed and not surviving_rr else
                                  "UP",
            "session_impact": f"{len(rr_failed) * 4} EVPN sessions disrupted (4 leaves × {len(rr_failed)} RR)",
            "reconvergence":  "Sub-second BFD + BGP GR" if surviving_rr else "Full re-establishment needed",
        }
    elif uc == "gpu":
        spine_failed = [d for d in failed if "gpu-spine" in d.lower()]
        return {
            "spine_failed": spine_failed,
            "ecmp_paths_lost": len(spine_failed) * 4,  # 4 TORs per spine
            "host_bgp_impact": "H100 BGP sessions rerouted via surviving spine" if spine_failed else "No BGP impact",
        }
    return {"impact": "Minimal — BGP not primary protocol"}


def _analyze_evpn_impact(
    failed: list[str], state: dict[str, Any], has_evpn: bool,
) -> dict[str, Any]:
    if not has_evpn:
        return {"enabled": False, "impact": "EVPN not configured — no EVPN impact"}

    vtep_failed = [d for d in failed if "leaf" in d.lower() or "tor" in d.lower()]
    rr_failed   = [d for d in failed if "spine" in d.lower()]

    if rr_failed:
        surviving_rr = [s for s in ["SPINE-01", "SPINE-02"] if s not in rr_failed]
        cp_status    = "DEGRADED" if surviving_rr else "DOWN"
    else:
        cp_status = "UP"

    return {
        "enabled":           True,
        "control_plane":     cp_status,
        "vtep_failed":       vtep_failed,
        "mac_ip_routes_lost": f"~{len(vtep_failed) * 200} MAC/IP routes withdrawn",
        "type5_routes_lost":  f"~{len(vtep_failed) * 10} IP prefix routes withdrawn",
        "arp_suppression":   "Cleared for failed VTEP entries (30s timer)",
        "impact_summary": (
            f"{'Control plane impacted — ' if cp_status != 'UP' else ''}"
            f"{len(vtep_failed)} VTEP(s) removed from fabric. "
            f"Traffic rerouted within {'sub-second' if cp_status == 'UP' else '30s BFD'} window."
        ),
    }


def _surviving_paths(
    graph: dict[str, list[str]], failed: list[str], uc: str, dual: bool,
) -> list[str]:
    paths: list[str] = []
    if uc in ("dc", "hybrid"):
        surviving_spines = [n for n in graph if "spine" in n.lower() and n not in failed]
        surviving_leaves  = [n for n in graph if "leaf" in n.lower()  and n not in failed]
        if surviving_spines and surviving_leaves:
            paths.append(
                f"{len(surviving_leaves)} leaf(s) reachable via "
                f"{len(surviving_spines)} surviving spine(s)"
            )
        for lf in surviving_leaves[:4]:
            for sp in surviving_spines:
                paths.append(f"  {lf} → {sp} (ECMP)")
    elif uc == "gpu":
        surviving_spines = [n for n in graph if "gpu-spine" in n.lower() and n not in failed]
        surviving_tors   = [n for n in graph if "gpu-tor" in n.lower()   and n not in failed]
        if surviving_spines:
            paths.append(f"GPU fabric: {len(surviving_tors)} TOR(s) → {surviving_spines} (64-way eBGP ECMP)")
    elif uc == "campus":
        surviving_cores = [n for n in graph if "core" in n.lower() and n not in failed]
        if surviving_cores:
            paths.append(f"Campus: all distributions uplinked to {surviving_cores}")
    return paths


def _bfs_paths(
    graph: dict[str, list[str]], src: str, dst: str, max_depth: int = 6,
) -> list[list[str]]:
    """BFS to find all shortest paths between src and dst (for link failure analysis)."""
    if src not in graph:
        return []
    paths: list[list[str]] = []
    queue = [[src]]
    visited_at_depth: dict[str, int] = {src: 0}
    while queue:
        path = queue.pop(0)
        node = path[-1]
        if len(path) > max_depth:
            break
        for nb in graph.get(node, []):
            if nb == dst:
                paths.append(path + [nb])
            elif nb not in visited_at_depth or visited_at_depth[nb] >= len(path):
                visited_at_depth[nb] = len(path)
                queue.append(path + [nb])
    return paths[:5]  # return max 5 paths


def _build_remediation(
    impacts: list[dict], bgp: dict, evpn: dict,
    partition: bool, dual: bool, uc: str,
) -> list[str]:
    actions: list[str] = []
    if partition:
        actions.append("🚨 CRITICAL: Topology partition detected — restore failed device(s) immediately")
    if bgp.get("evpn_control_plane") == "DOWN":
        actions.append("🔴 EVPN control plane DOWN — restore spine RR(s) to recover fabric")
    if not dual:
        actions.append("⚠️  No redundancy configured — consider upgrading to HA mode")
    for imp in impacts:
        if imp.get("severity") == "FAIL":
            actions.append(f"🔴 Replace/restore {imp['device']} — critical role: {imp['role']}")
        elif imp.get("severity") == "WARN":
            actions.append(f"⚠️  Monitor {imp['device']} — degraded state, failover active")
    if evpn.get("vtep_failed"):
        actions.append(f"🔧 Clear stale ARP/MAC entries on remaining VTEPs for failed leaf VNIs")
        actions.append(f"🔧 Verify 'mac flush' on EVPN type-2 withdrawal propagation")
    if not actions:
        actions.append("✅ No immediate action required — redundant path(s) absorbing failure")
    return actions


def _sim_summary(failed: list[str], severity: str, partition: bool,
                 paths: list[str], ecmp: dict | None = None) -> str:
    icon = {"FAIL": "❌", "WARN": "⚠️", "PASS": "✅"}.get(severity, "❓")
    ecmp_str = ""
    if ecmp:
        ecmp_str = (
            f" · ECMP: {ecmp['paths_before']}→{ecmp['paths_after']} paths "
            f"({ecmp['bandwidth_remaining_pct']}% BW remaining)"
        )
    partition_str = " · ⚠️ PARTITION RISK — network split detected" if partition else " · No partition"
    return (
        f"{icon} {len(failed)} device(s) failed · Severity: {severity}"
        f"{partition_str}{ecmp_str} · {len(paths)} surviving path(s)"
    )


def _build_impacted_segments(impact_records: list[dict], bgp_impact: dict,
                              evpn_impact: dict, uc: str) -> list[str]:
    """Build a human-readable list of impacted network segments and services."""
    segments: list[str] = []

    for rec in impact_records:
        role = rec.get("role", "")
        sev  = rec.get("severity", "")
        dev  = rec.get("device", "")
        if not dev or sev == "INFO":
            continue

        if "spine" in role:
            # Derive surviving spine count from description (set by _analyze_device_failure)
            # description contains "Surviving RR: SPINE-XX" or "ALL spines failed"
            desc = rec.get("description", "")
            all_failed = "ALL spines failed" in desc or "BLACK-HOLED" in desc
            # Count surviving RR mentions
            surviving = 0 if all_failed else 1  # conservative — at least one if not all down
            lost = 1  # this one device failed
            segments.append(
                f"Spine layer — {lost} ECMP path(s) lost, "
                f"{'0' if all_failed else f'{surviving}+'} spine(s) still active"
                + (" (ALL SPINES DOWN — CRITICAL)" if all_failed else " (fabric still converged)")
            )
        elif "gpu-spine" in role:
            desc = rec.get("description", "")
            all_failed = "All GPU spines failed" in desc
            segments.append(
                f"GPU spine layer — 1 ECMP path lost"
                + (" — ALL GPU spines down, fabric partitioned" if all_failed
                   else " — surviving spine(s) absorb traffic")
            )
        elif "leaf" in role or "tor" in role:
            affected = rec.get("affected_peers", [])
            server_peers = [p for p in affected if "srv" in p.lower() or "h100" in p.lower()]
            segments.append(
                f"{'Leaf' if 'leaf' in role else 'TOR'} {dev} — "
                f"{len(server_peers)} server(s) directly attached lose connectivity"
                + (f" (e.g. {server_peers[0]})" if server_peers else "")
            )
        elif "fw" in role:
            desc = rec.get("description", "")
            ha_over = "failover" in desc.lower() or "ha" in desc.lower()
            segments.append(
                f"Firewall {dev} — "
                + ("HA peer takes over (~1-3s convergence)" if ha_over
                   else "ALL firewalls down — internet/inter-zone traffic blocked")
            )
        elif "campus-core" in role:
            desc = rec.get("description", "")
            dual_core = "failover" in desc.lower() or "VSS" in desc
            segments.append(
                f"Campus core {dev} — "
                + ("VSS/StackWise failover to peer core" if dual_core
                   else "Single core failure — full campus unreachable")
            )
        elif "server" in role:
            segments.append(f"{dev} — host unreachable (fabric unaffected)")

    # ── BGP impact (uses actual _analyze_bgp_impact field names) ──────────────
    rr_failed   = bgp_impact.get("rr_failed", [])          # list of device IDs
    surviving_rr = bgp_impact.get("surviving_rr", [])       # list of device IDs
    cp_status   = bgp_impact.get("evpn_control_plane", "UP")
    if rr_failed:
        segments.append(
            f"BGP/EVPN control plane — {len(rr_failed)} RR(s) lost "
            f"({', '.join(rr_failed)}), {len(surviving_rr)} RR(s) still active"
            + (" — EVPN routes still reflected" if surviving_rr
               else " — EVPN control plane DOWN, full re-convergence needed")
        )

    # ── EVPN impact (uses actual _analyze_evpn_impact field names) ────────────
    vtep_failed  = evpn_impact.get("vtep_failed", [])       # list of device IDs
    evpn_enabled = evpn_impact.get("enabled", False)
    if evpn_enabled and vtep_failed:
        segments.append(
            f"EVPN overlay — {len(vtep_failed)} VTEP(s) withdrawn "
            f"({', '.join(vtep_failed)}), MAC/IP entries aging out (30s BFD timer)"
        )
    elif evpn_enabled and rr_failed and cp_status != "UP":
        segments.append(
            f"EVPN control plane {cp_status} — "
            + ("surviving spine reflects EVPN routes" if surviving_rr
               else "no RR available — all EVPN sessions must re-establish")
        )

    if not segments:
        segments.append("No significant traffic impact detected — redundant paths absorb failure")

    return segments
