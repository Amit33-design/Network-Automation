'use strict';

/* ════════════════════════════════════════════════════════════════
   CONFIG DIFF ENGINE
   Compares old vs new config text (line-level Myers-style diff).
   Snapshots are captured per device-id whenever a config is
   rendered. On regeneration the diff shows + / - / unchanged.
════════════════════════════════════════════════════════════════ */

const CONFIG_HISTORY = {};       // deviceId → { prev: string, curr: string }
let   _diffMode      = false;
let   _diffDevId     = null;

/* ── Snapshot management ────────────────────────────────────── */

/** Called the first time a device config is rendered */
function snapshotConfigFirst(deviceId, text) {
  if (!CONFIG_HISTORY[deviceId]) {
    CONFIG_HISTORY[deviceId] = { prev: null, curr: text };
  }
}

/** Called whenever a config is regenerated */
function snapshotConfigUpdate(deviceId, text) {
  const h = CONFIG_HISTORY[deviceId];
  if (h) {
    h.prev = h.curr;   // rotate: curr → prev
    h.curr = text;
  } else {
    CONFIG_HISTORY[deviceId] = { prev: null, curr: text };
  }
}

function hasDiffHistory(deviceId) {
  const h = CONFIG_HISTORY[deviceId];
  return h && h.prev !== null && h.prev !== h.curr;
}

/* ── Myers line diff ────────────────────────────────────────── */
// Returns array of { type: 'add'|'del'|'same', line: string }

function computeDiff(oldText, newText) {
  const A = (oldText || '').split('\n');
  const B = (newText || '').split('\n');
  const MAX = 600;   // truncate for performance
  const m   = Math.min(A.length, MAX);
  const n   = Math.min(B.length, MAX);

  // Build LCS DP table
  const dp = [];
  for (let i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i-1] === B[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  // Traceback
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i-1] === B[j-1]) {
      result.unshift({ type:'same', line: A[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.unshift({ type:'add',  line: B[j-1] }); j--;
    } else {
      result.unshift({ type:'del',  line: A[i-1] }); i--;
    }
  }
  // Append truncated tail as unchanged
  for (let k = MAX; k < A.length; k++) result.push({ type:'same', line: A[k] });

  return result;
}

/* ── Render diff view ───────────────────────────────────────── */
function renderDiffView(deviceId) {
  const h = CONFIG_HISTORY[deviceId];
  if (!h || !h.prev) {
    toast('No previous snapshot — regenerate configs from Step 3 to create a diff', 'info', 4000);
    return;
  }

  const diff = computeDiff(h.prev, h.curr);
  const added   = diff.filter(l => l.type === 'add').length;
  const removed = diff.filter(l => l.type === 'del').length;
  const same    = diff.filter(l => l.type === 'same').length;

  const area = document.getElementById('cfg-code-area');
  if (!area) return;

  const lines = diff.map(({ type, line }) => {
    const esc    = line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const prefix = type === 'add' ? '+' : type === 'del' ? '-' : ' ';
    const cls    = type === 'add' ? 'dfl-add' : type === 'del' ? 'dfl-del' : 'dfl-same';
    return `<span class="${cls}">${prefix} ${esc}</span>`;
  }).join('\n');

  area.innerHTML = `
    <div class="diff-stats-bar">
      <span class="diff-stat-add">+${added} lines added</span>
      <span class="diff-stat-del">−${removed} lines removed</span>
      <span class="diff-stat-same">${same} unchanged</span>
      <button class="btn-cfg-action" onclick="closeDiffView()" style="margin-left:auto;padding:.25rem .6rem">✕ Close Diff</button>
    </div>
    <pre class="cfg-code diff-pre" id="cfg-code-pre">${lines}</pre>`;

  _diffMode  = true;
  _diffDevId = deviceId;

  // Update the diff button label
  const btn = document.getElementById('btn-diff');
  if (btn) { btn.textContent = '✕ Close Diff'; btn.classList.add('diff-active'); }
}

function closeDiffView() {
  _diffMode  = false;
  _diffDevId = null;
  const btn  = document.getElementById('btn-diff');
  if (btn) { btn.textContent = '⊕ Diff'; btn.classList.remove('diff-active'); }
  // Re-render current device
  const active = document.querySelector('.dev-item.active');
  if (active) active.click();
}

/* ── Delta summary (for deploy delta preview) ───────────────── */
// Returns aggregate diff stats across all devices with history
function getDeltaSummary() {
  let totalAdd = 0, totalDel = 0, totalSame = 0, devCount = 0;
  for (const [id, h] of Object.entries(CONFIG_HISTORY)) {
    if (!h || !h.prev || h.prev === h.curr) continue;
    const diff = computeDiff(h.prev, h.curr);
    totalAdd  += diff.filter(l => l.type === 'add').length;
    totalDel  += diff.filter(l => l.type === 'del').length;
    totalSame += diff.filter(l => l.type === 'same').length;
    devCount++;
  }
  return { added: totalAdd, removed: totalDel, unchanged: totalSame, devices: devCount };
}

function toggleDiff() {
  if (_diffMode) {
    closeDiffView();
    return;
  }
  // Find current device
  const active = document.querySelector('.dev-item.active');
  if (!active) { toast('Select a device first', 'info'); return; }
  const devId = active.dataset.devId;
  if (!devId) return;

  if (!hasDiffHistory(devId)) {
    toast('No diff available yet — navigate to a different step and return to regenerate configs', 'info', 5000);
    return;
  }
  renderDiffView(devId);
}
