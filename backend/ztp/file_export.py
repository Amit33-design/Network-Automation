"""
ZTP static file export (G-A6)
==============================
Writes rendered Day-0 bootstrap configs and platform POAP/ZTP scripts to
`ZTP_FILES_DIR`, a directory shared with the `ztp-files` (nginx) and
`ztp-tftp` (TFTP) containers added in docker-compose.

This lets devices that fetch their boot config via plain TFTP (DHCP
`next-server` + `filename`) or a separate HTTP file server pick up the same
content the FastAPI `/ztp/bootstrap/{serial}` and `/ztp/script/{platform}`
endpoints serve dynamically — useful for legacy gear that can't make
authenticated/HTTPS calls back to the API.

Layout under ZTP_FILES_DIR:
    configs/{hostname}.cfg   — per-device Day 0 config (one per registered device)
    scripts/{platform}.py    — POAP/ZTP scripts (one per supported platform)
"""

from __future__ import annotations

import os
from pathlib import Path

from .server import ZTPDevice, ztp_server

ZTP_FILES_DIR = Path(os.environ.get("ZTP_FILES_DIR", "/tmp/netdesign_ztp_files"))

# Platform → static script filename served from {ZTP_FILES_DIR}/scripts/
PLATFORM_SCRIPTS = {
    "nxos":   "nxos_poap.py",
    "eos":    "eos_ztp.py",
    "ios-xe": "ios_xe_pnp.py",
}


def export_device_config(dev: ZTPDevice, base_dir: Path | None = None) -> Path:
    """Write a device's rendered Day 0 config to {base_dir}/configs/{hostname}.cfg."""
    base = base_dir or ZTP_FILES_DIR
    configs_dir = base / "configs"
    configs_dir.mkdir(parents=True, exist_ok=True)
    path = configs_dir / f"{dev.hostname}.cfg"
    path.write_text(ztp_server.render_config(dev))
    return path


def export_platform_scripts(server_url: str, base_dir: Path | None = None) -> list[Path]:
    """Write each platform's POAP/ZTP script to {base_dir}/scripts/{filename}."""
    base = base_dir or ZTP_FILES_DIR
    scripts_dir = base / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for platform, filename in PLATFORM_SCRIPTS.items():
        script = ztp_server.get_platform_script(platform, server_url)
        path = scripts_dir / filename
        path.write_text(script)
        paths.append(path)
    return paths


def export_all(server_url: str, base_dir: Path | None = None) -> dict[str, list[str]]:
    """Export Day 0 configs for every registered device plus all platform scripts."""
    config_paths = [export_device_config(dev, base_dir) for dev in ztp_server.all_devices()]
    script_paths = export_platform_scripts(server_url, base_dir)
    return {
        "configs": [str(p) for p in config_paths],
        "scripts": [str(p) for p in script_paths],
    }
