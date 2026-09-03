"""
The Day-N change engine must agree with the browser's, dialect by dialect.

AB2 recorded this pair as "verified in parity" — but that check compared
OPERATION KEYS only. Both sides independently defaulted Extreme EXOS and
NVIDIA Cumulus to the `ios` family, so they agreed while both were wrong, and
an op-key check could never have noticed (AG8/AG9).

These commands are pushed to live production devices, so the property worth
enforcing is stronger than "same op ids": the two engines must resolve the
same vendor to the same CLI family, offer the same families per operation,
and render byte-identical commands and rollbacks for the same input.
"""
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import change_update as cu  # noqa: E402

TS = BACKEND.parent / "frontend" / "src" / "lib" / "config-update.ts"

VENDORS = [
    "Cisco", "Arista", "Juniper", "Nokia", "NVIDIA", "Dell EMC",
    "Extreme Networks", "Fortinet", "HPE Aruba", "Palo Alto", "Acme Unknown",
]


@pytest.fixture(scope="module")
def ts_src() -> str:
    assert TS.exists(), f"frontend source not found at {TS}"
    return TS.read_text()


def _ts_cli_family(src: str) -> dict[str, str]:
    """Parse the frontend's vendor→family switch."""
    body = src[src.index("export function cliFamily("):]
    body = body[: body.index("\n}")]
    out: dict[str, str] = {}
    pending: list[str] = []
    for line in body.split("\n"):
        m = re.search(r"case '([^']+)':\s*(?:return '([a-z]+)')?", line)
        if m:
            pending.append(m.group(1))
            if m.group(2):
                for v in pending:
                    out[v] = m.group(2)
                pending = []
            continue
        d = re.search(r"default:\s*return '([a-z]+)'", line)
        if d:
            for v in pending:
                out[v] = d.group(1)
            out["__default__"] = d.group(1)
    return out


def test_the_parser_found_the_switch(ts_src):
    """Guard the guard: a broken parse must fail loudly, not pass vacuously."""
    fam = _ts_cli_family(ts_src)
    assert len(fam) >= 8, fam
    assert fam.get("Juniper") == "junos"


def test_both_sides_resolve_every_vendor_to_the_same_family(ts_src):
    fam = _ts_cli_family(ts_src)
    default = fam.get("__default__", "ios")
    mismatched = []
    for v in VENDORS:
        want = fam.get(v, default)
        got = cu.cli_family(v)
        if want != got:
            mismatched.append(f"{v}: frontend {want!r} vs backend {got!r}")
    assert not mismatched, (
        "the two engines would push different CLI to the same device:\n  "
        + "\n  ".join(mismatched)
    )


def test_neither_side_calls_exos_or_cumulus_ios():
    """The specific defect: these are not IOS-like and were treated as such."""
    assert cu.cli_family("Extreme Networks") == "exos"
    assert cu.cli_family("NVIDIA") == "nvue"


def test_both_sides_offer_the_same_families_per_operation(ts_src):
    mismatched = []
    for op in cu.CHANGE_CATALOG:
        m = re.search(
            r"id: '%s',[\s\S]{0,600}?families: \[([^\]]+)\]" % re.escape(op["id"]), ts_src)
        assert m, f"{op['id']} not found in the frontend catalogue"
        want = sorted(re.findall(r"'([a-z]+)'", m.group(1)))
        got = sorted(op["families"])
        if want != got:
            mismatched.append(f"{op['id']}: frontend {want} vs backend {got}")
    assert not mismatched, (
        "an operation is templated for a dialect on one side only:\n  "
        + "\n  ".join(mismatched)
    )


def test_every_supported_family_renders_a_reversible_change():
    """A change with no rollback is one an operator cannot undo."""
    params = {
        "local_as": "65000", "peer_ip": "10.0.0.2", "remote_as": "65010",
        "vlan_id": "120", "name": "PCI", "iface": "swp1",
        "prefix": "10.50.0.0/24", "next_hop": "10.0.0.1",
        "service": "ntp", "server": "10.0.0.100", "admin_state": "up",
        "action": "permit", "src": "any", "dst": "any",
    }
    for op in cu.CHANGE_CATALOG:
        for fam in op["families"]:
            r = cu.render(op["id"], fam, params)
            assert r["commands"], f"{op['id']}/{fam}: no commands"
            assert r["rollback"], f"{op['id']}/{fam}: irreversible"


@pytest.mark.parametrize("fam", ["exos", "nvue"])
def test_the_new_dialects_never_emit_cisco_syntax(fam):
    params = {
        "local_as": "65000", "peer_ip": "10.0.0.2", "remote_as": "65010",
        "vlan_id": "120", "name": "PCI", "iface": "swp1",
        "prefix": "10.50.0.0/24", "next_hop": "10.0.0.1",
        "service": "ntp", "server": "10.0.0.100", "admin_state": "up",
    }
    cisco_only = [r"^vlan \d+$", r"^ no shutdown$", r"^ switchport access vlan", r"^no vlan "]
    for op in cu.CHANGE_CATALOG:
        if fam not in op["families"]:
            continue
        r = cu.render(op["id"], fam, params)
        for line in r["commands"] + r["rollback"]:
            for pat in cisco_only:
                assert not re.match(pat, line), f"{op['id']}/{fam}: Cisco syntax {line!r}"
