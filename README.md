# 🌐 NetDesign AI — Intent-Driven Network Design & Deployment Platform

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://amit33-design.github.io/Network-Automation/)
[![License: NDAL v1.0](https://img.shields.io/badge/License-Source--Available%20(NDAL%20v1.0)-red?style=flat-square)](LICENSE)
[![No Dependencies](https://img.shields.io/badge/frontend-zero%20dependencies-brightgreen?style=flat-square)](index.html)
[![Python](https://img.shields.io/badge/backend-Python%203.11+-blue?style=flat-square&logo=python)](backend/)
[![MCP Ready](https://img.shields.io/badge/MCP-AI--Native%20API-purple?style=flat-square)](backend/mcp_server.py)
[![Nornir](https://img.shields.io/badge/automation-Nornir%20%2B%20Netmiko-orange?style=flat-square)](backend/requirements.txt)

> **Express network intent in plain English. Get topology diagrams, production configs, policy validation, failure simulation, and a gate-enforced deployment pipeline — in your browser or via any AI assistant (Claude, ChatGPT, Gemini) through the MCP API.**

---

## 🚀 Live Demo

**[amit33-design.github.io/Network-Automation](https://amit33-design.github.io/Network-Automation/)**

No login. No install. Click **⚡ Demo** for a pre-filled walkthrough in under 2 minutes.

---

## 🤖 NEW — MCP Layer: Use NetDesign AI from Claude, ChatGPT, or Any AI

NetDesign AI now exposes a full **Model Context Protocol (MCP)** server — an open standard that lets AI assistants call tools directly, like a structured API for AI agents.

Instead of clicking through a UI, just describe what you need in natural language and let your AI handle the rest:

> *"Design a 2-spine 8-leaf Arista EOS DC fabric with EVPN/VXLAN, OSPF underlay, and three tenant VRFs: PROD, DEV, STORAGE. Validate all policies and generate configs."*

The AI calls the MCP tools behind the scenes and returns a complete design with production configs attached.

### What the MCP exposes

| Category | Tools / Resources |
|---|---|
| **Design** | `design_network`, `get_ip_plan`, `get_vlan_plan`, `get_bgp_topology`, `get_topology_graph` |
| **Configs** | `generate_configs` (NX-OS · EOS · SONiC · IOS-XE · JunOS) |
| **Validation** | `validate_policies` (15 rules — BLOCK / FAIL / WARN / AUTO_FIX / INFO) |
| **Simulation** | `simulate_failure`, `simulate_link_failure` (BFS partition + BGP impact) |
| **Gate** | `check_deployment_gate` (0-100 confidence score, APPROVED / CONDITIONAL / BLOCKED) |
| **Automation** | `full_automation_pipeline` (all of the above in one call) |
| **Catalogue** | `list_products` (7 platforms, filterable by use-case / vendor / platform) |
| **Resources** | `netdesign://products`, `netdesign://architectures/{uc}`, `netdesign://policy-rules`, `netdesign://community-scheme` |
| **Prompts** | `design_campus_network`, `design_dc_fabric`, `design_gpu_cluster`, `validate_and_deploy` |

---

## 🎯 Who This Is For

| Audience | What they get |
|---|---|
| **Network Architects** | HLD + LLD + production configs in minutes, not days |
| **Platform / SRE Teams** | Gate-enforced deployments with 17 pre + 8 post validation checks |
| **AI / GPU Infrastructure** | Correctly designed RoCEv2 lossless fabrics — PFC, ECN, DSCP, MTU 9216 |
| **Network Automation Engineers** | Intent JSON → Nornir/Netmiko pipeline with delta deploy and granular rollback |
| **AI Builders** | Plug NetDesign into any LLM via MCP — no UI required |

---

## ⚡ Quick Start — 3 Ways to Use NetDesign AI

### 1. Browser Only (zero install)
```
https://amit33-design.github.io/Network-Automation/
```

### 2. With Claude Desktop (MCP — recommended)
```bash
# Clone the repo
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation/backend

# Install dependencies (Python 3.10+ required for MCP)
pip install -r requirements.txt

# Add to your Claude Desktop config (see full instructions below)
```

### 3. Python Backend (for real device automation)
```bash
cd backend
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
# Docs: http://localhost:8000/docs
```

---

## 🔌 Using with Claude Desktop (MCP Setup)

### Prerequisites
- **Python 3.10 or higher** (check: `python3 --version`)
- **Claude Desktop** installed ([download](https://claude.ai/download))
- Repository cloned to your machine

### Step 1 — Install dependencies
```bash
cd /path/to/Network-Automation/backend
pip install -r requirements.txt
# This installs the mcp[cli] package along with all other deps
```

### Step 2 — Add to Claude Desktop config

Open (or create) the Claude Desktop configuration file:

| OS | Path |
|---|---|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

Add this block (adjust the path to match where you cloned the repo):

```json
{
  "mcpServers": {
    "netdesign-ai": {
      "command": "python3",
      "args": [
        "/FULL/PATH/TO/Network-Automation/backend/mcp_server.py",
        "--transport", "stdio"
      ],
      "cwd": "/FULL/PATH/TO/Network-Automation/backend",
      "env": {
        "PYTHONPATH": "/FULL/PATH/TO/Network-Automation/backend",
        "PYTHONUNBUFFERED": "1"
      }
    }
  }
}
```

> **Replace `/FULL/PATH/TO/Network-Automation`** with the actual path where you cloned the repo.
> On macOS this is typically `/Users/YOUR_NAME/...`

### Step 3 — Restart Claude Desktop

Fully quit and reopen Claude Desktop. You should see a **hammer icon 🔨** in the chat input area — click it to confirm **NetDesign AI** tools are listed.

### Step 4 — Try it out

Paste any of these into Claude Desktop chat:

```
Design a 3-tier campus network for a 500-person company with Cisco Catalyst 9k switches,
3 floors, VoIP, guest WiFi, 802.1X, and full redundancy. Generate the configs.
```

```
Design a GPU cluster fabric for 64× NVIDIA H100 GPUs across 8 racks.
Use SONiC TOR switches, Arista spines, RoCEv2 lossless, PFC priority 3+4.
Run failure simulation on spine-1 and give me the deployment gate decision.
```

```
Use the full_automation_pipeline tool to design, validate, simulate, and gate
a 2-spine 8-leaf Cisco NX-OS DC fabric with EVPN/VXLAN, OSPF underlay,
tenant VRFs for PROD, DEV, and STORAGE.
```

---

## 🤝 Using with ChatGPT (Custom GPT / GPT Actions)

ChatGPT supports MCP-compatible tools via **GPT Actions** with SSE transport.

### Step 1 — Run the MCP server in SSE mode

```bash
cd backend
python3 mcp_server.py --transport sse --host 0.0.0.0 --port 8001
```

The server is now reachable at `http://YOUR_IP:8001/sse`

> For public internet access, put this behind a reverse proxy (nginx/Caddy) with HTTPS.
> The server must be reachable from OpenAI's servers if you use ChatGPT.com.

### Step 2 — Create a Custom GPT

1. Go to [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create**
2. In the **Configure** tab, click **Add actions**
3. Import the OpenAPI schema from:
   ```
   http://YOUR_IP:8001/openapi.json
   ```
   (FastMCP auto-generates this)
4. Set authentication to **None** (or add an API key header if you configure one)
5. Save and test

### Step 3 — System prompt for your Custom GPT

```
You are a network design expert powered by NetDesign AI.
When users describe a network, call design_network() first, then
validate_policies(), simulate_failure(), and check_deployment_gate().
Always show the confidence score and gate decision before generating configs.
Use full_automation_pipeline() for end-to-end requests.
```

### Docker-based SSE server (recommended for production)

```bash
# Start MCP server in SSE mode via Docker
docker run -d \
  --name netdesign-mcp \
  -p 8001:8001 \
  -e PYTHONUNBUFFERED=1 \
  netdesign-ai:latest \
  python mcp_server.py --transport sse --host 0.0.0.0 --port 8001
```

---

## 🐍 Using from Python / LangChain / Any AI Framework

```python
# Using the mcp Python SDK directly
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def design_my_network():
    server_params = StdioServerParameters(
        command="python3",
        args=["/path/to/backend/mcp_server.py"],
        env={"PYTHONPATH": "/path/to/backend"}
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List available tools
            tools = await session.list_tools()
            print([t.name for t in tools.tools])

            # Design a network
            result = await session.call_tool(
                "design_network",
                {"description": "2 Arista spines, 8 SONiC TOR switches, 64 H100 GPUs, RoCEv2 lossless"}
            )
            print(result.content[0].text)

asyncio.run(design_my_network())
```

### With LangChain

```python
from langchain_mcp_adapters.tools import load_mcp_tools
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="python3",
    args=["/path/to/backend/mcp_server.py"],
    env={"PYTHONPATH": "/path/to/backend"}
)

# Load all NetDesign AI tools into LangChain
tools = load_mcp_tools(server_params)

# Create an agent
model = ChatAnthropic(model="claude-opus-4-5")
agent = create_react_agent(model, tools)

result = agent.invoke({
    "messages": "Design a DC fabric for a fintech company with PCI-DSS compliance, 4 spines, 16 leaves."
})
```

---

## 🧩 The Intent Model

Every design starts with a **structured intent object** — a declarative description of *what* you need, not *how* to configure it.

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

This intent feeds the entire pipeline:

```
Intent Object
    ├── Policy Engine     → 15 rules → PASS / WARN / FAIL / AUTO_FIX
    ├── Product Scoring   → 40+ SKUs scored 0–100% across 8 signals → BOM
    ├── Topology Builder  → Animated SVG HLD + LLD tables
    ├── Config Generator  → IOS-XE · NX-OS · EOS · SONiC · JunOS
    ├── EVPN/VXLAN Policy → L2VNI / L3VNI / RT scheme / symmetric IRB
    ├── BGP Policy        → Community colouring, RR, iBGP/eBGP, BFD
    ├── Deployment Gate   → Sim + Pre-checks + Policy → go / no-go
    ├── MCP Layer         → AI tools via Claude / ChatGPT / LangChain
    └── Real Deploy       → Nornir + Netmiko → delta push → post-checks
```

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  AI Assistants (Claude Desktop · ChatGPT · LangChain · Any LLM)      │
│                          │ MCP Protocol                              │
│                    mcp_server.py (FastMCP)                           │
│                    12 tools · 4 resources · 4 prompts                │
└──────────────────────────┬───────────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────────┐
│  Browser UI  (GitHub Pages — zero dependencies)                      │
│                                                                      │
│  Step 1: Use Case → Step 2: Requirements → Step 3: Products          │
│  Step 4: Design   → Step 5: Configs      → Step 6: Deploy            │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ HTTPS + WebSocket
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  backend/  (Python 3.11 — runs on your jump host or Docker)          │
│                                                                      │
│  FastAPI · Nornir 3.x · Netmiko 4.x · NAPALM 4.x · Jinja2          │
│  nl_parser · design_engine · sim_engine · gate_engine · config_gen   │
│  policies/ (EVPN · BGP · QoS · Firewall · AAA · ACL · …)            │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ SSH / NETCONF / eAPI
                           ▼
              ┌─────────────────────────────────┐
              │       Network Devices            │
              │  IOS-XE · NX-OS · EOS · SONiC   │
              │  JunOS · FortiOS · PAN-OS        │
              └─────────────────────────────────┘
```

---

## 🛡️ Policy Engine (15 Rules)

| Rule ID | Name | Action | Triggered when |
|---|---|---|---|
| P001 | BGP_ASN_RANGE | BLOCK | ASN outside valid 16-bit or 32-bit range |
| P002 | EVPN_REQUIRES_VRF | BLOCK | EVPN overlay with no tenant VRF defined |
| P003 | REDUNDANCY_REQUIRED | FAIL | Spine count < 2 (single spine = SPOF) |
| P004 | MTU_VXLAN_HEADROOM | FAIL | Host MTU < 9000 with VXLAN overlay |
| P005 | PFC_LOSSLESS_CONFIG | FAIL | GPU/RDMA workload without PFC + DCQCN ECN |
| P006 | VLAN_RANGE | BLOCK | VLAN ID outside 1–4094 |
| P007 | SUBNET_OVERLAP | BLOCK | Overlapping IP prefixes in design |
| P008 | BGP_TIMER_AGGRESSIVE | SUGGEST | Timers < 3/9 without BFD |
| P009 | MGMT_OOB_ISOLATION | WARN | Management not in dedicated OOB VRF |
| P010 | BFD_ENABLED | SUGGEST | BFD not enabled on BGP/OSPF adjacencies |
| P011 | NTP_SERVERS | WARN | Fewer than 2 NTP servers configured |
| P012 | LOGGING_CONFIGURED | INFO | No syslog server defined |
| P013 | AAA_TACACS | SUGGEST | No TACACS+/RADIUS for device auth |
| P014 | SPINE_RR_REQUIRED | FAIL | EVPN without RR on spines |
| P015 | VNI_UNIQUENESS | BLOCK | Duplicate VNI assignments |

---

## 🚦 Deployment Gate + Confidence Score

```
Gate = {
  policy:    PASS | WARN | FAIL | BLOCK   ← 15 codified rules
  sim:       none | minor | major | critical ← worst failure simulation seen
  precheck:  pass | warn | fail | skipped  ← live device pre-checks
}

Confidence = simulation(40) + precheck(30) + policy(20) + zero-warn bonus(10)

canDeploy() → true only when no BLOCK or FAIL rules fired
```

| Score | Color | Meaning |
|---|---|---|
| 80–100 | 🟢 Green | High confidence — approved for deployment |
| 50–79 | 🟡 Amber | Conditional — review warnings before proceeding |
| 0–49 | 🔴 Red | Low confidence — fix blocking issues first |

---

## 🔬 EVPN / VXLAN — What Gets Generated

For DC fabric designs the platform generates a complete EVPN/VXLAN overlay:

| Component | Detail |
|---|---|
| **L2VNI** | `10000 + vlan_id` per VLAN, per leaf |
| **L3VNI** | `19000 + vrf_index` per tenant VRF (symmetric IRB) |
| **Route-Targets** | `ASN:VNI` format — per VNI import + export |
| **Spine RR** | `retain route-target all` + `advertise-pip` + `route-reflector-client` |
| **BGP communities** | `AS:100` primary LP=200, `AS:300` backup LP=100, `AS:1000` spine-orig, `AS:9999` RTBH |
| **Extended ECL** | Per-VNI `ECL-VNI-10010 permit rt AS:10010` for leaf policy |
| **NVE VTEP** | `suppress-arp` + `ingress-replication protocol bgp` per L2VNI |
| **Anycast GW** | Per-SVI `ip anycast-gateway` with shared MAC |

---

## 🖥️ H100 GPU Server → TOR Switch Config

For GPU cluster designs (`use_case: gpu_cluster`) the platform generates:

| Feature | Value |
|---|---|
| **Host port speed** | 400GbE (Ethernet32–124) |
| **MTU** | 9214 bytes |
| **FEC** | RS-FEC enabled |
| **DSCP marking** | DSCP 24/26 → TC3 (lossless), DSCP 46 → TC5 (strict priority) |
| **PFC priorities** | 3 + 4 (no-drop queues) |
| **DCQCN / ECN** | WRED Kmin=50KB, Kmax=100KB, drop probability=0 (mark-only) |
| **PFC Watchdog** | detection=400ms, restoration=2000ms |
| **BGP per-rack** | eBGP host sessions ASN 65300+, `maximum_prefix 64` |
| **Route-maps** | `FROM-GPU-HOST` (in) / `TO-GPU-HOST` (out) per session |

---

## 🗂 Project Structure

```
Network-Automation/
│
├── index.html                     # App shell — 6-step design wizard
├── preview.svg                    # Social preview image
├── README.md
│
├── src/
│   ├── css/main.css               # Design tokens, all UI components
│   └── js/                        # All frontend modules
│       ├── state.js               # STATE object, STEPS, UC_LABELS
│       ├── products.js            # 40+ hardware SKUs
│       ├── topology.js            # SVG HLD — campus, DC, GPU, WAN topologies
│       ├── configgen.js           # Per-platform config generators
│       ├── policyengine.js        # Policy rules engine (browser)
│       ├── simulation.js          # Failure simulation, reachability matrix
│       ├── gate.js                # Deployment gate + confidence score
│       ├── diffengine.js          # Myers LCS config diff
│       ├── deploy.js              # Pre-checks, delta deploy, post-checks, rollback
│       └── ...                    # (scoring, export, observability, backend, etc.)
│
├── backend/                       # Python backend (real devices + MCP)
│   ├── mcp_server.py              # ★ MCP server — 12 tools, 4 resources, 4 prompts
│   ├── main.py                    # FastAPI REST API
│   ├── nl_parser.py               # Natural language → design state
│   ├── design_engine.py           # IP plan, VLAN, BGP, topology generation
│   ├── sim_engine.py              # Failure simulation engine
│   ├── gate_engine.py             # Policy gate + confidence scoring
│   ├── config_gen.py              # Jinja2 config renderer
│   ├── requirements.txt           # All Python dependencies (incl. mcp[cli])
│   ├── Dockerfile                 # Python 3.11-slim (MCP-compatible)
│   ├── claude_desktop_config.json # Ready-to-use Claude Desktop MCP config
│   │
│   ├── policies/                  # Policy generators (15 modules)
│   │   ├── evpn_policy.py         # EVPN/VXLAN — L2VNI, L3VNI, RT, NVE
│   │   ├── bgp_policy.py          # BGP communities, RR, iBGP/eBGP
│   │   ├── firewall_policy.py     # FortiOS, PAN-OS, ASA, IOS-XE ZBF
│   │   ├── qos_policy.py          # DSCP, PFC, DCQCN, queuing
│   │   ├── security_hardening.py  # CIS-style hardening per platform
│   │   ├── aaa_policy.py          # TACACS+, RADIUS, 802.1X
│   │   └── ...
│   │
│   └── templates/                 # Jinja2 device templates
│       ├── nxos/spine.j2          # NX-OS spine (BGP RR + EVPN)
│       ├── nxos/leaf.j2           # NX-OS leaf (VTEP + VRFs + NVE)
│       ├── eos/gpu_spine.j2       # Arista EOS GPU spine
│       ├── sonic/gpu_tor.j2       # SONiC CONFIG_DB GPU TOR
│       └── ios_xe/                # Campus access / distribution / core
│
└── docker-compose.yml             # API + MCP + frontend in one compose
```

---

## 🐳 Docker Compose — Full Stack

```bash
# Clone
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation

# Build and start
docker-compose up --build

# Services:
#   http://localhost:8080  — Web UI
#   http://localhost:8000  — FastAPI REST  (docs: /docs)
#   http://localhost:8001  — MCP SSE endpoint (for remote AI clients)
```

`docker-compose.yml` starts three containers:
- `netdesign-api` — FastAPI backend (port 8000)
- `netdesign-mcp` — MCP SSE server (port 8001)
- `netdesign-frontend` — Nginx serving the browser UI (port 8080)

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

## 🔀 Config Diff Engine

Every config regeneration computes a Myers LCS line-level diff:

```
+32 lines added  −12 lines removed  118 unchanged
```

The backend uses the same algorithm for **delta deploy** — only `+` lines are pushed to devices.

---

## ♻️ Granular Rollback

| Scope | Behaviour | Platform mechanism |
|---|---|---|
| **Device** | Restore only selected devices | `configure replace` / `rollback running-config` |
| **Stage** | Restore all devices in the deploy stage | EOS checkpoint / Junos `rollback 1` |
| **Full** | Restore everything to pre-deploy state | NAPALM full config re-push |

---

## 📤 Export Options

| Export | Format | Contents |
|---|---|---|
| All Configs | `.txt` bundle | One file per device, all platforms |
| HTML Report | `.html` | Dark theme — intent JSON, SVG topology, BOM, all configs |
| HLD Topology | `.svg` | Animated topology diagram |
| LLD Tables | `.csv` | IP plan, VLAN, BGP, physical connectivity |

---

## 🔬 Backend API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/health` | Liveness check |
| `POST` | `/api/precheck` | 17 pre-deployment checks (ICMP, SSH, LLDP, BGP, IS-IS…) |
| `POST` | `/api/deploy/delta` | LCS diff → push only changed lines |
| `POST` | `/api/postcheck` | 8 post-checks (route propagation, EVPN, LLDP…) |
| `POST` | `/api/rollback/{scope}` | Rollback: `device` / `stage` / `full` |
| `WS`   | `/ws/terminal/{id}` | Real-time log stream to browser |

---

## 🧠 Product Scoring Model

40+ hardware SKUs scored against requirements using a **weighted multi-signal model**:

```
score = baseline(60) + Σ signal_weights   →   capped 0–100
```

| Signal | Max pts | Logic |
|---|---|---|
| Use-case match | +20 | Product's use_cases[] includes scenario |
| GPU / RoCEv2 | +15 | RoCEv2, PFC, SHARP for GPU use case |
| Port speed match | +10 | Access speed matches bandwidth tier |
| Latency | +15/−20 | <500ns bonus; >1000ns on ultra-low SLA penalises |
| Compliance | +5/+8 | MACsec for PCI-DSS; FIPS-140 for FedRAMP |
| Budget tier | +15/−7 | Price tier matches budget selection |
| Vendor preference | +15/−5 | Preferred vendor earns bonus |

---

## 🆚 How NetDesign AI Differs

| Tool | Primary Focus | NetDesign AI role |
|---|---|---|
| **Ansible / Nornir** | Config execution | NetDesign AI generates the configs + intent |
| **Cisco NSO** | Service orchestration | NetDesign AI is the design layer upstream of NSO |
| **Arista CloudVision** | Arista-specific ops | Multi-vendor; produces EOS configs for CloudVision |
| **NetBox / Nautobot** | Source of truth | Complementary — NetBox integration planned |
| **Batfish** | Config analysis | Complementary — NetDesign AI generates; Batfish validates |
| **ChatGPT / Claude** | General AI | NetDesign AI is domain-specific via MCP tools |

---

## 🛠 Tech Stack

**Frontend** — pure browser, zero dependencies

| Layer | Technology |
|---|---|
| UI | HTML5 · CSS3 · Vanilla ES2020 JS |
| Topology | SVG with `animateMotion` + `mpath` for live packet flow |
| Diff | Myers LCS line-level algorithm (same as git) |
| Persistence | `localStorage` session state |

**Backend** — Python 3.11+

| Library | Role |
|---|---|
| FastAPI 0.111 | REST API + WebSocket |
| FastMCP (mcp[cli]) | MCP server — AI tool exposure |
| Nornir 3.4 | Parallel task runner |
| Netmiko 4.4 | SSH to IOS-XE / NX-OS / EOS / JunOS / SONiC |
| NAPALM 4.x | `get_config`, `get_bgp_neighbors`, `get_interfaces` |
| Jinja2 3.1 | Config templating |
| Pydantic v2 | Request/response validation |

---

## 🗺 Roadmap

- [x] 6-step intent-driven design wizard
- [x] AI product scoring — 40+ SKUs, 8-signal model
- [x] Interactive SVG topology (campus, DC, GPU, WAN HLD)
- [x] LLD: IP plan, VLAN, BGP, physical tables
- [x] Multi-platform config generator (NX-OS · EOS · SONiC · IOS-XE · JunOS)
- [x] EVPN/VXLAN full overlay — L2VNI, L3VNI, symmetric IRB, RT scheme
- [x] BGP community colouring — TE, RTBH, RR, per-VNI ECL
- [x] H100 GPU server → TOR config (PFC, DCQCN, ECN, 400GbE)
- [x] Myers LCS config diff engine
- [x] Network failure simulation (BFS partition, BGP/EVPN impact)
- [x] Policy engine — 15 codified rules (BLOCK / FAIL / WARN / AUTO_FIX / INFO)
- [x] Deployment gate — confidence score + APPROVED / CONDITIONAL / BLOCKED
- [x] Granular rollback — device / stage / full scope
- [x] Delta deploy — LCS diff → push only changed lines
- [x] Python backend — FastAPI + Nornir + Netmiko + NAPALM
- [x] 17 real pre-deployment checks + 8 post-deployment checks
- [x] **MCP server — 12 tools, 4 resources, 4 prompts (Claude / ChatGPT / LangChain)**
- [x] Firewall policy (FortiOS, PAN-OS, ASA, IOS-XE ZBF)
- [x] Security hardening, AAA, ACL, QoS, 802.1X policy generators
- [ ] NetBox / Nautobot source-of-truth integration
- [ ] ServiceNow / Jira change-control hooks
- [ ] Batfish pre-deployment config analysis
- [ ] gRPC / NETCONF full transport (JunOS / NX-OS)
- [ ] Arista CloudVision API integration
- [ ] IPv6-only design mode
- [ ] PDF export
- [ ] TCO calculator

---

## ⚠️ Known Limitations

| Area | Status |
|---|---|
| MCP server | Requires Python 3.10+ (MCP SDK constraint) |
| SONiC deploy | REST API; SSH fallback only |
| NETCONF transport | Scaffolded; Netmiko SSH used in practice |
| NetBox sync | Planned |
| PDF export | HTML report available as workaround |

---

## 📄 License

MIT © 2024 Amit Tiwari — contributions welcome.

---

## 🤝 Contributing

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation

# Frontend: just open index.html in a browser — no build step
# Backend:
cd backend
pip install -r requirements.txt
python -m pytest tests/
```

PRs welcome for new platforms, policy rules, or topology types.
