'use strict';

/* ════════════════════════════════════════════════════════════════
   DEPLOYMENT GATE + CONFIDENCE SCORE
   Three-signal gate (simulation · pre-checks · policy) that
   enforces go/no-go before deployment is allowed to proceed.
   A weighted confidence score (0–100 %) gives instant clarity.
════════════════════════════════════════════════════════════════ */

const GATE = {
  simulation: 'PENDING',  // PASS | WARN | FAIL | PENDING
  precheck:   'PENDING',  // PASS | FAIL | PENDING
  policy:     'PENDING',  // PASS | WARN | FAIL | BLOCK | PENDING
};

// Tracks whether the user has explicitly acknowledged FAIL-severity violations
// (allows override-with-confirm). Resets whenever policy is re-evaluated.
let _policyFailAcknowledged = false;

/* ── Update ──────────────────────────────────────────────────── */
function updateGate(key, status) {
  if (!(key in GATE)) return;
  // If policy re-evaluated, clear any prior acknowledgement
  if (key === 'policy') _policyFailAcknowledged = false;
  GATE[key] = status;
  renderGate();
  renderConfidenceScore();
}

/* ── Decision ────────────────────────────────────────────────── */
function canDeploy() {
  // Hard blocks (never overridable):
  //   simulation FAIL  → topology partition risk
  //   precheck   FAIL  → devices not ready
  //   policy     BLOCK → truly undeployable (e.g. no products selected)
  if (GATE.simulation === 'FAIL') return false;
  if (GATE.precheck   === 'FAIL') return false;
  if (GATE.policy     === 'BLOCK') return false;

  // Soft block (overridable with explicit acknowledgement):
  //   policy FAIL → user must click "Acknowledge & Deploy"
  if (GATE.policy === 'FAIL' && !_policyFailAcknowledged) return false;

  return true;
}

/* ── Acknowledge FAIL violations and proceed ─────────────────── */
function acknowledgePolicyFailures() {
  if (GATE.policy !== 'FAIL') return;
  const r = (typeof POLICY_RESULTS !== 'undefined') ? POLICY_RESULTS : { violations: [] };
  if (r.violations.length === 0) return;

  const names = r.violations.map(v => `• ${v.description}`).join('\n');
  const ok = window.confirm(
    `You are acknowledging the following policy violations:\n\n${names}\n\n` +
    `These violations represent engineering best-practice deviations. ` +
    `Proceed only if you have reviewed and accepted the associated risks.\n\n` +
    `Click OK to proceed with deployment.`
  );
  if (ok) {
    _policyFailAcknowledged = true;
    renderGate();
  }
}

/* ── Confidence score ────────────────────────────────────────── */
function computeConfidenceScore() {
  let score = 0;
  const breakdown = [];

  // Simulation  — 40 pts
  if      (GATE.simulation === 'PASS')    { score += 40; breakdown.push({ label:'Simulation passed',        pts:40, icon:'✅' }); }
  else if (GATE.simulation === 'WARN')    { score += 24; breakdown.push({ label:'Simulation warnings',       pts:24, icon:'⚠️' }); }
  else if (GATE.simulation === 'FAIL')    { score +=  0; breakdown.push({ label:'Simulation failed',         pts: 0, icon:'❌' }); }
  else                                    { score += 20; breakdown.push({ label:'Simulation not run',        pts:20, icon:'⏳' }); }

  // Pre-checks — 30 pts
  if      (GATE.precheck === 'PASS')      { score += 30; breakdown.push({ label:'Pre-checks passed',        pts:30, icon:'✅' }); }
  else if (GATE.precheck === 'FAIL')      { score +=  0; breakdown.push({ label:'Pre-checks failed',        pts: 0, icon:'❌' }); }
  else                                    { score += 15; breakdown.push({ label:'Pre-checks not run',       pts:15, icon:'⏳' }); }

  // Policy     — 20 pts
  // BLOCK is a new gate state — treated as worse than FAIL
  if      (GATE.policy === 'PASS')        { score += 20; breakdown.push({ label:'All policies clear',       pts:20, icon:'✅' }); }
  else if (GATE.policy === 'WARN')        { score += 12; breakdown.push({ label:'Policy warnings',          pts:12, icon:'⚠️' }); }
  else if (GATE.policy === 'FAIL')        { score +=  4; breakdown.push({ label:'Policy violations (FAIL)', pts: 4, icon:'❌' }); }
  else if (GATE.policy === 'BLOCK')       { score +=  0; breakdown.push({ label:'Policy BLOCKED',           pts: 0, icon:'🚫' }); }
  else                                    { score += 10; breakdown.push({ label:'Policy not evaluated',     pts:10, icon:'⏳' }); }

  // AUTO-FIX bonus — up to 8 pts
  const fixes = (typeof POLICY_RESULTS !== 'undefined') ? POLICY_RESULTS.fixes.length : 0;
  if (fixes > 0) {
    const pts = Math.min(fixes * 2, 8);
    score += pts;
    breakdown.push({ label:`${fixes} issue${fixes > 1 ? 's' : ''} auto-fixed`, pts, icon:'🔧' });
  }

  // Zero-warning bonus — only when no FAIL/BLOCK
  const warns = (typeof POLICY_RESULTS !== 'undefined') ? POLICY_RESULTS.warnings.length : 0;
  if (warns === 0 && GATE.policy === 'PASS') {
    score += 10;
    breakdown.push({ label:'Zero policy warnings', pts:10, icon:'🏆' });
  }

  return { score: Math.min(score, 100), breakdown };
}

/* ── Render: gate banner ─────────────────────────────────────── */
function renderGate() {
  const el = document.getElementById('gate-panel');
  if (!el) return;

  const policyBlock   = GATE.policy === 'BLOCK';
  const policyFail    = GATE.policy === 'FAIL' && !_policyFailAcknowledged;
  const policyFailAck = GATE.policy === 'FAIL' && _policyFailAcknowledged;
  const hardBlocked   = GATE.simulation === 'FAIL' || GATE.precheck === 'FAIL' || policyBlock;
  const softBlocked   = !hardBlocked && policyFail;
  const cautious      = !hardBlocked && !softBlocked &&
                        (GATE.simulation === 'WARN' || GATE.policy === 'WARN' || policyFailAck);
  const allPend       = Object.values(GATE).every(v => v === 'PENDING');
  const clear         = !hardBlocked && !softBlocked && !cautious && !allPend;

  const reasons = [];
  if (GATE.simulation === 'FAIL') reasons.push('Simulation detected a critical device failure — topology partition risk');
  if (GATE.precheck   === 'FAIL') reasons.push('Pre-deployment checks failed — devices may not be ready');
  if (policyBlock)                reasons.push('Policy engine blocked deployment — resolve the BLOCK condition to proceed');
  if (policyFail)                 reasons.push('Policy violations require acknowledgement before deployment (click "Acknowledge & Deploy" below)');
  if (policyFailAck)              reasons.push('Policy violations acknowledged — proceed with caution');

  const statusCls   = hardBlocked ? 'gate-blocked'
                    : softBlocked ? 'gate-blocked'
                    : cautious    ? 'gate-warn'
                    : allPend     ? 'gate-pending'
                    :               'gate-pass';

  const statusLabel = hardBlocked ? (policyBlock ? '🚫 DEPLOYMENT BLOCKED' : '❌ DEPLOYMENT BLOCKED')
                    : softBlocked ? '⚠️ ACKNOWLEDGE REQUIRED'
                    : cautious    ? '⚠️ PROCEED WITH CAUTION'
                    : allPend     ? '⏳ AWAITING SIGNALS'
                    :               '✅ CLEAR TO DEPLOY';

  // Acknowledge button — only shown when policy FAIL and not yet acknowledged
  const ackBtn = softBlocked
    ? `<button class="btn btn-warn gate-ack-btn" onclick="acknowledgePolicyFailures()" style="margin-top:.75rem;font-size:.8rem;padding:.4rem 1rem">
         ⚠️ Acknowledge &amp; Deploy
       </button>`
    : '';

  el.innerHTML = `
    <div class="gate-banner ${statusCls}">
      <div class="gate-banner-left">
        <div class="gate-title">🚦 Deployment Gate</div>
        <div class="gate-status-txt">${statusLabel}</div>
        ${reasons.map(r => `<div class="gate-reason">⛔ ${r}</div>`).join('')}
        ${ackBtn}
      </div>
      <div class="gate-signals">
        ${gateSignal('Simulation', GATE.simulation)}
        ${gateSignal('Pre-checks', GATE.precheck)}
        ${gateSignal('Policy',     GATE.policy)}
      </div>
    </div>`;

  // Enforce on deploy button
  const deployBtn = document.getElementById('btn-deploy');
  if (deployBtn && typeof DEPLOY_STATE !== 'undefined' && !DEPLOY_STATE.deployed) {
    const deploy = canDeploy();
    if (!deploy) {
      deployBtn.disabled = true;
      deployBtn.title    = reasons[0] || 'Deployment blocked';
      deployBtn.classList.add('gate-btn-blocked');
    } else {
      deployBtn.classList.remove('gate-btn-blocked');
      if (GATE.precheck === 'PASS' && typeof DEPLOY_STATE !== 'undefined' && DEPLOY_STATE.precheck) {
        deployBtn.disabled = false;
        deployBtn.title    = '';
      }
    }
  }
}

function gateSignal(label, status) {
  const map = {
    PASS:    { icon:'✅', cls:'gs-pass',    txt:'PASS'    },
    WARN:    { icon:'⚠️', cls:'gs-warn',    txt:'WARN'    },
    FAIL:    { icon:'❌', cls:'gs-fail',    txt:'FAIL'    },
    BLOCK:   { icon:'🚫', cls:'gs-fail',    txt:'BLOCKED' },
    PENDING: { icon:'⏳', cls:'gs-pending', txt:'PENDING' },
  };
  const c = map[status] || map.PENDING;
  return `
    <div class="gate-signal ${c.cls}">
      <div class="gs-icon">${c.icon}</div>
      <div class="gs-lbl">${label}</div>
      <div class="gs-st">${c.txt}</div>
    </div>`;
}

/* ── Render: confidence score ring ───────────────────────────── */
function renderConfidenceScore() {
  const el = document.getElementById('confidence-panel');
  if (!el) return;

  const { score, breakdown } = computeConfidenceScore();
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  const label = score >= 80 ? 'High Confidence' : score >= 50 ? 'Moderate' : 'Low Confidence';

  // SVG ring: circumference ≈ 100 so stroke-dasharray score/100 maps directly to pct
  el.innerHTML = `
    <div class="conf-wrap">
      <div class="conf-ring-box">
        <svg viewBox="0 0 36 36" class="conf-svg">
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--bg3)" stroke-width="3.2"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${color}" stroke-width="3.2"
            stroke-dasharray="${score} 100" stroke-dashoffset="25" stroke-linecap="round"
            style="transition:stroke-dasharray .6s ease"/>
        </svg>
        <div class="conf-num" style="color:${color}">${score}<span class="conf-pct-sign">%</span></div>
      </div>
      <div class="conf-detail">
        <div class="conf-title" style="color:${color}">${label}</div>
        <div class="conf-sub">Deployment Confidence Score</div>
        <div class="conf-breakdown">
          ${breakdown.map(b => `
            <div class="conf-row">
              <span>${b.icon} ${b.label}</span>
              <span class="conf-pts">+${b.pts}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

/* ── Sim gate evaluation ─────────────────────────────────────── */
function evaluateSimGate() {
  if (typeof SIM === 'undefined' || !SIM.failedDevices) return;
  const failCount = SIM.failedDevices.size;
  if (failCount === 0) {
    updateGate('simulation', 'PASS');
    return;
  }
  // Check if any failed device is a critical layer
  const devs = (typeof buildDeviceList === 'function') ? buildDeviceList() : [];
  const critical = ['fw','campus-core','wan-hub','dc-spine','gpu-spine'];
  const hasCritical = devs.some(d => SIM.failedDevices.has(d.id) && critical.includes(d.layer));
  updateGate('simulation', hasCritical ? 'FAIL' : 'WARN');
}

/* ── Init (called when step 6 is shown) ─────────────────────── */
function initGate() {
  if (typeof runPolicies === 'function') runPolicies();  // evaluates + calls updateGate('policy',...)
  evaluateSimGate();                                      // pick up any prior sim state
  renderGate();
  renderConfidenceScore();
}
