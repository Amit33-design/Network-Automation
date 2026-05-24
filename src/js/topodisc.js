'use strict';

// ─── G-36: Automated LLDP/CDP topology SSH crawl ─────────────────────────────
// Generates a Python BFS crawler that starts from seed devices (from BOM),
// SSHes in via Netmiko, runs show lldp neighbors detail (+ CDP fallback on
// Cisco), parses the output, discovers new devices, and recurses until no new
// nodes are found or MAX_HOPS is reached.

var TOPO_PLATFORM_MAP = {
  'cisco':   { platform: 'nxos',  driver: 'cisco_nxos' },
  'arista':  { platform: 'eos',   driver: 'arista_eos' },
  'juniper': { platform: 'junos', driver: 'juniper_junos' },
  'nvidia':  { platform: 'sonic', driver: 'linux' },
  'sonic':   { platform: 'sonic', driver: 'linux' }
};

function _topoVendorMap(vendor) {
  var v = (vendor || '').toLowerCase();
  for (var k in TOPO_PLATFORM_MAP) {
    if (v.includes(k)) return TOPO_PLATFORM_MAP[k];
  }
  return { platform: 'nxos', driver: 'cisco_nxos' };
}

function _buildSeedsPy(devices) {
  if (!devices || !devices.length) {
    return 'SEEDS = []  # No devices — complete Step 1 first\n';
  }
  var lines = ['SEEDS = ['];
  devices.forEach(function(dev) {
    var pm   = _topoVendorMap(dev.vendor);
    var ip   = dev.mgmtIp || ('192.168.1.' + (dev.unit || 1));
    lines.push('    {');
    lines.push('        "host": "' + ip + '",');
    lines.push('        "hostname": "' + dev.hostname + '",');
    lines.push('        "platform": "' + pm.platform + '",');
    lines.push('        "device_type": "' + pm.driver + '",');
    lines.push('    },');
  });
  lines.push(']');
  return lines.join('\n');
}

window.genTopoCrawlScript = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var site = (state && state.siteCode) || 'SITE';

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — LLDP/CDP Topology Crawler (G-36)',
    'Site: ' + site,
    'Generated: ' + new Date().toISOString(),
    '',
    'Starts from seed devices (your BOM), SSHes in via Netmiko,',
    'runs "show lldp neighbors detail" (+ CDP fallback on Cisco),',
    'parses neighbors, and crawls BFS until no new devices are found',
    'or MAX_HOPS is reached.',
    '',
    'Usage:',
    '  pip install netmiko',
    '  export NET_USER=admin NET_PASS=secretpass',
    '  python3 topo_crawl_' + site.toLowerCase() + '.py',
    '',
    'Output: topo_crawl_' + site.toLowerCase() + '.json',
    '  { "nodes": [...], "edges": [...], "timestamp": "..." }',
    '"""',
    '',
    'import os, sys, json, re, datetime',
    'from collections import deque',
    'from netmiko import ConnectHandler',
    'from netmiko.exceptions import NetmikoTimeoutException, NetmikoAuthenticationException',
    '',
    'USER   = os.environ["NET_USER"]',
    'PASS   = os.environ["NET_PASS"]',
    'ENABLE = os.environ.get("NET_ENABLE", PASS)',
    '',
    _buildSeedsPy(devices),
    '',
    'MAX_HOPS    = 5',
    'OUTPUT_FILE = "topo_crawl_' + site.toLowerCase() + '.json"',
    '',
    'LLDP_CMD = {',
    '    "nxos":  "show lldp neighbors detail",',
    '    "eos":   "show lldp neighbors detail",',
    '    "junos": "show lldp neighbors detail",',
    '    "iosxe": "show lldp neighbors detail",',
    '    "sonic": "lldpctl -f keyvalue",',
    '}',
    '',
    'CDP_CMD = {',
    '    "nxos":  "show cdp neighbors detail",',
    '    "iosxe": "show cdp neighbors detail",',
    '}',
    '',
    '',
    'def parse_lldp_nxos(output):',
    '    """Parse show lldp neighbors detail — NX-OS format."""',
    '    neighbors = []',
    '    for block in re.split(r"-{10,}", output):',
    '        n = {}',
    '        m = re.search(r"System Name:\\s*(\\S+)", block)',
    '        if m: n["system_name"] = m.group(1)',
    '        m = re.search(r"Port id:\\s*(\\S+)", block)',
    '        if m: n["remote_port"] = m.group(1)',
    '        m = re.search(r"Local Port id:\\s*(\\S+)", block)',
    '        if m: n["local_port"] = m.group(1)',
    '        m = re.search(r"(?:Management Addresses?|IPv4 address)\\s*[:\\n]+\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)", block)',
    '        if m: n["mgmt_ip"] = m.group(1)',
    '        m = re.search(r"System Description:\\s*(.+?)(?=\\n\\s*\\n|\\n\\s*[A-Z]|$)", block, re.DOTALL)',
    '        if m: n["system_desc"] = m.group(1).strip()[:120]',
    '        if n.get("system_name") or n.get("mgmt_ip"):',
    '            neighbors.append(n)',
    '    return neighbors',
    '',
    '',
    'def parse_lldp_eos(output):',
    '    """Parse show lldp neighbors detail — EOS format."""',
    '    neighbors = []',
    '    for m_iface in re.finditer(r"Interface (\\S+) detected", output):',
    '        local_port = m_iface.group(1)',
    '        block_start = m_iface.end()',
    '        next_m = re.search(r"Interface \\S+ detected", output[block_start:])',
    '        block = output[block_start: block_start + (next_m.start() if next_m else len(output))]',
    '        n = {"local_port": local_port}',
    '        m = re.search(r\'System name\\s*:\\s*"?([^"\\n]+)"?\', block)',
    '        if m: n["system_name"] = m.group(1).strip()',
    '        m = re.search(r\'Port ID\\s*:\\s*"?([^"\\n]+)"?\', block)',
    '        if m: n["remote_port"] = m.group(1).strip()',
    '        m = re.search(r"Management Address\\s*:\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)", block)',
    '        if m: n["mgmt_ip"] = m.group(1)',
    '        m = re.search(r\'System description\\s*:\\s*"?([^"\\n]+)"?\', block)',
    '        if m: n["system_desc"] = m.group(1).strip()[:120]',
    '        if n.get("system_name") or n.get("mgmt_ip"):',
    '            neighbors.append(n)',
    '    return neighbors',
    '',
    '',
    'def parse_lldp_junos(output):',
    '    """Parse show lldp neighbors detail — JunOS format."""',
    '    neighbors = []',
    '    for block in re.split(r"LLDP Neighbor Information", output)[1:]:',
    '        n = {}',
    '        m = re.search(r"System name\\s*:\\s*(\\S+)", block)',
    '        if m: n["system_name"] = m.group(1)',
    '        m = re.search(r"Port ID\\s*:\\s*(\\S+)", block)',
    '        if m: n["remote_port"] = m.group(1)',
    '        m = re.search(r"(?:Parent Interface|Local Interface)\\s*:\\s*(\\S+)", block)',
    '        if m: n["local_port"] = m.group(1)',
    '        m = re.search(r"Management address\\s*:\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)", block)',
    '        if m: n["mgmt_ip"] = m.group(1)',
    '        m = re.search(r"System description\\s*:\\s*(.+?)(?=\\n\\s*[A-Z]|$)", block, re.DOTALL)',
    '        if m: n["system_desc"] = m.group(1).strip()[:120]',
    '        if n.get("system_name") or n.get("mgmt_ip"):',
    '            neighbors.append(n)',
    '    return neighbors',
    '',
    '',
    'def parse_lldp_sonic(output):',
    '    """Parse lldpctl -f keyvalue output."""',
    '    neighbors = []',
    '    current = {}',
    '    for line in output.splitlines():',
    '        if line.startswith("lldp.") and "=" in line:',
    '            key, _, val = line.partition("=")',
    '            parts = key.strip().split(".")',
    '            if len(parts) >= 4:',
    '                iface = parts[1]',
    '                attr  = ".".join(parts[3:])',
    '                if iface not in current: current[iface] = {"local_port": iface}',
    '                if "port.descr" in attr or "port.id" in attr:',
    '                    current[iface]["remote_port"] = val.strip()',
    '                elif "chassis.name" in attr:',
    '                    current[iface]["system_name"] = val.strip()',
    '                elif "chassis.mgmt-ip" in attr:',
    '                    current[iface]["mgmt_ip"] = val.strip()',
    '                elif "chassis.descr" in attr:',
    '                    current[iface]["system_desc"] = val.strip()[:120]',
    '    for n in current.values():',
    '        if n.get("system_name") or n.get("mgmt_ip"):',
    '            neighbors.append(n)',
    '    return neighbors',
    '',
    '',
    'def parse_cdp(output):',
    '    """Parse show cdp neighbors detail — NX-OS / IOS-XE format."""',
    '    neighbors = []',
    '    for block in re.split(r"-{10,}", output):',
    '        n = {}',
    '        m = re.search(r"Device ID:\\s*(\\S+)", block)',
    '        if m: n["system_name"] = m.group(1)',
    '        m = re.search(r"Interface:\\s*(\\S+),", block)',
    '        if m: n["local_port"] = m.group(1)',
    '        m = re.search(r"Port ID \\(outgoing port\\):\\s*(\\S+)", block)',
    '        if m: n["remote_port"] = m.group(1)',
    '        m = re.search(r"IP(?:v4)? [Aa]ddress:\\s*(\\d+\\.\\d+\\.\\d+\\.\\d+)", block)',
    '        if m: n["mgmt_ip"] = m.group(1)',
    '        m = re.search(r"Platform:\\s*(.+?),", block)',
    '        if m: n["system_desc"] = m.group(1).strip()[:120]',
    '        if n.get("system_name") or n.get("mgmt_ip"):',
    '            neighbors.append(n)',
    '    return neighbors',
    '',
    '',
    'def detect_platform(desc):',
    '    """Guess platform from LLDP/CDP system description string."""',
    '    d = (desc or "").lower()',
    '    if "arista" in d:                        return "eos",   "arista_eos"',
    '    if "junos" in d or "juniper" in d:       return "junos", "juniper_junos"',
    '    if "nexus" in d or "nx-os" in d:         return "nxos",  "cisco_nxos"',
    '    if "ios-xe" in d or "ios xe" in d:       return "iosxe", "cisco_ios"',
    '    if "sonic" in d or "debian" in d:        return "sonic", "linux"',
    '    return "nxos", "cisco_nxos"',
    '',
    '',
    'def get_neighbors(dev, conn):',
    '    """Run LLDP on device; fall back to CDP on Cisco if LLDP returns nothing."""',
    '    platform = dev["platform"]',
    '    neighbors = []',
    '    lldp_cmd = LLDP_CMD.get(platform)',
    '    if lldp_cmd:',
    '        try:',
    '            out = conn.send_command(lldp_cmd, read_timeout=30)',
    '            if platform == "eos":',
    '                neighbors = parse_lldp_eos(out)',
    '            elif platform == "junos":',
    '                neighbors = parse_lldp_junos(out)',
    '            elif platform == "sonic":',
    '                neighbors = parse_lldp_sonic(out)',
    '            else:',
    '                neighbors = parse_lldp_nxos(out)',
    '        except Exception as e:',
    '            dev.setdefault("warnings", []).append(f"LLDP error: {e}")',
    '    if not neighbors and platform in CDP_CMD:',
    '        try:',
    '            out = conn.send_command(CDP_CMD[platform], read_timeout=30)',
    '            neighbors = parse_cdp(out)',
    '        except Exception as e:',
    '            dev.setdefault("warnings", []).append(f"CDP error: {e}")',
    '    return neighbors',
    '',
    '',
    'def crawl(seeds, max_hops=MAX_HOPS):',
    '    nodes = {}   # hostname → node dict',
    '    edges = []   # {src, src_port, dst, dst_port}',
    '    queue = deque()',
    '    visited = set()  # visited IPs',
    '',
    '    for seed in seeds:',
    '        seed = dict(seed)  # don\'t mutate original',
    '        seed.setdefault("hop", 0)',
    '        hn = seed.get("hostname") or seed["host"]',
    '        nodes[hn] = seed',
    '        queue.append(seed)',
    '',
    '    while queue:',
    '        dev = queue.popleft()',
    '        hn  = dev.get("hostname") or dev["host"]',
    '        hop = dev.get("hop", 0)',
    '',
    '        if dev["host"] in visited: continue',
    '        if hop > max_hops: continue',
    '        visited.add(dev["host"])',
    '',
    '        print(f"  [hop {hop}] {hn} ({dev[\'host\']})...", end="", flush=True)',
    '        try:',
    '            conn_p = {',
    '                "host": dev["host"], "device_type": dev["device_type"],',
    '                "username": USER, "password": PASS',
    '            }',
    '            if dev["device_type"] != "linux": conn_p["secret"] = ENABLE',
    '            with ConnectHandler(**conn_p) as conn:',
    '                if conn_p.get("secret"): conn.enable()',
    '                nbrs = get_neighbors(dev, conn)',
    '            dev["status"] = "ok"',
    '            print(f" {len(nbrs)} neighbor(s)")',
    '        except (NetmikoTimeoutException, NetmikoAuthenticationException) as e:',
    '            dev["status"] = "error"',
    '            dev["error"]  = str(e)',
    '            print(f" ERROR: {e}")',
    '            nbrs = []',
    '',
    '        nodes[hn] = {**dev, "hostname": hn}',
    '',
    '        for nbr in nbrs:',
    '            nbr_hn = nbr.get("system_name") or nbr.get("mgmt_ip") or "unknown"',
    '            nbr_ip = nbr.get("mgmt_ip", "")',
    '            desc   = nbr.get("system_desc", "")',
    '            plat, drvr = detect_platform(desc)',
    '            edges.append({',
    '                "src": hn,     "src_port": nbr.get("local_port",  "?"),',
    '                "dst": nbr_hn, "dst_port": nbr.get("remote_port", "?")',
    '            })',
    '            if nbr_hn not in nodes and nbr_ip and nbr_ip not in visited:',
    '                new_dev = {',
    '                    "host": nbr_ip, "hostname": nbr_hn,',
    '                    "device_type": drvr, "platform": plat,',
    '                    "hop": hop + 1',
    '                }',
    '                nodes[nbr_hn] = new_dev',
    '                queue.append(new_dev)',
    '',
    '    return list(nodes.values()), edges',
    '',
    '',
    'def main():',
    '    if not SEEDS:',
    '        print("No seed devices — edit SEEDS list.", file=sys.stderr)',
    '        sys.exit(1)',
    '    print(f"Topology crawl — {len(SEEDS)} seed(s), max {MAX_HOPS} hops")',
    '    nodes, edges = crawl(SEEDS)',
    '    result = {',
    '        "timestamp": datetime.datetime.utcnow().isoformat(),',
    '        "seed_count": len(SEEDS),',
    '        "nodes": nodes,',
    '        "edges": edges',
    '    }',
    '    with open(OUTPUT_FILE, "w") as f:',
    '        json.dump(result, f, indent=2)',
    '    ok_nodes  = sum(1 for n in nodes if n.get("status") == "ok")',
    '    err_nodes = sum(1 for n in nodes if n.get("status") == "error")',
    '    print(f"\\nCrawl complete: {len(nodes)} nodes ({ok_nodes} reached, {err_nodes} errors), {len(edges)} links")',
    '    print(f"Output: {OUTPUT_FILE}")',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
};

window.downloadTopoCrawlScript = function() {
  if (!STATE.devices || !STATE.devices.length) {
    if (window.showToast) window.showToast('Complete Step 1 first', 'warning');
    return;
  }
  var site   = STATE.siteCode || 'SITE';
  var script = window.genTopoCrawlScript(STATE.devices, STATE);
  if (window.downloadFile) window.downloadFile('topo_crawl_' + site.toLowerCase() + '.py', script, 'text/plain');
};

// ─── G-36: Topology crawl result renderer ────────────────────────────────────

window.renderTopoCrawlResult = function(jsonStr) {
  var data;
  try { data = JSON.parse(jsonStr); } catch (e) {
    return '<p class="val-block val-block-error">Invalid JSON: ' + e.message + '</p>';
  }
  var nodes = data.nodes || [];
  var edges = data.edges || [];
  var ts    = (data.timestamp || '').replace('T', ' ').slice(0, 19);

  if (!nodes.length) {
    return '<p class="empty-state">No nodes in crawl result.</p>';
  }

  var ok_count  = nodes.filter(function(n) { return n.status === 'ok'; }).length;
  var err_count = nodes.filter(function(n) { return n.status === 'error'; }).length;
  var unk_count = nodes.length - ok_count - err_count;

  var summary = '<div class="val-block val-block-error" style="background:rgba(99,102,241,.08);border-color:rgba(99,102,241,.4);">'
    + '<div class="val-block-hdr" style="color:#818cf8;">'
    + '🔍 Topology crawl — ' + nodes.length + ' nodes, ' + edges.length + ' links'
    + (ts ? ' &nbsp;|&nbsp; ' + ts : '')
    + '</div>'
    + '<div style="margin-top:4px;font-size:12px;color:var(--text-dim)">'
    + 'Reached: ' + ok_count
    + (err_count ? ' &nbsp;|&nbsp; Errors: ' + err_count : '')
    + (unk_count ? ' &nbsp;|&nbsp; Discovered (not crawled): ' + unk_count : '')
    + '</div></div>';

  // Node table
  var nodeRows = nodes.map(function(n) {
    var hn       = n.hostname || n.host || '?';
    var ip       = n.host || '—';
    var plat     = n.platform || '?';
    var hopBadge = typeof n.hop === 'number' ? '<span style="font-size:11px;color:var(--text-dim)">hop ' + n.hop + '</span>' : '';
    var statusHtml;
    if (n.status === 'ok') {
      statusHtml = '<span style="color:var(--success)">✓ reached</span>';
    } else if (n.status === 'error') {
      statusHtml = '<span style="color:var(--danger)" title="' + (n.error || '') + '">✗ error</span>';
    } else {
      statusHtml = '<span style="color:var(--text-dim)">discovered</span>';
    }
    return '<tr>'
      + '<td>' + hn.replace(/</g,'&lt;') + ' ' + hopBadge + '</td>'
      + '<td>' + ip + '</td>'
      + '<td><span class="platform-badge">' + plat + '</span></td>'
      + '<td>' + statusHtml + '</td>'
      + '</tr>';
  }).join('');

  var nodeTable = '<h4 style="margin:16px 0 6px;">Nodes (' + nodes.length + ')</h4>'
    + '<div style="overflow-x:auto;">'
    + '<table class="rollback-table diff-table">'
    + '<thead><tr><th>Hostname</th><th>Mgmt IP</th><th>Platform</th><th>Status</th></tr></thead>'
    + '<tbody>' + nodeRows + '</tbody>'
    + '</table></div>';

  // Edge table
  var edgeRows = edges.map(function(e) {
    return '<tr>'
      + '<td>' + (e.src || '?').replace(/</g,'&lt;') + '</td>'
      + '<td style="color:var(--text-dim);font-size:12px;">' + (e.src_port || '?') + '</td>'
      + '<td style="text-align:center;color:var(--text-dim);">↔</td>'
      + '<td>' + (e.dst || '?').replace(/</g,'&lt;') + '</td>'
      + '<td style="color:var(--text-dim);font-size:12px;">' + (e.dst_port || '?') + '</td>'
      + '</tr>';
  }).join('');

  var edgeTable = '<h4 style="margin:16px 0 6px;">Links (' + edges.length + ')</h4>'
    + '<div style="overflow-x:auto;">'
    + '<table class="rollback-table diff-table">'
    + '<thead><tr><th>Source</th><th>Src Port</th><th></th><th>Destination</th><th>Dst Port</th></tr></thead>'
    + '<tbody>' + edgeRows + '</tbody>'
    + '</table></div>';

  return summary + nodeTable + (edges.length ? edgeTable : '');
};
