"""
Tests for change_update.py — Day-N incremental change engine (backend).
Mirrors frontend test/config-update.test.ts so API + UI stay in agreement.
"""
import pytest

from change_update import (
    cli_family, get_change_op, CHANGE_CATALOG, render,
    validate_change_params, build_change_set, analyze_change_set,
)


def test_cli_family():
    assert cli_family("Cisco") == "ios"
    assert cli_family("Arista") == "ios"
    assert cli_family("Juniper") == "junos"
    assert cli_family("Nokia") == "nokia"
    assert cli_family("Fortinet") == "fortios"
    assert cli_family("Palo Alto") == "panos"


def test_catalog_has_all_ops():
    ids = {op["id"] for op in CHANGE_CATALOG}
    assert {"bgp-neighbor", "bgp-route-policy", "firewall-rule", "vlan",
            "static-route", "mgmt-server", "interface-config"} <= ids
    for op in CHANGE_CATALOG:
        assert op["fields"] and op["families"]


def test_validate_required():
    missing = validate_change_params("bgp-neighbor", {"local_as": "65000"})
    assert "Neighbor IP" in missing and "Remote ASN" in missing
    assert "Local ASN" not in missing


# ── BGP neighbor ──────────────────────────────────────────────────────────────
def test_bgp_neighbor_ios():
    r = render("bgp-neighbor", "ios",
               {"local_as": "65000", "peer_ip": "10.0.0.2", "remote_as": "65010", "rmap_in": "RM-IN"})
    joined = "\n".join(r["commands"])
    assert "router bgp 65000" in joined
    assert "neighbor 10.0.0.2 remote-as 65010" in joined
    assert "route-map RM-IN in" in joined
    assert "no neighbor 10.0.0.2" in "\n".join(r["rollback"])


def test_bgp_neighbor_junos_nokia():
    j = render("bgp-neighbor", "junos", {"peer_ip": "10.0.0.2", "remote_as": "65010"})
    assert j["rollback"][0] == "delete protocols bgp group EXTERNAL neighbor 10.0.0.2"
    n = render("bgp-neighbor", "nokia", {"peer_ip": "10.0.0.2", "remote_as": "65010"})
    assert "network-instance default protocols bgp neighbor 10.0.0.2 peer-as 65010" in "\n".join(n["commands"])


# ── BGP route policy ─────────────────────────────────────────────────────────
def test_bgp_route_policy_ios():
    r = render("bgp-route-policy", "ios",
               {"name": "RM-CUST", "action": "permit", "prefix": "10.20.0.0/16", "local_pref": "200"})
    t = "\n".join(r["commands"])
    assert "ip prefix-list RM-CUST-PL seq 10 permit 10.20.0.0/16" in t
    assert "route-map RM-CUST permit 10" in t
    assert "set local-preference 200" in t
    assert r["rollback"] == ["no route-map RM-CUST", "no ip prefix-list RM-CUST-PL"]


def test_bgp_route_policy_deny_omits_localpref():
    r = render("bgp-route-policy", "ios",
               {"name": "RM-X", "action": "deny", "prefix": "10.0.0.0/8", "local_pref": "150"})
    t = "\n".join(r["commands"])
    assert "route-map RM-X deny 10" in t
    assert "set local-preference" not in t


# ── Firewall / ACL ───────────────────────────────────────────────────────────
def test_firewall_ios_and_ngfw():
    p = {"name": "ACL-IN", "action": "permit", "protocol": "tcp",
         "source": "10.1.0.0/24", "destination": "10.2.0.0/24", "port": "443"}
    ios = render("firewall-rule", "ios", p)
    assert ios["commands"][0] == "ip access-list extended ACL-IN"
    assert "eq 443" in ios["commands"][1]
    assert ios["rollback"][1].strip().startswith("no ")
    forti = render("firewall-rule", "fortios", p)
    assert "config firewall policy" in "\n".join(forti["commands"])
    assert "delete 100" in "\n".join(forti["rollback"])
    pan = render("firewall-rule", "panos", {**p, "action": "deny"})
    assert "set rulebase security rules ACL-IN" in "\n".join(pan["commands"])
    assert pan["rollback"][0] == "delete rulebase security rules ACL-IN"


# ── VLAN + static route ──────────────────────────────────────────────────────
def test_vlan_ios():
    r = render("vlan", "ios", {"vlan_id": "120", "name": "PCI", "svi_ip": "10.120.0.1/24"})
    t = "\n".join(r["commands"])
    assert "vlan 120" in t and "interface Vlan120" in t
    assert "no vlan 120" in r["rollback"] and "no interface Vlan120" in r["rollback"]


def test_static_route_junos_vrf():
    r = render("static-route", "junos", {"prefix": "10.50.0.0/24", "next_hop": "10.0.0.1", "vrf": "TENANT-A"})
    assert "routing-instances TENANT-A routing-options static route 10.50.0.0/24 next-hop 10.0.0.1" in r["commands"][0]


# ── Management server + interface config ─────────────────────────────────────
def test_mgmt_server():
    assert render("mgmt-server", "ios", {"service": "ntp", "server": "10.0.0.100"})["commands"][0] == "ntp server 10.0.0.100"
    assert render("mgmt-server", "ios", {"service": "syslog", "server": "10.0.0.100"})["commands"][0] == "logging host 10.0.0.100"
    j = render("mgmt-server", "junos", {"service": "ntp", "server": "10.0.0.100"})
    assert j["commands"][0] == "set system ntp server 10.0.0.100"
    assert j["rollback"][0] == "delete system ntp server 10.0.0.100"


def test_interface_config_rollback_inverts():
    r = render("interface-config", "ios",
               {"iface": "Gi1/0/1", "description": "uplink", "admin_state": "up", "access_vlan": "120"})
    cmds, rb = "\n".join(r["commands"]), "\n".join(r["rollback"])
    assert " no shutdown" in cmds and " switchport access vlan 120" in cmds
    assert " shutdown" in rb and " no description" in rb and " no switchport access vlan" in rb


# ── Change set + analysis ─────────────────────────────────────────────────────
def _devs():
    return [
        {"hostname": "SP-01", "vendor": "Cisco", "subLayer": "spine", "role": "spine"},
        {"hostname": "LF-01", "vendor": "Juniper", "subLayer": "leaf", "role": "leaf"},
        {"hostname": "AC-01", "vendor": "Cisco", "subLayer": "access", "role": "access"},
    ]


def test_build_change_set_scopes_by_role_and_family():
    cs = build_change_set("bgp-neighbor",
                          {"local_as": "65000", "peer_ip": "10.0.0.2", "remote_as": "65010"}, _devs())
    by_host = {d["hostname"]: d for d in cs["devices"]}
    assert by_host["SP-01"]["supported"] is True
    assert by_host["LF-01"]["supported"] is True
    assert by_host["AC-01"]["supported"] is False
    assert cs["summary"]["supported"] == 2
    assert cs["summary"]["byFamily"] == {"ios": 1, "junos": 1}


def test_build_change_set_merges_defaults():
    cs = build_change_set("bgp-neighbor", {"peer_ip": "10.0.0.5", "remote_as": "65020"},
                          [{"hostname": "SP-01", "vendor": "Cisco", "subLayer": "spine", "role": "spine"}])
    assert "router bgp <CHANGE-ME-local-asn>" in "\n".join(cs["devices"][0]["commands"])


def test_analyze_flags_skipped_and_placeholder():
    cs = build_change_set("bgp-neighbor", {"peer_ip": "10.0.0.2", "remote_as": "65010"}, _devs())
    w = analyze_change_set(cs, "bgp-neighbor", cs["params"])
    sev = {x["severity"] for x in w}
    assert "info" in sev          # AC-01 skipped
    assert "warn" in sev          # <CHANGE-ME-local-asn> placeholder


def test_analyze_fabric_shutdown_danger():
    cs = build_change_set("interface-config", {"iface": "Et1", "admin_state": "down"},
                          [{"hostname": "SP-01", "vendor": "Cisco", "subLayer": "spine", "role": "spine"}])
    w = analyze_change_set(cs, "interface-config", cs["params"])
    assert any(x["severity"] == "danger" and "isolate" in x["message"] for x in w)
