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
      ? alerts.map(function(a) { return '<div class="diff-alert">⚠ ' + a + '</div>'; }).join('')
      : '<span style="color:var(--success)">No alerts</span>';

    // Build metric rows: bgp, routes, iface errors
    function metricRow(label, preVal, postVal, warnFn) {
      var changed = (preVal !== postVal && preVal !== '?' && postVal !== '?');
      var cls = (changed && warnFn && warnFn(preVal, postVal)) ? 'diff-changed' : '';
      return '<tr class="' + cls + '"><td style="padding-left:16px;color:var(--text-dim)">' + label + '</td>'
           + '<td>' + preVal + '</td><td>' + postVal + '</td></tr>';
    }

    var preCmd  = pre.commands  || {};
    var postCmd = post.commands || {};

    return '<tr class="diff-device-hdr"><td colspan="3">'
      + '<strong>' + hostname + '</strong> <span class="platform-badge">' + platform + '</span>'
      + ' &nbsp; pre: ' + ts_pre + ' &nbsp; post: ' + ts_post
      + ' &nbsp; ' + reachable + '</td></tr>'
      + '<tr><td style="padding-left:16px;color:var(--text-dim)">Alerts</td>'
      + '<td colspan="2">' + alertHtml + '</td></tr>'
      + metricRow('BGP output (sample)',
          (preCmd.bgp  || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          (postCmd.bgp || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          null)
      + metricRow('Route output (sample)',
          (preCmd.routes  || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          (postCmd.routes || '—').slice(0, 80).replace(/\n/g, ' ').trim(),
          null);
  }).join('');

  var summary = totalAlerts === 0
    ? '<div class="val-block val-block-error" style="background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.4);">'
      + '<div class="val-block-hdr" style="color:var(--success)">All post-checks passed — 0 alerts</div></div>'
    : '<div class="val-block val-block-error">'
      + '<div class="val-block-hdr">Post-check alerts (' + totalAlerts + ') — investigate before closing change</div></div>';

  return summary
    + '<div style="overflow-x:auto;margin-top:12px;">'
    + '<table class="rollback-table diff-table">'
    + '<thead><tr><th>Device / Metric</th><th>Pre-deploy baseline</th><th>Post-deploy state</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
};

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
    'BASELINE_FILE  = "pre_baseline_' + site.toLowerCase() + '.json"',
    'REPORT_FILE    = "post_report_' + site.toLowerCase() + '.json"',
    '',
    'def collect_device(dev):',
    '    platform = dev["platform"]',
    '    cmds = COMMANDS.get(platform, COMMANDS["nxos"])',
    '    results = {"hostname": dev["hostname"], "host": dev["host"],',
    '               "platform": platform, "timestamp": datetime.datetime.utcnow().isoformat(),',
    '               "commands": {}, "ping_failures": [], "reachable": False, "error": None}',
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
