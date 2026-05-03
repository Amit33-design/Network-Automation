"""
NetDesign AI — Python Design Engine
=====================================
Generates structured design artefacts from a state dictionary:
  • IP addressing plan  (loopbacks, P2P links, management, VLANs, VTEPs)
  • VLAN plan           (IDs, names, VNI mapping, route-targets, purpose)
  • BGP design          (ASN allocation, peer topology, community scheme)
  • Topology graph      (nodes + edges, role annotations)
  • Full design summary (aggregates all of the above)

All functions are pure (no I/O, no side effects).
"""
from __future__ import annotations

from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# IP Plan
# ─────────────────────────────────────────────────────────────────────────────

def generate_ip_plan(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate a structured IP addressing plan.

    Returns:
        {
          "loopbacks":    [{"device": str, "ip": str, "purpose": str}],
          "p2p_links":    [{"from": str, "to": str, "net": str, "a_ip": str, "b_ip": str}],
          "management":   [{"device": str, "ip": str, "mask": str}],
          "vtep_pool":    [{"device": str, "ip": str}],           # DC/GPU only
          "vlan_subnets": [{"vlan": int, "name": str, "subnet": str, "gateway": str}],
          "summary":      str,
        }
    """
    uc         = state.get("uc", "campus")
    redundancy = state.get("redundancy", "ha")
    dual       = redundancy in ("ha", "full")
    products   = state.get("selectedProducts", {})
    vlans      = state.get("vlans", [])

    loopbacks:  list[dict] = []
    p2p_links:  list[dict] = []
    management: list[dict] = []
    vtep_pool:  list[dict] = []

    if uc in ("dc", "hybrid"):
        # Spine count: from explicit NL extraction, then fall back to product presence
        spine_count = state.get("spine_count") or (2 if "dc-spine" in products else 0)
        leaf_count  = state.get("leaf_count") or 4
        for i in range(1, spine_count + 1):
            loopbacks.append({"device": f"SPINE-{i:02d}", "ip": f"10.0.1.{i}/32",    "purpose": "Router-ID / BGP RR"})
            loopbacks.append({"device": f"SPINE-{i:02d}", "ip": f"10.1.1.{i}/32",    "purpose": "VTEP / NVE source (loopback1)"})
            management.append({"device": f"SPINE-{i:02d}", "ip": f"10.100.1.{i}",    "mask": "255.255.255.0"})
        # Leaf loopbacks: 10.0.2.x/32 — label by role (PROD/STOR/DEV)
        _leaf_role_labels = _make_leaf_labels(leaf_count)
        for i in range(1, leaf_count + 1):
            lbl = _leaf_role_labels[i - 1]
            loopbacks.append({"device": lbl, "ip": f"10.0.2.{i}/32",     "purpose": "Router-ID"})
            loopbacks.append({"device": lbl, "ip": f"10.1.2.{i}/32",     "purpose": "VTEP NVE source (loopback1)"})
            management.append({"device": lbl, "ip": f"10.100.2.{i}",     "mask": "255.255.255.0"})
            vtep_pool.append({"device": lbl, "ip": f"10.1.2.{i}/32"})
        # P2P /31 links: spine-to-leaf  10.2.<spine>.<leaf*2>/31
        for sp in range(1, spine_count + 1):
            for lf in range(1, leaf_count + 1):
                base = (lf - 1) * 2
                p2p_links.append({
                    "from":  f"SPINE-{sp:02d} Eth1/{lf}",
                    "to":    f"{_leaf_role_labels[lf-1]} Eth1/{sp}",
                    "net":   f"10.2.{sp}.{base}/31",
                    "a_ip":  f"10.2.{sp}.{base + 1}/31",
                    "b_ip":  f"10.2.{sp}.{base}/31",
                })
        # Anycast GW per VRF/VLAN
        vlan_subnets = []
        vrf_map = {"PROD": 10, "DEV": 20, "STORAGE": 30}
        for v in vlans or [{"id": 10, "name": "PROD-SERVERS"}, {"id": 20, "name": "DEV-SERVERS"}, {"id": 30, "name": "STORAGE"}]:
            vrf_id = v["id"] // 10
            vlan_subnets.append({
                "vlan":    v["id"],
                "name":    v["name"],
                "subnet":  f"10.{v['id']}.0.0/24",
                "gateway": f"10.{v['id']}.0.1",
                "vni":     10_000 + v["id"],
            })

    elif uc == "gpu":
        spine_count = state.get("spine_count") or 2
        tor_count   = state.get("leaf_count") or state.get("tor_count") or 8
        gpus_per_rack = (state.get("gpu_count") or 0) // max(tor_count, 1) or 8
        for i in range(1, spine_count + 1):
            loopbacks.append({"device": f"GPU-SPINE-{i:02d}", "ip": f"10.200.1.{i}/32", "purpose": "Router-ID"})
            management.append({"device": f"GPU-SPINE-{i:02d}", "ip": f"10.100.3.{i}",   "mask": "255.255.255.0"})
        for i in range(1, tor_count + 1):
            loopbacks.append({"device": f"GPU-TOR-{i:02d}",   "ip": f"10.200.2.{i}/32", "purpose": "TOR Router-ID"})
            management.append({"device": f"GPU-TOR-{i:02d}",  "ip": f"10.100.4.{i}",    "mask": "255.255.255.0"})
        # P2P TOR ↔ Spine: 10.3.<spine>.<tor*2>/31
        for sp in range(1, spine_count + 1):
            for tor in range(1, tor_count + 1):
                base = (tor - 1) * 2
                p2p_links.append({
                    "from": f"GPU-SPINE-{sp:02d} Eth{tor}",
                    "to":   f"GPU-TOR-{tor:02d} Eth{sp}",
                    "net":  f"10.3.{sp}.{base}/31",
                    "a_ip": f"10.3.{sp}.{base + 1}/31",
                    "b_ip": f"10.3.{sp}.{base}/31",
                })
        # H100 BGP host sessions: 10.220.<rack>.<gpu>/32
        h100_hosts = []
        for rack in range(1, tor_count + 1):
            for gpu in range(1, gpus_per_rack + 1):
                h100_hosts.append({
                    "device": f"H100-Rack{rack}-GPU{gpu}",
                    "ip":     f"10.220.{rack}.{gpu}/32",
                    "tor":    f"GPU-TOR-{rack:02d}",
                    "asn":    65300 + (rack - 1) * gpus_per_rack + gpu,
                })
        vlan_subnets = [{"vlan": 10, "name": "GPU-COMPUTE", "subnet": "10.220.0.0/16", "gateway": "10.220.0.1"}]
        return {
            "loopbacks":    loopbacks,
            "p2p_links":    p2p_links,
            "management":   management,
            "vtep_pool":    vtep_pool,
            "h100_hosts":   h100_hosts,
            "vlan_subnets": vlan_subnets,
            "summary":      _ip_summary(uc, loopbacks, p2p_links, management),
        }

    elif uc == "campus":
        layers = [
            ("CORE",   2 if dual else 1, "10.0.10"),
            ("DIST",   4,                 "10.0.11"),
            ("ACCESS", 8,                 "10.0.12"),
        ]
        for role, count, base in layers:
            for i in range(1, count + 1):
                loopbacks.append({"device": f"{role}-{i:02d}",  "ip": f"{base}.{i}/32",       "purpose": "Router-ID"})
                management.append({"device": f"{role}-{i:02d}", "ip": f"10.100.10.{i + (('DIST' in role) * 10) + (('ACCESS' in role) * 20)}", "mask": "255.255.255.0"})
        for i in range(1, 4 + 1):
            # Dist ↔ Core uplinks: /31
            for c in range(1, (2 if dual else 1) + 1):
                p2p_links.append({
                    "from": f"DIST-{i:02d} Gi1/{c}",
                    "to":   f"CORE-{c:02d} Gi1/{i}",
                    "net":  f"10.4.{i}.{(c-1)*2}/31",
                    "a_ip": f"10.4.{i}.{(c-1)*2}/31",
                    "b_ip": f"10.4.{i}.{(c-1)*2+1}/31",
                })
        vlan_subnets = []
        for v in vlans:
            vlan_subnets.append({
                "vlan":    v["id"],
                "name":    v["name"],
                "subnet":  f"192.168.{v['id']}.0/24",
                "gateway": f"192.168.{v['id']}.1",
            })

    elif uc == "wan":
        hub_count = 2 if dual else 1
        for i in range(1, hub_count + 1):
            loopbacks.append({"device": f"WAN-HUB-{i:02d}", "ip": f"10.0.200.{i}/32", "purpose": "BGP RID"})
            management.append({"device": f"WAN-HUB-{i:02d}", "ip": f"10.100.200.{i}", "mask": "255.255.255.0"})
        vlan_subnets = []
    else:
        vlan_subnets = []

    return {
        "loopbacks":    loopbacks,
        "p2p_links":    p2p_links,
        "management":   management,
        "vtep_pool":    vtep_pool,
        "vlan_subnets": vlan_subnets if "vlan_subnets" in dir() else [],
        "summary":      _ip_summary(uc, loopbacks, p2p_links, management),
    }


def _ip_summary(uc: str, loopbacks: list, p2p: list, mgmt: list) -> str:
    return (
        f"IP Plan: {len(loopbacks)} loopback(s) · "
        f"{len(p2p)} P2P link(s) · "
        f"{len(mgmt)} management address(es) · "
        f"Use case: {uc.upper()}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# VLAN Plan
# ─────────────────────────────────────────────────────────────────────────────

def generate_vlan_plan(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate the complete VLAN/VNI plan with route-targets and STP priorities.
    """
    uc    = state.get("uc", "campus")
    vlans = state.get("vlans", [])

    if not vlans:
        from nl_parser import _generate_vlans
        vlans = _generate_vlans(uc, "")

    rows: list[dict] = []
    for v in vlans:
        vid    = v["id"]
        vni    = 10_000 + vid if uc in ("dc", "hybrid", "gpu") else None
        l3vni  = None
        vrf    = None
        rt     = None

        if uc in ("dc", "hybrid"):
            # Assign VRF based on VLAN name
            name_up = v.get("name", "").upper()
            vrf     = ("STORAGE" if "STOR" in name_up or "SAN" in name_up
                       else "DEV"  if "DEV"  in name_up or "QA" in name_up
                       else "PROD")
            vrf_idx = {"PROD": 1, "DEV": 2, "STORAGE": 3}.get(vrf, 1)
            l3vni   = 19_000 + vrf_idx
            rt      = f"65000:{vni}"

        rows.append({
            "id":       vid,
            "name":     v.get("name", f"VLAN{vid}"),
            "purpose":  v.get("purpose", ""),
            "vni":      vni,
            "l3vni":    l3vni,
            "vrf":      vrf,
            "rt":       rt,
            "gateway":  f"10.{vid}.0.1" if uc in ("dc", "hybrid") else f"192.168.{vid}.1",
            "subnet":   f"10.{vid}.0.0/24" if uc in ("dc", "hybrid") else f"192.168.{vid}.0/24",
            "stp_prio": 4096 if "CORE" in str(v.get("stp_root", "")) else 32768,
        })

    # L3VNI transit VLANs for DC
    l3vni_rows: list[dict] = []
    if uc in ("dc", "hybrid"):
        for vrf_name, vrf_idx in [("PROD", 1), ("DEV", 2), ("STORAGE", 3)]:
            l3vni_rows.append({
                "id":      3000 + vrf_idx,
                "name":    f"L3VNI-{vrf_name}-TRANSIT",
                "vni":     19_000 + vrf_idx,
                "vrf":     vrf_name,
                "rt":      f"65000:{19_000 + vrf_idx}",
                "purpose": "L3VNI symmetric IRB transit (no user traffic)",
            })

    return {
        "vlans":       rows,
        "l3vni_vlans": l3vni_rows,
        "total_vlans": len(rows) + len(l3vni_rows),
        "summary":     (
            f"{len(rows)} user VLAN(s)"
            + (f" + {len(l3vni_rows)} L3VNI transit VLAN(s)" if l3vni_rows else "")
            + f" · Use case: {uc.upper()}"
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# BGP Design
# ─────────────────────────────────────────────────────────────────────────────

def generate_bgp_design(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate BGP peering topology, ASN assignments, and community scheme.
    """
    uc        = state.get("uc", "dc")
    protocols = state.get("protocols", [])
    has_evpn  = "EVPN" in protocols
    has_vxlan = "VXLAN" in protocols
    products  = state.get("selectedProducts", {})

    asns:    list[dict] = []
    peers:   list[dict] = []
    communities: dict[str, str] = {}

    if uc in ("dc", "hybrid"):
        spine_asn   = state.get("bgp_asn") or 65_000
        spine_count = state.get("spine_count") or 2
        leaf_count  = state.get("leaf_count") or 4
        leaf_labels = _make_leaf_labels(leaf_count)
        for i in range(1, spine_count + 1):
            asns.append({
                "device":  f"SPINE-{i:02d}",
                "asn":     spine_asn,
                "role":    "iBGP Route Reflector",
                "comment": "Spines share ASN — no route-reflector loop",
            })
        for i, lbl in enumerate(leaf_labels, 1):
            asns.append({
                "device":  lbl,
                "asn":     spine_asn,
                "role":    "EVPN VTEP / RR client",
                "comment": f"Loopback 10.0.2.{i}/32 used as BGP update-source",
            })
        peers.append({"type": "iBGP", "from": "All LEAFs",   "to": "SPINE-01", "af": "L2VPN EVPN", "notes": "RR client → RR"})
        if spine_count > 1:
            peers.append({"type": "iBGP", "from": "All LEAFs", "to": "SPINE-02", "af": "L2VPN EVPN", "notes": "RR client → RR (redundant)"})
            peers.append({"type": "iBGP", "from": "SPINE-01",  "to": "SPINE-02", "af": "L2VPN EVPN", "notes": "Spine peer (optional)"})

        communities = {
            f"{spine_asn}:100":  "Primary path (LocalPref=200)",
            f"{spine_asn}:300":  "Backup path  (LocalPref=100)",
            f"{spine_asn}:200":  "L2VNI EVPN type-2 routes",
            f"{spine_asn}:500":  "L3VNI EVPN type-5 routes",
            f"{spine_asn}:1000": "Spine-originated (reflected routes)",
            f"{spine_asn}:9999": "RTBH blackhole trigger",
            "no-export":         "Do not propagate to eBGP peers",
        }

        rt_scheme: list[dict] = []
        vlans = state.get("vlans", [{"id": 10}, {"id": 20}, {"id": 30}])
        for v in vlans:
            vni = 10_000 + v["id"]
            rt_scheme.append({
                "vni": vni, "vlan": v["id"],
                "rt_import": f"{spine_asn}:{vni}",
                "rt_export": f"{spine_asn}:{vni}",
                "type": "L2VNI",
            })
        for vrf, idx in [("PROD", 1), ("DEV", 2), ("STORAGE", 3)]:
            l3vni = 19_000 + idx
            rt_scheme.append({
                "vni": l3vni, "vrf": vrf,
                "rt_import": f"{spine_asn}:{l3vni}",
                "rt_export": f"{spine_asn}:{l3vni}",
                "type": "L3VNI",
            })

        return {
            "asns":         asns,
            "peers":        peers,
            "communities":  communities,
            "rt_scheme":    rt_scheme,
            "evpn_enabled": has_evpn or has_vxlan,
            "rr_topology":  f"Spine-as-RR ({spine_count} RR spines, {leaf_count} leaf clients)",
            "nh_policy":    "Next-hop unchanged on RR reflection (RFC 4456 §9)",
            "mermaid":      _dc_bgp_mermaid(spine_asn, spine_count, leaf_count, leaf_labels),
            "summary":      f"iBGP AS{spine_asn} · {spine_count} RR spines · {leaf_count} leaf clients · EVPN L2VPN AF · per-VNI RT",
        }

    elif uc == "gpu":
        spine_asn   = 65_200
        spine_count = state.get("spine_count") or 2
        tor_count   = state.get("leaf_count") or state.get("tor_count") or 8
        for i in range(1, spine_count + 1):
            asns.append({"device": f"GPU-SPINE-{i:02d}", "asn": spine_asn, "role": "eBGP spine"})
        for i in range(1, tor_count + 1):
            tor_asn = 65_300 + i
            asns.append({"device": f"GPU-TOR-{i:02d}", "asn": tor_asn, "role": "eBGP TOR"})
        for sp in range(1, spine_count + 1):
            peers.append({"type": "eBGP", "from": "GPU-TOR-xx", "to": f"GPU-SPINE-{sp:02d}",
                          "af": "IPv4 Unicast", "notes": f"TOR eBGP to spine (ECMP path {sp})"})
        peers.append({"type": "eBGP", "from": "H100-GPUx", "to": "GPU-TOR-xx",
                      "af": "IPv4 Unicast", "notes": "Host /32 BGP session — RDMA path selection"})
        communities = {
            "65200:100": "GPU fabric tag",
            "65200:200": "Primary path (LP=200)",
            "65200:300": "Backup path  (LP=100)",
            "65200:9999": "RTBH blackhole",
        }
        return {
            "asns":         asns,
            "peers":        peers,
            "communities":  communities,
            "rt_scheme":    [],
            "evpn_enabled": False,
            "ecmp_paths":   spine_count * 2,
            "hash_policy":  "Symmetric: src-ip + dst-ip + proto + L4-ports",
            "mermaid":      _gpu_bgp_mermaid(spine_count, tor_count),
            "summary":      f"eBGP fabric · Spine AS{spine_asn} · {tor_count} TOR switches · H100 /32 host sessions · {spine_count*2}-way ECMP",
        }

    elif uc == "campus":
        asns.append({"device": "CAMPUS-CORE", "asn": 65_001, "role": "iBGP upstream (optional)"})
        communities = {
            "65001:100": "Primary uplink",
            "65001:200": "Backup uplink",
            "65001:9999": "RTBH",
        }
        return {
            "asns": asns, "peers": peers, "communities": communities,
            "rt_scheme": [], "evpn_enabled": False,
            "summary": "OSPF-primary campus, BGP optional for upstream/ISP peering",
        }

    return {"asns": [], "peers": [], "communities": {}, "summary": "BGP not applicable"}


def _make_leaf_labels(leaf_count: int) -> list[str]:
    """
    Generate role-aware leaf hostnames given a count.
    Distributes PROD/STOR/DEV labels proportionally.
    e.g. 4 → [LEAF-PROD-01, LEAF-PROD-02, LEAF-STOR-01, LEAF-DEV-01]
         8 → [LEAF-PROD-01..04, LEAF-STOR-01..02, LEAF-DEV-01..02]
    """
    if leaf_count <= 0:
        return []
    prod_n = max(1, leaf_count - (leaf_count // 4) - (leaf_count // 4))
    stor_n = max(1, leaf_count // 4)
    dev_n  = max(1, leaf_count - prod_n - stor_n)
    labels = (
        [f"LEAF-PROD-{i:02d}" for i in range(1, prod_n + 1)] +
        [f"LEAF-STOR-{i:02d}" for i in range(1, stor_n + 1)] +
        [f"LEAF-DEV-{i:02d}"  for i in range(1, dev_n  + 1)]
    )
    # If rounding left us short/over, pad or trim to exact count
    while len(labels) < leaf_count:
        labels.append(f"LEAF-PROD-{len(labels)+1:02d}")
    return labels[:leaf_count]


def _dc_bgp_mermaid(spine_asn: int, spine_count: int = 2,
                    leaf_count: int = 4, leaf_labels: list[str] | None = None) -> str:
    lines = ["graph TD"]
    for i in range(1, spine_count + 1):
        lines.append(f"  SPINE{i}[SPINE-{i:02d}<br/>AS{spine_asn} RR]")
    # Spine ISL
    for i in range(1, spine_count):
        lines.append(f"  SPINE{i} <-->|iBGP RR| SPINE{i+1}")
    # Leaf → Spine edges (cap diagram at 6 leaves for readability)
    shown = min(leaf_count, 6)
    lbs   = (leaf_labels or _make_leaf_labels(leaf_count))[:shown]
    for i, lbl in enumerate(lbs, 1):
        short = lbl.replace("LEAF-", "L").replace("-0", "-").replace("-", "")
        lines.append(f"  {short}[{lbl}<br/>AS{spine_asn} VTEP]")
        for sp in range(1, spine_count + 1):
            lines.append(f"  {short} -->|EVPN client| SPINE{sp}")
    if leaf_count > shown:
        lines.append(f"  DOTDOT[... +{leaf_count - shown} more leaves]")
    return "\n".join(lines)


def _gpu_bgp_mermaid(spine_count: int = 2, tor_count: int = 8) -> str:
    lines = ["graph TD"]
    for i in range(1, spine_count + 1):
        lines.append(f"  SP{i}[GPU-SPINE-{i:02d}<br/>AS65200]")
    if spine_count > 1:
        lines.append(f"  SP1 <-->|ISL| SP{spine_count}")
    shown_tors = min(tor_count, 4)
    for i in range(1, shown_tors + 1):
        lines.append(f"  TOR{i}[GPU-TOR-{i:02d}<br/>AS6530{i}]")
        for sp in range(1, spine_count + 1):
            lines.append(f"  TOR{i} -->|eBGP ECMP| SP{sp}")
    if tor_count > shown_tors:
        lines.append(f"  TORMORE[... +{tor_count - shown_tors} more TORs]")
    lines.append(f"  H100[H100 GPUs<br/>AS654xx] -->|/32 host BGP| TOR1")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Topology Graph
# ─────────────────────────────────────────────────────────────────────────────

def generate_topology(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate a topology graph (nodes + edges) suitable for rendering or
    feeding into a simulation engine.
    """
    uc        = state.get("uc", "dc")
    redundancy= state.get("redundancy", "ha")
    dual      = redundancy in ("ha", "full")
    products  = state.get("selectedProducts", {})

    nodes: list[dict] = []
    edges: list[dict] = []

    if uc in ("dc", "hybrid"):
        spine_count = state.get("spine_count") or 2
        leaf_count  = state.get("leaf_count") or 4
        leaf_labels = _make_leaf_labels(leaf_count)
        for i in range(1, spine_count + 1):
            nodes.append({"id": f"spine{i}", "label": f"SPINE-{i:02d}",
                          "layer": "dc-spine", "critical": True,
                          "product": products.get("dc-spine", "")})
        for i, lbl in enumerate(leaf_labels, 1):
            nodes.append({"id": f"leaf{i}", "label": lbl,
                          "layer": "dc-leaf", "critical": False,
                          "product": products.get("dc-leaf", "")})
        # Spine ISL (full mesh between spines)
        for s1 in range(1, spine_count + 1):
            for s2 in range(s1 + 1, spine_count + 1):
                edges.append({"from": f"spine{s1}", "to": f"spine{s2}", "type": "isl", "bandwidth": "400G"})
        # Full CLOS mesh spine ↔ leaf
        for sp in range(1, spine_count + 1):
            for lf in range(1, leaf_count + 1):
                edges.append({"from": f"spine{sp}", "to": f"leaf{lf}",
                               "type": "uplink", "bandwidth": "100G"})
        if "fw" in products:
            for i in range(1, 3):
                nodes.append({"id": f"corpfw{i}", "label": f"CORP-FW-{i:02d}",
                              "layer": "fw", "critical": True,
                              "product": products.get("fw", "")})
            for sp in range(1, spine_count + 1):
                edges.append({"from": "corpfw1", "to": f"spine{sp}", "type": "fw-uplink"})
                edges.append({"from": "corpfw2", "to": f"spine{sp}", "type": "fw-uplink"})
            edges.append({"from": "corpfw1", "to": "corpfw2", "type": "ha-sync"})

    elif uc == "gpu":
        spine_count   = state.get("spine_count") or 2
        tor_count     = state.get("leaf_count") or state.get("tor_count") or 8
        gpus_per_rack = (state.get("gpu_count") or 0) // max(tor_count, 1) or 8
        for i in range(1, spine_count + 1):
            nodes.append({"id": f"gspine{i}", "label": f"GPU-SPINE-{i:02d}",
                          "layer": "gpu-spine", "critical": True,
                          "product": products.get("gpu-spine", "")})
        for s1 in range(1, spine_count + 1):
            for s2 in range(s1 + 1, spine_count + 1):
                edges.append({"from": f"gspine{s1}", "to": f"gspine{s2}", "type": "isl"})
        for i in range(1, tor_count + 1):
            nodes.append({"id": f"tor{i}", "label": f"GPU-TOR-{i:02d}",
                          "layer": "gpu-tor", "critical": False,
                          "product": products.get("gpu-tor", "")})
            for sp in range(1, spine_count + 1):
                edges.append({"from": f"gspine{sp}", "to": f"tor{i}",
                               "type": "uplink", "bandwidth": "400G"})
            for g in range(1, min(gpus_per_rack, 8) + 1):
                srv_id = f"h100-rack{i}-gpu{g}"
                nodes.append({"id": srv_id, "label": f"H100-R{i}G{g}",
                              "layer": "server", "critical": False})
                edges.append({"from": f"tor{i}", "to": srv_id,
                               "type": "host-link", "bandwidth": "400G",
                               "protocol": "RoCEv2"})

    elif uc == "campus":
        core_count = 2 if dual else 1
        for i in range(1, core_count + 1):
            nodes.append({"id": f"core{i}", "label": f"CORE-{i:02d}",
                          "layer": "campus-core", "critical": True,
                          "product": products.get("campus-core", "")})
        if dual:
            edges.append({"from": "core1", "to": "core2", "type": "isl"})
        zone_labels = ["DIST-FL1", "DIST-FL2", "DIST-SRV", "DIST-IoT"]
        for i, lbl in enumerate(zone_labels, 1):
            nodes.append({"id": f"dist{i}", "label": lbl,
                          "layer": "campus-dist", "critical": False,
                          "product": products.get("campus-dist", "")})
            for c in range(1, core_count + 1):
                edges.append({"from": f"core{c}", "to": f"dist{i}", "type": "uplink"})
            nodes.append({"id": f"acc{i}", "label": f"ACCESS-{i:02d}",
                          "layer": "campus-access", "critical": False,
                          "product": products.get("campus-access", "")})
            edges.append({"from": f"dist{i}", "to": f"acc{i}", "type": "downlink"})

    return {
        "nodes":       nodes,
        "edges":       edges,
        "node_count":  len(nodes),
        "edge_count":  len(edges),
        "critical_nodes": [n["id"] for n in nodes if n.get("critical")],
        "mermaid":     _topology_mermaid(nodes, edges),
        "summary":     f"{len(nodes)} nodes · {len(edges)} edges · {uc.upper()} topology",
    }


def _topology_mermaid(nodes: list[dict], edges: list[dict]) -> str:
    lines = ["graph TD"]
    id_map = {n["id"]: f'{n["id"]}["{n["label"]}"]' for n in nodes}
    for n in nodes:
        lines.append(f"  {id_map[n['id']]}")
    for e in edges:
        style = "-->" if e.get("type") != "ha-sync" else "<-->"
        lines.append(f"  {e['from']} {style} {e['to']}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Design Rationale — "Why this design?"
# ─────────────────────────────────────────────────────────────────────────────

def generate_design_rationale(state: dict[str, Any]) -> dict[str, Any]:
    """
    Produce a structured explanation of every major design decision —
    the 'why' layer that makes the output credible and useful for architects.

    Returns a dict with:
        decisions:  list of {area, choice, rationale, alternatives}
        summary:    prose paragraph
        warnings:   list of trade-offs or considerations
    """
    uc          = state.get("uc", "campus")
    protocols   = state.get("protocols", [])
    redundancy  = state.get("redundancy", "ha")
    spine_count = state.get("spine_count") or 2
    leaf_count  = state.get("leaf_count") or 4
    gpu_count   = state.get("gpu_count") or 0
    vendor      = state.get("_detected_vendor", "Cisco")
    security    = state.get("security", [])
    compliance  = state.get("compliance", [])
    overlay     = state.get("overlayProto", [])
    underlay    = state.get("underlayProto", [])
    has_evpn    = "EVPN" in protocols
    has_vxlan   = "VXLAN" in protocols
    has_bgp     = "BGP" in protocols
    has_ospf    = "OSPF" in protocols
    has_isis    = "IS-IS" in protocols
    dual        = redundancy in ("ha", "full")

    decisions: list[dict] = []
    warnings:  list[str]  = []

    # ── 1. CLOS topology ────────────────────────────────────────────────────
    if uc in ("dc", "hybrid", "gpu"):
        decisions.append({
            "area":         "Topology",
            "choice":       f"{'Spine-leaf' if uc in ('dc','hybrid') else 'Two-tier GPU'} CLOS fabric — {spine_count} spine × {leaf_count} {'leaf' if uc != 'gpu' else 'TOR'}",
            "rationale":    (
                f"CLOS provides equal-cost multipath (ECMP) between every server pair with "
                f"predictable, non-blocking bandwidth. {spine_count} spines give "
                f"{'N-1 redundancy — any single spine failure leaves fabric fully connected' if spine_count >= 2 else 'single spine — add a second for HA'}. "
                f"{leaf_count} {'leaves' if uc != 'gpu' else 'TOR switches'} allow "
                f"{'~' + str(leaf_count * 48) + ' server ports' if uc != 'gpu' else str(leaf_count * 8) + ' GPU ports'} at line rate."
            ),
            "alternatives": [
                "3-tier (core/dist/access) — lower cost but adds latency and STP complexity",
                "Collapsed core — valid for < 500 servers but doesn't scale to east-west GPU traffic",
            ],
        })

    # ── 2. Underlay routing ─────────────────────────────────────────────────
    if uc == "gpu":
        decisions.append({
            "area":         "Underlay",
            "choice":       "eBGP underlay (spine-TOR-host)",
            "rationale":    (
                "eBGP with private ASNs gives per-prefix ECMP across all spine-TOR links. "
                "Each TOR and each H100 server gets a unique ASN, giving the control plane "
                "full visibility into GPU host reachability. ECMP load-balances RDMA flows "
                "across all spine uplinks simultaneously."
            ),
            "alternatives": [
                "OSPF underlay — simpler, but single AS makes ECMP tuning harder for GPU east-west",
                "InfiniBand — higher raw BW but vendor lock-in; RoCEv2 over Ethernet is now equivalent",
            ],
        })
    elif has_isis:
        decisions.append({
            "area":         "Underlay",
            "choice":       "IS-IS Level-2 with wide metrics",
            "rationale":    (
                "IS-IS converges faster than OSPF on large topologies (no DR/BDR election, "
                "no flooding scope limitations). Wide metrics support traffic engineering "
                "and multi-topology routing. Preferred for large DC fabrics with 50+ nodes."
            ),
            "alternatives": [
                "OSPF — simpler, universally understood, sufficient for < 50 nodes",
                "eBGP-only — eliminates IGP but requires careful next-hop management",
            ],
        })
    elif has_ospf:
        decisions.append({
            "area":         "Underlay",
            "choice":       "OSPF area 0 with /31 P2P links",
            "rationale":    (
                "OSPF is the standard choice for small-to-medium DC underlays (< 50 nodes). "
                "/31 P2P links eliminate broadcast domain overhead and halve the address space needed. "
                "BFD supplements OSPF for sub-second failure detection."
            ),
            "alternatives": [
                "IS-IS — preferred for larger fabrics; OSPF is simpler to operate here",
                "Static routing — no convergence, only viable for very small fixed topologies",
            ],
        })

    # ── 3. Overlay ──────────────────────────────────────────────────────────
    if has_evpn and has_vxlan:
        decisions.append({
            "area":         "Overlay",
            "choice":       "EVPN/VXLAN with symmetric IRB",
            "rationale":    (
                "EVPN is the industry-standard control plane for VXLAN overlays. "
                "It distributes MAC/IP and prefix reachability using BGP, enabling: "
                "multi-tenant isolation (one VRF per tenant), type-2 MAC-IP for host mobility, "
                "type-5 IP-prefix for inter-VRF routing via L3VNI, and ARP suppression to eliminate "
                "BUM flooding. Symmetric IRB lets each VTEP route inter-VRF traffic locally "
                "without hairpinning through a gateway."
            ),
            "alternatives": [
                "VXLAN flood-and-learn — no control plane, poor at scale, no multi-tenancy",
                "MPLS/SR — more capable for WAN but overkill for pure DC east-west",
                "GENEVE — emerging standard but limited vendor support today",
            ],
        })

    # ── 4. BGP Route Reflector ──────────────────────────────────────────────
    if has_evpn and uc in ("dc", "hybrid") and dual:
        decisions.append({
            "area":         "BGP Control Plane",
            "choice":       f"Spine-as-RR with 'retain route-target all' ({spine_count} RR cluster)",
            "rationale":    (
                "Placing route reflectors on spines eliminates a dedicated RR VM/appliance. "
                "'retain route-target all' means spines reflect every VNI's EVPN routes "
                "regardless of local VRF import policy — correct because spines have no "
                "tenant VRFs. Dual RR provides redundancy: loss of one spine doesn't disrupt "
                "EVPN control plane. RFC 4456 §9 NH-unchanged ensures VTEP IPs are preserved "
                "through reflection."
            ),
            "alternatives": [
                "Dedicated RR VMs — more flexibility but extra infrastructure to manage",
                "Full iBGP mesh — O(n²) sessions, only viable for < 8 leaves",
            ],
        })

    # ── 5. GPU lossless fabric ──────────────────────────────────────────────
    if uc == "gpu" or gpu_count > 0:
        decisions.append({
            "area":         "Lossless Fabric (RoCEv2)",
            "choice":       "PFC priority 3+4, DCQCN ECN (Kmin=50KB, Kmax=100KB), MTU 9214",
            "rationale":    (
                "NVIDIA H100 GPUs use RoCEv2 (RDMA over Converged Ethernet) for GPU-to-GPU "
                "collective operations (AllReduce, AllGather). Any packet drop causes a full "
                "RDMA retransmit, collapsing training throughput. PFC creates lossless queues "
                "for priorities 3+4. DCQCN ECN marks packets early (Kmin=50KB) to trigger "
                "rate reduction before buffers fill, preventing head-of-line blocking. "
                "MTU 9214 maximises RDMA frame efficiency."
            ),
            "alternatives": [
                "InfiniBand — natively lossless but requires separate fabric and HCAs",
                "Standard Ethernet without PFC — packet drops destroy RDMA performance",
                "iWARP — software RDMA, lower CPU overhead than TCP but higher latency than RoCEv2",
            ],
        })

    # ── 6. Redundancy ───────────────────────────────────────────────────────
    if dual:
        decisions.append({
            "area":         "Redundancy",
            "choice":       f"{'Full HA' if redundancy == 'full' else 'Active/Active HA'} — dual everything",
            "rationale":    (
                "All spine, firewall, and border devices are deployed in pairs. "
                "ECMP distributes traffic across both at all times (active/active) — "
                "failure of one reduces capacity by 50% but does not cause an outage. "
                "BFD provides sub-second failure detection (300ms timers) triggering BGP/OSPF "
                "convergence before most applications notice the disruption."
            ),
            "alternatives": [
                "Active/standby — simpler but wastes 50% of uplink capacity during normal ops",
                "Single device — acceptable for dev/lab, never for production",
            ],
        })

    # ── 7. Vendor choice ────────────────────────────────────────────────────
    _vendor_rationale = {
        "Cisco":    "NX-OS is the most widely deployed DC OS; existing team skills, tooling (DCNM/Nexus Dashboard), and TAC coverage justify the cost premium.",
        "Arista":   "EOS is the preferred platform for GPU AI fabrics (CloudVision integration, eAPI, highest ECMP scale). Strong in hyperscaler and AI infrastructure deployments.",
        "Juniper":  "QFX/JunOS offers YANG-first automation via Apstra and mature EVPN implementation. Preferred in telco/financial sector DC designs.",
        "NVIDIA":   "SONiC on NVIDIA Spectrum ASICs provides the tightest RoCEv2/SHARP integration and lowest latency for GPU collectives.",
        "Open":     "SONiC eliminates vendor lock-in. CONFIG_DB + FRR gives full programmability with commodity switching silicon.",
    }
    vr = _vendor_rationale.get(vendor, f"{vendor} selected based on stated preference.")
    decisions.append({
        "area":         "Vendor / Platform",
        "choice":       vendor,
        "rationale":    vr,
        "alternatives": [v for v in _vendor_rationale if v != vendor][:3],
    })

    # ── 8. Security / Compliance ────────────────────────────────────────────
    if compliance:
        decisions.append({
            "area":         "Compliance",
            "choice":       ", ".join(compliance),
            "rationale":    (
                f"{', '.join(compliance)} requirements drive: "
                + ("MACsec encryption on all inter-switch links. " if "PCI-DSS" in compliance else "")
                + ("FIPS-140-2 validated crypto modules. " if "FedRAMP" in compliance else "")
                + ("Audit logging to syslog with 12-month retention. " if any(c in compliance for c in ("PCI-DSS", "SOC2")) else "")
                + "AAA via TACACS+ with per-command authorisation."
            ),
            "alternatives": ["No compliance framework — acceptable for internal non-regulated traffic"],
        })

    if "802.1x" in security or "nac" in [s.lower() for s in security]:
        decisions.append({
            "area":         "Network Access Control",
            "choice":       "802.1X port authentication with RADIUS / TACACS+",
            "rationale":    (
                "802.1X prevents unauthorised devices connecting to access layer ports. "
                "MAB (MAC auth bypass) provides fallback for printers/IoT. "
                "Dynamic VLAN assignment from RADIUS lets posture-checked devices "
                "land in the correct segment automatically."
            ),
            "alternatives": [
                "MAC address filtering — easy to spoof, not a real security control",
                "VLAN isolation only — no authentication, relies on physical security",
            ],
        })

    # ── Warnings / trade-offs ───────────────────────────────────────────────
    if spine_count < 2:
        warnings.append("Single spine is a SPOF — add a second spine for any production workload.")
    if uc == "gpu" and not gpu_count:
        warnings.append("GPU count not specified — defaulting to 8 per rack. Verify actual rack density.")
    if has_evpn and not compliance:
        warnings.append("No compliance framework selected — consider PCI-DSS if handling card data, or SOC2 for SaaS.")
    if uc in ("dc", "gpu") and leaf_count > 32:
        warnings.append(f"{leaf_count} leaves may require a 3-stage CLOS (adding a 'super-spine' tier) to stay non-blocking.")

    # ── Summary paragraph ───────────────────────────────────────────────────
    uc_names = {"dc": "data centre CLOS fabric", "gpu": "AI/ML GPU cluster fabric",
                "campus": "enterprise campus network", "wan": "WAN edge", "hybrid": "hybrid multi-tier fabric"}
    summary = (
        f"This {uc_names.get(uc, uc)} uses a {spine_count}-spine "
        + (f"{leaf_count}-leaf " if uc != "gpu" else f"{leaf_count}-TOR ")
        + f"CLOS architecture with {', '.join(underlay) or 'IGP'} underlay"
        + (f" and EVPN/VXLAN symmetric IRB overlay" if has_evpn else "")
        + (f", delivering lossless RoCEv2 for {gpu_count} H100 GPUs" if gpu_count else "")
        + f". Deployed on {vendor} hardware with "
        + (f"{'full active/active redundancy' if redundancy == 'full' else 'HA across all tiers'}" if dual else "single-device topology")
        + f". {len(decisions)} architectural decisions documented."
    )

    return {
        "decisions": decisions,
        "summary":   summary,
        "warnings":  warnings,
        "decision_count": len(decisions),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Full Design
# ─────────────────────────────────────────────────────────────────────────────

def generate_full_design(state: dict[str, Any]) -> dict[str, Any]:
    """
    Generate the complete design artefact: IP plan + VLAN plan + BGP design +
    topology graph, all in one call.
    """
    ip_plan   = generate_ip_plan(state)
    vlan_plan = generate_vlan_plan(state)
    bgp       = generate_bgp_design(state)
    topology  = generate_topology(state)
    rationale = generate_design_rationale(state)

    return {
        "use_case":    state.get("uc", ""),
        "org":         state.get("orgName", ""),
        "redundancy":  state.get("redundancy", ""),
        "ip_plan":     ip_plan,
        "vlan_plan":   vlan_plan,
        "bgp_design":  bgp,
        "topology":    topology,
        "rationale":   rationale,
        "summary": (
            f"Design for {state.get('orgName','—')} "
            f"({state.get('uc','').upper()}, {state.get('redundancy','')}) · "
            f"{ip_plan['summary']} · "
            f"{vlan_plan['summary']} · "
            f"{bgp['summary']}"
        ),
    }
