'use strict';

/* ════════════════════════════════════════════════════════════════
   CONFIG LINTER  (src/js/linter.js)

   Analyzes generated vendor configs for missing mandatory sections
   and known anti-patterns. Invoked from selectDevice() in configgen.js.

   Exports:
     window.lintConfig(raw, os, dev)       → { findings: [{sev, msg, hint}] }
     window.renderLinterPanel(raw, os, dev) → updates #linter-panel DOM
     window.toggleLinterPanel()
════════════════════════════════════════════════════════════════ */

/* ── Skipped OS classes (non-CLI configs) ───────────────────────── */
function _skip(os) {
  return os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text';
}

/* ── Rule set ───────────────────────────────────────────────────── */
var _LINT_RULES = [

  /* Mandatory sections */
  {
    id: 'no-hostname',
    sev: 'warn',
    msg: 'Missing hostname statement',
    hint: 'Every device must declare a hostname for management identity and LLDP.',
    test: function(r, os) {
      if (_skip(os)) return false;
      if (os === 'sonic') return !/\"hostname\"\s*:/.test(r) && !/^hostname\s+\S/m.test(r);
      return !/^hostname\s+\S/m.test(r);
    }
  },
  {
    id: 'no-ntp',
    sev: 'warn',
    msg: 'No NTP configuration found',
    hint: 'NTP server statements are required for clock synchronization and log timestamps.',
    test: function(r, os) {
      if (_skip(os)) return false;
      return !/ntp|NTP/i.test(r);
    }
  },
  {
    id: 'no-snmp',
    sev: 'warn',
    msg: 'No SNMP configuration found',
    hint: 'SNMPv3 is required for NMS polling and trap delivery.',
    test: function(r, os) {
      if (_skip(os)) return false;
      return !/snmp/i.test(r);
    }
  },
  {
    id: 'no-aaa',
    sev: 'warn',
    msg: 'No AAA / TACACS+ configuration found',
    hint: 'Centralized AAA is a security baseline requirement for all managed devices.',
    test: function(r, os) {
      if (_skip(os) || os === 'sonic') return false;
      return !/aaa |tacacs|radius/i.test(r);
    }
  },
  {
    id: 'no-logging',
    sev: 'info',
    msg: 'No syslog server configured',
    hint: 'Remote syslog is needed for audit trails, compliance, and incident response.',
    test: function(r, os) {
      if (_skip(os)) return false;
      if (os === 'junos') return !/syslog/i.test(r);
      if (os === 'sonic') return !/\"logging\"/i.test(r) && !/rsyslog/i.test(r);
      return !/logging\s+\d+\.\d+|logging host/i.test(r);
    }
  },
  {
    id: 'no-domain',
    sev: 'info',
    msg: 'No domain-name configured',
    hint: 'Required for SSH RSA key generation and fully qualified DNS resolution.',
    test: function(r, os) {
      if (_skip(os) || os === 'sonic') return false;
      if (os === 'junos') return !/domain-name\s+\S/i.test(r);
      return !/ip domain.name\s+\S/i.test(r);
    }
  },

  /* Anti-patterns */
  {
    id: 'bgp-no-maxpaths',
    sev: 'warn',
    msg: 'BGP configured without maximum-paths',
    hint: 'Without maximum-paths, only one path is installed even on an ECMP fabric — ECMP will not work.',
    test: function(r, os) {
      if (_skip(os)) return false;
      var hasBGP = /router bgp\s|bgp_asn|router bgp$/mi.test(r);
      if (!hasBGP) return false;
      return !/maximum.paths/i.test(r);
    }
  },
  {
    id: 'ntp-no-auth',
    sev: 'warn',
    msg: 'NTP configured without MD5 authentication',
    hint: 'Unauthenticated NTP is vulnerable to rogue time-source attacks (CVE-2013-5211 class).',
    test: function(r, os) {
      if (_skip(os) || os === 'sonic') return false;
      var hasNTPServer = /ntp server\s|ntp-server\s/i.test(r);
      if (!hasNTPServer) return false;
      if (os === 'ios-xe' || os === 'nxos') return !/ntp authentication-key/i.test(r);
      if (os === 'eos')   return !/ntp authentication-key|ntp key\s/i.test(r);
      if (os === 'junos') return !/authentication-key/i.test(r);
      return false;
    }
  },
  {
    id: 'telnet-vty',
    sev: 'error',
    msg: 'VTY lines may allow Telnet — "transport input ssh" missing',
    hint: 'Without explicit "transport input ssh", IOS/NX-OS VTY lines default to allowing Telnet.',
    test: function(r, os) {
      if (_skip(os) || os === 'sonic' || os === 'junos' || os === 'eos') return false;
      var hasVTY = /^line vty/m.test(r);
      if (!hasVTY) return false;
      return !/transport input ssh/i.test(r);
    }
  },
  {
    id: 'no-svc-pw-enc',
    sev: 'warn',
    msg: 'service password-encryption not configured (IOS-XE / NX-OS)',
    hint: 'Type-7 passwords in running-config are visible without this; add "service password-encryption".',
    test: function(r, os) {
      if (os !== 'ios-xe' && os !== 'nxos') return false;
      return !/service password-encryption/i.test(r);
    }
  },
  {
    id: 'cleartext-password',
    sev: 'error',
    msg: 'Possible cleartext password detected',
    hint: 'Use "enable algorithm-type sha256 secret" and "username ... secret" — never "password 0" or unencoded passwords.',
    test: function(r, os) {
      if (_skip(os)) return false;
      /* "password 0 " prefix or legacy "password <word>" that is NOT type 7/sha/md5/secret */
      return /\bpassword\s+0\s+\S/i.test(r);
    }
  },
  {
    id: 'http-server',
    sev: 'warn',
    msg: 'HTTP server may be enabled — consider "no ip http server"',
    hint: 'IOS-XE enables the HTTP server by default on some images; disable unless RESTCONF is required.',
    test: function(r, os) {
      if (os !== 'ios-xe') return false;
      /* Flag if there's no explicit "no ip http server" */
      return !/no ip http server/i.test(r);
    }
  },

];

/* ── Core lint function ─────────────────────────────────────────── */

function lintConfig(raw, os, dev) {
  var findings = [];
  _LINT_RULES.forEach(function(rule) {
    try {
      if (rule.test(raw, os, dev)) {
        findings.push({ id: rule.id, sev: rule.sev, msg: rule.msg, hint: rule.hint });
      }
    } catch (_) { /* skip broken rule silently */ }
  });
  return { findings: findings };
}

/* ── Panel state ────────────────────────────────────────────────── */

var _linterOpen = false;

/* ── Render panel ───────────────────────────────────────────────── */

function renderLinterPanel(raw, os, dev) {
  var el = document.getElementById('linter-panel');
  if (!el) return;

  var result   = lintConfig(raw, os, dev);
  var findings = result.findings;
  var errors   = findings.filter(function(f) { return f.sev === 'error'; }).length;
  var warns    = findings.filter(function(f) { return f.sev === 'warn';  }).length;
  var infos    = findings.filter(function(f) { return f.sev === 'info';  }).length;

  /* Update badge on the header button */
  var badge = document.getElementById('linter-badge-count');
  if (badge) {
    badge.textContent = findings.length;
    badge.className = 'linter-badge ' + (
      errors > 0    ? 'linter-badge-error' :
      warns  > 0    ? 'linter-badge-warn'  :
      findings.length > 0 ? 'linter-badge-info' : 'linter-badge-ok'
    );
  }

  /* Panel body — only render when open and there are findings */
  if (!_linterOpen) { el.innerHTML = ''; return; }
  if (!findings.length) {
    el.innerHTML = '<div class="lint-panel lint-panel-clean">✓ No issues found in this config</div>';
    return;
  }

  var sevIcon  = { error: '✕', warn: '⚠', info: 'ℹ' };
  var summary  = (errors ? errors + ' error' + (errors > 1 ? 's' : '') + '  ' : '') +
                 (warns  ? warns  + ' warning' + (warns  > 1 ? 's' : '') + '  ' : '') +
                 (infos  ? infos  + ' info'                                       : '');

  var rows = findings.map(function(f) {
    return '<div class="lint-finding lint-' + f.sev + '">' +
      '<span class="lint-sev-icon">' + (sevIcon[f.sev] || '?') + '</span>' +
      '<div class="lint-finding-body">' +
        '<div class="lint-msg">' + _lEsc(f.msg) + '</div>' +
        '<div class="lint-hint">' + _lEsc(f.hint) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div class="lint-panel">' +
      '<div class="lint-panel-head">' +
        '<span class="lint-panel-summary">' + _lEsc(summary.trim()) + '</span>' +
        '<span class="lint-panel-sub">Fix before deploying to production</span>' +
      '</div>' +
      '<div class="lint-panel-body">' + rows + '</div>' +
    '</div>';
}

function _lEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ── Toggle ─────────────────────────────────────────────────────── */

function toggleLinterPanel() {
  _linterOpen = !_linterOpen;
  var btn = document.getElementById('btn-linter');
  if (btn) {
    btn.classList.toggle('btn-cfg-active', _linterOpen);
    btn.title = _linterOpen ? 'Hide linter findings' : 'Show linter findings';
  }
  if (typeof ACTIVE_DEV !== 'undefined' && ACTIVE_DEV &&
      typeof generateConfig === 'function' && typeof getOS === 'function') {
    var os  = getOS(ACTIVE_DEV.layer);
    var raw = generateConfig(ACTIVE_DEV, os);
    renderLinterPanel(raw, os, ACTIVE_DEV);
  }
}

/* ── Exports ────────────────────────────────────────────────────── */
window.lintConfig        = lintConfig;
window.renderLinterPanel = renderLinterPanel;
window.toggleLinterPanel = toggleLinterPanel;
