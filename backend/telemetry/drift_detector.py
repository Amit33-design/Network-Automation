"""
Drift Detection — compare intended design state against live gNMI metrics.

The detector compares key parameters that NetDesign AI tracks at design time
(redundancy model, BGP, PFC, bandwidth tier, etc.) against what the live
telemetry collector is actually seeing from devices.

Usage:
    from telemetry.drift_detector import DriftDetector, DriftAlert, DriftSeverity

    detector = DriftDetector()
    alerts = detector.compare(intended_state, live_metrics)
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from typing import Any


class DriftSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    WARN     = "WARN"
    INFO     = "INFO"


@dataclass
class DriftAlert:
    check:          str
    severity:       DriftSeverity
    message:        str
    intended_value: Any
    observed_value: Any
    hostname:       str = "fabric"
    fired_at:       float = 0.0

    def __post_init__(self):
        if not self.fired_at:
            self.fired_at = time.time()

    def to_dict(self) -> dict:
        return {
            "check":          self.check,
            "severity":       self.severity.value,
            "message":        self.message,
            "intended_value": self.intended_value,
            "observed_value": self.observed_value,
            "hostname":       self.hostname,
            "fired_at":       self.fired_at,
        }


class DriftDetector:
    """
    Compares intended design state with a live metrics snapshot.

    Parameters
    ----------
    bgp_prefix_warn_pct : float
        Warn if live BGP prefix count is below this fraction of the intended count.
        Default 0.8 = warn if < 80% of expected prefixes are present.
    cpu_warn_pct : float
        Warn if CPU exceeds this percentage on any device. Default 75.0.
    pfc_storm_threshold : int
        CRITICAL drift if PFC drops exceed this value when design has PFC enabled.
    """

    def __init__(
        self,
        bgp_prefix_warn_pct: float = 0.8,
        cpu_warn_pct:        float = 75.0,
        pfc_storm_threshold: int   = 50,
    ):
        self.bgp_prefix_warn_pct  = bgp_prefix_warn_pct
        self.cpu_warn_pct         = cpu_warn_pct
        self.pfc_storm_threshold  = pfc_storm_threshold

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compare(
        self,
        intended_state: dict[str, Any],
        live_metrics:   dict[str, list[dict]],
    ) -> list[DriftAlert]:
        """
        Run all drift checks and return a list of DriftAlert objects.

        Parameters
        ----------
        intended_state : dict
            The design STATE object from the frontend (same shape as
            backend/routers/design.py uses: uc, redundancy, overlayProto,
            totalHosts, bwPerServer, compliance, etc.)
        live_metrics : dict
            Prometheus sample snapshot from alerting._collect_metrics()
            or gnmi_collector samples.  Keys are metric names, values are
            lists of {"labels": {...}, "value": float}.
        """
        alerts: list[DriftAlert] = []

        alerts.extend(self._check_redundancy(intended_state, live_metrics))
        alerts.extend(self._check_bgp(intended_state, live_metrics))
        alerts.extend(self._check_pfc(intended_state, live_metrics))
        alerts.extend(self._check_bandwidth(intended_state, live_metrics))
        alerts.extend(self._check_overlay(intended_state, live_metrics))
        alerts.extend(self._check_cpu(intended_state, live_metrics))

        return alerts

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def _check_redundancy(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """
        If design requires HA / Full redundancy, verify BGP session counts
        indicate multiple paths are up (each device should have ≥ 2 peers).
        """
        alerts = []
        redundancy = state.get("redundancy", "none")
        if redundancy not in ("ha", "full"):
            return alerts

        # Group BGP sessions by hostname — count peers with prefix_count > 0
        peers_up: dict[str, int] = {}
        for sample in metrics.get("bgp_prefixes", []):
            if sample["value"] > 0:
                h = sample["labels"].get("hostname", "unknown")
                peers_up[h] = peers_up.get(h, 0) + 1

        for hostname, count in peers_up.items():
            if count < 2:
                alerts.append(DriftAlert(
                    check="redundancy_bgp_peers",
                    severity=DriftSeverity.CRITICAL,
                    message=(
                        f"{hostname}: design requires {redundancy.upper()} redundancy "
                        f"but only {count} BGP peer(s) are active — single point of failure"
                    ),
                    intended_value=f"{redundancy} (≥2 peers)",
                    observed_value=f"{count} active peer(s)",
                    hostname=hostname,
                ))

        return alerts

    def _check_bgp(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """
        If EVPN/BGP is in the overlay protocol list, at least one device
        must have > 0 BGP prefixes.
        """
        alerts = []
        overlay = state.get("overlayProto", [])
        if not any(p.lower() in ("evpn", "bgp") for p in overlay):
            return alerts

        any_prefix = any(
            s["value"] > 0 for s in metrics.get("bgp_prefixes", [])
        )
        if not any_prefix and metrics.get("bgp_prefixes"):
            alerts.append(DriftAlert(
                check="bgp_prefix_drift",
                severity=DriftSeverity.CRITICAL,
                message=(
                    "Design specifies BGP/EVPN overlay but ALL BGP peers report "
                    "zero prefixes — possible session down or routing protocol not deployed"
                ),
                intended_value=f"overlay={overlay}",
                observed_value="0 BGP prefixes on all peers",
            ))

        return alerts

    def _check_pfc(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """
        AI Fabric / GPU designs require PFC (lossless).  If PFC drops are
        accumulating, the lossless guarantee is broken.
        """
        alerts = []
        uc = state.get("uc", "")
        proto_feats = state.get("protoFeatures", [])
        needs_pfc = (
            uc in ("gpu", "ai_fabric")
            or any("pfc" in f.lower() or "roce" in f.lower() for f in proto_feats)
        )
        if not needs_pfc:
            return alerts

        pfc_by_host: dict[str, float] = {}
        for sample in metrics.get("pfc_drops_total", []):
            h = sample["labels"].get("hostname", "unknown")
            pfc_by_host[h] = pfc_by_host.get(h, 0.0) + sample["value"]

        for hostname, drops in pfc_by_host.items():
            if drops > self.pfc_storm_threshold:
                alerts.append(DriftAlert(
                    check="pfc_lossless_drift",
                    severity=DriftSeverity.CRITICAL,
                    message=(
                        f"{hostname}: {int(drops)} PFC watchdog drops detected — "
                        f"lossless fabric requirement is drifting (design: PFC enabled)"
                    ),
                    intended_value=f"PFC enabled, drops=0",
                    observed_value=f"drops={int(drops)}",
                    hostname=hostname,
                ))

        return alerts

    def _check_bandwidth(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """
        Interface error rate as a proxy for bandwidth tier mismatch.
        If design specifies ≥100 GbE per server but error counters are high,
        the physical layer may not match the design intent.
        """
        alerts = []
        bw_tier = state.get("bwPerServer", "")
        high_bw = bw_tier in ("100g", "400g")
        if not high_bw:
            return alerts

        for sample in metrics.get("interface_errs_total", []):
            if sample["value"] > 100:
                hostname = sample["labels"].get("hostname", "unknown")
                iface    = sample["labels"].get("interface", "unknown")
                alerts.append(DriftAlert(
                    check="bandwidth_error_drift",
                    severity=DriftSeverity.WARN,
                    message=(
                        f"{hostname} {iface}: {int(sample['value'])} interface errors — "
                        f"possible link or optic issue on {bw_tier.upper()} interface "
                        f"(design intent: {bw_tier})"
                    ),
                    intended_value=f"bwPerServer={bw_tier}, errs≈0",
                    observed_value=f"errs={int(sample['value'])}",
                    hostname=hostname,
                ))

        return alerts

    def _check_overlay(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """
        If VXLAN is in overlay but BGP prefixes include no EVPN routes
        (heuristic: total prefix count very low per device), flag the drift.
        """
        alerts = []
        overlay = state.get("overlayProto", [])
        if "VXLAN" not in overlay and "vxlan" not in [p.lower() for p in overlay]:
            return alerts

        prefix_by_host: dict[str, float] = {}
        for sample in metrics.get("bgp_prefixes", []):
            h = sample["labels"].get("hostname", "unknown")
            prefix_by_host[h] = prefix_by_host.get(h, 0.0) + sample["value"]

        for hostname, count in prefix_by_host.items():
            if 0 < count < 10:
                alerts.append(DriftAlert(
                    check="vxlan_evpn_route_drift",
                    severity=DriftSeverity.WARN,
                    message=(
                        f"{hostname}: only {int(count)} BGP prefix(es) — VXLAN/EVPN "
                        f"overlay may not be fully converged (expected many EVPN type-2/3/5 routes)"
                    ),
                    intended_value="VXLAN EVPN overlay (many routes)",
                    observed_value=f"{int(count)} BGP prefix(es)",
                    hostname=hostname,
                ))

        return alerts

    def _check_cpu(
        self, state: dict, metrics: dict[str, list[dict]]
    ) -> list[DriftAlert]:
        """Cross-check CPU against design scale; large fabrics shouldn't be pegged."""
        alerts = []
        for sample in metrics.get("cpu_util", []):
            if sample["value"] > self.cpu_warn_pct:
                hostname = sample["labels"].get("hostname", "unknown")
                alerts.append(DriftAlert(
                    check="cpu_drift",
                    severity=DriftSeverity.WARN,
                    message=(
                        f"{hostname}: CPU at {sample['value']:.1f}% — "
                        f"exceeds drift threshold of {self.cpu_warn_pct}% "
                        f"(design: {state.get('orgSize','unknown')} org, "
                        f"{state.get('totalHosts','?')} hosts)"
                    ),
                    intended_value=f"CPU < {self.cpu_warn_pct}%",
                    observed_value=f"CPU={sample['value']:.1f}%",
                    hostname=hostname,
                ))
        return alerts
