'use strict';

// Scale definitions: how many devices of each role
var SCALE_DEFS = {
  small: {
    dc:         { spine: 2, leaf: 4 },
    gpu:        { spine: 2, leaf: 4 },
    campus:     { distribution: 2, access: 4 },
    wan:        { 'wan-edge': 2, 'sdwan-controller': 1, 'sdwan-orchestrator': 1 },
    multisite:  { spine: 2, leaf: 4, 'wan-edge': 2 },
    multicloud: { 'cloud-transit': 1, 'cloud-gw': 2 },
    aviatrix:   { 'cloud-transit': 1, 'cloud-gw': 2 },
    sp_mpls:    { 'pe-router': 2, 'p-router': 2 },
    private_5g: { fronthaul: 4, midhaul: 2 },
    storage:    { 'storage-fabric': 2, 'storage-leaf': 4 }
  },
  medium: {
    dc:         { spine: 4, leaf: 8, firewall: 2 },
    gpu:        { spine: 8, leaf: 16 },
    campus:     { distribution: 4, access: 12, firewall: 2 },
    wan:        { 'wan-edge': 4, 'sdwan-controller': 2, 'sdwan-orchestrator': 1 },
    multisite:  { spine: 4, leaf: 8, 'wan-edge': 4, firewall: 2 },
    multicloud: { 'cloud-transit': 2, 'cloud-gw': 4 },
    aviatrix:   { 'cloud-transit': 2, 'cloud-gw': 4 },
    sp_mpls:    { 'pe-router': 4, 'p-router': 4 },
    private_5g: { fronthaul: 8, midhaul: 4 },
    storage:    { 'storage-fabric': 4, 'storage-leaf': 8 }
  },
  large: {
    dc:         { spine: 8, leaf: 24, firewall: 4 },
    gpu:        { spine: 16, leaf: 32 },
    campus:     { distribution: 8, access: 32, firewall: 4 },
    wan:        { 'wan-edge': 8, 'sdwan-controller': 2, 'sdwan-orchestrator': 2 },
    multisite:  { spine: 8, leaf: 24, 'wan-edge': 8, firewall: 4 },
    multicloud: { 'cloud-transit': 4, 'cloud-gw': 8 },
    aviatrix:   { 'cloud-transit': 4, 'cloud-gw': 8 },
    sp_mpls:    { 'pe-router': 8, 'p-router': 8 },
    private_5g: { fronthaul: 16, midhaul: 8 },
    storage:    { 'storage-fabric': 8, 'storage-leaf': 16 }
  }
};

// Vendor-aware product preferences
var PREFERRED_PRODUCTS_CISCO = {
  dc:         { spine: 'nxos-9336c',    leaf: 'nxos-93180yc', firewall: 'ftd4145' },
  gpu:        { spine: 'nxos-9364c',    leaf: 'nxos-9364d' },
  campus:     { distribution: 'cat9500', access: 'cat9200', firewall: 'ftd4145' },
  wan:        { 'wan-edge': 'asr1002hx', 'sdwan-controller': 'sdwan-vsmart', 'sdwan-orchestrator': 'sdwan-vbond' },
  multisite:  { spine: 'nxos-9336c', leaf: 'nxos-93180yc', 'wan-edge': 'asr1002hx', firewall: 'ftd4145' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  aviatrix:   { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  sp_mpls:    { 'pe-router': 'asr9001', 'p-router': 'ncs5501' },
  private_5g: { fronthaul: 'oran-fh-sw', midhaul: 'oran-mh-rtr' },
  storage:    { 'storage-fabric': 'mds9396t', 'storage-leaf': 'nxos-93600cd' }
};

var PREFERRED_PRODUCTS_ARISTA = {
  dc:         { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  gpu:        { spine: 'arista-7060x4-spine', leaf: 'arista-7060px4' },
  campus:     { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  multisite:  { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  wan:        { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' }
};

var PREFERRED_PRODUCTS_JUNIPER = {
  dc:         { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  gpu:        { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  campus:     { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  multisite:  { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120', 'wan-edge': 'asr1002hx' }
};

var PREFERRED_PRODUCTS_NVIDIA = {
  gpu:        { spine: 'nvidia-quantum2-ndr', leaf: 'nvidia-spectrum3' },
  dc:         { spine: 'nvidia-quantum2-ndr', leaf: 'nvidia-spectrum3' }
};

function getPreferredProducts(useCase, vendors) {
  var primary = (vendors && vendors[0] || 'cisco').toLowerCase();
  var map = primary === 'arista'  ? PREFERRED_PRODUCTS_ARISTA
          : primary === 'juniper' ? PREFERRED_PRODUCTS_JUNIPER
          : primary === 'nvidia'  ? PREFERRED_PRODUCTS_NVIDIA
          : PREFERRED_PRODUCTS_CISCO;
  // Fall back: if the specific use case isn't in the vendor map, use cisco
  return map[useCase] || PREFERRED_PRODUCTS_CISCO[useCase] || PREFERRED_PRODUCTS_CISCO.dc;
}

// Product preference per use case + role (kept as fallback; vendor-aware lookup now handled by getPreferredProducts)
var PREFERRED_PRODUCTS = {
  dc:         { spine: 'nxos-9336c',    leaf: 'nxos-93180yc', firewall: 'ftd4145' },
  gpu:        { spine: 'nxos-9364c',    leaf: 'nxos-9364d' },
  campus:     { distribution: 'cat9500', access: 'cat9200',   firewall: 'ftd4145' },
  wan:        { 'wan-edge': 'asr1002hx', 'sdwan-controller': 'sdwan-vsmart', 'sdwan-orchestrator': 'sdwan-vbond' },
  multisite:  { spine: 'nxos-9336c',    leaf: 'nxos-93180yc', 'wan-edge': 'viptela-vedge', firewall: 'ftd4145' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  aviatrix:   { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  sp_mpls:    { 'pe-router': 'asr9001', 'p-router': 'ncs5501' },
  private_5g: { fronthaul: 'oran-fh-sw', midhaul: 'oran-mh-rtr' },
  storage:    { 'storage-fabric': 'mds9396t', 'storage-leaf': 'nxos-93600cd' },
  wan_full:   { 'wan-edge': 'viptela-vedge', 'sdwan-controller': 'sdwan-vsmart', 'sdwan-orchestrator': 'sdwan-vbond' }
};

function lookupProduct(id) {
  return window.PRODUCTS.find(function(p) { return p.id === id; }) || null;
}

// Two-tier port-math role mapping per use case. "lower" connects endpoints,
// "upper" aggregates the lower tier's uplinks. Same CLAUDE.md §6 math
// applies to every pair — only the role names differ.
var PORT_MATH_ROLES = {
  dc:        { lower: 'leaf',         upper: 'spine' },
  gpu:       { lower: 'leaf',         upper: 'spine' },
  multisite: { lower: 'leaf',         upper: 'spine' },
  campus:    { lower: 'access',       upper: 'distribution' },
  storage:   { lower: 'storage-leaf', upper: 'storage-fabric' }
};

/**
 * Build a flat device list for the given use case and scale.
 * For DC/GPU/multisite/campus/storage: quantities come from calculateBOM()
 * port-math (G-03/G-04) using the preferred product's actual port counts.
 * For other use cases: fall back to SCALE_DEFS.
 */
function buildDeviceList(state) {
  var useCase = state.useCase || 'dc';
  var scale   = state.scale   || 'small';

  var prefProducts = getPreferredProducts(useCase, state.vendors);
  var scaleDef;

  // ── Port-math sizing (G-03 + G-04) ────────────────────────────────────────
  var pmRoles = PORT_MATH_ROLES[useCase];
  if (pmRoles && window.calculateBOM && state.topology) {
    var leafProdId  = prefProducts[pmRoles.lower];
    var spineProdId = prefProducts[pmRoles.upper];
    var leafProd    = leafProdId  ? lookupProduct(leafProdId)  : null;
    var spineProd   = spineProdId ? lookupProduct(spineProdId) : null;

    if (leafProd && spineProd && leafProd.uplinks > 0) {
      var leafSku = {
        downlink_count:   leafProd.ports,
        uplink_count:     leafProd.uplinks,
        uplink_speed_gbps: leafProd.uplink_speed_gbps || 100,
        model:            leafProd.model
      };
      var spineSku = { port_count: spineProd.ports };

      var calcState = state;

      // Multi-site / DCI: size each site for its share of endpoints; the
      // per-site fabric is multiplied by the site count further below.
      var pmSites = (useCase === 'multisite' && state.org && state.org.sites > 1)
        ? Math.max(1, parseInt(state.org.sites) || 1) : 1;
      if (pmSites > 1) {
        var msTopo = Object.assign({}, state.topology || {});
        msTopo.endpoint_count = Math.max(1, Math.ceil((msTopo.endpoint_count || 500) / pmSites));
        calcState = Object.assign({}, state, { topology: msTopo });
      }

      // For non-rail GPU, force 400G/1:1 if the form still has DC defaults.
      // Rail-optimized formula bypasses bandwidth_gbps/oversubscription entirely.
      var gpuState = state.gpu || {};
      if (useCase === 'gpu' && !gpuState.rail_optimized) {
        var gpuTopo = Object.assign({}, calcState.topology || {});
        if (!gpuTopo.bandwidth_gbps || gpuTopo.bandwidth_gbps < 200) {
          gpuTopo.bandwidth_gbps = leafSku.uplink_speed_gbps || 400;
        }
        if (!gpuTopo.oversubscription || gpuTopo.oversubscription > 1) {
          gpuTopo.oversubscription = 1;
        }
        calcState = Object.assign({}, calcState, { topology: gpuTopo });
      }

      var calc     = window.calculateBOM(calcState, leafSku, spineSku);
      calc.tier_labels = { lower: pmRoles.lower, upper: pmRoles.upper };

      state.capacityMath = calc; // stored for "Capacity Math" panel display

      scaleDef = {};
      scaleDef[pmRoles.upper] = calc.spine_count;
      scaleDef[pmRoles.lower] = calc.leaf_count;
      // Preserve other roles (firewall, wan-edge…) from SCALE_DEFS
      var fallback = (SCALE_DEFS[scale] || SCALE_DEFS.small)[useCase] || {};
      Object.keys(fallback).forEach(function(role) {
        if (role !== pmRoles.upper && role !== pmRoles.lower) scaleDef[role] = fallback[role];
      });
    }
  }

  if (!scaleDef) {
    state.capacityMath = null;
    scaleDef = (SCALE_DEFS[scale] || SCALE_DEFS.small)[useCase] || SCALE_DEFS.small.dc;
  }

  // Scale up for multi-site: multiply spine/leaf/wan-edge by number of sites
  if (useCase === 'multisite' && state.org && state.org.sites > 1) {
    var sites = Math.max(1, parseInt(state.org.sites) || 1);
    var perSiteRoles = ['spine', 'leaf', 'wan-edge', 'firewall'];
    var scaled = {};
    Object.keys(scaleDef).forEach(function(role) {
      scaled[role] = perSiteRoles.indexOf(role) !== -1
        ? scaleDef[role] * sites
        : scaleDef[role]; // controllers/orchestrators are shared, don't multiply
    });
    scaleDef = scaled;
    // Store per-site counts for HLD rendering
    state.perSiteDevices = { spine: scaleDef.spine / sites, leaf: scaleDef.leaf / sites };
    state.siteCount = sites;
  }

  var devices = [];

  Object.keys(scaleDef).forEach(function(role) {
    var qty       = scaleDef[role];
    var prodId    = prefProducts[role];
    var product   = prodId ? lookupProduct(prodId) : null;

    if (!product) {
      // Fallback: find first product matching subLayer and useCase
      product = window.PRODUCTS.find(function(p) {
        return p.subLayer === role && p.useCases.indexOf(useCase) !== -1;
      });
    }
    if (!product) return;

    for (var i = 0; i < qty; i++) {
      var dev = Object.assign({}, product, {
        instanceId: product.id + '-' + (i + 1),
        hostname:   '',   // filled by generateHostnames()
        rack:       'TBD',
        unit:       0,
        unitHeight: 1    // overwritten by assignRackPositions
      });
      devices.push(dev);
    }
  });

  // Assign hostnames
  if (window.generateHostnames) {
    window.generateHostnames(devices, state);
  }

  // Assign rack positions (G-05)
  if (window.assignRackPositions) {
    window.assignRackPositions(devices);
  }

  state.devices = devices;
  return devices;
}

/**
 * Build BOM summary: device counts, unit/total costs.
 */
function buildBOM(state) {
  var devices = buildDeviceList(state);
  var summary = {};

  devices.forEach(function(dev) {
    var key = dev.model;
    if (!summary[key]) {
      summary[key] = {
        model:       dev.model,
        vendor:      dev.vendor,
        subLayer:    dev.subLayer,
        unitCost:    dev.priceUSD || 0,
        qty:         0,
        totalCost:   0,
        features:    dev.features,
        detail:      dev.detail,
        speed:       dev.speed,
        ports:       dev.ports
      };
    }
    summary[key].qty++;
    summary[key].totalCost += dev.priceUSD || 0;
  });

  // Add cabling costs if available
  if (window.generateCablingMatrix) {
    var cabling = window.generateCablingMatrix(null, devices, state);
    var cablingCost = cabling.reduce(function(s, r) { return s + r.totalCostUSD; }, 0);
    summary['__cabling__'] = {
      model:     'Cabling (DAC/AOC/LC-LC/MPO)',
      vendor:    'Various',
      subLayer:  'infrastructure',
      unitCost:  0,
      qty:       cabling.length,
      totalCost: cablingCost,
      features:  [],
      detail:    'Per-link cable schedule; see Cabling tab',
      speed:     '',
      ports:     0
    };
  }

  // Add optics costs if available
  if (window.recommendOptics && state.cabling && state.cabling.length) {
    var optics = window.recommendOptics(state.cabling, devices, state);
    var opticsCost = optics.reduce(function(s, r) { return s + r.totalCostUSD; }, 0);
    if (optics.length) {
      summary['__optics__'] = {
        model:     'Optical Transceivers',
        vendor:    'Various',
        subLayer:  'infrastructure',
        unitCost:  0,
        qty:       optics.reduce(function(s, r) { return s + r.qty; }, 0),
        totalCost: opticsCost,
        features:  [],
        detail:    'SR/LR/SR4/LR4/DR4/FR4 per link distance; see Optics tab',
        speed:     '',
        ports:     0
      };
    }
  }

  return { devices: devices, summary: summary };
}

// ─── G-08: Lifecycle / EoL / EoS helpers ─────────────────────────────────────

var LC_STATUS = { active: 'active', eol_soon: 'eol_soon', eol: 'eol', eos: 'eos' };

window.getLifecycleStatus = function(product) {
  if (!product) return LC_STATUS.active;
  var now   = new Date();
  var eol   = product.eol_date ? new Date(product.eol_date) : null;
  var eos   = product.eos_date ? new Date(product.eos_date) : null;
  var soon  = new Date(now.getFullYear(), now.getMonth() + 12, now.getDate()); // 12-month horizon
  if (eos  && now >= eos)  return LC_STATUS.eos;
  if (eol  && now >= eol)  return LC_STATUS.eol;
  if (eol  && eol <= soon) return LC_STATUS.eol_soon;
  return LC_STATUS.active;
};

var LC_BADGE = {
  active:   '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:10px;background:#22c55e20;color:#22c55e;font-weight:600;white-space:nowrap;">● Active</span>',
  eol_soon: '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:10px;background:#f59e0b20;color:#f59e0b;font-weight:600;white-space:nowrap;">⚠ EoL Soon</span>',
  eol:      '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:10px;background:#ef444420;color:#ef4444;font-weight:600;white-space:nowrap;">✕ End of Life</span>',
  eos:      '<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 7px;border-radius:10px;background:#7f1d1d40;color:#fca5a5;font-weight:600;white-space:nowrap;">⛔ End of Support</span>'
};

window.renderLifecycleBanner = function(devices) {
  if (!devices || !devices.length) return '';
  var issues = [];
  devices.forEach(function(dev) {
    var prod = (window.PRODUCTS || []).find(function(p) { return p.model === dev.model; });
    if (!prod) return;
    var status = window.getLifecycleStatus(prod);
    if (status === LC_STATUS.active) return;
    var existing = issues.find(function(i) { return i.model === prod.model; });
    if (existing) return;
    issues.push({
      model:     prod.model,
      vendor:    prod.vendor,
      status:    status,
      eol_date:  prod.eol_date,
      eos_date:  prod.eos_date,
      successor: prod.successor
    });
  });
  if (!issues.length) return '';

  var hasEos     = issues.some(function(i) { return i.status === 'eos'; });
  var hasEol     = issues.some(function(i) { return i.status === 'eol'; });
  var headerClass = hasEos ? 'val-block-error' : hasEol ? 'val-block-error' : 'val-block-warn';
  var rows = issues.map(function(i) {
    var badge = LC_BADGE[i.status] || '';
    var detail = '';
    if (i.eol_date) detail += ' EoL: ' + i.eol_date + '.';
    if (i.eos_date) detail += ' EoS: ' + i.eos_date + '.';
    if (i.successor) detail += ' Successor: ' + i.successor + '.';
    return '<div class="val-item">' + badge
      + ' <span class="val-msg"><strong>' + i.vendor + ' ' + i.model + '</strong>'
      + (detail ? ' —' + detail : '') + '</span></div>';
  }).join('');

  return '<div class="val-block ' + headerClass + '" style="margin:0 0 12px;">'
    + '<div class="val-block-hdr">⏰ Lifecycle Warning — ' + issues.length
    + ' SKU' + (issues.length > 1 ? 's' : '') + ' in BOM ha' + (issues.length > 1 ? 've' : 's') + ' EoL/EoS status</div>'
    + rows + '</div>';
};

/**
 * Render BOM as an HTML table.
 */
function renderBOMTable(summary) {
  var rows = Object.values(summary).map(function(item) {
    if (item.model === 'Cabling (DAC/AOC/LC-LC/MPO)' || item.model === 'Optical Transceivers') {
      return '<tr class="cabling-row">' +
        '<td><em>' + item.vendor + '</em></td>' +
        '<td><em>' + item.model + '</em><br><small>' + item.detail + '</small></td>' +
        '<td>' + item.subLayer + '</td>' +
        '<td>' + item.qty + '</td>' +
        '<td>—</td>' +
        '<td><strong>$' + item.totalCost.toLocaleString() + '</strong></td>' +
        '<td>—</td>' +
        '</tr>';
    }
    var prod   = (window.PRODUCTS || []).find(function(p) { return p.model === item.model; });
    var status = window.getLifecycleStatus ? window.getLifecycleStatus(prod) : 'active';
    var badge  = LC_BADGE[status] || LC_BADGE.active;
    var eolTip = '';
    if (prod && prod.eol_date) eolTip += ' EoL: ' + prod.eol_date + '.';
    if (prod && prod.eos_date) eolTip += ' EoS: ' + prod.eos_date + '.';
    if (prod && prod.successor) eolTip += ' → ' + prod.successor;
    var lcCell = badge + (eolTip ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;white-space:normal;">' + eolTip + '</div>' : '');
    return '<tr>' +
      '<td>' + item.vendor + '</td>' +
      '<td><strong>' + item.model + '</strong><br><small>' + item.detail + '</small></td>' +
      '<td>' + item.subLayer + '</td>' +
      '<td>' + item.qty + '</td>' +
      '<td>$' + item.unitCost.toLocaleString() + '</td>' +
      '<td>$' + item.totalCost.toLocaleString() + '</td>' +
      '<td style="min-width:130px;">' + lcCell + '</td>' +
      '</tr>';
  }).join('');

  var grandTotal = Object.values(summary).reduce(function(s, i) { return s + i.totalCost; }, 0);

  return '<table class="bom-table">' +
    '<thead><tr><th>Vendor</th><th>Model</th><th>Layer</th><th>Qty</th><th>Unit $</th><th>Total $</th><th>Lifecycle</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="6"><strong>Grand Total (hardware + cabling)</strong></td>' +
    '<td><strong>$' + grandTotal.toLocaleString() + '</strong></td></tr></tfoot>' +
    '</table>';
}

/**
 * Export BOM as CSV.
 */
function exportBOMCSV(summary, devices) {
  var header = ['Vendor','Model','Sub-Layer','Qty','Unit Cost USD','Total Cost USD','Speed','Ports','Features','Lifecycle Status','EoL Date','EoS Date','Successor'];
  var rows = Object.values(summary).map(function(item) {
    var prod   = (window.PRODUCTS || []).find(function(p) { return p.model === item.model; });
    var status = window.getLifecycleStatus ? window.getLifecycleStatus(prod) : 'active';
    return [
      item.vendor, item.model, item.subLayer, item.qty,
      item.unitCost, item.totalCost, item.speed, item.ports,
      (item.features || []).join(';'),
      status,
      (prod && prod.eol_date) || '',
      (prod && prod.eos_date) || '',
      (prod && prod.successor) || ''
    ].join(',');
  });

  // Device detail section
  var devHeader = '\n\nDevice List\nHostname,Model,Vendor,Layer,Rack,Unit,Speed,Ports';
  var devRows = (devices || []).map(function(d) {
    return [d.hostname, d.model, d.vendor, d.subLayer, d.rack, d.unit, d.speed, d.ports].join(',');
  });

  return [header.join(',')].concat(rows).join('\n') + devHeader + '\n' + devRows.join('\n');
}

/**
 * Render a rail-optimized NCCL topology advisory banner for GPU clusters.
 * Shows when gpu.rail_optimized is true or when state.use_case === 'gpu'.
 */
window.renderRailOptimizedBanner = function(state) {
  if (!state) return '';
  var isGpu = state.useCase === 'gpu' || state.use_case === 'gpu';
  if (!isGpu) return '';

  var railOpt  = (state.gpu && state.gpu.rail_optimized) || false;
  var devices  = state.devices || [];
  var leafCnt  = devices.filter(function(d) { return d.subLayer === 'leaf'; }).length;
  var spineCnt = devices.filter(function(d) { return d.subLabel === 'spine' || d.subLayer === 'spine'; }).length;
  var topo     = state.topology || {};
  var nodes    = topo.endpoint_count || 0;
  var rails    = Math.min(8, leafCnt);

  var railSection = '';
  if (railOpt || leafCnt >= 8) {
    var nodesPerRail = rails > 0 ? Math.ceil(nodes / rails) : nodes;
    railSection = '<div style="margin-top:10px;padding:10px 12px;background:var(--surface2,#1e293b);border-radius:6px;font-size:12px;">'
      + '<strong>Rail-Optimized NCCL Topology</strong> — '
      + rails + ' independent rails, ' + nodesPerRail + ' nodes/rail.<br>'
      + 'Each DGX H100 NIC connects to a dedicated rail switch. '
      + 'NCCL AllReduce traverses a single spine hop (Rail → Spine → Rail), '
      + 'eliminating multi-hop east-west congestion. '
      + 'Configure <code>NCCL_NET_PLUGIN=NCCL</code> and '
      + '<code>NCCL_IB_GID_INDEX=3</code> (RoCEv2). '
      + 'Enable PFC on class 3 and ECN (DCQCN) thresholds: '
      + '<code>ECN-min 800KB, ECN-max 1600KB, ECN-mark-prob 100%</code>.</div>';
  }

  return '<div class="val-block val-block-info" style="margin:0 0 12px;">'
    + '<div class="val-block-hdr">🚀 GPU Fabric — 400G Non-Blocking Design'
    + (railOpt ? ' · Rail-Optimized' : '') + '</div>'
    + '<div class="val-item"><span class="val-msg">'
    + 'BOM uses <strong>1:1 oversubscription (non-blocking)</strong> with 400G per-server links. '
    + 'Leaf switches connect directly to GPU servers; spines carry only east-west GPU-to-GPU traffic.'
    + '</span></div>'
    + '<div class="val-item"><span class="val-msg">'
    + '<strong>Topology:</strong> '
    + (spineCnt || '?') + ' × 64-port 400G spine + '
    + (leafCnt  || '?') + ' × (32-down + 32-up) 400G leaf ToR. '
    + 'Total fabric bandwidth: '
    + (spineCnt * 64 * 400 / 1000 || '?') + ' Tbps bisection.'
    + '</span></div>'
    + '<div class="val-item"><span class="val-msg">'
    + '<strong>RoCEv2 requirements:</strong> PFC enabled on CoS-3, ECN/DCQCN on all GPU-facing ports, '
    + 'MTU 9000, RDMA QoS class EF (DSCP 46).'
    + '</span></div>'
    + railSection
    + '</div>';
};

window.buildDeviceList       = buildDeviceList;
window.buildBOM              = buildBOM;
window.renderBOMTable        = renderBOMTable;
window.exportBOMCSV          = exportBOMCSV;
window.SCALE_DEFS            = SCALE_DEFS;
window.getPreferredProducts  = getPreferredProducts;
