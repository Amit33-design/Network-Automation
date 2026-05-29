"""Tests for the monitoring engine."""
import pytest

from lab_demo.devices import (
    DeviceInterface,
    DevicePlatform,
    Firewall,
    GPUFirewall,
    GPUServer,
    LoadBalancer,
    Router,
    Switch,
)
from lab_demo.monitoring import DeviceHealth, HealthStatus, MonitoringEngine


def _rtr(ifaces=None):
    d = Router(name="rtr1", platform=DevicePlatform.CISCO_IOSXE, management_ip="192.168.1.1",
               bgp_neighbors=["10.0.0.2"])
    d.interfaces = ifaces or []
    return d


def _sw():
    return Switch(name="sw1", platform=DevicePlatform.CISCO_NXOS, management_ip="192.168.1.21",
                  vlans=[10, 20])


def _fw(ha_peer="fw2"):
    d = Firewall(name="fw1", platform=DevicePlatform.PALOALTO_PANOS,
                 management_ip="192.168.1.11", ha_peer=ha_peer)
    return d


def _gfw():
    return GPUFirewall(name="gpu-fw1", platform=DevicePlatform.PALOALTO_PANOS,
                       management_ip="192.168.2.20", protected_segments=["GPU-VRF"],
                       rdma_policy="allow_rocev2")


def _lb():
    return LoadBalancer(name="lb1", platform=DevicePlatform.F5_TMSH,
                        management_ip="192.168.1.41",
                        virtual_servers=["10.0.100.100:443"],
                        pool_members=["10.0.10.10:8080"])


def _gpu_srv():
    d = GPUServer(name="gpu-srv-01", platform=DevicePlatform.LINUX,
                  management_ip="192.168.3.1", gpu_count=8,
                  rdma_interfaces=["ens1f0", "ens1f1"])
    return d


# ── Baseline healthy polls ───────────────────────────────────────────────────

def test_router_healthy():
    h = MonitoringEngine().poll_device(_rtr())
    assert h.status == HealthStatus.HEALTHY
    assert h.alerts == []


def test_switch_healthy():
    h = MonitoringEngine().poll_device(_sw())
    assert h.status == HealthStatus.HEALTHY


def test_firewall_healthy():
    h = MonitoringEngine().poll_device(_fw())
    assert h.status == HealthStatus.HEALTHY


def test_lb_healthy():
    h = MonitoringEngine().poll_device(_lb())
    assert h.status == HealthStatus.HEALTHY


def test_gpu_server_healthy():
    h = MonitoringEngine().poll_device(_gpu_srv())
    assert h.status == HealthStatus.HEALTHY


# ── Degraded conditions ──────────────────────────────────────────────────────

def test_router_interface_down_is_degraded():
    rtr = _rtr(ifaces=[DeviceInterface(name="Gi1")])
    h = MonitoringEngine().poll_device(rtr, fail_checks=["interfaces_up"])
    assert h.status == HealthStatus.DEGRADED
    assert any("DOWN" in a for a in h.alerts)


def test_router_bgp_down_is_degraded():
    h = MonitoringEngine().poll_device(_rtr(), fail_checks=["bgp_sessions"])
    assert h.status == HealthStatus.DEGRADED
    assert any("BGP" in a for a in h.alerts)


def test_firewall_ha_sync_lost_is_degraded():
    h = MonitoringEngine().poll_device(_fw(), fail_checks=["ha_active"])
    assert h.status == HealthStatus.DEGRADED
    assert any("HA" in a for a in h.alerts)


def test_firewall_no_ha_peer_no_ha_alert():
    fw = _fw(ha_peer=None)
    h = MonitoringEngine().poll_device(fw, fail_checks=["ha_active"])
    assert not any("HA" in a for a in h.alerts)


def test_lb_vip_unhealthy_is_degraded():
    h = MonitoringEngine().poll_device(_lb(), fail_checks=["virtual_servers"])
    assert h.status == HealthStatus.DEGRADED
    assert any("VIP" in a for a in h.alerts)


def test_gpu_server_rdma_down_is_degraded():
    h = MonitoringEngine().poll_device(_gpu_srv(), fail_checks=["rdma_interfaces"])
    assert h.status == HealthStatus.DEGRADED
    assert any("RDMA" in a for a in h.alerts)


def test_gpu_server_gpu_fault_is_degraded():
    h = MonitoringEngine().poll_device(_gpu_srv(), fail_checks=["gpu_health"])
    assert h.status == HealthStatus.DEGRADED
    assert any("GPU" in a.upper() for a in h.alerts)


def test_gpu_firewall_no_rdma_sessions_is_degraded():
    h = MonitoringEngine().poll_device(_gfw(), fail_checks=["rdma_policy"])
    assert h.status == HealthStatus.DEGRADED


# ── Alert callback ───────────────────────────────────────────────────────────

def test_alert_callback_called_when_degraded():
    fired = []
    mon = MonitoringEngine()
    mon.on_alert(fired.append)
    rtr = _rtr(ifaces=[DeviceInterface(name="Gi1")])
    mon.poll_device(rtr, fail_checks=["interfaces_up"])
    assert len(fired) == 1
    assert fired[0].device_name == "rtr1"


def test_no_alert_callback_when_healthy():
    fired = []
    mon = MonitoringEngine()
    mon.on_alert(fired.append)
    mon.poll_device(_rtr())
    assert fired == []


# ── poll_all and summary ─────────────────────────────────────────────────────

def test_poll_all_healthy():
    mon = MonitoringEngine()
    devices = [_rtr(), _sw(), _fw(), _lb()]
    mon.poll_all(devices)
    s = mon.summary()
    assert s["total"] == 4
    assert s["healthy"] == 4
    assert s["degraded"] == 0


def test_poll_all_partial_failure():
    mon = MonitoringEngine()
    rtr = _rtr(ifaces=[DeviceInterface(name="Gi1")])
    devices = [rtr, _sw(), _fw()]
    mon.poll_all(devices, fail_devices={"rtr1": ["interfaces_up"]})
    s = mon.summary()
    assert s["degraded"] >= 1
    assert s["healthy"] == 2


def test_summary_alerts_list():
    mon = MonitoringEngine()
    rtr = _rtr(ifaces=[DeviceInterface(name="Gi1")])
    mon.poll_all([rtr], fail_devices={"rtr1": ["interfaces_up"]})
    s = mon.summary()
    assert len(s["alerts"]) >= 1
    assert s["alerts"][0]["device"] == "rtr1"


def test_device_health_fields():
    h = MonitoringEngine().poll_device(_rtr())
    assert isinstance(h, DeviceHealth)
    assert "cpu" in h.metrics
    assert h.timestamp > 0
