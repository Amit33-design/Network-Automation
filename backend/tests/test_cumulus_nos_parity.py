"""
The two engines must agree on what NOS an NVIDIA switch runs.

NVIDIA was nominally "supported" by the API, which made the mismatch easy to
miss: the backend resolved NVIDIA to the `sonic` family (an FRR unified config
plus a SONiC config_db JSON blob) while the browser engine emits Cumulus NVUE
(`nv set` lines). Both run on Spectrum hardware, so neither is absurd — but a
design generated in the UI and a design generated through the API described
two different operating systems.

Cumulus NVUE is canonical: NCLU was removed in Cumulus 5.x, and
`nv set qos roce enable on` + `mode lossless` is the single profile that
programs PFC, ECN/WRED and buffer carving — which is what makes a GPU fabric
genuinely lossless rather than lossless-in-the-comments (tracker Y6).

The `sonic` templates are retained for callers who explicitly want SONiC; this
test only pins what NVIDIA resolves to by default.
"""
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from config_gen import VENDOR_PLATFORM_OVERRIDE, generate_all_configs  # noqa: E402

FABRIC_KEY = ("SPINE", "LEAF", "TOR")


def _fabric_configs(use_case: str, vendor: str = "NVIDIA") -> dict[str, str]:
    cfgs = generate_all_configs({
        "uc": use_case, "orgName": "T", "vendors": [vendor],
        "numLeaf": 2, "numSpine": 2,
    })
    return {k: v for k, v in cfgs.items() if any(t in k.upper() for t in FABRIC_KEY)}


def test_nvidia_resolves_to_cumulus_not_sonic():
    assert VENDOR_PLATFORM_OVERRIDE["NVIDIA"] == "cumulus"


@pytest.mark.parametrize("use_case", ["dc", "gpu"])
def test_every_nvidia_fabric_device_renders_nvue(use_case):
    cfgs = _fabric_configs(use_case)
    assert cfgs, f"{use_case}: no fabric devices generated"
    for host, body in cfgs.items():
        assert "nv set" in body, f"{host} is not NVUE — the engines disagree on the NOS"
        # the SONiC markers must be gone
        assert "frr version" not in body, f"{host} still renders an FRR config"
        assert "DEVICE_METADATA" not in body, f"{host} still renders SONiC config_db JSON"


@pytest.mark.parametrize("use_case", ["dc", "gpu"])
def test_nvue_output_is_structurally_complete(use_case):
    """A template that renders but omits identity or peering is not a config."""
    for host, body in _fabric_configs(use_case).items():
        assert f"nv set system hostname {host}" in body
        assert "nv set router bgp autonomous-system" in body
        assert "nv set interface lo ip address" in body
        assert "nv set vrf default router bgp neighbor swp" in body, \
            f"{host} has no BGP peers — the fabric would never come up"
        assert "nv config apply" in body
        assert "{{" not in body and "{%" not in body, f"{host} has unrendered Jinja"


def test_gpu_fabric_is_actually_lossless():
    """The §6.5 requirement: a GPU fabric without the RoCE profile is LOSSY."""
    for host, body in _fabric_configs("gpu").items():
        assert "nv set qos roce enable on" in body, f"{host}: no RoCE profile"
        assert "nv set qos roce mode lossless" in body, f"{host}: RoCE not lossless"
        # lossless is a contract — the host half must be documented too
        assert "mlnx_qos" in body, f"{host}: no host-side NIC settings"


def test_the_management_plane_is_real_and_placeholdered():
    for host, body in _fabric_configs("dc").items():
        for svc in ("service ntp", "service syslog", "service snmp-server"):
            assert f"nv set {svc}" in body, f"{host}: missing {svc}"
        # eth0 in the mgmt VRF with a static address, per Z5b/N3-5
        assert "nv set interface eth0 ip vrf mgmt" in body
        assert "ip address dhcp" not in body, f"{host}: DHCP on the OOB port"
        assert "<CHANGE-ME-" in body, f"{host}: no placeholders — secrets baked in?"


def test_other_vendors_are_unaffected():
    """Routing NVIDIA elsewhere must not disturb the vendors that were right."""
    expect = {"Arista": "Arista EOS", "Juniper": "set protocols"}
    for vendor, marker in expect.items():
        body = next(iter(_fabric_configs("dc", vendor).values()))
        assert marker in body, f"{vendor} no longer renders its own NOS"
        assert "nv set" not in body, f"{vendor} leaked Cumulus NVUE"
