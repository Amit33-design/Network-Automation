"""
Netbox IPAM integration — prefix allocation, device sync, and config push.

Config keys:
  base_url   — https://netbox.yourcompany.com
  token      — Netbox API token (Settings → API Tokens)
  site_slug  — default site slug for device creation (optional)
  tenant_id  — default tenant ID to assign to prefixes (optional)
"""

from __future__ import annotations
import logging
from datetime import datetime
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


async def push_config_context(
    org_id:   str,
    hostname: str,
    config:   str,
    platform: str,
) -> bool:
    """
    Push a device's rendered configuration to NetBox as a Config Context.

    Creates a new Config Context named ``{hostname}-running-config`` (or PATCHes
    the existing one if a context with that name already exists).

    Args:
        org_id:   Organisation ID used to look up the NetBox integration config.
        hostname: Device hostname — used as part of the context name.
        config:   Rendered device configuration text.
        platform: Platform slug (e.g. "nxos", "eos", "junos").

    Returns:
        True on success, False on any failure.
    """
    if not config:
        log.error("push_config_context: empty config for %s — skipping", hostname)
        return False

    cfg = await _get_config(org_id)
    if not cfg:
        log.error("push_config_context: NetBox not configured for org %s", org_id)
        return False

    context_name = f"{hostname}-running-config"
    payload: dict[str, Any] = {
        "name": context_name,
        "data": {
            "rendered_config": config,
            "platform":        platform,
        },
        "is_active":   True,
        "description": f"Generated by NetDesign AI — {datetime.utcnow().isoformat()}",
    }

    try:
        async with _client(cfg) as client:
            search = await client.get(
                "/api/extras/config-contexts/",
                params={"name": context_name, "limit": 1},
            )
            search.raise_for_status()
            results = search.json().get("results", [])

            if results:
                ctx_id = results[0]["id"]
                resp = await client.patch(
                    f"/api/extras/config-contexts/{ctx_id}/",
                    json=payload,
                )
            else:
                resp = await client.post(
                    "/api/extras/config-contexts/",
                    json=payload,
                )

            resp.raise_for_status()
            log.info(
                "NetBox config context %s for %s (id=%s)",
                "updated" if results else "created",
                hostname,
                resp.json().get("id"),
            )
            return True

    except Exception as exc:
        log.error("push_config_context failed for %s: %s", hostname, exc)
        return False


async def push_device_config(
    org_id:   str,
    hostname: str,
    config:   str,
    platform: str,
) -> dict:
    """
    Higher-level wrapper that pushes a device configuration to NetBox and
    returns a result dict.

    Args:
        org_id:   Organisation ID used to look up the NetBox integration config.
        hostname: Device hostname.
        config:   Rendered device configuration text (may be empty/None).
        platform: Platform slug (e.g. "nxos", "eos", "junos").

    Returns:
        Dict with keys ``success`` (bool), ``hostname`` (str), ``url`` (str),
        and optionally ``error`` (str) on failure.
    """
    if not config:
        return {
            "success":  False,
            "hostname": hostname,
            "url":      "",
            "error":    f"No configuration provided for {hostname}",
        }

    success = await push_config_context(org_id, hostname, config, platform)

    cfg = await _get_config(org_id)
    base_url = (cfg or {}).get("base_url", "").rstrip("/")
    context_url = f"{base_url}/extras/config-contexts/?name={hostname}-running-config" if base_url else ""

    if success:
        return {
            "success":  True,
            "hostname": hostname,
            "url":      context_url,
        }
    else:
        return {
            "success":  False,
            "hostname": hostname,
            "url":      context_url,
            "error":    f"Failed to push config context for {hostname} — check logs",
        }
