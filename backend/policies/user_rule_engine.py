"""
NetDesign AI — User-Defined Policy Rule Engine
===============================================
Evaluates user-authored YAML rule sets against design intent + generated configs.

Extends the built-in gate_engine DSL with:
  - Case-insensitive severity (Info | Warn | Fail | Block)
  - config_contains / config_not_contains operators (check all generated configs)
  - gte / lte numeric operators
  - Custom message field per rule
  - Compile-time validation with actionable errors
"""
from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import yaml

log = logging.getLogger("netdesign.user_rule_engine")

PACKS_DIR = Path(__file__).parent / "packs"

_SEVERITY_MAP: dict[str, str] = {
    "info":    "INFO",
    "warn":    "WARN",
    "warning": "WARN",
    "fail":    "FAIL",
    "block":   "BLOCK",
}

_VALID_OPS = {
    "eq", "neq", "contains", "not_contains", "in", "not_in",
    "gt", "lt", "gte", "lte", "is_empty", "is_not_empty",
    "config_contains", "config_not_contains",
}


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation context
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class EvalContext:
    intent:  dict[str, Any]
    configs: dict[str, str]   # {hostname: config_text}
    _config_blob: str = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._config_blob = "\n".join(self.configs.values())


# ─────────────────────────────────────────────────────────────────────────────
# DSL compiler
# ─────────────────────────────────────────────────────────────────────────────

def _get_field(ctx: EvalContext, path: str) -> Any:
    parts = path.split(".")
    obj: Any = ctx.intent
    for p in parts:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(p)
    return obj


def _eval_leaf(ctx: EvalContext, node: dict) -> bool:
    op    = node["op"]
    value = node.get("value")

    if op == "config_contains":
        return bool(value) and value in ctx._config_blob
    if op == "config_not_contains":
        return (not value) or (value not in ctx._config_blob)

    actual = _get_field(ctx, node["field"])

    if op == "eq":            return actual == value
    if op == "neq":           return actual != value
    if op == "contains":      return isinstance(actual, (list, str)) and value in actual
    if op == "not_contains":  return not (isinstance(actual, (list, str)) and value in actual)
    if op == "in":            return actual in (value or [])
    if op == "not_in":        return actual not in (value or [])
    if op == "gt":            return isinstance(actual, (int, float)) and actual > value
    if op == "lt":            return isinstance(actual, (int, float)) and actual < value
    if op == "gte":           return isinstance(actual, (int, float)) and actual >= value
    if op == "lte":           return isinstance(actual, (int, float)) and actual <= value
    if op == "is_empty":      return not actual
    if op == "is_not_empty":  return bool(actual)
    return False


def _compile_condition(node: dict) -> Callable[[EvalContext], bool]:
    if "all" in node:
        children = [_compile_condition(c) for c in node["all"]]
        return lambda ctx, ch=children: all(c(ctx) for c in ch)
    if "any" in node:
        children = [_compile_condition(c) for c in node["any"]]
        return lambda ctx, ch=children: any(c(ctx) for c in ch)
    if "not" in node:
        child = _compile_condition(node["not"])
        return lambda ctx, c=child: not c(ctx)
    # leaf
    if "op" not in node:
        raise RuleParseError(f"Leaf node missing 'op'. Got keys: {list(node.keys())}")
    if node["op"] not in _VALID_OPS:
        raise RuleParseError(f"Unknown op '{node['op']}'. Valid: {sorted(_VALID_OPS)}")
    captured = dict(node)
    return lambda ctx, n=captured: _eval_leaf(ctx, n)


# ─────────────────────────────────────────────────────────────────────────────
# Compiled rule
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class UserRule:
    id:          str
    name:        str
    description: str
    severity:    str   # INFO | WARN | FAIL | BLOCK
    priority:    int
    condition:   Callable[[EvalContext], bool]
    message:     str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Parse + validate
# ─────────────────────────────────────────────────────────────────────────────

class RuleParseError(Exception):
    pass


def parse_ruleset(yaml_content: str) -> list[UserRule]:
    """Parse and compile user YAML. Raises RuleParseError on any problem."""
    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as exc:
        raise RuleParseError(f"YAML syntax error: {exc}") from exc

    if not isinstance(data, dict):
        raise RuleParseError("Top-level document must be a YAML mapping")

    raw_rules = data.get("rules", [])
    if not isinstance(raw_rules, list):
        raise RuleParseError("'rules' must be a list")
    if not raw_rules:
        raise RuleParseError("'rules' is empty — add at least one rule")

    compiled: list[UserRule] = []
    errors:   list[str]      = []

    for i, r in enumerate(raw_rules):
        if not isinstance(r, dict):
            errors.append(f"Rule #{i + 1}: must be a mapping, got {type(r).__name__}")
            continue
        rid = r.get("id", f"rule-{i + 1}")
        try:
            if "condition" not in r:
                raise RuleParseError("missing 'condition'")
            cond_fn  = _compile_condition(r["condition"])
            sev_raw  = str(r.get("severity", "info")).lower()
            severity = _SEVERITY_MAP.get(sev_raw, "INFO")
            compiled.append(UserRule(
                id=rid,
                name=r.get("name", rid),
                description=r.get("description", ""),
                severity=severity,
                priority=int(r.get("priority", 100 + i)),
                condition=cond_fn,
                message=r.get("message", r.get("description", "")),
            ))
        except RuleParseError as exc:
            errors.append(f"Rule '{rid}': {exc}")
        except Exception as exc:
            errors.append(f"Rule '{rid}': {exc}")

    if errors:
        raise RuleParseError("Errors in ruleset:\n" + "\n".join(f"  • {e}" for e in errors))

    return compiled


def validate_yaml(yaml_content: str) -> tuple[bool, list[str], int]:
    """Returns (ok, error_lines, rule_count)."""
    try:
        rules = parse_ruleset(yaml_content)
        return True, [], len(rules)
    except RuleParseError as exc:
        return False, str(exc).splitlines(), 0


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class UserPolicyResults:
    violations: list[dict] = field(default_factory=list)
    warnings:   list[dict] = field(default_factory=list)
    infos:      list[dict] = field(default_factory=list)
    gate_status: str = "PASS"
    rule_count:  int = 0
    fired_count: int = 0


def evaluate(
    yaml_content: str,
    intent:  dict[str, Any],
    configs: dict[str, str] | None = None,
) -> UserPolicyResults:
    """Evaluate a user ruleset against intent + optional generated configs."""
    result = UserPolicyResults()
    rules  = parse_ruleset(yaml_content)
    result.rule_count = len(rules)
    ctx = EvalContext(intent=copy.deepcopy(intent), configs=configs or {})

    for rule in sorted(rules, key=lambda r: r.priority):
        try:
            fires = rule.condition(ctx)
        except Exception as exc:
            log.warning("Rule %s eval error: %s", rule.id, exc)
            fires = False

        if not fires:
            continue

        result.fired_count += 1
        record = {
            "id":       rule.id,
            "name":     rule.name,
            "message":  rule.message or rule.description,
            "severity": rule.severity,
        }

        if rule.severity in ("FAIL", "BLOCK"):
            result.violations.append(record)
        elif rule.severity == "WARN":
            result.warnings.append(record)
        else:
            result.infos.append(record)

    if any(r["severity"] == "BLOCK" for r in result.violations):
        result.gate_status = "BLOCK"
    elif result.violations:
        result.gate_status = "FAIL"
    elif result.warnings:
        result.gate_status = "WARN"
    else:
        result.gate_status = "PASS"

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Built-in compliance packs
# ─────────────────────────────────────────────────────────────────────────────

def list_packs() -> list[dict]:
    """Return metadata for all built-in packs."""
    packs = []
    if PACKS_DIR.exists():
        for f in sorted(PACKS_DIR.glob("*.yaml")):
            try:
                data = yaml.safe_load(f.read_text())
                packs.append({
                    "id":          f.stem,
                    "name":        data.get("name", f.stem),
                    "description": data.get("description", ""),
                    "rule_count":  len(data.get("rules", [])),
                    "tags":        data.get("tags", []),
                })
            except Exception:
                pass
    return packs


def get_pack_yaml(pack_id: str) -> str | None:
    """Return raw YAML for a built-in pack, or None if not found."""
    path = PACKS_DIR / f"{pack_id}.yaml"
    return path.read_text() if path.exists() else None
