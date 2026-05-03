'use strict';

/* ── Scoring function ───────────────────────────────────────────── */
function scoreProduct(prod) {
  let score = 60; // baseline
  const uc         = STATE.uc;
  const bw         = STATE.bwPerServer;
  const size       = STATE.orgSize;
  const overlay    = STATE.overlayProto;
  const latency    = STATE.latencySla;
  const compliance = STATE.compliance;
  const appTypes   = STATE.appTypes;
  const hosts      = parseInt(STATE.totalHosts) || 0;
  const red        = STATE.redundancy;
  const budget     = STATE.budget;            // Phase 2
  const vendors    = STATE.preferredVendors;  // Phase 2
  const industry   = STATE.industry;          // Phase 2

  // ── Use case match (+20) ─────────────────────────────────────────
  if (prod.useCases.includes(uc)) score += 20;
  // multisite is a variant of dc
  if (uc === 'multisite' && prod.useCases.includes('dc')) score += 15;

  // ── Bandwidth match (+10/+5) ─────────────────────────────────────
  const bwMap = { '1g':'1G','10g':'10G','25g':'25G','100g':'100G','400g':'400G' };
  const bwStr = bwMap[bw] || '';
  if (bwStr && prod.speed   === bwStr) score += 10;
  if (bwStr && prod.upSpeed === bwStr) score += 5;

  // ── Latency match (+15/-20) ──────────────────────────────────────
  if (latency === 'ultra' && prod.latencyNs < 500)  score += 15;
  if (latency === 'low'   && prod.latencyNs < 1500) score += 8;
  if (latency === 'ultra' && prod.latencyNs > 1000) score -= 20;

  // ── Overlay match (+10/+8) ───────────────────────────────────────
  if (overlay.some(o => o.includes('VXLAN')) && prod.features.some(f => f.includes('VXLAN'))) score += 10;
  if (overlay.some(o => o.includes('MPLS'))  && prod.features.some(f => f.includes('MPLS')))  score += 8;

  // ── Compliance (+5/+8) ───────────────────────────────────────────
  if (compliance.includes('PCI-DSS') && prod.features.some(f => f.includes('MACSEC'))) score += 5;
  if (compliance.includes('FedRAMP') && prod.detail && prod.detail.certifications &&
      prod.detail.certifications.includes('FIPS')) score += 8;
  if (compliance.includes('HIPAA')   && prod.features.some(f => f.includes('802.1X'))) score += 5;

  // ── GPU specific ─────────────────────────────────────────────────
  if (uc === 'gpu') {
    if (prod.features.some(f => f.includes('RoCEv2'))) score += 15;
    if (prod.features.some(f => f.includes('PFC')))    score += 10;
    if (prod.features.some(f => f.includes('SHARP')))  score += 12;
    if (prod.vendor === 'NVIDIA')                       score += 5;
  }

  // ── Size scaling ─────────────────────────────────────────────────
  if (size === 'enterprise' && (prod.ports.includes('96') || prod.ports.includes('64') || prod.ports.includes('576'))) score += 5;
  if (size === 'small'      && (prod.powerW || 0) > 1500) score -= 8;

  // ── HA / redundancy ──────────────────────────────────────────────
  if (red === 'full' && prod.features.some(f => f.toLowerCase().includes('issu'))) score += 5;

  // ═══════════════════════════════════════════════════════
  //  PHASE 2 SIGNALS
  // ═══════════════════════════════════════════════════════

  // ── Budget tier match (+15/-15) ──────────────────────────────────
  if (budget && prod.priceRange) {
    if (prod.priceRange === budget) {
      score += 15;
    } else {
      // Penalise mismatches proportionally to distance
      const tiers = ['smb','mid','enterprise','hyperscale'];
      const d = Math.abs(tiers.indexOf(prod.priceRange) - tiers.indexOf(budget));
      score -= d * 7;   // 1 tier away → -7, 2 tiers → -14, 3 tiers → -21 (capped below)
    }
  }

  // ── Vendor preference (+15, or soft -5 if excluded) ─────────────
  if (vendors && vendors.length > 0) {
    if (vendors.includes(prod.vendor)) {
      score += 15;
    } else {
      // Small penalty so preferred vendors consistently edge out equal-quality ones
      score -= 5;
    }
  }

  // ── User-count density scoring (+10/-10) ─────────────────────────
  if (hosts > 0 && prod.userScale) {
    const [minU, maxU] = prod.userScale;
    if (hosts >= minU && hosts <= maxU) {
      score += 10;   // sweet-spot fit
    } else if (hosts < minU) {
      score -= 6;    // over-engineered for this scale
    } else {
      score -= 10;   // undersized — may not scale
    }
  }

  // ── Industry-specific signals ────────────────────────────────────
  if (industry) {
    // Financial: reward MACSEC, MACsec, FIPS
    if (industry === 'finance') {
      if (prod.features.some(f => /macsec/i.test(f)))   score += 8;
      if (prod.detail && prod.detail.certifications &&
          /FIPS/i.test(prod.detail.certifications))      score += 5;
    }
    // Healthcare: reward 802.1X, NAC, compliance-friendly platforms
    if (industry === 'healthcare') {
      if (prod.features.some(f => f.includes('802.1X'))) score += 6;
      if (prod.features.some(f => /NAC|ISE/i.test(f)))  score += 5;
    }
    // Government: reward FIPS, FedRAMP-certifiable, TAA
    if (industry === 'government') {
      if (prod.detail && prod.detail.certifications &&
          /FIPS|TAA/i.test(prod.detail.certifications))  score += 10;
    }
    // Education: SMB-friendly, PoE rich, low power
    if (industry === 'education') {
      if (prod.features.some(f => /PoE/i.test(f)))      score += 5;
      if ((prod.powerW || 0) < 800)                      score += 3;
    }
    // Manufacturing / energy: rugged, reliability, HA
    if (industry === 'manufacturing' || industry === 'energy') {
      if (prod.features.some(f => f.toLowerCase().includes('issu'))) score += 6;
    }
    // Media / telecom: high throughput, MPLS, timing
    if (industry === 'media') {
      if (prod.features.some(f => f.includes('MPLS')))  score += 6;
    }
    // Retail: SMB-friendly, FortiLink/Security Fabric a plus
    if (industry === 'retail') {
      if (prod.features.some(f => /FortiLink|Security Fabric/i.test(f))) score += 6;
      if (prod.priceRange === 'smb' || prod.priceRange === 'mid')         score += 4;
    }
  }

  return Math.min(100, Math.max(10, score));
}

/* ── Estimate device counts (capacity-model driven) ─────────────── */
function estimateCounts(layerKey) {
  const red     = STATE.redundancy || 'ha';
  const redMult = (red === 'ha' || red === 'full') ? 2 : 1;
  const cap     = capacityFromState(STATE);

  if (layerKey === 'campus-access') return cap.campus ? cap.campus.access : 2;
  if (layerKey === 'campus-dist')   return cap.campus ? cap.campus.dist   : 2;
  if (layerKey === 'campus-core')   return cap.campus ? cap.campus.core   : 2;
  if (layerKey === 'dc-leaf')       return cap.dc     ? cap.dc.leafs      : 2;
  if (layerKey === 'dc-spine')      return cap.dc     ? cap.dc.spines     : 2;
  if (layerKey === 'gpu-tor')       return cap.gpu    ? cap.gpu.tors      : 2;
  if (layerKey === 'gpu-spine')     return cap.gpu    ? cap.gpu.spines    : 2;
  if (layerKey === 'fw')            return redMult;
  return 1;
}

/* ── Layer definitions per use case ────────────────────────────── */
function getLayersForUC() {
  const uc = STATE.uc;
  const layers = [];
  if (uc === 'campus' || uc === 'hybrid') {
    layers.push({ key:'campus-access', label:'Access Layer',       icon:'🔌', color:'rgba(26,127,255,.15)', filterFn: p => p.subLayer === 'campus-access' });
    layers.push({ key:'campus-dist',   label:'Distribution Layer', icon:'🔀', color:'rgba(0,212,255,.15)', filterFn: p => p.subLayer === 'campus-dist'   });
    const sz = STATE.orgSize;
    if (sz === 'large' || sz === 'enterprise') {
      layers.push({ key:'campus-core', label:'Core Layer', icon:'⚙️', color:'rgba(153,85,255,.15)', filterFn: p => p.subLayer === 'campus-core' });
    }
  }
  if (uc === 'dc' || uc === 'hybrid' || uc === 'multisite') {
    layers.push({ key:'dc-leaf',  label:'DC Leaf (ToR / EoR)', icon:'🍃', color:'rgba(0,232,122,.15)', filterFn: p => p.subLayer === 'dc-leaf'  });
    layers.push({ key:'dc-spine', label:'DC Spine',            icon:'🦴', color:'rgba(153,85,255,.15)', filterFn: p => p.subLayer === 'dc-spine' });
  }
  if (uc === 'gpu') {
    layers.push({ key:'gpu-tor',   label:'GPU TOR (Rack Switch)',    icon:'⚡', color:'rgba(255,140,0,.15)',  filterFn: p => p.subLayer === 'gpu-tor'   });
    layers.push({ key:'gpu-spine', label:'GPU Spine / Aggregation', icon:'🧠', color:'rgba(119,181,0,.15)', filterFn: p => p.subLayer === 'gpu-spine' });
  }
  if (uc === 'wan') {
    layers.push({ key:'campus-access', label:'Branch CPE / Access', icon:'📡', color:'rgba(0,212,255,.15)', filterFn: p => p.subLayer === 'campus-access' });
    layers.push({ key:'dc-spine',      label:'Hub / Core Router',   icon:'🌐', color:'rgba(153,85,255,.15)', filterFn: p => p.subLayer === 'dc-spine' });
  }
  if (STATE.fwModel && STATE.fwModel !== 'none') {
    layers.push({ key:'fw', label:'Security / Firewall', icon:'🔒', color:'rgba(255,51,85,.15)', filterFn: p => p.subLayer === 'fw' });
  }
  return layers;
}

/* ── Fit-score colour ───────────────────────────────────────────── */
function fitColor(score) {
  if (score >= 85) return 'var(--green)';
  if (score >= 70) return 'var(--blue)';
  if (score >= 55) return 'var(--orange)';
  return 'var(--red)';
}

/* ── Price-tier badge ───────────────────────────────────────────── */
function priceBadge(prod) {
  if (!prod.priceRange) return '';
  const map = {
    smb:        { label:'SMB',        color:'#00e87a' },
    mid:        { label:'Mid-Market', color:'#1a7fff' },
    enterprise: { label:'Enterprise', color:'#9955ff' },
    hyperscale: { label:'Hyperscale', color:'#ff8c00' },
  };
  const t = map[prod.priceRange];
  if (!t) return '';
  const cost = prod.estimatedCostUSD
    ? ` · ~$${prod.estimatedCostUSD.toLocaleString()}`
    : '';
  return `<span class="tier-badge" style="background:${t.color}20;color:${t.color};border:1px solid ${t.color}40">${t.label}${cost}</span>`;
}

/* ── Render product card ────────────────────────────────────────── */
function renderProdCard(prod, score, rank, layerKey) {
  const isRec  = rank === 0;
  const isAlt  = rank === 1;
  const isSel  = STATE.selectedProducts[layerKey] === prod.id;
  const fc     = fitColor(score);

  return `
  <div class="prod-card ${isRec ? 'recommended' : ''} ${isSel ? 'selected-prod' : ''}"
       data-vendor="${prod.vendor}" data-layer="${layerKey}" id="pcard-${prod.id}">
    ${isRec ? `<div class="rec-badge">★ Recommended</div>` : ''}
    ${isAlt ? `<div class="rec-badge alt">Alternative</div>` : ''}

    <div class="prod-head">
      <div class="vendor-logo ${prod.vlClass}">${prod.vendor.replace(' ','<br>')}</div>
      <div class="prod-title">
        <div class="model">${prod.model}</div>
        <div class="vendor-name">${prod.vendor} · ${prod.series}</div>
        ${priceBadge(prod)}
      </div>
    </div>

    <div class="fit-score">
      <span class="fit-label">Fit score</span>
      <div class="fit-bar"><div class="fit-fill" style="width:${score}%;background:${fc}"></div></div>
      <span class="fit-pct" style="color:${fc}">${score}%</span>
    </div>

    <div class="specs-grid">
      <div class="spec-item"><div class="sk">Ports</div><div class="sv">${prod.ports}</div></div>
      <div class="spec-item"><div class="sk">Uplinks</div><div class="sv">${prod.uplinks}</div></div>
      <div class="spec-item"><div class="sk">Speed</div><div class="sv">${prod.speed}</div></div>
      <div class="spec-item"><div class="sk">Latency</div><div class="sv">${prod.latencyNs ? prod.latencyNs.toLocaleString()+'ns' : 'N/A'}</div></div>
      <div class="spec-item"><div class="sk">ASIC</div><div class="sv" style="font-size:.72rem">${prod.asic}</div></div>
      <div class="spec-item"><div class="sk">Power</div><div class="sv">${prod.powerW}W</div></div>
    </div>

    <div class="feat-pills">
      ${prod.features.slice(0,5).map((f,i) => `<span class="feat-pill ${i<2?'hi':''}">${f}</span>`).join('')}
      ${prod.features.length > 5 ? `<span class="feat-pill">+${prod.features.length-5} more</span>` : ''}
    </div>

    <div class="prod-actions">
      <button class="btn-select-prod" onclick="selectProduct('${layerKey}','${prod.id}')">
        ${isSel ? '✓ Selected' : 'Select'}
      </button>
      <button class="btn-detail" onclick="openDetail('${prod.id}')">Details</button>
    </div>
  </div>`;
}
