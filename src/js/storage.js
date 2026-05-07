'use strict';


/* ════════════════════════════════════════════════════════════════
   POLISH — localStorage, Demo Mode, Keyboard Nav, Share
════════════════════════════════════════════════════════════════ */

/* ── localStorage persistence (with API-first fallback) ─────────── */
const LS_KEY        = 'netdesign_ai_state_v2';
const LS_DESIGN_ID  = 'netdesign_ai_design_id';   // persisted design ID from backend

function _buildSnap() {
  return {
    uc: STATE.uc, industry: STATE.industry,
    orgName: document.getElementById('org-name')?.value || STATE.orgName,
    orgSize: STATE.orgSize, numSites: STATE.numSites,
    redundancy: STATE.redundancy, traffic: STATE.traffic,
    totalHosts: STATE.totalHosts, bwPerServer: STATE.bwPerServer,
    oversub: STATE.oversub,
    underlayProto: STATE.underlayProto, overlayProto: STATE.overlayProto,
    protoFeatures: STATE.protoFeatures, fwModel: STATE.fwModel,
    vpnType: STATE.vpnType, compliance: STATE.compliance,
    nac: STATE.nac, appTypes: STATE.appTypes,
    latencySla: STATE.latencySla, automation: STATE.automation,
    gpuSpecifics: STATE.gpuSpecifics, extraNotes: STATE.extraNotes,
    selectedProducts: STATE.selectedProducts,
    budget: STATE.budget, preferredVendors: STATE.preferredVendors,
    numSitesTopology: STATE.numSitesTopology,
  };
}

/**
 * Save state to localStorage (always) AND to the backend API (when configured).
 * The API call is fire-and-forget so it never blocks the UI.
 */
function saveStateLS() {
  const snap = _buildSnap();
  // 1. Always save locally first (instant, offline-safe)
  try { localStorage.setItem(LS_KEY, JSON.stringify(snap)); } catch(e) {}

  // 2. If backend is configured, persist to API (non-blocking)
  if (typeof BackendClient !== 'undefined' && BackendClient.isLiveMode()) {
    const existingId = localStorage.getItem(LS_DESIGN_ID);
    const name       = snap.orgName || 'Untitled Design';
    const useCase    = snap.uc || 'unknown';

    if (existingId) {
      // Update existing design
      BackendClient.updateDesign(existingId, { state: snap }).catch(() => {});
    } else {
      // Create new design, store returned ID for future updates
      BackendClient.saveDesign(snap, name, useCase)
        .then(d => { if (d?.id) localStorage.setItem(LS_DESIGN_ID, d.id); })
        .catch(() => {});
    }
  }
}

/**
 * Restore state from API (preferred) or localStorage.
 * Returns true if state was restored.
 */
async function restoreStateAPI() {
  // Try backend first if configured and we have a saved design ID
  const designId = localStorage.getItem(LS_DESIGN_ID);
  if (designId && typeof BackendClient !== 'undefined' && BackendClient.isLiveMode()) {
    try {
      const data = await BackendClient.fetchDesign(designId);
      if (data?.state) {
        Object.assign(STATE, data.state);
        // Expose design artifacts if available
        if (data.ip_plan)    STATE._ip_plan    = data.ip_plan;
        if (data.vlan_plan)  STATE._vlan_plan  = data.vlan_plan;
        if (data.bgp_design) STATE._bgp_design = data.bgp_design;
        applyRestoredState();
        return true;
      }
    } catch(e) { /* fall through to localStorage */ }
  }
  return restoreStateLS();
}

function restoreStateLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    Object.assign(STATE, s);
    applyRestoredState();
    return true;
  } catch(e) { return false; }
}

function applyRestoredState() {
  // Use case cards
  if (STATE.uc) {
    document.querySelectorAll('.use-card').forEach(c => {
      if (c.dataset.uc === STATE.uc) c.classList.add('selected');
    });
  }
  // Industry
  if (STATE.industry) {
    document.querySelectorAll('.industry-chip').forEach(c => {
      if (c.dataset.val === STATE.industry) c.classList.add('on');
    });
  }
  // Text fields
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('org-name',      STATE.orgName);
  setVal('org-size',      STATE.orgSize);
  setVal('num-sites',     STATE.numSites);
  setVal('redundancy',    STATE.redundancy);
  setVal('total-hosts',   STATE.totalHosts);
  setVal('bw-per-server', STATE.bwPerServer);
  setVal('fw-model',      STATE.fwModel);
  setVal('vpn-type',      STATE.vpnType);
  setVal('latency-sla',   STATE.latencySla);
  setVal('automation',    STATE.automation);
  setVal('extra-notes',   STATE.extraNotes);
  if (STATE.oversub) {
    const sl = document.getElementById('oversub');
    if (sl) { sl.value = STATE.oversub; document.getElementById('oversub-val').textContent = STATE.oversub + ':1'; }
  }
  // Traffic segment
  if (STATE.traffic) {
    const trMap = { ns:0, ew:1, both:2 };
    const idx = trMap[STATE.traffic] ?? 0;
    document.querySelectorAll('.seg-btn').forEach((b,i) => b.classList.toggle('active', i === idx));
  }
  // Chip groups
  const chipMap = {
    'underlay-proto': STATE.underlayProto, 'overlay-proto': STATE.overlayProto,
    'compliance': STATE.compliance, 'nac': STATE.nac,
    'app-types': STATE.appTypes, 'gpu-specifics': STATE.gpuSpecifics,
  };
  Object.entries(chipMap).forEach(([id, vals]) => {
    if (!vals?.length) return;
    document.querySelectorAll(`#${id} .chip`).forEach(c => {
      if (vals.includes(c.textContent.trim())) c.classList.add('on');
    });
  });
  // Proto features
  if (STATE.protoFeatures?.length) {
    document.querySelectorAll('.proto-card').forEach(c => {
      if (STATE.protoFeatures.includes(c.textContent.trim())) c.classList.add('on');
    });
  }
  // Phase 2: budget + vendor preference
  setVal('budget-tier', STATE.budget);
  if (STATE.preferredVendors?.length) {
    document.querySelectorAll('.vendor-chip').forEach(c => {
      if (STATE.preferredVendors.includes(c.dataset.vendor)) c.classList.add('on');
    });
  }
  updateSummary();
}

/* ── Demo mode ──────────────────────────────────────────────────── */
