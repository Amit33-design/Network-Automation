"""
NetDesign AI — User-Defined Policy Rules Router
================================================
Endpoints:
  GET  /api/user-policies/packs            — list built-in compliance packs
  GET  /api/user-policies/packs/{pack_id}  — fetch pack YAML
  POST /api/user-policies/validate         — validate YAML without saving
  POST /api/user-policies                  — create a ruleset
  GET  /api/user-policies                  — list all rulesets
  GET  /api/user-policies/{id}             — get one (with YAML + history)
  PUT  /api/user-policies/{id}             — update (bumps version)
  DELETE /api/user-policies/{id}           — soft-delete
  POST /api/user-policies/{id}/evaluate    — evaluate against intent + configs
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response

log = logging.getLogger("netdesign.routers.user_policies")

router = APIRouter(prefix="/api/user-policies", tags=["user-policies"])

# ── Lazy import engine (avoids hard dep at import time) ──────────────────────
from policies.user_rule_engine import (
    evaluate as _engine_evaluate,
    get_pack_yaml,
    list_packs,
    validate_yaml,
    RuleParseError,
)
from models import (
    EvaluateRequest,
    UserRulesetCreate,
    UserRulesetDetail,
    UserRulesetRead,
    UserRulesetUpdate,
    ValidateRequest,
)

# ─────────────────────────────────────────────────────────────────────────────
# In-memory store (used when DB is not configured — mirrors DB API shape)
# ─────────────────────────────────────────────────────────────────────────────
_store: dict[str, dict] = {}


def _now_str() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_record(body: UserRulesetCreate, rule_count: int) -> dict:
    rid = str(uuid.uuid4())
    now = _now_str()
    return {
        "id":           rid,
        "org_id":       body.org_id,
        "name":         body.name,
        "description":  body.description,
        "yaml_content": body.yaml_content,
        "is_active":    True,
        "rule_count":   rule_count,
        "version":      1,
        "version_history": [{
            "version":    1,
            "changed_by": "user",
            "changed_at": now,
            "note":       body.change_note or "Initial version",
            "rule_count": rule_count,
        }],
        "created_by":   "user",
        "created_at":   now,
        "updated_at":   now,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Built-in packs
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/packs")
async def list_compliance_packs() -> list[dict]:
    return list_packs()


@router.get("/packs/{pack_id}")
async def get_compliance_pack(pack_id: str) -> dict[str, Any]:
    yaml_text = get_pack_yaml(pack_id)
    if yaml_text is None:
        raise HTTPException(status_code=404, detail=f"Pack '{pack_id}' not found")
    return {"pack_id": pack_id, "yaml_content": yaml_text}


# ─────────────────────────────────────────────────────────────────────────────
# Validate without saving
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/validate")
async def validate_ruleset(body: ValidateRequest) -> dict[str, Any]:
    ok, errors, count = validate_yaml(body.yaml_content)
    return {"valid": ok, "rule_count": count, "errors": errors}


# ─────────────────────────────────────────────────────────────────────────────
# CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_ruleset(body: UserRulesetCreate) -> dict[str, Any]:
    ok, errors, count = validate_yaml(body.yaml_content)
    if not ok:
        raise HTTPException(status_code=422, detail={"errors": errors})
    record = _make_record(body, count)
    _store[record["id"]] = record
    log.info("Ruleset created: %s (%d rules)", record["name"], count)
    return _to_read(record)


@router.get("")
async def list_rulesets() -> list[dict]:
    return [_to_read(r) for r in _store.values() if r["is_active"]]


@router.get("/{ruleset_id}")
async def get_ruleset(ruleset_id: str) -> dict[str, Any]:
    record = _store.get(ruleset_id)
    if not record or not record["is_active"]:
        raise HTTPException(status_code=404, detail="Ruleset not found")
    return _to_detail(record)


@router.put("/{ruleset_id}")
async def update_ruleset(ruleset_id: str, body: UserRulesetUpdate) -> dict[str, Any]:
    record = _store.get(ruleset_id)
    if not record or not record["is_active"]:
        raise HTTPException(status_code=404, detail="Ruleset not found")

    new_yaml = body.yaml_content if body.yaml_content is not None else record["yaml_content"]

    if body.yaml_content is not None:
        ok, errors, count = validate_yaml(new_yaml)
        if not ok:
            raise HTTPException(status_code=422, detail={"errors": errors})
        record["yaml_content"] = new_yaml
        record["rule_count"] = count

    if body.name is not None:
        record["name"] = body.name
    if body.description is not None:
        record["description"] = body.description

    record["version"] += 1
    record["updated_at"] = _now_str()
    record["version_history"].append({
        "version":    record["version"],
        "changed_by": "user",
        "changed_at": record["updated_at"],
        "note":       body.change_note or f"Updated to v{record['version']}",
        "rule_count": record["rule_count"],
    })

    log.info("Ruleset %s updated to v%d", ruleset_id, record["version"])
    return _to_detail(record)


@router.delete("/{ruleset_id}")
async def delete_ruleset(ruleset_id: str) -> Response:
    record = _store.get(ruleset_id)
    if not record or not record["is_active"]:
        raise HTTPException(status_code=404, detail="Ruleset not found")
    record["is_active"] = False
    log.info("Ruleset %s deleted", ruleset_id)
    return Response(status_code=204)


# ─────────────────────────────────────────────────────────────────────────────
# Evaluate
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{ruleset_id}/evaluate")
async def evaluate_ruleset(ruleset_id: str, body: EvaluateRequest) -> dict[str, Any]:
    record = _store.get(ruleset_id)
    if not record or not record["is_active"]:
        raise HTTPException(status_code=404, detail="Ruleset not found")

    try:
        results = _engine_evaluate(
            yaml_content=record["yaml_content"],
            intent=body.intent,
            configs=body.configs,
        )
    except RuleParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "ruleset_id":   ruleset_id,
        "ruleset_name": record["name"],
        "version":      record["version"],
        "gate_status":  results.gate_status,
        "rule_count":   results.rule_count,
        "fired_count":  results.fired_count,
        "violations":   results.violations,
        "warnings":     results.warnings,
        "infos":        results.infos,
    }


@router.post("/evaluate-yaml")
async def evaluate_yaml_inline(body: dict[str, Any]) -> dict[str, Any]:
    """Evaluate raw YAML inline without saving. Used by the live editor."""
    yaml_content = body.get("yaml_content", "")
    intent       = body.get("intent", {})
    configs      = body.get("configs", {})

    try:
        results = _engine_evaluate(yaml_content, intent, configs)
    except RuleParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "gate_status": results.gate_status,
        "rule_count":  results.rule_count,
        "fired_count": results.fired_count,
        "violations":  results.violations,
        "warnings":    results.warnings,
        "infos":       results.infos,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_read(r: dict) -> dict:
    return {k: r[k] for k in (
        "id", "org_id", "name", "description", "is_active",
        "rule_count", "version", "created_by", "created_at", "updated_at",
    )}


def _to_detail(r: dict) -> dict:
    d = _to_read(r)
    d["yaml_content"]    = r["yaml_content"]
    d["version_history"] = r["version_history"]
    return d
