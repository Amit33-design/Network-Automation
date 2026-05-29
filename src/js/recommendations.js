'use strict';

/* ── Render all recommendations ─────────────────────────────────── */
const STATE_RECS = {};     // layerKey → sorted [{ prod, score }]

function generateRecommendations() {
  const layers   = getLayersForUC();
  const allProds = Object.values(PRODUCTS);

  layers.forEach(layer => {
    const candidates = allProds.filter(layer.filterFn);
    const scored = candidates.map(p => ({ prod: p, score: scoreProduct(p) }))
      .sort((a,b) => b.score - a.score);
    STATE_RECS[layer.key] = scored;

    // Auto-select top recommendation if none chosen
    if (!STATE.selectedProducts[layer.key] && scored.length > 0) {
      STATE.selectedProducts[layer.key] = scored[0].prod.id;
    }
  });

  renderRecsUI(layers);
  updateBOMTable(layers);
}

function renderRecsUI(layers) {
  const container = document.getElementById('recs-container');
  container.innerHTML = '';

  const vendorFilter = document.querySelector('.vtab.active')?.dataset?.vendor || 'all';
  const hosts = parseInt(STATE.totalHosts) || 100;

  let html = '';
  layers.forEach(layer => {
    const scored = STATE_RECS[layer.key] || [];
    const count  = estimateCounts(layer.key);

    let visible = scored;
    if (vendorFilter !== 'all') {
      visible = scored.filter(s => s.prod.vendor === vendorFilter);
    }

    html += `
    <div class="layer-section" data-layer-key="${layer.key}">
      <div class="layer-header">
        <div class="layer-icon" style="background:${layer.color}">${layer.icon}</div>
        <div>
          <h3>${layer.label}</h3>
          <div class="layer-meta">${scored.length} products evaluated · sorted by fit score</div>
        </div>
        <div class="layer-count">Est. quantity: <strong>${count}</strong> unit${count!==1?'s':''}</div>
      </div>
      <div class="prod-grid">
        ${visible.length
          ? visible.map((s,i) => renderProdCard(s.prod, s.score, i, layer.key)).join('')
          : `<div class="info-box" style="grid-column:1/-1">No products match the current vendor filter for this layer.</div>`}
      </div>
    </div>`;
  });

  container.innerHTML = html;

  document.getElementById('recs-headline').textContent = `${layers.length} layer${layers.length!==1?'s':''} · ${Object.keys(PRODUCTS).length} SKUs evaluated`;
  let subline = `Showing recommendations for ${UC_LABELS[STATE.uc] || 'your use case'}`;
  if (STATE.uc === 'multicloud') {
    const clouds = (STATE.mcClouds && STATE.mcClouds.length ? STATE.mcClouds : ['aws','azure','gcp'])
      .map(c => c.toUpperCase()).join(', ');
    const orchLabel = STATE.mcOrchestration === 'aviatrix' ? '🛡 Aviatrix' : '🔗 Native';
    subline += ` · ${clouds} · ${STATE.mcDualDC ? '2 DC sites' : '1 DC site'} · ${orchLabel}`;
  } else {
    subline += ` · ${hosts} endpoints`;
  }
  document.getElementById('recs-subline').textContent = subline;
}

function selectProduct(layerKey, prodId) {
  STATE.selectedProducts[layerKey] = prodId;
  // Re-render all cards in this layer
  const layer = getLayersForUC().find(l => l.key === layerKey);
  if (!layer) return;
  const scored = STATE_RECS[layerKey] || [];
  const grid = document.querySelector(`[data-layer-key="${layerKey}"] .prod-grid`);
  if (!grid) return;
  const vendorFilter = document.querySelector('.vtab.active')?.dataset?.vendor || 'all';
  let visible = scored;
  if (vendorFilter !== 'all') visible = scored.filter(s => s.prod.vendor === vendorFilter);
  grid.innerHTML = visible.map((s,i) => renderProdCard(s.prod, s.score, i, layerKey)).join('');
  updateBOMTable(getLayersForUC());
  toast(`✓ ${PRODUCTS[prodId]?.model} selected for ${layer.label}`, 'success');
}

/* ── Vendor filter ──────────────────────────────────────────────── */
function filterVendor(btn, vendor) {
  document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  btn.dataset.vendor = vendor;
  renderRecsUI(getLayersForUC());
}

/* ── BOM ────────────────────────────────────────────────────────── */
function openBOM() {
  const sec = document.getElementById('bom-section');
  const open = sec.style.display !== 'none';
  sec.style.display = open ? 'none' : 'block';
  if (!open) sec.scrollIntoView({ behavior:'smooth', block:'start' });
}

function updateBOMTable(layers) {
  const tbody = document.getElementById('bom-tbody');
  if (!tbody) return;
  let rows = '', totalDev = 0, totalPorts = 0, totalCost = 0, totalRackU = 0;

  // Build hostname map per layer (requires naming.js + configgen.js)
  const hostnamesByLayer = {};
  try {
    buildDeviceList().forEach(function(d) {
      if (!hostnamesByLayer[d.layer]) hostnamesByLayer[d.layer] = [];
      hostnamesByLayer[d.layer].push(d.name);
    });
  } catch(e) { /* STATE not ready yet — hostnames shown as — */ }

  layers.forEach(layer => {
    const selId = STATE.selectedProducts[layer.key];
    const prod  = PRODUCTS[selId];
    if (!prod) return;
    const qty       = estimateCounts(layer.key);
    const portCount = parseInt(prod.ports) || 24;
    const unitCost  = prod.estimatedCostUSD || 0;
    const extCost   = unitCost * qty;
    const ru        = prod.rackU || 1;
    totalDev   += qty;
    totalPorts += qty * portCount;
    totalCost  += extCost;
    totalRackU += ru * qty;

    const names = hostnamesByLayer[layer.key] || [];
    const hostnameCell = names.length === 0 ? '—'
      : names.length === 1 ? names[0]
      : names[0] + ' … ' + names[names.length - 1];

    rows += `<tr>
      <td><span class="layer-tag">${layer.label}</span></td>
      <td>${prod.vendor}</td>
      <td><strong>${prod.model}</strong></td>
      <td class="qty">${qty}</td>
      <td>${prod.ports}</td>
      <td style="color:var(--txt2);font-size:.78rem">${prod.features.slice(0,2).join(', ')}</td>
      <td style="color:var(--txt2);font-size:.73rem;font-family:monospace">${hostnameCell}</td>
      <td style="text-align:right;color:var(--txt2)">${ru}U × ${qty}</td>
      <td style="text-align:right;color:var(--txt2)">${unitCost ? '$' + unitCost.toLocaleString() : '—'}</td>
      <td style="text-align:right;color:var(--green);font-weight:600">${extCost ? '$' + extCost.toLocaleString() : '—'}</td>
    </tr>`;
  });

  tbody.innerHTML = rows;
  document.getElementById('bom-total-dev').textContent   = totalDev;
  document.getElementById('bom-total-ports').textContent = totalPorts.toLocaleString();
  document.getElementById('bom-total-racku').textContent = totalRackU + 'U';
  const racksEl = document.getElementById('bom-total-racks');
  if (racksEl) racksEl.textContent = Math.ceil(totalRackU / (42 * 0.8)) + ' × 42U';
  const costEl = document.getElementById('bom-total-cost');
  if (costEl) costEl.textContent = totalCost ? '$' + totalCost.toLocaleString() : '—';

  /* Refresh cable schedule whenever the BOM updates */
  if (typeof updateCablingMatrix === 'function') updateCablingMatrix(layers, STATE);

  /* Refresh EoL / EoS flags */
  if (typeof renderEoLPanel === 'function') renderEoLPanel();

  /* Refresh optics recommendations */
  if (typeof renderOpticsSection === 'function') renderOpticsSection(layers, STATE);

  /* Refresh rack plan */
  _updateRackPlanSection(layers);

  /* Refresh port capacity report */
  _updatePortCapacitySection(layers, capacityFromState(STATE));

  /* Refresh IP address & VLAN plan */
  if (typeof renderIPPlanPanel === 'function') renderIPPlanPanel();
}

/* ── Rack plan section ──────────────────────────────────────────── */
function _updateRackPlanSection(layers) {
  const el = document.getElementById('rack-plan-section');
  if (!el) return;

  var rows = '', totalU = 0;
  layers.forEach(function(layer) {
    var selId = STATE.selectedProducts[layer.key];
    var prod  = PRODUCTS[selId];
    if (!prod) return;
    var qty = estimateCounts(layer.key);
    var ru  = prod.rackU || 1;
    var layerU = ru * qty;
    totalU += layerU;
    var fillPct = Math.min(100, Math.round((layerU / 42) * 100));
    rows += '<tr>' +
      '<td><span class="layer-tag">' + layer.label + '</span></td>' +
      '<td>' + prod.model + '</td>' +
      '<td style="text-align:center">' + ru + 'U</td>' +
      '<td style="text-align:center">× ' + qty + '</td>' +
      '<td style="text-align:center;font-weight:600">' + layerU + 'U</td>' +
      '<td style="min-width:120px">' +
        '<div class="rack-fill-bar"><div class="rack-fill-inner" style="width:' + fillPct + '%"></div></div>' +
        '<span style="font-size:.7rem;color:var(--txt2)">' + fillPct + '% of 42U rack</span>' +
      '</td>' +
    '</tr>';
  });

  var racksNeeded = Math.ceil(totalU / (42 * 0.8));
  el.style.display = '';
  el.innerHTML = '<div class="section-toggle-hdr" onclick="toggleRackPlan()">' +
    '<span>🗄️ Rack Unit Planning</span><span class="toggle-caret" id="rack-plan-caret">▼</span></div>' +
    '<div>' +
    '<table class="bom-table" style="margin-top:.5rem">' +
      '<thead><tr><th>Layer</th><th>Device</th><th>Rack U each</th><th>Qty</th><th>Total U</th><th>Rack fill (42U)</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '<div class="bom-footer" style="margin-top:.6rem">' +
      '<span>Total rack U: <strong>' + totalU + 'U</strong></span>' +
      '<span>Standard racks needed (80% fill): <strong>' + racksNeeded + ' × 42U rack' + (racksNeeded !== 1 ? 's' : '') + '</strong></span>' +
      '<span style="color:var(--txt2);font-size:.78rem">Patch panels, cable managers, PDUs not included in U count</span>' +
    '</div></div>';
}
window._updateRackPlanSection = _updateRackPlanSection;

function toggleRackPlan() {
  var body = document.querySelector('#rack-plan-section > div:last-child');
  var caret = document.getElementById('rack-plan-caret');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display  = hidden ? '' : 'none';
  if (caret) caret.textContent = hidden ? '▼' : '▶';
}
window.toggleRackPlan = toggleRackPlan;

/* ── Port Capacity Report ───────────────────────────────────────── */

function _parsePortCount(s) {
  /* Returns first integer found in strings like "48x 1GbE PoE+" → 48 */
  var m = String(s || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _portCapacityRows(layers, cap) {
  var rows = [];

  layers.forEach(function(layer) {
    var selId = STATE.selectedProducts[layer.key];
    var prod  = PRODUCTS[selId];
    if (!prod) return;

    /* Skip non-physical layers */
    var lk = layer.key;
    if (lk.startsWith('mc-') || lk === 'wan-hq' || lk === 'wan-cpe' || lk === 'fw') {
      return;
    }

    var qty         = estimateCounts(lk);
    var totalPorts  = _parsePortCount(prod.ports);
    var uplinkPorts = _parsePortCount(prod.uplinks);

    var downTotal = totalPorts - uplinkPorts;
    if (downTotal < 0) downTotal = totalPorts;   // some products list total only

    var downUsed  = 0;
    var upUsed    = 0;
    var oversubStr = '—';
    var note = '';

    /* ── DC Leaf ── */
    if ((lk === 'dc-leaf') && cap.dc) {
      downUsed  = Math.ceil(cap.dc.totalPorts / Math.max(1, cap.dc.leafs));
      upUsed    = cap.dc.spines;
      uplinkPorts = Math.max(uplinkPorts, cap.dc.uplinkPerLeaf || uplinkPorts);
      oversubStr = cap.dc.oversub;
    }
    /* ── DC Spine ── */
    else if ((lk === 'dc-spine') && cap.dc) {
      downTotal = totalPorts;
      downUsed  = cap.dc.leafs;
      upUsed    = 0;
      uplinkPorts = 0;
      oversubStr = '1.00';
      note = 'Non-blocking';
    }
    /* ── Campus Access ── */
    else if (lk === 'campus-access' && cap.campus) {
      downTotal = Math.max(cap.campus.usable, downTotal);
      downUsed  = Math.ceil(cap.campus.effective / Math.max(1, cap.campus.access));
      upUsed    = 2;   /* dual-homed to dist pair */
      uplinkPorts = uplinkPorts || 4;
    }
    /* ── Campus Distribution ── */
    else if (lk === 'campus-dist' && cap.campus) {
      downTotal = totalPorts - (uplinkPorts || 4);
      downUsed  = Math.ceil(cap.campus.access / Math.max(1, cap.campus.distPairs));
      upUsed    = 2;   /* dual-homed to core */
      uplinkPorts = uplinkPorts || 4;
    }
    /* ── Campus Core ── */
    else if (lk === 'campus-core' && cap.campus) {
      downTotal = totalPorts;
      downUsed  = cap.campus.dist;
      upUsed    = 1;   /* WAN / FW uplink */
      uplinkPorts = 2;
    }
    /* ── GPU TOR ── */
    else if (lk === 'gpu-tor' && cap.gpu) {
      downTotal = cap.gpu.portsPerTOR;
      downUsed  = Math.min(downTotal,
        Math.ceil(cap.gpu.servers / Math.max(1, cap.gpu.tors)) * cap.gpu.nicsPerServer);
      upUsed    = cap.gpu.spines;
      uplinkPorts = Math.max(uplinkPorts || 0, cap.gpu.spines);
      oversubStr = cap.gpu.oversub;
    }
    /* ── GPU Spine ── */
    else if (lk === 'gpu-spine' && cap.gpu) {
      downTotal = totalPorts;
      downUsed  = cap.gpu.tors;
      upUsed    = 0;
      uplinkPorts = 0;
      oversubStr = '1.00';
      note = 'Non-blocking';
    }
    /* ── Fallback — WAN CPE / hub ── */
    else {
      downTotal = totalPorts;
      downUsed  = Math.min(4, totalPorts);
      upUsed    = 1;
      uplinkPorts = uplinkPorts || 2;
      note = 'Estimate';
    }

    /* Cap used at total to avoid >100% display oddities */
    downUsed = Math.min(downUsed, downTotal);

    var downPct    = downTotal > 0 ? Math.round((downUsed / downTotal) * 100) : 0;
    var upPct      = uplinkPorts > 0 ? Math.round((upUsed / uplinkPorts) * 100) : 0;
    var flagDown   = downPct >= 80;
    var flagUp     = upPct  >= 80;

    rows.push({
      label: layer.label,
      model: prod.model,
      qty:   qty,
      downTotal: downTotal,
      downUsed:  downUsed,
      downPct:   downPct,
      upTotal:   uplinkPorts,
      upUsed:    upUsed,
      upPct:     upPct,
      oversub:   oversubStr,
      flagDown:  flagDown,
      flagUp:    flagUp,
      note:      note,
    });
  });

  return rows;
}

function _updatePortCapacitySection(layers, cap) {
  var el = document.getElementById('port-capacity-section');
  if (!el) return;

  var rows = _portCapacityRows(layers, cap);
  if (!rows.length) { el.style.display = 'none'; return; }

  var anyFlag = rows.some(function(r) { return r.flagDown || r.flagUp; });

  var trs = rows.map(function(r) {
    var downBar = '<div class="pc-fill-bar">' +
      '<div class="pc-fill-inner ' + (r.flagDown ? 'pc-fill-warn' : '') + '" style="width:' + r.downPct + '%"></div>' +
      '</div>';
    var upBar = r.upTotal > 0
      ? '<div class="pc-fill-bar">' +
          '<div class="pc-fill-inner ' + (r.flagUp ? 'pc-fill-warn' : '') + '" style="width:' + r.upPct + '%"></div>' +
          '</div>'
      : '—';

    var statusIcon = (!r.flagDown && !r.flagUp)
      ? '<span class="pc-ok">✓</span>'
      : '<span class="pc-warn">⚠</span>';

    return '<tr>' +
      '<td><span class="layer-tag">' + r.label + '</span></td>' +
      '<td style="font-size:.79rem">' + r.model + '</td>' +
      '<td style="text-align:center">' + r.qty + '</td>' +
      '<td>' +
        r.downUsed + ' / ' + r.downTotal +
        '<span style="color:var(--txt3);font-size:.71rem"> (' + r.downPct + '%)</span>' +
        downBar +
      '</td>' +
      '<td>' +
        (r.upTotal > 0 ? r.upUsed + ' / ' + r.upTotal + '<span style="color:var(--txt3);font-size:.71rem"> (' + r.upPct + '%)</span>' : '—') +
        upBar +
      '</td>' +
      '<td style="text-align:center;font-size:.8rem;color:var(--txt1)">' + r.oversub + '</td>' +
      '<td style="text-align:center">' + statusIcon + (r.note ? '<span style="font-size:.7rem;color:var(--txt2);margin-left:.25rem">' + r.note + '</span>' : '') + '</td>' +
    '</tr>';
  }).join('');

  var flagBanner = anyFlag
    ? '<div class="pc-flag-banner">⚠ Some layers are at or above 80% port utilization — consider adding devices or upgrading to higher-density models.</div>'
    : '';

  el.style.display = '';
  el.innerHTML =
    '<div class="section-toggle-hdr" onclick="togglePortCapacity()">' +
      '<span>📊 Port Capacity Report</span>' +
      '<span class="toggle-caret" id="port-cap-caret">▼</span>' +
    '</div>' +
    '<div id="port-cap-body">' +
      flagBanner +
      '<table class="bom-table" style="margin-top:.5rem">' +
        '<thead><tr>' +
          '<th>Layer</th><th>Device</th><th style="text-align:center">Qty</th>' +
          '<th>Downlinks used / total</th>' +
          '<th>Uplinks used / total</th>' +
          '<th style="text-align:center">Oversub</th>' +
          '<th style="text-align:center">Status</th>' +
        '</tr></thead>' +
        '<tbody>' + trs + '</tbody>' +
      '</table>' +
      '<div class="bom-footer" style="margin-top:.5rem;font-size:.73rem;color:var(--txt2)">' +
        'Downlink utilization: access-facing ports. Uplink utilization: fabric/distribution-facing ports. Oversub = downlink BW ÷ uplink BW.' +
      '</div>' +
    '</div>';
}
window._updatePortCapacitySection = _updatePortCapacitySection;

function togglePortCapacity() {
  var body  = document.getElementById('port-cap-body');
  var caret = document.getElementById('port-cap-caret');
  if (!body) return;
  var hidden = body.style.display === 'none';
  body.style.display  = hidden ? '' : 'none';
  if (caret) caret.textContent = hidden ? '▼' : '▶';
}
window.togglePortCapacity = togglePortCapacity;

function exportBOM() {
  const layers = getLayersForUC();
  let csv = 'Layer,Vendor,Model,Quantity,Ports,Uplinks,Speed,Key Features,Hostnames,Rack U each,Total Rack U,Unit Price (USD),Extended Cost (USD)\n';
  let totalCost = 0, totalRackU = 0;

  const hostnamesByLayer = {};
  try {
    buildDeviceList().forEach(function(d) {
      if (!hostnamesByLayer[d.layer]) hostnamesByLayer[d.layer] = [];
      hostnamesByLayer[d.layer].push(d.name);
    });
  } catch(e) {}

  layers.forEach(layer => {
    const prod = PRODUCTS[STATE.selectedProducts[layer.key]];
    if (!prod) return;
    const qty      = estimateCounts(layer.key);
    const unitCost = prod.estimatedCostUSD || 0;
    const extCost  = unitCost * qty;
    const ru       = prod.rackU || 1;
    totalCost   += extCost;
    totalRackU  += ru * qty;
    const names = hostnamesByLayer[layer.key] || [];
    const hnCell = names.join(' ');
    csv += `"${layer.label}","${prod.vendor}","${prod.model}",${qty},"${prod.ports}","${prod.uplinks}","${prod.speed}","${prod.features.slice(0,4).join('; ')}","${hnCell}",${ru},${ru * qty},${unitCost},${extCost}\n`;
  });
  const racksNeeded = Math.ceil(totalRackU / (42 * 0.8));
  csv += `"TOTAL",,,,,,,,,,${totalRackU},,"${totalCost}"\n`;
  csv += `"RACKS NEEDED (80% fill)",,,,,,,,,,${racksNeeded},,\n`;
  if (typeof getCablingCSVSection === 'function') csv += getCablingCSVSection();
  if (typeof getOpticsCSVSection === 'function') csv += getOpticsCSVSection(layers, STATE);
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `netdesign-bom-${Date.now()}.csv`;
  a.click();
  toast('BOM exported as CSV', 'success');
}

/* ── Product detail modal ───────────────────────────────────────── */
function openDetail(prodId) {
  const p = PRODUCTS[prodId];
  if (!p) return;

  document.getElementById('modal-vlogo').className = `vendor-logo ${p.vlClass}`;
  document.getElementById('modal-vlogo').textContent = p.vendor;
  document.getElementById('modal-model').textContent  = p.model;
  document.getElementById('modal-vendor').textContent = `${p.vendor} · ${p.series}`;

  const d = p.detail;
  document.getElementById('modal-body').innerHTML = `
    <div class="detail-section">
      <h4>Performance</h4>
      ${[
        ['Switching throughput', d.throughput],
        ['Forwarding latency',   p.latencyNs ? p.latencyNs.toLocaleString()+' ns' : 'N/A'],
        ['Buffer',               p.bufferGB ? (p.bufferGB*1024).toFixed(0)+' MB' : 'N/A'],
        ['MAC table',            d.macTable],
        ['VLAN / VNI support',   d.vlans],
      ].map(([k,v]) => `<div class="ds-row"><span class="dk">${k}</span><span class="dv">${v||'—'}</span></div>`).join('')}
    </div>
    <div class="detail-section">
      <h4>Physical</h4>
      ${[
        ['Port configuration', p.ports],
        ['Uplink ports',       p.uplinks],
        ['Port speed',         p.speed],
        ['ASIC',               p.asic],
        ['Max power draw',     p.powerW+'W'],
        ['Form factor',        d.formFactor],
      ].map(([k,v]) => `<div class="ds-row"><span class="dk">${k}</span><span class="dv">${v||'—'}</span></div>`).join('')}
    </div>
    <div class="detail-section">
      <h4>Software &amp; Compliance</h4>
      ${[
        ['Routing protocols', d.routing],
        ['IPv6',              d.ipv6],
        ['Warranty',          d.warranty],
        ['Certifications',    d.certifications],
      ].map(([k,v]) => `<div class="ds-row"><span class="dk">${k}</span><span class="dv">${v||'—'}</span></div>`).join('')}
    </div>
    <div class="detail-section">
      <h4>All Features</h4>
      <div class="feat-pills" style="gap:.4rem">
        ${p.features.map(f => `<span class="feat-pill">${f}</span>`).join('')}
      </div>
    </div>
    <div class="detail-section">
      <h4>Design Notes</h4>
      <p style="font-size:.82rem;color:var(--txt1);line-height:1.6">${d.notes}</p>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modal-overlay').classList.remove('open');
}

/* ── Regenerate ─────────────────────────────────────────────────── */
function regenerateRecs() {
  STATE.selectedProducts = {};
  generateRecommendations();
  toast('Recommendations refreshed', 'info');
}

