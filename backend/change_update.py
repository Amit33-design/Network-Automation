"""
change_update.py — Day-N incremental config change engine (backend)

Mirrors frontend/src/lib/config-update.ts so the API and the wizard agree on
how a parameterized Day-2 change (BGP policy, firewall/ACL rule, VLAN, static
route, mgmt server, interface config) becomes a vendor-correct INCREMENTAL
delta + matching ROLLBACK, scoped to selected live devices.

Generation only — like /api/drift/remediate, this returns reviewable commands;
it does not push to devices.

Public API:
    cli_family(vendor) -> str
    CHANGE_CATALOG (list of op metadata dicts)
    render(op_id, family, params) -> {"commands": [...], "rollback": [...]}
    build_change_set(op_id, params, devices) -> dict
    analyze_change_set(change_set, op_id, params) -> [ {severity, message, devices} ]
"""
from __future__ import annotations

from typing import Any, Callable

# ── CLI families ────────────────────────────────────────────────────────────

def cli_family(vendor: str) -> str:
    return {
        "Juniper": "junos",
        "Nokia": "nokia",
        "Fortinet": "fortios",
        "Palo Alto": "panos",
    }.get(vendor, "ios")  # Cisco/Arista/Dell/Extreme/HPE/NVIDIA → IOS-like


FAMILY_LABEL = {
    "ios": "Cisco/Arista IOS-style", "junos": "Juniper Junos",
    "nokia": "Nokia SR Linux", "fortios": "Fortinet FortiOS", "panos": "Palo Alto PAN-OS",
}

FABRIC_ROLES = ("spine", "leaf", "core", "super-spine", "border")


def _v(p: dict, k: str, dflt: str = "") -> str:
    return (str(p.get(k, "")).strip() or dflt)


# ── Renderers (per op) ───────────────────────────────────────────────────────

def _bgp_neighbor(fam: str, p: dict) -> dict:
    peer, ras = _v(p, "peer_ip"), _v(p, "remote_as")
    las = _v(p, "local_as", "<CHANGE-ME-local-asn>")
    desc, rin, rout = _v(p, "description"), _v(p, "rmap_in"), _v(p, "rmap_out")
    if fam == "ios":
        c = [f"router bgp {las}", f" neighbor {peer} remote-as {ras}"]
        if desc:
            c.append(f" neighbor {peer} description {desc}")
        c += [" address-family ipv4 unicast", f"  neighbor {peer} activate"]
        if rin:
            c.append(f"  neighbor {peer} route-map {rin} in")
        if rout:
            c.append(f"  neighbor {peer} route-map {rout} out")
        return {"commands": c, "rollback": [f"router bgp {las}", f" no neighbor {peer}"]}
    if fam == "junos":
        c = [f"set protocols bgp group EXTERNAL neighbor {peer} peer-as {ras}"]
        if desc:
            c.append(f'set protocols bgp group EXTERNAL neighbor {peer} description "{desc}"')
        if rin:
            c.append(f"set protocols bgp group EXTERNAL neighbor {peer} import {rin}")
        if rout:
            c.append(f"set protocols bgp group EXTERNAL neighbor {peer} export {rout}")
        return {"commands": c, "rollback": [f"delete protocols bgp group EXTERNAL neighbor {peer}"]}
    # nokia
    base = f"set / network-instance default protocols bgp neighbor {peer}"
    c = [f"{base} peer-as {ras}", f"{base} admin-state enable"]
    if rin:
        c.append(f"{base} afi-safi ipv4-unicast import-policy {rin}")
    if rout:
        c.append(f"{base} afi-safi ipv4-unicast export-policy {rout}")
    return {"commands": c, "rollback": [f"delete / network-instance default protocols bgp neighbor {peer}"]}


def _bgp_route_policy(fam: str, p: dict) -> dict:
    name, act = _v(p, "name"), _v(p, "action", "permit").lower()
    prefix, lp = _v(p, "prefix"), _v(p, "local_pref")
    pl = f"{name}-PL"
    if fam == "ios":
        c = [f"ip prefix-list {pl} seq 10 {act} {prefix}",
             f"route-map {name} {act} 10",
             f" match ip address prefix-list {pl}"]
        if act == "permit" and lp:
            c.append(f" set local-preference {lp}")
        return {"commands": c, "rollback": [f"no route-map {name}", f"no ip prefix-list {pl}"]}
    if fam == "junos":
        jact = "reject" if act == "deny" else "accept"
        c = [f"set policy-options prefix-list {pl} {prefix}",
             f"set policy-options policy-statement {name} term 10 from prefix-list {pl}"]
        if jact == "accept" and lp:
            c.append(f"set policy-options policy-statement {name} term 10 then local-preference {lp}")
        c.append(f"set policy-options policy-statement {name} term 10 then {jact}")
        return {"commands": c, "rollback": [f"delete policy-options policy-statement {name}",
                                            f"delete policy-options prefix-list {pl}"]}
    # nokia
    res = "reject" if act == "deny" else "accept"
    c = [f"set / routing-policy prefix-set {pl} prefix {prefix} mask-length-range exact",
         f"set / routing-policy policy {name} statement 10 match prefix-set {pl}",
         f"set / routing-policy policy {name} statement 10 action policy-result {res}"]
    if act == "permit" and lp:
        c.append(f"set / routing-policy policy {name} statement 10 action bgp local-preference set {lp}")
    return {"commands": c, "rollback": [f"delete / routing-policy policy {name}",
                                        f"delete / routing-policy prefix-set {pl}"]}


def _wildcard_mask(plen: int) -> str:
    bits = 32 - (plen if 0 <= plen <= 32 else 32)
    host = 0xffffffff if bits >= 32 else (2 ** bits) - 1
    return ".".join(str((host >> s) & 0xff) for s in (24, 16, 8, 0))


def _ios_wild(addr: str) -> str:
    a = addr.strip()
    if a in ("any", "0.0.0.0/0"):
        return "any"
    if "/" in a:
        net, plen = a.split("/", 1)
        if plen == "32":
            return f"host {net}"
        try:
            return f"{net} {_wildcard_mask(int(plen))}"
        except ValueError:
            return f"host {net}"
    return f"host {a}"


def _firewall_rule(fam: str, p: dict) -> dict:
    name, act = _v(p, "name"), _v(p, "action", "permit").lower()
    proto, src, dst, port = _v(p, "protocol", "tcp"), _v(p, "source"), _v(p, "destination"), _v(p, "port")
    if fam == "ios":
        ace = f"{act} {proto} {_ios_wild(src)} {_ios_wild(dst)}" + (f" eq {port}" if port else "")
        return {"commands": [f"ip access-list extended {name}", f" {ace}"],
                "rollback": [f"ip access-list extended {name}", f" no {ace}"]}
    if fam == "junos":
        term = "T-" + ("".join(ch for ch in (src + dst) if ch.isdigit())[:6] or "10")
        jact = "discard" if act == "deny" else "accept"
        f = f"firewall family inet filter {name} term {term}"
        c = [f"set {f} from source-address {src}", f"set {f} from destination-address {dst}",
             f"set {f} from protocol {proto}"]
        if port:
            c.append(f"set {f} from destination-port {port}")
        c.append(f"set {f} then {jact}")
        return {"commands": c, "rollback": [f"delete firewall family inet filter {name} term {term}"]}
    if fam == "fortios":
        c = ["config firewall policy", "  edit 100", f'    set name "{name}"',
             f'    set srcaddr "{src}"', f'    set dstaddr "{dst}"',
             f"    set action {'deny' if act == 'deny' else 'accept'}",
             f'    set service "{proto.upper()}{("-" + port) if port else ""}"',
             '    set schedule "always"', "  next", "end"]
        return {"commands": c, "rollback": ["config firewall policy", "  delete 100", "end"]}
    # panos
    svc = "any" if proto == "ip" else f"service-{proto}{('-' + port) if port else ''}"
    c = [f"set rulebase security rules {name} from any to any",
         f"set rulebase security rules {name} source {src} destination {dst}",
         f"set rulebase security rules {name} application any service {svc}",
         f"set rulebase security rules {name} action {'deny' if act == 'deny' else 'allow'}"]
    return {"commands": c, "rollback": [f"delete rulebase security rules {name}"]}


def _vlan(fam: str, p: dict) -> dict:
    vid, name, svi = _v(p, "vlan_id"), _v(p, "name"), _v(p, "svi_ip")
    if fam == "ios":
        c, rb = [f"vlan {vid}", f" name {name}"], [f"no vlan {vid}"]
        if svi:
            ip = svi.split("/")[0]
            mask = svi.split("/")[1] if "/" in svi else ""
            c += [f"interface Vlan{vid}", f" ip address {ip}{(' /' + mask) if mask else ''}", " no shutdown"]
            rb.insert(0, f"no interface Vlan{vid}")
        return {"commands": c, "rollback": rb}
    # junos
    c, rb = [f"set vlans {name} vlan-id {vid}"], [f"delete vlans {name}"]
    if svi:
        c += [f"set vlans {name} l3-interface irb.{vid}",
              f"set interfaces irb unit {vid} family inet address {svi}"]
        rb.insert(0, f"delete interfaces irb unit {vid}")
    return {"commands": c, "rollback": rb}


def _static_route(fam: str, p: dict) -> dict:
    prefix, nh, vrf = _v(p, "prefix"), _v(p, "next_hop"), _v(p, "vrf")
    if fam == "ios":
        net = prefix.split("/")[0]
        mask = prefix.split("/")[1] if "/" in prefix else ""
        vrf_part = f"vrf {vrf} " if vrf else ""
        cmd = " ".join(f"ip route {vrf_part}{net} {('/' + mask) if mask else ''} {nh}".split())
        return {"commands": [cmd], "rollback": [f"no {cmd}"]}
    if fam == "junos":
        ri = f"routing-instances {vrf} routing-options" if vrf else "routing-options"
        return {"commands": [f"set {ri} static route {prefix} next-hop {nh}"],
                "rollback": [f"delete {ri} static route {prefix}"]}
    # nokia
    ni = vrf or "default"
    nhg = "nh-" + nh.replace(".", "-")
    return {"commands": [f"set / network-instance {ni} static-routes route {prefix} next-hop-group {nhg}",
                         f"set / network-instance {ni} next-hop-groups group {nhg} nexthop 1 ip-address {nh}"],
            "rollback": [f"delete / network-instance {ni} static-routes route {prefix}"]}


def _mgmt_server(fam: str, p: dict) -> dict:
    svc, ip = _v(p, "service", "ntp").lower(), _v(p, "server")
    if fam == "ios":
        cmd = (f"logging host {ip}" if svc == "syslog"
               else f"snmp-server host {ip} version 3 priv <CHANGE-ME-snmp-user>" if svc == "snmp"
               else f"ntp server {ip}")
        return {"commands": [cmd], "rollback": [f"no {cmd}"]}
    if fam == "junos":
        cmd = (f"system syslog host {ip} any info" if svc == "syslog"
               else f"snmp trap-group NMS targets {ip}" if svc == "snmp"
               else f"system ntp server {ip}")
        return {"commands": [f"set {cmd}"], "rollback": [f"delete {cmd}"]}
    # nokia
    cmd = (f"/ system logging remote-server {ip}" if svc == "syslog"
           else f"/ system snmp trap-group NMS target {ip}" if svc == "snmp"
           else f"/ system ntp server {ip}")
    return {"commands": [f"set {cmd}"], "rollback": [f"delete {cmd}"]}


def _interface_config(fam: str, p: dict) -> dict:
    iface, desc = _v(p, "iface"), _v(p, "description")
    up = _v(p, "admin_state", "up").lower() != "down"
    vlan = _v(p, "access_vlan")
    if fam == "ios":
        c = [f"interface {iface}"]
        if desc:
            c.append(f" description {desc}")
        c.append(" no shutdown" if up else " shutdown")
        if vlan:
            c.append(f" switchport access vlan {vlan}")
        rb = [f"interface {iface}"]
        if desc:
            rb.append(" no description")
        rb.append(" shutdown" if up else " no shutdown")
        if vlan:
            rb.append(" no switchport access vlan")
        return {"commands": c, "rollback": rb}
    # junos
    c, rb = [], []
    if desc:
        c.append(f'set interfaces {iface} description "{desc}"')
    c.append(f"delete interfaces {iface} disable" if up else f"set interfaces {iface} disable")
    if vlan:
        c.append(f"set interfaces {iface} unit 0 family ethernet-switching vlan members {vlan}")
    if desc:
        rb.append(f"delete interfaces {iface} description")
    rb.append(f"set interfaces {iface} disable" if up else f"delete interfaces {iface} disable")
    if vlan:
        rb.append(f"delete interfaces {iface} unit 0 family ethernet-switching vlan members {vlan}")
    return {"commands": c, "rollback": rb}


# ── Catalog (metadata + renderer) ────────────────────────────────────────────

_RENDERERS: dict[str, Callable[[str, dict], dict]] = {
    "bgp-neighbor": _bgp_neighbor,
    "bgp-route-policy": _bgp_route_policy,
    "firewall-rule": _firewall_rule,
    "vlan": _vlan,
    "static-route": _static_route,
    "mgmt-server": _mgmt_server,
    "interface-config": _interface_config,
}

CHANGE_CATALOG: list[dict[str, Any]] = [
    {"id": "bgp-neighbor", "label": "BGP neighbor", "category": "Routing",
     "appliesTo": ["spine", "leaf", "core", "wan-edge", "border", "distribution"],
     "families": ["ios", "junos", "nokia"],
     "fields": [
         {"key": "local_as", "label": "Local ASN", "default": "<CHANGE-ME-local-asn>", "required": True},
         {"key": "peer_ip", "label": "Neighbor IP", "required": True},
         {"key": "remote_as", "label": "Remote ASN", "required": True},
         {"key": "description", "label": "Description"},
         {"key": "rmap_in", "label": "Inbound policy"},
         {"key": "rmap_out", "label": "Outbound policy"},
     ]},
    {"id": "bgp-route-policy", "label": "BGP route policy", "category": "Routing",
     "appliesTo": ["spine", "leaf", "core", "wan-edge", "border"],
     "families": ["ios", "junos", "nokia"],
     "fields": [
         {"key": "name", "label": "Policy name", "required": True},
         {"key": "action", "label": "Action (permit/deny)", "default": "permit", "required": True},
         {"key": "prefix", "label": "Prefix", "required": True},
         {"key": "local_pref", "label": "Set local-pref (optional)"},
     ]},
    {"id": "firewall-rule", "label": "Firewall / ACL rule", "category": "Security",
     "appliesTo": ["*"], "families": ["ios", "junos", "fortios", "panos"],
     "fields": [
         {"key": "name", "label": "ACL / policy name", "required": True},
         {"key": "action", "label": "Action (permit/deny)", "default": "permit", "required": True},
         {"key": "protocol", "label": "Protocol", "default": "tcp"},
         {"key": "source", "label": "Source", "required": True},
         {"key": "destination", "label": "Destination", "required": True},
         {"key": "port", "label": "Dest port (optional)"},
     ]},
    {"id": "vlan", "label": "VLAN", "category": "L2",
     "appliesTo": ["leaf", "access", "distribution", "core"], "families": ["ios", "junos"],
     "fields": [
         {"key": "vlan_id", "label": "VLAN ID", "required": True},
         {"key": "name", "label": "VLAN name", "required": True},
         {"key": "svi_ip", "label": "SVI gateway (optional)"},
     ]},
    {"id": "static-route", "label": "Static route", "category": "Routing",
     "appliesTo": ["*"], "families": ["ios", "junos", "nokia"],
     "fields": [
         {"key": "prefix", "label": "Prefix", "required": True},
         {"key": "next_hop", "label": "Next hop", "required": True},
         {"key": "vrf", "label": "VRF (optional)"},
     ]},
    {"id": "mgmt-server", "label": "Management server (NTP/Syslog/SNMP)", "category": "Management",
     "appliesTo": ["*"], "families": ["ios", "junos", "nokia"],
     "fields": [
         {"key": "service", "label": "Service (ntp/syslog/snmp)", "default": "ntp", "required": True},
         {"key": "server", "label": "Server IP", "required": True},
     ]},
    {"id": "interface-config", "label": "Interface config", "category": "L2",
     "appliesTo": ["*"], "families": ["ios", "junos"],
     "fields": [
         {"key": "iface", "label": "Interface", "required": True},
         {"key": "description", "label": "Description"},
         {"key": "admin_state", "label": "Admin state (up/down)", "default": "up", "required": True},
         {"key": "access_vlan", "label": "Access VLAN (optional)"},
     ]},
]

_CATALOG_BY_ID = {op["id"]: op for op in CHANGE_CATALOG}


def get_change_op(op_id: str) -> dict | None:
    return _CATALOG_BY_ID.get(op_id)


def render(op_id: str, family: str, params: dict) -> dict:
    fn = _RENDERERS.get(op_id)
    if not fn:
        raise ValueError(f"unknown change op: {op_id}")
    return fn(family, params)


def validate_change_params(op_id: str, params: dict) -> list[str]:
    op = get_change_op(op_id)
    if not op:
        return [f"unknown op {op_id}"]
    missing = []
    for f in op["fields"]:
        if f.get("required") and not str(params.get(f["key"], f.get("default", "")) or "").strip():
            missing.append(f["label"])
    return missing


def _role_applies(op: dict, dev: dict) -> bool:
    if "*" in op["appliesTo"]:
        return True
    l = str(dev.get("subLayer", "")).lower()
    r = str(dev.get("role", "")).lower()
    return any(x in l or x in r for x in op["appliesTo"])


def build_change_set(op_id: str, params: dict, devices: list[dict]) -> dict:
    op = get_change_op(op_id)
    if not op:
        raise ValueError(f"unknown change op: {op_id}")
    merged = {f["key"]: f.get("default", "") for f in op["fields"]}
    merged.update({k: v for k, v in params.items() if v is not None})

    by_family: dict[str, int] = {}
    entries = []
    for dev in devices:
        vendor = dev.get("vendor", "Cisco")
        family = cli_family(vendor)
        supported = _role_applies(op, dev) and family in op["families"]
        if supported:
            by_family[family] = by_family.get(family, 0) + 1
            r = render(op_id, family, merged)
        else:
            r = {"commands": [
                f"! {op['label']} not applicable to {dev.get('hostname', '?')} "
                f"({family}/{dev.get('subLayer', '?')}) — review manually"], "rollback": []}
        entries.append({
            "hostname": dev.get("hostname", "?"), "vendor": vendor, "family": family,
            "supported": supported, "commands": r["commands"], "rollback": r["rollback"],
            "subLayer": dev.get("subLayer", ""), "role": dev.get("role", ""),
        })

    return {
        "op_id": op_id, "params": merged, "devices": entries,
        "summary": {
            "total": len(entries),
            "supported": sum(1 for e in entries if e["supported"]),
            "byFamily": by_family,
        },
    }


def analyze_change_set(change_set: dict, op_id: str, params: dict) -> list[dict]:
    """Pre-flight safety warnings — mirrors frontend analyzeChangeSet."""
    warnings: list[dict] = []
    devs = change_set["devices"]
    supported = [d for d in devs if d["supported"]]

    skipped = [d["hostname"] for d in devs if not d["supported"]]
    if skipped:
        op = get_change_op(op_id)
        label = op["label"] if op else op_id
        warnings.append({"severity": "info",
                         "message": f"{len(skipped)} selected device(s) will be skipped — "
                                    f"{label} doesn't apply to their role/vendor.",
                         "devices": skipped})

    placeholders = [d["hostname"] for d in supported
                    if any("<CHANGE-ME" in c for c in d["commands"])]
    if placeholders:
        warnings.append({"severity": "warn",
                         "message": "Generated commands still contain <CHANGE-ME-*> placeholders "
                                    "— fill every parameter before deploying.",
                         "devices": placeholders})

    no_rb = [d["hostname"] for d in supported if not d["rollback"]]
    if no_rb:
        warnings.append({"severity": "danger",
                         "message": f"{len(no_rb)} device(s) have no generated rollback — "
                                    "this change cannot be auto-reverted.",
                         "devices": no_rb})

    if op_id == "interface-config" and str(params.get("admin_state", "")).lower() == "down":
        fabric = [d["hostname"] for d in supported
                  if any(r in str(d.get("subLayer", "")).lower() for r in FABRIC_ROLES)]
        if fabric:
            warnings.append({"severity": "danger",
                             "message": f"Admin-down on a fabric interface ({params.get('iface', '')}) "
                                        "can isolate a spine/leaf/core device — verify it's not an active uplink.",
                             "devices": fabric})

    def _is_any(a: str) -> bool:
        a = str(a or "").strip().lower()
        return a in ("any", "0.0.0.0/0", "")

    if (op_id == "firewall-rule" and str(params.get("action", "")).lower() == "deny"
            and _is_any(params.get("source")) and _is_any(params.get("destination"))):
        warnings.append({"severity": "danger",
                         "message": 'Broad "deny any → any" rule — confirm it won\'t lock out '
                                    "management/SSH access.",
                         "devices": [d["hostname"] for d in supported]})

    return warnings
