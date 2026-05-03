"""
EVPN / VXLAN Overlay Policy Generator
=======================================
Generates the full EVPN overlay configuration block:
  • Tenant VRF definitions (L3VNI symmetric-IRB)
  • L2VNI  — VLAN ↔ VNI mapping, NVE member VNIs
  • L3VNI  — per-VRF VNI, anycast-gateway SVI, ip forward
  • BGP EVPN address-family — per-VNI / per-VRF route-target import/export
  • Community-based RT policies — extended community lists, route-maps for
    community colour tagging, local-preference manipulation, blackhole trigger
  • Spine ↔ Leaf policy distinction (RR retain-all vs. VTEP per-VNI filter)

VNI numbering scheme
--------------------
  L2VNI  = L2VNI_BASE (10 000) + vlan_id         →  VLAN 10  → VNI 10 010
  L3VNI  = L3VNI_BASE (19 000) + vrf_index        →  VRF PROD → VNI 19 001
  RT     = "<spine_asn>:<vni>"  (64-bit extended)  →  65000:10010

Active only for dc / gpu / hybrid use cases.
Platforms: nxos, eos, sonic, ios-xe, junos.
"""
from __future__ import annotations
from typing import Any

# ── VNI / RT scheme constants ───────────────────────────────────────────────
L2VNI_BASE  = 10_000
L3VNI_BASE  = 19_000
SPINE_ASN   = 65_000

# ── Default tenant VRFs (overridden by state.vlans when available) ──────────
DEFAULT_VRFS: list[dict] = [
    {"name": "PROD",    "idx": 1, "vlans": [10, 11], "desc": "Production workloads"},
    {"name": "DEV",     "idx": 2, "vlans": [20, 21], "desc": "Development / QA"},
    {"name": "STORAGE", "idx": 3, "vlans": [30],     "desc": "Storage fabric"},
]

# ── Community colour scheme ─────────────────────────────────────────────────
# Used in route-maps to tag / select routes across the fabric.
COMM = {
    "l2vni_export":  f"{SPINE_ASN}:200",   # EVPN type-2 MAC/IP
    "l3vni_export":  f"{SPINE_ASN}:500",   # EVPN type-5 IP prefix
    "spine_orig":    f"{SPINE_ASN}:1000",  # Spine-originated routes
    "lp_primary":    f"{SPINE_ASN}:100",   # LocalPref 200 (primary path)
    "lp_backup":     f"{SPINE_ASN}:300",   # LocalPref 100 (backup path)
    "blackhole":     f"{SPINE_ASN}:9999",  # Null-route trigger
    "no_export":     "no-export",
}


# ── Public entry point ───────────────────────────────────────────────────────

def generate_evpn_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return EVPN/VXLAN overlay config block.  Returns '' if not applicable."""
    uc    = ctx.get("uc", "dc")
    layer = ctx.get("layer", "dc-leaf")
    if uc not in ("dc", "hybrid", "gpu"):
        return ""
    # GPU spines/TORs use BGP unnumbered / pure L3 — no VXLAN overlay needed
    if uc == "gpu" and layer not in ("dc-spine", "dc-leaf"):
        return ""

    fn = {
        "nxos":   _nxos_evpn,
        "eos":    _eos_evpn,
        "sonic":  _sonic_evpn,
        "ios-xe": _iosxe_evpn,
        "junos":  _junos_evpn,
    }.get(platform, _nxos_evpn)

    return fn(ctx, layer)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _vrfs_from_ctx(ctx: dict) -> list[dict]:
    """Return tenant VRF list, derived from ctx.vlans where available."""
    vlans = ctx.get("vlans", [])
    if not vlans:
        return DEFAULT_VRFS
    # Group VLANs by VRF hint in name (PROD/DEV/STORAGE), fallback to PROD
    seen: dict[str, dict] = {}
    for i, v in enumerate(vlans):
        name = str(v.get("name", "")).upper()
        vrf  = ("STORAGE" if "STOR" in name or "SAN" in name or "NFS" in name
                else "DEV"  if "DEV"  in name or "QA"  in name or "TEST" in name
                else "PROD")
        if vrf not in seen:
            seen[vrf] = {"name": vrf, "idx": len(seen)+1, "vlans": [], "desc": f"{vrf} tenant"}
        seen[vrf]["vlans"].append(v["id"])
    return list(seen.values()) or DEFAULT_VRFS


def _l2vni(vlan_id: int) -> int:
    return L2VNI_BASE + vlan_id

def _l3vni(vrf_idx: int) -> int:
    return L3VNI_BASE + vrf_idx

def _rt(vni: int) -> str:
    return f"{SPINE_ASN}:{vni}"


# ── NX-OS ────────────────────────────────────────────────────────────────────

def _nxos_evpn(ctx: dict, layer: str) -> str:
    idx    = ctx.get("index", 1)
    asn    = ctx.get("bgp_asn", SPINE_ASN)
    vrfs   = _vrfs_from_ctx(ctx)
    is_spine = "spine" in layer

    L: list[str] = []
    L += [
        "!",
        "!-- ╔══════════════════════════════════════════════════╗",
        "!-- ║   EVPN / VXLAN OVERLAY — NX-OS                  ║",
        "!-- ║   Symmetric IRB · L2VNI + L3VNI · BGP EVPN AF   ║",
        "!-- ╚══════════════════════════════════════════════════╝",
        "!",
    ]

    if is_spine:
        # ── Spine: Route Reflector — retain all RTs, community policies ─────
        L += [
            "!-- Spine EVPN Route Reflector",
            "!-- Route-target retain: spine reflects all EVPN routes unchanged",
            "!",
            "!-- Extended-community lists for RT filtering",
            f"ip extcommunity-list standard RT-L2VNI permit rt {COMM['l2vni_export']}",
            f"ip extcommunity-list standard RT-L3VNI permit rt {COMM['l3vni_export']}",
            f"ip extcommunity-list standard RT-ANY  permit rt {SPINE_ASN}:0",
            "!",
            "!-- Community lists (standard) for traffic-engineering",
            f"ip community-list standard LP-PRIMARY permit {COMM['lp_primary']}",
            f"ip community-list standard LP-BACKUP  permit {COMM['lp_backup']}",
            f"ip community-list standard BLACKHOLE  permit {COMM['blackhole']}",
            f"ip community-list standard SPINE-ORIG permit {COMM['spine_orig']}",
            "!",
            "!-- Route-maps applied to RR clients (leaf EVPN neighbors)",
            "route-map EVPN-RR-PEER-IN permit 10",
            f"  description Accept EVPN routes — set LP from community tag",
            f"  match community LP-PRIMARY",
            f"  set local-preference 200",
            "route-map EVPN-RR-PEER-IN permit 20",
            f"  match community LP-BACKUP",
            f"  set local-preference 100",
            "route-map EVPN-RR-PEER-IN permit 30",
            f"  description Default accept — no LP override",
            "!",
            "route-map EVPN-RR-PEER-OUT permit 10",
            f"  description Spine reflects without NH change (RR rule 9.2)",
            f"  set community {COMM['spine_orig']} additive",
            "route-map EVPN-RR-PEER-OUT permit 20",
            "!",
            "route-map BLACKHOLE-TRIGGER permit 10",
            f"  match community BLACKHOLE",
            f"  set ip next-hop null0",
            f"  set local-preference 1000",
            "route-map BLACKHOLE-TRIGGER deny 20",
            "!",
            "!-- BGP EVPN address-family (spine RR stanza)",
            f"router bgp {asn}",
            f"  address-family l2vpn evpn",
            f"    retain route-target all",
            f"    advertise-pip",
        ]
        # Peer stanzas for each leaf
        for i in range(1, 9):
            leaf_lo = f"10.0.{i}.{i}"
            L += [
                f"  neighbor {leaf_lo}",
                f"    remote-as {asn}",
                f"    description LEAF-{i:02d}-EVPN-CLIENT",
                f"    update-source loopback0",
                f"    address-family l2vpn evpn",
                f"      send-community extended",
                f"      route-reflector-client",
                f"      route-map EVPN-RR-PEER-IN  in",
                f"      route-map EVPN-RR-PEER-OUT out",
                f"      soft-reconfiguration inbound",
                f"      maximum-prefix 50000 80",
            ]

    else:
        # ── Leaf (VTEP): L2VNI + L3VNI + per-VNI RT import/export ──────────

        # 1. Tenant VRFs
        L.append("!-- Tenant VRF definitions (L3VNI symmetric IRB)")
        for vrf in vrfs:
            l3vni = _l3vni(vrf["idx"])
            rt    = _rt(l3vni)
            L += [
                f"vrf context {vrf['name']}",
                f"  description {vrf['desc']}",
                f"  vni {l3vni}",
                f"  rd {asn}:{vrf['idx']}",
                f"  address-family ipv4 unicast",
                f"    route-target both {rt}",
                f"    route-target import {COMM['l3vni_export']}",
                f"  address-family ipv6 unicast",
                f"    route-target both {rt}",
                "!",
            ]

        # 2. VLAN → VNI mapping and L3VNI transit VLANs
        L.append("!-- L2VNI: VLAN → VNI segments")
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                L += [
                    f"vlan {vid}",
                    f"  vn-segment {vni}",
                ]
        # L3VNI transit VLANs (VLAN 3001+ range, not user-facing)
        L.append("!-- L3VNI transit VLANs (symmetric IRB)")
        for vrf in vrfs:
            transit_vlan = 3000 + vrf["idx"]
            l3vni = _l3vni(vrf["idx"])
            L += [
                f"vlan {transit_vlan}",
                f"  vn-segment {l3vni}",
                f"  name L3VNI-{vrf['name']}-TRANSIT",
            ]
        L.append("!")

        # 3. SVIs for L2VNI (anycast GW) and L3VNI (ip forward, no IP)
        L.append("!-- Anycast-gateway SVIs (L2VNI)")
        for vrf in vrfs:
            for i, vid in enumerate(vrf["vlans"]):
                L += [
                    f"interface Vlan{vid}",
                    f"  description {vrf['name']}-L2-VLAN{vid}",
                    f"  vrf member {vrf['name']}",
                    f"  no shutdown",
                    f"  ip address 10.{vrf['idx']}.{i+1}.1/24",
                    f"  fabric forwarding mode anycast-gateway",
                ]
        L.append("!-- L3VNI transit SVIs (no IP — VRF routing only)")
        for vrf in vrfs:
            transit_vlan = 3000 + vrf["idx"]
            L += [
                f"interface Vlan{transit_vlan}",
                f"  description L3VNI-{vrf['name']}",
                f"  vrf member {vrf['name']}",
                f"  no shutdown",
                f"  ip forward",
            ]
        L.append("!")

        # 4. NVE interface (VTEP)
        L += [
            "!-- NVE (VTEP) — source loopback1",
            "interface nve1",
            "  no shutdown",
            "  source-interface loopback1",
            "  host-reachability protocol bgp",
        ]
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                L += [
                    f"  member vni {vni}",
                    f"    suppress-arp",
                    f"    ingress-replication protocol bgp",
                ]
            # L3VNI associate-vrf
            l3vni = _l3vni(vrf["idx"])
            L += [
                f"  member vni {l3vni} associate-vrf",
            ]
        L.append("!")

        # 5. Extended community lists for RT matching
        L += [
            "!-- Extended-community lists for RT import filtering",
            f"ip extcommunity-list standard RT-L2VNI permit rt {COMM['l2vni_export']}",
            f"ip extcommunity-list standard RT-L3VNI permit rt {COMM['l3vni_export']}",
        ]
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                rt  = _rt(vni)
                L.append(f"ip extcommunity-list standard RT-VNI-{vni} permit rt {rt}")
            l3vni = _l3vni(vrf["idx"])
            L.append(f"ip extcommunity-list standard RT-VRF-{vrf['name']} permit rt {_rt(l3vni)}")
        L.append("!")

        # 6. Standard communities for TE
        L += [
            f"ip community-list standard LP-PRIMARY permit {COMM['lp_primary']}",
            f"ip community-list standard LP-BACKUP  permit {COMM['lp_backup']}",
            f"ip community-list standard BLACKHOLE  permit {COMM['blackhole']}",
            "!",
        ]

        # 7. Route-maps: leaf-to-spine export + spine-to-leaf import
        L += [
            "!-- Route-map: Leaf → Spine EVPN export",
            "route-map LEAF-EVPN-EXPORT permit 10",
            f"  description Tag loopbacks as primary path",
            f"  match ip address prefix-list LOOPBACKS",
            f"  set community {COMM['lp_primary']} additive",
            f"  set extcommunity rt {COMM['l2vni_export']} additive",
            "route-map LEAF-EVPN-EXPORT permit 20",
            f"  description Tag L3 host routes",
            f"  set community {COMM['lp_primary']} additive",
            f"  set extcommunity rt {COMM['l3vni_export']} additive",
            "!",
            "route-map SPINE-EVPN-IMPORT permit 10",
            f"  description Accept spine-originated (LP=200)",
            f"  match community LP-PRIMARY",
            f"  set local-preference 200",
            "route-map SPINE-EVPN-IMPORT permit 20",
            f"  match community LP-BACKUP",
            f"  set local-preference 100",
            "route-map SPINE-EVPN-IMPORT permit 30",
            f"  description Default accept",
            "!",
            "route-map BLACKHOLE-TRIGGER permit 10",
            f"  match community BLACKHOLE",
            f"  set ip next-hop null0",
            f"  set local-preference 1000",
            "route-map BLACKHOLE-TRIGGER deny 20",
            "!",
            "route-map NEXTHOP-SELF-EVPN permit 10",
            f"  match route-type external",
            f"  set ip next-hop self",
            "route-map NEXTHOP-SELF-EVPN permit 20",
            "!",
        ]

        # 8. BGP EVPN AF with per-VNI and per-VRF route-targets
        L += [
            f"!-- BGP EVPN address-family — per-VNI RT import/export",
            f"router bgp {asn}",
            f"  address-family l2vpn evpn",
        ]
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                rt  = _rt(vni)
                L += [
                    f"    vni {vni}",
                    f"      route-target import {rt}",
                    f"      route-target export {rt}",
                    f"      advertise-mac-ip",
                ]
            l3vni = _l3vni(vrf["idx"])
            rt3   = _rt(l3vni)
            L += [
                f"    vni {l3vni}",
                f"      route-target import {rt3}",
                f"      route-target export {rt3}",
                f"      advertise-pip",
            ]
        L.append("!")

        # 9. Spine neighbor EVPN sessions (leaf → spine RR)
        L.append("!-- Leaf BGP EVPN sessions to spine route-reflectors")
        spine_ips = ctx.get("spine_ips", ["10.0.1.1", "10.0.1.2"])
        for i, sp_ip in enumerate(spine_ips):
            sp_asn = asn  # iBGP
            L += [
                f"  neighbor {sp_ip}",
                f"    remote-as {sp_asn}",
                f"    description SPINE-{i+1:02d}-RR",
                f"    update-source loopback0",
                f"    address-family l2vpn evpn",
                f"      send-community extended",
                f"      route-map LEAF-EVPN-EXPORT  out",
                f"      route-map SPINE-EVPN-IMPORT in",
                f"      soft-reconfiguration inbound",
                f"      maximum-prefix 50000 80",
            ]
        L.append("!")

    return "\n".join(L) + "\n"


# ── Arista EOS ───────────────────────────────────────────────────────────────

def _eos_evpn(ctx: dict, layer: str) -> str:
    idx      = ctx.get("index", 1)
    asn      = ctx.get("bgp_asn", SPINE_ASN)
    vrfs     = _vrfs_from_ctx(ctx)
    is_spine = "spine" in layer

    L: list[str] = []
    L += [
        "!",
        "! ╔══════════════════════════════════════════════════╗",
        "! ║   EVPN / VXLAN OVERLAY — Arista EOS             ║",
        "! ║   Symmetric IRB · L2VNI + L3VNI · BGP EVPN AF   ║",
        "! ╚══════════════════════════════════════════════════╝",
        "!",
    ]

    if is_spine:
        L += [
            "!-- Spine EVPN Route Reflector — EOS",
            "ip extcommunity-list ECL-EVPN-RT permit rt *:*",
            f"ip community-list CL-BLACKHOLE permit {COMM['blackhole']}",
            f"ip community-list CL-LP-PRIMARY permit {COMM['lp_primary']}",
            "!",
            "route-map RM-EVPN-RR-IN permit 10",
            f"   match community CL-LP-PRIMARY",
            f"   set local-preference 200",
            "route-map RM-EVPN-RR-IN permit 20",
            "!",
            "route-map RM-EVPN-RR-OUT permit 10",
            f"   set community {COMM['spine_orig']} additive",
            "route-map RM-EVPN-RR-OUT permit 20",
            "!",
            "route-map RM-BLACKHOLE permit 10",
            "   match community CL-BLACKHOLE",
            "   set ip next-hop 192.0.2.1",
            "   set local-preference 5000",
            "route-map RM-BLACKHOLE deny 20",
            "!",
            f"router bgp {asn}",
            "   no bgp default ipv4-unicast",
            f"   router-id {ctx.get('loopback_ip','10.0.1.1')}",
            "   !",
            "   address-family evpn",
        ]
        for i in range(1, 9):
            leaf_lo = f"10.0.{i}.{i}"
            L += [
                f"   neighbor {leaf_lo} remote-as {asn}",
                f"   neighbor {leaf_lo} update-source Loopback0",
                f"   neighbor {leaf_lo} description LEAF-{i:02d}",
                f"   neighbor {leaf_lo} send-community extended",
                f"   neighbor {leaf_lo} route-reflector-client",
                f"   neighbor {leaf_lo} route-map RM-EVPN-RR-IN  in",
                f"   neighbor {leaf_lo} route-map RM-EVPN-RR-OUT out",
                f"   neighbor {leaf_lo} maximum-routes 50000 warning-only",
                f"   neighbor {leaf_lo} activate",
            ]
        L.append("!")

    else:
        # Leaf / VTEP
        # VRFs
        for vrf in vrfs:
            l3vni = _l3vni(vrf["idx"])
            rt    = _rt(l3vni)
            L += [
                f"vrf instance {vrf['name']}",
                f"   description {vrf['desc']}",
                f"   rd {asn}:{vrf['idx']}",
                f"   route-target import evpn {rt}",
                f"   route-target export evpn {rt}",
                "!",
            ]

        # VLANs → VNIs
        L.append("!-- VLAN → VNI mapping")
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                L += [
                    f"vlan {vid}",
                    f"   name {vrf['name']}-VLAN{vid}",
                ]

        # VTEP
        L += [
            "!",
            "!-- VXLAN VTEP interface",
            "interface Vxlan1",
            f"   vxlan source-interface Loopback1",
            f"   vxlan udp-port 4789",
        ]
        for vrf in vrfs:
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                L.append(f"   vxlan vlan {vid} vni {vni}")
            l3vni = _l3vni(vrf["idx"])
            L.append(f"   vxlan vrf {vrf['name']} vni {l3vni}")
        L.append("!")

        # SVIs
        L.append("!-- Anycast-gateway SVIs")
        for vrf in vrfs:
            for i, vid in enumerate(vrf["vlans"]):
                L += [
                    f"interface Vlan{vid}",
                    f"   vrf {vrf['name']}",
                    f"   ip address virtual 10.{vrf['idx']}.{i+1}.1/24",
                    f"   no shutdown",
                ]
        L.append("!")

        # Community lists and route-maps
        L += [
            f"ip community-list CL-LP-PRIMARY permit {COMM['lp_primary']}",
            f"ip community-list CL-LP-BACKUP  permit {COMM['lp_backup']}",
            f"ip community-list CL-BLACKHOLE  permit {COMM['blackhole']}",
            "!",
            "route-map RM-LEAF-EVPN-EXPORT permit 10",
            f"   set community {COMM['lp_primary']} additive",
            f"   set extcommunity rt {COMM['l2vni_export']} additive",
            "route-map RM-LEAF-EVPN-EXPORT permit 20",
            "!",
            "route-map RM-SPINE-EVPN-IMPORT permit 10",
            "   match community CL-LP-PRIMARY",
            "   set local-preference 200",
            "route-map RM-SPINE-EVPN-IMPORT permit 20",
            "   match community CL-LP-BACKUP",
            "   set local-preference 100",
            "route-map RM-SPINE-EVPN-IMPORT permit 30",
            "!",
            "route-map RM-EVPN-NH-UNCHANGED permit 10",
            "   set ip next-hop unchanged",
            "!",
        ]

        # BGP EVPN AF
        L += [
            f"router bgp {asn}",
            "   no bgp default ipv4-unicast",
            f"   router-id {ctx.get('loopback_ip','10.0.1.1')}",
            "   !",
            "   address-family evpn",
        ]
        spine_ips = ctx.get("spine_ips", ["10.0.1.1", "10.0.1.2"])
        for i, sp in enumerate(spine_ips):
            L += [
                f"   neighbor {sp} remote-as {asn}",
                f"   neighbor {sp} update-source Loopback0",
                f"   neighbor {sp} description SPINE-{i+1:02d}-RR",
                f"   neighbor {sp} send-community extended",
                f"   neighbor {sp} route-map RM-LEAF-EVPN-EXPORT  out",
                f"   neighbor {sp} route-map RM-SPINE-EVPN-IMPORT in",
                f"   neighbor {sp} maximum-routes 50000 warning-only",
                f"   neighbor {sp} activate",
            ]
        L.append("!")

        # Per-VRF BGP
        for vrf in vrfs:
            l3vni = _l3vni(vrf["idx"])
            rt    = _rt(l3vni)
            L += [
                f"   vrf {vrf['name']}",
                f"      rd {asn}:{vrf['idx']}",
                f"      route-target import evpn {rt}",
                f"      route-target export evpn {rt}",
                f"      redistribute connected",
                f"      redistribute static",
                "   !",
            ]
        L.append("!")

    return "\n".join(L) + "\n"


# ── SONiC (CONFIG_DB JSON stanza) ────────────────────────────────────────────

def _sonic_evpn(ctx: dict, layer: str) -> str:
    """SONiC EVPN is configured via CONFIG_DB — return a JSON snippet."""
    asn  = ctx.get("bgp_asn", SPINE_ASN)
    vrfs = _vrfs_from_ctx(ctx)
    idx  = ctx.get("index", 1)

    lines: list[str] = []
    lines += [
        "! SONiC EVPN/VXLAN — CONFIG_DB additions (frr.conf / config_db.json)",
        "! Insert into /etc/sonic/config_db.json or apply via 'config load'",
        "!",
    ]

    # FRR BGP EVPN config (frr.conf syntax)
    lines += [
        "!-- FRR BGP EVPN configuration (appended to /etc/frr/frr.conf)",
        f"router bgp {asn}",
        f" bgp router-id {ctx.get('loopback_ip','10.0.1.1')}",
        f" !",
        f" address-family l2vpn evpn",
        f"  advertise-all-vni",
        f"  advertise-default-gw",
    ]
    for vrf in vrfs:
        for vid in vrf["vlans"]:
            vni = _l2vni(vid)
            rt  = _rt(vni)
            lines += [
                f"  vni {vni}",
                f"   route-target import {rt}",
                f"   route-target export {rt}",
                f"   advertise-svi-ip",
            ]
        l3vni = _l3vni(vrf["idx"])
        lines += [
            f"  vni {l3vni}",
            f"   route-target import {_rt(l3vni)}",
            f"   route-target export {_rt(l3vni)}",
        ]

    # Spine neighbors
    spine_ips = ctx.get("spine_ips", ["10.0.1.1", "10.0.1.2"])
    for i, sp in enumerate(spine_ips):
        lines += [
            f"  neighbor {sp} activate",
            f"  neighbor {sp} route-map LEAF-EVPN-EXPORT out",
            f"  neighbor {sp} route-map SPINE-EVPN-IMPORT in",
            f"  neighbor {sp} send-community extended",
        ]
    lines += [
        " exit-address-family",
        "!",
        "!-- Route-maps",
        f"ip community-list standard LP-PRIMARY permit {COMM['lp_primary']}",
        f"ip community-list standard BLACKHOLE  permit {COMM['blackhole']}",
        "!",
        "route-map LEAF-EVPN-EXPORT permit 10",
        f" set community {COMM['lp_primary']} additive",
        f" set extcommunity rt {COMM['l2vni_export']} additive",
        "route-map LEAF-EVPN-EXPORT permit 20",
        "!",
        "route-map SPINE-EVPN-IMPORT permit 10",
        " match community LP-PRIMARY",
        " set local-preference 200",
        "route-map SPINE-EVPN-IMPORT permit 20",
        "!",
    ]

    # CONFIG_DB VXLAN_TUNNEL and VXLAN_TUNNEL_MAP entries
    lines += [
        "!-- CONFIG_DB VXLAN additions",
        '  "VXLAN_TUNNEL": {',
        '    "vtep1": {',
        f'      "src_ip": "{ctx.get("loopback_ip","10.0.1.1")}"',
        '    }',
        '  },',
        '  "VXLAN_EVPN_NVO": {',
        '    "nvo1": {',
        '      "source_vtep": "vtep1"',
        '    }',
        '  },',
    ]
    vxlan_maps: list[str] = []
    for vrf in vrfs:
        for vid in vrf["vlans"]:
            vni = _l2vni(vid)
            vxlan_maps.append(
                f'    "vtep1|{vni}": {{"vlan": "Vlan{vid}"}}'
            )
    lines.append('  "VXLAN_TUNNEL_MAP": {')
    lines.append(",\n".join(vxlan_maps))
    lines += ["  }", "!"]

    return "\n".join(lines) + "\n"


# ── IOS-XE (Catalyst 9k VXLAN EVPN) ─────────────────────────────────────────

def _iosxe_evpn(ctx: dict, layer: str) -> str:
    asn  = ctx.get("bgp_asn", SPINE_ASN)
    vrfs = _vrfs_from_ctx(ctx)
    idx  = ctx.get("index", 1)
    lo_ip = ctx.get("loopback_ip", f"10.0.{idx}.{idx}")

    L: list[str] = []
    L += [
        "!",
        "!-- ╔══════════════════════════════════════════════════╗",
        "!-- ║   EVPN / VXLAN OVERLAY — IOS-XE (Cat 9k)        ║",
        "!-- ╚══════════════════════════════════════════════════╝",
        "!",
    ]

    # L2VNI VLANs
    for vrf in vrfs:
        for vid in vrf["vlans"]:
            L += [f"vlan {vid}", f" name {vrf['name']}-L2"]

    # L3VNI VLANs
    for vrf in vrfs:
        tvlan = 3000 + vrf["idx"]
        L += [f"vlan {tvlan}", f" name L3VNI-{vrf['name']}"]

    # NVE
    L += [
        "!",
        "interface nve1",
        "  no ip address",
        f"  source-interface Loopback1",
        "  host-reachability protocol bgp",
    ]
    for vrf in vrfs:
        for vid in vrf["vlans"]:
            vni = _l2vni(vid)
            L += [f"  member vni {vni}", f"    ingress-replication protocol bgp"]
        l3vni = _l3vni(vrf["idx"])
        L += [f"  member vni {l3vni} vrf {vrf['name']}"]
    L.append("!")

    # VRFs
    for vrf in vrfs:
        l3vni = _l3vni(vrf["idx"])
        rt    = _rt(l3vni)
        L += [
            f"vrf definition {vrf['name']}",
            f"  description {vrf['desc']}",
            f"  vni {l3vni}",
            f"  rd {asn}:{vrf['idx']}",
            "  address-family ipv4",
            f"    route-target import {rt}",
            f"    route-target export {rt}",
            "  exit-address-family",
            "!",
        ]

    # SVIs
    for vrf in vrfs:
        for i, vid in enumerate(vrf["vlans"]):
            L += [
                f"interface Vlan{vid}",
                f"  vrf forwarding {vrf['name']}",
                f"  ip address 10.{vrf['idx']}.{i+1}.1 255.255.255.0",
                f"  no shutdown",
                f"  ip virtual-reassembly",
            ]
        tvlan = 3000 + vrf["idx"]
        L += [
            f"interface Vlan{tvlan}",
            f"  vrf forwarding {vrf['name']}",
            f"  ip unnumbered Loopback0",
            f"  no shutdown",
        ]

    # BGP EVPN community policies
    L += [
        "!",
        f"ip extcommunity-list standard ECL-L2VNI permit rt {COMM['l2vni_export']}",
        f"ip extcommunity-list standard ECL-L3VNI permit rt {COMM['l3vni_export']}",
        f"ip community-list standard CL-BLACKHOLE permit {COMM['blackhole']}",
        f"ip community-list standard CL-LP-PRIMARY permit {COMM['lp_primary']}",
        "!",
        "route-map RM-EVPN-EXPORT permit 10",
        f"  set community {COMM['lp_primary']} additive",
        f"  set extcommunity rt {COMM['l2vni_export']} additive",
        "route-map RM-EVPN-EXPORT permit 20",
        "!",
        "route-map RM-EVPN-IMPORT permit 10",
        "  match community CL-LP-PRIMARY",
        "  set local-preference 200",
        "route-map RM-EVPN-IMPORT permit 20",
        "!",
        "route-map RM-BLACKHOLE permit 10",
        "  match community CL-BLACKHOLE",
        "  set ip next-hop Null0",
        "  set local-preference 1000",
        "route-map RM-BLACKHOLE deny 20",
        "!",
    ]

    # BGP
    L += [
        f"router bgp {asn}",
        f"  bgp router-id {lo_ip}",
        f"  bgp log-neighbor-changes",
        f"  !",
        f"  address-family l2vpn evpn",
    ]
    spine_ips = ctx.get("spine_ips", ["10.0.1.1", "10.0.1.2"])
    for i, sp in enumerate(spine_ips):
        L += [
            f"    neighbor {sp} remote-as {asn}",
            f"    neighbor {sp} update-source Loopback0",
            f"    neighbor {sp} description SPINE-{i+1:02d}-RR",
            f"    neighbor {sp} send-community extended",
            f"    neighbor {sp} activate",
            f"    neighbor {sp} route-map RM-EVPN-EXPORT  out",
            f"    neighbor {sp} route-map RM-EVPN-IMPORT in",
        ]
    L.append("!")
    return "\n".join(L) + "\n"


# ── Junos ────────────────────────────────────────────────────────────────────

def _junos_evpn(ctx: dict, layer: str) -> str:
    asn  = ctx.get("bgp_asn", SPINE_ASN)
    vrfs = _vrfs_from_ctx(ctx)
    is_spine = "spine" in layer
    lo_ip = ctx.get("loopback_ip", "10.0.1.1")

    L: list[str] = []
    L += [
        "#",
        "# ╔══════════════════════════════════════════════════╗",
        "# ║   EVPN / VXLAN OVERLAY — Junos                  ║",
        "# ╚══════════════════════════════════════════════════╝",
        "#",
    ]

    L += [
        "set policy-options community EVPN-L2VNI members "   + COMM['l2vni_export'],
        "set policy-options community EVPN-L3VNI members "   + COMM['l3vni_export'],
        "set policy-options community BLACKHOLE members "     + COMM['blackhole'],
        "set policy-options community LP-PRIMARY members "    + COMM['lp_primary'],
        "#",
    ]

    if is_spine:
        L += [
            "set policy-options policy-statement EVPN-RR-EXPORT term 1 from community LP-PRIMARY",
            "set policy-options policy-statement EVPN-RR-EXPORT term 1 then local-preference 200",
            "set policy-options policy-statement EVPN-RR-EXPORT term 1 then accept",
            "set policy-options policy-statement EVPN-RR-EXPORT term 2 then accept",
            f"set protocols bgp group EVPN-LEAF type internal",
            f"set protocols bgp group EVPN-LEAF local-address {lo_ip}",
            f"set protocols bgp group EVPN-LEAF cluster {lo_ip}",
            f"set protocols bgp group EVPN-LEAF family evpn signaling",
            f"set protocols bgp group EVPN-LEAF import EVPN-RR-EXPORT",
        ]
        for i in range(1, 9):
            leaf_lo = f"10.0.{i}.{i}"
            L.append(f"set protocols bgp group EVPN-LEAF neighbor {leaf_lo}")
    else:
        for vrf in vrfs:
            l3vni = _l3vni(vrf["idx"])
            rt    = _rt(l3vni)
            for vid in vrf["vlans"]:
                vni = _l2vni(vid)
                L += [
                    f"set vlans VLAN{vid} vlan-id {vid}",
                    f"set vlans VLAN{vid} vxlan vni {vni}",
                    f"set vlans VLAN{vid} vxlan ingress-node-replication",
                ]
            L += [
                f"set routing-instances {vrf['name']} instance-type vrf",
                f"set routing-instances {vrf['name']} vrf-target {rt}",
                f"set routing-instances {vrf['name']} protocols evpn ip-prefix-routes advertise direct-nexthop",
                f"set routing-instances {vrf['name']} protocols evpn ip-prefix-routes encapsulation vxlan",
                f"set routing-instances {vrf['name']} protocols evpn ip-prefix-routes vni {l3vni}",
            ]
        spine_ips = ctx.get("spine_ips", ["10.0.1.1", "10.0.1.2"])
        L += [
            "set policy-options policy-statement LEAF-EVPN-EXPORT term 1 from community LP-PRIMARY",
            "set policy-options policy-statement LEAF-EVPN-EXPORT term 1 then accept",
            "set policy-options policy-statement LEAF-EVPN-EXPORT term 2 then accept",
            f"set protocols bgp group EVPN-SPINE type internal",
            f"set protocols bgp group EVPN-SPINE local-address {lo_ip}",
            f"set protocols bgp group EVPN-SPINE family evpn signaling",
            f"set protocols bgp group EVPN-SPINE export LEAF-EVPN-EXPORT",
        ]
        for i, sp in enumerate(spine_ips):
            L.append(f"set protocols bgp group EVPN-SPINE neighbor {sp}")
    L.append("#")
    return "\n".join(L) + "\n"
