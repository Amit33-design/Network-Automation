"""
Slack integration — webhook notifications for approvals and deployments.

Config keys (stored in IntegrationConfig.config):
  webhook_url   — Incoming Webhook URL (required)
  channel       — override channel (optional, e.g. #netops)
  mention_group — Slack group ID to @mention on new approvals (optional)
"""

from __future__ import annotations
import logging, os
from typing import Any
import httpx

log = logging.getLogger("netdesign.integrations.slack")


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
                    IntegrationConfig.provider == "slack",
                    IntegrationConfig.enabled == True,
                )
            )
            cfg = row.scalar_one_or_none()
            return cfg.config if cfg else None
    except Exception:
        return None


async def _post(webhook_url: str, blocks: list[dict]) -> None:
    async with httpx.AsyncClient(timeout=6.0) as client:
        resp = await client.post(webhook_url, json={"blocks": blocks})
        if resp.status_code != 200:
            log.warning("Slack webhook returned %s: %s", resp.status_code, resp.text[:200])


async def notify_approval_requested(approval, design, *, escalated: bool = False) -> None:
    cfg = await _get_config(approval.org_id)
    if not cfg:
        return

    verb   = "🚨 *Escalated*" if escalated else "🔔 *New approval request*"
    risk_emoji = "🔴" if approval.risk_score >= 75 else "🟡" if approval.risk_score >= 40 else "🟢"
    design_name = design.name if design else approval.design_id

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"NetDesign AI — Change Approval {'(Escalated)' if escalated else 'Requested'}"}},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Design:*\n{design_name}"},
            {"type": "mrkdwn", "text": f"*Environment:*\n`{approval.environment}`"},
            {"type": "mrkdwn", "text": f"*Risk Score:*\n{risk_emoji} {approval.risk_score}/100"},
            {"type": "mrkdwn", "text": f"*Devices affected:*\n{approval.device_count}"},
            {"type": "mrkdwn", "text": f"*Requested by:*\n{approval.requested_by}"},
            {"type": "mrkdwn", "text": f"*Expires:*\n{approval.expires_at.strftime('%Y-%m-%d %H:%M UTC') if approval.expires_at else 'never'}"},
        ]},
    ]
    if approval.summary:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Summary:*\n{approval.summary}"}})
    if cfg.get("mention_group"):
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"<!subteam^{cfg['mention_group']}> please review this change."}})

    blocks.append({"type": "actions", "elements": [
        {"type": "button", "text": {"type": "plain_text", "text": "✅ Approve"}, "style": "primary",
         "url": f"{os.environ.get('APP_URL','')}/approvals/{approval.id}"},
        {"type": "button", "text": {"type": "plain_text", "text": "❌ Reject"}, "style": "danger",
         "url": f"{os.environ.get('APP_URL','')}/approvals/{approval.id}"},
    ]})

    await _post(cfg["webhook_url"], blocks)


async def notify_approval_decided(approval, decision: str) -> None:
    cfg = await _get_config(approval.org_id)
    if not cfg:
        return

    emoji = "✅" if decision == "approved" else "❌"
    blocks = [
        {"type": "section", "text": {"type": "mrkdwn",
         "text": f"{emoji} *Approval {decision.upper()}* for deployment to `{approval.environment}`"}},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Reviewed by:*\n{approval.reviewed_by}"},
            {"type": "mrkdwn", "text": f"*Note:*\n{approval.reviewer_note or '—'}"},
        ]},
    ]
    await _post(cfg["webhook_url"], blocks)


async def notify_deploy_complete(deployment, outcome: str, org_id: str) -> None:
    cfg = await _get_config(org_id)
    if not cfg:
        return

    emoji = "🚀" if outcome == "success" else "💥"
    blocks = [
        {"type": "section", "text": {"type": "mrkdwn",
         "text": f"{emoji} *Deployment {outcome}* — `{deployment.environment}` ({deployment.id[:8]})"}},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Triggered by:*\n{deployment.triggered_by}"},
            {"type": "mrkdwn", "text": f"*Confidence:*\n{int((deployment.confidence_score or 0)*100)}%"},
            {"type": "mrkdwn", "text": f"*ITSM Ticket:*\n{deployment.itsm_ticket_url or '—'}"},
        ]},
    ]
    await _post(cfg["webhook_url"], blocks)
