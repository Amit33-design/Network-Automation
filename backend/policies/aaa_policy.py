"""
AAA Policy Generator
======================
Generates AAA (Authentication, Authorization, Accounting) config:
  - TACACS+ for device management (SSH login, exec, commands)
  - RADIUS for 802.1X / network access
  - SNMP v3 with auth + priv
  - Syslog policy
  - NTP authentication
  - Management ACL references

Platforms: ios-xe, nxos, eos, junos, sonic
"""
from __future__ import annotations
from typing import Any


DEFAULT_TACACS_SERVER  = "10.100.0.60"
DEFAULT_TACACS_KEY     = "TacacsKey!"
DEFAULT_RADIUS_SERVER  = "10.100.0.50"
DEFAULT_RADIUS_KEY     = "RadiusKey!"
DEFAULT_SYSLOG_SERVER  = "10.100.0.100"
DEFAULT_NTP_SERVER     = "10.100.0.1"
DEFAULT_NTP_KEY        = "NTPSecretKey123"
DEFAULT_SNMP_AUTH_PASS = "SNMPAuthPass!"
DEFAULT_SNMP_PRIV_PASS = "SNMPPrivPass!"
DEFAULT_SNMP_USER      = "netdesign-monitor"


def generate_aaa(ctx: dict[str, Any], platform: str) -> str:
    """Return AAA + SNMP + Syslog + NTP config block."""
    fn = {
        "ios-xe": _ios_xe_aaa,
        "nxos":   _nxos_aaa,
        "eos":    _eos_aaa,
        "junos":  _junos_aaa,
        "sonic":  _sonic_aaa,
    }.get(platform, _ios_xe_aaa)
    return fn(ctx)


# ── IOS-XE ──────────────────────────────────────────────────────────────

def _ios_xe_aaa(ctx: dict) -> str:
    tacacs  = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tkey    = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    syslog  = ctx.get("syslog_server", DEFAULT_SYSLOG_SERVER)
    ntp     = ctx.get("ntp_server", DEFAULT_NTP_SERVER)
    ntp_key = ctx.get("ntp_key", DEFAULT_NTP_KEY)
    hostname= ctx.get("hostname", "DEVICE-01")
    mgmt_ip = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_net= ".".join(mgmt_ip.split(".")[:3]) + ".0"

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════╗",
        "!-- ║   AAA / SNMP / SYSLOG — IOS-XE           ║",
        "!-- ╚══════════════════════════════════════════╝",
        "!",
        "!-- TACACS+ for device management",
        f"tacacs server TACACS-PRIMARY",
        f" address ipv4 {tacacs}",
        f" key {tkey}",
        " timeout 5",
        " single-connection",
        "!",
        "aaa group server tacacs+ TACACS-GROUP",
        " server name TACACS-PRIMARY",
        "!",
        "!-- AAA method lists",
        "aaa authentication login default group TACACS-GROUP local",
        "aaa authentication enable default group TACACS-GROUP enable",
        "aaa authorization exec default group TACACS-GROUP local if-authenticated",
        "aaa authorization commands 1 default group TACACS-GROUP local",
        "aaa authorization commands 15 default group TACACS-GROUP local",
        "aaa accounting exec default start-stop group TACACS-GROUP",
        "aaa accounting commands 15 default start-stop group TACACS-GROUP",
        "!",
        "!-- SSH hardening",
        "ip ssh version 2",
        "ip ssh time-out 60",
        "ip ssh authentication-retries 3",
        "ip ssh source-interface Loopback0",
        f"crypto key generate rsa modulus 4096",
        "!",
        "!-- Console + VTY",
        "service password-encryption",
        "no service finger",
        "no service udp-small-servers",
        "no service tcp-small-servers",
        "no cdp run",
        "no ip http server",
        "no ip http secure-server",
        "no ip bootp server",
        "no ip source-route",
        "no ip proxy-arp",
        "!",
        "line con 0",
        " exec-timeout 5 0",
        " logging synchronous",
        "line vty 0 15",
        " transport input ssh",
        " exec-timeout 10 0",
        " logging synchronous",
        f" access-class VTY-ACCESS in",
        "!",
        "!-- SNMPv3",
        f"snmp-server view NETDESIGN-VIEW iso included",
        f"snmp-server group NETDESIGN-GROUP v3 priv read NETDESIGN-VIEW",
        f"snmp-server user {DEFAULT_SNMP_USER} NETDESIGN-GROUP v3 auth sha {DEFAULT_SNMP_AUTH_PASS} priv aes 256 {DEFAULT_SNMP_PRIV_PASS}",
        f"snmp-server location {hostname}-DATACENTER",
        f"snmp-server contact netops@netdesign.ai",
        f"snmp-server host {syslog} version 3 priv {DEFAULT_SNMP_USER}",
        "snmp-server trap-source Loopback0",
        "snmp-server enable traps bgp",
        "snmp-server enable traps ospf",
        "snmp-server enable traps config",
        "snmp-server enable traps entity",
        "snmp-server enable traps envmon",
        "!",
        "!-- Syslog",
        f"logging host {syslog} transport udp port 514",
        "logging trap informational",
        "logging origin-id hostname",
        "logging source-interface Loopback0",
        "logging buffered 65536 informational",
        "logging on",
        "!",
        "!-- NTP authenticated",
        f"ntp authenticate",
        f"ntp authentication-key 1 md5 {ntp_key}",
        f"ntp trusted-key 1",
        f"ntp server {ntp} key 1 prefer",
        "ntp source Loopback0",
        "ntp update-calendar",
        "!",
        "!-- Clock",
        "clock timezone UTC 0",
        "service timestamps log datetime msec localtime show-timezone",
        "service timestamps debug datetime msec localtime show-timezone",
        "!",
        "!-- Banners",
        "banner login ^",
        "****************************************************",
        " AUTHORIZED ACCESS ONLY — NetDesign AI Managed Device",
        " All activity is logged and monitored.",
        " Unauthorized access will be prosecuted.",
        "****************************************************",
        "^",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_aaa(ctx: dict) -> str:
    tacacs  = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tkey    = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    syslog  = ctx.get("syslog_server", DEFAULT_SYSLOG_SERVER)
    ntp     = ctx.get("ntp_server", DEFAULT_NTP_SERVER)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════╗",
        "!-- ║   AAA / SNMP / SYSLOG — NX-OS            ║",
        "!-- ╚══════════════════════════════════════════╝",
        "!",
        "feature tacacs+",
        "!",
        f"tacacs-server host {tacacs} key {tkey}",
        "aaa group server tacacs+ TACACS-GROUP",
        f"  server {tacacs}",
        "!",
        "aaa authentication login default group TACACS-GROUP local",
        "aaa authorization commands default group TACACS-GROUP local",
        "aaa accounting default group TACACS-GROUP",
        "!",
        "!-- SNMPv3",
        f"snmp-server user {DEFAULT_SNMP_USER} network-operator auth sha {DEFAULT_SNMP_AUTH_PASS} priv aes-256 {DEFAULT_SNMP_PRIV_PASS}",
        f"snmp-server host {syslog} traps version 3 priv {DEFAULT_SNMP_USER}",
        "snmp-server enable traps bgp",
        "snmp-server enable traps config",
        "!",
        "!-- Syslog",
        f"logging server {syslog} 6 use-vrf management",
        "logging origin-id hostname",
        "logging timestamp milliseconds",
        "!",
        f"ntp server {ntp} use-vrf management prefer",
        "ntp authenticate",
        "!",
        "!-- SSH",
        "no feature telnet",
        "ssh login-attempts 3",
        "!",
        "banner motd ^",
        "AUTHORIZED ACCESS ONLY — NetDesign AI Managed NX-OS",
        "^",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── EOS ─────────────────────────────────────────────────────────────────

def _eos_aaa(ctx: dict) -> str:
    tacacs  = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tkey    = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    syslog  = ctx.get("syslog_server", DEFAULT_SYSLOG_SERVER)
    ntp     = ctx.get("ntp_server", DEFAULT_NTP_SERVER)

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════════╗",
        "! ║   AAA / SNMP / SYSLOG — Arista EOS       ║",
        "! ╚══════════════════════════════════════════╝",
        "!",
        f"tacacs-server host {tacacs} key {tkey}",
        "aaa group server tacacs+ TACACS-GROUP",
        f"   server {tacacs}",
        "!",
        "aaa authentication login default group TACACS-GROUP local",
        "aaa authorization exec default group TACACS-GROUP local",
        "aaa authorization commands all default group TACACS-GROUP local",
        "aaa accounting exec default start-stop group TACACS-GROUP",
        "aaa accounting commands all default start-stop group TACACS-GROUP",
        "!",
        "!-- SNMPv3",
        f"snmp-server view NETDESIGN-VIEW iso included",
        f"snmp-server group NETDESIGN-GROUP v3 priv read NETDESIGN-VIEW",
        f"snmp-server user {DEFAULT_SNMP_USER} NETDESIGN-GROUP v3 auth sha {DEFAULT_SNMP_AUTH_PASS} priv aes {DEFAULT_SNMP_PRIV_PASS}",
        f"snmp-server host {syslog} version 3 priv {DEFAULT_SNMP_USER}",
        "snmp-server enable traps bgp",
        "!",
        f"logging host {syslog} 514",
        "logging format timestamp milliseconds",
        "logging source-interface Loopback0",
        "!",
        f"ntp server {ntp} prefer",
        "ntp source Loopback0",
        "!",
        "management ssh",
        "   idle-timeout 10",
        "!",
        "banner login",
        "AUTHORIZED ACCESS ONLY — NetDesign AI Managed EOS",
        "EOF",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos ────────────────────────────────────────────────────────────────

def _junos_aaa(ctx: dict) -> str:
    tacacs  = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tkey    = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    syslog  = ctx.get("syslog_server", DEFAULT_SYSLOG_SERVER)
    ntp     = ctx.get("ntp_server", DEFAULT_NTP_SERVER)

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════════════╗",
        "# ║   AAA / SNMP / SYSLOG — Junos            ║",
        "# ╚══════════════════════════════════════════╝",
        "#",
        "system {",
        "    authentication-order [ tacplus password ];",
        f"    tacplus-server {{",
        f"        {tacacs} {{",
        f"            secret \"{tkey}\";",
        "            single-connection;",
        "        }",
        "    }",
        "    login {",
        "        class NETWORK-ADMIN {",
        "            permissions all;",
        "        }",
        "        class NETWORK-READ {",
        "            permissions view;",
        "        }",
        "        user admin {",
        "            uid 2000;",
        "            class super-user;",
        "            authentication {",
        "                encrypted-password \"$6$ChangeMe!\";",
        "            }",
        "        }",
        "    }",
        "    services {",
        "        ssh {",
        "            root-login deny;",
        "            protocol-version v2;",
        "            max-sessions-per-connection 32;",
        "        }",
        "        netconf { ssh; }",
        "    }",
        f"    syslog {{",
        f"        host {syslog} {{",
        "            any notice;",
        "            authorization info;",
        "        }",
        "        file messages {",
        "            any warning;",
        "        }",
        "    }",
        f"    ntp {{",
        f"        server {ntp};",
        "        source-address 0.0.0.0;",
        "    }",
        "}",
        "snmp {",
        f"    v3 {{",
        f"        usm local-engine {{",
        f"            user {DEFAULT_SNMP_USER} {{",
        f"                authentication-sha {{ authentication-password \"{DEFAULT_SNMP_AUTH_PASS}\"; }}",
        f"                privacy-aes128   {{ privacy-password \"{DEFAULT_SNMP_PRIV_PASS}\"; }}",
        "            }",
        "        }",
        "        vacm {",
        f"            access {{",
        f"                group NETDESIGN-GROUP {{",
        "                    default-context-prefix {",
        "                        security-model usm {",
        "                            security-level privacy {",
        "                                read-view all;",
        "                            }",
        "                        }",
        "                    }",
        "                }",
        "            }",
        "        }",
        "    }",
        f"    trap-group NETDESIGN-TRAPS {{",
        "        version v3;",
        f"        targets {{ {syslog}; }}",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ────────────────────────────────────────────────────────────────

def _sonic_aaa(ctx: dict) -> str:
    tacacs  = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tkey    = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    syslog  = ctx.get("syslog_server", DEFAULT_SYSLOG_SERVER)
    ntp     = ctx.get("ntp_server", DEFAULT_NTP_SERVER)

    lines: list[str] = []
    lines += [
        "!",
        "! SONiC AAA — configure via CONFIG_DB or sonic-cli",
        "!",
        f"! config aaa authentication login tacacs+ local",
        f"! config tacacs add --port 49 --timeout 5 --key {tkey} {tacacs}",
        f"! config syslog add {syslog}",
        f"! config ntp add {ntp}",
        "! config snmp community del public",
        f"! config snmpagent {DEFAULT_SNMP_USER} v3 auth sha {DEFAULT_SNMP_AUTH_PASS} priv aes {DEFAULT_SNMP_PRIV_PASS}",
        "!",
    ]

    return "\n".join(lines) + "\n"
