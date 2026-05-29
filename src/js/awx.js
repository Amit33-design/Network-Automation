'use strict';

/* ════════════════════════════════════════════════════════════════
   ANSIBLE TOWER / AWX JOB LAUNCHER
   Generates a downloadable Python script that connects to an
   Ansible Tower or AWX instance, creates an inventory from the
   BOM device list, wires it to a job template, and launches a job.

   Public API (window.*):
     genAWXScript(state)    → string (Python source)
     downloadAWXScript()    → triggers browser download
     renderAWXPanel()       → injects panel into #awx-panel
════════════════════════════════════════════════════════════════ */

/* ── Platform map → Ansible network_os ──────────────────────── */
var _AWX_OS_MAP = {
  'ios-xe': 'cisco.ios.ios',
  'nxos':   'cisco.nxos.nxos',
  'eos':    'arista.eos.eos',
  'junos':  'junipernetworks.junos.junos',
  'sonic':  'community.network.nos.sonic',
};

function _awxDevices() {
  if (typeof buildDeviceList === 'function') return buildDeviceList();
  return [];
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: genAWXScript
═══════════════════════════════════════════════════════════════ */
function genAWXScript(state) {
  var devs    = _awxDevices();
  var orgName = (state && state.orgName) || 'Network';
  var ts      = new Date().toISOString().slice(0, 10);
  var slug    = orgName.replace(/[^A-Za-z0-9_\-]/g, '-');

  /* Build host block for the script */
  var hostLines = [];
  var seen = {};
  (devs || []).forEach(function(dev) {
    var layer = dev.layer || '';
    if (layer.indexOf('mc-') === 0) return;
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text') return;
    var idx  = dev.idx || 0;
    var key  = layer + '-' + idx;
    if (seen[key]) return;
    seen[key] = true;
    var hostname   = dev.hostname || dev.name || ('DEVICE-' + String(idx + 1).padStart(2, '0'));
    var mgmtIP     = '10.0.0.' + (30 + idx);
    var networkOS  = _AWX_OS_MAP[os] || 'cisco.ios.ios';
    hostLines.push('    {');
    hostLines.push('        "name":       "' + hostname + '",');
    hostLines.push('        "ansible_host": "' + mgmtIP + '",');
    hostLines.push('        "network_os": "' + networkOS + '",');
    hostLines.push('        "layer":      "' + layer + '",');
    hostLines.push('    },');
  });

  var hostBlock = hostLines.length
    ? hostLines.join('\n')
    : '    # No devices — complete Steps 1–3 in NetDesign AI first';

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Ansible Tower / AWX Job Launcher',
    'Generated: ' + ts + '  |  Org: ' + orgName,
    '',
    'Creates an AWX inventory from the BOM device list, ties it to',
    'a job template running the NetDesign AI Ansible playbook, and',
    'launches the job.  Requires AWX 21+ / Tower 3.8+.',
    '',
    'Usage:',
    '    pip install requests',
    '    python awx_launch.py',
    '',
    'Env vars:',
    '    AWX_HOST     — AWX/Tower FQDN or IP  (default: awx.corp.com)',
    '    AWX_TOKEN    — Personal access token  (preferred)',
    '    AWX_USER     — Username (used if AWX_TOKEN not set)',
    '    AWX_PASS     — Password (used if AWX_TOKEN not set)',
    '    AWX_ORG      — AWX organization name  (default: Default)',
    '    AWX_VERIFY   — SSL verify (true/false, default: true)',
    '    AWX_PROJECT  — Existing project name for the playbook',
    '    AWX_PLAYBOOK — Playbook file inside the project (e.g. site.yml)',
    '"""',
    '',
    'import os, sys, json, time, urllib3',
    'import requests',
    '',
    '# ── Connection ──────────────────────────────────────────────────',
    'AWX_HOST     = os.getenv("AWX_HOST",     "awx.corp.com")',
    'AWX_TOKEN    = os.getenv("AWX_TOKEN",    "")',
    'AWX_USER     = os.getenv("AWX_USER",     "admin")',
    'AWX_PASS     = os.getenv("AWX_PASS",     "")',
    'AWX_ORG      = os.getenv("AWX_ORG",      "Default")',
    'AWX_VERIFY   = os.getenv("AWX_VERIFY",   "true").lower() != "false"',
    'AWX_PROJECT  = os.getenv("AWX_PROJECT",  "NetDesignAI")',
    'AWX_PLAYBOOK = os.getenv("AWX_PLAYBOOK", "site.yml")',
    '',
    'if not AWX_VERIFY:',
    '    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)',
    '',
    'BASE = f"https://{AWX_HOST}/api/v2"',
    '',
    '# ── BOM Device list ─────────────────────────────────────────────',
    'DEVICES = [',
    hostBlock,
    ']',
    '',
    '# ── Names for created objects ────────────────────────────────────',
    'INVENTORY_NAME    = "NetDesignAI-' + slug + '-' + ts + '"',
    'JOB_TEMPLATE_NAME = "NetDesignAI-' + slug + '-deploy"',
    'CREDENTIAL_NAME   = "NetDesignAI-' + slug + '-ssh"',
    '',
    '# ── SSH credentials (fill in or use an existing AWX credential ID)',
    'SSH_USERNAME = os.getenv("SSH_USER", "netadmin")',
    'SSH_PASSWORD = os.getenv("SSH_PASS", "")   # or use SSH_KEY_PATH',
    'SSH_KEY_PATH = os.getenv("SSH_KEY_PATH", "")  # path to private key file',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# AWX Session',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'class AWXSession:',
    '    def __init__(self):',
    '        self.s = requests.Session()',
    '        self.s.verify = AWX_VERIFY',
    '        self.s.headers["Content-Type"] = "application/json"',
    '',
    '    def auth(self):',
    '        if AWX_TOKEN:',
    '            self.s.headers["Authorization"] = f"Bearer {AWX_TOKEN}"',
    '            print(f"[OK] Using Bearer token on {AWX_HOST}")',
    '        elif AWX_USER and AWX_PASS:',
    '            # Exchange credentials for a session token',
    '            r = self.s.post(f"{BASE}/tokens/",',
    '                            auth=(AWX_USER, AWX_PASS),',
    '                            json={"description": "NetDesignAI session", "application": None, "scope": "write"})',
    '            r.raise_for_status()',
    '            token = r.json()["token"]',
    '            self.s.headers["Authorization"] = f"Bearer {token}"',
    '            print(f"[OK] Authenticated as {AWX_USER} on {AWX_HOST}")',
    '        else:',
    '            print("[ERROR] Set AWX_TOKEN or (AWX_USER + AWX_PASS)")',
    '            sys.exit(1)',
    '',
    '    def get(self, path, **kw): return self.s.get(f"{BASE}{path}", **kw)',
    '    def post(self, path, body=None, **kw): return self.s.post(f"{BASE}{path}", json=body or {}, **kw)',
    '    def patch(self, path, body=None, **kw): return self.s.patch(f"{BASE}{path}", json=body or {}, **kw)',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Helpers: get-or-create pattern',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def _find(session: AWXSession, path: str, name: str) -> int | None:',
    '    """Return id of first object with matching name, or None."""',
    '    r = session.get(f"{path}?name={requests.utils.quote(name)}")',
    '    r.raise_for_status()',
    '    results = r.json().get("results", [])',
    '    return results[0]["id"] if results else None',
    '',
    '',
    'def _get_org_id(session: AWXSession) -> int:',
    '    oid = _find(session, "/organizations/", AWX_ORG)',
    '    if not oid:',
    '        raise RuntimeError(f"AWX organization {AWX_ORG!r} not found. Check AWX_ORG.")',
    '    return oid',
    '',
    '',
    'def _get_project_id(session: AWXSession, org_id: int) -> int:',
    '    pid = _find(session, "/projects/", AWX_PROJECT)',
    '    if not pid:',
    '        print(f"[WARN] Project {AWX_PROJECT!r} not found in AWX.")',
    '        print("       Create it manually in AWX → Projects, pointing to the")',
    '        print("       Git repo containing your NetDesignAI site.yml playbook.")',
    '        sys.exit(1)',
    '    return pid',
    '',
    '',
    'def get_or_create_inventory(session: AWXSession, org_id: int) -> int:',
    '    existing = _find(session, "/inventories/", INVENTORY_NAME)',
    '    if existing:',
    '        print(f"[OK] Reusing inventory {INVENTORY_NAME!r} (id={existing})")',
    '        return existing',
    '    r = session.post("/inventories/", {',
    '        "name":         INVENTORY_NAME,',
    '        "description":  "NetDesign AI BOM — auto-created",',
    '        "organization": org_id,',
    '    })',
    '    r.raise_for_status()',
    '    inv_id = r.json()["id"]',
    '    print(f"[OK] Created inventory {INVENTORY_NAME!r} (id={inv_id})")',
    '    return inv_id',
    '',
    '',
    'def populate_inventory(session: AWXSession, inv_id: int) -> None:',
    '    """Add all BOM devices as hosts in the inventory."""',
    '    # Group by platform for ansible_network_os',
    '    groups: dict[str, int] = {}',
    '    for dev in DEVICES:',
    '        nos = dev["network_os"]',
    '        gname = nos.replace(".", "_")',
    '        if gname not in groups:',
    '            existing = _find(session, "/groups/", gname)',
    '            if existing:',
    '                groups[gname] = existing',
    '            else:',
    '                r = session.post("/groups/", {',
    '                    "name":       gname,',
    '                    "inventory":  inv_id,',
    '                    "variables":  json.dumps({"ansible_network_os": nos,',
    '                                              "ansible_connection": "network_cli"}),',
    '                })',
    '                r.raise_for_status()',
    '                groups[gname] = r.json()["id"]',
    '',
    '        existing_host = _find(session, "/hosts/", dev["name"])',
    '        if existing_host:',
    '            host_id = existing_host',
    '        else:',
    '            r = session.post("/hosts/", {',
    '                "name":      dev["name"],',
    '                "inventory": inv_id,',
    '                "variables": json.dumps({',
    '                    "ansible_host":       dev["ansible_host"],',
    '                    "ansible_network_os": dev["network_os"],',
    '                    "ansible_connection": "network_cli",',
    '                    "ansible_user":       SSH_USERNAME,',
    '                    "ansible_password":   SSH_PASSWORD,',
    '                    "layer":              dev["layer"],',
    '                }),',
    '            })',
    '            r.raise_for_status()',
    '            host_id = r.json()["id"]',
    '',
    '        # Add host to its platform group',
    '        session.post(f"/groups/{groups[gname]}/hosts/", {"id": host_id})',
    '',
    '    print(f"[OK] Populated inventory with {len(DEVICES)} hosts")',
    '',
    '',
    'def get_or_create_credential(session: AWXSession, org_id: int) -> int:',
    '    """Get or create an SSH Machine credential for device login."""',
    '    existing = _find(session, "/credentials/", CREDENTIAL_NAME)',
    '    if existing:',
    '        print(f"[OK] Reusing credential {CREDENTIAL_NAME!r} (id={existing})")',
    '        return existing',
    '    cred_type_r = session.get("/credential_types/?name=Machine")',
    '    cred_type_r.raise_for_status()',
    '    ct_results = cred_type_r.json().get("results", [])',
    '    ct_id = ct_results[0]["id"] if ct_results else 1',
    '    body: dict = {',
    '        "name":             CREDENTIAL_NAME,',
    '        "credential_type":  ct_id,',
    '        "organization":     org_id,',
    '        "inputs": {',
    '            "username": SSH_USERNAME,',
    '        },',
    '    }',
    '    if SSH_KEY_PATH:',
    '        with open(SSH_KEY_PATH) as f:',
    '            body["inputs"]["ssh_key_data"] = f.read()',
    '    elif SSH_PASSWORD:',
    '        body["inputs"]["password"] = SSH_PASSWORD',
    '    r = session.post("/credentials/", body)',
    '    r.raise_for_status()',
    '    cred_id = r.json()["id"]',
    '    print(f"[OK] Created credential {CREDENTIAL_NAME!r} (id={cred_id})")',
    '    return cred_id',
    '',
    '',
    'def get_or_create_job_template(session: AWXSession, inv_id: int,',
    '                               proj_id: int, cred_id: int) -> int:',
    '    existing = _find(session, "/job_templates/", JOB_TEMPLATE_NAME)',
    '    if existing:',
    '        print(f"[OK] Reusing job template {JOB_TEMPLATE_NAME!r} (id={existing})")',
    '        # Update inventory pointer in case it changed',
    '        session.patch(f"/job_templates/{existing}/", {"inventory": inv_id})',
    '        return existing',
    '    r = session.post("/job_templates/", {',
    '        "name":                JOB_TEMPLATE_NAME,',
    '        "job_type":            "run",',
    '        "inventory":           inv_id,',
    '        "project":             proj_id,',
    '        "playbook":            AWX_PLAYBOOK,',
    '        "ask_variables_on_launch": False,',
    '        "ask_limit_on_launch":     True,',
    '        "verbosity":           1,',
    '        "description":         "NetDesign AI — push configs to network devices",',
    '    })',
    '    r.raise_for_status()',
    '    jt_id = r.json()["id"]',
    '    # Attach credential',
    '    session.post(f"/job_templates/{jt_id}/credentials/", {"id": cred_id})',
    '    print(f"[OK] Created job template {JOB_TEMPLATE_NAME!r} (id={jt_id})")',
    '    return jt_id',
    '',
    '',
    'def launch_job(session: AWXSession, jt_id: int) -> int:',
    '    r = session.post(f"/job_templates/{jt_id}/launch/", {})',
    '    r.raise_for_status()',
    '    job_id = r.json()["id"]',
    '    print(f"[OK] Job launched — id={job_id}")',
    '    return job_id',
    '',
    '',
    'def poll_job(session: AWXSession, job_id: int, timeout: int = 900) -> str:',
    '    """Poll until job finishes; return final status string."""',
    '    deadline = time.time() + timeout',
    '    last_status = "pending"',
    '    while time.time() < deadline:',
    '        r = session.get(f"/jobs/{job_id}/")',
    '        r.raise_for_status()',
    '        data = r.json()',
    '        status = data.get("status", "pending")',
    '        if status != last_status:',
    '            print(f"  … job {job_id} status: {status}")',
    '            last_status = status',
    '        if status in ("successful", "failed", "error", "canceled"):',
    '            return status',
    '        time.sleep(5)',
    '    return "timeout"',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Main',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def main():',
    '    print("=" * 62)',
    '    print(" NetDesign AI — Ansible Tower / AWX Job Launcher")',
    '    print(f" Target: https://{AWX_HOST}")',
    '    print("=" * 62)',
    '',
    '    if not DEVICES:',
    '        print("[ERROR] No devices in inventory. Complete Steps 1–3 first.")',
    '        sys.exit(1)',
    '',
    '    session = AWXSession()',
    '    session.auth()',
    '',
    '    org_id  = _get_org_id(session)',
    '    proj_id = _get_project_id(session, org_id)',
    '',
    '    inv_id  = get_or_create_inventory(session, org_id)',
    '    populate_inventory(session, inv_id)',
    '',
    '    cred_id = get_or_create_credential(session, org_id)',
    '    jt_id   = get_or_create_job_template(session, inv_id, proj_id, cred_id)',
    '',
    '    print(f"[-->] Launching job template {JOB_TEMPLATE_NAME!r}…")',
    '    job_id = launch_job(session, jt_id)',
    '',
    '    print(f"[-->] Job URL: https://{AWX_HOST}/#/jobs/playbook/{job_id}")',
    '    final = poll_job(session, job_id)',
    '',
    '    print()',
    '    print("=" * 62)',
    '    icon = "[OK]" if final == "successful" else "[FAIL]"',
    '    print(f" {icon} Job {job_id} finished with status: {final.upper()}")',
    '    print("=" * 62)',
    '',
    '    out = f"awx_job_{job_id}_{final}.json"',
    '    r = session.get(f"/jobs/{job_id}/")',
    '    with open(out, "w") as f:',
    '        json.dump(r.json(), f, indent=2)',
    '    print(f"[OK] Job details saved → {out}")',
    '',
    '    sys.exit(0 if final == "successful" else 1)',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}
window.genAWXScript = genAWXScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: downloadAWXScript
═══════════════════════════════════════════════════════════════ */
function downloadAWXScript() {
  var src  = genAWXScript(typeof STATE !== 'undefined' ? STATE : {});
  var slug = ((typeof STATE !== 'undefined' && STATE.orgName) || 'network')
    .replace(/\s+/g, '_').toLowerCase();
  var name = slug + '_awx_launch.py';
  var blob = new Blob([src], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  if (typeof toast === 'function') toast('AWX launch script downloaded', 'success');
}
window.downloadAWXScript = downloadAWXScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderAWXPanel
   Injects a card into #awx-panel
═══════════════════════════════════════════════════════════════ */
function renderAWXPanel() {
  var container = document.getElementById('awx-panel');
  if (!container) return;

  container.innerHTML = [
    '<div class="checks-panel-inner">',
    '  <div class="checks-panel-header">',
    '    <div class="checks-panel-icon">🤖</div>',
    '    <div>',
    '      <div style="font-size:.9rem;font-weight:700;color:var(--txt0)">Ansible Tower / AWX Job Launcher</div>',
    '      <div class="checks-panel-sub">Create AWX inventory from BOM, wire to a job template, and launch a deployment job.</div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-body">',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">awx_launch.py</div>',
    '      <div class="checks-card-desc">',
    '        Authenticates with AWX/Tower (Bearer token or user+pass), creates an',
    '        inventory from BOM devices, adds platform groups, attaches SSH credentials,',
    '        creates/reuses a job template, launches it, and polls until done.',
    '        Results saved to <code>awx_job_&lt;id&gt;_&lt;status&gt;.json</code>.',
    '      </div>',
    '      <button class="btn-action checks-dl-btn" onclick="downloadAWXScript()">⬇ awx_launch.py</button>',
    '    </div>',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">How to run</div>',
    '      <div class="checks-card-desc">',
    '        1. Install: <code>pip install requests</code><br>',
    '        2. In AWX: create a Project pointing to your NetDesignAI git repo<br>',
    '        3. Set: <code>export AWX_HOST=awx.corp.com</code><br>',
    '        4. Set: <code>export AWX_TOKEN=your-personal-access-token</code><br>',
    '        5. Set: <code>export AWX_PROJECT=NetDesignAI</code><br>',
    '        6. Run: <code>python awx_launch.py</code>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-usage">',
    '    <strong>API:</strong> AWX 21+ / Ansible Tower 3.8+ &nbsp;|&nbsp;',
    '    <strong>Auth:</strong> <code>Bearer token</code> via <code>/api/v2/tokens/</code> &nbsp;|&nbsp;',
    '    <strong>Project:</strong> set <code>AWX_PROJECT</code> to the name of your playbook project in AWX',
    '  </div>',
    '</div>',
  ].join('\n');
}
window.renderAWXPanel = renderAWXPanel;
