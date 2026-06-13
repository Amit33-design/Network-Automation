"""
Tests for config_drift.py — Config drift detection (G-A4).
"""
import pytest

import config_drift
from config_drift import (
    build_remediation,
    check_config_drift,
    diff_configs,
    generate_remediation,
    get_running_config,
    latest_backup_dir,
)


# ── diff_configs ──────────────────────────────────────────────────────────────

class TestDiffConfigs:
    def test_identical_configs_no_drift(self):
        cfg = "hostname leaf1\ninterface Eth1\n  no shutdown\n"
        result = diff_configs(cfg, cfg)
        assert result["has_drift"] is False
        assert result["added"] == []
        assert result["removed"] == []
        assert result["unified_diff"] == ""

    def test_ignores_blank_lines_and_trailing_whitespace(self):
        intended = "hostname leaf1\n\ninterface Eth1\n  no shutdown   \n"
        running  = "hostname leaf1\ninterface Eth1\n  no shutdown\n\n\n"
        result = diff_configs(intended, running)
        assert result["has_drift"] is False

    def test_detects_added_line(self):
        intended = "hostname leaf1\ninterface Eth1\n  no shutdown\n"
        running  = "hostname leaf1\ninterface Eth1\n  no shutdown\n  shutdown\n"
        result = diff_configs(intended, running)
        assert result["has_drift"] is True
        assert "  shutdown" in result["added"]
        assert result["removed"] == []
        assert "unified" in result["unified_diff"] or "+  shutdown" in result["unified_diff"]

    def test_detects_removed_line(self):
        intended = "hostname leaf1\ninterface Eth1\n  no shutdown\n  description uplink\n"
        running  = "hostname leaf1\ninterface Eth1\n  no shutdown\n"
        result = diff_configs(intended, running)
        assert result["has_drift"] is True
        assert "  description uplink" in result["removed"]
        assert result["added"] == []

    def test_detects_changed_line_as_remove_and_add(self):
        intended = "router bgp 65001\n  bgp router-id 10.0.0.1\n"
        running  = "router bgp 65002\n  bgp router-id 10.0.0.1\n"
        result = diff_configs(intended, running)
        assert result["has_drift"] is True
        assert "router bgp 65001" in result["removed"]
        assert "router bgp 65002" in result["added"]


# ── latest_backup_dir / get_running_config ──────────────────────────────────────

class TestGetRunningConfig:
    def test_returns_none_when_backup_dir_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path / "does-not-exist")
        assert latest_backup_dir() is None
        assert get_running_config("leaf1") is None

    def test_returns_none_when_no_deployment_dirs(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        assert latest_backup_dir() is None
        assert get_running_config("leaf1") is None

    def test_returns_none_when_host_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        dep_dir = tmp_path / "deploy-1"
        dep_dir.mkdir()
        (dep_dir / "spine1.cfg").write_text("hostname spine1\n")
        assert get_running_config("leaf1", "deploy-1") is None

    def test_reads_config_for_explicit_deployment_id(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        dep_dir = tmp_path / "deploy-1"
        dep_dir.mkdir()
        (dep_dir / "leaf1.cfg").write_text("hostname leaf1\n")
        assert get_running_config("leaf1", "deploy-1") == "hostname leaf1\n"

    def test_falls_back_to_latest_deployment_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)

        old_dir = tmp_path / "deploy-old"
        old_dir.mkdir()
        (old_dir / "leaf1.cfg").write_text("hostname leaf1-old\n")

        new_dir = tmp_path / "deploy-new"
        new_dir.mkdir()
        (new_dir / "leaf1.cfg").write_text("hostname leaf1-new\n")

        # Ensure new_dir has a strictly later mtime than old_dir
        import os
        import time
        now = time.time()
        os.utime(old_dir, (now - 100, now - 100))
        os.utime(new_dir, (now, now))

        assert latest_backup_dir() == new_dir
        assert get_running_config("leaf1") == "hostname leaf1-new\n"


# ── check_config_drift ───────────────────────────────────────────────────────

class TestCheckConfigDrift:
    def test_no_baseline_when_backup_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        configs = {"leaf1": "hostname leaf1\n"}
        result = check_config_drift(configs)

        assert result["device_count"] == 1
        assert result["drift_count"] == 0
        dev = result["devices"][0]
        assert dev["hostname"] == "leaf1"
        assert dev["no_baseline"] is True
        assert dev["has_drift"] is False

    def test_in_sync_device(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        dep_dir = tmp_path / "deploy-1"
        dep_dir.mkdir()
        cfg = "hostname leaf1\ninterface Eth1\n  no shutdown\n"
        (dep_dir / "leaf1.cfg").write_text(cfg)

        result = check_config_drift({"leaf1": cfg}, deployment_id="deploy-1")

        assert result["device_count"] == 1
        assert result["drift_count"] == 0
        dev = result["devices"][0]
        assert dev["no_baseline"] is False
        assert dev["has_drift"] is False

    def test_drift_detected_across_multiple_devices(self, tmp_path, monkeypatch):
        monkeypatch.setattr(config_drift, "BACKUP_DIR", tmp_path)
        dep_dir = tmp_path / "deploy-1"
        dep_dir.mkdir()

        (dep_dir / "leaf1.cfg").write_text("hostname leaf1\ninterface Eth1\n  shutdown\n")
        (dep_dir / "spine1.cfg").write_text("hostname spine1\n")

        configs = {
            "leaf1":  "hostname leaf1\ninterface Eth1\n  no shutdown\n",
            "spine1": "hostname spine1\n",
            "leaf2":  "hostname leaf2\n",  # no backup
        }
        result = check_config_drift(configs, deployment_id="deploy-1")

        assert result["device_count"] == 3
        assert result["drift_count"] == 1

        by_host = {d["hostname"]: d for d in result["devices"]}
        assert by_host["leaf1"]["has_drift"] is True
        assert "  shutdown" in by_host["leaf1"]["added"]
        assert "  no shutdown" in by_host["leaf1"]["removed"]
        assert by_host["spine1"]["has_drift"] is False
        assert by_host["spine1"]["no_baseline"] is False
        assert by_host["leaf2"]["no_baseline"] is True


# ── generate_remediation (G-A16) ────────────────────────────────────────────────

class TestGenerateRemediation:
    def test_restores_missing_intended_lines_cisco(self):
        r = generate_remediation("leaf1", "ios-xe", added=[], removed=["  ntp server 10.0.0.1"])
        assert r["commands"] == ["  ntp server 10.0.0.1"]
        assert r["command_count"] == 1

    def test_negates_extra_lines_cisco(self):
        r = generate_remediation("leaf1", "nxos", added=["  ip access-group TEMP in"], removed=[])
        assert r["commands"] == ["  no ip access-group TEMP in"]

    def test_negation_preserves_indentation(self):
        r = generate_remediation("sw", "eos", added=["    shutdown"], removed=[])
        assert r["commands"] == ["    no shutdown"]

    def test_double_negation_re_enables(self):
        # an extra `no shutdown` on the device → remediation re-enables via `shutdown`
        r = generate_remediation("sw", "ios-xe", added=["  no shutdown"], removed=[])
        assert r["commands"] == ["  shutdown"]

    def test_restore_then_prune_order(self):
        r = generate_remediation(
            "sw", "ios-xe",
            added=["  ip access-group TEMP in"],
            removed=["  ntp server 10.0.0.1"],
        )
        # restores (removed) come first, then prunes (added)
        assert r["commands"] == ["  ntp server 10.0.0.1", "  no ip access-group TEMP in"]

    def test_junos_uses_set_and_delete(self):
        r = generate_remediation(
            "mx", "juniper-junos",
            added=["set system services telnet"],
            removed=["set system host-name mx01"],
        )
        assert "set system host-name mx01" in r["commands"]
        assert "delete system services telnet" in r["commands"]

    def test_junos_wraps_bare_lines(self):
        r = generate_remediation("mx", "junos", added=["system services ftp"], removed=["system host-name a"])
        assert "set system host-name a" in r["commands"]
        assert "delete system services ftp" in r["commands"]

    def test_no_drift_yields_no_commands(self):
        r = generate_remediation("sw", "ios-xe", added=[], removed=[])
        assert r["commands"] == []
        assert r["command_count"] == 0


# ── build_remediation (G-A16) ────────────────────────────────────────────────────

class TestBuildRemediation:
    def test_batch_per_device(self):
        out = build_remediation([
            {"hostname": "leaf1", "platform": "nxos", "added": ["  x"], "removed": []},
            {"hostname": "mx1", "platform": "junos", "added": [], "removed": ["set a b"]},
        ])
        assert len(out["devices"]) == 2
        by_host = {d["hostname"]: d for d in out["devices"]}
        assert by_host["leaf1"]["commands"] == ["  no x"]
        assert by_host["mx1"]["commands"] == ["set a b"]

    def test_defaults_platform_when_missing(self):
        out = build_remediation([{"hostname": "sw", "added": ["  y"], "removed": []}])
        assert out["devices"][0]["platform"] == "ios-xe"
        assert out["devices"][0]["commands"] == ["  no y"]
