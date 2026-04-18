"""Tests for TCP scanner — uses loopback so no external network needed."""

import socket
import threading
import pytest
from network_scanner.tcp_scanner import scan_tcp_port, scan_tcp_ports


def _start_echo_server(port: int) -> threading.Thread:
    """Start a minimal TCP server on localhost that accepts and closes."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(5)
    srv.settimeout(3)

    def _serve():
        try:
            while True:
                try:
                    conn, _ = srv.accept()
                    conn.send(b"TEST SERVER\r\n")
                    conn.close()
                except socket.timeout:
                    break
                except OSError:
                    break
        finally:
            srv.close()

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    return t


@pytest.fixture(scope="module")
def echo_server():
    port = 19876
    t = _start_echo_server(port)
    yield port
    # Thread will exit on timeout


def test_scan_open_port(echo_server):
    result = scan_tcp_port("127.0.0.1", echo_server, timeout=2.0, grab_banners=False)
    assert result.state == "open"
    assert result.port == echo_server
    assert result.protocol == "tcp"


def test_scan_closed_port():
    result = scan_tcp_port("127.0.0.1", 19877, timeout=1.0, grab_banners=False)
    assert result.state in ("closed", "filtered")


def test_scan_multiple_ports(echo_server):
    ports = [echo_server, 19877, 19878]
    results = scan_tcp_ports("127.0.0.1", ports, timeout=1.5, grab_banners=False)
    open_ports = [r.port for r in results]
    assert echo_server in open_ports
    assert 19877 not in open_ports


def test_service_name_mapping():
    result = scan_tcp_port("127.0.0.1", 19877, timeout=0.5, grab_banners=False)
    # Port 19877 has no service name
    assert result.service == ""

    # Simulate a known port result
    result80 = scan_tcp_port("127.0.0.1", 9, timeout=0.5, grab_banners=False)
    # We just check the port field is correct
    assert result80.port == 9
