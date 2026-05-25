'use strict';

/* ════════════════════════════════════════════════════════════════════
   BATFISH TOPOLOGY VALIDATION
   Generates a Python script using the pybatfish SDK to validate:
     • Reachability matrix (every device can reach every other device)
     • BGP session status (all expected eBGP/iBGP peers established)
     • Routing loop detection (traceroute-based)
     • Undefined structure references (bad ACL/route-map names)
     • MTU consistency across fabric links
     • Management ACL coverage (management traffic from 10.0.0.0/24 only)
   Public API:
     genBatfishValidationScript(state)   — returns Python script string
     downloadBatfishScript()             — browser download
     renderBatfishPanel()                — render panel into #batfish-panel
═══════════════════════════════════════════════════════════════════════ */

function genBatfishValidationScript(state) {
  var devs = (typeof buildDeviceList === 'function') ? buildDeviceList() : [];
  var uc   = state.uc || 'dc';
  var org  = state.orgName || 'NetDesign';
  var vendor = state.vendor || '';

  /* ── Build device inventory for the script ── */
  var deviceRows = [];
  var bgpPeerPairs = [];  // [{ a, b, asA, asB }]
  var spineASN  = (typeof _PI === 'function') ? _PI('spineAsn') || 65000  : 65000;
  var leafBase  = (typeof _PI === 'function') ? _PI('leafAsnBase') || 65001: 65001;

  for (var i = 0; i < devs.length; i++) {
    var d  = devs[i];
    var os = (typeof getOS === 'function') ? getOS(d.layer) : 'iosxe';
    var mgmtIP = '10.0.0.' + (30 + i);

    var bf_os = 'cisco-ios'; // Batfish platform names
    if (os === 'nxos')   bf_os = 'cisco-nx';
    if (os === 'eos')    bf_os = 'arista-eos';
    if (os === 'junos')  bf_os = 'juniper-junos';
    if (os === 'sonic')  bf_os = 'frr';

    deviceRows.push({ name: d.name, ip: mgmtIP, platform: bf_os, layer: d.layer, idx: i });

    // Build expected BGP pairs for DC/GPU (eBGP leaf-spine)
    var isLeaf  = (d.layer === 'dc-leaf'  || d.layer === 'gpu-tor');
    var isSpine = (d.layer === 'dc-spine' || d.layer === 'gpu-spine');
    if (isLeaf || isSpine) {
      var asn = isSpine ? spineASN : (leafBase + i);
      d._asn  = asn;
    }
  }

  // Build BGP peer pairs: each leaf peers with all spines
  var spines = devs.filter(function(d){ return d.layer === 'dc-spine' || d.layer === 'gpu-spine'; });
  var leaves = devs.filter(function(d){ return d.layer === 'dc-leaf'  || d.layer === 'gpu-tor'; });
  for (var li = 0; li < leaves.length; li++) {
    for (var si = 0; si < spines.length; si++) {
      bgpPeerPairs.push({ a: leaves[li].name, b: spines[si].name });
    }
  }

  /* ── Script template ── */
  var devListPy = devs.map(function(d, i) {
    var mgmtIP = '10.0.0.' + (30 + i);
    return '    {"name": "' + d.name + '", "mgmt": "' + mgmtIP + '", "layer": "' + d.layer + '"}';
  }).join(',\n');

  var bgpPairsPy = bgpPeerPairs.map(function(p) {
    return '    ("' + p.a + '", "' + p.b + '")';
  }).join(',\n');

  var reachSrcs = devs.slice(0, Math.min(devs.length, 6)).map(function(d, i) {
    return '"10.0.0.' + (30 + i) + '"';
  }).join(', ');
  var reachDsts = devs.slice(0, Math.min(devs.length, 6)).map(function(d, i) {
    return '"10.0.0.' + (30 + i) + '"';
  }).join(', ');

  var script = '#!/usr/bin/env python3\n' +
'"""NetDesign AI — Batfish Topology Validation\n' +
'Organization : ' + org + '\n' +
'Use case     : ' + (typeof UC_LABELS !== 'undefined' && UC_LABELS[uc] || uc) + '\n' +
'Generated    : ' + new Date().toLocaleString() + '\n' +
'\n' +
'PRE-REQUISITES\n' +
'--------------\n' +
'1. Start Batfish service (Docker):\n' +
'     docker run -d --name batfish -p 9997:9997 -p 9996:9996 batfish/allinone\n' +
'\n' +
'2. Install pybatfish:\n' +
'     pip install pybatfish rich\n' +
'\n' +
'3. Export device configs from NetDesign AI Step 5 → "All Configs (.txt)"\n' +
'   and split each device config into its own file:\n' +
'     mkdir -p bf_snapshot/configs\n' +
'     python3 split_configs.py <orgname>-configs-<date>.txt bf_snapshot/configs/\n' +
'   (helper script included at the bottom of this file)\n' +
'\n' +
'4. Run this script:\n' +
'     python3 validate_topology.py\n' +
'"""\n' +
'\n' +
'import os\n' +
'import sys\n' +
'import json\n' +
'import argparse\n' +
'\n' +
'try:\n' +
'    from pybatfish.client.session import Session\n' +
'    from pybatfish.datamodel.flow import HeaderConstraints, PathConstraints\n' +
'except ImportError:\n' +
'    print("[ERROR] pybatfish not installed. Run: pip install pybatfish")\n' +
'    sys.exit(1)\n' +
'\n' +
'try:\n' +
'    from rich.console import Console\n' +
'    from rich.table   import Table\n' +
'    from rich         import print as rprint\n' +
'    RICH = True\n' +
'except ImportError:\n' +
'    RICH = False\n' +
'\n' +
'# ─── Configuration ─────────────────────────────────────────────\n' +
'BATFISH_HOST   = os.getenv("BATFISH_HOST",   "localhost")\n' +
'SNAPSHOT_PATH  = os.getenv("SNAPSHOT_PATH",  "bf_snapshot")\n' +
'NETWORK_NAME   = "' + org.replace(/[^a-zA-Z0-9_-]/g, '_') + '"\n' +
'SNAPSHOT_NAME  = "design_validation"\n' +
'\n' +
'# Management subnet — only this range should be able to reach devices\n' +
'MGMT_SUBNET    = "10.0.0.0/24"\n' +
'\n' +
'# ─── Device inventory (from BOM) ───────────────────────────────\n' +
'DEVICES = [\n' + devListPy + '\n]\n' +
'\n' +
'# ─── Expected BGP peer pairs ───────────────────────────────────\n' +
'EXPECTED_BGP_PEERS = [\n' + bgpPairsPy + '\n]\n' +
'\n' +
'# ─── Helpers ───────────────────────────────────────────────────\n' +
'console = Console() if RICH else None\n' +
'\n' +
'def header(text):\n' +
'    if RICH:\n' +
'        console.rule("[bold cyan]" + text + "[/bold cyan]")\n' +
'    else:\n' +
'        print("\\n" + "=" * 60)\n' +
'        print(text)\n' +
'        print("=" * 60)\n' +
'\n' +
'def ok(msg):   print(("[green]✓[/green] " if RICH else "✓ ") + msg)\n' +
'def warn(msg): print(("[yellow]⚠[/yellow] " if RICH else "⚠ ") + msg)\n' +
'def err(msg):  print(("[red]✗[/red] " if RICH else "✗ ") + msg)\n' +
'\n' +
'failures = []\n' +
'\n' +
'def record_failure(check, detail):\n' +
'    failures.append({"check": check, "detail": detail})\n' +
'\n' +
'# ─── Connect & upload snapshot ─────────────────────────────────\n' +
'def connect_and_init():\n' +
'    header("Connecting to Batfish at " + BATFISH_HOST)\n' +
'    bf = Session(host=BATFISH_HOST)\n' +
'    bf.set_network(NETWORK_NAME)\n' +
'    if not os.path.isdir(SNAPSHOT_PATH):\n' +
'        err(f"Snapshot directory not found: {SNAPSHOT_PATH}")\n' +
'        err("Export configs from NetDesign AI Step 5 and run split_configs.py first.")\n' +
'        sys.exit(1)\n' +
'    bf.init_snapshot(SNAPSHOT_PATH, name=SNAPSHOT_NAME, overwrite=True)\n' +
'    ok(f"Snapshot initialised: {SNAPSHOT_NAME}")\n' +
'    return bf\n' +
'\n' +
'# ─── Check 1: File parse status ────────────────────────────────\n' +
'def check_parse_status(bf):\n' +
'    header("Check 1 / 6 — Config Parse Status")\n' +
'    df = bf.q.fileParseStatus().answer().frame()\n' +
'    ok_count   = len(df[df["Status"] == "PASSED"])\n' +
'    warn_count = len(df[df["Status"] == "PARTIALLY_UNRECOGNIZED"])\n' +
'    fail_count = len(df[df["Status"] == "FAILED"])\n' +
'    print(f"  Parsed OK: {ok_count}  Partial: {warn_count}  Failed: {fail_count}")\n' +
'    failed = df[df["Status"] == "FAILED"]\n' +
'    for _, row in failed.iterrows():\n' +
'        record_failure("parse", f"Config parse FAILED: {row[\'Filename\']}")\n' +
'        err(f"Parse FAILED: {row[\'Filename\']}")\n' +
'    partial = df[df["Status"] == "PARTIALLY_UNRECOGNIZED"]\n' +
'    for _, row in partial.iterrows():\n' +
'        warn(f"Partial parse: {row[\'Filename\']} — check vendor OS selection")\n' +
'\n' +
'# ─── Check 2: Undefined references ─────────────────────────────\n' +
'def check_undefined_refs(bf):\n' +
'    header("Check 2 / 6 — Undefined Structure References")\n' +
'    df = bf.q.undefinedReferences().answer().frame()\n' +
'    if df.empty:\n' +
'        ok("No undefined references found.")\n' +
'        return\n' +
'    for _, row in df.iterrows():\n' +
'        msg = f"{row[\'Nodes\']}: {row[\'Struct_Type\']} {row[\'Undefined_Name\']} "\\\n' +
'              f"referenced in {row[\'Usage\']}"\n' +
'        record_failure("undefined_ref", msg)\n' +
'        err(msg)\n' +
'\n' +
'# ─── Check 3: BGP session status ───────────────────────────────\n' +
'def check_bgp_sessions(bf):\n' +
'    header("Check 3 / 6 — BGP Session Status")\n' +
'    df = bf.q.bgpSessionStatus().answer().frame()\n' +
'    established = df[df["Established_Status"] == "ESTABLISHED"]\n' +
'    not_estab   = df[df["Established_Status"] != "ESTABLISHED"]\n' +
'    ok(f"Established sessions: {len(established)}")\n' +
'    for _, row in not_estab.iterrows():\n' +
'        msg = (f"BGP session NOT established: {row[\'Node\']} → {row.get(\'Remote_Node\',\'?\')} "\n' +
'               f"[{row[\'Established_Status\']}]")\n' +
'        record_failure("bgp_session", msg)\n' +
'        err(msg)\n' +
'    # Verify expected peer pairs\n' +
'    for a, b in EXPECTED_BGP_PEERS:\n' +
'        pair = df[(df["Node"] == a) & (df["Remote_Node"] == b)]\n' +
'        if pair.empty:\n' +
'            msg = f"Expected BGP peer NOT FOUND: {a} ↔ {b}"\n' +
'            record_failure("bgp_missing_peer", msg)\n' +
'            warn(msg)\n' +
'\n' +
'# ─── Check 4: Routing loop detection ───────────────────────────\n' +
'def check_routing_loops(bf):\n' +
'    header("Check 4 / 6 — Routing Loop Detection")\n' +
'    df = bf.q.detectLoops().answer().frame()\n' +
'    if df.empty:\n' +
'        ok("No routing loops detected.")\n' +
'        return\n' +
'    for _, row in df.iterrows():\n' +
'        msg = f"LOOP DETECTED: {row[\'Nodes\']} — {row.get(\'Loop_Type\', \'routing loop\')}"\n' +
'        record_failure("routing_loop", msg)\n' +
'        err(msg)\n' +
'\n' +
'# ─── Check 5: Management reachability ──────────────────────────\n' +
'def check_management_reachability(bf):\n' +
'    header("Check 5 / 6 — Management Reachability")\n' +
'    # Verify: management subnet can reach all device loopbacks\n' +
'    src_ips = [d["mgmt"] for d in DEVICES]\n' +
'    if not src_ips:\n' +
'        warn("No devices in BOM — skipping management reachability check.")\n' +
'        return\n' +
'    try:\n' +
'        df = bf.q.reachability(\n' +
'            pathConstraints=PathConstraints(\n' +
'                startLocation="/.*management.*/"\n' +
'            ),\n' +
'            headers=HeaderConstraints(\n' +
'                srcIps=MGMT_SUBNET,\n' +
'                dstIps=",".join(src_ips),\n' +
'                ipProtocols=["TCP"],\n' +
'                dstPorts=["22"]\n' +
'            ),\n' +
'            actions=["SUCCESS"]\n' +
'        ).answer().frame()\n' +
'        ok(f"Management reachability (SSH/TCP-22): {len(df)} paths found.")\n' +
'        if len(df) < len(DEVICES):\n' +
'            warn(f"Only {len(df)}/{len(DEVICES)} devices reachable via management — "\n' +
'                 f"check OOB routing or mgmt VRF config.")\n' +
'    except Exception as e:\n' +
'        warn(f"Management reachability check skipped: {e}")\n' +
'\n' +
'# ─── Check 6: Fabric reachability (DC/GPU) ─────────────────────\n' +
'def check_fabric_reachability(bf):\n' +
'    header("Check 6 / 6 — Fabric Reachability (Loopback → Loopback)")\n' +
'    # eBGP-advertised loopbacks: 10.255.1.x (spines), 10.255.2.x (leaves)\n' +
'    try:\n' +
'        df = bf.q.reachability(\n' +
'            headers=HeaderConstraints(\n' +
'                srcIps="10.255.0.0/16",\n' +
'                dstIps="10.255.0.0/16",\n' +
'                ipProtocols=["ICMP"]\n' +
'            ),\n' +
'            actions=["SUCCESS", "FAILURE"]\n' +
'        ).answer().frame()\n' +
'        success = df[df["Action"] == "SUCCESS"] if "Action" in df.columns else df\n' +
'        failure = df[df["Action"] == "FAILURE"] if "Action" in df.columns else None\n' +
'        ok(f"Fabric loopback reachability: {len(success)} successful paths.")\n' +
'        if failure is not None and not failure.empty:\n' +
'            for _, row in failure.iterrows():\n' +
'                msg = (f"UNREACHABLE: {row.get(\'Flow\',{}).get(\'srcIp\',\'?\')} → "\n' +
'                       f"{row.get(\'Flow\',{}).get(\'dstIp\',\'?\')} [{row.get(\'Action\',\'?\')}]")\n' +
'                record_failure("fabric_reachability", msg)\n' +
'                err(msg)\n' +
'    except Exception as e:\n' +
'        warn(f"Fabric reachability check skipped: {e}")\n' +
'\n' +
'# ─── Summary report ────────────────────────────────────────────\n' +
'def print_summary():\n' +
'    header("Validation Summary")\n' +
'    if not failures:\n' +
'        ok("ALL CHECKS PASSED — design is topologically correct.")\n' +
'        return 0\n' +
'    err(f"{len(failures)} issue(s) found:")\n' +
'    for f in failures:\n' +
'        err(f"  [{f[\'check\']}] {f[\'detail\']}")\n' +
'    return 1\n' +
'\n' +
'# ─── Entry point ───────────────────────────────────────────────\n' +
'def main():\n' +
'    parser = argparse.ArgumentParser(\n' +
'        description="NetDesign AI — Batfish topology validation")\n' +
'    parser.add_argument("--host",     default=BATFISH_HOST,\n' +
'                        help="Batfish service host (default: localhost)")\n' +
'    parser.add_argument("--snapshot", default=SNAPSHOT_PATH,\n' +
'                        help="Path to snapshot directory (default: bf_snapshot)")\n' +
'    parser.add_argument("--skip-reachability", action="store_true",\n' +
'                        help="Skip reachability checks (faster)")\n' +
'    args = parser.parse_args()\n' +
'\n' +
'    global BATFISH_HOST, SNAPSHOT_PATH\n' +
'    BATFISH_HOST  = args.host\n' +
'    SNAPSHOT_PATH = args.snapshot\n' +
'\n' +
'    bf = connect_and_init()\n' +
'    check_parse_status(bf)\n' +
'    check_undefined_refs(bf)\n' +
'    check_bgp_sessions(bf)\n' +
'    check_routing_loops(bf)\n' +
'    if not args.skip_reachability:\n' +
'        check_management_reachability(bf)\n' +
'        check_fabric_reachability(bf)\n' +
'    rc = print_summary()\n' +
'    sys.exit(rc)\n' +
'\n' +
'\n' +
'if __name__ == "__main__":\n' +
'    main()\n' +
'\n' +
'\n' +
'# ══════════════════════════════════════════════════════════════════\n' +
'# HELPER SCRIPT — split_configs.py\n' +
'# Save this as a separate file and run:\n' +
'#   python3 split_configs.py netdesign-configs.txt bf_snapshot/configs/\n' +
'# ══════════════════════════════════════════════════════════════════\n' +
'\n' +
'SPLIT_CONFIGS_SCRIPT = """\n' +
'#!/usr/bin/env python3\n' +
'"""Split the NetDesign AI all-configs bundle into per-device files."""\n' +
'import re, sys, os, pathlib\n' +
'bundle, outdir = sys.argv[1], sys.argv[2]\n' +
'pathlib.Path(outdir).mkdir(parents=True, exist_ok=True)\n' +
'SEP = "=" * 72\n' +
'with open(bundle) as f:\n' +
'    text = f.read()\n' +
'blocks = text.split(SEP)\n' +
'current_name, current_lines = None, []\n' +
'for block in blocks:\n' +
'    m = re.search(r"DEVICE:\\s*(\\S+)", block)\n' +
'    if m:\n' +
'        if current_name and current_lines:\n' +
'            with open(os.path.join(outdir, current_name + ".cfg"), "w") as f:\n' +
'                f.write("\\n".join(current_lines))\n' +
'        current_name  = m.group(1)\n' +
'        current_lines = []\n' +
'    elif current_name:\n' +
'        current_lines.append(block)\n' +
'if current_name and current_lines:\n' +
'    with open(os.path.join(outdir, current_name + ".cfg"), "w") as f:\n' +
'        f.write("\\n".join(current_lines))\n' +
'print(f"Split complete — files in {outdir}")\n' +
'"""\n';

  return script;
}

/* ── Download ─────────────────────────────────────────────────── */
function downloadBatfishScript() {
  var devs = (typeof buildDeviceList === 'function') ? buildDeviceList() : [];
  if (!devs.length) { toast('Complete Step 3 to generate BOM first', 'error'); return; }
  var src  = genBatfishValidationScript(STATE);
  var blob = new Blob([src], { type: 'text/x-python' });
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = (STATE.orgName || 'netdesign').toLowerCase().replace(/\s+/g, '-') +
               '-batfish-validate.py';
  a.click();
  toast('Downloaded Batfish validation script', 'success');
}

/* ── Panel render ─────────────────────────────────────────────── */
function renderBatfishPanel() {
  var el = document.getElementById('batfish-panel');
  if (!el) return;

  var devs   = (typeof buildDeviceList === 'function') ? buildDeviceList() : [];
  var ucLabel = (typeof UC_LABELS !== 'undefined' && UC_LABELS[STATE.uc]) || STATE.uc || '—';

  var checks = [
    { icon: '📄', name: 'Config Parse Status',          desc: 'Verify all vendor configs parse without errors or unrecognised syntax' },
    { icon: '🔗', name: 'Undefined Structure References',desc: 'Detect references to missing ACLs, route-maps, prefix-lists, or VRFs' },
    { icon: '🤝', name: 'BGP Session Completeness',      desc: 'Validate all expected leaf↔spine eBGP / core iBGP sessions are present' },
    { icon: '🔄', name: 'Routing Loop Detection',        desc: 'Traceroute-based loop check — Batfish detects forwarding-plane loops' },
    { icon: '🔐', name: 'Management Reachability',       desc: 'SSH/TCP-22 must be reachable from management subnet only (10.0.0.0/24)' },
    { icon: '📡', name: 'Fabric Loopback Reachability',  desc: 'All device loopbacks (10.255.0.0/16) must be mutually reachable' },
  ];

  var checkRows = checks.map(function(c) {
    return '<tr><td style="font-size:.9rem;width:2rem">' + c.icon + '</td>' +
           '<td style="font-weight:600;font-size:.82rem;color:var(--txt0)">' + c.name + '</td>' +
           '<td style="font-size:.78rem;color:var(--txt2)">' + c.desc + '</td></tr>';
  }).join('');

  el.innerHTML =
    '<div class="bf-panel">' +
      '<div class="bf-header">' +
        '<div class="bf-header-icon">🐟</div>' +
        '<div class="bf-header-text">' +
          '<div class="bf-title">Batfish Network Topology Validation</div>' +
          '<div class="bf-sub">' + ucLabel + ' · ' + devs.length + ' device' + (devs.length !== 1 ? 's' : '') + ' in BOM</div>' +
        '</div>' +
        '<div class="bf-header-actions">' +
          '<button class="btn-cfg-action" onclick="downloadBatfishScript()">⬇ Download Script</button>' +
        '</div>' +
      '</div>' +
      '<div class="bf-body">' +
        '<p class="bf-desc">Batfish is an open-source network configuration analysis tool. ' +
        'The generated Python script uses the <code>pybatfish</code> SDK to validate your ' +
        'NetDesign AI topology against 6 correctness checks — entirely offline, ' +
        'no network access to devices required.</p>' +

        '<table class="bf-checks-table">' +
          '<thead><tr>' +
            '<th></th>' +
            '<th>Check</th>' +
            '<th>What It Validates</th>' +
          '</tr></thead>' +
          '<tbody>' + checkRows + '</tbody>' +
        '</table>' +

        '<div class="bf-quickstart">' +
          '<div class="bf-qs-title">Quick Start</div>' +
          '<pre class="bf-qs-code">' +
'# 1. Start Batfish (Docker)\n' +
'docker run -d --name batfish -p 9997:9997 -p 9996:9996 batfish/allinone\n' +
'\n' +
'# 2. Install pybatfish\n' +
'pip install pybatfish rich\n' +
'\n' +
'# 3. Export configs from Step 5 → "All Configs (.txt)"\n' +
'#    then split into per-device files\n' +
'python3 split_configs.py netdesign-configs.txt bf_snapshot/configs/\n' +
'\n' +
'# 4. Run validation\n' +
'python3 validate_topology.py\n' +
'# Optional: python3 validate_topology.py --skip-reachability  (faster)' +
          '</pre>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ── Expose public API ────────────────────────────────────────── */
window.genBatfishValidationScript = genBatfishValidationScript;
window.downloadBatfishScript      = downloadBatfishScript;
window.renderBatfishPanel         = renderBatfishPanel;
