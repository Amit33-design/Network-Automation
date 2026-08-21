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


# ── AB4: structural content parity ──────────────────────────────────────────
# The 11 playbooks that pre-dated AB1 were written independently on each side.
# Measuring the divergence found it is almost entirely COSMETIC: `ospf_adjacency`
# and `pfc_rocev2`, for example, cover the same four topics in different words
# with slightly different `show` commands. A command-level diff reported 26
# "backend-only steps" that were mostly the same topics re-worded — merging them
# would have produced 26 near-duplicate steps, which is worse than the drift.
#
# Only `bgp_down` had genuinely extra topics (BFD state, route-map policy);
# those were added to the frontend and re-transcribed. What is worth enforcing
# from here is STRUCTURAL parity — same number of steps and causes, so a real
# divergence in coverage is caught while wording is left free.

def _fe_playbook_shape(src: str, key: str):
    import re
    m = re.search(r'\n  %s:\s*\{' % re.escape(key), src)
    if not m:
        return None
    i, d = m.end() - 1, 0
    for j in range(i, len(src)):
        if src[j] == '{':
            d += 1
        elif src[j] == '}':
            d -= 1
            if d == 0:
                break
    block = src[i:j + 1]
    return {
        "steps": len(re.findall(r'order:\s*\d+', block)),
        "causes": len(re.findall(r"cause:\s*'", block)),
    }


@pytest.fixture(scope="module")
def tsx_source():
    return TSX.read_text()


def test_both_sides_cover_the_same_number_of_steps(tsx_source):
    mismatched = []
    for key, be in t.PLAYBOOKS.items():
        fe = _fe_playbook_shape(tsx_source, key)
        if fe is None:
            continue
        if fe["steps"] != len(be["steps"]):
            mismatched.append(f"{key}: frontend {fe['steps']} vs backend {len(be['steps'])}")
    assert not mismatched, (
        "playbooks cover a different number of diagnostic steps per side — one "
        "engine is giving the operator less than the other:\n  "
        + "\n  ".join(mismatched)
    )


def test_both_sides_rank_the_same_number_of_causes(tsx_source):
    mismatched = []
    for key, be in t.PLAYBOOKS.items():
        fe = _fe_playbook_shape(tsx_source, key)
        if fe is None:
            continue
        if fe["causes"] != len(be["causes"]):
            mismatched.append(f"{key}: frontend {fe['causes']} vs backend {len(be['causes'])}")
    assert not mismatched, "likely-cause lists differ in length:\n  " + "\n  ".join(mismatched)


def test_bgp_down_carries_the_steps_that_were_only_on_one_side():
    """BFD and route-map policy were backend-only; the MTU check frontend-only."""
    descs = " ".join(s["description"].lower() for s in t.PLAYBOOKS["bgp_down"]["steps"])
    for topic in ("bfd", "route-map", "mtu"):
        assert topic in descs, f"bgp_down lost the {topic} step during convergence"
