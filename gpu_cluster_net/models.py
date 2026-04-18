"""Data models for GPU cluster fabric topology."""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional, Dict
import yaml
import ipaddress


@dataclass
class RoCEv2Config:
    pfc_priority: int = 3                  # IEEE 802.1p priority for RoCEv2 (DSCP CS3/46)
    pfc_queues: List[int] = field(default_factory=lambda: [3])
    ecn_min_threshold_bytes: int = 150_000  # ~100 packets at 1500B
    ecn_max_threshold_bytes: int = 1_500_000
    ecn_probability: int = 100             # % drop probability at max threshold
    dscp_rocev2: int = 26                  # DSCP value mapped to PFC priority 3
    mtu: int = 9216                        # Jumbo MTU for lossless fabric
    pfc_watchdog_enabled: bool = True
    pfc_watchdog_interval_ms: int = 100
    dcqcn_enabled: bool = True


@dataclass
class VXLANConfig:
    vni_base: int = 10000
    l2_vni: int = 10100
    l3_vni: int = 10200
    vlan_id: int = 100
    vrf_name: str = "GPU-VRF"
    anycast_gw_mac: str = "0000.1111.2222"
    anycast_gw_ip: str = "10.100.0.1/24"
    multicast_group: Optional[str] = None   # None = ingress replication


@dataclass
class Interface:
    name: str
    description: str = ""
    speed: str = "100G"
    mtu: int = 9216
    is_gpu_port: bool = False
    peer_device: str = ""
    peer_interface: str = ""


@dataclass
class Spine:
    name: str
    host: str                              # management IP for SSH
    loopback0: str                         # router-id / BGP source
    asn: int = 65000
    platform: str = "nxos"
    username: str = "admin"
    password: str = ""
    uplink_interfaces: List[Interface] = field(default_factory=list)

    def loopback_ip(self) -> str:
        return str(ipaddress.IPv4Interface(self.loopback0).ip)


@dataclass
class Leaf:
    name: str
    host: str
    loopback0: str                         # router-id / BGP source
    vtep_loopback: str                     # NVE source (loopback1)
    asn: int = 65001
    platform: str = "nxos"
    username: str = "admin"
    password: str = ""
    uplink_interfaces: List[Interface] = field(default_factory=list)
    gpu_interfaces: List[Interface] = field(default_factory=list)
    vlan_id: int = 100

    def loopback_ip(self) -> str:
        return str(ipaddress.IPv4Interface(self.loopback0).ip)

    def vtep_ip(self) -> str:
        return str(ipaddress.IPv4Interface(self.vtep_loopback).ip)


@dataclass
class Fabric:
    name: str
    spines: List[Spine] = field(default_factory=list)
    leaves: List[Leaf] = field(default_factory=list)
    rocev2: RoCEv2Config = field(default_factory=RoCEv2Config)
    vxlan: VXLANConfig = field(default_factory=VXLANConfig)
    underlay_asn_spine: int = 65000
    underlay_asn_leaf_start: int = 65001
    ntp_servers: List[str] = field(default_factory=lambda: ["169.254.169.254"])
    dns_servers: List[str] = field(default_factory=list)

    @classmethod
    def from_yaml(cls, path: str) -> "Fabric":
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls._from_dict(data)

    @classmethod
    def _from_dict(cls, data: dict) -> "Fabric":
        fab = data.get("fabric", data)

        rocev2_data = fab.get("rocev2", {})
        rocev2 = RoCEv2Config(
            pfc_priority=rocev2_data.get("pfc_priority", 3),
            pfc_queues=rocev2_data.get("pfc_queues", [3]),
            ecn_min_threshold_bytes=rocev2_data.get("ecn_min_threshold_bytes", 150_000),
            ecn_max_threshold_bytes=rocev2_data.get("ecn_max_threshold_bytes", 1_500_000),
            dscp_rocev2=rocev2_data.get("dscp_rocev2", 26),
            mtu=rocev2_data.get("mtu", 9216),
            pfc_watchdog_enabled=rocev2_data.get("pfc_watchdog_enabled", True),
            dcqcn_enabled=rocev2_data.get("dcqcn_enabled", True),
        )

        vxlan_data = fab.get("vxlan", {})
        vxlan = VXLANConfig(
            vni_base=vxlan_data.get("vni_base", 10000),
            l2_vni=vxlan_data.get("l2_vni", 10100),
            l3_vni=vxlan_data.get("l3_vni", 10200),
            vlan_id=vxlan_data.get("vlan_id", 100),
            vrf_name=vxlan_data.get("vrf_name", "GPU-VRF"),
            anycast_gw_mac=vxlan_data.get("anycast_gw_mac", "0000.1111.2222"),
            anycast_gw_ip=vxlan_data.get("anycast_gw_ip", "10.100.0.1/24"),
            multicast_group=vxlan_data.get("multicast_group"),
        )

        spines = []
        for i, s in enumerate(fab.get("spines", [])):
            uplinks = [Interface(**iface) for iface in s.get("uplink_interfaces", [])]
            spines.append(Spine(
                name=s["name"],
                host=s["host"],
                loopback0=s["loopback0"],
                asn=s.get("asn", fab.get("underlay_asn_spine", 65000)),
                platform=s.get("platform", "nxos"),
                username=s.get("username", "admin"),
                password=s.get("password", ""),
                uplink_interfaces=uplinks,
            ))

        leaves = []
        for i, l in enumerate(fab.get("leaves", [])):
            uplinks = [Interface(**iface) for iface in l.get("uplink_interfaces", [])]
            gpu_ifaces = [Interface(is_gpu_port=True, **iface)
                          for iface in l.get("gpu_interfaces", [])]
            leaves.append(Leaf(
                name=l["name"],
                host=l["host"],
                loopback0=l["loopback0"],
                vtep_loopback=l["vtep_loopback"],
                asn=l.get("asn", fab.get("underlay_asn_leaf_start", 65001) + i),
                platform=l.get("platform", "nxos"),
                username=l.get("username", "admin"),
                password=l.get("password", ""),
                uplink_interfaces=uplinks,
                gpu_interfaces=gpu_ifaces,
                vlan_id=l.get("vlan_id", vxlan.vlan_id),
            ))

        return cls(
            name=fab.get("name", "gpu-fabric"),
            spines=spines,
            leaves=leaves,
            rocev2=rocev2,
            vxlan=vxlan,
            underlay_asn_spine=fab.get("underlay_asn_spine", 65000),
            underlay_asn_leaf_start=fab.get("underlay_asn_leaf_start", 65001),
            ntp_servers=fab.get("ntp_servers", ["169.254.169.254"]),
        )

    def all_devices(self) -> List:
        return self.spines + self.leaves

    def spine_loopbacks(self) -> List[str]:
        return [s.loopback_ip() for s in self.spines]
