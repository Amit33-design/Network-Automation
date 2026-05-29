"""
gNMI streaming telemetry collector.

Subscribes to OpenConfig paths on each device and publishes live metrics
to in-process prometheus_client Gauge/Counter objects.

Each device runs in its own thread (pygnmi uses blocking generators);
reconnects automatically with exponential backoff on any error.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)

# ── Prometheus metrics (module-level singletons) ──────────────────────────────
try:
    from prometheus_client import Gauge, Counter

    BGP_PREFIXES   = Gauge("bgp_prefixes",    "BGP prefix count",           ["hostname", "peer", "afi"])
    INTERFACE_ERRS = Counter("interface_errs", "Interface error counter",    ["hostname", "interface", "direction"])
    CPU_UTIL       = Gauge("cpu_util",         "CPU utilization percent",    ["hostname"])
    MEM_UTIL       = Gauge("mem_util",         "Memory utilization percent", ["hostname"])
    PFC_DROPS      = Counter("pfc_drops",      "PFC watchdog drop count",    ["hostname", "interface", "priority"])
    _PROM_AVAILABLE = True
except ImportError:
    _PROM_AVAILABLE = False
    log.warning("prometheus_client not installed — telemetry metrics disabled")

# ── OpenConfig path map per platform ─────────────────────────────────────────
_OPENCONFIG_PATHS: dict[str, list[str]] = {
    "eos": [
        "openconfig-bgp:bgp/neighbors/neighbor/state/prefixes",
        "openconfig-interfaces:interfaces/interface/state/counters",
        "openconfig-system:system/cpus/cpu/state",
        "openconfig-qos:qos/interfaces/interface/output/queues/queue/state",
    ],
    "nxos": [
        "openconfig-bgp:bgp/neighbors/neighbor/state/prefixes",
        "openconfig-interfaces:interfaces/interface/state/counters",
        "openconfig-system:system/cpus/cpu/state",
    ],
    "sonic": [
        "openconfig-bgp:bgp/neighbors/neighbor/state/prefixes",
        "openconfig-interfaces:interfaces/interface/state/counters",
        "openconfig-system:system/cpus/cpu/state",
    ],
    "ios_xe": [
        "openconfig-bgp:bgp/neighbors/neighbor/state/prefixes",
        "openconfig-interfaces:interfaces/interface/state/counters",
        "openconfig-system:system/cpus/cpu/state",
    ],
}


@dataclass
class DeviceTarget:
    hostname: str
    mgmt_ip:  str
    port:     int  = 6030
    platform: str  = "eos"
    username: str  = ""
    password: str  = ""
    insecure: bool = True


class TelemetryCollector:
    """
    Manages one background thread per device, each running a blocking gNMI
    STREAM subscription. asyncio.to_thread isolates blocking I/O from the
    event loop.
    """

    def __init__(self, devices: list[DeviceTarget]) -> None:
        self._devices = devices
        self._tasks: list[asyncio.Task] = []
        self._running = False

    async def start(self) -> None:
        if not _PROM_AVAILABLE:
            log.warning("prometheus_client not available — telemetry collector skipped")
            return
        self._running = True
        for dev in self._devices:
            task = asyncio.create_task(
                asyncio.to_thread(self._subscribe_with_backoff, dev),
                name=f"gnmi-{dev.hostname}",
            )
            self._tasks.append(task)
        log.info("TelemetryCollector: %d device(s) started", len(self._devices))

    async def stop(self) -> None:
        self._running = False
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        log.info("TelemetryCollector stopped")

    def _subscribe_with_backoff(self, dev: DeviceTarget) -> None:
        backoff = 10
        while self._running:
            try:
                self._subscribe(dev)
                backoff = 10
            except Exception as exc:
                log.warning("gNMI %s lost: %s — retrying in %ds", dev.hostname, exc, backoff)
                for _ in range(backoff):
                    if not self._running:
                        return
                    time.sleep(1)
                backoff = min(backoff * 2, 60)

    def _subscribe(self, dev: DeviceTarget) -> None:
        try:
            from pygnmi.client import gNMIclient
        except ImportError:
            log.error("pygnmi not installed — cannot subscribe to %s", dev.hostname)
            return

        paths = _OPENCONFIG_PATHS.get(dev.platform, _OPENCONFIG_PATHS["eos"])
        target = (dev.mgmt_ip, dev.port)

        with gNMIclient(
            target=target,
            username=dev.username,
            password=dev.password,
            insecure=dev.insecure,
        ) as gc:
            subscribe_request = {
                "subscription": [
                    {"path": p, "mode": "sample", "sample_interval": 30_000_000_000}
                    for p in paths
                ],
                "mode":     "stream",
                "encoding": "json_ietf",
            }
            for response in gc.subscribe(subscribe=subscribe_request):
                if not self._running:
                    return
                self._process(dev.hostname, response)

    def _process(self, hostname: str, response: Any) -> None:
        updates = response.get("update", {}).get("update", [])
        for update in updates:
            path = update.get("path", "")
            val  = update.get("val", {})
            self._map_to_metric(hostname, path, val)

    def _map_to_metric(self, hostname: str, path: str, val: Any) -> None:
        if not _PROM_AVAILABLE:
            return
        try:
            if "bgp" in path and "prefix" in path:
                BGP_PREFIXES.labels(
                    hostname=hostname,
                    peer=_extract_path_key(path, "neighbor-address", "unknown"),
                    afi=_extract_path_key(path, "afi-safi-name", "IPV4_UNICAST"),
                ).set(_coerce_float(val))

            elif "interface" in path and "in-errors" in path:
                INTERFACE_ERRS.labels(
                    hostname=hostname,
                    interface=_extract_path_key(path, "name", "unknown"),
                    direction="in",
                ).inc(_coerce_float(val))

            elif "interface" in path and "out-errors" in path:
                INTERFACE_ERRS.labels(
                    hostname=hostname,
                    interface=_extract_path_key(path, "name", "unknown"),
                    direction="out",
                ).inc(_coerce_float(val))

            elif "cpu" in path and "instant" in path:
                CPU_UTIL.labels(hostname=hostname).set(_coerce_float(val))

            elif "memory" in path:
                MEM_UTIL.labels(hostname=hostname).set(_coerce_float(val))

            elif "pfc" in path.lower() or "watchdog" in path.lower():
                PFC_DROPS.labels(
                    hostname=hostname,
                    interface=_extract_path_key(path, "interface-id", "unknown"),
                    priority=_extract_path_key(path, "priority", "0"),
                ).inc(_coerce_float(val))
        except Exception:
            pass


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_path_key(path: str, key: str, default: str) -> str:
    import re
    m = re.search(rf"{re.escape(key)}=([^\]/]+)", path)
    return m.group(1) if m else default


def _coerce_float(val: Any) -> float:
    try:
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, dict):
            for k in ("value", "instant", "avg"):
                if k in val:
                    return float(val[k])
        return float(val)
    except Exception:
        return 0.0
