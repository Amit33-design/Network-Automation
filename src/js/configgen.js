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

// ─── G-17: IPv6 dual-stack address derivation ────────────────────────────────
// Addressing scheme (ULA fd00::/8):
//   Loopback0 : fd00::<unit>/128             (e.g. fd00::1/128 for unit=1)
//   Loopback1 : fd00:1::<unit>/128           (VTEP loopback)
//   P2P link  : fd00:2:<unit*4+linkIdx>::/127
//                leaf-side: ::0  spine-side: ::1
function _v6Addrs(unit, spinePeerCount) {
  var lo0v6   = 'fd00::' + unit;
  var lo1v6   = 'fd00:1::' + unit;
  var p2pBase = spinePeerCount || 2;
  var p2pV6   = [];
  for (var i = 0; i < p2pBase; i++) {
    var id = unit * 4 + i;
    p2pV6.push({ leaf: 'fd00:2::' + (id * 2), spine: 'fd00:2::' + (id * 2 + 1) });
  }
  return { lo0v6: lo0v6, lo1v6: lo1v6, p2pV6: p2pV6 };
}

// NX-OS — IPv6 dual-stack additions for leaf
function _nxosIPv6Block(dev, state, d) {
  if (!_hasFeat(state, 'ipv6')) return [];
  var unit     = dev.unit || 1;
  var v6       = _v6Addrs(unit, d.spinePeerIps.length);
  var underlay = (state.protocols && state.protocols.underlay) || 'bgp';
  var lines    = [
    '',
    '! --- G-17: IPv6 Dual-Stack ---',
    'feature ospfv3',
    'ipv6 unicast-routing',
    '',
    'interface loopback0',
    '  ipv6 address ' + v6.lo0v6 + '/128',
    '  ipv6 router ospfv3 1 area 0',
  ];
  if (_hasFeat(state, 'vxlan_evpn') || (state.protocols && state.protocols.overlay && state.protocols.overlay.indexOf('vxlan_evpn') !== -1)) {
    lines.push('interface loopback1');
    lines.push('  ipv6 address ' + v6.lo1v6 + '/128');
  }
  d.spinePeerIps.forEach(function(ip, idx) {
    lines.push('! P2P to ' + (d.spineHostnames[idx] || ('SPINE-' + (idx+1))));
    lines.push('! interface <p2p-to-spine-' + (idx+1) + '>');
    lines.push('!   ipv6 address ' + v6.p2pV6[idx].leaf + '/127');
    lines.push('!   ipv6 router ospfv3 1 area 0');
  });
  if (underlay === 'ospf') {
    lines = lines.concat([
      '',
      'router ospfv3 1',
      '  address-family ipv6 unicast',
      '    router-id ' + (d.lo0ip || ('10.0.0.' + unit)),
      '    passive-interface loopback0',
    ]);
  }
  lines = lines.concat([
    '',
    '! BGP IPv6 address-family (add under router bgp ' + d.leafAsn + '):',
    '  address-family ipv6 unicast',
    '    network ' + v6.lo0v6 + '/128',
    '    maximum-paths ' + ((state.ecmp && state.ecmp.max_paths) || 8),
    '  template peer SPINES-V6',
    '    remote-as ' + d.spineAsn,
    '    address-family ipv6 unicast',
    '      send-community extended',
    '      maximum-prefix 12000 warning-only',
  ]);
  d.spinePeerIps.forEach(function(ip, idx) {
    lines.push('  neighbor ' + v6.p2pV6[idx].spine + ' inherit peer SPINES-V6');
    lines.push('    description ' + (d.spineHostnames[idx] || ('SPINE-' + (idx+1))));
  });
  return lines;
}

// NX-OS — IPv6 for spine
function _nxosSpineIPv6Block(dev, state) {
  if (!_hasFeat(state, 'ipv6')) return [];
  var unit  = dev.unit || 1;
  var lo0v6 = 'fd00::' + (100 + unit);
  var lines = [
    '',
    '! --- G-17: IPv6 Dual-Stack (Spine) ---',
    'feature ospfv3',
    'ipv6 unicast-routing',
    '',
    'interface loopback0',
    '  ipv6 address ' + lo0v6 + '/128',
    '  ipv6 router ospfv3 1 area 0',
    '',
    '! BGP IPv6 AF (add under router bgp 65000):',
    '  address-family ipv6 unicast',
    '    retain route-target all',
    '  template peer LEAFS-V6',
    '    address-family ipv6 unicast',
    '      send-community extended',
    '      route-reflector-client',
    '! Add leaf IPv6 neighbors: neighbor <fd00::N> inherit peer LEAFS-V6',
  ];
  return lines;
}

// Arista EOS — IPv6 dual-stack additions
function _eosIPv6Block(dev, state, d) {
  if (!_hasFeat(state, 'ipv6')) return [];
  var unit     = dev.unit || 1;
  var v6       = _v6Addrs(unit, (d && d.spinePeerIps) ? d.spinePeerIps.length : 2);
  var underlay = (state.protocols && state.protocols.underlay) || 'bgp';
  var lo0v6    = d ? v6.lo0v6 : 'fd00::' + (100 + unit);  // spine uses 100+unit
  var maxPaths = (state.ecmp && state.ecmp.max_paths) || 8;
  var lines = [
    '',
    '! --- G-17: IPv6 Dual-Stack ---',
    'ipv6 unicast-routing',
    '',
    'interface Loopback0',
    '   ipv6 address ' + lo0v6 + '/128',
  ];
  if (d) {
    d.spinePeerIps.forEach(function(ip, idx) {
      lines.push('! interface <Ethernet-to-SPINE-' + (idx+1) + '>');
      lines.push('!    ipv6 address ' + v6.p2pV6[idx].leaf + '/127');
    });
    if (underlay === 'ospf') {
      lines = lines.concat([
        '',
        'router ospf 1',
        '   address-family ipv6',
        '      passive-interface Loopback0',
        '      no passive-interface default',
      ]);
    }
    lines = lines.concat([
      '',
      '! BGP IPv6 AF (add under router bgp ' + d.leafAsn + '):',
      '   address-family ipv6',
      '      neighbor SPINES activate',
      '      network ' + lo0v6 + '/128',
      '      maximum-paths ' + maxPaths + ' ecmp ' + maxPaths,
    ]);
  } else {
    lines = lines.concat([
      '',
      '! BGP IPv6 AF (add under router bgp 65000):',
      '   address-family ipv6',
      '      neighbor LEAF-PEERS activate',
    ]);
  }
  return lines;
}

// Juniper JunOS — IPv6 dual-stack additions
function _junosIPv6Block(dev, state, d) {
  if (!_hasFeat(state, 'ipv6')) return [];
  var unit     = dev.unit || 1;
  var isSpine  = !d;
  var v6       = isSpine ? null : _v6Addrs(unit, (d.spinePeerIps || []).length);
  var lo0v6    = isSpine ? ('fd00::' + (100 + unit)) : v6.lo0v6;
  var underlay = (state.protocols && state.protocols.underlay) || 'bgp';
  var lines = [
    '',
    '# --- G-17: IPv6 Dual-Stack ---',
    'set interfaces lo0 unit 0 family inet6 address ' + lo0v6 + '/128',
  ];
  if (!isSpine && v6) {
    d.spinePeerIps.forEach(function(ip, idx) {
      lines.push('# set interfaces <p2p-to-spine-' + (idx+1) + '> unit 0 family inet6 address ' + v6.p2pV6[idx].leaf + '/127');
    });
  }
  if (underlay === 'ospf') {
    lines = lines.concat([
      'set protocols ospf3 area 0.0.0.0 interface lo0.0 passive',
      isSpine ? '' : '# set protocols ospf3 area 0.0.0.0 interface <p2p-if>.0',
    ]);
  }
  var bgpGroup = isSpine ? 'LEAFS-V6' : 'SPINES-V6';
  lines = lines.concat([
    '',
    '# BGP IPv6 group',
    'set protocols bgp group ' + bgpGroup + ' type ' + (isSpine ? 'internal' : 'external'),
    'set protocols bgp group ' + bgpGroup + ' family inet6 unicast',
    'set protocols bgp group ' + bgpGroup + ' local-address ' + lo0v6,
  ]);
  if (!isSpine && v6) {
    v6.p2pV6.forEach(function(pair, idx) {
      lines.push('set protocols bgp group SPINES-V6 neighbor ' + pair.spine + ' description ' + (d.spineHostnames[idx] || ('SPINE-' + (idx+1))));
    });
  }
  return lines;
}

// ─── G-18: Multicast — PIM / IGMP config blocks ──────────────────────────────
// Supported modes: sparse (default, static RP), ssm (232/8, no RP), bidir (DC anycast RP)
// RP address: use state.multicast.rp_ip or default 10.0.0.254 (anycast RP loopback)
// SSM range : 232.0.0.0/8 (RFC 4607)
// IGMP v3   : enabled on all server-facing SVIs/access interfaces

function _mcState(state) {
  var mc = state.multicast || {};
  return {
    mode:    mc.mode    || 'sparse',          // sparse | ssm | bidir
    rp_ip:   mc.rp_ip   || '10.0.0.254',     // anycast RP
    groups:  mc.groups  || '239.0.0.0/8',    // multicast group ACL
    igmpVer: mc.igmp_version || 3
  };
}

function _nxosMulticastBlock(dev, state) {
  if (!_hasFeat(state, 'multicast')) return [];
  var mc    = _mcState(state);
  var isSsm = mc.mode === 'ssm';
  var lines = [
    '',
    '! --- G-18: Multicast ---',
    'feature pim',
    '',
  ];
  if (!isSsm) {
    lines.push('ip pim rp-address ' + mc.rp_ip + ' group-list ' + mc.groups);
    if (mc.mode === 'bidir') lines.push('ip pim rp-address ' + mc.rp_ip + ' bidir');
  }
  lines = lines.concat([
    'ip pim ssm range 232.0.0.0/8',
    '',
    'interface loopback0',
    '  ip pim sparse-mode',
    '',
    '! Apply on every L3 interface (spine P2P and leaf SVIs):',
    '! interface <if>',
    '!   ip pim ' + (isSsm ? 'sparse-mode' : mc.mode === 'bidir' ? 'bidir-dense-mode' : 'sparse-mode'),
    '!   ip igmp version ' + mc.igmpVer,
    '!   ip igmp static-oif ' + (mc.groups.split('/')[0] || '239.0.0.1') + '  ! optional join',
  ]);
  if (dev.subLayer === 'spine' || (dev.role || '').includes('spine')) {
    lines.push('');
    lines.push('! RP loopback (if this spine is the RP):');
    lines.push('! interface loopback2');
    lines.push('!   ip address ' + mc.rp_ip + '/32');
    lines.push('!   ip pim sparse-mode');
  }
  return lines;
}

function _eosMulticastBlock(dev, state) {
  if (!_hasFeat(state, 'multicast')) return [];
  var mc    = _mcState(state);
  var isSsm = mc.mode === 'ssm';
  var lines = [
    '',
    '! --- G-18: Multicast ---',
    'ip multicast-routing',
    '',
  ];
  if (!isSsm) {
    lines.push('ip pim rp-address ' + mc.rp_ip);
    if (mc.mode === 'bidir') lines.push('ip pim bidir-rp-address ' + mc.rp_ip);
  }
  lines = lines.concat([
    'ip pim ssm range 232.0.0.0/8',
    '',
    'interface Loopback0',
    '   pim ipv4 sparse-mode',
    '',
    '! Apply on L3 P2P and SVI interfaces:',
    '! interface <if>',
    '!    pim ipv4 ' + (isSsm ? 'sparse-mode' : 'sparse-mode'),
    '!    igmp version ' + mc.igmpVer,
    '!    igmp static-group ' + (mc.groups.split('/')[0] || '239.0.0.1'),
  ]);
  return lines;
}

function _junosMulticastBlock(dev, state) {
  if (!_hasFeat(state, 'multicast')) return [];
  var mc    = _mcState(state);
  var isSsm = mc.mode === 'ssm';
  var lines = [
    '',
    '# --- G-18: Multicast ---',
    'set protocols pim interface lo0.0 mode sparse',
    'set protocols pim interface all mode sparse',
  ];
  if (!isSsm) {
    lines.push('set protocols pim rp static address ' + mc.rp_ip);
    if (mc.mode === 'bidir') lines.push('set protocols pim rp static address ' + mc.rp_ip + ' bidir');
  }
  lines = lines.concat([
    'set protocols pim ssm-groups 232.0.0.0/8',
    '',
    '# IGMP on access/server-facing interfaces:',
    '# set protocols igmp interface <if>.0 version ' + mc.igmpVer,
    '# set protocols igmp interface <if>.0 static-group ' + (mc.groups.split('/')[0] || '239.0.0.1'),
  ]);
  return lines;
}

// ─── G-19: BGP Unnumbered (RFC 5549) ─────────────────────────────────────────
// Generates a replacement block: P2P interfaces use ip unnumbered loopback0
// + ipv6 link-local, BGP peers use interface names instead of IP addresses.
// Platform interface name conventions:
//   NX-OS: Ethernet1/<n>   EOS: Ethernet<n>/1   JunOS: xe-0/0/<n>

function _nxosBgpUnnumberedBlock(dev, state, d) {
  if (!_hasFeat(state, 'bgp_unnumbered')) return [];
  var n = d ? d.spinePeerIps.length : 2;
  var lines = [
    '',
    '! --- G-19: BGP Unnumbered (RFC 5549) ---',
    '! Replace numbered P2P interface/neighbor config with the following:',
    '',
    '! --- P2P interfaces (unnumbered) ---',
  ];
  for (var i = 0; i < n; i++) {
    var iface = 'Ethernet1/' + (i + 1);
    var hn    = d ? (d.spineHostnames[i] || ('SPINE-' + (i+1))) : ('SPINE-' + (i+1));
    lines = lines.concat([
      'interface ' + iface,
      '  description P2P-to-' + hn,
      '  no switchport',
      '  mtu 9216',
      '  ip address unnumbered loopback0',
      '  ipv6 address use-link-local-only',
      '  no shutdown',
      '',
    ]);
  }
  var leafAsn  = d ? d.leafAsn  : 65100;
  var spineAsn = d ? d.spineAsn : 65000;
  lines = lines.concat([
    '! --- BGP unnumbered neighbors ---',
    'router bgp ' + leafAsn,
    '  template peer SPINES-UNNUM',
    '    remote-as ' + spineAsn,
    '    address-family ipv4 unicast',
    '      next-hop-self',
    '      send-community extended',
  ]);
  for (var j = 0; j < n; j++) {
    var iface2 = 'Ethernet1/' + (j + 1);
    var hn2    = d ? (d.spineHostnames[j] || ('SPINE-' + (j+1))) : ('SPINE-' + (j+1));
    lines.push('  neighbor ' + iface2 + ' interface  ! to ' + hn2);
    lines.push('    inherit peer SPINES-UNNUM');
  }
  return lines;
}

function _eosBgpUnnumberedBlock(dev, state, d) {
  if (!_hasFeat(state, 'bgp_unnumbered')) return [];
  var n = d ? d.spinePeerIps.length : 2;
  var lines = [
    '',
    '! --- G-19: BGP Unnumbered (RFC 5549) ---',
    '! Replace numbered P2P config with the following:',
    '',
  ];
  for (var i = 0; i < n; i++) {
    var iface = 'Ethernet' + (i + 1) + '/1';
    var hn    = d ? (d.spineHostnames[i] || ('SPINE-' + (i+1))) : ('SPINE-' + (i+1));
    lines = lines.concat([
      'interface ' + iface,
      '   description P2P-to-' + hn,
      '   no switchport',
      '   mtu 9214',
      '   ip address unnumbered Loopback0',
      '   ipv6 enable',
      '   no shutdown',
      '',
    ]);
  }
  var leafAsn  = d ? d.leafAsn  : 65100;
  var spineAsn = d ? d.spineAsn : 65000;
  lines = lines.concat([
    'router bgp ' + leafAsn,
    '   neighbor SPINES peer group',
    '   neighbor SPINES remote-as ' + spineAsn,
    '   neighbor SPINES send-community extended',
    '   neighbor SPINES maximum-routes 12000 warning-only',
  ]);
  for (var j = 0; j < n; j++) {
    var iface2 = 'Ethernet' + (j + 1) + '/1';
    var hn2    = d ? (d.spineHostnames[j] || ('SPINE-' + (j+1))) : ('SPINE-' + (j+1));
    lines.push('   neighbor interface ' + iface2 + ' peer-group SPINES  ! to ' + hn2);
  }
  lines = lines.concat([
    '   address-family ipv4',
    '      neighbor SPINES activate',
    '      neighbor SPINES next-hop-self',
  ]);
  return lines;
}

function _junosBgpUnnumberedBlock(dev, state, d) {
  if (!_hasFeat(state, 'bgp_unnumbered')) return [];
  var n = d ? d.spinePeerIps.length : 2;
  var lines = [
    '',
    '# --- G-19: BGP Unnumbered (RFC 5549) ---',
    '# Replace numbered P2P config with the following:',
    '',
  ];
  for (var i = 0; i < n; i++) {
    var iface = 'xe-0/0/' + i;
    var hn    = d ? (d.spineHostnames[i] || ('SPINE-' + (i+1))) : ('SPINE-' + (i+1));
    lines = lines.concat([
      '# Interface ' + iface + ' to ' + hn,
      'set interfaces ' + iface + ' unit 0 family inet unnumbered-address lo0.0',
      'set interfaces ' + iface + ' unit 0 family inet6',
      '',
    ]);
  }
  var spineAsn = d ? d.spineAsn : 65000;
  lines = lines.concat([
    '# BGP unnumbered group',
    'set protocols bgp group SPINES-UNNUM type external',
    'set protocols bgp group SPINES-UNNUM family inet unicast',
    'set protocols bgp group SPINES-UNNUM peer-as ' + spineAsn,
  ]);
  for (var j = 0; j < n; j++) {
    var iface2 = 'xe-0/0/' + j;
    var hn2    = d ? (d.spineHostnames[j] || ('SPINE-' + (j+1))) : ('SPINE-' + (j+1));
    lines.push('set protocols bgp group SPINES-UNNUM local-interface ' + iface2 + '.0  # to ' + hn2);
  }
  return lines;
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

// ─── VRF-lite config (G-16) ──────────────────────────────────────────────────
// Full VRF-lite block: definition + RT import/export + BGP AF, used when
// 'vrf' feature is selected but vxlan_evpn is NOT the overlay.

function _nxosVrfLiteBlock(state) {
  if (!_hasFeat(state, 'vrf')) return [];
  var asn  = 65000;
  var vrfs = [
    { name: 'MGMT',  rd: asn + ':100', rt: asn + ':100' },
    { name: 'PROD',  rd: asn + ':200', rt: asn + ':200' },
    { name: 'DEV',   rd: asn + ':300', rt: asn + ':300' },
  ];
  var lines = ['! --- VRF-lite (G-16) ---'];
  vrfs.forEach(function(v) {
    lines = lines.concat([
      'vrf context ' + v.name,
      '  rd '                        + v.rd,
      '  address-family ipv4 unicast',
      '    route-target import '     + v.rt,
      '    route-target export '     + v.rt,
    ]);
  });
  lines.push('');
  lines.push('! BGP VRF address-families — add under router bgp <asn>:');
  vrfs.forEach(function(v) {
    lines = lines.concat([
      '!  vrf ' + v.name,
      '!    address-family ipv4 unicast',
      '!      redistribute direct route-map RMAP-CONNECTED',
      '!      maximum-paths 8',
    ]);
  });
  return lines;
}

function _eosVrfLiteBlock(state) {
  if (!_hasFeat(state, 'vrf')) return [];
  var asn  = 65000;
  var vrfs = [
    { name: 'MGMT',  rd: asn + ':100', rt: asn + ':100' },
    { name: 'PROD',  rd: asn + ':200', rt: asn + ':200' },
    { name: 'DEV',   rd: asn + ':300', rt: asn + ':300' },
  ];
  var lines = ['! --- VRF-lite (G-16) ---'];
  vrfs.forEach(function(v) {
    lines = lines.concat([
      'vrf instance ' + v.name,
      '   rd '                      + v.rd,
    ]);
  });
  lines.push('');
  lines.push('ip routing vrf MGMT');
  lines.push('ip routing vrf PROD');
  lines.push('ip routing vrf DEV');
  lines.push('');
  lines.push('! BGP VRF address-families — under router bgp <asn>:');
  vrfs.forEach(function(v) {
    lines = lines.concat([
      '!  vrf ' + v.name,
      '!     rd ' + v.rd,
      '!     route-target import evpn ' + v.rt,
      '!     route-target export evpn ' + v.rt,
      '!     redistribute connected',
    ]);
  });
  return lines;
}

function _junosVrfLiteBlock(state) {
  if (!_hasFeat(state, 'vrf')) return [];
  var asn  = 65000;
  var vrfs = [
    { name: 'MGMT',  rt: asn + ':100' },
    { name: 'PROD',  rt: asn + ':200' },
    { name: 'DEV',   rt: asn + ':300' },
  ];
  var lines = ['# --- VRF-lite (G-16) ---'];
  vrfs.forEach(function(v) {
    lines = lines.concat([
      'set routing-instances ' + v.name + ' instance-type vrf',
      'set routing-instances ' + v.name + ' vrf-target target:' + v.rt,
      'set routing-instances ' + v.name + ' vrf-table-label',
      'set routing-instances ' + v.name + ' protocols bgp group INT type internal',
      'set routing-instances ' + v.name + ' protocols bgp group INT family inet unicast',
    ]);
  });
  return lines;
}

// ─── STP design helper (G-14) ────────────────────────────────────────────────
// Returns per-platform STP config block driven by state.stp.

function _nxosStpBlock(state) {
  var stp = state.stp || { mode: 'mstp', bpdu_guard: true, portfast: true, mst_vlan: '1-4094' };
  var modeCmd = stp.mode === 'rpvst' ? 'rapid-pvst' : (stp.mode === 'pvst' ? 'pvst' : 'mst');
  var lines = [
    '! --- STP (G-14) ---',
    'spanning-tree mode ' + modeCmd,
  ];
  if (stp.mode === 'mstp') {
    lines = lines.concat([
      'spanning-tree mst configuration',
      '  name NDAL-MST',
      '  revision 1',
      '  instance 1 vlan ' + (stp.mst_vlan || '1-4094'),
    ]);
  }
  if (stp.portfast)   lines.push('spanning-tree port type edge default');
  if (stp.bpdu_guard) lines.push('spanning-tree port type edge bpduguard default');
  lines.push('! Apply to each server-facing interface:');
  if (stp.portfast)   lines.push('!   spanning-tree port type edge');
  if (stp.bpdu_guard) lines.push('!   spanning-tree bpduguard enable');
  return lines;
}

function _eosStpBlock(state) {
  var stp = state.stp || { mode: 'mstp', bpdu_guard: true, portfast: true, mst_vlan: '1-4094' };
  var modeCmd = stp.mode === 'rpvst' ? 'rapid-pvst' : (stp.mode === 'pvst' ? 'pvst' : 'mstp');
  var lines = [
    '! --- STP (G-14) ---',
    'spanning-tree mode ' + modeCmd,
  ];
  if (stp.mode === 'mstp') {
    lines = lines.concat([
      'spanning-tree mst configuration',
      '   name NDAL-MST',
      '   revision 1',
      '   instance 1 vlan-map ' + (stp.mst_vlan || '1-4094'),
    ]);
  }
  if (stp.portfast)   lines.push('spanning-tree portfast default');
  if (stp.bpdu_guard) lines.push('spanning-tree bpduguard default');
  return lines;
}

function _junosStpBlock(state) {
  var stp = state.stp || { bpdu_guard: true, portfast: true };
  var lines = ['# --- STP (G-14) ---'];
  lines.push('set protocols rstp interface all edge');
  if (stp.bpdu_guard) lines.push('set protocols rstp bpdu-block-on-edge');
  return lines;
}

// ─── QoS 8-class config blocks (G-15) ────────────────────────────────────────
// DSCP values for each class (decimal)
var DSCP_DEC = { ef:46, af41:34, af31:26, af21:18, af11:10, cs3:24, cs2:16, cs1:8, 'default':0 };

// Build per-platform QoS config when 'qos' feature is enabled
function _nxosQosBlock(state) {
  if (!_hasFeat(state, 'qos')) return [];
  var q = state.qos || {};
  var dscpMap = q.dscp_map || { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                 medium:'af11', low:'cs3', scavenger:'cs1', 'default':'default' };
  var lines = ['! --- QoS 8-class policy (G-15) ---'];

  // Class maps — match by DSCP
  Object.keys(dscpMap).forEach(function(cls) {
    var dscp = dscpMap[cls];
    if (dscp === 'default') return;  // class-default is built-in
    var dec = DSCP_DEC[dscp] || 0;
    lines = lines.concat([
      'class-map match-all CM-' + cls.toUpperCase(),
      '  match dscp ' + dscp + '  ! DSCP ' + dec,
    ]);
  });
  lines.push('');

  // Policy map — ingress marking + queuing
  lines.push('policy-map PM-QOS-IN');
  Object.keys(dscpMap).forEach(function(cls) {
    var dscp = dscpMap[cls];
    if (dscp === 'default') {
      lines = lines.concat([
        '  class class-default',
        '    set dscp default',
        '    bandwidth remaining percent 10',
      ]);
    } else {
      var bw = { voice:10, video:20, critical:15, high:10, medium:10, low:5, scavenger:1 };
      var pq = (cls === 'voice' || cls === 'video');
      lines = lines.concat([
        '  class CM-' + cls.toUpperCase(),
        '    set dscp ' + dscp,
        pq ? '    priority level ' + (cls === 'voice' ? '1' : '2')
           : '    bandwidth remaining percent ' + (bw[cls] || 5),
      ]);
    }
  });
  lines.push('');

  lines.push('! Apply policy to server-facing interfaces:');
  lines.push('!   service-policy input PM-QOS-IN');
  return lines;
}

function _eosQosBlock(state) {
  if (!_hasFeat(state, 'qos')) return [];
  var q = state.qos || {};
  var dscpMap = q.dscp_map || { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                  medium:'af11', low:'cs3', scavenger:'cs1', 'default':'default' };
  var lines = ['! --- QoS 8-class policy (G-15) ---'];

  // Traffic classes
  lines.push('qos map dscp-to-traffic-class table');
  var tcMap = { ef:6, af41:5, af31:4, af21:3, af11:2, cs3:3, cs2:2, cs1:1, 'default':0 };
  Object.keys(dscpMap).forEach(function(cls) {
    var dscp = dscpMap[cls];
    if (dscp === 'default') return;
    var dec = DSCP_DEC[dscp] || 0;
    lines.push('   ' + dec + ' to ' + (tcMap[dscp] || 0) + '  ! ' + cls + ' (' + dscp + ')');
  });
  lines.push('');

  // Policy maps
  lines.push('policy-map type qos PM-INGRESS');
  Object.keys(dscpMap).forEach(function(cls) {
    var dscp = dscpMap[cls];
    lines = lines.concat([
      '   class ' + (dscp === 'default' ? 'class-default' : 'CM-' + cls.toUpperCase()),
      '      set dscp ' + dscp,
    ]);
  });
  lines.push('');
  lines.push('! Apply: interface Ethernet X / service-policy type qos input PM-INGRESS');
  return lines;
}

function _junosQosBlock(state) {
  if (!_hasFeat(state, 'qos')) return [];
  var q = state.qos || {};
  var dscpMap = q.dscp_map || { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                  medium:'af11', low:'cs3', scavenger:'cs1', 'default':'default' };
  var lines = ['# --- QoS 8-class policy (G-15) ---'];
  var fcMap = { voice:'voice', video:'video', critical:'assured-forwarding', high:'best-effort',
                medium:'best-effort', low:'best-effort', scavenger:'best-effort', 'default':'best-effort' };

  Object.keys(dscpMap).forEach(function(cls) {
    var dscp = dscpMap[cls];
    if (dscp === 'default') return;
    var dec = DSCP_DEC[dscp] || 0;
    lines.push('set class-of-service code-point-aliases dscp ' + cls + '-dscp 0b' + dec.toString(2).padStart(6,'0'));
    lines.push('set class-of-service dscp-code-points ' + (fcMap[cls] || 'best-effort') + ' ' + cls + '-dscp');
  });
  lines.push('# Apply: set interfaces <if> unit 0 family inet filter input QOS-FILTER');
  return lines;
}

// ─── EVPN design helper (G-11) ────────────────────────────────────────────────
// Returns RD/RT strings derived from state.evpn + leafDesign values.

function _evpnDesign(d, state) {
  var ev = (state.evpn) || {};
  var rdMode  = ev.rd  || 'auto';
  var rtMode  = ev.rt  || 'auto';
  var rtBase  = ev.rt_base || (d.spineAsn + ':' + d.l2vni);
  var rtTypes = ev.rt_types || ['rt2', 'rt3'];

  // RD strings
  var vrfRd  = (rdMode === 'manual') ? (d.lo0ip + ':' + d.l3vni) : 'auto';
  var l2Rd   = (rdMode === 'manual') ? (d.lo0ip + ':' + d.l2vni) : 'auto';

  // RT strings for VRF (L3)
  var l3rtImport, l3rtExport;
  if (rtMode === 'manual') {
    l3rtImport = rtBase;
    l3rtExport = rtBase;
  } else {
    l3rtImport = 'auto evpn';
    l3rtExport = null; // 'route-target both auto evpn' covers both
  }

  // RT strings for L2 VNI
  var l2rtImport = (rtMode === 'manual') ? rtBase : 'auto';
  var l2rtExport = (rtMode === 'manual') ? rtBase : 'auto';

  // RT-5 IP prefix routes
  var hasRt5 = rtTypes.indexOf('rt5') !== -1;

  // ESI
  var esiEnabled = !!(ev.esi);
  var esiType    = ev.esi_type || 'type1';

  return {
    vrfRd: vrfRd, l2Rd: l2Rd,
    rtMode: rtMode,
    l3rtImport: l3rtImport, l3rtExport: l3rtExport,
    l2rtImport: l2rtImport, l2rtExport: l2rtExport,
    hasRt5: hasRt5,
    arpSuppress:  ev.arp_suppress  !== false,
    advertisePip: ev.advertise_pip !== false,
    esiEnabled: esiEnabled, esiType: esiType
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

  // G-17: IPv6 dual-stack
  var v6SpineLines = _nxosSpineIPv6Block(dev, state);
  if (v6SpineLines.length) lines = lines.concat(v6SpineLines);

  // G-18: Multicast
  var mcNxosSpine = _nxosMulticastBlock(dev, state);
  if (mcNxosSpine.length) lines = lines.concat(mcNxosSpine);

  // G-19: BGP unnumbered
  var unNumSpine = _nxosBgpUnnumberedBlock(dev, state, null);
  if (unNumSpine.length) lines = lines.concat(unNumSpine);

  return lines.join('\n') + '\n';
}

// ─── NX-OS Leaf — complete per CLAUDE.md §8 ──────────────────────────────────

function nxosLeafConfig(dev, state) {
  var hn = dev.hostname;
  var d  = _leafDesign(dev, state);
  var ev = _evpnDesign(d, state);                                          // G-11

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
  if (hasBfd)       lines.push('feature bfd');                            // G-09
  if (ev.esiEnabled) lines.push('feature evpn-multisite');                // G-11 ESI
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
  ]);
  if (ev.arpSuppress) lines.push('    suppress-arp');                     // G-11
  lines = lines.concat([
    '  member vni ' + d.l3vni + ' associate-vrf',
    '',
    '! --- VRF ---',
    'vrf context ' + d.vrfName,
    '  vni ' + d.l3vni,
    '  rd ' + ev.vrfRd,                                                  // G-11 RD
    '  address-family ipv4 unicast',
  ]);
  if (ev.rtMode === 'auto') {
    lines.push('    route-target both auto evpn');
  } else {
    lines.push('    route-target import ' + ev.l3rtImport);
    lines.push('    route-target export ' + ev.l3rtExport);
  }
  if (ev.hasRt5) {
    lines.push('    route-target import evpn route-type 5 ' + ev.l3rtImport);  // G-11 RT-5
  }
  lines = lines.concat([
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
  lines.push('  address-family l2vpn evpn');
  if (ev.advertisePip) lines.push('    advertise-pip');                   // G-11
  lines = lines.concat([
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
    '    rd ' + ev.l2Rd,                                                  // G-11 RD
    '    route-target import ' + ev.l2rtImport,
    '    route-target export ' + ev.l2rtExport,
  ]);
  if (ev.hasRt5) {                                                        // G-11 RT-5
    lines.push('  vni ' + d.l3vni + ' l3');
    lines.push('    rd ' + ev.vrfRd);
    lines.push('    route-target import ' + ev.l3rtImport);
    lines.push('    route-target export ' + ev.l3rtExport);
  }

  // ESI multi-homing (G-11)
  if (ev.esiEnabled) {
    lines = lines.concat([
      '',
      '! --- ESI multi-homing ---',
      'evpn multihoming',
      '  system-mac auto',
    ]);
    if (ev.esiType === 'type0') {
      lines.push('  ! Type 0 ESI: set manually per uplink port-channel — e.g. esi 0000.0000.0001.0001.0001');
    }
  }

  // STP design (G-14)
  lines.push('');
  lines = lines.concat(_nxosStpBlock(state));

  // VRF-lite (G-16) — only when vxlan_evpn not in use (EVPN VRF already handled above)
  var hasEvpnOverlay = state.protocols && state.protocols.overlay &&
                       state.protocols.overlay.indexOf('vxlan_evpn') !== -1;
  if (!hasEvpnOverlay) {
    var vrfLines = _nxosVrfLiteBlock(state);
    if (vrfLines.length) { lines.push(''); lines = lines.concat(vrfLines); }
  }

  // QoS 8-class policy (G-15)
  var qosLines = _nxosQosBlock(state);
  if (qosLines.length) { lines.push(''); lines = lines.concat(qosLines); }

  // G-17: IPv6 dual-stack
  var v6LeafLines = _nxosIPv6Block(dev, state, d);
  if (v6LeafLines.length) lines = lines.concat(v6LeafLines);

  // G-18: Multicast
  var mcNxosLeaf = _nxosMulticastBlock(dev, state);
  if (mcNxosLeaf.length) lines = lines.concat(mcNxosLeaf);

  // G-19: BGP unnumbered
  var unNumLeaf = _nxosBgpUnnumberedBlock(dev, state, d);
  if (unNumLeaf.length) lines = lines.concat(unNumLeaf);

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

  // G-17: IPv6 dual-stack (spine — no _leafDesign object)
  var v6EosSpine = _eosIPv6Block(dev, state, null);
  if (v6EosSpine.length) lines = lines.concat(v6EosSpine);

  // G-18: Multicast
  var mcEosSpine = _eosMulticastBlock(dev, state);
  if (mcEosSpine.length) lines = lines.concat(mcEosSpine);

  // G-19: BGP unnumbered
  var unNumEosSpine = _eosBgpUnnumberedBlock(dev, state, null);
  if (unNumEosSpine.length) lines = lines.concat(unNumEosSpine);

  return lines.join('\n') + '\n';
}

// ─── Arista EOS Leaf ─────────────────────────────────────────────────────────

function aristaLeafConfig(dev, state) {
  var hn      = dev.hostname;
  var d       = _leafDesign(dev, state);
  var ev      = _evpnDesign(d, state);                                    // G-11
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
    '      rd ' + ev.l2Rd,                                                // G-11 RD
  ]);
  if (ev.rtMode === 'auto') {
    lines.push('      route-target both auto');
  } else {
    lines.push('      route-target import evpn ' + ev.l2rtImport);
    lines.push('      route-target export evpn ' + ev.l2rtExport);
  }
  lines = lines.concat([
    '      redistribute learned',
    '   vrf ' + d.vrfName,
    '      rd ' + ev.vrfRd,                                               // G-11 RD
  ]);
  if (ev.rtMode === 'auto') {
    lines.push('      route-target import evpn auto');
    lines.push('      route-target export evpn auto');
  } else {
    lines.push('      route-target import evpn ' + ev.l3rtImport);
    lines.push('      route-target export evpn ' + ev.l3rtExport);
  }
  if (ev.hasRt5) {                                                        // G-11 RT-5
    lines.push('      route-target import evpn ' + ev.l3rtImport + ' ip-prefix');
  }
  lines = lines.concat([
    '      redistribute connected',
    '      maximum-paths ' + d.maxPaths,
  ]);

  // ESI multi-homing (G-11)
  if (ev.esiEnabled) {
    lines = lines.concat([
      '',
      '! --- ESI / EVPN multi-homing ---',
      'evpn',
      '   multihoming recovery-delay 180',
    ]);
  }

  // STP design (G-14)
  lines.push('');
  lines = lines.concat(_eosStpBlock(state));

  // VRF-lite (G-16)
  var hasEvpnEos = state.protocols && state.protocols.overlay &&
                   state.protocols.overlay.indexOf('vxlan_evpn') !== -1;
  if (!hasEvpnEos) {
    var vrfLinesEos = _eosVrfLiteBlock(state);
    if (vrfLinesEos.length) { lines.push(''); lines = lines.concat(vrfLinesEos); }
  }

  // QoS 8-class policy (G-15)
  var qosLinesEos = _eosQosBlock(state);
  if (qosLinesEos.length) { lines.push(''); lines = lines.concat(qosLinesEos); }

  // G-17: IPv6 dual-stack
  var v6EosLeaf = _eosIPv6Block(dev, state, d);
  if (v6EosLeaf.length) lines = lines.concat(v6EosLeaf);

  // G-18: Multicast
  var mcEosLeaf = _eosMulticastBlock(dev, state);
  if (mcEosLeaf.length) lines = lines.concat(mcEosLeaf);

  // G-19: BGP unnumbered
  var unNumEosLeaf = _eosBgpUnnumberedBlock(dev, state, d);
  if (unNumEosLeaf.length) lines = lines.concat(unNumEosLeaf);

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

  // STP design (G-14)
  lines.push('');
  lines = lines.concat(_junosStpBlock(state));

  // VRF-lite (G-16)
  var hasEvpnJunos = state.protocols && state.protocols.overlay &&
                     state.protocols.overlay.indexOf('vxlan_evpn') !== -1;
  if (!hasEvpnJunos) {
    var vrfLinesJunos = _junosVrfLiteBlock(state);
    if (vrfLinesJunos.length) { lines.push(''); lines = lines.concat(vrfLinesJunos); }
  }

  // QoS 8-class policy (G-15)
  var qosLinesJunos = _junosQosBlock(state);
  if (qosLinesJunos.length) { lines.push(''); lines = lines.concat(qosLinesJunos); }

  // G-17: IPv6 dual-stack
  var v6JunosLines = _junosIPv6Block(dev, state, d);
  if (v6JunosLines.length) lines = lines.concat(v6JunosLines);

  // G-18: Multicast
  var mcJunos = _junosMulticastBlock(dev, state);
  if (mcJunos.length) lines = lines.concat(mcJunos);

  // G-19: BGP unnumbered
  var unNumJunos = _junosBgpUnnumberedBlock(dev, state, d);
  if (unNumJunos.length) lines = lines.concat(unNumJunos);

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

var CFG_ROLE_COLORS = {
  'super-spine':'#6366f1','spine':'#3b82f6','core':'#8b5cf6',
  'distribution':'#a855f7','leaf':'#22c55e','access':'#14b8a6',
  'firewall':'#f97316','wan-edge':'#eab308'
};

function renderConfigViewer(state) {
  var devices = state.devices || [];
  if (!devices.length) {
    return '<p class="empty-state">No devices — complete Step 1 first.</p>';
  }

  var listItems = devices.map(function(dev, i) {
    var eid = (dev.instanceId || '').replace(/'/g, "\\'");
    var roleColor = CFG_ROLE_COLORS[dev.subLayer] || '#64748b';
    return '<div class="cfg-dev-item' + (i === 0 ? ' active' : '') + '" '
      + 'data-id="' + dev.instanceId + '" '
      + 'onclick="window.showDeviceConfig(\'' + eid + '\')">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + roleColor + ';flex-shrink:0;"></span>'
      + '<div style="min-width:0;">'
      + '<div class="cfg-dev-name">' + (dev.hostname || dev.id) + '</div>'
      + '<div class="cfg-dev-model">' + (dev.subLayer || '') + ' &middot; ' + (dev.model || '') + '</div>'
      + '</div></div>'
      + '</div>';
  }).join('');

  var firstDev = devices[0];
  var firstCfg = (firstDev && state.configs[firstDev.instanceId]) || '! Generate configs first';
  var firstTitle = firstDev ? (firstDev.hostname || firstDev.id) : '';
  var firstRole  = firstDev ? (firstDev.subLayer || '') : '';
  var firstColor = CFG_ROLE_COLORS[firstRole] || '#64748b';

  return '<div class="cfg-layout" id="cfg-layout">'
    + '<div class="cfg-device-list" id="cfg-device-list">'
    + '<div style="padding:10px 14px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);border-bottom:1px solid var(--border);">'
    + devices.length + ' devices</div>'
    + listItems + '</div>'
    + '<div class="cfg-panel" id="cfg-panel">'
    +   '<div class="cfg-panel-hdr">'
    +     '<button class="btn btn-secondary cfg-back-btn" onclick="window.cfgShowList()">&#8592; Devices</button>'
    +     '<span class="cfg-panel-hdr-title" id="cfg-panel-title">'
    +       '<span id="cfg-role-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + firstColor + ';margin-right:6px;vertical-align:middle;"></span>'
    +       firstTitle
    +     '</span>'
    +     '<button class="btn btn-secondary" onclick="window.downloadConfig()" title="Download this config">&#8595; .cfg</button>'
    +     '<button class="btn btn-secondary" onclick="window.downloadAllConfigs()" title="Download all configs">&#8595; All</button>'
    +   '</div>'
    +   '<pre id="cfg-output" class="config-pre">' + firstCfg + '</pre>'
    + '</div>'
    + '</div>';
}

window.generateAllConfigs = generateAllConfigs;
window.renderConfigViewer = renderConfigViewer;
