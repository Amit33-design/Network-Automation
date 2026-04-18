"""Discover local network segments and live hosts."""

import socket
import struct
import ipaddress
import subprocess
import platform
import re
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed


def get_local_networks() -> List[str]:
    """Return list of local network CIDRs by inspecting network interfaces."""
    networks = []

    try:
        import netifaces
        for iface in netifaces.interfaces():
            addrs = netifaces.ifaddresses(iface)
            if netifaces.AF_INET in addrs:
                for addr in addrs[netifaces.AF_INET]:
                    ip = addr.get("addr", "")
                    netmask = addr.get("netmask", "")
                    if ip and netmask and not ip.startswith("127."):
                        try:
                            network = ipaddress.IPv4Network(f"{ip}/{netmask}", strict=False)
                            networks.append(str(network))
                        except ValueError:
                            pass
        return networks
    except ImportError:
        pass

    # Fallback: parse ip/ifconfig output
    return _parse_interfaces_fallback()


def _parse_interfaces_fallback() -> List[str]:
    networks = []
    system = platform.system()

    try:
        if system == "Windows":
            output = subprocess.check_output("ipconfig", text=True, stderr=subprocess.DEVNULL)
            ips = re.findall(r"IPv4 Address.*?:\s*([\d.]+)", output)
            masks = re.findall(r"Subnet Mask.*?:\s*([\d.]+)", output)
            for ip, mask in zip(ips, masks):
                if not ip.startswith("127."):
                    try:
                        net = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
                        networks.append(str(net))
                    except ValueError:
                        pass
        else:
            output = subprocess.check_output(
                ["ip", "addr"], text=True, stderr=subprocess.DEVNULL
            )
            for match in re.finditer(r"inet ([\d.]+/\d+)", output):
                cidr = match.group(1)
                try:
                    net = ipaddress.IPv4Network(cidr, strict=False)
                    if not net.is_loopback:
                        networks.append(str(net))
                except ValueError:
                    pass
    except (subprocess.SubprocessError, FileNotFoundError):
        # Last resort: use socket to guess the local subnet /24
        hostname = socket.gethostname()
        try:
            local_ip = socket.gethostbyname(hostname)
            if not local_ip.startswith("127."):
                parts = local_ip.rsplit(".", 1)
                networks.append(f"{parts[0]}.0/24")
        except socket.gaierror:
            pass

    return networks


def is_host_alive(ip: str, timeout: float = 1.0) -> bool:
    """Check if a host is alive via ICMP ping or TCP probe on port 80/443."""
    # Try ping first
    param = "-n" if platform.system() == "Windows" else "-c"
    try:
        result = subprocess.run(
            ["ping", param, "1", "-W", "1", str(ip)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=3,
        )
        if result.returncode == 0:
            return True
    except (subprocess.SubprocessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback: TCP connect probe on common ports
    for port in (80, 443, 22, 445):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            if sock.connect_ex((str(ip), port)) == 0:
                sock.close()
                return True
            sock.close()
        except OSError:
            pass

    return False


def discover_hosts(network_cidr: str, timeout: float = 1.0, max_workers: int = 100) -> List[str]:
    """Return list of alive host IPs in the given network segment."""
    try:
        network = ipaddress.IPv4Network(network_cidr, strict=False)
    except ValueError as e:
        raise ValueError(f"Invalid network CIDR '{network_cidr}': {e}")

    hosts = [str(h) for h in network.hosts()]
    alive = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_ip = {executor.submit(is_host_alive, ip, timeout): ip for ip in hosts}
        for future in as_completed(future_to_ip):
            ip = future_to_ip[future]
            try:
                if future.result():
                    alive.append(ip)
            except Exception:
                pass

    return sorted(alive, key=lambda x: ipaddress.IPv4Address(x))


def resolve_hostname(ip: str) -> str:
    """Reverse-resolve an IP to hostname."""
    try:
        return socket.gethostbyaddr(ip)[0]
    except (socket.herror, socket.gaierror):
        return ""
