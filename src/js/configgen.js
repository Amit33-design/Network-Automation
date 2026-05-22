'use strict';

/* ════════════════════════════════════════════════════════════════
   PART 4 — Configuration Generator
════════════════════════════════════════════════════════════════ */

/* ── Determine OS per layer ─────────────────────────────────────── */
function getOS(layerKey) {
  // Multicloud layers have their own OS/format label
  if (layerKey === 'mc-dc-edge') return STATE.mcDCEdgeVendor === 'eos' ? 'eos' : (STATE.mcDCEdgeVendor === 'junos' ? 'junos' : 'ios-xe');
  if (layerKey === 'mc-aws' || layerKey === 'mc-azure' || layerKey === 'mc-gcp') return 'terraform';
  if (layerKey === 'mc-ansible')       return 'ansible';
  if (layerKey === 'mc-cicd')          return 'yaml';
  if (layerKey === 'mc-tf-outputs')    return 'terraform';
  if (layerKey === 'mc-tf-bootstrap')  return 'terraform';
  if (layerKey === 'mc-repo')          return 'text';
  if (layerKey === 'mc-aviatrix')      return 'terraform';
  const prod = PRODUCTS[STATE.selectedProducts[layerKey]];
  if (!prod) return 'ios-xe';
  const v = prod.vendor;
  const dcLayers = ['dc-leaf','dc-spine','gpu-tor','gpu-spine'];
  if (v === 'Cisco'           && dcLayers.includes(layerKey)) return 'nxos';
  if (v === 'Cisco')           return 'ios-xe';
  if (v === 'Arista')          return 'eos';
  if (v === 'Juniper')         return 'junos';
  if (v === 'NVIDIA')          return 'sonic';
  if (v === 'Dell EMC')        return 'sonic';
  // Fortinet, HPE Aruba, Extreme — use IOS-XE template as base (closest CLI style)
  if (v === 'Fortinet')        return 'ios-xe';
  if (v === 'HPE Aruba')       return 'ios-xe';
  if (v === 'Extreme Networks') return 'eos';
  return 'ios-xe';
}

const OS_LABELS = { 'ios-xe':'IOS-XE', 'nxos':'NX-OS', 'eos':'EOS', 'junos':'Junos', 'sonic':'SONiC', 'terraform':'Terraform HCL', 'ansible':'Ansible YAML' };

/* ── Device list builder — generates ALL devices, no cap ─────────── */

function buildDeviceList() {
  const uc   = STATE.uc;
  const red  = STATE.redundancy;
  const dual = red === 'ha' || red === 'full';
  const haFW = STATE.fwModel && STATE.fwModel !== 'none';
  const sz   = STATE.orgSize;

  const cap  = capacityFromState(STATE);
  const devs = [];

  // ── Firewall ──────────────────────────────────────────────────
  if (haFW) {
    devs.push({ id:'fw-01', name:'FW-01', layer:'fw', role:'Internet Perimeter FW', icon:'🔒', idx:0 });
    if (dual) devs.push({ id:'fw-02', name:'FW-02', layer:'fw', role:'Firewall HA pair', icon:'🔒', idx:1 });
  }

  // ── CAMPUS ────────────────────────────────────────────────────
  if (uc === 'campus' || uc === 'hybrid') {
    const c = cap.campus || { core:2, dist:4, access:6 };

    for (let i = 0; i < c.core; i++) {
      devs.push({ id:`core-${String(i+1).padStart(2,'0')}`, name:`CORE-${String(i+1).padStart(2,'0')}`,
        layer:'campus-core', role:'Core Switch', icon:'⚙️', idx:i, _totalInLayer:c.core });
    }

    for (let i = 0; i < c.dist; i++) {
      devs.push({ id:`dist-${String(i+1).padStart(2,'0')}`, name:`DIST-${String(i+1).padStart(2,'0')}`,
        layer:'campus-dist', role:`Distribution ${dual?'HA':''}`, icon:'🔀', idx:i,
        _totalInLayer:c.dist });
    }

    const zones = ['FL1','FL2','SRV','IOT'];
    for (let i = 0; i < c.access; i++) {
      const zone = zones[Math.floor(i / Math.ceil(c.access / 4))];
      devs.push({ id:`acc-${String(i+1).padStart(2,'0')}`, name:`ACC-${zone}-${String(i+1).padStart(2,'0')}`,
        layer:'campus-access', role:`Access Switch (${zone})`, icon:'🔌', idx:i,
        _totalInLayer:c.access });
    }
  }

  // ── DATA CENTER ───────────────────────────────────────────────
  if (uc === 'dc' || uc === 'hybrid' || uc === 'multisite') {
    const c = cap.dc || { spines:4, leafs:4 };
    if (uc === 'multisite') {
      const sites = Math.min(4, Math.max(3, parseInt(STATE.numSitesTopology) || 3));
      ['DCA','DCB','DCC','DCD'].slice(0, sites).forEach((sid, si) => {
        devs.push({ id:`${sid.toLowerCase()}-sp1`, name:`${sid}-SPINE-01`, layer:'dc-spine', role:`${sid} Spine`, icon:'🦴', idx:si*2   });
        devs.push({ id:`${sid.toLowerCase()}-sp2`, name:`${sid}-SPINE-02`, layer:'dc-spine', role:`${sid} Spine`, icon:'🦴', idx:si*2+1 });
        devs.push({ id:`${sid.toLowerCase()}-lf1`, name:`${sid}-LEAF-01`,  layer:'dc-leaf',  role:`${sid} Leaf`,  icon:'🍃', idx:si*2   });
        devs.push({ id:`${sid.toLowerCase()}-lf2`, name:`${sid}-LEAF-02`,  layer:'dc-leaf',  role:`${sid} Leaf`,  icon:'🍃', idx:si*2+1 });
      });
    } else {
      for (let i = 0; i < c.spines; i++) {
        devs.push({ id:`spine-${String(i+1).padStart(2,'0')}`, name:`SPINE-${String(i+1).padStart(2,'0')}`,
          layer:'dc-spine', role:'DC Spine', icon:'🦴', idx:i, _totalInLayer:c.spines });
      }
      const roles = [
        ...Array(c.prodLeafs || Math.ceil(c.leafs * .5)).fill('PROD'),
        ...Array(c.storLeafs || Math.ceil(c.leafs * .25)).fill('STOR'),
        ...Array(c.devLeafs  || 0).fill('DEV'),
      ];
      for (let i = 0; i < c.leafs; i++) {
        const fn = roles[i] || 'PROD';
        devs.push({ id:`leaf-${String(i+1).padStart(2,'0')}`, name:`LEAF-${fn}-${String(i+1).padStart(2,'0')}`,
          layer:'dc-leaf', role:`DC Leaf (${fn})`, icon:'🍃', idx:i, _totalInLayer:c.leafs });
      }
    }
  }

  // ── GPU ───────────────────────────────────────────────────────
  if (uc === 'gpu') {
    const c = cap.gpu || { spines:2, tors:4 };
    for (let i = 0; i < c.spines; i++) {
      devs.push({ id:`gspine-${String(i+1).padStart(2,'0')}`, name:`GPU-SPINE-${String(i+1).padStart(2,'0')}`,
        layer:'gpu-spine', role:'GPU Spine', icon:'🧠', idx:i, _totalInLayer:c.spines });
    }
    for (let i = 0; i < c.tors; i++) {
      devs.push({ id:`tor-${String(i+1).padStart(2,'0')}`, name:`GPU-TOR-${String(i+1).padStart(2,'0')}`,
        layer:'gpu-tor', role:'GPU TOR', icon:'⚡', idx:i, _totalInLayer:c.tors });
    }
  }

  // ── WAN ───────────────────────────────────────────────────────
  if (uc === 'wan') {
    const c = cap.wan || { hubRouters:2, cpe:4 };
    for (let i = 0; i < c.hubRouters; i++) {
      devs.push({ id:`hq-rtr-${i+1}`, name:`HQ-RTR-${String(i+1).padStart(2,'0')}`,
        layer:'campus-core', role:'HQ Core Router', icon:'🌐', idx:i, _totalInLayer:c.hubRouters });
    }
    for (let i = 0; i < c.cpe; i++) {
      devs.push({ id:`br-${String(i+1).padStart(2,'0')}`, name:`BRANCH-${String(i+1).padStart(2,'0')}`,
        layer:'campus-access', role:'Branch CPE', icon:'📡', idx:i, _totalInLayer:c.cpe });
    }
  }

  // ── MULTICLOUD ────────────────────────────────────────────────
  if (uc === 'multicloud' && typeof window.multicloudDevices === 'function') {
    const mcDevs = window.multicloudDevices(STATE);
    mcDevs.forEach(d => devs.push(d));
  }

  // Apply structured hostnames — skip multisite (site prefix in name is load-bearing)
  if (uc !== 'multisite' && uc !== 'multicloud' && typeof generateHostnames === 'function') {
    generateHostnames(devs, STATE);
  }

  return devs;
}

/* ── Render device list sidebar ─────────────────────────────────── */
let DEVICE_LIST = [];
let ACTIVE_DEV  = null;
let _devFilter  = '';

const _GROUP_LABELS = {
  'fw':            '🔒 Security / Firewall',
  'campus-core':   '⚙️ Core Layer',
  'campus-dist':   '🔀 Distribution Layer',
  'campus-access': '🔌 Access Layer',
  'dc-spine':      '🦴 DC Spine',
  'dc-leaf':       '🍃 DC Leaf / ToR',
  'gpu-spine':     '🧠 GPU Spine',
  'gpu-tor':       '⚡ GPU TOR',
  'mc-dc-edge':    '🔌 Multicloud DC Edge',
  'mc-aws':        '☁️ AWS Terraform',
  'mc-azure':      '☁️ Azure Terraform',
  'mc-gcp':        '☁️ GCP Terraform',
  'mc-ansible':       '📋 Ansible Vars',
  'mc-cicd':          '⚙️ GitHub Actions',
  'mc-tf-outputs':    '📤 TF Outputs',
  'mc-tf-bootstrap':  '🏗 TF Bootstrap',
  'mc-repo':          '📁 Repo Scaffolding',
  'mc-aviatrix':      '🛡 Aviatrix Config',
};

function renderDeviceList() {
  DEVICE_LIST  = buildDeviceList();
  _devFilter   = '';
  _layerFilter = 'all';
  document.querySelectorAll('.layer-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === 'all'));

  const badge = document.getElementById('dev-count-badge');
  badge.textContent = DEVICE_LIST.length;

  // Inject search box + list body — replaces inner content of dev-list-body's parent
  const body = document.getElementById('dev-list-body');

  // Build search input once (inserted before the list)
  let searchEl = document.getElementById('dev-search-input');
  if (!searchEl) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:.5rem .6rem .3rem;position:sticky;top:0;background:var(--bg2);z-index:2';
    wrap.innerHTML = `<input id="dev-search-input" type="search" placeholder="Filter devices…"
      style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--txt);border-radius:6px;padding:.35rem .6rem;font-size:.78rem;outline:none"
      oninput="_filterDevList(this.value)">`;
    body.parentElement.insertBefore(wrap, body);
    searchEl = wrap.querySelector('input');
  }

  _renderDevItems(DEVICE_LIST);

  // Auto-select first device
  if (DEVICE_LIST.length) selectDevice(DEVICE_LIST[0].id);
}

function _filterDevList(query) {
  _devFilter = query.trim().toLowerCase();
  _applyDevFilters();
}

let _layerFilter = 'all';

function filterDevLayer(layer, btn) {
  _layerFilter = layer;
  // Update chip active state
  document.querySelectorAll('.layer-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === layer));
  _applyDevFilters();
}

function _applyDevFilters() {
  let list = DEVICE_LIST;
  if (_layerFilter && _layerFilter !== 'all') {
    list = list.filter(d => d.layer === _layerFilter);
  }
  if (_devFilter) {
    list = list.filter(d => d.name.toLowerCase().includes(_devFilter) || d.role.toLowerCase().includes(_devFilter));
  }
  const badge = document.getElementById('dev-count-badge');
  const total = DEVICE_LIST.length;
  badge.textContent = list.length < total ? `${list.length}/${total}` : total;
  _renderDevItems(list);
}

function _renderDevItems(devs) {
  const body = document.getElementById('dev-list-body');

  // Group by layer
  const groups = {};
  devs.forEach(d => { (groups[d.layer] = groups[d.layer] || []).push(d); });

  // Build HTML in chunks for large lists (avoids single long string concat)
  const parts = [];
  Object.entries(groups).forEach(([layer, layerDevs]) => {
    const layerTotal = layerDevs[0]?._totalInLayer || layerDevs.length;
    parts.push(`<div class="dev-group-label">${_GROUP_LABELS[layer] || layer}
      <span style="opacity:.5;font-size:.75em;margin-left:.4rem">×${layerTotal}</span>
    </div>`);
    layerDevs.forEach(d => {
      const os = getOS(d.layer);
      parts.push(`<div class="dev-item" id="di-${d.id}" onclick="selectDevice('${d.id}')">
        <span class="di-icon">${d.icon}</span>
        <div class="di-info">
          <div class="di-name">${d.name}</div>
          <div class="di-role">${d.role}</div>
        </div>
        <span class="di-os">${OS_LABELS[os]}</span>
      </div>`);
    });
  });

  if (!parts.length) {
    body.innerHTML = `<div style="padding:1rem;text-align:center;color:var(--txt3);font-size:.82rem">No devices match "${_devFilter}"</div>`;
    return;
  }

  body.innerHTML = parts.join('');

  // Re-highlight active device if still visible
  if (ACTIVE_DEV) {
    const el = document.getElementById(`di-${ACTIVE_DEV.id}`);
    if (el) el.classList.add('active');
  }
}

/* ── Select & render a device config ───────────────────────────── */
function selectDevice(id) {
  ACTIVE_DEV = DEVICE_LIST.find(d => d.id === id);
  if (!ACTIVE_DEV || ACTIVE_DEV._overflow) return;

  // Update sidebar active state
  document.querySelectorAll('.dev-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`di-${id}`);
  if (el) el.classList.add('active');

  const os   = getOS(ACTIVE_DEV.layer);
  const prod = PRODUCTS[STATE.selectedProducts[ACTIVE_DEV.layer]];

  // Update header
  document.getElementById('cfgv-icon').textContent  = ACTIVE_DEV.icon;
  document.getElementById('cfgv-name').textContent  = ACTIVE_DEV.name;
  document.getElementById('cfgv-os').textContent    = OS_LABELS[os] + (prod ? ` · ${prod.vendor}` : '');

  // Generate config
  const raw = generateConfig(ACTIVE_DEV, os);

  // Diff engine: snapshot on first render; rotate on subsequent
  if (typeof snapshotConfigFirst === 'function') {
    if (!CONFIG_HISTORY[id]) {
      snapshotConfigFirst(id, raw);
    } else {
      snapshotConfigUpdate(id, raw);
    }
  }

  // Mark the dev-item with data-dev-id for diff engine
  if (el) el.dataset.devId = id;

  // Build section nav
  renderSectionNav(raw);

  // Restore non-diff view if we switched device mid-diff
  if (typeof _diffMode !== 'undefined' && _diffMode) closeDiffView();

  // Render highlighted code
  const area = document.getElementById('cfg-code-area');
  if (area) {
    area.innerHTML = `<pre class="cfg-code" id="cfg-code-pre">${highlight(raw, os)}</pre>`;
  } else {
    document.getElementById('cfg-code-pre').innerHTML = highlight(raw, os);
  }
}

/* ── Section nav ────────────────────────────────────────────────── */
const SECTION_MARKERS = ['MANAGEMENT', 'VLANs', 'INTERFACES', 'WAN', 'DMVPN', 'NAT', 'FHRP', 'IGMP', 'ROUTING', 'OSPF', 'IS-IS', 'MLAG', 'BGP', 'EVPN', 'STP', 'QoS', 'SECURITY', 'IPv6', 'NTP', 'SNMP', 'AAA', 'gNMI'];
function renderSectionNav(code) {
  const nav = document.getElementById('cfg-section-nav');
  const found = SECTION_MARKERS.filter(s => code.toUpperCase().includes(s.toUpperCase()));
  nav.innerHTML = found.map((s,i) =>
    `<button class="cfg-snav-btn ${i===0?'active':''}" onclick="jumpSection('${s}',this)">${s}</button>`
  ).join('');
}
function jumpSection(name, btn) {
  document.querySelectorAll('.cfg-snav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const pre  = document.getElementById('cfg-code-pre');
  const area = document.getElementById('cfg-code-area');
  const text = pre.textContent || '';
  const idx  = text.toUpperCase().indexOf(name.toUpperCase());
  if (idx < 0) return;
  const lines = text.slice(0, idx).split('\n').length;
  const lineH = parseFloat(getComputedStyle(pre).lineHeight) || 20;
  area.scrollTop = (lines - 2) * lineH;
}
function toggleAllSections() { document.getElementById('cfg-code-area').scrollTop = 0; }

/* ── Copy & Download ────────────────────────────────────────────── */
function copyConfig() {
  const text = document.getElementById('cfg-code-pre').textContent;
  navigator.clipboard.writeText(text).then(() => {
    document.getElementById('cfg-code-pre').classList.add('copy-flash');
    setTimeout(() => document.getElementById('cfg-code-pre').classList.remove('copy-flash'), 600);
    toast('Config copied to clipboard', 'success');
  });
}
function downloadConfig() {
  if (!ACTIVE_DEV) return;
  const text = document.getElementById('cfg-code-pre').textContent;
  const os   = getOS(ACTIVE_DEV.layer);
  const ext  = { 'ios-xe':'ios','nxos':'nxos','eos':'eos','junos':'conf','sonic':'cfg' }[os] || 'txt';
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob([text], { type:'text/plain' }));
  a.download = `${ACTIVE_DEV.name.toLowerCase()}.${ext}`;
  a.click();
  toast(`${ACTIVE_DEV.name} config downloaded`, 'success');
}

/* ════════════════════════════════════════════════════════════════
   STP / RSTP HELPER BLOCKS  (campus switches — access/dist/core)
   Root bridge priority: core=4096 (primary), dist=8192 (secondary),
   access=32768 (defer). BPDU guard + portfast on edge ports.
════════════════════════════════════════════════════════════════ */

function _genSTP(vendor, layer) {
  const isCore   = layer === 'campus-core';
  const isDist   = layer === 'campus-dist';
  const isAccess = layer === 'campus-access';
  if (!isCore && !isDist && !isAccess) return '';

  const vlanList = '10,20,21,30,40,41,50,60,99';
  const priority = isCore ? 4096 : isDist ? 8192 : 32768;

  if (vendor === 'ios-xe') {
    return `!
! ── STP / Rapid-PVST+ ───────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree extend system-id
spanning-tree pathcost method long
spanning-tree loopguard default
spanning-tree portfast bpduguard default
spanning-tree vlan ${vlanList} priority ${priority}
${isCore ? `spanning-tree vlan ${vlanList} root primary` :
  isDist  ? `spanning-tree vlan ${vlanList} root secondary` :
            `spanning-tree portfast default
spanning-tree portfast bpduguard default`}
`;
  }

  if (vendor === 'eos') {
    return `!
! ── STP / Rapid-PVST+ ───────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree vlan-id ${vlanList} priority ${priority}
spanning-tree loopguard default
${isCore ? `spanning-tree vlan-id ${vlanList} root primary` :
  isDist  ? `spanning-tree vlan-id ${vlanList} root secondary` :
            `spanning-tree portfast default
spanning-tree portfast bpduguard default`}
`;
  }

  if (vendor === 'junos') {
    const bridgePri = priority;
    return `
# ── STP / RSTP ──────────────────────────────────────────────
protocols {
    rstp {
        bridge-priority ${bridgePri};
        interface all {
            edge;
            no-root-port;
        }
        ${isAccess ? `interface ge-0/0/47 {
            no-root-port;
        }
        interface ge-0/0/48 {
            no-root-port;
        }` : ''}
        bpdu-block-on-edge;
    }
}
`;
  }

  if (vendor === 'nxos') {
    return `!
! ── STP / Rapid-PVST+ ───────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree loopguard default
spanning-tree port type network default
spanning-tree vlan ${vlanList} priority ${priority}
${isCore ? `spanning-tree vlan ${vlanList} root primary` :
  isDist  ? `spanning-tree vlan ${vlanList} root secondary` :
            `spanning-tree port type edge default
spanning-tree port type edge bpduguard default`}
`;
  }

  return '';
}
window._genSTP = _genSTP;

/* ════════════════════════════════════════════════════════════════
   _genFHRP — First Hop Redundancy Protocol
   • IOS-XE campus-dist: HSRPv2 on all campus SVIs.
     Dist-01 (idx=0): ACTIVE, priority 110, preempt, tracks uplink.
     Dist-02 (idx=1): STANDBY, priority 100.
     Sub-second timers (250 ms / 750 ms), MD5 auth.
   • Returns '' for non-applicable vendor/layer combos.
════════════════════════════════════════════════════════════════ */
function _genFHRP(vendor, layer, idx) {
  if (layer !== 'campus-dist') return '';

  const isActive = (idx === 0);
  const prio     = isActive ? 110 : 100;

  function _hsrpIface(group, vip) {
    return `interface Vlan${group}
 standby version 2
 standby ${group} ip ${vip}
 standby ${group} priority ${prio}
${isActive ? ` standby ${group} preempt\n` : ''} standby ${group} authentication md5 key-string HSRP_NetD@2024
 standby ${group} timers msec 250 msec 750
${isActive ? ` standby ${group} track 1 decrement 20\n` : ''}!`;
  }

  if (vendor === 'ios-xe') {
    return `!
! ── FHRP — HSRP v2 (sub-second failover) ───────────────────
! Dist-${idx + 1} role: ${isActive
  ? 'ACTIVE  — priority 110, preempt, tracks TenGig1/1 uplink'
  : 'STANDBY — priority 100 (takes over if Dist-01 uplink fails)'}
! Virtual IPs (.1 / .254) are the default gateways for all hosts
!
track 1 interface TenGigabitEthernet1/1 line-protocol
!
${_hsrpIface(10, '10.0.0.1'  )}
${_hsrpIface(20, '10.10.0.254')}
${_hsrpIface(30, '10.20.0.254')}
${_hsrpIface(40, '10.30.0.254')}
`;
  }

  if (vendor === 'eos') {
    function _vrrpIface(group, vip) {
      return `interface Vlan${group}
   vrrp ${group} ipv4 ${vip}
   vrrp ${group} priority-level ${prio}
${isActive ? `   vrrp ${group} preempt\n` : ''}   vrrp ${group} authentication md5 key-string VRRP_NetD@2024
   vrrp ${group} timers advertise 1
!`;
    }
    return `!
! ── FHRP — VRRP v3 (sub-second failover) ───────────────────
! Dist-${idx + 1} role: ${isActive ? 'MASTER (priority 110)' : 'BACKUP (priority 100)'}
!
${_vrrpIface(10, '10.0.0.1'  )}
${_vrrpIface(20, '10.10.0.254')}
${_vrrpIface(30, '10.20.0.254')}
${_vrrpIface(40, '10.30.0.254')}
`;
  }

  if (vendor === 'nxos') {
    function _hsrpNxIface(group, vip) {
      return `interface Vlan${group}
  hsrp version 2
  hsrp ${group}
    ip ${vip}
    priority ${prio}
${isActive ? `    preempt\n` : ''}    authentication md5 key-string HSRP_NetD@2024
    timers msec 250 msec 750
${isActive ? `    track 1 decrement 20\n` : ''}!`;
    }
    return `!
! ── FHRP — HSRP v2 ──────────────────────────────────────────
! Dist-${idx + 1} role: ${isActive ? 'ACTIVE (priority 110)' : 'STANDBY (priority 100)'}
!
track 1 interface TenGigabitEthernet1/1 line-protocol
!
${_hsrpNxIface(10, '10.0.0.1'  )}
${_hsrpNxIface(20, '10.10.0.254')}
${_hsrpNxIface(30, '10.20.0.254')}
${_hsrpNxIface(40, '10.30.0.254')}
`;
  }

  return '';
}
window._genFHRP = _genFHRP;

/* ════════════════════════════════════════════════════════════════
   _genIGMP — IGMP snooping for campus / DC switches
   • Emitted when STATE.appTypes includes 'voice' or 'video', or
     when overlayProto includes 'VXLAN' (DC fabric needs it too).
   • Distribution/core get the IGMP querier role (they own the L3
     SVIs / default gateways — RFC 4541 §2.1.1).
   • Access/leaf get per-VLAN snooping + immediate-leave.
   • Returns '' for non-campus, non-DC layers.
════════════════════════════════════════════════════════════════ */
function _genIGMP(vendor, layer) {
  const isCampus = ['campus-access','campus-dist','campus-core'].includes(layer);
  const isDCLeaf = layer === 'dc-leaf';
  if (!isCampus && !isDCLeaf) return '';

  const isDist  = layer === 'campus-dist';
  const isAcc   = layer === 'campus-access';
  const isCore  = layer === 'campus-core';
  const hasVoice = (_rs('appTypesVoice',  () => (STATE.appTypes  || []).includes('voice')));
  const hasVideo = (_rs('appTypesVideo',  () => (STATE.appTypes  || []).includes('video')));
  const hasVxlan = (_rs('vxlanEnabled',   () => (STATE.overlayProto || []).some(o=>o.includes('VXLAN'))));

  if (!hasVoice && !hasVideo && !hasVxlan && !isDCLeaf) return '';

  const userVlans = '20,21,30,40,41';
  const dcVlans   = '100,101';
  const vlans     = isDCLeaf ? dcVlans : userVlans;

  if (vendor === 'ios-xe') {
    return `!
! ── IGMP SNOOPING ───────────────────────────────────────────
ip igmp snooping
ip igmp snooping vlan ${vlans}
${(isDist || isCore) ? `ip igmp snooping vlan 20 querier
ip igmp snooping vlan 21 querier
ip igmp snooping vlan 30 querier
ip igmp snooping vlan 40 querier
ip igmp snooping vlan 41 querier` : ''}
${isAcc ? `ip igmp snooping vlan 20,21,30,40,41 immediate-leave` : ''}
ip igmp snooping report-suppression
`;
  }

  if (vendor === 'nxos') {
    return `!
! ── IGMP SNOOPING ───────────────────────────────────────────
ip igmp snooping
ip igmp snooping vlan ${vlans}
${isDCLeaf ? `ip igmp snooping vlan ${dcVlans} querier
ip igmp snooping vlan ${dcVlans} immediate-leave` : ''}
`;
  }

  if (vendor === 'eos') {
    return `!
! ── IGMP SNOOPING ───────────────────────────────────────────
ip igmp snooping
${isDCLeaf ? `vlan 100
   ip igmp snooping querier
   ip igmp snooping immediate-leave
!
vlan 101
   ip igmp snooping querier
   ip igmp snooping immediate-leave
!` : ''}
`;
  }

  if (vendor === 'junos') {
    return `
# ── IGMP Snooping ────────────────────────────────────────────
protocols {
    igmp-snooping {
        vlan all {
            immediate-leave;
            proxy;
        }
    }
}
`;
  }

  if (vendor === 'sonic') {
    return `
# ── IGMP Snooping (/etc/sonic/config_db.json excerpt) ────────
  "CFG_DEVICE_METADATA": {},
  "VLAN_MEMBER|${isDCLeaf ? 'Vlan100' : 'Vlan20'}|Ethernet0": {
      "tagging_mode": "untagged"
  },
`;
  }

  return '';
}
window._genIGMP = _genIGMP;

/* ════════════════════════════════════════════════════════════════
   NTP + SNMP v3 HELPER BLOCKS  (appended to every vendor config)
════════════════════════════════════════════════════════════════ */

/* ── Per-vendor gNMI / Streaming Telemetry device-side config ─────────
   Generates the configuration required to ENABLE gNMI on each device
   so that collectors (gnmic, Telegraf, OpenConfig gNMIc) can subscribe.

   IOS-XE  → gnmi-yang daemon + YANG-Push subscriptions  (port 9339)
   NX-OS   → model-driven telemetry with OpenConfig paths (port 50051)
   EOS     → management gnmi transport grpc               (port 6030)
   JunOS   → extension-service gRPC + netconf             (port 32767)
   SONiC   → sonic-gnmi service config_db.json entry      (port 8080)
──────────────────────────────────────────────────────────────────────── */
function _genGNMI(vendor) {
  if (vendor === 'ios-xe') {
    return `!
! ── gNMI / YANG-Push (IOS-XE 17.x) ───────────────────────
netconf-yang
restconf
gnmi-yang
gnmi-yang port 9339
gnmi-yang secure-server
!
telemetry ietf subscription 101
 encoding encode-kvgpb
 filter xpath /interfaces/interface/state
 stream yang-push
 update-policy periodic 10000
 receiver ip address 10.0.0.210 57500 protocol grpc-tcp profile default
!
telemetry ietf subscription 102
 encoding encode-kvgpb
 filter xpath /interfaces/interface/state/counters
 stream yang-push
 update-policy periodic 10000
 receiver ip address 10.0.0.210 57500 protocol grpc-tcp profile default
!
telemetry ietf subscription 103
 encoding encode-kvgpb
 filter xpath /network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state
 stream yang-push
 update-policy periodic 30000
 receiver ip address 10.0.0.210 57500 protocol grpc-tcp profile default
!
telemetry ietf subscription 104
 encoding encode-kvgpb
 filter xpath /components/component/cpu/utilization/state
 stream yang-push
 update-policy periodic 30000
 receiver ip address 10.0.0.210 57500 protocol grpc-tcp profile default
`;
  }
  if (vendor === 'nxos') {
    return `!
! ── gNMI / Telemetry (NX-OS 9.3+) ────────────────────────
telemetry
  destination-group 1
    ip address 10.0.0.210 port 50051 protocol gRPC encoding GPB
  sensor-group 1
    data-source YANG
    path openconfig-interfaces:interfaces depth unbounded
    path openconfig-network-instance:network-instances depth unbounded
    path openconfig-platform:components depth unbounded
  sensor-group 2
    data-source NX-API
    path sys/intf depth unbounded
    path sys/bgp depth unbounded
  subscription 1
    dst-grp 1
    snsr-grp 1 sample-interval 10000
    snsr-grp 2 sample-interval 30000
`;
  }
  if (vendor === 'eos') {
    return `!
! ── gNMI / OpenConfig (EOS 4.22+) ─────────────────────────
management gnmi
   transport grpc default
      port 6030
      vrf MGMT
!
management api gnmi
   transport grpc default
   no shutdown
`;
  }
  if (vendor === 'junos') {
    return `
## ── gNMI / gRPC (JunOS 21.x+) ─────────────────────────────
## Merge-append this stanza (junos merges on load):
system {
    services {
        extension-service {
            request-response {
                grpc {
                    clear-text {
                        port 32767;
                    }
                    max-connections 30;
                    routing-instance mgmt_junos;
                }
            }
        }
        netconf {
            rfc-compliant;
        }
    }
}
`;
  }
  if (vendor === 'sonic') {
    return `
# ── gNMI (sonic-gnmi 202311+) ──────────────────────────────
# Add to /etc/sonic/config_db.json:
# {
#   "GNMI": {
#     "gnmi": { "port": "8080", "log_level": "2" }
#   }
# }
# Apply:
#   sudo systemctl enable sonic-gnmi
#   sudo systemctl start sonic-gnmi
#   systemctl status sonic-gnmi
`;
  }
  return '';
}

function _genNTP(vendor) {
  if (vendor === 'ios-xe') {
    return `!
! ── NTP ─────────────────────────────────────────────────────
ntp authenticate
ntp authentication-key 1 md5 NetDesignNTP@2024
ntp trusted-key 1
ntp source Vlan10
ntp server 10.0.0.1 prefer key 1
ntp server 10.0.0.2 key 1
clock timezone UTC 0 0
clock calendar-valid
`;
  }
  if (vendor === 'nxos') {
    return `!
! ── NTP ─────────────────────────────────────────────────────
ntp authenticate
ntp authentication-key 1 md5 NetDesignNTP@2024
ntp trusted-key 1
ntp server 10.0.0.1 prefer use-vrf management key 1
ntp server 10.0.0.2 use-vrf management key 1
clock timezone UTC 0 0
`;
  }
  if (vendor === 'eos') {
    return `!
! ── NTP ─────────────────────────────────────────────────────
ntp authenticate
ntp authentication-key 1 md5 NetDesignNTP@2024
ntp trusted-key 1
ntp server 10.0.0.1 prefer key 1
ntp server 10.0.0.2 key 1
`;
  }
  if (vendor === 'junos') {
    return `ntp {
        authentication-key 1 type md5 value "NetDesignNTP@2024";
        trusted-key 1;
        boot-server 10.0.0.1;
        server 10.0.0.1 prefer key 1;
        server 10.0.0.2 key 1;
    }`;
  }
  if (vendor === 'sonic') {
    return `# ── NTP ─────────────────────────────────────────────────────
# /etc/sonic/config_db.json  (NTP section)
{
  "NTP_SERVER": {
    "10.0.0.1": { "resolve_as_hostname": "false" },
    "10.0.0.2": { "resolve_as_hostname": "false" }
  },
  "NTP": { "global": { "src_intf": "eth0", "vrf": "mgmt" } },
  "SYSLOG_SERVER": { "10.0.0.201": {} }
}
`;
  }
  return '';
}

function _genSNMPv3(vendor) {
  if (vendor === 'ios-xe') {
    return `!
! ── SNMP v3 (authPriv) ──────────────────────────────────────
no snmp-server community NetRead
no snmp-server community NetWrite
snmp-server view NETDESIGN-VIEW iso included
snmp-server group NETDESIGN-RO v3 priv read NETDESIGN-VIEW
snmp-server group NETDESIGN-RW v3 priv read NETDESIGN-VIEW write NETDESIGN-VIEW
snmp-server user netmon NETDESIGN-RO v3 auth sha NetDesign@Auth2024 priv aes 128 NetDesign@Priv2024
snmp-server host 10.0.0.200 traps version 3 priv netmon
snmp-server enable traps bgp
snmp-server enable traps envmon
snmp-server enable traps interface
!
logging host 10.0.0.201
logging trap informational
logging source-interface Vlan10
`;
  }
  if (vendor === 'nxos') {
    return `!
! ── SNMP v3 (authPriv) ──────────────────────────────────────
no snmp-server community NetRead
snmp-server user netmon auth sha NetDesign@Auth2024 priv aes-128 NetDesign@Priv2024
snmp-server group NETDESIGN-RO v3 priv
snmp-server host 10.0.0.200 traps version 3 priv netmon use-vrf management
snmp-server enable traps bgp
snmp-server enable traps link
!
logging server 10.0.0.201 6 use-vrf management
`;
  }
  if (vendor === 'eos') {
    return `!
! ── SNMP v3 (authPriv) ──────────────────────────────────────
no snmp-server community NetRead
snmp-server group NETDESIGN-RO v3 priv
snmp-server user netmon NETDESIGN-RO v3 auth sha NetDesign@Auth2024 priv aes128 NetDesign@Priv2024
snmp-server host 10.0.0.200 traps version 3 priv netmon
snmp-server enable traps bgp
!
logging host 10.0.0.201
logging buffered 10000
`;
  }
  if (vendor === 'junos') {
    return `snmp {
    v3 {
        usm {
            local-engine {
                user netmon {
                    authentication-sha {
                        authentication-password "NetDesign@Auth2024";
                    }
                    privacy-aes128 {
                        privacy-password "NetDesign@Priv2024";
                    }
                }
            }
        }
        vacm {
            security-to-group {
                security-model usm {
                    security-name netmon { group NETDESIGN-RO; }
                }
            }
            access {
                group NETDESIGN-RO {
                    default-context-prefix {
                        security-model usm {
                            security-level privacy {
                                read-view NETDESIGN-VIEW;
                            }
                        }
                    }
                }
            }
        }
        target-address NMS {
            address 10.0.0.200;
            tag-list netdesign;
        }
        target-parameters NMS {
            parameters {
                message-processing-model v3;
                security-model usm;
                security-level privacy;
                security-name netmon;
            }
        }
        notify netdesign { tag netdesign; type trap; }
    }
    view NETDESIGN-VIEW { oid .1 include; }
}
`;
  }
  if (vendor === 'sonic') {
    return `# ── SNMP v3 ─────────────────────────────────────────────────
# /etc/snmp/snmpd.conf  (net-snmp v3 authPriv — apply via sudo)
createUser netmon SHA "NetDesign@Auth2024" AES "NetDesign@Priv2024"
group NETDESIGN-RO usm netmon
view NETDESIGN-VIEW included .1 80000000
access NETDESIGN-RO "" usm priv exact NETDESIGN-VIEW none none
rouser netmon priv
trapsess -v 3 -u netmon -l authPriv -a SHA -A "NetDesign@Auth2024" -x AES -X "NetDesign@Priv2024" 10.0.0.200
`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   AAA / TACACS+ HELPER BLOCKS
════════════════════════════════════════════════════════════════ */

function _genAAA(vendor, state) {
  if (vendor === 'ios-xe') {
    return `!
! ── AAA / TACACS+ ───────────────────────────────────────────
aaa new-model
!
tacacs server ISE-TACACS-PRIMARY
 address ipv4 10.0.0.101
 key 7 NetDesign@TACACS2024
 timeout 3
 single-connection
!
tacacs server ISE-TACACS-SECONDARY
 address ipv4 10.0.0.102
 key 7 NetDesign@TACACS2024
 timeout 3
!
aaa group server tacacs+ TACACS-GROUP
 server name ISE-TACACS-PRIMARY
 server name ISE-TACACS-SECONDARY
 ip tacacs source-interface Vlan10
!
aaa authentication login default group TACACS-GROUP local
aaa authentication enable default group TACACS-GROUP enable
aaa authorization console
aaa authorization exec default group TACACS-GROUP local if-authenticated
aaa authorization commands 1 default group TACACS-GROUP local if-authenticated
aaa authorization commands 15 default group TACACS-GROUP local if-authenticated
aaa accounting exec default start-stop group TACACS-GROUP
aaa accounting commands 1 default start-stop group TACACS-GROUP
aaa accounting commands 15 default start-stop group TACACS-GROUP
!
`;
  }
  if (vendor === 'nxos') {
    return `!
! ── AAA / TACACS+ ───────────────────────────────────────────
tacacs-server host 10.0.0.101 key NetDesign@TACACS2024
tacacs-server host 10.0.0.102 key NetDesign@TACACS2024
tacacs-server timeout 3
!
aaa group server tacacs+ TACACS-GROUP
    server 10.0.0.101
    server 10.0.0.102
    source-interface mgmt0
    use-vrf management
!
aaa authentication login default group TACACS-GROUP local
aaa authentication login console group TACACS-GROUP local
aaa authentication enable default group TACACS-GROUP local
aaa authorization commands default group TACACS-GROUP local
aaa accounting default group TACACS-GROUP
!
`;
  }
  if (vendor === 'eos') {
    return `!
! ── AAA / TACACS+ ───────────────────────────────────────────
tacacs-server host 10.0.0.101 key NetDesign@TACACS2024
tacacs-server host 10.0.0.102 key NetDesign@TACACS2024
tacacs-server timeout 3
!
aaa group server tacacs+ TACACS-GROUP
   server 10.0.0.101
   server 10.0.0.102
!
aaa authentication login default group TACACS-GROUP local
aaa authentication enable default group TACACS-GROUP local
aaa authorization exec default group TACACS-GROUP local
aaa authorization commands all default group TACACS-GROUP local
aaa accounting exec default start-stop group TACACS-GROUP
aaa accounting commands all default start-stop group TACACS-GROUP
!
`;
  }
  if (vendor === 'junos') {
    return `## ── AAA / TACACS+ ─────────────────────────────────────────
system {
    tacplus-server {
        10.0.0.101 {
            secret "NetDesign@TACACS2024";
            single-connection;
            timeout 3;
        }
        10.0.0.102 {
            secret "NetDesign@TACACS2024";
            timeout 3;
        }
    }
    authentication-order [ tacplus password ];
    accounting {
        events [ login change-log interactive-commands ];
        destination {
            tacplus;
        }
    }
}
`;
  }
  if (vendor === 'sonic') {
    return `# ── AAA / TACACS+ ─────────────────────────────────────────
# /etc/sonic/config_db.json  (AAA section — merge with base config)
{
  "TACPLUS_SERVER": {
    "10.0.0.101": {
      "priority": "1",
      "tcp_port": "49",
      "passkey": "NetDesign@TACACS2024"
    },
    "10.0.0.102": {
      "priority": "2",
      "tcp_port": "49",
      "passkey": "NetDesign@TACACS2024"
    }
  },
  "AAA": {
    "authentication": { "login": "tacacs+,local", "failthrough": "true" },
    "authorization":  { "login": "tacacs+,local" },
    "accounting":     { "login": "tacacs+" }
  }
}
# Apply: sudo config load /etc/sonic/config_db.json -y
`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   OSPF UNDERLAY HELPER  (DC + campus — area 0, passive-default)
════════════════════════════════════════════════════════════════ */

function _genOSPFUnderlay(vendor, state, dev, layer, idx) {
  const isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  const isTOR   = layer === 'gpu-tor';
  const loIP    = isSpine ? `10.255.1.${idx+1}` : (isTOR ? `10.255.5.${idx+1}` : `10.255.2.${idx+1}`);

  if (vendor === 'nxos') {
    const uplinkIntfs = isSpine
      ? ['Ethernet1/1','Ethernet1/2','Ethernet1/3','Ethernet1/4']
      : ['Ethernet1/49','Ethernet1/50'];
    const noPassive = uplinkIntfs.map(i => `  no passive-interface ${i}`).join('\n');
    const ospfIntfs = uplinkIntfs.map(i =>
      `interface ${i}\n  ip ospf UNDERLAY area 0.0.0.0\n  ip ospf network point-to-point\n  ip ospf authentication message-digest\n  ip ospf message-digest-key 1 md5 OspfUnder@2024\n  ip ospf mtu-ignore\n  no ip ospf passive-interface\n!`
    ).join('\n');
    return `!
! ── OSPF UNDERLAY (area 0 — replaces IS-IS if selected) ────
router ospf UNDERLAY
  router-id ${loIP}
  log-adjacency-changes detail
  passive-interface default
  no passive-interface loopback0
${noPassive}
  area 0.0.0.0 authentication message-digest
!
interface loopback0
  ip ospf UNDERLAY area 0.0.0.0
!
${ospfIntfs}
`;
  }

  if (vendor === 'eos') {
    const noPassive = isSpine
      ? ['Ethernet1/1','Ethernet1/2','Ethernet1/3','Ethernet1/4']
      : ['Ethernet49/1','Ethernet50/1'];
    const noPassiveLines = noPassive.map(i => `   no passive-interface ${i}`).join('\n');
    const ospfIntfs = noPassive.map(i =>
      `interface ${i}\n   ip ospf network point-to-point\n   ip ospf area 0.0.0.0\n!`
    ).join('\n');
    return `!
! ── OSPF UNDERLAY ───────────────────────────────────────────
router ospf 1
   router-id ${loIP}
   bfd all-interfaces
   passive-interface default
${noPassiveLines}
   network 10.1.0.0/16 area 0.0.0.0
   network 10.255.0.0/16 area 0.0.0.0
   max-lsa 12000
   distance ospf intra-area 65
!
interface Loopback0
   ip ospf area 0.0.0.0
!
${ospfIntfs}
`;
  }

  if (vendor === 'junos') {
    return `## ── OSPF UNDERLAY ─────────────────────────────────────────
protocols {
    ospf {
        reference-bandwidth 100g;
        no-rfc-1583;
        export CONNECTED;
        area 0.0.0.0 {
            interface lo0.0 { passive; }
            interface et-0/0/48.0 {
                interface-type p2p;
                authentication { md5 1 key "OspfUnder@2024"; }
            }
            interface et-0/0/49.0 {
                interface-type p2p;
                authentication { md5 1 key "OspfUnder@2024"; }
            }
        }
    }
}
`;
  }

  if (vendor === 'sonic') {
    return `# ── OSPF UNDERLAY (FRRouting) ────────────────────────────
# /etc/frr/frr.conf  (append to existing frr config)
router ospf
  ospf router-id ${loIP}
  passive-interface default
  no passive-interface Ethernet112
  no passive-interface Ethernet116
  network ${loIP}/32 area 0.0.0.0
  network 10.1.1.0/24 area 0.0.0.0
  area 0.0.0.0 authentication message-digest
!
interface Ethernet112
  ip ospf network point-to-point
  ip ospf area 0.0.0.0
  ip ospf authentication message-digest
  ip ospf message-digest-key 1 md5 OspfUnder@2024
!
interface Ethernet116
  ip ospf network point-to-point
  ip ospf area 0.0.0.0
  ip ospf authentication message-digest
  ip ospf message-digest-key 1 md5 OspfUnder@2024
!
# Apply: sudo vtysh -f /etc/frr/frr.conf && sudo systemctl restart frr
`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   IS-IS UNDERLAY HELPER
   Generates IS-IS level-2-only underlay for EOS, JunOS, and SONiC.
   NX-OS IS-IS is inlined directly in genNXOS (legacy).
   Triggered when STATE.underlayProto includes 'IS-IS'.
════════════════════════════════════════════════════════════════ */
function _isisNet(ip) {
  /* Convert dotted-decimal IP to IS-IS NET: 49.0001.AABB.CCDD.EEFF.00 */
  var p = ip.split('.').map(function(n) { return ('000' + n).slice(-3); });
  var s = p.join('');
  return '49.0001.' + s.slice(0,4) + '.' + s.slice(4,8) + '.' + s.slice(8,12) + '.00';
}

function _genISISUnderlay(vendor, layer, idx) {
  var isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  var isTOR   = layer === 'gpu-tor';
  var loIP    = isSpine ? ('10.255.1.' + (idx+1)) : (isTOR ? ('10.255.5.' + (idx+1)) : ('10.255.2.' + (idx+1)));
  var net     = _isisNet(loIP);

  if (vendor === 'eos') {
    var uplinks = isSpine
      ? ['Ethernet1/1', 'Ethernet1/2', 'Ethernet1/3', 'Ethernet1/4']
      : ['Ethernet49/1', 'Ethernet50/1'];
    var uplinkCfg = uplinks.map(function(i) {
      return 'interface ' + i + '\n   isis enable UNDERLAY\n   isis network point-to-point\n   isis circuit-type level-2\n!';
    }).join('\n');
    return `!
! ── IS-IS UNDERLAY ─────────────────────────────────────────
router isis UNDERLAY
   net ${net}
   is-type level-2-only
   log-adjacency-changes
   !
   address-family ipv4 unicast
      fast-reroute ti-lfa mode link-protection
      maximum-paths 4
!
interface Loopback0
   isis enable UNDERLAY
   isis passive
!
${uplinkCfg}
`;
  }

  if (vendor === 'junos') {
    var uplinks_j = isSpine
      ? ['et-0/0/48', 'et-0/0/49', 'et-0/0/50', 'et-0/0/51']
      : ['et-0/0/48', 'et-0/0/49'];
    var intfBlocks = uplinks_j.map(function(i) {
      return `        interface ${i}.0 {
            point-to-point;
            level 2 hello-authentication-type md5;
            level 2 hello-authentication-key "IsisUnder@2024";
        }`;
    }).join('\n');
    return `## ── IS-IS UNDERLAY ────────────────────────────────────────
interfaces {
    lo0 {
        unit 0 {
            family iso {
                address ${net};
            }
        }
    }
}
protocols {
    isis {
        level 1 disable;
${intfBlocks}
        interface lo0.0 { passive; }
        interface fxp0.0 { disable; }
    }
}
`;
  }

  if (vendor === 'sonic') {
    return `# ── IS-IS UNDERLAY (FRRouting) ─────────────────────────────
# /etc/frr/frr.conf  (append to existing frr config)
router isis UNDERLAY
  net ${net}
  is-type level-2-only
  metric-style wide
  log-adjacency-changes
!
interface Ethernet112
  ip router isis UNDERLAY
  isis circuit-type level-2-only
  isis network point-to-point
  isis metric 10
!
interface Ethernet116
  ip router isis UNDERLAY
  isis circuit-type level-2-only
  isis network point-to-point
  isis metric 10
!
interface Loopback0
  ip router isis UNDERLAY
  isis passive
!
# Apply: sudo vtysh -f /etc/frr/frr.conf && sudo systemctl restart frr
`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   MLAG PEER-LINK HELPER (Arista EOS DC leaf only)
   Generates MLAG domain, peer-link port-channel, and example
   dual-homed server ports.  Always generated for dc-leaf so that
   servers can bond across a leaf pair — matches how NX-OS generates
   vPC for every leaf.
════════════════════════════════════════════════════════════════ */
function _genMLAG(layer, idx) {
  if (layer !== 'dc-leaf') return '';
  var pairIdx    = Math.floor(idx / 2);
  var pairMember = idx % 2;                  /* 0 = primary, 1 = secondary */
  var myIP       = '10.254.' + pairIdx + '.' + (pairMember === 0 ? 1 : 2);
  var peerIP     = '10.254.' + pairIdx + '.' + (pairMember === 0 ? 2 : 1);
  var svr1       = idx * 8 + 1;
  var svr2       = idx * 8 + 2;
  return `!
! ── MLAG PEER-LINK ──────────────────────────────────────────
vlan 4094
   name MLAG-IBGP-PEERING
   trunk group MLAG-PEER-LINK
!
interface Ethernet51/1
   description MLAG-PEER-LINK-1
   channel-group 1000 mode active
   no shutdown
!
interface Ethernet52/1
   description MLAG-PEER-LINK-2
   channel-group 1000 mode active
   no shutdown
!
interface Port-Channel1000
   description MLAG-PEER-LINK
   switchport mode trunk
   switchport trunk group MLAG-PEER-LINK
!
interface Vlan4094
   description MLAG-IBGP-PEERING
   ip address ${myIP}/30
   no autostate
!
mlag configuration
   domain-id DC-MLAG-PAIR-${pairIdx + 1}
   local-interface Vlan4094
   peer-address ${peerIP}
   peer-link Port-Channel1000
   reload-delay mlag 300
   reload-delay non-mlag 330
!
! ── MLAG SERVER PORTS (dual-homed server examples) ──────────
interface Ethernet1
   description DUAL-HOMED-SVR-${svr1}-Bond0
   channel-group 1 mode active
   mlag 1
   no shutdown
!
interface Ethernet2
   description DUAL-HOMED-SVR-${svr2}-Bond0
   channel-group 2 mode active
   mlag 2
   no shutdown
!
`;
}

/* ════════════════════════════════════════════════════════════════
   QoS POLICY HELPER BLOCKS
   DSCP 46/EF = Voice (priority queue 15 %), DSCP 34/AF41 = Video,
   DSCP 26/AF31 = Critical Data, default = Best-Effort
════════════════════════════════════════════════════════════════ */
function _genQoS(vendor, state) {
  if (vendor === 'ios-xe') {
    return `!
! ── QoS Policy ──────────────────────────────────────────────
class-map match-any VOICE
 match dscp ef
class-map match-any VIDEO
 match dscp af41
class-map match-any CRITICAL-DATA
 match dscp af31
!
policy-map MARK-INGRESS
 class VOICE
  set dscp ef
 class VIDEO
  set dscp af41
 class CRITICAL-DATA
  set dscp af31
 class class-default
  set dscp default
!
policy-map QUEUING-POLICY
 class VOICE
  priority percent 15
 class VIDEO
  bandwidth percent 20
 class CRITICAL-DATA
  bandwidth percent 25
 class class-default
  fair-queue
!
interface range GigabitEthernet1/0/1 - 48
 service-policy input MARK-INGRESS
 service-policy output QUEUING-POLICY
!
`;
  }
  if (vendor === 'nxos') {
    return `!
! ── QoS Policy ──────────────────────────────────────────────
class-map type qos match-any VOICE
  match dscp ef
class-map type qos match-any VIDEO
  match dscp af41
class-map type qos match-any CRITICAL-DATA
  match dscp af31
!
policy-map type qos CLASSIFY
  class VOICE
    set qos-group 5
  class VIDEO
    set qos-group 4
  class CRITICAL-DATA
    set qos-group 3
  class class-default
    set qos-group 0
!
class-map type queuing VOICE-Q
  match qos-group 5
class-map type queuing VIDEO-Q
  match qos-group 4
class-map type queuing DATA-Q
  match qos-group 3
!
policy-map type queuing QUEUING-POLICY
  class type queuing VOICE-Q
    priority
    bandwidth percent 15
  class type queuing VIDEO-Q
    bandwidth percent 20
  class type queuing DATA-Q
    bandwidth percent 25
  class type queuing class-default
    bandwidth percent 40
!
system qos
  service-policy type qos input CLASSIFY
  service-policy type queuing output QUEUING-POLICY
!
`;
  }
  if (vendor === 'eos') {
    return `!
! ── QoS Policy ──────────────────────────────────────────────
class-map type traffic match-any VOICE
   match dscp ef
class-map type traffic match-any VIDEO
   match dscp af41
class-map type traffic match-any CRITICAL-DATA
   match dscp af31
!
policy-map type quality-of-service QUEUING-POLICY
   class VOICE
      priority
      shape rate 15 percent
   class VIDEO
      bandwidth percent 20
   class CRITICAL-DATA
      bandwidth percent 25
   class default
      fair-queue
!
qos rewrite dscp
qos map dscp to traffic-class 46 to 6
qos map dscp to traffic-class 34 to 4
qos map dscp to traffic-class 26 to 3
!
interface Ethernet1-48
   service-policy type qos input QUEUING-POLICY
!
`;
  }
  if (vendor === 'junos') {
    return `## ── QoS (Class of Service) ────────────────────────────────
class-of-service {
    forwarding-classes {
        queue 5 voice;
        queue 4 video;
        queue 3 critical-data;
        queue 0 best-effort;
    }
    classifiers {
        dscp NETDESIGN-DSCP-CLASSIFIER {
            import default;
            forwarding-class voice {
                loss-priority low code-points [ ef ];
            }
            forwarding-class video {
                loss-priority low code-points [ af41 ];
            }
            forwarding-class critical-data {
                loss-priority low code-points [ af31 ];
            }
        }
    }
    schedulers {
        VOICE-SCHED {
            transmit-rate percent 15;
            buffer-size percent 5;
            priority strict-high;
        }
        VIDEO-SCHED {
            transmit-rate percent 20;
            buffer-size percent 10;
            priority low;
        }
        DATA-SCHED {
            transmit-rate percent 25;
            buffer-size percent 15;
        }
        BE-SCHED {
            transmit-rate remainder;
            buffer-size remainder;
        }
    }
    scheduler-maps {
        NETDESIGN-SCHED-MAP {
            forwarding-class voice scheduler VOICE-SCHED;
            forwarding-class video scheduler VIDEO-SCHED;
            forwarding-class critical-data scheduler DATA-SCHED;
            forwarding-class best-effort scheduler BE-SCHED;
        }
    }
    interfaces {
        <*> {
            scheduler-map NETDESIGN-SCHED-MAP;
            unit 0 {
                classifiers {
                    dscp NETDESIGN-DSCP-CLASSIFIER;
                }
            }
        }
    }
}
`;
  }
  if (vendor === 'sonic') {
    return `# ── QoS DSCP Classification ──────────────────────────────
# /etc/sonic/qos.json  (DSCP-to-TC mapping — merge with base)
{
  "DSCP_TO_TC_MAP": {
    "NETDESIGN_DSCP_MAP": {
      "46": "5",
      "34": "4",
      "26": "3",
      "0":  "0"
    }
  },
  "TC_TO_QUEUE_MAP": {
    "NETDESIGN_TC_Q": {
      "5": "5",
      "4": "4",
      "3": "3",
      "0": "0"
    }
  },
  "SCHEDULER": {
    "VOICE_SCHED":  { "type": "STRICT",   "weight": "15" },
    "VIDEO_SCHED":  { "type": "WRR",      "weight": "20" },
    "DATA_SCHED":   { "type": "WRR",      "weight": "25" },
    "BE_SCHED":     { "type": "WRR",      "weight": "40" }
  },
  "QUEUE": {
    "Ethernet0|5": { "scheduler": "VOICE_SCHED" },
    "Ethernet0|4": { "scheduler": "VIDEO_SCHED" },
    "Ethernet0|3": { "scheduler": "DATA_SCHED"  },
    "Ethernet0|0": { "scheduler": "BE_SCHED"    }
  }
}
# Apply: sudo config qos reload && sudo config save -y
`;
  }
  return '';
}

/* ════════════════════════════════════════════════════════════════
   WAN ROUTER HELPERS
   Dedicated configs for HQ Core Router (DMVPN hub) and Branch CPE
   (DMVPN spoke).  Called from genIOSXE / genJunos when dev.role
   matches 'HQ Core Router' or 'Branch CPE'.
════════════════════════════════════════════════════════════════ */

function _genWANRouterIOSXE(dev, isHub, idx) {
  const name   = dev.name;
  const loIP   = isHub ? `10.255.0.${idx+1}` : `10.255.0.${10+idx}`;
  const tunnIP = isHub ? '172.16.0.1' : `172.16.0.${10+idx}`;
  const lanIP  = isHub ? `10.0.${idx}.1` : `192.168.${idx+1}.1`;
  const lanMask = '255.255.255.0';
  const branchLan = `192.168.${idx+1}.0 0.0.0.255`;
  const date   = new Date().toISOString().slice(0,10);

  let cfg = `! ═══════════════════════════════════════════════════════════
! Device : ${name}
! Role   : ${dev.role}
! OS     : Cisco IOS-XE (ASR 1001-X / ISR 4351)
! Generated by NetDesign AI — ${date}
! ═══════════════════════════════════════════════════════════
!
! ── MANAGEMENT ─────────────────────────────────────────────
hostname ${name}
!
ip domain-name netdesign.local
ip name-server 8.8.8.8
service timestamps log datetime msec localtime show-timezone
service timestamps debug datetime msec
service password-encryption
no service pad
!
username admin privilege 15 algorithm-type sha256 secret NetDesign@2024
enable algorithm-type sha256 secret NetDesign@2024
!
interface GigabitEthernet0
 description OOB-MANAGEMENT
 ip address 10.0.0.${30+idx} 255.255.255.0
 no shutdown
!
ip default-gateway 10.0.0.1
!
! ── WAN INTERFACES ─────────────────────────────────────────
`;

  if (isHub) {
    cfg += `interface GigabitEthernet0/0/0
 description WAN-ISP1-PRIMARY
 ip address dhcp
 ip nat outside
 ip verify unicast source reachable-via rx
 no shutdown
!
interface GigabitEthernet0/0/1
 description WAN-ISP2-BACKUP
 ip address dhcp
 ip nat outside
 ip verify unicast source reachable-via rx
 no shutdown
!
interface GigabitEthernet0/1
 description LAN-TO-CAMPUS-DISTRIBUTION
 ip address ${lanIP} ${lanMask}
 ip nat inside
 no shutdown
!
interface Loopback0
 description ROUTER-ID-DMVPN-SOURCE
 ip address ${loIP} 255.255.255.255
!
! ── DMVPN HUB ──────────────────────────────────────────────
crypto ikev2 keyring DMVPN-KEYRING
 peer ANY
  address 0.0.0.0 0.0.0.0
  pre-shared-key NetDesign@DMVPN2024
!
crypto ikev2 proposal DMVPN-PROPOSAL
 encryption aes-cbc-256
 integrity sha256
 group 19
!
crypto ikev2 policy DMVPN-POLICY
 proposal DMVPN-PROPOSAL
!
crypto ikev2 profile DMVPN-PROFILE
 match identity remote address 0.0.0.0
 authentication remote pre-share
 authentication local pre-share
 keyring local DMVPN-KEYRING
!
crypto ipsec transform-set DMVPN-TS esp-aes 256 esp-sha256-hmac
 mode transport
!
crypto ipsec profile DMVPN-IPSEC
 set transform-set DMVPN-TS
 set ikev2-profile DMVPN-PROFILE
!
interface Tunnel0
 description DMVPN-HUB — Phase 3
 ip address ${tunnIP} 255.255.255.0
 no ip redirects
 ip nhrp authentication NetDesign2024
 ip nhrp map multicast dynamic
 ip nhrp network-id 1000
 ip nhrp holdtime 300
 ip nhrp redirect
 ip ospf network broadcast
 ip ospf priority 10
 tunnel source Loopback0
 tunnel mode gre multipoint
 tunnel key 100
 tunnel protection ipsec profile DMVPN-IPSEC
!
! ── ROUTING ────────────────────────────────────────────────
router ospf 1
 router-id ${loIP}
 passive-interface default
 no passive-interface Tunnel0
 no passive-interface GigabitEthernet0/1
 network ${lanIP} 0.0.0.255 area 0
 network 172.16.0.0 0.0.0.255 area 0
 network ${loIP} 0.0.0.0 area 0
 area 0 authentication message-digest
 default-information originate always
!
! ── BGP TOWARD ISP ─────────────────────────────────────────
! Replace <ISP1_PEER> and <ISP1_ASN> with real values
router bgp 65001
 bgp router-id ${loIP}
 bgp log-neighbor-changes
 neighbor <ISP1_PEER> remote-as <ISP1_ASN>
  description ISP1-BGP-PEER
  ebgp-multihop 2
  update-source GigabitEthernet0/0/0
  soft-reconfiguration inbound
  prefix-list DENY-RFC1918-OUT out
 neighbor <ISP2_PEER> remote-as <ISP2_ASN>
  description ISP2-BGP-PEER
  ebgp-multihop 2
  update-source GigabitEthernet0/0/1
  soft-reconfiguration inbound
  prefix-list DENY-RFC1918-OUT out
!
ip prefix-list DENY-RFC1918-OUT seq 5 deny 10.0.0.0/8 le 32
ip prefix-list DENY-RFC1918-OUT seq 10 deny 172.16.0.0/12 le 32
ip prefix-list DENY-RFC1918-OUT seq 15 deny 192.168.0.0/16 le 32
ip prefix-list DENY-RFC1918-OUT seq 100 permit 0.0.0.0/0 le 32
!
! ── IP SLA — Dual-ISP Failover ─────────────────────────────
ip sla 1
 icmp-echo 8.8.8.8 source-interface GigabitEthernet0/0/0
 frequency 10
ip sla schedule 1 life forever start-time now
!
ip sla 2
 icmp-echo 8.8.4.4 source-interface GigabitEthernet0/0/1
 frequency 10
ip sla schedule 2 life forever start-time now
!
track 1 ip sla 1 reachability
track 2 ip sla 2 reachability
!
ip route 0.0.0.0 0.0.0.0 GigabitEthernet0/0/0 dhcp track 1
ip route 0.0.0.0 0.0.0.0 GigabitEthernet0/0/1 dhcp 10 track 2
!
! ── NAT ────────────────────────────────────────────────────
ip nat inside source list NAT-INSIDE interface GigabitEthernet0/0/0 overload
ip access-list standard NAT-INSIDE
 permit 10.0.0.0 0.255.255.255
 permit 192.168.0.0 0.0.255.255
!
`;
  } else {
    /* Branch CPE — DMVPN spoke */
    cfg += `interface GigabitEthernet0/0/0
 description WAN-TO-ISP
 ip address dhcp
 ip nat outside
 no shutdown
!
interface GigabitEthernet0/1
 description LAN-USERS
 ip address ${lanIP} ${lanMask}
 ip nat inside
 no shutdown
!
interface GigabitEthernet0/2
 description LAN-VOICE
 ip address 192.168.${idx+100}.1 ${lanMask}
 ip nat inside
 no shutdown
!
interface Loopback0
 description ROUTER-ID
 ip address ${loIP} 255.255.255.255
!
! ── DMVPN SPOKE ────────────────────────────────────────────
! Replace <HQ_HUB_NBMA_IP> with the HQ router's public IP
crypto ikev2 keyring DMVPN-KEYRING
 peer HQ-HUB
  address <HQ_HUB_NBMA_IP>
  pre-shared-key NetDesign@DMVPN2024
!
crypto ikev2 proposal DMVPN-PROPOSAL
 encryption aes-cbc-256
 integrity sha256
 group 19
!
crypto ikev2 policy DMVPN-POLICY
 proposal DMVPN-PROPOSAL
!
crypto ikev2 profile DMVPN-PROFILE
 match identity remote address <HQ_HUB_NBMA_IP>
 authentication remote pre-share
 authentication local pre-share
 keyring local DMVPN-KEYRING
!
crypto ipsec transform-set DMVPN-TS esp-aes 256 esp-sha256-hmac
 mode transport
!
crypto ipsec profile DMVPN-IPSEC
 set transform-set DMVPN-TS
 set ikev2-profile DMVPN-PROFILE
!
interface Tunnel0
 description DMVPN-SPOKE-TO-HQ
 ip address ${tunnIP} 255.255.255.0
 no ip redirects
 ip nhrp authentication NetDesign2024
 ip nhrp map multicast <HQ_HUB_NBMA_IP>
 ip nhrp map 172.16.0.1 <HQ_HUB_NBMA_IP>
 ip nhrp nhs 172.16.0.1
 ip nhrp network-id 1000
 ip nhrp holdtime 300
 ip nhrp shortcut
 ip ospf network broadcast
 ip ospf priority 0
 tunnel source GigabitEthernet0/0/0
 tunnel mode gre multipoint
 tunnel key 100
 tunnel protection ipsec profile DMVPN-IPSEC
!
! ── ROUTING ────────────────────────────────────────────────
router ospf 1
 router-id ${loIP}
 passive-interface default
 no passive-interface Tunnel0
 network ${lanIP} 0.0.0.255 area 0
 network 192.168.${idx+100}.0 0.0.0.255 area 0
 network 172.16.0.0 0.0.0.255 area 0
 network ${loIP} 0.0.0.0 area 0
 area 0 authentication message-digest
!
ip route 0.0.0.0 0.0.0.0 GigabitEthernet0/0/0 dhcp
!
! ── NAT ────────────────────────────────────────────────────
ip nat inside source list NAT-INSIDE interface GigabitEthernet0/0/0 overload
ip access-list standard NAT-INSIDE
 permit ${lanIP} 0.0.0.255
 permit 192.168.${idx+100}.0 0.0.0.255
!
! ── SECURITY ───────────────────────────────────────────────
ip inspect name WAN-FW tcp
ip inspect name WAN-FW udp
ip inspect name WAN-FW icmp
!
interface GigabitEthernet0/0/0
 ip access-group WAN-IN in
 ip inspect WAN-FW out
!
ip access-list extended WAN-IN
 permit esp any any
 permit udp any any eq isakmp
 permit udp any any eq non500-isakmp
 permit icmp any any echo-reply
 permit icmp any any unreachable
 deny   ip any any log
!
`;
  }

  /* Common WAN footer (NTP, SNMP, AAA, SSH) */
  cfg += _genNTP('ios-xe');
  cfg += _genSNMPv3('ios-xe');
  cfg += _genAAA('ios-xe', STATE);
  cfg += _genGNMI('ios-xe');
  cfg += `!
! ── SSH ─────────────────────────────────────────────────────
crypto key generate rsa modulus 2048
ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
!
line con 0
 logging synchronous
 exec-timeout 15 0
!
line vty 0 15
 transport input ssh
 login authentication default
 exec-timeout 10 0
 logging synchronous
!
end
`;
  return cfg;
}

function _genWANRouterJunOS(dev, isHub, idx) {
  const name   = dev.name.toLowerCase().replace(/-/g, '_');
  const loIP   = isHub ? `10.255.0.${idx+1}` : `10.255.0.${10+idx}`;
  const tunnIP = isHub ? '172.16.0.1/24' : `172.16.0.${10+idx}/24`;
  const lanIP  = isHub ? `10.0.${idx}.1/24` : `192.168.${idx+1}.1/24`;
  const date   = new Date().toISOString().slice(0,10);

  let cfg = `## ═══════════════════════════════════════════════════════════
## Device : ${dev.name}  Role: ${dev.role}
## OS     : Juniper Junos 23.x (MX204 / SRX4200)
## Generated by NetDesign AI — ${date}
## ═══════════════════════════════════════════════════════════
system {
    host-name ${name};
    domain-name netdesign.local;
    time-zone UTC;
    authentication-order [ password ];
    root-authentication {
        encrypted-password "$6$NetDesign2024";
    }
    login {
        user admin {
            class super-user;
            authentication { encrypted-password "$6$NetDesign2024"; }
        }
    }
    services {
        ssh { root-login deny; protocol-version v2; }
        netconf { ssh; }
    }
    syslog {
        host 10.0.0.201 { any info; }
        file messages { any notice; authorization info; }
    }
    ${_genNTP('junos')}
}
${_genSNMPv3('junos')}
interfaces {
    lo0 {
        unit 0 {
            description "ROUTER-ID";
            family inet { address ${loIP}/32; }
        }
    }
`;

  if (isHub) {
    cfg += `    ge-0/0/0 {
        unit 0 {
            description "WAN-ISP1-PRIMARY";
            family inet { dhcp; }
        }
    }
    ge-0/0/1 {
        unit 0 {
            description "WAN-ISP2-BACKUP";
            family inet { dhcp; }
        }
    }
    ge-0/0/2 {
        unit 0 {
            description "LAN-TO-CAMPUS";
            family inet { address ${lanIP}; }
        }
    }
    gr-0/0/0 {
        unit 0 {
            description "GRE-TUNNEL-TO-BRANCHES";
            tunnel {
                source ${loIP};
                destination 0.0.0.0;
            }
            family inet { address ${tunnIP}; }
        }
    }
}
routing-options {
    router-id ${loIP};
    autonomous-system 65001;
    static {
        route 0.0.0.0/0 { next-hop [ ge-0/0/0.0 ge-0/0/1.0 ]; }
    }
}
protocols {
    ospf {
        reference-bandwidth 100g;
        export CONNECTED;
        area 0.0.0.0 {
            interface lo0.0 { passive; }
            interface ge-0/0/2.0 { interface-type p2p; }
            interface gr-0/0/0.0 { interface-type p2p; }
        }
    }
    bgp {
        group ISP1 {
            type external;
            peer-as <ISP1_ASN>;
            neighbor <ISP1_PEER> {
                description "ISP1-BGP-PEER";
                export DENY-RFC1918-OUT;
            }
        }
    }
    lldp { interface all; }
}
policy-options {
    policy-statement CONNECTED {
        term direct { from protocol direct; then accept; }
    }
    policy-statement DENY-RFC1918-OUT {
        term block-rfc1918 {
            from { route-filter 10.0.0.0/8 orlonger; }
            then reject;
        }
        term block-rfc1918-b {
            from { route-filter 172.16.0.0/12 orlonger; }
            then reject;
        }
        term block-rfc1918-c {
            from { route-filter 192.168.0.0/16 orlonger; }
            then reject;
        }
        term permit-all { then accept; }
    }
}
security {
    nat {
        source {
            rule-set INSIDE-TO-WAN {
                from zone trust;
                to   zone untrust;
                rule NAT-OVERLOAD {
                    match { source-address 10.0.0.0/8; }
                    then { source-nat { interface; } }
                }
            }
        }
    }
}
`;
  } else {
    cfg += `    ge-0/0/0 {
        unit 0 {
            description "WAN-TO-ISP";
            family inet { dhcp; }
        }
    }
    ge-0/0/1 {
        unit 0 {
            description "LAN-USERS";
            family inet { address ${lanIP}; }
        }
    }
    ge-0/0/2 {
        unit 0 {
            description "LAN-VOICE";
            family inet { address 192.168.${idx+100}.1/24; }
        }
    }
    gr-0/0/0 {
        unit 0 {
            description "GRE-TUNNEL-TO-HQ";
            tunnel {
                source ge-0/0/0.0;
                destination <HQ_HUB_NBMA_IP>;
            }
            family inet { address ${tunnIP}; }
        }
    }
}
routing-options {
    router-id ${loIP};
    autonomous-system ${65010 + idx};
    static {
        route 0.0.0.0/0 next-hop ge-0/0/0.0;
    }
}
protocols {
    ospf {
        reference-bandwidth 100g;
        area 0.0.0.0 {
            interface lo0.0 { passive; }
            interface ge-0/0/1.0 { passive; }
            interface ge-0/0/2.0 { passive; }
            interface gr-0/0/0.0 { interface-type p2p; }
        }
    }
    lldp { interface all; }
}
security {
    nat {
        source {
            rule-set BRANCH-NAT {
                from zone trust;
                to   zone untrust;
                rule LAN-OVERLOAD {
                    match { source-address 192.168.0.0/16; }
                    then { source-nat { interface; } }
                }
            }
        }
    }
    policies {
        from-zone trust to-zone untrust {
            policy PERMIT-OUTBOUND {
                match { source-address any; destination-address any; application any; }
                then  { permit; }
            }
        }
        from-zone untrust to-zone trust {
            policy DENY-INBOUND {
                match { source-address any; destination-address any; application any; }
                then  { deny; log { session-close; } }
            }
        }
    }
}
`;
  }

  cfg += _genAAA('junos', STATE);
  cfg += _genGNMI('junos');
  return cfg;
}

/* ════════════════════════════════════════════════════════════════
   IPv6 DUAL-STACK HELPER
   Appended to each vendor config when STATE.protoFeatures includes
   'IPv6 Dual-Stack'.  Adds ULA loopback addresses, P2P IPv6,
   OSPFv3 / BGP IPv6 address-family per vendor.
════════════════════════════════════════════════════════════════ */
function _genIPv6Underlay(vendor, layer, idx) {
  const isCampus = ['campus-access','campus-dist','campus-core'].includes(layer);
  const isSpine  = layer === 'dc-spine' || layer === 'gpu-spine';
  const isTOR    = layer === 'gpu-tor';
  const loOctet  = idx + 1;

  if (vendor === 'ios-xe' && isCampus) {
    const isAcc  = layer === 'campus-access';
    const isDist = layer === 'campus-dist';
    const isCore = layer === 'campus-core';
    return `!
! ── IPv6 DUAL-STACK ────────────────────────────────────────
ipv6 unicast-routing
ipv6 cef
!
${(isCore || isDist) ? `interface Loopback0
 ipv6 address FD00:0:0:${loOctet}::1/128
 ipv6 ospf 1 area 0
!` : ''}
${isDist ? `interface TenGigabitEthernet1/1
 ipv6 address 2001:DB8:100:${idx*2}::1/127
 ipv6 ospf 1 area 0
 ipv6 ospf network point-to-point
!
interface TenGigabitEthernet1/2
 ipv6 address 2001:DB8:100:${idx*2+1}::1/127
 ipv6 ospf 1 area 0
 ipv6 ospf network point-to-point
!
interface Vlan20
 ipv6 address 2001:DB8:10:${idx}::1/48
 ipv6 nd ra-interval 30
 ipv6 nd ra-lifetime 120
!
interface Vlan30
 ipv6 address 2001:DB8:20:${idx}::1/48
 ipv6 nd suppress-ra
!
ipv6 router ospf 1
 router-id 10.255.0.${20+idx}
 passive-interface default
 no passive-interface TenGigabitEthernet1/1
 no passive-interface TenGigabitEthernet1/2
 area 0 authentication ipsec spi 256 md5 0102030405060708090A0B0C0D0E0F10
!` : ''}
${isCore ? `interface TenGigabitEthernet2/1
 ipv6 address 2001:DB8:100:${idx*4}::1/127
 ipv6 ospf 1 area 0
 ipv6 ospf network point-to-point
!
ipv6 router ospf 1
 router-id 10.255.0.${20+idx}
 passive-interface default
 no passive-interface TenGigabitEthernet2/1
 no passive-interface TenGigabitEthernet2/2
 no passive-interface TenGigabitEthernet2/3
 no passive-interface TenGigabitEthernet2/4
!` : ''}
${isAcc ? `interface Vlan20
 ipv6 nd ra-interval 30
 ipv6 nd prefix 2001:DB8:10:${idx}::/48
!` : ''}
`;
  }

  if (vendor === 'nxos') {
    const asn    = isSpine ? 65000 : 65001 + idx;
    const pfx    = isSpine ? `2001:DB8:1:${idx*8}` : `2001:DB8:1:${idx*2+1}`;
    const uplinkIntf = isSpine ? 'Ethernet1/1' : 'Ethernet1/49';
    const loIPv4 = isSpine ? `10.255.1.${idx+1}` : `10.255.2.${idx+1}`;
    return `!
! ── IPv6 DUAL-STACK ────────────────────────────────────────
feature ipv6
!
interface loopback0
  ipv6 address FD00:0:0:${loOctet}::1/128
  ipv6 router ospf UNDERLAY-V6 area 0.0.0.0
!
interface ${uplinkIntf}
  ipv6 address ${pfx}::1/127
  ipv6 router ospf UNDERLAY-V6 area 0.0.0.0
  ipv6 ospf network point-to-point
!
ipv6 router ospf UNDERLAY-V6
  router-id ${loIPv4}
  passive-interface default
  no passive-interface loopback0
  no passive-interface ${uplinkIntf}
!
router bgp ${asn}
  address-family ipv6 unicast
    maximum-paths 4
    maximum-paths ibgp 4
    network FD00:0:0:${loOctet}::1/128
!
`;
  }

  if (vendor === 'eos') {
    const asn  = isSpine ? 65000 : 65001 + idx;
    const loIP = isSpine ? `10.255.1.${idx+1}` : `10.255.2.${idx+1}`;
    return `!
! ── IPv6 DUAL-STACK ────────────────────────────────────────
interface Loopback0
   ipv6 address FD00:0:0:${loOctet}::1/128
!
interface Ethernet49/1
   ipv6 address 2001:DB8:1:${isSpine ? idx*8 : idx*2+1}::${isSpine ? 0 : 1}/127
!
router ospf 1
   address-family ipv6
      area 0.0.0.0
         network Loopback0/128
      bfd all-interfaces
!
router bgp ${asn}
   address-family ipv6
      ${isSpine ? 'neighbor LEAVES activate' : 'neighbor SPINES activate'}
      network FD00:0:0:${loOctet}::1/128
      maximum-paths 4
!
`;
  }

  if (vendor === 'junos') {
    return `## ── IPv6 DUAL-STACK ────────────────────────────────────
interfaces {
    lo0 {
        unit 0 {
            family inet6 { address fd00:0:0:${loOctet}::1/128; }
        }
    }
    et-0/0/48 {
        unit 0 {
            family inet6 { address 2001:db8:1:${idx*2}::1/127; }
        }
    }
    et-0/0/49 {
        unit 0 {
            family inet6 { address 2001:db8:1:${idx*2+8}::1/127; }
        }
    }
}
protocols {
    ospf3 {
        reference-bandwidth 100g;
        area 0.0.0.0 {
            interface lo0.0     { passive; }
            interface et-0/0/48.0 { interface-type p2p; }
            interface et-0/0/49.0 { interface-type p2p; }
        }
    }
    bgp {
        group SPINES-V6 {
            type external;
            peer-as 65000;
            family inet6 { unicast; }
            neighbor 2001:db8:1:${idx*2}::;
            neighbor 2001:db8:1:${idx*2+8}::;
        }
    }
}
`;
  }

  if (vendor === 'sonic') {
    return `# ── IPv6 DUAL-STACK ────────────────────────────────────
# /etc/sonic/config_db.json  (IPv6 — merge with base config)
{
  "LOOPBACK_INTERFACE": {
    "Loopback0|fd00:0:0:${loOctet}::1/128": {}
  },
  "INTERFACE": {
    "Ethernet112|2001:db8:1:${idx*4}::1/127": { "scope": "global", "family": "IPv6" },
    "Ethernet116|2001:db8:1:${idx*4+2}::1/127": { "scope": "global", "family": "IPv6" }
  }
}
# FRRouting OSPFv3 — /etc/frr/frr.conf (append):
# ipv6 router ospf6
#   ospf6 router-id 10.255.5.${loOctet}
#   area 0.0.0.0 range fd00::/8
# interface Ethernet112
#   ipv6 ospf6 area 0.0.0.0
# interface Ethernet116
#   ipv6 ospf6 area 0.0.0.0
# Apply: sudo vtysh -f /etc/frr/frr.conf && sudo systemctl restart frr
`;
  }

  return '';
}

/* ════════════════════════════════════════════════════════════════
   CONFIG GENERATION TEMPLATES
════════════════════════════════════════════════════════════════ */
function generateConfig(dev, os) {
  const layer = dev.layer;
  const idx   = dev.idx || 0;
  let base = '';

  // Multicloud devices — delegate to multicloud.js
  if (['mc-dc-edge','mc-aws','mc-azure','mc-gcp','mc-ansible',
       'mc-cicd','mc-tf-outputs','mc-tf-bootstrap','mc-repo','mc-aviatrix'].includes(layer)) {
    if (typeof window.genMulticloudConfig === 'function') {
      return window.genMulticloudConfig(dev, STATE);
    }
    return '# multicloud.js not loaded';
  }

  if (os === 'ios-xe') base = genIOSXE(dev, layer, idx);
  else if (os === 'nxos')   base = genNXOS(dev, layer, idx);
  else if (os === 'eos')    base = genEOS(dev, layer, idx);
  else if (os === 'junos')  base = genJunos(dev, layer, idx);
  else if (os === 'sonic')  base = genSONiC(dev, layer, idx);
  else base = genIOSXE(dev, layer, idx);

  // Append enabled policy blocks (BGP, iACL, 802.1X, QoS, AAA, VLAN, Static, Trunk, Wireless)
  const policyBlocks = (typeof buildPolicyBlocks === 'function')
    ? buildPolicyBlocks(dev, os)
    : '';
  if (policyBlocks) {
    base += '\n\n' + policyBlocks;
  }
  return base;
}

/* ════════════════════════════════════════════════════════════════
   RESOLVED STATE ADAPTER
   ─────────────────────────────────────────────────────────────
   Config generators read protocol/feature flags from RESOLVED_STATE
   when available (populated by policyengine.js after AUTO_FIX runs),
   falling back to raw STATE.* for backward compatibility.

   This means: if the policy engine auto-enabled PFC for a GPU design,
   config generators will emit PFC config even if the user never
   explicitly toggled it in the UI.
════════════════════════════════════════════════════════════════ */
function _rs(field, fallback) {
  // Read from RESOLVED_STATE if available; fall back to evaluated fallback
  if (typeof RESOLVED_STATE !== 'undefined' && RESOLVED_STATE !== null) {
    const v = RESOLVED_STATE[field];
    if (v !== undefined) return v;
  }
  return (typeof fallback === 'function') ? fallback() : fallback;
}

/* ── IOS-XE (Campus) ────────────────────────────────────────────── */
function genIOSXE(dev, layer, idx) {
  /* WAN use case: delegate to dedicated WAN router generator */
  if (dev.role === 'HQ Core Router') return _genWANRouterIOSXE(dev, true,  idx);
  if (dev.role === 'Branch CPE')     return _genWANRouterIOSXE(dev, false, idx);

  const name   = dev.name;
  const mgmtIP = `10.0.0.${30 + idx}`;
  const loIP   = `10.255.0.${20 + idx}`;
  const isCore = layer === 'campus-core';
  const isDist = layer === 'campus-dist';
  const isAcc  = layer === 'campus-access';
  const isFW   = layer === 'fw';
  const _ud    = (typeof getUplinkDescs === 'function') ? getUplinkDescs(name) : [];

  // Read from RESOLVED_STATE (policy-engine resolved) → fallback to STATE
  const hasVxlan = _rs('vxlanEnabled', () => (STATE.overlayProto || []).some(o=>o.includes('VXLAN')));
  const hasBGP   = _rs('bgpEnabled',   () => (STATE.underlayProto || []).includes('BGP'));
  const hasOSPF  = _rs('ospfEnabled',  () =>
    (STATE.underlayProto || []).includes('OSPF') || (!hasBGP && !(STATE.underlayProto||[]).includes('EIGRP') && !isAcc));
  const hasEIGRP = _rs('eigrpEnabled', () => (STATE.underlayProto || []).includes('EIGRP'));
  const hasISIS  = _rs('isisEnabled',  () => (STATE.underlayProto || []).includes('IS-IS'));
  const has8021x = _rs('dot1xEnabled', () => (STATE.nac || []).some(n=>n.includes('802.1X')));
  const hasPFC   = _rs('pfcEnabled',   () => (STATE.gpuSpecifics || []).includes('pfc'));
  const hasRoCE  = _rs('roceEnabled',  () => (STATE.gpuSpecifics || []).includes('rocev2'));
  const hasDHCP  = true;

  const p2p = `10.100.0.${idx*2}`;
  const p2pMask = '255.255.255.254';

  let cfg = `! ═══════════════════════════════════════════════════════════
! Device : ${name}
! Role   : ${dev.role}
! Layer  : ${layer}
! OS     : Cisco IOS-XE
! Generated by NetDesign AI — ${new Date().toISOString().slice(0,10)}
! ═══════════════════════════════════════════════════════════
!
! ── MANAGEMENT ─────────────────────────────────────────────
hostname ${name}
!
ip domain-name netdesign.local
ip name-server 8.8.8.8
service timestamps log datetime msec localtime show-timezone
service timestamps debug datetime msec
service password-encryption
no service pad
!
username admin privilege 15 algorithm-type sha256 secret NetDesign@2024
enable algorithm-type sha256 secret NetDesign@2024
!
! ── VLANs ──────────────────────────────────────────────────
vlan 10
 name MGMT
vlan 20
 name CORP-DATA
vlan 21
 name GUEST
vlan 30
 name VOICE
vlan 40
 name WIRELESS-CORP
vlan 41
 name WIRELESS-GUEST
vlan 50
 name SERVER-FARM
vlan 60
 name DMZ
vlan 99
 name NATIVE-TRUNK
`;

  if (isAcc) {
    cfg += _genSTP('ios-xe', 'campus-access');
    cfg += `!
! ── INTERFACES — Uplinks ───────────────────────────────────
interface GigabitEthernet0/1
 description ${_ud[0] || 'UPLINK-TO-DIST-0' + (idx+1) + '-Po' + (idx+1)}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 channel-group ${idx+1} mode active
 no shutdown
!
interface GigabitEthernet0/2
 description ${_ud[1] || 'UPLINK-TO-DIST-0' + (idx+1) + '-Po' + (idx+1) + ' (LAG member 2)'}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 channel-group ${idx+1} mode active
 no shutdown
!
interface Port-channel${idx+1}
 description LAG-TO-DIST-0${idx+1}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
!
! ── INTERFACES — User Access Ports ─────────────────────────
interface range GigabitEthernet0/3 - 44
 description USER-ACCESS-PORT
 switchport mode access
 switchport access vlan 20
 switchport voice vlan 30
 switchport nonegotiate
 spanning-tree portfast
 spanning-tree bpduguard enable
 storm-control broadcast level 20.00
 storm-control multicast level 10.00
 storm-control action shutdown
 ip dhcp snooping limit rate 15
${has8021x ? ` dot1x pae authenticator
 dot1x timeout quiet-period 10
 dot1x timeout tx-period 10
 authentication port-control auto
 authentication order dot1x mab
 authentication priority dot1x mab
 mab` : ' shutdown'}
 no shutdown
!
interface range GigabitEthernet0/45 - 48
 description AP-PORT-PoE
 switchport mode access
 switchport access vlan 40
 spanning-tree portfast
 storm-control broadcast level 20.00
 power inline auto max 30000
 no shutdown
!
! ── INTERFACES — Management SVI ────────────────────────────
interface Vlan10
 description OOB-MANAGEMENT-SVI
 ip address ${mgmtIP} 255.255.255.0
 no shutdown
!
ip default-gateway 10.0.0.1
!
! ── SECURITY ───────────────────────────────────────────────
ip dhcp snooping
ip dhcp snooping vlan 10,20,21,30,40,41
no ip dhcp snooping information option
!
ip arp inspection vlan 10,20,21,30,40,41
!
${has8021x ? `dot1x system-auth-control
!
aaa new-model
aaa authentication dot1x default group radius local
aaa authorization network default group radius local
aaa accounting dot1x default start-stop group radius
!
radius server ISE-PRIMARY
 address ipv4 10.0.0.100 auth-port 1812 acct-port 1813
 key NetDesign@ISE2024
!
ip radius source-interface Vlan10` : '! 802.1X not enabled'}
`;
  }

  if (isDist) {
    cfg += _genSTP('ios-xe', 'campus-dist');
    cfg += `!
! ── INTERFACES — Core Uplinks ──────────────────────────────
interface TenGigabitEthernet1/1
 description ${_ud[0] || 'UPLINK-TO-CORE-01-Po1'}
 no switchport
 ip address ${p2p} ${p2pMask}
 no shutdown
!
interface TenGigabitEthernet1/2
 description ${_ud[1] || 'UPLINK-TO-CORE-02-Po2'}
 no switchport
 ip address 10.100.0.${idx*2+4} ${p2pMask}
 no shutdown
!
! ── INTERFACES — Access Downlinks ──────────────────────────
interface GigabitEthernet0/1
 description ${_ud[2] || 'DOWNLINK-TO-ACC-0' + (idx*2+1)}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 no shutdown
!
interface GigabitEthernet0/2
 description ${_ud[3] || 'DOWNLINK-TO-ACC-0' + (idx*2+2)}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 no shutdown
!
! ── SVIs — Layer 3 Gateways ────────────────────────────────
interface Vlan10
 description MGMT-GW
 ip address 10.0.0.${idx===0?'253':'254'} 255.255.255.0
 no shutdown
!
interface Vlan20
 description CORP-DATA-GW
 ip address 10.10.${idx}.1 255.255.252.0
 ip helper-address 10.0.0.100
 no shutdown
!
interface Vlan30
 description VOICE-GW
 ip address 10.20.${idx}.1 255.255.254.0
 ip helper-address 10.0.0.100
 no shutdown
!
interface Vlan40
 description WIRELESS-CORP-GW
 ip address 10.30.${idx}.1 255.255.252.0
 ip helper-address 10.0.0.100
 no shutdown
!
! ── ROUTING (Distribution) ──────────────────────────────────
${hasOSPF ? `router ospf 1
 router-id ${loIP}
 passive-interface default
 no passive-interface TenGigabitEthernet1/1
 no passive-interface TenGigabitEthernet1/2
 network 10.100.0.0 0.0.0.255 area 0
 network 10.0.0.0 0.0.255.255 area 0
 area 1 stub no-summary
 area 0 authentication message-digest` : ''}
${hasEIGRP ? `!
router eigrp CAMPUS-FABRIC
 !
 address-family ipv4 unicast autonomous-system 100
  !
  af-interface default
   passive-interface
   authentication mode hmac-sha-256
   authentication key-chain EIGRP-KEY
  exit-af-interface
  !
  af-interface TenGigabitEthernet1/1
   no passive-interface
   hello-interval 5
   hold-time 15
  exit-af-interface
  !
  af-interface TenGigabitEthernet1/2
   no passive-interface
   hello-interval 5
   hold-time 15
  exit-af-interface
  !
  topology base
   no auto-summary
   maximum-paths 4
  exit-af-topology
  !
  network 10.0.0.0 0.255.255.255
  eigrp router-id ${loIP}
  eigrp stub connected summary
 exit-address-family` : ''}
${hasBGP ? `router bgp 65100
 bgp router-id ${loIP}
 bgp log-neighbor-changes
 neighbor 10.100.0.${idx*2-1} remote-as 65100
  description CORE-01
 !
 address-family ipv4
  neighbor 10.100.0.${idx*2-1} activate
  network 10.10.${idx}.0 mask 255.255.252.0
  network 10.20.${idx}.0 mask 255.255.254.0` : ''}
`;
    cfg += _genFHRP('ios-xe', layer, idx);
  }

  if (isCore) {
    cfg += _genSTP('ios-xe', 'campus-core');
    cfg += `!
! ── INTERFACES — FW / WAN Uplinks ─────────────────────────
interface TenGigabitEthernet1/1
 description UPLINK-TO-FW-01
 no switchport
 ip address 10.0.0.2 255.255.255.252
 no shutdown
!
! ── INTERFACES — Distribution Downlinks ────────────────────
interface TenGigabitEthernet2/1
 description ${_ud[0] || 'DOWNLINK-TO-DIST-01'}
 no switchport
 ip address 10.100.0.0 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/2
 description ${_ud[1] || 'DOWNLINK-TO-DIST-02'}
 no switchport
 ip address 10.100.0.2 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/3
 description ${_ud[2] || 'DOWNLINK-TO-DIST-03'}
 no switchport
 ip address 10.100.0.4 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/4
 description ${_ud[3] || 'DOWNLINK-TO-DIST-04'}
 no switchport
 ip address 10.100.0.6 255.255.255.254
 no shutdown
!
interface Loopback0
 description ROUTER-ID
 ip address ${loIP} 255.255.255.255
!
! ── ROUTING (Core) ──────────────────────────────────────────
${hasOSPF ? `router ospf 1
 router-id ${loIP}
 passive-interface default
 no passive-interface TenGigabitEthernet1/1
 no passive-interface TenGigabitEthernet2/1
 no passive-interface TenGigabitEthernet2/2
 no passive-interface TenGigabitEthernet2/3
 no passive-interface TenGigabitEthernet2/4
 network 10.100.0.0 0.0.0.255 area 0
 network 10.255.0.0 0.0.0.255 area 0
 area 0 authentication message-digest` : ''}
${hasEIGRP ? `!
router eigrp CAMPUS-FABRIC
 !
 address-family ipv4 unicast autonomous-system 100
  !
  af-interface default
   passive-interface
   authentication mode hmac-sha-256
   authentication key-chain EIGRP-KEY
  exit-af-interface
  !
  af-interface TenGigabitEthernet1/1
   no passive-interface
   hello-interval 5
   hold-time 15
  exit-af-interface
  !
  af-interface TenGigabitEthernet2/1
   no passive-interface
  exit-af-interface
  !
  af-interface TenGigabitEthernet2/2
   no passive-interface
  exit-af-interface
  !
  af-interface TenGigabitEthernet2/3
   no passive-interface
  exit-af-interface
  !
  af-interface TenGigabitEthernet2/4
   no passive-interface
  exit-af-interface
  !
  topology base
   no auto-summary
   maximum-paths 4
  exit-af-topology
  !
  network 10.0.0.0 0.255.255.255
  eigrp router-id ${loIP}
 exit-address-family
!
key chain EIGRP-KEY
 key 1
  key-string EIGRP@NetDesign2024
  cryptographic-algorithm hmac-sha-256` : ''}
${hasBGP ? `router bgp 65100
 bgp router-id ${loIP}
 bgp log-neighbor-changes
 bgp bestpath as-path multipath-relax
 neighbor 10.100.0.1 remote-as 65100
  description DIST-01
 neighbor 10.100.0.3 remote-as 65100
  description DIST-02
 !
 address-family ipv4
  neighbor 10.100.0.1 activate
  neighbor 10.100.0.3 activate
  network ${loIP} mask 255.255.255.255
  maximum-paths 4` : ''}
`;
  }

  // Common footer for all IOS-XE
  if ((STATE.protoFeatures || []).includes('IPv6 Dual-Stack')) cfg += _genIPv6Underlay('ios-xe', layer, idx);
  cfg += _genIGMP('ios-xe', layer);
  cfg += _genQoS('ios-xe', STATE);
  cfg += _genNTP('ios-xe');
  cfg += _genSNMPv3('ios-xe');
  cfg += _genAAA('ios-xe', STATE);
  cfg += _genGNMI('ios-xe');
  cfg += `!
! ── SSH ─────────────────────────────────────────────────────
crypto key generate rsa modulus 2048
ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
!
line con 0
 logging synchronous
 exec-timeout 15 0
!
line vty 0 15
 transport input ssh
 login authentication default
 exec-timeout 10 0
 logging synchronous
!
! ── SAVE ────────────────────────────────────────────────────
end
`;
  return cfg;
}

/* ── NX-OS (DC) ─────────────────────────────────────────────────── */
function genNXOS(dev, layer, idx) {
  if (dev.role === 'HQ Core Router' || dev.role === 'Branch CPE') {
    return `! ── WAN NOTE ─────────────────────────────────────────────\n! NX-OS is a DC OS and does not support DMVPN/FlexVPN.\n! Switch the vendor to Cisco IOS-XE (ASR/ISR) or Juniper\n! (MX/SRX) for WAN/Branch deployments.\n`;
  }
  const name    = dev.name;
  const isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  const isLeaf  = layer === 'dc-leaf';
  const isTOR   = layer === 'gpu-tor';
  const asn     = isSpine ? 65000 : (isTOR ? 65010 + idx : 65001 + idx);
  const loIP    = isSpine ? `10.255.1.${idx+1}` : (isTOR ? `10.255.5.${idx+1}` : `10.255.2.${idx+1}`);
  const vtepIP  = `10.255.3.${idx+1}`;
  const mgmtIP  = `10.0.0.${isSpine ? 5+idx : 11+idx}`;
  const _ud     = (typeof getUplinkDescs === 'function') ? getUplinkDescs(name) : [];
  // Use RESOLVED_STATE when available (policy engine may have AUTO_FIX'd EVPN→BGP or PFC)
  const hasVxlan= _rs('vxlanEnabled', () => STATE.overlayProto.some(o=>o.includes('VXLAN'))) && !isTOR;
  const hasEVPN = _rs('evpnEnabled',  () => hasVxlan);
  const hasPFC  = _rs('pfcEnabled',   () => (STATE.gpuSpecifics || []).includes('pfc'));
  const hasRoCE = _rs('roceEnabled',  () => (STATE.gpuSpecifics || []).includes('rocev2'));
  const hasOSPF = _rs('ospfEnabled',  () => (STATE.underlayProto || []).includes('OSPF'));

  let cfg = `! ═══════════════════════════════════════════════════════════
! Device : ${name}
! Role   : ${dev.role}
! OS     : Cisco NX-OS 10.x
! Generated by NetDesign AI — ${new Date().toISOString().slice(0,10)}
! ═══════════════════════════════════════════════════════════
!
! ── MANAGEMENT ─────────────────────────────────────────────
hostname ${name}
!
! ── FEATURES ───────────────────────────────────────────────
feature bgp
feature isis
${hasOSPF ? `feature ospf` : ''}
feature interface-vlan
feature lacp
feature lldp
feature nxapi
feature restconf
feature telemetry
${hasVxlan ? `feature vn-segment-vlan-based
feature nv overlay` : ''}
${isLeaf   ? `feature vpc
feature dhcp` : ''}
!
no ip domain-lookup
ip domain-name netdesign.local
!
! ── VLANs ──────────────────────────────────────────────────
vlan 10
  name MGMT
${hasVxlan ? `vlan 100
  vn-segment 100000
  name DC-TENANT-A
vlan 101
  vn-segment 100001
  name DC-TENANT-B
vlan 200
  name DC-STORAGE` : ''}
!
${hasEVPN ? `! ── VRFs ───────────────────────────────────────────────────
vrf context TENANT-A
  vni 999000
  rd auto
  address-family ipv4 unicast
    route-target both auto evpn
!
vrf context TENANT-B
  vni 999001
  rd auto
  address-family ipv4 unicast
    route-target both auto evpn
!` : ''}
! ── INTERFACES ─────────────────────────────────────────────
interface loopback0
  description ROUTER-ID / BGP-SOURCE
  ip address ${loIP}/32
  ip router isis 1
${hasVxlan ? `interface loopback1
  description VTEP-SOURCE
  ip address ${vtepIP}/32
  ip router isis 1` : ''}
!
`;

  if (isSpine) {
    cfg += `interface Ethernet1/1
  description ${_ud[0] || 'TO-LEAF-01-Eth49/1'}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/2
  description ${_ud[1] || 'TO-LEAF-02-Eth49/1'}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8+2}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/3
  description ${_ud[2] || 'TO-LEAF-03-Eth49/1'}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8+4}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/4
  description ${_ud[3] || 'TO-LEAF-04-Eth49/1'}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8+6}/31
  ip router isis 1
  no shutdown
!
! ── IS-IS UNDERLAY ──────────────────────────────────────────
router isis 1
  net 49.0001.0102.5500.100${idx+1}.00
  is-type level-2
  address-family ipv4 unicast
    maximum-paths 64
    redistribute direct route-map CONNECTED-TO-ISIS
!
! ── BGP / EVPN ROUTE REFLECTOR ─────────────────────────────
router bgp ${asn}
  router-id ${loIP}
  log-neighbor-changes
  address-family ipv4 unicast
    maximum-paths 64
  address-family l2vpn evpn
    retain route-target all
  !
  neighbor 10.255.2.1
    remote-as 65001
    description LEAF-01
    update-source loopback0
    address-family ipv4 unicast
      route-reflector-client
      soft-reconfiguration inbound
    address-family l2vpn evpn
      route-reflector-client
      send-community extended
  neighbor 10.255.2.2
    remote-as 65002
    description LEAF-02
    update-source loopback0
    address-family ipv4 unicast
      route-reflector-client
    address-family l2vpn evpn
      route-reflector-client
      send-community extended
  neighbor 10.255.2.3
    remote-as 65003
    description LEAF-03
    update-source loopback0
    address-family ipv4 unicast
      route-reflector-client
    address-family l2vpn evpn
      route-reflector-client
      send-community extended
  neighbor 10.255.2.4
    remote-as 65004
    description LEAF-04
    update-source loopback0
    address-family ipv4 unicast
      route-reflector-client
    address-family l2vpn evpn
      route-reflector-client
      send-community extended
`;
  }

  if (isLeaf) {
    cfg += `interface Ethernet1/49
  description ${_ud[0] || 'TO-SPINE-01-Eth1/' + (idx+1)}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*2+1}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/50
  description ${_ud[1] || 'TO-SPINE-02-Eth1/' + (idx+1)}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*2+9}/31
  ip router isis 1
  no shutdown
!
! ── SERVER PORTS (dual-homed via vPC) ───────────────────────
interface Ethernet1/1
  description SERVER-01-Bond0-eth0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  channel-group 1 mode active
  no shutdown
!
interface Ethernet1/2
  description SERVER-02-Bond0-eth0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  channel-group 2 mode active
  no shutdown
!
interface port-channel1
  description SERVER-01-Bond0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  vpc 1
!
interface port-channel2
  description SERVER-02-Bond0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  vpc 2
!
${hasVxlan ? `interface Vlan100
  description TENANT-A-ANYCAST-GW
  no shutdown
  vrf member TENANT-A
  ip address 10.200.0.1/22
  fabric forwarding mode anycast-gateway
!
interface Vlan101
  description TENANT-B-ANYCAST-GW
  no shutdown
  vrf member TENANT-B
  ip address 10.200.4.1/22
  fabric forwarding mode anycast-gateway
!
interface nve1
  no shutdown
  host-reachability protocol bgp
  source-interface loopback1
  member vni 100000
    ingress-replication protocol bgp
  member vni 100001
    ingress-replication protocol bgp
  member vni 999000 associate-vrf
  member vni 999001 associate-vrf
!
fabric forwarding anycast-gateway-mac 0000.2222.3333
!` : ''}
! ── vPC PEER LINK ───────────────────────────────────────────
interface Ethernet1/51
  description VPC-PEER-LINK-1
  switchport
  switchport mode trunk
  switchport trunk allowed vlan all
  channel-group 1000 mode active
!
interface Ethernet1/52
  description VPC-PEER-LINK-2
  switchport
  switchport mode trunk
  switchport trunk allowed vlan all
  channel-group 1000 mode active
!
interface port-channel1000
  description VPC-PEER-LINK
  switchport
  switchport mode trunk
  spanning-tree port type network
!
vpc domain ${idx+1}
  peer-keepalive destination 10.0.0.${11 + (idx===0?1:0)} source 10.0.0.${11+idx} vrf management
  peer-gateway
  auto-recovery
  delay restore 150
!
! ── IS-IS UNDERLAY ──────────────────────────────────────────
router isis 1
  net 49.0001.0102.5500.200${idx+1}.00
  is-type level-2
  address-family ipv4 unicast
    maximum-paths 4
    redistribute direct route-map CONNECTED-TO-ISIS
!
! ── BGP ─────────────────────────────────────────────────────
router bgp ${asn}
  router-id ${loIP}
  bestpath as-path multipath-relax
  address-family ipv4 unicast
    maximum-paths 4
    maximum-paths ibgp 4
  address-family l2vpn evpn
    advertise-all-vni
    advertise-system-mac
  !
  neighbor 10.255.1.1
    remote-as 65000
    description SPINE-01
    update-source loopback0
    address-family ipv4 unicast
      soft-reconfiguration inbound
    address-family l2vpn evpn
      send-community extended
  neighbor 10.255.1.2
    remote-as 65000
    description SPINE-02
    update-source loopback0
    address-family ipv4 unicast
      soft-reconfiguration inbound
    address-family l2vpn evpn
      send-community extended
${hasEVPN ? `!
! ── EVPN ────────────────────────────────────────────────────
evpn
  vni 100000 l2
    rd auto
    route-target import auto
    route-target export auto
  vni 100001 l2
    rd auto
    route-target import auto
    route-target export auto` : ''}
`;
  }

  if (isTOR) {
    cfg += `! ── QoS FOR RoCEv2 / RDMA ─────────────────────────────────
class-map type qos match-all RDMA-CLASS
  match dscp 26
class-map type qos match-all STORAGE-CLASS
  match dscp 46
!
policy-map type qos QOS-INGRESS
  class RDMA-CLASS
    set qos-group 3
  class STORAGE-CLASS
    set qos-group 4
  class class-default
    set qos-group 0
!
class-map type queuing RDMA-QUEUE
  match qos-group 3
policy-map type queuing GPU-QUEUING
  class type queuing RDMA-QUEUE
    priority
    bandwidth percent 50
    queue-limit percent 20
!
class-map type network-qos RDMA-NETWORK-QOS
  match qos-group 3
policy-map type network-qos GPU-NETWORK-QOS
  class type network-qos RDMA-NETWORK-QOS
    mtu 9216
    pause no-drop
    congestion-control ecn minimum-absolute 150 maximum-absolute 1500
!
system qos
  service-policy type queuing input GPU-QUEUING
  service-policy type network-qos GPU-NETWORK-QOS
!
! ── INTERFACES — GPU Server Ports ──────────────────────────
interface Ethernet1/1
  description GPU-SVR-${idx*4+1}-mlx5_0-RoCEv2
  no switchport
  mtu 9216
  ip address 192.168.100.${idx*32+1}/31
  service-policy type qos input QOS-INGRESS
  priority-flow-control mode on
  no shutdown
!
interface Ethernet1/2
  description GPU-SVR-${idx*4+2}-mlx5_0-RoCEv2
  no switchport
  mtu 9216
  ip address 192.168.100.${idx*32+3}/31
  service-policy type qos input QOS-INGRESS
  priority-flow-control mode on
  no shutdown
!
! ── INTERFACES — Spine Uplinks ─────────────────────────────
interface Ethernet49/1
  description TO-GPU-SPINE-01
  no switchport
  mtu 9216
  ip address 10.1.1.${idx*4+1}/31
  no shutdown
!
interface Ethernet50/1
  description TO-GPU-SPINE-02
  no switchport
  mtu 9216
  ip address 10.1.1.${idx*4+3}/31
  no shutdown
!
! ── BGP ─────────────────────────────────────────────────────
router bgp ${asn}
  router-id ${loIP}
  bestpath as-path multipath-relax
  address-family ipv4 unicast
    maximum-paths 2
    network ${loIP}/32
    network 192.168.100.${idx*32}/31
  !
  neighbor 10.1.1.${idx*4}
    remote-as 65010
    description GPU-SPINE-01
    address-family ipv4 unicast
  neighbor 10.1.1.${idx*4+2}
    remote-as 65010
    description GPU-SPINE-02
    address-family ipv4 unicast
`;
  }

  if (hasOSPF && !isTOR) cfg += _genOSPFUnderlay('nxos', STATE, dev, layer, idx);

  // Common NX-OS footer
  cfg += `!
! ── MANAGEMENT INTERFACE ───────────────────────────────────
interface mgmt0
  description OOB-MANAGEMENT
  vrf member management
  ip address ${mgmtIP}/24
!
ip route 0.0.0.0/0 10.0.0.1 vrf management
`;
  if ((STATE.protoFeatures || []).includes('IPv6 Dual-Stack')) cfg += _genIPv6Underlay('nxos', layer, idx);
  cfg += _genIGMP('nxos', layer);
  cfg += _genSTP('nxos', layer);
  cfg += _genQoS('nxos', STATE);
  cfg += _genNTP('nxos');
  cfg += _genSNMPv3('nxos');
  cfg += _genAAA('nxos', STATE);
  cfg += `!
! ── SSH ─────────────────────────────────────────────────────
ssh key rsa 2048
feature ssh
username admin password 0 NetDesign@2024 role network-admin
`;
  cfg += _genGNMI('nxos');
  cfg += `!
end
`;
  return cfg;
}

/* ── Arista EOS ─────────────────────────────────────────────────── */
function genEOS(dev, layer, idx) {
  if (dev.role === 'HQ Core Router' || dev.role === 'Branch CPE') {
    return `! ── WAN NOTE ─────────────────────────────────────────────\n! Arista EOS is a DC OS and does not support DMVPN/NHRP.\n! Switch the vendor to Cisco IOS-XE (ASR/ISR) for traditional\n! DMVPN, or use Arista CloudVision SD-WAN for EOS-based WAN.\n`;
  }
  const name    = dev.name;
  const isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  const isTOR   = layer === 'gpu-tor';
  const asn     = isSpine ? 65000 : 65001 + idx;
  const loIP    = isSpine ? `10.255.1.${idx+1}` : `10.255.2.${idx+1}`;
  const vtepIP  = `10.255.3.${idx+1}`;
  const _ud     = (typeof getUplinkDescs === 'function') ? getUplinkDescs(name) : [];
  // Use RESOLVED_STATE when available (policy engine may have AUTO_FIX'd EVPN→BGP or PFC)
  const isLeaf  = layer === 'dc-leaf';
  const hasVxlan= _rs('vxlanEnabled', () => STATE.overlayProto.some(o=>o.includes('VXLAN'))) && !isTOR;
  const hasPFC  = _rs('pfcEnabled',   () => (STATE.gpuSpecifics || []).includes('pfc'));
  const hasRoCE = _rs('roceEnabled',  () => (STATE.gpuSpecifics || []).includes('rocev2'));
  const hasOSPF = _rs('ospfEnabled',  () => (STATE.underlayProto || []).includes('OSPF'));
  const hasISIS = _rs('isisEnabled',  () => (STATE.underlayProto || []).includes('IS-IS'));

  return `! ═══════════════════════════════════════════════════════════
! Device : ${name}
! Role   : ${dev.role}
! OS     : Arista EOS 4.32
! Generated by NetDesign AI — ${new Date().toISOString().slice(0,10)}
! ═══════════════════════════════════════════════════════════
!
! ── MANAGEMENT ─────────────────────────────────────────────
hostname ${name}
!
management api http-commands
   no shutdown
   vrf MGMT
      no shutdown
!
management ssh
   vrf MGMT
      no shutdown
!
ip routing
ipv6 unicast-routing
!
! ── VLANs ───────────────────────────────────────────────────
vlan 10
   name MGMT
${hasVxlan ? `vlan 100
   name DC-TENANT-A
vlan 101
   name DC-TENANT-B` : ''}
!
${hasVxlan ? `! ── VRFs ───────────────────────────────────────────────────
vrf instance TENANT-A
   rd ${loIP}:9000
vrf instance TENANT-B
   rd ${loIP}:9001
!
ip routing vrf TENANT-A
ip routing vrf TENANT-B
!` : ''}
! ── INTERFACES ─────────────────────────────────────────────
interface Loopback0
   description ROUTER-ID
   ip address ${loIP}/32
!
${hasVxlan ? `interface Loopback1
   description VTEP-SOURCE
   ip address ${vtepIP}/32
!` : ''}
interface Ethernet49/1
   description ${_ud[0] || ('TO-' + (isSpine ? 'LEAF' : 'SPINE') + '-01')}
   no switchport
   ip address 10.1.0.${isSpine ? idx*8 : idx*2+1}/31
   no shutdown
!
interface Ethernet50/1
   description ${_ud[1] || ('TO-' + (isSpine ? 'LEAF' : 'SPINE') + '-02')}
   no switchport
   ip address 10.1.0.${isSpine ? idx*8+2 : idx*2+9}/31
   no shutdown
!
${hasVxlan && !isSpine ? `interface Vlan100
   description TENANT-A-IRB
   vrf TENANT-A
   ip address virtual 10.200.0.1/22
!
interface Vlan101
   description TENANT-B-IRB
   vrf TENANT-B
   ip address virtual 10.200.4.1/22
!
interface Vxlan1
   vxlan source-interface Loopback1
   vxlan udp-port 4789
   vxlan vlan 100 vni 100000
   vxlan vlan 101 vni 100001
   vxlan vrf TENANT-A vni 999000
   vxlan vrf TENANT-B vni 999001
!
ip virtual-router mac-address 00:00:22:22:33:33
!` : ''}
! ── BGP ─────────────────────────────────────────────────────
router bgp ${asn}
   router-id ${loIP}
   maximum-paths 4 ecmp 4
   bgp bestpath as-path multipath-relax
   !
   neighbor SPINES peer group
   neighbor SPINES remote-as 65000
   neighbor SPINES send-community extended
   neighbor SPINES maximum-routes 12000
   !
${isSpine ? `   neighbor LEAVES peer group
   neighbor LEAVES remote-as 65001
   neighbor LEAVES route-reflector-client
   neighbor LEAVES send-community extended
   neighbor 10.1.0.1 peer group LEAVES
   neighbor 10.1.0.3 peer group LEAVES
   neighbor 10.1.0.5 peer group LEAVES
   neighbor 10.1.0.7 peer group LEAVES` : `   neighbor 10.1.0.${idx*2} peer group SPINES
   neighbor 10.1.0.${idx*2+8} peer group SPINES`}
   !
${hasVxlan && !isSpine ? `   vlan 100
      rd auto
      route-target both auto
      redistribute learned
   vlan 101
      rd auto
      route-target both auto
      redistribute learned
   !
   address-family evpn
      neighbor SPINES activate
   !` : ''}
   address-family ipv4
      ${isSpine ? 'neighbor LEAVES activate' : 'neighbor SPINES activate'}
      network ${loIP}/32
      ${hasVxlan && !isSpine ? `network ${vtepIP}/32` : ''}
!
${hasOSPF && !isTOR ? _genOSPFUnderlay('eos', STATE, dev, layer, idx) : ''}
${hasISIS && !isTOR ? _genISISUnderlay('eos', layer, idx) : ''}
${isLeaf ? _genMLAG(layer, idx) : ''}
${(STATE.protoFeatures || []).includes('IPv6 Dual-Stack') ? _genIPv6Underlay('eos', layer, idx) : ''}
${_genIGMP('eos', layer)}
${_genSTP('eos', layer)}
${_genQoS('eos', STATE)}
${_genNTP('eos')}
${_genSNMPv3('eos')}
${_genAAA('eos', STATE)}
${_genGNMI('eos')}
ip route vrf MGMT 0.0.0.0/0 10.0.0.1
!
end
`;
}

/* ── Junos ──────────────────────────────────────────────────────── */
function genJunos(dev, layer, idx) {
  /* WAN use case: delegate to dedicated WAN router generator */
  if (dev.role === 'HQ Core Router') return _genWANRouterJunOS(dev, true,  idx);
  if (dev.role === 'Branch CPE')     return _genWANRouterJunOS(dev, false, idx);

  const name    = dev.name.toLowerCase().replace(/-/g, '_');
  const loIP    = `10.255.2.${idx+1}`;
  const mgmt    = `10.0.0.${20+idx}`;
  const hasOSPF = _rs('ospfEnabled', () => (STATE.underlayProto || []).includes('OSPF'));
  const hasISIS = _rs('isisEnabled', () => (STATE.underlayProto || []).includes('IS-IS'));
  const _ud     = (typeof getUplinkDescs === 'function') ? getUplinkDescs(dev.name) : [];
  return `## ═══════════════════════════════════════════════════════════
## Device : ${dev.name}  Role: ${dev.role}
## OS     : Juniper Junos 23.x
## Generated by NetDesign AI — ${new Date().toISOString().slice(0,10)}
## ═══════════════════════════════════════════════════════════
system {
    host-name ${name};
    domain-name netdesign.local;
    time-zone UTC;
    authentication-order [ password ];
    root-authentication {
        encrypted-password "$6$NetDesign2024";
    }
    login {
        user admin {
            class super-user;
            authentication {
                encrypted-password "$6$NetDesign2024";
            }
        }
    }
    services {
        ssh { root-login deny; protocol-version v2; }
        netconf { ssh; }
    }
    syslog {
        host 10.0.0.201 { any info; }
        file messages { any notice; authorization info; }
    }
    ${_genNTP('junos')}
}
${_genSNMPv3('junos')}
interfaces {
    lo0 {
        unit 0 {
            description "ROUTER-ID";
            family inet { address ${loIP}/32; }
        }
    }
    et-0/0/48 {
        unit 0 {
            description "${_ud[0] || 'TO-SPINE-01'}";
            family inet { address 10.1.0.${idx*2+1}/31; }
        }
    }
    et-0/0/49 {
        unit 0 {
            description "${_ud[1] || 'TO-SPINE-02'}";
            family inet { address 10.1.0.${idx*2+9}/31; }
        }
    }
    ge-0/0/0 {
        unit 0 {
            description "OOB-MANAGEMENT";
            family inet { address ${mgmt}/24; }
        }
    }
}
vlans {
    MGMT      { vlan-id 10; }
    TENANT-A  { vlan-id 100; vxlan { vni 100000; } }
    TENANT-B  { vlan-id 101; vxlan { vni 100001; } }
}
routing-options {
    router-id ${loIP};
    autonomous-system 6500${idx+1};
    forwarding-table { export ECMP-POLICY; }
}
policy-options {
    policy-statement ECMP-POLICY {
        then { load-balance per-packet; }
    }
    policy-statement CONNECTED {
        term direct { from protocol direct; then accept; }
    }
}
protocols {
    bgp {
        group SPINES {
            type external;
            export CONNECTED;
            multipath { multiple-as; }
            neighbor 10.1.0.${idx*2} { peer-as 65000; description "SPINE-01"; }
            neighbor 10.1.0.${idx*2+8} { peer-as 65000; description "SPINE-02"; }
        }
    }
    evpn { encapsulation vxlan; extended-vni-list all; }
    lldp { interface all; }
}
${hasOSPF ? _genOSPFUnderlay('junos', STATE, dev, layer, idx) : ''}
${hasISIS ? _genISISUnderlay('junos', layer, idx) : ''}
${(STATE.protoFeatures || []).includes('IPv6 Dual-Stack') ? _genIPv6Underlay('junos', layer, idx) : ''}
${_genIGMP('junos', layer)}
${_genSTP('junos', layer)}
${_genQoS('junos', STATE)}
${_genAAA('junos', STATE)}
${_genGNMI('junos')}
`;
}

/* ── SONiC ──────────────────────────────────────────────────────── */
function genSONiC(dev, layer, idx) {
  if (dev.role === 'HQ Core Router' || dev.role === 'Branch CPE') {
    return `# ── WAN NOTE ─────────────────────────────────────────────\n# SONiC is a DC/GPU OS and does not support DMVPN/IPSec WAN.\n# Switch the vendor to Cisco IOS-XE (ASR/ISR) or Juniper\n# (MX/SRX) for WAN/Branch deployments.\n`;
  }
  const name    = dev.name;
  const hasOSPF = _rs('ospfEnabled', () => (STATE.underlayProto || []).includes('OSPF'));
  const hasISIS = _rs('isisEnabled', () => (STATE.underlayProto || []).includes('IS-IS'));
  return `# ═══════════════════════════════════════════════════════════
# Device : ${name}  Role: ${dev.role}
# OS     : NVIDIA SONiC 202311
# Generated by NetDesign AI — ${new Date().toISOString().slice(0,10)}
# ═══════════════════════════════════════════════════════════

# ── /etc/sonic/config_db.json (excerpt) ────────────────────
{
  "DEVICE_METADATA": {
    "localhost": {
      "hostname": "${name}",
      "type": "ToRRouter",
      "bgp_asn": "${65011 + idx}",
      "mac": "aa:bb:cc:00:0${idx+1}:01",
      "platform": "x86_64-nvidia_sn4600c-r0"
    }
  },
  "LOOPBACK_INTERFACE": {
    "Loopback0|10.255.5.${idx+1}/32": {}
  },
  "INTERFACE": {
    "Ethernet0|192.168.100.${idx*32+1}/31": { "scope": "global", "family": "IPv4" },
    "Ethernet4|192.168.100.${idx*32+3}/31": { "scope": "global", "family": "IPv4" },
    "Ethernet112|10.1.1.${idx*4+1}/31":     { "scope": "global", "family": "IPv4" },
    "Ethernet116|10.1.1.${idx*4+3}/31":     { "scope": "global", "family": "IPv4" }
  },
  "BGP_NEIGHBOR": {
    "10.1.1.${idx*4}":   { "asn": "65010", "name": "GPU-SPINE-01", "local_addr": "10.1.1.${idx*4+1}" },
    "10.1.1.${idx*4+2}": { "asn": "65010", "name": "GPU-SPINE-02", "local_addr": "10.1.1.${idx*4+3}" }
  },
  "DEVICE_NEIGHBOR": {
    "Ethernet0":   { "name": "GPU-SVR-${idx*4+1}", "port": "mlx5_0" },
    "Ethernet4":   { "name": "GPU-SVR-${idx*4+2}", "port": "mlx5_0" },
    "Ethernet112": { "name": "GPU-SPINE-01",         "port": "Ethernet${idx*4}" },
    "Ethernet116": { "name": "GPU-SPINE-02",         "port": "Ethernet${idx*4}" }
  }
}

# ── PFC / ECN (lossless RoCEv2) ────────────────────────────
# /etc/sonic/qos.json (KEY SETTINGS)
{
  "TC_TO_PRIORITY_GROUP_MAP": {
    "RDMA_TC_PG": { "3": "3" }
  },
  "DSCP_TO_TC_MAP": {
    "RDMA_DSCP_MAP": { "26": "3" }
  },
  "PFC_PRIORITY_TO_QUEUE_MAP": {
    "RDMA": { "3": "3" }
  },
  "QUEUE": {
    "Ethernet0|3": { "scheduler": "RDMA_SCHEDULER", "wred_profile": "RDMA_WRED" }
  },
  "SCHEDULER": {
    "RDMA_SCHEDULER": { "type": "STRICT", "weight": "50" }
  },
  "WRED_PROFILE": {
    "RDMA_WRED": {
      "ecn":          "ecn_all",
      "green_min_threshold":  "153600",
      "green_max_threshold":  "1536000",
      "green_drop_probability": "5"
    }
  }
}

${hasOSPF ? _genOSPFUnderlay('sonic', STATE, dev, layer, idx) : ''}
${hasISIS ? _genISISUnderlay('sonic', layer, idx) : ''}
${(STATE.protoFeatures || []).includes('IPv6 Dual-Stack') ? _genIPv6Underlay('sonic', layer, idx) : ''}
${_genQoS('sonic', STATE)}
${_genNTP('sonic')}
${_genSNMPv3('sonic')}
${_genAAA('sonic', STATE)}
${_genGNMI('sonic')}
`;
}

/* ── Syntax highlighter ─────────────────────────────────────────── */
function highlight(code, os) {
  const esc = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = esc.split('\n');
  const out = lines.map(line => {
    const t = line.trim();
    // Full-line comment
    if (/^[!#]/.test(t) || /^##/.test(t)) return `<span class="cc">${line}</span>`;
    // JSON key
    if (/^\s*"[^"]+"\s*:/.test(line) && (os==='sonic')) {
      return line.replace(/"([^"]+)"(\s*:)/g, '<span class="cv">"$1"</span>$2');
    }
    // Highlight IPs
    let l = line.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/g, '<span class="cn">$1</span>');
    // Interface names
    l = l.replace(/\b(GigabitEthernet|TenGigabitEthernet|Ethernet|loopback|Loopback|Port-channel|Vlan|nve|mgmt|et-|ge-|xe-)\S+/gi,
      '<span class="ci">$&</span>');
    // IOS-XE / NX-OS keywords
    l = l.replace(/\b(hostname|interface|router|vlan|feature|shutdown|no shutdown|switchport|spanning-tree|ip|ipv6|bgp|ospf|isis|evpn|vrf|ntp|snmp|logging|aaa|radius|dot1x|authentication|crypto|line|vty|username|enable|service|clock|management|telemetry|vpc|lacp|lldp|fabric|nve|vni|route-target|address-family|neighbor|network|redistribute|maximum-paths|bestpath)\b/gi,
      '<span class="ck">$1</span>');
    // Arista EOS specific
    l = l.replace(/\b(peer group|route-reflector-client|send-community|load-balance|virtual-router)\b/gi,
      '<span class="cm">$&</span>');
    // Junos hierarchy
    l = l.replace(/\b(system|interfaces|protocols|routing-options|policy-options|vlans)\b/g,
      '<span class="cm">$&</span>');
    // "no" keyword
    l = l.replace(/\bno\b/g, '<span class="ce">no</span>');
    // Numbers (standalone)
    l = l.replace(/(?<![.\d])(\b\d+\b)(?![.\d])/g, '<span class="cn">$1</span>');
    return l;
  });
  return out.join('\n');
}

/* step 5 trigger is handled by the consolidated jumpStep hook above */
