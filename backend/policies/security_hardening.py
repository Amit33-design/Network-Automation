"""
Security Hardening Policy Generator
=====================================
Generates platform-specific device hardening config blocks covering:

  Layer-2 Security
  ─────────────────
  Port Security       — max 1 MAC per access port, violation shutdown,
                        aging inactivity 2 min
  BPDU Guard          — PortFast bpduguard default on all edge ports
  Root Guard          — Protect root bridge on distribution-facing ports
  Loop Guard          — Detect uni-directional link failures
  DAI                 — Dynamic ARP Inspection on all untrusted VLANs
  DHCP Snooping       — Untrust all access ports; trust uplinks only
  IP Source Guard     — Bind source IP to DHCP snooping lease
  Storm Control       — BC 20 % / MC 20 % / UC 80 % → shutdown + trap

  Device Hardening
  ─────────────────
  SSH                 — v2 only, 4096-bit RSA, AES-256-CTR, HMAC-SHA2-256,
                        DH group14-sha256 KEX, 60 s timeout, 3 retries
  TLS                 — min TLS 1.2 on HTTPS management interface
  Disable services    — tcp/udp small-servers, finger, pad, ip http,
                        source-route, gratuitous-arp, redirects (edge),
                        unreachables (rate-limited), tcp-small-servers, CDP/
                        LLDP on access edges, Telnet on VTY
  AAA / Login         — login block-for 60 / 5 / 30, delay 3 s,
                        on-failure + on-success log, quiet-mode ACL
  Banners             — legal MOTD, login banner, no hostname disclosure
  Console hardening   — timeout 5 0, no EXEC on aux, transport none on AUX
  VTY hardening       — timeout 10 0, access-class, logging sync, ssh only
  IPv6 RA Guard       — Block rogue Router Advertisements on access ports
  ICMP rate-limit     — unreachable 1 000/s, mask-reply disabled

Platforms: ios-xe, nxos, eos, junos
Returns '' for platforms where block is not applicable.

Layer applicability:
  campus-access / campus-dist  — full Layer-2 + device hardening
  campus-core / dc-spine / dc-leaf / fw — device hardening only (no port-sec)
  gpu-tor / gpu-spine          — device hardening (minimal L2 — storage fabric)
"""
from __future__ import annotations

from typing import Any


def generate_security_hardening(ctx: dict[str, Any], platform: str) -> str:
    """Return security hardening config block — dispatches by platform."""
    if platform == "ios-xe":
        return _ios_xe_hardening(ctx)
    if platform == "nxos":
        return _nxos_hardening(ctx)
    if platform == "eos":
        return _eos_hardening(ctx)
    if platform == "junos":
        return _junos_hardening(ctx)
    return ""


# ══════════════════════════════════════════════════════════════════════════
#  IOS-XE — Full hardening suite
# ══════════════════════════════════════════════════════════════════════════

def _ios_xe_hardening(ctx: dict) -> str:
    layer      = ctx.get("layer",     "campus-access")
    hostname   = ctx.get("hostname",  "SW-01")
    mgmt_ip    = ctx.get("mgmt_ip",   "10.100.1.1")
    mgmt_net   = ".".join(mgmt_ip.split(".")[:3]) + ".0"
    vlans      = ctx.get("vlans",     [])
    is_access  = layer in ("campus-access",)
    is_dist    = layer in ("campus-dist",)
    is_l2_dev  = is_access or is_dist
    ntp_server = ctx.get("ntp_server", "10.100.0.100")

    # Build VLAN list for DHCP snooping / DAI
    vlan_ids = [str(v.get("id", 1)) for v in vlans] if vlans else ["1", "10", "20", "30"]
    vlan_range = ",".join(vlan_ids)

    lines: list[str] = []

    # ── Header ──────────────────────────────────────────────────────────
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════════════════╗",
        "!-- ║   SECURITY HARDENING  —  IOS-XE                        ║",
        "!-- ╚══════════════════════════════════════════════════════════╝",
        "!",
    ]

    # ── Service disablement ──────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- DISABLE UNNECESSARY SERVICES",
        "!-- ─────────────────────────────────────────────────────────",
        "no service tcp-small-servers",
        "no service udp-small-servers",
        "no service finger",
        "no service pad",
        "no service config",
        "no ip http server",
        "no ip http secure-server",
        " remark Re-enable HTTPS only on MGMT interface if RESTCONF needed",
        "no ip bootp server",
        "no ip source-route",
        "no ip gratuitous-arps",
        "no ip domain-lookup",
        " remark Re-enable if DNS resolution required for management",
        "no ip identd",
        "no ip finger",
        "no cdp run",
        " remark Enable CDP selectively per interface (uplinks only)",
        "no lldp run",
        " remark Enable LLDP selectively per interface if required",
        "no ip dhcp conflict logging",
        " remark Use dedicated DHCP server — not device itself for production",
        "!",
        "!-- Disable MOP on all interfaces",
        "interface range GigabitEthernet0/0 - 48",
        " no mop enabled",
        " no mop sysid",
        "!",
        "!-- Disable redirects + unreachables on edge",
        "ip icmp rate-limit unreachable 1000",
        "!",
    ]

    # ── Banner ──────────────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- BANNERS",
        "!-- ─────────────────────────────────────────────────────────",
        "banner motd ^",
        "=========================================================",
        "  AUTHORIZED ACCESS ONLY",
        "  This system is the property of the organization.",
        "  Unauthorized access or use is prohibited and may be",
        "  subject to civil and criminal penalties.",
        "  All activity on this device is monitored and logged.",
        "=========================================================",
        "^",
        "!",
        "banner login ^",
        "  WARNING: Unauthorized access to this device is prohibited.",
        "  Disconnect immediately if you are not an authorized user.",
        "^",
        "!",
        "banner exec ^",
        "  Session is being recorded. All commands are logged.",
        "^",
        "!",
    ]

    # ── SSH hardening ────────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- SSH HARDENING (v2 only, 4096-bit RSA, AES-256)",
        "!-- ─────────────────────────────────────────────────────────",
        "ip ssh version 2",
        "ip ssh time-out 60",
        "ip ssh authentication-retries 3",
        "ip ssh dh-min-size 4096",
        "ip ssh source-interface GigabitEthernet0/0/5",
        " remark Bind SSH to MGMT interface only",
        "ip ssh server algorithm encryption aes256-ctr aes256-cbc",
        "ip ssh server algorithm mac hmac-sha2-256 hmac-sha2-512",
        "ip ssh server algorithm kex diffie-hellman-group14-sha256 ecdh-sha2-nistp256",
        "ip ssh server algorithm publickey ecdsa-sha2-nistp256 rsa-sha2-256 rsa-sha2-512",
        "ip ssh logging events",
        "ip ssh maxstartups 10",
        "ip ssh rsa keypair-name SSH-KEY",
        "crypto key generate rsa modulus 4096 label SSH-KEY",
        "!",
    ]

    # ── Login / AAA hardening ────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- LOGIN SECURITY (block-for, delay, quiet-mode)",
        "!-- ─────────────────────────────────────────────────────────",
        "login block-for 60 attempts 5 within 30",
        "login delay 3",
        "login on-failure log",
        "login on-success log",
        "!",
        "ip access-list standard ACL-QUIET-MODE",
        f" 10 permit {mgmt_net} 0.0.0.255",
        " 20 remark NOC source",
        " 30 permit 10.100.0.0 0.0.0.255",
        " 99 deny   any",
        "!",
        "login quiet-mode access-class ACL-QUIET-MODE",
        "!",
    ]

    # ── Console / AUX / VTY ──────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- CONSOLE / AUX / VTY HARDENING",
        "!-- ─────────────────────────────────────────────────────────",
        "line console 0",
        " exec-timeout 5 0",
        " transport input none",
        " remark Console access only via physical port — no remote",
        " logging synchronous",
        " login local",
        "!",
        "line aux 0",
        " exec-timeout 0 1",
        " transport input none",
        " transport output none",
        " no exec",
        " remark AUX port disabled — modem access not permitted",
        "!",
        "ip access-list standard ACL-MGMT-VTY",
        f" 10 permit {mgmt_net} 0.0.0.255",
        " 20 permit 10.100.0.0 0.0.0.255",
        " 99 deny   any log",
        "!",
        "line vty 0 4",
        " access-class ACL-MGMT-VTY in vrf-also",
        " exec-timeout 10 0",
        " transport input ssh",
        " transport output ssh",
        " logging synchronous",
        " login local",
        "!",
        "line vty 5 15",
        " access-class ACL-MGMT-VTY in vrf-also",
        " exec-timeout 10 0",
        " transport input ssh",
        " transport output ssh",
        " logging synchronous",
        " login local",
        "!",
    ]

    # ── NTP authentication ────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- NTP AUTHENTICATION",
        "!-- ─────────────────────────────────────────────────────────",
        "ntp authenticate",
        "ntp authentication-key 1 md5 NTP-SECRET-CHANGEME",
        "ntp trusted-key 1",
        f"ntp server {ntp_server} key 1 prefer",
        "ntp source GigabitEthernet0/0/5",
        " remark NTP sourced from MGMT interface",
        "ntp access-group peer 10",
        "ntp access-group serve 11",
        "ntp access-group serve-only 12",
        "ntp access-group query-only 13",
        "ip access-list standard 10",
        f" permit {ntp_server}",
        "ip access-list standard 11",
        " deny any",
        "ip access-list standard 12",
        " deny any",
        "ip access-list standard 13",
        " deny any",
        "!",
    ]

    # ── Password hardening ────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- PASSWORD + PRIVILEGE HARDENING",
        "!-- ─────────────────────────────────────────────────────────",
        "service password-encryption",
        "enable algorithm-type scrypt secret ENABLE-SECRET-CHANGEME",
        " remark Use type-9 (scrypt) — strongest available",
        "security passwords min-length 12",
        "!",
        "username admin privilege 15 algorithm-type scrypt secret ADMIN-SECRET-CHANGEME",
        "username readonly privilege 5 algorithm-type scrypt secret READONLY-CHANGEME",
        "!",
        "!-- AAA new-model must be configured (see aaa_policy.py)",
        "aaa new-model",
        "!",
    ]

    # ── Layer-2 security (access + distribution layers only) ─────────────
    if is_l2_dev:
        lines += [
            "!",
            "!-- ═══════════════════════════════════════════════════════",
            "!-- LAYER-2 SECURITY",
            "!-- ═══════════════════════════════════════════════════════",
            "!",

            "!-- DHCP Snooping",
            "ip dhcp snooping",
            f"ip dhcp snooping vlan {vlan_range}",
            "no ip dhcp snooping information option",
            " remark Disable option 82 insertion unless relay required",
            "ip dhcp snooping database flash:dhcp-snooping.db",
            "ip dhcp snooping database write-delay 15",
            "!",

            "!-- Dynamic ARP Inspection",
            f"ip arp inspection vlan {vlan_range}",
            "ip arp inspection validate src-mac dst-mac ip",
            "ip arp inspection log-buffer entries 1024",
            "ip arp inspection log-buffer logs 100 interval 10",
            "!",

            "!-- Global spanning-tree hardening",
            "spanning-tree portfast bpduguard default",
            "spanning-tree portfast default",
            " remark PortFast only on access ports — DO NOT enable on trunk ports",
            "spanning-tree loopguard default",
            "spanning-tree extend system-id",
            "!",

            "!-- Storm control defaults (applied per access interface below)",
            "!",
        ]

        if is_access:
            lines += [
                "!-- Access port hardening (apply to all user-facing ports)",
                "!-- Adjust interface range to match installed modules",
                "interface range GigabitEthernet1/0/1 - 24",
                " description USER-ACCESS-PORT",
                " switchport mode access",
                " switchport nonegotiate",
                " spanning-tree portfast",
                " spanning-tree bpduguard enable",
                " ip arp inspection limit rate 100",
                " remark DAI rate limit — 100 ARP/s per port",

                "!-- Port security",
                " switchport port-security maximum 1",
                " switchport port-security violation shutdown",
                " switchport port-security aging time 2",
                " switchport port-security aging type inactivity",
                " switchport port-security",

                "!-- IP Source Guard",
                " ip verify source",

                "!-- Storm control",
                " storm-control broadcast level 20.00 10.00",
                " storm-control multicast level 20.00 10.00",
                " storm-control unicast level 80.00 70.00",
                " storm-control action shutdown",
                " storm-control action trap",

                "!-- Disable CDP/LLDP on access ports",
                " no cdp enable",
                " no lldp transmit",
                " no lldp receive",

                "!-- Disable MOP + proxy-arp",
                " no mop enabled",
                " no ip proxy-arp",
                " no ip redirects",
                " no ip unreachables",
                "!",
            ]

        if is_dist or is_access:
            lines += [
                "!-- Uplink / trunk ports — trust for DHCP snooping + DAI",
                "!-- (Adjust interface names to match your hardware)",
                "interface GigabitEthernet1/1/1",
                " description UPLINK-TO-CORE",
                " ip dhcp snooping trust",
                " ip arp inspection trust",
                " spanning-tree guard root",
                " remark Root guard on distribution uplinks",
                " cdp enable",
                " no spanning-tree portfast",
                "!",
                "interface GigabitEthernet1/1/2",
                " description UPLINK-TO-CORE-2",
                " ip dhcp snooping trust",
                " ip arp inspection trust",
                " spanning-tree guard root",
                " cdp enable",
                " no spanning-tree portfast",
                "!",
            ]

    # ── IPv6 RA Guard ────────────────────────────────────────────────────
    if is_l2_dev:
        lines += [
            "!-- IPv6 RA Guard (block rogue Router Advertisements)",
            "ipv6 nd raguard policy RAGUARD-ACCESS",
            " device-role host",
            "!",
            "interface range GigabitEthernet1/0/1 - 24",
            " ipv6 nd raguard attach-policy RAGUARD-ACCESS",
            "!",
        ]

    # ── Logging hardening ─────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- LOGGING HARDENING",
        "!-- ─────────────────────────────────────────────────────────",
        "logging on",
        "logging buffered 512000",
        "logging buffered informational",
        "logging console critical",
        "logging monitor informational",
        "logging trap informational",
        "logging source-interface GigabitEthernet0/0/5",
        " remark Bind syslog to MGMT interface",
        "logging userinfo",
        "!-- Timestamps on all logs",
        "service timestamps log datetime msec localtime show-timezone",
        "service timestamps debug datetime msec localtime show-timezone",
        "!-- Log auth/exec events",
        "archive",
        " log config",
        "  logging enable",
        "  notify syslog contenttype plaintext",
        "  hidekeys",
        "!",
    ]

    # ── Misc IP hardening ─────────────────────────────────────────────────
    lines += [
        "!-- ─────────────────────────────────────────────────────────",
        "!-- MISCELLANEOUS IP HARDENING",
        "!-- ─────────────────────────────────────────────────────────",
        "no ip icmp redirect",
        " remark Disable ICMP redirects globally",
        "ip tcp synwait-time 10",
        "ip tcp window-size 65535",
        "ip tcp selective-ack",
        "ip tcp timestamp",
        "!-- Limit IP options processing",
        "ip options drop",
        " remark Drop packets with IP options (except RSVP if needed)",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  NX-OS — Device Hardening
# ══════════════════════════════════════════════════════════════════════════

def _nxos_hardening(ctx: dict) -> str:
    mgmt_ip    = ctx.get("mgmt_ip",    "10.100.1.1")
    mgmt_net   = ".".join(mgmt_ip.split(".")[:3]) + ".0"
    ntp_server = ctx.get("ntp_server", "10.100.0.100")
    vlans      = ctx.get("vlans",      [])
    vlan_ids   = [str(v.get("id", 1)) for v in vlans] if vlans else ["1", "10", "20", "30"]
    vlan_range = ",".join(vlan_ids)

    lines: list[str] = []

    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════════════════╗",
        "!-- ║   SECURITY HARDENING  —  NX-OS                         ║",
        "!-- ╚══════════════════════════════════════════════════════════╝",
        "!",

        "!-- Feature enablement required for hardening",
        "feature ssh",
        "feature tacacs+",
        "feature dhcp",
        "feature ntp",
        "feature port-security",
        "!",

        "!-- Disable Telnet",
        "no feature telnet",
        "!",

        "!-- SSH hardening",
        "ssh key rsa 4096",
        "ssh version 2",
        "ssh login-attempts 3",
        "!",

        "!-- Privilege escalation protection",
        "username admin password 0 CHANGEME role network-admin",
        " remark Use TACACS+ for production — local user as fallback only",
        "!",

        "!-- Enable password encryption",
        "username admin password 5 HASHED-CHANGEME",
        "!",

        "!-- AAA / TACACS+ (refer to aaa_policy.py for full config)",
        "aaa authentication login default group tacacs+ local",
        "aaa authorization commands default group tacacs+ local",
        "aaa accounting default group tacacs+",
        "!",

        "!-- NTP authentication",
        "ntp authenticate",
        "ntp authentication-key 1 md5 NTP-SECRET-CHANGEME",
        "ntp trusted-key 1",
        f"ntp server {ntp_server} key 1 use-vrf management",
        "!",

        "!-- DHCP snooping",
        f"ip dhcp snooping vlan {vlan_range}",
        "ip dhcp snooping",
        "no ip dhcp snooping information option",
        "!",

        "!-- Dynamic ARP Inspection",
        f"ip arp inspection vlan {vlan_range}",
        "!",

        "!-- Port security on access ports",
        "interface Ethernet1/1",
        " description USER-ACCESS",
        " switchport port-security maximum 1",
        " switchport port-security violation shutdown",
        " switchport port-security",
        " spanning-tree port type edge",
        " spanning-tree bpduguard enable",
        " storm-control broadcast level 20.00",
        " storm-control multicast level 20.00",
        " storm-control action shutdown",
        "!",

        "!-- VTY hardening",
        "line vty",
        " session-limit 10",
        " exec-timeout 10",
        " transport input ssh",
        "!",

        "!-- Banner",
        "banner motd $",
        "  AUTHORIZED ACCESS ONLY. This system is monitored.",
        "$",
        "!",

        "!-- Logging",
        "logging level default 5",
        "logging timestamp milliseconds",
        "logging logfile MESSAGES 5",
        f"logging server {mgmt_ip} 5 use-vrf management",
        "!",

        "!-- Disable CDP on all access ports, enable on uplinks",
        "no cdp enable",
        "interface Ethernet1/49-50",
        " cdp enable",
        "!",

        "!-- IPv6 RA Guard (NX-OS)",
        "ipv6 nd raguard policy HOST-FACING",
        " device-role host",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  Arista EOS — Device Hardening
# ══════════════════════════════════════════════════════════════════════════

def _eos_hardening(ctx: dict) -> str:
    mgmt_ip    = ctx.get("mgmt_ip",    "10.100.1.1")
    mgmt_net   = ".".join(mgmt_ip.split(".")[:3]) + ".0"
    ntp_server = ctx.get("ntp_server", "10.100.0.100")
    layer      = ctx.get("layer",      "gpu-tor")

    lines: list[str] = []

    lines += [
        "!",
        "! ╔══════════════════════════════════════════════════════════╗",
        "! ║   SECURITY HARDENING  —  ARISTA EOS                    ║",
        "! ╚══════════════════════════════════════════════════════════╝",
        "!",

        "! SSH hardening",
        "management ssh",
        "   idle-timeout 10",
        "   server-port 22",
        "   authentication mode keyboard-interactive",
        "   connection limit 10",
        "   fips restrictions",
        "   rsa key size minimum 4096",
        "!",

        "! Disable Telnet + HTTP",
        "management telnet",
        "   shutdown",
        "!",

        "! HTTPS only on MGMT VRF",
        "management api http-commands",
        "   protocol https",
        "   no protocol http",
        "   vrf MGMT",
        "!",

        "! Banner",
        "banner motd",
        "AUTHORIZED ACCESS ONLY. Unauthorized use is prohibited and monitored.",
        "EOF",
        "!",

        "! Login security",
        "aaa authentication login default local",
        "aaa authorization commands all default local",
        "!",

        "! NTP authentication",
        "ntp authenticate",
        "ntp authentication-key 1 sha1 NTP-SECRET-CHANGEME",
        "ntp trusted-key 1",
        f"ntp server {ntp_server} iburst key 1 vrf MGMT",
        "!",

        "! Logging",
        "logging on",
        "logging buffered 10000",
        f"logging host {mgmt_ip} vrf MGMT",
        "logging format timestamp high-resolution",
        "logging synchronous level critical",
        "!",

        "! Password policy",
        "management security",
        "   password minimum length 12",
        "   password minimum upper-case 1",
        "   password minimum lower-case 1",
        "   password minimum special-character 1",
        "   password minimum digit 1",
        "!",

        "! VTY hardening",
        "management console",
        "   idle-timeout 5",
        "!",

        "! Disable unused protocols",
        "no ip routing protocols ribd",
        " remark Enable only protocols in use",
        "!",
    ]

    if layer in ("campus-access", "campus-dist"):
        lines += [
            "! Layer-2 security (EOS)",
            "spanning-tree portfast default",
            "spanning-tree portfast bpduguard default",
            "!",
            "! Port security on access ports",
            "interface Ethernet1-24",
            "   port-security maximum 1",
            "   port-security violation shutdown",
            "   port-security",
            "   storm-control broadcast level 20",
            "   storm-control multicast level 20",
            "   storm-control action shutdown",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════
#  Junos — Device Hardening
# ══════════════════════════════════════════════════════════════════════════

def _junos_hardening(ctx: dict) -> str:
    mgmt_ip    = ctx.get("mgmt_ip",    "10.100.1.1")
    ntp_server = ctx.get("ntp_server", "10.100.0.100")

    lines: list[str] = []

    lines += [
        "!",
        "# ╔══════════════════════════════════════════════════════════╗",
        "# ║   SECURITY HARDENING  —  JUNOS                         ║",
        "# ╚══════════════════════════════════════════════════════════╝",
        "#",

        "# SSH hardening",
        "set system services ssh protocol-version v2",
        "set system services ssh max-sessions-per-connection 1",
        "set system services ssh connection-limit 5",
        "set system services ssh rate-limit 3",
        "set system services ssh root-login deny",
        "set system services ssh no-passwords",
        " # key-based auth only — configure public keys separately",
        "#",

        "# Disable insecure services",
        "delete system services telnet",
        "delete system services ftp",
        "delete system services rsh",
        "delete system services rlogin",
        "delete system services finger",
        "#",

        "# HTTPS management only",
        "set system services web-management https system-generated-certificate",
        "set system services web-management https port 443",
        "#",

        "# NETCONF over SSH",
        "set system services netconf ssh",
        "#",

        "# Banner",
        "set system login message \"AUTHORIZED ACCESS ONLY. All activity is monitored.\\n\"",
        "#",

        "# Login settings",
        "set system login retry-options tries-before-disconnect 3",
        "set system login retry-options backoff-threshold 2",
        "set system login retry-options backoff-factor 5",
        "set system login retry-options minimum-time 30",
        "set system login retry-options lockout-period 5",
        "#",

        "# Password policy",
        "set system login password minimum-length 12",
        "set system login password minimum-upper-cases 1",
        "set system login password minimum-lower-cases 1",
        "set system login password minimum-numerics 1",
        "set system login password minimum-punctuations 1",
        "#",

        "# NTP authentication",
        f"set system ntp server {ntp_server} version 4",
        "set system ntp authentication-key 1 type md5 value NTP-SECRET-CHANGEME",
        "set system ntp trusted-key 1",
        "#",

        "# SYSLOG",
        f"set system syslog host {mgmt_ip} any info",
        "set system syslog file messages any notice",
        "set system syslog file messages authorization info",
        "set system syslog time-format millisecond",
        "#",

        "# Disable DHCP client on mgmt",
        "delete interfaces fxp0 unit 0 family inet dhcp",
        f"set interfaces fxp0 unit 0 family inet address {mgmt_ip}/24",
        "#",

        "# Commit",
        "commit",
        "#",
    ]

    return "\n".join(lines) + "\n"
