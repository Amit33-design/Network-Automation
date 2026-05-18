'use strict';

// Optics catalog: SFP/QSFP transceivers with compatibility and pricing
var OPTICS = [
  {
    id:               'SFP-10G-SR',
    model:            'SFP-10G-SR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP+',
    speed:            '10G',
    reach_m:          300,
    wavelength:       '850nm',
    fiberType:        'MMF OM3/OM4',
    connector:        'LC',
    estimatedCostUSD: 25,
    compatibleSubLayers: ['leaf', 'access', 'distribution'],
    notes:            'SR = Short-Reach, up to 300m on OM4'
  },
  {
    id:               'SFP-10G-LR',
    model:            'SFP-10G-LR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP+',
    speed:            '10G',
    reach_m:          10000,
    wavelength:       '1310nm',
    fiberType:        'SMF OS2',
    connector:        'LC',
    estimatedCostUSD: 55,
    compatibleSubLayers: ['leaf', 'distribution', 'wan-edge', 'firewall'],
    notes:            'LR = Long-Reach, up to 10km on SMF'
  },
  {
    id:               'SFP-25G-SR',
    model:            'SFP28-25G-SR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP28',
    speed:            '25G',
    reach_m:          100,
    wavelength:       '850nm',
    fiberType:        'MMF OM4',
    connector:        'LC',
    estimatedCostUSD: 45,
    compatibleSubLayers: ['leaf', 'distribution'],
    notes:            '25G SR, 100m on OM4'
  },
  {
    id:               'SFP-25G-LR',
    model:            'SFP28-25G-LR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP28',
    speed:            '25G',
    reach_m:          10000,
    wavelength:       '1310nm',
    fiberType:        'SMF OS2',
    connector:        'LC',
    estimatedCostUSD: 120,
    compatibleSubLayers: ['leaf', 'distribution', 'wan-edge'],
    notes:            '25G LR, 10km on SMF'
  },
  {
    id:               'QSFP-28-100G-SR4',
    model:            'QSFP-100G-SR4',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'QSFP28',
    speed:            '100G',
    reach_m:          100,
    wavelength:       '850nm',
    fiberType:        'MMF OM4 (MPO-12)',
    connector:        'MPO-12',
    estimatedCostUSD: 180,
    compatibleSubLayers: ['spine', 'leaf', 'distribution'],
    notes:            '4x25G NRZ, 100m on OM4 MPO-12'
  },
  {
    id:               'QSFP-28-100G-LR4',
    model:            'QSFP-100G-LR4',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'QSFP28',
    speed:            '100G',
    reach_m:          10000,
    wavelength:       '1295-1310nm CWDM',
    fiberType:        'SMF OS2',
    connector:        'LC',
    estimatedCostUSD: 420,
    compatibleSubLayers: ['spine', 'wan-edge'],
    notes:            '4-lambda CWDM4, 10km on SMF'
  },
  {
    id:               'QSFP-28-100G-PSM4',
    model:            'QSFP-100G-PSM4',
    vendor:           'Generic',
    formFactor:       'QSFP28',
    speed:            '100G',
    reach_m:          500,
    wavelength:       '1310nm',
    fiberType:        'SMF OS2 (MPO-12)',
    connector:        'MPO-12',
    estimatedCostUSD: 95,
    compatibleSubLayers: ['spine', 'leaf'],
    notes:            'Parallel SMF, 500m, cost-effective for intra-DC'
  },
  {
    id:               'QSFP-DD-400G-DR4',
    model:            'QSFP-DD-400G-DR4',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'QSFP-DD',
    speed:            '400G',
    reach_m:          500,
    wavelength:       '1310nm',
    fiberType:        'SMF OS2 (MPO-12)',
    connector:        'MPO-12',
    estimatedCostUSD: 680,
    compatibleSubLayers: ['spine'],
    notes:            '4x100G PAM4, 500m SMF, most common 400G intra-DC'
  },
  {
    id:               'QSFP-DD-400G-FR4',
    model:            'QSFP-DD-400G-FR4',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'QSFP-DD',
    speed:            '400G',
    reach_m:          2000,
    wavelength:       '1271-1331nm CWDM',
    fiberType:        'SMF OS2',
    connector:        'LC',
    estimatedCostUSD: 950,
    compatibleSubLayers: ['spine', 'wan-edge'],
    notes:            '4-lambda CWDM4, 2km SMF, IXP/DCI'
  },
  {
    id:               'QSFP-DD-400G-LR4',
    model:            'QSFP-DD-400G-LR4',
    vendor:           'Generic',
    formFactor:       'QSFP-DD',
    speed:            '400G',
    reach_m:          10000,
    wavelength:       '1295-1310nm CWDM',
    fiberType:        'SMF OS2',
    connector:        'LC',
    estimatedCostUSD: 1400,
    compatibleSubLayers: ['spine', 'wan-edge'],
    notes:            '10km LR4, inter-site or long DCI'
  }
];

/**
 * Recommend optics for each link in the cabling schedule.
 *
 * For each distinct (speed, distance, subLayer) combination, pick the
 * cheapest optic that meets reach and compatibility requirements.
 *
 * Returns array of:
 *   { speed, distanceM, subLayer, optic, qty, totalCostUSD }
 *
 * Also adds optics line items to STATE.optics.
 */
function recommendOptics(cablingSchedule, devices, state) {
  if (!cablingSchedule || !cablingSchedule.length) return [];

  // Build a map of device hostname -> subLayer for quick lookup
  var deviceLayerMap = {};
  (devices || []).forEach(function(d) {
    deviceLayerMap[d.hostname] = d.subLayer;
  });

  // Group links by (speed, distanceM, layerPair) to find unique optic needs
  var linkGroups = {};
  cablingSchedule.forEach(function(link) {
    // Infer speed from cable part number or devices
    var devA = (devices || []).find(function(d) { return d.hostname === link.deviceA; });
    var speed = devA ? devA.speed : '100G';
    var dist  = link.lengthM;
    var layer = devA ? devA.subLayer : 'leaf';
    var key   = speed + '|' + dist + '|' + layer;
    if (!linkGroups[key]) {
      linkGroups[key] = { speed: speed, distanceM: dist, subLayer: layer, count: 0 };
    }
    linkGroups[key].count += 2; // 2 optics per link (one each end)
  });

  var recommendations = [];

  Object.values(linkGroups).forEach(function(group) {
    // Find cheapest compatible optic that covers the distance
    var candidates = OPTICS.filter(function(o) {
      return o.speed === group.speed &&
             o.reach_m >= group.distanceM &&
             o.compatibleSubLayers.indexOf(group.subLayer) !== -1;
    });

    if (!candidates.length) {
      // Relax subLayer constraint
      candidates = OPTICS.filter(function(o) {
        return o.speed === group.speed && o.reach_m >= group.distanceM;
      });
    }

    if (!candidates.length) return;

    // Sort by cost ascending
    candidates.sort(function(a, b) { return a.estimatedCostUSD - b.estimatedCostUSD; });
    var best = candidates[0];

    recommendations.push({
      speed:         group.speed,
      distanceM:     group.distanceM,
      subLayer:      group.subLayer,
      opticId:       best.id,
      opticModel:    best.model,
      formFactor:    best.formFactor,
      wavelength:    best.wavelength,
      fiberType:     best.fiberType,
      reach_m:       best.reach_m,
      notes:         best.notes,
      unitCostUSD:   best.estimatedCostUSD,
      qty:           group.count,
      totalCostUSD:  best.estimatedCostUSD * group.count
    });
  });

  if (state) state.optics = recommendations;
  return recommendations;
}

/**
 * Render optics recommendation table as HTML.
 */
function renderOpticsTable(recommendations) {
  if (!recommendations || !recommendations.length) {
    return '<p class="empty-state">No optics data — generate BOM first.</p>';
  }

  var grandTotal = recommendations.reduce(function(s, r) { return s + r.totalCostUSD; }, 0);

  var rows = recommendations.map(function(r) {
    return '<tr>' +
      '<td><strong>' + r.opticModel + '</strong></td>' +
      '<td><span class="badge-ff">' + r.formFactor + '</span></td>' +
      '<td>' + r.speed + '</td>' +
      '<td>' + r.wavelength + '</td>' +
      '<td>' + r.fiberType + '</td>' +
      '<td>' + r.reach_m.toLocaleString() + ' m</td>' +
      '<td>' + r.distanceM + ' m link</td>' +
      '<td>' + r.subLayer + '</td>' +
      '<td>' + r.qty + '</td>' +
      '<td>$' + r.unitCostUSD + '</td>' +
      '<td>$' + r.totalCostUSD.toLocaleString() + '</td>' +
      '<td><small>' + r.notes + '</small></td>' +
    '</tr>';
  }).join('');

  return '<table class="bom-table optics-table">' +
    '<thead><tr>' +
      '<th>Model</th><th>Form Factor</th><th>Speed</th><th>Wavelength</th>' +
      '<th>Fiber</th><th>Max Reach</th><th>Link Dist</th><th>Layer</th>' +
      '<th>Qty</th><th>Unit $</th><th>Total $</th><th>Notes</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="10"><strong>Total Optics Cost</strong></td>' +
    '<td><strong>$' + grandTotal.toLocaleString() + '</strong></td><td></td></tr></tfoot>' +
    '</table>';
}

/**
 * Export optics recommendations as CSV.
 */
function exportOpticsCSV(recommendations) {
  var header = ['Model','Form Factor','Speed','Wavelength','Fiber','Max Reach (m)',
                 'Link Distance (m)','Sub-Layer','Qty','Unit Cost USD','Total Cost USD','Notes'];
  var rows = recommendations.map(function(r) {
    return [r.opticModel, r.formFactor, r.speed, r.wavelength, r.fiberType,
            r.reach_m, r.distanceM, r.subLayer, r.qty, r.unitCostUSD, r.totalCostUSD,
            '"' + r.notes + '"'].join(',');
  });
  return [header.join(',')].concat(rows).join('\n');
}

window.OPTICS            = OPTICS;
window.recommendOptics   = recommendOptics;
window.renderOpticsTable = renderOpticsTable;
window.exportOpticsCSV   = exportOpticsCSV;
