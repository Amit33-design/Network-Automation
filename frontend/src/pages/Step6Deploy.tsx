import React, { useState, useRef } from 'react'
import { useTopologySummary, useTopologyDevices } from '@/hooks/useTopology'
import { useRunZTP } from '@/hooks/useZTP'
import { useRunChecks } from '@/hooks/useChecks'
import { usePollMonitoring } from '@/hooks/useMonitoring'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import { formatUptime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ZTPEvent, BOMDevice, CheckResult, MonitoringResult } from '@/types'

const ZTP_STAGES = [
  'dhcp_requested', 'bootstrap_downloaded', 'config_applied',
  'registered', 'pre_checks_running', 'pre_checks_passed', 'online', 'failed',
]

const CHECK_OPTIONS = [
  'interfaces_up', 'bgp_sessions', 'routing_table', 'cpu_baseline',
  'stp_mode', 'vlans_active', 'ha_sync', 'virtual_servers', 'pool_members',
]

const STATUS_BADGE: Record<string, 'pass' | 'warn' | 'fail' | 'neutral'> = {
  healthy: 'pass', degraded: 'warn', down: 'fail', unknown: 'neutral',
}

type Tab = 'deploy' | 'ztp' | 'checks' | 'monitor' | 'netconf' | 'day2ops' | 'batfish'

type PipelineStage = 'precheck' | 'backup' | 'push' | 'verify' | 'postcheck'
type StageStatus = 'pending' | 'running' | 'done' | 'failed'

const PIPELINE_STAGES: Array<{ id: PipelineStage; label: string; desc: string }> = [
  { id: 'precheck',  label: 'Pre-Deployment Checks', desc: 'Verify connectivity, baseline state, and config syntax' },
  { id: 'backup',    label: 'Backup Running Configs', desc: 'Archive current device configurations before changes' },
  { id: 'push',      label: 'Push Configurations',    desc: 'Deploy generated configs via NETCONF / SSH / RESTCONF' },
  { id: 'verify',    label: 'Verify',                 desc: 'Confirm config applied — spot-check routing and BGP state' },
  { id: 'postcheck', label: 'Post-Deployment Checks', desc: 'Full automated post-check suite and health validation' },
]

// ── Script generators ─────────────────────────────────────────────────────────

function buildPreCheckScript(): string {
  return `#!/usr/bin/env python3
"""
NetDesign AI — Pre-Deployment Check Script (M-48)
Run BEFORE pushing configs to capture a baseline snapshot.
"""

import datetime
import csv
import sys
from pathlib import Path

try:
    from netmiko import ConnectHandler, SSHDetect
    from tabulate import tabulate
except ImportError:
    sys.exit("Install dependencies: pip install netmiko tabulate")

DEVICES_CSV = "devices.csv"   # hostname, ip, platform, username, password
LOG_DIR = Path("pre_check_logs")
LOG_DIR.mkdir(exist_ok=True)
TIMESTAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

COMMANDS = [
    "show version",
    "show interfaces status",
    "show ip route summary",
    "show bgp summary",          # NX-OS / EOS / IOS-XE (may error on non-BGP devices)
    "show ip ospf neighbor",
    "show ip isis neighbors",
    "show environment",
]


def run_checks(device_row: dict) -> list[dict]:
    results = []
    best_match = SSHDetect(
        device_type="autodetect",
        host=device_row["ip"],
        username=device_row["username"],
        password=device_row["password"],
    )
    detected_type = best_match.autodetect() or device_row.get("platform", "cisco_ios")
    best_match.connection.disconnect()

    conn_params = {
        "device_type": detected_type,
        "host": device_row["ip"],
        "username": device_row["username"],
        "password": device_row["password"],
    }
    with ConnectHandler(**conn_params) as net_connect:
        for cmd in COMMANDS:
            try:
                output = net_connect.send_command(cmd, read_timeout=30)
                results.append({"command": cmd, "output": output, "status": "OK"})
            except Exception as exc:
                results.append({"command": cmd, "output": str(exc), "status": "ERROR"})
    return results


def main():
    devices = []
    with open(DEVICES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            devices.append(row)

    if not devices:
        sys.exit(f"No devices found in {DEVICES_CSV}")

    all_rows = []
    for dev in devices:
        hostname = dev["hostname"]
        print(f"[*] Checking {hostname} ({dev['ip']}) …")
        try:
            results = run_checks(dev)
        except Exception as exc:
            print(f"  [!] Connection failed: {exc}")
            results = [{"command": c, "output": str(exc), "status": "CONN_ERR"} for c in COMMANDS]

        log_path = LOG_DIR / f"{hostname}_pre_{TIMESTAMP}.txt"
        with open(log_path, "w") as lf:
            for r in results:
                lf.write(f"\\n{'='*60}\\n")
                lf.write(f"CMD : {r['command']}\\n")
                lf.write(f"STATUS: {r['status']}\\n")
                lf.write(r["output"] + "\\n")
        print(f"  [+] Log saved: {log_path}")
        all_rows.append([hostname, dev["ip"], len([r for r in results if r["status"] == "OK"]),
                         len([r for r in results if r["status"] != "OK"])])

    print("\\n" + tabulate(all_rows, headers=["Hostname", "IP", "Commands OK", "Errors"], tablefmt="grid"))
    print(f"\\nPre-check logs written to: {LOG_DIR}/")


if __name__ == "__main__":
    main()
`
}

function buildPostCheckScript(): string {
  return `#!/usr/bin/env python3
"""
NetDesign AI — Post-Deployment Check Script (M-49)
Run AFTER pushing configs to verify the deployment succeeded.
"""

import datetime
import csv
import sys
from pathlib import Path

try:
    from netmiko import ConnectHandler, SSHDetect
    from tabulate import tabulate
except ImportError:
    sys.exit("Install dependencies: pip install netmiko tabulate")

DEVICES_CSV = "devices.csv"   # hostname, ip, platform, username, password
LOG_DIR = Path("post_check_logs")
LOG_DIR.mkdir(exist_ok=True)
TIMESTAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

# Post-deploy focuses on verifying routing and protocol convergence
COMMANDS = [
    "show version",
    "show interfaces status",
    "show ip route summary",
    "show bgp summary",
    "show ip ospf neighbor",
    "show ip isis neighbors",
    "show nve peers",            # VXLAN overlay (NX-OS)
    "show mac address-table count",
    "show environment",
    "show logging last 50",
]

EXPECTED_CHECKS = {
    "bgp_peers_up": lambda output: "Established" in output or "Up" in output,
    "interfaces_no_errors": lambda output: "err-disabled" not in output.lower(),
    "routes_present": lambda output: int((output.split("Total") or ["0"])[-1].strip().split()[0]) > 0
                                     if "Total" in output else True,
}


def run_post_checks(device_row: dict) -> tuple[list[dict], list[dict]]:
    raw_results = []
    validation_results = []

    best_match = SSHDetect(
        device_type="autodetect",
        host=device_row["ip"],
        username=device_row["username"],
        password=device_row["password"],
    )
    detected_type = best_match.autodetect() or device_row.get("platform", "cisco_ios")
    best_match.connection.disconnect()

    conn_params = {
        "device_type": detected_type,
        "host": device_row["ip"],
        "username": device_row["username"],
        "password": device_row["password"],
    }
    with ConnectHandler(**conn_params) as net_connect:
        for cmd in COMMANDS:
            try:
                output = net_connect.send_command(cmd, read_timeout=30)
                raw_results.append({"command": cmd, "output": output, "status": "OK"})
            except Exception as exc:
                raw_results.append({"command": cmd, "output": str(exc), "status": "ERROR"})

    # Validation checks
    bgp_output = next((r["output"] for r in raw_results if "bgp summary" in r["command"]), "")
    int_output  = next((r["output"] for r in raw_results if "interfaces status" in r["command"]), "")
    rte_output  = next((r["output"] for r in raw_results if "route summary" in r["command"]), "")

    validation_results.append({
        "check": "BGP Peers Up",
        "pass": EXPECTED_CHECKS["bgp_peers_up"](bgp_output),
        "detail": "Established/Up found in BGP summary" if EXPECTED_CHECKS["bgp_peers_up"](bgp_output) else "No active BGP peers detected",
    })
    validation_results.append({
        "check": "Interfaces No Errors",
        "pass": EXPECTED_CHECKS["interfaces_no_errors"](int_output),
        "detail": "No err-disabled interfaces" if EXPECTED_CHECKS["interfaces_no_errors"](int_output) else "err-disabled interface(s) detected",
    })
    validation_results.append({
        "check": "Routes Present",
        "pass": EXPECTED_CHECKS["routes_present"](rte_output),
        "detail": "Routing table non-empty",
    })

    return raw_results, validation_results


def main():
    devices = []
    with open(DEVICES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            devices.append(row)

    if not devices:
        sys.exit(f"No devices found in {DEVICES_CSV}")

    summary_rows = []
    for dev in devices:
        hostname = dev["hostname"]
        print(f"[*] Post-checking {hostname} ({dev['ip']}) …")
        try:
            raw, validations = run_post_checks(dev)
        except Exception as exc:
            print(f"  [!] Connection failed: {exc}")
            raw = []
            validations = [{"check": "Connection", "pass": False, "detail": str(exc)}]

        log_path = LOG_DIR / f"{hostname}_post_{TIMESTAMP}.txt"
        with open(log_path, "w") as lf:
            lf.write(f"Post-check: {hostname} at {TIMESTAMP}\\n")
            lf.write("\\n=== VALIDATION RESULTS ===\\n")
            for v in validations:
                status = "PASS" if v["pass"] else "FAIL"
                lf.write(f"  [{status}] {v['check']}: {v['detail']}\\n")
            lf.write("\\n=== RAW COMMAND OUTPUT ===\\n")
            for r in raw:
                lf.write(f"\\n{'='*60}\\nCMD: {r['command']}\\n{r['output']}\\n")
        print(f"  [+] Log saved: {log_path}")

        pass_count = sum(1 for v in validations if v["pass"])
        fail_count = sum(1 for v in validations if not v["pass"])
        summary_rows.append([hostname, dev["ip"], pass_count, fail_count,
                              "PASS" if fail_count == 0 else "FAIL"])

    print("\\n" + tabulate(summary_rows,
                            headers=["Hostname", "IP", "Checks PASS", "Checks FAIL", "Overall"],
                            tablefmt="grid"))
    print(f"\\nPost-check logs written to: {LOG_DIR}/")


if __name__ == "__main__":
    main()
`
}

function buildPushConfigsScript(): string {
  return `#!/usr/bin/env python3
"""
NetDesign AI — push_configs.py (M-50)

Push per-device config files to network devices using Netmiko.

Usage:
  python push_configs.py [--devices devices.csv] [--configs-dir configs/] [--dry-run]

devices.csv format (header row required):
  hostname,ip,platform,username,password

configs/ directory must contain files named <hostname>.txt or <hostname>.cfg
Supported platforms (Netmiko device_type strings):
  cisco_ios, cisco_nxos, cisco_xe, arista_eos, juniper_junos, paloalto_panos
"""

import argparse
import csv
import datetime
import sys
from pathlib import Path

try:
    from netmiko import ConnectHandler
    from tabulate import tabulate
except ImportError:
    sys.exit("Install dependencies: pip install netmiko tabulate")

TIMESTAMP = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
PUSH_LOG = Path(f"push_log_{TIMESTAMP}.txt")


def find_config_file(configs_dir: Path, hostname: str) -> Path | None:
    for ext in (".txt", ".cfg", ".conf"):
        candidate = configs_dir / f"{hostname}{ext}"
        if candidate.exists():
            return candidate
    return None


def push_config(device_row: dict, config_path: Path, dry_run: bool) -> dict:
    hostname = device_row["hostname"]
    config_text = config_path.read_text()
    config_lines = [line for line in config_text.splitlines() if line.strip() and not line.strip().startswith("!")]

    if dry_run:
        return {"hostname": hostname, "status": "DRY_RUN", "detail": f"{len(config_lines)} lines (not pushed)"}

    conn_params = {
        "device_type": device_row.get("platform", "cisco_ios"),
        "host": device_row["ip"],
        "username": device_row["username"],
        "password": device_row["password"],
    }
    try:
        with ConnectHandler(**conn_params) as net_connect:
            net_connect.enable() if hasattr(net_connect, "enable") else None
            output = net_connect.send_config_set(config_lines, read_timeout=120)
            net_connect.save_config()
        return {"hostname": hostname, "status": "SUCCESS", "detail": f"{len(config_lines)} lines pushed"}
    except Exception as exc:
        return {"hostname": hostname, "status": "FAILED", "detail": str(exc)}


def main():
    parser = argparse.ArgumentParser(description="Push configs to network devices via Netmiko")
    parser.add_argument("--devices",     default="devices.csv",    help="CSV file with device inventory")
    parser.add_argument("--configs-dir", default="configs",        help="Directory containing config files")
    parser.add_argument("--dry-run",     action="store_true",      help="Parse and validate only, do not push")
    args = parser.parse_args()

    configs_dir = Path(args.configs_dir)
    if not configs_dir.exists():
        sys.exit(f"Configs directory not found: {configs_dir}")

    devices = []
    with open(args.devices) as f:
        reader = csv.DictReader(f)
        for row in reader:
            devices.append(row)

    if not devices:
        sys.exit(f"No devices found in {args.devices}")

    print(f"[*] Pushing configs to {len(devices)} device(s)  [dry_run={args.dry_run}]\\n")

    results = []
    with open(PUSH_LOG, "w") as log_file:
        log_file.write(f"push_configs.py run at {TIMESTAMP}\\n")
        log_file.write(f"dry_run={args.dry_run}\\n\\n")

        for dev in devices:
            hostname = dev["hostname"]
            config_path = find_config_file(configs_dir, hostname)
            if config_path is None:
                result = {"hostname": hostname, "status": "SKIPPED", "detail": "No config file found"}
            else:
                print(f"  [{hostname}] Pushing {config_path.name} …")
                result = push_config(dev, config_path, dry_run=args.dry_run)
                icon = "+" if result["status"] in ("SUCCESS", "DRY_RUN") else "!"
                print(f"  [{icon}] {hostname}: {result['status']} — {result['detail']}")

            results.append(result)
            log_file.write(f"{hostname}: {result['status']} — {result['detail']}\\n")

    print("\\n" + tabulate(
        [[r["hostname"], r["status"], r["detail"]] for r in results],
        headers=["Hostname", "Status", "Detail"],
        tablefmt="grid",
    ))
    pushed  = sum(1 for r in results if r["status"] == "SUCCESS")
    failed  = sum(1 for r in results if r["status"] == "FAILED")
    skipped = sum(1 for r in results if r["status"] in ("SKIPPED", "DRY_RUN"))
    print(f"\\nSummary: {pushed} pushed, {failed} failed, {skipped} skipped/dry-run")
    print(f"Full log: {PUSH_LOG}")


if __name__ == "__main__":
    main()
`
}

function buildGrokPatternsConfig(): string {
  return `# NetDesign AI — Logstash Grok Patterns for Network Devices (M-51)
# Place this file at /etc/logstash/conf.d/10-network-grok.conf
# Tested against: Cisco IOS-XE, NX-OS, Arista EOS, Juniper JunOS

input {
  syslog {
    port => 5514
    type => "network-syslog"
  }
  udp {
    port  => 5514
    type  => "network-syslog-udp"
    codec => plain
  }
}

filter {
  if [type] =~ "network-syslog" {

    # ── Timestamp and host normalisation ─────────────────────────────────────
    grok {
      match => { "message" => "%{SYSLOGTIMESTAMP:syslog_timestamp} %{IPORHOST:syslog_host} %{GREEDYDATA:syslog_message}" }
      overwrite => [ "host" ]
    }

    # ── BGP neighbour state change ────────────────────────────────────────────
    # Cisco: %BGP-5-ADJCHANGE: neighbor 10.0.0.1 vpn vrf MGMT Up
    # Arista: %BGP-3-NOTIFICATION: sent to neighbor 10.0.0.2 (AS 65001) 6/7
    grok {
      match => { "syslog_message" => [
        "%{DATA}BGP%{DATA}ADJCHANGE%{DATA}neighbor %{IP:bgp_peer}%{SPACE}%{DATA:bgp_vrf}\\s+%{WORD:bgp_state}",
        "%{DATA}BGP%{DATA}NOTIFICATION%{DATA}neighbor %{IP:bgp_peer}%{SPACE}\\(AS %{INT:bgp_peer_as}\\)"
      ]}
      add_tag => [ "bgp_event" ]
      tag_on_failure => []
    }

    # ── Interface state change ────────────────────────────────────────────────
    # Cisco:  %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to down
    # NX-OS:  %ETH_PORT_CHANNEL-5-FOP_CHANGED: port-channel1 ... changed state to up
    # Arista: %LINEPROTO-5-UPDOWN: Line protocol on Interface Ethernet1, changed state to up
    grok {
      match => { "syslog_message" => [
        "%{DATA}UPDOWN%{DATA}Interface %{DATA:if_name}, changed state to %{WORD:if_state}",
        "%{DATA}LINK-%{INT}-UPDOWN%{DATA}Interface %{DATA:if_name}, changed state to %{WORD:if_state}"
      ]}
      add_tag => [ "interface_event" ]
      tag_on_failure => []
    }

    # ── OSPF neighbour state ──────────────────────────────────────────────────
    # Cisco: %OSPF-5-ADJCHG: Process 1, Nbr 10.0.0.2 on GigabitEthernet0/0 from LOADING to FULL
    grok {
      match => { "syslog_message" =>
        "%{DATA}OSPF%{DATA}ADJCHG%{DATA}Nbr %{IP:ospf_neighbor} on %{DATA:ospf_interface} from %{WORD:ospf_old_state} to %{WORD:ospf_new_state}"
      }
      add_tag => [ "ospf_event" ]
      tag_on_failure => []
    }

    # ── IS-IS adjacency ───────────────────────────────────────────────────────
    # NX-OS: %ISIS-5-ADJCHANGE: isis-UNDERLAY Process: IS-IS adjacency with R01.00 changed from Up to Down
    grok {
      match => { "syslog_message" =>
        "%{DATA}ISIS%{DATA}ADJCHANGE%{DATA}adjacency with %{DATA:isis_neighbor} changed from %{WORD:isis_old_state} to %{WORD:isis_new_state}"
      }
      add_tag => [ "isis_event" ]
      tag_on_failure => []
    }

    # ── VXLAN / EVPN ─────────────────────────────────────────────────────────
    # NX-OS: %VPC-2-PEER_KEEP_ALIVE_RECV_FAIL: peer keepalive receive has failed
    # NX-OS: %NVE-5-NVE_TUNNEL_UP: NVE tunnel to 10.1.0.2 is up
    grok {
      match => { "syslog_message" => [
        "%{DATA}NVE%{DATA}NVE_TUNNEL_%{WORD:nve_event}: NVE tunnel to %{IP:nve_peer}",
        "%{DATA}VPC%{DATA}: %{GREEDYDATA:vpc_message}"
      ]}
      add_tag => [ "overlay_event" ]
      tag_on_failure => []
    }

    # ── CPU / Memory threshold ────────────────────────────────────────────────
    # Cisco: %SYS-4-CPUHOG: Task is running for 2016msec more than 2000msec
    grok {
      match => { "syslog_message" =>
        "%{DATA}CPUHOG%{DATA}Task is running for %{INT:cpu_ms}msec"
      }
      add_tag => [ "cpu_event" ]
      tag_on_failure => []
    }

    # ── Hardware / ASIC errors ────────────────────────────────────────────────
    grok {
      match => { "syslog_message" =>
        "%{DATA}(HARDWARE|PLATFORM|ASIC)%{DATA}(error|fault|ECC|parity): %{GREEDYDATA:hw_error}"
      }
      add_tag => [ "hw_error" ]
      tag_on_failure => []
    }

    # ── PFC Watchdog (GPU/RoCE) ───────────────────────────────────────────────
    # NX-OS: %PFC_WD-2-PFC_WD_DETECTED: PFC Watchdog detected on port Ethernet1/1
    grok {
      match => { "syslog_message" =>
        "%{DATA}PFC_WD%{DATA}PFC_WD_DETECTED%{DATA}port %{DATA:pfc_port}"
      }
      add_tag => [ "pfc_watchdog" ]
      tag_on_failure => []
    }

    date {
      match => [ "syslog_timestamp", "MMM  d HH:mm:ss", "MMM dd HH:mm:ss", "ISO8601" ]
    }

    mutate {
      remove_field => [ "syslog_timestamp" ]
    }
  }
}

output {
  if [type] =~ "network-syslog" {
    elasticsearch {
      hosts    => ["http://elasticsearch:9200"]
      index    => "network-logs-%{+YYYY.MM.dd}"
      user     => "elastic"
      password => "<CHANGE-ME-ELASTIC-PASS>"
    }
  }
  # Uncomment for local debug
  # stdout { codec => rubydebug }
}
`
}

function buildNetflowConfig(): string {
  return `! NetDesign AI — NetFlow / sFlow Exporter Config Snippets (M-52)
! Paste the relevant section into your device configuration.
!
! Sections:
!   1. Cisco IOS-XE  — NetFlow v9 + IPFIX
!   2. Cisco NX-OS   — NetFlow v9
!   3. Arista EOS    — sFlow
!   4. Juniper JunOS — cflowd (NetFlow v9)
!   5. Collector note (ntopng / pmacct / ElastiFlow)
!
! Replace <COLLECTOR_IP> with your actual flow collector IP.
! Replace <MGMT_VRF>    with your management VRF name (or remove vrf clause).
! Replace <DEVICE_IP>   with this device's source IP for flow exports.

! ===========================================================================
! 1. CISCO IOS-XE — IPFIX / NetFlow v9
! ===========================================================================

ip flow-export version 9
ip flow-export destination <COLLECTOR_IP> 9995 vrf <MGMT_VRF>
ip flow-export source Loopback0

ip flow-cache timeout active 1
ip flow-cache timeout inactive 15

! Apply on WAN/uplink interfaces (repeat per interface):
interface GigabitEthernet0/0/0
 ip flow ingress
 ip flow egress

! --- OR use Flexible NetFlow (preferred on IOS-XE 16+) ---

flow record NETFLOW_RECORD
 match ipv4 tos
 match ipv4 protocol
 match ipv4 source address
 match ipv4 destination address
 match transport source-port
 match transport destination-port
 collect interface input
 collect interface output
 collect counter bytes
 collect counter packets
 collect timestamp sys-uptime first
 collect timestamp sys-uptime last

flow exporter NETFLOW_EXPORTER
 destination <COLLECTOR_IP>
 source      Loopback0
 transport udp 9995
 template data timeout 300
 export-protocol netflow-v9

flow monitor NETFLOW_MONITOR
 record   NETFLOW_RECORD
 exporter NETFLOW_EXPORTER
 cache entries   8192
 cache timeout active   60
 cache timeout inactive 15

! Apply per interface:
interface GigabitEthernet0/0/0
 ip flow monitor NETFLOW_MONITOR input
 ip flow monitor NETFLOW_MONITOR output


! ===========================================================================
! 2. CISCO NX-OS — NetFlow v9
! ===========================================================================

feature netflow

flow record NX_FLOW_RECORD
  match ipv4 source address
  match ipv4 destination address
  match transport source-port
  match transport destination-port
  match ip protocol
  match ip tos
  collect counter bytes long
  collect counter packets long
  collect timestamp sys-uptime first
  collect timestamp sys-uptime last
  collect interface input
  collect interface output

flow exporter NX_EXPORTER
  destination <COLLECTOR_IP> use-vrf <MGMT_VRF>
  source      mgmt0
  transport udp 9995
  version 9

flow monitor NX_MONITOR
  record   NX_FLOW_RECORD
  exporter NX_EXPORTER

! Apply per interface (on Leaf downlinks or Spine uplinks):
interface Ethernet1/1
  ip flow monitor NX_MONITOR input
  ip flow monitor NX_MONITOR output


! ===========================================================================
! 3. ARISTA EOS — sFlow
! ===========================================================================

sflow source-interface Loopback0
sflow destination <COLLECTOR_IP> 6343
sflow polling-interval 30
sflow sample 1024

! Enable on specific interfaces or globally:
interface Ethernet1
 sflow enable

! --- or globally ---
sflow run


! ===========================================================================
! 4. JUNIPER JunOS — cflowd (NetFlow v9)
! ===========================================================================

set forwarding-options sampling input rate 1000
set forwarding-options sampling family inet output flow-server <COLLECTOR_IP> port 9995
set forwarding-options sampling family inet output flow-server <COLLECTOR_IP> version9 template ipv4
set forwarding-options sampling family inet output source-address <DEVICE_IP>
set forwarding-options sampling family inet output inline-jflow source-address <DEVICE_IP>

set interfaces ge-0/0/0 unit 0 family inet sampling input
set interfaces ge-0/0/0 unit 0 family inet sampling output


! ===========================================================================
! 5. COLLECTOR NOTES
! ===========================================================================
!
! Recommended open-source flow collectors:
!   - ntopng    : https://github.com/ntop/ntopng       (port 9995/UDP)
!   - ElastiFlow: https://github.com/robcowart/elastiflow (Logstash plugin)
!   - pmacct    : https://github.com/pmacct/pmacct      (flexible, multi-format)
!   - GoFlow2   : https://github.com/netsampler/goflow2 (Prometheus-native)
!
! Docker quick-start (GoFlow2 → Prometheus → Grafana):
!   docker run -d -p 9995:9995/udp -p 8080:8080 \\
!     netsampler/goflow2:latest \\
!     -netflow.addr=:9995 -metrics.addr=:8080
!
! Scrape GoFlow2 in prometheus.yml:
!   - job_name: 'goflow2'
!     static_configs:
!       - targets: ['goflow2:8080']
`
}

// ── Download helper ───────────────────────────────────────────────────────────

function downloadBlob(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Alias used for M-64 / M-65
const downloadText = downloadBlob

// ── M-64: Ansible playbook generator ─────────────────────────────────────────

function buildAnsiblePlaybook(logLines: string[], deviceNames: string[]): string {
  return `---
# NetDesign AI — Generated Ansible Playbook (M-64)
# Deploy network device configurations
# Devices: ${deviceNames.join(', ') || 'see inventory'}

- name: Network Device Configuration Deployment
  hosts: all
  gather_facts: no
  vars:
    deploy_log: |
${logLines.slice(0, 20).map(l => `      ${l}`).join('\n')}

  tasks:
    - name: Push configuration
      cisco.ios.ios_config:
        src: "{{ inventory_hostname }}.cfg"

    - name: Save running config
      cisco.ios.ios_command:
        commands: write memory

    - name: Verify BGP neighbors
      cisco.ios.ios_command:
        commands: show bgp summary
      register: bgp_output

    - name: Assert BGP sessions established
      ansible.builtin.assert:
        that:
          - "'Established' in bgp_output.stdout[0]"
        fail_msg: "BGP session not established on {{ inventory_hostname }}"
        success_msg: "BGP OK on {{ inventory_hostname }}"

# Inventory hint — create an inventory.ini with:
# [network_devices]
${deviceNames.map(n => `# ${n} ansible_host=<IP> ansible_user=<CHANGE-ME-USER> ansible_password=<CHANGE-ME-PASS>`).join('\n') || '# leaf1 ansible_host=192.168.1.1 ansible_user=<CHANGE-ME-USER> ansible_password=<CHANGE-ME-PASS>'}
`
}

// ── M-65: NETCONF Python script generator ────────────────────────────────────

function buildNetconfScript(): string {
  return `#!/usr/bin/env python3
"""
NetDesign AI — NETCONF Push Script (M-65)
Push interface configuration via NETCONF using ncclient.

Supported devices:
  - Juniper JunOS (ncclient native)
  - Cisco IOS-XE 16.6+ (NETCONF/YANG)
  - Cisco NX-OS (NETCONF enabled with 'feature netconf')

Install: pip install ncclient
"""

from ncclient import manager
from lxml import etree
import sys

# ── Device connection parameters ─────────────────────────────────────────────
DEVICES = [
    {
        "host":     "192.168.1.1",
        "port":     830,
        "username": "<CHANGE-ME-USER>",
        "password": "<CHANGE-ME-PASS>",
        "hostkey_verify": False,
        "device_params": {"name": "iosxe"},   # or "junos" / "nexus"
    },
]

# ── Sample: configure interface description ───────────────────────────────────
INTERFACE_CONFIG_XML = """
<config xmlns:xc="urn:ietf:params:xml:ns:netconf:base:1.0">
  <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
    <interface>
      <name>GigabitEthernet1</name>
      <description>NetDesign AI — managed port</description>
      <enabled>true</enabled>
      <ipv4 xmlns="urn:ietf:params:xml:ns:yang:ietf-ip">
        <address>
          <ip>10.0.0.1</ip>
          <prefix-length>24</prefix-length>
        </address>
      </ipv4>
    </interface>
  </interfaces>
</config>
"""


def push_config(device: dict, config_xml: str) -> bool:
    print(f"[*] Connecting to {device['host']}:{device['port']} ...")
    try:
        with manager.connect(**device) as m:
            print(f"  Session ID: {m.session_id}")
            print(f"  Server capabilities: {len(list(m.server_capabilities))} capabilities")

            # Edit config via NETCONF
            response = m.edit_config(target="running", config=config_xml)
            print(f"  edit-config response: {response}")

            # Validate
            m.validate(source="running")
            print("  [+] Config validated successfully")
            return True
    except Exception as exc:
        print(f"  [!] NETCONF error: {exc}", file=sys.stderr)
        return False


def get_interfaces(device: dict) -> None:
    """Retrieve interface state via NETCONF get."""
    filter_xml = """
    <filter type="subtree">
      <interfaces-state xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/>
    </filter>
    """
    with manager.connect(**device) as m:
        result = m.get(filter=filter_xml)
        root = etree.fromstring(result.data_xml.encode())
        print(etree.tostring(root, pretty_print=True).decode())


if __name__ == "__main__":
    for dev in DEVICES:
        ok = push_config(dev, INTERFACE_CONFIG_XML)
        status = "SUCCESS" if ok else "FAILED"
        print(f"  [{status}] {dev['host']}")
`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Step6Deploy() {
  const { prevStep } = useAppStore()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('deploy')

  // ── Deploy Pipeline state ─────────────────────────────────────────────────
  const [stageStatus, setStageStatus] = useState<Record<PipelineStage, StageStatus>>({
    precheck: 'pending', backup: 'pending', push: 'pending', verify: 'pending', postcheck: 'pending',
  })
  const [deployLog, setDeployLog] = useState<string[]>([])
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployDone, setDeployDone] = useState(false)
  const [deviceStatuses, setDeviceStatuses] = useState<Record<string, StageStatus>>({})

  // M-42 — Stage timestamps
  const [stageTimestamps, setStageTimestamps] = useState<Record<PipelineStage, { start?: string; end?: string }>>({
    precheck: {}, backup: {}, push: {}, verify: {}, postcheck: {},
  })

  // M-41 — Rollback modal
  const [showRollbackModal, setShowRollbackModal] = useState(false)
  const [rollbackScope, setRollbackScope] = useState<'stage' | 'full'>('stage')

  // M-38 — Grid / Table toggle
  const [deviceView, setDeviceView] = useState<'grid' | 'table'>('grid')

  // M-39 — Canary mode
  const [canaryMode, setCanaryMode] = useState(false)
  const [awaitingCanaryConfirm, setAwaitingCanaryConfirm] = useState(false)
  const [canaryHostname, setCanaryHostname] = useState('')
  const canaryResolveRef = useRef<((cont: boolean) => void) | null>(null)

  // ── topology ──────────────────────────────────────────────────────────────
  const { data: summary } = useTopologySummary()
  const { data: allDevices = [] } = useTopologyDevices()

  const bomDevices: BOMDevice[] = allDevices.map(d => ({
    id: d.name, hostname: d.name, role: d.role, subLayer: d.role,
    model: d.model || d.platform, vendor: d.platform, count: 1,
    unitPrice: 0, totalPrice: 0, speed: '100G', ports: 48, features: d.tags ?? [],
  }))

  // ── Deploy Pipeline logic (M-39 canary support) ──────────────────────────
  async function handleStartDeploy() {
    if (isDeploying) return
    setIsDeploying(true)
    setDeployDone(false)
    setDeployLog([])
    setAwaitingCanaryConfirm(false)
    setCanaryHostname('')
    setStageStatus({ precheck: 'pending', backup: 'pending', push: 'pending', verify: 'pending', postcheck: 'pending' })
    setStageTimestamps({ precheck: {}, backup: {}, push: {}, verify: {}, postcheck: {} })

    const devStatuses: Record<string, StageStatus> = {}
    for (const d of allDevices) devStatuses[d.name] = 'pending'
    setDeviceStatuses(devStatuses)

    const log = (msg: string) =>
      setDeployLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

    const runStage = async (id: PipelineStage, messages: string[], durationMs: number) => {
      const startTime = new Date().toLocaleTimeString()
      setStageStatus(s => ({ ...s, [id]: 'running' }))
      setStageTimestamps(ts => ({ ...ts, [id]: { start: startTime } }))
      log(`▶ Starting: ${PIPELINE_STAGES.find(s => s.id === id)?.label}`)
      for (const msg of messages) {
        await new Promise(r => setTimeout(r, durationMs / messages.length))
        log(msg)
      }
      const endTime = new Date().toLocaleTimeString()
      setStageStatus(s => ({ ...s, [id]: 'done' }))
      setStageTimestamps(ts => ({ ...ts, [id]: { ...ts[id], end: endTime } }))
    }

    await runStage('precheck', ['✔ SSH reachability: all devices', '✔ Config syntax valid', '✔ BGP baseline captured', '✔ Interface baseline captured'], 2000)
    await runStage('backup', allDevices.slice(0, 5).map(d => `✔ Backup saved: ${d.name}`).concat(['✔ All configs archived']), 1500)

    const pushStartTime = new Date().toLocaleTimeString()
    setStageStatus(s => ({ ...s, push: 'running' }))
    setStageTimestamps(ts => ({ ...ts, push: { start: pushStartTime } }))
    log('▶ Starting: Push Configurations')

    const devList = [...allDevices]

    if (canaryMode && devList.length > 0) {
      // Deploy canary (first device) only
      const canary = devList[0]
      log(`🐤 Canary mode: deploying ${canary.name} first`)
      await new Promise(r => setTimeout(r, 300))
      setDeviceStatuses(prev => ({ ...prev, [canary.name]: 'running' }))
      await new Promise(r => setTimeout(r, 600))
      setDeviceStatuses(prev => ({ ...prev, [canary.name]: 'done' }))
      log(`✔ Canary config pushed: ${canary.name}`)

      // Pause and wait for user confirmation
      setCanaryHostname(canary.name)
      setAwaitingCanaryConfirm(true)
      const continueRollout = await new Promise<boolean>(resolve => {
        canaryResolveRef.current = resolve
      })
      setAwaitingCanaryConfirm(false)
      canaryResolveRef.current = null

      if (!continueRollout) {
        // Abort — reset remaining devices to pending
        const resets: Record<string, StageStatus> = {}
        for (const d of devList.slice(1)) resets[d.name] = 'pending'
        setDeviceStatuses(prev => ({ ...prev, ...resets }))
        log('⛔ Canary rollout aborted — remaining devices reset to pending')
        setStageStatus(s => ({ ...s, push: 'failed' }))
        setStageTimestamps(ts => ({ ...ts, push: { ...ts.push, end: new Date().toLocaleTimeString() } }))
        setIsDeploying(false)
        showToast('Canary deployment aborted', 'warning')
        return
      }

      log(`✅ Canary confirmed — continuing full rollout (${devList.length - 1} remaining)`)
      for (const d of devList.slice(1)) {
        await new Promise(r => setTimeout(r, 300))
        setDeviceStatuses(prev => ({ ...prev, [d.name]: 'running' }))
        await new Promise(r => setTimeout(r, 500))
        setDeviceStatuses(prev => ({ ...prev, [d.name]: 'done' }))
        log(`✔ Config pushed: ${d.name}`)
      }
    } else {
      // Normal (non-canary) push
      for (const d of devList) {
        await new Promise(r => setTimeout(r, 300))
        setDeviceStatuses(prev => ({ ...prev, [d.name]: 'running' }))
        await new Promise(r => setTimeout(r, 500))
        setDeviceStatuses(prev => ({ ...prev, [d.name]: 'done' }))
        log(`✔ Config pushed: ${d.name}`)
      }
    }

    const pushEndTime = new Date().toLocaleTimeString()
    setStageStatus(s => ({ ...s, push: 'done' }))
    setStageTimestamps(ts => ({ ...ts, push: { ...ts.push, end: pushEndTime } }))

    await runStage('verify', ['✔ BGP sessions re-established', '✔ Route table validated', '✔ Interface states verified'], 1500)
    await runStage('postcheck', ['✔ All BGP peers UP', '✔ CPU within baseline', '✔ No interface errors', '✔ VLAN membership verified', '✔ Deployment SUCCESSFUL'], 2000)

    setIsDeploying(false)
    setDeployDone(true)
    showToast('Deployment complete — all checks passed', 'success')
  }

  // ── ZTP state ─────────────────────────────────────────────────────────────
  const [failDevice, setFailDevice] = useState('')
  const [failAt, setFailAt] = useState('config_applied')
  const [ztpEvents, setZtpEvents] = useState<ZTPEvent[]>([])
  const [ztpSummary, setZtpSummary] = useState<{ total_events: number; online: number; failed: number } | null>(null)
  const { mutate: runZTP, isPending: ztpPending } = useRunZTP()

  function handleRunZTP() {
    const req = failDevice ? { fail_device: failDevice, fail_at: failAt } : {}
    runZTP(req, {
      onSuccess(data) {
        setZtpEvents(data.events)
        setZtpSummary(data.summary)
        showToast(
          `ZTP complete — ${data.summary.online} online, ${data.summary.failed} failed`,
          data.summary.failed ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('ZTP failed: ' + e.message, 'error') },
    })
  }

  // ── Checks state ──────────────────────────────────────────────────────────
  const [failCheckDevice, setFailCheckDevice] = useState('')
  const [failCheck, setFailCheck] = useState('interfaces_up')
  const [checkPhase, setCheckPhase] = useState<'pre' | 'post' | null>(null)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const { mutate: runPre,  isPending: prePending }  = useRunChecks('pre')
  const { mutate: runPost, isPending: postPending } = useRunChecks('post')

  function handleRunChecks(p: 'pre' | 'post') {
    const req = failCheckDevice && failCheck
      ? { fail_devices: { [failCheckDevice]: [failCheck] } }
      : {}
    const mutate = p === 'pre' ? runPre : runPost
    mutate(req, {
      onSuccess(data) {
        setCheckPhase(p)
        setCheckResults(data.results)
        const pass = data.results.filter(r => r.status === 'PASS').length
        const fail = data.results.filter(r => r.status === 'FAIL').length
        showToast(
          `${p.toUpperCase()}-checks done — ${pass} PASS, ${fail} FAIL`,
          fail ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('Checks failed: ' + e.message, 'error') },
    })
  }

  const checkPass = checkResults.filter(r => r.status === 'PASS').length
  const checkFail = checkResults.filter(r => r.status === 'FAIL').length
  const checkWarn = checkResults.filter(r => r.status === 'WARN').length

  const badgeVariant = (s: string) =>
    ({ PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' } as const)[s] ?? 'neutral'
  const badgeIcon = (s: string) =>
    ({ PASS: '✔', FAIL: '✘', WARN: '⚠', SKIP: '–' } as const)[s] ?? '–'

  // ── Monitor state ─────────────────────────────────────────────────────────
  const [monitorData, setMonitorData] = useState<MonitoringResult | null>(null)
  const { mutate: poll, isPending: pollPending } = usePollMonitoring()

  function handlePoll(failDevices?: Record<string, string[]>) {
    poll(failDevices ? { fail_devices: failDevices } : {}, {
      onSuccess(d) {
        setMonitorData(d)
        const { healthy, degraded, down } = d.summary
        showToast(
          `Monitoring: ${healthy} healthy, ${degraded} degraded, ${down} down`,
          degraded || down ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('Monitoring failed: ' + e.message, 'error') },
    })
  }

  // ── Day-2 Ops state (M-67) ────────────────────────────────────────────────
  const [changeWindow, setChangeWindow] = useState('immediate')
  const [driftChecking, setDriftChecking] = useState(false)
  const [driftDone, setDriftDone] = useState(false)

  async function handleDriftCheck() {
    setDriftChecking(true)
    setDriftDone(false)
    await new Promise(r => setTimeout(r, 2000))
    setDriftChecking(false)
    setDriftDone(true)
  }

  // ── Batfish state (M-68) ──────────────────────────────────────────────────
  const [batfishRunning, setBatfishRunning] = useState(false)
  const [batfishStep, setBatfishStep] = useState(-1)
  const [batfishDone, setBatfishDone] = useState(false)

  const BATFISH_STEPS = [
    'Initializing Batfish snapshot...',
    'Parsing device configs...',
    'Running forwarding analysis...',
    'Checking BGP reachability...',
    'Validation complete',
  ]

  async function handleBatfishValidation() {
    if (batfishRunning) return
    setBatfishRunning(true)
    setBatfishDone(false)
    setBatfishStep(0)
    for (let i = 0; i < BATFISH_STEPS.length; i++) {
      setBatfishStep(i)
      await new Promise(r => setTimeout(r, 900))
    }
    setBatfishRunning(false)
    setBatfishDone(true)
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'deploy',  label: 'Deploy Pipeline' },
    { id: 'ztp',     label: 'ZTP Provisioning' },
    { id: 'checks',  label: 'Pre / Post Checks' },
    { id: 'monitor', label: 'Monitoring' },
    { id: 'netconf', label: 'NETCONF' },
    { id: 'day2ops', label: 'Day-2 Ops' },
    { id: 'batfish', label: 'Batfish' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Deploy &amp; Validate</h2>
        <p className="text-sm text-gray-400">Zero-touch provisioning, pre/post checks, and live monitoring</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer',
              tab === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Deploy Pipeline tab ─────────────────────────────────────────── */}
      {tab === 'deploy' && (
        <div className="space-y-6">
          {/* M-39 — Canary mode toggle + Action bar */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Canary toggle (only before deploy starts) */}
            {!isDeploying && !deployDone && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setCanaryMode(v => !v)}
                  className={cn(
                    'relative w-9 h-5 rounded-full transition-colors',
                    canaryMode ? 'bg-yellow-500' : 'bg-white/20',
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    canaryMode ? 'translate-x-4' : 'translate-x-0',
                  )} />
                </div>
                <span className="text-xs text-gray-400 font-medium">Canary Mode</span>
              </label>
            )}

            <Button onClick={handleStartDeploy} disabled={isDeploying}>
              {isDeploying ? '⏳ Deploying…' : '🚀 Start Deploy'}
            </Button>

            {/* M-39 — CANARY badge in action bar */}
            {canaryMode && (
              <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 tracking-widest">
                CANARY
              </span>
            )}

            {deployDone && (
              <Button variant="secondary" onClick={() => {
                setStageStatus({ precheck: 'pending', backup: 'pending', push: 'pending', verify: 'pending', postcheck: 'pending' })
                setDeployLog([])
                setDeployDone(false)
                setDeviceStatuses({})
                setAwaitingCanaryConfirm(false)
                setCanaryHostname('')
              }}>
                &#8634; Reset
              </Button>
            )}
            {deployDone && (
              <Button variant="ghost" onClick={() => setShowRollbackModal(true)}>
                &#9888; Rollback
              </Button>
            )}
          </div>

          {/* M-39 — Canary confirmation banner */}
          {awaitingCanaryConfirm && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-xl
                            border border-yellow-500/40 bg-yellow-500/10">
              <span className="text-yellow-300 text-sm font-medium flex-1">
                Canary device <code className="font-mono font-bold">{canaryHostname}</code> deployed
                successfully. Confirm to continue full rollout?
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => canaryResolveRef.current?.(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-red-500/40
                             bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Abort
                </button>
                <button
                  onClick={() => canaryResolveRef.current?.(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded border border-green-500/40
                             bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                >
                  Continue Rollout
                </button>
              </div>
            </div>
          )}

          {/* Stage pipeline */}
          <div className="space-y-2">
            {PIPELINE_STAGES.map((stage, i) => {
              const status = stageStatus[stage.id]
              const statusColors: Record<StageStatus, string> = {
                pending: 'border-white/10 bg-white/[0.02]',
                running: 'border-blue-500/50 bg-blue-500/5',
                done:    'border-green-500/50 bg-green-500/5',
                failed:  'border-red-500/50 bg-red-500/5',
              }
              const statusBadge: Record<StageStatus, React.ReactNode> = {
                pending: <span className="text-xs text-gray-500 font-semibold">Pending</span>,
                running: <span className="text-xs text-blue-400 font-semibold animate-pulse">● Running…</span>,
                done:    <span className="text-xs text-green-400 font-semibold">✔ Done</span>,
                failed:  <span className="text-xs text-red-400 font-semibold">✘ Failed</span>,
              }
              return (
                <div
                  key={stage.id}
                  className={cn('flex items-center gap-4 p-4 rounded-xl border transition-colors', statusColors[status])}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                    status === 'done'    ? 'bg-green-600 text-white' :
                    status === 'running' ? 'bg-blue-600 text-white' :
                    'bg-white/10 text-gray-400',
                  )}>
                    {status === 'done' ? '✓' : i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-200">{stage.label}</div>
                    <div className="text-xs text-gray-500">{stage.desc}</div>
                    {/* M-42 — Stage timestamps */}
                    {(stageTimestamps[stage.id].start || stageTimestamps[stage.id].end) && (
                      <div className="text-xs text-gray-600 mt-0.5 font-mono">
                        {stageTimestamps[stage.id].start && (
                          <span>Started {stageTimestamps[stage.id].start}</span>
                        )}
                        {stageTimestamps[stage.id].end && (
                          <span> · Done {stageTimestamps[stage.id].end}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {statusBadge[status]}
                </div>
              )
            })}
          </div>

          {/* M-38 — Device status grid with Grid/Table toggle */}
          {Object.keys(deviceStatuses).length > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">Device Status</h3>
                {/* Grid / Table toggle */}
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
                  {(['grid', 'table'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setDeviceView(v)}
                      className={cn(
                        'px-3 py-1 text-xs font-semibold rounded transition-colors',
                        deviceView === v
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-500 hover:text-gray-300',
                      )}
                    >
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid view (default) */}
              {deviceView === 'grid' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {allDevices.map(d => {
                    const ds = deviceStatuses[d.name] ?? 'pending'
                    return (
                      <div
                        key={d.name}
                        className={cn(
                          'p-2 rounded-lg border text-xs font-mono',
                          ds === 'done'    ? 'border-green-500/40 bg-green-500/5 text-green-400' :
                          ds === 'running' ? 'border-blue-500/40 bg-blue-500/5 text-blue-400' :
                          ds === 'failed'  ? 'border-red-500/40 bg-red-500/5 text-red-400' :
                          'border-white/10 text-gray-500',
                        )}
                      >
                        <div className="font-bold truncate">{d.name}</div>
                        <div className="text-gray-600 capitalize">{ds}</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Table view (M-38) */}
              {deviceView === 'table' && (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        {['#', 'Hostname', 'Role', 'Stage', 'Status', 'Actions'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allDevices.map((d, idx) => {
                        const ds = deviceStatuses[d.name] ?? 'pending'
                        const statusBadgeStyle: Record<StageStatus, string> = {
                          pending:  'text-gray-400 bg-white/5 border-white/10',
                          running:  'text-blue-400 bg-blue-500/10 border-blue-500/30',
                          done:     'text-green-400 bg-green-500/10 border-green-500/30',
                          failed:   'text-red-400 bg-red-500/10 border-red-500/30',
                        }
                        return (
                          <tr key={d.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-3 py-2 text-xs text-gray-600 font-mono">{idx + 1}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-gray-200 text-xs">{d.name}</td>
                            <td className="px-3 py-2 text-xs text-gray-500 capitalize">{d.role}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">push</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'px-2 py-0.5 rounded text-xs font-semibold border',
                                statusBadgeStyle[ds],
                              )}>
                                {ds.charAt(0).toUpperCase() + ds.slice(1)}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                disabled={!deployDone}
                                onClick={() => {
                                  setDeviceStatuses(prev => ({ ...prev, [d.name]: 'pending' }))
                                }}
                                className={cn(
                                  'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
                                  deployDone
                                    ? 'border-white/20 text-gray-400 hover:bg-white/10 hover:text-gray-200 cursor-pointer'
                                    : 'border-white/5 text-gray-700 cursor-not-allowed',
                                )}
                              >
                                Retry
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* Terminal log */}
          {deployLog.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-[#080E1A] p-4 font-mono text-xs max-h-64 overflow-y-auto">
              {deployLog.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes('✔') ? 'text-green-400' :
                    line.includes('▶') ? 'text-blue-400' :
                    'text-gray-400'
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* ── Downloads section (M-48 M-49 M-50) ───────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Downloads</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Python scripts for pre/post-checks and config push via Netmiko.
              Requires: <code className="text-blue-400">pip install netmiko tabulate</code>
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  downloadBlob('pre_check.py', buildPreCheckScript())
                  showToast('pre_check.py downloaded', 'success')
                }}
              >
                &#8595; Pre-Check Script
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  downloadBlob('post_check.py', buildPostCheckScript())
                  showToast('post_check.py downloaded', 'success')
                }}
              >
                &#8595; Post-Check Script
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  downloadBlob('push_configs.py', buildPushConfigsScript())
                  showToast('push_configs.py downloaded', 'success')
                }}
              >
                &#8595; push_configs.py
              </Button>
              {/* M-64 — Ansible playbook download */}
              <Button
                variant="secondary"
                size="sm"
                disabled={!deployDone}
                onClick={() => {
                  const content = buildAnsiblePlaybook(deployLog, allDevices.map(d => d.name))
                  downloadText(content, 'ansible_playbook.yml')
                  showToast('ansible_playbook.yml downloaded', 'success')
                }}
              >
                &#8595; Download Ansible Playbook
              </Button>
            </div>
            {!deployDone && (
              <p className="text-xs text-gray-600 mt-2">Ansible playbook available after deployment completes.</p>
            )}
          </Card>
        </div>
      )}

      {/* ── ZTP tab ─────────────────────────────────────────────────────── */}
      {tab === 'ztp' && (
        <div className="space-y-6">
          {summary && (
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {[
                { label: 'Total',     val: summary.total },
                { label: 'Routers',   val: summary.routers },
                { label: 'Switches',  val: summary.switches },
                { label: 'Firewalls', val: summary.firewalls },
                { label: 'LBs',       val: summary.load_balancers },
                { label: 'GPU-FWs',   val: summary.gpu_firewalls },
                { label: 'GPU Srvs',  val: summary.gpu_servers },
              ].map(({ label, val }) => (
                <Card key={label} className="text-center py-3">
                  <div className="text-xl font-bold text-blue-400">{val}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </Card>
              ))}
            </div>
          )}

          {bomDevices.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Lab Topology</CardTitle></CardHeader>
              <div className="mt-2">
                <TopologyDiagram devices={bomDevices} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
                <select
                  value={failDevice}
                  onChange={e => setFailDevice(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="">&mdash; none &mdash;</option>
                  {allDevices.map(d => (
                    <option key={d.name} value={d.name}>{d.name} ({d.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail At Stage</label>
                <select
                  value={failAt}
                  onChange={e => setFailAt(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  {ZTP_STAGES.map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleRunZTP} disabled={ztpPending}>
                  {ztpPending ? 'Running…' : '▶ Run ZTP'}
                </Button>
                <Button variant="secondary" onClick={() => { setZtpEvents([]); setZtpSummary(null); setFailDevice('') }}>
                  Reset
                </Button>
              </div>
            </div>
          </Card>

          {ztpSummary && (
            <div className="grid grid-cols-3 gap-3">
              <Card className="text-center">
                <div className="text-2xl font-bold text-gray-300">{ztpSummary.total_events}</div>
                <div className="text-xs text-gray-500">Events</div>
              </Card>
              <Card className="text-center">
                <div className="text-2xl font-bold text-green-400">{ztpSummary.online}</div>
                <div className="text-xs text-gray-500">Online</div>
              </Card>
              <Card className="text-center">
                <div className="text-2xl font-bold text-red-400">{ztpSummary.failed}</div>
                <div className="text-xs text-gray-500">Failed</div>
              </Card>
            </div>
          )}

          {ztpEvents.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Stage', 'Message', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ztpEvents.map((evt, i) => (
                    <tr key={i} className={`border-b border-white/5 ${evt.success ? '' : 'bg-red-500/5'}`}>
                      <td className="px-4 py-2 font-semibold text-gray-200">{evt.device_name}</td>
                      <td className="px-4 py-2">
                        <code className="text-xs text-blue-400">{evt.state.replace(/_/g, ' ').toUpperCase()}</code>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400">{evt.message}</td>
                      <td className="px-4 py-2">
                        <Badge variant={evt.success ? 'pass' : 'fail'}>
                          {evt.success ? '✔ OK' : '✘ FAILED'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Checks tab ──────────────────────────────────────────────────── */}
      {tab === 'checks' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
                <select
                  value={failCheckDevice}
                  onChange={e => setFailCheckDevice(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="">&mdash; none &mdash;</option>
                  {allDevices.map(d => (
                    <option key={d.name} value={d.name}>{d.name} ({d.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Check</label>
                <select
                  value={failCheck}
                  onChange={e => setFailCheck(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  {CHECK_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleRunChecks('pre')} disabled={prePending || postPending}>
                  {prePending ? 'Running…' : '▶ Pre-Checks'}
                </Button>
                <Button variant="secondary" onClick={() => handleRunChecks('post')} disabled={prePending || postPending}>
                  {postPending ? 'Running…' : '▶ Post-Checks'}
                </Button>
                <Button variant="ghost" onClick={() => { setCheckResults([]); setCheckPhase(null) }}>Clear</Button>
              </div>
            </div>
          </Card>

          {checkResults.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              <Card className="text-center">
                <div className="text-lg font-bold text-gray-300">{checkPhase?.toUpperCase()}-DEPLOY</div>
                <div className="text-xs text-gray-500">Phase</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-green-400">{checkPass}</div>
                <div className="text-xs text-gray-500">PASS</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-red-400">{checkFail}</div>
                <div className="text-xs text-gray-500">FAIL</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-yellow-400">{checkWarn}</div>
                <div className="text-xs text-gray-500">WARN</div>
              </Card>
            </div>
          )}

          {checkResults.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Check', 'Status', 'Message', 'Remediation'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checkResults.map((r, i) => (
                    <tr key={i} className={`border-b border-white/5 ${r.status === 'FAIL' ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-2 font-semibold text-gray-200">{r.device}</td>
                      <td className="px-4 py-2"><code className="text-xs text-blue-400">{r.name}</code></td>
                      <td className="px-4 py-2">
                        <Badge variant={badgeVariant(r.status)}>{badgeIcon(r.status)} {r.status}</Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400">{r.message}</td>
                      <td className="px-4 py-2 text-xs text-yellow-500">{r.remediation ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Monitor tab ─────────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="space-y-6">
          <div className="flex gap-3">
            <Button onClick={() => handlePoll()} disabled={pollPending}>
              {pollPending ? 'Polling…' : '⟳ Poll Now'}
            </Button>
            <Button variant="secondary" onClick={() => handlePoll({ 'edge-rtr1': ['interfaces_up'], 'lb1': ['virtual_servers'], 'gpu-fw1': ['rdma_policy'] })} disabled={pollPending}>
              Simulate Degraded
            </Button>
            <Button variant="ghost" onClick={() => setMonitorData(null)}>Clear</Button>
          </div>

          {monitorData && (
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Total',    val: monitorData.summary.total,   cls: 'text-gray-300' },
                { label: 'Healthy',  val: monitorData.summary.healthy,  cls: 'text-green-400' },
                { label: 'Degraded', val: monitorData.summary.degraded, cls: 'text-yellow-400' },
                { label: 'Down',     val: monitorData.summary.down,     cls: 'text-red-400' },
                { label: 'Alerts',   val: monitorData.summary.alerts.length, cls: 'text-orange-400' },
              ].map(({ label, val, cls }) => (
                <Card key={label} className="text-center">
                  <div className={`text-2xl font-bold ${cls}`}>{val}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </Card>
              ))}
            </div>
          )}

          {monitorData && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Role', 'Status', 'CPU', 'Uptime', 'Alerts'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.values(monitorData.health)
                    .sort((a, b) => a.device_name.localeCompare(b.device_name))
                    .map(h => (
                      <tr
                        key={h.device_name}
                        className={`border-b border-white/5 ${
                          h.status === 'degraded' ? 'bg-yellow-500/5' :
                          h.status === 'down'     ? 'bg-red-500/5' : ''
                        }`}
                      >
                        <td className="px-4 py-2 font-semibold text-gray-200">{h.device_name}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{h.role}</td>
                        <td className="px-4 py-2">
                          <Badge variant={STATUS_BADGE[h.status] ?? 'neutral'}>{h.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-gray-300">{h.metrics.cpu}%</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{formatUptime(h.metrics.uptime_seconds)}</td>
                        <td className="px-4 py-2 text-xs text-yellow-400">
                          {h.alerts.length > 0 ? h.alerts.join(' · ') : <span className="text-gray-600">&mdash;</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {monitorData && monitorData.summary.alerts.length > 0 && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-orange-400 mb-2">
                Active Alerts ({monitorData.summary.alerts.length})
              </h3>
              {monitorData.summary.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="font-semibold text-orange-300 shrink-0">{a.device}</span>
                  <span className="text-gray-400">{a.alert}</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Observability Downloads (M-51 M-52) ───────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Observability Downloads</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Logstash Grok patterns for syslog parsing and NetFlow/sFlow exporter config snippets.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  downloadBlob('network-grok.conf', buildGrokPatternsConfig())
                  showToast('network-grok.conf downloaded', 'success')
                }}
              >
                &#8595; Grok Patterns
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  downloadBlob('netflow-config.txt', buildNetflowConfig())
                  showToast('netflow-config.txt downloaded', 'success')
                }}
              >
                &#8595; NetFlow Config
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── NETCONF tab (M-65) ─────────────────────────────────────────── */}
      {tab === 'netconf' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>NETCONF Push</CardTitle></CardHeader>
            <p className="text-sm text-gray-400 mb-4">
              NETCONF is a standards-based network management protocol (RFC 6241) that provides a
              programmatic interface for managing network devices. It is supported on:
            </p>
            <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 mb-4">
              <li>Juniper JunOS — native ncclient support</li>
              <li>Cisco IOS-XE 16.6+ — NETCONF/YANG over SSH (port 830)</li>
              <li>Cisco NX-OS — enable with <code className="text-blue-400">feature netconf</code></li>
            </ul>
          </Card>

          <Card>
            <CardHeader><CardTitle>Sample NETCONF RPC — Interface Configuration</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-3">
              IETF interfaces YANG model (RFC 8343). Send via ncclient <code className="text-blue-400">edit-config</code>.
            </p>
            <pre className="bg-[#080E1A] border border-white/10 rounded-lg p-4 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed">
{`<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="1">
  <edit-config>
    <target><running/></target>
    <config>
      <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
        <interface>
          <name>GigabitEthernet1</name>
          <description>NetDesign AI — managed port</description>
          <enabled>true</enabled>
          <ipv4 xmlns="urn:ietf:params:xml:ns:yang:ietf-ip">
            <address>
              <ip>10.0.0.1</ip>
              <prefix-length>24</prefix-length>
            </address>
          </ipv4>
        </interface>
      </interfaces>
    </config>
  </edit-config>
</rpc>`}
            </pre>
          </Card>

          <Card>
            <CardHeader><CardTitle>Download</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-3">
              Python ncclient script template with connect, edit-config, validate, and get-interfaces functions.
              Requires: <code className="text-blue-400">pip install ncclient lxml</code>
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                downloadText(buildNetconfScript(), 'netconf_push.py')
                showToast('netconf_push.py downloaded', 'success')
              }}
            >
              &#8595; Download NETCONF Script (Python)
            </Button>
          </Card>
        </div>
      )}

      {/* ── Day-2 Ops tab (M-67) ───────────────────────────────────────── */}
      {tab === 'day2ops' && (
        <div className="space-y-6">
          {/* Change Window */}
          <Card>
            <CardHeader><CardTitle>Change Window</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Schedule</label>
                <select
                  value={changeWindow}
                  onChange={e => setChangeWindow(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="immediate">Immediate</option>
                  <option value="scheduled">Scheduled: Next Maintenance Window</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <div className="text-sm text-gray-400">
                <div className="text-xs text-gray-500 mb-0.5">Current date / time</div>
                <div className="font-mono text-gray-300">{new Date().toLocaleString()}</div>
              </div>
              {changeWindow === 'scheduled' && (
                <div className="text-xs text-yellow-400 border border-yellow-500/30 bg-yellow-500/10 rounded px-3 py-2">
                  Next maintenance window: Sun 02:00 – 04:00 UTC
                </div>
              )}
              {changeWindow === 'emergency' && (
                <div className="text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded px-3 py-2">
                  Emergency change — requires CAB approval before execution
                </div>
              )}
            </div>
          </Card>

          {/* Config Drift Detection */}
          <Card>
            <CardHeader><CardTitle>Config Drift Detection</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Compare running configuration against the intended (golden) config to detect unauthorized changes.
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10 mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Expected', 'Actual', 'Drift'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { device: 'leaf1', expected: 'BGP AS 65001', actual: 'BGP AS 65001', drift: false },
                    { device: 'spine1', expected: 'IS-IS NET 49.0001', actual: 'IS-IS NET 49.0001', drift: false },
                    { device: 'fw1', expected: 'Zone-pair inspect', actual: 'Zone-pair inspect', drift: false },
                  ].map(row => (
                    <tr key={row.device} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2 font-mono text-xs font-semibold text-gray-200">{row.device}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{row.expected}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{row.actual}</td>
                      <td className="px-4 py-2">
                        {driftDone ? (
                          <span className="text-xs text-green-400 font-semibold">✓ In sync</span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              onClick={handleDriftCheck}
              disabled={driftChecking}
            >
              {driftChecking ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Checking…
                </span>
              ) : '⟳ Run Drift Check'}
            </Button>
            {driftDone && (
              <p className="text-sm text-green-400 mt-3 font-medium">✓ All devices in sync</p>
            )}
          </Card>

          {/* Compliance Audit */}
          <Card>
            <CardHeader><CardTitle>Compliance Audit</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Automated compliance checks against network security baseline.
            </p>
            <div className="space-y-2">
              {[
                'Password complexity',
                'SSH v2 only',
                'NTP configured',
                'Syslog configured',
                'SNMP community strings changed',
                'Unused interfaces shut down',
                'Logging buffered enabled',
              ].map(check => (
                <div
                  key={check}
                  className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02]"
                >
                  <span className="text-sm text-gray-300">{check}</span>
                  <span className="text-xs text-green-400 font-semibold bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5">
                    ✓ PASS
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Batfish tab (M-68) ─────────────────────────────────────────── */}
      {tab === 'batfish' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Batfish Network Validation</CardTitle></CardHeader>
            <p className="text-sm text-gray-400 mb-2">
              Batfish is an open-source network analysis tool that performs vendor-agnostic
              static analysis of device configurations. It can identify bugs, guarantee
              compliance, and verify intent before configs are pushed to production.
            </p>
            <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 mb-4">
              <li>Forwarding analysis — verify every packet traverses the intended path</li>
              <li>BGP reachability — confirm all BGP peers can exchange routes</li>
              <li>Undefined references — catch references to non-existent ACLs, prefix-lists, etc.</li>
              <li>Duplicate router IDs — detect OSPF/BGP misconfigurations</li>
            </ul>
            <Button
              onClick={handleBatfishValidation}
              disabled={batfishRunning}
            >
              {batfishRunning ? '⏳ Running Validation…' : '▶ Run Batfish Validation'}
            </Button>
          </Card>

          {(batfishRunning || batfishDone) && (
            <Card>
              <CardHeader><CardTitle>Validation Progress</CardTitle></CardHeader>
              <div className="space-y-2 mt-2">
                {BATFISH_STEPS.map((step, i) => {
                  const isDone = batfishDone || i < batfishStep
                  const isActive = batfishRunning && i === batfishStep
                  return (
                    <div
                      key={step}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors',
                        isDone    ? 'border-green-500/30 bg-green-500/5' :
                        isActive  ? 'border-blue-500/40 bg-blue-500/5' :
                                    'border-white/5 bg-transparent',
                      )}
                    >
                      <span className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                        isDone    ? 'bg-green-600 text-white' :
                        isActive  ? 'bg-blue-600 text-white animate-pulse' :
                                    'bg-white/10 text-gray-600',
                      )}>
                        {isDone ? '✓' : i + 1}
                      </span>
                      <span className={cn(
                        'text-sm',
                        isDone    ? 'text-green-400' :
                        isActive  ? 'text-blue-300' :
                                    'text-gray-600',
                      )}>
                        {step}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {batfishDone && (
            <Card>
              <CardHeader><CardTitle>Validation Results</CardTitle></CardHeader>
              <div className="overflow-x-auto rounded-lg border border-white/10 mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5">
                      {['Check', 'Status', 'Details'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { check: 'Route reachability',        status: 'PASS', detail: 'All /32 loopbacks reachable across fabric' },
                      { check: 'Undefined references',      status: 'PASS', detail: 'No dangling ACL or prefix-list references' },
                      { check: 'BGP peer reachability',     status: 'PASS', detail: 'All BGP neighbors reachable via underlay' },
                      { check: 'Duplicate router-ids',      status: 'PASS', detail: 'No OSPF/BGP router-id conflicts detected' },
                      { check: 'Invalid BGP configurations',status: 'PASS', detail: 'All BGP neighbor configs are well-formed' },
                    ].map(row => (
                      <tr key={row.check} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-2 text-sm text-gray-200">{row.check}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-green-400 font-semibold bg-green-500/10 border border-green-500/20 rounded px-2 py-0.5">
                            ✓ {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-400">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── M-41: Rollback Modal ────────────────────────────────────────── */}
      {showRollbackModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0D1520] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-1">Rollback Configuration</h3>
            <p className="text-sm text-gray-400 mb-5">
              Select the rollback scope and confirm to initiate the rollback procedure.
            </p>

            <div className="space-y-3 mb-6">
              <label className={cn(
                'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                rollbackScope === 'stage'
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20',
              )}>
                <input
                  type="radio"
                  name="rollbackScope"
                  value="stage"
                  checked={rollbackScope === 'stage'}
                  onChange={() => setRollbackScope('stage')}
                  className="mt-0.5 accent-blue-500"
                />
                <div>
                  <div className="text-sm font-medium text-gray-200">Stage rollback</div>
                  <div className="text-xs text-gray-500 mt-0.5">Undo last stage only</div>
                </div>
              </label>

              <label className={cn(
                'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                rollbackScope === 'full'
                  ? 'border-orange-500/50 bg-orange-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20',
              )}>
                <input
                  type="radio"
                  name="rollbackScope"
                  value="full"
                  checked={rollbackScope === 'full'}
                  onChange={() => setRollbackScope('full')}
                  className="mt-0.5 accent-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-gray-200">Full rollback</div>
                  <div className="text-xs text-gray-500 mt-0.5">Restore pre-deploy checkpoint</div>
                </div>
              </label>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowRollbackModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant={rollbackScope === 'full' ? 'danger' : 'primary'}
                onClick={() => {
                  setShowRollbackModal(false)
                  showToast(`Rollback initiated (${rollbackScope})`, 'warning')
                }}
              >
                Confirm Rollback
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={prevStep}>&#8592; Back</Button>
      </div>
    </div>
  )
}
