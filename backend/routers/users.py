"""
NetDesign AI — User Profile, Auth & MFA Router
================================================
Endpoints:
  POST /api/auth/token           — local login (username/password [+ TOTP])
  POST /api/auth/totp-verify     — complete MFA step after pre-MFA token
  GET  /api/auth/oidc/login      — start OIDC SSO flow (redirect URL)
  GET  /api/auth/oidc/callback   — OIDC authorization-code callback
  POST /api/auth/switch-org      — swap active org in token
  POST /api/auth/logout          — (client-side; logged server-side)

  GET  /api/users/me             — own profile
  PATCH /api/users/me            — update display name / password
  POST /api/users/me/totp/setup  — generate TOTP secret + QR URI
  POST /api/users/me/totp/enable — verify code → enable TOTP
  DELETE /api/users/me/totp      — disable TOTP (requires password)
  POST /api/users/me/api-keys    — generate new API key (returns raw key once)
  DELETE /api/users/me/api-keys  — revoke API key

  GET  /api/users               — list users in caller's org (admin)
  GET  /api/users/{uid}         — get user profile (admin)
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    Role, create_token, generate_api_key,
    generate_totp_secret, get_totp_uri, verify_totp,
    hash_password, verify_password,
    get_oidc_login_url, exchange_oidc_code,
    require_permission,
)
from audit import record_login, record
from db import get_db
from models import (
    UserProfile, OrgMember, Org,
    TokenRequest, TokenResponse,
    TOTPSetupResponse, TOTPVerifyRequest, UserProfileRead,
)

router = APIRouter(tags=["auth", "users"])

# ---------------------------------------------------------------------------
# Local login
# ---------------------------------------------------------------------------

@router.post("/api/auth/token", response_model=TokenResponse)
async def login(
    body: TokenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else ""

    row = await db.execute(
        select(UserProfile).where(UserProfile.email == body.username)
    )
    profile = row.scalar_one_or_none()

    if not profile or not profile.hashed_password:
        await record_login("unknown", "failed", ip_address=ip, method="local")
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(body.password, profile.hashed_password):
        await record_login(profile.user_id, "failed", ip_address=ip, method="local")
        raise HTTPException(401, "Invalid credentials")

    if not profile.is_active:
        raise HTTPException(403, "Account disabled — contact your admin")

    # Resolve primary org (first active membership)
    org_row = await db.execute(
        select(OrgMember).where(OrgMember.user_id == profile.user_id, OrgMember.is_active == True)
    )
    membership = org_row.scalars().first()
    org_id    = membership.org_id  if membership else None
    org_role  = membership.org_role if membership else "viewer"

    # If TOTP is enabled, return a short-lived pre-MFA token
    if profile.totp_enabled:
        if not body.totp_code:
            pre_token = create_token(profile.user_id, Role(org_role), org_id=org_id, mfa_pending=True)
            await record_login(profile.user_id, "mfa_required", ip_address=ip, method="local")
            return TokenResponse(
                access_token=pre_token, role=org_role, org_id=org_id, mfa_required=True
            )
        if not verify_totp(profile.totp_secret or "", body.totp_code):
            await record_login(profile.user_id, "failed_totp", ip_address=ip, method="local")
            raise HTTPException(401, "Invalid TOTP code")

    profile.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    token = create_token(profile.user_id, Role(org_role), org_id=org_id)
    await record_login(profile.user_id, "success", ip_address=ip, method="local", org_id=org_id)

    return TokenResponse(access_token=token, role=org_role, org_id=org_id)


# ---------------------------------------------------------------------------
# TOTP MFA verify (second step)
# ---------------------------------------------------------------------------

class TOTPVerifyBody(BaseModel):
    code: str

@router.post("/api/auth/totp-verify", response_model=TokenResponse)
async def totp_verify(
    body: TOTPVerifyBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),   # accepts pre-MFA token
):
    if not payload.get("mfa_pending"):
        raise HTTPException(400, "Token is not in MFA-pending state")

    profile = await db.get(UserProfile, payload["sub"])
    if not profile or not profile.totp_secret:
        raise HTTPException(400, "TOTP not configured for this account")

    if not verify_totp(profile.totp_secret, body.code):
        await record_login(profile.user_id, "failed_totp",
                           ip_address=request.client.host if request.client else "")
        raise HTTPException(401, "Invalid TOTP code")

    profile.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    org_id   = payload.get("org_id")
    org_role = payload.get("role", "designer")
    token    = create_token(profile.user_id, Role(org_role), org_id=org_id, mfa_pending=False)

    await record_login(profile.user_id, "success", method="totp", org_id=org_id)
    return TokenResponse(access_token=token, role=org_role, org_id=org_id)


# ---------------------------------------------------------------------------
# OIDC SSO
# ---------------------------------------------------------------------------

_oidc_states: dict[str, str] = {}   # state → redirect_uri (in-process; use Redis in HA)

@router.get("/api/auth/oidc/login")
async def oidc_login(redirect_after: str = "/"):
    state = secrets.token_urlsafe(16)
    _oidc_states[state] = redirect_after
    try:
        url = get_oidc_login_url(state)
    except HTTPException:
        raise
    return {"authorization_url": url, "state": state}


@router.get("/api/auth/oidc/callback")
async def oidc_callback(
    code: str,
    state: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = request.client.host if request.client else ""

    if state not in _oidc_states:
        raise HTTPException(400, "Invalid or expired OIDC state — restart login")
    redirect_after = _oidc_states.pop(state)

    claims = await exchange_oidc_code(code)
    email  = claims.get("email", "")
    sub    = claims.get("sub", "")
    name   = claims.get("name", "") or claims.get("given_name", "")

    if not email:
        raise HTTPException(400, "OIDC provider did not return an email address")

    # Upsert user profile
    row = await db.execute(select(UserProfile).where(UserProfile.email == email))
    profile = row.scalar_one_or_none()

    if not profile:
        import uuid
        profile = UserProfile(
            user_id=str(uuid.uuid4()),
            email=email,
            display_name=name,
            sso_subject=sub,
            sso_provider=__import__("os").environ.get("OIDC_PROVIDER", "oidc"),
        )
        db.add(profile)

        # Auto-join org if SSO domain matches
        domain = email.split("@")[-1] if "@" in email else ""
        if domain:
            org_row = await db.execute(select(Org).where(Org.sso_domain == domain, Org.is_active == True))
            org = org_row.scalar_one_or_none()
            if org:
                db.add(OrgMember(org_id=org.id, user_id=profile.user_id, org_role="designer"))
    else:
        profile.sso_subject  = sub
        profile.last_login_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(profile)

    # Resolve org
    org_row = await db.execute(
        select(OrgMember).where(OrgMember.user_id == profile.user_id, OrgMember.is_active == True)
    )
    membership = org_row.scalars().first()
    org_id     = membership.org_id  if membership else None
    org_role   = membership.org_role if membership else "viewer"

    token = create_token(profile.user_id, Role(org_role), org_id=org_id)
    await record_login(profile.user_id, "success", ip_address=ip, method="oidc", org_id=org_id)

    # Redirect back to UI with token in fragment
    return RedirectResponse(f"{redirect_after}#token={token}&role={org_role}")


# ---------------------------------------------------------------------------
# Switch active org
# ---------------------------------------------------------------------------

class SwitchOrgBody(BaseModel):
    org_id: str

@router.post("/api/auth/switch-org", response_model=TokenResponse)
async def switch_org(
    body: SwitchOrgBody,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    user_id = payload["sub"]
    row = await db.execute(
        select(OrgMember).where(
            OrgMember.user_id == user_id,
            OrgMember.org_id  == body.org_id,
            OrgMember.is_active == True,
        )
    )
    member = row.scalar_one_or_none()
    if not member:
        raise HTTPException(403, "Not a member of that org")

    token = create_token(user_id, Role(member.org_role), org_id=body.org_id)
    return TokenResponse(access_token=token, role=member.org_role, org_id=body.org_id)


# ---------------------------------------------------------------------------
# Own profile
# ---------------------------------------------------------------------------

@router.get("/api/users/me", response_model=UserProfileRead)
async def get_me(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")
    return profile


class ProfileUpdate(BaseModel):
    display_name:    str | None = None
    current_password: str | None = None
    new_password:    str | None = None

@router.patch("/api/users/me", response_model=UserProfileRead)
async def update_me(
    body: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")

    if body.display_name is not None:
        profile.display_name = body.display_name

    if body.new_password:
        if not body.current_password:
            raise HTTPException(400, "current_password required to set new password")
        if profile.hashed_password and not verify_password(body.current_password, profile.hashed_password):
            raise HTTPException(403, "Current password is incorrect")
        profile.hashed_password = hash_password(body.new_password)

    await db.commit()
    await db.refresh(profile)
    return profile


# ---------------------------------------------------------------------------
# TOTP setup / enable / disable
# ---------------------------------------------------------------------------

@router.post("/api/users/me/totp/setup", response_model=TOTPSetupResponse)
async def totp_setup(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")
    if profile.totp_enabled:
        raise HTTPException(409, "TOTP already enabled — disable it first")

    secret = generate_totp_secret()
    uri    = get_totp_uri(secret, profile.email)
    profile.totp_secret = secret   # stored but NOT enabled until /totp/enable
    await db.commit()
    return TOTPSetupResponse(secret=secret, otpauth_url=uri)


@router.post("/api/users/me/totp/enable")
async def totp_enable(
    body: TOTPVerifyRequest,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile or not profile.totp_secret:
        raise HTTPException(400, "Run /totp/setup first")
    if not verify_totp(profile.totp_secret, body.code):
        raise HTTPException(401, "TOTP code is invalid — check your authenticator app")

    profile.totp_enabled = True
    await db.commit()

    await record(payload["sub"], "auth.totp_enable", payload["sub"], "user", "success",
                 org_id=payload.get("org_id"))
    return {"message": "TOTP enabled successfully"}


class DisableTOTPBody(BaseModel):
    password: str

@router.delete("/api/users/me/totp")
async def totp_disable(
    body: DisableTOTPBody,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")
    if not profile.totp_enabled:
        raise HTTPException(400, "TOTP is not enabled")
    if profile.hashed_password and not verify_password(body.password, profile.hashed_password):
        raise HTTPException(403, "Password is incorrect")

    profile.totp_enabled = False
    profile.totp_secret  = None
    await db.commit()

    await record(payload["sub"], "auth.totp_disable", payload["sub"], "user", "success",
                 org_id=payload.get("org_id"))
    return {"message": "TOTP disabled"}


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------

@router.post("/api/users/me/api-keys")
async def create_api_key(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")

    raw_key, key_hash = generate_api_key()
    profile.api_key_hash = key_hash
    await db.commit()

    await record(payload["sub"], "auth.api_key_create", payload["sub"], "user", "success",
                 org_id=payload.get("org_id"))

    return {
        "api_key": raw_key,
        "note": "Store this key securely — it is shown only once and cannot be retrieved."
    }


@router.delete("/api/users/me/api-keys", status_code=204)
async def revoke_api_key(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("designs:read")),
):
    profile = await db.get(UserProfile, payload["sub"])
    if not profile:
        raise HTTPException(404, "Profile not found")

    profile.api_key_hash = None
    await db.commit()

    await record(payload["sub"], "auth.api_key_revoke", payload["sub"], "user", "success",
                 org_id=payload.get("org_id"))
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — list / get users in org
# ---------------------------------------------------------------------------

@router.get("/api/users", response_model=list[UserProfileRead])
async def list_users(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    org_id = payload.get("org_id")
    if not org_id:
        raise HTTPException(400, "org_id missing from token — switch org first")

    rows = await db.execute(
        select(UserProfile)
        .join(OrgMember, OrgMember.user_id == UserProfile.user_id)
        .where(OrgMember.org_id == org_id, OrgMember.is_active == True)
        .order_by(UserProfile.email)
    )
    return rows.scalars().all()


@router.get("/api/users/{uid}", response_model=UserProfileRead)
async def get_user(
    uid: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(require_permission("*")),
):
    profile = await db.get(UserProfile, uid)
    if not profile:
        raise HTTPException(404, "User not found")
    return profile
