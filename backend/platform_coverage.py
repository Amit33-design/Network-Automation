"""
Troubleshooting / diagnostics platform coverage (AG10).
=======================================================

The diagnostic playbooks (``troubleshoot.py``) and the correlation engines
(``troubleshoot_engine.py``, ``monitor_engine.py``) carry per-platform command
variants for FOUR NOSes: NX-OS, IOS-XE, Arista EOS and Juniper JunOS.

Every other NOS in the product catalogue — Nokia SR Linux, Extreme EXOS,
NVIDIA Cumulus, Dell OS10, FortiOS, Aruba AOS-CX, PAN-OS, IOS-XR — has no
variants, and the resolvers used to fall through to the Cisco-family base
*silently*. A Nokia operator investigating a down session was handed
``show ip bgp summary``, which SR Linux does not have.

The product decision (2026-09-07) is to SURFACE that rather than write
24 playbooks x 8 platforms of variants on both sides of the stack. This module
is the one place that says what is covered, so the API can report a
substitution instead of pretending it did not happen.

Mirrors ``frontend/src/lib/troubleshoot-coverage.ts`` — the parity test
``tests/test_troubleshoot_coverage_parity.py`` asserts the two agree.
"""
from __future__ import annotations

from typing import Any

#: The NOSes the playbooks carry real command variants for.
COVERED_PLATFORMS: tuple[str, ...] = ("nxos", "iosxe", "eos", "junos")

COVERED_PLATFORM_LABEL: dict[str, str] = {
    "nxos": "Cisco NX-OS",
    "iosxe": "Cisco IOS-XE",
    "eos": "Arista EOS",
    "junos": "Juniper JunOS",
}

#: NOSes present in the product catalogue that the playbooks do NOT cover.
UNCOVERED_PLATFORM_LABEL: dict[str, str] = {
    "srl": "Nokia SR Linux",
    "cumulus": "NVIDIA Cumulus",
    "dellos10": "Dell OS10",
    "exos": "Extreme EXOS",
    "fortios": "FortiOS",
    "arubaoscx": "Aruba AOS-CX",
    "panos": "PAN-OS",
    "iosxr": "Cisco IOS-XR",
    "sonic": "SONiC",
}

#: Vendor -> the NOS that vendor's fabric hardware actually runs. Mirrors the
#: frontend ``ztpPlatform()`` vendor arm; model-level Cisco disambiguation
#: (Nexus vs Catalyst vs ASR9k) is the caller's job where a model is known.
VENDOR_NOS: dict[str, str] = {
    "Cisco": "nxos",
    "Arista": "eos",
    "Juniper": "junos",
    "Nokia": "srl",
    "NVIDIA": "cumulus",
    "Dell EMC": "dellos10",
    "Fortinet": "fortios",
    "HPE Aruba": "arubaoscx",
    "Extreme Networks": "exos",
    "Palo Alto": "panos",
}

#: The correlation engines (``troubleshoot_engine``, ``monitor_engine``) carry
#: their own command sets, which additionally include SONiC. They are NOT the
#: same coverage as the playbooks — flattening the two would silently drop 36
#: real SONiC command sets, or claim playbook coverage that does not exist.
ENGINE_PLATFORMS: tuple[str, ...] = COVERED_PLATFORMS + ("sonic",)

DEFAULT_PLATFORM = "nxos"


def is_covered(platform: str | None) -> bool:
    """True when the playbooks carry real command variants for this NOS."""
    return (platform or "").strip().lower() in COVERED_PLATFORMS


def platform_label(platform: str | None) -> str:
    p = (platform or "").strip().lower()
    return COVERED_PLATFORM_LABEL.get(p) or UNCOVERED_PLATFORM_LABEL.get(p) or (p or "unknown")


def resolve_platform(
    requested: str | None,
    available: tuple[str, ...] = COVERED_PLATFORMS,
) -> tuple[str, bool]:
    """
    Resolve a requested NOS to one the caller's command set can serve.

    Returns ``(platform, covered)``. When ``covered`` is False the caller asked
    for a NOS with no variants and the returned platform is a SUBSTITUTION —
    report it rather than presenting it as the answer. ``available`` lets the
    correlation engines opt into their wider set (``ENGINE_PLATFORMS``).
    """
    p = (requested or "").strip().lower()
    if p in available:
        return p, True
    return DEFAULT_PLATFORM, False


def coverage_report(requested: str | None) -> dict[str, Any]:
    """
    A machine-readable statement of what the caller is actually getting.
    Always present on the response so a consumer never has to infer it.
    """
    resolved, covered = resolve_platform(requested)
    req = (requested or "").strip().lower()
    report: dict[str, Any] = {
        "requested": req or resolved,
        "resolved": resolved,
        "covered": covered,
        "supported_platforms": list(COVERED_PLATFORMS),
    }
    if not covered:
        report["note"] = (
            f"No diagnostic command variants exist for {platform_label(req)}. "
            f"The commands below are {COVERED_PLATFORM_LABEL[resolved]} syntax and will not "
            f"run on that platform — use the vendor's own CLI. The diagnostic sequence "
            f"(what to check, in what order) still applies."
        )
    return report


def best_platform_for_vendor(
    vendor: str | None,
    use_case: str = "dc",
    available: tuple[str, ...] = COVERED_PLATFORMS,
) -> tuple[str, bool]:
    """
    Pick a diagnostics platform from a detected vendor.

    Returns ``(platform, covered)``. Previously the two ``_best_platform``
    helpers auto-selected ``nxos`` for any vendor that was not Arista or
    Juniper, so the wrong default was chosen *for* the user rather than by
    them; this keeps the fallback (a platform must be returned) but reports it.
    """
    nos = VENDOR_NOS.get((vendor or "").strip())
    if nos is None:
        # No vendor detected — fall back on the use case, as before. A use case
        # is not a NOS, so this is a guess either way; it is only made when
        # there is nothing better to go on.
        return ("iosxe", True) if use_case == "campus" else (DEFAULT_PLATFORM, True)
    if nos == "nxos" and use_case == "campus":
        nos = "iosxe"  # Cisco campus is Catalyst/IOS-XE, not Nexus.
    return resolve_platform(nos, available)
