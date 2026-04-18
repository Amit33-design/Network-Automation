"""Core orchestrator: ties together discovery, TCP, UDP, and HTTP scanning."""

import time
import ipaddress
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import List, Optional, Callable

from .models import ScanResult, HostResult, PortResult
from .network_discovery import get_local_networks, discover_hosts, resolve_hostname
from .tcp_scanner import scan_tcp_ports, TOP_PORTS_TCP
from .udp_scanner import scan_udp_ports, TOP_PORTS_UDP
from .http_scanner import detect_http_on_open_ports


class ScanConfig:
    def __init__(
        self,
        tcp_ports: Optional[List[int]] = None,
        udp_ports: Optional[List[int]] = None,
        tcp_timeout: float = 1.5,
        udp_timeout: float = 2.0,
        http_timeout: float = 4.0,
        host_timeout: float = 1.0,
        max_host_workers: int = 20,
        max_port_workers: int = 50,
        scan_tcp: bool = True,
        scan_udp: bool = True,
        scan_http: bool = True,
        grab_banners: bool = True,
        udp_confirmed_only: bool = False,
        resolve_hostnames: bool = True,
    ):
        self.tcp_ports = tcp_ports or TOP_PORTS_TCP
        self.udp_ports = udp_ports or TOP_PORTS_UDP
        self.tcp_timeout = tcp_timeout
        self.udp_timeout = udp_timeout
        self.http_timeout = http_timeout
        self.host_timeout = host_timeout
        self.max_host_workers = max_host_workers
        self.max_port_workers = max_port_workers
        self.scan_tcp = scan_tcp
        self.scan_udp = scan_udp
        self.scan_http = scan_http
        self.grab_banners = grab_banners
        self.udp_confirmed_only = udp_confirmed_only
        self.resolve_hostnames = resolve_hostnames


class NetworkScanner:
    def __init__(self, config: Optional[ScanConfig] = None):
        self.config = config or ScanConfig()

    def _scan_host(self, ip: str) -> HostResult:
        start = time.time()
        cfg = self.config
        host = HostResult(ip=ip, is_alive=True)

        if cfg.resolve_hostnames:
            host.hostname = resolve_hostname(ip)

        open_ports: List[PortResult] = []

        if cfg.scan_tcp:
            tcp_results = scan_tcp_ports(
                ip,
                cfg.tcp_ports,
                timeout=cfg.tcp_timeout,
                max_workers=cfg.max_port_workers,
                grab_banners=cfg.grab_banners,
            )
            open_ports.extend(tcp_results)

        if cfg.scan_http and open_ports:
            detect_http_on_open_ports(ip, open_ports, timeout=cfg.http_timeout)

        if cfg.scan_udp:
            udp_results = scan_udp_ports(
                ip,
                cfg.udp_ports,
                timeout=cfg.udp_timeout,
                max_workers=min(30, cfg.max_port_workers),
                confirmed_only=cfg.udp_confirmed_only,
            )
            open_ports.extend(udp_results)

        host.open_ports = open_ports
        host.scan_time = time.time() - start
        return host

    def scan_network(
        self,
        network_cidr: str,
        progress_callback: Optional[Callable[[str, int, int], None]] = None,
    ) -> ScanResult:
        """
        Scan all hosts in a network segment.
        progress_callback(ip, current, total) is called after each host.
        """
        result = ScanResult(network=network_cidr)
        cfg = self.config

        # Discover alive hosts
        alive_hosts = discover_hosts(network_cidr, timeout=cfg.host_timeout)

        total = len(alive_hosts)
        done = 0

        with ThreadPoolExecutor(max_workers=cfg.max_host_workers) as executor:
            future_to_ip = {executor.submit(self._scan_host, ip): ip for ip in alive_hosts}
            for future in as_completed(future_to_ip):
                ip = future_to_ip[future]
                done += 1
                try:
                    host_result = future.result()
                    result.hosts.append(host_result)
                except Exception as e:
                    result.hosts.append(HostResult(ip=ip, is_alive=True))

                if progress_callback:
                    progress_callback(ip, done, total)

        result.hosts.sort(key=lambda h: ipaddress.IPv4Address(h.ip))
        result.total_open_ports = sum(len(h.open_ports) for h in result.hosts)
        result.end_time = datetime.now().isoformat()
        return result

    def scan_host(self, ip: str) -> HostResult:
        """Scan a single host directly."""
        return self._scan_host(ip)

    def scan_networks(
        self,
        networks: Optional[List[str]] = None,
        progress_callback: Optional[Callable[[str, str, int, int], None]] = None,
    ) -> List[ScanResult]:
        """
        Scan multiple network segments (defaults to auto-detected local networks).
        progress_callback(network, ip, current, total)
        """
        if networks is None:
            networks = get_local_networks()

        results = []
        for net in networks:
            def cb(ip, cur, tot, _net=net):
                if progress_callback:
                    progress_callback(_net, ip, cur, tot)

            result = self.scan_network(net, progress_callback=cb)
            results.append(result)

        return results
