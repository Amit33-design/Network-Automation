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
        spine_asn = asn if "spine" in layer else asn - (idx * 10)
        lines += [
            "!-- DC BGP Prefix Filters",
            "ip prefix-list DC-LOOPBACKS seq 5 permit 10.0.0.0/24 le 32",
            "ip prefix-list DC-LOOPBACKS seq 10 permit 10.1.0.0/24 le 32",
            "ip prefix-list VTEP-POOL seq 5 permit 10.1.0.0/16 le 32",
            "ip prefix-list MAX-PREFIXES seq 5 permit 0.0.0.0/0 le 32",
            "!",
            "ip community-list standard EVPN-TYPE2 permit 65000:200",
            "ip community-list standard EVPN-TYPE5 permit 65000:500",
            "ip community-list standard SPINE-ORIGINATED permit 65000:1000",
            "!",
            "route-map LEAF-TO-SPINE permit 10",
            " match ip address prefix-list DC-LOOPBACKS",
            f" set community {COMMUNITIES['local_pref_100']} additive",
            "route-map LEAF-TO-SPINE deny 20",
            "!",
            "route-map SPINE-TO-LEAF permit 10",
            " match community SPINE-ORIGINATED",
            " set local-preference 150",
            "route-map SPINE-TO-LEAF permit 20",
            f" set local-preference 100",
            "!",
            "route-map SET-NEXTHOP-SELF permit 10",
            " set ip next-hop self",
            "!",
            "route-map EVPN-EXPORT permit 10",
            f" set community {COMMUNITIES['local_pref_100']} additive",
            "route-map EVPN-EXPORT permit 20",
            "!",
        ]

    elif uc == "gpu":
        lines += [
            "!-- GPU Fabric BGP Policies",
            "ip prefix-list GPU-LOOPBACKS seq 5 permit 10.200.0.0/16 le 32",
            "ip prefix-list GPU-HOST-ROUTES seq 5 permit 10.220.0.0/16 le 24",
            "!",
            f"ip as-path access-list 50 permit ^{COMMUNITIES['gpu_fabric']}",
            "!",
            "route-map GPU-SPINE-EXPORT permit 10",
            " match ip address prefix-list GPU-LOOPBACKS",
            f" set community {COMMUNITIES['gpu_fabric']} additive",
            "route-map GPU-SPINE-EXPORT permit 20",
            "!",
            "route-map GPU-TOR-IMPORT permit 10",
            " set local-preference 200",
            " set weight 200",
            "!",
            "!-- BFD for fast failover in GPU fabric",
            "bfd slow-timers 2000",
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
        lines += [
            "!-- Prefix lists",
            "ip prefix-list LOOPBACKS seq 5 permit 10.0.0.0/24 le 32",
            "ip prefix-list VTEP-ANYCAST seq 5 permit 10.1.0.0/24 le 32",
            "ip prefix-list DC-HOST-ROUTES seq 5 permit 10.10.0.0/16 le 32",
            "ip prefix-list MGMT-PREFIX seq 5 permit 10.100.0.0/24 le 32",
            "!",
            "!-- Community lists",
            "ip community-list standard EVPN-ROUTES permit 65000:200",
            "ip community-list standard BLACKHOLE permit 65000:9999",
            "ip community-list standard SPINE-REFLECTOR permit 65000:1000",
            "!",
            "!-- AS-path ACLs",
            f"ip as-path access-list 1 permit ^$",
            f"ip as-path access-list 2 permit ^{asn}_",
            "!",
            "!-- Route maps",
            "route-map LOOPBACK-EXPORT permit 10",
            "  match ip address prefix-list LOOPBACKS",
            f" set community {asn}:100 additive",
            "route-map LOOPBACK-EXPORT deny 20",
            "!",
            "route-map PEER-IN-POLICY permit 10",
            "  set local-preference 100",
            "  set weight 100",
            "route-map PEER-IN-POLICY deny 999",
            "!",
            "route-map NEXTHOP-SELF-EVPN permit 10",
            "  match route-type external",
            "  set ip next-hop self",
            "route-map NEXTHOP-SELF-EVPN permit 20",
            "!",
            "route-map EVPN-RR-IMPORT permit 10",
            "  set local-preference 150",
            "route-map EVPN-RR-IMPORT permit 20",
            "!",
            "!-- Max-prefix safety",
            "route-map MAX-PREFIX-WARN permit 10",
            "  description Warn at 80% of max-prefix limit",
            "!",
            "!-- Blackhole community trigger",
            "route-map BLACKHOLE-TRIGGER permit 10",
            "  match community BLACKHOLE",
            "  set ip next-hop null0",
            "  set local-preference 1000",
            "route-map BLACKHOLE-TRIGGER deny 20",
            "!",
        ]

    elif uc == "gpu":
        lines += [
            "!-- GPU Fabric NX-OS BGP Policy",
            "ip prefix-list GPU-FABRIC-LB seq 5 permit 10.200.0.0/16 le 32",
            "!",
            "route-map GPU-FABRIC-OUT permit 10",
            "  match ip address prefix-list GPU-FABRIC-LB",
            f" set community {COMMUNITIES['gpu_fabric']} additive",
            "route-map GPU-FABRIC-OUT permit 20",
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
        lines += [
            "ip prefix-list LOOPBACKS seq 10 permit 10.0.0.0/8 le 32",
            "ip prefix-list VTEP-ANYCAST seq 10 permit 10.1.0.0/16 le 32",
            "ip prefix-list DC-PREFIXES seq 10 permit 10.0.0.0/8 le 24",
            "!",
            "bgp community-list standard EVPN-EXPORTED members 65000:200",
            "bgp community-list standard SPINE-ORIGINATED members 65000:1000",
            "bgp community-list standard BLACKHOLE members 65000:9999",
            "!",
            "route-map LEAF-TO-SPINE permit 10",
            "   match ip address prefix-list LOOPBACKS",
            f"  set community {asn}:100",
            "route-map LEAF-TO-SPINE deny 20",
            "!",
            "route-map SPINE-POLICY permit 10",
            "   set local-preference 150",
            "route-map SPINE-POLICY permit 20",
            "!",
            "route-map EVPN-NH-UNCHANGED permit 10",
            "   set ip next-hop unchanged",
            "!",
            "route-map BLACKHOLE permit 10",
            "   match community BLACKHOLE",
            "   set ip next-hop 192.0.2.1",
            "   set local-preference 5000",
            "route-map BLACKHOLE deny 20",
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
    """SONiC uses FRRouting (FRR) — same syntax as Quagga/VyOS."""
    lines: list[str] = []
    lines.append("!")
    lines.append("! ╔══════════════════════════════════╗")
    lines.append("! ║   BGP POLICY — SONiC/FRR         ║")
    lines.append("! ╚══════════════════════════════════╝")
    lines.append("!")

    lines += [
        "ip prefix-list LOOPBACKS seq 5 permit 10.200.0.0/16 le 32",
        "ip prefix-list GPU-HOSTS seq 5 permit 10.220.0.0/16 le 32",
        "!",
        "bgp community-list standard GPU-FABRIC permit 65200:100",
        "!",
        "route-map GPU-EXPORT permit 10",
        " match ip address prefix-list LOOPBACKS",
        " set community 65200:100 additive",
        "route-map GPU-EXPORT permit 20",
        "!",
        "route-map GPU-IMPORT permit 10",
        " set local-preference 200",
        "!",
    ]

    return "\n".join(lines) + "\n"
