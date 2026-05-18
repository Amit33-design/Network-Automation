'use strict';

// ─── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(function() { toast.classList.add('show'); }, 10);
  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { container.removeChild(toast); }, 300);
  }, 3500);
}
window.showToast = showToast;

// ─── Step navigation ──────────────────────────────────────────────────────────
function goToStep(n) {
  var steps = document.querySelectorAll('.step-panel');
  var tabs  = document.querySelectorAll('.step-tab');
  steps.forEach(function(s) { s.classList.remove('active'); });
  tabs.forEach(function(t)  { t.classList.remove('active'); });
  var panel = document.getElementById('step-' + n);
  var tab   = document.querySelector('[data-step="' + n + '"]');
  if (panel) panel.classList.add('active');
  if (tab)   tab.classList.add('active');
  STATE.step = n;
}
window.goToStep = goToStep;

// ─── Step 1: Use-case form ─────────────────────────────────────────────────────
function onUseCaseChange() {
  var val = document.getElementById('sel-usecase').value;
  STATE.useCase = val;
}
window.onUseCaseChange = onUseCaseChange;

function onStep1Submit(e) {
  e && e.preventDefault();
  STATE.useCase  = document.getElementById('sel-usecase').value;
  STATE.scale    = document.getElementById('sel-scale').value;
  STATE.siteName = (document.getElementById('inp-sitename').value || 'HQ').trim();
  STATE.siteCode = (document.getElementById('inp-sitecode').value || STATE.siteName.slice(0,3)).trim().toUpperCase();
  STATE.redundancy = document.getElementById('sel-redundancy').value;

  // Link distances
  var ld = STATE.linkDistances;
  ['spine-leaf','dist-access','core-dist','wan-edge'].forEach(function(key) {
    var el = document.getElementById('dist-' + key);
    if (el) ld[key] = parseInt(el.value) || ld[key];
  });

  // Compliance checkboxes
  STATE.compliance = [];
  document.querySelectorAll('.chk-compliance:checked').forEach(function(cb) {
    STATE.compliance.push(cb.value);
  });

  // App types
  STATE.appTypes = [];
  document.querySelectorAll('.chk-apptype:checked').forEach(function(cb) {
    STATE.appTypes.push(cb.value);
  });

  showToast('Generating BOM for ' + STATE.useCase + ' / ' + STATE.scale + '…', 'info');
  renderStep2();
  goToStep(2);
}
window.onStep1Submit = onStep1Submit;

// ─── Step 2: BOM ──────────────────────────────────────────────────────────────
function renderStep2() {
  var result = window.buildBOM(STATE);
  var html   = window.renderBOMTable(result.summary);
  var deviceList = (STATE.devices || []).map(function(d) {
    return '<tr><td>' + d.hostname + '</td><td>' + d.model + '</td>' +
           '<td>' + d.subLayer + '</td><td>' + d.vendor + '</td>' +
           '<td>' + d.speed + '</td><td>Rack ' + d.rack + ' U' + d.unit + '</td></tr>';
  }).join('');

  var container = document.getElementById('bom-output');
  if (!container) return;
  container.innerHTML = html +
    '<h3 style="margin-top:24px">Device List</h3>' +
    '<table class="bom-table"><thead><tr>' +
      '<th>Hostname</th><th>Model</th><th>Layer</th><th>Vendor</th><th>Speed</th><th>Location</th>' +
    '</tr></thead><tbody>' + deviceList + '</tbody></table>';

  // Cabling tab
  var cableOut = document.getElementById('cabling-output');
  if (cableOut) {
    cableOut.innerHTML = window.renderCablingTable(STATE.cabling);
  }

  // Optics tab
  var opticsOut = document.getElementById('optics-output');
  if (opticsOut && window.recommendOptics) {
    window.recommendOptics(STATE.cabling, STATE.devices, STATE);
    opticsOut.innerHTML = window.renderOpticsTable(STATE.optics);
  }

  showToast('BOM generated: ' + STATE.devices.length + ' devices', 'success');
}
window.renderStep2 = renderStep2;

function exportBOM() {
  var result = window.buildBOM(STATE);
  var csv = window.exportBOMCSV(result.summary, STATE.devices);
  downloadFile('bom-' + STATE.siteCode + '.csv', csv, 'text/csv');
  showToast('BOM exported', 'success');
}
window.exportBOM = exportBOM;

function exportCabling() {
  if (!STATE.cabling || !STATE.cabling.length) {
    showToast('Generate BOM first', 'warning');
    return;
  }
  var csv = window.exportCablingCSV(STATE.cabling);
  downloadFile('cabling-' + STATE.siteCode + '.csv', csv, 'text/csv');
  showToast('Cabling schedule exported', 'success');
}
window.exportCabling = exportCabling;

function exportOptics() {
  if (!STATE.optics || !STATE.optics.length) {
    showToast('Generate BOM first', 'warning');
    return;
  }
  var csv = window.exportOpticsCSV(STATE.optics);
  downloadFile('optics-' + STATE.siteCode + '.csv', csv, 'text/csv');
  showToast('Optics recommendations exported', 'success');
}
window.exportOptics = exportOptics;

// ─── Step 3: Config generation ────────────────────────────────────────────────
function renderStep3() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  window.generateAllConfigs(STATE);
  var container = document.getElementById('config-output');
  if (container) container.innerHTML = window.renderConfigViewer(STATE);
  showToast('Configs generated for ' + STATE.devices.length + ' devices', 'success');
}
window.renderStep3 = renderStep3;

function showDeviceConfig(instanceId) {
  var pre = document.getElementById('cfg-output');
  if (!pre) return;
  pre.textContent = STATE.configs[instanceId] || '! No config for ' + instanceId;
}
window.showDeviceConfig = showDeviceConfig;

function downloadConfig() {
  var sel = document.getElementById('cfg-device-select');
  if (!sel) return;
  var id  = sel.value;
  var cfg = STATE.configs[id] || '';
  var dev = STATE.devices.find(function(d) { return d.instanceId === id; });
  downloadFile((dev ? dev.hostname : id) + '.cfg', cfg, 'text/plain');
  showToast('Config downloaded', 'success');
}
window.downloadConfig = downloadConfig;

function downloadAllConfigs() {
  // Build a single text bundle
  var all = Object.entries(STATE.configs || {}).map(function(pair) {
    var id  = pair[0];
    var cfg = pair[1];
    var dev = STATE.devices.find(function(d) { return d.instanceId === id; });
    return '! ========================\n! ' + (dev ? dev.hostname : id) + '\n! ========================\n' + cfg;
  }).join('\n\n');
  downloadFile('all-configs-' + STATE.siteCode + '.txt', all, 'text/plain');
  showToast('All configs downloaded', 'success');
}
window.downloadAllConfigs = downloadAllConfigs;

// ─── Utility ──────────────────────────────────────────────────────────────────
function downloadFile(filename, content, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}
window.downloadFile = downloadFile;

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  goToStep(1);

  // Wire up step tabs
  document.querySelectorAll('.step-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var n = parseInt(tab.getAttribute('data-step'));
      if (n === 3 && (!STATE.devices || !STATE.devices.length)) {
        showToast('Complete Step 1 first', 'warning');
        return;
      }
      if (n === 3) { renderStep3(); }
      goToStep(n);
    });
  });

  // BOM sub-tabs
  document.querySelectorAll('.bom-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.bom-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.bom-pane').forEach(function(p) { p.classList.remove('active'); });
      tab.classList.add('active');
      var pane = document.getElementById(tab.getAttribute('data-pane'));
      if (pane) pane.classList.add('active');
    });
  });
});
