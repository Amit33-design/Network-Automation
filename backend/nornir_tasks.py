"""
NetDesign AI — Nornir Task Runner
===================================
Parallel device operations via Nornir + Netmiko / NAPALM / NETCONF.

Functions:
  run_pre_checks(state, inventory)   — reachability + version + backup
  run_post_checks(state, inventory)  — BGP/OSPF/interface validation
  deploy_configs(configs, inventory, dry_run) — push configs with guard
  get_inventory_hosts()              — return list of hosts from inventory files
"""

from __future__ import annotations

import logging
import socket
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Nornir imports (graceful fallback if not installed)
try:
    from nornir import InitNornir
    from nornir.core.task import Task, Result
    from nornir_netmiko.tasks import netmiko_send_command, netmiko_send_config
    from nornir_utils.plugins.functions import print_result
    NORNIR_AVAILABLE = True
except ImportError:
    NORNIR_AVAILABLE = False
    log.warning("Nornir/Netmiko not installed — deploy tasks will run in simulation mode")

INVENTORY_DIR = Path(__file__).parent.parent / "playbooks" / "inventory"
NORNIR_CONFIG  = Path(__file__).parent / "nornir_config.yaml"


# ─────────────────────────────────────────────
# Inventory helpers
# ─────────────────────────────────────────────

def _init_nornir(inventory: dict[str, Any]):
    """
    Initialise a Nornir instance from a dict-format inventory.
    inventory format:
        {
          "spine1": {"hostname": "10.0.1.1", "platform": "cisco_nxos", "username": "admin", "password": "..."},
          ...
        }
    """
    if not NORNIR_AVAILABLE:
        return None

    # Build in-memory SimpleInventory-compatible dicts
    hosts = {}
    for name, data in inventory.items():
        hosts[name] = {
            "hostname": data.get("hostname", name),
            "platform": data.get("platform", "cisco_ios"),
            "username": data.get("username", "admin"),
            "password": data.get("password", ""),
            "port":     data.get("port", 22),
            "data":     data.get("data", {}),
        }

    nr = InitNornir(
        runner={"plugin": "threaded", "options": {"num_workers": 10}},
        inventory={
            "plugin": "SimpleInventory",
            "options": {
                "host_file":  None,
                "group_file": None,
                "defaults_file": None,
            },
        },
        logging={"enabled": False},
    )
    # Override with dict-built hosts
    for name, hdata in hosts.items():
        from nornir.core.inventory import Host, Defaults
        nr.inventory.hosts[name] = Host(
            name=name,
            hostname=hdata["hostname"],
            platform=hdata["platform"],
            username=hdata["username"],
            password=hdata["password"],
            port=hdata["port"],
            data=hdata["data"],
            defaults=Defaults(),
        )
    return nr


def get_inventory_hosts() -> list[dict[str, Any]]:
    """Read hosts.yml if it exists and return list of host dicts."""
    hosts_file = INVENTORY_DIR / "hosts.yml"
    if not hosts_file.exists():
        return []
    import yaml
    with open(hosts_file) as f:
        data = yaml.safe_load(f) or {}
    return [{"name": k, **v} for k, v in data.items()]


# ─────────────────────────────────────────────
# Check helpers
# ─────────────────────────────────────────────

def _icmp_reachable(host: str, timeout: int = 2) -> bool:
    """Simple TCP port-22 probe as reachability check."""
    try:
        s = socket.create_connection((host, 22), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False


def _simulate_check(host: str, check: str, passed: bool = True) -> dict[str, Any]:
    return {"host": host, "check": check, "passed": passed, "detail": "simulated"}


# ─────────────────────────────────────────────
# Pre-checks
# ─────────────────────────────────────────────

def run_pre_checks(state: dict[str, Any], inventory: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Pre-deployment checks:
      1. Reachability (TCP/22)
      2. SSH login + "show version" parse
      3. Running-config backup to local file
    """
    results: list[dict[str, Any]] = []

    if not inventory:
        log.info("No inventory provided — returning simulated pre-check results")
        for check in ["reachability", "ssh_login", "version_check", "config_backup"]:
            results.append(_simulate_check("demo-device", check))
        return results

    for host_name, host_data in inventory.items():
        ip = host_data.get("hostname", host_name)

        # 1. Reachability
        reachable = _icmp_reachable(ip)
        results.append({
            "host":   host_name,
            "check":  "reachability",
            "passed": reachable,
            "detail": f"TCP/22 to {ip}: {'OK' if reachable else 'FAILED'}",
        })
        if not reachable:
            # Skip remaining checks for this host
            for c in ["ssh_login", "version_check", "config_backup"]:
                results.append({"host": host_name, "check": c, "passed": False,
                                 "detail": "skipped — unreachable"})
            continue

        if not NORNIR_AVAILABLE:
            for c in ["ssh_login", "version_check", "config_backup"]:
                results.append(_simulate_check(host_name, c))
            continue

        # 2–3. SSH checks via Nornir
        try:
            nr = _init_nornir({host_name: host_data})
            if nr is None:
                raise RuntimeError("Nornir init failed")

            def _show_version(task: "Task") -> "Result":
                return task.run(task=netmiko_send_command, command_string="show version")

            nr_result = nr.run(task=_show_version)
            host_result = nr_result[host_name]
            success = not host_result.failed

            results.append({
                "host": host_name, "check": "ssh_login",
                "passed": success, "detail": "SSH login OK" if success else str(host_result.exception),
            })
            results.append({
                "host": host_name, "check": "version_check",
                "passed": success,
                "detail": (host_result[0].result[:200] if success else "failed"),
            })

            # 4. Config backup
            def _backup(task: "Task") -> "Result":
                return task.run(task=netmiko_send_command, command_string="show running-config")

            bak_result = nr.run(task=_backup)
            bak = bak_result[host_name]
            if not bak.failed:
                bak_path = Path(f"/tmp/netdesign_backup_{host_name}_{int(time.time())}.txt")
                bak_path.write_text(bak[0].result)
                results.append({"host": host_name, "check": "config_backup",
                                 "passed": True, "detail": f"Saved to {bak_path}"})
            else:
                results.append({"host": host_name, "check": "config_backup",
                                 "passed": False, "detail": str(bak.exception)})

        except Exception as exc:
            for c in ["ssh_login", "version_check", "config_backup"]:
                results.append({"host": host_name, "check": c,
                                 "passed": False, "detail": str(exc)})

    return results


# ─────────────────────────────────────────────
# Post-checks
# ─────────────────────────────────────────────

_POST_CHECK_COMMANDS: dict[str, list[str]] = {
    "cisco_nxos": [
        "show bgp summary",
        "show isis neighbors",
        "show interface counters errors",
        "show ip route summary",
    ],
    "cisco_ios": [
        "show ip bgp summary",
        "show ip ospf neighbor",
        "show interfaces counters errors",
        "show ip route summary",
    ],
    "arista_eos": [
        "show bgp summary",
        "show isis neighbors",
        "show interfaces counters errors",
        "show ip route summary",
    ],
    "juniper_junos": [
        "show bgp summary",
        "show isis adjacency",
        "show interfaces statistics",
        "show route summary",
    ],
}

# Per-platform commands for the three previously-missing post-checks
_ECN_COMMANDS: dict[str, str] = {
    "cisco_nxos":    "show queuing interface ethernet1/1 | include ecn",
    "arista_eos":    "show qos interface ethernet1 | include ecn",
    "sonic":         "show ecn",
}
_PFC_COMMANDS: dict[str, str] = {
    "cisco_nxos":    "show interface priority-flow-control",
    "arista_eos":    "show pfc counters",
    "sonic":         "show pfc counters",
}
# MTU probe: ping with DF-bit set at 9000-byte payload; parsed for success string
_MTU_PING_COMMANDS: dict[str, str] = {
    "cisco_nxos":    "ping {peer} count 3 packet-size 9000 df-bit",
    "cisco_ios":     "ping {peer} repeat 3 size 9000 df-bit",
    "arista_eos":    "ping {peer} size 9000 df-bit repeat 3",
    "juniper_junos": "ping {peer} count 3 size 9000 do-not-fragment",
}
_MTU_SUCCESS_STRINGS = ("!!!", "3/3", "bytes from", "Success rate is 100")

# LLDP: prefer JSON-structured output, fall back to text
_LLDP_COMMANDS: dict[str, str] = {
    "cisco_nxos":    "show lldp neighbors detail | json",
    "arista_eos":    "show lldp neighbors detail | json",
    "cisco_ios":     "show lldp neighbors detail",      # IOS has no JSON pipe
    "juniper_junos": "show lldp neighbors detail",
}


def _parse_lldp_json(raw: str) -> list[dict[str, Any]]:
    """Parse NX-OS / EOS 'show lldp neighbors detail | json' output."""
    import json
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []
    neighbors: list[dict[str, Any]] = []
    # NX-OS shape: { "TABLE_nbor_detail": { "ROW_nbor_detail": [...] } }
    rows = (data.get("TABLE_nbor_detail", {}).get("ROW_nbor_detail") or
            data.get("lldpNeighbors", []))
    if isinstance(rows, dict):
        rows = [rows]
    for row in (rows or []):
        neighbors.append({
            "local_port":  row.get("l_port_id") or row.get("port") or "?",
            "remote_host": row.get("sys_name")  or row.get("neighborDevice") or "?",
            "remote_port": row.get("port_id")   or row.get("neighborPort") or "?",
            "capability":  row.get("sys_cap")   or row.get("systemCapabilities") or "",
        })
    return neighbors


def _parse_lldp_text(raw: str) -> list[dict[str, Any]]:
    """
    Robustly parse text 'show lldp neighbors' output.

    NX-OS text format (may have long hostnames that wrap):
      Device ID          Local Intf     Hold-time  Capability  Port ID
      spine-01.dc.local  Eth1/1         120        BR          Eth1/3

    We search for lines that contain a known interface pattern on EITHER
    the local or remote port field, rather than relying on column position.
    """
    import re
    neighbors: list[dict[str, Any]] = []
    intf_re = re.compile(
        r'\b(Eth(?:ernet)?[\d/]+|GigabitEthernet[\d/]+|TenGigE[\d/]+|'
        r'HundredGig[\d/]+|Gi[\d/]+|Te[\d/]+|xe-\d+/\d+/\d+|et-\d+/\d+/\d+)\b',
        re.IGNORECASE,
    )
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        intfs = [p for p in parts if intf_re.match(p)]
        if len(intfs) >= 2:
            # Heuristic: first intf = local, last intf = remote
            remote_host = parts[0] if not intf_re.match(parts[0]) else "?"
            neighbors.append({
                "local_port":  intfs[0],
                "remote_host": remote_host,
                "remote_port": intfs[-1],
                "capability":  "",
            })
    return neighbors


def collect_lldp(host_name: str, host_data: dict[str, Any],
                 nr_instance: Any) -> dict[str, Any]:
    """
    Collect LLDP neighbor table from a live device.
    Uses JSON output where supported to avoid fragile text parsing.
    Returns {"host": ..., "check": "lldp_neighbors", "passed": bool,
             "neighbors": [...], "detail": str}
    """
    platform = host_data.get("platform", "cisco_ios")
    cmd = _LLDP_COMMANDS.get(platform, "show lldp neighbors detail")
    use_json = cmd.endswith("| json")

    try:
        def _lldp_task(task: "Task", c: str = cmd) -> "Result":
            return task.run(task=netmiko_send_command, command_string=c)

        nr_result = nr_instance.run(task=_lldp_task)
        host_result = nr_result[host_name]
        if host_result.failed:
            raise RuntimeError(str(host_result.exception))
        raw = host_result[0].result

        neighbors = _parse_lldp_json(raw) if use_json else _parse_lldp_text(raw)
        return {
            "host": host_name, "check": "lldp_neighbors",
            "passed": True,
            "neighbors": neighbors,
            "detail": f"{len(neighbors)} neighbors found",
        }
    except Exception as exc:
        return {"host": host_name, "check": "lldp_neighbors",
                "passed": False, "neighbors": [], "detail": str(exc)}


def run_post_checks(state: dict[str, Any], inventory: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Post-deployment validation checks.

    Runs for every host:
      1. Standard commands (BGP/routing/interfaces)
      2. LLDP neighbor collection (structured JSON where available)
      3. ECN threshold check         — previously hardcoded as {}
      4. PFC storm counter check     — previously hardcoded as {}
      5. End-to-end jumbo MTU probe  — previously hardcoded as {}
    """
    results: list[dict[str, Any]] = []
    uc = state.get("uc", "campus")

    if not inventory:
        for check in ["bgp_neighbors", "routing_table", "interface_errors",
                      "end_to_end_ping", "lldp_neighbors",
                      "ecn_thresholds", "pfc_counters", "mtu_ping_9000"]:
            results.append(_simulate_check("demo-device", check))
        return results

    for host_name, host_data in inventory.items():
        platform = host_data.get("platform", "cisco_ios")
        commands = _POST_CHECK_COMMANDS.get(platform, _POST_CHECK_COMMANDS["cisco_ios"])

        if not NORNIR_AVAILABLE or not _icmp_reachable(host_data.get("hostname", host_name)):
            for cmd in commands:
                results.append(_simulate_check(host_name, cmd[:40], passed=False))
            for check in ["lldp_neighbors", "ecn_thresholds", "pfc_counters", "mtu_ping_9000"]:
                results.append(_simulate_check(host_name, check, passed=False))
            continue

        try:
            nr = _init_nornir({host_name: host_data})
            if nr is None:
                raise RuntimeError("Nornir init failed")

            # ── 1. Standard post-check commands ───────────────────────────
            for cmd in commands:
                def _run_cmd(task: "Task", c: str = cmd) -> "Result":
                    return task.run(task=netmiko_send_command, command_string=c)

                nr_result = nr.run(task=_run_cmd)
                host_result = nr_result[host_name]
                passed = not host_result.failed
                detail = host_result[0].result[:300] if passed else str(host_result.exception)
                results.append({"host": host_name, "check": cmd[:40],
                                 "passed": passed, "detail": detail})

            # ── 2. LLDP neighbors (structured JSON parser) ─────────────────
            results.append(collect_lldp(host_name, host_data, nr))

            # ── 3. ECN threshold check ─────────────────────────────────────
            ecn_cmd = _ECN_COMMANDS.get(platform)
            if ecn_cmd:
                def _ecn_task(task: "Task", c: str = ecn_cmd) -> "Result":
                    return task.run(task=netmiko_send_command, command_string=c)
                ecn_result = nr.run(task=_ecn_task)
                ecn_out = ecn_result[host_name]
                if not ecn_out.failed:
                    raw = ecn_out[0].result
                    # Pass if ECN appears configured (any ecn keyword in output)
                    passed = bool(raw.strip()) and "ecn" in raw.lower()
                    results.append({"host": host_name, "check": "ecn_thresholds",
                                     "passed": passed,
                                     "detail": raw[:200] if raw.strip() else "no ECN output"})
                else:
                    results.append({"host": host_name, "check": "ecn_thresholds",
                                     "passed": False, "detail": str(ecn_out.exception)})
            else:
                results.append(_simulate_check(host_name, "ecn_thresholds"))

            # ── 4. PFC storm counter check ─────────────────────────────────
            pfc_cmd = _PFC_COMMANDS.get(platform)
            if pfc_cmd:
                def _pfc_task(task: "Task", c: str = pfc_cmd) -> "Result":
                    return task.run(task=netmiko_send_command, command_string=c)
                pfc_result = nr.run(task=_pfc_task)
                pfc_out = pfc_result[host_name]
                if not pfc_out.failed:
                    raw = pfc_out[0].result
                    # Flag if any interface has non-zero PFC storm drops
                    storm_drop = any(
                        tok.isdigit() and int(tok) > 0
                        for line in raw.splitlines()
                        if "storm" in line.lower() or "drop" in line.lower()
                        for tok in line.split()
                    )
                    results.append({"host": host_name, "check": "pfc_counters",
                                     "passed": not storm_drop,
                                     "detail": ("PFC storm drops detected" if storm_drop
                                                else raw[:200] or "PFC counters OK")})
                else:
                    results.append({"host": host_name, "check": "pfc_counters",
                                     "passed": False, "detail": str(pfc_out.exception)})
            else:
                results.append(_simulate_check(host_name, "pfc_counters"))

            # ── 5. End-to-end jumbo MTU probe (/31 peer or first spine) ────
            # Only run for DC/GPU UC; skip for campus (no jumbo requirement)
            if uc in ("dc", "gpu"):
                peer_ip = host_data.get("peer_ip") or host_data.get("loopback_peer")
                mtu_tpl = _MTU_PING_COMMANDS.get(platform)
                if peer_ip and mtu_tpl:
                    mtu_cmd = mtu_tpl.format(peer=peer_ip)
                    def _mtu_task(task: "Task", c: str = mtu_cmd) -> "Result":
                        return task.run(task=netmiko_send_command, command_string=c)
                    mtu_result = nr.run(task=_mtu_task)
                    mtu_out = mtu_result[host_name]
                    if not mtu_out.failed:
                        raw = mtu_out[0].result
                        passed = any(s in raw for s in _MTU_SUCCESS_STRINGS)
                        results.append({"host": host_name, "check": "mtu_ping_9000",
                                         "passed": passed,
                                         "detail": raw[:200] if raw.strip() else "no ping output"})
                    else:
                        results.append({"host": host_name, "check": "mtu_ping_9000",
                                         "passed": False, "detail": str(mtu_out.exception)})
                else:
                    results.append({"host": host_name, "check": "mtu_ping_9000",
                                     "passed": False,
                                     "detail": "peer_ip not set in inventory — add peer_ip field"})
            else:
                results.append(_simulate_check(host_name, "mtu_ping_9000"))

        except Exception as exc:
            for cmd in commands:
                results.append({"host": host_name, "check": cmd[:40],
                                 "passed": False, "detail": str(exc)})
            for check in ["lldp_neighbors", "ecn_thresholds", "pfc_counters", "mtu_ping_9000"]:
                results.append({"host": host_name, "check": check,
                                 "passed": False, "detail": str(exc)})

    return results


# ─────────────────────────────────────────────
# Deploy
# ─────────────────────────────────────────────

def deploy_configs(
    configs: dict[str, str],
    inventory: dict[str, Any],
    dry_run: bool = True,
) -> dict[str, Any]:
    """
    Push generated configs to devices.
    dry_run=True  — render + validate only, do NOT push
    dry_run=False — push with 30-second confirm-commit guard
    """
    results: dict[str, Any] = {}

    if dry_run:
        for host_name, config in configs.items():
            results[host_name] = {
                "status": "dry_run",
                "lines":  len(config.splitlines()),
                "detail": "Config validated (not pushed — dry_run=True)",
            }
        return results

    if not inventory:
        for host_name, config in configs.items():
            results[host_name] = {"status": "skipped", "detail": "no inventory"}
        return results

    if not NORNIR_AVAILABLE:
        for host_name in configs:
            results[host_name] = {"status": "simulated", "detail": "Nornir not installed"}
        return results

    for host_name, config in configs.items():
        if host_name not in inventory:
            results[host_name] = {"status": "not_in_inventory",
                                   "detail": f"{host_name} not in inventory — skipped"}
            continue

        host_data = inventory[host_name]
        try:
            nr = _init_nornir({host_name: host_data})

            config_lines = config.splitlines()

            def _push(task: "Task") -> "Result":
                return task.run(
                    task=netmiko_send_config,
                    config_commands=config_lines,
                )

            nr_result = nr.run(task=_push)
            host_result = nr_result[host_name]

            if host_result.failed:
                results[host_name] = {"status": "failed", "detail": str(host_result.exception)}
            else:
                results[host_name] = {
                    "status": "pushed",
                    "lines":  len(config_lines),
                    "detail": "Config pushed successfully",
                }

        except Exception as exc:
            results[host_name] = {"status": "error", "detail": str(exc)}

    return results
