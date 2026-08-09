# NetDesign AI — Architecture

> A design compiler that runs in the browser. One intent object goes in; a bill
> of materials, a cable schedule, an IP plan, per-device vendor CLI and a
> deployment runbook come out — computed entirely client-side, with a FastAPI
> backend that is optional for **design** and required for **deployment**.

| | |
|---|---|
| Frontend | React 19 · TypeScript · Vite · Tailwind v4 · Zustand 5 · TanStack Query v5 |
| Design engines | 22 modules in `frontend/src/lib/`, ~15.8k LOC, no I/O |
| Backend | FastAPI · Python 3.11 · Nornir + Netmiko · Jinja2 |
| Tests | 1,323 frontend across 45 files, incl. a 193-scenario e2e harness |

Companion docs: [`CODE_REFERENCE.md`](../CODE_REFERENCE.md) (function-level map)
· [`docs/TECHNICAL_GUIDE.md`](./TECHNICAL_GUIDE.md) (extension recipes, tribal
knowledge) · [`AGENTS.md`](../AGENTS.md) (operating manual) ·
[`CLAUDE.md`](../CLAUDE.md) (live backlog).

---

## 1. The central idea

Most network-design tools are servers with a web UI. This one is inverted: the
design logic is a set of **pure TypeScript functions that run in the browser**,
and the backend exists only to touch things a browser cannot — real devices, a
database, and long-running jobs.

That inversion is the most important thing to understand before changing
anything. It means a user can produce a complete, deployable design with no
server at all, and it means every engine is directly unit-testable without
fixtures, mocks, or a running API.

The switch between the two worlds is one function. `isLiveMode()` reads a
backend URL out of `localStorage`; if there isn't one, the hook calls a local
engine instead of the network:

```ts
// frontend/src/hooks/useRca.ts
if (!isLiveMode()) {
  return analyzeRca({ symptom, affectedDevices: devices, design })  // lib/rca.ts
}
return runRca(symptom, devices, designId)                            // POST /api/rca/analyze
```

```
BROWSER — no server required                    OPTIONAL BACKEND
┌──────────────────────────────┐                ┌────────────────────────────┐
│  Step6Deploy.tsx             │                │  Nornir + Netmiko          │
│        │                     │                │  SSH / NETCONF to real gear│
│        ▼                     │                │        ▲                   │
│  useRunRca()  (TanStack)     │                │  rca/engine.py             │
│        │                     │                │        ▲                   │
│        ▼                     │                │  FastAPI                   │
│  isLiveMode() ? ─── false ──▶│ lib/rca.ts     │  POST /api/rca/analyze     │
│        │                     │ pure TS        │        ▲                   │
│        └──────── true ───────┼────────────────┼────────┘                   │
└──────────────────────────────┘                └────────────────────────────┘
```

Both paths return the identical typed shape, so the component never learns
which one ran. Demo mode is **not** a stub — `lib/rca.ts` is a real correlation
engine, and its output is normalised to the same schema the Python engine
returns.

> **Consequence for contributors.** When you add a Step 6 feature you owe *two*
> implementations: the client-side engine in `lib/`, and — if it needs real
> devices — the backend route. Ship the `lib/` one first; it is what the tests
> exercise and what the product demos on.

---

## 2. The wizard, and a naming trap

Six steps over a single Zustand store. Each step reads and writes that store;
no step passes props to the next.

| Step | Screen | File |
|------|--------|------|
| 1 | Use Case | `Step1UseCase.tsx` |
| 2 | Network Requirements | `Step2Requirements.tsx` |
| 3 | Products & BOM | `Step2Design.tsx` |
| 4 | Network Design | `Step4NetworkDesign.tsx` |
| 5 | Config Generation | `Step3Config.tsx` |
| 6 | Deploy & Validate | `Step6Deploy.tsx` |

> **Gotcha.** Three filenames do not match their step numbers —
> `Step2Design.tsx` is step 3, `Step3Config.tsx` is step 5. The names are
> historical; the `switch` in `App.tsx` is the authority.

Step 6 is seven screens behind one route. The sub-tab lives in the store as
`activeDeployTab` rather than local state, which is what lets the sidebar
deep-link straight into ZTP, checks, NETCONF, monitoring, day-2 ops, Batfish
validation or troubleshooting.

---

## 3. Intent in, artifacts out

A chain of pure functions with no I/O anywhere in it. Everything downstream is
derived — nothing is stored twice, so nothing can disagree with itself.

```
intent ──▶ buildDeviceList ──▶ BOMDevice[] ──┬──▶ buildCabling → buildOptics
(store)    port math →          + TCO        ├──▶ computeRackLayout
           spine/leaf counts                 ├──▶ lib/ipam.ts — IP plan
                                             ├──▶ generateAllConfigs ──┐
                                             └──▶ HLD / LLD diagrams   │
                                                                       ▼
                                                          validateBOM + 14 config checks
└──────────── e2e-journey.test.ts: 193 scenarios assert invariants ACROSS the chain ────────────┘
```

**Why the harness spans the joins.** Unit tests of `buildCabling` alone passed
for months while the BOM billed 400G optics for 100G ports — the bug lived
*between* the functions. The e2e harness is the net for that class of defect.

### What each engine owns

| Module | Owns | Notable |
|---|---|---|
| `bom.ts` | Port math, device list, cabling, optics, TCO, BOM validation | Every quantity derived, never hardcoded |
| `configgen.ts` | Per-device CLI for 7 fabric vendors + campus, firewall, SD-WAN, O-RAN | Largest engine; 250 tests guard it |
| `config-validator.ts` | 14 static checks (V-01…V-14) over generated configs | Comment-stripped — documentation is not configuration |
| `products.ts` | 75+ SKU catalog: ports, speeds, uplink blocks, interface naming | Wrong data here becomes wrong configs everywhere |
| `ipam.ts` | Prefixes, VLANs, VNIs, NetBox CSV export | — |
| `netbox-dcim.ts` | Racks, devices, interfaces, cables as NetBox imports | — |
| `ztp.ts` | Vendor identification, Day-0 bootstrap, DHCP option-60 | 12 platforms |
| `monitoring.ts` | Thresholds, alerts, correlation, SLA, forecasting | Works with no telemetry backend |
| `rollback.ts` / `closed-loop.ts` | Regression detection, platform-native rollback, drift loop | — |
| `containerlab.ts` | Topology export to a runnable virtual lab | Test the design before buying it |

---

## 4. The backend, and when it matters

FastAPI on Python 3.11, carrying the three things a browser genuinely cannot
do: reach devices, persist across sessions, and run work that outlives a page.

| Area | Surface | Why it can't be client-side |
|---|---|---|
| Device I/O | `nornir_tasks.py`, `/api/deploy`, pre/post checks | SSH and NETCONF to real hardware |
| Live progress | `WS /ws/deploy/{id}` | Streams a job that outlives the request |
| Persistence | 12 routers — designs, deployments, orgs, users, approvals | Postgres; shared across sessions and people |
| AI | `/api/intent/parse`, `/api/rca/analyze` | Holds the Claude API key server-side |
| Telemetry | `telemetry/gnmi_collector.py`, anomaly detection | Long-lived gNMI subscriptions |
| ZTP | `ztp/` + nginx and TFTP services | Devices fetch their own bootstrap over the wire |

A handful of engines exist on both sides on purpose — config generation, drift
remediation, RCA, troubleshooting and the Day-N change tool each have a
TypeScript engine and a Python one that must agree. The browser copy keeps the
product usable with no server; the Python copy is what the API serves to
non-browser clients.

**Full local stack** (`docker compose`): `api` · `worker` · `postgres` ·
`redis` · `vault` · `frontend` · `mcp` · `ztp-files` (nginx) · `ztp-tftp` ·
`prometheus` · `snmp-exporter` · `victoriametrics` · `grafana`. None of it is
needed to *design* a network; it is needed to *deploy and operate* one.

---

## 5. Deploy flow

Step 6 is the only place the tool writes to something real.

```
policy gate ──▶ pre-checks ──▶ canary ──▶ full push ──▶ post-checks
blast radius,   baseline       1 device,  Nornir /      re-run baseline
window          captured       confirm    Netmiko             │
    │                                                         │ PASS → FAIL
    │            ┌── WS /ws/deploy/{id} streams every stage    ▼
    │            │   → LiveProgressFeed                  rollback advisor
    └────────────┴──────────────────────────────────  platform-native restore
demo mode: every stage above has a client-side simulator with fault injection
```

`Start Deployment` stays disabled until the policy panel is approved, and a
canary device must be confirmed before the rest of the fleet is touched. A
check that regressed from PASS to FAIL between the two phases is what triggers
the rollback advisor — nothing is pushed automatically.

### Real device access, precisely

Two questions come up often enough to answer directly.

**Can it log into live devices?** Yes. `deploy_configs(configs, inventory,
dry_run=False)` pushes via `netmiko_send_config`; pre-checks run real
`show version`, back up `show running-config`, and collect LLDP neighbours.
Platform-native commit guards are wired per vendor — NX-OS `checkpoint` before
push, EOS `configure session` + commit, JunOS `commit confirmed 5`. The
dependencies are pinned (`nornir` 3.4.1, `nornir-netmiko` 1.0.1, `netmiko`
4.3.0, `napalm` 4.1.0).

**Can it provision out-of-box devices?** Yes — that is the ZTP subsystem.
`backend/ztp/router.py` is mounted **unauthenticated**, because devices call it
during boot before they have credentials:

| Endpoint | Caller |
|---|---|
| `GET /bootstrap/{serial}` | the factory-fresh device, fetching its Day-0 config |
| `GET /script/{platform}` | the device, fetching its POAP/ZTP script |
| `POST /checkin/{serial}` | the device, reporting it finished |

`dhcp_gen.py` emits an ISC `dhcpd.conf` with a per-vendor option-60 class so
mixed-vendor fleets self-classify; `file_export.py` writes the Day-0 tree, and
compose runs `ztp-files` (nginx :8069) and `ztp-tftp` (UDP :69) to serve it.
Day-0 templates exist for all 12 platforms.

**Known sharp edges on that path:**

1. `DeployRequest.dry_run` defaults to `true`. Nothing is pushed unless the
   caller explicitly sends `false`.
2. **A deploy can report success while touching nothing.** If Nornir is not
   importable, `deploy_configs` marks every host `"simulated"` and still sets
   `success: True`; pre-checks do the same when given no inventory. In a
   container where the netmiko install silently failed, an operator gets a
   green deployment and an unchanged fleet.
3. None of the device-facing path is verified against real hardware by the
   test suite. It is dependency-complete and unit-tested, which is not the
   same as proven against a real chassis.

---

## 6. How correctness is held

A generated config is either deployable or it is scrap, and the difference is
usually invisible to a reviewer reading a diff. Four mechanisms carry the
weight.

**Cross-vendor parity matrices.** The recurring failure mode in this codebase
has been a fix landing on one vendor and not the others. Tests are therefore
written as matrices: every EVPN vendor asserts its own next-hop token, its own
firewall handoff, its own management VRF. A fix that lands on Cisco alone fails
the suite.

**Invariants that span the pipeline.** `e2e-journey.test.ts` runs 193 scenarios
across every use case, scale, speed, oversubscription ratio and vendor, and
asserts physical facts: no cable billed faster than its slower end, no port
beyond its SKU, no spine left dark while still BGP-peered, no firewall cabled
somewhere that cannot route it.

**The audit loop.** Periodically the tool generates real designs, and the
*artifacts* — not the source — get reviewed as a network architect would review
them. Four passes so far; each found a tier of defects the tests had no opinion
about, and each defect became a permanent invariant rather than a patch.

**A tracker that survives a context reset.** `CLAUDE.md` holds the working
backlog with a status per row and enough detail to resume cold.

> **If you change one thing.** Touching `lib/configgen.ts`, `lib/bom.ts` or
> `lib/products.ts` means running the full suite, not the file's own tests.
> Those three are upstream of everything, and the interesting failures land
> somewhere else.
