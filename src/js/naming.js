'use strict';

// Role shortcodes used in hostnames
var ROLE_CODE = {
  'spine':        'SPINE',
  'leaf':         'LEAF',
  'distribution': 'DIST',
  'access':       'ACC',
  'wan-edge':     'WAN',
  'firewall':     'FW',
  'cloud-gw':     'CGW',
  'cloud-transit':'CTGW',
  'core':         'CORE'
};

// Rack labels for index grouping (up to 26 racks: A-Z)
function rackLabel(idx) {
  return String.fromCharCode(65 + Math.floor(idx / 2));
}

/**
 * Generate hostnames for an array of devices.
 * Pattern: {SITE}-{ROLE}-{RACK}{IDX:02d}
 * Example: IAD-LEAF-A01, SJC-SPINE-A02
 * Mutates each device object, adding .hostname
 */
function generateHostnames(devices, state) {
  if (!devices || !devices.length) return devices;

  var site = (state && state.siteCode) ? state.siteCode.toUpperCase().slice(0, 5) : 'SITE';

  // Count per role to assign sequential indices
  var roleCounters = {};

  devices.forEach(function(dev) {
    var role = dev.subLayer || 'unknown';
    var code = ROLE_CODE[role] || role.toUpperCase().slice(0, 4);

    if (!roleCounters[code]) roleCounters[code] = 0;
    var idx = roleCounters[code];
    roleCounters[code]++;

    var rack = rackLabel(idx);
    var num = String((idx % 2) + 1).padStart(2, '0');

    dev.hostname = site + '-' + code + '-' + rack + num;
  });

  return devices;
}

window.generateHostnames = generateHostnames;
window.ROLE_CODE = ROLE_CODE;
