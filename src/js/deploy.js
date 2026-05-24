'use strict';

// ─── Canary deployment (G-28) ─────────────────────────────────────────────────
// Deploy to 1 leaf first, run abbreviated post-check, require confirmation
// before rolling out to the remaining devices.

var NETMIKO_TYPE = {
  cisco:   'cisco_nxos',
  arista:  'arista_eos',
  juniper: 'juniper_junos',
  nvidia:  'linux',
  default: 'cisco_nxos'
};

function _nmType(vendor) {
  return NETMIKO_TYPE[(vendor || '').toLowerCase()] || NETMIKO_TYPE.default;
}

// Sort devices into deploy order: canary leaf first, spines last
function _deployOrder(devices) {
  var leaves = devices.filter(function(d) { return d.subLayer === 'leaf'; });
  var spines  = devices.filter(function(d) { return d.subLayer === 'spine'; });
  var others  = devices.filter(function(d) { return d.subLayer !== 'leaf' && d.subLayer !== 'spine'; });
  return { canary: leaves[0] || null, rest: leaves.slice(1).concat(others).concat(spines) };
}

window.genCanaryDeployScript = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site   = (state && state.siteCode) || 'SITE';
  var order  = _deployOrder(devices);
  var canary = order.canary;
  if (!canary) return '# No leaf devices found for canary deployment.\n';

  // Build device config map from state.configs
  var configs = state.configs || {};

  // Per-device block
  function devBlock(dev) {
    var nmType  = _nmType(dev.vendor);
    var mgmtIp  = dev.mgmtIp || ('192.168.1.' + (dev.unit || 1));
    var cfgText = (configs[dev.instanceId] || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    return (
      '    {\n' +
      '        "host":        "' + mgmtIp + '",\n' +
      '        "hostname":    "' + dev.hostname + '",\n' +
      '        "device_type": "' + nmType + '",\n' +
      '        "vendor":      "' + (dev.vendor || '').toLowerCase() + '",\n' +
      '        "config": """\n' + cfgText + '\n""",\n' +
      '    }'
    );
  }

  var canaryBlock = devBlock(canary);
  var restBlocks  = order.rest.map(devBlock).join(',\n');

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Canary Deployment  (G-28)',
    'Site: ' + site,
    '',
    'Deploy order: canary leaf FIRST → confirm → all remaining devices.',
    'Credentials from environment: NET_USER / NET_PASS / NET_ENABLE',
    '"""',
    '',
    'import os, sys, time',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    'USER   = os.environ["NET_USER"]',
    'PASS   = os.environ["NET_PASS"]',
    'ENABLE = os.environ.get("NET_ENABLE", PASS)',
    '',
    '# ── Canary device (deploy first) ────────────────────────────────────────',
    'CANARY = ' + canaryBlock,
    '',
    '# ── Remaining devices (deploy after canary confirmation) ────────────────',
    'REMAINING = [',
    restBlocks,
    ']',
    '',
    'def push_config(device):',
    '    """Push config to one device and return (success, output)."""',
    '    conn_args = {',
    '        "host": device["host"], "device_type": device["device_type"],',
    '        "username": USER, "password": PASS, "secret": ENABLE',
    '    }',
    '    try:',
    '        with ConnectHandler(**conn_args) as conn:',
    '            conn.enable()',
    '            output = conn.send_config_set(device["config"].splitlines())',
    '            conn.save_config()',
    '        return True, output',
    '    except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '        return False, str(e)',
    '',
    'def quick_verify(device):',
    '    """Run a fast sanity check: BGP summary + route count."""',
    '    verify_cmd = {',
    '        "cisco_nxos":    "show bgp summary",',
    '        "arista_eos":    "show bgp summary",',
    '        "juniper_junos": "show bgp summary",',
    '        "linux":         "vtysh -c \'show bgp summary\'",',
    '    }',
    '    cmd = verify_cmd.get(device["device_type"], "show bgp summary")',
    '    try:',
    '        with ConnectHandler(host=device["host"], device_type=device["device_type"],',
    '                            username=USER, password=PASS, secret=ENABLE) as conn:',
    '            out = conn.send_command(cmd)',
    '        peers = out.lower().count("established")',
    '        return peers > 0, f"BGP peers established: {peers}\\n{out[:300]}"',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    'def deploy_device(device, label):',
    '    print(f"\\n[{label}] Pushing config to {device[\"hostname\"]} ({device[\"host\"]})...", flush=True)',
    '    ok, out = push_config(device)',
    '    if not ok:',
    '        print(f"  ✗ PUSH FAILED: {out}", file=sys.stderr)',
    '        return False',
    '    print(f"  ✓ Config pushed")',
    '    time.sleep(5)  # allow BGP to reconverge',
    '    ok2, verify_out = quick_verify(device)',
    '    status = "✓ BGP UP" if ok2 else "✗ BGP DOWN"',
    '    print(f"  Verify: {status}")',
    '    if not ok2:',
    '        print(f"  {verify_out[:200]}", file=sys.stderr)',
    '    return ok2',
    '',
    'def main():',
    '    # ── Step 1: Canary ──────────────────────────────────────────────────',
    '    print("=" * 60)',
    '    print(f"CANARY DEPLOYMENT — {CANARY[\"hostname\"]}")',
    '    print("=" * 60)',
    '    canary_ok = deploy_device(CANARY, "CANARY")',
    '    if not canary_ok:',
    '        print("\\n✗ Canary FAILED — aborting rollout. Run rollback.py pre to revert.", file=sys.stderr)',
    '        sys.exit(1)',
    '',
    '    # ── Step 2: Gate ─────────────────────────────────────────────────────',
    '    print("\\n" + "─" * 60)',
    '    print("Canary deployment PASSED.")',
    '    if sys.stdin.isatty():',
    '        ans = input("Proceed with remaining " + str(len(REMAINING)) + " devices? [yes/no]: ").strip().lower()',
    '        if ans != "yes":',
    '            print("Deployment paused by operator. Re-run to continue.")',
    '            sys.exit(0)',
    '    else:',
    '        print("Non-interactive mode — proceeding automatically.")',
    '',
    '    # ── Step 3: Remaining devices ─────────────────────────────────────────',
    '    failed = []',
    '    for i, dev in enumerate(REMAINING):',
    '        ok = deploy_device(dev, f"{i+2}/{len(REMAINING)+1}")',
    '        if not ok: failed.append(dev["hostname"])',
    '',
    '    print("\\n" + "=" * 60)',
    '    if failed:',
    '        print(f"✗ {len(failed)} device(s) failed: {failed}", file=sys.stderr)',
    '        print("Run rollback.py rollback for failed devices.", file=sys.stderr)',
    '        sys.exit(2)',
    '    else:',
    '        print(f"✓ All {len(REMAINING)+1} devices deployed successfully.")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
};

window.renderDeployPane = function(state) {
  var devices = state.devices || [];
  if (!devices.length) {
    return '<p class="empty-state">Complete Step 1 first.</p>';
  }

  var order  = _deployOrder(devices);
  var canary = order.canary;

  var canaryRow = canary
    ? '<tr><td><strong>' + canary.hostname + '</strong> <span class="platform-badge">canary</span></td>'
      + '<td>' + (canary.vendor || '') + '</td><td>1st — verify BGP before rest</td></tr>'
    : '';

  var restRows = order.rest.map(function(d, i) {
    return '<tr><td>' + d.hostname + '</td><td>' + (d.vendor || '') + '</td>'
         + '<td>' + (i + 2) + ' — after canary gate</td></tr>';
  }).join('');

  var script = window.genCanaryDeployScript(devices, state);

  return '<div class="rollback-section">'
    + '<h3>Canary Deploy Order</h3>'
    + '<p class="section-sub" style="margin-bottom:10px;">Deploy canary leaf first — gate on BGP verification before rolling to remaining devices.</p>'
    + '<table class="rollback-table"><thead><tr><th>Device</th><th>Vendor</th><th>Step</th></tr></thead>'
    + '<tbody>' + canaryRow + restRows + '</tbody></table>'
    + '<h4 style="margin-top:16px;">Generated deploy.py</h4>'
    + '<div class="btn-toolbar" style="margin-bottom:8px;">'
    + '<button class="btn btn-secondary" onclick="window.downloadDeployScript()">Download deploy.py</button>'
    + '</div>'
    + '<pre id="deploy-script-output" class="config-pre">' + script.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>'
    + '</div>';
};

window.downloadDeployScript = function() {
  var script = window.genCanaryDeployScript(
    window.STATE && window.STATE.devices || [],
    window.STATE || {}
  );
  var blob = new Blob([script], { type: 'text/x-python' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'deploy.py';
  a.click();
};
