'use strict';

/* ════════════════════════════════════════════════════════════════
   EXPORT ENGINE
   exportAllConfigs()    → .txt bundle of all device configs
   exportHTMLReport()    → self-contained HTML design report
   exportDesignSummary() → copy design brief to clipboard
════════════════════════════════════════════════════════════════ */

/* ── All Configs Bundle ─────────────────────────────────────── */
function exportAllConfigs() {
  const devs = buildDeviceList();
  if (!devs.length) { toast('Generate designs first (Step 3)', 'error'); return; }

  const sep  = '='.repeat(72);
  const lines = [`NetDesign AI — Configuration Bundle`, `Generated: ${new Date().toLocaleString()}`,
    `Organization: ${STATE.orgName || 'unnamed'} | Use Case: ${UC_LABELS[STATE.uc] || STATE.uc}`, sep, ''];

  devs.forEach(d => {
    const os  = getOS(d.layer);
    const raw = generateConfig(d, os);
    lines.push(sep);
    lines.push(`DEVICE: ${d.name}  |  ROLE: ${d.role}  |  OS: ${OS_LABELS[os]}`);
    lines.push(sep);
    lines.push(raw);
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${(STATE.orgName || 'netdesign').toLowerCase().replace(/\s+/g,'-')}-configs-${_todayStr()}.txt`;
  a.click();
  toast(`Exported ${devs.length} device configs`, 'success');
}

/* ── HTML Design Report ─────────────────────────────────────── */
function exportHTMLReport() {
  const devs = buildDeviceList();
  if (!STATE.uc) { toast('Complete the design first', 'error'); return; }

  const intent = typeof buildIntentObject === 'function' ? buildIntentObject() : {};
  const summary = buildDesignSummaryData();
  const svgEl  = document.querySelector('#hld-svg-container svg');
  const svgStr = svgEl ? svgEl.outerHTML : '<p>No topology diagram generated.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NetDesign AI — Design Report: ${STATE.orgName || 'Network Design'}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#060b18;color:#e8f0ff;line-height:1.55}
  :root{--green:#00e87a;--blue:#1a7fff;--cyan:#00d4ff;--orange:#ff8c00;--border:#1e3060;--bg2:#101a34;--bg3:#182040}
  .page{max-width:1100px;margin:0 auto;padding:2.5rem 1.5rem}
  h1{font-size:2rem;font-weight:800;margin-bottom:.35rem}
  h2{font-size:1.15rem;font-weight:700;margin-bottom:1rem;color:var(--cyan);padding-top:2rem;border-top:1px solid var(--border)}
  h3{font-size:.9rem;font-weight:700;color:#9aadd0;margin-bottom:.6rem}
  .badge{display:inline-block;padding:.15rem .55rem;border-radius:4px;font-size:.72rem;font-weight:600;margin:.15rem}
  .badge-blue{background:rgba(26,127,255,.15);color:var(--blue);border:1px solid rgba(26,127,255,.3)}
  .badge-green{background:rgba(0,232,122,.1);color:var(--green);border:1px solid rgba(0,232,122,.25)}
  .meta{display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem;font-size:.82rem;color:#9aadd0}
  .meta strong{color:#e8f0ff}
  table{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:1.5rem}
  th,td{padding:.5rem .85rem;border:1px solid var(--border);text-align:left}
  th{background:var(--bg3);font-weight:600;color:#9aadd0}
  tr:nth-child(even){background:rgba(255,255,255,.02)}
  pre{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:1rem;
      font-size:.72rem;overflow-x:auto;white-space:pre;font-family:'Courier New',monospace;
      color:#9aadd0;margin-bottom:1.5rem}
  svg{max-width:100%;height:auto;background:var(--bg2);border:1px solid var(--border);border-radius:12px}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin-bottom:1.5rem}
  .stat{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;text-align:center}
  .stat .v{font-size:1.6rem;font-weight:800;color:var(--cyan)}
  .stat .l{font-size:.72rem;color:#5a6e99;margin-top:.2rem}
  footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);font-size:.75rem;color:#5a6e99;text-align:center}
  @media print{body{background:#fff;color:#000}pre{background:#f5f5f5;color:#333}.page{padding:1rem}}
</style>
</head>
<body>
<div class="page">
  <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem">
    <div style="width:36px;height:36px;background:linear-gradient(135deg,#1a7fff,#00d4ff);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">🌐</div>
    <div>
      <h1>NetDesign AI — Design Report</h1>
      <div style="font-size:.82rem;color:#5a6e99">Generated ${new Date().toLocaleString()} · Intent-Driven Network Design Platform</div>
    </div>
  </div>

  <div class="meta">
    <div><strong>Organization:</strong> ${STATE.orgName || '—'}</div>
    <div><strong>Use Case:</strong> ${UC_LABELS[STATE.uc] || STATE.uc}</div>
    <div><strong>Scale:</strong> ${STATE.orgSize || '—'}</div>
    <div><strong>Redundancy:</strong> ${STATE.redundancy || '—'}</div>
    <div><strong>Budget:</strong> ${STATE.budget || '—'}</div>
  </div>

  <h2>📊 Design Overview</h2>
  <div class="stat-grid">
    ${summary.stats.map(s => `<div class="stat"><div class="v">${s.val}</div><div class="l">${s.label}</div></div>`).join('')}
  </div>

  <h2>🧩 Intent Object</h2>
  <pre>${JSON.stringify(intent, null, 2)}</pre>

  <h2>📐 Network Topology (HLD)</h2>
  ${svgStr}

  <h2>📦 Bill of Materials</h2>
  <table>
    <thead><tr><th>Layer</th><th>Device</th><th>Model</th><th>Vendor</th><th>OS</th><th>Qty</th></tr></thead>
    <tbody>
      ${_buildBOMRows(devs)}
    </tbody>
  </table>

  <h2>⚙️ Device Configurations</h2>
  ${_buildConfigSections(devs)}

  <h2>🔌 Protocol Stack</h2>
  <table>
    <thead><tr><th>Protocol</th><th>Role</th><th>Where Used</th></tr></thead>
    <tbody>
      ${_buildProtoRows()}
    </tbody>
  </table>

  <footer>
    NetDesign AI — Intent-Driven Network Design &amp; Deployment Platform<br>
    <a href="https://amit33-design.github.io/Network-Automation/" style="color:#1a7fff">amit33-design.github.io/Network-Automation</a>
  </footer>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${(STATE.orgName||'netdesign').toLowerCase().replace(/\s+/g,'-')}-design-report-${_todayStr()}.html`;
  a.click();
  toast('HTML design report exported', 'success');
}

function _buildBOMRows(devs) {
  const counted = {};
  devs.forEach(d => {
    const prod = PRODUCTS[STATE.selectedProducts[d.layer]];
    const key  = `${d.layer}__${prod?.id||'unknown'}`;
    if (!counted[key]) counted[key] = { d, prod, qty:0 };
    counted[key].qty++;
  });
  return Object.values(counted).map(({ d, prod, qty }) => {
    const os = OS_LABELS[getOS(d.layer)];
    return `<tr><td>${d.role}</td><td>${prod?.name||'TBD'}</td><td>${prod?.model||'—'}</td><td>${prod?.vendor||'—'}</td><td>${os}</td><td>${qty}</td></tr>`;
  }).join('');
}

function _buildConfigSections(devs) {
  return devs.slice(0, 6).map(d => {    // cap at 6 for report size
    const os  = getOS(d.layer);
    const raw = generateConfig(d, os);
    return `<h3>${d.icon} ${d.name} <span style="color:#5a6e99;font-weight:400">[${OS_LABELS[os]}]</span></h3><pre>${raw.replace(/</g,'&lt;')}</pre>`;
  }).join('');
}

function _buildProtoRows() {
  const rows = [];
  const all  = [...(STATE.underlayProto||[]), ...(STATE.overlayProto||[]), ...(STATE.protoFeatures||[])];
  const protos = {
    'ospf':   ['OSPF',   'IGP underlay routing',         'All campus/core devices'],
    'bgp':    ['BGP',    'eBGP/iBGP peering, EVPN RR',   'Spines (RR) + Leaves'],
    'evpn':   ['BGP EVPN','VXLAN overlay control-plane', 'All DC leaf/spine'],
    'is-is':  ['IS-IS',  'DC underlay, loopback reachability','DC spines + leaves'],
    'vxlan':  ['VXLAN',  'Layer-2/3 overlay encapsulation','DC leaf NVE interfaces'],
    'mpls':   ['MPLS',   'WAN label-switched paths',     'WAN CE/PE devices'],
    'eigrp':  ['EIGRP',  'Named-mode campus IGP',        'Campus access + core'],
  };
  all.forEach(p => {
    const info = protos[p];
    if (info) rows.push(`<tr><td><strong>${info[0]}</strong></td><td>${info[1]}</td><td>${info[2]}</td></tr>`);
  });
  if (!rows.length) rows.push('<tr><td colspan="3" style="color:#5a6e99">No protocols selected</td></tr>');
  return rows.join('');
}

function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Design Summary Data (capacity-model driven) ─────────────── */
function buildDesignSummaryData() {
  const uc    = STATE.uc;
  const prods = Object.entries(STATE.selectedProducts || {});

  // ── Real device totals from capacity model ──────────────────
  const cap  = capacityFromState(STATE);
  const ucLayers = getLayersForUC ? getLayersForUC() : [];

  // Build per-layer rows using the same estimateCounts() used by BOM
  const LAYER_META = {
    'fw':             { icon:'🔒', role:'Security / Firewall',   label:'Security' },
    'campus-core':    { icon:'⚙️', role:'Core Switch',           label:'Core Layer' },
    'campus-dist':    { icon:'🔀', role:'Distribution Switch',   label:'Distribution' },
    'campus-access':  { icon:'🔌', role:'Access Switch',         label:'Access Layer' },
    'dc-spine':       { icon:'🦴', role:'DC Spine',              label:'DC Spine' },
    'dc-leaf':        { icon:'🍃', role:'DC Leaf / ToR',         label:'DC Leaf' },
    'gpu-spine':      { icon:'🧠', role:'GPU Spine',             label:'GPU Spine' },
    'gpu-tor':        { icon:'⚡', role:'GPU TOR',               label:'GPU TOR' },
    'campus-access_wan':{ icon:'📡', role:'Branch CPE',          label:'Branch CPE' },
  };

  let totalDevices = 0;
  const layerBOM = [];    // [{ icon, role, prod, os, qty }]
  const topVendors = {};

  ucLayers.forEach(layer => {
    const qty  = estimateCounts(layer.key);
    const prod = PRODUCTS[STATE.selectedProducts[layer.key]];
    const meta = LAYER_META[layer.key] || { icon:'🔌', role: layer.label, label: layer.label };
    const os   = OS_LABELS ? OS_LABELS[getOS(layer.key)] : '—';

    if (qty > 0) {
      totalDevices += qty;
      layerBOM.push({
        icon:  meta.icon,
        role:  meta.role,
        label: layer.label,
        key:   layer.key,
        qty,
        os,
        prod:  prod ? `${prod.vendor} ${prod.model || prod.name}` : '—',
        vendor: prod?.vendor || null,
      });
      if (prod?.vendor) topVendors[prod.vendor] = (topVendors[prod.vendor]||0) + qty;
    }
  });

  // FW is not always in ucLayers — add separately
  const hasFW = STATE.fwModel && STATE.fwModel !== 'none';
  if (hasFW) {
    const fwQty  = (STATE.redundancy === 'ha' || STATE.redundancy === 'full') ? 2 : 1;
    const fwProd = PRODUCTS[STATE.selectedProducts['fw']];
    const already = layerBOM.some(r => r.key === 'fw');
    if (!already && fwQty) {
      totalDevices += fwQty;
      layerBOM.push({
        icon:'🔒', role:'Security / Firewall', label:'Security', key:'fw',
        qty: fwQty,
        os: OS_LABELS ? OS_LABELS[getOS('fw')] : '—',
        prod: fwProd ? `${fwProd.vendor} ${fwProd.model}` : '—',
        vendor: fwProd?.vendor || null,
      });
      if (fwProd?.vendor) topVendors[fwProd.vendor] = (topVendors[fwProd.vendor]||0) + fwQty;
    }
  }

  // Capacity narrative (for context cards)
  let capacityNote = '';
  if (cap.campus) {
    const c = cap.campus;
    capacityNote = `${c.endpoints.toLocaleString()} endpoints → ${c.effective.toLocaleString()} w/25% growth · ` +
      `${c.access} access (${c.usable} ports/sw) · ${c.dist} dist (${c.distPairs} HA pairs) · ${c.core} core`;
  } else if (cap.dc) {
    const c = cap.dc;
    capacityNote = `${c.servers.toLocaleString()} servers · ${c.leafs} leaf (${c.oversub}:1 oversub) · ${c.spines} spine · ` +
      `${c.downlinkBW}G down / ${c.uplinkBW}G up per leaf`;
  } else if (cap.gpu) {
    const c = cap.gpu;
    capacityNote = `${c.gpus} GPUs · ${c.servers} servers · ${c.tors} TOR · ${c.spines} spine · ` +
      `${c.isNonBlocking?'✓ 1:1 non-blocking':'⚠ check uplinks'} (oversub ${c.oversub}:1)`;
  }

  const stats = [
    { val: totalDevices || '—',                        label: 'Total Devices'   },
    { val: prods.filter(([,v])=>v).length || '—',      label: 'Product Lines'   },
    { val: (parseInt(STATE.totalHosts)||0).toLocaleString() || '—', label: 'Host Endpoints' },
    { val: STATE.numSites || '1',                      label: 'Sites'           },
    { val: STATE.redundancy?.toUpperCase() || '—',     label: 'Redundancy'      },
  ];

  const protoStack = [
    ...(STATE.underlayProto  || []),
    ...(STATE.overlayProto   || []),
    ...(STATE.protoFeatures  || []),
  ].map(p => p.toUpperCase());

  const secFeats = [...(STATE.nac||[]), ...(STATE.compliance||[])];

  return { stats, layerBOM, protoStack, secFeats, topVendors, totalDevices, cap, capacityNote, uc };
}

/* ── Design Summary Tab Renderer ────────────────────────────── */
function renderDesignSummary() {
  const el = document.getElementById('summary-tab-content');
  if (!el) return;

  const data   = buildDesignSummaryData();
  const intent = typeof buildIntentObject === 'function' ? buildIntentObject() : {};

  const vendorList = Object.entries(data.topVendors)
    .sort((a,b) => b[1]-a[1])
    .map(([v,n]) => `<span class="sum-chip">${v} <strong style="color:var(--txt1)">${n}</strong> devices</span>`).join('');

  const protoChips = data.protoStack.length
    ? data.protoStack.map(p => `<span class="sum-chip sum-chip-proto">${p}</span>`).join('')
    : '<span style="color:var(--txt3)">None selected</span>';

  const secChips = data.secFeats.length
    ? data.secFeats.map(s => `<span class="sum-chip sum-chip-sec">${s.toUpperCase()}</span>`).join('')
    : '<span style="color:var(--txt3)">Standard</span>';

  // BOM table from capacity model (same source as recommendations BOM)
  const deviceRows = data.layerBOM.map(r =>
    `<tr>
      <td>${r.icon} ${r.role}</td>
      <td><code style="font-size:.78rem">${r.prod}</code></td>
      <td style="color:var(--txt2)">${r.os}</td>
      <td style="text-align:center;font-weight:700;color:var(--green);font-size:1.05rem">${r.qty.toLocaleString()}</td>
    </tr>`
  ).join('');

  el.innerHTML = `
    <div class="sum-layout">

      <!-- Header card -->
      <div class="sum-card sum-hero">
        <div class="sum-hero-icon">🌐</div>
        <div class="sum-hero-content">
          <div class="sum-hero-title">${UC_LABELS[data.uc] || data.uc}</div>
          <div class="sum-hero-org">${STATE.orgName || 'Unnamed Organization'}</div>
          <div class="sum-hero-meta">
            ${STATE.orgSize ? `<span>${STATE.orgSize}</span>` : ''}
            ${STATE.redundancy ? `<span>${STATE.redundancy.toUpperCase()} redundancy</span>` : ''}
            ${STATE.budget ? `<span>${STATE.budget} budget</span>` : ''}
          </div>
        </div>
        <div class="sum-export-btn-wrap">
          <button class="btn btn-ghost sum-export-btn" onclick="showExportModal()">📤 Export</button>
        </div>
      </div>

      <!-- Capacity model banner -->
      ${data.capacityNote ? `
      <div class="sum-card" style="background:linear-gradient(90deg,rgba(0,232,122,.06),rgba(0,212,255,.04));border-color:rgba(0,232,122,.25);padding:.75rem 1.1rem">
        <div style="display:flex;align-items:center;gap:.6rem">
          <span style="font-size:1.1rem">📐</span>
          <div>
            <div style="font-size:.7rem;color:var(--green);font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:.2rem">Capacity Model</div>
            <div style="font-size:.8rem;color:var(--txt1);font-family:var(--mono)">${data.capacityNote}</div>
          </div>
        </div>
      </div>` : ''}

      <!-- Stats row -->
      <div class="sum-stats-row">
        ${data.stats.map(s => `
          <div class="sum-stat">
            <div class="sum-stat-val">${s.val}</div>
            <div class="sum-stat-lbl">${s.label}</div>
          </div>`).join('')}
      </div>

      <!-- Two-column layout -->
      <div class="sum-two-col">

        <!-- Left: BOM from capacity model -->
        <div class="sum-card">
          <div class="sum-card-hdr" style="display:flex;justify-content:space-between;align-items:center">
            <span>📦 Bill of Materials</span>
            <span style="font-size:.75rem;color:var(--txt2);font-weight:400">Total: <strong style="color:var(--green)">${data.totalDevices.toLocaleString()}</strong> devices</span>
          </div>
          <table class="sum-table">
            <thead><tr><th>Layer / Role</th><th>Hardware</th><th>OS</th><th style="text-align:center">Qty</th></tr></thead>
            <tbody>${deviceRows || '<tr><td colspan="4" style="color:var(--txt3);text-align:center">Complete Step 3 to see BOM</td></tr>'}</tbody>
          </table>
          <div style="margin-top:.6rem;padding-top:.5rem;border-top:1px solid var(--bdr);font-size:.72rem;color:var(--txt3)">
            Quantities calculated by capacity model · IP/VLAN plan shows addressing schema for all devices
          </div>
        </div>

        <!-- Right: Protocol + Security + Capacity -->
        <div style="display:flex;flex-direction:column;gap:1rem">
          <div class="sum-card">
            <div class="sum-card-hdr">📡 Protocol Stack</div>
            <div class="sum-chips">${protoChips}</div>
          </div>
          <div class="sum-card">
            <div class="sum-card-hdr">🔒 Security &amp; Compliance</div>
            <div class="sum-chips">${secChips}</div>
          </div>
          <div class="sum-card">
            <div class="sum-card-hdr">🏭 Vendors &amp; Device Count</div>
            <div class="sum-chips">${vendorList || '<span style="color:var(--txt3)">Not selected</span>'}</div>
          </div>
          <div class="sum-card">
            <div class="sum-card-hdr">🧩 Topology</div>
            <div style="font-family:var(--mono);font-size:.82rem;color:var(--txt1)">${intent.topology || '—'}</div>
          </div>
        </div>

      </div>

      <!-- Export action row -->
      <div class="sum-export-row">
        <button class="btn btn-ghost" onclick="exportSVG()">⬇ Export SVG</button>
        <button class="btn btn-ghost" onclick="exportLLD()">⬇ Export LLD CSV</button>
        <button class="btn btn-ghost" onclick="exportAllConfigs()">⬇ All Configs (.txt)</button>
        <button class="btn btn-primary" onclick="exportHTMLReport()">📄 Full HTML Report</button>
      </div>

    </div>`;
}

/* ── Export Modal ────────────────────────────────────────────── */
function showExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) { modal.style.display = 'flex'; return; }
}
function closeExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'none';
}
