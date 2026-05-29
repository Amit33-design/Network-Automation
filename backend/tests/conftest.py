"""
Shared pytest fixtures for NetDesign AI backend tests.
"""
import sys
import os
import pytest

# Ensure backend package is on path for all tests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ── Minimal DesignState dicts ─────────────────────────────────────────────────

@pytest.fixture
def base_state():
    return {
        "uc": "enterprise",
        "orgName": "TestCorp",
        "orgSize": "medium",
        "redundancy": "ha",
        "fwModel": "perimeter",
        "selectedProducts": {
            "core-switch": "cat9500-48y4c",
            "firewall":    "asa-5508-x",
        },
        "protocols":  ["ospf", "bgp"],
        "security":   ["acl"],
        "compliance": [],
        "vlans": [
            {"id": 10, "name": "PROD", "gw": "10.0.10.1"},
            {"id": 20, "name": "MGMT", "gw": "10.0.20.1"},
        ],
        "appFlows": [],
        "include_bgp_policy": True,
        "include_acl":        True,
        "include_dot1x":      True,
        "include_qos":        True,
        "include_aaa":        True,
    }


@pytest.fixture
def dc_state():
    return {
        "uc": "dc",
        "orgName": "DCCorp",
        "orgSize": "large",
        "redundancy": "ha",
        "fwModel": None,
        "selectedProducts": {
            "dc-spine": "nexus-9336c",
            "dc-leaf":  "nexus-93180",
        },
        "protocols":  ["bgp", "evpn"],
        "security":   [],
        "compliance": [],
        "vlans": [{"id": 100, "name": "SERVERS"}],
        "appFlows": [],
    }


@pytest.fixture
def minimal_state():
    """Smallest valid state — only required fields."""
    return {
        "uc": "enterprise",
        "orgName": "Min",
        "orgSize": "small",
        "redundancy": "none",
        "selectedProducts": {"access": "cat9200l"},
        "protocols":  [],
        "security":   [],
        "compliance": [],
        "vlans": [],
        "appFlows": [],
    }


# ── Device inventory fixtures ─────────────────────────────────────────────────

@pytest.fixture
def device_inventory():
    return {
        "sw-core-01": {
            "hostname": "10.0.0.1",
            "platform": "ios-xe",
            "username": "admin",
            "password": "test",
            "port": 22,
        },
        "sw-access-01": {
            "hostname": "10.0.0.2",
            "platform": "nxos",
            "username": "admin",
            "password": "test",
            "port": 22,
        },
    }
