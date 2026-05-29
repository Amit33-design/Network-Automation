"""
Microsoft Teams integration — Adaptive Card notifications via Incoming Webhook.

Config keys:
  webhook_url  — Teams channel Incoming Webhook URL (required)
"""

from __future__ import annotations
import logging
import httpx

log = logging.getLogger("netdesign.integrations.teams")


async def _get_config(org_id: str) -> dict | None:
    try:
        from db import _SessionLocal
        from models import IntegrationConfig
        from sqlalchemy import select
        if not _SessionLocal:
            return None
        async with _SessionLocal() as s:
            row = await s.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.org_id == org_id,
                    IntegrationConfig.provider == "teams",
                    IntegrationConfig.enabled == True,
                )
            )
            cfg = row.scalar_one_or_none()
            return cfg.config if cfg else None
    except Exception:
        return None


async def _post_card(webhook_url: str, card: dict) -> None:
    payload = {
        "type": "message",
        "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}],
    }
    async with httpx.AsyncClient(timeout=6.0) as client:
        resp = await client.post(webhook_url, json=payload)
        if resp.status_code not in (200, 202):
            log.warning("Teams webhook returned %s: %s", resp.status_code, resp.text[:200])


def _approval_card(approval, design, decision: str | None = None, escalated: bool = False) -> dict:
    risk_color = "attention" if approval.risk_score >= 75 else "warning" if approval.risk_score >= 40 else "good"
    design_name = getattr(design, "name", approval.design_id) if design else approval.design_id

    if decision:
        title = f"✅ Approved" if decision == "approved" else "❌ Rejected"
        body_facts = [
            {"title": "Reviewed by", "value": approval.reviewed_by or "—"},
            {"title": "Decision", "value": decision.upper()},
            {"title": "Note", "value": approval.reviewer_note or "—"},
        ]
    else:
        title = "🔔 Approval Requested" if not escalated else "🚨 Approval Escalated"
        body_facts = [
            {"title": "Design", "value": design_name},
            {"title": "Environment", "value": approval.environment},
            {"title": "Risk Score", "value": f"{approval.risk_score}/100"},
            {"title": "Devices", "value": str(approval.device_count)},
            {"title": "Requested by", "value": approval.requested_by},
        ]

    return {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            {"type": "TextBlock", "text": f"NetDesign AI — {title}", "weight": "Bolder", "size": "Medium"},
            {"type": "FactSet", "facts": body_facts},
            *([] if not approval.summary else [{"type": "TextBlock", "text": approval.summary, "wrap": True}]),
        ],
        "actions": [] if decision else [
            {"type": "Action.OpenUrl", "title": "Review Change",
             "url": f"{__import__('os').environ.get('APP_URL','')}/approvals/{approval.id}"},
        ],
    }


async def notify_approval_requested(approval, design, *, escalated: bool = False) -> None:
    cfg = await _get_config(approval.org_id)
    if not cfg:
        return
    await _post_card(cfg["webhook_url"], _approval_card(approval, design, escalated=escalated))


async def notify_approval_decided(approval, decision: str) -> None:
    cfg = await _get_config(approval.org_id)
    if not cfg:
        return
    await _post_card(cfg["webhook_url"], _approval_card(approval, None, decision=decision))


async def notify_deploy_complete(deployment, outcome: str, org_id: str) -> None:
    cfg = await _get_config(org_id)
    if not cfg:
        return

    color = "good" if outcome == "success" else "attention"
    card = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": [
            {"type": "TextBlock",
             "text": f"{'🚀 Deployment succeeded' if outcome == 'success' else '💥 Deployment FAILED'} — `{deployment.environment}`",
             "weight": "Bolder"},
            {"type": "FactSet", "facts": [
                {"title": "Deployment ID", "value": deployment.id[:12]},
                {"title": "Triggered by", "value": deployment.triggered_by},
                {"title": "Confidence", "value": f"{int((deployment.confidence_score or 0)*100)}%"},
            ]},
        ],
    }
    await _post_card(cfg["webhook_url"], card)
