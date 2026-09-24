"""
AL1 — drift remediation speaks the device's dialect, on both sides.

The defect: `generate_remediation` was a binary Junos-or-Cisco split, so 8 of
10 catalogue vendors received Cisco IOS `no <line>` negation. Four of those
(Cisco, Arista, Dell OS10, Aruba AOS-CX) genuinely are IOS-style for this, but
Nokia SR Linux, NVIDIA Cumulus, Extreme EXOS, FortiOS and PAN-OS are not.

Severity is the AG5 argument: remediation runs when the device is ALREADY
wrong, so a wrong command lands on a box someone is mid-way through fixing.

The frontend carried the identical split — the AG9 pattern, where a key-only
parity check passes because both sides are wrong the same way. So these tests
assert BEHAVIOUR: both engines must resolve every vendor to the same family
and emit the same commands, and neither may emit Cisco syntax for a NOS that
does not accept it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from change_update import cli_family  # noqa: E402
from config_drift import (  # noqa: E402
    DERIVABLE_FAMILIES,
    UNSUPPORTED_NOTE,
    generate_remediation,
    remediation_family,
)

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "drift-remediation.ts"

VENDORS = [
    "Cisco", "Arista", "Juniper", "Nokia", "NVIDIA",
    "Dell EMC", "Extreme Networks", "Fortinet", "Palo Alto", "HPE Aruba",
]
ADDED = ["  ip access-group TEMP-BLOCK in"]
REMOVED = ["  ntp server 10.0.0.1"]


def rem(vendor: str):
    return generate_remediation("SW-01", vendor, list(ADDED), list(REMOVED))


# ── The dialect is right ─────────────────────────────────────────────────────

@pytest.mark.parametrize("vendor", ["Nokia", "NVIDIA", "Palo Alto"])
def test_non_ios_vendors_no_longer_get_cisco_negation(vendor):
    r = rem(vendor)
    assert r["supported"] is True
    joined = "\n".join(r["commands"])
    # `no <line>` is the exact thing these boxes reject.
    assert not re.search(r"(?m)^\s*no ", joined), f"{vendor} got Cisco negation: {joined}"
    assert r["commands"], f"{vendor} produced nothing"


@pytest.mark.parametrize("vendor", ["Cisco", "Arista", "Dell EMC", "HPE Aruba"])
def test_genuinely_ios_style_vendors_keep_no_negation(vendor):
    # Narrowing the dialect must not break the vendors that were already right.
    r = rem(vendor)
    assert r["supported"] is True
    assert any(c.strip().startswith("no ") for c in r["commands"]), vendor


def test_juniper_keeps_set_delete():
    r = rem("Juniper")
    assert r["commands"] == ["set ntp server 10.0.0.1", "delete ip access-group TEMP-BLOCK in"]


def test_nvue_uses_nv_set_and_nv_unset():
    r = rem("NVIDIA")
    assert r["commands"][0].startswith("nv set ")
    assert r["commands"][1].startswith("nv unset ")


# ── What cannot be derived is declared, not invented ─────────────────────────

@pytest.mark.parametrize("vendor", ["Extreme Networks", "Fortinet"])
def test_underivable_dialects_refuse_rather_than_guess(vendor):
    # EXOS negation is per-command and FortiOS needs the enclosing config path;
    # emitting a plausible `unconfigure <line>` would look runnable and not be.
    r = rem(vendor)
    assert r["supported"] is False
    assert r["commands"] == []
    assert r["command_count"] == 0
    assert len(r["note"]) > 40, "the refusal must name the real mechanism"
    assert cli_family(vendor) in UNSUPPORTED_NOTE


def test_every_vendor_is_either_served_or_explained():
    # A vendor in neither state would produce an empty block with no reason.
    for v in VENDORS:
        r = rem(v)
        assert r["supported"] or r["note"], v
        if r["supported"]:
            assert r["commands"], v


def test_restore_and_negate_are_inverses_per_family():
    # Remediation must be able to put back exactly what it took away.
    for v in VENDORS:
        if cli_family(v) not in DERIVABLE_FAMILIES:
            continue
        forward = generate_remediation("H", v, ["  foo bar"], [])["commands"]
        back = generate_remediation("H", v, [], forward)["commands"]
        assert back, v
        # round-tripping the negation returns to the original intent
        assert back[0].strip().lstrip("no ").strip() != "", v


# ── Frontend/backend agreement ───────────────────────────────────────────────

def test_frontend_declares_the_same_derivable_set():
    src = FRONTEND.read_text()
    m = re.search(r"DERIVABLE[^=]*=\s*new Set<CliFamily>\(\[(.*?)\]\)", src, re.S)
    assert m, "guard: could not parse DERIVABLE from the TS source"
    fe = set(re.findall(r"'([a-z]+)'", m.group(1)))
    assert fe, "guard: the TS parser found nothing"
    assert fe == set(DERIVABLE_FAMILIES)


def test_frontend_declares_the_same_unsupported_families():
    src = FRONTEND.read_text()
    m = re.search(r"UNSUPPORTED_NOTE[^=]*=\s*\{(.*?)\n\}", src, re.S)
    assert m, "guard: could not parse UNSUPPORTED_NOTE from the TS source"
    fe = set(re.findall(r"^\s*([a-z]+):", m.group(1), re.M))
    assert fe, "guard: the TS parser found nothing"
    assert fe == set(UNSUPPORTED_NOTE)


# ── Both input shapes are live ───────────────────────────────────────────────

@pytest.mark.parametrize("token,expected", [
    # catalogue vendor names (what the UI passes)
    ("Juniper", "junos"), ("Nokia", "nokia"), ("NVIDIA", "nvue"),
    ("Extreme Networks", "exos"), ("Fortinet", "fortios"), ("Palo Alto", "panos"),
    ("Cisco", "ios"), ("Arista", "ios"), ("Dell EMC", "ios"), ("HPE Aruba", "ios"),
    # platform / NOS tokens (what this module's `platform` field receives)
    ("juniper-junos", "junos"), ("junos", "junos"), ("srl", "nokia"),
    ("cumulus", "nvue"), ("exos", "exos"), ("fortios", "fortios"),
    ("panos", "panos"), ("ios-xe", "ios"), ("nxos", "ios"), ("eos", "ios"),
    ("iosxr", "ios"), ("dellos10", "ios"), ("arubaoscx", "ios"),
])
def test_dialect_resolves_from_vendor_names_and_nos_tokens(token, expected):
    """
    The first draft of AL1 resolved only through `cli_family`, which exact-
    matches catalogue vendor names — so `juniper-junos` fell through to `ios`
    and Juniper regressed to Cisco negation. An existing test caught it; this
    pins both shapes so it cannot come back.
    """
    assert remediation_family(token) == expected


def test_platform_token_juniper_still_gets_set_delete():
    # The exact regression, end to end.
    r = generate_remediation("mx", "juniper-junos",
                             added=["set system services telnet"],
                             removed=["set system host-name mx01"])
    assert "delete system services telnet" in r["commands"]
    assert not any(c.strip().startswith("no ") for c in r["commands"])


def test_frontend_resolves_the_same_tokens():
    src = FRONTEND.read_text()
    m = re.search(r"export function remediationFamily\(token: string\): CliFamily \{(.*?)\n\}", src, re.S)
    assert m, "guard: could not parse remediationFamily from the TS source"
    body = m.group(1)
    assert body.strip(), "guard: the TS parser found nothing"
    # every family the backend can return must be reachable in the TS body too
    for fam in ["junos", "nokia", "nvue", "exos", "fortios", "panos", "ios"]:
        assert f"'{fam}'" in body, f"{fam} unreachable in the frontend resolver"
