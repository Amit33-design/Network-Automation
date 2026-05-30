"""
NetDesign AI — Greenfield Deployment Orchestrator
==================================================
Ties the existing building blocks (design → Jinja config-gen → ZTP day-0 →
Nornir push/verify → rollback) into a single end-to-end greenfield bring-up
pipeline, and fills the three gaps that previously required manual work:

  1. Inventory generation FROM a design  (no more hand-written hosts.yml)
  2. A unified, staged greenfield workflow plan
  3. Day-0 (bootstrap) + Day-N (production) config bundles keyed to the inventory

Public API
----------
  build_inventory(state)                  -> dict[hostname, host_dict]   (Nornir SimpleInventory shape)
  render_inventory_files(state)           -> {"hosts.yml": str, "groups.yml": str, "ansible_hosts.ini": str}
  build_bootstrap_bundle(state, inv)      -> dict[hostname, day0_config]
  build_production_bundle(state)          -> dict[hostname, dayN_config]
  deployment_order(inv)                   -> list[hostname]  (spine→leaf→access→edge→fw)
  plan_greenfield(state)                  -> GreenfieldPlan  (.to_dict() for JSON)
  execute_greenfield(state, dry_run=True) -> dict            (runs pre→push→post via nornir_tasks)

All functions are pure/deterministic except execute_greenfield(), which calls
the existing nornir_tasks (those degrade to simulation when Nornir/devices are
unavailable). Credentials are emitted as <CHANGE-ME-*> placeholders.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader

log = logging.getLogger("netdesign.greenfield")

TEMPLATE_DIR = Path(__file__).parent / "templates"
ZTP_TEMPLATE_DIR = Path(__file__).parent / "ztp" / "templates"

DEFAULT_USER = "<CHANGE-ME-USER>"
DEFAULT_PASS = "<CHANGE-ME-PASS>"


# ─────────────────────────────────────────────────────────────────────────────
# Role / platform inference
# ─────────────────────────────────────────────────────────────────────────────

# Ordered most-specific first so "GPU-SPINE" matches before "SPINE".
_ROLE_PATTERNS: list[tuple[tuple[str, ...], str]] = [
    (("GPU-SPINE",),                       "gpu_spine"),
    (("GPU-TOR", "GPU-LEAF"),              "gpu_tor"),
    (("SPINE",),                           "spine"),
    (("LEAF", "PROD", "STOR", "DEV", "TOR"), "leaf"),
    (("CORE",),                            "core"),
    (("DIST",),                            "distribution"),
    (("ACCESS", "ACC"),                    "access"),
    (("WAN", "HUB", "EDGE"),               "wan_edge"),
    (("BORDER",),                          "border"),
    (("FW", "FIREWALL"),                   "firewall"),
]

# role → tier rank for deployment ordering (lower pushes first)
_ROLE_TIER: dict[str, int] = {
    "spine": 0, "gpu_spine": 0, "core": 0,
    "leaf": 1, "gpu_tor": 1, "distribution": 1,
    "access": 2,
    "wan_edge": 3, "border": 3,
    "firewall": 4,
    "unknown": 5,
}

# role → config_gen layer key (LAYER_PLATFORM_MAP)
_ROLE_TO_LAYER: dict[str, str] = {
    "spine": "dc-spine", "leaf": "dc-leaf",
    "gpu_spine": "gpu-spine", "gpu_tor": "gpu-tor",
    "core": "campus-core", "distribution": "campus-dist", "access": "campus-access",
    "wan_edge": "wan-hub", "border": "wan-hub", "firewall": "firewall",
}


def _role_from_name(name: str) -> str:
    up = name.upper()
    for needles, role in _ROLE_PATTERNS:
        if any(n in up for n in needles):
            return role
    return "unknown"


def _detected_vendor(state: dict[str, Any]) -> str:
    v = state.get("_detected_vendor") or ""
    if not v:
        prefs = state.get("vendorPrefs") or state.get("preferredVendors") or []
        if prefs:
            v = prefs[0]
    return str(v)


def _platforms_for(role: str, vendor: str) -> tuple[str, str, str]:
    """Return (nornir_platform, ztp_platform_dir, ansible_network_os) for a role+vendor."""
    v = vendor.lower()

    # Explicit vendor wins for fabric roles
    if "arista" in v:
        return "arista_eos", "eos", "arista.eos.eos"
    if "juniper" in v:
        return "juniper_junos", "junos", "junipernetworks.junos.junos"
    if "nvidia" in v or "sonic" in v or "cumulus" in v:
        return "linux", "sonic", "community.network.sonic"

    # Role-based defaults (Cisco)
    if role in ("spine", "leaf"):
        return "cisco_nxos", "nxos", "cisco.nxos.nxos"
    if role == "gpu_spine":
        return "arista_eos", "eos", "arista.eos.eos"
    if role == "gpu_tor":
        return "linux", "sonic", "community.network.sonic"
    # campus / wan / firewall default to IOS-XE
    return "cisco_ios", "ios_xe", "cisco.ios.ios"


def _gateway_for(mgmt_ip: str) -> str:
    """Derive a sane default gateway (.254 of the /24) from a mgmt IP."""
    parts = mgmt_ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3] + ["254"])
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# Inventory generation (gap #1 + #3)
# ─────────────────────────────────────────────────────────────────────────────

def build_inventory(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """
    Build a Nornir SimpleInventory-shaped dict from a design state.

    Sources management IPs + device names from design_engine.generate_ip_plan().
    Returns { hostname: { hostname(=mgmt_ip), platform, username, password, port,
                          groups, data{role, layer, ztp_platform, ...} } }.
    """
    from design_engine import generate_ip_plan

    ip_plan = generate_ip_plan(state)
    mgmt = ip_plan.get("management", []) or []
    loopbacks = {lb["device"]: lb["ip"].split("/")[0]
                 for lb in ip_plan.get("loopbacks", [])
                 if "router" in str(lb.get("purpose", "")).lower() or "id" in str(lb.get("purpose", "")).lower()}

    vendor = _detected_vendor(state)
    bgp_asn = int(state.get("bgp_asn") or 65000)
    inv: dict[str, dict[str, Any]] = {}

    for entry in mgmt:
        name = entry["device"]
        mgmt_ip = entry["ip"]
        role = _role_from_name(name)
        nornir_pf, ztp_pf, ansible_os = _platforms_for(role, vendor)
        inv[name] = {
            "hostname": mgmt_ip,                 # Nornir connection target
            "platform": nornir_pf,
            "username": DEFAULT_USER,
            "password": DEFAULT_PASS,
            "port": 22,
            "groups": [_group_for(role)],
            "data": {
                "role": role,
                "layer": _ROLE_TO_LAYER.get(role, "ios_xe"),
                "ztp_platform": ztp_pf,
                "ansible_network_os": ansible_os,
                "mgmt_ip": mgmt_ip,
                "mgmt_mask": entry.get("mask", "255.255.255.0"),
                "mgmt_gw": _gateway_for(mgmt_ip),
                "loopback_ip": loopbacks.get(name, mgmt_ip),
                "bgp_asn": bgp_asn,
                "serial": "",
            },
        }
    return inv


def _group_for(role: str) -> str:
    return {
        "spine": "spine", "leaf": "leaf", "gpu_spine": "gpu_spine", "gpu_tor": "gpu_tor",
        "core": "core", "distribution": "distribution", "access": "access",
        "wan_edge": "wan_edge", "border": "border", "firewall": "firewall",
    }.get(role, "ungrouped")


def deployment_order(inventory: dict[str, dict[str, Any]]) -> list[str]:
    """Order hostnames for safe push: fabric/core → leaf/dist → access → edge → firewall."""
    return sorted(
        inventory.keys(),
        key=lambda h: (_ROLE_TIER.get(inventory[h]["data"]["role"], 5), h),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Jinja inventory rendering (gap #3)
# ─────────────────────────────────────────────────────────────────────────────

def _inv_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR / "inventory")),
        trim_blocks=True,
        lstrip_blocks=True,
    )


def render_inventory_files(state: dict[str, Any],
                           inventory: dict[str, dict[str, Any]] | None = None) -> dict[str, str]:
    """Render hosts.yml (Nornir), groups.yml, and ansible_hosts.ini from the design."""
    inv = inventory if inventory is not None else build_inventory(state)
    env = _inv_env()

    hosts = []
    seen_groups: dict[str, dict[str, Any]] = {}
    for name in deployment_order(inv):
        h = inv[name]
        d = h["data"]
        row = {
            "name": name,
            "mgmt_ip": d["mgmt_ip"],
            "platform": h["platform"],
            "ansible_os": d["ansible_network_os"],
            "role": d["role"],
            "layer": d["layer"],
            "ztp_platform": d["ztp_platform"],
            "loopback_ip": d["loopback_ip"],
            "mgmt_gw": d["mgmt_gw"],
            "serial": d.get("serial", ""),
            "group": h["groups"][0],
        }
        hosts.append(row)
        grp = row["group"]
        if grp not in seen_groups:
            seen_groups[grp] = {
                "name": grp, "platform": row["platform"],
                "role": row["role"], "tier": _ROLE_TIER.get(row["role"], 5),
            }

    ctx = {
        "org": state.get("orgName", "MyOrg"),
        "use_case": state.get("uc", state.get("useCase", "dc")),
        "hosts": hosts,
        "groups": list(seen_groups.values()),
        "username": DEFAULT_USER,
        "password": DEFAULT_PASS,
    }
    return {
        "hosts.yml": env.get_template("hosts.yml.j2").render(**ctx),
        "groups.yml": env.get_template("groups.yml.j2").render(**ctx),
        "ansible_hosts.ini": env.get_template("ansible_hosts.ini.j2").render(**ctx),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Config bundles
# ─────────────────────────────────────────────────────────────────────────────

def build_bootstrap_bundle(state: dict[str, Any],
                           inventory: dict[str, dict[str, Any]] | None = None) -> dict[str, str]:
    """Render the Day-0 bootstrap (mgmt IP, SSH, NTP — enough for Netmiko reachability)
    for every device, keyed by hostname. Uses the ZTP day0 Jinja templates."""
    inv = inventory if inventory is not None else build_inventory(state)
    bundle: dict[str, str] = {}
    envs: dict[str, Environment] = {}

    for name, h in inv.items():
        d = h["data"]
        ztp_pf = d["ztp_platform"]
        tpl_dir = ZTP_TEMPLATE_DIR / ztp_pf
        if not (tpl_dir / "day0.j2").exists():
            bundle[name] = _generic_day0(name, d)
            continue
        if ztp_pf not in envs:
            envs[ztp_pf] = Environment(
                loader=FileSystemLoader(str(tpl_dir)), trim_blocks=True, lstrip_blocks=True,
            )
        ctx = {
            "hostname": name,
            "serial": d.get("serial") or f"SN-{name}",
            "platform": ztp_pf,
            "role": d["role"],
            "mgmt_ip": d["mgmt_ip"],
            "mgmt_mask": d["mgmt_mask"],
            "mgmt_gw": d["mgmt_gw"],
            "loopback_ip": d["loopback_ip"],
            "bgp_asn": d["bgp_asn"],
            "vlans": state.get("vlans", []),
        }
        try:
            bundle[name] = envs[ztp_pf].get_template("day0.j2").render(**ctx)
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("greenfield day0 render failed for %s: %s", name, exc)
            bundle[name] = _generic_day0(name, d)
    return bundle


def _generic_day0(name: str, d: dict[str, Any]) -> str:
    return (
        f"! NetDesign AI — generic Day-0 bootstrap\n"
        f"hostname {name}\n"
        f"! management\n"
        f"interface mgmt0\n  ip address {d['mgmt_ip']} {d['mgmt_mask']}\n  no shutdown\n"
        f"ip route 0.0.0.0 0.0.0.0 {d['mgmt_gw']}\n"
        f"! ssh\nip ssh version 2\nusername {DEFAULT_USER} privilege 15 secret <CHANGE-ME-PASS>\n"
        f"! ntp\nntp server 10.100.0.1\n"
    )


def build_production_bundle(state: dict[str, Any]) -> dict[str, str]:
    """Render the full Day-N production config for all devices via config_gen."""
    try:
        from config_gen import generate_all_configs
        return generate_all_configs(state)
    except Exception as exc:
        log.warning("greenfield production bundle failed: %s", exc)
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Staged plan (gap #2)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class GreenfieldStage:
    id: str
    name: str
    description: str
    devices: list[str]
    actions: list[str]
    task: str                 # "ztp" | "gate" | nornir task name
    success_criteria: str
    on_failure: str
    estimated_minutes: int


@dataclass
class GreenfieldPlan:
    org: str
    use_case: str
    device_count: int
    push_order: list[str]
    inventory: dict[str, dict[str, Any]]
    stages: list[GreenfieldStage]
    bootstrap_configs: dict[str, str] = field(default_factory=dict)
    production_configs: dict[str, str] = field(default_factory=dict)
    summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d


def plan_greenfield(state: dict[str, Any], include_configs: bool = True) -> GreenfieldPlan:
    """Produce the full staged greenfield bring-up plan from a design state."""
    inv = build_inventory(state)
    order = deployment_order(inv)
    bootstrap = build_bootstrap_bundle(state, inv) if include_configs else {}
    production = build_production_bundle(state) if include_configs else {}
    org = state.get("orgName", "MyOrg")
    uc = state.get("uc", state.get("useCase", "dc"))
    n = len(inv)

    stages = [
        GreenfieldStage(
            id="register", name="1 · Register & DHCP",
            description="Pre-register every device serial→hostname→mgmt-IP with the ZTP "
                        "server and emit the DHCP option-66/67 + bootfile map.",
            devices=order, actions=[
                "POST /ztp/register/bulk  (serial, hostname, platform, role, mgmt_ip)",
                "Generate ISC dhcpd.conf via ztp.dhcp_gen.generate_dhcp_config()",
                "Stage day-0 bootstrap configs on the ZTP/TFTP server",
            ],
            task="ztp", success_criteria="All devices in WAITING state; DHCP scope live.",
            on_failure="Abort — fix registry/DHCP before powering devices.",
            estimated_minutes=15,
        ),
        GreenfieldStage(
            id="bootstrap", name="2 · Day-0 Bootstrap (ZTP/POAP)",
            description="Power on devices. POAP/ZTP/PnP fetches the per-serial day-0 "
                        "config (mgmt IP, SSH, NTP) and the device checks in.",
            devices=order, actions=[
                "Device boots → DHCP → fetches GET /ztp/bootstrap/{serial}",
                "Applies day-0 (mgmt reachable via SSH for Netmiko)",
                "POST /ztp/checkin/{serial} → state PROVISIONED",
            ],
            task="ztp", success_criteria="All devices reach PROVISIONED (day-0 applied).",
            on_failure="Re-serve bootstrap; check DHCP next-server/bootfile.",
            estimated_minutes=20,
        ),
        GreenfieldStage(
            id="reachability", name="3 · Reachability Gate",
            description="Confirm management-plane reachability (TCP/22) for every device "
                        "before any production push.",
            devices=order, actions=["nornir_tasks._icmp_reachable() probe on mgmt IPs"],
            task="gate", success_criteria="100% of devices answer on mgmt SSH.",
            on_failure="Hold — do not push until all devices are reachable.",
            estimated_minutes=5,
        ),
        GreenfieldStage(
            id="pre_checks", name="4 · Pre-checks + Backup",
            description="Capture show version and a MANDATORY running-config backup "
                        "(rollback point) before changing anything.",
            devices=order, actions=[
                "run_pre_checks(state, inventory, deployment_id)",
                "Backup running-config → BACKUP_DIR/{deployment_id}/{host}.cfg",
            ],
            task="run_pre_checks", success_criteria="Backup captured for every device.",
            on_failure="Abort — never push without a rollback point.",
            estimated_minutes=10,
        ),
        GreenfieldStage(
            id="push", name="5 · Day-N Production Push",
            description="Push the full production config in tier order "
                        "(spine/core → leaf/dist → access → edge → firewall).",
            devices=order, actions=[
                "deploy_configs(production_configs, inventory, dry_run=False)",
                "Platform-native commit (NX-OS checkpoint / EOS session / Junos commit confirmed)",
            ],
            task="deploy_configs",
            success_criteria="All configs applied; no push errors.",
            on_failure="Auto-rollback: restore per-device backup, halt pipeline.",
            estimated_minutes=max(10, n * 2),
        ),
        GreenfieldStage(
            id="post_checks", name="6 · Post-checks & Validate",
            description="Verify BGP/EVPN/underlay adjacency, LLDP fabric wiring, "
                        "interface errors, and (GPU) ECN/PFC/MTU-9000.",
            devices=order, actions=["run_post_checks(state, inventory)"],
            task="run_post_checks",
            success_criteria="All protocol/fabric checks PASS.",
            on_failure="Auto-rollback if dry_run=False; open an incident otherwise.",
            estimated_minutes=15,
        ),
    ]

    plan = GreenfieldPlan(
        org=org, use_case=uc, device_count=n, push_order=order,
        inventory=inv, stages=stages,
        bootstrap_configs=bootstrap, production_configs=production,
    )
    total = sum(s.estimated_minutes for s in stages)
    plan.summary = (
        f"Greenfield bring-up for {org} ({uc}): {n} device(s) across "
        f"{len({inv[h]['groups'][0] for h in inv})} group(s). "
        f"{len(stages)} stages, ~{total} min end-to-end. "
        f"Push order: {' → '.join(order[:6])}{'…' if n > 6 else ''}."
    )
    return plan


# ─────────────────────────────────────────────────────────────────────────────
# Execution (wires the existing nornir_tasks pipeline)
# ─────────────────────────────────────────────────────────────────────────────

def execute_greenfield(state: dict[str, Any], dry_run: bool = True,
                       deployment_id: str = "greenfield") -> dict[str, Any]:
    """
    Run the greenfield pipeline end-to-end using the existing nornir_tasks.
    Degrades to simulation when Nornir/devices are unavailable (nornir_tasks
    already handles that). Always dry_run by default for safety.
    """
    inv = build_inventory(state)
    production = build_production_bundle(state)
    results: dict[str, Any] = {"dry_run": dry_run, "device_count": len(inv), "stages": []}

    def _stage(name: str, fn) -> bool:
        try:
            out = fn()
            ok = _all_passed(out)
            results["stages"].append({"stage": name, "ok": ok, "result": out})
            return ok
        except Exception as exc:
            log.warning("greenfield stage %s failed: %s", name, exc)
            results["stages"].append({"stage": name, "ok": False, "error": str(exc)})
            return False

    try:
        from nornir_tasks import run_pre_checks, run_post_checks
        from nornir_tasks import deploy_configs
    except Exception as exc:
        results["error"] = f"nornir_tasks unavailable: {exc}"
        return results

    if not _stage("pre_checks", lambda: run_pre_checks(state, inv, deployment_id)):
        results["aborted_at"] = "pre_checks"
        return results
    if not _stage("push", lambda: deploy_configs(production, inv, dry_run, deployment_id)):
        results["aborted_at"] = "push"
        return results
    _stage("post_checks", lambda: run_post_checks(state, inv))
    results["complete"] = True
    return results


def _all_passed(out: Any) -> bool:
    if isinstance(out, list):
        return all(item.get("passed", True) for item in out if isinstance(item, dict))
    if isinstance(out, dict):
        statuses = [v.get("status") for v in out.values() if isinstance(v, dict)]
        return all(s in (None, "pushed", "dry_run", "ok") for s in statuses)
    return True
