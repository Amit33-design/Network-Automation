"""
NetDesign AI — FastAPI Backend
================================
Provides REST endpoints for:
  POST /api/generate-configs   — Jinja2 config generation per device (with policies)
  POST /api/deploy             — Nornir/Netmiko parallel config push
  POST /api/pre-checks         — Pre-deployment validation
  POST /api/post-checks        — Post-deployment validation
  GET  /api/inventory          — Return current Nornir inventory
  GET  /ztp/*                  — Zero Touch Provisioning server

Policy blocks appended to every generated config:
  BGP route-maps · prefix-lists · community strings (per use case)
  Infrastructure ACL (iACL) · VLAN ACLs · VTY ACL
  802.1X / IBNS 2.0 (campus only) · MAB fallback · CoA
  QoS class-maps · priority queuing · PFC/ECN (GPU)
  AAA/TACACS+ · SNMPv3 · Syslog · NTP authentication

ZTP endpoints:
  GET  /ztp/bootstrap/{serial}   — serve Day 0 config to booting device
  GET  /ztp/script/{platform}    — POAP/EOS-ZTP Python script
  POST /ztp/checkin/{serial}     — device reports provisioning result
  POST /ztp/register             — pre-register device
  GET  /ztp/status               — onboarding dashboard

Run with:
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config_gen import generate_all_configs
from nornir_tasks import (
    run_pre_checks,
    run_post_checks,
    deploy_configs,
    get_inventory_hosts,
)
from ztp.router import ztp_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(
    title="NetDesign AI Backend",
    description="Config generation, policy injection, ZTP, and device deployment API",
    version="2.0.0",
)

# Allow calls from the static frontend (GitHub Pages or local file://)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount ZTP router
app.include_router(ztp_router)


# ─────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────

class DesignState(BaseModel):
    """Mirrors the frontend STATE object serialised to JSON."""
    uc: str                           # campus | dc | gpu | wan | hybrid
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
    # Policy generation options (all default True)
    include_bgp_policy: bool = True
    include_acl:        bool = True
    include_dot1x:      bool = True
    include_qos:        bool = True
    include_aaa:        bool = True


class DeployRequest(BaseModel):
    state: DesignState
    inventory: dict[str, Any]         # Nornir-format hosts dict
    dry_run: bool = True              # safety: default to dry-run


class ConfigResponse(BaseModel):
    configs: dict[str, str]           # { device_id: config_text }
    generated_at: float


class CheckResult(BaseModel):
    host: str
    check: str
    passed: bool
    detail: str


class CheckResponse(BaseModel):
    results: list[CheckResult]
    all_passed: bool
    duration_s: float


class DeployResponse(BaseModel):
    results: dict[str, Any]
    dry_run: bool
    duration_s: float


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@app.get("/")
def root():
    return {"service": "NetDesign AI Backend", "status": "ok"}


@app.get("/api/inventory")
def api_inventory():
    """Return the current Nornir inventory host list."""
    try:
        hosts = get_inventory_hosts()
        return {"hosts": hosts}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/generate-configs", response_model=ConfigResponse)
def api_generate_configs(state: DesignState):
    """
    Generate Jinja2-rendered configs for all selected devices.
    Does NOT touch real devices — purely template rendering.
    """
    try:
        configs = generate_all_configs(state.model_dump())
        return ConfigResponse(configs=configs, generated_at=time.time())
    except Exception as exc:
        log.exception("Config generation failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/pre-checks", response_model=CheckResponse)
async def api_pre_checks(request: DeployRequest):
    """
    Run pre-deployment checks against real devices via Nornir/Netmiko:
      - ICMP reachability
      - SSH connectivity
      - Software version validation
      - Running-config backup
    """
    t0 = time.time()
    try:
        results = await asyncio.to_thread(
            run_pre_checks,
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
        log.exception("Pre-checks failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/deploy", response_model=DeployResponse)
async def api_deploy(request: DeployRequest):
    """
    Push generated configs to devices via Nornir/Netmiko.
    With dry_run=True (default) configs are rendered but NOT pushed.
    With dry_run=False configs are pushed with a 30-second confirm-commit guard.
    """
    t0 = time.time()
    try:
        # Generate configs first
        configs = generate_all_configs(request.state.model_dump())
        results = await asyncio.to_thread(
            deploy_configs,
            configs,
            request.inventory,
            request.dry_run,
        )
        return DeployResponse(
            results=results,
            dry_run=request.dry_run,
            duration_s=round(time.time() - t0, 2),
        )
    except Exception as exc:
        log.exception("Deployment failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/post-checks", response_model=CheckResponse)
async def api_post_checks(request: DeployRequest):
    """
    Run post-deployment validation:
      - BGP neighbor state (Established)
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
