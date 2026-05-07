"""Initial schema — designs, deployments, devices, audit_log

Revision ID: 0001
Revises:
Create Date: 2026-05-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── designs ────────────────────────────────────────────────────────────────
    op.create_table(
        "designs",
        sa.Column("id",         sa.String, primary_key=True),
        sa.Column("name",       sa.String, nullable=False),
        sa.Column("owner_id",   sa.String, nullable=False, index=True),
        sa.Column("use_case",   sa.String, nullable=False),
        sa.Column("state",      JSONB,     nullable=False, server_default="{}"),
        sa.Column("ip_plan",    JSONB,     nullable=True),
        sa.Column("vlan_plan",  JSONB,     nullable=True),
        sa.Column("bgp_design", JSONB,     nullable=True),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), onupdate=sa.text("NOW()"),
                  nullable=False),
    )
    op.create_index("ix_designs_owner_use_case", "designs", ["owner_id", "use_case"])

    # ── deployments ────────────────────────────────────────────────────────────
    op.create_table(
        "deployments",
        sa.Column("id",                  sa.String, primary_key=True),
        sa.Column("design_id",           sa.String,
                  sa.ForeignKey("designs.id"), nullable=False, index=True),
        sa.Column("environment",         sa.String, nullable=False),
        sa.Column("triggered_by",        sa.String, nullable=False, index=True),
        sa.Column("status",              sa.String, nullable=False, server_default="pending"),
        sa.Column("config_snapshot",     JSONB,     nullable=False, server_default="{}"),
        sa.Column("pre_check_results",   JSONB,     nullable=True),
        sa.Column("post_check_results",  JSONB,     nullable=True),
        sa.Column("confidence_score",    sa.Float,  nullable=True),
        sa.Column("started_at",          sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at",        sa.DateTime(timezone=True), nullable=True),
    )

    # ── devices ────────────────────────────────────────────────────────────────
    op.create_table(
        "devices",
        sa.Column("id",        sa.String, primary_key=True),
        sa.Column("hostname",  sa.String, nullable=False, unique=True),
        sa.Column("mgmt_ip",   sa.String, nullable=False),
        sa.Column("platform",  sa.String, nullable=False),
        sa.Column("vendor",    sa.String, nullable=False),
        sa.Column("model",     sa.String, nullable=False, server_default=""),
        sa.Column("role",      sa.String, nullable=False),
        sa.Column("site",      sa.String, nullable=False, server_default="default"),
        sa.Column("design_id", sa.String,
                  sa.ForeignKey("designs.id"), nullable=True),
        sa.Column("ztp_state", sa.String, nullable=False, server_default="unprovisioned"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_devices_site_role", "devices", ["site", "role"])

    # ── audit_log ──────────────────────────────────────────────────────────────
    op.create_table(
        "audit_log",
        sa.Column("id",            sa.String, primary_key=True),
        sa.Column("timestamp",     sa.DateTime(timezone=True),
                  server_default=sa.text("NOW()"), nullable=False),
        sa.Column("user_id",       sa.String, nullable=False, index=True),
        sa.Column("action",        sa.String, nullable=False),
        sa.Column("resource_id",   sa.String, nullable=False),
        sa.Column("resource_type", sa.String, nullable=False),
        sa.Column("outcome",       sa.String, nullable=False),
        sa.Column("detail",        JSONB,     nullable=False, server_default="{}"),
    )
    op.create_index("ix_audit_log_timestamp", "audit_log", ["timestamp"])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("devices")
    op.drop_table("deployments")
    op.drop_table("designs")
