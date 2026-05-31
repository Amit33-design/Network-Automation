"""
NetDesign AI — Jinja2 Config Generator
========================================
Renders per-device configurations using platform-specific Jinja2 templates,
then appends comprehensive policy blocks.

Usage:
    from config_gen import generate_all_configs
    configs = generate_all_configs(state_dict)
    # returns { "hostname": "<rendered config + all policies>" }

    from config_gen import generate_device_config
    config = generate_device_config(state_dict, layer, index, platform_override=None)

Policy flags (state dict keys, all default True):
    include_security_hardening— Port security, BPDU guard, DAI, DHCP snooping,
                                IP Source Guard, storm control, SSH v2 hardening,
                                service disablement, login policies, banners
    include_control_plane     — CoPP 8-class, routing proto auth (BGP HMAC-SHA-256,
                                OSPF SHA-256, IS-IS HMAC-MD5, EIGRP HMAC-SHA-256),
                                GTSM, uRPF strict, Management Plane Protection
    include_aaa               — TACACS+, SNMPv3, Syslog, NTP auth
    include_vlan_policy       — VLAN DB, STP priorities, VACLs, SVIs
    include_trunk_policy      — LACP port-channels, storm ctrl, BPDU guard
    include_dot1x             — 802.1X / IBNS 2.0 (campus only)
    include_bgp_policy        — BGP route-maps, prefix-lists, community TE
                                colouring, per-layer EVPN RT community import/
                                export policies (spine RR vs leaf VTEP)
    include_evpn_policy       — Full EVPN/VXLAN overlay: L2VNI, L3VNI, tenant
                                VRFs (PROD/DEV/STORAGE), NVE/VTEP interface,
                                per-VNI route-target import/export, BGP EVPN
                                address-family, spine retain-route-target-all.
                                Active for dc/gpu/hybrid only.
    include_acl               — iACL, VLAN ACLs, anti-spoof, VTY
    include_qos               — class-maps, queuing, PFC/ECN, DCQCN (GPU/DC)
    include_static_routing    — Default/floating statics, discard aggregates
    include_wireless          — SSID, 802.1X/OWE, RF profiles (campus only)
    include_firewall_policy   — ZBF zones/NAT (IOS-XE), FortiGate, Palo Alto, ASA
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, TemplateSyntaxError, UndefinedError

# Policy generators — full suite
from policies.bgp_policy            import generate_bgp_policy
from policies.evpn_policy           import generate_evpn_policy
from policies.acl                   import generate_acl
from policies.dot1x                 import generate_dot1x
from policies.qos_policy            import generate_qos
from policies.aaa_policy            import generate_aaa
from policies.static_routing        import generate_static_routing
from policies.vlan_policy           import generate_vlan_policy
from policies.trunk_policy          import generate_trunk_policy
from policies.wireless_policy       import generate_wireless_policy
from policies.control_plane         import generate_control_plane
from policies.security_hardening    import generate_security_hardening
from policies.firewall_policy       import generate_firewall_policy

log = logging.getLogger(__name__)

# ── Policy registry — ordered list of (flag_key, generator_fn) ──────────────────
# Execution order is significant:
#   1. Security hardening  — device baseline (SSH, banners, service disable)
#   2. Control plane       — CoPP, proto auth, GTSM, uRPF, MPP
#   3. AAA                 — TACACS+, SNMPv3, syslog, NTP auth
#   4. VLAN policy         — VLAN DB, STP, SVIs, PVLAN
#   5. Trunk policy        — LACP port-channels, storm ctrl
#   6. 802.1X              — IBNS 2.0, RADIUS, MAB, CoA
#   7. BGP policy          — prefix-lists, route-maps, community TE colouring,
#                            per-layer EVPN RT community import/export policies
#   8. EVPN overlay        — L2VNI, L3VNI, tenant VRFs, NVE/VTEP, per-VNI RT
#                            import/export, spine RR vs leaf VTEP distinction
#   9. ACL                 — iACL, VLAN ACLs, anti-spoof, VTY
#  10. QoS                 — class-maps, queuing, PFC/ECN, DCQCN
#  11. Static routing      — default/floating statics, discard aggregates
#  12. Wireless            — SSID, 802.1X/OWE, RF profiles
#  13. Firewall            — ZBF, NAT, FortiOS, PAN-OS, ASA
_POLICY_REGISTRY: list[tuple[str, Any]] = [
    ("include_security_hardening", generate_security_hardening),
    ("include_control_plane",      generate_control_plane),
    ("include_aaa",                generate_aaa),
    ("include_vlan_policy",        generate_vlan_policy),
    ("include_trunk_policy",       generate_trunk_policy),
    ("include_dot1x",              generate_dot1x),
    ("include_bgp_policy",         generate_bgp_policy),
    ("include_evpn_policy",        generate_evpn_policy),
    ("include_acl",                generate_acl),
    ("include_qos",                generate_qos),
    ("include_static_routing",     generate_static_routing),
    ("include_wireless",           generate_wireless_policy),
    ("include_firewall_policy",    generate_firewall_policy),
]


TEMPLATE_DIR = Path(__file__).parent / "templates"

# Map layer key → (template_dir, template_file)
LAYER_PLATFORM_MAP: dict[str, tuple[str, str]] = {
    # Campus
    "campus-access": ("ios_xe", "access.j2"),
    "campus-dist":   ("ios_xe", "distribution.j2"),
    "campus-core":   ("ios_xe", "core.j2"),
    # Data Center
    "dc-leaf":       ("nxos",   "leaf.j2"),
    "dc-spine":      ("nxos",   "spine.j2"),
    # GPU / AI
    "gpu-tor":       ("sonic",  "gpu_tor.j2"),
    "gpu-spine":     ("eos",    "gpu_spine.j2"),
    # WAN
    "wan-router":    ("ios_xe", "wan_router.j2"),
    # Firewall — separate template per vendor (handled below)
    "fw":            ("ios_xe", "firewall.j2"),
}

# Vendor override — if vendor in product matches, use different platform dir
VENDOR_PLATFORM_OVERRIDE: dict[str, str] = {
    "Arista":  "eos",
    "Juniper": "junos",
    "NVIDIA":  "sonic",
}


def _get_jinja_env(platform_dir: str) -> Environment:
    loader = FileSystemLoader(str(TEMPLATE_DIR / platform_dir))
    return Environment(
        loader=loader,
        undefined=StrictUndefined,
        keep_trailing_newline=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )


def _render(platform_dir: str, template_file: str, ctx: dict[str, Any]) -> str:
    """Render a single Jinja2 template. Returns a descriptive error comment on failure."""
    tpl_path = TEMPLATE_DIR / platform_dir / template_file
    if not tpl_path.exists():
        log.warning("Template not found: %s/%s — skipping", platform_dir, template_file)
        return f"! Template {platform_dir}/{template_file} not found\n"
    try:
        env = _get_jinja_env(platform_dir)
        tpl = env.get_template(template_file)
        return tpl.render(**ctx)
    except UndefinedError as exc:
        msg = f"! CONFIG GENERATION ERROR — undefined variable in {platform_dir}/{template_file}: {exc}\n"
        log.error(msg)
        return msg
    except TemplateSyntaxError as exc:
        msg = f"! CONFIG GENERATION ERROR — template syntax error in {platform_dir}/{template_file} line {exc.lineno}: {exc.message}\n"
        log.error(msg)
        return msg
    except Exception as exc:
        msg = f"! CONFIG GENERATION ERROR — {platform_dir}/{template_file}: {exc}\n"
        log.error(msg)
        return msg


def _build_config_header(ctx: dict[str, Any], state: dict[str, Any]) -> str:
    """
    Build a standardised config header comment block.
    Contains: hostname, role, platform, generator version, timestamp, intent hash.
    """
    platform = ctx.get("platform", "nxos")
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    c = "#" if platform in ("sonic", "eos") else "!"

    intent_hash = hashlib.sha256(
        json.dumps(state, sort_keys=True, default=str).encode()
    ).hexdigest()[:12]

    lines = [
        f"{c} {'=' * 65}",
        f"{c}  NetDesign AI — Auto-generated Device Configuration",
        f"{c}  {'=' * 63}",
        f"{c}   Hostname  : {ctx.get('hostname', 'unknown')}",
        f"{c}   Role      : {ctx.get('layer', 'unknown')}",
        f"{c}   Platform  : {platform}",
        f"{c}   Generated : {ts}",
        f"{c}   Intent    : sha256:{intent_hash}",
        f"{c}   Version   : NetDesign AI v2.4.0",
        f"{c} {'=' * 65}",
        "",
    ]
    return "\n".join(lines)


def _build_device_context(state: dict[str, Any], layer: str, index: int) -> dict[str, Any]:
    """
    Build the Jinja2 template context dict for a given device.
    """
    org          = state.get("orgName", "NetDesignAI")
    use_case     = state.get("uc", "campus")
    protocols    = state.get("protocols", [])
    overlay      = state.get("overlay", [])
    redundancy   = state.get("redundancy", "full")
    bgp_asn      = state.get("bgpAsn", state.get("bgp_asn", 65000 + index))
    underlay     = state.get("underlay", "ospf").lower()
    bandwidth    = state.get("bandwidth_gbps", state.get("bandwidthGbps", 10))
    ep_count     = state.get("endpoint_count", state.get("endpointCount", 100))

    # IP plan helpers
    ip_plan      = state.get("ipPlan", state.get("ip_plan", {}))
    devices_list = ip_plan.get("devices", [])
    dev_entry    = devices_list[index - 1] if index - 1 < len(devices_list) else {}

    loopback_ip  = dev_entry.get("loopback",  f"10.0.{index}.{index}")
    mgmt_ip      = dev_entry.get("mgmt_ip",   f"10.100.0.{index + 10}")
    hostname     = dev_entry.get("hostname",  f"{layer}-{index:02d}".upper())

    # Uplink list for spine templates
    uplinks_raw  = dev_entry.get("uplinks", [])
    uplinks      = [
        {"name": ul.get("iface", f"Ethernet{i*4}"),
         "peer": ul.get("peer",  f"PEER-{i+1}"),
         "ip":   ul.get("ip",    f"10.2.{index}.{i*2+1}/31")}
        for i, ul in enumerate(uplinks_raw)
    ]

    return {
        "hostname":        hostname,
        "org":             org,
        "use_case":        use_case,
        "layer":           layer,
        "index":           index,
        "loopback_ip":     loopback_ip,
        "mgmt_ip":         mgmt_ip,
        "bgp_asn":         bgp_asn,
        "underlay":        underlay,
        "protocols":       protocols,
        "overlay":         overlay,
        "redundancy":      redundancy,
        "bandwidth_gbps":  bandwidth,
        "endpoint_count":  ep_count,
        "uplinks":         uplinks,
        # Policy flags (default all enabled)
        "include_security_hardening": state.get("include_security_hardening", True),
        "include_control_plane":      state.get("include_control_plane",      True),
        "include_aaa":                state.get("include_aaa",                True),
        "include_vlan_policy":        state.get("include_vlan_policy",        True),
        "include_trunk_policy":       state.get("include_trunk_policy",       True),
        "include_dot1x":              state.get("include_dot1x",              True),
        "include_bgp_policy":         state.get("include_bgp_policy",         True),
        "include_evpn_policy":        state.get("include_evpn_policy",        True),
        "include_acl":                state.get("include_acl",                True),
        "include_qos":                state.get("include_qos",                True),
        "include_static_routing":     state.get("include_static_routing",     True),
        "include_wireless":           state.get("include_wireless",           False),
        "include_firewall_policy":    state.get("include_firewall_policy",    False),
        # Full state dict (for policy generators that need broader context)
        "_state":          state,
    }


def _platform_from_dir(platform_dir: str) -> str:
    """Convert template directory name to platform key used by policy generators."""
    return {
        "nxos":   "nxos",
        "eos":    "eos",
        "junos":  "junos",
        "sonic":  "sonic",
        "ios_xe": "ios-xe",
    }.get(platform_dir, "ios-xe")


def _append_policies(base_config: str, ctx: dict[str, Any], platform: str,
                     state: dict[str, Any]) -> str:
    """
    Run each enabled policy generator and append non-empty output to base_config.
    Generators return '' when not applicable (wrong UC/platform/layer).
    """
    parts = [base_config]
    for flag_key, generator_fn in _POLICY_REGISTRY:
        if not ctx.get(flag_key, True):
            continue
        try:
            block = generator_fn(ctx, platform)
            if block and block.strip():
                parts.append(block)
        except Exception as exc:
            log.warning("Policy generator %s failed: %s", generator_fn.__name__, exc)
    return "\n".join(parts)


def generate_device_config(
    state: dict[str, Any],
    layer: str,
    index: int,
    platform_override: str | None = None,
) -> tuple[str, str]:
    """
    Render a single device configuration.

    Returns (hostname, full_config_text).

    platform_override forces a specific platform key (ios-xe, nxos, eos, junos, sonic).
    """
    platform_dir, tpl_file = LAYER_PLATFORM_MAP.get(layer, ("ios_xe", "generic.j2"))
    platform_key = platform_override or _platform_from_dir(platform_dir)

    ctx = _build_device_context(state, layer, index)
    ctx["platform"] = platform_key

    rendered = _render(platform_dir, tpl_file, ctx)
    full     = _append_policies(rendered, ctx, platform_key, state)
    header   = _build_config_header(ctx, state)

    return ctx["hostname"], header + full


def generate_all_configs(state: dict[str, Any]) -> dict[str, str]:
    """
    Generate configurations for all devices derived from the design state.

    Arista → eos template dir  (spine.j2 / leaf.j2 in eos/)
    Juniper → junos template dir
    SONiC/NVIDIA → sonic template dir
    All others → LAYER_PLATFORM_MAP default (NX-OS for DC, IOS-XE for campus)
    """
    results: dict[str, str] = {}

    layers_counts = _derive_layers(state)

    detected_vendor = _detect_primary_vendor(state)
    vendor_platform = VENDOR_PLATFORM_OVERRIDE.get(detected_vendor, "")

    # Explicit platform filter (set by MCP caller via state["_platform_filter"])
    platform_filter: list[str] | None = state.get("_platform_filter")

    for layer, count in layers_counts.items():
        for i in range(1, count + 1):
            try:
                # Determine platform dir + template from LAYER_PLATFORM_MAP
                platform_dir, tpl_file = LAYER_PLATFORM_MAP.get(layer, ("ios_xe", "generic.j2"))

                if vendor_platform and layer in ("dc-spine", "dc-leaf"):
                    # Check template exists for this vendor before switching
                    candidate = TEMPLATE_DIR / vendor_platform / tpl_file
                    if candidate.exists():
                        platform_dir = vendor_platform
                    else:
                        log.debug(
                            "Vendor template %s/%s not found — falling back to %s",
                            vendor_platform, tpl_file, platform_dir,
                        )

                platform_key = _platform_from_dir(platform_dir)

                if platform_filter and platform_key not in platform_filter:
                    continue

                ctx = _build_device_context(state, layer, i)
                ctx["platform"] = platform_key

                rendered = _render(platform_dir, tpl_file, ctx)
                full     = _append_policies(rendered, ctx, platform_key, state)
                header   = _build_config_header(ctx, state)

                results[ctx["hostname"]] = header + full

            except Exception as exc:
                log.error("generate_all_configs failed for layer=%s index=%d: %s", layer, i, exc)

    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _derive_layers(state: dict[str, Any]) -> dict[str, int]:
    """Return {layer_key: device_count} dict from design state."""
    uc = state.get("uc", state.get("use_case", "campus"))

    # If ip_plan has devices listed, use those directly
    ip_plan = state.get("ipPlan", state.get("ip_plan", {}))
    if ip_plan.get("devices"):
        counts: dict[str, int] = {}
        for dev in ip_plan["devices"]:
            role = dev.get("role", "campus-access")
            counts[role] = counts.get(role, 0) + 1
        return counts

    # Fall back to use-case sizing
    num_spine  = state.get("numSpine",  state.get("num_spine",  2))
    num_leaf   = state.get("numLeaf",   state.get("num_leaf",   4))
    num_access = state.get("numAccess", state.get("num_access", 8))
    num_dist   = state.get("numDist",   state.get("num_dist",   2))
    num_core   = state.get("numCore",   state.get("num_core",   2))
    num_fw     = state.get("numFirewalls", 1)
    num_wan    = state.get("numWanRouters", state.get("num_wan_routers", 0))

    if uc in ("campus", "enterprise"):
        d = {"campus-access": num_access, "campus-dist": num_dist, "campus-core": num_core}
        if num_fw:  d["fw"] = num_fw
        return d
    elif uc in ("datacenter", "dc", "dc_fabric", "hybrid"):
        d = {"dc-spine": num_spine, "dc-leaf": num_leaf}
        if num_fw:  d["fw"] = num_fw
        return d
    elif uc in ("gpu", "ai_fabric", "gpu_cluster"):
        return {"gpu-spine": num_spine, "gpu-tor": num_leaf}
    elif uc in ("wan", "sd_wan", "dci"):
        d: dict[str, int] = {}
        if num_wan:  d["wan-router"] = num_wan
        if num_core: d["campus-core"] = num_core
        if num_fw:   d["fw"] = num_fw
        return d
    else:
        # multicloud, sp_mpls, etc. — generic fallback
        d = {"campus-core": num_core}
        if num_fw:  d["fw"] = num_fw
        if num_wan: d["wan-router"] = num_wan
        return d


def _detect_primary_vendor(state: dict[str, Any]) -> str:
    """Return the primary vendor string from the design state."""
    vendors = state.get("vendors", state.get("selectedVendors", []))
    if not vendors:
        return ""
    v = vendors[0].lower() if isinstance(vendors[0], str) else ""
    if "arista" in v:
        return "Arista"
    if "juniper" in v or "junos" in v:
        return "Juniper"
    if "nvidia" in v or "sonic" in v:
        return "NVIDIA"
    return ""
