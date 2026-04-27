'use strict';


/* ════════════════════════════════════════════════════════════════
   PART 5 — Deploy & Validate Engine
════════════════════════════════════════════════════════════════ */

let DEPLOY_STATE = { precheck: false, deployed: false, postcheck: false };

function termLog(msg, cls='') {
  const out = document.getElementById('terminal-output');
  const line = document.createElement('div');
  line.innerHTML = `<span class="t-prompt">[${new Date().toTimeString().slice(0,8)}]</span> <span class="${cls}">${msg}</span>`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}
function clearTerminal() {
  document.getElementById('terminal-output').innerHTML =
    '<span class="t-dim">Terminal cleared.</span><br>';
}

function setStepStatus(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const card   = document.getElementById(id.replace('-status',''));
  const labels = { pending:'Pending', running:'Running…', done:'Done ✓', failed:'Failed ✗' };
  el.textContent  = labels[status] || status;
  el.className    = `ds-status ${status}`;
  if (card) {
    card.classList.remove('running','done','failed');
    if (status !== 'pending') card.classList.add(status === 'running' ? 'running' : status);
  }
}

/* ── Pre-checks ─────────────────────────────────────────────────── */
async function runPreChecks() {
  document.getElementById('check-dashboard').style.display = 'block';
  document.getElementById('precheck-results-section').style.display = 'block';
  document.getElementById('btn-deploy').disabled = true;
  setStepStatus('ds-precheck-status', 'running');
  termLog('Starting pre-deployment checks…', 't-info');

  const checks = buildPreChecks();
  const grid   = document.getElementById('precheck-grid');
  grid.innerHTML = checks.map(c => checkCardHTML(c, 'pending')).join('');

  let passed = 0, failed = 0, warned = 0;
  for (let i = 0; i < checks.length; i++) {
    await delay(220 + Math.random() * 180);
    const c = checks[i];
    const result = simulateCheck(c);
    grid.children[i].outerHTML = checkCardHTML(c, result.status, result.detail, result.val);
    termLog(`${result.status === 'pass' ? '✓' : result.status === 'warn' ? '⚠' : '✗'} ${c.name}: ${result.detail}`,
      result.status === 'pass' ? 't-ok' : result.status === 'warn' ? 't-warn' : 't-err');
    if (result.status === 'pass') passed++;
    else if (result.status === 'warn') warned++;
    else failed++;
  }

  setStepStatus('ds-precheck-status', failed > 0 ? 'failed' : 'done');
  renderScoreRow(passed, warned, failed, checks.length, 'pre');
  termLog(`Pre-checks complete: ${passed} passed, ${warned} warnings, ${failed} failed`, failed > 0 ? 't-err' : 't-ok');

  DEPLOY_STATE.precheck = true;
  if (failed === 0) {
    document.getElementById('btn-deploy').disabled = false;
    termLog('✓ All critical checks passed — deployment enabled', 't-ok');
  } else {
    termLog('✗ Fix failed checks before deploying', 't-err');
  }
}

function buildPreChecks() {
  const uc = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid';
  const isGPU = uc === 'gpu';
  const checks = [
    { name:'Device reachability',   icon:'📡', cat:'connectivity', desc:'ICMP ping to all management IPs' },
    { name:'SSH connectivity',      icon:'🔐', cat:'connectivity', desc:'SSH login test to each device' },
    { name:'Config syntax check',   icon:'📝', cat:'config',       desc:'Dry-run config parse — no syntax errors' },
    { name:'NTP synchronization',   icon:'🕐', cat:'baseline',     desc:'All devices synchronized to NTP source' },
    { name:'Interface baseline',    icon:'🔌', cat:'baseline',     desc:'Record current interface states' },
    { name:'Routing table baseline',icon:'🗺️', cat:'baseline',     desc:'Snapshot current routing table size' },
    { name:'CPU / Memory',          icon:'💾', cat:'health',       desc:'CPU <70% and memory <80% on all devices' },
    { name:'Firmware version',      icon:'📦', cat:'compliance',   desc:'Verify running OS matches target version' },
    { name:'Rollback capability',   icon:'↺',  cat:'safety',       desc:'Confirm-commit / rollback supported' },
    { name:'Change window',         icon:'🕒', cat:'safety',       desc:'Verify deployment within approved window' },
  ];
  if (isDC) {
    checks.push({ name:'BGP peer baseline',    icon:'🔀', cat:'baseline', desc:'Record current BGP peer states & prefix counts' });
    checks.push({ name:'VXLAN fabric health',  icon:'🌐', cat:'baseline', desc:'Check NVE interface and VNI binding status' });
    checks.push({ name:'vPC / MLAG state',     icon:'🔗', cat:'baseline', desc:'Verify vPC peer-link and keepalive operational' });
    checks.push({ name:'ECMP paths',           icon:'⚖️', cat:'baseline', desc:'Confirm ECMP paths consistent across fabric' });
  }
  if (isGPU) {
    checks.push({ name:'PFC / ECN baseline',   icon:'⚡', cat:'baseline', desc:'Priority flow control enabled on RDMA ports' });
    checks.push({ name:'MTU consistency',      icon:'📏', cat:'baseline', desc:'MTU 9216 configured on all GPU-facing ports' });
    checks.push({ name:'RoCEv2 DSCP marking',  icon:'🏷',  cat:'baseline', desc:'DSCP 26 (AF31) marking on RDMA traffic' });
  }
  return checks;
}

function simulateCheck(c) {
  const r = Math.random();
  // Mostly pass, occasional warning, rare fail
  if (r > 0.85 && c.cat === 'health')      return { status:'warn', detail:'CPU at 68% — within threshold', val:'CPU: 68%' };
  if (r > 0.90 && c.cat === 'compliance')  return { status:'warn', detail:'Minor sub-version mismatch', val:'17.09.4a vs 17.09.4' };
  if (c.name === 'Change window')          return { status:'pass', detail:'Within approved maintenance window', val:'Sat 00:00–04:00 UTC' };
  return { status:'pass', detail:'Check passed successfully', val:
    c.cat === 'connectivity' ? 'RTT avg 1.2ms' :
    c.cat === 'baseline'     ? 'Baseline captured' :
    c.cat === 'config'       ? 'No errors found' : 'OK' };
}

function checkCardHTML(c, status, detail, val) {
  const icons = { pass:'✅', fail:'❌', warn:'⚠️', pending:'⏳' };
  const cls   = status === 'pending' ? '' : status;
  return `<div class="check-card ${cls}">
    <div class="check-icon">${icons[status] || icons.pending}</div>
    <div class="check-info">
      <div class="ck-name">${c.icon} ${c.name}</div>
      <div class="ck-detail">${detail || c.desc}</div>
      ${val ? `<div class="ck-val">${val}</div>` : ''}
    </div>
  </div>`;
}

/* ── Deploy ─────────────────────────────────────────────────────── */
async function startDeploy() {
  if (!DEPLOY_STATE.precheck) { toast('Run pre-checks first', 'error'); return; }
  document.getElementById('btn-deploy').disabled   = true;
  document.getElementById('btn-postcheck').disabled = true;

  // Step: Backup
  setStepStatus('ds-backup-status', 'running');
  termLog('Backing up running configurations…', 't-info');
  const devs = buildDeviceList();
  for (const d of devs) {
    await delay(120);
    termLog(`  └─ ${d.name}: backup saved to /backups/${d.name}_${Date.now()}.cfg`, 't-dim');
  }
  await delay(200);
  setStepStatus('ds-backup-status', 'done');
  termLog('✓ All device backups complete', 't-ok');

  // Step: Push configs
  setStepStatus('ds-deploy-status', 'running');
  termLog('Pushing configurations via NETCONF/SSH…', 't-info');
  for (const d of devs) {
    await delay(180 + Math.random() * 150);
    const os = getOS(d.layer);
    termLog(`  └─ ${d.name} [${OS_LABELS[os]}]: config applied successfully`, 't-ok');
  }
  await delay(300);
  setStepStatus('ds-deploy-status', 'done');
  termLog('✓ All configurations pushed', 't-ok');

  // Step: Commit guard
  setStepStatus('ds-verify-status', 'running');
  termLog('Initiating confirm-commit with 5-minute rollback timer…', 't-info');
  await delay(800);
  termLog('  └─ Commit confirmed — rollback guard cancelled', 't-ok');
  setStepStatus('ds-verify-status', 'done');

  DEPLOY_STATE.deployed = true;
  document.getElementById('btn-postcheck').disabled = false;
  termLog('═══ Deployment complete — run Post-Checks to validate ═══', 't-info');
  toast('Deployment complete! Run post-checks now.', 'success', 5000);
}

/* ── Post-checks ────────────────────────────────────────────────── */
async function runPostChecks() {
  if (!DEPLOY_STATE.deployed) { toast('Deploy first', 'error'); return; }
  document.getElementById('postcheck-results-section').style.display = 'block';
  setStepStatus('ds-postcheck-status', 'running');
  termLog('Starting post-deployment validation…', 't-info');

  const checks = buildPostChecks();
  const grid   = document.getElementById('postcheck-grid');
  grid.innerHTML = checks.map(c => checkCardHTML(c, 'pending')).join('');

  let passed = 0, failed = 0, warned = 0;
  for (let i = 0; i < checks.length; i++) {
    await delay(280 + Math.random() * 200);
    const c = checks[i];
    const result = simulatePostCheck(c);
    grid.children[i].outerHTML = checkCardHTML(c, result.status, result.detail, result.val);
    termLog(`${result.status==='pass'?'✓':result.status==='warn'?'⚠':'✗'} ${c.name}: ${result.detail}`,
      result.status==='pass'?'t-ok':result.status==='warn'?'t-warn':'t-err');
    if (result.status==='pass') passed++;
    else if (result.status==='warn') warned++;
    else failed++;
  }

  setStepStatus('ds-postcheck-status', failed > 0 ? 'failed' : 'done');
  renderScoreRow(passed, warned, failed, checks.length, 'post');
  termLog(`Post-checks: ${passed} passed, ${warned} warnings, ${failed} failed`, failed>0?'t-err':'t-ok');

  if (failed === 0 && warned === 0) {
    termLog('🎉 Network is operational — all checks passed!', 't-ok');
    toast('Network is operational! All post-checks passed.', 'success', 6000);
  } else {
    termLog('⚠ Review warnings/failures before confirming go-live', 't-warn');
  }
  DEPLOY_STATE.postcheck = true;
}

function buildPostChecks() {
  const uc   = STATE.uc;
  const isDC = uc === 'dc' || uc === 'hybrid';
  const isGPU= uc === 'gpu';
  const isCampus = uc === 'campus' || uc === 'hybrid';
  const checks = [
    { name:'Interface states',      icon:'🔌', cat:'l1', desc:'All expected interfaces UP/UP' },
    { name:'Layer 2 — MACs',       icon:'🗃️', cat:'l2', desc:'MAC table populated on access ports' },
    { name:'VLAN propagation',      icon:'🏷', cat:'l2', desc:'All VLANs present on trunk ports' },
    { name:'IP reachability',       icon:'📡', cat:'l3', desc:'End-to-end ping across all segments' },
    { name:'Default route',        icon:'🗺️', cat:'l3', desc:'Default route present and correct' },
    { name:'NTP re-sync',          icon:'🕐', cat:'mgmt', desc:'All devices still NTP synced after config push' },
    { name:'SNMP polling',         icon:'📊', cat:'mgmt', desc:'NMS can poll all device OIDs' },
    { name:'Syslog flow',          icon:'📜', cat:'mgmt', desc:'Log messages reaching syslog server' },
  ];
  if (isCampus) {
    checks.push({ name:'Spanning Tree topology', icon:'🌳', cat:'l2', desc:'STP topology stable, no TCN storms' });
    checks.push({ name:'DHCP server reachable',  icon:'📬', cat:'l3', desc:'DHCP offers received on all user VLANs' });
  }
  if (isDC) {
    checks.push({ name:'BGP peers established',  icon:'🔀', cat:'bgp', desc:'All eBGP sessions Established' });
    checks.push({ name:'EVPN routes learned',    icon:'🌐', cat:'bgp', desc:'Type-2 MAC-IP and Type-5 IP-prefix routes present' });
    checks.push({ name:'VXLAN encap/decap',      icon:'📦', cat:'overlay', desc:'Ping between VMs on different leaves via VXLAN' });
    checks.push({ name:'ECMP load balancing',    icon:'⚖️', cat:'l3', desc:'Traffic hashing across all fabric paths' });
    checks.push({ name:'vPC / MLAG consistency', icon:'🔗', cat:'l2', desc:'vPC peer-link active, config consistent' });
  }
  if (isGPU) {
    checks.push({ name:'RoCEv2 connectivity',    icon:'⚡', cat:'rdma', desc:'RDMA ping between GPU server pairs' });
    checks.push({ name:'PFC operational',        icon:'🚦', cat:'qos',  desc:'PFC pause frames flowing on priority 3' });
    checks.push({ name:'GPU-to-GPU bandwidth',   icon:'📈', cat:'perf', desc:'ib_send_bw > 380 Gbps per GPU pair' });
  }
  return checks;
}

function simulatePostCheck(c) {
  const r = Math.random();
  const postVals = {
    'Interface states':     { val:'48/48 UP', status:'pass', detail:'All interfaces operational' },
    'BGP peers established':{ val:'8/8 Established', status:'pass', detail:'All BGP sessions up, prefixes exchanged' },
    'EVPN routes learned':  { val:'Type-2: 142, Type-5: 28', status:'pass', detail:'EVPN route table fully populated' },
    'VXLAN encap/decap':    { val:'RTT 0.8ms', status:'pass', detail:'Cross-leaf VM reachability confirmed' },
    'RoCEv2 connectivity':  { val:'RDMA RTT 3.2µs', status:'pass', detail:'RDMA ping successful across all TOR pairs' },
    'GPU-to-GPU bandwidth': { val:'392 Gbps', status:'pass', detail:'Bandwidth exceeds 380 Gbps threshold' },
    'IP reachability':      { val:'100% success', status:'pass', detail:'All subnets reachable' },
    'ECMP load balancing':  { val:'4 paths active', status:'pass', detail:'Traffic balanced across fabric' },
  };
  if (postVals[c.name]) return postVals[c.name];
  if (r > 0.88) return { status:'warn', detail:'Minor anomaly detected — non-critical', val:'Within SLA' };
  return { status:'pass', detail:'Post-check passed', val:'OK' };
}

/* ── Scorecard ──────────────────────────────────────────────────── */
function renderScoreRow(pass, warn, fail, total, phase) {
  const row = document.getElementById('score-row');
  const pct = Math.round((pass/total)*100);
  row.innerHTML = `
    <div class="score-box pass"><div class="sb-num">${pass}</div><div class="sb-label">Passed</div></div>
    <div class="score-box warn"><div class="sb-num">${warn}</div><div class="sb-label">Warnings</div></div>
    <div class="score-box ${fail>0?'fail':'pass'}"><div class="sb-num">${fail}</div><div class="sb-label">Failed</div></div>
    <div class="score-box info"><div class="sb-num">${pct}%</div><div class="sb-label">Pass Rate</div></div>
    <div class="score-box info"><div class="sb-num">${total}</div><div class="sb-label">Total Checks</div></div>`;
}

function resetDeploy() {
  DEPLOY_STATE = { precheck:false, deployed:false, postcheck:false };
  ['precheck','backup','deploy','verify','postcheck'].forEach(s => setStepStatus(`ds-${s}-status`,'pending'));
  document.getElementById('check-dashboard').style.display = 'none';
  document.getElementById('precheck-results-section').style.display = 'none';
  document.getElementById('postcheck-results-section').style.display = 'none';
  document.getElementById('btn-deploy').disabled = true;
  document.getElementById('btn-postcheck').disabled = true;
  clearTerminal();
  toast('Reset complete', 'info');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
