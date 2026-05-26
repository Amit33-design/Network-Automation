"""Tests for LabTopology YAML loading and accessors."""
from pathlib import Path

import pytest

from lab_demo.devices import DeviceRole, ZTPState
from lab_demo.topology import LabTopology

YAML = Path(__file__).parent.parent / "lab_topologies" / "demo_full_datacenter.yaml"


@pytest.fixture(scope="module")
def topo():
    return LabTopology.from_yaml(YAML)


def test_lab_name(topo):
    assert topo.name == "demo-datacenter-lab"


def test_routers_loaded(topo):
    assert len(topo.routers) == 2
    names = {r.name for r in topo.routers}
    assert "edge-rtr1" in names
    assert "edge-rtr2" in names


def test_router_fields(topo):
    rtr = topo.get_device("edge-rtr1")
    assert rtr is not None
    assert rtr.role == DeviceRole.ROUTER
    assert rtr.asn == 64512
    assert "10.255.0.2" in rtr.bgp_neighbors
    assert len(rtr.interfaces) == 2


def test_switches_loaded(topo):
    # 2 core + 2 access + 2 gpu-spines + 4 gpu-leaves = 10
    assert len(topo.switches) == 10


def test_switch_vlans(topo):
    sw = topo.get_device("core-sw1")
    assert sw is not None
    assert 100 in sw.vlans


def test_switch_gpu_leaf_interfaces(topo):
    leaf = topo.get_device("gpu-leaf1")
    assert leaf is not None
    gpu_ports = [i for i in leaf.interfaces if i.is_gpu_port]
    assert len(gpu_ports) == 2


def test_firewalls_loaded(topo):
    assert len(topo.firewalls) == 2
    fw = topo.get_device("fw1")
    assert fw.ha_peer == "fw2"
    assert "untrust" in fw.zones


def test_load_balancers_loaded(topo):
    assert len(topo.load_balancers) == 2
    lb = topo.get_device("lb1")
    assert "10.0.100.100:443" in lb.virtual_servers
    assert "10.0.10.10:8080" in lb.pool_members


def test_gpu_firewalls_loaded(topo):
    assert len(topo.gpu_firewalls) == 1
    gfw = topo.gpu_firewalls[0]
    assert gfw.name == "gpu-fw1"
    assert gfw.rdma_policy == "allow_rocev2"
    assert "GPU-VRF" in gfw.protected_segments


def test_gpu_servers_loaded(topo):
    assert len(topo.gpu_servers) == 8
    for srv in topo.gpu_servers:
        assert srv.gpu_count == 8
        assert srv.connected_leaf is not None


def test_all_devices_count(topo):
    # 2 routers + 10 switches + 2 FWs + 2 LBs + 1 GPU FW + 8 GPU servers = 25
    assert len(topo.all_devices()) == 25


def test_get_device_not_found(topo):
    assert topo.get_device("nonexistent") is None


def test_devices_by_role(topo):
    switches = topo.devices_by_role(DeviceRole.SWITCH)
    assert len(switches) == 10


def test_unprovisioned_all_at_start(topo):
    for device in topo.all_devices():
        device.ztp_state = ZTPState.UNPROVISIONED
    assert len(topo.unprovisioned()) == len(topo.all_devices())


def test_summary(topo):
    s = topo.summary()
    assert s["total"] == 25
    assert s["routers"] == 2
    assert s["switches"] == 10
    assert s["gpu_servers"] == 8
