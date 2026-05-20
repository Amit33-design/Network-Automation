'use strict';

/* ════════════════════════════════════════════════════════════════
   OBSERVABILITY — deployment event log, timeline, and metrics
════════════════════════════════════════════════════════════════ */

const OBS = {
  events:      [],      // { ts, timeStr, level, msg, stage }
  stageData:   {},      // stageName → { start, end, duration, status }
  deployId:    null,
};

const _stageMeta = {
  precheck:  { label:'🔍 Pre-Checks',    order:0 },
  backup:    { label:'💾 Backup',         order:1 },
  deploy:    { label:'📡 Push Configs',   order:2 },
  verify:    { label:'🔁 Commit Guard',   order:3 },
  postcheck: { label:'✅ Post-Checks',    order:4 },
};

/* ── Logging API ────────────────────────────────────────────── */

function obsLog(msg, level = 'info', stage = null) {
  OBS.events.push({
    ts:      Date.now(),
    timeStr: new Date().toTimeString().slice(0, 12),
    level, msg, stage,
  });
  _flushEventLog();
}

function obsStageStart(stage) {
  OBS.stageData[stage] = { start: Date.now(), end: null, duration: null, status: 'running' };
  obsLog(`Stage started: ${stage}`, 'info', stage);
  _renderTimeline();
  _renderMetrics();
}

function obsStageEnd(stage, status = 'success') {
  const s = OBS.stageData[stage];
  if (s) {
    s.end      = Date.now();
    s.duration = s.end - s.start;
    s.status   = status;
  }
  obsLog(
    `Stage "${stage}" ${status === 'success' ? 'completed ✓' : 'FAILED ✗'} — ${s?.duration || 0}ms`,
    status === 'success' ? 'success' : 'error',
    stage
  );
  _renderTimeline();
  _renderMetrics();
}

/* ── Event Log ─────────────────────────────────────────────── */

function _flushEventLog() {
  const el = document.getElementById('obs-event-log');
  if (!el) return;

  const icons  = { info:'ℹ', success:'✓', warn:'⚠', error:'✗' };
  const colors = { info:'var(--txt2)', success:'var(--green)', warn:'var(--orange)', error:'#ff5555' };

  const recent = OBS.events.slice(-80);
  el.innerHTML = recent.map(e => `
    <div class="obs-ev obs-ev-${e.level}">
      <span class="obs-time">${e.timeStr}</span>
      <span class="obs-icon" style="color:${colors[e.level]}">${icons[e.level] || 'ℹ'}</span>
      <span class="obs-msg"  style="color:${colors[e.level]}">${e.msg}</span>
      ${e.stage ? `<span class="obs-stag">${e.stage}</span>` : ''}
    </div>`).join('');

  el.scrollTop = el.scrollHeight;
}

/* ── Deployment Timeline ────────────────────────────────────── */

function _renderTimeline() {
  const el = document.getElementById('obs-timeline');
  if (!el) return;

  const entries = Object.entries(OBS.stageData)
    .filter(([, s]) => s.start)
    .sort(([a], [b]) => (_stageMeta[a]?.order ?? 9) - (_stageMeta[b]?.order ?? 9));

  if (entries.length === 0) {
    el.innerHTML = '<div class="obs-placeholder">Pipeline timeline will appear here once the deployment runs.</div>';
    return;
  }

  const earliest = Math.min(...entries.map(([, s]) => s.start));
  const latest   = Math.max(...entries.map(([, s]) => s.end || Date.now()));
  const window   = latest - earliest || 1;

  const barColors = { success:'var(--green)', failed:'#ff5555', running:'var(--blue)' };

  let html = '<div class="tl-bars">';
  entries.forEach(([stage, s]) => {
    const left  = ((s.start - earliest) / window * 100).toFixed(1);
    const width = Math.max(2, ((s.end || Date.now()) - s.start) / window * 100).toFixed(1);
    const dur   = s.duration ? (s.duration < 1000 ? s.duration + 'ms' : (s.duration/1000).toFixed(1) + 's') : 'running…';
    const color = barColors[s.status] || barColors.running;
    const label = _stageMeta[stage]?.label || stage;
    html += `
      <div class="tl-row">
        <div class="tl-lbl">${label}</div>
        <div class="tl-track">
          <div class="tl-bar" style="left:${left}%;width:${width}%;background:${color}" title="${stage}: ${dur}">
            <span class="tl-dur">${dur}</span>
          </div>
        </div>
        <div class="tl-status tl-st-${s.status}">${s.status}</div>
      </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

/* ── Metrics Panel ─────────────────────────────────────────── */

function _renderMetrics() {
  const el = document.getElementById('obs-metrics');
  if (!el) return;

  const devs      = buildDeviceList();
  const totalDur  = Object.values(OBS.stageData).reduce((s, t) => s + (t.duration || 0), 0);
  const nChecks   = (window._obsPreCheckCount || 0) + (window._obsPostCheckCount || 0);
  const nEvents   = OBS.events.length;
  const nFailed   = OBS.events.filter(e => e.level === 'error').length;

  const fmt = ms => ms < 1000 ? ms + 'ms' : (ms/1000).toFixed(1) + 's';

  const metrics = [
    { val: devs.length,           label: 'Devices',       color: 'var(--blue)'   },
    { val: nChecks,               label: 'Checks Run',    color: 'var(--cyan)'   },
    { val: nEvents,               label: 'Log Events',    color: 'var(--txt1)'   },
    { val: nFailed || '—',        label: 'Errors',        color: nFailed ? '#ff5555' : 'var(--green)' },
    { val: totalDur ? fmt(totalDur) : '—', label: 'Total Time', color: 'var(--orange)' },
  ];

  el.innerHTML = `<div class="obs-metric-grid">` +
    metrics.map(m => `
      <div class="obs-metric">
        <div class="om-val" style="color:${m.color}">${m.val}</div>
        <div class="om-lbl">${m.label}</div>
      </div>`).join('') +
    `</div>`;
}

/* ── Reset ──────────────────────────────────────────────────── */
function resetObservability() {
  OBS.events    = [];
  OBS.stageData = {};
  OBS.deployId  = null;
  window._obsPreCheckCount  = 0;
  window._obsPostCheckCount = 0;
  _flushEventLog();
  _renderTimeline();
  _renderMetrics();
  // Phase 4: clear alert + RCA panels
  ALERTS.active = [];
  _renderAlerts();
  const rcaEl = document.getElementById('obs-rca-results');
  if (rcaEl) rcaEl.innerHTML = '';
}

/* ════════════════════════════════════════════════════════════════
   PHASE 4 — Live Alert Polling
════════════════════════════════════════════════════════════════ */

const ALERTS = {
  active:       [],
  pollHandle:   null,
  pollInterval: 30_000,
};

const _SEV_COLORS = {
  CRITICAL: '#ff5555',
  WARN:     'var(--orange)',
  INFO:     'var(--blue)',
};

async function _fetchAlerts() {
  try {
    const base  = (typeof BackendClient !== 'undefined' && BackendClient.isLiveMode())
                    ? BackendClient.getBackendUrl().replace(/\/$/, '')
                    : '';
    if (!base) return;
    const tok  = (typeof BackendClient !== 'undefined') ? BackendClient.getToken() : '';
    const resp = await fetch(base + '/api/alerts', {
      headers: tok ? { 'Authorization': `Bearer ${tok}` } : {},
    });
    if (!resp.ok) return;
    ALERTS.active = await resp.json();
    _renderAlerts();
  } catch (_) {}
}

function _renderAlerts() {
  const el = document.getElementById('obs-alerts');
  if (!el) return;
  if (!ALERTS.active.length) {
    el.innerHTML = '<div class="obs-placeholder">No active alerts.</div>';
    return;
  }
  el.innerHTML = ALERTS.active.map(a => {
    const color = _SEV_COLORS[a.severity] || 'var(--txt2)';
    return `<div class="obs-alert-card" style="border-left:3px solid ${color};padding:.5rem .75rem;margin:.35rem 0;background:var(--bg3);border-radius:0 6px 6px 0">
      <span style="color:${color};font-weight:600;font-size:.78rem;margin-right:.5rem">${a.severity}</span>
      <span style="color:var(--txt2);font-size:.78rem;margin-right:.5rem">${a.hostname}</span>
      <span style="color:var(--txt1);font-size:.8rem">${a.message}</span>
    </div>`;
  }).join('');
}

function startAlertPolling() {
  stopAlertPolling();
  _fetchAlerts();
  ALERTS.pollHandle = setInterval(_fetchAlerts, ALERTS.pollInterval);
}

function stopAlertPolling() {
  if (ALERTS.pollHandle) { clearInterval(ALERTS.pollHandle); ALERTS.pollHandle = null; }
}

/* ════════════════════════════════════════════════════════════════
   PHASE 4 — Root Cause Analysis
════════════════════════════════════════════════════════════════ */

async function runRCAAnalysis({ symptom = '', affectedDevices = [], designId = null } = {}) {
  const el = document.getElementById('obs-rca-results');
  if (el) el.innerHTML = '<div class="obs-placeholder">Analyzing…</div>';

  try {
    const base = (typeof BackendClient !== 'undefined' && BackendClient.isLiveMode())
                   ? BackendClient.getBackendUrl().replace(/\/$/, '')
                   : '';
    if (!base) {
      if (el) el.innerHTML = '<div class="obs-placeholder">Backend not configured — enable Live Mode in settings.</div>';
      return;
    }
    const tok  = (typeof BackendClient !== 'undefined') ? BackendClient.getToken() : '';
    const resp = await fetch(base + '/api/rca/analyze', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { 'Authorization': `Bearer ${tok}` } : {}),
      },
      body: JSON.stringify({
        symptom,
        affected_devices: affectedDevices,
        design_id:        designId,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (el) el.innerHTML = `<div class="obs-placeholder" style="color:#ff5555">RCA failed: ${err.detail || resp.status}</div>`;
      return;
    }

    const hypotheses = await resp.json();
    _renderRCAResults(hypotheses);
  } catch (e) {
    if (el) el.innerHTML = `<div class="obs-placeholder" style="color:#ff5555">RCA request failed: ${e.message}</div>`;
  }
}

function _renderRCAResults(hypotheses) {
  const el = document.getElementById('obs-rca-results');
  if (!el) return;
  if (!hypotheses.length) {
    el.innerHTML = '<div class="obs-placeholder">No RCA hypotheses matched the symptom.</div>';
    return;
  }
  el.innerHTML = hypotheses.map((h, i) => `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;margin:.5rem 0;${i === 0 ? 'border-color:var(--blue)' : ''}">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem">
        <span style="background:var(--bg2);color:var(--txt3);font-size:.7rem;padding:.1rem .4rem;border-radius:4px">#${i+1}</span>
        <span style="font-weight:600;color:var(--txt1)">${h.root_cause}</span>
        <span style="margin-left:auto;color:${h.confidence >= 0.6 ? '#ff5555' : h.confidence >= 0.35 ? 'var(--orange)' : 'var(--txt2)'};font-size:.82rem;font-weight:600">${Math.round(h.confidence * 100)}% confidence</span>
      </div>
      ${h.evidence.length ? `<ul style="margin:.25rem 0 .5rem 1rem;color:var(--txt2);font-size:.8rem">${h.evidence.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
      ${h.blast_radius.length ? `<div style="font-size:.76rem;color:var(--txt3);margin-bottom:.4rem">Blast radius: ${h.blast_radius.join(', ')}</div>` : ''}
      <ol style="margin:.25rem 0 0 1rem;color:var(--txt1);font-size:.8rem">${h.remediation_steps.map(s => `<li>${s}</li>`).join('')}</ol>
      ${h.automation_available ? `<div style="margin-top:.5rem;font-size:.75rem;color:var(--cyan)">▶ Automation: <code style="background:var(--bg2);padding:.1rem .35rem;border-radius:3px">${h.automation_playbook}</code></div>` : ''}
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════════
   PROMETHEUS ALERT RULES GENERATOR (#16)
   Generates alert.rules.yml for device-specific alerts
════════════════════════════════════════════════════════════════ */

function genPrometheusAlerts(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var today = new Date().toISOString().slice(0, 10);

  /* Build device list from BOM */
  var devices = [];
  try {
    if (typeof buildDeviceList === 'function') {
      devices = buildDeviceList();
    }
  } catch(e) {}

  var rules = [];

  /* Per-device BGP + interface alerts */
  devices.forEach(function(dev) {
    var hostname = dev.name || dev.id || 'unknown';
    var instance = hostname.toLowerCase();

    rules.push(
      '  # --- ' + hostname + ' ---',
      '  - alert: BGPSessionDown_' + hostname.replace(/-/g, '_'),
      '    expr: bgp_session_up{instance="' + instance + '"} == 0',
      '    for: 2m',
      '    labels:',
      '      severity: critical',
      '      device: "' + hostname + '"',
      '      layer: "' + (dev.layer || 'unknown') + '"',
      '    annotations:',
      '      summary: "BGP session down on {{ $labels.device }}"',
      '      description: "BGP neighbor {{ $labels.neighbor }} is down on ' + hostname + '."',
      '',
      '  - alert: InterfaceDown_' + hostname.replace(/-/g, '_'),
      '    expr: ifOperStatus{instance="' + instance + '"} == 2',
      '    for: 1m',
      '    labels:',
      '      severity: warning',
      '      device: "' + hostname + '"',
      '    annotations:',
      '      summary: "Interface down on {{ $labels.device }}"',
      '      description: "Interface {{ $labels.ifDescr }} is operationally down."',
      '',
      '  - alert: HighCPU_' + hostname.replace(/-/g, '_'),
      '    expr: cpu_utilization_percent{instance="' + instance + '"} > 80',
      '    for: 5m',
      '    labels:',
      '      severity: warning',
      '      device: "' + hostname + '"',
      '    annotations:',
      '      summary: "High CPU on {{ $labels.device }}"',
      '      description: "CPU utilization is {{ $value }}% on ' + hostname + '."',
      '',
      '  - alert: HighMemory_' + hostname.replace(/-/g, '_'),
      '    expr: memory_utilization_percent{instance="' + instance + '"} > 85',
      '    for: 5m',
      '    labels:',
      '      severity: warning',
      '      device: "' + hostname + '"',
      '    annotations:',
      '      summary: "High memory on {{ $labels.device }}"',
      '      description: "Memory utilization is {{ $value }}% on ' + hostname + '."',
      '',
      '  - alert: InterfaceErrorRate_' + hostname.replace(/-/g, '_'),
      '    expr: rate(ifInErrors{instance="' + instance + '"}[5m]) + rate(ifOutErrors{instance="' + instance + '"}[5m]) > 10',
      '    for: 3m',
      '    labels:',
      '      severity: warning',
      '      device: "' + hostname + '"',
      '    annotations:',
      '      summary: "High interface error rate on {{ $labels.device }}"',
      '      description: "Interface {{ $labels.ifDescr }} error rate exceeds 10 errors/sec."',
      ''
    );
  });

  /* Global network health alerts */
  rules = rules.concat([
    '  # --- Global network health ---',
    '  - alert: LinkUtilizationHigh',
    '    expr: ifHCInOctets_rate * 8 / ifSpeed > 0.90',
    '    for: 5m',
    '    labels:',
    '      severity: warning',
    '    annotations:',
    '      summary: "Link utilization >90% on {{ $labels.device }} {{ $labels.ifDescr }}"',
    '      description: "Interface utilization has been above 90% for 5 minutes."',
    '',
    '  - alert: SNMPTargetUnreachable',
    '    expr: up{job="network_devices"} == 0',
    '    for: 2m',
    '    labels:',
    '      severity: critical',
    '    annotations:',
    '      summary: "Network device unreachable: {{ $labels.instance }}"',
    '      description: "SNMP exporter cannot reach {{ $labels.instance }}."',
    '',
  ]);

  var yaml = [
    '# ═══════════════════════════════════════════════════════════',
    '# Prometheus Alert Rules — NetDesign AI',
    '# Generated: ' + today,
    '# Org: ' + (s.orgName || 'N/A'),
    '# Devices: ' + devices.length,
    '#',
    '# Apply:',
    '#   1. Copy to /etc/prometheus/rules/netdesign.rules.yml',
    '#   2. Add to prometheus.yml:',
    '#        rule_files:',
    '#          - "rules/netdesign.rules.yml"',
    '#   3. Reload: curl -X POST http://localhost:9090/-/reload',
    '# ═══════════════════════════════════════════════════════════',
    '',
    'groups:',
    '  - name: netdesign_network_alerts',
    '    interval: 30s',
    '    rules:',
  ].concat(rules.map(function(l) { return l ? '    ' + l : ''; }));

  return yaml.join('\n');
}

function downloadPrometheusAlerts() {
  var content = genPrometheusAlerts(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'text/yaml' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netdesign-alert.rules.yml';
  a.click();
  if (typeof toast === 'function') toast('Prometheus alert rules downloaded', 'success');
}

/* ════════════════════════════════════════════════════════════════
   GRAFANA DASHBOARD JSON GENERATOR (#17)
   Generates importable Grafana dashboard per BOM layer
════════════════════════════════════════════════════════════════ */

function genGrafanaDashboard(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var layers = typeof getLayersForUC === 'function' ? getLayersForUC() : [];
  var devices = [];
  try {
    if (typeof buildDeviceList === 'function') devices = buildDeviceList();
  } catch(e) {}

  var uid = 'netdesign-' + Date.now().toString(36);
  var panels = [];
  var panelId = 1;
  var y = 0;

  /* One row per BOM layer */
  layers.forEach(function(layer) {
    var layerDevices = devices.filter(function(d) { return d.layer === layer.key; });

    /* Row header */
    panels.push({
      type: 'row',
      id: panelId++,
      title: layer.label,
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: y++ },
    });

    var targets = layerDevices.length ? layerDevices : [{ name: layer.key }];

    targets.forEach(function(dev) {
      var instance = (dev.name || dev.id || layer.key).toLowerCase();

      /* Interface utilization */
      panels.push({
        type: 'timeseries',
        id: panelId++,
        title: (dev.name || layer.label) + ' — Interface Utilization',
        gridPos: { h: 6, w: 8, x: 0, y: y },
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [{
          expr: 'rate(ifHCInOctets{instance="' + instance + '"}[5m]) * 8',
          legendFormat: '{{ifDescr}} In',
        }, {
          expr: 'rate(ifHCOutOctets{instance="' + instance + '"}[5m]) * 8',
          legendFormat: '{{ifDescr}} Out',
        }],
        fieldConfig: { defaults: { unit: 'bps' } },
      });

      /* CPU + Memory */
      panels.push({
        type: 'gauge',
        id: panelId++,
        title: (dev.name || layer.label) + ' — CPU %',
        gridPos: { h: 6, w: 4, x: 8, y: y },
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [{
          expr: 'cpu_utilization_percent{instance="' + instance + '"}',
          legendFormat: 'CPU',
        }],
        fieldConfig: {
          defaults: {
            unit: 'percent',
            thresholds: { steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 60 },
              { color: 'red', value: 80 },
            ]},
          },
        },
      });

      /* BGP sessions */
      panels.push({
        type: 'stat',
        id: panelId++,
        title: (dev.name || layer.label) + ' — BGP Sessions Up',
        gridPos: { h: 6, w: 4, x: 12, y: y },
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [{
          expr: 'count(bgp_session_up{instance="' + instance + '"} == 1)',
          legendFormat: 'Up',
        }],
        fieldConfig: { defaults: { unit: 'short', color: { mode: 'thresholds' } } },
      });

      /* Interface errors */
      panels.push({
        type: 'timeseries',
        id: panelId++,
        title: (dev.name || layer.label) + ' — Interface Errors',
        gridPos: { h: 6, w: 8, x: 16, y: y },
        datasource: { type: 'prometheus', uid: 'prometheus' },
        targets: [{
          expr: 'rate(ifInErrors{instance="' + instance + '"}[5m])',
          legendFormat: '{{ifDescr}} In Errors',
        }, {
          expr: 'rate(ifOutErrors{instance="' + instance + '"}[5m])',
          legendFormat: '{{ifDescr}} Out Errors',
        }],
        fieldConfig: { defaults: { unit: 'pps' } },
      });

      y += 6;
    });
  });

  var dashboard = {
    uid:   uid,
    title: 'NetDesign AI — ' + (s.orgName || 'Network') + ' Topology',
    tags:  ['netdesign', 'network', 'auto-generated'],
    timezone: 'browser',
    schemaVersion: 38,
    version: 1,
    refresh: '30s',
    time: { from: 'now-1h', to: 'now' },
    panels: panels,
    templating: { list: [] },
    annotations: { list: [] },
  };

  return JSON.stringify({ dashboard: dashboard, overwrite: true, folderId: 0 }, null, 2);
}

function downloadGrafanaDashboard() {
  var content = genGrafanaDashboard(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netdesign-grafana-dashboard.json';
  a.click();
  if (typeof toast === 'function') toast('Grafana dashboard downloaded', 'success');
}

window.genPrometheusAlerts      = genPrometheusAlerts;
window.downloadPrometheusAlerts = downloadPrometheusAlerts;
window.genGrafanaDashboard      = genGrafanaDashboard;
window.downloadGrafanaDashboard = downloadGrafanaDashboard;

/* ════════════════════════════════════════════════════════════════
   NETBOX SYNC SCRIPT GENERATOR (#20)
   Generates Python script to sync topology to NetBox via pynetbox.
   Also: SNMP MIB mapping, Syslog parsing rules, NetFlow config.
════════════════════════════════════════════════════════════════ */

function genNetBoxSyncScript(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var today = new Date().toISOString().slice(0,10);
  var devices = [];
  try { if (typeof buildDeviceList === 'function') devices = buildDeviceList(); } catch(e) {}

  var deviceEntries = devices.map(function(dev) {
    return '    {"name": "' + dev.name + '", "role": "' + (dev.layer || 'unknown') + '", ' +
      '"platform": "' + (dev.platform || 'ios-xe') + '", "ip": "TBD"}';
  }).join(',\n') || '    # No devices found — run through Steps 1-3 first';

  return '#!/usr/bin/env python3\n' +
'"""\n' +
'NetDesign AI — NetBox Sync Script (#20)\n' +
'Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A') + '\n' +
'\n' +
'Syncs BOM + topology from NetDesign AI to NetBox.\n' +
'\n' +
'Requirements:\n' +
'    pip install pynetbox\n' +
'\n' +
'Usage:\n' +
'    1. Set NETBOX_URL and NETBOX_TOKEN below.\n' +
'    2. Run: python3 netbox_sync.py\n' +
'    3. Devices, interfaces, and IPs will be created/updated in NetBox.\n' +
'"""\n' +
'\n' +
'import sys\n' +
'\n' +
'try:\n' +
'    import pynetbox\n' +
'except ImportError:\n' +
'    print("ERROR: Run:  pip install pynetbox")\n' +
'    sys.exit(1)\n' +
'\n' +
'# ── Configuration ───────────────────────────────────────────────\n' +
'NETBOX_URL   = "http://netbox.example.com"  # TODO: replace\n' +
'NETBOX_TOKEN = "your-token-here"             # TODO: replace\n' +
'SITE_NAME    = "' + (s.orgName || 'NetDesign Site') + '"\n' +
'DRY_RUN      = True   # Set False to actually create/update records\n' +
'# ────────────────────────────────────────────────────────────────\n' +
'\n' +
'nb = pynetbox.api(NETBOX_URL, token=NETBOX_TOKEN)\n' +
'\n' +
'DEVICES = [\n' +
deviceEntries + '\n' +
']\n' +
'\n' +
'ROLE_MAP = {\n' +
'    "campus-access": "access-switch",\n' +
'    "campus-dist":   "distribution-switch",\n' +
'    "campus-core":   "core-switch",\n' +
'    "dc-spine":      "spine",\n' +
'    "dc-leaf":       "leaf",\n' +
'    "gpu-spine":     "gpu-spine",\n' +
'    "gpu-tor":       "gpu-tor",\n' +
'    "fw":            "firewall",\n' +
'    "mc-dc-edge":    "dc-edge-router",\n' +
'}\n' +
'\n' +
'PLATFORM_MAP = {\n' +
'    "ios-xe": "cisco-ios-xe",\n' +
'    "nxos":   "cisco-nxos",\n' +
'    "eos":    "arista-eos",\n' +
'    "junos":  "juniper-junos",\n' +
'    "sonic":  "sonic",\n' +
'}\n' +
'\n' +
'\n' +
'def get_or_create(endpoint, lookup: dict, create_data: dict):\n' +
'    """Get existing object or create it. Respects DRY_RUN."""\n' +
'    existing = endpoint.filter(**lookup)\n' +
'    if existing:\n' +
'        obj = list(existing)[0]\n' +
'        print(f"  EXISTS: {obj}")\n' +
'        return obj\n' +
'    if DRY_RUN:\n' +
'        print(f"  DRY-RUN would create: {create_data}")\n' +
'        return None\n' +
'    obj = endpoint.create(**create_data)\n' +
'    print(f"  CREATED: {obj}")\n' +
'    return obj\n' +
'\n' +
'\n' +
'def sync_site():\n' +
'    print(f"Syncing site: {SITE_NAME}")\n' +
'    return get_or_create(\n' +
'        nb.dcim.sites,\n' +
'        {"name": SITE_NAME},\n' +
'        {"name": SITE_NAME, "slug": SITE_NAME.lower().replace(" ", "-"), "status": "active"},\n' +
'    )\n' +
'\n' +
'\n' +
'def sync_device(device_data, site):\n' +
'    name = device_data["name"]\n' +
'    role_slug = ROLE_MAP.get(device_data["role"], "network-device")\n' +
'    platform_slug = PLATFORM_MAP.get(device_data["platform"], device_data["platform"])\n' +
'\n' +
'    # Ensure device role exists\n' +
'    role = get_or_create(\n' +
'        nb.dcim.device_roles,\n' +
'        {"slug": role_slug},\n' +
'        {"name": role_slug.replace("-", " ").title(), "slug": role_slug, "color": "0066cc"},\n' +
'    )\n' +
'\n' +
'    # Ensure device type exists (generic placeholder)\n' +
'    dtype = get_or_create(\n' +
'        nb.dcim.device_types,\n' +
'        {"slug": platform_slug + "-generic"},\n' +
'        {"manufacturer": {"name": "Generic", "slug": "generic"},\n' +
'         "model": platform_slug + "-generic",\n' +
'         "slug": platform_slug + "-generic"},\n' +
'    )\n' +
'\n' +
'    # Create/update device\n' +
'    dev = get_or_create(\n' +
'        nb.dcim.devices,\n' +
'        {"name": name},\n' +
'        {"name": name,\n' +
'         "device_type": dtype.id if dtype else 1,\n' +
'         "device_role": role.id if role else 1,\n' +
'         "site": site.id if site else 1,\n' +
'         "status": "planned"},\n' +
'    )\n' +
'\n' +
'    # Add management IP if specified\n' +
'    mgmt_ip = device_data.get("ip")\n' +
'    if mgmt_ip and mgmt_ip != "TBD" and dev and not DRY_RUN:\n' +
'        ip = get_or_create(\n' +
'            nb.ipam.ip_addresses,\n' +
'            {"address": mgmt_ip + "/24"},\n' +
'            {"address": mgmt_ip + "/24", "status": "active",\n' +
'             "assigned_object_type": "dcim.device", "assigned_object_id": dev.id},\n' +
'        )\n' +
'        if ip:\n' +
'            dev.update({"primary_ip4": ip.id})\n' +
'\n' +
'    return dev\n' +
'\n' +
'\n' +
'def main():\n' +
'    print(f"=== NetDesign AI → NetBox Sync ===")\n' +
'    print(f"URL: {NETBOX_URL}  |  DRY_RUN: {DRY_RUN}")\n' +
'    print(f"Devices to sync: {len(DEVICES)}")\n' +
'    print()\n' +
'\n' +
'    site = sync_site()\n' +
'\n' +
'    for dev_data in DEVICES:\n' +
'        print(f"Syncing device: {dev_data[\'name\']}")\n' +
'        sync_device(dev_data, site)\n' +
'\n' +
'    print()\n' +
'    print("=== Sync complete ===")\n' +
'    if DRY_RUN:\n' +
'        print("DRY_RUN=True — no records were modified. Set DRY_RUN=False to apply.")\n' +
'\n' +
'\n' +
'if __name__ == "__main__":\n' +
'    main()\n';
}

function downloadNetBoxSyncScript() {
  var content = genNetBoxSyncScript(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'text/x-python' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netbox_sync.py';
  a.click();
  if (typeof toast === 'function') toast('NetBox sync script downloaded', 'success');
}

window.genNetBoxSyncScript      = genNetBoxSyncScript;
window.downloadNetBoxSyncScript = downloadNetBoxSyncScript;

/* ════════════════════════════════════════════════════════════════
   SNMP MIB MAPPING
   Per-vendor OID → human-readable label table. Covers IF-MIB,
   BGP4-MIB, OSPF-MIB, ENTITY-MIB plus Cisco / Arista / Juniper
   / SONiC vendor-private MIBs.
════════════════════════════════════════════════════════════════ */

var SNMP_MIBS = [
  /* ── Standard RFC MIBs (all vendors) ─────────────────────── */
  { oid:'1.3.6.1.2.1.1.1.0',        mib:'SNMPv2-MIB',            object:'sysDescr',                    vendor:'all',    type:'string',  unit:'',      desc:'System description string' },
  { oid:'1.3.6.1.2.1.1.3.0',        mib:'SNMPv2-MIB',            object:'sysUpTime',                   vendor:'all',    type:'gauge',   unit:'ticks', desc:'Uptime in hundredths of a second' },
  { oid:'1.3.6.1.2.1.1.5.0',        mib:'SNMPv2-MIB',            object:'sysName',                     vendor:'all',    type:'string',  unit:'',      desc:'System hostname' },
  { oid:'1.3.6.1.2.1.2.2.1.2',      mib:'IF-MIB',                object:'ifDescr',                     vendor:'all',    type:'string',  unit:'',      desc:'Interface name/description' },
  { oid:'1.3.6.1.2.1.2.2.1.5',      mib:'IF-MIB',                object:'ifSpeed',                     vendor:'all',    type:'gauge',   unit:'bps',   desc:'Nominal interface bandwidth' },
  { oid:'1.3.6.1.2.1.2.2.1.7',      mib:'IF-MIB',                object:'ifAdminStatus',               vendor:'all',    type:'gauge',   unit:'',      desc:'Admin state: 1=up 2=down 3=testing' },
  { oid:'1.3.6.1.2.1.2.2.1.8',      mib:'IF-MIB',                object:'ifOperStatus',                vendor:'all',    type:'gauge',   unit:'',      desc:'Oper state: 1=up 2=down' },
  { oid:'1.3.6.1.2.1.2.2.1.10',     mib:'IF-MIB',                object:'ifInOctets',                  vendor:'all',    type:'counter', unit:'bytes', desc:'Inbound bytes (32-bit counter)' },
  { oid:'1.3.6.1.2.1.2.2.1.13',     mib:'IF-MIB',                object:'ifInDiscards',                vendor:'all',    type:'counter', unit:'pkts',  desc:'Inbound packets discarded' },
  { oid:'1.3.6.1.2.1.2.2.1.14',     mib:'IF-MIB',                object:'ifInErrors',                  vendor:'all',    type:'counter', unit:'pkts',  desc:'Inbound packets with errors' },
  { oid:'1.3.6.1.2.1.2.2.1.16',     mib:'IF-MIB',                object:'ifOutOctets',                 vendor:'all',    type:'counter', unit:'bytes', desc:'Outbound bytes (32-bit counter)' },
  { oid:'1.3.6.1.2.1.2.2.1.19',     mib:'IF-MIB',                object:'ifOutDiscards',               vendor:'all',    type:'counter', unit:'pkts',  desc:'Outbound packets discarded' },
  { oid:'1.3.6.1.2.1.2.2.1.20',     mib:'IF-MIB',                object:'ifOutErrors',                 vendor:'all',    type:'counter', unit:'pkts',  desc:'Outbound packets with errors' },
  { oid:'1.3.6.1.2.1.31.1.1.1.6',   mib:'IF-MIB',                object:'ifHCInOctets',                vendor:'all',    type:'counter', unit:'bytes', desc:'Inbound bytes (64-bit counter)' },
  { oid:'1.3.6.1.2.1.31.1.1.1.10',  mib:'IF-MIB',                object:'ifHCOutOctets',               vendor:'all',    type:'counter', unit:'bytes', desc:'Outbound bytes (64-bit counter)' },
  { oid:'1.3.6.1.2.1.31.1.1.1.15',  mib:'IF-MIB',                object:'ifHighSpeed',                 vendor:'all',    type:'gauge',   unit:'Mbps',  desc:'Interface speed in Mbps' },
  { oid:'1.3.6.1.2.1.31.1.1.1.18',  mib:'IF-MIB',                object:'ifAlias',                     vendor:'all',    type:'string',  unit:'',      desc:'Operator-assigned interface alias' },
  { oid:'1.3.6.1.2.1.15.3.1.2',     mib:'BGP4-MIB',              object:'bgpPeerState',                vendor:'all',    type:'gauge',   unit:'',      desc:'BGP peer FSM state (6=established)' },
  { oid:'1.3.6.1.2.1.15.3.1.5',     mib:'BGP4-MIB',              object:'bgpPeerFsmEstabTime',         vendor:'all',    type:'gauge',   unit:'s',     desc:'Seconds peer has been in Established' },
  { oid:'1.3.6.1.2.1.15.3.1.10',    mib:'BGP4-MIB',              object:'bgpPeerRemoteAs',             vendor:'all',    type:'gauge',   unit:'',      desc:'BGP peer remote AS number' },
  { oid:'1.3.6.1.2.1.15.3.1.11',    mib:'BGP4-MIB',              object:'bgpPeerInUpdates',            vendor:'all',    type:'counter', unit:'pkts',  desc:'BGP UPDATE messages received from peer' },
  { oid:'1.3.6.1.2.1.15.3.1.12',    mib:'BGP4-MIB',              object:'bgpPeerOutUpdates',           vendor:'all',    type:'counter', unit:'pkts',  desc:'BGP UPDATE messages sent to peer' },
  { oid:'1.3.6.1.2.1.14.10.1.6',    mib:'OSPF-MIB',              object:'ospfNbrState',                vendor:'all',    type:'gauge',   unit:'',      desc:'OSPF neighbor state (8=full)' },
  { oid:'1.3.6.1.2.1.14.2.1.5',     mib:'OSPF-MIB',              object:'ospfIfState',                 vendor:'all',    type:'gauge',   unit:'',      desc:'OSPF interface state (1=down 4=dr 5=bdr 6=point-to-point)' },
  { oid:'1.3.6.1.2.1.47.1.1.1.1.2', mib:'ENTITY-MIB',            object:'entPhysicalDescr',            vendor:'all',    type:'string',  unit:'',      desc:'Physical entity description' },
  { oid:'1.3.6.1.2.1.47.1.1.1.1.7', mib:'ENTITY-MIB',            object:'entPhysicalName',             vendor:'all',    type:'string',  unit:'',      desc:'Physical entity name' },
  { oid:'1.3.6.1.2.1.47.1.1.1.1.11',mib:'ENTITY-MIB',            object:'entPhysicalSerialNum',        vendor:'all',    type:'string',  unit:'',      desc:'Physical entity serial number' },
  /* ── Cisco IOS-XE + NX-OS ────────────────────────────────── */
  { oid:'1.3.6.1.4.1.9.9.109.1.1.1.1.8',  mib:'CISCO-PROCESS-MIB',     object:'cpmCPUTotal5minRev',         vendor:'cisco',  type:'gauge',   unit:'%',     desc:'Cisco CPU utilization 5-min average' },
  { oid:'1.3.6.1.4.1.9.9.109.1.1.1.1.12', mib:'CISCO-PROCESS-MIB',     object:'cpmCPUMemoryUsed',           vendor:'cisco',  type:'gauge',   unit:'KB',    desc:'Cisco process memory used (KB)' },
  { oid:'1.3.6.1.4.1.9.9.109.1.1.1.1.13', mib:'CISCO-PROCESS-MIB',     object:'cpmCPUMemoryFree',           vendor:'cisco',  type:'gauge',   unit:'KB',    desc:'Cisco process memory free (KB)' },
  { oid:'1.3.6.1.4.1.9.9.48.1.1.1.5',     mib:'CISCO-MEMORY-POOL-MIB', object:'ciscoMemoryPoolUsed',        vendor:'cisco',  type:'gauge',   unit:'bytes', desc:'Cisco memory pool bytes used' },
  { oid:'1.3.6.1.4.1.9.9.48.1.1.1.6',     mib:'CISCO-MEMORY-POOL-MIB', object:'ciscoMemoryPoolFree',        vendor:'cisco',  type:'gauge',   unit:'bytes', desc:'Cisco memory pool bytes free' },
  { oid:'1.3.6.1.4.1.9.9.13.1.3.1.3',     mib:'CISCO-ENVMON-MIB',      object:'ciscoEnvMonTemperatureValue',vendor:'cisco',  type:'gauge',   unit:'°C',    desc:'Cisco chassis temperature sensor' },
  { oid:'1.3.6.1.4.1.9.9.13.1.3.1.6',     mib:'CISCO-ENVMON-MIB',      object:'ciscoEnvMonTemperatureState',vendor:'cisco',  type:'gauge',   unit:'',      desc:'Temp state: 1=normal 2=warning 3=critical' },
  { oid:'1.3.6.1.4.1.9.9.13.1.5.1.2',     mib:'CISCO-ENVMON-MIB',      object:'ciscoEnvMonFanState',        vendor:'cisco',  type:'gauge',   unit:'',      desc:'Cisco fan state (1=normal 5=critical)' },
  { oid:'1.3.6.1.4.1.9.9.187.1.2.5.1.3',  mib:'CISCO-BGP4-MIB',        object:'cbgpPeer2State',             vendor:'cisco',  type:'gauge',   unit:'',      desc:'Cisco BGP4 peer state (6=established)' },
  { oid:'1.3.6.1.4.1.9.9.187.1.2.5.1.27', mib:'CISCO-BGP4-MIB',        object:'cbgpPeer2PrefixAccepted',    vendor:'cisco',  type:'gauge',   unit:'',      desc:'Cisco BGP accepted prefix count' },
  { oid:'1.3.6.1.4.1.9.9.46.1.6.1.1.14',  mib:'CISCO-VTP-MIB',         object:'vtpVlanState',               vendor:'cisco',  type:'gauge',   unit:'',      desc:'VLAN state: 1=operational 2=suspended' },
  { oid:'1.3.6.1.4.1.9.9.105.1.1.1.1.10', mib:'CISCO-STACKWISE-MIB',   object:'cswSwitchNumCurrent',        vendor:'cisco',  type:'gauge',   unit:'',      desc:'Cisco StackWise current switch count' },
  /* ── Arista EOS ──────────────────────────────────────────── */
  { oid:'1.3.6.1.4.1.30065.4.1.1.2.1.3',  mib:'ARISTA-BGP4V2-MIB',     object:'aristaBgpV2PeerState',       vendor:'arista', type:'gauge',   unit:'',      desc:'Arista BGP peer state (6=established)' },
  { oid:'1.3.6.1.4.1.30065.4.1.1.2.1.13', mib:'ARISTA-BGP4V2-MIB',     object:'aristaBgpV2PeerPrefixesAccepted', vendor:'arista', type:'gauge', unit:'',   desc:'Arista BGP accepted prefix count per peer' },
  { oid:'1.3.6.1.4.1.30065.3.1.63',        mib:'ARISTA-PROCESS-MIB',    object:'aristaSystemCpuFiveMinuteAvg',   vendor:'arista', type:'gauge', unit:'%',   desc:'Arista 5-minute CPU average' },
  { oid:'1.3.6.1.4.1.30065.3.1.22',        mib:'ARISTA-SYSDB-MIB',      object:'aristaSystemMemFree',        vendor:'arista', type:'gauge',   unit:'KB',    desc:'Arista free memory (KB)' },
  { oid:'1.3.6.1.4.1.30065.3.1.23',        mib:'ARISTA-SYSDB-MIB',      object:'aristaSystemMemTotal',       vendor:'arista', type:'gauge',   unit:'KB',    desc:'Arista total memory (KB)' },
  { oid:'1.3.6.1.4.1.30065.3.1.12',        mib:'ARISTA-ENVMON-MIB',     object:'aristaEnvMonSensorValue',    vendor:'arista', type:'gauge',   unit:'mC',    desc:'Arista sensor value (millidegrees C)' },
  /* ── Juniper JunOS ───────────────────────────────────────── */
  { oid:'1.3.6.1.4.1.2636.3.1.13.1.8',    mib:'JUNIPER-MIB',            object:'jnxOperatingCPU',            vendor:'juniper',type:'gauge',   unit:'%',     desc:'Juniper component CPU utilization' },
  { oid:'1.3.6.1.4.1.2636.3.1.13.1.11',   mib:'JUNIPER-MIB',            object:'jnxOperatingMemory',         vendor:'juniper',type:'gauge',   unit:'MB',    desc:'Juniper component memory used (MB)' },
  { oid:'1.3.6.1.4.1.2636.3.1.13.1.6',    mib:'JUNIPER-MIB',            object:'jnxOperatingTemp',           vendor:'juniper',type:'gauge',   unit:'°C',    desc:'Juniper component temperature' },
  { oid:'1.3.6.1.4.1.2636.3.1.13.1.5',    mib:'JUNIPER-MIB',            object:'jnxOperatingState',          vendor:'juniper',type:'gauge',   unit:'',      desc:'Juniper component state (1=unknown 2=running 6=offline)' },
  { oid:'1.3.6.1.4.1.2636.3.5.2.1.2',     mib:'JUNIPER-BGP-TYPES',      object:'jnxBgpM2PeerState',          vendor:'juniper',type:'gauge',   unit:'',      desc:'Juniper BGP peer state (6=established)' },
  { oid:'1.3.6.1.4.1.2636.3.5.2.1.10',    mib:'JUNIPER-BGP-TYPES',      object:'jnxBgpM2PeerPrefixAccepted', vendor:'juniper',type:'gauge',   unit:'',      desc:'Juniper BGP accepted prefix count' },
  { oid:'1.3.6.1.4.1.2636.3.36.1.2.1.1',  mib:'JUNIPER-ALARM-MIB',      object:'jnxRedAlarmState',           vendor:'juniper',type:'gauge',   unit:'',      desc:'Juniper red (major) alarm: 1=off 2=active' },
  { oid:'1.3.6.1.4.1.2636.3.36.1.2.2.1',  mib:'JUNIPER-ALARM-MIB',      object:'jnxYellowAlarmState',        vendor:'juniper',type:'gauge',   unit:'',      desc:'Juniper yellow (minor) alarm: 1=off 2=active' },
  /* ── SONiC (Linux/NET-SNMP) ──────────────────────────────── */
  { oid:'1.3.6.1.2.1.25.3.3.1.2',          mib:'HOST-RESOURCES-MIB',     object:'hrProcessorLoad',            vendor:'sonic',  type:'gauge',   unit:'%',     desc:'SONiC per-CPU load percentage' },
  { oid:'1.3.6.1.2.1.25.2.3.1.6',          mib:'HOST-RESOURCES-MIB',     object:'hrStorageUsed',              vendor:'sonic',  type:'gauge',   unit:'alloc-units', desc:'SONiC storage/memory allocation units used' },
  { oid:'1.3.6.1.2.1.25.2.3.1.5',          mib:'HOST-RESOURCES-MIB',     object:'hrStorageSize',              vendor:'sonic',  type:'gauge',   unit:'alloc-units', desc:'SONiC total storage allocation units' },
  { oid:'1.3.6.1.2.1.25.1.1.0',            mib:'HOST-RESOURCES-MIB',     object:'hrSystemUptime',             vendor:'sonic',  type:'gauge',   unit:'ticks', desc:'SONiC system uptime' },
];

function genSNMPMIBMapping(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var today = new Date().toISOString().slice(0, 10);
  var vendor = (s.vendor || '').toLowerCase();

  /* Determine which vendors are in this design */
  var relevantVendors = { all: true };
  if (!vendor || vendor === 'cisco' || vendor === 'multi')  relevantVendors.cisco   = true;
  if (!vendor || vendor === 'arista' || vendor === 'multi') relevantVendors.arista  = true;
  if (!vendor || vendor === 'juniper'|| vendor === 'multi') relevantVendors.juniper = true;
  if (!vendor || vendor === 'sonic'  || vendor === 'multi') relevantVendors.sonic   = true;
  if (!vendor) { relevantVendors.cisco = relevantVendors.arista = relevantVendors.juniper = relevantVendors.sonic = true; }

  var rows = SNMP_MIBS.filter(function(m) { return relevantVendors[m.vendor]; });

  var lines = [
    '# NetDesign AI — SNMP MIB Reference',
    '# Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A') + '  |  Vendor filter: ' + (vendor || 'all'),
    '# Columns: OID, MIB, Object Name, Vendor, Type, Unit, Description',
    '#',
    '# Usage:',
    '#   snmpwalk -v3 -u netdesign -l authPriv -a SHA -A <authpass> -x AES -X <privpass> <ip> <OID>',
    '#   snmpget  -v3 -u netdesign -l authPriv -a SHA -A <authpass> -x AES -X <privpass> <ip> <OID>',
    '',
    'OID,MIB,Object Name,Vendor,Type,Unit,Description',
  ];

  rows.forEach(function(m) {
    lines.push([m.oid, m.mib, m.object, m.vendor, m.type, m.unit, '"' + m.desc + '"'].join(','));
  });

  lines.push('');
  lines.push('# snmp_exporter scrape_configs snippet (Prometheus):');
  lines.push('# modules:');
  lines.push('#   network_if:');
  lines.push('#     walk:');
  lines.push('#       - 1.3.6.1.2.1.2.2       # IF-MIB');
  lines.push('#       - 1.3.6.1.2.1.31.1.1    # IF-MIB 64-bit');
  lines.push('#       - 1.3.6.1.2.1.15.3      # BGP4-MIB');
  lines.push('#       - 1.3.6.1.2.1.14.10     # OSPF-MIB nbr');
  lines.push('#       - 1.3.6.1.2.1.47.1.1.1  # ENTITY-MIB');
  lines.push('#   cisco_cpu_mem:');
  lines.push('#     walk:');
  lines.push('#       - 1.3.6.1.4.1.9.9.109.1.1.1  # CISCO-PROCESS-MIB');
  lines.push('#       - 1.3.6.1.4.1.9.9.48.1.1.1   # CISCO-MEMORY-POOL-MIB');
  lines.push('#   arista_bgp:');
  lines.push('#     walk:');
  lines.push('#       - 1.3.6.1.4.1.30065.4.1.1.2  # ARISTA-BGP4V2-MIB');
  lines.push('#   juniper_chassis:');
  lines.push('#     walk:');
  lines.push('#       - 1.3.6.1.4.1.2636.3.1.13    # JUNIPER-MIB operating');
  lines.push('#       - 1.3.6.1.4.1.2636.3.5.2     # JUNIPER-BGP-TYPES');

  return lines.join('\n');
}

function downloadSNMPMIBMapping() {
  var content = genSNMPMIBMapping(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netdesign-snmp-mibs.csv';
  a.click();
  if (typeof toast === 'function') toast('SNMP MIB mapping downloaded', 'success');
}

function renderSNMPMIBPanel() {
  var el = document.getElementById('obs-mib-table');
  if (!el) return;

  var vendor = (typeof STATE !== 'undefined' && STATE.vendor) ? STATE.vendor.toLowerCase() : '';
  var relevantVendors = { all: true };
  if (!vendor) {
    relevantVendors.cisco = relevantVendors.arista = relevantVendors.juniper = relevantVendors.sonic = true;
  } else {
    relevantVendors[vendor] = true;
  }
  var rows = SNMP_MIBS.filter(function(m) { return relevantVendors[m.vendor]; });

  var vendorColors = {
    all:    'var(--txt3)',
    cisco:  '#049fd4',
    arista: '#e85b2d',
    juniper:'#84bd00',
    sonic:  'var(--cyan)',
  };

  var html = '<div style="overflow-x:auto"><table class="mib-table" style="width:100%;border-collapse:collapse;font-size:.73rem">' +
    '<thead><tr style="color:var(--txt3);border-bottom:1px solid var(--border)">' +
    '<th style="text-align:left;padding:.3rem .5rem">OID</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">MIB</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">Object</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">Vendor</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">Type</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">Unit</th>' +
    '<th style="text-align:left;padding:.3rem .5rem">Description</th>' +
    '</tr></thead><tbody>';

  rows.forEach(function(m, i) {
    var bg = i % 2 === 0 ? '' : 'background:var(--bg2)';
    var vc = vendorColors[m.vendor] || 'var(--txt2)';
    html += '<tr style="' + bg + ';border-bottom:1px solid var(--border)">' +
      '<td style="padding:.28rem .5rem;font-family:monospace;color:var(--txt3);font-size:.7rem">' + m.oid + '</td>' +
      '<td style="padding:.28rem .5rem;color:var(--blue)">' + m.mib + '</td>' +
      '<td style="padding:.28rem .5rem;font-weight:600;color:var(--txt1)">' + m.object + '</td>' +
      '<td style="padding:.28rem .5rem"><span style="color:' + vc + ';font-size:.7rem;font-weight:600">' + m.vendor + '</span></td>' +
      '<td style="padding:.28rem .5rem;color:var(--txt3)">' + m.type + '</td>' +
      '<td style="padding:.28rem .5rem;color:var(--txt3)">' + (m.unit || '—') + '</td>' +
      '<td style="padding:.28rem .5rem;color:var(--txt2)">' + m.desc + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

window.SNMP_MIBS              = SNMP_MIBS;
window.genSNMPMIBMapping      = genSNMPMIBMapping;
window.downloadSNMPMIBMapping = downloadSNMPMIBMapping;
window.renderSNMPMIBPanel     = renderSNMPMIBPanel;

/* ════════════════════════════════════════════════════════════════
   SYSLOG PARSING RULES
   Generates Logstash grok + Fluentd regexp configs for
   IOS-XE, NX-OS, EOS, JunOS, SONiC syslog formats.
════════════════════════════════════════════════════════════════ */

var _SYSLOG_PATTERNS = {
  'ios-xe': {
    label: 'Cisco IOS-XE',
    example: '*Jan  1 00:00:01.001: %LINEPROTO-5-UPDOWN: Line protocol on Interface Gi0/0, changed state to up',
    grok: '%{SYSLOGTIMESTAMP:timestamp}(%{SPACE}%{NUMBER:seq}:)? %%{WORD:facility}-%{INT:severity}-%{WORD:mnemonic}: %{GREEDYDATA:message}',
    regexp: '/^(?<timestamp>\\S+ +\\d+ [\\d:]+)(\\.\\d+)?:?\\s+(?:%(?<seq>\\d+): )?%(?<facility>[A-Z0-9_]+)-(?<severity>\\d)-(?<mnemonic>[A-Z0-9_]+): (?<message>.*)$/',
  },
  'nxos': {
    label: 'Cisco NX-OS',
    example: '2024 Jan 01 00:00:01 hostname %ETHPORT-5-IF_UP: Interface Ethernet1/1 is up in mode trunk',
    grok: '%{YEAR} %{SYSLOGTIMESTAMP:timestamp} %{HOSTNAME:hostname} %%{WORD:facility}-%{INT:severity}-%{WORD:mnemonic}: %{GREEDYDATA:message}',
    regexp: '/^(?<year>\\d{4}) (?<timestamp>\\S+ \\d+ [\\d:]+) (?<hostname>\\S+) %(?<facility>[A-Z0-9_]+)-(?<severity>\\d)-(?<mnemonic>[A-Z0-9_]+): (?<message>.*)$/',
  },
  'eos': {
    label: 'Arista EOS',
    example: 'Jan  1 00:00:01 hostname Ebra: %BGP-3-NOTIFICATION: sent to neighbor 10.0.0.1 4/0 (hold time expired)',
    grok: '%{SYSLOGTIMESTAMP:timestamp} %{HOSTNAME:hostname} %{WORD:process}: %%{WORD:facility}-%{INT:severity}-%{WORD:mnemonic}: %{GREEDYDATA:message}',
    regexp: '/^(?<timestamp>\\S+ +\\d+ [\\d:]+) (?<hostname>\\S+) (?<process>\\S+): %(?<facility>[A-Z0-9_]+)-(?<severity>\\d)-(?<mnemonic>[A-Z0-9_]+): (?<message>.*)$/',
  },
  'junos': {
    label: 'Juniper JunOS',
    example: 'Jan  1 00:00:01 hostname rpd[12345]: bgp_listen_accept: Connection attempt from unconfigured neighbor: 10.0.0.1',
    grok: '%{SYSLOGTIMESTAMP:timestamp} %{HOSTNAME:hostname} %{PROG:process}(?:\\[%{POSINT:pid}\\])?: %{GREEDYDATA:message}',
    regexp: '/^(?<timestamp>\\S+ +\\d+ [\\d:]+) (?<hostname>\\S+) (?<process>[^\\[\\]]+)(?:\\[(?<pid>\\d+)\\])?: (?<message>.*)$/',
  },
  'sonic': {
    label: 'SONiC',
    example: 'Jan  1 00:00:01 sonic-switch bgpd[12345]: %NOTIFICATION: sent to neighbor 10.0.0.1 2/0 (Cease/administrative reset)',
    grok: '%{SYSLOGTIMESTAMP:timestamp} %{HOSTNAME:hostname} %{PROG:process}(?:\\[%{POSINT:pid}\\])?: %{GREEDYDATA:message}',
    regexp: '/^(?<timestamp>\\S+ +\\d+ [\\d:]+) (?<hostname>\\S+) (?<process>[^\\[\\]]+)(?:\\[(?<pid>\\d+)\\])?: (?<message>.*)$/',
  },
};

function genSyslogParsingRules(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var today = new Date().toISOString().slice(0, 10);
  var vendor = (s.vendor || '').toLowerCase();

  var vendors = vendor && _SYSLOG_PATTERNS[vendor]
    ? [vendor]
    : Object.keys(_SYSLOG_PATTERNS);

  var lines = [
    '# ═══════════════════════════════════════════════════════════',
    '# NetDesign AI — Syslog Parsing Rules',
    '# Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A'),
    '# Covers: Logstash (grok) + Fluentd (td-agent / fluent-bit regexp)',
    '# ═══════════════════════════════════════════════════════════',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 1 — LOGSTASH CONFIGURATION',
    '# Save as: /etc/logstash/conf.d/network-syslog.conf',
    '# ─────────────────────────────────────────────────────────',
    '',
    'input {',
    '  udp {',
    '    port  => 514',
    '    type  => "network-syslog"',
    '    codec => "plain"',
    '  }',
    '  tcp {',
    '    port  => 514',
    '    type  => "network-syslog"',
    '    codec => "line"',
    '  }',
    '}',
    '',
    'filter {',
    '  if [type] == "network-syslog" {',
    '',
    '    # Strip syslog PRI header  <N>',
    '    grok {',
    '      match => { "message" => "^(?:<(?:%{INT:syslog_pri})>)?%{GREEDYDATA:raw_message}" }',
    '      overwrite => ["message"]',
    '    }',
    '    mutate { rename => { "raw_message" => "message" } }',
    '',
  ];

  /* Per-vendor grok blocks */
  vendors.forEach(function(v, idx) {
    var p = _SYSLOG_PATTERNS[v];
    var cond = idx === 0 ? 'if' : 'else if';
    lines.push('    # ' + p.label);
    lines.push('    # Example: ' + p.example);
    if (v === 'ios-xe') {
      lines.push('    ' + cond + ' [message] =~ "^\\\\*?[A-Z][a-z][a-z]" {');
    } else if (v === 'nxos') {
      lines.push('    ' + cond + ' [message] =~ "^\\\\d{4} [A-Z][a-z][a-z]" {');
    } else if (v === 'eos') {
      lines.push('    ' + cond + ' [message] =~ ": %[A-Z]" {');
    } else if (v === 'junos') {
      lines.push('    ' + cond + ' [message] =~ "\\\\[[0-9]+\\\\]:" {');
    } else {
      lines.push('    else {');
    }
    lines.push('      grok {');
    lines.push('        match => { "message" => "' + p.grok.replace(/"/g, '\\"') + '" }');
    lines.push('        tag_on_failure => ["_grok_' + v + '_fail"]');
    lines.push('      }');
    lines.push('      mutate { add_field => { "vendor" => "' + v + '" } }');
    lines.push('    }');
    lines.push('');
  });

  lines = lines.concat([
    '    # Normalize severity to text',
    '    translate {',
    '      field       => "severity"',
    '      destination => "severity_text"',
    '      dictionary  => {',
    '        "0" => "emergency"',
    '        "1" => "alert"',
    '        "2" => "critical"',
    '        "3" => "error"',
    '        "4" => "warning"',
    '        "5" => "notice"',
    '        "6" => "informational"',
    '        "7" => "debug"',
    '      }',
    '    }',
    '',
    '    # Parse timestamp to @timestamp',
    '    date {',
    '      match   => ["timestamp", "MMM  d HH:mm:ss", "MMM dd HH:mm:ss", "MMM  d HH:mm:ss.SSS",',
    '                  "yyyy MMM  d HH:mm:ss", "yyyy MMM dd HH:mm:ss"]',
    '      target  => "@timestamp"',
    '      timezone => "UTC"',
    '    }',
    '  }',
    '}',
    '',
    'output {',
    '  elasticsearch {',
    '    hosts            => ["http://localhost:9200"]',
    '    index            => "network-syslog-%{+YYYY.MM.dd}"',
    '    template_name    => "network-syslog"',
    '    manage_template  => true',
    '  }',
    '  # Uncomment for debug:',
    '  # stdout { codec => rubydebug }',
    '}',
    '',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 2 — FLUENTD (td-agent) CONFIGURATION',
    '# Save as: /etc/td-agent/conf.d/network-syslog.conf',
    '# ─────────────────────────────────────────────────────────',
    '',
    '<source>',
    '  @type  syslog',
    '  port   514',
    '  bind   0.0.0.0',
    '  tag    network.syslog',
    '  <transport udp/>',
    '</source>',
    '<source>',
    '  @type  syslog',
    '  port   514',
    '  bind   0.0.0.0',
    '  tag    network.syslog.tcp',
    '  <transport tcp/>',
    '</source>',
    '',
  ]);

  /* Per-vendor Fluentd filter blocks */
  vendors.forEach(function(v) {
    var p = _SYSLOG_PATTERNS[v];
    lines.push('# ' + p.label);
    lines.push('<filter network.syslog**>');
    lines.push('  @type parser');
    lines.push('  key_name  message');
    lines.push('  reserve_data true');
    lines.push('  emit_invalid_record_to_error false');
    lines.push('  <parse>');
    lines.push('    @type regexp');
    lines.push('    expression ' + p.regexp);
    lines.push('    time_format %b %d %H:%M:%S');
    lines.push('  </parse>');
    lines.push('</filter>');
    lines.push('');
  });

  lines = lines.concat([
    '# Severity integer → text',
    '<filter network.syslog**>',
    '  @type record_transformer',
    '  <record>',
    '    severity_text ${{"0"=>"emergency","1"=>"alert","2"=>"critical","3"=>"error","4"=>"warning","5"=>"notice","6"=>"informational","7"=>"debug"}[record["severity"]] || "unknown"}',
    '    source_host   ${record["hostname"] || tag_parts[2]}',
    '  </record>',
    '</filter>',
    '',
    '<match network.syslog**>',
    '  @type elasticsearch',
    '  host      localhost',
    '  port      9200',
    '  index_name network-syslog',
    '  logstash_format true',
    '  logstash_prefix network-syslog',
    '</match>',
    '',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 3 — DEVICE SYSLOG CLIENT CONFIG SNIPPETS',
    '# ─────────────────────────────────────────────────────────',
    '',
    '# IOS-XE:',
    '#   logging host 10.0.0.10 transport udp port 514',
    '#   logging trap informational',
    '#   logging source-interface Loopback0',
    '#   service timestamps log datetime msec localtime',
    '',
    '# NX-OS:',
    '#   logging server 10.0.0.10 5 use-vrf management',
    '#   logging timestamp milliseconds',
    '#   logging source-interface mgmt0',
    '',
    '# EOS:',
    '#   logging host 10.0.0.10',
    '#   logging level informational',
    '#   logging on',
    '',
    '# JunOS:',
    '#   set system syslog host 10.0.0.10 any info',
    '#   set system syslog host 10.0.0.10 kernel warning',
    '#   set system syslog host 10.0.0.10 routing-engine any',
    '',
    '# SONiC:',
    '#   sudo vi /etc/rsyslog.d/50-default.conf',
    '#   Add: *.* @10.0.0.10:514',
    '#   sudo systemctl restart rsyslog',
  ]);

  return lines.join('\n');
}

function downloadSyslogParsingRules() {
  var content = genSyslogParsingRules(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netdesign-syslog-parsing.conf';
  a.click();
  if (typeof toast === 'function') toast('Syslog parsing rules downloaded', 'success');
}

window.genSyslogParsingRules      = genSyslogParsingRules;
window.downloadSyslogParsingRules = downloadSyslogParsingRules;

/* ════════════════════════════════════════════════════════════════
   NETFLOW / sFlow COLLECTOR CONFIG
   Generates nfcapd (NFDUMP) + pmacct nfacctd config for
   collecting NetFlow v5/v9/IPFIX from all BOM devices.
════════════════════════════════════════════════════════════════ */

function genNetflowConfig(state) {
  var s = state || (typeof STATE !== 'undefined' ? STATE : {});
  var today = new Date().toISOString().slice(0, 10);
  var vendor = (s.vendor || '').toLowerCase();
  var devices = [];
  try { if (typeof buildDeviceList === 'function') devices = buildDeviceList(); } catch(e) {}

  var collectorIP = '10.0.0.10';
  var flowPort    = 9995;
  var sflowPort   = 6343;

  /* Build per-device exporter snippets */
  var iosxeExporters = [], nxosExporters = [], eosExporters = [], junosExporters = [], sonicExporters = [];

  devices.forEach(function(dev, idx) {
    var mgmtIP  = '10.0.0.' + (30 + idx);
    var srcIface = dev.layer && dev.layer.indexOf('campus') >= 0 ? 'Loopback0' : 'Loopback0';
    var platform = (dev.platform || '').toLowerCase();
    var layer    = dev.layer || '';

    if (platform === 'ios-xe' || layer.indexOf('campus') >= 0) {
      iosxeExporters.push('! Device: ' + dev.name);
      iosxeExporters.push('flow exporter NETDESIGN-EXPORT');
      iosxeExporters.push(' destination ' + collectorIP);
      iosxeExporters.push(' source ' + srcIface);
      iosxeExporters.push(' transport udp ' + flowPort);
      iosxeExporters.push(' export-protocol ipfix');
      iosxeExporters.push(' template data timeout 30');
      iosxeExporters.push('!');
      iosxeExporters.push('flow monitor NETDESIGN-MONITOR');
      iosxeExporters.push(' exporter NETDESIGN-EXPORT');
      iosxeExporters.push(' cache timeout active 60');
      iosxeExporters.push(' record ipv4');
      iosxeExporters.push('!');
    } else if (platform === 'nxos' || layer.indexOf('dc') >= 0 || layer.indexOf('spine') >= 0) {
      nxosExporters.push('! Device: ' + dev.name);
      nxosExporters.push('feature netflow');
      nxosExporters.push('flow exporter NETDESIGN');
      nxosExporters.push('  destination ' + collectorIP + ' use-vrf management');
      nxosExporters.push('  source mgmt0');
      nxosExporters.push('  transport udp ' + flowPort);
      nxosExporters.push('  version 9');
      nxosExporters.push('!');
    } else if (platform === 'eos' || layer.indexOf('leaf') >= 0) {
      eosExporters.push('! Device: ' + dev.name);
      eosExporters.push('flow tracking hardware');
      eosExporters.push('   tracker NETDESIGN');
      eosExporters.push('      flow export destination ' + collectorIP + ' ' + flowPort);
      eosExporters.push('      flow export format ipfix');
      eosExporters.push('      flow timeout active 60');
      eosExporters.push('!');
    } else if (platform === 'junos') {
      junosExporters.push('# Device: ' + dev.name);
      junosExporters.push('set forwarding-options sampling instance NETDESIGN input rate 1000');
      junosExporters.push('set forwarding-options sampling instance NETDESIGN family inet output flow-server ' + collectorIP + ' port ' + flowPort);
      junosExporters.push('set forwarding-options sampling instance NETDESIGN family inet output flow-server ' + collectorIP + ' version-ipfix template ipv4-template');
      junosExporters.push('set forwarding-options sampling instance NETDESIGN family inet output inline-jflow source-address ' + mgmtIP);
      junosExporters.push('');
    } else if (platform === 'sonic') {
      sonicExporters.push('# Device: ' + dev.name);
      sonicExporters.push('# SONiC uses sFlow (hsflowd) — install: sudo apt install hsflowd');
      sonicExporters.push('# /etc/hsflowd.conf:');
      sonicExporters.push('sflow {');
      sonicExporters.push('  collector { ip = ' + collectorIP + '; udpport = ' + sflowPort + '; }');
      sonicExporters.push('  sampling { ingress = 1000; egress = 1000; }');
      sonicExporters.push('}');
      sonicExporters.push('');
    }
  });

  var pmacctDevices = devices.map(function(dev, idx) {
    return '  { ip: "10.0.0.' + (30 + idx) + '", name: "' + dev.name + '", layer: "' + (dev.layer || '') + '" }';
  }).join(',\n') || '  # No devices — run through Steps 1-3 first';

  var lines = [
    '# ═══════════════════════════════════════════════════════════',
    '# NetDesign AI — NetFlow / sFlow Collector Config',
    '# Generated: ' + today + '  |  Org: ' + (s.orgName || 'N/A'),
    '# Collector IP: ' + collectorIP + '  (replace with your actual collector address)',
    '# Devices: ' + devices.length,
    '# ═══════════════════════════════════════════════════════════',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 1 — nfcapd (NFDUMP suite) — NetFlow v5/v9/IPFIX',
    '# Install:  apt install nfdump   OR   yum install nfdump',
    '# ─────────────────────────────────────────────────────────',
    '',
    '# Start nfcapd collector (receives all versions):',
    'nfcapd -w -D -l /var/cache/nfdump -p ' + flowPort + ' -I ANY -z -T all',
    '',
    '# Or as a systemd unit /etc/systemd/system/nfcapd.service:',
    '[Unit]',
    'Description=nfcapd NetFlow collector',
    'After=network.target',
    '',
    '[Service]',
    'ExecStart=/usr/sbin/nfcapd -w -l /var/cache/nfdump -p ' + flowPort + ' -I ANY -z -T all',
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
    '# nfcapd rotates files hourly; read with nfdump:',
    '# nfdump -R /var/cache/nfdump -s ip/bytes -n 20 -o "fmt:%ts %te %pr %sap -> %dap %pkt %byt %bps %fl"',
    '# nfdump -R /var/cache/nfdump "host 10.0.0.1"',
    '',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 2 — pmacct nfacctd — traffic accounting + Prometheus',
    '# Install:  apt install pmacct',
    '# Config:   /etc/pmacct/nfacctd.conf',
    '# ─────────────────────────────────────────────────────────',
    '',
    'daemonize: true',
    'pidfile: /var/run/nfacctd.pid',
    'syslog: daemon',
    '',
    '! NetFlow UDP listener',
    'nfacctd_port: ' + flowPort,
    'nfacctd_ip: 0.0.0.0',
    'nfacctd_time_new: true',
    '',
    '! Interface/instance tagging',
    'nfacctd_as_new: netflow',
    'networks_file: /etc/pmacct/networks.lst',
    'bgp_daemon: false',
    '',
    '! Plugins: Prometheus + CSV output',
    'plugins: memory[nets], print[csv]',
    '',
    '! Prometheus plugin',
    'aggregate[nets]: src_host, dst_host, proto, src_port, dst_port',
    'imt_path[nets]: /tmp/pmacct.pipe',
    'imt_size[nets]: 10000',
    '',
    '! CSV output (rotate every 5 minutes)',
    'print_output[csv]: csv',
    'print_output_file[csv]: /var/log/pmacct/flows-%Y%m%d%H%M.csv',
    'print_refresh_time[csv]: 300',
    '',
    '# Query pmacct memory table:',
    '# pmacct -s -p /tmp/pmacct.pipe -O csv',
    '',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 3 — sFlow collector (sfacctd for SONiC devices)',
    '# Config:   /etc/pmacct/sfacctd.conf',
    '# ─────────────────────────────────────────────────────────',
    '',
    'daemonize: true',
    'syslog: daemon',
    'sfacctd_port: ' + sflowPort,
    'sfacctd_ip: 0.0.0.0',
    'plugins: print[sflow-csv]',
    'print_output[sflow-csv]: csv',
    'print_output_file[sflow-csv]: /var/log/pmacct/sflow-%Y%m%d%H%M.csv',
    'print_refresh_time[sflow-csv]: 60',
    '',
    '',
    '# ─────────────────────────────────────────────────────────',
    '# PART 4 — Device exporter config snippets',
    '# ─────────────────────────────────────────────────────────',
  ];

  if (iosxeExporters.length) {
    lines.push('');
    lines.push('# ── Cisco IOS-XE (IPFIX) ──');
    iosxeExporters.forEach(function(l) { lines.push(l); });
  }
  if (nxosExporters.length) {
    lines.push('');
    lines.push('# ── Cisco NX-OS (NetFlow v9) ──');
    nxosExporters.forEach(function(l) { lines.push(l); });
  }
  if (eosExporters.length) {
    lines.push('');
    lines.push('# ── Arista EOS (IPFIX) ──');
    eosExporters.forEach(function(l) { lines.push(l); });
  }
  if (junosExporters.length) {
    lines.push('');
    lines.push('# ── Juniper JunOS (IPFIX / inline-jflow) ──');
    junosExporters.forEach(function(l) { lines.push(l); });
  }
  if (sonicExporters.length) {
    lines.push('');
    lines.push('# ── SONiC (sFlow / hsflowd) ──');
    sonicExporters.forEach(function(l) { lines.push(l); });
  }

  if (!iosxeExporters.length && !nxosExporters.length && !eosExporters.length &&
      !junosExporters.length && !sonicExporters.length) {
    lines.push('');
    lines.push('# No devices found — complete Steps 1-3 first to populate BOM.');
    lines.push('');
    lines.push('# Generic IOS-XE IPFIX template:');
    lines.push('# flow exporter NETDESIGN-EXPORT');
    lines.push('#  destination ' + collectorIP);
    lines.push('#  transport udp ' + flowPort);
    lines.push('#  export-protocol ipfix');
  }

  lines.push('');
  lines.push('# Device inventory (' + devices.length + ' devices):');
  if (devices.length) {
    devices.forEach(function(dev, idx) {
      lines.push('# ' + (dev.name || dev.id) + ' — 10.0.0.' + (30 + idx) + ' (' + (dev.layer || '') + ')');
    });
  } else {
    lines.push('# (none — run Steps 1-3)');
  }

  return lines.join('\n');
}

function downloadNetflowConfig() {
  var content = genNetflowConfig(typeof STATE !== 'undefined' ? STATE : {});
  var blob = new Blob([content], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netdesign-netflow-collector.conf';
  a.click();
  if (typeof toast === 'function') toast('NetFlow collector config downloaded', 'success');
}

window.genNetflowConfig      = genNetflowConfig;
window.downloadNetflowConfig = downloadNetflowConfig;

/* ════════════════════════════════════════════════════════════════
   REAL-TIME TOPOLOGY SYNC
   Polls /api/topology/health every 15 s; updates device-card
   grid in #obs-topo-sync. Gracefully no-ops when backend is
   not configured (Live Mode off).
════════════════════════════════════════════════════════════════ */

var _TOPO_SYNC = {
  handle:   null,
  interval: 15000,
  lastData: [],
  lastTs:   null,
};

async function _fetchTopoHealth() {
  try {
    var base = (typeof BackendClient !== 'undefined' && BackendClient.isLiveMode())
                 ? BackendClient.getBackendUrl().replace(/\/$/, '')
                 : '';
    if (!base) {
      _renderTopoSync(null, 'no-backend');
      return;
    }
    var tok  = (typeof BackendClient !== 'undefined') ? BackendClient.getToken() : '';
    var resp = await fetch(base + '/api/topology/health', {
      headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
    });
    if (!resp.ok) { _renderTopoSync(null, 'api-error'); return; }
    var data = await resp.json();
    _TOPO_SYNC.lastData = data;
    _TOPO_SYNC.lastTs   = new Date().toTimeString().slice(0, 8);
    _renderTopoSync(data, 'ok');
  } catch (e) {
    _renderTopoSync(null, 'fetch-error');
  }
}

function _renderTopoSync(data, status) {
  var el = document.getElementById('obs-topo-sync');
  if (!el) return;

  var stopBtn  = document.getElementById('obs-topo-stop-btn');
  var startBtn = document.getElementById('obs-topo-start-btn');
  var tsEl     = document.getElementById('obs-topo-ts');

  if (stopBtn)  stopBtn.disabled  = !_TOPO_SYNC.handle;
  if (startBtn) startBtn.disabled = !!_TOPO_SYNC.handle;
  if (tsEl && _TOPO_SYNC.lastTs) tsEl.textContent = 'Last: ' + _TOPO_SYNC.lastTs;

  if (status === 'no-backend') {
    el.innerHTML = '<div class="obs-placeholder">Real-time topology sync requires Live Mode. ' +
      'Enable it via the backend settings icon in the toolbar.</div>';
    return;
  }
  if (status === 'api-error' || status === 'fetch-error') {
    el.innerHTML = '<div class="obs-placeholder" style="color:var(--orange)">' +
      'Topology health endpoint unreachable — ensure backend is running with ENABLE_TELEMETRY=true.</div>';
    return;
  }
  if (!data || !data.length) {
    el.innerHTML = '<div class="obs-placeholder">No device health data returned from backend.</div>';
    return;
  }

  var upCount   = data.filter(function(d) { return d.status === 'up'; }).length;
  var downCount = data.length - upCount;

  var html = '<div style="display:flex;gap:.5rem;margin-bottom:.65rem;flex-wrap:wrap">' +
    '<span style="background:rgba(0,232,122,.12);color:var(--green);padding:.2rem .6rem;border-radius:4px;font-size:.78rem;font-weight:600">' + upCount + ' up</span>' +
    '<span style="background:rgba(255,51,85,.1);color:var(--red);padding:.2rem .6rem;border-radius:4px;font-size:.78rem;font-weight:600">' + downCount + ' down</span>' +
    '<span style="margin-left:auto;font-size:.72rem;color:var(--txt3)">' + data.length + ' devices polled</span>' +
    '</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.45rem">';
  data.forEach(function(dev) {
    var isUp   = dev.status === 'up';
    var color  = isUp ? 'var(--green)' : '#ff5555';
    var bg     = isUp ? 'rgba(0,232,122,.06)' : 'rgba(255,51,85,.06)';
    var dot    = isUp ? '●' : '●';
    var latStr = dev.latency_ms != null ? dev.latency_ms.toFixed(1) + ' ms' : '';
    html += '<div style="background:' + bg + ';border:1px solid ' + (isUp ? 'rgba(0,232,122,.2)' : 'rgba(255,51,85,.2)') + ';border-radius:7px;padding:.5rem .7rem">' +
      '<div style="display:flex;align-items:center;gap:.4rem">' +
      '<span style="color:' + color + ';font-size:.65rem">' + dot + '</span>' +
      '<span style="font-weight:600;font-size:.8rem;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="' + (dev.hostname || dev.ip) + '">' + (dev.hostname || dev.ip) + '</span>' +
      (latStr ? '<span style="margin-left:auto;font-size:.7rem;color:var(--txt3)">' + latStr + '</span>' : '') +
      '</div>' +
      (dev.ip ? '<div style="font-size:.7rem;color:var(--txt3);margin-top:.15rem">' + dev.ip + '</div>' : '') +
      (dev.layer ? '<div style="font-size:.68rem;color:var(--txt3)">' + dev.layer + '</div>' : '') +
      '</div>';
  });
  html += '</div>';

  el.innerHTML = html;
}

function startTopoSync() {
  stopTopoSync();
  _fetchTopoHealth();
  _TOPO_SYNC.handle = setInterval(_fetchTopoHealth, _TOPO_SYNC.interval);
  if (typeof toast === 'function') toast('Topology sync started — polling every 15 s', 'info');
  var stopBtn  = document.getElementById('obs-topo-stop-btn');
  var startBtn = document.getElementById('obs-topo-start-btn');
  if (stopBtn)  stopBtn.disabled  = false;
  if (startBtn) startBtn.disabled = true;
}

function stopTopoSync() {
  if (_TOPO_SYNC.handle) {
    clearInterval(_TOPO_SYNC.handle);
    _TOPO_SYNC.handle = null;
  }
  var stopBtn  = document.getElementById('obs-topo-stop-btn');
  var startBtn = document.getElementById('obs-topo-start-btn');
  if (stopBtn)  stopBtn.disabled  = true;
  if (startBtn) startBtn.disabled = false;
}

function renderTopoSyncPanel() {
  _renderTopoSync(_TOPO_SYNC.lastData.length ? _TOPO_SYNC.lastData : null, 'no-backend');
}

window.startTopoSync      = startTopoSync;
window.stopTopoSync       = stopTopoSync;
window.renderTopoSyncPanel= renderTopoSyncPanel;
