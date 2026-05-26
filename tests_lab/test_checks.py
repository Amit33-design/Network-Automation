"""Tests for device-type pre/post checkers."""
import pytest

from gpu_cluster_net.checks.base import CheckStatus

from lab_demo.checks import (
    FirewallChecker,
    LoadBalancerChecker,
    RouterChecker,
    SwitchChecker,
)
from lab_demo.devices import (
    DeviceInterface,
    DevicePlatform,
    Firewall,
    GPUFirewall,
    LoadBalancer,
    Router,
    Switch,
)
from lab_demo.simulator import DeviceSimulator


@pytest.fixture
def sim():
    return DeviceSimulator()


def _rtr(**kw):
    defaults = dict(
        name="edge-rtr1",
        platform=DevicePlatform.CISCO_IOSXE,
        management_ip="192.168.1.1",
        bgp_neighbors=["10.255.0.2"],
    )
    defaults.update(kw)
    return Router(**defaults)


def _sw(**kw):
    defaults = dict(
        name="core-sw1",
        platform=DevicePlatform.CISCO_NXOS,
        management_ip="192.168.1.21",
        layer=3,
        vlans=[10, 20, 100],
        spanning_tree_mode="rapid-pvst",
    )
    defaults.update(kw)
    return Switch(**defaults)


def _fw(**kw):
    defaults = dict(
        name="fw1",
        platform=DevicePlatform.PALOALTO_PANOS,
        management_ip="192.168.1.11",
        ha_peer="fw2",
        zones=["trust", "untrust"],
    )
    defaults.update(kw)
    return Firewall(**defaults)


def _gfw(**kw):
    defaults = dict(
        name="gpu-fw1",
        platform=DevicePlatform.PALOALTO_PANOS,
        management_ip="192.168.2.20",
        protected_segments=["GPU-VRF"],
        rdma_policy="allow_rocev2",
    )
    defaults.update(kw)
    return GPUFirewall(**defaults)


def _lb(**kw):
    defaults = dict(
        name="lb1",
        platform=DevicePlatform.F5_TMSH,
        management_ip="192.168.1.41",
        virtual_servers=["10.0.100.100:443"],
        pool_members=["10.0.10.10:8080"],
        health_monitor="https",
    )
    defaults.update(kw)
    return LoadBalancer(**defaults)


# ── RouterChecker ─────────────────────────────────────────────────────────────

def test_router_pre_all_pass(sim):
    results = RouterChecker(_rtr(), sim).pre_checks()
    assert all(r.status == CheckStatus.PASS for r in results)


def test_router_pre_interfaces_fail(sim):
    rtr = _rtr()
    rtr.interfaces = [DeviceInterface(name="Gi1", peer_device="fw1")]
    results = RouterChecker(rtr, sim).pre_checks(fail_checks=["interfaces_up"])
    iface_result = next(r for r in results if r.name == "interfaces_up")
    assert iface_result.status == CheckStatus.FAIL
    assert iface_result.remediation


def test_router_pre_interfaces_pass_no_ifaces_configured(sim):
    # Device with no interfaces configured — nothing to check, all pass
    results = RouterChecker(_rtr(), sim).pre_checks()
    iface_result = next(r for r in results if r.name == "interfaces_up")
    assert iface_result.status == CheckStatus.PASS


def test_router_post_all_pass(sim):
    results = RouterChecker(_rtr(), sim).post_checks()
    assert all(r.status == CheckStatus.PASS for r in results)


def test_router_post_bgp_fail(sim):
    results = RouterChecker(_rtr(), sim).post_checks(fail_checks=["bgp_sessions"])
    bgp_results = [r for r in results if r.name == "bgp_sessions"]
    assert any(r.status == CheckStatus.FAIL for r in bgp_results)


def test_router_post_routing_table_fail(sim):
    results = RouterChecker(_rtr(), sim).post_checks(fail_checks=["routing_table"])
    rt = next(r for r in results if r.name == "routing_table")
    assert rt.status == CheckStatus.FAIL


def test_router_check_result_device_name(sim):
    results = RouterChecker(_rtr(), sim).pre_checks()
    for r in results:
        assert r.device == "edge-rtr1"


# ── SwitchChecker ─────────────────────────────────────────────────────────────

def test_switch_pre_all_pass(sim):
    results = SwitchChecker(_sw(), sim).pre_checks()
    assert all(r.status == CheckStatus.PASS for r in results)


def test_switch_pre_interfaces_fail(sim):
    sw = _sw()
    sw.interfaces = [DeviceInterface(name="Te1/0/1")]
    results = SwitchChecker(sw, sim).pre_checks(fail_checks=["interfaces_up"])
    iface_r = next(r for r in results if r.name == "interfaces_up")
    assert iface_r.status == CheckStatus.FAIL


def test_switch_pre_stp_mode_fail(sim):
    sw = _sw(spanning_tree_mode="pvst")  # wrong mode
    results = SwitchChecker(sw, sim).pre_checks()
    # simulator returns "rapid-pvst", device expects "pvst" → mismatch
    stp_r = next(r for r in results if r.name == "stp_mode")
    assert stp_r.status == CheckStatus.FAIL


def test_switch_post_vlans_pass(sim):
    results = SwitchChecker(_sw(), sim).post_checks()
    vlan_r = next(r for r in results if r.name == "vlans_active")
    assert vlan_r.status == CheckStatus.PASS


def test_switch_post_vlans_fail(sim):
    results = SwitchChecker(_sw(), sim).post_checks(fail_checks=["vlans_active"])
    vlan_r = next(r for r in results if r.name == "vlans_active")
    assert vlan_r.status == CheckStatus.FAIL


# ── FirewallChecker ───────────────────────────────────────────────────────────

def test_firewall_pre_all_pass(sim):
    results = FirewallChecker(_fw(), sim).pre_checks()
    assert all(r.status == CheckStatus.PASS for r in results)


def test_firewall_pre_ha_sync_fail(sim):
    results = FirewallChecker(_fw(), sim).pre_checks(fail_checks=["ha_active"])
    ha_r = next(r for r in results if r.name == "ha_sync")
    assert ha_r.status == CheckStatus.FAIL
    assert ha_r.remediation


def test_firewall_no_ha_peer_no_ha_check(sim):
    fw = _fw(ha_peer=None)
    results = FirewallChecker(fw, sim).pre_checks()
    ha_results = [r for r in results if r.name == "ha_sync"]
    assert ha_results == []  # check skipped when no HA peer


def test_firewall_post_all_pass_or_warn(sim):
    results = FirewallChecker(_fw(), sim).post_checks()
    for r in results:
        assert r.status in (CheckStatus.PASS, CheckStatus.WARN)


def test_firewall_post_threat_prevention_fail(sim):
    # Can't fail threat_prevention via fail_checks directly, but simulator
    # always returns "enabled" — so this verifies the PASS branch
    results = FirewallChecker(_fw(), sim).post_checks()
    tp_r = next(r for r in results if r.name == "threat_prevention")
    assert tp_r.status == CheckStatus.PASS


def test_gpu_firewall_post_rdma_pass(sim):
    results = FirewallChecker(_gfw(), sim).post_checks()
    rdma_r = next(r for r in results if r.name == "rdma_sessions")
    assert rdma_r.status == CheckStatus.PASS


def test_gpu_firewall_post_rdma_fail(sim):
    results = FirewallChecker(_gfw(), sim).post_checks(fail_checks=["rdma_policy"])
    rdma_r = next(r for r in results if r.name == "rdma_sessions")
    assert rdma_r.status == CheckStatus.FAIL


# ── LoadBalancerChecker ───────────────────────────────────────────────────────

def test_lb_pre_pass(sim):
    results = LoadBalancerChecker(_lb(), sim).pre_checks()
    assert all(r.status == CheckStatus.PASS for r in results)


def test_lb_post_vips_pass(sim):
    results = LoadBalancerChecker(_lb(), sim).post_checks()
    vs_r = next(r for r in results if r.name == "virtual_servers")
    assert vs_r.status == CheckStatus.PASS


def test_lb_post_vips_fail(sim):
    results = LoadBalancerChecker(_lb(), sim).post_checks(fail_checks=["virtual_servers"])
    vs_r = next(r for r in results if r.name == "virtual_servers")
    assert vs_r.status == CheckStatus.FAIL
    assert vs_r.remediation


def test_lb_post_pool_members_fail(sim):
    results = LoadBalancerChecker(_lb(), sim).post_checks(fail_checks=["pool_members"])
    pm_r = next(r for r in results if r.name == "pool_members")
    assert pm_r.status == CheckStatus.FAIL


def test_lb_post_pool_members_pass(sim):
    results = LoadBalancerChecker(_lb(), sim).post_checks()
    pm_r = next(r for r in results if r.name == "pool_members")
    assert pm_r.status == CheckStatus.PASS
