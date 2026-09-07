"""
AE3 — the API's config-generation limits are discoverable, not just enforced.

AB7/AD4 made the refusal honest at CALL time: a Nokia design gets an explicit
``CONFIG NOT GENERATED`` body rather than Cisco CLI wearing a Nokia label. But
a consumer still had to POST a whole design to learn its vendor was
unsupported. The product decision (2026-09-07) was to surface the limitation
rather than write six more Jinja families duplicating dialect knowledge the
browser engine already owns.

These tests pin the two things that makes worth anything: the matrix is
ACCURATE (it agrees with the enforcement it describes) and it is COMPLETE
(no catalogue vendor is missing from it, which would read as tacit support).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config_gen import (  # noqa: E402
    ALL_CATALOGUE_VENDORS,
    VENDOR_UNSUPPORTED_LAYERS,
    config_support_matrix,
    generate_all_configs,
    vendor_supports_layer,
)


def test_every_catalogue_vendor_is_classified():
    # A vendor missing from both lists reads as supported, which is the exact
    # failure AB7 existed to stop — one layer up.
    m = config_support_matrix()
    classified = set(m["supported_vendors"]) | set(m["unsupported_vendors"])
    assert classified == set(ALL_CATALOGUE_VENDORS)


def test_no_vendor_is_in_both_lists():
    m = config_support_matrix()
    assert not (set(m["supported_vendors"]) & set(m["unsupported_vendors"]))


def test_matrix_agrees_with_the_enforcement_it_describes():
    m = config_support_matrix()
    for vendor in m["supported_vendors"]:
        for layer in ("dc-spine", "dc-leaf", "campus-access", "fw"):
            assert vendor_supports_layer(vendor, layer), f"{vendor}/{layer}"
    for vendor, info in m["unsupported_vendors"].items():
        for layer in info["layers_supplied"]:
            assert not vendor_supports_layer(vendor, layer), f"{vendor}/{layer}"
        assert info["layers_supplied"] == sorted(VENDOR_UNSUPPORTED_LAYERS[vendor])


def test_matrix_points_at_the_engine_that_does_cover_everything():
    m = config_support_matrix()
    full = m["full_coverage_engine"]
    assert full["location"].endswith("configgen.ts")
    # It must name EVERY catalogue vendor — pointing a user at an engine that
    # also cannot help them would be worse than saying nothing.
    assert set(full["vendors"]) == set(ALL_CATALOGUE_VENDORS)


def test_declared_template_families_exist_on_disk():
    m = config_support_matrix()
    assert m["template_families"], "guard: no template dirs found"
    for fam in ("nxos", "eos", "junos", "cumulus"):
        assert fam in m["template_families"]


@pytest.mark.parametrize("vendor", sorted(VENDOR_UNSUPPORTED_LAYERS))
def test_an_unsupported_vendor_still_refuses_rather_than_guessing(vendor):
    # The matrix documents a real behaviour, not an aspiration.
    state = {"uc": "dc", "vendors": [vendor], "orgName": "T",
             "selectedProducts": {}, "totalEndpoints": 200}
    configs = generate_all_configs(state)
    refused = [h for h, c in configs.items() if "CONFIG NOT GENERATED" in c]
    if "dc-spine" in VENDOR_UNSUPPORTED_LAYERS[vendor]:
        assert refused, f"{vendor} fabric should be refused, not generated"
        for cfg in (configs[h] for h in refused):
            assert vendor in cfg
            # and it must not look remotely deployable
            assert "feature nv overlay" not in cfg


def test_supported_vendor_generates_normally():
    state = {"uc": "dc", "vendors": ["Arista"], "orgName": "T",
             "selectedProducts": {}, "totalEndpoints": 200}
    configs = generate_all_configs(state)
    assert configs
    assert not [h for h, c in configs.items() if "CONFIG NOT GENERATED" in c]


# ── The guard has to be REACHABLE from the API it protects ───────────────────

def test_design_state_carries_a_vendor_field():
    """
    AE3 — the AB7/AD4 refusal read ``vendors`` from the request state, and
    DesignState had no such field, so through /api/generate-configs the
    detection always returned "" and a Nokia design got Cisco NX-OS CLI:
    exactly the behaviour that guard was written to stop. A guard that cannot
    fire on the path that matters is not a guard.

    ``main`` cannot be imported in this environment (an unrelated FastAPI /
    Pydantic version incompatibility), so the field is checked in the source
    with a loud guard — a broken parse fails rather than passing vacuously —
    and the behaviour is checked for real below.
    """
    src = (Path(__file__).resolve().parents[1] / "main.py").read_text()
    body = src.split("class DesignState(BaseModel):", 1)[1].split("\n\n\nclass ", 1)[0]
    assert "selectedProducts:" in body, "guard: DesignState body not parsed"
    assert "vendors:" in body, "DesignState must carry a vendor field"


def test_an_api_shaped_nokia_request_is_refused():
    # The behavioural half of the above: the exact dict an API caller's
    # DesignState dumps to must hit the guard.
    payload = {"uc": "dc", "orgName": "My Network", "vendors": ["Nokia"],
               "selectedProducts": {}, "protocols": [], "security": []}
    configs = generate_all_configs(payload)
    refused = [h for h, c in configs.items() if "CONFIG NOT GENERATED" in c]
    assert refused, "an API-shaped Nokia request must be refused, not served Cisco CLI"


@pytest.mark.parametrize("sku,expected", [
    ("nokia-srl-7220d3", "Nokia"),
    ("dell-z9332f", "Dell EMC"),
    ("arista-7050cx3", "Arista"),
    ("nxos-9336c", "Cisco"),
])
def test_vendor_is_inferred_from_the_selected_skus(sku, expected):
    # A design IS its hardware, so the guard holds even for a caller that
    # never declares a vendor.
    from config_gen import _detect_primary_vendor
    assert _detect_primary_vendor({"selectedProducts": {"dc-spine": sku}}) == expected


def test_all_three_vendor_field_spellings_are_honoured():
    from config_gen import _detect_primary_vendor
    for key in ("vendors", "selectedVendors", "vendorPrefs"):
        assert _detect_primary_vendor({key: ["Nokia"]}) == "Nokia", key


def test_no_vendor_at_all_still_uses_the_layer_default():
    # Omitting a vendor is legitimate and must NOT be treated as unsupported.
    from config_gen import _detect_primary_vendor
    assert _detect_primary_vendor({"uc": "dc"}) == ""
    configs = generate_all_configs({"uc": "dc", "orgName": "T", "selectedProducts": {}})
    assert configs
    assert not [h for h, c in configs.items() if "CONFIG NOT GENERATED" in c]
