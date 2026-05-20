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
