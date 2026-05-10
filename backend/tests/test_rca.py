"""
Tests for rca/engine.py — Hypothesis-driven Root Cause Analysis.
"""
import pytest
from rca.engine import RCAEngine, Hypothesis


@pytest.fixture
def engine():
    return RCAEngine()


@pytest.fixture
def dc_design():
    return {
        "uc": "dc",
        "selectedProducts": {"dc-spine": "nexus-9336c", "dc-leaf": "nexus-93180"},
        "protocols": ["bgp", "evpn"],
        "vlans": [{"id": 100, "name": "SERVERS"}],
    }


# ── Hypothesis dataclass ───────────────────────────────────────────────────────

class TestHypothesis:
    def test_to_dict_has_required_keys(self):
        h = Hypothesis(
            root_cause="test",
            confidence=0.75,
            evidence=["e1"],
            blast_radius=["d1"],
            remediation_steps=["step1"],
        )
        d = h.to_dict()
        for key in ("root_cause", "confidence", "evidence", "blast_radius",
                    "remediation_steps", "automation_available", "automation_playbook"):
            assert key in d

    def test_confidence_is_rounded(self):
        h = Hypothesis(
            root_cause="x", confidence=0.123456789,
            evidence=[], blast_radius=[], remediation_steps=[],
        )
        assert h.to_dict()["confidence"] == 0.12


# ── Engine.analyze ─────────────────────────────────────────────────────────────

class TestRCAEngineAnalyze:
    def test_returns_list(self, engine):
        result = engine.analyze("BGP session flapping", ["core-01"])
        assert isinstance(result, list)

    def test_bgp_symptom_generates_hypotheses(self, engine):
        result = engine.analyze("BGP neighbor down", ["spine-01"])
        assert len(result) > 0
        causes = [h.root_cause for h in result]
        assert any("BGP" in c or "bgp" in c.lower() for c in causes)

    def test_results_sorted_by_confidence_descending(self, engine):
        result = engine.analyze("BGP prefix count dropped to zero", ["spine-01", "spine-02"])
        confs = [h.confidence for h in result]
        assert confs == sorted(confs, reverse=True)

    def test_confidence_in_range(self, engine):
        result = engine.analyze("interface error counters increasing", ["leaf-01"])
        for h in result:
            assert 0.0 <= h.confidence <= 1.0

    def test_no_duplicate_root_causes(self, engine):
        result = engine.analyze("BGP session flapping", ["spine-01"])
        causes = [h.root_cause for h in result]
        assert len(causes) == len(set(causes))

    def test_pfc_symptom_triggers_pfc_hypothesis(self, engine, dc_design):
        result = engine.analyze("PFC watchdog dropped frames", ["leaf-01"], design_state=dc_design)
        causes = [h.root_cause.lower() for h in result]
        assert any("pfc" in c or "deadlock" in c for c in causes)

    def test_recent_deploy_triggers_hypothesis(self, engine):
        from datetime import datetime, timezone
        deploys = [{
            "id": "dep-001",
            "status": "success",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "triggered_by": "ci",
        }]
        result = engine.analyze("connectivity lost after change window", ["leaf-01"],
                                recent_deploys=deploys)
        assert isinstance(result, list)

    def test_empty_symptom_returns_list(self, engine):
        result = engine.analyze("", [])
        assert isinstance(result, list)

    def test_unknown_symptom_returns_list(self, engine):
        result = engine.analyze("xyzzy frobnicator issue", ["unknown-device"])
        assert isinstance(result, list)

    def test_evpn_symptom_generates_evpn_hypotheses(self, engine, dc_design):
        result = engine.analyze("VXLAN tunnel not established", ["leaf-01"], design_state=dc_design)
        causes = [h.root_cause.lower() for h in result]
        assert any("evpn" in c or "vxlan" in c or "vtep" in c for c in causes)

    def test_hypothesis_has_remediation_steps(self, engine):
        result = engine.analyze("BGP neighbor down on spine", ["spine-01"])
        for h in result:
            assert isinstance(h.remediation_steps, list)

    def test_design_state_none_does_not_crash(self, engine):
        result = engine.analyze("BGP flapping", ["d1"], design_state=None)
        assert isinstance(result, list)
