"""
ZTP FastAPI Router
===================
Endpoints:
  GET  /ztp/bootstrap/{serial}     — serve Day 0 config to booting device
  GET  /ztp/script/{platform}      — serve POAP/EOS-ZTP Python script
  POST /ztp/checkin/{serial}       — device reports provisioning result
  POST /ztp/register               — pre-register devices
  POST /ztp/register/bulk          — bulk pre-register
  GET  /ztp/status                 — all devices + stats
  GET  /ztp/device/{serial}        — single device status
  DELETE /ztp/device/{serial}      — remove from registry
  POST /ztp/device/{serial}/reset  — reset device to WAITING
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .server import ztp_server, ZTPDevice, ZTPState

log = logging.getLogger(__name__)
ztp_router = APIRouter(prefix="/ztp", tags=["ZTP"])

# Server base URL — used for generating script URLs
def _server_url(request: Request) -> str:
    base = os.getenv("ZTP_SERVER_URL", "")
    if not base:
        base = str(request.base_url).rstrip("/")
    return base


# ── Pydantic models ───────────────────────────────────────────────────────

class DeviceRegisterRequest(BaseModel):
    serial:      str
    hostname:    str
    platform:    str = "ios-xe"
    role:        str = "campus-access"
    mgmt_ip:     str
    mgmt_mask:   str = "255.255.255.0"
    mgmt_gw:     str = ""
    loopback_ip: str = ""
    bgp_asn:     int = 65000
    vlans:       list[dict[str, Any]] = Field(default_factory=list)
    extra:       dict[str, Any] = Field(default_factory=dict)


class BulkRegisterRequest(BaseModel):
    devices: list[DeviceRegisterRequest]


class CheckinRequest(BaseModel):
    success: bool
    detail:  str = ""


class DeviceStatusResponse(BaseModel):
    serial:         str
    hostname:       str
    platform:       str
    role:           str
    mgmt_ip:        str
    state:          str
    registered_at:  float
    contacted_at:   Optional[float]
    provisioned_at: Optional[float]
    last_seen:      Optional[float]
    error:          Optional[str]


def _dev_to_response(dev: ZTPDevice) -> DeviceStatusResponse:
    return DeviceStatusResponse(
        serial         = dev.serial,
        hostname       = dev.hostname,
        platform       = dev.platform,
        role           = dev.role,
        mgmt_ip        = dev.mgmt_ip,
        state          = dev.state.value,
        registered_at  = dev.registered_at,
        contacted_at   = dev.contacted_at,
        provisioned_at = dev.provisioned_at,
        last_seen      = dev.last_seen,
        error          = dev.error,
    )


# ── Device contacts server at boot ───────────────────────────────────────

@ztp_router.get("/bootstrap/{serial}", response_class=Response)
async def bootstrap(serial: str):
    """
    Booting device fetches its Day 0 config.
    Returns plain text config (IOS-XE/EOS/Junos) or Python script (NX-OS POAP).
    """
    config_text, mime = ztp_server.get_bootstrap_config(serial)
    log.info("ZTP bootstrap served: %s", serial)
    return Response(content=config_text, media_type=mime)


@ztp_router.get("/script/{platform}", response_class=Response)
async def platform_script(platform: str, request: Request):
    """
    Return POAP/ZTP script for a platform (NX-OS, EOS, IOS-XE).
    Device downloads this once, executes it; script then fetches per-device config.
    """
    server_url = _server_url(request)
    script = ztp_server.get_platform_script(platform, server_url)
    return Response(content=script, media_type="text/x-python")


@ztp_router.post("/checkin/{serial}")
async def checkin(serial: str, body: CheckinRequest):
    """Device reports success or failure after applying config."""
    dev = ztp_server.checkin(serial, body.success, body.detail)
    if not dev:
        # Unknown serial — register as unknown
        log.warning("ZTP checkin from unknown serial: %s", serial)
        return {"status": "unknown", "serial": serial}
    return {
        "status":  dev.state.value,
        "serial":  serial,
        "hostname": dev.hostname,
    }


# ── Management endpoints ─────────────────────────────────────────────────

@ztp_router.post("/register", response_model=DeviceStatusResponse)
async def register_device(body: DeviceRegisterRequest):
    """Pre-register a single device for ZTP onboarding."""
    dev = ZTPDevice(
        serial      = body.serial,
        hostname    = body.hostname,
        platform    = body.platform,
        role        = body.role,
        mgmt_ip     = body.mgmt_ip,
        mgmt_mask   = body.mgmt_mask,
        mgmt_gw     = body.mgmt_gw,
        loopback_ip = body.loopback_ip,
        bgp_asn     = body.bgp_asn,
        vlans       = body.vlans,
        extra       = body.extra,
    )
    ztp_server.register(dev)
    return _dev_to_response(dev)


@ztp_router.post("/register/bulk")
async def register_bulk(body: BulkRegisterRequest):
    """Bulk pre-register devices."""
    devices = [d.model_dump() for d in body.devices]
    registered = ztp_server.register_bulk(devices)
    return {
        "registered": len(registered),
        "devices": [_dev_to_response(d) for d in registered],
    }


@ztp_router.get("/status")
async def ztp_status():
    """Return all devices and summary stats."""
    devices = ztp_server.all_devices()
    return {
        "stats":   ztp_server.stats(),
        "devices": [_dev_to_response(d) for d in devices],
    }


@ztp_router.get("/device/{serial}", response_model=DeviceStatusResponse)
async def get_device(serial: str):
    """Return a single device's ZTP status."""
    dev = ztp_server.get(serial)
    if not dev:
        raise HTTPException(status_code=404, detail=f"Serial {serial} not registered")
    return _dev_to_response(dev)


@ztp_router.delete("/device/{serial}")
async def delete_device(serial: str):
    """Remove a device from the ZTP registry."""
    if not ztp_server.delete(serial):
        raise HTTPException(status_code=404, detail="Device not found")
    return {"deleted": serial}


@ztp_router.post("/device/{serial}/reset")
async def reset_device(serial: str):
    """Reset a device back to WAITING state (re-provision)."""
    dev = ztp_server.get(serial)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")
    from .server import ZTPState
    dev.state          = ZTPState.WAITING
    dev.contacted_at   = None
    dev.provisioned_at = None
    dev.error          = None
    ztp_server._save_registry()
    return _dev_to_response(dev)


@ztp_router.get("/dhcp-options")
async def dhcp_options(request: Request):
    """
    Return DHCP option 43/67 values for configuring ISC-DHCP or Kea.
    Operators paste this into their DHCP server config.
    """
    server_url = _server_url(request)
    return {
        "info": "Configure your DHCP server with these options to enable ZTP",
        "isc_dhcp": {
            "option_43_nxos_poap": (
                f'option space cisco_vts;\n'
                f'option cisco_vts.poap-server-ip code 1 = ip-address;\n'
                f'option cisco_vts.poap-server-port code 2 = unsigned integer 16;\n'
                f'# In subnet declaration:\n'
                f'option bootfile-name "http://{server_url.split("//")[-1]}/ztp/script/nxos";'
            ),
            "option_67_eos_ztp": (
                f'# For Arista EOS ZTP:\n'
                f'option bootfile-name "http://{server_url.split("//")[-1]}/ztp/script/eos";'
            ),
            "option_43_iosxe_pnp": (
                f'# For IOS-XE PnP:\n'
                f'option 43 ascii "5A;K4;B2;I{server_url.split("//")[-1]};J80";'
            ),
            "option_67_junos_ztp": (
                f'# For Junos ZTP:\n'
                f'option bootfile-name "http://{server_url.split("//")[-1]}/ztp/script/junos";'
            ),
        },
        "kea_dhcp": {
            "option-data": [
                {"name": "boot-file-name", "data": f"http://{server_url.split('//')[-1]}/ztp/script/nxos"},
            ]
        },
    }
