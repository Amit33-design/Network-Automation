"""
NetDesign AI — Data Models
============================
SQLAlchemy 2.0 ORM models + Pydantic API schemas.

Tables:
  orgs            — organisations / tenants (multi-tenancy root)
  org_members     — user ↔ org membership with per-org role
  user_profiles   — extended user info (TOTP secret, API key, SSO subject)
  designs         — network design state + generated artifacts
  deployments     — deployment history with approval gate state
  devices         — device inventory with ZTP state
  approval_requests — human-in-the-loop change approval (Phase 1)
  integration_configs — per-org integration settings (Phase 2)
  audit_log       — immutable audit trail (append-only)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# SQLAlchemy ORM
# ---------------------------------------------------------------------------
try:
    from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.orm import (
        DeclarativeBase,
        Mapped,
        mapped_column,
        relationship,
    )

    class Base(DeclarativeBase):
        pass

    def _uuid() -> str:
        return str(uuid.uuid4())

    def _now() -> datetime:
        return datetime.utcnow()   # naive UTC — asyncpg TIMESTAMP columns require naive

    # ── Organisations (multi-tenancy root) ───────────────────────────────────

    class Org(Base):
        __tablename__ = "orgs"

        id:          Mapped[str]  = mapped_column(String, primary_key=True, default=_uuid)
        name:        Mapped[str]  = mapped_column(String, nullable=False)
        slug:        Mapped[str]  = mapped_column(String, unique=True, nullable=False)  # URL-safe identifier
        tier:        Mapped[str]  = mapped_column(String, default="professional")       # community|professional|enterprise
        sso_domain:  Mapped[str | None] = mapped_column(String, nullable=True)          # e.g. "acme.com" for OIDC auto-join
        created_at:  Mapped[datetime]   = mapped_column(default=_now)
        is_active:   Mapped[bool]       = mapped_column(Boolean, default=True)

        members: Mapped[list["OrgMember"]] = relationship(back_populates="org", cascade="all, delete-orphan")
        designs: Mapped[list["Design"]]    = relationship(back_populates="org")

    class OrgMember(Base):
        __tablename__ = "org_members"

        id:         Mapped[str]      = mapped_column(String, primary_key=True, default=_uuid)
        org_id:     Mapped[str]      = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
        user_id:    Mapped[str]      = mapped_column(String, nullable=False, index=True)
        org_role:   Mapped[str]      = mapped_column(String, default="designer")   # viewer|designer|operator|admin
        joined_at:  Mapped[datetime] = mapped_column(default=_now)
        invited_by: Mapped[str | None] = mapped_column(String, nullable=True)
        is_active:  Mapped[bool]     = mapped_column(Boolean, default=True)

        org: Mapped["Org"] = relationship(back_populates="members")

    # ── User profiles (one per user_id — cross-org) ──────────────────────────

    class UserProfile(Base):
        __tablename__ = "user_profiles"

        user_id:         Mapped[str]       = mapped_column(String, primary_key=True)
        email:           Mapped[str]       = mapped_column(String, unique=True, nullable=False, index=True)
        display_name:    Mapped[str]       = mapped_column(String, default="")
        hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)   # None = SSO-only user
        totp_secret:     Mapped[str | None] = mapped_column(String, nullable=True)   # base32 TOTP seed
        totp_enabled:    Mapped[bool]      = mapped_column(Boolean, default=False)
        sso_subject:     Mapped[str | None] = mapped_column(String, nullable=True)   # OIDC sub claim
        sso_provider:    Mapped[str | None] = mapped_column(String, nullable=True)   # okta|azure|google|ping
        api_key_hash:    Mapped[str | None] = mapped_column(String, nullable=True)   # SHA-256 of API key
        last_login_at:   Mapped[datetime | None] = mapped_column(nullable=True)
        created_at:      Mapped[datetime]  = mapped_column(default=_now)
        is_active:       Mapped[bool]      = mapped_column(Boolean, default=True)

    # ── Designs ──────────────────────────────────────────────────────────────

    class Design(Base):
        __tablename__ = "designs"

        id:           Mapped[str]      = mapped_column(String, primary_key=True, default=_uuid)
        org_id:       Mapped[str]      = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
        name:         Mapped[str]      = mapped_column(String, nullable=False)
        owner_id:     Mapped[str]      = mapped_column(String, nullable=False, index=True)
        use_case:     Mapped[str]      = mapped_column(String, nullable=False)
        state:        Mapped[dict]     = mapped_column(JSONB, nullable=False)
        ip_plan:      Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        vlan_plan:    Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        bgp_design:   Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        git_commit:   Mapped[str | None]   = mapped_column(String, nullable=True)   # last committed SHA
        created_at:   Mapped[datetime] = mapped_column(default=_now)
        updated_at:   Mapped[datetime] = mapped_column(default=_now, onupdate=_now)
        is_deleted:   Mapped[bool]     = mapped_column(Boolean, default=False)

        org:         Mapped["Org"]              = relationship(back_populates="designs")
        deployments: Mapped[list["Deployment"]] = relationship(back_populates="design")

    # ── Deployments ──────────────────────────────────────────────────────────

    class Deployment(Base):
        __tablename__ = "deployments"

        id:                Mapped[str]          = mapped_column(String, primary_key=True, default=_uuid)
        org_id:            Mapped[str]          = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
        design_id:         Mapped[str]          = mapped_column(ForeignKey("designs.id"), index=True)
        environment:       Mapped[str]          = mapped_column(String)   # lab | staging | prod
        triggered_by:      Mapped[str]          = mapped_column(String)   # user_id
        # Status lifecycle: pending_approval → approved/rejected → running → success/failed/rolled_back
        status:            Mapped[str]          = mapped_column(String, default="pending_approval")
        approval_id:       Mapped[str | None]   = mapped_column(ForeignKey("approval_requests.id"), nullable=True)
        config_snapshot:   Mapped[dict]         = mapped_column(JSONB)
        pre_check_results: Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        post_check_results:Mapped[dict | None]  = mapped_column(JSONB, nullable=True)
        confidence_score:  Mapped[float | None] = mapped_column(nullable=True)
        itsm_ticket_id:    Mapped[str | None]   = mapped_column(String, nullable=True)   # ServiceNow/Jira ref
        itsm_ticket_url:   Mapped[str | None]   = mapped_column(String, nullable=True)
        git_pr_url:        Mapped[str | None]   = mapped_column(String, nullable=True)   # GitOps PR link
        started_at:        Mapped[datetime | None] = mapped_column(nullable=True)
        completed_at:      Mapped[datetime | None] = mapped_column(nullable=True)

        design:   Mapped["Design"]              = relationship(back_populates="deployments")
        approval: Mapped["ApprovalRequest | None"] = relationship(back_populates="deployment", foreign_keys=[approval_id])

    # ── Approval Requests ─────────────────────────────────────────────────────

    class ApprovalRequest(Base):
        """Human-in-the-loop change approval — required before prod deploy."""
        __tablename__ = "approval_requests"

        id:            Mapped[str]       = mapped_column(String, primary_key=True, default=_uuid)
        org_id:        Mapped[str]       = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
        design_id:     Mapped[str]       = mapped_column(String, nullable=False)   # logical ref, no FK (design may be frontend-only)
        requested_by:  Mapped[str]       = mapped_column(String, nullable=False)   # user_id
        environment:   Mapped[str]       = mapped_column(String, nullable=False)   # target env
        status:        Mapped[str]       = mapped_column(String, default="pending") # pending|approved|rejected|expired
        # Approval outcome
        reviewed_by:   Mapped[str | None]   = mapped_column(String, nullable=True)
        reviewed_at:   Mapped[datetime | None] = mapped_column(nullable=True)
        reviewer_note: Mapped[str | None]   = mapped_column(Text, nullable=True)
        # Context for reviewers
        summary:       Mapped[str]       = mapped_column(Text, default="")    # auto-generated change summary
        risk_score:    Mapped[int]       = mapped_column(Integer, default=0)  # 0-100
        device_count:  Mapped[int]       = mapped_column(Integer, default=0)
        expires_at:    Mapped[datetime | None] = mapped_column(nullable=True) # auto-expire stale approvals
        # Integration refs
        itsm_ticket_id:  Mapped[str | None] = mapped_column(String, nullable=True)
        itsm_ticket_url: Mapped[str | None] = mapped_column(String, nullable=True)
        created_at:    Mapped[datetime]  = mapped_column(default=_now)

        deployment: Mapped["Deployment | None"] = relationship(
            back_populates="approval",
            foreign_keys="Deployment.approval_id",
        )

    # ── Integration Configs (per-org) ─────────────────────────────────────────

    class IntegrationConfig(Base):
        """Stores per-org integration settings (webhook URLs, API tokens, etc.)."""
        __tablename__ = "integration_configs"

        id:          Mapped[str]  = mapped_column(String, primary_key=True, default=_uuid)
        org_id:      Mapped[str]  = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True, unique=False)
        provider:    Mapped[str]  = mapped_column(String, nullable=False)  # slack|teams|servicenow|jira|netbox|gitops
        config:      Mapped[dict] = mapped_column(JSONB, nullable=False)   # provider-specific (encrypted in prod)
        enabled:     Mapped[bool] = mapped_column(Boolean, default=True)
        created_at:  Mapped[datetime] = mapped_column(default=_now)
        updated_at:  Mapped[datetime] = mapped_column(default=_now, onupdate=_now)

    # ── Devices ───────────────────────────────────────────────────────────────

    class Device(Base):
        __tablename__ = "devices"

        id:        Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
        org_id:    Mapped[str] = mapped_column(ForeignKey("orgs.id"), nullable=False, index=True)
        hostname:  Mapped[str] = mapped_column(String, nullable=False)
        mgmt_ip:   Mapped[str] = mapped_column(String, nullable=False)
        platform:  Mapped[str] = mapped_column(String)   # nxos|eos|ios_xe|junos|sonic
        vendor:    Mapped[str] = mapped_column(String)
        model:     Mapped[str] = mapped_column(String, default="")
        role:      Mapped[str] = mapped_column(String)   # spine|leaf|access|core|firewall
        site:      Mapped[str] = mapped_column(String, default="default")
        design_id: Mapped[str | None] = mapped_column(ForeignKey("designs.id"), nullable=True)
        ztp_state: Mapped[str] = mapped_column(String, default="unprovisioned")
        last_seen: Mapped[datetime | None] = mapped_column(nullable=True)

    # ── Audit Log ─────────────────────────────────────────────────────────────

    class AuditEvent(Base):
        __tablename__ = "audit_log"

        id:            Mapped[str]      = mapped_column(String, primary_key=True, default=_uuid)
        timestamp:     Mapped[datetime] = mapped_column(default=_now, index=True)
        org_id:        Mapped[str | None] = mapped_column(String, nullable=True, index=True)
        user_id:       Mapped[str]      = mapped_column(String, nullable=False, index=True)
        action:        Mapped[str]      = mapped_column(String, nullable=False)
        resource_id:   Mapped[str]      = mapped_column(String, nullable=False)
        resource_type: Mapped[str]      = mapped_column(String, nullable=False)
        outcome:       Mapped[str]      = mapped_column(String, nullable=False)
        ip_address:    Mapped[str | None] = mapped_column(String, nullable=True)
        detail:        Mapped[dict]     = mapped_column(JSONB, default=dict)

    ORM_AVAILABLE = True

except ImportError:
    ORM_AVAILABLE = False


# ---------------------------------------------------------------------------
# Pydantic API schemas
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field


# ── Org schemas ──────────────────────────────────────────────────────────────

class OrgCreate(BaseModel):
    name:       str
    slug:       str
    sso_domain: str | None = None

class OrgRead(BaseModel):
    id:         str
    name:       str
    slug:       str
    tier:       str
    sso_domain: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

class OrgMemberInvite(BaseModel):
    email:    str
    org_role: str = "designer"

class OrgMemberRead(BaseModel):
    user_id:   str
    org_role:  str
    joined_at: datetime
    is_active: bool
    model_config = {"from_attributes": True}


# ── User schemas ─────────────────────────────────────────────────────────────

class UserProfileRead(BaseModel):
    user_id:      str
    email:        str
    display_name: str
    totp_enabled: bool
    sso_provider: str | None
    last_login_at: datetime | None
    model_config = {"from_attributes": True}

class TOTPSetupResponse(BaseModel):
    secret:      str   # base32 seed to show in QR
    otpauth_url: str   # otpauth:// URI for QR code

class TOTPVerifyRequest(BaseModel):
    code: str          # 6-digit TOTP code


# ── Approval schemas ──────────────────────────────────────────────────────────

class ApprovalRequestCreate(BaseModel):
    design_id:   str
    environment: str = "prod"
    summary:     str = ""
    risk_score:  int = Field(default=0, ge=0, le=100)
    device_count: int = 0

class ApprovalRequestRead(BaseModel):
    id:            str
    design_id:     str
    requested_by:  str
    environment:   str
    status:        str
    risk_score:    int
    device_count:  int
    summary:       str
    reviewed_by:   str | None
    reviewed_at:   datetime | None
    reviewer_note: str | None
    itsm_ticket_url: str | None
    created_at:    datetime
    expires_at:    datetime | None
    model_config = {"from_attributes": True}

class ApprovalDecision(BaseModel):
    decision: str   # approved | rejected
    note:     str = ""


# ── Integration schemas ───────────────────────────────────────────────────────

class IntegrationConfigCreate(BaseModel):
    provider: str
    config:   dict[str, Any]   # provider-specific — values may be str, bool, int
    enabled:  bool = True

class IntegrationConfigRead(BaseModel):
    id:       str
    provider: str
    enabled:  bool
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Design schemas ────────────────────────────────────────────────────────────

class DesignCreate(BaseModel):
    name:     str
    use_case: str
    state:    dict[str, Any]
    org_id:   str | None = None   # resolved from JWT if omitted

class DesignRead(BaseModel):
    id:         str
    org_id:     str
    name:       str
    owner_id:   str
    use_case:   str
    git_commit: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Deployment schemas ────────────────────────────────────────────────────────

class DeploymentCreate(BaseModel):
    design_id:   str
    environment: str = "staging"
    dry_run:     bool = True

class DeploymentRead(BaseModel):
    id:              str
    org_id:          str
    design_id:       str
    environment:     str
    status:          str
    triggered_by:    str
    confidence_score: float | None
    itsm_ticket_url: str | None
    git_pr_url:      str | None
    started_at:      datetime | None
    completed_at:    datetime | None
    model_config = {"from_attributes": True}


# ── Device schemas ────────────────────────────────────────────────────────────

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
    org_id:    str
    ztp_state: str
    last_seen: datetime | None = None
    model_config = {"from_attributes": True}


# ── Auth schemas ──────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    username: str
    password: str
    totp_code: str | None = None   # required when TOTP is enabled

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int = Field(default=8 * 3600, description="Seconds until expiry")
    role:         str
    org_id:       str | None = None
    mfa_required: bool = False     # True = call /api/auth/totp-verify next


# ── Audit export schema ───────────────────────────────────────────────────────

class AuditEventRead(BaseModel):
    id:            str
    timestamp:     datetime
    org_id:        str | None
    user_id:       str
    action:        str
    resource_id:   str
    resource_type: str
    outcome:       str
    ip_address:    str | None
    detail:        dict
    model_config = {"from_attributes": True}
