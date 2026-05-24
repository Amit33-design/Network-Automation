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
    'BASELINE_FILE  = "pre_baseline_' + site.toLowerCase() + '.json"',
    'REPORT_FILE    = "post_report_' + site.toLowerCase() + '.json"',
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
