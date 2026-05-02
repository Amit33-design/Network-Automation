"""
Static Routing Policy Generator
==================================
Generates static routes per layer / use case:
  - Default route (upstream / FW handoff)
  - Management VRF static (NX-OS / EOS)
  - Floating static backup paths
  - Summarisation routes toward core
  - Null0 discard routes (blackhole aggregates)
  - IPv6 default (when dual-stack enabled)

Platforms: ios-xe, nxos, eos, junos, sonic
"""
from __future__ import annotations
from typing import Any


def generate_static_routing(ctx: dict[str, Any], platform: str) -> str:
    """Return static route config block for device context + platform."""
    fn = {
        "ios-xe": _ios_xe_static,
        "nxos":   _nxos_static,
        "eos":    _eos_static,
        "junos":  _junos_static,
        "sonic":  _sonic_static,
    }.get(platform, _ios_xe_static)
    return fn(ctx)


# ── Shared helpers ────────────────────────────────────────────────────────

def _mgmt_gw(ctx: dict) -> str:
    """Derive management gateway from mgmt_ip (replace last octet with .1)."""
    ip = ctx.get("mgmt_ip", "10.100.1.1")
    parts = ip.split(".")
    parts[-1] = "1"
    return ".".join(parts)

def _is_dc(ctx: dict) -> bool:
    return ctx.get("uc", "") in ("dc", "hybrid", "multisite")

def _is_campus(ctx: dict) -> bool:
    return ctx.get("uc", "") in ("campus", "hybrid")

def _is_gpu(ctx: dict) -> bool:
    return ctx.get("uc", "") == "gpu"

def _is_wan(ctx: dict) -> bool:
    return ctx.get("uc", "") == "wan"


# ── IOS-XE ───────────────────────────────────────────────────────────────

def _ios_xe_static(ctx: dict) -> str:
    layer   = ctx.get("layer", "campus-access")
    mgmt_gw = _mgmt_gw(ctx)
    fw_ip   = ctx.get("fw_ip", "10.0.0.1")
    idx     = ctx.get("index", 1)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════╗",
        "!-- ║   STATIC ROUTING — IOS-XE            ║",
        "!-- ╚══════════════════════════════════════╝",
        "!",
        "!-- Management default (out-of-band)",
        f"ip route 0.0.0.0 0.0.0.0 {mgmt_gw} 250 name MGMT-DEFAULT-OOB",
        "!",
    ]

    if _is_campus(ctx):
        if "core" in layer or "dist" in layer:
            lines += [
                "!-- Core/Distribution: default toward firewall",
                f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 1 name DEFAULT-TO-FW",
                f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 2 name DEFAULT-TO-FW-FLOAT track 1",
                "!",
                "!-- Summary toward campus access layer",
                "ip route 192.168.0.0 255.255.0.0 Null0 254 name CAMPUS-AGGREGATE-DISCARD",
                "ip route 10.100.0.0 255.255.0.0 Null0 254 name MGMT-AGGREGATE-DISCARD",
                "!",
                "!-- IP SLA + tracking for floating static",
                f"ip sla 1",
                f" icmp-echo {fw_ip} source-interface Loopback0",
                " frequency 5",
                "ip sla schedule 1 life forever start-time now",
                "track 1 ip sla 1 reachability",
                "!",
            ]
        elif "access" in layer:
            lines += [
                "!-- Access: only management default (data via L2/STP)",
                f"ip route 10.100.0.0 255.255.0.0 {mgmt_gw} 1 name MGMT-RETURN",
                "!",
            ]

    elif _is_dc(ctx):
        if "spine" in layer:
            lines += [
                "!-- DC Spine: default toward exit/border leaf",
                f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 1 name DC-DEFAULT-EXIT",
                f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 10 name DC-DEFAULT-FLOAT",
                "!",
                "!-- DC aggregate discard routes (prevent routing loops)",
                "ip route 10.0.0.0 255.0.0.0 Null0 254 name DC-AGGREGATE-DISCARD",
                "ip route 172.16.0.0 255.240.0.0 Null0 254 name RFC1918-AGGREGATE",
                "!",
            ]
        else:
            lines += [
                "!-- DC Leaf: no static defaults (BGP EVPN provides reachability)",
                f"ip route 10.100.0.0 255.255.0.0 {mgmt_gw} 250 name MGMT-OOB",
                "!",
            ]

    elif _is_gpu(ctx):
        lines += [
            "!-- GPU Fabric: default to spine for out-of-fabric traffic",
            f"ip route 0.0.0.0 0.0.0.0 10.200.0.1 1 name GPU-DEFAULT",
            f"ip route 10.200.0.0 255.255.0.0 Null0 254 name GPU-FABRIC-AGGREGATE",
            "!",
        ]

    elif _is_wan(ctx):
        lines += [
            "!-- WAN: default route + specific statics for MPLS handoff",
            f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 1 name WAN-DEFAULT-PRIMARY",
            f"ip route 0.0.0.0 0.0.0.0 {fw_ip} 10 name WAN-DEFAULT-SECONDARY",
            "!",
            "!-- WAN aggregate toward HQ",
            "ip route 10.0.0.0 255.0.0.0 Null0 100 name WAN-SUMMARY-DISCARD",
            "!",
        ]

    # IPv6 dual-stack default (optional)
    if "ipv6" in ctx.get("protocols", []):
        lines += [
            "!-- IPv6 static default",
            "ipv6 unicast-routing",
            f"ipv6 route ::/0 {ctx.get('fw_ipv6', 'fe80::1')} 1",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_static(ctx: dict) -> str:
    layer   = ctx.get("layer", "dc-leaf")
    mgmt_gw = _mgmt_gw(ctx)
    fw_ip   = ctx.get("fw_ip", "10.0.0.1")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════╗",
        "!-- ║   STATIC ROUTING — NX-OS             ║",
        "!-- ╚══════════════════════════════════════╝",
        "!",
        "!-- Management VRF default (out-of-band)",
        "vrf context management",
        f"  ip route 0.0.0.0/0 {mgmt_gw}",
        "!",
    ]

    if "spine" in layer or _is_dc(ctx):
        lines += [
            "!-- DC in-band defaults (fabric VRF)",
            f"ip route 0.0.0.0/0 {fw_ip} 1 name DC-DEFAULT",
            "!",
            "!-- Discard aggregates to prevent routing loops",
            "ip route 10.0.0.0/8 Null0 254 name DC-RFC1918-DISCARD",
            "ip route 172.16.0.0/12 Null0 254 name DC-RFC1918-DISCARD",
            "!",
        ]

    if _is_gpu(ctx):
        lines += [
            "!-- GPU fabric static",
            f"ip route 0.0.0.0/0 10.200.0.1 1 name GPU-DEFAULT",
            "ip route 10.200.0.0/16 Null0 254 name GPU-AGGREGATE",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── EOS ──────────────────────────────────────────────────────────────────

def _eos_static(ctx: dict) -> str:
    layer   = ctx.get("layer", "dc-spine")
    mgmt_gw = _mgmt_gw(ctx)
    fw_ip   = ctx.get("fw_ip", "10.0.0.1")

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════╗",
        "! ║   STATIC ROUTING — Arista EOS        ║",
        "! ╚══════════════════════════════════════╝",
        "!",
        "!-- Management VRF default",
        "vrf instance MGMT",
        f"ip route vrf MGMT 0.0.0.0/0 {mgmt_gw}",
        "!",
    ]

    if "spine" in layer or _is_gpu(ctx):
        lines += [
            f"ip route 0.0.0.0/0 {fw_ip} 1 name DC-DEFAULT",
            "ip route 10.0.0.0/8 Null0 254 name AGGREGATE-DISCARD",
            "!",
        ]

    if _is_gpu(ctx):
        lines += [
            "ip route 10.200.0.0/16 Null0 254 name GPU-FABRIC-AGGREGATE",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── Junos ─────────────────────────────────────────────────────────────────

def _junos_static(ctx: dict) -> str:
    mgmt_gw = _mgmt_gw(ctx)
    fw_ip   = ctx.get("fw_ip", "10.0.0.1")

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════════╗",
        "# ║   STATIC ROUTING — Junos             ║",
        "# ╚══════════════════════════════════════╝",
        "#",
        "routing-options {",
        "    static {",
        f"        route 0.0.0.0/0 next-hop {fw_ip};",
        "        route 10.0.0.0/8 discard;",
        "        route 172.16.0.0/12 discard;",
        "    }",
        "}",
        "routing-instances {",
        "    MGMT {",
        "        instance-type virtual-router;",
        "        routing-options {",
        "            static {",
        f"                route 0.0.0.0/0 next-hop {mgmt_gw};",
        "            }",
        "        }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ─────────────────────────────────────────────────────────────────

def _sonic_static(ctx: dict) -> str:
    mgmt_gw = _mgmt_gw(ctx)
    fw_ip   = ctx.get("fw_ip", "10.0.0.1")

    lines: list[str] = []
    lines += [
        "!",
        "! SONiC static routes — configure via FRR vtysh or CONFIG_DB",
        f"! config route add 0.0.0.0/0 nexthop {fw_ip}",
        f"! config route add 0.0.0.0/0 nexthop {mgmt_gw} vrf mgmt",
        "! config route add 10.200.0.0/16 dev blackhole",
        "!",
    ]
    return "\n".join(lines) + "\n"
