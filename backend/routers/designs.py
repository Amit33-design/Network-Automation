"""
NetDesign AI — Design CRUD Router
====================================
Manages network design state persistence.

Endpoints:
  GET    /api/designs          — list current user's designs (paginated)
  POST   /api/designs          — create a new design, return {id, name}
  GET    /api/designs/{id}     — fetch full design state
  PUT    /api/designs/{id}     — update design state (partial OK)
  DELETE /api/designs/{id}     — soft-delete (sets is_deleted=True)
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
from models import Design, DesignCreate, DesignRead

log = logging.getLogger("netdesign.routers.designs")

router = APIRouter(prefix="/api/designs", tags=["designs"])


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=list[DesignRead])
async def list_designs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, le=200),
    use_case: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:read")),
) -> list[DesignRead]:
    """List designs owned by the current user, newest first."""
    stmt = (
        select(Design)
        .where(Design.owner_id == user["sub"])
        .where(Design.is_deleted == False)  # noqa: E712
        .order_by(Design.updated_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if use_case:
        stmt = stmt.where(Design.use_case == use_case)

    result = await db.execute(stmt)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=DesignRead, status_code=201)
async def create_design(
    body: DesignCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> Design:
    """
    Persist a new design and return its {id}.
    The frontend calls this at the end of Step 4 (Design) to get a stable ID
    for subsequent generate-configs and deploy calls.
    """
    design = Design(
        name=body.name,
        owner_id=user["sub"],
        use_case=body.use_case,
        state=body.state,
    )
    db.add(design)
    await db.flush()   # get the auto-generated id before commit

    await record(
        user_id=user["sub"],
        action="design.create",
        resource_id=design.id,
        resource_type="design",
        outcome="success",
        detail={"name": design.name, "use_case": design.use_case},
    )
    log.info("Design created: %s by %s", design.id, user["sub"])
    return design


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

@router.get("/{design_id}", response_model=DesignRead)
async def get_design(
    design_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:read")),
) -> Design:
    """Fetch full design state including ip_plan, vlan_plan, bgp_design."""
    design = await _get_owned(design_id, user["sub"], db)
    return design


@router.get("/{design_id}/state")
async def get_design_state(
    design_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:read")),
) -> dict[str, Any]:
    """Return just the raw state dict — used by the wizard to restore mid-session."""
    design = await _get_owned(design_id, user["sub"], db)
    return {
        "id":         design.id,
        "state":      design.state,
        "ip_plan":    design.ip_plan,
        "vlan_plan":  design.vlan_plan,
        "bgp_design": design.bgp_design,
    }


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@router.put("/{design_id}", response_model=DesignRead)
async def update_design(
    design_id: str,
    body: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> Design:
    """
    Partial update — only fields present in the request body are written.
    Accepts any subset of: name, state, ip_plan, vlan_plan, bgp_design.
    """
    design = await _get_owned(design_id, user["sub"], db)

    allowed = {"name", "state", "ip_plan", "vlan_plan", "bgp_design"}
    for field, value in body.items():
        if field in allowed:
            setattr(design, field, value)

    await record(
        user_id=user["sub"],
        action="design.update",
        resource_id=design_id,
        resource_type="design",
        outcome="success",
        detail={"updated_fields": list(body.keys())},
    )
    log.info("Design updated: %s by %s", design_id, user["sub"])
    return design


# ---------------------------------------------------------------------------
# Soft-delete
# ---------------------------------------------------------------------------

@router.delete("/{design_id}", status_code=204)
async def delete_design(
    design_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> None:
    """Soft-delete a design. The record is retained for audit purposes."""
    design = await _get_owned(design_id, user["sub"], db)
    design.is_deleted = True

    await record(
        user_id=user["sub"],
        action="design.delete",
        resource_id=design_id,
        resource_type="design",
        outcome="success",
        detail={},
    )
    log.info("Design soft-deleted: %s by %s", design_id, user["sub"])


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_owned(design_id: str, user_id: str, db: AsyncSession) -> Design:
    result = await db.execute(
        select(Design)
        .where(Design.id == design_id)
        .where(Design.owner_id == user_id)
        .where(Design.is_deleted == False)  # noqa: E712
    )
    design = result.scalar_one_or_none()
    if design is None:
        raise HTTPException(status_code=404, detail=f"Design '{design_id}' not found")
    return design
