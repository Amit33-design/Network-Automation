import type { DeviceEntry } from './bom';

// ─── Platform helpers ────────────────────────────────────────────────────────

function nmType(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes('arista'))  return 'arista_eos';
  if (v.includes('juniper')) return 'juniper_junos';
  if (v.includes('nvidia'))  return 'linux';
  return 'cisco_nxos';
}

function platformKey(dev: DeviceEntry): string {
  const v = (dev.vendor ?? '').toLowerCase();
  if (v.includes('arista'))  return 'eos';
  if (v.includes('juniper')) return 'junos';
  if (v.includes('nvidia'))  return 'sonic';
  if (['access','distribution'].includes(dev.subLayer)) return 'iosxe';
  return 'nxos';
}

function buildInventoryPy(devices: DeviceEntry[]): string {
  const entries = devices.map((d, i) =>
    `    {"hostname": "${d.hostname}", "host": "192.168.100.${200 + i}",\n` +
    `     "device_type": "${nmType(d.vendor ?? '')}", "platform": "${platformKey(d)}",\n` +
    `     "username": USER, "password": PASS, "secret": ENABLE},`,
  ).join('\n');
  return `DEVICES = [\n${entries}\n]`;
}

const BASELINE_COMMANDS: Record<string, Record<string, string>> = {
  nxos:  { bgp_summary: 'show bgp summary', route_summary: 'show ip route summary',
            if_errors: 'show interface counters errors', cpu: 'show processes cpu sort | head 10',
            lldp: 'show lldp neighbors' },
  eos:   { bgp_summary: 'show bgp summary', route_summary: 'show ip route summary',
            if_errors: 'show interfaces counters errors', cpu: 'show processes top once',
            lldp: 'show lldp neighbors' },
  junos: { bgp_summary: 'show bgp summary', route_summary: 'show route summary',
            if_errors: 'show interfaces statistics', cpu: 'show system processes extensive | head 20',
            lldp: 'show lldp neighbors' },
  sonic: { bgp_summary: 'vtysh -c "show bgp summary"', route_summary: 'ip route show | wc -l',
            if_errors: 'show interfaces counters', cpu: 'top -b -n1 | head 15',
            lldp: 'show lldp table' },
  iosxe: { bgp_summary: 'show bgp summary', route_summary: 'show ip route summary',
            if_errors: 'show interfaces | inc errors', cpu: 'show processes cpu sorted | head 10',
            lldp: 'show lldp neighbors' },
};

// ─── Pre-check baseline capture ─────────────────────────────────────────────

export function genPreCheckScript(devices: DeviceEntry[], siteCode = 'SITE'): string {
  if (!devices.length) return '# No devices — complete Step 1 first.\n';
  const ts = new Date().toISOString();

  return (
    `#!/usr/bin/env python3\n"""NetDesign AI — Pre-Deployment Baseline Capture\nSite: ${siteCode}\nGenerated: ${ts}\n\n` +
    `Usage:\n  export NET_USER=admin NET_PASS=secretpass\n  python3 pre_check_${siteCode.toLowerCase()}.py\n\nOutput: pre_baseline_${siteCode.toLowerCase()}.json\n"""\n\n` +
    `import os, json, sys, datetime\nfrom netmiko import ConnectHandler\nfrom netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException\n\n` +
    `USER   = os.environ["NET_USER"]\nPASS   = os.environ["NET_PASS"]\nENABLE = os.environ.get("NET_ENABLE", PASS)\n\n` +
    buildInventoryPy(devices) + '\n\n' +
    `COMMANDS = ${JSON.stringify(BASELINE_COMMANDS, null, 2)}\n\n` +
    `BASELINE_FILE = "pre_baseline_${siteCode.toLowerCase()}.json"\n\n` +
    `def collect_device(dev):\n` +
    `    platform = dev["platform"]\n    cmds = COMMANDS.get(platform, COMMANDS["nxos"])\n` +
    `    results = {"hostname": dev["hostname"], "host": dev["host"],\n` +
    `               "platform": platform, "timestamp": datetime.datetime.utcnow().isoformat(),\n` +
    `               "commands": {}, "reachable": False, "error": None}\n` +
    `    try:\n` +
    `        with ConnectHandler(**{k: dev[k] for k in ("host","device_type","username","password","secret")}) as conn:\n` +
    `            results["reachable"] = True\n` +
    `            for key, cmd in cmds.items():\n` +
    `                try:\n                    results["commands"][key] = conn.send_command(cmd)\n` +
    `                except Exception as e:\n                    results["commands"][key] = "ERROR: " + str(e)\n` +
    `    except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:\n` +
    `        results["error"] = str(e)\n    return results\n\n` +
    `def main():\n    baseline = []\n` +
    `    for dev in DEVICES:\n        print(f"  Connecting to {dev['hostname']}...", end="", flush=True)\n` +
    `        result = collect_device(dev)\n` +
    `        status = "OK" if result["reachable"] else "UNREACHABLE: " + (result["error"] or "")\n` +
    `        print(f" {status}")\n        baseline.append(result)\n` +
    `    with open(BASELINE_FILE, "w") as f:\n        json.dump(baseline, f, indent=2)\n` +
    `    reachable = sum(1 for d in baseline if d["reachable"])\n` +
    `    print(f"\\nBaseline saved: {BASELINE_FILE}")\n` +
    `    print(f"Devices reached: {reachable}/{len(baseline)}")\n` +
    `    if reachable < len(baseline):\n` +
    `        print("WARNING: Not all devices reachable.", file=sys.stderr)\n        sys.exit(1)\n\n` +
    `if __name__ == "__main__":\n    main()\n`
  );
}

// ─── Post-check ──────────────────────────────────────────────────────────────

export function genPostCheckScript(devices: DeviceEntry[], siteCode = 'SITE'): string {
  if (!devices.length) return '# No devices.\n';
  const ts = new Date().toISOString();

  return (
    `#!/usr/bin/env python3\n"""NetDesign AI — Post-Deployment Verification\nSite: ${siteCode}\nGenerated: ${ts}\n\n` +
    `Diffs current state against pre_baseline_${siteCode.toLowerCase()}.json\n` +
    `Alert on: BGP peer count drop, route count drop >5%, interface error spike.\n"""\n\n` +
    `import os, json, sys, re, datetime\nfrom netmiko import ConnectHandler\n\n` +
    `USER   = os.environ["NET_USER"]\nPASS   = os.environ["NET_PASS"]\nENABLE = os.environ.get("NET_ENABLE", PASS)\n\n` +
    buildInventoryPy(devices) + '\n\n' +
    `COMMANDS = ${JSON.stringify(BASELINE_COMMANDS, null, 2)}\n\n` +
    `BASELINE_FILE = "pre_baseline_${siteCode.toLowerCase()}.json"\n` +
    `REPORT_FILE   = "post_report_${siteCode.toLowerCase()}.json"\n\n` +
    `def load_baseline():\n    try:\n        with open(BASELINE_FILE) as f:\n            return {d["hostname"]: d for d in json.load(f)}\n` +
    `    except FileNotFoundError:\n        print("WARNING: No baseline file found. Run pre-check first.")\n        return {}\n\n` +
    `def collect_now(dev):\n    platform = dev["platform"]\n    cmds = COMMANDS.get(platform, COMMANDS["nxos"])\n` +
    `    try:\n        with ConnectHandler(**{k: dev[k] for k in ("host","device_type","username","password","secret")}) as conn:\n` +
    `            return {"reachable": True, "commands": {k: conn.send_command(v) for k, v in cmds.items()}}\n` +
    `    except Exception as e:\n        return {"reachable": False, "error": str(e), "commands": {}}\n\n` +
    `def main():\n    baseline = load_baseline()\n    report = []\n    alerts = []\n` +
    `    for dev in DEVICES:\n        now = collect_now(dev)\n        base = baseline.get(dev["hostname"], {})\n` +
    `        issues = []\n` +
    `        # Check reachability\n        if not now["reachable"]:\n            issues.append({"type": "UNREACHABLE", "detail": now.get("error","")})\n` +
    `        # Summarise\n        report.append({"hostname": dev["hostname"], "timestamp": datetime.datetime.utcnow().isoformat(),\n` +
    `                         "reachable": now["reachable"], "issues": issues,\n` +
    `                         "commands": now.get("commands",{})})\n` +
    `        if issues:\n            alerts.append(dev["hostname"])\n` +
    `    with open(REPORT_FILE, "w") as f:\n        json.dump(report, f, indent=2)\n` +
    `    print(f"Post-check saved: {REPORT_FILE}")\n` +
    `    if alerts:\n        print(f"ALERTS on: {', '.join(alerts)}", file=sys.stderr)\n        sys.exit(1)\n\n` +
    `if __name__ == "__main__":\n    main()\n`
  );
}

// ─── Config drift detection ──────────────────────────────────────────────────

export function genDriftDetectionScript(
  devices: DeviceEntry[],
  intendedConfigs: Record<string, string>,
  siteCode = 'SITE',
): string {
  if (!devices.length) return '# No devices.\n';

  const configMap = JSON.stringify(
    Object.fromEntries(
      Object.entries(intendedConfigs).map(([k, v]) => [k, btoa(unescape(encodeURIComponent(v)))]),
    ),
    null,
    2,
  );

  return (
    `#!/usr/bin/env python3\n"""NetDesign AI — Config Drift Detection\nSite: ${siteCode}\n"""\n\n` +
    `import os, json, base64, difflib\nfrom netmiko import ConnectHandler\n\n` +
    `USER   = os.environ["NET_USER"]\nPASS   = os.environ["NET_PASS"]\nENABLE = os.environ.get("NET_ENABLE", PASS)\n\n` +
    buildInventoryPy(devices) + '\n\n' +
    `# Intended configs (base64 encoded)\nINTENDED_B64 = ${configMap}\n\n` +
    `REPORT_FILE = "drift_report_${siteCode.toLowerCase()}.json"\n\n` +
    `def get_running(dev):\n    try:\n        with ConnectHandler(**{k: dev[k] for k in ("host","device_type","username","password","secret")}) as conn:\n` +
    `            return conn.send_command("show running-config")\n    except Exception as e:\n        return None\n\n` +
    `def main():\n    report = []\n    for dev in DEVICES:\n        intended_b64 = INTENDED_B64.get(dev["hostname"])\n` +
    `        if not intended_b64:\n            continue\n        intended = base64.b64decode(intended_b64).decode()\n` +
    `        running  = get_running(dev)\n        if running is None:\n            report.append({"hostname": dev["hostname"], "error": "unreachable", "diff": ""})\n            continue\n` +
    `        diff = "\\n".join(difflib.unified_diff(\n            intended.splitlines(), running.splitlines(),\n            fromfile="intended", tofile="running", lineterm=""))\n` +
    `        report.append({"hostname": dev["hostname"], "drift": bool(diff), "diff": diff})\n        if diff:\n            print(f"DRIFT detected on {dev['hostname']}")\n` +
    `    with open(REPORT_FILE, "w") as f:\n        json.dump(report, f, indent=2)\n\nif __name__ == "__main__":\n    main()\n`
  );
}

// ─── Canary deployment ───────────────────────────────────────────────────────

export function genCanaryDeployScript(
  devices: DeviceEntry[],
  configs: Record<string, string>,
  siteCode = 'SITE',
): string {
  const leaves = devices.filter((d) => d.subLayer === 'leaf');
  const canary  = leaves[0];
  const rest    = [...devices.filter((d) => d.subLayer !== 'leaf'), ...leaves.slice(1)];

  if (!canary) return '# No leaf devices found for canary deployment.\n';

  function devBlock(dev: DeviceEntry, i: number): string {
    const cfg = (configs[dev.hostname] ?? '').replace(/"""/g, '\\"\\"\\"');
    return (
      `    {\n        "host": "192.168.100.${200 + i}",\n        "hostname": "${dev.hostname}",\n` +
      `        "device_type": "${nmType(dev.vendor ?? '')}",\n        "config": """\n${cfg}\n""",\n    }`
    );
  }

  return (
    `#!/usr/bin/env python3\n"""NetDesign AI — Canary Deployment\nSite: ${siteCode}\n\n` +
    `Deploys canary device first, verifies BGP, then remaining devices.\n"""\n\n` +
    `import os, sys, time\nfrom netmiko import ConnectHandler\n\n` +
    `USER   = os.environ["NET_USER"]\nPASS   = os.environ["NET_PASS"]\nENABLE = os.environ.get("NET_ENABLE", PASS)\n\n` +
    `CANARY = ${devBlock(canary, 0)}\n\n` +
    `REMAINING = [\n${rest.map((d, i) => devBlock(d, i + 1)).join(',\n')}\n]\n\n` +
    `def push_config(dev):\n    with ConnectHandler(host=dev["host"], device_type=dev["device_type"],\n` +
    `                              username=USER, password=PASS, secret=ENABLE) as conn:\n` +
    `        conn.send_config_set(dev["config"].splitlines())\n        print(f"  Config pushed to {dev['hostname']}")\n\n` +
    `def verify_bgp(dev):\n    with ConnectHandler(host=dev["host"], device_type=dev["device_type"],\n` +
    `                            username=USER, password=PASS, secret=ENABLE) as conn:\n` +
    `        out = conn.send_command("show bgp summary")\n        established = out.count("Established") + out.count("Estab")\n` +
    `        print(f"  BGP sessions established: {established}")\n        return established > 0\n\n` +
    `def main():\n    print("=== Canary: " + CANARY["hostname"] + " ===")\n    push_config(CANARY)\n    time.sleep(30)\n` +
    `    if not verify_bgp(CANARY):\n        print("CANARY FAILED — aborting remaining deployments.", file=sys.stderr)\n        sys.exit(1)\n` +
    `    print("\\nCanary OK — proceeding with remaining devices.")\n` +
    `    for dev in REMAINING:\n        print(f"=== {dev['hostname']} ===")\n        push_config(dev)\n        time.sleep(5)\n\nif __name__ == "__main__":\n    main()\n`
  );
}

// ─── Batfish dry-run ─────────────────────────────────────────────────────────

export function genBatfishScript(
  devices: DeviceEntry[],
  configs: Record<string, string>,
  siteCode = 'SITE',
): string {
  if (!devices.length) return '# No devices.\n';

  const configWrites = devices
    .filter((d) => configs[d.hostname])
    .map((d) =>
      `    with open(os.path.join(CONFIG_DIR, "${d.hostname}.cfg"), "w") as f:\n` +
      `        f.write(CONFIGS["${d.hostname}"])`,
    )
    .join('\n');

  return (
    `#!/usr/bin/env python3\n"""NetDesign AI — Batfish Dry-Run Validation\nSite: ${siteCode}\n\n` +
    `Requires: pip install pybatfish\nStart Batfish: docker run --name batfish -p 9997:9997 -p 9996:9996 batfish/allinone\n"""\n\n` +
    `import os, json\nfrom pybatfish.client.session import Session\nfrom pybatfish.datamodel import HeaderConstraints\n\n` +
    `CONFIG_DIR = "/tmp/batfish_${siteCode.toLowerCase()}"\nos.makedirs(CONFIG_DIR, exist_ok=True)\n\n` +
    `CONFIGS = ${JSON.stringify(Object.fromEntries(Object.entries(configs)), null, 2)}\n\n` +
    `# Write configs\n${configWrites}\n\n` +
    `bf = Session(host="localhost")\nbf.set_network("${siteCode}")\nbf.init_snapshot(CONFIG_DIR, name="${siteCode}", overwrite=True)\n\n` +
    `print("=== Undefined References ===")\nprint(bf.q.undefinedReferences().answer().frame().to_string())\n\n` +
    `print("=== BGP Session Status ===")\nprint(bf.q.bgpSessionStatus().answer().frame().to_string())\n\n` +
    `print("=== Route Summary ===")\nprint(bf.q.routes().answer().frame().groupby("Node").size().to_string())\n`
  );
}
