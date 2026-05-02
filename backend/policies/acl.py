"""
ACL Generator
==============
Generates Infrastructure ACL (iACL), VLAN ACLs, and management ACLs
per platform and use-case. Follows RIPE-399 / iACL best-practice structure.

Platforms: ios-xe, nxos, eos, junos
"""
from __future__ import annotations
from typing import Any


def generate_acl(ctx: dict[str, Any], platform: str) -> str:
    """Return ACL config block for device context + platform."""
    fn = {
        "ios-xe": _ios_xe_acl,
        "nxos":   _nxos_acl,
        "eos":    _eos_acl,
        "junos":  _junos_acl,
        "sonic":  _sonic_acl,
    }.get(platform, _ios_xe_acl)
    return fn(ctx)


# ── IOS-XE ──────────────────────────────────────────────────────────────

def _ios_xe_acl(ctx: dict) -> str:
    layer  = ctx.get("layer", "campus-access")
    uc     = ctx.get("uc", "campus")
    mgmt   = ctx.get("mgmt_ip", "10.100.1.1")
    vlans  = ctx.get("vlans", [])

    mgmt_net = ".".join(mgmt.split(".")[:3]) + ".0"

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════╗",
        "!-- ║   ACCESS CONTROL LISTS — IOS-XE  ║",
        "!-- ╚══════════════════════════════════╝",
        "!",
        "!-- Infrastructure ACL (iACL) — protect control plane",
        "ip access-list extended iACL-PROTECT-CP",
        " remark === PERMIT ROUTING PROTOCOLS ===",
        " permit ospf any host 224.0.0.5",
        " permit ospf any host 224.0.0.6",
        " permit 89 any any",
        " permit udp any any eq 646",
        " remark LDP",
        " permit tcp any any eq 179",
        " remark BGP",
        " permit udp any any eq 3785",
        " remark BFD control",
        " permit udp any any eq 3784",
        " remark BFD echo",
        " permit pim any host 224.0.0.13",
        " remark PIM",
        " permit igmp any any",
        " remark === PERMIT MANAGEMENT ===",
        f" permit tcp {mgmt_net} 0.0.0.255 any eq 22",
        " remark SSH from mgmt",
        f" permit udp {mgmt_net} 0.0.0.255 any eq 161",
        " remark SNMP from mgmt",
        f" permit tcp {mgmt_net} 0.0.0.255 any eq 830",
        " remark NETCONF",
        f" permit udp {mgmt_net} 0.0.0.255 any eq 514",
        " remark Syslog to mgmt",
        " permit icmp any any echo",
        " remark Allow ping",
        " permit icmp any any echo-reply",
        " remark Allow ping reply",
        " remark === DENY BOGONS ===",
        " deny ip 0.0.0.0 0.255.255.255 any log",
        " deny ip 127.0.0.0 0.255.255.255 any log",
        " deny ip 169.254.0.0 0.0.255.255 any log",
        " deny ip 192.0.2.0 0.0.0.255 any log",
        " deny ip 198.51.100.0 0.0.0.255 any log",
        " deny ip 203.0.113.0 0.0.0.255 any log",
        " remark === DENY REST ===",
        " deny ip any any log",
        "!",
    ]

    if layer == "campus-access" or uc == "campus":
        lines += [
            "!-- Management access ACL",
            "ip access-list standard MGMT-ACCESS",
            f" permit {mgmt_net} 0.0.0.255",
            " deny   any log",
            "!",
            "!-- Anti-spoofing per VLAN",
        ]
        active_vlans = vlans if vlans else [
            {"id": 10, "name": "DATA",  "prefix": "192.168.10.0"},
            {"id": 20, "name": "VOICE", "prefix": "192.168.20.0"},
            {"id": 99, "name": "MGMT",  "prefix": mgmt_net},
        ]
        for vlan in active_vlans:
            vid  = vlan.get("id", 10)
            name = vlan.get("name", f"VLAN{vid}")
            pfx  = vlan.get("prefix", f"192.168.{vid}.0")
            lines += [
                f"ip access-list extended ANTISPOOF-VLAN{vid}",
                f" remark Anti-spoof for {name}",
                f" permit ip {pfx} 0.0.0.255 any",
                " deny   ip any any log",
                "!",
            ]
            lines.append(f"interface Vlan{vid}")
            lines.append(f" ip access-group ANTISPOOF-VLAN{vid} in")
            lines.append("!")

    if uc in ("dc", "hybrid"):
        lines += [
            "!-- DC fabric iACL — protect spine/leaf control plane",
            "ip access-list extended DC-FABRIC-PROTECT",
            " permit tcp 10.0.0.0 0.255.255.255 any eq 179",
            " remark iBGP",
            " permit udp 10.0.0.0 0.255.255.255 any eq 3784",
            " remark BFD",
            " permit udp 10.0.0.0 0.255.255.255 any eq 4789",
            " remark VXLAN",
            " permit ospf 10.0.0.0 0.255.255.255 any",
            " permit 89 10.0.0.0 0.255.255.255 any",
            " remark IS-IS/OSPF",
            " permit icmp any any",
            " deny   ip any any log",
            "!",
        ]

    # VTY ACL always
    lines += [
        "!-- VTY access restriction",
        "ip access-list standard VTY-ACCESS",
        f" permit {mgmt_net} 0.0.0.255",
        " deny   any log",
        "!",
        "line vty 0 15",
        " access-class VTY-ACCESS in",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_acl(ctx: dict) -> str:
    mgmt = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net = ".".join(mgmt.split(".")[:3]) + ".0/24"
    uc   = ctx.get("uc", "dc")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════╗",
        "!-- ║   ACCESS CONTROL LISTS — NX-OS   ║",
        "!-- ╚══════════════════════════════════╝",
        "!",
        "!-- Infrastructure ACL",
        "ip access-list iACL-FABRIC",
        "  10 permit tcp 10.0.0.0/8 any eq bgp",
        "  20 permit tcp any 10.0.0.0/8 eq bgp",
        "  30 permit udp 10.0.0.0/8 any eq bfd",
        "  40 permit udp 10.0.0.0/8 any eq 3785",
        "  50 permit ospf 10.0.0.0/8 224.0.0.5/32",
        "  60 permit ospf 10.0.0.0/8 224.0.0.6/32",
        "  70 permit udp 10.0.0.0/8 any eq 4789",
        "  remark VXLAN",
        "  80 permit icmp any any",
        "  90 permit tcp 10.0.0.0/8 any eq 22",
        " 100 permit udp 10.0.0.0/8 any eq 161",
        " 200 deny ip any any log",
        "!",
        "!-- Management ACL",
        "ip access-list MGMT-ONLY",
        f"  10 permit ip {mgmt_net} any",
        "  20 deny ip any any log",
        "!",
        "!-- Anti-bogon ACL",
        "ip access-list DENY-BOGONS",
        "  10 deny ip 0.0.0.0/8 any log",
        "  20 deny ip 127.0.0.0/8 any log",
        "  30 deny ip 169.254.0.0/16 any log",
        "  40 deny ip 192.0.2.0/24 any log",
        "  50 deny ip 198.51.100.0/24 any log",
        "  60 permit ip any any",
        "!",
        "!-- Apply to mgmt interface",
        "interface mgmt0",
        "  ip access-group MGMT-ONLY in",
        "!",
        "!-- CoPP — control plane policing",
        "copp profile strict",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── EOS ─────────────────────────────────────────────────────────────────

def _eos_acl(ctx: dict) -> str:
    mgmt = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net = ".".join(mgmt.split(".")[:3]) + ".0/24"

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════╗",
        "! ║   ACCESS CONTROL LISTS — EOS     ║",
        "! ╚══════════════════════════════════╝",
        "!",
        "ip access-list iACL-FABRIC",
        "   10 permit tcp 10.0.0.0/8 any eq bgp",
        "   20 permit tcp any 10.0.0.0/8 eq bgp",
        "   30 permit udp 10.0.0.0/8 any eq bfd",
        "   40 permit ospf 10.0.0.0/8 224.0.0.5/32",
        "   50 permit ospf 10.0.0.0/8 224.0.0.6/32",
        "   60 permit icmp any any",
        "   70 permit tcp 10.0.0.0/8 any eq ssh",
        "   80 permit udp 10.0.0.0/8 any eq snmp",
        "  999 deny ip any any log",
        "!",
        f"ip access-list MGMT-ACCESS",
        f"   10 permit ip {mgmt_net} any",
        "   20 deny ip any any log",
        "!",
        "!-- Apply iACL on fabric-facing interfaces",
        "ip access-list DENY-BOGONS",
        "   10 deny ip 0.0.0.0/8 any",
        "   20 deny ip 127.0.0.0/8 any",
        "   30 deny ip 169.254.0.0/16 any",
        "  999 permit ip any any",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos ────────────────────────────────────────────────────────────────

def _junos_acl(ctx: dict) -> str:
    mgmt = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net = ".".join(mgmt.split(".")[:3]) + ".0/24"

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════╗",
        "# ║   FIREWALL FILTERS — Junos       ║",
        "# ╚══════════════════════════════════╝",
        "#",
        "firewall {",
        "    family inet {",
        "        filter iACL-PROTECT-CP {",
        "            term PERMIT-ROUTING {",
        "                from {",
        "                    protocol [ ospf bgp bfd ];",
        "                    destination-address {",
        "                        224.0.0.5/32;",
        "                        224.0.0.6/32;",
        "                    }",
        "                }",
        "                then accept;",
        "            }",
        "            term PERMIT-BGP {",
        "                from {",
        "                    protocol tcp;",
        "                    destination-port 179;",
        "                    source-address { 10.0.0.0/8; }",
        "                }",
        "                then accept;",
        "            }",
        "            term PERMIT-MGMT {",
        "                from {",
        "                    source-address {",
        f"                        {mgmt_net};",
        "                    }",
        "                    protocol [ tcp udp ];",
        "                    destination-port [ ssh snmp netconf ];",
        "                }",
        "                then accept;",
        "            }",
        "            term PERMIT-ICMP {",
        "                from { protocol icmp; }",
        "                then accept;",
        "            }",
        "            term DENY-BOGONS {",
        "                from {",
        "                    source-address {",
        "                        0.0.0.0/8;",
        "                        127.0.0.0/8;",
        "                        169.254.0.0/16;",
        "                        192.0.2.0/24;",
        "                    }",
        "                }",
        "                then {",
        "                    discard;",
        "                    count bogon-drop;",
        "                    log;",
        "                }",
        "            }",
        "            term DENY-ALL {",
        "                then {",
        "                    discard;",
        "                    count catch-all-drop;",
        "                    log;",
        "                }",
        "            }",
        "        }",
        "        filter MGMT-ACCESS {",
        "            term PERMIT-MGMT-NET {",
        "                from {",
        f"                    source-address {{ {mgmt_net}; }}",
        "                }",
        "                then accept;",
        "            }",
        "            term DENY-ALL { then discard; }",
        "        }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ────────────────────────────────────────────────────────────────

def _sonic_acl(ctx: dict) -> str:
    """SONiC ACLs are configured via CONFIG_DB JSON or SONiC CLI."""
    mgmt = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net = ".".join(mgmt.split(".")[:3]) + ".0/24"

    lines: list[str] = []
    lines += [
        "!",
        "! SONiC ACL via SONiC-CLI / CONFIG_DB",
        "! Apply with: config acl add table / config acl add rule",
        "!",
        "! TABLE: MGMT_ACL (type: L3)",
        "! RULE 10: SRC_IP=" + mgmt_net + " ACTION=FORWARD",
        "! RULE 999: ACTION=DROP",
        "!",
        "! TABLE: FABRIC_PROTECT (type: L3)",
        "! RULE 10: PROTO=TCP DST_PORT=179 ACTION=FORWARD",
        "! RULE 20: PROTO=UDP DST_PORT=3784 ACTION=FORWARD",
        "! RULE 30: PROTO=ICMP ACTION=FORWARD",
        "! RULE 999: ACTION=DROP LOG=true",
        "!",
    ]

    return "\n".join(lines) + "\n"
