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
