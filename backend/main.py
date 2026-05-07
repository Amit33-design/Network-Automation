"""
NetDesign AI — FastAPI Backend
================================
Provides REST endpoints for:
  POST /api/auth/token         — issue JWT (dev login)
  POST /api/generate-configs   — Jinja2 config generation per device (with policies)
  POST /api/deploy             — Nornir/Netmiko parallel config push
  POST /api/pre-checks         — Pre-deployment validation
  POST /api/post-checks        — Post-deployment validation
  GET  /api/inventory          — Return current Nornir inventory
  GET  /api/policy-rules       — Policy rule definitions (YAML → JSON)
  GET  /health                 — Health probe (used by docker-compose healthcheck)
  GET  /ztp/*                  — Zero Touch Provisioning server

Authentication: Bearer JWT. Set JWT_SECRET env var to enforce auth.
Without JWT_SECRET the server runs in open dev mode (all requests allowed).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import Role, create_token, require_permission
from audit import record, record_config_gen, record_deploy, record_login
from db import create_all_tables, dispose_engine, get_db
from config_gen import generate_all_configs
from nornir_tasks import (
    deploy_configs,
    get_inventory_hosts,
    run_post_checks,
    run_pre_checks,
)
from routers.designs import router as designs_router
from routers.deployments import router as deployments_router
from routers.devices import router as devices_router
from ztp.router import ztp_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CORS — read allowed origins from environment (no wildcard default in prod)
# ---------------------------------------------------------------------------
_raw_origins = os.environ.get("CORS_ORIGINS", "")
if _raw_origins and _raw_origins != "*":
    _cors_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
elif not os.environ.get("JWT_SECRET"):
    # Dev mode: no JWT_SECRET → open CORS for local development convenience
    _cors_origins = ["*"]
    log.warning("CORS_ORIGINS not set and JWT_SECRET unset — allowing all origins (dev mode)")
else:
    # JWT_SECRET is set but no CORS_ORIGINS — refuse to start with wildcard
    raise RuntimeError(
        "CORS_ORIGINS must be set when JWT_SECRET is configured. "
        "Example: CORS_ORIGINS=http://localhost:8080,https://yourdomain.com"
    )

# ---------------------------------------------------------------------------
# Dev-mode static credentials (for /api/auth/token dev login only)
# Override with: ADMIN_USER / ADMIN_PASS env vars
# ---------------------------------------------------------------------------
_ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
_ADMIN_PASS = os.environ.get("ADMIN_PASS", "netdesign-dev")

@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup: create tables in dev mode (Alembic handles prod)
    if os.environ.get("AUTO_CREATE_TABLES", "").lower() == "true":
        await create_all_tables()
    yield
    # Shutdown: close DB connections cleanly
    await dispose_engine()


app = FastAPI(
    title="NetDesign AI Backend",
    description="Config generation, policy injection, ZTP, and device deployment API",
    version="2.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=True,
)

# Mount routers
app.include_router(ztp_router)          # unauthenticated — devices call during boot
app.include_router(designs_router)
app.include_router(deployments_router)
app.include_router(devices_router)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class DesignState(BaseModel):
    """Mirrors the frontend STATE object serialised to JSON."""
    uc: str
    orgName: str = "My Network"
    orgSize: str = "medium"
    redundancy: str = "ha"
    fwModel: str | None = None
    selectedProducts: dict[str, str] = {}
    protocols: list[str] = []
    security: list[str] = []
    compliance: list[str] = []
    vlans: list[dict[str, Any]] = []
    appFlows: list[dict[str, Any]] = []
    include_bgp_policy: bool = True
    include_acl:        bool = True
    include_dot1x:      bool = True
    include_qos:        bool = True
    include_aaa:        bool = True


class DeployRequest(BaseModel):
    state:      DesignState
    inventory:  dict[str, Any]
    dry_run:    bool = True


class ConfigResponse(BaseModel):
    configs:      dict[str, str]
    generated_at: float


class CheckResult(BaseModel):
    host:   str
    check:  str
    passed: bool
    detail: str


class CheckResponse(BaseModel):
    results:    list[CheckResult]
    all_passed: bool
    duration_s: float


class DeployResponse(BaseModel):
    results:      dict[str, Any]
    dry_run:      bool
    duration_s:   float
    deployment_id: str


class TokenRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    role:         str


# ---------------------------------------------------------------------------
# Health / root
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"service": "NetDesign AI Backend", "version": "2.1.0", "status": "ok"}


@app.get("/health")
def health():
    """Docker healthcheck endpoint."""
    return {"status": "ok", "timestamp": time.time()}


# ---------------------------------------------------------------------------
# Auth — token issuance (dev login; replace with real user store in Phase 2)
# ---------------------------------------------------------------------------

@app.post("/api/auth/token", response_model=TokenResponse)
async def auth_token(req: TokenRequest, request: Request):
    """
    Issue a JWT for API access.

    In dev mode (JWT_SECRET unset) all credentials are accepted and an admin
    token is returned — this is intentional for local development only.

    In production (JWT_SECRET set) only the admin account configured via
    ADMIN_USER / ADMIN_PASS env vars is accepted here. Phase 2 will replace
    this with a real user table lookup.
    """
    ip = getattr(request.client, "host", "unknown")

    if not os.environ.get("JWT_SECRET"):
        # Dev mode — return a mock token
        await record_login("dev-user", "success", ip_address=ip)
        return TokenResponse(
            access_token="dev-mode-no-secret-set",
            token_type="bearer",
            role=Role.ADMIN.value,
        )

    if req.username != _ADMIN_USER or req.password != _ADMIN_PASS:
        await record_login(req.username, "denied", ip_address=ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(req.username, Role.ADMIN)
    await record_login(req.username, "success", ip_address=ip)
    return TokenResponse(access_token=token, token_type="bearer", role=Role.ADMIN.value)


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

@app.get("/api/inventory")
def api_inventory(user=Depends(require_permission("designs:read"))):
    try:
        hosts = get_inventory_hosts()
        return {"hosts": hosts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Policy rules (single source of truth → YAML → JSON for frontend)
# ---------------------------------------------------------------------------

@app.get("/api/policy-rules")
def api_policy_rules():
    """
    Serve policy rules as JSON. The frontend policyengine.js fetches this
    instead of hardcoding its own copy — eliminates Python/JS rule drift.
    """
    rules_file = Path(__file__).parent / "policies" / "rules.yaml"
    if rules_file.exists():
        try:
            import yaml
            data = yaml.safe_load(rules_file.read_text())
            return {"rules": data.get("rules", [])}
        except Exception as exc:
            log.warning("Could not load rules.yaml: %s", exc)
    # Fallback: import from gate_engine if YAML not yet created
    try:
        from gate_engine import run_policies  # noqa: F401
        return {"rules": [], "note": "rules.yaml not found — create backend/policies/rules.yaml"}
    except Exception:
        return {"rules": []}


# ---------------------------------------------------------------------------
# Config generation
# ---------------------------------------------------------------------------

@app.post("/api/generate-configs", response_model=ConfigResponse)
async def api_generate_configs(
    state: DesignState,
    user: dict = Depends(require_permission("configs:generate")),
):
    """
    Generate Jinja2-rendered configs for all selected devices.
    Does NOT touch real devices — purely template rendering.
    """
    try:
        configs = generate_all_configs(state.model_dump())
        await record_config_gen(
            user_id=user.get("sub", "unknown"),
            design_id=state.orgName,
            device_count=len(configs),
        )
        return ConfigResponse(configs=configs, generated_at=time.time())
    except Exception as exc:
        log.exception("Config generation failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Pre-checks
# ---------------------------------------------------------------------------

@app.post("/api/pre-checks", response_model=CheckResponse)
async def api_pre_checks(
    request: DeployRequest,
    user: dict = Depends(require_permission("deploy:staging")),
):
    """
    Run pre-deployment checks against real devices via Nornir/Netmiko:
      - ICMP reachability
      - SSH connectivity + version check
      - Mandatory running-config backup (saved before any change)
    """
    t0 = time.time()
    deployment_id = str(uuid.uuid4())
    try:
        results = await asyncio.to_thread(
            run_pre_checks,
            request.state.model_dump(),
            request.inventory,
            deployment_id,
        )
        all_ok = all(r["passed"] for r in results)
        await record(
            user_id=user.get("sub", "unknown"),
            action="pre_checks.run",
            resource_id=deployment_id,
            resource_type="deployment",
            outcome="passed" if all_ok else "failed",
            detail={"host_count": len(request.inventory), "all_passed": all_ok},
        )
        return CheckResponse(
            results=[CheckResult(**r) for r in results],
            all_passed=all_ok,
            duration_s=round(time.time() - t0, 2),
        )
    except Exception as exc:
        log.exception("Pre-checks failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

@app.post("/api/deploy", response_model=DeployResponse)
async def api_deploy(
    request: DeployRequest,
    user: dict = Depends(require_permission("deploy:staging")),
):
    """
    Push generated configs to devices via Nornir/Netmiko.
    dry_run=True (default) → configs rendered but NOT pushed.
    dry_run=False → configs pushed with platform-native confirm-commit guard.
    """
    t0 = time.time()
    deployment_id = str(uuid.uuid4())
    outcome = "unknown"
    try:
        configs = generate_all_configs(request.state.model_dump())
        results = await asyncio.to_thread(
            deploy_configs,
            configs,
            request.inventory,
            request.dry_run,
            deployment_id,
        )
        outcome = "success" if results.get("success", False) else "failed"
        duration = round(time.time() - t0, 2)

        # Persist deployment record to DB (best-effort — don't fail the response)
        try:
            from sqlalchemy.ext.asyncio import AsyncSession
            from models import Deployment as DeploymentModel
            from db import _SessionLocal
            if _SessionLocal is not None:
                async with _SessionLocal() as db_session:
                    dep = DeploymentModel(
                        id=deployment_id,
                        design_id=request.state.orgName,   # placeholder — Phase 3 passes real design_id
                        environment="staging" if not request.dry_run else "dry_run",
                        triggered_by=user.get("sub", "unknown"),
                        status=outcome,
                        config_snapshot={"device_count": len(configs), "dry_run": request.dry_run},
                        confidence_score=None,
                        started_at=datetime.fromtimestamp(t0, tz=timezone.utc),
                        completed_at=datetime.now(timezone.utc),
                    )
                    db_session.add(dep)
                    await db_session.commit()
        except Exception as db_exc:
            log.warning("Could not persist deployment record: %s", db_exc)

        return DeployResponse(
            results=results,
            dry_run=request.dry_run,
            duration_s=duration,
            deployment_id=deployment_id,
        )
    except Exception as exc:
        outcome = "failed"
        log.exception("Deployment failed")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        await record_deploy(
            user_id=user.get("sub", "unknown"),
            deployment_id=deployment_id,
            outcome=outcome,
            dry_run=request.dry_run,
            device_count=len(request.inventory),
        )


# ---------------------------------------------------------------------------
# Post-checks
# ---------------------------------------------------------------------------

@app.post("/api/post-checks", response_model=CheckResponse)
async def api_post_checks(
    request: DeployRequest,
    user: dict = Depends(require_permission("deploy:staging")),
):
    """
    Run post-deployment validation:
      - BGP neighbor state
      - OSPF/IS-IS adjacency
      - Interface error counters
      - Ping to gateway / loopbacks
    """
    t0 = time.time()
    try:
        results = await asyncio.to_thread(
            run_post_checks,
            request.state.model_dump(),
            request.inventory,
        )
        all_ok = all(r["passed"] for r in results)
        return CheckResponse(
            results=[CheckResult(**r) for r in results],
            all_passed=all_ok,
            duration_s=round(time.time() - t0, 2),
        )
    except Exception as exc:
        log.exception("Post-checks failed")
        raise HTTPException(status_code=500, detail=str(exc))
