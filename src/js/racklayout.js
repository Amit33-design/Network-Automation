'use strict';

// ─── G-05: Rack layout & cable schedule ──────────────────────────────────────
// Assigns every physical device a rack ID and U slot, then renders visual
// rack diagrams (42U) and a full rack inventory / cable-schedule CSV.

var RACK_SIZE_U = 42;

// U height consumed per role (0 = virtual, no rack placement)
var U_HEIGHT = {
  'super-spine': 2,
  'spine':       2,
  'core':        2,
  'distribution':2,
  'leaf':        1,
  'access':      1,
  'firewall':    2,
  'wan-edge':    2,
  'cloud-transit':0,
  'cloud-gw':    0
};

// Fill order inside a rack: lower index = placed higher (lower U number subtracted first)
var ROLE_ORDER = [
  'super-spine','spine','core','distribution','leaf','access','firewall','wan-edge'
];

// Visual color per role (used inline in rack diagram)
var ROLE_COLOR = {
  'super-spine': '#6366f1',
  'spine':       '#3b82f6',
  'core':        '#8b5cf6',
  'distribution':'#a855f7',
  'leaf':        '#22c55e',
  'access':      '#14b8a6',
  'firewall':    '#f97316',
  'wan-edge':    '#eab308'
};

function _uHeight(dev) {
  var h = U_HEIGHT[dev.subLayer];
  return (h !== undefined) ? h : 1;
}

function _rackId(index) {
  // Returns "A01", "A02" … "A09", "A10" …
  return 'A' + String(index + 1).padStart(2, '0');
}

/**
 * Assign rack positions to all devices in place.
 * Updates dev.rack and dev.unit (1-based, bottom of occupied slot block).
 * Returns an array of rack objects used by renderRackLayout.
 */
window.assignRackPositions = function(devices) {
  if (!devices || !devices.length) return [];

  // Separate physical and virtual devices
  var physDevices = devices.filter(function(d) { return _uHeight(d) > 0; });
  var virtDevices = devices.filter(function(d) { return _uHeight(d) === 0; });

  // Sort physical devices by role fill order
  physDevices.sort(function(a, b) {
    var ai = ROLE_ORDER.indexOf(a.subLayer);
    var bi = ROLE_ORDER.indexOf(b.subLayer);
    if (ai === -1) ai = ROLE_ORDER.length;
    if (bi === -1) bi = ROLE_ORDER.length;
    return ai - bi;
  });

  // Racks: each is { id, slots: Array(RACK_SIZE_U+1), devices: [] }
  // slots[u] = device or null (1-indexed, u=1..42)
  var racks = [];

  function newRack() {
    var r = { id: _rackId(racks.length), slots: new Array(RACK_SIZE_U + 2).fill(null), devices: [], freeU: RACK_SIZE_U };
    racks.push(r);
    return r;
  }

  var currentRack = newRack();
  var lastRole = null;
  // nextStart: the next available U from the top (42 → 1)
  var nextStart = RACK_SIZE_U;

  function startNewRack() {
    currentRack = newRack();
    nextStart = RACK_SIZE_U;
    lastRole = null;
  }

  physDevices.forEach(function(dev) {
    var h = _uHeight(dev);
    // 1U gap between role groups to allow cable management
    var gap = (lastRole !== null && lastRole !== dev.subLayer) ? 1 : 0;

    if (nextStart - h - gap < 0) {
      startNewRack();
      gap = 0;
    }

    // Skip gap U slots
    nextStart -= gap;
    // Device occupies U slots: nextStart down to (nextStart - h + 1)
    var topU = nextStart;
    var botU = nextStart - h + 1;

    dev.rack = currentRack.id;
    dev.unit = topU;  // topmost U (largest number, closest to top of rack)
    dev.unitHeight = h;

    // Mark slots
    for (var u = topU; u >= botU; u--) {
      currentRack.slots[u] = dev;
    }
    currentRack.devices.push(dev);
    currentRack.freeU -= (h + gap);
    nextStart = botU - 1;
    lastRole = dev.subLayer;
  });

  // Virtual devices get a placeholder location
  virtDevices.forEach(function(dev) {
    dev.rack = 'VIRTUAL';
    dev.unit = 0;
    dev.unitHeight = 0;
  });

  return racks;
};

// ─── Visual rack diagram renderer ────────────────────────────────────────────

function _deviceColor(dev) {
  return ROLE_COLOR[dev.subLayer] || '#64748b';
}

function _renderSingleRack(rack) {
  // Build row data top-to-bottom (U42 → U1)
  var rows = '';
  var u = RACK_SIZE_U;
  while (u >= 1) {
    var dev = rack.slots[u];
    if (dev && dev.unit === u) {
      // Top of this device — emit a rowspan cell
      var h = dev.unitHeight || 1;
      var color = _deviceColor(dev);
      var label = dev.hostname || dev.model || dev.id;
      var shortModel = (dev.model || '').replace('Nexus ', 'NX ').replace('Catalyst ', 'Cat ');
      rows += '<tr>'
        + '<td class="rack-u-num" style="width:28px;text-align:right;font-size:10px;color:var(--text-dim);padding-right:4px;">'
        + 'U' + u + '</td>'
        + '<td rowspan="' + h + '" style="background:' + color + '22;border:1px solid ' + color + '55;'
        + 'border-radius:3px;padding:2px 6px;vertical-align:middle;">'
        + '<div style="font-size:11px;font-weight:600;color:' + color + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + label + '">' + label + '</div>'
        + '<div style="font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + shortModel + '</div>'
        + '</td></tr>';
      u -= h;
    } else if (!dev) {
      rows += '<tr>'
        + '<td class="rack-u-num" style="width:28px;text-align:right;font-size:10px;color:var(--text-dim);padding-right:4px;">U' + u + '</td>'
        + '<td style="border:1px solid var(--border);border-radius:2px;height:18px;background:var(--surface2);"></td></tr>';
      u -= 1;
    } else {
      // Continuation of a multi-U device — already handled by rowspan
      u -= 1;
    }
  }

  var utilPct = Math.round((RACK_SIZE_U - rack.freeU) / RACK_SIZE_U * 100);
  var utilColor = utilPct > 85 ? '#f97316' : utilPct > 60 ? '#eab308' : '#22c55e';

  return '<div style="display:inline-block;vertical-align:top;margin:0 12px 16px 0;min-width:180px;">'
    + '<div style="font-size:13px;font-weight:600;margin-bottom:4px;color:var(--text);">Rack ' + rack.id + '</div>'
    + '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">'
    + rack.devices.length + ' devices &nbsp;|&nbsp; '
    + '<span style="color:' + utilColor + ';">' + utilPct + '% utilised</span>'
    + ' &nbsp;(' + rack.freeU + 'U free)</div>'
    + '<table style="border-collapse:collapse;width:180px;">'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

window.renderRackLayout = function(devices) {
  if (!devices || !devices.length) {
    return '<p class="empty-state">Generate BOM first.</p>';
  }

  var racks = window.assignRackPositions(devices);
  var physRacks = racks.filter(function(r) { return r.devices.length > 0; });
  var virtDevices = devices.filter(function(d) { return d.rack === 'VIRTUAL'; });

  if (!physRacks.length) {
    return '<p class="empty-state">No physical devices to place.</p>';
  }

  // Legend
  var legendItems = Object.keys(ROLE_COLOR).map(function(role) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;">'
      + '<span style="width:10px;height:10px;border-radius:2px;background:' + ROLE_COLOR[role] + ';display:inline-block;"></span>'
      + role + '</span>';
  }).join('');

  var legend = '<div style="margin-bottom:12px;line-height:2;">' + legendItems + '</div>';

  var rackDiagrams = '<div style="overflow-x:auto;white-space:nowrap;max-width:100%;">'
    + physRacks.map(_renderSingleRack).join('')
    + '</div>';

  // Device placement table
  var tableRows = devices
    .filter(function(d) { return d.rack !== 'VIRTUAL'; })
    .map(function(d) {
      var color = _deviceColor(d);
      return '<tr>'
        + '<td><strong>' + (d.hostname || d.id || '—') + '</strong></td>'
        + '<td>' + d.model + '</td>'
        + '<td><span style="font-size:11px;padding:2px 6px;border-radius:3px;background:' + color + '22;color:' + color + ';">' + d.subLayer + '</span></td>'
        + '<td style="font-weight:600;">' + d.rack + '</td>'
        + '<td>U' + d.unit + (d.unitHeight > 1 ? '–U' + (d.unit - d.unitHeight + 1) : '') + '</td>'
        + '<td>' + (d.unitHeight || 1) + 'U</td>'
        + '</tr>';
    }).join('');

  var placementTable = '<div style="overflow-x:auto;margin-top:20px;max-width:100%;">'
    + '<table class="bom-table diff-table">'
    + '<thead><tr><th>Hostname</th><th>Model</th><th>Role</th><th>Rack</th><th>Position</th><th>Height</th></tr></thead>'
    + '<tbody>' + tableRows + '</tbody>'
    + '</table></div>';

  var virtSection = '';
  if (virtDevices.length) {
    virtSection = '<div style="margin-top:12px;font-size:13px;color:var(--text-dim);">'
      + '<strong>' + virtDevices.length + ' virtual device(s):</strong> '
      + virtDevices.map(function(d) { return d.hostname || d.id; }).join(', ')
      + ' — no physical rack slot required.</div>';
  }

  return legend + rackDiagrams + placementTable + virtSection
       + window.renderPowerCooling(devices);
};

// ─── Power & Cooling engine ───────────────────────────────────────────────────

// Standard 3-phase rack PDU sizes (kW) — pick smallest that covers load + 25% headroom
var PDU_SIZES_KW = [7.2, 10.4, 14.4, 17.3, 21.6, 36, 60];

// Cooling tier guidance thresholds (W per rack)
var COOLING_TIERS = [
  { maxW: 5000,  label: 'Standard air (≤5 kW)',      desc: '2 perforated floor tiles per rack, standard CRAC airflow' },
  { maxW: 10000, label: 'High-density air (5–10 kW)', desc: 'Blanking panels essential; consider hot-aisle/cold-aisle containment' },
  { maxW: 20000, label: 'In-row cooling (10–20 kW)',  desc: 'In-row CRAH or rear-door heat exchanger recommended' },
  { maxW: Infinity, label: 'Liquid/direct cooling (>20 kW)', desc: 'Direct liquid cooling or liquid-cooled rear-door HX required' }
];

var BTU_PER_WATT_HR  = 3.412;   // 1 W electrical → 3.412 BTU/hr heat
var TONS_PER_KW      = 0.2843;  // 1 kW cooling = 0.2843 tons of refrigeration
var DEFAULT_PUE      = 1.5;     // industry-average for network/compute DC
var POWER_USD_PER_KWH = 0.10;

function _pduSize(rackPowerW) {
  var needed = rackPowerW / 1000 * 1.25;  // 25% headroom
  for (var i = 0; i < PDU_SIZES_KW.length; i++) {
    if (PDU_SIZES_KW[i] >= needed) return PDU_SIZES_KW[i];
  }
  return Math.ceil(needed / 10) * 10;
}

function _coolingTier(rackPowerW) {
  for (var i = 0; i < COOLING_TIERS.length; i++) {
    if (rackPowerW <= COOLING_TIERS[i].maxW) return COOLING_TIERS[i];
  }
  return COOLING_TIERS[COOLING_TIERS.length - 1];
}

/**
 * Calculate per-rack and total power/cooling data.
 * Returns { racks: [...], totals: {...} }
 */
window.calcRackPower = function(devices, pue) {
  pue = pue || DEFAULT_PUE;
  if (!devices || !devices.length) return { racks: [], totals: {} };

  // Group devices by rack
  var rackMap = {};
  devices.forEach(function(d) {
    if (!d.rack || d.rack === 'VIRTUAL') return;
    if (!rackMap[d.rack]) rackMap[d.rack] = { rackId: d.rack, devices: [], totalPowerW: 0, usedU: 0 };
    rackMap[d.rack].devices.push(d);
    rackMap[d.rack].totalPowerW += (d.powerW || 0);
    rackMap[d.rack].usedU       += (d.unitHeight || _uHeight(d));
  });

  var racks = Object.values(rackMap).map(function(r) {
    var pw       = r.totalPowerW;
    var pduKw    = _pduSize(pw);
    var tier     = _coolingTier(pw);
    var btuHr    = Math.round(pw * BTU_PER_WATT_HR);
    var coolingKw= Math.round(pw / 1000 * 10) / 10;
    var coolTons = Math.round(coolingKw * TONS_PER_KW * 10) / 10;
    return {
      rackId:      r.rackId,
      devices:     r.devices,
      totalPowerW: pw,
      totalPowerKw:Math.round(pw / 100) / 10,
      usedU:       r.usedU,
      freeU:       RACK_SIZE_U - r.usedU,
      pduKw:       pduKw,
      coolingKw:   coolingKw,
      coolTons:    coolTons,
      btuHr:       btuHr,
      tier:        tier
    };
  });

  var totalITW    = racks.reduce(function(s, r) { return s + r.totalPowerW; }, 0);
  var facilityW   = Math.round(totalITW * pue);
  var coolingW    = facilityW - totalITW;
  var coolingTons = Math.round(coolingW / 1000 * TONS_PER_KW * 10) / 10;
  var annualKwh   = Math.round(facilityW * 8760 / 1000);
  var annualCostUSD = Math.round(annualKwh * POWER_USD_PER_KWH);

  return {
    racks:  racks,
    pue:    pue,
    totals: {
      totalITW:       totalITW,
      totalITKw:      Math.round(totalITW / 100) / 10,
      facilityKw:     Math.round(facilityW / 100) / 10,
      coolingKw:      Math.round(coolingW / 100) / 10,
      coolingTons:    coolingTons,
      annualKwh:      annualKwh,
      annualCostUSD:  annualCostUSD,
      rackCount:      racks.length
    }
  };
};

/**
 * Render power & cooling report as HTML.
 */
window.renderPowerCooling = function(devices, pue) {
  var data = window.calcRackPower(devices, pue);
  if (!data.racks.length) return '';

  var tot = data.totals;
  var fmtW  = function(w) { return w >= 1000 ? (Math.round(w/100)/10) + ' kW' : w + ' W'; };
  var fmtKw = function(kw) { return kw + ' kW'; };

  // ── Summary cards ──────────────────────────────────────────────────────────
  function card(label, val, sub, color) {
    return '<div style="flex:1;min-width:130px;background:var(--surface2);border:1px solid var(--border);'
      + 'border-radius:var(--radius);padding:12px 14px;">'
      + '<div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;">' + label + '</div>'
      + '<div style="font-size:20px;font-weight:700;color:' + (color||'var(--text)') + ';margin:3px 0 2px;">' + val + '</div>'
      + (sub ? '<div style="font-size:11px;color:var(--text-dim);">' + sub + '</div>' : '')
      + '</div>';
  }

  var cards = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">'
    + card('IT Load',        fmtKw(tot.totalITKw),   tot.rackCount + ' rack(s) combined',          '#3b82f6')
    + card('Facility Load',  fmtKw(tot.facilityKw),  'At PUE ' + data.pue + ' (IT + cooling + UPS)','#f97316')
    + card('Cooling Load',   fmtKw(tot.coolingKw),   tot.coolingTons + ' tons of refrigeration',   '#22c55e')
    + card('Annual Energy',  (tot.annualKwh/1000).toFixed(1) + ' MWh', '~$' + tot.annualCostUSD.toLocaleString() + '/yr @ $0.10/kWh', '#eab308')
    + '</div>';

  // ── Per-rack table ─────────────────────────────────────────────────────────
  var rackRows = data.racks.map(function(r) {
    var tierColor = r.totalPowerW > 20000 ? '#f97316' : r.totalPowerW > 10000 ? '#eab308' : '#22c55e';
    return '<tr>'
      + '<td><strong>' + r.rackId + '</strong></td>'
      + '<td>' + r.devices.length + ' devices</td>'
      + '<td style="font-weight:600;">' + fmtW(r.totalPowerW) + '</td>'
      + '<td>' + r.usedU + 'U / 42U</td>'
      + '<td>2 × ' + r.pduKw + ' kW PDU <span style="font-size:10px;color:var(--text-dim);">(2N)</span></td>'
      + '<td>' + r.coolingKw + ' kW &nbsp;<span style="color:var(--text-dim);font-size:11px;">(' + r.btuHr.toLocaleString() + ' BTU/hr)</span></td>'
      + '<td style="font-size:11px;color:' + tierColor + ';">' + r.tier.label + '</td>'
      + '</tr>';
  }).join('');

  var rackTable = '<div style="overflow-x:auto;max-width:100%;">'
    + '<table class="bom-table diff-table" style="min-width:640px;">'
    + '<thead><tr><th>Rack</th><th>Devices</th><th>IT Load</th><th>U Fill</th>'
    + '<th>PDU (2N)</th><th>Cooling Load</th><th>Cooling Tier</th></tr></thead>'
    + '<tbody>' + rackRows + '</tbody>'
    + '<tfoot><tr><td><strong>Total</strong></td><td>' + devices.filter(function(d){return d.rack!=='VIRTUAL';}).length + ' devices</td>'
    + '<td><strong>' + fmtKw(tot.totalITKw) + '</strong></td>'
    + '<td>—</td>'
    + '<td>—</td>'
    + '<td><strong>' + fmtKw(tot.coolingKw) + ' (' + tot.coolingTons + ' tons)</strong></td>'
    + '<td>—</td></tr></tfoot>'
    + '</table></div>';

  // ── Cooling tier legend ────────────────────────────────────────────────────
  var tierNotes = data.racks.map(function(r) {
    return '<div style="margin:4px 0;font-size:12px;color:var(--text-dim);">'
      + '<strong style="color:var(--text);">Rack ' + r.rackId + ' (' + r.tier.label + '):</strong> ' + r.tier.desc
      + '</div>';
  }).join('');

  // ── Device power breakdown table ───────────────────────────────────────────
  var devRows = devices
    .filter(function(d) { return d.rack !== 'VIRTUAL' && d.powerW; })
    .sort(function(a, b) { return (b.powerW||0) - (a.powerW||0); })
    .map(function(d) {
      var pct = tot.totalITW > 0 ? Math.round(d.powerW / tot.totalITW * 100) : 0;
      var bar = '<div style="display:inline-block;width:' + Math.max(pct,2) + '%;height:8px;'
        + 'background:' + (_deviceColor(d)) + '55;border-radius:2px;vertical-align:middle;"></div>';
      return '<tr>'
        + '<td>' + (d.hostname||d.id||'—') + '</td>'
        + '<td>' + d.model + '</td>'
        + '<td>' + d.subLayer + '</td>'
        + '<td>' + d.rack + '</td>'
        + '<td style="font-weight:600;">' + d.powerW + ' W</td>'
        + '<td>' + bar + ' <span style="font-size:11px;color:var(--text-dim);">' + pct + '%</span></td>'
        + '</tr>';
    }).join('');

  var devPowerTable = '<details style="margin-top:12px;">'
    + '<summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text);padding:6px 0;">'
    + '▶ Device power breakdown (' + devices.filter(function(d){return d.rack!=='VIRTUAL'&&d.powerW;}).length + ' devices)</summary>'
    + '<div style="overflow-x:auto;margin-top:8px;max-width:100%;">'
    + '<table class="bom-table diff-table" style="min-width:480px;">'
    + '<thead><tr><th>Hostname</th><th>Model</th><th>Role</th><th>Rack</th><th>Power</th><th>% of Total IT</th></tr></thead>'
    + '<tbody>' + devRows + '</tbody>'
    + '</table></div></details>';

  var notes = '<div style="margin-top:10px;font-size:12px;color:var(--text-dim);line-height:1.8;">'
    + '<strong>Assumptions:</strong> PUE ' + data.pue + ' (industry-average DC). '
    + 'PDU sized at 2N redundancy with 25% headroom. '
    + 'Cooling load = IT load × (PUE−1). 1 ton refrigeration = 3.517 kW = 12,000 BTU/hr. '
    + 'Power cost @ $0.10/kWh. Device power from vendor datasheets (max draw).'
    + '</div>';

  return '<hr style="margin:24px 0;border-color:var(--border);">'
    + '<h3 style="margin:0 0 12px;font-size:15px;">Power &amp; Cooling Estimates</h3>'
    + cards + rackTable + tierNotes + devPowerTable + notes;
};

// ─── CSV export ──────────────────────────────────────────────────────────────

window.exportRackLayoutCSV = function(devices) {
  var header = 'Hostname,Model,Vendor,Role,Rack,Top-U,Height-U,Power-W';
  var rows = (devices || []).map(function(d) {
    return [
      d.hostname || '',
      d.model    || '',
      d.vendor   || '',
      d.subLayer || '',
      d.rack     || '',
      d.unit     || '',
      d.unitHeight || (U_HEIGHT[d.subLayer] !== undefined ? U_HEIGHT[d.subLayer] : 1),
      d.powerW   || ''
    ].join(',');
  });
  return [header].concat(rows).join('\n');
};
