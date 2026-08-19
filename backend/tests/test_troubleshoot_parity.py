"""
Frontend/backend troubleshooting parity.

Five engines exist on both sides of this codebase and are required to agree.
Nothing verified that they did, and troubleshooting had drifted badly: group O1
added 12 playbooks to the frontend only, so `POST /api/troubleshoot` fell
through to GENERIC_PLAYBOOK for all of them. Live mode returned a materially
worse answer than demo mode — the opposite of the intent.

This test reads the TSX source directly. That is deliberate: a cross-language
parity check has to compare the two real sources of truth, and the alternative
(trusting a hand-maintained list) is the thing that broke.

NOTE ON THE KEY REGEX: symptom keys contain digits (`pfc_rocev2`). A
`[a-z_]+` class silently skips those keys and manufactures a phantom
"backend-only" gap. Keep the digit in the class.
"""
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import troubleshoot as t

TSX = BACKEND.parent / "frontend" / "src" / "pages" / "Step6Deploy.tsx"
KEY = r"[a-z0-9_]+"


def _balanced_block(src: str, decl: str) -> str:
    """Return the `{...}` / `[...]` literal that follows a const declaration."""
    m = re.search(r"const %s[^=]*=\s*[\[{]" % re.escape(decl), src)
    assert m, f"{decl} not found in {TSX.name}"
    i = m.end() - 1
    opener = src[i]
    closer = "]" if opener == "[" else "}"
    depth = 0
    for j in range(i, len(src)):
        if src[j] == opener:
            depth += 1
        elif src[j] == closer:
            depth -= 1
            if depth == 0:
                return src[i : j + 1]
    raise AssertionError(f"unbalanced {decl}")


@pytest.fixture(scope="module")
def frontend():
    assert TSX.exists(), f"frontend source not found at {TSX}"
    src = TSX.read_text()
    return {
        "symptoms": set(
            re.findall(r"\bkey:\s*'(%s)'" % KEY, _balanced_block(src, "TROUBLESHOOT_SYMPTOMS"))
        ),
        "playbooks": set(
            re.findall(r"^  (%s):\s*\{" % KEY, _balanced_block(src, "TROUBLESHOOT_PLAYBOOKS"), re.M)
        ),
    }


def test_extraction_actually_found_something(frontend):
    """Guard the guard: a broken regex must fail loudly, not pass vacuously."""
    assert len(frontend["playbooks"]) >= 20
    assert len(frontend["symptoms"]) >= 20
    assert "pfc_rocev2" in frontend["playbooks"], (
        "the key regex dropped a key containing a digit — see the module docstring"
    )


def test_every_frontend_playbook_exists_in_the_backend(frontend):
    missing = sorted(frontend["playbooks"] - set(t.PLAYBOOKS))
    assert not missing, (
        f"{len(missing)} playbook(s) exist only in the frontend, so /api/troubleshoot "
        f"silently degrades to the generic playbook in live mode: {missing}"
    )


def test_every_backend_playbook_is_reachable_from_the_frontend(frontend):
    extra = sorted(set(t.PLAYBOOKS) - frontend["playbooks"])
    assert not extra, f"backend playbooks the UI can never request: {extra}"


def test_every_offered_symptom_has_a_playbook_on_both_sides(frontend):
    """A dropdown entry with no playbook is a dead option in the UI."""
    assert not frontend["symptoms"] - frontend["playbooks"]
    assert not frontend["symptoms"] - set(t.PLAYBOOKS)


@pytest.mark.parametrize("platform", ["nxos", "iosxe", "eos", "junos"])
def test_every_playbook_renders_on_every_platform(platform):
    """A ported playbook missing one platform's command would render a blank step."""
    for symptom in t.PLAYBOOKS:
        result = t.build_troubleshooting(symptom=symptom, platform=platform)
        assert result["diagnostic_steps"], f"{symptom}/{platform}: no steps"
        for step in result["diagnostic_steps"]:
            assert step["command"].strip(), f"{symptom}/{platform}: empty command"
            assert step["look_for"].strip(), f"{symptom}/{platform}: empty look_for"
        assert result["likely_causes"], f"{symptom}: no causes"
        assert result["remediation"], f"{symptom}: no remediation"


def test_ported_playbooks_are_not_the_generic_fallback():
    """The 12 O1 playbooks must return real content, not GENERIC_PLAYBOOK."""
    ported = [
        "stp_loop", "dhcp_failure", "mtu_blackhole", "aaa_auth_failure",
        "hsrp_vrrp", "mac_flap", "vpc_mlag", "ntp_sync",
        "hardware_failure", "memory_exhaustion", "routing_loop", "isis_adjacency",
    ]
    generic = t.build_troubleshooting(symptom="something_nobody_defined", platform="nxos")
    for symptom in ported:
        got = t.build_troubleshooting(symptom=symptom, platform="nxos")
        assert got["summary"] != generic["summary"], f"{symptom} still falls through to generic"
        assert got["category"], f"{symptom} has no category"
