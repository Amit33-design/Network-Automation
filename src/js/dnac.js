'use strict';

/* ════════════════════════════════════════════════════════════════
   DNAC / CATALYST CENTER CONFIG PUSH
   Generates a downloadable Python script that authenticates with
   Cisco DNA Center (Catalyst Center) and pushes generated device
   configurations via the Intent API Template Programmer.

   Public API (window.*):
     genDNACPushScript(state)    → string (Python source)
     downloadDNACScript()        → triggers browser download
     renderDNACPanel()           → injects panel into #dnac-panel
════════════════════════════════════════════════════════════════ */

/* ── Build device inventory from STATE ───────────────────────── */
function _dnacDevices(state) {
  if (typeof buildDeviceList === 'function') return buildDeviceList();
  return [];
}

/* ── Map layer/os to DNAC family string ──────────────────────── */
function _dnacFamily(os) {
  var map = {
    'ios-xe': 'Switches and Hubs',
    'nxos':   'Switches and Hubs',
    'eos':    'Switches and Hubs',
    'junos':  'Routers',
    'sonic':  'Switches and Hubs',
  };
  return map[os] || 'Switches and Hubs';
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: genDNACPushScript
═══════════════════════════════════════════════════════════════ */
function genDNACPushScript(state) {
  var devs = _dnacDevices(state);
  var orgName = (state && state.orgName) || 'Network';
  var ts      = new Date().toISOString().slice(0, 10);

  /* Build inventory list for the script */
  var invLines = [];
  var seen = {};
  (devs || []).forEach(function(dev) {
    var layer = dev.layer || '';
    if (layer.indexOf('mc-') === 0) return;
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text') return;
    var idx      = dev.idx || 0;
    var ipKey    = layer + '-' + idx;
    if (seen[ipKey]) return;
    seen[ipKey]  = true;
    var hostname = (dev.hostname || dev.name || ('DEVICE-' + String(idx + 1).padStart(2, '0')));
    var mgmtIP   = '10.0.0.' + (30 + idx);
    invLines.push('    {"hostname": "' + hostname + '", "mgmt_ip": "' + mgmtIP + '", "layer": "' + layer + '", "os": "' + os + '"},');
  });

  var invBlock = invLines.length
    ? invLines.join('\n')
    : '    # No devices — complete Steps 1–3 in NetDesign AI first';

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Cisco DNA Center / Catalyst Center Config Push',
    'Generated: ' + ts + '  |  Org: ' + orgName,
    '',
    'Pushes generated device configs to DNAC via the Intent API',
    'Template Programmer.  Requires DNAC 2.2+ / Catalyst Center 2.3+.',
    '',
    'Usage:',
    '    pip install requests urllib3',
    '    python dnac_push.py',
    '',
    'Env vars (override defaults):',
    '    DNAC_HOST   — DNAC/CC FQDN or IP (default: dnac.corp.com)',
    '    DNAC_USER   — username           (default: admin)',
    '    DNAC_PASS   — password           (required)',
    '    DNAC_VERIFY — SSL verify (true/false, default: true)',
    '"""',
    '',
    'import os, sys, json, time, urllib3',
    'import requests',
    '',
    '# ── Connection settings ────────────────────────────────────────',
    'DNAC_HOST   = os.getenv("DNAC_HOST",   "dnac.corp.com")',
    'DNAC_USER   = os.getenv("DNAC_USER",   "admin")',
    'DNAC_PASS   = os.getenv("DNAC_PASS",   "")',
    'DNAC_VERIFY = os.getenv("DNAC_VERIFY", "true").lower() != "false"',
    '',
    'if not DNAC_VERIFY:',
    '    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)',
    '',
    'BASE_URL = f"https://{DNAC_HOST}"',
    '',
    '# ── Device inventory (generated from NetDesign AI BOM) ─────────',
    'DEVICES = [',
    invBlock,
    ']',
    '',
    '# ── Configs per hostname (paste generated output from Step 5) ──',
    '# Keys must match the "hostname" field in DEVICES above.',
    '# You can also load these from files: configs = {h: open(f"{h}.cfg").read() ...}',
    'CONFIGS: dict[str, str] = {',
    '    # "NYC-LEAF-A01-01": """',
    '    # ! paste config here',
    '    # """,',
    '}',
    '',
    '# ── DNAC project name for templates ────────────────────────────',
    'PROJECT_NAME = "NetDesignAI-' + orgName.replace(/[^A-Za-z0-9_\-]/g, '-') + '-' + ts + '"',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Auth',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'class DNACSession:',
    '    def __init__(self):',
    '        self.s = requests.Session()',
    '        self.s.verify = DNAC_VERIFY',
    '        self.token = ""',
    '',
    '    def auth(self):',
    '        if not DNAC_PASS:',
    '            print("[ERROR] Set DNAC_PASS env var before running.")',
    '            sys.exit(1)',
    '        r = self.s.post(',
    '            f"{BASE_URL}/dna/system/api/v1/auth/token",',
    '            auth=(DNAC_USER, DNAC_PASS),',
    '            headers={"Content-Type": "application/json"},',
    '        )',
    '        r.raise_for_status()',
    '        self.token = r.json()["Token"]',
    '        self.s.headers.update({"x-auth-token": self.token, "Content-Type": "application/json"})',
    '        print(f"[OK] Authenticated as {DNAC_USER} on {DNAC_HOST}")',
    '',
    '    def get(self, path, **kw):',
    '        return self.s.get(f"{BASE_URL}{path}", **kw)',
    '',
    '    def post(self, path, body=None, **kw):',
    '        return self.s.post(f"{BASE_URL}{path}", json=body, **kw)',
    '',
    '    def put(self, path, body=None, **kw):',
    '        return self.s.put(f"{BASE_URL}{path}", json=body, **kw)',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Device lookup — map hostname → DNAC device ID',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def get_device_map(session: DNACSession) -> dict[str, str]:',
    '    """Return {hostname: device_id} for all devices in DNAC inventory."""',
    '    r = session.get("/dna/intent/api/v1/network-device")',
    '    r.raise_for_status()',
    '    devices = r.json().get("response", [])',
    '    dm: dict[str, str] = {}',
    '    for d in devices:',
    '        h = (d.get("hostname") or "").lower()',
    '        if h:',
    '            dm[h] = d["id"]',
    '        # also index by mgmt IP',
    '        ip = d.get("managementIpAddress", "")',
    '        if ip:',
    '            dm[ip] = d["id"]',
    '    print(f"[OK] DNAC inventory: {len(devices)} devices")',
    '    return dm',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Template Programmer helpers',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def get_or_create_project(session: DNACSession) -> str:',
    '    """Return project ID, creating it if it doesn\'t exist."""',
    '    r = session.get(f"/dna/intent/api/v1/template-programmer/project?name={PROJECT_NAME}")',
    '    r.raise_for_status()',
    '    existing = r.json()',
    '    if existing:',
    '        pid = existing[0]["id"]',
    '        print(f"[OK] Using existing project {PROJECT_NAME!r} (id={pid[:8]}…)")',
    '        return pid',
    '    r2 = session.post("/dna/intent/api/v1/template-programmer/project",',
    '                      {"name": PROJECT_NAME, "description": "NetDesign AI generated configs"})',
    '    r2.raise_for_status()',
    '    pid = r2.json()["response"]["taskId"]  # task returns taskId; poll for project ID',
    '    project_id = _poll_task_for_id(session, pid)',
    '    print(f"[OK] Created project {PROJECT_NAME!r}")',
    '    return project_id',
    '',
    '',
    'def create_template(session: DNACSession, project_id: str,',
    '                    name: str, config: str, device_types: list) -> str:',
    '    """Create a CLI template in the project; return template ID."""',
    '    body = {',
    '        "name":        name,',
    '        "description": f"NetDesign AI — {name}",',
    '        "projectId":   project_id,',
    '        "templateContent": config,',
    '        "language":    "JINJA",',
    '        "deviceTypes": device_types,',
    '        "softwareType": "IOS-XE",',
    '        "templateParams": [],',
    '    }',
    '    r = session.post("/dna/intent/api/v1/template-programmer/template", body)',
    '    r.raise_for_status()',
    '    task_id = r.json()["response"]["taskId"]',
    '    return _poll_task_for_id(session, task_id)',
    '',
    '',
    'def commit_template(session: DNACSession, template_id: str) -> None:',
    '    """Commit (version) a template so it can be deployed."""',
    '    r = session.post("/dna/intent/api/v1/template-programmer/template/version",',
    '                     {"templateId": template_id, "comments": "NetDesign AI auto-commit"})',
    '    r.raise_for_status()',
    '    _poll_task(session, r.json()["response"]["taskId"])',
    '',
    '',
    'def deploy_template(session: DNACSession, template_id: str, device_id: str) -> str:',
    '    """Deploy versioned template to a device; return deployment ID."""',
    '    body = {',
    '        "forcePushTemplate": False,',
    '        "isComposite":       False,',
    '        "targetInfo": [{',
    '            "id":   device_id,',
    '            "type": "MANAGED_DEVICE_UUID",',
    '            "params": {},',
    '        }],',
    '        "templateId": template_id,',
    '    }',
    '    r = session.post("/dna/intent/api/v1/template-programmer/template/deploy", body)',
    '    r.raise_for_status()',
    '    return r.json()["deploymentId"]',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Task polling helpers',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def _poll_task(session: DNACSession, task_id: str, timeout: int = 60) -> dict:',
    '    """Poll until task completes; raise on failure."""',
    '    deadline = time.time() + timeout',
    '    while time.time() < deadline:',
    '        r = session.get(f"/dna/intent/api/v1/task/{task_id}")',
    '        r.raise_for_status()',
    '        data = r.json().get("response", {})',
    '        if data.get("isError"):',
    '            raise RuntimeError(f"Task {task_id} failed: {data.get(\'failureReason\', data)}")',
    '        if data.get("endTime"):',
    '            return data',
    '        time.sleep(2)',
    '    raise TimeoutError(f"Task {task_id} timed out after {timeout}s")',
    '',
    '',
    'def _poll_task_for_id(session: DNACSession, task_id: str) -> str:',
    '    """Poll task and return the entity ID from the progress field."""',
    '    data = _poll_task(session, task_id)',
    '    # DNAC returns the created entity ID in the "data" or "progress" field',
    '    return data.get("data") or data.get("progress") or ""',
    '',
    '',
    'def check_deployment_status(session: DNACSession, deployment_id: str) -> str:',
    '    """Return final deployment status string."""',
    '    deadline = time.time() + 120',
    '    while time.time() < deadline:',
    '        r = session.get(f"/dna/intent/api/v1/template-programmer/template/deploy/status/{deployment_id}")',
    '        r.raise_for_status()',
    '        data = r.json()',
    '        status = data.get("status", "INIT")',
    '        if status in ("SUCCESS", "FAILURE"):',
    '            return status',
    '        time.sleep(3)',
    '    return "TIMEOUT"',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Main',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def main():',
    '    print("=" * 60)',
    '    print(f" NetDesign AI — DNAC / Catalyst Center Config Push")',
    '    print(f" Target: {BASE_URL}")',
    '    print("=" * 60)',
    '',
    '    if not CONFIGS:',
    '        print("[WARN] CONFIGS dict is empty.")',
    '        print("       Paste your Step 5 generated configs into the",',
    '              "CONFIGS dict above, keyed by hostname.")',
    '        sys.exit(1)',
    '',
    '    session = DNACSession()',
    '    session.auth()',
    '',
    '    # Build hostname → device-id map from DNAC inventory',
    '    device_map = get_device_map(session)',
    '',
    '    # Get or create template project',
    '    project_id = get_or_create_project(session)',
    '',
    '    results = []',
    '    for hostname, config_text in CONFIGS.items():',
    '        device_id = device_map.get(hostname.lower())',
    '        if not device_id:',
    '            print(f"[SKIP] {hostname!r} not found in DNAC inventory")',
    '            results.append({"hostname": hostname, "status": "NOT_IN_DNAC"})',
    '            continue',
    '',
    '        print(f"[-->] Deploying config to {hostname} (id={device_id[:8]}…) …", end="", flush=True)',
    '        try:',
    '            tpl_name  = f"netdesignai-{hostname}-{ts}"'.replace('${ts}', ts),
    '            tpl_types = [{"productFamily": "Switches and Hubs"}]',
    '            tpl_id    = create_template(session, project_id, tpl_name, config_text, tpl_types)',
    '            commit_template(session, tpl_id)',
    '            dep_id    = deploy_template(session, tpl_id, device_id)',
    '            status    = check_deployment_status(session, dep_id)',
    '            icon      = "[OK]" if status == "SUCCESS" else "[FAIL]"',
    '            print(f" {icon} {status}")',
    '            results.append({"hostname": hostname, "status": status, "deployment_id": dep_id})',
    '        except Exception as exc:',
    '            print(f" [ERR] {exc}")',
    '            results.append({"hostname": hostname, "status": "ERROR", "error": str(exc)})',
    '',
    '    # Summary',
    '    print()',
    '    print("=" * 60)',
    '    ok    = sum(1 for r in results if r["status"] == "SUCCESS")',
    '    skip  = sum(1 for r in results if r["status"] == "NOT_IN_DNAC")',
    '    fail  = sum(1 for r in results if r["status"] in ("ERROR", "FAILURE", "TIMEOUT"))',
    '    print(f" Deployed: {ok}/{len(results)}  Skipped: {skip}  Failed: {fail}")',
    '    print("=" * 60)',
    '',
    '    out = f"dnac_results_{ts}.json"'.replace('${ts}', ts),
    '    with open(out, "w") as f:',
    '        json.dump(results, f, indent=2)',
    '    print(f"[OK] Results saved → {out}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}
window.genDNACPushScript = genDNACPushScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: downloadDNACScript
═══════════════════════════════════════════════════════════════ */
function downloadDNACScript() {
  var src  = genDNACPushScript(STATE);
  var slug = ((STATE && STATE.orgName) || 'network').replace(/\s+/g, '_').toLowerCase();
  var name = slug + '_dnac_push.py';
  var blob = new Blob([src], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  if (typeof toast === 'function') toast('DNAC push script downloaded', 'success');
}
window.downloadDNACScript = downloadDNACScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderDNACPanel
   Injects a card into #dnac-panel
═══════════════════════════════════════════════════════════════ */
function renderDNACPanel() {
  var container = document.getElementById('dnac-panel');
  if (!container) return;

  container.innerHTML = [
    '<div class="checks-panel-inner">',
    '  <div class="checks-panel-header">',
    '    <div class="checks-panel-icon">🏛️</div>',
    '    <div>',
    '      <div style="font-size:.9rem;font-weight:700;color:var(--txt0)">Cisco DNA Center / Catalyst Center Push</div>',
    '      <div class="checks-panel-sub">Push generated configs to DNAC via Intent API Template Programmer.</div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-body">',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">dnac_push.py</div>',
    '      <div class="checks-card-desc">',
    '        Authenticates with DNAC/Catalyst Center, looks up BOM devices in the',
    '        DNAC inventory by hostname, creates per-device CLI templates in a',
    '        versioned project, deploys them, and polls for status.',
    '        Results saved to <code>dnac_results_YYYY-MM-DD.json</code>.',
    '      </div>',
    '      <button class="btn-action checks-dl-btn" onclick="downloadDNACScript()">⬇ dnac_push.py</button>',
    '    </div>',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">How to run</div>',
    '      <div class="checks-card-desc">',
    '        1. Install: <code>pip install requests</code><br>',
    '        2. Set: <code>export DNAC_HOST=dnac.corp.com</code><br>',
    '        3. Set: <code>export DNAC_PASS=your-password</code><br>',
    '        4. Paste Step 5 configs into the <code>CONFIGS</code> dict<br>',
    '        5. Run: <code>python dnac_push.py</code>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-usage">',
    '    <strong>API:</strong> DNAC 2.2+ / Catalyst Center 2.3+ &nbsp;|&nbsp;',
    '    <strong>Auth:</strong> <code>x-auth-token</code> via <code>/dna/system/api/v1/auth/token</code> &nbsp;|&nbsp;',
    '    <strong>SSL:</strong> set <code>DNAC_VERIFY=false</code> if using a self-signed cert',
    '  </div>',
    '</div>',
  ].join('\n');
}
window.renderDNACPanel = renderDNACPanel;
