"""
Tests for auth.py — JWT issuance, validation, and RBAC.
"""
import os
import pytest

# Force a known secret so tokens are deterministic in tests
os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")

from auth import Role, create_token, require_permission, ROLE_PERMISSIONS
from fastapi import HTTPException


# ── Token creation ────────────────────────────────────────────────────────────

class TestCreateToken:
    def test_returns_nonempty_string(self):
        token = create_token("alice", Role.ADMIN)
        assert isinstance(token, str) and len(token) > 20

    def test_different_roles_produce_different_tokens(self):
        t1 = create_token("alice", Role.VIEWER)
        t2 = create_token("alice", Role.ADMIN)
        assert t1 != t2

    def test_token_decodes_with_correct_claims(self):
        import jwt
        secret = os.environ["JWT_SECRET"]
        token  = create_token("bob", Role.DESIGNER)
        claims = jwt.decode(token, secret, algorithms=["HS256"])
        assert claims["sub"] == "bob"
        assert claims["role"] == Role.DESIGNER.value

    def test_token_has_expiry(self):
        import jwt
        secret = os.environ["JWT_SECRET"]
        token  = create_token("eve", Role.OPERATOR)
        claims = jwt.decode(token, secret, algorithms=["HS256"])
        assert "exp" in claims
        assert claims["exp"] > 0


# ── Role permissions ──────────────────────────────────────────────────────────

class TestRolePermissions:
    @pytest.mark.parametrize("role,perm,expected", [
        (Role.VIEWER,   "designs:read",   True),
        (Role.VIEWER,   "deploy:staging", False),
        (Role.DESIGNER, "configs:generate", True),
        (Role.DESIGNER, "deploy:staging",   False),
        (Role.OPERATOR, "deploy:staging",   True),
        (Role.OPERATOR, "deploy:prod",      False),
        (Role.ADMIN,    "deploy:prod",      True),
        (Role.ADMIN,    "designs:read",     True),
    ])
    def test_role_has_permission(self, role, perm, expected):
        perms = ROLE_PERMISSIONS[role]
        assert (perm in perms) is expected

    def test_admin_is_superset_of_operator(self):
        assert ROLE_PERMISSIONS[Role.OPERATOR].issubset(ROLE_PERMISSIONS[Role.ADMIN])

    def test_operator_is_superset_of_designer(self):
        assert ROLE_PERMISSIONS[Role.DESIGNER].issubset(ROLE_PERMISSIONS[Role.OPERATOR])


# ── require_permission dependency ─────────────────────────────────────────────

class TestRequirePermission:
    def _make_creds(self, token: str):
        """Build a fake HTTPAuthorizationCredentials."""
        from fastapi.security import HTTPAuthorizationCredentials
        return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    def test_valid_token_with_permission_passes(self):
        token = create_token("alice", Role.ADMIN)
        dep   = require_permission("deploy:prod")
        creds = self._make_creds(token)
        user  = dep(creds)
        assert user["sub"] == "alice"

    def test_valid_token_without_permission_raises_403(self):
        token = create_token("viewer", Role.VIEWER)
        dep   = require_permission("deploy:prod")
        creds = self._make_creds(token)
        with pytest.raises(HTTPException) as exc_info:
            dep(creds)
        assert exc_info.value.status_code == 403

    def test_invalid_token_raises_401(self):
        dep   = require_permission("designs:read")
        creds = self._make_creds("garbage.token.here")
        with pytest.raises(HTTPException) as exc_info:
            dep(creds)
        assert exc_info.value.status_code == 401

    def test_expired_token_raises_401(self):
        import jwt
        from datetime import datetime, timezone, timedelta
        secret = os.environ["JWT_SECRET"]
        payload = {
            "sub":  "alice",
            "role": Role.ADMIN.value,
            "iat":  datetime.now(timezone.utc) - timedelta(hours=10),
            "exp":  datetime.now(timezone.utc) - timedelta(hours=2),
        }
        expired_token = jwt.encode(payload, secret, algorithm="HS256")
        dep   = require_permission("designs:read")
        creds = self._make_creds(expired_token)
        with pytest.raises(HTTPException) as exc_info:
            dep(creds)
        assert exc_info.value.status_code == 401

    def test_dev_mode_allows_all_without_token(self):
        """When JWT_SECRET is unset all requests pass (dev mode)."""
        original = os.environ.pop("JWT_SECRET", None)
        try:
            # Reimport to pick up empty secret
            import importlib
            import auth as auth_mod
            importlib.reload(auth_mod)
            dep  = auth_mod.require_permission("deploy:prod")
            user = dep(None)  # No credentials needed in dev mode
            assert user is not None
        finally:
            if original:
                os.environ["JWT_SECRET"] = original
            import importlib, auth as auth_mod  # noqa: E401
            importlib.reload(auth_mod)
