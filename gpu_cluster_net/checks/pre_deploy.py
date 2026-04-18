"""
Pre-deployment checks — run BEFORE pushing config to a device.
Verifies physical layer, baseline state, and readiness prerequisites.
"""

from __future__ import annotations
import re
import time
from typing import List, Dict, Any, Optional

from .base import BaseChecker, CheckResult, CheckStatus, CheckSuite
from ..models import Fabric, Spine, Leaf


class PreDeployChecker(BaseChecker):
    """
    Checks run against a device BEFORE config deployment.
    All checks receive parsed output dicts from the collector.
    """

    def check_interfaces_up(
        self, interfaces: List[str], iface_data: Dict[str, dict]
    ) -> CheckResult:
        """Verify all fabric/GPU interfaces are physically up."""
        t = time.time()
        down = []
        for iface in interfaces:
            state = iface_data.get(iface, {})
            admin = state.get("admin_state", "").lower()
            oper = state.get("oper_state", "").lower()
            if admin == "down" or oper == "down":
                down.append(f"{iface}(admin={admin},oper={oper})")

        if down:
            return self._fail(
                "interfaces_up",
                f"{len(down)} interface(s) down: {', '.join(down)}",
                remediation="Bring up interfaces: 'no shutdown' + verify cable/optic",
                elapsed=time.time() - t,
            )
        return self._pass(
            "interfaces_up",
            f"All {len(interfaces)} interfaces are up",
            elapsed=time.time() - t,
        )

    def check_mtu(
        self, interfaces: List[str], iface_data: Dict[str, dict], required_mtu: int = 9216
    ) -> CheckResult:
        """Verify MTU >= required on all interfaces (jumbo required for RDMA)."""
        t = time.time()
        wrong = []
        for iface in interfaces:
            mtu = iface_data.get(iface, {}).get("mtu", 0)
            if int(mtu) < required_mtu:
                wrong.append(f"{iface}(mtu={mtu})")

        if wrong:
            return self._fail(
                "mtu_check",
                f"MTU < {required_mtu} on: {', '.join(wrong)}",
                expected=f">={required_mtu}",
                actual=wrong,
                remediation=f"Set 'mtu {required_mtu}' on all fabric and GPU port interfaces",
                elapsed=time.time() - t,
            )
        return self._pass(
            "mtu_check",
            f"MTU >= {required_mtu} on all {len(interfaces)} interfaces",
            elapsed=time.time() - t,
        )

    def check_spanning_tree_disabled(
        self, gpu_interfaces: List[str], stp_data: Dict[str, dict]
    ) -> CheckResult:
        """GPU ports must have STP edge/portfast + BPDU guard (no STP blocking)."""
        t = time.time()
        violations = []
        for iface in gpu_interfaces:
            stp = stp_data.get(iface, {})
            port_type = stp.get("port_type", "").lower()
            bpdu_guard = stp.get("bpdu_guard", "").lower()
            state = stp.get("state", "").lower()

            if state in ("blocking", "discarding"):
                violations.append(f"{iface}(STP state={state})")
            elif "edge" not in port_type and "portfast" not in port_type:
                violations.append(f"{iface}(not edge port)")

        if violations:
            return self._fail(
                "stp_gpu_ports",
                f"STP issues on GPU ports: {', '.join(violations)}",
                remediation="Set 'spanning-tree port type edge' + 'spanning-tree bpduguard enable' on GPU ports",
                elapsed=time.time() - t,
            )
        return self._pass(
            "stp_gpu_ports",
            f"STP edge/portfast correct on all {len(gpu_interfaces)} GPU ports",
            elapsed=time.time() - t,
        )

    def check_lldp_neighbors(
        self,
        expected_neighbors: Dict[str, str],   # {interface: expected_peer_hostname}
        lldp_data: Dict[str, str],             # {interface: actual_peer_hostname}
    ) -> CheckResult:
        """Verify LLDP neighbors match expected topology."""
        t = time.time()
        mismatches = []
        missing = []

        for iface, expected_peer in expected_neighbors.items():
            actual = lldp_data.get(iface)
            if actual is None:
                missing.append(iface)
            elif expected_peer.lower() not in actual.lower():
                mismatches.append(f"{iface}: expected={expected_peer} actual={actual}")

        issues = []
        if missing:
            issues.append(f"No LLDP neighbor on: {', '.join(missing)}")
        if mismatches:
            issues.append(f"Wrong peers: {'; '.join(mismatches)}")

        if issues:
            return self._fail(
                "lldp_neighbors",
                " | ".join(issues),
                remediation="Verify cabling matches topology YAML; check 'show lldp neighbors detail'",
                elapsed=time.time() - t,
            )
        return self._pass(
            "lldp_neighbors",
            f"All {len(expected_neighbors)} LLDP neighbors match expected topology",
            elapsed=time.time() - t,
        )

    def check_ntp_sync(self, ntp_data: dict) -> CheckResult:
        """NTP must be synchronized before deployment."""
        t = time.time()
        synced = ntp_data.get("synced", False)
        stratum = ntp_data.get("stratum", 16)
        ref_server = ntp_data.get("reference", "")

        if not synced or stratum >= 16:
            return self._fail(
                "ntp_sync",
                f"NTP not synchronized (stratum={stratum}, ref={ref_server})",
                remediation="Check NTP server reachability: 'show ntp status' / 'show ntp peers'",
                elapsed=time.time() - t,
            )
        return self._pass(
            "ntp_sync",
            f"NTP synchronized to {ref_server} (stratum {stratum})",
            elapsed=time.time() - t,
        )

    def check_no_existing_bgp_sessions(self, bgp_data: dict) -> CheckResult:
        """No unexpected BGP sessions should exist before deployment."""
        t = time.time()
        established = bgp_data.get("established_peers", [])
        if established:
            return self._warn(
                "no_existing_bgp",
                f"Existing BGP sessions found: {established}. Verify these are expected.",
                elapsed=time.time() - t,
            )
        return self._pass(
            "no_existing_bgp",
            "No pre-existing BGP sessions (clean slate)",
            elapsed=time.time() - t,
        )

    def check_hardware_buffers(self, buffer_data: dict, required_lossless_kb: int = 8192) -> CheckResult:
        """Verify sufficient buffer allocated for lossless PFC queues."""
        t = time.time()
        lossless_kb = buffer_data.get("lossless_buffer_kb", 0)
        if lossless_kb < required_lossless_kb:
            return self._fail(
                "hardware_buffers",
                f"Insufficient lossless buffer: {lossless_kb}KB < {required_lossless_kb}KB required",
                expected=f">={required_lossless_kb}KB",
                actual=f"{lossless_kb}KB",
                remediation="Check QoS buffer carving: 'show queuing interface' / adjust buffer-carve",
                elapsed=time.time() - t,
            )
        return self._pass(
            "hardware_buffers",
            f"Lossless buffer adequate: {lossless_kb}KB allocated",
            elapsed=time.time() - t,
        )

    def check_no_interface_errors(
        self, interfaces: List[str], error_data: Dict[str, dict], threshold: int = 0
    ) -> CheckResult:
        """No input/output errors on fabric interfaces before deployment."""
        t = time.time()
        error_ifaces = []
        for iface in interfaces:
            errs = error_data.get(iface, {})
            in_errors = errs.get("input_errors", 0)
            out_errors = errs.get("output_errors", 0)
            crc = errs.get("crc_errors", 0)
            if max(in_errors, out_errors, crc) > threshold:
                error_ifaces.append(
                    f"{iface}(in={in_errors},out={out_errors},crc={crc})"
                )
        if error_ifaces:
            return self._warn(
                "interface_errors",
                f"Interface errors detected: {', '.join(error_ifaces)}",
                remediation="Check cables/optics; clean or replace if errors persist",
                elapsed=time.time() - t,
            )
        return self._pass(
            "interface_errors",
            f"No errors on {len(interfaces)} interfaces",
            elapsed=time.time() - t,
        )

    def run_all(
        self,
        fabric: Fabric,
        device,                               # Spine or Leaf
        collected: dict,                      # output from collector
    ) -> CheckSuite:
        """Run the full pre-deployment check suite for a device."""
        suite = CheckSuite(device=self.device, phase="pre")

        all_ifaces = (
            [i.name for i in device.uplink_interfaces]
            + ([i.name for i in device.gpu_interfaces] if hasattr(device, "gpu_interfaces") else [])
        )
        gpu_ifaces = [i.name for i in device.gpu_interfaces] if hasattr(device, "gpu_interfaces") else []
        uplink_ifaces = [i.name for i in device.uplink_interfaces]

        iface_data = collected.get("interfaces", {})
        stp_data = collected.get("stp", {})
        lldp_data = collected.get("lldp", {})
        ntp_data = collected.get("ntp", {})
        bgp_data = collected.get("bgp", {})
        buffer_data = collected.get("buffers", {})
        error_data = collected.get("interface_errors", {})

        # Build expected LLDP map from topology
        expected_lldp = {}
        for iface in device.uplink_interfaces:
            if iface.peer_device:
                expected_lldp[iface.name] = iface.peer_device

        if all_ifaces:
            suite.add(self.check_interfaces_up(all_ifaces, iface_data))
            suite.add(self.check_mtu(all_ifaces, iface_data, fabric.rocev2.mtu))
            suite.add(self.check_no_interface_errors(all_ifaces, error_data))

        if gpu_ifaces:
            suite.add(self.check_spanning_tree_disabled(gpu_ifaces, stp_data))

        if expected_lldp:
            suite.add(self.check_lldp_neighbors(expected_lldp, lldp_data))

        suite.add(self.check_ntp_sync(ntp_data))
        suite.add(self.check_no_existing_bgp_sessions(bgp_data))
        suite.add(self.check_hardware_buffers(buffer_data))

        suite.end_time = time.time()
        return suite
