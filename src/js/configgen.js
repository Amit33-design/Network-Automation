'use strict';

// ─── Design derivation helpers ────────────────────────────────────────────────

function _leafDesign(dev, state) {
  var unit     = dev.unit || 1;
  var pairIdx  = Math.floor((unit - 1) / 2); // 0-based leaf-pair index (HA pairs)

  var leafAsn  = 65100 + pairIdx;   // unique eBGP ASN per leaf pair
  var spineAsn = 65000;
  var lo0ip    = '10.0.0.' + unit;  // BGP router-id / loopback0
  var lo1ip    = '10.1.0.' + unit;  // VTEP loopback1

  // Spine P2P peer IPs and hostnames
  var spines = (state.devices || []).filter(function(d) { return d.subLayer === 'spine'; });
  var spinePeerIps  = [];
  var spineHostnames = [];
  if (spines.length) {
    spines.forEach(function(sp, idx) {
      // /31 blocks: 192.168.{leaf_unit * 10 + idx * 2}.{0 = spine side, 1 = leaf side}
      spinePeerIps.push('192.168.' + (unit * 10 + idx * 2) + '.0');
      spineHostnames.push(sp.hostname || ('SPINE-' + (idx + 1)));
    });
  } else {
    spinePeerIps  = ['10.100.0.1', '10.100.0.2'];
    spineHostnames = ['SPINE-01', 'SPINE-02'];
  }

  // VNI design (per CLAUDE.md §8)
  var vlanId   = 10;
  var l2vni    = 10000 + vlanId;           // 10010
  var l3vni    = 50000 + (pairIdx + 1);    // 50001, 50002, …
  var l3VlanId = 3000  + (pairIdx + 1);    // transit VLAN for L3VNI
  var vrfName  = 'PROD';
  var anycastGw = '10.10.' + unit + '.1';
  var prefix    = '24';

  // BGP timers from CLAUDE.md §10: DC aggressive (3/9) unless WAN
  var useCase   = state.useCase || 'dc';
  var keepalive = (useCase === 'wan') ? 10 : 3;
  var hold      = (useCase === 'wan') ? 30 : 9;

  return {
    leafAsn: leafAsn, spineAsn: spineAsn,
    lo0ip: lo0ip, lo1ip: lo1ip,
    spinePeerIps: spinePeerIps, spineHostnames: spineHostnames,
    vlanId: vlanId, l2vni: l2vni, l3vni: l3vni, l3VlanId: l3VlanId,
    vrfName: vrfName, anycastGw: anycastGw, prefix: prefix,
    keepalive: keepalive, hold: hold
  };
}

// ─── NX-OS Spine ─────────────────────────────────────────────────────────────

function nxosSpineConfig(dev, state) {
  var hn      = dev.hostname;
  var spineAsn = 65000;
  var unit    = dev.unit || 1;
  var lo0ip   = '10.0.0.' + (100 + unit); // spines in 10.0.0.101+

  var lines = [
    '! ' + hn + ' — Cisco NX-OS Spine',
    'hostname ' + hn,
    'feature bgp',
    'feature nv overlay',
    'feature vn-segment-vlan-based',
    'feature interface-vlan',
    'nv overlay evpn',
    '',
    'interface loopback0',
    '  ip address ' + lo0ip + '/32',
    '  description BGP router-id',
    '',
    'router bgp ' + spineAsn,
    '  router-id ' + lo0ip,
    '  bestpath as-path multipath-relax',   // G-13: required for eBGP CLOS ECMP
    '  bestpath compare-routerid',
    '  address-family l2vpn evpn',
    '    retain route-target all',
    '  template peer LEAFS',
    '    update-source loopback0',
    '    timers 3 9',                       // DC aggressive (§10)
    '    advertisement-interval 0',
    '    bfd',
    '    send-community extended',
    '    address-family ipv4 unicast',
    '      maximum-prefix 12000 warning-only',
    '    address-family l2vpn evpn',
    '      send-community extended',
    '      route-reflector-client',
    '  ! Add leaf neighbors — inherit peer LEAFS per leaf loopback',
  ];

  return lines.join('\n') + '\n';
}

// ─── NX-OS Leaf — complete per CLAUDE.md §8 ──────────────────────────────────

function nxosLeafConfig(dev, state) {
  var hn = dev.hostname;
  var d  = _leafDesign(dev, state);

  var lines = [
    '! ' + hn + ' — Cisco NX-OS Leaf',
    'hostname ' + hn,
    '',
    'feature bgp',
    'feature nv overlay',
    'feature vn-segment-vlan-based',
    'feature interface-vlan',
    'feature lacp',
    'feature vpc',
    'nv overlay evpn',
    '',
    '! --- Loopbacks ---',
    'interface loopback0',
    '  ip address ' + d.lo0ip + '/32',
    '  description BGP router-id',
    'interface loopback1',
    '  ip address ' + d.lo1ip + '/32',
    '  description VTEP source',
    '',
    '! --- Per VLAN (VNI design) ---',
    'vlan ' + d.vlanId,
    '  name SERVERS',
    '  vn-segment ' + d.l2vni,
    'vlan ' + d.l3VlanId,
    '  name L3VNI-' + d.vrfName + '-transit',
    '  vn-segment ' + d.l3vni,
    '',
    '! --- NVE interface ---',
    'interface nve1',
    '  no shutdown',
    '  host-reachability protocol bgp',
    '  source-interface loopback1',
    '  member vni ' + d.l2vni,
    '    ingress-replication protocol bgp',
    '  member vni ' + d.l3vni + ' associate-vrf',
    '',
    '! --- VRF ---',
    'vrf context ' + d.vrfName,
    '  vni ' + d.l3vni,
    '  rd auto',
    '  address-family ipv4 unicast',
    '    route-target both auto evpn',
    '',
    '! --- SVIs ---',
    'interface Vlan' + d.vlanId,
    '  no shutdown',
    '  vrf member ' + d.vrfName,
    '  ip address ' + d.anycastGw + '/' + d.prefix,
    '  fabric forwarding mode anycast-gateway',
    '',
    'interface Vlan' + d.l3VlanId + '   ! transit VLAN for L3VNI',
    '  no shutdown',
    '  vrf member ' + d.vrfName,
    '  ip forward',
    '',
    '! --- BGP ---',
    'router bgp ' + d.leafAsn,
    '  router-id ' + d.lo0ip,
    '  bestpath as-path multipath-relax',   // G-13
    '  bestpath compare-routerid',
    '  address-family l2vpn evpn',
    '    advertise-pip',
    '  template peer SPINES',
    '    remote-as ' + d.spineAsn,
    '    timers ' + d.keepalive + ' ' + d.hold + '   ! DC: 3 9 | WAN: 10 30',
    '    advertisement-interval 0',
    '    bfd',
    '    send-community extended',
    '    address-family ipv4 unicast',
    '      maximum-prefix 12000 warning-only',
    '    address-family l2vpn evpn',
    '      send-community extended',
  ];

  // Per-spine neighbor stanzas
  d.spinePeerIps.forEach(function(ip, idx) {
    lines.push('  neighbor ' + ip);
    lines.push('    inherit peer SPINES');
    lines.push('    description ' + d.spineHostnames[idx]);
  });

  lines = lines.concat([
    '  vrf ' + d.vrfName,
    '    address-family ipv4 unicast',
    '      redistribute direct route-map RMAP-CONNECTED',
    '      maximum-paths 8',
    '',
    '! --- EVPN section ---',
    'evpn',
    '  vni ' + d.l2vni + ' l2',
    '    rd auto',
    '    route-target import auto',
    '    route-target export auto',
  ]);

  return lines.join('\n') + '\n';
}

// ─── Arista EOS Spine ────────────────────────────────────────────────────────

function aristaSpineConfig(dev, state) {
  var hn   = dev.hostname;
  var unit = dev.unit || 1;
  var lo0  = '10.0.0.' + (100 + unit);

  return [
    '! ' + hn + ' — Arista EOS Spine',
    'hostname ' + hn,
    '',
    'service routing protocols model multi-agent',
    '',
    'ip routing',
    '',
    'interface Loopback0',
    '   ip address ' + lo0 + '/32',
    '   description BGP router-id',
    '',
    'router bgp 65000',
    '   router-id ' + lo0,
    '   bgp asn notation asdot',
    '   bgp bestpath as-path multipath-relax',    // G-13
    '   neighbor LEAF-PEERS peer group',
    '   neighbor LEAF-PEERS send-community extended',
    '   neighbor LEAF-PEERS bfd',
    '   neighbor LEAF-PEERS timers 3 9',           // DC aggressive (§10)
    '   neighbor LEAF-PEERS advertisement-interval 0',
    '   bgp listen range 10.0.0.0/16 peer-group LEAF-PEERS',
    '   address-family evpn',
    '      neighbor LEAF-PEERS activate',
    '      neighbor LEAF-PEERS route-map RM-EVPN-SOO out',
    '   address-family ipv4',
    '      neighbor LEAF-PEERS activate',
    '      neighbor LEAF-PEERS next-hop-unchanged',
  ].join('\n') + '\n';
}

// ─── Arista EOS Leaf ─────────────────────────────────────────────────────────

function aristaLeafConfig(dev, state) {
  var hn = dev.hostname;
  var d  = _leafDesign(dev, state);

  var lines = [
    '! ' + hn + ' — Arista EOS Leaf',
    'hostname ' + hn,
    '',
    'service routing protocols model multi-agent',
    '',
    'ip routing',
    'ip routing vrf ' + d.vrfName,
    '',
    'interface Loopback0',
    '   ip address ' + d.lo0ip + '/32',
    '   description BGP router-id',
    'interface Loopback1',
    '   ip address ' + d.lo1ip + '/32',
    '   description VTEP source',
    '',
    'vlan ' + d.vlanId,
    '   name SERVERS',
    '',
    'vrf instance ' + d.vrfName,
    '',
    'interface Vlan' + d.vlanId,
    '   vrf ' + d.vrfName,
    '   ip address virtual ' + d.anycastGw + '/' + d.prefix,
    '',
    'interface Vxlan1',
    '   vxlan source-interface Loopback1',
    '   vxlan udp-port 4789',
    '   vxlan vlan ' + d.vlanId + ' vni ' + d.l2vni,
    '   vxlan vrf ' + d.vrfName + ' vni ' + d.l3vni,
    '',
    'router bgp ' + d.leafAsn,
    '   router-id ' + d.lo0ip,
    '   bgp bestpath as-path multipath-relax',    // G-13
    '   neighbor SPINES peer group',
    '   neighbor SPINES remote-as ' + d.spineAsn,
    '   neighbor SPINES bfd',
    '   neighbor SPINES timers ' + d.keepalive + ' ' + d.hold,
    '   neighbor SPINES advertisement-interval 0',
    '   neighbor SPINES send-community extended',
    '   neighbor SPINES maximum-routes 12000 warning-only',
  ];

  d.spinePeerIps.forEach(function(ip, idx) {
    lines.push('   neighbor ' + ip + ' peer group SPINES');
    lines.push('   neighbor ' + ip + ' description ' + d.spineHostnames[idx]);
  });

  lines = lines.concat([
    '   address-family evpn',
    '      neighbor SPINES activate',
    '   address-family ipv4',
    '      neighbor SPINES activate',
    '      network ' + d.lo0ip + '/32',
    '      network ' + d.lo1ip + '/32',
    '   vlan ' + d.vlanId,
    '      rd auto',
    '      route-target both auto',
    '      redistribute learned',
    '   vrf ' + d.vrfName,
    '      rd ' + d.lo0ip + ':' + d.l3vni,
    '      route-target import evpn ' + d.spineAsn + ':' + d.l3vni,
    '      route-target export evpn ' + d.spineAsn + ':' + d.l3vni,
    '      redistribute connected',
    '      maximum-paths 8',
  ]);

  return lines.join('\n') + '\n';
}

// ─── Juniper QFX Leaf ────────────────────────────────────────────────────────

function juniperLeafConfig(dev, state) {
  var hn = dev.hostname;
  var d  = _leafDesign(dev, state);

  var lines = [
    '# ' + hn + ' — Juniper QFX Leaf',
    'set system host-name ' + hn,
    '',
    '# Loopbacks',
    'set interfaces lo0 unit 0 family inet address ' + d.lo0ip + '/32 primary',
    'set interfaces lo0 unit 1 family inet address ' + d.lo1ip + '/32',
    '',
    '# BGP — eBGP to spines',
    'set protocols bgp group SPINES type external',
    'set protocols bgp group SPINES local-address ' + d.lo0ip,
    'set protocols bgp group SPINES export LOOPBACKS',
    'set protocols bgp group SPINES peer-as ' + d.spineAsn,
    'set protocols bgp group SPINES multipath multiple-as',      // G-13
    'set protocols bgp group SPINES bfd-liveness-detection minimum-interval 300 multiplier 3',
    'set protocols bgp group SPINES hold-time ' + d.hold,
    'set protocols bgp group SPINES keep ' + d.keepalive,
  ];

  d.spinePeerIps.forEach(function(ip) {
    lines.push('set protocols bgp group SPINES neighbor ' + ip);
  });

  lines = lines.concat([
    '',
    '# EVPN',
    'set protocols evpn encapsulation vxlan',
    'set protocols evpn extended-vni-list all',
    'set protocols evpn default-gateway advertise',
    '',
    '# VRF',
    'set routing-instances ' + d.vrfName + ' instance-type vrf',
    'set routing-instances ' + d.vrfName + ' vrf-target target:' + d.spineAsn + ':' + d.l3vni,
    'set routing-instances ' + d.vrfName + ' vrf-table-label',
    '',
    '# VTEP',
    'set switch-options vtep-source-interface lo0.1',
    'set switch-options vrf-target target:' + d.spineAsn + ':' + d.l2vni,
    '',
    '# VLAN to VNI mapping',
    'set vlans SERVERS vlan-id ' + d.vlanId,
    'set vlans SERVERS vxlan vni ' + d.l2vni,
  ]);

  return lines.join('\n') + '\n';
}

// ─── Generic fallback ─────────────────────────────────────────────────────────

function genericConfig(dev, state) {
  var hn = dev.hostname;
  return [
    '! ' + hn + ' — ' + dev.vendor + ' ' + (dev.subLayer || 'device'),
    'hostname ' + hn,
    '! Generated by NetDesign AI',
    '! Use case: ' + (state.useCase || 'dc'),
    '! Site: '     + (state.siteName || 'SITE'),
    '! Platform config template not yet implemented for this vendor/role.',
  ].join('\n') + '\n';
}

// ─── Vendor dispatch table ────────────────────────────────────────────────────

var VENDOR_GEN = {
  'Cisco': {
    'spine':   nxosSpineConfig,
    'leaf':    nxosLeafConfig,
    'default': genericConfig
  },
  'Arista': {
    'spine':   aristaSpineConfig,
    'leaf':    aristaLeafConfig,
    'default': genericConfig
  },
  'Juniper': {
    'leaf':    juniperLeafConfig,
    'default': genericConfig
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

function generateAllConfigs(state) {
  var configs = {};
  (state.devices || []).forEach(function(dev) {
    var vendorGens = VENDOR_GEN[dev.vendor] || {};
    var genFn      = vendorGens[dev.subLayer] || vendorGens['default'] || genericConfig;
    configs[dev.instanceId] = genFn(dev, state);
  });
  state.configs = configs;
  return configs;
}

function renderConfigViewer(state) {
  var devices = state.devices || [];
  if (!devices.length) {
    return '<p class="empty-state">No devices — complete Step 1 first.</p>';
  }

  var options = devices.map(function(dev) {
    return '<option value="' + dev.instanceId + '">' + dev.hostname + ' (' + dev.model + ')</option>';
  }).join('');

  return '<div class="config-viewer">' +
    '<div class="config-toolbar">' +
      '<select id="cfg-device-select" onchange="window.showDeviceConfig(this.value)">' +
        options +
      '</select>' +
      '<button class="btn btn-secondary" onclick="window.downloadConfig()">Download</button>' +
      '<button class="btn btn-secondary" onclick="window.downloadAllConfigs()">Download All</button>' +
    '</div>' +
    '<pre id="cfg-output" class="config-pre">' +
      (Object.values(state.configs || {})[0] || '! Select a device') +
    '</pre>' +
  '</div>';
}

window.generateAllConfigs = generateAllConfigs;
window.renderConfigViewer = renderConfigViewer;
