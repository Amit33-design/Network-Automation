"""LabTopology: loads demo_full_datacenter.yaml into typed device objects."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Union

import yaml

from .devices import (
    DeviceInterface,
    DevicePlatform,
    DeviceRole,
    Firewall,
    GPUFirewall,
    GPUServer,
    LabDevice,
    LoadBalancer,
    Router,
    Switch,
    ZTPState,
)


def _parse_interfaces(raw: Optional[list]) -> List[DeviceInterface]:
    return [
        DeviceInterface(
            name=i["name"],
            ip_address=i.get("ip_address"),
            peer_device=i.get("peer_device"),
            peer_interface=i.get("peer_interface"),
            speed=i.get("speed", "1G"),
            is_gpu_port=i.get("is_gpu_port", False),
        )
        for i in (raw or [])
    ]


def _platform(raw: str) -> DevicePlatform:
    try:
        return DevicePlatform(raw)
    except ValueError:
        return DevicePlatform.CISCO_IOSXE


class LabTopology:
    """Full datacenter lab topology across all device tiers."""

    def __init__(
        self,
        name: str,
        routers: Optional[List[Router]] = None,
        switches: Optional[List[Switch]] = None,
        firewalls: Optional[List[Firewall]] = None,
        load_balancers: Optional[List[LoadBalancer]] = None,
        gpu_firewalls: Optional[List[GPUFirewall]] = None,
        gpu_servers: Optional[List[GPUServer]] = None,
    ) -> None:
        self.name = name
        self.routers: List[Router] = routers or []
        self.switches: List[Switch] = switches or []
        self.firewalls: List[Firewall] = firewalls or []
        self.load_balancers: List[LoadBalancer] = load_balancers or []
        self.gpu_firewalls: List[GPUFirewall] = gpu_firewalls or []
        self.gpu_servers: List[GPUServer] = gpu_servers or []

    # ── Accessors ────────────────────────────────────────────────────────────

    def all_devices(self) -> List[LabDevice]:
        return (
            self.routers
            + self.switches
            + self.firewalls
            + self.load_balancers
            + self.gpu_firewalls
            + self.gpu_servers
        )

    def get_device(self, name: str) -> Optional[LabDevice]:
        return next((d for d in self.all_devices() if d.name == name), None)

    def devices_by_role(self, role: DeviceRole) -> List[LabDevice]:
        return [d for d in self.all_devices() if d.role == role]

    def unprovisioned(self) -> List[LabDevice]:
        return [d for d in self.all_devices() if d.ztp_state == ZTPState.UNPROVISIONED]

    def summary(self) -> Dict[str, int]:
        return {
            "total": len(self.all_devices()),
            "routers": len(self.routers),
            "switches": len(self.switches),
            "firewalls": len(self.firewalls),
            "load_balancers": len(self.load_balancers),
            "gpu_firewalls": len(self.gpu_firewalls),
            "gpu_servers": len(self.gpu_servers),
        }

    # ── YAML loader ──────────────────────────────────────────────────────────

    @classmethod
    def from_yaml(cls, path: Union[str, Path]) -> "LabTopology":
        with open(path) as fh:
            data = yaml.safe_load(fh)

        name = data.get("lab", {}).get("name", Path(path).stem)

        routers = [
            Router(
                name=r["name"],
                platform=_platform(r.get("platform", "cisco_iosxe")),
                management_ip=r["management_ip"],
                model=r.get("model"),
                asn=r.get("asn"),
                loopback0=r.get("loopback0"),
                bgp_neighbors=r.get("bgp_neighbors", []),
                routing_protocols=r.get("routing_protocols", []),
                interfaces=_parse_interfaces(r.get("interfaces")),
                tags=r.get("tags", {}),
            )
            for r in data.get("routers", [])
        ]

        switches = [
            Switch(
                name=s["name"],
                platform=_platform(s.get("platform", "cisco_iosxe")),
                management_ip=s["management_ip"],
                model=s.get("model"),
                layer=s.get("layer", 2),
                vlans=s.get("vlans", []),
                spanning_tree_mode=s.get("spanning_tree_mode", "rapid-pvst"),
                interfaces=_parse_interfaces(s.get("interfaces")),
                tags=s.get("tags", {}),
            )
            for s in data.get("switches", [])
        ]

        firewalls = [
            Firewall(
                name=fw["name"],
                platform=_platform(fw.get("platform", "paloalto_panos")),
                management_ip=fw["management_ip"],
                model=fw.get("model"),
                ha_peer=fw.get("ha_peer"),
                zones=fw.get("zones", []),
                interfaces=_parse_interfaces(fw.get("interfaces")),
                tags=fw.get("tags", {}),
            )
            for fw in data.get("firewalls", [])
        ]

        load_balancers = [
            LoadBalancer(
                name=lb["name"],
                platform=_platform(lb.get("platform", "f5_tmsh")),
                management_ip=lb["management_ip"],
                model=lb.get("model"),
                virtual_servers=lb.get("virtual_servers", []),
                pool_members=lb.get("pool_members", []),
                health_monitor=lb.get("health_monitor", "tcp"),
                interfaces=_parse_interfaces(lb.get("interfaces")),
                tags=lb.get("tags", {}),
            )
            for lb in data.get("load_balancers", [])
        ]

        gpu_firewalls = [
            GPUFirewall(
                name=gfw["name"],
                platform=_platform(gfw.get("platform", "paloalto_panos")),
                management_ip=gfw["management_ip"],
                model=gfw.get("model"),
                ha_peer=gfw.get("ha_peer"),
                zones=gfw.get("zones", []),
                protected_segments=gfw.get("protected_segments", []),
                rdma_policy=gfw.get("rdma_policy", "allow_rocev2"),
                interfaces=_parse_interfaces(gfw.get("interfaces")),
                tags=gfw.get("tags", {}),
            )
            for gfw in data.get("gpu_firewalls", [])
        ]

        gpu_servers = [
            GPUServer(
                name=gs["name"],
                platform=_platform(gs.get("platform", "linux")),
                management_ip=gs["management_ip"],
                model=gs.get("model"),
                gpu_count=gs.get("gpu_count", 8),
                rdma_interfaces=gs.get("rdma_interfaces", []),
                connected_leaf=gs.get("connected_leaf"),
                tags=gs.get("tags", {}),
            )
            for gs in data.get("gpu_servers", [])
        ]

        return cls(
            name=name,
            routers=routers,
            switches=switches,
            firewalls=firewalls,
            load_balancers=load_balancers,
            gpu_firewalls=gpu_firewalls,
            gpu_servers=gpu_servers,
        )
