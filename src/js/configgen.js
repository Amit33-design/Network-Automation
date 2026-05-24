'use strict';

// ─── BGP timer presets (CLAUDE.md §10) ───────────────────────────────────────

var BGP_TIMER_PRESETS = {
  dc_aggressive: { label: 'DC Aggressive',  keepalive: 3,  hold: 9,   adv_interval: 0  },
  wan_standard:  { label: 'WAN Standard',   keepalive: 10, hold: 30,  adv_interval: 5  },
  conservative:  { label: 'Conservative',   keepalive: 60, hold: 180, adv_interval: 30 }
};

// ─── Feature helpers ──────────────────────────────────────────────────────────

function _hasFeat(state, feat) {
  return state.protocols && state.protocols.features &&
         state.protocols.features.indexOf(feat) !== -1;
}

// NX-OS: global BFD command + ECMP hash command (appended after BGP stanza)
function _nxosGlobalBfd(state) {
  if (!_hasFeat(state, 'bfd')) return '';
  var b = state.bfd || { interval: 300, min_rx: 300, multiplier: 3 };
  return '\n! --- BFD global ---\n' +
    'feature bfd\n' +
    'bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier + '\n' +
    '! Apply to each uplink: bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier + '\n';
}

// NX-OS: ECMP load-sharing hash command
function _nxosEcmpHash(state) {
  if (!_hasFeat(state, 'ecmp')) return '';
  var algo = state.ecmp && state.ecmp.hash_algorithm;
  if (algo === 'symmetric') {
    return 'ip load-sharing address symmetric\n';
  } else if (algo === 'resilient') {
    return 'ip load-sharing address source-destination port source-destination resilient\n';
  }
  return 'ip load-sharing address source-destination port source-destination\n';
}

// EOS: BFD slow-timer (per CLAUDE.md §14)
function _eosBfdSlowTimer(state) {
  if (!_hasFeat(state, 'bfd')) return '';
  var b = state.bfd || { min_rx: 300 };
  return '   bfd slow-timer ' + (b.min_rx * 10) + '\n'; // EOS slow-timer in ms; 300*10=3000ms fallback
}

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
      spinePeerIps.push('192.168.' + (unit * 10 + idx * 2) + '.0');
      spineHostnames.push(sp.hostname || ('SPINE-' + (idx + 1)));
    });
  } else {
    spinePeerIps  = ['10.100.0.1', '10.100.0.2'];
    spineHostnames = ['SPINE-01', 'SPINE-02'];
  }

  // VNI design (per CLAUDE.md §8)
  var vlanId    = 10;
  var l2vni     = 10000 + vlanId;
  var l3vni     = 50000 + (pairIdx + 1);
  var l3VlanId  = 3000  + (pairIdx + 1);
  var vrfName   = 'PROD';
  var anycastGw = '10.10.' + unit + '.1';
  var prefix    = '24';

  // BGP timers from state.bgp_timers preset (G-12 / CLAUDE.md §10)
  var timerKey = state.bgp_timers ||
    ((state.useCase === 'wan') ? 'wan_standard' : 'dc_aggressive');
  var preset    = BGP_TIMER_PRESETS[timerKey] || BGP_TIMER_PRESETS.dc_aggressive;
  var keepalive = preset.keepalive;
  var hold      = preset.hold;
  var advInt    = preset.adv_interval;

  // ECMP max-paths from state (G-10)
  var maxPaths = (state.ecmp && state.ecmp.max_paths) || 8;

  return {
    leafAsn: leafAsn, spineAsn: spineAsn,
    lo0ip: lo0ip, lo1ip: lo1ip,
    spinePeerIps: spinePeerIps, spineHostnames: spineHostnames,
    vlanId: vlanId, l2vni: l2vni, l3vni: l3vni, l3VlanId: l3VlanId,
    vrfName: vrfName, anycastGw: anycastGw, prefix: prefix,
    keepalive: keepalive, hold: hold, advInt: advInt, maxPaths: maxPaths
  };
}

// ─── NX-OS Spine ─────────────────────────────────────────────────────────────

function nxosSpineConfig(dev, state) {
  var hn       = dev.hostname;
  var spineAsn = 65000;
  var unit     = dev.unit || 1;
  var lo0ip    = '10.0.0.' + (100 + unit);

  var timerKey  = state.bgp_timers || 'dc_aggressive';
  var preset    = BGP_TIMER_PRESETS[timerKey] || BGP_TIMER_PRESETS.dc_aggressive;
  var maxPaths  = (state.ecmp && state.ecmp.max_paths) || 8;
  var hasBfd    = _hasFeat(state, 'bfd');
  var hasEcmp   = _hasFeat(state, 'ecmp');

  var lines = [
    '! ' + hn + ' — Cisco NX-OS Spine',
    'hostname ' + hn,
    'feature bgp',
    'feature nv overlay',
    'feature vn-segment-vlan-based',
    'feature interface-vlan',
  ];
  if (hasBfd) lines.push('feature bfd');
  lines = lines.concat([
    'nv overlay evpn',
    '',
    'interface loopback0',
    '  ip address ' + lo0ip + '/32',
    '  description BGP router-id',
    '',
  ]);

  // BFD global timers (G-09)
  if (hasBfd) {
    var b = state.bfd || { interval: 300, min_rx: 300, multiplier: 3 };
    lines.push('! --- BFD global ---');
    lines.push('bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier);
    lines.push('');
  }

  lines = lines.concat([
    'router bgp ' + spineAsn,
    '  router-id ' + lo0ip,
    '  bestpath as-path multipath-relax',
    '  bestpath compare-routerid',
    '  address-family ipv4 unicast',
  ]);
  if (hasEcmp) lines.push('    maximum-paths ' + maxPaths);          // G-10
  lines = lines.concat([
    '  address-family l2vpn evpn',
    '    retain route-target all',
    '  template peer LEAFS',
    '    update-source loopback0',
    '    timers ' + preset.keepalive + ' ' + preset.hold,            // G-12
    '    advertisement-interval ' + preset.adv_interval,
  ]);
  if (hasBfd) lines.push('    bfd');                                  // G-09
  lines = lines.concat([
    '    send-community extended',
    '    address-family ipv4 unicast',
    '      maximum-prefix 12000 warning-only',
    '    address-family l2vpn evpn',
    '      send-community extended',
    '      route-reflector-client',
    '  ! Add leaf neighbors — inherit peer LEAFS per leaf loopback',
  ]);

  // ECMP hash (G-10)
  if (hasEcmp) lines.push(_nxosEcmpHash(state).trimEnd());

  return lines.join('\n') + '\n';
}

// ─── NX-OS Leaf — complete per CLAUDE.md §8 ──────────────────────────────────

function nxosLeafConfig(dev, state) {
  var hn = dev.hostname;
  var d  = _leafDesign(dev, state);

  var hasBfd  = _hasFeat(state, 'bfd');
  var hasEcmp = _hasFeat(state, 'ecmp');
  var b       = state.bfd || { interval: 300, min_rx: 300, multiplier: 3 };

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
  ];
  if (hasBfd) lines.push('feature bfd');                                  // G-09
  lines = lines.concat([
    'nv overlay evpn',
    '',
  ]);

  // BFD global timers (G-09)
  if (hasBfd) {
    lines.push('! --- BFD global ---');
    lines.push('bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier);
    lines.push('');
  }

  lines = lines.concat([
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
    '  address-family ipv4 unicast',
  ]);
  if (hasEcmp) lines.push('    maximum-paths ' + d.maxPaths);            // G-10
  if (hasEcmp) lines.push(_nxosEcmpHash(state).replace(/\n$/, '').split('\n').map(function(l) { return '    ' + l; }).join('\n'));
  lines = lines.concat([
    '  address-family l2vpn evpn',
    '    advertise-pip',
    '  template peer SPINES',
    '    remote-as ' + d.spineAsn,
    '    timers ' + d.keepalive + ' ' + d.hold + '   ! DC: 3 9 | WAN: 10 30',
    '    advertisement-interval 0',
  ]);
  if (hasBfd) lines.push('    bfd');                                      // G-09
  lines = lines.concat([
    '    send-community extended',
    '    address-family ipv4 unicast',
    '      maximum-prefix 12000 warning-only',
    '    address-family l2vpn evpn',
    '      send-community extended',
  ]);

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
  ]);
  if (hasEcmp) lines.push('      maximum-paths ' + d.maxPaths);          // G-10
  lines = lines.concat([
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
  var hn      = dev.hostname;
  var unit    = dev.unit || 1;
  var lo0     = '10.0.0.' + (100 + unit);
  var hasBfd  = _hasFeat(state, 'bfd');
  var hasEcmp = _hasFeat(state, 'ecmp');
  var maxPaths = (state.ecmp && state.ecmp.max_paths) || 8;
  var timerKey = state.bgp_timers || 'dc_aggressive';
  var preset   = BGP_TIMER_PRESETS[timerKey] || BGP_TIMER_PRESETS.dc_aggressive;

  var lines = [
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
    '   bgp bestpath as-path multipath-relax',         // G-13
    '   neighbor LEAF-PEERS peer group',
    '   neighbor LEAF-PEERS send-community extended',
  ];
  if (hasBfd) lines.push('   neighbor LEAF-PEERS bfd');                   // G-09
  lines = lines.concat([
    '   neighbor LEAF-PEERS timers ' + preset.keepalive + ' ' + preset.hold,  // G-12
    '   neighbor LEAF-PEERS advertisement-interval ' + preset.adv_interval,
    '   bgp listen range 10.0.0.0/16 peer-group LEAF-PEERS',
    '   address-family evpn',
    '      neighbor LEAF-PEERS activate',
    '      neighbor LEAF-PEERS route-map RM-EVPN-SOO out',
    '   address-family ipv4',
    '      neighbor LEAF-PEERS activate',
    '      neighbor LEAF-PEERS next-hop-unchanged',
  ]);
  if (hasEcmp) lines.push('      maximum-paths ' + maxPaths + ' ecmp ' + maxPaths);  // G-10

  return lines.join('\n') + '\n';
}

// ─── Arista EOS Leaf ─────────────────────────────────────────────────────────

function aristaLeafConfig(dev, state) {
  var hn      = dev.hostname;
  var d       = _leafDesign(dev, state);
  var hasBfd  = _hasFeat(state, 'bfd');
  var hasEcmp = _hasFeat(state, 'ecmp');

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
  ];
  if (hasBfd) {
    lines.push('   neighbor SPINES bfd');                                 // G-09
    lines.push(_eosBfdSlowTimer(state).trimEnd());
  }
  lines = lines.concat([
    '   neighbor SPINES timers ' + d.keepalive + ' ' + d.hold,
    '   neighbor SPINES advertisement-interval 0',
    '   neighbor SPINES send-community extended',
    '   neighbor SPINES maximum-routes 12000 warning-only',
  ]);

  d.spinePeerIps.forEach(function(ip, idx) {
    lines.push('   neighbor ' + ip + ' peer group SPINES');
    lines.push('   neighbor ' + ip + ' description ' + d.spineHostnames[idx]);
  });

  lines = lines.concat([
    '   address-family evpn',
    '      neighbor SPINES activate',
    '   address-family ipv4',
    '      neighbor SPINES activate',
  ]);
  if (hasEcmp) lines.push('      maximum-paths ' + d.maxPaths + ' ecmp ' + d.maxPaths);  // G-10
  lines = lines.concat([
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
    '      maximum-paths ' + d.maxPaths,
  ]);

  return lines.join('\n') + '\n';
}

// ─── Juniper QFX Leaf ────────────────────────────────────────────────────────

function juniperLeafConfig(dev, state) {
  var hn      = dev.hostname;
  var d       = _leafDesign(dev, state);
  var hasBfd  = _hasFeat(state, 'bfd');
  var hasEcmp = _hasFeat(state, 'ecmp');
  var b       = state.bfd || { interval: 300, multiplier: 3 };

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
  ];
  if (hasEcmp) lines.push('set protocols bgp group SPINES multipath ' + d.maxPaths);  // G-10
  if (hasBfd) lines.push('set protocols bgp group SPINES bfd-liveness-detection minimum-interval ' + b.interval + ' multiplier ' + b.multiplier);  // G-09
  lines = lines.concat([
    'set protocols bgp group SPINES hold-time ' + d.hold,
    'set protocols bgp group SPINES keep ' + d.keepalive,
  ]);

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
