# NetDesign AI — Architecture

## System overview

```
┌─────────────────────────────────────────────────────┐
│   AI Assistants (Claude · ChatGPT · LangChain)       │
│              MCP Protocol (stdio / SSE)              │
│          mcp_server.py — 20 tools                    │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│   Browser UI — netdesignai.com (Vercel)              │
│   Step 1 → 2 → 3 → 4 → 5 → 6                        │
│   Clerk auth · Stripe paywall · PostHog analytics    │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS + WebSocket
                   ▼
┌─────────────────────────────────────────────────────┐
│   Backend — FastAPI · Celery · Nornir · Netmiko      │
│   PostgreSQL · Redis · HashiCorp Vault · JWT RBAC    │
│   Pinecone (vector) · Sentry · Resend                │
└──────────────────┬──────────────────────────────────┘
                   │ SSH / NETCONF / eAPI
                   ▼
         Network Devices (IOS-XE · NX-OS · EOS · SONiC · JunOS)
```

## SaaS stack

| Service | Role | Free tier |
|---|---|---|
| Vercel | Frontend hosting + serverless API routes | 100GB/mo |
| Cloudflare | DNS · CDN · DDoS · WAF | Free |
| Clerk | Auth + org/team accounts + SSO | 10K MAU |
| Stripe | Payments + licensing (2.9% per txn) | — |
| Supabase | Cloud Postgres + Realtime + Storage | 500MB |
| Upstash | Redis rate limiting + license cache | 10K cmd/day |
| Pinecone | Vector DB — design similarity search | 100K vectors |
| OpenAI | `text-embedding-3-small` embeddings | ~$0.000002/query |
| Resend | Transactional email | 3K/mo |
| Sentry | Error tracking + performance | 5K errors/mo |

**Total infra cost: $12/yr** (domain only) until revenue starts.

---

## Key data flows

**Purchase flow**
```
Stripe Checkout → webhook → /api/webhook/stripe →
license key generated → Supabase write → Resend email → Clerk org upgraded
```

**Config gen flow**
```
Clerk auth check → Upstash rate limit (free: 10/hr, Pro: unlimited) →
config generated → Supabase save → Pinecone embed → Sentry monitors
```

**Similar designs flow**
```
New design started → OpenAI embed intent → Pinecone top-3 →
UI shows "Start from similar design" cards
```

**Docker license flow**
```
NETDESIGN_LICENSE_KEY env var → /api/license/validate →
Upstash cache check → Supabase lookup → 30-day offline grace
```

---

## File structure

```
Network-Automation/
├── index.html                   # 6-step design wizard
├── env.js                       # Browser runtime config (public keys)
├── vercel.json                  # Vercel deployment config
├── src/
│   ├── css/main.css
│   └── js/
│       ├── state.js             # App state + constants
│       ├── capacity.js          # Device count formulas
│       ├── topology.js          # SVG HLD generator
│       ├── configgen.js         # Per-platform config generators
│       ├── policyengine.js      # 15-rule policy engine (browser)
│       ├── simulation.js        # BFS failure simulation
│       ├── gate.js              # Deployment gate + confidence score
│       ├── diffengine.js        # Myers LCS config diff
│       ├── deploy.js            # Pre-checks, delta deploy, WebSocket
│       ├── paywall.js           # Clerk auth gate (Steps 5+6)
│       ├── analytics.js         # PostHog funnel tracking
│       └── similar_designs.js   # Pinecone similarity UI
├── api/                         # Vercel serverless functions
│   ├── webhook/stripe.js        # Payment → license → email
│   ├── license/validate.js      # License check + Upstash cache
│   └── designs/
│       ├── save.js              # Save to Supabase + embed Pinecone
│       └── similar.js           # Pinecone similarity query
├── backend/
│   ├── main.py                  # FastAPI + Sentry + CORS
│   ├── mcp_server.py            # FastMCP — 20 tools
│   ├── design_engine.py         # IP plan, VLAN, BGP, topology
│   ├── sim_engine.py            # BFS failure simulation
│   ├── gate_engine.py           # Policy gate + confidence scoring
│   ├── config_gen.py            # Jinja2 renderer
│   ├── nornir_tasks.py          # SSH to devices
│   ├── auth.py                  # JWT + RBAC
│   ├── models.py                # ORM: Design, Deployment, Device
│   ├── services/
│   │   ├── pinecone_service.py  # embed_design + find_similar
│   │   └── email_service.py     # Resend: purchase, deploy, renewal
│   ├── middleware/
│   │   └── rate_limit.py        # Upstash rate limiting
│   ├── routers/                 # designs, deployments, devices, orgs
│   ├── policies/                # EVPN, BGP, QoS, user rule engine
│   ├── jobs/deploy_job.py       # Celery async deploy task
│   ├── ztp/                     # POAP + EOS-ZTP + SONiC
│   └── templates/               # Jinja2 device templates
├── supabase/schema.sql          # Cloud DB schema + RLS policies
├── desktop/                     # Electron Mac app
├── alembic/                     # DB migrations
├── ops/                         # Prometheus + Grafana
└── docs/                        # This directory
```

---

## Tech stack

**Frontend**

| | |
|---|---|
| UI | HTML5 · CSS3 · Vanilla ES2020 (zero build step) |
| Topology | SVG with `animateMotion` |
| Diff | Myers LCS (same algorithm as git) |
| Auth | Clerk JS SDK |
| Analytics | PostHog |
| Errors | Sentry Browser SDK |

**Backend**

| Library | Role |
|---|---|
| FastAPI 0.111 | REST API + WebSocket |
| FastMCP | MCP server — 20 tools |
| SQLAlchemy 2.0 + asyncpg | Async ORM (PostgreSQL) |
| Alembic | Database migrations |
| Celery + Redis | Async job queue |
| Nornir 3.4 + Netmiko 4.3 | SSH to network devices |
| NAPALM 4.1 | `get_config`, `get_bgp_neighbors` |
| Jinja2 3.1 | Config templating |
| HashiCorp Vault (hvac) | Device credential store |
| sentry-sdk | Error tracking |
| openai | Embeddings for Pinecone |
| httpx | Async HTTP (Upstash, Resend, Pinecone) |

**Serverless (Vercel API routes)**

| Library | Role |
|---|---|
| Stripe | Webhook + payment processing |
| @supabase/supabase-js | Cloud DB client |
| @pinecone-database/pinecone | Vector upsert + query |
| openai | Embeddings |
| resend | Transactional email |
| @clerk/nextjs | Auth token validation |
