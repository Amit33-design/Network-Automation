"""FastAPI backend for the NetDesign AI lab demo.

Serves the static web app and exposes REST endpoints that drive the
ZTP, Pre/Post Checks, Monitoring, Metrics Summary, and Demo Topology tabs.

Usage:
  pip install fastapi uvicorn pyyaml
  uvicorn server:app --reload --port 8000
  # then open http://localhost:8000
"""
from __future__ import annotations

import os
import random
import sys
from datetime import datetime, timezone
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


# ── Demo topology catalog endpoint ───────────────────────────────────────────

# Expanded device catalog covering all 5 demo topologies
_DEMO_CATALOG = [
    # ── DC Leaf-Spine (IAD) ────────────────────────────────────────────────
    {"name": "spine-IAD-01", "role": "router", "platform": "cisco_nxos",   "management_ip": "10.0.0.1",  "model": "Nexus 9336C-FX2",       "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "spine-IAD-02", "role": "router", "platform": "cisco_nxos",   "management_ip": "10.0.0.2",  "model": "Nexus 9336C-FX2",       "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "leaf-IAD-01",  "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.0.0.11", "model": "Nexus 93180YC-FX",      "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "leaf-IAD-02",  "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.0.0.12", "model": "Nexus 93180YC-FX",      "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "leaf-IAD-03",  "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.0.0.13", "model": "Nexus 93180YC-FX",      "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "leaf-IAD-04",  "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.0.0.14", "model": "Nexus 93180YC-FX",      "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "fw-IAD-01",    "role": "firewall","platform": "paloalto_panos","management_ip": "10.0.0.21","model": "PA-5260 NGFW",          "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    {"name": "fw-IAD-02",    "role": "firewall","platform": "paloalto_panos","management_ip": "10.0.0.22","model": "PA-5260 NGFW",          "ztp_state": "online",       "tags": {"site": "IAD", "topology": "dc-medium"}},
    # ── GPU Cluster (SJC) ─────────────────────────────────────────────────
    {"name": "spine-SJC-01",      "role": "router", "platform": "cisco_nxos",   "management_ip": "10.1.0.1",  "model": "Nexus 9364C-GX",   "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large"}},
    {"name": "spine-SJC-02",      "role": "router", "platform": "cisco_nxos",   "management_ip": "10.1.0.2",  "model": "Nexus 9364C-GX",   "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large"}},
    {"name": "gpu-leaf-SJC-01",   "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.1.0.11", "model": "Nexus 9332C",      "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large", "gpu": "true"}},
    {"name": "gpu-leaf-SJC-02",   "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.1.0.12", "model": "Nexus 9332C",      "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large", "gpu": "true"}},
    {"name": "gpu-leaf-SJC-03",   "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.1.0.13", "model": "Nexus 9332C",      "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large", "gpu": "true"}},
    {"name": "gpu-leaf-SJC-04",   "role": "switch", "platform": "cisco_nxos",   "management_ip": "10.1.0.14", "model": "Nexus 9332C",      "ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large", "gpu": "true"}},
    {"name": "gpu-fw-SJC-01",     "role": "gpu_firewall","platform": "paloalto_panos","management_ip": "10.1.0.21","model": "PA-5260 NGFW","ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large"}},
    {"name": "gpu-fw-SJC-02",     "role": "gpu_firewall","platform": "paloalto_panos","management_ip": "10.1.0.22","model": "PA-5260 NGFW","ztp_state": "online",       "tags": {"site": "SJC", "topology": "gpu-large"}},
    # ── Campus (NYC) ──────────────────────────────────────────────────────
    {"name": "core-NYC-01",   "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.1",  "model": "Catalyst 9500-48Y4C",  "ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "core-NYC-02",   "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.2",  "model": "Catalyst 9500-48Y4C",  "ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "access-NYC-01", "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.11", "model": "Catalyst 9300L-48T-4G","ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "access-NYC-02", "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.12", "model": "Catalyst 9300L-48T-4G","ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "access-NYC-03", "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.13", "model": "Catalyst 9300L-48T-4G","ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "access-NYC-04", "role": "switch",  "platform": "cisco_iosxe",  "management_ip": "10.2.0.14", "model": "Catalyst 9300L-48T-4G","ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    {"name": "fw-NYC-01",     "role": "firewall","platform": "cisco_iosxe",  "management_ip": "10.2.0.21", "model": "Firepower 4145 NGFW",  "ztp_state": "online",       "tags": {"site": "NYC", "topology": "campus-medium"}},
    # ── WAN Edge (CHI) ────────────────────────────────────────────────────
    {"name": "wan-CHI-01",   "role": "router", "platform": "cisco_iosxe",   "management_ip": "10.3.0.1",  "model": "ASR 1002-HX",           "ztp_state": "online",       "tags": {"site": "CHI", "topology": "wan-small"}},
    {"name": "wan-CHI-02",   "role": "router", "platform": "cisco_iosxe",   "management_ip": "10.3.0.2",  "model": "ASR 1002-HX",           "ztp_state": "online",       "tags": {"site": "CHI", "topology": "wan-small"}},
    {"name": "vedge-CHI-01", "role": "router", "platform": "cisco_iosxe",   "management_ip": "10.3.0.11", "model": "Catalyst SD-WAN vEdge 2000","ztp_state": "online",   "tags": {"site": "CHI", "topology": "wan-small"}},
    {"name": "vedge-CHI-02", "role": "router", "platform": "cisco_iosxe",   "management_ip": "10.3.0.12", "model": "Catalyst SD-WAN vEdge 2000","ztp_state": "online",   "tags": {"site": "CHI", "topology": "wan-small"}},
    # ── Multi-Site DCI (LON) ──────────────────────────────────────────────
    {"name": "spine-LON-01", "role": "router", "platform": "arista_eos",    "management_ip": "10.4.0.1",  "model": "Arista 7050CX3-32S",    "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "spine-LON-02", "role": "router", "platform": "arista_eos",    "management_ip": "10.4.0.2",  "model": "Arista 7050CX3-32S",    "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "leaf-LON-01",  "role": "switch", "platform": "juniper_junos", "management_ip": "10.4.0.11", "model": "QFX5120-48Y",           "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "leaf-LON-02",  "role": "switch", "platform": "juniper_junos", "management_ip": "10.4.0.12", "model": "QFX5120-48Y",           "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "leaf-LON-03",  "role": "switch", "platform": "juniper_junos", "management_ip": "10.4.0.13", "model": "QFX5120-48Y",           "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "leaf-LON-04",  "role": "switch", "platform": "juniper_junos", "management_ip": "10.4.0.14", "model": "QFX5120-48Y",           "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "fw-LON-01",    "role": "firewall","platform": "paloalto_panos","management_ip": "10.4.0.21", "model": "PA-5260 NGFW",          "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
    {"name": "fw-LON-02",    "role": "firewall","platform": "paloalto_panos","management_ip": "10.4.0.22", "model": "PA-5260 NGFW",          "ztp_state": "online",       "tags": {"site": "LON", "topology": "multisite-medium"}},
]

_DEMO_TOPOLOGY_META = [
    {"id": "dc-medium",        "label": "Data Center Leaf-Spine",  "use_case": "dc",        "scale": "medium", "site_code": "IAD", "device_names": [d["name"] for d in _DEMO_CATALOG if d["tags"].get("topology") == "dc-medium"]},
    {"id": "gpu-large",        "label": "AI/GPU Cluster Fabric",   "use_case": "gpu",       "scale": "large",  "site_code": "SJC", "device_names": [d["name"] for d in _DEMO_CATALOG if d["tags"].get("topology") == "gpu-large"]},
    {"id": "campus-medium",    "label": "Enterprise Campus",       "use_case": "campus",    "scale": "medium", "site_code": "NYC", "device_names": [d["name"] for d in _DEMO_CATALOG if d["tags"].get("topology") == "campus-medium"]},
    {"id": "wan-small",        "label": "WAN Edge / SD-WAN",       "use_case": "wan",       "scale": "small",  "site_code": "CHI", "device_names": [d["name"] for d in _DEMO_CATALOG if d["tags"].get("topology") == "wan-small"]},
    {"id": "multisite-medium", "label": "Multi-Site DCI",          "use_case": "multisite", "scale": "medium", "site_code": "LON", "device_names": [d["name"] for d in _DEMO_CATALOG if d["tags"].get("topology") == "multisite-medium"]},
]


def _base_cpu(name: str) -> float:
    """Return a deterministic base CPU% seeded by hostname."""
    seed = sum(ord(c) for c in name)
    rng = random.Random(seed)
    if "spine" in name:
        return rng.uniform(30, 55)
    if "gpu" in name:
        return rng.uniform(55, 75)
    if "fw" in name or "firewall" in name:
        return rng.uniform(20, 40)
    return rng.uniform(15, 45)


def _device_metrics(name: str) -> dict:
    """Return realistic simulated metrics for a single device."""
    rng = random.Random(sum(ord(c) for c in name) + int(datetime.now(timezone.utc).minute / 5))
    base_cpu = _base_cpu(name)
    cpu = round(base_cpu + rng.gauss(0, base_cpu * 0.05), 1)
    cpu = max(1.0, min(99.0, cpu))
    mem = round(rng.uniform(40, 75) + rng.gauss(0, 3), 1)
    bgp_up = 0 if "access" in name or "vedge" in name else rng.randint(2, 6)
    return {
        "cpu_util": cpu,
        "mem_util": mem,
        "interface_errors_in": rng.randint(0, 5),
        "interface_errors_out": rng.randint(0, 3),
        "bgp_sessions_up": bgp_up,
        "bgp_prefixes_received": bgp_up * rng.randint(100, 512) if bgp_up else 0,
        "pfc_drops": rng.randint(0, 200) if "gpu" in name else 0,
        "throughput_mbps": round(rng.uniform(200, 40000), 1),
    }


@app.get("/api/lab/demo-topologies")
def get_demo_topologies():
    """Return the 5 pre-built demo topology descriptors."""
    return _DEMO_TOPOLOGY_META


@app.get("/api/lab/devices")
def get_lab_devices():
    """Return the expanded 35-device catalog covering all demo topologies."""
    return _DEMO_CATALOG


@app.get("/api/metrics/summary")
def get_metrics_summary():
    """Return a current simulated metrics snapshot for all demo devices."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "devices": {d["name"]: _device_metrics(d["name"]) for d in _DEMO_CATALOG},
    }


# ── gNMI simulator background task ────────────────────────────────────────────
# Started automatically when DEMO_MODE=true environment variable is set.
# It updates prometheus_client Gauges every 15 s so /metrics stays fresh.

_GNMI_TASK = None


@app.on_event("startup")
async def _start_gnmi_sim():
    global _GNMI_TASK
    if os.getenv("DEMO_MODE", "false").lower() == "true":
        try:
            from lab_demo.gnmi_simulator import start_gnmi_simulator
            import asyncio
            _GNMI_TASK = asyncio.create_task(
                start_gnmi_simulator([d["name"] for d in _DEMO_CATALOG])
            )
        except Exception:
            pass  # optional dependency; skip if not installed


@app.on_event("shutdown")
async def _stop_gnmi_sim():
    if _GNMI_TASK and not _GNMI_TASK.done():
        _GNMI_TASK.cancel()


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
