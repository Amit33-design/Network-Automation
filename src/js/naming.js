'use strict';

/*
  naming.js — Systematic hostname generator
  Pattern: {SITE}-{ROLE}-{RACK}-{IDX:02d}
  e.g.  NYC-LEAF-A01-01, HQ-CORE-A01-01, IAD-TOR-A02-01

  Skips multicloud layers (no _ROLE_MAP entry) and multisite
  devices so their site-prefix names are preserved.
*/

var _ROLE_MAP = {
  'fw':            'FW',
  'campus-core':   'CORE',
  'campus-dist':   'DIST',
  'campus-access': 'ACC',
  'dc-spine':      'SPINE',
  'dc-leaf':       'LEAF',
  'gpu-spine':     'GSPINE',
  'gpu-tor':       'TOR',
  'mc-dc-edge':    'EDGE',
};

/* Derive a ≤4-char site code from orgName */
function _siteCode(state) {
  var org = (state && state.orgName) ? state.orgName.trim() : '';
  if (!org) return 'SITE';
  var words = org.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 4).map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 4);
  }
  return org.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'SITE';
}

/* Rack identifier — leaf/dist pair in same rack, everything else A01 */
function _rackId(layer, idx) {
  if (layer === 'dc-leaf' || layer === 'gpu-tor' || layer === 'campus-dist') {
    return 'A' + String(Math.floor(idx / 2) + 1).padStart(2, '0');
  }
  return 'A01';
}

/*
  generateHostnames(devices, state)
  Mutates each device's .name field in-place.
  Returns the same array for chaining.
*/
function generateHostnames(devices, state) {
  var site = _siteCode(state);
  var counters = {};
  devices.forEach(function(dev) {
    var role = _ROLE_MAP[dev.layer];
    if (!role) return;          // skip multicloud / unknown layers
    counters[dev.layer] = counters[dev.layer] || 0;
    var idx  = counters[dev.layer];
    var rack = _rackId(dev.layer, idx);
    dev.name = site + '-' + role + '-' + rack + '-' + String(idx + 1).padStart(2, '0');
    counters[dev.layer]++;
  });
  return devices;
}

window.generateHostnames = generateHostnames;
window._siteCode         = _siteCode;
