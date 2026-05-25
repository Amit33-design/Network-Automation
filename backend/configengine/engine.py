#!/usr/bin/env python3
"""NetDesign AI — Jinja2 Config Engine

Renders per-device network configs from Jinja2 templates + inventory JSON.

Usage:
    python engine.py --inventory inventory.json --out configs/
    python engine.py --inventory inventory.json --device LEAF-01

Requirements:
    pip install jinja2

Inventory JSON is exported from the NetDesign AI browser tool (Step 7 tab).
Templates live alongside this script in ./templates/<platform>/<role>.j2
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from jinja2 import Environment, FileSystemLoader, StrictUndefined, UndefinedError
except ImportError:
    print("ERROR: jinja2 not installed. Run: pip install jinja2", file=sys.stderr)
    sys.exit(1)

# Map (vendor, sub_layer) → template path relative to templates/
TEMPLATE_MAP = {
    ("cisco",   "spine"):              "nxos/spine.j2",
    ("cisco",   "leaf"):               "nxos/leaf.j2",
    ("cisco",   "pe-router"):          "iosxr/pe_router.j2",
    ("cisco",   "p-router"):           "iosxr/p_router.j2",
    ("cisco",   "wan-edge"):           "iosxe/wan_edge.j2",
    ("cisco",   "sdwan-controller"):   "sdwan/controller.j2",
    ("cisco",   "sdwan-orchestrator"): "sdwan/orchestrator.j2",
    ("arista",  "spine"):              "eos/spine.j2",
    ("arista",  "leaf"):               "eos/leaf.j2",
    ("juniper", "spine"):              "junos/leaf.j2",
    ("juniper", "leaf"):               "junos/leaf.j2",
    ("nvidia",  "leaf"):               "sonic/leaf.j2",
}


def _template_key(device):
    vendor = device.get("vendor", "").lower()
    role   = device.get("sub_layer", "")
    return (vendor, role)


def render_device(env, device, site_vars):
    key       = _template_key(device)
    tmpl_path = TEMPLATE_MAP.get(key)
    if not tmpl_path:
        vendor, role = key
        return (
            f"! No Jinja2 template registered for vendor={vendor!r} sub_layer={role!r}\n"
            f"! Add a template at templates/{vendor}/{role}.j2 and register it in TEMPLATE_MAP\n"
        )
    try:
        tmpl   = env.get_template(tmpl_path)
        return tmpl.render(device=device, site=site_vars)
    except UndefinedError as e:
        return f"! Template render error for {device.get('hostname','?')}: {e}\n"


def build_env(templates_dir):
    return Environment(
        loader=FileSystemLoader(str(templates_dir)),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )


def main():
    parser = argparse.ArgumentParser(
        description="NetDesign AI — Jinja2 Config Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--inventory",  default="inventory.json",
                        help="Path to inventory.json exported from the browser tool")
    parser.add_argument("--templates",  default=str(Path(__file__).parent / "templates"),
                        help="Path to Jinja2 templates directory")
    parser.add_argument("--out",        default="configs",
                        help="Output directory for rendered config files")
    parser.add_argument("--device",     default=None,
                        help="Render only this hostname (default: all devices)")
    parser.add_argument("--dry-run",    action="store_true",
                        help="Print rendered configs to stdout, do not write files")
    parser.add_argument("--list",       action="store_true",
                        help="List devices in the inventory and exit")
    args = parser.parse_args()

    # Load inventory
    try:
        with open(args.inventory) as f:
            inv = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: inventory file not found: {args.inventory}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON in {args.inventory}: {e}", file=sys.stderr)
        sys.exit(1)

    devices = inv.get("devices", [])
    if args.list:
        print(f"Inventory: {args.inventory}  ({len(devices)} devices)")
        for d in devices:
            print(f"  {d.get('hostname','?'):30s}  {d.get('vendor','?'):10s}  {d.get('sub_layer','?')}")
        return

    # Filter to single device if requested
    if args.device:
        devices = [d for d in devices if d.get("hostname") == args.device]
        if not devices:
            print(f"ERROR: device {args.device!r} not found in inventory", file=sys.stderr)
            sys.exit(1)

    # Site-level variables passed to every template as {{ site.* }}
    site_vars = {
        "site":            inv.get("site",      "SITE"),
        "protocols":       inv.get("protocols", {}),
        "topology":        inv.get("topology",  {}),
        "bgp_keepalive":   inv.get("bgp_keepalive",   3),
        "bgp_hold":        inv.get("bgp_hold",        9),
        "bgp_adv_interval":inv.get("bgp_adv_interval",0),
    }

    env     = build_env(args.templates)
    out_dir = Path(args.out)
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    for device in devices:
        hostname = device.get("hostname", "unknown")
        config   = render_device(env, device, site_vars)
        if args.dry_run:
            print(f"\n{'='*60}")
            print(f"# {hostname}")
            print('='*60)
            print(config)
        else:
            out_file = out_dir / f"{hostname}.cfg"
            out_file.write_text(config)
            print(f"  ✓  {hostname:30s} → {out_file}")
        ok += 1

    if not args.dry_run:
        print(f"\n✓ {ok} configs written to {args.out}/")


if __name__ == "__main__":
    main()
