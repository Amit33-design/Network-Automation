"""
NetDesign AI — Authentication & RBAC
======================================
Supports three auth paths:
  1. Local username/password  → JWT (dev/lab)
  2. OIDC/SSO (Okta, Azure AD, Google, Ping) → JWT
  3. API key (Bearer nd-key-...) → JWT-equivalent claims

MFA:
  TOTP is enforced per-user when totp_enabled=True in UserProfile.
  /api/auth/token returns mfa_required=True → client calls /api/auth/totp-verify.

RBAC:
  Four system roles: viewer / designer / operator / admin
  Per-org role stored in OrgMember overrides the JWT default.

Org-scoping:
  JWT includes org_id claim. All data queries are filtered by org_id.
  Admins can switch org context via /api/auth/switch-org.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
_SECRET           = os.environ.get("JWT_SECRET", "")
_ALGORITHM        = "HS256"
_DEFAULT_EXPIRY_H = int(os.environ.get("JWT_EXPIRY_HOURS", "8"))
_MFA_EXPIRY_MIN   = 5   # short-lived pre-MFA token

# OIDC provider config (one active provider supported; extend to multi in Phase 3)
_OIDC_ISSUER       = os.environ.get("OIDC_ISSUER", "")        # e.g. https://login.microsoftonline.com/<tenant>/v2.0
_OIDC_CLIENT_ID    = os.environ.get("OIDC_CLIENT_ID", "")
_OIDC_CLIENT_SECRET= os.environ.get("OIDC_CLIENT_SECRET", "")
_OIDC_PROVIDER     = os.environ.get("OIDC_PROVIDER", "")      # okta|azure|google|ping
_OIDC_REDIRECT_URI = os.environ.get("OIDC_REDIRECT_URI", "")

# SIEM webhook — POST audit events in addition to DB write (optional)
_SIEM_WEBHOOK_URL  = os.environ.get("SIEM_WEBHOOK_URL", "")   # e.g. Splunk HEC, Elastic

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
    Role.VIEWER:   {"designs:read", "deployments:read", "audit:read"},
    Role.DESIGNER: {"designs:read", "designs:write", "configs:generate", "deployments:read"},
    Role.OPERATOR: {
        "designs:read", "designs:write", "configs:generate",
        "deployments:read", "deploy:lab", "deploy:staging",
        "approvals:read",
    },
    Role.ADMIN: {"*"},
}

# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def create_token(
    user_id: str,
    role: Role,
    *,
    org_id: str | None = None,
    expires_hours: int = _DEFAULT_EXPIRY_H,
    mfa_pending: bool = False,    # short-lived pre-MFA token
    extra_claims: dict[str, Any] | None = None,
) -> str:
    try:
        import jwt
    except ImportError:
        raise RuntimeError("PyJWT not installed — pip install pyjwt")

    if not _SECRET:
        raise RuntimeError("JWT_SECRET must be set to create tokens")

    exp_delta = timedelta(minutes=_MFA_EXPIRY_MIN) if mfa_pending else timedelta(hours=expires_hours)

    payload: dict[str, Any] = {
        "sub":         user_id,
        "role":        role.value,
        "exp":         datetime.now(timezone.utc) + exp_delta,
        "iat":         datetime.now(timezone.utc),
        "mfa_pending": mfa_pending,
    }
    if org_id:
        payload["org_id"] = org_id
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, _SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    try:
        import jwt
        payload = jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        return payload
    except Exception:
        import jwt as _jwt
        try:
            _jwt.decode(token, _SECRET, algorithms=[_ALGORITHM])
        except _jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token expired — please log in again",
                headers={"WWW-Authenticate": "Bearer"},
            )
        except _jwt.InvalidTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid token: {exc}",
                headers={"WWW-Authenticate": "Bearer"},
            )
        raise


def _has_permission(role: Role, permission: str) -> bool:
    allowed = ROLE_PERMISSIONS.get(role, set())
    return "*" in allowed or permission in allowed


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

_bearer = HTTPBearer(auto_error=False)


def require_permission(permission: str):
    """
    FastAPI dependency — validates Bearer JWT or nd-key-... API key
    and checks the caller has the requested permission.

    Dev mode (JWT_SECRET unset): all requests pass as synthetic admin.
    """
    def _dep(
        request: Request,
        creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    ) -> dict[str, Any]:
        # ── Dev mode ─────────────────────────────────────────────────────────
        if not _SECRET:
            return {"sub": "dev-user", "role": Role.ADMIN.value, "org_id": None, "dev_mode": True}

        # ── API key (nd-key-...) ──────────────────────────────────────────────
        raw = creds.credentials if creds else ""
        if raw.startswith("nd-key-"):
            return _validate_api_key(raw, permission)

        # ── Bearer JWT ────────────────────────────────────────────────────────
        if not creds:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )

        payload = decode_token(raw)

        # Reject pre-MFA tokens for real endpoints
        if payload.get("mfa_pending"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="MFA verification required — call POST /api/auth/totp-verify",
            )

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


def _validate_api_key(raw_key: str, permission: str) -> dict[str, Any]:
    """
    Validate an API key (nd-key-<random>).
    Looks up the SHA-256 hash in UserProfile.api_key_hash.
    Returns synthetic JWT-like claims on success.
    """
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    # DB lookup is done synchronously here via a sync session for simplicity.
    # In a high-throughput path, cache the result in Redis.
    try:
        from sqlalchemy import create_engine, select
        from sqlalchemy.orm import Session as SyncSession

        db_url = os.environ.get("DATABASE_URL", "").replace("+asyncpg", "")
        if not db_url:
            raise ValueError("no DB")

        engine = create_engine(db_url, pool_pre_ping=True)
        from models import UserProfile
        with SyncSession(engine) as s:
            profile = s.execute(
                select(UserProfile).where(UserProfile.api_key_hash == key_hash)
            ).scalar_one_or_none()
        engine.dispose()

        if not profile or not profile.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")

        # API keys are always designer-level unless user is admin
        return {"sub": profile.user_id, "role": Role.DESIGNER.value, "org_id": None, "api_key": True}

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


def generate_api_key() -> tuple[str, str]:
    """
    Generate a new API key.
    Returns (raw_key, sha256_hash) — store only the hash in DB.
    """
    raw = "nd-key-" + secrets.token_urlsafe(32)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


# ---------------------------------------------------------------------------
# OIDC / SSO helpers
# ---------------------------------------------------------------------------

def get_oidc_login_url(state: str) -> str:
    """
    Build the OIDC authorization URL for the configured provider.
    The frontend redirects the user here to begin SSO login.
    """
    if not _OIDC_ISSUER:
        raise HTTPException(status_code=501, detail="OIDC not configured — set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET")

    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id":     _OIDC_CLIENT_ID,
        "redirect_uri":  _OIDC_REDIRECT_URI,
        "scope":         "openid email profile",
        "state":         state,
    }
    # Azure AD uses /oauth2/v2.0/authorize; Okta and Google use /authorize
    if _OIDC_PROVIDER == "azure":
        auth_endpoint = f"{_OIDC_ISSUER}/oauth2/v2.0/authorize"
    else:
        auth_endpoint = f"{_OIDC_ISSUER}/oauth2/v1/authorize" if _OIDC_PROVIDER == "okta" else f"{_OIDC_ISSUER}/o/oauth2/v2/auth"

    return f"{auth_endpoint}?{urlencode(params)}"


async def exchange_oidc_code(code: str) -> dict[str, Any]:
    """
    Exchange an authorization code for tokens and return the ID token claims.
    """
    if not _OIDC_ISSUER:
        raise HTTPException(status_code=501, detail="OIDC not configured")

    import httpx
    if _OIDC_PROVIDER == "azure":
        token_url = f"{_OIDC_ISSUER}/oauth2/v2.0/token"
    elif _OIDC_PROVIDER == "okta":
        token_url = f"{_OIDC_ISSUER}/oauth2/v1/token"
    else:
        token_url = "https://oauth2.googleapis.com/token"

    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data={
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  _OIDC_REDIRECT_URI,
            "client_id":     _OIDC_CLIENT_ID,
            "client_secret": _OIDC_CLIENT_SECRET,
        })

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail=f"OIDC token exchange failed: {resp.text[:200]}")

    tokens = resp.json()
    id_token = tokens.get("id_token", "")

    # Decode (verify signature in prod via JWKS — simplified here)
    try:
        import jwt as _jwt
        claims = _jwt.decode(id_token, options={"verify_signature": False})
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Cannot decode OIDC id_token: {exc}")

    return claims   # contains sub, email, name, etc.


# ---------------------------------------------------------------------------
# TOTP helpers
# ---------------------------------------------------------------------------

def generate_totp_secret() -> str:
    """Return a new base32 TOTP secret."""
    try:
        import pyotp
        return pyotp.random_base32()
    except ImportError:
        raise HTTPException(status_code=501, detail="pyotp not installed — pip install pyotp")


def get_totp_uri(secret: str, user_email: str) -> str:
    """Return an otpauth:// URI for QR code generation."""
    try:
        import pyotp
        totp = pyotp.TOTP(secret)
        return totp.provisioning_uri(name=user_email, issuer_name="NetDesign AI")
    except ImportError:
        raise HTTPException(status_code=501, detail="pyotp not installed")


def verify_totp(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code. Allows ±30-second window."""
    try:
        import pyotp
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Password hashing (bcrypt via passlib)
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    try:
        from passlib.context import CryptContext
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        return ctx.hash(plain)
    except ImportError:
        # Fallback: SHA-256 (dev only — install passlib in prod)
        import hashlib
        log.warning("passlib not installed — using weak SHA-256 hashing (dev only)")
        return hashlib.sha256(plain.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        from passlib.context import CryptContext
        ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
        return ctx.verify(plain, hashed)
    except ImportError:
        import hashlib
        return hashlib.sha256(plain.encode()).hexdigest() == hashed
