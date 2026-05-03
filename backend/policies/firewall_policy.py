"""
Firewall Policy Generator
==========================
Generates platform-specific firewall configs:

  IOS-XE ZBF   — Zone-Based Firewall (stateful) with:
                  6 security zones (OUTSIDE/INSIDE/DMZ/SERVER/MGMT/GUEST)
                  zone-pair inspect policies per traffic direction
                  NAT/PAT (interface overload + static server NAT)
                  Parameter-maps for URL filter / threat-defence hooks
                  TCP syn-flood mitigation via inspect rate-limit

  Cisco ASA    — access-groups, object-groups, NAT, MPF
  FortiGate    — address objects, service objects, policy table, NAT,
                  SSL inspection, IPS, web filter references
  Palo Alto    — address objects, application groups, security rules,
                  NAT rules, security profiles references

  NX-OS / EOS  — Return '' (no host FW; use perimeter device)

Applies to:
  - layer == 'fw'                  (dedicated perimeter firewall device)
  - layer in ('campus-core','dc-spine') when inline ZBF is selected

Zones:
  OUTSIDE  — untrusted (internet / WAN)
  INSIDE   — trusted corporate LAN
  DMZ      — semi-trusted (public-facing servers)
  SERVER   — protected server farm / DC
  MGMT     — out-of-band management network
  GUEST    — guest wireless / IoT
"""
from __future__ import annotations
from typing import Any


# ── Zone model ────────────────────────────────────────────────────────────

ZONES = {
    "OUTSIDE": {"trust": 0,   "desc": "Untrusted internet/WAN"},
    "INSIDE":  {"trust": 100, "desc": "Trusted corporate LAN"},
    "DMZ":     {"trust": 50,  "desc": "Semi-trusted public-facing servers"},
    "SERVER":  {"trust": 80,  "desc": "Protected server farm"},
    "MGMT":    {"trust": 90,  "desc": "Out-of-band management"},
    "GUEST":   {"trust": 10,  "desc": "Guest wireless / IoT"},
}

# ── Services / apps to inspect per direction ─────────────────────────────

INSPECT_INSIDE_OUTSIDE = [
    "http", "https", "dns", "ntp", "ftp", "smtp", "pop3", "imap",
    "icmp", "ssh", "tcp",
]
INSPECT_OUTSIDE_DMZ = ["http", "https", "smtp", "dns"]
INSPECT_INSIDE_DMZ  = ["http", "https", "ssh", "mysql", "tcp"]
INSPECT_INSIDE_SERVER = ["http", "https", "ssh", "nfs", "tcp", "udp"]
INSPECT_GUEST_OUTSIDE = ["http", "https", "dns"]


def generate_firewall_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return firewall policy config block — dispatches by platform + FW product."""
    layer    = ctx.get("layer", "fw")
    fw_vendor= _detect_fw_vendor(ctx)

    # Non-firewall layers without inline ZBF — skip
    if layer not in ("fw",) and not ctx.get("inline_zbf", False):
        return ""

    if fw_vendor == "fortinet":
        return _fortigate(ctx)
    if fw_vendor == "paloalto":
        return _paloalto(ctx)
    if fw_vendor == "asa":
        return _cisco_asa(ctx)

    # Default — IOS-XE ZBF (Catalyst with integrated security / IOS-XE router)
    if platform in ("ios-xe", "nxos"):
        return _ios_xe_zbf(ctx)

    return ""


def _detect_fw_vendor(ctx: dict) -> str:
    """Detect firewall platform from product_id or extra context."""
    pid = str(ctx.get("product_id", "")).lower()
    if any(k in pid for k in ("fortigate", "fg-", "fortinet")):
        return "fortinet"
    if any(k in pid for k in ("pa-", "panos", "paloalto", "palo")):
        return "paloalto"
    if any(k in pid for k in ("asa", "ftd", "firepower")):
        return "asa"
    return "ios-xe-zbf"


# ── IOS-XE Zone-Based Firewall ───────────────────────────────────────────

def _ios_xe_zbf(ctx: dict) -> str:
    mgmt_ip   = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net  = ".".join(mgmt_ip.split(".")[:3]) + ".0"
    inside_net= ctx.get("inside_network", "192.168.0.0")
    dmz_net   = ctx.get("dmz_network",    "10.200.0.0")
    server_net= ctx.get("server_network",  "10.201.0.0")
    guest_net = ctx.get("guest_network",   "192.168.50.0")
    outside_if= ctx.get("outside_interface", "GigabitEthernet0/0/0")
    inside_if = ctx.get("inside_interface",  "GigabitEthernet0/0/1")
    dmz_if    = ctx.get("dmz_interface",     "GigabitEthernet0/0/2")
    wan_ip    = ctx.get("wan_ip", "")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔════════════════════════════════════════════════════╗",
        "!-- ║   ZONE-BASED FIREWALL — IOS-XE (ZBF)             ║",
        "!-- ╚════════════════════════════════════════════════════╝",
        "!",

        # ── Security zones
        "!-- Security Zone Definitions",
        "zone security OUTSIDE",
        " description Untrusted Internet / WAN",
        "zone security INSIDE",
        " description Trusted corporate LAN",
        "zone security DMZ",
        " description Semi-trusted public-facing servers",
        "zone security SERVER",
        " description Protected server farm",
        "zone security MGMT",
        " description Out-of-band management",
        "zone security GUEST",
        " description Guest wireless and IoT",
        "!",

        # ── Parameter maps
        "!-- Parameter maps",
        "parameter-map type inspect INSPECT-PARAMS",
        " max-incomplete low 18000",
        " max-incomplete high 20000",
        " one-minute low 18000",
        " one-minute high 20000",
        " tcp max-incomplete host 50 block-time 0",
        " sessions maximum 131072",
        " alert on",
        " audit-trail on",
        "!",
        "parameter-map type inspect DNS-PARAMS",
        " dns-timeout 10",
        "!",
        "parameter-map type urpf URPF-STRICT",
        " mode strict allow-self-ping",
        "!",

        # ── Class maps
        "!-- Class maps — traffic classification",
        "class-map type inspect match-any CM-INSIDE-OUTSIDE",
        " match protocol http",
        " match protocol https",
        " match protocol ftp",
        " match protocol dns",
        " match protocol smtp",
        " match protocol pop3",
        " match protocol imap",
        " match protocol ntp",
        " match protocol icmp",
        " match protocol ssh",
        " match protocol tcp",
        " match protocol udp",
        "!",
        "class-map type inspect match-any CM-OUTSIDE-DMZ",
        " match protocol http",
        " match protocol https",
        " match protocol smtp",
        " match protocol dns",
        "!",
        "class-map type inspect match-any CM-INSIDE-DMZ",
        " match protocol http",
        " match protocol https",
        " match protocol ssh",
        " match protocol tcp",
        "!",
        "class-map type inspect match-any CM-INSIDE-SERVER",
        " match protocol http",
        " match protocol https",
        " match protocol ssh",
        " match protocol nfs",
        " match protocol tcp",
        " match protocol udp",
        "!",
        "class-map type inspect match-any CM-GUEST-OUTSIDE",
        " match protocol http",
        " match protocol https",
        " match protocol dns",
        "!",
        "class-map type inspect match-any CM-MGMT-ANY",
        " match protocol ssh",
        " match protocol snmp",
        " match protocol ntp",
        " match protocol syslog",
        " match protocol icmp",
        "!",
        "class-map type inspect match-all CM-ROUTING-PROTOCOLS",
        " match access-group name ACL-ROUTING-PROTO",
        "!",
        "ip access-list extended ACL-ROUTING-PROTO",
        " permit tcp any any eq 179",
        " remark BGP",
        " permit ospf any any",
        " remark OSPF",
        " permit 89 any any",
        " permit udp any any eq 646",
        " remark LDP",
        " permit udp any any eq 3784",
        " remark BFD",
        "!",

        # ── Policy maps
        "!-- Policy maps — action per class",
        "policy-map type inspect PM-INSIDE-TO-OUTSIDE",
        " class type inspect CM-ROUTING-PROTOCOLS",
        "  pass",
        " class type inspect CM-INSIDE-OUTSIDE",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-OUTSIDE-TO-INSIDE",
        " class class-default",
        "  drop log",
        "  remark All unsolicited inbound traffic dropped — stateful return allowed",
        "!",
        "policy-map type inspect PM-OUTSIDE-TO-DMZ",
        " class type inspect CM-OUTSIDE-DMZ",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-INSIDE-TO-DMZ",
        " class type inspect CM-INSIDE-DMZ",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-DMZ-TO-OUTSIDE",
        " class type inspect CM-GUEST-OUTSIDE",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-DMZ-TO-INSIDE",
        " class class-default",
        "  drop log",
        "  remark DMZ never initiates to INSIDE",
        "!",
        "policy-map type inspect PM-INSIDE-TO-SERVER",
        " class type inspect CM-INSIDE-SERVER",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-GUEST-TO-OUTSIDE",
        " class type inspect CM-GUEST-OUTSIDE",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",
        "policy-map type inspect PM-GUEST-TO-INSIDE",
        " class class-default",
        "  drop log",
        "  remark Guest NEVER reaches corporate INSIDE",
        "!",
        "policy-map type inspect PM-MGMT-ZONE",
        " class type inspect CM-MGMT-ANY",
        "  inspect INSPECT-PARAMS",
        " class class-default",
        "  drop log",
        "!",

        # ── Zone pairs
        "!-- Zone pairs — apply policies",
        "zone-pair security ZP-INSIDE-OUTSIDE source INSIDE destination OUTSIDE",
        " service-policy type inspect PM-INSIDE-TO-OUTSIDE",
        "!",
        "zone-pair security ZP-OUTSIDE-INSIDE source OUTSIDE destination INSIDE",
        " service-policy type inspect PM-OUTSIDE-TO-INSIDE",
        "!",
        "zone-pair security ZP-OUTSIDE-DMZ source OUTSIDE destination DMZ",
        " service-policy type inspect PM-OUTSIDE-TO-DMZ",
        "!",
        "zone-pair security ZP-INSIDE-DMZ source INSIDE destination DMZ",
        " service-policy type inspect PM-INSIDE-TO-DMZ",
        "!",
        "zone-pair security ZP-DMZ-OUTSIDE source DMZ destination OUTSIDE",
        " service-policy type inspect PM-DMZ-TO-OUTSIDE",
        "!",
        "zone-pair security ZP-DMZ-INSIDE source DMZ destination INSIDE",
        " service-policy type inspect PM-DMZ-TO-INSIDE",
        "!",
        "zone-pair security ZP-INSIDE-SERVER source INSIDE destination SERVER",
        " service-policy type inspect PM-INSIDE-TO-SERVER",
        "!",
        "zone-pair security ZP-GUEST-OUTSIDE source GUEST destination OUTSIDE",
        " service-policy type inspect PM-GUEST-TO-OUTSIDE",
        "!",
        "zone-pair security ZP-GUEST-INSIDE source GUEST destination INSIDE",
        " service-policy type inspect PM-GUEST-TO-INSIDE",
        "!",
        "zone-pair security ZP-MGMT source MGMT destination INSIDE",
        " service-policy type inspect PM-MGMT-ZONE",
        "!",

        # ── Interface zone assignment
        "!-- Interface zone assignments (adjust interface names to your hardware)",
        f"interface {outside_if}",
        " description WAN-TO-INTERNET",
        " zone-member security OUTSIDE",
        " ip verify unicast source reachable-via rx",
        " remark uRPF strict on untrusted interface",
        " no ip proxy-arp",
        "!",
        f"interface {inside_if}",
        " description LAN-INSIDE",
        " zone-member security INSIDE",
        "!",
        f"interface {dmz_if}",
        " description DMZ-SERVERS",
        " zone-member security DMZ",
        "!",
        "interface GigabitEthernet0/0/3",
        " description SERVER-FARM",
        " zone-member security SERVER",
        "!",
        "interface GigabitEthernet0/0/4",
        " description GUEST-WIFI",
        " zone-member security GUEST",
        "!",
        "interface GigabitEthernet0/0/5",
        f" description MGMT-OOB",
        " zone-member security MGMT",
        "!",

        # ── NAT / PAT
        "!-- NAT / PAT",
        "ip access-list standard NAT-INSIDE-SOURCES",
        f" permit {inside_net} 0.0.255.255",
        f" permit {server_net} 0.0.255.255",
        "!",
        "ip nat inside source list NAT-INSIDE-SOURCES interface " + outside_if + " overload",
        "remark Dynamic PAT — all inside → internet",
        "!",
        "!-- Static NAT example (web server in DMZ)",
        f"ip nat inside source static tcp 10.200.0.10 80 {wan_ip or 'X.X.X.X'} 80",
        f"ip nat inside source static tcp 10.200.0.10 443 {wan_ip or 'X.X.X.X'} 443",
        f"ip nat inside source static tcp 10.200.0.11 25 {wan_ip or 'X.X.X.X'} 25",
        " remark Static NAT: DMZ web+mail servers",
        "!",
        f"interface {outside_if}",
        " ip nat outside",
        "!",
        f"interface {inside_if}",
        " ip nat inside",
        "!",
        f"interface {dmz_if}",
        " ip nat inside",
        "!",

        # ── TCP syn-flood mitigation
        "!-- TCP syn-flood mitigation (TCP intercept)",
        "ip tcp intercept list TCP-INTERCEPT-LIST",
        "ip tcp intercept mode intercept",
        "ip tcp intercept max-incomplete high 1100",
        "ip tcp intercept max-incomplete low 900",
        "ip tcp intercept one-minute high 1100",
        "ip tcp intercept one-minute low 900",
        "ip tcp intercept drop-mode oldest",
        "ip access-list extended TCP-INTERCEPT-LIST",
        f" permit tcp any {dmz_net} 0.0.0.255",
        "!",

        # ── URL filtering hook (Cisco Umbrella)
        "!-- URL filtering / Cisco Umbrella DNS redirect (optional)",
        "!-- parameter-map type umbrella global",
        "!--   token <UMBRELLA_TOKEN>",
        "!--   dnscrypt",
        "!-- interface " + outside_if,
        "!--   umbrella out",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Cisco ASA ────────────────────────────────────────────────────────────

def _cisco_asa(ctx: dict) -> str:
    inside_net = ctx.get("inside_network", "192.168.0.0")
    dmz_net    = ctx.get("dmz_network",    "10.200.0.0")
    server_net = ctx.get("server_network",  "10.201.0.0")
    guest_net  = ctx.get("guest_network",   "192.168.50.0")
    wan_ip     = ctx.get("wan_ip",          "X.X.X.X")
    hostname   = ctx.get("hostname",        "ASA-FW-01")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════╗",
        "!-- ║   CISCO ASA FIREWALL POLICY                  ║",
        "!-- ╚══════════════════════════════════════════════╝",
        "!",
        f"hostname {hostname}",
        "!",
        "!-- Interface security levels",
        "interface GigabitEthernet0/0",
        " nameif outside",
        " security-level 0",
        " ip address dhcp setroute",
        " no shutdown",
        "!",
        "interface GigabitEthernet0/1",
        " nameif inside",
        " security-level 100",
        f" ip address {inside_net.rsplit('.',1)[0]}.1 255.255.255.0",
        " no shutdown",
        "!",
        "interface GigabitEthernet0/2",
        " nameif dmz",
        " security-level 50",
        f" ip address {dmz_net.rsplit('.',1)[0]}.1 255.255.255.0",
        " no shutdown",
        "!",
        "interface GigabitEthernet0/3",
        " nameif server",
        " security-level 80",
        f" ip address {server_net.rsplit('.',1)[0]}.1 255.255.255.0",
        " no shutdown",
        "!",
        "interface GigabitEthernet0/4",
        " nameif guest",
        " security-level 10",
        f" ip address {guest_net.rsplit('.',1)[0]}.1 255.255.255.0",
        " no shutdown",
        "!",

        "!-- Object groups — Networks",
        f"object network INSIDE-NET",
        f" subnet {inside_net} 255.255.0.0",
        f"object network DMZ-NET",
        f" subnet {dmz_net} 255.255.255.0",
        f"object network SERVER-NET",
        f" subnet {server_net} 255.255.255.0",
        f"object network GUEST-NET",
        f" subnet {guest_net} 255.255.255.0",
        "object network WAN-IP",
        f" host {wan_ip}",
        "!",
        "object network DMZ-WEBSERVER",
        " host 10.200.0.10",
        "object network DMZ-MAILSERVER",
        " host 10.200.0.11",
        "!",

        "!-- Object groups — Services",
        "object-group service WEB-SERVICES tcp",
        " port-object eq www",
        " port-object eq 443",
        "object-group service MAIL-SERVICES tcp",
        " port-object eq smtp",
        " port-object eq pop3",
        " port-object eq imap4",
        "object-group service MGMT-SERVICES tcp",
        " port-object eq ssh",
        " port-object eq 830",
        " remark NETCONF",
        "!",

        "!-- NAT rules",
        "!-- Dynamic PAT: INSIDE → OUTSIDE",
        "nat (inside,outside) source dynamic INSIDE-NET interface",
        "nat (server,outside) source dynamic SERVER-NET interface",
        "!-- Static NAT: DMZ web server",
        "nat (dmz,outside) source static DMZ-WEBSERVER WAN-IP service WEB-SERVICES WEB-SERVICES",
        "nat (dmz,outside) source static DMZ-MAILSERVER WAN-IP service MAIL-SERVICES MAIL-SERVICES",
        "!",

        "!-- Access lists — OUTSIDE inbound",
        "access-list OUTSIDE-IN extended permit tcp any object DMZ-WEBSERVER object-group WEB-SERVICES",
        "access-list OUTSIDE-IN extended permit tcp any object DMZ-MAILSERVER object-group MAIL-SERVICES",
        "access-list OUTSIDE-IN extended deny ip any any log",
        "access-group OUTSIDE-IN in interface outside",
        "!",

        "!-- Access lists — GUEST (restrict to internet only)",
        "access-list GUEST-OUT extended permit tcp object GUEST-NET any object-group WEB-SERVICES",
        "access-list GUEST-OUT extended permit udp object GUEST-NET any eq dns",
        "access-list GUEST-OUT extended deny ip object GUEST-NET object INSIDE-NET log",
        "access-list GUEST-OUT extended deny ip object GUEST-NET object SERVER-NET log",
        "access-list GUEST-OUT extended deny ip object GUEST-NET object DMZ-NET log",
        "access-group GUEST-OUT in interface guest",
        "!",

        "!-- DMZ cannot reach INSIDE",
        "access-list DMZ-IN extended deny ip object DMZ-NET object INSIDE-NET log",
        "access-list DMZ-IN extended deny ip object DMZ-NET object SERVER-NET log",
        "access-list DMZ-IN extended permit ip object DMZ-NET any",
        "access-group DMZ-IN in interface dmz",
        "!",

        "!-- Threat detection + shun",
        "threat-detection basic-threat",
        "threat-detection statistics access-list",
        "threat-detection statistics host number-of-rate 3",
        "threat-detection statistics port",
        "threat-detection statistics protocol",
        "threat-detection statistics tcp-intercept rate-interval 30 burst-rate 400 average-rate 200",
        "!",

        "!-- MPF — Modular Policy Framework (inspect)",
        "policy-map global_policy",
        " class inspection_default",
        "  inspect dns preset_dns_map",
        "  inspect ftp",
        "  inspect h323 h225",
        "  inspect h323 ras",
        "  inspect ip-options",
        "  inspect netbios",
        "  inspect rsh",
        "  inspect rtsp",
        "  inspect skinny",
        "  inspect esmtp",
        "  inspect sqlnet",
        "  inspect sunrpc",
        "  inspect tftp",
        "  inspect sip",
        "  inspect xdmcp",
        " class class-default",
        "  set connection advanced-options tcp-state-bypass",
        "service-policy global_policy global",
        "!",

        "!-- SSH access (management only)",
        "ssh timeout 10",
        "ssh version 2",
        "crypto key generate rsa modulus 4096",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── FortiGate ─────────────────────────────────────────────────────────────

def _fortigate(ctx: dict) -> str:
    inside_net = ctx.get("inside_network", "192.168.0.0")
    dmz_net    = ctx.get("dmz_network",    "10.200.0.0")
    server_net = ctx.get("server_network",  "10.201.0.0")
    guest_net  = ctx.get("guest_network",   "192.168.50.0")
    hostname   = ctx.get("hostname",        "FGT-FW-01")

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════════════╗",
        "! ║   FORTINET FORTIGATE FIREWALL POLICY         ║",
        "! ╚══════════════════════════════════════════════╝",
        "!",
        f"config system global",
        f"    set hostname {hostname}",
        "    set admin-ssh-port 22",
        "    set ssh-encryption aes256-cbc aes256-gcm",
        "    set strong-crypto enable",
        "    set admin-lockout-threshold 5",
        "    set admin-lockout-duration 60",
        "    set timezone 00",
        "end",
        "!",
        "config system interface",
        "    edit port1",
        "        set alias WAN",
        "        set mode dhcp",
        "        set role wan",
        "    next",
        "    edit port2",
        "        set alias INSIDE",
        f"        set ip {inside_net.rsplit('.',1)[0]}.1 255.255.255.0",
        "        set allowaccess ping ssh https",
        "        set role lan",
        "    next",
        "    edit port3",
        "        set alias DMZ",
        f"        set ip {dmz_net.rsplit('.',1)[0]}.1 255.255.255.0",
        "        set allowaccess ping",
        "        set role dmz",
        "    next",
        "    edit port4",
        "        set alias GUEST",
        f"        set ip {guest_net.rsplit('.',1)[0]}.1 255.255.255.0",
        "        set allowaccess ping",
        "    next",
        "end",
        "!",
        "!-- Address objects",
        "config firewall address",
        "    edit INSIDE-NET",
        f"        set subnet {inside_net} 255.255.0.0",
        "    next",
        "    edit DMZ-NET",
        f"        set subnet {dmz_net} 255.255.255.0",
        "    next",
        "    edit SERVER-NET",
        f"        set subnet {server_net} 255.255.255.0",
        "    next",
        "    edit GUEST-NET",
        f"        set subnet {guest_net} 255.255.255.0",
        "    next",
        "    edit DMZ-WEBSERVER",
        "        set type iprange",
        "        set start-ip 10.200.0.10",
        "        set end-ip 10.200.0.10",
        "    next",
        "    edit MGMT-NET",
        "        set subnet 10.100.0.0 255.255.255.0",
        "    next",
        "end",
        "!",
        "!-- Address groups",
        "config firewall addrgrp",
        "    edit INTERNET-USERS",
        "        set member INSIDE-NET SERVER-NET",
        "    next",
        "end",
        "!",
        "!-- Security profiles",
        "config ips sensor",
        "    edit IPS-CRITICAL",
        "        set block-malicious-url enable",
        "        config entries",
        "            edit 1",
        "                set severity critical high",
        "                set action block",
        "            next",
        "            edit 2",
        "                set severity medium",
        "                set action monitor",
        "            next",
        "        end",
        "    next",
        "end",
        "config webfilter profile",
        "    edit WEB-FILTER-CORP",
        "        set web-content-cache enable",
        "        config ftgd-wf",
        "            config filters",
        "                edit 1",
        "                    set category 62 26 86 1",
        "                    set action block",
        "                next",
        "            end",
        "        end",
        "    next",
        "end",
        "config antivirus profile",
        "    edit AV-SCAN-ALL",
        "        set av-virus-log enable",
        "        config http",
        "            set options scan",
        "        end",
        "        config ftp",
        "            set options scan",
        "        end",
        "        config smtp",
        "            set options scan",
        "        end",
        "    next",
        "end",
        "config ssl-ssh-profile",
        "    edit SSL-INSPECT-CORP",
        "        set comment Corporate HTTPS inspection",
        "        config https",
        "            set ports 443",
        "            set status certificate-inspection",
        "        end",
        "    next",
        "end",
        "!",
        "!-- NAT / Virtual IPs",
        "config firewall vip",
        "    edit VIP-WEBSERVER",
        "        set extintf port1",
        "        set portforward enable",
        "        set mappedip 10.200.0.10",
        "        set extport 443",
        "        set mappedport 443",
        "        set protocol tcp",
        "    next",
        "end",
        "!",
        "!-- Security policy table",
        "config firewall policy",
        "    edit 10",
        "        set name INSIDE-TO-INTERNET",
        "        set srcintf port2",
        "        set dstintf port1",
        "        set srcaddr INSIDE-NET",
        "        set dstaddr all",
        "        set action accept",
        "        set schedule always",
        "        set service HTTP HTTPS DNS FTP SMTP POP3 IMAP",
        "        set nat enable",
        "        set utm-status enable",
        "        set ips-sensor IPS-CRITICAL",
        "        set webfilter-profile WEB-FILTER-CORP",
        "        set av-profile AV-SCAN-ALL",
        "        set ssl-ssh-profile SSL-INSPECT-CORP",
        "        set logtraffic all",
        "    next",
        "    edit 20",
        "        set name OUTSIDE-TO-DMZ-WEB",
        "        set srcintf port1",
        "        set dstintf port3",
        "        set srcaddr all",
        "        set dstaddr VIP-WEBSERVER",
        "        set action accept",
        "        set schedule always",
        "        set service HTTPS HTTP",
        "        set utm-status enable",
        "        set ips-sensor IPS-CRITICAL",
        "        set av-profile AV-SCAN-ALL",
        "        set logtraffic all",
        "    next",
        "    edit 30",
        "        set name GUEST-TO-INTERNET-ONLY",
        "        set srcintf port4",
        "        set dstintf port1",
        "        set srcaddr GUEST-NET",
        "        set dstaddr all",
        "        set action accept",
        "        set schedule always",
        "        set service HTTP HTTPS DNS",
        "        set nat enable",
        "        set logtraffic all",
        "    next",
        "    edit 40",
        "        set name BLOCK-GUEST-TO-INSIDE",
        "        set srcintf port4",
        "        set dstintf port2 port3",
        "        set srcaddr GUEST-NET",
        "        set dstaddr INSIDE-NET DMZ-NET",
        "        set action deny",
        "        set schedule always",
        "        set logtraffic all",
        "    next",
        "    edit 50",
        "        set name BLOCK-DMZ-TO-INSIDE",
        "        set srcintf port3",
        "        set dstintf port2",
        "        set srcaddr DMZ-NET",
        "        set dstaddr INSIDE-NET",
        "        set action deny",
        "        set schedule always",
        "        set logtraffic all",
        "    next",
        "    edit 999",
        "        set name IMPLICIT-DENY-ALL",
        "        set srcintf any",
        "        set dstintf any",
        "        set srcaddr all",
        "        set dstaddr all",
        "        set action deny",
        "        set schedule always",
        "        set logtraffic all",
        "    next",
        "end",
        "!",
        "!-- High Availability (FortiGate Active-Passive)",
        "config system ha",
        "    set mode a-p",
        "    set group-name FORTIHA",
        "    set password FortiHAPass!",
        "    set hbdev port5 100",
        "    set session-pickup enable",
        "    set override disable",
        "end",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Palo Alto PAN-OS ──────────────────────────────────────────────────────

def _paloalto(ctx: dict) -> str:
    inside_net = ctx.get("inside_network", "192.168.0.0")
    dmz_net    = ctx.get("dmz_network",    "10.200.0.0")
    server_net = ctx.get("server_network",  "10.201.0.0")
    guest_net  = ctx.get("guest_network",   "192.168.50.0")
    hostname   = ctx.get("hostname",        "PA-FW-01")
    mgmt_ip    = ctx.get("mgmt_ip",         "10.100.1.1")

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════════════╗",
        "! ║   PALO ALTO PAN-OS FIREWALL POLICY          ║",
        "! ╚══════════════════════════════════════════════╝",
        "!",
        "! PAN-OS CLI set commands — paste into configure mode",
        "!",
        f"set deviceconfig system hostname {hostname}",
        f"set deviceconfig system ip-address {mgmt_ip}",
        "set deviceconfig system dns-setting servers primary 8.8.8.8",
        "set deviceconfig system timezone UTC",
        "set deviceconfig system service disable-telnet yes",
        "set deviceconfig system service disable-http yes",
        "!",

        "!-- Security zones",
        "set zone OUTSIDE network layer3",
        "set zone INSIDE  network layer3",
        "set zone DMZ     network layer3",
        "set zone SERVER  network layer3",
        "set zone GUEST   network layer3",
        "set zone MGMT    network layer3",
        "!",

        "!-- Interface → zone assignment",
        "set network interface ethernet ethernet1/1 layer3 units ethernet1/1 ip 0.0.0.0/0",
        "set zone OUTSIDE network layer3 member ethernet1/1",
        f"set network interface ethernet ethernet1/2 layer3 units ethernet1/2 ip {inside_net.rsplit('.',1)[0]}.1/24",
        "set zone INSIDE network layer3 member ethernet1/2",
        f"set network interface ethernet ethernet1/3 layer3 units ethernet1/3 ip {dmz_net.rsplit('.',1)[0]}.1/24",
        "set zone DMZ network layer3 member ethernet1/3",
        f"set network interface ethernet ethernet1/4 layer3 units ethernet1/4 ip {server_net.rsplit('.',1)[0]}.1/24",
        "set zone SERVER network layer3 member ethernet1/4",
        f"set network interface ethernet ethernet1/5 layer3 units ethernet1/5 ip {guest_net.rsplit('.',1)[0]}.1/24",
        "set zone GUEST network layer3 member ethernet1/5",
        "!",

        "!-- Address objects",
        f"set address INSIDE-NET ip-netmask {inside_net}/16",
        f"set address DMZ-NET    ip-netmask {dmz_net}/24",
        f"set address SERVER-NET ip-netmask {server_net}/24",
        f"set address GUEST-NET  ip-netmask {guest_net}/24",
        "set address DMZ-WEBSERVER ip-netmask 10.200.0.10/32",
        "set address MGMT-NET   ip-netmask 10.100.0.0/24",
        "!",

        "!-- Application groups",
        "set application-group WEB-APPS members [ web-browsing ssl ]",
        "set application-group EMAIL-APPS members [ smtp pop3 imap ]",
        "set application-group MGMT-APPS members [ ssh snmp syslog ]",
        "!",

        "!-- Security profiles",
        "set profiles virus STRICT-AV description 'Block all virus signatures'",
        "set profiles spyware STRICT-AS description 'Block critical spyware'",
        "set profiles vulnerability STRICT-VP description 'Block critical/high CVEs'",
        "set profiles url-filtering CORP-URL-FILTER description 'Block malware/phishing/adult'",
        "set profiles url-filtering CORP-URL-FILTER action block categories [ malware phishing gambling adult ]",
        "set profiles file-blocking BLOCK-DANGEROUS description 'Block executables from internet'",
        "set profile-group CORP-SECURITY virus STRICT-AV spyware STRICT-AS vulnerability STRICT-VP",
        "set profile-group CORP-SECURITY url-filtering CORP-URL-FILTER file-blocking BLOCK-DANGEROUS",
        "!",

        "!-- NAT rules",
        "set nat-rules INSIDE-PAT from INSIDE to OUTSIDE source INSIDE-NET destination any",
        "  set nat-rules INSIDE-PAT source-translation dynamic-ip-and-port interface-address",
        "set nat-rules SERVER-PAT from SERVER to OUTSIDE source SERVER-NET destination any",
        "  set nat-rules SERVER-PAT source-translation dynamic-ip-and-port interface-address",
        "set nat-rules DMZ-WEB-STATIC from OUTSIDE to OUTSIDE destination 203.0.113.10",
        "  set nat-rules DMZ-WEB-STATIC destination-translation translated-address DMZ-WEBSERVER",
        "  set nat-rules DMZ-WEB-STATIC destination-translation translated-port 443",
        "!",

        "!-- Security rules",
        "set rulebase security rules INSIDE-TO-INTERNET from INSIDE to OUTSIDE",
        "  set rulebase security rules INSIDE-TO-INTERNET source INSIDE-NET destination any",
        "  set rulebase security rules INSIDE-TO-INTERNET application WEB-APPS EMAIL-APPS",
        "  set rulebase security rules INSIDE-TO-INTERNET action allow",
        "  set rulebase security rules INSIDE-TO-INTERNET profile-setting group CORP-SECURITY",
        "  set rulebase security rules INSIDE-TO-INTERNET log-setting default",
        "!",
        "set rulebase security rules OUTSIDE-TO-DMZ from OUTSIDE to DMZ",
        "  set rulebase security rules OUTSIDE-TO-DMZ source any destination DMZ-WEBSERVER",
        "  set rulebase security rules OUTSIDE-TO-DMZ application WEB-APPS",
        "  set rulebase security rules OUTSIDE-TO-DMZ action allow",
        "  set rulebase security rules OUTSIDE-TO-DMZ profile-setting group CORP-SECURITY",
        "  set rulebase security rules OUTSIDE-TO-DMZ log-setting default",
        "!",
        "set rulebase security rules INSIDE-TO-SERVER from INSIDE to SERVER",
        "  set rulebase security rules INSIDE-TO-SERVER source INSIDE-NET destination SERVER-NET",
        "  set rulebase security rules INSIDE-TO-SERVER application any",
        "  set rulebase security rules INSIDE-TO-SERVER action allow",
        "  set rulebase security rules INSIDE-TO-SERVER log-setting default",
        "!",
        "set rulebase security rules GUEST-INTERNET-ONLY from GUEST to OUTSIDE",
        "  set rulebase security rules GUEST-INTERNET-ONLY source GUEST-NET destination any",
        "  set rulebase security rules GUEST-INTERNET-ONLY application WEB-APPS",
        "  set rulebase security rules GUEST-INTERNET-ONLY action allow",
        "  set rulebase security rules GUEST-INTERNET-ONLY log-setting default",
        "!",
        "set rulebase security rules BLOCK-GUEST-TO-INSIDE from GUEST to INSIDE",
        "  set rulebase security rules BLOCK-GUEST-TO-INSIDE source any destination any",
        "  set rulebase security rules BLOCK-GUEST-TO-INSIDE action deny",
        "  set rulebase security rules BLOCK-GUEST-TO-INSIDE log-setting default",
        "!",
        "set rulebase security rules BLOCK-DMZ-TO-INSIDE from DMZ to INSIDE",
        "  set rulebase security rules BLOCK-DMZ-TO-INSIDE source any destination any",
        "  set rulebase security rules BLOCK-DMZ-TO-INSIDE action deny",
        "  set rulebase security rules BLOCK-DMZ-TO-INSIDE log-setting default",
        "!",
        "!-- Implicit deny (Palo Alto default) — log it",
        "set rulebase security rules IMPLICIT-DENY action deny",
        "set rulebase security rules IMPLICIT-DENY log-start yes",
        "set rulebase security rules IMPLICIT-DENY log-end yes",
        "!",

        "!-- Commit (run after pasting all above)",
        "commit",
        "!",
    ]

    return "\n".join(lines) + "\n"
