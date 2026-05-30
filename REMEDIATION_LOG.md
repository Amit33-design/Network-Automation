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
