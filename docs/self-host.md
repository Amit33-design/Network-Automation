# NetDesign AI — Self-Host Guide

## Quick start

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
cp .env.example .env       # fill in required values (see below)
docker compose up --build
```

| Service | URL |
|---|---|
| Web UI | http://localhost:8080 |
| API + Swagger docs | http://localhost:8000/docs |
| MCP SSE | http://localhost:8001 |

---

## Required env vars

```bash
JWT_SECRET=<32-char random string>     # python3 -c "import secrets; print(secrets.token_hex(32))"
POSTGRES_PASSWORD=<strong password>
REDIS_PASSWORD=<strong password>
VAULT_TOKEN=<vault root token>
CORS_ORIGINS=http://localhost:8080
```

### Optional — SaaS integrations

Set these to enable cloud features (auth, payments, vector search, email, errors):

```bash
# Auth (Clerk)
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_TEAM=price_...
STRIPE_PRICE_DEPT=price_...

# Database (Supabase — cloud alternative to local Postgres)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...

# Rate limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=...

# Vector search (Pinecone)
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=netdesign-designs
PINECONE_HOST=https://xxx.svc.pinecone.io

# Embeddings (OpenAI)
OPENAI_API_KEY=sk-proj-...

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=NetDesign AI <noreply@netdesignai.com>

# Error tracking (Sentry)
SENTRY_DSN=https://...@sentry.io/...
```

---

## Docker services

| Container | Role | Port |
|---|---|---|
| `netdesign-frontend` | Nginx — serves the web UI | 8080 |
| `netdesign-api` | FastAPI REST + WebSocket | 8000 |
| `netdesign-mcp` | MCP SSE server | 8001 |
| `netdesign-worker` | Celery async deploy worker | — |
| `netdesign-postgres` | Design/deployment persistence | 5432 |
| `netdesign-redis` | Job queue + WebSocket pub/sub | 6379 |
| `netdesign-vault` | Device credential store | 8200 |

### Observability (optional)

```bash
docker compose --profile observability up
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3000  (admin / grafana_password)
```

---

## License key activation (Docker)

Set the license key in your `.env`:

```bash
NETDESIGN_LICENSE_KEY=NDA-XXXX-XXXX-XXXX
```

The container validates against `https://netdesignai.com/api/license/validate` on startup with a 30-day offline grace period.

---

## Mac desktop app

```bash
# 1. Install Colima (one-time)
brew install colima docker
colima start

# 2. Download DMG from Releases page
# 3. Open DMG → drag to /Applications
# 4. Right-click → Open (first launch — macOS Gatekeeper)
```

The app auto-starts all services and opens the UI. A LaunchAgent keeps it running across reboots.

---

## Alembic migrations

```bash
cd backend
alembic upgrade head         # apply all migrations
alembic revision --autogenerate -m "description"  # create new migration
```
