'use strict';

// Optics catalog: SFP/QSFP transceivers with compatibility and pricing
// reach_m    = OM4 / SMF reach (default, used when fiber type is unspecified or OM4)
// reach_om3  = OM3 reach (shorter; only relevant for MMF optics)
// fiberFamily: 'mmf' | 'smf' — used for fiber-type filtering (G-07)
var OPTICS = [
  {
    id:               'SFP-10G-SR',
    model:            'SFP-10G-SR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP+',
    speed:            '10G',
    reach_m:          400,    // OM4
    reach_om3:        300,    // OM3
    wavelength:       '850nm',
    fiberType:        'MMF OM3/OM4',
    fiberFamily:      'mmf',
    connector:        'LC',
    estimatedCostUSD: 25,
    compatibleSubLayers: ['leaf', 'access', 'distribution'],
    notes:            'SR = Short-Reach, 400m OM4 / 300m OM3'
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
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 55,
    compatibleSubLayers: ['leaf', 'distribution', 'wan-edge', 'firewall'],
    notes:            'LR = Long-Reach, 10km on SMF OS2'
  },
  {
    id:               'SFP-10G-ER',
    model:            'SFP-10G-ER',
    vendor:           'Generic',
    formFactor:       'SFP+',
    speed:            '10G',
    reach_m:          40000,
    wavelength:       '1550nm',
    fiberType:        'SMF OS2',
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 120,
    compatibleSubLayers: ['wan-edge'],
    notes:            'ER = Extended-Reach, 40km on SMF'
  },
  {
    id:               'SFP-25G-SR',
    model:            'SFP28-25G-SR',
    vendor:           'Generic / Cisco-compatible',
    formFactor:       'SFP28',
    speed:            '25G',
    reach_m:          100,    // OM4
    reach_om3:        70,     // OM3
    wavelength:       '850nm',
    fiberType:        'MMF OM3/OM4',
    fiberFamily:      'mmf',
    connector:        'LC',
    estimatedCostUSD: 45,
    compatibleSubLayers: ['leaf', 'distribution'],
    notes:            '25G SR, 100m OM4 / 70m OM3'
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
    fiberFamily:      'smf',
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
    reach_m:          100,    // OM4
    reach_om3:        70,     // OM3
    wavelength:       '850nm',
    fiberType:        'MMF OM3/OM4 (MPO-12)',
    fiberFamily:      'mmf',
    connector:        'MPO-12',
    estimatedCostUSD: 180,
    compatibleSubLayers: ['spine', 'leaf', 'distribution'],
    notes:            '4x25G NRZ, 100m OM4 / 70m OM3'
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
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 420,
    compatibleSubLayers: ['spine', 'leaf', 'wan-edge'],
    notes:            '4-lambda CWDM4, 10km SMF LC'
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
    fiberFamily:      'smf-mpo',
    connector:        'MPO-12',
    estimatedCostUSD: 95,
    compatibleSubLayers: ['spine', 'leaf'],
    notes:            'Parallel SMF MPO, 500m, cost-effective intra-DC'
  },
  {
    id:               'QSFP-28-100G-DR',
    model:            'QSFP-100G-DR',
    vendor:           'Generic',
    formFactor:       'QSFP28',
    speed:            '100G',
    reach_m:          500,
    wavelength:       '1310nm',
    fiberType:        'SMF OS2',
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 85,
    compatibleSubLayers: ['spine', 'leaf', 'distribution'],
    notes:            '100G DR, 500m SMF LC (single-lambda PAM4)'
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
    fiberFamily:      'smf-mpo',
    connector:        'MPO-12',
    estimatedCostUSD: 680,
    compatibleSubLayers: ['spine'],
    notes:            '4x100G PAM4, 500m SMF MPO, intra-DC'
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
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 950,
    compatibleSubLayers: ['spine', 'wan-edge'],
    notes:            '4-lambda CWDM4, 2km SMF LC'
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
    fiberFamily:      'smf',
    connector:        'LC',
    estimatedCostUSD: 1400,
    compatibleSubLayers: ['spine', 'wan-edge'],
    notes:            '10km LR4 SMF LC, inter-site / DCI'
  }
];

// ─── G-07: Fiber-type-aware optics selection ─────────────────────────────────

// Map cabling layerPair strings → STATE.fiberTypes keys
var LAYER_PAIR_TO_KEY = {
  'spine → leaf':           'spine-leaf',
  'core → distribution':    'core-dist',
  'distribution → access':  'dist-access',
  'wan-edge → distribution':'wan-edge',
  'wan-edge → spine':       'wan-edge',
  'firewall → distribution':'dist-access',
  'firewall → spine':       'spine-leaf',
  'cloud-transit → cloud-gw':'wan-edge'
};

/**
 * Returns true if optic is compatible with the requested fiber type.
 * fiberConstraint values: 'auto' | 'mmf-om4' | 'mmf-om3' | 'smf-lc' | 'smf-mpo'
 */
function _fiberMatches(optic, fiberConstraint) {
  if (!fiberConstraint || fiberConstraint === 'auto') return true;
  var ff = optic.fiberFamily || '';
  if (fiberConstraint === 'mmf-om4' || fiberConstraint === 'mmf-om3') {
    return ff === 'mmf';
  }
  if (fiberConstraint === 'smf-lc') {
    return ff === 'smf';          // SMF LC duplex (LR/ER/FR4/LR4/DR)
  }
  if (fiberConstraint === 'smf-mpo') {
    return ff === 'smf-mpo';      // SMF parallel MPO (PSM4/DR4)
  }
  return true;
}

/**
 * Effective reach for an optic given the fiber constraint.
 * OM3 uses the shorter reach_om3 value when specified.
 */
function _effectiveReach(optic, fiberConstraint) {
  if (fiberConstraint === 'mmf-om3' && optic.reach_om3 !== undefined) {
    return optic.reach_om3;
  }
  return optic.reach_m;
}

/**
 * Recommend optics for each link in the cabling schedule (G-07).
 *
 * Uses STATE.fiberTypes ({ 'spine-leaf': 'mmf-om4', ... }) to constrain
 * the selection to the correct fiber family. Falls back to 'auto' (cheapest)
 * when not specified.
 *
 * Returns array of:
 *   { speed, distanceM, subLayer, fiberConstraint, opticId, opticModel,
 *     formFactor, wavelength, fiberType, reach_m, notes, qty,
 *     unitCostUSD, totalCostUSD, warning }
 */
function recommendOptics(cablingSchedule, devices, state) {
  if (!cablingSchedule || !cablingSchedule.length) return [];

  var fiberTypes = (state && state.fiberTypes) || {};

  // Group links by (speed, distanceM, layerPair)
  var linkGroups = {};
  cablingSchedule.forEach(function(link) {
    var devA  = (devices || []).find(function(d) { return d.hostname === link.deviceA; });
    var speed = devA ? devA.speed : '100G';
    var dist  = link.lengthM;
    var layer = devA ? devA.subLayer : 'leaf';
    var lpKey = LAYER_PAIR_TO_KEY[link.layerPair] || 'spine-leaf';
    var fiber = fiberTypes[lpKey] || 'auto';
    var key   = speed + '|' + dist + '|' + layer + '|' + fiber;
    if (!linkGroups[key]) {
      linkGroups[key] = { speed: speed, distanceM: dist, subLayer: layer,
                          fiberConstraint: fiber, count: 0 };
    }
    linkGroups[key].count += 2; // 2 optics per link
  });

  var recommendations = [];

  Object.values(linkGroups).forEach(function(group) {
    var fc = group.fiberConstraint;

    // Candidates: match speed + fiber family + effective reach
    var candidates = OPTICS.filter(function(o) {
      return o.speed === group.speed &&
             _fiberMatches(o, fc) &&
             _effectiveReach(o, fc) >= group.distanceM &&
             o.compatibleSubLayers.indexOf(group.subLayer) !== -1;
    });

    // Relax subLayer if nothing found
    if (!candidates.length) {
      candidates = OPTICS.filter(function(o) {
        return o.speed === group.speed &&
               _fiberMatches(o, fc) &&
               _effectiveReach(o, fc) >= group.distanceM;
      });
    }

    var warning = null;
    // If fiber-constrained search failed, fall back to auto and warn
    if (!candidates.length && fc !== 'auto') {
      warning = 'No ' + fc + ' optic covers ' + group.distanceM + 'm at ' + group.speed
              + ' — falling back to any compatible optic.';
      candidates = OPTICS.filter(function(o) {
        return o.speed === group.speed && o.reach_m >= group.distanceM;
      });
    }

    if (!candidates.length) return;

    candidates.sort(function(a, b) { return a.estimatedCostUSD - b.estimatedCostUSD; });
    var best   = candidates[0];
    var reach  = _effectiveReach(best, fc);

    recommendations.push({
      speed:           group.speed,
      distanceM:       group.distanceM,
      subLayer:        group.subLayer,
      fiberConstraint: fc,
      opticId:         best.id,
      opticModel:      best.model,
      formFactor:      best.formFactor,
      wavelength:      best.wavelength,
      fiberType:       best.fiberType,
      reach_m:         reach,
      notes:           best.notes,
      unitCostUSD:     best.estimatedCostUSD,
      qty:             group.count,
      totalCostUSD:    best.estimatedCostUSD * group.count,
      warning:         warning
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

  var warnings = recommendations.filter(function(r) { return r.warning; });
  var warnBanner = warnings.length
    ? '<div class="val-block val-block-error" style="margin-bottom:10px;">'
      + '<div class="val-block-hdr">⚠ Fiber compatibility warnings</div>'
      + warnings.map(function(r) { return '<div>' + r.warning + '</div>'; }).join('')
      + '</div>'
    : '';

  var rows = recommendations.map(function(r) {
    var fiberBadge = r.fiberConstraint && r.fiberConstraint !== 'auto'
      ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(99,102,241,.15);color:#818cf8;margin-left:4px;">'
        + r.fiberConstraint + '</span>'
      : '';
    return '<tr' + (r.warning ? ' style="background:rgba(249,115,22,.05);"' : '') + '>' +
      '<td><strong>' + r.opticModel + '</strong></td>' +
      '<td><span class="badge-ff">' + r.formFactor + '</span></td>' +
      '<td>' + r.speed + '</td>' +
      '<td>' + r.wavelength + '</td>' +
      '<td>' + r.fiberType + fiberBadge + '</td>' +
      '<td>' + r.reach_m.toLocaleString() + ' m</td>' +
      '<td>' + r.distanceM + ' m</td>' +
      '<td>' + r.subLayer + '</td>' +
      '<td>' + r.qty + '</td>' +
      '<td>$' + r.unitCostUSD + '</td>' +
      '<td>$' + r.totalCostUSD.toLocaleString() + '</td>' +
      '<td><small>' + (r.warning ? '⚠ ' + r.warning : r.notes) + '</small></td>' +
    '</tr>';
  }).join('');

  return warnBanner + '<table class="bom-table optics-table">' +
    '<thead><tr>' +
      '<th>Model</th><th>Form Factor</th><th>Speed</th><th>Wavelength</th>' +
      '<th>Fiber / Constraint</th><th>Reach</th><th>Link Dist</th><th>Layer</th>' +
      '<th>Qty</th><th>Unit $</th><th>Total $</th><th>Notes / Warning</th>' +
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
