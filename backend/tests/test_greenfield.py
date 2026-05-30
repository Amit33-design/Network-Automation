"""
Tests for greenfield.py — the end-to-end greenfield deployment orchestrator.
Verifies inventory generation from a design, Jinja inventory rendering, day-0 /
day-N config bundles, deployment ordering, and the staged plan.
"""
import pytest

import greenfield as gf


@pytest.fixture
def dc_state():
    return {
        "uc": "dc",
        "orgName": "Acme",
        "redundancy": "ha",
        "spine_count": 2,
        "leaf_count": 4,
        "bgp_asn": 65001,
        "selectedProducts": {"dc-spine": "nexus-9332", "dc-leaf": "nexus-93180"},
        "protocols": ["BGP", "EVPN", "VXLAN"],
        "vlans": [{"id": 100, "name": "PROD"}],
    }


@pytest.fixture
def gpu_state():
    return {
        "uc": "gpu",
        "orgName": "GpuCo",
        "redundancy": "full",
        "spine_count": 2,
        "leaf_count": 4,
        "_detected_vendor": "NVIDIA",
        "selectedProducts": {"gpu-spine": "7800r3", "gpu-tor": "sn4600c"},
    }


# ── Inventory generation (gap #1 + #3) ────────────────────────────────────────

class TestBuildInventory:
    def test_inventory_has_a_host_per_management_ip(self, dc_state):
        inv = gf.build_inventory(dc_state)
        assert len(inv) >= 6  # 2 spine + 4 leaf
        for host in inv.values():
            assert host["hostname"]          # mgmt IP set as connection target
            assert host["platform"]
            assert host["username"].startswith("<CHANGE-ME")
            assert host["data"]["role"]

    def test_roles_inferred_from_device_names(self, dc_state):
        inv = gf.build_inventory(dc_state)
        roles = {h["data"]["role"] for h in inv.values()}
        assert "spine" in roles
        assert "leaf" in roles

    def test_spine_platform_is_nxos_for_cisco(self, dc_state):
        inv = gf.build_inventory(dc_state)
        spines = [h for h in inv.values() if h["data"]["role"] == "spine"]
        assert spines and all(h["platform"] == "cisco_nxos" for h in spines)

    def test_vendor_override_sets_eos(self):
        state = {
            "uc": "dc", "orgName": "X", "spine_count": 2, "leaf_count": 2,
            "_detected_vendor": "Arista",
        }
        inv = gf.build_inventory(state)
        assert all(h["platform"] == "arista_eos" for h in inv.values())
        assert all(h["data"]["ztp_platform"] == "eos" for h in inv.values())

    def test_gpu_tor_maps_to_sonic(self, gpu_state):
        inv = gf.build_inventory(gpu_state)
        tors = [h for h in inv.values() if h["data"]["role"] == "gpu_tor"]
        assert tors and all(h["data"]["ztp_platform"] == "sonic" for h in tors)

    def test_default_gateway_derived(self, dc_state):
        inv = gf.build_inventory(dc_state)
        any_host = next(iter(inv.values()))
        assert any_host["data"]["mgmt_gw"].endswith(".254")


# ── Deployment ordering ───────────────────────────────────────────────────────

class TestDeploymentOrder:
    def test_spines_pushed_before_leaves(self, dc_state):
        inv = gf.build_inventory(dc_state)
        order = gf.deployment_order(inv)
        spine_idx = [i for i, h in enumerate(order) if inv[h]["data"]["role"] == "spine"]
        leaf_idx = [i for i, h in enumerate(order) if inv[h]["data"]["role"] == "leaf"]
        assert max(spine_idx) < min(leaf_idx)


# ── Jinja inventory rendering (gap #3) ────────────────────────────────────────

class TestRenderInventoryFiles:
    def test_renders_three_artifacts(self, dc_state):
        files = gf.render_inventory_files(dc_state)
        assert set(files) == {"hosts.yml", "groups.yml", "ansible_hosts.ini"}

    def test_hosts_yml_is_valid_yaml_and_has_hosts(self, dc_state):
        import yaml
        files = gf.render_inventory_files(dc_state)
        data = yaml.safe_load(files["hosts.yml"])
        assert isinstance(data, dict)
        # every host has hostname (mgmt ip) + platform + groups
        for name, body in data.items():
            assert "hostname" in body and "platform" in body
            assert "groups" in body

    def test_ansible_ini_has_group_headers(self, dc_state):
        files = gf.render_inventory_files(dc_state)
        assert "[spine]" in files["ansible_hosts.ini"]
        assert "ansible_host=" in files["ansible_hosts.ini"]

    def test_no_real_credentials_leak(self, dc_state):
        files = gf.render_inventory_files(dc_state)
        assert "<CHANGE-ME" in files["hosts.yml"]


# ── Config bundles ────────────────────────────────────────────────────────────

class TestBundles:
    def test_bootstrap_bundle_one_per_device(self, dc_state):
        inv = gf.build_inventory(dc_state)
        bundle = gf.build_bootstrap_bundle(dc_state, inv)
        assert set(bundle) == set(inv)
        # day-0 must include hostname + management (reachability essentials)
        for name, cfg in bundle.items():
            assert name in cfg or "hostname" in cfg.lower()

    def test_production_bundle_renders_configs(self, dc_state):
        prod = gf.build_production_bundle(dc_state)
        assert len(prod) > 0
        assert any("router bgp" in c.lower() or "feature" in c.lower() for c in prod.values())


# ── Staged plan (gap #2) ──────────────────────────────────────────────────────

class TestPlanGreenfield:
    def test_plan_has_six_ordered_stages(self, dc_state):
        plan = gf.plan_greenfield(dc_state)
        ids = [s.id for s in plan.stages]
        assert ids == ["register", "bootstrap", "reachability", "pre_checks", "push", "post_checks"]

    def test_plan_serializes_to_dict(self, dc_state):
        plan = gf.plan_greenfield(dc_state)
        d = plan.to_dict()
        assert d["device_count"] == len(plan.inventory)
        assert d["stages"][0]["name"].startswith("1 ·")
        assert d["summary"]

    def test_plan_push_order_matches_deployment_order(self, dc_state):
        plan = gf.plan_greenfield(dc_state)
        assert plan.push_order == gf.deployment_order(plan.inventory)

    def test_plan_without_configs_is_cheap(self, dc_state):
        plan = gf.plan_greenfield(dc_state, include_configs=False)
        assert plan.bootstrap_configs == {}
        assert plan.production_configs == {}
        assert len(plan.stages) == 6


# ── Execution (degrades to simulation) ────────────────────────────────────────

class TestExecuteGreenfield:
    def test_execute_dry_run_returns_stages(self, dc_state):
        res = gf.execute_greenfield(dc_state, dry_run=True)
        assert res["dry_run"] is True
        assert res["device_count"] == len(gf.build_inventory(dc_state))
        # pipeline ran at least pre_checks (sim or real)
        assert res["stages"]
        assert res["stages"][0]["stage"] == "pre_checks"
