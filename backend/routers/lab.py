"""
Lab simulation endpoints — demo topology, ZTP, checks, monitoring, alerts, RCA.
No database, no auth, no real devices. Used by wizard Steps 4–6 for offline demo.
All routes are prefixed /api via include_router in main.py and lab_server.py.
"""
from __future__ import annotations

import random
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

router = APIRouter(tags=["lab"])

# ── Static demo topology ──────────────────────────────────────────────────────

_DEVICES = [
    {"name": "IAD-SPINE-A01", "role": "spine",    "platform": "nxos",   "management_ip": "10.0.0.1",  "model": "Nexus 9336C-FX2",    "ztp_state": "online", "tags": ["dc", "spine", "cisco"]},
    {"name": "IAD-SPINE-A02", "role": "spine",    "platform": "nxos",   "management_ip": "10.0.0.2",  "model": "Nexus 9336C-FX2",    "ztp_state": "online", "tags": ["dc", "spine", "cisco"]},
    {"name": "IAD-LEAF-A01",  "role": "leaf",     "platform": "nxos",   "management_ip": "10.0.0.11", "model": "Nexus 93180YC-FX",   "ztp_state": "online", "tags": ["dc", "leaf", "cisco"]},
    {"name": "IAD-LEAF-A02",  "role": "leaf",     "platform": "nxos",   "management_ip": "10.0.0.12", "model": "Nexus 93180YC-FX",   "ztp_state": "online", "tags": ["dc", "leaf", "cisco"]},
    {"name": "IAD-LEAF-A03",  "role": "leaf",     "platform": "nxos",   "management_ip": "10.0.0.13", "model": "Nexus 93180YC-FX",   "ztp_state": "online", "tags": ["dc", "leaf", "cisco"]},
    {"name": "IAD-LEAF-A04",  "role": "leaf",     "platform": "nxos",   "management_ip": "10.0.0.14", "model": "Nexus 93180YC-FX",   "ztp_state": "online", "tags": ["dc", "leaf", "cisco"]},
    {"name": "IAD-FW-A01",   "role": "firewall", "platform": "iosxe",  "management_ip": "10.0.0.21", "model": "Catalyst 8000V",      "ztp_state": "online", "tags": ["dc", "firewall", "cisco"]},
    {"name": "IAD-FW-A02",   "role": "firewall", "platform": "panos",  "management_ip": "10.0.0.22", "model": "PA-3220",             "ztp_state": "online", "tags": ["dc", "firewall", "paloalto"]},
    {"name": "IAD-BORDER-01", "role": "wan-edge", "platform": "iosxe",  "management_ip": "10.0.0.31", "model": "ASR 1001-X",         "ztp_state": "online", "tags": ["wan", "cisco"]},
    {"name": "IAD-ARISTA-01", "role": "leaf",     "platform": "eos",    "management_ip": "10.0.0.41", "model": "DCS-7050CX3-32S",    "ztp_state": "online", "tags": ["dc", "leaf", "arista"]},
    {"name": "IAD-JNX-01",   "role": "spine",    "platform": "junos",  "management_ip": "10.0.0.51", "model": "QFX10002-36Q",        "ztp_state": "online", "tags": ["dc", "spine", "juniper"]},
    {"name": "IAD-GPU-SW-01", "role": "gpu-leaf", "platform": "nxos",   "management_ip": "10.0.0.61", "model": "Nexus 9364C-GX",     "ztp_state": "online", "tags": ["gpu", "cisco"]},
]

_ZTP_STAGES = [
    "dhcp_requested",
    "bootstrap_downloaded",
    "config_applied",
    "registered",
    "pre_checks_running",
    "pre_checks_passed",
    "online",
]

_CHECK_NAMES = [
    ("BGP session state",          "BGP sessions established"),
    ("Interface error counters",   "No interface errors detected"),
    ("LLDP neighbour count",       "Expected neighbours present"),
    ("NTP synchronisation",        "Clock synchronised to NTP server"),
    ("VXLAN tunnel state",         "All NVE peers reachable"),
    ("CPU utilisation",            "CPU below threshold (< 70 %)"),
    ("Memory utilisation",         "Memory below threshold (< 80 %)"),
    ("Route table count",          "BGP prefixes within expected range"),
    ("MTU consistency",            "MTU 9216 on all fabric links"),
    ("Config save state",          "Running config matches startup"),
]

_REMEDIATION = {
    "BGP session state":       "Check BGP peer config and reachability: `show bgp summary`",
    "Interface error counters":"Clear counters and check cable: `clear counters`, check SFP",
    "LLDP neighbour count":    "Verify cabling diagram and `show lldp neighbors`",
    "NTP synchronisation":     "Check NTP server reachability and `ntp server` config",
    "VXLAN tunnel state":      "Verify underlay IS-IS and loopback reachability",
    "CPU utilisation":         "Check running processes: `show processes cpu sorted`",
    "Memory utilisation":      "Check memory consumers: `show system resources`",
    "Route table count":       "Verify BGP peering and route policy",
    "MTU consistency":         "Set `mtu 9216` on all fabric interfaces",
    "Config save state":       "Run `copy running-config startup-config`",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()

def _uptime() -> int:
    return random.randint(3600 * 24 * 3, 3600 * 24 * 90)


# ── Topology ──────────────────────────────────────────────────────────────────

@router.get("/api/topology")
def topology_summary() -> dict[str, Any]:
    return {
        "total":         len(_DEVICES),
        "routers":       sum(1 for d in _DEVICES if d["role"] in ("wan-edge",)),
        "switches":      sum(1 for d in _DEVICES if d["role"] in ("spine", "leaf", "gpu-leaf")),
        "firewalls":     sum(1 for d in _DEVICES if d["role"] == "firewall"),
        "load_balancers": 0,
        "gpu_firewalls": 0,
        "gpu_servers":   0,
    }


@router.get("/api/topology/devices")
def topology_devices() -> list[dict[str, Any]]:
    return _DEVICES


# ── ZTP simulation ────────────────────────────────────────────────────────────

@router.post("/api/ztp/run")
def ztp_run(body: dict[str, Any] = {}) -> dict[str, Any]:
    fail_device = body.get("fail_device", "")
    fail_at     = body.get("fail_at", "config_applied")

    events: list[dict] = []
    results: dict[str, str] = {}

    for dev in _DEVICES:
        name = dev["name"]
        final_state = "online"

        for stage in _ZTP_STAGES:
            is_fail = (name == fail_device and stage == fail_at)
            events.append({
                "device_name": name,
                "state":       stage,
                "message":     f"{name}: {stage.replace('_', ' ').title()}",
                "success":     not is_fail,
                "timestamp":   _ts(),
            })
            if is_fail:
                final_state = "failed"
                break

        results[name] = final_state

    online = sum(1 for s in results.values() if s == "online")
    failed = sum(1 for s in results.values() if s == "failed")

    return {
        "results": results,
        "events":  events,
        "summary": {
            "total_events": len(events),
            "online":       online,
            "failed":       failed,
        },
    }


# ── Pre / Post checks ─────────────────────────────────────────────────────────

def _build_checks(phase: str, fail_devices: dict[str, list[str]]) -> dict[str, Any]:
    results = []
    for dev in _DEVICES:
        name = dev["name"]
        forced_fails = fail_devices.get(name, [])
        for check_name, pass_msg in _CHECK_NAMES:
            if check_name in forced_fails:
                status = "FAIL"
                message = f"{name}: {check_name} — check failed"
                remediation = _REMEDIATION.get(check_name)
            elif random.random() < 0.04:
                status = "WARN"
                message = f"{name}: {check_name} — minor anomaly detected"
                remediation = _REMEDIATION.get(check_name)
            else:
                status = "PASS"
                message = f"{name}: {pass_msg}"
                remediation = None
            results.append({
                "device":      name,
                "name":        check_name,
                "status":      status,
                "message":     message,
                "remediation": remediation,
            })
    return {"phase": phase, "results": results}


@router.post("/api/checks/pre")
def checks_pre(body: dict[str, Any] = {}) -> dict[str, Any]:
    return _build_checks("pre", body.get("fail_devices", {}))


@router.post("/api/checks/post")
def checks_post(body: dict[str, Any] = {}) -> dict[str, Any]:
    return _build_checks("post", body.get("fail_devices", {}))


# ── Monitoring ────────────────────────────────────────────────────────────────

@router.get("/api/monitoring/poll")
@router.post("/api/monitoring/poll")
def monitoring_poll(body: dict[str, Any] | None = None) -> dict[str, Any]:
    fail_devices: dict[str, list[str]] = (body or {}).get("fail_devices", {})
    health: dict[str, Any] = {}
    alert_list: list[dict] = []

    for dev in _DEVICES:
        name = dev["name"]
        forced = fail_devices.get(name, [])

        if "down" in forced:
            status = "down"
        elif "degraded" in forced or random.random() < 0.08:
            status = "degraded"
        else:
            status = "healthy"

        dev_alerts: list[str] = []
        if status == "down":
            dev_alerts.append("Device unreachable")
            alert_list.append({"device": name, "alert": "Device unreachable"})
        elif status == "degraded":
            dev_alerts.append("High CPU or interface errors")
            alert_list.append({"device": name, "alert": "Degraded — high CPU"})

        health[name] = {
            "device_name": name,
            "role":        dev["role"],
            "status":      status,
            "metrics": {
                "cpu":            round(random.uniform(5, 35) if status == "healthy" else random.uniform(70, 95), 1),
                "uptime_seconds": _uptime() if status != "down" else 0,
                "rx_errors":      0 if status == "healthy" else random.randint(10, 500),
                "tx_errors":      0,
            },
            "alerts": dev_alerts,
        }

    counts = {"healthy": 0, "degraded": 0, "down": 0}
    for h in health.values():
        counts[h["status"]] = counts.get(h["status"], 0) + 1

    return {
        "health": health,
        "summary": {
            "total":    len(_DEVICES),
            "healthy":  counts["healthy"],
            "degraded": counts["degraded"],
            "down":     counts["down"],
            "alerts":   alert_list,
        },
    }


# ── Alerts (lab flavour — matches frontend Alert type) ────────────────────────

@router.get("/api/alerts")
def lab_alerts() -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "id":        str(uuid.uuid4()),
            "device":    "IAD-SPINE-A01",
            "severity":  "warning",
            "summary":   "BGP prefix count dropped below threshold",
            "detail":    "Expected ≥ 500 prefixes from peer 10.0.1.2; received 312",
            "timestamp": now,
            "resolved":  False,
        },
        {
            "id":        str(uuid.uuid4()),
            "device":    "IAD-LEAF-A03",
            "severity":  "info",
            "summary":   "Interface Ethernet1/12 flapped",
            "detail":    "Link went down and restored within 4 s — possible SFP issue",
            "timestamp": now,
            "resolved":  True,
        },
        {
            "id":        str(uuid.uuid4()),
            "device":    "IAD-GPU-SW-01",
            "severity":  "critical",
            "summary":   "PFC watchdog triggered on priority 3",
            "detail":    "RoCEv2 no-drop queue deadlock detected — watchdog auto-restarted port",
            "timestamp": now,
            "resolved":  False,
        },
    ]


# ── RCA (lab flavour) ─────────────────────────────────────────────────────────

@router.post("/api/rca/analyze")
def lab_rca(body: dict[str, Any] = {}) -> list[dict[str, Any]]:
    symptom = body.get("symptom", "")
    devices  = body.get("devices", [])

    hypotheses = [
        {
            "rank":        1,
            "cause":       "BGP peer reset due to hold-timer expiry",
            "confidence":  0.82,
            "evidence":    [
                "BGP notification received: hold timer expired at 04:31 UTC",
                f"Affected device(s): {', '.join(devices) or 'IAD-SPINE-A01'}",
                "CPU spike to 91 % correlated with syslog storm at same timestamp",
            ],
            "remediation": "Increase BGP timers (keepalive 10 / hold 30) or enable BFD to detect link failure faster. Check for routing loop causing syslog storm.",
        },
        {
            "rank":        2,
            "cause":       "Upstream CRC errors causing selective packet drop",
            "confidence":  0.61,
            "evidence":    [
                "6 812 CRC errors on Ethernet1/48 in the past 24 h",
                "Packet loss correlated to traffic spikes on this interface",
            ],
            "remediation": "Replace SFP on Ethernet1/48. Run `show interface Ethernet1/48 counters errors` to confirm.",
        },
        {
            "rank":        3,
            "cause":       "ECMP hash polarisation (uneven load across spines)",
            "confidence":  0.38,
            "evidence":    [
                "Traffic imbalance: spine-01 carrying 78 % vs spine-02 carrying 22 %",
                "Hash seed not randomised after last config push",
            ],
            "remediation": "Set `ip load-sharing address source-destination rotating-hash` and verify with `show ip load-sharing`.",
        },
    ]

    if symptom and "pfc" in symptom.lower():
        hypotheses.insert(0, {
            "rank":        0,
            "cause":       "RoCEv2 PFC deadlock (priority 3 no-drop queue)",
            "confidence":  0.94,
            "evidence":    [
                "PFC watchdog triggered on gpu-leaf-01 priority queue 3",
                "CNP rate exceeded threshold: 18 000 CNP/s",
                "RDMA traffic paused for > 200 ms",
            ],
            "remediation": "Verify DCQCN parameters (Kmin/Kmax/Pmax). Increase ECN marking threshold. Check for NIC firmware mismatch.",
        })
        for i, h in enumerate(hypotheses):
            h["rank"] = i

    return hypotheses
