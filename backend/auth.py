"""
NetDesign AI — Authentication & RBAC
======================================
JWT-based auth with four roles:
  viewer   → read designs, view deployments
  designer → create/edit designs, generate configs
  operator → deploy to lab/staging
  admin    → deploy to prod, manage users

Usage in FastAPI endpoints:
    from auth import require_permission

    @app.post("/api/deploy")
    def deploy(user=Depends(require_permission("deploy:staging"))):
        ...

Dev mode: if JWT_SECRET is unset, all requests are allowed (prints a warning).
Set JWT_SECRET in environment to enforce authentication.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# JWT config — read from environment
# ---------------------------------------------------------------------------
_SECRET = os.environ.get("JWT_SECRET", "")
_ALGORITHM = "HS256"
_DEFAULT_EXPIRY_HOURS = 8

if not _SECRET:
    log.warning(
        "JWT_SECRET not set — running in OPEN (unauthenticated) dev mode. "
        "Set JWT_SECRET to enforce authentication."
    )

# ---------------------------------------------------------------------------
# Role definitions
# ---------------------------------------------------------------------------

class Role(str, Enum):
    VIEWER   = "viewer"
    DESIGNER = "designer"
    OPERATOR = "operator"
    ADMIN    = "admin"


ROLE_PERMISSIONS: dict[Role, set[str]] = {
    Role.VIEWER:   {"designs:read", "deployments:read"},
    Role.DESIGNER: {"designs:read", "designs:write", "configs:generate"},
    Role.OPERATOR: {
        "designs:read", "designs:write", "configs:generate",
        "deploy:lab", "deploy:staging",
    },
    Role.ADMIN: {"*"},
}

# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def create_token(
    user_id: str,
    role: Role,
    expires_hours: int = _DEFAULT_EXPIRY_HOURS,
) -> str:
    """Encode a signed JWT with user_id, role, and expiry."""
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed — pip install pyjwt")

    if not _SECRET:
        raise RuntimeError("JWT_SECRET must be set to create tokens")

    payload: dict[str, Any] = {
        "sub":  user_id,
        "role": role.value,
        "exp":  datetime.now(timezone.utc) + timedelta(hours=expires_hours),
        "iat":  datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        import jwt
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        return payload
    except Exception:
        # Import errors are a coding bug, not an auth error — let them propagate
        import jwt as _jwt  # noqa: F401 — ensure it's importable
        try:
            _jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        except _jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except _jwt.InvalidTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            )
        raise  # unexpected


def _has_permission(role: Role, permission: str) -> bool:
    allowed = ROLE_PERMISSIONS.get(role, set())
    return "*" in allowed or permission in allowed


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

_bearer = HTTPBearer(auto_error=False)


def require_permission(permission: str):
    """
    Returns a FastAPI dependency that validates the Bearer JWT and checks
    that the caller's role has the requested permission.

    In dev mode (JWT_SECRET unset), all requests pass through with a
    synthetic admin payload so existing tooling keeps working.
    """
    def _dep(
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> dict[str, Any]:
        # ── Dev mode (no secret configured) ─────────────────────────────────
        if not _SECRET:
            return {"sub": "dev-user", "role": Role.ADMIN.value, "dev_mode": True}

        # ── Enforce Bearer token ─────────────────────────────────────────────
        if not creds:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )

        payload = decode_token(creds.credentials)

        try:
            role = Role(payload["role"])
        except (KeyError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Unknown role in token: {payload.get('role')}",
            )

        if not _has_permission(role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' does not have permission: {permission}",
            )

        return payload

    return _dep
