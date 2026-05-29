"""
NetDesign AI — Deployment Gate Engine (Python)
================================================
Python port of the frontend gate.js + policyengine.js.

Provides:
  • Policy rule evaluation against a design state
  • AUTO_FIX, SUGGEST, WARN, FAIL, BLOCK action types
  • Two-phase evaluation (AUTO_FIX first → then evaluate all rules)
  • Confidence score computation (0–100)
  • Deployment gate decision (can_deploy / blockers)

All functions are pure (no I/O).  The MCP server calls this directly.
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

_RULES_YAML = Path(__file__).parent / "policies" / "rules.yaml"


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class PolicyRule:
    id:          str
    name:        str
    description: str
    severity:    str          # BLOCK | FAIL | WARN | INFO | PASS
    action_type: str          # BLOCK | FAIL | AUTO_FIX | SUGGEST | NOOP
    priority:    int          # lower = evaluated first in AUTO_FIX phase
    condition:   Callable[[dict[str, Any]], bool]   # True = rule fires
    apply:       Callable[[dict[str, Any]], None] | None = None  # AUTO_FIX mutator
    message_fn:  Callable[[dict[str, Any]], str] | None = None


@dataclass
class PolicyResults:
    violations: list[dict] = field(default_factory=list)  # FAIL / BLOCK
    warnings:   list[dict] = field(default_factory=list)  # WARN
    infos:      list[dict] = field(default_factory=list)  # INFO
    fixes:      list[dict] = field(default_factory=list)  # AUTO_FIX applied
    blocks:     list[dict] = field(default_factory=list)  # BLOCK
    gate_status: str = "PENDING"   # PASS | WARN | FAIL | BLOCK
    resolved_state: dict = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Rule definitions
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# YAML-driven rule loader with DSL compiler
# ─────────────────────────────────────────────────────────────────────────────

def _get_field(state: dict, field_path: str) -> Any:
    """Navigate dotted field path; returns None if not found."""
    parts = field_path.split(".")
    obj: Any = state
    for p in parts:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(p)
    return obj


def _eval_leaf(state: dict, node: dict) -> bool:
    field_path = node["field"]
    op         = node["op"]
    value      = node.get("value")
    actual     = _get_field(state, field_path)

    if op == "eq":
        return actual == value
    if op == "neq":
        return actual != value
    if op == "contains":
        return isinstance(actual, (list, str)) and value in actual
    if op == "not_contains":
        return not (isinstance(actual, (list, str)) and value in actual)
    if op == "in":
        return actual in (value or [])
    if op == "not_in":
        return actual not in (value or [])
    if op == "gt":
        return isinstance(actual, (int, float)) and actual > value
    if op == "lt":
        return isinstance(actual, (int, float)) and actual < value
    if op == "is_empty":
        return not actual  # None, [], {}, "" all falsy
    if op == "is_not_empty":
        return bool(actual)
    return False


def _compile_condition(node: dict) -> Callable[[dict], bool]:
    if "all" in node:
        children = [_compile_condition(c) for c in node["all"]]
        return lambda s, ch=children: all(c(s) for c in ch)
    if "any" in node:
        children = [_compile_condition(c) for c in node["any"]]
        return lambda s, ch=children: any(c(s) for c in ch)
    if "not" in node:
        child = _compile_condition(node["not"])
        return lambda s, c=child: not c(s)
    # leaf node
    captured = dict(node)
    return lambda s, n=captured: _eval_leaf(s, n)


def _compile_auto_fix(fix_spec: dict) -> Callable[[dict], None] | None:
    if not fix_spec:
        return None
    field_path = fix_spec["field"]
    op         = fix_spec["op"]
    value      = fix_spec.get("value")

    if op == "append":
        def _append(s: dict, fp=field_path, v=value) -> None:
            parts = fp.split(".")
            obj: Any = s
            for p in parts[:-1]:
                obj = obj.setdefault(p, {})
            lst = obj.setdefault(parts[-1], [])
            if v not in lst:
                lst.append(v)
        return _append
    if op == "set":
        def _set(s: dict, fp=field_path, v=value) -> None:
            parts = fp.split(".")
            obj: Any = s
            for p in parts[:-1]:
                obj = obj.setdefault(p, {})
            obj[parts[-1]] = v
        return _set
    return None


def _load_rules_from_yaml(path: Path) -> list[PolicyRule]:
    import yaml
    data  = yaml.safe_load(path.read_text())
    rules = []
    for r in data.get("rules", []):
        try:
            condition = _compile_condition(r["condition"])
            apply_fn  = _compile_auto_fix(r.get("auto_fix"))
            rules.append(PolicyRule(
                id=r["id"],
                name=r["name"],
                description=r["description"],
                severity=r["severity"],
                action_type=r["action_type"],
                priority=r["priority"],
                condition=condition,
                apply=apply_fn,
            ))
        except Exception as exc:
            log.warning("Skipping rule %s: %s", r.get("id", "?"), exc)
    return rules


def _make_hardcoded_rules() -> list[PolicyRule]:
    return [
        # ── BLOCK: no products selected ──────────────────────────────────────
        PolicyRule(
            id="no-products-selected", priority=1,
            name="No Products Selected",
            description="At least one network device must be selected before generating configs or deploying.",
            severity="BLOCK", action_type="BLOCK",
            condition=lambda s: not any(v for v in s.get("selectedProducts", {}).values()),
        ),

        # ── AUTO_FIX: EVPN requires BGP ──────────────────────────────────────
        PolicyRule(
            id="evpn-requires-bgp", priority=5,
            name="EVPN Requires BGP",
            description="EVPN overlay is selected but BGP is not in the protocol list. BGP has been added automatically.",
            severity="INFO", action_type="AUTO_FIX",
            condition=lambda s: (
                any(p in s.get("protocols", []) for p in ("EVPN", "VXLAN")) and
                "BGP" not in s.get("protocols", [])
            ),
            apply=lambda s: s["protocols"].append("BGP"),
        ),

        # ── AUTO_FIX: GPU use-case requires PFC ──────────────────────────────
        PolicyRule(
            id="gpu-requires-pfc", priority=10,
            name="GPU Fabric: PFC Required",
            description="GPU/RDMA fabric detected without PFC. PFC added to GPU specifics automatically.",
            severity="INFO", action_type="AUTO_FIX",
            condition=lambda s: (
                s.get("uc") == "gpu" and
                "PFC" not in s.get("gpuSpecifics", [])
            ),
            apply=lambda s: s.setdefault("gpuSpecifics", []).append("PFC"),
        ),

        # ── AUTO_FIX: campus + 802.1X → enable dot1x policy ─────────────────
        PolicyRule(
            id="campus-enable-dot1x", priority=51,
            name="Campus: Enable 802.1X Policy",
            description="802.1X detected in security list — dot1x policy generation enabled automatically.",
            severity="INFO", action_type="AUTO_FIX",
            condition=lambda s: (
                s.get("uc") == "campus" and
                "802.1x" in s.get("security", []) and
                not s.get("include_dot1x", True)
            ),
            apply=lambda s: s.update({"include_dot1x": True}),
        ),

        # ── SUGGEST: RoCEv2 / ECN ────────────────────────────────────────────
        PolicyRule(
            id="gpu-requires-roce", priority=11,
            name="GPU Fabric: RoCEv2 Recommended",
            description="GPU cluster detected without RoCEv2. Enable RoCEv2 for lossless RDMA performance.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") == "gpu" and
                "RoCEv2" not in s.get("gpuSpecifics", [])
            ),
        ),
        PolicyRule(
            id="gpu-requires-ecn", priority=12,
            name="GPU Fabric: ECN Recommended",
            description="GPU cluster without ECN/DCQCN. Enable ECN for RDMA congestion control.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") == "gpu" and
                "ECN" not in s.get("gpuSpecifics", [])
            ),
        ),

        # ── SUGGEST: VXLAN without EVPN ──────────────────────────────────────
        PolicyRule(
            id="vxlan-requires-evpn-or-flood", priority=20,
            name="VXLAN Control Plane",
            description="VXLAN is selected without EVPN. Consider EVPN for scalable control plane.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                "VXLAN" in s.get("protocols", []) and
                "EVPN" not in s.get("protocols", [])
            ),
        ),

        # ── SUGGEST: single spine = SPOF ─────────────────────────────────────
        PolicyRule(
            id="single-spine-spof", priority=40,
            name="Single Spine = Single Point of Failure",
            description="Only one spine detected. Redundant spine pair is strongly recommended for production.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") in ("dc", "hybrid") and
                s.get("redundancy") == "single" and
                "dc-spine" in s.get("selectedProducts", {})
            ),
        ),

        # ── WARN: no redundancy in large design ───────────────────────────────
        PolicyRule(
            id="large-no-redundancy", priority=41,
            name="Large Design Without Redundancy",
            description="Large-scale design with single redundancy. Production risk.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("orgSize") in ("large", "hyperscale") and
                s.get("redundancy") == "single"
            ),
        ),

        # ── WARN: campus without NAC ──────────────────────────────────────────
        PolicyRule(
            id="campus-no-nac", priority=50,
            name="Campus: No NAC/802.1X",
            description="Campus design without 802.1X NAC. Unauthenticated devices can access the network.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") == "campus" and
                "802.1x" not in s.get("security", [])
            ),
        ),

        # ── WARN: WAN without encryption ─────────────────────────────────────
        PolicyRule(
            id="wan-no-encryption", priority=55,
            name="WAN Without Encryption",
            description="WAN design without IPsec/MACsec. Traffic in transit is unencrypted.",
            severity="WARN", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") == "wan" and
                "ipsec" not in s.get("security", []) and
                "macsec" not in s.get("security", [])
            ),
        ),

        # ── INFO: no compliance framework ─────────────────────────────────────
        PolicyRule(
            id="no-compliance-framework", priority=60,
            name="No Compliance Framework Selected",
            description="No compliance framework (PCI-DSS, HIPAA, SOC2, …) selected. Review if required.",
            severity="INFO", action_type="SUGGEST",
            condition=lambda s: not s.get("compliance", []),
        ),

        # ── INFO: DC without EVPN ────────────────────────────────────────────
        PolicyRule(
            id="dc-no-evpn", priority=75,
            name="DC Fabric Without EVPN",
            description="Data center design without EVPN. EVPN/VXLAN provides scalable L2 overlay.",
            severity="INFO", action_type="SUGGEST",
            condition=lambda s: (
                s.get("uc") == "dc" and
                "EVPN" not in s.get("protocols", []) and
                "VXLAN" not in s.get("protocols", [])
            ),
        ),

        # ── FAIL: GPU without lossless fabric ────────────────────────────────
        PolicyRule(
            id="gpu-lossless-required", priority=15,
            name="GPU Fabric: Lossless QoS Required",
            description="GPU/RDMA fabric requires lossless QoS (PFC + ECN). Missing both — RDMA performance will be severely degraded.",
            severity="FAIL", action_type="FAIL",
            condition=lambda s: (
                s.get("uc") == "gpu" and
                "PFC" not in s.get("gpuSpecifics", []) and
                "ECN" not in s.get("gpuSpecifics", [])
            ),
        ),

        # ── FAIL: DC spine without BGP when EVPN selected ────────────────────
        PolicyRule(
            id="evpn-no-bgp-at-deploy", priority=16,
            name="EVPN Without BGP at Evaluation",
            description="EVPN overlay is configured but BGP is absent after AUTO_FIX phase — manual review required.",
            severity="FAIL", action_type="FAIL",
            condition=lambda s: (
                "EVPN" in s.get("protocols", []) and
                "BGP" not in s.get("protocols", [])
            ),
        ),
    ]


def _make_rules() -> list[PolicyRule]:
    if _RULES_YAML.exists():
        try:
            rules = _load_rules_from_yaml(_RULES_YAML)
            if rules:
                log.debug("Loaded %d rules from %s", len(rules), _RULES_YAML)
                return rules
        except Exception as exc:
            log.warning("Failed to load rules.yaml: %s — using built-in rules", exc)
    return _make_hardcoded_rules()


# ─────────────────────────────────────────────────────────────────────────────
# Engine runner
# ─────────────────────────────────────────────────────────────────────────────

def run_policies(intent: dict[str, Any]) -> PolicyResults:
    """
    Two-phase policy evaluation:
      Phase 1 — AUTO_FIX rules (sorted by priority, mutate resolved state)
      Phase 2 — All rules evaluated on the resolved state

    Returns a PolicyResults with gate_status and resolved_state.
    """
    # Deep copy so we never mutate the caller's dict
    state  = copy.deepcopy(intent)
    rules  = _make_rules()
    result = PolicyResults(resolved_state=state)

    # ── Phase 1: AUTO_FIX pass (mutations only) ─────────────────────────────
    fix_rules = sorted(
        [r for r in rules if r.action_type == "AUTO_FIX"],
        key=lambda r: r.priority,
    )
    for rule in fix_rules:
        try:
            if rule.condition(state) and rule.apply:
                rule.apply(state)
                result.fixes.append({
                    "id":          rule.id,
                    "name":        rule.name,
                    "description": rule.description,
                })
        except Exception:
            pass

    # ── Phase 2: Evaluation pass on resolved state ───────────────────────────
    for rule in sorted(rules, key=lambda r: r.priority):
        try:
            fires = rule.condition(state)
        except Exception:
            fires = False
        if not fires:
            continue

        record = {
            "id":          rule.id,
            "name":        rule.name,
            "description": rule.description,
            "severity":    rule.severity,
            "action":      rule.action_type,
        }

        if rule.action_type == "BLOCK":
            result.blocks.append(record)
            result.violations.append(record)
        elif rule.action_type == "FAIL":
            result.violations.append(record)
        elif rule.action_type == "AUTO_FIX":
            pass  # already handled in phase 1; don't double-report
        elif rule.action_type in ("SUGGEST", "WARN"):
            result.warnings.append(record)
        elif rule.action_type in ("NOOP", "INFO"):
            result.infos.append(record)

    # ── Gate status ───────────────────────────────────────────────────────────
    if result.blocks:
        result.gate_status = "BLOCK"
    elif result.violations:
        result.gate_status = "FAIL"
    elif result.warnings:
        result.gate_status = "WARN"
    else:
        result.gate_status = "PASS"

    result.resolved_state = state
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Confidence score
# ─────────────────────────────────────────────────────────────────────────────

def compute_confidence(
    policy_results: PolicyResults,
    sim_severity:   str = "PENDING",   # PASS | WARN | FAIL | PENDING
    precheck_status: str = "PENDING",  # PASS | FAIL | PENDING
) -> dict[str, Any]:
    """
    Compute 0–100 deployment confidence score.
    Mirrors the JS computeConfidenceScore() logic exactly.
    """
    score     = 0
    breakdown: list[dict] = []

    # Simulation — 40 pts
    sim_pts = {"PASS": 40, "WARN": 24, "FAIL": 0, "PENDING": 20}.get(sim_severity, 20)
    sim_lbl = {"PASS": "Simulation passed", "WARN": "Simulation warnings",
                "FAIL": "Simulation failed", "PENDING": "Simulation not run"}.get(sim_severity, "—")
    sim_ico = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌", "PENDING": "⏳"}.get(sim_severity, "⏳")
    score += sim_pts
    breakdown.append({"label": sim_lbl, "pts": sim_pts, "icon": sim_ico})

    # Pre-checks — 30 pts
    pre_pts = {"PASS": 30, "FAIL": 0, "PENDING": 15}.get(precheck_status, 15)
    pre_lbl = {"PASS": "Pre-checks passed", "FAIL": "Pre-checks failed",
               "PENDING": "Pre-checks not run"}.get(precheck_status, "—")
    pre_ico = {"PASS": "✅", "FAIL": "❌", "PENDING": "⏳"}.get(precheck_status, "⏳")
    score += pre_pts
    breakdown.append({"label": pre_lbl, "pts": pre_pts, "icon": pre_ico})

    # Policy — 20 pts
    gate = policy_results.gate_status
    pol_pts = {"PASS": 20, "WARN": 12, "FAIL": 4, "BLOCK": 0, "PENDING": 10}.get(gate, 10)
    pol_lbl = {"PASS": "All policies clear", "WARN": "Policy warnings",
               "FAIL": "Policy violations (FAIL)", "BLOCK": "Policy BLOCKED",
               "PENDING": "Policy not evaluated"}.get(gate, "—")
    pol_ico = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌", "BLOCK": "🚫", "PENDING": "⏳"}.get(gate, "⏳")
    score += pol_pts
    breakdown.append({"label": pol_lbl, "pts": pol_pts, "icon": pol_ico})

    # AUTO_FIX bonus — up to 8 pts
    fixes = len(policy_results.fixes)
    if fixes > 0:
        fix_pts = min(fixes * 2, 8)
        score  += fix_pts
        breakdown.append({
            "label": f"{fixes} issue{'s' if fixes > 1 else ''} auto-fixed",
            "pts": fix_pts, "icon": "🔧",
        })

    # Zero-warning bonus — 10 pts (only if PASS and no warnings)
    if gate == "PASS" and not policy_results.warnings:
        score += 10
        breakdown.append({"label": "Zero policy warnings", "pts": 10, "icon": "🏆"})

    score = min(score, 100)
    label = ("High Confidence" if score >= 80
             else "Moderate" if score >= 50
             else "Low Confidence")

    return {
        "score":     score,
        "label":     label,
        "breakdown": breakdown,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Gate decision
# ─────────────────────────────────────────────────────────────────────────────

def can_deploy(
    policy_results: PolicyResults,
    sim_severity:   str  = "PENDING",
    precheck_status: str = "PENDING",
    policy_fail_acknowledged: bool = False,
) -> dict[str, Any]:
    """
    Return the deployment gate decision.

    Hard blocks (cannot be overridden):
      - Simulation FAIL
      - Pre-checks FAIL
      - Policy BLOCK

    Soft blocks (require acknowledgement):
      - Policy FAIL + not acknowledged

    Returns:
        { "allowed": bool, "status": str, "blockers": [str], "warnings": [str] }
    """
    blockers: list[str] = []
    warnings: list[str] = []

    if sim_severity == "FAIL":
        blockers.append("Simulation failed — topology partition risk detected")
    if precheck_status == "FAIL":
        blockers.append("Pre-deployment checks failed — devices not ready")
    if policy_results.gate_status == "BLOCK":
        for b in policy_results.blocks:
            blockers.append(f"Policy BLOCK: {b['name']} — {b['description']}")
    if policy_results.gate_status == "FAIL" and not policy_fail_acknowledged:
        for v in policy_results.violations:
            blockers.append(f"Policy FAIL (requires acknowledgement): {v['name']}")

    for w in policy_results.warnings:
        warnings.append(f"Policy WARN: {w['name']}")

    allowed = len(blockers) == 0
    if allowed and blockers == [] and warnings:
        status = "PROCEED_WITH_CAUTION"
    elif allowed:
        status = "CLEAR_TO_DEPLOY"
    elif policy_results.gate_status == "BLOCK":
        status = "BLOCKED"
    else:
        status = "REQUIRES_ACKNOWLEDGEMENT" if not blockers or (
            all("acknowledgement" in b for b in blockers)
        ) else "BLOCKED"

    return {
        "allowed":   allowed,
        "status":    status,
        "blockers":  blockers,
        "warnings":  warnings,
    }
