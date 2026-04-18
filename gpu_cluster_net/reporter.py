"""Output formatters: text, JSON, HTML report for readiness results."""

from __future__ import annotations
import json
from typing import Union, List
from .readiness import ReadinessReport
from .checks.base import CheckStatus

_STATUS_EMOJI = {
    CheckStatus.PASS: "✅",
    CheckStatus.FAIL: "❌",
    CheckStatus.WARN: "⚠️ ",
    CheckStatus.SKIP: "⏭️ ",
    CheckStatus.ERROR: "💥",
}

_STATUS_COLOR = {
    "PASS": "#28a745",
    "FAIL": "#dc3545",
    "WARN": "#ffc107",
    "SKIP": "#6c757d",
    "ERROR": "#dc3545",
}


def to_text(report: ReadinessReport) -> str:
    lines = []
    lines.append("=" * 72)
    lines.append(f"  DC OPERATIONAL READINESS REPORT — {report.fabric_name.upper()}")
    lines.append(f"  Phase   : {report.phase.upper()}")
    lines.append(f"  Verdict : {report.verdict}")
    lines.append(f"  Started : {report.start_time}")
    lines.append(f"  Finished: {report.end_time}")
    lines.append(f"  Passed  : {report.total_passed}  "
                 f"Failed: {report.total_failed}  "
                 f"Warnings: {report.total_warnings}")
    lines.append("=" * 72)

    for suite in report.suites:
        status_icon = "✅ READY" if suite.is_ready else "❌ NOT READY"
        lines.append(f"\n  Device: {suite.device}  [{status_icon}]  "
                     f"({suite.passed}/{len(suite.results)} checks passed)")
        lines.append("  " + "-" * 60)

        for r in suite.results:
            icon = _STATUS_EMOJI.get(r.status, "?")
            lines.append(f"  {icon} [{r.status.value:<5}] {r.name:<35} {r.message[:50]}")
            if r.status in (CheckStatus.FAIL, CheckStatus.ERROR) and r.remediation:
                lines.append(f"         → Fix: {r.remediation[:80]}")

    lines.append("\n" + "=" * 72)
    lines.append(f"  VERDICT: {report.verdict}")
    lines.append("=" * 72)
    return "\n".join(lines)


def to_json(report: ReadinessReport, indent: int = 2) -> str:
    return json.dumps(report.to_dict(), indent=indent)


def to_html(report: ReadinessReport) -> str:
    verdict_color = "#28a745" if report.is_ready else "#dc3545"
    rows = ""

    for suite in report.suites:
        dev_status = "READY" if suite.is_ready else "NOT READY"
        dev_color = "#28a745" if suite.is_ready else "#dc3545"
        rows += f"""
        <tr style="background:#1e1e2e">
          <td colspan="5" style="color:{dev_color};font-weight:bold;padding:8px 12px">
            {suite.device} — {dev_status}
            ({suite.passed}/{len(suite.results)} passed,
             {suite.failed} failed, {suite.warnings} warnings)
          </td>
        </tr>"""

        for r in suite.results:
            color = _STATUS_COLOR.get(r.status.value, "#fff")
            fix = f'<br><small style="color:#aaa">→ {r.remediation}</small>' if r.remediation and r.failed else ""
            rows += f"""
        <tr>
          <td style="color:{color};text-align:center">{r.status.value}</td>
          <td>{r.name}</td>
          <td>{suite.device}</td>
          <td>{r.message}{fix}</td>
          <td style="text-align:right">{r.elapsed:.3f}s</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DC Readiness — {report.fabric_name}</title>
<style>
  body {{ background:#0d1117; color:#c9d1d9; font-family:monospace; margin:0; padding:20px }}
  h1 {{ color:#58a6ff }}
  .verdict {{ font-size:2em; font-weight:bold; color:{verdict_color}; padding:10px 0 }}
  .summary {{ background:#161b22; border:1px solid #30363d; border-radius:6px; padding:16px; margin:16px 0 }}
  table {{ width:100%; border-collapse:collapse; font-size:0.9em }}
  th {{ background:#161b22; color:#8b949e; padding:8px 12px; text-align:left; border-bottom:1px solid #30363d }}
  td {{ padding:6px 12px; border-bottom:1px solid #21262d }}
  tr:hover td {{ background:#161b22 }}
</style>
</head>
<body>
<h1>DC Operational Readiness — {report.fabric_name}</h1>
<div class="verdict">{report.verdict}</div>
<div class="summary">
  <strong>Phase:</strong> {report.phase.upper()} &nbsp;|&nbsp;
  <strong>Started:</strong> {report.start_time} &nbsp;|&nbsp;
  <strong>Finished:</strong> {report.end_time}<br><br>
  <strong style="color:#28a745">✅ Passed:</strong> {report.total_passed} &nbsp;&nbsp;
  <strong style="color:#dc3545">❌ Failed:</strong> {report.total_failed} &nbsp;&nbsp;
  <strong style="color:#ffc107">⚠️  Warnings:</strong> {report.total_warnings} &nbsp;&nbsp;
  <strong>Devices:</strong> {len(report.suites)}
</div>
<table>
  <thead>
    <tr>
      <th style="width:80px">Status</th>
      <th>Check</th>
      <th>Device</th>
      <th>Message / Fix</th>
      <th style="width:70px">Time</th>
    </tr>
  </thead>
  <tbody>{rows}</tbody>
</table>
</body>
</html>"""


def save(report: ReadinessReport, path: str, fmt: str = "text") -> None:
    formatters = {"text": to_text, "json": to_json, "html": to_html}
    if fmt not in formatters:
        raise ValueError(f"Unknown format '{fmt}'. Choose: text, json, html")
    content = formatters[fmt](report)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  Report saved: {path} ({fmt})")
