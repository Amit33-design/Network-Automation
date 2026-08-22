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
    VENDOR_UNSUPPORTED_LAYERS,
    generate_all_configs,
    vendor_supports_layer,
)

# Markers that identify which NOS a config body actually is.
NOS_MARKERS = {
    "NX-OS": ("feature nv overlay", "vn-segment"),
    "EOS": ("Arista EOS",),
    "JunOS": ("set protocols", "set interfaces"),
}


def _looks_like(body: str, nos: str) -> bool:
    return any(m in body for m in NOS_MARKERS[nos])


# ── Which layer does the refusal belong on? ─────────────────────────────────
# The first version of this guard keyed on the VENDOR alone and applied to the
# fabric layers. This suite parametrised over the whole vendor set and asserted
# a leaf refusal for every one of them — so it encoded the bug rather than
# catching it, the same way the tests for X1, Z4, Z5 and AD2 did.
#
# It was wrong in both directions: Fortinet, HPE Aruba and Palo Alto were
# refused for spines and leaves (Palo Alto does not make one; a "Palo Alto"
# DC design is Palo Alto firewalls in front of a CISCO fabric, and the API
# refused the Cisco fabric), while the layers those vendors DO supply were
# never guarded at all — a Palo Alto firewall came back as Cisco IOS-XE ZBF.

def _configs(use_case: str, vendor: str) -> dict[str, str]:
    return generate_all_configs({
        "uc": use_case, "orgName": "T", "vendors": [vendor] if vendor else [],
        "numLeaf": 1, "numSpine": 1, "numFirewall": 1,
        "numAccess": 1, "numDist": 1, "numCore": 1,
    })


def _leaf_config(vendor: str) -> str:
    cfgs = _configs("dc", vendor)
    key = next((k for k in cfgs if "LEAF" in k.upper()), None)
    assert key, f"{vendor}: no leaf config produced at all"
    return cfgs[key]


def _refused(cfgs: dict[str, str]) -> set[str]:
    return {k for k, v in cfgs.items() if "CONFIG NOT GENERATED" in v}


# Layer key -> the hostname fragment the generator uses for it.
_HOST_OF_LAYER = {
    "dc-spine": "DC-SPINE", "dc-leaf": "DC-LEAF",
    "campus-access": "CAMPUS-ACCESS", "campus-dist": "CAMPUS-DIST",
    "campus-core": "CAMPUS-CORE", "fw": "FW-",
}


@pytest.mark.parametrize("vendor", sorted(FABRIC_VENDORS_WITHOUT_TEMPLATES))
def test_refusal_covers_every_layer_the_vendor_actually_builds(vendor):
    """Whatever hardware the vendor supplies must not come back as someone
    else's CLI — that is the whole point of the guard."""
    for use_case in ("dc", "campus"):
        cfgs = _configs(use_case, vendor)
        refused = _refused(cfgs)
        for layer in VENDOR_UNSUPPORTED_LAYERS[vendor]:
            frag = _HOST_OF_LAYER.get(layer)
            if not frag:
                continue
            hosts = [k for k in cfgs if frag in k.upper()]
            for h in hosts:
                assert h in refused, (
                    f"{vendor}/{use_case}: {h} is {vendor} hardware with no "
                    f"template, but a config was generated for it anyway"
                )


@pytest.mark.parametrize("vendor", sorted(FABRIC_VENDORS_WITHOUT_TEMPLATES))
def test_refusal_never_fires_on_hardware_the_vendor_does_not_make(vendor):
    """A vendor preference does not make every device in the BOM that vendor's."""
    for use_case in ("dc", "campus"):
        cfgs = _configs(use_case, vendor)
        for host in _refused(cfgs):
            layer = next(
                (l for l, frag in _HOST_OF_LAYER.items() if frag in host.upper()), None)
            assert layer is not None, f"unexpected refused host {host}"
            assert not vendor_supports_layer(vendor, layer), (
                f"{vendor}/{use_case}: refused {host}, but {vendor} does not build "
                f"that layer — the design draws it from the fabric default and "
                f"this API can generate it"
            )


def test_a_firewall_vendor_still_gets_its_cisco_fabric():
    """The concrete regression: a Palo Alto DC design is PAN-OS firewalls in
    front of Cisco Nexus switches. The switches must still generate."""
    cfgs = _configs("dc", "Palo Alto")
    leaf = next(v for k, v in cfgs.items() if "LEAF" in k.upper())
    assert "CONFIG NOT GENERATED" not in leaf
    assert _looks_like(leaf, "NX-OS"), "the Cisco fabric no longer renders NX-OS"
    # ...and the Palo Alto box itself is refused rather than given IOS-XE ZBF.
    fw = next(v for k, v in cfgs.items() if k.upper().startswith("FW-"))
    assert "CONFIG NOT GENERATED" in fw
    assert "zone security" not in fw


def test_a_fabric_vendor_still_gets_its_cisco_firewall():
    """The mirror case: Nokia builds no firewall, so the Cisco one generates."""
    cfgs = _configs("dc", "Nokia")
    fw = next(v for k, v in cfgs.items() if k.upper().startswith("FW-"))
    assert "CONFIG NOT GENERATED" not in fw


def test_a_vendor_that_builds_nothing_in_this_use_case_refuses_nothing():
    """Nokia makes no campus gear, so a Nokia campus design is all default."""
    assert _refused(_configs("campus", "Nokia")) == set()


@pytest.mark.parametrize("vendor", sorted(FABRIC_VENDORS_WITHOUT_TEMPLATES))
def test_the_refusal_says_what_to_do_instead(vendor):
    cfgs = _configs("dc", vendor)
    cfgs.update(_configs("campus", vendor))
    body = next(v for v in cfgs.values() if "CONFIG NOT GENERATED" in v)
    assert vendor in body, "the refusal must name the vendor"
    assert "configgen.ts" in body      # points at the engine that CAN do it
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


def test_every_unsupported_vendor_declares_at_least_one_layer():
    """An empty layer tuple would silently disable the guard for that vendor."""
    for vendor, layers in VENDOR_UNSUPPORTED_LAYERS.items():
        assert layers, f"{vendor} is listed as unsupported but guards no layer"


def test_campus_stays_generatable_for_a_vendor_that_makes_no_campus_gear():
    cfgs = generate_all_configs({
        "uc": "campus", "orgName": "T", "vendors": ["Nokia"],
        "numAccess": 1, "numDist": 1, "numCore": 1,
    })
    assert cfgs, "campus generation produced nothing"
    assert not any("CONFIG NOT GENERATED" in c for c in cfgs.values())
