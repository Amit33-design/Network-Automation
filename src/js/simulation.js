'use strict';

/* ════════════════════════════════════════════════════════════════
   NETWORK SIMULATION
   Failure scenario simulator, reachability matrix, and route
   propagation table — all derived from STATE + buildDeviceList().
════════════════════════════════════════════════════════════════ */

const SIM = {
  failedDevices: new Set(),   // set of device IDs
};

/* ── Failure Simulator ─────────────────────────────────────── */

function simulateFailure(devId) {
  if (SIM.failedDevices.has(devId)) {
    SIM.failedDevices.delete(devId);
  } else {
    SIM.failedDevices.add(devId);
  }
  // Re-render buttons in place
  document.querySelectorAll('.sim-dev-btn').forEach(btn => {
    const id = btn.dataset.devId;
    btn.classList.toggle('sim-failed', SIM.failedDevices.has(id));
  });
  renderFailureImpacts();
  highlightFailedInSVG();
}

function clearAllSimFailures() {
  SIM.failedDevices.clear();
  document.querySelectorAll('.sim-dev-btn').forEach(btn => btn.classList.remove('sim-failed'));
  renderFailureImpacts();
  highlightFailedInSVG();
}

function getImpactProfile(layer) {
  const profiles = {
    fw:             { sev:'critical', color:'#ff4444', desc:'All north-south traffic blocked. Inter-zone routing fails. Internet access lost.' },
    'campus-core':  { sev:'critical', color:'#ff4444', desc:'Core routing impaired. Inter-VLAN and internet access affected across all distribution blocks.' },
    'campus-dist':  { sev:'high',     color:'#ff8800', desc:'Access switches on this distribution block lose uplink. OSPF re-converges via peer distribution (if HA).' },
    'campus-access':{ sev:'medium',   color:'#ffbb00', desc:'End-user ports down. Hosts on this switch lose network access.' },
    'dc-spine':     { sev:'high',     color:'#ff8800', desc:'ECMP reduced 50%. BGP reconverges via remaining spine (~200ms). No traffic loss with HA.' },
    'dc-leaf':      { sev:'medium',   color:'#ffbb00', desc:'Attached servers lose connectivity. EVPN withdraws MAC-IP and IP-prefix routes. vPC peer-link keeps LAG servers up.' },
    'gpu-spine':    { sev:'high',     color:'#ff8800', desc:'GPU fabric split. RoCEv2 flows rerouted. RDMA throughput drops ~50%. AI job continues if ECMP tolerant.' },
    'gpu-tor':      { sev:'medium',   color:'#ffbb00', desc:'Attached GPUs go offline. RDMA sessions terminate. Dependent AI jobs restart.' },
    'wan-cpe':      { sev:'high',     color:'#ff8800', desc:'Branch site loses primary WAN. SD-WAN fails over to backup link in <30s.' },
    'wan-hub':      { sev:'critical', color:'#ff4444', desc:'All branch WAN connectivity lost. Failover to secondary hub if configured.' },
  };
  return profiles[layer] || { sev:'low', color:'var(--green)', desc:'Minor impact — redundancy absorbs failure without service degradation.' };
}

function getRedundancyNote(dev) {
  const isHA = STATE.redundancy === 'ha' || STATE.redundancy === 'full';
  if (!isHA) return '<div class="sim-failover sim-no-ha">⚠️ No redundancy configured — this is a single point of failure</div>';

  const peers = {
    'campus-core': 'CORE-02', 'campus-dist': 'DIST-0' + (dev.idx === 0 ? 2 : 1),
    'dc-spine':    'SPINE-0' + (dev.idx === 0 ? 2 : 1),
    'gpu-spine':   'GPU-SPINE-0' + (dev.idx === 0 ? 2 : 1),
    fw:            'FW-02',
  };
  const peer = peers[dev.layer];
  const convTime = { 'campus-core': '< 1s (OSPF)', 'dc-spine': '< 200ms (BGP BFD)', 'gpu-spine': '< 300ms (BGP BFD)', 'campus-dist': '< 1s (STP/OSPF)' };
  const conv = convTime[dev.layer] || '< 30s';

  if (peer) {
    return `<div class="sim-failover">🔄 Failover to <strong>${peer}</strong> — convergence ${conv}</div>`;
  }
  return `<div class="sim-failover">🔄 Redundant path available — convergence ${conv}</div>`;
}

function renderFailureImpacts() {
  const el = document.getElementById('sim-results');
  if (!el) return;

  if (SIM.failedDevices.size === 0) {
    el.innerHTML = `
      <div class="sim-empty">
        <div style="font-size:2.5rem;margin-bottom:.5rem">✅</div>
        <div style="font-weight:600">All devices operational</div>
        <div style="font-size:.8rem;color:var(--txt3);margin-top:.3rem">Click any device button above to simulate a failure</div>
      </div>`;
    renderFabricHealth(100);
    return;
  }

  const devs = buildDeviceList();
  let html = '<div class="sim-impact-list">';

  SIM.failedDevices.forEach(devId => {
    const dev = devs.find(d => d.id === devId);
    if (!dev) return;
    const { sev, color, desc } = getImpactProfile(dev.layer);
    html += `
      <div class="sim-impact-card" style="border-left:3px solid ${color}">
        <div class="sim-impact-hdr">
          <span class="sim-dev-name">${dev.icon} ${dev.name}</span>
          <span class="sim-sev" style="background:${color}22;color:${color};border:1px solid ${color}55">${sev.toUpperCase()}</span>
        </div>
        <div class="sim-impact-desc">${desc}</div>
        ${getRedundancyNote(dev)}
      </div>`;
  });

  html += '</div>';
  el.innerHTML = html;

  const pct = Math.max(0, Math.round(((devs.length - SIM.failedDevices.size) / devs.length) * 100));
  renderFabricHealth(pct);
}

function renderFabricHealth(pct) {
  const el = document.getElementById('sim-health');
  if (!el) return;
  const color = pct > 80 ? 'var(--green)' : pct > 50 ? 'var(--orange)' : '#ff4444';
  el.innerHTML = `
    <div class="sim-health-wrap">
      <div class="sim-health-label">
        <span>Fabric Health</span>
        <span style="color:${color};font-weight:700">${pct}%</span>
      </div>
      <div class="sim-health-track">
        <div class="sim-health-bar" style="width:${pct}%;background:${color};transition:width .5s ease"></div>
      </div>
    </div>`;
}

function highlightFailedInSVG() {
  const svg = document.querySelector('#hld-svg-container svg');
  if (!svg) return;
  // Reset all device groups
  svg.querySelectorAll('[data-dev-id]').forEach(el => {
    el.style.opacity = '';
    el.style.filter  = '';
  });
  SIM.failedDevices.forEach(id => {
    const el = svg.querySelector(`[data-dev-id="${id}"]`);
    if (el) { el.style.opacity = '0.25'; el.style.filter = 'grayscale(1)'; }
  });
}

/* ── Reachability Matrix ────────────────────────────────────── */

function getNetworkSegments() {
  const segs = {
    campus: [
      { s:'Internet', name:'Internet / WAN',   zone:'external' },
      { s:'Core',     name:'Core Network',     zone:'core'     },
      { s:'Data',     name:'User Data VLAN',   zone:'trusted'  },
      { s:'Voice',    name:'Voice VLAN',       zone:'trusted'  },
      { s:'Guest',    name:'Guest SSID',       zone:'untrusted'},
      { s:'Mgmt',     name:'OOB Management',   zone:'mgmt'     },
      { s:'IoT',      name:'IoT / BMS',        zone:'restricted'},
    ],
    dc: [
      { s:'Internet', name:'Internet',         zone:'external' },
      { s:'DMZ',      name:'DMZ Servers',      zone:'dmz'      },
      { s:'Prod',     name:'Production',       zone:'trusted'  },
      { s:'Dev',      name:'Development',      zone:'trusted'  },
      { s:'Storage',  name:'Storage VLAN',     zone:'trusted'  },
      { s:'Mgmt',     name:'OOB Management',   zone:'mgmt'     },
    ],
    gpu: [
      { s:'Compute',  name:'GPU Compute',      zone:'trusted'  },
      { s:'Storage',  name:'NVMe-oF / NFS',   zone:'trusted'  },
      { s:'OOB',      name:'Out-of-Band',      zone:'mgmt'     },
      { s:'Internet', name:'Internet',         zone:'external' },
      { s:'Mgmt',     name:'k8s Control',      zone:'mgmt'     },
    ],
    wan: [
      { s:'HQ',       name:'Headquarters',     zone:'trusted'  },
      { s:'Br1',      name:'Branch Site 1',    zone:'trusted'  },
      { s:'Br2',      name:'Branch Site 2',    zone:'trusted'  },
      { s:'Internet', name:'Internet',         zone:'external' },
      { s:'Mgmt',     name:'NOC / Management', zone:'mgmt'     },
    ],
    hybrid: [
      { s:'Campus',   name:'Campus Users',     zone:'trusted'  },
      { s:'DC Prod',  name:'DC Production',    zone:'trusted'  },
      { s:'DMZ',      name:'DMZ',              zone:'dmz'      },
      { s:'Internet', name:'Internet',         zone:'external' },
      { s:'Mgmt',     name:'OOB Management',   zone:'mgmt'     },
    ],
    multisite: [
      { s:'DCA',      name:'DC-A Primary',     zone:'trusted'  },
      { s:'DCB',      name:'DC-B Active-Active',zone:'trusted' },
      { s:'DCC',      name:'DC-C DR',          zone:'trusted'  },
      { s:'DCD',      name:'DC-D Edge',        zone:'trusted'  },
      { s:'Internet', name:'Internet',         zone:'external' },
    ],
  };
  return segs[STATE.uc] || segs.dc;
}

function reachDecision(src, dst) {
  // Same zone = always reachable
  if (src.zone === dst.zone) return 'ok';
  // trusted ↔ trusted across sites = ok
  if (src.zone === 'trusted' && dst.zone === 'trusted') return 'ok';
  // external → mgmt = always blocked
  if (src.zone === 'external' && dst.zone === 'mgmt') return 'blocked';
  // untrusted → trusted = blocked
  if (src.zone === 'untrusted' && dst.zone === 'trusted') return 'blocked';
  // untrusted → mgmt = blocked
  if (src.zone === 'untrusted' && dst.zone === 'mgmt') return 'blocked';
  // restricted → anything = blocked
  if (src.zone === 'restricted') return 'blocked';
  // external → trusted = blocked
  if (src.zone === 'external' && dst.zone === 'trusted') return 'blocked';
  // dmz → trusted = restricted (partial)
  if (src.zone === 'dmz' && dst.zone === 'trusted') return 'partial';
  // core ↔ trusted = ok
  if (src.zone === 'core' || dst.zone === 'core') return 'ok';
  return 'partial';
}

function buildReachabilityMatrix() {
  const el = document.getElementById('sim-reachability');
  if (!el) return;

  const segs = getNetworkSegments();

  let html = '<div class="reach-table-wrap"><table class="reach-table"><thead><tr><th></th>';
  segs.forEach(s => { html += `<th title="${s.name}">${s.s}</th>`; });
  html += '</tr></thead><tbody>';

  segs.forEach(src => {
    html += `<tr><td class="reach-row-lbl" title="${src.name}">${src.s}</td>`;
    segs.forEach(dst => {
      if (src.s === dst.s) { html += `<td class="reach-self">●</td>`; return; }
      const d = reachDecision(src, dst);
      const info = {
        ok:      { cls:'reach-ok',      icon:'✓', title:'Reachable' },
        partial: { cls:'reach-partial', icon:'~', title:'Restricted / Filtered' },
        blocked: { cls:'reach-blocked', icon:'✗', title:'Blocked by policy' },
      }[d];
      html += `<td class="${info.cls}" title="${src.name} → ${dst.name}: ${info.title}">${info.icon}</td>`;
    });
    html += '</tr>';
  });

  html += `</tbody></table></div>
  <div class="reach-legend">
    <span class="rleg rleg-ok">✓ Reachable</span>
    <span class="rleg rleg-partial">~ Restricted</span>
    <span class="rleg rleg-blocked">✗ Blocked</span>
  </div>`;

  el.innerHTML = html;
}

/* ── Route Propagation Table ───────────────────────────────── */

function buildRoutePropagationTable() {
  const el = document.getElementById('sim-routes');
  if (!el) return;

  const tables = {
    dc: [
      { prefix:'10.0.0.0/24',     origin:'LEAF-01 Lo0',  proto:'IS-IS',    path:['LEAF-01','SPINE-01','SPINE-02','LEAF-02','LEAF-03','LEAF-04'], conv:'< 200ms' },
      { prefix:'192.168.10.0/24', origin:'Server subnet', proto:'BGP EVPN', path:['LEAF-01 (Type-5)','SPINE-01 (RR)','All Leafs (withdraw+readvertise)'], conv:'< 500ms' },
      { prefix:'172.16.0.0/12',   origin:'DC-Leaf VRF',  proto:'BGP L3VPN',path:['LEAF-02','SPINE-01','LEAF-01','LEAF-03'],                   conv:'< 400ms' },
      { prefix:'0.0.0.0/0',       origin:'Border FW',    proto:'BGP eBGP', path:['FW-01','SPINE-01','SPINE-02','All Leafs'],                  conv:'< 1s' },
    ],
    campus: [
      { prefix:'192.168.1.0/24',  origin:'VLAN 10 GW',   proto:'OSPF Area 0',   path:['CORE-01','DIST-01','DIST-02','All Access'],     conv:'< 1s' },
      { prefix:'192.168.50.0/24', origin:'Voice VLAN 50', proto:'OSPF Area 0',   path:['CORE-01','All Dist','All Access'],              conv:'< 1s' },
      { prefix:'10.0.0.0/8',      origin:'Corporate DC',  proto:'OSPF External', path:['FW-01 (E2)','CORE-01','All Dist'],             conv:'< 2s' },
      { prefix:'0.0.0.0/0',       origin:'ISP / FW',      proto:'BGP → OSPF',    path:['FW-01','CORE-01','CORE-02 (HA)','All Dist'],  conv:'< 2s' },
    ],
    gpu: [
      { prefix:'10.0.0.0/22',     origin:'GPU Compute pool', proto:'BGP ECMP',  path:['GPU-TOR-01','GPU-SPINE-01','GPU-SPINE-02','All TORs'], conv:'< 300ms' },
      { prefix:'10.1.0.0/22',     origin:'Storage pool',     proto:'BGP ECMP',  path:['STOR-TOR','GPU-SPINE-01','All TORs'],                 conv:'< 300ms' },
      { prefix:'169.254.0.0/16',  origin:'RoCEv2 RDMA',      proto:'BGP (local)',path:['Within TOR pair (no spine hairpin)'],               conv:'< 1µs (intra-TOR)' },
    ],
    wan: [
      { prefix:'10.10.0.0/16',    origin:'HQ LAN',           proto:'BGP eBGP',  path:['HQ-CE','MPLS PE','Branch-PE','Branch-CE'], conv:'< 5s (BGP)' },
      { prefix:'10.20.0.0/16',    origin:'Branch 1 LAN',     proto:'BGP eBGP',  path:['BR1-CE','MPLS PE','HQ-PE','HQ-CE'],        conv:'< 5s (BGP)' },
      { prefix:'0.0.0.0/0',       origin:'HQ Internet FW',   proto:'BGP',       path:['FW-01','HQ-CE','PE','All Branches'],       conv:'< 10s' },
    ],
    hybrid: [
      { prefix:'192.168.0.0/16',  origin:'Campus VLANs',     proto:'OSPF → BGP',path:['CORE-01','DC-Border FW','SPINE-01','Leafs'], conv:'< 2s' },
      { prefix:'10.0.0.0/8',      origin:'DC Subnets',       proto:'BGP EVPN',  path:['LEAF-01','SPINE-01','FW-01','CORE-01','Campus'], conv:'< 1s' },
    ],
    multisite: [
      { prefix:'10.0.0.0/22',     origin:'DCA Production',   proto:'BGP EVPN Type-5', path:['DCA-LEAF','DCA-SPINE','WAN DCI','DCB-SPINE','DCB-LEAF'], conv:'< 1s' },
      { prefix:'10.1.0.0/22',     origin:'DCB Production',   proto:'BGP EVPN Type-5', path:['DCB-LEAF','DCB-SPINE','WAN DCI','DCA-SPINE','DCC-SPINE'], conv:'< 1s' },
      { prefix:'10.100.0.0/24',   origin:'DCD Edge site',    proto:'BGP',             path:['DCD-LEAF','DCD-SPINE','WAN CE','MP-BGP → All Sites'],    conv:'< 5s' },
    ],
  };

  const rows = tables[STATE.uc] || tables.dc;

  let html = `
    <div class="lld-table-wrap">
    <table class="lld-table">
      <thead><tr>
        <th>Prefix</th><th>Origin</th><th>Protocol</th>
        <th>Propagation Path</th><th>Convergence</th>
      </tr></thead><tbody>`;

  rows.forEach(r => {
    const path = r.path.map(p => `<span class="prop-hop">${p}</span>`).join('<span class="prop-arrow"> → </span>');
    html += `<tr>
      <td><code class="pfx-code">${r.prefix}</code></td>
      <td style="color:var(--txt1)">${r.origin}</td>
      <td><span class="proto-pill">${r.proto}</span></td>
      <td class="prop-path-cell">${path}</td>
      <td><span class="conv-pill">${r.conv}</span></td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

/* ── Render simulation tab (called on tab switch) ─────────── */

function renderSimulationTab() {
  const devs = buildDeviceList();
  const btnGrid = devs.map(d => `
    <button class="sim-dev-btn ${SIM.failedDevices.has(d.id) ? 'sim-failed' : ''}"
      data-dev-id="${d.id}"
      onclick="simulateFailure('${d.id}')"
      title="${d.role} — click to toggle failure">
      ${d.icon} <span>${d.name}</span>
    </button>`).join('');

  const tab = document.getElementById('sim-tab-content');
  if (!tab) return;

  tab.innerHTML = `

    <!-- ── Failure Scenarios ── -->
    <div class="sim-panel">
      <div class="sim-sec-hdr">
        <h4>🔴 Failure Scenario Simulator</h4>
        <p>Toggle device failures to simulate impact. Convergence times, failover paths, and fabric health are derived from your redundancy design.</p>
      </div>
      <div class="sim-dev-grid" id="sim-dev-grid">${btnGrid}</div>
      <div style="display:flex;gap:.6rem;margin:.75rem 0">
        <button class="btn btn-ghost" onclick="clearAllSimFailures()" style="font-size:.78rem;padding:.35rem .75rem">↺ Clear All</button>
      </div>
      <div id="sim-health"></div>
      <div id="sim-results"></div>
    </div>

    <!-- ── Reachability Matrix ── -->
    <div class="sim-panel">
      <div class="sim-sec-hdr">
        <h4>🗺️ Reachability Matrix</h4>
        <p>Segment-to-segment connectivity derived from your security zones and firewall policy intent.</p>
      </div>
      <div id="sim-reachability"></div>
    </div>

    <!-- ── Route Propagation ── -->
    <div class="sim-panel">
      <div class="sim-sec-hdr">
        <h4>📡 Control-Plane Route Propagation</h4>
        <p>How prefixes originate and propagate through the underlay and overlay protocols in your design.</p>
      </div>
      <div id="sim-routes"></div>
    </div>`;

  renderFailureImpacts();
  renderFabricHealth(100);
  buildReachabilityMatrix();
  buildRoutePropagationTable();
}
