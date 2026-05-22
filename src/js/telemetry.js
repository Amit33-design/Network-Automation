'use strict';

/* ════════════════════════════════════════════════════════════════
   Streaming Telemetry Collector Config Generator
   Generates collector-side configs so gnmic / Telegraf can subscribe
   to the gNMI device configs emitted by configgen.js.

   Public API (window.*):
     genGNMICCollectorConfig(state)  → string (YAML)
     genTelegrafGNMIConfig(state)    → string (TOML)
     downloadGNMICConfig()           → triggers browser download
     downloadTelegrafGNMIConfig()    → triggers browser download
     renderTelemetryPanel()          → injects panel into #telemetry-panel
════════════════════════════════════════════════════════════════ */

/* ── OpenConfig subscription paths ──────────────────────────── */
var GNMI_SUBS = [
  { name: 'interface-state',    interval: '10s',
    paths: ['/interfaces/interface/state',
            '/interfaces/interface/state/counters'] },
  { name: 'bgp-neighbors',      interval: '30s',
    paths: ['/network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state'] },
  { name: 'platform-cpu',       interval: '30s',
    paths: ['/components/component/cpu/utilization/state'] },
  { name: 'platform-memory',    interval: '30s',
    paths: ['/components/component/memory/state'] },
  { name: 'ospf-neighbors',     interval: '30s',
    paths: ['/network-instances/network-instance/protocols/protocol/ospf/areas/area/interfaces/interface/state'] },
];

/* ── gNMI port per OS ────────────────────────────────────────── */
var GNMI_PORT = {
  'ios-xe': 9339,
  'nxos':   50051,
  'eos':    6030,
  'junos':  32767,
  'sonic':  8080,
};

/* ── Derive flat device list with mgmt IPs ───────────────────── */
function _telemetryDeviceList() {
  var devs = (typeof buildDeviceList === 'function') ? buildDeviceList() : [];
  var out  = [];
  var seen = {};

  devs.forEach(function(dev) {
    var layer = dev.layer || '';
    if (layer.indexOf('mc-') === 0) return;
    var os = (typeof getOS === 'function') ? getOS(layer) : 'ios-xe';
    if (os === 'terraform' || os === 'ansible') return;

    var idx  = dev.idx || 0;
    var key  = layer + '-' + idx;
    if (seen[key]) return;
    seen[key] = true;

    var mgmtIP = _layerMgmtIP(layer, idx);
    var port   = GNMI_PORT[os] || 6030;

    out.push({
      name:     dev.name || ('DEV-' + String(idx + 1).padStart(2, '0')),
      hostname: dev.hostname || dev.name || '',
      mgmtIP:   mgmtIP,
      port:     port,
      os:       os,
      layer:    layer,
    });
  });
  return out;
}

/* ── Layer-aware management IP (matches configgen.js conventions) */
function _layerMgmtIP(layer, idx) {
  if (layer === 'dc-spine' || layer === 'gpu-spine') return '10.0.0.' + (5 + idx);
  if (layer === 'dc-leaf')                           return '10.0.0.' + (11 + idx);
  if (layer === 'gpu-tor')                           return '10.0.0.' + (15 + idx);
  if (layer === 'campus-core')                       return '10.0.0.' + (18 + idx);
  if (layer === 'campus-dist')                       return '10.0.0.' + (20 + idx);
  if (layer === 'campus-access')                     return '10.0.0.' + (30 + idx);
  return '10.0.0.' + (30 + idx);
}

/* ══════════════════════════════════════════════════════════════
   gnmic YAML collector config
   Install: go install github.com/openconfig/gnmic@latest
   Docs:    https://gnmic.openconfig.net
══════════════════════════════════════════════════════════════ */
function genGNMICCollectorConfig(state) {
  var devs     = _telemetryDeviceList();
  var siteName = (STATE && STATE.orgName) ? STATE.orgName.toUpperCase().replace(/\s+/g, '-') : 'SITE';
  var vendor   = (STATE && STATE.vendor)  ? STATE.vendor  : '';
  var date     = new Date().toISOString().slice(0, 10);

  var lines = [];
  lines.push('# NetDesign AI — gnmic Streaming Telemetry Collector Config');
  lines.push('# Site   : ' + siteName);
  lines.push('# Vendor : ' + (vendor || 'multi-vendor'));
  lines.push('# Generated: ' + date);
  lines.push('#');
  lines.push('# Install : go install github.com/openconfig/gnmic@latest');
  lines.push('# Usage   : gnmic subscribe --config gnmic.yml');
  lines.push('# Docs    : https://gnmic.openconfig.net');
  lines.push('');

  /* ── targets ─────────────────────────────────────────────── */
  if (devs.length === 0) {
    lines.push('# No devices found — complete Steps 1-3 first to populate targets.');
    lines.push('targets: {}');
  } else {
    lines.push('targets:');
    devs.forEach(function(d) {
      lines.push('  ' + d.name + ':');
      lines.push('    address: ' + d.mgmtIP + ':' + d.port);
      lines.push('    username: admin');
      lines.push('    password: ${DEVICE_PASSWORD}');
      lines.push('    skip-verify: true');
      lines.push('    timeout: 10s');
      lines.push('    insecure: ' + (d.os === 'ios-xe' ? 'false' : 'true'));
      lines.push('    outputs:');
      lines.push('      - prometheus');
      lines.push('    subscriptions:');
      GNMI_SUBS.forEach(function(sub) {
        lines.push('      - ' + sub.name);
      });
    });
  }
  lines.push('');

  /* ── subscriptions ──────────────────────────────────────── */
  lines.push('subscriptions:');
  GNMI_SUBS.forEach(function(sub) {
    lines.push('  ' + sub.name + ':');
    lines.push('    paths:');
    sub.paths.forEach(function(p) { lines.push('      - "' + p + '"'); });
    lines.push('    mode: stream');
    lines.push('    stream-mode: sample');
    lines.push('    sample-interval: ' + sub.interval);
    lines.push('    encoding: json_ietf');
    lines.push('    heartbeat-interval: 5m');
    lines.push('');
  });

  /* ── outputs ────────────────────────────────────────────── */
  lines.push('outputs:');
  lines.push('  prometheus:');
  lines.push('    type: prometheus');
  lines.push('    listen: :9804');
  lines.push('    path: /metrics');
  lines.push('    expiration: 2m');
  lines.push('    event-processors:');
  lines.push('      - add-labels');
  lines.push('');
  lines.push('  file-debug:');
  lines.push('    type: file');
  lines.push('    format: event');
  lines.push('    file-type: stdout');
  lines.push('');

  /* ── processors ─────────────────────────────────────────── */
  lines.push('processors:');
  lines.push('  add-labels:');
  lines.push('    event-strings:');
  lines.push('      - value-names:');
  lines.push('          - ".*"');
  lines.push('        transforms:');
  lines.push('          - path-base:');
  lines.push('              apply-on: ""');
  lines.push('              keep: false');
  lines.push('');

  /* ── loader (target discovery from file) ─────────────────── */
  lines.push('loader:');
  lines.push('  type: file');
  lines.push('  path: gnmic-targets.yml');
  lines.push('  watch-config: true');
  lines.push('');

  lines.push('# Prometheus scrape config for Grafana (add to prometheus.yml):');
  lines.push('# scrape_configs:');
  lines.push('#   - job_name: gnmic');
  lines.push('#     static_configs:');
  lines.push('#       - targets: ["localhost:9804"]');

  return lines.join('\n');
}

/* ══════════════════════════════════════════════════════════════
   Telegraf gNMI input plugin + Prometheus output
   Install: https://docs.influxdata.com/telegraf/latest/install/
   Usage  : telegraf --config telegraf-gnmi.conf
══════════════════════════════════════════════════════════════ */
function genTelegrafGNMIConfig(state) {
  var devs     = _telemetryDeviceList();
  var siteName = (STATE && STATE.orgName) ? STATE.orgName.toUpperCase().replace(/\s+/g, '-') : 'SITE';
  var date     = new Date().toISOString().slice(0, 10);

  /* Group devices by OS so each Telegraf input block covers one vendor */
  var byOS = {};
  devs.forEach(function(d) {
    if (!byOS[d.os]) byOS[d.os] = [];
    byOS[d.os].push(d);
  });

  var lines = [];
  lines.push('# NetDesign AI — Telegraf gNMI Input Plugin Config');
  lines.push('# Site     : ' + siteName);
  lines.push('# Generated: ' + date);
  lines.push('#');
  lines.push('# Install : https://docs.influxdata.com/telegraf/latest/install/');
  lines.push('# Usage   : telegraf --config telegraf-gnmi.conf');
  lines.push('');

  /* ── global agent ─────────────────────────────────────────── */
  lines.push('[agent]');
  lines.push('  interval      = "10s"');
  lines.push('  flush_interval = "10s"');
  lines.push('  omit_hostname  = false');
  lines.push('');

  /* ── Prometheus output ───────────────────────────────────── */
  lines.push('[[outputs.prometheus_client]]');
  lines.push('  listen         = ":9804"');
  lines.push('  metric_version = 2');
  lines.push('  expiration_interval = "2m"');
  lines.push('');

  /* ── per-OS gNMI input blocks ────────────────────────────── */
  if (devs.length === 0) {
    lines.push('# No devices found — complete Steps 1-3 first to populate targets.');
    lines.push('# [[inputs.gnmi]]');
    lines.push('#   addresses = ["10.0.0.11:6030"]');
  } else {
    Object.keys(byOS).forEach(function(os) {
      var group    = byOS[os];
      var addrs    = group.map(function(d) { return '"' + d.mgmtIP + ':' + d.port + '"'; });
      var osLabel  = { 'ios-xe':'IOS-XE', 'nxos':'NX-OS', 'eos':'EOS', 'junos':'JunOS', 'sonic':'SONiC' }[os] || os.toUpperCase();
      var tlsLine  = (os === 'ios-xe') ? '  tls_server_name = "device.local"\n  insecure_skip_verify = false' : '  insecure_skip_verify = true';

      lines.push('# ── ' + osLabel + ' devices ──────────────────────────────────────────');
      lines.push('[[inputs.gnmi]]');
      lines.push('  addresses = [' + addrs.join(', ') + ']');
      lines.push('  username  = "admin"');
      lines.push('  password  = "${DEVICE_PASSWORD}"');
      lines.push('  redial    = "10s"');
      lines.push(tlsLine);
      lines.push('');

      /* interface counters */
      lines.push('  [[inputs.gnmi.subscription]]');
      lines.push('    name              = "interface"');
      lines.push('    origin            = "openconfig"');
      lines.push('    path              = "/interfaces/interface/state/counters"');
      lines.push('    subscription_mode = "sample"');
      lines.push('    sample_interval   = "10s"');
      lines.push('');

      /* interface oper-state */
      lines.push('  [[inputs.gnmi.subscription]]');
      lines.push('    name              = "interface_state"');
      lines.push('    origin            = "openconfig"');
      lines.push('    path              = "/interfaces/interface/state"');
      lines.push('    subscription_mode = "sample"');
      lines.push('    sample_interval   = "10s"');
      lines.push('');

      /* BGP neighbor state */
      lines.push('  [[inputs.gnmi.subscription]]');
      lines.push('    name              = "bgp"');
      lines.push('    origin            = "openconfig"');
      lines.push('    path              = "/network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state"');
      lines.push('    subscription_mode = "sample"');
      lines.push('    sample_interval   = "30s"');
      lines.push('');

      /* CPU */
      lines.push('  [[inputs.gnmi.subscription]]');
      lines.push('    name              = "cpu"');
      lines.push('    origin            = "openconfig"');
      lines.push('    path              = "/components/component/cpu/utilization/state"');
      lines.push('    subscription_mode = "sample"');
      lines.push('    sample_interval   = "30s"');
      lines.push('');

      /* memory */
      lines.push('  [[inputs.gnmi.subscription]]');
      lines.push('    name              = "memory"');
      lines.push('    origin            = "openconfig"');
      lines.push('    path              = "/components/component/memory/state"');
      lines.push('    subscription_mode = "sample"');
      lines.push('    sample_interval   = "30s"');
      lines.push('');
    });
  }

  lines.push('# Prometheus scrape config for Grafana (add to prometheus.yml):');
  lines.push('# scrape_configs:');
  lines.push('#   - job_name: telegraf-gnmi');
  lines.push('#     static_configs:');
  lines.push('#       - targets: ["localhost:9804"]');

  return lines.join('\n');
}

/* ── Download helpers ────────────────────────────────────────── */
function downloadGNMICConfig() {
  var text = genGNMICCollectorConfig(STATE);
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'gnmic.yml';
  a.click();
  if (typeof toast === 'function') toast('gnmic.yml downloaded', 'success');
}

function downloadTelegrafGNMIConfig() {
  var text = genTelegrafGNMIConfig(STATE);
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'telegraf-gnmi.conf';
  a.click();
  if (typeof toast === 'function') toast('telegraf-gnmi.conf downloaded', 'success');
}

/* ══════════════════════════════════════════════════════════════
   Render Panel
══════════════════════════════════════════════════════════════ */
function renderTelemetryPanel() {
  var el = document.getElementById('telemetry-panel');
  if (!el) return;

  var devs     = _telemetryDeviceList();
  var devCount = devs.length;
  var vendor   = (STATE && STATE.vendor) ? STATE.vendor : '';

  var portInfo = devs.length > 0
    ? devs.map(function(d) { return d.name + ':' + d.port; }).slice(0, 4).join(', ')
          + (devs.length > 4 ? ' + ' + (devs.length - 4) + ' more' : '')
    : 'No devices — run Steps 1–3 first';

  el.innerHTML =
    '<div class="telemetry-panel-inner">' +
      '<div class="telemetry-panel-header">' +
        '<div class="telemetry-panel-icon">📡</div>' +
        '<div>' +
          '<div style="font-weight:700;font-size:.92rem;color:var(--txt0)">Streaming Telemetry — gNMI Collector Configs</div>' +
          '<div class="telemetry-panel-sub">' +
            devCount + ' device' + (devCount !== 1 ? 's' : '') + ' in BOM &nbsp;·&nbsp; ' + portInfo +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="telemetry-panel-body">' +

        /* gnmic card */
        '<div class="telemetry-card">' +
          '<div class="telemetry-card-title">🔭 gnmic YAML</div>' +
          '<div class="telemetry-card-desc">' +
            'OpenConfig gNMI collector config for <strong>gnmic</strong> — the most popular ' +
            'open-source gNMI CLI/daemon. Includes targets (per-device address + port), ' +
            'OpenConfig subscription paths, Prometheus output on :9804, and hot-reload support.' +
          '</div>' +
          '<button class="btn btn-ghost telemetry-dl-btn" onclick="downloadGNMICConfig()">⬇ Download gnmic.yml</button>' +
        '</div>' +

        /* Telegraf card */
        '<div class="telemetry-card">' +
          '<div class="telemetry-card-title">📊 Telegraf gNMI Config</div>' +
          '<div class="telemetry-card-desc">' +
            'InfluxData <strong>Telegraf</strong> gNMI input plugin config, grouped by vendor OS ' +
            '(separate [[inputs.gnmi]] block per NOS). Outputs metrics to Prometheus on :9804 ' +
            'for Grafana dashboards.' +
          '</div>' +
          '<button class="btn btn-ghost telemetry-dl-btn" onclick="downloadTelegrafGNMIConfig()">⬇ Download telegraf-gnmi.conf</button>' +
        '</div>' +

      '</div>' +

      '<div class="telemetry-panel-usage">' +
        '<strong>Quick start (gnmic):</strong><br>' +
        '<code>export DEVICE_PASSWORD=&lt;your-password&gt;</code><br>' +
        '<code>gnmic subscribe --config gnmic.yml</code><br>' +
        '<br>' +
        '<strong>Quick start (Telegraf):</strong><br>' +
        '<code>export DEVICE_PASSWORD=&lt;your-password&gt;</code><br>' +
        '<code>telegraf --config telegraf-gnmi.conf --test</code><br>' +
        '<br>' +
        '<strong>Device-side gNMI config</strong> is auto-included in each device config ' +
        '(Step 5 → Config Generator). Collector connects to the gNMI port on the management ' +
        'interface of each device.' +
      '</div>' +
    '</div>';
}

/* ── Expose public API ────────────────────────────────────────── */
window.genGNMICCollectorConfig  = genGNMICCollectorConfig;
window.genTelegrafGNMIConfig    = genTelegrafGNMIConfig;
window.downloadGNMICConfig      = downloadGNMICConfig;
window.downloadTelegrafGNMIConfig = downloadTelegrafGNMIConfig;
window.renderTelemetryPanel     = renderTelemetryPanel;
