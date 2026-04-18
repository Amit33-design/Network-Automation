"""CLI for GPU cluster network automation."""

import argparse
import sys
import json

from .models import Fabric
from .readiness import DCReadiness
from . import reporter


def cmd_build(args) -> None:
    """Generate device configs from topology YAML."""
    try:
        from .config import ConfigBuilder
    except ImportError:
        print("Error: jinja2 required — pip install jinja2")
        sys.exit(1)

    fabric = Fabric.from_yaml(args.topology)
    builder = ConfigBuilder(fabric)

    if args.device:
        device = next((d for d in fabric.all_devices() if d.name == args.device), None)
        if not device:
            print(f"Error: device '{args.device}' not found in topology")
            sys.exit(1)
        from .models import Spine
        if isinstance(device, Spine):
            cfg = builder.build_spine_config(device)
        else:
            cfg = builder.build_leaf_config(device) + "\n\n" + builder.build_qos_config()
        print(cfg)
    else:
        paths = builder.save_all(args.output_dir)
        print(f"Generated {len(paths)} config file(s) in '{args.output_dir}':")
        for p in paths:
            print(f"  {p}")


def cmd_check(args) -> None:
    """Run pre or post deployment checks."""
    fabric = Fabric.from_yaml(args.topology)
    dr = DCReadiness(fabric)

    devices = args.devices.split(",") if args.devices else None
    fail_sims = args.simulate_failures.split(",") if args.simulate_failures else []

    print(f"\n[gpu-net] Running {args.phase.upper()} checks on fabric: {fabric.name}")
    print(f"  Devices : {devices or 'all'}")
    print(f"  Mode    : {'mock/dry-run' if args.mock else 'LIVE (SSH)'}\n")

    if args.phase == "pre":
        report = dr.run_pre(mock=args.mock, fail_checks=fail_sims, devices=devices)
    elif args.phase == "post":
        report = dr.run_post(mock=args.mock, fail_checks=fail_sims, devices=devices)
    else:
        reports = dr.run_both(mock=args.mock, fail_checks=fail_sims)
        for phase, rep in reports.items():
            _print_report(rep)
            if args.output:
                path = f"{args.output}.{phase}.{args.format}"
                reporter.save(rep, path, fmt=args.format)
        return

    _print_report(report)

    if args.output:
        reporter.save(report, args.output, fmt=args.format)

    sys.exit(0 if report.is_ready else 1)


def cmd_readiness(args) -> None:
    """Full DC operational readiness check (pre + post)."""
    fabric = Fabric.from_yaml(args.topology)
    dr = DCReadiness(fabric)

    fail_sims = args.simulate_failures.split(",") if args.simulate_failures else []

    print(f"\n[gpu-net] DC Operational Readiness: {fabric.name}")
    print(f"  Spines : {[s.name for s in fabric.spines]}")
    print(f"  Leaves : {[l.name for l in fabric.leaves]}")
    print(f"  Mode   : {'mock/dry-run' if args.mock else 'LIVE (SSH)'}\n")

    phase = args.phase
    if phase == "pre":
        report = dr.run_pre(mock=args.mock, fail_checks=fail_sims)
    elif phase == "post":
        report = dr.run_post(mock=args.mock, fail_checks=fail_sims)
    else:
        # Run pre + post, combine into a merged report
        reports = dr.run_both(mock=args.mock, fail_checks=fail_sims)
        for p, rep in reports.items():
            _print_report(rep)
        # Save both if requested
        if args.output:
            for p, rep in reports.items():
                path = f"{args.output.replace('.html','').replace('.json','')}.{p}"
                ext = "html" if args.format == "html" else args.format
                reporter.save(rep, f"{path}.{ext}", fmt=args.format)
        combined_ready = all(r.is_ready for r in reports.values())
        print(f"\n{'='*60}")
        print(f"  OVERALL VERDICT: {'✅ READY' if combined_ready else '❌ NOT READY'}")
        print(f"{'='*60}")
        sys.exit(0 if combined_ready else 1)

    _print_report(report)
    if args.output:
        reporter.save(report, args.output, fmt=args.format)
    sys.exit(0 if report.is_ready else 1)


def _print_report(report) -> None:
    print(reporter.to_text(report))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="gpu-net",
        description="GPU Cluster Network Automation — RoCEv2/VXLAN/EVPN config build & DC readiness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate configs for all devices
  gpu-net build --topology topology.yaml --output-dir configs/

  # Generate config for a single device
  gpu-net build --topology topology.yaml --device leaf1

  # Pre-deployment checks (mock/dry-run)
  gpu-net check pre --topology topology.yaml --mock

  # Pre-deployment checks on live devices
  gpu-net check pre --topology topology.yaml

  # Post-deployment checks, save HTML report
  gpu-net check post --topology topology.yaml --mock -o report.html -f html

  # Full readiness (pre + post) with simulated failures
  gpu-net readiness --topology topology.yaml --mock --simulate-failures pfc_operational,ecn_thresholds

  # Full readiness on live fabric, save JSON
  gpu-net readiness --topology topology.yaml --phase both -o dc-readiness.json -f json
        """,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # build
    build_p = sub.add_parser("build", help="Generate device configs from topology")
    build_p.add_argument("--topology", required=True, metavar="FILE")
    build_p.add_argument("--device", metavar="NAME", help="Generate config for a single device")
    build_p.add_argument("--output-dir", default="configs", metavar="DIR")

    # check
    check_p = sub.add_parser("check", help="Run pre or post-deployment checks")
    check_p.add_argument("phase", choices=["pre", "post", "both"])
    check_p.add_argument("--topology", required=True, metavar="FILE")
    check_p.add_argument("--mock", action="store_true", help="Dry-run with mock data (no SSH)")
    check_p.add_argument("--devices", metavar="NAME[,NAME]", help="Comma-separated device names")
    check_p.add_argument("--simulate-failures", default="", metavar="CHECK[,CHECK]",
                         help="Simulate check failures for testing")
    check_p.add_argument("-o", "--output", metavar="FILE")
    check_p.add_argument("-f", "--format", choices=["text", "json", "html"], default="text")

    # readiness
    ready_p = sub.add_parser("readiness", help="Full DC operational readiness assessment")
    ready_p.add_argument("--topology", required=True, metavar="FILE")
    ready_p.add_argument("--phase", choices=["pre", "post", "both"], default="both")
    ready_p.add_argument("--mock", action="store_true", help="Dry-run with mock data (no SSH)")
    ready_p.add_argument("--simulate-failures", default="", metavar="CHECK[,CHECK]")
    ready_p.add_argument("-o", "--output", metavar="FILE")
    ready_p.add_argument("-f", "--format", choices=["text", "json", "html"], default="text")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    dispatch = {"build": cmd_build, "check": cmd_check, "readiness": cmd_readiness}
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
