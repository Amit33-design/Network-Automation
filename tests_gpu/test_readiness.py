"""Tests for DCReadiness orchestrator and reporter."""
import json
import pytest
from gpu_cluster_net.models import Fabric
from gpu_cluster_net.readiness import DCReadiness
from gpu_cluster_net import reporter


@pytest.fixture
def fabric():
    return Fabric.from_yaml("/home/user/Network-Automation/topology.example.yaml")


@pytest.fixture
def dr(fabric):
    return DCReadiness(fabric)


def test_pre_run_mock_all_pass(dr):
    report = dr.run_pre(mock=True)
    assert report.is_ready
    assert report.verdict in ("READY", "READY_WITH_WARNINGS")
    assert report.total_failed == 0
    assert len(report.suites) == 6  # 2 spines + 4 leaves


def test_post_run_mock_all_pass(dr):
    report = dr.run_post(mock=True)
    assert report.is_ready
    assert report.total_failed == 0


def test_pre_run_with_failures(dr):
    report = dr.run_pre(mock=True, fail_checks=["mtu_check", "ntp_sync"])
    assert not report.is_ready
    assert report.total_failed > 0
    all_failed = [r.name for s in report.suites for r in s.results if r.failed]
    assert "mtu_check" in all_failed
    assert "ntp_sync" in all_failed


def test_post_run_with_failures(dr):
    report = dr.run_post(mock=True, fail_checks=["bgp_evpn_sessions", "vxlan_vni_state"])
    assert not report.is_ready
    all_failed = [r.name for s in report.suites for r in s.results if r.failed]
    assert "bgp_evpn_sessions" in all_failed


def test_filter_devices(dr, fabric):
    report = dr.run_pre(mock=True, devices=["spine1", "leaf1"])
    assert len(report.suites) == 2
    names = {s.device for s in report.suites}
    assert names == {"spine1", "leaf1"}


def test_to_json_valid(dr):
    report = dr.run_pre(mock=True)
    raw = reporter.to_json(report)
    data = json.loads(raw)
    assert data["fabric"] == "gpu-cluster-dc1"
    assert data["phase"] == "pre"
    assert "verdict" in data
    assert len(data["devices"]) == 6


def test_to_text_contains_verdict(dr):
    report = dr.run_pre(mock=True)
    text = reporter.to_text(report)
    assert "READY" in text
    assert "gpu-cluster-dc1" in text.upper() or "GPU-CLUSTER-DC1" in text


def test_to_html_valid(dr):
    report = dr.run_post(mock=True)
    html = reporter.to_html(report)
    assert "<html" in html
    assert "READY" in html
    assert "gpu-cluster-dc1" in html


def test_save_json(dr, tmp_path):
    report = dr.run_pre(mock=True)
    path = str(tmp_path / "report.json")
    reporter.save(report, path, fmt="json")
    with open(path) as f:
        data = json.loads(f.read())
    assert data["fabric"] == "gpu-cluster-dc1"


def test_save_html(dr, tmp_path):
    report = dr.run_post(mock=True)
    path = str(tmp_path / "report.html")
    reporter.save(report, path, fmt="html")
    content = open(path).read()
    assert "<html" in content


def test_verdict_not_ready(dr):
    report = dr.run_post(mock=True, fail_checks=["bgp_evpn_sessions"])
    assert report.verdict == "NOT_READY"
    assert not report.is_ready
