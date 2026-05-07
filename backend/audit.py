"""
NetDesign AI — Audit Logging
==============================
Writes structured, append-only audit events to:
  1. Python's structured logger (stdout/stderr)
  2. A JSONL file at AUDIT_LOG_PATH (default: /tmp/netdesign_audit.jsonl)

Phase 2 will wire record() to the PostgreSQL audit_log table as well.

Usage:
    from audit import record

    await record(
        user_id="alice",
        action="deploy.push",
        resource_id=deployment_id,
        resource_type="deployment",
        outcome="success",
        detail={"device_count": 8, "dry_run": False},
    )
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("netdesign.audit")

_AUDIT_LOG_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "/tmp/netdesign_audit.jsonl"))

# Ensure the directory exists (best-effort)
try:
    _AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
except OSError:
    pass


# ---------------------------------------------------------------------------
# Core record function
# ---------------------------------------------------------------------------

async def record(
    user_id: str,
    action: str,
    resource_id: str,
    resource_type: str,
    outcome: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """
    Write an immutable audit event.

    Args:
        user_id:       Identity of the actor (JWT sub claim).
        action:        What was done, dot-separated: deploy.push, design.create,
                       config.generate, deploy.rollback, auth.login, etc.
        resource_id:   ID of the affected resource (design_id, deployment_id, …).
        resource_type: Type of resource: design | deployment | device | config.
        outcome:       Result: success | failed | blocked | denied.
        detail:        Optional extra context (kept short — no raw configs).
    """
    event: dict[str, Any] = {
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "user_id":       user_id,
        "action":        action,
        "resource_id":   resource_id,
        "resource_type": resource_type,
        "outcome":       outcome,
        "detail":        detail or {},
    }

    # 1. Structured log (always)
    log.info(
        "audit_event",
        extra={
            "audit": True,
            **{k: v for k, v in event.items() if k != "detail"},
        },
    )

    # 2. Append to JSONL file (best-effort — never raise)
    try:
        with open(_AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
    except OSError as exc:
        log.warning("audit: could not write to %s: %s", _AUDIT_LOG_PATH, exc)


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

async def record_deploy(
    user_id: str,
    deployment_id: str,
    outcome: str,
    *,
    dry_run: bool,
    device_count: int,
    environment: str = "staging",
) -> None:
    await record(
        user_id=user_id,
        action="deploy.push",
        resource_id=deployment_id,
        resource_type="deployment",
        outcome=outcome,
        detail={
            "dry_run":      dry_run,
            "device_count": device_count,
            "environment":  environment,
        },
    )


async def record_config_gen(
    user_id: str,
    design_id: str,
    device_count: int,
) -> None:
    await record(
        user_id=user_id,
        action="config.generate",
        resource_id=design_id,
        resource_type="design",
        outcome="success",
        detail={"device_count": device_count},
    )


async def record_login(
    user_id: str,
    outcome: str,
    *,
    ip_address: str = "",
) -> None:
    await record(
        user_id=user_id,
        action="auth.login",
        resource_id=user_id,
        resource_type="user",
        outcome=outcome,
        detail={"ip": ip_address},
    )
