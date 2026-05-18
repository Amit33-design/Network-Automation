'use strict';

var STATE = {
  useCase: '',          // campus | dc | gpu | wan | multisite | multicloud | aviatrix
  appTypes: [],         // voice | video | storage | hpc | internet
  siteName: '',
  siteCode: '',         // e.g. IAD, SJC
  scale: 'small',       // small | medium | large
  redundancy: 'dual',   // single | dual
  linkDistances: {      // layer pair -> distance in metres
    'spine-leaf': 100,
    'dist-access': 50,
    'core-dist': 200,
    'wan-edge': 5000
  },
  devices: [],          // populated by buildDeviceList()
  cabling: [],          // populated by generateCablingMatrix()
  optics: [],           // populated by recommendOptics()
  configs: {},          // keyed by device id
  ztpConfig: {},
  policies: [],
  preCheckScript: '',
  postCheckScript: '',
  prometheusAlerts: '',
  grafanaDashboard: {},
  ansiblePlaybook: {},
  compliance: [],       // QoS | PCI | HIPAA | SOC2
  step: 1
};

window.STATE = STATE;

window.resetState = function() {
  STATE.useCase = '';
  STATE.appTypes = [];
  STATE.siteName = '';
  STATE.siteCode = '';
  STATE.scale = 'small';
  STATE.redundancy = 'dual';
  STATE.linkDistances = { 'spine-leaf': 100, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000 };
  STATE.devices = [];
  STATE.cabling = [];
  STATE.optics = [];
  STATE.configs = {};
  STATE.ztpConfig = {};
  STATE.policies = [];
  STATE.preCheckScript = '';
  STATE.postCheckScript = '';
  STATE.prometheusAlerts = '';
  STATE.grafanaDashboard = {};
  STATE.ansiblePlaybook = {};
  STATE.compliance = [];
  STATE.step = 1;
};
