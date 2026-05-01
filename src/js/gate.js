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
  policy:     'PENDING',  // PASS | WARN | FAIL | PENDING
};

/* ── Update ──────────────────────────────────────────────────── */
function updateGate(key, status) {
  if (!(key in GATE)) return;
  GATE[key] = status;
  renderGate();
  renderConfidenceScore();
}

/* ── Decision ────────────────────────────────────────────────── */
function canDeploy() {
  // Policy FAIL is advisory — does not block. Only simulation or precheck FAIL block.
  return GATE.simulation !== 'FAIL' && GATE.precheck !== 'FAIL';
}

/* ── Confidence score ────────────────────────────────────────── */
function computeConfidenceScore() {
  let score = 0;
  const breakdown = [];

  // Simulation  — 40 pts
  if      (GATE.simulation === 'PASS')    { score += 40; breakdown.push({ label:'Simulation passed',    pts:40, icon:'✅' }); }
  else if (GATE.simulation === 'WARN')    { score += 24; breakdown.push({ label:'Simulation warnings',   pts:24, icon:'⚠️' }); }
  else if (GATE.simulation === 'FAIL')    { score +=  0; breakdown.push({ label:'Simulation failed',     pts: 0, icon:'❌' }); }
  else                                    { score += 20; breakdown.push({ label:'Simulation not run',    pts:20, icon:'⏳' }); }

  // Pre-checks — 30 pts
  if      (GATE.precheck === 'PASS')      { score += 30; breakdown.push({ label:'Pre-checks passed',    pts:30, icon:'✅' }); }
  else if (GATE.precheck === 'FAIL')      { score +=  0; breakdown.push({ label:'Pre-checks failed',    pts: 0, icon:'❌' }); }
  else                                    { score += 15; breakdown.push({ label:'Pre-checks not run',   pts:15, icon:'⏳' }); }

  // Policy     — 20 pts
  if      (GATE.policy === 'PASS')        { score += 20; breakdown.push({ label:'All policies clear',   pts:20, icon:'✅' }); }
  else if (GATE.policy === 'WARN')        { score += 10; breakdown.push({ label:'Policy warnings',      pts:10, icon:'⚠️' }); }
  else if (GATE.policy === 'FAIL')        { score +=  0; breakdown.push({ label:'Policy violations',    pts: 0, icon:'❌' }); }
  else                                    { score += 10; breakdown.push({ label:'Policy not evaluated', pts:10, icon:'⏳' }); }

  // Zero-warning bonus — 10 pts
  const warns = (typeof POLICY_RESULTS !== 'undefined') ? POLICY_RESULTS.warnings.length : 0;
  if (warns === 0 && GATE.policy !== 'PENDING') {
    score += 10;
    breakdown.push({ label:'Zero policy warnings', pts:10, icon:'🏆' });
  }

  return { score: Math.min(score, 100), breakdown };
}

/* ── Render: gate banner ─────────────────────────────────────── */
function renderGate() {
  const el = document.getElementById('gate-panel');
  if (!el) return;

  const blocked   = GATE.simulation === 'FAIL' || GATE.precheck === 'FAIL';
  const cautious  = !blocked && (GATE.simulation === 'WARN' || GATE.policy === 'WARN' || GATE.policy === 'FAIL');
  const allPend   = Object.values(GATE).every(v => v === 'PENDING');

  const reasons = [];
  if (GATE.simulation === 'FAIL') reasons.push('Simulation detected a critical device failure — topology partition risk');
  if (GATE.precheck   === 'FAIL') reasons.push('Pre-deployment checks failed — devices may not be ready');
  if (GATE.policy     === 'FAIL') reasons.push('Policy violations present (advisory — does not block deployment)');

  const statusCls   = blocked  ? 'gate-blocked'
                    : cautious ? 'gate-warn'
                    : allPend  ? 'gate-pending'
                    :            'gate-pass';
  const statusLabel = blocked  ? '❌ DEPLOYMENT BLOCKED'
                    : cautious ? '⚠️ PROCEED WITH CAUTION'
                    : allPend  ? '⏳ AWAITING SIGNALS'
                    :            '✅ CLEAR TO DEPLOY';

  el.innerHTML = `
    <div class="gate-banner ${statusCls}">
      <div class="gate-banner-left">
        <div class="gate-title">🚦 Deployment Gate</div>
        <div class="gate-status-txt">${statusLabel}</div>
        ${reasons.map(r => `<div class="gate-reason">⛔ ${r}</div>`).join('')}
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
    if (blocked) {
      deployBtn.disabled = true;
      deployBtn.title    = reasons[0] || 'Deployment blocked';
      deployBtn.classList.add('gate-btn-blocked');
    } else {
      deployBtn.classList.remove('gate-btn-blocked');
      // Re-enable only if precheck was done
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
