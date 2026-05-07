"""
Alert rule evaluation against live in-process Prometheus metrics.

Does not query the Prometheus HTTP API; reads directly from the
prometheus_client registry so it works without a running Prometheus server.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from typing import Any


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    WARN     = "WARN"
    INFO     = "INFO"


@dataclass
class Alert:
    hostname:     str
    check:        str
    severity:     Severity
    message:      str
    metric_value: float
    fired_at:     float

    def to_dict(self) -> dict:
        return {
            "hostname":     self.hostname,
            "check":        self.check,
            "severity":     self.severity.value,
            "message":      self.message,
            "metric_value": self.metric_value,
            "fired_at":     self.fired_at,
        }


def _collect_metrics() -> dict[str, list[dict]]:
    """Read current sample values from the in-process prometheus_client registry."""
    try:
        from prometheus_client import REGISTRY
    except ImportError:
        return {}

    samples: dict[str, list[dict]] = {}
    for metric in REGISTRY.collect():
        for sample in metric.samples:
            samples.setdefault(sample.name, []).append({
                "labels": dict(sample.labels),
                "value":  sample.value,
            })
    return samples


def evaluate(metrics: dict[str, list[dict]] | None = None) -> list[Alert]:
    """
    Evaluate alert rules against a metric snapshot.
    Pass metrics=None to use the live in-process registry.
    """
    if metrics is None:
        metrics = _collect_metrics()

    alerts: list[Alert] = []
    now = time.time()

    # Rule 1: BGP prefix count == 0 → CRITICAL
    for sample in metrics.get("bgp_prefixes", []):
        if sample["value"] == 0:
            hostname = sample["labels"].get("hostname", "unknown")
            peer     = sample["labels"].get("peer", "unknown")
            alerts.append(Alert(
                hostname=hostname,
                check="bgp_prefix_zero",
                severity=Severity.CRITICAL,
                message=f"{hostname}: BGP prefix count dropped to zero (peer={peer})",
                metric_value=0.0,
                fired_at=now,
            ))

    # Rule 2: CPU > 80% → WARN
    for sample in metrics.get("cpu_util", []):
        if sample["value"] > 80:
            hostname = sample["labels"].get("hostname", "unknown")
            alerts.append(Alert(
                hostname=hostname,
                check="cpu_high",
                severity=Severity.WARN,
                message=f"{hostname}: CPU utilization {sample['value']:.1f}% exceeds 80% threshold",
                metric_value=sample["value"],
                fired_at=now,
            ))

    # Rule 3: PFC watchdog drops > 100 → CRITICAL (aggregated per hostname)
    pfc_by_host: dict[str, float] = {}
    for sample in metrics.get("pfc_drops_total", []):
        h = sample["labels"].get("hostname", "unknown")
        pfc_by_host[h] = pfc_by_host.get(h, 0.0) + sample["value"]
    for hostname, total in pfc_by_host.items():
        if total > 100:
            alerts.append(Alert(
                hostname=hostname,
                check="pfc_storm",
                severity=Severity.CRITICAL,
                message=f"{hostname}: PFC watchdog drops {int(total)} exceed 100 threshold",
                metric_value=total,
                fired_at=now,
            ))

    # Rule 4: Interface error total > 50 → WARN (per hostname+interface)
    iface_errs: dict[tuple, float] = {}
    for sample in metrics.get("interface_errs_total", []):
        key = (
            sample["labels"].get("hostname", "unknown"),
            sample["labels"].get("interface", "unknown"),
        )
        iface_errs[key] = iface_errs.get(key, 0.0) + sample["value"]
    for (hostname, iface), total in iface_errs.items():
        if total > 50:
            alerts.append(Alert(
                hostname=hostname,
                check="interface_error_rate",
                severity=Severity.WARN,
                message=f"{hostname} {iface}: interface error count {int(total)} exceeds 50",
                metric_value=total,
                fired_at=now,
            ))

    # Rule 5: Memory > 90% → CRITICAL
    for sample in metrics.get("mem_util", []):
        if sample["value"] > 90:
            hostname = sample["labels"].get("hostname", "unknown")
            alerts.append(Alert(
                hostname=hostname,
                check="memory_high",
                severity=Severity.CRITICAL,
                message=f"{hostname}: memory utilization {sample['value']:.1f}% exceeds 90% threshold",
                metric_value=sample["value"],
                fired_at=now,
            ))

    return alerts
