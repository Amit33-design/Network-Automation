"""
NetDesign AI — Pinecone design similarity service

Provides:
  embed_design(design_id, intent, topology_params, use_case, vendor)
    → embeds via OpenAI text-embedding-3-small, upserts to Pinecone

  find_similar(intent, topology_params, use_case, vendor, top_k=3)
    → returns top-k similar designs from Pinecone with metadata

All calls are async-safe (uses httpx under the hood).
Pinecone free tier: 100K vectors — sufficient for ~100K saved designs.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

log = logging.getLogger("netdesign.pinecone")

OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX  = os.getenv("PINECONE_INDEX", "netdesign-designs")
PINECONE_HOST   = os.getenv("PINECONE_HOST", "")  # e.g. https://netdesign-designs-xxx.svc.pinecone.io

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM   = 1536
NAMESPACE   = "designs"
SIMILARITY_THRESHOLD = 0.75

_enabled = bool(OPENAI_API_KEY and PINECONE_API_KEY and PINECONE_HOST)
if not _enabled:
    log.warning("Pinecone/OpenAI env vars not set — similarity search disabled")


# ── embedding ────────────────────────────────────────────────────────────────

def _build_embed_text(
    intent:          dict[str, Any],
    topology_params: dict[str, Any],
    use_case:        str,
    vendor:          str,
) -> str:
    parts = []
    if use_case:        parts.append(f"use_case: {use_case}")
    if vendor:          parts.append(f"vendor: {vendor}")
    if intent:          parts.append(f"intent: {json.dumps(intent)[:400]}")
    if topology_params: parts.append(f"topology: {json.dumps(topology_params)[:400]}")
    return " | ".join(parts)


async def _get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": EMBED_MODEL, "input": text},
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]


# ── Pinecone API calls ───────────────────────────────────────────────────────

def _pinecone_headers() -> dict[str, str]:
    return {"Api-Key": PINECONE_API_KEY, "Content-Type": "application/json"}


async def embed_design(
    design_id:       str,
    intent:          dict[str, Any],
    topology_params: dict[str, Any],
    use_case:        str = "unknown",
    vendor:          str = "multi",
    design_name:     str = "",
    owner_id:        str = "",
    saved_at:        str = "",
) -> bool:
    """Embed a design and upsert to Pinecone. Returns True on success."""
    if not _enabled:
        return False
    try:
        text   = _build_embed_text(intent, topology_params, use_case, vendor)
        vector = await _get_embedding(text)

        intent_summary = ", ".join(
            f"{k}:{v}" for k, v in list(intent.items())[:5]
        ) if isinstance(intent, dict) else str(intent)[:200]

        payload = {
            "vectors": [{
                "id":     design_id,
                "values": vector,
                "metadata": {
                    "design_name":    design_name,
                    "use_case":       use_case,
                    "vendor":         vendor,
                    "owner_id":       owner_id,
                    "saved_at":       saved_at,
                    "intent_summary": intent_summary,
                },
            }],
            "namespace": NAMESPACE,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{PINECONE_HOST}/vectors/upsert",
                headers=_pinecone_headers(),
                json=payload,
            )
            resp.raise_for_status()
        log.info("Pinecone upsert OK: design=%s", design_id)
        return True
    except Exception as exc:
        log.error("Pinecone embed failed for design %s: %s", design_id, exc)
        return False


async def find_similar(
    intent:          dict[str, Any],
    topology_params: dict[str, Any] | None = None,
    use_case:        str = "",
    vendor:          str = "",
    top_k:           int = 3,
) -> list[dict[str, Any]]:
    """Return top-k similar designs from Pinecone (score > SIMILARITY_THRESHOLD)."""
    if not _enabled:
        return []
    try:
        text   = _build_embed_text(intent, topology_params or {}, use_case, vendor)
        vector = await _get_embedding(text)

        payload = {
            "vector":          vector,
            "topK":            top_k,
            "includeMetadata": True,
            "namespace":       NAMESPACE,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{PINECONE_HOST}/query",
                headers=_pinecone_headers(),
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        return [
            {
                "id":             m["id"],
                "design_name":    m["metadata"].get("design_name", "Unnamed"),
                "use_case":       m["metadata"].get("use_case", ""),
                "vendor":         m["metadata"].get("vendor", ""),
                "intent_summary": m["metadata"].get("intent_summary", ""),
                "score":          round(m["score"], 2),
                "saved_at":       m["metadata"].get("saved_at", ""),
            }
            for m in data.get("matches", [])
            if m["score"] >= SIMILARITY_THRESHOLD
        ]
    except Exception as exc:
        log.error("Pinecone similarity query failed: %s", exc)
        return []
