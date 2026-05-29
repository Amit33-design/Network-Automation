# NetDesign AI — Standard Operating Procedure (SOP)

**Product:** NetDesign AI v2.4.0  
**GitHub:** https://github.com/Amit33-design/Network-Automation  
**Live App:** https://amit33-design.github.io/Network-Automation/  
**Local Stack:** http://localhost:8080 (Docker Compose)

---

## Table of Contents

1. [Getting Started — Launch & Access](#1-getting-started--launch--access)
2. [Step 1 — Use Case & Organization Setup](#2-step-1--use-case--organization-setup)
3. [Step 2 — Network Requirements](#3-step-2--network-requirements)
4. [Step 3 — Product Selection](#4-step-3--product-selection)
5. [Step 4 — AI Design Generation](#5-step-4--ai-design-generation)
6. [Step 5 — Configuration Generation](#6-step-5--configuration-generation)
7. [Step 6 — Deploy & Validate](#7-step-6--deploy--validate)
   - [6a Deploy](#6a-deploy)
   - [6b Zero Touch Provisioning (ZTP)](#6b-zero-touch-provisioning-ztp)
   - [6c Monitoring & Alerts](#6c-monitoring--alerts)
   - [6d RCA & Troubleshoot](#6d-rca--troubleshoot)
8. [Troubleshooting Engine](#8-troubleshooting-engine)
9. [Policy & Compliance Features](#9-policy--compliance-features)
   - [Custom Policy Generator](#custom-policy-generator)
   - [Policy Rule Engine (YAML DSL)](#policy-rule-engine-yaml-dsl)
10. [Enterprise Features](#10-enterprise-features)
    - [Backend Connection](#backend-connection)
    - [Export — draw.io, Runbook, Ansible, Terraform](#export--drawio-runbook-ansible-terraform)
    - [Drift Detection](#drift-detection)
    - [GitOps Commit](#gitops-commit)
    - [NetBox Sync](#netbox-sync)
    - [Approval Workflow](#approval-workflow)
    - [Integrations Setup](#integrations-setup)
    - [User Profile & API Keys](#user-profile--api-keys)
11. [GitHub Actions CI/CD Pipeline](#11-github-actions-cicd-pipeline)
12. [Demo Mode](#12-demo-mode)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Architecture Reference](#14-architecture-reference)
15. [Common Issues & Fixes](#15-common-issues--fixes)

---

## 1. Getting Started — Launch & Access

### Option A — Local Docker Stack (Full Feature Set)

```bash
# Start Colima (macOS Docker runtime)
colima start

# Start all 7 containers
cd ~/Desktop/netdesign
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
  docker compose -f docker-compose.local.yml up -d

# Open the app
open http://localhost:8080
```

**Service map:**

| Service      | URL                      | Purpose                        |
|--------------|--------------------------|--------------------------------|
| Frontend     | http://localhost:8080    | Browser UI (nginx)             |
| API          | http://localhost:8000    | FastAPI backend                |
| MCP          | http://localhost:8001    | Model Context Protocol server  |
| PostgreSQL   | localhost:5432           | Design/deployment persistence  |
| Redis        | localhost:6379           | Celery task queue              |
| Vault        | localhost:8200           | Secrets management             |
| Worker       | (internal)               | Celery async deploy worker     |

### Option B — GitHub Pages (No Backend, Client-Side Only)

Navigate to https://amit33-design.github.io/Network-Automation/

All Steps 1–5 work fully offline. Step 6 deploy actions and Enterprise exports require a connected backend.

### Option C — Desktop App (macOS)

Open `/Applications/NetDesign AI.app` — the app auto-starts the Docker stack via the LaunchAgent.

---

## 2. Step 1 — Use Case & Organization Setup

**Navigate to:** Step 1 (loads by default)

### Use Cases Available

| Card | Meaning |
|------|---------|
| Campus / Enterprise LAN | 3-tier campus (core/distribution/access), 802.1X NAC |
| Data Center Fabric | Spine-leaf EVPN/VXLAN, BGP underlay |
| AI / GPU Cluster | RoCEv2 lossless fabric, SHARP, NCCL |
| Hybrid (Campus + DC) | Combined campus + data center design |
| WAN / SD-WAN | Branch WAN, MPLS, SD-WAN overlay |
| Multi-Site DC / DCI | EVPN DCI, VXLAN gateway, geographically distributed |

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| Use Case card | Yes | Click to select |
| Organization Name | Yes | Used in all exports and filenames |
| Industry | No | Click a chip; tunes compliance defaults |
| Organization Size | Yes | small / medium / large / enterprise |
| Number of Sites | Yes | 1–100+ |
| Budget Tier | No | SMB <$50K → Hyperscale $5M+ |
| Preferred Vendors | No | Multi-select chips; empty = any vendor |

Click **Continue →** when done.

---

## 3. Step 2 — Network Requirements

Configure the technical parameters that drive AI design decisions.

| Field | Options | Effect |
|-------|---------|--------|
| Redundancy Model | None / Basic / HA / Full | Controls MLAG, dual-uplinks, dual-spine |
| Traffic Pattern | North-South / East-West / Both | Shapes firewall and routing topology |
| Total Hosts | Integer | Used for VLAN sizing and capacity math |
| Bandwidth per Server | 1G / 10G / 25G / 100G / 400G | Link speed recommendations |
| Oversubscription Ratio | Slider (default 3:1) | Uplink sizing to downstream hosts |
| Underlay Protocol | Multi-chip: OSPF / ISIS / eBGP / Static | Fabric underlay routing |
| Overlay Protocol | Multi-chip: VXLAN / EVPN / MPLS / RoCEv2 | Fabric overlay / tunneling |
| Protocol Features | Cards: ECMP / MLAG / BFD / LACP / etc. | Toggle advanced features |
| Firewall Model | Perimeter / Perimeter+Dist / Micro-seg / None | Firewall topology |
| VPN Type | IPSec / GRE / DMVPN / MPLS / SD-WAN | WAN connectivity |
| Latency SLA | Best-effort / <5ms / <1ms / <100µs | Tunes QoS and path selection |
| Automation Tool | Manual / Ansible / Terraform / NETCONF / NAPALM / Cisco NSO | Export format selection |
| Compliance | Multi-chip: PCI-DSS / HIPAA / SOC2 / ISO27001 / NIST | Policy rule tuning |
| NAC | Multi-chip: 802.1X / MAB / CoA / Profiling | Campus access control |
| GPU Specifics | Multi-chip: SHARP / NVLink / InfiniBand / etc. | AI fabric options |
| Extra Notes | Free text | Passed to AI design engine |

Click **Continue →** to proceed.

---

## 4. Step 3 — Product Selection

The tool recommends hardware based on your requirements and optionally selected vendors.

- **Scoring badges** show how well each product matches (%)
- **Click a product card** to select it for that network layer
- **Export BOM (⬇ CSV)** — downloads a bill of materials CSV with part numbers
- Products persist across sessions via localStorage

Layers shown depend on use case (e.g., GPU use case shows GPU spine + TOR rows).

---

## 5. Step 4 — AI Design Generation

Click **Generate Design** to run the AI design engine against your intent.

### What is generated

| Panel | Content |
|-------|---------|
| High-Level Diagram (HLD) | SVG topology showing all device tiers and links |
| IP Plan | Loopback, management, P2P, and VLAN prefix allocations |
| VLAN Plan | VLAN IDs, names, SVI subnets per use case |
| BGP Topology | AS numbers, peer relationships, route reflector layout |
| Capacity Report | Host counts, uplink sizing, oversubscription math |
| Policy Analysis | Gate engine output — PASS/WARN/FAIL per rule |
| Recommendations | Ranked improvement suggestions |
| Intent Summary | Right sidebar — live view of all selections |

### Export from this step

| Button | Output |
|--------|--------|
| ⬇ HLD (SVG) | Scalable vector topology diagram |
| ⬇ LLD (CSV) | Detailed low-level design CSV |
| ⬇ All Configs | Zip of per-device config files |
| 📄 HTML Report | Self-contained HTML design report |

### Failure Simulation

In the topology panel, trigger a link failure simulation to verify ECMP and redundancy hold under failure scenarios.

---

## 6. Step 5 — Configuration Generation

NetDesign AI generates complete device configurations for all modelled devices.

### Workflow

1. **Select a device** from the left device list
2. **View generated config** in the right panel (full CLI syntax per platform)
3. **Edit inline** — the config panel is editable
4. **Diff view** — click the diff icon to compare current vs previous version (powered by `diffengine.js`)
5. **Apply to device** — push config via backend `/api/deploy` (requires backend)

### Enterprise Export Bar (bottom of Step 5)

| Button | Action |
|--------|--------|
| 📐 draw.io | Download `.drawio` topology XML (open in draw.io desktop or Confluence) |
| 📋 Runbook .md | Markdown runbook with all configs, change log, approval info |
| 📄 Runbook PDF | Same runbook as PDF (requires WeasyPrint in backend) |
| ⚙️ Ansible | Download `playbook.yml` + `inventory.yml` for all devices |
| 🏗 Terraform | Download `main.tf` (NetBox provider, all device resources) |
| 📡 Drift Check | Compare current design intent vs live gNMI telemetry |
| 🗄 Sync Netbox | Sync device list into NetBox via `/api/integrations/netbox/sync-devices` |
| 🐙 Commit to GitHub | GitOps commit — pushes configs to your git repo, optionally opens a PR |
| ✅ Request Approval | Opens approval workflow — assign reviewers, set SLA |

---

## 7. Step 6 — Deploy & Validate

### 6a Deploy

**Prerequisite:** Backend connected (status dot green in top-right)

1. Click **Deploy** in the Deploy & Validate section
2. The app calls `POST /api/deploy` with the full design payload
3. Celery worker picks up the task and streams progress via WebSocket
4. Live progress feed shows per-device status: `PENDING → IN_PROGRESS → DONE / FAILED`
5. On completion, deployment ID is logged and visible in audit trail

**Gate Check** — before deploy, the gate engine runs all policy rules:
- **PASS (green)** — all critical rules pass; deploy proceeds
- **WARN (amber)** — advisory findings; deploy proceeds with warning banner
- **FAIL (red)** — critical rule violated; deploy is blocked until resolved

### 6b Zero Touch Provisioning (ZTP)

For new devices that need bootstrap config without manual SSH:

1. Navigate to **ZTP** sub-section (sidebar or ZTP tab in Step 6)
2. Enter device serial numbers or MAC addresses
3. The ZTP server (`/api/ztp/provision`) generates a bootstrap config
4. Device calls home via DHCP option 67 / HTTP, receives config, reboots with full config

### 6c Monitoring & Alerts

Connects to the gNMI streaming telemetry pipeline:

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| BGP Prefix Count | gNMI → Prometheus | CRITICAL if drops to 0 |
| CPU Utilization | gNMI → Prometheus | WARN >80%, CRITICAL implied |
| Memory Utilization | gNMI → Prometheus | CRITICAL >90% |
| PFC Watchdog Drops | gNMI → Prometheus | CRITICAL >100 cumulative |
| Interface Error Rate | gNMI → Prometheus | WARN >50 per interface |

**Refresh alerts:** click the Refresh button or wait for auto-poll (every 30s).

To enable live telemetry, set in `.env`:
```
ENABLE_TELEMETRY=1
GNMI_DEVICES=[{"hostname":"spine-01","ip":"10.0.0.1","port":57400,"platform":"nxos","username":"admin","password":"..."}]
```

### 6d RCA & Troubleshoot

When alerts fire, open the **RCA** panel:

1. Enter symptom description in the RCA input (or click an alert to pre-fill)
2. Click **Analyze** — calls `POST /api/rca/analyze`
3. The RCA engine correlates:
   - Recent deployment events (last 2 hours)
   - Live telemetry anomalies
   - Topology topology data (affected devices, neighbors)
4. Results show: probable root cause, confidence score, recommended remediation steps

---

## 8. Troubleshooting Engine

Access via the **🔧 Troubleshooting Engine** button in the sidebar (or top-right tools).

### How to use

1. Type a symptom or error keyword into the search bar
2. The engine matches against a library of **35+ hypothesis entries** spanning:

| Category | Examples |
|----------|---------|
| Physical / L1 | Interface flap, optic fault, cable fault, SFP mismatch |
| Data Link / L2 | STP TCN, BPDU guard, VLAN mismatch, native VLAN, LLDP |
| Routing / L3 | BGP session down, OSPF adjacency, route missing, ECMP, redistribution |
| Overlay | VXLAN VNI mismatch, EVPN type-5 missing, VTEP unreachable |
| VPN | IPSec phase 1/2, GRE MTU, DMVPN NHS, MPLS label |
| QoS | Egress queue drops, WRED, DSCP remarking, classification |
| AI Fabric (NEW) | PFC storm, ECN misconfiguration, **rail imbalance**, **buffer occupancy profiling**, **NCCL collective latency**, **GPU NIC firmware mismatch** |
| Control Plane | CoPP, SNMP overload, BGP update storm |
| Security | ACL hit counter, NAT exhaustion, DDoS flood, uRPF |
| DNS / DHCP / NTP | Resolution failure, relay, pool exhaustion, clock skew |
| Management | SNMP OID, syslog, AAA, SSH lockout |

3. For each match, the engine shows:
   - **Hypothesis** — most probable root cause
   - **Confidence** — 0–100%
   - **Evidence** — why this hypothesis fits the symptom
   - **Step-by-step diagnosis commands** (copy-paste ready)
   - **Remediation** — exact commands to fix

4. Use **RCA Integration** — click "Investigate" to feed findings into the RCA panel

---

## 9. Policy & Compliance Features

### Custom Policy Generator

Access via **📄 Config Policy** in the top-right utility bar.

Generates platform-specific compliance configuration snippets:

| Platform | Config type |
|----------|-------------|
| Cisco IOS/IOS-XE | AAA, SNMP, SSH, banner, logging |
| NX-OS | Feature-enable, VPC, VLAN, NTP |
| Arista EOS | Management, AAA, STP |
| Palo Alto | Baseline security policy blocks |

Use case: paste the generated snippet into a device config or include it in an Ansible playbook.

### Policy Rule Engine (YAML DSL)

Access via **📋 Rule Editor** in the top-right utility bar.

This is a full rule authoring system. Rules are evaluated against your design intent.

#### Loading a built-in compliance pack

1. Click **Rule Editor** in the top bar
2. In the **Load Pack** dropdown, select:
   - `ai_fabric` — 9 rules for RoCEv2/PFC/ECN/SHARP/MTU/redundancy
   - `dc_baseline` — 6 rules for EVPN/BGP/redundancy/VXLAN
   - `security_baseline` — 5 rules for WAN encryption/NAC/MACsec/compliance
3. The YAML loads into the editor

#### Authoring custom rules

Rules follow this YAML DSL:

```yaml
rules:
  - id: require-ecn
    description: "ECN must be enabled for lossless AI fabric"
    severity: FAIL        # FAIL | WARN | INFO
    conditions:
      - field: uc
        op: eq
        value: gpu
      - field: protoFeatures
        op: not_contains
        value: ECN
    message: "AI/GPU use case requires ECN (Explicit Congestion Notification)"

  - id: mtu-check
    description: "Jumbo frames required for RoCEv2"
    severity: FAIL
    conditions:
      - field: uc
        op: eq
        value: gpu
    config_check:
      op: config_not_contains
      value: "mtu 9216"
    message: "Config must set MTU 9216 for RoCEv2 lossless operation"
```

**Available operators:**

| Op | Meaning |
|----|---------|
| `eq` | field equals value |
| `neq` | field does not equal value |
| `contains` | list field contains value |
| `not_contains` | list field does not contain value |
| `gte` | numeric field ≥ value |
| `lte` | numeric field ≤ value |
| `config_contains` | device config text contains string |
| `config_not_contains` | device config text does not contain string |

#### Workflow

| Button | Action |
|--------|--------|
| Validate | Parse YAML and report syntax/semantic errors without saving |
| Save | Save ruleset (in-memory, persists for session) |
| Evaluate | Run all rules against current design STATE + generated configs |
| Version History | View all saved versions of this ruleset with timestamps |
| Delete | Soft-delete the ruleset |

**Results:**

| Badge | Meaning |
|-------|---------|
| 🟢 PASS | No violations |
| 🟡 WARN | Advisory findings — design can proceed |
| 🔴 FAIL | Critical violations — fix before deploying |
| ⛔ BLOCK | Multiple critical failures — deploy is blocked |

#### API endpoints (for CI/CD integration)

```bash
# List built-in packs
GET  /api/user-policies/packs

# Validate YAML without saving
POST /api/user-policies/validate
{"yaml_content": "rules:\n  - ..."}

# Create a ruleset
POST /api/user-policies
{"name": "My Rules", "yaml_content": "...", "org_id": "my-org"}

# Evaluate inline (no save)
POST /api/user-policies/evaluate-yaml
{"yaml_content": "...", "intent": {...}, "configs": {"SPINE-01": "..."}}

# Evaluate saved ruleset against intent
POST /api/user-policies/{id}/evaluate
{"intent": {...}, "configs": {...}}
```

---

## 10. Enterprise Features

All enterprise features require backend connection.

### Backend Connection

1. Click the **status dot** (top-right, shows gray/red when disconnected)
2. Enter your backend URL (default: `http://localhost:8000`)
3. Enter credentials (default dev: `admin` / `admin`)
4. Click **Sign In** — dot turns green on success

### Export — draw.io, Runbook, Ansible, Terraform

Located in the Enterprise export bar at the bottom of Step 5.

#### draw.io Export

Downloads a `.drawio` XML topology file.

- Open in draw.io Desktop, Confluence, or Lucidchart
- Devices are positioned in tier rows with Cisco icon shapes
- Color-coded by role: spine (blue), leaf (green), core (yellow), firewall (purple)
- Legend shows device counts per tier

#### Runbook Export (.md / PDF)

Downloads a complete Markdown or PDF runbook containing:
- Executive summary (org, use case, date)
- Design decisions and intent parameters
- IP plan and VLAN table
- Per-device configurations (full CLI)
- Approval history (if approval was requested)
- Change log

#### Ansible Export

Downloads two files:

**`{org}_ansible.yml`** — full Ansible playbook:
- Pre-flight `wait_for_connection` check
- Per-platform play blocks (ios_config / eos_config / sonic_config / junos_config)
- Per-device config tasks with `when: inventory_hostname == "..."` guards
- Post-deploy verification (`show version` → saved locally)

**`{org}_inventory.yml`** — inventory file:
- All devices with `ansible_host`, `ansible_network_os`
- Replace `REPLACE_ME_*` with actual management IPs if IP plan was not generated

**Usage:**
```bash
ansible-playbook -i {org}_inventory.yml {org}_ansible.yml       # deploy
ansible-playbook -i {org}_inventory.yml {org}_ansible.yml --check  # dry-run
```

#### Terraform Export

Downloads `{org}_main.tf` — Terraform HCL using the NetBox provider:
- `terraform` block with `e-breuninger/netbox ~> 3.0` provider
- `variable "netbox_url"` and `variable "netbox_token"` (sensitive)
- `data` sources for site, tenant, device roles, platforms, device types
- `resource "netbox_device"` for every device
- `resource "netbox_ip_address"` for devices with IPs
- `output "device_ids"` map

**Usage:**
```bash
export TF_VAR_netbox_token="your-token"
terraform init
terraform plan -out=netdesign.tfplan
terraform apply netdesign.tfplan
```

### Drift Detection

Compares live gNMI telemetry against your intended design state.

**Click 📡 Drift Check** in the Enterprise export bar.

The detector runs 6 checks:

| Check | Condition | Severity |
|-------|-----------|----------|
| `redundancy_bgp_peers` | HA/Full design but <2 BGP peers up on a device | CRITICAL |
| `bgp_prefix_drift` | BGP/EVPN in overlay but zero prefixes on all peers | CRITICAL |
| `pfc_lossless_drift` | GPU/AI fabric design but PFC drops >50 | CRITICAL |
| `bandwidth_error_drift` | 100G/400G design but interface errors >100 | WARN |
| `vxlan_evpn_route_drift` | VXLAN overlay but only 1–9 BGP routes | WARN |
| `cpu_drift` | CPU >75% (configurable) | WARN |

Results shown in toast notification + browser console table + alert dialog for any findings.

### GitOps Commit

**Click 🐙 Commit to GitHub**

1. Prompts for a commit message (default: `Deploy: {orgName} design`)
2. Calls `POST /api/integrations/gitops/commit` with:
   - Design ID, name, configs, commit message
3. Backend pushes config files to the configured GitHub repo
4. If PR creation is enabled in Integrations, a PR is auto-opened
5. Toast shows commit SHA, file count, and PR URL (clickable)

### NetBox Sync

**Click 🗄 Sync Netbox**

Calls `POST /api/integrations/netbox/sync-devices` — upserts all modelled devices into your NetBox instance with:
- Hostname, role, platform, site, tenant
- Status: `planned`

Configure the NetBox URL and token in **Enterprise → Integrations → NetBox**.

### Approval Workflow

**Click ✅ Request Approval**

1. Opens the Approvals modal
2. Fill in: approver email, change window, SLA hours, justification
3. Submit — creates an approval record (stored in PostgreSQL)
4. Approver can: **Approve**, **Reject**, **Escalate**, or **Cancel**
5. Approved designs carry an approval reference into the Runbook export

### Integrations Setup

**Click the ⚡ Demo button → or navigate via sidebar → Integrations**

Configure third-party system connections:

| Integration | Fields | Used by |
|-------------|--------|---------|
| GitHub / GitLab | URL, token, org, repo, branch | GitOps commit, CI pipeline |
| NetBox | URL, API token | Device sync, Terraform reference |
| Cisco NSO | URL, username, password | NETCONF deploy |
| Arista CloudVision | URL, token | EOS device push |
| ServiceNow | URL, client ID/secret, instance | Change management |
| PagerDuty | Integration key | Alert escalation |

Click **Test** on each integration to verify connectivity before use.

### User Profile & API Keys

**Click your avatar / username → Profile**

| Tab | Features |
|-----|---------|
| Profile | Update name, email, role |
| MFA | Set up TOTP (scan QR with Authenticator app) — enable/disable |
| API Keys | Generate named keys, set expiry, copy, revoke |

API keys are used for headless access (CI/CD, scripts):
```bash
curl -H "Authorization: Bearer nd_..." http://localhost:8000/api/alerts
```

---

## 11. GitHub Actions CI/CD Pipeline

File: `.github/workflows/netdesign-validate.yml`

Triggers on push to `main` / `release/**` and on pull requests to `main`.

### Jobs

| Job | What it does | Blocks on failure |
|-----|-------------|-------------------|
| **intent-lint** | Runs `static_analysis.py` on a minimal design state — fails if any CRITICAL check fires | Yes |
| **policy-validate** | Evaluates `dc_baseline` and `security_baseline` compliance packs | Yes (dc_baseline), No (security_baseline — advisory) |
| **unit-tests** | Runs pytest with real PostgreSQL + Redis — coverage must be ≥55% | Yes |
| **static-analysis** | Runs 26-check static analysis battery on Campus HA + AI Fabric scenarios | Yes |
| **frontend-typecheck** | Runs `tsc --noEmit` on the React scaffold if `frontend/` exists | Yes (if present) |
| **simulation** | Link failure simulation — ensures HA design maintains partial path | Yes |

### Adding your own policy rules to CI

In `netdesign-validate.yml`, under the `policy-validate` job, add:

```yaml
- name: Run custom ruleset
  working-directory: backend
  run: |
    python - <<'EOF'
    from policies.user_rule_engine import evaluate, validate_yaml
    import sys

    with open("policies/packs/my_rules.yaml") as f:
      yaml_content = f.read()

    ok, errors, count = validate_yaml(yaml_content)
    if not ok:
      print(f"FAIL: {errors}")
      sys.exit(1)

    intent = {"uc": "datacenter", "overlayProto": ["VXLAN", "EVPN"]}
    results = evaluate(yaml_content, intent, {})
    if results.violations:
      sys.exit(1)
    EOF
```

---

## 12. Demo Mode

**Click ⚡ Demo** in the top-right utility bar.

Loads a pre-populated design scenario (Data Center Fabric — EVPN/VXLAN) across all 6 steps so you can explore the full product without filling in forms.

Use this to:
- Show the product to stakeholders
- Explore export formats with real data
- Test the Troubleshooting Engine and RCA

---

## 13. Keyboard Shortcuts

Access via **⌨** button in the top-right utility bar.

| Shortcut | Action |
|----------|--------|
| `→` / `L` | Next step |
| `←` / `H` | Previous step |
| `G` then `1`–`6` | Jump to step N |
| `T` | Open Troubleshooting Engine |
| `D` | Open Demo mode |
| `?` | Show keyboard shortcuts overlay |
| `Esc` | Close any open modal |

---

## 14. Architecture Reference

```
Browser (vanilla JS + CSS)
  │
  ├─ state.js          — global STATE object, step metadata, UC labels
  ├─ app.js            — step navigation, progress bar, sidebar, validation
  ├─ intentmodel.js    — AI design engine (pure JS, offline)
  ├─ topology.js       — SVG diagram renderer
  ├─ configgen.js      — per-device config generator
  ├─ policyengine.js   — client-side gate engine
  ├─ gate.js           — gate check UI
  ├─ backend.js        — API client (fetch wrappers, async deploy, WebSocket)
  ├─ observability.js  — alerts + RCA panel
  ├─ ts_engine.js      — troubleshooting engine (35+ playbooks)
  ├─ enterprise.js     — approvals, integrations, exports, GitOps, drift
  ├─ export.js         — SVG/CSV/HTML export
  ├─ policy_rules_editor.js — YAML rule editor + evaluate
  ├─ custom_policy.js  — platform config snippet generator
  ├─ deploy.js         — deployment UI + WebSocket progress feed
  ├─ ztp.js            — ZTP provisioning UI
  ├─ simulation.js     — failure simulation UI
  ├─ capacity.js       — capacity planning panel
  ├─ scoring.js        — product recommendation scoring
  ├─ diffengine.js     — config diff / version history
  └─ storage.js        — localStorage persistence

FastAPI Backend (Python 3.11)
  ├─ main.py           — app entry, CORS, routers, telemetry startup, /api/drift
  ├─ auth.py           — JWT + API key auth, RBAC
  ├─ audit.py          — audit trail (all writes recorded)
  ├─ models.py         — SQLAlchemy ORM + Pydantic schemas
  ├─ db.py             — async PostgreSQL session factory
  │
  ├─ routers/
  │   ├─ export.py         — /api/export/{drawio,runbook,runbook/pdf,ansible,terraform}
  │   ├─ designs.py        — /api/designs CRUD
  │   ├─ deployments.py    — /api/deploy (Celery dispatch + WebSocket)
  │   ├─ user_policies.py  — /api/user-policies CRUD + evaluate
  │   ├─ custom_policy.py  — /api/custom-policy
  │   ├─ approvals.py      — /api/approvals
  │   ├─ integrations.py   — /api/integrations/{github,netbox,nso,...}
  │   └─ users.py          — /api/users, /api/auth
  │
  ├─ policies/
  │   ├─ gate_engine.py    — deployment gate (pre-deploy policy check)
  │   ├─ user_rule_engine.py — YAML DSL evaluator
  │   └─ packs/            — ai_fabric.yaml, dc_baseline.yaml, security_baseline.yaml
  │
  ├─ export/
  │   ├─ drawio.py     — draw.io XML generator
  │   ├─ runbook.py    — Markdown + PDF runbook
  │   ├─ ansible.py    — Ansible playbook + inventory
  │   └─ terraform.py  — Terraform HCL (NetBox provider)
  │
  ├─ telemetry/
  │   ├─ gnmi_collector.py — gNMI streaming → Prometheus metrics
  │   ├─ alerting.py       — alert rules + evaluate_with_drift()
  │   └─ drift_detector.py — DriftDetector (intent vs live metrics)
  │
  ├─ rca/              — RCA analysis engine
  ├─ static_analysis.py — 26-check design linting
  └─ simulation.py     — link failure simulation
```

---

## 15. Common Issues & Fixes

### App shows blank page on localhost:8080

```bash
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock docker compose -f docker-compose.local.yml ps
# If frontend is not healthy, check logs:
docker logs netdesign-frontend
```

### Backend status dot stays red after entering URL

- Confirm API is running: `curl http://localhost:8000/health`
- Check CORS: the backend allows `localhost:8080` and `localhost:3000` by default
- Check `.env` for `SECRET_KEY` — must be non-empty

### Sidebar Deploy & Validate items not visible

Click the **Deploy & Validate** group header to expand it (collapsible accordion). Items are collapsed by default; navigating to Step 6 auto-expands the group.

### Sidebar collapse button doesn't re-expand the sidebar

Click the **◀ / ▶ chevron icon** in the logo bar (top-left of sidebar). The button is always visible even when the sidebar is collapsed at 58px width.

### Ansible export shows `REPLACE_ME_*` IPs

The IP plan was not generated (Step 4 AI design was not run). Run the design engine first, then export Ansible — it will use the generated IP plan for all hosts.

### Terraform `terraform init` fails — provider not found

Ensure you have internet access for the Terraform registry. The provider is `e-breuninger/netbox ~> 3.0`. For air-gapped environments, mirror the provider to a local registry and update the `source` block.

### Drift Check shows no data (backend connected)

Telemetry collection requires `ENABLE_TELEMETRY=1` in `.env` and at least one device reachable via gNMI. Without live telemetry, `/api/drift` returns empty alerts/drift lists — this is expected.

### Docker image not picking up new code changes

Use `--force-recreate` — `docker compose restart` reuses the old container image:
```bash
DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
  docker compose -f docker-compose.local.yml up -d --force-recreate api frontend
```

### GitHub Actions CI failing on `static_analysis` import

Ensure `backend/requirements.txt` includes all dependencies. The CI installs from that file. Check with:
```bash
pip install -r backend/requirements.txt
python -c "from static_analysis import run_analysis; print('OK')"
```

---

*Generated by NetDesign AI v2.4.0 — https://github.com/Amit33-design/Network-Automation*
