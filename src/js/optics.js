'use strict';

/* ════════════════════════════════════════════════════════════════
   OPTICS CATALOG — SFP/QSFP transceiver SKUs
   Used by BOM to recommend optics per layer based on link speed
   and estimated distance.

   Fields:
     id              — unique key
     model           — part description
     vendor          — Cisco OEM | Finisar | Lumentum | Innolight
     formFactor      — SFP | SFP+ | SFP28 | QSFP28 | QSFP-DD | OSFP
     speedG          — numeric Gbps (1,10,25,40,100,400)
     reach_m         — max reach in metres
     wavelength      — e.g. '850nm', '1310nm'
     cableType       — 'MMF' | 'SMF' | 'DAC' | 'AOC'
     connectorType   — 'LC' | 'MPO' | 'CS' | 'SN' | 'N/A'
     estimatedCostUSD — per unit, generic/white-label street price
     compatibleSpeeds — array of upSpeed values in products.js
     notes           — short design note
════════════════════════════════════════════════════════════════ */

var OPTICS = {

  /* ── 1G ─────────────────────────────────────────────────────── */
  'sfp-1g-sx': {
    id:'sfp-1g-sx', model:'SFP-GE-SX / SFP-1G-SX', vendor:'Generic/Finisar',
    formFactor:'SFP', speedG:1, reach_m:550, wavelength:'850nm',
    cableType:'MMF', connectorType:'LC', estimatedCostUSD:18,
    compatibleSpeeds:['1G'],
    notes:'Short-reach 1G for patch panel / IDF uplinks over OM3/OM4.'
  },
  'sfp-1g-lx': {
    id:'sfp-1g-lx', model:'SFP-GE-LX / SFP-1G-LR', vendor:'Generic/Lumentum',
    formFactor:'SFP', speedG:1, reach_m:10000, wavelength:'1310nm',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:25,
    compatibleSpeeds:['1G'],
    notes:'Long-reach 1G for campus MDF-to-IDF runs over single-mode.'
  },

  /* ── 10G ────────────────────────────────────────────────────── */
  'sfp-10g-sr': {
    id:'sfp-10g-sr', model:'SFP-10G-SR', vendor:'Cisco OEM / Finisar',
    formFactor:'SFP+', speedG:10, reach_m:400, wavelength:'850nm',
    cableType:'MMF', connectorType:'LC', estimatedCostUSD:35,
    compatibleSpeeds:['10G'],
    notes:'Standard 10G short-reach for intra-rack and cross-row runs up to 400m on OM4.'
  },
  'sfp-10g-lr': {
    id:'sfp-10g-lr', model:'SFP-10G-LR', vendor:'Cisco OEM / Finisar',
    formFactor:'SFP+', speedG:10, reach_m:10000, wavelength:'1310nm',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:55,
    compatibleSpeeds:['10G'],
    notes:'10G LR for inter-building links and WAN handoff up to 10km.'
  },
  'sfp-10g-er': {
    id:'sfp-10g-er', model:'SFP-10G-ER', vendor:'Finisar / Lumentum',
    formFactor:'SFP+', speedG:10, reach_m:40000, wavelength:'1550nm',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:120,
    compatibleSpeeds:['10G'],
    notes:'10G extended-reach for metro links up to 40km on SMF.'
  },

  /* ── 25G ────────────────────────────────────────────────────── */
  'sfp28-25g-sr': {
    id:'sfp28-25g-sr', model:'SFP-25G-SR / SFP28-25G-SR', vendor:'Cisco OEM / Innolight',
    formFactor:'SFP28', speedG:25, reach_m:100, wavelength:'850nm',
    cableType:'MMF', connectorType:'LC', estimatedCostUSD:65,
    compatibleSpeeds:['25G'],
    notes:'25G short-reach for ToR→leaf and server NIC uplinks. OM4 preferred.'
  },
  'sfp28-25g-lr': {
    id:'sfp28-25g-lr', model:'SFP-25G-LR', vendor:'Cisco OEM / Finisar',
    formFactor:'SFP28', speedG:25, reach_m:10000, wavelength:'1310nm',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:120,
    compatibleSpeeds:['25G'],
    notes:'25G LR for data-center inter-row and campus backbone over SMF.'
  },

  /* ── 40G ────────────────────────────────────────────────────── */
  'qsfp-40g-sr4': {
    id:'qsfp-40g-sr4', model:'QSFP-40G-SR4', vendor:'Cisco OEM / Finisar',
    formFactor:'QSFP28', speedG:40, reach_m:150, wavelength:'850nm',
    cableType:'MMF', connectorType:'MPO-12', estimatedCostUSD:90,
    compatibleSpeeds:['40G'],
    notes:'40G breakout-capable (4×10G). Good for older spine uplinks.'
  },

  /* ── 100G ───────────────────────────────────────────────────── */
  'qsfp28-100g-sr4': {
    id:'qsfp28-100g-sr4', model:'QSFP-100G-SR4', vendor:'Cisco OEM / Finisar',
    formFactor:'QSFP28', speedG:100, reach_m:100, wavelength:'850nm',
    cableType:'MMF', connectorType:'MPO-12', estimatedCostUSD:180,
    compatibleSpeeds:['100G'],
    notes:'100G short-reach. MPO-12 to LC breakout cables supported. Best for leaf-spine.'
  },
  'qsfp28-100g-lr4': {
    id:'qsfp28-100g-lr4', model:'QSFP-100G-LR4', vendor:'Cisco OEM / Lumentum',
    formFactor:'QSFP28', speedG:100, reach_m:10000, wavelength:'1310nm (4λ CWDM)',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:350,
    compatibleSpeeds:['100G'],
    notes:'100G LR4 for inter-DC and campus backbone. 4-lane CWDM LC duplex.'
  },
  'qsfp28-100g-dr': {
    id:'qsfp28-100g-dr', model:'QSFP-100G-DR / QSFP-100G-FR', vendor:'Innolight / Lumentum',
    formFactor:'QSFP28', speedG:100, reach_m:500, wavelength:'1310nm (PAM4)',
    cableType:'SMF', connectorType:'MPO-12 / LC', estimatedCostUSD:220,
    compatibleSpeeds:['100G'],
    notes:'100G PAM4 DR for DCI up to 500m. More cost-effective than LR4 for in-campus links.'
  },
  'qsfp28-100g-er4': {
    id:'qsfp28-100g-er4', model:'QSFP-100G-ER4-Lite', vendor:'Finisar / II-VI',
    formFactor:'QSFP28', speedG:100, reach_m:40000, wavelength:'1310nm (4λ LAN-WDM)',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:950,
    compatibleSpeeds:['100G'],
    notes:'100G extended reach for metro DCI and WAN handoff up to 40km.'
  },

  /* ── 400G ───────────────────────────────────────────────────── */
  'qsfpdd-400g-dr4': {
    id:'qsfpdd-400g-dr4', model:'QSFP-DD-400G-DR4', vendor:'Cisco OEM / Innolight',
    formFactor:'QSFP-DD', speedG:400, reach_m:500, wavelength:'1310nm PAM4 (4λ)',
    cableType:'SMF', connectorType:'MPO-12', estimatedCostUSD:650,
    compatibleSpeeds:['400G'],
    notes:'400G DR4 for hyperscale spine-to-spine and DCI up to 500m. Breakout to 4×100G.'
  },
  'qsfpdd-400g-fr4': {
    id:'qsfpdd-400g-fr4', model:'QSFP-DD-400G-FR4', vendor:'Lumentum / II-VI',
    formFactor:'QSFP-DD', speedG:400, reach_m:2000, wavelength:'1310nm CWDM4 PAM4',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:900,
    compatibleSpeeds:['400G'],
    notes:'400G FR4 for 2km DCI over duplex SMF. Good balance of cost and reach.'
  },
  'qsfpdd-400g-lr4': {
    id:'qsfpdd-400g-lr4', model:'QSFP-DD-400G-LR4', vendor:'Finisar / Innolight',
    formFactor:'QSFP-DD', speedG:400, reach_m:10000, wavelength:'1310nm LAN-WDM PAM4',
    cableType:'SMF', connectorType:'LC', estimatedCostUSD:1400,
    compatibleSpeeds:['400G'],
    notes:'400G LR4 for 10km inter-campus and carrier-handoff applications.'
  },
  'osfp-400g-sr8': {
    id:'osfp-400g-sr8', model:'OSFP-400G-SR8', vendor:'Innolight / Lumentum',
    formFactor:'OSFP', speedG:400, reach_m:100, wavelength:'850nm',
    cableType:'MMF', connectorType:'MPO-16', estimatedCostUSD:480,
    compatibleSpeeds:['400G'],
    notes:'400G short-reach for GPU cluster leaf-to-spine on OM5 MPO-16. Lowest latency.'
  },

};

/* ── Speed normaliser ─────────────────────────────────────────── */
/* Map product upSpeed strings → numeric Gbps */
var _SPEED_NORM = {
  '1G':10, '1/10G':10, '10G':10, '10/25G':25, '25G':25,
  '40G':40, '40/100G':100, '100G':100, '100/400G':400, '400G':400,
};

function _normaliseSpeed(upSpeed) {
  if (!upSpeed) return 10;
  for (var k in _SPEED_NORM) {
    if (upSpeed.indexOf(k) !== -1) return _SPEED_NORM[k];
  }
  var m = upSpeed.match(/(\d+)G/);
  return m ? parseInt(m[1]) : 10;
}

/* ── Recommend optics for a layer ────────────────────────────── */
/*
  getOpticsForLayer(layer, prod, state)
  Returns { transceiver, qty, subtotal, notes }

  Distance heuristic:
    mc-dc-edge / wan / inter-site → SMF long-reach
    dc-spine / gpu-spine          → short-reach (<=100m)
    everything else               → short-reach (<=100m)
*/
function getOpticsForLayer(layer, prod, qty, state) {
  if (!prod) return null;
  var speedG   = _normaliseSpeed(prod.upSpeed);
  var longReach = (layer === 'mc-dc-edge' || (state && state.uc === 'wan'));
  var gpuCluster = (layer === 'gpu-spine' || layer === 'gpu-tor');

  /* Pick best matching optic */
  var candidates = Object.values(OPTICS).filter(function(o) {
    return o.speedG === speedG;
  });
  if (!candidates.length) {
    /* fallback: nearest speed */
    var speeds = [1,10,25,40,100,400];
    var nearest = speeds.reduce(function(a,b) {
      return Math.abs(b - speedG) < Math.abs(a - speedG) ? b : a;
    });
    candidates = Object.values(OPTICS).filter(function(o) { return o.speedG === nearest; });
  }

  var chosen;
  if (gpuCluster) {
    /* GPU: prefer MMF SR (lowest latency) */
    chosen = candidates.filter(function(o) { return o.cableType === 'MMF'; })[0] ||
             candidates[0];
  } else if (longReach) {
    /* WAN/edge: prefer SMF LR */
    chosen = candidates.filter(function(o) {
      return o.cableType === 'SMF' && o.reach_m >= 5000;
    })[0] || candidates.filter(function(o) { return o.cableType === 'SMF'; })[0] ||
    candidates[0];
  } else {
    /* Default: cheapest short-reach */
    chosen = candidates.slice().sort(function(a,b) {
      return a.estimatedCostUSD - b.estimatedCostUSD;
    })[0];
  }
  if (!chosen) return null;

  /* qty = uplink ports × device count */
  var uplinkMatch = (prod.uplinks || '').match(/(\d+)x/);
  var uplinkCount = uplinkMatch ? parseInt(uplinkMatch[1]) : 2;
  var totalQty = qty * uplinkCount;

  return {
    optic:    chosen,
    uplinkPorts: uplinkCount,
    deviceQty:   qty,
    qty:      totalQty,
    subtotal: totalQty * chosen.estimatedCostUSD,
  };
}

/* ── BOM optics section renderer ─────────────────────────────── */
function renderOpticsSection(layers, state) {
  var sec = document.getElementById('optics-section');
  if (!sec) return;

  var rows = '';
  var grandTotal = 0;

  layers.forEach(function(layer) {
    var selId = STATE.selectedProducts[layer.key];
    var prod  = PRODUCTS[selId];
    if (!prod) return;
    var qty   = typeof estimateCounts === 'function' ? estimateCounts(layer.key) : 1;
    var rec   = getOpticsForLayer(layer.key, prod, qty, state || STATE);
    if (!rec) return;
    grandTotal += rec.subtotal;
    rows += '<tr>' +
      '<td><span class="layer-tag">' + layer.label + '</span></td>' +
      '<td>' + rec.optic.vendor + '</td>' +
      '<td><strong>' + rec.optic.model + '</strong></td>' +
      '<td>' + rec.optic.formFactor + '</td>' +
      '<td>' + rec.optic.speedG + 'G</td>' +
      '<td>' + rec.optic.reach_m.toLocaleString() + ' m</td>' +
      '<td>' + rec.optic.cableType + '</td>' +
      '<td class="qty">' + rec.qty + '</td>' +
      '<td>$' + rec.optic.estimatedCostUSD.toLocaleString() + '</td>' +
      '<td><strong>$' + rec.subtotal.toLocaleString() + '</strong></td>' +
      '</tr>';
  });

  if (!rows) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';

  var tbody = document.getElementById('optics-tbody');
  if (tbody) tbody.innerHTML = rows;

  var totalEl = document.getElementById('optics-grand-total');
  if (totalEl) totalEl.textContent = '$' + grandTotal.toLocaleString();
}

/* ── CSV export helper (called by exportBOM) ─────────────────── */
function getOpticsCSVSection(layers, state) {
  var lines = ['\n--- Optics Recommendations ---'];
  lines.push('Layer,Vendor,Model,Form Factor,Speed,Reach (m),Cable,Qty,Unit Price,Extended Cost');
  var total = 0;
  layers.forEach(function(layer) {
    var selId = STATE.selectedProducts[layer.key];
    var prod  = PRODUCTS[selId];
    if (!prod) return;
    var qty = typeof estimateCounts === 'function' ? estimateCounts(layer.key) : 1;
    var rec = getOpticsForLayer(layer.key, prod, qty, state || STATE);
    if (!rec) return;
    total += rec.subtotal;
    lines.push(
      '"' + layer.label + '",' +
      '"' + rec.optic.vendor + '",' +
      '"' + rec.optic.model + '",' +
      rec.optic.formFactor + ',' +
      rec.optic.speedG + 'G,' +
      rec.optic.reach_m + ',' +
      rec.optic.cableType + ',' +
      rec.qty + ',' +
      '$' + rec.optic.estimatedCostUSD + ',' +
      '$' + rec.subtotal
    );
  });
  lines.push(',,,,,,,,Total,$' + total);
  return lines.join('\n');
}

window.OPTICS              = OPTICS;
window.getOpticsForLayer   = getOpticsForLayer;
window.renderOpticsSection = renderOpticsSection;
window.getOpticsCSVSection = getOpticsCSVSection;
