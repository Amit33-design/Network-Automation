'use strict';

/* ════════════════════════════════════════════════════════════════
   CONFIG PARAMETERS  (src/js/params.js)

   Centralised store for all infrastructure server IPs, credentials,
   domain name, and BGP ASNs used across every vendor config template.

   Helper functions exposed as globals:
     _P(key)  → string value (or default if blank/missing)
     _PI(key) → integer value (or default if NaN/missing)

   Both helpers are safe to call from configgen.js regardless of
   whether the user has touched the panel — fallback defaults match
   the original hardcoded values so nothing breaks.
════════════════════════════════════════════════════════════════ */

const _PARAM_DEFAULTS = {
  /* Infrastructure servers */
  ntp1:          '10.0.0.1',
  ntp2:          '10.0.0.2',
  tacacs1:       '10.0.0.101',
  tacacs2:       '10.0.0.102',
  snmpTrap:      '10.0.0.200',
  syslog:        '10.0.0.201',
  gnmiCollector: '10.0.0.210',
  dnsServer:     '8.8.8.8',
  /* Network config */
  domainName:    'netdesign.local',
  spineAsn:      65000,
  leafAsnBase:   65001,
  /* Credentials — users must replace these with real values */
  ntpKey:        'NetDesignNTP@2024',
  snmpUser:      'netmon',
  snmpAuthPw:    'NetDesign@Auth2024',
  snmpPrivPw:    'NetDesign@Priv2024',
  tacacsKey:     'NetDesign@TACACS2024',
  hsrpKey:       'HSRP_NetD@2024',
  enableSecret:  'NetDesign@Enable2024',
};

const PARAMS = Object.assign({}, _PARAM_DEFAULTS);

/* ── Public helpers ─────────────────────────────────────────────── */

function _P(key) {
  const v = PARAMS[key];
  if (v === undefined || v === null || String(v).trim() === '') {
    return String(_PARAM_DEFAULTS[key] || '');
  }
  return String(v);
}

function _PI(key) {
  const v = parseInt(PARAMS[key], 10);
  if (isNaN(v)) return (_PARAM_DEFAULTS[key] | 0);
  return v;
}

/* ── Persistence ────────────────────────────────────────────────── */

const _PARAMS_LS = 'netdesign_params_v1';

function _saveParams() {
  try { localStorage.setItem(_PARAMS_LS, JSON.stringify(PARAMS)); } catch (e) { /* quota or private */ }
}

function _loadParams() {
  try {
    const raw = localStorage.getItem(_PARAMS_LS);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.keys(_PARAM_DEFAULTS).forEach(function (k) {
      if (saved[k] !== undefined && saved[k] !== null) PARAMS[k] = saved[k];
    });
  } catch (e) { /* corrupt storage — leave defaults */ }
}

_loadParams();

/* ── Panel helpers ──────────────────────────────────────────────── */

function _pField(key, label, type, placeholder, hint) {
  const val = (PARAMS[key] !== undefined) ? PARAMS[key] : _PARAM_DEFAULTS[key];
  const safe = String(val).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `<div class="prm-field">
    <label class="prm-label" for="prm-${key}">${label}</label>
    <input class="prm-input" id="prm-${key}" type="${type || 'text'}"
           value="${safe}" placeholder="${placeholder || ''}"
           oninput="PARAMS['${key}']=this.value" autocomplete="off">
    ${hint ? `<span class="prm-hint">${hint}</span>` : ''}
  </div>`;
}

/* ── Render ─────────────────────────────────────────────────────── */

function renderParamsPanel() {
  const outer = document.getElementById('params-panel');
  if (!outer) return;

  const open = outer.dataset.open === '1';

  outer.innerHTML = `<div class="prm-panel">
    <div class="prm-header" onclick="toggleParamsPanel()">
      <span class="prm-header-icon">⚙️</span>
      <div class="prm-header-text">
        <div class="prm-title">Config Parameters</div>
        <div class="prm-sub">Customize NTP, TACACS+, SNMP, syslog, domain name, and BGP ASNs before generating configs.</div>
      </div>
      <span class="prm-chevron">${open ? '▲ Collapse' : '▼ Expand'}</span>
    </div>${open ? `
    <div class="prm-body">

      <div class="prm-section">
        <div class="prm-section-title">Infrastructure Servers</div>
        <div class="prm-grid">
          ${_pField('ntp1',          'NTP Primary',       'text',     '10.0.0.1',   'Primary NTP server IP')}
          ${_pField('ntp2',          'NTP Secondary',     'text',     '10.0.0.2',   'Secondary NTP server IP')}
          ${_pField('tacacs1',       'TACACS+ Primary',   'text',     '10.0.0.101', 'Primary TACACS+/AAA server')}
          ${_pField('tacacs2',       'TACACS+ Secondary', 'text',     '10.0.0.102', 'Secondary TACACS+/AAA server')}
          ${_pField('snmpTrap',      'SNMP Trap Target',  'text',     '10.0.0.200', 'NMS / SNMP trap receiver IP')}
          ${_pField('syslog',        'Syslog Server',     'text',     '10.0.0.201', 'Syslog collector IP')}
          ${_pField('gnmiCollector', 'gNMI Collector',    'text',     '10.0.0.210', 'Streaming telemetry / gNMI target')}
          ${_pField('dnsServer',     'DNS Server',        'text',     '8.8.8.8',    'DNS resolver IP')}
        </div>
      </div>

      <div class="prm-section">
        <div class="prm-section-title">Network Config</div>
        <div class="prm-grid">
          ${_pField('domainName',  'Domain Name',   'text',   'corp.example.com', 'ip domain-name / domain-name value')}
          ${_pField('spineAsn',    'Spine BGP ASN', 'number', '65000',            'ASN assigned to DC spine switches')}
          ${_pField('leafAsnBase', 'Leaf ASN Base', 'number', '65001',            'Leaf-01 = base; Leaf-02 = base+1, etc.')}
        </div>
      </div>

      <div class="prm-section">
        <div class="prm-section-title">Credentials
          <span class="prm-cred-note">— appear verbatim in generated configs; replace with your values</span>
        </div>
        <div class="prm-grid">
          ${_pField('ntpKey',      'NTP MD5 Key',      'password', 'NTP-auth-key',  'ntp authentication-key 1 md5 <key>')}
          ${_pField('snmpUser',    'SNMP v3 User',     'text',     'netmon',         'SNMPv3 username')}
          ${_pField('snmpAuthPw',  'SNMP Auth PW',     'password', 'Auth-password',  'SHA authentication password')}
          ${_pField('snmpPrivPw',  'SNMP Priv PW',     'password', 'Priv-password',  'AES-128 privacy password')}
          ${_pField('tacacsKey',   'TACACS+ Key',      'password', 'TACACS-psk',     'Pre-shared key for TACACS+ servers')}
          ${_pField('hsrpKey',     'HSRP MD5 Key',     'password', 'HSRP-auth-key',  'standby auth md5 key-string')}
          ${_pField('enableSecret','Enable Secret',    'password', 'EnableSecret',   'enable algorithm-type sha256 secret')}
        </div>
      </div>

      <div class="prm-actions">
        <button class="btn btn-primary prm-apply-btn" onclick="applyParams()">✓ Apply &amp; Regenerate Config</button>
        <button class="btn prm-reset-btn" onclick="resetParams()">↺ Reset to Defaults</button>
      </div>

    </div>` : ''}
  </div>`;
}

/* ── Actions ────────────────────────────────────────────────────── */

function toggleParamsPanel() {
  const el = document.getElementById('params-panel');
  if (!el) return;
  el.dataset.open = el.dataset.open === '1' ? '0' : '1';
  renderParamsPanel();
}

function applyParams() {
  Object.keys(_PARAM_DEFAULTS).forEach(function (key) {
    const inp = document.getElementById('prm-' + key);
    if (inp) PARAMS[key] = inp.value;
  });
  /* coerce numeric fields */
  ['spineAsn', 'leafAsnBase'].forEach(function (k) {
    const v = parseInt(PARAMS[k], 10);
    PARAMS[k] = isNaN(v) ? _PARAM_DEFAULTS[k] : v;
  });
  _saveParams();
  /* re-render the active device config immediately */
  if (typeof selectDevice === 'function' &&
      typeof ACTIVE_DEV !== 'undefined' && ACTIVE_DEV) {
    selectDevice(ACTIVE_DEV.id);
  }
  toast('Parameters saved — config regenerated.', 'success');
}

function resetParams() {
  Object.keys(_PARAM_DEFAULTS).forEach(function (k) { PARAMS[k] = _PARAM_DEFAULTS[k]; });
  _saveParams();
  renderParamsPanel();
  if (typeof selectDevice === 'function' &&
      typeof ACTIVE_DEV !== 'undefined' && ACTIVE_DEV) {
    selectDevice(ACTIVE_DEV.id);
  }
  toast('Parameters reset to defaults.', 'info');
}

/* ── Exports ────────────────────────────────────────────────────── */

window.PARAMS             = PARAMS;
window._PARAM_DEFAULTS    = _PARAM_DEFAULTS;
window._P                 = _P;
window._PI                = _PI;
window.renderParamsPanel  = renderParamsPanel;
window.toggleParamsPanel  = toggleParamsPanel;
window.applyParams        = applyParams;
window.resetParams        = resetParams;
