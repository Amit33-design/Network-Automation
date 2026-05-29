"""
Custom Policy Router
=====================
Exposes user-defined policy config generation via REST.

Endpoints
---------
POST /api/custom-policy/generate   — Render configs from CustomPolicyInput
POST /api/custom-policy/validate   — Validate input and return warnings
GET  /api/custom-policy/schema     — Return JSON schema of CustomPolicyInput
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter  # , Depends
from pydantic import BaseModel, ValidationError

# from auth import require_permission  # Placeholder — uncomment to enforce auth
from policies.custom_policy import CustomPolicy, CustomPolicyInput

log = logging.getLogger("netdesign.routers.custom_policy")

router = APIRouter(prefix="/api/custom-policy", tags=["custom-policy"])

_policy_engine = CustomPolicy()


# ── Response models ───────────────────────────────────────────────────────────

class GenerateResponse(BaseModel):
    configs: dict[str, str]


class ValidateResponse(BaseModel):
    valid: bool
    warnings: list[str]
    errors: list[str]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=GenerateResponse)
async def generate_config(
    body: CustomPolicyInput,
    # user: dict = Depends(require_permission("designs:write")),  # auth placeholder
) -> GenerateResponse:
    """
    Accept a CustomPolicyInput and return rendered device configs.

    The returned ``configs`` dict maps device hostnames to full config text.
    One entry is returned per call (one device_type per request).
    """
    try:
        configs = _policy_engine.generate(body)
        log.info(
            "Custom policy '%s' generated for %s (%d chars)",
            body.name,
            body.device_type,
            sum(len(v) for v in configs.values()),
        )
        return GenerateResponse(configs=configs)
    except Exception as exc:
        log.exception("Custom policy generation failed")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/validate", response_model=ValidateResponse)
async def validate_policy(body: dict[str, Any]) -> ValidateResponse:
    """
    Validate the raw input dict and return any warnings or errors.

    This endpoint accepts a raw dict so that partial / malformed inputs
    can be checked without raising a 422 before the response is returned.
    """
    errors: list[str] = []
    warnings: list[str] = []
    valid = False

    try:
        parsed = CustomPolicyInput.model_validate(body)
        valid = True
        warnings = _policy_engine.validate(parsed)
    except ValidationError as ve:
        for err in ve.errors():
            loc = " -> ".join(str(x) for x in err["loc"])
            errors.append(f"{loc}: {err['msg']}")
    except Exception as exc:
        errors.append(str(exc))

    return ValidateResponse(valid=valid, warnings=warnings, errors=errors)


@router.get("/schema")
async def get_schema() -> dict[str, Any]:
    """Return the JSON Schema for CustomPolicyInput (Pydantic v2 schema)."""
    return CustomPolicyInput.model_json_schema()
