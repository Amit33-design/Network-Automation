"""FastAPI backend for the NetDesign AI lab demo.

Serves the static web app and exposes REST endpoints that drive the
ZTP, Pre/Post Checks, and Monitoring tabs.

Usage:
  pip install fastapi uvicorn pyyaml
  uvicorn server:app --reload --port 8000
  # then open http://localhost:8000
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

app = FastAPI(title="NetDesign AI — Lab Demo", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _fresh_topology():
    """Return a freshly-parsed topology so state never bleeds between requests."""
    from lab_demo.topology import LabTopology
    return LabTopology.from_yaml(ROOT / "lab_topologies" / "demo_full_datacenter.yaml")


def _checker_map():
    from lab_demo.checks import (
        FirewallChecker,
        LoadBalancerChecker,
        RouterChecker,
        SwitchChecker,
    )
    from lab_demo.devices import DeviceRole

    return {
        DeviceRole.ROUTER: RouterChecker,
        DeviceRole.SWITCH: SwitchChecker,
        DeviceRole.FIREWALL: FirewallChecker,
        DeviceRole.GPU_FIREWALL: FirewallChecker,
        DeviceRole.LOAD_BALANCER: LoadBalancerChecker,
    }


def _check_to_dict(r) -> dict:
    device = r.device if isinstance(r.device, str) else r.device.name
    return {
        "device": device,
        "name": r.name,
        "status": r.status.value,
        "message": r.message,
        "remediation": r.remediation,
    }


def _monitoring_response(mon) -> dict:
    return {
        "health": {
            name: {
                "device_name": h.device_name,
                "role": h.role.value,
                "status": h.status.value,
                "metrics": h.metrics,
                "alerts": h.alerts,
            }
            for name, h in mon.health.items()
        },
        "summary": mon.summary(),
    }


# ── Pydantic request models ───────────────────────────────────────────────────

class ZTPRequest(BaseModel):
    fail_device: Optional[str] = None
    fail_at: Optional[str] = None


class FailDevicesPayload(BaseModel):
    fail_devices: Optional[Dict[str, List[str]]] = None


# ── Topology endpoints ────────────────────────────────────────────────────────

@app.get("/api/topology")
def get_topology_summary():
    return _fresh_topology().summary()


@app.get("/api/topology/devices")
def get_topology_devices():
    topo = _fresh_topology()
    return [
        {
            "name": d.name,
            "role": d.role.value,
            "platform": d.platform.value,
            "management_ip": d.management_ip,
            "model": d.model,
            "ztp_state": d.ztp_state.value,
            "tags": d.tags,
        }
        for d in topo.all_devices()
    ]


# ── ZTP endpoint ──────────────────────────────────────────────────────────────

@app.post("/api/ztp/run")
def run_ztp(req: ZTPRequest):
    from lab_demo.devices import ZTPState
    from lab_demo.ztp import ZTPEngine

    topo = _fresh_topology()
    engine = ZTPEngine()

    fail_devices: Dict[str, ZTPState] = {}
    if req.fail_device and req.fail_at:
        try:
            fail_devices[req.fail_device] = ZTPState(req.fail_at)
        except ValueError:
            pass

    engine.provision_topology(topo.all_devices(), fail_devices=fail_devices)

    return {
        "results": {d.name: d.ztp_state.value for d in topo.all_devices()},
        "events": [
            {
                "device_name": e.device_name,
                "state": e.state.value,
                "message": e.message,
                "success": e.success,
                "timestamp": e.timestamp,
            }
            for e in engine.history
        ],
        "summary": engine.summary(),
    }


# ── Check endpoints ───────────────────────────────────────────────────────────

@app.post("/api/checks/pre")
def run_pre_checks(req: FailDevicesPayload):
    from lab_demo.simulator import DeviceSimulator

    topo = _fresh_topology()
    sim = DeviceSimulator()
    cmap = _checker_map()
    fail = req.fail_devices or {}

    results = []
    for device in topo.all_devices():
        if device.role not in cmap:
            continue
        fc = fail.get(device.name) or None
        for r in cmap[device.role](device, sim).pre_checks(fail_checks=fc):
            results.append(_check_to_dict(r))

    return {"phase": "pre", "results": results}


@app.post("/api/checks/post")
def run_post_checks(req: FailDevicesPayload):
    from lab_demo.simulator import DeviceSimulator

    topo = _fresh_topology()
    sim = DeviceSimulator()
    cmap = _checker_map()
    fail = req.fail_devices or {}

    results = []
    for device in topo.all_devices():
        if device.role not in cmap:
            continue
        fc = fail.get(device.name) or None
        for r in cmap[device.role](device, sim).post_checks(fail_checks=fc):
            results.append(_check_to_dict(r))

    return {"phase": "post", "results": results}


# ── Monitoring endpoints ──────────────────────────────────────────────────────

@app.get("/api/monitoring/poll")
def poll_monitoring_clean():
    from lab_demo.monitoring import MonitoringEngine

    topo = _fresh_topology()
    mon = MonitoringEngine()
    mon.poll_all(topo.all_devices())
    return _monitoring_response(mon)


@app.post("/api/monitoring/poll")
def poll_monitoring_with_failures(req: FailDevicesPayload):
    from lab_demo.devices import DeviceInterface
    from lab_demo.monitoring import MonitoringEngine

    topo = _fresh_topology()
    mon = MonitoringEngine()
    fail = req.fail_devices or {}

    # Ensure devices targeted for interfaces_up failure have at least one interface
    for device_name, checks in fail.items():
        if "interfaces_up" in checks:
            device = topo.get_device(device_name)
            if device and not device.interfaces:
                device.interfaces = [DeviceInterface(name="eth0")]

    mon.poll_all(topo.all_devices(), fail_devices=fail)
    return _monitoring_response(mon)


# ── Static file serving ───────────────────────────────────────────────────────

# Serve the built React app from frontend/dist when available;
# fall back to the legacy vanilla index.html for development without a build.

_REACT_DIST = ROOT / "frontend" / "dist"
_LEGACY_INDEX = ROOT / "index.html"


@app.get("/")
async def serve_index():
    if (_REACT_DIST / "index.html").exists():
        return FileResponse(_REACT_DIST / "index.html")
    return FileResponse(_LEGACY_INDEX)


# SPA catch-all: serve React index for any non-API path (client-side routing)
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404)
    react_index = _REACT_DIST / "index.html"
    if react_index.exists():
        return FileResponse(react_index)
    return FileResponse(_LEGACY_INDEX)


if (_REACT_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_REACT_DIST / "assets")), name="assets")

app.mount("/src", StaticFiles(directory=str(ROOT / "src")), name="src")


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
