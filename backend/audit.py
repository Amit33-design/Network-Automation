"""
NetDesign AI — Audit Logging
==============================
Writes structured, immutable audit events to three destinations:
  1. Python structured logger (stdout — always)
  2. PostgreSQL audit_log table (when DATABASE_URL is set)
  3. SIEM webhook — Splunk HEC / Elastic / custom (when SIEM_WEBHOOK_URL is set)

All three writes are best-effort — a failure in 2 or 3 never breaks the
primary request. The structured log (1) is the fallback of last resort.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger("netdesign.audit")

_SIEM_WEBHOOK_URL = os.environ.get("SIEM_WEBHOOK_URL", "")
_SIEM_TOKEN       = os.environ.get("SIEM_TOKEN", "")       # Splunk HEC token / Elastic API key


# ---------------------------------------------------------------------------
# Core record function
# ---------------------------------------------------------------------------

async def record(
    user_id: str,
    action: str,
    resource_id: str,
    resource_type: str,
    outcome: str,
    *,
    org_id: str | None = None,
    ip_address: str = "",
    detail: dict[str, Any] | None = None,
) -> None:
    """
    Write an immutable audit event.

    action dot-notation:
      auth.login | auth.logout | auth.totp_verify | auth.sso_callback
      design.create | design.update | design.delete
      config.generate | config.export
      deploy.push | deploy.rollback | deploy.dry_run
      approval.request | approval.approve | approval.reject
      integration.trigger | export.runbook | export.drawio
      audit.export
    """
    event: dict[str, Any] = {
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "org_id":        org_id,
        "user_id":       user_id,
        "action":        action,
        "resource_id":   resource_id,
        "resource_type": resource_type,
        "outcome":       outcome,
        "ip_address":    ip_address,
        "detail":        detail or {},
    }

    # ── 1. Structured log (always — synchronous, never fails silently) ────────
    log.info(
        "audit_event action=%s outcome=%s user=%s resource=%s/%s",
        action, outcome, user_id, resource_type, resource_id,
        extra={"audit": True, **{k: v for k, v in event.items() if k != "detail"}},
    )

    # ── 2. PostgreSQL audit_log table ─────────────────────────────────────────
    await _write_db(event)

    # ── 3. SIEM webhook (fire-and-forget) ─────────────────────────────────────
    if _SIEM_WEBHOOK_URL:
        await _write_siem(event)


async def _write_db(event: dict[str, Any]) -> None:
    """Insert into audit_log table. Silently skips if DB is not configured."""
    try:
        from db import _SessionLocal
        if _SessionLocal is None:
            return

        from models import AuditEvent
        async with _SessionLocal() as session:
            row = AuditEvent(
                org_id=        event.get("org_id"),
                user_id=       event["user_id"],
                action=        event["action"],
                resource_id=   event["resource_id"],
                resource_type= event["resource_type"],
                outcome=       event["outcome"],
                ip_address=    event.get("ip_address") or None,
                detail=        event.get("detail", {}),
            )
            session.add(row)
            await session.commit()

    except Exception as exc:
        log.warning("audit: DB write failed: %s", exc)


async def _write_siem(event: dict[str, Any]) -> None:
    """
    POST the event to a SIEM webhook.
    Supports Splunk HEC format (with Authorization: Splunk <token>)
    and generic JSON (Authorization: Bearer <token> or no auth).
    """
    try:
        headers = {"Content-Type": "application/json"}
        if _SIEM_TOKEN:
            # Splunk HEC uses "Splunk <token>", ELK/others use "Bearer <token>"
            prefix = "Splunk" if "splunk" in _SIEM_WEBHOOK_URL.lower() else "Bearer"
            headers["Authorization"] = f"{prefix} {_SIEM_TOKEN}"

        payload = json.dumps({"event": event, "sourcetype": "netdesign:audit"})

        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(_SIEM_WEBHOOK_URL, content=payload, headers=headers)
            if resp.status_code >= 400:
                log.warning("audit: SIEM webhook returned %s", resp.status_code)
    except Exception as exc:
        log.warning("audit: SIEM write failed: %s", exc)


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------

async def record_deploy(
    user_id: str,
    deployment_id: str,
    outcome: str,
    *,
    org_id: str | None = None,
    dry_run: bool,
    device_count: int,
    environment: str = "staging",
    ip_address: str = "",
) -> None:
    await record(
        user_id=user_id,
        action="deploy.push",
        resource_id=deployment_id,
        resource_type="deployment",
        outcome=outcome,
        org_id=org_id,
        ip_address=ip_address,
        detail={"dry_run": dry_run, "device_count": device_count, "environment": environment},
    )


async def record_config_gen(
    user_id: str,
    design_id: str,
    device_count: int,
    org_id: str | None = None,
) -> None:
    await record(
        user_id=user_id,
        action="config.generate",
        resource_id=design_id,
        resource_type="design",
        outcome="success",
        org_id=org_id,
        detail={"device_count": device_count},
    )


async def record_login(
    user_id: str,
    outcome: str,
    *,
    ip_address: str = "",
    method: str = "local",   # local | oidc | api_key
    org_id: str | None = None,
) -> None:
    await record(
        user_id=user_id,
        action="auth.login",
        resource_id=user_id,
        resource_type="user",
        outcome=outcome,
        org_id=org_id,
        ip_address=ip_address,
        detail={"method": method},
    )


async def record_approval(
    user_id: str,
    approval_id: str,
    action: str,      # approval.request | approval.approve | approval.reject
    outcome: str,
    org_id: str | None = None,
    ip_address: str = "",
) -> None:
    await record(
        user_id=user_id,
        action=action,
        resource_id=approval_id,
        resource_type="approval",
        outcome=outcome,
        org_id=org_id,
        ip_address=ip_address,
    )
