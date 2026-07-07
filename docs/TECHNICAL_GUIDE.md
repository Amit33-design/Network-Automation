# NetDesign AI — Technical Guide

> **Audience**: human contributors and AI agents working on this codebase.
> **Status**: current as of 2026-07-07 (frontend 1,148 tests / backend 346 tests, both green).
> **Companion documents**:
> - [`CLAUDE.md`](../CLAUDE.md) — the agent work order: config-gen rules, tracker (§20/§22), autonomous loop (§23). **The single source of truth for in-flight work.**
> - [`CODE_REFERENCE.md`](../CODE_REFERENCE.md) — function-by-function symbol map of the whole codebase. Read it before grepping source.
> - [`AGENTS.md`](../AGENTS.md) — condensed operating manual for any coding agent (reading order, commands, hard rules).
> - [`docs/architecture.md`](./architecture.md) — the *aspirational* SaaS architecture (Clerk/Stripe/Pinecone). Not current reality; this file is.

---

## 1. What this product is

**NetDesign AI (NDAL)** is a browser-native, intent-driven network design and automation tool. A user describes intent (use case, scale, vendors, compliance) through a 6-step wizard and gets:

1. A port-math-derived **Bill of Materials** (75+ SKUs, budget-aware)
2. **HLD/LLD topology diagrams** (pure SVG, vendor-aware, packet-flow scenarios)
3. **Device configurations** for 12+ platforms (NX-OS, IOS-XE, IOS-XR, EOS, JunOS, SR Linux, Cumulus, Dell OS10, FortiOS, ArubaOS-CX, EXOS, PAN-OS)
4. **IPAM/DCIM exports** (NetBox/Nautobot bulk-import CSVs: prefixes, VLANs, IPs, devices, interfaces, cables, racks)
5. A gate-enforced **deployment pipeline** with ZTP, pre/post checks, monitoring, Day-2 ops, RCA, and troubleshooting

- **Live**: https://netdesignai.com (frontend on Vercel, deployed from `main`)
- **Backend**: FastAPI on Railway (optional — see Demo-first principle below)
- **Author**: Amit Tiwari, solo build via Claude Code

### The demo-first principle (critical to understand)

**The app must be fully functional with no backend.** Every Step 6 feature has a client-side simulation/engine that runs when the backend toggle is off (`useBackendMode()` / `isLiveMode()` returns false). When you add a feature that talks to the backend, you MUST also provide the demo-mode path. Violating this is a regression (it happened to RCA once — group U in CLAUDE.md §22 was the fix).

The pattern, in every hook:

```typescript
mutationFn: async (input) => {
  if (!isLiveMode()) return simulateXyz(input)   // pure client-side engine in lib/
  return apiCallXyz(input)                        // FastAPI endpoint
}
```

---

## 2. Repository map — what is live, what is legacy

```
Network-Automation/
├── frontend/            ★ THE LIVE APP — React 19 + TS + Vite 8 + Tailwind v4
├── backend/             ★ THE LIVE API — FastAPI + Python 3.11
├── docs/                Documentation (this file, TESTING.md, self-host.md, …)
├── CLAUDE.md            ★ Agent work order + tracker (single source of truth)
├── CODE_REFERENCE.md    ★ Symbol-level code map
├── AGENTS.md            ★ Cross-agent memory file
├── .claude/hooks/       session-start.sh (installs deps, git identity, cffi fix)
├── docker-compose*.yml  Local / distribution stacks (backend, ZTP nginx+TFTP,
│                        VictoriaMetrics, Grafana, snmp-exporter)
├── vercel.json          Frontend deployment (Vercel builds frontend/)
├── railway.toml         Backend deployment (Railway)
│
│  ── LEGACY / AUXILIARY (do not extend; superseded by frontend/ + backend/) ──
├── src/                 Legacy vanilla-JS app (pre-React). Reference only.
├── index.html, sw.js    Legacy PWA shell for the old app
├── api/, server.py      Older serverless/API experiments
├── desktop/, mobile/    Packaging experiments
├── lab_demo/, lab_topologies/, gpu_cluster_net/, network_scanner/, tools/
│                        Standalone demos & utilities, not part of the app
└── tests/, tests_gpu/, tests_lab/   Legacy test dirs (live tests are in
                         frontend/src/test/ and backend/tests/)
```

**Rule of thumb**: if it's not under `frontend/` or `backend/`, it is almost certainly not part of the deployed product. Check `CODE_REFERENCE.md` before touching anything ambiguous.

---

## 3. Frontend architecture

### 3.1 The wizard

`frontend/src/App.tsx` renders a 6-step wizard; the current step lives in the Zustand store (`step: 1–6`). Pages in `src/pages/`:

| Step | Page | Purpose |
|------|------|---------|
| 1 | `Step1UseCase.tsx` | Use case (8 types: campus/dc/gpu/wan/multisite/multicloud/aviatrix/oran), org details, NetBox import, NLP intent parser |
| 2 | `Step2Requirements.tsx` | Traffic pattern, endpoints, bandwidth, oversubscription, protocols, compliance |
| 2b | `Step2Design.tsx` | Product/vendor selection feeding the BOM |
| 3 | `Step3Config.tsx` | Config generation + per-device viewer (wizard step 5 internally) |
| 4 | `Step4NetworkDesign.tsx` | The big one: HLD/LLD diagrams, IP plan, VLANs, routing, rack layout, TCO, capacity planning, validation, all exports (NetBox IPAM/DCIM, containerlab, design JSON/Markdown) |
| 6 | `Step6Deploy.tsx` | Deploy & Validate — 8 sub-tabs (deploy/ztp/checks/netconf/monitor/day2ops/batfish/troubleshoot), observability panel |

Navigation: `components/wizard/Sidebar.tsx` with deep-nav into Step 6 sub-tabs via the `activeDeployTab` store field (never local state — this enables sidebar → tab deep-linking).

### 3.2 State — Zustand store

`src/store/useAppStore.ts` (Zustand 5 + `persist`). Everything the wizard collects and produces lives here: intent fields, `devices: BOMDevice[]`, `cabling`, `optics`, `configs: Record<string,string>`, `activeDeployTab`, `customPolicyRules`, `netboxDevices`. See CLAUDE.md §4 for the field list. `src/store/useAuthStore.ts` handles login/roles/per-user prefs (group J).

**Server state never goes in Zustand** — all backend data flows through TanStack Query hooks (`src/hooks/`). No `useEffect + fetch` anywhere.

### 3.3 The lib/ engine layer (the heart of the product)

Every domain capability is a **pure, dependency-free, unit-tested TypeScript module** in `src/lib/`. UI components stay thin; logic lives here. This is the most important convention in the codebase.

| Module | Responsibility | Key exports |
|--------|---------------|-------------|
| `bom.ts` | Port-math device sizing for all 8 use cases, cabling, optics, TCO, rack labels, BOM validation, budget bands | `buildBOM`, `buildDeviceList`, `buildCabling`, `computeTCO`, `validateBOM`, `alphaLabel` |
| `products.ts` | 75+ SKU catalog with vendor/speed/ports/uplinks/power/price | `PRODUCTS`, `VENDOR_PRODUCT_MAP` |
| `configgen.ts` | Config generation for 12+ platforms — the §6 rules live here (single underlay, no hardcoded secrets, GPU QoS, EVPN, MLAG/vPC pairs) | `generateConfig`, `generateAllConfigs`, `haPairInfo` |
| `config-validator.ts` | 14-check static validator (V-01…V-14), vendor-aware regexes | `validateConfigs` |
| `ztp.ts` | Enterprise ZTP: 11-platform vendor identification, Day-0 bootstrap, DHCP option-60, Day-N pairing | `buildZTPPlan`, `generateDay0Config`, `generateDhcpConfig` |
| `config-update.ts` | Day-N incremental change ops (7 ops × 5 CLI families) with rollback + pre-flight analysis | `CHANGE_CATALOG`, `buildChangeSet`, `analyzeChangeSet` |
| `monitoring.ts` | NOC engine: thresholds → alerts → fleet health, forecasting, correlation, SLA, alert history, per-interface drill-down | `evaluateFleet`, `correlateAlerts`, `forecastMetric`, `simulateInterfaces` |
| `rca.ts` | Client-side RCA (5 hypothesis checkers, blast radius) + live-response normalizer | `analyzeRca`, `normalizeRcaResponse` |
| `rollback.ts` | Post-check regression detection → platform-native rollback plans (§9 strategies) | `detectRegressions`, `generateRollbackPlan` |
| `closed-loop.ts` | Drift → remediate → verify pipeline | `runClosedLoop` |
| `compliance-scan.ts` | 6 framework scanners (PCI/HIPAA/SOC2/FedRAMP/ISO27001/NIST) over design + configs | `runComplianceScan` |
| `capacity-planning.ts` | Growth projection: port capacity + bandwidth/oversubscription drift | `computeCapacityPlan`, `parseSpeedGbps` |
| `ipam.ts` | IP/VLAN/prefix/VNI plan + NetBox IPAM CSVs | `genIPBlocks`, `buildNetBoxIpamExport` |
| `netbox-dcim.ts` | NetBox DCIM CSVs: devices, interfaces, cables, racks + positions | `buildNetBoxDcimExport`, `expandCablePlan`, `netboxRackPosition` |
| `netbox.ts` | NetBox/Nautobot inventory *import* | `fetchNetBoxInventory`, `inventoryToStorePatch` |
| `containerlab.ts` | Lab topology export (vendor-correct container images) | `buildContainerlabTopology`, `topologyToYAML` |
| `design-export.ts` | Full design JSON/Markdown export + import round-trip | `serializeDesign`, `applyDesignImport` |
| `telemetry-gen.ts` | gnmic/telegraf/Prometheus-alerts/Grafana-dashboard config generation | `genSNMPExporterConfig`, … |
| `scheduled-scans.ts` | Watcher configs → cron/systemd-timer bundles | `exportCronTab`, `simulateScanHistory` |
| `policies.ts`, `customPolicy.ts` | Policy snippet rendering + custom policy gate rules | |
| `utils.ts` | `formatUSD`, `cn` (class merge), misc | |

**When adding a capability, follow this shape**: pure lib module → tests in `src/test/<name>.test.ts` → thin UI wiring → (optionally) backend parity endpoint.

### 3.4 Components worth knowing

- `HLDTopologyDiagram.tsx` / `LLDTopologyDiagram.tsx` — pure SVG (NO react-flow/d3/cytoscape — rule §21.9). Vendor/model derived from the BOM, never hardcoded. HLD has packet-flow scenarios + health overlay (delegates to `lib/monitoring.ts`'s `evaluateDevice` — do not reintroduce local thresholds).
- `RackElevation.tsx` — 42U rack SVG + `computeRackLayout` (dense + ToR/GPU layouts) + `buildCableSchedule`. NOTE: `netbox-dcim.ts` mirrors this expansion logic on purpose (libs must not import from components); if you change one, change both and the e2e invariants will catch drift.
- `BackendToggle.tsx` — `useBackendMode()` context `{isLive, baseUrl}`; the demo/live switch.
- `api/client.ts` — the only fetch layer: typed `get/post/put/del` with JWT header, `login`/`verifyTotp`, `openDeployStream` (WebSocket).

### 3.5 Testing (frontend)

```bash
cd frontend
npm test                                  # vitest run — all 45 suites
npx tsc --noEmit -p tsconfig.app.json     # typecheck gate
npm run build                             # Vite build gate
```

Two tiers:

1. **Unit suites** — one per lib module (e.g. `configgen.test.ts` 100+, `ztp.test.ts` 39). Test behavior, not snapshots.
2. **`e2e-journey.test.ts` — the regression net.** ~193 scenarios simulating the full wizard pipeline (intent → BOM → configs → cabling → racks → validation → ZTP plan → DCIM export → capacity plan) across all 8 use cases × scales × speeds × oversubscription × 7 vendor sets, asserting **exact physical invariants** (fabric capacity ≥ endpoints, cable qty = leaves×uplinks, TCO = grandTotal, single underlay, no hardcoded secrets, validator WARN-free per vendor, rack positions non-overlapping, capacity-view agreement…). **Any new use case, sizing rule, exporter, or validator check MUST add an invariant here** (CLAUDE.md §22 group I). The port-math bugs this harness exists for shipped for months because unit tests only asserted weak bounds.

---

## 4. Backend architecture

FastAPI app in `backend/main.py` (single app, routers included at module load). Python 3.11. Runs on Railway; optional for the frontend (demo-first).

### 4.1 Module map

| Area | Files | Notes |
|------|-------|-------|
| App + routes | `main.py` | Direct `@app.*` routes for config-gen, checks, deploy, drift, change, RCA, troubleshoot, intent-parse, alerts, anomalies + `include_router` calls |
| Routers | `routers/` | `lab.py` (demo endpoints — **registered before main.py routes; see §7 Gotchas**), `designs`, `deployments`, `devices`, `approvals`, `orgs`, `users`, `integrations`, `export`, `custom_policy`, `user_policies` |
| Config generation | `config_gen.py` + `templates/<platform>/*.j2` + `policies/*.py` | Jinja2 with **StrictUndefined** — every variable a template references must be supplied by `_build_device_context`. 13 policy generators appended in a fixed order (`_POLICY_REGISTRY`) |
| ZTP | `ztp/` (`server.py`, `dhcp_gen.py`, `file_export.py`, `templates/<12 platforms>/day0.j2`) | Day-0 templates are management-plane only, parameterized `<CHANGE-ME-*>` secrets |
| Telemetry | `telemetry/` (`gnmi_collector.py`, `alerting.py`, `anomaly.py`, `drift_detector.py`) | gNMI → prometheus_client; started in app lifespan |
| RCA | `rca/engine.py` | Real correlation engine at `POST /api/rca/analyze` (5 checkers, blast radius, playbooks) |
| Day-N changes | `change_update.py` | Mirror of frontend `config-update.ts` (`/api/change/catalog`, `/api/change/preview`) |
| Drift | `config_drift.py` | `/api/drift/config` + `/api/drift/remediate` (generation-only, no auto-push) |
| Troubleshooting | `troubleshoot.py` | 12 playbooks mirroring the frontend's 24 (`/api/troubleshoot`) |
| Auth | `auth.py` | JWT + TOTP + RBAC (`ROLE_PERMISSIONS`, `require_permission`) |
| Integrations | `integrations/` | `netbox.py` (device sync, ZTP status, DHCP reservations), `slack/teams/jira/servicenow/gitops` |
| Device I/O | `nornir_tasks.py`, `credentials.py` | Nornir + Netmiko for real device push |
| Data | `db.py`, `models.py`, `alembic/` | SQLAlchemy async + Alembic migrations |
| MCP | `mcp_server.py` | 20 MCP tools exposing the engines to AI assistants (`docs/mcp-setup.md`) |

### 4.2 Frontend/backend parity pattern

Engines exist **twice by design**: a pure TS lib (demo mode) and a Python module (live mode + API consumers). Pairs: `config-update.ts`↔`change_update.py`, `rca.ts`↔`rca/engine.py`, `ztp.ts`↔`ztp/`, troubleshoot playbooks ↔ `troubleshoot.py`. **When you change one side, check the other** — parity drift is a recurring bug class; the tracker rows tagged "(backend)" record parity work.

### 4.3 Testing (backend)

```bash
cd backend
python -m pytest tests/ -q        # 346 tests, all green — keep it that way
```

If JWT/auth tests panic with `_cffi_backend` missing, run `pip install cffi` (the session-start hook does this automatically in Claude Code web sessions).

---

## 5. The domain rules (never break these)

These are enforced by tests and CI; they are also the product's credibility:

1. **Config-gen §6 rules** (CLAUDE.md §6): no duplicate mgmt blocks; real firewall configs (IOS-XE ZBF / PAN-OS); **no hardcoded secrets — every credential is a `<CHANGE-ME-*>` placeholder** (frontend configgen, backend templates, policy generators, Day-0 ZTP — all swept by tests); single underlay per device (IS-IS for DC/GPU, OSPF for campus/WAN — never both); GPU fabrics get PFC priority-3 no-drop + ECN/DCQCN + watchdog.
2. **Port math** (CLAUDE.md §8): device counts are always derived — leaves from endpoints/downlinks (rounded to even for HA), uplinks from `ceil(downlink_capacity / oversub / uplink_speed)`, spines from `max(uplinks_needed, fanout, 2)`. Never hardcode counts. When a SKU physically can't satisfy the oversubscription target, the BOM degrades **and `validateBOM` must warn** — the e2e harness enforces that the capacity plan and validator always agree.
3. **Constraint rules** (CLAUDE.md §7): R-01…R-06 intent-coherence checks (e.g. EVPN needs BGP; GENEVE not on Cisco hardware).
4. **Diagrams derive from the BOM** — any hardcoded vendor/model in HLD/LLD builders is a bug (fixed across groups D/E; keep it that way).
5. **ZTP Day-0 is management-plane only** — mgmt IP, SSH v2, NTP, syslog, callback. No BGP/VLANs/VXLAN/ACLs before the VERIFIED state (§11).

---

## 6. Development workflow

### 6.1 Setup

```bash
git clone https://github.com/Amit33-design/Network-Automation && cd Network-Automation
cd frontend && npm ci && npm test          # frontend green?
cd ../backend && pip install -r ../requirements.txt && python -m pytest tests/ -q
cd ../frontend && npm run dev              # :5173, proxies /api → :8000
```

### 6.2 Quality gates (all must pass before merge)

| Change touches | Required gates |
|----------------|----------------|
| `frontend/src/lib/**` | `npm test` (add tests for new behavior) + `tsc --noEmit` |
| any non-trivial `frontend/**` | + `npm run build` |
| `backend/**` | `python -m pytest tests/ -q` (whole suite — it is green; keep it green) |
| exported symbols added/renamed/removed | update `CODE_REFERENCE.md` |
| new use case / sizing rule / exporter | add invariants to `e2e-journey.test.ts` |

### 6.3 Branch & merge policy (CLAUDE.md §0 — REQUIRED)

1. Branch from latest `main`: `claude/<topic-slug>` (or `<yourname>/<topic>`).
2. Conventional commits referencing tracker IDs: `feat: F3 — NetBox DCIM rack export`.
3. Git identity **must** be `noreply@anthropic.com` / `Claude` for agent commits (Vercel-verified deploys).
4. PR to `main`, squash-merge when green, delete the branch. `main` deploys to netdesignai.com — finished work is never left on a branch.
5. Never merge `main` back into a feature branch; rebase instead.
6. Never: `--no-verify`, force-push, `git reset --hard`.

### 6.4 Tracker discipline (for agents especially)

All work is tracked in CLAUDE.md §20 (gaps G-A*) and §22 (groups A–V). Before starting: add or claim a row, mark `[~]`. After merging: flip to `[x]` with commit hash and a dense summary in the Notes column. **Never leave a row `[~]` when stopping.** New work gets a new row/group *before* implementation. The Notes column is the project's institutional memory — write it for the next session that has zero context.

### 6.5 Deployment

- **Frontend**: Vercel auto-deploys `main` (`vercel.json`); domain netdesignai.com.
- **Backend**: Railway (`railway.toml`).
- **Self-host**: `docker-compose.yml` (backend + ZTP nginx/TFTP + VictoriaMetrics + Grafana + snmp-exporter); see `docs/self-host.md`, `docker-compose.dist.yml` for the distribution profile.

---

## 7. Gotchas & tribal knowledge (read before debugging)

1. **Starlette route order**: routers are included at `main.py` module load, *before* the `@app.*` decorators below them execute. A router route with the same path as a later `@app.post` **shadows it silently**. This made the real RCA engine dead code for months (group U). When adding routes, grep for path collisions across `routers/` and `main.py`.
2. **Jinja2 StrictUndefined**: backend templates hard-fail on any missing context variable, and `_render` swallows it into a `! CONFIG GENERATION ERROR` comment — the API happily returns garbage configs. If you add a variable to a template, add it to `_build_device_context` **and** run `jinja2.meta.find_undeclared_variables` across templates (see group V1 for the incident).
3. **Rack U counting**: `RackElevation` slots count `startU` 1-based **from the top**; NetBox positions count **from the bottom** (lowest occupied U). Conversion: `position = totalU - startU - heightU + 2` (`netboxRackPosition`).
4. **`alphaLabel` for anything user-visible at scale**: naive `A + idx` overflows past `Z` into ASCII symbols at >26 items (shipped bug, group E3). Use `alphaLabel()` from `bom.ts`.
5. **Demo-mode fallback is not optional** (§1 above).
6. **`activeDeployTab` lives in the store**, not component state — sidebar deep-links depend on it.
7. **No new UI/graph npm packages** — pure React + Tailwind (+ TanStack). Diagrams are hand-rolled SVG.
8. **Vendor-aware regexes**: any validator/scanner that greps configs must handle all vendor syntaxes (Junos `set` style, SR Linux YANG blocks, EXOS `configure`) — groups M3/M4/I3 fixed a long tail of Cisco-only false positives. Test new checks against *real generated configs* for Nokia/Juniper/Extreme, not synthetic strings.
9. **The lib/component mirror**: `netbox-dcim.expandCablePlan` intentionally mirrors `RackElevation.buildCableSchedule` (libs must not import components). Change both together.
10. **Remote branch deletion no-ops through the Claude Code git proxy** — stale `claude/*` branches accumulate on GitHub. Enable GitHub's auto-delete-merged-branches or clean up via the UI; don't burn time retrying the CLI.
11. **`cryptography`/`_cffi_backend` panic** in web containers → `pip install cffi` (session-start hook handles it).
12. **licensing/ is off-limits** without explicit owner approval (pricing/entitlements/billing/auth secrets).

---

## 8. Extension recipes

### Add a new use case
1. `products.ts`: add SKUs + `VENDOR_PRODUCT_MAP` entries. 2. `bom.ts`: `SCALE_DEFS`, `PREFERRED_PRODUCTS`, `ROLE_CODE`, power/rack maps, port-math branch in `buildDeviceList`, `validateBOM` rules. 3. `configgen.ts`: per-role generators + dispatch. 4. HLD + LLD builders (BOM-derived vendor/model). 5. Step 1 tile. 6. Unit tests + **e2e-journey matrix entry + role-presence + capacity invariants**. (Reference implementation: O-RAN, gap G-A10.)

### Add a vendor
1. SKUs in `products.ts` + `VENDOR_PRODUCT_MAP`. 2. Config generators in `configgen.ts` (platform-authentic syntax; single underlay; jumbo MTU on VXLAN fabrics; BFD; storage/RoCE parity if applicable — see groups Q/M). 3. ZTP profile in `ztp.ts` (`ZTP_VENDOR_PROFILES` + Day-0) and backend `ztp/templates/<platform>/day0.j2`. 4. Validator regex coverage (`config-validator.ts`) + compliance-scan regexes. 5. Add to `VENDOR_SETS` in `e2e-journey.test.ts` — the vendor matrix must pass FAIL-free and controlled-WARN-free.

### Add a Step 6 capability
1. Pure engine in `lib/<name>.ts` + tests. 2. Sub-tab or card in `Step6Deploy.tsx`; register in `DEPLOY_SUB_ITEMS` (Sidebar) if it's a tab. 3. Demo simulation for `!isLive`. 4. Optional backend parity endpoint + pytest. 5. CODE_REFERENCE.md + tracker row.

### Add a Day-N change operation
Add the op to `CHANGE_CATALOG` in `config-update.ts` with per-CLI-family `forward` + `rollback` renderers; the UI picks it up automatically. Mirror in `backend/change_update.py`. Tests both sides. (Reference: S3.)

### Add a validator check
New `checkXyz` in `config-validator.ts` with a `V-NN` id, vendor-aware regexes, tests against real generated configs for all 7 vendors; if config-controlled, add it to the e2e harness's controlled-WARN gate.

---

## 9. Where to ask / decide

- Architecture choices, new dependencies, anything in `licensing/`, pricing/billing: **stop and ask the owner** (Amit).
- Everything else: follow CLAUDE.md §23's loop — pick the next tracker item, implement completely (code + tests + docs), verify all gates, merge to `main`, update the tracker.
