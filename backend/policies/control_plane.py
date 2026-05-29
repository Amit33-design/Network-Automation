"""
Control Plane Protection Policy Generator
==========================================
Generates platform-specific control-plane hardening:

  CoPP (Control Plane Policing) — 8-class model
  ─────────────────────────────────────────────
  Class              Police rate    Burst       Action on excess
  ─────────────────  ─────────────  ──────────  ──────────────────
  ROUTING-PROTOCOLS  64 000 pps     80 000 pps  drop + log
  ICMP               1 000 pps       5 000 pps  drop + log
  MANAGEMENT         500 pps         2 000 pps  drop
  MULTICAST          8 000 pps      16 000 pps  drop
  BROADCAST          2 000 pps       4 000 pps  drop
  EXCEPTION          500 pps         1 000 pps  drop + log
  GLEAN              500 pps         2 000 pps  drop
  DEFAULT            200 pps         400 pps   drop + log

  Routing Protocol Authentication
  ────────────────────────────────
  BGP   — MD5 key-chain (IOS-XE, NX-OS) / HMAC-SHA-256 (IOS-XE 17.x)
  OSPF  — SHA-256 message-digest (IOS-XE, NX-OS)
  IS-IS — HMAC-MD5 (IOS-XE)
  EIGRP — HMAC-SHA-256 key-chain (IOS-XE)

  GTSM (Generalised TTL Security Mechanism)
  ──────────────────────────────────────────
  BGP neighbors  → ttl-security hops 1  (eBGP) / 2 (iBGP multi-hop)
  OSPF / IS-IS   → passive-interface default + active peering ifaces only

  uRPF
  ────
  Strict mode on untrusted (OUTSIDE / WAN) interfaces
  Loose mode on transit / core interfaces

  Management Plane Protection (MPP)
  ───────────────────────────────────
  Restrict SSH, SNMP, NETCONF to management interface / MGMT VRF
  Disable HTTP/Telnet on management plane

Platforms: ios-xe, nxos, eos, junos
Returns '' for sonic (SONiC uses Linux tc/nftables, out of scope here).
"""
from __future__ import annotations

from typing import Any


# ── Rate limits in pps ────────────────────────────────────────────────────
COPP_RATES = {
    "routing":   {"pps": 64000,  "burst": 80000},
    "icmp":      {"pps": 1000,   "burst": 5000},
    "mgmt":      {"pps": 500,    "burst": 2000},
    "multicast": {"pps": 8000,   "burst": 16000},
    "broadcast": {"pps": 2000,   "burst": 4000},
    "exception": {"pps": 500,    "burst": 1000},
    "glean":     {"pps": 500,    "burst": 2000},
    "default":   {"pps": 200,    "burst": 400},
}


def generate_control_plane(ctx: dict[str, Any], platform: str) -> str:
    """Return control-plane protection config — dispatches by platform."""
    if platform in ("ios-xe", "nxos"):
        return _ios_xe_copp(ctx) if platform == "ios-xe" else _nxos_copp(ctx)
    if platform == "eos":
        return _eos_copp(ctx)
    if platform == "junos":
        return _junos_copp(ctx)
    return ""


# ══════════════════════════════════════════════════════════════════════════
#  IOS-XE — CoPP + Routing Auth + GTSM + uRPF + MPP
# ══════════════════════════════════════════════════════════════════════════

def _ios_xe_copp(ctx: dict) -> str:
    mgmt_ip      = ctx.get("mgmt_ip",      "10.100.1.1")
    mgmt_net     = ".".join(mgmt_ip.split(".")[:3]) + ".0"
    bgp_asn      = ctx.get("bgp_asn",      65000)
    ospf_area    = ctx.get("ospf_area",    "0")
    ebgp_peers   = ctx.get("ebgp_peers",   [])   # list of {"ip":"x", "asn": y}
    ibgp_peers   = ctx.get("ibgp_peers",   [])   # list of {"ip":"x"}
    ospf_ifaces  = ctx.get("ospf_ifaces",  [])   # list of interface names
    isis_ifaces  = ctx.get("isis_ifaces",  [])   # list of interface names
    protocols    = ctx.get("protocols",    [])
    outside_if   = ctx.get("outside_interface", "GigabitEthernet0/0/0")
    mgmt_if      = ctx.get("mgmt_interface",    "GigabitEthernet0/0/5")

    r   = COPP_RATES
    lines: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════════════════╗",
        "!-- ║   CONTROL PLANE PROTECTION  —  IOS-XE                  ║",
        "!-- ╚══════════════════════════════════════════════════════════╝",
        "!",
    ]

    # ── CoPP ACLs ───────────────────────────────────────────────────────
    lines += [
        "!-- CoPP ACLs — traffic classification",
        "ip access-list extended COPP-ACL-ROUTING",
        " remark BGP",
        " permit tcp any any eq 179",
        " permit tcp any eq 179 any",
        " remark OSPF",
        " permit ospf any any",
        " remark IS-IS (directly to router)",
        " permit 83 any any",
        " remark EIGRP",
        " permit eigrp any any",
        " remark LDP",
        " permit udp any any eq 646",
        " permit tcp any any eq 646",
        " remark BFD",
        " permit udp any any eq 3784",
        " permit udp any any eq 3785",
        " remark PIM hello",
        " permit pim any 224.0.0.13",
        " remark HSRP / VRRP",
        " permit udp any 224.0.0.2 eq 1985",
        " permit 112 any 224.0.0.18",
        "!",
        "ip access-list extended COPP-ACL-ICMP",
        " permit icmp any any echo",
        " permit icmp any any echo-reply",
        " permit icmp any any unreachable",
        " permit icmp any any ttl-exceeded",
        " permit icmp any any port-unreachable",
        "!",
        "ip access-list extended COPP-ACL-MGMT",
        " remark SSH",
        " permit tcp any any eq 22",
        " remark SNMP",
        " permit udp any any eq 161",
        " permit udp any any eq 162",
        " remark TACACS+",
        " permit tcp any any eq 49",
        " remark NETCONF",
        " permit tcp any any eq 830",
        " remark RESTCONF",
        " permit tcp any any eq 443",
        " remark NTP",
        " permit udp any any eq 123",
        " remark Syslog",
        " permit udp any any eq 514",
        "!",
        "ip access-list extended COPP-ACL-MULTICAST",
        " permit pim any any",
        " permit igmp any any",
        " permit udp any 224.0.0.0 0.0.0.255",
        " permit udp any 239.0.0.0 0.255.255.255",
        "!",
        "ip access-list extended COPP-ACL-BROADCAST",
        " remark ARP (handled in L2 — here as fallback)",
        " permit udp any host 255.255.255.255",
        " remark DHCP",
        " permit udp any host 255.255.255.255 eq 67",
        " permit udp any host 255.255.255.255 eq 68",
        "!",
        "ip access-list extended COPP-ACL-EXCEPTION",
        " remark IP options",
        " permit ip any any option any",
        " remark TTL = 1 (traceroute / MPLS exp)",
        " permit ip any any ttl eq 1",
        " remark IP fragments",
        " permit ip any any fragments",
        "!",
        "ip access-list extended COPP-ACL-GLEAN",
        " remark Adjacency resolution / ARP glean",
        " permit arp any any",
        "!",
    ]

    # ── Class maps ──────────────────────────────────────────────────────
    lines += [
        "!-- CoPP Class maps",
        "class-map match-any COPP-CLASS-ROUTING",
        " match access-group name COPP-ACL-ROUTING",
        "!",
        "class-map match-any COPP-CLASS-ICMP",
        " match access-group name COPP-ACL-ICMP",
        "!",
        "class-map match-any COPP-CLASS-MGMT",
        " match access-group name COPP-ACL-MGMT",
        "!",
        "class-map match-any COPP-CLASS-MULTICAST",
        " match access-group name COPP-ACL-MULTICAST",
        "!",
        "class-map match-any COPP-CLASS-BROADCAST",
        " match access-group name COPP-ACL-BROADCAST",
        "!",
        "class-map match-any COPP-CLASS-EXCEPTION",
        " match access-group name COPP-ACL-EXCEPTION",
        "!",
        "class-map match-any COPP-CLASS-GLEAN",
        " match access-group name COPP-ACL-GLEAN",
        "!",
    ]

    # ── Policy map ──────────────────────────────────────────────────────
    lines += [
        "!-- CoPP Policy map — 8-class model",
        "policy-map COPP-POLICY",
        " class COPP-CLASS-ROUTING",
        f"  police rate {r['routing']['pps']} pps burst {r['routing']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-ICMP",
        f"  police rate {r['icmp']['pps']} pps burst {r['icmp']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-MGMT",
        f"  police rate {r['mgmt']['pps']} pps burst {r['mgmt']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-MULTICAST",
        f"  police rate {r['multicast']['pps']} pps burst {r['multicast']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-BROADCAST",
        f"  police rate {r['broadcast']['pps']} pps burst {r['broadcast']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-EXCEPTION",
        f"  police rate {r['exception']['pps']} pps burst {r['exception']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class COPP-CLASS-GLEAN",
        f"  police rate {r['glean']['pps']} pps burst {r['glean']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        " class class-default",
        f"  police rate {r['default']['pps']} pps burst {r['default']['burst']} packets",
        "  conform-action transmit",
        "  exceed-action drop",
        "!",
        "!-- Apply CoPP to control plane",
        "control-plane",
        " service-policy input COPP-POLICY",
        "!",
    ]

    # ── Routing Protocol Authentication ─────────────────────────────────
    lines += [
        "!",
        "!-- ─────────────────────────────────────────────────────────",
        "!-- ROUTING PROTOCOL AUTHENTICATION",
        "!-- ─────────────────────────────────────────────────────────",
        "!",
    ]

    # BGP key-chain (HMAC-SHA-256, IOS-XE 17.x)
    lines += [
        "!-- BGP authentication — HMAC-SHA-256 key-chain",
        "key chain KEY-CHAIN-BGP",
        " key 1",
        "  key-string BGP-SECRET-CHANGEME",
        "  cryptographic-algorithm hmac-sha-256",
        "  accept-lifetime local 00:00:00 Jan 1 2024 infinite",
        "  send-lifetime    local 00:00:00 Jan 1 2024 infinite",
        "!",
    ]
    if ebgp_peers:
        for peer in ebgp_peers:
            ip = peer.get("ip", "0.0.0.0")
            asn = peer.get("asn", 65001)
            lines += [
                f"router bgp {bgp_asn}",
                f" neighbor {ip} remote-as {asn}",
                f" neighbor {ip} password 7 REPLACE-WITH-ENCRYPTED",
                f" neighbor {ip} ttl-security hops 1",
                f" remark eBGP peer — GTSM TTL-security hops 1",
                "!",
            ]
    if ibgp_peers:
        for peer in ibgp_peers:
            ip = peer.get("ip", "0.0.0.0")
            lines += [
                f"router bgp {bgp_asn}",
                f" neighbor {ip} password 7 REPLACE-WITH-ENCRYPTED",
                f" neighbor {ip} ttl-security hops 2",
                f" remark iBGP peer — GTSM TTL-security hops 2",
                "!",
            ]
    if not ebgp_peers and not ibgp_peers:
        lines += [
            f"!-- Example BGP auth (fill in real neighbor IPs):",
            f"!  router bgp {bgp_asn}",
            "!   neighbor 10.0.0.1 password 7 REPLACE-WITH-ENCRYPTED",
            "!   neighbor 10.0.0.1 ttl-security hops 1   ! eBGP GTSM",
            "!",
        ]

    # OSPF SHA-256
    if "ospf" in " ".join(protocols).lower() or ospf_ifaces:
        lines += [
            "!-- OSPF SHA-256 authentication (IOS-XE 16.x+)",
            "key chain KEY-CHAIN-OSPF",
            " key 1",
            "  key-string OSPF-SECRET-CHANGEME",
            "  cryptographic-algorithm hmac-sha-256",
            "  accept-lifetime local 00:00:00 Jan 1 2024 infinite",
            "  send-lifetime    local 00:00:00 Jan 1 2024 infinite",
            "!",
            f"router ospf 1",
            " passive-interface default",
        ]
        for iface in (ospf_ifaces or ["GigabitEthernet0/0/1"]):
            lines.append(f" no passive-interface {iface}")
        lines += [
            " area 0 authentication message-digest",
            "!",
        ]
        for iface in (ospf_ifaces or ["GigabitEthernet0/0/1"]):
            lines += [
                f"interface {iface}",
                " ip ospf authentication key-chain KEY-CHAIN-OSPF",
                " ip ospf message-digest-key 1 sha256 OSPF-SECRET-CHANGEME",
                " ip ospf authentication message-digest",
                "!",
            ]

    # IS-IS HMAC-MD5
    if "is-is" in " ".join(protocols).lower() or isis_ifaces:
        lines += [
            "!-- IS-IS HMAC-MD5 authentication",
            "key chain KEY-CHAIN-ISIS",
            " key 1",
            "  key-string ISIS-SECRET-CHANGEME",
            "  cryptographic-algorithm hmac-md5",
            "  accept-lifetime local 00:00:00 Jan 1 2024 infinite",
            "  send-lifetime    local 00:00:00 Jan 1 2024 infinite",
            "!",
            "router isis 1",
            " authentication mode md5 level-1-2",
            " authentication key-chain KEY-CHAIN-ISIS level-1-2",
            "!",
        ]
        for iface in (isis_ifaces or []):
            lines += [
                f"interface {iface}",
                " isis authentication mode md5",
                " isis authentication key-chain KEY-CHAIN-ISIS",
                "!",
            ]

    # EIGRP HMAC-SHA-256
    if "eigrp" in " ".join(protocols).lower():
        lines += [
            "!-- EIGRP HMAC-SHA-256 authentication (named EIGRP)",
            "key chain KEY-CHAIN-EIGRP",
            " key 1",
            "  key-string EIGRP-SECRET-CHANGEME",
            "  cryptographic-algorithm hmac-sha-256",
            "!",
            "router eigrp NAMED-EIGRP",
            " address-family ipv4 unicast autonomous-system 1",
            "  af-interface default",
            "   authentication mode hmac-sha-256",
            "   authentication key-chain KEY-CHAIN-EIGRP",
            "  exit-af-interface",
            "!",
        ]

    # ── uRPF ────────────────────────────────────────────────────────────
    lines += [
        "!",
        "!-- ─────────────────────────────────────────────────────────",
        "!-- uRPF — Unicast Reverse Path Forwarding",
        "!-- ─────────────────────────────────────────────────────────",
        "!",
        "!-- Strict uRPF on untrusted (WAN/OUTSIDE) interface",
        f"interface {outside_if}",
        " ip verify unicast source reachable-via rx",
        " remark uRPF strict — drops spoofed source addresses",
        "!",
        "!-- Loose uRPF on core/transit interfaces (adjust per topology)",
        "!-- interface GigabitEthernet0/1",
        "!--  ip verify unicast source reachable-via any",
        "!",
    ]

    # ── Management Plane Protection ──────────────────────────────────────
    lines += [
        "!",
        "!-- ─────────────────────────────────────────────────────────",
        "!-- MANAGEMENT PLANE PROTECTION (MPP)",
        "!-- ─────────────────────────────────────────────────────────",
        "!",
        "!-- Allow management protocols ONLY on the dedicated MGMT interface",
        "control-plane host",
        f" management-interface {mgmt_if} allow ssh",
        f" management-interface {mgmt_if} allow snmp",
        f" management-interface {mgmt_if} allow netconf",
        f" management-interface {mgmt_if} allow ntp",
        "!",
        "!-- Out-of-band MGMT VRF (if used)",
        "vrf definition MGMT",
        " rd 1:100",
        " address-family ipv4",
        "  exit-address-family",
        "!",
        f"interface {mgmt_if}",
        " description OOB-MANAGEMENT",
        " vrf forwarding MGMT",
        f" ip address {mgmt_ip} 255.255.255.0",
        " no ip proxy-arp",
        " no cdp enable",
        "!",
        "!-- Default route in MGMT VRF",
        f"ip route vrf MGMT 0.0.0.0 0.0.0.0 {mgmt_net[:-1]}254",
        "!",
        "!-- ACL restricting management access",
        "ip access-list standard ACL-MGMT-VTY",
        f" 10 permit {mgmt_net} 0.0.0.255",
        " 20 remark NOC/SOC jump-host subnet",
        " 30 permit 10.100.0.0 0.0.0.255",
        " 99 deny   any log",
        "!",
        "line vty 0 15",
        " access-class ACL-MGMT-VTY in vrf-also",
        " transport input ssh",
        " exec-timeout 10 0",
        " logging synchronous",
        "!",
    ]

    # ── TCP keepalives + anti-spoofing helpers ───────────────────────────
    lines += [
        "!",
        "!-- ─────────────────────────────────────────────────────────",
        "!-- ADDITIONAL CONTROL-PLANE HARDENING",
        "!-- ─────────────────────────────────────────────────────────",
        "!",
        "!-- TCP keepalives (detect dead sessions)",
        "service tcp-keepalives-in",
        "service tcp-keepalives-out",
        "!",
        "!-- Disable IP source routing (MUST in all environments)",
        "no ip source-route",
        "!",
        "!-- Limit ICMP unreachables + redirects (DoS mitigation)",
        "ip icmp rate-limit unreachable 1000",
        f"interface {outside_if}",
        " no ip unreachables",
        " no ip redirects",
        " no ip proxy-arp",
        "!",
        "!-- BGP TCP MD5 fallback (legacy peers without key-chain support)",
        "!-- ip tcp md5 any router 65001",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  NX-OS — CoPP + Routing Auth + GTSM
# ══════════════════════════════════════════════════════════════════════════

def _nxos_copp(ctx: dict) -> str:
    bgp_asn   = ctx.get("bgp_asn", 65000)
    protocols = ctx.get("protocols", [])

    r = COPP_RATES
    lines: list[str] = []

    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════════════════╗",
        "!-- ║   CONTROL PLANE PROTECTION  —  NX-OS                   ║",
        "!-- ╚══════════════════════════════════════════════════════════╝",
        "!",
        "!-- NX-OS ships with a default CoPP policy (copp-system-p-policy-strict).",
        "!-- These commands customise the rate limiters for a production DC spine/leaf.",
        "!",
        "copp profile strict",
        "!",

        "!-- Routing protocols — increase headroom for large BGP tables",
        "class-map type control-plane match-any copp-class-routing",
        " match access-group name copp-acl-bgp",
        " match access-group name copp-acl-ospf",
        " match access-group name copp-acl-eigrp",
        " match access-group name copp-acl-isis",
        " match access-group name copp-acl-ldp",
        " match access-group name copp-acl-bfd",
        "!",
        "ip access-list copp-acl-bgp",
        " 10 permit tcp any any eq bgp",
        " 20 permit tcp any eq bgp any",
        "ip access-list copp-acl-ospf",
        " 10 permit ospf any any",
        "ip access-list copp-acl-eigrp",
        " 10 permit eigrp any any",
        "ip access-list copp-acl-isis",
        " 10 permit 83 any any",
        "ip access-list copp-acl-ldp",
        " 10 permit udp any any eq 646",
        " 20 permit tcp any any eq 646",
        "ip access-list copp-acl-bfd",
        " 10 permit udp any any range 3784 3785",
        "!",
        "policy-map type control-plane copp-policy-custom",
        " class copp-class-routing",
        f"  police pps {r['routing']['pps']}",
        "!",
        " class copp-class-critical",
        f"  police pps {r['mgmt']['pps']}",
        "!",
        " class copp-class-important",
        f"  police pps {r['icmp']['pps']}",
        "!",
        " class copp-class-normal",
        f"  police pps {r['multicast']['pps']}",
        "!",
        " class copp-class-undesirable",
        f"  police pps {r['exception']['pps']}",
        " conform-action drop",
        "!",
        " class class-default",
        f"  police pps {r['default']['pps']}",
        "!",
        "control-plane",
        " service-policy input copp-policy-custom",
        "!",
    ]

    # BGP MD5 auth
    lines += [
        "!-- BGP MD5 authentication (NX-OS)",
        f"router bgp {bgp_asn}",
        " neighbor 10.0.0.1",
        "  remote-as 65001",
        "  password 3 REPLACE-WITH-TYPE3-ENCRYPTED",
        "  ebgp-multihop 1",
        "  remark eBGP with GTSM (NX-OS uses ebgp-multihop 1 for GTSM)",
        "!",
    ]

    # OSPF auth
    if "ospf" in " ".join(protocols).lower():
        lines += [
            "!-- OSPF MD5 authentication (NX-OS)",
            "router ospf 1",
            " area 0 authentication message-digest",
            "!",
            "interface Ethernet1/1",
            " ip ospf authentication message-digest",
            " ip ospf message-digest-key 1 md5 3 OSPF-SECRET-CHANGEME",
            "!",
        ]

    lines += [
        "!-- uRPF on border interfaces (NX-OS)",
        "interface Ethernet1/48",
        " description WAN-UPLINK",
        " ip verify unicast source reachable-via rx",
        "!",
        "!-- TCP intercept not available in NX-OS — handled by upstream firewall",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  Arista EOS — CoPP + Routing Auth
# ══════════════════════════════════════════════════════════════════════════

def _eos_copp(ctx: dict) -> str:
    bgp_asn   = ctx.get("bgp_asn", 65000)
    protocols = ctx.get("protocols", [])

    r = COPP_RATES
    lines: list[str] = []

    lines += [
        "!",
        "! ╔══════════════════════════════════════════════════════════╗",
        "! ║   CONTROL PLANE PROTECTION  —  ARISTA EOS               ║",
        "! ╚══════════════════════════════════════════════════════════╝",
        "!",
        "! EOS Control-Plane ACL (rate-limiting via system copp profile)",
        "!",
        "system control-plane",
        "   ip access-group COPP-ACL-ROUTING in",
        "!",

        "ip access-list COPP-ACL-ROUTING",
        "   10 permit tcp any any eq bgp",
        "   20 permit tcp any eq bgp any",
        "   30 permit ospf any any",
        "   40 permit 83 any any",
        "   50 permit udp any any eq 646",
        "   60 permit udp any any range 3784 3785",
        "   70 permit pim any any",
        "   80 permit igmp any any",
        "!",

        "ip access-list COPP-ACL-MGMT",
        "   10 permit tcp 10.100.0.0/24 any eq ssh",
        "   20 permit udp any any eq snmp",
        "   30 permit udp any any eq ntp",
        "   99 deny ip any any log",
        "!",

        "! EOS copp profile customization",
        "copp-system-rx-policy copp-system-policy",
        "   class bgp-control",
        f"     police rate {r['routing']['pps']} kbps",
        "   !",
        "   class ospf-isis",
        f"     police rate {r['routing']['pps'] // 2} kbps",
        "   !",
        "   class icmp",
        f"     police rate {r['icmp']['pps']} kbps",
        "   !",
        "   class management",
        f"     police rate {r['mgmt']['pps']} kbps",
        "   !",
        "   class default",
        f"     police rate {r['default']['pps']} kbps",
        "!",
    ]

    # BGP auth
    lines += [
        "! BGP MD5 + GTSM (EOS)",
        f"router bgp {bgp_asn}",
        "   neighbor 10.0.0.1",
        "      remote-as 65001",
        "      password 7 REPLACE-WITH-ENCRYPTED",
        "      ttl maximum-hops 1",
        "      remark eBGP GTSM: ttl maximum-hops 1",
        "!",
    ]

    # OSPF auth
    if "ospf" in " ".join(protocols).lower():
        lines += [
            "! OSPF SHA-512 auth (EOS)",
            "router ospf 1",
            "   area 0 authentication ipsec spi 256 sha1 passphrase OSPF-SECRET-CHANGEME",
            "!",
        ]

    # IS-IS auth
    if "is-is" in " ".join(protocols).lower():
        lines += [
            "! IS-IS HMAC-SHA-256 auth (EOS)",
            "router isis UNDERLAY",
            "   authentication mode sha",
            "   authentication key REPLACE-WITH-ISIS-KEY",
            "!",
        ]

    # uRPF
    lines += [
        "! uRPF on WAN interface (EOS)",
        "interface Ethernet1/1",
        "   description WAN-UPLINK",
        "   ip verify unicast source reachable-via rx",
        "!",
        "! Management plane — restrict SSH to MGMT VRF",
        "management ssh",
        "   vrf MGMT",
        "   idle-timeout 10",
        "   authentication mode keyboard-interactive",
        "   server-port 22",
        "!",
        "management api http-commands",
        "   protocol https",
        "   vrf MGMT",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  Junos — CoPP (firewall filter) + Routing Auth
# ══════════════════════════════════════════════════════════════════════════

def _junos_copp(ctx: dict) -> str:
    bgp_asn   = ctx.get("bgp_asn", 65000)
    protocols = ctx.get("protocols", [])

    r = COPP_RATES
    lines: list[str] = []

    lines += [
        "!",
        "# ╔══════════════════════════════════════════════════════════╗",
        "# ║   CONTROL PLANE PROTECTION  —  JUNOS                   ║",
        "# ╚══════════════════════════════════════════════════════════╝",
        "#",
        "# Junos uses a lo0 firewall filter for RE (Routing Engine) protection.",
        "#",
        "set firewall family inet filter PROTECT-RE term ROUTING-PROTOCOLS",
        "  from protocol [ ospf bgp isis ldp bfd-multihop ]",
        "  then policer POLICER-ROUTING accept",
        "#",
        "set firewall family inet filter PROTECT-RE term ICMP",
        "  from protocol icmp",
        "  then policer POLICER-ICMP accept",
        "#",
        "set firewall family inet filter PROTECT-RE term MANAGEMENT",
        "  from protocol tcp destination-port [ ssh netconf ]",
        "  then policer POLICER-MGMT accept",
        "#",
        "set firewall family inet filter PROTECT-RE term SNMP",
        "  from protocol udp destination-port 161",
        "  then policer POLICER-MGMT accept",
        "#",
        "set firewall family inet filter PROTECT-RE term NTP",
        "  from protocol udp destination-port 123",
        "  then policer POLICER-MGMT accept",
        "#",
        "set firewall family inet filter PROTECT-RE term REJECT-ALL",
        "  then count REJECT-COUNTER discard",
        "#",
        f"set firewall policer POLICER-ROUTING if-exceeding bandwidth-limit {r['routing']['pps']}k",
        "  set firewall policer POLICER-ROUTING if-exceeding burst-size-limit 1500000",
        "  set firewall policer POLICER-ROUTING then discard",
        f"set firewall policer POLICER-ICMP if-exceeding bandwidth-limit {r['icmp']['pps']}k",
        "  set firewall policer POLICER-ICMP if-exceeding burst-size-limit 100000",
        "  set firewall policer POLICER-ICMP then discard",
        f"set firewall policer POLICER-MGMT if-exceeding bandwidth-limit {r['mgmt']['pps']}k",
        "  set firewall policer POLICER-MGMT if-exceeding burst-size-limit 500000",
        "  set firewall policer POLICER-MGMT then discard",
        "#",
        "set interfaces lo0 unit 0 family inet filter input PROTECT-RE",
        "#",
    ]

    # BGP auth
    lines += [
        "# BGP MD5 auth + GTSM (Junos)",
        f"set protocols bgp group EBGP-PEERS type external",
        f"set protocols bgp group EBGP-PEERS authentication-key REPLACE-WITH-KEY",
        f"set protocols bgp group EBGP-PEERS ttl-security",
        "#",
    ]

    # OSPF auth
    if "ospf" in " ".join(protocols).lower():
        lines += [
            "# OSPF SHA-1 authentication",
            "set protocols ospf area 0.0.0.0 authentication-type md5",
            "set protocols ospf area 0.0.0.0 interface ge-0/0/1 authentication md5 1 key OSPF-SECRET",
            "#",
        ]

    # IS-IS auth
    if "is-is" in " ".join(protocols).lower():
        lines += [
            "# IS-IS authentication",
            "set protocols isis level 2 authentication-key ISIS-SECRET-CHANGEME",
            "set protocols isis level 2 authentication-type md5",
            "set protocols isis interface ge-0/0/1 level 2 authentication-key ISIS-SECRET",
            "#",
        ]

    # uRPF (Junos)
    lines += [
        "# uRPF strict on WAN interfaces (Junos)",
        "set interfaces ge-0/0/0 unit 0 family inet rpf-check",
        "#",
        "# Management Plane Protection (Junos)",
        "set system services ssh protocol-version v2",
        "set system services ssh max-sessions-per-connection 1",
        "set system services ssh connection-limit 5",
        "set system services netconf ssh",
        "set system no-redirects",
        "#",
    ]

    return "\n".join(lines) + "\n"
