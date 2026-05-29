#!/usr/bin/env python3
"""
NetDesign AI — vendor license key generator.

Usage:
  python tools/gen_license.py \
      --licensee "Acme Corp" \
      --tier professional \
      --machine-id <fingerprint>  \   # omit or use "*" for floating
      --max-devices 50 \
      --expires 2027-06-01 \
      --out acme.ndlic

  python tools/gen_license.py --help

KEEP THE PRIVATE KEY FILE SECURE.  Never commit it.
Default private key path: ~/.netdesign_vendor.key  (set via ND_VENDOR_KEY env)
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


# ── Tier defaults ────────────────────────────────────────────────────────────

_TIER_FEATURES = {
    "community": [
        "config_gen", "mcp_tools", "simulation", "policy_engine", "static_analysis",
    ],
    "professional": [
        "config_gen", "mcp_tools", "simulation", "policy_engine", "static_analysis",
        "deploy", "ztp", "backup", "rollback", "jwt_auth", "design_persistence",
    ],
    "enterprise": [
        "config_gen", "mcp_tools", "simulation", "policy_engine", "static_analysis",
        "deploy", "ztp", "backup", "rollback", "jwt_auth", "design_persistence",
        "rca", "telemetry", "audit_export", "white_label", "sso", "priority_support",
    ],
}

_TIER_MAX_DEVICES = {"community": 0, "professional": 50, "enterprise": 9999}


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _load_private_key(path: Path):
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat
    except ImportError:
        sys.exit("ERROR: 'cryptography' package not installed. Run: pip install cryptography")

    raw = base64.b64decode(path.read_bytes().strip())
    if len(raw) == 32:
        return Ed25519PrivateKey.from_private_bytes(raw)
    # DER / PEM fallback
    from cryptography.hazmat.primitives.serialization import load_der_private_key, load_pem_private_key
    try:
        return load_der_private_key(raw, password=None)
    except Exception:
        return load_pem_private_key(raw, password=None)


def generate(
    licensee: str,
    tier: str,
    machine_id: str,
    max_devices: int | None,
    expires: str | None,
    private_key_path: Path,
) -> str:
    if tier not in _TIER_FEATURES:
        sys.exit(f"ERROR: unknown tier {tier!r}. Choose: {list(_TIER_FEATURES)}")

    privkey = _load_private_key(private_key_path)

    payload = {
        "license_id":  f"nd-{uuid.uuid4().hex[:12]}",
        "licensee":    licensee,
        "tier":        tier,
        "machine_id":  machine_id or "*",
        "issued_at":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_at":  expires,
        "max_devices": max_devices if max_devices is not None else _TIER_MAX_DEVICES[tier],
        "features":    _TIER_FEATURES[tier],
    }

    payload_bytes = json.dumps(payload, separators=(",", ":")).encode()
    sig_bytes = privkey.sign(payload_bytes)

    key = f"nd.{_b64url(payload_bytes)}.{_b64url(sig_bytes)}"
    return key, payload


def main():
    parser = argparse.ArgumentParser(description="NetDesign AI license key generator")
    parser.add_argument("--licensee", required=True, help="Customer / org name")
    parser.add_argument("--tier", default="professional",
                        choices=["community", "professional", "enterprise"])
    parser.add_argument("--machine-id", default="*",
                        help="Machine fingerprint to bind to, or '*' for floating")
    parser.add_argument("--max-devices", type=int, default=None,
                        help="Override max devices (default: tier default)")
    parser.add_argument("--expires", default=None,
                        help="Expiry date YYYY-MM-DD (omit = perpetual)")
    parser.add_argument("--key-file", default=None,
                        help="Path to vendor private key file (default: ~/.netdesign_vendor.key)")
    parser.add_argument("--out", default=None,
                        help="Write license key to this file (default: stdout)")

    args = parser.parse_args()

    key_path = Path(args.key_file) if args.key_file else Path(
        os.environ.get("ND_VENDOR_KEY", str(Path.home() / ".netdesign_vendor.key"))
    )
    if not key_path.exists():
        sys.exit(f"ERROR: private key not found at {key_path}\n"
                 "Set ND_VENDOR_KEY env or pass --key-file.")

    expires = args.expires
    if expires:
        # Normalise to ISO-8601 UTC
        try:
            d = datetime.strptime(expires, "%Y-%m-%d")
            expires = d.strftime("%Y-%m-%dT23:59:59Z")
        except ValueError:
            sys.exit(f"ERROR: --expires must be YYYY-MM-DD, got {expires!r}")

    key, payload = generate(
        licensee=args.licensee,
        tier=args.tier,
        machine_id=args.machine_id,
        max_devices=args.max_devices,
        expires=expires,
        private_key_path=key_path,
    )

    print("\n=== Generated License ===")
    print(f"  License ID : {payload['license_id']}")
    print(f"  Licensee   : {payload['licensee']}")
    print(f"  Tier       : {payload['tier']}")
    print(f"  Machine ID : {payload['machine_id']}")
    print(f"  Issued     : {payload['issued_at']}")
    print(f"  Expires    : {payload['expires_at'] or 'never'}")
    print(f"  Max devices: {payload['max_devices']}")
    print(f"  Features   : {', '.join(payload['features'])}")
    print()

    if args.out:
        out = Path(args.out)
        out.write_text(key + "\n")
        print(f"License key written to: {out}")
    else:
        print("LICENSE KEY:")
        print(key)


if __name__ == "__main__":
    main()
