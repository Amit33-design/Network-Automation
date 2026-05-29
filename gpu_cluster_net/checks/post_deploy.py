"""
Post-deployment checks — run AFTER config has been pushed.
Verifies EVPN control plane, VXLAN data plane, RoCEv2 lossless fabric,
and end-to-end GPU cluster reachability.
"""

from __future__ import annotations
import time
from typing import List, Dict, Any, Optional

from .base import BaseChecker, CheckResult, CheckStatus, CheckSuite
from ..models import Fabric, Spine, Leaf


class PostDeployChecker(BaseChecker):

    # ── BGP / EVPN Control Plane ──────────────────────────────────────────

    def check_bgp_evpn_sessions(
        self,
        expected_peers: List[str],           # list of peer IPs/names
        bgp_data: Dict[str, dict],           # {peer_ip: {state, prefixes_rx}}
    ) -> CheckResult:
        """All EVPN BGP sessions must be Established."""
        t = time.time()
        not_established = []
        for peer in expected_peers:
            state = bgp_data.get(peer, {}).get("state", "Idle")
            if state.lower() != "established":
                not_established.append(f"{peer}({state})")

        if not_established:
            return self._fail(
                "bgp_evpn_sessions",
                f"BGP EVPN sessions not established: {', '.join(not_established)}",
                expected="Established",
                actual=not_established,
                remediation=(
                    "Check 'show bgp l2vpn evpn summary'; verify loopback reachability "
                    "via OSPF; check 'show ip ospf neighbor'"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "bgp_evpn_sessions",
            f"All {len(expected_peers)} BGP EVPN sessions Established",
            elapsed=time.time() - t,
        )

    def check_evpn_type2_routes(
        self, evpn_data: dict, min_routes: int = 1
    ) -> CheckResult:
        """EVPN Type-2 (MAC/IP) routes must be present — proves MAC learning."""
        t = time.time()
        type2_count = evpn_data.get("type2_routes", 0)
        if type2_count < min_routes:
            return self._fail(
                "evpn_type2_routes",
                f"Only {type2_count} EVPN Type-2 routes (expected >= {min_routes})",
                expected=f">={min_routes}",
                actual=type2_count,
                remediation=(
                    "Verify GPU servers are connected and sending traffic; "
                    "check 'show bgp l2vpn evpn' for RT-2 prefixes"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "evpn_type2_routes",
            f"EVPN Type-2 routes present: {type2_count} MAC/IP entries",
            elapsed=time.time() - t,
        )

    def check_evpn_type5_routes(
        self, evpn_data: dict, expected_prefixes: Optional[List[str]] = None
    ) -> CheckResult:
        """EVPN Type-5 (IP prefix) routes must be present for L3 reachability."""
        t = time.time()
        type5_count = evpn_data.get("type5_routes", 0)
        type5_prefixes = evpn_data.get("type5_prefixes", [])

        if type5_count == 0:
            return self._fail(
                "evpn_type5_routes",
                "No EVPN Type-5 routes found — L3 reachability not established",
                remediation=(
                    "Verify VRF redistribution config; "
                    "check 'show bgp l2vpn evpn' for RT-5 prefixes; "
                    "confirm 'advertise l2vpn evpn' under BGP VRF"
                ),
                elapsed=time.time() - t,
            )

        if expected_prefixes:
            missing = [p for p in expected_prefixes if p not in type5_prefixes]
            if missing:
                return self._fail(
                    "evpn_type5_routes",
                    f"Missing Type-5 prefixes: {missing}",
                    expected=expected_prefixes,
                    actual=type5_prefixes,
                    remediation="Check route redistribution and route-maps in BGP VRF config",
                    elapsed=time.time() - t,
                )

        return self._pass(
            "evpn_type5_routes",
            f"EVPN Type-5 routes present: {type5_count} IP prefixes",
            elapsed=time.time() - t,
        )

    # ── VXLAN Data Plane ──────────────────────────────────────────────────

    def check_vxlan_vni_state(
        self, vni_data: dict, expected_l2_vni: int, expected_l3_vni: int
    ) -> CheckResult:
        """VXLAN VNIs must be in Up state with correct VTEP list."""
        t = time.time()
        issues = []

        for vni, label in [(expected_l2_vni, "L2"), (expected_l3_vni, "L3")]:
            state = vni_data.get(str(vni), {})
            if not state:
                issues.append(f"VNI {vni} ({label}) not found in NVE table")
                continue
            if state.get("state", "").lower() != "up":
                issues.append(f"VNI {vni} ({label}) state={state.get('state','unknown')}")

        if issues:
            return self._fail(
                "vxlan_vni_state",
                " | ".join(issues),
                remediation=(
                    "Check 'show nve vni'; verify 'interface nve1' is no-shutdown; "
                    "confirm VN-segment mapping under VLAN config"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "vxlan_vni_state",
            f"VXLAN VNIs {expected_l2_vni}(L2) and {expected_l3_vni}(L3) are Up",
            elapsed=time.time() - t,
        )

    def check_vtep_peers(
        self, nve_peers: List[str], expected_vteps: List[str]
    ) -> CheckResult:
        """All leaf VTEP peers must appear in NVE peer table."""
        t = time.time()
        missing = [v for v in expected_vteps if v not in nve_peers]
        if missing:
            return self._fail(
                "vtep_peers",
                f"Missing VTEP peers: {missing}",
                expected=expected_vteps,
                actual=nve_peers,
                remediation=(
                    "Check 'show nve peers'; verify underlay OSPF reachability "
                    "to missing VTEPs: 'show ip route <vtep_ip>'"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "vtep_peers",
            f"All {len(expected_vteps)} VTEP peers present in NVE table",
            elapsed=time.time() - t,
        )

    def check_anycast_gateway(self, gw_data: dict, expected_gw_ip: str) -> CheckResult:
        """Distributed anycast gateway SVI must be up and forwarding."""
        t = time.time()
        state = gw_data.get("state", "").lower()
        ip = gw_data.get("ip", "")
        mode = gw_data.get("forward_mode", "")

        if state != "up":
            return self._fail(
                "anycast_gateway",
                f"Anycast GW SVI is {state} (expected up)",
                remediation="Check 'show interface vlan <id>'; ensure 'fabric forwarding mode anycast-gateway'",
                elapsed=time.time() - t,
            )
        if expected_gw_ip.split("/")[0] not in ip:
            return self._fail(
                "anycast_gateway",
                f"GW IP mismatch: expected {expected_gw_ip}, got {ip}",
                remediation="Verify 'ip address' on SVI matches topology config",
                elapsed=time.time() - t,
            )
        return self._pass(
            "anycast_gateway",
            f"Anycast GW {ip} is up, mode={mode}",
            elapsed=time.time() - t,
        )

    # ── RoCEv2 / Lossless Fabric ──────────────────────────────────────────

    def check_pfc_operational(
        self, pfc_data: Dict[str, dict], expected_priority: int = 3
    ) -> CheckResult:
        """PFC must be enabled and operational on the RoCEv2 priority."""
        t = time.time()
        not_enabled = []
        for iface, state in pfc_data.items():
            enabled_priorities = state.get("enabled_priorities", [])
            if expected_priority not in enabled_priorities:
                not_enabled.append(iface)

        if not_enabled:
            return self._fail(
                "pfc_operational",
                f"PFC not enabled on priority {expected_priority} for: {', '.join(not_enabled)}",
                expected=f"PFC priority {expected_priority} enabled",
                remediation=(
                    "Check 'show queuing interface'; verify system-level network-qos policy "
                    "with 'pause no-drop' on the RoCEv2 class"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "pfc_operational",
            f"PFC operational on priority {expected_priority} across all interfaces",
            elapsed=time.time() - t,
        )

    def check_ecn_thresholds(
        self,
        ecn_data: Dict[str, dict],
        min_thresh: int,
        max_thresh: int,
    ) -> CheckResult:
        """ECN min/max thresholds must match RoCEv2 config (DCQCN)."""
        t = time.time()
        wrong = []
        for iface, state in ecn_data.items():
            actual_min = state.get("ecn_min_bytes", 0)
            actual_max = state.get("ecn_max_bytes", 0)
            if abs(actual_min - min_thresh) > 10_000 or abs(actual_max - max_thresh) > 100_000:
                wrong.append(
                    f"{iface}(min={actual_min},max={actual_max}; "
                    f"expected min~{min_thresh},max~{max_thresh})"
                )
        if wrong:
            return self._fail(
                "ecn_thresholds",
                f"ECN threshold mismatch: {', '.join(wrong)}",
                expected=f"min={min_thresh} max={max_thresh}",
                remediation=(
                    "Verify network-qos policy: 'congestion-control random-detect ecn' thresholds; "
                    "check 'show queuing interface'"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "ecn_thresholds",
            f"ECN thresholds correct on all interfaces (min={min_thresh}, max={max_thresh})",
            elapsed=time.time() - t,
        )

    def check_pfc_watchdog(self, watchdog_data: dict) -> CheckResult:
        """PFC watchdog must be enabled to prevent deadlocks."""
        t = time.time()
        enabled = watchdog_data.get("enabled", False)
        action = watchdog_data.get("action", "")
        if not enabled:
            return self._fail(
                "pfc_watchdog",
                "PFC watchdog is DISABLED — risk of lossless deadlock",
                remediation="Enable: 'priority-flow-control watch-dog-interval 100'",
                elapsed=time.time() - t,
            )
        return self._pass(
            "pfc_watchdog",
            f"PFC watchdog enabled, action={action}",
            elapsed=time.time() - t,
        )

    def check_rdma_mtu_path(
        self, ping_results: Dict[str, dict], required_mtu: int = 9000
    ) -> CheckResult:
        """End-to-end jumbo MTU path must be intact (ping with DF bit)."""
        t = time.time()
        failed_paths = []
        for target, result in ping_results.items():
            success = result.get("success", False)
            mtu_reached = result.get("mtu_reached", 0)
            if not success or mtu_reached < required_mtu:
                failed_paths.append(
                    f"{target}(success={success}, mtu_reached={mtu_reached})"
                )
        if failed_paths:
            return self._fail(
                "rdma_mtu_path",
                f"Jumbo MTU path broken to: {', '.join(failed_paths)}",
                expected=f"MTU >= {required_mtu} end-to-end",
                remediation=(
                    "Check MTU on all hops: 'show interface | grep MTU'; "
                    "ensure no intermediate device drops jumbo frames"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "rdma_mtu_path",
            f"Jumbo MTU path ({required_mtu}B) verified to all GPU endpoints",
            elapsed=time.time() - t,
        )

    def check_no_pfc_storms(
        self, pfc_counters: Dict[str, dict], threshold: int = 1000
    ) -> CheckResult:
        """No PFC storm — excessive PFC pause frames indicate misconfiguration."""
        t = time.time()
        storm_ifaces = []
        for iface, counters in pfc_counters.items():
            rx_pause = counters.get("rx_pfc_frames", 0)
            tx_pause = counters.get("tx_pfc_frames", 0)
            if max(rx_pause, tx_pause) > threshold:
                storm_ifaces.append(f"{iface}(rx={rx_pause},tx={tx_pause})")
        if storm_ifaces:
            return self._warn(
                "pfc_storms",
                f"High PFC pause frame counts (possible storm): {', '.join(storm_ifaces)}",
                remediation=(
                    "Investigate with 'show interface priority-flow-control'; "
                    "check PFC watchdog logs; verify ECN thresholds"
                ),
                elapsed=time.time() - t,
            )
        return self._pass(
            "pfc_storms",
            "PFC pause frame counts within normal range",
            elapsed=time.time() - t,
        )

    def run_all(
        self,
        fabric: Fabric,
        device,
        collected: dict,
        is_spine: bool = False,
    ) -> CheckSuite:
        """Run the full post-deployment check suite for a device."""
        suite = CheckSuite(device=self.device, phase="post")

        bgp_data = collected.get("bgp", {})
        evpn_data = collected.get("evpn", {})
        vni_data = collected.get("vni", {})
        nve_peers = collected.get("nve_peers", [])
        gw_data = collected.get("anycast_gw", {})
        pfc_data = collected.get("pfc", {})
        ecn_data = collected.get("ecn", {})
        watchdog_data = collected.get("pfc_watchdog", {})
        ping_results = collected.get("ping_mtu", {})
        pfc_counters = collected.get("pfc_counters", {})

        # BGP EVPN peers
        if is_spine:
            expected_peers = [l.loopback_ip() for l in fabric.leaves]
        else:
            expected_peers = [s.loopback_ip() for s in fabric.spines]

        suite.add(self.check_bgp_evpn_sessions(expected_peers, bgp_data))
        suite.add(self.check_evpn_type2_routes(evpn_data))
        suite.add(self.check_evpn_type5_routes(evpn_data))

        # VXLAN — only on leaves (VTEPs)
        if not is_spine:
            suite.add(self.check_vxlan_vni_state(
                vni_data, fabric.vxlan.l2_vni, fabric.vxlan.l3_vni
            ))
            expected_vteps = [l.vtep_ip() for l in fabric.leaves
                              if l.name != device.name]
            if expected_vteps:
                suite.add(self.check_vtep_peers(nve_peers, expected_vteps))
            suite.add(self.check_anycast_gateway(
                gw_data, fabric.vxlan.anycast_gw_ip
            ))
            suite.add(self.check_rdma_mtu_path(ping_results, fabric.rocev2.mtu - 216))

        # RoCEv2 QoS — on all devices
        if pfc_data:
            suite.add(self.check_pfc_operational(pfc_data, fabric.rocev2.pfc_priority))
        if ecn_data:
            suite.add(self.check_ecn_thresholds(
                ecn_data,
                fabric.rocev2.ecn_min_threshold_bytes,
                fabric.rocev2.ecn_max_threshold_bytes,
            ))
        suite.add(self.check_pfc_watchdog(watchdog_data))
        if pfc_counters:
            suite.add(self.check_no_pfc_storms(pfc_counters))

        suite.end_time = time.time()
        return suite
