"""
Anomaly detection via rolling z-score baselines over in-process telemetry
metrics.

Complements telemetry.alerting's static thresholds (CPU > 80%, memory > 90%,
etc.) with adaptive, baseline-driven detection: each (metric, label-set)
series accumulates a rolling window of recent samples, and a new sample is
flagged as an anomaly when it deviates by more than `z_threshold` standard
deviations from that series' rolling mean — useful for catching gradual
drift or sudden spikes that are still below a fixed alert threshold.
"""
from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass

DEFAULT_WINDOW = 20        # samples retained per series
DEFAULT_MIN_SAMPLES = 5    # minimum samples before z-scores are computed
DEFAULT_Z_THRESHOLD = 3.0  # |z| >= this is flagged as an anomaly


@dataclass
class Anomaly:
    hostname:         str
    metric:           str
    labels:           dict[str, str]
    value:            float
    baseline_mean:    float
    baseline_stddev:  float
    z_score:          float
    detected_at:      float

    def to_dict(self) -> dict:
        return {
            "hostname":        self.hostname,
            "metric":          self.metric,
            "labels":          self.labels,
            "value":           round(self.value, 3),
            "baseline_mean":   round(self.baseline_mean, 3),
            "baseline_stddev": round(self.baseline_stddev, 3),
            "z_score":         round(self.z_score, 2),
            "detected_at":     self.detected_at,
        }


def _series_key(metric_name: str, labels: dict[str, str]) -> tuple[str, tuple]:
    return (metric_name, tuple(sorted(labels.items())))


class AnomalyDetector:
    """
    Stateful rolling z-score anomaly detector.

    Call `observe(metrics)` on each telemetry poll. For every sample, if the
    series (identified by metric name + label set) already has at least
    `min_samples` prior observations, the new value's z-score is computed
    against that baseline; |z| >= `z_threshold` is reported as an Anomaly.
    The new value is then appended to the series' rolling window (capped at
    `window` samples) regardless of whether it was anomalous.
    """

    def __init__(
        self,
        window: int = DEFAULT_WINDOW,
        min_samples: int = DEFAULT_MIN_SAMPLES,
        z_threshold: float = DEFAULT_Z_THRESHOLD,
    ) -> None:
        self.window = window
        self.min_samples = min_samples
        self.z_threshold = z_threshold
        self._history: dict[tuple[str, tuple], deque[float]] = {}

    def reset(self) -> None:
        self._history.clear()

    def baseline(self, metric_name: str, labels: dict[str, str]) -> dict | None:
        """Current {mean, stddev, samples} for a series, or None if too few samples."""
        history = self._history.get(_series_key(metric_name, labels))
        if not history or len(history) < self.min_samples:
            return None
        mean = sum(history) / len(history)
        variance = sum((v - mean) ** 2 for v in history) / len(history)
        return {"mean": mean, "stddev": math.sqrt(variance), "samples": len(history)}

    def observe(self, metrics: dict[str, list[dict]]) -> list[Anomaly]:
        anomalies: list[Anomaly] = []
        now = time.time()

        for metric_name, samples in metrics.items():
            for sample in samples:
                labels = sample.get("labels", {})
                value = float(sample.get("value", 0.0))
                key = _series_key(metric_name, labels)
                history = self._history.setdefault(key, deque(maxlen=self.window))

                if len(history) >= self.min_samples:
                    mean = sum(history) / len(history)
                    variance = sum((v - mean) ** 2 for v in history) / len(history)
                    stddev = math.sqrt(variance)
                    if stddev > 0:
                        z = (value - mean) / stddev
                        if abs(z) >= self.z_threshold:
                            anomalies.append(Anomaly(
                                hostname=labels.get("hostname", "unknown"),
                                metric=metric_name,
                                labels=labels,
                                value=value,
                                baseline_mean=mean,
                                baseline_stddev=stddev,
                                z_score=z,
                                detected_at=now,
                            ))

                history.append(value)

        return anomalies


# Shared in-process detector — mirrors the module-level pattern used by
# telemetry.alerting (no DB, accumulates state across polls within a process).
_detector = AnomalyDetector()


def detect_anomalies(
    metrics: dict[str, list[dict]] | None = None,
    detector: AnomalyDetector | None = None,
) -> list[Anomaly]:
    """
    Run anomaly detection against a metric snapshot.

    Pass metrics=None to read the live in-process prometheus_client registry
    (via telemetry.alerting._collect_metrics). Pass a `detector` to use an
    isolated AnomalyDetector instance (e.g. in tests); otherwise the shared
    process-wide detector is used and updated.
    """
    if metrics is None:
        from telemetry.alerting import _collect_metrics
        metrics = _collect_metrics()

    d = detector or _detector
    return d.observe(metrics)


def reset_detector() -> None:
    """Clear the shared process-wide detector's history (e.g. between test runs)."""
    _detector.reset()
