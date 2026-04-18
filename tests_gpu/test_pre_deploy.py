"""Tests for pre-deployment checks."""
import pytest
from gpu_cluster_net.checks.pre_deploy import PreDeployChecker
from gpu_cluster_net.checks.base import CheckStatus
from gpu_cluster_net.models import Fabric


@pytest.fixture
def checker():
    return PreDeployChecker(device_name="leaf1")


@pytest.fixture
def fabric():
    return Fabric.from_yaml("/home/user/Network-Automation/topology.example.yaml")


def test_interfaces_up_pass(checker):
    iface_data = {
        "Ethernet1/1": {"admin_state": "up", "oper_state": "up", "mtu": 9216},
        "Ethernet1/2": {"admin_state": "up", "oper_state": "up", "mtu": 9216},
    }
    result = checker.check_interfaces_up(["Ethernet1/1", "Ethernet1/2"], iface_data)
    assert result.status == CheckStatus.PASS


def test_interfaces_up_fail(checker):
    iface_data = {
        "Ethernet1/1": {"admin_state": "up", "oper_state": "down", "mtu": 9216},
        "Ethernet1/2": {"admin_state": "up", "oper_state": "up", "mtu": 9216},
    }
    result = checker.check_interfaces_up(["Ethernet1/1", "Ethernet1/2"], iface_data)
    assert result.status == CheckStatus.FAIL
    assert "Ethernet1/1" in result.message


def test_mtu_pass(checker):
    iface_data = {
        "Ethernet1/1": {"admin_state": "up", "oper_state": "up", "mtu": 9216},
    }
    result = checker.check_mtu(["Ethernet1/1"], iface_data, required_mtu=9216)
    assert result.status == CheckStatus.PASS


def test_mtu_fail(checker):
    iface_data = {
        "Ethernet1/1": {"admin_state": "up", "oper_state": "up", "mtu": 1500},
    }
    result = checker.check_mtu(["Ethernet1/1"], iface_data, required_mtu=9216)
    assert result.status == CheckStatus.FAIL
    assert result.remediation != ""


def test_stp_pass(checker):
    stp_data = {
        "Ethernet1/10": {"port_type": "edge", "bpdu_guard": "enabled", "state": "forwarding"},
    }
    result = checker.check_spanning_tree_disabled(["Ethernet1/10"], stp_data)
    assert result.status == CheckStatus.PASS


def test_stp_fail_not_edge(checker):
    stp_data = {
        "Ethernet1/10": {"port_type": "normal", "bpdu_guard": "disabled", "state": "forwarding"},
    }
    result = checker.check_spanning_tree_disabled(["Ethernet1/10"], stp_data)
    assert result.status == CheckStatus.FAIL


def test_stp_fail_blocking(checker):
    stp_data = {
        "Ethernet1/10": {"port_type": "edge", "bpdu_guard": "enabled", "state": "blocking"},
    }
    result = checker.check_spanning_tree_disabled(["Ethernet1/10"], stp_data)
    assert result.status == CheckStatus.FAIL


def test_ntp_pass(checker):
    result = checker.check_ntp_sync({"synced": True, "stratum": 2, "reference": "169.254.169.254"})
    assert result.status == CheckStatus.PASS


def test_ntp_fail(checker):
    result = checker.check_ntp_sync({"synced": False, "stratum": 16, "reference": ""})
    assert result.status == CheckStatus.FAIL


def test_lldp_pass(checker):
    expected = {"Ethernet1/1": "spine1"}
    actual = {"Ethernet1/1": "spine1.dc1.local"}
    result = checker.check_lldp_neighbors(expected, actual)
    assert result.status == CheckStatus.PASS


def test_lldp_fail_wrong_peer(checker):
    expected = {"Ethernet1/1": "spine1"}
    actual = {"Ethernet1/1": "spine99"}
    result = checker.check_lldp_neighbors(expected, actual)
    assert result.status == CheckStatus.FAIL


def test_lldp_fail_missing(checker):
    expected = {"Ethernet1/1": "spine1"}
    actual = {}
    result = checker.check_lldp_neighbors(expected, actual)
    assert result.status == CheckStatus.FAIL


def test_hardware_buffers_pass(checker):
    result = checker.check_hardware_buffers({"lossless_buffer_kb": 16384})
    assert result.status == CheckStatus.PASS


def test_hardware_buffers_fail(checker):
    result = checker.check_hardware_buffers({"lossless_buffer_kb": 512})
    assert result.status == CheckStatus.FAIL


def test_run_all_mock(fabric):
    from gpu_cluster_net.collector.mock_collector import MockCollector
    leaf = fabric.leaves[0]
    checker = PreDeployChecker(device_name=leaf.name)
    collector = MockCollector()
    collected = collector.collect_all_pre(leaf, fabric)
    suite = checker.run_all(fabric, leaf, collected)
    assert suite.is_ready
    assert suite.passed > 0
    assert suite.failed == 0


def test_run_all_mock_with_failure(fabric):
    from gpu_cluster_net.collector.mock_collector import MockCollector
    leaf = fabric.leaves[0]
    checker = PreDeployChecker(device_name=leaf.name)
    collector = MockCollector(fail_checks=["mtu_check", "ntp_sync"])
    collected = collector.collect_all_pre(leaf, fabric)
    suite = checker.run_all(fabric, leaf, collected)
    assert not suite.is_ready
    failed_names = [r.name for r in suite.results if r.failed]
    assert "mtu_check" in failed_names
    assert "ntp_sync" in failed_names
