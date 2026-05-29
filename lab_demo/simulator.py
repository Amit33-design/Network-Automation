"""Mock telemetry simulator for all lab device types (no real SSH needed)."""
from __future__ import annotations

from typing import Any, Dict, List

from .devices import DeviceRole, LabDevice


class DeviceSimulator:
    """Return synthetic show-command data for any device role.

    ``fail_checks`` is a list of check names whose underlying data should
    reflect a failure condition, e.g. ``["interfaces_up", "bgp_sessions"]``.
    """

    def collect(self, device: LabDevice, fail_checks: List[str] = None) -> Dict[str, Any]:
        fc = set(fail_checks or [])
        dispatch = {
            DeviceRole.ROUTER: self._router,
            DeviceRole.SWITCH: self._switch,
            DeviceRole.FIREWALL: self._firewall,
            DeviceRole.GPU_FIREWALL: self._gpu_firewall,
            DeviceRole.LOAD_BALANCER: self._load_balancer,
            DeviceRole.GPU_SERVER: self._gpu_server,
        }
        return dispatch.get(device.role, self._generic)(device, fc)

    # ── Per-role simulators ──────────────────────────────────────────────────

    def _router(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        iface_state = "down" if "interfaces_up" in fc else "up"
        bgp_state = "Idle" if "bgp_sessions" in fc else "Established"
        route_count = 0 if "routing_table" in fc else 150
        return {
            "interfaces": {
                iface.name: {"state": iface_state, "protocol": iface_state, "mtu": 1500}
                for iface in device.interfaces
            },
            "bgp": {
                "neighbors": {
                    n: {"state": bgp_state, "prefixes": 10}
                    for n in getattr(device, "bgp_neighbors", [])
                }
            },
            "routing": {
                "ospf": {"state": "Full", "neighbors": 2},
                "routes": route_count,
            },
            "cpu": 12,
            "memory_free_pct": 68,
            "uptime_seconds": 86400,
        }

    def _switch(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        iface_state = "down" if "interfaces_up" in fc else "up"
        vlan_state = "inactive" if "vlans_active" in fc else "active"
        return {
            "interfaces": {
                iface.name: {
                    "state": iface_state,
                    "vlan": 1,
                    "duplex": "full",
                    "speed": iface.speed,
                    "is_gpu_port": iface.is_gpu_port,
                }
                for iface in device.interfaces
            },
            "vlans": {
                str(v): {"state": vlan_state, "ports": 4}
                for v in getattr(device, "vlans", [100])
            },
            "spanning_tree": {
                "mode": "stp" if "stp_mode" in fc else "rapid-pvst",
                "root": device.name,
            },
            "mac_table_size": 512,
            "cpu": 8,
            "uptime_seconds": 86400,
        }

    def _firewall(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        ha_sync = not ("ha_active" in fc)
        return {
            "interfaces": {
                iface.name: {"state": "up", "zone": "trust"}
                for iface in device.interfaces
            },
            "ha": {
                "state": "active" if ha_sync else "passive",
                "peer": getattr(device, "ha_peer", None),
                "sync": ha_sync,
            },
            "sessions": {"active": 12543, "max": 200000},
            "policies": {"count": getattr(device, "policy_count", 50), "hits": 98241},
            "zones": getattr(device, "zones", []),
            "cpu": 23,
            "threat_prevention": "enabled",
            "uptime_seconds": 86400,
        }

    def _gpu_firewall(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        base = self._firewall(device, fc)
        rdma_ok = "rdma_policy" not in fc
        base["rdma"] = {
            "policy": getattr(device, "rdma_policy", "allow_rocev2"),
            "rocev2_sessions": 256 if rdma_ok else 0,
            "pfc_priority": 3,
        }
        base["protected_segments"] = getattr(device, "protected_segments", [])
        return base

    def _load_balancer(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        vs_status = "red" if "virtual_servers" in fc else "green"
        pm_state = "down" if "pool_members" in fc else "up"
        return {
            "interfaces": {
                iface.name: {"state": "up", "speed": iface.speed}
                for iface in device.interfaces
            },
            "virtual_servers": {
                vs: {"status": vs_status, "connections": 1024}
                for vs in getattr(device, "virtual_servers", [])
            },
            "pool_members": {
                pm: {"state": pm_state, "connections": 512}
                for pm in getattr(device, "pool_members", [])
            },
            "ssl": {"offload_enabled": True, "tps": 5000},
            "throughput_mbps": 4200,
            "health_monitor": getattr(device, "health_monitor", "tcp"),
            "cpu": 31,
            "uptime_seconds": 86400,
        }

    def _gpu_server(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        rdma_state = "down" if "rdma_interfaces" in fc else "up"
        gpu_state = "fault" if "gpu_health" in fc else "healthy"
        return {
            "rdma_interfaces": {
                iface: {"state": rdma_state, "mtu": 9000, "speed": "100G"}
                for iface in getattr(device, "rdma_interfaces", [])
            },
            "gpus": {
                f"gpu{i}": {"state": gpu_state, "memory_free_gb": 40}
                for i in range(getattr(device, "gpu_count", 8))
            },
            "roce": {
                "enabled": True,
                "pfc_priority": 3,
                "ecn_enabled": "ecn_disabled" not in fc,
            },
            "cpu": 15,
            "numa_nodes": 2,
            "uptime_seconds": 86400,
        }

    def _generic(self, device: LabDevice, fc: set) -> Dict[str, Any]:
        return {
            "interfaces": {iface.name: {"state": "up"} for iface in device.interfaces},
            "cpu": 10,
            "uptime_seconds": 3600,
        }
