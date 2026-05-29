"""
NetDesign AI — Organisations Router
=====================================
Endpoints:
  POST   /api/orgs                         — create org (admin only)
  GET    /api/orgs                         — list orgs the caller belongs to
  GET    /api/orgs/{org_id}                — get org detail
  PATCH  /api/orgs/{org_id}                — update org settings (admin)
  POST   /api/orgs/{org_id}/members/invite — invite a user by email
  GET    /api/orgs/{org_id}/members        — list members
  PATCH  /api/orgs/{org_id}/members/{uid}  — change member role
  DELETE /api/orgs/{org_id}/members/{uid}  — remove member
  GET    /api/orgs/{org_id}/audit          — paged audit log for this org
  GET    /api/orgs/{org_id}/audit/export   — JSONL audit export (enterprise)
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import Role, require_permission
from audit import record, record_login
from db import get_db
from models import (
    Org, OrgMember, UserProfile, AuditEvent,
    OrgCreate, OrgRead, OrgMemberInvite, OrgMemberRead, AuditEventRead,
)

router = APIRouter(prefix="/api/orgs", tags=["orgs"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _caller_org_role(members: list[OrgMember], user_id: str) -> str | None:
    for m in members:
        if m.user_id == user_id and m.is_active:
            return m.org_role
    return None


def _assert_org_admin(org: Org, user_id: str, payload: dict) -> None:
    """Raise 403 unless the caller is a system admin or org admin."""
    if payload.get("role") == Role.ADMIN:
        return
    role = _caller_org_role(org.members, user_id)
    if role != "admin":
        raise HTTPException(403, "Org admin role required")


# ---------------------------------------------------------------------------
# Create org
# ---------------------------------------------------------------------------

@router.post("", response_model=OrgRead, status_code=201)
async def create_org(
    body: OrgCreate,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    if not _SLUG_RE.match(body.slug):
        raise HTTPException(400, "Slug must be 3–50 lowercase alphanumeric/hyphen chars")

    existing = await db.execute(select(Org).where(Org.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Slug '{body.slug}' is already taken")

    org = Org(name=body.name, slug=body.slug, sso_domain=body.sso_domain)
    db.add(org)
    await db.flush()

    # Creator becomes org admin
    member = OrgMember(org_id=org.id, user_id=payload["sub"], org_role="admin")
    db.add(member)
    await db.commit()
    await db.refresh(org)

    await record(payload["sub"], "org.create", org.id, "org", "success",
                 org_id=org.id, detail={"slug": org.slug})
    return org


# ---------------------------------------------------------------------------
# List my orgs
# ---------------------------------------------------------------------------

@router.get("", response_model=list[OrgRead])
async def list_orgs(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    user_id = payload["sub"]
    rows = await db.execute(
        select(Org)
        .join(OrgMember, OrgMember.org_id == Org.id)
        .where(OrgMember.user_id == user_id, OrgMember.is_active == True, Org.is_active == True)
    )
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# Get single org
# ---------------------------------------------------------------------------

@router.get("/{org_id}", response_model=OrgRead)
async def get_org(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    org = await db.get(Org, org_id)
    if not org or not org.is_active:
        raise HTTPException(404, "Org not found")
    _assert_member(org, payload["sub"], payload)
    return org


def _assert_member(org: Org, user_id: str, payload: dict) -> None:
    if payload.get("role") == Role.ADMIN:
        return
    if not any(m.user_id == user_id and m.is_active for m in org.members):
        raise HTTPException(403, "Not a member of this org")


# ---------------------------------------------------------------------------
# Invite member
# ---------------------------------------------------------------------------

@router.post("/{org_id}/members/invite", response_model=OrgMemberRead, status_code=201)
async def invite_member(
    org_id: str,
    body: OrgMemberInvite,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:write")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_org_admin(org, payload["sub"], payload)

    # Look up user by email
    profile_row = await db.execute(
        select(UserProfile).where(UserProfile.email == body.email)
    )
    profile = profile_row.scalar_one_or_none()
    if not profile:
        raise HTTPException(404, f"No user with email '{body.email}'. They must log in once first.")

    # Check for existing membership
    existing = await db.execute(
        select(OrgMember).where(
            OrgMember.org_id == org_id,
            OrgMember.user_id == profile.user_id,
        )
    )
    member = existing.scalar_one_or_none()
    if member:
        if member.is_active:
            raise HTTPException(409, "User is already a member")
        member.is_active = True
        member.org_role  = body.org_role
        member.invited_by = payload["sub"]
    else:
        member = OrgMember(
            org_id=org_id,
            user_id=profile.user_id,
            org_role=body.org_role,
            invited_by=payload["sub"],
        )
        db.add(member)

    await db.commit()
    await db.refresh(member)

    await record(payload["sub"], "org.member_invite", org_id, "org", "success",
                 org_id=org_id, detail={"invited": profile.user_id, "role": body.org_role})
    return member


# ---------------------------------------------------------------------------
# List members
# ---------------------------------------------------------------------------

@router.get("/{org_id}/members", response_model=list[OrgMemberRead])
async def list_members(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_member(org, payload["sub"], payload)

    rows = await db.execute(
        select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.is_active == True)
    )
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# Change member role
# ---------------------------------------------------------------------------

@router.patch("/{org_id}/members/{user_id}", response_model=OrgMemberRead)
async def change_member_role(
    org_id: str,
    user_id: str,
    body: dict,   # {"org_role": "operator"}
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:write")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_org_admin(org, payload["sub"], payload)

    row = await db.execute(
        select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id)
    )
    member = row.scalar_one_or_none()
    if not member or not member.is_active:
        raise HTTPException(404, "Member not found")

    new_role = body.get("org_role", member.org_role)
    if new_role not in ("viewer", "designer", "operator", "admin"):
        raise HTTPException(400, f"Invalid role: {new_role}")

    member.org_role = new_role
    await db.commit()
    await db.refresh(member)

    await record(payload["sub"], "org.member_role_change", org_id, "org", "success",
                 org_id=org_id, detail={"target": user_id, "new_role": new_role})
    return member


# ---------------------------------------------------------------------------
# Remove member
# ---------------------------------------------------------------------------

@router.delete("/{org_id}/members/{user_id}", status_code=204)
async def remove_member(
    org_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:write")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_org_admin(org, payload["sub"], payload)

    if user_id == payload["sub"]:
        raise HTTPException(400, "Cannot remove yourself — transfer admin first")

    row = await db.execute(
        select(OrgMember).where(OrgMember.org_id == org_id, OrgMember.user_id == user_id)
    )
    member = row.scalar_one_or_none()
    if not member:
        raise HTTPException(404, "Member not found")

    member.is_active = False
    await db.commit()

    await record(payload["sub"], "org.member_remove", org_id, "org", "success",
                 org_id=org_id, detail={"removed": user_id})
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Audit log (paged)
# ---------------------------------------------------------------------------

@router.get("/{org_id}/audit", response_model=list[AuditEventRead])
async def get_audit_log(
    org_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
    action: str | None = None,
    user_id_filter: str | None = Query(None, alias="user_id"),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("audit:read")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_member(org, payload["sub"], payload)

    q = select(AuditEvent).where(AuditEvent.org_id == org_id)
    if action:
        q = q.where(AuditEvent.action.startswith(action))
    if user_id_filter:
        q = q.where(AuditEvent.user_id == user_id_filter)

    q = q.order_by(AuditEvent.timestamp.desc()).offset((page - 1) * per_page).limit(per_page)
    rows = await db.execute(q)
    return rows.scalars().all()


# ---------------------------------------------------------------------------
# Audit export (JSONL — enterprise feature)
# ---------------------------------------------------------------------------

@router.get("/{org_id}/audit/export")
async def export_audit_log(
    org_id: str,
    since: datetime | None = None,
    until: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("audit:read")),
):
    org = await db.get(Org, org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    _assert_org_admin(org, payload["sub"], payload)

    q = select(AuditEvent).where(AuditEvent.org_id == org_id)
    if since:
        q = q.where(AuditEvent.timestamp >= since)
    if until:
        q = q.where(AuditEvent.timestamp <= until)
    q = q.order_by(AuditEvent.timestamp.asc())

    rows = (await db.execute(q)).scalars().all()

    import json
    lines = [
        json.dumps({
            "id": r.id, "timestamp": r.timestamp.isoformat(),
            "user_id": r.user_id, "action": r.action,
            "resource_id": r.resource_id, "resource_type": r.resource_type,
            "outcome": r.outcome, "ip_address": r.ip_address, "detail": r.detail,
        })
        for r in rows
    ]

    await record(payload["sub"], "audit.export", org_id, "org", "success",
                 org_id=org_id, detail={"row_count": len(lines)})

    return Response(
        content="\n".join(lines),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="audit_{org_id}.jsonl"'},
    )
