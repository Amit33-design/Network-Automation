"""
NetDesign AI — Change Approval Workflow
=========================================
Human-in-the-loop gate before production deployments.

Lifecycle:
  designer/operator calls POST /api/approvals     → status=pending
  ↓  notification sent to Slack/Teams/ITSM
  admin/operator calls POST /api/approvals/{id}/approve or /reject
  ↓  audit logged; deployment status updated
  deployment engine checks approval_id before executing

Endpoints:
  POST   /api/approvals                  — request approval for a design→env
  GET    /api/approvals                  — list pending/recent (org-scoped)
  GET    /api/approvals/{id}             — detail
  POST   /api/approvals/{id}/approve     — approve (operator/admin)
  POST   /api/approvals/{id}/reject      — reject (operator/admin)
  POST   /api/approvals/{id}/escalate    — escalate (bump risk, re-notify)
  DELETE /api/approvals/{id}             — cancel (requester only, while pending)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import Role, require_permission
from audit import record, record_approval
from db import get_db
from models import (
    ApprovalRequest, Deployment, Design, Org, OrgMember,
    ApprovalRequestCreate, ApprovalRequestRead, ApprovalDecision,
)

router = APIRouter(prefix="/api/approvals", tags=["approvals"])

_APPROVAL_TTL_HOURS = int(__import__("os").environ.get("APPROVAL_TTL_HOURS", "72"))


# ---------------------------------------------------------------------------
# Request approval
# ---------------------------------------------------------------------------

@router.post("", response_model=ApprovalRequestRead, status_code=201)
async def request_approval(
    body: ApprovalRequestCreate,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("configs:generate")),
):
    user_id = payload["sub"]
    org_id  = payload.get("org_id")

    design = await db.get(Design, body.design_id)
    # Design may not be persisted to DB yet (frontend-only designs) — allow it
    if design and org_id and design.org_id and design.org_id != org_id:
        raise HTTPException(403, "Design belongs to a different org")

    # Block if there is already a pending approval for this design+env
    existing = await db.execute(
        select(ApprovalRequest).where(
            ApprovalRequest.design_id == body.design_id,
            ApprovalRequest.environment == body.environment,
            ApprovalRequest.status == "pending",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "A pending approval already exists for this design and environment")

    expires_at = datetime.utcnow() + timedelta(hours=_APPROVAL_TTL_HOURS)

    approval = ApprovalRequest(
        org_id=       org_id or design.org_id,
        design_id=    body.design_id,
        requested_by= user_id,
        environment=  body.environment,
        summary=      body.summary,
        risk_score=   body.risk_score,
        device_count= body.device_count,
        expires_at=   expires_at,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    await record_approval(user_id, approval.id, "approval.request", "success",
                          org_id=approval.org_id)

    # Fire integration notifications (non-blocking)
    await _notify_approval_requested(approval, design)

    return approval


# ---------------------------------------------------------------------------
# List approvals (org-scoped, filterable by status)
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ApprovalRequestRead])
async def list_approvals(
    status: str | None = Query(None, description="pending|approved|rejected|expired"),
    environment: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("approvals:read")),
):
    org_id = payload.get("org_id")

    q = select(ApprovalRequest)
    if org_id:
        q = q.where(ApprovalRequest.org_id == org_id)
    if status:
        q = q.where(ApprovalRequest.status == status)
    if environment:
        q = q.where(ApprovalRequest.environment == environment)

    # Auto-expire stale pending approvals
    now = datetime.utcnow()
    expired_q = select(ApprovalRequest).where(
        ApprovalRequest.status == "pending",
        ApprovalRequest.expires_at < now,
    )
    if org_id:
        expired_q = expired_q.where(ApprovalRequest.org_id == org_id)
    expired = (await db.execute(expired_q)).scalars().all()
    for a in expired:
        a.status = "expired"
    if expired:
        await db.commit()

    q = q.order_by(ApprovalRequest.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).scalars().all()
    return rows


# ---------------------------------------------------------------------------
# Get single approval
# ---------------------------------------------------------------------------

@router.get("/{approval_id}", response_model=ApprovalRequestRead)
async def get_approval(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("approvals:read")),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")
    _assert_approval_access(approval, payload)
    return approval


# ---------------------------------------------------------------------------
# Approve
# ---------------------------------------------------------------------------

@router.post("/{approval_id}/approve", response_model=ApprovalRequestRead)
async def approve(
    approval_id: str,
    body: ApprovalDecision,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("deploy:staging")),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")
    _assert_approval_access(approval, payload)

    if approval.status != "pending":
        raise HTTPException(409, f"Approval is already '{approval.status}' — cannot approve again")

    # Requester cannot self-approve (4-eyes principle)
    if approval.requested_by == payload["sub"] and payload.get("role") != Role.ADMIN:
        raise HTTPException(403, "Requester cannot self-approve (4-eyes policy)")

    now = datetime.utcnow()
    if approval.expires_at and now > approval.expires_at:
        approval.status = "expired"
        await db.commit()
        raise HTTPException(409, "Approval has expired — request a new one")

    approval.status      = "approved"
    approval.reviewed_by = payload["sub"]
    approval.reviewed_at = now
    approval.reviewer_note = body.note

    # Activate the linked deployment if it exists
    dep_row = await db.execute(
        select(Deployment).where(Deployment.approval_id == approval_id)
    )
    deployment = dep_row.scalar_one_or_none()
    if deployment and deployment.status == "pending_approval":
        deployment.status = "approved"

    await db.commit()
    await db.refresh(approval)

    await record_approval(payload["sub"], approval_id, "approval.approve", "success",
                          org_id=approval.org_id)
    await _notify_approval_decided(approval, "approved")
    return approval


# ---------------------------------------------------------------------------
# Reject
# ---------------------------------------------------------------------------

@router.post("/{approval_id}/reject", response_model=ApprovalRequestRead)
async def reject(
    approval_id: str,
    body: ApprovalDecision,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("deploy:staging")),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")
    _assert_approval_access(approval, payload)

    if approval.status != "pending":
        raise HTTPException(409, f"Approval is already '{approval.status}'")

    approval.status      = "rejected"
    approval.reviewed_by = payload["sub"]
    approval.reviewed_at = datetime.utcnow()
    approval.reviewer_note = body.note

    dep_row = await db.execute(
        select(Deployment).where(Deployment.approval_id == approval_id)
    )
    deployment = dep_row.scalar_one_or_none()
    if deployment:
        deployment.status = "rejected"

    await db.commit()
    await db.refresh(approval)

    await record_approval(payload["sub"], approval_id, "approval.reject", "success",
                          org_id=approval.org_id)
    await _notify_approval_decided(approval, "rejected")
    return approval


# ---------------------------------------------------------------------------
# Escalate
# ---------------------------------------------------------------------------

@router.post("/{approval_id}/escalate", response_model=ApprovalRequestRead)
async def escalate(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("configs:generate")),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")

    if approval.status != "pending":
        raise HTTPException(409, f"Cannot escalate '{approval.status}' approval")

    # Extend TTL + boost risk score
    approval.expires_at = datetime.utcnow() + timedelta(hours=_APPROVAL_TTL_HOURS)
    approval.risk_score = min(100, approval.risk_score + 20)
    await db.commit()
    await db.refresh(approval)

    await record_approval(payload["sub"], approval_id, "approval.escalate", "success",
                          org_id=approval.org_id)
    await _notify_approval_requested(approval, None, escalated=True)
    return approval


# ---------------------------------------------------------------------------
# Cancel
# ---------------------------------------------------------------------------

@router.delete("/{approval_id}", status_code=204)
async def cancel_approval(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("configs:generate")),
):
    approval = await db.get(ApprovalRequest, approval_id)
    if not approval:
        raise HTTPException(404, "Approval not found")

    if approval.requested_by != payload["sub"] and payload.get("role") != Role.ADMIN:
        raise HTTPException(403, "Only the requester or an admin can cancel")

    if approval.status != "pending":
        raise HTTPException(409, f"Cannot cancel '{approval.status}' approval")

    approval.status = "cancelled"
    await db.commit()

    await record_approval(payload["sub"], approval_id, "approval.cancel", "success",
                          org_id=approval.org_id)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_approval_access(approval: ApprovalRequest, payload: dict) -> None:
    org_id = payload.get("org_id")
    if payload.get("role") == Role.ADMIN:
        return
    if org_id and approval.org_id != org_id:
        raise HTTPException(403, "Not in the same org")


async def _notify_approval_requested(
    approval: ApprovalRequest,
    design: Design | None,
    escalated: bool = False,
) -> None:
    """Fire integration notifications — errors are swallowed."""
    try:
        from integrations.slack import notify_approval_requested
        await notify_approval_requested(approval, design, escalated=escalated)
    except Exception:
        pass
    try:
        from integrations.servicenow import create_change_ticket
        ticket_id, ticket_url = await create_change_ticket(approval, design)
        if ticket_id:
            # Store back (best-effort; commit already done above so we don't re-commit here)
            approval.itsm_ticket_id  = ticket_id
            approval.itsm_ticket_url = ticket_url
    except Exception:
        pass


async def _notify_approval_decided(approval: ApprovalRequest, decision: str) -> None:
    try:
        from integrations.slack import notify_approval_decided
        await notify_approval_decided(approval, decision)
    except Exception:
        pass
    try:
        from integrations.servicenow import update_change_ticket
        await update_change_ticket(approval.itsm_ticket_id, decision, approval.reviewer_note or "")
    except Exception:
        pass
