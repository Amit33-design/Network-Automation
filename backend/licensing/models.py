"""
NetDesign AI License — tier definitions and feature flags.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class LicenseTier(str, Enum):
    COMMUNITY    = "community"      # Free — config gen + MCP, no real deploy
    PROFESSIONAL = "professional"   # Paid — full deploy, up to 50 devices
    ENTERPRISE   = "enterprise"     # Paid — unlimited, RCA, telemetry, white-label


# Feature flags per tier
_TIER_FEATURES: dict[LicenseTier, set[str]] = {
    LicenseTier.COMMUNITY: {
        "config_gen",
        "mcp_tools",
        "simulation",
        "policy_engine",
        "static_analysis",
    },
    LicenseTier.PROFESSIONAL: {
        "config_gen",
        "mcp_tools",
        "simulation",
        "policy_engine",
        "static_analysis",
        "deploy",
        "ztp",
        "backup",
        "rollback",
        "jwt_auth",
        "design_persistence",
    },
    LicenseTier.ENTERPRISE: {
        "config_gen",
        "mcp_tools",
        "simulation",
        "policy_engine",
        "static_analysis",
        "deploy",
        "ztp",
        "backup",
        "rollback",
        "jwt_auth",
        "design_persistence",
        "rca",
        "telemetry",
        "audit_export",
        "white_label",
        "sso",
        "priority_support",
    },
}

# Max network devices per tier (enforced at deploy time)
_TIER_MAX_DEVICES: dict[LicenseTier, int] = {
    LicenseTier.COMMUNITY:    0,    # deploy blocked entirely
    LicenseTier.PROFESSIONAL: 50,
    LicenseTier.ENTERPRISE:   9999,
}


@dataclass
class LicenseInfo:
    tier:            LicenseTier
    licensee:        str
    machine_id:      str       # fingerprint this license is bound to ("*" = any)
    license_id:      str
    issued_at:       str       # ISO-8601
    expires_at:      str | None
    max_devices:     int
    features:        set[str]
    valid:           bool      = True
    expiry_warning:  bool      = False   # True when within 14 days of expiry
    error:           str | None = None   # set when valid=False

    def has_feature(self, feature: str) -> bool:
        return feature in self.features

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier":           self.tier.value,
            "licensee":       self.licensee,
            "machine_id":     self.machine_id,
            "license_id":     self.license_id,
            "issued_at":      self.issued_at,
            "expires_at":     self.expires_at,
            "max_devices":    self.max_devices,
            "features":       sorted(self.features),
            "valid":          self.valid,
            "expiry_warning": self.expiry_warning,
            "error":          self.error,
        }


# Community license — always available as fallback, no key required
COMMUNITY_LICENSE = LicenseInfo(
    tier=LicenseTier.COMMUNITY,
    licensee="Community",
    machine_id="*",
    license_id="community-free",
    issued_at="2026-01-01T00:00:00Z",
    expires_at=None,
    max_devices=0,
    features=_TIER_FEATURES[LicenseTier.COMMUNITY],
    valid=True,
)


def features_for_tier(tier: LicenseTier) -> set[str]:
    return _TIER_FEATURES.get(tier, _TIER_FEATURES[LicenseTier.COMMUNITY])


def max_devices_for_tier(tier: LicenseTier) -> int:
    return _TIER_MAX_DEVICES.get(tier, 0)
