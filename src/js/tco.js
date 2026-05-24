'use strict';

// ─── G-06: Software licensing + 3-year TCO ───────────────────────────────────
// Computes hardware CapEx, annual SW license + support costs, power costs,
// and summarises a 3-year Total Cost of Ownership breakdown per device + total.

// Annual rate multipliers (% of hardware list price)
var TCO_LICENSE_RATES = {
  'Cisco':     { swLicPct: 0.12, supportPct: 0.08, notes: 'Cisco DNA Advantage + Smart Net' },
  'Arista':    { swLicPct: 0.08, supportPct: 0.09, notes: 'EOS+ / AVD license + hardware support' },
  'Juniper':   { swLicPct: 0.10, supportPct: 0.08, notes: 'Junos SW sub + Juniper Care' },
  'NVIDIA':    { swLicPct: 0.06, supportPct: 0.08, notes: 'Spectrum-X / Enterprise support' },
  'Fortinet':  { swLicPct: 0.22, supportPct: 0.05, notes: 'FortiGuard + FortiCare bundles' },
  'Palo Alto': { swLicPct: 0.25, supportPct: 0.05, notes: 'Threat prevention + WildFire subs' },
  'HPE':       { swLicPct: 0.07, supportPct: 0.08, notes: 'Aruba CX Unlimited support' },
  'Dell':      { swLicPct: 0.07, supportPct: 0.08, notes: 'Dell EMC hardware support' },
  'Extreme':   { swLicPct: 0.08, supportPct: 0.08, notes: 'Extreme Elements + support' }
};

var TCO_DEFAULT_RATE = { swLicPct: 0.10, supportPct: 0.08, notes: 'Estimated SW license + support' };

// Power assumptions
var POWER_RATE_USD_PER_KWH = 0.10;   // US average data centre rate
var HOURS_PER_YEAR         = 8760;
var TCO_YEARS              = 3;

function _licenseRate(vendor) {
  return TCO_LICENSE_RATES[vendor] || TCO_DEFAULT_RATE;
}

function _deviceTCO(dev) {
  var hw      = dev.priceUSD || 0;
  var powerW  = dev.powerW  || 0;
  var rates   = _licenseRate(dev.vendor || '');

  var swLicYr     = Math.round(hw * rates.swLicPct);
  var supportYr   = Math.round(hw * rates.supportPct);
  var powerYr     = Math.round(powerW * HOURS_PER_YEAR / 1000 * POWER_RATE_USD_PER_KWH);

  return {
    hostname:     dev.hostname || dev.id,
    model:        dev.model,
    vendor:       dev.vendor || '—',
    subLayer:     dev.subLayer,
    rack:         dev.rack || '—',
    hwCapex:      hw,
    swLicYr:      swLicYr,
    supportYr:    supportYr,
    powerYr:      powerYr,
    annualOpex:   swLicYr + supportYr + powerYr,
    tco3yr:       hw + (swLicYr + supportYr + powerYr) * TCO_YEARS,
    licenseNotes: rates.notes
  };
}

/**
 * Calculate full TCO for all devices + cabling + optics.
 * Returns { devices: [...], summary, totals }.
 */
window.calcTCO = function(state) {
  var devices  = state.devices  || [];
  var cabling  = state.cabling  || [];
  var optics   = state.optics   || [];

  var deviceRows = devices
    .filter(function(d) { return (d.priceUSD || 0) > 0; })
    .map(_deviceTCO);

  var totalHw      = deviceRows.reduce(function(s, r) { return s + r.hwCapex;    }, 0);
  var totalSwLicYr = deviceRows.reduce(function(s, r) { return s + r.swLicYr;    }, 0);
  var totalSupYr   = deviceRows.reduce(function(s, r) { return s + r.supportYr;  }, 0);
  var totalPwrYr   = deviceRows.reduce(function(s, r) { return s + r.powerYr;    }, 0);
  var totalOpex    = deviceRows.reduce(function(s, r) { return s + r.annualOpex; }, 0);

  var cablingCost  = cabling.reduce(function(s, r) { return s + (r.totalCostUSD || 0); }, 0);
  var opticsCost   = optics.reduce(function(s, r) { return s + (r.totalCostUSD  || 0); }, 0);

  var infraCapex   = cablingCost + opticsCost;
  var totalCapex   = totalHw + infraCapex;
  var tco3yr       = totalCapex + totalOpex * TCO_YEARS;

  return {
    devices:      deviceRows,
    years:        TCO_YEARS,
    powerRate:    POWER_RATE_USD_PER_KWH,
    totals: {
      hwCapex:    totalHw,
      cablingCapex: cablingCost,
      opticsCapex:  opticsCost,
      infraCapex:   infraCapex,
      totalCapex:   totalCapex,
      swLicYr:      totalSwLicYr,
      supportYr:    totalSupYr,
      powerYr:      totalPwrYr,
      totalOpexYr:  totalOpex,
      tco3yr:       tco3yr
    }
  };
};

// ─── TCO report renderer ──────────────────────────────────────────────────────

function _fmt(n) { return '$' + Math.round(n).toLocaleString(); }

window.renderTCOReport = function(state) {
  var t = window.calcTCO(state);
  if (!t.devices.length) {
    return '<p class="empty-state">Generate BOM first.</p>';
  }

  var tot = t.totals;

  // ── Summary cards ─────────────────────────────────────────────────────────
  function card(label, value, sub, color) {
    return '<div style="flex:1;min-width:140px;background:var(--surface2);border:1px solid var(--border);'
      + 'border-radius:var(--radius);padding:14px 16px;">'
      + '<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;">' + label + '</div>'
      + '<div style="font-size:22px;font-weight:700;color:' + (color||'var(--text)') + ';margin:4px 0 2px;">' + value + '</div>'
      + (sub ? '<div style="font-size:11px;color:var(--text-dim);">' + sub + '</div>' : '')
      + '</div>';
  }

  var cards = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;">'
    + card('Hardware CapEx',  _fmt(tot.hwCapex),     'Network switches only',            '#3b82f6')
    + card('Infra CapEx',     _fmt(tot.infraCapex),  'Cabling + optics',                 '#6366f1')
    + card('Total CapEx',     _fmt(tot.totalCapex),  'Year 0 spend',                     '#8b5cf6')
    + card('Annual OpEx',     _fmt(tot.totalOpexYr), 'SW license + support + power/yr',  '#f97316')
    + card('3-Year TCO',      _fmt(tot.tco3yr),      'CapEx + 3 × annual OpEx',          '#22c55e')
    + '</div>';

  // ── OpEx breakdown bar ────────────────────────────────────────────────────
  var opexTotal = tot.totalOpexYr || 1;
  function barPct(n) { return Math.round(n / opexTotal * 100); }
  var opexBar = '<div style="margin-bottom:16px;">'
    + '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text);">Annual OpEx breakdown</div>'
    + '<div style="display:flex;border-radius:4px;overflow:hidden;height:18px;font-size:11px;">'
    + '<div style="flex:' + barPct(tot.swLicYr)  + ';background:#3b82f6;" title="SW License ' + barPct(tot.swLicYr)  + '%"></div>'
    + '<div style="flex:' + barPct(tot.supportYr) + ';background:#8b5cf6;" title="Support '   + barPct(tot.supportYr) + '%"></div>'
    + '<div style="flex:' + barPct(tot.powerYr)  + ';background:#22c55e;" title="Power '     + barPct(tot.powerYr)  + '%"></div>'
    + '</div>'
    + '<div style="display:flex;gap:14px;margin-top:4px;font-size:11px;color:var(--text-dim);">'
    + '<span><span style="color:#3b82f6;">■</span> SW License ' + _fmt(tot.swLicYr) + '/yr</span>'
    + '<span><span style="color:#8b5cf6;">■</span> Support ' + _fmt(tot.supportYr) + '/yr</span>'
    + '<span><span style="color:#22c55e;">■</span> Power ' + _fmt(tot.powerYr) + '/yr (@ $' + t.powerRate + '/kWh)</span>'
    + '</div></div>';

  // ── Per-device table ──────────────────────────────────────────────────────
  var rows = t.devices.map(function(r) {
    return '<tr>'
      + '<td><strong>' + r.hostname + '</strong></td>'
      + '<td>' + r.model + '</td>'
      + '<td>' + r.subLayer + '</td>'
      + '<td>' + _fmt(r.hwCapex) + '</td>'
      + '<td>' + _fmt(r.swLicYr) + '/yr</td>'
      + '<td>' + _fmt(r.supportYr) + '/yr</td>'
      + '<td>' + _fmt(r.powerYr) + '/yr</td>'
      + '<td style="font-weight:600;color:#22c55e;">' + _fmt(r.tco3yr) + '</td>'
      + '</tr>';
  }).join('');

  var table = '<div style="overflow-x:auto;margin-top:4px;">'
    + '<table class="bom-table diff-table" style="min-width:680px;">'
    + '<thead><tr>'
    + '<th>Hostname</th><th>Model</th><th>Role</th>'
    + '<th>HW CapEx</th><th>SW License</th><th>Support</th><th>Power</th>'
    + '<th>3-yr TCO</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '<tfoot><tr>'
    + '<td colspan="3"><strong>Total</strong></td>'
    + '<td><strong>' + _fmt(tot.hwCapex)   + '</strong></td>'
    + '<td><strong>' + _fmt(tot.swLicYr)  + '/yr</strong></td>'
    + '<td><strong>' + _fmt(tot.supportYr) + '/yr</strong></td>'
    + '<td><strong>' + _fmt(tot.powerYr)  + '/yr</strong></td>'
    + '<td><strong>' + _fmt(tot.tco3yr)   + '</strong></td>'
    + '</tr></tfoot>'
    + '</table></div>';

  // ── Assumptions note ──────────────────────────────────────────────────────
  var notes = '<div style="margin-top:12px;font-size:12px;color:var(--text-dim);line-height:1.8;">'
    + '<strong>Assumptions:</strong> SW license = % of HW list price per vendor '
    + '(Cisco 12%, Arista 8%, Juniper 10%, Fortinet 22%). '
    + 'Support = % of HW list price (Cisco 8%, Arista 9%, Juniper 8%). '
    + 'Power @ $' + t.powerRate + '/kWh × 8760 h/yr. '
    + 'Infra CapEx (' + _fmt(tot.infraCapex) + ') = cabling + optics, included in CapEx row only. '
    + 'All prices are list price estimates — apply actual contract discounts.'
    + '</div>';

  return cards + opexBar + table + notes;
};

// ─── TCO CSV export ───────────────────────────────────────────────────────────

window.exportTCOCSV = function(state) {
  var t    = window.calcTCO(state);
  var tot  = t.totals;
  var header = 'Hostname,Model,Vendor,Role,Rack,HW CapEx,SW License/yr,Support/yr,Power/yr,Annual OpEx,3yr TCO';
  var rows = t.devices.map(function(r) {
    return [r.hostname, r.model, r.vendor, r.subLayer, r.rack,
            r.hwCapex, r.swLicYr, r.supportYr, r.powerYr, r.annualOpex, r.tco3yr].join(',');
  });
  var footer = [
    '\n# Totals',
    'Hardware CapEx,' + tot.hwCapex,
    'Infra CapEx (cabling+optics),' + tot.infraCapex,
    'Total CapEx,' + tot.totalCapex,
    'SW License/yr,' + tot.swLicYr,
    'Support/yr,' + tot.supportYr,
    'Power/yr,' + tot.powerYr,
    'Total Annual OpEx,' + tot.totalOpexYr,
    '3-Year TCO,' + tot.tco3yr
  ].join('\n');
  return [header].concat(rows).join('\n') + footer;
};
