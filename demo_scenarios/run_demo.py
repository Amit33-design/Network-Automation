#!/usr/bin/env python3
"""Full E2E lab demo: ZTP, monitoring, and pre/post checks for all device types.

Usage:
  python demo_scenarios/run_demo.py
  python demo_scenarios/run_demo.py --scenario ztp
  python demo_scenarios/run_demo.py --scenario monitor
  python demo_scenarios/run_demo.py --scenario checks
  python demo_scenarios/run_demo.py --topology lab_topologies/demo_full_datacenter.yaml
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from repo root without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from gpu_cluster_net.checks.base import CheckStatus
from lab_demo import (
    DeviceRole,
    DeviceSimulator,
    FirewallChecker,
    HealthStatus,
    LabTopology,
    LoadBalancerChecker,
    MonitoringEngine,
    RouterChecker,
    SwitchChecker,
    ZTPEngine,
    ZTPState,
)

DEFAULT_TOPOLOGY = (
    Path(__file__).parent.parent / "lab_topologies" / "demo_full_datacenter.yaml"
)

# ANSI colours
G = "\033[92m"   # green
R = "\033[91m"   # red
Y = "\033[93m"   # yellow
C = "\033[96m"   # cyan
B = "\033[1m"    # bold
DIM = "\033[2m"  # dim
RST = "\033[0m"  # reset

_CHECKER_MAP = {
    DeviceRole.ROUTER: RouterChecker,
    DeviceRole.SWITCH: SwitchChecker,
    DeviceRole.FIREWALL: FirewallChecker,
    DeviceRole.GPU_FIREWALL: FirewallChecker,
    DeviceRole.LOAD_BALANCER: LoadBalancerChecker,
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _banner(title: str) -> None:
    width = 66
    print(f"\n{B}{C}{'═' * width}")
    print(f"  {title}")
    print(f"{'═' * width}{RST}")


def _ok(flag: bool) -> str:
    return f"{G}✔{RST}" if flag else f"{R}✘{RST}"


def _status_color(status: str) -> str:
    colors = {
        "healthy": G,
        "online": G,
        "degraded": Y,
        "down": R,
        "failed": R,
        "unknown": DIM,
    }
    return colors.get(status.lower(), RST)


def _health_color(h: HealthStatus) -> str:
    return _status_color(h.value)


# ── ZTP Demo ─────────────────────────────────────────────────────────────────

def run_ztp_demo(topology: LabTopology) -> None:
    _banner("ZTP DEMO — Zero Touch Provisioning all lab devices")

    all_devices = topology.all_devices()
    print(f"\n  Provisioning {B}{len(all_devices)}{RST} devices through ZTP pipeline...\n")
    print(f"  {'Device':<24} {'State':<32} {'Message'}")
    print(f"  {DIM}{'-' * 75}{RST}")

    def on_event(evt):
        icon = _ok(evt.success)
        label = evt.state.value.upper().replace("_", " ")
        color = G if evt.success else R
        print(
            f"  {icon} {evt.device_name:<22} "
            f"{color}{label:<30}{RST} {DIM}{evt.message}{RST}"
        )

    engine = ZTPEngine(on_event=on_event)

    # Demo fault injection: simulate one device failing at CONFIG_APPLIED
    # then recover it automatically (re-provision) to show self-healing
    fail_target = topology.routers[1].name if len(topology.routers) > 1 else None

    print(f"\n  {Y}[FAULT INJECTION]{RST} Simulating failure on '{fail_target}'...\n")
    results = engine.provision_topology(
        all_devices,
        fail_devices={fail_target: ZTPState.CONFIG_APPLIED} if fail_target else {},
    )

    if fail_target and not results[fail_target]:
        print(f"\n  {Y}[RECOVERY]{RST} Re-provisioning '{fail_target}'...")
        engine.provision_device(topology.get_device(fail_target))
        results[fail_target] = True

    s = engine.summary()
    print(f"\n  {B}ZTP Result:{RST}")
    print(f"    {G}Online:  {s['online']}{RST}")
    failed_final = sum(1 for d in all_devices if d.ztp_state == ZTPState.FAILED)
    print(f"    {R if failed_final else G}Failed:  {failed_final}{RST}")


# ── Monitoring Demo ───────────────────────────────────────────────────────────

def run_monitoring_demo(topology: LabTopology) -> None:
    _banner("MONITORING DEMO — Continuous health polling for all devices")

    sim = DeviceSimulator()
    mon = MonitoringEngine(sim)
    all_devices = topology.all_devices()

    # ---- Round 1: clean baseline ----
    print(f"\n  {B}Round 1 — Baseline poll (all devices healthy){RST}")
    mon.poll_all(all_devices)
    _print_health_table(mon)

    # ---- Round 2: inject failures ----
    print(f"\n  {B}Round 2 — Simulated degraded conditions{RST}")
    print(
        f"  {Y}Injecting failures:{RST} "
        f"router interface down, LB VIP red, GPU-FW RDMA loss\n"
    )
    # Give the router an interface so the failure shows up
    from lab_demo.devices import DeviceInterface
    topology.routers[0].interfaces = [DeviceInterface(name="GigabitEthernet2")]

    mon.poll_all(
        all_devices,
        fail_devices={
            topology.routers[0].name: ["interfaces_up"],
            topology.load_balancers[0].name: ["virtual_servers"],
            topology.gpu_firewalls[0].name: ["rdma_policy"],
        },
    )
    _print_health_table(mon)

    s = mon.summary()
    print(f"\n  {B}Monitoring Summary:{RST}")
    print(f"    {G}Healthy:  {s['healthy']}/{s['total']}{RST}")
    print(f"    {Y}Degraded: {s['degraded']}/{s['total']}{RST}")
    print(f"    {R}Down:     {s['down']}/{s['total']}{RST}")
    if s["alerts"]:
        print(f"\n  {B}Active Alerts ({len(s['alerts'])}):{RST}")
        for a in s["alerts"]:
            print(f"    {R}!{RST} [{a['device']}]  {a['alert']}")

    # ---- Round 3: recovery ----
    print(f"\n  {B}Round 3 — Recovery (faults cleared){RST}")
    topology.routers[0].interfaces = []  # reset
    mon.poll_all(all_devices)
    s3 = mon.summary()
    print(f"    {G}All {s3['healthy']} devices healthy after recovery{RST}")


def _print_health_table(mon: MonitoringEngine) -> None:
    print(f"\n  {'Device':<24} {'Role':<18} {'Status':<12} {'CPU%':<7} {'Alerts'}")
    print(f"  {DIM}{'-' * 78}{RST}")
    for name, h in sorted(mon.health.items()):
        c = _health_color(h.status)
        alerts_str = "; ".join(h.alerts[:2])
        if len(h.alerts) > 2:
            alerts_str += f" (+{len(h.alerts)-2} more)"
        print(
            f"  {name:<24} {h.role.value:<18} "
            f"{c}{h.status.value:<12}{RST} {h.metrics.get('cpu', '?'):<7} "
            f"{DIM}{alerts_str}{RST}"
        )


# ── Pre/Post Checks Demo ──────────────────────────────────────────────────────

def run_checks_demo(topology: LabTopology) -> None:
    _banner("PRE/POST CHECK DEMO — Dual validation for all device types")

    sim = DeviceSimulator()
    checkable = [d for d in topology.all_devices() if d.role in _CHECKER_MAP]

    for phase in ("PRE", "POST"):
        print(f"\n  {B}{'─' * 30} {phase}-DEPLOY CHECKS {'─' * 30}{RST}")
        total_pass = total_fail = total_warn = 0

        for device in checkable:
            checker_cls = _CHECKER_MAP[device.role]
            checker = checker_cls(device, sim)
            results = checker.pre_checks() if phase == "PRE" else checker.post_checks()

            for r in results:
                if r.status == CheckStatus.PASS:
                    total_pass += 1
                elif r.status == CheckStatus.FAIL:
                    total_fail += 1
                elif r.status == CheckStatus.WARN:
                    total_warn += 1

                icon = _ok(r.status == CheckStatus.PASS)
                status_c = (
                    G if r.status == CheckStatus.PASS
                    else Y if r.status == CheckStatus.WARN
                    else R
                )
                print(
                    f"  {icon} [{device.name:<22}] {r.name:<32} "
                    f"{status_c}{r.message}{RST}"
                )

        print(
            f"\n  {B}{phase}-CHECK TOTAL:{RST}  "
            f"{G}{total_pass} PASS{RST}  "
            f"{Y}{total_warn} WARN{RST}  "
            f"{R}{total_fail} FAIL{RST}"
        )

    # --- Fault injection demo ---
    print(f"\n  {B}── Fault Injection: Simulating post-deploy failures ──{RST}\n")
    fail_scenarios = [
        (topology.routers[0], RouterChecker, ["bgp_sessions"], "BGP peer not Established"),
        (topology.load_balancers[0], LoadBalancerChecker, ["virtual_servers"], "VIP red"),
        (topology.gpu_firewalls[0], FirewallChecker, ["rdma_policy"], "RDMA sessions lost"),
    ]
    for device, cls, fail_checks, scenario_label in fail_scenarios:
        checker = cls(device, sim)
        results = checker.post_checks(fail_checks=fail_checks)
        for r in results:
            if r.status == CheckStatus.FAIL:
                print(
                    f"  {R}✘{RST} [{device.name}] {r.name}: {r.message}"
                )
                if r.remediation:
                    print(f"      {DIM}→ Remediation: {r.remediation}{RST}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Network Automation — Full Lab Demo"
    )
    parser.add_argument(
        "--topology",
        default=str(DEFAULT_TOPOLOGY),
        help="Path to topology YAML (default: lab_topologies/demo_full_datacenter.yaml)",
    )
    parser.add_argument(
        "--scenario",
        choices=["all", "ztp", "monitor", "checks"],
        default="all",
        help="Demo scenario to run (default: all)",
    )
    args = parser.parse_args()

    topology = LabTopology.from_yaml(args.topology)
    s = topology.summary()

    print(f"\n{B}{'═' * 66}{RST}")
    print(f"{B}  Network Automation Lab Demo{RST}")
    print(f"{B}{'═' * 66}{RST}")
    print(f"  Lab:      {C}{topology.name}{RST}")
    print(f"  Devices:  {s['total']} total")
    print(
        f"            {s['routers']} routers  ·  {s['switches']} switches  ·  "
        f"{s['firewalls']} firewalls  ·  {s['load_balancers']} LBs  ·  "
        f"{s['gpu_firewalls']} GPU FWs  ·  {s['gpu_servers']} GPU servers"
    )

    runners = {
        "ztp": run_ztp_demo,
        "monitor": run_monitoring_demo,
        "checks": run_checks_demo,
    }

    if args.scenario == "all":
        for fn in runners.values():
            fn(topology)
    else:
        runners[args.scenario](topology)

    print(f"\n{B}{G}Demo complete.{RST}\n")


if __name__ == "__main__":
    main()
