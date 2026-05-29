"""Unit tests for lab device models."""
import pytest

from lab_demo.devices import (
    DeviceInterface,
    DevicePlatform,
    DeviceRole,
    Firewall,
    GPUFirewall,
    GPUServer,
    LoadBalancer,
    Router,
    Switch,
    ZTPState,
)


# ── Router ───────────────────────────────────────────────────────────────────

def test_router_role_set_automatically():
    r = Router(name="rtr1", platform=DevicePlatform.CISCO_IOSXE, management_ip="192.168.1.1")
    assert r.role == DeviceRole.ROUTER


def test_router_defaults():
    r = Router(name="rtr1", platform=DevicePlatform.CISCO_IOSXE, management_ip="192.168.1.1")
    assert r.ztp_state == ZTPState.UNPROVISIONED
    assert not r.is_online
    assert r.bgp_neighbors == []


def test_router_online_after_ztp():
    r = Router(name="rtr1", platform=DevicePlatform.CISCO_IOSXE, management_ip="192.168.1.1")
    r.ztp_state = ZTPState.ONLINE
    assert r.is_online


def test_router_fields():
    r = Router(
        name="edge-rtr1",
        platform=DevicePlatform.CISCO_IOSXE,
        management_ip="192.168.1.1",
        asn=64512,
        loopback0="10.255.0.1/32",
        bgp_neighbors=["10.255.0.2"],
        routing_protocols=["ospf", "bgp"],
    )
    assert r.asn == 64512
    assert "10.255.0.2" in r.bgp_neighbors
    assert "bgp" in r.routing_protocols


# ── Switch ───────────────────────────────────────────────────────────────────

def test_switch_role_set_automatically():
    sw = Switch(name="sw1", platform=DevicePlatform.CISCO_NXOS, management_ip="192.168.1.21")
    assert sw.role == DeviceRole.SWITCH


def test_switch_vlans_and_layer():
    sw = Switch(
        name="core-sw1",
        platform=DevicePlatform.CISCO_NXOS,
        management_ip="192.168.1.21",
        layer=3,
        vlans=[10, 20, 100],
    )
    assert sw.layer == 3
    assert 100 in sw.vlans


# ── Firewall ─────────────────────────────────────────────────────────────────

def test_firewall_role_and_ha():
    fw = Firewall(
        name="fw1",
        platform=DevicePlatform.PALOALTO_PANOS,
        management_ip="192.168.1.11",
        ha_peer="fw2",
        zones=["untrust", "trust"],
    )
    assert fw.role == DeviceRole.FIREWALL
    assert fw.ha_peer == "fw2"
    assert "trust" in fw.zones


# ── LoadBalancer ─────────────────────────────────────────────────────────────

def test_lb_role_and_vips():
    lb = LoadBalancer(
        name="lb1",
        platform=DevicePlatform.F5_TMSH,
        management_ip="192.168.1.41",
        virtual_servers=["10.0.100.100:443"],
        pool_members=["10.0.10.10:8080"],
        health_monitor="https",
    )
    assert lb.role == DeviceRole.LOAD_BALANCER
    assert "10.0.100.100:443" in lb.virtual_servers
    assert lb.health_monitor == "https"


# ── GPUFirewall ──────────────────────────────────────────────────────────────

def test_gpu_firewall_role_and_rdma():
    gfw = GPUFirewall(
        name="gpu-fw1",
        platform=DevicePlatform.PALOALTO_PANOS,
        management_ip="192.168.2.20",
        protected_segments=["GPU-VRF", "10.100.0.0/24"],
        rdma_policy="allow_rocev2",
    )
    assert gfw.role == DeviceRole.GPU_FIREWALL
    assert gfw.rdma_policy == "allow_rocev2"
    assert "GPU-VRF" in gfw.protected_segments


# ── GPUServer ────────────────────────────────────────────────────────────────

def test_gpu_server_role_and_gpus():
    gs = GPUServer(
        name="gpu-srv-01",
        platform=DevicePlatform.LINUX,
        management_ip="192.168.3.1",
        gpu_count=8,
        rdma_interfaces=["ens1f0", "ens1f1"],
        connected_leaf="gpu-leaf1",
    )
    assert gs.role == DeviceRole.GPU_SERVER
    assert gs.gpu_count == 8
    assert "ens1f0" in gs.rdma_interfaces
    assert gs.connected_leaf == "gpu-leaf1"


# ── DeviceInterface ──────────────────────────────────────────────────────────

def test_device_interface_defaults():
    iface = DeviceInterface(name="Eth0/1")
    assert iface.state == "up"
    assert not iface.is_gpu_port
    assert iface.speed == "1G"


def test_device_interface_gpu_port():
    iface = DeviceInterface(
        name="Ethernet1/1",
        peer_device="gpu-srv-01",
        peer_interface="ens1f0",
        speed="100G",
        is_gpu_port=True,
    )
    assert iface.is_gpu_port
    assert iface.speed == "100G"
