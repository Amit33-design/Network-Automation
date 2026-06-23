import React, { useState, useRef, useMemo, useEffect } from 'react'
import { useTopologySummary, useTopologyDevices } from '@/hooks/useTopology'
import { useRunZTP } from '@/hooks/useZTP'
import { useRunChecks } from '@/hooks/useChecks'
import { usePollMonitoring, useMetricsSummary } from '@/hooks/useMonitoring'
import { useConfigDrift, useConfigRemediation } from '@/hooks/useConfigDrift'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { useBackendMode } from '@/components/BackendToggle'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import { formatUptime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { genGNMICCollectorConfig, genTelegrafGNMIConfig, genPrometheusAlertRules, genGrafanaDashboardJSON, genSNMPExporterConfig, genSNMPPrometheusJob } from '@/lib/telemetry-gen'
import { useTroubleshoot } from '@/hooks/useTroubleshoot'
import { runComplianceScan, exportComplianceReport } from '@/lib/compliance-scan'
import type { ComplianceScanResult } from '@/lib/compliance-scan'
import { generateRollbackPlan, rollbackPlanToText, rollbackTimestamp } from '@/lib/rollback'
import { runClosedLoop, closedLoopToText, type ClosedLoopResult } from '@/lib/closed-loop'
import { AlertsPanel } from '@/components/AlertsPanel'
import { RcaPanel } from '@/components/RcaPanel'
import { LiveProgressFeed } from '@/components/LiveProgressFeed'
import { createWatcher, exportCronTab, exportSystemdTimer, exportScanScript, simulateScanHistory, INTERVAL_PRESETS, type WatcherConfig, type ScanType, type ScanAction, type ScanHistoryEntry } from '@/lib/scheduled-scans'
import type { ZTPEvent, BOMDevice, CheckResult, MonitoringResult, ZTPResult, ChecksResult, DeviceMetrics, MetricsSummary, ConfigDriftResponse, ConfigDriftDevice, ConfigRemediationResponse, RemediationDeviceInput, TroubleshootResult } from '@/types'

const STATUS_BADGE: Record<string, 'pass' | 'warn' | 'fail' | 'neutral'> = {
  healthy: 'pass', degraded: 'warn', down: 'fail', unknown: 'neutral',
}

type Tab = 'deploy' | 'ztp' | 'checks' | 'monitor' | 'netconf' | 'day2ops' | 'troubleshoot' | 'batfish'

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

// ── ZTP simulation state machine ──────────────────────────────────────────────

const ZTP_SIM_STAGES = [
  { id: 'REGISTERED',        label: 'Registered',         icon: '📋' },
  { id: 'POWERED_ON',        label: 'Powered On',          icon: '⚡' },
  { id: 'DHCP_ACK',          label: 'DHCP ACK',            icon: '🌐' },
  { id: 'SCRIPT_DOWNLOADED', label: 'Script Downloaded',   icon: '📥' },
  { id: 'CONFIG_APPLYING',   label: 'Config Applying',     icon: '⚙️' },
  { id: 'CALLBACK_RECEIVED', label: 'Callback Received',   icon: '📡' },
  { id: 'VERIFIED',          label: 'Verified',            icon: '✔' },
  { id: 'ONLINE',            label: 'Online',              icon: '🟢' },
]

const ZTP_STAGE_MSGS: Record<string, string> = {
  REGISTERED:        'Device MAC registered in DHCP/ZTP database',
  POWERED_ON:        'Device boot sequence initiated, BIOS POST complete',
  DHCP_ACK:          'DHCP lease acquired, management IP assigned',
  SCRIPT_DOWNLOADED: 'ZTP bootstrap script downloaded via TFTP/HTTP',
  CONFIG_APPLYING:   'Day-0 config being pushed via CLI/NETCONF',
  CALLBACK_RECEIVED: 'Device sent ZTP completion callback to server',
  VERIFIED:          'SSH reachability + hostname + mgmt ACL verified',
  ONLINE:            'Device fully provisioned and in production state',
}

// ── Simulated gNMI metrics (demo mode) ───────────────────────────────────────

function _seed(name: string): number {
  return name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
}

function _pseudoRandom(seed: number, offset = 0): number {
  const x = Math.sin(seed + offset) * 10000
  return x - Math.floor(x)
}

function simulateMonitoringMetrics(
  devList: Array<{name: string; role: string}>,
  tick: number,
): MetricsSummary {
  const devices: Record<string, DeviceMetrics> = {}
  for (const { name } of devList) {
    const s = _seed(name)
    const isSpine    = name.includes('spine')
    const isGpu      = name.includes('gpu')
    const isFw       = name.includes('fw')
    const isAccess   = name.includes('access') || name.includes('vedge')
    const baseC = isGpu ? 62 : isSpine ? 42 : isFw ? 28 : 22
    const r0 = _pseudoRandom(s, tick)
    const r1 = _pseudoRandom(s + 1, tick)
    const r2 = _pseudoRandom(s + 2, tick)
    const cpu = Math.min(99, Math.max(1, baseC + (r0 - 0.5) * baseC * 0.15))
    const mem = Math.min(99, Math.max(5, 50 + (r1 - 0.5) * 30))
    const bgp = isAccess ? 0 : Math.floor(2 + r2 * 4)
    devices[name] = {
      cpu_util:             Math.round(cpu * 10) / 10,
      mem_util:             Math.round(mem * 10) / 10,
      interface_errors_in:  Math.floor(_pseudoRandom(s + 3, tick) * 8),
      interface_errors_out: Math.floor(_pseudoRandom(s + 4, tick) * 4),
      bgp_sessions_up:      bgp,
      bgp_prefixes_received: bgp * Math.floor(100 + _pseudoRandom(s + 5, tick) * 500),
      pfc_drops:            isGpu ? Math.floor(_pseudoRandom(s + 6, tick) * 300) : 0,
      throughput_mbps:      Math.round((isSpine ? 8000 : 2000) * (0.4 + _pseudoRandom(s + 7, tick) * 0.6)),
    }
  }
  return { timestamp: new Date().toISOString(), devices }
}

// ── SVG Arc Gauge helper ──────────────────────────────────────────────────────

function ArcGauge({ value, max = 100, color, label, size = 80 }: {
  value: number; max?: number; color: string; label: string; size?: number
}) {
  const pct    = Math.min(1, Math.max(0, value / max))
  const radius = (size / 2) - 8
  const circ   = 2 * Math.PI * radius
  const arc    = circ * 0.75
  const rot    = -225
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={radius}
          fill="none" stroke="#1f2937" strokeWidth={6}
          strokeDasharray={`${arc} ${circ - arc}`}
          strokeDashoffset={0} strokeLinecap="round"
          transform={`rotate(${rot} ${size/2} ${size/2})`} />
        <circle cx={size/2} cy={size/2} r={radius}
          fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${pct * arc} ${circ - pct * arc}`}
          strokeDashoffset={0} strokeLinecap="round"
          transform={`rotate(${rot} ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
        <text x={size/2} y={size/2 + 4} textAnchor="middle"
          fontSize={size * 0.18} fontWeight="bold" fill={color}>
          {Math.round(value)}{max === 100 ? '%' : ''}
        </text>
      </svg>
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}

// ── Mini sparkline (8 points) ─────────────────────────────────────────────────

function Sparkline({ values, color = '#60A5FA' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null
  const w = 80; const h = 28
  const mn = Math.min(...values); const mx = Math.max(...values) || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - mn) / (mx - mn || 1)) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function simulateZTPResult(
  devList: Array<{name: string; role: string}>,
  failDevice: string,
  failAt: string,
): ZTPResult {
  const events: ZTPEvent[] = []
  const results: Record<string, string> = {}
  let online = 0, failed = 0
  const failStageIdx = ZTP_SIM_STAGES.findIndex(s => s.id === failAt.toUpperCase())

  for (const dev of devList) {
    let devFailed = false
    for (let i = 0; i < ZTP_SIM_STAGES.length; i++) {
      const stage = ZTP_SIM_STAGES[i]
      const isFailHere = dev.name === failDevice && i === (failStageIdx >= 0 ? failStageIdx : -1)
      if (isFailHere) {
        events.push({
          device_name: dev.name,
          state: stage.id.toLowerCase(),
          message: `[FAULT INJECTED] Simulated failure at ${stage.label} stage`,
          success: false,
          timestamp: new Date().toISOString(),
        })
        devFailed = true
        break
      }
      events.push({
        device_name: dev.name,
        state: stage.id.toLowerCase(),
        message: ZTP_STAGE_MSGS[stage.id] ?? stage.label,
        success: true,
        timestamp: new Date().toISOString(),
      })
    }
    if (devFailed) { failed++; results[dev.name] = 'FAILED' }
    else { online++;  results[dev.name] = 'ONLINE' }
  }
  return { results, events, summary: { total_events: events.length, online, failed } }
}

// ── Checks simulation ─────────────────────────────────────────────────────────

const CHECK_TEMPLATES = [
  // connectivity
  { cat: 'Connectivity', name: 'ICMP Reachability',   ok: (h: string) => `Ping ${h} 0% loss, RTT 0.8ms`   },
  { cat: 'Connectivity', name: 'SSH Access',           ok: (h: string) => `SSH ${h}:22 ok in 0.3s`          },
  { cat: 'Connectivity', name: 'LLDP Neighbors',       ok: (h: string) => `${h}: 4 LLDP neighbors`          },
  // protocols
  { cat: 'Protocols',    name: 'BGP Session State',    ok: (h: string) => `${h}: 2 BGP peers Established`   },
  { cat: 'Protocols',    name: 'OSPF Adjacency',       ok: (h: string) => `${h}: FULL state on 3 interfaces` },
  { cat: 'Protocols',    name: 'Interface Status',     ok: (h: string) => `${h}: 46/48 interfaces Up`        },
  // config
  { cat: 'Config',       name: 'Hostname Match',       ok: (h: string) => `Running hostname matches: ${h}`  },
  { cat: 'Config',       name: 'Running vs Startup',   ok: (_h: string) => `Startup config in sync`         },
  { cat: 'Config',       name: 'ACL Present',          ok: (_h: string) => `Management ACL MGMT-ACCESS found`},
  // hardware
  { cat: 'Hardware',     name: 'CPU Utilization',      ok: (_h: string) => `CPU: 18% (threshold 75%)`       },
  { cat: 'Hardware',     name: 'Memory Utilization',   ok: (_h: string) => `Memory: 34% (threshold 85%)`    },
  { cat: 'Hardware',     name: 'Interface Errors',     ok: (_h: string) => `0 errors on all interfaces`      },
  { cat: 'Hardware',     name: 'Power & Fan Status',   ok: (_h: string) => `All PSUs OK, all fans OK`        },
]

function simulateChecksResult(
  devList: Array<{name: string; role: string}>,
  phase: 'pre' | 'post',
  failDevice: string,
  failCheck: string,
): ChecksResult {
  const results: CheckResult[] = []
  for (const dev of devList) {
    for (const tpl of CHECK_TEMPLATES) {
      const isFail = dev.name === failDevice && tpl.name === failCheck
      const roll = Math.random()
      const status: CheckResult['status'] = isFail ? 'FAIL'
        : roll < 0.05 ? 'FAIL'
        : roll < 0.15 ? 'WARN'
        : 'PASS'
      results.push({
        device: dev.name,
        name: tpl.name,
        status,
        message: status === 'PASS' ? tpl.ok(dev.name)
          : status === 'WARN' ? `${tpl.ok(dev.name)} — minor deviation`
          : `FAILED: ${tpl.name} check failed on ${dev.name}`,
        remediation: status === 'FAIL'
          ? `Review ${tpl.name} on ${dev.name}; check ${phase === 'pre' ? 'connectivity and baseline' : 'post-deploy state'}`
          : null,
      })
    }
  }
  return { phase, results }
}

// ── Config drift simulation (G-A4 demo mode) ──────────────────────────────────

const DRIFT_FAULT_LINES: Array<{ removed?: string; added?: string }> = [
  { removed: '  no shutdown', added: '  shutdown' },
  { removed: '  logging console', added: '  no logging console' },
  { added: '  ip access-group TEMP-BLOCK in' },
  { removed: '  ntp server 10.0.0.1' },
]

export function simulateConfigDrift(
  configs: Record<string, string>,
  faultDeviceId?: string,
): ConfigDriftResponse {
  const entries = Object.entries(configs)
  const devices: ConfigDriftDevice[] = entries.map(([id], i) => {
    if (id === faultDeviceId) {
      const fault = DRIFT_FAULT_LINES[i % DRIFT_FAULT_LINES.length]
      const added   = fault.added   ? [fault.added]   : []
      const removed = fault.removed ? [fault.removed] : []
      const unifiedDiff = [
        '--- intended',
        '+++ running',
        ...removed.map(l => `-${l}`),
        ...added.map(l => `+${l}`),
      ].join('\n')
      return { hostname: id, has_drift: true, added, removed, unified_diff: unifiedDiff, no_baseline: false }
    }
    return { hostname: id, has_drift: false, added: [], removed: [], unified_diff: '', no_baseline: false }
  })

  return {
    devices,
    drift_count: devices.filter(d => d.has_drift).length,
    device_count: devices.length,
  }
}

// ── Config remediation simulation (G-A16 demo mode) ───────────────────────────
// Mirrors backend/config_drift.py generate_remediation(): restore intended
// lines that drifted away, then negate/remove lines that appeared on-device.

function isJunosPlatform(platform: string): boolean {
  return /jun/i.test(platform)
}

function negateCiscoLine(line: string): string {
  const stripped = line.replace(/^\s+/, '')
  const indent = line.slice(0, line.length - stripped.length)
  if (stripped.startsWith('no ')) return `${indent}${stripped.slice(3)}`
  return `${indent}no ${stripped}`
}

function remediateJunos(line: string, remove: boolean): string {
  const s = line.trim()
  if (remove) {
    if (s.startsWith('set ')) return `delete ${s.slice(4)}`
    if (s.startsWith('delete ')) return s
    return `delete ${s}`
  }
  if (s.startsWith('set ')) return s
  if (s.startsWith('delete ')) return `set ${s.slice(7)}`
  return `set ${s}`
}

export function simulateRemediation(devices: RemediationDeviceInput[]): ConfigRemediationResponse {
  return {
    devices: devices.map(({ hostname, platform, added, removed }) => {
      const junos = isJunosPlatform(platform)
      const commands: string[] = []
      for (const line of removed) commands.push(junos ? remediateJunos(line, false) : line)
      for (const line of added) commands.push(junos ? remediateJunos(line, true) : negateCiscoLine(line))
      return { hostname, platform, commands, command_count: commands.length }
    }),
  }
}

// ── Troubleshooting Tooling Engine (G-A19 demo mode) ──────────────────────────
// Mirrors the backend POST /api/troubleshoot playbooks: per-symptom diagnostic
// steps, ranked likely causes, and remediation, with platform-specific CLI.
// Platforms: nxos | iosxe | eos | junos.

type TPlat = 'nxos' | 'iosxe' | 'eos' | 'junos'

function normTPlat(platform: string): TPlat {
  const p = platform.toLowerCase()
  if (/jun/.test(p)) return 'junos'
  if (/eos|arista/.test(p)) return 'eos'
  if (/nx|nexus/.test(p)) return 'nxos'
  return 'iosxe'
}

// Pick a platform-specific command from a per-platform map.
function tcmd(platform: string, map: Record<TPlat, string>): string {
  return map[normTPlat(platform)]
}

// Human-readable labels for the 8 supported symptom keys (drives the <select>).
const TROUBLESHOOT_SYMPTOMS: Array<{ key: string; label: string }> = [
  { key: 'bgp_down',        label: 'BGP session down' },
  { key: 'ospf_adjacency',  label: 'OSPF adjacency stuck' },
  { key: 'interface_flap',  label: 'Interface flapping' },
  { key: 'high_latency',    label: 'High latency' },
  { key: 'packet_loss',     label: 'Packet loss' },
  { key: 'high_cpu',        label: 'High CPU' },
  { key: 'vxlan_evpn',      label: 'VXLAN / EVPN reachability' },
  { key: 'pfc_rocev2',      label: 'PFC / RoCEv2 (GPU fabric)' },
]

interface TPlaybook {
  category: string
  summary: string
  steps: (p: string) => DiagnosticStep[]
  causes: LikelyCause[]
  remediation: string[]
}

// (DiagnosticStep / LikelyCause come from @/types via the file-level import.)
type DiagnosticStep = TroubleshootResult['diagnostic_steps'][number]
type LikelyCause = TroubleshootResult['likely_causes'][number]

const TROUBLESHOOT_PLAYBOOKS: Record<string, TPlaybook> = {
  bgp_down: {
    category: 'Routing',
    summary: 'A BGP session is stuck in Idle/Active/Connect and not reaching Established. Verify reachability, the TCP/179 session, and that AS numbers, timers, and MTU agree on both ends.',
    steps: (p) => [
      { order: 1, description: 'Check the BGP neighbor summary and session state',
        command: tcmd(p, { nxos: 'show ip bgp summary', iosxe: 'show ip bgp summary', eos: 'show ip bgp summary', junos: 'show bgp summary' }),
        look_for: 'Neighbor stuck in Idle/Active/Connect rather than Established; check the State/PfxRcd column' },
      { order: 2, description: 'Verify L3 reachability to the neighbor address',
        command: tcmd(p, { nxos: 'ping <neighbor-ip>', iosxe: 'ping <neighbor-ip>', eos: 'ping <neighbor-ip>', junos: 'ping <neighbor-ip>' }),
        look_for: 'Packet loss or unreachable — a routing/underlay problem prevents the TCP session' },
      { order: 3, description: 'Inspect detailed neighbor state, configured vs received AS, and timers',
        command: tcmd(p, { nxos: 'show ip bgp neighbors <neighbor-ip>', iosxe: 'show ip bgp neighbors <neighbor-ip>', eos: 'show ip bgp neighbors <neighbor-ip>', junos: 'show bgp neighbor <neighbor-ip>' }),
        look_for: 'AS mismatch ("remote AS" vs configured), hold-time mismatch, or "Connection refused"' },
      { order: 4, description: 'Check for MTU / path-MTU issues that break large BGP updates',
        command: tcmd(p, { nxos: 'ping <neighbor-ip> df-bit packet-size 8972', iosxe: 'ping <neighbor-ip> df-bit size 8972', eos: 'ping <neighbor-ip> df-bit size 8972', junos: 'ping <neighbor-ip> do-not-fragment size 8972' }),
        look_for: 'Fragmentation-needed / drops — an MTU mismatch can wedge the session in OpenSent/OpenConfirm' },
    ],
    causes: [
      { cause: 'TCP/179 session never forms — underlay/L3 unreachability', confidence: 0.85,
        indicators: ['Neighbor stuck in Active/Connect', 'Ping to neighbor fails', 'No route to neighbor in RIB'] },
      { cause: 'AS number mismatch (remote-as misconfigured)', confidence: 0.7,
        indicators: ['"remote AS x, configured AS y"', 'Session flaps in OpenSent', 'Notification: Bad Peer AS'] },
      { cause: 'MTU / path-MTU mismatch wedging large updates', confidence: 0.5,
        indicators: ['Session reaches OpenConfirm then drops', 'df-bit ping fails at 9000', 'Inconsistent on jumbo links'] },
      { cause: 'BFD session down tearing BGP down', confidence: 0.4,
        indicators: ['BFD admin-down/Down', 'BGP flaps in lockstep with BFD', 'Recent link errors'] },
    ],
    remediation: [
      'Restore L3 reachability to the neighbor (fix underlay route / interface)',
      'Align remote-as on both peers and confirm router-id uniqueness',
      'Match MTU on the path and enable path-MTU discovery where supported',
      'If BFD is enabled, confirm BFD timers/echo are consistent before clearing the session',
      'As a last resort, soft-clear the neighbor (clear ip bgp <ip> soft) rather than a hard reset',
    ],
  },

  ospf_adjacency: {
    category: 'Routing',
    summary: 'OSPF neighbors are not reaching FULL (often stuck in INIT/EXSTART/2-WAY). Mismatched timers, area IDs, network types, or MTU are the usual culprits.',
    steps: (p) => [
      { order: 1, description: 'Check OSPF neighbor adjacency state',
        command: tcmd(p, { nxos: 'show ip ospf neighbor', iosxe: 'show ip ospf neighbor', eos: 'show ip ospf neighbor', junos: 'show ospf neighbor' }),
        look_for: 'State stuck in INIT (no hellos back), 2-WAY (DR/BDR), or EXSTART (MTU mismatch)' },
      { order: 2, description: 'Compare interface OSPF parameters (hello/dead, area, network type)',
        command: tcmd(p, { nxos: 'show ip ospf interface <intf>', iosxe: 'show ip ospf interface <intf>', eos: 'show ip ospf interface <intf>', junos: 'show ospf interface <intf> detail' }),
        look_for: 'Hello/Dead timer mismatch, area ID mismatch, or network-type mismatch (p2p vs broadcast)' },
      { order: 3, description: 'Verify interface MTU on both ends',
        command: tcmd(p, { nxos: 'show interface <intf>', iosxe: 'show ip interface <intf>', eos: 'show interfaces <intf>', junos: 'show interfaces <intf>' }),
        look_for: 'MTU mismatch — adjacency stuck in EXSTART/EXCHANGE is the classic symptom' },
      { order: 4, description: 'Confirm OSPF authentication matches',
        command: tcmd(p, { nxos: 'show ip ospf interface <intf>', iosxe: 'show ip ospf interface <intf>', eos: 'show ip ospf interface <intf>', junos: 'show ospf interface <intf> detail' }),
        look_for: 'Authentication type/key mismatch — hellos are silently dropped' },
    ],
    causes: [
      { cause: 'Hello/Dead timer or area-ID mismatch', confidence: 0.8,
        indicators: ['Neighbor stuck in INIT', 'Timers differ on the two ends', 'Area mismatch logged'] },
      { cause: 'MTU mismatch (adjacency hangs in EXSTART/EXCHANGE)', confidence: 0.7,
        indicators: ['EXSTART/EXCHANGE state', 'Different MTU on the link', 'DBD retransmits'] },
      { cause: 'OSPF authentication mismatch', confidence: 0.5,
        indicators: ['No neighbor at all', 'Auth-type/key differs', '%OSPF auth mismatch logs'] },
      { cause: 'Network-type mismatch (broadcast vs point-to-point)', confidence: 0.4,
        indicators: ['Stuck in 2-WAY', 'No DR/BDR election expected on p2p', 'Mismatched ip ospf network'] },
    ],
    remediation: [
      'Align hello/dead intervals and area IDs on both interfaces',
      'Set identical MTU (or use "ip ospf mtu-ignore" only as a temporary workaround)',
      'Match OSPF authentication type and key',
      'Set a consistent OSPF network type on both ends',
    ],
  },

  interface_flap: {
    category: 'Physical',
    summary: 'An interface is repeatedly going up/down. Inspect error counters, optics/light levels, speed/duplex, and cabling before suspecting protocol issues.',
    steps: (p) => [
      { order: 1, description: 'Check interface status and last flap time',
        command: tcmd(p, { nxos: 'show interface <intf>', iosxe: 'show interfaces <intf>', eos: 'show interfaces <intf>', junos: 'show interfaces <intf> extensive' }),
        look_for: '"last link flapped" timestamp, line-protocol bouncing, reset counts' },
      { order: 2, description: 'Examine error counters (CRC, input errors, runts)',
        command: tcmd(p, { nxos: 'show interface <intf> counters errors', iosxe: 'show interfaces <intf> | include error|CRC', eos: 'show interfaces <intf> counters errors', junos: 'show interfaces <intf> extensive | match error' }),
        look_for: 'Rising CRC / input errors / runts — points to a bad cable, dirty fiber, or duplex mismatch' },
      { order: 3, description: 'Verify speed/duplex negotiation',
        command: tcmd(p, { nxos: 'show interface <intf> status', iosxe: 'show interfaces <intf> status', eos: 'show interfaces <intf> status', junos: 'show interfaces <intf> media' }),
        look_for: 'Half-duplex on one side / speed mismatch — a frequent late-collision and flap source' },
      { order: 4, description: 'Read optical transceiver light levels (for fiber)',
        command: tcmd(p, { nxos: 'show interface <intf> transceiver details', iosxe: 'show interfaces <intf> transceiver detail', eos: 'show interfaces <intf> transceiver', junos: 'show interfaces diagnostics optics <intf>' }),
        look_for: 'Rx/Tx power outside the optic\'s range, or low light — dirty/failing optic or fiber' },
    ],
    causes: [
      { cause: 'Bad cable / dirty or failing optic (CRC errors)', confidence: 0.8,
        indicators: ['Rising CRC and input errors', 'Rx power out of range', 'Flaps stop when cable swapped'] },
      { cause: 'Speed/duplex mismatch', confidence: 0.6,
        indicators: ['Half-duplex on one end', 'Late collisions', 'Auto-neg disagreement'] },
      { cause: 'Failing transceiver / SFP not fully seated', confidence: 0.5,
        indicators: ['Tx power abnormal', 'Errors only on one optic', 'DOM thresholds exceeded'] },
      { cause: 'STP topology change / port-security shut', confidence: 0.35,
        indicators: ['err-disabled state', 'STP TCN bursts', 'Recovers after err-disable timeout'] },
    ],
    remediation: [
      'Replace the cable or clean/replace the optic and re-seat the SFP',
      'Hard-set matching speed/duplex on both ends if auto-neg is unreliable',
      'Confirm transceiver DOM levels are within spec; swap suspect optics',
      'If err-disabled, fix the trigger (BPDU/port-security) then re-enable',
    ],
  },

  high_latency: {
    category: 'Performance',
    summary: 'End-to-end latency is elevated. Localize the hop adding delay, then check for congestion/queuing, suboptimal routing, or a control-plane-punted path.',
    steps: (p) => [
      { order: 1, description: 'Trace the path hop-by-hop to localize the latency',
        command: tcmd(p, { nxos: 'traceroute <dest>', iosxe: 'traceroute <dest>', eos: 'traceroute <dest>', junos: 'traceroute <dest>' }),
        look_for: 'The hop where RTT jumps — that device/link is the contributor' },
      { order: 2, description: 'Check interface utilization and output drops/queue depth',
        command: tcmd(p, { nxos: 'show interface <intf> | include rate|drop', iosxe: 'show interfaces <intf> | include rate|drops', eos: 'show interfaces <intf> | include rate|drops', junos: 'show interfaces <intf> extensive | match "rate|drop"' }),
        look_for: 'High utilization with output drops / deep queues — congestion adds queuing delay' },
      { order: 3, description: 'Verify the forwarding path is optimal (no scenic route)',
        command: tcmd(p, { nxos: 'show ip route <dest>', iosxe: 'show ip cef <dest>', eos: 'show ip route <dest>', junos: 'show route <dest>' }),
        look_for: 'Suboptimal next-hop / asymmetric path adding extra hops' },
      { order: 4, description: 'Rule out control-plane punting (process-switched path)',
        command: tcmd(p, { nxos: 'show processes cpu sort', iosxe: 'show processes cpu sorted', eos: 'show processes top once', junos: 'show chassis routing-engine' }),
        look_for: 'High CPU correlating with latency — traffic punted to CPU instead of hardware' },
    ],
    causes: [
      { cause: 'Link congestion / queuing delay on a hot interface', confidence: 0.75,
        indicators: ['High utilization', 'Output drops/queue depth rising', 'Latency tracks load'] },
      { cause: 'Suboptimal or asymmetric routing path', confidence: 0.55,
        indicators: ['Traceroute takes extra hops', 'Recent route change', 'Asymmetric RTT'] },
      { cause: 'Control-plane punting (process-switched traffic)', confidence: 0.45,
        indicators: ['High CPU', 'Latency only for certain flows', 'CoPP / punt path active'] },
      { cause: 'Buffer/QoS misconfiguration', confidence: 0.35,
        indicators: ['Tail drops in priority queue', 'Microbursts', 'Shaper too aggressive'] },
    ],
    remediation: [
      'Relieve congestion: add capacity/ECMP or tune QoS on the hot link',
      'Correct routing metrics/policy to restore the optimal path',
      'Ensure traffic is hardware-switched (fix CoPP/punt cause)',
      'Right-size buffers and queue thresholds for the traffic profile',
    ],
  },

  packet_loss: {
    category: 'Performance',
    summary: 'Traffic is experiencing drops. Distinguish interface errors (physical) from output drops (congestion/microbursts) and policy drops (ACL/QoS).',
    steps: (p) => [
      { order: 1, description: 'Check interface drop and error counters',
        command: tcmd(p, { nxos: 'show interface <intf> counters errors', iosxe: 'show interfaces <intf> | include drops|errors', eos: 'show interfaces <intf> counters errors', junos: 'show interfaces <intf> extensive | match "drop|error"' }),
        look_for: 'Output drops (congestion) vs input errors/CRC (physical) vs no-buffer drops' },
      { order: 2, description: 'Look for queue drops / microburst tail-drops',
        command: tcmd(p, { nxos: 'show queuing interface <intf>', iosxe: 'show policy-map interface <intf>', eos: 'show interfaces <intf> counters queue', junos: 'show interfaces queue <intf>' }),
        look_for: 'Tail-drops on a specific queue — microbursts overrun shallow buffers' },
      { order: 3, description: 'Verify no ACL / policy is dropping the flow',
        command: tcmd(p, { nxos: 'show access-lists', iosxe: 'show access-lists', eos: 'show ip access-lists', junos: 'show firewall' }),
        look_for: 'ACL deny hit-counts incrementing for the affected flow' },
      { order: 4, description: 'Test reachability and loss rate to the destination',
        command: tcmd(p, { nxos: 'ping <dest> count 100', iosxe: 'ping <dest> repeat 100', eos: 'ping <dest> repeat 100', junos: 'ping <dest> count 100' }),
        look_for: 'Consistent loss % to quantify and confirm the drop point' },
    ],
    causes: [
      { cause: 'Microbursts overrunning buffers (output/tail drops)', confidence: 0.7,
        indicators: ['Output/queue tail-drops', 'Low average but bursty load', 'Drops on shallow-buffer ports'] },
      { cause: 'Physical-layer errors (CRC/input errors)', confidence: 0.6,
        indicators: ['Rising CRC/input errors', 'Bad cable/optic', 'Errors localized to one port'] },
      { cause: 'ACL / QoS policy dropping the flow', confidence: 0.45,
        indicators: ['ACL deny hits incrementing', 'Policer/exceed drops', 'Loss only for specific 5-tuple'] },
      { cause: 'Oversubscription / sustained congestion', confidence: 0.4,
        indicators: ['Link at 100%', 'WRED drops', 'Loss tracks peak hours'] },
    ],
    remediation: [
      'Increase buffer allocation or enable WRED/ECN to absorb microbursts',
      'Fix the physical layer (cable/optic) if CRC/input errors are present',
      'Adjust or remove the ACL/QoS policy dropping legitimate traffic',
      'Add capacity / ECMP to relieve sustained oversubscription',
    ],
  },

  high_cpu: {
    category: 'Device Health',
    summary: 'Control-plane CPU is high. Identify the top process, check whether traffic is being punted to the CPU, and verify CoPP is protecting the control plane.',
    steps: (p) => [
      { order: 1, description: 'Identify the top CPU process',
        command: tcmd(p, { nxos: 'show processes cpu sort', iosxe: 'show processes cpu sorted', eos: 'show processes top once', junos: 'show system processes extensive' }),
        look_for: 'A single process dominating, or high interrupt/IP-input (punted traffic)' },
      { order: 2, description: 'Check the CoPP / control-plane policy for drops',
        command: tcmd(p, { nxos: 'show policy-map interface control-plane', iosxe: 'show policy-map control-plane', eos: 'show policy-map interface control-plane', junos: 'show ddos-protection statistics' }),
        look_for: 'CoPP class exceed/drop counters climbing — control plane under attack/overload' },
      { order: 3, description: 'Look for traffic punted to CPU (software-switched)',
        command: tcmd(p, { nxos: 'show hardware rate-limiter', iosxe: 'show platform punt-statistics', eos: 'show cpu counters queue', junos: 'show pfe statistics traffic' }),
        look_for: 'High punt rate — TTL-expiry, ARP storms, or no-route punts hammering the CPU' },
      { order: 4, description: 'Check for routing/protocol churn driving CPU',
        command: tcmd(p, { nxos: 'show ip bgp summary', iosxe: 'show ip route summary', eos: 'show ip route summary', junos: 'show route summary' }),
        look_for: 'Route/SPF churn or constant BGP updates keeping the CPU busy' },
    ],
    causes: [
      { cause: 'Traffic punted to CPU (process-switched / no CoPP protection)', confidence: 0.75,
        indicators: ['High IP-input / interrupt CPU', 'Punt-statistics climbing', 'CoPP exceed drops'] },
      { cause: 'Control-plane storm (ARP/BPDU/protocol flood)', confidence: 0.6,
        indicators: ['One CoPP class saturated', 'Broadcast storm', 'CPU tracks a noisy port'] },
      { cause: 'Routing/SPF churn from instability', confidence: 0.5,
        indicators: ['Flapping routes', 'Constant BGP updates', 'OSPF SPF runs frequent'] },
      { cause: 'Runaway / buggy process', confidence: 0.35,
        indicators: ['Single process pinned high', 'Resolves after process restart', 'Known bug / memory leak'] },
    ],
    remediation: [
      'Apply or tighten CoPP to rate-limit control-plane traffic',
      'Identify and stop the punt source (TTL-expiry, ARP storm, missing route)',
      'Stabilize routing (dampening, fix flapping link) to stop churn',
      'If a process is buggy, restart it and check for a software fix/upgrade',
    ],
  },

  vxlan_evpn: {
    category: 'Overlay',
    summary: 'VXLAN/EVPN endpoints cannot reach each other across the fabric. Check the NVE peer state, EVPN route exchange, and that route-targets / VNI-to-VLAN mappings agree.',
    steps: (p) => [
      { order: 1, description: 'Check NVE interface and VTEP peer state',
        command: tcmd(p, { nxos: 'show nve peers', iosxe: 'show nve peers', eos: 'show vxlan vtep', junos: 'show interfaces vtep' }),
        look_for: 'Expected remote VTEPs present and Up; missing peer = no overlay path' },
      { order: 2, description: 'Verify L2VPN EVPN routes are being learned',
        command: tcmd(p, { nxos: 'show bgp l2vpn evpn summary', iosxe: 'show bgp l2vpn evpn summary', eos: 'show bgp evpn summary', junos: 'show bgp summary' }),
        look_for: 'EVPN address-family Established and prefixes received (>0)' },
      { order: 3, description: 'Confirm Type-2 (MAC/IP) routes for the host',
        command: tcmd(p, { nxos: 'show bgp l2vpn evpn', iosxe: 'show bgp l2vpn evpn', eos: 'show bgp evpn route-type mac-ip', junos: 'show route table bgp.evpn.0' }),
        look_for: 'Missing Type-2 routes for the affected MAC/IP — host not advertised or RT-filtered' },
      { order: 4, description: 'Check VNI status and VLAN-to-VNI mapping',
        command: tcmd(p, { nxos: 'show nve vni', iosxe: 'show nve vni', eos: 'show vxlan vni', junos: 'show ethernet-switching vxlan-tunnel-end-point remote' }),
        look_for: 'VNI Up and mapped to the correct VLAN; route-target import/export mismatch' },
    ],
    causes: [
      { cause: 'Route-target import/export mismatch (routes not imported)', confidence: 0.8,
        indicators: ['EVPN routes present in BGP but not in the VRF/MAC-VRF', 'RT differs between leaves', 'Type-2 not imported'] },
      { cause: 'VTEP/NVE peer not established (underlay or source-loopback issue)', confidence: 0.65,
        indicators: ['Remote VTEP missing from "show nve peers"', 'Source loopback not advertised', 'Underlay route missing'] },
      { cause: 'VLAN-to-VNI mapping inconsistent between leaves', confidence: 0.55,
        indicators: ['Same VLAN maps to different VNIs', 'VNI down', 'L2VNI vs L3VNI confusion'] },
      { cause: 'EVPN address-family not negotiated with spines', confidence: 0.45,
        indicators: ['l2vpn evpn AF Idle', 'send-community extended missing', 'No EVPN prefixes received'] },
    ],
    remediation: [
      'Align route-target import/export (use "route-target both auto" consistently)',
      'Restore VTEP reachability: advertise the source loopback in the underlay',
      'Make VLAN-to-VNI mappings identical on all leaves in the segment',
      'Enable the l2vpn evpn address-family with extended communities to the spines',
    ],
  },

  pfc_rocev2: {
    category: 'GPU Fabric',
    summary: 'RoCEv2 traffic is suffering drops/poor RDMA performance. Verify PFC is enabled no-drop on the correct priority end-to-end and that ECN/DCQCN are marking, not dropping.',
    steps: (p) => [
      { order: 1, description: 'Verify PFC is enabled and watch for PFC pause frames',
        command: tcmd(p, { nxos: 'show interface priority-flow-control', iosxe: 'show interface <intf> priority-flow-control', eos: 'show priority-flow-control', junos: 'show interfaces <intf> extensive | match pfc' }),
        look_for: 'PFC On for the RoCE priority and Rx/Tx pause counters incrementing as expected' },
      { order: 2, description: 'Confirm the no-drop class maps to the correct CoS/priority',
        command: tcmd(p, { nxos: 'show queuing interface <intf>', iosxe: 'show policy-map interface <intf>', eos: 'show qos interface <intf>', junos: 'show class-of-service interface <intf>' }),
        look_for: 'RoCE priority (typically 3) in a no-drop queue; mismatched priority = drops' },
      { order: 3, description: 'Check ECN marking and DCQCN behavior',
        command: tcmd(p, { nxos: 'show queuing interface <intf> | include ECN|WRED', iosxe: 'show policy-map interface <intf> | include ECN|wred', eos: 'show qos interface <intf> | include ecn', junos: 'show class-of-service interface <intf> detail | match ecn' }),
        look_for: 'ECN marking (not tail-drop) on the lossy threshold; CNP generation present' },
      { order: 4, description: 'Look for PFC watchdog / deadlock events',
        command: tcmd(p, { nxos: 'show interface priority-flow-control watchdog', iosxe: 'show interface <intf> priority-flow-control', eos: 'show priority-flow-control watchdog', junos: 'show interfaces <intf> extensive | match watchdog' }),
        look_for: 'PFC watchdog shutting queues — PFC storm / deadlock on the no-drop class' },
    ],
    causes: [
      { cause: 'PFC not enabled (or on the wrong priority) end-to-end', confidence: 0.8,
        indicators: ['PFC Off on a transit hop', 'RoCE priority not no-drop', 'Drops on priority 3 queue'] },
      { cause: 'CoS/DSCP-to-priority mapping mismatch across hops', confidence: 0.65,
        indicators: ['Pause frames absent where expected', 'Traffic lands in drop queue', 'Inconsistent qos-group mapping'] },
      { cause: 'ECN/DCQCN misconfigured (tail-drop instead of mark)', confidence: 0.55,
        indicators: ['No CNP generation', 'WRED min/max wrong', 'High retransmits despite no-drop'] },
      { cause: 'PFC watchdog / deadlock disabling queues', confidence: 0.4,
        indicators: ['PFC watchdog events', 'Queue auto-shut/restored', 'Pause storm on one priority'] },
    ],
    remediation: [
      'Enable PFC no-drop on the RoCE priority (e.g. priority 3) on every hop',
      'Ensure consistent DSCP/CoS-to-qos-group mapping across the fabric',
      'Tune ECN/WRED thresholds to mark (not drop) and confirm DCQCN/CNP generation',
      'Enable PFC watchdog to break deadlocks and investigate the pause-storm source',
    ],
  },
}

const TROUBLESHOOT_FALLBACK: TPlaybook = {
  category: 'General',
  summary: 'No specific playbook matched this symptom. Start with a top-down health check: physical/interface state, IP reachability, protocol adjacencies, then control-plane health.',
  steps: (p) => [
    { order: 1, description: 'Check overall interface status',
      command: tcmd(p, { nxos: 'show interface status', iosxe: 'show ip interface brief', eos: 'show interfaces status', junos: 'show interfaces terse' }),
      look_for: 'Down/err-disabled interfaces or unexpected state changes' },
    { order: 2, description: 'Verify basic reachability to the affected destination',
      command: tcmd(p, { nxos: 'ping <dest>', iosxe: 'ping <dest>', eos: 'ping <dest>', junos: 'ping <dest>' }),
      look_for: 'Loss or unreachable indicating where to focus next' },
    { order: 3, description: 'Review the system log for recent errors',
      command: tcmd(p, { nxos: 'show logging last 100', iosxe: 'show logging | last 100', eos: 'show logging last 100', junos: 'show log messages | last 100' }),
      look_for: 'Recent error/warning events correlating with the problem time' },
    { order: 4, description: 'Check device CPU and memory health',
      command: tcmd(p, { nxos: 'show system resources', iosxe: 'show processes cpu sorted', eos: 'show processes top once', junos: 'show chassis routing-engine' }),
      look_for: 'Resource exhaustion that could explain broad symptoms' },
  ],
  causes: [
    { cause: 'Physical / interface-level issue', confidence: 0.5,
      indicators: ['Interface down/err-disabled', 'Error counters rising', 'Recent flap'] },
    { cause: 'Reachability / routing problem', confidence: 0.4,
      indicators: ['Ping fails', 'Missing route', 'Asymmetric path'] },
    { cause: 'Control-plane / resource pressure', confidence: 0.3,
      indicators: ['High CPU/memory', 'Process churn', 'Log warnings'] },
  ],
  remediation: [
    'Triage from the bottom up: physical → IP → protocol → control plane',
    'Correlate the system log timestamps with when the issue began',
    'Isolate to a single device/link, then drill in with a targeted command set',
  ],
}

export function simulateTroubleshoot(symptom: string, platform: string): TroubleshootResult {
  const pb = TROUBLESHOOT_PLAYBOOKS[symptom] ?? TROUBLESHOOT_FALLBACK
  const causes = [...pb.causes].sort((a, b) => b.confidence - a.confidence)
  return {
    symptom,
    category: pb.category,
    summary: pb.summary,
    diagnostic_steps: pb.steps(platform),
    likely_causes: causes,
    remediation: [...pb.remediation],
  }
}

// ── NETCONF XML helpers ───────────────────────────────────────────────────────

function buildNetconfXMLForOp(op: string, datastore: string, vendor: string): string {
  const isJunos = /juniper|junos/i.test(vendor)
  switch (op) {
    case 'get-config': return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="1">
  <get-config>
    <source><${datastore}/></source>
    <filter type="subtree">
      <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/>
    </filter>
  </get-config>
</rpc>`
    case 'edit-config':
      if (isJunos) return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="2">
  <edit-config>
    <target><${datastore}/></target>
    <config>
      <configuration xmlns="http://xml.juniper.net/xnm/1.1/xnm">
        <interfaces>
          <interface>
            <name>ge-0/0/0</name>
            <description>NetDesign AI managed</description>
          </interface>
        </interfaces>
      </configuration>
    </config>
  </edit-config>
</rpc>`
      return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="2">
  <edit-config>
    <target><${datastore}/></target>
    <config>
      <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
        <interface>
          <name>GigabitEthernet1</name>
          <description>NetDesign AI — managed</description>
          <enabled>true</enabled>
          <ipv4 xmlns="urn:ietf:params:xml:ns:yang:ietf-ip">
            <address><ip>10.0.0.1</ip><prefix-length>24</prefix-length></address>
          </ipv4>
        </interface>
      </interfaces>
    </config>
  </edit-config>
</rpc>`
    case 'get': return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="3">
  <get>
    <filter type="subtree">
      <interfaces-state xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/>
    </filter>
  </get>
</rpc>`
    case 'lock': return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="4">
  <lock><target><${datastore}/></target></lock>
</rpc>`
    case 'unlock': return `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="5">
  <unlock><target><${datastore}/></target></unlock>
</rpc>`
    default: return ''
  }
}

function buildNetconfMockResponse(op: string): string {
  if (op === 'get-config') return `<?xml version="1.0" encoding="UTF-8"?>
<rpc-reply xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="1">
  <data>
    <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
      <interface>
        <name>GigabitEthernet1</name>
        <description>WAN Uplink</description>
        <enabled>true</enabled>
        <type xmlns:ianaift="urn:ietf:params:xml:ns:yang:iana-if-type">ianaift:ethernetCsmacd</type>
        <ipv4 xmlns="urn:ietf:params:xml:ns:yang:ietf-ip">
          <address><ip>10.0.0.1</ip><prefix-length>30</prefix-length></address>
        </ipv4>
      </interface>
    </interfaces>
  </data>
</rpc-reply>`
  if (op === 'get') return `<?xml version="1.0" encoding="UTF-8"?>
<rpc-reply xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="3">
  <data>
    <interfaces-state xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
      <interface>
        <name>GigabitEthernet1</name>
        <admin-status>up</admin-status><oper-status>up</oper-status>
        <statistics>
          <in-octets>1048576</in-octets><out-octets>2097152</out-octets>
          <in-errors>0</in-errors><out-errors>0</out-errors>
        </statistics>
      </interface>
    </interfaces-state>
  </data>
</rpc-reply>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rpc-reply xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="1">
  <ok/>
</rpc-reply>`
}

// ── Automation helpers ────────────────────────────────────────────────────────

function buildAnsibleInventory(deviceNames: string[]): string {
  const lines = ['[network_devices]']
  deviceNames.forEach((n, i) => {
    lines.push(`${n} ansible_host=10.0.0.${i + 10} ansible_user=<CHANGE-ME-USER> ansible_password=<CHANGE-ME-PASS> ansible_network_os=ios`)
  })
  lines.push('', '[network_devices:vars]', 'ansible_connection=network_cli', 'ansible_become=yes', 'ansible_become_method=enable')
  return lines.join('\n')
}

function buildTerraformMain(provider: string, deviceNames: string[]): string {
  if (provider === 'cisco_nso') return `terraform {
  required_providers {
    nso = { source = "CiscoDevNet/nso", version = "~> 0.5" }
  }
}
provider "nso" {
  url      = "http://nso.corp.local:8080"
  username = "<CHANGE-ME-NSO-USER>"
  password = "<CHANGE-ME-NSO-PASS>"
  insecure = true
}
resource "nso_device" "managed" {
  for_each    = toset(${JSON.stringify(deviceNames)})
  name        = each.key
  address     = "10.0.0.\${index(tolist(toset(${JSON.stringify(deviceNames)})), each.key) + 10}"
  port        = 22
  authgroup   = "default"
  device_type = "cli"
  ned_id      = "cisco-ios-cli-6.85"
}`
  if (provider === 'netbox') return `terraform {
  required_providers {
    netbox = { source = "e-breuninger/netbox", version = "~> 3.0" }
  }
}
provider "netbox" {
  server_url = "http://netbox.corp.local"
  api_token  = "<CHANGE-ME-NETBOX-TOKEN>"
}
resource "netbox_device" "managed" {
  for_each    = toset(${JSON.stringify(deviceNames)})
  name        = each.key
  device_type = 1
  site        = netbox_site.main.id
  status      = "active"
}
resource "netbox_site" "main" {
  name = "Main Site"; slug = "main-site"; status = "active"
}`
  return `terraform {
  required_version = ">= 1.5"
}
variable "devices" {
  type = list(object({ hostname = string; ip = string; platform = string }))
  default = ${JSON.stringify(deviceNames.map((n,i) => ({ hostname: n, ip: `10.0.0.${i+10}`, platform: 'cisco_ios' })), null, 2)}
}
resource "null_resource" "deploy_configs" {
  for_each = { for d in var.devices : d.hostname => d }
  provisioner "local-exec" {
    command = "python3 push_configs.py --host \${each.value.ip} --device \${each.key}"
  }
  triggers = { config_hash = sha256(file("\${each.key}.cfg")) }
}`
}

function buildTerraformVars(deviceNames: string[]): string {
  return `# terraform.tfvars — NetDesign AI generated
# Edit IP addresses before applying

devices = [
${deviceNames.map((n, i) => `  { hostname = "${n}", ip = "10.0.0.${i + 10}", platform = "cisco_ios" }`).join(',\n')}
]
`
}

function buildTerraformPlanOutput(deviceNames: string[]): string {
  const adds = deviceNames.slice(0, 6)
  return `Terraform will perform the following actions:

${adds.map(n => `  # null_resource.deploy_configs["${n}"] will be created
  + resource "null_resource" "deploy_configs" {
      + id       = (known after apply)
      + triggers = {
          + "config_hash" = (known after apply)
        }
    }
`).join('\n')}
Plan: ${adds.length} to add, 0 to change, 0 to destroy.`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Step6Deploy() {
  const { prevStep } = useAppStore()
  const activeDeployTab    = useAppStore(s => s.activeDeployTab)
  const setActiveDeployTab = useAppStore(s => s.setActiveDeployTab)
  const storeDevices       = useAppStore(s => s.devices)
  const storeConfigs       = useAppStore(s => s.configs)
  const netboxDevices      = useAppStore(s => s.netboxDevices)
  const storeSiteCode      = useAppStore(s => s.siteCode)
  const storeUseCase       = useAppStore(s => s.useCase)
  const orgName            = useAppStore(s => s.orgName)
  const customPolicyRules  = useAppStore(s => s.customPolicyRules)
  const compliance         = useAppStore(s => s.compliance)
  const { isLive } = useBackendMode()
  const { showToast } = useToast()

  // Use activeDeployTab as the tab — no separate local state needed
  const tab    = (activeDeployTab || 'deploy') as Tab
  const setTab = setActiveDeployTab

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

  // L1 — Observability panel
  const [showObservability, setShowObservability] = useState(false)
  const [observabilityTab, setObservabilityTab] = useState<'alerts' | 'rca' | 'feed'>('alerts')

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
  const [failAt, setFailAt] = useState(ZTP_SIM_STAGES[4].id) // CONFIG_APPLYING
  // B2 — device source: BOM design vs NetBox-imported inventory (Step 1 panel)
  const [deviceSource, setDeviceSource] = useState<'design' | 'netbox'>('design')
  const [ztpEvents, setZtpEvents] = useState<ZTPEvent[]>([])
  const [ztpSummary, setZtpSummary] = useState<{ total_events: number; online: number; failed: number } | null>(null)
  const { mutate: runZTP, isPending: ztpPending } = useRunZTP()

  function handleRunZTP() {
    if (!isLive) {
      const data = simulateZTPResult(simDevices, failDevice, failAt)
      setZtpEvents(data.events)
      setZtpSummary(data.summary)
      showToast(`ZTP (demo) — ${data.summary.online} online, ${data.summary.failed} failed`,
        data.summary.failed ? 'warning' : 'success')
      return
    }
    const req = failDevice ? { fail_device: failDevice, fail_at: failAt } : {}
    runZTP(req, {
      onSuccess(data) {
        setZtpEvents(data.events)
        setZtpSummary(data.summary)
        showToast(`ZTP complete — ${data.summary.online} online, ${data.summary.failed} failed`,
          data.summary.failed ? 'warning' : 'success')
      },
      onError() {
        const data = simulateZTPResult(simDevices, failDevice, failAt)
        setZtpEvents(data.events)
        setZtpSummary(data.summary)
        showToast(`ZTP (demo fallback) — ${data.summary.online} online, ${data.summary.failed} failed`,
          data.summary.failed ? 'warning' : 'success')
      },
    })
  }

  // ── Checks state ──────────────────────────────────────────────────────────
  const [failCheckDevice, setFailCheckDevice] = useState('')
  const [failCheck, setFailCheck] = useState('interfaces_up')
  const [checkPhase, setCheckPhase] = useState<'pre' | 'post' | null>(null)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const { mutate: runPre,  isPending: prePending }  = useRunChecks('pre')
  const { mutate: runPost, isPending: postPending } = useRunChecks('post')

  function applyChecksResult(data: ChecksResult, p: 'pre' | 'post') {
    setCheckPhase(p)
    setCheckResults(data.results)
    if (p === 'pre') setPreResults(data.results)
    else setPostResults(data.results)
    const pass = data.results.filter(r => r.status === 'PASS').length
    const fail = data.results.filter(r => r.status === 'FAIL').length
    showToast(`${p.toUpperCase()}-checks — ${pass} PASS, ${fail} FAIL`, fail ? 'warning' : 'success')
  }

  function handleRunChecks(p: 'pre' | 'post') {
    if (!isLive) {
      applyChecksResult(simulateChecksResult(simDevices, p, failCheckDevice, failCheck), p)
      return
    }
    const req = failCheckDevice && failCheck ? { fail_devices: { [failCheckDevice]: [failCheck] } } : {}
    const mutate = p === 'pre' ? runPre : runPost
    mutate(req, {
      onSuccess(data) { applyChecksResult(data, p) },
      onError() { applyChecksResult(simulateChecksResult(simDevices, p, failCheckDevice, failCheck), p) },
    })
  }

  const badgeVariant = (s: string) =>
    ({ PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' } as const)[s] ?? 'neutral'
  const badgeIcon = (s: string) =>
    ({ PASS: '✔', FAIL: '✘', WARN: '⚠', SKIP: '–' } as const)[s] ?? '–'

  // ── Monitor state ─────────────────────────────────────────────────────────
  const [monitorData, setMonitorData] = useState<MonitoringResult | null>(null)
  const { mutate: poll, isPending: pollPending } = usePollMonitoring()
  const { data: liveMetrics } = useMetricsSummary()
  const [monitorTick, setMonitorTick] = useState(1)
  const [demoMetrics, setDemoMetrics] = useState<MetricsSummary | null>(null)
  // Sparkline history: last 8 ticks of throughput per device
  const sparkRef = useRef<Record<string, number[]>>({})

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
  const [complianceScanResult, setComplianceScanResult] = useState<ComplianceScanResult | null>(null)

  // G-A4: Config drift detection (intended config vs running-config backup)
  const [driftResult, setDriftResult] = useState<ConfigDriftResponse | null>(null)
  const [driftFaultDevice, setDriftFaultDevice] = useState('')
  const [expandedDriftDevices, setExpandedDriftDevices] = useState<Set<string>>(new Set())
  const { mutate: runConfigDrift, isPending: driftChecking } = useConfigDrift()

  function handleDriftCheck() {
    setExpandedDriftDevices(new Set())
    if (!isLive) {
      setDriftResult(simulateConfigDrift(storeConfigs, driftFaultDevice))
      return
    }
    runConfigDrift({ configs: storeConfigs }, {
      onSuccess: setDriftResult,
      onError(e) { showToast('Drift check failed: ' + e.message, 'error') },
    })
  }

  function toggleDriftDevice(hostname: string) {
    setExpandedDriftDevices(prev => {
      const next = new Set(prev)
      if (next.has(hostname)) next.delete(hostname)
      else next.add(hostname)
      return next
    })
  }

  // G-A16: inline remediation — drift → reviewable, platform-aware commands
  const [remediationResult, setRemediationResult] = useState<ConfigRemediationResponse | null>(null)
  const { mutate: runRemediation, isPending: remediationPending } = useConfigRemediation()

  function buildRemediationInputs(): RemediationDeviceInput[] {
    if (!driftResult) return []
    return driftResult.devices
      .filter(d => d.has_drift)
      .map(d => ({
        hostname: d.hostname,
        platform: configIdToPlatform[d.hostname] ?? 'ios-xe',
        added: d.added,
        removed: d.removed,
      }))
  }

  function handleGenerateRemediation() {
    const inputs = buildRemediationInputs()
    if (inputs.length === 0) return
    if (!isLive) {
      setRemediationResult(simulateRemediation(inputs))
      return
    }
    runRemediation(inputs, {
      onSuccess: setRemediationResult,
      onError(e) { showToast('Remediation generation failed: ' + e.message, 'error') },
    })
  }

  function remediationScriptText(): string {
    if (!remediationResult) return ''
    return remediationResult.devices
      .map(d => [
        `! ${configIdToHostname[d.hostname] ?? d.hostname} (${d.platform}) — ${d.command_count} command(s)`,
        ...d.commands,
        '',
      ].join('\n'))
      .join('\n')
  }

  // Clear stale remediation whenever a fresh drift check runs
  useEffect(() => { setRemediationResult(null) }, [driftResult])

  // K2: Closed-loop remediation orchestration — detect → plan → apply → verify.
  const [loopResult, setLoopResult] = useState<ClosedLoopResult | null>(null)
  const [loopSimulateDivergence, setLoopSimulateDivergence] = useState(false)
  const [loopRunning, setLoopRunning] = useState(false)

  async function handleRunClosedLoop() {
    setLoopRunning(true)
    setLoopResult(null)
    // Drive the loop from the existing demo simulators so it works standalone.
    const faultHost = Object.keys(storeConfigs)[0] ?? ''
    const drift = simulateConfigDrift(storeConfigs, faultHost)
    const remInputs: RemediationDeviceInput[] = drift.devices
      .filter(d => d.has_drift)
      .map(d => ({
        hostname: d.hostname,
        platform: configIdToPlatform[d.hostname] ?? 'ios-xe',
        added: d.added,
        removed: d.removed,
      }))
    const remediation = simulateRemediation(remInputs)
    // A short staged delay makes the pipeline feel like it's executing.
    await new Promise(r => setTimeout(r, 600))
    // Divergence demo: the drifted device fails to converge on verify.
    const failDevices = loopSimulateDivergence && faultHost ? [faultHost] : []
    setLoopResult(runClosedLoop(drift, remediation, { failDevices }))
    setLoopRunning(false)
  }

  // K3: Scheduled / periodic compliance + drift scans
  const [scanWatchers, setScanWatchers] = useState<WatcherConfig[]>([])
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([])
  const [editingWatcher, setEditingWatcher] = useState<WatcherConfig | null>(null)

  function handleAddWatcher() {
    const w = createWatcher({ name: `Scan ${scanWatchers.length + 1}`, frameworks: compliance.length > 0 ? [...compliance] : [] })
    setEditingWatcher(w)
  }

  function handleSaveWatcher(w: WatcherConfig) {
    setScanWatchers(prev => {
      const idx = prev.findIndex(x => x.id === w.id)
      if (idx >= 0) return prev.map((x, i) => i === idx ? w : x)
      return [...prev, w]
    })
    setEditingWatcher(null)
    const deviceCount = storeDevices.reduce((s: number, d: BOMDevice) => s + d.count, 0)
    setScanHistory(simulateScanHistory([...scanWatchers.filter(x => x.id !== w.id), w].filter(x => x.enabled), deviceCount))
  }

  function handleDeleteWatcher(id: string) {
    setScanWatchers(prev => prev.filter(w => w.id !== id))
    if (editingWatcher?.id === id) setEditingWatcher(null)
  }

  function handleDownloadCron() {
    downloadBlob('netdesign-scans.crontab', exportCronTab(scanWatchers))
    showToast('Crontab downloaded', 'success')
  }

  function handleDownloadSystemdTimer(w: WatcherConfig) {
    const { timer, service } = exportSystemdTimer(w)
    const slug = w.name.replace(/\s+/g, '-').toLowerCase()
    downloadBlob(`netdesign-${slug}.timer`, timer)
    downloadBlob(`netdesign-${slug}.service`, service)
    showToast('Systemd timer + service downloaded', 'success')
  }

  function handleDownloadScanScript() {
    downloadBlob('scan-runner.sh', exportScanScript(scanWatchers))
    showToast('scan-runner.sh downloaded', 'success')
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

  // ── Troubleshooting Tooling Engine state (G-A19) ──────────────────────────
  const [tsSymptom, setTsSymptom] = useState('bgp_down')
  const [tsPlatform, setTsPlatform] = useState('nxos')
  const [tsDevicesNote, setTsDevicesNote] = useState('')
  const [tsResult, setTsResult] = useState<TroubleshootResult | null>(null)
  const { mutate: runTs, isPending: tsRunning } = useTroubleshoot()

  function handleRunTroubleshoot() {
    const devices = tsDevicesNote.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (!isLive) {
      setTsResult(simulateTroubleshoot(tsSymptom, tsPlatform))
      return
    }
    runTs({ symptom: tsSymptom, devices, platform: tsPlatform }, {
      onSuccess: setTsResult,
      onError(e) { showToast('Diagnostics failed: ' + e.message, 'error') },
    })
  }

  // ── Policy Gate state ─────────────────────────────────────────────────────
  const [policyConfirmed, setPolicyConfirmed] = useState(false)
  const [policyApproved, setPolicyApproved] = useState(false)

  // ── NETCONF interactive state ──────────────────────────────────────────────
  const [netconfDevice, setNetconfDevice] = useState('')
  const [netconfOp, setNetconfOp] = useState('get-config')
  const [netconfDatastore, setNetconfDatastore] = useState('running')
  const [netconfResponse, setNetconfResponse] = useState('')
  const [netconfRunning, setNetconfRunning] = useState(false)

  const netconfDeviceObj = storeDevices.find(d => d.id === netconfDevice)
  const netconfXML = useMemo(
    () => buildNetconfXMLForOp(netconfOp, netconfDatastore, netconfDeviceObj?.vendor ?? ''),
    [netconfOp, netconfDatastore, netconfDeviceObj],
  )

  async function handleNetconfExecute() {
    setNetconfRunning(true)
    setNetconfResponse('')
    await new Promise(r => setTimeout(r, 800))
    setNetconfResponse(buildNetconfMockResponse(netconfOp))
    setNetconfRunning(false)
  }

  // ── Config Automation state ────────────────────────────────────────────────
  const [automationTab, setAutomationTab] = useState<'ansible' | 'terraform' | 'manual'>('ansible')
  const [towerUrl, setTowerUrl] = useState('http://tower.corp.local')
  const [towerTemplate, setTowerTemplate] = useState('Deploy Network Config')
  const [towerJobId, setTowerJobId] = useState<number | null>(null)
  const [towerJobStatus, setTowerJobStatus] = useState('')
  const [towerJobRunning, setTowerJobRunning] = useState(false)
  const [tfProvider, setTfProvider] = useState('cisco_nso')
  const [tfPlanOutput, setTfPlanOutput] = useState('')
  const [tfPlanRunning, setTfPlanRunning] = useState(false)
  const [scriptType, setScriptType] = useState<'precheck' | 'postcheck' | 'push' | 'rollback'>('push')

  const autoDeviceNames = useMemo(() => {
    if (storeDevices.length > 0) return storeDevices.map(d => d.hostname || d.id)
    return allDevices.map(d => d.name)
  }, [storeDevices, allDevices])

  // G-A4: map config-store keys (device.id) to friendly hostnames for display
  const configIdToHostname = useMemo(
    () => Object.fromEntries(storeDevices.map(d => [d.id, d.hostname || d.id])),
    [storeDevices],
  )

  // G-A16: map config-store keys (device.id) to vendor for remediation syntax
  // (vendor 'juniper' → set/delete; anything else → Cisco-style `no` negation)
  const configIdToPlatform = useMemo(
    () => Object.fromEntries(storeDevices.map(d => [d.id, d.vendor || 'ios-xe'])),
    [storeDevices],
  )

  const towerExtraVars = JSON.stringify({
    site_code: storeSiteCode || 'SITE01',
    use_case: storeUseCase || 'dc',
    devices: autoDeviceNames.slice(0, 5),
  }, null, 2)

  async function handleTowerLaunch() {
    setTowerJobRunning(true)
    setTowerJobId(null)
    setTowerJobStatus('Pending')
    await new Promise(r => setTimeout(r, 600))
    const jobId = Math.floor(Math.random() * 9000) + 1000
    setTowerJobId(jobId)
    for (const status of ['Waiting', 'Running', 'Running', 'Running', 'Successful']) {
      setTowerJobStatus(status)
      await new Promise(r => setTimeout(r, 700))
    }
    setTowerJobRunning(false)
    showToast(`Tower job #${jobId} completed successfully`, 'success')
  }

  async function handleTfPlan() {
    setTfPlanRunning(true)
    setTfPlanOutput('')
    await new Promise(r => setTimeout(r, 1200))
    setTfPlanOutput(buildTerraformPlanOutput(autoDeviceNames))
    setTfPlanRunning(false)
  }

  // ── Derived: device list for ZTP / checks selectors ───────────────────────
  // B2: when the user selects the NetBox source (Step 1 import panel), the
  // imported inventory replaces the BOM-derived list.
  const simDevices = useMemo(() => {
    if (deviceSource === 'netbox' && netboxDevices.length > 0) {
      return netboxDevices.map(d => ({ name: d.name, role: d.role || 'device' }))
    }
    if (storeDevices.length > 0) {
      const flat: Array<{name: string; role: string}> = []
      for (const d of storeDevices) {
        const count = Math.min(d.count, 4)
        for (let i = 1; i <= count; i++) {
          flat.push({ name: `${d.hostname}-${String(i).padStart(2,'0')}`, role: d.role })
        }
      }
      return flat
    }
    return allDevices.map(d => ({ name: d.name, role: d.role }))
  }, [deviceSource, netboxDevices, storeDevices, allDevices])

  // Auto-tick demo metrics every 15 s when on monitor tab and backend offline
  useEffect(() => {
    if (tab !== 'monitor' || isLive) return
    const initial = simulateMonitoringMetrics(simDevices, monitorTick)
    setDemoMetrics(initial)
    const id = setInterval(() => {
      setMonitorTick(t => {
        const next = t + 1
        const m = simulateMonitoringMetrics(simDevices, next)
        setDemoMetrics(m)
        Object.entries(m.devices).forEach(([name, dm]) => {
          if (!sparkRef.current[name]) sparkRef.current[name] = []
          sparkRef.current[name] = [...sparkRef.current[name].slice(-7), dm.throughput_mbps]
        })
        return next
      })
    }, 15_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isLive, simDevices.length])

  // ── Expanded state for grouped checks display ──────────────────────────────
  const [expandedCheckDevices, setExpandedCheckDevices] = useState<Set<string>>(new Set())
  const [preResults, setPreResults] = useState<CheckResult[]>([])
  const [postResults, setPostResults] = useState<CheckResult[]>([])

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
      <div className="flex gap-0 border-b border-white/10" role="tablist" aria-label="Deploy & Validate sections">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={e => {
              const idx = tabs.findIndex(x => x.id === tab)
              if (e.key === 'ArrowRight') { e.preventDefault(); setTab(tabs[(idx + 1) % tabs.length].id) }
              if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(tabs[(idx - 1 + tabs.length) % tabs.length].id) }
              if (e.key === 'Home') { e.preventDefault(); setTab(tabs[0].id) }
              if (e.key === 'End') { e.preventDefault(); setTab(tabs[tabs.length - 1].id) }
            }}
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
        <div className="space-y-6" role="tabpanel" id="tabpanel-deploy" aria-labelledby="tab-deploy">

          {/* ── Policy & Approval Gate ────────────────────────────────────── */}
          {!isDeploying && !deployDone && (
            <div className="rounded-xl border border-white/15 bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-200">Policy &amp; Approval Gate</h3>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full border',
                  policyApproved
                    ? 'bg-green-500/15 border-green-500/40 text-green-300'
                    : 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300')}>
                  {policyApproved ? '🔒 LOCKED & APPROVED' : '⚠ PENDING APPROVAL'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">✅</span>
                  <span className="text-gray-300">Change window: Business hours (Mon–Fri 06:00–22:00)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={customPolicyRules ? 'text-green-400' : 'text-yellow-400'}>
                    {customPolicyRules ? '✅' : '⚠️'}
                  </span>
                  <span className="text-gray-300">
                    {customPolicyRules ? 'Custom policy rules loaded' : 'Peer review: Required (0 of 1 approver confirmed)'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={simDevices.length > 3 ? 'text-yellow-400' : 'text-green-400'}>
                    {simDevices.length > 3 ? '⚠️' : '✅'}
                  </span>
                  <span className="text-gray-300">
                    Blast radius: {Math.max(simDevices.length, storeDevices.length)} device(s)
                    {simDevices.length > 3 ? ' — large change, approval gate active' : ' — within safe threshold'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-400">✅</span>
                  <span className="text-gray-300">Rollback plan: Platform-native checkpoint strategy configured</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-white/10">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={policyConfirmed}
                    onChange={e => { setPolicyConfirmed(e.target.checked); if (!e.target.checked) setPolicyApproved(false) }}
                    className="accent-blue-500 w-4 h-4"
                  />
                  <span className="text-xs text-gray-300">I confirm this change has been reviewed and approved</span>
                </label>
                <button
                  disabled={!policyConfirmed || policyApproved}
                  onClick={() => { setPolicyApproved(true); showToast('Change approved and locked', 'success') }}
                  className={cn(
                    'ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                    policyConfirmed && !policyApproved
                      ? 'bg-green-600/20 border-green-500/40 text-green-300 hover:bg-green-600/30 cursor-pointer'
                      : policyApproved
                      ? 'bg-green-700/20 border-green-600/30 text-green-500 cursor-default'
                      : 'opacity-40 border-white/10 text-gray-500 cursor-not-allowed',
                  )}
                >
                  {policyApproved ? '🔒 Approved & Locked' : 'Approve & Lock'}
                </button>
              </div>
            </div>
          )}

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

            <Button onClick={handleStartDeploy} disabled={isDeploying || (!deployDone && !policyApproved)}>
              {isDeploying ? '⏳ Deploying…' : '🚀 Start Deploy'}
            </Button>
            {!deployDone && !policyApproved && !isDeploying && (
              <span className="text-xs text-yellow-400 italic">Approve policy gate to enable deployment</span>
            )}

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
                setPolicyApproved(false)
                setPolicyConfirmed(false)
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

          {/* ── Config Automation section ─────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Config Automation</CardTitle>
            </CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Push configurations via Ansible Tower/AWX, Terraform, or download standalone scripts.
            </p>
            {/* Sub-tab strip */}
            <div className="flex gap-1 mb-5 bg-white/[0.03] rounded-lg p-1 w-fit">
              {(['ansible', 'terraform', 'manual'] as const).map(at => (
                <button key={at} onClick={() => setAutomationTab(at)}
                  className={cn('px-4 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer',
                    automationTab === at ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200')}>
                  {at === 'ansible' ? '🔧 Ansible Tower' : at === 'terraform' ? '🏗 Terraform' : '📜 Script'}
                </button>
              ))}
            </div>

            {/* Ansible Tower panel */}
            {automationTab === 'ansible' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Tower / AWX URL</label>
                    <input value={towerUrl} onChange={e => setTowerUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Job Template</label>
                    <select value={towerTemplate} onChange={e => setTowerTemplate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                      {['Deploy Network Config', 'ZTP Bootstrap', 'Pre-check Baseline', 'Post-check Validation', 'Config Rollback'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Extra Variables (JSON)</label>
                  <pre className="bg-[#080E1A] border border-white/10 rounded p-3 text-xs text-green-300 font-mono overflow-x-auto">
                    {towerExtraVars}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                  <Button onClick={handleTowerLaunch} disabled={towerJobRunning}>
                    {towerJobRunning ? '⏳ Launching…' : '▶ Launch Job'}
                  </Button>
                  <Button variant="secondary" size="sm"
                    onClick={() => { downloadBlob('inventory.ini', buildAnsibleInventory(autoDeviceNames)); showToast('inventory.ini downloaded', 'success') }}>
                    ↓ Download Inventory
                  </Button>
                  <Button variant="secondary" size="sm"
                    onClick={() => { downloadBlob('deploy_playbook.yml', buildAnsiblePlaybook(deployLog, autoDeviceNames)); showToast('deploy_playbook.yml downloaded', 'success') }}>
                    ↓ Download Playbook
                  </Button>
                  {towerJobId && (
                    <span className={cn('text-xs font-mono px-3 py-1 rounded border',
                      towerJobStatus === 'Successful' ? 'bg-green-500/10 border-green-500/30 text-green-300'
                      : towerJobStatus === 'Failed' ? 'bg-red-500/10 border-red-500/30 text-red-300'
                      : 'bg-blue-500/10 border-blue-500/30 text-blue-300 animate-pulse')}>
                      Job #{towerJobId} · {towerJobStatus}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Terraform panel */}
            {automationTab === 'terraform' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Provider</label>
                  <select value={tfProvider} onChange={e => setTfProvider(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                    <option value="cisco_nso">Cisco NSO</option>
                    <option value="netbox">Netbox</option>
                    <option value="nautobot">Nautobot</option>
                    <option value="generic">Generic / null_resource</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">main.tf</label>
                  <pre className="bg-[#080E1A] border border-white/10 rounded p-3 text-xs text-green-300 font-mono overflow-x-auto max-h-64">
                    {buildTerraformMain(tfProvider, autoDeviceNames.slice(0, 6))}
                  </pre>
                </div>
                {tfPlanOutput && (
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">terraform plan output</label>
                    <pre className="bg-[#080E1A] border border-white/10 rounded p-3 text-xs text-yellow-300 font-mono overflow-x-auto max-h-48">
                      {tfPlanOutput}
                    </pre>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleTfPlan} disabled={tfPlanRunning}>
                    {tfPlanRunning ? '⏳ Planning…' : '▶ Terraform Plan (Demo)'}
                  </Button>
                  <Button variant="secondary" size="sm"
                    onClick={() => { downloadBlob('main.tf', buildTerraformMain(tfProvider, autoDeviceNames)); showToast('main.tf downloaded', 'success') }}>
                    ↓ main.tf
                  </Button>
                  <Button variant="secondary" size="sm"
                    onClick={() => { downloadBlob('terraform.tfvars', buildTerraformVars(autoDeviceNames)); showToast('terraform.tfvars downloaded', 'success') }}>
                    ↓ terraform.tfvars
                  </Button>
                </div>
              </div>
            )}

            {/* Manual / Script panel */}
            {automationTab === 'manual' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Script</label>
                  <div className="flex gap-2 flex-wrap mb-3">
                    {(['push', 'precheck', 'postcheck'] as const).map(s => (
                      <button key={s} onClick={() => setScriptType(s)}
                        className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                          scriptType === s ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'border-white/10 text-gray-400 hover:border-white/20')}>
                        {s === 'push' ? '🚀 Push Configs' : s === 'precheck' ? '🔍 Pre-Check' : '✅ Post-Check'}
                      </button>
                    ))}
                  </div>
                  <pre className="bg-[#080E1A] border border-white/10 rounded p-3 text-xs text-green-300 font-mono overflow-x-auto max-h-72">
                    {scriptType === 'push' ? buildPushConfigsScript().slice(0, 800) + '\n# ... (download for full script)'
                     : scriptType === 'precheck' ? buildPreCheckScript().slice(0, 800) + '\n# ... (download for full script)'
                     : buildPostCheckScript().slice(0, 800) + '\n# ... (download for full script)'}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" size="sm"
                    onClick={() => {
                      const [fn, content] = scriptType === 'push' ? ['push_configs.py', buildPushConfigsScript()]
                        : scriptType === 'precheck' ? ['pre_check.py', buildPreCheckScript()]
                        : ['post_check.py', buildPostCheckScript()]
                      downloadBlob(fn, content)
                      showToast(`${fn} downloaded`, 'success')
                    }}>
                    ↓ Download Script
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* L1: Observability — Alerts, RCA, Deploy Feed */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <button
              onClick={() => setShowObservability(o => !o)}
              aria-expanded={showObservability}
              aria-controls="observability-content"
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-white/[0.03] transition-colors cursor-pointer"
            >
              <span>Observability Panel</span>
              <span className="text-xs text-gray-500" aria-hidden="true">{showObservability ? '▾ collapse' : '▸ expand'}</span>
            </button>
            {showObservability && (
              <div id="observability-content" className="border-t border-white/10">
                <div className="flex border-b border-white/10" role="tablist" aria-label="Observability views">
                  {([
                    { key: 'alerts' as const, label: 'Alerts' },
                    { key: 'rca' as const, label: 'Root Cause Analysis' },
                    { key: 'feed' as const, label: 'Deploy Feed' },
                  ]).map(t => (
                    <button
                      key={t.key}
                      role="tab"
                      aria-selected={observabilityTab === t.key}
                      tabIndex={observabilityTab === t.key ? 0 : -1}
                      onClick={() => setObservabilityTab(t.key)}
                      className={cn(
                        'px-4 py-2 text-xs font-medium transition-colors cursor-pointer',
                        observabilityTab === t.key
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                          : 'text-gray-500 hover:text-gray-300',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="p-4 max-h-96 overflow-y-auto">
                  {observabilityTab === 'alerts' && <AlertsPanel />}
                  {observabilityTab === 'rca' && <RcaPanel />}
                  {observabilityTab === 'feed' && <LiveProgressFeed deploymentId={null} />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ZTP tab ─────────────────────────────────────────────────────── */}
      {tab === 'ztp' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-ztp" aria-labelledby="tab-ztp">
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
              <div className="mt-2"><TopologyDiagram devices={bomDevices} /></div>
            </Card>
          )}

          {netboxDevices.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Device Source</CardTitle></CardHeader>
              <div className="flex flex-wrap gap-2 items-center">
                {([
                  { id: 'design' as const, label: `BOM design (${storeDevices.reduce((n, d) => n + Math.min(d.count, 4), 0)} devices)` },
                  { id: 'netbox' as const, label: `NetBox import (${netboxDevices.length} devices)` },
                ]).map(src => (
                  <button
                    key={src.id}
                    onClick={() => { setDeviceSource(src.id); setFailDevice('') }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                      deviceSource === src.id
                        ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                    )}
                  >
                    {src.label}
                  </button>
                ))}
                <span className="text-xs text-gray-500 ml-1">
                  Imported via Step 1 → NetBox/Nautobot panel. Applies to ZTP, checks, and monitoring demo device lists.
                </span>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
                <select value={failDevice} onChange={e => setFailDevice(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="">&mdash; none &mdash;</option>
                  {simDevices.slice(0, 20).map(d => (
                    <option key={d.name} value={d.name}>{d.name} ({d.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail At Stage</label>
                <select value={failAt} onChange={e => setFailAt(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  {ZTP_SIM_STAGES.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
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

          {/* State machine visual — per-device progress strip */}
          {ztpEvents.length > 0 && (() => {
            const deviceNames = Array.from(new Set(ztpEvents.map(e => e.device_name)))
            return (
              <Card>
                <CardHeader><CardTitle>Device State Machine</CardTitle></CardHeader>
                <div className="space-y-3 mt-2">
                  {deviceNames.slice(0, 12).map(devName => {
                    const devEvents = ztpEvents.filter(e => e.device_name === devName)
                    const stageStatus: Record<string, 'done' | 'failed' | 'pending'> = {}
                    for (const ev of devEvents) {
                      stageStatus[ev.state.toUpperCase()] = ev.success ? 'done' : 'failed'
                    }
                    const hasFailed = devEvents.some(e => !e.success)
                    return (
                      <div key={devName}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn('text-xs font-semibold font-mono', hasFailed ? 'text-red-400' : 'text-green-400')}>
                            {devName}
                          </span>
                          <Badge variant={hasFailed ? 'fail' : 'pass'}>{hasFailed ? 'FAILED' : 'ONLINE'}</Badge>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {ZTP_SIM_STAGES.map(stage => {
                            const s = stageStatus[stage.id]
                            return (
                              <div key={stage.id} title={stage.label}
                                className={cn('px-2 py-1 rounded text-xs font-medium border',
                                  s === 'done'   ? 'bg-green-500/15 border-green-500/30 text-green-300' :
                                  s === 'failed' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
                                  'bg-white/5 border-white/10 text-gray-600')}>
                                {stage.icon}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {deviceNames.length > 12 && (
                    <p className="text-xs text-gray-500">… and {deviceNames.length - 12} more devices</p>
                  )}
                </div>
              </Card>
            )
          })()}

          {/* Events table */}
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
        <div className="space-y-6" role="tabpanel" id="tabpanel-checks" aria-labelledby="tab-checks">
          <Card>
            <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
                <select value={failCheckDevice} onChange={e => setFailCheckDevice(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="">&mdash; none &mdash;</option>
                  {simDevices.slice(0, 20).map(d => (
                    <option key={d.name} value={d.name}>{d.name} ({d.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Check</label>
                <select value={failCheck} onChange={e => setFailCheck(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  {CHECK_TEMPLATES.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
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
                <Button variant="ghost" onClick={() => { setCheckResults([]); setCheckPhase(null); setPreResults([]); setPostResults([]) }}>Clear</Button>
              </div>
            </div>
          </Card>

          {checkResults.length > 0 && (() => {
            const pass = checkResults.filter(r => r.status === 'PASS').length
            const fail = checkResults.filter(r => r.status === 'FAIL').length
            const warn = checkResults.filter(r => r.status === 'WARN').length
            const deviceNames = Array.from(new Set(checkResults.map(r => r.device)))
            const grouped: Record<string, CheckResult[]> = {}
            for (const r of checkResults) { (grouped[r.device] ??= []).push(r) }

            return (
              <>
                {/* Summary bar */}
                <div className="grid grid-cols-4 gap-3">
                  <Card className="text-center">
                    <div className="text-lg font-bold text-blue-400">{checkPhase?.toUpperCase()}</div>
                    <div className="text-xs text-gray-500">Phase</div>
                  </Card>
                  <Card className="text-center">
                    <div className="text-xl font-bold text-green-400">{pass}</div>
                    <div className="text-xs text-gray-500">PASS</div>
                  </Card>
                  <Card className="text-center">
                    <div className="text-xl font-bold text-red-400">{fail}</div>
                    <div className="text-xs text-gray-500">FAIL</div>
                  </Card>
                  <Card className="text-center">
                    <div className="text-xl font-bold text-yellow-400">{warn}</div>
                    <div className="text-xs text-gray-500">WARN</div>
                  </Card>
                </div>

                {/* Pre vs Post diff panel */}
                {preResults.length > 0 && postResults.length > 0 && (() => {
                  const diffs = preResults.map(pre => {
                    const post = postResults.find(p => p.device === pre.device && p.name === pre.name)
                    if (!post || pre.status === post.status) return null
                    return { device: pre.device, check: pre.name, before: pre.status, after: post.status }
                  }).filter(Boolean)
                  if (!diffs.length) return null
                  return (
                    <Card>
                      <CardHeader><CardTitle>Pre → Post Delta ({diffs.length} changes)</CardTitle></CardHeader>
                      <div className="space-y-1 mt-2">
                        {diffs.map((d, i) => d && (
                          <div key={i} className="flex items-center gap-3 text-xs px-1 py-1">
                            <span className="font-mono text-gray-400 w-40 truncate">{d.device}</span>
                            <span className="text-gray-500 flex-1">{d.check}</span>
                            <Badge variant={badgeVariant(d.before)}>{d.before}</Badge>
                            <span className="text-gray-500">→</span>
                            <Badge variant={badgeVariant(d.after)}>{d.after}</Badge>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )
                })()}

                {/* K1: Rollback Advisor — closed-loop auto-rollback on post-check regression */}
                {preResults.length > 0 && postResults.length > 0 && (() => {
                  // Expand BOM rows to per-instance hostnames that match the
                  // check device names (e.g. "LEAF-01"), preserving vendor/role.
                  const expanded = storeDevices.flatMap(d => {
                    const count = Math.min(d.count, 4)
                    return Array.from({ length: count }, (_, i) => ({
                      ...d, hostname: `${d.hostname}-${String(i + 1).padStart(2, '0')}`,
                    }))
                  })
                  const ts = rollbackTimestamp()
                  const plan = generateRollbackPlan(preResults, postResults, expanded, ts)
                  if (plan.summary.total === 0) {
                    return (
                      <Card>
                        <CardHeader><CardTitle>🛟 Rollback Advisor</CardTitle></CardHeader>
                        <div className="mt-2 flex items-center gap-2 text-sm text-green-400">
                          <span className="text-lg">✓</span>
                          <span>No regressions detected between pre and post checks — no rollback required.</span>
                        </div>
                      </Card>
                    )
                  }
                  return (
                    <Card className={cn(plan.recommended && 'border-red-500/40')}>
                      <CardHeader>
                        <div className="flex items-center justify-between w-full">
                          <CardTitle>🛟 Rollback Advisor</CardTitle>
                          <button
                            onClick={() => { downloadBlob('rollback-runbook.txt', rollbackPlanToText(plan, ts)); showToast('rollback-runbook.txt downloaded', 'success') }}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            ⬇ Download runbook
                          </button>
                        </div>
                      </CardHeader>

                      {/* Recommendation banner */}
                      <div className={cn(
                        'mt-2 px-4 py-3 rounded-lg border text-sm flex items-start gap-3',
                        plan.recommended
                          ? 'bg-red-500/10 border-red-500/30 text-red-300'
                          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
                      )}>
                        <span className="text-lg leading-none">{plan.recommended ? '⚠️' : 'ℹ️'}</span>
                        <div>
                          <div className="font-semibold">
                            {plan.recommended
                              ? 'Rollback recommended — the change regressed healthy checks.'
                              : 'Minor regressions only — review before rolling back.'}
                          </div>
                          <div className="text-xs mt-0.5 opacity-80">
                            {plan.summary.total} regression(s) across {plan.summary.devices} device(s) ·{' '}
                            {plan.summary.critical} critical · {plan.summary.major} major · {plan.summary.minor} minor
                          </div>
                        </div>
                      </div>

                      {/* Per-device rollback plans */}
                      <div className="space-y-2 mt-3">
                        {plan.devices.map(d => (
                          <div key={d.device} className="rounded-lg border border-white/10 overflow-hidden">
                            <div className="flex items-center gap-3 px-4 py-2 bg-white/[0.02]">
                              <span className="font-mono text-sm font-semibold text-gray-200">{d.device}</span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/15 text-blue-300 border border-blue-500/30">{d.platform}</span>
                              <span className="ml-auto text-xs text-gray-500">{d.regressions.length} regressed</span>
                            </div>
                            <div className="px-4 py-2 space-y-1">
                              {d.regressions.map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <span className="text-gray-500 flex-1 truncate">{r.checkName}</span>
                                  <Badge variant={badgeVariant(r.fromStatus)}>{r.fromStatus}</Badge>
                                  <span className="text-gray-600">→</span>
                                  <Badge variant={badgeVariant(r.toStatus)}>{r.toStatus}</Badge>
                                  <span className={cn(
                                    'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                                    r.severity === 'critical' ? 'bg-red-500/15 text-red-400'
                                      : r.severity === 'major' ? 'bg-orange-500/15 text-orange-400'
                                      : 'bg-yellow-500/15 text-yellow-400',
                                  )}>{r.severity}</span>
                                </div>
                              ))}
                            </div>
                            <pre className="px-4 py-2 bg-black/30 text-xs font-mono text-green-300 overflow-x-auto border-t border-white/5">{d.commands.join('\n')}</pre>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-600 mt-3">
                        Commands restore each device from its <span className="font-mono">pre-deploy-{ts}</span> checkpoint
                        (CLAUDE.md §9 platform-native strategies). In live mode the backend executes rollback automatically
                        from captured backups when post-checks fail.
                      </p>
                    </Card>
                  )
                })()}

                {/* Grouped by device — expandable rows */}
                <div className="space-y-2">
                  {deviceNames.map(devName => {
                    const devResults = grouped[devName] ?? []
                    const devFail = devResults.filter(r => r.status === 'FAIL').length
                    const devWarn = devResults.filter(r => r.status === 'WARN').length
                    const expanded = expandedCheckDevices.has(devName)
                    return (
                      <div key={devName} className="rounded-xl border border-white/10 overflow-hidden">
                        <button
                          onClick={() => setExpandedCheckDevices(prev => {
                            const next = new Set(prev)
                            next.has(devName) ? next.delete(devName) : next.add(devName)
                            return next
                          })}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-white/[0.02] hover:bg-white/5 transition-colors cursor-pointer text-left"
                        >
                          <span className="font-mono text-sm font-semibold text-gray-200">{devName}</span>
                          <div className="flex gap-2 ml-2">
                            {devFail > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30">{devFail} FAIL</span>}
                            {devWarn > 0 && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">{devWarn} WARN</span>}
                            {devFail === 0 && devWarn === 0 && <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/15 text-green-400 border border-green-500/30">ALL PASS</span>}
                          </div>
                          <span className="ml-auto text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
                        </button>
                        {expanded && (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-t border-white/10 bg-white/[0.015]">
                                {['Category', 'Check', 'Status', 'Message'].map(h => (
                                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {devResults.map((r, i) => {
                                const tpl = CHECK_TEMPLATES.find(t => t.name === r.name)
                                return (
                                  <tr key={i} className={cn('border-t border-white/5',
                                    r.status === 'FAIL' ? 'bg-red-500/5' : r.status === 'WARN' ? 'bg-yellow-500/5' : '')}>
                                    <td className="px-4 py-2 text-xs text-gray-500">{tpl?.cat ?? '—'}</td>
                                    <td className="px-4 py-2"><code className="text-xs text-blue-400">{r.name}</code></td>
                                    <td className="px-4 py-2">
                                      <Badge variant={badgeVariant(r.status)}>{badgeIcon(r.status)} {r.status}</Badge>
                                    </td>
                                    <td className="px-4 py-2 text-xs text-gray-400">
                                      {r.message}
                                      {r.remediation && <div className="text-yellow-500 mt-0.5">↳ {r.remediation}</div>}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* ── Monitor tab ─────────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-monitor" aria-labelledby="tab-monitor">

          {/* ── Header: live vs demo badge + grafana link ──────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-blue-400 animate-pulse'}`} />
              <span className="text-xs font-semibold text-gray-400">
                {isLive ? 'Live gNMI Telemetry' : 'Demo Simulation (15 s refresh)'}
              </span>
              <span className="text-xs text-gray-600">· tick #{monitorTick}</span>
            </div>
            {isLive && (
              <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer"
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border
                  bg-orange-500/10 border-orange-500/30 text-orange-300 hover:bg-orange-500/20 transition-colors">
                📊 Open Grafana →
              </a>
            )}
            {isLive && (
              <div className="flex gap-2">
                <Button onClick={() => handlePoll()} disabled={pollPending} size="sm">
                  {pollPending ? 'Polling…' : '⟳ Poll'}
                </Button>
                <Button variant="secondary" size="sm"
                  onClick={() => handlePoll({ 'edge-rtr1': ['interfaces_up'], 'lb1': ['virtual_servers'] })}>
                  Simulate Degraded
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMonitorData(null)}>Clear</Button>
              </div>
            )}
          </div>

          {/* ── Live backend monitoring table ──────────────────────────────── */}
          {isLive && monitorData && (
            <>
              <div className="grid grid-cols-5 gap-3">
                {([
                  { label: 'Total',    val: monitorData.summary.total,              cls: 'text-gray-300' },
                  { label: 'Healthy',  val: monitorData.summary.healthy,             cls: 'text-green-400' },
                  { label: 'Degraded', val: monitorData.summary.degraded,            cls: 'text-yellow-400' },
                  { label: 'Down',     val: monitorData.summary.down,                cls: 'text-red-400' },
                  { label: 'Alerts',   val: monitorData.summary.alerts.length,       cls: 'text-orange-400' },
                ] as const).map(({ label, val, cls }) => (
                  <Card key={label} className="text-center">
                    <div className={`text-2xl font-bold ${cls}`}>{val}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                  </Card>
                ))}
              </div>
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
                    {Object.values(monitorData.health).sort((a, b) => a.device_name.localeCompare(b.device_name)).map(h => (
                      <tr key={h.device_name}
                        className={`border-b border-white/5 ${h.status === 'degraded' ? 'bg-yellow-500/5' : h.status === 'down' ? 'bg-red-500/5' : ''}`}>
                        <td className="px-4 py-2 font-semibold text-gray-200">{h.device_name}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{h.role}</td>
                        <td className="px-4 py-2"><Badge variant={STATUS_BADGE[h.status] ?? 'neutral'}>{h.status}</Badge></td>
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
            </>
          )}

          {/* ── Demo-mode metrics dashboard ────────────────────────────────── */}
          {(() => {
            const metrics = isLive ? liveMetrics : demoMetrics
            if (!metrics) return null
            const devEntries = simDevices.length > 0
              ? simDevices.map(d => ({ name: d.name, metrics: metrics.devices[d.name] })).filter(e => e.metrics)
              : Object.entries(metrics.devices).slice(0, 12).map(([name, m]) => ({ name, metrics: m }))
            if (devEntries.length === 0) return null

            const totalDevices = devEntries.length
            const avgCpu = devEntries.reduce((s, e) => s + e.metrics.cpu_util, 0) / totalDevices
            const avgMem = devEntries.reduce((s, e) => s + e.metrics.mem_util, 0) / totalDevices
            const totalBgp = devEntries.reduce((s, e) => s + e.metrics.bgp_sessions_up, 0)
            const totalErrors = devEntries.reduce((s, e) => s + e.metrics.interface_errors_in + e.metrics.interface_errors_out, 0)

            return (
              <>
                {/* ── Summary row ──────────────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card className="flex items-center gap-4 p-4">
                    <ArcGauge value={avgCpu} color={avgCpu > 80 ? '#EF4444' : avgCpu > 60 ? '#F59E0B' : '#22C55E'} label="Avg CPU" size={72} />
                    <div>
                      <div className="text-xs text-gray-500">Fleet CPU</div>
                      <div className="text-lg font-bold text-white">{avgCpu.toFixed(1)}%</div>
                    </div>
                  </Card>
                  <Card className="flex items-center gap-4 p-4">
                    <ArcGauge value={avgMem} color={avgMem > 85 ? '#EF4444' : avgMem > 70 ? '#F59E0B' : '#60A5FA'} label="Avg Mem" size={72} />
                    <div>
                      <div className="text-xs text-gray-500">Fleet Memory</div>
                      <div className="text-lg font-bold text-white">{avgMem.toFixed(1)}%</div>
                    </div>
                  </Card>
                  <Card className="text-center p-4">
                    <div className="text-3xl font-bold text-green-400">{totalBgp}</div>
                    <div className="text-xs text-gray-500 mt-1">BGP Sessions Up</div>
                  </Card>
                  <Card className="text-center p-4">
                    <div className={`text-3xl font-bold ${totalErrors > 20 ? 'text-red-400' : totalErrors > 5 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {totalErrors}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Interface Errors</div>
                  </Card>
                </div>

                {/* ── Per-device metric cards ───────────────────────────────── */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Device Metrics</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {devEntries.map(({ name, metrics: dm }) => {
                      const spark = sparkRef.current[name] ?? [dm.throughput_mbps]
                      const cpuColor = dm.cpu_util > 80 ? '#EF4444' : dm.cpu_util > 60 ? '#F59E0B' : '#22C55E'
                      const memColor = dm.mem_util > 85 ? '#EF4444' : dm.mem_util > 70 ? '#F59E0B' : '#60A5FA'
                      const hasErrors = (dm.interface_errors_in + dm.interface_errors_out) > 10
                      const hasPfc = dm.pfc_drops > 100
                      return (
                        <div key={name}
                          className={`rounded-xl border p-4 transition-colors ${
                            dm.cpu_util > 80 ? 'border-red-500/30 bg-red-500/5' :
                            hasPfc ? 'border-purple-500/30 bg-purple-500/5' :
                            'border-white/10 bg-white/[0.02]'
                          }`}>
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <div className="text-xs font-bold text-white truncate">{name}</div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                {dm.bgp_sessions_up > 0 ? `${dm.bgp_sessions_up} BGP peers · ${dm.bgp_prefixes_received.toLocaleString()} pfx` : 'L2 device'}
                              </div>
                            </div>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              dm.cpu_util > 80 ? 'text-red-300 bg-red-500/15' : 'text-green-400 bg-green-500/10'}`}>
                              {dm.cpu_util > 80 ? '⚠ HIGH' : '✓ OK'}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mb-3">
                            <ArcGauge value={dm.cpu_util} color={cpuColor} label="CPU" size={60} />
                            <ArcGauge value={dm.mem_util} color={memColor} label="Mem" size={60} />
                            <div className="flex-1">
                              <div className="text-[10px] text-gray-500 mb-1">Throughput</div>
                              <Sparkline values={spark} color="#60A5FA" />
                              <div className="text-[10px] text-blue-400 mt-0.5">{dm.throughput_mbps.toLocaleString()} Mbps</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            {dm.interface_errors_in + dm.interface_errors_out > 0 && (
                              <span className={`px-1.5 py-0.5 rounded ${hasErrors ? 'text-yellow-300 bg-yellow-500/10' : 'text-gray-500 bg-white/5'}`}>
                                errs: {dm.interface_errors_in + dm.interface_errors_out}
                              </span>
                            )}
                            {dm.pfc_drops > 0 && (
                              <span className={`px-1.5 py-0.5 rounded ${hasPfc ? 'text-purple-300 bg-purple-500/10' : 'text-gray-500 bg-white/5'}`}>
                                PFC: {dm.pfc_drops}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* ── BGP session table ─────────────────────────────────────── */}
                {devEntries.some(e => e.metrics.bgp_sessions_up > 0) && (
                  <Card>
                    <CardHeader><CardTitle>BGP Session Summary</CardTitle></CardHeader>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Device', 'Sessions Up', 'Prefixes Recv', 'State'].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {devEntries.filter(e => e.metrics.bgp_sessions_up > 0).map(({ name, metrics: dm }) => (
                            <tr key={name} className="border-b border-white/5">
                              <td className="px-4 py-2 font-mono text-xs text-gray-200">{name}</td>
                              <td className="px-4 py-2 text-green-400 font-semibold">{dm.bgp_sessions_up}</td>
                              <td className="px-4 py-2 text-gray-300">{dm.bgp_prefixes_received.toLocaleString()}</td>
                              <td className="px-4 py-2"><Badge variant="pass">Established</Badge></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </>
            )
          })()}

          {/* ── Alert ticker ───────────────────────────────────────────────── */}
          {!isLive && demoMetrics && simDevices.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Alert Ticker</CardTitle></CardHeader>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {simDevices
                  .map(d => ({ d, m: demoMetrics.devices[d.name] }))
                  .filter(({ m }) => m && (m.cpu_util > 75 || m.pfc_drops > 150 || m.interface_errors_in > 5))
                  .map(({ d, m }) => (
                    <div key={d.name} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-white/[0.03]">
                      <span className={`shrink-0 ${m.cpu_util > 85 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {m.cpu_util > 85 ? '🔴' : '🟡'}
                      </span>
                      <span className="text-gray-300 font-mono">{d.name}</span>
                      <span className="text-gray-500">
                        {m.cpu_util > 85 ? `CPU spike ${m.cpu_util.toFixed(0)}%` :
                         m.pfc_drops > 150 ? `PFC drops: ${m.pfc_drops}` :
                         `If errors: ${m.interface_errors_in + m.interface_errors_out}`}
                      </span>
                      <span className="ml-auto text-gray-600 font-mono">{new Date().toLocaleTimeString()}</span>
                    </div>
                  ))}
                {simDevices.every(d => {
                  const m = demoMetrics.devices[d.name]
                  return !m || (m.cpu_util <= 75 && m.pfc_drops <= 150 && m.interface_errors_in <= 5)
                }) && (
                  <div className="text-xs text-gray-600 text-center py-3">✓ No active alerts</div>
                )}
              </div>
            </Card>
          )}

          {/* ── Observability Downloads (M-51 M-52, C1) ─────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Observability Downloads</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              SNMP exporter config, Logstash Grok patterns, NetFlow/sFlow, gNMI collector configs,
              Prometheus alert rules, and Grafana dashboard — all derived from your BOM device list.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('snmp.yml', genSNMPExporterConfig(storeDevices)); showToast('snmp.yml downloaded', 'success') }}>
                ↓ SNMP Exporter Config
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('snmp-scrape.yml', genSNMPPrometheusJob(storeDevices)); showToast('snmp-scrape.yml downloaded', 'success') }}>
                ↓ SNMP Prometheus Job
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('network-grok.conf', buildGrokPatternsConfig()); showToast('network-grok.conf downloaded', 'success') }}>
                ↓ Grok Patterns
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('netflow-config.txt', buildNetflowConfig()); showToast('netflow-config.txt downloaded', 'success') }}>
                ↓ NetFlow Config
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('gnmic.yml', genGNMICCollectorConfig(storeDevices, orgName)); showToast('gnmic.yml downloaded', 'success') }}>
                ↓ gnmic.yml
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('telegraf-gnmi.conf', genTelegrafGNMIConfig(storeDevices, orgName)); showToast('telegraf-gnmi.conf downloaded', 'success') }}>
                ↓ Telegraf gNMI Config
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('prometheus-alerts.yml', genPrometheusAlertRules(storeDevices, storeUseCase)); showToast('prometheus-alerts.yml downloaded', 'success') }}>
                ↓ Prometheus Alert Rules
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadBlob('grafana-dashboard.json', genGrafanaDashboardJSON(storeDevices, orgName, storeUseCase)); showToast('grafana-dashboard.json downloaded', 'success') }}>
                ↓ Grafana Dashboard
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── NETCONF tab (M-65) ─────────────────────────────────────────── */}
      {tab === 'netconf' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-netconf" aria-labelledby="tab-netconf">
          {/* Interactive NETCONF panel */}
          <Card>
            <CardHeader><CardTitle>NETCONF Interactive Demo</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              RFC 6241 — NETCONF over SSH (port 830). Build and execute NETCONF RPCs against your devices.
              Supported on Juniper JunOS, Cisco IOS-XE 16.6+, Cisco NX-OS (feature netconf), Arista EOS.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Device</label>
                <select value={netconfDevice} onChange={e => setNetconfDevice(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="">&mdash; select device &mdash;</option>
                  {storeDevices.map(d => (
                    <option key={d.id} value={d.id}>{d.hostname} ({d.vendor})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Operation</label>
                <select value={netconfOp} onChange={e => setNetconfOp(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="get-config">get-config</option>
                  <option value="edit-config">edit-config</option>
                  <option value="get">get</option>
                  <option value="lock">lock</option>
                  <option value="unlock">unlock</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Datastore</label>
                <select value={netconfDatastore} onChange={e => setNetconfDatastore(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="running">running</option>
                  <option value="candidate">candidate</option>
                  <option value="startup">startup</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">RPC Request</div>
                <pre className="bg-[#080E1A] border border-white/10 rounded-lg p-4 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed min-h-[180px]">
                  {netconfXML || buildNetconfXMLForOp('get-config', 'running', '')}
                </pre>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wider">
                  RPC Response {netconfResponse && <span className="text-green-400 ml-1">✔</span>}
                </div>
                <pre className={cn(
                  'bg-[#080E1A] border border-white/10 rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed min-h-[180px]',
                  netconfResponse ? 'text-blue-300' : 'text-gray-600')}>
                  {netconfResponse || '// Click "Execute (Demo)" to see response'}
                </pre>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleNetconfExecute} disabled={netconfRunning}>
                {netconfRunning ? '⏳ Executing…' : '▶ Execute (Demo)'}
              </Button>
              <Button variant="secondary" size="sm"
                onClick={() => { downloadText(buildNetconfScript(), 'netconf_push.py'); showToast('netconf_push.py downloaded', 'success') }}>
                ↓ Download NETCONF Script (Python)
              </Button>
              {netconfResponse && (
                <Button variant="ghost" size="sm" onClick={() => setNetconfResponse('')}>Clear</Button>
              )}
            </div>
          </Card>

          {/* YANG reference */}
          <Card>
            <CardHeader><CardTitle>Supported YANG Models</CardTitle></CardHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs">
              {[
                { model: 'ietf-interfaces', rfc: 'RFC 8343', desc: 'Interface management' },
                { model: 'ietf-ip',          rfc: 'RFC 8344', desc: 'IPv4/IPv6 addressing' },
                { model: 'ietf-routing',     rfc: 'RFC 8349', desc: 'Routing instance model' },
                { model: 'openconfig-bgp',   rfc: 'OC Model', desc: 'BGP configuration' },
                { model: 'openconfig-vlan',  rfc: 'OC Model', desc: 'VLAN management' },
                { model: 'Cisco-IOS-XE-native', rfc: 'Native', desc: 'IOS-XE native YANG' },
              ].map(y => (
                <div key={y.model} className="flex gap-2 items-start p-2 rounded-lg bg-white/[0.02] border border-white/10">
                  <code className="text-blue-400 font-mono">{y.model}</code>
                  <span className="text-gray-500 ml-auto shrink-0">{y.rfc}</span>
                  <span className="text-gray-500">{y.desc}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Day-2 Ops tab (M-67) ───────────────────────────────────────── */}
      {tab === 'day2ops' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-day2ops" aria-labelledby="tab-day2ops">
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

          {/* Config Drift Detection (G-A4) */}
          <Card>
            <CardHeader><CardTitle>Config Drift Detection</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Compare the intended (generated) configuration against the latest
              running-config backup to detect unauthorized changes.
            </p>

            {Object.keys(storeConfigs).length === 0 ? (
              <p className="text-sm text-gray-500">
                No generated configs yet — visit Step 3 (Config Generation) to generate device configs first.
              </p>
            ) : (
              <>
                {!isLive && (
                  <div className="flex flex-wrap gap-3 items-end mb-4">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Simulate drift on (optional)</label>
                      <select value={driftFaultDevice} onChange={e => setDriftFaultDevice(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                        <option value="">&mdash; none (all in sync) &mdash;</option>
                        {Object.keys(storeConfigs).map(id => (
                          <option key={id} value={id}>{configIdToHostname[id] ?? id}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <Button onClick={handleDriftCheck} disabled={driftChecking}>
                  {driftChecking ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Checking…
                    </span>
                  ) : '⟳ Run Drift Check'}
                </Button>

                {driftResult && (
                  <div className="mt-4">
                    <p className={cn(
                      'text-sm font-medium mb-3',
                      driftResult.drift_count > 0 ? 'text-yellow-400' : 'text-green-400',
                    )}>
                      {driftResult.drift_count > 0
                        ? `⚠ Drift detected on ${driftResult.drift_count} of ${driftResult.device_count} device(s)`
                        : `✓ All ${driftResult.device_count} device(s) in sync`}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-white/10">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-white/5">
                            {['Device', 'Status', 'Added', 'Removed', ''].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {driftResult.devices.map(d => (
                            <React.Fragment key={d.hostname}>
                              <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                                <td className="px-4 py-2 font-mono text-xs font-semibold text-gray-200">
                                  {configIdToHostname[d.hostname] ?? d.hostname}
                                </td>
                                <td className="px-4 py-2">
                                  {d.no_baseline ? (
                                    <span className="text-xs text-gray-500">— no baseline</span>
                                  ) : d.has_drift ? (
                                    <span className="text-xs text-yellow-400 font-semibold">⚠ Drift detected</span>
                                  ) : (
                                    <span className="text-xs text-green-400 font-semibold">✓ In sync</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-xs text-green-400">
                                  {d.added.length ? `+${d.added.length}` : '—'}
                                </td>
                                <td className="px-4 py-2 text-xs text-red-400">
                                  {d.removed.length ? `-${d.removed.length}` : '—'}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  {d.has_drift && (
                                    <button
                                      onClick={() => toggleDriftDevice(d.hostname)}
                                      className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                                    >
                                      {expandedDriftDevices.has(d.hostname) ? 'Hide diff' : 'View diff'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {d.has_drift && expandedDriftDevices.has(d.hostname) && (
                                <tr className="border-b border-white/5 bg-black/30">
                                  <td colSpan={5} className="px-4 py-3">
                                    <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                                      {d.unified_diff.split('\n').map((line, i) => (
                                        <div
                                          key={i}
                                          className={
                                            line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400'
                                              : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
                                                : 'text-gray-500'
                                          }
                                        >
                                          {line}
                                        </div>
                                      ))}
                                    </pre>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* G-A16: inline remediation */}
                    {driftResult.drift_count > 0 && (
                      <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                          <span className="text-sm font-medium text-gray-200">Inline remediation</span>
                          <Button onClick={handleGenerateRemediation} disabled={remediationPending}>
                            {remediationPending ? 'Generating…' : '🛠 Generate Remediation'}
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">
                          Platform-aware commands to bring drifted devices back to the intended
                          config — restores missing lines, then removes unauthorized ones. Review
                          before applying; nothing is pushed to any device.
                        </p>

                        {remediationResult && (
                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard?.writeText(remediationScriptText())
                                  showToast('Remediation copied to clipboard', 'success')
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                              >
                                ⧉ Copy all
                              </button>
                              <button
                                onClick={() => {
                                  downloadBlob('remediation.txt', remediationScriptText())
                                  showToast('remediation.txt downloaded', 'success')
                                }}
                                className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                              >
                                ↓ Download
                              </button>
                            </div>
                            {remediationResult.devices.map(d => (
                              <div key={d.hostname}>
                                <div className="text-xs font-semibold text-gray-300 mb-1">
                                  {configIdToHostname[d.hostname] ?? d.hostname}
                                  <span className="text-gray-500 font-normal"> · {d.platform} · {d.command_count} cmd</span>
                                </div>
                                <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto rounded bg-black/30 p-3 text-amber-300">
                                  {d.commands.join('\n')}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Compliance Scanner */}
          <Card>
            <CardHeader><CardTitle>Compliance Scanner</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Scan the current design and generated configs against selected compliance
              frameworks ({compliance.length > 0 ? compliance.join(', ') : 'PCI, SOC2 (default)'}).
            </p>
            <div className="flex gap-3 mb-4">
              <Button onClick={() => setComplianceScanResult(runComplianceScan(useAppStore.getState()))}>
                Run Compliance Scan
              </Button>
              {complianceScanResult && (
                <button
                  onClick={() => {
                    const md = exportComplianceReport(complianceScanResult)
                    const blob = new Blob([md], { type: 'text/markdown' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer"
                >
                  Export Report
                </button>
              )}
            </div>

            {complianceScanResult && (
              <div className="space-y-4">
                {/* Score badge */}
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'text-3xl font-bold',
                    complianceScanResult.score >= 80 ? 'text-green-400' : complianceScanResult.score >= 60 ? 'text-yellow-400' : 'text-red-400'
                  )}>
                    {complianceScanResult.score}%
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-green-400">{complianceScanResult.summary.pass} PASS</span>
                    <span className="text-red-400">{complianceScanResult.summary.fail} FAIL</span>
                    <span className="text-yellow-400">{complianceScanResult.summary.warn} WARN</span>
                    {complianceScanResult.summary.na > 0 && (
                      <span className="text-gray-500">{complianceScanResult.summary.na} N/A</span>
                    )}
                  </div>
                </div>

                {/* Controls list grouped by framework */}
                {complianceScanResult.frameworks.map(fw => {
                  const fwControls = complianceScanResult.controls.filter(c => c.framework === fw)
                  if (fwControls.length === 0) return null
                  return (
                    <div key={fw}>
                      <div className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">{fw}</div>
                      <div className="space-y-1.5">
                        {fwControls.map(c => (
                          <div
                            key={c.id}
                            className="flex items-start justify-between gap-3 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02]"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono text-gray-500">{c.id}</span>
                                <span className="text-xs text-gray-500">({c.category})</span>
                              </div>
                              <div className="text-sm text-gray-300 mt-0.5">{c.requirement}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{c.detail}</div>
                            </div>
                            <span className={cn(
                              'text-xs font-semibold rounded px-2 py-0.5 shrink-0',
                              c.status === 'pass' ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                                : c.status === 'fail' ? 'text-red-400 bg-red-500/10 border border-red-500/20'
                                : c.status === 'warn' ? 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'
                                : 'text-gray-400 bg-gray-500/10 border border-gray-500/20',
                            )}>
                              {c.status === 'pass' ? '✓ PASS' : c.status === 'fail' ? '✕ FAIL' : c.status === 'warn' ? '⚠ WARN' : '— N/A'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* K3: Scheduled / periodic compliance + drift scans */}
          <Card>
            <CardHeader><CardTitle>📅 Scheduled Scans</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Define periodic compliance and drift scan watchers. Export the schedule
              as a cron job, systemd timer, or shell script for automated execution.
            </p>

            {/* Watcher list */}
            {scanWatchers.length > 0 && (
              <div className="space-y-2 mb-4">
                {scanWatchers.map(w => (
                  <div key={w.id} className={cn(
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-white/[0.02] text-xs',
                    w.enabled ? 'border-white/10' : 'border-white/5 opacity-50',
                  )}>
                    <span className={cn('w-2 h-2 rounded-full shrink-0', w.enabled ? 'bg-green-400' : 'bg-gray-600')} />
                    <span className="font-semibold text-gray-200 min-w-[8rem] truncate">{w.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/15 text-blue-300 border border-blue-500/30">
                      {w.scanType}
                    </span>
                    <span className="text-gray-500">
                      {INTERVAL_PRESETS.find(p => p.minutes === w.intervalMinutes)?.label ?? `${w.intervalMinutes}m`}
                    </span>
                    <span className="text-gray-500">→ {w.action}</span>
                    {w.frameworks.length > 0 && (
                      <span className="text-gray-600">{w.frameworks.join(', ')}</span>
                    )}
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => setEditingWatcher({ ...w })}
                        className="text-blue-400 hover:text-blue-300 cursor-pointer">Edit</button>
                      <button onClick={() => handleDownloadSystemdTimer(w)}
                        className="text-blue-400 hover:text-blue-300 cursor-pointer">Timer</button>
                      <button onClick={() => handleDeleteWatcher(w.id)}
                        className="text-red-400 hover:text-red-300 cursor-pointer">Del</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Watcher editor form */}
            {editingWatcher && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 mb-4 space-y-3">
                <div className="text-xs font-semibold text-blue-300 mb-2">
                  {scanWatchers.find(w => w.id === editingWatcher.id) ? 'Edit Watcher' : 'New Watcher'}
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Name</label>
                    <input value={editingWatcher.name}
                      onChange={e => setEditingWatcher({ ...editingWatcher, name: e.target.value })}
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-48" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Scan type</label>
                    <select value={editingWatcher.scanType}
                      onChange={e => setEditingWatcher({ ...editingWatcher, scanType: e.target.value as ScanType })}
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                      <option value="both">Compliance + Drift</option>
                      <option value="compliance">Compliance only</option>
                      <option value="drift">Drift only</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Interval</label>
                    <select value={editingWatcher.intervalMinutes}
                      onChange={e => setEditingWatcher({ ...editingWatcher, intervalMinutes: Number(e.target.value) })}
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                      {INTERVAL_PRESETS.map(p => (
                        <option key={p.minutes} value={p.minutes}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Action</label>
                    <select value={editingWatcher.action}
                      onChange={e => setEditingWatcher({ ...editingWatcher, action: e.target.value as ScanAction })}
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                      <option value="report">Report only</option>
                      <option value="remediate">Auto-remediate</option>
                      <option value="alert">Alert (PagerDuty/Slack)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Scope</label>
                    <select value={editingWatcher.scope}
                      onChange={e => setEditingWatcher({ ...editingWatcher, scope: e.target.value as 'all' | 'drifted' })}
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                      <option value="all">All devices</option>
                      <option value="drifted">Drifted only</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Notify email (optional)</label>
                    <input value={editingWatcher.notifyEmail}
                      onChange={e => setEditingWatcher({ ...editingWatcher, notifyEmail: e.target.value })}
                      placeholder="ops@example.com"
                      className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-56" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" checked={editingWatcher.enabled}
                      onChange={e => setEditingWatcher({ ...editingWatcher, enabled: e.target.checked })}
                      className="accent-green-500" />
                    Enabled
                  </label>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button onClick={() => handleSaveWatcher(editingWatcher)}>Save</Button>
                  <button onClick={() => setEditingWatcher(null)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Button onClick={handleAddWatcher}>+ Add Watcher</Button>
              {scanWatchers.length > 0 && (
                <>
                  <button onClick={handleDownloadCron}
                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                    ⬇ Crontab
                  </button>
                  <button onClick={handleDownloadScanScript}
                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer">
                    ⬇ scan-runner.sh
                  </button>
                </>
              )}
            </div>

            {/* Simulated scan history timeline */}
            {scanHistory.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-300 mb-2">Scan History (simulated)</div>
                <div className="space-y-1">
                  {scanHistory.map(e => (
                    <div key={e.id} className={cn(
                      'flex items-center gap-3 px-3 py-1.5 rounded text-xs',
                      e.status === 'ok' ? 'bg-green-500/5 border border-green-500/10'
                        : e.status === 'warn' ? 'bg-yellow-500/5 border border-yellow-500/10'
                        : 'bg-red-500/5 border border-red-500/10',
                    )}>
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        e.status === 'ok' ? 'bg-green-400' : e.status === 'warn' ? 'bg-yellow-400' : 'bg-red-400',
                      )} />
                      <span className="font-mono text-gray-500 w-36 shrink-0">{e.timestamp.slice(0, 19).replace('T', ' ')}</span>
                      <span className="text-gray-400 w-24 truncate">{e.watcherName}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/10 text-blue-300 border border-blue-500/20">{e.scanType}</span>
                      <span className="text-gray-400 flex-1 truncate">{e.detail}</span>
                      <span className="text-gray-600 text-[10px]">{e.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* K2: Closed-Loop Remediation — detect → plan → apply → verify */}
          <Card>
            <CardHeader><CardTitle>🔁 Closed-Loop Remediation</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Run the full Day-2 loop end-to-end: detect drift, generate platform-aware
              remediation, apply it, then re-verify until the design converges.
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Button onClick={handleRunClosedLoop} disabled={loopRunning}>
                {loopRunning ? 'Running loop…' : '▶ Run Loop'}
              </Button>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={loopSimulateDivergence}
                  onChange={e => setLoopSimulateDivergence(e.target.checked)}
                  className="accent-red-500"
                />
                Simulate divergence (device fails to converge)
              </label>
              {loopResult && (
                <button
                  onClick={() => { downloadBlob('closed-loop-report.txt', closedLoopToText(loopResult)); showToast('closed-loop-report.txt downloaded', 'success') }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer"
                >
                  ⬇ Download report
                </button>
              )}
            </div>

            {loopResult && (
              <div className="space-y-4">
                {/* Final status banner */}
                <div className={cn(
                  'px-4 py-3 rounded-lg border text-sm flex items-center gap-3',
                  loopResult.converged
                    ? 'bg-green-500/10 border-green-500/30 text-green-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300',
                )}>
                  <span className="text-lg leading-none">{loopResult.converged ? '✓' : '⚠️'}</span>
                  <div>
                    <div className="font-semibold">
                      {loopResult.converged ? 'System converged' : 'System diverged — manual action required'}
                    </div>
                    <div className="text-xs mt-0.5 opacity-80">
                      {loopResult.summary.converged}/{loopResult.summary.drifted} drifted device(s) converged ·{' '}
                      {loopResult.summary.commands} command(s) applied
                    </div>
                  </div>
                </div>

                {/* Stage timeline */}
                <div className="flex flex-wrap items-stretch gap-2">
                  {loopResult.stages.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2">
                      <div className={cn(
                        'rounded-lg border px-3 py-2 min-w-[8rem]',
                        s.status === 'ok' ? 'border-green-500/30 bg-green-500/5'
                          : s.status === 'warn' ? 'border-yellow-500/30 bg-yellow-500/5'
                          : s.status === 'failed' ? 'border-red-500/30 bg-red-500/5'
                          : 'border-white/10 bg-white/[0.02]',
                      )}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">
                            {s.status === 'ok' ? '✓' : s.status === 'warn' ? '⚠' : s.status === 'failed' ? '✕' : '○'}
                          </span>
                          <span className="text-xs font-semibold text-gray-200">{s.label}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-1 leading-tight">{s.detail}</div>
                      </div>
                      {i < loopResult.stages.length - 1 && <span className="text-gray-600">→</span>}
                    </div>
                  ))}
                </div>

                {/* Per-device convergence */}
                {loopResult.devices.length > 0 && (
                  <div className="space-y-1.5">
                    {loopResult.devices.map(d => (
                      <div key={d.hostname} className="flex items-center gap-3 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs">
                        <span className="font-mono font-semibold text-gray-200 w-40 truncate">{d.hostname}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/15 text-blue-300 border border-blue-500/30">{d.platform}</span>
                        <span className="text-gray-500">{d.driftLinesBefore} drift → {d.commandsApplied} cmd → {d.driftLinesAfter} left</span>
                        <span className={cn(
                          'ml-auto px-2 py-0.5 rounded font-bold',
                          d.converged ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400',
                        )}>
                          {d.converged ? 'CONVERGED' : 'DIVERGED'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Troubleshooting Tooling Engine tab (G-A19) ─────────────────── */}
      {tab === 'troubleshoot' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-troubleshoot" aria-labelledby="tab-troubleshoot">
          <Card>
            <CardHeader><CardTitle>Troubleshooting Tooling Engine</CardTitle></CardHeader>
            <p className="text-xs text-gray-500 mb-4">
              Pick a symptom and a target platform to get a guided diagnostic
              playbook — ordered show/ping commands with what to look for, ranked
              likely causes, and a remediation checklist. Nothing is pushed to any
              device.
            </p>

            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Symptom</label>
                <select
                  value={tsSymptom}
                  onChange={e => setTsSymptom(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  {TROUBLESHOOT_SYMPTOMS.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Platform</label>
                <select
                  value={tsPlatform}
                  onChange={e => setTsPlatform(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  <option value="nxos">NX-OS</option>
                  <option value="iosxe">IOS-XE</option>
                  <option value="eos">Arista EOS</option>
                  <option value="junos">Juniper JunOS</option>
                </select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-gray-400 block mb-1">Affected devices (optional)</label>
                <input
                  value={tsDevicesNote}
                  onChange={e => setTsDevicesNote(e.target.value)}
                  placeholder="e.g. leaf-1, spine-2"
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                />
              </div>
              <Button onClick={handleRunTroubleshoot} disabled={tsRunning}>
                {tsRunning ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running…
                  </span>
                ) : '🩺 Run Diagnostics'}
              </Button>
            </div>
          </Card>

          {tsResult && (
            <>
              {/* Summary banner */}
              <Card>
                <div className="flex items-start gap-3">
                  <Badge variant="neutral" className="text-xs shrink-0">{tsResult.category}</Badge>
                  <div>
                    <div className="text-sm font-semibold text-gray-200 mb-1">
                      {TROUBLESHOOT_SYMPTOMS.find(s => s.key === tsResult.symptom)?.label ?? tsResult.symptom}
                    </div>
                    <p className="text-sm text-gray-400">{tsResult.summary}</p>
                  </div>
                </div>
              </Card>

              {/* Diagnostic steps */}
              <Card>
                <CardHeader><CardTitle>Diagnostic Steps</CardTitle></CardHeader>
                <div className="space-y-3">
                  {tsResult.diagnostic_steps.map(step => (
                    <div key={step.order} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                      <div className="flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 text-xs
                                         font-semibold flex items-center justify-center">
                          {step.order}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-200 mb-2">{step.description}</div>
                          <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto rounded bg-black/40
                                          border border-white/10 px-3 py-2 text-green-300">
                            {step.command}
                          </pre>
                          <div className="mt-2 text-xs text-gray-400">
                            <span className="text-yellow-400 font-semibold">look for: </span>
                            {step.look_for}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Likely causes (ranked, confidence bar) */}
              <Card>
                <CardHeader><CardTitle>Likely Causes</CardTitle></CardHeader>
                <div className="space-y-3">
                  {tsResult.likely_causes.map((c, i) => {
                    const pct = Math.round(c.confidence * 100)
                    const color = pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
                    return (
                      <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="neutral" className="text-xs shrink-0">#{i + 1}</Badge>
                            <span className="text-sm font-semibold text-gray-200">{c.cause}</span>
                          </div>
                          <div className="flex items-center gap-2 w-32 shrink-0">
                            <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                          </div>
                        </div>
                        {c.indicators.length > 0 && (
                          <ul className="space-y-1">
                            {c.indicators.map((ind, j) => (
                              <li key={j} className="text-xs text-gray-400 flex items-start gap-1.5">
                                <span className="text-gray-600 shrink-0">·</span>
                                {ind}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* Remediation checklist */}
              <Card>
                <CardHeader><CardTitle>Remediation</CardTitle></CardHeader>
                <div className="space-y-2">
                  {tsResult.remediation.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02]"
                    >
                      <span className="text-green-400 shrink-0 mt-0.5">☐</span>
                      <span className="text-sm text-gray-300">{r}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* ── Batfish tab (M-68) ─────────────────────────────────────────── */}
      {tab === 'batfish' && (
        <div className="space-y-6" role="tabpanel" id="tabpanel-batfish" aria-labelledby="tab-batfish">
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
