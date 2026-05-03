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
  renderRefArchitectures();
  // Show VXLAN section if overlay selected
  const hasVxlan = (STATE.overlayProto || []).some(o => o.includes('VXLAN'));
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

  /* ── link protocol badges (pill label at midpoint of each link) ── */
  const badgesSVG = links.filter(lk => lk.badge).map(lk => {
    const a = nodeMap[lk.from], b = nodeMap[lk.to];
    if (!a || !b) return '';
    const aw = a.w || 115, ah = a.h || 42;
    const bw2 = b.w || 115, bh2 = b.h || 42;
    const x1 = a.x + aw / 2, y1 = a.y + ah;
    const x2 = b.x + bw2 / 2, y2 = b.y;
    const sameRow = Math.abs(a.y - b.y) < 10;
    const mx = (x1 + x2) / 2;
    const my = sameRow ? (a.y + ah / 2) - 12 : (y1 + y2) / 2;
    const txt = lk.badge;
    const tw  = txt.length * 5.8 + 14;
    const col = lk.color || '#2a4a90';
    return `
    <rect x="${mx - tw/2}" y="${my - 8}" width="${tw}" height="16" rx="4"
      fill="#060b18" stroke="${col}99" stroke-width="1.2" opacity=".96"/>
    <text x="${mx}" y="${my + 3}" text-anchor="middle" fill="${col}"
      font-size="7.5" font-weight="800" font-family="monospace" letter-spacing=".4">${txt}</text>`;
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
    ${badgesSVG}
    ${nodesSVG}
    ${packetsSVG}
  </svg>`;
}

/* ── Colour palette helpers ─────────────────────────────────────── */
const C = {
  internet: { fill:'#0a1e3a', stroke:'#1a7fff' },
  fw:       { fill:'#2a0a0f', stroke:'#ff3355' },
  corpfw:   { fill:'#2a0615', stroke:'#ff6688' },   // internal/corporate FW
  lb:       { fill:'#150020', stroke:'#cc44ff' },   // load balancer / ADC
  dmzsw:    { fill:'#1a0e00', stroke:'#ff9900' },   // DMZ switch
  wanrtr:   { fill:'#071828', stroke:'#2288ff' },   // WAN/ISP edge router
  oob:      { fill:'#0a1020', stroke:'#5a6e99' },   // OOB management
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
  if (uc === 'campus')        result = campusHLD();
  else if (uc === 'dc')       result = dcHLD();
  else if (uc === 'gpu')      result = gpuHLD();
  else if (uc === 'wan')      result = wanHLD();
  else if (uc === 'multisite')result = multiSiteHLD();
  else                        result = hybridHLD();

  document.getElementById('hld-svg-container').innerHTML = result.svg;
  document.getElementById('hld-title').textContent  = result.title;
  document.getElementById('hld-meta').textContent   = result.meta;
  document.getElementById('hld-legend').innerHTML   = result.legend;
}

/* ════════════════════════════════════════════════════════════════
   PROTOCOL HELPERS — used by all HLD builders
════════════════════════════════════════════════════════════════ */
function _protos() {
  const ul = STATE.underlayProto || [];
  const ov = STATE.overlayProto  || [];
  return {
    hasOSPF:  ul.includes('OSPF'),
    hasEIGRP: ul.includes('EIGRP'),
    hasISIS:  ul.includes('IS-IS'),
    hasBGP:   ul.includes('BGP'),
    hasStatic:ul.includes('Static'),
    hasVXLAN: ov.some(p => p.includes('VXLAN')),
    hasMPLS:  ov.some(p => p.includes('MPLS')),
    hasIPsec: ov.includes('IPsec'),
    hasGRE:   ov.includes('GRE'),
    noOverlay:ov.includes('None') || ov.length === 0,
    underlayLabel() {
      if (this.hasOSPF)  return 'OSPF';
      if (this.hasEIGRP) return 'EIGRP';
      if (this.hasISIS)  return 'IS-IS';
      if (this.hasBGP)   return 'BGP';
      if (this.hasStatic)return 'Static';
      return 'L3';
    },
    overlayLabel() {
      if (this.hasVXLAN) return 'VXLAN/EVPN';
      if (this.hasMPLS)  return 'MPLS/SR';
      if (this.hasGRE)   return 'GRE Tunnel';
      if (this.hasIPsec) return 'IPsec';
      return 'No Overlay';
    },
    // Short badge for core/dist/spine links
    coreBadge() {
      const u = this.underlayLabel();
      if (this.hasOSPF) return 'OSPF Area 0';
      if (this.hasISIS) return 'IS-IS L2';
      return u;
    },
    // Short badge for access/leaf links
    accessBadge() {
      if (this.hasOSPF)  return 'OSPF Stub';
      if (this.hasEIGRP) return 'EIGRP';
      return this.underlayLabel();
    },
  };
}

/* ════════════════════════════════════════════════════════════════
   CAMPUS HLD  —  Enhanced multi-tier with per-zone distribution
   Layers:
     Internet cloud → WAN/ISP Edge Routers (BGP eBGP dual-homed)
     → Internet Perimeter FW (HA pair)
     → Campus Core (HA pair, VSS/StackWise)
     → Per-Zone Distribution (Floor 1 / Floor 2 / Server Farm / IoT-Guest)
     → Access layer (per zone, 802.1X, PoE+)
     → Endpoints (PCs, Phones, Wi-Fi APs, IoT, Servers)
     Side-car: WLC (CAPWAP), OOB Management Switch
════════════════════════════════════════════════════════════════ */
function campusHLD() {
  const W   = 1100;
  const red = STATE.redundancy;
  const dual = red === 'ha' || red === 'full';
  const haFW = STATE.fwModel && STATE.fwModel !== 'none';

  // ── Capacity model ────────────────────────────────────────────
  const cap  = campusCapacity(parseInt(STATE.totalHosts) || 100, {
    sites: parseInt(STATE.numSites) || 1,
    redundancy: red,
  });
  const totalAccess = cap.access;
  const totalDist   = cap.dist;
  const totalCore   = cap.core;
  const zoneAccess  = cap.zoneAccess;   // [FL1, FL2, SRV, IoT]

  const hasWifi  = (STATE.nac || []).some(n => /wireless/i.test(n)) ||
                   (STATE.appTypes || []).some(a => /voice|video|wireless/i.test(a)) ||
                   (STATE.protoFeatures || []).some(f => /wireless/i.test(f));
  const hasIoT   = (STATE.appTypes || []).some(a => /iot|bms|ot|scada/i.test(a));
  const hasVoice = (STATE.appTypes || []).some(a => /voice|phone|ucm|cucm/i.test(a));
  const hasDot1x = (STATE.nac || []).some(n => /802\.1x|dot1x|nac/i.test(n));

  const selAccess = PRODUCTS[STATE.selectedProducts['campus-access']];
  const selDist   = PRODUCTS[STATE.selectedProducts['campus-dist']];
  const selCore   = PRODUCTS[STATE.selectedProducts['campus-core']];
  const selFW     = PRODUCTS[STATE.selectedProducts['fw']];
  const P = _protos();

  // ── Row Y positions ────────────────────────────────────────────
  const yInternet = 22;
  const yWanRtr   = 100;   // WAN / ISP edge routers (BGP eBGP dual-homed)
  const yFW       = 188;   // Internet perimeter FW
  const yCore     = 280;   // Campus core switches
  const yDist     = 378;   // Distribution — 4 zones / floors
  const yAccess   = 476;   // Access layer
  const yEP       = 575;   // Endpoints
  const H         = yEP + 90;

  const nodes = [], links = [];
  const bw = 115, bh = 42;

  // ── Internet Cloud ─────────────────────────────────────────────
  nodes.push({ id:'inet', x: W/2 - 75, y: yInternet, w:155, h:46,
    label:'INTERNET / ISP', icon:'🌐', ...C.internet, glow:true });

  // ── WAN / ISP Edge Routers ─────────────────────────────────────
  // Dual-homed for ISP diversity; BGP eBGP peering with ISP
  const wanXs = dual ? [268, 710] : [W/2 - 57];
  wanXs.forEach((x, i) => {
    const id = `wanrtr${i+1}`;
    nodes.push({ id, x, y: yWanRtr, w: bw, h: bh,
      label: `WAN-RTR-0${i+1}`, sub:'ISP Edge · BGP eBGP',
      icon:'🌐', ...C.wanrtr });
    links.push({ from:'inet', to:id, color:'#2288ff', width:2.2, flow:true,
      badge: i === 0 ? 'BGP eBGP' : undefined });
  });
  if (dual) {
    links.push({ from:'wanrtr1', to:'wanrtr2', color:'#2288ff', width:1, opacity:.22,
      badge:'ISP Diversity' });
  }

  // ── Internet Perimeter Firewall (HA pair) ──────────────────────
  // Stateful inspection, NAT, IPS, URL filtering
  const fwXs = dual ? [268, 710] : [W/2 - 57];
  fwXs.forEach((x, i) => {
    const id = `fw${i+1}`;
    nodes.push({ id, x, y: yFW, w: bw, h: bh,
      label: selFW ? selFW.model.slice(0,16) : `FW-0${i+1}`,
      sub: selFW ? `${selFW.vendor} · Perimeter` : 'Perimeter FW · IPS',
      icon:'🔒', ...C.fw });
    links.push({ from:`wanrtr${Math.min(i+1, wanXs.length)}`, to:id,
      color:'#ff3355', width:2, flow:true,
      badge: i === 0 ? 'NAT · IPS · URL' : undefined });
  });
  if (dual) {
    links.push({ from:'fw1', to:'fw2', color:'#ff3355', width:1.2, opacity:.4,
      badge:'FW HA Sync' });
  }

  // ── Campus Core (HA pair) ─────────────────────────────────────
  // Dual-core for VSS/StackWise-Virtual; L3 routing backbone
  const coreXs = dual ? [268, 710] : [W/2 - 57];
  coreXs.forEach((x, i) => {
    const id = `core${i+1}`;
    nodes.push({ id, x, y: yCore, w: bw, h: bh,
      label: selCore ? selCore.model.slice(0,16) : `CORE-0${i+1}`,
      sub: selCore ? `${selCore.vendor} · ${P.underlayLabel()}` : `Core · ${P.underlayLabel()}`,
      icon:'⚙️', ...C.core, glow:true });
    links.push({ from:`fw${Math.min(i+1, fwXs.length)}`, to:id,
      color:'#9955ff', width:2.2, flow:true,
      badge: i === 0 ? P.coreBadge() : undefined });
  });
  if (dual) {
    links.push({ from:'core1', to:'core2', color:'#9955ff', width:1.6, opacity:.45,
      badge: P.hasOSPF ? 'VSS · StackWise-Virtual' : 'Core ISL' });
  }

  // ── WLC — Wireless LAN Controller ─────────────────────────────
  if (hasWifi) {
    nodes.push({ id:'wlc', x:918, y:yCore, w:132, h:bh,
      label:'WLC / Mobility', sub:'CAPWAP · 9800-CL', icon:'📶',
      fill:'#071828', stroke:'#00e87a' });
    links.push({ from: dual ? 'core2' : 'core1', to:'wlc',
      color:'#00e87a', width:1.4, opacity:.8, badge:'CAPWAP' });
  }

  // ── OOB Management Switch ─────────────────────────────────────
  nodes.push({ id:'oob-sw', x:918, y:yFW, w:132, h:bh,
    label:'OOB-MGMT-SW', sub:'Out-of-Band · VRF MGMT', icon:'🛡',
    ...C.oob });
  links.push({ from: dual ? 'fw2' : 'fw1', to:'oob-sw',
    color:'#5a6e99', width:1, opacity:.5 });

  // ── Distribution — 4 zones / floors ───────────────────────────
  // Each zone represents a HA distribution pair (MLAG/vPC).
  // Node label shows actual count from capacity model.
  const distPerZone = Math.max(1, Math.ceil(totalDist / 4));
  const zones = [
    { id:'dist1', lbl:'DIST-FL1',  sub:`Floor 1 · VLAN 10/30/40 · ×${distPerZone} sw`,   icon:'🔀', x:50  },
    { id:'dist2', lbl:'DIST-FL2',  sub:`Floor 2 · VLAN 11/31/41 · ×${distPerZone} sw`,   icon:'🔀', x:280 },
    { id:'dist3', lbl:'DIST-SRV',  sub:`Server Farm · VLAN 50/51 · ×${distPerZone} sw`,  icon:'🔀', x:515 },
    { id:'dist4', lbl:'DIST-IOT',  sub:`IoT/Guest · VLAN 60/61/21 · ×${Math.max(1,totalDist-distPerZone*3)} sw`, icon:'🔀', x:752 },
  ];
  zones.forEach((z, i) => {
    nodes.push({ id:z.id, x:z.x, y:yDist, w:bw, h:bh,
      label: selDist ? selDist.model.slice(0,13) : z.lbl,
      sub:   selDist
        ? `${selDist.vendor} · ${z.sub.split('·').slice(-1)[0].trim()}`
        : z.sub,
      icon:z.icon, ...C.dist });
    // Dual uplink: each dist connects to BOTH core switches
    links.push({ from:'core1', to:z.id, color:'#00d4ff', width:1.8, flow:true, slow:true,
      badge: i === 0 ? P.coreBadge() : undefined });
    if (dual) {
      links.push({ from:'core2', to:z.id, color:'#00d4ff', width:1.4, opacity:.45 });
    }
    // MLAG/vPC peer-link between adjacent distribution pairs
    if (i % 2 === 0 && zones[i+1]) {
      links.push({ from:z.id, to:zones[i+1].id,
        color:'#00d4ff', width:1, opacity:.18,
        badge: i === 0 ? 'MLAG ISL' : undefined });
    }
  });

  // ── Access Layer — one block per zone (represents N switches) ─
  const accTypes = [
    { lbl:'ACC-FL1',  sub:`×${zoneAccess[0]} sw · PoE+ · 802.1X${hasDot1x?' ISE':''}`, icon:'🔌' },
    { lbl:'ACC-FL2',  sub:`×${zoneAccess[1]} sw · PoE+ · 802.1X${hasDot1x?' ISE':''}`, icon:'🔌' },
    { lbl:'ACC-SRV',  sub:`×${zoneAccess[2]} sw · 10G NIC · Server Access`, icon:'🖥' },
    { lbl:'ACC-IOT',  sub:`×${zoneAccess[3]} sw · IoT VLAN · ACL`, icon:'🌡' },
  ];
  zones.forEach((z, i) => {
    const at = accTypes[i];
    nodes.push({ id:`acc${i+1}`, x:z.x, y:yAccess, w:bw, h:bh,
      label: selAccess ? selAccess.model.slice(0,13) : at.lbl,
      sub:   selAccess
        ? `${selAccess.vendor} · ${at.sub.split('·').slice(-1)[0].trim()}`
        : at.sub,
      icon:at.icon, ...C.access });
    links.push({ from:z.id, to:`acc${i+1}`, color:'#1a7fff', width:1.6, slow:true,
      badge: i === 0 ? P.accessBadge() : undefined });
  });

  // ── Endpoints — per zone, differentiated by function ─────────
  const epData = [
    { id:'ep1', icon:'💻',
      label: hasVoice ? 'PCs · IP Phones' : 'Workstations',
      fill:'#1a2a3a', stroke:'#3a5a8a' },
    { id:'ep2', icon: hasWifi ? '📡' : '💻',
      label: hasWifi ? 'Wi-Fi APs (CAPWAP)' : 'Floor 2 PCs',
      fill: hasWifi ? '#071828' : '#1a2a3a',
      stroke: hasWifi ? '#00e87a' : '#3a5a8a' },
    { id:'ep3', icon:'🖥',
      label:'App / DB Servers',
      fill:'#0d1520', stroke:'#5a6e99' },
    { id:'ep4', icon: hasIoT ? '🌡' : '📱',
      label: hasIoT ? 'IoT / BMS / OT' : 'Guest Devices',
      fill:'#1a0e00', stroke:'#ff9900' },
  ];
  zones.forEach((z, i) => {
    const ep = epData[i];
    nodes.push({ id:ep.id, x:z.x + 5, y:yEP, w:105, h:36,
      label:ep.label, icon:ep.icon,
      fill:ep.fill, stroke:ep.stroke, fontSize:7.5 });
    links.push({ from:`acc${i+1}`, to:ep.id, color:ep.stroke, width:1, opacity:.55 });
  });
  if (hasWifi) {
    links.push({ from:'wlc', to:'ep2', color:'#00e87a', width:1, opacity:.28 });
  }

  // ── Layer bands ───────────────────────────────────────────────
  const bands = [
    { y:yWanRtr  - 12, h:65, color:'#2288ff',
      label:'WAN EDGE — BGP eBGP · Dual-ISP · Route Filtering · AS-PATH hardening' },
    { y:yFW      - 12, h:65, color:'#ff3355',
      label:'INTERNET PERIMETER — Stateful FW · NAT · IPS · URL Filter · Anti-Malware' },
    { y:yCore    - 12, h:65, color:'#9955ff',
      label:`CAMPUS CORE — ${totalCore} switch${totalCore>1?'es':''} · ${P.coreBadge()} · VSS/StackWise-Virtual · L3 ECMP · Gateway` },
    { y:yDist    - 12, h:65, color:'#00d4ff',
      label:`DISTRIBUTION — ${totalDist} switches across 4 zones · MLAG/vPC HA pairs · Inter-VLAN Routing · STP Root · DHCP Relay` },
    { y:yAccess  - 12, h:65, color:'#1a7fff',
      label:`ACCESS — ${totalAccess} switches total · ${hasDot1x?'802.1X NAC · ':''} PoE+ · Port-Security · DAI · DHCP Snooping` },
    { y:yEP      - 12, h:55, color:'#5a6e99',
      label:`ENDPOINTS — ${cap.endpoints.toLocaleString()} devices (${cap.effective.toLocaleString()} w/growth) · PCs${hasVoice?' · IP Phones':''}${hasWifi?' · Wi-Fi APs':''}${hasIoT?' · IoT/BMS':''}` },
  ];

  const meta = `Capacity: ${totalAccess} access · ${totalDist} distribution · ${totalCore} core · ${cap.endpoints.toLocaleString()} endpoints → ${cap.effective.toLocaleString()} w/25% growth · ${dual?'HA':'single'} · ${P.underlayLabel()} underlay · ${selAccess?selAccess.model:'—'} access · ${selDist?selDist.model:'—'} dist${hasWifi?' · CAPWAP':''}${hasIoT?' · IoT':''}  `;

  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#2288ff"></div>WAN Edge / ISP BGP</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff3355"></div>Internet Perimeter FW</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9955ff"></div>Campus Core (${P.underlayLabel()})</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff"></div>Distribution (per zone/floor)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#1a7fff"></div>Access (802.1X · PoE+)</div>
    ${hasWifi ? `<div class="legend-item"><div class="legend-dot" style="background:#00e87a"></div>WLC / CAPWAP Wireless</div>` : ''}
    ${hasIoT  ? `<div class="legend-item"><div class="legend-dot" style="background:#ff9900"></div>IoT / BMS Zone (Isolated)</div>` : ''}
    <div class="legend-item"><div class="legend-dot" style="background:#5a6e99"></div>OOB Management</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff;box-shadow:0 0 6px #00d4ff"></div>Animated packet flow</div>`;

  return { svg:buildSVG({ nodes, links, bands, W, H }), title:'Campus Network — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   DATA CENTER (LEAF-SPINE) HLD
   Full multi-tier: WAN Edge → Internet FW → DMZ (LB ADC + DMZ SW)
                  → Corporate FW → CLOS Spines → Function-labeled
                    Leaves (PROD/STOR/DEV) → Server clusters
════════════════════════════════════════════════════════════════ */
function dcHLD() {
  const W = 1100;
  const red      = STATE.redundancy;
  const dual     = red === 'ha' || red === 'full';
  const selLeaf  = PRODUCTS[STATE.selectedProducts['dc-leaf']];
  const selSpine = PRODUCTS[STATE.selectedProducts['dc-spine']];
  const selFW    = PRODUCTS[STATE.selectedProducts['fw']];
  const P = _protos();

  // ── Capacity model ────────────────────────────────────────────
  const cap = dcCapacity(parseInt(STATE.totalHosts) || 100, { redundancy: red });
  const totalLeafs  = cap.leafs;
  const totalSpines = cap.spines;

  const underlayBadge = P.coreBadge();
  const overlayBadge  = P.overlayLabel();
  const spineASN = P.hasBGP || P.hasVXLAN ? 'AS 65000' : '';
  const leafASNs = P.hasBGP || P.hasVXLAN
    ? ['AS 65001','AS 65002','AS 65003','AS 65004'] : ['','','',''];

  // ── Row Y coordinates (7 tiers + internet) ───────────────────
  const yInternet = 22;
  const yEdgeRtr  = 98;    // WAN Edge Routers
  const yInetFW   = 183;   // Internet Perimeter FW (HA)
  const yDMZ      = 268;   // LB ADC pair + DMZ Switches
  const yCorpFW   = 358;   // Corporate / Internal FW (HA)
  const ySpine    = 443;   // DC CLOS Spines
  const yLeaf     = 533;   // Function-labeled Leaves
  const ySrv      = 623;   // Server clusters
  const H         = ySrv + 82;

  const nodes = [], links = [];
  const bw = 118, bh = 42;

  // X anchor sets
  const edgeXs = [215, 767];             // 2-node rows (routers, FWs, spines)
  const dmzXs  = [42, 302, 562, 822];   // 4-node rows (DMZ tier, leaves, servers)

  // ── Internet / WAN ────────────────────────────────────────────
  nodes.push({ id:'inet', x: W/2 - 70, y: yInternet, w:140, h:44,
    label:'INTERNET / WAN', icon:'🌐', ...C.internet, glow:true });

  // ── WAN Edge Routers — BGP eBGP dual-homed ───────────────────
  edgeXs.forEach((x, i) => {
    const id = `edgertr${i+1}`;
    nodes.push({ id, x, y: yEdgeRtr, w: bw, h: bh,
      label:`WAN-EDGE-0${i+1}`,
      sub:`BGP eBGP · Dual-ISP · AS 6400${i+1}`,
      icon:'🌐', ...C.wanrtr });
    links.push({ from:'inet', to:id, color:'#2288ff', width:2, flow:true,
      badge: i === 0 ? 'BGP eBGP' : undefined });
  });
  links.push({ from:'edgertr1', to:'edgertr2', color:'#2288ff', width:1.2, opacity:.35,
    badge:'eBGP Peer' });

  // ── Internet Perimeter FW — HA pair ──────────────────────────
  const inetFWBase = selFW ? selFW.model.slice(0,14) : 'INET-FW';
  const inetFWSub  = selFW
    ? `${selFW.vendor} · Internet Perimeter`
    : 'Stateful FW · NAT · IPS · URL Filter';
  edgeXs.forEach((x, i) => {
    const id = `inetfw${i+1}`;
    nodes.push({ id, x, y: yInetFW, w: bw, h: bh,
      label:`${inetFWBase}-0${i+1}`,
      sub: inetFWSub, icon:'🔥', ...C.fw });
    links.push({ from:`edgertr${i+1}`, to:id, color:'#ff3355', width:2, flow:true,
      badge: i === 0 ? 'Filtered traffic' : undefined });
  });
  links.push({ from:'inetfw1', to:'inetfw2', color:'#ff3355', width:1.2, opacity:.4,
    badge:'HA State Sync' });

  // ── DMZ Tier: LB ADC pair + DMZ Switch pair ───────────────────
  // LB-ADC-01/02 — L4/L7 application VIP hosting, SSL offload
  ['lb1','lb2'].forEach((id, i) => {
    nodes.push({ id, x: dmzXs[i], y: yDMZ, w: bw, h: bh,
      label:`LB-ADC-0${i+1}`,
      sub:'L4/L7 VIP · SSL Offload · SNAT · Health Checks',
      icon:'⚖️', ...C.lb });
    links.push({ from:`inetfw${i+1}`, to:id, color:'#cc44ff', width:1.8, flow:true,
      badge: i === 0 ? 'VIP inbound' : undefined });
  });
  links.push({ from:'lb1', to:'lb2', color:'#cc44ff', width:1.2, opacity:.38,
    badge:'ADC Config Sync' });

  // DMZ-SW-01/02 — isolated VLAN segments for DMZ services
  ['dmzsw1','dmzsw2'].forEach((id, i) => {
    nodes.push({ id, x: dmzXs[i + 2], y: yDMZ, w: bw, h: bh,
      label:`DMZ-SW-0${i+1}`,
      sub:'DMZ Segment · VLAN Isolated · iACL',
      icon:'🔀', ...C.dmzsw });
    links.push({ from:`inetfw${i+1}`, to:id, color:'#ff9900', width:1.5,
      badge: i === 0 ? 'DMZ zone' : undefined });
  });
  links.push({ from:'dmzsw1', to:'dmzsw2', color:'#cc6600', width:1.2, opacity:.35,
    badge:'DMZ ISL' });

  // ── Corporate / Internal FW — HA pair ────────────────────────
  const corpFWBase = selFW ? selFW.model.slice(0,13) : 'CORP-FW';
  const corpFWSub  = selFW
    ? `${selFW.vendor} · Internal Zones`
    : 'Zone Segmentation · iACL · East-West';
  edgeXs.forEach((x, i) => {
    const id = `corpfw${i+1}`;
    nodes.push({ id, x, y: yCorpFW, w: bw, h: bh,
      label:`${corpFWBase}-0${i+1}`,
      sub: corpFWSub, icon:'🛡', ...C.corpfw });
    // LB → Corp FW
    links.push({ from:`lb${i+1}`, to:id, color:'#9922cc', width:1.6, flow:true,
      badge: i === 0 ? 'Server-bound' : undefined });
    // DMZ SW → Corp FW
    links.push({ from:`dmzsw${i+1}`, to:id, color:'#9922cc', width:1.3 });
  });
  links.push({ from:'corpfw1', to:'corpfw2', color:'#9922cc', width:1.2, opacity:.4,
    badge:'HA State Sync' });

  // ── DC CLOS Spines — full-mesh to both Corp FWs ──────────────
  edgeXs.forEach((x, i) => {
    const id = `spine${i+1}`;
    nodes.push({ id, x, y: ySpine, w: bw, h: bh,
      label: selSpine ? selSpine.model.slice(0,14) : `SPINE-0${i+1}`,
      sub: (selSpine ? selSpine.vendor : 'DC Spine') +
           ` · ×${totalSpines} tot` + (spineASN ? ` · ${spineASN}` : ''),
      icon:'🦴', ...C.dcspine, glow:true });
    links.push({ from:'corpfw1', to:id, color:'#00e87a', width:2, flow:true,
      badge: (i === 0) ? underlayBadge : undefined });
    links.push({ from:'corpfw2', to:id, color:'#00e87a', width:2 });
  });
  links.push({ from:'spine1', to:'spine2', color:'#00e87a', width:1.4, opacity:.32,
    badge: P.hasOSPF ? 'OSPF RR' : (P.hasBGP ? 'iBGP RR' : 'ISL') });

  // ── DC Leaves — function-labeled PROD / STOR / DEV ───────────
  // HLD shows 4 representative leaves; actual count from capacity model
  const leafData = [
    { id:'leaf1', x:dmzXs[0], label:'LEAF-PROD',
      sub:`×${cap.prodLeafs} sw · PROD · ${leafASNs[0]||'ToR'}${P.hasVXLAN?' · VTEP':''}`, icon:'🍃' },
    { id:'leaf2', x:dmzXs[1], label:'LEAF-PROD-B',
      sub:`PROD-B Redundancy · ${leafASNs[1]||'ToR'}${P.hasVXLAN?' · VTEP':''}`, icon:'🍃' },
    { id:'leaf3', x:dmzXs[2], label:'LEAF-STOR',
      sub:`×${cap.storLeafs} sw · Storage · ${leafASNs[2]||'ToR'}${P.hasVXLAN?' · VTEP':''}`, icon:'🗄️' },
    { id:'leaf4', x:dmzXs[3], label:'LEAF-DEV',
      sub:`×${cap.devLeafs} sw · Dev/Test · ${leafASNs[3]||'ToR'}${P.hasVXLAN?' · VTEP':''}`, icon:'🧪' },
  ];
  leafData.forEach((ld, i) => {
    nodes.push({ id:ld.id, x:ld.x, y:yLeaf, w:bw, h:bh,
      label: selLeaf ? selLeaf.model.slice(0,13) : ld.label,
      sub:   selLeaf
               ? `${selLeaf.vendor} · ${ld.sub.split('·').pop().trim()}`
               : ld.sub,
      icon:ld.icon, ...C.dcleaf });
    // Both spines → each leaf (CLOS full-mesh)
    links.push({ from:'spine1', to:ld.id, color:'#5dcc8a', width:1.5, flow:true, slow:true,
      badge: i === 0 ? overlayBadge : undefined });
    links.push({ from:'spine2', to:ld.id, color:'#5dcc8a', width:1.5, flow:true, slow:true });
  });

  // ── Server Clusters — one per leaf ───────────────────────────
  const srvData = [
    { id:'srv1', label:'Prod Compute',  sub:'KVM / VMware ESXi',    icon:'🖥' },
    { id:'srv2', label:'App Servers',   sub:'Docker / Kubernetes',  icon:'📦' },
    { id:'srv3', label:'Storage Array', sub:'NVMe-oF / Ceph RBD',   icon:'🗄️' },
    { id:'srv4', label:'Dev / Test',    sub:'CI/CD · Sandbox VMs',  icon:'🧪' },
  ];
  srvData.forEach((sd, i) => {
    nodes.push({ id:sd.id, x: dmzXs[i] + 5, y: ySrv, w:108, h:38,
      label:sd.label, sub:sd.sub, icon:sd.icon,
      fill:'#0d1520', stroke:'#2a3a5a', fontSize:8 });
    links.push({ from:leafData[i].id, to:sd.id, color:'#2a3a5a', width:1, opacity:.65 });
  });

  // ── Layer bands ───────────────────────────────────────────────
  const bands = [
    { y:yEdgeRtr - 12, h:65, color:'#2288ff',
      label:'WAN EDGE — BGP eBGP · Dual-ISP · AS-PATH Hardening · Route Filtering · BFD' },
    { y:yInetFW  - 12, h:65, color:'#ff3355',
      label:'INTERNET PERIMETER FW — Stateful · NAT · IPS · URL Filter · Anti-Malware · SSL Inspect' },
    { y:yDMZ     - 12, h:65, color:'#ff9900',
      label:'DMZ TIER — LB ADC (L4/L7 VIP · SSL Offload · SNAT) + DMZ Switches (VLAN Isolated)' },
    { y:yCorpFW  - 12, h:65, color:'#9922cc',
      label:'CORPORATE / INTERNAL FW — Zone Segmentation · East-West Inspection · iACL · HA Pair' },
    { y:ySpine   - 12, h:65, color:'#00e87a',
      label:`SPINE — ${underlayBadge}${spineASN ? ' · '+spineASN : ''} · ECMP · Route Reflector · CLOS` },
    { y:yLeaf    - 12, h:65, color:'#5dcc8a',
      label:`LEAF / ToR — ${overlayBadge}${P.hasVXLAN?' · VTEP · Anycast GW':''} · PROD · STOR · DEV` },
    { y:ySrv     - 12, h:55, color:'#5a6e99',
      label:'SERVER CLUSTERS — Prod Compute · App Servers · Storage (NVMe-oF/Ceph) · Dev/Test' },
  ];

  const meta = `Capacity: ${totalLeafs} leaf switches (PROD ${cap.prodLeafs} / STOR ${cap.storLeafs} / DEV ${cap.devLeafs}) · ` +
    `${totalSpines} spines · ${cap.servers.toLocaleString()} servers · ` +
    `Oversubscription ${cap.oversub}:1 · ${cap.downlinkBW}G down / ${cap.uplinkBW}G up per leaf · ` +
    `Underlay: ${P.underlayLabel()} · Overlay: ${P.overlayLabel()} · ` +
    `${selLeaf?selLeaf.model:'—'} leaf · ${selSpine?selSpine.model:'—'} spine`;

  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#2288ff"></div>WAN Edge Routers (BGP eBGP)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff3355"></div>Internet Perimeter FW (HA)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#cc44ff"></div>Load Balancer ADC (L4/L7 VIP)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff9900"></div>DMZ Switches (Isolated VLAN)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9922cc"></div>Corporate / Internal FW (HA)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00e87a"></div>DC Spines (${P.underlayLabel()})</div>
    <div class="legend-item"><div class="legend-dot" style="background:#5dcc8a"></div>DC Leaves — PROD / STOR / DEV</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00e87a;box-shadow:0 0 6px #00e87a"></div>Animated packet flow</div>`;

  return { svg: buildSVG({ nodes, links, bands, W, H }), title:'Data Center Leaf-Spine — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   GPU / AI CLUSTER HLD
════════════════════════════════════════════════════════════════ */
function gpuHLD() {
  const W = 1100, H = 640;
  const selTOR   = PRODUCTS[STATE.selectedProducts['gpu-tor']];
  const selSpine = PRODUCTS[STATE.selectedProducts['gpu-spine']];

  // ── Capacity model ────────────────────────────────────────────
  const gpuCount  = parseInt(STATE.gpuCount || STATE.totalHosts) || 64;
  const gpuPerSrv = parseInt(STATE.gpusPerServer) || 8;
  const portSpd   = parseInt(STATE.portSpeed) || 100;
  const cap = gpuCapacity(gpuCount, {
    gpusPerServer: gpuPerSrv,
    speed: portSpd,
  });
  const totalTORs   = cap.tors;
  const totalSpines = cap.spines;

  // 3 fabrics: OOB MGMT | Compute | Storage
  const nodes = [], links = [];
  const bw = 115, bh = 40;

  // OOB MGMT
  nodes.push({ id:'oob', x: W/2 - 57, y: 25, w:bw, h:bh,
    label:'OOB MGMT SW', sub:'Management', icon:'🛡', ...C.dist });

  const P = _protos();
  const hasBGP   = P.hasBGP || true;
  const hasRoCE  = (STATE.gpuSpecifics || []).some(g => /RoCEv2/i.test(g));
  const hasPFC   = (STATE.gpuSpecifics || []).some(g => /PFC/i.test(g));
  const hasECN   = (STATE.gpuSpecifics || []).some(g => /ECN/i.test(g));
  const hasRailOpt = (STATE.gpuSpecifics || []).some(g => /rail/i.test(g));

  const fabricType  = hasRoCE ? 'RoCEv2 / RDMA' : 'Ethernet';
  const fabricBadge = hasRoCE ? 'RoCEv2' : 'Ethernet';

  // GPU Spines — show 2 representative nodes with total count badge
  [0,1].forEach(i => {
    const id = `gspine${i+1}`;
    nodes.push({ id, x: 130 + i * 480, y: 130, w:bw, h:bh,
      label: selSpine ? selSpine.model.slice(0,14) : `GPU-SPINE-0${i+1}`,
      sub: (selSpine ? `${selSpine.vendor} · ` : '') +
           `×${totalSpines} spines · BGP AS 65010`,
      icon:'🧠', ...C.gpuspine, glow:true });
    links.push({ from:'oob', to:id, color:'#ffd000', width:1, opacity:.3 });
  });
  links.push({ from:'gspine1', to:'gspine2', color:'#ffd000', width:1.5, opacity:.4,
    badge: `iBGP · ${cap.isNonBlocking?'1:1 non-blocking':'ECMP'}` });

  // GPU TORs — show up to 4 representative nodes, label with actual count
  const visibleTORs = Math.min(4, totalTORs);
  const torXs = [40, 260, 480, 700].slice(0, visibleTORs);
  torXs.forEach((x, i) => {
    const id = `tor${i+1}`;
    const isFirst = i === 0;
    nodes.push({ id, x, y: 255, w:bw, h:bh,
      label: selTOR ? selTOR.model.slice(0,14) : `GPU-TOR-0${i+1}`,
      sub: (selTOR ? `${selTOR.vendor} · ` : '') +
           (isFirst ? `×${totalTORs} total · ` : '') + `AS 6501${i+1}`,
      icon:'⚡', ...C.gputor });
    links.push({ from:'gspine1', to:id, color:'#ff8c00', width:2, flow:true,
      badge: i === 0 ? fabricBadge : undefined });
    links.push({ from:'gspine2', to:id, color:'#ff8c00', width:2, flow:true });
    links.push({ from:'oob', to:id, color:'#ffd000', width:1, opacity:.2 });
  });

  // GPU Servers — one node per visible TOR
  const gpusPerRack = gpuPerSrv * Math.ceil(cap.servers / totalTORs);
  torXs.forEach((x, i) => {
    const id = `gsrv${i+1}`;
    const rackLabel = hasRailOpt ? `Rail-${i+1} · ×${gpuPerSrv}GPU` : `Rack-${i+1} · ×${gpuPerSrv}GPU`;
    nodes.push({ id, x: x + 5, y: 375, w: 105, h:38,
      label: rackLabel,
      sub: `${cap.servers} servers · ${cap.gpus} GPUs total · ${fabricBadge}`,
      icon:'🎮', fill:'#1a0a00', stroke:'#ff6600', fontSize:8 });
    links.push({ from:`tor${i+1}`, to:id, color:'#ff6600', width:1.8, flow:true, slow:true,
      badge: i === 0 ? (hasRoCE ? 'RoCEv2 RDMA' : 'Ethernet') : undefined });
  });

  // Storage fabric (right side)
  nodes.push({ id:'sstor1', x: 870, y: 130, w:bw, h:bh,
    label:'STOR-SPINE-01', sub:'Storage Spine · NVMe-oF', icon:'💾', ...C.stor });
  nodes.push({ id:'sstor2', x: 870, y: 255, w:bw, h:bh,
    label:'STOR-LEAF-01', sub:'Storage Leaf · GPUDirect', icon:'🗄️', ...C.stor });
  nodes.push({ id:'sstor3', x: 870, y: 375, w: 105, h:38,
    label:'NVMe-oF / NFS', sub:'All-Flash Storage Array', icon:'🗃️',
    fill:'#0a1a2e', stroke:'#00d4ff', fontSize:8 });

  links.push({ from:'oob',    to:'sstor1', color:'#00d4ff', width:1, opacity:.3 });
  links.push({ from:'sstor1', to:'sstor2', color:'#00d4ff', width:2, flow:true });
  links.push({ from:'sstor2', to:'sstor3', color:'#00d4ff', width:1.8, flow:true, slow:true });
  torXs.forEach((_, i) => {
    links.push({ from:'sstor2', to:`gsrv${i+1}`, color:'#00d4ff', width:1, opacity:.2 });
  });

  const bands = [
    { y: 110, h: 60, color:'#ffd000',
      label:`GPU SPINE — ×${totalSpines} spines · eBGP ECMP · ${cap.isNonBlocking?'1:1 NON-BLOCKING':'CLOS FABRIC'} · ${cap.torUpBW}G aggregate uplink` },
    { y: 235, h: 60, color:'#ff8c00',
      label:`GPU TOR — ×${totalTORs} switches · ${fabricType}${hasPFC?' · PFC Priority 3':''}${hasECN?' · ECN 150KB':''} · ${cap.torDownBW}G downlink` },
    { y: 355, h: 55, color:'#ff6600',
      label:`GPU SERVERS — ${cap.servers} servers · ${cap.gpus} GPUs · ${gpuPerSrv} GPU/server · ${hasRailOpt?'RAIL TOPOLOGY · ':''}RDMA NIC · NVMe-oF` },
  ];

  const meta = `Capacity: ${totalTORs} TOR switches · ${totalSpines} spines · ${cap.servers} servers · ${cap.gpus} GPUs · ` +
    `Oversubscription: ${cap.oversub}:1 ${cap.isNonBlocking?'✓ non-blocking':'⚠ check uplinks'} · ` +
    `${portSpd}G ports · ${hasPFC?'PFC lossless · ':''}${hasECN?'ECN · ':''}` +
    `${selTOR?selTOR.model:'—'} TOR · ${selSpine?selSpine.model:'—'} spine`;

  const legend = `
    <div class="legend-item"><div class="legend-dot" style="background:#ffd000"></div>GPU Spine ×${totalSpines} (eBGP · ${cap.isNonBlocking?'non-blocking':'ECMP'})</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff8c00"></div>GPU TOR ×${totalTORs}${hasPFC?' (PFC lossless)':''}</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff6600"></div>GPU Servers — ${cap.servers} servers / ${cap.gpus} GPUs</div>
    <div class="legend-item"><div class="legend-dot" style="background:#00d4ff"></div>Storage fabric (NVMe-oF · GPUDirect)</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ffd000;opacity:.5"></div>OOB Management</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ff8c00;box-shadow:0 0 6px #ff8c00"></div>Animated packet flow</div>`;

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
   MULTI-SITE DC / DCI HLD
   Shows DCA (Primary), DCB (Secondary), DCC (DR), DCD (Edge)
   connected via a shared WAN / MPLS cloud, with VXLAN DCI links
════════════════════════════════════════════════════════════════ */
function multiSiteHLD() {
  const W = 1100, H = 660;
  const nodes = [], links = [];

  // Number of sites to show (from state, clamped 3-4)
  const numSites = Math.min(4, Math.max(3, parseInt(STATE.numSitesTopology) || 3));

  // Selected hardware labels
  const selSpine = PRODUCTS[STATE.selectedProducts['dc-spine']];
  const selLeaf  = PRODUCTS[STATE.selectedProducts['dc-leaf']];
  const selFW    = PRODUCTS[STATE.selectedProducts['fw']];
  const spineLbl = selSpine ? selSpine.model : 'DC Spine';
  const leafLbl  = selLeaf  ? selLeaf.model  : 'Leaf / ToR';
  const fwLbl    = selFW    ? selFW.model     : 'Firewall';

  // ── WAN / MPLS cloud (centre-top) ────────────────────────────────
  nodes.push({
    id:'wan', x: W/2 - 90, y: 28, w: 180, h: 50,
    label:'WAN / MPLS / DCI', icon:'🌐',
    fill:'#1a3060', stroke:'#2a4a90', textColor:'#9aadd0', glow:true,
  });

  // ── Firewall pair (optional, sits just under WAN cloud) ───────────
  const hasFW = STATE.fwModel && STATE.fwModel !== 'none';
  if (hasFW) {
    nodes.push({ id:'fw-a', x: W/2 - 145, y: 110, w: 110, h: 38,
      label: fwLbl, sub:'FW-Active', icon:'🔒',
      fill:'#2a0a14', stroke:'#7a1a2a', textColor:'#ff8080' });
    nodes.push({ id:'fw-b', x: W/2 + 35,  y: 110, w: 110, h: 38,
      label: fwLbl, sub:'FW-Standby', icon:'🔒',
      fill:'#2a0a14', stroke:'#7a1a2a', textColor:'#ff8080' });
    links.push({ from:'wan', to:'fw-a', color:'#ff3355', width:2, flow:true });
    links.push({ from:'wan', to:'fw-b', color:'#ff3355', width:2 });
  }

  // ── Site definitions ──────────────────────────────────────────────
  const siteConfs = [
    { id:'dca', label:'DCA — Primary',   sub:'Active DC',       x:  80, y: 220, color:'#1a7fff', icon:'🗄️' },
    { id:'dcb', label:'DCB — Secondary', sub:'Active-Active',   x: 790, y: 220, color:'#00e87a', icon:'🗄️' },
    { id:'dcc', label:'DCC — DR Site',   sub:'Disaster Recov.', x:  80, y: 490, color:'#9955ff', icon:'🛡️' },
    { id:'dcd', label:'DCD — Edge PoP',  sub:'Edge / CDN',      x: 790, y: 490, color:'#ff8c00', icon:'⚡' },
  ].slice(0, numSites);

  // ── Draw each site as a mini leaf-spine cluster ───────────────────
  siteConfs.forEach(site => {
    const cx = site.x, cy = site.y;
    const sw = 210, sh = 44;

    // Site bounding label
    nodes.push({
      id: site.id + '-label',
      x: cx - 5, y: cy - 30, w: sw + 10, h: 22,
      label: site.label,
      fill: site.color + '18', stroke: site.color + '50',
      textColor: site.color, fontSize: 9,
    });

    // Spine pair
    nodes.push({ id: site.id+'-sp1', x: cx,      y: cy,      w: 96, h: sh,
      label: spineLbl, sub:'Spine-1', icon:'🦴',
      fill:'#101a34', stroke: site.color + '80', textColor:'#e8f0ff' });
    nodes.push({ id: site.id+'-sp2', x: cx + 114, y: cy,     w: 96, h: sh,
      label: spineLbl, sub:'Spine-2', icon:'🦴',
      fill:'#101a34', stroke: site.color + '80', textColor:'#e8f0ff' });

    // Leaf row
    nodes.push({ id: site.id+'-lf1', x: cx,       y: cy + 90, w: 96, h: sh,
      label: leafLbl, sub:'Leaf-1', icon:'🍃',
      fill:'#0c1226', stroke:'#2a4a90', textColor:'#e8f0ff' });
    nodes.push({ id: site.id+'-lf2', x: cx + 114,  y: cy + 90, w: 96, h: sh,
      label: leafLbl, sub:'Leaf-2', icon:'🍃',
      fill:'#0c1226', stroke:'#2a4a90', textColor:'#e8f0ff' });

    // Spine-Spine ISL
    links.push({ from: site.id+'-sp1', to: site.id+'-sp2', color: site.color, width:2 });
    // Spine → Leaf (full mesh)
    ['-sp1','-sp2'].forEach(sp => ['-lf1','-lf2'].forEach(lf => {
      links.push({ from: site.id+sp, to: site.id+lf, color: site.color, width:1.5, opacity:.7 });
    }));

    // Connect spine-1 to WAN or FW
    const wanAnchor = hasFW ? 'fw-a' : 'wan';
    links.push({ from: wanAnchor, to: site.id+'-sp1', color: site.color, width:2.5, flow:true, dashed:true });
  });

  // ── Inter-site DCI links (horizontal / cross) ─────────────────────
  if (numSites >= 2) links.push({ from:'dca-sp1', to:'dcb-sp2', color:'#ffd000', width:2, dashed:true });
  if (numSites >= 3) links.push({ from:'dca-sp1', to:'dcc-sp1', color:'#9955ff', width:1.5, dashed:true });
  if (numSites >= 4) links.push({ from:'dcb-sp2', to:'dcd-sp2', color:'#ff8c00', width:1.5, dashed:true });
  if (numSites >= 4) links.push({ from:'dcc-sp1', to:'dcd-sp1', color:'#ff3355', width:1.5, dashed:true });

  const bands = [
    { y: 20,  h: 72,  color:'#1a7fff', label:'WAN / MPLS / DCI BACKBONE' },
    ...(hasFW ? [{ y: 100, h: 58, color:'#ff3355', label:'SECURITY PERIMETER' }] : []),
  ];

  const siteLegend = siteConfs.map(s =>
    `<div class="legend-item"><div class="legend-dot" style="background:${s.color}"></div>${s.label}</div>`
  ).join('');
  const legend = siteLegend + `
    <div class="legend-item"><div class="legend-dot" style="background:#ffd000;border-radius:0"></div>DCI (VXLAN stretch)</div>
    ${hasFW ? `<div class="legend-item"><div class="legend-dot" style="background:#ff3355"></div>Firewall pair</div>` : ''}`;

  const meta = `Multi-site topology · ${numSites} DC locations · VXLAN/EVPN DCI · ${hasFW ? fwLbl + ' perimeter ·' : ''} Active-Active`;
  return { svg: buildSVG({ nodes, links, bands, W, H }), title:'Multi-Site DC / DCI — High Level Design', meta, legend };
}

/* ════════════════════════════════════════════════════════════════
   LLD — IP ADDRESSING PLAN
════════════════════════════════════════════════════════════════ */
function renderIPPlan() {
  const uc   = STATE.uc;
  const site = parseInt(STATE.numSites) || 1;
  const isDC = uc === 'dc' || uc === 'hybrid' || uc === 'multisite';
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
  const isDC = uc === 'dc' || uc === 'hybrid' || uc === 'multisite';

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
  const isDC = uc === 'dc' || uc === 'hybrid' || uc === 'multisite';
  const isCampus = uc === 'campus' || uc === 'hybrid' || uc === 'wan';
  const isGPU = uc === 'gpu';
  const P = _protos();

  const asnRows   = [];
  const protoRows = [];
  const ospfRows  = [];  // OSPF-specific area table
  const eigrpRows = [];  // EIGRP-specific

  const layerPill = (l) => {
    const m = { 'Core':'pl-core','Dist':'pl-dist','FW':'pl-fw','DC Spine':'pl-spine','DC Leaf':'pl-leaf','GPU Spine':'pl-tor','GPU TOR':'pl-tor','WAN':'pl-core' };
    return `<span class="pill-layer ${m[l]||'pl-mgmt'}">${l}</span>`;
  };

  /* ── CAMPUS routing design ─────────────────────────────────── */
  if (isCampus) {
    // OSPF design
    if (P.hasOSPF) {
      ospfRows.push({ area:'0 (Backbone)', devices:'CORE-01, CORE-02, DIST-01..04', type:'Normal', auth:'MD5 Auth', hello:'10s / Dead 40s', note:'All distribution & core links in Area 0' });
      ospfRows.push({ area:'1 (Access-Bldg-A)', devices:'DIST-01, ACC-01, ACC-02', type:'Stub', auth:'MD5 Auth', hello:'10s / Dead 40s', note:'Stub area — no external routes' });
      ospfRows.push({ area:'2 (Access-Bldg-B)', devices:'DIST-02, ACC-03, ACC-04', type:'Stub', auth:'MD5 Auth', hello:'10s / Dead 40s', note:'Stub area — default route only' });
      if (uc === 'hybrid' || parseInt(STATE.numSites) > 2) {
        ospfRows.push({ area:'3 (Remote Sites)', devices:'Branch routers', type:'NSSA', auth:'MD5 Auth', hello:'10s / Dead 40s', note:'NSSA — redistributes static/connected' });
      }
    }
    // EIGRP design
    if (P.hasEIGRP) {
      eigrpRows.push({ as:'100', devices:'All campus routers + L3 switches', k:'K1=1 K2=0 K3=1 K4=0 K5=0', hello:'5s / Hold 15s', auth:'HMAC-SHA-256', note:'Single EIGRP AS, summarised at distribution' });
      eigrpRows.push({ as:'100', devices:'DIST-01 → Access (stub)', k:'eigrp stub connected', hello:'5s / Hold 15s', auth:'HMAC-SHA-256', note:'Stub flag on access switches — reduces query domain' });
    }
    // BGP (iBGP for WAN or campus with internet)
    if (P.hasBGP || uc === 'wan') {
      asnRows.push(['CORE-01 / CORE-02', 'Core',  '65100', 'iBGP Route Reflector', 'DIST-01..04, FW-01', 'IPv4 Unicast, VPNv4']);
      asnRows.push(['DIST-01',           'Dist',  '65100', 'iBGP RR Client',        'CORE-01',            'IPv4 Unicast']);
      asnRows.push(['DIST-02',           'Dist',  '65100', 'iBGP RR Client',        'CORE-01',            'IPv4 Unicast']);
      asnRows.push(['FW-01 / Border',    'FW',    '65200', 'eBGP upstream (ISP)',    'ISP AS / MPLS PE',   'IPv4 Unicast, default']);
    }
    // Protocol summary
    if (P.hasOSPF)  protoRows.push(['OSPF v2/v3', 'Underlay — Campus', `Process 1 · Areas 0,1,2${parseInt(STATE.numSites)>2?',3':''} · Router-ID = Loopback0`, 'Hello 10s / Dead 40s', 'Area 0 backbone · stub areas at access']);
    if (P.hasEIGRP) protoRows.push(['EIGRP AS 100','Underlay — Campus', 'Named mode · auto-summary OFF · stub on access switches', 'Hello 5s / Hold 15s', 'All campus routes · summarized at dist']);
    if (P.hasISIS)  protoRows.push(['IS-IS Level-2','Underlay', 'Single-area · wide metrics · loopback0 NET addr', 'Hello 3s / Dead 9s', 'Loopback0 + P2P /31 links']);
    if (P.hasBGP || uc === 'wan') protoRows.push(['BGP AS 65100', 'Campus iBGP + WAN eBGP', 'Route Reflector at CORE · eBGP to ISP / MPLS PE', 'Keepalive 60s / Hold 180s', 'Default route from ISP + VPN prefixes']);
    if (P.hasVXLAN) protoRows.push(['VXLAN/EVPN','Campus overlay','BGP EVPN type-2 (MAC), type-3 (IMET) for campus fabric','Keepalive 3s / Hold 9s','Per-VLAN VNI, Anycast GW, distributed IRB']);
  }

  /* ── DC routing design ─────────────────────────────────────── */
  if (isDC) {
    // Underlay
    if (P.hasOSPF) {
      ospfRows.push({ area:'0 (Backbone)', devices:'SPINE-01, SPINE-02, all LEAFs', type:'Normal', auth:'MD5 / SHA-1', hello:'3s / Dead 9s', note:'Point-to-point /31 links — no DR/BDR election' });
    }
    if (P.hasISIS) {
      protoRows.push(['IS-IS L2','DC Underlay','NET 49.0001.xxxx.xxxx.xxxx.00 · wide metrics · BFD', 'Hello 3s / Dead 9s', 'Loopback0 /32 + P2P /31 links · all spines + leaves']);
    }
    if (P.hasEIGRP) {
      eigrpRows.push({ as:'200', devices:'All DC switches (spine+leaf)', k:'K1=1 K3=1 only', hello:'3s / Hold 9s', auth:'HMAC-SHA-256', note:'Named mode · redistribute connected (loopbacks) only' });
    }
    // BGP EVPN overlay
    const bgpAF = P.hasVXLAN ? 'IPv4 Unicast, L2VPN EVPN' : (P.hasMPLS ? 'IPv4 Unicast, VPNv4, VPNv6' : 'IPv4 Unicast');
    asnRows.push(['SPINE-01',  'DC Spine', '65000', 'eBGP RR (EVPN / underlay)', 'LEAF-01..04',        bgpAF]);
    asnRows.push(['SPINE-02',  'DC Spine', '65000', 'eBGP RR (EVPN / underlay)', 'LEAF-01..04',        bgpAF]);
    asnRows.push(['LEAF-01',   'DC Leaf',  '65001', 'eBGP (dual-homed to spines)','SPINE-01, SPINE-02', bgpAF]);
    asnRows.push(['LEAF-02',   'DC Leaf',  '65002', 'eBGP (dual-homed to spines)','SPINE-01, SPINE-02', bgpAF]);
    asnRows.push(['LEAF-03',   'DC Leaf',  '65003', 'eBGP (dual-homed to spines)','SPINE-01, SPINE-02', bgpAF]);
    asnRows.push(['LEAF-04',   'DC Leaf',  '65004', 'eBGP (dual-homed to spines)','SPINE-01, SPINE-02', bgpAF]);

    const underlayName = P.hasOSPF ? 'OSPF Area 0' : (P.hasISIS ? 'IS-IS L2' : (P.hasEIGRP ? 'EIGRP AS 200' : 'BGP Underlay'));
    if (P.hasVXLAN) protoRows.push([underlayName,'DC Underlay', 'Fabric /31 P2P links · Loopback0 /32 per device · BFD co-req', 'Hello 3s / Dead 9s', 'Loopbacks reachable → VTEP tunnels up']);
    if (P.hasVXLAN) protoRows.push(['BGP EVPN (L2VPN)','Overlay — VXLAN', 'Type-2 MAC-IP · Type-3 IMET multicast · Type-5 IP Prefix · Anycast GW', 'Keepalive 3s / Hold 9s', 'Per-tenant VNI (L2VNI) + L3VNI per VRF']);
    if (P.hasMPLS)  protoRows.push(['BGP + LDP/SR','Overlay — MPLS', 'VPNv4/VPNv6 · SR-MPLS label stack · RSVP-TE optional', 'Keepalive 5s / Hold 15s', 'Per-VRF label · traffic engineering paths']);
    if (P.noOverlay)protoRows.push(['Pure L3 Routed','No overlay', `All routes via ${underlayName} · host /32 prefixes redistributed`, 'per IGP settings', 'No tunneling — all fabric links routed']);
  }

  /* ── GPU routing design ─────────────────────────────────────── */
  if (isGPU) {
    asnRows.push(['GPU-SPINE-01','GPU Spine','65010','eBGP RR · ECMP 64-way','GPU-TOR-01..04','IPv4 Unicast']);
    asnRows.push(['GPU-SPINE-02','GPU Spine','65010','eBGP RR · ECMP 64-way','GPU-TOR-01..04','IPv4 Unicast']);
    asnRows.push(['GPU-TOR-01', 'GPU TOR',  '65011','eBGP (to both spines)','GPU-SPINE-01/02','IPv4 Unicast']);
    asnRows.push(['GPU-TOR-02', 'GPU TOR',  '65012','eBGP (to both spines)','GPU-SPINE-01/02','IPv4 Unicast']);
    protoRows.push(['BGP (unnumbered)','GPU Fabric Underlay','Unnumbered eBGP on P2P interfaces · no IP on fabric links · ECMP 64-way','Keepalive 1s / Hold 3s','GPU server loopbacks + storage subnets']);
    protoRows.push(['PFC / ECN / DSCP','RoCEv2 QoS','PFC on priority 3 (DSCP 26) · ECN threshold 150 KB · DCQCN algorithm · lossless queues','QoS Map','All GPU and storage-facing ports on TOR']);
    if ((STATE.gpuSpecifics || []).some(g => /SHARP/i.test(g))) {
      protoRows.push(['SHARP / NCCL','Collective Offload','In-network reduction · aggregation trees · SHARP v2 · requires NVIDIA switch ASIC','N/A','GPU-SPINE only']);
    }
  }

  /* ── Render ASN table ─────────────────────────────────────── */
  document.getElementById('asn-tbody').innerHTML = asnRows.length ? asnRows.map(r => `
    <tr>
      <td><strong>${r[0]}</strong></td>
      <td>${layerPill(r[1])}</td>
      <td><span class="asn-badge">${r[2]}</span></td>
      <td style="color:var(--txt1)">${r[3]}</td>
      <td class="mono" style="font-size:.72rem">${r[4]}</td>
      <td style="color:var(--txt2)">${r[5]}</td>
    </tr>`).join('')
  : '<tr><td colspan="6" style="color:var(--txt2);text-align:center;padding:1rem">BGP not selected — see OSPF/EIGRP design below</td></tr>';

  /* ── Render protocol summary table ───────────────────────── */
  document.getElementById('proto-tbody').innerHTML = protoRows.map(r => `
    <tr>
      <td><strong>${r[0]}</strong></td>
      <td>${r[1]}</td>
      <td style="color:var(--txt1)">${r[2]}</td>
      <td class="mono">${r[3]}</td>
      <td style="color:var(--txt2)">${r[4]}</td>
    </tr>`).join('');

  /* ── Render OSPF area design (if OSPF selected) ───────────── */
  const ospfSec = document.getElementById('ospf-design-section');
  if (ospfSec) {
    if (P.hasOSPF && ospfRows.length) {
      ospfSec.style.display = 'block';
      document.getElementById('ospf-tbody').innerHTML = ospfRows.map(r => `
        <tr>
          <td><span class="asn-badge" style="background:rgba(153,85,255,.15);color:#c088ff">Area ${r.area}</span></td>
          <td class="mono" style="font-size:.72rem">${r.devices}</td>
          <td>${r.type}</td>
          <td class="mono" style="font-size:.72rem">${r.auth}</td>
          <td class="mono">${r.hello}</td>
          <td style="color:var(--txt2)">${r.note}</td>
        </tr>`).join('');
    } else {
      ospfSec.style.display = 'none';
    }
  }

  /* ── Render EIGRP design (if EIGRP selected) ──────────────── */
  const eigrpSec = document.getElementById('eigrp-design-section');
  if (eigrpSec) {
    if (P.hasEIGRP && eigrpRows.length) {
      eigrpSec.style.display = 'block';
      document.getElementById('eigrp-tbody').innerHTML = eigrpRows.map(r => `
        <tr>
          <td><span class="asn-badge" style="background:rgba(0,212,255,.12);color:#00d4ff">AS ${r.as}</span></td>
          <td class="mono" style="font-size:.72rem">${r.devices}</td>
          <td class="mono" style="font-size:.72rem">${r.k}</td>
          <td class="mono">${r.hello}</td>
          <td class="mono" style="font-size:.72rem">${r.auth}</td>
          <td style="color:var(--txt2)">${r.note}</td>
        </tr>`).join('');
    } else {
      eigrpSec.style.display = 'none';
    }
  }
}

/* ════════════════════════════════════════════════════════════════
   LLD — PHYSICAL CONNECTIVITY
════════════════════════════════════════════════════════════════ */
function renderPhysical() {
  const uc   = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid' || uc === 'multisite';
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

/* ════════════════════════════════════════════════════════════════
   REFERENCE ARCHITECTURE LIBRARY
   Vendor design docs filtered by current use case
════════════════════════════════════════════════════════════════ */
const REF_DOCS = [
  // ── CAMPUS ──────────────────────────────────────────────────
  { vendor:'Cisco', uc:['campus','hybrid','wan'], color:'#1ba0d7',
    title:'Cloud Campus LAN Design Guide (CVD)',
    desc:'Cisco Validated Design — 3-tier campus with SDA-ready architecture, QoS, and wireless integration.',
    url:'https://www.cisco.com/c/en/us/solutions/collateral/enterprise/design-zone-campus/cloud-campus-lan-design-guide.html',
    tags:['Campus','CVD','SDA','802.1X'] },
  { vendor:'Cisco', uc:['campus','hybrid'], color:'#1ba0d7',
    title:'Campus LAN & WLAN Design Guide',
    desc:'Comprehensive wired + wireless campus design covering access, distribution, core, and QoS.',
    url:'https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cisco-campus-lan-wlan-design-guide.html',
    tags:['WLAN','CVD','OSPF','STP'] },
  { vendor:'Cisco', uc:['campus'], color:'#1ba0d7',
    title:'Software-Defined Access (SDA) Design Guide',
    desc:'Cisco SDA with LISP/VXLAN campus overlay — fabric edge, border, and control-plane nodes.',
    url:'https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/cisco-sda-design-guide.html',
    tags:['SDA','LISP','VXLAN','ISE'] },
  { vendor:'Cisco', uc:['campus','hybrid'], color:'#1ba0d7',
    title:'Campus BGP EVPN VXLAN Fabric CVD',
    desc:'Modern campus fabric using BGP EVPN VXLAN for distributed anycast gateway and microsegmentation.',
    url:'https://www.cisco.com/c/en/us/td/docs/solutions/CVD/Campus/Cloud_Campus_Fabric_with_BGP_EVPN_VXLAN_CVD_v0_9.html',
    tags:['VXLAN','EVPN','BGP','Anycast GW'] },
  { vendor:'Arista', uc:['campus','hybrid'], color:'#e04f3b',
    title:'Cognitive Campus Architecture',
    desc:'Arista campus design with CloudVision telemetry, EVPN/VXLAN for campus, and AI-driven ops.',
    url:'https://www.arista.com/assets/data/pdf/Whitepapers/Cognitive-Campus-Architecture-WP.pdf',
    tags:['CloudVision','EVPN','Campus','Telemetry'] },
  { vendor:'Arista', uc:['campus'], color:'#e04f3b',
    title:'Campus Network Security Design Guide',
    desc:'Arista campus security guide — 802.1X, dynamic segmentation, AGNI, and Zero Trust access.',
    url:'https://www.arista.com/assets/data/pdf/Campus-Network-Security-Design-Guide.pdf',
    tags:['802.1X','Zero Trust','AGNI','NAC'] },
  { vendor:'Juniper', uc:['campus','hybrid'], color:'#009b3a',
    title:'Campus Fabric IP Clos Architecture (JVD)',
    desc:'Juniper campus IP Clos with EX Series, EVPN-VXLAN, and Mist AI for wired+wireless assurance.',
    url:'https://www.juniper.net/documentation/us/en/software/jvd/jvd-campus-fabric-ip-clos-wired-assurance/campus_fabric_ip_clos_high-level_architecture.html',
    tags:['IP Clos','EX Series','Mist AI','EVPN'] },
  { vendor:'Juniper', uc:['campus'], color:'#009b3a',
    title:'EVPN Multihoming Campus Architecture',
    desc:'Juniper EVPN-VXLAN campus multihoming with ESI-LAG, Active-Active redundancy, and IRB.',
    url:'https://www.juniper.net/documentation/en_US/release-independent/nce/topics/concept/nce-evpn-vxlan-campus-arch.html',
    tags:['EVPN','Multihoming','ESI-LAG','IRB'] },
  { vendor:'HPE Aruba', uc:['campus'], color:'#ff6600',
    title:'Mobile-First Campus — Midsize Networks',
    desc:'HPE Aruba CX design for mid-market campus — ArubaOS-CX, AirWave, Central management.',
    url:'https://www.arubanetworks.com/resource/mobile-first-campus-for-midsize-networks-design-and-deployment-guide/',
    tags:['ArubaOS-CX','CX 6300','Central','Midsize'] },
  { vendor:'HPE Aruba', uc:['campus'], color:'#ff6600',
    title:'Mobile-First Campus — Large Networks',
    desc:'HPE Aruba design for large enterprise — CX 8360/9300, VSX stacking, dynamic segmentation.',
    url:'https://www.arubanetworks.com/resource/mobile-first-campus-for-large-networks-design-and-deployment-guide/',
    tags:['VSX','CX 9300','802.1X','Dynamic Seg'] },
  { vendor:'Fortinet', uc:['campus'], color:'#e6111a',
    title:'FortiSwitch Large Campus Deployment Guide',
    desc:'FortiSwitch + FortiGate Security Fabric campus design — FortiLink, FortiManager, single-pane.',
    url:'https://docs.fortinet.com/document/fortiswitch/7.4.0/large-campus-deployment-guide/420648/design-overview',
    tags:['FortiLink','Security Fabric','FortiManager','VLAN'] },
  { vendor:'Fortinet', uc:['campus'], color:'#e6111a',
    title:'FortiSwitch Reference Architecture Guide 7.6',
    desc:'Fortinet reference architectures for small, medium, and large campus FortiSwitch deployments.',
    url:'https://docs.fortinet.com/document/fortiswitch/7.6.0/switching-reference-architecture-guide/746434/reference-architectures',
    tags:['FortiSwitch','Reference Arch','HA','MC-LAG'] },

  // ── DATA CENTER ──────────────────────────────────────────────
  { vendor:'Cisco', uc:['dc','hybrid','multisite'], color:'#1ba0d7',
    title:'Nexus 9000 VXLAN EVPN Design Guide',
    desc:'Cisco Nexus 9000 leaf-spine with BGP EVPN, VXLAN, vPC, and anycast gateway.',
    url:'https://www.cisco.com/c/en/us/td/docs/dcn/whitepapers/cisco-vxlan-bgp-evpn-design-and-implementation-guide.html',
    tags:['NX-OS','VXLAN','EVPN','vPC'] },
  { vendor:'Cisco', uc:['dc','multisite'], color:'#1ba0d7',
    title:'VXLAN EVPN Multi-Site Design',
    desc:'Cisco Multi-Site Architecture with BGP EVPN DCI — Type-5 routes, border gateway, site-local.',
    url:'https://www.cisco.com/c/en/us/products/collateral/switches/nexus-9000-series-switches/white-paper-c11-739942.html',
    tags:['Multi-Site','DCI','Type-5','Border GW'] },
  { vendor:'Cisco', uc:['wan'], color:'#1ba0d7',
    title:'Cisco Catalyst SD-WAN Design Guide',
    desc:'SD-WAN architecture with vManage, vSmart controller, vEdge CPE — ZTP and policy design.',
    url:'https://www.cisco.com/c/en/us/td/docs/solutions/CVD/SDWAN/cisco-sdwan-design-guide.html',
    tags:['SD-WAN','vEdge','vManage','ZTP'] },
  { vendor:'Arista', uc:['dc','hybrid','multisite'], color:'#e04f3b',
    title:'DC Interconnection with VXLAN (DCI)',
    desc:'Arista DCI design — VXLAN/EVPN stretch, multi-domain EVPN, and OTV alternatives.',
    url:'https://www.arista.com/assets/data/pdf/Whitepapers/Arista_Design_Guide_DCI_with_VXLAN.pdf',
    tags:['DCI','VXLAN','Multi-domain','EOS'] },
  { vendor:'Arista', uc:['dc','multisite'], color:'#e04f3b',
    title:'EVPN Data Center Gateway — Hierarchical',
    desc:'Hierarchical multi-domain EVPN with Arista — border leaf, DCI gateway, type-5 propagation.',
    url:'https://www.arista.com/assets/data/pdf/Whitepapers/EVPN-Data-Center-EVPN-Gateway-for-Hierarchical-Multi-Domain-EVPN-and-DCI-WP.pdf',
    tags:['EVPN GW','Type-5','Border Leaf','DCI'] },
  { vendor:'Juniper', uc:['dc','hybrid','multisite'], color:'#009b3a',
    title:'Data Center EVPN-VXLAN Reference Architecture',
    desc:'Juniper QFX leaf-spine with EVPN-VXLAN — IP Fabric, IRB, ECMP, and multihoming.',
    url:'https://www.juniper.net/content/dam/www/assets/reference-architectures/us/en/ip-fabric-evpn-vxlan-reference-architecture.pdf',
    tags:['QFX','IP Fabric','EVPN','Multihoming'] },
  { vendor:'Juniper', uc:['dc'], color:'#009b3a',
    title:'Spine-and-Leaf IP Fabric Design Considerations',
    desc:'Juniper whitepaper on CLOS topology design choices, ECMP, MTU, and failure domains.',
    url:'https://www.juniper.net/content/dam/www/assets/white-papers/us/en/design-considerations-for-spine-and-leaf-ip-fabrics.pdf',
    tags:['CLOS','ECMP','MTU','QFX Series'] },

  // ── GPU / AI ─────────────────────────────────────────────────
  { vendor:'Arista', uc:['gpu'], color:'#e04f3b',
    title:'AI Network Fabric Deployment Guide',
    desc:'Arista 7800R GPU fabric — 400G/800G rails, BGP ECMP, PFC, ECN, SHARP, CloudVision.',
    url:'https://www.arista.com/assets/data/pdf/AI-Network-Fabric_Deployment_Guide.pdf',
    tags:['400G','RoCEv2','PFC','ECN'] },
  { vendor:'Arista', uc:['gpu'], color:'#e04f3b',
    title:'Lossless Fabric for AI/ML — RoCE Deployment',
    desc:'Arista + Broadcom RoCEv2 deployment — PFC, ECN/DCQCN, lossless queues, WRED.',
    url:'https://www.arista.com/assets/data/pdf/Broadcom-RoCE-Deployment-Guide.pdf',
    tags:['RoCEv2','PFC','DCQCN','Lossless'] },
  { vendor:'Arista', uc:['gpu'], color:'#e04f3b',
    title:'High-Performance Ethernet for AI Networking',
    desc:'Rail-optimised GPU topology with Arista — compute/storage/OOB fabrics, SHARP, SR-IOV.',
    url:'https://www.arista.com/assets/data/pdf/Arista-Broadcom-AI-Networking-Deployment-Guide.pdf',
    tags:['Rail Topology','SHARP','800G','InfiniBand alt'] },
];

function renderRefArchitectures() {
  const uc  = STATE.uc || 'campus';
  const vendors = STATE.preferredVendors || [];
  const el  = document.getElementById('ref-arch-grid');
  if (!el) return;

  // Filter by UC, optionally boost preferred vendors
  let docs = REF_DOCS.filter(d => d.uc.includes(uc) || d.uc.includes('campus'));
  if (vendors.length > 0) {
    docs = [...docs.filter(d => vendors.includes(d.vendor)),
            ...docs.filter(d => !vendors.includes(d.vendor))];
  }
  // Deduplicate
  const seen = new Set();
  docs = docs.filter(d => { if (seen.has(d.url)) return false; seen.add(d.url); return true; });

  el.innerHTML = docs.map(d => `
    <a class="ref-card" href="${d.url}" target="_blank" rel="noopener noreferrer"
       style="border-color:${d.color}33">
      <div class="ref-vendor" style="color:${d.color}">${d.vendor}</div>
      <div class="ref-title">${d.title}</div>
      <div class="ref-desc">${d.desc}</div>
      <div class="ref-tags">${d.tags.map(t => `<span class="ref-tag">${t}</span>`).join('')}</div>
      <div class="ref-link">Open design doc ↗</div>
    </a>`).join('');
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

