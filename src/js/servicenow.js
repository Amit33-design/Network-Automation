'use strict';

/* ════════════════════════════════════════════════════════════════
   SERVICENOW CMDB PUSH
   Generates a downloadable Python script that pushes the BOM
   device list + topology into ServiceNow CMDB using the Table API
   (cmdb_ci_network_gear / cmdb_ci_ip_router / cmdb_rel_ci).

   Public API (window.*):
     genServiceNowScript(state) → string (Python source)
     downloadServiceNowScript() → triggers browser download
     renderServiceNowPanel()    → injects panel into #snow-panel
════════════════════════════════════════════════════════════════ */

function _snowDevices() {
  if (typeof buildDeviceList === 'function') return buildDeviceList();
  return [];
}

/* ── Layer → CMDB class ──────────────────────────────────────── */
var _SNOW_CLASS_MAP = {
  'campus-access':  'cmdb_ci_netgear',
  'campus-dist':    'cmdb_ci_netgear',
  'campus-core':    'cmdb_ci_netgear',
  'dc-spine':       'cmdb_ci_netgear',
  'dc-leaf':        'cmdb_ci_netgear',
  'gpu-spine':      'cmdb_ci_netgear',
  'gpu-tor':        'cmdb_ci_netgear',
  'wan-hub':        'cmdb_ci_ip_router',
  'wan-branch':     'cmdb_ci_ip_router',
};

function _snowClass(layer) {
  return _SNOW_CLASS_MAP[layer] || 'cmdb_ci_netgear';
}

/* ── Map layer → device category ────────────────────────────── */
function _snowCategory(layer) {
  if (!layer) return 'Network';
  if (layer.indexOf('wan') === 0) return 'Router';
  return 'Switch';
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: genServiceNowScript
═══════════════════════════════════════════════════════════════ */
function genServiceNowScript(state) {
  var devs    = _snowDevices();
  var orgName = (state && state.orgName) || 'Network';
  var ts      = new Date().toISOString().slice(0, 10);

  /* Build device block */
  var devLines = [];
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
    var hostname = dev.hostname || dev.name || ('DEVICE-' + String(idx + 1).padStart(2, '0'));
    var mgmtIP   = '10.0.0.' + (30 + idx);
    devLines.push('    {');
    devLines.push('        "name":       "' + hostname + '",');
    devLines.push('        "mgmt_ip":    "' + mgmtIP + '",');
    devLines.push('        "layer":      "' + layer + '",');
    devLines.push('        "ci_class":   "' + _snowClass(layer) + '",');
    devLines.push('        "category":   "' + _snowCategory(layer) + '",');
    devLines.push('    },');
  });

  var devBlock = devLines.length
    ? devLines.join('\n')
    : '    # No devices — complete Steps 1–3 in NetDesign AI first';

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — ServiceNow CMDB Push',
    'Generated: ' + ts + '  |  Org: ' + orgName,
    '',
    'Pushes BOM device list + topology relationships into ServiceNow',
    'CMDB using the Table API (cmdb_ci_netgear, cmdb_ci_ip_router,',
    'cmdb_rel_ci).  Requires ServiceNow instance with Table API access.',
    '',
    'Usage:',
    '    pip install requests',
    '    python snow_cmdb_push.py',
    '',
    'Env vars:',
    '    SNOW_INSTANCE  — instance name, e.g. dev12345  (no .service-now.com)',
    '    SNOW_USER      — ServiceNow username',
    '    SNOW_PASS      — ServiceNow password',
    '    SNOW_DRY_RUN   — set to "true" to print payloads without pushing',
    '"""',
    '',
    'import os, sys, json, urllib3',
    'import requests',
    '',
    '# ── Config ──────────────────────────────────────────────────────',
    'SNOW_INSTANCE = os.getenv("SNOW_INSTANCE", "")   # e.g. dev12345',
    'SNOW_USER     = os.getenv("SNOW_USER",     "admin")',
    'SNOW_PASS     = os.getenv("SNOW_PASS",     "")',
    'SNOW_DRY_RUN  = os.getenv("SNOW_DRY_RUN",  "false").lower() == "true"',
    '',
    'if not SNOW_INSTANCE:',
    '    print("[ERROR] Set SNOW_INSTANCE env var (e.g. export SNOW_INSTANCE=dev12345)")',
    '    sys.exit(1)',
    '',
    'BASE = f"https://{SNOW_INSTANCE}.service-now.com/api/now/table"',
    '',
    '# ── BOM Device list ─────────────────────────────────────────────',
    'DEVICES = [',
    devBlock,
    ']',
    '',
    '# ── Design metadata ─────────────────────────────────────────────',
    'DESIGN_NAME = "' + orgName.replace(/"/g, '\\"') + ' Network Design"',
    'DESIGN_DATE = "' + ts + '"',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Session helper',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'class SNOWSession:',
    '    def __init__(self):',
    '        self.s = requests.Session()',
    '        self.s.auth = (SNOW_USER, SNOW_PASS)',
    '        self.s.headers.update({',
    '            "Content-Type":  "application/json",',
    '            "Accept":        "application/json",',
    '            "X-no-response-ui": "true",',
    '        })',
    '',
    '    def get(self, table: str, query: str = "") -> list:',
    '        url = f"{BASE}/{table}?sysparm_query={query}&sysparm_limit=100"',
    '        r = self.s.get(url)',
    '        r.raise_for_status()',
    '        return r.json().get("result", [])',
    '',
    '    def post(self, table: str, body: dict) -> dict:',
    '        if SNOW_DRY_RUN:',
    '            print(f"  [DRY-RUN] POST {table}: {json.dumps(body)[:120]}")',
    '            return {"sys_id": "dry-run-" + body.get("name", "?"), "name": body.get("name", "")}',
    '        r = self.s.post(f"{BASE}/{table}", json=body)',
    '        r.raise_for_status()',
    '        return r.json().get("result", {})',
    '',
    '    def patch(self, table: str, sys_id: str, body: dict) -> dict:',
    '        if SNOW_DRY_RUN:',
    '            print(f"  [DRY-RUN] PATCH {table}/{sys_id}: {json.dumps(body)[:120]}")',
    '            return body',
    '        r = self.s.patch(f"{BASE}/{table}/{sys_id}", json=body)',
    '        r.raise_for_status()',
    '        return r.json().get("result", {})',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# CMDB helpers',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def find_ci(session: SNOWSession, table: str, name: str) -> str | None:',
    '    """Return sys_id of existing CI by name, or None."""',
    '    results = session.get(table, f"name={requests.utils.quote(name)}")',
    '    return results[0]["sys_id"] if results else None',
    '',
    '',
    'def upsert_ci(session: SNOWSession, dev: dict) -> str:',
    '    """Create or update a CMDB CI record; return sys_id."""',
    '    table = dev["ci_class"]',
    '    body = {',
    '        "name":            dev["name"],',
    '        "ip_address":      dev["mgmt_ip"],',
    '        "category":        dev["category"],',
    '        "subcategory":     dev["layer"],',
    '        "operational_status": "1",   # 1 = Operational',
    '        "comments":        f"NetDesign AI {DESIGN_NAME} — pushed {DESIGN_DATE}",',
    '        "short_description": f"Layer: {dev[\'layer\']}",',
    '    }',
    '    existing = find_ci(session, table, dev["name"])',
    '    if existing:',
    '        session.patch(table, existing, body)',
    '        return existing',
    '    result = session.post(table, body)',
    '    return result.get("sys_id", "")',
    '',
    '',
    'def create_relationship(session: SNOWSession,',
    '                        parent_id: str, child_id: str,',
    '                        rel_type: str = "Connects to::Connected from") -> None:',
    '    """Create a cmdb_rel_ci relationship between two CIs."""',
    '    # Find the relationship type sys_id',
    '    rt = session.get("cmdb_rel_type", f"name={requests.utils.quote(rel_type)}")',
    '    rt_id = rt[0]["sys_id"] if rt else ""',
    '    if not rt_id:',
    '        return  # relationship type not found — skip',
    '    session.post("cmdb_rel_ci", {',
    '        "parent": parent_id,',
    '        "child":  child_id,',
    '        "type":   rt_id,',
    '    })',
    '',
    '',
    '# ═══════════════════════════════════════════════════════════════',
    '# Main',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    'def main():',
    '    print("=" * 62)',
    '    print(" NetDesign AI — ServiceNow CMDB Push")',
    '    print(f" Instance: {SNOW_INSTANCE}.service-now.com")',
    '    if SNOW_DRY_RUN: print(" [DRY RUN mode — no records will be created]")',
    '    print("=" * 62)',
    '',
    '    if not DEVICES:',
    '        print("[ERROR] No devices. Complete Steps 1–3 in NetDesign AI first.")',
    '        sys.exit(1)',
    '',
    '    session = SNOWSession()',
    '',
    '    # Test connectivity',
    '    try:',
    '        r = requests.get(f"{BASE}/cmdb_ci_netgear?sysparm_limit=1",',
    '                         auth=(SNOW_USER, SNOW_PASS),',
    '                         headers={"Accept": "application/json"})',
    '        r.raise_for_status()',
    '        print(f"[OK] Connected to {SNOW_INSTANCE}.service-now.com")',
    '    except Exception as e:',
    '        print(f"[ERROR] Cannot reach ServiceNow: {e}")',
    '        sys.exit(1)',
    '',
    '    # Upsert all devices',
    '    sys_id_map: dict[str, str] = {}  # name → sys_id',
    '    for dev in DEVICES:',
    '        print(f"  Pushing CI: {dev[\'name\']} ({dev[\'ci_class\']})… ", end="", flush=True)',
    '        sid = upsert_ci(session, dev)',
    '        sys_id_map[dev["name"]] = sid',
    '        print("OK" if sid and "dry-run" not in sid else "DRY-RUN")',
    '',
    '    print(f"[OK] Pushed {len(sys_id_map)} CIs")',
    '',
    '    # Create topology relationships (uplink pairs)',
    '    # Layer ordering: access→dist→core, leaf→spine, tor→spine',
    '    layer_order = [',
    '        ("campus-access", "campus-dist"),',
    '        ("campus-dist",   "campus-core"),',
    '        ("dc-leaf",       "dc-spine"),',
    '        ("gpu-tor",       "gpu-spine"),',
    '        ("wan-branch",    "wan-hub"),',
    '    ]',
    '    by_layer: dict[str, list[str]] = {}',
    '    for d in DEVICES:',
    '        by_layer.setdefault(d["layer"], []).append(d["name"])',
    '',
    '    rel_count = 0',
    '    for child_layer, parent_layer in layer_order:',
    '        children = by_layer.get(child_layer, [])',
    '        parents  = by_layer.get(parent_layer, [])',
    '        for c in children:',
    '            for p in parents[:2]:  # connect to first 2 parents (redundant uplinks)',
    '                cid = sys_id_map.get(c)',
    '                pid = sys_id_map.get(p)',
    '                if cid and pid and "dry-run" not in cid + pid:',
    '                    create_relationship(session, pid, cid)',
    '                    rel_count += 1',
    '',
    '    print(f"[OK] Created {rel_count} topology relationships in cmdb_rel_ci")',
    '',
    '    # Save manifest',
    '    manifest = [{"name": d["name"], "sys_id": sys_id_map.get(d["name"], ""),',
    '                  "layer": d["layer"], "mgmt_ip": d["mgmt_ip"]} for d in DEVICES]',
    '    out = f"snow_cmdb_manifest_{DESIGN_DATE}.json"',
    '    with open(out, "w") as f: json.dump(manifest, f, indent=2)',
    '    print(f"[OK] Manifest saved → {out}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}
window.genServiceNowScript = genServiceNowScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: downloadServiceNowScript
═══════════════════════════════════════════════════════════════ */
function downloadServiceNowScript() {
  var src  = genServiceNowScript(typeof STATE !== 'undefined' ? STATE : {});
  var slug = ((typeof STATE !== 'undefined' && STATE.orgName) || 'network')
    .replace(/\s+/g, '_').toLowerCase();
  var name = slug + '_snow_cmdb_push.py';
  var blob = new Blob([src], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  if (typeof toast === 'function') toast('ServiceNow CMDB script downloaded', 'success');
}
window.downloadServiceNowScript = downloadServiceNowScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderServiceNowPanel
   Injects a card into #snow-panel
═══════════════════════════════════════════════════════════════ */
function renderServiceNowPanel() {
  var container = document.getElementById('snow-panel');
  if (!container) return;

  container.innerHTML = [
    '<div class="checks-panel-inner">',
    '  <div class="checks-panel-header">',
    '    <div class="checks-panel-icon">❄️</div>',
    '    <div>',
    '      <div style="font-size:.9rem;font-weight:700;color:var(--txt0)">ServiceNow CMDB Push</div>',
    '      <div class="checks-panel-sub">Sync BOM devices + topology into ServiceNow CMDB (Table API).</div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-body">',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">snow_cmdb_push.py</div>',
    '      <div class="checks-card-desc">',
    '        Upserts BOM devices as <code>cmdb_ci_netgear</code> / <code>cmdb_ci_ip_router</code>',
    '        CIs, then wires topology uplinks as <code>cmdb_rel_ci</code> "Connects to" relationships.',
    '        Supports dry-run mode. Manifest saved to <code>snow_cmdb_manifest_YYYY-MM-DD.json</code>.',
    '      </div>',
    '      <button class="btn-action checks-dl-btn" onclick="downloadServiceNowScript()">⬇ snow_cmdb_push.py</button>',
    '    </div>',
    '    <div class="checks-card">',
    '      <div class="checks-card-title">How to run</div>',
    '      <div class="checks-card-desc">',
    '        1. Install: <code>pip install requests</code><br>',
    '        2. Set: <code>export SNOW_INSTANCE=dev12345</code><br>',
    '        3. Set: <code>export SNOW_USER=admin</code><br>',
    '        4. Set: <code>export SNOW_PASS=your-password</code><br>',
    '        5. Dry run: <code>export SNOW_DRY_RUN=true</code> (optional)<br>',
    '        6. Run: <code>python snow_cmdb_push.py</code>',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="checks-panel-usage">',
    '    <strong>API:</strong> ServiceNow Table API &nbsp;|&nbsp;',
    '    <strong>Tables:</strong> <code>cmdb_ci_netgear</code>, <code>cmdb_ci_ip_router</code>, <code>cmdb_rel_ci</code> &nbsp;|&nbsp;',
    '    <strong>Auth:</strong> Basic (username + password)',
    '  </div>',
    '</div>',
  ].join('\n');
}
window.renderServiceNowPanel = renderServiceNowPanel;
