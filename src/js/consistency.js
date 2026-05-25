'use strict';

/* ════════════════════════════════════════════════════════════════
   MULTI-VENDOR CONSISTENCY CHECKER  (src/js/consistency.js)

   Verifies that NTP servers, TACACS+ servers, SNMP trap targets,
   and domain name are consistent across ALL generated device configs.
   Surfaces mismatches as a collapsible panel in Step 5.

   Exports:
     window.renderConsistencyPanel()  — refreshes #consistency-panel DOM
════════════════════════════════════════════════════════════════ */

/* ── OS classes that don't have CLI management config ──────────── */
function _skipOS(os) {
  return os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text';
}

/* ── Extractors — pull specific values from raw config text ──────── */

function _extractNTP(raw, os) {
  var servers = [];
  var m, re;

  if (os === 'junos') {
    /* JunOS: ntp { server <IP>; } */
    re = /\bserver\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else if (os === 'sonic') {
    /* SONiC FRR comment line or config_db: # NTP_SERVER ... */
    re = /ntp server\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/gi;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
    /* Also JSON form */
    re = /"NTP"\s*:\s*\{[^}]*"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else {
    /* IOS-XE / NX-OS / EOS */
    re = /^ntp server\s+(\S+)/gm;
    while ((m = re.exec(raw)) !== null) servers.push(m[1].replace(/\s.*$/, ''));
  }

  return _dedupe(servers);
}

function _extractTACACS(raw, os) {
  var servers = [];
  var m, re;

  if (os === 'junos') {
    /* JunOS: tacacs { server { address <IP>; } } */
    re = /address\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*;/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else if (os === 'ios-xe') {
    /* IOS-XE "new" form: tacacs server X\n address ipv4 Y */
    re = /address\s+ipv4\s+(\S+)/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else if (os === 'nxos') {
    re = /tacacs-server host\s+(\S+)/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else if (os === 'eos') {
    re = /tacacs-server host\s+(\S+)/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  } else if (os === 'sonic') {
    re = /server-host\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
    while ((m = re.exec(raw)) !== null) servers.push(m[1]);
  }

  return _dedupe(servers);
}

function _extractSNMPTrap(raw, os) {
  var m;
  if (os === 'junos') {
    var re = /targets\s*\{[^}]*?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/;
    m = re.exec(raw);
    if (m) return m[1];
  } else if (os === 'sonic') {
    var re2 = /"SNMP_MANAGER"\s*:\s*\{"([^"]+)"/;
    m = re2.exec(raw);
    if (m) return m[1];
  } else {
    /* IOS-XE / NX-OS / EOS */
    var re3 = /^snmp-server host\s+(\S+)/m;
    m = re3.exec(raw);
    if (m) return m[1];
  }
  return '';
}

function _extractDomain(raw, os) {
  var m;
  if (os === 'junos') {
    var re = /domain-name\s+(\S+);/;
    m = re.exec(raw);
    return m ? m[1] : '';
  }
  if (os === 'sonic') {
    var re2 = /"domain_name"\s*:\s*"([^"]+)"/;
    m = re2.exec(raw);
    return m ? m[1] : '';
  }
  /* IOS-XE / NX-OS / EOS */
  var re3 = /^ip domain.name\s+(\S+)/mi;
  m = re3.exec(raw);
  if (m) return m[1];
  /* EOS fallback: dns domain <name> */
  var re4 = /^dns domain\s+(\S+)/mi;
  m = re4.exec(raw);
  return m ? m[1] : '';
}

function _dedupe(arr) {
  var seen = {};
  return arr.filter(function(x) { if (seen[x]) return false; seen[x] = 1; return true; }).sort();
}

/* ── Key string for comparison ──────────────────────────────────── */
function _arrKey(arr) { return arr.join(',') || '(none)'; }

/* ── Run check across all devices ───────────────────────────────── */

function runConsistencyCheck() {
  /* Need DEVICE_LIST and generateConfig / getOS from configgen.js */
  if (typeof DEVICE_LIST === 'undefined' || !DEVICE_LIST || !DEVICE_LIST.length) {
    return { skipped: true };
  }
  if (typeof generateConfig !== 'function' || typeof getOS !== 'function') {
    return { skipped: true };
  }

  /* Build per-device extracts (skip overflow placeholders + non-CLI OS) */
  var extracts = [];
  DEVICE_LIST.forEach(function(dev) {
    if (dev._overflow) return;
    var os = getOS(dev.layer);
    if (_skipOS(os)) return;
    try {
      var raw = generateConfig(dev, os);
      extracts.push({
        name:   dev.name,
        layer:  dev.layer,
        os:     os,
        ntp:    _extractNTP(raw, os),
        tacacs: _extractTACACS(raw, os),
        snmp:   _extractSNMPTrap(raw, os),
        domain: _extractDomain(raw, os),
      });
    } catch (_) { /* skip devices that fail to generate */ }
  });

  if (!extracts.length) return { skipped: true };

  /* Aggregate unique value sets per parameter */
  function _unique(fn) {
    var vals = {};
    extracts.forEach(function(e) { var v = fn(e); vals[v] = (vals[v] || 0) + 1; });
    return vals;
  }

  var ntpVals    = _unique(function(e) { return _arrKey(e.ntp);    });
  var tacacsVals = _unique(function(e) { return _arrKey(e.tacacs); });
  var snmpVals   = _unique(function(e) { return _arrKey([e.snmp]); });
  var domainVals = _unique(function(e) { return _arrKey([e.domain]);});

  function _buildParam(label, vals) {
    var keys = Object.keys(vals);
    var ok   = keys.length <= 1 && !(keys.length === 1 && keys[0] === '(none)');
    return {
      label:  label,
      ok:     ok,
      values: vals,
      count:  keys.length,
    };
  }

  var params = [
    _buildParam('NTP Servers',       ntpVals),
    _buildParam('TACACS+ Servers',   tacacsVals),
    _buildParam('SNMP Trap Target',  snmpVals),
    _buildParam('Domain Name',       domainVals),
  ];

  var mismatches = params.filter(function(p) { return !p.ok; });

  return {
    skipped:    false,
    deviceCount: extracts.length,
    params:     params,
    mismatches: mismatches,
    extracts:   extracts,
  };
}

/* ── Panel render ───────────────────────────────────────────────── */

var _consOpen = false;

function renderConsistencyPanel() {
  var el = document.getElementById('consistency-panel');
  if (!el) return;

  var result = runConsistencyCheck();

  if (result.skipped) {
    el.innerHTML = '';
    return;
  }

  var mismatchCount = result.mismatches.length;
  var statusClass   = mismatchCount > 0 ? 'con-status-warn' : 'con-status-ok';
  var statusText    = mismatchCount > 0
    ? mismatchCount + ' parameter' + (mismatchCount > 1 ? 's' : '') + ' inconsistent across ' + result.deviceCount + ' devices'
    : 'All parameters consistent across ' + result.deviceCount + ' devices';

  var headerIcon = mismatchCount > 0 ? '⚠' : '✓';

  var bodyHTML = '';
  if (_consOpen) {
    var paramRows = result.params.map(function(p) {
      var valueKeys = Object.keys(p.values);
      var valueCell;
      if (valueKeys.length === 1) {
        /* All consistent — show the single value */
        var v = valueKeys[0];
        valueCell = '<span class="con-val-ok">' + _cEsc(v) + '</span>';
      } else {
        /* Mismatch — list each value + how many devices have it */
        valueCell = valueKeys.map(function(v) {
          return '<div class="con-val-mismatch">' +
            '<span class="con-mismatch-val">' + _cEsc(v) + '</span>' +
            '<span class="con-mismatch-count">' + p.values[v] + ' device' + (p.values[v] > 1 ? 's' : '') + '</span>' +
          '</div>';
        }).join('');
      }

      var icon = p.ok ? '<span class="con-ok">✓</span>' : '<span class="con-warn">⚠</span>';

      return '<tr>' +
        '<td>' + icon + '</td>' +
        '<td style="font-weight:600;font-size:.8rem">' + _cEsc(p.label) + '</td>' +
        '<td>' + valueCell + '</td>' +
      '</tr>';
    }).join('');

    bodyHTML =
      '<div class="con-body">' +
        '<table class="con-table">' +
          '<thead><tr><th></th><th>Parameter</th><th>Values found across all devices</th></tr></thead>' +
          '<tbody>' + paramRows + '</tbody>' +
        '</table>' +
        (mismatchCount > 0
          ? '<div class="con-tip">Tip: Open <strong>Config Parameters</strong> above to synchronize all values, then click <em>Apply &amp; Regenerate</em>.</div>'
          : '') +
      '</div>';
  }

  el.innerHTML =
    '<div class="con-panel">' +
      '<div class="con-header" onclick="toggleConsistencyPanel()">' +
        '<span class="con-header-icon">🔀</span>' +
        '<div class="con-header-text">' +
          '<div class="con-title">Multi-vendor Consistency Check</div>' +
          '<div class="con-sub ' + statusClass + '">' + headerIcon + ' ' + _cEsc(statusText) + '</div>' +
        '</div>' +
        '<span class="con-chevron">' + (_consOpen ? '▲' : '▼') + '</span>' +
      '</div>' +
      bodyHTML +
    '</div>';
}

function _cEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toggleConsistencyPanel() {
  _consOpen = !_consOpen;
  renderConsistencyPanel();
}

/* ── Exports ────────────────────────────────────────────────────── */
window.runConsistencyCheck      = runConsistencyCheck;
window.renderConsistencyPanel   = renderConsistencyPanel;
window.toggleConsistencyPanel   = toggleConsistencyPanel;
