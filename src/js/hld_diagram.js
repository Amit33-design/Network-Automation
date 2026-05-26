/**
 * hld_diagram.js — Enterprise-Grade HLD Topology Diagram
 * NetDesign AI · Produces SVG diagrams matching Cisco DNA Center /
 * Arista CloudVision / Juniper Apstra visual quality.
 *
 * Exposed:  window.renderTopologyDiagram(state)  → HTML string
 *           window.exportHLDSvg()                → downloads SVG
 */
(function () {
  'use strict';

  /* ── Colour palette ──────────────────────────────────────────────────────── */
  var CLR = {
    spine:              '#3b82f6',
    'super-spine':      '#6366f1',
    leaf:               '#22c55e',
    core:               '#8b5cf6',
    distribution:       '#a855f7',
    access:             '#14b8a6',
    firewall:           '#f97316',
    'wan-edge':         '#eab308',
    'pe-router':        '#6366f1',
    'p-router':         '#818cf8',
    'sdwan-controller': '#64748b',
    'sdwan-orchestrator':'#94a3b8',
    'cloud-transit':    '#64748b',
    'cloud-gw':         '#60a5fa',
    fronthaul:          '#22c55e',
    midhaul:            '#3b82f6',
    'storage-fabric':   '#6366f1',
    'storage-leaf':     '#22c55e',
    internet:           '#475569',
    DIM:                '#475569',
    TEXT:               '#e2e8f0',
    BG:                 '#0f1117',
    SURFACE:            '#1a1d27',
    SURFACE2:           '#232638',
    BORDER:             '#2e3248',
  };

  function c(role) { return CLR[role] || '#64748b'; }
  function esc(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var W = 960;   // canvas width (viewBox)

  /* ── Primitives ──────────────────────────────────────────────────────────── */

  /** Labelled zone background rectangle */
  function zone(x, y, w, h, title, role, hint) {
    var col = c(role);
    return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="8"'
      +' fill="'+col+'12" stroke="'+col+'38" stroke-width="1.5"/>'
      +'<text x="'+(x+12)+'" y="'+(y+15)+'" font-size="9.5" fill="'+col+'bb"'
      +' font-weight="800" letter-spacing="0.1em" font-family="sans-serif">'
      +esc(title.toUpperCase())+'</text>'
      +(hint
        ? '<text x="'+(x+w-10)+'" y="'+(y+15)+'" text-anchor="end" font-size="8.5"'
          +' fill="'+CLR.DIM+'" font-family="monospace,sans-serif">'+esc(hint)+'</text>'
        : '');
  }

  /** Small protocol/feature pill badge */
  function badge(x, y, label, role) {
    var col = c(role);
    var tw = label.length * 6 + 14;
    return '<rect x="'+(x-tw/2)+'" y="'+(y-8)+'" width="'+tw+'" height="15" rx="3"'
      +' fill="'+col+'22" stroke="'+col+'66" stroke-width="0.8"/>'
      +'<text x="'+x+'" y="'+(y+3.5)+'" text-anchor="middle" font-size="8.5"'
      +' fill="'+col+'" font-weight="700" font-family="monospace,sans-serif">'+esc(label)+'</text>';
  }

  /** Network switch device card with port-row indicator */
  function switchCard(cx, cy, hostname, model, info2, role, instanceId) {
    var col = c(role), w = 118, h = 58, x = cx - w/2, y = cy - h/2;
    // 8 port pips across the top of the card
    var ports = '';
    for (var p = 0; p < 8; p++)
      ports += '<rect x="'+(x+8+p*13)+'" y="'+(y+4)+'" width="9" height="5"'
        +' rx="1" fill="'+col+'55" stroke="'+col+'88" stroke-width="0.6"/>';
    // status LED
    var led = '<circle cx="'+(x+w-7)+'" cy="'+(y+7)+'" r="3" fill="#22c55e" opacity="0.85"/>';
    var inner = '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="5"'
        +' fill="'+col+'18" stroke="'+col+'" stroke-width="1.5"/>'
      +ports+led
      // hostname
      +'<text x="'+cx+'" y="'+(cy-9)+'" text-anchor="middle" font-size="11"'
      +' fill="'+col+'" font-weight="700" font-family="monospace,sans-serif">'+esc(hostname)+'</text>'
      // model (last 2 tokens)
      +'<text x="'+cx+'" y="'+(cy+4)+'" text-anchor="middle" font-size="8.5"'
      +' fill="'+col+'cc" font-family="monospace,sans-serif">'+esc((model||'').split(' ').slice(-2).join(' '))+'</text>'
      // info line (ASN / speed / role)
      +(info2
        ? '<text x="'+cx+'" y="'+(cy+16)+'" text-anchor="middle" font-size="8"'
          +' fill="'+CLR.DIM+'" font-family="monospace,sans-serif">'+esc(info2)+'</text>'
        : '');
    if (instanceId) {
      return '<g class="hld-node" data-id="'+esc(instanceId)+'" onclick="window.hldNodeClick(\''+esc(instanceId)+'\')" style="cursor:pointer;">'
        +inner+'</g>';
    }
    return inner;
  }

  /** Router circle icon */
  function routerCard(cx, cy, hostname, model, info2, role, instanceId) {
    var col = c(role), r = 28;
    var inner = '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+col+'18" stroke="'+col+'" stroke-width="1.5"/>'
      // routing arrows
      +'<line x1="'+(cx-14)+'" y1="'+cy+'" x2="'+(cx+14)+'" y2="'+cy+'"'
      +' stroke="'+col+'" stroke-width="1.2" marker-end="url(#arr)"/>'
      +'<line x1="'+cx+'" y1="'+(cy-14)+'" x2="'+cx+'" y2="'+(cy+14)+'"'
      +' stroke="'+col+'" stroke-width="1.2" marker-end="url(#arr)"/>'
      +'<text x="'+cx+'" y="'+(cy+r+10)+'" text-anchor="middle" font-size="10"'
      +' fill="'+col+'" font-weight="700" font-family="monospace,sans-serif">'+esc(hostname)+'</text>'
      +(info2
        ? '<text x="'+cx+'" y="'+(cy+r+21)+'" text-anchor="middle" font-size="8" fill="'+CLR.DIM+'"'
          +' font-family="monospace,sans-serif">'+esc(info2)+'</text>'
        : '');
    if (instanceId) {
      return '<g class="hld-node" data-id="'+esc(instanceId)+'" onclick="window.hldNodeClick(\''+esc(instanceId)+'\')" style="cursor:pointer;">'
        +inner+'</g>';
    }
    return inner;
  }

  /** Firewall shield icon */
  function firewallCard(cx, cy, hostname, model, instanceId) {
    var col = c('firewall'), w = 118, h = 58, x = cx - w/2, y = cy - h/2;
    // Shield chevrons on the card
    var chevrons = '';
    for (var ci = 0; ci < 3; ci++)
      chevrons += '<line x1="'+(x+10+ci*8)+'" y1="'+(y+10)+'" x2="'+(x+10+ci*8)+'" y2="'+(y+h-10)+'"'
        +' stroke="'+col+'44" stroke-width="1"/>';
    var inner = '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="5"'
        +' fill="'+col+'18" stroke="'+col+'" stroke-width="1.5" stroke-dasharray="5,2"/>'
      +chevrons
      +'<circle cx="'+(x+w-8)+'" cy="'+(y+8)+'" r="3" fill="'+col+'" opacity="0.85"/>'
      +'<text x="'+cx+'" y="'+(cy-9)+'" text-anchor="middle" font-size="11"'
      +' fill="'+col+'" font-weight="700" font-family="monospace,sans-serif">'+esc(hostname)+'</text>'
      +'<text x="'+cx+'" y="'+(cy+4)+'" text-anchor="middle" font-size="8.5"'
      +' fill="'+col+'cc" font-family="monospace,sans-serif">'+esc((model||'').split(' ').slice(-2).join(' '))+'</text>'
      +'<text x="'+cx+'" y="'+(cy+16)+'" text-anchor="middle" font-size="8"'
      +' fill="'+CLR.DIM+'" font-family="monospace,sans-serif">STATEFUL FW</text>';
    if (instanceId) {
      return '<g class="hld-node" data-id="'+esc(instanceId)+'" onclick="window.hldNodeClick(\''+esc(instanceId)+'\')" style="cursor:pointer;">'
        +inner+'</g>';
    }
    return inner;
  }

  /** Internet / cloud oval */
  function cloudNode(cx, cy, label, sublabel) {
    var w = 130, h = 38;
    return '<rect x="'+(cx-w/2)+'" y="'+(cy-h/2)+'" width="'+w+'" height="'+h+'" rx="19"'
        +' fill="'+CLR.SURFACE2+'" stroke="'+CLR.DIM+'" stroke-width="1.5" stroke-dasharray="5,3"/>'
      +'<text x="'+cx+'" y="'+(cy+(sublabel?-3:4))+'" text-anchor="middle" font-size="11"'
      +' fill="'+CLR.DIM+'" font-weight="700" font-family="sans-serif">'+esc(label)+'</text>'
      +(sublabel
        ? '<text x="'+cx+'" y="'+(cy+10)+'" text-anchor="middle" font-size="8.5"'
          +' fill="'+CLR.DIM+'88" font-family="sans-serif">'+esc(sublabel)+'</text>'
        : '');
  }

  /** Server/compute cluster bar */
  function serverBar(cx, cy, count, speed, extraLabel) {
    var w = Math.min(W - 80, Math.max(200, count > 0 ? 360 : 200));
    var s = '';
    // Three stacked bars to suggest a rack/blade
    for (var i = 2; i >= 0; i--)
      s += '<rect x="'+(cx-w/2+i*3)+'" y="'+(cy-12+i*2)+'" width="'+(w-i*6)+'" height="22"'
        +' rx="3" fill="'+CLR.SURFACE2+'" stroke="'+CLR.BORDER+'" stroke-width="1"/>';
    // CPU/GPU pips
    var pipCount = Math.min(12, count > 0 ? 12 : 6);
    var pipW = (w - 40) / pipCount - 3;
    for (var p2 = 0; p2 < pipCount; p2++)
      s += '<rect x="'+(cx-w/2+20+p2*(pipW+3))+'" y="'+(cy-4)+'" width="'+pipW+'" height="8"'
        +' rx="1" fill="'+CLR.DIM+'55" stroke="'+CLR.DIM+'88" stroke-width="0.6"/>';
    s += '<text x="'+cx+'" y="'+(cy+26)+'" text-anchor="middle" font-size="9.5"'
      +' fill="'+CLR.DIM+'" font-family="sans-serif">'
      +(count > 0 ? count+' endpoints' : 'Servers')+(speed?' · '+speed+' NIC':'')
      +(extraLabel?' · '+extraLabel:'')+'</text>';
    return s;
  }

  /** GPU compute cluster with chip icons */
  function gpuBar(cx, cy, count) {
    var col = c('core'), w = Math.min(W - 80, 400);
    var s = '<rect x="'+(cx-w/2)+'" y="'+(cy-18)+'" width="'+w+'" height="36"'
      +' rx="5" fill="'+col+'12" stroke="'+col+'55" stroke-width="1.5"/>';
    var gpuW = 26, gpuH = 24, gpuCount = Math.min(count, 10);
    var gpuSpacing = Math.min((w - 30) / Math.max(gpuCount, 1), gpuW + 6);
    var gpuStartX = cx - (gpuCount - 1) * gpuSpacing / 2;
    for (var g = 0; g < gpuCount; g++) {
      var gx = gpuStartX + g * gpuSpacing;
      s += '<rect x="'+(gx-gpuW/2)+'" y="'+(cy-gpuH/2)+'" width="'+gpuW+'" height="'+gpuH+'"'
        +' rx="3" fill="'+col+'33" stroke="'+col+'" stroke-width="0.8"/>'
        +'<text x="'+gx+'" y="'+(cy+4)+'" text-anchor="middle" font-size="7"'
        +' fill="'+col+'cc" font-family="monospace,sans-serif">GPU</text>';
    }
    s += '<text x="'+cx+'" y="'+(cy+28)+'" text-anchor="middle" font-size="9.5"'
      +' fill="'+col+'cc" font-family="sans-serif">'+count+' GPU nodes (A100/H100/H200) · NVLink · RDMA</text>';
    return s;
  }

  /* ── Link drawing ────────────────────────────────────────────────────────── */

  /**
   * Draw a link between two points.
   * isDual = true → two parallel offset lines (redundant path).
   * speed  = label shown mid-link ("100G", "25G", etc.)
   */
  function link(x1, y1, x2, y2, speed, isDual, role) {
    var col = c(role) || CLR.BORDER;
    var mx = (x1+x2)/2, my = (y1+y2)/2;
    var lines = '';
    if (isDual) {
      var dx = y2-y1, dy = -(x2-x1);
      var len = Math.sqrt(dx*dx+dy*dy) || 1;
      var ox = dx/len*2.5, oy = dy/len*2.5;
      lines =
        '<line x1="'+(x1+ox)+'" y1="'+(y1+oy)+'" x2="'+(x2+ox)+'" y2="'+(y2+oy)+'"'
        +' stroke="'+col+'" stroke-width="1.5" opacity="0.75"/>'
        +'<line x1="'+(x1-ox)+'" y1="'+(y1-oy)+'" x2="'+(x2-ox)+'" y2="'+(y2-oy)+'"'
        +' stroke="'+col+'" stroke-width="1.5" opacity="0.75"/>';
    } else {
      lines = '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'"'
        +' stroke="'+col+'" stroke-width="1.5" opacity="0.65"/>';
    }
    var lbl = speed
      ? '<rect x="'+(mx-17)+'" y="'+(my-7)+'" width="34" height="13" rx="2"'
        +' fill="'+CLR.BG+'" stroke="'+CLR.BORDER+'" stroke-width="0.8"/>'
        +'<text x="'+mx+'" y="'+(my+3.5)+'" text-anchor="middle" font-size="8"'
        +' fill="'+CLR.DIM+'" font-family="monospace,sans-serif">'+esc(speed)+'</text>'
      : '';
    return lines+lbl;
  }

  /**
   * Draw a mesh of links between two rows.
   * Full mesh for ≤ 4 nodes each side; nearest-2 otherwise.
   */
  function mesh(upCX, upBotY, dnCX, dnTopY, speed, isDual, role) {
    if (!upCX.length || !dnCX.length) return '';
    var s = '';
    if (upCX.length <= 4 && dnCX.length <= 4) {
      upCX.forEach(function(ux) {
        dnCX.forEach(function(lx) { s += link(ux, upBotY, lx, dnTopY, speed, isDual, role); });
      });
    } else {
      dnCX.forEach(function(lx) {
        var sorted = upCX.map(function(ux, i) {
          return { ux: ux, d: Math.abs(ux - lx), i: i };
        }).sort(function(a, b) { return a.d - b.d; }).slice(0, 2);
        sorted.forEach(function(u) { s += link(u.ux, upBotY, lx, dnTopY, speed, isDual, role); });
      });
    }
    return s;
  }

  /* ── Row layout ──────────────────────────────────────────────────────────── */

  var CARD_W = 118, CARD_H = 58, CARD_GAP = 14;

  /**
   * Layout a row of devices.
   * Returns { svg, cx[], topY, botY }
   * cx[] = centre-x of each node (used for line anchoring).
   */
  function row(devices, role, cy, totalW) {
    var col  = c(role);
    var count = devices.length;
    if (!count) return { svg:'', cx:[], topY:cy-CARD_H/2, botY:cy+CARD_H/2 };

    // Collapse: > 8 devices → single wide "N× model" box with phantom anchors
    if (count > 8) {
      var m  = (devices[0].model || role).split(' ').slice(-2).join(' ');
      var bw = Math.min(totalW - 40, 400);
      var bx = totalW/2 - bw/2;
      var by = cy - CARD_H/2;
      var svgC = '<rect x="'+bx+'" y="'+by+'" width="'+bw+'" height="'+CARD_H+'" rx="5"'
        +' fill="'+col+'18" stroke="'+col+'" stroke-width="1.5" stroke-dasharray="6,3"/>'
        +'<text x="'+totalW/2+'" y="'+(cy-4)+'" text-anchor="middle" font-size="11"'
        +' fill="'+col+'" font-weight="700" font-family="monospace,sans-serif">'+count+'× '+esc(m)+'</text>'
        +'<text x="'+totalW/2+'" y="'+(cy+10)+'" text-anchor="middle" font-size="8"'
        +' fill="'+CLR.DIM+'" font-family="monospace,sans-serif">'+role+'</text>';
      var n = Math.min(count, 10);
      var step2 = bw / (n + 1);
      var phantomCX = [];
      for (var pi = 0; pi < n; pi++) phantomCX.push(bx + step2 * (pi+1));
      return { svg:svgC, cx:phantomCX, topY:by, botY:by+CARD_H };
    }

    var totalRowW = count * CARD_W + (count-1) * CARD_GAP;
    var startX = (totalW - totalRowW) / 2 + CARD_W / 2;
    var svgParts = [], cxArr = [];
    devices.forEach(function(d, i) {
      var cx2 = startX + i * (CARD_W + CARD_GAP);
      cxArr.push(cx2);
      var hn    = d.hostname || (role.toUpperCase() + '-' + String(i+1).padStart(2,'0'));
      var info2 = '';
      if (role === 'spine')       info2 = 'AS 65000 · Lo0 10.0.0.' + (100+i);
      else if (role === 'leaf')   info2 = 'AS ' + (65100+i) + ' · Lo0 10.0.0.' + (i+1);
      else if (role === 'pe-router') info2 = 'AS 65001 · SR-MPLS';
      else if (role === 'p-router')  info2 = 'AS 65001 · Transit';

      var iid = d.instanceId || null;
      if (role === 'firewall') {
        svgParts.push(firewallCard(cx2, cy, hn, d.model || '', iid));
      } else if (role === 'pe-router' || role === 'p-router' || role === 'wan-edge') {
        svgParts.push(routerCard(cx2, cy, hn, d.model || '', info2, role, iid));
      } else {
        svgParts.push(switchCard(cx2, cy, hn, d.model || '', info2, role, iid));
      }
    });
    return { svg:svgParts.join(''), cx:cxArr, topY:cy-CARD_H/2, botY:cy+CARD_H/2 };
  }

  /* ── Protocol badge row ──────────────────────────────────────────────────── */

  function protoBadges(state, cx, y) {
    var protos = (state.protocols && state.protocols.overlay) || [];
    var feats  = (state.protocols && state.protocols.features) || [];
    var badges = [];
    if (protos.indexOf('vxlan_evpn') !== -1) { badges.push(['VXLAN','spine']); badges.push(['EVPN','leaf']); }
    if (protos.indexOf('mpls_sr')    !== -1) { badges.push(['SR-MPLS','pe-router']); }
    if (feats.indexOf('bfd')   !== -1) badges.push(['BFD','access']);
    if (feats.indexOf('ecmp')  !== -1) badges.push(['ECMP ×'+(state.ecmp&&state.ecmp.max_paths||8),'spine']);
    if (feats.indexOf('pfc')   !== -1) badges.push(['PFC','core']);
    if (state.gpu && state.gpu.transport === 'rocev2') badges.push(['RoCEv2','core']);
    if (feats.indexOf('anycast_gw') !== -1) badges.push(['Anycast-GW','leaf']);
    var spacing = Math.min(90, (W - 60) / Math.max(badges.length, 1));
    var startBX = cx - (badges.length - 1) * spacing / 2;
    return badges.map(function(b, i) {
      return badge(startBX + i * spacing, y, b[0], b[1]);
    }).join('');
  }

  /* ── Legend ──────────────────────────────────────────────────────────────── */

  function legend(y) {
    var items = [
      ['spine','Spine'], ['leaf','Leaf/ToR'], ['distribution','Distribution'],
      ['access','Access'], ['firewall','Firewall'], ['wan-edge','WAN Edge'],
      ['pe-router','PE Router'],
    ];
    var s = '<line x1="20" y1="'+y+'" x2="'+(W-20)+'" y2="'+y+'"'
      +' stroke="'+CLR.BORDER+'" stroke-width="0.8"/>';
    var lx = 24;
    items.forEach(function(item) {
      var col = c(item[0]);
      s += '<rect x="'+lx+'" y="'+(y+6)+'" width="11" height="11" rx="2"'
        +' fill="'+col+'33" stroke="'+col+'" stroke-width="1"/>'
        +'<text x="'+(lx+16)+'" y="'+(y+15.5)+'" font-size="9" fill="'+CLR.DIM+'"'
        +' font-family="sans-serif">'+esc(item[1])+'</text>';
      lx += 82;
    });
    return s;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Use-case renderers
  ══════════════════════════════════════════════════════════════════════════ */

  /* ── Data-Centre Leaf-Spine ─────────────────────────────────────────────── */
  function dcFabric(state) {
    var devs   = state.devices || [];
    var spines = devs.filter(function(d){return d.subLayer==='spine';});
    var leaves = devs.filter(function(d){return d.subLayer==='leaf';});
    var fws    = devs.filter(function(d){return d.subLayer==='firewall';});

    var ZY = { border:10, spine:130, leaf:285, server:435 };
    var H  = 510;
    var physSvg = '', linkSvg = '', overlaySvg = '';

    /* zones (physical background — goes in physical layer) */
    physSvg += zone(10, ZY.border, W-20, 100,  'BORDER / TRANSIT', 'firewall',
      fws.length ? fws[0].model : 'Internet Edge');
    physSvg += zone(10, ZY.spine,  W-20, 135,  'SPINE FABRIC LAYER', 'spine',
      'eBGP CLOS · AS 65000');
    physSvg += zone(10, ZY.leaf,   W-20, 130,  'LEAF / ToR LAYER',   'leaf',
      'eBGP AS 651XX · VXLAN/EVPN · Anycast-GW');
    physSvg += zone(10, ZY.server, W-20, 65,   'COMPUTE / SERVER TIER', 'internet',
      (state.topology&&state.topology.bandwidth_gbps
        ? state.topology.bandwidth_gbps+'GbE downlinks' : ''));

    /* Internet cloud */
    physSvg += cloudNode(W/2, ZY.border+28, 'Internet / WAN', 'BGP Peering');

    /* Firewall row */
    var fwRow = null;
    if (fws.length) {
      fwRow = row(fws, 'firewall', ZY.border+68, W);
      physSvg += fwRow.svg;
      fwRow.cx.forEach(function(fx) {
        linkSvg += link(W/2, ZY.border+47, fx, fwRow.topY, '10G', false, 'firewall');
      });
    } else {
      /* no FW → direct line from cloud to spine zone */
      linkSvg += link(W/2, ZY.border+47, W/2, ZY.spine, '100G', false, 'spine');
    }

    /* Spine row */
    var spineRow = row(spines, 'spine', ZY.spine+68, W);
    physSvg += spineRow.svg;
    if (fwRow) {
      linkSvg += mesh(fwRow.cx, fwRow.botY, spineRow.cx, spineRow.topY, '100G', false, 'firewall');
    }

    /* Protocol badges under spines — overlay layer */
    overlaySvg += protoBadges(state, W/2, ZY.spine+128);

    /* Leaf row */
    var leafRow = row(leaves, 'leaf', ZY.leaf+62, W);
    physSvg += leafRow.svg;
    /* Dual (redundant) uplinks: each leaf → every spine */
    linkSvg += mesh(spineRow.cx, spineRow.botY, leafRow.cx, leafRow.topY, '100G', true, 'leaf');

    /* Server bar */
    var ep = (state.topology&&state.topology.endpoint_count) || leaves.length*24;
    var bw = (state.topology&&state.topology.bandwidth_gbps) || 25;
    physSvg += serverBar(W/2, ZY.server+26, ep, bw+'G', '');
    linkSvg += mesh(leafRow.cx.slice(0,Math.min(leafRow.cx.length,6)),
      leafRow.botY, [W/2], ZY.server+12, bw+'G', false, 'internet');

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:'', h:H };
  }

  /* ── AI / GPU Cluster ───────────────────────────────────────────────────── */
  function gpuFabric(state) {
    var devs   = state.devices || [];
    var spines = devs.filter(function(d){return d.subLayer==='spine';});
    var leaves = devs.filter(function(d){return d.subLayer==='leaf';});

    var ZY = { oob:10, spine:105, leaf:265, gpu:415 };
    var H  = 510;
    var physSvg = '', linkSvg = '', overlaySvg = '', rocev2Svg = '';

    physSvg += zone(10, ZY.oob,   W-20, 80,  'OOB / STORAGE NETWORK', 'internet', 'Out-of-Band Mgmt · NFS');
    physSvg += zone(10, ZY.spine, W-20, 140, 'GPU SPINE FABRIC',       'spine',
      'RoCEv2 · PFC Priority 3 · ECN/DCQCN · lossless');
    physSvg += zone(10, ZY.leaf,  W-20, 130, 'GPU ToR / RAIL LAYER',   'leaf',
      'Rail-optimized · 400G uplinks · 100G to GPU');
    physSvg += zone(10, ZY.gpu,   W-20, 90,  'GPU COMPUTE NODES',      'core',
      'A100 / H100 / H200 · NVLink · RDMA');

    physSvg += cloudNode(W/4,   ZY.oob+38, 'OOB Mgmt', '');
    physSvg += cloudNode(3*W/4, ZY.oob+38, 'Storage', 'NFS/NVMe-oF');

    var spineRow = row(spines, 'spine', ZY.spine+70, W);
    physSvg += spineRow.svg;

    /* RoCEv2 badges — rocev2 layer */
    [['RoCEv2','core'],['PFC','spine'],['ECN','firewall'],['DCQCN','core'],
     ['RDMA','leaf'],['BFD','access']].forEach(function(b,i) {
      rocev2Svg += badge(80 + i*140, ZY.spine+136, b[0], b[1]);
    });

    var leafRow = row(leaves, 'leaf', ZY.leaf+62, W);
    physSvg += leafRow.svg;
    linkSvg += mesh(spineRow.cx, spineRow.botY, leafRow.cx, leafRow.topY, '400G', true, 'leaf');

    var gpuCount = (state.topology&&state.topology.endpoint_count) || leaves.length*8;
    physSvg += gpuBar(W/2, ZY.gpu+38, gpuCount);
    linkSvg += mesh(leafRow.cx.slice(0,Math.min(leafRow.cx.length,6)),
      leafRow.botY, [W/2], ZY.gpu+18, '100G', false, 'core');

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:rocev2Svg, h:H };
  }

  /* ── Campus / Enterprise LAN ────────────────────────────────────────────── */
  function campusLAN(state) {
    var devs  = state.devices || [];
    var cores = devs.filter(function(d){
      return d.subLayer==='core'||d.subLayer==='distribution';
    });
    var accs  = devs.filter(function(d){return d.subLayer==='access';});
    var fws   = devs.filter(function(d){return d.subLayer==='firewall';});

    var ZY = { wan:10, core:115, access:265, end:400 };
    var H  = 480;
    var physSvg = '', linkSvg = '', overlaySvg = '';

    physSvg += zone(10, ZY.wan,    W-20, 90,  'WAN / INTERNET EDGE', 'firewall', 'BGP · IPSec · DMVPN');
    physSvg += zone(10, ZY.core,   W-20, 130, 'CORE / DISTRIBUTION', 'spine',
      'OSPF/EIGRP · HSRP/VRRP · Layer 3 Routed · QoS');
    physSvg += zone(10, ZY.access, W-20, 115, 'ACCESS / EDGE LAYER', 'leaf',
      '802.1X NAC · PoE · VLAN Segmentation · STP RSTP');
    physSvg += zone(10, ZY.end,    W-20, 70,  'END DEVICES',         'internet', 'Wired · Wireless · IoT · VoIP');

    physSvg += cloudNode(W/2, ZY.wan+30, 'Internet / WAN', 'MPLS / DIA');

    var fwRow = null;
    if (fws.length) {
      fwRow = row(fws, 'firewall', ZY.wan+72, W);
      physSvg += fwRow.svg;
      linkSvg += mesh([W/2], ZY.wan+49, fwRow.cx, fwRow.topY, '10G', false, 'firewall');
    }

    var coreRole = (cores[0]&&cores[0].subLayer==='core') ? 'core' : 'distribution';
    var coreRow  = row(cores, coreRole, ZY.core+65, W);
    physSvg += coreRow.svg;
    if (fwRow) {
      linkSvg += mesh(fwRow.cx, fwRow.botY, coreRow.cx, coreRow.topY, '10G', false, 'firewall');
    } else {
      linkSvg += link(W/2, ZY.wan+49, W/2, coreRow.topY, '10G', false, 'spine');
    }

    [['OSPF','spine'],['HSRP','spine'],['QoS','leaf'],['VTP','access']].forEach(function(b,i){
      overlaySvg += badge(120+i*160, ZY.core+128, b[0], b[1]);
    });

    var accRow = row(accs, 'access', ZY.access+55, W);
    physSvg += accRow.svg;
    linkSvg += mesh(coreRow.cx, coreRow.botY, accRow.cx, accRow.topY, '1G', false, 'leaf');

    [['802.1X','access'],['PoE','leaf'],['RSTP','access'],['DHCP Snooping','internet']].forEach(function(b,i){
      overlaySvg += badge(100+i*195, ZY.access+108, b[0], b[1]);
    });

    var ep = (state.topology&&state.topology.endpoint_count) || accs.length*24;
    physSvg += serverBar(W/2, ZY.end+28, ep, '1G', 'VoIP · WiFi');
    linkSvg += mesh(accRow.cx.slice(0,Math.min(accRow.cx.length,6)),
      accRow.botY, [W/2], ZY.end+12, '', false, 'internet');

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:'', h:H };
  }

  /* ── WAN / SD-WAN ───────────────────────────────────────────────────────── */
  function wanFabric(state) {
    var devs  = state.devices || [];
    var ctrls = devs.filter(function(d){return d.subLayer==='sdwan-controller';});
    var orcls = devs.filter(function(d){return d.subLayer==='sdwan-orchestrator';});
    var edges = devs.filter(function(d){return d.subLayer==='wan-edge';});

    var ZY = { ctrl:10, orch:145, edge:280 };
    var H  = 400;
    var physSvg = '', linkSvg = '', overlaySvg = '';

    physSvg += zone(10, ZY.ctrl, W-20, 115, 'SD-WAN CONTROL PLANE', 'sdwan-controller',
      'OMP · Policy · App-aware Routing');
    physSvg += zone(10, ZY.orch, W-20, 115, 'SD-WAN ORCHESTRATION', 'wan-edge',
      'NAT Traversal · WAN Edge Onboarding');
    physSvg += zone(10, ZY.edge, W-20, 100, 'WAN EDGE SITES',       'wan-edge',
      'TLOC · IPSec · DMVPN · ZTP');

    var ctrlRow = row(ctrls.length ? ctrls : [{subLayer:'sdwan-controller',model:'vSmart'}],
      'sdwan-controller', ZY.ctrl+58, W);
    physSvg += ctrlRow.svg;

    var orchRow = row(orcls.length ? orcls : [{subLayer:'sdwan-orchestrator',model:'vBond'}],
      'sdwan-orchestrator', ZY.orch+58, W);
    physSvg += orchRow.svg;
    linkSvg += mesh(ctrlRow.cx, ctrlRow.botY, orchRow.cx, orchRow.topY, 'DTLS', false, 'sdwan-controller');

    var edgeRow = row(edges, 'wan-edge', ZY.edge+50, W);
    physSvg += edgeRow.svg;
    linkSvg += mesh(orchRow.cx, orchRow.botY, edgeRow.cx, edgeRow.topY, 'IPSec', false, 'wan-edge');

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:'', h:H };
  }

  /* ── Multi-Site Fabric ──────────────────────────────────────────────────── */
  function multisite(state) {
    var numSites   = Math.min((state.org&&state.org.sites)||2, 6);
    var devs       = state.devices || [];
    var allSpines  = devs.filter(function(d){return d.subLayer==='spine';});
    var allLeaves  = devs.filter(function(d){return d.subLayer==='leaf';});
    var perSpine   = Math.max(1, Math.ceil(allSpines.length/numSites));
    var perLeaf    = Math.max(1, Math.ceil(allLeaves.length/numSites));
    var wan        = devs.filter(function(d){return d.subLayer==='wan-edge';});

    var H = 420;
    var physSvg = '', linkSvg = '', overlaySvg = '';

    physSvg += zone(10, 10, W-20, 85,  'WAN / DCI BACKBONE', 'wan-edge',
      'MPLS · VXLAN-EVPN DCI · BGP Route-Reflector');
    physSvg += cloudNode(W/2, 52, 'WAN / DCI Cloud', 'MP-BGP EVPN');

    /* WAN edge devices above cloud */
    if (wan.length) {
      var wanRow = row(wan, 'wan-edge', 50, W);
      physSvg += wanRow.svg;
    }

    var boxW = Math.min(160, (W - 40) / numSites - 12);
    var boxH = 295;
    var siteZoneY = 108;
    physSvg += zone(10, siteZoneY, W-20, boxH, 'SITE FABRICS', 'internet', numSites+' sites');

    var totalRowW2 = numSites * boxW + (numSites - 1) * 12;
    var siteStartX = W/2 - totalRowW2/2;

    for (var s = 0; s < numSites; s++) {
      var siteCX  = siteStartX + s * (boxW + 12) + boxW/2;
      var siteTop = siteZoneY + 22;
      /* site box */
      physSvg += '<rect x="'+(siteCX-boxW/2)+'" y="'+siteTop+'" width="'+boxW+'"'
        +' height="'+(boxH-28)+'" rx="6" fill="'+CLR.SURFACE+'88" stroke="'+CLR.BORDER+'" stroke-width="1"/>'
        +'<text x="'+siteCX+'" y="'+(siteTop+14)+'" text-anchor="middle" font-size="10"'
        +' fill="'+CLR.DIM+'" font-weight="800" font-family="sans-serif">'
        +'SITE-'+String(s+1).padStart(2,'0')+'</text>';

      /* mini spine row */
      var mSY = siteTop + 60, mLY = siteTop + 160;
      var mW = Math.min(50, (boxW-20)/Math.min(perSpine,3));
      var mSpineN = Math.min(perSpine, 3), mLeafN = Math.min(perLeaf, 4);

      for (var sp = 0; sp < mSpineN; sp++) {
        var msx = siteCX - (mSpineN-1)*(mW+6)/2 + sp*(mW+6);
        physSvg += '<rect x="'+(msx-mW/2)+'" y="'+(mSY-12)+'" width="'+mW+'" height="24" rx="3"'
          +' fill="#3b82f622" stroke="#3b82f6" stroke-width="1.2"/>'
          +'<text x="'+msx+'" y="'+(mSY+4)+'" text-anchor="middle" font-size="8"'
          +' fill="#3b82f6" font-family="monospace,sans-serif">SP-'+String(sp+1).padStart(2,'0')+'</text>';
      }

      for (var lf = 0; lf < mLeafN; lf++) {
        var mlx = siteCX - (mLeafN-1)*(mW+4)/2 + lf*(mW+4);
        physSvg += '<rect x="'+(mlx-mW/2)+'" y="'+(mLY-12)+'" width="'+mW+'" height="24" rx="3"'
          +' fill="#22c55e22" stroke="#22c55e" stroke-width="1.2"/>'
          +'<text x="'+mlx+'" y="'+(mLY+4)+'" text-anchor="middle" font-size="8"'
          +' fill="#22c55e" font-family="monospace,sans-serif">L-'+String(lf+1).padStart(2,'0')+'</text>';
        /* mini spine → leaf */
        for (var msp2 = 0; msp2 < mSpineN; msp2++) {
          var msx2 = siteCX - (mSpineN-1)*(mW+6)/2 + msp2*(mW+6);
          linkSvg += '<line x1="'+msx2+'" y1="'+(mSY+12)+'" x2="'+mlx+'" y2="'+(mLY-12)+'"'
            +' stroke="#4b5563" stroke-width="0.8" opacity="0.6"/>';
        }
      }

      /* counts if compressed */
      if (perSpine > mSpineN)
        physSvg += '<text x="'+siteCX+'" y="'+(mSY-20)+'" text-anchor="middle" font-size="8"'
          +' fill="#3b82f688" font-family="sans-serif">'+perSpine+'× spine</text>';
      if (perLeaf > mLeafN)
        physSvg += '<text x="'+siteCX+'" y="'+(mLY+22)+'" text-anchor="middle" font-size="8"'
          +' fill="#22c55e88" font-family="sans-serif">'+perLeaf+'× leaf</text>';

      /* VXLAN DCI badge — overlay */
      overlaySvg += badge(siteCX, siteTop+246, 'VXLAN DCI', 'wan-edge');

      /* WAN line from site to cloud */
      linkSvg += '<line x1="'+siteCX+'" y1="'+siteTop+'" x2="'+(W/2+(s-(numSites-1)/2)*36)+'" y2="71"'
        +' stroke="#eab308" stroke-width="1.2" stroke-dasharray="5,2" opacity="0.8"/>';
    }

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:'', h:H };
  }

  /* ── Service Provider MPLS ──────────────────────────────────────────────── */
  function spMpls(state) {
    var devs = state.devices || [];
    var pes  = devs.filter(function(d){return d.subLayer==='pe-router';});
    var ps   = devs.filter(function(d){return d.subLayer==='p-router';});

    var ZY = { p:10, pe:175 };
    var H  = 340;
    var physSvg = '', linkSvg = '', overlaySvg = '';

    physSvg += zone(10, ZY.p,  W-20, 145, 'MPLS CORE (P ROUTERS)',  'p-router',
      'IS-IS SR-MPLS · TI-LFA · AS 65001');
    physSvg += zone(10, ZY.pe, W-20, 145, 'PE ROUTERS / EDGE',       'pe-router',
      'L3VPN · VPNv4/VPNv6 · BGP RR · LDP/SR');

    var pRow  = row(ps,  'p-router',  ZY.p  + 75, W);
    var peRow = row(pes, 'pe-router', ZY.pe + 75, W);
    physSvg += pRow.svg + peRow.svg;
    linkSvg += mesh(pRow.cx, pRow.botY, peRow.cx, peRow.topY, 'SR-MPLS', false, 'pe-router');

    [['IS-IS','p-router'],['SR-MPLS','pe-router'],['TI-LFA','spine'],
     ['LDP','p-router'],['VPNv4','pe-router']].forEach(function(b,i){
      overlaySvg += badge(80+i*175, ZY.p+138, b[0], b[1]);
    });

    return { physSvg:physSvg, linkSvg:linkSvg, overlaySvg:overlaySvg, rocev2Svg:'', h:H };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Public API
  ══════════════════════════════════════════════════════════════════════════ */

  window.renderTopologyDiagram = function(state) {
    var uc = state.useCase || 'dc';
    var result;

    if      (uc === 'gpu')       result = gpuFabric(state);
    else if (uc === 'campus')    result = campusLAN(state);
    else if (uc === 'multisite') result = multisite(state);
    else if (uc === 'wan')       result = wanFabric(state);
    else if (uc === 'sp_mpls')   result = spMpls(state);
    else                         result = dcFabric(state);   // dc, hybrid, storage, private_5g

    var H        = result.h + 42;
    var legendSvg = legend(result.h + 4);

    /* ── CSS hover rules injected via <defs> ── */
    var defs = '<defs>'
      +'<style>'
      +'.hld-node:hover > rect { filter: brightness(1.2); }'
      +'.hld-node:hover > circle { filter: brightness(1.2); }'
      +'</style>'
      +'</defs>';

    /* ── Layer groups ── */
    var body = defs
      +'<g id="hld-layer-physical">'  + result.physSvg  + '</g>'
      +'<g id="hld-layer-links">'     + result.linkSvg   + '</g>'
      +'<g id="hld-layer-overlay">'   + result.overlaySvg + '</g>'
      +'<g id="hld-layer-rocev2">'    + (result.rocev2Svg||'') + '</g>'
      + legendSvg;

    var ucLabel = {
      dc:'Data Center Leaf-Spine', gpu:'AI / GPU Cluster',
      campus:'Campus / Enterprise LAN', multisite:'Multi-Site Fabric',
      wan:'WAN / SD-WAN', sp_mpls:'Service Provider MPLS'
    }[uc] || uc;

    var sites = state.org && state.org.sites > 1
      ? ' &nbsp;·&nbsp; <span style="color:var(--accent);">' + state.org.sites + ' sites</span>' : '';
    var devCount = (state.devices||[]).length;

    /* Show RoCEv2 layer button only for GPU use case */
    var isGpu = (uc === 'gpu' || (state.gpu && state.gpu.transport === 'rocev2'));
    var rocev2Btn = isGpu
      ? '<button class="btn btn-secondary hld-layer-btn" data-layer="rocev2" '
        +'onclick="window.hldToggleLayer(\'rocev2\')" style="font-size:10px;padding:3px 8px;">RoCEv2</button>'
      : '';

    return '<div style="background:var(--surface);border:1px solid var(--border);'
      +'border-radius:8px;padding:14px 16px;">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:6px;">'
      +'<div style="font-size:13px;font-weight:700;color:var(--text);">'
      +'HLD &nbsp;—&nbsp; <span style="color:var(--accent);">'+esc(ucLabel)+'</span>'
      +'&nbsp;·&nbsp; '+devCount+' devices'+sites
      +'</div>'
      +'<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
      /* Layer toggles */
      +'<div style="display:flex;gap:4px;align-items:center;">'
      +'<span style="font-size:10px;color:var(--text-dim,#64748b);margin-right:4px;">Layers:</span>'
      +'<button class="btn btn-secondary hld-layer-btn" data-layer="physical" '
      +'onclick="window.hldToggleLayer(\'physical\')" style="font-size:10px;padding:3px 8px;">Physical</button>'
      +'<button class="btn btn-secondary hld-layer-btn" data-layer="links" '
      +'onclick="window.hldToggleLayer(\'links\')" style="font-size:10px;padding:3px 8px;">Links</button>'
      +'<button class="btn btn-secondary hld-layer-btn" data-layer="overlay" '
      +'onclick="window.hldToggleLayer(\'overlay\')" style="font-size:10px;padding:3px 8px;">Overlay</button>'
      +rocev2Btn
      +'</div>'
      /* Export / reset buttons */
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" '
      +'onclick="window.exportHLDSvg()">&#8595; Export SVG</button>'
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" '
      +'onclick="window.exportHLDPng()">&#8595; Export PNG</button>'
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" '
      +'onclick="window.exportHLDDrawio(window.STATE)">&#8595; Export Draw.io</button>'
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" '
      +'onclick="window.resetHLDView()" title="Reset pan/zoom (also: double-click diagram)">&#8635; Reset</button>'
      +'</div>'
      +'</div>'
      +'<div style="position:relative;">'
      +'<svg id="hld-svg" viewBox="0 0 '+W+' '+H+'" width="100%" '
      +'style="max-width:1000px;display:block;background:transparent;cursor:grab;overflow:hidden;">'
      +body
      +'</svg>'
      +'<div id="hld-tooltip" style="position:absolute;background:#1e293b;border:1px solid #334155;'
      +'border-radius:6px;padding:8px 12px;font-size:11px;color:#e2e8f0;pointer-events:none;'
      +'display:none;z-index:100;max-width:220px;line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.4);">'
      +'</div>'
      +'<div id="hld-minimap-wrap" style="position:absolute;bottom:12px;right:12px;width:180px;height:90px;'
      +'background:rgba(15,17,23,.85);border:1px solid #334155;border-radius:6px;'
      +'overflow:hidden;cursor:pointer;z-index:10;" '
      +'onclick="window.minimapClick(event)" title="Click to navigate \xb7 mini-map">'
      +'<svg id="hld-minimap" width="180" height="90" style="display:block;"></svg>'
      +'<div id="hld-minimap-vp" style="position:absolute;top:0;left:0;'
      +'border:1.5px solid #4f8ef7;background:rgba(79,142,247,.12);'
      +'pointer-events:none;border-radius:2px;"></div>'
      +'</div>'
      +'</div>'
      +'</div>';
  };

  /* ── G-56: Node click → jump to config viewer ───────────────────────────── */
  window.hldNodeClick = function(instanceId) {
    if (!instanceId) return;
    if (window.goToStep) window.goToStep(3);
    setTimeout(function() {
      if (window.renderStep3 && window.STATE && window.STATE.devices && window.STATE.devices.length) {
        if (!window.STATE.configs || !Object.keys(window.STATE.configs).length) {
          window.renderStep3();
        }
      }
      if (window.showDeviceConfig) window.showDeviceConfig(instanceId);
    }, 80);
  };

  /* ── G-57: Layer toggle ──────────────────────────────────────────────────── */
  window.hldToggleLayer = function(layer) {
    var g = document.getElementById('hld-layer-' + layer);
    if (!g) return;
    var visible = g.style.display !== 'none';
    g.style.display = visible ? 'none' : '';
    var btn = document.querySelector('.hld-layer-btn[data-layer="' + layer + '"]');
    if (btn) btn.style.opacity = visible ? '0.4' : '1';
  };

  window.exportHLDSvg = function() {
    var el = document.getElementById('hld-svg');
    if (!el) { el = document.querySelector('#topo-hld-output svg'); }
    if (!el) return;
    var s = new XMLSerializer();
    var src = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!-- NetDesign AI — HLD Topology Diagram -->\n'
      + s.serializeToString(el);
    var blob = new Blob([src], { type: 'image/svg+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'network-hld.svg';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  window.exportHLDPng = function() {
    var el = document.getElementById('hld-svg');
    if (!el) { el = document.querySelector('#topo-hld-output svg'); }
    if (!el) return;

    var vb = el.viewBox.baseVal;
    var vbW = (vb && vb.width)  || 960;
    var vbH = (vb && vb.height) || 600;
    var DPR = 2; // 2× pixel ratio for crisp output

    var s = new XMLSerializer();
    var svgStr = s.serializeToString(el);
    // Ensure xmlns is present so the browser can parse as image
    if (svgStr.indexOf('xmlns=') === -1) {
      svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    var blob = new Blob([svgStr], { type: 'image/svg+xml' });
    var url  = URL.createObjectURL(blob);

    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width  = vbW * DPR;
      canvas.height = vbH * DPR;
      var ctx = canvas.getContext('2d');
      ctx.scale(DPR, DPR);
      ctx.drawImage(img, 0, 0, vbW, vbH);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(pngBlob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = 'network-hld.png';
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.onerror = function() {
      URL.revokeObjectURL(url);
      console.error('NetDesign AI: PNG export failed — SVG could not be loaded as image.');
    };
    img.src = url;
  };

  /* ── HLD Pan / Zoom / Reset ─────────────────────────────────────────────── */

  /* Module-level interaction state — persists across re-renders */
  var _hld = null;

  /* ── Mini-map helpers (defined inside IIFE so they close over _hld) ──────── */

  window.updateMinimap = function() {
    var svg     = document.getElementById('hld-svg');
    var mm      = document.getElementById('hld-minimap');
    var vpRect  = document.getElementById('hld-minimap-vp');
    if (!svg || !mm || !vpRect || !_hld) return;

    var vb = svg.viewBox.baseVal;
    if (!vb || !vb.width) return;
    var vbW = vb.width, vbH = vb.height;
    var mmW = 180, mmH = 90;
    var scaleX = mmW / vbW, scaleY = mmH / vbH;

    /* Current viewport in SVG-space coordinates */
    var visX = -_hld.tx / _hld.scale;
    var visY = -_hld.ty / _hld.scale;
    var visW = vbW / _hld.scale;
    var visH = vbH / _hld.scale;

    /* Map to mini-map pixel coordinates */
    var mmX  = visX * scaleX;
    var mmY  = visY * scaleY;
    var mmVW = visW * scaleX;
    var mmVH = visH * scaleY;

    /* Clamp to mini-map bounds */
    mmX  = Math.max(0, Math.min(mmX, mmW));
    mmY  = Math.max(0, Math.min(mmY, mmH));
    mmVW = Math.min(mmVW, mmW - mmX);
    mmVH = Math.min(mmVH, mmH - mmY);

    vpRect.style.left   = mmX  + 'px';
    vpRect.style.top    = mmY  + 'px';
    vpRect.style.width  = mmVW + 'px';
    vpRect.style.height = mmVH + 'px';
  };

  window.minimapClick = function(event) {
    var mm  = document.getElementById('hld-minimap-wrap');
    if (!mm || !_hld) return;
    var rect = mm.getBoundingClientRect();
    var svg  = document.getElementById('hld-svg');
    var vb   = svg ? svg.viewBox.baseVal : null;
    if (!vb || !vb.width) return;
    var mmW = 180, mmH = 90;
    var fx  = (event.clientX - rect.left) / mmW;  /* 0..1 fraction */
    var fy  = (event.clientY - rect.top)  / mmH;
    /* Clicked point in SVG coordinates */
    var targetX = fx * vb.width;
    var targetY = fy * vb.height;
    /* Pan so the clicked point is centred in the viewport */
    _hld.tx = -(targetX * _hld.scale - vb.width  / 2);
    _hld.ty = -(targetY * _hld.scale - vb.height / 2);
    _hld.apply();
    window.updateMinimap();
  };

  window.initHLDInteraction = function() {
    var svg = document.getElementById('hld-svg');
    if (!svg) return;

    /* Wrap children in a viewport <g> if not already done */
    var vp = document.getElementById('hld-vp');
    if (!vp) {
      vp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      vp.setAttribute('id', 'hld-vp');
      // Move all existing children into the group
      while (svg.firstChild) { vp.appendChild(svg.firstChild); }
      svg.appendChild(vp);
    }

    /* (Re-)initialise state */
    _hld = { tx: 0, ty: 0, scale: 1, vp: vp };
    _hld.apply = function() {
      _hld.vp.setAttribute('transform',
        'translate(' + _hld.tx + ',' + _hld.ty + ') scale(' + _hld.scale + ')');
    };
    _hld.apply(); // reset to identity

    /* Clamp helper */
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    /* Mouse-wheel zoom */
    svg.addEventListener('wheel', function(e) {
      e.preventDefault();
      _hld.scale = clamp(_hld.scale * (e.deltaY < 0 ? 1.15 : 0.87), 0.15, 5);
      _hld.apply();
      window.updateMinimap && window.updateMinimap();
    }, { passive: false });

    /* Pointer drag */
    var dragging = false, lastX = 0, lastY = 0;

    svg.addEventListener('pointerdown', function(e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      svg.style.cursor = 'grabbing';
      svg.setPointerCapture(e.pointerId);
    });

    svg.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      _hld.tx += e.clientX - lastX;
      _hld.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      _hld.apply();
      window.updateMinimap && window.updateMinimap();
    });

    function stopDrag(e) {
      dragging = false;
      svg.style.cursor = 'grab';
    }
    svg.addEventListener('pointerup',    stopDrag);
    svg.addEventListener('pointerleave', stopDrag);

    /* Double-click to reset */
    svg.addEventListener('dblclick', function() {
      _hld.tx = 0; _hld.ty = 0; _hld.scale = 1;
      _hld.apply();
      window.updateMinimap && window.updateMinimap();
    });

    /* Populate mini-map with a static scaled copy of the diagram */
    var mm = document.getElementById('hld-minimap');
    if (mm) {
      var vb2 = svg.viewBox.baseVal;
      var mainVp = document.getElementById('hld-vp');
      if (mainVp && vb2 && vb2.width) {
        var sx = 180 / vb2.width;
        var sy = 90  / vb2.height;
        var sc = Math.min(sx, sy);
        mm.innerHTML = '<g transform="scale(' + sc + ')">' + (mainVp.innerHTML || '') + '</g>';
      }
    }

    /* Set initial viewport indicator */
    window.updateMinimap && window.updateMinimap();
  };

  window.resetHLDView = function() {
    if (_hld) {
      _hld.tx = 0; _hld.ty = 0; _hld.scale = 1;
      _hld.apply();
      window.updateMinimap && window.updateMinimap();
    }
  };

})();
