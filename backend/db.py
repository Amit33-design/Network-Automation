"""
NetDesign AI — Async Database Session Factory
===============================================
Provides a FastAPI dependency `get_db()` that yields an AsyncSession.

When DATABASE_URL is not set, all DB-dependent endpoints return a 503
with a clear "database not configured" message — the rest of the app
(config gen, MCP tools, ZTP) keeps working without a database.

Usage in endpoints:
    from db import get_db
    from sqlalchemy.ext.asyncio import AsyncSession

    @app.get("/api/designs")
    async def list_designs(db: AsyncSession = Depends(get_db)):
        ...

Alembic target_metadata is also exported here for env.py:
    from db import Base
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator
from typing import Any

log = logging.getLogger("netdesign.db")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ---------------------------------------------------------------------------
# Engine + session factory (only created when DATABASE_URL is set)
# ---------------------------------------------------------------------------
try:
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )
    from models import Base  # re-exported for Alembic env.py

    if DATABASE_URL:
        _engine = create_async_engine(
            DATABASE_URL,
            echo=False,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,   # detect stale connections
        )
        _SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
            _engine,
            expire_on_commit=False,
            autoflush=False,
        )
        log.info("Database engine created: %s", DATABASE_URL.split("@")[-1])
    else:
        _engine = None
        _SessionLocal = None
        log.info("DATABASE_URL not set — running without persistence (in-memory/localStorage mode)")

    SQLALCHEMY_AVAILABLE = True

except ImportError:
    SQLALCHEMY_AVAILABLE = False
    _engine = None
    _SessionLocal = None
    log.warning("SQLAlchemy[asyncio] not installed — database features disabled")


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
from fastapi import HTTPException


async def get_db() -> "AsyncGenerator[AsyncSession, None]":
    """
    Yield an AsyncSession for the request lifetime.
    Raises HTTP 503 if the database is not configured.
    """
    if not SQLALCHEMY_AVAILABLE or _SessionLocal is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "Database not configured. "
                "Set DATABASE_URL=postgresql+asyncpg://... to enable persistence."
            ),
        )
    async with _SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def create_all_tables() -> None:
    """Create all tables from ORM metadata (dev/test only — use Alembic in prod)."""
    if _engine is None:
        return
    from models import Base as _Base
    async with _engine.begin() as conn:
        await conn.run_sync(_Base.metadata.create_all)
    log.info("All tables created (dev mode)")


async def dispose_engine() -> None:
    """Close all DB connections — call on app shutdown."""
    if _engine is not None:
        await _engine.dispose()
        log.info("Database engine disposed")
