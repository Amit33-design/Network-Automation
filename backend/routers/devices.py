"""
NetDesign AI — Device Inventory Router
=========================================
Manages the device registry used by Nornir, ZTP, and monitoring.

Endpoints:
  GET    /api/devices          — list devices (filter by site/role/platform)
  POST   /api/devices          — register a device
  GET    /api/devices/{id}     — fetch device detail
  PUT    /api/devices/{id}     — update device metadata / ZTP state
  DELETE /api/devices/{id}     — remove device from inventory
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_permission
from audit import record
from db import get_db
from models import Device, DeviceCreate, DeviceRead

log = logging.getLogger("netdesign.routers.devices")

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("", response_model=list[DeviceRead])
async def list_devices(
    site: str | None = None,
    role: str | None = None,
    platform: str | None = None,
    ztp_state: str | None = None,
    design_id: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, le=1000),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:read")),
) -> list[DeviceRead]:
    """List devices with optional filters."""
    stmt = select(Device).offset(skip).limit(limit).order_by(Device.hostname)
    if site:
        stmt = stmt.where(Device.site == site)
    if role:
        stmt = stmt.where(Device.role == role)
    if platform:
        stmt = stmt.where(Device.platform == platform)
    if ztp_state:
        stmt = stmt.where(Device.ztp_state == ztp_state)
    if design_id:
        stmt = stmt.where(Device.design_id == design_id)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=DeviceRead, status_code=201)
async def register_device(
    body: DeviceCreate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> Device:
    """Register a new device. hostname must be unique."""
    existing = await db.execute(
        select(Device).where(Device.hostname == body.hostname)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Device '{body.hostname}' already registered",
        )

    device = Device(**body.model_dump())
    db.add(device)
    await db.flush()

    await record(
        user_id=user["sub"],
        action="device.register",
        resource_id=device.id,
        resource_type="device",
        outcome="success",
        detail={"hostname": device.hostname, "platform": device.platform},
    )
    log.info("Device registered: %s (%s)", device.hostname, device.platform)
    return device


@router.get("/{device_id}", response_model=DeviceRead)
async def get_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:read")),
) -> Device:
    return await _get_device(device_id, db)


@router.put("/{device_id}", response_model=DeviceRead)
async def update_device(
    device_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> Device:
    """Update device metadata. Accepts any subset of DeviceCreate fields."""
    device = await _get_device(device_id, db)
    allowed = {"mgmt_ip", "platform", "vendor", "model", "role", "site",
               "design_id", "ztp_state"}
    for field, value in body.items():
        if field in allowed:
            setattr(device, field, value)
    log.info("Device updated: %s by %s", device.hostname, user["sub"])
    return device


@router.delete("/{device_id}", status_code=204)
async def delete_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("designs:write")),
) -> None:
    device = await _get_device(device_id, db)
    await db.delete(device)
    log.info("Device deleted: %s by %s", device.hostname, user["sub"])


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

async def _get_device(device_id: str, db: AsyncSession) -> Device:
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found")
    return device
