'use strict';

/* ════════════════════════════════════════════════════════════════
   PART 5 — Deploy & Validate Engine
   Integrates: pipeline state tracking, rollback system, and
   observability hooks (obsLog / obsStageStart / obsStageEnd).
════════════════════════════════════════════════════════════════ */

/* ── Pipeline state ──────────────────────────────────────────── */
const PIPELINE = {
  precheck:  { status:'pending', startedAt:null, completedAt:null, canResume:false },
  backup:    { status:'pending', startedAt:null, completedAt:null, canResume:false },
  deploy:    { status:'pending', startedAt:null, completedAt:null, canResume:false },
  verify:    { status:'pending', startedAt:null, completedAt:null, canResume:false },
  postcheck: { status:'pending', startedAt:null, completedAt:null, canResume:false },
};

// backups created during this run — used for rollback
const BACKUP_STORE = [];    // [{ name, deviceId, ts, cfg }]

let DEPLOY_STATE = { precheck:false, deployed:false, postcheck:false };

/* ── Terminal ────────────────────────────────────────────────── */
function termLog(msg, cls='') {
  const out  = document.getElementById('terminal-output');
  const line = document.createElement('div');
  line.innerHTML = `<span class="t-prompt">[${new Date().toTimeString().slice(0,8)}]</span> <span class="${cls}">${msg}</span>`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
  // Also forward to observability event log
  if (typeof obsLog === 'function') {
    const level = cls === 't-ok' ? 'success' : cls === 't-err' ? 'error' : cls === 't-warn' ? 'warn' : 'info';
    obsLog(msg.replace(/<[^>]*>/g, ''), level);
  }
}
function clearTerminal() {
  document.getElementById('terminal-output').innerHTML =
    '<span class="t-dim">Terminal cleared.</span><br>';
}

/* ── Stage status ────────────────────────────────────────────── */
function setStepStatus(id, status) {
  const el   = document.getElementById(id);
  if (!el) return;
  const card = document.getElementById(id.replace('-status',''));
  const labels = { pending:'Pending', running:'Running…', done:'Done ✓', failed:'Failed ✗', rolled_back:'Rolled Back ↺' };
  el.textContent  = labels[status] || status;
  el.className    = `ds-status ${status}`;
  if (card) {
    card.classList.remove('running','done','failed','rolled_back');
    if (status !== 'pending') card.classList.add(status === 'running' ? 'running' : status);
  }
}

function pipelineStageStart(stage) {
  PIPELINE[stage].status    = 'running';
  PIPELINE[stage].startedAt = Date.now();
  if (typeof obsStageStart === 'function') obsStageStart(stage);
  renderPipelineTimestamp(stage, null);
}

function pipelineStageEnd(stage, success = true) {
  PIPELINE[stage].status      = success ? 'done' : 'failed';
  PIPELINE[stage].completedAt = Date.now();
  PIPELINE[stage].canResume   = !success;
  const dur = PIPELINE[stage].completedAt - PIPELINE[stage].startedAt;
  if (typeof obsStageEnd === 'function') obsStageEnd(stage, success ? 'success' : 'failed');
  renderPipelineTimestamp(stage, dur);
}

function renderPipelineTimestamp(stage, durMs) {
  const stageEl = document.getElementById(`ds-${stage}`);
  if (!stageEl) return;
  let tsEl = stageEl.querySelector('.ds-timestamp');
  if (!tsEl) {
    tsEl = document.createElement('div');
    tsEl.className = 'ds-timestamp';
    stageEl.querySelector('.ds-body').appendChild(tsEl);
  }
  if (durMs === null) {
    tsEl.textContent = 'Started ' + new Date().toTimeString().slice(0,8);
  } else {
    const s = durMs < 1000 ? durMs + 'ms' : (durMs/1000).toFixed(1) + 's';
    tsEl.textContent = `Completed in ${s}`;
  }
}

function showResumeButton(fromStage) {
  const bar = document.getElementById('deploy-action-bar');
  if (!bar || bar.querySelector('#btn-resume')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-resume';
  btn.className = 'btn btn-ghost';
  btn.textContent = `↩ Resume from ${fromStage}`;
  btn.onclick = () => resumeFromStage(fromStage);
  bar.appendChild(btn);
}

async function resumeFromStage(stage) {
  const stageOrder = ['precheck','backup','deploy','verify','postcheck'];
  const idx = stageOrder.indexOf(stage);
  if (idx < 0) return;
  const resumeBtn = document.getElementById('btn-resume');
  if (resumeBtn) resumeBtn.remove();
  termLog(`↩ Resuming pipeline from stage: ${stage}`, 't-info');
  if (stage === 'precheck') { await runPreChecks(); return; }
  if (stage === 'backup' || stage === 'deploy' || stage === 'verify') { await startDeploy(); return; }
  if (stage === 'postcheck') { await runPostChecks(); }
}

/* ── Pre-Checks ──────────────────────────────────────────────── */
async function runPreChecks() {
  document.getElementById('check-dashboard').style.display = 'block';
  document.getElementById('precheck-results-section').style.display = 'block';
  document.getElementById('btn-deploy').disabled = true;
  setStepStatus('ds-precheck-status', 'running');
  pipelineStageStart('precheck');
  termLog('Starting pre-deployment checks…', 't-info');

  const checks = buildPreChecks();
  window._obsPreCheckCount = checks.length;
  const grid = document.getElementById('precheck-grid');
  grid.innerHTML = checks.map(c => checkCardHTML(c, 'pending')).join('');

  let passed = 0, failed = 0, warned = 0;
  for (let i = 0; i < checks.length; i++) {
    await delay(200 + Math.random() * 180);
    const c = checks[i];
    const r = simulateCheck(c);
    grid.children[i].outerHTML = checkCardHTML(c, r.status, r.detail, r.val);
    termLog(
      `${r.status==='pass'?'✓':r.status==='warn'?'⚠':'✗'} ${c.name}: ${r.detail}`,
      r.status==='pass'?'t-ok':r.status==='warn'?'t-warn':'t-err'
    );
    if (r.status==='pass') passed++; else if (r.status==='warn') warned++; else failed++;
  }

  const ok = failed === 0;
  setStepStatus('ds-precheck-status', ok ? 'done' : 'failed');
  pipelineStageEnd('precheck', ok);
  renderScoreRow(passed, warned, failed, checks.length, 'pre');
  termLog(`Pre-checks: ${passed} passed, ${warned} warnings, ${failed} failed`, ok ? 't-ok' : 't-err');

  DEPLOY_STATE.precheck = true;
  if (ok) {
    document.getElementById('btn-deploy').disabled = false;
    termLog('✓ All critical checks passed — deployment enabled', 't-ok');
  } else {
    termLog('✗ Fix failed checks before deploying', 't-err');
    showResumeButton('precheck');
  }
}

/* ── Pre-check builders ─────────────────────────────────────── */
function buildPreChecks() {
  const uc = STATE.uc;
  const isDC = uc==='dc'||uc==='hybrid'||uc==='multisite';
  const isGPU = uc==='gpu';
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
    checks.push({ name:'BGP peer baseline',   icon:'🔀', cat:'baseline', desc:'Record current BGP peer states & prefix counts' });
    checks.push({ name:'VXLAN fabric health', icon:'🌐', cat:'baseline', desc:'Check NVE interface and VNI binding status' });
    checks.push({ name:'vPC / MLAG state',    icon:'🔗', cat:'baseline', desc:'Verify vPC peer-link and keepalive operational' });
    checks.push({ name:'ECMP paths',          icon:'⚖️', cat:'baseline', desc:'Confirm ECMP paths consistent across fabric' });
  }
  if (isGPU) {
    checks.push({ name:'PFC / ECN baseline',  icon:'⚡', cat:'baseline', desc:'Priority flow control enabled on RDMA ports' });
    checks.push({ name:'MTU consistency',     icon:'📏', cat:'baseline', desc:'MTU 9216 configured on all GPU-facing ports' });
    checks.push({ name:'RoCEv2 DSCP marking', icon:'🏷', cat:'baseline', desc:'DSCP 26 (AF31) marking on RDMA traffic' });
  }
  return checks;
}

function simulateCheck(c) {
  const r = Math.random();
  if (r > 0.85 && c.cat==='health')     return { status:'warn', detail:'CPU at 68% — within threshold', val:'CPU: 68%' };
  if (r > 0.90 && c.cat==='compliance') return { status:'warn', detail:'Minor sub-version mismatch', val:'17.09.4a vs 17.09.4' };
  if (c.name==='Change window')         return { status:'pass', detail:'Within approved maintenance window', val:'Sat 00:00–04:00 UTC' };
  return { status:'pass', detail:'Check passed successfully', val:
    c.cat==='connectivity'?'RTT avg 1.2ms':c.cat==='baseline'?'Baseline captured':c.cat==='config'?'No errors found':'OK' };
}

function checkCardHTML(c, status, detail, val) {
  const icons = { pass:'✅', fail:'❌', warn:'⚠️', pending:'⏳' };
  const cls   = status==='pending'?'':status;
  return `<div class="check-card ${cls}">
    <div class="check-icon">${icons[status]||icons.pending}</div>
    <div class="check-info">
      <div class="ck-name">${c.icon} ${c.name}</div>
      <div class="ck-detail">${detail||c.desc}</div>
      ${val?`<div class="ck-val">${val}`+`</div>`:''}
    </div>
  </div>`;
}

/* ── Device-level Status Table ───────────────────────────────── */
let _devStatusMap = {};  // deviceId → { status, lastAction, startedAt }

function initDeviceStatusTable(devs) {
  _devStatusMap = {};
  devs.forEach(d => { _devStatusMap[d.id] = { status:'pending', lastAction:'—', startedAt:null }; });
  renderDeviceStatusTable(devs);
  document.getElementById('device-status-section').style.display = 'block';
}

function setDeviceStatus(devId, status, action) {
  if (_devStatusMap[devId]) {
    _devStatusMap[devId].status     = status;
    _devStatusMap[devId].lastAction = action;
    if (status === 'running') _devStatusMap[devId].startedAt = Date.now();
  }
  const row = document.getElementById(`dsr-${devId}`);
  if (!row) return;
  const icons = { pending:'⏳', running:'🔄', done:'✅', failed:'❌', backed_up:'💾' };
  const cls   = { pending:'', running:' dsr-running', done:' dsr-done', failed:' dsr-failed', backed_up:' dsr-done' };
  row.querySelector('.dsr-status').innerHTML  = `${icons[status]||'⏳'} <span class="dsr-st-text">${status}</span>`;
  row.querySelector('.dsr-action').textContent = action;
  row.className = 'dsr-row' + (cls[status]||'');

  if (status === 'done' || status === 'backed_up') {
    const elapsed = _devStatusMap[devId].startedAt ? `${((Date.now() - _devStatusMap[devId].startedAt)/1000).toFixed(1)}s` : '';
    row.querySelector('.dsr-dur').textContent = elapsed;
  }
}

function renderDeviceStatusTable(devs) {
  const el = document.getElementById('device-status-table');
  if (!el) return;
  el.innerHTML = `
    <table class="dev-status-tbl">
      <thead><tr>
        <th>Device</th><th>Role</th><th>OS</th>
        <th>Status</th><th>Last Action</th><th>Time</th>
      </tr></thead>
      <tbody>
        ${devs.map(d => `
          <tr class="dsr-row" id="dsr-${d.id}">
            <td><span class="dsr-icon">${d.icon}</span> <strong>${d.name}</strong></td>
            <td style="color:var(--txt2)">${d.role}</td>
            <td><span class="dsr-os-pill">${OS_LABELS[getOS(d.layer)]}</span></td>
            <td class="dsr-status">⏳ <span class="dsr-st-text">pending</span></td>
            <td class="dsr-action" style="color:var(--txt2)">—</td>
            <td class="dsr-dur" style="color:var(--txt3);font-family:var(--mono);font-size:.72rem">—</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* ── Platform-specific deploy log lines ─────────────────────── */
function getDeployLines(dev, os) {
  const layer = dev.layer;
  const lines = {
    'ios-xe': {
      'campus-access': [
        '  • Opening SSH session (22/tcp)',
        '  • Entering configuration mode',
        '  • Applying VLAN database (10 entries)',
        '  • Configuring 802.1X on access ports',
        '  • Enabling DHCP snooping + DAI',
        '  • Setting QoS policy-map on uplinks',
        '  • Configuring PortFast + BPDUguard',
        '  • Saving: copy run start',
      ],
      'campus-dist': [
        '  • SSH session established',
        '  • Configuring STP root priority',
        '  • Adding OSPF area 0 (3 interfaces)',
        '  • Setting HSRP standby group',
        '  • Applying MLS QoS trust dscp',
        '  • Saving configuration',
      ],
      'campus-core': [
        '  • SSH session established',
        '  • Configuring BGP 65000 (eBGP to FW)',
        '  • Adding OSPF area 0 redistribution',
        '  • Setting default-route via FW',
        '  • Configuring NTP + SNMP',
        '  • Saving: copy run start',
      ],
    },
    'nxos': {
      'dc-spine': [
        '  • NETCONF session opened (830/tcp)',
        '  • Feature: bgp, isis, bfd enabled',
        '  • Configuring IS-IS (NET 49.0001.0000.0000.000x.00)',
        '  • BGP AS 65000 — Route Reflector role',
        '  • Adding EVPN address-family l2vpn',
        '  • Configuring BFD timers (300ms)',
        '  • gRPC telemetry subscription added',
        '  • copy run start',
      ],
      'dc-leaf': [
        '  • NETCONF session opened',
        '  • Feature: nv overlay, vn-segment-vlan-based enabled',
        '  • Configuring NVE1 (VTEP 10.0.0.' + (dev.idx+1) + ')',
        '  • VXLAN VNI bindings: ' + (8 + dev.idx*2) + ' L2VNIs, 2 L3VNIs',
        '  • BGP eBGP peer to SPINE-01/02',
        '  • Anycast gateway: ip anycast-gateway-mac',
        '  • vPC domain ' + (dev.idx+1) + ' configured',
        '  • PFC priority 3 (RoCEv2) enabled',
        '  • copy run start',
      ],
    },
    'eos': {
      'dc-spine': [
        '  • eAPI session opened (https/443)',
        '  • Router BGP 65000 — EVPN RR',
        '  • IS-IS underlay configured',
        '  • ECMP 64 paths enabled',
        '  • gNMI/CloudVision-ready telemetry',
        '  • write memory',
      ],
      'dc-leaf': [
        '  • eAPI session established',
        '  • VXLAN VTEP interface Vxlan1',
        '  • BGP EVPN address-family',
        '  • Anycast IP/MAC configured',
        '  • PFC watchdog enabled',
        '  • write memory',
      ],
      'gpu-spine': [
        '  • eAPI session opened',
        '  • BGP 400G ECMP spine fabric',
        '  • PFC priority 3+4 (RoCEv2)',
        '  • DSCP 26/46 QoS marking',
        '  • write memory',
      ],
    },
    'sonic': {
      'gpu-tor': [
        '  • config_db.json pushed via REST',
        '  • PFC enabled (priority 3)',
        '  • WRED/ECN thresholds configured',
        '  • MTU 9216 on all GPU ports',
        '  • PFC watchdog activated',
        '  • config save',
      ],
    },
    'junos': {
      default: [
        '  • NETCONF session (port 830)',
        '  • Commit check — no syntax errors',
        '  • Applying hierarchical config stanzas',
        '  • BGP/OSPF/EVPN policies loaded',
        '  • commit confirmed 5',
        '  • Commit confirmed ✓',
      ],
    },
  };

  const osLines = lines[os];
  if (!osLines) return ['  • Configuration applied'];
  const layerLines = osLines[layer] || osLines['default'] || ['  • Configuration applied'];
  return layerLines;
}

/* ── Deploy ──────────────────────────────────────────────────── */
async function startDeploy() {
  if (!DEPLOY_STATE.precheck) { toast('Run pre-checks first', 'error'); return; }
  document.getElementById('btn-deploy').disabled   = true;
  document.getElementById('btn-postcheck').disabled = true;
  BACKUP_STORE.length = 0;

  const devs = buildDeviceList();
  initDeviceStatusTable(devs);

  // ─ Backup ─
  setStepStatus('ds-backup-status', 'running');
  pipelineStageStart('backup');
  termLog('Backing up running configurations…', 't-info');
  for (const d of devs) {
    setDeviceStatus(d.id, 'running', 'Creating backup…');
    await delay(80 + Math.random()*60);
    const ts     = Date.now();
    const bkName = `/backups/${d.name}_${ts}.cfg`;
    BACKUP_STORE.push({ name:bkName, deviceId:d.id, ts, layer:d.layer });
    termLog(`  └─ ${d.name}: ${bkName}`, 't-dim');
    setDeviceStatus(d.id, 'backed_up', bkName);
  }
  await delay(150);
  setStepStatus('ds-backup-status', 'done');
  pipelineStageEnd('backup', true);
  termLog(`✓ ${devs.length} device backups complete`, 't-ok');

  // Reset device status for deploy phase
  devs.forEach(d => setDeviceStatus(d.id, 'pending', 'Waiting…'));

  // ─ Push configs ─
  setStepStatus('ds-deploy-status', 'running');
  pipelineStageStart('deploy');
  termLog('Pushing configurations via NETCONF / SSH…', 't-info');

  for (const d of devs) {
    const os = getOS(d.layer);
    setDeviceStatus(d.id, 'running', `Connecting [${OS_LABELS[os]}]…`);
    termLog(`► ${d.name} [${OS_LABELS[os]}]`, 't-info');

    const lines = getDeployLines(d, os);
    for (const line of lines) {
      await delay(55 + Math.random() * 45);
      termLog(line, 't-dim');
      setDeviceStatus(d.id, 'running', line.trim().replace(/^•\s*/,''));
    }
    await delay(60);
    termLog(`✓ ${d.name}: configuration committed`, 't-ok');
    setDeviceStatus(d.id, 'done', 'Configuration committed ✓');
  }

  await delay(200);
  setStepStatus('ds-deploy-status', 'done');
  pipelineStageEnd('deploy', true);
  termLog(`✓ All ${devs.length} devices configured`, 't-ok');

  // ─ Commit guard ─
  setStepStatus('ds-verify-status', 'running');
  pipelineStageStart('verify');
  termLog('Initiating confirm-commit with 5-minute rollback timer…', 't-info');
  await delay(600);
  termLog('  └─ Commit confirmed — rollback guard cancelled', 't-ok');
  setStepStatus('ds-verify-status', 'done');
  pipelineStageEnd('verify', true);

  DEPLOY_STATE.deployed = true;
  document.getElementById('btn-postcheck').disabled = false;
  termLog('═══ Deployment complete — run Post-Checks to validate ═══', 't-info');
  toast('Deployment complete! Run post-checks now.', 'success', 5000);
}

/* ── Post-Checks ─────────────────────────────────────────────── */
async function runPostChecks() {
  if (!DEPLOY_STATE.deployed) { toast('Deploy first', 'error'); return; }
  document.getElementById('postcheck-results-section').style.display = 'block';
  setStepStatus('ds-postcheck-status', 'running');
  pipelineStageStart('postcheck');
  termLog('Starting post-deployment validation…', 't-info');

  const checks = buildPostChecks();
  window._obsPostCheckCount = checks.length;
  const grid = document.getElementById('postcheck-grid');
  grid.innerHTML = checks.map(c => checkCardHTML(c, 'pending')).join('');

  let passed = 0, failed = 0, warned = 0;
  for (let i = 0; i < checks.length; i++) {
    await delay(250 + Math.random() * 200);
    const c = checks[i];
    const r = simulatePostCheck(c);
    grid.children[i].outerHTML = checkCardHTML(c, r.status, r.detail, r.val);
    termLog(
      `${r.status==='pass'?'✓':r.status==='warn'?'⚠':'✗'} ${c.name}: ${r.detail}`,
      r.status==='pass'?'t-ok':r.status==='warn'?'t-warn':'t-err'
    );
    if (r.status==='pass') passed++; else if (r.status==='warn') warned++; else failed++;
  }

  const ok = failed === 0;
  setStepStatus('ds-postcheck-status', ok ? 'done' : 'failed');
  pipelineStageEnd('postcheck', ok);
  renderScoreRow(passed, warned, failed, checks.length, 'post');
  termLog(`Post-checks: ${passed} passed, ${warned} warnings, ${failed} failed`, ok?'t-ok':'t-err');

  if (ok && warned === 0) {
    termLog('🎉 Network is operational — all checks passed!', 't-ok');
    toast('Network is operational! All post-checks passed.', 'success', 6000);
  } else if (failed > 0) {
    termLog('✗ Critical failures detected — consider rollback', 't-err');
    toast('Post-check failures detected — rollback available', 'error', 7000);
    showRollbackButton();
  } else {
    termLog('⚠ Review warnings before confirming go-live', 't-warn');
  }
  DEPLOY_STATE.postcheck = true;
}

function buildPostChecks() {
  const uc = STATE.uc;
  const isDC = uc==='dc'||uc==='hybrid'||uc==='multisite';
  const isGPU = uc==='gpu';
  const isCampus = uc==='campus'||uc==='hybrid';
  const checks = [
    { name:'Interface states',     icon:'🔌', cat:'l1',   desc:'All expected interfaces UP/UP' },
    { name:'Layer 2 — MACs',      icon:'🗃️', cat:'l2',   desc:'MAC table populated on access ports' },
    { name:'VLAN propagation',     icon:'🏷', cat:'l2',   desc:'All VLANs present on trunk ports' },
    { name:'IP reachability',      icon:'📡', cat:'l3',   desc:'End-to-end ping across all segments' },
    { name:'Default route',       icon:'🗺️', cat:'l3',   desc:'Default route present and correct' },
    { name:'NTP re-sync',         icon:'🕐', cat:'mgmt', desc:'All devices still NTP synced after config push' },
    { name:'SNMP polling',        icon:'📊', cat:'mgmt', desc:'NMS can poll all device OIDs' },
    { name:'Syslog flow',         icon:'📜', cat:'mgmt', desc:'Log messages reaching syslog server' },
  ];
  if (isCampus) {
    checks.push({ name:'Spanning Tree topology', icon:'🌳', cat:'l2', desc:'STP topology stable, no TCN storms' });
    checks.push({ name:'DHCP server reachable',  icon:'📬', cat:'l3', desc:'DHCP offers received on all user VLANs' });
  }
  if (isDC) {
    checks.push({ name:'BGP peers established',  icon:'🔀', cat:'bgp',     desc:'All eBGP sessions Established' });
    checks.push({ name:'EVPN routes learned',    icon:'🌐', cat:'bgp',     desc:'Type-2 MAC-IP and Type-5 IP-prefix routes present' });
    checks.push({ name:'VXLAN encap/decap',      icon:'📦', cat:'overlay', desc:'Ping between VMs on different leaves via VXLAN' });
    checks.push({ name:'ECMP load balancing',    icon:'⚖️', cat:'l3',     desc:'Traffic hashing across all fabric paths' });
    checks.push({ name:'vPC / MLAG consistency', icon:'🔗', cat:'l2',     desc:'vPC peer-link active, config consistent' });
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
    'Interface states':     { val:'48/48 UP',               status:'pass', detail:'All interfaces operational' },
    'BGP peers established':{ val:'8/8 Established',        status:'pass', detail:'All BGP sessions up, prefixes exchanged' },
    'EVPN routes learned':  { val:'Type-2: 142, Type-5: 28',status:'pass', detail:'EVPN route table fully populated' },
    'VXLAN encap/decap':    { val:'RTT 0.8ms',              status:'pass', detail:'Cross-leaf VM reachability confirmed' },
    'RoCEv2 connectivity':  { val:'RDMA RTT 3.2µs',         status:'pass', detail:'RDMA ping successful across all TOR pairs' },
    'GPU-to-GPU bandwidth': { val:'392 Gbps',               status:'pass', detail:'Bandwidth exceeds 380 Gbps threshold' },
    'IP reachability':      { val:'100% success',           status:'pass', detail:'All subnets reachable' },
    'ECMP load balancing':  { val:'4 paths active',         status:'pass', detail:'Traffic balanced across fabric' },
  };
  if (postVals[c.name]) return postVals[c.name];
  if (r > 0.88) return { status:'warn', detail:'Minor anomaly detected — non-critical', val:'Within SLA' };
  return { status:'pass', detail:'Post-check passed', val:'OK' };
}

/* ── Rollback System ─────────────────────────────────────────── */

function showRollbackButton() {
  const bar = document.getElementById('deploy-action-bar');
  if (!bar || bar.querySelector('#btn-rollback')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-rollback';
  btn.className = 'btn btn-ghost';
  btn.style.cssText = 'border-color:#ff5555;color:#ff5555';
  btn.innerHTML = '↺ Rollback to Backup';
  btn.onclick = startRollback;
  bar.appendChild(btn);
  termLog('↺ Rollback available — click "Rollback to Backup" to restore pre-deploy state', 't-warn');
}

async function startRollback() {
  if (BACKUP_STORE.length === 0) {
    toast('No backup snapshots available for rollback', 'error');
    return;
  }

  const btn = document.getElementById('btn-rollback');
  if (btn) { btn.disabled = true; btn.textContent = 'Rolling back…'; }

  termLog('═══ INITIATING ROLLBACK ═══', 't-err');
  termLog(`Restoring ${BACKUP_STORE.length} device configurations from backup…`, 't-warn');
  obsLog && obsLog('Rollback initiated', 'warn', 'rollback');

  for (const bk of BACKUP_STORE) {
    await delay(200 + Math.random() * 150);
    termLog(`  └─ ${bk.name.split('/').pop().split('_')[0]}: restored from ${bk.name}`, 't-warn');
  }

  await delay(400);
  termLog('✓ All devices restored to pre-deployment configuration', 't-ok');
  termLog('  Run Post-Checks again to verify rollback success', 't-info');
  toast('Rollback complete — verify with post-checks', 'success', 5000);

  // Mark deploy stages as rolled_back
  setStepStatus('ds-deploy-status', 'rolled_back');
  setStepStatus('ds-verify-status', 'rolled_back');
  setStepStatus('ds-postcheck-status', 'rolled_back');
  DEPLOY_STATE.deployed = false;

  if (btn) { btn.textContent = '✓ Rolled Back'; }
  obsLog && obsLog('Rollback completed successfully', 'success', 'rollback');

  // Re-enable deploy after rollback
  document.getElementById('btn-deploy').disabled = false;
}

/* ── Scorecard ───────────────────────────────────────────────── */
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

/* ── Reset ───────────────────────────────────────────────────── */
function resetDeploy() {
  DEPLOY_STATE = { precheck:false, deployed:false, postcheck:false };
  BACKUP_STORE.length = 0;
  Object.keys(PIPELINE).forEach(s => {
    PIPELINE[s] = { status:'pending', startedAt:null, completedAt:null, canResume:false };
  });

  ['precheck','backup','deploy','verify','postcheck'].forEach(s => {
    setStepStatus(`ds-${s}-status`,'pending');
    const stageEl = document.getElementById(`ds-${s}`);
    if (stageEl) {
      const ts = stageEl.querySelector('.ds-timestamp');
      if (ts) ts.remove();
    }
  });

  document.getElementById('check-dashboard').style.display = 'none';
  document.getElementById('precheck-results-section').style.display = 'none';
  document.getElementById('postcheck-results-section').style.display = 'none';
  const dss = document.getElementById('device-status-section');
  if (dss) dss.style.display = 'none';
  document.getElementById('btn-deploy').disabled = true;
  document.getElementById('btn-postcheck').disabled = true;

  // Remove injected buttons
  ['btn-rollback','btn-resume'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  clearTerminal();
  if (typeof resetObservability === 'function') resetObservability();
  toast('Reset complete', 'info');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
