"""
802.1X / NAC Policy Generator
================================
Generates full 802.1X port authentication config with:
 - RADIUS server groups + authentication / authorization / accounting
 - Change of Authorization (CoA) / RFC 5176
 - Guest VLAN, Auth-fail VLAN, Critical VLAN
 - Multi-auth / multi-domain host mode
 - MAB fallback
 - 802.1X supplicant bypass for IP phones (voice VLAN)
 - IBNS 2.0 (IOS-XE 16.x+) policy-map style where applicable

Platforms: ios-xe (full), nxos (limited — CiscoSAML), eos (dot1x)
"""
from __future__ import annotations
from typing import Any


# Default RADIUS / TACACS parameters (overridden by ctx if provided)
DEFAULT_RADIUS_PRIMARY   = "10.100.0.50"
DEFAULT_RADIUS_SECONDARY = "10.100.0.51"
DEFAULT_RADIUS_KEY       = "ChangeThisKey!"
DEFAULT_TACACS_SERVER    = "10.100.0.60"
DEFAULT_TACACS_KEY       = "TacacsKey!"
DEFAULT_GUEST_VLAN       = 999
DEFAULT_AUTHFAIL_VLAN    = 998
DEFAULT_CRITICAL_VLAN    = 997
DEFAULT_VOICE_VLAN       = 110


def generate_dot1x(ctx: dict[str, Any], platform: str) -> str:
    """Return 802.1X policy config block for device context + platform."""
    # Only generate for campus access layer; skip for DC/GPU spines
    layer = ctx.get("layer", "campus-access")
    uc    = ctx.get("uc", "campus")
    if layer not in ("campus-access", "campus-dist") and uc not in ("campus", "hybrid"):
        return ""

    fn = {
        "ios-xe": _ios_xe_dot1x,
        "nxos":   _nxos_dot1x,
        "eos":    _eos_dot1x,
        "junos":  lambda c: "",  # Junos EX supports 802.1X but is complex — placeholder
        "sonic":  lambda c: "",
    }.get(platform, _ios_xe_dot1x)

    return fn(ctx)


# ── IOS-XE — Full IBNS 2.0 ──────────────────────────────────────────────

def _ios_xe_dot1x(ctx: dict) -> str:
    radius1    = ctx.get("radius_primary", DEFAULT_RADIUS_PRIMARY)
    radius2    = ctx.get("radius_secondary", DEFAULT_RADIUS_SECONDARY)
    radius_key = ctx.get("radius_key", DEFAULT_RADIUS_KEY)
    tacacs     = ctx.get("tacacs_server", DEFAULT_TACACS_SERVER)
    tacacs_key = ctx.get("tacacs_key", DEFAULT_TACACS_KEY)
    guest      = ctx.get("guest_vlan", DEFAULT_GUEST_VLAN)
    authfail   = ctx.get("authfail_vlan", DEFAULT_AUTHFAIL_VLAN)
    critical   = ctx.get("critical_vlan", DEFAULT_CRITICAL_VLAN)
    voice      = ctx.get("voice_vlan", DEFAULT_VOICE_VLAN)
    hostname   = ctx.get("hostname", "ACCESS-SW-01")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔════════════════════════════════════════════════╗",
        "!-- ║   802.1X / NAC POLICY — IOS-XE (IBNS 2.0)    ║",
        "!-- ╚════════════════════════════════════════════════╝",
        "!",
        "!-- AAA Framework",
        "aaa new-model",
        "!",
        "!-- RADIUS server definitions",
        f"radius server RADIUS-PRIMARY",
        f" address ipv4 {radius1} auth-port 1812 acct-port 1813",
        f" key {radius_key}",
        " timeout 3",
        " retransmit 2",
        "!",
        f"radius server RADIUS-SECONDARY",
        f" address ipv4 {radius2} auth-port 1812 acct-port 1813",
        f" key {radius_key}",
        " timeout 3",
        " retransmit 2",
        "!",
        "aaa group server radius RADIUS-GROUP",
        " server name RADIUS-PRIMARY",
        " server name RADIUS-SECONDARY",
        " deadtime 10",
        "!",
        "!-- TACACS+ for device management",
        f"tacacs server TACACS-PRIMARY",
        f" address ipv4 {tacacs}",
        f" key {tacacs_key}",
        " timeout 5",
        "!",
        "aaa group server tacacs+ TACACS-GROUP",
        " server name TACACS-PRIMARY",
        "!",
        "!-- AAA method lists",
        "aaa authentication login default group TACACS-GROUP local",
        "aaa authentication dot1x default group RADIUS-GROUP",
        "aaa authorization exec default group TACACS-GROUP local if-authenticated",
        "aaa authorization network default group RADIUS-GROUP",
        "aaa accounting dot1x default start-stop group RADIUS-GROUP",
        "aaa accounting exec default start-stop group TACACS-GROUP",
        "aaa accounting commands 15 default start-stop group TACACS-GROUP",
        "!",
        "!-- 802.1X global config",
        "dot1x system-auth-control",
        "dot1x critical eapol",
        "!",
        "!-- RADIUS CoA (RFC 5176)",
        f"aaa server radius dynamic-author",
        f" client {radius1} server-key {radius_key}",
        f" client {radius2} server-key {radius_key}",
        " auth-type any",
        " port 3799",
        "!",
        "!-- Global RADIUS attributes",
        "radius-server attribute 6 on-for-login-auth",
        "radius-server attribute 8 include-in-access-req",
        "radius-server attribute 25 access-request include",
        "radius-server attribute 31 mac format ietf upper-case",
        "radius-server vsa send accounting",
        "radius-server vsa send authentication",
        "!",
        "!-- IBNS 2.0 Class Maps",
        "class-map type control subscriber match-all DOT1X-NO-RESP",
        " match method dot1x",
        " match result-type method dot1x agent-not-found",
        "!",
        "class-map type control subscriber match-all DOT1X-FAILED",
        " match method dot1x",
        " match result-type method dot1x authoritative",
        "!",
        "class-map type control subscriber match-all MAB-FAILED",
        " match method mab",
        " match result-type method mab authoritative",
        "!",
        "class-map type control subscriber match-all DOT1X-SUCCESS",
        " match method dot1x",
        " match result-type success",
        "!",
        "class-map type control subscriber match-all MAB-SUCCESS",
        " match method mab",
        " match result-type success",
        "!",
        "class-map type control subscriber match-all AAA-UNREACHABLE",
        " match result-type aaa-timeout",
        "!",
        "!-- IBNS 2.0 Policy Map",
        "policy-map type control subscriber DOT1X-POLICY",
        " event session-started match-all",
        "  10 class always do-until-failure",
        "   10 authenticate using dot1x retries 2 retry-time 10 priority 10",
        " event authentication-failure match-first",
        "  10 class DOT1X-NO-RESP do-until-failure",
        "   10 terminate dot1x",
        "   20 authenticate using mab priority 20",
        "  20 class AAA-UNREACHABLE do-until-failure",
        f"   10 activate service-template CRITICAL-VLAN{critical}",
        "   20 pause reauthentication",
        "  30 class DOT1X-FAILED do-until-failure",
        f"   10 activate service-template AUTHFAIL-VLAN{authfail}",
        "  40 class MAB-FAILED do-until-failure",
        f"   10 activate service-template GUEST-VLAN{guest}",
        "  999 class always do-until-failure",
        "   10 terminate dot1x",
        "   20 terminate mab",
        "   30 authentication-restart 60",
        " event agent-found match-all",
        "  10 class always do-until-failure",
        "   10 terminate mab",
        "   20 authenticate using dot1x retries 2 retry-time 10 priority 10",
        " event aaa-available match-all",
        "  10 class AAA-UNREACHABLE do-until-failure",
        "   10 clear-session",
        " event inactivity-timeout match-all",
        "  10 class always do-until-failure",
        "   10 clear-session",
        "!",
        "!-- Service templates",
        f"service-template GUEST-VLAN{guest}",
        f" vlan {guest}",
        f" description Guest VLAN — unauthenticated users",
        "!",
        f"service-template AUTHFAIL-VLAN{authfail}",
        f" vlan {authfail}",
        f" description Auth-Fail VLAN — failed authentication",
        "!",
        f"service-template CRITICAL-VLAN{critical}",
        f" vlan {critical}",
        f" description Critical VLAN — RADIUS unreachable",
        " access-group ACL-CRITICAL-ACCESS",
        "!",
        "ip access-list extended ACL-CRITICAL-ACCESS",
        " permit ip any any",
        " remark Permit all in critical VLAN — restrict as needed",
        "!",
        "!-- VLANs for 802.1X",
        f"vlan {guest}",
        f" name GUEST-VLAN",
        f"vlan {authfail}",
        f" name AUTHFAIL-VLAN",
        f"vlan {critical}",
        f" name CRITICAL-VLAN",
        "!",
        "!-- Access port template (apply per-port)",
        "!-- Apply: interface GigabitEthernet1/0/X",
        "!--         service-policy type control subscriber DOT1X-POLICY",
        "!--         authentication host-mode multi-auth",
        "!--         authentication periodic",
        "!--         authentication timer reauthenticate 3600",
        f"!--         switchport voice vlan {voice}",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── NX-OS — limited dot1x ───────────────────────────────────────────────

def _nxos_dot1x(ctx: dict) -> str:
    radius1    = ctx.get("radius_primary", DEFAULT_RADIUS_PRIMARY)
    radius_key = ctx.get("radius_key", DEFAULT_RADIUS_KEY)
    guest      = ctx.get("guest_vlan", DEFAULT_GUEST_VLAN)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════╗",
        "!-- ║   802.1X POLICY — NX-OS          ║",
        "!-- ╚══════════════════════════════════╝",
        "!",
        "feature dot1x",
        "!",
        "radius-server host {radius1} key {key} auth-port 1812 acct-port 1813".format(
            radius1=radius1, key=radius_key),
        "aaa group server radius RADIUS-GROUP",
        f"  server {radius1}",
        "!",
        "aaa authentication dot1x default group RADIUS-GROUP",
        "dot1x system-auth-control",
        f"dot1x default-guest-vlan {guest}",
        "!",
    ]
    return "\n".join(lines) + "\n"


# ── EOS — dot1x ─────────────────────────────────────────────────────────

def _eos_dot1x(ctx: dict) -> str:
    radius1    = ctx.get("radius_primary", DEFAULT_RADIUS_PRIMARY)
    radius_key = ctx.get("radius_key", DEFAULT_RADIUS_KEY)
    guest      = ctx.get("guest_vlan", DEFAULT_GUEST_VLAN)
    authfail   = ctx.get("authfail_vlan", DEFAULT_AUTHFAIL_VLAN)

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════╗",
        "! ║   802.1X POLICY — Arista EOS     ║",
        "! ╚══════════════════════════════════╝",
        "!",
        "aaa authentication dot1x default group RADIUS-GROUP",
        f"radius-server host {radius1} key {radius_key}",
        "aaa group server radius RADIUS-GROUP",
        f"   server {radius1}",
        "!",
        "dot1x system-auth-control",
        f"dot1x guest-vlan {guest}",
        f"dot1x auth-failure-vlan {authfail}",
        "dot1x mac-based authentication fallback",
        "!",
    ]
    return "\n".join(lines) + "\n"
