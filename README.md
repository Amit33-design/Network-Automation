# Network-Automation

A collection of Python network automation tools for hyperscale data center and cloud infrastructure.

| Project | Description |
|---|---|
| [`gpu_cluster_net/`](#gpu-cluster-network-automation) | RoCEv2/VXLAN/EVPN config build + DC operational readiness checks |
| [`network_scanner/`](#network-port-scanner) | Internal network port scanner — TCP, UDP, HTTP, HTTPS |

---

## GPU Cluster Network Automation

End-to-end automation for GPU networking clusters on Cisco NX-OS spine-leaf fabric.
Covers config generation, pre-deployment validation, post-deployment verification,
and a full DC operational readiness report — all driven from a single topology YAML.

### Architecture

```
topology.example.yaml          ← single source of truth (spines, leaves, VNIs, RoCEv2 params)
       │
       ├─ gpu-net build        → NX-OS device configs (Jinja2 templates)
       ├─ gpu-net check pre    → pre-deployment checks (physical + baseline)
       ├─ gpu-net check post   → post-deployment checks (control + data plane + RoCEv2)
       └─ gpu-net readiness    → full DC readiness report (text / JSON / HTML)
```

### Install

```bash
pip install pyyaml jinja2
# optional: pip install netmiko   (only needed for live SSH against real devices)
```

### Topology YAML

Define your fabric once in `topology.yaml`. Everything else is driven from it:

```yaml
fabric:
  name: gpu-cluster-dc1
  underlay_asn_spine: 65000
  underlay_asn_leaf_start: 65001
  ntp_servers:
    - 169.254.169.254

  rocev2:
    pfc_priority: 3                   # IEEE 802.1p priority for RoCEv2
    ecn_min_threshold_bytes: 150000
    ecn_max_threshold_bytes: 1500000
    mtu: 9216
    pfc_watchdog_enabled: true
    dcqcn_enabled: true

  vxlan:
    l2_vni: 10100
    l3_vni: 10200
    vlan_id: 100
    vrf_name: GPU-VRF
    anycast_gw_mac: "0000.1111.2222"
    anycast_gw_ip: "10.100.0.1/24"

  spines:
    - name: spine1
      host: 10.0.0.1          # management IP
      loopback0: 10.0.0.1/32
      asn: 65000
      username: admin
      password: "changeme"
      uplink_interfaces:
        - name: Ethernet1/1
          peer_device: leaf1
          peer_interface: Ethernet1/1

  leaves:
    - name: leaf1
      host: 10.0.0.11
      loopback0: 10.0.0.11/32
      vtep_loopback: 10.1.0.11/32
      asn: 65001
      username: admin
      password: "changeme"
      uplink_interfaces:
        - name: Ethernet1/1
          peer_device: spine1
          peer_interface: Ethernet1/1
      gpu_interfaces:
        - name: Ethernet1/10
          description: GPU-SERVER-01-Port0
        - name: Ethernet1/11
          description: GPU-SERVER-01-Port1
```

See [`topology.example.yaml`](topology.example.yaml) for a full 2-spine / 4-leaf example.

### CLI Usage

#### 1. Generate NX-OS Device Configs

```bash
# Generate configs for all devices → configs/ directory
PYTHONPATH=. python -m gpu_cluster_net.cli build \
  --topology topology.example.yaml \
  --output-dir configs/

# Generate config for a single device (printed to stdout)
PYTHONPATH=. python -m gpu_cluster_net.cli build \
  --topology topology.example.yaml \
  --device leaf1
```

Each leaf config includes:
- BGP EVPN (eBGP to spines, route-target auto)
- VXLAN NVE interface with L2/L3 VNI + BGP ingress replication
- Distributed anycast gateway SVI
- RoCEv2 lossless QoS: PFC pause-no-drop, ECN/DCQCN thresholds, PFC watchdog

Each spine config includes:
- BGP EVPN route-reflector (eBGP to all leaves)
- OSPF underlay with BFD
- `NEXT-HOP-UNCHANGED` route-map to preserve VTEP next-hops

#### 2. Pre-Deployment Checks

Run **before** pushing config. Validates the physical layer and baseline state.

```bash
# Dry-run with mock data (no SSH needed)
PYTHONPATH=. python -m gpu_cluster_net.cli check pre \
  --topology topology.example.yaml \
  --mock

# Live check against real devices (requires netmiko)
PYTHONPATH=. python -m gpu_cluster_net.cli check pre \
  --topology topology.example.yaml

# Check specific devices only
PYTHONPATH=. python -m gpu_cluster_net.cli check pre \
  --topology topology.example.yaml \
  --mock \
  --devices spine1,leaf1

# Save report as JSON
PYTHONPATH=. python -m gpu_cluster_net.cli check pre \
  --topology topology.example.yaml \
  --mock \
  -o pre-report.json -f json
```

**Checks performed (per device):**

| Check | What it validates |
|---|---|
| `interfaces_up` | All fabric + GPU ports are admin-up / oper-up |
| `mtu_check` | MTU ≥ 9216 on all interfaces (required for RDMA) |
| `stp_gpu_ports` | GPU ports are STP edge + BPDU guard (no blocking) |
| `lldp_neighbors` | LLDP peers match expected topology YAML |
| `ntp_sync` | NTP synchronized, stratum < 16 |
| `no_existing_bgp` | No unexpected BGP sessions before deployment |
| `hardware_buffers` | Sufficient lossless buffer allocated (≥ 8192 KB) |
| `interface_errors` | No CRC / input / output errors on fabric interfaces |

#### 3. Post-Deployment Checks

Run **after** pushing config. Validates control plane, data plane, and RoCEv2 lossless fabric.

```bash
# Dry-run (mock)
PYTHONPATH=. python -m gpu_cluster_net.cli check post \
  --topology topology.example.yaml \
  --mock

# Live
PYTHONPATH=. python -m gpu_cluster_net.cli check post \
  --topology topology.example.yaml

# Save HTML report
PYTHONPATH=. python -m gpu_cluster_net.cli check post \
  --topology topology.example.yaml \
  --mock \
  -o post-report.html -f html
```

**Checks performed (per device):**

| Check | What it validates |
|---|---|
| `bgp_evpn_sessions` | All BGP EVPN peers are Established |
| `evpn_type2_routes` | EVPN Type-2 (MAC/IP) routes present — proves MAC learning |
| `evpn_type5_routes` | EVPN Type-5 (IP prefix) routes present — proves L3 reachability |
| `vxlan_vni_state` | L2 VNI and L3 VNI are Up in NVE table |
| `vtep_peers` | All leaf VTEPs appear in NVE peer table |
| `anycast_gateway` | Distributed anycast gateway SVI is up and forwarding |
| `pfc_operational` | PFC enabled on RoCEv2 priority queue (default: priority 3) |
| `ecn_thresholds` | ECN min/max thresholds match topology config (DCQCN) |
| `pfc_watchdog` | PFC watchdog enabled — prevents lossless deadlocks |
| `rdma_mtu_path` | End-to-end jumbo MTU path (9000B with DF bit) verified |
| `pfc_storms` | PFC pause frame counts within normal range |

#### 4. Full DC Operational Readiness

Runs pre + post checks together and produces a consolidated verdict.

```bash
# Full readiness — both phases, mock mode
PYTHONPATH=. python -m gpu_cluster_net.cli readiness \
  --topology topology.example.yaml \
  --phase both \
  --mock

# Full readiness, save HTML report
PYTHONPATH=. python -m gpu_cluster_net.cli readiness \
  --topology topology.example.yaml \
  --phase both \
  --mock \
  -o dc-readiness -f html
# Produces: dc-readiness.pre.html  dc-readiness.post.html

# Simulate specific failures (for testing runbooks)
PYTHONPATH=. python -m gpu_cluster_net.cli readiness \
  --topology topology.example.yaml \
  --phase post \
  --mock \
  --simulate-failures pfc_operational,ecn_thresholds,bgp_evpn_sessions
```

**Verdicts:**

| Verdict | Meaning |
|---|---|
| `READY` | All checks passed, no warnings |
| `READY_WITH_WARNINGS` | No failures but some warnings (e.g. high PFC counters) |
| `NOT_READY` | One or more checks failed — DC is not ready |

The CLI exits with code `0` (ready) or `1` (not ready), making it CI/CD pipeline friendly.

### Python API

```python
from gpu_cluster_net.models import Fabric
from gpu_cluster_net.readiness import DCReadiness
from gpu_cluster_net import reporter

# Load topology
fabric = Fabric.from_yaml("topology.yaml")

dr = DCReadiness(fabric)

# Dry-run (no SSH)
pre_report  = dr.run_pre(mock=True)
post_report = dr.run_post(mock=True)

# Live SSH (requires netmiko + correct credentials in topology YAML)
pre_report  = dr.run_pre()
post_report = dr.run_post()

# Check specific devices only
report = dr.run_pre(mock=True, devices=["spine1", "leaf1"])

# Simulate failures for runbook testing
report = dr.run_post(mock=True, fail_checks=["pfc_operational", "ecn_thresholds"])

# Print text report
print(reporter.to_text(pre_report))

# Save HTML report (dark-theme, per-check remediation hints)
reporter.save(post_report, "report.html", fmt="html")

# Save JSON (machine-readable, CI/CD friendly)
reporter.save(pre_report, "pre.json", fmt="json")

# Check overall verdict
if not post_report.is_ready:
    for suite in post_report.suites:
        for result in suite.results:
            if result.failed:
                print(f"[{result.device}] {result.name}: {result.message}")
                print(f"  Fix: {result.remediation}")
```

### Project Structure

```
gpu_cluster_net/
├── __init__.py
├── models.py                     # Fabric, Spine, Leaf, RoCEv2Config, VXLANConfig
├── readiness.py                  # DCReadiness orchestrator
├── reporter.py                   # text / JSON / HTML output
├── cli.py                        # gpu-net CLI (build / check / readiness)
├── config/
│   ├── builder.py                # Jinja2 config generation engine
│   └── templates/
│       ├── nxos_spine.j2         # Spine: BGP EVPN route-reflector + OSPF
│       ├── nxos_leaf.j2          # Leaf: VXLAN VTEP + anycast GW + BGP EVPN
│       └── nxos_rocev2_qos.j2    # RoCEv2 lossless QoS (PFC/ECN/DCQCN)
├── checks/
│   ├── base.py                   # CheckResult, CheckStatus, CheckSuite, BaseChecker
│   ├── pre_deploy.py             # Pre-deployment checks (physical + baseline)
│   └── post_deploy.py            # Post-deployment checks (EVPN + VXLAN + RoCEv2)
└── collector/
    ├── ssh_collector.py          # Live SSH collection via Netmiko (NX-OS parsers)
    └── mock_collector.py         # Mock collector for dry-runs and CI testing
topology.example.yaml             # Full 2-spine / 4-leaf example topology
tests_gpu/                        # 55 unit tests
```

### Running Tests

```bash
pip install pytest pyyaml jinja2
PYTHONPATH=. pytest tests_gpu/ -v
```

---

## Network Port Scanner

Scans your internal network and discovers open TCP, UDP, HTTP, and HTTPS services
across every host in every detected subnet.

### Install

```bash
pip install -r requirements.txt
pip install -e .
```

### CLI Usage

```bash
# Discover local network segments
netscan discover

# Scan all auto-detected local networks
netscan scan

# Scan a specific subnet
netscan scan 192.168.1.0/24

# TCP-only, full port range, save JSON
netscan scan 192.168.0.0/24 --no-udp --tcp-ports 1-1024 -o results.json -f json

# Scan a single host
netscan host 192.168.1.1

# Fast scan: no UDP, no banners
netscan scan --no-udp --no-banners --host-workers 50 --port-workers 100
```

### Python API

```python
from network_scanner import NetworkScanner
from network_scanner.scanner import ScanConfig
from network_scanner import reporter

scanner = NetworkScanner()
results = scanner.scan_networks()           # auto-detect all local subnets
print(reporter.to_text(results))
reporter.save(results, "scan.json", fmt="json")
```

### Project Structure

```
network_scanner/
├── models.py            # PortResult, HostResult, ScanResult
├── network_discovery.py # Interface detection, host ping/probe
├── tcp_scanner.py       # TCP connect scan + banner grabbing
├── udp_scanner.py       # UDP probe scanner (DNS, NTP, SNMP, mDNS, SSDP …)
├── http_scanner.py      # HTTP/HTTPS title + Server header detection
├── scanner.py           # NetworkScanner + ScanConfig
├── reporter.py          # text / JSON / CSV output
└── cli.py               # netscan CLI (discover / scan / host)
tests/                   # 23 unit tests
```

### Running Tests

```bash
pip install pytest
PYTHONPATH=. pytest tests/ -v
```

---

## CI / CD

GitHub Actions runs on every push and PR:

| Job | What it does |
|---|---|
| **Run Tests** | All 78 unit tests (port scanner + GPU cluster) with coverage |
| **DC Readiness Dry-Run** | Full pre + post mock readiness check against example topology |
| **Generate Device Configs** | Builds NX-OS configs from `topology.example.yaml` |

Reports and configs are uploaded as downloadable artifacts on every run.
