# 🌐 NetDesign AI — Intent-Driven Network Design & Deployment Platform

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://amit33-design.github.io/Network-Automation/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![No Dependencies](https://img.shields.io/badge/frontend-zero%20dependencies-brightgreen?style=flat-square)](index.html)
[![Python](https://img.shields.io/badge/backend-Python%203.12+-blue?style=flat-square&logo=python)](netdesign-backend/)
[![Nornir](https://img.shields.io/badge/automation-Nornir%20%2B%20Netmiko-orange?style=flat-square)](netdesign-backend/requirements.txt)

> **Express network intent. Get topology, configs, policy validation, and a gate-enforced deployment pipeline — entirely in your browser, with an optional Python backend for real device automation.**

---

## 🚀 Live Demo

**[amit33-design.github.io/Network-Automation](https://amit33-design.github.io/Network-Automation/)**

No login. No install. Click **⚡ Demo** for a pre-filled walkthrough in under 2 minutes.

---

## 🎯 Who This Is For

| Audience | What they get |
|---|---|
| **Network Architects** | HLD + LLD + production configs in minutes, not days |
| **Platform / SRE Teams** | Gate-enforced, staged deployments with 17 pre + 8 post validation checks |
| **AI / GPU Infrastructure** | Correctly designed RoCEv2 lossless fabrics — PFC, ECN, DSCP, MTU 9216 |
| **Network Automation Engineers** | Intent JSON → Nornir/Netmiko pipeline with delta deploy and granular rollback |
| **Enterprise Architects** | Multi-vendor design across campus, DC, GPU, WAN, multi-site DCI |

---

## 🧩 The Intent Model

Every design starts with a **structured intent object** — a declarative description of *what* you need, not *how* to configure it. The platform compiles this single object into every downstream artifact.

```json
{
  "_schema": "netdesign-intent/v1",
  "use_case": "datacenter",
  "topology": { "type": "leaf-spine", "spine_count": 2, "leaf_count": 4, "redundant": true },
  "org": "Acme Corp",
  "scale": "large",
  "protocols": {
    "underlay": ["IS-IS"],
    "overlay": ["BGP-EVPN", "VXLAN"],
    "features": ["BFD", "PFC", "gRPC-Telemetry"]
  },
  "security": ["MACsec", "NAC"],
  "compliance": ["PCI-DSS"],
  "gpu": false,
  "budget": "enterprise",
  "vendor_preference": ["cisco"],
  "_generated": "2025-05-01T09:14:22Z"
}
```

This intent object feeds the entire pipeline:

```
Intent Object
    ├── Policy Engine     → 9 rules → PASS / WARN / FAIL
    ├── Product Scoring   → 40+ SKUs scored 0–100% across 8 signals → BOM
    ├── Topology Builder  → Animated SVG HLD + LLD tables
    ├── Config Generator  → IOS-XE · NX-OS · EOS · SONiC · Junos (browser + Jinja2)
    ├── Deployment Gate   → Simulation + Pre-checks + Policy → go / no-go
    └── Real Deploy       → Nornir + Netmiko → delta push → post-checks
```

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser UI  (GitHub Pages — zero dependencies)                      │
│                                                                      │
│  Step 1: Use Case → Step 2: Requirements → Step 3: Products          │
│  Step 4: Design   → Step 5: Configs      → Step 6: Deploy            │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │Intent Model │  │Policy Engine│  │  Deploy Gate  │  │Confidence │ │
│  │  (JSON)     │→ │  9 rules    │→ │ Sim·Pre·Policy│→ │  Score %  │ │
│  └─────────────┘  └─────────────┘  └──────────────┘  └───────────┘ │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTPS + WebSocket (optional live mode)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  netdesign-backend/  (Python — runs on your jump host)               │
│                                                                      │
│  FastAPI · Nornir 3.x · Netmiko 4.x · NAPALM 4.x · Jinja2          │
│                                                                      │
│  POST /api/precheck     → 17 checks  (ICMP, SSH, LLDP, BGP, IS-IS…) │
│  POST /api/deploy/delta → LCS diff   → push only changed lines       │
│  POST /api/postcheck    →  8 checks  (route propagation, EVPN, …)   │
│  POST /api/rollback/{scope} → device | stage | full                 │
│  WS   /ws/terminal/{id}     → real-time log stream to browser        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ SSH / NETCONF / eAPI / REST
                               ▼
              ┌─────────────────────────────────┐
              │       Network Devices            │
              │  IOS-XE · NX-OS · EOS · SONiC   │
              │  Junos                           │
              └─────────────────────────────────┘
```

---

## ✨ Feature Walkthrough — 6 Steps

| Step | What you get |
|---|---|
| **1 — Use Case** | Campus · DC · GPU Cluster · WAN · Hybrid · Multi-Site DCI |
| **2 — Requirements** | Protocols, security, compliance, GPU/RoCEv2, budget, vendor preference |
| **3 — Products** | 40+ SKUs scored 0–100% across 8 signals. Auto-selects best fit per layer |
| **4 — Design** | Animated SVG topology (HLD) + IP plan, VLAN, BGP, physical tables (LLD). Export SVG/CSV |
| **5 — Configs** | Per-device configs with syntax highlighting. Diff engine shows line-level changes |
| **6 — Deploy** | Policy Engine → Gate → Pre-checks → Backup → Delta push → Post-checks → Rollback |

---

## 🛡️ Policy Engine

Before deployment is allowed, the **Policy Engine** evaluates 9 codified network best-practice rules against the live intent model. Results feed directly into the Deployment Gate.

| Rule | Severity | Triggered when |
|---|---|---|
| GPU cluster without PFC/DCB | **FAIL** | `gpu=true` and PFC not in protocol features |
| Single spine (< 2 nodes) | WARN | `spine_count < 2` |
| Large deployment without HA | WARN | `scale=enterprise` and `redundant=false` |
| GPU fabric without RoCEv2 | WARN | `gpu=true` and RoCEv2 not in overlay |
| WAN without encryption | WARN | `use_case=wan` and no IPsec/MACsec |
| Campus without NAC/802.1X | WARN | `use_case=campus` and no NAC in security |
| Data center without BGP-EVPN | INFO | DC use case and no EVPN in overlay |
| Multi-site without SR/TE | INFO | `site_count >= 3` and no SR in underlay |
| No compliance framework | INFO | Production use case with empty compliance |

Policy FAIL does not block deployment (advisory). Policy is one of three Gate signals.

---

## 🚦 Deployment Gate + Confidence Score

Three signals are evaluated before the Deploy button becomes active:

```
Gate = {
  simulation: "PASS | WARN | FAIL"   ← set when you toggle device failures in Step 4
  precheck:   "PASS | FAIL"          ← set after running pre-checks in Step 6
  policy:     "PASS | WARN | FAIL"   ← set automatically when Step 6 opens
}

canDeploy() = simulation !== "FAIL" && precheck !== "FAIL"
```

The **Confidence Score** synthesises all three signals into a single 0–100% ring gauge:

| Signal | Max points | Condition |
|---|---|---|
| Simulation | 40 | PASS=40, WARN=24, FAIL=0 |
| Pre-checks | 30 | PASS=30, FAIL=0 |
| Policy | 20 | PASS=20, WARN=10, FAIL=0 |
| Zero-warning bonus | 10 | No policy warnings |

A score ≥ 80 is green (High Confidence). Below 50 is red (Low Confidence).

---

## 🔬 Network Simulation

Before touching any real device, test failure scenarios in the browser:

- Click any device in the **🧪 Simulate** panel to mark it as failed
- The **Fabric Health** score drops based on layer severity (spine = critical, leaf = medium)
- Impact cards show: blast radius, LLDP failover path, convergence time
- A **Reachability Matrix** updates to show OK / PARTIAL / BLOCKED zones
- A **Route Propagation Table** shows prefix paths and convergence timing
- Simulating a critical device failure (spine, firewall, hub) sets Gate → **FAIL** and blocks deployment

---

## 🔀 Config Diff Engine

Every time a config is regenerated (new vendor selection, protocol changes), the diff engine computes a **Myers LCS line-level diff**:

```
+32 lines added  −12 lines removed  118 unchanged
```

The `getDeltaSummary()` function aggregates this across all devices and shows the total before any deploy starts. The same diff algorithm powers the real **delta deploy** in the backend — only the `+` lines are pushed to the device.

---

## ♻️ Granular Rollback

When post-checks fail, a **Rollback Options** modal appears with three scopes:

| Scope | Behaviour | Platform mechanism |
|---|---|---|
| **Device** | Restore only selected devices (checkbox per device) | `configure replace` / `rollback running-config` |
| **Stage** | Restore all devices touched in the deploy stage | EOS checkpoint / Junos `rollback 1` |
| **Full** | Restore everything to pre-deploy state | Full config re-push from NAPALM backup |

---

## 📊 Observability

Every deploy run produces:
- **Gantt timeline** — each pipeline stage (pre-check, backup, deploy, verify, post-check) as a proportional bar
- **5 metric tiles** — devices, checks run, log events, errors, total time
- **Event log** — every terminal line timestamped and level-tagged (info / success / warn / error)
- **Pipeline resume** — if any stage fails, a `Resume from <stage>` button appears

---

## 📤 Export Options

From Step 4 and Step 6:

| Export | Format | Contents |
|---|---|---|
| All Configs | `.txt` bundle | One file per device, all platforms |
| HTML Report | Self-contained `.html` | Dark theme — intent JSON, SVG topology, BOM, all configs |
| HLD Topology | `.svg` | Animated topology diagram |
| LLD Tables | `.csv` | IP plan, VLAN, BGP, physical connectivity |
| Print | Browser print | Formatted for A4/Letter |

---

## 🐍 Backend — Real Device Automation

The browser runs fully in simulation mode with zero backend. When you have real devices, connect the Python backend for live automation.

### Prerequisites
- Python 3.12 on your jump host (must have SSH reach to device management IPs)
- `pip install -r requirements.txt`
- A `.env` file with `BACKEND_API_KEY`

### Start the backend

```bash
cd netdesign-backend
cp .env.example .env           # set BACKEND_API_KEY=nd_live_yourkey
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Or with Docker:
docker-compose up --build
```

API docs auto-generated at: **http://your-host:8000/docs**

### Connect the browser

1. Click the **Backend** button in the top-right header
2. Enter your backend URL: `http://10.0.0.100:8000`
3. Enter your API key (matches `BACKEND_API_KEY` in `.env`)
4. Click **Test Connection** — should show `✅ Connected — backend v1.0.0`
5. Toggle to **🔴 Live Deploy**
6. Fill in device management IPs + credentials per device
7. Click **Save** — the dot turns green

From this point, **Run Pre-Checks**, **Deploy**, and **Run Post-Checks** hit real devices. The terminal streams every log line over WebSocket in real-time. Switching back to Simulation mode requires zero changes.

### Full API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/health` | Liveness check |
| `POST` | `/api/session/create` | Create session, get `session_id` |
| `POST` | `/api/config/generate` | Render Jinja2 configs from intent |
| `POST` | `/api/precheck` | Run 17 pre-deployment checks |
| `POST` | `/api/backup` | NAPALM `get_config()` from all devices |
| `POST` | `/api/deploy/full` | Push complete config via `send_config_set()` |
| `POST` | `/api/deploy/delta` | LCS diff → push only changed lines |
| `POST` | `/api/postcheck` | Run 8 post-deployment checks |
| `POST` | `/api/rollback/{scope}` | Rollback: `device` / `stage` / `full` |
| `GET`  | `/api/session/{id}/status` | Poll session state |
| `WS`   | `/ws/terminal/{session_id}` | Real-time log stream |

### Pre-checks (17 checks on real devices)

| Category | Checks |
|---|---|
| **Connectivity** | ICMP ping · SSH port (TCP) · Netmiko SSH auth |
| **Health** | CPU / memory (NAPALM `get_environment`) · fans / PSU / temperature · NTP sync · OS version |
| **Topology** | LLDP neighbor discovery and validation against intent (spine expects leaf neighbors) |
| **Routing** | BGP peer states + ASN verification · IS-IS adjacency count · OSPF FULL neighbors · routing table size · default route |
| **Interfaces** | Full state baseline (captured for post-check delta) · MTU 9216 (GPU) · err-disabled (campus) |
| **Overlay** | VXLAN/NVE peer count · PFC/ECN enabled · STP topology change count |
| **Safety** | Config syntax dry-run · platform rollback capability · maintenance window |

### Post-checks (8 checks comparing against pre-check baseline)

| Check | What is compared |
|---|---|
| **Interface recovery** | Anything UP before must be UP now — any regression is FAIL |
| **Route propagation** | Count ≥ baseline · no withdrawals · default route still present |
| **BGP re-establishment** | All peers Established · prefix count delta logged (`+14 prefixes`) |
| **LLDP consistency** | Same neighbors as pre-check — any change flags a topology problem |
| **IS-IS / OSPF recovery** | Adjacency count matches or exceeds baseline |
| **VXLAN NVE recovery** | NVE peer count matches or exceeds baseline |
| **EVPN route population** | Type-2 MAC-IP + Type-5 IP-prefix routes present in table |
| **End-to-end reachability** | Ping from device to gateway and key subnets from intent |

### Real delta deploy

```
1. NAPALM get_config()    →  running config (backup stored in session)
2. Jinja2 generator       →  candidate config
3. Myers LCS diff         →  +32 added / -12 removed / 118 unchanged
4. Push only added lines  →  send_config_set(delta_lines)
5. Remove deleted lines   →  "no <stanza>" for removed config blocks
```

Platform-specific push:
- **IOS-XE / NX-OS** → `send_config_set()` with delta lines + `no` commands for removals
- **EOS** → `configure session nd_deploy` + delta lines + `commit` (atomic, rollback-safe)
- **Junos** → `load merge` + `commit confirmed 5` (5-minute auto-rollback window)
- **SONiC** → REST `PATCH /restconf/data/` with delta JSON

---

## ⚙️ Config Platforms — Jinja2 Templates

| Platform | Template roles | Notable configs |
|---|---|---|
| **NX-OS** | dc-spine, dc-leaf | IS-IS underlay, BGP RR, EVPN, NVE VTEP, anycast GW, vPC, PFC, gRPC telemetry |
| **IOS-XE** | campus-access, campus-dist, campus-core | VLANs, 802.1X, DHCP snooping, DAI, PortFast/BPDUguard, OSPF, HSRP, QoS |
| **EOS** | dc-spine, gpu-spine | BGP EVPN, VXLAN, 64-way ECMP, PFC priority 3+4, DSCP marking, gNMI |
| **Junos** | default | IS-IS, BGP EVPN, hierarchical stanzas, LLDP, NETCONF, commit confirmed |
| **SONiC** | gpu-tor | config_db.json, PFC priority 3, WRED/ECN thresholds, MTU 9216, PFC watchdog |

---

## 🧠 Product Scoring Model

40+ hardware SKUs scored against your requirements using a **weighted multi-signal model** — pure deterministic logic, no external AI API.

```
score = baseline(60) + Σ signal_weights   →   capped 0–100
```

| Signal | Max pts | Logic |
|---|---|---|
| Use-case match | +20 | Product's `useCases[]` includes selected scenario |
| Port speed match | +10 | Access speed matches bandwidth tier (1G/10G/25G/100G/400G) |
| Uplink speed match | +5 | Uplink speed matches requirement |
| Latency | +15/−20 | `<500ns` earns bonus; `>1000ns` on ultra-low SLA penalises |
| Overlay protocol | +10 | VXLAN/MPLS flag matches selected overlay |
| Compliance | +5/+8 | MACsec for PCI-DSS; FIPS-140 for FedRAMP |
| GPU / RoCEv2 | +15/+10/+12 | RoCEv2, PFC, SHARP for GPU use case |
| HA / ISSU | +5 | In-service software upgrade when `redundancy=full` |
| Budget tier | +15/−7 | Price tier matches budget selection |
| Vendor preference | +15/−5 | Preferred vendor earns bonus |
| User density | ±10 | Host count vs product's `userScale[min,max]` |
| Industry signals | +5 | Finance→MACsec, Healthcare→802.1X, Retail→FortiLink |
| Size penalty | −8 | Large chassis penalised for small orgs |

---

## 🆚 How NetDesign AI Differs

| Tool | Primary Focus | NetDesign AI role |
|---|---|---|
| **Ansible / Nornir** | Config execution | NetDesign AI generates the configs + intent that Ansible/Nornir then execute |
| **Cisco NSO** | Service orchestration | NetDesign AI is the design-and-generate layer upstream of NSO |
| **Arista CloudVision** | Arista-specific ops | NetDesign AI is multi-vendor; can produce EOS configs for CloudVision |
| **NetBox / Nautobot** | Source of truth | Complementary — NetBox integration planned (v2 roadmap) |
| **Batfish** | Config analysis | Complementary — NetDesign AI generates; Batfish validates |

---

## 🗂 Project Structure

```
Network-Automation/
│
├── index.html                     # App shell — landing page + all 6 step panels
├── preview.svg                    # OG social preview image
├── .nojekyll                      # GitHub Pages — disable Jekyll
├── README.md
│
├── src/
│   ├── css/
│   │   └── main.css               # 2,000+ lines — design tokens, all components
│   └── js/                        # Loaded in dependency order
│       ├── state.js               # STATE object, STEPS, UC_LABELS
│       ├── products.js            # PRODUCTS — 40+ SKUs with full specs
│       ├── app.js                 # Navigation, validation, toast, jump-step hooks
│       ├── scoring.js             # scoreProduct(), estimateCounts()
│       ├── recommendations.js     # generateRecommendations(), BOM, product modal
│       ├── topology.js            # buildSVG(), animated packet flow, HLD/LLD
│       ├── configgen.js           # Per-platform config generators, syntax highlight
│       ├── intentmodel.js         # buildIntentObject(), renderIntentPanel()
│       ├── diffengine.js          # Myers LCS diff, getDeltaSummary(), renderDiffView()
│       ├── policyengine.js        # 9 policy rules, runPolicies(), renderPolicyPanel()
│       ├── gate.js                # GATE state, canDeploy(), confidence score ring
│       ├── simulation.js          # Failure sim, reachability matrix, route propagation
│       ├── observability.js       # Gantt timeline, metrics tiles, event log
│       ├── export.js              # exportAllConfigs(), exportHTMLReport(), renderDesignSummary()
│       ├── deploy.js              # runPreChecks(), startDeploy(), runPostChecks(),
│       │                          # granular rollback, device status table, platform logs
│       ├── backend.js             # BackendClient — fetch() + WebSocket to Python backend
│       ├── storage.js             # localStorage save/restore
│       ├── demo.js                # loadDemo(), 5 demo scenarios
│       ├── landing.js             # initLanding(), startDesigning(), animateCounters()
│       └── init.js                # Keyboard nav, DOMContentLoaded, auto-save
│
└── netdesign-backend/             # Python backend — optional, for real devices
    ├── main.py                    # FastAPI app, CORS, router mount
    ├── requirements.txt           # fastapi, nornir, netmiko, napalm, jinja2, uvicorn
    ├── .env.example               # BACKEND_API_KEY, LOG_LEVEL, SESSION_TTL_SECONDS
    ├── Dockerfile
    ├── docker-compose.yml
    ├── api/
    │   ├── models.py              # Pydantic: IntentModel, DeviceModel, CheckResult…
    │   ├── router.py              # All REST endpoints (session, config, precheck, deploy…)
    │   └── websocket.py          # WS /ws/terminal/{session_id} — log streaming
    ├── core/
    │   ├── inventory.py           # Dynamic Nornir inventory from intent JSON (no YAML files)
    │   └── session.py             # In-memory session store, TTL, credential purge
    ├── tasks/
    │   ├── precheck.py            # 17 pre-checks (ICMP, SSH, LLDP, BGP, IS-IS, OSPF, NVE, PFC…)
    │   ├── backup.py              # NAPALM get_config() + Netmiko fallback
    │   ├── deploy.py              # Full push + Myers LCS delta push per platform
    │   ├── postcheck.py           # 8 post-checks (route propagation, BGP delta, EVPN, LLDP…)
    │   └── rollback.py            # Device / stage / full rollback with platform-native restore
    └── configgen/
        ├── generator.py           # Jinja2 renderer from intent context
        └── templates/
            ├── nxos/              # dc_spine.j2, dc_leaf.j2
            ├── ios_xe/            # campus_access.j2, campus_dist.j2, campus_core.j2
            ├── eos/               # dc_spine.j2, gpu_spine.j2
            ├── sonic/             # gpu_tor.j2
            └── junos/             # default.j2
```

---

## 🚀 Quick Start

### Browser only (no install)
```
https://amit33-design.github.io/Network-Automation/
```

### Run locally
```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
open index.html      # macOS
start index.html     # Windows
xdg-open index.html  # Linux
```

Zero npm. Zero build step. Zero server required.

### Start the Python backend
```bash
cd netdesign-backend
cp .env.example .env
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then click **Backend** in the browser header → enter URL + API key → **Test Connection** → toggle **Live Deploy**.

### Docker (backend)
```bash
cd netdesign-backend
docker-compose up --build
# API:  http://localhost:8000
# Docs: http://localhost:8000/docs
```

---

## ⚠️ Known Limitations

| Area | Status |
|---|---|
| SONiC deploy transport | REST API calls — SSH fallback only; full config_db push not yet wired |
| NETCONF transport | Scaffolded in Junos tasks; Netmiko SSH used in practice |
| NetBox / Nautobot sync | Planned — not built |
| ServiceNow / Jira hooks | Planned — not built |
| Automated CI/CD pipeline trigger | Planned — not built |
| IPv6-only design mode | Planned — not built |
| PDF export | Planned — HTML report available as workaround |

---

## 🗺 Roadmap

- [x] 6-step intent-driven design wizard
- [x] AI product scoring — 40+ SKUs, 8-signal model
- [x] Interactive SVG topology with animated packet flow
- [x] LLD: IP plan, VLAN, BGP, physical tables
- [x] Multi-platform config generator (5 OS families)
- [x] Intent model JSON panel (live, collapsible, copy-to-clipboard)
- [x] Myers LCS config diff engine
- [x] Network failure simulation (fabric health score, reachability matrix)
- [x] Pipeline state tracking + observability (Gantt, metrics, event log)
- [x] Landing page with hero, stats, feature cards
- [x] Design summary panel
- [x] Export engine — configs bundle, HTML report, SVG, CSV
- [x] Policy engine — 9 codified best-practice rules
- [x] Deployment gate — 3-signal enforced go/no-go
- [x] Deployment confidence score (0–100% ring gauge)
- [x] Granular rollback — device / stage / full scope
- [x] Delta deploy UI — diff stats before every deploy
- [x] Python backend — FastAPI + Nornir + Netmiko + NAPALM
- [x] Dynamic Nornir inventory (no static YAML — built from intent at runtime)
- [x] 17 real pre-deployment checks (LLDP, BGP ASN, IS-IS, OSPF, NVE, PFC…)
- [x] 8 real post-deployment checks (route propagation, EVPN routes, LLDP delta…)
- [x] Real delta deploy — LCS diff → push only changed lines per platform
- [x] Platform-native rollback (configure replace, EOS checkpoint, Junos rollback)
- [x] WebSocket terminal streaming — real-time log from backend to browser
- [x] BackendClient JS — live mode / simulation mode toggle, zero breaking changes
- [ ] NetBox / Nautobot source-of-truth integration
- [ ] ServiceNow / Jira change-control hooks
- [ ] Batfish pre-deployment config analysis integration
- [ ] gRPC / NETCONF full transport (Junos / NX-OS)
- [ ] Arista CloudVision API integration
- [ ] IPv6-only design mode
- [ ] PDF design document export
- [ ] TCO calculator (5-year total cost of ownership)

---

## 🛠 Tech Stack

**Frontend** — pure browser, zero dependencies

| Layer | Technology |
|---|---|
| UI | HTML5 · CSS3 · Vanilla ES2020 JS |
| Topology | SVG with `animateMotion` + `mpath` for live packet flow |
| Styling | CSS custom properties, Grid, Flexbox, `@keyframes` |
| Persistence | `localStorage` session state + `sessionStorage` for dismissals |
| Diff | Myers LCS line-level algorithm (same as git) |
| Export | `Blob` / `URL.createObjectURL` for file downloads |

**Backend** — Python, optional

| Library | Version | Role |
|---|---|---|
| FastAPI | 0.111 | REST API + WebSocket + auto Swagger docs |
| Uvicorn | 0.29 | ASGI server |
| Nornir | 3.4 | Parallel task runner (threaded, 10 workers) |
| nornir-netmiko | 1.0 | Netmiko task wrappers for Nornir |
| nornir-napalm | 0.5 | NAPALM getter tasks for Nornir |
| Netmiko | 4.4 | SSH to IOS-XE / NX-OS / EOS / Junos / SONiC |
| NAPALM | 4.1 | `get_config`, `get_bgp_neighbors`, `get_interfaces`, `get_environment`, `get_lldp_neighbors_detail` |
| Jinja2 | 3.1 | Config templating per platform and role |
| Pydantic v2 | 2.7 | Request/response model validation |
| python-dotenv | 1.0 | `.env` credential management |

---

## 📄 License

MIT © 2024 Amit Tiwari — contributions welcome.
