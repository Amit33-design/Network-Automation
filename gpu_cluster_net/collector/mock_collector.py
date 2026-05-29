"""
Mock collector for testing and dry-runs without live devices.
Returns configurable pass/fail data to exercise all check logic.
"""

from __future__ import annotations
from typing import List, Dict, Optional


class MockCollector:
    """
    Returns synthetic data that simulates a correctly configured device.
    Pass fail_checks=["check_name", ...] to simulate specific failures.
    """

    def __init__(self, fail_checks: Optional[List[str]] = None):
        self.fail_checks = set(fail_checks or [])

    def collect_all_pre(self, device, fabric) -> dict:
        all_ifaces = (
            [i.name for i in device.uplink_interfaces]
            + [i.name for i in getattr(device, "gpu_interfaces", [])]
        )
        gpu_ifaces = [i.name for i in getattr(device, "gpu_interfaces", [])]

        # Interface state
        iface_data = {}
        for iface in all_ifaces:
            mtu = 1500 if "mtu_check" in self.fail_checks else fabric.rocev2.mtu
            oper = "down" if ("interfaces_up" in self.fail_checks and iface == all_ifaces[0]) else "up"
            iface_data[iface] = {"admin_state": "up", "oper_state": oper, "mtu": mtu}

        # STP
        stp_data = {}
        for iface in gpu_ifaces:
            port_type = "normal" if "stp_gpu_ports" in self.fail_checks else "edge"
            stp_data[iface] = {"port_type": port_type, "bpdu_guard": "enabled", "state": "forwarding"}

        # LLDP
        lldp_data = {}
        for iface in device.uplink_interfaces:
            if iface.peer_device:
                peer = "wrong-device" if "lldp_neighbors" in self.fail_checks else iface.peer_device
                lldp_data[iface.name] = peer

        # NTP
        ntp_synced = "ntp_sync" not in self.fail_checks
        ntp = {"synced": ntp_synced, "stratum": 16 if not ntp_synced else 2, "reference": "169.254.169.254"}

        # BGP baseline (pre = should be empty)
        bgp = {
            "peers": {},
            "established_peers": ["10.0.0.99"] if "no_existing_bgp" in self.fail_checks else [],
        }

        # Buffers
        buf_kb = 1024 if "hardware_buffers" in self.fail_checks else 16384
        buffers = {"lossless_buffer_kb": buf_kb}

        # Errors
        error_data = {}
        for iface in all_ifaces:
            crc = 500 if "interface_errors" in self.fail_checks else 0
            error_data[iface] = {"input_errors": 0, "output_errors": 0, "crc_errors": crc}

        return {
            "interfaces": iface_data,
            "stp": stp_data,
            "lldp": lldp_data,
            "ntp": ntp,
            "bgp": bgp,
            "buffers": buffers,
            "interface_errors": error_data,
        }

    def collect_all_post(self, device, fabric, is_spine: bool = False) -> dict:
        gpu_ifaces = [i.name for i in getattr(device, "gpu_interfaces", [])]

        # BGP EVPN peers
        if is_spine:
            peers = {l.loopback_ip(): {"state": "Established", "prefixes_rx": 10}
                     for l in fabric.leaves}
        else:
            peers = {s.loopback_ip(): {"state": "Established", "prefixes_rx": 10}
                     for s in fabric.spines}

        if "bgp_evpn_sessions" in self.fail_checks:
            first = next(iter(peers))
            peers[first]["state"] = "Idle"

        # EVPN routes
        t2 = 0 if "evpn_type2_routes" in self.fail_checks else 24
        t5 = 0 if "evpn_type5_routes" in self.fail_checks else 4
        evpn = {
            "type2_routes": t2,
            "type5_routes": t5,
            "type5_prefixes": [f"10.100.{i}.0/24" for i in range(t5)],
        }

        # VNI state
        l2_state = "down" if "vxlan_vni_state" in self.fail_checks else "up"
        vni = {
            str(fabric.vxlan.l2_vni): {"state": l2_state},
            str(fabric.vxlan.l3_vni): {"state": "up"},
        }

        # NVE peers
        expected_vteps = [l.vtep_ip() for l in fabric.leaves
                          if hasattr(l, "vtep_loopback") and l.name != device.name]
        nve_peers = [] if "vtep_peers" in self.fail_checks else expected_vteps

        # Anycast GW
        gw_state = "down" if "anycast_gateway" in self.fail_checks else "up"
        gw_ip = fabric.vxlan.anycast_gw_ip.split("/")[0]
        anycast_gw = {"state": gw_state, "ip": f"{gw_ip}/24", "forward_mode": "anycast-gateway"}

        # PFC
        pfc_data = {}
        for iface in gpu_ifaces:
            priorities = [] if "pfc_operational" in self.fail_checks else [fabric.rocev2.pfc_priority]
            pfc_data[iface] = {"enabled_priorities": priorities}

        # ECN
        ecn_data = {}
        for iface in gpu_ifaces:
            ecn_min = 0 if "ecn_thresholds" in self.fail_checks else fabric.rocev2.ecn_min_threshold_bytes
            ecn_max = 0 if "ecn_thresholds" in self.fail_checks else fabric.rocev2.ecn_max_threshold_bytes
            ecn_data[iface] = {"ecn_min_bytes": ecn_min, "ecn_max_bytes": ecn_max}

        # PFC watchdog
        watchdog = {
            "enabled": "pfc_watchdog" not in self.fail_checks,
            "action": "drop",
        }

        # PFC counters
        pfc_counters = {}
        for iface in gpu_ifaces:
            rx = 5000 if "pfc_storms" in self.fail_checks else 10
            pfc_counters[iface] = {"rx_pfc_frames": rx, "tx_pfc_frames": 5}

        # MTU ping
        ping_results = {}
        if not is_spine:
            for i, leaf in enumerate(fabric.leaves):
                if leaf.name != device.name:
                    target = leaf.vtep_ip()
                    success = "rdma_mtu_path" not in self.fail_checks
                    ping_results[target] = {
                        "success": success,
                        "mtu_reached": 1500 if not success else 9000,
                    }

        return {
            "bgp": peers,
            "evpn": evpn,
            "vni": vni,
            "nve_peers": nve_peers,
            "anycast_gw": anycast_gw,
            "pfc": pfc_data,
            "ecn": ecn_data,
            "pfc_watchdog": watchdog,
            "pfc_counters": pfc_counters,
            "ping_mtu": ping_results,
        }
