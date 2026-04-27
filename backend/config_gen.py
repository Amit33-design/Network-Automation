"""
NetDesign AI — Jinja2 Config Generator
========================================
Renders per-device configurations using platform-specific Jinja2 templates.

Usage:
    from config_gen import generate_all_configs
    configs = generate_all_configs(state_dict)
    # returns { "spine1": "<rendered config>", "leaf1": "...", ... }
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined

log = logging.getLogger(__name__)

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
    """Render a single Jinja2 template. Returns empty string on missing template."""
    tpl_path = TEMPLATE_DIR / platform_dir / template_file
    if not tpl_path.exists():
        log.warning("Template not found: %s/%s — skipping", platform_dir, template_file)
        return f"! Template {platform_dir}/{template_file} not found\n"
    env = _get_jinja_env(platform_dir)
    tpl = env.get_template(template_file)
    return tpl.render(**ctx)


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
    if uc == "dc":
        ctx.update({
            "vxlan_vni_base": 10000,
            "bgp_evpn":       "evpn" in state.get("protocols", []),
            "spine_ips":      ["10.0.1.1", "10.0.1.2"],
            "underlay":       "isis" if "is-is" in state.get("protocols", []) else "ospf",
        })
    elif uc == "gpu":
        ctx.update({
            "roce_enabled":  True,
            "pfc_queues":    [3, 4],
            "ecn_threshold": 100000,
            "dcqcn":         True,
        })
    elif uc == "campus":
        ctx.update({
            "dot1x_enabled":  "802.1x" in state.get("security", []),
            "dhcp_snooping":  True,
            "dai_enabled":    True,
            "voice_vlan":     110,
        })

    return ctx


def generate_all_configs(state: dict[str, Any]) -> dict[str, str]:
    """
    Generate configs for all layers with selected products.
    Returns a dict mapping device hostname → rendered config text.
    """
    configs: dict[str, str] = {}
    products = state.get("selectedProducts", {})
    redundancy = state.get("redundancy", "ha")
    dual = redundancy in ("ha", "full")

    for layer, product_id in products.items():
        if not product_id:
            continue

        # Determine platform dir + template
        platform_dir, tpl_file = LAYER_PLATFORM_MAP.get(layer, ("ios_xe", "generic.j2"))

        # Count devices: HA = 2, single = 1
        count = 2 if dual else 1

        for i in range(1, count + 1):
            ctx = _build_device_context(state, layer, i)
            rendered = _render(platform_dir, tpl_file, ctx)
            configs[ctx["hostname"]] = rendered
            log.info("Generated config for %s (%s/%s)", ctx["hostname"], platform_dir, tpl_file)

    return configs
