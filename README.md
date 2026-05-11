# NetDesign AI

[![Live App](https://img.shields.io/badge/Live-netdesignai.com-00e5a0?style=flat-square)](https://netdesignai.com)
[![Demo](https://img.shields.io/badge/Demo-GitHub%20Pages-blue?style=flat-square)](https://amit33-design.github.io/Network-Automation/)
[![Download](https://img.shields.io/badge/Desktop-v2.4.0-brightgreen?style=flat-square)](https://github.com/Amit33-design/Network-Automation/releases/latest)
[![MCP](https://img.shields.io/badge/MCP-20%20tools-purple?style=flat-square)](docs/mcp-setup.md)
[![License](https://img.shields.io/badge/License-Source--Available-red?style=flat-square)](LICENSE)

**Intent-driven network design → production configs → gate-enforced deployment. Browser-native, AI-ready.**

Express network intent in plain English. Get topology diagrams, multi-vendor configs, policy validation, failure simulation, and a safe staged deployment pipeline — all in the browser or via any AI assistant through MCP.

---

## Use it now

| Option | How |
|---|---|
| **Web app** | [netdesignai.com](https://netdesignai.com) |
| **Demo** (no login) | [GitHub Pages →](https://amit33-design.github.io/Network-Automation/) — click ⚡ Demo |
| **Mac desktop app** | [Download v2.4.0 →](https://github.com/Amit33-design/Network-Automation/releases/latest) |
| **Docker self-host** | See below |
| **MCP / AI assistant** | [MCP setup guide →](docs/mcp-setup.md) |

---

## What it does

```
Intent → Hardware Selection → HLD/LLD Topology → Multi-vendor Configs
       → Policy Validation → Failure Simulation → Gate Score → Deploy
```

- **6-step wizard** — use case → requirements → products → design → configs → deploy
- **40+ hardware SKUs** — scored across 8 signals, auto-selected per layer
- **5 platforms** — NX-OS · EOS · SONiC · IOS-XE · JunOS (+ NVIDIA Spectrum-X)
- **Policy engine** — 15 rules: BLOCK / FAIL / WARN / AUTO_FIX
- **Deployment gate** — 0–100 confidence score before any push
- **MCP layer** — 20 tools callable from Claude, ChatGPT, LangChain, any LLM
- **Real deploy** — Nornir + Netmiko, delta push, pre/post checks, rollback

[Full feature list →](docs/features.md)

---

## Docker self-host

```bash
cp .env.example .env        # fill JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD
docker compose up --build
```

| Service | URL |
|---|---|
| Web UI | http://localhost:8080 |
| API + docs | http://localhost:8000/docs |
| MCP SSE | http://localhost:8001 |

[Self-host guide →](docs/self-host.md)

---

## Mac desktop app

```
1. Install Colima:  brew install colima docker && colima start
2. Download DMG from Releases
3. Right-click → Open (first launch only)
```

The app auto-starts all Docker services and opens the UI. No terminal needed after setup.

---

## MCP — use with any AI assistant

Connect NetDesign AI as a tool inside Claude Desktop, ChatGPT, or any LLM via MCP:

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation/backend
pip install -r requirements.txt
```

Add `backend/claude_desktop_config.json` to your Claude Desktop config → restart → 🔨 20 tools ready.

**20 tools across:** design · configs · validation · simulation · gate · monitoring · post-deploy · full pipeline

[MCP setup + full tool list →](docs/mcp-setup.md)

---

## Stack

**SaaS** — [netdesignai.com](https://netdesignai.com): Vercel · Clerk · Stripe · Supabase · Pinecone · Resend · Sentry · Upstash · Cloudflare

**Self-hosted**: FastAPI · Celery · Nornir · Netmiko · PostgreSQL · Redis · HashiCorp Vault · Electron

[Architecture →](docs/architecture.md) · [Tech stack →](docs/architecture.md#tech-stack)

---

## Docs

| | |
|---|---|
| [Features](docs/features.md) | Full feature list — policy engine, gate, EVPN, GPU fabric, export |
| [MCP Setup](docs/mcp-setup.md) | Connect to Claude, ChatGPT, LangChain |
| [Self-Host](docs/self-host.md) | Docker Compose, env vars, Vault, observability |
| [Architecture](docs/architecture.md) | System design, file structure, tech stack |
| [SOP](SOP.md) | Complete operating procedures for every feature |

---

## License

**NetDesign AI License (NDAL) v1.0** © 2026 Amit Tiwari — source-available.

- ✅ Free for personal use, evaluation, learning
- ❌ Commercial use requires a paid license → [netdesignai.com](https://netdesignai.com) or **atiwari824@gmail.com**
- ❌ No redistribution or SaaS resale without written permission

[Full license →](LICENSE)
