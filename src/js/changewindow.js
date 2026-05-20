'use strict';

/* ════════════════════════════════════════════════════════════════
   CHANGE WINDOW VALIDATOR
   Engineers define approved maintenance windows (day-of-week +
   time range).  checkChangeWindow() validates whether the current
   browser clock falls inside an approved window before deployment.

   Supports overnight windows (e.g. 22:00 Fri → 06:00 Sat).
   Configuration is persisted in localStorage so it survives page
   refreshes.
════════════════════════════════════════════════════════════════ */

var CHANGE_WINDOWS = [];

var _CW_STORAGE_KEY = 'netdesign_change_windows';

var _CW_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var _CW_DEFAULTS = [
  {
    id:        'cw-default-1',
    name:      'Weekend',
    days:      [0, 6],
    startHour: 0,  startMin: 0,
    endHour:   23, endMin:   59,
    enabled:   true,
  },
  {
    id:        'cw-default-2',
    name:      'Weeknight Off-Hours',
    days:      [1, 2, 3, 4, 5],
    startHour: 22, startMin: 0,
    endHour:   6,  endMin:   0,
    enabled:   true,
  },
];

/* ── Persistence ─────────────────────────────────────────────── */

function _loadCWConfig() {
  try {
    var raw = localStorage.getItem(_CW_STORAGE_KEY);
    if (raw) {
      CHANGE_WINDOWS = JSON.parse(raw);
      return;
    }
  } catch(_) {}
  CHANGE_WINDOWS = JSON.parse(JSON.stringify(_CW_DEFAULTS));
}

function _saveCWConfig() {
  try { localStorage.setItem(_CW_STORAGE_KEY, JSON.stringify(CHANGE_WINDOWS)); } catch(_) {}
}

function _uid() {
  return 'cw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/* ── CRUD ────────────────────────────────────────────────────── */

function addChangeWindow() {
  _loadCWConfig();
  CHANGE_WINDOWS.push({
    id:        _uid(),
    name:      'New Window',
    days:      [0, 6],
    startHour: 22, startMin: 0,
    endHour:   6,  endMin:   0,
    enabled:   true,
  });
  _saveCWConfig();
  renderChangeWindowPanel();
}

function removeChangeWindow(id) {
  _loadCWConfig();
  CHANGE_WINDOWS = CHANGE_WINDOWS.filter(function(w) { return w.id !== id; });
  _saveCWConfig();
  renderChangeWindowPanel();
}

function toggleCW(id) {
  _loadCWConfig();
  var w = CHANGE_WINDOWS.filter(function(w) { return w.id === id; })[0];
  if (w) { w.enabled = !w.enabled; _saveCWConfig(); renderChangeWindowPanel(); }
}

function resetCWDefaults() {
  CHANGE_WINDOWS = JSON.parse(JSON.stringify(_CW_DEFAULTS));
  _saveCWConfig();
  renderChangeWindowPanel();
  if (typeof toast === 'function') toast('Change windows reset to defaults', 'info');
}

/* ── Core check ─────────────────────────────────────────────── */

function _inWindow(w) {
  var now       = new Date();
  var day       = now.getDay();
  var mins      = now.getHours() * 60 + now.getMinutes();
  var startMins = (w.startHour || 0) * 60 + (w.startMin || 0);
  var endMins   = (w.endHour   || 0) * 60 + (w.endMin   || 0);
  var overnight = endMins <= startMins;  // e.g. 22:00→06:00

  if (!overnight) {
    return w.days.indexOf(day) !== -1 && mins >= startMins && mins < endMins;
  }

  // Overnight: active on a window-day after startMins OR on the next day before endMins
  var prevDay = (day + 6) % 7;
  return (w.days.indexOf(day) !== -1 && mins >= startMins) ||
         (w.days.indexOf(prevDay) !== -1 && mins < endMins);
}

/* Returns { status, message, window? }
   status: 'in-window' | 'out-of-window' | 'unconfigured' */
function checkChangeWindow() {
  _loadCWConfig();
  var enabled = CHANGE_WINDOWS.filter(function(w) { return w.enabled; });
  if (!enabled.length) {
    return { status: 'unconfigured', message: 'No active maintenance windows configured' };
  }
  for (var i = 0; i < enabled.length; i++) {
    if (_inWindow(enabled[i])) {
      return {
        status:  'in-window',
        message: 'Within maintenance window: "' + enabled[i].name + '"',
        window:  enabled[i],
      };
    }
  }
  var now = new Date();
  return {
    status:  'out-of-window',
    message: 'Current time (' +
      now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' +
      _CW_DAY_NAMES[now.getDay()] + ') is outside all approved maintenance windows',
  };
}

/* ── Formatting helpers ──────────────────────────────────────── */

function _fmtPad(n) { return String(n || 0).padStart(2, '0'); }

function _fmtWindow(w) {
  var days = (w.days || []).map(function(d) { return _CW_DAY_NAMES[d]; }).join(', ');
  return days + '  ' +
    _fmtPad(w.startHour) + ':' + _fmtPad(w.startMin) + ' → ' +
    _fmtPad(w.endHour)   + ':' + _fmtPad(w.endMin);
}

/* ── UI renderer ─────────────────────────────────────────────── */

function renderChangeWindowPanel() {
  var el = document.getElementById('change-window-panel');
  if (!el) return;

  _loadCWConfig();
  var result = checkChangeWindow();

  var statusColor = result.status === 'in-window'    ? 'var(--green)'
                  : result.status === 'out-of-window' ? 'var(--yellow)'
                  : 'var(--txt3)';
  var statusIcon  = result.status === 'in-window'    ? '✅'
                  : result.status === 'out-of-window' ? '⚠️' : 'ℹ️';

  var html = '<div class="cw-status-bar" style="border-left:3px solid ' + statusColor + '">' +
    '<span style="font-size:1.05rem">' + statusIcon + '</span>' +
    '<div>' +
      '<div class="cw-status-msg" style="color:' + statusColor + '">' + result.message + '</div>' +
      '<div class="cw-status-sub">Local time: ' + new Date().toLocaleString() + '</div>' +
    '</div></div>';

  if (CHANGE_WINDOWS.length) {
    html += '<table class="cw-table"><thead><tr>' +
      '<th>Name</th><th>Schedule</th><th>Enabled</th><th></th></tr></thead><tbody>';
    CHANGE_WINDOWS.forEach(function(w) {
      var active = w.enabled && _inWindow(w);
      html += '<tr class="' + (active ? 'cw-row-active' : '') + '">' +
        '<td><span class="cw-name">' + w.name + '</span></td>' +
        '<td class="cw-schedule">' + _fmtWindow(w) + '</td>' +
        '<td>' +
          '<span class="cw-toggle-badge ' + (w.enabled ? 'cw-badge-on' : 'cw-badge-off') + '"' +
            ' onclick="toggleCW(\'' + w.id + '\')" title="Click to toggle">' +
            (w.enabled ? 'ON' : 'OFF') + '</span>' +
          (active ? ' <span class="cw-active-label">ACTIVE NOW</span>' : '') +
        '</td>' +
        '<td><button class="cw-del-btn" onclick="removeChangeWindow(\'' + w.id + '\')">✕</button></td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<div class="obs-placeholder" style="margin-top:.5rem">' +
      'No maintenance windows defined. Add one to enforce change-control scheduling.</div>';
  }

  html += '<div style="display:flex;gap:.5rem;margin-top:.75rem;flex-wrap:wrap">' +
    '<button class="btn-cfg-action" onclick="addChangeWindow()" style="font-size:.75rem">+ Add Window</button>' +
    '<button class="btn-cfg-action" onclick="resetCWDefaults()" style="font-size:.75rem">Reset Defaults</button>' +
    '<button class="btn-cfg-action" onclick="renderChangeWindowPanel()" style="font-size:.75rem">↺ Refresh</button>' +
    '</div>';

  el.innerHTML = html;
}

/* ── Public API ──────────────────────────────────────────────── */

window.CHANGE_WINDOWS          = CHANGE_WINDOWS;
window.checkChangeWindow        = checkChangeWindow;
window.addChangeWindow          = addChangeWindow;
window.removeChangeWindow       = removeChangeWindow;
window.toggleCW                 = toggleCW;
window.resetCWDefaults          = resetCWDefaults;
window.renderChangeWindowPanel  = renderChangeWindowPanel;
