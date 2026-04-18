"""Tests for data models."""

import pytest
from network_scanner.models import PortResult, HostResult, ScanResult


def test_port_result_to_dict():
    p = PortResult(port=80, protocol="tcp", state="open", service="http",
                   banner="Apache", http_title="Home", https=False)
    d = p.to_dict()
    assert d["port"] == 80
    assert d["protocol"] == "tcp"
    assert d["state"] == "open"
    assert d["service"] == "http"
    assert d["http_title"] == "Home"
    assert d["https"] is False


def test_host_result_to_dict():
    ports = [PortResult(port=443, protocol="tcp", state="open", https=True)]
    h = HostResult(ip="10.0.0.1", hostname="router.local", is_alive=True, open_ports=ports)
    d = h.to_dict()
    assert d["ip"] == "10.0.0.1"
    assert d["hostname"] == "router.local"
    assert d["is_alive"] is True
    assert len(d["open_ports"]) == 1
    assert d["open_ports"][0]["port"] == 443


def test_scan_result_to_dict():
    host = HostResult(ip="192.168.1.1", is_alive=True)
    host.open_ports = [PortResult(port=80, protocol="tcp", state="open")]
    scan = ScanResult(network="192.168.1.0/24", hosts=[host], total_open_ports=1)
    d = scan.to_dict()
    assert d["network"] == "192.168.1.0/24"
    assert d["total_open_ports"] == 1
    assert d["hosts_alive"] == 1
    assert len(d["hosts"]) == 1


def test_scan_result_counts_alive():
    hosts = [
        HostResult(ip="192.168.1.1", is_alive=True),
        HostResult(ip="192.168.1.2", is_alive=False),
        HostResult(ip="192.168.1.3", is_alive=True),
    ]
    scan = ScanResult(network="192.168.1.0/24", hosts=hosts)
    d = scan.to_dict()
    assert d["hosts_alive"] == 2
    assert d["total_hosts_scanned"] == 3
