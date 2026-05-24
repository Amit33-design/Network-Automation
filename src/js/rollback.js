'use strict';

// Platform-native rollback strategies — CLAUDE.md §7
// Never config-paste. Each platform uses its own checkpoint/replace mechanism.

var ROLLBACK_STRATEGIES = {
  nxos: {
    pre:    'checkpoint pre-deploy-{ts}',
    deploy: null,  // standard config push
    exec:   'rollback running-config checkpoint pre-deploy-{ts} atomic',
    verify: 'show checkpoint summary'
  },
  iosxe: {
    pre:    'copy running-config flash:pre-deploy-{ts}.cfg',
    deploy: null,
    exec:   'configure replace flash:pre-deploy-{ts}.cfg force',
    verify: 'show archive'
  },
  eos: {
    pre:    'copy running-config checkpoint://pre-deploy-{ts}',
    deploy: null,
    exec:   'rollback clean-config checkpoint://pre-deploy-{ts}',
    verify: 'show checkpoint'
  },
  junos: {
    pre:    null,  // JunOS commit history is automatic
    deploy: 'commit confirmed 5',  // auto-rollback if not re-confirmed within 5 min
    exec:   'rollback 1',
    verify: 'show system commit'
  },
  sonic: {
    pre:    'config save /etc/sonic/config_db_pre_{ts}.json',
    deploy: null,
    exec:   'config load /etc/sonic/config_db_pre_{ts}.json',
    verify: 'show runningconfiguration all'
  }
};

// Map device.vendor → strategy key
function _strategyKey(dev) {
  var v = (dev.vendor || '').toLowerCase();
  if (v === 'cisco') {
    // Distinguish NX-OS vs IOS-XE by subLayer/model heuristic
    var m = (dev.model || '').toLowerCase();
    if (m.indexOf('nxos') !== -1 || m.indexOf('nexus') !== -1 ||
        m.indexOf('93') !== -1   || m.indexOf('95') !== -1 ||
        dev.subLayer === 'spine' || dev.subLayer === 'leaf') {
      return 'nxos';
    }
    return 'iosxe';
  }
  if (v === 'arista')  return 'eos';
  if (v === 'juniper') return 'junos';
  if (v === 'nvidia')  return 'sonic';
  return null;
}

// Substitute {ts} placeholder
function _fill(tmpl, ts) {
  return tmpl ? tmpl.replace(/\{ts\}/g, ts) : null;
}

// Generate per-device rollback plan
// Returns { ts, devices: [{ hostname, platform, pre, deploy_note, rollback, verify }] }
window.genRollbackPlan = function(devices, state) {
  var ts  = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHmmss
  var out = [];

  (devices || []).forEach(function(dev) {
    var key = _strategyKey(dev);
    if (!key) return;
    var s = ROLLBACK_STRATEGIES[key];
    out.push({
      hostname:    dev.hostname,
      platform:    key,
      pre:         _fill(s.pre, ts),
      deploy_note: s.deploy || 'standard config push (commit / copy run start)',
      rollback:    _fill(s.exec, ts),
      verify:      s.verify
    });
  });

  return { ts: ts, devices: out };
};

// Generate a human-readable runbook (HTML) for the Deploy Guide pane
window.renderRollbackRunbook = function(state) {
  var plan = window.genRollbackPlan(state.devices || [], state);

  if (!plan.devices.length) {
    return '<p class="empty-state">No devices — complete Step 1 first.</p>';
  }

  var rows = plan.devices.map(function(d) {
    var preCell = d.pre
      ? '<code>' + d.pre + '</code>'
      : '<em>automatic (commit history)</em>';
    var deployCell = d.platform === 'junos'
      ? '<code>' + d.deploy_note + '</code> — auto-rolls back in 5 min if not confirmed'
      : d.deploy_note;
    return '<tr>' +
      '<td><strong>' + d.hostname + '</strong></td>' +
      '<td><span class="platform-badge">' + d.platform + '</span></td>' +
      '<td>' + preCell + '</td>' +
      '<td>' + deployCell + '</td>' +
      '<td><code>' + d.rollback + '</code></td>' +
      '<td><code>' + d.verify + '</code></td>' +
      '</tr>';
  }).join('');

  var netmikoScript = _genNetmikoRollbackScript(plan);

  return '<div class="rollback-section">' +
    '<h3>Platform-Native Rollback Plan</h3>' +
    '<p class="section-sub" style="margin-bottom:12px;">' +
      'Timestamp: <code>' + plan.ts + '</code> — run Pre-Deploy step on every device <em>before</em> pushing config.' +
    '</p>' +

    '<div style="overflow-x:auto;">' +
    '<table class="rollback-table">' +
      '<thead><tr>' +
        '<th>Device</th><th>Platform</th>' +
        '<th>1 — Pre-deploy checkpoint</th>' +
        '<th>2 — Deploy command</th>' +
        '<th>3 — Rollback command</th>' +
        '<th>4 — Verify rollback</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '</div>' +

    '<h4 style="margin-top:20px;">Netmiko rollback script</h4>' +
    '<div class="btn-toolbar" style="margin-bottom:8px;">' +
      '<button class="btn btn-secondary" onclick="window.downloadRollbackScript()">Download rollback.py</button>' +
    '</div>' +
    '<pre id="rollback-script-output" class="config-pre">' + _escHtml(netmikoScript) + '</pre>' +
  '</div>';
};

// ─── Netmiko Python rollback script ──────────────────────────────────────────

function _escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

var PLATFORM_NETMIKO = {
  nxos:  'cisco_nxos',
  iosxe: 'cisco_ios',
  eos:   'arista_eos',
  junos: 'juniper_junos',
  sonic: 'linux'
};

function _genNetmikoRollbackScript(plan) {
  var deviceBlocks = plan.devices.map(function(d) {
    var nmType = PLATFORM_NETMIKO[d.platform] || 'autodetect';
    var preLines  = d.pre    ? JSON.stringify([d.pre])    : 'None  # automatic';
    var rollLines = JSON.stringify([d.rollback]);
    var verLines  = JSON.stringify([d.verify]);
    return (
      '    {\n' +
      '        "host": "' + d.hostname + '",  # replace with mgmt IP\n' +
      '        "device_type": "' + nmType + '",\n' +
      '        "pre_cmds":      ' + preLines + ',\n' +
      '        "rollback_cmds": ' + rollLines + ',\n' +
      '        "verify_cmds":   ' + verLines + ',\n' +
      '    }'
    );
  }).join(',\n');

  return (
    '#!/usr/bin/env python3\n' +
    '"""NetDesign AI — platform-native rollback  (ts=' + plan.ts + ')\n' +
    'Run pre_cmds BEFORE pushing config; run rollback_cmds to revert.\n' +
    'Credentials from environment: NET_USER / NET_PASS / NET_ENABLE\n' +
    '"""\n' +
    'import os, sys\n' +
    'from netmiko import ConnectHandler\n\n' +
    'USER   = os.environ["NET_USER"]\n' +
    'PASS   = os.environ["NET_PASS"]\n' +
    'ENABLE = os.environ.get("NET_ENABLE", PASS)\n\n' +
    'DEVICES = [\n' +
    deviceBlocks + '\n' +
    ']\n\n' +
    'def run(device, cmds, label):\n' +
    '    if not cmds:\n' +
    '        print(f"  [{label}] skipped (platform handles automatically)")\n' +
    '        return\n' +
    '    conn = ConnectHandler(\n' +
    '        host=device["host"], device_type=device["device_type"],\n' +
    '        username=USER, password=PASS, secret=ENABLE\n' +
    '    )\n' +
    '    for cmd in cmds:\n' +
    '        out = conn.send_command(cmd, expect_string=r"#")\n' +
    '        print(f"  [{label}] {cmd}\\n{out[:200]}")\n' +
    '    conn.disconnect()\n\n' +
    'if __name__ == "__main__":\n' +
    '    action = sys.argv[1] if len(sys.argv) > 1 else "pre"\n' +
    '    for d in DEVICES:\n' +
    '        print(f"\\n=== {d[\'host\']} ({d[\'device_type\']}) — {action} ===")\n' +
    '        if action == "pre":\n' +
    '            run(d, d["pre_cmds"], "pre-checkpoint")\n' +
    '        elif action == "rollback":\n' +
    '            run(d, d["rollback_cmds"], "rollback")\n' +
    '        elif action == "verify":\n' +
    '            run(d, d["verify_cmds"], "verify")\n' +
    '        else:\n' +
    '            print("Usage: rollback.py [pre|rollback|verify]")\n' +
    '            sys.exit(1)\n'
  );
}

// ─── Download helper ──────────────────────────────────────────────────────────

window.downloadRollbackScript = function() {
  var plan   = window.genRollbackPlan(window.STATE && window.STATE.devices || [], window.STATE || {});
  var script = _genNetmikoRollbackScript(plan);
  var blob   = new Blob([script], { type: 'text/x-python' });
  var a      = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'rollback.py';
  a.click();
};
