'use strict';

// ─── Config Diff View (G-50) ──────────────────────────────────────────────────
// Side-by-side diff between generated config and user-pasted running config.
// Exposes:
//   window.diffConfigs(oldText, newText)      → [{type:'eq'|'add'|'del', line:string}]
//   window.renderDiffView(state)              → HTML string for diff panel
//   window.showConfigDiff(instanceId)         → update diff panel for a device
//   window.setBaselineConfig(instanceId, txt) → store running config for a device
//
// ES5 only — no let/const, no arrow functions, no template literals.

(function () {

  // ── CSS (injected once) ─────────────────────────────────────────────────────

  var DIFF_CSS = [
    '.diff-layout{display:flex;flex-direction:column;height:100%;}',
    '.diff-toolbar{display:flex;align-items:center;gap:10px;padding:8px 12px;',
      'border-bottom:1px solid var(--border,#334155);',
      'background:var(--surface2,#0f172a);flex-shrink:0;flex-wrap:wrap;}',
    '.diff-panes{display:flex;flex:1;overflow:hidden;gap:0;}',
    '.diff-pane-wrap{flex:1;display:flex;flex-direction:column;',
      'border-right:1px solid var(--border,#334155);overflow:hidden;}',
    '.diff-pane-wrap:last-child{border-right:none;}',
    '.diff-pane-label{padding:4px 10px;font-size:11px;font-weight:600;',
      'background:var(--surface2,#0f172a);',
      'border-bottom:1px solid var(--border,#334155);}',
    '.diff-label-old{color:#f87171;}',
    '.diff-label-new{color:#4ade80;}',
    '.diff-textarea{flex:1;background:#0a0c12;color:#c9d1d9;border:none;',
      'font-family:var(--font,"Consolas",monospace);font-size:12px;',
      'line-height:1.7;padding:12px;resize:none;outline:none;}',
    '.diff-output{flex:1;overflow:auto;background:#0a0c12;}',
    '.diff-code{font-family:var(--font,"Consolas",monospace);font-size:12px;line-height:1.7;}',
    '.diff-line{display:flex;}',
    '.diff-gutter{width:20px;text-align:center;flex-shrink:0;user-select:none;}',
    '.diff-text{flex:1;white-space:pre;overflow:hidden;text-overflow:ellipsis;padding-right:8px;}',
    '.diff-eq{color:#6e7681;}',
    '.diff-add{background:rgba(46,160,67,.15);color:#aff5b4;}',
    '.diff-del{background:rgba(248,81,73,.15);color:#ffa198;text-decoration:line-through;}',
    '.diff-stats{padding:6px 12px;font-size:12px;',
      'border-top:1px solid var(--border,#334155);',
      'background:var(--surface2,#0f172a);flex-shrink:0;}',
    '.diff-stat-add{color:#4ade80;font-weight:600;}',
    '.diff-stat-del{color:#f87171;font-weight:600;}',
    '.diff-device-select{background:var(--surface2,#0f172a);',
      'color:var(--text,#e2e8f0);border:1px solid var(--border,#334155);',
      'border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer;}'
  ].join('');

  function _injectStyles() {
    if (document.getElementById('config-diff-style')) return;
    var s = document.createElement('style');
    s.id = 'config-diff-style';
    s.textContent = DIFF_CSS;
    document.head.appendChild(s);
  }

  // ── Baseline storage ────────────────────────────────────────────────────────

  window._baselineConfigs = window._baselineConfigs || {};

  window.setBaselineConfig = function (instanceId, text) {
    window._baselineConfigs[instanceId] = text;
    window.showConfigDiff(instanceId);
  };

  // ── LCS-based line diff ─────────────────────────────────────────────────────
  // For configs <= 500×500 = 250 000 cell limit: full O(m*n) LCS backtrack.
  // For larger configs: fast set-based diff (add/del only, no eq context).

  window.diffConfigs = function (oldText, newText) {
    var oldLines = (oldText || '').split('\n');
    var newLines = (newText || '').split('\n');
    var m = oldLines.length;
    var n = newLines.length;

    // Fast path for very large configs
    if (m * n > 250000) {
      return _fastSetDiff(oldLines, newLines);
    }

    // Build LCS DP table
    var i, j;
    var dp = [];
    for (i = 0; i <= m; i++) {
      dp[i] = new Array(n + 1);
      dp[i][0] = 0;
    }
    for (j = 0; j <= n; j++) {
      dp[0][j] = 0;
    }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
      }
    }

    // Backtrack to produce edit script
    var result = [];
    i = m;
    j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: 'eq',  line: newLines[j - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'add', line: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'del', line: oldLines[i - 1] });
        i--;
      }
    }
    return result;
  };

  // Fast path: line-set diff — no context lines, just add/del buckets.
  // Preserves order by scanning new for adds and old for dels.
  function _fastSetDiff(oldLines, newLines) {
    var oldSet = {};
    var newSet = {};
    var i;
    for (i = 0; i < oldLines.length; i++) {
      oldSet[oldLines[i]] = (oldSet[oldLines[i]] || 0) + 1;
    }
    for (i = 0; i < newLines.length; i++) {
      newSet[newLines[i]] = (newSet[newLines[i]] || 0) + 1;
    }
    var result = [];
    // Deleted lines (in old, not in new)
    for (i = 0; i < oldLines.length; i++) {
      if (!newSet[oldLines[i]]) {
        result.push({ type: 'del', line: oldLines[i] });
      }
    }
    // Added lines (in new, not in old)
    for (i = 0; i < newLines.length; i++) {
      if (!oldSet[newLines[i]]) {
        result.push({ type: 'add', line: newLines[i] });
      }
    }
    return result;
  }

  // ── renderDiffView(state) ───────────────────────────────────────────────────

  window.renderDiffView = function (state) {
    _injectStyles();

    var devices = (state && state.devices) || [];
    var firstId = devices.length > 0 ? (devices[0].instanceId || '') : '';

    var opts = '';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var id = d.instanceId || d.id || ('device-' + i);
      var label = d.hostname || d.instanceId || id;
      opts += '<option value="' + _esc(id) + '"' + (i === 0 ? ' selected' : '') + '>'
            + _esc(label) + '</option>';
    }

    var html = ''
      + '<div class="diff-layout">'
      +   '<div class="diff-toolbar">'
      +     '<span style="font-size:12px;color:var(--text-dim,#64748b);">'
      +       'Paste running-config below to compare against generated'
      +     '</span>'
      +     '<select id="diff-device-select" class="diff-device-select"'
      +       ' onchange="window.showConfigDiff(this.value)">'
      +       opts
      +     '</select>'
      +   '</div>'
      +   '<div class="diff-panes">'
      +     '<div class="diff-pane-wrap">'
      +       '<div class="diff-pane-label diff-label-old">Running Config (paste here)</div>'
      +       '<textarea id="diff-baseline-input" class="diff-textarea"'
      +         ' placeholder="Paste show running-config output here…"'
      +         ' oninput="window.setBaselineConfig('
      +           'document.getElementById(\'diff-device-select\').value,'
      +           'this.value'
      +         ')"></textarea>'
      +     '</div>'
      +     '<div class="diff-pane-wrap">'
      +       '<div class="diff-pane-label diff-label-new">Generated Config</div>'
      +       '<div id="diff-output" class="diff-output">'
      +         '<p style="color:var(--text-dim,#64748b);padding:16px;font-size:13px;">'
      +           'Paste running config on the left to see diff'
      +         '</p>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div id="diff-stats" class="diff-stats"></div>'
      + '</div>';

    // Trigger initial render after the DOM settles (if a device is selected)
    if (firstId) {
      setTimeout(function () {
        window.showConfigDiff(firstId);
      }, 0);
    }

    return html;
  };

  // ── showConfigDiff(instanceId) ──────────────────────────────────────────────

  window.showConfigDiff = function (instanceId) {
    var generated = (window.STATE && window.STATE.configs && window.STATE.configs[instanceId]) || '';
    var baseline  = (window._baselineConfigs && window._baselineConfigs[instanceId]) || '';

    // Sync device selector
    var sel = document.getElementById('diff-device-select');
    if (sel && sel.value !== instanceId) { sel.value = instanceId; }

    // Sync baseline textarea
    var inp = document.getElementById('diff-baseline-input');
    if (inp && inp.value !== baseline) { inp.value = baseline; }

    var out   = document.getElementById('diff-output');
    var stats = document.getElementById('diff-stats');

    if (!out) return;

    // No baseline pasted yet
    if (!baseline) {
      out.innerHTML = '<p style="color:var(--text-dim,#64748b);padding:16px;font-size:13px;">'
                    + 'Paste running config on the left to see diff</p>';
      if (stats) { stats.innerHTML = ''; }
      return;
    }

    var changes  = window.diffConfigs(baseline, generated);
    var addCount = 0;
    var delCount = 0;
    var i;
    for (i = 0; i < changes.length; i++) {
      if (changes[i].type === 'add') { addCount++; }
      if (changes[i].type === 'del') { delCount++; }
    }

    // Build line-numbered diff HTML
    var lines = '';
    for (i = 0; i < changes.length; i++) {
      var c   = changes[i];
      var cls = c.type === 'add' ? 'diff-add' : (c.type === 'del' ? 'diff-del' : 'diff-eq');
      var pfx = c.type === 'add' ? '+' : (c.type === 'del' ? '-' : ' ');
      var esc = c.line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      lines += '<div class="diff-line ' + cls + '">'
             + '<span class="diff-gutter">' + pfx + '</span>'
             + '<span class="diff-text">' + esc + '</span>'
             + '</div>';
    }

    out.innerHTML = '<div class="diff-code">' + lines + '</div>';

    if (stats) {
      var matchMsg = (addCount === 0 && delCount === 0)
        ? '&nbsp;&nbsp;<span style="color:var(--success,#4ade80);">✓ Configs match</span>'
        : '';
      stats.innerHTML = '<span class="diff-stat-add">+' + addCount + ' lines added</span>'
                      + '&nbsp;&nbsp;'
                      + '<span class="diff-stat-del">-' + delCount + ' lines removed</span>'
                      + matchMsg;
    }
  };

}());
