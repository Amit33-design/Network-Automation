"""
NetDesign AI — Upstash Redis rate limiting middleware

Two rate limiters:
  - config_gen_limit(user_id)  → free: 10 config-gen calls/hr, Pro: unlimited
  - api_limit(ip)              → global: 120 req/min per IP (DDoS guard)

Uses the Upstash Redis REST API (no persistent connection needed — perfect for
serverless and short-lived containers). Falls back to no-limit when env vars
are absent so dev mode is unaffected.

Usage in a FastAPI endpoint:
    from middleware.rate_limit import config_gen_limit, RateLimitExceeded

    @router.post("/api/generate-configs")
    async def generate_configs(req: ..., user=Depends(require_permission(...))):
        await config_gen_limit(user["sub"], plan=user.get("plan", "free"))
        ...
"""

from __future__ import annotations

import logging
import os
from typing import Literal

import httpx
from fastapi import HTTPException, status

log = logging.getLogger("netdesign.rate_limit")

REDIS_URL   = os.getenv("UPSTASH_REDIS_REST_URL", "")
REDIS_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")

_enabled = bool(REDIS_URL and REDIS_TOKEN)
if not _enabled:
    log.warning("Upstash env vars not set — rate limiting disabled")

FREE_CONFIG_GEN_LIMIT = int(os.getenv("FREE_CONFIG_GEN_PER_HR", "10"))
API_REQ_PER_MIN       = int(os.getenv("API_REQ_PER_MIN", "120"))


class RateLimitExceeded(HTTPException):
    def __init__(self, detail: str = "Rate limit exceeded", retry_after: int = 60):
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )


async def _incr(key: str, ttl_seconds: int) -> int:
    """INCR key in Upstash; set TTL on first write. Returns new count."""
    if not _enabled:
        return 0
    async with httpx.AsyncClient(timeout=5) as client:
        headers = {"Authorization": f"Bearer {REDIS_TOKEN}"}
        resp = await client.get(
            f"{REDIS_URL}/incr/{key}",
            headers=headers,
        )
        resp.raise_for_status()
        count = resp.json().get("result", 0)
        if count == 1:
            await client.get(f"{REDIS_URL}/expire/{key}/{ttl_seconds}", headers=headers)
        return count


async def _get(key: str) -> str | None:
    if not _enabled:
        return None
    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(
            f"{REDIS_URL}/get/{key}",
            headers={"Authorization": f"Bearer {REDIS_TOKEN}"},
        )
        resp.raise_for_status()
        return resp.json().get("result")


async def config_gen_limit(
    user_id: str,
    plan:    Literal["free", "pro", "team", "dept"] = "free",
) -> None:
    """
    Enforce per-user config-gen rate limit.
    Pro/Team/Dept plans: unlimited.
    Free plan: FREE_CONFIG_GEN_LIMIT calls per hour.
    When limit is hit, raises RateLimitExceeded → triggers upgrade modal.
    """
    if plan != "free" or not _enabled:
        return

    key   = f"ratelimit:config_gen:{user_id}"
    count = await _incr(key, ttl_seconds=3600)

    if count > FREE_CONFIG_GEN_LIMIT:
        log.info("Config-gen rate limit hit: user=%s count=%s", user_id, count)
        raise RateLimitExceeded(
            detail=(
                f"Free plan: {FREE_CONFIG_GEN_LIMIT} config generations per hour. "
                "Upgrade to Pro for unlimited access."
            ),
            retry_after=3600,
        )


async def api_rate_limit(ip: str) -> None:
    """Global per-IP guard — 120 req/min. Protects all public endpoints."""
    if not _enabled:
        return
    key   = f"ratelimit:api:{ip}"
    count = await _incr(key, ttl_seconds=60)
    if count > API_REQ_PER_MIN:
        log.warning("API rate limit hit: ip=%s count=%s", ip, count)
        raise RateLimitExceeded(detail="Too many requests", retry_after=60)


async def get_user_quota(user_id: str) -> dict:
    """Return remaining config-gen quota for the current hour (used by UI)."""
    if not _enabled:
        return {"used": 0, "limit": FREE_CONFIG_GEN_LIMIT, "unlimited": True}
    key  = f"ratelimit:config_gen:{user_id}"
    val  = await _get(key)
    used = int(val) if val else 0
    return {
        "used":      used,
        "limit":     FREE_CONFIG_GEN_LIMIT,
        "remaining": max(0, FREE_CONFIG_GEN_LIMIT - used),
        "unlimited": False,
    }
