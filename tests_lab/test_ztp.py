"""Tests for the ZTP engine."""
import pytest

from lab_demo.devices import DevicePlatform, Router, Switch, ZTPState
from lab_demo.ztp import ZTPEngine, ZTPEvent, _PIPELINE


def _rtr(name="rtr1"):
    return Router(name=name, platform=DevicePlatform.CISCO_IOSXE, management_ip="192.168.1.1")


def _sw(name="sw1"):
    return Switch(name=name, platform=DevicePlatform.CISCO_NXOS, management_ip="192.168.1.21")


# ── Single device provisioning ───────────────────────────────────────────────

def test_provision_success():
    engine = ZTPEngine()
    assert engine.provision_device(_rtr()) is True


def test_device_state_online_after_provision():
    device = _rtr()
    ZTPEngine().provision_device(device)
    assert device.ztp_state == ZTPState.ONLINE
    assert device.is_online


def test_all_pipeline_states_recorded():
    engine = ZTPEngine()
    device = _rtr()
    engine.provision_device(device)
    recorded = {e.state for e in engine.history}
    for state in _PIPELINE:
        assert state in recorded, f"Missing state: {state}"


def test_provision_failure_at_config_applied():
    engine = ZTPEngine()
    device = _rtr()
    result = engine.provision_device(device, fail_at=ZTPState.CONFIG_APPLIED)
    assert result is False
    assert device.ztp_state == ZTPState.FAILED


def test_provision_failure_at_dhcp():
    device = _rtr()
    ZTPEngine().provision_device(device, fail_at=ZTPState.DHCP_REQUESTED)
    assert device.ztp_state == ZTPState.FAILED


def test_provision_failure_at_pre_checks():
    device = _rtr()
    ZTPEngine().provision_device(device, fail_at=ZTPState.PRE_CHECKS_RUNNING)
    assert device.ztp_state == ZTPState.FAILED


def test_callback_invoked_on_each_transition():
    events = []
    engine = ZTPEngine(on_event=lambda e: events.append(e))
    engine.provision_device(_rtr())
    assert len(events) == len(_PIPELINE)
    assert all(isinstance(e, ZTPEvent) for e in events)


def test_callback_invoked_on_failure():
    events = []
    engine = ZTPEngine(on_event=lambda e: events.append(e))
    engine.provision_device(_rtr(), fail_at=ZTPState.BOOTSTRAP_DOWNLOADED)
    last = events[-1]
    assert last.state == ZTPState.FAILED
    assert last.success is False


def test_failed_event_message_contains_stage():
    events = []
    engine = ZTPEngine(on_event=lambda e: events.append(e))
    engine.provision_device(_rtr(), fail_at=ZTPState.CONFIG_APPLIED)
    fail_event = next(e for e in events if not e.success)
    assert "config_applied" in fail_event.message


# ── Topology provisioning ────────────────────────────────────────────────────

def test_provision_topology_all_success():
    devices = [_rtr(f"rtr{i}") for i in range(4)]
    results = ZTPEngine().provision_topology(devices)
    assert all(results.values())
    assert len(results) == 4


def test_provision_topology_partial_failure():
    devices = [_rtr(f"rtr{i}") for i in range(3)]
    results = ZTPEngine().provision_topology(
        devices, fail_devices={"rtr1": ZTPState.BOOTSTRAP_DOWNLOADED}
    )
    assert results["rtr0"] is True
    assert results["rtr1"] is False
    assert results["rtr2"] is True


def test_provision_topology_multiple_failures():
    devices = [_rtr(f"rtr{i}") for i in range(5)]
    fail_map = {
        "rtr1": ZTPState.DHCP_REQUESTED,
        "rtr3": ZTPState.CONFIG_APPLIED,
    }
    results = ZTPEngine().provision_topology(devices, fail_devices=fail_map)
    assert sum(1 for v in results.values() if not v) == 2


def test_provision_topology_mixed_device_types():
    devices = [_rtr("rtr1"), _sw("sw1"), _rtr("rtr2"), _sw("sw2")]
    results = ZTPEngine().provision_topology(devices)
    assert all(results.values())


# ── Summary ──────────────────────────────────────────────────────────────────

def test_summary_all_online():
    engine = ZTPEngine()
    engine.provision_topology([_rtr(f"r{i}") for i in range(5)])
    s = engine.summary()
    assert s["online"] == 5
    assert s["failed"] == 0


def test_summary_with_failures():
    engine = ZTPEngine()
    devices = [_rtr(f"r{i}") for i in range(5)]
    engine.provision_topology(devices, fail_devices={"r2": ZTPState.DHCP_REQUESTED})
    s = engine.summary()
    assert s["online"] == 4
    assert s["failed"] == 1
