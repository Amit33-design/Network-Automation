"""
Device I/O must fail CLOSED.

The bug these tests pin: when Nornir/Netmiko were not importable on the
server, `deploy_configs` marked every host "simulated" and still returned
`success: True`, and `run_pre_checks` reported ssh_login / version_check /
config_backup as PASSED. An operator who explicitly asked for a real push
(dry_run=False) against real inventory therefore saw a green deployment, a
config backup that was never written, and an unchanged fleet.

Simulation is a legitimate mode — but only when there is no inventory to act
on. The moment real inventory is supplied, a missing device library is an
environment fault and must be reported as one.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nornir_tasks as nt


INVENTORY = {
    "leaf-01": {"hostname": "10.0.0.11", "platform": "nxos"},
    "leaf-02": {"hostname": "10.0.0.12", "platform": "nxos"},
}
CONFIGS = {"leaf-01": "hostname leaf-01\n", "leaf-02": "hostname leaf-02\n"}


@pytest.fixture
def no_device_io(monkeypatch):
    """Simulate a server where the device libraries failed to install."""
    monkeypatch.setattr(nt, "NORNIR_AVAILABLE", False)


# ── deploy ────────────────────────────────────────────────────────────────

def test_deploy_refuses_when_device_io_unavailable(no_device_io):
    res = nt.deploy_configs(CONFIGS, INVENTORY, dry_run=False)

    assert res["success"] is False, "a push that touched nothing reported success"
    assert "reason" in res and "Nornir" in res["reason"]
    for host in CONFIGS:
        assert res[host]["status"] == "no_device_io"
        assert res[host]["status"] != "simulated"


def test_deploy_refuses_without_inventory_and_says_why():
    res = nt.deploy_configs(CONFIGS, {}, dry_run=False)
    assert res["success"] is False
    assert "inventory" in res["reason"].lower()


def test_dry_run_still_succeeds_without_touching_anything(no_device_io):
    """dry_run is an explicit request to validate only — it is not a failure."""
    res = nt.deploy_configs(CONFIGS, INVENTORY, dry_run=True)
    assert res["success"] is True
    for host in CONFIGS:
        assert res[host]["status"] == "dry_run"


# ── pre-checks ────────────────────────────────────────────────────────────

def test_pre_checks_never_claim_a_backup_they_did_not_take(no_device_io, monkeypatch):
    # Reachability is a plain TCP probe and works without Nornir, so make the
    # hosts reachable — that is exactly the path that used to fake a backup.
    monkeypatch.setattr(nt, "_icmp_reachable", lambda *a, **k: True)

    results = nt.run_pre_checks({}, INVENTORY, deployment_id="t1")
    backups = [r for r in results if r["check"] == "config_backup"]

    assert backups, "no config_backup check was emitted"
    for r in backups:
        assert r["passed"] is False, (
            "config_backup passed with no device I/O — rollback would have had "
            "no restore target"
        )
        assert "Nornir" in r["detail"]

    for r in results:
        if r["check"] in ("ssh_login", "version_check"):
            assert r["passed"] is False


def test_pre_checks_still_simulate_when_there_is_no_inventory():
    """Demo mode is intentional: nothing real was claimed, nothing was touched."""
    results = nt.run_pre_checks({}, {})
    assert results and all(r["passed"] for r in results)
    assert all(r["host"] == "demo-device" for r in results)


# ── post-checks ───────────────────────────────────────────────────────────

def test_post_checks_distinguish_env_fault_from_unreachable(no_device_io, monkeypatch):
    monkeypatch.setattr(nt, "_icmp_reachable", lambda *a, **k: True)
    results = nt.run_post_checks({"uc": "dc"}, INVENTORY)

    assert results and all(r["passed"] is False for r in results)
    # the detail must name the server-side fault, not say "simulated"
    assert all("Nornir" in r["detail"] for r in results)
    assert not any(r["detail"] == "simulated" for r in results)


def test_post_checks_say_unreachable_when_that_is_the_real_cause(monkeypatch):
    monkeypatch.setattr(nt, "NORNIR_AVAILABLE", True)
    monkeypatch.setattr(nt, "_icmp_reachable", lambda *a, **k: False)

    results = nt.run_post_checks({"uc": "dc"}, INVENTORY)
    assert results and all(r["passed"] is False for r in results)
    assert all("unreachable" in r["detail"] for r in results)
