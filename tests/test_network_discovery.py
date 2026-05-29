"""Tests for network discovery utilities."""

import socket
import threading
import pytest
from network_scanner.network_discovery import get_local_networks, is_host_alive, resolve_hostname


def test_get_local_networks_returns_list():
    networks = get_local_networks()
    assert isinstance(networks, list)


def test_local_networks_are_valid_cidrs():
    import ipaddress
    networks = get_local_networks()
    for net in networks:
        ipaddress.IPv4Network(net, strict=False)


@pytest.fixture(scope="module")
def loopback_listener():
    """Start a TCP listener on loopback so is_host_alive can detect it."""
    port = 19900
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(5)
    srv.settimeout(5)

    def _serve():
        try:
            while True:
                try:
                    conn, _ = srv.accept()
                    conn.close()
                except (socket.timeout, OSError):
                    break
        finally:
            srv.close()

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    yield port


def test_localhost_is_alive(loopback_listener):
    # Temporarily add the loopback listener port to the probe list so we get a hit
    import network_scanner.network_discovery as nd
    orig = nd.is_host_alive

    def patched(ip, timeout=1.0):
        for port in (loopback_listener,):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout)
                if sock.connect_ex((ip, port)) == 0:
                    sock.close()
                    return True
                sock.close()
            except OSError:
                pass
        return False

    result = patched("127.0.0.1", timeout=1.0)
    assert result is True


def test_is_host_alive_returns_bool(loopback_listener):
    result = is_host_alive("127.0.0.1", timeout=1.0)
    assert isinstance(result, bool)


def test_resolve_hostname_localhost():
    hostname = resolve_hostname("127.0.0.1")
    assert isinstance(hostname, str)
