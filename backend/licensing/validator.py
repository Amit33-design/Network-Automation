"""
Offline license validator for NetDesign AI.

License key format:  nd.<base64url(payload_json)>.<base64url(signature)>

Payload JSON fields:
  license_id   str
  licensee     str
  tier         str  (community / professional / enterprise)
  machine_id   str  (fingerprint or "*" for floating)
  issued_at    str  (ISO-8601)
  expires_at   str | null
  max_devices  int
  features     list[str]
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from .fingerprint import get_machine_id
from .models import (
    COMMUNITY_LICENSE,
    LicenseInfo,
    LicenseTier,
    features_for_tier,
    max_devices_for_tier,
)

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# Ed25519 public key (vendor-only private key is NEVER distributed)
_PUBLIC_KEY_B64 = "V0dGe8GmVj1D3pty4sf2245QKKtl4Kzw9SZhXjSYJXY="

# Grace period after license expiry before enforcement kicks in
_EXPIRY_GRACE = timedelta(hours=72)

# Warning window before expiry
_EXPIRY_WARN_DAYS = 14


def _load_public_key():
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding,
            PublicFormat,
            load_der_public_key,
        )
        raw = base64.b64decode(_PUBLIC_KEY_B64)
        # Raw 32-byte Ed25519 public key — wrap in SubjectPublicKeyInfo DER
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        return Ed25519PublicKey.from_public_bytes(raw)
    except ImportError:
        return None


def _b64url_decode(s: str) -> bytes:
    # Add padding if needed
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s)


def validate_license_key(license_key: str) -> LicenseInfo:
    """
    Parse and validate a license key string.
    Returns a valid LicenseInfo on success, or an invalid one with error set.
    Falls back to COMMUNITY_LICENSE on any hard failure.
    """
    if not license_key or not license_key.strip():
        return COMMUNITY_LICENSE

    key = license_key.strip()

    if not key.startswith("nd."):
        return _invalid("License key must start with 'nd.'")

    parts = key.split(".")
    if len(parts) != 3:
        return _invalid("Malformed license key (expected 3 dot-separated parts)")

    _, payload_b64, sig_b64 = parts

    try:
        payload_bytes = _b64url_decode(payload_b64)
        sig_bytes = _b64url_decode(sig_b64)
    except Exception:
        return _invalid("License key contains invalid base64 data")

    # Signature verification
    pub = _load_public_key()
    if pub is None:
        log.warning("cryptography package not installed — skipping signature check")
    else:
        try:
            from cryptography.exceptions import InvalidSignature
            pub.verify(sig_bytes, payload_bytes)
        except InvalidSignature:
            return _invalid("License signature is invalid — key may be tampered or forged")
        except Exception as exc:
            return _invalid(f"Signature verification error: {exc}")

    # Parse payload
    try:
        payload = json.loads(payload_bytes.decode())
    except Exception:
        return _invalid("License payload is not valid JSON")

    required = {"license_id", "licensee", "tier", "machine_id", "issued_at", "max_devices", "features"}
    missing = required - payload.keys()
    if missing:
        return _invalid(f"License payload missing fields: {missing}")

    # Tier
    try:
        tier = LicenseTier(payload["tier"])
    except ValueError:
        return _invalid(f"Unknown license tier: {payload['tier']!r}")

    # Machine ID binding
    bound_machine = payload["machine_id"]
    if bound_machine != "*":
        actual = get_machine_id()
        if bound_machine != actual:
            log.warning("License machine_id mismatch: key=%s actual=%s", bound_machine, actual)
            return _invalid(
                "License is not valid for this machine. "
                "Please request a new activation or contact support."
            )

    # Expiry
    expires_at_str: str | None = payload.get("expires_at")
    now = datetime.now(timezone.utc)
    expiry_warning = False

    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
        except ValueError:
            return _invalid(f"Invalid expires_at format: {expires_at_str!r}")

        if now > expires_at + _EXPIRY_GRACE:
            return _invalid(
                f"License expired on {expires_at_str} (grace period of 72 h has passed)"
            )

        if now > expires_at - timedelta(days=_EXPIRY_WARN_DAYS):
            expiry_warning = True
    else:
        expires_at = None  # type: ignore[assignment]

    features = set(payload.get("features", []))
    # Ensure tier baseline features are always present
    features |= features_for_tier(tier)

    return LicenseInfo(
        tier=tier,
        licensee=str(payload["licensee"]),
        machine_id=bound_machine,
        license_id=str(payload["license_id"]),
        issued_at=str(payload.get("issued_at", "")),
        expires_at=expires_at_str,
        max_devices=int(payload.get("max_devices", max_devices_for_tier(tier))),
        features=features,
        valid=True,
        expiry_warning=expiry_warning,
        error=None,
    )


def _invalid(reason: str) -> LicenseInfo:
    """Return an invalid license (falls back to community tier)."""
    log.warning("License validation failed: %s", reason)
    from copy import copy
    info = copy(COMMUNITY_LICENSE)
    info.valid = False
    info.error = reason
    return info
