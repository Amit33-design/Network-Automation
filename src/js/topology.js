'use strict';

/* ── Step hook: single consolidated handler ─────────────────────── */
const _coreJumpStep = jumpStep;
window.jumpStep = function(n) {
  _coreJumpStep(n);
  if (n === 3) setTimeout(generateRecommendations, 80);
  if (n === 4) setTimeout(buildDesign, 80);
  if (n === 5) setTimeout(renderDeviceList, 80);
  saveStateLS();
};

/* ════════════════════════════════════════════════════════════════
   PART 3 — HLD / LLD Design Generator
════════════════════════════════════════════════════════════════ */

/* ── Tab switching ──────────────────────────────────────────────── */
function switchDesignTab(btn, key) {
  document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.design-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`dpanel-${key}`).classList.add('active');
}

/* ── Entry point ────────────────────────────────────────────────── */
function buildDesign() {
  renderHLD();
  renderIPPlan();
  renderVLANPlan();
  renderBGPDesign();
  renderPhysical();
  // Show VXLAN section if overlay selected
  const hasVxlan = STATE.overlayProto.some(o => o.includes('VXLAN'));
  const vxSec = document.getElementById('vxlan-section');
  if (vxSec) vxSec.style.display = hasVxlan ? 'block' : 'none';
  if (hasVxlan) renderVNITable();
}

/* ════════════════════════════════════════════════════════════════
   SVG TOPOLOGY BUILDER
════════════════════════════════════════════════════════════════ */

/* Core SVG renderer — nodes + links → SVG string */
function buildSVG({ nodes, links, bands, W = 1100, H = 600 }) {
  const BOX_R = 7;

  /* ── defs ── */
  const defs = `<defs>
    <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="#2a4a90" opacity=".8"/>
    </marker>
    <filter id="glow-f" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="pkt-glow" x="-80%" y="-80%" width="360%" height="360%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".4"/>
    </filter>
  </defs>`;

  /* ── layer bands ── */
  const bandsSVG = (bands || []).map(b => `
    <rect x="0" y="${b.y}" width="${W}" height="${b.h}"
      fill="${b.color}" opacity=".06" rx="0"/>
    <text x="8" y="${b.y + b.h/2 + 4}" fill="${b.color}" opacity=".7"
      font-size="10" font-weight="700" letter-spacing="1"
      text-transform="uppercase" font-family="monospace">${b.label}</text>
  `).join('');

  /* ── links ── */
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });

  const linksSVG = links.map(lk => {
    const a = nodeMap[lk.from], b = nodeMap[lk.to];
    if (!a || !b) return '';
    const aw = a.w || 115, ah = a.h || 42;
    const bw = b.w || 115, bh = b.h || 42;
    const x1 = a.x + aw / 2, y1 = a.y + ah;
    const x2 = b.x + bw / 2, y2 = b.y;
    // If same Y (horizontal link)
    const sameRow = Math.abs(a.y - b.y) < 10;
    const cx1 = x1, cy1 = sameRow ? y1 - ah/2 : y1 + (y2 - y1) * 0.35;
    const cx2 = x2, cy2 = sameRow ? y2 - bh/2 : y2 - (y2 - y1) * 0.35;
    const pathD = sameRow
      ? `M${x1},${a.y + ah/2} L${x2},${b.y + bh/2}`
      : `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
    const color  = lk.color  || '#2a4a90';
    const width  = lk.width  || 1.8;
    const flow   = lk.flow   ? `stroke-dasharray="10,5" class="${lk.slow ? 'flow-link-slow' : 'flow-link'}"` : '';
    const label  = lk.label  ? `<text>
      <textPath href="#lp-${lk.from}-${lk.to}" startOffset="50%" text-anchor="middle"
        fill="${color}" font-size="8.5" dy="-3">${lk.label}</textPath>
    </text>` : '';
    return `
      <path id="lp-${lk.from}-${lk.to}" d="${pathD}"
        fill="none" stroke="${color}" stroke-width="${width}"
        stroke-linecap="round" ${flow} opacity="${lk.opacity || 1}"/>
      ${label}`;
  }).join('');

  /* ── nodes ── */
  const nodesSVG = nodes.map(n => {
    const w = n.w || 115, h = n.h || 42;
    const fill   = n.fill   || '#182040';
    const stroke = n.stroke || '#2a4a90';
    const glow   = n.glow   ? 'filter="url(#glow-f)"' : '';
    const icon   = n.icon   || '';
    const sub    = n.sub    || '';
    return `
    <g transform="translate(${n.x},${n.y})" class="svg-device-box" ${glow}>
      <rect width="${w}" height="${h}" rx="${BOX_R}"
        fill="${fill}" stroke="${stroke}" stroke-width="1.6"
        filter="url(#shadow)"/>
      ${icon ? `<text x="10" y="${h/2 + 4}" font-size="13">${icon}</text>` : ''}
      <text x="${icon ? w/2 + 6 : w/2}" y="${sub ? h/2 - 2 : h/2 + 4}"
        text-anchor="middle" fill="#e8f0ff" font-size="${n.fontSize || 9}"
        font-weight="700" font-family="'Segoe UI',sans-serif">${n.label}</text>
      ${sub ? `<text x="${icon ? w/2 + 6 : w/2}" y="${h/2 + 10}"
        text-anchor="middle" fill="#5a6e99" font-size="7.5"
        font-family="'Segoe UI',sans-serif">${sub}</text>` : ''}
    </g>`;
  }).join('');

  /* ── animated packet dots (one per flow:true link, staggered) ── */
  const flowLinks = links.filter(lk => lk.flow);
  const packetsSVG = flowLinks.map((lk, i) => {
    const color   = lk.color || '#00d4ff';
    // fast spine links ~1.1 s, slow access/leaf ~2.2 s, add small offset per index
    const baseDur = lk.slow ? 2.2 : 1.1;
    const dur     = (baseDur + (i % 5) * 0.18).toFixed(2) + 's';
    // stagger so packets don't all launch together
    const begin   = ((i * 0.29) % baseDur).toFixed(2) + 's';
    const r       = lk.slow ? 3 : 3.8;
    return `
    <circle r="${r}" fill="${color}" opacity="0.9" class="pkt" filter="url(#pkt-glow)"
      style="animation-delay:${begin}">
      <animateMotion dur="${dur}" begin="${begin}" repeatCount="indefinite"
        calcMode="spline" keyTimes="0;1" keySplines="0.4 0 0.6 1">
        <mpath href="#lp-${lk.from}-${lk.to}"/>
      </animateMotion>
    </circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
    style="font-family:'Segoe UI',sans-serif">
    ${defs}
    <rect width="${W}" height="${H}" fill="#0c1226" rx="10"/>
    ${bandsSVG}
    ${linksSVG}
    ${nodesSVG}
    ${packetsSVG}
  </svg>`;
}

/* ── Colour palette helpers ─────────────────────────────────────── */
const C = {
  internet: { fill:'#0a1e3a', stroke:'#1a7fff' },
  fw:       { fill:'#2a0a0f', stroke:'#ff3355' },
  core:     { fill:'#1a0a2e', stroke:'#9955ff' },
  dist:     { fill:'#0a1a2e', stroke:'#00d4ff' },
  access:   { fill:'#071828', stroke:'#1a7fff' },
  dcspine:  { fill:'#0a2014', stroke:'#00e87a' },
  dcleaf:   { fill:'#071a10', stroke:'#5dcc8a' },
  gputor:   { fill:'#1e0e00', stroke:'#ff8c00' },
  gpuspine: { fill:'#1a1200', stroke:'#ffd000' },
  stor:     { fill:'#0a1a20', stroke:'#00d4ff' },
  server:   { fill:'#0d1520', stroke:'#5a6e99' },
  cloud:    { fill:'#060b18', stroke:'#1a7fff' },
};

/* ── HLD dispatcher ─────────────────────────────────────────────── */
function renderHLD() {
  const uc = STATE.uc;
  let result;
  if (uc === 'campus')  result = campusHLD();
  else if (uc === 'dc') result = dcHLD();
  else if (uc === 'gpu')result = gpuHLD();
  else if (uc === 'wan')result = wanHLD();
  else                  result = hybridHLD();

  document.getElementById('hld-svg-container').innerHTML = result.svg;
  document.getElementById('hld-title').textContent  = result.title;
  document.getElementById('hld-meta').textContent   = result.meta;
  document.getElementById('hld-legend').innerHTML   = result.legend;
}

/* ════════════════════════════════════════════════════════════════
   CAMPUS HLD
════════════════════════════════════════════════════════════════ */
function campusHLD() {
  const W = 1100, H = 600;
  const sz  = STATE.orgSize;
  const red = STATE.redundancy;
  const haCore = sz === 'large' || sz === 'enterprise';
  const haFW   = STATE.fwModel && STATE.fwModel !== 'none';
  const dual   = red === 'ha' || red === 'full';

  const selAccess = PRODUCTS[STATE.selectedProducts['campus-access']];
  const selDist   = PRODUCTS[STATE.selectedProducts['campus-dist']];
  const selCore   = PRODUCTS[STATE.selectedProducts['campus-core']];
  const selFW     = PRODUCTS[STATE.selectedProducts['fw']];

  // Y positions per layer
  const yInternet = 30;
  const yFW       = haFW   ? 120 : null;
  const yCore     = haCore ? (haFW ? 215 : 120) : null;
  const yDist     = haCore ? 325 : (haFW ? 215 : 120);
  const yAccess   = yDist  + 120;
  const yEP       = yAccess + 105;

  const nodes = [], links = [];
  const bw = 115, bh = 42;

  // Internet cloud
  nodes.push({ id:'inet', x: W/2 - 70, y: yInternet, w:140, h:44,
    label:'INTERNET', icon:'🌐', ...C.internet, glow: true });

  // Firewall pair
  if (haFW) {
    nodes.push({ id:'fw1', x: dual ? 330 : W/2-57, y: yFW, w:bw, h:bh,
      label: selFW ? selFW.model.slice(0,18) : 'FW-01',
      sub: selFW ? selFW.vendor : 'Firewall', icon:'🔒', ...C.fw });
    links.push({ from:'inet', to:'fw1', color:'#ff3355', width:2, flow:true });
    if (dual) {
      nodes.push({ id:'fw2', x: 660, y: yFW, w:bw, h:bh,
        label: selFW ? selFW.model.slice(0,18) : 'FW-02',
        sub: selFW ? selFW.vendor : 'Firewall (HA)', icon:'🔒', ...C.fw });
      links.push({ from:'inet', to:'fw2', color:'#ff3355', width:2, flow:true });
      links.push({ from:'fw1', to:'fw2', color:'#ff3355', width:1, opacity:.4 });
    }
  }

  // Core layer
  const coreParent1 = haFW ? 'fw1' : 'inet';
  const coreParent2 = haFW && dual ? 'fw2' : (haFW ? 'fw1' : 'inet');
  if (haCore) {
    nodes.push({ id:'core1', x: dual ? 310 : W/2-57, y: yCore, w:bw, h:bh,
      label: selCore ? selCore.model.slice(0,18) : 'CORE-01',
      sub: selCore ? selCore.vendor : 'Core', icon:'⚙️', ...C.core });
    links.push({ from: coreParent1, to:'core1', color:'#9955ff', width:2.2, flow:true });
    if (dual) {
      nodes.push({ id:'core2', x: 680, y: yCore, w:bw, h:bh,
        label: selCore ? selCore.model.slice(0,18) : 'CORE-02',
        sub: selCore ? selCore.vendor : 'Core (HA)', icon:'⚙️', ...C.core });
      links.push({ from: coreParent2, to:'core2', color:'#9955ff', width:2.2, flow:true });
      links.push({ from:'core1', to:'core2', color:'#9955ff', width:1, opacity:.35 });
    }
  }

  // Distribution — 4 nodes
  const distXs = dual ? [80, 320, 580, 820] : [180, 450, 720, 970];
  const distIds = ['dist1','dist2','dist3','dist4'];
  const distParents = haCore
    ? (dual ? ['core1','core1','core2','core2'] : ['core1','core1','core1','core1'])
    : (haFW ? (dual ? ['fw1','fw1','fw2','fw2'] : ['fw1','fw1','fw1','fw1'])
             : ['inet','inet','inet','inet']);

  distXs.forEach((x, i) => {
    if (x + bw > W + 20) return;
    nodes.push({ id: distIds[i], x, y: yDist, w:bw, h:bh,
      label: selDist ? selDist.model.slice(0,14) : `DIST-0${i+1}`,
      sub: selDist ? selDist.vendor : 'Distribution', icon:'🔀', ...C.dist });
    links.push({ from: distParents[i], to: distIds[i], color:'#00d4ff', width:1.8, flow:true, slow:true });
    // Cross-link between dist pairs
    if (i % 2 === 0 && distXs[i+1]) {
      links.push({ from: distIds[i], to: distIds[i+1], color:'#00d4ff', width:1, opacity:.25 });
    }
  });

  // Access — 4 nodes (under each dist)
  distXs.forEach((x, i) => {
    if (x + bw > W + 20) return;
    const aid = `acc${i+1}`;
    nodes.push({ id: aid, x, y: yAccess, w:bw, h:bh,
      label: selAccess ? selAccess.model.slice(0,14) : `ACC-0${i+1}`,
      sub: selAccess ? selAccess.vendor : 'Access', icon:'🔌', ...C.access });
    links.push({ from: distIds[i], to: aid, color:'#1a7fff', width:1.5, slow:true });
  });

  // Endpoints row
  const epTypes = [
    { id:'ep-pc',  icon:'💻', label:'Workstations' },
    { id:'ep-ph',  icon:'📞', label:'IP Phones' },
    { id:'ep-ap',  icon:'📶', label:'Wi-Fi APs' },
    { id:'ep-srv', icon:'🖥', label:'Servers' },
  ];
  distXs.forEach((x, i) => {
    if (i >= epTypes.length || x + 90 > W + 20) return;
    const ep = epTypes[i];
    nodes.push({ id: ep.id, x: x + 10, y: yEP, w: 90, h: 34,
      label: ep.label, icon: ep.icon, ...C.server, fontSize:8 });
    links.push({ from:`acc${i+1}`, to: ep.id, color:'#2a3a5a', width:1, opacity:.5 });
  });

  // Bands
  const bands = [];
  if (haFW)   bands.push({ y: yFW   - 10, h: 62, color:'#ff3355', label:'SECURITY' });
  if (haCore) bands.push({ y: yCore - 10, h: 62, color:'#9955ff', label:'CORE' });
  bands.push({ y: yDist   - 10, h: 62, color:'#00d4ff', label:'DISTRIBUTION' });
  bands.push({ y: yAccess - 10, h: 62, color:'#1a7fff', label:'ACCESS' });
  bands.push({ y: yEP     - 10, h: 50, color:'#5a6e99', label:'ENDPOINTS' });

  const selAccName = selAccess ? selAccess.model : '—';
  const selDistName = selDist  ? selDist.model   : '—';
  const meta = `Campus hierarchy · ${dual ? 'Dual-uplink HA' : 'Single uplink'} · Access: ${selAccName} · Dist: ${selDistName}`;

  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#ff3355"></div>Security / Firewall</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9955ff"></div>Core</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff"></div>Distribution</div>
    <div class="legend-item"><div class="legend-dot" style="background:#1a7fff"></div>Access</div>
    <div class="legend-item"><div class="legend-line" style="background:#1a7fff;border-top:2px dashed #1a7fff"></div>Active data flow</div>
    <div class="legend-item"><div class="legend-line" style="background:var(--border)"></div>Physical link</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff;box-shadow:0 0 6px #00d4ff"></div>Live packet flow</div>`;

  return { svg: buildSVG({ nodes, links, bands, W, H: yEP + 80 }), title:'Campus Network — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   DATA CENTER (LEAF-SPINE) HLD
════════════════════════════════════════════════════════════════ */
function dcHLD() {
  const W = 1100, H = 560;
  const red    = STATE.redundancy;
  const dual   = red === 'ha' || red === 'full';
  const haFW   = STATE.fwModel && STATE.fwModel !== 'none';
  const selLeaf  = PRODUCTS[STATE.selectedProducts['dc-leaf']];
  const selSpine = PRODUCTS[STATE.selectedProducts['dc-spine']];
  const selFW    = PRODUCTS[STATE.selectedProducts['fw']];

  const yInternet = 25;
  const yBorder   = haFW ? 110 : null;
  const ySpine    = haFW ? 215 : 110;
  const yLeaf     = ySpine + 140;
  const ySrv      = yLeaf  + 115;

  const nodes = [], links = [];
  const bw = 118, bh = 42;

  // Internet
  nodes.push({ id:'inet', x: W/2 - 70, y: yInternet, w:140, h:44,
    label:'INTERNET / WAN', icon:'🌐', ...C.internet, glow:true });

  // Border FW
  if (haFW) {
    ['border1','border2'].forEach((id, i) => {
      const x = i === 0 ? 280 : 700;
      nodes.push({ id, x, y: yBorder, w:bw, h:bh,
        label: selFW ? selFW.model.slice(0,16) : `BORDER-0${i+1}`,
        sub: selFW ? selFW.vendor : 'Border FW', icon:'🔒', ...C.fw });
      links.push({ from:'inet', to:id, color:'#ff3355', width:2, flow:true });
    });
    links.push({ from:'border1', to:'border2', color:'#ff3355', width:1, opacity:.35 });
  }

  // Spines
  const spineParent1 = haFW ? 'border1' : 'inet';
  const spineParent2 = haFW ? 'border2' : 'inet';
  ['spine1','spine2'].forEach((id, i) => {
    const x = i === 0 ? 260 : 720;
    nodes.push({ id, x, y: ySpine, w:bw, h:bh,
      label: selSpine ? selSpine.model.slice(0,16) : `SPINE-0${i+1}`,
      sub: selSpine ? selSpine.vendor : 'DC Spine', icon:'🦴', ...C.dcspine, glow:true });
    links.push({ from: i === 0 ? spineParent1 : spineParent2, to: id, color:'#00e87a', width:2.2, flow:true });
  });
  links.push({ from:'spine1', to:'spine2', color:'#00e87a', width:1, opacity:.3 });

  // Leaves (4)
  const leafXs = [60, 295, 530, 765];
  leafXs.forEach((x, i) => {
    const id = `leaf${i+1}`;
    nodes.push({ id, x, y: yLeaf, w:bw, h:bh,
      label: selLeaf ? selLeaf.model.slice(0,14) : `LEAF-0${i+1}`,
      sub: selLeaf ? selLeaf.vendor : 'DC Leaf', icon:'🍃', ...C.dcleaf });
    // Full mesh to both spines
    links.push({ from:'spine1', to:id, color:'#5dcc8a', width:1.5, flow:true, slow:true });
    links.push({ from:'spine2', to:id, color:'#5dcc8a', width:1.5, flow:true, slow:true });
  });

  // Server clusters
  leafXs.forEach((x, i) => {
    const id = `srv${i+1}`;
    const labels = ['Compute', 'Storage', 'App Svrs', 'DB Cluster'];
    nodes.push({ id, x: x + 8, y: ySrv, w: 100, h:34,
      label: labels[i], icon:'🖥', ...C.server, fontSize:8 });
    links.push({ from:`leaf${i+1}`, to:id, color:'#2a3a5a', width:1, opacity:.6 });
  });

  const bands = [];
  if (haFW) bands.push({ y: yBorder - 10, h: 62, color:'#ff3355', label:'BORDER / SECURITY' });
  bands.push({ y: ySpine - 10, h: 62, color:'#00e87a', label:'SPINE' });
  bands.push({ y: yLeaf  - 10, h: 62, color:'#5dcc8a', label:'LEAF (ToR)' });
  bands.push({ y: ySrv   - 10, h: 50, color:'#5a6e99', label:'SERVERS' });

  const meta = `Leaf-Spine CLOS · ${leafXs.length} leaves · 2 spines · ${selLeaf ? selLeaf.model : '—'} leaf · ${selSpine ? selSpine.model : '—'} spine`;
  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#ff3355"></div>Border / Firewall</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00e87a"></div>Spine</div>
    <div class="legend-item"><div class="legend-dot" style="background:#5dcc8a"></div>Leaf / ToR</div>
    <div class="legend-item"><div class="legend-line" style="border-top:2px dashed #00e87a;width:22px"></div>Active flow</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00e87a;box-shadow:0 0 6px #00e87a"></div>Live packet flow</div>`;

  return { svg: buildSVG({ nodes, links, bands, W, H: ySrv + 80 }), title:'Data Center Leaf-Spine — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   GPU / AI CLUSTER HLD
════════════════════════════════════════════════════════════════ */
function gpuHLD() {
  const W = 1100, H = 640;
  const selTOR   = PRODUCTS[STATE.selectedProducts['gpu-tor']];
  const selSpine = PRODUCTS[STATE.selectedProducts['gpu-spine']];

  // 3 fabrics: OOB MGMT | Compute | Storage
  const nodes = [], links = [];
  const bw = 115, bh = 40;

  // OOB MGMT
  nodes.push({ id:'oob', x: W/2 - 57, y: 25, w:bw, h:bh,
    label:'OOB MGMT SW', sub:'Management', icon:'🛡', ...C.dist });

  // GPU Spines (compute fabric)
  [0,1].forEach(i => {
    const id = `gspine${i+1}`;
    nodes.push({ id, x: 130 + i * 480, y: 130, w:bw, h:bh,
      label: selSpine ? selSpine.model.slice(0,14) : `GPU-SPINE-0${i+1}`,
      sub: selSpine ? selSpine.vendor : 'GPU Spine', icon:'🧠', ...C.gpuspine, glow:true });
    links.push({ from:'oob', to:id, color:'#ffd000', width:1, opacity:.3 });
  });
  links.push({ from:'gspine1', to:'gspine2', color:'#ffd000', width:1.5, opacity:.4 });

  // GPU TORs (4 racks)
  const torXs = [40, 260, 480, 700];
  torXs.forEach((x, i) => {
    const id = `tor${i+1}`;
    nodes.push({ id, x, y: 255, w:bw, h:bh,
      label: selTOR ? selTOR.model.slice(0,14) : `GPU-TOR-0${i+1}`,
      sub: selTOR ? selTOR.vendor : 'GPU TOR', icon:'⚡', ...C.gputor });
    links.push({ from:'gspine1', to:id, color:'#ff8c00', width:2, flow:true });
    links.push({ from:'gspine2', to:id, color:'#ff8c00', width:2, flow:true });
    links.push({ from:'oob', to:id, color:'#ffd000', width:1, opacity:.2 });
  });

  // GPU Servers (4 racks × 8 GPUs visual)
  torXs.forEach((x, i) => {
    const id = `gsrv${i+1}`;
    nodes.push({ id, x: x + 5, y: 375, w: 105, h:38,
      label:`Rack-${i+1} GPUs`, sub:'H100 / A100 × 8', icon:'🎮',
      fill:'#1a0a00', stroke:'#ff6600', fontSize:8 });
    links.push({ from:`tor${i+1}`, to:id, color:'#ff6600', width:1.8, flow:true, slow:true });
  });

  // Storage fabric (right side)
  nodes.push({ id:'sstor1', x: 870, y: 130, w:bw, h:bh,
    label:'STOR-SPINE-01', sub:'Storage Spine', icon:'💾', ...C.stor });
  nodes.push({ id:'sstor2', x: 870, y: 255, w:bw, h:bh,
    label:'STOR-LEAF-01', sub:'Storage Leaf', icon:'🗄️', ...C.stor });
  nodes.push({ id:'sstor3', x: 870, y: 375, w: 105, h:38,
    label:'NVMe-oF / NFS', sub:'Storage Array', icon:'🗃️',
    fill:'#0a1a2e', stroke:'#00d4ff', fontSize:8 });

  links.push({ from:'oob',    to:'sstor1', color:'#00d4ff', width:1, opacity:.3 });
  links.push({ from:'sstor1', to:'sstor2', color:'#00d4ff', width:2, flow:true });
  links.push({ from:'sstor2', to:'sstor3', color:'#00d4ff', width:1.8, flow:true, slow:true });
  // Storage to GPU servers
  [0,1,2,3].forEach(i => {
    links.push({ from:'sstor2', to:`gsrv${i+1}`, color:'#00d4ff', width:1, opacity:.2 });
  });

  const bands = [
    { y: 110, h: 60, color:'#ffd000', label:'GPU SPINE (COMPUTE FABRIC)' },
    { y: 235, h: 60, color:'#ff8c00', label:'GPU TOR' },
    { y: 355, h: 55, color:'#ff6600', label:'GPU SERVERS' },
  ];

  const meta = `${torXs.length} GPU TOR racks · ${torXs.length * 8} total GPU slots · ${selTOR ? selTOR.model : '—'} TOR · ${selSpine ? selSpine.model : '—'} spine`;
  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#ffd000"></div>GPU Spine (compute)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff8c00"></div>GPU TOR</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff"></div>Storage fabric</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ffd000"></div>OOB Management</div>
    <div class="legend-item"><div class="legend-line" style="border-top:2px dashed #ff8c00;width:22px"></div>RoCEv2 / RDMA flow</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff8c00;box-shadow:0 0 6px #ff8c00"></div>Live packet flow</div>`;

  return { svg: buildSVG({ nodes, links, bands, W, H: 460 }), title:'AI / GPU Cluster — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   WAN HLD
════════════════════════════════════════════════════════════════ */
function wanHLD() {
  const W = 1100, H = 500;
  const nodes = [], links = [];
  const bw = 120, bh = 42;

  nodes.push({ id:'inet', x: W/2 - 70, y: 30, w:140, h:44, label:'MPLS / INTERNET', icon:'🌍', ...C.internet, glow:true });
  nodes.push({ id:'hq-core', x: 90, y: 160, w:bw, h:bh, label:'HQ CORE RTR', sub:'Border/PE', icon:'⚙️', ...C.core });
  nodes.push({ id:'dc-spine', x: 90, y: 280, w:bw, h:bh, label:'DC SPINE', sub:'Data Center', icon:'🦴', ...C.dcspine });

  const branches = [
    { id:'br1', label:'Branch-01', sub:'CPE / SD-WAN', x:330 },
    { id:'br2', label:'Branch-02', sub:'CPE / SD-WAN', x:530 },
    { id:'br3', label:'Branch-03', sub:'CPE / SD-WAN', x:730 },
    { id:'br4', label:'Branch-04', sub:'CPE / SD-WAN', x:930 },
  ];
  branches.forEach(b => {
    nodes.push({ ...b, y:160, w:bw, h:bh, icon:'📡', ...C.access });
    links.push({ from:'inet', to:b.id, color:'#1a7fff', width:2, flow:true });
    const bsw = `bsw-${b.id}`;
    nodes.push({ id:bsw, x:b.x, y:300, w:bw, h:bh, label:'Branch SW', sub:'Access', icon:'🔌', ...C.dist, fontSize:8 });
    links.push({ from:b.id, to:bsw, color:'#00d4ff', width:1.5 });
  });

  links.push({ from:'inet', to:'hq-core', color:'#9955ff', width:2.5, flow:true });
  links.push({ from:'hq-core', to:'dc-spine', color:'#00e87a', width:2, flow:true });
  links.push({ from:'hq-core', to:'br1', color:'#1a7fff', width:1, opacity:.3 });

  const bands = [
    { y: 140, h:62, color:'#1a7fff', label:'WAN / SD-WAN EDGE' },
    { y: 260, h:62, color:'#00d4ff', label:'BRANCH / DC ACCESS' },
  ];
  const meta = `WAN topology · ${branches.length} branch sites · HQ + DC hub`;
  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#1a7fff"></div>WAN Edge / CPE</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9955ff"></div>HQ Core</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00e87a"></div>DC Spine</div>`;
  return { svg: buildSVG({ nodes, links, bands, W, H: 400 }), title:'WAN / SD-WAN — High Level Design', meta, legend };
}

/* Hybrid = campus + dc side by side */
function hybridHLD() {
  const c = campusHLD();
  const d = dcHLD();
  return { svg: c.svg, title:'Hybrid Campus + DC — High Level Design', meta: c.meta, legend: c.legend + d.legend };
}

/* ════════════════════════════════════════════════════════════════
   LLD — IP ADDRESSING PLAN
════════════════════════════════════════════════════════════════ */
function renderIPPlan() {
  const uc   = STATE.uc;
  const site = parseInt(STATE.numSites) || 1;
  const isDC = uc === 'dc' || uc === 'hybrid';
  const isGPU= uc === 'gpu';

  // IP block summary cards
  const blocks = [
    { label:'MANAGEMENT',      subnet:'10.0.0.0/24',    detail:`VLAN 10 · ${site} site(s)`,       range:'10.0.0.1 – 10.0.0.254' },
    { label:'LOOPBACKS',       subnet:'10.255.0.0/24',  detail:'Device loopback /32 addresses',   range:'10.255.0.1 – 10.255.0.254' },
    { label:'P2P FABRIC LINKS',subnet:'10.100.0.0/23',  detail:'/31 per link pair',               range:'10.100.0.0 – 10.100.1.255' },
    { label:'CORPORATE DATA',  subnet:'10.10.0.0/22',   detail:'VLAN 20 · End user devices',     range:'10.10.0.1 – 10.10.3.254' },
    { label:'VOICE / UC',      subnet:'10.20.0.0/23',   detail:'VLAN 30 · IP Phones, UC',        range:'10.20.0.1 – 10.20.1.254' },
    { label:'WIRELESS CORP',   subnet:'10.30.0.0/22',   detail:'VLAN 40 · Corp Wi-Fi',           range:'10.30.0.1 – 10.30.3.254' },
    { label:'SERVER VLAN',     subnet:'10.50.0.0/22',   detail:'VLAN 50 · Physical servers',     range:'10.50.0.1 – 10.50.3.254' },
    { label:'DMZ / PUBLIC',    subnet:'10.60.0.0/24',   detail:'VLAN 60 · Internet-facing',      range:'10.60.0.1 – 10.60.0.254' },
  ];
  if (isDC) {
    blocks.push({ label:'DC UNDERLAY /31',   subnet:'10.1.0.0/20',   detail:'Spine-Leaf P2P links',  range:'10.1.0.0 – 10.1.15.255' });
    blocks.push({ label:'DC OVERLAY (VNI)',  subnet:'10.200.0.0/14', detail:'VXLAN tenant subnets',  range:'10.200.0.1 – 10.203.255.254' });
  }
  if (isGPU) {
    blocks.push({ label:'GPU COMPUTE',   subnet:'192.168.100.0/22', detail:'RoCEv2 RDMA fabric',     range:'192.168.100.1 – 192.168.103.254' });
    blocks.push({ label:'STORAGE FABRIC',subnet:'192.168.200.0/23', detail:'NVMe-oF / NFS access',  range:'192.168.200.1 – 192.168.201.254' });
  }

  document.getElementById('ip-blocks').innerHTML = blocks.map(b => `
    <div class="ip-block-card">
      <div class="ibc-label">${b.label}</div>
      <div class="ibc-subnet">${b.subnet}</div>
      <div class="ibc-detail">${b.detail}</div>
      <div class="ibc-range">${b.range}</div>
    </div>`).join('');

  // Detail rows
  const rows = [];
  const addRow = (dev, layer, iface, ip, subnet, purpose) =>
    rows.push(`<tr><td>${dev}</td><td>${layer}</td><td class="mono">${iface}</td>
      <td class="mono">${ip}</td><td class="mono">${subnet}</td><td>${purpose}</td></tr>`);

  if (uc === 'campus' || uc === 'hybrid') {
    addRow('FW-01',   '<span class="pill-layer pl-fw">Security</span>',    'GigabitEthernet0/0', '10.0.0.1',    '/30', 'Outside / Internet uplink');
    addRow('FW-01',   '<span class="pill-layer pl-fw">Security</span>',    'GigabitEthernet0/1', '10.0.0.2',    '/30', 'Inside / Core downlink');
    addRow('FW-01',   '<span class="pill-layer pl-fw">Security</span>',    'Loopback0',          '10.255.0.1',  '/32', 'Router ID / BGP');
    addRow('CORE-01', '<span class="pill-layer pl-core">Core</span>',      'Loopback0',          '10.255.0.10', '/32', 'Router ID / OSPF');
    addRow('CORE-01', '<span class="pill-layer pl-core">Core</span>',      'Vlan10',             '10.0.0.10',   '/24', 'Management SVI gateway');
    addRow('CORE-01', '<span class="pill-layer pl-core">Core</span>',      'Vlan20',             '10.10.0.1',   '/22', 'Corporate data gateway');
    addRow('DIST-01', '<span class="pill-layer pl-dist">Dist</span>',      'Loopback0',          '10.255.0.20', '/32', 'Router ID');
    addRow('DIST-01', '<span class="pill-layer pl-dist">Dist</span>',      'Et0/0 (P2P→CORE)',   '10.100.0.1',  '/31', 'Core uplink P2P');
    addRow('DIST-02', '<span class="pill-layer pl-dist">Dist</span>',      'Loopback0',          '10.255.0.21', '/32', 'Router ID');
    addRow('DIST-02', '<span class="pill-layer pl-dist">Dist</span>',      'Et0/0 (P2P→CORE)',   '10.100.0.3',  '/31', 'Core uplink P2P');
    addRow('ACC-01',  '<span class="pill-layer pl-access">Access</span>',  'Vlan10',             '10.0.0.31',   '/24', 'Management');
    addRow('ACC-02',  '<span class="pill-layer pl-access">Access</span>',  'Vlan10',             '10.0.0.32',   '/24', 'Management');
  }
  if (isDC) {
    addRow('SPINE-01','<span class="pill-layer pl-spine">Spine</span>',    'Loopback0',          '10.255.1.1',  '/32', 'BGP Router-ID / VTEP');
    addRow('SPINE-01','<span class="pill-layer pl-spine">Spine</span>',    'Et1/1 (→LEAF-01)',   '10.1.0.0',    '/31', 'Underlay P2P');
    addRow('SPINE-01','<span class="pill-layer pl-spine">Spine</span>',    'Et1/2 (→LEAF-02)',   '10.1.0.2',    '/31', 'Underlay P2P');
    addRow('SPINE-02','<span class="pill-layer pl-spine">Spine</span>',    'Loopback0',          '10.255.1.2',  '/32', 'BGP Router-ID / VTEP');
    addRow('LEAF-01', '<span class="pill-layer pl-leaf">Leaf</span>',      'Loopback0',          '10.255.2.1',  '/32', 'BGP Router-ID');
    addRow('LEAF-01', '<span class="pill-layer pl-leaf">Leaf</span>',      'Loopback1 (VTEP)',   '10.255.3.1',  '/32', 'VXLAN NVE source');
    addRow('LEAF-01', '<span class="pill-layer pl-leaf">Leaf</span>',      'Et1/1 (→SPINE-01)',  '10.1.0.1',    '/31', 'Underlay P2P');
    addRow('LEAF-02', '<span class="pill-layer pl-leaf">Leaf</span>',      'Loopback0',          '10.255.2.2',  '/32', 'BGP Router-ID');
    addRow('LEAF-02', '<span class="pill-layer pl-leaf">Leaf</span>',      'Loopback1 (VTEP)',   '10.255.3.2',  '/32', 'VXLAN NVE source');
  }
  if (isGPU) {
    addRow('GPU-SPINE-01','<span class="pill-layer pl-tor">GPU Spine</span>', 'Loopback0',       '10.255.4.1',  '/32', 'BGP Router-ID');
    addRow('GPU-TOR-01',  '<span class="pill-layer pl-tor">GPU TOR</span>',  'Loopback0',        '10.255.5.1',  '/32', 'BGP Router-ID');
    addRow('GPU-TOR-01',  '<span class="pill-layer pl-tor">GPU TOR</span>',  'Et1/1 (RoCE)',     '192.168.100.1','/22','RoCEv2 compute fabric');
    addRow('GPU-TOR-02',  '<span class="pill-layer pl-tor">GPU TOR</span>',  'Et1/1 (RoCE)',     '192.168.100.129','/22','RoCEv2 compute fabric');
  }

  document.getElementById('ip-detail-tbody').innerHTML = rows.join('');
}

/* ════════════════════════════════════════════════════════════════
   LLD — VLAN DESIGN
════════════════════════════════════════════════════════════════ */
function renderVLANPlan() {
  const uc = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid';

  const vlans = [
    { id:10,  name:'MGMT',         subnet:'10.0.0.0/24',   gw:'10.0.0.1',    dhcp:'10.0.0.10–250',  purpose:'Network device OOB management',  layer:'pl-mgmt' },
    { id:20,  name:'CORP-DATA',    subnet:'10.10.0.0/22',  gw:'10.10.0.1',   dhcp:'10.10.0.10–1000',purpose:'Corporate user endpoints',        layer:'pl-access' },
    { id:21,  name:'GUEST',        subnet:'10.11.0.0/23',  gw:'10.11.0.1',   dhcp:'10.11.0.10–500', purpose:'Guest / BYOD (internet only)',    layer:'pl-access' },
    { id:30,  name:'VOICE',        subnet:'10.20.0.0/23',  gw:'10.20.0.1',   dhcp:'10.20.0.10–500', purpose:'IP Telephony / UC',               layer:'pl-dist' },
    { id:40,  name:'WIRELESS-CORP',subnet:'10.30.0.0/22',  gw:'10.30.0.1',   dhcp:'10.30.0.10–1000',purpose:'Corporate SSID (802.1X)',         layer:'pl-access' },
    { id:41,  name:'WIRELESS-GUEST',subnet:'10.31.0.0/22', gw:'10.31.0.1',   dhcp:'10.31.0.10–1000',purpose:'Guest SSID (captive portal)',     layer:'pl-access' },
    { id:50,  name:'SERVER-FARM',  subnet:'10.50.0.0/22',  gw:'10.50.0.1',   dhcp:'Static only',    purpose:'Physical & VM servers',          layer:'pl-dist' },
    { id:60,  name:'DMZ',          subnet:'10.60.0.0/24',  gw:'10.60.0.1',   dhcp:'Static only',    purpose:'Internet-facing / public SVC',   layer:'pl-fw' },
    { id:99,  name:'NATIVE-TRUNK', subnet:'—',             gw:'—',           dhcp:'—',              purpose:'Native VLAN on trunk links',     layer:'pl-mgmt' },
  ];
  if (isDC) {
    vlans.push({ id:100, name:'DC-TENANT-A', subnet:'10.200.0.0/22', gw:'10.200.0.1', dhcp:'Dynamic', purpose:'DC tenant A (VNI 100000)', layer:'pl-leaf' });
    vlans.push({ id:101, name:'DC-TENANT-B', subnet:'10.200.4.0/22', gw:'10.200.4.1', dhcp:'Dynamic', purpose:'DC tenant B (VNI 100001)', layer:'pl-leaf' });
    vlans.push({ id:200, name:'DC-STORAGE',  subnet:'10.201.0.0/22', gw:'10.201.0.1', dhcp:'Static',  purpose:'Storage network (iSCSI/NFS)', layer:'pl-dist' });
  }

  document.getElementById('vlan-tbody').innerHTML = vlans.map(v => `
    <tr>
      <td><strong>${v.id}</strong></td>
      <td>${v.name}</td>
      <td class="mono">${v.subnet}</td>
      <td class="mono">${v.gw}</td>
      <td class="mono" style="font-size:.72rem">${v.dhcp}</td>
      <td style="color:var(--txt1)">${v.purpose}</td>
      <td><span class="pill-layer ${v.layer}">${v.layer.replace('pl-','')}</span></td>
    </tr>`).join('');
}

/* VNI table */
function renderVNITable() {
  const vnis = [
    { vni:100000, vlan:100, type:'L2', vrf:'TENANT-A', irb:'10.200.0.1/22',  rt:'65000:100' },
    { vni:100001, vlan:101, type:'L2', vrf:'TENANT-B', irb:'10.200.4.1/22',  rt:'65000:101' },
    { vni:100050, vlan:50,  type:'L2', vrf:'DEFAULT',  irb:'10.50.0.1/22',   rt:'65000:50'  },
    { vni:999000, vlan:'—', type:'L3 (IP-VRF)', vrf:'TENANT-A', irb:'Anycast 10.200.0.1', rt:'65000:9000' },
    { vni:999001, vlan:'—', type:'L3 (IP-VRF)', vrf:'TENANT-B', irb:'Anycast 10.200.4.1', rt:'65000:9001' },
  ];
  document.getElementById('vni-tbody').innerHTML = vnis.map(v => `
    <tr>
      <td class="mono" style="color:var(--orange)">${v.vni}</td>
      <td>${v.vlan}</td>
      <td><span class="pill-layer pl-leaf">${v.type}</span></td>
      <td>${v.vrf}</td>
      <td class="mono">${v.irb}</td>
      <td class="mono" style="color:var(--txt2)">${v.rt}</td>
    </tr>`).join('');
}

/* ════════════════════════════════════════════════════════════════
   LLD — BGP / ROUTING DESIGN
════════════════════════════════════════════════════════════════ */
function renderBGPDesign() {
  const uc   = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid';
  const isCampus = uc === 'campus' || uc === 'hybrid';
  const isGPU = uc === 'gpu';

  const asnRows = [];
  const protoRows = [];

  if (isCampus) {
    asnRows.push(['CORE-01 / CORE-02', 'Core', '65100', 'iBGP Route Reflector', 'DIST-01..04', 'IPv4 Unicast, VPNv4']);
    asnRows.push(['DIST-01',           'Dist', '65100', 'iBGP RR Client',        'CORE-01',     'IPv4 Unicast']);
    asnRows.push(['DIST-02',           'Dist', '65100', 'iBGP RR Client',        'CORE-01',     'IPv4 Unicast']);
    asnRows.push(['FW-01',             'FW',   '65200', 'eBGP upstream',         'CORE-01',     'IPv4 Unicast']);
    protoRows.push(['OSPF Area 0','Underlay (Campus)','Process 1 · Router-ID per device','Hello 10s / Dead 40s','10.0.0.0/8 summary']);
    protoRows.push(['BGP 65100','Campus iBGP','Route Reflector CORE-01/02','Keepalive 60s / Hold 180s','Default + site prefixes']);
  }
  if (isDC) {
    asnRows.push(['SPINE-01',   'DC Spine', '65000', 'eBGP Route Reflector (EVPN)', 'LEAF-01..04',           'IPv4 Unicast, L2VPN EVPN']);
    asnRows.push(['SPINE-02',   'DC Spine', '65000', 'eBGP Route Reflector (EVPN)', 'LEAF-01..04',           'IPv4 Unicast, L2VPN EVPN']);
    asnRows.push(['LEAF-01',    'DC Leaf',  '65001', 'eBGP (to both spines)',        'SPINE-01, SPINE-02',    'IPv4 Unicast, L2VPN EVPN']);
    asnRows.push(['LEAF-02',    'DC Leaf',  '65002', 'eBGP (to both spines)',        'SPINE-01, SPINE-02',    'IPv4 Unicast, L2VPN EVPN']);
    asnRows.push(['LEAF-03',    'DC Leaf',  '65003', 'eBGP (to both spines)',        'SPINE-01, SPINE-02',    'IPv4 Unicast, L2VPN EVPN']);
    asnRows.push(['LEAF-04',    'DC Leaf',  '65004', 'eBGP (to both spines)',        'SPINE-01, SPINE-02',    'IPv4 Unicast, L2VPN EVPN']);
    protoRows.push(['IS-IS L2','DC Underlay','NET 49.0001.xxxx.xxxx.xxxx.00 · wide metrics','Hello 3s / Dead 9s','Loopback0 + P2P /31 links']);
    protoRows.push(['BGP 65000 / 650xx','EVPN Overlay','EVPN type 2 (MAC-IP), type 3 (IMET), type 5 (IP Prefix)','Keepalive 3s / Hold 9s','VNI prefix routes + MAC routes']);
  }
  if (isGPU) {
    asnRows.push(['GPU-SPINE-01', 'GPU Spine', '65010', 'eBGP upstream', 'GPU-TOR-01..04', 'IPv4 Unicast']);
    asnRows.push(['GPU-TOR-01',   'GPU TOR',   '65011', 'eBGP to spines', 'GPU-SPINE-01/02','IPv4 Unicast']);
    protoRows.push(['BGP 6501x','GPU Fabric','Unnumbered eBGP on P2P links · ECMP 64-way','Keepalive 1s / Hold 3s','Server loopbacks + GPU subnets']);
    protoRows.push(['PFC / ECN','RoCEv2 QoS','Priority Flow Control on priority 3 · ECN threshold 150KB','N/A','All GPU-server facing ports']);
  }

  const layerPill = (l) => {
    const m = { 'Core':'pl-core','Dist':'pl-dist','FW':'pl-fw','DC Spine':'pl-spine','DC Leaf':'pl-leaf','GPU Spine':'pl-tor','GPU TOR':'pl-tor' };
    return `<span class="pill-layer ${m[l]||'pl-mgmt'}">${l}</span>`;
  };

  document.getElementById('asn-tbody').innerHTML = asnRows.map(r => `
    <tr>
      <td><strong>${r[0]}</strong></td>
      <td>${layerPill(r[1])}</td>
      <td><span class="asn-badge">${r[2]}</span></td>
      <td style="color:var(--txt1)">${r[3]}</td>
      <td class="mono" style="font-size:.72rem">${r[4]}</td>
      <td style="color:var(--txt2)">${r[5]}</td>
    </tr>`).join('');

  document.getElementById('proto-tbody').innerHTML = protoRows.map(r => `
    <tr>
      <td><strong>${r[0]}</strong></td>
      <td>${r[1]}</td>
      <td style="color:var(--txt1)">${r[2]}</td>
      <td class="mono">${r[3]}</td>
      <td style="color:var(--txt2)">${r[4]}</td>
    </tr>`).join('');
}

/* ════════════════════════════════════════════════════════════════
   LLD — PHYSICAL CONNECTIVITY
════════════════════════════════════════════════════════════════ */
function renderPhysical() {
  const uc   = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid';
  const isCampus = uc === 'campus' || uc === 'hybrid';
  const isGPU = uc === 'gpu';
  const red  = STATE.redundancy;
  const dual = red === 'ha' || red === 'full';

  const rows = [];
  const r = (a,ia,b,ib,lag,spd,cable,pur) =>
    rows.push(`<tr><td>${a}</td><td class="mono">${ia}</td><td>${b}</td>
      <td class="mono">${ib}</td><td class="mono">${lag||'—'}</td>
      <td><span class="badge badge-blue">${spd}</span></td>
      <td style="color:var(--txt2)">${cable}</td><td style="color:var(--txt1)">${pur}</td></tr>`);

  if (isCampus) {
    r('FW-01','GE0/1','CORE-01','GE1/1','—','10GbE','SFP+ DAC','FW→Core uplink');
    if (dual) r('FW-02','GE0/1','CORE-02','GE1/1','—','10GbE','SFP+ DAC','FW-HA→Core-HA');
    r('CORE-01','Te1/1','DIST-01','Te0/1','Po10','10GbE','SFP+ DAC','Core→Dist-01 LAG');
    r('CORE-01','Te1/2','DIST-01','Te0/2','Po10','10GbE','SFP+ DAC','Core→Dist-01 LAG');
    r('CORE-01','Te2/1','DIST-02','Te0/1','Po11','10GbE','SFP+ DAC','Core→Dist-02 LAG');
    if (dual) r('CORE-02','Te1/1','DIST-01','Te0/3','Po20','10GbE','SFP+ DAC','Core-HA→Dist-01 LAG');
    r('DIST-01','Gi0/1','ACC-01','Gi0/49','Po1','1GbE','SFP-T / Cat6A','Dist→Access uplink');
    r('DIST-01','Gi0/2','ACC-02','Gi0/49','Po2','1GbE','SFP-T / Cat6A','Dist→Access uplink');
    r('ACC-01','Gi0/1-24','Endpoints','—','—','1GbE','Cat6A','User access ports');
    r('ACC-01','Gi0/48','IP-Phone','—','—','1GbE','Cat6A','PoE phone (VLAN 30)');
  }
  if (isDC) {
    r('SPINE-01','Et1/1','LEAF-01','Et49/1','—','100GbE','QSFP28 DAC','Spine→Leaf full-mesh');
    r('SPINE-01','Et1/2','LEAF-02','Et49/1','—','100GbE','QSFP28 DAC','Spine→Leaf full-mesh');
    r('SPINE-01','Et1/3','LEAF-03','Et49/1','—','100GbE','QSFP28 DAC','Spine→Leaf full-mesh');
    r('SPINE-01','Et1/4','LEAF-04','Et49/1','—','100GbE','QSFP28 DAC','Spine→Leaf full-mesh');
    r('SPINE-02','Et1/1','LEAF-01','Et50/1','—','100GbE','QSFP28 DAC','Spine→Leaf full-mesh');
    r('LEAF-01','Et1/1','SERVER-01','eth0','—','25GbE','SFP28 DAC','Server NIC-A (primary)');
    r('LEAF-01','Et1/2','SERVER-01','eth1','—','25GbE','SFP28 DAC','Server NIC-A (redundant)');
    r('LEAF-01','Et2/1','SERVER-02','eth0','—','25GbE','SFP28 DAC','Server NIC-A');
    r('LEAF-01','vPC Peer-Link','LEAF-02','vPC Peer','Po1000','2x100GbE','QSFP28 MMF','vPC/MLAG peer link');
  }
  if (isGPU) {
    r('GPU-SPINE-01','Et1/1','GPU-TOR-01','Et49/1','—','400GbE','QSFP-DD DAC','Spine→TOR uplink');
    r('GPU-SPINE-01','Et1/2','GPU-TOR-02','Et49/1','—','400GbE','QSFP-DD DAC','Spine→TOR uplink');
    r('GPU-SPINE-02','Et1/1','GPU-TOR-01','Et50/1','—','400GbE','QSFP-DD DAC','Spine→TOR uplink');
    r('GPU-TOR-01','Et1/1','GPU-SVR-01','mlx5_0','—','400GbE','QSFP-DD AOC','GPU server RoCEv2 NIC');
    r('GPU-TOR-01','Et1/2','GPU-SVR-02','mlx5_0','—','400GbE','QSFP-DD AOC','GPU server RoCEv2 NIC');
    r('STOR-SPINE-01','Et1/1','STOR-LEAF-01','Et49/1','—','100GbE','QSFP28 DAC','Storage fabric');
    r('STOR-LEAF-01','Et1/1','GPU-SVR-01','mlx5_1','—','100GbE','QSFP28 AOC','GPU server storage NIC');
  }

  document.getElementById('phy-tbody').innerHTML = rows.join('');
}

/* ── Exports ────────────────────────────────────────────────────── */
function exportSVG() {
  const svg = document.querySelector('#hld-svg-container svg');
  if (!svg) { toast('Generate the diagram first', 'error'); return; }
  const blob = new Blob([svg.outerHTML], { type:'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `netdesign-hld-${STATE.uc}-${Date.now()}.svg`;
  a.click();
  toast('HLD exported as SVG', 'success');
}

function exportLLD() {
  let csv = 'Section,Device,Layer,Interface,IP,Subnet,Purpose\n';
  document.querySelectorAll('#ip-detail-tbody tr').forEach(tr => {
    const cells = [...tr.querySelectorAll('td')].map(td => `"${td.textContent.trim()}"`);
    csv += cells.join(',') + '\n';
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
  a.download = `netdesign-lld-${Date.now()}.csv`;
  a.click();
  toast('LLD IP plan exported', 'success');
}

function printDesign() {
  window.print();
}

