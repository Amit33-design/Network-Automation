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

# ── Policy registry — ordered list of (flag_key, generator_fn) ──────────────
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
#                            (dc/gpu/hybrid only — no-op for campus/wan)
#   9. ACL                 — iACL, VACL, anti-spoof
#  10. QoS                 — class-maps, queuing, PFC/ECN/DCQCN
#  11. Static routing      — default routes, floating statics, discard agg
#  12. Wireless            — SSID, RF profiles (campus only)
#  13. Firewall policy     — ZBF, NAT, FortiGate/PAN/ASA stanzas
POLICY_REGISTRY = [
    ("include_security_hardening", generate_security_hardening),   # 1 — device baseline
    ("include_control_plane",      generate_control_plane),        # 2 — CoPP + proto auth
    ("include_aaa",                generate_aaa),                  # 3 — AAA / TACACS+
    ("include_vlan_policy",        generate_vlan_policy),          # 4 — VLAN DB / STP
    ("include_trunk_policy",       generate_trunk_policy),         # 5 — LACP / storm ctrl
    ("include_dot1x",              generate_dot1x),                # 6 — 802.1X / IBNS 2.0
    ("include_bgp_policy",         generate_bgp_policy),           # 7 — BGP route-policy
    ("include_evpn_policy",        generate_evpn_policy),          # 8 — EVPN/VXLAN overlay
    ("include_acl",                generate_acl),                  # 9 — iACL / VACL
    ("include_qos",                generate_qos),                  # 10 — QoS / PFC / ECN
    ("include_static_routing",     generate_static_routing),       # 11 — statics / floaters
    ("include_wireless",           generate_wireless_policy),      # 12 — SSID / RF profiles
    ("include_firewall_policy",    generate_firewall_policy),      # 13 — FW zones / NAT
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
        log.error(msg.strip())
        return msg
    except TemplateSyntaxError as exc:
        msg = f"! CONFIG GENERATION ERROR — template syntax error in {platform_dir}/{template_file} line {exc.lineno}: {exc.message}\n"
        log.error(msg.strip())
        return msg
    except Exception as exc:
        msg = f"! CONFIG GENERATION ERROR — {platform_dir}/{template_file}: {exc}\n"
        log.error(msg.strip())
        return msg


def _build_config_header(ctx: dict[str, Any], state: dict[str, Any]) -> str:
    """
    Prepend an auditable metadata block to every generated config.
    Contains: hostname, role, platform, generator version, timestamp, intent hash.
    Uses vendor-appropriate comment syntax.
    """
    platform = ctx.get("platform", "nxos")
    # Junos uses /* */ comments; others use !
    c = "#" if platform in ("sonic", "eos") else "!"

    # Short hash of the intent state for change-detection / audit trail
    try:
        intent_bytes = json.dumps(state, sort_keys=True, default=str).encode()
        intent_hash  = hashlib.sha256(intent_bytes).hexdigest()[:12]
    except Exception:
        intent_hash = "unknown"

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines = [
        f"{c}",
        f"{c} ╔══════════════════════════════════════════════════════════════╗",
        f"{c}   NetDesign AI — Generated Configuration",
        f"{c}   Hostname  : {ctx.get('hostname', 'unknown')}",
        f"{c}   Role      : {ctx.get('layer', 'unknown')}",
        f"{c}   Platform  : {platform}",
        f"{c}   Use-case  : {ctx.get('uc', 'unknown')}",
        f"{c}   Generated : {ts}",
        f"{c}   Version   : 2.4.0",
        f"{c}   Intent    : sha256:{intent_hash}",
        f"{c} ╚══════════════════════════════════════════════════════════════╝",
        f"{c}",
        "",
    ]
    return "\n".join(lines)


def _build_device_context(state: dict[str, Any], layer: str, index: int) -> dict[str, Any]:
    """Build the Jinja2 template context dict for a given device."""
    uc = state.get("uc", "campus")
    products = state.get("selectedProducts", {})
    product_id = products.get(layer, "")
    org = state.get("orgName", "MyOrg")
    redundancy = state.get("redundancy", "ha")

    # Derive hostname
    layer_short = layer.replace("-", "_").upper()
    hostname = f"{org.replace(' ', '-').upper()}-{layer_short}-{index:02d}"

    # IP address helpers (simple /30 subnet scheme for device mgmt)
    mgmt_base = 10 * 256**3 + 100 * 256**2 + 0 * 256 + (index * 4)

    ctx = {
        "hostname":   hostname,
        "layer":      layer,
        "uc":         uc,
        "org":        org,
        "redundancy": redundancy,
        "index":      index,
        "product_id": product_id,
        "protocols":  state.get("protocols", []),
        "security":   state.get("security", []),
        "vlans":      state.get("vlans", []),
        "app_flows":  state.get("appFlows", []),
        "mgmt_ip":    f"10.100.{index}.1",
        "mgmt_mask":  "255.255.255.0",
        "loopback_ip": f"10.0.{index}.{index}",
        "bgp_asn":    65000 + index,
    }

    # Add use-case-specific context
    protos = state.get("protocols", [])
    protos_lower = [p.lower() for p in protos]

    if uc == "dc":
        has_evpn   = any("evpn" in p for p in protos_lower)
        has_vxlan  = any("vxlan" in p for p in protos_lower)
        has_isis   = any("is-is" in p or "isis" in p for p in protos_lower)

        # Real device counts from state (set by nl_parser / capacity model)
        spine_count = int(state.get("spine_count") or 2)
        leaf_count  = int(state.get("leaf_count")  or 4)

        # Spine loopback IPs: 10.0.<spine_idx>.<spine_idx>
        spine_ips = state.get("spineLoopbacks") or [
            f"10.0.{s}.{s}" for s in range(1, spine_count + 1)
        ]

        # ── P2P /31 addressing scheme ──────────────────────────────────────
        # Subnet for spine S ↔ leaf L: 10.2.<S>.<(L-1)*2>/31
        #   spine end (odd)  : 10.2.<S>.<(L-1)*2 + 1>
        #   leaf  end (even) : 10.2.<S>.<(L-1)*2>
        #
        # For a SPINE device (index = S):
        #   uplinks list has one entry per leaf, leaf index 1..leaf_count
        if layer == "dc-spine":
            spine_uplinks = [
                {
                    "name":      f"Ethernet1/{L}",
                    "peer":      f"LEAF-{L:02d}",
                    "ip":        f"10.2.{index}.{(L-1)*2 + 1}/31",
                    "remote_ip": f"10.2.{index}.{(L-1)*2}",
                }
                for L in range(1, leaf_count + 1)
            ]
        else:
            spine_uplinks = []

        # For a LEAF device (index = L):
        #   uplinks list has one entry per spine, spine index 1..spine_count
        if layer == "dc-leaf":
            leaf_uplinks = [
                {
                    "name":      f"Ethernet1/{S}",
                    "peer":      f"SPINE-{S:02d}",
                    "ip":        f"10.2.{S}.{(index-1)*2}/31",
                    "remote_ip": f"10.2.{S}.{(index-1)*2 + 1}",
                }
                for S in range(1, spine_count + 1)
            ]
        else:
            leaf_uplinks = []

        ctx.update({
            "vxlan_vni_base": 10_000,
            "l2vni_base":     10_000,   # L2VNI = l2vni_base + vlan_id
            "l3vni_base":     19_000,   # L3VNI = l3vni_base + vrf_index
            "bgp_evpn":       has_evpn or has_vxlan,
            "has_vxlan":      has_vxlan,
            "spine_ips":      spine_ips,
            "spine_count":    spine_count,
            "leaf_count":     leaf_count,
            "uplinks":        spine_uplinks if layer == "dc-spine" else leaf_uplinks,
            "underlay":       "isis" if has_isis else "ospf",
            # Tenant VRFs for EVPN policy generator
            "tenant_vrfs": [
                {"name": "PROD",    "idx": 1, "vlans": [10, 11]},
                {"name": "DEV",     "idx": 2, "vlans": [20, 21]},
                {"name": "STORAGE", "idx": 3, "vlans": [30]},
            ],
        })
    elif uc == "gpu":
        gpu_specs     = state.get("gpuSpecifics", [])
        specs_lower   = [s.lower() for s in gpu_specs]
        roce_enabled  = any("roce" in s for s in specs_lower) or True   # GPU always RoCEv2
        pfc_enabled   = any("pfc"  in s for s in specs_lower) or True
        ecn_enabled   = any("ecn"  in s for s in specs_lower) or True
        dcqcn_enabled = any("dcqcn" in s for s in specs_lower) or True
        # H100 GPU servers: 8 per rack, each exposing 400GbE NIC
        # BGP ASN pool for TOR-to-host sessions: 65300 + (rack-1)*8 + host_idx
        ctx.update({
            "roce_enabled":    roce_enabled,
            "pfc_queues":      [3, 4],           # lossless priorities
            "pfc_priorities":  "3,4",
            "ecn_threshold":   100_000,          # ECN Kmin=50K, Kmax=100K bytes
            "dcqcn":           dcqcn_enabled,
            "gpu_servers_per_rack": 8,
            "h100_port_speed": 400_000,          # 400GbE per NIC port
            "h100_mtu":        9_214,
            # Spine loopbacks for GPU-TOR BGP sessions
            "spine_ips":       state.get("spineLoopbacks", ["10.3.1.1", "10.3.2.1"]),
        })
    elif uc == "campus":
        ctx.update({
            "dot1x_enabled":  "802.1x" in state.get("security", []),
            "dhcp_snooping":  True,
            "dai_enabled":    True,
            "voice_vlan":     110,
        })

    return ctx


def _platform_from_dir(platform_dir: str) -> str:
    """Convert template directory name to platform key used by policy generators."""
    return {
        "ios_xe": "ios-xe",
        "nxos":   "nxos",
        "eos":    "eos",
        "junos":  "junos",
        "sonic":  "sonic",
    }.get(platform_dir, "ios-xe")


def _append_policies(base_config: str, ctx: dict[str, Any], platform: str,
                     state: dict[str, Any]) -> str:
    """
    Append all enabled policy blocks to a rendered base config.
    Uses POLICY_REGISTRY — each generator is called only if its flag is True.
    Generators return '' when not applicable (wrong UC/platform/layer).
    """
    blocks: list[str] = [base_config]
    sep = "\n!\n!-- ═══════════════ POLICY BLOCKS ═══════════════\n!\n"

    for flag_key, generator_fn in POLICY_REGISTRY:
        if not state.get(flag_key, True):     # default True = include
            continue
        try:
            block = generator_fn(ctx, platform)
            if block and block.strip():
                blocks.append(block)
        except Exception as exc:
            log.warning("Policy '%s' error for %s: %s",
                        flag_key, ctx.get("hostname"), exc)

    if len(blocks) > 1:
        result = blocks[0] + sep + "\n".join(blocks[1:])
    else:
        result = base_config

    # custom_structured_config: per-hostname raw CLI override, appended last (AVD pattern)
    hostname = ctx.get("hostname", "")
    custom_block = (
        state.get("custom_configs", {}).get(hostname)
        or state.get("custom_configs", {}).get("*")  # wildcard applies to all devices
    )
    if custom_block and custom_block.strip():
        custom_sep = "\n!\n!-- ═══════════════ CUSTOM CONFIG (user-defined) ═══════════════\n!\n"
        result += custom_sep + custom_block.strip() + "\n"

    return result


def generate_device_config(state: dict[str, Any], layer: str, index: int,
                            platform_override: str | None = None) -> tuple[str, str]:
    """
    Generate config for a single device.
    Returns (hostname, full_config_text).
    platform_override forces a specific platform key (ios-xe, nxos, eos, junos, sonic).
    """
    platform_dir, tpl_file = LAYER_PLATFORM_MAP.get(layer, ("ios_xe", "generic.j2"))
    platform_key = platform_override or _platform_from_dir(platform_dir)
    ctx = _build_device_context(state, layer, index)
    header   = _build_config_header(ctx, state)
    rendered = _render(platform_dir, tpl_file, ctx)
    full     = _append_policies(rendered, ctx, platform_key, state)
    return ctx["hostname"], header + full


def generate_all_configs(state: dict[str, Any]) -> dict[str, str]:
    """
    Generate configs for all layers with selected products.
    Returns a dict mapping device hostname → rendered config + all policy blocks.

    Respects _detected_vendor from nl_parser:
      Arista → eos template dir  (spine.j2 / leaf.j2 in eos/)
      Juniper → junos template dir
      SONiC/NVIDIA → sonic template dir
      Default → nxos (Cisco NX-OS)
    """
    configs: dict[str, str] = {}
    products   = state.get("selectedProducts", {})
    redundancy = state.get("redundancy", "ha")
    dual       = redundancy in ("ha", "full")

    # Vendor override from NL parse result
    detected_vendor = state.get("_detected_vendor", "")
    vendor_platform = VENDOR_PLATFORM_OVERRIDE.get(detected_vendor, "")

    # Explicit platform filter (set by MCP caller via state["_platform_filter"])
    platform_filter: list[str] | None = state.get("_platform_filter")

    for layer, product_id in products.items():
        if not product_id:
            continue

        # Determine platform dir + template from LAYER_PLATFORM_MAP
        platform_dir, tpl_file = LAYER_PLATFORM_MAP.get(layer, ("ios_xe", "generic.j2"))

        # Apply vendor override for dc-spine and dc-leaf (campus/gpu layers have
        # their own explicit entries in LAYER_PLATFORM_MAP and should not be overridden)
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

        # Platform filter (e.g. only generate eos configs)
        if platform_filter and platform_key not in platform_filter:
            continue

        # Count devices: HA = 2, single = 1; spine always = spine_count
        if layer in ("dc-spine", "gpu-spine"):
            count = state.get("spine_count") or (2 if dual else 1)
        elif layer in ("dc-leaf", "gpu-tor"):
            count = state.get("leaf_count") or (4 if dual else 2)
        else:
            count = 2 if dual else 1

        for i in range(1, count + 1):
            ctx = _build_device_context(state, layer, i)
            header      = _build_config_header(ctx, state)
            rendered    = _render(platform_dir, tpl_file, ctx)
            full_config = _append_policies(rendered, ctx, platform_key, state)
            configs[ctx["hostname"]] = header + full_config
            log.info(
                "Generated config+policies for %s (%s/%s, vendor=%s)",
                ctx["hostname"], platform_dir, tpl_file, detected_vendor or "default",
            )

    return configs
