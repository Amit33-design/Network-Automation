import type { IntentObject } from '../types/intent';
import type { DeviceEntry } from './bom';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfigGenState {
  intent: IntentObject;
  devices: DeviceEntry[];
  bgp_timers?: 'dc_aggressive' | 'wan_standard' | 'conservative';
  bfd?: { interval: number; min_rx: number; multiplier: number };
  ecmp?: { max_paths: number; hash_algorithm?: 'symmetric' | 'resilient' | 'default' };
  evpn?: {
    rd?: 'auto' | 'manual'; rt?: 'auto' | 'manual'; rt_base?: string;
    rt_types?: string[]; esi?: boolean; esi_type?: string;
    arp_suppress?: boolean; advertise_pip?: boolean;
  };
  stp?: { mode?: string; bpdu_guard?: boolean; portfast?: boolean; mst_vlan?: string };
  qos?: { dscp_map?: Record<string, string> };
  multicast?: { mode?: string; rp_ip?: string; groups?: string; igmp_version?: number };
}

// ─── BGP timer presets — CLAUDE.md §10 ──────────────────────────────────────

export const BGP_TIMER_PRESETS = {
  dc_aggressive: { label: 'DC Aggressive', keepalive: 3,  hold: 9,   adv_interval: 0  },
  wan_standard:  { label: 'WAN Standard',  keepalive: 10, hold: 30,  adv_interval: 5  },
  conservative:  { label: 'Conservative',  keepalive: 60, hold: 180, adv_interval: 30 },
};

// ─── Feature helpers ─────────────────────────────────────────────────────────

function hasFeat(state: ConfigGenState, feat: string): boolean {
  return state.intent.protocols.features.includes(feat);
}

// ─── IPv6 address derivation (G-17) ─────────────────────────────────────────

function v6Addrs(unit: number, spinePeerCount: number) {
  const lo0v6 = 'fd00::' + unit;
  const lo1v6 = 'fd00:1::' + unit;
  const p2pV6: Array<{ leaf: string; spine: string }> = [];
  for (let i = 0; i < spinePeerCount; i++) {
    const id = unit * 4 + i;
    p2pV6.push({ leaf: 'fd00:2::' + (id * 2), spine: 'fd00:2::' + (id * 2 + 1) });
  }
  return { lo0v6, lo1v6, p2pV6 };
}

// ─── Leaf design ─────────────────────────────────────────────────────────────

interface LeafDesign {
  leafAsn: number; spineAsn: number;
  lo0ip: string; lo1ip: string;
  spinePeerIps: string[]; spineHostnames: string[];
  vlanId: number; l2vni: number; l3vni: number; l3VlanId: number;
  vrfName: string; anycastGw: string; prefix: string;
  keepalive: number; hold: number; advInt: number; maxPaths: number;
}

function leafDesign(dev: DeviceEntry, state: ConfigGenState): LeafDesign {
  const unit    = dev.unit || 1;
  const pairIdx = Math.floor((unit - 1) / 2);
  const leafAsn = 65100 + pairIdx;
  const spineAsn = 65000;
  const lo0ip  = '10.0.0.' + unit;
  const lo1ip  = '10.1.0.' + unit;

  const spines = state.devices.filter((d) => d.subLayer === 'spine');
  const spinePeerIps: string[] = [];
  const spineHostnames: string[] = [];
  if (spines.length) {
    spines.forEach((sp, idx) => {
      spinePeerIps.push('192.168.' + (unit * 10 + idx * 2) + '.0');
      spineHostnames.push(sp.hostname ?? ('SPINE-' + (idx + 1)));
    });
  } else {
    spinePeerIps.push('10.100.0.1', '10.100.0.2');
    spineHostnames.push('SPINE-01', 'SPINE-02');
  }

  const vlanId   = 10;
  const l2vni    = 10000 + vlanId;
  const l3vni    = 50000 + (pairIdx + 1);
  const l3VlanId = 3000  + (pairIdx + 1);
  const vrfName  = 'PROD';
  const anycastGw= '10.10.' + unit + '.1';
  const prefix   = '24';

  const timerKey = state.bgp_timers ??
    (state.intent.use_case === 'wan' ? 'wan_standard' : 'dc_aggressive');
  const preset   = BGP_TIMER_PRESETS[timerKey] ?? BGP_TIMER_PRESETS.dc_aggressive;
  const maxPaths = state.ecmp?.max_paths ?? 8;

  return {
    leafAsn, spineAsn, lo0ip, lo1ip, spinePeerIps, spineHostnames,
    vlanId, l2vni, l3vni, l3VlanId, vrfName, anycastGw, prefix,
    keepalive: preset.keepalive, hold: preset.hold, advInt: preset.adv_interval, maxPaths,
  };
}

// ─── EVPN design (G-11) ──────────────────────────────────────────────────────

function evpnDesign(d: LeafDesign, state: ConfigGenState) {
  const ev      = state.evpn ?? {};
  const rdMode  = ev.rd  ?? 'auto';
  const rtMode  = ev.rt  ?? 'auto';
  const rtBase  = ev.rt_base ?? (d.spineAsn + ':' + d.l2vni);
  const rtTypes = ev.rt_types ?? ['rt2', 'rt3'];
  const vrfRd   = rdMode === 'manual' ? (d.lo0ip + ':' + d.l3vni) : 'auto';
  const l2Rd    = rdMode === 'manual' ? (d.lo0ip + ':' + d.l2vni) : 'auto';
  const l3rtImport = rtMode === 'manual' ? rtBase : 'auto evpn';
  const l3rtExport = rtMode === 'manual' ? rtBase : null;
  const l2rtImport = rtMode === 'manual' ? rtBase : 'auto';
  const l2rtExport = rtMode === 'manual' ? rtBase : 'auto';
  return {
    vrfRd, l2Rd, rtMode, l3rtImport, l3rtExport, l2rtImport, l2rtExport,
    hasRt5:       rtTypes.includes('rt5'),
    arpSuppress:  ev.arp_suppress  !== false,
    advertisePip: ev.advertise_pip !== false,
    esiEnabled:   !!(ev.esi),
    esiType:      ev.esi_type ?? 'type1',
  };
}

// ─── ECMP hash (G-10) ────────────────────────────────────────────────────────

function nxosEcmpHash(state: ConfigGenState): string {
  if (!hasFeat(state, 'ecmp')) return '';
  const algo = state.ecmp?.hash_algorithm;
  if (algo === 'symmetric') return 'ip load-sharing address symmetric\n';
  if (algo === 'resilient')
    return 'ip load-sharing address source-destination port source-destination resilient\n';
  return 'ip load-sharing address source-destination port source-destination\n';
}

function eosBfdSlowTimer(state: ConfigGenState): string {
  if (!hasFeat(state, 'bfd')) return '';
  const b = state.bfd ?? { min_rx: 300 };
  return '   bfd slow-timer ' + (b.min_rx * 10) + '\n';
}

// ─── STP (G-14) ──────────────────────────────────────────────────────────────

function nxosStpBlock(state: ConfigGenState): string[] {
  const stp = state.stp ?? { mode: 'mstp', bpdu_guard: true, portfast: true, mst_vlan: '1-4094' };
  const modeCmd = stp.mode === 'rpvst' ? 'rapid-pvst' : stp.mode === 'pvst' ? 'pvst' : 'mst';
  const lines: string[] = ['! --- STP (G-14) ---', 'spanning-tree mode ' + modeCmd];
  if (stp.mode === 'mstp') {
    lines.push('spanning-tree mst configuration', '  name NDAL-MST', '  revision 1',
               '  instance 1 vlan ' + (stp.mst_vlan ?? '1-4094'));
  }
  if (stp.portfast)   lines.push('spanning-tree port type edge default');
  if (stp.bpdu_guard) lines.push('spanning-tree port type edge bpduguard default');
  return lines;
}

function eosStpBlock(state: ConfigGenState): string[] {
  const stp = state.stp ?? { mode: 'mstp', bpdu_guard: true, portfast: true, mst_vlan: '1-4094' };
  const modeCmd = stp.mode === 'rpvst' ? 'rapid-pvst' : stp.mode === 'pvst' ? 'pvst' : 'mstp';
  const lines: string[] = ['! --- STP (G-14) ---', 'spanning-tree mode ' + modeCmd];
  if (stp.mode === 'mstp') {
    lines.push('spanning-tree mst configuration', '   name NDAL-MST', '   revision 1',
               '   instance 1 vlan-map ' + (stp.mst_vlan ?? '1-4094'));
  }
  if (stp.portfast)   lines.push('spanning-tree portfast default');
  if (stp.bpdu_guard) lines.push('spanning-tree bpduguard default');
  return lines;
}

function junosStpBlock(state: ConfigGenState): string[] {
  const stp = state.stp ?? { bpdu_guard: true };
  const lines = ['# --- STP (G-14) ---', 'set protocols rstp interface all edge'];
  if (stp.bpdu_guard) lines.push('set protocols rstp bpdu-block-on-edge');
  return lines;
}

// ─── VRF-lite (G-16) ─────────────────────────────────────────────────────────

function nxosVrfLiteBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'vrf')) return [];
  const asn = 65000;
  const vrfs = [
    { name: 'MGMT', rd: asn + ':100', rt: asn + ':100' },
    { name: 'PROD', rd: asn + ':200', rt: asn + ':200' },
    { name: 'DEV',  rd: asn + ':300', rt: asn + ':300' },
  ];
  const lines: string[] = ['! --- VRF-lite (G-16) ---'];
  for (const v of vrfs) {
    lines.push('vrf context ' + v.name, '  rd ' + v.rd,
               '  address-family ipv4 unicast',
               '    route-target import ' + v.rt,
               '    route-target export ' + v.rt);
  }
  return lines;
}

function eosVrfLiteBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'vrf')) return [];
  const asn = 65000;
  const vrfs = [
    { name: 'MGMT', rd: asn + ':100', rt: asn + ':100' },
    { name: 'PROD', rd: asn + ':200', rt: asn + ':200' },
    { name: 'DEV',  rd: asn + ':300', rt: asn + ':300' },
  ];
  const lines: string[] = ['! --- VRF-lite (G-16) ---'];
  for (const v of vrfs) lines.push('vrf instance ' + v.name, '   rd ' + v.rd);
  lines.push('', 'ip routing vrf MGMT', 'ip routing vrf PROD', 'ip routing vrf DEV');
  return lines;
}

function junosVrfLiteBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'vrf')) return [];
  const asn = 65000;
  const vrfs = [
    { name: 'MGMT', rt: asn + ':100' },
    { name: 'PROD', rt: asn + ':200' },
    { name: 'DEV',  rt: asn + ':300' },
  ];
  const lines: string[] = ['# --- VRF-lite (G-16) ---'];
  for (const v of vrfs) {
    lines.push(
      'set routing-instances ' + v.name + ' instance-type vrf',
      'set routing-instances ' + v.name + ' vrf-target target:' + v.rt,
      'set routing-instances ' + v.name + ' vrf-table-label',
    );
  }
  return lines;
}

// ─── QoS 8-class (G-15) ──────────────────────────────────────────────────────

const DSCP_DEC: Record<string, number> = { ef:46, af41:34, af31:26, af21:18, af11:10, cs3:24, cs2:16, cs1:8, default:0 };

function nxosQosBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'qos')) return [];
  const dscpMap = state.qos?.dscp_map ?? { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                             medium:'af11', low:'cs3', scavenger:'cs1', default:'default' };
  const bw: Record<string, number> = { voice:10, video:20, critical:15, high:10, medium:10, low:5, scavenger:1 };
  const lines: string[] = ['! --- QoS 8-class policy (G-15) ---'];
  for (const [cls, dscp] of Object.entries(dscpMap)) {
    if (dscp === 'default') continue;
    lines.push('class-map match-all CM-' + cls.toUpperCase(), '  match dscp ' + dscp + '  ! DSCP ' + (DSCP_DEC[dscp] ?? 0));
  }
  lines.push('', 'policy-map PM-QOS-IN');
  for (const [cls, dscp] of Object.entries(dscpMap)) {
    if (dscp === 'default') {
      lines.push('  class class-default', '    set dscp default', '    bandwidth remaining percent 10');
    } else {
      const pq = cls === 'voice' || cls === 'video';
      lines.push('  class CM-' + cls.toUpperCase(), '    set dscp ' + dscp,
        pq ? '    priority level ' + (cls === 'voice' ? '1' : '2')
           : '    bandwidth remaining percent ' + (bw[cls] ?? 5));
    }
  }
  return lines;
}

function eosQosBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'qos')) return [];
  const lines: string[] = ['! --- QoS 8-class policy (G-15) ---', 'qos map dscp-to-traffic-class table'];
  const dscpMap = state.qos?.dscp_map ?? { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                             medium:'af11', low:'cs3', scavenger:'cs1', default:'default' };
  const tcMap: Record<string, number> = { ef:6, af41:5, af31:4, af21:3, af11:2, cs3:3, cs2:2, cs1:1, default:0 };
  for (const [cls, dscp] of Object.entries(dscpMap)) {
    if (dscp === 'default') continue;
    lines.push('   ' + (DSCP_DEC[dscp] ?? 0) + ' to ' + (tcMap[dscp] ?? 0) + '  ! ' + cls);
  }
  return lines;
}

function junosQosBlock(state: ConfigGenState): string[] {
  if (!hasFeat(state, 'qos')) return [];
  const dscpMap = state.qos?.dscp_map ?? { voice:'ef', video:'af41', critical:'af31', high:'af21',
                                             medium:'af11', low:'cs3', scavenger:'cs1', default:'default' };
  const lines: string[] = ['# --- QoS 8-class policy (G-15) ---'];
  for (const [cls, dscp] of Object.entries(dscpMap)) {
    if (dscp === 'default') continue;
    const dec = DSCP_DEC[dscp] ?? 0;
    lines.push('set class-of-service code-point-aliases dscp ' + cls + '-dscp 0b' + dec.toString(2).padStart(6,'0'));
  }
  return lines;
}

// ─── Multicast (G-18) ────────────────────────────────────────────────────────

function mcState(state: ConfigGenState) {
  const mc = state.intent.multicast;
  return { mode: mc?.mode ?? 'sparse', rp_ip: mc?.rp_address ?? '10.0.0.254',
           groups: '239.0.0.0/8', igmpVer: 3 };
}

function nxosMulticastBlock(dev: DeviceEntry, state: ConfigGenState): string[] {
  if (!hasFeat(state, 'multicast')) return [];
  const mc  = mcState(state);
  const ssm = mc.mode === 'ssm';
  const lines: string[] = ['', '! --- G-18: Multicast ---', 'feature pim', ''];
  if (!ssm) {
    lines.push('ip pim rp-address ' + mc.rp_ip + ' group-list ' + mc.groups);
    if (mc.mode === 'bidir') lines.push('ip pim rp-address ' + mc.rp_ip + ' bidir');
  }
  lines.push('ip pim ssm range 232.0.0.0/8');
  if (dev.subLayer === 'spine') {
    lines.push('', '! RP loopback (if this spine is the RP):');
    lines.push('! interface loopback2\n!   ip address ' + mc.rp_ip + '/32\n!   ip pim sparse-mode');
  }
  return lines;
}

function eosMulticastBlock(_dev: DeviceEntry, state: ConfigGenState): string[] {
  if (!hasFeat(state, 'multicast')) return [];
  const mc  = mcState(state);
  const ssm = mc.mode === 'ssm';
  const lines: string[] = ['', '! --- G-18: Multicast ---', 'ip multicast-routing', ''];
  if (!ssm) {
    lines.push('ip pim rp-address ' + mc.rp_ip);
    if (mc.mode === 'bidir') lines.push('ip pim bidir-rp-address ' + mc.rp_ip);
  }
  lines.push('ip pim ssm range 232.0.0.0/8');
  return lines;
}

function junosMulticastBlock(_dev: DeviceEntry, state: ConfigGenState): string[] {
  if (!hasFeat(state, 'multicast')) return [];
  const mc  = mcState(state);
  const ssm = mc.mode === 'ssm';
  const lines: string[] = ['', '# --- G-18: Multicast ---',
    'set protocols pim interface lo0.0 mode sparse',
    'set protocols pim interface all mode sparse'];
  if (!ssm) {
    lines.push('set protocols pim rp static address ' + mc.rp_ip);
    if (mc.mode === 'bidir') lines.push('set protocols pim rp static address ' + mc.rp_ip + ' bidir');
  }
  lines.push('set protocols pim ssm-groups 232.0.0.0/8');
  return lines;
}

// ─── BGP Unnumbered (G-19) ───────────────────────────────────────────────────

function nxosBgpUnnumberedBlock(_dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'bgp_unnumbered')) return [];
  const n = d ? d.spinePeerIps.length : 2;
  const leafAsn  = d?.leafAsn  ?? 65100;
  const spineAsn = d?.spineAsn ?? 65000;
  const lines: string[] = ['', '! --- G-19: BGP Unnumbered (RFC 5549) ---', ''];
  for (let i = 0; i < n; i++) {
    const iface = 'Ethernet1/' + (i + 1);
    const hn    = d ? (d.spineHostnames[i] ?? ('SPINE-' + (i + 1))) : ('SPINE-' + (i + 1));
    lines.push('interface ' + iface, '  description P2P-to-' + hn, '  no switchport', '  mtu 9216',
               '  ip address unnumbered loopback0', '  ipv6 address use-link-local-only', '  no shutdown', '');
  }
  lines.push('router bgp ' + leafAsn, '  template peer SPINES-UNNUM', '    remote-as ' + spineAsn,
             '    address-family ipv4 unicast', '      next-hop-self', '      send-community extended');
  for (let j = 0; j < n; j++) {
    const hn2 = d ? (d.spineHostnames[j] ?? ('SPINE-' + (j + 1))) : ('SPINE-' + (j + 1));
    lines.push('  neighbor Ethernet1/' + (j + 1) + ' interface  ! to ' + hn2, '    inherit peer SPINES-UNNUM');
  }
  return lines;
}

function eosBgpUnnumberedBlock(_dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'bgp_unnumbered')) return [];
  const n = d ? d.spinePeerIps.length : 2;
  const leafAsn  = d?.leafAsn  ?? 65100;
  const spineAsn = d?.spineAsn ?? 65000;
  const lines: string[] = ['', '! --- G-19: BGP Unnumbered (RFC 5549) ---', ''];
  for (let i = 0; i < n; i++) {
    const iface = 'Ethernet' + (i + 1) + '/1';
    const hn    = d ? (d.spineHostnames[i] ?? ('SPINE-' + (i + 1))) : ('SPINE-' + (i + 1));
    lines.push('interface ' + iface, '   description P2P-to-' + hn, '   no switchport', '   mtu 9214',
               '   ip address unnumbered Loopback0', '   ipv6 enable', '   no shutdown', '');
  }
  lines.push('router bgp ' + leafAsn, '   neighbor SPINES peer group',
             '   neighbor SPINES remote-as ' + spineAsn,
             '   neighbor SPINES send-community extended',
             '   neighbor SPINES maximum-routes 12000 warning-only');
  for (let j = 0; j < n; j++) {
    const hn2 = d ? (d.spineHostnames[j] ?? ('SPINE-' + (j + 1))) : ('SPINE-' + (j + 1));
    lines.push('   neighbor interface Ethernet' + (j + 1) + '/1 peer-group SPINES  ! to ' + hn2);
  }
  lines.push('   address-family ipv4', '      neighbor SPINES activate', '      neighbor SPINES next-hop-self');
  return lines;
}

function junosBgpUnnumberedBlock(_dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'bgp_unnumbered')) return [];
  const n = d ? d.spinePeerIps.length : 2;
  const spineAsn = d?.spineAsn ?? 65000;
  const lines: string[] = ['', '# --- G-19: BGP Unnumbered (RFC 5549) ---', ''];
  for (let i = 0; i < n; i++) {
    const iface = 'xe-0/0/' + i;
    const hn    = d ? (d.spineHostnames[i] ?? ('SPINE-' + (i + 1))) : ('SPINE-' + (i + 1));
    lines.push('# Interface ' + iface + ' to ' + hn,
               'set interfaces ' + iface + ' unit 0 family inet unnumbered-address lo0.0',
               'set interfaces ' + iface + ' unit 0 family inet6', '');
  }
  lines.push('set protocols bgp group SPINES-UNNUM type external',
             'set protocols bgp group SPINES-UNNUM family inet unicast',
             'set protocols bgp group SPINES-UNNUM peer-as ' + spineAsn);
  for (let j = 0; j < n; j++) {
    const hn2 = d ? (d.spineHostnames[j] ?? ('SPINE-' + (j + 1))) : ('SPINE-' + (j + 1));
    lines.push('set protocols bgp group SPINES-UNNUM local-interface xe-0/0/' + j + '.0  # to ' + hn2);
  }
  return lines;
}

// ─── IPv6 blocks (G-17) ──────────────────────────────────────────────────────

function nxosIPv6Block(dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'ipv6')) return [];
  const unit = dev.unit || 1;
  const v6   = v6Addrs(unit, d ? d.spinePeerIps.length : 2);
  const lines: string[] = ['', '! --- G-17: IPv6 Dual-Stack ---', 'feature ospfv3', 'ipv6 unicast-routing', '',
    'interface loopback0', '  ipv6 address ' + v6.lo0v6 + '/128'];
  if (d) {
    d.spinePeerIps.forEach((_, idx) => {
      lines.push('! interface <p2p-to-spine-' + (idx + 1) + '>',
                 '!   ipv6 address ' + v6.p2pV6[idx].leaf + '/127');
    });
    const leafAsn  = d.leafAsn;
    const spineAsn = d.spineAsn;
    lines.push('', '! BGP IPv6 AF (add under router bgp ' + leafAsn + '):',
               '  address-family ipv6 unicast', '    network ' + v6.lo0v6 + '/128',
               '  template peer SPINES-V6', '    remote-as ' + spineAsn,
               '    address-family ipv6 unicast', '      send-community extended');
    d.spinePeerIps.forEach((_, idx) => {
      lines.push('  neighbor ' + v6.p2pV6[idx].spine + ' inherit peer SPINES-V6',
                 '    description ' + (d.spineHostnames[idx] ?? ('SPINE-' + (idx + 1))));
    });
  }
  return lines;
}

function nxosSpineIPv6Block(dev: DeviceEntry, state: ConfigGenState): string[] {
  if (!hasFeat(state, 'ipv6')) return [];
  const unit  = dev.unit || 1;
  const lo0v6 = 'fd00::' + (100 + unit);
  return ['', '! --- G-17: IPv6 Dual-Stack (Spine) ---', 'feature ospfv3', 'ipv6 unicast-routing', '',
    'interface loopback0', '  ipv6 address ' + lo0v6 + '/128',
    '', '! BGP IPv6 AF (add under router bgp 65000):',
    '  address-family ipv6 unicast', '    retain route-target all',
    '  template peer LEAFS-V6', '    address-family ipv6 unicast',
    '      send-community extended', '      route-reflector-client'];
}

function eosIPv6Block(dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'ipv6')) return [];
  const unit   = dev.unit || 1;
  const v6     = v6Addrs(unit, d ? d.spinePeerIps.length : 2);
  const lo0v6  = d ? v6.lo0v6 : 'fd00::' + (100 + unit);
  const maxP   = state.ecmp?.max_paths ?? 8;
  const lines: string[] = ['', '! --- G-17: IPv6 Dual-Stack ---', 'ipv6 unicast-routing', '',
    'interface Loopback0', '   ipv6 address ' + lo0v6 + '/128'];
  if (d) {
    d.spinePeerIps.forEach((_, idx) => {
      lines.push('! interface <Ethernet-to-SPINE-' + (idx + 1) + '>',
                 '!    ipv6 address ' + v6.p2pV6[idx].leaf + '/127');
    });
    lines.push('', '! BGP IPv6 AF (add under router bgp ' + d.leafAsn + '):',
               '   address-family ipv6', '      neighbor SPINES activate',
               '      network ' + lo0v6 + '/128',
               '      maximum-paths ' + maxP + ' ecmp ' + maxP);
  } else {
    lines.push('', '! BGP IPv6 AF (add under router bgp 65000):',
               '   address-family ipv6', '      neighbor LEAF-PEERS activate');
  }
  return lines;
}

function junosIPv6Block(dev: DeviceEntry, state: ConfigGenState, d: LeafDesign | null): string[] {
  if (!hasFeat(state, 'ipv6')) return [];
  const unit  = dev.unit || 1;
  const v6    = d ? v6Addrs(unit, d.spinePeerIps.length) : null;
  const lo0v6 = d ? v6!.lo0v6 : 'fd00::' + (100 + unit);
  const lines: string[] = ['', '# --- G-17: IPv6 Dual-Stack ---',
    'set interfaces lo0 unit 0 family inet6 address ' + lo0v6 + '/128'];
  if (d && v6) {
    d.spinePeerIps.forEach((_, idx) => {
      lines.push('# set interfaces <p2p-to-spine-' + (idx + 1) + '> unit 0 family inet6 address ' + v6.p2pV6[idx].leaf + '/127');
    });
    lines.push('', 'set protocols bgp group SPINES-V6 type external',
               'set protocols bgp group SPINES-V6 family inet6 unicast',
               'set protocols bgp group SPINES-V6 peer-as ' + d.spineAsn,
               'set protocols bgp group SPINES-V6 local-address ' + lo0v6);
    v6.p2pV6.forEach((pair, idx) => {
      lines.push('set protocols bgp group SPINES-V6 neighbor ' + pair.spine);
      void idx;
    });
  }
  return lines;
}

// ─── Platform config generators ──────────────────────────────────────────────

function nxosSpineConfig(dev: DeviceEntry, state: ConfigGenState): string {
  const hn      = dev.hostname;
  const unit    = dev.unit || 1;
  const lo0ip   = '10.0.0.' + (100 + unit);
  const hasBfd  = hasFeat(state, 'bfd');
  const hasEcmp = hasFeat(state, 'ecmp');
  const timerKey = state.bgp_timers ?? 'dc_aggressive';
  const preset   = BGP_TIMER_PRESETS[timerKey] ?? BGP_TIMER_PRESETS.dc_aggressive;
  const maxPaths = state.ecmp?.max_paths ?? 8;
  const b = state.bfd ?? { interval: 300, min_rx: 300, multiplier: 3 };

  const lines: string[] = [
    '! ' + hn + ' — Cisco NX-OS Spine', 'hostname ' + hn, '',
    'feature bgp', 'feature nv overlay', 'feature vn-segment-vlan-based',
    'feature interface-vlan',
  ];
  if (hasBfd) lines.push('feature bfd');
  lines.push('nv overlay evpn', '', 'interface loopback0', '  ip address ' + lo0ip + '/32',
             '  description BGP router-id', '');
  if (hasBfd) {
    lines.push('! --- BFD global ---',
               'bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier, '');
  }
  lines.push('router bgp 65000', '  router-id ' + lo0ip,
             '  bestpath as-path multipath-relax', '  bestpath compare-routerid',
             '  address-family ipv4 unicast');
  if (hasEcmp) lines.push('    maximum-paths ' + maxPaths);
  lines.push('  address-family l2vpn evpn', '    retain route-target all',
             '  template peer LEAFS', '    update-source loopback0',
             '    timers ' + preset.keepalive + ' ' + preset.hold,
             '    advertisement-interval ' + preset.adv_interval);
  if (hasBfd) lines.push('    bfd');
  lines.push('    send-community extended',
             '    address-family ipv4 unicast', '      maximum-prefix 12000 warning-only',
             '    address-family l2vpn evpn', '      send-community extended',
             '      route-reflector-client',
             '  ! Add leaf neighbors — inherit peer LEAFS per leaf loopback');
  if (hasEcmp) lines.push(nxosEcmpHash(state).trimEnd());
  lines.push(...nxosSpineIPv6Block(dev, state));
  lines.push(...nxosMulticastBlock(dev, state));
  lines.push(...nxosBgpUnnumberedBlock(dev, state, null));
  return lines.join('\n') + '\n';
}

function nxosLeafConfig(dev: DeviceEntry, state: ConfigGenState): string {
  const hn      = dev.hostname;
  const d       = leafDesign(dev, state);
  const ev      = evpnDesign(d, state);
  const hasBfd  = hasFeat(state, 'bfd');
  const hasEcmp = hasFeat(state, 'ecmp');
  const b       = state.bfd ?? { interval: 300, min_rx: 300, multiplier: 3 };

  const lines: string[] = [
    '! ' + hn + ' — Cisco NX-OS Leaf', 'hostname ' + hn, '',
    'feature bgp', 'feature nv overlay', 'feature vn-segment-vlan-based',
    'feature interface-vlan', 'feature lacp', 'feature vpc',
  ];
  if (hasBfd)        lines.push('feature bfd');
  if (ev.esiEnabled) lines.push('feature evpn-multisite');
  lines.push('nv overlay evpn', '');
  if (hasBfd) {
    lines.push('! --- BFD global ---',
               'bfd interval ' + b.interval + ' min_rx ' + b.min_rx + ' multiplier ' + b.multiplier, '');
  }
  lines.push('! --- Loopbacks ---', 'interface loopback0', '  ip address ' + d.lo0ip + '/32',
             '  description BGP router-id', 'interface loopback1', '  ip address ' + d.lo1ip + '/32',
             '  description VTEP source', '',
             '! --- Per VLAN (VNI design) ---', 'vlan ' + d.vlanId, '  name SERVERS',
             '  vn-segment ' + d.l2vni, 'vlan ' + d.l3VlanId,
             '  name L3VNI-' + d.vrfName + '-transit', '  vn-segment ' + d.l3vni, '',
             '! --- NVE interface ---', 'interface nve1', '  no shutdown',
             '  host-reachability protocol bgp', '  source-interface loopback1',
             '  member vni ' + d.l2vni, '    ingress-replication protocol bgp');
  if (ev.arpSuppress) lines.push('    suppress-arp');
  lines.push('  member vni ' + d.l3vni + ' associate-vrf', '',
             '! --- VRF ---', 'vrf context ' + d.vrfName, '  vni ' + d.l3vni, '  rd ' + ev.vrfRd,
             '  address-family ipv4 unicast');
  if (ev.rtMode === 'auto') {
    lines.push('    route-target both auto evpn');
  } else {
    lines.push('    route-target import ' + ev.l3rtImport);
    if (ev.l3rtExport) lines.push('    route-target export ' + ev.l3rtExport);
  }
  if (ev.hasRt5) lines.push('    route-target import evpn route-type 5 ' + ev.l3rtImport);
  lines.push('', '! --- SVIs ---', 'interface Vlan' + d.vlanId, '  no shutdown',
             '  vrf member ' + d.vrfName, '  ip address ' + d.anycastGw + '/' + d.prefix,
             '  fabric forwarding mode anycast-gateway', '',
             'interface Vlan' + d.l3VlanId + '   ! transit VLAN for L3VNI',
             '  no shutdown', '  vrf member ' + d.vrfName, '  ip forward', '',
             '! --- BGP ---', 'router bgp ' + d.leafAsn, '  router-id ' + d.lo0ip,
             '  bestpath as-path multipath-relax', '  bestpath compare-routerid',
             '  address-family ipv4 unicast');
  if (hasEcmp) lines.push('    maximum-paths ' + d.maxPaths);
  lines.push('  address-family l2vpn evpn');
  if (ev.advertisePip) lines.push('    advertise-pip');
  lines.push('  template peer SPINES', '    remote-as ' + d.spineAsn,
             '    timers ' + d.keepalive + ' ' + d.hold + '   ! DC: 3 9 | WAN: 10 30',
             '    advertisement-interval 0');
  if (hasBfd) lines.push('    bfd');
  lines.push('    send-community extended',
             '    address-family ipv4 unicast', '      maximum-prefix 12000 warning-only',
             '    address-family l2vpn evpn', '      send-community extended');
  d.spinePeerIps.forEach((ip, idx) => {
    lines.push('  neighbor ' + ip, '    inherit peer SPINES',
               '    description ' + (d.spineHostnames[idx] ?? ('SPINE-' + (idx + 1))));
  });
  lines.push('  vrf ' + d.vrfName, '    address-family ipv4 unicast',
             '      redistribute direct route-map RMAP-CONNECTED');
  if (hasEcmp) lines.push('      maximum-paths ' + d.maxPaths);
  lines.push('', '! --- EVPN section ---', 'evpn', '  vni ' + d.l2vni + ' l2',
             '    rd ' + ev.l2Rd, '    route-target import ' + ev.l2rtImport,
             '    route-target export ' + ev.l2rtExport);
  if (ev.hasRt5) {
    lines.push('  vni ' + d.l3vni + ' l3', '    rd ' + ev.vrfRd,
               '    route-target import ' + ev.l3rtImport);
    if (ev.l3rtExport) lines.push('    route-target export ' + ev.l3rtExport);
  }
  if (ev.esiEnabled) {
    lines.push('', '! --- ESI multi-homing ---', 'evpn multihoming', '  system-mac auto');
  }
  lines.push('', ...nxosStpBlock(state));
  if (!state.intent.protocols.overlay.includes('vxlan_evpn')) {
    const vl = nxosVrfLiteBlock(state);
    if (vl.length) lines.push('', ...vl);
  }
  const ql = nxosQosBlock(state);
  if (ql.length) lines.push('', ...ql);
  lines.push(...nxosIPv6Block(dev, state, d));
  lines.push(...nxosMulticastBlock(dev, state));
  lines.push(...nxosBgpUnnumberedBlock(dev, state, d));
  return lines.join('\n') + '\n';
}

function aristaSpineConfig(dev: DeviceEntry, state: ConfigGenState): string {
  const hn      = dev.hostname;
  const unit    = dev.unit || 1;
  const lo0     = '10.0.0.' + (100 + unit);
  const hasBfd  = hasFeat(state, 'bfd');
  const hasEcmp = hasFeat(state, 'ecmp');
  const maxP    = state.ecmp?.max_paths ?? 8;
  const timerKey = state.bgp_timers ?? 'dc_aggressive';
  const preset   = BGP_TIMER_PRESETS[timerKey] ?? BGP_TIMER_PRESETS.dc_aggressive;

  const lines: string[] = [
    '! ' + hn + ' — Arista EOS Spine', 'hostname ' + hn, '',
    'service routing protocols model multi-agent', '',
    'ip routing', '',
    'interface Loopback0', '   ip address ' + lo0 + '/32', '   description BGP router-id', '',
    'router bgp 65000', '   router-id ' + lo0, '   bgp asn notation asdot',
    '   bgp bestpath as-path multipath-relax',
    '   neighbor LEAF-PEERS peer group', '   neighbor LEAF-PEERS send-community extended',
  ];
  if (hasBfd) lines.push('   neighbor LEAF-PEERS bfd');
  lines.push('   neighbor LEAF-PEERS timers ' + preset.keepalive + ' ' + preset.hold,
             '   neighbor LEAF-PEERS advertisement-interval ' + preset.adv_interval,
             '   bgp listen range 10.0.0.0/16 peer-group LEAF-PEERS',
             '   address-family evpn', '      neighbor LEAF-PEERS activate',
             '   address-family ipv4', '      neighbor LEAF-PEERS activate',
             '      neighbor LEAF-PEERS next-hop-unchanged');
  if (hasEcmp) lines.push('      maximum-paths ' + maxP + ' ecmp ' + maxP);
  lines.push(...eosIPv6Block(dev, state, null));
  lines.push(...eosMulticastBlock(dev, state));
  lines.push(...eosBgpUnnumberedBlock(dev, state, null));
  return lines.join('\n') + '\n';
}

function aristaLeafConfig(dev: DeviceEntry, state: ConfigGenState): string {
  const hn      = dev.hostname;
  const d       = leafDesign(dev, state);
  const ev      = evpnDesign(d, state);
  const hasBfd  = hasFeat(state, 'bfd');
  const hasEcmp = hasFeat(state, 'ecmp');

  const lines: string[] = [
    '! ' + hn + ' — Arista EOS Leaf', 'hostname ' + hn, '',
    'service routing protocols model multi-agent', '', 'ip routing', 'ip routing vrf ' + d.vrfName, '',
    'interface Loopback0', '   ip address ' + d.lo0ip + '/32', '   description BGP router-id',
    'interface Loopback1', '   ip address ' + d.lo1ip + '/32', '   description VTEP source', '',
    'vlan ' + d.vlanId, '   name SERVERS', '', 'vrf instance ' + d.vrfName, '',
    'interface Vlan' + d.vlanId, '   vrf ' + d.vrfName, '   ip address virtual ' + d.anycastGw + '/' + d.prefix, '',
    'interface Vxlan1', '   vxlan source-interface Loopback1', '   vxlan udp-port 4789',
    '   vxlan vlan ' + d.vlanId + ' vni ' + d.l2vni,
    '   vxlan vrf ' + d.vrfName + ' vni ' + d.l3vni, '',
    'router bgp ' + d.leafAsn, '   router-id ' + d.lo0ip,
    '   bgp bestpath as-path multipath-relax', '   neighbor SPINES peer group',
    '   neighbor SPINES remote-as ' + d.spineAsn,
  ];
  if (hasBfd) { lines.push('   neighbor SPINES bfd'); lines.push(eosBfdSlowTimer(state).trimEnd()); }
  lines.push('   neighbor SPINES timers ' + d.keepalive + ' ' + d.hold,
             '   neighbor SPINES advertisement-interval 0',
             '   neighbor SPINES send-community extended',
             '   neighbor SPINES maximum-routes 12000 warning-only');
  d.spinePeerIps.forEach((ip, idx) => {
    lines.push('   neighbor ' + ip + ' peer group SPINES',
               '   neighbor ' + ip + ' description ' + (d.spineHostnames[idx] ?? ('SPINE-' + (idx + 1))));
  });
  lines.push('   address-family evpn', '      neighbor SPINES activate',
             '   address-family ipv4', '      neighbor SPINES activate');
  if (hasEcmp) lines.push('      maximum-paths ' + d.maxPaths + ' ecmp ' + d.maxPaths);
  lines.push('      network ' + d.lo0ip + '/32', '      network ' + d.lo1ip + '/32',
             '   vlan ' + d.vlanId, '      rd ' + ev.l2Rd);
  if (ev.rtMode === 'auto') lines.push('      route-target both auto');
  else {
    lines.push('      route-target import evpn ' + ev.l2rtImport,
               '      route-target export evpn ' + ev.l2rtExport);
  }
  lines.push('      redistribute learned', '   vrf ' + d.vrfName, '      rd ' + ev.vrfRd);
  if (ev.rtMode === 'auto') {
    lines.push('      route-target import evpn auto', '      route-target export evpn auto');
  } else {
    lines.push('      route-target import evpn ' + ev.l3rtImport);
    if (ev.l3rtExport) lines.push('      route-target export evpn ' + ev.l3rtExport);
  }
  if (ev.hasRt5) lines.push('      route-target import evpn ' + ev.l3rtImport + ' ip-prefix');
  lines.push('      redistribute connected', '      maximum-paths ' + d.maxPaths);
  if (ev.esiEnabled) lines.push('', '! --- ESI ---', 'evpn', '   multihoming recovery-delay 180');
  lines.push('', ...eosStpBlock(state));
  if (!state.intent.protocols.overlay.includes('vxlan_evpn')) {
    const vl = eosVrfLiteBlock(state);
    if (vl.length) lines.push('', ...vl);
  }
  const ql = eosQosBlock(state);
  if (ql.length) lines.push('', ...ql);
  lines.push(...eosIPv6Block(dev, state, d));
  lines.push(...eosMulticastBlock(dev, state));
  lines.push(...eosBgpUnnumberedBlock(dev, state, d));
  return lines.join('\n') + '\n';
}

function juniperLeafConfig(dev: DeviceEntry, state: ConfigGenState): string {
  const hn = dev.hostname;
  const d  = leafDesign(dev, state);
  const ev = evpnDesign(d, state);

  const lines: string[] = [
    '# ' + hn + ' — Juniper QFX JunOS Leaf',
    'set system host-name ' + hn, '',
    'set routing-options router-id ' + d.lo0ip,
    'set routing-options autonomous-system ' + d.leafAsn, '',
    'set interfaces lo0 unit 0 family inet address ' + d.lo0ip + '/32  ! Loopback0',
    'set interfaces lo0 unit 1 family inet address ' + d.lo1ip + '/32  ! VTEP Loopback1', '',
    '# --- EVPN VXLAN ---',
    'set protocols evpn encapsulation vxlan',
    'set protocols evpn extended-vni-list all',
    'set protocols evpn default-gateway advertise', '',
    'set bridge-domains BD-' + d.vlanId + ' vlan-id ' + d.vlanId,
    'set bridge-domains BD-' + d.vlanId + ' vxlan vni ' + d.l2vni, '',
    'set routing-instances EVPN-VRF instance-type vrf',
    'set routing-instances EVPN-VRF routing-table-export EVPN-RT',
    'set routing-instances EVPN-VRF vxlan-v4-anycast-gateways ' + d.anycastGw + '/' + d.prefix, '',
    '# --- BGP ---',
    'set protocols bgp group SPINES type external',
    'set protocols bgp group SPINES peer-as ' + d.spineAsn,
    'set protocols bgp group SPINES local-as ' + d.leafAsn,
    'set protocols bgp group SPINES family inet unicast',
    'set protocols bgp group SPINES family evpn signaling',
    'set protocols bgp group SPINES bfd-liveness-detection minimum-interval ' + (state.bfd?.interval ?? 300),
    'set protocols bgp group SPINES bfd-liveness-detection multiplier ' + (state.bfd?.multiplier ?? 3),
    'set protocols bgp group SPINES hold-time ' + d.hold,
    'set protocols bgp group SPINES keepalive ' + d.keepalive,
  ];
  d.spinePeerIps.forEach((ip, idx) => {
    lines.push('set protocols bgp group SPINES neighbor ' + ip + ' description ' + (d.spineHostnames[idx] ?? ('SPINE-' + (idx + 1))));
  });
  lines.push('', '# VRF routing',
             'set routing-instances ' + d.vrfName + ' instance-type vrf',
             'set routing-instances ' + d.vrfName + ' vrf-target target:' + ev.l2rtImport, '',
             ...junosStpBlock(state));
  if (!state.intent.protocols.overlay.includes('vxlan_evpn')) {
    const vl = junosVrfLiteBlock(state);
    if (vl.length) lines.push('', ...vl);
  }
  const ql = junosQosBlock(state);
  if (ql.length) lines.push('', ...ql);
  lines.push(...junosIPv6Block(dev, state, d));
  lines.push(...junosMulticastBlock(dev, state));
  lines.push(...junosBgpUnnumberedBlock(dev, state, d));
  return lines.join('\n') + '\n';
}

function genericConfig(dev: DeviceEntry, _state: ConfigGenState): string {
  return (
    `! ${dev.hostname} — ${dev.vendor} ${dev.model}\n` +
    `! Role: ${dev.subLayer}\n` +
    `hostname ${dev.hostname}\n` +
    `! Platform-specific config generation not yet implemented for this vendor/role combination.\n`
  );
}

// ─── Platform dispatch table ─────────────────────────────────────────────────

type GenFn = (dev: DeviceEntry, state: ConfigGenState) => string;

const VENDOR_GEN: Record<string, Record<string, GenFn>> = {
  Cisco: {
    spine: nxosSpineConfig,
    leaf:  nxosLeafConfig,
    default: genericConfig,
  },
  Arista: {
    spine: aristaSpineConfig,
    leaf:  aristaLeafConfig,
    default: genericConfig,
  },
  Juniper: {
    leaf:  juniperLeafConfig,
    default: genericConfig,
  },
};

// ─── Main entry point ─────────────────────────────────────────────────────────

export function generateAllConfigs(
  intent: IntentObject,
  devices: DeviceEntry[],
  options?: Partial<Omit<ConfigGenState, 'intent' | 'devices'>>,
): Record<string, string> {
  const state: ConfigGenState = { intent, devices, ...options };
  const configs: Record<string, string> = {};

  for (const dev of devices) {
    const vendorGens = VENDOR_GEN[dev.vendor] ?? {};
    const genFn = vendorGens[dev.subLayer] ?? vendorGens['default'] ?? genericConfig;
    configs[dev.hostname] = genFn(dev, state);
  }

  return configs;
}
