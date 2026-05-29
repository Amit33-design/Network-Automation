'use strict';

/* ════════════════════════════════════════════════════════════════════
   MY DESIGNS — Multi-slot save/load for up to 10 named designs
   Public API:
     saveDesignSlot(name)   — save current STATE to a named slot
     loadDesignSlot(id)     — restore STATE + jump to step 1
     deleteDesignSlot(id)   — remove a user slot
     exportDesigns()        — download all slots as JSON bundle
     importDesigns(file)    — merge slots from a JSON file
     openDesignsModal()     — open the modal
     closeDesignsModal()    — close the modal
     renderDesignsPanel()   — re-render the slot list
     autoSaveDesign()       — called by saveStateLS hook (silent)
═══════════════════════════════════════════════════════════════════════ */

var DESIGNS_LS_KEY  = 'netdesign_designs_v1';
var MAX_USER_SLOTS  = 10;

/* ── Storage helpers ──────────────────────────────────────────── */
function _dsgLoadAll() {
  try {
    var raw = localStorage.getItem(DESIGNS_LS_KEY);
    return raw ? JSON.parse(raw) : { slots: [] };
  } catch(e) { return { slots: [] }; }
}

function _dsgSaveAll(data) {
  try { localStorage.setItem(DESIGNS_LS_KEY, JSON.stringify(data)); } catch(e) {}
}

/* ── Build a full STATE snapshot ──────────────────────────────── */
function _dsgSnap() {
  return {
    uc: STATE.uc, industry: STATE.industry,
    orgName: (document.getElementById('org-name') || {}).value || STATE.orgName,
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
    mcClouds: STATE.mcClouds, mcDualDC: STATE.mcDualDC,
    mcColoProvider: STATE.mcColoProvider, mcDCEdgeVendor: STATE.mcDCEdgeVendor,
    mcEnterpriseAsn: STATE.mcEnterpriseAsn, mcOrgCidr: STATE.mcOrgCidr,
    mcAWSRegions: STATE.mcAWSRegions, mcAzureRegions: STATE.mcAzureRegions,
    mcGCPRegions: STATE.mcGCPRegions, mcOrchestration: STATE.mcOrchestration,
    mcAvxHPE: STATE.mcAvxHPE, mcAvxFireNet: STATE.mcAvxFireNet,
    mcAvxFireNetFW: STATE.mcAvxFireNetFW, mcAvxSegments: STATE.mcAvxSegments,
  };
}

/* ── Save a named slot ────────────────────────────────────────── */
function saveDesignSlot(name) {
  var data = _dsgLoadAll();
  var snap = _dsgSnap();
  var now  = new Date();
  var id   = 'slot_' + Date.now();
  var displayName = (name && name.trim()) || snap.orgName || 'Untitled Design';

  var userSlots = data.slots.filter(function(s){ return s.id !== 'autosave'; });
  if (userSlots.length >= MAX_USER_SLOTS) {
    var oldest = userSlots.reduce(function(a, b){ return a.savedAt < b.savedAt ? a : b; });
    data.slots = data.slots.filter(function(s){ return s.id !== oldest.id; });
  }

  data.slots.push({
    id:          id,
    name:        displayName,
    uc:          snap.uc,
    orgName:     snap.orgName || '',
    savedAt:     now.toISOString(),
    savedAtLabel:now.toLocaleString(),
    state:       snap,
  });

  _dsgSaveAll(data);
  toast('Design saved: ' + displayName, 'success');
  var input = document.getElementById('dsgn-save-name');
  if (input) input.value = '';
  renderDesignsPanel();
  return id;
}

/* ── Auto-save slot (silent — no toast) ──────────────────────── */
function autoSaveDesign() {
  var snap = _dsgSnap();
  if (!snap.uc) return;
  var data = _dsgLoadAll();
  var now  = new Date();
  data.slots = data.slots.filter(function(s){ return s.id !== 'autosave'; });
  data.slots.unshift({
    id:          'autosave',
    name:        'Auto-save',
    uc:          snap.uc,
    orgName:     snap.orgName || '',
    savedAt:     now.toISOString(),
    savedAtLabel:now.toLocaleString(),
    state:       snap,
  });
  _dsgSaveAll(data);
  // Update auto-save timestamp badge if panel is open
  var ts = document.getElementById('dsgn-autosave-ts');
  if (ts) ts.textContent = 'Auto-saved ' + now.toLocaleTimeString();
}

/* ── Load a slot into STATE ───────────────────────────────────── */
function loadDesignSlot(id) {
  var data = _dsgLoadAll();
  var slot = null;
  for (var i = 0; i < data.slots.length; i++) {
    if (data.slots[i].id === id) { slot = data.slots[i]; break; }
  }
  if (!slot) { toast('Design slot not found', 'error'); return; }
  Object.assign(STATE, slot.state);
  if (typeof applyRestoredState === 'function') applyRestoredState();
  closeDesignsModal();
  if (typeof jumpStep === 'function') jumpStep(1);
  toast('Loaded: ' + slot.name, 'success');
}

/* ── Delete a user slot ───────────────────────────────────────── */
function deleteDesignSlot(id) {
  if (id === 'autosave') return;
  var data = _dsgLoadAll();
  var slot = null;
  for (var i = 0; i < data.slots.length; i++) {
    if (data.slots[i].id === id) { slot = data.slots[i]; break; }
  }
  if (!slot) return;
  data.slots = data.slots.filter(function(s){ return s.id !== id; });
  _dsgSaveAll(data);
  toast('Deleted: ' + slot.name, 'info');
  renderDesignsPanel();
}

/* ── List slots sorted newest-first ──────────────────────────── */
function listDesignSlots() {
  var all = _dsgLoadAll().slots;
  return all.slice().sort(function(a, b){ return b.savedAt.localeCompare(a.savedAt); });
}

/* ── Export all slots as JSON bundle ─────────────────────────── */
function exportDesigns() {
  var data = _dsgLoadAll();
  if (!data.slots.length) { toast('No saved designs to export', 'error'); return; }
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'netdesign-ai-designs-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast('Exported ' + data.slots.length + ' design(s)', 'success');
}

/* ── Import from JSON bundle (merge) ─────────────────────────── */
function importDesigns(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var imported = JSON.parse(e.target.result);
      if (!imported.slots || !Array.isArray(imported.slots)) throw new Error('bad format');
      var existing = _dsgLoadAll();
      var added = 0;
      for (var i = 0; i < imported.slots.length; i++) {
        var s = imported.slots[i];
        if (s.id === 'autosave') continue;
        var dup = false;
        for (var j = 0; j < existing.slots.length; j++) {
          if (existing.slots[j].id === s.id) { dup = true; break; }
        }
        if (!dup) { existing.slots.push(s); added++; }
      }
      _dsgSaveAll(existing);
      toast('Imported ' + added + ' design(s)', 'success');
      renderDesignsPanel();
    } catch(err) {
      toast('Import failed — invalid file format', 'error');
    }
  };
  reader.readAsText(file);
}

/* ── Render the slot list into #designs-panel-body ───────────── */
var _DSG_UC_ICON = {
  campus:'🏢', dc:'🏭', gpu:'🧠', hybrid:'🔄',
  wan:'📡', multisite:'🔗', multicloud:'☁️',
};

function renderDesignsPanel() {
  var el = document.getElementById('designs-panel-body');
  if (!el) return;

  var slots     = listDesignSlots();
  var autoSlot  = null;
  var userSlots = [];
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].id === 'autosave') autoSlot = slots[i];
    else userSlots.push(slots[i]);
  }

  if (!slots.length) {
    el.innerHTML = '<div class="dsgn-empty">No saved designs yet. Save your current work with the button above.</div>';
    return;
  }

  function slotHTML(slot, isAuto) {
    var icon    = _DSG_UC_ICON[slot.uc] || '🌐';
    var ucLabel = (typeof UC_LABELS !== 'undefined' && UC_LABELS[slot.uc]) || slot.uc || 'Unknown';
    var sub     = ucLabel + (slot.orgName ? ' · ' + slot.orgName : '');
    return '<div class="dsgn-slot' + (isAuto ? ' dsgn-slot--auto' : '') + '">' +
      '<div class="dsgn-slot-icon">' + icon + '</div>' +
      '<div class="dsgn-slot-meta">' +
        '<div class="dsgn-slot-name">' + _dsgEsc(slot.name) +
          (isAuto ? ' <span class="dsgn-auto-badge">AUTO</span>' : '') +
        '</div>' +
        '<div class="dsgn-slot-sub">' + _dsgEsc(sub) + '</div>' +
        '<div class="dsgn-slot-ts">' + _dsgEsc(slot.savedAtLabel || slot.savedAt || '') + '</div>' +
      '</div>' +
      '<div class="dsgn-slot-actions">' +
        '<button class="btn-cfg-action" onclick="loadDesignSlot(\'' + slot.id + '\')">📂 Load</button>' +
        (!isAuto ? '<button class="btn-cfg-action dsgn-del-btn" title="Delete" onclick="deleteDesignSlot(\'' + slot.id + '\')">🗑</button>' : '') +
      '</div>' +
    '</div>';
  }

  var html = '';
  if (autoSlot) html += slotHTML(autoSlot, true);
  if (userSlots.length) {
    html += '<div style="font-size:.72rem;color:var(--txt3);margin:.6rem 0 .3rem;text-transform:uppercase;letter-spacing:.05em">Saved Designs (' + userSlots.length + ' / ' + MAX_USER_SLOTS + ')</div>';
    for (var j = 0; j < userSlots.length; j++) {
      html += slotHTML(userSlots[j], false);
    }
  } else if (!autoSlot) {
    html = '<div class="dsgn-empty">No saved designs yet.</div>';
  }
  el.innerHTML = html;
}

function _dsgEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Modal open / close ───────────────────────────────────────── */
function openDesignsModal() {
  renderDesignsPanel();
  var m = document.getElementById('designs-modal');
  if (m) m.style.display = 'flex';
}

function closeDesignsModal() {
  var m = document.getElementById('designs-modal');
  if (m) m.style.display = 'none';
}

/* ── Hook autoSave into saveStateLS ──────────────────────────── */
if (typeof saveStateLS === 'function') {
  var _dsgOrigSave = saveStateLS;
  window.saveStateLS = function() {
    _dsgOrigSave.apply(this, arguments);
    autoSaveDesign();
  };
}

/* ── Expose public API ────────────────────────────────────────── */
window.saveDesignSlot    = saveDesignSlot;
window.autoSaveDesign    = autoSaveDesign;
window.loadDesignSlot    = loadDesignSlot;
window.deleteDesignSlot  = deleteDesignSlot;
window.listDesignSlots   = listDesignSlots;
window.exportDesigns     = exportDesigns;
window.importDesigns     = importDesigns;
window.openDesignsModal  = openDesignsModal;
window.closeDesignsModal = closeDesignsModal;
window.renderDesignsPanel = renderDesignsPanel;
