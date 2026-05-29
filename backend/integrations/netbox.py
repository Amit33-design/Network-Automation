"""
Netbox IPAM integration — prefix allocation and write-back.

Config keys:
  base_url   — https://netbox.yourcompany.com
  token      — Netbox API token (Settings → API Tokens)
  site_slug  — default site slug for device creation (optional)
  tenant_id  — default tenant ID to assign to prefixes (optional)
"""

from __future__ import annotations
import logging
from typing import Any
import httpx

log = logging.getLogger("netdesign.integrations.netbox")


async def _get_config(org_id: str) -> dict | None:
    try:
        from db import _SessionLocal
        from models import IntegrationConfig
        from sqlalchemy import select
        if not _SessionLocal:
            return None
        async with _SessionLocal() as s:
            row = await s.execute(
                select(IntegrationConfig).where(
                    IntegrationConfig.org_id == org_id,
                    IntegrationConfig.provider == "netbox",
                    IntegrationConfig.enabled == True,
                )
            )
            cfg = row.scalar_one_or_none()
            return cfg.config if cfg else None
    except Exception:
        return None


def _client(cfg: dict) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=cfg["base_url"].rstrip("/"),
        headers={
            "Authorization": f"Token {cfg['token']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        timeout=10.0,
    )


async def get_available_prefix(org_id: str, within: str, prefix_length: int) -> str | None:
    """
    Find the next available prefix of the given length within a parent prefix.

    Args:
        within:        Parent prefix CIDR (e.g. "10.0.0.0/8")
        prefix_length: Desired prefix length (e.g. 24 for /24)

    Returns:
        CIDR string of available prefix (e.g. "10.0.1.0/24") or None.
    """
    cfg = await _get_config(org_id)
    if not cfg:
        return None
    try:
        async with _client(cfg) as client:
            resp = await client.get(
                f"/api/ipam/prefixes/",
                params={"prefix": within, "limit": 1},
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                log.warning("Netbox: parent prefix %s not found", within)
                return None

            parent_id = results[0]["id"]
            avail = await client.get(
                f"/api/ipam/prefixes/{parent_id}/available-prefixes/",
                params={"limit": 1},
            )
            avail.raise_for_status()
            available = avail.json()

            for prefix in available:
                if prefix.get("prefix_length", 0) <= prefix_length:
                    # Can carve a /prefix_length out of this block
                    base_addr = prefix["prefix"].split("/")[0]
                    return f"{base_addr}/{prefix_length}"

            return None
    except Exception as exc:
        log.warning("Netbox get_available_prefix failed: %s", exc)
        return None


async def allocate_prefix(
    org_id: str,
    prefix: str,
    description: str = "",
    tags: list[str] | None = None,
) -> dict | None:
    """
    Claim a prefix in Netbox (set status=active).
    Returns the created prefix object or None on failure.
    """
    cfg = await _get_config(org_id)
    if not cfg:
        return None
    try:
        body: dict[str, Any] = {
            "prefix": prefix,
            "status": "active",
            "description": description or f"Allocated by NetDesign AI",
        }
        if cfg.get("tenant_id"):
            body["tenant"] = int(cfg["tenant_id"])
        if tags:
            body["tags"] = [{"name": t} for t in tags]

        async with _client(cfg) as client:
            resp = await client.post("/api/ipam/prefixes/", json=body)
            resp.raise_for_status()
            result = resp.json()
            log.info("Netbox prefix allocated: %s (id=%s)", prefix, result.get("id"))
            return result
    except Exception as exc:
        log.warning("Netbox allocate_prefix failed: %s", exc)
        return None


async def sync_devices(org_id: str, devices: list[dict]) -> list[str]:
    """
    Upsert devices into Netbox DCIM.
    Each device dict: {hostname, mgmt_ip, platform, vendor, model, role, site}
    Returns list of error messages (empty = all succeeded).
    """
    cfg = await _get_config(org_id)
    if not cfg:
        return ["Netbox not configured"]

    errors: list[str] = []
    try:
        async with _client(cfg) as client:
            # Fetch existing devices to decide create vs patch
            existing_r = await client.get(
                "/api/dcim/devices/", params={"limit": 1000}
            )
            existing_r.raise_for_status()
            existing = {d["name"]: d for d in existing_r.json().get("results", [])}

            for dev in devices:
                hostname = dev.get("hostname", "")
                if not hostname:
                    continue

                payload: dict[str, Any] = {
                    "name":        hostname,
                    "device_role": {"slug": dev.get("role", "leaf").lower()},
                    "device_type": {"model": dev.get("model", dev.get("platform", ""))},
                    "site":        {"slug": dev.get("site") or cfg.get("site_slug", "default")},
                    "platform":    {"slug": dev.get("platform", "").lower()},
                    "status":      "active",
                }

                try:
                    if hostname in existing:
                        dev_id = existing[hostname]["id"]
                        r = await client.patch(f"/api/dcim/devices/{dev_id}/", json=payload)
                    else:
                        r = await client.post("/api/dcim/devices/", json=payload)
                    r.raise_for_status()

                    # Set primary IP
                    mgmt_ip = dev.get("mgmt_ip", "")
                    if mgmt_ip:
                        dev_id = r.json().get("id")
                        ip_r = await client.post("/api/ipam/ip-addresses/", json={
                            "address": mgmt_ip if "/" in mgmt_ip else f"{mgmt_ip}/32",
                            "assigned_object_type": "dcim.device",
                            "assigned_object_id": dev_id,
                            "status": "active",
                        })
                        if ip_r.is_success:
                            ip_id = ip_r.json().get("id")
                            await client.patch(f"/api/dcim/devices/{dev_id}/", json={"primary_ip4": ip_id})
                except Exception as e:
                    errors.append(f"{hostname}: {e}")
    except Exception as exc:
        errors.append(f"Netbox connection failed: {exc}")

    return errors
