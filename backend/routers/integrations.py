"""
NetDesign AI — Integrations Router
=====================================
Manage per-org integration configs and trigger on-demand actions.

Endpoints:
  GET    /api/integrations                        — list configured integrations
  POST   /api/integrations                        — upsert integration config
  DELETE /api/integrations/{provider}             — remove integration
  POST   /api/integrations/test/{provider}        — send a test notification
  POST   /api/integrations/netbox/sync-devices    — push device inventory to Netbox
  GET    /api/integrations/netbox/prefix          — get next available prefix
  POST   /api/integrations/gitops/commit          — commit configs to Git
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_permission
from audit import record
from db import get_db
from models import IntegrationConfig, IntegrationConfigCreate, IntegrationConfigRead

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

_VALID_PROVIDERS = {"slack", "teams", "servicenow", "jira", "netbox", "gitops"}


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=list[IntegrationConfigRead])
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    org_id = _org(payload)
    rows = await db.execute(
        select(IntegrationConfig).where(IntegrationConfig.org_id == org_id)
    )
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# Upsert (create or update)
# ---------------------------------------------------------------------------

@router.post("", response_model=IntegrationConfigRead, status_code=201)
async def upsert_integration(
    body: IntegrationConfigCreate,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    org_id = _org(payload)
    if body.provider not in _VALID_PROVIDERS:
        raise HTTPException(400, f"Unknown provider '{body.provider}'. Valid: {sorted(_VALID_PROVIDERS)}")

    row = await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.org_id == org_id,
            IntegrationConfig.provider == body.provider,
        )
    )
    cfg = row.scalar_one_or_none()

    if cfg:
        cfg.config  = body.config
        cfg.enabled = body.enabled
    else:
        cfg = IntegrationConfig(org_id=org_id, provider=body.provider,
                                config=body.config, enabled=body.enabled)
        db.add(cfg)

    await db.commit()
    await db.refresh(cfg)

    await record(payload["sub"], "integration.upsert", org_id, "integration", "success",
                 org_id=org_id, detail={"provider": body.provider})
    return cfg


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{provider}", status_code=204)
async def delete_integration(
    provider: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    org_id = _org(payload)
    row = await db.execute(
        select(IntegrationConfig).where(
            IntegrationConfig.org_id == org_id,
            IntegrationConfig.provider == provider,
        )
    )
    cfg = row.scalar_one_or_none()
    if not cfg:
        raise HTTPException(404, f"Integration '{provider}' not found")
    await db.delete(cfg)
    await db.commit()
    await record(payload["sub"], "integration.delete", org_id, "integration", "success",
                 org_id=org_id, detail={"provider": provider})


# ---------------------------------------------------------------------------
# Test notification
# ---------------------------------------------------------------------------

@router.post("/test/{provider}")
async def test_integration(
    provider: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    org_id = _org(payload)

    class _FakeApproval:
        id = "test-approval-id"
        org_id = org_id
        environment = "staging"
        risk_score  = 42
        device_count = 8
        requested_by = payload["sub"]
        summary = "This is a test notification from NetDesign AI."
        reviewer_note = ""
        reviewed_by = None
        expires_at = None
        itsm_ticket_id  = None
        itsm_ticket_url = None

    try:
        if provider == "slack":
            from integrations.slack import notify_approval_requested
            await notify_approval_requested(_FakeApproval(), None)
        elif provider == "teams":
            from integrations.teams import notify_approval_requested
            await notify_approval_requested(_FakeApproval(), None)
        elif provider == "servicenow":
            from integrations.servicenow import create_change_ticket
            sid, url = await create_change_ticket(_FakeApproval(), None)
            return {"ok": True, "ticket_id": sid, "url": url}
        elif provider == "jira":
            from integrations.jira import create_change_issue
            key, url = await create_change_issue(_FakeApproval(), None)
            return {"ok": True, "issue_key": key, "url": url}
        elif provider == "netbox":
            from integrations.netbox import get_available_prefix
            pfx = await get_available_prefix(org_id, "10.0.0.0/8", 24)
            return {"ok": True, "next_available_prefix": pfx}
        elif provider == "gitops":
            return {"ok": True, "note": "GitOps test: no commit performed. Check config with /api/integrations"}
        else:
            raise HTTPException(400, f"Unknown provider: {provider}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Test failed: {exc}")

    return {"ok": True, "message": f"Test notification sent via {provider}"}


# ---------------------------------------------------------------------------
# Netbox — sync devices
# ---------------------------------------------------------------------------

@router.post("/netbox/sync-devices")
async def netbox_sync_devices(
    body: dict,   # {"devices": [...]}
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:write")),
):
    org_id = _org(payload)
    from integrations.netbox import sync_devices
    errors = await sync_devices(org_id, body.get("devices", []))
    await record(payload["sub"], "integration.trigger", org_id, "integration", "success" if not errors else "partial",
                 org_id=org_id, detail={"provider": "netbox", "errors": errors[:5]})
    return {"synced": len(body.get("devices", [])), "errors": errors}


# ---------------------------------------------------------------------------
# Netbox — next available prefix
# ---------------------------------------------------------------------------

@router.get("/netbox/prefix")
async def netbox_next_prefix(
    within: str,
    prefix_length: int = 24,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    org_id = _org(payload)
    from integrations.netbox import get_available_prefix
    prefix = await get_available_prefix(org_id, within, prefix_length)
    if not prefix:
        raise HTTPException(404, f"No available /{prefix_length} prefix within {within}")
    return {"prefix": prefix}


# ---------------------------------------------------------------------------
# GitOps — commit configs
# ---------------------------------------------------------------------------

@router.post("/gitops/commit")
async def gitops_commit(
    body: dict,   # {"design_id", "design_name", "configs": {hostname: text}}
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("configs:generate")),
):
    org_id = _org(payload)
    from integrations.gitops import commit_configs
    result = await commit_configs(
        org_id=org_id,
        design_id=body.get("design_id", ""),
        design_name=body.get("design_name", "design"),
        configs=body.get("configs", {}),
        commit_message=body.get("message", ""),
    )
    outcome = "failed" if "error" in result else "success"
    await record(payload["sub"], "integration.trigger", org_id, "integration", outcome,
                 org_id=org_id, detail={"provider": "gitops", **result})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _org(payload: dict) -> str:
    org_id = payload.get("org_id")
    if not org_id:
        raise HTTPException(400, "org_id missing from token — call POST /api/auth/switch-org first")
    return org_id
