# NetDesign AI — Full End-to-End Testing Guide

## Quick Reference

| Scope | Time | Backend needed |
|---|---|---|
| Steps 1–3 (Design, BOM, Config) | 5 min | No — pure client-side |
| Steps 4–6 (ZTP, Checks, Monitor) | 10 min | Yes — lab server (Python only, no DB) |
| Full stack with Docker | 20 min | Yes — docker-compose.local.yml |
| Real device deployment | Ongoing | Yes — real network + full stack |

---

## Option A — Frontend Only (Steps 1–3, Mac/Windows/Linux)

No Python, no Docker required.

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
git checkout main

cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

### What to test

**Step 1 — Use Case**
- Select each of the 7 use cases: Campus, Data Center, GPU Fabric, WAN, Multi-Site, Multi-Cloud, Aviatrix
- Verify the layer diagram updates for each selection
- Set Site Code = `IAD`, Site Name = `Ashburn DC`

**Step 2 — BOM / Design**
- Select scale: Small / Medium / Large — verify device count grows
- Change redundancy from Single to Dual — verify device count doubles
- Verify BOM table shows hostnames, models, unit prices, totals
- Verify Grand Total is non-zero and updates with scale
- Check dc/medium includes: Spines, Leaves, Firewalls

**Step 3 — Config Generation**
- Click "Generate Configs"
- Select each device — verify config appears in the editor
- Switch between devices — verify hostname in config matches device
- Download a config file — verify filename matches hostname
- Verify no hardcoded passwords (`grep -i "NetDesign@" downloaded-config.txt` → no results)
- Verify `<CHANGE-ME-` placeholders are present in all credentials
- GPU use case: verify `pause no-drop` present in spine/leaf configs
- WAN use case: verify `ip ospf` present (not IS-IS)
- DC use case: verify `router isis` present (not OSPF)

### Automated tests (run locally)

```bash
cd frontend
npm test              # 127 tests — should all pass
npm run build         # production build — should complete with no errors
npx tsc --noEmit      # TypeScript — should be clean
```

Expected output:
```
Test Files  9 passed (9)
Tests  127 passed (127)
```

---

## Option B — Full Wizard with Lab Server (Steps 1–6, no Docker)

**Prerequisites:** Python 3.11+, Node.js 20+

### Terminal 1 — Lab backend

```bash
cd Network-Automation/backend
pip install fastapi uvicorn
python lab_server.py
```

Expected:
```
INFO: Uvicorn running on http://127.0.0.1:8000
```

Verify it's healthy:
```bash
curl http://127.0.0.1:8000/health
# → {"status":"ok","server":"lab"}
```

### Terminal 2 — Frontend dev server

```bash
cd Network-Automation/frontend
npm install
npm run dev
```

Open **http://localhost:5173** — the Vite proxy forwards all `/api/*` calls to `:8000`.

### What to test (Steps 4–6)

**Step 4 — ZTP Simulation**
- After completing Steps 1–3, proceed to Step 4
- Verify the topology panel loads — should show 12 demo devices with roles, platforms, IPs
- Verify device count summary (routers / switches / firewalls)
- Click **Run ZTP** with no fault injection — all 12 devices should reach "online"
- Select a device and a failure stage (e.g. IAD-LEAF-A01 → `config_applied`)
- Click **Run ZTP** again — 11 online, 1 failed
- Verify the event feed shows per-device stage transitions
- Verify the failed device shows in red with the correct failure stage

**Step 5 — Pre/Post Checks**
- Click **Run Pre-Checks** — should show ~120 checks across 12 devices
- Most should be PASS, ~2–5 WARN (random)
- Note the WARN items and their remediation hints
- Click **Run Post-Checks** — repeat above
- Force a failure: select IAD-SPINE-A01 and inject "BGP session state" fail
- Verify the failed check shows with remediation text

**Step 6 — Monitoring**
- Verify health cards load for all 12 devices
- Each card should show: status badge, CPU %, uptime, role
- Most devices should be healthy; some may show degraded (random ~8%)
- The Alerts panel should show 3 demo alerts:
  - [WARNING] IAD-SPINE-A01 — BGP prefix count
  - [INFO] IAD-LEAF-A03 — Interface flap (resolved)
  - [CRITICAL] IAD-GPU-SW-01 — PFC watchdog
- The RCA panel: enter symptom "High packet loss between spine and leaf"
  - Select IAD-SPINE-A01 and IAD-LEAF-A01 as affected devices
  - Click Run RCA — should return 3 hypotheses ranked by confidence
- The RCA panel: enter symptom "PFC watchdog deadlock on GPU fabric"
  - Should return 4 hypotheses — RoCEv2 PFC deadlock at rank 0 with 94% confidence

---

## Option C — Full Stack with Docker (All features)

**Prerequisites:** Docker Desktop, Git

```bash
# 1. Get the code
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
git checkout main

# 2. Create environment file
cp .env.example .env
```

Edit `.env` — set these minimum values:
```
POSTGRES_PASSWORD=localdev123
REDIS_PASSWORD=localdev123
JWT_SECRET=<run: python3 -c "import secrets; print(secrets.token_hex(32))">
ADMIN_USER=admin
ADMIN_PASS=admin123
VAULT_TOKEN=dev-root-token
CORS_ORIGINS=http://localhost:8080,http://localhost:5173
```

```bash
# 3. Build and start all services
docker compose -f docker-compose.local.yml up -d

# 4. Watch startup (first build takes 3–5 min)
docker compose -f docker-compose.local.yml logs -f api

# 5. Verify health
curl http://localhost:8000/health
```

Access points:
- **Frontend (built):** http://localhost:8080
- **API:** http://localhost:8000
- **API docs:** http://localhost:8000/docs
- **Vault UI:** http://localhost:8200 (token: `dev-root-token`)

Shut down:
```bash
docker compose -f docker-compose.local.yml down
```

Wipe all data and restart clean:
```bash
docker compose -f docker-compose.local.yml down -v
```

---

## Option D — Real Device Deployment

This requires a live network lab with SSH-reachable devices (Cisco, Arista, Juniper, or Palo Alto).

**Prerequisites:** Full Docker stack running (Option C), Nornir inventory configured

### 1. Configure inventory

```yaml
# playbooks/inventory/hosts.yaml
IAD-SPINE-A01:
  hostname: 192.168.1.1
  platform: nxos
  groups: [dc, spine]

IAD-LEAF-A01:
  hostname: 192.168.1.11
  platform: nxos
  groups: [dc, leaf]
```

```yaml
# playbooks/inventory/groups.yaml
dc:
  username: admin
  password: <your-password>
  port: 22
```

### 2. Get a JWT token

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/token \
  -d "username=admin&password=admin123" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### 3. Run pre-deployment checks

```bash
curl -s -X POST http://localhost:8000/api/pre-checks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target_devices": ["IAD-SPINE-A01","IAD-LEAF-A01"]}' \
  | python3 -m json.tool
```

All checks must PASS before proceeding.

### 4. Deploy configs

```bash
DEPLOY_ID=$(curl -s -X POST http://localhost:8000/api/deploy \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "state": {
      "useCase": "dc",
      "scale": "medium",
      "siteCode": "IAD",
      "devices": []
    }
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['deployment_id'])")

echo "Deploy ID: $DEPLOY_ID"
```

### 5. Stream deployment events

```bash
# WebSocket stream (requires wscat: npm install -g wscat)
wscat -c "ws://localhost:8000/ws/deploy/$DEPLOY_ID"

# Or poll via REST
curl -s http://localhost:8000/api/deployments/$DEPLOY_ID \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 6. Run post-deployment checks

```bash
curl -s -X POST http://localhost:8000/api/post-checks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target_devices": ["IAD-SPINE-A01","IAD-LEAF-A01"]}' \
  | python3 -m json.tool
```

### Platform-specific rollback

If post-checks fail, roll back per platform:

**NX-OS:**
```
rollback running-config checkpoint pre-deploy-<timestamp> atomic
```

**IOS-XE:**
```
configure replace flash:pre-deploy-<timestamp>.cfg force
```

**Arista EOS:**
```
rollback clean-config checkpoint://pre-deploy-<timestamp>
```

**Juniper JunOS:**
```
rollback 1
commit
```

---

## API Test Reference

Run these curl commands against the lab server (`http://127.0.0.1:8000`) to verify all endpoints directly.

```bash
# Health
curl http://127.0.0.1:8000/health

# Topology
curl http://127.0.0.1:8000/api/topology
curl http://127.0.0.1:8000/api/topology/devices

# ZTP — all online
curl -X POST http://127.0.0.1:8000/api/ztp/run \
  -H "Content-Type: application/json" -d '{}'

# ZTP — fault injection
curl -X POST http://127.0.0.1:8000/api/ztp/run \
  -H "Content-Type: application/json" \
  -d '{"fail_device":"IAD-LEAF-A01","fail_at":"config_applied"}'

# Pre-checks
curl -X POST http://127.0.0.1:8000/api/checks/pre \
  -H "Content-Type: application/json" -d '{}'

# Post-checks with forced failure
curl -X POST http://127.0.0.1:8000/api/checks/post \
  -H "Content-Type: application/json" \
  -d '{"fail_devices":{"IAD-SPINE-A01":["BGP session state"]}}'

# Monitoring — GET
curl http://127.0.0.1:8000/api/monitoring/poll

# Monitoring — POST with fault injection
curl -X POST http://127.0.0.1:8000/api/monitoring/poll \
  -H "Content-Type: application/json" \
  -d '{"fail_devices":{"IAD-LEAF-A02":["degraded"],"IAD-FW-A01":["down"]}}'

# Alerts
curl http://127.0.0.1:8000/api/alerts

# RCA
curl -X POST http://127.0.0.1:8000/api/rca/analyze \
  -H "Content-Type: application/json" \
  -d '{"symptom":"packet loss between spine and leaf","devices":["IAD-SPINE-A01"]}'

# RCA — PFC/GPU
curl -X POST http://127.0.0.1:8000/api/rca/analyze \
  -H "Content-Type: application/json" \
  -d '{"symptom":"PFC watchdog deadlock on GPU fabric","devices":["IAD-GPU-SW-01"]}'
```

---

## Expected Test Results Summary

| Test | Expected |
|---|---|
| Frontend unit tests | 127/127 pass |
| TypeScript check | 0 errors |
| Production build | `✓ built in ~400ms`, no errors |
| `GET /health` | `{"status":"ok"}` |
| `GET /api/topology` | `{"total":12, ...}` |
| `GET /api/topology/devices` | Array of 12 devices |
| `POST /api/ztp/run` (no fault) | `online=12 failed=0` |
| `POST /api/ztp/run` (fault) | `online=11 failed=1` |
| `POST /api/checks/pre` | 120 results, mostly PASS |
| `POST /api/checks/post` (forced fail) | ≥1 FAIL with remediation |
| `GET /api/monitoring/poll` | 12 devices, summary with counts |
| `GET /api/alerts` | 3 alerts (warning/info/critical) |
| `POST /api/rca/analyze` | 3 hypotheses ranked by confidence |
| `POST /api/rca/analyze` (PFC) | 4 hypotheses, #0 is PFC at 94% |

---

## Troubleshooting

**`ECONNREFUSED` on /api/* calls in browser:**
Lab server not running. Start it: `cd backend && python lab_server.py`

**Vite proxy not forwarding to backend:**
Check `frontend/vite.config.ts` — `server.proxy` must point `/api` to `http://localhost:8000`

**Step 4 shows "no devices":**
The lab server is returning an empty list. Verify `GET /api/topology/devices` returns 12 items.

**Docker compose fails to start api service:**
Check `.env` has all required values. Run: `docker compose -f docker-compose.local.yml logs api`

**TypeScript errors after pulling latest main:**
Run `npm install` first — a dependency may have been added.

**`npm test` fails with import errors:**
Run `npm install` then retry. If still failing: `rm -rf node_modules && npm install`.
