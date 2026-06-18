"""
Tests for troubleshoot.py — Troubleshooting Tooling Engine (G-A19).
"""
import pytest
from troubleshoot import (
    build_troubleshooting,
    PLAYBOOKS,
    GENERIC_PLAYBOOK,
    SUPPORTED_PLATFORMS,
)

KNOWN_SYMPTOMS = [
    "bgp_down",
    "ospf_adjacency",
    "interface_flap",
    "high_latency",
    "packet_loss",
    "high_cpu",
    "vxlan_evpn",
    "pfc_rocev2",
]


# ── Shape / contract ────────────────────────────────────────────────────────

class TestContract:
    @pytest.mark.parametrize("symptom", KNOWN_SYMPTOMS)
    def test_top_level_keys(self, symptom):
        r = build_troubleshooting(symptom, ["leaf1"], "nxos")
        for key in ("symptom", "category", "summary", "diagnostic_steps",
                    "likely_causes", "remediation"):
            assert key in r, f"missing key {key}"

    @pytest.mark.parametrize("symptom", KNOWN_SYMPTOMS)
    def test_non_empty_sections(self, symptom):
        r = build_troubleshooting(symptom, [], "nxos")
        assert len(r["diagnostic_steps"]) >= 3
        assert len(r["likely_causes"]) >= 2
        assert len(r["remediation"]) >= 2

    @pytest.mark.parametrize("symptom", KNOWN_SYMPTOMS)
    def test_step_fields(self, symptom):
        r = build_troubleshooting(symptom, [], "nxos")
        for i, step in enumerate(r["diagnostic_steps"], start=1):
            assert step["order"] == i
            assert step["description"]
            assert step["command"]
            assert step["look_for"]

    @pytest.mark.parametrize("symptom", KNOWN_SYMPTOMS)
    def test_cause_fields(self, symptom):
        r = build_troubleshooting(symptom, [], "nxos")
        for c in r["likely_causes"]:
            assert c["cause"]
            assert 0.0 <= c["confidence"] <= 1.0
            assert isinstance(c["indicators"], list)


# ── Ranking ─────────────────────────────────────────────────────────────────

class TestRanking:
    @pytest.mark.parametrize("symptom", KNOWN_SYMPTOMS)
    def test_causes_sorted_desc(self, symptom):
        r = build_troubleshooting(symptom, [], "nxos")
        confs = [c["confidence"] for c in r["likely_causes"]]
        assert confs == sorted(confs, reverse=True)


# ── Category labels ─────────────────────────────────────────────────────────

class TestCategories:
    def test_known_categories(self):
        assert build_troubleshooting("bgp_down", [], "nxos")["category"] == "BGP"
        assert build_troubleshooting("ospf_adjacency", [], "nxos")["category"] == "OSPF"
        assert build_troubleshooting("interface_flap", [], "nxos")["category"] == "Interface"
        assert build_troubleshooting("high_latency", [], "nxos")["category"] == "Performance"
        assert build_troubleshooting("packet_loss", [], "nxos")["category"] == "Performance"
        assert build_troubleshooting("high_cpu", [], "nxos")["category"] == "Performance"
        assert build_troubleshooting("vxlan_evpn", [], "nxos")["category"] == "Overlay"
        assert build_troubleshooting("pfc_rocev2", [], "nxos")["category"] == "QoS/RoCEv2"


# ── Platform-specific commands ──────────────────────────────────────────────

class TestPlatformCommands:
    def test_bgp_junos_differs_from_nxos(self):
        nxos = build_troubleshooting("bgp_down", [], "nxos")
        junos = build_troubleshooting("bgp_down", [], "junos")
        assert nxos["diagnostic_steps"][0]["command"] == "show ip bgp summary"
        assert junos["diagnostic_steps"][0]["command"] == "show bgp summary"
        assert nxos["diagnostic_steps"][0]["command"] != junos["diagnostic_steps"][0]["command"]

    def test_bgp_eos_iosxe_match_nxos_summary(self):
        for plat in ("nxos", "iosxe", "eos"):
            r = build_troubleshooting("bgp_down", [], plat)
            assert r["diagnostic_steps"][0]["command"] == "show ip bgp summary"

    def test_ospf_neighbor_differs(self):
        nxos = build_troubleshooting("ospf_adjacency", [], "nxos")
        junos = build_troubleshooting("ospf_adjacency", [], "junos")
        assert nxos["diagnostic_steps"][0]["command"] == "show ip ospf neighbors"
        assert junos["diagnostic_steps"][0]["command"] == "show ospf neighbor"

    def test_unknown_platform_defaults_to_nxos(self):
        weird = build_troubleshooting("bgp_down", [], "frobnicator")
        nxos = build_troubleshooting("bgp_down", [], "nxos")
        assert weird["diagnostic_steps"][0]["command"] == nxos["diagnostic_steps"][0]["command"]

    @pytest.mark.parametrize("plat", SUPPORTED_PLATFORMS)
    def test_all_platforms_produce_commands(self, plat):
        for symptom in KNOWN_SYMPTOMS:
            r = build_troubleshooting(symptom, [], plat)
            for step in r["diagnostic_steps"]:
                assert step["command"], f"empty command for {symptom}/{plat}"


# ── Fallback ────────────────────────────────────────────────────────────────

class TestFallback:
    def test_unknown_symptom_uses_generic(self):
        r = build_troubleshooting("xyzzy_frobnicator", ["d1"], "nxos")
        assert r["category"] == "General"
        assert len(r["diagnostic_steps"]) >= 3
        assert len(r["likely_causes"]) >= 2
        assert len(r["remediation"]) >= 2

    def test_empty_symptom_uses_generic(self):
        r = build_troubleshooting("", [], "nxos")
        assert r["category"] == "General"
        assert r["symptom"] == "unknown"


# ── Normalization & affected devices ────────────────────────────────────────

class TestNormalization:
    def test_symptom_case_and_separators_normalized(self):
        a = build_troubleshooting("BGP-DOWN", [], "nxos")
        b = build_troubleshooting("bgp down", [], "nxos")
        c = build_troubleshooting("bgp_down", [], "nxos")
        assert a["category"] == b["category"] == c["category"] == "BGP"

    def test_affected_devices_echoed_in_summary(self):
        r = build_troubleshooting("bgp_down", ["leaf1", "leaf2"], "nxos")
        assert "leaf1" in r["summary"]
        assert "leaf2" in r["summary"]

    def test_no_affected_devices_summary_clean(self):
        r = build_troubleshooting("bgp_down", [], "nxos")
        assert "Affected device" not in r["summary"]

    def test_none_affected_devices_does_not_crash(self):
        r = build_troubleshooting("bgp_down", None, "nxos")
        assert isinstance(r["diagnostic_steps"], list)


# ── Catalog sanity ──────────────────────────────────────────────────────────

class TestCatalog:
    def test_all_known_symptoms_present(self):
        for s in KNOWN_SYMPTOMS:
            assert s in PLAYBOOKS

    def test_generic_playbook_structure(self):
        for key in ("category", "summary", "steps", "causes", "remediation"):
            assert key in GENERIC_PLAYBOOK
