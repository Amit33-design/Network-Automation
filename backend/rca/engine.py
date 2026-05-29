"""
Hypothesis-driven Root Cause Analysis engine.

Given a symptom string and a list of affected devices, correlates:
  - Live Prometheus telemetry (bgp_prefixes, pfc_drops, interface_errs, cpu_util)
  - Recent deployment history
  - Network topology (adjacency graph from sim_engine._build_graph)

Returns a ranked list of Hypothesis objects (highest confidence first).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Hypothesis:
    root_cause:           str
    confidence:           float          # 0.0 – 1.0
    evidence:             list[str]
    blast_radius:         list[str]
    remediation_steps:    list[str]
    automation_available: bool = False
    automation_playbook:  str | None = None

    def to_dict(self) -> dict:
        return {
            "root_cause":           self.root_cause,
            "confidence":           round(self.confidence, 2),
            "evidence":             self.evidence,
            "blast_radius":         self.blast_radius,
            "remediation_steps":    self.remediation_steps,
            "automation_available": self.automation_available,
            "automation_playbook":  self.automation_playbook,
        }


class RCAEngine:
    """Stateless RCA engine — reads live state on each analyze() call."""

    def analyze(
        self,
        symptom:          str,
        affected_devices: list[str],
        design_state:     dict[str, Any] | None = None,
        recent_deploys:   list[dict[str, Any]] | None = None,
    ) -> list[Hypothesis]:
        symptom_lc = symptom.lower()
        topology   = self._load_topology(design_state)
        metrics    = self._snapshot_metrics()
        deploys    = recent_deploys or []

        hypotheses: list[Hypothesis] = []
        hypotheses += self._check_bgp_session_loss(symptom_lc, affected_devices, metrics, topology)
        hypotheses += self._check_pfc_deadlock(symptom_lc, affected_devices, metrics, topology, design_state)
        hypotheses += self._check_recent_deployment(symptom_lc, affected_devices, deploys, topology)
        hypotheses += self._check_evpn_vxlan(symptom_lc, affected_devices, metrics, topology, design_state)
        hypotheses += self._check_underlay_failure(symptom_lc, affected_devices, metrics, topology)

        # Deduplicate by root_cause, keep highest confidence
        seen: dict[str, Hypothesis] = {}
        for h in hypotheses:
            if h.root_cause not in seen or h.confidence > seen[h.root_cause].confidence:
                seen[h.root_cause] = h

        return sorted(seen.values(), key=lambda h: h.confidence, reverse=True)

    # ── Hypothesis checkers ────────────────────────────────────────────────────

    def _check_bgp_session_loss(
        self,
        symptom: str,
        affected: list[str],
        metrics: dict,
        topology: dict,
    ) -> list[Hypothesis]:
        triggers = ("bgp" in symptom or "prefix" in symptom or "neighbor" in symptom or "session" in symptom)
        zero_prefix_hosts = {
            s["labels"].get("hostname")
            for s in metrics.get("bgp_prefixes", [])
            if s["value"] == 0 and s["labels"].get("hostname") in affected
        }

        if not triggers and not zero_prefix_hosts:
            return []

        confidence = 0.1
        evidence: list[str] = []

        if zero_prefix_hosts:
            confidence += 0.4
            for h in zero_prefix_hosts:
                evidence.append(f"{h}: BGP prefix count is zero")

        if "bgp" in symptom:
            confidence += 0.2
        if "prefix" in symptom or "neighbor" in symptom:
            confidence += 0.15

        if not evidence and triggers:
            evidence.append(f"Symptom matches BGP session loss pattern: '{symptom}'")

        return [Hypothesis(
            root_cause="BGP Session Loss",
            confidence=min(confidence, 1.0),
            evidence=evidence,
            blast_radius=self._blast_radius(affected, topology),
            remediation_steps=[
                "show bgp summary / show ip bgp neighbors",
                "Verify BGP neighbor timers and hold-time",
                "Check route-map policy changes",
                "Review interface status on peering links",
            ],
            automation_available=True,
            automation_playbook="playbooks/rca/bgp_session_restore.yml",
        )]

    def _check_pfc_deadlock(
        self,
        symptom: str,
        affected: list[str],
        metrics: dict,
        topology: dict,
        design_state: dict | None,
    ) -> list[Hypothesis]:
        triggers = ("pfc" in symptom or "gpu" in symptom or "rdma" in symptom or "roce" in symptom or "deadlock" in symptom)

        pfc_by_host: dict[str, float] = {}
        for s in metrics.get("pfc_drops_total", []):
            h = s["labels"].get("hostname")
            if h in affected:
                pfc_by_host[h] = pfc_by_host.get(h, 0.0) + s["value"]

        storm_hosts = {h for h, v in pfc_by_host.items() if v > 100}

        if not triggers and not storm_hosts:
            return []

        confidence = 0.1
        evidence: list[str] = []

        if storm_hosts:
            confidence += 0.5
            for h in storm_hosts:
                evidence.append(f"{h}: PFC watchdog drops = {int(pfc_by_host[h])}")

        if design_state and design_state.get("uc") == "gpu":
            confidence += 0.2
            evidence.append("Design is GPU/RDMA use case (PFC deadlock risk elevated)")

        if "pfc" in symptom:
            confidence += 0.15

        if not evidence:
            evidence.append(f"Symptom matches PFC/RDMA deadlock pattern: '{symptom}'")

        return [Hypothesis(
            root_cause="PFC Watchdog Deadlock",
            confidence=min(confidence, 1.0),
            evidence=evidence,
            blast_radius=self._blast_radius(affected, topology),
            remediation_steps=[
                "show pfc watchdog status",
                "Verify DCQCN / ECN configuration on lossless queues",
                "Check PFC priority groups and queue depths",
                "Consider temporarily disabling PFC watchdog to restore traffic",
            ],
            automation_available=True,
            automation_playbook="playbooks/rca/pfc_reset.yml",
        )]

    def _check_recent_deployment(
        self,
        symptom: str,
        affected: list[str],
        deploys: list[dict],
        topology: dict,
    ) -> list[Hypothesis]:
        if not deploys:
            return []

        cutoff = time.time() - 7200  # 2 hours
        recent = [
            d for d in deploys
            if _parse_ts(d.get("started_at", "")) > cutoff
        ]
        if not recent:
            return []

        confidence = 0.1
        evidence: list[str] = []

        for d in recent:
            status = d.get("status", "")
            dep_id = d.get("id", "unknown")[:8]
            if status == "failed":
                confidence += 0.5
                evidence.append(f"Deployment {dep_id} failed at {d.get('started_at', '?')}")
            elif status in ("rolled_back", "rollback_requested"):
                confidence += 0.3
                evidence.append(f"Deployment {dep_id} was rolled back")
            else:
                confidence += 0.1
                evidence.append(f"Deployment {dep_id} ran recently (status={status})")

        if not evidence:
            return []

        return [Hypothesis(
            root_cause="Recent Deployment Change",
            confidence=min(confidence, 1.0),
            evidence=evidence,
            blast_radius=self._blast_radius(affected, topology),
            remediation_steps=[
                "Review deployment diff (GET /api/deployments/{id}/diff)",
                "Check rollback status and post-check results",
                "Re-run post-deployment checks",
                "Consider triggering rollback if issue is confirmed",
            ],
            automation_available=True,
            automation_playbook="playbooks/rca/rollback_verify.yml",
        )]

    def _check_evpn_vxlan(
        self,
        symptom: str,
        affected: list[str],
        metrics: dict,
        topology: dict,
        design_state: dict | None,
    ) -> list[Hypothesis]:
        triggers = any(kw in symptom for kw in ("evpn", "vxlan", "vtep", "vni", "l2vpn", "overlay"))
        if not triggers:
            return []

        confidence = 0.2
        evidence: list[str] = []

        if design_state:
            protocols = design_state.get("protocols", [])
            if "EVPN" in protocols or "VXLAN" in protocols:
                confidence += 0.3
                evidence.append("Design uses EVPN/VXLAN overlay")

        spine_prefix_drops = [
            s for s in metrics.get("bgp_prefixes", [])
            if s["value"] == 0 and "SPINE" in (s["labels"].get("hostname", "")).upper()
        ]
        if spine_prefix_drops:
            confidence += 0.25
            for s in spine_prefix_drops:
                evidence.append(f"{s['labels']['hostname']}: zero BGP prefixes (potential RR issue)")

        if not evidence:
            evidence.append(f"Symptom matches EVPN/VXLAN fault pattern: '{symptom}'")

        return [Hypothesis(
            root_cause="EVPN/VXLAN Overlay Fault",
            confidence=min(confidence, 1.0),
            evidence=evidence,
            blast_radius=self._blast_radius(affected, topology),
            remediation_steps=[
                "show bgp l2vpn evpn summary",
                "Verify NVE interface and VTEP reachability",
                "Check VNI-to-VLAN bindings on all leaves",
                "Confirm route-reflector is advertising EVPN type-2/type-5 routes",
            ],
            automation_available=False,
        )]

    def _check_underlay_failure(
        self,
        symptom: str,
        affected: list[str],
        metrics: dict,
        topology: dict,
    ) -> list[Hypothesis]:
        triggers = any(kw in symptom for kw in ("ospf", "isis", "link", "interface", "flap", "underlay", "igp"))
        if not triggers:
            return []

        confidence = 0.15
        evidence: list[str] = []

        iface_errs: dict[str, float] = {}
        for s in metrics.get("interface_errs_total", []):
            h = s["labels"].get("hostname")
            if h in affected:
                iface_errs[h] = iface_errs.get(h, 0.0) + s["value"]

        for h, total in iface_errs.items():
            if total > 10:
                confidence += 0.3
                evidence.append(f"{h}: {int(total)} interface errors detected")

        spine_affected = [h for h in affected if "SPINE" in h.upper()]
        if len(spine_affected) >= 2:
            confidence += 0.2
            evidence.append(f"Multiple spine devices affected: {', '.join(spine_affected)}")

        if not evidence:
            evidence.append(f"Symptom matches underlay failure pattern: '{symptom}'")

        return [Hypothesis(
            root_cause="Underlay / IGP Failure",
            confidence=min(confidence, 1.0),
            evidence=evidence,
            blast_radius=self._blast_radius(affected, topology),
            remediation_steps=[
                "Check interface error counters and physical layer (SFP, cable)",
                "Verify OSPF/IS-IS adjacency state",
                "Confirm BFD sessions are up",
                "Review recent interface or cabling changes",
            ],
            automation_available=True,
            automation_playbook="playbooks/rca/underlay_check.yml",
        )]

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _blast_radius(self, affected: list[str], topology: dict[str, list[str]]) -> list[str]:
        visited  = set(affected)
        frontier = list(affected)
        for _ in range(2):
            next_frontier = []
            for node in frontier:
                for neighbor in topology.get(node, []):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_frontier.append(neighbor)
            frontier = next_frontier
        return sorted(visited)

    def _load_topology(self, design_state: dict | None) -> dict[str, list[str]]:
        if not design_state:
            return {}
        try:
            from sim_engine import _build_graph  # type: ignore
            return _build_graph(design_state)
        except Exception:
            return {}

    def _snapshot_metrics(self) -> dict:
        try:
            from telemetry.alerting import _collect_metrics
            return _collect_metrics()
        except Exception:
            return {}


def _parse_ts(ts: str) -> float:
    """Parse ISO timestamp to Unix float; returns 0 on failure."""
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.timestamp()
    except Exception:
        return 0.0
