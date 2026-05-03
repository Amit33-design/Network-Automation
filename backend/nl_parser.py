"""
NetDesign AI — Natural Language Intent Parser
===============================================
Converts free-form natural language network design descriptions into
structured state dictionaries consumed by config_gen, design_engine,
and the policy/simulation engines.

Handles:
  • Use-case detection (campus / dc / gpu / wan / hybrid / multisite)
  • Scale estimation (small / medium / large / hyperscale)
  • Protocol inference (underlay + overlay + routing)
  • Security feature extraction (802.1X, MACSEC, IPsec, …)
  • Product recommendation based on use-case + scale + vendor preference
  • VLAN plan generation from stated requirements
  • Redundancy requirements
  • Compliance flag detection (PCI-DSS, HIPAA, SOC2, FedRAMP)

All functions are pure (no I/O) and return typed dicts.
"""
from __future__ import annotations

import re
from typing import Any

# ── Product catalogue (mirrors JS PRODUCTS) — tier recommendations ───────────
_PRODUCTS: dict[str, dict[str, Any]] = {
    # Campus
    "cat9500":    {"layer": "campus-core",   "vendor": "Cisco",   "scale": "large"},
    "cat9400":    {"layer": "campus-core",   "vendor": "Cisco",   "scale": "medium"},
    "cat9300":    {"layer": "campus-dist",   "vendor": "Cisco",   "scale": "medium"},
    "cat9200":    {"layer": "campus-access", "vendor": "Cisco",   "scale": "small"},
    "cat9200l":   {"layer": "campus-access", "vendor": "Cisco",   "scale": "xsmall"},
    "ex4400":     {"layer": "campus-dist",   "vendor": "Juniper", "scale": "medium"},
    "ex2300":     {"layer": "campus-access", "vendor": "Juniper", "scale": "small"},
    "7050cx3":    {"layer": "campus-core",   "vendor": "Arista",  "scale": "large"},
    # DC
    "nexus-9364c": {"layer": "dc-spine",  "vendor": "Cisco",   "scale": "large"},
    "nexus-93180yc": {"layer": "dc-leaf", "vendor": "Cisco",   "scale": "medium"},
    "nexus-9336c":  {"layer": "dc-spine", "vendor": "Cisco",   "scale": "medium"},
    "7800r3":     {"layer": "dc-spine",   "vendor": "Arista",  "scale": "large"},
    "7050cx3-32s": {"layer": "dc-leaf",  "vendor": "Arista",  "scale": "medium"},
    "qfx5120":    {"layer": "dc-leaf",    "vendor": "Juniper", "scale": "medium"},
    "qfx10002":   {"layer": "dc-spine",   "vendor": "Juniper", "scale": "large"},
    # GPU
    "sn4600c":    {"layer": "gpu-tor",    "vendor": "NVIDIA",  "scale": "large"},
    "sn2201":     {"layer": "gpu-tor",    "vendor": "NVIDIA",  "scale": "medium"},
    "7800r3-48cq": {"layer": "gpu-spine", "vendor": "Arista",  "scale": "large"},
    # Firewall
    "ftd-4145":   {"layer": "fw",         "vendor": "Cisco",   "scale": "large"},
    "pa-5450":    {"layer": "fw",         "vendor": "Palo Alto","scale": "large"},
    "fortigate-4200f": {"layer": "fw",    "vendor": "Fortinet","scale": "large"},
    "asa-5555":   {"layer": "fw",         "vendor": "Cisco",   "scale": "medium"},
    # WAN
    "asr1002hx":  {"layer": "wan-hub",    "vendor": "Cisco",   "scale": "large"},
    "isr4461":    {"layer": "wan-hub",    "vendor": "Cisco",   "scale": "medium"},
}

# ── Keyword maps ─────────────────────────────────────────────────────────────

_UC_KEYWORDS: dict[str, list[str]] = {
    "campus":    ["campus", "office", "branch", "building", "floor", "employee",
                  "user", "workstation", "desktop", "voip", "wifi", "wireless",
                  "802.1x", "nac", "access layer"],
    "dc":        ["data center", "datacenter", "dc", "leaf", "spine", "clos",
                  "vxlan", "evpn", "server farm", "hypervisor", "kubernetes",
                  "vmware", "openstack", "docker", "rack", "pod"],
    "gpu":       ["gpu", "h100", "a100", "ai cluster", "ml cluster", "rdma",
                  "roce", "infiniband", "hpc", "high performance", "training",
                  "inference", "nvidia", "cuda", "nvlink"],
    "wan":       ["wan", "mpls", "sd-wan", "sdwan", "internet edge", "isp",
                  "bgp upstream", "transit", "peering", "remote site"],
    "hybrid":    ["hybrid", "campus and dc", "multi-tier", "enterprise"],
    "multisite": ["multisite", "multi-site", "multi site", "geo", "campus and branch",
                  "distributed", "regional"],
}

_REDUNDANCY_KEYWORDS: dict[str, list[str]] = {
    "full":   ["full redundancy", "no single point", "fully redundant", "quad"],
    "ha":     ["ha", "high availability", "dual", "redundant", "failover",
               "active-standby", "active-passive", "vss", "vpc", "mlag"],
    "single": ["single", "no redundancy", "cost", "small office", "lab"],
}

_PROTOCOL_KEYWORDS: dict[str, list[str]] = {
    "OSPF":    ["ospf", "open shortest path"],
    "IS-IS":   ["isis", "is-is", "intermediate system"],
    "BGP":     ["bgp", "border gateway"],
    "EIGRP":   ["eigrp", "enhanced interior"],
    "VXLAN":   ["vxlan", "virtual extensible"],
    "EVPN":    ["evpn", "ethernet vpn"],
    "MPLS":    ["mpls", "label switching"],
    "Segment Routing": ["segment routing", "srv6", "sr-mpls"],
    "802.1X":  ["802.1x", "dot1x", "nac", "radius"],
    "MACsec":  ["macsec", "mac security", "802.1ae"],
    "IPsec":   ["ipsec", "ip security", "vpn tunnel"],
    "DMVPN":   ["dmvpn", "dynamic multipoint"],
    "PFC":     ["pfc", "priority flow control"],
    "RoCEv2":  ["roce", "rocev2", "rdma over converged"],
    "ECN":     ["ecn", "explicit congestion"],
    "DCQCN":   ["dcqcn", "quantized congestion"],
}

_SECURITY_KEYWORDS: dict[str, list[str]] = {
    "802.1x":        ["802.1x", "dot1x", "eap", "ibns", "ise"],
    "dhcp-snooping": ["dhcp snoop", "dhcp snooping"],
    "dai":           ["dai", "dynamic arp inspection"],
    "port-security": ["port security", "mac limit"],
    "macsec":        ["macsec", "802.1ae"],
    "ipsec":         ["ipsec", "site-to-site vpn"],
    "acl":           ["acl", "access control", "firewall rule"],
    "copp":          ["copp", "control plane policing"],
    "urpf":          ["urpf", "unicast rpf", "reverse path"],
    "ra-guard":      ["ra guard", "ipv6 ra guard"],
    "storm-control": ["storm control", "broadcast suppression"],
    "bpdu-guard":    ["bpdu guard"],
    "root-guard":    ["root guard"],
}

_COMPLIANCE_KEYWORDS: dict[str, list[str]] = {
    "PCI-DSS":  ["pci", "pci-dss", "payment card", "cardholder"],
    "HIPAA":    ["hipaa", "health", "phi", "protected health"],
    "SOC2":     ["soc2", "soc 2", "service organization"],
    "FedRAMP":  ["fedramp", "fed ramp", "federal risk"],
    "ISO27001": ["iso 27001", "iso27001"],
    "NIST":     ["nist", "nist 800"],
}

_VENDOR_KEYWORDS: dict[str, list[str]] = {
    "Cisco":    ["cisco", "cat9", "nexus", "asr", "isr", "ftd"],
    "Arista":   ["arista", "eos", "7050", "7800"],
    "Juniper":  ["juniper", "junos", "qfx", "ex series"],
    "Palo Alto":["palo alto", "pan-os", "panorama"],
    "Fortinet": ["fortinet", "fortigate", "forti"],
    "NVIDIA":   ["nvidia", "mellanox", "spectrum", "connectx"],
}

_SCALE_KEYWORDS: dict[str, list[str]] = {
    "xsmall":    ["small office", "soho", "< 50", "50 users", "lab"],
    "small":     ["small", "< 200", "100 user", "200 user", "branch"],
    "medium":    ["medium", "500", "1000 user", "mid-size", "regional"],
    "large":     ["large", "enterprise", "5000", "campus"],
    "hyperscale":["hyperscale", "cloud", "massive", "100k", "10000 server",
                  "hyperscaler", "scale-out"],
}


# ── Public API ────────────────────────────────────────────────────────────────

def parse_intent(description: str) -> dict[str, Any]:
    """
    Parse a natural language network design description into a structured
    state dictionary suitable for passing to design_engine / config_gen.

    Returns a dict with fields:
        uc, orgName, orgSize, redundancy, protocols, security, compliance,
        selectedProducts, vlans, gpuSpecifics, spineLoopbacks, …
    """
    text = description.lower()

    uc         = _detect_uc(text)
    redundancy = _detect_redundancy(text)
    scale      = _detect_scale(text, uc)
    vendor     = _detect_vendor(text, uc)
    protocols  = _detect_protocols(text, uc)
    security   = _detect_security(text)
    compliance = _detect_compliance(text)
    products   = _recommend_products(uc, scale, vendor)
    vlans      = _generate_vlans(uc, text)
    topo       = _extract_topology_counts(text)

    # Derive org name from description if identifiable
    org_name = _extract_org(description) or "NetDesign-Corp"

    # ── Topology counts: explicit from description, or sensible defaults ───────
    if uc == "dc":
        spine_count = topo.get("spine_count", 2)
        leaf_count  = topo.get("leaf_count", 4)
    elif uc == "gpu":
        spine_count = topo.get("spine_count", 2)
        leaf_count  = topo.get("tor_count", topo.get("leaf_count", 8))
    elif uc == "campus":
        spine_count = topo.get("core_count", 2)
        leaf_count  = topo.get("distribution_count", topo.get("floor_count", 3))
    else:
        spine_count = topo.get("spine_count", 2)
        leaf_count  = topo.get("leaf_count", 4)

    # Build loopbacks list for spines (used by design_engine)
    spine_loopbacks = [f"10.0.1.{i+1}" for i in range(spine_count)]

    # GPU-specific extras
    gpu_specifics: list[str] = []
    if uc == "gpu":
        if any(k in text for k in ["roce", "rocev2"]): gpu_specifics.append("RoCEv2")
        if any(k in text for k in ["pfc", "priority flow"]): gpu_specifics.append("PFC")
        if any(k in text for k in ["ecn"]): gpu_specifics.append("ECN")
        if any(k in text for k in ["dcqcn"]): gpu_specifics.append("DCQCN")
        if not gpu_specifics:  # GPU always defaults to full lossless
            gpu_specifics = ["RoCEv2", "PFC", "ECN", "DCQCN"]

    # Overlay / underlay split
    underlay_protos = [p for p in protocols if p in ("OSPF", "IS-IS", "BGP", "EIGRP")]
    overlay_protos  = [p for p in protocols if p in ("VXLAN", "EVPN", "MPLS",
                                                       "Segment Routing", "DMVPN")]

    return {
        "uc":               uc,
        "orgName":          org_name,
        "orgSize":          scale,
        "redundancy":       redundancy,
        "protocols":        protocols,
        "underlayProto":    underlay_protos,
        "overlayProto":     overlay_protos,
        "security":         security,
        "compliance":       compliance,
        "selectedProducts": products,
        "vlans":            vlans,
        "gpuSpecifics":     gpu_specifics,
        # ── Explicit topology counts from NL description ──────────────────────
        "spine_count":      spine_count,
        "leaf_count":       leaf_count,
        "gpu_count":        topo.get("gpu_count", 0),
        "rack_count":       topo.get("rack_count", leaf_count if uc == "gpu" else 0),
        "floor_count":      topo.get("floor_count", 0),
        "user_count":       topo.get("user_count", 0),
        "bgp_asn":          topo.get("bgp_asn", 65000),
        "spineLoopbacks":   spine_loopbacks,
        # Policy flags — all enabled by default
        "include_security_hardening": True,
        "include_control_plane":      True,
        "include_aaa":                True,
        "include_vlan_policy":        True,
        "include_trunk_policy":       True,
        "include_dot1x":              "802.1x" in security,
        "include_bgp_policy":         "BGP" in protocols,
        "include_evpn_policy":        "EVPN" in protocols or "VXLAN" in protocols,
        "include_acl":                True,
        "include_qos":                True,
        "include_static_routing":     True,
        "include_wireless":           uc == "campus" and _has_wireless(text),
        "include_firewall_policy":    "fw" in products,
        "_raw_description":           description,
        "_detected_vendor":           vendor,
        "_detected_scale":            scale,
        "_topology_extracted":        topo,
    }


def describe_intent(state: dict[str, Any]) -> str:
    """Convert a state dict back into a human-readable design brief."""
    lines = [
        f"Network Design Brief",
        f"{'─' * 40}",
        f"Organisation : {state.get('orgName', '—')}",
        f"Use case     : {state.get('uc', '—').upper()}",
        f"Scale        : {state.get('orgSize', '—')}",
        f"Redundancy   : {state.get('redundancy', '—')}",
        f"Underlay     : {', '.join(state.get('underlayProto', [])) or '—'}",
        f"Overlay      : {', '.join(state.get('overlayProto', [])) or 'None'}",
        f"Security     : {', '.join(state.get('security', [])) or '—'}",
        f"Compliance   : {', '.join(state.get('compliance', [])) or 'None'}",
        f"",
        f"Products selected:",
    ]
    for layer, pid in state.get("selectedProducts", {}).items():
        lines.append(f"  {layer:<20} {pid}")
    lines.append("")
    lines.append("VLANs:")
    for v in state.get("vlans", []):
        lines.append(f"  VLAN {v['id']:>4}  {v['name']}")
    return "\n".join(lines)


# ── Private helpers ───────────────────────────────────────────────────────────

def _score_keywords(text: str, kw_map: dict[str, list[str]]) -> dict[str, int]:
    scores: dict[str, int] = {}
    for key, keywords in kw_map.items():
        scores[key] = sum(1 for kw in keywords if kw in text)
    return scores


def _best(scores: dict[str, int], default: str) -> str:
    return max(scores, key=scores.get) if max(scores.values(), default=0) > 0 else default  # type: ignore[arg-type]


def _detect_uc(text: str) -> str:
    scores = _score_keywords(text, _UC_KEYWORDS)
    return _best(scores, "campus")


def _detect_redundancy(text: str) -> str:
    scores = _score_keywords(text, _REDUNDANCY_KEYWORDS)
    return _best(scores, "ha")


def _detect_scale(text: str, uc: str) -> str:
    scores = _score_keywords(text, _SCALE_KEYWORDS)
    # Extract numbers to help size estimate
    nums = [int(n) for n in re.findall(r'\b(\d{2,6})\b', text)]
    if nums:
        mx = max(nums)
        if mx >= 10_000:
            return "hyperscale"
        elif mx >= 2_000:
            return "large"
        elif mx >= 500:
            return "medium"
        elif mx >= 100:
            return "small"
    best = _best(scores, "")
    if best:
        return best
    # Default by use case
    return {"gpu": "large", "dc": "medium", "campus": "medium", "wan": "small"}.get(uc, "medium")


def _detect_vendor(text: str, uc: str) -> str:
    scores = _score_keywords(text, _VENDOR_KEYWORDS)
    best = _best(scores, "")
    if best:
        return best
    # Default vendor per use case
    return {"gpu": "NVIDIA", "dc": "Cisco", "campus": "Cisco",
            "wan": "Cisco", "hybrid": "Cisco"}.get(uc, "Cisco")


def _detect_protocols(text: str, uc: str) -> list[str]:
    found = [p for p, keywords in _PROTOCOL_KEYWORDS.items()
             if any(kw in text for kw in keywords)]
    # Apply smart defaults when nothing detected
    if not found:
        defaults = {
            "campus": ["OSPF"],
            "dc":     ["OSPF", "BGP", "EVPN", "VXLAN"],
            "gpu":    ["BGP", "RoCEv2", "PFC", "ECN"],
            "wan":    ["BGP", "OSPF", "MPLS"],
            "hybrid": ["OSPF", "BGP"],
        }
        found = defaults.get(uc, ["OSPF"])
    # DC always needs BGP for EVPN
    if uc == "dc" and "EVPN" in found and "BGP" not in found:
        found.append("BGP")
    return found


def _detect_security(text: str) -> list[str]:
    return [s for s, kws in _SECURITY_KEYWORDS.items()
            if any(kw in text for kw in kws)]


def _detect_compliance(text: str) -> list[str]:
    return [c for c, kws in _COMPLIANCE_KEYWORDS.items()
            if any(kw in text for kw in kws)]


def _has_wireless(text: str) -> bool:
    return any(kw in text for kw in ["wifi", "wireless", "wlan", "802.11", "ap ",
                                      "access point", "capwap", "ssid", "wlc"])


def _recommend_products(uc: str, scale: str, vendor: str) -> dict[str, str]:
    """Return a layer → product_id map for the given use-case/scale/vendor."""
    # Preference table: (uc, scale, vendor) → product map
    table: dict[tuple[str, str, str], dict[str, str]] = {
        # Campus — Cisco
        ("campus", "large",     "Cisco"):    {"campus-core": "cat9500",  "campus-dist": "cat9300",  "campus-access": "cat9200",  "fw": "ftd-4145"},
        ("campus", "medium",    "Cisco"):    {"campus-core": "cat9400",  "campus-dist": "cat9300",  "campus-access": "cat9200"},
        ("campus", "small",     "Cisco"):    {"campus-core": "cat9300",  "campus-dist": "cat9200",  "campus-access": "cat9200l"},
        ("campus", "xsmall",    "Cisco"):    {"campus-core": "cat9200",  "campus-access": "cat9200l"},
        # Campus — Arista
        ("campus", "large",     "Arista"):   {"campus-core": "7050cx3",  "campus-dist": "cat9300",  "campus-access": "cat9200"},
        # Campus — Juniper
        ("campus", "medium",    "Juniper"):  {"campus-dist": "ex4400",   "campus-access": "ex2300"},
        # DC — Cisco
        ("dc",     "large",     "Cisco"):    {"dc-spine": "nexus-9364c", "dc-leaf": "nexus-93180yc", "fw": "ftd-4145"},
        ("dc",     "medium",    "Cisco"):    {"dc-spine": "nexus-9336c", "dc-leaf": "nexus-93180yc", "fw": "ftd-4145"},
        # DC — Arista
        ("dc",     "large",     "Arista"):   {"dc-spine": "7800r3",      "dc-leaf": "7050cx3-32s",  "fw": "pa-5450"},
        ("dc",     "medium",    "Arista"):   {"dc-spine": "7050cx3",     "dc-leaf": "7050cx3-32s"},
        # DC — Juniper
        ("dc",     "large",     "Juniper"):  {"dc-spine": "qfx10002",    "dc-leaf": "qfx5120",      "fw": "pa-5450"},
        ("dc",     "medium",    "Juniper"):  {"dc-spine": "qfx10002",    "dc-leaf": "qfx5120"},
        # GPU
        ("gpu",    "large",     "NVIDIA"):   {"gpu-tor": "sn4600c",      "gpu-spine": "7800r3-48cq"},
        ("gpu",    "medium",    "NVIDIA"):   {"gpu-tor": "sn2201",       "gpu-spine": "7800r3-48cq"},
        ("gpu",    "large",     "Arista"):   {"gpu-tor": "sn4600c",      "gpu-spine": "7800r3-48cq"},
        # WAN
        ("wan",    "large",     "Cisco"):    {"wan-hub": "asr1002hx",    "fw": "ftd-4145"},
        ("wan",    "medium",    "Cisco"):    {"wan-hub": "isr4461",      "fw": "ftd-4145"},
    }

    # Exact match → scale fallback → vendor fallback → sensible default
    key = (uc, scale, vendor)
    if key in table:
        return table[key]
    # Try dropping vendor
    for s in (scale, "medium", "large"):
        for v in (vendor, "Cisco"):
            k = (uc, s, v)
            if k in table:
                return table[k]
    # Absolute fallback
    fallback = {
        "campus": {"campus-core": "cat9400", "campus-dist": "cat9300", "campus-access": "cat9200"},
        "dc":     {"dc-spine": "nexus-9364c", "dc-leaf": "nexus-93180yc"},
        "gpu":    {"gpu-tor": "sn4600c", "gpu-spine": "7800r3-48cq"},
        "wan":    {"wan-hub": "asr1002hx"},
    }
    return fallback.get(uc, {})


def _generate_vlans(uc: str, text: str) -> list[dict[str, Any]]:
    """Generate a sensible VLAN plan based on use-case and description keywords."""
    if uc == "campus":
        vlans = [
            {"id": 10,  "name": "DATA",        "purpose": "Workstation / PC"},
            {"id": 20,  "name": "VOICE",       "purpose": "IP Phones"},
            {"id": 30,  "name": "WIFI-CORP",   "purpose": "Corporate Wi-Fi"},
            {"id": 40,  "name": "WIFI-GUEST",  "purpose": "Guest / IoT Wi-Fi"},
            {"id": 50,  "name": "SERVERS",     "purpose": "Campus servers"},
            {"id": 60,  "name": "IoT",         "purpose": "IoT / BMS devices"},
            {"id": 100, "name": "MGMT",        "purpose": "Out-of-band management"},
        ]
        # Prune VLANs not relevant to description
        if "voice" not in text and "voip" not in text and "phone" not in text:
            vlans = [v for v in vlans if v["id"] != 20]
        if not _has_wireless(text):
            vlans = [v for v in vlans if v["id"] not in (30, 40)]
        if "iot" not in text and "bms" not in text:
            vlans = [v for v in vlans if v["id"] != 60]
        return vlans

    elif uc == "dc":
        return [
            {"id": 10, "name": "PROD-SERVERS",  "purpose": "Production workloads"},
            {"id": 11, "name": "PROD-APPS",     "purpose": "Application tier"},
            {"id": 20, "name": "DEV-SERVERS",   "purpose": "Dev / QA workloads"},
            {"id": 21, "name": "DEV-APPS",      "purpose": "Dev application tier"},
            {"id": 30, "name": "STORAGE",       "purpose": "Storage fabric (NVMe-oF)"},
            {"id": 100, "name": "MGMT",         "purpose": "OOB management"},
        ]

    elif uc == "gpu":
        return [
            {"id": 10,  "name": "GPU-COMPUTE",  "purpose": "H100 / A100 compute fabric"},
            {"id": 20,  "name": "GPU-STORAGE",  "purpose": "NVMe / parallel storage"},
            {"id": 100, "name": "MGMT",         "purpose": "OOB management"},
        ]

    elif uc == "wan":
        return [
            {"id": 10, "name": "TRANSIT",   "purpose": "WAN transit links"},
            {"id": 20, "name": "LOOPBACK",  "purpose": "Loopback / router-id"},
            {"id": 100,"name": "MGMT",      "purpose": "Management"},
        ]

    return [{"id": 10, "name": "DATA", "purpose": "Default"}, {"id": 100, "name": "MGMT", "purpose": "Management"}]


def _extract_org(description: str) -> str | None:
    """Try to extract an organisation name from the description."""
    patterns = [
        r"for\s+([A-Z][a-zA-Z0-9\s]{2,30}?)(?:\s+(?:with|using|that|network|company|corp|inc\.))",
        r"(?:company|organisation|org|client)\s*(?:called|named|is)\s+([A-Z][a-zA-Z0-9\s]{2,20})",
    ]
    for pat in patterns:
        m = re.search(pat, description)
        if m:
            return m.group(1).strip()
    return None


def _extract_topology_counts(text: str) -> dict[str, int]:
    """
    Extract explicit device counts from natural language.

    Handles patterns like:
      "2-spine 8-leaf"   → spine_count=2, leaf_count=8
      "4 spines"         → spine_count=4
      "16 leaves"        → leaf_count=16
      "8 TOR switches"   → tor_count=8
      "32 access switches" → access_count=32
      "64 H100 GPUs"     → gpu_count=64
    """
    counts: dict[str, int] = {}
    t = text.lower()

    # ── Pattern 1: "N-spine M-leaf" or "N spine M leaf" ──────────────────────
    m = re.search(r'(\d+)\s*[-–]?\s*spine', t)
    if m:
        counts["spine_count"] = int(m.group(1))

    m = re.search(r'(\d+)\s*[-–]?\s*leaf', t)
    if m:
        counts["leaf_count"] = int(m.group(1))

    # ── Pattern 2: "N TOR switches" or "N TOR" ───────────────────────────────
    m = re.search(r'(\d+)\s*[-–]?\s*(?:tor|top.of.rack)', t)
    if m:
        counts["tor_count"] = int(m.group(1))
        # TOR count implies leaf count for DC context
        if "leaf_count" not in counts:
            counts["leaf_count"] = int(m.group(1))

    # ── Pattern 3: "N access switches" ───────────────────────────────────────
    m = re.search(r'(\d+)\s*access\s*switch', t)
    if m:
        counts["access_count"] = int(m.group(1))

    # ── Pattern 4: "N distribution switches" ─────────────────────────────────
    m = re.search(r'(\d+)\s*(?:distribution|dist)\s*switch', t)
    if m:
        counts["distribution_count"] = int(m.group(1))

    # ── Pattern 5: "N core switches" ─────────────────────────────────────────
    m = re.search(r'(\d+)\s*core\s*switch', t)
    if m:
        counts["core_count"] = int(m.group(1))

    # ── Pattern 6: "N H100/A100/H200 GPUs" ───────────────────────────────────
    m = re.search(r'(\d+)\s*(?:x\s*)?(?:nvidia\s*)?(?:h100|a100|h200|gpu)', t)
    if m:
        counts["gpu_count"] = int(m.group(1))

    # ── Pattern 7: "N racks" or "N rack" ─────────────────────────────────────
    m = re.search(r'(\d+)\s*rack', t)
    if m:
        counts["rack_count"] = int(m.group(1))

    # ── Pattern 8: "N floors" ─────────────────────────────────────────────────
    m = re.search(r'(\d+)\s*floor', t)
    if m:
        counts["floor_count"] = int(m.group(1))

    # ── Pattern 9: "N users" or "N person/people" ────────────────────────────
    m = re.search(r'(\d+)\s*(?:users?|person|people|employees?|seats?)', t)
    if m:
        counts["user_count"] = int(m.group(1))

    # ── Pattern 10: "BGP ASN NNNNN" ──────────────────────────────────────────
    m = re.search(r'(?:asn|as\s+number|bgp\s+as)\s*[:\s]?\s*(\d{4,10})', t)
    if m:
        counts["bgp_asn"] = int(m.group(1))

    return counts
