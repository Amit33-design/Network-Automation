'use strict';

// ─── G-29 + G-30 + G-31: ZTP — File Server · State Machine · Day-0/Day-N ─────

// ─── ZTP State Machine (G-30) ────────────────────────────────────────────────

var ZTP_STATE_ORDER = [
  'REGISTERED', 'POWERED_ON', 'DHCP_ACK', 'SCRIPT_DOWNLOADED',
  'CONFIG_APPLYING', 'CALLBACK_RECEIVED', 'VERIFIED', 'ONLINE'
];
var ZTP_STATE_COLORS = {
  REGISTERED:        '#64748b',
  POWERED_ON:        '#3b82f6',
  DHCP_ACK:          '#6366f1',
  SCRIPT_DOWNLOADED: '#8b5cf6',
  CONFIG_APPLYING:   '#f59e0b',
  CALLBACK_RECEIVED: '#10b981',
  VERIFIED:          '#22c55e',
  ONLINE:            '#22c55e',
  FAILED:            '#ef4444'
};

// Session-level ZTP state store: { hostname: { state, ts, ip, platform } }
window.ZTP_STATES = {};

window.ztpInitDevices = function(devices) {
  (devices || []).forEach(function(dev) {
    if (!window.ZTP_STATES[dev.hostname]) {
      window.ZTP_STATES[dev.hostname] = {
        state: 'REGISTERED',
        ts: new Date().toISOString(),
        ip: dev.mgmtIp || ('192.168.1.' + (dev.unit || 1)),
        platform: (dev.vendor || 'Cisco').toLowerCase().includes('arista') ? 'eos'
          : (dev.vendor || '').toLowerCase().includes('juniper') ? 'junos'
          : (dev.vendor || '').toLowerCase().includes('nvidia')  ? 'sonic'
          : 'nxos',
        hostname: dev.hostname
      };
    }
  });
};

window.ztpSetState = function(hostname, newState) {
  if (!window.ZTP_STATES[hostname]) return;
  window.ZTP_STATES[hostname].state = newState;
  window.ZTP_STATES[hostname].ts    = new Date().toISOString();
  var board = document.getElementById('ztp-state-board');
  if (board) board.innerHTML = window.renderZtpStateBoard();
};

window.ztpAdvanceState = function(hostname) {
  var entry = window.ZTP_STATES[hostname];
  if (!entry) return;
  var idx = ZTP_STATE_ORDER.indexOf(entry.state);
  if (idx >= 0 && idx < ZTP_STATE_ORDER.length - 1) {
    window.ztpSetState(hostname, ZTP_STATE_ORDER[idx + 1]);
  }
};

window.ztpMarkFailed = function(hostname) {
  window.ztpSetState(hostname, 'FAILED');
};

window.ztpResetDevice = function(hostname) {
  window.ztpSetState(hostname, 'REGISTERED');
};

window.renderZtpStateBoard = function() {
  var entries = Object.values(window.ZTP_STATES);
  if (!entries.length) {
    return '<p class="empty-state">Complete Step 1 to initialize ZTP state board.</p>';
  }

  var online   = entries.filter(function(e) { return e.state === 'ONLINE' || e.state === 'VERIFIED'; }).length;
  var failed   = entries.filter(function(e) { return e.state === 'FAILED'; }).length;
  var pending  = entries.length - online - failed;

  var summary = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">'
    + _ztpStatCard('Total Devices', entries.length, '#64748b')
    + _ztpStatCard('Online / Verified', online, '#22c55e')
    + _ztpStatCard('In Progress', pending - online, '#f59e0b')
    + _ztpStatCard('Failed', failed, '#ef4444')
    + '</div>';

  var rows = entries.map(function(e) {
    var color = ZTP_STATE_COLORS[e.state] || '#64748b';
    var ts = e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '—';
    var isTerminal = e.state === 'ONLINE' || e.state === 'VERIFIED' || e.state === 'FAILED';
    var advBtn = isTerminal ? ''
      : '<button class="btn" style="padding:3px 10px;font-size:11px;" onclick="window.ztpAdvanceState(\'' + e.hostname + '\')">→ Next</button>';
    var failBtn = (e.state !== 'FAILED' && e.state !== 'ONLINE' && e.state !== 'VERIFIED')
      ? '<button class="btn" style="padding:3px 8px;font-size:11px;color:var(--danger);" onclick="window.ztpMarkFailed(\'' + e.hostname + '\')">✗ Fail</button>'
      : '';
    var resetBtn = '<button class="btn" style="padding:3px 8px;font-size:11px;color:var(--text-dim);" onclick="window.ztpResetDevice(\'' + e.hostname + '\')">↺</button>';
    return '<tr>'
      + '<td><strong>' + e.hostname + '</strong></td>'
      + '<td style="font-family:monospace;font-size:12px;">' + e.ip + '</td>'
      + '<td><span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;background:' + color + '22;color:' + color + ';">' + e.state + '</span></td>'
      + '<td style="font-size:11px;color:var(--text-dim);">' + ts + '</td>'
      + '<td>' + advBtn + ' ' + failBtn + ' ' + resetBtn + '</td>'
      + '</tr>';
  }).join('');

  return summary
    + '<div style="overflow-x:auto;">'
    + '<table class="rollback-table" style="min-width:560px;">'
    + '<thead><tr><th>Hostname</th><th>Mgmt IP</th><th>ZTP State</th><th>Last Updated</th><th>Actions</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>'
    + '<p style="font-size:11px;color:var(--text-dim);margin-top:8px;">State is session-only. In production, states update via POST /api/ztp/callback from each device.</p>';
};

function _ztpStatCard(label, value, color) {
  return '<div style="background:' + color + '18;border:1px solid ' + color + '44;border-radius:8px;padding:10px 16px;min-width:100px;">'
    + '<div style="font-size:20px;font-weight:700;color:' + color + ';">' + value + '</div>'
    + '<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">' + label + '</div>'
    + '</div>';
}

// ─── G-31: Day-0 Bootstrap Config Generator ──────────────────────────────────
// Management-plane only: hostname, mgmt IP, SSH, NTP, syslog, LLDP, callback URL
// NO BGP, NO VLANs, NO VXLAN, NO ACLs — strictly Day-0.

var DAY0_NXOS = function(d, toolIp) {
  return [
    '! ═══ Day-0 Bootstrap — ' + d.hostname + ' (NX-OS) ═══',
    '! Generated by NetDesign AI (G-31) — management plane only',
    '! NO BGP · NO VLANs · NO VXLAN · NO ACLs',
    '!',
    'hostname ' + d.hostname,
    '!',
    'username ndal-admin password 0 ' + d.day0Pass + ' role network-admin',
    '!',
    'feature ssh',
    'no feature telnet',
    'ssh key rsa 2048',
    '!',
    'interface mgmt0',
    '  no shutdown',
    '  ip address ' + d.mgmtIp + '/' + d.mgmtPrefix,
    '!',
    'ip route 0.0.0.0/0 ' + d.mgmtGw + ' mgmt',
    '!',
    'ntp server ' + toolIp + ' use-vrf management',
    'clock timezone UTC 0 0',
    '!',
    'logging server ' + toolIp + ' 6 use-vrf management',
    'logging source-interface mgmt0',
    '!',
    'lldp run',
    '!',
    '! ── ZTP callback (runs after config applies) ────────────────────────────',
    '! curl -X POST http://' + toolIp + ':8080/api/ztp/callback \\',
    '!   -d \'{"hostname":"' + d.hostname + '","status":"CONFIG_APPLYING"}\'',
  ].join('\n');
};

var DAY0_EOS = function(d, toolIp) {
  return [
    '! ═══ Day-0 Bootstrap — ' + d.hostname + ' (EOS) ═══',
    '! Management plane only — NO BGP · NO VLANs · NO VXLAN',
    '!',
    'hostname ' + d.hostname,
    '!',
    'username ndal-admin privilege 15 role network-admin secret sha512 ' + d.day0Pass,
    '!',
    'interface Management1',
    '  no shutdown',
    '  ip address ' + d.mgmtIp + '/' + d.mgmtPrefix,
    '!',
    'ip route 0.0.0.0/0 ' + d.mgmtGw,
    '!',
    'management ssh',
    '  idle-timeout 300',
    '!',
    'management api http-commands',
    '  no protocol http',
    '  protocol https',
    '!',
    'ntp server ' + toolIp,
    '!',
    'logging host ' + toolIp,
    '!',
    'lldp run',
    '!',
    '! ── ZTP callback ────────────────────────────────────────────────────────',
    '! event-handler ZTP-CALLBACK',
    '!   action bash curl -X POST http://' + toolIp + ':8080/api/ztp/callback \\',
    '!     -d \'{"hostname":"' + d.hostname + '","status":"CONFIG_APPLYING"}\'',
  ].join('\n');
};

var DAY0_JUNOS = function(d, toolIp) {
  return [
    '# ═══ Day-0 Bootstrap — ' + d.hostname + ' (JunOS) ═══',
    '# Management plane only — NO BGP · NO VLANs · NO VXLAN',
    '#',
    'set system host-name ' + d.hostname,
    'set system root-authentication plain-text-password-value "' + d.day0Pass + '"',
    'set system login user ndal-admin class super-user',
    'set system login user ndal-admin authentication plain-text-password-value "' + d.day0Pass + '"',
    'set system services ssh root-login deny',
    'set system services ssh protocol-version v2',
    'set system syslog host ' + toolIp + ' any info',
    'set system ntp server ' + toolIp,
    'set interfaces em0 unit 0 family inet address ' + d.mgmtIp + '/' + d.mgmtPrefix,
    'set routing-options static route 0.0.0.0/0 next-hop ' + d.mgmtGw,
    'set protocols lldp interface all',
    'set protocols lldp-med interface all',
    '#',
    '# ZTP callback (add to commit script):',
    '# curl -X POST http://' + toolIp + ':8080/api/ztp/callback \\',
    '#   -d \'{"hostname":"' + d.hostname + '","status":"CONFIG_APPLYING"}\'',
  ].join('\n');
};

var DAY0_SONIC = function(d, toolIp) {
  var cfg = {
    DEVICE_METADATA: { localhost: { hostname: d.hostname, type: 'ToRRouter' } },
    MGMT_INTERFACE: {},
    MGMT_VRF_CONFIG: { vrf_global: { mgmtVrfEnabled: 'true' } },
    NTP_SERVER: {}, SYSLOG_SERVER: {}
  };
  cfg.MGMT_INTERFACE['eth0|' + d.mgmtIp + '/' + d.mgmtPrefix] = { gwaddr: d.mgmtGw };
  cfg.NTP_SERVER[toolIp] = {};
  cfg.SYSLOG_SERVER[toolIp] = {};
  return [
    '# ═══ Day-0 Bootstrap — ' + d.hostname + ' (SONiC) ═══',
    '# Save as /etc/sonic/config_db_day0.json, then:',
    '#   sudo config load /etc/sonic/config_db_day0.json -y',
    '#   sudo config save -y',
    '#',
    JSON.stringify(cfg, null, 2),
    '#',
    '# ZTP callback (add to ZTP script):',
    '# curl -X POST http://' + toolIp + ':8080/api/ztp/callback \\',
    '#   -d \'{"hostname":"' + d.hostname + '","status":"CONFIG_APPLYING"}\'',
  ].join('\n');
};

window.genDay0Config = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';
  var toolIp  = (state && state.toolIp) || '10.0.0.100';
  var mgmtNet = (state && state.mgmtNetwork) || '192.168.100';

  var blocks = devices.map(function(dev, i) {
    var v = (dev.vendor || '').toLowerCase();
    var platform = v.includes('arista') ? 'eos'
      : v.includes('juniper') ? 'junos'
      : (v.includes('nvidia') || v.includes('sonic')) ? 'sonic'
      : 'nxos';

    var d = {
      hostname:   dev.hostname,
      mgmtIp:     dev.mgmtIp || (mgmtNet + '.' + (10 + i)),
      mgmtPrefix: '24',
      mgmtGw:     mgmtNet + '.1',
      day0Pass:   '${NET_PASS:-ChangeMe!}'
    };
    if (platform === 'eos')   return DAY0_EOS(d, toolIp);
    if (platform === 'junos') return DAY0_JUNOS(d, toolIp);
    if (platform === 'sonic') return DAY0_SONIC(d, toolIp);
    return DAY0_NXOS(d, toolIp);
  });

  return [
    '# NetDesign AI — Day-0 Bootstrap Configs (G-31)',
    '# Site: ' + ((state && state.siteCode) || 'SITE') + ' | Generated: ' + new Date().toISOString(),
    '# Tool IP (NTP/Syslog/Callback): ' + toolIp,
    '# IMPORTANT: Replace ${NET_PASS} with actual password before deployment.',
    '# Day-0 = management plane ONLY. Day-N (full config) is in Step 3.',
    '',
  ].join('\n') + blocks.join('\n\n' + '!'.repeat(72) + '\n\n');
};

// ─── G-29: ZTP File Server ────────────────────────────────────────────────────

window.genZtpDockerCompose = function(state) {
  var toolIp = (state && state.toolIp) || '10.0.0.100';
  return [
    '# NetDesign AI — ZTP File Server Stack (G-29)',
    '# Add to docker-compose.local.yml or run standalone:',
    '#   docker compose -f ztp-stack.yml up -d',
    '',
    'services:',
    '',
    '  ztp-nginx:',
    '    image: nginx:alpine',
    '    ports:',
    '      - "8080:80"',
    '    volumes:',
    '      - ./ztp/scripts:/usr/share/nginx/html/ztp/scripts:ro',
    '      - ./ztp/configs:/usr/share/nginx/html/ztp/configs:ro',
    '      - ./ztp/nginx.conf:/etc/nginx/conf.d/default.conf:ro',
    '    restart: unless-stopped',
    '',
    '  ztp-tftp:',
    '    image: pghalliday/tftp:latest',
    '    ports:',
    '      - "69:69/udp"',
    '    volumes:',
    '      - ./ztp/scripts:/var/tftpboot:ro',
    '    restart: unless-stopped',
    '',
    '  ztp-api:',
    '    image: python:3.11-slim',
    '    ports:',
    '      - "8081:8081"',
    '    volumes:',
    '      - ./ztp/api.py:/app/api.py:ro',
    '    working_dir: /app',
    '    command: sh -c "pip install flask -q && python api.py"',
    '    restart: unless-stopped',
    '    environment:',
    '      - TOOL_IP=' + toolIp,
  ].join('\n');
};

window.genZtpNginxConf = function() {
  return [
    '# ztp/nginx.conf',
    'server {',
    '    listen 80;',
    '    server_name _;',
    '    root /usr/share/nginx/html;',
    '    autoindex on;',
    '',
    '    # ZTP script delivery',
    '    location /ztp/scripts/ {',
    '        add_header Content-Type text/plain;',
    '        add_header Cache-Control no-cache;',
    '    }',
    '',
    '    # Day-0 config delivery (served after SCRIPT_DOWNLOADED state)',
    '    location /ztp/configs/ {',
    '        add_header Content-Type text/plain;',
    '        add_header Cache-Control no-cache;',
    '    }',
    '',
    '    # Health check',
    '    location /health {',
    '        return 200 "ok\\n";',
    '        add_header Content-Type text/plain;',
    '    }',
    '}',
  ].join('\n');
};

window.genZtpDhcpScope = function(devices, state) {
  var toolIp  = (state && state.toolIp) || '10.0.0.100';
  var mgmtNet = (state && state.mgmtNetwork) || '192.168.100';
  var lines = [
    '# ── ISC DHCPd — ZTP DHCP Scope (add to /etc/dhcp/dhcpd.conf) ────────────',
    '',
    'option space cisco-auto-install;',
    'option cisco-auto-install.POAP-script code 1 = text;',
    '',
    'subnet ' + mgmtNet + '.0 netmask 255.255.255.0 {',
    '  range ' + mgmtNet + '.10 ' + mgmtNet + '.250;',
    '  option routers ' + mgmtNet + '.1;',
    '  option domain-name-servers 8.8.8.8;',
    '  default-lease-time 600;',
    '  max-lease-time 7200;',
    '',
    '  # NX-OS POAP',
    '  option tftp-server-name "' + toolIp + '";',
    '  filename "poap.py";',
    '',
    '  # EOS ZTP',
    '  option bootfile-name "http://' + toolIp + ':8080/ztp/scripts/eos-ztp.py";',
    '',
    '  # Static bindings per device (MAC → IP)',
  ];
  (devices || []).forEach(function(dev, i) {
    var mac = dev.mgmtMac || ('aa:bb:cc:dd:ee:' + ('0' + (10 + i).toString(16)).slice(-2));
    var ip  = dev.mgmtIp  || (mgmtNet + '.' + (10 + i));
    lines.push('  host ' + dev.hostname + ' { hardware ethernet ' + mac + '; fixed-address ' + ip + '; }');
  });
  lines.push('}');
  return lines.join('\n');
};

window.genZtpApiStubs = function(devices, state) {
  var toolIp = (state && state.toolIp) || '10.0.0.100';
  var devList = JSON.stringify((devices || []).map(function(d) {
    return { hostname: d.hostname, ip: d.mgmtIp || '192.168.1.1', state: 'REGISTERED' };
  }), null, 4);

  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — ZTP State Machine API (G-30)',
    'Site: ' + ((state && state.siteCode) || 'SITE'),
    'Generated: ' + new Date().toISOString(),
    '',
    'Endpoints:',
    '  POST /api/ztp/register   — pre-register device',
    '  POST /api/ztp/callback   — device calls when ZTP step completes',
    '  GET  /api/ztp/state      — get all device provisioning states',
    '  GET  /api/ztp/state/<hostname> — get single device state',
    '',
    'Usage: python ztp/api.py',
    '"""',
    '',
    'import os, json, datetime',
    'from flask import Flask, request, jsonify',
    '',
    'app = Flask(__name__)',
    '',
    'ZTP_STATES = {d["hostname"]: d for d in ' + devList + '}',
    '',
    'VALID_STATES = [',
    '    "REGISTERED", "POWERED_ON", "DHCP_ACK", "SCRIPT_DOWNLOADED",',
    '    "CONFIG_APPLYING", "CALLBACK_RECEIVED", "VERIFIED", "ONLINE", "FAILED"',
    ']',
    '',
    '@app.route("/api/ztp/register", methods=["POST"])',
    'def register():',
    '    data = request.json or {}',
    '    hostname = data.get("hostname")',
    '    if not hostname:',
    '        return jsonify({"error": "hostname required"}), 400',
    '    ZTP_STATES[hostname] = {',
    '        "hostname": hostname,',
    '        "ip": data.get("ip", ""),',
    '        "state": "REGISTERED",',
    '        "ts": datetime.datetime.utcnow().isoformat()',
    '    }',
    '    return jsonify({"ok": True, "state": "REGISTERED"})',
    '',
    '@app.route("/api/ztp/callback", methods=["POST"])',
    'def callback():',
    '    data = request.json or {}',
    '    hostname = data.get("hostname")',
    '    new_state = data.get("status") or data.get("state")',
    '    if hostname not in ZTP_STATES:',
    '        return jsonify({"error": "device not registered"}), 404',
    '    if new_state not in VALID_STATES:',
    '        return jsonify({"error": "invalid state"}), 400',
    '    ZTP_STATES[hostname]["state"] = new_state',
    '    ZTP_STATES[hostname]["ts"]    = datetime.datetime.utcnow().isoformat()',
    '    print(f"[ZTP] {hostname} → {new_state}")',
    '    return jsonify({"ok": True, "hostname": hostname, "state": new_state})',
    '',
    '@app.route("/api/ztp/state", methods=["GET"])',
    'def get_all_states():',
    '    return jsonify(list(ZTP_STATES.values()))',
    '',
    '@app.route("/api/ztp/state/<hostname>", methods=["GET"])',
    'def get_device_state(hostname):',
    '    if hostname not in ZTP_STATES:',
    '        return jsonify({"error": "not found"}), 404',
    '    return jsonify(ZTP_STATES[hostname])',
    '',
    'if __name__ == "__main__":',
    '    port = int(os.getenv("PORT", 8081))',
    '    print(f"ZTP API starting on :{port}")',
    '    app.run(host="0.0.0.0", port=port, debug=False)',
    ''
  ].join('\n');
};
