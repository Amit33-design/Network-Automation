"""
NetDesign AI — Celery Async Deploy Job
========================================
Runs the full deploy pipeline asynchronously:
  pre_checks → deploy → post_checks → (auto-rollback on failure)

Publishes stage events to Redis pub/sub channel `deploy:{deployment_id}`
as JSON so the WebSocket relay in api/ws.py can forward them to the browser.

Deployment record status is updated in the DB at each stage transition:
  pending → running → success | failed | rolled_back
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Celery app — broker + backend both use REDIS_URL
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "")

try:
    from celery import Celery

    if REDIS_URL:
        celery_app = Celery(
            "netdesign",
            broker=REDIS_URL,
            backend=REDIS_URL,
        )
        celery_app.conf.update(
            task_serializer="json",
            result_serializer="json",
            accept_content=["json"],
            timezone="UTC",
            enable_utc=True,
            task_track_started=True,
            worker_prefetch_multiplier=1,
        )
        CELERY_AVAILABLE = True
        log.info("Celery app initialised with broker: %s", REDIS_URL.split("@")[-1])
    else:
        celery_app = None
        CELERY_AVAILABLE = False
        log.info("REDIS_URL not set — Celery disabled (sync fallback active)")

except ImportError:
    celery_app = None
    CELERY_AVAILABLE = False
    log.warning("Celery not installed — deploy tasks run synchronously")


# ---------------------------------------------------------------------------
# Redis pub/sub helper
# ---------------------------------------------------------------------------

def _get_sync_redis():
    """Return a synchronous redis.Redis client, or None if unavailable."""
    if not REDIS_URL:
        return None
    try:
        import redis as redis_lib
        return redis_lib.from_url(REDIS_URL, decode_responses=True)
    except Exception as exc:
        log.warning("Could not connect to Redis: %s", exc)
        return None


def _publish_event(
    r_client: Any,
    deployment_id: str,
    stage: str,
    status: str,
    detail: str = "",
    data: dict | None = None,
) -> None:
    """Publish a stage event to Redis pub/sub channel deploy:{deployment_id}."""
    if r_client is None:
        return
    channel = f"deploy:{deployment_id}"
    payload = json.dumps({
        "deployment_id": deployment_id,
        "stage":  stage,
        "status": status,
        "detail": detail,
        "ts":     time.time(),
        **(data or {}),
    })
    try:
        r_client.publish(channel, payload)
    except Exception as exc:
        log.warning("Redis publish failed for %s: %s", channel, exc)


# ---------------------------------------------------------------------------
# DB update helper (best-effort — does not raise)
# ---------------------------------------------------------------------------

def _update_deployment_status(deployment_id: str, status: str, extra: dict | None = None) -> None:
    """
    Synchronously update the Deployment record status in the database.
    Uses a new event loop inside the Celery worker thread.
    Fails silently if DB is not configured.
    """
    try:
        import asyncio
        from db import _SessionLocal
        from models import Deployment as DeploymentModel

        if _SessionLocal is None:
            return

        async def _do_update() -> None:
            async with _SessionLocal() as session:
                dep = await session.get(DeploymentModel, deployment_id)
                if dep is None:
                    return
                dep.status = status
                if status in ("success", "failed", "rolled_back"):
                    dep.completed_at = datetime.now(timezone.utc)
                if extra:
                    for key, val in extra.items():
                        if hasattr(dep, key):
                            setattr(dep, key, val)
                await session.commit()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("Loop closed")
            loop.run_until_complete(_do_update())
        except RuntimeError:
            asyncio.run(_do_update())

    except Exception as exc:
        log.warning("Could not update deployment %s status to %s: %s", deployment_id, status, exc)


# ---------------------------------------------------------------------------
# Core pipeline logic (shared by both Celery task and sync fallback)
# ---------------------------------------------------------------------------

def _run_pipeline(
    deployment_id: str,
    state: dict,
    inventory: dict,
    dry_run: bool,
    configs: dict,
    r_client: Any,
) -> str:
    """
    Execute pre_checks → deploy → post_checks pipeline.

    Returns final status string: 'success' | 'failed' | 'rolled_back'
    Publishes events to Redis pub/sub at each stage.
    """
    from nornir_tasks import run_pre_checks, deploy_configs, run_post_checks

    # ── Stage: pre_checks ──────────────────────────────────────────
    _publish_event(r_client, deployment_id, "pre_checks", "running",
                   "Starting pre-deployment checks")
    _update_deployment_status(deployment_id, "running")

    try:
        pre_results = run_pre_checks(state, inventory, deployment_id)
        pre_passed = all(r.get("passed", False) for r in pre_results)
        _publish_event(
            r_client, deployment_id, "pre_checks",
            "passed" if pre_passed else "failed",
            f"{sum(1 for r in pre_results if r.get('passed'))} / {len(pre_results)} checks passed",
            {"results": pre_results},
        )
    except Exception as exc:
        log.exception("pre_checks raised an exception for deployment %s", deployment_id)
        _publish_event(r_client, deployment_id, "pre_checks", "error",
                       f"pre_checks exception: {exc}")
        _publish_event(r_client, deployment_id, "error", "terminal",
                       f"Deployment {deployment_id} aborted during pre_checks: {exc}")
        _update_deployment_status(deployment_id, "failed")
        return "failed"

    if not pre_passed:
        _publish_event(r_client, deployment_id, "error", "terminal",
                       "Pre-checks failed — deployment aborted; no changes applied")
        _update_deployment_status(deployment_id, "failed")
        return "failed"

    # ── Stage: deploy ──────────────────────────────────────────────
    _publish_event(r_client, deployment_id, "deploy", "running",
                   f"Pushing configs to {len(inventory)} device(s) (dry_run={dry_run})")

    try:
        deploy_results = deploy_configs(configs, inventory, dry_run, deployment_id)
        deploy_ok = deploy_results.get("success", False)
        _publish_event(
            r_client, deployment_id, "deploy",
            "success" if deploy_ok else "failed",
            "Configs pushed successfully" if deploy_ok else "Deploy encountered errors",
            {"results": deploy_results},
        )
    except Exception as exc:
        log.exception("deploy raised an exception for deployment %s", deployment_id)
        _publish_event(r_client, deployment_id, "deploy", "error",
                       f"deploy exception: {exc}")
        _initiate_rollback(r_client, deployment_id, inventory)
        return "rolled_back"

    if not deploy_ok and not dry_run:
        _initiate_rollback(r_client, deployment_id, inventory)
        return "rolled_back"

    # ── Stage: post_checks ─────────────────────────────────────────
    _publish_event(r_client, deployment_id, "post_checks", "running",
                   "Running post-deployment validation")

    try:
        post_results = run_post_checks(state, inventory)
        post_passed = all(r.get("passed", False) for r in post_results)
        _publish_event(
            r_client, deployment_id, "post_checks",
            "passed" if post_passed else "failed",
            f"{sum(1 for r in post_results if r.get('passed'))} / {len(post_results)} checks passed",
            {"results": post_results},
        )
    except Exception as exc:
        log.exception("post_checks raised an exception for deployment %s", deployment_id)
        _publish_event(r_client, deployment_id, "post_checks", "error",
                       f"post_checks exception: {exc}")
        _initiate_rollback(r_client, deployment_id, inventory)
        return "rolled_back"

    if not post_passed and not dry_run:
        _initiate_rollback(r_client, deployment_id, inventory)
        return "rolled_back"

    final_status = "success"
    _publish_event(r_client, deployment_id, "post_checks", "terminal",
                   "Deployment pipeline complete — all stages passed")
    _update_deployment_status(
        deployment_id,
        final_status,
        {"post_check_results": post_results if post_passed else None},
    )
    return final_status


def _initiate_rollback(r_client: Any, deployment_id: str, inventory: dict) -> None:
    """Auto-rollback: restore pre-deployment backups from BACKUP_DIR."""
    import os
    from pathlib import Path

    _publish_event(r_client, deployment_id, "rollback", "running",
                   "Auto-rollback initiated — restoring pre-deployment configs")

    backup_path = Path(os.environ.get("BACKUP_DIR", "/tmp/netdesign_backups")) / deployment_id
    rolled = 0

    if backup_path.exists() and inventory:
        try:
            from nornir_tasks import _init_nornir, NORNIR_AVAILABLE
            if NORNIR_AVAILABLE:
                try:
                    from nornir_netmiko.tasks import netmiko_send_config
                    from nornir.core.task import Task, Result as NornirResult

                    for host_name, host_data in inventory.items():
                        cfg_file = backup_path / f"{host_name}.cfg"
                        if not cfg_file.exists():
                            log.warning("No backup for %s — skipping rollback", host_name)
                            continue
                        backup_lines = cfg_file.read_text().splitlines()
                        nr = _init_nornir({host_name: host_data})
                        if nr is None:
                            continue

                        def _restore(task: "Task", lines: list = backup_lines) -> "NornirResult":
                            return task.run(task=netmiko_send_config, config_commands=lines)

                        nr_result = nr.run(task=_restore)
                        if not nr_result[host_name].failed:
                            rolled += 1
                            log.info("Rolled back %s from %s", host_name, cfg_file)
                        else:
                            log.error("Rollback failed for %s", host_name)
                except ImportError:
                    log.warning("nornir_netmiko not available — rollback skipped")
        except Exception as exc:
            log.error("Rollback error: %s", exc)

    _publish_event(
        r_client, deployment_id, "rollback", "terminal",
        f"Rollback complete — {rolled}/{len(inventory)} devices restored",
    )
    _update_deployment_status(deployment_id, "rolled_back")


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------

if CELERY_AVAILABLE and celery_app is not None:
    @celery_app.task(bind=True, name="jobs.deploy_job.run_deployment", max_retries=0)
    def run_deployment(
        self,
        deployment_id: str,
        state: dict,
        inventory: dict,
        dry_run: bool,
        configs: dict,
    ) -> dict:
        """
        Celery task: run the full deployment pipeline asynchronously.

        Args:
            deployment_id: UUID string of the Deployment record.
            state:         DesignState dict (mirrors frontend STATE).
            inventory:     Nornir-format inventory dict.
            dry_run:       If True, configs are validated but not pushed.
            configs:       Pre-generated Jinja2 configs dict {hostname: config_str}.

        Returns:
            {"deployment_id": ..., "status": "success"|"failed"|"rolled_back"}
        """
        log.info("Celery deploy task started for deployment %s", deployment_id)
        r_client = _get_sync_redis()

        final_status = _run_pipeline(
            deployment_id=deployment_id,
            state=state,
            inventory=inventory,
            dry_run=dry_run,
            configs=configs,
            r_client=r_client,
        )

        if r_client:
            try:
                r_client.close()
            except Exception:
                pass

        log.info("Celery deploy task finished for %s with status: %s", deployment_id, final_status)
        return {"deployment_id": deployment_id, "status": final_status}

else:
    # Stub so callers can always do `from jobs.deploy_job import run_deployment`
    class _SyncDeployStub:
        """
        Synchronous fallback when Celery / Redis is not configured.
        Mimics the .delay() interface expected by main.py.
        """

        def delay(
            self,
            deployment_id: str,
            state: dict,
            inventory: dict,
            dry_run: bool,
            configs: dict,
        ) -> None:
            """Run the pipeline synchronously (blocking) in the current thread."""
            log.info("Sync fallback deploy started for deployment %s", deployment_id)
            r_client = _get_sync_redis()
            _run_pipeline(
                deployment_id=deployment_id,
                state=state,
                inventory=inventory,
                dry_run=dry_run,
                configs=configs,
                r_client=r_client,
            )

        def __call__(self, *args, **kwargs):  # noqa: D401
            """Allow `run_deployment(...)` to work like a normal function."""
            deployment_id = args[0] if args else kwargs.get("deployment_id", "unknown")
            state         = args[1] if len(args) > 1 else kwargs.get("state", {})
            inventory     = args[2] if len(args) > 2 else kwargs.get("inventory", {})
            dry_run       = args[3] if len(args) > 3 else kwargs.get("dry_run", True)
            configs       = args[4] if len(args) > 4 else kwargs.get("configs", {})
            self.delay(deployment_id, state, inventory, dry_run, configs)

    run_deployment = _SyncDeployStub()
