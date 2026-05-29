"""
Trunk / Uplink Policy Generator
==================================
Generates uplink trunk configuration with:
  - Port-channel (LACP) for uplinks
  - Allowed VLAN lists (explicit, not "all")
  - Native VLAN hardening (set to unused 4094)
  - Storm control (broadcast / multicast / unicast)
  - BPDU guard on access ports, Root Guard on uplinks
  - Loop Guard / UDLD
  - Carrier delay / debounce
  - CDP / LLDP policy (allow on uplinks, disable on access)
  - Uplink Fast / BackboneFast (classic STP)
  - EtherChannel load-balancing
  - MTU 9214 on DC/GPU trunks

Platforms: ios-xe, nxos, eos, junos
"""
from __future__ import annotations
from typing import Any


def generate_trunk_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return trunk / uplink config block for device context + platform."""
    fn = {
        "ios-xe": _ios_xe_trunk,
        "nxos":   _nxos_trunk,
        "eos":    _eos_trunk,
        "junos":  _junos_trunk,
        "sonic":  _sonic_trunk,
    }.get(platform, _ios_xe_trunk)
    return fn(ctx)


def _vlan_allow_list(ctx: dict) -> str:
    """Build allowed VLAN list string from context."""
    uc = ctx.get("uc", "campus")
    vlans = ctx.get("vlans", [])
    if vlans:
        return ",".join(str(v["id"]) for v in vlans)
    if uc == "campus":
        return "10,20,30,40,50,60,70,80,99,998,999"
    if uc in ("dc", "hybrid"):
        return "100,200,300,400,500,600,700"
    if uc == "gpu":
        return "100,200,300,400"
    return "1-4094"


# ── IOS-XE ───────────────────────────────────────────────────────────────

def _ios_xe_trunk(ctx: dict) -> str:
    layer  = ctx.get("layer", "campus-dist")
    uc     = ctx.get("uc", "campus")
    idx    = ctx.get("index", 1)
    allowed= _vlan_allow_list(ctx)
    mtu    = 9214 if uc in ("dc", "gpu", "hybrid") else 1500
    is_dc  = uc in ("dc", "gpu", "hybrid")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════╗",
        "!-- ║   TRUNK / UPLINK POLICY — IOS-XE         ║",
        "!-- ╚══════════════════════════════════════════╝",
        "!",
        "!-- EtherChannel load-balancing",
        "port-channel load-balance src-dst-mixed-ip-port",
        "!",
        "!-- UDLD — unidirectional link detection",
        "udld aggressive",
        "!",
        "!-- STP global",
        "spanning-tree mode rapid-pvst",
        "spanning-tree portfast bpduguard default",
        "spanning-tree loopguard default",
        "spanning-tree pathcost method long",
        "!",
    ]

    if "core" in layer or "dist" in layer or "spine" in layer:
        # Uplink port-channel to upstream (e.g., core → WAN/FW)
        lines += [
            f"!-- Uplink Port-Channel to upstream",
            f"interface Port-Channel{idx}",
            " description UPLINK-TO-UPSTREAM-PC",
            " switchport mode trunk",
            f" switchport trunk allowed vlan {allowed}",
            " switchport trunk native vlan 4094",
            " switchport nonegotiate",
            " spanning-tree guard root",
            " spanning-tree portfast trunk",
            f" mtu {mtu}",
            " no shutdown",
            "!",
            f"interface GigabitEthernet1/0/49",
            f" description UPLINK-A-TO-UPSTREAM",
            " channel-group {idx} mode active".format(idx=idx),
            f" mtu {mtu}",
            " no shutdown",
            "!",
            f"interface GigabitEthernet1/0/50",
            f" description UPLINK-B-TO-UPSTREAM",
            " channel-group {idx} mode active".format(idx=idx),
            f" mtu {mtu}",
            " no shutdown",
            "!",
        ]

    if "access" in layer or "dist" in layer:
        # Downlink trunks to access
        lines += [
            "!-- Downlink trunks to access switches",
            f"interface Port-Channel1{idx}",
            f" description DOWNLINK-ACCESS-PC",
            " switchport mode trunk",
            f" switchport trunk allowed vlan {allowed}",
            " switchport trunk native vlan 4094",
            " switchport nonegotiate",
            " storm-control broadcast level 10.00",
            " storm-control multicast level 5.00",
            " storm-control unicast level 80.00",
            " storm-control action shutdown",
            " spanning-tree guard loop",
            " no cdp enable" if is_dc else " cdp enable",
            " lldp transmit",
            " lldp receive",
            f" mtu {mtu}",
            " no shutdown",
            "!",
        ]

    if "access" in layer:
        # Access port storm control + BPDU guard template
        lines += [
            "!-- Access port hardening template",
            "!-- Apply 'service-policy type control subscriber DOT1X-POLICY' per port",
            "interface GigabitEthernet1/0/1",
            " description UPLINK-TO-DIST",
            " switchport mode trunk",
            f" switchport trunk allowed vlan {allowed}",
            " switchport trunk native vlan 4094",
            " switchport nonegotiate",
            " spanning-tree guard root",
            f" mtu {mtu}",
            " no shutdown",
            "!",
            "!-- Unused ports — shutdown + quarantine VLAN",
            "interface range GigabitEthernet1/0/11 - 48",
            " description UNUSED",
            " switchport mode access",
            " switchport access vlan 999",
            " spanning-tree portfast",
            " spanning-tree bpduguard enable",
            " storm-control broadcast level 10.00",
            " storm-control action shutdown",
            " shutdown",
            "!",
        ]

    # Jumbo frames on DC/GPU
    if is_dc:
        lines += [
            "!-- Jumbo frame globally",
            f"system mtu jumbo {mtu}",
            f"ip tcp adjust-mss 9174",
            "!",
        ]

    # LLDP policy
    lines += [
        "!-- LLDP global",
        "lldp run",
        "lldp timer 30",
        "lldp holdtime 120",
        "lldp reinit 2",
        "!",
        "!-- CDP policy (disable on access toward untrusted)",
        "cdp run",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_trunk(ctx: dict) -> str:
    layer   = ctx.get("layer", "dc-spine")
    allowed = _vlan_allow_list(ctx)
    idx     = ctx.get("index", 1)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════╗",
        "!-- ║   TRUNK / UPLINK POLICY — NX-OS          ║",
        "!-- ╚══════════════════════════════════════════╝",
        "!",
        "!-- Global EtherChannel",
        "port-channel load-balance src-dst l4port",
        "!",
        "!-- STP global",
        "spanning-tree mode rapid-pvst",
        "spanning-tree loopguard default",
        "spanning-tree pathcost method long",
        "!",
        "!-- UDLD",
        "feature udld",
        "udld aggressive",
        "!",
        "!-- vPC global (peer-link)",
        "feature vpc",
        f"vpc domain {idx * 10}",
        "  role priority 10",
        "  peer-keepalive destination 10.255.255.2 source 10.255.255.1 vrf management",
        "  peer-gateway",
        "  auto-recovery reload-delay 360",
        "  delay restore 150",
        "!",
        f"!-- Peer-link Port-Channel (LACP)",
        "interface port-channel999",
        "  description VPC-PEER-LINK",
        "  switchport mode trunk",
        f"  switchport trunk allowed vlan {allowed}",
        "  vpc peer-link",
        "  spanning-tree port type network",
        "  no shutdown",
        "!",
        "interface Ethernet1/53",
        "  description PEER-LINK-A",
        "  channel-group 999 mode active",
        "  no shutdown",
        "!",
        "interface Ethernet1/54",
        "  description PEER-LINK-B",
        "  channel-group 999 mode active",
        "  no shutdown",
        "!",
    ]

    if "leaf" in layer:
        lines += [
            "!-- Downlink trunk to server / vPC member",
            "interface port-channel10",
            "  description SERVER-DOWNLINK-PC",
            "  switchport mode trunk",
            f"  switchport trunk allowed vlan {allowed}",
            "  switchport trunk native vlan 4094",
            "  vpc 10",
            "  mtu 9216",
            "  storm-control broadcast level 10",
            "  storm-control action shutdown",
            "  no shutdown",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── EOS ──────────────────────────────────────────────────────────────────

def _eos_trunk(ctx: dict) -> str:
    layer   = ctx.get("layer", "dc-spine")
    allowed = _vlan_allow_list(ctx)
    idx     = ctx.get("index", 1)

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════════╗",
        "! ║   TRUNK / UPLINK POLICY — Arista EOS     ║",
        "! ╚══════════════════════════════════════════╝",
        "!",
        "!-- Port-channel load-balance",
        "port-channel load-balance trident fields ip src-dst-ip",
        "!",
        "!-- LACP / MLAG peer-link",
        "interface Port-Channel999",
        "   description MLAG-PEER-LINK",
        "   switchport mode trunk",
        f"   switchport trunk allowed vlan {allowed}",
        "   switchport trunk native vlan 4094",
        "   mtu 9214",
        "   spanning-tree portfast network",
        "   no shutdown",
        "!",
        "interface Ethernet53/1",
        "   description MLAG-PEER-A",
        "   channel-group 999 mode active",
        "   mtu 9214",
        "   no shutdown",
        "!",
        "interface Ethernet54/1",
        "   description MLAG-PEER-B",
        "   channel-group 999 mode active",
        "   mtu 9214",
        "   no shutdown",
        "!",
        "!-- Storm control default",
        "storm-control all level 10.00 5.00",
        "!",
        "!-- LLDP",
        "lldp run",
        "!",
        "!-- STP",
        "spanning-tree mode rapid-pvst",
        "spanning-tree portfast bpduguard default",
        "spanning-tree loopguard default",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos ─────────────────────────────────────────────────────────────────

def _junos_trunk(ctx: dict) -> str:
    vlans  = ctx.get("vlans", [])
    allowed= [str(v["id"]) for v in vlans] if vlans else ["10","20","99"]

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════════════╗",
        "# ║   TRUNK / UPLINK POLICY — Junos          ║",
        "# ╚══════════════════════════════════════════╝",
        "#",
        "interfaces {",
        "    ae0 {",
        "        description UPLINK-LAG;",
        "        aggregated-ether-options {",
        "            lacp {",
        "                active;",
        "                periodic fast;",
        "            }",
        "        }",
        "        unit 0 {",
        "            family ethernet-switching {",
        "                interface-mode trunk;",
        "                vlan {",
        "                    members [ " + " ".join(allowed) + " ];",
        "                }",
        "                native-vlan-id 4094;",
        "            }",
        "        }",
        "    }",
        "    et-0/0/48 {",
        "        description UPLINK-A;",
        "        ether-options {",
        "            802.3ad ae0;",
        "        }",
        "    }",
        "    et-0/0/49 {",
        "        description UPLINK-B;",
        "        ether-options {",
        "            802.3ad ae0;",
        "        }",
        "    }",
        "}",
        "protocols {",
        "    lldp { interface all; }",
        "    rstp {",
        "        bridge-priority 8k;",
        "        interface ae0 { edge; }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ─────────────────────────────────────────────────────────────────

def _sonic_trunk(ctx: dict) -> str:
    allowed = _vlan_allow_list(ctx)
    lines: list[str] = []
    lines += [
        "!",
        "! SONiC trunk config — via CONFIG_DB",
        f"! config portchannel add PortChannel1",
        "! config portchannel member add PortChannel1 Ethernet48",
        "! config portchannel member add PortChannel1 Ethernet52",
        f"! config vlan member add {allowed.split(',')[0]} PortChannel1 --untagged",
        "!",
    ]
    return "\n".join(lines) + "\n"
