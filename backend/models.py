"""
NetDesign AI — Data Models
============================
SQLAlchemy 2.0 ORM models + Pydantic API schemas.
Phase 2 wires up the async DB session; these models are defined here as
groundwork so migrations can be generated ahead of the DB rollout.

Tables:
  designs       — network design state + generated artifacts
  deployments   — deployment history, status, pre/post check results
  devices       — device inventory with ZTP state
  audit_log     — immutable audit trail (append-only)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# SQLAlchemy ORM (imported lazily so the app starts without asyncpg installed)
# ---------------------------------------------------------------------------
try:
    from sqlalchemy import ForeignKey, String
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.orm import (
        DeclarativeBase,
        Mapped,
        MappedColumn,
        mapped_column,
        relationship,
    )

    class Base(DeclarativeBase):
        pass

    def _uuid() -> str:
        return str(uuid.uuid4())

    def _now() -> datetime:
        return datetime.now(timezone.utc)

    class Design(Base):
        __tablename__ = "designs"

        id:           Mapped[str]      = mapped_column(String, primary_key=True, default=_uuid)
        name:         Mapped[str]      = mapped_column(String, nullable=False)
        owner_id:     Mapped[str]      = mapped_column(String, nullable=False, index=True)
        use_case:     Mapped[str]      = mapped_column(String, nullable=False)
        state:        Mapped[dict]     = mapped_column(JSONB, nullable=False)
        ip_plan:      Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        vlan_plan:    Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        bgp_design:   Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        created_at:   Mapped[datetime] = mapped_column(default=_now)
        updated_at:   Mapped[datetime] = mapped_column(default=_now, onupdate=_now)
        is_deleted:   Mapped[bool]     = mapped_column(default=False)

        deployments: Mapped[list[Deployment]] = relationship(back_populates="design")

    class Deployment(Base):
        __tablename__ = "deployments"

        id:                   Mapped[str]          = mapped_column(String, primary_key=True, default=_uuid)
        design_id:            Mapped[str]          = mapped_column(ForeignKey("designs.id"), index=True)
        environment:          Mapped[str]          = mapped_column(String)  # lab | staging | prod
        triggered_by:         Mapped[str]          = mapped_column(String)  # user_id
        status:               Mapped[str]          = mapped_column(String, default="pending")
        config_snapshot:      Mapped[dict]         = mapped_column(JSONB)
        pre_check_results:    Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        post_check_results:   Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        confidence_score:     Mapped[float | None] = mapped_column(nullable=True)
        started_at:           Mapped[datetime | None] = mapped_column(nullable=True)
        completed_at:         Mapped[datetime | None] = mapped_column(nullable=True)

        design: Mapped[Design] = relationship(back_populates="deployments")

    class Device(Base):
        __tablename__ = "devices"

        id:        Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        hostname:  Mapped[str] = mapped_column(String, unique=True, nullable=False)
        mgmt_ip:   Mapped[str] = mapped_column(String, nullable=False)
        platform:  Mapped[str] = mapped_column(String)   # nxos | eos | ios_xe | junos | sonic
        vendor:    Mapped[str] = mapped_column(String)
        model:     Mapped[str] = mapped_column(String, default="")
        role:      Mapped[str] = mapped_column(String)   # spine | leaf | access | core | firewall
        site:      Mapped[str] = mapped_column(String, default="default")
        design_id: Mapped[str | None] = mapped_column(ForeignKey("designs.id"), nullable=True)
        ztp_state: Mapped[str] = mapped_column(String, default="unprovisioned")
        last_seen: Mapped[datetime | None] = mapped_column(nullable=True)

    class AuditEvent(Base):
        __tablename__ = "audit_log"

        id:            Mapped[str]      = mapped_column(String, primary_key=True, default=_uuid)
        timestamp:     Mapped[datetime] = mapped_column(default=_now)
        user_id:       Mapped[str]      = mapped_column(String, nullable=False, index=True)
        action:        Mapped[str]      = mapped_column(String, nullable=False)
        resource_id:   Mapped[str]      = mapped_column(String, nullable=False)
        resource_type: Mapped[str]      = mapped_column(String, nullable=False)
        outcome:       Mapped[str]      = mapped_column(String, nullable=False)
        detail:        Mapped[dict]     = mapped_column(JSONB, default=dict)

    ORM_AVAILABLE = True

except ImportError:
    ORM_AVAILABLE = False


# ---------------------------------------------------------------------------
# Pydantic API schemas (used by FastAPI endpoints — no DB dependency)
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field


class DesignCreate(BaseModel):
    name:     str
    use_case: str
    state:    dict[str, Any]


class DesignRead(BaseModel):
    id:         str
    name:       str
    owner_id:   str
    use_case:   str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeploymentCreate(BaseModel):
    design_id:   str
    environment: str = "staging"
    dry_run:     bool = True


class DeploymentRead(BaseModel):
    id:          str
    design_id:   str
    environment: str
    status:      str
    triggered_by: str
    started_at:  datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class DeviceCreate(BaseModel):
    hostname:  str
    mgmt_ip:   str
    platform:  str
    vendor:    str
    model:     str = ""
    role:      str
    site:      str = "default"
    design_id: str | None = None


class DeviceRead(DeviceCreate):
    id:        str
    ztp_state: str
    last_seen: datetime | None = None

    model_config = {"from_attributes": True}


class TokenRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int = Field(default=8 * 3600, description="Seconds until expiry")
    role:         str
