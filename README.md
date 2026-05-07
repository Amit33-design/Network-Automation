# NetDesign AI — Intent-Driven Network Design & Deployment

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://amit33-design.github.io/Network-Automation/)
[![License: NDAL v1.0](https://img.shields.io/badge/License-Source--Available%20(NDAL%20v1.0)-red?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/backend-Python%203.11+-blue?style=flat-square&logo=python)](backend/)
[![MCP Ready](https://img.shields.io/badge/MCP-20%20tools-purple?style=flat-square)](docs/mcp-setup.md)

Express network intent in plain English. Get topology diagrams, production configs, policy validation, failure simulation, and a gate-enforced deployment pipeline — in your browser or via any AI assistant through the MCP API.

**[Live Demo →](https://amit33-design.github.io/Network-Automation/)** — No login. Click **⚡ Demo** for a 2-minute walkthrough.

---

## What It Does

NetDesign AI covers the full design-to-deployment lifecycle:

```
Intent (natural language)
    │
    ├─ Capacity Engine    Exact device counts — campus / DC / GPU (growth + reserve formulas)
    ├─ Policy Engine      15 rules: BLOCK / FAIL / WARN / AUTO_FIX / INFO
    ├─ IP/VLAN/BGP Plan   /31 uplinks, VNI scheme, route-targets, symmetric IRB
    ├─ Config Generator   NX-OS · EOS · SONiC · IOS-XE · JunOS + 9 policy domains per device
    ├─ Failure Simulation BFS partition + BGP/EVPN impact scoring
    ├─ Deployment Gate    Confidence score 0–100 → APPROVED / CONDITIONAL / BLOCKED
    ├─ MCP Layer          20 AI tools callable from Claude, ChatGPT, LangChain, any LLM
    └─ Real Deploy        Nornir + Netmiko → pre-checks → backup → delta push → post-checks
```

---

## Quick Start

### Browser only (zero install)

```
https://amit33-design.github.io/Network-Automation/
```

### MCP with Claude Desktop (recommended)

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation/backend
pip install -r requirements.txt
```

Add `backend/claude_desktop_config.json` to your Claude Desktop config (adjust the path), restart Claude Desktop, and you'll see the **🔨** hammer icon confirming the 20 NetDesign tools are loaded.

**[Full MCP setup — Claude Desktop, ChatGPT, Python SDK, LangChain →](docs/mcp-setup.md)**

### Docker Compose (full stack)

```bash
cp .env.example .env   # fill in JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, VAULT_TOKEN
docker compose up --build

# http://localhost:8080  — Web UI
# http://localhost:8000  — FastAPI REST  (docs: /docs)
# http://localhost:8001  — MCP SSE endpoint
```

---

## MCP Layer — 20 Tools

Describe what you need in natural language; the AI calls the right tools automatically.

> *"Design a 2-spine 8-leaf Arista EOS DC fabric with EVPN/VXLAN, OSPF underlay, and three tenant VRFs. Validate all policies and generate configs."*

| Category | Tools |
|---|---|
| **Design** | `design_network` ¹, `get_ip_plan`, `get_vlan_plan`, `get_bgp_topology`, `get_topology_graph` |
| **Configs** | `generate_configs` (NX-OS · EOS · SONiC · IOS-XE · JunOS + 9 policy domains) |
| **Validation** | `validate_policies` (15 rules) |
| **Simulation** | `simulate_failure`, `simulate_link_failure_tool` |
| **Gate** | `check_deployment_gate` (0–100 confidence score) |
| **Monitoring** | `run_health_check`, `diagnose_network`, `get_issue_detail`, `troubleshoot`, `monitor_network` |
| **Quality** | `run_static_analysis` (26 checks · 5 domains · 0–100 score) |
| **Post-deploy** | `run_post_checks` |
| **Automation** | `full_automation_pipeline` — single call: parse → validate → simulate → gate → configs |
| **Catalogue** | `list_products` (40+ SKUs, filterable) |

¹ `design_network` auto-chains NL parse → design → validate → simulate → gate in one call.

---

## Who This Is For

| Audience | What they get |
|---|---|
| **Network Architects** | HLD + LLD + production configs in minutes, not days |
| **Platform / SRE Teams** | Gate-enforced deployments with 17 pre + 8 post validation checks |
| **AI / GPU Infrastructure** | Correctly designed RoCEv2 lossless fabrics — PFC, ECN, DSCP, MTU 9216 |
| **Network Automation Engineers** | Intent JSON → Nornir/Netmiko pipeline with delta deploy and rollback |
| **AI Builders** | Plug NetDesign into any LLM via MCP — no UI required |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  AI Assistants (Claude · ChatGPT · LangChain · Any LLM)    │
│                  │ MCP Protocol (stdio or SSE)              │
│            mcp_server.py (FastMCP) — 20 tools              │
└──────────────────┬─────────────────────────────────────────┘
                   │
┌──────────────────▼─────────────────────────────────────────┐
│  Browser UI (GitHub Pages — zero dependencies)             │
│  Step 1: Use Case → 2: Requirements → 3: Products          │
│  Step 4: Design   → 5: Configs      → 6: Deploy            │
└──────────────────┬─────────────────────────────────────────┘
                   │ HTTPS + WebSocket
                   ▼
┌───────────────────────────────────────────────────────────────────┐
│  backend/  (Python 3.11 — FastAPI · Celery · Nornir · Netmiko)   │
│  PostgreSQL · Redis · HashiCorp Vault · JWT RBAC                  │
└──────────────────┬────────────────────────────────────────────────┘
                   │ SSH / NETCONF / eAPI
                   ▼
         Network Devices (IOS-XE · NX-OS · EOS · SONiC · JunOS)
```

**Backend services (Docker Compose):**
- `api` — FastAPI REST (port 8000) with async SQLAlchemy + JWT RBAC
- `mcp` — MCP SSE server (port 8001)
- `worker` — Celery async deploy worker (Redis queue)
- `frontend` — Nginx serving the browser UI (port 8080)
- `postgres` — Design/deployment/device persistence
- `redis` — Job queue + WebSocket pub/sub
- `vault` — Device credential store (KV v2)
- `prometheus` + `grafana` — Observability (`--profile observability`)

---

## Policy Engine (15 Rules)

| Rule | Action | Triggered when |
|---|---|---|
| `PRODUCT_SELECTION_REQUIRED` | BLOCK | No products selected |
| `EVPN_REQUIRES_VRF` | BLOCK | EVPN overlay with no tenant VRF |
| `VLAN_RANGE` | BLOCK | VLAN ID outside 1–4094 |
| `SUBNET_OVERLAP` | BLOCK | Overlapping IP prefixes |
| `VNI_UNIQUENESS` | BLOCK | Duplicate VNI assignments |
| `MTU_VXLAN_HEADROOM` | FAIL | Host MTU < 9000 with VXLAN |
| `PFC_LOSSLESS_CONFIG` | FAIL | GPU/RDMA workload without PFC + ECN |
| `REDUNDANCY_REQUIRED` | FAIL | Spine count < 2 (single SPOF) |
| `SPINE_RR_REQUIRED` | FAIL | EVPN without RR on spines |
| `GPU_PFC_REQUIRED` | AUTO_FIX | GPU use case, PFC missing → added automatically |
| `EVPN_REQUIRES_BGP` | AUTO_FIX | EVPN set, BGP missing → added automatically |
| `GPU_ROCE_ECN` | WARN | GPU without RoCEv2/ECN configured |
| `SINGLE_SPINE_SPOF` | WARN | Only one spine defined |
| `WAN_ENCRYPTION` | WARN | WAN design without MACsec/IPsec |
| `BGP_AUTH_PROD` | WARN | Production BGP without MD5 auth |

---

## Deployment Gate

```
Confidence = simulation(40) + precheck(30) + policy(20) + zero-warn bonus(10)
```

| Score | Status | Meaning |
|---|---|---|
| 80–100 | 🟢 APPROVED | High confidence |
| 50–79 | 🟡 CONDITIONAL | Review warnings before proceeding |
| 0–49 | 🔴 BLOCKED | Fix blocking issues first |

---

## 6-Step Design Wizard

| Step | Output |
|---|---|
| **1 — Use Case** | Campus · DC · GPU Cluster · WAN · Hybrid · Multi-Site DCI |
| **2 — Requirements** | Protocols, security, compliance, GPU/RoCEv2, budget, vendors |
| **3 — Products** | 40+ SKUs scored 0–100 across 8 signals. Auto-selects best fit per layer |
| **4 — Design** | Animated SVG topology (HLD) + IP plan, VLAN, BGP, physical tables (LLD) |
| **5 — Configs** | Per-device configs with syntax highlighting + Myers LCS diff |
| **6 — Deploy** | Policy → Gate → Pre-checks → Backup → Delta push → Post-checks → Rollback |

---

## EVPN / VXLAN Generation

| Component | Detail |
|---|---|
| L2VNI | `10000 + vlan_id` per VLAN per leaf |
| L3VNI | `19000 + vrf_index` per tenant VRF (symmetric IRB) |
| Route-Targets | `ASN:VNI` format, per-VNI import + export |
| Spine RR | `retain route-target all` + `advertise-pip` + `route-reflector-client` |
| NVE VTEP | `suppress-arp` + `ingress-replication protocol bgp` per L2VNI |
| Anycast GW | Per-SVI `ip anycast-gateway` with shared MAC |

---

## H100 GPU / RoCEv2 Config

| Feature | Value |
|---|---|
| Host port speed | 400GbE |
| MTU | 9214 bytes |
| FEC | RS-FEC |
| DSCP marking | DSCP 24/26 → TC3 (lossless), DSCP 46 → TC5 (strict priority) |
| PFC priorities | 3 + 4 |
| ECN / DCQCN | WRED Kmin=50KB Kmax=100KB, mark-only |
| PFC Watchdog | detection=400ms, restoration=2000ms |

---

## Export Options

| Export | Format |
|---|---|
| All Configs | `.txt` bundle (one file per device) |
| HTML Report | `.html` dark theme — intent, topology, BOM, all configs |
| HLD Topology | `.svg` animated diagram |
| LLD Tables | `.csv` — IP plan, VLAN, BGP, physical connectivity |

---

## Project Structure

```
Network-Automation/
├── index.html                   # 6-step design wizard (zero dependencies)
├── src/
│   ├── css/main.css
│   └── js/
│       ├── state.js             # STATE object, STEPS, UC_LABELS
│       ├── capacity.js          # Capacity model — exact device counts
│       ├── policy_blocks.js     # 9-domain policy config generator (5 OS)
│       ├── topology.js          # SVG HLD — campus, DC, GPU, WAN
│       ├── configgen.js         # Per-platform config generators
│       ├── policyengine.js      # Policy rules engine (browser)
│       ├── simulation.js        # Failure simulation + reachability matrix
│       ├── gate.js              # Deployment gate + confidence score
│       ├── diffengine.js        # Myers LCS config diff
│       └── deploy.js            # Pre-checks, delta deploy, WebSocket feed
├── backend/
│   ├── mcp_server.py            # FastMCP — 20 tools, 4 resources, 4 prompts
│   ├── main.py                  # FastAPI REST + WebSocket + JWT RBAC
│   ├── design_engine.py         # IP plan, VLAN, BGP, topology + rationale
│   ├── sim_engine.py            # BFS failure simulation
│   ├── gate_engine.py           # Policy gate + confidence scoring
│   ├── config_gen.py            # Jinja2 renderer
│   ├── nornir_tasks.py          # Nornir + LLDP/ECN/PFC/MTU checks
│   ├── auth.py                  # JWT + RBAC (viewer/designer/operator/admin)
│   ├── db.py                    # Async SQLAlchemy session
│   ├── models.py                # ORM: Design, Deployment, Device, AuditEvent
│   ├── credentials.py           # HashiCorp Vault KV v2 + env fallback
│   ├── jobs/deploy_job.py       # Celery async deploy task
│   ├── api/ws.py                # WebSocket relay (Redis pub/sub)
│   ├── ztp/                     # POAP + EOS-ZTP + SONiC ZTP server
│   ├── routers/                 # designs, deployments, devices REST routers
│   ├── policies/                # EVPN, BGP, QoS, AAA, firewall, hardening
│   └── templates/               # Jinja2 device templates (NX-OS, EOS, SONiC, IOS-XE)
├── alembic/                     # Async database migrations
├── ops/                         # prometheus.yml, Grafana dashboards
├── docs/
│   └── mcp-setup.md             # MCP integration guide (Claude, ChatGPT, Python)
└── docker-compose.yml
```

---

## Tech Stack

**Frontend** — zero dependencies

| Layer | Technology |
|---|---|
| UI | HTML5 · CSS3 · Vanilla ES2020 |
| Topology | SVG with `animateMotion` + `mpath` |
| Diff | Myers LCS (same algorithm as git) |

**Backend** — Python 3.11+

| Library | Role |
|---|---|
| FastAPI 0.111 | REST API + WebSocket |
| FastMCP (mcp[cli]) | MCP server |
| SQLAlchemy 2.0 + asyncpg | Async ORM (PostgreSQL) |
| Alembic | Database migrations |
| Celery + Redis | Async job queue |
| Nornir 3.4 + Netmiko 4.4 | Parallel SSH to network devices |
| NAPALM 4.x | `get_config`, `get_bgp_neighbors` |
| Jinja2 3.1 | Config templating |
| HashiCorp Vault (hvac) | Device credential store |
| PyJWT + structlog | Auth + audit logging |

---

## Roadmap

- [x] 6-step intent-driven design wizard
- [x] 40+ hardware SKUs with 8-signal product scoring
- [x] Interactive SVG topology (campus, DC, GPU, WAN)
- [x] Multi-platform config generator (NX-OS · EOS · SONiC · IOS-XE · JunOS)
- [x] EVPN/VXLAN full overlay (L2VNI, L3VNI, symmetric IRB, RT scheme)
- [x] BGP community colouring — TE, RTBH, RR, per-VNI ECL
- [x] H100 GPU TOR config (PFC, DCQCN, ECN, 400GbE)
- [x] Myers LCS config diff engine
- [x] Failure simulation (BFS partition, BGP/EVPN impact)
- [x] Policy engine — 15 rules (BLOCK / FAIL / WARN / AUTO_FIX)
- [x] Deployment gate — confidence score + APPROVED / CONDITIONAL / BLOCKED
- [x] Granular rollback — device / stage / full scope
- [x] Delta deploy — push only changed lines
- [x] MCP server — 20 tools, 4 resources, 4 prompts
- [x] Capacity model — exact formulas (growth + reserve + redundancy)
- [x] Static analysis — 26 checks, 5 domains, 0–100 score
- [x] Health check + diagnostics + AI-guided troubleshooting
- [x] JWT RBAC — viewer / designer / operator / admin
- [x] Async deploy (Celery + Redis) + WebSocket live feed
- [x] ZTP — Cisco POAP, Arista EOS-ZTP, SONiC
- [x] PostgreSQL persistence (designs, deployments, devices)
- [x] HashiCorp Vault device credential store
- [ ] gNMI streaming telemetry + Prometheus metrics
- [ ] Intelligent RCA engine (topology-aware hypothesis ranking)
- [ ] Grafana network health dashboard
- [ ] React/TypeScript/Vite frontend migration
- [ ] NetBox / Nautobot integration
- [ ] Test suite (pytest, >80% coverage)

---

## License

**NetDesign AI License (NDAL) v1.0** © 2026 Amit Tiwari

Source-available, not open source.

- ✅ Free for personal use, evaluation, and learning
- ❌ Commercial use requires a paid license — contact **amit.tiwari.dev@gmail.com**
- ❌ Redistribution or offering as a service is prohibited without written permission

See [`LICENSE`](LICENSE) for full terms.

---

## Contributing

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
# Frontend: open index.html directly in a browser (no build step)
# Backend:
cd backend && pip install -r requirements.txt
python -m pytest tests/
```

PRs welcome for new platforms, policy rules, and topology types.
