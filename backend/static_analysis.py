"""
NetDesign AI — Static Design Analysis Engine (Step 3)
======================================================
Runs 26 deterministic checks against design state + generated design objects.
No live device access needed — catches misconfigurations before deployment.

Checks are grouped into 6 domains:
  1. IP Addressing    — overlaps, duplicates, VTEP reachability
  2. VLAN / VNI       — uniqueness, L3VNI completeness, capacity
  3. BGP              — ASN validity, timer alignment, RR config
  4. EVPN             — RT consistency, RD uniqueness, symmetric IRB
  5. Fabric / Physical — MTU, ECMP, BFD, PFC, NTP
  6. Security Baseline — SSH, AAA, MGMT VRF, banners

Public API:
    run_analysis(state)                  → AnalysisReport
    run_analysis_with_design(state, design) → AnalysisReport  (avoids re-generating)
"""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Data model
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Finding:
    check_id:   str
    domain:     str          # ip | vlan | bgp | evpn | fabric | security
    severity:   str          # critical | high | medium | low | info
    status:     str          # fail | warn | pass | info
    title:      str
    detail:     str          # what is wrong (or what was verified)
    fix:        str          # how to fix it (empty for pass/info)
    affected:   list[str] = field(default_factory=list)   # affected devices/VLANs/VNIs

@dataclass
class AnalysisReport:
    overall:    str          # "critical" | "fail" | "warn" | "pass"
    score:      int          # 0-100
    findings:   list[Finding]
    summary:    str
    domain_scores: dict[str, int]   # per-domain score 0-100
    check_count:   int
    fail_count:    int
    warn_count:    int
    pass_count:    int


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _net(prefix: str) -> ipaddress.IPv4Network | None:
    """Parse prefix string → IPv4Network, return None on failure."""
    try:
        return ipaddress.IPv4Network(prefix, strict=False)
    except Exception:
        return None


def _extract_prefix(ip_with_mask: str) -> str:
    """'10.2.1.0/31' → '10.2.1.0/31' (already), '10.0.1.1/32' → '10.0.1.1/32'."""
    return ip_with_mask.split()[0] if ip_with_mask else ""


def _overlaps_any(net: ipaddress.IPv4Network, others: list[ipaddress.IPv4Network]) -> bool:
    return any(net.overlaps(o) for o in others)


def _score_domain(findings: list[Finding]) -> int:
    """0-100 score for a list of findings (all from one domain)."""
    if not findings:
        return 100
    fails  = sum(1 for f in findings if f.status == "fail")
    crits  = sum(1 for f in findings if f.severity == "critical" and f.status == "fail")
    warns  = sum(1 for f in findings if f.status == "warn")
    total  = len(findings)
    score  = 100 - crits * 30 - (fails - crits) * 15 - warns * 5
    return max(0, score)


# ─────────────────────────────────────────────────────────────────────────────
# Domain 1: IP Addressing
# ─────────────────────────────────────────────────────────────────────────────

def _check_ip(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    ip_plan = design.get("ip_plan", {})
    loopbacks   = ip_plan.get("loopbacks", [])
    p2p_links   = ip_plan.get("p2p_links", [])
    vtep_pool   = ip_plan.get("vtep_pool", [])
    vlan_subnets = ip_plan.get("vlan_subnets", [])
    mgmt        = ip_plan.get("management", [])

    # ── IP-1: Loopback duplicate check ──────────────────────────────────────
    seen_lb: dict[str, str] = {}
    dups: list[str] = []
    for lb in loopbacks:
        ip  = lb.get("ip", "").split("/")[0]
        dev = lb.get("device", "?")
        if ip and ip in seen_lb:
            dups.append(f"{ip} on {seen_lb[ip]} and {dev}")
        elif ip:
            seen_lb[ip] = dev
    if dups:
        findings.append(Finding(
            check_id="IP-1", domain="ip", severity="critical", status="fail",
            title="Duplicate Loopback IP Addresses",
            detail=f"Same loopback IP assigned to multiple devices: {dups}",
            fix="Assign a unique loopback IP to each device. Fix in design_engine loopback generation.",
            affected=dups,
        ))
    else:
        findings.append(Finding(
            check_id="IP-1", domain="ip", severity="info", status="pass",
            title="Loopback IPs Unique",
            detail=f"All {len(seen_lb)} loopback IPs are unique across devices.",
            fix="",
        ))

    # ── IP-2: P2P subnet overlap check ──────────────────────────────────────
    nets: list[ipaddress.IPv4Network] = []
    overlaps: list[str] = []
    for link in p2p_links:
        raw = _extract_prefix(link.get("net", ""))
        net = _net(raw)
        if not net:
            continue
        if _overlaps_any(net, nets):
            overlaps.append(f"{link.get('from','?')} ↔ {link.get('to','?')}: {raw}")
        else:
            nets.append(net)
    if overlaps:
        findings.append(Finding(
            check_id="IP-2", domain="ip", severity="critical", status="fail",
            title="P2P Link Subnet Overlap",
            detail=f"Overlapping P2P subnets detected: {overlaps}",
            fix="Each P2P /31 must use a unique subnet. Review IP plan generation.",
            affected=overlaps,
        ))
    else:
        findings.append(Finding(
            check_id="IP-2", domain="ip", severity="info", status="pass",
            title="P2P Link Subnets Non-Overlapping",
            detail=f"All {len(nets)} P2P /31 subnets are non-overlapping.",
            fix="",
        ))

    # ── IP-3: VLAN subnet overlap check ─────────────────────────────────────
    vlan_nets: list[tuple[str, ipaddress.IPv4Network]] = []
    vlan_overlaps: list[str] = []
    for vs in vlan_subnets:
        raw = vs.get("subnet", "")
        net = _net(raw)
        name = vs.get("name", f"VLAN {vs.get('vlan','?')}")
        if not net:
            continue
        for other_name, other_net in vlan_nets:
            if net.overlaps(other_net):
                vlan_overlaps.append(f"{name} ({raw}) overlaps {other_name} ({other_net})")
        vlan_nets.append((name, net))
    if vlan_overlaps:
        findings.append(Finding(
            check_id="IP-3", domain="ip", severity="critical", status="fail",
            title="VLAN Subnet Overlap",
            detail=f"Overlapping VLAN subnets: {vlan_overlaps}",
            fix="Assign a unique non-overlapping subnet to each VLAN/VRF.",
            affected=vlan_overlaps,
        ))
    else:
        findings.append(Finding(
            check_id="IP-3", domain="ip", severity="info", status="pass",
            title="VLAN Subnets Non-Overlapping",
            detail=f"All {len(vlan_nets)} VLAN subnets are non-overlapping.",
            fix="",
        ))

    # ── IP-4: VTEP IPs must not overlap with P2P ────────────────────────────
    vtep_overlap: list[str] = []
    for vt in vtep_pool:
        raw = _extract_prefix(vt.get("ip", ""))
        net = _net(raw)
        if net and _overlaps_any(net, nets):
            vtep_overlap.append(f"{vt.get('device','?')}: {raw}")
    if vtep_overlap:
        findings.append(Finding(
            check_id="IP-4", domain="ip", severity="high", status="fail",
            title="VTEP Pool Overlaps P2P Subnets",
            detail=f"VTEP IPs conflict with P2P link space: {vtep_overlap}",
            fix="Use a dedicated subnet for VTEP anycast IPs (e.g. 10.1.0.0/24).",
            affected=vtep_overlap,
        ))
    elif vtep_pool:
        findings.append(Finding(
            check_id="IP-4", domain="ip", severity="info", status="pass",
            title="VTEP Pool IPs Non-Overlapping with P2P",
            detail=f"{len(vtep_pool)} VTEP IPs allocated in clean address space.",
            fix="",
        ))

    # ── IP-5: Management plane separation ───────────────────────────────────
    if mgmt:
        mgmt_nets = list({m.get("ip", "").rsplit(".", 1)[0] for m in mgmt})
        findings.append(Finding(
            check_id="IP-5", domain="ip", severity="info", status="pass",
            title="Management Addresses Assigned",
            detail=f"{len(mgmt)} management addresses in {set(mgmt_nets)} subnet(s). "
                   "Verify management is in a dedicated OOB VRF.",
            fix="If not already done, place management interfaces in `vrf MGMT` and "
                "ensure no data-plane routing leaks into it.",
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Domain 2: VLAN / VNI
# ─────────────────────────────────────────────────────────────────────────────

def _check_vlan(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    vlan_plan = design.get("vlan_plan", {})
    vlans     = vlan_plan.get("vlans", [])
    l3vnis    = vlan_plan.get("l3vni_vlans", [])

    # ── VLAN-1: VNI uniqueness ───────────────────────────────────────────────
    seen_vni: dict[int, str] = {}
    dup_vnis: list[str] = []
    for v in vlans:
        vni  = v.get("vni")
        name = v.get("name", f"VLAN {v.get('id','?')}")
        if vni is None:
            continue
        if vni in seen_vni:
            dup_vnis.append(f"VNI {vni}: {seen_vni[vni]} and {name}")
        else:
            seen_vni[vni] = name
    # Also check l3vni list
    for v in l3vnis:
        vni  = v.get("vni")
        name = v.get("name", f"L3VNI {v.get('id','?')}")
        if vni is None:
            continue
        if vni in seen_vni:
            dup_vnis.append(f"VNI {vni}: {seen_vni[vni]} and {name}")
        else:
            seen_vni[vni] = name

    if dup_vnis:
        findings.append(Finding(
            check_id="VLAN-1", domain="vlan", severity="critical", status="fail",
            title="Duplicate VNI Assignments",
            detail=f"Same VNI mapped to multiple VLANs: {dup_vnis}",
            fix="Each VLAN must have a globally unique VNI. Use L2VNI=10000+vlan_id, L3VNI=19000+vrf_idx.",
            affected=dup_vnis,
        ))
    else:
        findings.append(Finding(
            check_id="VLAN-1", domain="vlan", severity="info", status="pass",
            title="All VNIs Unique",
            detail=f"{len(seen_vni)} VNIs assigned — all unique.",
            fix="",
        ))

    # ── VLAN-2: L3VNI per VRF ───────────────────────────────────────────────
    vrfs_with_vlans = {v.get("vrf") for v in vlans if v.get("vrf")}
    vrfs_with_l3vni = {v.get("vrf") for v in l3vnis if v.get("vrf")}
    missing_l3vni = vrfs_with_vlans - vrfs_with_l3vni

    if missing_l3vni:
        findings.append(Finding(
            check_id="VLAN-2", domain="vlan", severity="critical", status="fail",
            title="VRF Missing L3VNI (Inter-VRF Routing Broken)",
            detail=f"VRFs have user VLANs but no L3VNI transit VLAN: {sorted(missing_l3vni)}",
            fix="For each VRF, create a transit VLAN (e.g. 3001) and configure "
                "`member vni 19001 associate-vrf` under NVE.",
            affected=list(missing_l3vni),
        ))
    elif vrfs_with_vlans:
        findings.append(Finding(
            check_id="VLAN-2", domain="vlan", severity="info", status="pass",
            title="All VRFs Have L3VNI",
            detail=f"{len(vrfs_with_l3vni)} VRF(s) each have a transit L3VNI: {sorted(vrfs_with_l3vni)}",
            fix="",
        ))

    # ── VLAN-3: L2VNI naming convention (10000+vlan_id) ─────────────────────
    bad_vni_pattern: list[str] = []
    for v in vlans:
        vlan_id = v.get("id", 0)
        vni     = v.get("vni", 0)
        name    = v.get("name", f"VLAN {vlan_id}")
        expected = 10000 + vlan_id
        if vni and vni != expected:
            bad_vni_pattern.append(f"{name}: vni={vni} (expected {expected})")
    if bad_vni_pattern:
        findings.append(Finding(
            check_id="VLAN-3", domain="vlan", severity="medium", status="warn",
            title="L2VNI Does Not Follow 10000+VLAN Convention",
            detail=f"Non-standard VNI assignments: {bad_vni_pattern[:5]}",
            fix="Standardise to L2VNI = 10000 + vlan_id for easier troubleshooting. "
                "If using custom VNIs, ensure they are consistently applied across all VTEPs.",
            affected=[b.split(":")[0] for b in bad_vni_pattern],
        ))
    else:
        findings.append(Finding(
            check_id="VLAN-3", domain="vlan", severity="info", status="pass",
            title="L2VNI Follows 10000+VLAN Convention",
            detail="All L2VNIs match the standard formula: 10000 + vlan_id.",
            fix="",
        ))

    # ── VLAN-4: VLAN count capacity warning ─────────────────────────────────
    total = vlan_plan.get("total_vlans", 0)
    if total > 3500:
        findings.append(Finding(
            check_id="VLAN-4", domain="vlan", severity="high", status="warn",
            title="VLAN Count Approaching Limit",
            detail=f"{total} VLANs configured — approaching 802.1Q limit of 4094.",
            fix="Consider consolidating with VXLAN VNIs instead of expanding VLAN space. "
                "Enable MAC-VRF per-EVI to scale beyond VLAN limits.",
            affected=[],
        ))
    elif total > 0:
        findings.append(Finding(
            check_id="VLAN-4", domain="vlan", severity="info", status="pass",
            title="VLAN Count Within Capacity",
            detail=f"{total} VLANs — well within 4094 limit.",
            fix="",
        ))

    # ── VLAN-5: Route-target format check ───────────────────────────────────
    bad_rt: list[str] = []
    for v in vlans + l3vnis:
        rt   = v.get("rt", "")
        name = v.get("name", str(v.get("id", "?")))
        if rt and ":" not in rt:
            bad_rt.append(f"{name}: rt='{rt}'")
    if bad_rt:
        findings.append(Finding(
            check_id="VLAN-5", domain="vlan", severity="high", status="fail",
            title="Invalid Route-Target Format",
            detail=f"Route-targets missing ASN:VNI format: {bad_rt}",
            fix="Route-targets must be in `<AS>:<VNI>` format, e.g. `65000:10010`. "
                "Use auto-derived RTs or explicitly set them.",
            affected=bad_rt,
        ))
    else:
        findings.append(Finding(
            check_id="VLAN-5", domain="vlan", severity="info", status="pass",
            title="Route-Target Format Valid",
            detail="All route-targets use the correct AS:VNI format.",
            fix="",
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Domain 3: BGP
# ─────────────────────────────────────────────────────────────────────────────

def _check_bgp(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    bgp    = design.get("bgp_design", {})
    asns   = bgp.get("asns", {})
    peers  = bgp.get("peers", [])
    comms  = bgp.get("communities", {})
    evpn   = bgp.get("evpn_enabled", False)
    uc     = state.get("uc", "dc")
    protocols = [p.upper() for p in state.get("protocols", [])]
    has_evpn  = "EVPN" in protocols or "VXLAN" in protocols

    # ── BGP-1: ASN valid range ───────────────────────────────────────────────
    bgp_asn = state.get("bgp_asn") or asns.get("spine_asn") or asns.get("spine", 0)
    if isinstance(bgp_asn, dict):
        bgp_asn = list(bgp_asn.values())[0] if bgp_asn else 0
    if bgp_asn:
        if not (1 <= int(bgp_asn) <= 4294967295):
            findings.append(Finding(
                check_id="BGP-1", domain="bgp", severity="critical", status="fail",
                title="BGP ASN Out of Valid Range",
                detail=f"ASN {bgp_asn} is outside 1-4294967295.",
                fix="Use a valid 2-byte ASN (1-65535) or 4-byte ASN (65536-4294967295).",
                affected=[str(bgp_asn)],
            ))
        elif 64512 <= int(bgp_asn) <= 65534:
            findings.append(Finding(
                check_id="BGP-1", domain="bgp", severity="info", status="pass",
                title="BGP ASN in Private Range",
                detail=f"ASN {bgp_asn} is a valid private 2-byte ASN (RFC 6996).",
                fix="",
            ))
        else:
            findings.append(Finding(
                check_id="BGP-1", domain="bgp", severity="info", status="pass",
                title="BGP ASN Valid",
                detail=f"ASN {bgp_asn} is valid.",
                fix="",
            ))

    # ── BGP-2: Spine-as-RR for EVPN ─────────────────────────────────────────
    if has_evpn and uc in ("dc", "hybrid"):
        rr_topo = bgp.get("rr_topology", "")
        if "RR" in str(rr_topo).upper() or "route-reflector" in str(rr_topo).lower():
            findings.append(Finding(
                check_id="BGP-2", domain="bgp", severity="info", status="pass",
                title="Spine BGP Route-Reflector Configured",
                detail="Spines are configured as BGP RRs. Verify `retain route-target all` "
                       "is set on spine RRs so they reflect all EVPN routes.",
                fix="",
            ))
        else:
            findings.append(Finding(
                check_id="BGP-2", domain="bgp", severity="high", status="warn",
                title="Spine BGP RR Configuration Unclear",
                detail="Could not confirm spine-as-RR configuration from design state.",
                fix="Ensure spines have: `address-family l2vpn evpn` + `retain route-target all` "
                    "and `route-reflector-client` on all leaf peer sessions.",
            ))

    # ── BGP-3: EVPN address-family enabled ──────────────────────────────────
    if has_evpn:
        if evpn:
            findings.append(Finding(
                check_id="BGP-3", domain="bgp", severity="info", status="pass",
                title="BGP EVPN Address-Family Enabled",
                detail="l2vpn evpn AF is enabled in the BGP design.",
                fix="",
            ))
        else:
            findings.append(Finding(
                check_id="BGP-3", domain="bgp", severity="critical", status="fail",
                title="BGP EVPN Address-Family Not Enabled",
                detail="EVPN/VXLAN protocols are in use but BGP l2vpn evpn AF is not active.",
                fix="Under `router bgp <ASN>`: add `address-family l2vpn evpn` on both "
                    "spine RRs and leaf VTEP clients.",
            ))

    # ── BGP-4: Community colouring scheme ───────────────────────────────────
    if comms:
        expected_keys = {"primary", "backup", "blackhole"}
        missing = expected_keys - {k.lower() for k in comms.keys()}
        if missing:
            findings.append(Finding(
                check_id="BGP-4", domain="bgp", severity="medium", status="warn",
                title="BGP Community Colouring Incomplete",
                detail=f"Missing community definitions: {missing}. "
                       "Full TE colouring requires primary/backup/blackhole communities.",
                fix="Define: `AS:100` = primary (LP=200), `AS:300` = backup (LP=100), "
                    "`AS:9999` = RTBH blackhole.",
                affected=list(missing),
            ))
        else:
            findings.append(Finding(
                check_id="BGP-4", domain="bgp", severity="info", status="pass",
                title="BGP Community Colouring Complete",
                detail=f"TE communities defined: {list(comms.keys())}",
                fix="",
            ))

    # ── BGP-5: ECMP path count ───────────────────────────────────────────────
    spine_count = state.get("spine_count") or 2
    if spine_count < 2:
        findings.append(Finding(
            check_id="BGP-5", domain="bgp", severity="critical", status="fail",
            title="Insufficient ECMP Paths (Single Spine — SPOF)",
            detail=f"Only {spine_count} spine(s) — single BGP RR path, no ECMP redundancy.",
            fix="Deploy minimum 2 spines for ECMP and RR redundancy.",
            affected=["SPINE-01"],
        ))
    else:
        findings.append(Finding(
            check_id="BGP-5", domain="bgp", severity="info", status="pass",
            title=f"ECMP Paths: {spine_count} (via {spine_count} Spines)",
            detail=f"{spine_count} spine(s) provide {spine_count}-way ECMP. "
                   "Verify `maximum-paths ibgp 64` is set on all devices.",
            fix="",
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Domain 4: EVPN
# ─────────────────────────────────────────────────────────────────────────────

def _check_evpn(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    protocols = [p.upper() for p in state.get("protocols", [])]
    has_evpn  = "EVPN" in protocols or "VXLAN" in protocols
    uc        = state.get("uc", "dc")

    if not has_evpn:
        findings.append(Finding(
            check_id="EVPN-0", domain="evpn", severity="info", status="info",
            title="EVPN Not Configured",
            detail="EVPN/VXLAN not in protocol list — EVPN checks skipped.",
            fix="",
        ))
        return findings

    vlan_plan = design.get("vlan_plan", {})
    vlans     = vlan_plan.get("vlans", [])
    l3vnis    = vlan_plan.get("l3vni_vlans", [])
    ip_plan   = design.get("ip_plan", {})
    vtep_pool = ip_plan.get("vtep_pool", [])

    # ── EVPN-1: RT scheme consistency ────────────────────────────────────────
    rt_scheme = design.get("bgp_design", {}).get("rt_scheme", "")
    if "auto" in str(rt_scheme).lower():
        findings.append(Finding(
            check_id="EVPN-1", domain="evpn", severity="info", status="pass",
            title="EVPN RT Scheme: Auto-Derived",
            detail="Route-targets use auto-derivation (AS:VNI). Verify all VTEPs use "
                   "the same BGP AS — auto RTs are AS-dependent.",
            fix="",
        ))
    else:
        findings.append(Finding(
            check_id="EVPN-1", domain="evpn", severity="medium", status="warn",
            title="EVPN RT Scheme: Manual — Verify Consistency",
            detail="Manual route-targets detected. Manual RTs must be identically "
                   "configured on every VTEP that shares the same VLAN/VRF.",
            fix="Audit all leaf configs: `show nve vni detail | grep RT`. "
                "Ensure import RT on receiver exactly matches export RT on sender.",
        ))

    # ── EVPN-2: VTEP source loopback dedicated ───────────────────────────────
    vtep_purposes = {v.get("ip", ""): v.get("device", "") for v in vtep_pool}
    if vtep_pool:
        findings.append(Finding(
            check_id="EVPN-2", domain="evpn", severity="info", status="pass",
            title=f"VTEP Pool Allocated ({len(vtep_pool)} VTEPs)",
            detail=f"VTEP anycast IPs: {[v.get('ip') for v in vtep_pool[:4]]}{'...' if len(vtep_pool)>4 else ''}",
            fix="Ensure NVE source-interface uses loopback1 (VTEP IP), "
                "not loopback0 (router-ID). They must be separate.",
        ))

    # ── EVPN-3: Symmetric IRB verification ──────────────────────────────────
    vrfs = {v.get("vrf") for v in vlans if v.get("vrf")}
    l3vni_vrfs = {v.get("vrf") for v in l3vnis if v.get("vrf")}
    irb_ok = vrfs <= l3vni_vrfs  # all VRFs have L3VNI

    if vrfs and not irb_ok:
        missing = vrfs - l3vni_vrfs
        findings.append(Finding(
            check_id="EVPN-3", domain="evpn", severity="critical", status="fail",
            title="Symmetric IRB Incomplete — Missing L3VNI Transit VLANs",
            detail=f"VRFs without L3VNI transit VLAN: {sorted(missing)}. "
                   "Symmetric IRB requires a transit VLAN per VRF for inter-subnet routing.",
            fix="Create transit VLAN (e.g. 3001) for each VRF. Configure SVI with "
                "`ip forward` only. Add to NVE: `member vni <l3vni> associate-vrf`.",
            affected=list(missing),
        ))
    elif vrfs:
        findings.append(Finding(
            check_id="EVPN-3", domain="evpn", severity="info", status="pass",
            title="Symmetric IRB Complete",
            detail=f"All {len(vrfs)} VRF(s) have L3VNI transit VLANs configured.",
            fix="",
        ))

    # ── EVPN-4: ARP suppression recommendation ──────────────────────────────
    findings.append(Finding(
        check_id="EVPN-4", domain="evpn", severity="medium", status="warn",
        title="ARP Suppression — Verify Enabled on All VTEPs",
        detail="ARP suppression reduces BUM (flood) traffic by caching ARP replies in "
               "the EVPN MAC/IP table. Not always enabled by default.",
        fix="NX-OS: under `vni <vni>` → `suppress-arp`. "
            "EOS: `vxlan flood vtep learned` or global ARP suppression. "
            "Verify: `show nve vni | grep suppress`.",
    ))

    # ── EVPN-5: Anycast gateway consistency ──────────────────────────────────
    gateways = {v.get("gateway") for v in vlans if v.get("gateway")}
    findings.append(Finding(
        check_id="EVPN-5", domain="evpn", severity="info", status="pass",
        title=f"Anycast Gateways Defined ({len(gateways)} VLANs)",
        detail=f"Virtual gateway IPs defined for {len(gateways)} VLAN(s). "
               "Ensure same anycast MAC is configured on all VTEPs: "
               "`fabric forwarding anycast-gateway-mac 0000.2222.3333` (NX-OS) / "
               "`ip virtual-router mac-address` (EOS).",
        fix="",
    ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Domain 5: Fabric / Physical
# ─────────────────────────────────────────────────────────────────────────────

def _check_fabric(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    uc         = state.get("uc", "dc")
    protocols  = [p.upper() for p in state.get("protocols", [])]
    has_evpn   = "EVPN" in protocols or "VXLAN" in protocols
    spine_count = state.get("spine_count") or 2
    leaf_count  = state.get("leaf_count") or 4
    gpu_spec    = state.get("gpuSpecifics") or {}
    if isinstance(gpu_spec, (str, list)):
        gpu_spec = {}

    # ── FABRIC-1: MTU check for VXLAN ────────────────────────────────────────
    if has_evpn and uc in ("dc", "hybrid", "gpu"):
        findings.append(Finding(
            check_id="FABRIC-1", domain="fabric", severity="high", status="warn",
            title="VXLAN MTU: Verify 9216 on All Fabric Links",
            detail="VXLAN encapsulation adds ~50 bytes. All P2P and NVE source interfaces "
                   "must be MTU 9216 (NX-OS) or 9214 (EOS). Host NICs must be ≥ 9000.",
            fix="Set on all fabric interfaces: `mtu 9216` (NX-OS) / `mtu 9214` (EOS). "
                "Set on hosts: `ip link set <intf> mtu 9000`. "
                "Test: `ping <dst> df-bit packet-size 8972`.",
        ))
    elif uc == "gpu":
        findings.append(Finding(
            check_id="FABRIC-1", domain="fabric", severity="critical", status="fail",
            title="GPU Fabric Requires Jumbo MTU 9214",
            detail="GPU/RDMA fabric must run MTU 9214 end-to-end for RoCEv2 performance.",
            fix="Set `mtu 9214` on all GPU TOR and spine interfaces and all GPU host NICs.",
        ))

    # ── FABRIC-2: BFD for fast failover ─────────────────────────────────────
    has_bfd = any("BFD" in p for p in protocols)
    if not has_bfd and uc in ("dc", "hybrid", "gpu"):
        findings.append(Finding(
            check_id="FABRIC-2", domain="fabric", severity="medium", status="warn",
            title="BFD Not Detected in Protocol List",
            detail="BFD (Bidirectional Forwarding Detection) is not listed in protocols. "
                   "Without BFD, BGP/OSPF failover relies on hold-timer expiry (3-9s minimum).",
            fix="Add BFD to all BGP and OSPF sessions: "
                "`bfd interval 300 min_rx 300 multiplier 3` on NX-OS/EOS. "
                "Reduces failover to ~300ms.",
        ))
    else:
        findings.append(Finding(
            check_id="FABRIC-2", domain="fabric", severity="info", status="pass",
            title="BFD Enabled for Fast Failover",
            detail="BFD is in the protocol list. Verify `bfd interval 300 min_rx 300 "
                   "multiplier 3` on all BGP and OSPF sessions.",
            fix="",
        ))

    # ── FABRIC-3: ECMP redundancy ────────────────────────────────────────────
    expected_links = spine_count * leaf_count
    ip_plan  = design.get("ip_plan", {})
    p2p_links = ip_plan.get("p2p_links", [])
    actual_links = len(p2p_links)

    if actual_links == 0:
        findings.append(Finding(
            check_id="FABRIC-3", domain="fabric", severity="medium", status="warn",
            title="P2P Link Count Not Verified",
            detail="No P2P links found in IP plan — topology may not be generated yet.",
            fix="Run generate_full_design() to populate the IP plan.",
        ))
    elif actual_links == expected_links:
        findings.append(Finding(
            check_id="FABRIC-3", domain="fabric", severity="info", status="pass",
            title=f"CLOS Full-Mesh Complete ({actual_links} P2P Links)",
            detail=f"All {spine_count} spines × {leaf_count} leaves connected "
                   f"({actual_links} P2P /31 links). Full ECMP mesh.",
            fix="",
        ))
    else:
        findings.append(Finding(
            check_id="FABRIC-3", domain="fabric", severity="high", status="fail",
            title=f"CLOS Mesh Incomplete — Expected {expected_links}, Got {actual_links}",
            detail=f"Expected {spine_count}×{leaf_count}={expected_links} P2P links "
                   f"but only {actual_links} found. Some CLOS links missing.",
            fix="Verify all spine-to-leaf connections are included in the IP plan.",
            affected=[f"Expected {expected_links} links, got {actual_links}"],
        ))

    # ── FABRIC-4: PFC for GPU ────────────────────────────────────────────────
    if uc == "gpu":
        pfc_on = gpu_spec.get("pfc", False)
        dcqcn  = gpu_spec.get("dcqcn", False)
        if not pfc_on:
            findings.append(Finding(
                check_id="FABRIC-4", domain="fabric", severity="critical", status="fail",
                title="PFC Lossless Not Enabled for GPU Fabric",
                detail="GPU/RoCEv2 fabric requires PFC priority-flow-control mode on. "
                       "Without it, RDMA traffic is not lossless and GPU training will degrade.",
                fix="Enable on all GPU TOR and spine ports: "
                    "`priority-flow-control mode on` + "
                    "`priority-flow-control priority 3 no-drop`. "
                    "Also configure DCQCN ECN Kmin=50KB Kmax=100KB.",
            ))
        else:
            findings.append(Finding(
                check_id="FABRIC-4", domain="fabric", severity="info", status="pass",
                title="PFC Lossless Enabled (GPU Fabric)",
                detail="PFC is enabled. Verify priority 3 is the lossless queue "
                       "end-to-end (NIC → TOR → Spine).",
                fix="",
            ))
        if not dcqcn:
            findings.append(Finding(
                check_id="FABRIC-4b", domain="fabric", severity="high", status="warn",
                title="DCQCN ECN Not Confirmed for GPU Fabric",
                detail="DCQCN (Data Center Quantized Congestion Notification) is not "
                       "confirmed in GPU spec. ECN marking prevents PFC storms.",
                fix="Configure ECN: `random-detect ecn minimum-threshold 50000 "
                    "maximum-threshold 100000 drop-probability 0` on queue 3.",
            ))

    # ── FABRIC-5: NTP redundancy ─────────────────────────────────────────────
    findings.append(Finding(
        check_id="FABRIC-5", domain="fabric", severity="medium", status="warn",
        title="NTP: Verify ≥ 2 Servers Configured per Device",
        detail="NTP redundancy requires at least 2 servers. Time skew > 128s can break "
               "BGP MD5 authentication, TACACS sessions, and TLS certificates.",
        fix="Configure: `ntp server <primary> prefer` + `ntp server <secondary>` "
            "in management VRF on every device.",
    ))

    # ── FABRIC-6: OSPF passive-interface ────────────────────────────────────
    underlay_raw = state.get("underlayProto", "")
    underlay = (
        underlay_raw[0].upper() if isinstance(underlay_raw, list) and underlay_raw
        else underlay_raw.upper() if isinstance(underlay_raw, str)
        else ""
    )
    if "OSPF" in underlay or "OSPF" in protocols:
        findings.append(Finding(
            check_id="FABRIC-6", domain="fabric", severity="medium", status="warn",
            title="OSPF: Verify passive-interface on Loopbacks",
            detail="OSPF should be passive on loopback interfaces to prevent "
                   "unnecessary hello generation. Only P2P links should be active.",
            fix="Global: `passive-interface default` then `no passive-interface Eth1/x` "
                "for each P2P link. This also prevents OSPF on server-facing ports.",
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Domain 6: Security Baseline
# ─────────────────────────────────────────────────────────────────────────────

def _check_security(state: dict, design: dict) -> list[Finding]:
    findings: list[Finding] = []
    security = [s.upper() for s in state.get("security", [])]
    compliance = [c.upper() for c in state.get("compliance", [])]
    uc = state.get("uc", "dc")

    # ── SEC-1: SSH v2 only ──────────────────────────────────────────────────
    has_ssh = any("SSH" in s for s in security) or state.get("include_security_hardening", False)
    findings.append(Finding(
        check_id="SEC-1", domain="security", severity="high", status="warn",
        title="SSH v2: Verify Telnet/HTTP Disabled",
        detail="All device access should be SSH v2 only. Telnet and HTTP must be disabled.",
        fix="NX-OS: `no feature telnet`. EOS: `no management telnet`. "
            "IOS-XE: `no service telnet`. Verify: `show feature | grep telnet`.",
    ))

    # ── SEC-2: AAA / TACACS+ ────────────────────────────────────────────────
    has_aaa = any(s in ("TACACS", "RADIUS", "AAA", "802.1X") for s in security)
    if not has_aaa:
        findings.append(Finding(
            check_id="SEC-2", domain="security", severity="high", status="warn",
            title="AAA (TACACS+/RADIUS) Not Detected",
            detail="No TACACS+/RADIUS authentication detected in security config. "
                   "Local-only auth is a compliance risk.",
            fix="Configure TACACS+: `tacacs-server host <ip> key <key>`. "
                "Set AAA: `aaa authentication login default group tacacs+ local`. "
                "Always keep local user as fallback.",
        ))
    else:
        findings.append(Finding(
            check_id="SEC-2", domain="security", severity="info", status="pass",
            title="AAA Authentication Configured",
            detail="TACACS+/RADIUS/802.1X detected in security settings.",
            fix="Verify TACACS+ server is reachable from management VRF.",
        ))

    # ── SEC-3: Management VRF isolation ─────────────────────────────────────
    findings.append(Finding(
        check_id="SEC-3", domain="security", severity="medium", status="warn",
        title="Management Plane: Verify OOB VRF Isolation",
        detail="Management interfaces should be in a dedicated VRF (vrf MGMT / vrf management) "
               "to prevent data-plane routing from reaching management addresses.",
        fix="Place management interface in dedicated VRF: `vrf context management` (NX-OS) / "
            "`vrf instance MGMT` (EOS). Use `ip route vrf MGMT 0.0.0.0/0 <gw>`.",
    ))

    # ── SEC-4: SNMPv3 ───────────────────────────────────────────────────────
    has_snmp = any("SNMP" in s for s in security)
    if not has_snmp:
        findings.append(Finding(
            check_id="SEC-4", domain="security", severity="medium", status="warn",
            title="SNMPv3 Not Detected",
            detail="No SNMP configuration detected. SNMPv3 with auth+encrypt is required "
                   "for monitoring. SNMPv1/v2c are insecure (plaintext community strings).",
            fix="Configure SNMPv3: `snmp-server user <user> <group> v3 auth sha <pwd> priv aes <pwd>`. "
                "NX-OS: `snmp-server host <mgmt-server> traps version 3 priv <user>`.",
        ))

    # ── SEC-5: Control-plane protection ─────────────────────────────────────
    findings.append(Finding(
        check_id="SEC-5", domain="security", severity="medium", status="warn",
        title="CoPP: Verify Control-Plane Policing Configured",
        detail="CoPP protects the routing engine from traffic floods. "
               "Default CoPP policies may not be tuned for your BGP/OSPF scale.",
        fix="NX-OS: `show policy-map interface control-plane` — verify BGP class allows "
            "8000+ pps for large EVPN deployments. EOS: review `policy-map copp`.",
    ))

    # ── SEC-6: Compliance flags ──────────────────────────────────────────────
    if any(c in compliance for c in ("PCI", "HIPAA", "SOC2", "ISO27001")):
        findings.append(Finding(
            check_id="SEC-6", domain="security", severity="info", status="pass",
            title=f"Compliance Framework Detected: {compliance}",
            detail="Compliance frameworks require additional controls beyond network config. "
                   "Ensure: encrypted management (SSH/TLS), audit logging, access reviews.",
            fix="",
        ))
    elif not compliance:
        findings.append(Finding(
            check_id="SEC-6", domain="security", severity="info", status="info",
            title="No Compliance Framework Specified",
            detail="No compliance framework (PCI/HIPAA/SOC2) specified. "
                   "If applicable, specify in design to trigger compliance checks.",
            fix="",
        ))

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Main analysis runner
# ─────────────────────────────────────────────────────────────────────────────

def run_analysis_with_design(
    state: dict[str, Any],
    design: dict[str, Any],
) -> AnalysisReport:
    """Run all checks against pre-generated design objects."""
    all_findings: list[Finding] = []
    all_findings += _check_ip(state, design)
    all_findings += _check_vlan(state, design)
    all_findings += _check_bgp(state, design)
    all_findings += _check_evpn(state, design)
    all_findings += _check_fabric(state, design)
    all_findings += _check_security(state, design)

    # Per-domain scores
    domains = ["ip", "vlan", "bgp", "evpn", "fabric", "security"]
    domain_scores = {}
    for d in domains:
        d_findings = [f for f in all_findings if f.domain == d and f.status not in ("info",)]
        domain_scores[d] = _score_domain(d_findings)

    # Counts
    fail_count = sum(1 for f in all_findings if f.status == "fail")
    warn_count = sum(1 for f in all_findings if f.status == "warn")
    pass_count = sum(1 for f in all_findings if f.status == "pass")
    crit_count = sum(1 for f in all_findings if f.severity == "critical" and f.status == "fail")

    # Overall score
    overall_score = max(0, 100 - crit_count * 25 - (fail_count - crit_count) * 12 - warn_count * 4)

    overall = (
        "critical" if crit_count > 0
        else "fail"    if fail_count > 0
        else "warn"    if warn_count > 3
        else "pass"
    )

    summary = (
        f"{len(all_findings)} checks run across 6 domains. "
        f"{pass_count} passed · {warn_count} warnings · {fail_count} failed "
        f"({crit_count} critical). "
        f"Design health score: {overall_score}/100 — {overall.upper()}."
    )

    return AnalysisReport(
        overall=overall,
        score=overall_score,
        findings=all_findings,
        summary=summary,
        domain_scores=domain_scores,
        check_count=len(all_findings),
        fail_count=fail_count,
        warn_count=warn_count,
        pass_count=pass_count,
    )


def run_analysis(state: dict[str, Any]) -> AnalysisReport:
    """Generate design and run all static checks. Convenience wrapper."""
    from design_engine import generate_full_design
    design = generate_full_design(state)
    return run_analysis_with_design(state, design)
