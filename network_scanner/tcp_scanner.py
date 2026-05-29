"""TCP port scanner using concurrent connect scans."""

import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Tuple

from .models import PortResult

# Common service name mapping
COMMON_SERVICES = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
    80: "http", 110: "pop3", 143: "imap", 443: "https", 445: "smb",
    465: "smtps", 587: "smtp-submission", 993: "imaps", 995: "pop3s",
    1433: "mssql", 1521: "oracle", 2222: "ssh-alt", 3306: "mysql",
    3389: "rdp", 5432: "postgresql", 5900: "vnc", 6379: "redis",
    6443: "k8s-api", 8080: "http-alt", 8443: "https-alt", 8888: "jupyter",
    9200: "elasticsearch", 9300: "elasticsearch-cluster", 27017: "mongodb",
}

TOP_PORTS_TCP = [
    21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 161, 194,
    389, 443, 445, 465, 514, 587, 636, 993, 995, 1080, 1194, 1433,
    1521, 1723, 2049, 2222, 2375, 2376, 3000, 3306, 3389, 4443, 4848,
    5000, 5432, 5601, 5900, 6379, 6443, 7001, 7080, 7443, 8000, 8008,
    8080, 8081, 8443, 8888, 9000, 9090, 9200, 9300, 9443, 10250, 27017,
]


def grab_banner(ip: str, port: int, timeout: float = 2.0) -> str:
    """Attempt to grab a service banner."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((ip, port))
        # Send a generic probe
        sock.send(b"HEAD / HTTP/1.0\r\nHost: " + ip.encode() + b"\r\n\r\n")
        banner = sock.recv(1024).decode("utf-8", errors="replace").strip()
        sock.close()
        # Return first line only
        return banner.split("\n")[0][:200]
    except OSError:
        return ""


def scan_tcp_port(ip: str, port: int, timeout: float = 1.5, grab_banners: bool = True) -> PortResult:
    """Scan a single TCP port and return a PortResult."""
    result = PortResult(
        port=port,
        protocol="tcp",
        state="closed",
        service=COMMON_SERVICES.get(port, ""),
    )

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        err = sock.connect_ex((ip, port))
        sock.close()

        if err == 0:
            result.state = "open"
            if grab_banners:
                result.banner = grab_banner(ip, port, timeout)
    except OSError:
        result.state = "filtered"

    return result


def scan_tcp_ports(
    ip: str,
    ports: List[int],
    timeout: float = 1.5,
    max_workers: int = 50,
    grab_banners: bool = True,
) -> List[PortResult]:
    """Scan multiple TCP ports on a host concurrently."""
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(scan_tcp_port, ip, port, timeout, grab_banners): port
            for port in ports
        }
        for future in as_completed(futures):
            try:
                result = future.result()
                if result.state == "open":
                    results.append(result)
            except Exception:
                pass

    return sorted(results, key=lambda r: r.port)
