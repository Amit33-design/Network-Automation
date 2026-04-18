"""Tests for post-deployment checks."""
from pathlib import Path
import pytest
from gpu_cluster_net.checks.post_deploy import PostDeployChecker
from gpu_cluster_net.checks.base import CheckStatus
from gpu_cluster_net.models import Fabric

TOPOLOGY = Path(__file__).parent.parent / "topology.example.yaml"


@pytest.fixture
def checker():
    return PostDeployChecker(device_name="leaf1")


@pytest.fixture
def fabric():
    return Fabric.from_yaml(str(TOPOLOGY))


def test_bgp_evpn_sessions_pass(checker):
    bgp = {"10.0.0.1": {"state": "Established"}, "10.0.0.2": {"state": "Established"}}
    result = checker.check_bgp_evpn_sessions(["10.0.0.1", "10.0.0.2"], bgp)
    assert result.status == CheckStatus.PASS


def test_bgp_evpn_sessions_fail(checker):
    bgp = {"10.0.0.1": {"state": "Idle"}, "10.0.0.2": {"state": "Established"}}
    result = checker.check_bgp_evpn_sessions(["10.0.0.1", "10.0.0.2"], bgp)
    assert result.status == CheckStatus.FAIL
    assert "10.0.0.1" in result.message


def test_evpn_type2_pass(checker):
    result = checker.check_evpn_type2_routes({"type2_routes": 10})
    assert result.status == CheckStatus.PASS


def test_evpn_type2_fail(checker):
    result = checker.check_evpn_type2_routes({"type2_routes": 0})
    assert result.status == CheckStatus.FAIL


def test_evpn_type5_pass(checker):
    result = checker.check_evpn_type5_routes({"type5_routes": 4, "type5_prefixes": ["10.100.0.0/24"]})
    assert result.status == CheckStatus.PASS


def test_evpn_type5_fail_no_routes(checker):
    result = checker.check_evpn_type5_routes({"type5_routes": 0, "type5_prefixes": []})
    assert result.status == CheckStatus.FAIL


def test_vxlan_vni_pass(checker):
    vni = {"10100": {"state": "up"}, "10200": {"state": "up"}}
    result = checker.check_vxlan_vni_state(vni, 10100, 10200)
    assert result.status == CheckStatus.PASS


def test_vxlan_vni_fail_down(checker):
    vni = {"10100": {"state": "down"}, "10200": {"state": "up"}}
    result = checker.check_vxlan_vni_state(vni, 10100, 10200)
    assert result.status == CheckStatus.FAIL


def test_vxlan_vni_fail_missing(checker):
    vni = {"10200": {"state": "up"}}
    result = checker.check_vxlan_vni_state(vni, 10100, 10200)
    assert result.status == CheckStatus.FAIL


def test_vtep_peers_pass(checker):
    result = checker.check_vtep_peers(["10.1.0.12", "10.1.0.13"], ["10.1.0.12", "10.1.0.13"])
    assert result.status == CheckStatus.PASS


def test_vtep_peers_fail_missing(checker):
    result = checker.check_vtep_peers(["10.1.0.12"], ["10.1.0.12", "10.1.0.13"])
    assert result.status == CheckStatus.FAIL
    assert "10.1.0.13" in result.message


def test_pfc_operational_pass(checker):
    pfc = {"Ethernet1/10": {"enabled_priorities": [3]}}
    result = checker.check_pfc_operational(pfc, expected_priority=3)
    assert result.status == CheckStatus.PASS


def test_pfc_operational_fail(checker):
    pfc = {"Ethernet1/10": {"enabled_priorities": []}}
    result = checker.check_pfc_operational(pfc, expected_priority=3)
    assert result.status == CheckStatus.FAIL


def test_ecn_thresholds_pass(checker):
    ecn = {"Ethernet1/10": {"ecn_min_bytes": 150000, "ecn_max_bytes": 1500000}}
    result = checker.check_ecn_thresholds(ecn, 150000, 1500000)
    assert result.status == CheckStatus.PASS


def test_ecn_thresholds_fail(checker):
    ecn = {"Ethernet1/10": {"ecn_min_bytes": 0, "ecn_max_bytes": 0}}
    result = checker.check_ecn_thresholds(ecn, 150000, 1500000)
    assert result.status == CheckStatus.FAIL


def test_pfc_watchdog_pass(checker):
    result = checker.check_pfc_watchdog({"enabled": True, "action": "drop"})
    assert result.status == CheckStatus.PASS


def test_pfc_watchdog_fail(checker):
    result = checker.check_pfc_watchdog({"enabled": False, "action": ""})
    assert result.status == CheckStatus.FAIL


def test_rdma_mtu_path_pass(checker):
    ping = {"10.1.0.12": {"success": True, "mtu_reached": 9000}}
    result = checker.check_rdma_mtu_path(ping, required_mtu=9000)
    assert result.status == CheckStatus.PASS


def test_rdma_mtu_path_fail(checker):
    ping = {"10.1.0.12": {"success": False, "mtu_reached": 1500}}
    result = checker.check_rdma_mtu_path(ping, required_mtu=9000)
    assert result.status == CheckStatus.FAIL


def test_run_all_mock_pass(fabric):
    from gpu_cluster_net.collector.mock_collector import MockCollector
    leaf = fabric.leaves[0]
    checker = PostDeployChecker(device_name=leaf.name)
    collector = MockCollector()
    collected = collector.collect_all_post(leaf, fabric, is_spine=False)
    suite = checker.run_all(fabric, leaf, collected, is_spine=False)
    assert suite.is_ready
    assert suite.failed == 0


def test_run_all_mock_failures(fabric):
    from gpu_cluster_net.collector.mock_collector import MockCollector
    leaf = fabric.leaves[0]
    checker = PostDeployChecker(device_name=leaf.name)
    collector = MockCollector(fail_checks=["bgp_evpn_sessions", "pfc_operational"])
    collected = collector.collect_all_post(leaf, fabric, is_spine=False)
    suite = checker.run_all(fabric, leaf, collected, is_spine=False)
    assert not suite.is_ready
    failed_names = [r.name for r in suite.results if r.failed]
    assert "bgp_evpn_sessions" in failed_names
    assert "pfc_operational" in failed_names
