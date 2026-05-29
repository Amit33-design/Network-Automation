'use strict';

/* ════════════════════════════════════════════════════════════════
   CISCO EOL / EOS CHECKER (#T4-7)
   Flags BOM products that are end-of-life or end-of-sale using:
   1. A static lookup table for models in the PRODUCTS catalog.
   2. A downloadable Python script that queries the Cisco Support
      API (EoX API v4) for live EoL data.

   Public API (window.*):
     checkEoL(productId)         → { status, eolDate, eosDate, notice }
     renderEoLPanel()            → BOM EoL banner + table
     genCiscoEoLScript(state)    → Python (Cisco Support API)
     downloadCiscoEoLScript()    → browser download
════════════════════════════════════════════════════════════════ */

/* ── Static EoL / EoS dataset ───────────────────────────────── */
/* Sources: cisco.com/c/en/us/products/eos-eol-listing.html     */
/* Status: active | eol-announced | end-of-sale | end-of-life   */
var _EOL_DB = {
  /* ── Cisco Catalyst 1300 ───────────────────────────────────── */
  'cat1300-48p':   { status: 'active',       eosDate: null,       eolDate: null,       notice: '' },

  /* ── Cisco Catalyst 9300 ───────────────────────────────────── */
  'cat9300-24p':   { status: 'active',       eosDate: null,       eolDate: null,       notice: '' },
  'cat9300-48p':   { status: 'active',       eosDate: null,       eolDate: null,       notice: '' },

  /* ── Cisco Catalyst 9500 ───────────────────────────────────── */
  'cat9500-48y4c': { status: 'active',       eosDate: null,       eolDate: null,       notice: '' },

  /* ── Cisco Catalyst 9600 ───────────────────────────────────── */
  'cat9600-32c':   { status: 'active',       eosDate: null,       eolDate: null,       notice: '' },

  /* ── Cisco Nexus 9000 ──────────────────────────────────────── */
  /* Nexus 93180YC-FX: EoS announced 2023-10-31, EoL 2028-10-31 */
  'nexus-93180yc-fx': {
    status:  'end-of-sale',
    eosDate: '2023-10-31',
    eolDate: '2028-10-31',
    notice:  'Successor: Nexus 93180YC-FX3 (C9K-NM-8X)',
  },
  'nexus-93360yc-fx2': { status: 'active', eosDate: null, eolDate: null, notice: '' },
  'nexus-9336c-fx2':   { status: 'active', eosDate: null, eolDate: null, notice: '' },
  'nexus-9364d-gx':    { status: 'active', eosDate: null, eolDate: null, notice: '' },
  'nexus-9336c-fx2-gpu': { status: 'active', eosDate: null, eolDate: null, notice: '' },

  /* ── Non-Cisco: no EoL data in this checker ────────────────── */
  /* Fortinet, Arista, Juniper, HPE Aruba, Dell EMC, NVIDIA      */
  /* have their own EoL portals — this tool covers Cisco only.   */
};

/* ─────────────────────────────────────────────────────────────── */

var _EOL_STATUS_LABELS = {
  'active':          { label: 'Active',          css: 'eol-active' },
  'eol-announced':   { label: 'EoL Announced',   css: 'eol-announced' },
  'end-of-sale':     { label: 'End-of-Sale',      css: 'eol-eos' },
  'end-of-life':     { label: 'End-of-Life',      css: 'eol-eol' },
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: checkEoL
   Returns EoL record for a product ID, or a default 'unknown'.
═══════════════════════════════════════════════════════════════ */
function checkEoL(productId) {
  return _EOL_DB[productId] || { status: 'unknown', eosDate: null, eolDate: null, notice: '' };
}
window.checkEoL = checkEoL;

/* ── HTML escape ─────────────────────────────────────────────── */
function _eolEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderEoLPanel
   Scans selectedProducts + PRODUCTS, builds EoL flag table,
   injects into #eol-panel in the BOM section.
═══════════════════════════════════════════════════════════════ */
function renderEoLPanel() {
  var container = document.getElementById('eol-panel');
  if (!container) return;

  if (typeof STATE === 'undefined' || typeof PRODUCTS === 'undefined') {
    container.innerHTML = '';
    return;
  }

  /* Collect selected product IDs from STATE */
  var selected = STATE.selectedProducts || {};
  var prodIds  = Object.values(selected).filter(Boolean);

  if (!prodIds.length) {
    container.innerHTML = '';
    return;
  }

  /* Partition into flagged / clean */
  var flagged = [];
  var unknown = [];
  prodIds.forEach(function(pid) {
    var prod = PRODUCTS[pid];
    if (!prod) return;
    var eol  = checkEoL(pid);
    if (eol.status === 'active') return;
    if (eol.status === 'unknown') {
      if (prod.vendor === 'Cisco') unknown.push({ prod: prod, eol: eol });
      return;
    }
    flagged.push({ prod: prod, eol: eol });
  });

  if (!flagged.length && !unknown.length) {
    container.innerHTML = [
      '<div class="eol-banner eol-banner-ok">',
      '  <span class="eol-ico">✅</span>',
      '  <div>',
      '    <strong>All Cisco products in BOM are current</strong>',
      '    <div class="eol-sub">No end-of-sale or end-of-life notices found in the static lookup table.</div>',
      '  </div>',
      '  <button class="btn-action checks-dl-btn" onclick="downloadCiscoEoLScript()" style="margin-left:auto">⬇ Verify via Cisco API</button>',
      '</div>',
    ].join('\n');
    return;
  }

  var rows = flagged.map(function(item) {
    var info = _EOL_STATUS_LABELS[item.eol.status] || { label: item.eol.status, css: 'eol-eos' };
    return [
      '<tr>',
      '  <td>' + _eolEsc(item.prod.vendor) + '</td>',
      '  <td>' + _eolEsc(item.prod.model) + '</td>',
      '  <td><span class="eol-badge ' + info.css + '">' + info.label + '</span></td>',
      '  <td>' + (item.eol.eosDate || '—') + '</td>',
      '  <td>' + (item.eol.eolDate || '—') + '</td>',
      '  <td style="color:var(--txt2);font-size:.75rem">' + _eolEsc(item.eol.notice) + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  var unknownNote = unknown.length
    ? '<div class="eol-sub" style="margin-top:.5rem">' + unknown.length + ' Cisco model(s) not in static table — download the script to check live EoL data from Cisco Support API.</div>'
    : '';

  container.innerHTML = [
    '<div class="eol-banner eol-banner-warn">',
    '  <span class="eol-ico">⚠️</span>',
    '  <div style="flex:1">',
    '    <strong>' + flagged.length + ' BOM product(s) flagged</strong>',
    '    <div class="eol-sub">Review end-of-sale / end-of-life status before ordering.</div>',
    '  </div>',
    '  <button class="btn-action checks-dl-btn" onclick="downloadCiscoEoLScript()" style="margin-left:auto">⬇ Cisco EoL API Script</button>',
    '</div>',
    '<table class="nb-table eol-table">',
    '  <thead><tr><th>Vendor</th><th>Model</th><th>Status</th><th>End-of-Sale</th><th>End-of-Life</th><th>Note</th></tr></thead>',
    '  <tbody>' + rows + '</tbody>',
    '</table>',
    unknownNote,
  ].join('\n');
}
window.renderEoLPanel = renderEoLPanel;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: genCiscoEoLScript
   Generates Python script using Cisco Support API (EoX v4)
   to check live EoL status for all Cisco products in the BOM.
═══════════════════════════════════════════════════════════════ */
function genCiscoEoLScript(state) {
  var orgName = (state && state.orgName) || 'Network';
  var ts      = new Date().toISOString().slice(0, 10);

  /* Collect Cisco product model names */
  var ciscoModels = [];
  if (typeof STATE !== 'undefined' && typeof PRODUCTS !== 'undefined') {
    var sel = STATE.selectedProducts || {};
    Object.values(sel).forEach(function(pid) {
      var p = PRODUCTS[pid];
      if (p && p.vendor === 'Cisco') ciscoModels.push(p.model || pid);
    });
  }

  var modelsBlock = ciscoModels.length
    ? ciscoModels.map(function(m) { return '    "' + m.replace(/"/g, '\\"') + '",'; }).join('\n')
    : '    # No Cisco products in BOM — add products in Step 3';

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Cisco EoL / EoS Checker',
    'Generated: ' + ts + '  |  Org: ' + orgName,
    '',
    'Queries Cisco Support APIs (EoX v4) for live End-of-Sale /',
    'End-of-Life status for all Cisco products in the BOM.',
    '',
    'Requirements:',
    '    pip install requests',
    '',
    '    Register at developer.cisco.com → My Apps & Keys →',
    '    create an app with "Cisco Support APIs" scope to get',
    '    your CLIENT_ID and CLIENT_SECRET.',
    '',
    'Usage:',
    '    export CISCO_CLIENT_ID=your-client-id',
    '    export CISCO_CLIENT_SECRET=your-client-secret',
    '    python cisco_eol_check.py',
    '"""',
    '',
    'import os, sys, json, time',
    'import requests',
    '',
    '# ── Auth ────────────────────────────────────────────────────────',
    'CLIENT_ID     = os.getenv("CISCO_CLIENT_ID",     "")',
    'CLIENT_SECRET = os.getenv("CISCO_CLIENT_SECRET", "")',
    '',
    'if not CLIENT_ID or not CLIENT_SECRET:',
    '    print("[ERROR] Set CISCO_CLIENT_ID and CISCO_CLIENT_SECRET.")',
    '    print("        Register at: https://developer.cisco.com/site/support-apis/")',
    '    sys.exit(1)',
    '',
    'TOKEN_URL = "https://id.cisco.com/oauth2/default/v1/token"',
    'EOX_URL   = "https://apix.cisco.com/supporttools/eox/rest/5/EOXByProductID/1/"',
    '',
    '# ── BOM Cisco products ──────────────────────────────────────────',
    'CISCO_MODELS = [',
    modelsBlock,
    ']',
    '',
    '',
    'def get_token() -> str:',
    '    r = requests.post(TOKEN_URL, data={',
    '        "grant_type":    "client_credentials",',
    '        "client_id":     CLIENT_ID,',
    '        "client_secret": CLIENT_SECRET,',
    '    })',
    '    r.raise_for_status()',
    '    token = r.json()["access_token"]',
    '    print(f"[OK] Cisco OAuth token obtained")',
    '    return token',
    '',
    '',
    'def check_eox(token: str, pid: str) -> dict:',
    '    """Query EoX API for a single product ID (PID = model number)."""',
    '    # Some Cisco PIDs include spaces; URL-encode them',
    '    safe_pid = pid.replace(" ", "%20")',
    '    url = EOX_URL + safe_pid',
    '    r = requests.get(url, headers={',
    '        "Authorization": f"Bearer {token}",',
    '        "Accept":        "application/json",',
    '    })',
    '    if r.status_code == 404:',
    '        return {"pid": pid, "status": "NOT_FOUND"}',
    '    r.raise_for_status()',
    '    data = r.json()',
    '    eox_records = data.get("EOXRecord", [])',
    '    if not eox_records:',
    '        return {"pid": pid, "status": "NO_EOL_RECORD", "active": True}',
    '    rec = eox_records[0]',
    '    eos = rec.get("EndOfSaleDate", {}).get("value", "")',
    '    eol = rec.get("LastDateOfSupport", {}).get("value", "")',
    '    eos_ext = rec.get("EndOfSWMaintenanceReleases", {}).get("value", "")',
    '    return {',
    '        "pid":           pid,',
    '        "status":        "end-of-sale" if eos else "active",',
    '        "end_of_sale":   eos or None,',
    '        "last_support":  eol or None,',
    '        "sw_maint_end":  eos_ext or None,',
    '        "bulletin_url":  rec.get("LinkToProductBulletinURL", {}).get("value", ""),',
    '        "successor":     rec.get("EOXMigrationDetails", {}).get("MigrationProductId", {}).get("value", ""),',
    '    }',
    '',
    '',
    'def main():',
    '    print("=" * 60)',
    '    print(" NetDesign AI — Cisco EoL / EoS API Checker")',
    '    print("=" * 60)',
    '',
    '    if not CISCO_MODELS:',
    '        print("[WARN] No Cisco models in BOM — add products in Step 3.")',
    '        sys.exit(0)',
    '',
    '    token = get_token()',
    '    results = []',
    '    for model in CISCO_MODELS:',
    '        print(f"  Checking {model!r}… ", end="", flush=True)',
    '        try:',
    '            rec = check_eox(token, model)',
    '            status = rec.get("status", "unknown")',
    '            icon = {',
    '                "active":       "[OK]",',
    '                "end-of-sale":  "[EoS]",',
    '                "NO_EOL_RECORD":"[Active?]",',
    '                "NOT_FOUND":    "[NotFound]",',
    '            }.get(status, "[?]")',
    '            eos = rec.get("end_of_sale", "") or ""',
    '            eol = rec.get("last_support", "") or ""',
    '            print(f"{icon}  EoS: {eos or \'—\':12}  Last Support: {eol or \'—\'}")',
    '            results.append(rec)',
    '        except Exception as e:',
    '            print(f" [ERR] {e}")',
    '            results.append({"pid": model, "status": "error", "error": str(e)})',
    '        time.sleep(0.3)  # respect rate limit',
    '',
    '    # Summary',
    '    print()',
    '    print("=" * 60)',
    '    eos_count = sum(1 for r in results if r.get("status") == "end-of-sale")',
    '    print(f" {eos_count}/{len(results)} product(s) are End-of-Sale")',
    '    print("=" * 60)',
    '',
    '    out = f"cisco_eol_{ts}.json"'.replace('${ts}', ts),
    '    with open(out, "w") as f: json.dump(results, f, indent=2)',
    '    print(f"[OK] Results saved → {out}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}
window.genCiscoEoLScript = genCiscoEoLScript;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: downloadCiscoEoLScript
═══════════════════════════════════════════════════════════════ */
function downloadCiscoEoLScript() {
  var src  = genCiscoEoLScript(typeof STATE !== 'undefined' ? STATE : {});
  var slug = ((typeof STATE !== 'undefined' && STATE.orgName) || 'network')
    .replace(/\s+/g, '_').toLowerCase();
  var blob = new Blob([src], { type: 'text/plain' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = slug + '_cisco_eol_check.py';
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  if (typeof toast === 'function') toast('Cisco EoL check script downloaded', 'success');
}
window.downloadCiscoEoLScript = downloadCiscoEoLScript;
