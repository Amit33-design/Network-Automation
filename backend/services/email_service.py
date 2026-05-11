"""
NetDesign AI — Resend transactional email service

Three email flows:
  1. purchase_confirmation  — license key + install guide after Stripe payment
  2. deploy_report          — success/failure report after a deployment run
  3. license_renewal_reminder — 30-day warning before expiry

All calls are async (httpx). Gracefully no-ops when RESEND_API_KEY is not set.
Resend free tier: 3,000 emails/mo — sufficient for 200+ active customers.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

import httpx

log = logging.getLogger("netdesign.email")

RESEND_API_KEY  = os.getenv("RESEND_API_KEY", "")
FROM_ADDRESS    = os.getenv("EMAIL_FROM", "NetDesign AI <noreply@netdesignai.com>")
BILLING_PORTAL  = os.getenv("STRIPE_BILLING_PORTAL_URL", "https://billing.stripe.com/p/login/netdesignai")

_enabled = bool(RESEND_API_KEY)
if not _enabled:
    log.warning("RESEND_API_KEY not set — transactional emails disabled")


async def _send(to: str, subject: str, html: str) -> bool:
    if not _enabled:
        log.info("Email suppressed (no RESEND_API_KEY): to=%s subject=%s", to, subject)
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": FROM_ADDRESS, "to": to, "subject": subject, "html": html},
            )
            resp.raise_for_status()
        log.info("Email sent: to=%s subject=%s", to, subject)
        return True
    except Exception as exc:
        log.error("Resend send failed: to=%s err=%s", to, exc)
        return False


# ── email templates ──────────────────────────────────────────────────────────

async def send_purchase_confirmation(
    to:          str,
    license_key: str,
    plan:        str,
    seats:       int,
    expires_at:  str,
) -> bool:
    expiry_fmt = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).strftime("%B %d, %Y")
    plan_label = {"pro": "Pro", "team": "Team 10-seat", "dept": "Department 50-seat"}.get(plan, plan.title())

    html = f"""
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e8e8f0;padding:32px;border-radius:8px">
      <div style="margin-bottom:24px">
        <span style="font-size:11px;font-weight:700;letter-spacing:.15em;color:#6b6b8a;text-transform:uppercase">NetDesign AI</span>
        <h1 style="margin:8px 0 0;font-size:22px;color:#fff">License activated — {plan_label}</h1>
      </div>
      <p style="color:#b0b0c8">Your license key:</p>
      <pre style="background:#111118;color:#00e5a0;padding:16px;border-radius:6px;font-size:20px;letter-spacing:3px;text-align:center">{license_key}</pre>
      <h3 style="color:#00e5a0;margin:24px 0 12px">How to activate</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #1e1e2e">
          <td style="padding:10px 0;color:#6b6b8a;font-size:12px;width:120px">Web app</td>
          <td style="padding:10px 0;font-size:12px">Sign in at <a href="https://app.netdesignai.com" style="color:#00e5a0">app.netdesignai.com</a> — your account is already upgraded.</td>
        </tr>
        <tr style="border-bottom:1px solid #1e1e2e">
          <td style="padding:10px 0;color:#6b6b8a;font-size:12px">Docker</td>
          <td style="padding:10px 0;font-size:12px">Add <code style="background:#111118;padding:2px 6px;border-radius:3px">NETDESIGN_LICENSE_KEY={license_key}</code> to your <code>.env</code> and restart.</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6b6b8a;font-size:12px">Desktop app</td>
          <td style="padding:10px 0;font-size:12px">Open Settings → License → paste key → Save.</td>
        </tr>
      </table>
      <div style="margin-top:24px;padding:16px;background:#111118;border-radius:6px;font-size:12px;color:#6b6b8a">
        Plan: <strong style="color:#e8e8f0">{plan_label}</strong> &nbsp;·&nbsp;
        Seats: <strong style="color:#e8e8f0">{seats}</strong> &nbsp;·&nbsp;
        Renews: <strong style="color:#e8e8f0">{expiry_fmt}</strong>
      </div>
      <p style="margin-top:24px;font-size:11px;color:#6b6b8a">Questions? Reply to this email. We respond within 4 hours on business days.</p>
    </div>
    """
    return await _send(to, f"Your NetDesign AI {plan_label} license key", html)


async def send_deploy_report(
    to:           str,
    design_name:  str,
    deployment_id: str,
    status:       str,           # "success" | "failed" | "partial"
    summary:      dict[str, Any],
) -> bool:
    icon  = {"success": "✅", "failed": "❌", "partial": "⚠️"}.get(status, "🔔")
    color = {"success": "#00e5a0", "failed": "#ff4d6d", "partial": "#ffb347"}.get(status, "#e8e8f0")

    rows_html = "".join(
        f'<tr><td style="padding:8px 12px;color:#6b6b8a;font-size:12px">{k}</td>'
        f'<td style="padding:8px 12px;font-size:12px">{v}</td></tr>'
        for k, v in summary.items()
    )

    html = f"""
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e8e8f0;padding:32px;border-radius:8px">
      <span style="font-size:11px;font-weight:700;letter-spacing:.15em;color:#6b6b8a;text-transform:uppercase">NetDesign AI · Deploy Report</span>
      <h1 style="margin:8px 0 24px;font-size:20px">{icon} {design_name} — {status.title()}</h1>
      <table style="width:100%;border-collapse:collapse;background:#111118;border-radius:6px">
        <tr style="border-bottom:1px solid #1e1e2e">
          <td style="padding:8px 12px;color:#6b6b8a;font-size:12px">Deployment ID</td>
          <td style="padding:8px 12px;font-size:12px;font-family:monospace">{deployment_id}</td>
        </tr>
        <tr style="border-bottom:1px solid #1e1e2e">
          <td style="padding:8px 12px;color:#6b6b8a;font-size:12px">Status</td>
          <td style="padding:8px 12px;font-size:12px;color:{color};font-weight:700">{status.upper()}</td>
        </tr>
        {rows_html}
      </table>
      <p style="margin-top:24px;font-size:12px;color:#6b6b8a">
        <a href="https://app.netdesignai.com/deployments/{deployment_id}" style="color:#00e5a0">View full report →</a>
      </p>
    </div>
    """
    subject = f"{icon} [{status.upper()}] Deploy: {design_name}"
    return await _send(to, subject, html)


async def send_renewal_reminder(
    to:          str,
    license_key: str,
    plan:        str,
    expires_at:  str,
    days_left:   int,
) -> bool:
    expiry_fmt = datetime.fromisoformat(expires_at.replace("Z", "+00:00")).strftime("%B %d, %Y")
    urgency    = "🔴 Urgent:" if days_left <= 7 else "⚠️"

    html = f"""
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;background:#0a0e1a;color:#e8e8f0;padding:32px;border-radius:8px">
      <h1 style="font-size:20px;margin-bottom:16px">{urgency} Your NetDesign AI license expires in {days_left} days</h1>
      <p style="color:#b0b0c8">Your <strong>{plan.title()}</strong> license expires on <strong>{expiry_fmt}</strong>.
         After expiry, config generation and deployment will be locked.</p>
      <div style="margin:24px 0">
        <a href="{BILLING_PORTAL}" style="display:inline-block;background:#00e5a0;color:#000;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:700">Renew now →</a>
      </div>
      <p style="font-size:12px;color:#6b6b8a">License: <code style="background:#111118;padding:2px 6px;border-radius:3px">{license_key}</code></p>
    </div>
    """
    return await _send(to, f"{urgency} NetDesign AI license expires in {days_left} days", html)
