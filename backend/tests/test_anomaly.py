"""
Tests for telemetry/anomaly.py — rolling z-score anomaly detection.
"""
import pytest

from telemetry.anomaly import AnomalyDetector, Anomaly, detect_anomalies, reset_detector


def _sample(value: float, hostname: str = "leaf-01") -> dict:
    return {"labels": {"hostname": hostname, "interface": "eth0"}, "value": value}


@pytest.fixture
def detector():
    return AnomalyDetector(window=20, min_samples=5, z_threshold=3.0)


# ── Anomaly dataclass ──────────────────────────────────────────────────────────

class TestAnomaly:
    def test_to_dict_has_required_keys(self):
        a = Anomaly(
            hostname="leaf-01", metric="cpu_util", labels={"hostname": "leaf-01"},
            value=99.0, baseline_mean=20.0, baseline_stddev=2.0, z_score=39.5,
            detected_at=1234.5,
        )
        d = a.to_dict()
        for key in ("hostname", "metric", "labels", "value", "baseline_mean",
                     "baseline_stddev", "z_score", "detected_at"):
            assert key in d

    def test_numeric_fields_are_rounded(self):
        a = Anomaly(
            hostname="leaf-01", metric="cpu_util", labels={},
            value=1.23456, baseline_mean=2.34567, baseline_stddev=0.123456,
            z_score=3.14159, detected_at=1.0,
        )
        d = a.to_dict()
        assert d["value"] == 1.235
        assert d["baseline_mean"] == 2.346
        assert d["baseline_stddev"] == 0.123
        assert d["z_score"] == 3.14


# ── AnomalyDetector.observe ───────────────────────────────────────────────────

class TestAnomalyDetectorObserve:
    def test_no_anomalies_until_min_samples_reached(self, detector):
        # First 4 observations of a stable series — below min_samples=5.
        for _ in range(4):
            anomalies = detector.observe({"cpu_util": [_sample(20.0)]})
            assert anomalies == []

    def test_no_anomaly_for_stable_series(self, detector):
        # Feed a stable baseline, then a value within normal variance.
        for v in [20.0, 21.0, 19.0, 20.5, 19.5, 20.2]:
            anomalies = detector.observe({"cpu_util": [_sample(v)]})
        assert anomalies == []

    def test_flags_spike_far_from_baseline(self, detector):
        # Establish a tight baseline around ~20 with small variance.
        for v in [20.0, 20.1, 19.9, 20.05, 19.95, 20.0, 20.1]:
            detector.observe({"cpu_util": [_sample(v)]})
        # A sudden spike to 99 should be flagged as anomalous.
        anomalies = detector.observe({"cpu_util": [_sample(99.0)]})
        assert len(anomalies) == 1
        a = anomalies[0]
        assert a.metric == "cpu_util"
        assert a.hostname == "leaf-01"
        assert a.value == 99.0
        assert abs(a.z_score) >= 3.0

    def test_zero_variance_baseline_does_not_divide_by_zero(self, detector):
        # Identical values give stddev=0 — must not raise and must not flag.
        for _ in range(8):
            anomalies = detector.observe({"cpu_util": [_sample(20.0)]})
        assert anomalies == []

    def test_window_caps_history_length(self, detector):
        for i in range(50):
            detector.observe({"cpu_util": [_sample(20.0 + (i % 2))]})
        history = detector._history[("cpu_util", (("hostname", "leaf-01"), ("interface", "eth0")))]
        assert len(history) == detector.window

    def test_separate_label_sets_tracked_independently(self, detector):
        for v in [20.0, 20.1, 19.9, 20.05, 19.95, 20.0]:
            detector.observe({"cpu_util": [_sample(v, hostname="leaf-01")]})
        # A different hostname has no baseline yet — first sample never anomalous.
        anomalies = detector.observe({"cpu_util": [_sample(99.0, hostname="leaf-02")]})
        assert anomalies == []


# ── AnomalyDetector.baseline ──────────────────────────────────────────────────

class TestAnomalyDetectorBaseline:
    def test_returns_none_below_min_samples(self, detector):
        detector.observe({"cpu_util": [_sample(20.0)]})
        assert detector.baseline("cpu_util", {"hostname": "leaf-01", "interface": "eth0"}) is None

    def test_returns_mean_and_stddev_once_warmed_up(self, detector):
        for v in [10.0, 20.0, 30.0, 20.0, 20.0]:
            detector.observe({"cpu_util": [_sample(v)]})
        b = detector.baseline("cpu_util", {"hostname": "leaf-01", "interface": "eth0"})
        assert b is not None
        assert b["samples"] == 5
        assert b["mean"] == pytest.approx(20.0)
        assert b["stddev"] > 0


# ── reset ──────────────────────────────────────────────────────────────────────

class TestAnomalyDetectorReset:
    def test_reset_clears_history(self, detector):
        for v in [20.0, 20.1, 19.9, 20.05, 19.95]:
            detector.observe({"cpu_util": [_sample(v)]})
        detector.reset()
        assert detector.baseline("cpu_util", {"hostname": "leaf-01", "interface": "eth0"}) is None


# ── detect_anomalies (module-level helper) ────────────────────────────────────

class TestDetectAnomalies:
    def test_uses_provided_detector_without_touching_shared_state(self):
        reset_detector()
        local = AnomalyDetector(window=20, min_samples=5, z_threshold=3.0)
        for v in [20.0, 20.1, 19.9, 20.05, 19.95, 20.0]:
            detect_anomalies({"cpu_util": [_sample(v)]}, detector=local)
        anomalies = detect_anomalies({"cpu_util": [_sample(99.0)]}, detector=local)
        assert len(anomalies) == 1
        # Shared detector untouched.
        from telemetry.anomaly import _detector
        assert _detector.baseline("cpu_util", {"hostname": "leaf-01", "interface": "eth0"}) is None

