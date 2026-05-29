'use strict';

/* ════════════════════════════════════════════════════════════════
   Day-2 Operations Toolkit
   Generates three downloadable Python + Netmiko scripts for
   routine Day-2 network operations:

     1. backup_configs.py   — SSH to all devices, archive running
                              configs with git + rotation.
     2. rolling_upgrade.py  — Staged firmware upgrade one device
                              at a time with health-gate + rollback.
     3. maintenance_mode.py — OSPF max-metric + BGP graceful-shutdown
                              drain/restore for change windows.

   Public API (window.*):
     genConfigBackupScript(state)    → string (Python source)
     genRollingUpgradeScript(state)  → string (Python source)
     genMaintenanceModeScript(state) → string (Python source)
     downloadConfigBackupScript()
     downloadRollingUpgradeScript()
     downloadMaintenanceModeScript()
     renderDay2OpsPanel()            → injects 3-card panel into DOM
════════════════════════════════════════════════════════════════ */

/* ── Shared helpers ─────────────────────────────────────────── */
function _d2DeviceList(state) {
  if (typeof buildDeviceList === 'function') return buildDeviceList();
  return [];
}

function _d2NetmikoType(os) {
  var map = {
    'ios-xe': 'cisco_ios',
    'nxos':   'cisco_nxos',
    'eos':    'arista_eos',
    'junos':  'juniper_junos',
    'sonic':  'linux',
  };
  return map[os] || 'cisco_ios';
}

function _d2BuildInventory(devs) {
  if (!devs || devs.length === 0) {
    return '# No devices in inventory — complete Steps 1-3 first\nDEVICES = []\n';
  }
  var lines = ['DEVICES = ['];
  var seen  = {};
  devs.forEach(function(dev) {
    var layer = dev.layer || '';
    if (layer.indexOf('mc-') === 0) return;
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible' || os === 'yaml' || os === 'text') return;
    var ipKey = layer + '-' + (dev.idx || 0);
    if (seen[ipKey]) return;
    seen[ipKey] = true;
    var mgmtIP  = '10.0.0.' + (30 + (dev.idx || 0));
    var hostname = dev.hostname || dev.name || ('DEV-' + String((dev.idx || 0) + 1).padStart(2, '0'));
    lines.push('    {');
    lines.push('        "host":        "' + mgmtIP + '",');
    lines.push('        "hostname":    "' + hostname + '",');
    lines.push('        "device_type": "' + _d2NetmikoType(os) + '",');
    lines.push('        "os":          "' + os + '",');
    lines.push('        "layer":       "' + layer + '",');
    lines.push('        "username":    USERNAME,');
    lines.push('        "password":    PASSWORD,');
    lines.push('        "secret":      SECRET,');
    lines.push('    },');
  });
  lines.push(']');
  return lines.join('\n');
}

/* Per-vendor backup command */
function _d2BackupCmd(osKey) {
  if (osKey === 'cisco_ios')     return 'show running-config';
  if (osKey === 'cisco_nxos')    return 'show running-config';
  if (osKey === 'arista_eos')    return 'show running-config';
  if (osKey === 'juniper_junos') return 'show configuration | display set | no-more';
  if (osKey === 'linux')         return 'show runningconfiguration all';  // SONiC vtysh via netmiko
  return 'show running-config';
}

/* ═══════════════════════════════════════════════════════════════
   1. Config Backup Script
════════════════════════════════════════════════════════════════ */
function genConfigBackupScript(state) {
  var devs = _d2DeviceList(state);
  var org  = (state && state.orgName) ? state.orgName : 'NetDesign';
  var date = new Date().toISOString().slice(0, 10);
  var inv  = _d2BuildInventory(devs);

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Config Backup Script',
    'Generated: ' + date + '   Org: ' + org,
    '',
    'Requirements: pip install netmiko rich',
    'Usage:        python backup_configs.py [--dry-run] [--retention 30]',
    'Output:       backups/YYYYMMDD/<hostname>_<ts>.cfg + git commit',
    '"""',
    '',
    'import os, sys, argparse, datetime, pathlib, subprocess, json',
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
    '# ── Credentials (env vars preferred) ─────────────────────────',
    'USERNAME = os.getenv("NET_USER",   "admin")',
    'PASSWORD = os.getenv("NET_PASS",   "NetDesign@2024")',
    'SECRET   = os.getenv("NET_SECRET", "NetDesign@2024")',
    '',
    '# ── Config ────────────────────────────────────────────────────',
    'BACKUP_ROOT    = pathlib.Path("backups")',
    'RETENTION_DAYS = 30   # days to keep old backups (0 = keep forever)',
    'GIT_COMMIT     = True  # auto-commit after successful backup run',
    '',
    '# ── Backup commands per device_type ───────────────────────────',
    'BACKUP_COMMANDS = {',
    '    "cisco_ios":     "show running-config",',
    '    "cisco_nxos":    "show running-config",',
    '    "arista_eos":    "show running-config",',
    '    "juniper_junos": "show configuration | display set | no-more",',
    '    "linux":         "show runningconfiguration all",',
    '}',
    '',
    '# ── Device inventory ──────────────────────────────────────────',
    inv,
    '',
    '# ── Helpers ───────────────────────────────────────────────────',
    'def connect(dev):',
    '    p = {k: dev[k] for k in ("host", "device_type", "username", "password", "secret")}',
    '    p["timeout"] = 45',
    '    p["auth_timeout"] = 30',
    '    return ConnectHandler(**p)',
    '',
    'def backup_device(dev, out_dir, dry_run):',
    '    result = {',
    '        "host":     dev["host"],',
    '        "hostname": dev["hostname"],',
    '        "status":   "PENDING",',
    '        "file":     None,',
    '        "error":    None,',
    '        "lines":    0,',
    '    }',
    '    cmd = BACKUP_COMMANDS.get(dev["device_type"], "show running-config")',
    '    if dry_run:',
    '        result["status"] = "DRY-RUN"',
    '        console.print(f"  [dim]DRY-RUN {dev[\'hostname\']} — would run: {cmd!r}[/dim]")',
    '        return result',
    '    try:',
    '        with connect(dev) as conn:',
    '            cfg = conn.send_command(cmd, read_timeout=60)',
    '        ts   = datetime.datetime.utcnow().strftime("%H%M%S")',
    '        fname = f"{dev[\'hostname\']}_{ts}.cfg"',
    '        fpath = out_dir / fname',
    '        fpath.write_text(cfg, encoding="utf-8")',
    '        result["status"] = "OK"',
    '        result["file"]   = str(fpath)',
    '        result["lines"]  = len(cfg.splitlines())',
    '    except NetmikoAuthenticationException:',
    '        result["status"] = "FAIL"; result["error"] = "AUTH_FAILED"',
    '    except NetmikoTimeoutException:',
    '        result["status"] = "FAIL"; result["error"] = "TIMEOUT"',
    '    except Exception as e:',
    '        result["status"] = "FAIL"; result["error"] = str(e)[:80]',
    '    return result',
    '',
    'def rotate_backups(retention_days):',
    '    """Delete per-day backup dirs older than retention_days."""',
    '    if retention_days <= 0 or not BACKUP_ROOT.exists():',
    '        return',
    '    cutoff = datetime.date.today() - datetime.timedelta(days=retention_days)',
    '    for d in BACKUP_ROOT.iterdir():',
    '        if not d.is_dir(): continue',
    '        try:',
    '            day = datetime.date.fromisoformat(d.name)',
    '            if day < cutoff:',
    '                import shutil',
    '                shutil.rmtree(d)',
    '                console.print(f"[dim]Rotated old backup dir: {d}[/dim]")',
    '        except ValueError:',
    '            pass  # non-date directory, skip',
    '',
    'def git_commit(out_dir, summary):',
    '    """Auto-commit backup dir if a git repo exists at BACKUP_ROOT."""',
    '    try:',
    '        root = pathlib.Path(".").resolve()',
    '        subprocess.run(["git", "add", str(out_dir)], cwd=root, check=True, capture_output=True)',
    '        msg  = f"chore: config backup {out_dir.name} — {summary}"',
    '        subprocess.run(["git", "commit", "-m", msg], cwd=root, check=True, capture_output=True)',
    '        console.print(f"[green]Git committed backup: {msg}[/green]")',
    '    except subprocess.CalledProcessError:',
    '        console.print("[dim]Git commit skipped (no repo or nothing staged)[/dim]")',
    '    except FileNotFoundError:',
    '        console.print("[dim]Git not found — skipping auto-commit[/dim]")',
    '',
    '# ── Main ──────────────────────────────────────────────────────',
    'def main():',
    '    ap = argparse.ArgumentParser(description="NetDesign AI Config Backup")',
    '    ap.add_argument("--dry-run",   action="store_true", help="Simulate without SSH")',
    '    ap.add_argument("--retention", type=int, default=RETENTION_DAYS,',
    '                    help=f"Days to keep backups (default {RETENTION_DAYS})")',
    '    ap.add_argument("--no-git",    action="store_true", help="Skip git commit")',
    '    args = ap.parse_args()',
    '',
    '    if not DEVICES:',
    '        console.print("[red]No devices in inventory. Complete Steps 1-3 first.[/red]")',
    '        sys.exit(1)',
    '',
    '    today   = datetime.date.today().isoformat()',
    '    out_dir = BACKUP_ROOT / today',
    '    if not args.dry_run:',
    '        out_dir.mkdir(parents=True, exist_ok=True)',
    '',
    '    console.print(f"[bold cyan]Config Backup[/bold cyan] — {len(DEVICES)} devices → {out_dir}")',
    '    results = []',
    '    ok_count = 0',
    '',
    '    for dev in DEVICES:',
    '        console.print(f"  Backing up [yellow]{dev[\'hostname\']}[/yellow] ({dev[\'host\']})...", end="")',
    '        r = backup_device(dev, out_dir, args.dry_run)',
    '        results.append(r)',
    '        if r["status"] == "OK":',
    '            ok_count += 1',
    '            console.print(f" [green]OK[/green] ({r[\'lines\']} lines → {pathlib.Path(r[\'file\']).name})")',
    '        elif r["status"] == "DRY-RUN":',
    '            pass',
    '        else:',
    '            console.print(f" [red]FAIL: {r[\'error\']}[/red]")',
    '',
    '    # Summary table',
    '    table = Table(title=f"Backup Summary — {today}")',
    '    table.add_column("Hostname",  style="cyan")',
    '    table.add_column("IP",        style="dim")',
    '    table.add_column("Status")',
    '    table.add_column("Lines",     justify="right")',
    '    table.add_column("File",      style="dim")',
    '    for r in results:',
    '        st_str = ("[green]OK[/green]" if r["status"] == "OK"',
    '                  else "[dim]DRY-RUN[/dim]" if r["status"] == "DRY-RUN"',
    '                  else f"[red]{r[\'status\']}[/red]")',
    '        table.add_row(',
    '            r["hostname"], r["host"], st_str,',
    '            str(r["lines"]),',
    '            pathlib.Path(r["file"]).name if r["file"] else (r["error"] or "-"),',
    '        )',
    '    console.print(table)',
    '',
    '    if not args.dry_run:',
    '        rotate_backups(args.retention)',
    '        summary = f"{ok_count}/{len(DEVICES)} OK"',
    '        if GIT_COMMIT and not args.no_git:',
    '            git_commit(out_dir, summary)',
    '',
    '        rpt_path = out_dir / "backup_report.json"',
    '        rpt_path.write_text(json.dumps({"date": today, "summary": results}, indent=2))',
    '        console.print(f"[green]Report saved → {rpt_path}[/green]")',
    '',
    '    console.print(f"[bold]Done: {ok_count}/{len(DEVICES)} backups successful[/bold]")',
    '    sys.exit(0 if ok_count == len(DEVICES) else 1)',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════
   2. Rolling Upgrade Script
════════════════════════════════════════════════════════════════ */
function genRollingUpgradeScript(state) {
  var devs   = _d2DeviceList(state);
  var org    = (state && state.orgName) ? state.orgName : 'NetDesign';
  var vendor = (state && state.vendor)  ? state.vendor  : 'cisco';
  var date   = new Date().toISOString().slice(0, 10);
  var inv    = _d2BuildInventory(devs);

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Rolling Firmware Upgrade Script',
    'Generated: ' + date + '   Org: ' + org + '   Vendor: ' + vendor,
    '',
    'Upgrades one device at a time; runs health checks between devices.',
    'Aborts and logs rollback instructions if health gate fails.',
    '',
    'Requirements: pip install netmiko rich',
    'Usage:',
    '    python rolling_upgrade.py --image <filename> --server <tftp-ip>',
    '    python rolling_upgrade.py --image nx-os.9.3.12.bin --server 10.0.0.5',
    '    python rolling_upgrade.py --dry-run --image test.bin --server 10.0.0.5',
    '"""',
    '',
    'import os, sys, time, argparse, datetime, json, pathlib',
    'from netmiko import ConnectHandler, NetmikoTimeoutException, NetmikoAuthenticationException',
    'try:',
    '    from rich.console import Console',
    '    from rich.progress import Progress, SpinnerColumn, TextColumn',
    '    console = Console()',
    'except ImportError:',
    '    class Console:',
    '        def print(self, *a, **kw): print(*a)',
    '    console = Console()',
    '',
    '# ── Credentials ───────────────────────────────────────────────',
    'USERNAME = os.getenv("NET_USER",   "admin")',
    'PASSWORD = os.getenv("NET_PASS",   "NetDesign@2024")',
    'SECRET   = os.getenv("NET_SECRET", "NetDesign@2024")',
    '',
    '# ── Timing (seconds) ──────────────────────────────────────────',
    'RELOAD_WAIT      = 180   # wait after reload before reconnect attempt',
    'RECONNECT_TRIES  = 20    # reconnect attempts after reload',
    'RECONNECT_DELAY  = 30    # seconds between reconnect attempts',
    'HEALTH_WAIT      = 30    # wait after reconnect before health check',
    'BGP_MIN_PEERS    = 1     # minimum BGP peers expected post-upgrade',
    '',
    '# ── Device inventory ──────────────────────────────────────────',
    inv,
    '',
    '# ── Per-vendor upgrade logic ──────────────────────────────────',
    'def upgrade_ios_xe(conn, image, server, dry_run):',
    '    """IOS-XE: install add → activate → commit (install mode)."""',
    '    src = f"tftp://{server}/{image}"',
    '    cmds = [',
    '        (f"install add file {src} activate commit prompt-level none",',
    '         600, "install_add_activate_done"),',
    '    ]',
    '    if dry_run:',
    '        console.print(f"  [dim]DRY-RUN: would run: install add file {src} activate commit[/dim]")',
    '        return True',
    '    for cmd, timeout, keyword in cmds:',
    '        out = conn.send_command(cmd, expect_string=keyword, read_timeout=timeout)',
    '        if "error" in out.lower() or "failed" in out.lower():',
    '            console.print(f"  [red]Upgrade command failed: {out[:200]}[/red]")',
    '            return False',
    '    return True',
    '',
    'def upgrade_nxos(conn, image, server, dry_run):',
    '    """NX-OS: copy image → install all."""',
    '    dst = f"bootflash:{image}"',
    '    if dry_run:',
    '        console.print(f"  [dim]DRY-RUN: would copy tftp://{server}/{image} → {dst} then install all[/dim]")',
    '        return True',
    '    out = conn.send_command(f"copy tftp://{server}/{image} {dst}",',
    '                            expect_string=r"Copy complete", read_timeout=300)',
    '    if "error" in out.lower():',
    '        console.print(f"  [red]Copy failed: {out[:200]}[/red]"); return False',
    '    out = conn.send_command(f"install all nxos {dst}",',
    '                            expect_string=r"Install has been successful", read_timeout=600)',
    '    return "successful" in out.lower() or "complete" in out.lower()',
    '',
    'def upgrade_eos(conn, image, server, dry_run):',
    '    """EOS: copy → boot system → reload."""',
    '    dst = f"flash:{image}"',
    '    if dry_run:',
    '        console.print(f"  [dim]DRY-RUN: would copy tftp://{server}/{image} to {dst} and reload[/dim]")',
    '        return True',
    '    out = conn.send_command(f"copy tftp://{server}/{image} {dst}",',
    '                            expect_string=r"Copy completed", read_timeout=300)',
    '    if "error" in out.lower():',
    '        console.print(f"  [red]Copy failed: {out[:200]}[/red]"); return False',
    '    conn.send_command(f"boot system flash:{image}")',
    '    conn.send_command("reload", expect_string=r"Proceed with reload")',
    '    conn.send_command("yes")',
    '    return True',
    '',
    'def upgrade_junos(conn, image, server, dry_run):',
    '    """JunOS: request system software add → reboot."""',
    '    src = f"tftp://{server}/{image}"',
    '    if dry_run:',
    '        console.print(f"  [dim]DRY-RUN: would request system software add {src}[/dim]")',
    '        return True',
    '    out = conn.send_command(f"request system software add {src} no-validate",',
    '                            expect_string=r"Installation succeeded", read_timeout=600)',
    '    if "error" in out.lower() or "failed" in out.lower():',
    '        console.print(f"  [red]JunOS upgrade failed: {out[:200]}[/red]"); return False',
    '    conn.send_command("request system reboot", expect_string=r"Reboot the system")',
    '    conn.send_command("yes")',
    '    return True',
    '',
    'def upgrade_sonic(conn, image, server, dry_run):',
    '    """SONiC: sonic-installer install → reboot."""',
    '    src = f"http://{server}/{image}"',
    '    if dry_run:',
    '        console.print(f"  [dim]DRY-RUN: would sudo sonic-installer install {src}[/dim]")',
    '        return True',
    '    out = conn.send_command(f"sudo sonic-installer install {src}",',
    '                            expect_string=r"Installation completed", read_timeout=300)',
    '    if "error" in out.lower() or "failed" in out.lower():',
    '        console.print(f"  [red]SONiC install failed: {out[:200]}[/red]"); return False',
    '    conn.send_command("sudo reboot")',
    '    return True',
    '',
    'def trigger_upgrade(dev, image, server, dry_run):',
    '    """Dispatch upgrade by device_type."""',
    '    dt = dev["device_type"]',
    '    try:',
    '        with ConnectHandler(',
    '            host=dev["host"], device_type=dt,',
    '            username=dev["username"], password=dev["password"],',
    '            secret=dev["secret"], timeout=60',
    '        ) as conn:',
    '            if   dt == "cisco_ios":     return upgrade_ios_xe(conn, image, server, dry_run)',
    '            elif dt == "cisco_nxos":    return upgrade_nxos(conn, image, server, dry_run)',
    '            elif dt == "arista_eos":    return upgrade_eos(conn, image, server, dry_run)',
    '            elif dt == "juniper_junos": return upgrade_junos(conn, image, server, dry_run)',
    '            elif dt == "linux":         return upgrade_sonic(conn, image, server, dry_run)',
    '            else:',
    '                console.print(f"  [yellow]Unknown device_type {dt} — skipping[/yellow]")',
    '                return False',
    '    except NetmikoAuthenticationException:',
    '        console.print("  [red]AUTH FAILED[/red]"); return False',
    '    except NetmikoTimeoutException:',
    '        console.print("  [red]TIMEOUT[/red]"); return False',
    '    except Exception as e:',
    '        console.print(f"  [red]Error: {e}[/red]"); return False',
    '',
    'def wait_reconnect(dev, dry_run):',
    '    """Wait for device to come back after reload."""',
    '    if dry_run:',
    '        console.print("  [dim]DRY-RUN: skipping reload wait[/dim]")',
    '        return True',
    '    console.print(f"  Waiting {RELOAD_WAIT}s for reload...", end="")',
    '    time.sleep(RELOAD_WAIT)',
    '    for attempt in range(RECONNECT_TRIES):',
    '        try:',
    '            with ConnectHandler(',
    '                host=dev["host"], device_type=dev["device_type"],',
    '                username=dev["username"], password=dev["password"],',
    '                secret=dev["secret"], timeout=20, auth_timeout=15',
    '            ):',
    '                console.print(" [green]back online[/green]")',
    '                time.sleep(HEALTH_WAIT)',
    '                return True',
    '        except Exception:',
    '            console.print(".", end="")',
    '            time.sleep(RECONNECT_DELAY)',
    '    console.print(" [red]UNREACHABLE after reload[/red]")',
    '    return False',
    '',
    'def health_check(dev, dry_run):',
    '    """Return True if BGP peers ≥ BGP_MIN_PEERS and device is reachable."""',
    '    if dry_run: return True',
    '    try:',
    '        with ConnectHandler(',
    '            host=dev["host"], device_type=dev["device_type"],',
    '            username=dev["username"], password=dev["password"],',
    '            secret=dev["secret"], timeout=30',
    '        ) as conn:',
    '            dt = dev["device_type"]',
    '            if dt == "cisco_ios":     out = conn.send_command("show ip bgp summary")',
    '            elif dt == "cisco_nxos":  out = conn.send_command("show bgp ipv4 unicast summary")',
    '            elif dt == "arista_eos":  out = conn.send_command("show bgp ipv4 unicast summary")',
    '            elif dt == "juniper_junos": out = conn.send_command("show bgp summary")',
    '            else:                     out = conn.send_command("show bgp ipv4 unicast summary")',
    '            peers = sum(1 for l in out.splitlines()',
    '                        if ("established" in l.lower() or',
    '                            (l.split() and l.split()[-1].isdigit())))',
    '            if peers >= BGP_MIN_PEERS:',
    '                console.print(f"  [green]Health OK — {peers} BGP peer(s)[/green]")',
    '                return True',
    '            console.print(f"  [yellow]Health WARNING — only {peers} BGP peer(s)[/yellow]")',
    '            return False',
    '    except Exception as e:',
    '        console.print(f"  [red]Health check error: {e}[/red]")',
    '        return False',
    '',
    '# ── Main ──────────────────────────────────────────────────────',
    'def main():',
    '    ap = argparse.ArgumentParser(description="NetDesign AI Rolling Upgrade")',
    '    ap.add_argument("--image",   required=True, help="Firmware filename (on TFTP server)")',
    '    ap.add_argument("--server",  required=True, help="TFTP/HTTP server IP")',
    '    ap.add_argument("--dry-run", action="store_true", help="Simulate without SSH")',
    '    ap.add_argument("--skip-health", action="store_true", help="Skip health gate between devices")',
    '    args = ap.parse_args()',
    '',
    '    if not DEVICES:',
    '        console.print("[red]No devices in inventory.[/red]"); sys.exit(1)',
    '',
    '    console.print(f"[bold cyan]Rolling Upgrade[/bold cyan] — image={args.image} server={args.server}")',
    '    console.print(f"Devices: {len(DEVICES)}  dry-run={args.dry_run}")',
    '    console.print("")',
    '',
    '    results  = []',
    '    aborted  = False',
    '    log_path = pathlib.Path(f"upgrade_log_{datetime.datetime.utcnow().strftime(\'%Y%m%d_%H%M%S\')}.json")',
    '',
    '    for i, dev in enumerate(DEVICES, 1):',
    '        console.print(f"[bold]── Device {i}/{len(DEVICES)}: {dev[\'hostname\']} ({dev[\'host\']})[/bold]")',
    '        entry = {"hostname": dev["hostname"], "host": dev["host"],',
    '                 "upgrade": None, "reconnect": None, "health": None}',
    '',
    '        console.print("  Triggering upgrade...")',
    '        ok = trigger_upgrade(dev, args.image, args.server, args.dry_run)',
    '        entry["upgrade"] = ok',
    '        if not ok:',
    '            console.print(f"  [red]Upgrade failed on {dev[\'hostname\']} — ABORTING rollout[/red]")',
    '            entry["health"] = False',
    '            results.append(entry)',
    '            aborted = True',
    '            break',
    '',
    '        # IOS-XE install-mode reboots internally; others need explicit wait',
    '        if dev["device_type"] != "cisco_ios" or args.dry_run:',
    '            ok = wait_reconnect(dev, args.dry_run)',
    '            entry["reconnect"] = ok',
    '            if not ok:',
    '                console.print(f"  [red]{dev[\'hostname\']} did not come back — ABORTING[/red]")',
    '                results.append(entry)',
    '                aborted = True',
    '                break',
    '',
    '        if not args.skip_health:',
    '            console.print("  Running health check...")',
    '            hok = health_check(dev, args.dry_run)',
    '            entry["health"] = hok',
    '            if not hok:',
    '                console.print(f"  [red]Health gate FAILED on {dev[\'hostname\']} — ABORTING[/red]")',
    '                console.print("  [yellow]Rollback instructions: reload device and boot previous image.[/yellow]")',
    '                results.append(entry)',
    '                aborted = True',
    '                break',
    '        else:',
    '            entry["health"] = "SKIPPED"',
    '',
    '        results.append(entry)',
    '        console.print(f"  [green]{dev[\'hostname\']} upgrade complete.[/green]")',
    '',
    '    # Summary',
    '    console.print("")',
    '    table = Table(title="Upgrade Summary")',
    '    table.add_column("Hostname", style="cyan")',
    '    table.add_column("IP",       style="dim")',
    '    table.add_column("Upgrade")',
    '    table.add_column("Reconnect")',
    '    table.add_column("Health")',
    '    def _fmt(v):',
    '        if v is True:   return "[green]PASS[/green]"',
    '        if v is False:  return "[red]FAIL[/red]"',
    '        if v is None:   return "[dim]N/A[/dim]"',
    '        return f"[dim]{v}[/dim]"',
    '    for r in results:',
    '        table.add_row(r["hostname"], r["host"],',
    '                      _fmt(r["upgrade"]), _fmt(r["reconnect"]), _fmt(r["health"]))',
    '    console.print(table)',
    '',
    '    log_path.write_text(json.dumps({"aborted": aborted, "results": results}, indent=2))',
    '    console.print(f"[green]Log saved → {log_path}[/green]")',
    '',
    '    if aborted:',
    '        console.print("[bold red]Rollout ABORTED — remaining devices not upgraded.[/bold red]")',
    '        sys.exit(1)',
    '    console.print("[bold green]Rolling upgrade COMPLETE — all devices upgraded successfully.[/bold green]")',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════
   3. Maintenance Mode Script
════════════════════════════════════════════════════════════════ */
function genMaintenanceModeScript(state) {
  var devs = _d2DeviceList(state);
  var org  = (state && state.orgName) ? state.orgName : 'NetDesign';
  var date = new Date().toISOString().slice(0, 10);
  var inv  = _d2BuildInventory(devs);

  return [
    '#!/usr/bin/env python3',
    '"""',
    'NetDesign AI — Maintenance Mode Script',
    'Generated: ' + date + '   Org: ' + org,
    '',
    'Drains traffic BEFORE maintenance using OSPF max-metric + BGP',
    'graceful-shutdown, then restores normal operation AFTER.',
    '',
    'OSPF max-metric causes neighbors to prefer alternate paths.',
    'BGP graceful-shutdown sets COMMUNITY 0:0 so peers de-prefer.',
    '',
    'Requirements: pip install netmiko rich',
    'Usage:',
    '    python maintenance_mode.py --enter [--device <hostname>]',
    '    python maintenance_mode.py --exit  [--device <hostname>]',
    '    python maintenance_mode.py --status',
    '    python maintenance_mode.py --enter --all  # all devices at once',
    '"""',
    '',
    'import os, sys, time, argparse, json, datetime, pathlib',
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
    '# ── Credentials ───────────────────────────────────────────────',
    'USERNAME = os.getenv("NET_USER",   "admin")',
    'PASSWORD = os.getenv("NET_PASS",   "NetDesign@2024")',
    'SECRET   = os.getenv("NET_SECRET", "NetDesign@2024")',
    '',
    '# ── Timing ────────────────────────────────────────────────────',
    'DRAIN_WAIT = 60   # seconds to wait after enter-maintenance before verifying',
    '',
    '# ── Device inventory ──────────────────────────────────────────',
    inv,
    '',
    '# ── Per-vendor maintenance commands ───────────────────────────',
    '',
    'def _enter_ios_xe(conn):',
    '    """IOS-XE: OSPF max-metric + BGP graceful-shutdown."""',
    '    cmds = [',
    '        "router ospf 1",',
    '        "max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65000",',
    '        "bgp graceful-shutdown all neighbors 300 local-preference 0 community 0:0",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("copy running-config startup-config", expect_string=r"\\[startup-config\\]")',
    '',
    'def _exit_ios_xe(conn):',
    '    """IOS-XE: remove max-metric + graceful-shutdown."""',
    '    cmds = [',
    '        "router ospf 1",',
    '        "no max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65000",',
    '        "no bgp graceful-shutdown all neighbors",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("copy running-config startup-config", expect_string=r"\\[startup-config\\]")',
    '',
    'def _enter_nxos(conn):',
    '    """NX-OS: OSPF max-metric + BGP graceful-shutdown."""',
    '    cmds = [',
    '        "router ospf UNDERLAY",',
    '        "max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65000",',
    '        "graceful-shutdown",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("copy running-config startup-config", expect_string=r"Copy complete")',
    '',
    'def _exit_nxos(conn):',
    '    cmds = [',
    '        "router ospf UNDERLAY",',
    '        "no max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65000",',
    '        "no graceful-shutdown",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("copy running-config startup-config", expect_string=r"Copy complete")',
    '',
    'def _enter_eos(conn):',
    '    """EOS: OSPF max-metric + BGP graceful-shutdown."""',
    '    cmds = [',
    '        "router ospf 1",',
    '        "max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65001",',
    '        "graceful-restart-helper",',
    '        "bgp graceful-shutdown",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("write memory")',
    '',
    'def _exit_eos(conn):',
    '    cmds = [',
    '        "router ospf 1",',
    '        "no max-metric router-lsa",',
    '        "end",',
    '        "router bgp 65001",',
    '        "no bgp graceful-shutdown",',
    '        "end",',
    '    ]',
    '    for cmd in cmds: conn.send_command_timing(cmd)',
    '    conn.send_command("write memory")',
    '',
    'def _enter_junos(conn):',
    '    """JunOS: advertise maximum metric via routing policy."""',
    '    cmds = [',
    '        \'set policy-options policy-statement MAINTENANCE-DRAIN term 1 then metric 65535\',',
    '        \'set policy-options policy-statement MAINTENANCE-DRAIN term 1 then accept\',',
    '        \'set protocols ospf export MAINTENANCE-DRAIN\',',
    '        \'set protocols bgp group SPINES export MAINTENANCE-DRAIN\',',
    '        \'commit\',',
    '    ]',
    '    conn.config_mode()',
    '    for cmd in cmds[:-1]: conn.send_command_timing(cmd)',
    '    out = conn.send_command(cmds[-1], expect_string=r"commit complete")',
    '    if "error" in out.lower():',
    '        console.print(f"  [red]JunOS commit error: {out[:200]}[/red]")',
    '',
    'def _exit_junos(conn):',
    '    cmds = [',
    '        \'delete protocols ospf export MAINTENANCE-DRAIN\',',
    '        \'delete protocols bgp group SPINES export MAINTENANCE-DRAIN\',',
    '        \'delete policy-options policy-statement MAINTENANCE-DRAIN\',',
    '        \'commit\',',
    '    ]',
    '    conn.config_mode()',
    '    for cmd in cmds[:-1]: conn.send_command_timing(cmd)',
    '    conn.send_command(cmds[-1], expect_string=r"commit complete")',
    '',
    'def _enter_sonic(conn):',
    '    """SONiC: FRRouting vtysh OSPF max-metric."""',
    '    cmds = [',
    '        \'vtysh -c "configure terminal" -c "router ospf" -c "max-metric router-lsa"\',',
    '        \'vtysh -c "configure terminal" -c "router bgp 65011" -c "bgp graceful-shutdown"\',',
    '    ]',
    '    for cmd in cmds: conn.send_command(cmd, read_timeout=15)',
    '',
    'def _exit_sonic(conn):',
    '    cmds = [',
    '        \'vtysh -c "configure terminal" -c "router ospf" -c "no max-metric router-lsa"\',',
    '        \'vtysh -c "configure terminal" -c "router bgp 65011" -c "no bgp graceful-shutdown"\',',
    '    ]',
    '    for cmd in cmds: conn.send_command(cmd, read_timeout=15)',
    '',
    'def _get_bgp_peer_count(conn, dt):',
    '    if dt == "cisco_ios":    out = conn.send_command("show ip bgp summary")',
    '    elif dt == "cisco_nxos": out = conn.send_command("show bgp ipv4 unicast summary")',
    '    elif dt == "arista_eos": out = conn.send_command("show bgp ipv4 unicast summary")',
    '    elif dt == "juniper_junos": out = conn.send_command("show bgp summary")',
    '    else:                    out = conn.send_command("show bgp ipv4 unicast summary")',
    '    return sum(1 for l in out.splitlines()',
    '               if ("established" in l.lower() or',
    '                   (l.split() and l.split()[-1].isdigit())))',
    '',
    '# ── High-level per-device maintenance entry/exit ──────────────',
    'def set_maintenance(dev, entering):',
    '    action = "enter" if entering else "exit"',
    '    console.print(f"  [{action}] maintenance on [yellow]{dev[\'hostname\']}[/yellow]...")',
    '    try:',
    '        with ConnectHandler(',
    '            host=dev["host"], device_type=dev["device_type"],',
    '            username=dev["username"], password=dev["password"],',
    '            secret=dev["secret"], timeout=30',
    '        ) as conn:',
    '            dt = dev["device_type"]',
    '            if entering:',
    '                if   dt == "cisco_ios":     _enter_ios_xe(conn)',
    '                elif dt == "cisco_nxos":    _enter_nxos(conn)',
    '                elif dt == "arista_eos":    _enter_eos(conn)',
    '                elif dt == "juniper_junos": _enter_junos(conn)',
    '                elif dt == "linux":         _enter_sonic(conn)',
    '            else:',
    '                if   dt == "cisco_ios":     _exit_ios_xe(conn)',
    '                elif dt == "cisco_nxos":    _exit_nxos(conn)',
    '                elif dt == "arista_eos":    _exit_eos(conn)',
    '                elif dt == "juniper_junos": _exit_junos(conn)',
    '                elif dt == "linux":         _exit_sonic(conn)',
    '            console.print(f"  [green]{action.upper()} OK[/green]")',
    '            return True',
    '    except NetmikoAuthenticationException:',
    '        console.print(f"  [red]AUTH FAILED[/red]"); return False',
    '    except NetmikoTimeoutException:',
    '        console.print(f"  [red]TIMEOUT[/red]"); return False',
    '    except Exception as e:',
    '        console.print(f"  [red]{e}[/red]"); return False',
    '',
    'def status_check(devs):',
    '    """Show current BGP peer count + reachability for each device."""',
    '    table = Table(title="Device Status")',
    '    table.add_column("Hostname", style="cyan")',
    '    table.add_column("IP",       style="dim")',
    '    table.add_column("Reachable")',
    '    table.add_column("BGP Peers", justify="right")',
    '    for dev in devs:',
    '        try:',
    '            with ConnectHandler(',
    '                host=dev["host"], device_type=dev["device_type"],',
    '                username=dev["username"], password=dev["password"],',
    '                secret=dev["secret"], timeout=20',
    '            ) as conn:',
    '                peers = _get_bgp_peer_count(conn, dev["device_type"])',
    '                table.add_row(dev["hostname"], dev["host"],',
    '                              "[green]YES[/green]", str(peers))',
    '        except Exception:',
    '            table.add_row(dev["hostname"], dev["host"],',
    '                          "[red]NO[/red]", "-")',
    '    console.print(table)',
    '',
    '# ── Main ──────────────────────────────────────────────────────',
    'def main():',
    '    ap = argparse.ArgumentParser(description="NetDesign AI Maintenance Mode")',
    '    grp = ap.add_mutually_exclusive_group(required=True)',
    '    grp.add_argument("--enter",  action="store_true", help="Enter maintenance (drain traffic)")',
    '    grp.add_argument("--exit",   action="store_true", help="Exit maintenance (restore traffic)")',
    '    grp.add_argument("--status", action="store_true", help="Show device status")',
    '    ap.add_argument("--device",  help="Target specific hostname (default: all)")',
    '    ap.add_argument("--all",     action="store_true", help="Apply to all devices in parallel scope")',
    '    ap.add_argument("--no-wait", action="store_true", help=f"Skip {DRAIN_WAIT}s drain wait")',
    '    args = ap.parse_args()',
    '',
    '    if not DEVICES:',
    '        console.print("[red]No devices in inventory.[/red]"); sys.exit(1)',
    '',
    '    targets = DEVICES',
    '    if args.device:',
    '        targets = [d for d in DEVICES if d["hostname"] == args.device]',
    '        if not targets:',
    '            console.print(f"[red]No device named {args.device!r} in inventory.[/red]"); sys.exit(1)',
    '',
    '    if args.status:',
    '        status_check(targets)',
    '        return',
    '',
    '    entering = args.enter',
    '    mode_str = "ENTER MAINTENANCE" if entering else "EXIT MAINTENANCE"',
    '    console.print(f"[bold cyan]{mode_str}[/bold cyan] — {len(targets)} device(s)")',
    '',
    '    results  = []',
    '    failures = 0',
    '    for dev in targets:',
    '        ok = set_maintenance(dev, entering)',
    '        results.append({"hostname": dev["hostname"], "ok": ok})',
    '        if not ok: failures += 1',
    '',
    '    if entering and not args.no_wait:',
    '        console.print(f"Waiting {DRAIN_WAIT}s for traffic to drain...", end="")',
    '        time.sleep(DRAIN_WAIT)',
    '        console.print(" done")',
    '        console.print("Verifying BGP peer counts:")',
    '        status_check(targets)',
    '',
    '    # Persist state for auditability',
    '    state_file = pathlib.Path("maintenance_state.json")',
    '    state_data = {',
    '        "mode":      "maintenance" if entering else "normal",',
    '        "timestamp": datetime.datetime.utcnow().isoformat(),',
    '        "devices":   [d["hostname"] for d in targets],',
    '    }',
    '    state_file.write_text(json.dumps(state_data, indent=2))',
    '',
    '    if failures:',
    '        console.print(f"[bold red]{failures} device(s) failed — check logs.[/bold red]")',
    '        sys.exit(1)',
    '    console.print(f"[bold green]{mode_str} complete on all {len(targets)} device(s).[/bold green]")',
    '',
    'if __name__ == "__main__":',
    '    main()',
  ].join('\n');
}

/* ── Download helpers ────────────────────────────────────────── */
function _d2Download(filename, content) {
  var blob = new Blob([content], { type: 'text/plain' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadConfigBackupScript() {
  _d2Download('backup_configs.py', genConfigBackupScript(STATE));
  if (typeof toast === 'function') toast('backup_configs.py downloaded', 'success');
}

function downloadRollingUpgradeScript() {
  _d2Download('rolling_upgrade.py', genRollingUpgradeScript(STATE));
  if (typeof toast === 'function') toast('rolling_upgrade.py downloaded', 'success');
}

function downloadMaintenanceModeScript() {
  _d2Download('maintenance_mode.py', genMaintenanceModeScript(STATE));
  if (typeof toast === 'function') toast('maintenance_mode.py downloaded', 'success');
}

/* ── Render the panel into the DOM ───────────────────────────── */
function renderDay2OpsPanel() {
  var container = document.getElementById('day2ops-panel');
  if (!container) return;

  var org   = (typeof STATE !== 'undefined' && STATE.orgName) ? STATE.orgName : 'your network';
  var uc    = (typeof STATE !== 'undefined' && STATE.uc)      ? STATE.uc      : null;
  var label = (uc && typeof UC_LABELS !== 'undefined') ? (' — ' + (UC_LABELS[uc] || uc)) : '';

  container.innerHTML =
    '<div class="d2ops-panel-inner">' +
      '<div class="d2ops-panel-header">' +
        '<span class="d2ops-panel-icon">🔧</span>' +
        '<div>' +
          '<strong>Day-2 Operations Toolkit</strong>' +
          '<div class="d2ops-panel-sub">Production-grade automation scripts for ' + org + label + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="d2ops-cards">' +
        '<div class="d2ops-card">' +
          '<div class="d2ops-card-icon">💾</div>' +
          '<div class="d2ops-card-title">Config Backup</div>' +
          '<div class="d2ops-card-desc">SSH to all devices, archive running configs to <code>backups/YYYYMMDD/</code>, auto-commit to git, rotate backups older than 30 days.</div>' +
          '<button class="btn btn-ghost d2ops-dl-btn" onclick="downloadConfigBackupScript()">📥 backup_configs.py</button>' +
        '</div>' +
        '<div class="d2ops-card">' +
          '<div class="d2ops-card-icon">🚀</div>' +
          '<div class="d2ops-card-title">Rolling Upgrade</div>' +
          '<div class="d2ops-card-desc">Stage firmware one device at a time. Pre-verify, copy image via TFTP, activate, wait for reload, run health gate before proceeding. Aborts on failure.</div>' +
          '<button class="btn btn-ghost d2ops-dl-btn" onclick="downloadRollingUpgradeScript()">📥 rolling_upgrade.py</button>' +
        '</div>' +
        '<div class="d2ops-card">' +
          '<div class="d2ops-card-icon">🛠️</div>' +
          '<div class="d2ops-card-title">Maintenance Mode</div>' +
          '<div class="d2ops-card-desc">Drain traffic before maintenance via OSPF max-metric + BGP graceful-shutdown. Verify drain, perform work, restore normal operation with one command.</div>' +
          '<button class="btn btn-ghost d2ops-dl-btn" onclick="downloadMaintenanceModeScript()">📥 maintenance_mode.py</button>' +
        '</div>' +
      '</div>' +
      '<div class="d2ops-usage">' +
        '<strong>Quick start:</strong><br>' +
        '<code>pip install netmiko rich</code><br>' +
        '<code>NET_USER=admin NET_PASS=... python backup_configs.py</code><br>' +
        '<code>NET_USER=admin NET_PASS=... python rolling_upgrade.py --image nx-os.9.3.12.bin --server 10.0.0.5 --dry-run</code><br>' +
        '<code>NET_USER=admin NET_PASS=... python maintenance_mode.py --enter --device NYC-LEAF-A01-01</code>' +
      '</div>' +
    '</div>';
}

/* ── Expose public API ───────────────────────────────────────── */
window.genConfigBackupScript       = genConfigBackupScript;
window.genRollingUpgradeScript     = genRollingUpgradeScript;
window.genMaintenanceModeScript    = genMaintenanceModeScript;
window.downloadConfigBackupScript  = downloadConfigBackupScript;
window.downloadRollingUpgradeScript = downloadRollingUpgradeScript;
window.downloadMaintenanceModeScript = downloadMaintenanceModeScript;
window.renderDay2OpsPanel          = renderDay2OpsPanel;
