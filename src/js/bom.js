'use strict';

// Scale definitions: how many devices of each role
var SCALE_DEFS = {
  small: {
    dc:         { spine: 2, leaf: 4 },
    gpu:        { spine: 2, leaf: 4 },
    campus:     { distribution: 2, access: 4 },
    wan:        { 'wan-edge': 2 },
    multisite:  { spine: 2, leaf: 4, 'wan-edge': 2 },
    multicloud: { 'cloud-transit': 1, 'cloud-gw': 2 },
    aviatrix:   { 'cloud-transit': 1, 'cloud-gw': 2 }
  },
  medium: {
    dc:         { spine: 4, leaf: 8, firewall: 2 },
    gpu:        { spine: 4, leaf: 8 },
    campus:     { distribution: 4, access: 12, firewall: 2 },
    wan:        { 'wan-edge': 4 },
    multisite:  { spine: 4, leaf: 8, 'wan-edge': 4, firewall: 2 },
    multicloud: { 'cloud-transit': 2, 'cloud-gw': 4 },
    aviatrix:   { 'cloud-transit': 2, 'cloud-gw': 4 }
  },
  large: {
    dc:         { spine: 8, leaf: 24, firewall: 4 },
    gpu:        { spine: 8, leaf: 16 },
    campus:     { distribution: 8, access: 32, firewall: 4 },
    wan:        { 'wan-edge': 8 },
    multisite:  { spine: 8, leaf: 24, 'wan-edge': 8, firewall: 4 },
    multicloud: { 'cloud-transit': 4, 'cloud-gw': 8 },
    aviatrix:   { 'cloud-transit': 4, 'cloud-gw': 8 }
  }
};

// Product preference per use case + role
var PREFERRED_PRODUCTS = {
  dc:         { spine: 'nxos-9336c',    leaf: 'nxos-93180yc', firewall: 'ftd4145' },
  gpu:        { spine: 'nxos-9364c',    leaf: 'nxos-9332c' },
  campus:     { distribution: 'cat9500', access: 'cat9200',   firewall: 'ftd4145' },
  wan:        { 'wan-edge': 'asr1002hx' },
  multisite:  { spine: 'nxos-9336c',    leaf: 'nxos-93180yc', 'wan-edge': 'viptela-vedge', firewall: 'ftd4145' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  aviatrix:   { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' }
};

function lookupProduct(id) {
  return window.PRODUCTS.find(function(p) { return p.id === id; }) || null;
}

// Use cases where port-math BOM applies (spine-leaf topologies)
var PORT_MATH_CASES = { dc: true, gpu: true, multisite: true };

/**
 * Build a flat device list for the given use case and scale.
 * For DC/GPU/multisite: quantities come from calculateBOM() port-math (G-03/G-04).
 * For other use cases: fall back to SCALE_DEFS.
 */
function buildDeviceList(state) {
  var useCase = state.useCase || 'dc';
  var scale   = state.scale   || 'small';

  var prefProducts = PREFERRED_PRODUCTS[useCase] || PREFERRED_PRODUCTS.dc;
  var scaleDef;

  // ── Port-math sizing (G-03 + G-04) ────────────────────────────────────────
  if (PORT_MATH_CASES[useCase] && window.calculateBOM && state.topology) {
    var leafProdId  = prefProducts['leaf'];
    var spineProdId = prefProducts['spine'];
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
      var calc     = window.calculateBOM(state, leafSku, spineSku);

      state.capacityMath = calc; // stored for "Capacity Math" panel display

      scaleDef = { spine: calc.spine_count, leaf: calc.leaf_count };
      // Preserve non-spine-leaf roles from SCALE_DEFS
      var fallback = (SCALE_DEFS[scale] || SCALE_DEFS.small)[useCase] || {};
      Object.keys(fallback).forEach(function(role) {
        if (role !== 'spine' && role !== 'leaf') scaleDef[role] = fallback[role];
      });
    }
  }

  if (!scaleDef) {
    state.capacityMath = null;
    scaleDef = (SCALE_DEFS[scale] || SCALE_DEFS.small)[useCase] || SCALE_DEFS.small.dc;
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
        '</tr>';
    }
    return '<tr>' +
      '<td>' + item.vendor + '</td>' +
      '<td><strong>' + item.model + '</strong><br><small>' + item.detail + '</small></td>' +
      '<td>' + item.subLayer + '</td>' +
      '<td>' + item.qty + '</td>' +
      '<td>$' + item.unitCost.toLocaleString() + '</td>' +
      '<td>$' + item.totalCost.toLocaleString() + '</td>' +
      '</tr>';
  }).join('');

  var grandTotal = Object.values(summary).reduce(function(s, i) { return s + i.totalCost; }, 0);

  return '<table class="bom-table">' +
    '<thead><tr><th>Vendor</th><th>Model</th><th>Layer</th><th>Qty</th><th>Unit $</th><th>Total $</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="5"><strong>Grand Total (hardware + cabling)</strong></td>' +
    '<td><strong>$' + grandTotal.toLocaleString() + '</strong></td></tr></tfoot>' +
    '</table>';
}

/**
 * Export BOM as CSV.
 */
function exportBOMCSV(summary, devices) {
  var header = ['Vendor','Model','Sub-Layer','Qty','Unit Cost USD','Total Cost USD','Speed','Ports','Features'];
  var rows = Object.values(summary).map(function(item) {
    return [
      item.vendor, item.model, item.subLayer, item.qty,
      item.unitCost, item.totalCost, item.speed, item.ports,
      (item.features || []).join(';')
    ].join(',');
  });

  // Device detail section
  var devHeader = '\n\nDevice List\nHostname,Model,Vendor,Layer,Rack,Unit,Speed,Ports';
  var devRows = (devices || []).map(function(d) {
    return [d.hostname, d.model, d.vendor, d.subLayer, d.rack, d.unit, d.speed, d.ports].join(',');
  });

  return [header.join(',')].concat(rows).join('\n') + devHeader + '\n' + devRows.join('\n');
}

window.buildDeviceList = buildDeviceList;
window.buildBOM        = buildBOM;
window.renderBOMTable  = renderBOMTable;
window.exportBOMCSV    = exportBOMCSV;
window.SCALE_DEFS      = SCALE_DEFS;
