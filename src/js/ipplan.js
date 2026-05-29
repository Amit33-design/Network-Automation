'use strict';
/*  ipplan.js — Network IP Address & VLAN Allocation Plan
    Generates a structured addressing plan matching the IPs used in
    configgen.js, so engineers have a single reference for every subnet,
    VLAN, VNI, and ASN in the design.

    Public API (window.*):
      genIPAddressPlan(state)   → rows[]
      renderIPPlanPanel()       → injects collapsible table into #ipplan-section
      downloadIPPlanCSV()       → browser CSV download
      downloadIPPlanMarkdown()  → browser Markdown download
*/

/* ── Plan row schema ─────────────────────────────────────────────────
   { category, resource, vlan, subnet, purpose, notes }
   vlan/subnet can be empty strings when not applicable.
───────────────────────────────────────────────────────────────────── */

function _rows(category, arr) {
  return arr.map(function(r) {
    return {
      category: category,
      resource: r[0],
      vlan:     r[1] || '',
      subnet:   r[2] || '',
      purpose:  r[3] || '',
      notes:    r[4] || ''
    };
  });
}

/* Shared services block — appears in every design */
function _sharedServices() {
  return _rows('Services', [
    ['NTP Primary',            '', '10.0.0.1/32',   'Network Time Protocol primary',   'Prefer; key 1 MD5'],
    ['NTP Secondary',          '', '10.0.0.2/32',   'Network Time Protocol secondary',  'Key 1 MD5'],
    ['TACACS+ Primary',        '', '10.0.0.101/32', 'AAA auth/authz/accounting',        'Shared key in configgen'],
    ['TACACS+ Secondary',      '', '10.0.0.102/32', 'AAA failover',                     'Shared key in configgen'],
    ['SNMP Trap Receiver',     '', '10.0.0.200/32', 'SNMPv3 priv trap destination',     'UDP 162'],
    ['Syslog Server',          '', '10.0.0.201/32', 'RFC 5424 syslog',                  'UDP/TCP 514'],
    ['gNMI / Telemetry Collector','','10.0.0.210/32','Streaming telemetry',             'Port 57500 gRPC'],
    ['DHCP / RADIUS / ISE',    '', '10.0.0.100/32', 'DHCP relay target; 802.1X auth',  'auth-port 1812'],
  ]);
}

/* ── Campus / Hybrid plan ──────────────────────────────────────────── */
function _campusPlan(state) {
  var numDist = 2, numCore = 1;
  try {
    if (typeof estimateCounts === 'function') {
      numDist = estimateCounts('campus-dist') || 2;
      numCore = estimateCounts('campus-core') || 1;
    }
  } catch(e) {}

  var rows = [];

  /* VLANs and user subnets */
  rows = rows.concat(_rows('User VLANs', [
    ['VLAN 10 — Management',   '10', '10.0.0.0/24',    'OOB device management',           'GW/HSRP VIP 10.0.0.1; devices 10.0.0.30+'],
    ['VLAN 20 — Corp Data',    '20', '10.10.0.0/22',   'Corporate user hosts',            'HSRP VIP 10.10.0.254; DHCP relay 10.0.0.100'],
    ['VLAN 21 — Campus Servers','21','10.21.0.0/24',   'On-campus servers',               'Static or DHCP'],
    ['VLAN 30 — Voice',        '30', '10.20.0.0/23',   'IP phones, UCM, CUCM',            'HSRP VIP 10.20.0.254; CDP/LLDP'],
    ['VLAN 40 — Wireless Corp','40', '10.30.0.0/22',   'Wireless corp SSID / IoT',        'HSRP VIP 10.30.0.254'],
    ['VLAN 41 — Guest',        '41', '10.41.0.0/22',   'Guest Wi-Fi (internet-only ACL)', 'Isolated; NAT at FW'],
    ['VLAN 50 — AP Mgmt',      '50', '10.50.0.0/24',   'AP management VLAN',              ''],
    ['VLAN 99 — Native/Trunk', '99', '',               'Native VLAN on trunk ports',      'No IP; BPDUs untagged'],
  ]));

  /* HSRP VIPs */
  rows = rows.concat(_rows('HSRP / FHRP VIPs', [
    ['VLAN 10 GW (HSRP)',  '',  '10.0.0.1/24',     'Mgmt gateway — Dist-01 active',   'Priority 110; md5 key'],
    ['VLAN 20 GW (HSRP)',  '',  '10.10.0.254/22',  'Corp data gateway',               'Priority 110; md5 key'],
    ['VLAN 30 GW (HSRP)',  '',  '10.20.0.254/23',  'Voice gateway',                   'Sub-second timers'],
    ['VLAN 40 GW (HSRP)',  '',  '10.30.0.254/22',  'Wireless/IoT gateway',            ''],
  ]));

  /* Loopbacks */
  var loRows = [];
  for (var c = 0; c < Math.max(numCore, 1); c++) {
    loRows.push(['Core-' + String(c+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.0.' + (20+c) + '/32', 'OSPF RID; BGP source; PIM RP candidate', '']);
  }
  for (var d = 0; d < Math.max(numDist, 2); d++) {
    loRows.push(['Dist-' + String(d+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.0.' + (20+numCore+d) + '/32', 'OSPF RID; BGP source', '']);
  }
  rows = rows.concat(_rows('Loopbacks', loRows));

  /* Distribution SVIs (real IPs, not VIP) */
  rows = rows.concat(_rows('Distribution SVIs', [
    ['Dist-01 Vlan10',  '10', '10.0.0.253/24',  'Mgmt SVI — HSRP standby',   ''],
    ['Dist-02 Vlan10',  '10', '10.0.0.254/24',  'Mgmt SVI — HSRP active',    'idx=1 → priority 110'],
    ['Dist-01 Vlan20',  '20', '10.10.0.1/22',   'Corp data SVI Dist-01',     'HSRP standby'],
    ['Dist-02 Vlan20',  '20', '10.10.1.1/22',   'Corp data SVI Dist-02',     'HSRP active (priority 110)'],
    ['Dist-01 Vlan30',  '30', '10.20.0.1/23',   'Voice SVI Dist-01',         ''],
    ['Dist-02 Vlan30',  '30', '10.20.1.1/23',   'Voice SVI Dist-02',         ''],
    ['Dist-01 Vlan40',  '40', '10.30.0.1/22',   'Wireless SVI Dist-01',      ''],
    ['Dist-02 Vlan40',  '40', '10.30.1.1/22',   'Wireless SVI Dist-02',      ''],
  ]));

  /* P2P infrastructure links */
  rows = rows.concat(_rows('Infrastructure P2P Links (/31)', [
    ['Core → FW uplink',     '', '10.0.0.0/30',    'Routed uplink to firewall',        '10.0.0.2 = Core side'],
    ['Core TenGig2/1 ↔ Dist-01', '', '10.100.0.0/31', 'Core downlink to Dist-01',    '.0 = Core, .1 = Dist'],
    ['Core TenGig2/2 ↔ Dist-02', '', '10.100.0.2/31', 'Core downlink to Dist-02',    '.2 = Core, .3 = Dist'],
    ['Core TenGig2/3 ↔ Dist-03', '', '10.100.0.4/31', 'Core downlink to Dist-03',    '.4 = Core, .5 = Dist'],
    ['Core TenGig2/4 ↔ Dist-04', '', '10.100.0.6/31', 'Core downlink to Dist-04',    '.6 = Core, .7 = Dist'],
    ['Dist P2P block',       '', '10.100.0.0/24', 'All core↔dist P2P links',          'OSPF area 0'],
  ]));

  /* Routing */
  rows = rows.concat(_rows('Routing', [
    ['OSPF Process',     '', '',  'Area 0 (backbone)',     'MD5 auth; passive-interface default; no-passive on uplinks'],
    ['OSPF Area 0 range','', '10.100.0.0/24', 'Infrastructure P2P links',    'network statement'],
    ['OSPF Area 0 range','', '10.255.0.0/24', 'Loopback addresses',          'network statement'],
    ['OSPF Area 0 range','', '10.0.0.0/16',  'User VLANs / SVIs',           'network statement'],
    ['BGP ASN',          '', '65000',         'iBGP campus AS',              'RR on core routers'],
    ['PIM RP',           '', '10.255.0.20',  'PIM Sparse-Mode RP (Core-01)','send-rp-announce on core-01'],
    ['Multicast Range',  '', '224.0.0.0/4',  'All multicast groups',         'group-list in PIM config'],
    ['EIGRP AS (alt.)',  '', '100',           'EIGRP AS if EIGRP selected',  'HMAC-SHA-256 auth'],
  ]));

  rows = rows.concat(_sharedServices());
  return rows;
}

/* ── DC Fabric plan ────────────────────────────────────────────────── */
function _dcPlan(state) {
  var numSpines = 2, numLeaves = 4;
  try {
    if (typeof estimateCounts === 'function') {
      numSpines = estimateCounts('dc-spine') || 2;
      numLeaves = estimateCounts('dc-leaf')  || 4;
    }
  } catch(e) {}

  var hasVxlan = (state.overlayProto || []).some(function(o){ return o.includes('VXLAN'); });
  var rows = [];

  /* Loopbacks */
  var loRows = [];
  for (var s = 0; s < numSpines; s++) {
    loRows.push(['Spine-' + String(s+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.1.' + (s+1) + '/32', 'BGP RID; IS-IS NET; route-reflector source', 'ASN 65000']);
    if (hasVxlan) {
      loRows.push(['Spine-' + String(s+1).padStart(2,'0') + ' Loopback1 (VTEP)', '',
        '10.255.3.' + (100+s+1) + '/32', 'Anycast VTEP source for EVPN spines', 'NVE/VXLAN']);
    }
  }
  for (var l = 0; l < numLeaves; l++) {
    loRows.push(['Leaf-' + String(l+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.2.' + (l+1) + '/32', 'BGP RID; IS-IS NET; OSPF RID', 'ASN ' + (65001+l)]);
    if (hasVxlan) {
      loRows.push(['Leaf-' + String(l+1).padStart(2,'0') + ' Loopback1 (VTEP)', '',
        '10.255.3.' + (l+1) + '/32', 'VTEP / NVE source IP', 'VXLAN tunnel endpoint']);
    }
  }
  rows = rows.concat(_rows('Loopbacks', loRows));

  /* BGP ASNs */
  var asnRows = [['Spine ASN', '', '65000', 'eBGP spine AS (route-reflector in iBGP variant)', '']];
  for (var ll = 0; ll < numLeaves; ll++) {
    asnRows.push(['Leaf-' + String(ll+1).padStart(2,'0') + ' ASN', '', String(65001+ll), 'eBGP leaf AS', '']);
  }
  rows = rows.concat(_rows('BGP ASNs', asnRows));

  /* Fabric P2P links */
  var p2pRows = [];
  for (var si = 0; si < numSpines; si++) {
    for (var li = 0; li < numLeaves; li++) {
      var base = si * 8 + li * 2;
      p2pRows.push([
        'Spine-' + String(si+1).padStart(2,'0') + ' ↔ Leaf-' + String(li+1).padStart(2,'0'),
        '', '10.1.0.' + base + '/31',
        'eBGP underlay P2P link',
        'Spine .even, Leaf .odd'
      ]);
    }
  }
  p2pRows.push(['Fabric /31 block', '', '10.1.0.0/24', 'All fabric P2P links', 'MTU 9216 jumbo frames']);
  rows = rows.concat(_rows('Fabric P2P Links (/31)', p2pRows));

  /* Overlay / VXLAN */
  if (hasVxlan) {
    rows = rows.concat(_rows('VXLAN Overlay', [
      ['VLAN 100 — Tenant-A L2',    '100', '',           'VXLAN L2 segment Tenant-A',      'L2VNI 100000'],
      ['VLAN 101 — Tenant-B L2',    '101', '',           'VXLAN L2 segment Tenant-B',      'L2VNI 100001'],
      ['L2VNI Tenant-A',             '',   '100000',     'VNI for VLAN 100',                'encapsulation vxlan'],
      ['L2VNI Tenant-B',             '',   '100001',     'VNI for VLAN 101',                'encapsulation vxlan'],
      ['L3VNI Tenant-A',             '',   '999000',     'VXLAN L3 gateway VNI (TENANT-A)', 'vrf context TENANT-A'],
      ['L3VNI Tenant-B',             '',   '999001',     'VXLAN L3 gateway VNI (TENANT-B)', 'vrf context TENANT-B'],
      ['Anycast GW Tenant-A',        '',   '10.200.0.1/22', 'Virtual IP for Tenant-A hosts', 'IRB / ip address virtual'],
      ['Anycast GW Tenant-B',        '',   '10.200.4.1/22', 'Virtual IP for Tenant-B hosts', 'IRB / ip address virtual'],
      ['IRB block Tenant-A',         '',   '10.200.0.0/22', 'Per-leaf IRB addresses',        'Leaf-N: 10.200.0.N+1/22'],
      ['IRB block Tenant-B',         '',   '10.200.4.0/22', 'Per-leaf IRB addresses',        'Leaf-N: 10.200.4.N+1/22'],
    ]));
  }

  /* MLAG (EOS) */
  rows = rows.concat(_rows('MLAG Peer-Link (EOS)', [
    ['MLAG Peer VLAN',  '4094', '',            'MLAG keepalive VLAN',          'trunk group MLAG-PEER-LINK'],
    ['MLAG Pair-1 SVIs','4094', '10.254.0.0/30','Leaf-01 .1 ↔ Leaf-02 .2',   'Vlan4094 no autostate'],
    ['MLAG Pair-2 SVIs','4094', '10.254.1.0/30','Leaf-03 .1 ↔ Leaf-04 .2',   'domain-id DC-MLAG-PAIR-2'],
    ['MLAG Pair-3 SVIs','4094', '10.254.2.0/30','Leaf-05 .1 ↔ Leaf-06 .2',   ''],
  ]));

  rows = rows.concat(_sharedServices());
  return rows;
}

/* ── GPU Cluster plan ──────────────────────────────────────────────── */
function _gpuPlan(state) {
  var numSpines = 2, numTOR = 4;
  try {
    if (typeof estimateCounts === 'function') {
      numSpines = estimateCounts('gpu-spine') || 2;
      numTOR    = estimateCounts('gpu-tor')   || 4;
    }
  } catch(e) {}

  var rows = [];

  var loRows = [];
  for (var s = 0; s < numSpines; s++) {
    loRows.push(['GPU-SPINE-' + String(s+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.5.' + (s+1) + '/32', 'BGP RID; IS-IS NET', 'ASN 65000']);
  }
  for (var t = 0; t < numTOR; t++) {
    loRows.push(['GPU-TOR-' + String(t+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.6.' + (t+1) + '/32', 'BGP RID', 'ASN ' + (65001+t)]);
  }
  rows = rows.concat(_rows('Loopbacks', loRows));

  /* Fabric links — same /31 scheme as DC */
  var p2pRows = [];
  for (var si = 0; si < numSpines; si++) {
    for (var ti = 0; ti < numTOR; ti++) {
      p2pRows.push([
        'SPINE-' + String(si+1).padStart(2,'0') + ' ↔ TOR-' + String(ti+1).padStart(2,'0'),
        '', '10.1.0.' + (si*8 + ti*2) + '/31',
        'eBGP underlay', 'MTU 9100 RoCEv2'
      ]);
    }
  }
  rows = rows.concat(_rows('Fabric P2P Links (/31)', p2pRows));

  rows = rows.concat(_rows('RoCEv2 / Lossless', [
    ['Lossless VLAN (RoCEv2)',   '1',  '',            'RoCEv2 lossless class',           'DSCP 26; PFC priority 3'],
    ['PFC Priority 3',           '',   '',            'Priority Flow Control — RoCEv2',  'buffer-profile lossless'],
    ['ECN Threshold',            '',   '',            'WRED / ECN min 150 KB, max 1 MB', 'fabric / TOR config'],
    ['GPU Mgmt block',           '',   '10.0.0.0/24', 'GPU node OOB management',         '10.0.0.30+ device IPs'],
  ]));

  rows = rows.concat(_sharedServices());
  return rows;
}

/* ── WAN plan ──────────────────────────────────────────────────────── */
function _wanPlan(state) {
  var numBranch = 3;
  try {
    if (typeof estimateCounts === 'function') numBranch = estimateCounts('campus-access') || 3;
  } catch(e) {}

  var rows = [];

  var loRows = [
    ['HQ Hub-01 Loopback0', '', '10.255.0.1/32', 'DMVPN hub NHRP source; OSPF RID', 'GRE tunnel source'],
    ['HQ Hub-02 Loopback0', '', '10.255.0.2/32', 'Redundant hub', ''],
  ];
  for (var b = 0; b < Math.min(numBranch, 8); b++) {
    loRows.push(['Branch-' + String(b+1).padStart(2,'0') + ' Loopback0', '',
      '10.255.0.' + (10+b) + '/32', 'DMVPN spoke NHRP source; OSPF RID', '']);
  }
  rows = rows.concat(_rows('Loopbacks', loRows));

  rows = rows.concat(_rows('DMVPN / GRE Overlay', [
    ['DMVPN Tunnel0 Subnet', '',  '172.16.0.0/24', 'Hub/spoke mGRE tunnel subnet',    'Phase 3; NHRP shortcut'],
    ['Hub Tunnel0 IP',       '',  '172.16.0.1/24', 'DMVPN hub NHRP NHS',              'NHRP multicast dynamic'],
    ['Branch Tunnel0 block', '',  '172.16.0.0/24', 'Branches get NHRP-assigned IPs',  'IKEv2 keyring auth'],
    ['Hub NHRP Net-ID',      '',  '1',             'NHRP network-id',                 'All sites same ID'],
    ['Hub BGP ASN',          '',  '65001',         'WAN iBGP or eBGP AS',             'default-information originate'],
    ['ISP WAN (Hub)',        '',  'DHCP',          'ISP-assigned WAN IPs',            'ip address dhcp on Gi0/0-1'],
    ['ISP WAN (Branch)',     '',  'DHCP',          'ISP-assigned WAN IPs',            'ip address dhcp on Gi0/0'],
  ]));

  var lanRows = [
    ['HQ LAN',          '', '10.0.0.0/22',  'HQ users + servers', 'Vlan20 10.0.0.x'],
    ['HQ Voice',        '', '10.0.4.0/23',  'HQ voice/UCM',       'Vlan30'],
  ];
  for (var bb = 0; bb < Math.min(numBranch, 8); bb++) {
    lanRows.push(['Branch-' + String(bb+1).padStart(2,'0') + ' LAN', '',
      '192.168.' + (100+bb) + '.0/24', 'Branch local users', 'DHCP server on CPE']);
  }
  rows = rows.concat(_rows('LAN Subnets', lanRows));

  rows = rows.concat(_rows('Routing', [
    ['OSPF Process',    '', '',      'Area 0 — all WAN routers', 'default-information originate always on hub'],
    ['BGP eBGP to ISP', '', '65001', 'Hub eBGP toward ISP',     'prefix-list DENY-RFC1918-OUT on WAN uplink'],
    ['IP SLA 1',        '', '',      'ISP-1 reachability track', 'track 1 → ip route 0.0.0.0 via ISP-1'],
    ['IP SLA 2',        '', '',      'ISP-2 reachability track', 'track 2 → ip route 0.0.0.0 via ISP-2'],
    ['NAT Pool',        '', '',      'PAT (overload) at each site', 'ip nat inside/outside on WAN/LAN'],
  ]));

  rows = rows.concat(_sharedServices());
  return rows;
}

/* ── Multi-Site DCI plan ────────────────────────────────────────────── */
function _multisitePlan(state) {
  var rows = _dcPlan(state);  /* inherits full DC plan */

  rows = rows.concat(_rows('Multi-Site DCI / BGW', [
    ['Site DCA BGW ASN',    '', '65100', 'DC-A border gateway AS',          'eBGP to remote sites'],
    ['Site DCB BGW ASN',    '', '65200', 'DC-B border gateway AS',          ''],
    ['Site DCC BGW ASN',    '', '65300', 'DC-C border gateway AS',          ''],
    ['Site DCD BGW ASN',    '', '65400', 'DC-D border gateway AS',          ''],
    ['DCI P2P block',       '', '10.201.0.0/24', 'All inter-site DCI /31 links',  '6 site-pairs × 2 spines'],
    ['DCI link DCA↔DCB (Sp1)', '', '10.201.0.0/31',  'DCA Spine-01 ↔ DCB Spine-01', '.0=DCA, .1=DCB'],
    ['DCI link DCA↔DCB (Sp2)', '', '10.201.0.2/31',  'DCA Spine-02 ↔ DCB Spine-02', ''],
    ['DCI link DCA↔DCC (Sp1)', '', '10.201.0.4/31',  'DCA Spine-01 ↔ DCC Spine-01', ''],
    ['DCI link DCA↔DCC (Sp2)', '', '10.201.0.6/31',  'DCA Spine-02 ↔ DCC Spine-02', ''],
    ['DCI link DCA↔DCD (Sp1)', '', '10.201.0.8/31',  'DCA ↔ DCD Spine-01',          ''],
    ['DCI link DCB↔DCC (Sp1)', '', '10.201.0.16/31', 'DCB ↔ DCC Spine-01',          ''],
    ['DCI link DCB↔DCD (Sp1)', '', '10.201.0.20/31', 'DCB ↔ DCD Spine-01',          ''],
    ['DCI link DCC↔DCD (Sp1)', '', '10.201.0.24/31', 'DCC ↔ DCD Spine-01',          ''],
    ['BGW Loopback block',  '', '10.201.254.0/24', 'BGW router-id loopbacks',        'Site 0/1/2/3 × spine 0/1'],
    ['EVPN multisite',      '', '',               'EVPN Multi-Site BGW — NX-OS',     'evpn multisite border-gateway'],
  ]));

  return rows;
}

/* ── Multicloud plan ────────────────────────────────────────────────── */
function _multicloudPlan(state) {
  var rows = [];

  rows = rows.concat(_rows('DC Edge', [
    ['DC-EAST Edge Loopback',  '', '10.255.0.1/32',  'DC edge router RID',           'iBGP source'],
    ['DC-WEST Edge Loopback',  '', '10.255.0.2/32',  'DC edge router RID',           ''],
    ['Corp CIDR',              '', state.mcOrgCidr || '10.0.0.0/9', 'Enterprise address space', 'Advertised to clouds'],
    ['Enterprise BGP ASN',     '', String(state.mcEnterpriseAsn || 65000), 'On-prem AS', 'eBGP to cloud transit'],
  ]));

  rows = rows.concat(_rows('Cloud Transit', [
    ['AWS Transit Gateway', '', '10.100.0.0/24', 'AWS VPC attachment range', 'us-east-1 TGW'],
    ['Azure ExpressRoute',  '', '10.101.0.0/24', 'Azure GatewaySubnet range', 'VNG private peering'],
    ['GCP Cloud Router',    '', '10.102.0.0/24', 'GCP VPN/Interconnect range', 'BGP AS 16550'],
    ['Aviatrix Transit (if selected)', '', '10.200.0.0/16', 'Aviatrix transit VPC CIDR', 'insane mode HPE'],
  ]));

  rows = rows.concat(_sharedServices());
  return rows;
}

/* ── Dispatcher ─────────────────────────────────────────────────────── */
function genIPAddressPlan(state) {
  var uc = (state && state.uc) || 'campus';
  switch (uc) {
    case 'campus':     return _campusPlan(state);
    case 'hybrid':     return _campusPlan(state).concat(_dcPlan(state));
    case 'dc':         return _dcPlan(state);
    case 'gpu':        return _gpuPlan(state);
    case 'wan':        return _wanPlan(state);
    case 'multisite':  return _multisitePlan(state);
    case 'multicloud': return _multicloudPlan(state);
    default:           return _campusPlan(state);
  }
}

/* ── CSV export ─────────────────────────────────────────────────────── */
function downloadIPPlanCSV() {
  var rows = genIPAddressPlan(typeof STATE !== 'undefined' ? STATE : {});
  var uc   = (typeof STATE !== 'undefined' && STATE.uc) ? STATE.uc : 'design';
  var csv  = 'Category,Resource,VLAN,Subnet / Value,Purpose,Notes\n';
  rows.forEach(function(r) {
    csv += '"' + r.category + '","' + r.resource + '","' + r.vlan + '","' +
           r.subnet + '","' + r.purpose + '","' + r.notes + '"\n';
  });
  var blob = new Blob([csv], { type: 'text/csv' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'netdesign-ipplan-' + uc + '-' + Date.now() + '.csv';
  a.click();
  if (typeof toast === 'function') toast('IP Address Plan exported as CSV', 'success');
}

/* ── Markdown export ────────────────────────────────────────────────── */
function downloadIPPlanMarkdown() {
  var rows = genIPAddressPlan(typeof STATE !== 'undefined' ? STATE : {});
  var uc   = (typeof STATE !== 'undefined' && STATE.uc) ? STATE.uc : 'design';
  var ucLabel = (typeof UC_LABELS !== 'undefined' && UC_LABELS[uc]) ? UC_LABELS[uc] : uc;
  var md = '# Network IP Address & VLAN Plan\n\n';
  md += '**Design**: ' + ucLabel + '  \n';
  md += '**Generated**: ' + new Date().toISOString().slice(0, 10) + '  \n';
  if (typeof STATE !== 'undefined' && STATE.orgName) {
    md += '**Organization**: ' + STATE.orgName + '  \n';
  }
  md += '\n| Category | Resource | VLAN | Subnet / Value | Purpose | Notes |\n';
  md += '|----------|----------|------|----------------|---------|-------|\n';
  var lastCat = '';
  rows.forEach(function(r) {
    if (r.category !== lastCat) {
      md += '| **' + r.category + '** | | | | | |\n';
      lastCat = r.category;
    }
    md += '| | ' + r.resource + ' | ' + r.vlan + ' | `' + (r.subnet || '—') + '` | ' +
          r.purpose + ' | ' + r.notes + ' |\n';
  });
  var blob = new Blob([md], { type: 'text/markdown' });
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'netdesign-ipplan-' + uc + '-' + Date.now() + '.md';
  a.click();
  if (typeof toast === 'function') toast('IP Address Plan exported as Markdown', 'success');
}

/* ── Render panel ───────────────────────────────────────────────────── */
function renderIPPlanPanel() {
  var container = document.getElementById('ipplan-section');
  if (!container) return;

  var rows = genIPAddressPlan(typeof STATE !== 'undefined' ? STATE : {});
  if (!rows || rows.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  /* Group rows by category */
  var grouped = {};
  var catOrder = [];
  rows.forEach(function(r) {
    if (!grouped[r.category]) {
      grouped[r.category] = [];
      catOrder.push(r.category);
    }
    grouped[r.category].push(r);
  });

  /* Category badge colours */
  var CAT_COLOR = {
    'User VLANs':                 'var(--blue)',
    'HSRP / FHRP VIPs':          'var(--cyan)',
    'Loopbacks':                  'var(--purple)',
    'Distribution SVIs':          'var(--cyan-dim)',
    'Infrastructure P2P Links (/31)': 'var(--orange)',
    'Fabric P2P Links (/31)':     'var(--orange)',
    'BGP ASNs':                   'var(--green)',
    'VXLAN Overlay':              'var(--purple)',
    'MLAG Peer-Link (EOS)':       'var(--yellow)',
    'Routing':                    'var(--green-dim)',
    'Services':                   'var(--txt2)',
    'DMVPN / GRE Overlay':        'var(--purple)',
    'LAN Subnets':                'var(--blue)',
    'Multi-Site DCI / BGW':       'var(--orange)',
    'DC Edge':                    'var(--blue)',
    'Cloud Transit':              'var(--cyan)',
    'RoCEv2 / Lossless':          'var(--red)',
  };

  var tableRows = '';
  catOrder.forEach(function(cat) {
    var color = CAT_COLOR[cat] || 'var(--txt1)';
    tableRows += '<tr class="ipplan-cat-row"><td colspan="6">' +
      '<span class="ipplan-cat-badge" style="background:' + color + '20;color:' + color + ';border-color:' + color + '40">' +
      cat + '</span></td></tr>';
    grouped[cat].forEach(function(r) {
      var subnetHtml = r.subnet
        ? '<code class="ipplan-subnet">' + r.subnet + '</code>'
        : '<span style="color:var(--txt3)">—</span>';
      var vlanHtml = r.vlan
        ? '<span class="ipplan-vlan-badge">' + r.vlan + '</span>'
        : '';
      tableRows +=
        '<tr class="ipplan-row">' +
        '<td class="ipplan-resource">' + r.resource + '</td>' +
        '<td class="ipplan-vlan">'     + vlanHtml + '</td>' +
        '<td class="ipplan-subnet-td">' + subnetHtml + '</td>' +
        '<td class="ipplan-purpose">'  + r.purpose + '</td>' +
        '<td class="ipplan-notes">'    + r.notes + '</td>' +
        '</tr>';
    });
  });

  container.innerHTML =
    '<div class="section-toggle-hdr" onclick="var b=this.nextElementSibling;' +
      'b.style.display=b.style.display===\'none\'?\'\':\'none\';' +
      'this.querySelector(\'.toggle-caret\').textContent=b.style.display===\'\'?\'▼\':\'▶\'">' +
      '<span>🗂️ IP Address & VLAN Allocation Plan</span>' +
      '<span class="toggle-caret">▼</span>' +
    '</div>' +
    '<div>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin:.5rem 0 .75rem">' +
        '<button class="btn-cfg-action" onclick="downloadIPPlanCSV()">⬇ IP Plan CSV</button>' +
        '<button class="btn-cfg-action" onclick="downloadIPPlanMarkdown()">⬇ IP Plan Markdown</button>' +
      '</div>' +
      '<div class="ipplan-table-wrap">' +
        '<table class="ipplan-table">' +
          '<thead><tr>' +
            '<th>Resource</th>' +
            '<th>VLAN</th>' +
            '<th>Subnet / Value</th>' +
            '<th>Purpose</th>' +
            '<th>Notes</th>' +
          '</tr></thead>' +
          '<tbody>' + tableRows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<p class="ipplan-footnote">⚠ These addresses match the values hard-coded in the generated device configs. ' +
      'Modify <em>configgen.js</em> if you need a different addressing scheme, then re-export.</p>' +
    '</div>';
}

window.genIPAddressPlan      = genIPAddressPlan;
window.renderIPPlanPanel     = renderIPPlanPanel;
window.downloadIPPlanCSV     = downloadIPPlanCSV;
window.downloadIPPlanMarkdown = downloadIPPlanMarkdown;
