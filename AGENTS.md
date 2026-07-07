# AGENTS.md — Operating Manual for Coding Agents

Memory file for ANY coding agent (Claude Code, Codex, Cursor, aider, …) and a
quick-start for humans. Deep detail lives in the three companion documents —
this file tells you what to read, what to run, and what never to break.

## Reading order (do this before writing code)

1. **This file** — rules of engagement.
2. **[`CLAUDE.md`](./CLAUDE.md)** — the work order: config-gen rules (§6),
   constraint rules (§7), port-math (§8), store schema (§4), and the
   **tracker** (§20 known gaps, §22 groups A–V) — the single source of truth
   for what's done and what's next. §23 defines the autonomous improvement loop.
3. **[`CODE_REFERENCE.md`](./CODE_REFERENCE.md)** — function-by-function map of
   the codebase. Consult it INSTEAD of grepping/reading source from scratch.
4. **[`docs/TECHNICAL_GUIDE.md`](./docs/TECHNICAL_GUIDE.md)** — architecture,
   data flow, gotchas (§7 there is the debugging goldmine), extension recipes.

## What this product is (one paragraph)

NetDesign AI: browser-native intent-driven network design. 6-step React wizard
(intent → BOM via port-math → HLD/LLD diagrams → multi-vendor configs →
NetBox IPAM/DCIM exports → deploy/ZTP/monitoring/Day-2 ops). React 19 + TS +
Vite + Zustand + TanStack Query in `frontend/`; FastAPI + Jinja2 + Nornir in
`backend/`. Deployed to netdesignai.com from `main` (Vercel). **The app must
work fully with no backend** — every live feature has a client-side demo-mode
engine in `frontend/src/lib/`.

## Commands (the gates — all must be green before merge)

```bash
# Frontend (React/TS)
cd frontend
npm test                                # vitest — 45 suites, ~1150 tests
npx tsc --noEmit -p tsconfig.app.json   # typecheck
npm run build                           # Vite build

# Backend (FastAPI/Python)
cd backend
python -m pytest tests/ -q             # ~350 tests — suite is green; keep it green
# (if auth tests panic on _cffi_backend: pip install cffi)
```

## Hard rules (violations = regressions)

1. **No hardcoded secrets anywhere** — every credential in generated configs,
   templates, and policy output is a `<CHANGE-ME-*>` placeholder. Tests sweep
   for this on both sides.
2. **Single underlay per device** — IS-IS for DC/GPU fabrics, OSPF for
   campus/WAN. Never both in one config.
3. **Demo mode is mandatory** — new backend-touching features need a pure
   client-side fallback (`if (!isLiveMode()) return simulateXyz(...)`).
4. **Never hardcode device counts or vendors** — BOM counts come from
   port-math (`buildDeviceList`); diagram vendor/model comes from the BOM.
5. **Pure lib pattern** — domain logic goes in `frontend/src/lib/<name>.ts`
   (dependency-free, unit-tested), not in components. Server state via
   TanStack Query only; no `useEffect + fetch`. No new UI/graph npm packages.
6. **e2e harness is the regression net** — any new use case, sizing rule,
   exporter, or validator check adds invariants to
   `frontend/src/test/e2e-journey.test.ts` (~193 full-pipeline scenarios).
7. **licensing/, pricing, billing, auth secrets** — do not touch without the
   owner's explicit approval.
8. **Never** use `--no-verify`, force-push, or `git reset --hard`.

## Git workflow

- Branch from latest `main`: `claude/<topic-slug>`. Develop, commit
  (conventional: `feat:`/`fix:`/`test:`/`docs:` + tracker ID), push.
- PR → squash-merge to `main` when all gates pass → delete branch.
  `main` is deployed; finished work must never sit on a branch.
- Agent commits use identity `Claude <noreply@anthropic.com>` (Vercel-verified
  deploys). The session-start hook sets this in Claude Code web sessions.
- Never merge `main` back into a feature branch (rebase instead).

## Tracker discipline (the project's memory)

CLAUDE.md §22 is a table of work groups (A–V so far). Protocol:
1. Before starting: claim/add a row, set status `[~]`.
2. Implement COMPLETELY: code + tests + `CODE_REFERENCE.md` update.
3. After merge: flip to `[x]` with commit hash and a dense Notes summary
   written for a reader with zero context.
4. Never stop with a row at `[~]` — finish it or revert to `[ ]`.
5. New ideas become new rows/groups BEFORE implementation.

The trigger phrases "start improving" / "keep improving" mean: run the §23
loop autonomously — pick the highest-value item, ship it end-to-end, repeat.

## Known traps (short list — full list in TECHNICAL_GUIDE.md §7)

- FastAPI route shadowing: `routers/` register before `main.py`'s `@app.*`
  routes; identical paths silently win. Grep before adding routes.
- Backend Jinja2 uses StrictUndefined and swallows errors into
  `! CONFIG GENERATION ERROR` comments — missing context vars ship as broken
  configs, not crashes.
- NetBox rack positions count from the bottom; `RackElevation` slots count
  from the top (`netboxRackPosition` converts).
- Validator/scanner regexes must handle Junos `set`, SR Linux YANG, and EXOS
  syntax — Cisco-only patterns create false FAILs. Test against real
  generated configs per vendor.
- Frontend/backend engine parity is deliberate duplication (config-update ↔
  change_update, rca.ts ↔ rca/engine.py, ztp.ts ↔ ztp/). Change both sides.
- Anything outside `frontend/` + `backend/` is likely legacy (old vanilla-JS
  app in `src/`, experiments). Check CODE_REFERENCE.md before touching.

## Verification definition of done

Code + new tests green · full suite green (both sides if touched) · tsc clean ·
build clean · CODE_REFERENCE.md current · tracker row `[x]` · merged to `main`
· branch deleted.
