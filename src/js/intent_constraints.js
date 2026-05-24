'use strict';

// Constraint rules from CLAUDE.md Section 5 — exact copy, no changes
var CONSTRAINTS = [
  {
    id: 'R-01', severity: 'error',
    check: function(i) {
      return i.protocols.underlay === 'eigrp' && i.protocols.overlay.indexOf('vxlan_evpn') !== -1;
    },
    msg: 'EIGRP cannot underlay VXLAN/EVPN — EVPN requires BGP as control plane.',
    fix: 'Change underlay to BGP.',
    fields: ['fs-protocols']
  },
  {
    id: 'R-02', severity: 'error',
    check: function(i) {
      return i.protocols.overlay.indexOf('geneve') !== -1 && i.vendors.indexOf('cisco') !== -1;
    },
    msg: 'GENEVE is not supported on Cisco IOS-XE or NX-OS in hardware.',
    fix: 'Use VXLAN, or switch to Linux-based SONiC.',
    fields: ['fs-vendors', 'fs-protocols']
  },
  {
    id: 'R-03', severity: 'error',
    check: function(i) {
      return i.protocols.features.indexOf('flowspec') !== -1 && i.protocols.underlay !== 'bgp';
    },
    msg: 'FlowSpec (BGP-FS) requires BGP as underlay.',
    fix: 'Change underlay to BGP.',
    fields: ['fs-protocols']
  },
  {
    id: 'R-04', severity: 'error',
    check: function(i) {
      return i.topology.redundancy === 'full' && i.protocols.underlay === 'static';
    },
    msg: 'Static routing cannot provide full redundancy (no SPOF protection).',
    fix: 'Use BGP or OSPF with BFD.',
    fields: ['fs-architecture', 'fs-protocols']
  },
  {
    id: 'R-05', severity: 'warning',
    check: function(i) {
      return i.use_case === 'campus' && i.protocols.underlay === 'is-is';
    },
    msg: 'IS-IS is uncommon for campus. Cisco CVD and Arista AVD both recommend OSPF.',
    fix: 'Consider OSPF for campus LAN.',
    fields: ['fs-protocols']
  },
  {
    id: 'R-06', severity: 'warning',
    check: function(i) {
      return i.gpu.transport === 'ib' && i.vendors.indexOf('nvidia') === -1;
    },
    msg: 'InfiniBand requires NVIDIA Quantum switches.',
    fix: 'Add NVIDIA to vendor preferences, or use RoCEv2 for Ethernet-based GPU fabric.',
    fields: ['fs-vendors', 'fs-gpu']
  },
  {
    id: 'R-07', severity: 'error',
    check: function(i) {
      return i.protocols.overlay.indexOf('otv') !== -1 && i.org.sites <= 1;
    },
    msg: 'OTV is a multi-site DCI technology. Meaningless for single-site designs.',
    fix: 'Use VXLAN/EVPN for L2 extension within a single site.',
    fields: ['fs-protocols', 'fs-site-identity']
  },
  {
    id: 'R-08', severity: 'warning',
    check: function(i) {
      return (i.use_case === 'dc' || i.use_case === 'gpu') && i.bgp_timers === 'conservative';
    },
    msg: 'Default BGP timers (60/180s) in a DC fabric mean 3-minute convergence on BGP failure without BFD.',
    fix: 'Use DC Aggressive preset (3/9s) + BFD.',
    fields: ['fs-protocols']
  }
];

window.CONSTRAINTS = CONSTRAINTS;

// Map STATE → intent object format and run all constraint checks.
// Returns array of triggered constraint objects (errors first, then warnings).
window.validateIntent = function(state) {
  var intent = {
    use_case: state.useCase,
    vendors:  state.vendors || [],
    topology: { redundancy: state.redundancy || 'ha' },
    protocols: {
      underlay: (state.protocols && state.protocols.underlay) || 'bgp',
      overlay:  (state.protocols && state.protocols.overlay)  || [],
      features: (state.protocols && state.protocols.features) || []
    },
    gpu:        { transport: (state.gpu && state.gpu.transport) || 'none' },
    org:        { sites:     (state.org && state.org.sites)     || 1 },
    bgp_timers: state.bgp_timers || 'dc_aggressive'
  };

  var violations = [];
  CONSTRAINTS.forEach(function(rule) {
    try { if (rule.check(intent)) violations.push(rule); } catch (e) { /* skip */ }
  });

  // Errors first, then warnings
  return violations.sort(function(a, b) {
    return (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1);
  });
};

window.clearValidationHighlights = function() {
  document.querySelectorAll('.field-error, .field-warning').forEach(function(el) {
    el.classList.remove('field-error', 'field-warning');
  });
  var banner = document.getElementById('validation-banner');
  if (banner) { banner.innerHTML = ''; banner.style.display = 'none'; }
};

window.applyValidationHighlights = function(violations) {
  window.clearValidationHighlights();
  if (!violations || !violations.length) return false;

  // Highlight affected form sections
  violations.forEach(function(rule) {
    (rule.fields || []).forEach(function(fsId) {
      var el = document.getElementById(fsId);
      if (!el) return;
      // Use the stricter severity if already marked
      if (rule.severity === 'error') {
        el.classList.remove('field-warning');
        el.classList.add('field-error');
      } else if (!el.classList.contains('field-error')) {
        el.classList.add('field-warning');
      }
    });
  });

  // Build banner HTML
  var errors   = violations.filter(function(v) { return v.severity === 'error'; });
  var warnings = violations.filter(function(v) { return v.severity === 'warning'; });
  var html     = '';

  if (errors.length) {
    html += '<div class="val-block val-block-error">' +
      '<div class="val-block-hdr">Design Errors — must fix before continuing (' + errors.length + ')</div>';
    errors.forEach(function(v) {
      html += '<div class="val-item">' +
        '<span class="val-id val-id-error">' + v.id + '</span>' +
        '<span class="val-msg">' + v.msg + '</span>' +
        '<span class="val-fix">Fix: ' + v.fix + '</span>' +
        '</div>';
    });
    html += '</div>';
  }

  if (warnings.length) {
    html += '<div class="val-block val-block-warn">' +
      '<div class="val-block-hdr">Advisories — review before proceeding (' + warnings.length + ')</div>';
    warnings.forEach(function(v) {
      html += '<div class="val-item">' +
        '<span class="val-id val-id-warn">' + v.id + '</span>' +
        '<span class="val-msg">' + v.msg + '</span>' +
        '<span class="val-fix">Advisory: ' + v.fix + '</span>' +
        '</div>';
    });
    html += '</div>';
  }

  var banner = document.getElementById('validation-banner');
  if (banner) { banner.innerHTML = html; banner.style.display = 'block'; }

  return errors.length > 0; // true = blocked
};
