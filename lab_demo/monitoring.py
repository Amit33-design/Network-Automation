"""Continuous monitoring engine for all lab device types.

Polls each device via the DeviceSimulator and classifies health as
HEALTHY / DEGRADED / DOWN based on CPU, interface states, and
role-specific indicators (BGP, HA sync, VIP status, RDMA, etc.).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

from .devices import DeviceRole, LabDevice
from .simulator import DeviceSimulator


class HealthStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    DOWN = "down"
    UNKNOWN = "unknown"


@dataclass
class DeviceHealth:
    device_name: str
    role: DeviceRole
    status: HealthStatus
    metrics: Dict = field(default_factory=dict)
    alerts: List[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)


class MonitoringEngine:
    """Poll lab devices and track health status.

    Args:
        simulator: DeviceSimulator instance (created automatically if omitted).
    """

    CPU_WARN = 80
    CPU_CRIT = 95

    def __init__(self, simulator: Optional[DeviceSimulator] = None) -> None:
        self._sim = simulator or DeviceSimulator()
        self.health: Dict[str, DeviceHealth] = {}
        self._alert_cb: Optional[Callable[[DeviceHealth], None]] = None

    def on_alert(self, callback: Callable[[DeviceHealth], None]) -> None:
        """Register a callback invoked whenever a device has alerts."""
        self._alert_cb = callback

    def poll_device(
        self, device: LabDevice, fail_checks: Optional[List[str]] = None
    ) -> DeviceHealth:
        """Poll one device and return its current health."""
        data = self._sim.collect(device, fail_checks or [])
        alerts: List[str] = []
        status = HealthStatus.HEALTHY

        # CPU threshold
        cpu = data.get("cpu", 0)
        if cpu >= self.CPU_CRIT:
            alerts.append(f"CPU critical: {cpu}%")
            status = HealthStatus.DOWN
        elif cpu >= self.CPU_WARN:
            alerts.append(f"CPU high: {cpu}%")
            status = HealthStatus.DEGRADED

        # Interface states
        for name, idata in data.get("interfaces", {}).items():
            if idata.get("state") != "up":
                alerts.append(f"Interface {name} is DOWN")
                if status == HealthStatus.HEALTHY:
                    status = HealthStatus.DEGRADED

        # Role-specific checks
        if device.role == DeviceRole.ROUTER:
            for nbr, bgp in data.get("bgp", {}).get("neighbors", {}).items():
                if bgp.get("state") != "Established":
                    alerts.append(f"BGP neighbor {nbr} not Established")
                    if status == HealthStatus.HEALTHY:
                        status = HealthStatus.DEGRADED

        elif device.role in (DeviceRole.FIREWALL, DeviceRole.GPU_FIREWALL):
            ha = data.get("ha", {})
            if ha.get("peer") and not ha.get("sync", True):
                alerts.append("HA sync lost with peer")
                if status == HealthStatus.HEALTHY:
                    status = HealthStatus.DEGRADED
            if device.role == DeviceRole.GPU_FIREWALL:
                rdma = data.get("rdma", {})
                if rdma.get("rocev2_sessions", 1) == 0:
                    alerts.append("No active RoCEv2 sessions through GPU firewall")
                    if status == HealthStatus.HEALTHY:
                        status = HealthStatus.DEGRADED

        elif device.role == DeviceRole.LOAD_BALANCER:
            for vs, vsdata in data.get("virtual_servers", {}).items():
                if vsdata.get("status") != "green":
                    alerts.append(f"VIP {vs} unhealthy")
                    if status == HealthStatus.HEALTHY:
                        status = HealthStatus.DEGRADED

        elif device.role == DeviceRole.GPU_SERVER:
            for iface, idata in data.get("rdma_interfaces", {}).items():
                if idata.get("state") != "up":
                    alerts.append(f"RDMA interface {iface} DOWN")
                    if status == HealthStatus.HEALTHY:
                        status = HealthStatus.DEGRADED
            for gid, gdata in data.get("gpus", {}).items():
                if gdata.get("state") != "healthy":
                    alerts.append(f"GPU {gid} fault")
                    if status == HealthStatus.HEALTHY:
                        status = HealthStatus.DEGRADED

        health = DeviceHealth(
            device_name=device.name,
            role=device.role,
            status=status,
            metrics={
                "cpu": cpu,
                "uptime_seconds": data.get("uptime_seconds", 0),
            },
            alerts=alerts,
        )
        self.health[device.name] = health

        if alerts and self._alert_cb:
            self._alert_cb(health)

        return health

    def poll_all(
        self,
        devices: List[LabDevice],
        fail_devices: Optional[Dict[str, List[str]]] = None,
    ) -> Dict[str, DeviceHealth]:
        """Poll all devices. ``fail_devices`` maps name → list of fail_check keys."""
        fail_devices = fail_devices or {}
        for device in devices:
            self.poll_device(device, fail_devices.get(device.name))
        return self.health

    def summary(self) -> Dict:
        counts: Dict[str, int] = {s.value: 0 for s in HealthStatus}
        for h in self.health.values():
            counts[h.status.value] += 1
        all_alerts = [
            {"device": h.device_name, "alert": a}
            for h in self.health.values()
            for a in h.alerts
        ]
        return {
            "total": len(self.health),
            "healthy": counts[HealthStatus.HEALTHY],
            "degraded": counts[HealthStatus.DEGRADED],
            "down": counts[HealthStatus.DOWN],
            "unknown": counts[HealthStatus.UNKNOWN],
            "alerts": all_alerts,
        }
