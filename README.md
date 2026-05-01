# 🌐 NetDesign AI — Intent-Driven Network Design & Deployment Platform

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://amit33-design.github.io/Network-Automation/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![CI](https://github.com/Amit33-design/Network-Automation/actions/workflows/ci.yml/badge.svg)](https://github.com/Amit33-design/Network-Automation/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/backend-Python%203.11+-blue?style=flat-square&logo=python)](backend/)
[![Ansible](https://img.shields.io/badge/automation-Ansible-red?style=flat-square&logo=ansible)](playbooks/)
[![No Dependencies](https://img.shields.io/badge/frontend-zero%20dependencies-brightgreen?style=flat-square)](index.html)

> **Express network intent. Get topology, configs, and a safe deployment pipeline — instantly.**  
> Requirements → product selection → topology diagrams → device configs → staged deployment validation — entirely in your browser, zero install.

![NetDesign AI Preview](preview.svg)

---

## 🚀 Live Demo

**[amit33-design.github.io/Network-Automation](https://amit33-design.github.io/Network-Automation/)**

No login required. Works on any modern browser. Click **⚡ Demo** for an instant pre-filled walkthrough.

---

## 🎯 Who This Is For

| Audience | What they get |
|---|---|
| **Network Architects** | Generate HLD + LLD + production configs in minutes, not days |
| **Platform / SRE Teams** | Automated, staged deployments with pre/post validation gates |
| **Enterprise Architects** | Standardized multi-vendor design across campus, DC, GPU, and WAN |
| **AI / GPU Infrastructure Teams** | Correctly designed RoCEv2 lossless fabrics with PFC/ECN/DCQCN |
| **Network Automation Engineers** | Structured intent → Ansible / Nornir pipeline scaffold |

### ❌ Not Intended For

- Direct production deployment without prior lab/staging validation
- Environments requiring strict change-control integration (SN, Jira, ServiceNow) — planned
- Automated rollback without operator review — see [Safety Model](#%EF%B8%8F-deployment-safety-model) below

---

## 🧩 Intent Model — Core Abstraction

All designs in NetDesign AI are driven by a **structured intent object** — a declarative description of *what* you need, not *how* to configure it.

```json
{
  "use_case": "dc",
  "scale": "large",
  "redundancy": "ha",
  "protocols": ["bgp", "is-is", "evpn"],
  "overlay": "vxlan",
  "security": ["macsec", "802.1x"],
  "compliance": ["pci-dss"],
  "gpu": true,
  "rocev2": true,
  "budget": "enterprise",
  "vendor_preference": "cisco"
}
```

This single intent object is translated by the platform into every downstream artifact:

```
Intent Object
    ├── → Scored Product Recommendations (BOM)
    ├── → HLD Topology SVG (animated)
    ├── → LLD Tables (IP plan, VLAN, BGP, physical)
    ├── → Device Configs (IOS-XE / NX-OS / EOS / Junos / SONiC)
    └── → Deployment Workflow (pre-checks → push → post-checks)
```

> This is the same abstraction model used by production intent-based networking systems — expressed as a browser-first tool.

---

## 🛡️ Deployment Safety Model

NetDesign AI enforces a **staged, safe deployment workflow** across three phases. Operators stay in control at every gate.

### Phase 1 — Pre-Validation (before any config is pushed)
- **Device reachability** — SSH probe to all target hosts
- **Running-config backup** — timestamped local copy before any change
- **Control-plane health baseline** — BGP peer count, OSPF neighbor state, vPC status

### Phase 2 — Controlled Deployment
- **Layered rollout** — Access → Distribution → Core for campus; Spine → Leaf for DC
- **Serial execution** — `serial: 1` for campus (campus), `serial: 2` for vPC pairs in DC, isolating blast radius
- **Dry-run by default** — `--check --diff` (Ansible) / `dry_run: true` (API) — shows what *would* change, touches nothing

### Phase 3 — Post-Validation (after every push)
- **Protocol convergence checks** — OSPF/BGP neighbor re-establishment
- **Overlay verification** — EVPN route-type presence, NVE peer state, vPC consistency
- **End-to-end reachability** — ICMP ping across VTEPs / subnets

```
⚠️  Always run in dry-run mode before any live deployment.
    The API sets dry_run=true by default — it must be explicitly overridden.
```

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser UI (Step 1-6)                 │
│         Use Case → Requirements → Products → Design      │
└───────────────────────┬─────────────────────────────────┘
                        │  Intent Object (JSON)
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   Intent Model Layer                     │
│     Multi-signal scoring · topology inference · BOM      │
└───────────────────────┬─────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
┌──────────────┐ ┌───────────┐ ┌──────────────────┐
│  HLD / LLD   │ │  Config   │ │    Validation    │
│  Topology    │ │ Generator │ │      Layer       │
│  SVG + tables│ │ (Jinja2)  │ │  pre / post chk  │
└──────────────┘ └─────┬─────┘ └────────┬─────────┘
                       │                │
                       ▼                ▼
              ┌─────────────────────────────┐
              │    Execution Engine          │
              │  FastAPI · Nornir · Ansible  │
              │  (Netmiko / NETCONF / SSH)   │
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │        Network Devices       │
              │  IOS-XE · NX-OS · EOS        │
              │  Junos · SONiC               │
              └─────────────────────────────┘
```

---

## 📘 Example End-to-End Workflow

Here is what a real run looks like for a Data Center with EVPN:

**1. Select Use Case**
> Choose "Data Center" · Scale: Large · Redundancy: HA · Overlay: VXLAN/EVPN

**2. Set Requirements**
> Protocols: BGP, IS-IS, EVPN · Compliance: PCI-DSS · Security: MACsec

**3. Product Recommendations Generated**
> 2 × Nexus 9336C-FX2 (DC Spine, score: 94%) · 4 × Nexus 93180YC-FX (DC Leaf, score: 91%)
> BOM exported to CSV with estimated cost

**4. Topology Rendered**
> Animated SVG showing spine-leaf CLOS fabric, BGP peering links, packet flow dots

**5. Configs Generated per Device**
```
DC-SPINE-01 (NX-OS):  IS-IS underlay, BGP RR, BFD, telemetry
DC-LEAF-01  (NX-OS):  VXLAN NVE, BGP EVPN L2/L3, anycast GW, vPC, PFC
```

**6. Deployed Safely**
```
✅ Pre-checks:   SSH OK · BGP baseline: 0 peers (expected) · backup saved
✅ Dry-run diff: Shows interface/VLAN/BGP changes
✅ Deploy:       Spine first → Leaf (serial=2 for vPC pairs)
✅ Post-checks:  NVE up · EVPN neighbors established · ping across VTEPs OK
```

---

## 🆚 How NetDesign AI Differs

| Tool | Primary Focus | NetDesign AI Advantage |
|---|---|---|
| **Ansible** | Config execution | Adds *intent → design → config generation* + validation gates |
| **Nornir** | Python task runner | Adds *topology*, *scoring*, and a browser UI — no scripting needed |
| **Cisco NSO** | Orchestration | Lightweight, browser-first, no dedicated server or license required |
| **Arista CloudVision** | Arista-specific ops | Multi-vendor abstraction across 5 OS families |
| **Batfish** | Config analysis | Complementary — Batfish validates; NetDesign AI *generates* |
| **NetBox / Nautobot** | Source of truth (IPAM) | Complementary — integration planned (v2 roadmap) |

> **NetDesign AI is not a replacement for any of these** — it is the *design and generation layer* that sits upstream of them.

---

## 🚦 Production Readiness Levels

| Capability | Status | Notes |
|---|---|---|
| **Design generation** (HLD/LLD) | ✅ Production-ready | All 5 use cases, multi-site |
| **Config generation** (Jinja2) | ✅ Production-ready | IOS-XE, NX-OS, EOS, Junos, SONiC |
| **Product scoring / BOM** | ✅ Production-ready | 40+ SKUs, 8-signal model |
| **Deployment (controlled env)** | ⚠️ Staging/lab safe | Dry-run default; serial rollout; validated gates |
| **Pre/post validation** | ⚠️ Partial | CLI parsing via TextFSM; no simulation engine yet |
| **Automated rollback** | ❌ Not automated | Backup saved pre-deploy; manual restore required |
| **Change-control integration** | ❌ Planned | ServiceNow / Jira on roadmap |

---

## ⚠️ Current Limitations

These are known gaps — listed here so you can plan accordingly:

- **No incremental (diff) deployment** — full config push only; `replace:` mode planned
- **No automatic rollback** — pre-deploy backup is saved, but restore is manual
- **No simulation engine** — Batfish-style pre-deployment validation not yet integrated
- **No source of truth sync** — NetBox/Nautobot integration is planned, not built
- **No change-control hooks** — ServiceNow/Jira approval workflow not yet implemented
- **SSH-only transport** — NETCONF/gRPC deployment path is scaffolded but not complete

> Recommended: validate all generated configs in a lab or with `--check --diff` before any production push.

---

## 🔌 Integration Story

| Integration | Status | How |
|---|---|---|
| **GitHub Actions / Jenkins** | ✅ Available | Trigger API endpoints in CI pipeline; `dry_run=false` after approval |
| **Ansible** | ✅ Built-in | Full playbook scaffold included (`playbooks/`) |
| **NetBox / Nautobot** | 🗺 Roadmap | Source of truth for IP/VLAN import |
| **Cisco NSO** | 🗺 Roadmap | Intent → NSO service model translation |
| **Arista CloudVision** | 🗺 Roadmap | EOS config push via CloudVision API |
| **gNMI / Streaming Telemetry** | ✅ Config-ready | Generated NX-OS/EOS configs include gRPC/gNMI telemetry stanzas |
| **SNMP / Syslog** | ✅ Config-ready | NTP, SNMP, logging servers templated in `group_vars/all.yml` |
| **Docker / Kubernetes** | ✅ Available | `docker-compose.yml` for API + Nginx frontend |

---

## ✨ What It Does — 6 Steps

| Step | What you get |
|---|---|
| **1 — Use Case** | Pick Campus / DC / GPU Cluster / Hybrid / WAN / Multi-Site DCI + org details |
| **2 — Requirements** | Protocols, security, compliance, app flows, GPU/RoCEv2 options, budget, vendor preference |
| **3 — Products** | 40+ hardware SKUs scored 0–100% across 8 signals — Cisco, Arista, Juniper, NVIDIA, Palo Alto, Fortinet, HPE Aruba, Extreme |
| **4 — Design** | Interactive SVG topology (HLD) with **live animated packet flow** + IP plan, VLAN, BGP, physical tables (LLD) |
| **5 — Configs** | Production-ready IOS-XE / NX-OS / EOS / Junos / SONiC per device with syntax highlighting |
| **6 — Deploy** | Pre-checks → backup → dry-run diff → push → confirm-commit → post-checks dashboard |

---

## 📸 Screenshots

| Step 3 — AI Product Scoring | Step 4 — Live Topology | Step 6 — Deploy Pipeline |
|:---:|:---:|:---:|
| ![Products](https://amit33-design.github.io/Network-Automation/preview.svg) | ![Topology](https://amit33-design.github.io/Network-Automation/preview.svg) | ![Deploy](https://amit33-design.github.io/Network-Automation/preview.svg) |
| 40+ hardware SKUs scored 0–100% across 8 signals | Animated SVG packet flow, campus / DC / GPU / WAN / multi-site | Pre-checks → backup → push → confirm-commit → post-checks |

> **Try it live:** Click [⚡ Demo](https://amit33-design.github.io/Network-Automation/) → select a scenario → navigate all 6 steps in under 2 minutes.

---

## 🧠 How the Product Scoring Works

The recommendation engine scores every hardware SKU against the user's requirements using a **weighted multi-signal model** — no external AI API needed, pure deterministic logic.

```
score = baseline(60) + Σ signal_weights   →   capped 0–100
```

| Signal | Max Points | Logic |
|---|---|---|
| Use-case match | +20 | Product's `useCases[]` includes selected scenario |
| Port speed match | +10 | Access speed matches bandwidth tier (1G/10G/25G/100G/400G) |
| Uplink speed match | +5 | Uplink speed matches bandwidth requirement |
| Latency — ultra | +15 / −20 | `latencyNs < 500` earns bonus; `> 1000` on ultra-low SLA penalises |
| Overlay protocol | +10 | VXLAN/MPLS feature flag matches selected overlay |
| Compliance | +5/+8 | MACsec for PCI-DSS; FIPS-140 cert for FedRAMP/Gov |
| GPU / RoCEv2 | +15/+10/+12 | RoCEv2, PFC, SHARP in-network compute for GPU use case |
| HA / ISSU | +5 | In-service software upgrade for `redundancy=full` |
| Budget tier | +15 / −7 | Product price tier matches user budget selection |
| Vendor preference | +15 / −5 | Preferred vendor earns bonus; others penalised slightly |
| User-count density | ±10 | Host count vs product's `userScale[min,max]` range |
| Industry signals | +5 | Finance→MACsec/FIPS, Healthcare→802.1X, Gov→TAA, Retail→FortiLink |
| Size penalty | −8 | High-wattage chassis penalised for small org |

**Result:** sorted descending per layer; top pick auto-selected. User can override any selection before topology generation.

---

## 🏗 Architecture Coverage

### Campus / Enterprise LAN
```
Internet → Firewall (HA) → Core → Distribution → Access → Endpoints
```
Cisco Cat9300/9500/9600 · HPE Aruba CX · Extreme Networks · OSPF/BGP · 802.1X · DHCP snooping · QoS

### Data Center Leaf-Spine (CLOS)
```
Border FW → Spine (×2) → Leaf (×N) → Servers
```
Nexus 93180/9336C · Arista 7050CX3/7280R3 · Dell S5248F-ON · IS-IS underlay · BGP EVPN · VXLAN overlay

### AI / GPU Cluster
```
GPU Spine → GPU TOR → H100/A100 GPU Servers
Storage Spine → Storage Leaf → GPU Servers (NVMe-oF / NFS)
OOB Management → All devices
```
NVIDIA SN4600C/SN4800 · Arista 7060X4 · RoCEv2 · PFC · ECN/DCQCN · SHARP in-network compute

### WAN / SD-WAN
```
HQ Core ↔ MPLS/Internet ↔ Branch CPEs (×N)
```
Cisco ISR/ASR · Fortinet FortiGate · BGP · VRF · ZTP

### Multi-Site DC / DCI
```
DCA (Primary) ←—VXLAN DCI—→ DCB (Active-Active) ←—VXLAN DCI—→ DCC (DR) ←—VXLAN DCI—→ DCD (Edge)
```
VXLAN overlay · BGP EVPN L2/L3 stretch · WAN cloud transit · optional FW perimeter pair

---

## 📦 40+ Hardware SKUs Evaluated

| Layer | Cisco | Arista | Juniper | NVIDIA | Fortinet | HPE Aruba | Extreme |
|---|---|---|---|---|---|---|---|
| Campus Access | Cat9300-24P/48P, Cat1300-48P | 720XP-48ZC2 | EX2300-48P | — | FortiSwitch 124F-POE, 148F-POE | 2930F-24G, CX6300M | X435-24P, X465-48P |
| Distribution | Cat9500-48Y4C | 7280R2A-30 | EX4650-48Y | — | FortiSwitch 248E, 424E, 548D | — | — |
| Core | Cat9600-32C | 7500R3 | — | — | — | CX6405 | — |
| DC Leaf | Nexus 93180YC-FX / 93360YC-FX2 | 7050CX3-32S | QFX5120-48Y | — | — | — | — |
| DC Spine | Nexus 9336C-FX2 / 9364D-GX | 7280R3-48YC6 | QFX10002-60C | — | — | — | — |
| GPU TOR | Nexus 9336C-FX2 | 7060X4-32S | — | SN4600C / SN2700 | — | — | — |
| GPU Spine | — | 7800R3 | — | SN4800 | — | — | — |
| Firewall | Firepower 4145 | — | SRX4600 | — | FortiGate 100F/600F/1800F | — | — |
| Firewall | PA-3440 / PA-5445 | — | — | — | — | — | — |

---

## ⚙️ Config Platforms

| Platform | Devices | Notable configs generated |
|---|---|---|
| **Cisco IOS-XE** | Campus access/dist/core | VLANs, STP, 802.1X, DHCP snooping, DAI, OSPF/BGP, PortFast/BPDUguard, HSRP |
| **Cisco NX-OS** | DC spine/leaf, GPU TOR | IS-IS, BGP EVPN, VXLAN NVE, vPC, anycast GW, PFC/ECN/DCQCN, gRPC telemetry |
| **Arista EOS** | DC spine/leaf, GPU spine | BGP EVPN, VXLAN, IRB, ECMP, PFC/RoCEv2, gNMI/CloudVision-ready |
| **Juniper Junos** | Any layer | Hierarchical config, OSPF/BGP, EVPN, IRB, policy-options, Apstra-ready |
| **NVIDIA SONiC** | GPU TOR | config_db.json + PFC/WRED/ECN QoS JSON + PFC watchdog |

---

## 🚀 Quick Start — Frontend (No Setup)

### Try it live (no install)
```
https://amit33-design.github.io/Network-Automation/
```

### Run locally
```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
open index.html       # macOS
start index.html      # Windows
xdg-open index.html   # Linux
```

Single static HTML file — no npm, no build step, no server required.

### Test the frontend
1. Open `index.html` in Chrome / Firefox / Safari
2. Click **⚡ Demo** → select **Data Center**, **GPU Cluster**, **Campus**, **Multi-Site**, or **Fortinet Retail** scenario
3. Click through all 6 steps — topology animates with live packet flow dots
4. At Step 5, select a device from the dropdown to see platform-specific config
5. At Step 6, click **Run Pre-Checks** → **Deploy** → **Run Post-Checks** (simulated in browser)

---

## 🐍 Backend — Python FastAPI + Nornir

The backend enables **real device deployment** when you have physical/virtual network gear.

### Requirements
- Python 3.11+
- pip packages (see `backend/requirements.txt`)

### Option A — Docker (fastest, recommended)
```bash
cp backend/.env.example backend/.env   # fill in real values if needed
docker-compose up --build
# API:      http://localhost:8000
# API docs: http://localhost:8000/docs
# Frontend: http://localhost:8080
```

### Option B — Local venv
```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Run the API server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API docs auto-generated at: **http://localhost:8000/docs**

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/api/inventory` | List hosts from Ansible inventory |
| `POST` | `/api/generate-configs` | Render Jinja2 configs (no device needed) |
| `POST` | `/api/pre-checks` | Reachability + SSH + version + backup |
| `POST` | `/api/deploy` | Push configs (`dry_run=true` by default) |
| `POST` | `/api/post-checks` | BGP/OSPF/EVPN/NVE/vPC/PFC validation |

### Run tests locally
```bash
cd backend
pip install pytest jinja2 fastapi pydantic
pytest tests/ -v --tb=short
```

Tests cover: device context building, hostname formatting, HA device count, per-platform template rendering (NX-OS EVPN, IOS-XE 802.1X, SONiC PFC JSON), empty-inventory guard, and uniqueness of generated hostnames.

### CI — tests run automatically on every push
Every commit to `main` triggers GitHub Actions:
- **Backend tests** on Python 3.11 and 3.12 with coverage report
- **Ansible syntax check** on both campus and DC playbooks
- **Docker build + smoke test** — API server starts and responds to health check

### Test config generation (no devices needed)
```bash
curl -s -X POST http://localhost:8000/api/generate-configs \
  -H "Content-Type: application/json" \
  -d '{
    "uc": "dc",
    "orgName": "TestOrg",
    "orgSize": "large",
    "redundancy": "ha",
    "selectedProducts": {
      "dc-spine": "nexus-9336c",
      "dc-leaf":  "nexus-93180"
    },
    "protocols": ["bgp", "is-is", "evpn"],
    "vlans": [
      {"id": 10, "name": "PROD", "gw": "192.168.10.1"},
      {"id": 20, "name": "DEV",  "gw": "192.168.20.1"}
    ]
  }' | python3 -m json.tool
```

### Test dry-run deploy (no devices needed)
```bash
curl -s -X POST http://localhost:8000/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "uc": "campus",
      "orgName": "TestOrg",
      "orgSize": "medium",
      "redundancy": "single",
      "selectedProducts": {"campus-access": "cat9300-24p"},
      "protocols": ["ospf"],
      "security": ["802.1x"],
      "vlans": [{"id": 10, "name": "DATA"}]
    },
    "inventory": {},
    "dry_run": true
  }' | python3 -m json.tool
```

### Test with real devices
1. Edit `playbooks/inventory/hosts.yml` — replace IPs with real device IPs
2. Set `dry_run: false` in the deploy request
3. Ensure SSH access to devices (Netmiko uses port 22)

---

## 🤖 Ansible Playbooks

### Requirements
```bash
pip install ansible
ansible-galaxy collection install cisco.ios cisco.nxos arista.eos junipernetworks.junos
```

### Edit inventory
```bash
vi playbooks/inventory/hosts.yml   # real device IPs
vi playbooks/group_vars/all.yml    # VLANs, ASNs, passwords
```

### Encrypt passwords with Ansible Vault
```bash
ansible-vault encrypt_string 'MySecret123' --name 'vault_dc_password'
# Paste the output into group_vars/all.yml
```

### Run pre-checks (safe — read-only)
```bash
cd playbooks
ansible-playbook pre_checks.yml -i inventory/hosts.yml --ask-vault-pass
ansible-playbook pre_checks.yml -i inventory/hosts.yml --tags dc   # DC only
```

### Deploy — dry run first (always!)
```bash
# Dry run — shows what WOULD change, touches nothing:
ansible-playbook deploy_campus.yml -i inventory/hosts.yml --check --diff

# Real deploy (campus):
ansible-playbook deploy_campus.yml -i inventory/hosts.yml --ask-vault-pass

# Real deploy (data center):
ansible-playbook deploy_dc.yml -i inventory/hosts.yml --ask-vault-pass
```

### Run post-checks
```bash
ansible-playbook post_checks.yml -i inventory/hosts.yml --ask-vault-pass
ansible-playbook post_checks.yml -i inventory/hosts.yml --tags gpu   # GPU only
```

### Targeted deploys with tags
```bash
ansible-playbook deploy_campus.yml --tags access   # Only access layer
ansible-playbook deploy_dc.yml --tags spine        # Only spines
ansible-playbook post_checks.yml --tags summary    # Summary only
```

---

## 🗂 Project Structure

```
Network-Automation/
├── index.html                   # HTML skeleton — 920 lines, links to src/
├── preview.svg                  # OG social-share preview image (1200×630)
├── .nojekyll                    # GitHub Pages — disable Jekyll processing
├── .gitignore                   # Python, venv, secrets, editor files
├── LICENSE                      # MIT
├── docker-compose.yml           # Backend API + Nginx frontend
├── README.md
│
├── src/                         # Frontend source (split from index.html)
│   ├── css/
│   │   └── main.css             # All styles — design tokens, components, animations
│   └── js/                      # JS modules — loaded in dependency order
│       ├── state.js             # STATE object, STEPS metadata, UC_LABELS
│       ├── products.js          # PRODUCTS database — 40+ SKUs with full specs
│       ├── app.js               # Navigation, step validation, UI helpers, toast
│       ├── scoring.js           # scoreProduct(), estimateCounts(), getLayersForUC()
│       ├── recommendations.js   # generateRecommendations(), BOM, product modal
│       ├── topology.js          # buildSVG(), animated packet flow, HLD/LLD renderers
│       ├── configgen.js         # genIOSXE/NX-OS/EOS/Junos/SONiC(), syntax highlight
│       ├── deploy.js            # runPreChecks(), startDeploy(), runPostChecks()
│       ├── storage.js           # localStorage save/restore
│       ├── demo.js              # loadDemo(), demo modal
│       └── init.js              # Keyboard nav, share, DOMContentLoaded bootstrap
│
├── backend/                     # Python backend (FastAPI + Nornir)
│   ├── main.py                  # REST API — 5 endpoints
│   ├── config_gen.py            # Jinja2 config generation engine
│   ├── nornir_tasks.py          # Parallel deployment via Netmiko/NETCONF
│   ├── nornir_config.yaml       # Nornir runner + inventory config
│   ├── requirements.txt         # Python dependencies
│   ├── Dockerfile               # Container image for the API server
│   ├── .env.example             # Environment variable template (copy → .env)
│   ├── tests/
│   │   └── test_config_gen.py   # 20+ pytest tests for config rendering
│   └── templates/               # Per-platform Jinja2 templates
│       ├── ios_xe/
│       │   ├── access.j2        # Campus access (802.1X, DHCP snoop, DAI, QoS)
│       │   ├── distribution.j2  # Distribution (OSPF, HSRP, STP root)
│       │   └── core.j2          # Core (OSPF, BGP, default route)
│       ├── nxos/
│       │   ├── spine.j2         # DC spine (BGP RR, IS-IS/OSPF, BFD)
│       │   └── leaf.j2          # DC leaf (VXLAN, EVPN, anycast-GW, vPC, telemetry)
│       ├── eos/
│       │   └── gpu_spine.j2     # GPU spine (BGP ECMP, PFC/RoCEv2, gNMI)
│       ├── sonic/
│       │   └── gpu_tor.j2       # GPU TOR (config_db JSON, WRED/ECN, PFC watchdog)
│       └── junos/
│           └── generic.j2       # Junos (hierarchical, OSPF/BGP, IRB, policy)
│
└── playbooks/                   # Ansible automation
    ├── deploy_campus.yml        # Campus: Access→Dist→Core (serial, backup, assert)
    ├── deploy_dc.yml            # DC: Spine→Leaf (EVPN wait, NVE assert, vPC check)
    ├── pre_checks.yml           # Reachability, version, backup, BGP/vPC baseline
    ├── post_checks.yml          # OSPF/BGP/EVPN/NVE/vPC/PFC validation + summary
    ├── inventory/
    │   └── hosts.yml            # All devices (campus/dc/gpu/fw) with vault refs
    └── group_vars/
        └── all.yml              # VLANs, BGP ASNs, NTP, SNMP, confirm-commit timer
```

---

## 🛠 Tech Stack

**Frontend** — zero dependencies, pure browser
- HTML5 · CSS3 · Vanilla ES2020 JavaScript
- SVG with `animateMotion` + `mpath` for live packet-flow topology animations
- CSS custom properties, Grid, Flexbox, `@keyframes` animations
- `localStorage` session persistence · Web Share API · Open Graph meta tags

**Backend** (Python, optional — for real device push)

| Library | Role |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | REST API + auto Swagger docs |
| [Nornir](https://nornir.readthedocs.io/) | Parallel task runner (10 workers) |
| [Netmiko](https://github.com/ktbyers/netmiko) | SSH to IOS-XE / NX-OS / EOS / Junos |
| [ncclient](https://github.com/ncclient/ncclient) | NETCONF transport |
| [Jinja2](https://jinja.palletsprojects.com/) | Config templating per platform |
| [NAPALM](https://napalm.readthedocs.io/) | Multi-vendor abstraction |
| [TextFSM](https://github.com/google/textfsm) | CLI output parsing |

**Automation** (Ansible)

| Playbook | What it does |
|---|---|
| `pre_checks.yml` | SSH probe, version collect, running-config backup, BGP/vPC baseline |
| `deploy_campus.yml` | IOS-XE push (serial=1) with OSPF assert + DHCP snooping verify |
| `deploy_dc.yml` | NX-OS push (serial=2 for vPC pairs) with NVE/EVPN/vPC validation |
| `post_checks.yml` | Full health check: OSPF/BGP/EVPN/NVE/PFC/queue-drops + ping test |

---

## 🗺 Roadmap

- [x] 6-step intent-driven design wizard
- [x] AI product recommendation with multi-signal fit scoring (40+ SKUs)
- [x] Interactive SVG HLD topology diagrams with **animated live packet flow**
- [x] Full LLD: IP plan, VLAN, BGP, physical connectivity tables
- [x] Multi-platform config generator (5 OS families, 7 Jinja2 templates)
- [x] Staged deploy pipeline + pre/post check dashboard
- [x] Demo mode (5 scenarios), keyboard shortcuts, localStorage, mobile responsive
- [x] GitHub Pages live hosting + OG preview image
- [x] Python FastAPI + Nornir backend (config gen + real device deploy)
- [x] Ansible playbooks (campus + DC deploy + pre/post checks)
- [x] Multi-site DCI topology + multi-vendor scoring (Fortinet, Aruba, Extreme, Dell)
- [ ] PDF design document export
- [ ] Config diff viewer (before/after on regenerate)
- [ ] NetBox / Nautobot source-of-truth integration
- [ ] Live NAPALM device connectivity test from browser
- [ ] Batfish-style pre-deployment simulation / validation
- [ ] Cisco NSO / Crosswork integration
- [ ] Arista CloudVision API integration
- [ ] ServiceNow / Jira change-control hooks
- [ ] Automated rollback from pre-deploy backup
- [ ] IPv6-only design mode
- [ ] TCO calculator (5-year total cost of ownership)

---

## 📄 License

MIT © 2024 Amit Tiwari — contributions welcome!
