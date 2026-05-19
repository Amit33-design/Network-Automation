'use strict';

/*
  cabling.js — Cable schedule generator for NetDesign AI

  generateCablingMatrix(layers, state)  → array of cable-summary rows
  updateCablingMatrix(layers, state)    → renders collapsible section in BOM
  toggleCablingSection()                → expand / collapse the section
  getCablingCSVSection()                → CSV lines for exportBOM()

  Cable-type rules:
    DAC        ≤ 3 m   (Direct Attach Copper, same-rack / adjacent)
    AOC        ≤ 100 m (Active Optical Cable, cross-row / cross-pod)
    LC-LC SMF  > 100 m (Single-Mode Fiber, inter-building / WAN)
*/

/* ── Cable type by estimated length ────────────────────────────── */
function _cableType(lengthM) {
  if (lengthM <= 3)   return 'DAC';
  if (lengthM <= 100) return 'AOC';
  return 'LC-LC SMF';
}

/* ── Generic reference part numbers ────────────────────────────── */
var _PART_NUMS = {
  '1G-DAC':         'SFP-GE-CU1M',
  '10G-DAC':        'SFP-H10GB-CU3M',
  '25G-DAC':        'SFP-25G-DAC-3M',
  '100G-DAC':       'QSFP-100G-CU3M',
  '400G-DAC':       'QSFP-DD-400G-DAC-3M',
  '1G-AOC':         'SFP-GE-AOC5M',
  '10G-AOC':        'SFP-10G-AOC5M',
  '25G-AOC':        'SFP-25G-AOC5M',
  '100G-AOC':       'QSFP-100G-AOC7M',
  '400G-AOC':       'QSFP-DD-400G-AOC7M',
  '1G-LC-LC SMF':   'SFP-GE-LX-SM',
  '10G-LC-LC SMF':  'SFP-10G-LR',
  '25G-LC-LC SMF':  'SFP-25G-LR',
  '100G-LC-LC SMF': 'QSFP-100G-LR4',
  '400G-LC-LC SMF': 'QSFP-DD-400G-DR4',
};

function _partNum(speed, lengthM) {
  var type = _cableType(lengthM);
  var key  = speed + '-' + type;
  return _PART_NUMS[key] || ('QSFP-' + speed + '-' + (type === 'DAC' ? 'CU3M' : type === 'AOC' ? 'AOC5M' : 'LR4'));
}

/* ── First uplink port number from product port-string ─────────── */
function _uplinkOffset(prod) {
  if (!prod) return 49;
  var m = prod.ports.match(/^(\d+)/);
  return m ? parseInt(m[1]) + 1 : 49;
}

/* ── Link pair definitions per use case ────────────────────────── */
function _getLinkPairs(uc, layers) {
  var pairs   = [];
  var layerKeys = layers.map(function(l) { return l.key; });

  function has(k) { return layerKeys.indexOf(k) !== -1; }

  /* Campus: access → dist (5 m AOC, each access has 2 uplinks to its dist pair) */
  if (has('campus-access') && has('campus-dist') && uc !== 'wan') {
    pairs.push({ fromLayer:'campus-access', toLayer:'campus-dist',
      fromLabel:'Access', toLabel:'Distribution', lengthM:5, mode:'campus' });
  }

  /* Campus: dist → core (20 m AOC) */
  if (has('campus-dist') && has('campus-core')) {
    pairs.push({ fromLayer:'campus-dist', toLayer:'campus-core',
      fromLabel:'Distribution', toLabel:'Core', lengthM:20, mode:'campus' });
  }

  /* DC / Hybrid / Multisite: leaf ↔ spine (3 m DAC, full mesh) */
  if (has('dc-leaf') && has('dc-spine')) {
    pairs.push({ fromLayer:'dc-leaf', toLayer:'dc-spine',
      fromLabel:'DC Leaf (ToR)', toLabel:'DC Spine', lengthM:3, mode:'mesh' });
  }

  /* GPU cluster: TOR ↔ spine (3 m DAC, full mesh) */
  if (has('gpu-tor') && has('gpu-spine')) {
    pairs.push({ fromLayer:'gpu-tor', toLayer:'gpu-spine',
      fromLabel:'GPU TOR', toLabel:'GPU Spine', lengthM:3, mode:'mesh' });
  }

  /* WAN: branch CPE → hub router (500 m → LC-LC SMF, 1:1 load-balanced) */
  if (uc === 'wan') {
    var hubLayer = has('dc-spine') ? 'dc-spine' : (has('campus-core') ? 'campus-core' : null);
    if (has('campus-access') && hubLayer) {
      pairs.push({ fromLayer:'campus-access', toLayer:hubLayer,
        fromLabel:'Branch CPE', toLabel:'Hub Router', lengthM:500, mode:'wan' });
    }
  }

  return pairs;
}

/* ── Per-device-pair detail builders ───────────────────────────── */

/* Full-mesh: every fromDev connects to every toDev (leaf↔spine, TOR↔spine) */
function _meshDetails(fromDevs, toDevs, fromProd) {
  var details = [];
  var offset  = _uplinkOffset(fromProd);
  fromDevs.forEach(function(fd, fi) {
    toDevs.forEach(function(td, ti) {
      details.push({
        deviceA: fd.name, portA: 'Eth' + (offset + ti) + '/1',
        deviceB: td.name, portB: 'Eth' + (fi + 1) + '/1',
      });
    });
  });
  return details;
}

/*
  Campus: each fromDev (access) has exactly 2 uplinks to its distribution PAIR.
  Access switches are distributed evenly across dist pairs.
*/
function _campusDetails(fromDevs, toDevs, fromProd) {
  var details = [];
  var nTo     = toDevs.length;
  var pairs   = Math.max(1, Math.floor(nTo / 2));
  var perPair = Math.ceil(fromDevs.length / pairs);
  var offset  = _uplinkOffset(fromProd);

  fromDevs.forEach(function(fd, fi) {
    var pairIdx = Math.min(Math.floor(fi / perPair), pairs - 1);
    var distA   = toDevs[pairIdx * 2]      || toDevs[0];
    var distB   = toDevs[pairIdx * 2 + 1]  || distA;
    /* uplink 1 → dist A, uplink 2 → dist B */
    details.push({ deviceA: fd.name, portA: 'Eth' + offset + '/1',
                   deviceB: distA.name,    portB: 'Eth' + (fi + 1) + '/1' });
    details.push({ deviceA: fd.name, portA: 'Eth' + (offset + 1) + '/1',
                   deviceB: distB.name,    portB: 'Eth' + (fi + 1) + '/1' });
  });
  return details;
}

/* WAN: each branch CPE uplinks to one hub router (round-robin) */
function _wanDetails(fromDevs, toDevs) {
  var details = [];
  var nHub    = toDevs.length;
  fromDevs.forEach(function(fd, fi) {
    var hub = toDevs[fi % nHub];
    details.push({
      deviceA: fd.name, portA: 'WAN0/0/0',
      deviceB: hub.name, portB: 'GigE0/' + (Math.floor(fi / nHub) + 1),
    });
  });
  return details;
}

/* ══════════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════════ */

function generateCablingMatrix(layers, state) {
  var rows = [];
  if (!layers || !layers.length) return rows;

  var devList = [];
  try { devList = buildDeviceList(); } catch(e) { return rows; }

  /* group devices by layer key */
  var byLayer = {};
  devList.forEach(function(d) {
    if (!byLayer[d.layer]) byLayer[d.layer] = [];
    byLayer[d.layer].push(d);
  });

  var pairs = _getLinkPairs(state.uc, layers);

  pairs.forEach(function(pair) {
    var fromDevs = byLayer[pair.fromLayer] || [];
    var toDevs   = byLayer[pair.toLayer]   || [];
    if (!fromDevs.length || !toDevs.length) return;

    var fromProd = PRODUCTS[(state.selectedProducts || {})[pair.fromLayer]];
    var speed    = (fromProd && fromProd.upSpeed) ? fromProd.upSpeed : '100G';
    var type     = _cableType(pair.lengthM);
    var pn       = _partNum(speed, pair.lengthM);

    var details;
    if      (pair.mode === 'mesh')   details = _meshDetails(fromDevs, toDevs, fromProd);
    else if (pair.mode === 'campus') details = _campusDetails(fromDevs, toDevs, fromProd);
    else                             details = _wanDetails(fromDevs, toDevs);

    rows.push({
      connectionId: pair.fromLayer + '-' + pair.toLayer,
      fromLabel:    pair.fromLabel,
      toLabel:      pair.toLabel,
      speed:        speed,
      lengthM:      pair.lengthM,
      cableType:    type,
      partNum:      pn,
      qty:          details.length,
      details:      details,
    });
  });

  return rows;
}

/* ── Render collapsible cabling section below BOM table ─────────── */
function updateCablingMatrix(layers, state) {
  var sec = document.getElementById('cabling-section');
  if (!sec) return;

  var useLayers = layers  || (typeof getLayersForUC === 'function' ? getLayersForUC() : []);
  var useState  = state   || STATE;

  var rows = generateCablingMatrix(useLayers, useState);
  if (!rows.length) { sec.style.display = 'none'; return; }

  var totalCables = rows.reduce(function(s, r) { return s + r.qty; }, 0);

  var tableRows = rows.map(function(r) {
    var typeClass = r.cableType === 'DAC' ? 'cable-dac'
                  : r.cableType === 'AOC' ? 'cable-aoc' : 'cable-smf';
    return '<tr>' +
      '<td><strong>' + r.fromLabel + '</strong> ↔ <strong>' + r.toLabel + '</strong></td>' +
      '<td style="text-align:center"><span class="cable-speed">' + r.speed + '</span></td>' +
      '<td style="text-align:center"><span class="cable-type-badge ' + typeClass + '">' + r.cableType + '</span></td>' +
      '<td style="text-align:center">' + r.lengthM + ' m</td>' +
      '<td style="font-family:monospace;font-size:.75rem;color:var(--txt2)">' + r.partNum + '</td>' +
      '<td style="text-align:center;font-weight:700;color:var(--green)">' + r.qty + '</td>' +
      '</tr>';
  }).join('');

  sec.style.display = 'block';
  sec.innerHTML =
    '<div class="cabling-head" onclick="toggleCablingSection()">' +
      '<div style="display:flex;align-items:center;gap:.5rem">' +
        '<span>🔌</span>' +
        '<h4 style="margin:0;font-size:.9rem;font-weight:700">Cable Schedule</h4>' +
        '<span style="font-size:.75rem;color:var(--txt2)">(' + totalCables + ' cables total)</span>' +
      '</div>' +
      '<span id="cabling-chevron" style="color:var(--txt2);font-size:.75rem;transition:transform .2s">&#9650;</span>' +
    '</div>' +
    '<div id="cabling-table-wrap">' +
      '<table class="bom-table">' +
        '<thead><tr>' +
          '<th>Connection</th>' +
          '<th style="text-align:center">Speed</th>' +
          '<th style="text-align:center">Cable Type</th>' +
          '<th style="text-align:center">Est. Length</th>' +
          '<th>Reference Part #</th>' +
          '<th style="text-align:center">Total Qty</th>' +
        '</tr></thead>' +
        '<tbody>' + tableRows + '</tbody>' +
      '</table>' +
      '<div class="cabling-legend">' +
        'DAC = Direct Attach Copper (≤3 m) · ' +
        'AOC = Active Optical Cable (≤100 m) · ' +
        'LC-LC SMF = Single-Mode Fiber (>100 m) · ' +
        'Part # are generic references — verify against vendor selection' +
      '</div>' +
    '</div>';

  /* cache rows for CSV export */
  window._cablingRows = rows;
}

/* ── Toggle expand / collapse ───────────────────────────────────── */
function toggleCablingSection() {
  var wrap    = document.getElementById('cabling-table-wrap');
  var chevron = document.getElementById('cabling-chevron');
  if (!wrap) return;
  var collapsed = wrap.style.display === 'none';
  wrap.style.display   = collapsed ? '' : 'none';
  if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(180deg)';
}

/* ── CSV lines appended by exportBOM() ─────────────────────────── */
function getCablingCSVSection() {
  var rows = window._cablingRows || [];
  if (!rows.length) return '';

  var lines = [
    '',
    '"--- CABLE SCHEDULE ---"',
    '"Connection","Speed","Cable Type","Length (m)","Reference Part #","Device A","Port A","Device B","Port B"',
  ];

  rows.forEach(function(r) {
    r.details.forEach(function(d) {
      lines.push(
        '"' + r.fromLabel + ' ↔ ' + r.toLabel + '",' +
        '"' + r.speed     + '",' +
        '"' + r.cableType + '",' +
        r.lengthM         + ',' +
        '"' + r.partNum   + '",' +
        '"' + d.deviceA   + '",' +
        '"' + d.portA     + '",' +
        '"' + d.deviceB   + '",' +
        '"' + d.portB     + '"'
      );
    });
  });

  return '\n' + lines.join('\n');
}

window.generateCablingMatrix = generateCablingMatrix;
window.updateCablingMatrix   = updateCablingMatrix;
window.toggleCablingSection  = toggleCablingSection;
window.getCablingCSVSection  = getCablingCSVSection;
