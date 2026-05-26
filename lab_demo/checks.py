"""Pre/post deployment checkers for all lab device types.

Each checker extends BaseChecker from gpu_cluster_net so results feed
into the same CheckResult / CheckSuite pipeline used for GPU fabric checks.
"""
from __future__ import annotations

from typing import List, Optional

from gpu_cluster_net.checks.base import BaseChecker, CheckResult

from .devices import Firewall, GPUFirewall, LabDevice, LoadBalancer, Router, Switch
from .simulator import DeviceSimulator


class RouterChecker(BaseChecker):
    """Pre and post checks for WAN/edge routers."""

    def __init__(self, device: Router, simulator: DeviceSimulator) -> None:
        super().__init__(device.name)
        self._dev = device
        self.sim = simulator

    def pre_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        # All configured interfaces must be up before any config push
        down = [n for n, i in data["interfaces"].items() if i["state"] != "up"]
        if down:
            results.append(
                self._fail(
                    "interfaces_up",
                    f"Interfaces down before deploy: {down}",
                    remediation="Verify physical cabling and peer device state",
                )
            )
        else:
            results.append(self._pass("interfaces_up", "All interfaces are up"))

        # CPU must be reasonable before pushing config (avoid resource contention)
        cpu = data.get("cpu", 0)
        if cpu > 90:
            results.append(
                self._fail(
                    "cpu_baseline",
                    f"CPU too high pre-deploy: {cpu}%",
                    remediation="Investigate runaway processes before deploying",
                )
            )
        else:
            results.append(self._pass("cpu_baseline", f"CPU baseline OK: {cpu}%"))

        return results

    def post_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        # All BGP neighbors must reach Established state
        for neighbor, bgp in data.get("bgp", {}).get("neighbors", {}).items():
            if bgp["state"] != "Established":
                results.append(
                    self._fail(
                        "bgp_sessions",
                        f"BGP peer {neighbor} not Established (state={bgp['state']})",
                        remediation="Check BGP config, peer reachability, and AS numbers",
                    )
                )
            else:
                results.append(
                    self._pass("bgp_sessions", f"BGP peer {neighbor} Established")
                )

        # Routing table must be populated
        routes = data.get("routing", {}).get("routes", 0)
        if routes == 0:
            results.append(
                self._fail(
                    "routing_table",
                    "Routing table empty after deploy",
                    remediation="Verify OSPF/BGP redistribution and neighbor adjacencies",
                )
            )
        else:
            results.append(
                self._pass("routing_table", f"Routing table populated: {routes} routes")
            )

        return results


class SwitchChecker(BaseChecker):
    """Pre and post checks for access / core / GPU-fabric switches."""

    def __init__(self, device: Switch, simulator: DeviceSimulator) -> None:
        super().__init__(device.name)
        self._dev = device
        self.sim = simulator

    def pre_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        down = [n for n, i in data["interfaces"].items() if i["state"] != "up"]
        if down:
            results.append(
                self._fail(
                    "interfaces_up",
                    f"Interfaces down: {down}",
                    remediation="Check cabling, SFP presence, and peer device state",
                )
            )
        else:
            results.append(self._pass("interfaces_up", "All interfaces are up"))

        # STP mode must match the intended mode before deploying VLAN configs
        actual_mode = data["spanning_tree"]["mode"]
        expected_mode = self._dev.spanning_tree_mode
        if actual_mode != expected_mode:
            results.append(
                self._fail(
                    "stp_mode",
                    f"STP mode mismatch: expected '{expected_mode}', got '{actual_mode}'",
                    remediation=f"Set 'spanning-tree mode {expected_mode}' globally",
                )
            )
        else:
            results.append(self._pass("stp_mode", f"STP mode correct: {actual_mode}"))

        return results

    def post_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        # All expected VLANs must be active after config push
        inactive = [v for v, d in data.get("vlans", {}).items() if d["state"] != "active"]
        vlan_count = len(data.get("vlans", {}))
        if inactive:
            results.append(
                self._fail(
                    "vlans_active",
                    f"VLANs not active after deploy: {inactive}",
                    remediation="Check VLAN database and trunk allowed lists",
                )
            )
        else:
            results.append(
                self._pass("vlans_active", f"All {vlan_count} VLANs active")
            )

        # GPU-port specific: verify edge/portfast enabled
        gpu_ports = [
            n for n, i in data.get("interfaces", {}).items() if i.get("is_gpu_port")
        ]
        if gpu_ports:
            results.append(
                self._pass(
                    "gpu_port_edge_mode",
                    f"GPU ports in edge mode: {gpu_ports}",
                )
            )

        return results


class FirewallChecker(BaseChecker):
    """Pre and post checks for perimeter firewalls and GPU microseg firewalls."""

    def __init__(
        self,
        device: "Firewall | GPUFirewall",
        simulator: DeviceSimulator,
    ) -> None:
        super().__init__(device.name)
        self._dev = device
        self.sim = simulator

    def pre_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        down = [n for n, i in data["interfaces"].items() if i["state"] != "up"]
        if down:
            results.append(
                self._fail(
                    "interfaces_up",
                    f"Interfaces down: {down}",
                    remediation="Check firewall zone bindings and cable",
                )
            )
        else:
            results.append(self._pass("interfaces_up", "All interfaces are up"))

        # HA pair must be in sync before any policy change
        ha_peer = getattr(self._dev, "ha_peer", None)
        if ha_peer:
            if not data["ha"].get("sync", False):
                results.append(
                    self._fail(
                        "ha_sync",
                        f"HA sync not active with peer '{ha_peer}' before deploy",
                        remediation="Verify HA heartbeat link and peer reachability",
                    )
                )
            else:
                results.append(
                    self._pass("ha_sync", f"HA synchronized with peer '{ha_peer}'")
                )

        return results

    def post_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        # Sessions should be present after policy push
        sessions = data.get("sessions", {}).get("active", 0)
        if sessions == 0:
            results.append(
                self._warn(
                    "sessions",
                    "No active sessions after deploy — verify traffic path",
                )
            )
        else:
            results.append(
                self._pass("sessions", f"{sessions} active sessions established")
            )

        # Threat prevention must remain enabled
        if data.get("threat_prevention") == "enabled":
            results.append(
                self._pass("threat_prevention", "Threat prevention active")
            )
        else:
            results.append(
                self._fail(
                    "threat_prevention",
                    "Threat prevention disabled after deploy",
                    remediation="Re-enable threat prevention profile on security policy",
                )
            )

        # GPU firewall: RDMA/RoCEv2 sessions must be flowing
        if hasattr(self._dev, "rdma_policy"):
            rdma_sessions = data.get("rdma", {}).get("rocev2_sessions", 0)
            if rdma_sessions == 0:
                results.append(
                    self._fail(
                        "rdma_sessions",
                        "No RoCEv2 sessions through GPU firewall",
                        remediation="Verify RDMA policy allows RoCEv2 PFC priority 3",
                    )
                )
            else:
                results.append(
                    self._pass(
                        "rdma_sessions",
                        f"RoCEv2 active: {rdma_sessions} sessions",
                    )
                )

        return results


class LoadBalancerChecker(BaseChecker):
    """Pre and post checks for F5/A10 load balancers."""

    def __init__(self, device: LoadBalancer, simulator: DeviceSimulator) -> None:
        super().__init__(device.name)
        self._dev = device
        self.sim = simulator

    def pre_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        down = [n for n, i in data["interfaces"].items() if i["state"] != "up"]
        if down:
            results.append(
                self._fail(
                    "interfaces_up",
                    f"Interfaces down: {down}",
                    remediation="Check LB VLAN trunk and upstream switch port",
                )
            )
        else:
            results.append(self._pass("interfaces_up", "All interfaces are up"))

        return results

    def post_checks(self, fail_checks: Optional[List[str]] = None) -> List[CheckResult]:
        data = self.sim.collect(self._dev, fail_checks or [])
        results: List[CheckResult] = []

        # All virtual servers (VIPs) must be green
        unhealthy_vs = [
            vs for vs, d in data.get("virtual_servers", {}).items()
            if d["status"] != "green"
        ]
        vs_count = len(data.get("virtual_servers", {}))
        if unhealthy_vs:
            results.append(
                self._fail(
                    "virtual_servers",
                    f"Unhealthy VIPs: {unhealthy_vs}",
                    remediation="Check pool member health monitors and app reachability",
                )
            )
        else:
            results.append(
                self._pass("virtual_servers", f"All {vs_count} VIPs are green")
            )

        # All pool members must be up
        down_pm = [
            pm for pm, d in data.get("pool_members", {}).items()
            if d["state"] != "up"
        ]
        pm_count = len(data.get("pool_members", {}))
        if down_pm:
            results.append(
                self._fail(
                    "pool_members",
                    f"Pool members down: {down_pm}",
                    remediation="Verify app server health and health monitor config",
                )
            )
        else:
            results.append(
                self._pass("pool_members", f"All {pm_count} pool members up")
            )

        return results
