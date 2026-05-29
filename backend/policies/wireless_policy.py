"""
Wireless / Wi-Fi Policy Generator
====================================
Generates wireless config for:
  - Cisco IOS-XE Embedded Wireless Controller (EWC) on Catalyst 9000
  - Cisco WLC (legacy / Catalyst Center) CLI stanzas
  - Arista EOS Wi-Fi (CloudVision Wi-Fi edge)
  - Generic Lightweight AP config (CAPWAP + AP-join profile)

SSID profiles generated:
  CORP-WIFI    — WPA3-Enterprise + 802.1X → corporate VLAN 40
  GUEST-WIFI   — WPA2-PSK + captive portal redirect → VLAN 50
  IOT-WIFI     — WPA2-PSK + MAB + rate-limit → VLAN 60
  LEGACY-WIFI  — WPA2-Personal fallback (optional)

Additional:
  - RF profile: 2.4 GHz and 5 GHz/6 GHz
  - Band steering (prefer 5/6 GHz)
  - Power / channel management (RRM)
  - AP management VLAN + join profile
  - WPA3 Opportunistic Wireless Encryption (OWE) for guest
  - Fast roaming (802.11r FT + 802.11k/v)
  - QoS marking for voice/video over Wi-Fi
  - Rogue AP detection + containment policy
"""
from __future__ import annotations
from typing import Any

DEFAULT_CORP_SSID    = "CorpWifi"
DEFAULT_GUEST_SSID   = "Guest-WiFi"
DEFAULT_IOT_SSID     = "IoT-Network"
DEFAULT_RADIUS_IP    = "10.100.0.50"
DEFAULT_RADIUS_KEY   = "RadiusKey!"
DEFAULT_CAPTIVE_URL  = "https://guest.netdesign.ai/portal"
DEFAULT_AP_MGMT_VLAN = 99
DEFAULT_CORP_VLAN    = 40
DEFAULT_GUEST_VLAN   = 50
DEFAULT_IOT_VLAN     = 60


def generate_wireless_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return wireless config block — only for campus / hybrid use cases."""
    uc    = ctx.get("uc", "campus")
    layer = ctx.get("layer", "campus-access")

    # Only generate for campus; skip DC/GPU spines
    if uc not in ("campus", "hybrid") and layer not in ("campus-access", "campus-dist", "campus-core"):
        return ""

    fn = {
        "ios-xe": _ios_xe_wireless,
        "eos":    _eos_wireless,
        "nxos":   lambda c: "",   # NX-OS doesn't do wireless
        "junos":  _junos_wireless,
        "sonic":  lambda c: "",
    }.get(platform, _ios_xe_wireless)

    return fn(ctx)


# ── IOS-XE EWC (Embedded Wireless Controller / Catalyst 9000) ────────────

def _ios_xe_wireless(ctx: dict) -> str:
    corp_ssid   = ctx.get("corp_ssid",   DEFAULT_CORP_SSID)
    guest_ssid  = ctx.get("guest_ssid",  DEFAULT_GUEST_SSID)
    iot_ssid    = ctx.get("iot_ssid",    DEFAULT_IOT_SSID)
    radius_ip   = ctx.get("radius_primary", DEFAULT_RADIUS_IP)
    radius_key  = ctx.get("radius_key",  DEFAULT_RADIUS_KEY)
    captive_url = ctx.get("captive_url", DEFAULT_CAPTIVE_URL)
    corp_vlan   = ctx.get("wifi_corp_vlan",  DEFAULT_CORP_VLAN)
    guest_vlan  = ctx.get("wifi_guest_vlan", DEFAULT_GUEST_VLAN)
    iot_vlan    = ctx.get("wifi_iot_vlan",   DEFAULT_IOT_VLAN)
    ap_mgmt_vlan= ctx.get("ap_mgmt_vlan",    DEFAULT_AP_MGMT_VLAN)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════════════════╗",
        "!-- ║   WIRELESS POLICY — IOS-XE EWC (Catalyst 9000)  ║",
        "!-- ╚══════════════════════════════════════════════════╝",
        "!",
        "!-- Enable wireless controller",
        "wireless mobility controller",
        "wireless management interface Vlan99",
        "!",

        # ── RADIUS for wireless ──
        "!-- RADIUS servers for 802.1X wireless auth",
        f"radius server WIRELESS-RADIUS-1",
        f" address ipv4 {radius_ip} auth-port 1812 acct-port 1813",
        f" key {radius_key}",
        " timeout 3",
        "!",
        "aaa group server radius WIFI-RADIUS-GROUP",
        " server name WIRELESS-RADIUS-1",
        "!",
        "aaa authentication dot1x WIFI-DOT1X group WIFI-RADIUS-GROUP",
        "aaa authorization network WIFI-AUTHZ group WIFI-RADIUS-GROUP",
        "aaa accounting network WIFI-ACCT start-stop group WIFI-RADIUS-GROUP",
        "!",

        # ── RF Profiles ──
        "!-- RF Profiles",
        "wireless rf-network netdesign",
        "!",
        "ap dot11 24ghz rf-profile RF-2.4GHZ",
        " band-select probe-response",
        " band-select cycle-count 2",
        " band-select cycle-threshold 200",
        " band-select expire suppression 20",
        " description '2.4GHz RF Profile'",
        "!",
        "ap dot11 5ghz rf-profile RF-5GHZ",
        " description '5GHz RF Profile — preferred band'",
        " channel dynamic",
        " power local max 20",
        "!",
        "ap dot11 6ghz rf-profile RF-6GHZ",
        " description '6GHz Wi-Fi 6E RF Profile'",
        "!",

        # ── Policy profiles ──
        "!-- Policy profiles (VLAN + QoS per SSID)",
        f"wireless profile policy POLICY-{corp_ssid}",
        f" vlan {corp_vlan}",
        " no central switching",
        " no central dhcp",
        " accounting-list WIFI-ACCT",
        " ipv4 dhcp required",
        " session-timeout 43200",
        " idle-timeout 300",
        " qos-profile platinum",
        "!",
        f"wireless profile policy POLICY-{guest_ssid}",
        f" vlan {guest_vlan}",
        " no central switching",
        " central dhcp",
        " http-tlv-caching",
        " session-timeout 3600",
        " idle-timeout 600",
        " qos-profile silver",
        "!",
        f"wireless profile policy POLICY-{iot_ssid}",
        f" vlan {iot_vlan}",
        " no central switching",
        " session-timeout 86400",
        " qos-profile bronze",
        " rate-limit client upstream 5000",
        " rate-limit client downstream 10000",
        "!",

        # ── SSID profiles ──
        "!-- SSID / WLAN profiles",
        f"wlan {corp_ssid} 1 {corp_ssid}",
        " security wpa",
        " security wpa wpa2",
        " security wpa wpa2 ciphers aes",
        " security wpa akm dot1x",
        " security wpa wpa3",
        " security wpa wpa3 transition",
        " security dot1x authentication-list WIFI-DOT1X",
        " security pmf mandatory",
        " radio policy dot11 6ghz",
        " radio policy dot11 5ghz",
        " radio policy dot11 24ghz",
        " no security wpa wpa1",
        " dot11r ft-over-ds enable",
        " dot11k neighbor-report enable",
        " dot11v bss-transition enable",
        " no shutdown",
        "!",
        f"wlan {guest_ssid} 2 {guest_ssid}",
        " security wpa",
        " security wpa wpa2",
        " security wpa wpa2 ciphers aes",
        " security wpa akm owe",
        " description 'Guest SSID — OWE enhanced open'",
        " web-auth enable",
        f" web-auth redirect {captive_url}",
        " web-auth login-auth-bypass",
        " no security wpa wpa1",
        " radio policy dot11 5ghz",
        " radio policy dot11 24ghz",
        " no shutdown",
        "!",
        f"wlan {iot_ssid} 3 {iot_ssid}",
        " security wpa",
        " security wpa wpa2",
        " security wpa wpa2 ciphers aes",
        " security wpa akm psk",
        " security wpa akm psk set-key ascii 0 IoTPassPhrase!",
        " mac-filtering WIFI-AUTHZ",
        " radio policy dot11 24ghz",
        " no shutdown",
        "!",

        # ── AP Join profile ──
        "!-- AP Join profile",
        "ap profile DEFAULT-AP-PROFILE",
        " mgmt-user admin secret ChangeMe!",
        f" vlan {ap_mgmt_vlan}",
        " hreap",
        "  ap auth-secondary",
        " hyperlocation",
        "  pak-rssi-enable",
        " ntp-server 10.100.0.1",
        " syslog host 10.100.0.100",
        "!",

        # ── Rogue detection ──
        "!-- Rogue AP detection + containment",
        "wireless wps rogue rule ROGUE-RULE-1 priority 1 classify malicious match ssid contains FREE",
        "wireless wps rogue rule ROGUE-RULE-2 priority 2 classify malicious match rssi -70",
        "wireless wps rogue ap notify",
        "wireless wps rogue client notify",
        "!",

        # ── Band steering global ──
        "!-- Band steering — steer clients to 5/6 GHz",
        "wireless band-select probe-response",
        "wireless band-select cycle-count 2",
        "!",

        # ── QoS WMM ──
        "!-- WMM QoS profiles",
        "wireless qos policy platinum",
        " dscp 46",
        " description VoIP EF",
        "wireless qos policy silver",
        " dscp 34",
        " description Video AF41",
        "wireless qos policy bronze",
        " dscp 0",
        " description Best effort",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Arista EOS Wi-Fi (CloudVision Wi-Fi) ─────────────────────────────────

def _eos_wireless(ctx: dict) -> str:
    corp_ssid  = ctx.get("corp_ssid",  DEFAULT_CORP_SSID)
    guest_ssid = ctx.get("guest_ssid", DEFAULT_GUEST_SSID)
    radius_ip  = ctx.get("radius_primary", DEFAULT_RADIUS_IP)
    radius_key = ctx.get("radius_key", DEFAULT_RADIUS_KEY)
    corp_vlan  = ctx.get("wifi_corp_vlan",  DEFAULT_CORP_VLAN)
    guest_vlan = ctx.get("wifi_guest_vlan", DEFAULT_GUEST_VLAN)

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════════╗",
        "! ║   WIRELESS POLICY — Arista EOS (Wi-Fi)   ║",
        "! ╚══════════════════════════════════════════╝",
        "!",
        f"radius-server host {radius_ip} key {radius_key}",
        "aaa group server radius WIFI-RADIUS",
        f"   server {radius_ip}",
        "!",
        "aaa authentication dot1x default group WIFI-RADIUS",
        "!",
        f"wifi profile {corp_ssid}",
        f"   ssid {corp_ssid}",
        f"   vlan {corp_vlan}",
        "   security wpa3-enterprise",
        "   dot1x authentication-list default",
        "   band-steer preferred 5ghz",
        "!",
        f"wifi profile {guest_ssid}",
        f"   ssid {guest_ssid}",
        f"   vlan {guest_vlan}",
        "   security wpa2-owe",
        "   captive-portal enable",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos Wi-Fi (EX/QFX with Mist AI) ────────────────────────────────────

def _junos_wireless(ctx: dict) -> str:
    corp_ssid  = ctx.get("corp_ssid",  DEFAULT_CORP_SSID)
    guest_ssid = ctx.get("guest_ssid", DEFAULT_GUEST_SSID)
    corp_vlan  = ctx.get("wifi_corp_vlan",  DEFAULT_CORP_VLAN)
    guest_vlan = ctx.get("wifi_guest_vlan", DEFAULT_GUEST_VLAN)
    radius_ip  = ctx.get("radius_primary", DEFAULT_RADIUS_IP)
    radius_key = ctx.get("radius_key", DEFAULT_RADIUS_KEY)

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════════════╗",
        "# ║   WIRELESS POLICY — Junos / Mist AI      ║",
        "# ╚══════════════════════════════════════════╝",
        "#",
        "access {",
        "    radius-server {",
        f"        {radius_ip} {{",
        f"            secret \"{radius_key}\";",
        "            timeout 3;",
        "            retry 2;",
        "        }",
        "    }",
        "    profile WIFI-CORP-PROFILE {",
        "        authentication-order dot1x;",
        "        dot1x {",
        f"            authentication-profile-name {corp_ssid};",
        "        }",
        f"        vlan {corp_vlan};",
        "    }",
        "    profile WIFI-GUEST-PROFILE {",
        "        authentication-order none;",
        f"        vlan {guest_vlan};",
        "        captive-portal enable;",
        "    }",
        "}",
        "access-point {",
        "    profile DEFAULT {",
        "        radio 0 {",
        "            mode 802.11ax;",
        "            band 5ghz;",
        "            ssid {",
        f"                {corp_ssid} {{",
        "                    security wpa3-enterprise;",
        "                    dot1x-profile WIFI-CORP-PROFILE;",
        "                }",
        f"                {guest_ssid} {{",
        "                    security owe;",
        "                    captive-portal enable;",
        "                }",
        "            }",
        "        }",
        "        radio 1 {",
        "            mode 802.11ax;",
        "            band 2.4ghz;",
        "            band-steer preferred-band 5ghz;",
        "        }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"
