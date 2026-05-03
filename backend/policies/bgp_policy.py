"""
BGP Policy Generator
=====================
Generates platform-aware BGP route policies (prefix-lists, route-maps,
community strings, AS-path filters, max-prefix limits) per use case.

Supported platforms: ios-xe, nxos, eos, junos, sonic
Use cases: campus, dc, gpu, wan, hybrid
"""
from __future__ import annotations
from typing import Any


# ── Use-case BGP ASN ranges ─────────────────────────────────────────────
UC_ASN = {
    "campus":  {"local": 65001, "upstream_pool": [65100, 65101]},
    "dc":      {"local": 65000, "leaf_pool": list(range(65010, 65030)), "spine_pool": [65000]},
    "gpu":     {"local": 65200, "spine_pool": [65200], "tor_pool": list(range(65210, 65220))},
    "wan":     {"local": 65400, "upstream_pool": [64512, 65535]},
    "hybrid":  {"local": 65000, "upstream_pool": [65100]},
}

# ── Community definitions ────────────────────────────────────────────────
COMMUNITIES = {
    "blackhole":   "65000:9999",
    "no_export":   "no-export",
    "no_advertise":"no-advertise",
    "local_pref_100": "65000:100",
    "local_pref_200": "65000:200",
    "backup_path":  "65000:300",
    "gpu_fabric":   "65200:100",
    "internet_out": "65100:10",
}


# ── Platform dispatchers ─────────────────────────────────────────────────

def generate_bgp_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return BGP policy config block for the given device context + platform."""
    uc    = ctx.get("uc", "dc")
    layer = ctx.get("layer", "dc-spine")
    asn   = ctx.get("bgp_asn", 65000)
    idx   = ctx.get("index", 1)

    fn = {
        "ios-xe": _ios_xe_bgp,
        "nxos":   _nxos_bgp,
        "eos":    _eos_bgp,
        "junos":  _junos_bgp,
        "sonic":  _sonic_bgp,
    }.get(platform, _ios_xe_bgp)

    return fn(uc, layer, asn, idx, ctx)


# ── IOS-XE ──────────────────────────────────────────────────────────────

def _ios_xe_bgp(uc: str, layer: str, asn: int, idx: int, ctx: dict) -> str:
    lines: list[str] = []
    lines.append("!")
    lines.append("!-- ╔══════════════════════════════════╗")
    lines.append("!-- ║   BGP POLICY — IOS-XE            ║")
    lines.append("!-- ╚══════════════════════════════════╝")
    lines.append("!")

    if uc in ("campus", "wan"):
        # Campus/WAN: connect to upstream ISP
        lines += [
            "ip prefix-list LOOPBACKS seq 5 permit 10.0.0.0/8 le 32",
            "ip prefix-list LOOPBACKS seq 10 permit 172.16.0.0/12 le 32",
            "ip prefix-list DEFAULT-ONLY seq 5 permit 0.0.0.0/0",
            "ip prefix-list DENY-ALL seq 5 deny 0.0.0.0/0 le 32",
            "!",
            "ip prefix-list RFC1918-DENY seq 5 deny 10.0.0.0/8 le 32",
            "ip prefix-list RFC1918-DENY seq 10 deny 172.16.0.0/12 le 32",
            "ip prefix-list RFC1918-DENY seq 15 deny 192.168.0.0/16 le 32",
            "ip prefix-list RFC1918-DENY seq 20 permit 0.0.0.0/0 le 32",
            "!",
            f"ip as-path access-list 10 permit ^{asn}_",
            "ip as-path access-list 10 deny .*",
            "ip as-path access-list 20 permit .*",
            "!",
            "ip community-list standard LOCAL-ROUTES permit 65001:100",
            "ip community-list standard BLACKHOLE permit 65000:9999",
            "!",
            "route-map EXPORT-TO-UPSTREAM permit 10",
            " match community LOCAL-ROUTES",
            " set community no-export additive",
            "route-map EXPORT-TO-UPSTREAM deny 20",
            " match ip address prefix-list RFC1918-DENY",
            "route-map EXPORT-TO-UPSTREAM permit 30",
            "!",
            "route-map IMPORT-FROM-UPSTREAM permit 10",
            " match ip address prefix-list DEFAULT-ONLY",
            " set local-preference 200",
            "route-map IMPORT-FROM-UPSTREAM deny 20",
            " match ip address prefix-list RFC1918-DENY",
            "route-map IMPORT-FROM-UPSTREAM permit 30",
            "!",
            "route-map BLACKHOLE-TRIGGER permit 10",
            " match community BLACKHOLE",
            " set ip next-hop 192.0.2.1",
            " set local-preference 1000",
            "!",
        ]

    elif uc in ("dc", "hybrid"):
        is_spine = "spine" in layer
        # L2VNI/L3VNI RT scheme: SPINE_ASN:VNI
        lines += [
            "!-- ── DC / EVPN BGP Policy (IOS-XE) ─────────────────────────",
            "!",
            "!-- Prefix lists",
            "ip prefix-list DC-LOOPBACKS seq 5  permit 10.0.0.0/24 le 32",
            "ip prefix-list DC-LOOPBACKS seq 10 permit 10.1.0.0/24 le 32",
            "ip prefix-list VTEP-POOL    seq 5  permit 10.1.0.0/16 le 32",
            "ip prefix-list HOST-ROUTES  seq 5  permit 10.10.0.0/16 le 32",
            "ip prefix-list DENY-ALL     seq 5  deny   0.0.0.0/0 le 32",
            "!",
            "!-- Standard community lists (TE colouring)",
            f"ip community-list standard CL-LP-PRIMARY permit {COMMUNITIES['local_pref_100']}",
            f"ip community-list standard CL-LP-BACKUP  permit {COMMUNITIES['backup_path']}",
            f"ip community-list standard CL-BLACKHOLE  permit {COMMUNITIES['blackhole']}",
            f"ip community-list standard CL-NO-EXPORT  permit no-export",
            f"ip community-list standard CL-SPINE-ORIG permit 65000:1000",
            "!",
            "!-- Extended community lists for EVPN route-target matching",
            "ip extcommunity-list standard ECL-L2VNI permit rt 65000:200",
            "ip extcommunity-list standard ECL-L3VNI permit rt 65000:500",
            "ip extcommunity-list standard ECL-ANY   permit rt 65000:0",
            "!",
            "!-- AS-path ACLs",
            f"ip as-path access-list 1 permit ^$",
            f"ip as-path access-list 2 permit ^{asn}_",
            "ip as-path access-list 3 deny .*",
            "!",
        ]

        if is_spine:
            lines += [
                "!-- Spine → Leaf  (RR reflector — iBGP )",
                "route-map RM-RR-TO-LEAF permit 10",
                f"  description Reflect with spine-originated community",
                f"  set community {COMMUNITIES['local_pref_100']} {COMMUNITIES['local_pref_100'].replace('100','1000')} additive",
                "route-map RM-RR-TO-LEAF permit 20",
                "!",
                "route-map RM-LEAF-TO-RR permit 10",
                f"  description Accept loopbacks — LP=200",
                f"  match ip address prefix-list DC-LOOPBACKS",
                f"  set local-preference 200",
                "route-map RM-LEAF-TO-RR permit 20",
                f"  description Accept all EVPN routes — LP=100",
                f"  set local-preference 100",
                "!",
                "!-- Blackhole: RTBH triggered by community 65000:9999",
                "route-map RM-BLACKHOLE permit 10",
                f"  match community CL-BLACKHOLE",
                f"  set ip next-hop Null0",
                f"  set local-preference 5000",
                "route-map RM-BLACKHOLE deny 20",
                "!",
                "!-- EVPN NH unchanged (spine reflects without NH change)",
                "route-map RM-EVPN-NH-UNCHANGED permit 10",
                "  set ip next-hop unchanged",
                "!",
            ]
        else:
            lines += [
                "!-- Leaf → Spine EVPN export route-map",
                "route-map RM-LEAF-EVPN-EXPORT permit 10",
                f"  description Tag loopback/VTEP routes as primary path",
                f"  match ip address prefix-list DC-LOOPBACKS",
                f"  set community {COMMUNITIES['local_pref_100']} additive",
                f"  set extcommunity rt 65000:200 additive",
                "route-map RM-LEAF-EVPN-EXPORT permit 20",
                f"  description Tag host routes",
                f"  match ip address prefix-list HOST-ROUTES",
                f"  set community {COMMUNITIES['local_pref_100']} additive",
                f"  set extcommunity rt 65000:500 additive",
                "route-map RM-LEAF-EVPN-EXPORT deny 30",
                f"  description Deny all other (no leaking between VRFs)",
                "!",
                "!-- Spine → Leaf EVPN import route-map",
                "route-map RM-SPINE-EVPN-IMPORT permit 10",
                f"  description Primary path from spine (LP=200)",
                f"  match community CL-LP-PRIMARY",
                f"  set local-preference 200",
                "route-map RM-SPINE-EVPN-IMPORT permit 20",
                f"  description Backup path (LP=100)",
                f"  match community CL-LP-BACKUP",
                f"  set local-preference 100",
                "route-map RM-SPINE-EVPN-IMPORT permit 30",
                f"  description Accept remaining EVPN routes",
                "!",
                "!-- RTBH blackhole trigger",
                "route-map RM-BLACKHOLE permit 10",
                f"  match community CL-BLACKHOLE",
                f"  set ip next-hop Null0",
                f"  set local-preference 5000",
                "route-map RM-BLACKHOLE deny 20",
                "!",
                "!-- ECMP next-hop self for iBGP",
                "route-map RM-NEXTHOP-SELF permit 10",
                f"  match route-type external",
                f"  set ip next-hop self",
                "route-map RM-NEXTHOP-SELF permit 20",
                "!",
            ]

    elif uc == "gpu":
        is_spine = "spine" in layer
        lines += [
            "!-- ── GPU Fabric BGP Policies (IOS-XE) ──────────────────────",
            "!",
            "ip prefix-list GPU-LOOPBACKS   seq 5 permit 10.200.0.0/16 le 32",
            "ip prefix-list GPU-HOST-ROUTES seq 5 permit 10.220.0.0/16 le 32",
            "ip prefix-list GPU-TOR-ANYCAST seq 5 permit 10.3.0.0/16   le 32",
            "!",
            f"ip community-list standard CL-GPU-FABRIC permit {COMMUNITIES['gpu_fabric']}",
            f"ip community-list standard CL-LP-PRIMARY  permit {COMMUNITIES['local_pref_100']}",
            f"ip community-list standard CL-BLACKHOLE   permit {COMMUNITIES['blackhole']}",
            "!",
        ]
        if is_spine:
            lines += [
                "route-map RM-TOR-TO-SPINE permit 10",
                " match ip address prefix-list GPU-LOOPBACKS",
                f" set community {COMMUNITIES['gpu_fabric']} {COMMUNITIES['local_pref_100']} additive",
                "route-map RM-TOR-TO-SPINE permit 20",
                " match ip address prefix-list GPU-HOST-ROUTES",
                f" set community {COMMUNITIES['gpu_fabric']} additive",
                "route-map RM-TOR-TO-SPINE deny 30",
                "!",
                "route-map RM-SPINE-TO-TOR permit 10",
                " match community CL-LP-PRIMARY",
                " set local-preference 200",
                "route-map RM-SPINE-TO-TOR permit 20",
                "!",
            ]
        else:
            lines += [
                "route-map RM-TOR-EXPORT permit 10",
                " match ip address prefix-list GPU-LOOPBACKS",
                f" set community {COMMUNITIES['gpu_fabric']} {COMMUNITIES['local_pref_100']} additive",
                "route-map RM-TOR-EXPORT permit 20",
                " match ip address prefix-list GPU-HOST-ROUTES",
                f" set community {COMMUNITIES['gpu_fabric']} additive",
                "route-map RM-TOR-EXPORT deny 30",
                "!",
                "route-map RM-SPINE-IMPORT permit 10",
                " match community CL-LP-PRIMARY",
                " set local-preference 200",
                "route-map RM-SPINE-IMPORT permit 20",
                "!",
                "route-map RM-HOST-IMPORT permit 10",
                " match ip address prefix-list GPU-HOST-ROUTES",
                " set local-preference 200",
                "route-map RM-HOST-IMPORT deny 20",
                "!",
            ]
        lines += [
            "!-- BFD for sub-second GPU fabric failover",
            "bfd slow-timers 2000",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_bgp(uc: str, layer: str, asn: int, idx: int, ctx: dict) -> str:
    lines: list[str] = []
    lines.append("!")
    lines.append("!-- ╔══════════════════════════════════╗")
    lines.append("!-- ║   BGP POLICY — NX-OS             ║")
    lines.append("!-- ╚══════════════════════════════════╝")
    lines.append("!")

    if uc in ("dc", "hybrid"):
        is_spine = "spine" in layer
        lines += [
            "!-- ── DC / EVPN BGP Policy (NX-OS) ──────────────────────────",
            "!",
            "!-- Prefix lists",
            "ip prefix-list LOOPBACKS     seq 5  permit 10.0.0.0/24 le 32",
            "ip prefix-list VTEP-ANYCAST  seq 5  permit 10.1.0.0/24 le 32",
            "ip prefix-list DC-HOST-ROUTES seq 5 permit 10.10.0.0/16 le 32",
            "ip prefix-list MGMT-PREFIX   seq 5  permit 10.100.0.0/24 le 32",
            "ip prefix-list DENY-ALL      seq 5  deny   0.0.0.0/0 le 32",
            "!",
            "!-- Standard community lists (TE colouring)",
            f"ip community-list standard CL-LP-PRIMARY permit {asn}:100",
            f"ip community-list standard CL-LP-BACKUP  permit {asn}:300",
            f"ip community-list standard CL-BLACKHOLE  permit {asn}:9999",
            f"ip community-list standard CL-SPINE-ORIG permit {asn}:1000",
            f"ip community-list standard CL-L2VNI      permit {asn}:200",
            f"ip community-list standard CL-L3VNI      permit {asn}:500",
            "!",
            "!-- Extended community lists for EVPN RT matching",
            f"ip extcommunity-list standard ECL-L2VNI permit rt {asn}:200",
            f"ip extcommunity-list standard ECL-L3VNI permit rt {asn}:500",
        ]
        # Per-VNI extended community lists (VLAN 10..30 → VNI 10010..10030)
        for vlan_id in [10, 11, 20, 21, 30]:
            vni = 10000 + vlan_id
            lines.append(
                f"ip extcommunity-list standard ECL-VNI-{vni} permit rt {asn}:{vni}"
            )
        lines.append("!")

        if is_spine:
            lines += [
                "!-- AS-path ACLs",
                "ip as-path access-list 1 permit ^$",
                f"ip as-path access-list 2 permit ^{asn}_",
                "!",
                "!-- Spine RR: reflect with no NH change, tag spine-originated",
                "route-map RM-RR-TO-LEAF permit 10",
                f"  set community {asn}:1000 additive",
                "route-map RM-RR-TO-LEAF permit 20",
                "!",
                "route-map RM-LEAF-TO-RR permit 10",
                "  match ip address prefix-list LOOPBACKS",
                "  set local-preference 200",
                "route-map RM-LEAF-TO-RR permit 20",
                "  set local-preference 100",
                "!",
                "!-- EVPN NH unchanged for RR reflection",
                "route-map NEXTHOP-SELF-EVPN permit 10",
                "  match route-type external",
                "  set ip next-hop self",
                "route-map NEXTHOP-SELF-EVPN permit 20",
                "!",
                "!-- Blackhole RTBH",
                "route-map BLACKHOLE-TRIGGER permit 10",
                "  match community CL-BLACKHOLE",
                "  set ip next-hop null0",
                "  set local-preference 5000",
                "route-map BLACKHOLE-TRIGGER deny 20",
                "!",
                "!-- Max-prefix safety marker (applied on spine per-peer)",
                "route-map MAX-PREFIX-WARN permit 10",
                "  description Trigger warning at 80% of max-prefix limit",
                "!",
            ]
        else:
            lines += [
                "!-- Leaf → Spine EVPN export",
                "route-map RM-LEAF-EVPN-EXPORT permit 10",
                "  description Tag loopbacks/VTEPs — primary path",
                "  match ip address prefix-list LOOPBACKS",
                f"  set community {asn}:100 additive",
                f"  set extcommunity rt {asn}:200 additive",
                "route-map RM-LEAF-EVPN-EXPORT permit 20",
                "  description Tag host routes — L3VNI prefix advertisement",
                "  match ip address prefix-list DC-HOST-ROUTES",
                f"  set community {asn}:100 additive",
                f"  set extcommunity rt {asn}:500 additive",
                "route-map RM-LEAF-EVPN-EXPORT deny 30",
                "  description Drop everything else",
                "!",
                "!-- Spine → Leaf EVPN import",
                "route-map RM-SPINE-EVPN-IMPORT permit 10",
                "  description Spine-originated → LP=200",
                "  match community CL-SPINE-ORIG",
                "  set local-preference 200",
                "route-map RM-SPINE-EVPN-IMPORT permit 20",
                "  description Primary-tagged → LP=200",
                "  match community CL-LP-PRIMARY",
                "  set local-preference 200",
                "route-map RM-SPINE-EVPN-IMPORT permit 30",
                "  description Backup-tagged → LP=100",
                "  match community CL-LP-BACKUP",
                "  set local-preference 100",
                "route-map RM-SPINE-EVPN-IMPORT permit 40",
                "  description Accept remaining EVPN routes",
                "!",
                "!-- ECMP next-hop self for iBGP",
                "route-map NEXTHOP-SELF-EVPN permit 10",
                "  match route-type external",
                "  set ip next-hop self",
                "route-map NEXTHOP-SELF-EVPN permit 20",
                "!",
                "!-- RTBH blackhole trigger",
                "route-map BLACKHOLE-TRIGGER permit 10",
                "  match community CL-BLACKHOLE",
                "  set ip next-hop null0",
                "  set local-preference 5000",
                "route-map BLACKHOLE-TRIGGER deny 20",
                "!",
                "!-- Loopback export for underlay reachability",
                "route-map LOOPBACK-EXPORT permit 10",
                "  match ip address prefix-list LOOPBACKS",
                f"  set community {asn}:100 additive",
                "route-map LOOPBACK-EXPORT deny 20",
                "!",
            ]

    elif uc == "gpu":
        is_spine = "spine" in layer
        lines += [
            "!-- ── GPU Fabric BGP Policy (NX-OS) ─────────────────────────",
            "!",
            "ip prefix-list GPU-LOOPBACKS   seq 5 permit 10.200.0.0/16 le 32",
            "ip prefix-list GPU-HOST-ROUTES seq 5 permit 10.220.0.0/16 le 32",
            "ip prefix-list GPU-TOR-ANYCAST seq 5 permit 10.3.0.0/16   le 32",
            "!",
            f"ip community-list standard CL-GPU-FABRIC permit {COMMUNITIES['gpu_fabric']}",
            f"ip community-list standard CL-LP-PRIMARY permit {COMMUNITIES['local_pref_100']}",
            f"ip community-list standard CL-BLACKHOLE  permit {COMMUNITIES['blackhole']}",
            "!",
        ]
        if is_spine:
            lines += [
                "route-map RM-TOR-TO-SPINE permit 10",
                "  description Accept TOR loopbacks — tag GPU fabric community",
                "  match ip address prefix-list GPU-LOOPBACKS",
                f"  set community {COMMUNITIES['gpu_fabric']} {COMMUNITIES['local_pref_100']} additive",
                "route-map RM-TOR-TO-SPINE permit 20",
                "  description Accept host routes — tag GPU fabric",
                "  match ip address prefix-list GPU-HOST-ROUTES",
                f"  set community {COMMUNITIES['gpu_fabric']} additive",
                "route-map RM-TOR-TO-SPINE deny 30",
                "!",
                "route-map RM-SPINE-TO-TOR permit 10",
                "  match community CL-LP-PRIMARY",
                "  set local-preference 200",
                "route-map RM-SPINE-TO-TOR permit 20",
                "!",
            ]
        else:
            lines += [
                "route-map RM-TOR-EXPORT permit 10",
                "  description Advertise loopback to GPU spine",
                "  match ip address prefix-list GPU-LOOPBACKS",
                f"  set community {COMMUNITIES['gpu_fabric']} {COMMUNITIES['local_pref_100']} additive",
                "route-map RM-TOR-EXPORT permit 20",
                "  description Advertise GPU host routes",
                "  match ip address prefix-list GPU-HOST-ROUTES",
                f"  set community {COMMUNITIES['gpu_fabric']} additive",
                "route-map RM-TOR-EXPORT deny 30",
                "!",
                "route-map RM-SPINE-IMPORT permit 10",
                "  match community CL-LP-PRIMARY",
                "  set local-preference 200",
                "route-map RM-SPINE-IMPORT permit 20",
                "!",
                "route-map RM-HOST-IMPORT permit 10",
                "  description Accept GPU host /32 loopbacks",
                "  match ip address prefix-list GPU-HOST-ROUTES",
                "  set local-preference 200",
                "route-map RM-HOST-IMPORT deny 20",
                "!",
            ]

    return "\n".join(lines) + "\n"


# ── EOS ─────────────────────────────────────────────────────────────────

def _eos_bgp(uc: str, layer: str, asn: int, idx: int, ctx: dict) -> str:
    lines: list[str] = []
    lines.append("!")
    lines.append("! ╔══════════════════════════════════╗")
    lines.append("! ║   BGP POLICY — Arista EOS        ║")
    lines.append("! ╚══════════════════════════════════╝")
    lines.append("!")

    if uc in ("dc", "gpu", "hybrid"):
        is_spine = "spine" in layer
        lines += [
            "! ── DC / EVPN BGP Policy (EOS) ───────────────────────────────",
            "!",
            "ip prefix-list LOOPBACKS     seq 10 permit 10.0.0.0/24 le 32",
            "ip prefix-list VTEP-ANYCAST  seq 10 permit 10.1.0.0/16 le 32",
            "ip prefix-list DC-HOST-ROUTES seq 10 permit 10.10.0.0/16 le 32",
            "ip prefix-list GPU-HOST-ROUTES seq 10 permit 10.220.0.0/16 le 32",
            "!",
            "! Standard community lists",
            f"ip community-list standard CL-LP-PRIMARY  permit {asn}:100",
            f"ip community-list standard CL-LP-BACKUP   permit {asn}:300",
            f"ip community-list standard CL-BLACKHOLE   permit {asn}:9999",
            f"ip community-list standard CL-SPINE-ORIG  permit {asn}:1000",
            f"ip community-list standard CL-GPU-FABRIC  permit 65200:100",
            "!",
        ]

        if is_spine:
            lines += [
                "! Spine RR: reflect with NH unchanged, tag spine-originated",
                "route-map RM-LEAF-TO-RR permit 10",
                "   match ip address prefix-list LOOPBACKS",
                "   set local-preference 200",
                "route-map RM-LEAF-TO-RR permit 20",
                "   set local-preference 100",
                "!",
                "route-map RM-RR-TO-LEAF permit 10",
                f"  set community {asn}:1000 additive",
                "route-map RM-RR-TO-LEAF permit 20",
                "!",
                "route-map RM-EVPN-NH-UNCHANGED permit 10",
                "   set ip next-hop unchanged",
                "!",
                "route-map RM-BLACKHOLE permit 10",
                "   match community CL-BLACKHOLE",
                "   set ip next-hop 192.0.2.1",
                "   set local-preference 5000",
                "route-map RM-BLACKHOLE deny 20",
                "!",
            ]
        else:
            lines += [
                "! Leaf → Spine EVPN export (tag LP=200 + L2VNI RT)",
                "route-map RM-LEAF-EVPN-EXPORT permit 10",
                "   match ip address prefix-list LOOPBACKS",
                f"  set community {asn}:100 additive",
                f"  set extcommunity rt {asn}:200 additive",
                "route-map RM-LEAF-EVPN-EXPORT permit 20",
                "   match ip address prefix-list DC-HOST-ROUTES",
                f"  set community {asn}:100 additive",
                f"  set extcommunity rt {asn}:500 additive",
                "route-map RM-LEAF-EVPN-EXPORT deny 30",
                "!",
                "! Spine → Leaf EVPN import (LP from community colour)",
                "route-map RM-SPINE-EVPN-IMPORT permit 10",
                "   match community CL-SPINE-ORIG",
                "   set local-preference 200",
                "route-map RM-SPINE-EVPN-IMPORT permit 20",
                "   match community CL-LP-PRIMARY",
                "   set local-preference 200",
                "route-map RM-SPINE-EVPN-IMPORT permit 30",
                "   match community CL-LP-BACKUP",
                "   set local-preference 100",
                "route-map RM-SPINE-EVPN-IMPORT permit 40",
                "!",
                "route-map RM-EVPN-NH-UNCHANGED permit 10",
                "   set ip next-hop unchanged",
                "!",
                "route-map RM-BLACKHOLE permit 10",
                "   match community CL-BLACKHOLE",
                "   set ip next-hop 192.0.2.1",
                "   set local-preference 5000",
                "route-map RM-BLACKHOLE deny 20",
                "!",
            ]

    return "\n".join(lines) + "\n"


# ── Junos ────────────────────────────────────────────────────────────────

def _junos_bgp(uc: str, layer: str, asn: int, idx: int, ctx: dict) -> str:
    lines: list[str] = []
    lines.append("#")
    lines.append("# ╔══════════════════════════════════╗")
    lines.append("# ║   BGP POLICY — Junos             ║")
    lines.append("# ╚══════════════════════════════════╝")
    lines.append("#")

    lines += [
        "policy-options {",
        "    prefix-list LOOPBACKS {",
        "        10.0.0.0/8;",
        "    }",
        "    prefix-list DC-PREFIXES {",
        "        10.0.0.0/8 upto /24;",
        "    }",
        "    prefix-list DEFAULT-ROUTE {",
        "        0.0.0.0/0;",
        "    }",
        "    community EVPN-ROUTES members 65000:200;",
        "    community BLACKHOLE members 65000:9999;",
        "    community LOCAL-PREF-200 members 65000:200;",
        "    policy-statement EXPORT-LOOPBACKS {",
        "        term ACCEPT-LOOPBACKS {",
        "            from {",
        "                prefix-list LOOPBACKS;",
        "                protocol direct;",
        "            }",
        "            then accept;",
        "        }",
        "        term REJECT-ALL {",
        "            then reject;",
        "        }",
        "    }",
        "    policy-statement IMPORT-BGP {",
        "        term SET-LOCAL-PREF {",
        "            from community EVPN-ROUTES;",
        "            then {",
        "                local-preference 150;",
        "                accept;",
        "            }",
        "        }",
        "        term BLACKHOLE-TRIGGER {",
        "            from community BLACKHOLE;",
        "            then {",
        "                local-preference 5000;",
        "                next-hop discard;",
        "                accept;",
        "            }",
        "        }",
        "        term DEFAULT-ACCEPT {",
        "            then accept;",
        "        }",
        "    }",
        "    policy-statement EVPN-EXPORT {",
        "        term EVPN-ROUTES {",
        "            from {",
        "                protocol bgp;",
        "                community EVPN-ROUTES;",
        "            }",
        "            then accept;",
        "        }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ────────────────────────────────────────────────────────────────

def _sonic_bgp(uc: str, layer: str, asn: int, idx: int, ctx: dict) -> str:
    """SONiC uses FRRouting (FRR) — same syntax as Quagga/VyOS BGP."""
    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════╗",
        "! ║   BGP POLICY — SONiC/FRR         ║",
        "! ╚══════════════════════════════════╝",
        "!",
    ]

    if uc == "gpu":
        lines += [
            "! ── GPU Fabric SONiC TOR BGP Policy ──────────────────────────",
            "!",
            "! Prefix lists",
            "ip prefix-list TOR-LOOPBACKS    seq 5  permit 10.200.0.0/16 le 32",
            "ip prefix-list GPU-HOST-ROUTES  seq 5  permit 10.220.0.0/16 le 32",
            "ip prefix-list GPU-SPINE-LB     seq 5  permit 10.3.0.0/16   le 32",
            "ip prefix-list DENY-ALL         seq 5  deny   0.0.0.0/0 le 32",
            "!",
            "! Community lists",
            f"bgp community-list standard CL-GPU-FABRIC  permit 65200:100",
            f"bgp community-list standard CL-LP-PRIMARY  permit 65200:200",
            f"bgp community-list standard CL-BLACKHOLE   permit 65200:9999",
            "!",
            "! FROM-SPINE (inbound from GPU spine) — set LP from community",
            "route-map FROM-SPINE permit 10",
            " match community CL-LP-PRIMARY",
            " set local-preference 200",
            "route-map FROM-SPINE permit 20",
            " set local-preference 100",
            "!",
            "! TO-SPINE (outbound to GPU spine) — tag TOR loopback + host routes",
            "route-map TO-SPINE permit 10",
            " match ip address prefix-list TOR-LOOPBACKS",
            " set community 65200:100 65200:200 additive",
            "route-map TO-SPINE permit 20",
            " match ip address prefix-list GPU-HOST-ROUTES",
            " set community 65200:100 additive",
            "route-map TO-SPINE deny 30",
            "!",
            "! FROM-GPU-HOST (inbound from H100 server BGP session)",
            "! Accept only /32 host loopbacks — strict prefix limit enforced per peer",
            "route-map FROM-GPU-HOST permit 10",
            " match ip address prefix-list GPU-HOST-ROUTES",
            " set local-preference 200",
            " set community 65200:100 additive",
            "route-map FROM-GPU-HOST deny 20",
            "!",
            "! TO-GPU-HOST (outbound to H100 server)",
            "! Advertise only the default route and TOR loopback for reachability",
            "route-map TO-GPU-HOST permit 10",
            " match ip address prefix-list TOR-LOOPBACKS",
            "route-map TO-GPU-HOST permit 20",
            " match ip address prefix-list GPU-SPINE-LB",
            "route-map TO-GPU-HOST deny 30",
            "!",
            "! RTBH blackhole trigger",
            "route-map BLACKHOLE-TRIGGER permit 10",
            " match community CL-BLACKHOLE",
            " set ip next-hop blackhole",
            " set local-preference 5000",
            "route-map BLACKHOLE-TRIGGER deny 20",
            "!",
            "! BFD fast failover for GPU fabric (critical for RDMA jobs)",
            "bfd",
            "!",
        ]

    elif uc in ("dc", "hybrid"):
        lines += [
            "! ── DC EVPN SONiC TOR BGP Policy (FRR) ──────────────────────",
            "!",
            "ip prefix-list LOOPBACKS      seq 5  permit 10.0.0.0/24 le 32",
            "ip prefix-list VTEP-ANYCAST   seq 5  permit 10.1.0.0/24 le 32",
            "ip prefix-list DC-HOST-ROUTES seq 5  permit 10.10.0.0/16 le 32",
            "!",
            f"bgp community-list standard CL-LP-PRIMARY permit {asn}:100",
            f"bgp community-list standard CL-LP-BACKUP  permit {asn}:300",
            f"bgp community-list standard CL-BLACKHOLE  permit {asn}:9999",
            f"bgp community-list standard CL-SPINE-ORIG permit {asn}:1000",
            "!",
            "route-map RM-LEAF-EVPN-EXPORT permit 10",
            " match ip address prefix-list LOOPBACKS",
            f" set community {asn}:100 additive",
            f" set extcommunity rt {asn}:200 additive",
            "route-map RM-LEAF-EVPN-EXPORT permit 20",
            " match ip address prefix-list DC-HOST-ROUTES",
            f" set community {asn}:100 additive",
            f" set extcommunity rt {asn}:500 additive",
            "route-map RM-LEAF-EVPN-EXPORT deny 30",
            "!",
            "route-map RM-SPINE-EVPN-IMPORT permit 10",
            " match community CL-SPINE-ORIG",
            " set local-preference 200",
            "route-map RM-SPINE-EVPN-IMPORT permit 20",
            " match community CL-LP-PRIMARY",
            " set local-preference 200",
            "route-map RM-SPINE-EVPN-IMPORT permit 30",
            "!",
        ]

    else:
        lines += [
            "ip prefix-list LOOPBACKS seq 5 permit 10.0.0.0/8 le 32",
            "!",
            "route-map EXPORT permit 10",
            " match ip address prefix-list LOOPBACKS",
            "route-map EXPORT permit 20",
            "!",
        ]

    return "\n".join(lines) + "\n"
