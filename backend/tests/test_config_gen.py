"""
Tests for config_gen.py — Jinja2 config rendering engine.

Run with:  pytest backend/tests/ -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from config_gen import generate_all_configs, _build_device_context, _render


# ─────────────────────────────────────────────────────────────
# Fixtures — minimal state dicts per use case
# ─────────────────────────────────────────────────────────────

@pytest.fixture
def dc_state():
    return {
        "uc": "dc",
        "orgName": "TestCorp",
        "orgSize": "large",
        "redundancy": "ha",
        "fwModel": "perimeter",
        "selectedProducts": {
            "dc-spine": "nexus-9336c",
            "dc-leaf":  "nexus-93180",
        },
        "protocols":  ["bgp", "is-is", "evpn"],
        "security":   [],
        "compliance": [],
        "vlans": [
            {"id": 10, "name": "PROD", "gw": "192.168.10.1"},
            {"id": 20, "name": "DEV",  "gw": "192.168.20.1"},
        ],
        "appFlows": [],
    }


@pytest.fixture
def campus_state():
    return {
        "uc": "campus",
        "orgName": "StateUniv",
        "orgSize": "large",
        "redundancy": "ha",
        "fwModel": "perimeter",
        "selectedProducts": {
            "campus-access": "cat9300-48p",
            "campus-dist":   "cat9500-48y4c",
        },
        "protocols":  ["ospf"],
        "security":   ["802.1x"],
        "compliance": [],
        "vlans": [
            {"id": 10, "name": "DATA"},
            {"id": 20, "name": "VOICE"},
        ],
        "appFlows": [],
    }


@pytest.fixture
def gpu_state():
    return {
        "uc": "gpu",
        "orgName": "AILab",
        "orgSize": "enterprise",
        "redundancy": "full",
        "fwModel": "perimeter",
        "selectedProducts": {
            "gpu-spine": "arista-7800r3",
            "gpu-tor":   "nvidia-sn4600c",
        },
        "protocols":  ["bgp"],
        "security":   [],
        "compliance": [],
        "vlans": [],
        "appFlows": [],
    }


# ─────────────────────────────────────────────────────────────
# _build_device_context tests
# ─────────────────────────────────────────────────────────────

class TestBuildDeviceContext:

    def test_hostname_format(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-spine", 1)
        assert "TESTCORP" in ctx["hostname"]
        assert "DC_SPINE" in ctx["hostname"]
        assert ctx["index"] == 1

    def test_hostname_index_increments(self, dc_state):
        ctx1 = _build_device_context(dc_state, "dc-leaf", 1)
        ctx2 = _build_device_context(dc_state, "dc-leaf", 2)
        assert ctx1["hostname"] != ctx2["hostname"]
        assert ctx1["index"] == 1
        assert ctx2["index"] == 2

    def test_dc_context_includes_vxlan(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-leaf", 1)
        assert "vxlan_vni_base" in ctx
        assert isinstance(ctx["vxlan_vni_base"], int)
        assert ctx["vxlan_vni_base"] > 0

    def test_dc_context_bgp_evpn_flag(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-leaf", 1)
        # evpn in protocols → bgp_evpn should be True
        assert ctx["bgp_evpn"] is True

    def test_campus_context_dot1x_flag(self, campus_state):
        ctx = _build_device_context(campus_state, "campus-access", 1)
        assert ctx["dot1x_enabled"] is True

    def test_campus_context_dhcp_snooping(self, campus_state):
        ctx = _build_device_context(campus_state, "campus-access", 1)
        assert ctx["dhcp_snooping"] is True

    def test_gpu_context_roce(self, gpu_state):
        ctx = _build_device_context(gpu_state, "gpu-tor", 1)
        assert ctx["roce_enabled"] is True
        assert len(ctx["pfc_queues"]) > 0
        assert ctx["ecn_threshold"] > 0

    def test_loopback_ip_is_valid(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-spine", 1)
        parts = ctx["loopback_ip"].split(".")
        assert len(parts) == 4
        assert all(p.isdigit() for p in parts)

    def test_bgp_asn_is_int(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-spine", 1)
        assert isinstance(ctx["bgp_asn"], int)
        assert ctx["bgp_asn"] >= 65000


# ─────────────────────────────────────────────────────────────
# generate_all_configs tests
# ─────────────────────────────────────────────────────────────

class TestGenerateAllConfigs:

    def test_returns_dict(self, dc_state):
        result = generate_all_configs(dc_state)
        assert isinstance(result, dict)

    def test_ha_generates_two_devices_per_layer(self, dc_state):
        """redundancy=ha should produce at least 2 devices per selected layer."""
        result = generate_all_configs(dc_state)
        # spine×2 + leaf×2 minimum; fwModel=perimeter may add FW devices
        assert len(result) >= 4
        spine_count = sum(1 for h in result if "SPINE" in h.upper())
        leaf_count   = sum(1 for h in result if "LEAF"  in h.upper())
        assert spine_count >= 2, "HA should produce ≥2 spine devices"
        assert leaf_count  >= 2, "HA should produce ≥2 leaf devices"

    def test_single_redundancy_generates_one_device(self, dc_state):
        dc_state["redundancy"] = "single"
        result = generate_all_configs(dc_state)
        # spine×1 + leaf×1 minimum; fwModel may add 1 FW device
        assert len(result) >= 2
        spine_count = sum(1 for h in result if "SPINE" in h.upper())
        leaf_count   = sum(1 for h in result if "LEAF"  in h.upper())
        assert spine_count >= 1, "Single should produce ≥1 spine device"
        assert leaf_count  >= 1, "Single should produce ≥1 leaf device"

    def test_config_is_non_empty_string(self, dc_state):
        result = generate_all_configs(dc_state)
        for hostname, cfg in result.items():
            assert isinstance(cfg, str), f"{hostname} config is not a string"
            assert len(cfg) > 50, f"{hostname} config is suspiciously short"

    def test_empty_selected_products_returns_empty(self, dc_state):
        dc_state["selectedProducts"] = {}
        result = generate_all_configs(dc_state)
        assert result == {}

    def test_campus_config_contains_hostname(self, campus_state):
        result = generate_all_configs(campus_state)
        for hostname, cfg in result.items():
            assert hostname.split("-")[0] in cfg or "hostname" in cfg.lower(), \
                f"Hostname not found in config for {hostname}"

    def test_campus_access_config_has_vlan_section(self, campus_state):
        result = generate_all_configs(campus_state)
        access_configs = {k: v for k, v in result.items() if "CAMPUS_ACCESS" in k}
        assert len(access_configs) > 0
        for hostname, cfg in access_configs.items():
            assert "vlan" in cfg.lower(), f"No VLAN config in {hostname}"

    def test_dc_spine_config_has_bgp(self, dc_state):
        result = generate_all_configs(dc_state)
        spine_configs = {k: v for k, v in result.items() if "DC_SPINE" in k}
        assert len(spine_configs) > 0
        for hostname, cfg in spine_configs.items():
            assert "bgp" in cfg.lower(), f"No BGP config in {hostname}"

    def test_gpu_tor_config_is_json_like(self, gpu_state):
        """SONiC TOR config should be JSON (config_db format)."""
        result = generate_all_configs(gpu_state)
        tor_configs = {k: v for k, v in result.items() if "GPU_TOR" in k}
        assert len(tor_configs) > 0
        for hostname, cfg in tor_configs.items():
            assert "{" in cfg, f"SONiC config for {hostname} doesn't look like JSON"
            assert "DEVICE_METADATA" in cfg, f"Missing DEVICE_METADATA in {hostname}"

    def test_all_hostnames_are_unique(self, dc_state):
        result = generate_all_configs(dc_state)
        assert len(result) == len(set(result.keys())), "Duplicate hostnames generated"


# ─────────────────────────────────────────────────────────────
# Template rendering tests (requires template files)
# ─────────────────────────────────────────────────────────────

class TestTemplateRendering:

    def test_nxos_spine_template_renders(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-spine", 1)
        rendered = _render("nxos", "spine.j2", ctx)
        assert "hostname" in rendered
        assert "router bgp" in rendered
        assert "route-reflector-client" in rendered

    def test_nxos_leaf_template_renders(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-leaf", 1)
        rendered = _render("nxos", "leaf.j2", ctx)
        assert "nve1" in rendered
        assert "vxlan" in rendered.lower() or "vn-segment" in rendered

    def test_ios_xe_access_template_renders(self, campus_state):
        ctx = _build_device_context(campus_state, "campus-access", 1)
        rendered = _render("ios_xe", "access.j2", ctx)
        assert "hostname" in rendered
        assert "spanning-tree" in rendered
        assert "ip dhcp snooping" in rendered

    def test_ios_xe_distribution_template_renders(self, campus_state):
        ctx = _build_device_context(campus_state, "campus-dist", 1)
        rendered = _render("ios_xe", "distribution.j2", ctx)
        assert "hostname" in rendered
        assert "ospf" in rendered.lower()

    def test_eos_gpu_spine_template_renders(self, gpu_state):
        ctx = _build_device_context(gpu_state, "gpu-spine", 1)
        rendered = _render("eos", "gpu_spine.j2", ctx)
        assert "hostname" in rendered
        assert "router bgp" in rendered

    def test_sonic_gpu_tor_template_renders(self, gpu_state):
        ctx = _build_device_context(gpu_state, "gpu-tor", 1)
        rendered = _render("sonic", "gpu_tor.j2", ctx)
        assert "DEVICE_METADATA" in rendered
        assert "BGP_NEIGHBOR" in rendered
        assert "PFC_WD" in rendered

    def test_missing_template_returns_comment(self):
        """Missing template should return a comment, not raise an exception."""
        rendered = _render("ios_xe", "nonexistent_template.j2", {})
        assert "not found" in rendered.lower() or "!" in rendered

    def test_junos_generic_template_renders(self, dc_state):
        ctx = _build_device_context(dc_state, "dc-leaf", 1)
        rendered = _render("junos", "generic.j2", ctx)
        assert "host-name" in rendered or "hostname" in rendered
        assert "routing-options" in rendered
