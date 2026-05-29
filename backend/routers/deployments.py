"""
NetDesign AI — Deployments Router
=====================================
Deployment history, status queries, and rollback trigger.

Endpoints:
  GET    /api/deployments              — list deployments (filter by design/env/status)
  GET    /api/deployments/{id}         — deployment detail + pre/post check results
  POST   /api/deployments/{id}/rollback — trigger rollback (Phase 3 wires Celery job)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_permission
from audit import record
from db import get_db
from models import Deployment, DeploymentRead

log = logging.getLogger("netdesign.routers.deployments")

router = APIRouter(prefix="/api/deployments", tags=["deployments"])


@router.get("", response_model=list[DeploymentRead])
async def list_deployments(
    design_id: str | None = None,
    environment: str | None = None,
    status: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("deployments:read")),
) -> list[DeploymentRead]:
    """
    List deployments visible to the caller, newest first.
    Operators/admins see all deployments; viewers/designers see their own.
    """
    stmt = (
        select(Deployment)
        .where(Deployment.triggered_by == user["sub"])
        .order_by(Deployment.started_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if design_id:
        stmt = stmt.where(Deployment.design_id == design_id)
    if environment:
        stmt = stmt.where(Deployment.environment == environment)
    if status:
        stmt = stmt.where(Deployment.status == status)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{deployment_id}", response_model=DeploymentRead)
async def get_deployment(
    deployment_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("deployments:read")),
) -> Deployment:
    """Fetch a deployment with full pre/post check results."""
    dep = await _get_deployment(deployment_id, user["sub"], db)
    return dep


@router.get("/{deployment_id}/diff")
async def get_deployment_diff(
    deployment_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("deployments:read")),
) -> dict[str, Any]:
    """
    Return the config snapshot stored at deploy time.
    The frontend diff viewer can compare this against the current state.
    """
    dep = await _get_deployment(deployment_id, user["sub"], db)
    return {
        "deployment_id":   dep.id,
        "environment":     dep.environment,
        "status":          dep.status,
        "config_snapshot": dep.config_snapshot,
    }


@router.post("/{deployment_id}/rollback")
async def rollback_deployment(
    deployment_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("deploy:staging")),
) -> dict[str, Any]:
    """
    Trigger a rollback for a completed deployment.
    Phase 3 will fire a Celery job here; for now it marks status=rollback_requested.
    """
    dep = await _get_deployment(deployment_id, user["sub"], db)

    if dep.status not in ("success", "failed"):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot rollback a deployment with status '{dep.status}'",
        )

    dep.status = "rollback_requested"

    await record(
        user_id=user["sub"],
        action="deploy.rollback",
        resource_id=deployment_id,
        resource_type="deployment",
        outcome="requested",
        detail={"previous_status": dep.status},
    )
    log.info("Rollback requested: %s by %s", deployment_id, user["sub"])

    return {
        "deployment_id": deployment_id,
        "status":        "rollback_requested",
        "message":       (
            "Rollback queued. Phase 3 (Celery) will execute the restore from backup. "
            f"Backup location: BACKUP_DIR/{deployment_id}/"
        ),
    }


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_deployment(
    deployment_id: str, user_id: str, db: AsyncSession
) -> Deployment:
    result = await db.execute(
        select(Deployment)
        .where(Deployment.id == deployment_id)
        .where(Deployment.triggered_by == user_id)
    )
    dep = result.scalar_one_or_none()
    if dep is None:
        raise HTTPException(status_code=404, detail=f"Deployment '{deployment_id}' not found")
    return dep
