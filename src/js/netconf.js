'use strict';

/* ════════════════════════════════════════════════════════════════
   NETCONF / eAPI Config Push Script Generator
   Generates a Python script that pushes pre-generated configs to
   all BOM devices via vendor-appropriate modern APIs:

     JunOS  → ncclient NETCONF load-configuration text + commit
     IOS-XE → ncclient NETCONF + cisco-ia CLI service RPC
     NX-OS  → ncclient NETCONF native YANG edit-config
     EOS    → Arista eAPI runCmds over HTTPS JSON-RPC
     SONiC  → SONiC mgmt REST API (OpenConfig RESTCONF)

   Public API (window.*):
     genNetconfPushScript(state)  → string (Python source)
     downloadNetconfScript()      → triggers browser download
     renderNetconfPanel()         → injects download panel into DOM
════════════════════════════════════════════════════════════════ */

/* ── Build device inventory list from BOM ────────────────────── */
function _ncDeviceList() {
  if (typeof buildDeviceList !== 'function') return [];
  var devs = buildDeviceList();
  var result = [];
  var seen = {};

  devs.forEach(function (dev) {
    var layer = dev.layer || '';
    if (layer.indexOf('mc-') === 0) return;      // skip multicloud
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text') return;

    // mgmt IP: same 10.0.0.31+ convention as checks.js
    var ipIdx = result.length;
    var mgmtIP = '10.0.0.' + (31 + ipIdx);
    var hostname = (typeof generateHostnames === 'function')
      ? (generateHostnames([dev], STATE)[dev.id] || dev.name)
      : dev.name;
    if (seen[hostname]) return;
    seen[hostname] = true;
    result.push({ dev: dev, hostname: hostname, layer: layer, os: os, mgmtIP: mgmtIP });
  });

  return result;
}

/* ── Base64-encode UTF-8 text for safe Python embedding ──────── */
function _b64Encode(str) {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    return btoa(str.replace(/[^\x00-\x7F]/g, '?'));
  }
}

/* ── Generate the Python NETCONF push script ─────────────────── */
function genNetconfPushScript(state) {
  var devs    = _ncDeviceList();
  var date    = new Date().toISOString().slice(0, 10);
  var orgName = (state && state.orgName) ? String(state.orgName).replace(/"/g, '\\"') : 'MyOrg';
  var uc      = (state && state.uc) || 'campus';

  // Build DEVICES list (Python) and CONFIGS dict (base64-encoded)
  var deviceLines  = [];
  var configLines  = [];

  devs.forEach(function (d) {
    deviceLines.push(
      '    {"hostname": "' + d.hostname + '", "host": "' + d.mgmtIP + '", "os": "' + d.os + '"},'
    );
    var configText = '';
    if (typeof generateConfig === 'function') {
      try { configText = generateConfig(d.dev, d.os); } catch (e) { configText = '# Config error: ' + e.message; }
    } else {
      configText = '# generateConfig() not available — run Steps 1-5 first';
    }
    configLines.push('    "' + d.hostname + '": b64decode("""' + _b64Encode(configText) + '""").decode("utf-8"),');
  });

  if (deviceLines.length === 0) {
    deviceLines.push('    # No devices — complete Steps 1-3 first');
    configLines.push('    # No configs');
  }

  var lines = [];

  // ── Script header ────────────────────────────────────────────
  lines.push(
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — NETCONF / eAPI Config Push',
    'Organisation : ' + orgName,
    'Use-case     : ' + uc,
    'Generated    : ' + date,
    '',
    'Pushes pre-generated device configs to all BOM devices:',
    '  JunOS  — ncclient NETCONF load-configuration text + commit',
    '  IOS-XE — ncclient NETCONF + cisco-ia CLI service RPC',
    '  NX-OS  — ncclient NETCONF native YANG edit-config',
    '  EOS    — Arista eAPI runCmds (HTTPS JSON-RPC)',
    '  SONiC  — SONiC mgmt REST API (OpenConfig RESTCONF)',
    '',
    'Install:',
    '  pip install ncclient requests rich',
    '',
    'Usage:',
    '  python netconf_push.py                    # push all devices',
    '  python netconf_push.py --dry-run           # validate connectivity only',
    '  python netconf_push.py --device CORE-01   # push one device',
    '  python netconf_push.py --no-commit         # skip commit step',
    '  python netconf_push.py --yes               # skip confirmation prompt',
    '',
    'Environment variables:',
    '  NETCONF_USER      (default: admin)',
    '  NETCONF_PASSWORD  (default: Admin123!)',
    '"""',
    '',
    'import os, sys, json, argparse, textwrap',
    'from base64 import b64decode',
    'from datetime import datetime',
    'from pathlib import Path',
    '',
    'try:',
    '    from rich.console import Console',
    '    from rich.table import Table',
    '    console = Console()',
    '    RICH = True',
    'except ImportError:',
    '    RICH = False',
    '    console = None',
    '',
    'try:',
    '    from ncclient import manager',
    '    from ncclient.xml_ import to_ele',
    '    NCCLIENT = True',
    'except ImportError:',
    '    print("⚠  ncclient not found — install: pip install ncclient")',
    '    NCCLIENT = False',
    '',
    'try:',
    '    import requests',
    '    requests.packages.urllib3.disable_warnings()',
    '    REQUESTS = True',
    'except ImportError:',
    '    print("⚠  requests not found — install: pip install requests")',
    '    REQUESTS = False',
    '',
    'USER   = os.environ.get("NETCONF_USER",     "admin")',
    'PASSWD = os.environ.get("NETCONF_PASSWORD", "Admin123!")',
    '',
    '# ─────────────────────────────────────────────────────────────',
    '# Device Inventory (auto-generated from BOM)',
    '# ─────────────────────────────────────────────────────────────',
    'DEVICES = ['
  );
  deviceLines.forEach(function (l) { lines.push(l); });
  lines.push(
    ']',
    '',
    '# ─────────────────────────────────────────────────────────────',
    '# Pre-generated Configs  (base64-encoded at generation time)',
    '# ─────────────────────────────────────────────────────────────',
    'CONFIGS = {'
  );
  configLines.forEach(function (l) { lines.push(l); });
  lines.push(
    '}',
    '',
    '# ─────────────────────────────────────────────────────────────',
    '# Vendor push functions',
    '# ─────────────────────────────────────────────────────────────',
    '',
    'def _log(msg):',
    '    if RICH and console:',
    '        console.print(msg)',
    '    else:',
    '        clean = msg.replace("[green]","").replace("[/green]","").replace("[red]","").replace("[/red]","").replace("[bold]","").replace("[/bold]","")',
    '        print(clean)',
    '',
    '',
    'def push_junos(host, hostname, config_text, dry_run, no_commit):',
    '    """JunOS — NETCONF load-configuration text merge + commit"""',
    '    if not NCCLIENT:',
    '        return False, "ncclient not installed"',
    '    try:',
    '        with manager.connect(',
    '            host=host, port=830, username=USER, password=PASSWD,',
    '            hostkey_verify=False, timeout=60,',
    '            device_params={"name": "junos"}',
    '        ) as m:',
    '            if dry_run:',
    '                caps = list(m.server_capabilities)',
    '                return True, f"DRY-RUN: connected, {len(caps)} capabilities"',
    '            m.lock(target="candidate")',
    '            try:',
    '                m.load_configuration(format="text", action="merge",',
    '                                     config=config_text)',
    '                if no_commit:',
    '                    m.discard_changes()',
    '                    return True, "loaded (discarded — no-commit mode)"',
    '                m.commit()',
    '                return True, "loaded + committed"',
    '            finally:',
    '                try: m.unlock(target="candidate")',
    '                except: pass',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '',
    'def push_iosxe(host, hostname, config_text, dry_run, no_commit):',
    '    """IOS-XE — NETCONF with Cisco-IOS-XE-native YANG + cisco-ia CLI"""',
    '    if not NCCLIENT:',
    '        return False, "ncclient not installed"',
    '    try:',
    '        with manager.connect(',
    '            host=host, port=830, username=USER, password=PASSWD,',
    '            hostkey_verify=False, timeout=60,',
    '            device_params={"name": "iosxe"}',
    '        ) as m:',
    '            if dry_run:',
    '                caps = list(m.server_capabilities)',
    '                return True, f"DRY-RUN: connected, {len(caps)} capabilities"',
    '            # Step 1: push hostname via native YANG (reliable on IOS-XE 16.x+)',
    '            hostname_cfg = f"""<config>',
    '  <native xmlns=\\"http://cisco.com/ns/yang/Cisco-IOS-XE-native\\">',
    '    <hostname>{hostname}</hostname>',
    '  </native>',
    '</config>"""',
    '            m.edit_config(target="running", config=hostname_cfg)',
    '            # Step 2: invoke cisco-ia sync-from to pull startup→running',
    '            cli_lines = [l for l in config_text.splitlines()',
    '                         if l.strip() and not l.strip().startswith("!")]',
    '            msg_parts = [f"hostname pushed ({len(cli_lines)} CLI lines)"]',
    '            if not no_commit:',
    '                ia_rpc = (\'<cisco-ia:sync-from\'',
    '                          \' xmlns:cisco-ia="http://cisco.com/yang/cisco-ia"/>\')',
    '                try:',
    '                    m.dispatch(to_ele(ia_rpc))',
    '                    msg_parts.append("cisco-ia sync invoked")',
    '                except Exception:',
    '                    msg_parts.append("cisco-ia sync skipped (IOS-XE <16.12)")',
    '            return True, "; ".join(msg_parts)',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '',
    'def push_nxos(host, hostname, config_text, dry_run, no_commit):',
    '    """NX-OS — NETCONF native YANG (hostname + advisory for full config)"""',
    '    if not NCCLIENT:',
    '        return False, "ncclient not installed"',
    '    try:',
    '        with manager.connect(',
    '            host=host, port=830, username=USER, password=PASSWD,',
    '            hostkey_verify=False, timeout=60,',
    '            device_params={"name": "nexus"}',
    '        ) as m:',
    '            if dry_run:',
    '                caps = list(m.server_capabilities)',
    '                return True, f"DRY-RUN: connected, {len(caps)} capabilities"',
    '            # Hostname via Cisco-NX-OS-device YANG model',
    '            sys_cfg = f"""<config>',
    '  <System xmlns=\\"http://cisco.com/ns/yang/cisco-nx-os-device\\">',
    '    <name>{hostname}</name>',
    '  </System>',
    '</config>"""',
    '            m.edit_config(target="running", config=sys_cfg)',
    '            cli_lines = [l for l in config_text.splitlines()',
    '                         if l.strip() and not l.strip().startswith("!")]',
    '            return True, f"hostname pushed ({len(cli_lines)} CLI lines — use ansible role for full NX-OS config)"',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '',
    'def push_eos(host, hostname, config_text, dry_run, no_commit):',
    '    """EOS — Arista eAPI runCmds over HTTPS JSON-RPC (port 443)"""',
    '    if not REQUESTS:',
    '        return False, "requests not installed"',
    '    commands = [l.rstrip() for l in config_text.splitlines()',
    '                if l.strip() and not l.strip().startswith("!")]',
    '    if dry_run:',
    '        return True, f"DRY-RUN: {len(commands)} commands queued"',
    '    url = f"https://{host}/command-api"',
    '    payload = {',
    '        "jsonrpc": "2.0",',
    '        "method": "runCmds",',
    '        "id": 1,',
    '        "params": {',
    '            "version": 1,',
    '            "cmds": ["enable", "configure"] + commands,',
    '            "format": "json"',
    '        }',
    '    }',
    '    try:',
    '        r = requests.post(url, json=payload,',
    '                          auth=(USER, PASSWD), verify=False, timeout=60)',
    '        r.raise_for_status()',
    '        resp = r.json()',
    '        errs = [str(x.get("errors")) for x in resp.get("result", [])',
    '                if isinstance(x, dict) and x.get("errors")]',
    '        if errs:',
    '            return False, f"eAPI errors: {errs}"',
    '        return True, f"eAPI OK ({r.status_code}): {len(commands)} cmds applied"',
    '    except requests.HTTPError as e:',
    '        return False, f"HTTP {e.response.status_code}: {e}"',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '',
    'def push_sonic(host, hostname, config_text, dry_run, no_commit):',
    '    """SONiC — mgmt REST API (OpenConfig RESTCONF on port 443)"""',
    '    if not REQUESTS:',
    '        return False, "requests not installed"',
    '    if dry_run:',
    '        return True, f"DRY-RUN: target {host} (skipping REST)"',
    '    try:',
    '        url = f"https://{host}/restconf/data/openconfig-system:system/config/hostname"',
    '        r = requests.put(',
    '            url,',
    '            json={"openconfig-system:hostname": hostname},',
    '            auth=(USER, PASSWD), verify=False, timeout=30',
    '        )',
    '        r.raise_for_status()',
    '        return True, (f"REST {r.status_code} hostname set; "',
    '                      "apply full config: sudo sonic-cfggen -j /etc/sonic/config_db.json --write-to-db")',
    '    except requests.HTTPError as e:',
    '        return False, f"HTTP {e.response.status_code}: {e}"',
    '    except Exception as e:',
    '        return False, str(e)',
    '',
    '',
    'PUSH_FNS = {',
    '    "junos":  push_junos,',
    '    "ios-xe": push_iosxe,',
    '    "nxos":   push_nxos,',
    '    "eos":    push_eos,',
    '    "sonic":  push_sonic,',
    '}',
    '',
    '',
    '# ─────────────────────────────────────────────────────────────',
    '# Summary table',
    '# ─────────────────────────────────────────────────────────────',
    '',
    'def _print_table(results):',
    '    if RICH and console:',
    '        t = Table(title="Push Results", show_header=True, header_style="bold cyan")',
    '        t.add_column("Hostname",  style="bold")',
    '        t.add_column("OS")',
    '        t.add_column("Status")',
    '        t.add_column("Message")',
    '        for r in results:',
    '            st = "[green]✓ OK[/green]" if r["ok"] else "[red]✗ FAIL[/red]"',
    '            t.add_row(r["hostname"], r["os"], st, r["msg"])',
    '        console.print(t)',
    '    else:',
    '        print(f"\\n{"Hostname":<20} {"OS":<10} {"Status":<8} Message")',
    '        print("-" * 80)',
    '        for r in results:',
    '            st = "OK" if r["ok"] else "FAIL"',
    '            print(f\'{r["hostname"]:<20} {r["os"]:<10} {st:<8} {r["msg"]}\')',
    '',
    '',
    '# ─────────────────────────────────────────────────────────────',
    '# Main',
    '# ─────────────────────────────────────────────────────────────',
    '',
    'def main():',
    '    ap = argparse.ArgumentParser(',
    '        description="NetDesign AI — NETCONF/eAPI config push",',
    '        formatter_class=argparse.RawDescriptionHelpFormatter',
    '    )',
    '    ap.add_argument("--dry-run",  action="store_true",',
    '                    help="validate connectivity only, no config changes")',
    '    ap.add_argument("--device",   metavar="HOSTNAME",',
    '                    help="push to a single device (by hostname)")',
    '    ap.add_argument("--no-commit",action="store_true",',
    '                    help="skip commit (JunOS: discard-changes)")',
    '    ap.add_argument("--yes",      action="store_true",',
    '                    help="skip interactive confirmation")',
    '    args = ap.parse_args()',
    '',
    '    targets = [d for d in DEVICES',
    '               if args.device is None or d["hostname"] == args.device]',
    '    if not targets:',
    '        print(f"No device matching --device {args.device!r}")',
    '        sys.exit(1)',
    '',
    '    mode = "DRY-RUN" if args.dry_run else "LIVE PUSH"',
    '    _log(f"\\n[bold]NetDesign AI — NETCONF/eAPI Config Push  [{mode}][/bold]")',
    '    _log(f"Org     : ' + orgName + '")',
    '    _log(f"UC      : ' + uc + '")',
    '    _log(f"Devices : {len(targets)}")',
    '    _log("")',
    '',
    '    if not args.dry_run and not args.yes:',
    '        _log(f"[bold]⚠  About to push configs to {len(targets)} device(s).[/bold]")',
    '        ans = input("  Type YES to continue: ").strip()',
    '        if ans != "YES":',
    '            print("Aborted.")',
    '            sys.exit(0)',
    '',
    '    results = []',
    '    for dev in targets:',
    '        hn     = dev["hostname"]',
    '        os_key = dev["os"]',
    '        host   = dev["host"]',
    '        config = CONFIGS.get(hn, "")',
    '        fn     = PUSH_FNS.get(os_key, push_iosxe)',
    '        _log(f"  → {hn} ({os_key}) @ {host} ...", )',
    '        ok, msg = fn(host, hn, config, args.dry_run, args.no_commit)',
    '        status  = "[green]✓ OK[/green]" if ok else "[red]✗ FAIL[/red]"',
    '        _log(f"    {status}: {msg}")',
    '        results.append({"hostname": hn, "os": os_key, "ok": ok, "msg": msg})',
    '',
    '    _print_table(results)',
    '',
    '    passed = sum(1 for r in results if r["ok"])',
    '    failed = len(results) - passed',
    '    _log(f"\\n[bold]Result: {passed}/{len(results)} succeeded[/bold]")',
    '',
    '    report = Path(f"netconf_push_{datetime.now().strftime(\'%Y%m%d_%H%M%S\')}.json")',
    '    report.write_text(json.dumps(results, indent=2))',
    '    _log(f"Report: {report}")',
    '',
    '    if failed > 0:',
    '        sys.exit(1)',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()'
  );

  return lines.join('\n');
}

/* ── Download trigger ────────────────────────────────────────── */
function downloadNetconfScript() {
  var src = genNetconfPushScript(STATE);
  var blob = new Blob([src], { type: 'text/x-python' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'netconf_push.py';
  a.click();
  URL.revokeObjectURL(url);
  if (typeof toast === 'function') toast('netconf_push.py downloaded', 'success');
}

/* ── Render download panel into #netconf-panel ───────────────── */
function renderNetconfPanel() {
  var el = document.getElementById('netconf-panel');
  if (!el) return;

  var devs    = _ncDeviceList();
  var nDevs   = devs.length;
  var vendors = [];
  var vSeen   = {};
  devs.forEach(function (d) {
    if (!vSeen[d.os]) { vSeen[d.os] = true; vendors.push(d.os); }
  });
  var vendorStr = vendors.length ? vendors.join(', ') : 'none';

  var apiMap = {
    'junos':  { label: 'JunOS',  detail: 'NETCONF + load-configuration text + commit' },
    'ios-xe': { label: 'IOS-XE', detail: 'NETCONF + cisco-ia CLI service RPC' },
    'nxos':   { label: 'NX-OS',  detail: 'NETCONF native YANG (Cisco-NX-OS-device)' },
    'eos':    { label: 'EOS',    detail: 'Arista eAPI runCmds (HTTPS JSON-RPC)' },
    'sonic':  { label: 'SONiC',  detail: 'OpenConfig RESTCONF REST API' },
  };

  var tableRows = vendors.map(function (os) {
    var info = apiMap[os] || { label: os, detail: '–' };
    return '<tr><td style="padding:.3rem .6rem;border-bottom:1px solid var(--bg3)"><code>' +
      info.label + '</code></td><td style="padding:.3rem .6rem;border-bottom:1px solid var(--bg3);color:var(--txt2);font-size:.78rem">' +
      info.detail + '</td></tr>';
  }).join('');

  el.innerHTML = [
    '<div class="checks-panel-inner" style="border-radius:10px">',
    '  <div class="checks-panel-header">',
    '    <span class="checks-panel-icon">🔌</span>',
    '    <div>',
    '      <div style="font-size:.88rem;font-weight:700;color:var(--txt0)">NETCONF / eAPI Config Push</div>',
    '      <div class="checks-panel-sub">Python · ncclient + requests · ' + nDevs + ' device' + (nDevs !== 1 ? 's' : '') + ' · ' + vendorStr + '</div>',
    '    </div>',
    '  </div>',
    '  <p style="margin:0 0 .75rem;color:var(--txt2);font-size:.83rem;line-height:1.5">',
    '    Pushes the configs generated in Step 5 to all BOM devices using vendor-appropriate',
    '    modern APIs — no CLI screen-scraping. Supports <code>--dry-run</code>,',
    '    <code>--device HOSTNAME</code>, and <code>--no-commit</code>.',
    '  </p>',
    nDevs > 0 && tableRows
      ? '<table style="width:100%;border-collapse:collapse;margin-bottom:.85rem"><thead><tr>' +
        '<th style="text-align:left;padding:.3rem .6rem;background:var(--bg3);border-bottom:2px solid var(--border);font-size:.77rem;color:var(--txt1)">OS</th>' +
        '<th style="text-align:left;padding:.3rem .6rem;background:var(--bg3);border-bottom:2px solid var(--border);font-size:.77rem;color:var(--txt1)">Push method</th>' +
        '</tr></thead><tbody>' + tableRows + '</tbody></table>'
      : '<p style="color:var(--txt3);font-size:.82rem;margin:.5rem 0">Complete Steps 1–3 to populate the device inventory.</p>',
    '  <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:.85rem">',
    '    <button class="btn btn-primary checks-dl-btn" onclick="downloadNetconfScript()">⬇ Download netconf_push.py</button>',
    '    <span style="color:var(--txt3);font-size:.76rem">pip install ncclient requests rich</span>',
    '  </div>',
    '  <div class="checks-panel-usage">',
    '    <div style="margin-bottom:.2rem;color:var(--txt3)"># Quick start</div>',
    '    <div>python netconf_push.py --dry-run &nbsp;&nbsp;&nbsp;<span style="color:var(--txt3)"># validate connectivity (no changes)</span></div>',
    '    <div>python netconf_push.py &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:var(--txt3)"># push all devices (confirms first)</span></div>',
    '    <div>python netconf_push.py --device CORE-01 &nbsp;<span style="color:var(--txt3)"># push one device</span></div>',
    '    <div>python netconf_push.py --no-commit &nbsp;&nbsp;&nbsp;<span style="color:var(--txt3)"># skip commit (JunOS: discard)</span></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ── Expose public API ───────────────────────────────────────── */
window.genNetconfPushScript  = genNetconfPushScript;
window.downloadNetconfScript = downloadNetconfScript;
window.renderNetconfPanel    = renderNetconfPanel;
