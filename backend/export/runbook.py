"""
Runbook / SOP auto-generator.

Produces a Markdown document (optionally converted to PDF via weasyprint)
covering:
  1. Change overview and risk summary
  2. Pre-deployment checklist
  3. Step-by-step deployment procedure per device layer
  4. Verification steps (post-checks)
  5. Rollback procedure
  6. Emergency contacts placeholder
  7. Appendix: generated config hashes
"""

from __future__ import annotations
import hashlib
from datetime import datetime, timezone
from typing import Any


def generate_runbook(
    design_state: dict[str, Any],
    approval,
    configs: dict[str, str],         # {hostname: config_text}
    ip_plan: dict | None = None,
    deployment_id: str = "",
) -> str:
    """Return a Markdown runbook string."""
    now    = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    org    = design_state.get("orgName", "Unknown Org")
    uc     = design_state.get("uc", "")
    env    = approval.environment if approval else "staging"
    risk   = approval.risk_score  if approval else 0
    devs   = approval.device_count if approval else len(configs)
    req_by = approval.requested_by if approval else "system"
    summary= approval.summary if approval else ""
    dep_id = deployment_id or "TBD"

    risk_label = "🔴 HIGH" if risk >= 75 else "🟡 MEDIUM" if risk >= 40 else "🟢 LOW"

    md = f"""# Network Change Runbook
**Organisation:** {org}
**Design:** {design_state.get('name', 'Unnamed')}
**Environment:** `{env}`
**Generated:** {now}
**Deployment ID:** `{dep_id}`
**Prepared by:** {req_by}

---

## 1. Change Overview

| Field | Value |
|---|---|
| Use Case | {uc.replace('_',' ').title()} |
| Risk Score | {risk}/100 ({risk_label}) |
| Devices in scope | {devs} |
| Redundancy model | {design_state.get('redundancy','—')} |
| Automation tool | {design_state.get('automation','—')} |
| Confidence score | {design_state.get('confidence_score', '—')} |

{f"**Change Summary:**" + chr(10) + summary if summary else ""}

---

## 2. Pre-Deployment Checklist

Complete all items before starting. Mark each ✅ when done.

- [ ] Change ticket approved in ITSM system
- [ ] Maintenance window confirmed with stakeholders
- [ ] Out-of-band (OOB) access verified for all devices in scope
- [ ] Config backup taken for each device (`show running-config` saved)
- [ ] Rollback procedure reviewed and understood
- [ ] Monitoring dashboards open (Grafana / SolarWinds / SNMP)
- [ ] Network team on standby during change window
- [ ] Downstream service owners notified (if traffic impact expected)
- [ ] Pre-checks passed in NetDesign AI deployment gate

---

## 3. Device Inventory

{_device_table(configs)}

---

## 4. Deployment Procedure

### 4.1 NetDesign AI Automated Deploy

> **Recommended:** Use the NetDesign AI deployment engine which handles
> ordering, pre-checks, backup, diff-push, and post-checks automatically.

```bash
# Trigger via API
curl -X POST {'{API_URL}'}/api/deploy \\
  -H "Authorization: Bearer {'{TOKEN}'}" \\
  -d '{{"design_id":"{design_state.get('id','<design_id>')}","environment":"{env}","dry_run":false}}'
```

Monitor progress at: `{'{APP_URL}'}/deployments/{dep_id}`

### 4.2 Manual Deployment Order

If deploying manually, follow this layer order to avoid traffic disruption:

{_deployment_order(design_state)}

### 4.3 Per-Device Steps

For each device:

1. Connect via SSH/console (verify OOB if primary path affected)
2. Verify current state: `show version`, `show interface status`
3. Take running-config backup: `show running-config > hostname.bak`
4. Apply configuration change (copy from generated config)
5. Verify change applied: `show running-config | section <changed-section>`
6. Run verification commands (see Section 5)
7. If issues: execute rollback (see Section 6)

---

## 5. Verification Steps

Run the following after each device change:

{_verification_steps(design_state)}

---

## 6. Rollback Procedure

### 6.1 Automated Rollback (NetDesign AI)

```bash
curl -X POST {'{API_URL}'}/api/deployments/{dep_id}/rollback \\
  -H "Authorization: Bearer {'{TOKEN}'}"
```

### 6.2 Manual Rollback

1. Connect to affected device via OOB
2. Restore from backup:
   ```
   configure replace flash:hostname.bak
   ```
   Or for NX-OS:
   ```
   rollback running-config file bootflash:hostname.bak
   ```
3. Verify routing/switching has recovered
4. Notify stakeholders of rollback
5. Open incident ticket with root cause

### 6.3 Rollback Decision Criteria

Initiate rollback if ANY of the following occur:
- BGP session count drops > 20% from pre-change baseline
- Interface error rate increases > 5x from baseline
- Application latency increases > 50ms
- Customer-impacting traffic loss > 0.1%
- Post-checks fail after 2 retries

---

## 7. Emergency Contacts

| Role | Name | Contact |
|---|---|---|
| Network Lead | *(fill in)* | *(phone/Slack)* |
| NOC On-call | *(fill in)* | *(pagerduty/phone)* |
| Vendor TAC | *(fill in)* | *(SR number)* |
| Change Manager | *(fill in)* | *(email)* |

---

## 8. Post-Change Sign-off

- [ ] All post-checks passed
- [ ] Monitoring shows normal baseline
- [ ] Change ticket closed in ITSM
- [ ] Deployment logged in NetDesign AI audit trail
- [ ] Runbook filed in team wiki

**Change completed at:** ______________________
**Completed by:** ______________________
**Change outcome:** ✅ Successful / ❌ Rolled back / ⚠️ Partially successful

---

## Appendix A: Config File Hashes

Verify configs were not modified between generation and deployment.

| Device | SHA-256 (first 16 chars) |
|---|---|
{_config_hashes(configs)}

---

*Generated by NetDesign AI — {now}*
"""
    return md


def _device_table(configs: dict[str, str]) -> str:
    if not configs:
        return "_No devices in scope._"
    rows = "\n".join(
        f"| `{h}` | — | — |" for h in sorted(configs.keys())
    )
    return f"| Device | Role | Platform |\n|---|---|---|\n{rows}"


def _deployment_order(state: dict) -> str:
    uc = state.get("uc", "")
    if uc in ("datacenter", "dc"):
        return (
            "1. **Firewalls** — verify HA state before and after\n"
            "2. **Spine switches** — one at a time; verify BGP reconverges\n"
            "3. **Leaf switches** — in pairs (same VPC/MLAG domain together)\n"
        )
    elif uc in ("gpu", "ai_fabric"):
        return (
            "1. **GPU Spine switches** — verify ECMP hashing\n"
            "2. **ToR (TOR) switches** — one rack at a time\n"
            "3. **Verify PFC/ECN** after each ToR change\n"
        )
    else:
        return (
            "1. **Firewalls** — verify HA state\n"
            "2. **Core switches** — one at a time; verify STP root unchanged\n"
            "3. **Distribution switches** — verify uplinks after each\n"
            "4. **Access switches** — batch by wiring closet\n"
        )


def _verification_steps(state: dict) -> str:
    uc = state.get("uc", "")
    steps = [
        "```",
        "show interface status                  # verify all expected ports up",
        "show ip bgp summary                    # verify all BGP peers Established",
        "show ip route summary                  # verify route count stable",
        "show spanning-tree summary             # verify no unexpected topology changes",
    ]
    if uc in ("datacenter", "dc"):
        steps += [
            "show nve peers                         # verify VTEP peers (VXLAN)",
            "show bgp l2vpn evpn summary            # verify EVPN sessions",
            "show vpc                               # verify vPC peer status (NX-OS)",
        ]
    elif uc in ("gpu", "ai_fabric"):
        steps += [
            "show interface counters qos            # verify PFC pause frame counts",
            "show queue statistics interface <iface> # verify no queue drops",
            "show roce counters                     # verify RoCEv2 traffic (if applicable)",
        ]
    steps.append("```")
    return "\n".join(steps)


def _config_hashes(configs: dict[str, str]) -> str:
    rows = []
    for hostname in sorted(configs.keys()):
        h = hashlib.sha256(configs[hostname].encode()).hexdigest()[:16]
        rows.append(f"| `{hostname}` | `{h}` |")
    return "\n".join(rows) if rows else "| — | — |"


def runbook_to_pdf(markdown_text: str) -> bytes:
    """Convert Markdown to PDF bytes using weasyprint (optional dependency)."""
    try:
        import markdown as md_lib
        from weasyprint import HTML
        html_body = md_lib.markdown(markdown_text, extensions=["tables", "fenced_code"])
        html_full = f"""<!DOCTYPE html><html><head>
        <meta charset="utf-8">
        <style>
          body {{ font-family: Arial, sans-serif; font-size: 12px; margin: 40px; }}
          h1 {{ color: #1a1a2e; }} h2 {{ color: #16213e; border-bottom: 1px solid #ccc; }}
          table {{ border-collapse: collapse; width: 100%; }}
          th, td {{ border: 1px solid #ddd; padding: 6px; text-align: left; }}
          th {{ background: #f2f2f2; }}
          code {{ background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }}
          pre {{ background: #f4f4f4; padding: 12px; border-radius: 4px; }}
        </style></head><body>{html_body}</body></html>"""
        return HTML(string=html_full).write_pdf()
    except ImportError:
        raise RuntimeError("weasyprint or markdown not installed — pip install weasyprint markdown")
