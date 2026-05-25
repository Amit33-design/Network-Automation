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

  // G-18: Multicast settings (only when multicast feature is checked)
  if (STATE.protocols.features.indexOf('multicast') !== -1) {
    var pimModeEl  = document.getElementById('sel-pim-mode');
    var rpAddrEl   = document.getElementById('inp-rp-addr');
    var mcGroupsEl = document.getElementById('inp-mc-groups');
    STATE.multicast = {
      mode:    pimModeEl  ? pimModeEl.value  : 'sparse',
      rp_ip:   rpAddrEl   ? rpAddrEl.value   : '10.0.0.254',
      groups:  mcGroupsEl ? mcGroupsEl.value : '239.0.0.0/8',
      igmp_version: 3
    };
  }

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
      '<div class="table-scroll"><table class="bom-table">' +
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
      '</table></div>' +
    '</div>';
}
window.renderCapacityMath = renderCapacityMath;

// renderTopologyDiagram is provided by hld_diagram.js (loaded before init.js)
function renderTopologyDiagram(state) {
  var useCase = state.useCase || 'dc';
  var devices = state.devices || [];

  // ── Node color palette ──────────────────────────────────────────────────────
  var NODE_COLORS = {
    'spine':               '#3b82f6',
    'super-spine':         '#6366f1',
    'leaf':                '#22c55e',
    'distribution':        '#a855f7',
    'access':              '#14b8a6',
    'firewall':            '#f97316',
    'wan-edge':            '#eab308',
    'pe-router':           '#6366f1',
    'p-router':            '#6366f1',
    'sdwan-controller':    '#64748b',
    'sdwan-orchestrator':  '#64748b',
    'cloud-transit':       '#64748b',
    'cloud-gw':            '#64748b',
    'fronthaul':           '#22c55e',
    'midhaul':             '#3b82f6',
    'storage-fabric':      '#6366f1',
    'storage-leaf':        '#22c55e'
  };

  var COLLAPSE_THRESHOLD = 6;
  var SVG_W = 800;

  function nodeColor(role) {
    return NODE_COLORS[role] || '#64748b';
  }

  function svgNode(cx, cy, w, h, label, role) {
    var c    = nodeColor(role);
    var x    = cx - w / 2;
    var y    = cy - h / 2;
    var fill = c + '22';
    var maxChars = Math.floor(w / 7);
    var disp = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4"'
      + ' fill="' + fill + '" stroke="' + c + '" stroke-width="1.5"/>'
      + '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" dominant-baseline="middle"'
      + ' font-family="monospace,sans-serif" font-size="11" fill="' + c + '" font-weight="600">' + disp + '</text>';
  }

  function svgCloud(cx, cy, w, h, label) {
    var x = cx - w / 2;
    var y = cy - h / 2;
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8"'
      + ' fill="#1e293b" stroke="#475569" stroke-width="1.5" stroke-dasharray="5,3"/>'
      + '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="middle"'
      + ' font-family="sans-serif" font-size="12" fill="#94a3b8" font-weight="600">' + label + '</text>';
  }

  function svgLine(x1, y1, x2, y2) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2
      + '" stroke="#4b5563" stroke-width="1.5"/>';
  }

  function svgRow(nodeList, cy, svgW, role, label) {
    var count = nodeList.length;
    if (count === 0) return { svgStr: '', centers: [], topY: cy - 16, botY: cy + 16 };

    var nodeW = 90, nodeH = 32, gapH = 10;

    if (count > COLLAPSE_THRESHOLD) {
      var collW = Math.min(svgW * 0.7, 300);
      var cx    = svgW / 2;
      var c     = nodeColor(role);
      var fill  = c + '22';
      var x     = cx - collW / 2;
      var y     = cy - nodeH / 2;
      var collLabel = count + '× ' + label;
      var svgStr = '<rect x="' + x + '" y="' + y + '" width="' + collW + '" height="' + nodeH + '" rx="4"'
        + ' fill="' + fill + '" stroke="' + c + '" stroke-width="1.5"/>'
        + '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" dominant-baseline="middle"'
        + ' font-family="monospace,sans-serif" font-size="11" fill="' + c + '" font-weight="600">' + collLabel + '</text>';
      var phantomCount = Math.min(count, 8);
      var step = collW / (phantomCount + 1);
      var centers = [];
      for (var i = 0; i < phantomCount; i++) {
        centers.push({ x: x + step * (i + 1), y: cy });
      }
      return { svgStr: svgStr, centers: centers, collapsed: true, topY: cy - nodeH / 2, botY: cy + nodeH / 2 };
    }

    var totalW = count * nodeW + (count - 1) * gapH;
    var startX = (svgW - totalW) / 2 + nodeW / 2;
    var svgStr2 = '';
    var centers2 = [];
    for (var j = 0; j < count; j++) {
      var cx2 = startX + j * (nodeW + gapH);
      svgStr2 += svgNode(cx2, cy, nodeW, nodeH, nodeList[j].hostname || nodeList[j].model || role, role);
      centers2.push({ x: cx2, y: cy });
    }
    return { svgStr: svgStr2, centers: centers2, topY: cy - nodeH / 2, botY: cy + nodeH / 2 };
  }

  function svgMesh(upperCenters, upperBotY, lowerCenters, lowerTopY) {
    if (!upperCenters.length || !lowerCenters.length) return '';
    var lines = '';
    var upCount = upperCenters.length;
    var fullMesh = (lowerCenters.length <= 4 && upCount <= 4);
    lowerCenters.forEach(function(lc) {
      if (fullMesh) {
        upperCenters.forEach(function(uc) {
          lines += svgLine(uc.x, upperBotY, lc.x, lowerTopY);
        });
      } else {
        var sorted = upperCenters.slice().sort(function(a, b) {
          return Math.abs(a.x - lc.x) - Math.abs(b.x - lc.x);
        });
        var take = Math.min(2, sorted.length);
        for (var k = 0; k < take; k++) {
          lines += svgLine(sorted[k].x, upperBotY, lc.x, lowerTopY);
        }
      }
    });
    return lines;
  }

  // ── DC / GPU ──────────────────────────────────────────────────────────────────
  function buildDcGpu() {
    var spines = devices.filter(function(d) { return d.subLayer === 'spine' || d.subLayer === 'super-spine'; });
    var leaves = devices.filter(function(d) { return d.subLayer === 'leaf'; });
    var fws    = devices.filter(function(d) { return d.subLayer === 'firewall'; });
    var endpointCount = (state.topology && state.topology.endpoint_count) || (leaves.length * 48);

    var svgParts = [];
    var cloudCy = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 240, 36, 'Internet / Core'));

    var nextY = cloudCy + 18;
    var fwBotCenters = [];
    if (fws.length) {
      nextY = cloudCy + 76;
      var fwRow = svgRow(fws, nextY, SVG_W, 'firewall', fws[0].model || 'Firewall');
      svgParts.push(fwRow.svgStr);
      fwRow.centers.forEach(function(fc) {
        svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, fc.x, fwRow.topY));
      });
      fwBotCenters = fwRow.centers;
      nextY = fwRow.botY;
    }

    var spineCy = nextY + 52;
    var spineRow = svgRow(spines.length ? spines : [{ hostname: 'No spines', subLayer: 'spine' }],
      spineCy, SVG_W, 'spine', spines.length ? (spines[0].model || 'Spine') : 'Spine');
    svgParts.push(spineRow.svgStr);

    if (fwBotCenters.length) {
      svgParts.push(svgMesh(fwBotCenters, fwBotCenters[0].y + 16, spineRow.centers, spineRow.topY));
    } else {
      spineRow.centers.forEach(function(sc) {
        svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, sc.x, spineRow.topY));
      });
    }

    var leafCy = spineCy + 76;
    var leafRow = svgRow(leaves.length ? leaves : [{ hostname: 'No leaves', subLayer: 'leaf' }],
      leafCy, SVG_W, 'leaf', leaves.length ? (leaves[0].model || 'Leaf') : 'Leaf');
    svgParts.push(leafRow.svgStr);
    svgParts.push(svgMesh(spineRow.centers, spineRow.botY, leafRow.centers, leafRow.topY));

    var barY = leafCy + 50;
    var barW = Math.min(SVG_W - 80, Math.max(200, leaves.length * 40));
    var barX = (SVG_W - barW) / 2;
    svgParts.push('<rect x="' + barX + '" y="' + barY + '" width="' + barW + '" height="22" rx="3"'
      + ' fill="#374151" stroke="#4b5563" stroke-width="1"/>');
    svgParts.push('<text x="' + (SVG_W / 2) + '" y="' + (barY + 11) + '" text-anchor="middle" dominant-baseline="middle"'
      + ' font-family="sans-serif" font-size="11" fill="#9ca3af">' + endpointCount + ' endpoints / servers</text>');
    var sampleLeaves = leafRow.collapsed
      ? leafRow.centers
      : leafRow.centers.filter(function(_, idx) { return idx % 2 === 0; });
    sampleLeaves.forEach(function(lc) {
      svgParts.push(svgLine(lc.x, leafRow.botY, lc.x, barY));
    });

    return { svg: svgParts.join(''), h: barY + 40 };
  }

  // ── Campus ────────────────────────────────────────────────────────────────────
  function buildCampus() {
    var dists = devices.filter(function(d) { return d.subLayer === 'distribution'; });
    var accs  = devices.filter(function(d) { return d.subLayer === 'access'; });
    var fws   = devices.filter(function(d) { return d.subLayer === 'firewall'; });

    var svgParts = [];
    var cloudCy = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 240, 36, 'Internet / Firewall'));

    var fwBotRef = { centers: [{ x: SVG_W / 2, y: cloudCy }], botY: cloudCy + 18 };
    if (fws.length) {
      var fwCy  = cloudCy + 66;
      var fwRow = svgRow(fws, fwCy, SVG_W, 'firewall', fws[0].model || 'FW');
      svgParts.push(fwRow.svgStr);
      fwRow.centers.forEach(function(fc) {
        svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, fc.x, fwRow.topY));
      });
      fwBotRef = fwRow;
    }

    var distCy  = fwBotRef.botY + 58;
    var distRow = svgRow(dists.length ? dists : [{ hostname: 'Dist-1', subLayer: 'distribution' }],
      distCy, SVG_W, 'distribution', dists.length ? (dists[0].model || 'Distribution') : 'Distribution');
    svgParts.push(distRow.svgStr);
    svgParts.push(svgMesh(fwBotRef.centers, fwBotRef.botY, distRow.centers, distRow.topY));

    var accCy  = distCy + 74;
    var accRow = svgRow(accs.length ? accs : [{ hostname: 'Acc-1', subLayer: 'access' }],
      accCy, SVG_W, 'access', accs.length ? (accs[0].model || 'Access') : 'Access');
    svgParts.push(accRow.svgStr);
    svgParts.push(svgMesh(distRow.centers, distRow.botY, accRow.centers, accRow.topY));

    return { svg: svgParts.join(''), h: accCy + 50 };
  }

  // ── WAN / SD-WAN ──────────────────────────────────────────────────────────────
  function buildWan() {
    var controllers   = devices.filter(function(d) { return d.subLayer === 'sdwan-controller'; });
    var orchestrators = devices.filter(function(d) { return d.subLayer === 'sdwan-orchestrator'; });
    var edges         = devices.filter(function(d) { return d.subLayer === 'wan-edge'; });

    var svgParts = [];
    var cloudCy = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 300, 36, 'WAN / SD-WAN Fabric'));

    var ctrlCy  = cloudCy + 70;
    var ctrlRow = svgRow(controllers.length ? controllers : [{ hostname: 'vSmart-1', subLayer: 'sdwan-controller' }],
      ctrlCy, SVG_W, 'sdwan-controller', controllers.length ? (controllers[0].model || 'vSmart') : 'vSmart');
    svgParts.push(ctrlRow.svgStr);
    ctrlRow.centers.forEach(function(cc) {
      svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, cc.x, ctrlRow.topY));
    });

    var orchRow = null;
    if (orchestrators.length) {
      var orchCy = ctrlCy + 64;
      orchRow = svgRow(orchestrators, orchCy, SVG_W, 'sdwan-orchestrator', orchestrators[0].model || 'vBond');
      svgParts.push(orchRow.svgStr);
      svgParts.push(svgMesh(ctrlRow.centers, ctrlRow.botY, orchRow.centers, orchRow.topY));
    }

    var connectFrom = orchRow || ctrlRow;
    var edgeCy  = connectFrom.botY + 64;
    var edgeRow = svgRow(edges.length ? edges : [{ hostname: 'WAN-Edge-1', subLayer: 'wan-edge' }],
      edgeCy, SVG_W, 'wan-edge', edges.length ? (edges[0].model || 'WAN Edge') : 'WAN Edge');
    svgParts.push(edgeRow.svgStr);
    svgParts.push(svgMesh(connectFrom.centers, connectFrom.botY, edgeRow.centers, edgeRow.topY));

    return { svg: svgParts.join(''), h: edgeCy + 50 };
  }

  // ── SP MPLS ───────────────────────────────────────────────────────────────────
  function buildSpMpls() {
    var peRouters = devices.filter(function(d) { return d.subLayer === 'pe-router'; });
    var pRouters  = devices.filter(function(d) { return d.subLayer === 'p-router'; });

    var svgParts = [];
    var cloudCy = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 280, 36, 'MPLS Core / Internet'));

    var pCy  = cloudCy + 70;
    var pRow = svgRow(pRouters.length ? pRouters : [{ hostname: 'P-1', subLayer: 'p-router' }],
      pCy, SVG_W, 'p-router', pRouters.length ? (pRouters[0].model || 'P Router') : 'P Router');
    svgParts.push(pRow.svgStr);
    pRow.centers.forEach(function(pc) {
      svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, pc.x, pRow.topY));
    });

    var peCy  = pCy + 72;
    var peRow = svgRow(peRouters.length ? peRouters : [{ hostname: 'PE-1', subLayer: 'pe-router' }],
      peCy, SVG_W, 'pe-router', peRouters.length ? (peRouters[0].model || 'PE Router') : 'PE Router');
    svgParts.push(peRow.svgStr);
    svgParts.push(svgMesh(pRow.centers, pRow.botY, peRow.centers, peRow.topY));

    return { svg: svgParts.join(''), h: peCy + 50 };
  }

  // ── Multi-site ────────────────────────────────────────────────────────────────
  function buildMultisite() {
    var sites         = Math.max(1, parseInt((state.org && state.org.sites) || 1));
    var perSiteSpines = (state.perSiteDevices && state.perSiteDevices.spine) || 2;
    var perSiteLeaves = (state.perSiteDevices && state.perSiteDevices.leaf)  || 4;
    var showSpines    = Math.min(perSiteSpines, 3);
    var showLeaves    = Math.min(perSiteLeaves, 4);

    var svgParts = [];
    var cloudCy  = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 300, 36, 'WAN / DCI'));

    var siteCount  = Math.min(sites, 6);
    var siteBoxW   = Math.min(130, Math.floor((SVG_W - 40) / siteCount));
    var siteBoxH   = 148;
    var sitePad    = 10;
    var totalSiteW = siteCount * siteBoxW + (siteCount - 1) * sitePad;
    var siteStartX = (SVG_W - totalSiteW) / 2;
    var siteTopY   = cloudCy + 50;

    var spineColor = nodeColor('spine');
    var leafColor  = nodeColor('leaf');

    for (var s = 0; s < siteCount; s++) {
      var sx        = siteStartX + s * (siteBoxW + sitePad);
      var siteLabel = (state.siteCode || 'SITE') + (s + 1);
      var innerW    = siteBoxW - 16;
      var spineY    = siteTopY + 38;
      var leafY     = siteTopY + 88;
      var spNodeW   = Math.max(22, Math.floor(innerW / showSpines) - 4);
      var lfNodeW   = Math.max(18, Math.floor(innerW / showLeaves) - 3);
      var spineH    = 20;
      var leafH     = 18;

      svgParts.push('<rect x="' + sx + '" y="' + siteTopY + '" width="' + siteBoxW + '" height="' + siteBoxH + '" rx="6"'
        + ' fill="#1e293b" stroke="#334155" stroke-width="1.5"/>');
      svgParts.push('<text x="' + (sx + siteBoxW / 2) + '" y="' + (siteTopY + 14) + '" text-anchor="middle"'
        + ' font-family="sans-serif" font-size="10" fill="#64748b" font-weight="700">' + siteLabel + '</text>');

      var spineCenters = [];
      for (var si = 0; si < showSpines; si++) {
        var scx   = sx + 8 + (si + 0.5) * (innerW / showSpines);
        var spFill = spineColor + '33';
        svgParts.push('<rect x="' + (scx - spNodeW / 2) + '" y="' + (spineY - spineH / 2) + '" width="' + spNodeW + '" height="' + spineH + '" rx="3"'
          + ' fill="' + spFill + '" stroke="' + spineColor + '" stroke-width="1"/>');
        spineCenters.push({ x: scx, y: spineY });
      }
      if (showSpines < perSiteSpines) {
        svgParts.push('<text x="' + (sx + siteBoxW / 2) + '" y="' + (spineY + 14) + '" text-anchor="middle"'
          + ' font-family="sans-serif" font-size="8" fill="' + spineColor + '">' + perSiteSpines + '× spine</text>');
      }

      var leafCenters = [];
      for (var li = 0; li < showLeaves; li++) {
        var lcx   = sx + 8 + (li + 0.5) * (innerW / showLeaves);
        var lfFill = leafColor + '33';
        svgParts.push('<rect x="' + (lcx - lfNodeW / 2) + '" y="' + (leafY - leafH / 2) + '" width="' + lfNodeW + '" height="' + leafH + '" rx="3"'
          + ' fill="' + lfFill + '" stroke="' + leafColor + '" stroke-width="1"/>');
        leafCenters.push({ x: lcx, y: leafY });
      }
      if (showLeaves < perSiteLeaves) {
        svgParts.push('<text x="' + (sx + siteBoxW / 2) + '" y="' + (leafY + 16) + '" text-anchor="middle"'
          + ' font-family="sans-serif" font-size="8" fill="' + leafColor + '">' + perSiteLeaves + '× leaf</text>');
      }

      spineCenters.forEach(function(sc) {
        leafCenters.forEach(function(lc) {
          svgParts.push('<line x1="' + sc.x + '" y1="' + (spineY + spineH / 2) + '" x2="' + lc.x + '" y2="' + (leafY - leafH / 2) + '"'
            + ' stroke="#334155" stroke-width="0.8"/>');
        });
      });

      svgParts.push(svgLine(sx + siteBoxW / 2, cloudCy + 18, sx + siteBoxW / 2, siteTopY));
    }

    if (sites > 6) {
      var overflowX = siteStartX + siteCount * (siteBoxW + sitePad) + 6;
      svgParts.push('<text x="' + overflowX + '" y="' + (siteTopY + siteBoxH / 2) + '"'
        + ' font-family="sans-serif" font-size="12" fill="#64748b">+' + (sites - 6) + ' more</text>');
    }

    return { svg: svgParts.join(''), h: siteTopY + siteBoxH + 30 };
  }

  // ── Storage ───────────────────────────────────────────────────────────────────
  function buildStorage() {
    var fabricDevs = devices.filter(function(d) { return d.subLayer === 'storage-fabric'; });
    var leafDevs   = devices.filter(function(d) { return d.subLayer === 'storage-leaf'; });

    var svgParts = [];
    var cloudCy  = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 280, 36, 'Storage Network / SAN'));

    var fabCy  = cloudCy + 70;
    var fabRow = svgRow(fabricDevs.length ? fabricDevs : [{ hostname: 'SAN-Fab-1', subLayer: 'storage-fabric' }],
      fabCy, SVG_W, 'storage-fabric', fabricDevs.length ? (fabricDevs[0].model || 'SAN Fabric') : 'SAN Fabric');
    svgParts.push(fabRow.svgStr);
    fabRow.centers.forEach(function(fc) {
      svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, fc.x, fabRow.topY));
    });

    var leafCy  = fabCy + 72;
    var leafRow = svgRow(leafDevs.length ? leafDevs : [{ hostname: 'SAN-Leaf-1', subLayer: 'storage-leaf' }],
      leafCy, SVG_W, 'storage-leaf', leafDevs.length ? (leafDevs[0].model || 'Storage Leaf') : 'Storage Leaf');
    svgParts.push(leafRow.svgStr);
    svgParts.push(svgMesh(fabRow.centers, fabRow.botY, leafRow.centers, leafRow.topY));

    return { svg: svgParts.join(''), h: leafCy + 50 };
  }

  // ── Private 5G / O-RAN ────────────────────────────────────────────────────────
  function buildPrivate5g() {
    var fhDevs = devices.filter(function(d) { return d.subLayer === 'fronthaul'; });
    var mhDevs = devices.filter(function(d) { return d.subLayer === 'midhaul'; });

    var svgParts = [];
    var cloudCy  = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 280, 36, '5G Core / O-Cloud'));

    var mhCy  = cloudCy + 70;
    var mhRow = svgRow(mhDevs.length ? mhDevs : [{ hostname: 'MH-1', subLayer: 'midhaul' }],
      mhCy, SVG_W, 'midhaul', mhDevs.length ? (mhDevs[0].model || 'Midhaul') : 'Midhaul');
    svgParts.push(mhRow.svgStr);
    mhRow.centers.forEach(function(mc) {
      svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, mc.x, mhRow.topY));
    });

    var fhCy  = mhCy + 72;
    var fhRow = svgRow(fhDevs.length ? fhDevs : [{ hostname: 'FH-1', subLayer: 'fronthaul' }],
      fhCy, SVG_W, 'fronthaul', fhDevs.length ? (fhDevs[0].model || 'Fronthaul') : 'Fronthaul');
    svgParts.push(fhRow.svgStr);
    svgParts.push(svgMesh(mhRow.centers, mhRow.botY, fhRow.centers, fhRow.topY));

    return { svg: svgParts.join(''), h: fhCy + 50 };
  }

  // ── Multicloud / Aviatrix ─────────────────────────────────────────────────────
  function buildMulticloud() {
    var transits = devices.filter(function(d) { return d.subLayer === 'cloud-transit'; });
    var gws      = devices.filter(function(d) { return d.subLayer === 'cloud-gw'; });

    var svgParts = [];
    var cloudCy  = 44;
    svgParts.push(svgCloud(SVG_W / 2, cloudCy, 300, 36, 'Cloud Providers (AWS / Azure / GCP)'));

    var trCy  = cloudCy + 70;
    var trRow = svgRow(transits.length ? transits : [{ hostname: 'Transit-1', subLayer: 'cloud-transit' }],
      trCy, SVG_W, 'cloud-transit', transits.length ? (transits[0].model || 'Transit') : 'Transit GW');
    svgParts.push(trRow.svgStr);
    trRow.centers.forEach(function(tc) {
      svgParts.push(svgLine(SVG_W / 2, cloudCy + 18, tc.x, trRow.topY));
    });

    var gwCy  = trCy + 72;
    var gwRow = svgRow(gws.length ? gws : [{ hostname: 'GW-1', subLayer: 'cloud-gw' }],
      gwCy, SVG_W, 'cloud-gw', gws.length ? (gws[0].model || 'Cloud GW') : 'Cloud GW');
    svgParts.push(gwRow.svgStr);
    svgParts.push(svgMesh(trRow.centers, trRow.botY, gwRow.centers, gwRow.topY));

    return { svg: svgParts.join(''), h: gwCy + 50 };
  }

  // ── Legend ────────────────────────────────────────────────────────────────────
  function buildLegend(legendEntries, topY) {
    var itemW = 130, itemH = 20, cols = 4;
    var svgStr = '';
    legendEntries.forEach(function(entry, idx) {
      var col = idx % cols;
      var row = Math.floor(idx / cols);
      var lx  = 20 + col * itemW;
      var ly  = topY + row * (itemH + 4);
      var nc  = nodeColor(entry.role);
      svgStr += '<rect x="' + lx + '" y="' + (ly - 6) + '" width="14" height="14" rx="2"'
        + ' fill="' + nc + '33" stroke="' + nc + '" stroke-width="1.2"/>';
      svgStr += '<text x="' + (lx + 20) + '" y="' + (ly + 1) + '"'
        + ' font-family="sans-serif" font-size="11" fill="#94a3b8">' + entry.label + '</text>';
    });
    return svgStr;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────────
  var result;
  var legendEntries = [];

  if (useCase === 'multisite') {
    result = buildMultisite();
    legendEntries = [
      { role: 'spine',    label: 'Spine' },
      { role: 'leaf',     label: 'Leaf' },
      { role: 'wan-edge', label: 'WAN Edge' }
    ];
  } else if (useCase === 'campus') {
    result = buildCampus();
    legendEntries = [
      { role: 'distribution', label: 'Distribution' },
      { role: 'access',       label: 'Access' },
      { role: 'firewall',     label: 'Firewall' }
    ];
  } else if (useCase === 'wan') {
    result = buildWan();
    legendEntries = [
      { role: 'sdwan-controller',   label: 'vSmart' },
      { role: 'sdwan-orchestrator', label: 'vBond' },
      { role: 'wan-edge',           label: 'WAN Edge' }
    ];
  } else if (useCase === 'sp_mpls') {
    result = buildSpMpls();
    legendEntries = [
      { role: 'p-router',  label: 'P Router' },
      { role: 'pe-router', label: 'PE Router' }
    ];
  } else if (useCase === 'storage') {
    result = buildStorage();
    legendEntries = [
      { role: 'storage-fabric', label: 'SAN Fabric' },
      { role: 'storage-leaf',   label: 'Storage Leaf' }
    ];
  } else if (useCase === 'private_5g') {
    result = buildPrivate5g();
    legendEntries = [
      { role: 'midhaul',   label: 'Midhaul' },
      { role: 'fronthaul', label: 'Fronthaul' }
    ];
  } else if (useCase === 'multicloud' || useCase === 'aviatrix') {
    result = buildMulticloud();
    legendEntries = [
      { role: 'cloud-transit', label: 'Transit GW' },
      { role: 'cloud-gw',      label: 'Cloud GW' }
    ];
  } else {
    result = buildDcGpu();
    legendEntries = [
      { role: 'spine',    label: 'Spine' },
      { role: 'leaf',     label: 'Leaf' },
      { role: 'firewall', label: 'Firewall' }
    ];
  }

  var legendTopY = result.h + 8;
  var legendRows = Math.ceil(legendEntries.length / 4);
  var totalH     = legendTopY + legendRows * 24 + 12;

  var svgEl = '<svg viewBox="0 0 ' + SVG_W + ' ' + totalH + '"'
    + ' width="100%" style="max-width:900px;display:block;margin:0 auto;"'
    + ' xmlns="http://www.w3.org/2000/svg">'
    + result.svg
    + buildLegend(legendEntries, legendTopY)
    + '</svg>';

  var label = (useCase || '').replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  return '<div style="text-align:center;margin-bottom:8px;font-size:13px;color:var(--text-dim);font-weight:600;">'
    + label + ' — High-Level Design</div>'
    + svgEl;
}
// window.renderTopologyDiagram is set by hld_diagram.js; do not overwrite here.

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

  // G-45: store devices for sort/filter
  window._bomAllDevices = (STATE.devices || []).slice();
  window._bomSort  = { col: null, dir: 1 };
  window._bomQuery = '';

  var container = document.getElementById('bom-output');
  if (!container) return;

  var sortCols = ['hostname','model','subLayer','vendor','speed'];
  var thLabels = ['Hostname','Model','Role','Vendor','Speed','Location'];
  var headerCells = sortCols.map(function(col, i) {
    return '<th class="bom-sort-th" data-col="' + col + '" onclick="window.bomSortBy(\'' + col + '\')">'
      + thLabels[i] + '<span class="bom-sort-arrow"></span></th>';
  }).join('') + '<th>' + thLabels[5] + '</th>';

  var deviceSection = '<div style="margin-top:28px;margin-bottom:10px;display:flex;align-items:baseline;gap:12px;">'
    + '<h3 style="font-size:14px;font-weight:700;color:var(--text);">Device Inventory</h3>'
    + '<span id="bom-device-count" style="font-size:12px;color:var(--text-dim);">' + (STATE.devices||[]).length + ' devices</span>'
    + '</div>'
    + '<div class="bom-filter-bar">'
    + '<input id="bom-filter-input" class="bom-filter-input" type="text" placeholder="Filter by hostname, model, role, vendor…" oninput="window.bomFilter()">'
    + '</div>'
    + '<div class="table-scroll">'
    + '<table class="bom-table"><thead><tr>' + headerCells + '</tr></thead>'
    + '<tbody id="bom-device-tbody"></tbody></table></div>';

  var lcBanner = window.renderLifecycleBanner ? window.renderLifecycleBanner(STATE.devices) : '';
  container.innerHTML = lcBanner + '<div class="table-scroll">' + html + '</div>' + deviceSection;
  // G-45: populate the sortable/filterable tbody now that the DOM exists
  window.bomRenderTable();

  // Cabling tab
  var cableOut = document.getElementById('cabling-output');
  if (cableOut) {
    cableOut.innerHTML = '<div class="table-scroll">' + window.renderCablingTable(STATE.cabling) + '</div>';
  }

  // Optics tab
  var opticsOut = document.getElementById('optics-output');
  if (opticsOut && window.recommendOptics) {
    window.recommendOptics(STATE.cabling, STATE.devices, STATE);
    opticsOut.innerHTML = '<div class="table-scroll">' + window.renderOpticsTable(STATE.optics) + '</div>';
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

  // HLD Topology Diagram
  var hldOut = document.getElementById('topo-hld-output');
  if (hldOut) {
    hldOut.innerHTML = renderTopologyDiagram(STATE);
    // G-43: init pan/zoom after SVG is in DOM
    if (window.initHLDInteraction) window.initHLDInteraction();
  }

  // G-38: BGP convergence predictor (updates when devices are built)
  var convOut = document.getElementById('convergence-content');
  if (convOut && window.renderConvergencePredictor) convOut.innerHTML = window.renderConvergencePredictor(STATE);

  showToast('BOM generated: ' + STATE.devices.length + ' devices', 'success');
}
window.renderStep2 = renderStep2;

// ─── BOM Export ───────────────────────────────────────────────────────────────

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

  // G-35: Anomaly detection tab
  var anomalyOut = document.getElementById('mon-anomaly-content');
  if (anomalyOut && window.renderAnomalyPanel) anomalyOut.innerHTML = window.renderAnomalyPanel(STATE);

  showToast('Monitoring config generated', 'success');
}
window.renderMonitoring = renderMonitoring;

function renderJinjaPane() {
  _renderJinjaContent();
}
function _renderJinjaContent() {
  var out = document.getElementById('jinja-engine-content');
  if (!out) return;
  if (!STATE.devices || !STATE.devices.length) {
    out.innerHTML = '<p class="empty-state">Complete Step 1 first to generate the Jinja2 inventory and templates.</p>';
    return;
  }
  if (window.renderJinjaEnginePane) {
    out.innerHTML = window.renderJinjaEnginePane(STATE);
  }
}
window.renderJinjaPane = renderJinjaPane;

// Tools symptom search — mirrors Step 5 but uses separate input IDs
window.updateToolsSymptomResults = function() {
  if (window.updateSymptomResults) {
    // Temporarily swap IDs so shared logic reads our inputs
    var q  = document.getElementById('tools-symptom-query');
    var c  = document.getElementById('tools-symptom-cat');
    var r  = document.getElementById('tools-symptom-results');
    var q2 = document.getElementById('symptom-query');
    var c2 = document.getElementById('symptom-cat');
    var r2 = document.getElementById('symptom-results');
    if (!q || !c || !r) return;
    // Manually run the same render logic
    var query = q.value.toLowerCase().trim();
    var cat   = c.value;
    var db    = window.SYMPTOM_DB || [];
    var hits  = db.filter(function(s) {
      return (cat === 'All' || s.category === cat) &&
        (!query || s.symptom.toLowerCase().includes(query) ||
         (s.keywords || []).some(function(k) { return k.toLowerCase().includes(query); }) ||
         (s.category || '').toLowerCase().includes(query));
    });
    if (!hits.length) {
      r.innerHTML = '<p class="empty-state">No symptoms matched. Try a broader search.</p>';
      return;
    }
    r.innerHTML = hits.slice(0, 20).map(function(s) {
      return '<div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;">'
        + '<div style="font-weight:600;margin-bottom:4px;">' + s.symptom + '</div>'
        + '<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Category: ' + s.category + '</div>'
        + (s.commands ? '<pre class="config-pre" style="margin:0;font-size:11px;">' + s.commands.join('\n') + '</pre>' : '')
        + '</div>';
    }).join('');
  }
};

// Approvals
var _changeRequests = [];
window.submitChangeRequest = function() {
  var title  = (document.getElementById('appr-title')  || {}).value || '';
  var window_ = (document.getElementById('appr-window') || {}).value || '';
  var risk   = (document.getElementById('appr-risk')   || {}).value || 'medium';
  var desc   = (document.getElementById('appr-desc')   || {}).value || '';
  var emails = (document.getElementById('appr-emails') || {}).value || '';
  if (!title) { showToast('Enter a change title', 'warning'); return; }
  var cr = {
    id: 'CR-' + Date.now(),
    title: title,
    window: window_,
    risk: risk,
    desc: desc,
    approvers: emails.split(',').map(function(e) { return e.trim(); }).filter(Boolean),
    status: 'PENDING',
    created: new Date().toISOString(),
    site: STATE.siteCode || 'SITE'
  };
  _changeRequests.push(cr);
  _renderApprBoard();
  showToast('Change request ' + cr.id + ' submitted', 'success');
};
window.exportChangeRecord = function() {
  if (!_changeRequests.length) { showToast('No change requests to export', 'warning'); return; }
  downloadFile('change-records-' + (STATE.siteCode || 'site').toLowerCase() + '.json',
    JSON.stringify(_changeRequests, null, 2), 'application/json');
  showToast('Change records exported', 'success');
};
window.approveChange = function(id) {
  var cr = _changeRequests.find(function(c) { return c.id === id; });
  if (cr) { cr.status = 'APPROVED'; cr.approvedAt = new Date().toISOString(); _renderApprBoard(); showToast(id + ' approved', 'success'); }
};
window.rejectChange = function(id) {
  var cr = _changeRequests.find(function(c) { return c.id === id; });
  if (cr) { cr.status = 'REJECTED'; cr.rejectedAt = new Date().toISOString(); _renderApprBoard(); showToast(id + ' rejected', 'warning'); }
};
function _renderApprBoard() {
  var board = document.getElementById('appr-board');
  if (!board) return;
  if (!_changeRequests.length) { board.innerHTML = '<p class="empty-state">No change requests submitted yet.</p>'; return; }
  var riskColor = { low: 'var(--success)', medium: 'var(--warning)', high: '#f97316', critical: 'var(--danger)' };
  board.innerHTML = _changeRequests.map(function(cr) {
    var col = riskColor[cr.risk] || 'var(--text-dim)';
    return '<div style="border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:10px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
      + '<span style="font-weight:700;">' + cr.id + '</span>'
      + '<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:' + col + '22;color:' + col + ';font-weight:600;">' + cr.risk.toUpperCase() + '</span>'
      + '<span style="font-size:11px;margin-left:auto;color:var(--text-dim);">' + cr.status + '</span>'
      + '</div>'
      + '<div style="font-weight:600;margin-bottom:4px;">' + cr.title + '</div>'
      + (cr.window ? '<div style="font-size:12px;color:var(--text-dim);">Window: ' + cr.window + '</div>' : '')
      + (cr.approvers.length ? '<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Approvers: ' + cr.approvers.join(', ') + '</div>' : '')
      + (cr.status === 'PENDING' ? '<div style="margin-top:10px;display:flex;gap:8px;">'
          + '<button class="btn btn-secondary btn-sm" style="color:var(--success);border-color:var(--success);" onclick="window.approveChange(\'' + cr.id + '\')">Approve</button>'
          + '<button class="btn btn-secondary btn-sm" style="color:var(--danger);border-color:var(--danger);" onclick="window.rejectChange(\'' + cr.id + '\')">Reject</button>'
          + '</div>' : '')
      + '</div>';
  }).join('');
}

// Integrations — browser-side fetch stubs (user supplies endpoint URLs + tokens)
function _intLog(msg, ok) {
  var log = document.getElementById('int-log');
  if (log) log.innerHTML = '<span style="color:' + (ok ? 'var(--success)' : 'var(--danger)') + ';">' + msg + '</span>';
}
window.intSlackTest = function() {
  var url = (document.getElementById('int-slack-url') || {}).value || '';
  if (!url) { showToast('Enter Slack webhook URL', 'warning'); return; }
  fetch(url, { method:'POST', body: JSON.stringify({ text: 'NetDesign AI: connection test from ' + (STATE.siteCode || 'SITE') }) })
    .then(function(r) { _intLog('Slack: ' + (r.ok ? 'OK' : 'HTTP ' + r.status), r.ok); })
    .catch(function(e) { _intLog('Slack error: ' + e.message, false); });
};
window.intSlackSend = function(type) {
  var url = (document.getElementById('int-slack-url') || {}).value || '';
  if (!url) { showToast('Enter Slack webhook URL', 'warning'); return; }
  var text = type === 'bom'
    ? '*BOM Summary — ' + (STATE.siteCode || 'SITE') + '*\nDevices: ' + (STATE.devices || []).length + ' | Generated by NetDesign AI'
    : '*Change Record* — ' + (_changeRequests.length ? _changeRequests[_changeRequests.length-1].id : 'none') + '\nSite: ' + (STATE.siteCode || 'SITE');
  fetch(url, { method:'POST', body: JSON.stringify({ text: text }) })
    .then(function(r) { _intLog('Slack: sent ' + type + (r.ok ? '' : ' — HTTP ' + r.status), r.ok); showToast('Slack message sent', 'success'); })
    .catch(function(e) { _intLog('Slack error: ' + e.message, false); });
};
window.intSnowCreate = function(type) {
  var url   = ((document.getElementById('int-snow-url')   || {}).value || '').replace(/\/$/, '');
  var token = (document.getElementById('int-snow-token') || {}).value || '';
  if (!url || !token) { showToast('Enter ServiceNow URL and token', 'warning'); return; }
  var endpoint = url + (type === 'change' ? '/api/now/table/change_request' : '/api/now/table/incident');
  var body = type === 'change'
    ? { short_description: 'Network change — ' + (STATE.siteCode || 'SITE'), description: 'Generated by NetDesign AI', risk: '3' }
    : { short_description: 'Network incident — ' + (STATE.siteCode || 'SITE'), urgency: '2', impact: '2' };
  fetch(endpoint, { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(body) })
    .then(function(r) { return r.json().then(function(j) { _intLog('ServiceNow: ' + (j.result ? j.result.number || 'created' : 'error'), r.ok); }); })
    .catch(function(e) { _intLog('ServiceNow error: ' + e.message, false); });
};
window.intJiraCreate = function(type) {
  var url   = ((document.getElementById('int-jira-url')   || {}).value || '').replace(/\/$/, '');
  var token = (document.getElementById('int-jira-token') || {}).value || '';
  var proj  = (document.getElementById('int-jira-proj')  || {}).value || 'NET';
  if (!url || !token) { showToast('Enter Jira URL and token', 'warning'); return; }
  var body = { fields:{ project:{ key:proj }, summary:'Network ' + type + ' — ' + (STATE.siteCode || 'SITE'), issuetype:{ name: type === 'change' ? 'Task' : 'Task' }, description:{ type:'doc', version:1, content:[{ type:'paragraph', content:[{ type:'text', text:'Generated by NetDesign AI' }] }] } } };
  fetch(url + '/rest/api/3/issue', { method:'POST', headers:{ Authorization:'Basic '+btoa('ndal:'+token), 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify(body) })
    .then(function(r) { return r.json().then(function(j) { _intLog('Jira: ' + (j.key || 'error'), r.ok); }); })
    .catch(function(e) { _intLog('Jira error: ' + e.message, false); });
};
window.intGitHubCommit = function() {
  var repo   = (document.getElementById('int-gh-repo')   || {}).value || '';
  var token  = (document.getElementById('int-gh-token')  || {}).value || '';
  var branch = (document.getElementById('int-gh-branch') || {}).value || 'main';
  if (!repo || !token) { showToast('Enter GitHub repo and token', 'warning'); return; }
  var inv = window.genJinjaInventory ? window.genJinjaInventory(STATE) : '{}';
  var content = btoa(unescape(encodeURIComponent(inv)));
  fetch('https://api.github.com/repos/' + repo + '/contents/inventory.json', {
    method:'PUT', headers:{ Authorization:'token '+token, 'Content-Type':'application/json' },
    body:JSON.stringify({ message:'chore: update inventory from NetDesign AI [' + (STATE.siteCode||'SITE') + ']', content:content, branch:branch })
  }).then(function(r) { _intLog('GitHub: ' + (r.ok ? 'committed inventory.json' : 'HTTP '+r.status), r.ok); showToast('Committed to GitHub', r.ok ? 'success' : 'error'); })
    .catch(function(e) { _intLog('GitHub error: ' + e.message, false); });
};
window.intGitHubPR = function() {
  var repo   = (document.getElementById('int-gh-repo')   || {}).value || '';
  var token  = (document.getElementById('int-gh-token')  || {}).value || '';
  var branch = (document.getElementById('int-gh-branch') || {}).value || 'main';
  if (!repo || !token) { showToast('Enter GitHub repo and token', 'warning'); return; }
  fetch('https://api.github.com/repos/' + repo + '/pulls', {
    method:'POST', headers:{ Authorization:'token '+token, 'Content-Type':'application/json' },
    body:JSON.stringify({ title:'NetDesign AI — ' + (STATE.siteCode||'SITE') + ' config update', body:'Auto-generated by NetDesign AI.\n\nInventory and configs attached.', head:branch, base:'main' })
  }).then(function(r) { return r.json().then(function(j) { _intLog('GitHub PR: ' + (j.html_url || 'error'), r.ok); }); })
    .catch(function(e) { _intLog('GitHub error: ' + e.message, false); });
};
window.intNetBoxSync = function(type) {
  var url   = ((document.getElementById('int-nb-url')   || {}).value || '').replace(/\/$/, '');
  var token = (document.getElementById('int-nb-token') || {}).value || '';
  if (!url || !token) { showToast('Enter NetBox URL and token', 'warning'); return; }
  if (type === 'devices') {
    var devs = (STATE.devices || []).map(function(d) {
      return { name: d.hostname, device_type:{ model: d.model || 'Unknown' }, device_role:{ name: d.subLayer || 'leaf' }, site:{ name: STATE.siteCode || 'SITE' }, status:'active' };
    });
    var results = devs.map(function(d) {
      return fetch(url + '/api/dcim/devices/', { method:'POST', headers:{ Authorization:'Token '+token, 'Content-Type':'application/json' }, body:JSON.stringify(d) })
        .then(function(r) { return r.ok; });
    });
    Promise.all(results).then(function(oks) { _intLog('NetBox: synced ' + oks.filter(Boolean).length + '/' + devs.length + ' devices', true); showToast('NetBox devices synced', 'success'); })
      .catch(function(e) { _intLog('NetBox error: ' + e.message, false); });
  } else {
    _intLog('NetBox prefix sync — configure IP pools in Step 1 first', false);
  }
};

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

  // G-32: OS image management tab
  var imgOut = document.getElementById('ztp-image-content');
  if (imgOut && window.renderZtpImageTab) imgOut.innerHTML = window.renderZtpImageTab(STATE);

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
  // G-44: apply syntax highlighting to the initially-shown config
  var initialPre = document.getElementById('cfg-output');
  if (initialPre && window.applyConfigHighlight) {
    var firstDev = STATE.devices[0];
    var firstCfg = firstDev ? (STATE.configs[firstDev.instanceId] || '') : '';
    if (firstCfg) window.applyConfigHighlight(initialPre, firstCfg);
  }
  // Set initial device for download
  window._currentCfgId = STATE.devices[0] ? STATE.devices[0].instanceId : null;
  showToast('Configs generated for ' + STATE.devices.length + ' devices', 'success');
}
window.renderStep3 = renderStep3;

function showDeviceConfig(instanceId) {
  var pre = document.getElementById('cfg-output');
  if (!pre) return;
  var cfgText = STATE.configs[instanceId] || '! No config for ' + instanceId;
  window.applyConfigHighlight(pre, cfgText);

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

// ─── G-44: Network CLI Syntax Highlighting ────────────────────────────────────
window.highlightNetCLI = function(text) {
  // Escape HTML first, then apply semantic spans
  var h = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply patterns top-to-bottom (order matters)
  // 1. Comments: lines starting with ! or #
  h = h.replace(/^([!#].*)$/gm, '<span class="cli-comment">$1</span>');
  // 2. "no " prefix (negative commands)
  h = h.replace(/^(\s*)(no )(.*)$/gm, '$1<span class="cli-no">$2</span>$3');
  // 3. VRF context names
  h = h.replace(/(vrf\s+(?:context|member|definition)\s+)(\S+)/gi, '$1<span class="cli-vrf">$2</span>');
  // 4. Interface names
  h = h.replace(/\b((?:interface|source-interface)\s+)([\w\/\.]+)/gi, '$1<span class="cli-iface">$2</span>');
  // 5. Major block keywords
  h = h.replace(/\b(router bgp|router ospf|router isis|route-map|policy-map|class-map|address-family|ip prefix-list|ipv6 prefix-list|template peer|peer-group|nv overlay evpn|feature|vlan|evpn|nve interface|interface nve|vrf context|ip community-list)\b/gi,
    '<span class="cli-keyword">$1</span>');
  // 6. IPv4 addresses and prefixes
  h = h.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/g, '<span class="cli-ip">$1</span>');
  // 7. IPv6 addresses (simplified)
  h = h.replace(/\b((?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}(?:\/\d{1,3})?)\b/g, '<span class="cli-ip">$1</span>');
  // 8. Quoted strings
  h = h.replace(/"([^"]*)"/g, '"<span class="cli-string">$1</span>"');
  // 9. Standalone numbers (not inside IPs already marked)
  h = h.replace(/(?<![.\d])\b(\d+)\b(?![.\d])/g, '<span class="cli-num">$1</span>');

  return h;
};

// Apply highlighting to an element; falls back to textContent on error
window.applyConfigHighlight = function(pre, text) {
  try {
    pre.innerHTML = window.highlightNetCLI(text);
  } catch (e) {
    pre.textContent = text;
  }
};

// ─── G-45: BOM Device Table Sort/Filter ───────────────────────────────────────
window._bomSort  = { col: null, dir: 1 };
window._bomQuery = '';

window.bomFilter = function() {
  var inp = document.getElementById('bom-filter-input');
  window._bomQuery = inp ? inp.value.toLowerCase() : '';
  window.bomRenderTable();
};

window.bomSortBy = function(col) {
  if (window._bomSort.col === col) {
    window._bomSort.dir *= -1;
  } else {
    window._bomSort.col = col;
    window._bomSort.dir = 1;
  }
  window.bomRenderTable();
};

window.bomRenderTable = function() {
  var tbody = document.getElementById('bom-device-tbody');
  var ths   = document.querySelectorAll('.bom-sort-th');
  if (!tbody) return;

  // Update sort indicators
  ths.forEach(function(th) {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.getAttribute('data-col') === window._bomSort.col) {
      th.classList.add(window._bomSort.dir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });

  var q    = window._bomQuery;
  var col  = window._bomSort.col;
  var dir  = window._bomSort.dir;
  var devs = (window._bomAllDevices || []).filter(function(d) {
    if (!q) return true;
    return (d.hostname + ' ' + d.model + ' ' + d.subLayer + ' ' + d.vendor + ' ' + d.speed)
      .toLowerCase().indexOf(q) !== -1;
  });

  if (col) {
    devs = devs.slice().sort(function(a, b) {
      var va = (a[col] || '').toString().toLowerCase();
      var vb = (b[col] || '').toString().toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }

  tbody.innerHTML = devs.map(function(d) {
    var c = ROLE_COLORS[d.subLayer] || '#64748b';
    return '<tr>'
      + '<td style="font-weight:600;white-space:nowrap;">' + (d.hostname || '') + '</td>'
      + '<td style="white-space:nowrap;">' + (d.model || '') + '</td>'
      + '<td><span class="role-badge" style="background:' + c + '18;color:' + c + ';">'
      +   '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + c + ';margin-right:4px;"></span>'
      +   (d.subLayer || '') + '</span></td>'
      + '<td style="white-space:nowrap;">' + (d.vendor || '') + '</td>'
      + '<td><code style="font-size:11px;background:var(--surface2);padding:2px 6px;border-radius:4px;">' + (d.speed || '') + '</code></td>'
      + '<td style="white-space:nowrap;color:var(--text-dim);">Rack ' + (d.rack || '?') + ' U' + (d.unit || '?') + '</td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:20px;">No devices match filter</td></tr>';

  var cnt = document.getElementById('bom-device-count');
  if (cnt) cnt.textContent = devs.length + ' / ' + (window._bomAllDevices || []).length + ' devices';
};

// ─── G-49: Policy Editor helper exposed to HTML ───────────────────────────────
window.policyGenConfigAndShow = function() {
  if (!window.policyGenConfig) return;
  var preview = document.getElementById('pe-config-preview');
  if (!preview) return;
  var cfg = window.policyGenConfig();
  preview.style.display = '';
  if (window.applyConfigHighlight) {
    window.applyConfigHighlight(preview, cfg);
  } else {
    preview.textContent = cfg;
  }
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // PWA service worker registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  }

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
      if (n === 7) { renderJinjaPane(); }
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

  // G-49: init Policy Editor when its accordion is first opened
  var policyAccordion = document.querySelector('details.accordion-item summary');
  document.querySelectorAll('details.accordion-item').forEach(function(det) {
    det.addEventListener('toggle', function() {
      if (det.open) {
        var body = det.querySelector('.accordion-body');
        if (body && body.id === 'tools-pane-policy') {
          var list = document.getElementById('pe-policy-list');
          if (list && (!list.children.length) && window.renderPolicyEditor) {
            window.renderPolicyEditor();
          }
        }
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
