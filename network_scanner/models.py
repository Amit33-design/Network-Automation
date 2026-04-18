"""Data models for scan results."""

from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime


@dataclass
class PortResult:
    port: int
    protocol: str           # tcp | udp
    state: str              # open | closed | filtered
    service: str = ""
    banner: str = ""
    http_title: str = ""
    https: bool = False

    def to_dict(self) -> dict:
        return {
            "port": self.port,
            "protocol": self.protocol,
            "state": self.state,
            "service": self.service,
            "banner": self.banner,
            "http_title": self.http_title,
            "https": self.https,
        }


@dataclass
class HostResult:
    ip: str
    hostname: str = ""
    is_alive: bool = False
    open_ports: List[PortResult] = field(default_factory=list)
    scan_time: float = 0.0

    def to_dict(self) -> dict:
        return {
            "ip": self.ip,
            "hostname": self.hostname,
            "is_alive": self.is_alive,
            "open_ports": [p.to_dict() for p in self.open_ports],
            "scan_time": round(self.scan_time, 3),
        }


@dataclass
class ScanResult:
    network: str
    start_time: str = field(default_factory=lambda: datetime.now().isoformat())
    end_time: str = ""
    hosts: List[HostResult] = field(default_factory=list)
    total_open_ports: int = 0

    def to_dict(self) -> dict:
        return {
            "network": self.network,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "total_hosts_scanned": len(self.hosts),
            "hosts_alive": sum(1 for h in self.hosts if h.is_alive),
            "total_open_ports": self.total_open_ports,
            "hosts": [h.to_dict() for h in self.hosts],
        }
