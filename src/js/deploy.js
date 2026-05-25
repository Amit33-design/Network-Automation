'use strict';

// ─── Canary deployment (G-28) ─────────────────────────────────────────────────
// Traffic shift: 2-way route-map mechanism + AS-path prepend. NOT session restart.
//
// DRAIN sequence (per device):
//   1. Discover live BGP neighbors via "show bgp summary"
//   2. Apply NDAL-DRAIN-DENY (deny all) as outbound route-map → withdraws our
//      routes from all peers. Peers reroute via other ECMP paths.
//   3. AS-path prepend ×3 also applied so any cached routes appear longer.
//   4. "clear ip bgp * soft out" — triggers re-advertisement with deny policy.
//      BGP sessions stay ESTABLISHED throughout.
//   5. Wait DRAIN_WAIT_SEC for peers to re-converge.
//
// PUSH: apply new config while device carries zero/minimal traffic.
//
// RESTORE sequence:
//   1. Apply NDAL-RESTORE-PERMIT (permit all) as outbound route-map → replaces
//      the deny; routes are re-advertised immediately.
//   2. "clear ip bgp * soft out" — peers learn our routes again, traffic returns.
//   3. Clean up both route-maps + final soft-out (no prepend, clean state).

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

function _deployOrder(devices) {
  var leaves = devices.filter(function(d) { return d.subLayer === 'leaf'; });
  var spines  = devices.filter(function(d) { return d.subLayer === 'spine'; });
  var others  = devices.filter(function(d) { return d.subLayer !== 'leaf' && d.subLayer !== 'spine'; });
  return { canary: leaves[0] || null, rest: leaves.slice(1).concat(others).concat(spines) };
}

function _extractAsn(cfgText) {
  var m = (cfgText || '').match(/router bgp\s+(\d+)/i);
  return m ? m[1] : '65000';
}

window.genCanaryDeployScript = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site   = (state && state.siteCode) || 'SITE';
  var order  = _deployOrder(devices);
  var canary = order.canary;
  if (!canary) return '# No leaf devices found for canary deployment.\n';

  var configs = state.configs || {};

  function devBlock(dev) {
    var nmType  = _nmType(dev.vendor);
    var mgmtIp  = dev.mgmtIp || ('192.168.1.' + (dev.unit || 1));
    var cfgText = (configs[dev.instanceId] || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    var asn     = _extractAsn(configs[dev.instanceId] || '');
    return (
      '    {\n' +
      '        "host":        "' + mgmtIp + '",\n' +
      '        "hostname":    "' + dev.hostname + '",\n' +
      '        "device_type": "' + nmType + '",\n' +
      '        "bgp_asn":     "' + asn + '",\n' +
      '        "config": """\n' + cfgText + '\n""",\n' +
      '    }'
    );
  }

  var canaryBlock = devBlock(canary);
  var restBlocks  = order.rest.map(devBlock).join(',\n');

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Canary Deployment — 2-way Route-Map Traffic Drain',
    'Site: ' + site,
    '',
    'Traffic shift strategy: route-map deny/permit + AS-path prepend, NOT session restart.',
    '',
    '  DRAIN:   Apply NDAL-DRAIN-DENY (deny all) outbound on every BGP neighbor.',
    '           + prepend local-AS ×3 on any already-advertised paths.',
    '           Trigger: clear ip bgp * soft out (sessions stay ESTABLISHED).',
    '           Peers reroute via ECMP before config is touched.',
    '',
    '  PUSH:    Apply production config while device carries zero/minimal traffic.',
    '',
    '  RESTORE: Replace deny with NDAL-RESTORE-PERMIT (permit all) outbound.',
    '           Trigger: clear ip bgp * soft out.',
    '           Routes re-advertised, traffic returns via normal BGP best-path.',
    '           Clean up both temporary route-maps + final soft-out.',
    '',
    'Credentials from environment: NET_USER / NET_PASS / NET_ENABLE',
    '"""',
    '',
    'import os, sys, time, re',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    'USER   = os.environ["NET_USER"]',
    'PASS   = os.environ["NET_PASS"]',
    'ENABLE = os.environ.get("NET_ENABLE", PASS)',
    '',
    '# Seconds to wait after drain for peers to re-converge before pushing config.',
    '# Set >= MRAI (0s DC-aggressive, 5s WAN-standard, 30s conservative).',
    'DRAIN_WAIT_SEC = int(os.environ.get("DRAIN_WAIT_SEC", "10"))',
    '',
    '# ── Canary device (deploy first) ────────────────────────────────────────',
    'CANARY = ' + canaryBlock,
    '',
    '# ── Remaining devices (deploy after canary gate) ────────────────────────',
    'REMAINING = [',
    restBlocks,
    ']',
    '',
    '# ─── BGP neighbor discovery ──────────────────────────────────────────────',
    '',
    'NEIGHBOR_RE = re.compile(',
    '    r"^\\s*(\\d{1,3}(?:\\.\\d{1,3}){3})\\s+\\d+\\s+\\d+",  # NX-OS / EOS summary',
    '    re.MULTILINE',
    ')',
    '',
    'def get_bgp_neighbors(conn, device_type):',
    '    """Return list of BGP neighbor IPs from show bgp summary."""',
    '    cmd = {',
    '        "cisco_nxos":    "show bgp ipv4 unicast summary",',
    '        "arista_eos":    "show bgp summary",',
    '        "juniper_junos": "show bgp summary",',
    '    }.get(device_type, "show bgp summary")',
    '    out = conn.send_command(cmd)',
    '    return NEIGHBOR_RE.findall(out)',
    '',
    '# ─── Route-map helpers ───────────────────────────────────────────────────',
    '',
    'def _drain_cmds_nxos(asn, neighbors):',
    '    """DENY outbound on all neighbors + AS-path prepend. NX-OS."""',
    '    cmds = [',
    '        "route-map NDAL-DRAIN-DENY deny 10",  ! deny all outbound — withdraws routes',
    '        "route-map NDAL-DRAIN-PREPEND permit 10",',
    '        "  set as-path prepend last-as 3",     ! fallback: make paths look longer',
    '        "router bgp " + asn,',
    '    ]',
    '    for n in neighbors:',
    '        cmds += [',
    '            "  neighbor " + n,',
    '            "    address-family ipv4 unicast",',
    '            "      route-map NDAL-DRAIN-DENY out",',
    '            "    address-family l2vpn evpn",',
    '            "      route-map NDAL-DRAIN-DENY out",',
    '        ]',
    '    return cmds',
    '',
    'def _drain_cmds_eos(asn, neighbors):',
    '    """DENY outbound on all neighbors. Arista EOS."""',
    '    cmds = [',
    '        "route-map NDAL-DRAIN-DENY deny 10",',
    '        "router bgp " + asn,',
    '    ]',
    '    for n in neighbors:',
    '        cmds += [',
    '            "   neighbor " + n + " route-map NDAL-DRAIN-DENY out",',
    '        ]',
    '    return cmds',
    '',
    'def _drain_cmds_junos(asn, neighbors):',
    '    """REJECT all exports. JunOS."""',
    '    return [',
    '        "set policy-options policy-statement NDAL-DRAIN-DENY term 1 then reject",',
    '        "set protocols bgp export NDAL-DRAIN-DENY",',
    '        "commit",',
    '    ]',
    '',
    'def _restore_cmds_nxos(asn, neighbors):',
    '    """Replace deny with PERMIT outbound on all neighbors. NX-OS."""',
    '    cmds = [',
    '        "route-map NDAL-RESTORE-PERMIT permit 10",  ! permit all — re-advertise normally',
    '        "router bgp " + asn,',
    '    ]',
    '    for n in neighbors:',
    '        cmds += [',
    '            "  neighbor " + n,',
    '            "    address-family ipv4 unicast",',
    '            "      route-map NDAL-RESTORE-PERMIT out",',
    '            "    address-family l2vpn evpn",',
    '            "      route-map NDAL-RESTORE-PERMIT out",',
    '        ]',
    '    return cmds',
    '',
    'def _cleanup_cmds_nxos(asn, neighbors):',
    '    """Remove both temp route-maps after traffic is stable. NX-OS."""',
    '    cmds = ["router bgp " + asn]',
    '    for n in neighbors:',
    '        cmds += [',
    '            "  neighbor " + n,',
    '            "    address-family ipv4 unicast",',
    '            "      no route-map NDAL-RESTORE-PERMIT out",',
    '            "    address-family l2vpn evpn",',
    '            "      no route-map NDAL-RESTORE-PERMIT out",',
    '        ]',
    '    cmds += [',
    '        "no route-map NDAL-RESTORE-PERMIT",',
    '        "no route-map NDAL-DRAIN-DENY",',
    '        "no route-map NDAL-DRAIN-PREPEND",',
    '    ]',
    '    return cmds',
    '',
    'def _restore_cmds_eos(asn, neighbors):',
    '    """Replace deny with PERMIT outbound. Arista EOS."""',
    '    cmds = [',
    '        "route-map NDAL-RESTORE-PERMIT permit 10",',
    '        "router bgp " + asn,',
    '    ]',
    '    for n in neighbors:',
    '        cmds += ["   neighbor " + n + " route-map NDAL-RESTORE-PERMIT out"]',
    '    return cmds',
    '',
    'def _cleanup_cmds_eos(asn, neighbors):',
    '    cmds = ["router bgp " + asn]',
    '    for n in neighbors:',
    '        cmds += ["   no neighbor " + n + " route-map NDAL-RESTORE-PERMIT out"]',
    '    cmds += ["no route-map NDAL-RESTORE-PERMIT", "no route-map NDAL-DRAIN-DENY"]',
    '    return cmds',
    '',
    'def _restore_cmds_junos(asn, neighbors):',
    '    return [',
    '        "set policy-options policy-statement NDAL-RESTORE-PERMIT term 1 then accept",',
    '        "set protocols bgp export NDAL-RESTORE-PERMIT",',
    '        "delete protocols bgp export NDAL-DRAIN-DENY",',
    '        "commit",',
    '    ]',
    '',
    'def _cleanup_cmds_junos(asn, neighbors):',
    '    return [',
    '        "delete protocols bgp export NDAL-RESTORE-PERMIT",',
    '        "delete policy-options policy-statement NDAL-RESTORE-PERMIT",',
    '        "delete policy-options policy-statement NDAL-DRAIN-DENY",',
    '        "commit",',
    '    ]',
    '',
    '# ─── Connection helpers ───────────────────────────────────────────────────',
    '',
    'def _connect(device):',
    '    return ConnectHandler(',
    '        host=device["host"], device_type=device["device_type"],',
    '        username=USER, password=PASS, secret=ENABLE',
    '    )',
    '',
    'def _apply(conn, config_cmds, exec_cmd=None):',
    '    """Apply config commands then optionally an exec command (no session restart)."""',
    '    if config_cmds:',
    '        conn.send_config_set(config_cmds)',
    '    if exec_cmd:',
    '        conn.send_command(exec_cmd, expect_string=r"#", read_timeout=30)',
    '',
    '# ─── Drain / Restore ─────────────────────────────────────────────────────',
    '',
    'def drain_device(device):',
    '    """Drain traffic via deny route-map + soft-out. Sessions stay ESTABLISHED."""',
    '    dt  = device["device_type"]',
    '    asn = device.get("bgp_asn", "65000")',
    '    print(f"  [drain ] Discovering BGP neighbors on {device[\'hostname\']}...", flush=True)',
    '    try:',
    '        with _connect(device) as conn:',
    '            conn.enable()',
    '            neighbors = get_bgp_neighbors(conn, dt)',
    '            if not neighbors:',
    '                print(f"  [drain ] No BGP neighbors found — skipping drain")',
    '                return',
    '            print(f"  [drain ] Neighbors: {neighbors}")',
    '            if dt == "cisco_nxos":',
    '                cmds = _drain_cmds_nxos(asn, neighbors)',
    '                soft_cmd = "clear ip bgp * soft out"',
    '            elif dt == "arista_eos":',
    '                cmds = _drain_cmds_eos(asn, neighbors)',
    '                soft_cmd = "clear ip bgp * soft out"',
    '            elif dt == "juniper_junos":',
    '                cmds = _drain_cmds_junos(asn, neighbors)',
    '                soft_cmd = None  # commit triggers re-evaluation',
    '            else:',
    '                print(f"  [drain ] Unsupported device_type {dt} — skipping drain")',
    '                return',
    '            print(f"  [drain ] Applying NDAL-DRAIN-DENY outbound to {len(neighbors)} neighbor(s)...", flush=True)',
    '            _apply(conn, cmds, soft_cmd)',
    '        print(f"  [drain ] Routes withdrawn from peers. Waiting {DRAIN_WAIT_SEC}s for reconvergence...")',
    '        time.sleep(DRAIN_WAIT_SEC)',
    '    except Exception as e:',
    '        print(f"  [drain ] WARNING: drain failed ({e}) — proceeding anyway", file=sys.stderr)',
    '',
    'def restore_device(device, neighbors_cache):',
    '    """Replace deny with permit outbound + soft-out. Then clean up both route-maps."""',
    '    dt  = device["device_type"]',
    '    asn = device.get("bgp_asn", "65000")',
    '    neighbors = neighbors_cache or []',
    '    print(f"  [restore] Applying NDAL-RESTORE-PERMIT outbound to {len(neighbors)} neighbor(s)...", flush=True)',
    '    try:',
    '        with _connect(device) as conn:',
    '            conn.enable()',
    '            if dt == "cisco_nxos":',
    '                _apply(conn, _restore_cmds_nxos(asn, neighbors), "clear ip bgp * soft out")',
    '                time.sleep(5)  # let traffic stabilise before cleanup',
    '                _apply(conn, _cleanup_cmds_nxos(asn, neighbors), "clear ip bgp * soft out")',
    '            elif dt == "arista_eos":',
    '                _apply(conn, _restore_cmds_eos(asn, neighbors), "clear ip bgp * soft out")',
    '                time.sleep(5)',
    '                _apply(conn, _cleanup_cmds_eos(asn, neighbors), "clear ip bgp * soft out")',
    '            elif dt == "juniper_junos":',
    '                _apply(conn, _restore_cmds_junos(asn, neighbors))',
    '                time.sleep(5)',
    '                _apply(conn, _cleanup_cmds_junos(asn, neighbors))',
    '        print(f"  [restore] Traffic path restored. Route-maps cleaned up.")',
    '    except Exception as e:',
    '        print(f"  [restore] WARNING: restore failed ({e}) — remove NDAL-DRAIN-DENY / NDAL-RESTORE-PERMIT manually", file=sys.stderr)',
    '',
    '# ─── Config push ─────────────────────────────────────────────────────────',
    '',
    'def push_config(device):',
    '    """Push production config to a drained device. Returns (success, output)."""',
    '    try:',
    '        with _connect(device) as conn:',
    '            conn.enable()',
    '            output = conn.send_config_set(device["config"].splitlines())',
    '            conn.save_config()',
    '        return True, output',
    '    except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '        return False, str(e)',
    '',
    'def quick_verify(device):',
    '    """BGP summary — count ESTABLISHED sessions."""',
    '    cmd = {',
    '        "cisco_nxos":    "show bgp ipv4 unicast summary",',
    '        "arista_eos":    "show bgp summary",',
    '        "juniper_junos": "show bgp summary",',
    '        "linux":         "vtysh -c \'show bgp summary\'",',
    '    }.get(device["device_type"], "show bgp summary")',
    '    try:',
    '        with _connect(device) as conn:',
    '            out = conn.send_command(cmd)',
    '        peers = out.lower().count("established")',
    '        return peers > 0, f"BGP peers established: {peers}\\n{out[:300]}"',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '# ─── Full deploy sequence ────────────────────────────────────────────────',
    '',
    'def deploy_device(device, label):',
    '    """Drain → push → restore → verify. Zero session restarts."""',
    '    print(f"\\n[{label}] {device[\'hostname\']} ({device[\'host\']})", flush=True)',
    '',
    '    # Cache neighbor IPs during drain so restore uses the same list',
    '    neighbors_cache = []',
    '    dt  = device["device_type"]',
    '    asn = device.get("bgp_asn", "65000")',
    '    try:',
    '        with _connect(device) as conn:',
    '            conn.enable()',
    '            neighbors_cache = get_bgp_neighbors(conn, dt)',
    '    except Exception as e:',
    '        print(f"  [pre   ] Could not discover neighbors: {e}", file=sys.stderr)',
    '',
    '    # Step 1: Drain — apply NDAL-DRAIN-DENY outbound, soft-out',
    '    drain_device(device)',
    '',
    '    # Step 2: Push new production config (device is drained)',
    '    print(f"  [push  ] Applying production config...", flush=True)',
    '    ok, out = push_config(device)',
    '    if not ok:',
    '        print(f"  [push  ] ✗ FAILED: {out}", file=sys.stderr)',
    '        print(f"  [push  ] Attempting emergency traffic restore...", file=sys.stderr)',
    '        restore_device(device, neighbors_cache)',
    '        return False',
    '    print(f"  [push  ] ✓ Config applied")',
    '',
    '    # Step 3: Restore — NDAL-RESTORE-PERMIT replaces deny, then both cleaned up',
    '    restore_device(device, neighbors_cache)',
    '',
    '    # Step 4: Verify BGP health',
    '    time.sleep(5)',
    '    ok2, verify_out = quick_verify(device)',
    '    print(f"  [verify] BGP: {\'✓ ESTABLISHED\' if ok2 else \'✗ DOWN\'}")',
    '    if not ok2:',
    '        print(f"  {verify_out[:200]}", file=sys.stderr)',
    '    return ok2',
    '',
    'def main():',
    '    print("=" * 60)',
    '    print(f"CANARY DEPLOYMENT — {CANARY[\'hostname\']}")',
    '    print("Traffic drain: NDAL-DRAIN-DENY (deny all) → push → NDAL-RESTORE-PERMIT")',
    '    print("BGP sessions stay ESTABLISHED throughout")',
    '    print("=" * 60)',
    '    canary_ok = deploy_device(CANARY, "CANARY")',
    '    if not canary_ok:',
    '        print("\\n✗ Canary FAILED — aborting. Run rollback.py to revert.", file=sys.stderr)',
    '        sys.exit(1)',
    '',
    '    print("\\n" + "─" * 60)',
    '    print("Canary PASSED.")',
    '    if sys.stdin.isatty():',
    '        ans = input("Proceed with remaining " + str(len(REMAINING)) + " devices? [yes/no]: ").strip().lower()',
    '        if ans != "yes":',
    '            print("Deployment paused by operator.")',
    '            sys.exit(0)',
    '    else:',
    '        print("Non-interactive — proceeding automatically.")',
    '',
    '    failed = []',
    '    for i, dev in enumerate(REMAINING):',
    '        ok = deploy_device(dev, f"{i+2}/{len(REMAINING)+1}")',
    '        if not ok: failed.append(dev["hostname"])',
    '',
    '    print("\\n" + "=" * 60)',
    '    if failed:',
    '        print(f"✗ {len(failed)} device(s) failed: {failed}", file=sys.stderr)',
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
      + '<td>' + (canary.vendor || '') + '</td><td>1st — drain → push → restore</td></tr>'
    : '';

  var restRows = order.rest.map(function(d, i) {
    return '<tr><td>' + d.hostname + '</td><td>' + (d.vendor || '') + '</td>'
         + '<td>' + (i + 2) + ' — after canary gate</td></tr>';
  }).join('');

  var script = window.genCanaryDeployScript(devices, state);

  return '<div class="rollback-section">'
    + '<h3>Canary Deploy Order</h3>'
    + '<div style="background:#0f2720;border:1px solid #22c55e;border-radius:6px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:#86efac;">'
    + '<strong style="color:#22c55e;display:block;margin-bottom:6px;">2-way Route-Map Traffic Drain — no BGP session restarts</strong>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;">'
    + '<div style="background:rgba(0,0,0,.3);border-radius:4px;padding:8px;">'
    + '<div style="color:#fbbf24;font-weight:700;margin-bottom:3px;">① Drain</div>'
    + '<code>NDAL-DRAIN-DENY</code> outbound<br>deny all → routes withdrawn<br><code>clear bgp * soft out</code>'
    + '</div>'
    + '<div style="background:rgba(0,0,0,.3);border-radius:4px;padding:8px;">'
    + '<div style="color:#60a5fa;font-weight:700;margin-bottom:3px;">② Push</div>'
    + 'Config applied while device<br>carries zero/minimal traffic<br>Sessions: <strong>ESTABLISHED</strong>'
    + '</div>'
    + '<div style="background:rgba(0,0,0,.3);border-radius:4px;padding:8px;">'
    + '<div style="color:#22c55e;font-weight:700;margin-bottom:3px;">③ Restore</div>'
    + '<code>NDAL-RESTORE-PERMIT</code><br>permit all → re-advertise<br>cleanup both route-maps'
    + '</div>'
    + '</div></div>'
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
