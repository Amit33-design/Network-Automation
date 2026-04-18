"""Tests for output reporter."""

import json
import csv
import io
import pytest
from network_scanner.models import ScanResult, HostResult, PortResult
from network_scanner import reporter


def _make_scan() -> ScanResult:
    ports = [
        PortResult(port=80, protocol="tcp", state="open", service="http", http_title="My Site"),
        PortResult(port=443, protocol="tcp", state="open", service="https", https=True, http_title="My Site"),
        PortResult(port=53, protocol="udp", state="open", service="dns"),
    ]
    host = HostResult(ip="10.0.0.1", hostname="gw.local", is_alive=True, open_ports=ports)
    scan = ScanResult(network="10.0.0.0/24", hosts=[host], total_open_ports=3)
    scan.end_time = "2024-01-01T00:01:00"
    return scan


def test_to_text_contains_ip():
    scan = _make_scan()
    text = reporter.to_text(scan)
    assert "10.0.0.1" in text
    assert "10.0.0.0/24" in text


def test_to_text_contains_ports():
    scan = _make_scan()
    text = reporter.to_text(scan)
    assert "80" in text
    assert "443" in text
    assert "53" in text


def test_to_json_valid():
    scan = _make_scan()
    raw = reporter.to_json(scan)
    data = json.loads(raw)
    assert data["network"] == "10.0.0.0/24"
    assert data["total_open_ports"] == 3
    assert len(data["hosts"]) == 1
    assert data["hosts"][0]["ip"] == "10.0.0.1"


def test_to_json_list():
    scan = _make_scan()
    raw = reporter.to_json([scan, scan])
    data = json.loads(raw)
    assert isinstance(data, list)
    assert len(data) == 2


def test_to_csv_valid():
    scan = _make_scan()
    raw = reporter.to_csv(scan)
    reader = csv.DictReader(io.StringIO(raw))
    rows = list(reader)
    assert len(rows) == 3
    ports_in_csv = {int(r["port"]) for r in rows}
    assert {80, 443, 53} == ports_in_csv


def test_to_csv_https_flag():
    scan = _make_scan()
    raw = reporter.to_csv(scan)
    reader = csv.DictReader(io.StringIO(raw))
    for row in reader:
        if row["port"] == "443":
            assert row["https"] == "True"
        elif row["port"] == "80":
            assert row["https"] == "False"


def test_save_text(tmp_path):
    scan = _make_scan()
    out = tmp_path / "result.txt"
    reporter.save(scan, str(out), fmt="text")
    content = out.read_text()
    assert "10.0.0.1" in content


def test_save_json(tmp_path):
    scan = _make_scan()
    out = tmp_path / "result.json"
    reporter.save(scan, str(out), fmt="json")
    data = json.loads(out.read_text())
    assert data["network"] == "10.0.0.0/24"


def test_save_csv(tmp_path):
    scan = _make_scan()
    out = tmp_path / "result.csv"
    reporter.save(scan, str(out), fmt="csv")
    content = out.read_text()
    assert "port" in content
    assert "10.0.0.1" in content


def test_save_invalid_format():
    scan = _make_scan()
    with pytest.raises(ValueError, match="Unknown format"):
        reporter.save(scan, "/tmp/x", fmt="xml")
