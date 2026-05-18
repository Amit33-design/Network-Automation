'use strict';

// Cable type selection rules based on distance (metres) and speed
var CABLE_TYPES = [
  // Passive copper (DAC)
  { id: 'DAC-1M',  type: 'DAC', desc: 'Direct Attach Copper 1m',  maxDist: 1,    speeds: ['1G','10G','25G','40G','100G'],        partPrefix: 'SFP-H10GB-CU1M',  costPerM: 0,   unitCost: 25   },
  { id: 'DAC-3M',  type: 'DAC', desc: 'Direct Attach Copper 3m',  maxDist: 3,    speeds: ['1G','10G','25G','40G','100G'],        partPrefix: 'SFP-H10GB-CU3M',  costPerM: 0,   unitCost: 35   },
  { id: 'DAC-5M',  type: 'DAC', desc: 'Direct Attach Copper 5m',  maxDist: 5,    speeds: ['1G','10G','25G','40G','100G'],        partPrefix: 'SFP-H10GB-CU5M',  costPerM: 0,   unitCost: 45   },
  { id: 'QSFP-DAC-1M', type: 'DAC', desc: 'QSFP DAC 1m',        maxDist: 1,    speeds: ['40G','100G','400G'],                  partPrefix: 'QSFP-100G-CU1M',  costPerM: 0,   unitCost: 55   },
  { id: 'QSFP-DAC-3M', type: 'DAC', desc: 'QSFP DAC 3m',        maxDist: 3,    speeds: ['40G','100G','400G'],                  partPrefix: 'QSFP-100G-CU3M',  costPerM: 0,   unitCost: 65   },
  // Active optical (AOC)
  { id: 'AOC-10M', type: 'AOC', desc: 'Active Optical Cable 10m', maxDist: 10,   speeds: ['10G','25G','40G','100G'],             partPrefix: 'SFP-10G-AOC10M',  costPerM: 8,   unitCost: 80   },
  { id: 'AOC-30M', type: 'AOC', desc: 'Active Optical Cable 30m', maxDist: 30,   speeds: ['10G','25G','40G','100G'],             partPrefix: 'SFP-10G-AOC30M',  costPerM: 8,   unitCost: 240  },
  { id: 'QSFP-AOC-10M', type: 'AOC', desc: 'QSFP AOC 10m',      maxDist: 10,   speeds: ['40G','100G'],                         partPrefix: 'QSFP-100G-AOC10M',costPerM: 10,  unitCost: 100  },
  // LC-LC SMF
  { id: 'LC-LC-SM', type: 'LC-LC', desc: 'LC-LC Single-mode Fiber', maxDist: 10000, speeds: ['1G','10G','25G','100G'],          partPrefix: 'LC-LC-SM',        costPerM: 0.5, unitCost: 15   },
  // MPO (parallel optics, 100G+)
  { id: 'MPO-12',  type: 'MPO', desc: 'MPO-12 OM4 multimode',    maxDist: 100,  speeds: ['40G','100G','400G'],                  partPrefix: 'MPO-12-OM4',      costPerM: 1.2, unitCost: 20   },
  { id: 'MPO-16',  type: 'MPO', desc: 'MPO-16 OM5 multimode',    maxDist: 150,  speeds: ['400G'],                               partPrefix: 'MPO-16-OM5',      costPerM: 1.5, unitCost: 30   }
];

// Preferred cable type selection: pick cheapest option within distance/speed
function selectCableType(distanceM, speed) {
  var candidates = CABLE_TYPES.filter(function(c) {
    return c.maxDist >= distanceM && c.speeds.indexOf(speed) !== -1;
  });
  if (!candidates.length) {
    // Fallback to LC-LC SMF for any distance
    candidates = CABLE_TYPES.filter(function(c) { return c.type === 'LC-LC'; });
  }
  // Prefer: DAC (cheapest, ≤5m) > AOC (≤30m) > MPO (≤150m) > LC-LC
  var priority = { DAC: 0, AOC: 1, MPO: 2, 'LC-LC': 3 };
  candidates.sort(function(a, b) { return priority[a.type] - priority[b.type]; });
  return candidates[0] || CABLE_TYPES[CABLE_TYPES.length - 1];
}

function buildPartNumber(cableType, speed, distanceM) {
  return cableType.partPrefix + '-' + speed.replace('G', '') + 'G-' + distanceM + 'M';
}

/**
 * Generate a cable schedule for all layer-to-layer connections in the BOM.
 *
 * Returns an array of entries:
 *   { layerPair, deviceA, portA, deviceB, portB, cableType, cableDesc, lengthM, qty, partNumber, unitCostUSD, totalCostUSD }
 *
 * Also stores result on STATE.cabling.
 */
function generateCablingMatrix(layers, devices, state) {
  var schedule = [];
  if (!devices || !devices.length) return schedule;

  var distances = (state && state.linkDistances) ? state.linkDistances : {};
  var defaultDist = 5; // metres

  // Group devices by subLayer
  var byLayer = {};
  devices.forEach(function(dev) {
    var l = dev.subLayer || 'unknown';
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(dev);
  });

  // Define which layers connect to which
  var CONNECTS = [
    { from: 'spine',        to: 'leaf',         key: 'spine-leaf'       },
    { from: 'core',         to: 'distribution', key: 'core-dist'        },
    { from: 'distribution', to: 'access',        key: 'dist-access'      },
    { from: 'wan-edge',     to: 'distribution', key: 'wan-edge'         },
    { from: 'wan-edge',     to: 'spine',        key: 'wan-edge'         },
    { from: 'firewall',     to: 'distribution', key: 'firewall-dist'    },
    { from: 'firewall',     to: 'spine',        key: 'firewall-spine'   },
    { from: 'cloud-transit',to: 'cloud-gw',     key: 'cloud-transit'    }
  ];

  var linkId = 1;

  CONNECTS.forEach(function(conn) {
    var fromDevices = byLayer[conn.from] || [];
    var toDevices   = byLayer[conn.to]   || [];
    if (!fromDevices.length || !toDevices.length) return;

    var distM = distances[conn.key] || defaultDist;
    var uplinkSpeed = fromDevices[0].speed || '100G';

    // Each 'from' device connects to every 'to' device (full mesh for spine-leaf)
    fromDevices.forEach(function(src, si) {
      toDevices.forEach(function(dst, di) {
        var cable = selectCableType(distM, uplinkSpeed);
        var portA = 'Et1/' + (di + 1);
        var portB = 'Et1/' + (si + 1);
        var unitCost = cable.unitCost + cable.costPerM * distM;
        schedule.push({
          id:           linkId++,
          layerPair:    conn.from + ' → ' + conn.to,
          deviceA:      src.hostname || src.id,
          portA:        portA,
          deviceB:      dst.hostname || dst.id,
          portB:        portB,
          cableType:    cable.type,
          cableDesc:    cable.desc,
          lengthM:      distM,
          qty:          1,
          partNumber:   buildPartNumber(cable, uplinkSpeed, distM),
          unitCostUSD:  Math.round(unitCost),
          totalCostUSD: Math.round(unitCost)
        });
      });
    });
  });

  if (state) state.cabling = schedule;
  return schedule;
}

/**
 * Render the cabling schedule as an HTML table string.
 */
function renderCablingTable(schedule) {
  if (!schedule || !schedule.length) {
    return '<p class="empty-state">No cabling data — generate BOM first.</p>';
  }

  var totalCost = schedule.reduce(function(sum, r) { return sum + r.totalCostUSD; }, 0);

  var rows = schedule.map(function(r) {
    var typeClass = 'cable-' + r.cableType.toLowerCase().replace(/[^a-z]/g, '');
    return '<tr>' +
      '<td>' + r.id + '</td>' +
      '<td>' + r.layerPair + '</td>' +
      '<td><strong>' + r.deviceA + '</strong> ' + r.portA + '</td>' +
      '<td><strong>' + r.deviceB + '</strong> ' + r.portB + '</td>' +
      '<td><span class="cable-badge ' + typeClass + '">' + r.cableType + '</span></td>' +
      '<td>' + r.cableDesc + '</td>' +
      '<td>' + r.lengthM + ' m</td>' +
      '<td>' + r.qty + '</td>' +
      '<td><code>' + r.partNumber + '</code></td>' +
      '<td>$' + r.unitCostUSD.toLocaleString() + '</td>' +
    '</tr>';
  }).join('');

  return '<table class="bom-table cable-table">' +
    '<thead><tr>' +
      '<th>#</th><th>Layer Pair</th><th>Port A</th><th>Port B</th>' +
      '<th>Type</th><th>Description</th><th>Length</th><th>Qty</th>' +
      '<th>Part Number</th><th>Unit Cost</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '<tfoot><tr><td colspan="9"><strong>Total Cabling Cost</strong></td>' +
    '<td><strong>$' + totalCost.toLocaleString() + '</strong></td></tr></tfoot>' +
    '</table>';
}

/**
 * Export cabling schedule as CSV string.
 */
function exportCablingCSV(schedule) {
  var header = ['#','Layer Pair','Device A','Port A','Device B','Port B',
                 'Cable Type','Description','Length (m)','Qty','Part Number',
                 'Unit Cost USD','Total Cost USD'];
  var rows = schedule.map(function(r) {
    return [r.id, r.layerPair, r.deviceA, r.portA, r.deviceB, r.portB,
            r.cableType, r.cableDesc, r.lengthM, r.qty, r.partNumber,
            r.unitCostUSD, r.totalCostUSD].join(',');
  });
  return [header.join(',')].concat(rows).join('\n');
}

window.generateCablingMatrix = generateCablingMatrix;
window.renderCablingTable    = renderCablingTable;
window.exportCablingCSV      = exportCablingCSV;
window.CABLE_TYPES           = CABLE_TYPES;
