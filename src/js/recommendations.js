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
  document.getElementById('recs-subline').textContent  = `Showing recommendations for ${UC_LABELS[STATE.uc] || 'your use case'} · ${hosts} endpoints`;
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
  let rows = '', totalDev = 0, totalPorts = 0;

  layers.forEach(layer => {
    const selId = STATE.selectedProducts[layer.key];
    const prod  = PRODUCTS[selId];
    if (!prod) return;
    const qty = estimateCounts(layer.key);
    const portCount = parseInt(prod.ports) || 24;
    totalDev   += qty;
    totalPorts += qty * portCount;

    rows += `<tr>
      <td><span class="layer-tag">${layer.label}</span></td>
      <td>${prod.vendor}</td>
      <td><strong>${prod.model}</strong></td>
      <td class="qty">${qty}</td>
      <td>${prod.ports}</td>
      <td style="color:var(--txt2);font-size:.78rem">${prod.features.slice(0,2).join(', ')}</td>
    </tr>`;
  });

  tbody.innerHTML = rows;
  document.getElementById('bom-total-dev').textContent   = totalDev;
  document.getElementById('bom-total-ports').textContent = totalPorts.toLocaleString();
}

function exportBOM() {
  const layers = getLayersForUC();
  let csv = 'Layer,Vendor,Model,Quantity,Ports,Uplinks,Speed,Key Features\n';
  layers.forEach(layer => {
    const prod = PRODUCTS[STATE.selectedProducts[layer.key]];
    if (!prod) return;
    const qty = estimateCounts(layer.key);
    csv += `"${layer.label}","${prod.vendor}","${prod.model}",${qty},"${prod.ports}","${prod.uplinks}","${prod.speed}","${prod.features.slice(0,4).join('; ')}"\n`;
  });
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

