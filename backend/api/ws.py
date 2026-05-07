"""
NetDesign AI — WebSocket Deployment Stream
==========================================
Subscribes to Redis pub/sub channel `deploy:{deployment_id}` and
forwards each JSON message to the connected WebSocket client.

The WebSocket is closed when a terminal stage is received:
  stage in {post_checks, error, rollback} AND status == "terminal"

Usage (wired into main.py):
    from api.ws import deployment_stream

    @app.websocket("/ws/deploy/{deployment_id}")
    async def ws_deploy(websocket: WebSocket, deployment_id: str):
        await deployment_stream(websocket, deployment_id)
"""

from __future__ import annotations

import json
import logging
import os

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "")

# Stages whose "terminal" status signals the end of the stream
_TERMINAL_STAGES = {"post_checks", "error", "rollback"}

# How long to wait (seconds) between Redis subscribe poll iterations
_POLL_TIMEOUT = 0.1  # 100 ms


async def deployment_stream(websocket: WebSocket, deployment_id: str) -> None:
    """
    Subscribe to Redis pub/sub and forward messages to the WebSocket.

    If Redis is not configured, send a single informational message and close.
    """
    await websocket.accept()

    if not REDIS_URL:
        await websocket.send_text(json.dumps({
            "deployment_id": deployment_id,
            "stage": "error",
            "status": "terminal",
            "detail": "Redis not configured — live streaming unavailable",
        }))
        await websocket.close()
        return

    try:
        import redis.asyncio as aioredis
    except ImportError:
        await websocket.send_text(json.dumps({
            "deployment_id": deployment_id,
            "stage": "error",
            "status": "terminal",
            "detail": "redis[hiredis] package not installed",
        }))
        await websocket.close()
        return

    channel = f"deploy:{deployment_id}"
    log.info("WS: client subscribed to %s", channel)

    r: aioredis.Redis | None = None
    pubsub = None

    try:
        r = aioredis.from_url(REDIS_URL, decode_responses=True)
        pubsub = r.pubsub()
        await pubsub.subscribe(channel)

        # Drain the subscribe-confirmation message
        await pubsub.get_message(timeout=_POLL_TIMEOUT)

        while True:
            try:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=_POLL_TIMEOUT,
                )
            except Exception as redis_exc:
                log.warning("WS: Redis read error for %s: %s", channel, redis_exc)
                break

            if message is None:
                # No message yet — send a keepalive ping so the browser
                # doesn't time out and yield control to the event loop.
                try:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except (WebSocketDisconnect, Exception):
                    log.info("WS: client disconnected from %s", channel)
                    break
                continue

            raw = message.get("data", "")
            if not raw:
                continue

            # Forward message verbatim to WebSocket
            try:
                await websocket.send_text(raw)
            except (WebSocketDisconnect, Exception):
                log.info("WS: client disconnected from %s during send", channel)
                break

            # Check for terminal stage
            try:
                payload = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                payload = {}

            stage  = payload.get("stage", "")
            status = payload.get("status", "")

            if stage in _TERMINAL_STAGES and status == "terminal":
                log.info("WS: terminal stage '%s' received for %s — closing", stage, channel)
                break

    except WebSocketDisconnect:
        log.info("WS: client disconnected from %s", channel)
    except Exception as exc:
        log.exception("WS: unexpected error for %s: %s", channel, exc)
        try:
            await websocket.send_text(json.dumps({
                "deployment_id": deployment_id,
                "stage": "error",
                "status": "terminal",
                "detail": f"WebSocket stream error: {exc}",
            }))
        except Exception:
            pass
    finally:
        if pubsub:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.close()
            except Exception:
                pass
        if r:
            try:
                await r.aclose()
            except Exception:
                pass
        try:
            await websocket.close()
        except Exception:
            pass
        log.info("WS: stream closed for %s", channel)
