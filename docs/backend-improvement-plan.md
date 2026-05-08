# NetDesign AI — Backend Improvement Plan
## Group 1 (Operational Hardening) & Group 2 (Architecture)

> Derived from Grok AI feedback analysis — only changes that add enterprise value are included.

---

## Group 1 — Operational Hardening
**Goal:** Make the running system observable, resilient, and debuggable without touching business logic.  
**Effort:** ~2–3 days. Low risk — all additive.

### 1A · Request Correlation ID Middleware
**File:** `backend/middleware/correlation.py` (new) + `backend/main.py`

Every request gets a `X-Request-ID` header injected (or passed through if the client sends one).
All log lines for that request include the ID — makes tracing failures across API + worker trivial.

```python
# middleware/correlation.py
import uuid
from starlette.middleware.base import BaseHTTPMiddleware

class CorrelationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
        request.state.req_id = req_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
```

Register in `main.py` before CORS middleware. Passes req_id into `audit.record()` calls.

---

### 1B · Device Concurrency Semaphore
**File:** `backend/nornir_tasks.py`

Prevent accidental thundering-herd when >50 devices are deployed simultaneously.
Wrap the Nornir runner with an `asyncio.Semaphore(max_concurrent_devices)` seeded from
`NORNIR_WORKERS` env var (already exists — just needs enforcement at the async boundary).

```python
_DEVICE_SEM = asyncio.Semaphore(int(os.environ.get("NORNIR_WORKERS", 10)))

async def deploy_configs(...):
    async with _DEVICE_SEM:
        return await asyncio.to_thread(_run_nornir_deploy, ...)
```

---

### 1C · Structured Logging (structlog)
**File:** `backend/logging_config.py` (new) + all modules

Replace `logging.basicConfig` with `structlog` processors:
- JSON output in production (`LOG_FORMAT=json`)
- Pretty colored output in dev (`LOG_FORMAT=console`)
- Auto-inject `req_id`, `tier`, `version` into every log record

```
# requirements.txt: structlog>=24.0.0
LOG_FORMAT=json  # .env.example addition
```

**Why now:** Grafana Loki / Datadog can parse structured JSON logs natively.
Without this, enterprise customers can't route alerts or build dashboards from logs.

---

### 1D · Health Endpoint — Dependency Checks
**File:** `backend/main.py` — extend `/health`

Current `/health` only returns `{"status":"ok"}`. Extend to:

```python
@app.get("/health")
async def health(db=Depends(get_db)):
    checks = {}
    # DB ping
    try:
        await db.execute(text("SELECT 1"))
        checks["db"] = "ok"
    except Exception:
        checks["db"] = "error"
    # Redis ping (via Celery broker URL)
    checks["license"] = get_active_license().tier.value if get_active_license() else "none"
    ok = all(v == "ok" for v in checks.values() if v != checks.get("license"))
    return {"status": "ok" if ok else "degraded", "checks": checks, "ts": time.time()}
```

Docker Compose `healthcheck` already calls this — it will mark the container unhealthy if DB is down.

---

### 1E · Graceful Shutdown for Celery Worker
**File:** `backend/jobs/deploy_job.py`

Add SIGTERM handler so in-flight deploys complete (or mark as FAILED) before the worker exits.
Prevents half-applied configurations on rolling restarts.

```python
import signal

def _handle_sigterm(signum, frame):
    log.warning("SIGTERM received — draining in-flight tasks")
    celery_app.control.revoke(...)   # revoke queued, let running finish
    sys.exit(0)

signal.signal(signal.SIGTERM, _handle_sigterm)
```

---

## Group 2 — Architecture Improvements
**Goal:** Better separation of concerns and safer deployment state management.  
**Effort:** ~4–5 days. Medium risk — touches core deploy path.

### 2A · Deployment State Machine
**File:** `backend/routers/deployments.py` + DB model

Replace the current free-form `status` string with an explicit state machine:

```
PENDING → VALIDATING → DEPLOYING → VERIFYING → COMPLETED
                                              ↘ FAILED
                                              ↘ ROLLED_BACK
```

Transitions enforced by:
```python
VALID_TRANSITIONS = {
    "PENDING":    {"VALIDATING"},
    "VALIDATING": {"DEPLOYING", "FAILED"},
    "DEPLOYING":  {"VERIFYING", "FAILED"},
    "VERIFYING":  {"COMPLETED", "FAILED"},
    "FAILED":     {"PENDING"},          # retry
    "COMPLETED":  {"PENDING"},          # re-deploy
    "ROLLED_BACK":{"PENDING"},
}

def transition(deployment, to_state):
    if to_state not in VALID_TRANSITIONS[deployment.status]:
        raise ValueError(f"Cannot go from {deployment.status} → {to_state}")
    deployment.status = to_state
```

**Why:** Prevents double-deploy, makes rollback logic predictable, enables audit trail per state change.

---

### 2B · Deployment Freeze / Maintenance Window
**File:** `backend/main.py` + `backend/middleware/deploy_gate.py` (new)

A simple Redis flag `netdesign:deploy_freeze` blocks all `POST /api/deploy` requests when set.

```python
# POST /api/admin/freeze  (admin role only)
async def set_freeze(active: bool, redis=Depends(get_redis)):
    if active:
        await redis.set("netdesign:deploy_freeze", "1")
    else:
        await redis.delete("netdesign:deploy_freeze")
```

Middleware checks the flag before the deploy endpoint runs. Returns HTTP 503 with reason.
Used during maintenance windows or when a config audit is in progress.

---

### 2C · Config Drift Detection
**File:** `backend/routers/devices.py` + `backend/nornir_tasks.py`

After a successful deploy, store the `intended_config` hash in the device record.
A background task (Celery beat, every 6 hours) pulls running config from devices and
compares hash against the stored intent hash.

```python
# Celery beat task
@celery_app.task
def detect_config_drift():
    devices = get_all_managed_devices()
    for dev in devices:
        running_hash = fetch_and_hash_running_config(dev)
        if running_hash != dev.intended_config_hash:
            record_drift_event(dev.hostname, running_hash)
            # POST to /api/alerts or emit Prometheus gauge
```

Drift events surface in the existing `/api/alerts` endpoint as `CONFIG_DRIFT` severity.

---

### 2D · ExecutionPlan Abstraction
**File:** `backend/executor.py` (new)

Currently `api_deploy` builds its operation list inline. Extract to a reusable plan:

```python
@dataclass
class ExecutionPlan:
    steps: list[DeployStep]
    device_count: int
    estimated_duration_s: int

    def validate(self, license: LicenseInfo) -> list[str]:
        errors = []
        if not license.has_feature("deploy"):
            errors.append("Deploy requires Professional or Enterprise license")
        if self.device_count > license.max_devices:
            errors.append(f"Plan targets {self.device_count} devices; license allows {license.max_devices}")
        return errors
```

`api_deploy` becomes: `plan = build_plan(req)` → `errors = plan.validate(lic)` → `plan.execute()`.

**Why:** Makes license enforcement, dry-run mode, and pre-deploy estimation consistent.

---

## Suggested Implementation Order

| Priority | Item | Why first |
|----------|------|-----------|
| 1 | **1A** Correlation ID | Cheapest, highest observability ROI |
| 2 | **1D** Health checks | Needed for production k8s/compose probes |
| 3 | **2A** State machine | Prevents double-deploy bugs in prod |
| 4 | **1B** Concurrency semaphore | Safety for large deployments |
| 5 | **2D** ExecutionPlan | Enables clean license enforcement |
| 6 | **1C** structlog | Log pipeline maturity |
| 7 | **2B** Freeze flag | Needed for change-management workflows |
| 8 | **2C** Drift detection | Enterprise feature, needs 2A+2D first |
| 9 | **1E** SIGTERM handler | Polish — low impact |

---

*Start with Group 1 items — they are self-contained, low risk, and immediately visible to enterprise buyers doing evaluations.*
