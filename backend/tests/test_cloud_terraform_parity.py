"""
Cloud-Terraform parity: the TypeScript mirror must render byte-identical HCL.

`frontend/src/lib/cloud-terraform.ts` was converted mechanically from
`backend/templates/multicloud/*.tf.j2` (the templates carry no control flow,
only variable substitution). A hand-maintained copy would drift; this test
renders both engines with the same context and compares the output exactly.

Two conversion traps this pins, both of which produced a silent mismatch on
the first attempt:
  * Jinja's `tojson` emits `["a", "b", "c"]`; `JSON.stringify` omits the
    spaces after commas.
  * Jinja leaves a newline where the `{# … #}` header was, and another at the
    end of the file.

Skipped when node/npm is unavailable (the Python-only CI lane).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FRONTEND = REPO / "frontend"
sys.path.insert(0, str(BACKEND))

from export.terraform import (  # noqa: E402
    generate_aws_terraform,
    generate_azure_terraform,
    generate_gcp_terraform,
)

CONTEXTS = [
    # (label, python-state, ts-opts, per-provider region)
    (
        "defaults",
        {"org": "NetDesignAI"},
        {"orgName": "NetDesignAI"},
        {"aws": "us-east-1", "azure": "eastus", "gcp": "us-central1"},
    ),
    (
        "full",
        {
            "org": "Acme Corp", "env": "staging", "org_cidr": "172.16.0.0/12",
            "hub_cidr": "172.31.0.0/16", "bgp_asn": 65042,
        },
        {
            "orgName": "Acme Corp", "env": "staging", "orgCidr": "172.16.0.0/12",
            "hubCidr": "172.31.0.0/16", "bgpAsn": 65042,
        },
        {"aws": "eu-west-1", "azure": "westeurope", "gcp": "europe-west1"},
    ),
]

GENERATORS = {
    "aws": generate_aws_terraform,
    "azure": generate_azure_terraform,
    "gcp": generate_gcp_terraform,
}
TS_FN = {
    "aws": "generateAwsTerraform",
    "azure": "generateAzureTerraform",
    "gcp": "generateGcpTerraform",
}

pytestmark = pytest.mark.skipif(
    shutil.which("npx") is None or not (FRONTEND / "node_modules").is_dir(),
    reason="node/npm toolchain unavailable — frontend half cannot be rendered",
)


def _render_typescript(cases):
    """Run the TS generators through vite-node and return their output."""
    imports = ", ".join(sorted(TS_FN.values()))
    calls = ",\n".join(
        f"  {json.dumps(key)}: {TS_FN[prov]}({json.dumps(opts)})"
        for key, prov, opts in cases
    )
    script = (
        f"import {{ {imports} }} from './src/lib/cloud-terraform.ts'\n"
        "import { writeFileSync } from 'node:fs'\n"
        f"writeFileSync(process.argv[2], JSON.stringify({{\n{calls}\n}}))\n"
    )
    with tempfile.TemporaryDirectory() as tmp:
        entry = Path(tmp) / "render.mjs"
        out = Path(tmp) / "out.json"
        entry.write_text(script)
        proc = subprocess.run(
            ["npx", "--yes", "vite-node", str(entry), "--", str(out)],
            cwd=FRONTEND, capture_output=True, text=True, timeout=300,
            env={**os.environ, "CI": "1"},
        )
        if not out.exists():
            pytest.fail(f"vite-node produced no output\nstdout:{proc.stdout}\nstderr:{proc.stderr}")
        return json.loads(out.read_text())


@pytest.fixture(scope="module")
def rendered():
    cases, expected = [], {}
    for label, py_state, ts_opts, regions in CONTEXTS:
        for prov, fn in GENERATORS.items():
            key = f"{label}:{prov}"
            expected[key] = fn({**py_state, "cloud_region": regions[prov]})
            cases.append((key, prov, {**ts_opts, "region": regions[prov]}))
    return expected, _render_typescript(cases)


@pytest.mark.parametrize("label", [c[0] for c in CONTEXTS])
@pytest.mark.parametrize("provider", sorted(GENERATORS))
def test_typescript_matches_python_exactly(rendered, label, provider):
    expected, actual = rendered
    key = f"{label}:{provider}"
    assert key in actual, f"TS engine produced nothing for {key}"
    assert actual[key] == expected[key], (
        f"{key}: the TS mirror has drifted from "
        f"backend/templates/multicloud/{provider}_*.tf.j2"
    )


def test_rendered_output_is_substantial(rendered):
    """Guard the guard — two empty strings would otherwise compare equal."""
    expected, _ = rendered
    for key, hcl in expected.items():
        assert len(hcl) > 1000, f"{key} rendered only {len(hcl)} chars"
        assert "{{" not in hcl and "{%" not in hcl, f"{key} has unrendered Jinja"
