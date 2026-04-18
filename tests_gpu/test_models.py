"""Tests for Fabric topology models."""
from pathlib import Path
import pytest
from gpu_cluster_net.models import Fabric, Spine, Leaf, RoCEv2Config, VXLANConfig

TOPOLOGY = Path(__file__).parent.parent / "topology.example.yaml"


def _make_fabric() -> Fabric:
    return Fabric.from_yaml(str(TOPOLOGY))


def test_fabric_loads():
    fabric = _make_fabric()
    assert fabric.name == "gpu-cluster-dc1"
    assert len(fabric.spines) == 2
    assert len(fabric.leaves) == 4


def test_spine_properties():
    fabric = _make_fabric()
    spine = fabric.spines[0]
    assert spine.name == "spine1"
    assert spine.loopback_ip() == "10.0.0.1"
    assert spine.asn == 65000


def test_leaf_properties():
    fabric = _make_fabric()
    leaf = fabric.leaves[0]
    assert leaf.name == "leaf1"
    assert leaf.loopback_ip() == "10.0.0.11"
    assert leaf.vtep_ip() == "10.1.0.11"
    assert len(leaf.gpu_interfaces) == 4
    assert len(leaf.uplink_interfaces) == 2


def test_rocev2_defaults():
    r = RoCEv2Config()
    assert r.pfc_priority == 3
    assert r.mtu == 9216
    assert r.pfc_watchdog_enabled is True


def test_vxlan_defaults():
    v = VXLANConfig()
    assert v.l2_vni == 10100
    assert v.l3_vni == 10200
    assert v.vrf_name == "GPU-VRF"


def test_all_devices():
    fabric = _make_fabric()
    devs = fabric.all_devices()
    assert len(devs) == 6  # 2 spines + 4 leaves


def test_spine_loopbacks():
    fabric = _make_fabric()
    lbs = fabric.spine_loopbacks()
    assert "10.0.0.1" in lbs
    assert "10.0.0.2" in lbs
