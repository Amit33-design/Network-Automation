'use strict';

// Per-platform show commands for pre/post checks
var PLATFORM_CHECKS = {
  nxos: {
    bgp:       'show bgp summary',
    routes:    'show ip route summary',
    iface:     'show interface counters errors',
    lldp:      'show lldp neighbors',
    cpu:       'show processes cpu sort | head 10',
    version:   'show version | inc Version'
  },
  eos: {
    bgp:       'show bgp summary',
    routes:    'show ip route summary',
    iface:     'show interfaces counters errors',
    lldp:      'show lldp neighbors',
    cpu:       'show processes top once | head 10',
    version:   'show version | grep image'
  },
  junos: {
    bgp:       'show bgp summary',
    routes:    'show route summary',
    iface:     'show interfaces extensive | grep "Input errors"',
    lldp:      'show lldp neighbors',
    cpu:       'show system processes extensive | head 10',
    version:   'show version | grep Junos'
  },
  iosxe: {
    bgp:       'show bgp all summary',
    routes:    'show ip route summary',
    iface:     'show interfaces counters errors',
    lldp:      'show lldp neighbors',
    cpu:       'show processes cpu sorted | head 10',
    version:   'show version | inc Version'
  },
  sonic: {
    bgp:       'show bgp summary',
    routes:    'show ip route summary',
    iface:     'show interfaces counters errors',
    lldp:      'show lldp neighbors',
    cpu:       'show system resources',
    version:   'show version'
  }
};

function _vendorToPlatform(vendor, subLayer) {
  var v = (vendor || '').toLowerCase();
  var l = (subLayer || '').toLowerCase();
  if (v.includes('arista'))  return 'eos';
  if (v.includes('juniper')) return 'junos';
  if (v.includes('sonic') || v.includes('nvidia')) return 'sonic';
  if (v.includes('cisco') && l.includes('xe')) return 'iosxe';
  return 'nxos';  // Cisco NX-OS default
}

function _deviceToPlatform(dev) {
  return _vendorToPlatform(dev.vendor, dev.subLayer || dev.role || '');
}

function _netmikoDriver(platform) {
  var map = {
    nxos: 'cisco_nxos',
    eos: 'arista_eos',
    junos: 'juniper_junos',
    iosxe: 'cisco_ios',
    sonic: 'linux'
  };
  return map[platform] || 'cisco_nxos';
}

// Build a device inventory dict for the generated Python script
function _buildInventoryPy(devices) {
  var lines = ['DEVICES = ['];
  devices.forEach(function(dev) {
    var platform = _deviceToPlatform(dev);
    var driver   = _netmikoDriver(platform);
    lines.push('    {');
    lines.push('        "host": "' + (dev.mgmtIp || ('192.168.1.' + (dev.unit || 1))) + '",');
    lines.push('        "hostname": "' + dev.hostname + '",');
    lines.push('        "device_type": "' + driver + '",');
    lines.push('        "platform": "' + platform + '",');
    lines.push('        "username": os.getenv("NET_USER", "admin"),');
    lines.push('        "password": os.getenv("NET_PASS", ""),');
    lines.push('        "secret":   os.getenv("NET_ENABLE", ""),');
    lines.push('    },');
  });
  lines.push(']');
  return lines.join('\n');
}

// Build loopback IP matrix from device list (lo0 = 10.0.0.<unit>)
function _buildReachabilityPy(devices) {
  var loopbacks = [];
  devices.forEach(function(dev) {
    var ip = dev.loopback0 || ('10.0.0.' + (dev.unit || 1));
    loopbacks.push({ hostname: dev.hostname, ip: ip });
  });

  var lines = [
    '# Reachability matrix — loopback0 IPs (edit to match your addressing)',
    'LOOPBACKS = {'
  ];
  loopbacks.forEach(function(lb) {
    lines.push('    "' + lb.hostname + '": "' + lb.ip + '",');
  });
  lines.push('}');
  lines.push('');
  lines.push('PING_CMDS = {');
  lines.push('    "nxos":  lambda ip: f"ping {ip} count 3 timeout 2",');
  lines.push('    "iosxe": lambda ip: f"ping {ip} repeat 3 timeout 2",');
  lines.push('    "eos":   lambda ip: f"ping {ip} repeat 3",');
  lines.push('    "junos": lambda ip: f"ping {ip} count 3 rapid",');
  lines.push('    "sonic": lambda ip: f"ping -c 3 -W 2 {ip}",');
  lines.push('}');
  lines.push('');
  lines.push('def check_reachability(dev, conn):');
  lines.push('    """Ping all loopbacks from this device; return list of failures."""');
  lines.push('    platform = dev["platform"]');
  lines.push('    ping_fn  = PING_CMDS.get(platform, PING_CMDS["nxos"])');
  lines.push('    failures = []');
  lines.push('    for target_hn, target_ip in LOOPBACKS.items():');
  lines.push('        if target_hn == dev["hostname"]: continue  # skip self');
  lines.push('        cmd = ping_fn(target_ip)');
  lines.push('        out = conn.send_command(cmd, expect_string=r"#", read_timeout=10)');
  lines.push('        if "!!!!!" not in out and "5 received" not in out and "bytes from" not in out:');
  lines.push('            failures.append(f"{dev[\"hostname\"]} → {target_hn} ({target_ip})")');
  lines.push('    return failures');
  return lines.join('\n');
}

// Build COMMANDS dict — per-platform command lists
function _buildCommandsPy() {
  var lines = ['COMMANDS = {'];
  Object.keys(PLATFORM_CHECKS).forEach(function(platform) {
    var cmds = PLATFORM_CHECKS[platform];
    lines.push('    "' + platform + '": {');
    Object.keys(cmds).forEach(function(key) {
      lines.push('        "' + key + '": "' + cmds[key] + '",');
    });
    lines.push('    },');
  });
  lines.push('}');
  return lines.join('\n');
}

window.genPreCheckScript = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site = (state && state.siteCode) || 'SITE';

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Pre-Deployment Baseline Capture',
    'Site: ' + site,
    'Generated: ' + new Date().toISOString(),
    '',
    'Usage:',
    '  export NET_USER=admin NET_PASS=secretpass',
    '  python3 pre_check_' + site.toLowerCase() + '.py',
    '',
    'Output: pre_baseline_' + site.toLowerCase() + '.json',
    '"""',
    '',
    'import os, json, sys, datetime',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    _buildInventoryPy(devices),
    '',
    _buildCommandsPy(),
    '',
    'BASELINE_FILE = "pre_baseline_' + site.toLowerCase() + '.json"',
    '',
    'def collect_device(dev):',
    '    platform = dev["platform"]',
    '    cmds = COMMANDS.get(platform, COMMANDS["nxos"])',
    '    results = {"hostname": dev["hostname"], "host": dev["host"],',
    '               "platform": platform, "timestamp": datetime.datetime.utcnow().isoformat(),',
    '               "commands": {}, "reachable": False, "error": None}',
    '    try:',
    '        with ConnectHandler(**{k: dev[k] for k in',
    '                ("host","device_type","username","password","secret")}) as conn:',
    '            results["reachable"] = True',
    '            for key, cmd in cmds.items():',
    '                try:',
    '                    results["commands"][key] = conn.send_command(cmd)',
    '                except Exception as e:',
    '                    results["commands"][key] = "ERROR: " + str(e)',
    '    except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '        results["error"] = str(e)',
    '    return results',
    '',
    'def main():',
    '    baseline = []',
    '    for dev in DEVICES:',
    '        print(f"  Connecting to {dev[\"hostname\"]} ({dev[\"host\"]})...", end="", flush=True)',
    '        result = collect_device(dev)',
    '        status = "OK" if result["reachable"] else "UNREACHABLE: " + (result["error"] or "")',
    '        print(f" {status}")',
    '        baseline.append(result)',
    '    with open(BASELINE_FILE, "w") as f:',
    '        json.dump(baseline, f, indent=2)',
    '    reachable = sum(1 for d in baseline if d["reachable"])',
    '    print(f"\\nBaseline saved: {BASELINE_FILE}")',
    '    print(f"Devices reached: {reachable}/{len(baseline)}")',
    '    if reachable < len(baseline):',
    '        print("WARNING: Not all devices reachable — resolve before deployment.", file=sys.stderr)',
    '        sys.exit(1)',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
};

// ─── Diff table renderer (G-23) ──────────────────────────────────────────────
// Accepts the JSON string from post_report_<site>.json and renders an HTML table.

window.renderPostCheckDiff = function(jsonStr) {
  var report;
  try { report = JSON.parse(jsonStr); } catch (e) {
    return '<p class="val-block val-block-error">Invalid JSON: ' + e.message + '</p>';
  }
  if (!Array.isArray(report) || !report.length) {
    return '<p class="empty-state">Report is empty or not an array.</p>';
  }

  var totalAlerts = 0;

  // Collect all ping failures across all devices for reachability matrix
  var pingFailures = [];
  report.forEach(function(entry) {
    var post = entry.post || {};
    (post.ping_failures || []).forEach(function(f) { pingFailures.push(f); });
  });

  var rows = report.map(function(entry) {
    var post   = entry.post || {};
    var pre    = entry.pre  || {};
    var alerts = entry.alerts || [];
    totalAlerts += alerts.length;
    var hostname = post.hostname || pre.hostname || '?';
    var platform = post.platform || pre.platform || '?';
    var ts_pre  = (pre.timestamp  || '—').replace('T', ' ').slice(0, 19);
    var ts_post = (post.timestamp || '—').replace('T', ' ').slice(0, 19);
    var reachable = post.reachable ? '<span style="color:var(--success)">✓ OK</span>'
                                   : '<span style="color:var(--danger)">✗ UNREACHABLE</span>';
    var alertHtml = alerts.length
      ? alerts.map(function(a) { return '<div class="diff-alert">⚠ ' + a.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>'; }).join('')
      : '<span style="color:var(--success)">No alerts</span>';

    function metricRow(label, preVal, postVal, warnFn) {
      var changed = (preVal !== postVal && preVal !== '?' && postVal !== '?');
      var cls = (changed && warnFn && warnFn(preVal, postVal)) ? 'diff-changed' : '';
      return '<tr class="' + cls + '"><td style="padding-left:16px;color:var(--text-dim)">' + label + '</td>'
           + '<td>' + preVal + '</td><td>' + postVal + '</td></tr>';
    }

    var preCmd  = pre.commands  || {};
    var postCmd = post.commands || {};

    // Ping matrix result for this device
    var devPingFails = (post.ping_failures || []);
    var pingCell = devPingFails.length
      ? '<span style="color:var(--danger)">' + devPingFails.length + ' failed: '
          + devPingFails.map(function(f) { return f.split('→')[1] || f; }).join(', ') + '</span>'
      : (post.reachable ? '<span style="color:var(--success)">All loopbacks reachable</span>' : '—');

    // ECMP paths result for this device
    var ecmpPaths = post.ecmp_paths;
    var ecmpCell = (ecmpPaths === undefined || ecmpPaths === -1)
      ? '—'
      : (ecmpPaths === 0
          ? '<span style="color:var(--danger)">0 paths (ECMP not working)</span>'
          : '<span style="color:var(--success)">' + ecmpPaths + ' next-hop path(s)</span>');

    return '<tr class="diff-device-hdr"><td colspan="3">'
      + '<strong>' + hostname + '</strong> <span class="platform-badge">' + platform + '</span>'
      + ' &nbsp; pre: ' + ts_pre + ' &nbsp; post: ' + ts_post
      + ' &nbsp; ' + reachable + '</td></tr>'
      + '<tr><td style="padding-left:16px;color:var(--text-dim)">Alerts</td>'
      + '<td colspan="2">' + alertHtml + '</td></tr>'
      + metricRow('BGP summary (sample)',
          (preCmd.bgp  || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          (postCmd.bgp || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          null)
      + metricRow('Route table (sample)',
          (preCmd.routes  || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          (postCmd.routes || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          null)
      + '<tr><td style="padding-left:16px;color:var(--text-dim)">Reachability matrix</td>'
      + '<td>—</td><td>' + pingCell + '</td></tr>'
      + '<tr><td style="padding-left:16px;color:var(--text-dim)">ECMP paths (BGP via count)</td>'
      + '<td>—</td><td>' + ecmpCell + '</td></tr>';
  }).join('');

  var summary = totalAlerts === 0
    ? '<div class="val-block val-block-error" style="background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.4);">'
      + '<div class="val-block-hdr" style="color:var(--success)">All post-checks passed — 0 alerts</div></div>'
    : '<div class="val-block val-block-error">'
      + '<div class="val-block-hdr">Post-check alerts (' + totalAlerts + ') — investigate before closing change</div></div>';

  // Reachability matrix failure summary (if any)
  var matrixHtml = '';
  if (pingFailures.length) {
    matrixHtml = '<div class="val-block val-block-error" style="margin-top:10px;">'
      + '<div class="val-block-hdr">Reachability failures — ' + pingFailures.length + ' path(s) unreachable</div>'
      + '<ul style="margin:8px 0 0 16px;font-size:12px;line-height:1.9;padding:0;">'
      + pingFailures.map(function(f) {
          return '<li style="color:var(--danger)">' + f.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</li>';
        }).join('')
      + '</ul></div>';
  }

  return summary + matrixHtml
    + '<div style="overflow-x:auto;margin-top:12px;">'
    + '<table class="rollback-table diff-table">'
    + '<thead><tr><th>Device / Metric</th><th>Pre-deploy baseline</th><th>Post-deploy state</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
};

// ─── G-27: Config drift detection ────────────────────────────────────────────

// UTF-8-safe base64 encoder for config text embedding
function _b64EncodeConfig(str) {
  try {
    var bytes = unescape(encodeURIComponent(str || ''));
    return btoa(bytes);
  } catch (e) {
    return btoa(str || '');
  }
}

// Per-platform command to retrieve running configuration
var RUNNING_CFG_CMD = {
  nxos:  'show running-config',
  eos:   'show running-config',
  iosxe: 'show running-config',
  junos: 'show configuration',
  sonic: 'show runningconfiguration all'
};

window.genDriftScript = function(devices, configs, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site = (state && state.siteCode) || 'SITE';
  configs = configs || {};

  // Build INTENDED dict — base64-encoded to avoid escaping issues
  var intendedLines = ['INTENDED_B64 = {'];
  devices.forEach(function(dev) {
    var cfg = configs[dev.instanceId] || '';
    var b64 = _b64EncodeConfig(cfg);
    intendedLines.push('    ' + JSON.stringify(dev.hostname) + ': ' + JSON.stringify(b64) + ',');
  });
  intendedLines.push('}');

  // Running-config commands per platform
  var rcmdLines = ['RUNNING_CMD = {'];
  Object.keys(RUNNING_CFG_CMD).forEach(function(p) {
    rcmdLines.push('    "' + p + '": "' + RUNNING_CFG_CMD[p] + '",');
  });
  rcmdLines.push('}');

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Config Drift Detector (G-27)',
    'Site: ' + site,
    'Generated: ' + new Date().toISOString(),
    '',
    'Compares running-config on each device against the intended config',
    'generated by NetDesign AI. Outputs a unified diff per device and',
    'saves drift_report_' + site.toLowerCase() + '.json.',
    '',
    'Usage:',
    '  export NET_USER=admin NET_PASS=secretpass',
    '  python3 drift_check_' + site.toLowerCase() + '.py',
    '',
    'Exit codes: 0 = all in sync, 1 = drift detected, 2 = connection error',
    '"""',
    '',
    'import os, sys, json, base64, difflib, datetime, re',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    _buildInventoryPy(devices),
    '',
    intendedLines.join('\n'),
    '',
    '# Decode intended configs from base64 at runtime',
    'INTENDED = {',
    '    hn: base64.b64decode(b64.encode()).decode("utf-8")',
    '    for hn, b64 in INTENDED_B64.items()',
    '}',
    '',
    rcmdLines.join('\n'),
    '',
    'REPORT_FILE = "drift_report_' + site.toLowerCase() + '.json"',
    '',
    '_SKIP_PATTERNS = [',
    '    re.compile(r"^Building configuration", re.IGNORECASE),',
    '    re.compile(r"^!\\s*Last configuration", re.IGNORECASE),',
    '    re.compile(r"^!\\s*Time:", re.IGNORECASE),',
    '    re.compile(r"^ntp clock-period"),',
    '    re.compile(r"^!\\s*NVRAM config"),',
    '    re.compile(r"^!\\s*$"),',
    ']',
    '',
    'def normalize(text):',
    '    """Strip dynamic/noise lines and blank lines for stable comparison."""',
    '    lines = []',
    '    for raw in text.splitlines():',
    '        s = raw.strip()',
    '        if not s:',
    '            continue',
    '        if any(p.match(s) for p in _SKIP_PATTERNS):',
    '            continue',
    '        lines.append(s)',
    '    return lines',
    '',
    'def get_running(dev, conn):',
    '    cmd = RUNNING_CMD.get(dev["platform"], "show running-config")',
    '    return conn.send_command(cmd, read_timeout=60)',
    '',
    'def drift_check(dev, conn):',
    '    hostname = dev["hostname"]',
    '    intended_raw = INTENDED.get(hostname, "")',
    '    if not intended_raw:',
    '        return {',
    '            "hostname": hostname, "platform": dev["platform"],',
    '            "status": "NO_INTENDED", "diff": [],',
    '            "added_lines": 0, "removed_lines": 0,',
    '            "timestamp": datetime.datetime.utcnow().isoformat()',
    '        }',
    '    running_raw = get_running(dev, conn)',
    '    intended_lines = normalize(intended_raw)',
    '    running_lines  = normalize(running_raw)',
    '    diff = list(difflib.unified_diff(',
    '        intended_lines, running_lines,',
    '        fromfile=hostname + "_intended",',
    '        tofile=hostname + "_running",',
    '        lineterm="",',
    '        n=2',
    '    ))',
    '    added   = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))',
    '    removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))',
    '    return {',
    '        "hostname": hostname, "platform": dev["platform"],',
    '        "status": "IN_SYNC" if not diff else "DRIFT",',
    '        "added_lines": added, "removed_lines": removed,',
    '        "diff": diff,',
    '        "timestamp": datetime.datetime.utcnow().isoformat()',
    '    }',
    '',
    'def main():',
    '    report = []',
    '    has_errors = False',
    '    for dev in DEVICES:',
    '        print(f"  Checking {dev[\"hostname\"]} ({dev[\"host\"]})...", end="", flush=True)',
    '        try:',
    '            conn_params = {k: dev[k] for k in ("host","device_type","username","password","secret")}',
    '            with ConnectHandler(**conn_params) as conn:',
    '                if dev.get("secret"): conn.enable()',
    '                result = drift_check(dev, conn)',
    '        except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '            result = {',
    '                "hostname": dev["hostname"], "platform": dev["platform"],',
    '                "status": "ERROR", "error": str(e),',
    '                "diff": [], "added_lines": 0, "removed_lines": 0,',
    '                "timestamp": datetime.datetime.utcnow().isoformat()',
    '            }',
    '            has_errors = True',
    '        status = result["status"]',
    '        if status == "IN_SYNC":',
    '            print(" IN_SYNC")',
    '        elif status == "DRIFT":',
    '            print(f" DRIFT +{result[\"added_lines\"]}/-{result[\"removed_lines\"]}")',
    '        else:',
    '            print(f" {status}: {result.get(\"error\", \"\")}")',
    '        report.append(result)',
    '',
    '    with open(REPORT_FILE, "w") as f:',
    '        json.dump(report, f, indent=2)',
    '',
    '    drifted = [r for r in report if r["status"] == "DRIFT"]',
    '    no_intended = [r for r in report if r["status"] == "NO_INTENDED"]',
    '    print(f"\\nDrift check complete:")',
    '    print(f"  In sync:     {sum(1 for r in report if r[\"status\"]==\"IN_SYNC\")}/{len(report)}")',
    '    print(f"  Drifted:     {len(drifted)}/{len(report)}")',
    '    if no_intended:',
    '        print(f"  No intended: {len(no_intended)} (configs not generated yet)")',
    '    print(f"  Report:      {REPORT_FILE}")',
    '    if drifted:',
    '        print("\\nDrifted devices:")',
    '        for r in drifted:',
    '            print(f"  {r[\"hostname\"]}: +{r[\"added_lines\"]} lines in running / -{r[\"removed_lines\"]} lines vs intended")',
    '            for line in r["diff"][:40]:  # show first 40 diff lines',
    '                print("    " + line)',
    '            if len(r["diff"]) > 40:',
    '                print(f"    ... ({len(r[\"diff\"]) - 40} more lines)")',
    '        sys.exit(1)',
    '    if has_errors:',
    '        sys.exit(2)',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
};

window.downloadDriftScript = function() {
  if (!STATE.devices || !STATE.devices.length) {
    if (window.showToast) window.showToast('Complete Step 1 first', 'warning');
    return;
  }
  var site   = STATE.siteCode || 'SITE';
  var script = window.genDriftScript(STATE.devices, STATE.configs, STATE);
  if (window.downloadFile) window.downloadFile('drift_check_' + site.toLowerCase() + '.py', script, 'text/plain');
};

// ─── G-27: Drift report renderer ─────────────────────────────────────────────

window.renderDriftReport = function(jsonStr) {
  var report;
  try { report = JSON.parse(jsonStr); } catch (e) {
    return '<p class="val-block val-block-error">Invalid JSON: ' + e.message + '</p>';
  }
  if (!Array.isArray(report) || !report.length) {
    return '<p class="empty-state">Report is empty or not an array.</p>';
  }

  var inSync     = report.filter(function(r) { return r.status === 'IN_SYNC'; }).length;
  var drifted    = report.filter(function(r) { return r.status === 'DRIFT'; }).length;
  var errors     = report.filter(function(r) { return r.status === 'ERROR'; }).length;
  var noIntended = report.filter(function(r) { return r.status === 'NO_INTENDED'; }).length;

  var summaryClass = drifted > 0 ? 'val-block val-block-error'
    : 'val-block val-block-error" style="background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.4)';
  var summaryIcon  = drifted > 0 ? '⚠ ' : '✓ ';
  var summaryText  = drifted > 0
    ? drifted + ' device(s) have configuration drift'
    : 'All devices are in sync with intended config';

  var summary = '<div class="' + summaryClass + '">'
    + '<div class="val-block-hdr">' + summaryIcon + summaryText + '</div>'
    + '<div style="margin-top:6px;font-size:12px;color:var(--text-dim)">'
    + 'In sync: ' + inSync + ' &nbsp;|&nbsp; Drifted: ' + drifted
    + (errors     ? ' &nbsp;|&nbsp; Errors: '     + errors     : '')
    + (noIntended ? ' &nbsp;|&nbsp; No intended: ' + noIntended : '')
    + '</div></div>';

  var rows = report.map(function(r) {
    var statusHtml, statusClass;
    if (r.status === 'IN_SYNC') {
      statusHtml  = '<span style="color:var(--success)">✓ IN_SYNC</span>';
      statusClass = '';
    } else if (r.status === 'DRIFT') {
      statusHtml  = '<span style="color:var(--danger)">⚠ DRIFT +' + r.added_lines + '/-' + r.removed_lines + '</span>';
      statusClass = 'diff-changed';
    } else if (r.status === 'ERROR') {
      statusHtml  = '<span style="color:var(--danger)">✗ ERROR</span>';
      statusClass = 'diff-changed';
    } else {
      statusHtml  = '<span style="color:var(--text-dim)">— ' + r.status + '</span>';
      statusClass = '';
    }

    var diffHtml = '';
    if (r.diff && r.diff.length) {
      var diffText = r.diff.join('\n');
      diffHtml = '<tr><td colspan="3" style="padding:0 8px 8px 24px;">'
        + '<pre class="config-pre" style="max-height:200px;font-size:11px;margin:4px 0 0;">'
        + diffText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        + '</pre></td></tr>';
    } else if (r.error) {
      diffHtml = '<tr><td colspan="3" style="padding:0 8px 8px 24px;color:var(--danger);font-size:12px;">'
        + r.error.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        + '</td></tr>';
    }

    return '<tr class="diff-device-hdr ' + statusClass + '">'
      + '<td><strong>' + (r.hostname || '?') + '</strong>'
      + ' <span class="platform-badge">' + (r.platform || '?') + '</span></td>'
      + '<td>' + statusHtml + '</td>'
      + '<td style="color:var(--text-dim);font-size:12px;">'
      + (r.timestamp ? r.timestamp.replace('T', ' ').slice(0, 19) : '—') + '</td>'
      + '</tr>'
      + diffHtml;
  }).join('');

  return summary
    + '<div style="overflow-x:auto;margin-top:12px;">'
    + '<table class="rollback-table diff-table">'
    + '<thead><tr><th>Device</th><th>Status</th><th>Timestamp</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
};

// ─── G-26: ECMP path count verification ──────────────────────────────────────
// Counts BGP next-hop (via) entries in route table — proxy for ECMP working.
// Expected = number of spine devices from BOM.
function _buildEcmpCheckPy(devices) {
  var spineCount = devices.filter(function(d) {
    return (d.role || d.subLayer || '').toLowerCase().includes('spine');
  }).length;
  var expected = Math.max(spineCount, 2);

  return [
    'EXPECTED_ECMP_PATHS = ' + expected + '  # spine count from BOM',
    '',
    'ECMP_BGP_CMD = {',
    '    "nxos":  "show ip route bgp",',
    '    "eos":   "show ip route bgp",',
    '    "junos": "show route protocol bgp",',
    '    "iosxe": "show ip route bgp",',
    '    "sonic": "show ip route bgp",',
    '}',
    '',
    'def check_ecmp_paths(dev, conn):',
    '    """Count BGP via-entries in route table — proxy for ECMP next-hop count."""',
    '    try:',
    '        cmd = ECMP_BGP_CMD.get(dev["platform"], "show ip route bgp")',
    '        out = conn.send_command(cmd, read_timeout=15)',
    '        return len([l for l in out.splitlines() if " via " in l.lower()])',
    '    except Exception:',
    '        return -1  # indeterminate',
  ].join('\n');
}

window.genPostCheckScript = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site = (state && state.siteCode) || 'SITE';

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Post-Deployment Verification & Diff',
    'Site: ' + site,
    'Generated: ' + new Date().toISOString(),
    '',
    'Usage:',
    '  export NET_USER=admin NET_PASS=secretpass',
    '  python3 post_check_' + site.toLowerCase() + '.py',
    '',
    'Reads: pre_baseline_' + site.toLowerCase() + '.json',
    'Output: post_report_' + site.toLowerCase() + '.json',
    '"""',
    '',
    'import os, json, sys, re, datetime',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    _buildInventoryPy(devices),
    '',
    _buildCommandsPy(),
    '',
    _buildReachabilityPy(devices),
    '',
    _buildEcmpCheckPy(devices),
    '',
    'BASELINE_FILE  = "pre_baseline_' + site.toLowerCase() + '.json"',
    'REPORT_FILE    = "post_report_' + site.toLowerCase() + '.json"',
    '',
    'def collect_device(dev):',
    '    platform = dev["platform"]',
    '    cmds = COMMANDS.get(platform, COMMANDS["nxos"])',
    '    results = {"hostname": dev["hostname"], "host": dev["host"],',
    '               "platform": platform, "timestamp": datetime.datetime.utcnow().isoformat(),',
    '               "commands": {}, "ping_failures": [], "ecmp_paths": -1, "reachable": False, "error": None}',
    '    try:',
    '        with ConnectHandler(**{k: dev[k] for k in',
    '                ("host","device_type","username","password","secret")}) as conn:',
    '            results["reachable"] = True',
    '            for key, cmd in cmds.items():',
    '                try:',
    '                    results["commands"][key] = conn.send_command(cmd)',
    '                except Exception as e:',
    '                    results["commands"][key] = "ERROR: " + str(e)',
    '            results["ping_failures"] = check_reachability(dev, conn)',
    '            results["ecmp_paths"]    = check_ecmp_paths(dev, conn)',
    '    except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '        results["error"] = str(e)',
    '    return results',
    '',
    'def extract_bgp_peer_count(output):',
    '    """Parse BGP peer count from summary output."""',
    '    match = re.search(r"(\\d+)\\s+(?:established|up)", output, re.IGNORECASE)',
    '    if match: return int(match.group(1))',
    '    established = len(re.findall(r"\\bEstablished\\b", output, re.IGNORECASE))',
    '    return established',
    '',
    'def extract_route_count(output):',
    '    """Parse total route count from route summary."""',
    '    match = re.search(r"Total\\s+(?:number of )?routes?[:\\s]+(\\d+)", output, re.IGNORECASE)',
    '    if match: return int(match.group(1))',
    '    matches = re.findall(r"^\\s*(\\d+)\\s+\\d+\\s+\\d+", output, re.MULTILINE)',
    '    if matches: return sum(int(m) for m in matches)',
    '    return -1',
    '',
    'def extract_interface_errors(output):',
    '    """Sum all input/output error counters from interface error output."""',
    '    total = 0',
    '    for match in re.finditer(r"(\\d+)\\s+(?:input\\s+errors?|CRC|giants|runts|output\\s+errors?|collisions)', +
    '                             output, re.IGNORECASE):',
    '        total += int(match.group(1))',
    '    return total',
    '',
    'def compare(pre, post):',
    '    """Return list of alert strings for a single device pair."""',
    '    alerts = []',
    '    if not post["reachable"]:',
    '        alerts.append("CRITICAL: device unreachable post-deployment")',
    '        return alerts',
    '    if not pre.get("reachable"):',
    '        return alerts  # no baseline to compare',
    '',
    '    pre_bgp  = extract_bgp_peer_count(pre["commands"].get("bgp", ""))',
    '    post_bgp = extract_bgp_peer_count(post["commands"].get("bgp", ""))',
    '    if pre_bgp > 0 and post_bgp < pre_bgp:',
    '        alerts.append(f"BGP: peer count dropped {pre_bgp} → {post_bgp}")',
    '',
    '    pre_rt  = extract_route_count(pre["commands"].get("routes", ""))',
    '    post_rt = extract_route_count(post["commands"].get("routes", ""))',
    '    if pre_rt > 0 and post_rt >= 0:',
    '        drop_pct = (pre_rt - post_rt) / pre_rt * 100',
    '        if drop_pct > 5:',
    '            alerts.append(f"ROUTES: count dropped {pre_rt} → {post_rt} ({drop_pct:.1f}% loss)")',
    '',
    '    pre_err  = extract_interface_errors(pre["commands"].get("iface", ""))',
    '    post_err = extract_interface_errors(post["commands"].get("iface", ""))',
    '    if post_err - pre_err > 100:',
    '        alerts.append(f"INTERFACE ERRORS: total errors increased {pre_err} → {post_err} (+{post_err - pre_err})")',
    '',
    '    for fail in post.get("ping_failures", []):',
    '        alerts.append(f"REACHABILITY: ping failed — {fail}")',
    '',
    '    ecmp = post.get("ecmp_paths", -1)',
    '    if ecmp == 0 and EXPECTED_ECMP_PATHS > 1:',
    '        alerts.append("ECMP: 0 BGP next-hops in route table — ECMP may not be functioning")',
    '    elif 0 < ecmp < EXPECTED_ECMP_PATHS and EXPECTED_ECMP_PATHS > 1:',
    '        alerts.append(f"ECMP: {ecmp} path(s) visible, expected ~{EXPECTED_ECMP_PATHS} (spine count) — partial ECMP")',
    '',
    '    return alerts',
    '',
    'def main():',
    '    try:',
    '        with open(BASELINE_FILE) as f:',
    '            baseline = json.load(f)',
    '    except FileNotFoundError:',
    '        print(f"ERROR: baseline file {BASELINE_FILE!r} not found.", file=sys.stderr)',
    '        print("Run pre_check first.", file=sys.stderr)',
    '        sys.exit(1)',
    '',
    '    pre_map = {d["hostname"]: d for d in baseline}',
    '    report  = []',
    '    total_alerts = 0',
    '',
    '    for dev in DEVICES:',
    '        print(f"  Checking {dev[\"hostname\"]}...", end="", flush=True)',
    '        post = collect_device(dev)',
    '        pre  = pre_map.get(dev["hostname"], {})',
    '        alerts = compare(pre, post)',
    '        total_alerts += len(alerts)',
    '        status = "ALERTS: " + str(len(alerts)) if alerts else "OK"',
    '        print(f" {status}")',
    '        for a in alerts:',
    '            print(f"    ! {a}")',
    '        report.append({"pre": pre, "post": post, "alerts": alerts})',
    '',
    '    with open(REPORT_FILE, "w") as f:',
    '        json.dump(report, f, indent=2)',
    '    print(f"\\nReport saved: {REPORT_FILE}")',
    '    if total_alerts:',
    '        print(f"TOTAL ALERTS: {total_alerts} — investigate before marking change complete.", file=sys.stderr)',
    '        sys.exit(2)',
    '    else:',
    '        print("All post-checks passed.")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
};

// ─── G-24: Batfish dry-run validation ────────────────────────────────────────
// Generates a Python script using pybatfish that semantically validates all
// device configs before deployment. Checks: undefined refs, BGP reachability,
// route existence to all loopbacks.

window.genBatfishScript = function(devices, configs, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site    = (state && state.siteCode) || 'SITE';
  configs = configs || {};

  // Build DEVICE_CONFIGS dict (base64-encoded to avoid escaping)
  function _b64(str) {
    try { return btoa(unescape(encodeURIComponent(str || ''))); }
    catch (e) { return btoa(str || ''); }
  }
  var cfgLines = ['DEVICE_CONFIGS_B64 = {'];
  devices.forEach(function(dev) {
    var cfg = configs[dev.instanceId] || '';
    cfgLines.push('    ' + JSON.stringify(dev.hostname) + ': ' + JSON.stringify(_b64(cfg)) + ',');
  });
  cfgLines.push('}');

  // Build LOOPBACKS dict
  var loLines = ['LOOPBACKS = {'];
  devices.forEach(function(dev) {
    loLines.push('    ' + JSON.stringify(dev.hostname) + ': ' + JSON.stringify(dev.loopback0 || ('10.0.0.' + (dev.unit || 1))) + ',');
  });
  loLines.push('}');

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Batfish Dry-Run Validation (G-24)',
    'Site: ' + site + ' | Generated: ' + new Date().toISOString(),
    '',
    'Semantically validates all device configs using Batfish before deployment.',
    'Checks: undefined references, BGP session reachability, route table coverage.',
    '',
    'Prerequisites:',
    '  pip install pybatfish pandas',
    '  docker run -d -p 9997:9997 -p 9996:9996 batfish/batfish',
    '',
    'Usage:',
    '  python3 batfish_validate_' + site.toLowerCase() + '.py',
    '',
    'Exit codes: 0 = all checks passed, 1 = failures found, 2 = Batfish error',
    '"""',
    '',
    'import os, sys, json, base64, pathlib, datetime',
    '',
    'try:',
    '    from pybatfish.client.session import Session',
    '    from pybatfish.datamodel import *',
    'except ImportError:',
    '    print("ERROR: pybatfish not installed. Run: pip install pybatfish pandas")',
    '    sys.exit(2)',
    '',
    cfgLines.join('\n'),
    '',
    loLines.join('\n'),
    '',
    'NETWORK  = "ndal-' + site.toLowerCase() + '"',
    'SNAPSHOT = "pre-deploy-" + datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")',
    'CONFIGS_DIR = pathlib.Path("batfish_configs_' + site.toLowerCase() + '")',
    'REPORT_FILE = "batfish_report_' + site.toLowerCase() + '.json"',
    '',
    '# Write configs from base64 to temp directory',
    'CONFIGS_DIR.mkdir(exist_ok=True)',
    'for hostname, b64 in DEVICE_CONFIGS_B64.items():',
    '    txt = base64.b64decode(b64.encode()).decode("utf-8")',
    '    if txt.strip():',
    '        (CONFIGS_DIR / (hostname + ".cfg")).write_text(txt)',
    '',
    '# Connect to Batfish',
    'try:',
    '    bf = Session(host="localhost", port_v2=9996)',
    '    bf.set_network(NETWORK)',
    '    bf.init_snapshot(str(CONFIGS_DIR), name=SNAPSHOT, overwrite=True)',
    '    print(f"Batfish: network={NETWORK} snapshot={SNAPSHOT}")',
    'except Exception as e:',
    '    print(f"ERROR: Cannot connect to Batfish: {e}")',
    '    print("Start Batfish: docker run -d -p 9997:9997 -p 9996:9996 batfish/batfish")',
    '    sys.exit(2)',
    '',
    'results = []',
    'has_failures = False',
    '',
    '# ── Check 1: Undefined references ────────────────────────────────────────',
    'print("\\n[1/3] Checking undefined references...", end="", flush=True)',
    'try:',
    '    df = bf.q.undefinedReferences().answer().frame()',
    '    if len(df) > 0:',
    '        print(f" WARN: {len(df)} undefined reference(s)")',
    '        has_failures = True',
    '        results.append({"check": "undefined_references", "status": "FAIL",',
    '                        "count": len(df), "sample": df.head(5).to_dict(orient="records")})',
    '    else:',
    '        print(" PASS")',
    '        results.append({"check": "undefined_references", "status": "PASS"})',
    'except Exception as e:',
    '    print(f" SKIP ({e})")',
    '    results.append({"check": "undefined_references", "status": "SKIP", "error": str(e)})',
    '',
    '# ── Check 2: BGP session reachability ────────────────────────────────────',
    'print("[2/3] Checking BGP session reachability...", end="", flush=True)',
    'try:',
    '    df = bf.q.bgpSessionStatus().answer().frame()',
    '    if len(df) == 0:',
    '        print(" SKIP (no BGP configured)")',
    '        results.append({"check": "bgp_sessions", "status": "SKIP"})',
    '    else:',
    '        not_est = df[df["Established_Status"] != "ESTABLISHED"]',
    '        if len(not_est) > 0:',
    '            print(f" FAIL: {len(not_est)} session(s) not established")',
    '            has_failures = True',
    '            results.append({"check": "bgp_sessions", "status": "FAIL",',
    '                            "total": len(df), "not_established": len(not_est),',
    '                            "sample": not_est.head(5).to_dict(orient="records")})',
    '        else:',
    '            print(f" PASS ({len(df)} session(s))")',
    '            results.append({"check": "bgp_sessions", "status": "PASS", "count": len(df)})',
    'except Exception as e:',
    '    print(f" SKIP ({e})")',
    '    results.append({"check": "bgp_sessions", "status": "SKIP", "error": str(e)})',
    '',
    '# ── Check 3: Routes to all loopbacks ─────────────────────────────────────',
    'print("[3/3] Checking loopback reachability...", end="", flush=True)',
    'try:',
    '    route_failures = []',
    '    for hostname, ip in LOOPBACKS.items():',
    '        df = bf.q.routes(network=ip + "/32").answer().frame()',
    '        if len(df) == 0:',
    '            route_failures.append(f"{hostname} ({ip})")',
    '    if route_failures:',
    '        print(f" FAIL: no route to {len(route_failures)} loopback(s)")',
    '        has_failures = True',
    '        results.append({"check": "loopback_reachability", "status": "FAIL",',
    '                        "missing": route_failures})',
    '    else:',
    '        print(f" PASS ({len(LOOPBACKS)} loopback(s) reachable)")',
    '        results.append({"check": "loopback_reachability", "status": "PASS",',
    '                        "count": len(LOOPBACKS)})',
    'except Exception as e:',
    '    print(f" SKIP ({e})")',
    '    results.append({"check": "loopback_reachability", "status": "SKIP", "error": str(e)})',
    '',
    '# ── Save report ──────────────────────────────────────────────────────────',
    'with open(REPORT_FILE, "w") as f:',
    '    json.dump(results, f, indent=2)',
    '',
    'passed  = sum(1 for r in results if r["status"] == "PASS")',
    'failed  = sum(1 for r in results if r["status"] == "FAIL")',
    'skipped = sum(1 for r in results if r["status"] == "SKIP")',
    'print(f"\\nResults: {passed} passed · {failed} failed · {skipped} skipped")',
    'print(f"Report:  {REPORT_FILE}")',
    'sys.exit(1 if has_failures else 0)',
    ''
  ].join('\n');
};
