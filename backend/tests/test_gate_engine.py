"""
Tests for gate_engine.py — two-phase policy evaluation engine.
"""
import pytest
from gate_engine import run_policies, PolicyResults, can_deploy, compute_confidence


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_state(**overrides):
    base = {
        "uc": "enterprise",
        "orgName": "TestCorp",
        "orgSize": "medium",
        "redundancy": "ha",
        "selectedProducts": {"access": "cat9200l"},
        "protocols":  ["ospf"],
        "security":   [],
        "compliance": [],
        "vlans": [{"id": 10, "name": "PROD", "gw": "10.0.10.1"}],
        "appFlows": [],
        "include_bgp_policy": True,
        "include_acl": True,
        "include_dot1x": False,
        "include_qos":   True,
        "include_aaa":   True,
    }
    base.update(overrides)
    return base


# ── PolicyResults shape ───────────────────────────────────────────────────────

class TestPolicyResultsShape:
    def test_run_policies_returns_policy_results(self):
        result = run_policies(_make_state())
        assert isinstance(result, PolicyResults)

    def test_gate_status_is_valid(self):
        result = run_policies(_make_state())
        assert result.gate_status in ("PASS", "WARN", "FAIL", "BLOCK", "PENDING")

    def test_resolved_state_is_dict(self):
        result = run_policies(_make_state())
        assert isinstance(result.resolved_state, dict)

    def test_violations_is_list(self):
        result = run_policies(_make_state())
        assert isinstance(result.violations, list)

    def test_does_not_mutate_caller_state(self):
        state = _make_state()
        original_vlans = list(state["vlans"])
        run_policies(state)
        assert state["vlans"] == original_vlans


# ── Blocking rules ────────────────────────────────────────────────────────────

class TestBlockingRules:
    def test_no_products_selected_blocks(self):
        state  = _make_state(selectedProducts={})
        result = run_policies(state)
        assert result.gate_status == "BLOCK"
        assert len(result.blocks) > 0

    def test_vlan_id_out_of_range_fires(self):
        state  = _make_state(vlans=[{"id": 5000, "name": "BAD"}])
        result = run_policies(state)
        # Rule fires as BLOCK or FAIL depending on YAML/hardcoded definition
        assert result.gate_status in ("BLOCK", "FAIL", "WARN") or \
               any(v["id"] in ("vlan-range", "vlan-id-range") for v in result.violations + result.blocks)

    def test_duplicate_vlan_ids_fire(self):
        state  = _make_state(vlans=[
            {"id": 10, "name": "A"},
            {"id": 10, "name": "B"},
        ])
        result = run_policies(state)
        assert result.gate_status in ("BLOCK", "FAIL", "WARN") or \
               any("duplicate" in str(v).lower() for v in result.violations + result.blocks)


# ── Passing state ─────────────────────────────────────────────────────────────

class TestPassingState:
    def test_valid_enterprise_state_passes(self):
        result = run_policies(_make_state())
        assert result.gate_status in ("PASS", "WARN")

    def test_valid_dc_state_passes(self):
        state = {
            "uc": "dc",
            "orgName": "DCCorp",
            "orgSize": "large",
            "redundancy": "ha",
            "selectedProducts": {"dc-spine": "nexus-9336c"},
            "protocols": ["bgp", "evpn"],
            "security": [],
            "compliance": [],
            "vlans": [{"id": 100, "name": "SERVERS"}],
            "appFlows": [],
        }
        result = run_policies(state)
        assert result.gate_status not in ("BLOCK",)


# ── AUTO_FIX phase ────────────────────────────────────────────────────────────

class TestAutoFix:
    def test_auto_fix_does_not_crash(self):
        """AUTO_FIX rules must not raise even on edge-case inputs."""
        state  = _make_state(protocols=[])
        result = run_policies(state)
        assert result.gate_status in ("PASS", "WARN", "FAIL", "BLOCK")

    def test_fixes_list_is_list(self):
        result = run_policies(_make_state())
        assert isinstance(result.fixes, list)


# ── compute_confidence ────────────────────────────────────────────────────────

class TestComputeConfidence:
    def test_returns_dict_with_score(self):
        result = run_policies(_make_state())
        out    = compute_confidence(result)
        assert isinstance(out, dict)
        assert "score" in out
        assert 0 <= out["score"] <= 100

    def test_has_label_and_breakdown(self):
        result = run_policies(_make_state())
        out    = compute_confidence(result)
        assert "label" in out
        assert "breakdown" in out
        assert isinstance(out["breakdown"], list)

    def test_blocked_state_has_lower_score(self):
        good_result    = run_policies(_make_state())
        blocked_result = run_policies(_make_state(selectedProducts={}))
        good_score    = compute_confidence(good_result)["score"]
        blocked_score = compute_confidence(blocked_result)["score"]
        assert good_score >= blocked_score

    def test_pending_sims_and_prechecks_default_partial_score(self):
        result = run_policies(_make_state())
        out    = compute_confidence(result, sim_severity="PENDING", precheck_status="PENDING")
        assert out["score"] > 0


# ── can_deploy ────────────────────────────────────────────────────────────────

class TestCanDeploy:
    def test_passing_state_returns_dict_with_allowed(self):
        state  = _make_state()
        result = run_policies(state)
        out    = can_deploy(result)
        assert isinstance(out, dict)
        assert "allowed" in out

    def test_blocked_state_not_allowed(self):
        state  = _make_state(selectedProducts={})
        result = run_policies(state)
        out    = can_deploy(result)
        assert out["allowed"] is False

    def test_blocked_state_has_blockers_list(self):
        state  = _make_state(selectedProducts={})
        result = run_policies(state)
        out    = can_deploy(result)
        assert isinstance(out.get("blockers"), list)
        assert len(out["blockers"]) > 0
