"""HTTP/HTTPS detection and title grabbing for open ports."""

import socket
import ssl
import re
from typing import Optional, Tuple
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


def _extract_title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    if match:
        return re.sub(r"\s+", " ", match.group(1).strip())[:150]
    return ""


def _http_request(url: str, timeout: float = 4.0) -> Tuple[int, str, str]:
    """Return (status_code, server_header, page_title)."""
    req = Request(url, headers={"User-Agent": "NetworkScanner/1.0"})
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urlopen(req, timeout=timeout, context=ctx) as resp:
            server = resp.headers.get("Server", "")
            body = resp.read(4096).decode("utf-8", errors="replace")
            return resp.status, server, _extract_title(body)
    except HTTPError as e:
        server = e.headers.get("Server", "") if e.headers else ""
        try:
            body = e.read(4096).decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return e.code, server, _extract_title(body)
    except URLError:
        return 0, "", ""
    except Exception:
        return 0, "", ""


def probe_http(ip: str, port: int, timeout: float = 4.0) -> Optional[dict]:
    """
    Try HTTP then HTTPS on the given port.
    Returns dict with keys: scheme, status, server, title — or None if no HTTP.
    """
    results = []

    # Try HTTPS first for standard HTTPS ports; HTTP first otherwise
    schemes = ["https", "http"] if port in (443, 8443, 4443, 9443) else ["http", "https"]

    for scheme in schemes:
        url = f"{scheme}://{ip}:{port}/"
        status, server, title = _http_request(url, timeout)
        if status > 0:
            results.append({"scheme": scheme, "status": status, "server": server, "title": title})
            break  # Got a valid HTTP response, no need to try the other scheme

    return results[0] if results else None


def detect_http_on_open_ports(ip: str, open_tcp_ports, timeout: float = 4.0) -> None:
    """
    Mutates PortResult objects in-place: sets http_title and https flag
    for any port that responds to HTTP/HTTPS.
    """
    from .models import PortResult

    for port_result in open_tcp_ports:
        if port_result.protocol != "tcp" or port_result.state != "open":
            continue
        info = probe_http(ip, port_result.port, timeout)
        if info:
            port_result.https = info["scheme"] == "https"
            port_result.http_title = info["title"]
            # Enrich service name if unknown
            if not port_result.service:
                port_result.service = info["scheme"]
            # Prepend server header to banner if useful
            if info["server"] and not port_result.banner:
                port_result.banner = f"Server: {info['server']}"
