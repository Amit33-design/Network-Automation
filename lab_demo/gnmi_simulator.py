"""gNMI telemetry simulator for demo mode.

Generates realistic per-device metrics without connecting to real hardware.
Publishes to prometheus_client Gauges every 15 seconds so that /metrics
stays populated when DEMO_MODE=true.

Import guard: if prometheus_client is not installed the module loads fine
but start_gnmi_simulator() logs a warning and exits immediately.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import List

logger = logging.getLogger(__name__)

# ── Prometheus metric definitions (mirrors gnmi_collector.py) ─────────────────

_PROM_AVAILABLE = False
try:
    from prometheus_client import Counter, Gauge
    _PROM_AVAILABLE = True
except ImportError:
    pass

if _PROM_AVAILABLE:
    _CPU_UTIL = Gauge(
        "gnmi_cpu_utilization",
        "Device CPU utilisation %",
        ["device"],
    )
    _MEM_UTIL = Gauge(
        "gnmi_memory_utilization",
        "Device memory utilisation %",
        ["device"],
    )
    _BGP_PREFIXES = Gauge(
        "gnmi_bgp_prefixes_received",
        "BGP prefixes received from all neighbours",
        ["device"],
    )
    _IF_ERRORS_IN = Counter(
        "gnmi_interface_errors_in_total",
        "Cumulative inbound interface errors",
        ["device"],
    )
    _IF_ERRORS_OUT = Counter(
        "gnmi_interface_errors_out_total",
        "Cumulative outbound interface errors",
        ["device"],
    )
    _PFC_DROPS = Gauge(
        "gnmi_pfc_watchdog_drops_total",
        "PFC watchdog drop events (GPU fabric)",
        ["device"],
    )
    _THROUGHPUT = Gauge(
        "gnmi_throughput_mbps",
        "Aggregate device throughput Mbps",
        ["device"],
    )

# ── Per-device base load profiles ─────────────────────────────────────────────

def _base_profile(name: str) -> dict:
    """Return a deterministic base load profile seeded by hostname."""
    seed = sum(ord(c) for c in name)
    rng = random.Random(seed)
    is_spine = "spine" in name
    is_gpu   = "gpu" in name
    is_fw    = "fw" in name or "firewall" in name

    return {
        "cpu_base":  rng.uniform(55, 75) if is_gpu else rng.uniform(30, 55) if is_spine else rng.uniform(10, 40),
        "mem_base":  rng.uniform(50, 70) if is_spine else rng.uniform(30, 65),
        "bgp_peers": 0 if "access" in name or "vedge" in name else rng.randint(2, 6),
        "pfc_base":  rng.uniform(50, 500) if is_gpu else 0.0,
        "tput_base": rng.uniform(5000, 40000) if is_spine else rng.uniform(200, 8000),
    }


class GnmiSimulator:
    """Background asyncio task that refreshes Prometheus metrics every tick."""

    TICK_SECONDS = 15
    SPIKE_PROB   = 0.03  # 3 % per device per tick → ~1 spike / 5 min across fleet

    def __init__(self, device_names: List[str]) -> None:
        self._devices = device_names
        self._profiles = {n: _base_profile(n) for n in device_names}
        self._tick = 0
        # stateful error counters (always increasing)
        self._err_in  = {n: 0.0 for n in device_names}
        self._err_out = {n: 0.0 for n in device_names}

    async def run(self) -> None:
        """Loop forever, updating metrics every TICK_SECONDS."""
        fault_device = os.getenv("FAULT_DEVICE", "")
        while True:
            self._tick += 1
            rng = random.Random(self._tick)
            for name in self._devices:
                p = self._profiles[name]

                # CPU with optional spike
                cpu = p["cpu_base"] + rng.gauss(0, p["cpu_base"] * 0.05)
                if rng.random() < self.SPIKE_PROB:
                    cpu = min(95.0, cpu + rng.uniform(25, 45))
                if name == fault_device:
                    cpu = min(98.0, cpu + 40)
                cpu = max(1.0, min(99.0, cpu))

                # Memory
                mem = p["mem_base"] + rng.gauss(0, 3)
                if name == fault_device:
                    mem = min(99.0, mem + 20)
                mem = max(5.0, min(99.0, mem))

                # BGP prefixes (stable with small jitter)
                bgp = p["bgp_peers"] * rng.randint(100, 512)
                if name == fault_device:
                    bgp = max(0, bgp - rng.randint(50, bgp or 1))

                # PFC drops (GPU leaves only)
                pfc = p["pfc_base"] + rng.gauss(0, p["pfc_base"] * 0.1) if p["pfc_base"] else 0
                if name == fault_device:
                    pfc = min(50000, pfc * 10)

                # Interface errors — slowly increasing counters
                self._err_in[name]  += rng.randint(0, 3 if name != fault_device else 50)
                self._err_out[name] += rng.randint(0, 2 if name != fault_device else 30)

                # Throughput
                tput = p["tput_base"] + rng.gauss(0, p["tput_base"] * 0.08)
                tput = max(0, tput)

                if _PROM_AVAILABLE:
                    _CPU_UTIL.labels(device=name).set(round(cpu, 2))
                    _MEM_UTIL.labels(device=name).set(round(mem, 2))
                    _BGP_PREFIXES.labels(device=name).set(bgp)
                    _PFC_DROPS.labels(device=name).set(round(pfc, 1))
                    _THROUGHPUT.labels(device=name).set(round(tput, 1))
                    # Counters: set the delta since last tick
                    # (prometheus_client counters are monotonic; we track cumulative)

            logger.debug("gNMI simulator tick %d updated %d devices", self._tick, len(self._devices))
            await asyncio.sleep(self.TICK_SECONDS)


async def start_gnmi_simulator(device_names: List[str]) -> None:
    """Entry point called from server.py startup when DEMO_MODE=true."""
    if not _PROM_AVAILABLE:
        logger.warning(
            "prometheus_client not installed — gNMI simulator metrics disabled. "
            "Install it with: pip install prometheus-client"
        )
        return
    logger.info("Starting gNMI simulator for %d devices", len(device_names))
    sim = GnmiSimulator(device_names)
    await sim.run()
