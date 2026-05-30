# NetDesign AI — Enterprise Qualification Remediation Log

Assessment source: NetDesignAI_Enterprise_Qualification.md (2026-05-29)
Engineering brief: NetDesignAI_Remediation_Brief.md
Working branch: `fix/enterprise-qualification`

---

## Ticket Status

| ID | Priority | Title | Status | Commit |
|----|----------|-------|--------|--------|
| NDAI-1 | P0 | Simulation stubbed in design pipeline | ✅ Already resolved | Pre-existing (PR #24 merge) |
| NDAI-2 | P0 | GPU intent misclassified / mis-sized | ✅ Fixed | see below |
| NDAI-3 | P0 | RCA `KeyError: 'diagnostic_commands'` | ✅ Fixed + test | see below |
| NDAI-4 | P0 | Static analyzer grades synthesized design | ✅ Fixed | see below |
| NDAI-5 | P1 | CI targets non-existent test paths | ✅ Resolved | PR #24 created dirs |
| NDAI-6 | P1 | 7 failing auth tests | ✅ Fixed | see below |
| NDAI-7 | P1 | Scoring model inconsistent | 🔄 Partial | label normalization |

---

## NDAI-1 — Simulation wiring (P0)

**Assessment finding:** `design_network` returned `simulation.ecmp: {}`, `impacted: []`, `severity: "none"` for a 2-spine failure — gate awarded +40 pts on an empty result.

**Status:** ✅ Already fixed in codebase.

`sim_engine.simulate_failure()` is called at `mcp_server.py:377` and returns real ECMP before/after, impacted segments, and severity. Tested:
```
severity: minor  ecmp: {paths_before:2, paths_after:1, bandwidth_remaining_pct:50}
```
The `sim_severity_gate` mapping translates `"minor"` → `"WARN"` (24 pts), not 40 pts. Gate is accurate.

---

## NDAI-2 — GPU intent parser (P0)

**Assessment finding:** Input "256 H100 GPUs across 8 racks, SONiC TOR, 2 Arista spines, RoCEv2, DCQCN" → classified as `"dc"`, only 2×4 leaf topology, SONiC TOR dropped, EVPN emitted.

**Root cause:**
- `_score_keywords` used substring match — `"dc"` matched inside `"dcqcn"`, giving DC score = GPU score
- `_best()` returned first maximum → `"dc"` beat `"gpu"` (dict insertion order)
- GPU scale: 256 hit the generic `< 500 → "small"` threshold
- No SONiC entry in `_VENDOR_KEYWORDS`

**Fixes — `backend/nl_parser.py`:**

1. **Word-boundary matching for short keywords (≤3 chars):** `_score_keywords()` now uses `r'\b<kw>'` regex for keywords ≤3 chars. `"dc"` no longer matches inside `"dcqcn"`.

2. **GPU-priority tie-breaking:** `_UC_PRIORITY = ["gpu", "multisite", "wan", "hybrid", "dc", "campus"]` — when scores tie, GPU wins over DC.

3. **GPU-aware scale thresholds:** `_detect_scale()` branches on `uc == "gpu"` and uses GPU count (not user count) — 256 GPUs → `"large"`.

4. **Rack-count-driven leaf count:** For `uc == "gpu"`, `leaf_count = max(rack_count, 4)` when rack count is explicit. Gives correct 8 TORs for 8 racks.

5. **SONiC vendor detection:** Added `"SONiC": ["sonic", "azure sonic", "dent os"]` to `_VENDOR_KEYWORDS`.

**Verification:**
```
Input: "256 H100 GPUs across 8 racks, SONiC TOR switches, 2 Arista spines, RoCEv2 lossless, PFC priority 3, DCQCN ECN"
Result: uc=gpu, scale=large, leaf_count=8, rack_count=8, gpu_count=256, overlayProto=[]
```

---

## NDAI-3 — RCA KeyError (P0)

**Assessment finding:** `monitor_network(..., symptoms=[4 RoCE symptoms])` returned `rca: {error: "'diagnostic_commands'"}`.

**Root cause:** `monitor_engine.diagnose()` accessed `iss["diagnostic_commands"]` (hard key) — any issue lacking that key would raise `KeyError`.

**Fixes:**

1. **Defensive access — `backend/monitor_engine.py:1787`:**
   ```python
   # Before:
   cmds = iss["diagnostic_commands"].get(platform, list(iss["diagnostic_commands"].values())[0])
   # After:
   diag_cmds = iss.get("diagnostic_commands") or {}
   cmds = diag_cmds.get(platform) or (list(diag_cmds.values())[0] if diag_cmds else [])
   ```

2. **Regression tests — `backend/tests/test_rca.py` (class `TestQuickTriage`):**
   - `test_two_symptoms_returns_ok` — baseline ≥2-symptom path
   - `test_four_gpu_symptoms_returns_ok` — exact symptoms from assessment
   - `test_result_has_required_keys` — schema check
   - `test_runbook_steps_have_commands` — runbook structure
   - `test_diagnose_no_missing_diagnostic_commands` — synthetic issue without `diagnostic_commands` key; confirms defensive guard works

---

## NDAI-4 — Static analyzer grades synthesized design (P0)

**Assessment finding:** Minimal GPU state (no loopbacks, no P2P links) produced "All 10 loopback IPs unique" and "16 P2P /31 subnets non-overlapping" — because the analyzer silently regenerated a design from defaults.

**Fix — `backend/static_analysis.py`:**

- Added `_state_has_design_data(state)` helper that detects design-quality fields (`ip_plan`, `spineLoopbacks`, `p2pLinks`, `selectedProducts`).
- `run_analysis()` sets `used_defaults = not _state_has_design_data(state)` and injects a `META-1` INFO finding at the top of the report when defaults were applied:

```
[META-1] Analysis run on synthesized design defaults
The provided state lacks design-level outputs. Static analysis auto-completed
a design from intent defaults and is grading those defaults — not your literal
configuration. Pass the `state` returned by design_network() for accurate validation.
```

This makes the "auto-completion" behaviour explicit and operator-visible without breaking the intent-lint CI scenario (which intentionally uses a minimal state and only checks for `critical` findings, not `info`).

---

## NDAI-5 — CI integrity (P1)

**Assessment finding:** Root `.github/workflows/ci.yml` targeted `tests/`, `tests_gpu/`, `--cov=network_scanner`, `--cov=gpu_cluster_net` — none of those dirs/modules existed.

**Status:** ✅ Resolved by PR #24 merge.

PR #24 added `network_scanner/`, `gpu_cluster_net/`, `tests/`, `tests_gpu/`, `tests_lab/` to the repo. The root `ci.yml` now has valid targets.

Backend FastAPI tests (`backend/tests/`) are covered by `.github/workflows/netdesign-validate.yml` (unit-tests job with Postgres + Redis services, pointing at `backend/tests/`).

---

## NDAI-6 — Auth test failures (P1)

**Assessment finding:** 7 failing tests in `backend/tests/test_auth.py` — `'Depends' object has no attribute 'credentials'`.

**Root causes — `backend/auth.py`:**

1. **`ROLE_PERMISSIONS[Role.ADMIN]`** was `{"*"}`. Direct `perm in perms` set checks failed because `"deploy:prod" in {"*"}` is `False`. Tests `test_role_has_permission[admin-*]` and `test_admin_is_superset_of_operator` failed.

2. **`_dep(request, creds=Depends(_bearer))`** — `request` was the first positional parameter. Tests calling `dep(creds)` bound `creds` to `request` and left `creds` as `Depends(_bearer)` default, causing `'Depends' object has no attribute 'credentials'`.

**Fixes:**

1. Expanded `ROLE_PERMISSIONS[Role.ADMIN]` to an explicit superset of OPERATOR permissions:
   ```python
   Role.ADMIN: {
       "designs:read", "designs:write", "configs:generate",
       "deployments:read", "deploy:lab", "deploy:staging", "deploy:prod",
       "approvals:read", "audit:read", "users:manage", "org:admin",
   }
   ```
   `_has_permission()` still works (checks `permission in allowed`). Tests using `perm in ROLE_PERMISSIONS[role]` also work.

2. Swapped `_dep` parameter order: `creds` first (with `Depends(_bearer)` default), `request: Request | None = None` second. FastAPI auto-injects `Request` by type regardless of position. Tests can call `dep(creds)` directly.

**Result:** 19/19 auth tests pass.

---

## NDAI-7 — Scoring normalization (P1, partial)

**Assessment finding:** Health labeled "critical" at 75/100; three different scores in one report (monitor 20, health 75, analysis 14).

**Status:** 🔄 Partially addressed.

The `monitor_network` tool already computes a weighted `monitor_score = h_score * 0.45 + a_score * 0.45 - diag_penalty` as the unified score. The `overall` label in `static_analysis.py` was mapped as:
- `crit_count > 0 → "critical"`
- `fail_count > 0 → "fail"`
- `warn_count > 3 → "warn"`
- otherwise → "pass"`

This can call "critical" even at 75/100 if any single check has `severity="critical"`. The label/score are measuring different things (one finding severity vs aggregate). A full normalization pass (mapping score bands to consistent labels) is deferred to NDAI-7b — the current behaviour is documented so operators know scores and labels come from different axes.

---

## Test Results After Remediation

```
Backend:  103 passed / 0 failed  (tests/ — auth, config_gen, gate_engine, rca, ztp)
Frontend: 142 passed / 0 failed  (10 test files — all Vitest suites)
```

---

## Feature Enhancement — Policy Library, Custom Policy Engine, Troubleshooting (2026-05-30)

User report: *"I only see 1 config not different policy option like before"*, *"troubleshooting
engine should have more network troubleshooting common issues not only 5"*, and *"there was
a customer policy engine before which needs to be enhanced."*

### Root cause — policy regression
The backend has 13 rich policy generators (`backend/policies/*.py`) + a full customer rule
engine (`user_rule_engine.py`), but the demo-mode **frontend never applied any of them**:
- `ConfigPolicyModal` exposed only 10 basic management blocks, and `policyBlocks` was
  **set but never consumed** by config generation (dead wiring).
- `PolicyRulesEditor` (customer policy engine) only did a regex "looks-like-YAML" check —
  it never evaluated rules against the design.

### FEAT-1 — Client-side policy library + wiring (`frontend/src/lib/policies.ts`)
- New catalog of **21 enterprise policies** across 5 categories (Management, Security,
  L2 Switching, L3 Routing, QoS & Voice), mirroring the backend generators:
  NTP, SNMPv3, Syslog, LLDP, Banner, Archive, AAA/TACACS+, SSH hardening, CoPP, 802.1X,
  DHCP-snooping/DAI/IPSG, Port-security, Storm-control, Mgmt-ACL, STP hardening, VLAN hygiene,
  BGP route-policy, IGP auth, Floating-static+IP-SLA, QoS marking, Voice VLAN + LLDP-MED.
- Each policy is **role-aware and platform-aware** (`render(dev, useCase) → CLI | null`):
  802.1X/voice/port-security only on access; BGP/IGP/CoPP on routing roles; GPU QoS suppressed
  (GPU base config owns RoCEv2 QoS). Vendor-correct CLI for Cisco / Arista / Juniper.
- **Wired into `generateAllConfigs(devices, useCase, policyBlocks)`** — selected policies are
  appended as individual `! ====== POLICY: <LABEL> ======` sections that appear in the Step-3
  section navigator. `Step3Config` regenerates configs when the policy selection changes.
- `ConfigPolicyModal` rebuilt to render the categorized catalog with per-group select/deselect.
- Secrets use `<CHANGE-ME-*>` placeholders (CLAUDE.md rule 6).

### FEAT-2 — Customer policy engine, functional in demo mode (`frontend/src/lib/customPolicy.ts`)
- Client-side counterpart to `user_rule_engine.py`: parses a constrained, robustly-parseable
  rule format and **actually evaluates** rules against live design intent + generated configs.
- Single-line `when: "<field> <op> <value>"` DSL with the backend op set (eq/neq/contains/
  not_contains/in/not_in/gt/lt/gte/lte/is_empty/is_not_empty/config_contains/config_not_contains).
- Rule fires ⇒ finding; severity → gate (PASS/WARN/FAIL/BLOCK), matching backend semantics.
- `PolicyRulesEditor` gains an **"Evaluate against design"** button + results panel showing
  fired rules grouped by severity with the gate verdict. State read via `getState()` at
  click-time (no whole-store subscription).

### FEAT-3 — Troubleshooting engine: 5 → 12 scenarios (`TroubleshootingEngine.tsx`)
Added 7 common scenarios in the existing `Scenario` shape (signals + weighted root-cause
correlation + per-platform remediation CLI + verification + MTTR), backed by the existing
backend issue taxonomy:
OSPF adjacency stuck (ExStart/MTU), same-VLAN L2 connectivity loss, DHCP failure (relay/
snooping/scope), Path-MTU black hole (jumbo/VXLAN), interface errors/flapping (optics/CRC),
spanning-tree loop / broadcast storm, high CPU / control-plane overload.

### Tests
```
Frontend: 166 passed / 0 failed  (12 suites; +11 policies, +13 customPolicy)
Backend:  103 passed / 0 failed
Build + tsc --noEmit: clean
```
New suites: `src/test/policies.test.ts`, `src/test/customPolicy.test.ts`.

---

## Feature Enhancement — Greenfield Deployment Orchestrator (2026-05-30)

User request: *"check Python and Jinja for automating greenfield deployment — should be in
code; if not, build it."*

### Finding
All deployment building blocks already exist and are production-ready: Jinja config rendering
(`config_gen.py` + `templates/{nxos,eos,ios_xe,sonic,junos}/*.j2`), Day-0 ZTP bootstrap
(`ztp/server.py` + `ztp/templates/*/day0.j2`), Nornir pre/post-checks + push + rollback
(`nornir_tasks.py`, `jobs/deploy_job.py`), Ansible export, and the design engine's IP plan.
**Three gaps** remained — nothing tied them into a greenfield workflow:
1. No generator turned a *design* into a Nornir/Ansible **inventory** (only a static hand-written `hosts.yml`).
2. No **unified greenfield orchestrator** (register → day-0 → reachability → day-N → verify).
3. No **inventory-from-design** rendering.

### FEAT-4 — Greenfield orchestrator (`backend/greenfield.py` + Jinja templates)
- `build_inventory(state)` — Nornir SimpleInventory dict from `generate_ip_plan()` management
  IPs; infers role from device name, maps role+vendor → nornir/ztp/ansible platform, assigns
  groups, derives mgmt gateway + loopback. (gaps #1, #3)
- `render_inventory_files(state)` — Jinja-renders `hosts.yml` (Nornir), `groups.yml`, and
  `ansible_hosts.ini` from new templates in `backend/templates/inventory/*.j2`. (gap #3)
- `build_bootstrap_bundle(state)` — Day-0 per device via the existing ZTP day0 Jinja templates.
- `build_production_bundle(state)` — Day-N via `config_gen.generate_all_configs()`.
- `deployment_order(inv)` — tier-ordered push (spine/core → leaf/dist → access → edge → firewall).
- `plan_greenfield(state)` — `GreenfieldPlan` with a 6-stage ordered workflow (register/DHCP →
  ZTP bootstrap → reachability gate → pre-checks+backup → tier-ordered push → post-checks),
  each stage carrying actions, success criteria, and rollback policy. `.to_dict()` for JSON. (gap #2)
- `execute_greenfield(state, dry_run=True)` — runs pre→push→post via the existing `nornir_tasks`
  (which already degrade to simulation when Nornir/devices are unavailable). Dry-run by default.
- Credentials emitted as `<CHANGE-ME-*>` placeholders.

### Exposure
- MCP tools added in `mcp_server.py`: `plan_greenfield_deployment`, `execute_greenfield_deployment`.
- FastAPI route added in `main.py`: `POST /api/greenfield/plan` (RBAC `configs:generate`).

### Tests
```
backend/tests/test_greenfield.py — 18 tests (run against the REAL design engine,
config_gen, ZTP templates, and nornir_tasks). All pass.
Backend total: 121 passed / 0 failed.
py_compile: greenfield.py, mcp_server.py, main.py all clean.
```
