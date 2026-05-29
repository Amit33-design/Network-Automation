"""UDP port scanner with payload-based probing for common services."""

import socket
import struct
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Tuple, Optional

from .models import PortResult

# UDP payloads that elicit a response from common services
UDP_PROBES: Dict[int, bytes] = {
    53:   b"\x00\x01\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00"
          b"\x07version\x04bind\x00\x00\x10\x00\x03",   # DNS version query
    67:   b"\x01\x01\x06\x00" + b"\x00" * 232,           # DHCP discover (minimal)
    69:   b"\x00\x01" + b"test\x00" + b"octet\x00",      # TFTP read request
    123:  b"\x1b" + b"\x00" * 47,                         # NTP client request
    161:  (                                                 # SNMP GetRequest v1 (public)
        b"\x30\x26\x02\x01\x00\x04\x06public\xa0\x19"
        b"\x02\x04\x00\x00\x00\x01\x02\x01\x00\x02\x01\x00"
        b"\x30\x0b\x30\x09\x06\x05\x2b\x06\x01\x02\x01\x05\x00"
    ),
    500:  b"\x00" * 4 + b"\x00" * 4 + b"\x00" * 8 + b"\x01\x10\x02\x00",  # IKE
    514:  b"<14>test message\n",                           # Syslog
    520:  b"\x01\x01\x00\x00" + b"\x00" * 16,             # RIP request
    1194: b"\x38\x00\x00\x00\x00\x00\x00\x00\x00",        # OpenVPN
    1900: (                                                  # SSDP M-SEARCH
        b"M-SEARCH * HTTP/1.1\r\n"
        b"HOST: 239.255.255.250:1900\r\n"
        b'MAN: "ssdp:discover"\r\n'
        b"MX: 1\r\n"
        b"ST: ssdp:all\r\n\r\n"
    ),
    5353: (                                                  # mDNS query
        b"\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00"
        b"\x05_http\x04_tcp\x05local\x00\x00\x0c\x00\x01"
    ),
}

COMMON_SERVICES_UDP = {
    53: "dns", 67: "dhcp", 68: "dhcp-client", 69: "tftp",
    123: "ntp", 137: "netbios-ns", 138: "netbios-dgm",
    161: "snmp", 162: "snmp-trap", 500: "isakmp",
    514: "syslog", 520: "rip", 1194: "openvpn", 1900: "ssdp",
    4500: "ipsec-nat-t", 5353: "mdns", 5355: "llmnr",
}

TOP_PORTS_UDP = sorted(COMMON_SERVICES_UDP.keys()) + [
    111, 177, 427, 443, 445, 623, 1434, 1701, 2049, 5060, 17185,
]


def scan_udp_port(ip: str, port: int, timeout: float = 2.0) -> PortResult:
    """
    Probe a single UDP port.
    State is 'open' if we get a response, 'open|filtered' if no response,
    'closed' if we get an ICMP port-unreachable.
    """
    result = PortResult(
        port=port,
        protocol="udp",
        state="open|filtered",
        service=COMMON_SERVICES_UDP.get(port, ""),
    )

    payload = UDP_PROBES.get(port, b"\x00" * 4)

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        sock.sendto(payload, (ip, port))
        data, _ = sock.recvfrom(1024)
        sock.close()
        result.state = "open"
        result.banner = data[:100].decode("utf-8", errors="replace").strip()
    except socket.timeout:
        # No response — port is open|filtered (firewall or service ignoring)
        result.state = "open|filtered"
    except ConnectionRefusedError:
        # ICMP port unreachable = definitively closed
        result.state = "closed"
    except OSError:
        result.state = "open|filtered"
    finally:
        try:
            sock.close()
        except Exception:
            pass

    return result


def scan_udp_ports(
    ip: str,
    ports: Optional[List[int]] = None,
    timeout: float = 2.0,
    max_workers: int = 30,
    confirmed_only: bool = False,
) -> List[PortResult]:
    """
    Scan multiple UDP ports. If confirmed_only=True, only return ports with
    definitive 'open' responses; otherwise include 'open|filtered' as well.
    """
    if ports is None:
        ports = TOP_PORTS_UDP

    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(scan_udp_port, ip, port, timeout): port for port in ports}
        for future in as_completed(futures):
            try:
                result = future.result()
                if result.state == "open" or (not confirmed_only and result.state == "open|filtered"):
                    results.append(result)
            except Exception:
                pass

    return sorted(results, key=lambda r: r.port)
