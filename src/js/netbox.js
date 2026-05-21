'use strict';

/* ════════════════════════════════════════════════════════════════
   NETBOX / NAUTOBOT API IMPORT
   Reads existing inventory from a NetBox or Nautobot instance
   and pre-fills STATE fields + Step 1 form inputs.

   Nautobot uses the same REST paths as NetBox (/api/dcim/sites/,
   /api/dcim/devices/, /api/ipam/prefixes/, /api/tenancy/tenants/)
   so a single implementation covers both.

   Browser fetch requires the instance to have CORS configured for
   this app's origin (Administration → CORS Origins in NetBox/Nautobot).

   Public API:
     window.renderNetboxImportPanel()        — render card in Step 1
     window.fetchNetboxInventory(url, token) — promise → inventory obj
     window.applyNetboxToState(inventory)    — fill STATE + form
════════════════════════════════════════════════════════════════ */

/* ── Storage key ─────────────────────────────────────────────── */
var _NB_STORAGE_KEY = 'netdesign_netbox_creds';

/* ── Vendor name normalization ───────────────────────────────── */
var _NB_VENDOR_MAP = {
  cisco:           'Cisco',
  arista:          'Arista',
  arista_networks: 'Arista',
  juniper:         'Juniper',
  juniper_networks:'Juniper',
  fortinet:        'Fortinet',
  'hpe':           'HPE Aruba',
  'hpe_aruba':     'HPE Aruba',
  aruba:           'HPE Aruba',
  aruba_networks:  'HPE Aruba',
  'dell':          'Dell EMC',
  'dell_emc':      'Dell EMC',
  dell_technologies:'Dell EMC',
  nvidia:          'NVIDIA',
  mellanox:        'NVIDIA',
  extreme:         'Extreme Networks',
  extreme_networks:'Extreme Networks',
};

function _normalizeVendor(name) {
  if (!name) return null;
  var slug = name.toLowerCase().replace(/[\s\-\.\/]+/g, '_');
  return _NB_VENDOR_MAP[slug] || null;
}

/* ── Role → use-case heuristic ───────────────────────────────── */
var _ROLE_UC_MAP = {
  access:       'campus',
  'access-switch': 'campus',
  distribution: 'campus',
  'dist-switch':'campus',
  core:         'campus',
  'core-switch':'campus',
  wlc:          'campus',
  leaf:         'dc',
  spine:        'dc',
  tor:          'dc',
  'top-of-rack':'dc',
  superspine:   'dc',
  border:       'dc',
  gpu:          'gpu',
  compute:      'gpu',
  storage:      'gpu',
  wan:          'wan',
  cpe:          'wan',
  branch:       'wan',
  sdwan:        'wan',
  'edge-router':'wan',
  router:       'wan',
};

function _roleToUC(roleSlug) {
  if (!roleSlug) return null;
  var key = roleSlug.toLowerCase().replace(/[\s\/]+/g, '-');
  return _ROLE_UC_MAP[key] || null;
}

/* ── Device count → org size ─────────────────────────────────── */
function _sizeFromCount(n) {
  if (n < 15)  return 'small';
  if (n < 80)  return 'medium';
  if (n < 400) return 'large';
  return 'enterprise';
}

/* ── Fetch helper ────────────────────────────────────────────── */
function _nbFetch(base, token, path) {
  var url = base.replace(/\/$/, '') + path;
  var headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = 'Token ' + token;
  return fetch(url, { headers: headers }).then(function(r) {
    if (!r.ok) return r.json().catch(function() { return {}; }).then(function(e) {
      throw new Error(e.detail || ('HTTP ' + r.status));
    });
    return r.json();
  });
}

/* ── Paginate (NetBox returns max 1000 per call) ─────────────── */
function _nbFetchAll(base, token, path) {
  return _nbFetch(base, token, path + '?limit=200&offset=0').then(function(data) {
    var results = data.results || [];
    var count   = data.count   || 0;
    if (count <= 200) return results;

    // Fetch remaining pages in parallel
    var pages  = [];
    var offset = 200;
    while (offset < count) {
      pages.push(_nbFetch(base, token, path + '?limit=200&offset=' + offset));
      offset += 200;
    }
    return Promise.all(pages).then(function(chunks) {
      chunks.forEach(function(c) { results = results.concat(c.results || []); });
      return results;
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: fetchNetboxInventory
   Returns promise → { sites, devices, prefixes, tenants }
═══════════════════════════════════════════════════════════════ */
function fetchNetboxInventory(url, token) {
  var base = url.replace(/\/$/, '');
  return Promise.all([
    _nbFetchAll(base, token, '/api/dcim/sites/'),
    _nbFetchAll(base, token, '/api/dcim/devices/'),
    _nbFetchAll(base, token, '/api/ipam/prefixes/').catch(function() { return []; }),
    _nbFetchAll(base, token, '/api/tenancy/tenants/').catch(function() { return []; }),
  ]).then(function(results) {
    return {
      sites:    results[0],
      devices:  results[1],
      prefixes: results[2],
      tenants:  results[3],
    };
  });
}
window.fetchNetboxInventory = fetchNetboxInventory;

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: applyNetboxToState
   Maps inventory → STATE fields and fills Step 1 form inputs.
   Returns a summary string.
═══════════════════════════════════════════════════════════════ */
function applyNetboxToState(inventory) {
  var sites   = inventory.sites   || [];
  var devices = inventory.devices || [];
  var tenants = inventory.tenants || [];

  /* org name: first tenant, then first site name */
  var orgName = '';
  if (tenants.length) orgName = tenants[0].name || '';
  if (!orgName && sites.length) orgName = sites[0].name || '';
  if (orgName) {
    STATE.orgName = orgName;
    var el = document.getElementById('org-name');
    if (el) el.value = orgName;
  }

  /* num sites */
  if (sites.length) {
    STATE.numSites = String(sites.length);
    var nsEl = document.getElementById('num-sites');
    if (nsEl) nsEl.value = sites.length;
  }

  /* org size from device count */
  if (devices.length) {
    var sz = _sizeFromCount(devices.length);
    STATE.orgSize = sz;
    var szEl = document.getElementById('org-size');
    if (szEl) szEl.value = sz;
  }

  /* preferred vendors — collect unique normalized names */
  var vendorSet = {};
  devices.forEach(function(d) {
    var mfr = (d.device_type && d.device_type.manufacturer && d.device_type.manufacturer.name) || '';
    var mapped = _normalizeVendor(mfr);
    if (mapped) vendorSet[mapped] = true;
  });
  var vendors = Object.keys(vendorSet);
  if (vendors.length) {
    STATE.preferredVendors = vendors;
    document.querySelectorAll('.vendor-chip').forEach(function(chip) {
      var v = chip.dataset.vendor || '';
      chip.classList.toggle('on', vendors.indexOf(v) !== -1);
    });
  }

  /* use case heuristic — vote by device role frequency */
  var ucVotes = {};
  devices.forEach(function(d) {
    var roleSlug = (d.role && (d.role.slug || d.role.name)) || (d.device_role && (d.device_role.slug || d.device_role.name)) || '';
    var uc = _roleToUC(roleSlug);
    if (uc) ucVotes[uc] = (ucVotes[uc] || 0) + 1;
  });
  var detectedUC = null;
  var maxVotes   = 0;
  Object.keys(ucVotes).forEach(function(uc) {
    if (ucVotes[uc] > maxVotes) { maxVotes = ucVotes[uc]; detectedUC = uc; }
  });

  /* build summary */
  var lines = [
    '  Sites imported:   ' + sites.length,
    '  Devices found:    ' + devices.length,
    '  Org size inferred: ' + (STATE.orgSize || '—'),
    '  Vendors detected: ' + (vendors.join(', ') || '—'),
    '  Use case hint:    ' + (detectedUC || '—'),
  ];
  if (orgName) lines.unshift('  Org name:         ' + orgName);

  if (typeof updateSummary === 'function') updateSummary();
  if (typeof toast === 'function') toast('NetBox data applied to form', 'success');

  return { summary: lines.join('\n'), detectedUC: detectedUC, vendors: vendors };
}
window.applyNetboxToState = applyNetboxToState;

/* ── Persist / load credentials ──────────────────────────────── */
function _nbSaveCreds(url, token) {
  try { localStorage.setItem(_NB_STORAGE_KEY, JSON.stringify({ url: url, token: token })); } catch(_) {}
}
function _nbLoadCreds() {
  try { var raw = localStorage.getItem(_NB_STORAGE_KEY); if (raw) return JSON.parse(raw); } catch(_) {}
  return { url: '', token: '' };
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: renderNetboxImportPanel
   Inserts a "Import from NetBox" form-card before the org
   details form in Step 1.
═══════════════════════════════════════════════════════════════ */
function renderNetboxImportPanel() {
  var container = document.getElementById('netbox-import-panel');
  if (!container) return;

  var saved = _nbLoadCreds();

  container.innerHTML = [
    '<div class="form-card nb-card">',
    '  <div class="form-card-head">',
    '    <div class="ico" style="background:rgba(0,212,255,.15)">🔗</div>',
    '    <div>',
    '      <h3>Import from NetBox / Nautobot <span class="nb-badge-optional">optional</span></h3>',
    '      <p>Connect to your NetBox or Nautobot instance to automatically pre-fill organization name, sites, device count, and vendor preferences below.</p>',
    '    </div>',
    '  </div>',
    '  <div class="nb-form-row">',
    '    <div class="field" style="flex:2">',
    '      <label>NetBox URL</label>',
    '      <input id="nb-url" class="nb-input" type="url" placeholder="https://netbox.corp.com"',
    '             value="' + _escAttr(saved.url) + '">',
    '    </div>',
    '    <div class="field" style="flex:2">',
    '      <label>API Token</label>',
    '      <input id="nb-token" class="nb-input" type="password" placeholder="Token abc123…"',
    '             value="' + _escAttr(saved.token) + '">',
    '    </div>',
    '    <div class="field nb-btn-field">',
    '      <label>&nbsp;</label>',
    '      <button class="btn-action nb-connect-btn" onclick="netboxConnect()">Connect &amp; Preview</button>',
    '    </div>',
    '  </div>',
    '  <div id="nb-cors-note" class="nb-note" style="display:none">',
    '    <strong>CORS note:</strong> Your NetBox must allow requests from this origin.',
    '    Add <code>' + location.origin + '</code> to NetBox &rarr; Administration &rarr; CORS Origins.',
    '  </div>',
    '  <div id="nb-preview" class="nb-preview" style="display:none">',
    '    <div id="nb-preview-inner"></div>',
    '    <div class="nb-preview-actions">',
    '      <button class="btn-action" onclick="netboxApply()" id="nb-apply-btn">Apply to Form</button>',
    '      <button class="btn-action btn-ghost" onclick="netboxClear()" style="margin-left:.5rem">Clear</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}
window.renderNetboxImportPanel = renderNetboxImportPanel;

/* ── Attribute escape (no innerHTML injection) ───────────────── */
function _escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── HTML escape for text content ────────────────────────────── */
function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Saved inventory (session) ───────────────────────────────── */
var _nbLastInventory = null;

/* ═══════════════════════════════════════════════════════════════
   UI callbacks (called from inline onclick)
═══════════════════════════════════════════════════════════════ */

function netboxConnect() {
  var url   = (document.getElementById('nb-url')   || {}).value || '';
  var token = (document.getElementById('nb-token') || {}).value || '';
  if (!url) { if (typeof toast === 'function') toast('Enter a NetBox URL', 'error'); return; }

  _nbSaveCreds(url, token);

  var btn     = document.getElementById('nb-connect-btn') || document.querySelector('.nb-connect-btn');
  var preview = document.getElementById('nb-preview');
  var inner   = document.getElementById('nb-preview-inner');
  var corsNote = document.getElementById('nb-cors-note');

  if (btn)  { btn.disabled = true; btn.textContent = 'Connecting…'; }
  if (corsNote) corsNote.style.display = 'none';

  fetchNetboxInventory(url, token).then(function(inv) {
    _nbLastInventory = inv;

    var sites   = inv.sites   || [];
    var devices = inv.devices || [];
    var tenants = inv.tenants || [];

    /* vendor count */
    var vendorSet = {};
    devices.forEach(function(d) {
      var mfr = (d.device_type && d.device_type.manufacturer && d.device_type.manufacturer.name) || '';
      var v = _normalizeVendor(mfr);
      if (v) vendorSet[v] = (vendorSet[v] || 0) + 1;
    });

    /* uc votes */
    var ucVotes = {};
    devices.forEach(function(d) {
      var roleSlug = (d.role && (d.role.slug || d.role.name)) || (d.device_role && (d.device_role.slug || d.device_role.name)) || '';
      var uc = _roleToUC(roleSlug);
      if (uc) ucVotes[uc] = (ucVotes[uc] || 0) + 1;
    });
    var detectedUC = null, maxV = 0;
    Object.keys(ucVotes).forEach(function(uc) { if (ucVotes[uc] > maxV) { maxV = ucVotes[uc]; detectedUC = uc; } });

    var orgName = (tenants.length && tenants[0].name) || (sites.length && sites[0].name) || '—';
    var orgSize = devices.length ? _sizeFromCount(devices.length) : '—';
    var vendorList = Object.keys(vendorSet).join(', ') || '—';

    var ucLabels = { campus:'Campus/LAN', dc:'Data Center', gpu:'AI/GPU', wan:'WAN/SD-WAN', hybrid:'Hybrid', multisite:'Multi-Site', multicloud:'Multicloud' };
    var ucStr = detectedUC ? (ucLabels[detectedUC] || detectedUC) : '—';

    if (inner) inner.innerHTML = [
      '<table class="nb-table">',
      '  <tr><th>Field</th><th>NetBox data</th><th>Will set</th></tr>',
      '  <tr><td>Organization name</td><td>' + _esc(orgName) + '</td><td>org-name input</td></tr>',
      '  <tr><td>Number of sites</td><td>' + sites.length + '</td><td>num-sites input</td></tr>',
      '  <tr><td>Org size</td><td>' + devices.length + ' devices</td><td>' + orgSize + '</td></tr>',
      '  <tr><td>Vendors detected</td><td>' + _esc(vendorList) + '</td><td>Vendor preference chips</td></tr>',
      '  <tr><td>Use case hint</td><td>' + _esc(ucStr) + ' (' + maxV + ' matching devices)</td><td>advisory only</td></tr>',
      '</table>',
    ].join('');

    if (preview) preview.style.display = 'block';
    if (typeof toast === 'function') toast('NetBox connected — ' + devices.length + ' devices found', 'success');
  }).catch(function(err) {
    if (corsNote) corsNote.style.display = 'block';
    if (typeof toast === 'function') toast('NetBox error: ' + err.message, 'error', 6000);
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Connect & Preview'; }
  });
}
window.netboxConnect = netboxConnect;

function netboxApply() {
  if (!_nbLastInventory) {
    if (typeof toast === 'function') toast('Connect to NetBox first', 'error');
    return;
  }
  var result = applyNetboxToState(_nbLastInventory);
  var preview = document.getElementById('nb-preview');
  if (preview) preview.style.display = 'none';
  if (typeof toast === 'function') toast('NetBox data applied to form', 'success');
  _nbLastInventory = null;
}
window.netboxApply = netboxApply;

function netboxClear() {
  _nbLastInventory = null;
  var preview = document.getElementById('nb-preview');
  if (preview) preview.style.display = 'none';
}
window.netboxClear = netboxClear;
