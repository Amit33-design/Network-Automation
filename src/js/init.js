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
  var gpuSection = document.getElementById('fs-gpu');
  if (gpuSection) gpuSection.style.display = (val === 'gpu') ? '' : 'none';
  // Show STP section for dc and campus (G-14)
  var stpSection = document.getElementById('fs-stp-design');
  if (stpSection) stpSection.style.display = (val === 'dc' || val === 'campus') ? '' : 'none';
  if (window.clearValidationHighlights) window.clearValidationHighlights();
}
window.onUseCaseChange = onUseCaseChange;

function onStep1Submit(e) {
  e && e.preventDefault();

  // Read all form fields into STATE
  STATE.useCase    = document.getElementById('sel-usecase').value;
  STATE.scale      = document.getElementById('sel-scale').value;
  STATE.siteName   = (document.getElementById('inp-sitename').value || 'HQ').trim();
  STATE.siteCode   = (document.getElementById('inp-sitecode').value || STATE.siteName.slice(0,3)).trim().toUpperCase();
  STATE.redundancy = document.getElementById('sel-redundancy').value;

  var sitesEl = document.getElementById('inp-sites');
  STATE.org = { sites: sitesEl ? (parseInt(sitesEl.value) || 1) : 1 };

  // Vendors
  STATE.vendors = [];
  document.querySelectorAll('.chk-vendor:checked').forEach(function(cb) {
    STATE.vendors.push(cb.value);
  });

  // Protocols
  var underlayEl = document.getElementById('sel-underlay');
  STATE.protocols = {
    underlay: underlayEl ? underlayEl.value : 'bgp',
    overlay:  [],
    features: []
  };
  document.querySelectorAll('.chk-overlay:checked').forEach(function(cb) {
    STATE.protocols.overlay.push(cb.value);
  });
  document.querySelectorAll('.chk-feature:checked').forEach(function(cb) {
    STATE.protocols.features.push(cb.value);
  });

  // GPU transport
  var gpuEl = document.getElementById('sel-gpu-transport');
  STATE.gpu = { transport: gpuEl ? gpuEl.value : 'none' };

  // BGP timer preset (G-12)
  var bgpTimerEl = document.getElementById('sel-bgp-timers');
  STATE.bgp_timers = bgpTimerEl ? bgpTimerEl.value : 'dc_aggressive';

  // BFD timers (G-09)
  STATE.bfd = {
    interval:   parseInt(document.getElementById('inp-bfd-interval').value)   || 300,
    min_rx:     parseInt(document.getElementById('inp-bfd-min-rx').value)     || 300,
    multiplier: parseInt(document.getElementById('inp-bfd-multiplier').value) || 3
  };

  // ECMP (G-10)
  STATE.ecmp = {
    max_paths:      parseInt(document.getElementById('inp-ecmp-max-paths').value) || 8,
    hash_algorithm: document.getElementById('sel-ecmp-hash').value || 'default'
  };

  // STP design (G-14)
  STATE.stp = {
    mode:       (document.getElementById('sel-stp-mode')      || {}).value   || 'mstp',
    bpdu_guard: !!(document.getElementById('chk-stp-bpduguard') || {}).checked,
    portfast:   !!(document.getElementById('chk-stp-portfast')  || {}).checked,
    mst_vlan:   (document.getElementById('inp-stp-mst-vlan')  || {}).value   || '1-4094'
  };

  // EVPN design parameters (G-11)
  var hasEvpn = STATE.protocols.overlay.indexOf('vxlan_evpn') !== -1;
  if (hasEvpn) {
    var rtTypes = [];
    document.querySelectorAll('.chk-rt-type:checked').forEach(function(cb) { rtTypes.push(cb.value); });
    STATE.evpn = {
      rd:           (document.getElementById('sel-evpn-rd')       || {}).value || 'auto',
      rt:           (document.getElementById('sel-evpn-rt')       || {}).value || 'auto',
      rt_base:      (document.getElementById('inp-evpn-rt-base')  || {}).value || '',
      rt_types:     rtTypes.length ? rtTypes : ['rt2', 'rt3'],
      esi:          !!(document.getElementById('chk-evpn-esi')    || {}).checked,
      esi_type:     (document.getElementById('sel-evpn-esi-type') || {}).value || 'type1',
      arp_suppress: !!(document.getElementById('chk-evpn-arp')    || {}).checked,
      advertise_pip:!!(document.getElementById('chk-evpn-pip')    || {}).checked
    };
  }

  // Link distances
  var ld = STATE.linkDistances;
  ['spine-leaf','dist-access','core-dist','wan-edge'].forEach(function(key) {
    var el = document.getElementById('dist-' + key);
    if (el) ld[key] = parseInt(el.value) || ld[key];
  });

  // Compliance
  STATE.compliance = [];
  document.querySelectorAll('.chk-compliance:checked').forEach(function(cb) {
    STATE.compliance.push(cb.value);
  });

  // App types
  STATE.appTypes = [];
  document.querySelectorAll('.chk-apptype:checked').forEach(function(cb) {
    STATE.appTypes.push(cb.value);
  });

  // Topology sizing (G-03 + G-04)
  STATE.topology = {
    endpoint_count:   parseInt(document.getElementById('inp-endpoint-count').value) || 500,
    bandwidth_gbps:   parseInt(document.getElementById('sel-bandwidth-gbps').value)  || 25,
    oversubscription: parseInt(document.getElementById('sel-oversubscription').value) || 3
  };

  // ── G-02: Intent coherence validation ─────────────────────────────────────
  if (window.validateIntent && window.applyValidationHighlights) {
    var violations = window.validateIntent(STATE);
    var blocked    = window.applyValidationHighlights(violations);
    var errCount   = violations.filter(function(v) { return v.severity === 'error'; }).length;
    var warnCount  = violations.length - errCount;

    if (blocked) {
      showToast(errCount + ' design error' + (errCount > 1 ? 's' : '') + ' must be fixed before continuing', 'error');
      return; // block navigation to Step 2
    }
    if (warnCount) {
      showToast(warnCount + ' advisory warning' + (warnCount > 1 ? 's' : '') + ' — review the banner below', 'warning');
    } else if (window.clearValidationHighlights) {
      window.clearValidationHighlights(); // all clean
    }
  }

  showToast('Generating BOM for ' + STATE.useCase + ' / ' + STATE.scale + '…', 'info');
  renderStep2();
  goToStep(2);
}
window.onStep1Submit = onStep1Submit;

// ─── Capacity Math panel (G-03 + G-04) ───────────────────────────────────────
function renderCapacityMath(state) {
  var calc    = state.capacityMath;
  var capOut  = document.getElementById('capacity-math-output');
  var banner  = document.getElementById('bom-capacity-banner');

  if (banner) banner.style.display = 'none';

  if (!capOut) return;
  if (!calc) {
    capOut.innerHTML = '<p class="empty-state">Port-math sizing applies to DC / GPU / Multi-site use cases.</p>';
    return;
  }

  var topo = state.topology || {};
  var t    = calc.trace;

  // Warning badge if uplinks insufficient
  if (!calc.uplink_capacity_ok && banner) {
    banner.innerHTML = '<div class="val-block val-block-error" style="margin:0;">' +
      '<div class="val-block-hdr">Hardware Warning — BOM cannot satisfy intent</div>' +
      '<div class="val-item"><span class="val-msg">' + (calc.warning || '') + '</span></div>' +
      '</div>';
    banner.style.display = 'block';
  }

  var statusClass = calc.uplink_capacity_ok ? 'color:var(--success)' : 'color:var(--danger)';

  capOut.innerHTML =
    '<div class="form-section">' +
      '<h3>Port-Math Capacity Calculation</h3>' +
      '<table class="bom-table">' +
        '<thead><tr><th>Parameter</th><th>Input</th><th>Result</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>Endpoints / servers</td><td>' + topo.endpoint_count + '</td><td>—</td></tr>' +
          '<tr><td>Bandwidth per server</td><td>' + topo.bandwidth_gbps + ' GbE</td><td>—</td></tr>' +
          '<tr><td>Oversubscription</td><td>' + topo.oversubscription + ':1</td><td>—</td></tr>' +
          '<tr><td>Servers per leaf</td><td>' + t.servers_per_leaf + ' downlinks</td><td>—</td></tr>' +
          '<tr><td>Raw leaf count</td><td>⌈' + topo.endpoint_count + ' / ' + t.servers_per_leaf + '⌉</td><td>' + t.raw_leaf_count + '</td></tr>' +
          '<tr><td>Leaf count (even HA pairs)</td><td>→ even</td><td><strong>' + calc.leaf_count + '</strong></td></tr>' +
          '<tr><td>Server capacity per leaf</td><td>' + t.servers_per_leaf + ' × ' + topo.bandwidth_gbps + 'G</td><td>' + t.server_capacity_gbps + ' Gbps</td></tr>' +
          '<tr><td>Required uplink capacity</td><td>' + t.server_capacity_gbps + 'G / ' + topo.oversubscription + '</td><td>' + t.required_uplink_gbps.toFixed(0) + ' Gbps</td></tr>' +
          '<tr><td>Uplinks per leaf</td><td style="' + statusClass + '">' + calc.uplinks_per_leaf + ' × ' + (calc.uplinks_per_leaf > 0 ? (t.required_uplink_gbps / calc.uplinks_per_leaf).toFixed(0) : '?') + 'G</td>' +
            '<td style="' + statusClass + '"><strong>' + (calc.uplink_capacity_ok ? 'OK' : 'INSUFFICIENT') + '</strong></td></tr>' +
          '<tr><td>Total leaf uplinks</td><td>' + calc.leaf_count + ' × ' + calc.uplinks_per_leaf + '</td><td>' + t.total_leaf_uplinks + '</td></tr>' +
          '<tr><td>Spine count</td><td>⌈' + t.total_leaf_uplinks + ' / spine ports⌉ (min 2)</td><td><strong>' + calc.spine_count + '</strong></td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';
}
window.renderCapacityMath = renderCapacityMath;

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

  // Rack Layout tab (G-05)
  var rackOut = document.getElementById('rack-layout-output');
  if (rackOut && window.renderRackLayout) {
    rackOut.innerHTML = window.renderRackLayout(STATE.devices);
  }

  // Capacity Math tab (G-03 + G-04)
  renderCapacityMath(STATE);

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

window.downloadRackLayoutCSV = function() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Generate BOM first', 'warning');
    return;
  }
  var csv = window.exportRackLayoutCSV(STATE.devices);
  downloadFile('rack-layout-' + STATE.siteCode + '.csv', csv, 'text/csv');
  showToast('Rack layout exported', 'success');
};

// ─── Step 5: Pre/Post Checks ──────────────────────────────────────────────────
function renderChecks() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  STATE.preCheckScript  = window.genPreCheckScript(STATE.devices, STATE);
  STATE.postCheckScript = window.genPostCheckScript(STATE.devices, STATE);

  var pre = document.getElementById('pre-check-output');
  if (pre) pre.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.preCheckScript) + '</pre>';

  var post = document.getElementById('post-check-output');
  if (post) post.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.postCheckScript) + '</pre>';

  showToast('Check scripts generated for ' + STATE.devices.length + ' devices', 'success');
}
window.renderChecks = renderChecks;

function downloadPreCheck() {
  if (!STATE.preCheckScript) { renderChecks(); }
  if (!STATE.preCheckScript) return;
  downloadFile('pre_check_' + STATE.siteCode.toLowerCase() + '.py', STATE.preCheckScript, 'text/x-python');
  showToast('pre_check downloaded', 'success');
}
window.downloadPreCheck = downloadPreCheck;

function downloadPostCheck() {
  if (!STATE.postCheckScript) { renderChecks(); }
  if (!STATE.postCheckScript) return;
  downloadFile('post_check_' + STATE.siteCode.toLowerCase() + '.py', STATE.postCheckScript, 'text/x-python');
  showToast('post_check downloaded', 'success');
}
window.downloadPostCheck = downloadPostCheck;

// ─── Step 6: Monitoring ───────────────────────────────────────────────────────
function renderMonitoring() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  STATE.prometheusAlerts  = window.genPrometheusAlerts(STATE.devices, STATE);
  STATE.grafanaDashboard  = window.genGrafanaDashboard(STATE.devices, STATE);

  var promOut = document.getElementById('prometheus-output');
  if (promOut) promOut.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.prometheusAlerts) + '</pre>';

  var grafOut = document.getElementById('grafana-output');
  if (grafOut) grafOut.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.grafanaDashboard) + '</pre>';

  showToast('Monitoring config generated', 'success');
}
window.renderMonitoring = renderMonitoring;

function downloadPrometheus() {
  if (!STATE.prometheusAlerts) { renderMonitoring(); }
  if (!STATE.prometheusAlerts) return;
  downloadFile('alerts-' + STATE.siteCode.toLowerCase() + '.yml', STATE.prometheusAlerts, 'text/yaml');
  showToast('Prometheus alerts downloaded', 'success');
}
window.downloadPrometheus = downloadPrometheus;

function downloadGrafana() {
  if (!STATE.grafanaDashboard) { renderMonitoring(); }
  if (!STATE.grafanaDashboard) return;
  downloadFile('dashboard-' + STATE.siteCode.toLowerCase() + '.json', STATE.grafanaDashboard, 'application/json');
  showToast('Grafana dashboard downloaded', 'success');
}
window.downloadGrafana = downloadGrafana;

// ─── Post-check diff report (G-23) ──────────────────────────────────��────────

window.parsePostCheckReport = function() {
  var input = document.getElementById('diff-json-input');
  var out   = document.getElementById('diff-output');
  if (!input || !out) return;
  var jsonStr = (input.value || '').trim();
  if (!jsonStr) { showToast('Paste post_report JSON first', 'warning'); return; }
  out.innerHTML = window.renderPostCheckDiff(jsonStr);
  showToast('Diff report rendered', 'success');
};

// ─── Symptom classifier (G-37) ───────────────────────────────────────────────

window.updateSymptomResults = function() {
  var query = (document.getElementById('symptom-query') || {}).value || '';
  var cat   = (document.getElementById('symptom-cat')   || {}).value || 'All';
  var out   = document.getElementById('symptom-results');
  if (!out) return;
  out.innerHTML = window.renderSymptomClassifier(query, cat);
};

// ─── Topology crawl pane (G-36) ──────────────────────────────────────────────

window.renderTopoCrawlPane = function() {
  var out = document.getElementById('topo-script-output');
  if (!out) return;
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  var script = window.genTopoCrawlScript(STATE.devices, STATE);
  var site   = STATE.siteCode || 'SITE';
  out.innerHTML = '<p style="font-size:13px;margin-bottom:6px;">Script ready — <strong>topo_crawl_'
    + site.toLowerCase() + '.py</strong> with '
    + STATE.devices.length + ' seed device(s).</p>'
    + '<pre class="config-pre" style="max-height:320px;">'
    + script.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    + '</pre>';
  showToast('Topology crawl script generated', 'success');
};

window.parseTopoCrawlResult = function() {
  var input = document.getElementById('topo-json-input');
  var out   = document.getElementById('topo-result-output');
  if (!input || !out) return;
  out.innerHTML = window.renderTopoCrawlResult(input.value);
};

// ─── Drift check pane (G-27) ─────────────────────────────────────────────────

window.renderDriftPane = function() {
  var out = document.getElementById('drift-script-output');
  if (!out) return;
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  if (!STATE.configs || !Object.keys(STATE.configs).length) {
    showToast('Generate configs in Step 3 first', 'warning');
    out.innerHTML = '<p class="val-block val-block-error">No configs found — complete Step 3 (Generate Configs) first.</p>';
    return;
  }
  var script = window.genDriftScript(STATE.devices, STATE.configs, STATE);
  var site   = STATE.siteCode || 'SITE';
  out.innerHTML = '<p style="font-size:13px;margin-bottom:6px;">Script ready — <strong>drift_check_'
    + site.toLowerCase() + '.py</strong> covers '
    + STATE.devices.length + ' device(s).</p>'
    + '<pre class="config-pre" style="max-height:320px;">'
    + script.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    + '</pre>';
  showToast('Drift script generated', 'success');
};

window.parseDriftReport = function() {
  var input = document.getElementById('drift-json-input');
  var out   = document.getElementById('drift-report-output');
  if (!input || !out) return;
  out.innerHTML = window.renderDriftReport(input.value);
};

// ─── Canary deploy pane (G-28) ───────────────────────────────────────────────

function renderCanaryDeployPane() {
  var out = document.getElementById('canary-deploy-output');
  if (!out) return;
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  out.innerHTML = window.renderDeployPane(STATE);
  showToast('Canary deploy plan generated', 'success');
}
window.renderCanaryDeployPane = renderCanaryDeployPane;

// ─── Rollback pane (G-25) ────────────────────────────────────────────────────

function renderRollbackPane() {
  var out = document.getElementById('rollback-output');
  if (!out) return;
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  out.innerHTML = window.renderRollbackRunbook(STATE);
  showToast('Rollback plan generated', 'success');
}
window.renderRollbackPane = renderRollbackPane;

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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

  // EVPN design section — show/hide when vxlan_evpn overlay is toggled (G-11)
  document.querySelectorAll('.chk-overlay').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var anyEvpn = Array.from(document.querySelectorAll('.chk-overlay:checked'))
                        .some(function(c) { return c.value === 'vxlan_evpn'; });
      var sec = document.getElementById('fs-evpn-design');
      if (sec) sec.style.display = anyEvpn ? '' : 'none';
    });
  });

  // RT manual base community field
  var rtSel = document.getElementById('sel-evpn-rt');
  if (rtSel) {
    rtSel.addEventListener('change', function() {
      var grp = document.getElementById('evpn-rt-base-group');
      if (grp) grp.style.display = (rtSel.value === 'manual') ? '' : 'none';
    });
  }

  // ESI group
  var esiChk = document.getElementById('chk-evpn-esi');
  if (esiChk) {
    esiChk.addEventListener('change', function() {
      var grp = document.getElementById('evpn-esi-group');
      if (grp) grp.style.display = esiChk.checked ? '' : 'none';
    });
  }

  // Sub-tab groups — each group activates only sibling panes
  function wireSubTabs(groupSelector, paneAttr) {
    document.querySelectorAll(groupSelector).forEach(function(tab) {
      tab.addEventListener('click', function() {
        var parent = tab.closest('section') || document;
        parent.querySelectorAll(groupSelector).forEach(function(t) { t.classList.remove('active'); });
        parent.querySelectorAll('.bom-pane').forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var pane = document.getElementById(tab.getAttribute(paneAttr || 'data-pane'));
        if (pane) pane.classList.add('active');
      });
    });
  }
  wireSubTabs('.bom-tab', 'data-pane');

  // Step tabs: generate content when navigating to steps 5 and 6
  document.querySelectorAll('.step-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      var n = parseInt(tab.getAttribute('data-step'));
      if ((n === 5 || n === 6) && (!STATE.devices || !STATE.devices.length)) {
        showToast('Complete Step 1 first', 'warning');
        return;
      }
    });
  });
});
