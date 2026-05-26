"""End-to-end integration tests across the full lab topology.

These tests verify that ZTP → monitoring → pre-checks → post-checks all
work together for every device type loaded from the demo topology YAML.
"""
from pathlib import Path

import pytest

from gpu_cluster_net.checks.base import CheckStatus

from lab_demo.checks import (
    FirewallChecker,
    LoadBalancerChecker,
    RouterChecker,
    SwitchChecker,
)
from lab_demo.devices import DeviceInterface, DeviceRole, ZTPState
from lab_demo.monitoring import HealthStatus, MonitoringEngine
from lab_demo.simulator import DeviceSimulator
from lab_demo.topology import LabTopology
from lab_demo.ztp import ZTPEngine

YAML = Path(__file__).parent.parent / "lab_topologies" / "demo_full_datacenter.yaml"

_CHECKER_MAP = {
    DeviceRole.ROUTER: RouterChecker,
    DeviceRole.SWITCH: SwitchChecker,
    DeviceRole.FIREWALL: FirewallChecker,
    DeviceRole.GPU_FIREWALL: FirewallChecker,
    DeviceRole.LOAD_BALANCER: LoadBalancerChecker,
}


@pytest.fixture(scope="module")
def topo():
    return LabTopology.from_yaml(YAML)


# ── ZTP ───────────────────────────────────────────────────────────────────────

def test_e2e_ztp_all_devices_online(topo):
    """Every device in the lab can be provisioned to ONLINE via ZTP."""
    engine = ZTPEngine()
    results = engine.provision_topology(topo.all_devices())
    failed = [name for name, ok in results.items() if not ok]
    assert failed == [], f"Devices failed ZTP: {failed}"


def test_e2e_ztp_all_devices_have_online_state(topo):
    ZTPEngine().provision_topology(topo.all_devices())
    for device in topo.all_devices():
        assert device.ztp_state == ZTPState.ONLINE, (
            f"{device.name} stuck in state {device.ztp_state}"
        )


def test_e2e_ztp_failure_only_affects_target(topo):
    """Injecting a failure on one device does not affect its peers."""
    # Reset states
    for d in topo.all_devices():
        d.ztp_state = ZTPState.UNPROVISIONED

    target = topo.routers[0].name
    results = ZTPEngine().provision_topology(
        topo.all_devices(),
        fail_devices={target: ZTPState.CONFIG_APPLIED},
    )
    assert results[target] is False
    succeeded = [k for k, v in results.items() if v]
    assert len(succeeded) == len(topo.all_devices()) - 1


def test_e2e_ztp_summary_matches_topology(topo):
    for d in topo.all_devices():
        d.ztp_state = ZTPState.UNPROVISIONED
    engine = ZTPEngine()
    engine.provision_topology(topo.all_devices())
    s = engine.summary()
    assert s["online"] == len(topo.all_devices())
    assert s["failed"] == 0


# ── Monitoring ────────────────────────────────────────────────────────────────

def test_e2e_monitoring_all_healthy(topo):
    """After ZTP, all devices poll as HEALTHY."""
    ZTPEngine().provision_topology(topo.all_devices())
    mon = MonitoringEngine()
    mon.poll_all(topo.all_devices())
    s = mon.summary()
    assert s["down"] == 0
    assert s["degraded"] == 0
    assert s["healthy"] == len(topo.all_devices())


def test_e2e_monitoring_detects_router_failure(topo):
    rtr = topo.routers[0]
    rtr.interfaces = [DeviceInterface(name="Gi1")]  # give it an interface to check
    mon = MonitoringEngine()
    mon.poll_all(
        topo.all_devices(),
        fail_devices={rtr.name: ["interfaces_up"]},
    )
    s = mon.summary()
    assert s["degraded"] >= 1


def test_e2e_monitoring_detects_lb_failure(topo):
    lb = topo.load_balancers[0]
    mon = MonitoringEngine()
    mon.poll_all(topo.all_devices(), fail_devices={lb.name: ["virtual_servers"]})
    assert mon.health[lb.name].status == HealthStatus.DEGRADED


def test_e2e_monitoring_detects_gpu_fw_rdma_failure(topo):
    gfw = topo.gpu_firewalls[0]
    mon = MonitoringEngine()
    mon.poll_all(topo.all_devices(), fail_devices={gfw.name: ["rdma_policy"]})
    assert mon.health[gfw.name].status == HealthStatus.DEGRADED


# ── Pre-checks ────────────────────────────────────────────────────────────────

def test_e2e_pre_checks_all_pass(topo):
    """Pre-deploy checks pass for every checkable device in the lab topology."""
    sim = DeviceSimulator()
    failures = []
    for device in topo.all_devices():
        if device.role not in _CHECKER_MAP:
            continue
        checker = _CHECKER_MAP[device.role](device, sim)
        for r in checker.pre_checks():
            if r.status == CheckStatus.FAIL:
                failures.append((device.name, r.name, r.message))
    assert failures == [], f"Pre-check failures:\n" + "\n".join(
        f"  [{d}] {n}: {m}" for d, n, m in failures
    )


def test_e2e_pre_checks_fail_injection(topo):
    """Injecting a failure into one device's pre-check surfaces as FAIL."""
    sim = DeviceSimulator()
    rtr = topo.routers[0]
    rtr.interfaces = [DeviceInterface(name="Gi1")]
    checker = RouterChecker(rtr, sim)
    results = checker.pre_checks(fail_checks=["interfaces_up"])
    assert any(r.status == CheckStatus.FAIL for r in results)


# ── Post-checks ───────────────────────────────────────────────────────────────

def test_e2e_post_checks_all_pass(topo):
    """Post-deploy checks pass for every checkable device in the lab topology."""
    sim = DeviceSimulator()
    failures = []
    for device in topo.all_devices():
        if device.role not in _CHECKER_MAP:
            continue
        checker = _CHECKER_MAP[device.role](device, sim)
        for r in checker.post_checks():
            if r.status == CheckStatus.FAIL:
                failures.append((device.name, r.name, r.message))
    assert failures == [], f"Post-check failures:\n" + "\n".join(
        f"  [{d}] {n}: {m}" for d, n, m in failures
    )


def test_e2e_post_checks_fail_injection_lb(topo):
    sim = DeviceSimulator()
    lb = topo.load_balancers[0]
    results = LoadBalancerChecker(lb, sim).post_checks(fail_checks=["virtual_servers"])
    assert any(r.status == CheckStatus.FAIL for r in results)


def test_e2e_post_checks_fail_injection_gpu_fw(topo):
    sim = DeviceSimulator()
    gfw = topo.gpu_firewalls[0]
    results = FirewallChecker(gfw, sim).post_checks(fail_checks=["rdma_policy"])
    rdma_r = next(r for r in results if r.name == "rdma_sessions")
    assert rdma_r.status == CheckStatus.FAIL


# ── Coverage across all device types ─────────────────────────────────────────

def test_e2e_all_roles_have_checkers(topo):
    """Verify every checkable role in the topology has a registered checker."""
    missing = []
    for device in topo.all_devices():
        if device.role not in _CHECKER_MAP and device.role not in (
            DeviceRole.GPU_SERVER,  # checked via monitoring (RDMA, GPU state)
        ):
            missing.append((device.name, device.role))
    assert missing == [], f"Devices without checkers: {missing}"
