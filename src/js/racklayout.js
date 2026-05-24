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

  var rackDiagrams = '<div style="overflow-x:auto;white-space:nowrap;">'
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

  var placementTable = '<div style="overflow-x:auto;margin-top:20px;">'
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

  return legend + rackDiagrams + placementTable + virtSection;
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
