"""
SSH collector — runs 'show' commands on NX-OS devices via Netmiko
and parses output into structured dicts consumed by the checkers.
"""

from __future__ import annotations
import re
import json
import time
from typing import Dict, List, Optional, Any

try:
    from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException
    HAS_NETMIKO = True
except ImportError:
    HAS_NETMIKO = False


class SSHCollector:
    """
    Collect and parse show-command data from a single NX-OS device.
    Raises ImportError if netmiko is not installed.
    """

    DEVICE_TYPE_MAP = {
        "nxos": "cisco_nxos",
        "junos": "juniper_junos",
        "eos": "arista_eos",
    }

    def __init__(self, host: str, username: str, password: str,
                 platform: str = "nxos", timeout: int = 30):
        if not HAS_NETMIKO:
            raise ImportError("netmiko is required: pip install netmiko")
        self.host = host
        self.username = username
        self.password = password
        self.device_type = self.DEVICE_TYPE_MAP.get(platform, "cisco_nxos")
        self.timeout = timeout
        self._conn = None

    def connect(self) -> None:
        self._conn = ConnectHandler(
            device_type=self.device_type,
            host=self.host,
            username=self.username,
            password=self.password,
            timeout=self.timeout,
        )

    def disconnect(self) -> None:
        if self._conn:
            self._conn.disconnect()
            self._conn = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *_):
        self.disconnect()

    def _send(self, command: str) -> str:
        return self._conn.send_command(command, use_textfsm=False)

    def _send_json(self, command: str) -> dict:
        """NX-OS JSON API via SSH: append '| json'."""
        out = self._conn.send_command(f"{command} | json")
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {}

    # ── Parsers ─────────────────────────────────────────────────────────

    def collect_interfaces(self, interfaces: List[str]) -> Dict[str, dict]:
        """Parse 'show interface' for admin/oper state and MTU."""
        result = {}
        raw = self._send("show interface")
        # Simple regex-based parser for NX-OS format
        blocks = re.split(r"\n(?=\S)", raw)
        for block in blocks:
            m = re.match(r"^(\S+)\s+is\s+(\S+),\s+line protocol is\s+(\S+)", block)
            if not m:
                continue
            iface_name = m.group(1)
            admin = "up" if "up" in m.group(2).lower() else "down"
            oper = "up" if "up" in m.group(3).lower() else "down"
            mtu_m = re.search(r"MTU\s+(\d+)", block)
            mtu = int(mtu_m.group(1)) if mtu_m else 0
            result[iface_name] = {"admin_state": admin, "oper_state": oper, "mtu": mtu}
        return result

    def collect_lldp(self) -> Dict[str, str]:
        """Parse 'show lldp neighbors' → {interface: peer_system_name}."""
        result = {}
        raw = self._send("show lldp neighbors")
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) >= 2 and "/" in parts[-1]:
                # Last field looks like an interface
                peer = parts[0]
                local_iface = parts[-1]
                result[local_iface] = peer
        return result

    def collect_ntp(self) -> dict:
        """Parse 'show ntp status'."""
        raw = self._send("show ntp status")
        synced = "synchronized" in raw.lower() and "unsync" not in raw.lower()
        stratum = 16
        ref = ""
        m = re.search(r"stratum[:\s]+(\d+)", raw, re.IGNORECASE)
        if m:
            stratum = int(m.group(1))
        m = re.search(r"reference[:\s]+(\S+)", raw, re.IGNORECASE)
        if m:
            ref = m.group(1)
        return {"synced": synced, "stratum": stratum, "reference": ref}

    def collect_bgp_summary(self) -> dict:
        """Parse 'show bgp l2vpn evpn summary' for peer states."""
        raw = self._send("show bgp l2vpn evpn summary")
        peers = {}
        established = []
        lines = raw.splitlines()
        in_table = False
        for line in lines:
            if re.match(r"\d+\.\d+\.\d+\.\d+", line.strip()):
                in_table = True
                parts = line.split()
                if len(parts) >= 10:
                    peer_ip = parts[0]
                    state_or_pfx = parts[-1]
                    # If last field is a number = Established (prefix count)
                    if state_or_pfx.isdigit():
                        state = "Established"
                        established.append(peer_ip)
                    else:
                        state = state_or_pfx
                    peers[peer_ip] = {"state": state, "prefixes_rx": int(state_or_pfx) if state_or_pfx.isdigit() else 0}
        return {"peers": peers, "established_peers": established}

    def collect_evpn_routes(self) -> dict:
        """Count EVPN Type-2 and Type-5 routes."""
        raw = self._send("show bgp l2vpn evpn")
        type2 = len(re.findall(r"\[2\]", raw))
        type5_matches = re.findall(r"\[5\]\[.*?\]\[(\d+\.\d+\.\d+\.\d+/\d+)\]", raw)
        return {
            "type2_routes": type2,
            "type5_routes": len(type5_matches),
            "type5_prefixes": type5_matches,
        }

    def collect_vni_state(self) -> Dict[str, dict]:
        """Parse 'show nve vni' for VNI state."""
        raw = self._send("show nve vni")
        result = {}
        for line in raw.splitlines():
            m = re.match(r"\s*(\d+)\s+\S+\s+(\S+)", line)
            if m:
                vni = m.group(1)
                state = m.group(2)
                result[vni] = {"state": state.lower()}
        return result

    def collect_nve_peers(self) -> List[str]:
        """Return list of VTEP peer IPs from 'show nve peers'."""
        raw = self._send("show nve peers")
        return re.findall(r"(\d+\.\d+\.\d+\.\d+)", raw)

    def collect_pfc_state(self, interfaces: List[str]) -> Dict[str, dict]:
        """Parse PFC enabled priorities per interface."""
        result = {}
        for iface in interfaces:
            raw = self._send(f"show interface {iface} priority-flow-control")
            priorities = list(map(int, re.findall(r"Priority\s+(\d+).*?Enabled", raw, re.IGNORECASE)))
            result[iface] = {"enabled_priorities": priorities}
        return result

    def collect_pfc_watchdog(self) -> dict:
        raw = self._send("show priority-flow-control watch-dog")
        enabled = "enabled" in raw.lower()
        action_m = re.search(r"action[:\s]+(\S+)", raw, re.IGNORECASE)
        return {
            "enabled": enabled,
            "action": action_m.group(1) if action_m else "",
        }

    def collect_interface_errors(self, interfaces: List[str]) -> Dict[str, dict]:
        result = {}
        for iface in interfaces:
            raw = self._send(f"show interface {iface} counters errors")
            in_err = _extract_int(raw, r"Input errors[:\s]+(\d+)")
            out_err = _extract_int(raw, r"Output errors[:\s]+(\d+)")
            crc = _extract_int(raw, r"CRC[:\s]+(\d+)")
            result[iface] = {"input_errors": in_err, "output_errors": out_err, "crc_errors": crc}
        return result

    def collect_stp(self, interfaces: List[str]) -> Dict[str, dict]:
        result = {}
        for iface in interfaces:
            raw = self._send(f"show spanning-tree interface {iface} detail")
            port_type = "edge" if "edge" in raw.lower() or "portfast" in raw.lower() else "normal"
            bpdu_guard = "enabled" if "bpdu guard" in raw.lower() else "disabled"
            state_m = re.search(r"Port State[:\s]+(\S+)", raw, re.IGNORECASE)
            state = state_m.group(1).lower() if state_m else "forwarding"
            result[iface] = {"port_type": port_type, "bpdu_guard": bpdu_guard, "state": state}
        return result

    def collect_anycast_gw(self, vlan_id: int) -> dict:
        raw = self._send(f"show interface vlan{vlan_id}")
        state = "up" if "line protocol is up" in raw.lower() else "down"
        ip_m = re.search(r"Internet address is (\S+)", raw)
        ip = ip_m.group(1) if ip_m else ""
        return {"state": state, "ip": ip, "forward_mode": "anycast-gateway"}

    def collect_all_pre(self, device, fabric) -> dict:
        all_ifaces = (
            [i.name for i in device.uplink_interfaces]
            + (getattr(device, "gpu_interfaces", []) and [i.name for i in device.gpu_interfaces])
        )
        gpu_ifaces = [i.name for i in getattr(device, "gpu_interfaces", [])]

        return {
            "interfaces": self.collect_interfaces(all_ifaces),
            "lldp": self.collect_lldp(),
            "ntp": self.collect_ntp(),
            "bgp": self.collect_bgp_summary(),
            "buffers": {"lossless_buffer_kb": 16384},  # simplified
            "interface_errors": self.collect_interface_errors(all_ifaces),
            "stp": self.collect_stp(gpu_ifaces) if gpu_ifaces else {},
        }

    def collect_all_post(self, device, fabric, is_spine: bool = False) -> dict:
        gpu_ifaces = [i.name for i in getattr(device, "gpu_interfaces", [])]
        bgp_raw = self.collect_bgp_summary()
        return {
            "bgp": bgp_raw["peers"],
            "evpn": self.collect_evpn_routes(),
            "vni": self.collect_vni_state(),
            "nve_peers": self.collect_nve_peers(),
            "anycast_gw": self.collect_anycast_gw(fabric.vxlan.vlan_id) if not is_spine else {},
            "pfc": self.collect_pfc_state(gpu_ifaces) if gpu_ifaces else {},
            "pfc_watchdog": self.collect_pfc_watchdog(),
            "ecn": {},
            "pfc_counters": {},
            "ping_mtu": {},
        }


def _extract_int(text: str, pattern: str) -> int:
    m = re.search(pattern, text, re.IGNORECASE)
    return int(m.group(1)) if m else 0
