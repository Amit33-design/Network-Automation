'use strict';

// ─── Jinja2 Config Engine — browser module ────────────────────────────────────
// Generates inventory.json from current STATE and provides downloads for the
// Python/Jinja2 engine + templates. Templates mirror configgen.js output.

// ─── Inventory builder ────────────────────────────────────────────────────────

function _devPlatform(dev) {
  var v = (dev.vendor || '').toLowerCase();
  var r = dev.subLayer || '';
  if (v === 'cisco') {
    if (r === 'pe-router' || r === 'p-router') return 'iosxr';
    if (r === 'wan-edge' || r === 'sdwan-controller' || r === 'sdwan-orchestrator') return 'iosxe';
    return 'nxos';
  }
  if (v === 'arista')  return 'eos';
  if (v === 'juniper') return 'junos';
  if (v === 'nvidia')  return 'sonic';
  return 'generic';
}

function _leafAsn(unit)  { return 65100 + Math.floor((unit - 1) / 2); }
function _spineAsn()     { return 65000; }
function _leafLo0(unit)  { return '10.0.0.' + unit; }
function _leafLo1(unit)  { return '10.1.0.' + unit; }
function _spineLo0(unit) { return '10.0.0.' + (100 + unit); }
function _spineLo1(unit) { return '10.1.0.' + (100 + unit); }

// P2P: leaf unit N, spine index I (0-based)
// leaf side: 192.168.(N*10 + I*2).0/31
// spine side: 192.168.(N*10 + I*2).1/31
function _p2p(leafUnit, spineIdx) {
  var base = leafUnit * 10 + spineIdx * 2;
  return { leaf: '192.168.' + base + '.0', spine: '192.168.' + base + '.1' };
}

window.genJinjaInventory = function(state) {
  var devices  = state.devices || [];
  var leaves   = devices.filter(function(d) { return d.subLayer === 'leaf'; });
  var spines   = devices.filter(function(d) { return d.subLayer === 'spine'; });
  var peRouters = devices.filter(function(d) { return d.subLayer === 'pe-router'; });
  var pRouters  = devices.filter(function(d) { return d.subLayer === 'p-router'; });

  var timerPreset = state.bgp_timers || 'dc_aggressive';
  var timerMap = {
    dc_aggressive: { k: 3, h: 9, adv: 0 },
    wan_standard:  { k: 10, h: 30, adv: 5 },
    conservative:  { k: 60, h: 180, adv: 30 }
  };
  var timers = timerMap[timerPreset] || timerMap.dc_aggressive;

  // Build enriched device objects
  var enriched = devices.map(function(dev) {
    var unit = dev.unit || 1;
    var base = {
      hostname:    dev.hostname,
      host:        dev.mgmtIp || ('192.168.1.' + unit),
      vendor:      dev.vendor || 'Cisco',
      platform:    _devPlatform(dev),
      sub_layer:   dev.subLayer,
      unit:        unit
    };

    if (dev.subLayer === 'leaf') {
      var leafAsn = _leafAsn(unit);
      base.bgp_asn    = leafAsn;
      base.spine_asn  = _spineAsn();
      base.lo0_ip     = _leafLo0(unit);
      base.lo1_ip     = _leafLo1(unit);
      base.vlan_id    = 10;
      base.l2vni      = 10010;
      base.l3vni      = 50001 + Math.floor((unit - 1) / 2);
      base.l3vni_vlan = 3001  + Math.floor((unit - 1) / 2);
      base.vrf_name   = 'PROD';
      base.anycast_gw = '10.10.' + unit + '.1';
      base.prefix     = 24;
      base.spine_peers = spines.map(function(sp, idx) {
        var p2p = _p2p(unit, idx);
        return {
          hostname:      sp.hostname,
          spine_p2p_ip:  p2p.spine,
          leaf_p2p_ip:   p2p.leaf,
          bgp_asn:       _spineAsn()
        };
      });
    } else if (dev.subLayer === 'spine') {
      base.bgp_asn   = _spineAsn();
      base.lo0_ip    = _spineLo0(unit);
      base.lo1_ip    = _spineLo1(unit);
      base.leaf_peers = leaves.map(function(lf, lfIdx) {
        var p2p = _p2p(lf.unit || (lfIdx + 1), spines.indexOf(dev));
        return {
          hostname:     lf.hostname,
          leaf_p2p_ip:  p2p.leaf,
          spine_p2p_ip: p2p.spine,
          bgp_asn:      _leafAsn(lf.unit || (lfIdx + 1))
        };
      });
    } else if (dev.subLayer === 'pe-router') {
      base.bgp_asn  = state.bgp_asn || 65001;
      base.lo0_ip   = '10.0.10.' + unit;
      base.lo1_ip   = '10.0.11.' + unit;
      base.rr_ip    = '10.0.10.1';
      base.vrf_name = 'CUST-A';
      base.p_peers  = pRouters.map(function(pr, idx) {
        return {
          hostname:    pr.hostname,
          pe_p2p_ip:   '10.3.' + unit + '.' + (idx * 2),
          p_p2p_ip:    '10.3.' + unit + '.' + (idx * 2 + 1)
        };
      });
    } else if (dev.subLayer === 'p-router') {
      base.bgp_asn  = state.bgp_asn || 65001;
      base.lo0_ip   = '10.0.20.' + unit;
      base.pe_peers = peRouters.map(function(pe, idx) {
        return {
          hostname:    pe.hostname,
          p_p2p_ip:    '10.3.' + unit + '.' + (idx * 2 + 1),
          pe_p2p_ip:   '10.3.' + unit + '.' + (idx * 2)
        };
      });
    } else if (dev.subLayer === 'wan-edge') {
      base.bgp_asn      = 65200 + unit;
      base.lo0_ip       = '10.0.30.' + unit;
      base.wan_interfaces = [
        { name: 'GigabitEthernet0/0', desc: 'WAN-PRIMARY',   ip: '10.99.' + unit + '.2', mask: '255.255.255.252' },
        { name: 'GigabitEthernet0/1', desc: 'WAN-SECONDARY', ip: '10.98.' + unit + '.2', mask: '255.255.255.252' }
      ];
      base.bgp_peers    = [{ ip: '10.99.' + unit + '.1', asn: 65300, desc: 'ISP-PRIMARY' }];
    } else if (dev.subLayer === 'sdwan-controller') {
      base.bgp_asn  = state.bgp_asn || 65001;
      base.lo0_ip   = '10.0.200.' + unit;
    } else if (dev.subLayer === 'sdwan-orchestrator') {
      base.bgp_asn  = state.bgp_asn || 65001;
      base.lo0_ip   = '10.0.201.' + unit;
    } else {
      base.bgp_asn = 65000;
      base.lo0_ip  = '10.0.50.' + unit;
      base.lo1_ip  = '10.0.51.' + unit;
    }

    return base;
  });

  var inv = {
    site:             state.siteCode || 'SITE',
    generated_at:     new Date().toISOString(),
    use_case:         state.useCase || 'dc',
    bgp_keepalive:    timers.k,
    bgp_hold:         timers.h,
    bgp_adv_interval: timers.adv,
    protocols: {
      underlay: (state.protocols && state.protocols.underlay) || 'bgp',
      overlay:  (state.protocols && state.protocols.overlay)  || [],
      features: (state.protocols && state.protocols.features) || []
    },
    topology: {
      endpoint_count: (state.topology && state.topology.endpoint_count) || 0,
      bandwidth_gbps: (state.topology && state.topology.bandwidth_gbps) || 25,
      ecmp_paths:     (state.ecmp && state.ecmp.max_paths) || 8,
      oversubscription: (state.topology && state.topology.oversubscription) || 3
    },
    devices: enriched
  };

  return JSON.stringify(inv, null, 2);
};

// ─── Template registry (mirrors actual files in backend/configengine/templates) ─

var JINJA_TEMPLATES = {};

JINJA_TEMPLATES['nxos/spine.j2'] = [
  '{# NX-OS Spine — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  'feature bgp',
  'feature bfd',
  'feature lldp',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  'feature nv overlay',
  'nv overlay evpn',
  '{% endif %}',
  '!',
  'interface loopback0',
  '  description ROUTER-ID',
  '  ip address {{ device.lo0_ip }}/32',
  '!',
  '{% for peer in device.leaf_peers %}',
  'interface Ethernet{{ loop.index }}/1',
  '  description DOWNLINK-{{ peer.hostname }}',
  '  no switchport',
  '  ip address {{ peer.spine_p2p_ip }}/31',
  '  no shutdown',
  '!',
  '{% endfor %}',
  'router bgp {{ device.bgp_asn }}',
  '  router-id {{ device.lo0_ip }}',
  '  bestpath as-path multipath-relax',
  '  bestpath compare-routerid',
  '  address-family ipv4 unicast',
  '    maximum-paths {{ site.topology.ecmp_paths | default(8) }}',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  '  address-family l2vpn evpn',
  '    retain route-target all',
  '{% endif %}',
  '  template peer LEAFS',
  '    timers {{ site.bgp_keepalive | default(3) }} {{ site.bgp_hold | default(9) }}',
  '    advertisement-interval {{ site.bgp_adv_interval | default(0) }}',
  '    bfd',
  '    send-community extended',
  '    address-family ipv4 unicast',
  '      route-reflector-client',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  '    address-family l2vpn evpn',
  '      route-reflector-client',
  '      send-community extended',
  '{% endif %}',
  '{% for peer in device.leaf_peers %}',
  '  neighbor {{ peer.leaf_p2p_ip }}',
  '    inherit peer LEAFS',
  '    remote-as {{ peer.bgp_asn }}',
  '    description {{ peer.hostname }}',
  '{% endfor %}',
  '!'
].join('\n');

JINJA_TEMPLATES['nxos/leaf.j2'] = [
  '{# NX-OS Leaf — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  'feature bgp',
  'feature bfd',
  'feature interface-vlan',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  'feature nv overlay',
  'feature vn-segment-vlan-based',
  'nv overlay evpn',
  '{% endif %}',
  '!',
  'interface loopback0',
  '  ip address {{ device.lo0_ip }}/32',
  '!',
  'interface loopback1',
  '  ip address {{ device.lo1_ip }}/32',
  '!',
  '{% for peer in device.spine_peers %}',
  'interface Ethernet1/{{ loop.index }}',
  '  description UPLINK-{{ peer.hostname }}',
  '  no switchport',
  '  ip address {{ peer.leaf_p2p_ip }}/31',
  '  no shutdown',
  '!',
  '{% endfor %}',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  'vlan {{ device.vlan_id }}',
  '  vn-segment {{ device.l2vni }}',
  '!',
  'interface nve1',
  '  no shutdown',
  '  host-reachability protocol bgp',
  '  source-interface loopback1',
  '  member vni {{ device.l2vni }}',
  '    ingress-replication protocol bgp',
  '  member vni {{ device.l3vni }} associate-vrf',
  '!',
  'vrf context {{ device.vrf_name }}',
  '  vni {{ device.l3vni }}',
  '  rd auto',
  '  address-family ipv4 unicast',
  '    route-target both auto evpn',
  '{% endif %}',
  'router bgp {{ device.bgp_asn }}',
  '  router-id {{ device.lo0_ip }}',
  '  bestpath as-path multipath-relax',
  '  template peer SPINES',
  '    remote-as {{ device.spine_asn }}',
  '    timers {{ site.bgp_keepalive | default(3) }} {{ site.bgp_hold | default(9) }}',
  '    bfd',
  '{% for peer in device.spine_peers %}',
  '  neighbor {{ peer.spine_p2p_ip }}',
  '    inherit peer SPINES',
  '    description {{ peer.hostname }}',
  '{% endfor %}',
  '!'
].join('\n');

JINJA_TEMPLATES['eos/spine.j2'] = [
  '{# Arista EOS Spine — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  '{% if \'vxlan_evpn\' in site.protocols.overlay | default([]) %}',
  'service routing protocols model multi-agent',
  '{% endif %}',
  '!',
  'interface Loopback0',
  '   ip address {{ device.lo0_ip }}/32',
  '!',
  '{% for peer in device.leaf_peers %}',
  'interface Ethernet{{ loop.index }}/1',
  '   description DOWNLINK-{{ peer.hostname }}',
  '   no switchport',
  '   ip address {{ peer.spine_p2p_ip }}/31',
  '!',
  '{% endfor %}',
  'router bgp {{ device.bgp_asn }}',
  '   router-id {{ device.lo0_ip }}',
  '   bgp bestpath as-path multipath-relax',
  '   maximum-paths {{ site.topology.ecmp_paths | default(8) }}',
  '   peer-group LEAFS',
  '      bfd',
  '      timers {{ site.bgp_keepalive | default(3) }} {{ site.bgp_hold | default(9) }}',
  '      send-community extended',
  '{% for peer in device.leaf_peers %}',
  '   neighbor {{ peer.leaf_p2p_ip }} peer group LEAFS',
  '   neighbor {{ peer.leaf_p2p_ip }} remote-as {{ peer.bgp_asn }}',
  '   neighbor {{ peer.leaf_p2p_ip }} description {{ peer.hostname }}',
  '{% endfor %}',
  '   address-family ipv4',
  '      neighbor LEAFS activate',
  '!'
].join('\n');

JINJA_TEMPLATES['eos/leaf.j2'] = [
  '{# Arista EOS Leaf — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  'interface Loopback0',
  '   ip address {{ device.lo0_ip }}/32',
  '!',
  '{% for peer in device.spine_peers %}',
  'interface Ethernet{{ loop.index }}/1',
  '   description UPLINK-{{ peer.hostname }}',
  '   no switchport',
  '   ip address {{ peer.leaf_p2p_ip }}/31',
  '!',
  '{% endfor %}',
  'router bgp {{ device.bgp_asn }}',
  '   router-id {{ device.lo0_ip }}',
  '   bgp bestpath as-path multipath-relax',
  '   peer-group SPINES',
  '      remote-as {{ device.spine_asn }}',
  '      bfd',
  '      timers {{ site.bgp_keepalive | default(3) }} {{ site.bgp_hold | default(9) }}',
  '{% for peer in device.spine_peers %}',
  '   neighbor {{ peer.spine_p2p_ip }} peer group SPINES',
  '   neighbor {{ peer.spine_p2p_ip }} description {{ peer.hostname }}',
  '{% endfor %}',
  '   address-family ipv4',
  '      neighbor SPINES activate',
  '!'
].join('\n');

JINJA_TEMPLATES['junos/leaf.j2'] = [
  '{# Juniper JunOS Leaf — NetDesign AI Jinja2 Engine #}',
  'set system host-name {{ device.hostname }}',
  'set interfaces lo0 unit 0 family inet address {{ device.lo0_ip }}/32',
  '{% for peer in device.spine_peers %}',
  'set interfaces xe-0/0/{{ loop.index0 }} description UPLINK-{{ peer.hostname }}',
  'set interfaces xe-0/0/{{ loop.index0 }} unit 0 family inet address {{ peer.leaf_p2p_ip }}/31',
  '{% endfor %}',
  'set routing-options autonomous-system {{ device.bgp_asn }}',
  'set routing-options router-id {{ device.lo0_ip }}',
  'set protocols bgp group SPINES type external',
  'set protocols bgp group SPINES family inet unicast',
  'set protocols bgp group SPINES bfd-liveness-detection minimum-interval 300',
  'set protocols bgp group SPINES bfd-liveness-detection multiplier 3',
  '{% for peer in device.spine_peers %}',
  'set protocols bgp group SPINES neighbor {{ peer.spine_p2p_ip }} peer-as {{ device.spine_asn | default(65000) }}',
  '{% endfor %}'
].join('\n');

JINJA_TEMPLATES['iosxr/pe_router.j2'] = [
  '{# IOS-XR PE Router — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  'interface Loopback0',
  ' ipv4 address {{ device.lo0_ip }} 255.255.255.255',
  '!',
  '{% for peer in device.p_peers %}',
  'interface GigabitEthernet0/0/0/{{ loop.index0 }}',
  ' description P-LINK-{{ peer.hostname }}',
  ' ipv4 address {{ peer.pe_p2p_ip }} 255.255.255.254',
  ' bfd minimum-interval 300',
  ' bfd multiplier 3',
  ' no shutdown',
  '!',
  '{% endfor %}',
  'router isis CORE',
  ' is-type level-2-only',
  ' net 49.0001.{{ \'%04x\' % device.unit }}.0000.00',
  ' address-family ipv4 unicast',
  '  segment-routing mpls',
  ' !',
  '!',
  'router bgp {{ device.bgp_asn }}',
  ' bgp router-id {{ device.lo0_ip }}',
  ' address-family vpnv4 unicast',
  ' !',
  ' neighbor {{ device.rr_ip | default(\'10.0.0.1\') }}',
  '  remote-as {{ device.bgp_asn }}',
  '  update-source Loopback0',
  '  address-family vpnv4 unicast',
  '  !',
  ' !',
  '!'
].join('\n');

JINJA_TEMPLATES['iosxe/wan_edge.j2'] = [
  '{# IOS-XE WAN Edge — NetDesign AI Jinja2 Engine #}',
  'hostname {{ device.hostname }}',
  '!',
  'interface Loopback0',
  ' ip address {{ device.lo0_ip }} 255.255.255.255',
  '!',
  '{% for iface in device.wan_interfaces | default([]) %}',
  'interface {{ iface.name }}',
  ' description {{ iface.desc | default(\'WAN\') }}',
  ' ip address {{ iface.ip }} {{ iface.mask }}',
  ' no shutdown',
  '!',
  '{% endfor %}',
  'router bgp {{ device.bgp_asn }}',
  ' bgp router-id {{ device.lo0_ip }}',
  '{% for peer in device.bgp_peers | default([]) %}',
  ' neighbor {{ peer.ip }} remote-as {{ peer.asn }}',
  ' neighbor {{ peer.ip }} description {{ peer.desc | default(\'WAN-PEER\') }}',
  '{% endfor %}',
  '!'
].join('\n');

JINJA_TEMPLATES['sonic/leaf.j2'] = [
  '{# NVIDIA SONiC Leaf — config_db.json fragment — NetDesign AI Jinja2 Engine #}',
  '{',
  '  "DEVICE_METADATA": {"localhost": {"hostname": "{{ device.hostname }}", "type": "LeafRouter"}},',
  '  "LOOPBACK_INTERFACE": {"Loopback0": {}, "Loopback0|{{ device.lo0_ip }}/32": {}},',
  '  "BGP_NEIGHBOR": {',
  '{% for peer in device.spine_peers %}',
  '    "{{ peer.spine_p2p_ip }}": {"asn": "{{ device.spine_asn | default(65000) }}", "name": "{{ peer.hostname }}"}{{ "," if not loop.last }}',
  '{% endfor %}',
  '  }',
  '}'
].join('\n');

// ─── UI rendering ─────────────────────────────────────────────────────────────

window.renderJinjaEnginePane = function(state) {
  var devices  = state.devices || [];
  var hasDevs  = devices.length > 0;

  // Template file list for display
  var templateList = Object.keys(JINJA_TEMPLATES);

  var html = '<div class="form-section">'
    + '<h3 style="margin:0 0 4px;">Python / Jinja2 Config Engine</h3>'
    + '<p style="color:var(--text-dim);font-size:13px;margin:0 0 14px;">'
    + 'Generates production configs from Jinja2 templates — fully editable, version-controllable. '
    + 'Export inventory.json from your design, then run <code>engine.py</code> locally.'
    + '</p>'
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12px;">'
    + '<strong style="display:block;margin-bottom:8px;color:var(--text);">Quick start</strong>'
    + '<pre class="config-pre" style="margin:0;font-size:11px;background:transparent;border:none;padding:0;">'
    + '# 1. Download all files (buttons below)\n'
    + '# 2. Install dependency\n'
    + 'pip install jinja2\n\n'
    + '# 3. Render all device configs\n'
    + 'python engine.py --inventory inventory.json --out configs/\n\n'
    + '# 4. Preview a single device\n'
    + 'python engine.py --inventory inventory.json --device LEAF-01 --dry-run\n\n'
    + '# 5. List all devices in inventory\n'
    + 'python engine.py --inventory inventory.json --list'
    + '</pre>'
    + '</div>';

  // Download buttons row
  html += '<div class="btn-toolbar" style="margin-bottom:16px;flex-wrap:wrap;gap:8px;">'
    + '<button class="btn btn-primary" onclick="window.downloadJinjaInventory()" '
    +   (hasDevs ? '' : 'disabled title="Complete Step 1 first"') + '>&#8595; inventory.json</button>'
    + '<button class="btn btn-secondary" onclick="window.downloadJinjaEngine()">&#8595; engine.py</button>'
    + '<button class="btn btn-secondary" onclick="window.downloadAllJinjaTemplates()">&#8595; All Templates (.zip script)</button>'
    + '</div>';

  // Inventory preview
  html += '<div style="margin-bottom:16px;">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:6px;">inventory.json preview</div>';

  if (!hasDevs) {
    html += '<p class="empty-state">Complete Step 1 first to generate inventory.</p>';
  } else {
    var invJson = window.genJinjaInventory(state);
    html += '<pre class="config-pre" style="max-height:260px;font-size:11px;">'
      + invJson.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      + '</pre>';
  }
  html += '</div>';

  // Template browser
  html += '<div style="margin-bottom:12px;">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:8px;">Jinja2 Templates — ' + templateList.length + ' files</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">';

  templateList.forEach(function(name) {
    var safeName = name.replace(/\//g, '-').replace('.j2', '');
    html += '<button class="btn btn-secondary" style="font-size:11px;padding:4px 8px;" '
      + 'onclick="window.showJinjaTemplate(\'' + name + '\')">' + name + '</button>';
  });

  html += '</div>'
    + '<div id="jinja-template-viewer" style="display:none;">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
    + '<span id="jinja-tmpl-name" style="font-size:12px;font-weight:600;color:var(--accent);"></span>'
    + '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="window.downloadCurrentJinjaTemplate()">&#8595; Download</button>'
    + '<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="document.getElementById(\'jinja-template-viewer\').style.display=\'none\'">&#215; Close</button>'
    + '</div>'
    + '<pre id="jinja-tmpl-content" class="config-pre" style="max-height:320px;font-size:11px;"></pre>'
    + '</div>'
    + '</div>';

  // Template map table
  html += '<div class="table-scroll"><table class="bom-table"><thead><tr><th>Vendor</th><th>Role</th><th>Template</th><th>Platform</th></tr></thead><tbody>';
  [
    ['Cisco',   'spine',              'nxos/spine.j2',     'NX-OS'],
    ['Cisco',   'leaf',               'nxos/leaf.j2',      'NX-OS'],
    ['Cisco',   'pe-router',          'iosxr/pe_router.j2','IOS-XR'],
    ['Cisco',   'p-router',           'iosxr/p_router.j2', 'IOS-XR'],
    ['Cisco',   'wan-edge',           'iosxe/wan_edge.j2', 'IOS-XE'],
    ['Arista',  'spine',              'eos/spine.j2',      'EOS'],
    ['Arista',  'leaf',               'eos/leaf.j2',       'EOS'],
    ['Juniper', 'leaf',               'junos/leaf.j2',     'JunOS'],
    ['NVIDIA',  'leaf',               'sonic/leaf.j2',     'SONiC'],
  ].forEach(function(row) {
    html += '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td>'
      + '<td style="font-family:monospace;font-size:11px;">' + row[2] + '</td>'
      + '<td><span class="platform-badge">' + row[3] + '</span></td></tr>';
  });
  html += '</tbody></table></div>';

  html += '</div>';
  return html;
};

// ─── Download helpers ─────────────────────────────────────────────────────────

window.downloadJinjaInventory = function() {
  if (!window.STATE || !window.STATE.devices || !window.STATE.devices.length) {
    if (window.showToast) window.showToast('Complete Step 1 first', 'warning');
    return;
  }
  var json = window.genJinjaInventory(window.STATE);
  var blob = new Blob([json], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inventory.json';
  a.click();
  if (window.showToast) window.showToast('inventory.json downloaded', 'success');
};

window.downloadJinjaEngine = function() {
  // Fetch engine.py content embedded as a string
  var script = _enginePyContent();
  var blob = new Blob([script], { type: 'text/x-python' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'engine.py';
  a.click();
  if (window.showToast) window.showToast('engine.py downloaded', 'success');
};

window.showJinjaTemplate = function(name) {
  var content = JINJA_TEMPLATES[name] || '# Template not found: ' + name;
  var viewer  = document.getElementById('jinja-template-viewer');
  var nameEl  = document.getElementById('jinja-tmpl-name');
  var pre     = document.getElementById('jinja-tmpl-content');
  if (!viewer || !nameEl || !pre) return;
  nameEl.textContent = name;
  pre.textContent    = content;
  viewer.style.display = 'block';
  viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  window._currentJinjaTemplate = name;
};

window.downloadCurrentJinjaTemplate = function() {
  var name = window._currentJinjaTemplate;
  if (!name) return;
  var content = JINJA_TEMPLATES[name] || '';
  var blob = new Blob([content], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/\//g, '_');
  a.click();
};

window.downloadAllJinjaTemplates = function() {
  // Generates a shell setup script that recreates the full directory tree
  var lines = [
    '#!/bin/bash',
    '# NetDesign AI — Jinja2 Config Engine Setup',
    '# This script creates the engine.py + all template files.',
    '# Run once, then: python engine.py --inventory inventory.json --out configs/',
    '',
    'set -e',
    'mkdir -p templates/{nxos,eos,junos,iosxr,iosxe,sonic,sdwan}',
    ''
  ];

  Object.keys(JINJA_TEMPLATES).forEach(function(name) {
    var content = JINJA_TEMPLATES[name].replace(/'/g, "'\\''");
    lines.push("cat > 'templates/" + name + "' << 'TMPL_EOF'");
    lines.push(JINJA_TEMPLATES[name]);
    lines.push('TMPL_EOF');
    lines.push('');
  });

  lines.push('echo "Templates written."');
  lines.push('echo "Now download engine.py and run:"');
  lines.push('echo "  python engine.py --inventory inventory.json --out configs/"');

  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'setup-jinja-engine.sh';
  a.click();
  if (window.showToast) window.showToast('Setup script downloaded', 'success');
};

// ─── engine.py content (embedded so browser can download it) ──────────────────

function _enginePyContent() {
  return [
    '#!/usr/bin/env python3',
    '"""NetDesign AI — Jinja2 Config Engine',
    'Renders per-device network configs from Jinja2 templates + inventory JSON.',
    '',
    'Usage:',
    '    python engine.py --inventory inventory.json --out configs/',
    '    python engine.py --inventory inventory.json --device LEAF-01 --dry-run',
    '    python engine.py --inventory inventory.json --list',
    '',
    'Requirements: pip install jinja2',
    '"""',
    '',
    'import argparse, json, sys',
    'from pathlib import Path',
    '',
    'try:',
    '    from jinja2 import Environment, FileSystemLoader, StrictUndefined, UndefinedError',
    'except ImportError:',
    '    print("ERROR: jinja2 not installed. Run: pip install jinja2", file=sys.stderr)',
    '    sys.exit(1)',
    '',
    'TEMPLATE_MAP = {',
    '    ("cisco",   "spine"):              "nxos/spine.j2",',
    '    ("cisco",   "leaf"):               "nxos/leaf.j2",',
    '    ("cisco",   "pe-router"):          "iosxr/pe_router.j2",',
    '    ("cisco",   "p-router"):           "iosxr/p_router.j2",',
    '    ("cisco",   "wan-edge"):           "iosxe/wan_edge.j2",',
    '    ("arista",  "spine"):              "eos/spine.j2",',
    '    ("arista",  "leaf"):               "eos/leaf.j2",',
    '    ("juniper", "leaf"):               "junos/leaf.j2",',
    '    ("nvidia",  "leaf"):               "sonic/leaf.j2",',
    '}',
    '',
    'def render_device(env, device, site_vars):',
    '    key  = (device.get("vendor","").lower(), device.get("sub_layer",""))',
    '    tmpl = TEMPLATE_MAP.get(key)',
    '    if not tmpl:',
    '        return f"! No template for {key}\\n"',
    '    try:',
    '        return env.get_template(tmpl).render(device=device, site=site_vars)',
    '    except UndefinedError as e:',
    '        return f"! Render error for {device.get(\'hostname\',\'?\')}:\\n! {e}\\n"',
    '',
    'def main():',
    '    parser = argparse.ArgumentParser(description="NetDesign AI Jinja2 Config Engine")',
    '    parser.add_argument("--inventory",  default="inventory.json")',
    '    parser.add_argument("--templates",  default=str(Path(__file__).parent / "templates"))',
    '    parser.add_argument("--out",        default="configs")',
    '    parser.add_argument("--device",     default=None)',
    '    parser.add_argument("--dry-run",    action="store_true")',
    '    parser.add_argument("--list",       action="store_true")',
    '    args = parser.parse_args()',
    '',
    '    with open(args.inventory) as f:',
    '        inv = json.load(f)',
    '',
    '    devices = inv.get("devices", [])',
    '    if args.list:',
    '        for d in devices:',
    '            print(f"  {d.get(\'hostname\',\'?\'):30s}  {d.get(\'vendor\',\'?\'):10s}  {d.get(\'sub_layer\',\'?\')}")',
    '        return',
    '',
    '    if args.device:',
    '        devices = [d for d in devices if d.get("hostname") == args.device]',
    '',
    '    site_vars = {',
    '        "site": inv.get("site", "SITE"),',
    '        "protocols": inv.get("protocols", {}),',
    '        "topology": inv.get("topology", {}),',
    '        "bgp_keepalive": inv.get("bgp_keepalive", 3),',
    '        "bgp_hold": inv.get("bgp_hold", 9),',
    '        "bgp_adv_interval": inv.get("bgp_adv_interval", 0),',
    '    }',
    '',
    '    env = Environment(',
    '        loader=FileSystemLoader(args.templates),',
    '        undefined=StrictUndefined,',
    '        trim_blocks=True, lstrip_blocks=True,',
    '    )',
    '',
    '    if not args.dry_run:',
    '        Path(args.out).mkdir(parents=True, exist_ok=True)',
    '',
    '    for device in devices:',
    '        hostname = device.get("hostname", "unknown")',
    '        config   = render_device(env, device, site_vars)',
    '        if args.dry_run:',
    '            print(f"\\n{\'=\'*60}\\n# {hostname}\\n{\'=\'*60}")',
    '            print(config)',
    '        else:',
    '            out = Path(args.out) / f"{hostname}.cfg"',
    '            out.write_text(config)',
    '            print(f"  \\u2713  {hostname:30s} → {out}")',
    '',
    '    if not args.dry_run:',
    '        print(f"\\n✓ {len(devices)} configs written to {args.out}/")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
}

window.JINJA_TEMPLATES = JINJA_TEMPLATES;
