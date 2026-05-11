'use strict';

/* ── Progress bar render ─────────────────────────────────────────── */
function renderProgress() {
  const bar = document.getElementById('progress-bar');
  bar.innerHTML = '';
  STEPS.forEach((s, i) => {
    // dot
    const dot = document.createElement('div');
    dot.className = 'step-item';
    const btn = document.createElement('button');
    btn.className = 'step-dot' +
      (s.n === STATE.step ? ' active' : '') +
      (s.n < STATE.step   ? ' done'   : '');
    btn.onclick = () => { if (s.n < STATE.step) jumpStep(s.n); };
    btn.innerHTML = `<span class="num">${s.n < STATE.step ? '✓' : s.n}</span>${s.label}`;
    btn.setAttribute('aria-label', `Step ${s.n}: ${s.label}`);
    btn.style.cursor = s.n < STATE.step ? 'pointer' : 'default';
    dot.appendChild(btn);
    bar.appendChild(dot);
    // connector
    if (i < STEPS.length - 1) {
      const conn = document.createElement('div');
      conn.className = 'step-connector' + (s.n < STATE.step ? ' done' : '');
      bar.appendChild(conn);
    }
  });
}

/* ── Step navigation ─────────────────────────────────────────────── */
function goStep(dir) {
  if (dir === 1 && !validateStep(STATE.step)) return;
  const next = STATE.step + dir;
  if (next < 1 || next > STATE.totalSteps) return;
  if (dir === 1 && typeof window.requireAuth === 'function') {
    window.requireAuth(next).then(() => jumpStep(next)).catch(() => {});
  } else {
    jumpStep(next);
  }
}

let _activeSubStep = 'deploy';   // sub-section active within step 6
let _tsEngineOpen  = false;      // whether TS engine panel is showing

function jumpStep(n) {
  hideTsEngine();
  document.getElementById(`step-${STATE.step}`).classList.remove('active');
  STATE.step = n;
  document.getElementById(`step-${n}`).classList.add('active');
  renderProgress();
  renderSidebar();
  updateBottomNav();
  updateSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (typeof renderIntentPanel === 'function') renderIntentPanel();
  if (n === 6) {
    if (typeof initGate === 'function')         initGate();
    if (typeof renderPolicyPanel === 'function') renderPolicyPanel();
  }
  // Analytics funnel
  if (window.Funnel) {
    const ev = [null,'step1_complete','step2_complete','step3_complete','step4_complete','step5_start','step6_start'][n];
    if (ev) window.track?.(ev, { use_case: STATE.uc ?? '', vendor: STATE.vendor ?? '' });
  }
}

/* Jump to step N then scroll to a sub-section anchor */
function jumpSubStep(n, subId) {
  _activeSubStep = subId;
  if (STATE.step !== n || _tsEngineOpen) jumpStep(n);
  renderSidebar();
  const anchors = { deploy:'step-6', ztp:'ztp-section', monitoring:'obs-section', troubleshoot:'obs-section' };
  const targetId = anchors[subId] || `step-${n}`;
  const el = document.getElementById(targetId);
  if (el) setTimeout(() => el.scrollIntoView({ behavior:'smooth', block:'start' }), 120);

  // For troubleshoot sub-step, scroll to RCA section within obs-section
  if (subId === 'troubleshoot') {
    const rca = document.getElementById('obs-rca-results');
    if (rca) setTimeout(() => rca.closest('.obs-block')?.scrollIntoView({ behavior:'smooth', block:'start' }), 200);
  }
}

/* Troubleshooting Engine panel toggle */
function showTsEngine() {
  _tsEngineOpen = true;
  document.getElementById(`step-${STATE.step}`)?.classList.remove('active');
  document.getElementById('panel-ts').classList.add('visible');
  document.getElementById('bottom-nav').style.display = 'none';
  renderSidebar();
  const bcGroup = document.getElementById('bc-group-name');
  const bcStep  = document.getElementById('bc-step-name');
  if (bcGroup) bcGroup.textContent = 'Tools';
  if (bcStep)  bcStep.textContent  = 'Troubleshooting Engine';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideTsEngine() {
  if (!_tsEngineOpen) return;
  _tsEngineOpen = false;
  document.getElementById('panel-ts').classList.remove('visible');
  document.getElementById(`step-${STATE.step}`)?.classList.add('active');
  document.getElementById('bottom-nav').style.display = '';
}

/* ── Sidebar ─────────────────────────────────────────────────────── */
const _SB_GROUPS = [
  { label: 'Design',            steps: [1, 2, 3] },
  { label: 'Configuration',     steps: [4, 5]    },
  { label: 'Deploy & Validate', steps: [6]       },
];

const _SUB_LABELS = { deploy:'Deploy & Validate', ztp:'Zero Touch Provisioning', monitoring:'Monitoring & Alerts', troubleshoot:'RCA & Troubleshoot' };

function renderSidebar() {
  const s = STATE.step;

  // TS Engine button
  const tsBtn = document.getElementById('sb-ts-btn');
  if (tsBtn) tsBtn.classList.toggle('active', _tsEngineOpen);

  // Regular step items
  document.querySelectorAll('#sidebar .sb-item[data-step]').forEach(btn => {
    const n   = parseInt(btn.dataset.step, 10);
    const sub = btn.dataset.sub;
    if (_tsEngineOpen) {
      btn.classList.remove('active', 'done');
      return;
    }
    if (sub) {
      // sub-items: active only when on step 6 + matching sub
      btn.classList.toggle('active', n === s && sub === _activeSubStep);
      btn.classList.remove('done');
    } else {
      btn.classList.toggle('active', n === s && !sub);
      btn.classList.toggle('done',   n < s);
    }
  });

  if (_tsEngineOpen) return;

  // Header breadcrumb
  const step  = STEPS[s - 1];
  const group = _SB_GROUPS.find(g => g.steps.includes(s));
  const bcGroup = document.getElementById('bc-group-name');
  const bcStep  = document.getElementById('bc-step-name');
  if (bcGroup) bcGroup.textContent = group ? group.label : '';
  if (bcStep)  bcStep.textContent  = (s === 6 && _SUB_LABELS[_activeSubStep]) ? _SUB_LABELS[_activeSubStep] : (step ? step.label : '');
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sb-overlay').classList.add('active');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sb-overlay').classList.remove('active');
}

function updateBottomNav() {
  const s = STATE.step;
  document.getElementById('btn-back').disabled = (s === 1);
  document.getElementById('btn-next').textContent = s === STATE.totalSteps ? 'Finish ✓' : 'Continue →';
  document.getElementById('cur-step-label').textContent = s;
  document.getElementById('cur-step-name').textContent = STEPS[s - 1].label;
}

/* ── Validation (per-step) ───────────────────────────────────────── */
function validateStep(n) {
  if (n === 1) {
    if (!STATE.uc) { toast('Please select a use case', 'error'); return false; }
    const orgName = document.getElementById('org-name').value.trim();
    if (!orgName)  { toast('Please enter an organization name', 'error'); return false; }
    STATE.orgName  = orgName;
    STATE.orgSize  = document.getElementById('org-size').value;
    STATE.numSites = document.getElementById('num-sites').value;
    // Phase 2: budget + vendor prefs
    const budgetEl = document.getElementById('budget-tier');
    if (budgetEl) STATE.budget = budgetEl.value;
    STATE.preferredVendors = [...document.querySelectorAll('.vendor-chip.on')]
      .map(c => c.dataset.vendor);
    return true;
  }
  if (n === 2) {
    STATE.redundancy  = document.getElementById('redundancy').value;
    STATE.totalHosts  = document.getElementById('total-hosts').value;
    STATE.bwPerServer = document.getElementById('bw-per-server').value;
    STATE.fwModel     = document.getElementById('fw-model').value;
    STATE.vpnType     = document.getElementById('vpn-type').value;
    STATE.latencySla  = document.getElementById('latency-sla').value;
    STATE.automation  = document.getElementById('automation').value;
    STATE.extraNotes  = document.getElementById('extra-notes').value;
    if (!STATE.redundancy) { toast('Please select a redundancy model', 'error'); return false; }
    return true;
  }
  return true;
}

/* ── Use-case selection ──────────────────────────────────────────── */
function selectUC(card) {
  document.querySelectorAll('.use-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  STATE.uc = card.dataset.uc;
  updateSummary();
  window.track?.('use_case_selected', { use_case: STATE.uc });
  if (typeof window.querySimilarDesigns === 'function') {
    window.querySimilarDesigns({ use_case: STATE.uc, intent: { uc: STATE.uc } });
  }
}

/* ── Industry toggle ─────────────────────────────────────────────── */
function toggleIndustry(chip) {
  document.querySelectorAll('.industry-chip').forEach(c => c.classList.remove('on'));
  chip.classList.add('on');
  STATE.industry = chip.dataset.val;
}

/* ── Vendor preference chip toggle (Phase 2) ─────────────────────── */
function toggleVendorChip(chip) {
  chip.classList.toggle('on');
  STATE.preferredVendors = [...document.querySelectorAll('.vendor-chip.on')]
    .map(c => c.dataset.vendor);
  updateSummary();
}

/* ── Generic chip toggle ─────────────────────────────────────────── */
function toggleChip(chip) {
  chip.classList.toggle('on');
  syncChipGroup(chip.closest('[id]'));
}

function syncChipGroup(container) {
  if (!container) return;
  const id = container.id;
  const vals = [...container.querySelectorAll('.chip.on')].map(c => c.textContent.trim());
  const map = {
    'underlay-proto':  'underlayProto',
    'overlay-proto':   'overlayProto',
    'compliance':      'compliance',
    'nac':             'nac',
    'app-types':       'appTypes',
    'gpu-specifics':   'gpuSpecifics',
  };
  if (map[id]) STATE[map[id]] = vals;
  updateSummary();
}

/* ── Protocol feature toggle ─────────────────────────────────────── */
function toggleProto(card) {
  card.classList.toggle('on');
  STATE.protoFeatures = [...document.querySelectorAll('.proto-card.on')]
    .map(c => c.textContent.trim());
}

/* ── Segmented control ───────────────────────────────────────────── */
function segSelect(btn, key, val) {
  btn.closest('.seg-ctrl').querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  STATE[key] = val;
  updateSummary();
}

/* ── Summary sidebar update ──────────────────────────────────────── */
function updateSummary() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };
  set('sum-uc',      STATE.uc ? UC_LABELS[STATE.uc] : '—');
  const sizeMap = { small:'<100 users', medium:'100–1K', large:'1K–10K', enterprise:'10K+' };
  set('sum-size',    sizeMap[STATE.orgSize] || '—');
  set('sum-sites',   STATE.numSites ? `${STATE.numSites} site(s)` : '—');
  const redMap = { none:'None', basic:'Basic', ha:'High Availability', full:'Full Redundancy' };
  set('sum-red',     redMap[STATE.redundancy] || '—');
  const trMap = { ns:'North-South', ew:'East-West', both:'Both' };
  set('sum-traffic', trMap[STATE.traffic] || '—');
  set('sum-hosts',   STATE.totalHosts ? `${Number(STATE.totalHosts).toLocaleString()}` : '—');
  const bwMap = { '1g':'1 GbE','10g':'10 GbE','25g':'25 GbE','100g':'100 GbE','400g':'400 GbE' };
  set('sum-bw',      bwMap[STATE.bwPerServer] || '—');
  set('sum-overlay', STATE.overlayProto.length ? STATE.overlayProto.join(', ') : '—');
  const fwMap = { perimeter:'Perimeter', distributed:'Perimeter+Dist.', microseg:'Micro-seg', none:'None' };
  set('sum-fw',      fwMap[STATE.fwModel] || '—');
  set('sum-comp',    STATE.compliance.length ? STATE.compliance.join(', ') : '—');
  const autoMap = { manual:'Manual', ansible:'Ansible', terraform:'Terraform', netconf:'NETCONF', napalm:'NAPALM', nso:'Cisco NSO' };
  set('sum-auto',    autoMap[STATE.automation] || '—');
  // Phase 2 additions
  const bgtMap = { smb:'SMB (<$50K)', mid:'Mid ($50K–$500K)', enterprise:'Enterprise ($500K–$5M)', hyperscale:'Hyperscale ($5M+)' };
  set('sum-budget',  STATE.budget ? bgtMap[STATE.budget] : '—');
  set('sum-vendors', STATE.preferredVendors.length ? STATE.preferredVendors.join(', ') : 'Any');

  // Live sync from fields on step 2
  const th = document.getElementById('total-hosts');
  if (th) { STATE.totalHosts = th.value; set('sum-hosts', th.value ? Number(th.value).toLocaleString() : '—'); }
}

/* Live sync fields */
['redundancy','total-hosts','bw-per-server','fw-model','vpn-type','latency-sla','automation'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', updateSummary);
});
document.getElementById('total-hosts')?.addEventListener('input', updateSummary);
document.getElementById('oversub')?.addEventListener('input', e => { STATE.oversub = +e.target.value; });

/* ── Toast notification ──────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, type = 'info', duration = 3200) {
  const area = document.getElementById('toast-area');
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  area.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, duration);
}

/* ── Init ────────────────────────────────────────────────────────── */
renderProgress();
renderSidebar();
updateBottomNav();
updateSummary();

/* Welcome toast */
setTimeout(() => toast('Welcome! Start by selecting your network use case below.', 'info', 4000), 600);

