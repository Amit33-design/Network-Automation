"""Lab device models for all device types used in demo topologies."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class DeviceRole(str, Enum):
    ROUTER = "router"
    SWITCH = "switch"
    FIREWALL = "firewall"
    LOAD_BALANCER = "load_balancer"
    GPU_FIREWALL = "gpu_firewall"
    GPU_SERVER = "gpu_server"


class DevicePlatform(str, Enum):
    CISCO_IOS = "cisco_ios"
    CISCO_IOSXE = "cisco_iosxe"
    CISCO_NXOS = "cisco_nxos"
    JUNIPER_JUNOS = "juniper_junos"
    ARISTA_EOS = "arista_eos"
    PALOALTO_PANOS = "paloalto_panos"
    CHECKPOINT_GAIA = "checkpoint_gaia"
    F5_TMSH = "f5_tmsh"
    A10_ACOS = "a10_acos"
    LINUX = "linux"


class ZTPState(str, Enum):
    UNPROVISIONED = "unprovisioned"
    DHCP_REQUESTED = "dhcp_requested"
    BOOTSTRAP_DOWNLOADED = "bootstrap_downloaded"
    CONFIG_APPLIED = "config_applied"
    REGISTERED = "registered"
    PRE_CHECKS_RUNNING = "pre_checks_running"
    PRE_CHECKS_PASSED = "pre_checks_passed"
    ONLINE = "online"
    FAILED = "failed"


@dataclass
class DeviceInterface:
    name: str
    ip_address: Optional[str] = None
    peer_device: Optional[str] = None
    peer_interface: Optional[str] = None
    speed: str = "1G"
    state: str = "up"
    is_gpu_port: bool = False


@dataclass
class LabDevice:
    """Base device. Subclasses override ``role`` via ``__post_init__``."""

    name: str
    platform: DevicePlatform
    management_ip: str
    # role has a sentinel default; each subclass sets it in __post_init__
    role: DeviceRole = DeviceRole.ROUTER
    interfaces: List[DeviceInterface] = field(default_factory=list)
    username: str = "admin"
    password: str = "lab123"
    ztp_state: ZTPState = ZTPState.UNPROVISIONED
    tags: Dict[str, str] = field(default_factory=dict)
    serial_number: Optional[str] = None
    model: Optional[str] = None
    os_version: Optional[str] = None

    @property
    def is_online(self) -> bool:
        return self.ztp_state == ZTPState.ONLINE


@dataclass
class Router(LabDevice):
    asn: Optional[int] = None
    loopback0: Optional[str] = None
    bgp_neighbors: List[str] = field(default_factory=list)
    routing_protocols: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.role = DeviceRole.ROUTER


@dataclass
class Switch(LabDevice):
    layer: int = 2
    vlans: List[int] = field(default_factory=list)
    spanning_tree_mode: str = "rapid-pvst"

    def __post_init__(self) -> None:
        self.role = DeviceRole.SWITCH


@dataclass
class Firewall(LabDevice):
    ha_peer: Optional[str] = None
    zones: List[str] = field(default_factory=list)
    policy_count: int = 0

    def __post_init__(self) -> None:
        self.role = DeviceRole.FIREWALL


@dataclass
class LoadBalancer(LabDevice):
    virtual_servers: List[str] = field(default_factory=list)
    pool_members: List[str] = field(default_factory=list)
    health_monitor: str = "tcp"

    def __post_init__(self) -> None:
        self.role = DeviceRole.LOAD_BALANCER


@dataclass
class GPUFirewall(LabDevice):
    ha_peer: Optional[str] = None
    zones: List[str] = field(default_factory=list)
    protected_segments: List[str] = field(default_factory=list)
    rdma_policy: str = "allow_rocev2"

    def __post_init__(self) -> None:
        self.role = DeviceRole.GPU_FIREWALL


@dataclass
class GPUServer(LabDevice):
    gpu_count: int = 8
    rdma_interfaces: List[str] = field(default_factory=list)
    connected_leaf: Optional[str] = None

    def __post_init__(self) -> None:
        self.role = DeviceRole.GPU_SERVER
