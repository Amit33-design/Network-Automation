"""
NetDesign AI — Export Router
===============================
Endpoints:
  POST /api/export/drawio      — generate draw.io XML from design state
  POST /api/export/runbook     — generate Markdown runbook
  POST /api/export/runbook/pdf — generate PDF runbook (requires weasyprint)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from typing import Any

from auth import require_permission
from audit import record

router = APIRouter(prefix="/api/export", tags=["export"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class DrawioRequest(BaseModel):
    design_state: dict[str, Any]
    ip_plan:      dict[str, Any] | None = None

class RunbookRequest(BaseModel):
    design_state:  dict[str, Any]
    configs:       dict[str, str] = {}    # {hostname: config_text}
    ip_plan:       dict[str, Any] | None = None
    deployment_id: str = ""
    approval_id:   str | None = None      # optional — fetched from DB if provided


# ---------------------------------------------------------------------------
# draw.io export
# ---------------------------------------------------------------------------

@router.post("/drawio")
async def export_drawio(
    body: DrawioRequest,
    payload: dict = Depends(require_permission("designs:read")),
):
    from export.drawio import generate_drawio
    xml = generate_drawio(body.design_state, body.ip_plan)

    design_id = body.design_state.get("id", "design")
    org_name  = body.design_state.get("orgName", "network").replace(" ", "_")
    filename  = f"{org_name}_topology.drawio"

    await record(
        payload["sub"], "export.drawio", design_id, "design", "success",
        org_id=payload.get("org_id"),
        detail={"filename": filename},
    )

    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Runbook (Markdown)
# ---------------------------------------------------------------------------

@router.post("/runbook")
async def export_runbook(
    body: RunbookRequest,
    payload: dict = Depends(require_permission("designs:read")),
):
    approval = None
    if body.approval_id:
        try:
            from db import _SessionLocal
            from models import ApprovalRequest
            if _SessionLocal:
                async with _SessionLocal() as s:
                    approval = await s.get(ApprovalRequest, body.approval_id)
        except Exception:
            pass

    from export.runbook import generate_runbook
    md = generate_runbook(
        design_state=body.design_state,
        approval=approval,
        configs=body.configs,
        ip_plan=body.ip_plan,
        deployment_id=body.deployment_id,
    )

    design_id = body.design_state.get("id", "design")
    org_name  = body.design_state.get("orgName", "network").replace(" ", "_")
    filename  = f"{org_name}_runbook.md"

    await record(
        payload["sub"], "export.runbook", design_id, "design", "success",
        org_id=payload.get("org_id"),
        detail={"filename": filename, "device_count": len(body.configs)},
    )

    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Runbook (PDF)
# ---------------------------------------------------------------------------

@router.post("/runbook/pdf")
async def export_runbook_pdf(
    body: RunbookRequest,
    payload: dict = Depends(require_permission("designs:read")),
):
    approval = None
    if body.approval_id:
        try:
            from db import _SessionLocal
            from models import ApprovalRequest
            if _SessionLocal:
                async with _SessionLocal() as s:
                    approval = await s.get(ApprovalRequest, body.approval_id)
        except Exception:
            pass

    from export.runbook import generate_runbook, runbook_to_pdf
    md = generate_runbook(
        design_state=body.design_state,
        approval=approval,
        configs=body.configs,
        ip_plan=body.ip_plan,
        deployment_id=body.deployment_id,
    )

    try:
        pdf_bytes = runbook_to_pdf(md)
    except RuntimeError as exc:
        raise HTTPException(501, str(exc))

    org_name = body.design_state.get("orgName", "network").replace(" ", "_")
    filename = f"{org_name}_runbook.pdf"

    await record(
        payload["sub"], "export.runbook_pdf", body.design_state.get("id", "design"),
        "design", "success", org_id=payload.get("org_id"),
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
