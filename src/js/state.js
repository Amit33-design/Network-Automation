'use strict';

var STATE = {
  useCase: '',          // campus | dc | gpu | wan | multisite | multicloud | aviatrix
  appTypes: [],         // voice | video | storage | hpc | internet
  siteName: '',
  siteCode: '',         // e.g. IAD, SJC
  scale: 'small',       // small | medium | large
  redundancy: 'ha',     // none | basic | ha | full
  topology: {
    endpoint_count:  500,   // total server/endpoint count
    bandwidth_gbps:   25,   // per-server bandwidth (1|10|25|100|400)
    oversubscription:  3    // uplink oversubscription ratio N:1
  },
  bgp_timers: 'dc_aggressive', // dc_aggressive | wan_standard | conservative (§10)
  bfd: { interval: 300, min_rx: 300, multiplier: 3 },
  ecmp: { max_paths: 8, hash_algorithm: 'default' },
  vendors: [],          // cisco | arista | juniper | nvidia | fortinet | hpe | dell | extreme
  protocols: {
    underlay: 'bgp',    // bgp | ospf | is-is | eigrp | static
    overlay:  [],       // vxlan_evpn | mpls_sr | gre | ipsec | geneve | otv | none
    features: []        // flowspec | bfd | ecmp | vrf | ipv6 | multicast | qos
  },
  gpu: {
    transport: 'none'   // rocev2 | ib | none
  },
  org: {
    sites: 1
  },
  evpn: {
    rd:           'auto',          // 'auto' | 'manual' (<lo0>:<vni>)
    rt:           'auto',          // 'auto' | 'manual'
    rt_base:      '',              // base community when rt=manual, e.g. '65000:10000'
    rt_types:     ['rt2', 'rt3'], // rt2 (MAC/IP) | rt3 (IMET/BUM) | rt5 (IP prefix)
    esi:          false,           // ESI multi-homing
    esi_type:     'type1',         // 'type0' (static) | 'type1' (LACP)
    arp_suppress: true,
    advertise_pip: true
  },
  stp: {
    mode:       'mstp',    // 'mstp' | 'rpvst' | 'pvst'
    bpdu_guard: true,      // enable BPDU guard on edge/portfast ports
    portfast:   true,      // enable PortFast on server-facing ports
    mst_vlan:   '1-4094'   // VLAN range for MST instance 1
  },
  qos: {
    classes: ['voice','video','critical','high','medium','low','scavenger','default'],
    dscp_map: {
      voice:     'ef',   // DSCP 46
      video:     'af41', // DSCP 34
      critical:  'af31', // DSCP 26
      high:      'af21', // DSCP 18
      medium:    'af11', // DSCP 10
      low:       'cs3',  // DSCP 24
      scavenger: 'cs1',  // DSCP 8
      'default': 'default' // DSCP 0
    }
  },
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
  STATE.redundancy  = 'ha';
  STATE.topology    = { endpoint_count: 500, bandwidth_gbps: 25, oversubscription: 3 };
  STATE.bgp_timers  = 'dc_aggressive';
  STATE.bfd         = { interval: 300, min_rx: 300, multiplier: 3 };
  STATE.ecmp        = { max_paths: 8, hash_algorithm: 'default' };
  STATE.vendors = [];
  STATE.protocols = { underlay: 'bgp', overlay: [], features: [] };
  STATE.gpu  = { transport: 'none' };
  STATE.org  = { sites: 1 };
  STATE.evpn = { rd: 'auto', rt: 'auto', rt_base: '', rt_types: ['rt2','rt3'], esi: false, esi_type: 'type1', arp_suppress: true, advertise_pip: true };
  STATE.stp  = { mode: 'mstp', bpdu_guard: true, portfast: true, mst_vlan: '1-4094' };
  STATE.qos  = { classes: ['voice','video','critical','high','medium','low','scavenger','default'], dscp_map: { voice:'ef', video:'af41', critical:'af31', high:'af21', medium:'af11', low:'cs3', scavenger:'cs1', 'default':'default' } };
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
