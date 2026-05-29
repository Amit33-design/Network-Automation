"""
Machine fingerprint for per-instance license binding.

For Docker: fingerprint is a UUID generated on first boot and persisted
in the backups volume (/app/backups/.machine_id). Same volume = same
instance. Removing the volume triggers re-activation.

For bare-metal / desktop: falls back to hostname + MAC + /etc/machine-id.
"""
from __future__ import annotations

import hashlib
import logging
import os
import uuid
from pathlib import Path

log = logging.getLogger(__name__)

# Where to persist the machine ID inside the container (backups volume)
_MACHINE_ID_FILE = Path(os.environ.get("BACKUP_DIR", "/app/backups")) / ".machine_id"

# Fallback for local dev (outside Docker)
_DEV_MACHINE_ID_FILE = Path.home() / ".netdesign_machine_id"


def get_machine_id() -> str:
    """
    Return a stable per-instance machine ID.
    Generates one on first call and persists it for subsequent runs.
    """
    # 1. Try volume-persisted ID (Docker production path)
    machine_id = _read_or_create(_MACHINE_ID_FILE)
    if machine_id:
        return machine_id

    # 2. Try /etc/machine-id (systemd, some containers)
    try:
        mid = Path("/etc/machine-id").read_text().strip()
        if mid and len(mid) >= 16:
            return _normalize(mid)
    except OSError:
        pass

    # 3. Dev fallback — home directory
    machine_id = _read_or_create(_DEV_MACHINE_ID_FILE)
    if machine_id:
        return machine_id

    # 4. Last resort — ephemeral (will change on restart)
    log.warning("Cannot persist machine ID — license binding will be ephemeral")
    return _derive_from_system()


def _read_or_create(path: Path) -> str | None:
    """Read existing machine ID from file, or create and save a new one."""
    try:
        if path.exists():
            mid = path.read_text().strip()
            if mid and len(mid) >= 16:
                return mid
        # Create parent dirs if needed
        path.parent.mkdir(parents=True, exist_ok=True)
        mid = str(uuid.uuid4())
        path.write_text(mid)
        log.info("Generated new machine ID: %s (stored at %s)", mid, path)
        return mid
    except OSError as exc:
        log.debug("Cannot read/write machine ID at %s: %s", path, exc)
        return None


def _derive_from_system() -> str:
    """Derive a best-effort ID from system properties (not stable across restarts)."""
    import socket
    parts = [socket.gethostname()]
    try:
        import fcntl, struct
        # Get first non-loopback MAC
        import subprocess
        result = subprocess.run(
            ["ip", "link", "show"], capture_output=True, text=True, timeout=2
        )
        for line in result.stdout.splitlines():
            if "link/ether" in line:
                parts.append(line.split()[1])
                break
    except Exception:
        pass
    return _normalize(hashlib.sha256("\n".join(parts).encode()).hexdigest())


def _normalize(raw: str) -> str:
    """Return a clean lowercase hex ID, 32 chars."""
    cleaned = raw.replace("-", "").replace(":", "").lower()
    if len(cleaned) < 32:
        cleaned = hashlib.sha256(cleaned.encode()).hexdigest()
    return cleaned[:32]
