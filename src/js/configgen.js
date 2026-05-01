'use strict';

/* ════════════════════════════════════════════════════════════════
   PART 4 — Configuration Generator
════════════════════════════════════════════════════════════════ */

/* ── Determine OS per layer ─────────────────────────────────────── */
function getOS(layerKey) {
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

const OS_LABELS = { 'ios-xe':'IOS-XE', 'nxos':'NX-OS', 'eos':'EOS', 'junos':'Junos', 'sonic':'SONiC' };

/* ── Device list builder ────────────────────────────────────────── */
function buildDeviceList() {
  const uc  = STATE.uc;
  const red = STATE.redundancy;
  const dual = red === 'ha' || red === 'full';
  const haFW = STATE.fwModel && STATE.fwModel !== 'none';
  const sz   = STATE.orgSize;
  const haCore = sz === 'large' || sz === 'enterprise';
  const devs = [];

  if (haFW) {
    devs.push({ id:'fw-01', name:'FW-01', layer:'fw', role:'Perimeter Firewall', icon:'🔒', idx:0 });
    if (dual) devs.push({ id:'fw-02', name:'FW-02', layer:'fw', role:'Firewall (HA)', icon:'🔒', idx:1 });
  }
  if (uc === 'campus' || uc === 'hybrid') {
    if (haCore) {
      devs.push({ id:'core-01', name:'CORE-01', layer:'campus-core', role:'Core Switch', icon:'⚙️', idx:0 });
      if (dual) devs.push({ id:'core-02', name:'CORE-02', layer:'campus-core', role:'Core Switch (HA)', icon:'⚙️', idx:1 });
    }
    devs.push({ id:'dist-01', name:'DIST-01', layer:'campus-dist', role:'Distribution', icon:'🔀', idx:0 });
    devs.push({ id:'dist-02', name:'DIST-02', layer:'campus-dist', role:'Distribution', icon:'🔀', idx:1 });
    devs.push({ id:'acc-01',  name:'ACC-01',  layer:'campus-access', role:'Access Switch', icon:'🔌', idx:0 });
    devs.push({ id:'acc-02',  name:'ACC-02',  layer:'campus-access', role:'Access Switch', icon:'🔌', idx:1 });
    devs.push({ id:'acc-03',  name:'ACC-03',  layer:'campus-access', role:'Access Switch', icon:'🔌', idx:2 });
  }
  if (uc === 'dc' || uc === 'hybrid' || uc === 'multisite') {
    const sites = uc === 'multisite' ? Math.min(4, Math.max(3, parseInt(STATE.numSitesTopology) || 3)) : 1;
    const siteIds = ['DCA','DCB','DCC','DCD'].slice(0, sites);
    if (uc === 'multisite') {
      siteIds.forEach((sid, si) => {
        devs.push({ id:`${sid.toLowerCase()}-sp1`, name:`${sid}-SPINE-01`, layer:'dc-spine', role:`${sid} Spine`, icon:'🦴', idx: si*2 });
        devs.push({ id:`${sid.toLowerCase()}-sp2`, name:`${sid}-SPINE-02`, layer:'dc-spine', role:`${sid} Spine`, icon:'🦴', idx: si*2+1 });
        devs.push({ id:`${sid.toLowerCase()}-lf1`, name:`${sid}-LEAF-01`,  layer:'dc-leaf',  role:`${sid} Leaf`,  icon:'🍃', idx: si*2 });
        devs.push({ id:`${sid.toLowerCase()}-lf2`, name:`${sid}-LEAF-02`,  layer:'dc-leaf',  role:`${sid} Leaf`,  icon:'🍃', idx: si*2+1 });
      });
    } else {
      devs.push({ id:'spine-01', name:'SPINE-01', layer:'dc-spine', role:'DC Spine', icon:'🦴', idx:0 });
      devs.push({ id:'spine-02', name:'SPINE-02', layer:'dc-spine', role:'DC Spine', icon:'🦴', idx:1 });
      devs.push({ id:'leaf-01',  name:'LEAF-01',  layer:'dc-leaf',  role:'DC Leaf',  icon:'🍃', idx:0 });
      devs.push({ id:'leaf-02',  name:'LEAF-02',  layer:'dc-leaf',  role:'DC Leaf',  icon:'🍃', idx:1 });
      devs.push({ id:'leaf-03',  name:'LEAF-03',  layer:'dc-leaf',  role:'DC Leaf',  icon:'🍃', idx:2 });
      devs.push({ id:'leaf-04',  name:'LEAF-04',  layer:'dc-leaf',  role:'DC Leaf',  icon:'🍃', idx:3 });
    }
  }
  if (uc === 'gpu') {
    devs.push({ id:'gspine-01', name:'GPU-SPINE-01', layer:'gpu-spine', role:'GPU Spine', icon:'🧠', idx:0 });
    devs.push({ id:'gspine-02', name:'GPU-SPINE-02', layer:'gpu-spine', role:'GPU Spine', icon:'🧠', idx:1 });
    devs.push({ id:'tor-01',    name:'GPU-TOR-01',   layer:'gpu-tor',   role:'GPU TOR',   icon:'⚡', idx:0 });
    devs.push({ id:'tor-02',    name:'GPU-TOR-02',   layer:'gpu-tor',   role:'GPU TOR',   icon:'⚡', idx:1 });
    devs.push({ id:'tor-03',    name:'GPU-TOR-03',   layer:'gpu-tor',   role:'GPU TOR',   icon:'⚡', idx:2 });
    devs.push({ id:'tor-04',    name:'GPU-TOR-04',   layer:'gpu-tor',   role:'GPU TOR',   icon:'⚡', idx:3 });
  }
  if (uc === 'wan') {
    devs.push({ id:'hq-rtr',  name:'HQ-RTR-01',  layer:'campus-core', role:'HQ Core Router', icon:'🌐', idx:0 });
    devs.push({ id:'br-01',   name:'BRANCH-01',  layer:'campus-access',role:'Branch CPE',     icon:'📡', idx:0 });
    devs.push({ id:'br-02',   name:'BRANCH-02',  layer:'campus-access',role:'Branch CPE',     icon:'📡', idx:1 });
    devs.push({ id:'br-03',   name:'BRANCH-03',  layer:'campus-access',role:'Branch CPE',     icon:'📡', idx:2 });
  }
  return devs;
}

/* ── Render device list sidebar ─────────────────────────────────── */
let DEVICE_LIST = [];
let ACTIVE_DEV  = null;

function renderDeviceList() {
  DEVICE_LIST = buildDeviceList();
  const body  = document.getElementById('dev-list-body');
  const badge = document.getElementById('dev-count-badge');
  badge.textContent = DEVICE_LIST.length;

  // Group by layer
  const groups = {};
  DEVICE_LIST.forEach(d => {
    if (!groups[d.layer]) groups[d.layer] = [];
    groups[d.layer].push(d);
  });
  const groupLabels = {
    'fw':'Security', 'campus-core':'Core', 'campus-dist':'Distribution',
    'campus-access':'Access', 'dc-spine':'DC Spine', 'dc-leaf':'DC Leaf',
    'gpu-spine':'GPU Spine', 'gpu-tor':'GPU TOR',
  };

  let html = '';
  Object.entries(groups).forEach(([layer, devs]) => {
    html += `<div class="dev-group-label">${groupLabels[layer] || layer}</div>`;
    devs.forEach(d => {
      const os = getOS(d.layer);
      html += `<div class="dev-item" id="di-${d.id}" onclick="selectDevice('${d.id}')">
        <span class="di-icon">${d.icon}</span>
        <div class="di-info">
          <div class="di-name">${d.name}</div>
          <div class="di-role">${d.role}</div>
        </div>
        <span class="di-os">${OS_LABELS[os]}</span>
      </div>`;
    });
  });
  body.innerHTML = html;

  // Auto-select first device
  if (DEVICE_LIST.length) selectDevice(DEVICE_LIST[0].id);
}

/* ── Select & render a device config ───────────────────────────── */
function selectDevice(id) {
  ACTIVE_DEV = DEVICE_LIST.find(d => d.id === id);
  if (!ACTIVE_DEV) return;

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

  // Build section nav
  renderSectionNav(raw);

  // Render highlighted code
  document.getElementById('cfg-code-pre').innerHTML = highlight(raw, os);
}

/* ── Section nav ────────────────────────────────────────────────── */
const SECTION_MARKERS = ['MANAGEMENT', 'VLANs', 'INTERFACES', 'ROUTING', 'BGP', 'EVPN', 'QoS', 'SECURITY', 'NTP'];
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
   CONFIG GENERATION TEMPLATES
════════════════════════════════════════════════════════════════ */
function generateConfig(dev, os) {
  const layer = dev.layer;
  const idx   = dev.idx || 0;
  if (os === 'ios-xe') return genIOSXE(dev, layer, idx);
  if (os === 'nxos')   return genNXOS(dev, layer, idx);
  if (os === 'eos')    return genEOS(dev, layer, idx);
  if (os === 'junos')  return genJunos(dev, layer, idx);
  if (os === 'sonic')  return genSONiC(dev, layer, idx);
  return genIOSXE(dev, layer, idx);
}

/* ── IOS-XE (Campus) ────────────────────────────────────────────── */
function genIOSXE(dev, layer, idx) {
  const name   = dev.name;
  const mgmtIP = `10.0.0.${30 + idx}`;
  const loIP   = `10.255.0.${20 + idx}`;
  const isCore = layer === 'campus-core';
  const isDist = layer === 'campus-dist';
  const isAcc  = layer === 'campus-access';
  const isFW   = layer === 'fw';
  const hasVxlan = (STATE.overlayProto || []).some(o=>o.includes('VXLAN'));
  const hasBGP   = (STATE.underlayProto || []).includes('BGP');
  const hasOSPF  = (STATE.underlayProto || []).includes('OSPF') || (!hasBGP && !(STATE.underlayProto||[]).includes('EIGRP') && !isAcc);
  const hasEIGRP = (STATE.underlayProto || []).includes('EIGRP');
  const hasISIS  = (STATE.underlayProto || []).includes('IS-IS');
  const has8021x = (STATE.nac || []).some(n=>n.includes('802.1X'));
  const hasDHCP = true;

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
    cfg += `!
! ── SPANNING TREE ──────────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree extend system-id
spanning-tree vlan 10,20,21,30,40,41,50 priority 32768
!
! ── INTERFACES — Uplinks ───────────────────────────────────
interface GigabitEthernet0/1
 description UPLINK-TO-DIST-0${idx+1}-Po${idx+1}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 channel-group ${idx+1} mode active
 no shutdown
!
interface GigabitEthernet0/2
 description UPLINK-TO-DIST-0${idx+1}-Po${idx+1} (LAG member 2)
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
    cfg += `!
! ── SPANNING TREE ──────────────────────────────────────────
spanning-tree mode rapid-pvst
spanning-tree extend system-id
spanning-tree vlan 10,20,21,30,40,41,50 priority 4096
!
! ── INTERFACES — Core Uplinks ──────────────────────────────
interface TenGigabitEthernet1/1
 description UPLINK-TO-CORE-01-Po1
 no switchport
 ip address ${p2p} ${p2pMask}
 no shutdown
!
interface TenGigabitEthernet1/2
 description UPLINK-TO-CORE-02-Po2
 no switchport
 ip address 10.100.0.${idx*2+4} ${p2pMask}
 no shutdown
!
! ── INTERFACES — Access Downlinks ──────────────────────────
interface GigabitEthernet0/1
 description DOWNLINK-TO-ACC-0${idx*2+1}
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20,21,30,40,41,50
 no shutdown
!
interface GigabitEthernet0/2
 description DOWNLINK-TO-ACC-0${idx*2+2}
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
  }

  if (isCore) {
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
 description DOWNLINK-TO-DIST-01
 no switchport
 ip address 10.100.0.0 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/2
 description DOWNLINK-TO-DIST-02
 no switchport
 ip address 10.100.0.2 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/3
 description DOWNLINK-TO-DIST-03
 no switchport
 ip address 10.100.0.4 255.255.255.254
 no shutdown
!
interface TenGigabitEthernet2/4
 description DOWNLINK-TO-DIST-04
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
  cfg += `!
! ── NTP / SNMP / SYSLOG ────────────────────────────────────
ntp server 10.0.0.1 prefer
ntp server 10.0.0.2
clock timezone UTC 0 0
!
snmp-server community NetRead ro
snmp-server community NetWrite rw
snmp-server host 10.0.0.200 version 2c NetRead
snmp-server enable traps
logging host 10.0.0.201
logging trap informational
logging source-interface Vlan10
!
! ── SSH / AAA ───────────────────────────────────────────────
aaa new-model
aaa authentication login default local
!
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
 login local
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
  const name    = dev.name;
  const isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  const isLeaf  = layer === 'dc-leaf';
  const isTOR   = layer === 'gpu-tor';
  const asn     = isSpine ? 65000 : (isTOR ? 65010 + idx : 65001 + idx);
  const loIP    = isSpine ? `10.255.1.${idx+1}` : (isTOR ? `10.255.5.${idx+1}` : `10.255.2.${idx+1}`);
  const vtepIP  = `10.255.3.${idx+1}`;
  const mgmtIP  = `10.0.0.${isSpine ? 5+idx : 11+idx}`;
  const hasVxlan= STATE.overlayProto.some(o=>o.includes('VXLAN')) && !isTOR;
  const hasEVPN = hasVxlan;

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
  description TO-LEAF-01-Eth49/1
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/2
  description TO-LEAF-02-Eth49/1
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8+2}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/3
  description TO-LEAF-03-Eth49/1
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*8+4}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/4
  description TO-LEAF-04-Eth49/1
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
  description TO-SPINE-01-Eth1/${idx+1}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*2+1}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/50
  description TO-SPINE-02-Eth1/${idx+1}
  no switchport
  mtu 9216
  ip address 10.1.0.${idx*2+9}/31
  ip router isis 1
  no shutdown
!
interface Ethernet1/1
  description SERVER-01-eth0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  no shutdown
!
interface Ethernet1/2
  description SERVER-02-eth0
  switchport
  switchport mode trunk
  switchport trunk allowed vlan 100,101
  mtu 9216
  spanning-tree port type edge trunk
  no shutdown
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

  // Common NX-OS footer
  cfg += `!
! ── MANAGEMENT INTERFACE ───────────────────────────────────
interface mgmt0
  description OOB-MANAGEMENT
  vrf member management
  ip address ${mgmtIP}/24
!
ip route 0.0.0.0/0 10.0.0.1 vrf management
!
! ── NTP / SNMP / SYSLOG ────────────────────────────────────
ntp server 10.0.0.1 use-vrf management
ntp server 10.0.0.2 use-vrf management
!
snmp-server community NetRead group network-operator
snmp-server host 10.0.0.200 version 2c NetRead use-vrf management
logging server 10.0.0.201 6 use-vrf management
!
! ── SSH ─────────────────────────────────────────────────────
ssh key rsa 2048
feature ssh
username admin password 0 NetDesign@2024 role network-admin
!
! ── TELEMETRY ───────────────────────────────────────────────
telemetry
  destination-group 1
    ip address 10.0.0.210 port 50051 protocol gRPC encoding GPB
  sensor-group 1
    data-source NX-API
    path sys/intf depth unbounded
    path sys/bgp depth unbounded
  subscription 1
    dst-grp 1
    snsr-grp 1 sample-interval 30000
!
end
`;
  return cfg;
}

/* ── Arista EOS ─────────────────────────────────────────────────── */
function genEOS(dev, layer, idx) {
  const name    = dev.name;
  const isSpine = layer === 'dc-spine' || layer === 'gpu-spine';
  const isTOR   = layer === 'gpu-tor';
  const asn     = isSpine ? 65000 : 65001 + idx;
  const loIP    = isSpine ? `10.255.1.${idx+1}` : `10.255.2.${idx+1}`;
  const vtepIP  = `10.255.3.${idx+1}`;
  const hasVxlan= STATE.overlayProto.some(o=>o.includes('VXLAN')) && !isTOR;

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
   description TO-${isSpine ? 'LEAF' : 'SPINE'}-01
   no switchport
   ip address 10.1.0.${isSpine ? idx*8 : idx*2+1}/31
   no shutdown
!
interface Ethernet50/1
   description TO-${isSpine ? 'LEAF' : 'SPINE'}-02
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
! ── NTP / SYSLOG ────────────────────────────────────────────
ntp server 10.0.0.1 iburst
logging host 10.0.0.201
logging buffered 10000
!
ip route vrf MGMT 0.0.0.0/0 10.0.0.1
!
! ── SNMP ────────────────────────────────────────────────────
snmp-server community NetRead ro
snmp-server host 10.0.0.200 version 2c NetRead
!
end
`;
}

/* ── Junos ──────────────────────────────────────────────────────── */
function genJunos(dev, layer, idx) {
  const name  = dev.name.toLowerCase().replace(/-/g, '_');
  const loIP  = `10.255.2.${idx+1}`;
  const mgmt  = `10.0.0.${20+idx}`;
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
    ntp { server 10.0.0.1; }
    snmp {
        community NetRead { authorization read-only; }
        trap-group netdesign { version v2; targets { 10.0.0.200; } }
    }
}
interfaces {
    lo0 {
        unit 0 {
            description "ROUTER-ID";
            family inet { address ${loIP}/32; }
        }
    }
    et-0/0/48 {
        unit 0 {
            description "TO-SPINE-01";
            family inet { address 10.1.0.${idx*2+1}/31; }
        }
    }
    et-0/0/49 {
        unit 0 {
            description "TO-SPINE-02";
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
    rstp { bridge-priority 32768; }
}
`;
}

/* ── SONiC ──────────────────────────────────────────────────────── */
function genSONiC(dev, layer, idx) {
  const name = dev.name;
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

# ── NTP / SYSLOG ─────────────────────────────────────────────
# /etc/sonic/config_db.json (NTP)
{
  "NTP_SERVER": { "10.0.0.1": {}, "10.0.0.2": {} },
  "SYSLOG_SERVER": { "10.0.0.201": {} },
  "SNMP_COMMUNITY": { "NetRead": { "TYPE": "RO" } }
}
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
