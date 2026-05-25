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

  // Link distances + fiber types (G-07)
  var ld = STATE.linkDistances;
  if (!STATE.fiberTypes) STATE.fiberTypes = {};
  ['spine-leaf','dist-access','core-dist','wan-edge'].forEach(function(key) {
    var distEl  = document.getElementById('dist-' + key);
    var fiberEl = document.getElementById('fiber-' + key);
    if (distEl)  ld[key] = parseInt(distEl.value) || ld[key];
    if (fiberEl) STATE.fiberTypes[key] = fiberEl.value;
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
var ROLE_COLORS = {
  'super-spine': '#6366f1', 'spine': '#3b82f6', 'core': '#8b5cf6',
  'distribution': '#a855f7', 'leaf': '#22c55e', 'access': '#14b8a6',
  'firewall': '#f97316', 'wan-edge': '#eab308', 'cloud-transit': '#64748b', 'cloud-gw': '#64748b'
};

function _roleBadge(role) {
  var c = ROLE_COLORS[role] || '#64748b';
  return '<span class="role-badge" style="background:' + c + '18;color:' + c + ';">'
    + '<span class="role-dot" style="background:' + c + ';"></span>' + role + '</span>';
}

function renderStep2() {
  var result = window.buildBOM(STATE);
  var html   = window.renderBOMTable(result.summary);
  var deviceList = (STATE.devices || []).map(function(d) {
    return '<tr>'
      + '<td style="font-weight:600;white-space:nowrap;">' + d.hostname + '</td>'
      + '<td style="white-space:nowrap;">' + d.model + '</td>'
      + '<td>' + _roleBadge(d.subLayer) + '</td>'
      + '<td style="white-space:nowrap;">' + d.vendor + '</td>'
      + '<td><code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;">' + d.speed + '</code></td>'
      + '<td style="white-space:nowrap;color:var(--text-dim);">Rack ' + d.rack + ' U' + d.unit + '</td>'
      + '</tr>';
  }).join('');

  var container = document.getElementById('bom-output');
  if (!container) return;

  var deviceSection = '<div style="margin-top:28px;margin-bottom:10px;display:flex;align-items:baseline;gap:12px;">'
    + '<h3 style="font-size:14px;font-weight:700;color:var(--text);">Device Inventory</h3>'
    + '<span style="font-size:12px;color:var(--text-dim);">' + (STATE.devices||[]).length + ' devices</span>'
    + '</div>'
    + '<div class="table-scroll">'
    + '<table class="bom-table"><thead><tr>'
    + '<th>Hostname</th><th>Model</th><th>Role</th><th>Vendor</th><th>Speed</th><th>Location</th>'
    + '</tr></thead><tbody>' + deviceList + '</tbody></table></div>';

  container.innerHTML = '<div class="table-scroll">' + html + '</div>' + deviceSection;

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

  // TCO tab (G-06)
  var tcoOut = document.getElementById('tco-output');
  if (tcoOut && window.renderTCOReport) {
    tcoOut.innerHTML = window.renderTCOReport(STATE);
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

window.downloadTCOCSV = function() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Generate BOM first', 'warning');
    return;
  }
  var csv = window.exportTCOCSV(STATE);
  downloadFile('tco-' + STATE.siteCode + '.csv', csv, 'text/csv');
  showToast('TCO exported', 'success');
};

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
  STATE.dockerCompose     = window.genDockerComposeMonitoring(STATE.devices, STATE);
  STATE.scrapeConfig      = window.genScrapeConfigYaml(STATE.devices, STATE);
  STATE.datasourceYaml    = window.genGrafanaDatasourceYaml();
  STATE.dashboardProvYaml = window.genGrafanaDashboardProvisionYaml();
  STATE.gnmicYaml         = window.genGnmicYaml(STATE.devices, STATE);
  STATE.gnmiDeviceConfigs = window.genGnmiDeviceConfigs(STATE.devices, STATE);

  var promOut = document.getElementById('prometheus-output');
  if (promOut) promOut.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.prometheusAlerts) + '</pre>';

  var grafOut = document.getElementById('grafana-output');
  if (grafOut) grafOut.innerHTML = '<pre class="config-pre">' + escapeHtml(STATE.grafanaDashboard) + '</pre>';

  // G-33: Stack setup tab
  var stackOut = document.getElementById('mon-stack-output');
  if (stackOut) {
    var site = STATE.siteCode || 'SITE';
    stackOut.innerHTML =
      '<div class="val-block" style="background:rgba(79,142,247,.06);border-color:rgba(79,142,247,.3);margin-bottom:12px;">'
      + '<div class="val-block-hdr" style="font-size:13px;">Grafana — <a href="http://localhost:3000" target="_blank" style="color:var(--accent)">http://localhost:3000</a></div>'
      + '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">VictoriaMetrics — <a href="http://localhost:8428" target="_blank" style="color:var(--accent)">http://localhost:8428</a></div>'
      + '<div style="font-size:12px;color:var(--text-dim);">SNMP Exporter — <code>localhost:9116</code> &nbsp;|&nbsp; gnmic Prometheus — <code>localhost:9804</code></div>'
      + '</div>'
      + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">monitoring-stack.yml</h4>'
      + '<pre class="config-pre" style="max-height:260px;">' + escapeHtml(STATE.dockerCompose) + '</pre>'
      + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">monitoring/scrape.yml</h4>'
      + '<pre class="config-pre" style="max-height:180px;">' + escapeHtml(STATE.scrapeConfig) + '</pre>'
      + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">monitoring/provisioning/datasources/victoria.yml</h4>'
      + '<pre class="config-pre" style="max-height:120px;">' + escapeHtml(STATE.datasourceYaml) + '</pre>'
      + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">monitoring/provisioning/dashboards/dashboards.yml</h4>'
      + '<pre class="config-pre" style="max-height:120px;">' + escapeHtml(STATE.dashboardProvYaml) + '</pre>';
  }

  // G-34: gNMI telemetry tab
  var gnmiOut = document.getElementById('mon-gnmi-output');
  if (gnmiOut) {
    gnmiOut.innerHTML =
      '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;">monitoring/gnmic.yml — Collector Config</h4>'
      + '<pre class="config-pre" style="max-height:320px;">' + escapeHtml(STATE.gnmicYaml) + '</pre>'
      + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px;">Device-Side gNMI Config (per platform)</h4>'
      + '<pre class="config-pre" style="max-height:320px;">' + escapeHtml(STATE.gnmiDeviceConfigs || '# No devices — complete Step 1 first.') + '</pre>';
  }

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

window.downloadDockerCompose = function() {
  if (!STATE.dockerCompose) { renderMonitoring(); }
  if (!STATE.dockerCompose) return;
  downloadFile('monitoring-stack.yml', STATE.dockerCompose, 'text/yaml');
  showToast('Docker Compose downloaded', 'success');
};

window.downloadScrapeConfig = function() {
  if (!STATE.scrapeConfig) { renderMonitoring(); }
  if (!STATE.scrapeConfig) return;
  downloadFile('monitoring/scrape.yml', STATE.scrapeConfig, 'text/yaml');
  showToast('Scrape config downloaded', 'success');
};

window.downloadGnmicYaml = function() {
  if (!STATE.gnmicYaml) { renderMonitoring(); }
  if (!STATE.gnmicYaml) return;
  downloadFile('monitoring/gnmic.yml', STATE.gnmicYaml, 'text/yaml');
  showToast('gnmic config downloaded', 'success');
};

window.downloadGnmiDeviceConfigs = function() {
  if (!STATE.gnmiDeviceConfigs) { renderMonitoring(); }
  if (!STATE.gnmiDeviceConfigs) return;
  downloadFile('gnmi-device-config.txt', STATE.gnmiDeviceConfigs, 'text/plain');
  showToast('gNMI device configs downloaded', 'success');
};

// ─── Step 4: ZTP (G-29, G-30, G-31) ─────────────────────────────────────────

window.renderZtp = function() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  window.ztpInitDevices(STATE.devices);

  STATE.day0Config        = window.genDay0Config(STATE.devices, STATE);
  STATE.ztpDockerCompose  = window.genZtpDockerCompose(STATE);
  STATE.ztpNginxConf      = window.genZtpNginxConf();
  STATE.dhcpScope         = window.genZtpDhcpScope(STATE.devices, STATE);
  STATE.ztpApiStubs       = window.genZtpApiStubs(STATE.devices, STATE);

  var day0Out = document.getElementById('ztp-day0-output');
  if (day0Out) day0Out.innerHTML = '<pre class="config-pre" style="max-height:400px;">' + escapeHtml(STATE.day0Config) + '</pre>';

  var srvOut = document.getElementById('ztp-server-output');
  if (srvOut) srvOut.innerHTML =
    '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">ztp-stack.yml</h4>'
    + '<pre class="config-pre" style="max-height:220px;">' + escapeHtml(STATE.ztpDockerCompose) + '</pre>'
    + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">ztp/nginx.conf</h4>'
    + '<pre class="config-pre" style="max-height:160px;">' + escapeHtml(STATE.ztpNginxConf) + '</pre>'
    + '<h4 style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 6px;">DHCP Scope (ISC DHCPd)</h4>'
    + '<pre class="config-pre" style="max-height:160px;">' + escapeHtml(STATE.dhcpScope) + '</pre>';

  var apiOut = document.getElementById('ztp-api-output');
  if (apiOut) apiOut.innerHTML = '<pre class="config-pre" style="max-height:400px;">' + escapeHtml(STATE.ztpApiStubs) + '</pre>';

  var board = document.getElementById('ztp-state-board');
  if (board) board.innerHTML = window.renderZtpStateBoard();

  showToast('ZTP config generated', 'success');
};

window.refreshZtpBoard = function() {
  if (!STATE.devices || !STATE.devices.length) { showToast('Complete Step 1 first', 'warning'); return; }
  window.ztpInitDevices(STATE.devices);
  var board = document.getElementById('ztp-state-board');
  if (board) board.innerHTML = window.renderZtpStateBoard();
};

window.downloadDay0Config = function() {
  if (!STATE.day0Config) { window.renderZtp(); }
  if (!STATE.day0Config) return;
  downloadFile('day0-configs-' + (STATE.siteCode || 'SITE').toLowerCase() + '.txt', STATE.day0Config, 'text/plain');
  showToast('Day-0 configs downloaded', 'success');
};
window.downloadZtpDockerCompose = function() {
  if (!STATE.ztpDockerCompose) { window.renderZtp(); }
  if (!STATE.ztpDockerCompose) return;
  downloadFile('ztp-stack.yml', STATE.ztpDockerCompose, 'text/yaml');
  showToast('ZTP stack downloaded', 'success');
};
window.downloadZtpNginxConf = function() {
  if (!STATE.ztpNginxConf) { window.renderZtp(); }
  if (!STATE.ztpNginxConf) return;
  downloadFile('ztp/nginx.conf', STATE.ztpNginxConf, 'text/plain');
  showToast('nginx.conf downloaded', 'success');
};
window.downloadDhcpScope = function() {
  if (!STATE.dhcpScope) { window.renderZtp(); }
  if (!STATE.dhcpScope) return;
  downloadFile('dhcp.conf', STATE.dhcpScope, 'text/plain');
  showToast('DHCP scope downloaded', 'success');
};
window.downloadZtpApi = function() {
  if (!STATE.ztpApiStubs) { window.renderZtp(); }
  if (!STATE.ztpApiStubs) return;
  downloadFile('ztp/api.py', STATE.ztpApiStubs, 'text/plain');
  showToast('ZTP API downloaded', 'success');
};

// ─── G-24: Batfish dry-run ────────────────────────────────────────────────────

window.renderBatfish = function() {
  if (!STATE.devices || !STATE.devices.length) {
    showToast('Complete Step 1 first', 'warning');
    return;
  }
  STATE.batfishScript = window.genBatfishScript(STATE.devices, STATE.configs, STATE);
  var out = document.getElementById('batfish-output');
  if (out) out.innerHTML = '<pre class="config-pre" style="max-height:400px;">' + escapeHtml(STATE.batfishScript) + '</pre>';
  showToast('Batfish script generated', 'success');
};

window.downloadBatfishScript = function() {
  if (!STATE.batfishScript) { window.renderBatfish(); }
  if (!STATE.batfishScript) return;
  downloadFile('batfish_validate_' + (STATE.siteCode || 'SITE').toLowerCase() + '.py', STATE.batfishScript, 'text/plain');
  showToast('Batfish script downloaded', 'success');
};

// ─── Post-check diff report (G-23) ───────────────────────────────────────────

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
  // Set initial device for download
  window._currentCfgId = STATE.devices[0] ? STATE.devices[0].instanceId : null;
  showToast('Configs generated for ' + STATE.devices.length + ' devices', 'success');
}
window.renderStep3 = renderStep3;

function showDeviceConfig(instanceId) {
  var pre = document.getElementById('cfg-output');
  if (!pre) return;
  pre.textContent = STATE.configs[instanceId] || '! No config for ' + instanceId;

  // Highlight the selected item in the device list
  var items = document.querySelectorAll('.cfg-dev-item');
  items.forEach(function(item) {
    item.classList.toggle('active', item.getAttribute('data-id') === instanceId);
  });

  // Update the panel title + role dot
  var dev = STATE.devices.find(function(d) { return d.instanceId === instanceId; });
  var titleEl = document.getElementById('cfg-panel-title');
  var dotEl   = document.getElementById('cfg-role-dot');
  var RCOL = { 'super-spine':'#6366f1','spine':'#3b82f6','core':'#8b5cf6','distribution':'#a855f7','leaf':'#22c55e','access':'#14b8a6','firewall':'#f97316','wan-edge':'#eab308' };
  if (titleEl && dev) {
    var c = RCOL[dev.subLayer] || '#64748b';
    titleEl.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + ';margin-right:6px;vertical-align:middle;"></span>' + (dev.hostname || dev.id);
  }

  // Remember for download
  window._currentCfgId = instanceId;

  // Mobile: show the config panel, hide the device list
  var layout = document.getElementById('cfg-layout');
  if (layout) layout.classList.add('show-config');
}
window.showDeviceConfig = showDeviceConfig;

function cfgShowList() {
  var layout = document.getElementById('cfg-layout');
  if (layout) layout.classList.remove('show-config');
}
window.cfgShowList = cfgShowList;

function downloadConfig() {
  var id = window._currentCfgId;
  if (!id && STATE.devices.length) id = STATE.devices[0].instanceId;
  if (!id) return;
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

// ─── G-01: NLP Intent parse handler ──────────────────────────────────────────
window.parseIntent = function() {
  var ta = document.getElementById('nlp-intent-text');
  var res = document.getElementById('nlp-result');
  if (!ta || !ta.value.trim()) {
    showToast('Enter a description first', 'warning');
    return;
  }

  var text = ta.value.trim();
  var result = window.parseIntentHeuristic(text);
  var intent = result.intent;
  var conf   = result.confidence;

  if (!Object.keys(intent).length) {
    res.innerHTML = '<span class="nlp-err">Could not extract any fields. Try describing the use case, vendor names, protocol names, or server count.</span>';
    res.classList.add('visible');
    return;
  }

  var filled = window.fillFormFromIntent(intent, conf);

  // Build result chips
  var chips = filled.map(function(f) {
    var key = {
      'Site Name': 'siteName', 'Site Code': 'siteCode', 'Use Case': 'useCase',
      'Scale': 'scale', 'Redundancy': 'redundancy', 'Endpoint Count': 'endpointCount',
      'Bandwidth': 'bandwidth', 'Oversubscription': 'oversubscription',
      'Vendors': 'vendors', 'Underlay': 'underlay', 'Overlay': 'overlay',
      'Features': 'features', 'GPU Transport': 'gpuTransport'
    }[f] || f;
    var c = conf[key] || 'extracted';
    return '<span class="nlp-field-chip ' + c + '">' + f + '</span>';
  }).join('');

  res.innerHTML = '<strong style="font-size:12px;color:var(--text-dim);">AUTO-FILLED:</strong> ' + chips
    + '<br><span style="font-size:11px;color:var(--text-dim);margin-top:4px;display:block;">'
    + '<span style="color:var(--accent);font-weight:700;">●</span> Extracted from text &nbsp;'
    + '<span style="color:#818cf8;font-weight:700;">●</span> Inferred from context'
    + '</span>';
  res.classList.add('visible');

  showToast('Filled ' + filled.length + ' field' + (filled.length !== 1 ? 's' : ''), 'success');
};
