"""AQ6 — lossless RoCEv2 QoS follows the inputs, never the vendor.

Mirrors the browser engine's ``needsLosslessFabric``: the GPU use case is
always lossless, any other design only when the HPC / AI workload type is
selected. A general-purpose DC fabric must not get PFC it did not ask for.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from config_gen import _build_device_context  # noqa: E402


def _ctx(uc: str, vendors: list[str], app_types: list[str] | None = None) -> dict:
    state = {"uc": uc, "vendors": vendors, "orgName": "T"}
    if app_types is not None:
        state["appTypes"] = app_types
    return _build_device_context(state, "dc-leaf", 1)


@pytest.mark.parametrize("vendor", ["Cisco", "Arista", "Juniper", "NVIDIA", "Dell EMC"])
def test_general_dc_is_not_lossless_for_any_vendor(vendor):
    assert _ctx("dc", [vendor])["roce_enabled"] is False


@pytest.mark.parametrize("vendor", ["Cisco", "NVIDIA"])
def test_hpc_selection_makes_a_dc_lossless(vendor):
    assert _ctx("dc", [vendor], ["hpc"])["roce_enabled"] is True


def test_gpu_is_always_lossless():
    assert _ctx("gpu", ["Arista"], [])["roce_enabled"] is True


def test_other_app_types_do_not_trigger_lossless():
    assert _ctx("dc", ["Cisco"], ["storage", "voice"])["roce_enabled"] is False
