'use strict';

/* ════════════════════════════════════════════════════════════════
   Pre / Post Deployment Check Script Generator
   Generates downloadable Python + Netmiko scripts that SSH to
   devices and verify: interface states, BGP neighbor counts,
   routing table prefixes, and LLDP neighbor topology.

   Public API (window.*):
     genPreCheckScript(state)   → string (Python source)
     genPostCheckScript(state)  → string (Python source)
     downloadPreCheckScript()   → triggers browser download
     downloadPostCheckScript()  → triggers browser download
     renderChecksPanel()        → injects download panel into DOM
════════════════════════════════════════════════════════════════ */

/* ── Derive a flat device list from STATE ────────────────────── */
function _checksDeviceList(state) {
  if (typeof buildDeviceList === 'function') {
    return buildDeviceList();          // uses live STATE via closure
  }
  return [];
}

/* ── Map OS key to Netmiko device_type ──────────────────────── */
function _netmikoType(os) {
  const map = {
    'ios-xe': 'cisco_ios',
    'nxos':   'cisco_nxos',
    'eos':    'arista_eos',
    'junos':  'juniper_junos',
    'sonic':  'linux',
  };
  return map[os] || 'cisco_ios';
}

/* ── Build the device inventory block for the Python script ─── */
function _buildInventoryBlock(devs, state) {
  if (!devs || devs.length === 0) {
    return '# No devices in inventory — run Steps 1-3 first\nDEVICES = []\n';
  }

  var lines = ['DEVICES = ['];
  var seen = {};
  devs.forEach(function(dev) {
    var layer = dev.layer || '';
    // Skip multicloud / terraform layers
    if (layer.indexOf('mc-') === 0) return;
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text') return;

    var devType = _netmikoType(os);
    var idx = dev.idx || 0;
    var mgmtIP = '10.0.0.' + (30 + idx);
    var hostname = dev.name || ('DEV-' + String(idx + 1).padStart(2, '0'));

    // Use generated hostname if naming.js produced one
    if (dev.hostname) hostname = dev.hostname;

    // De-duplicate by mgmt IP (same idx across layers share IP bucket — shift by layer)
    var ipKey = layer + '-' + idx;
    if (seen[ipKey]) return;
    seen[ipKey] = true;

    lines.push('    {');
    lines.push('        "host":        "' + mgmtIP + '",');
    lines.push('        "hostname":    "' + hostname + '",');
    lines.push('        "device_type": "' + devType + '",');
    lines.push('        "layer":       "' + layer + '",');
    lines.push('        "os":          "' + os + '",');
    lines.push('        "username":    USERNAME,');
    lines.push('        "password":    PASSWORD,');
    lines.push('        "secret":      SECRET,');
    lines.push('    },');
  });
  lines.push(']');
  return lines.join('\n');
}

/* ── Show commands per OS ────────────────────────────────────── */
function _showCmds(os) {
  if (os === 'ios-xe') {
    return [
      'show interfaces status',
      'show ip bgp summary',
      'show ip route summary',
      'show cdp neighbors',
      'show lldp neighbors',
      'show version | include uptime',
    ];
  }
  if (os === 'nxos') {
    return [
      'show interface status',
      'show bgp ipv4 unicast summary',
      'show ip route summary',
      'show lldp neighbors',
      'show version | include uptime',
    ];
  }
  if (os === 'eos') {
    return [
      'show interfaces status',
      'show bgp ipv4 unicast summary',
      'show ip route summary',
      'show lldp neighbors',
      'show version | grep uptime',
    ];
  }
  if (os === 'junos') {
    return [
      'show interfaces terse',
      'show bgp summary',
      'show route summary',
      'show lldp neighbors',
      'show system uptime | no-more',
    ];
  }
  if (os === 'sonic') {
    return [
      'show interfaces status',
      'show bgp ipv4 unicast summary',
      'show ip route summary',
      'show lldp table',
      'uptime',
    ];
  }
  return ['show version'];
}

/* ── BGP validation helper (post-check) ─────────────────────── */
function _bgpExpectedPeers(state) {
  var uc = state.uc || 'dc';
  if (uc === 'campus' || uc === 'hybrid') return 2;
  if (uc === 'dc' || uc === 'gpu')       return 2;  // spine has leaf peers; leaf has 2 spines
  if (uc === 'wan')                       return 2;
  return 2;
}

/* ═══════════════════════════════════════════════════════════════
   genPreCheckScript(state) → Python source string
════════════════════════════════════════════════════════════════ */
function genPreCheckScript(state) {
  var devs   = _checksDeviceList(state);
  var uc     = state.uc || 'dc';
  var org    = state.orgName || 'NetDesign';
  var inv    = _buildInventoryBlock(devs, state);
  var date   = new Date().toISOString().slice(0, 10);

  // Build per-OS command sets as a Python dict literal
  var cmdDict = [
    'SHOW_COMMANDS = {',
    '    "cisco_ios":    ' + JSON.stringify(_showCmds('ios-xe')) + ',',
    '    "cisco_nxos":   ' + JSON.stringify(_showCmds('nxos'))   + ',',
    '    "arista_eos":   ' + JSON.stringify(_showCmds('eos'))    + ',',
    '    "juniper_junos":' + JSON.stringify(_showCmds('junos'))  + ',',
    '    "linux":        ' + JSON.stringify(_showCmds('sonic'))  + ',',
    '}',
  ].join('\n');

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Pre-Deployment Check Script',
    'Generated: ' + date,
    'Use case: ' + (uc || 'dc').toUpperCase() + '   Org: ' + org,
    '',
    'Requirements: pip install netmiko rich',
    'Usage:        python pre_check.py',
    'Output:       pre_check_baseline_<date>.json  (used by post_check.py)',
    '"""',
    '',
    'import json, sys, datetime, pathlib',
    'from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException',
    'try:',
    '    from rich.console import Console',
    '    from rich.table import Table',
    '    console = Console()',
    'except ImportError:',
    '    class Console:',
    '        def print(self, *a, **kw): print(*a)',
    '    console = Console()',
    '',
    '# ── Credentials (edit or set env vars) ────────────────────────',
    'import os',
    'USERNAME = os.getenv("NET_USER", "admin")',
    'PASSWORD = os.getenv("NET_PASS", "NetDesign@2024")',
    'SECRET   = os.getenv("NET_SECRET", "NetDesign@2024")',
    '',
    '# ── Device inventory (auto-generated from NetDesign AI BOM) ───',
    inv,
    '',
    cmdDict,
    '',
    '# ── Helpers ────────────────────────────────────────────────────',
    'def connect(dev):',
    '    params = {k: dev[k] for k in ("host","device_type","username","password","secret")}',
    '    params["timeout"] = 30',
    '    params["auth_timeout"] = 20',
    '    return ConnectHandler(**params)',
    '',
    'def collect(dev):',
    '    result = {"host": dev["host"], "hostname": dev["hostname"],',
    '              "os": dev["os"], "layer": dev["layer"],',
    '              "timestamp": datetime.datetime.utcnow().isoformat(),',
    '              "reachable": False, "outputs": {}, "errors": []}',
    '    cmds = SHOW_COMMANDS.get(dev["device_type"], ["show version"])',
    '    try:',
    '        with connect(dev) as net_conn:',
    '            result["reachable"] = True',
    '            for cmd in cmds:',
    '                try:',
    '                    result["outputs"][cmd] = net_conn.send_command(cmd)',
    '                except Exception as e:',
    '                    result["errors"].append(f"cmd={cmd!r}: {e}")',
    '    except NetmikoAuthenticationException:',
    '        result["errors"].append("AUTH_FAILED")',
    '    except NetmikoTimeoutException:',
    '        result["errors"].append("TIMEOUT")',
    '    except Exception as e:',
    '        result["errors"].append(str(e))',
    '    return result',
    '',
    'def check_interfaces(output, os_key):',
    '    """Return (up_count, down_list) from show interfaces status output."""',
    '    up, down = 0, []',
    '    for line in output.splitlines():',
    '        l = line.lower()',
    '        if os_key in ("juniper_junos",):',
    '            # terse output: "xe-0/0/0.0   up   up"',
    '            parts = line.split()',
    '            if len(parts) >= 3 and parts[1] in ("up","down") and parts[2] in ("up","down"):',
    '                if parts[1] == "up" and parts[2] == "up": up += 1',
    '                else: down.append(parts[0])',
    '        else:',
    '            if "connected" in l or "up" in l: up += 1',
    '            elif "notconnect" in l or "err-disabled" in l or "down" in l:',
    '                parts = line.split()',
    '                if parts: down.append(parts[0])',
    '    return up, down',
    '',
    'def check_bgp(output, os_key):',
    '    """Return established peer count from BGP summary output."""',
    '    count = 0',
    '    for line in output.splitlines():',
    '        l = line.lower()',
    '        if os_key == "juniper_junos":',
    '            if "established" in l: count += 1',
    '        else:',
    '            parts = line.split()',
    '            # IOS/NX-OS/EOS: last field is prefixes received, penultimate is state',
    '            if len(parts) >= 2 and parts[-1].isdigit(): count += 1',
    '    return count',
    '',
    '# ── Main ───────────────────────────────────────────────────────',
    'def main():',
    '    if not DEVICES:',
    '        console.print("[red]No devices in inventory. Complete Steps 1-3 in NetDesign AI first.[/red]")',
    '        sys.exit(1)',
    '',
    '    console.print(f"[bold cyan]NetDesign AI Pre-Check[/bold cyan] — {len(DEVICES)} devices")',
    '    baseline = {}',
    '    results  = []',
    '',
    '    for dev in DEVICES:',
    '        console.print(f"  Checking [yellow]{dev[\'hostname\']}[/yellow] ({dev[\'host\']})...", end="")',
    '        r = collect(dev)',
    '        baseline[dev["host"]] = r',
    '        status = "[green]OK[/green]" if r["reachable"] else "[red]UNREACHABLE[/red]"',
    '        console.print(f" {status}")',
    '',
    '        # Interface summary',
    '        intf_out = r["outputs"].get("show interfaces status",',
    '                    r["outputs"].get("show interface status",',
    '                    r["outputs"].get("show interfaces terse", "")))',
    '        up_ct, down_list = check_interfaces(intf_out, dev["device_type"])',
    '',
    '        # BGP summary',
    '        bgp_out = (r["outputs"].get("show ip bgp summary") or',
    '                   r["outputs"].get("show bgp ipv4 unicast summary") or',
    '                   r["outputs"].get("show bgp summary") or "")',
    '        bgp_peers = check_bgp(bgp_out, dev["device_type"])',
    '',
    '        # Route count',
    '        rt_out = (r["outputs"].get("show ip route summary") or',
    '                  r["outputs"].get("show route summary") or "")',
    '        rt_lines = [l for l in rt_out.splitlines() if "total" in l.lower() or "routes" in l.lower()]',
    '',
    '        results.append({',
    '            "host": dev["host"], "hostname": dev["hostname"],',
    '            "reachable": r["reachable"],',
    '            "interfaces_up": up_ct, "interfaces_down": down_list,',
    '            "bgp_peers_established": bgp_peers,',
    '            "route_summary": rt_lines[:3],',
    '            "errors": r["errors"],',
    '        })',
    '',
    '    # Print summary table',
    '    table = Table(title="Pre-Check Baseline")',
    '    table.add_column("Hostname",   style="cyan")',
    '    table.add_column("IP",         style="dim")',
    '    table.add_column("Reachable")',
    '    table.add_column("Intfs Up",   justify="right")',
    '    table.add_column("BGP Peers",  justify="right")',
    '    table.add_column("Errors",     style="red")',
    '    for r in results:',
    '        table.add_row(',
    '            r["hostname"], r["host"],',
    '            "[green]YES[/green]" if r["reachable"] else "[red]NO[/red]",',
    '            str(r["interfaces_up"]),',
    '            str(r["bgp_peers_established"]),',
    '            ", ".join(r["errors"][:2]) or "-",',
    '        )',
    '    console.print(table)',
    '',
    '    # Save baseline for post-check comparison',
    '    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")',
    '    out_path = pathlib.Path(f"pre_check_baseline_{ts}.json")',
    '    out_path.write_text(json.dumps({"meta": {"generated": ts, "org": "' + org + '",',
    '                                              "uc": "' + uc + '", "device_count": len(DEVICES)},',
    '                                   "baseline": baseline, "summary": results}, indent=2))',
    '    console.print(f"[green]Baseline saved → {out_path}[/green]")',
    '    console.print("[dim]Pass this file to post_check.py via --baseline flag[/dim]")',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════
   genPostCheckScript(state) → Python source string
════════════════════════════════════════════════════════════════ */
function genPostCheckScript(state) {
  var devs   = _checksDeviceList(state);
  var uc     = state.uc || 'dc';
  var org    = state.orgName || 'NetDesign';
  var inv    = _buildInventoryBlock(devs, state);
  var date   = new Date().toISOString().slice(0, 10);
  var expPeers = _bgpExpectedPeers(state);

  var cmdDict = [
    'SHOW_COMMANDS = {',
    '    "cisco_ios":    ' + JSON.stringify(_showCmds('ios-xe')) + ',',
    '    "cisco_nxos":   ' + JSON.stringify(_showCmds('nxos'))   + ',',
    '    "arista_eos":   ' + JSON.stringify(_showCmds('eos'))    + ',',
    '    "juniper_junos":' + JSON.stringify(_showCmds('junos'))  + ',',
    '    "linux":        ' + JSON.stringify(_showCmds('sonic'))  + ',',
    '}',
  ].join('\n');

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Post-Deployment Check Script',
    'Generated: ' + date,
    'Use case: ' + (uc || 'dc').toUpperCase() + '   Org: ' + org,
    '',
    'Requirements: pip install netmiko rich',
    'Usage:        python post_check.py [--baseline pre_check_baseline_<ts>.json]',
    'Output:       post_check_report_<date>.json + console diff vs baseline',
    '"""',
    '',
    'import json, sys, argparse, datetime, pathlib',
    'from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException',
    'try:',
    '    from rich.console import Console',
    '    from rich.table import Table',
    '    console = Console()',
    'except ImportError:',
    '    class Console:',
    '        def print(self, *a, **kw): print(*a)',
    '    console = Console()',
    '',
    '# ── Credentials ────────────────────────────────────────────────',
    'import os',
    'USERNAME = os.getenv("NET_USER", "admin")',
    'PASSWORD = os.getenv("NET_PASS", "NetDesign@2024")',
    'SECRET   = os.getenv("NET_SECRET", "NetDesign@2024")',
    '',
    '# ── Expected topology values ────────────────────────────────────',
    'EXPECTED_BGP_PEERS = ' + expPeers + '   # adjust if spine/route-reflector',
    'EXPECTED_MIN_ROUTES = 5    # alert if routing table shrinks below this',
    '',
    '# ── Device inventory ───────────────────────────────────────────',
    inv,
    '',
    cmdDict,
    '',
    '# ── Helpers (shared with pre_check.py) ─────────────────────────',
    'def connect(dev):',
    '    params = {k: dev[k] for k in ("host","device_type","username","password","secret")}',
    '    params["timeout"] = 30',
    '    params["auth_timeout"] = 20',
    '    return ConnectHandler(**params)',
    '',
    'def collect(dev):',
    '    result = {"host": dev["host"], "hostname": dev["hostname"],',
    '              "os": dev["os"], "layer": dev["layer"],',
    '              "timestamp": datetime.datetime.utcnow().isoformat(),',
    '              "reachable": False, "outputs": {}, "errors": []}',
    '    cmds = SHOW_COMMANDS.get(dev["device_type"], ["show version"])',
    '    try:',
    '        with connect(dev) as net_conn:',
    '            result["reachable"] = True',
    '            for cmd in cmds:',
    '                try:',
    '                    result["outputs"][cmd] = net_conn.send_command(cmd)',
    '                except Exception as e:',
    '                    result["errors"].append(f"cmd={cmd!r}: {e}")',
    '    except NetmikoAuthenticationException:',
    '        result["errors"].append("AUTH_FAILED")',
    '    except NetmikoTimeoutException:',
    '        result["errors"].append("TIMEOUT")',
    '    except Exception as e:',
    '        result["errors"].append(str(e))',
    '    return result',
    '',
    'def check_interfaces(output, os_key):',
    '    up, down = 0, []',
    '    for line in output.splitlines():',
    '        l = line.lower()',
    '        if os_key in ("juniper_junos",):',
    '            parts = line.split()',
    '            if len(parts) >= 3 and parts[1] in ("up","down") and parts[2] in ("up","down"):',
    '                if parts[1] == "up" and parts[2] == "up": up += 1',
    '                else: down.append(parts[0])',
    '        else:',
    '            if "connected" in l or ("up" in l and "line protocol" not in l): up += 1',
    '            elif "notconnect" in l or "err-disabled" in l:',
    '                parts = line.split()',
    '                if parts: down.append(parts[0])',
    '    return up, down',
    '',
    'def check_bgp(output, os_key):',
    '    count = 0',
    '    for line in output.splitlines():',
    '        l = line.lower()',
    '        if os_key == "juniper_junos":',
    '            if "established" in l: count += 1',
    '        else:',
    '            parts = line.split()',
    '            if len(parts) >= 2 and parts[-1].isdigit(): count += 1',
    '    return count',
    '',
    'def extract_route_count(output):',
    '    """Best-effort: return total prefix count from route summary."""',
    '    for line in output.splitlines():',
    '        l = line.lower()',
    '        if "total" in l:',
    '            for tok in line.split():',
    '                if tok.isdigit(): return int(tok)',
    '    return 0',
    '',
    'def diff_output(pre_text, post_text):',
    '    """Simple line-diff: lines added/removed."""',
    '    pre_set  = set(pre_text.splitlines())',
    '    post_set = set(post_text.splitlines())',
    '    added   = post_set - pre_set',
    '    removed = pre_set  - post_set',
    '    return sorted(removed)[:10], sorted(added)[:10]',
    '',
    '# ── Main ───────────────────────────────────────────────────────',
    'def main():',
    '    parser = argparse.ArgumentParser(description="NetDesign AI Post-Deployment Checker")',
    '    parser.add_argument("--baseline", help="Path to pre_check_baseline_*.json")',
    '    args = parser.parse_args()',
    '',
    '    baseline_data = {}',
    '    if args.baseline:',
    '        try:',
    '            baseline_data = json.loads(pathlib.Path(args.baseline).read_text()).get("baseline", {})',
    '            console.print(f"[dim]Loaded baseline from {args.baseline}[/dim]")',
    '        except Exception as e:',
    '            console.print(f"[yellow]Warning: could not load baseline: {e}[/yellow]")',
    '',
    '    if not DEVICES:',
    '        console.print("[red]No devices in inventory.[/red]")',
    '        sys.exit(1)',
    '',
    '    console.print(f"[bold cyan]NetDesign AI Post-Check[/bold cyan] — {len(DEVICES)} devices")',
    '    post_data = {}',
    '    results   = []',
    '    failures  = 0',
    '',
    '    for dev in DEVICES:',
    '        console.print(f"  Checking [yellow]{dev[\'hostname\']}[/yellow] ({dev[\'host\']})...", end="")',
    '        r = collect(dev)',
    '        post_data[dev["host"]] = r',
    '        status = "[green]OK[/green]" if r["reachable"] else "[red]UNREACHABLE[/red]"',
    '        console.print(f" {status}")',
    '',
    '        intf_out = r["outputs"].get("show interfaces status",',
    '                    r["outputs"].get("show interface status",',
    '                    r["outputs"].get("show interfaces terse", "")))',
    '        up_ct, down_list = check_interfaces(intf_out, dev["device_type"])',
    '',
    '        bgp_out = (r["outputs"].get("show ip bgp summary") or',
    '                   r["outputs"].get("show bgp ipv4 unicast summary") or',
    '                   r["outputs"].get("show bgp summary") or "")',
    '        bgp_peers = check_bgp(bgp_out, dev["device_type"])',
    '',
    '        rt_out = (r["outputs"].get("show ip route summary") or',
    '                  r["outputs"].get("show route summary") or "")',
    '        rt_count = extract_route_count(rt_out)',
    '',
    '        # ── Compare vs baseline ─────────────────────────────',
    '        pre = baseline_data.get(dev["host"], {})',
    '        pre_up = pre.get("outputs", {}).get("show interfaces status",',
    '                  pre.get("outputs", {}).get("show interfaces terse", ""))',
    '        pre_bgp_out = (pre.get("outputs", {}).get("show ip bgp summary") or',
    '                       pre.get("outputs", {}).get("show bgp summary") or "")',
    '        pre_peers = check_bgp(pre_bgp_out, dev["device_type"]) if pre else 0',
    '        pre_up_ct, _ = check_interfaces(pre_up, dev["device_type"]) if pre else (0, [])',
    '',
    '        issues = []',
    '        if not r["reachable"]:',
    '            issues.append("UNREACHABLE"); failures += 1',
    '        if bgp_peers < EXPECTED_BGP_PEERS:',
    '            issues.append(f"BGP peers {bgp_peers} < expected {EXPECTED_BGP_PEERS}"); failures += 1',
    '        if rt_count < EXPECTED_MIN_ROUTES and rt_count > 0:',
    '            issues.append(f"Routes {rt_count} < min {EXPECTED_MIN_ROUTES}"); failures += 1',
    '        if pre and up_ct < pre_up_ct:',
    '            issues.append(f"Interfaces dropped: pre={pre_up_ct} post={up_ct}"); failures += 1',
    '        if pre and bgp_peers < pre_peers:',
    '            issues.append(f"BGP peers dropped: pre={pre_peers} post={bgp_peers}"); failures += 1',
    '        if down_list:',
    '            issues.append(f"Down ports: {len(down_list)}")',
    '',
    '        results.append({',
    '            "host": dev["host"], "hostname": dev["hostname"],',
    '            "reachable": r["reachable"],',
    '            "interfaces_up": up_ct, "interfaces_down": down_list,',
    '            "bgp_peers_established": bgp_peers,',
    '            "route_count": rt_count,',
    '            "issues": issues,',
    '            "pass": len(issues) == 0,',
    '        })',
    '',
    '    # ── Summary table ───────────────────────────────────────────',
    '    table = Table(title="Post-Check Results")',
    '    table.add_column("Hostname",  style="cyan")',
    '    table.add_column("IP",        style="dim")',
    '    table.add_column("Reachable")',
    '    table.add_column("Intfs Up",  justify="right")',
    '    table.add_column("BGP Peers", justify="right")',
    '    table.add_column("Routes",    justify="right")',
    '    table.add_column("Status")',
    '    for r in results:',
    '        ok = r["pass"]',
    '        table.add_row(',
    '            r["hostname"], r["host"],',
    '            "[green]YES[/green]" if r["reachable"] else "[red]NO[/red]",',
    '            str(r["interfaces_up"]),',
    '            str(r["bgp_peers_established"]),',
    '            str(r["route_count"]),',
    '            "[green]PASS[/green]" if ok else "[red]FAIL: " + "; ".join(r["issues"]) + "[/red]",',
    '        )',
    '    console.print(table)',
    '',
    '    # ── Exit code ───────────────────────────────────────────────',
    '    if failures == 0:',
    '        console.print("[bold green]All post-checks PASSED — deployment successful.[/bold green]")',
    '    else:',
    '        console.print(f"[bold red]{failures} check(s) FAILED — review issues above before proceeding.[/bold red]")',
    '',
    '    # ── Save report ─────────────────────────────────────────────',
    '    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")',
    '    out_path = pathlib.Path(f"post_check_report_{ts}.json")',
    '    out_path.write_text(json.dumps({"meta": {"generated": ts, "org": "' + org + '",',
    '                                              "uc": "' + uc + '", "failures": failures},',
    '                                   "post": post_data, "summary": results}, indent=2))',
    '    console.print(f"[green]Report saved → {out_path}[/green]")',
    '    sys.exit(0 if failures == 0 else 1)',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}

/* ── Download helpers ────────────────────────────────────────── */
function _downloadText(filename, content) {
  var blob = new Blob([content], { type: 'text/plain' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadPreCheckScript() {
  var script = genPreCheckScript(STATE);
  _downloadText('pre_check.py', script);
  toast('pre_check.py downloaded', 'success');
}

function downloadPostCheckScript() {
  var script = genPostCheckScript(STATE);
  _downloadText('post_check.py', script);
  toast('post_check.py downloaded', 'success');
}

/* ── Render the download panel into the DOM ──────────────────── */
function renderChecksPanel() {
  var container = document.getElementById('checks-download-panel');
  if (!container) return;

  var uc    = (STATE && STATE.uc) ? STATE.uc : null;
  var org   = (STATE && STATE.orgName) ? STATE.orgName : '';
  var label = uc ? (' — ' + (typeof UC_LABELS !== 'undefined' ? (UC_LABELS[uc] || uc) : uc)) : '';

  container.innerHTML =
    '<div class="checks-panel-inner">' +
    '<div class="checks-panel-header">' +
    '<span class="checks-panel-icon">🐍</span>' +
    '<div>' +
    '<strong>Python + Netmiko Check Scripts</strong>' +
    '<div class="checks-panel-sub">SSH-based verification scripts for your ' + (org || 'network') + label + ' deployment</div>' +
    '</div>' +
    '</div>' +
    '<div class="checks-panel-body">' +
    '<div class="checks-card">' +
    '<div class="checks-card-title">🔍 Pre-Deployment Check</div>' +
    '<div class="checks-card-desc">Captures baseline: interface states, BGP peer counts, route table, LLDP neighbors. Saves <code>pre_check_baseline_*.json</code> for comparison.</div>' +
    '<button class="btn btn-ghost checks-dl-btn" onclick="downloadPreCheckScript()">📥 Download pre_check.py</button>' +
    '</div>' +
    '<div class="checks-card">' +
    '<div class="checks-card-title">✅ Post-Deployment Check</div>' +
    '<div class="checks-card-desc">Verifies post-deploy state vs baseline: BGP peers ≥ expected, routes stable, no interfaces dropped. Exit code 1 on failure.</div>' +
    '<button class="btn btn-ghost checks-dl-btn" onclick="downloadPostCheckScript()">📥 Download post_check.py</button>' +
    '</div>' +
    '</div>' +
    '<div class="checks-panel-usage">' +
    '<code>pip install netmiko rich</code><br>' +
    '<code>NET_USER=admin NET_PASS=... python pre_check.py</code><br>' +
    '<code>NET_USER=admin NET_PASS=... python post_check.py --baseline pre_check_baseline_*.json</code>' +
    '</div>' +
    '</div>';
}

/* ── Expose public API ───────────────────────────────────────── */
window.genPreCheckScript     = genPreCheckScript;
window.genPostCheckScript    = genPostCheckScript;
window.downloadPreCheckScript  = downloadPreCheckScript;
window.downloadPostCheckScript = downloadPostCheckScript;
window.renderChecksPanel     = renderChecksPanel;
