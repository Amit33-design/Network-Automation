"""
Tests for ztp/file_export.py — static ZTP file export (G-A6).

Verifies that rendered Day 0 configs and platform POAP/ZTP scripts can be
exported to a directory tree suitable for the ztp-files (nginx) and
ztp-tftp containers, without mutating ZTP registry state.
"""
from pathlib import Path

import pytest

from ztp.file_export import (
    PLATFORM_SCRIPTS,
    export_all,
    export_device_config,
    export_platform_scripts,
)
from ztp.server import ZTPDevice, ZTPState, ztp_server


@pytest.fixture
def sample_device():
    return ZTPDevice(
        serial="FDO123456",
        hostname="leaf-01",
        platform="nxos",
        role="dc-leaf",
        mgmt_ip="10.0.0.11",
    )


# ── export_device_config ────────────────────────────────────────────────────

class TestExportDeviceConfig:
    def test_writes_config_file_under_configs_dir(self, tmp_path, sample_device):
        path = export_device_config(sample_device, base_dir=tmp_path)
        assert path == tmp_path / "configs" / "leaf-01.cfg"
        assert path.exists()

    def test_content_matches_rendered_config(self, tmp_path, sample_device):
        path = export_device_config(sample_device, base_dir=tmp_path)
        assert path.read_text() == ztp_server.render_config(sample_device)
        assert "leaf-01" in path.read_text()

    def test_does_not_mutate_device_state(self, tmp_path, sample_device):
        export_device_config(sample_device, base_dir=tmp_path)
        assert sample_device.state == ZTPState.WAITING
        assert sample_device.contacted_at is None

    def test_overwrites_existing_file(self, tmp_path, sample_device):
        path = export_device_config(sample_device, base_dir=tmp_path)
        path.write_text("stale content")
        export_device_config(sample_device, base_dir=tmp_path)
        assert "stale content" not in path.read_text()


# ── export_platform_scripts ─────────────────────────────────────────────────

class TestExportPlatformScripts:
    def test_writes_one_file_per_supported_platform(self, tmp_path):
        paths = export_platform_scripts("http://ztp.local", base_dir=tmp_path)
        assert len(paths) == len(PLATFORM_SCRIPTS)
        for p in paths:
            assert p.parent.name == "scripts"
            assert p.exists()
            assert p.read_text()

    def test_filenames_match_platform_map(self, tmp_path):
        paths = export_platform_scripts("http://ztp.local", base_dir=tmp_path)
        names = {p.name for p in paths}
        assert names == set(PLATFORM_SCRIPTS.values())

    def test_script_content_references_server_url(self, tmp_path):
        paths = export_platform_scripts("http://ztp.example.com", base_dir=tmp_path)
        nxos_script = next(p for p in paths if p.name == PLATFORM_SCRIPTS["nxos"])
        assert "ztp.example.com" in nxos_script.read_text()


# ── export_all ───────────────────────────────────────────────────────────────

class TestExportAll:
    def test_exports_registered_devices_and_scripts(self, tmp_path, monkeypatch, sample_device):
        monkeypatch.setattr(ztp_server, "_devices", {sample_device.serial: sample_device})
        result = export_all("http://ztp.local", base_dir=tmp_path)

        assert result["configs"] == [str(tmp_path / "configs" / "leaf-01.cfg")]
        assert len(result["scripts"]) == len(PLATFORM_SCRIPTS)
        for cfg in result["configs"]:
            assert Path(cfg).exists()

    def test_no_registered_devices_still_exports_scripts(self, tmp_path, monkeypatch):
        monkeypatch.setattr(ztp_server, "_devices", {})
        result = export_all("http://ztp.local", base_dir=tmp_path)
        assert result["configs"] == []
        assert len(result["scripts"]) == len(PLATFORM_SCRIPTS)
