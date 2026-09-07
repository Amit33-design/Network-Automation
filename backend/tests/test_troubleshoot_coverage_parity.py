"""
AG10 — the diagnostics platform-coverage disclosure, and its parity.

The playbooks carry command variants for four NOSes. Every other NOS in the
catalogue falls through to the Cisco-family base. The product decision was to
SURFACE that rather than write 24 playbooks x 8 platforms of variants, so these
tests pin the two properties that makes worth anything:

  1. The disclosure is accurate — a covered platform reports covered, an
     uncovered one reports a substitution and names it.
  2. The frontend and backend agree on WHICH platforms are covered and on the
     vendor -> NOS resolution. Two coverage maps that disagree would put a
     "not supported" banner in the browser over an API response claiming
     support (or the reverse), which is worse than either alone.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import platform_coverage as pc  # noqa: E402
from troubleshoot import build_troubleshooting  # noqa: E402

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "troubleshoot-coverage.ts"
ZTP_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "ztp.ts"


# ── 1. The disclosure is accurate ────────────────────────────────────────────

@pytest.mark.parametrize("plat", pc.COVERED_PLATFORMS)
def test_covered_platform_reports_covered(plat):
    rep = build_troubleshooting("bgp_down", platform=plat)["platform_coverage"]
    assert rep["covered"] is True
    assert rep["resolved"] == plat
    assert "note" not in rep or rep["note"] is None


@pytest.mark.parametrize("plat", sorted(pc.UNCOVERED_PLATFORM_LABEL))
def test_uncovered_platform_is_declared_a_substitution(plat):
    rep = build_troubleshooting("bgp_down", platform=plat)["platform_coverage"]
    assert rep["covered"] is False, f"{plat} has no playbook variants"
    assert rep["requested"] == plat
    assert rep["resolved"] in pc.COVERED_PLATFORMS
    # The note must NAME the platform the operator asked for and the syntax
    # they are actually getting — "unsupported" alone is not actionable.
    assert pc.UNCOVERED_PLATFORM_LABEL[plat] in rep["note"]
    assert pc.COVERED_PLATFORM_LABEL[rep["resolved"]] in rep["note"]


def test_every_response_carries_the_disclosure():
    # Absent the field a consumer has to infer coverage, which is the bug.
    for plat in ("nxos", "srl", "", "nonsense"):
        assert "platform_coverage" in build_troubleshooting("bgp_down", platform=plat)


def test_steps_are_still_produced_for_an_uncovered_platform():
    # Disclosure, not refusal: the diagnostic SEQUENCE is still useful even
    # when the CLI is wrong for the hardware.
    r = build_troubleshooting("bgp_down", platform="exos")
    assert len(r["diagnostic_steps"]) > 0
    assert len(r["likely_causes"]) > 0


# ── 2. Frontend/backend agreement ────────────────────────────────────────────

def _ts_string_array(src: str, name: str) -> list[str]:
    m = re.search(rf"{name}[^=]*=\s*\[(.*?)\]", src, re.S)
    assert m, f"could not find {name} in the TS source"
    return re.findall(r"'([a-z0-9-]+)'", m.group(1))


def _ts_record(src: str, name: str) -> dict[str, str]:
    m = re.search(rf"{name}[^=]*=\s*\{{(.*?)\n\}}", src, re.S)
    assert m, f"could not find {name} in the TS source"
    return dict(re.findall(r"([A-Za-z0-9_]+):\s*'([^']+)'", m.group(1)))


def test_frontend_and_backend_cover_the_same_platforms():
    src = FRONTEND.read_text()
    fe = _ts_string_array(src, "TROUBLESHOOT_PLATFORMS")
    assert fe, "guard: the TS parser found nothing — a broken regex must fail loudly"
    assert fe == list(pc.COVERED_PLATFORMS)


def test_frontend_and_backend_agree_on_uncovered_labels():
    src = FRONTEND.read_text()
    fe = _ts_record(src, "UNCOVERED_PLATFORM_LABEL")
    assert fe, "guard: the TS parser found nothing"
    for key, label in fe.items():
        assert key in pc.UNCOVERED_PLATFORM_LABEL, f"{key} uncovered in the UI but unknown to the API"
        assert pc.UNCOVERED_PLATFORM_LABEL[key] == label


def test_backend_vendor_map_matches_the_frontend_ztp_map():
    # AG5/AG6: two vendor maps that must agree is the drift this codebase keeps
    # paying for, so VENDOR_NOS is checked against ztpPlatform's vendor arm.
    src = ZTP_TS.read_text()
    pairs = re.findall(r"if \(v === '([^']+)'\) return '([a-z0-9-]+)'", src)
    assert pairs, "guard: the ztp.ts parser found nothing"
    for vendor, nos in pairs:
        assert vendor in pc.VENDOR_NOS, f"{vendor} known to ztpPlatform but not to VENDOR_NOS"
        # ztp.ts spells Cisco IOS-XE 'ios-xe'; the diagnostics vocabulary is 'iosxe'.
        assert pc.VENDOR_NOS[vendor] == nos.replace("-", "")


def test_no_vendor_resolves_to_a_platform_nobody_covers():
    for vendor in pc.VENDOR_NOS:
        plat, _ = pc.best_platform_for_vendor(vendor)
        assert plat in pc.COVERED_PLATFORMS


def test_only_cisco_arista_juniper_are_actually_covered():
    # The measured state, pinned. If a vendor is ever added to the playbooks
    # this fails and the disclosure has to be re-tuned rather than going stale.
    covered = {v for v in pc.VENDOR_NOS if pc.best_platform_for_vendor(v)[1]}
    assert covered == {"Cisco", "Arista", "Juniper"}


# ── 3. The engines' own, wider set ───────────────────────────────────────────

def test_engines_keep_their_sonic_command_sets():
    # Flattening the engine set onto the playbook set would silently drop 36
    # real SONiC command sets from monitor_engine.
    assert "sonic" in pc.ENGINE_PLATFORMS
    assert "sonic" not in pc.COVERED_PLATFORMS
    assert pc.resolve_platform("sonic", pc.ENGINE_PLATFORMS) == ("sonic", True)
    assert pc.resolve_platform("sonic")[1] is False


def test_runbook_commands_are_labelled_with_the_platform_they_are():
    from troubleshoot_engine import resolve_commands
    # Asking for junos against a dict that has none must NOT come back keyed
    # 'junos' holding NX-OS commands.
    actual, cmds = resolve_commands({"nxos": ["show ip bgp summary"]}, "junos")
    assert actual == "nxos"
    assert cmds == ["show ip bgp summary"]
    # And a real hit is labelled with itself.
    assert resolve_commands({"junos": ["show bgp summary"]}, "junos")[0] == "junos"
