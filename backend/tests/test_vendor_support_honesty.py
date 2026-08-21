"""
The config API must not emit one vendor's CLI labelled as another's.

`VENDOR_PLATFORM_OVERRIDE` covers Arista, Juniper and NVIDIA. Every other
vendor fell through to `LAYER_PLATFORM_MAP`, which for a DC leaf is
`("nxos", "leaf.j2")` — so a Nokia, Dell, Extreme, Fortinet, Aruba or Palo Alto
design silently received **Cisco NX-OS CLI**, with the generated header even
claiming `Platform : nxos`.

That is not "the API returns less than the browser". It is confidently wrong
config for the wrong platform: `feature nv overlay` on an SR Linux box is
rejected on the first line, and an operator reading the header has no reason
to suspect it.

Until the template families exist (tracker AB7) the API refuses explicitly.
Fail loudly beats a plausible-looking artifact — the same principle as the
device-I/O fix in test_device_io_fails_closed.py.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config_gen import (  # noqa: E402
    FABRIC_VENDORS_WITHOUT_TEMPLATES,
    VENDOR_PLATFORM_OVERRIDE,
    generate_all_configs,
)

# Markers that identify which NOS a config body actually is.
NOS_MARKERS = {
    "NX-OS": ("feature nv overlay", "vn-segment"),
    "EOS": ("Arista EOS",),
    "JunOS": ("set protocols", "set interfaces"),
}


def _leaf_config(vendor: str) -> str:
    state = {
        "uc": "dc", "orgName": "T",
        "vendors": [vendor] if vendor else [],
        "numLeaf": 1, "numSpine": 1,
    }
    cfgs = generate_all_configs(state)
    key = next((k for k in cfgs if "LEAF" in k.upper()), None)
    assert key, f"{vendor}: no leaf config produced at all"
    return cfgs[key]


def _looks_like(body: str, nos: str) -> bool:
    return any(m in body for m in NOS_MARKERS[nos])


@pytest.mark.parametrize("vendor", sorted(FABRIC_VENDORS_WITHOUT_TEMPLATES))
def test_unsupported_vendor_refuses_instead_of_emitting_nxos(vendor):
    body = _leaf_config(vendor)

    assert "CONFIG NOT GENERATED" in body, (
        f"{vendor} received a generated config; it has no template family"
    )
    assert not _looks_like(body, "NX-OS"), (
        f"{vendor} was handed Cisco NX-OS CLI — it would be rejected on the "
        f"first line and the header would claim it was correct"
    )


@pytest.mark.parametrize("vendor", sorted(FABRIC_VENDORS_WITHOUT_TEMPLATES))
def test_the_refusal_says_what_to_do_instead(vendor):
    body = _leaf_config(vendor)
    assert vendor in body, "the refusal must name the vendor"
    # points at the engine that CAN generate for this vendor
    assert "configgen.ts" in body
    # and names the vendors the API does support, so the message is actionable
    for supported in ("Cisco", "Arista", "Juniper"):
        assert supported in body


@pytest.mark.parametrize(
    "vendor,nos",
    [("Arista", "EOS"), ("Juniper", "JunOS")],
)
def test_supported_vendors_are_unchanged(vendor, nos):
    body = _leaf_config(vendor)
    assert "CONFIG NOT GENERATED" not in body
    assert _looks_like(body, nos), f"{vendor} no longer renders {nos}"


def test_no_vendor_specified_still_uses_the_layer_default():
    """An unset vendor is not an error — the layer default is correct there."""
    body = _leaf_config("")
    assert "CONFIG NOT GENERATED" not in body
    assert _looks_like(body, "NX-OS")


def test_the_two_sets_do_not_overlap():
    """A vendor cannot both have a template family and be refused."""
    overlap = FABRIC_VENDORS_WITHOUT_TEMPLATES & set(VENDOR_PLATFORM_OVERRIDE)
    assert not overlap, f"contradictory vendor config: {sorted(overlap)}"


def test_campus_layers_are_unaffected():
    """Only the fabric layers take the vendor override, so only they can be
    mislabelled; campus is Cisco IOS-XE by design and must keep generating."""
    cfgs = generate_all_configs({
        "uc": "campus", "orgName": "T", "vendors": ["Nokia"],
        "numAccess": 1, "numDist": 1, "numCore": 1,
    })
    assert cfgs, "campus generation produced nothing"
    assert not any("CONFIG NOT GENERATED" in c for c in cfgs.values())
