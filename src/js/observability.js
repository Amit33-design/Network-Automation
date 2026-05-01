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
}
