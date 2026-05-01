'use strict';

/* ════════════════════════════════════════════════════════════════
   PRODUCTS DATABASE
   Each product: { id, vendor, vlClass, model, series, layer,
     subLayer, ports, uplinks, speed, upSpeed, powerW, asic,
     bufferGB, latencyNs, priceRange, userScale, estimatedCostUSD,
     features[], useCases[], detail{} }
   priceRange : 'smb' | 'mid' | 'enterprise' | 'hyperscale'
   userScale  : [minUsers, maxUsers]  (per switch, not total)
   estimatedCostUSD : rough street price (USD, no license)
════════════════════════════════════════════════════════════════ */
const PRODUCTS = {

  /* ══════════════════════════════════════════════════════════════
     CAMPUS ACCESS LAYER
  ══════════════════════════════════════════════════════════════ */

  /* ── SMB / Branch Access ─────────────────────────────────── */
  'cat1300-48p': {
    id:'cat1300-48p', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 1300-48P', series:'Catalyst 1300',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 1G/SFP',
    speed:'1G', upSpeed:'1G', powerW:370, bufferGB:0.016,
    latencyNs:4000, asic:'Marvell',
    priceRange:'smb', userScale:[10,80], estimatedCostUSD:1200,
    features:['PoE+ 375W','VLAN','QoS','ACL','Web UI','CLI','Limited L3'],
    useCases:['campus','wan'],
    detail:{
      throughput:'104 Gbps', macTable:'16K', vlans:'255',
      routing:'Static + RIP', ipv6:'Yes', formFactor:'1RU fixed',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Entry-level managed switch for small offices and branches. Simple web GUI for non-expert deployment. Ideal for <80 users.'
    }
  },
  'fortiswitch-148f-poe': {
    id:'fortiswitch-148f-poe', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiSwitch 148F-POE', series:'FortiSwitch 100F',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:740, bufferGB:0.016,
    latencyNs:3200, asic:'Broadcom',
    priceRange:'smb', userScale:[20,100], estimatedCostUSD:2200,
    features:['PoE+ 740W','Security Fabric integration','FortiLink','802.1X','VLAN','FortiManager/FortiGate integration','ZTP'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'176 Gbps', macTable:'32K', vlans:'4094',
      routing:'L2 + limited L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Best choice for Fortinet-centric networks. Managed directly from FortiGate via FortiLink — single pane of glass for network + security. No separate switch management needed.'
    }
  },
  'fortiswitch-124f-poe': {
    id:'fortiswitch-124f-poe', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiSwitch 124F-POE', series:'FortiSwitch 100F',
    layer:'access', subLayer:'campus-access',
    ports:'24x 1GbE PoE+', uplinks:'4x 10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:370, bufferGB:0.008,
    latencyNs:3200, asic:'Broadcom',
    priceRange:'smb', userScale:[10,50], estimatedCostUSD:1400,
    features:['PoE+ 370W','Security Fabric','FortiLink','802.1X','FortiGate managed','ZTP','VLAN'],
    useCases:['campus','wan'],
    detail:{
      throughput:'88 Gbps', macTable:'16K', vlans:'4094',
      routing:'L2 + static', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Compact 24-port Fortinet access for small branches. Pairs with FortiGate 60/100 series. Zero-touch provisioned via FortiManager.'
    }
  },
  'aruba-2930f-24g': {
    id:'aruba-2930f-24g', vendor:'HPE Aruba', vlClass:'vl-aruba',
    model:'Aruba 2930F-24G-PoE+', series:'2930F',
    layer:'access', subLayer:'campus-access',
    ports:'24x 1GbE PoE+', uplinks:'4x 1G/10G SFP+',
    speed:'1G', upSpeed:'10G', powerW:370, bufferGB:0.012,
    latencyNs:3500, asic:'Broadcom',
    priceRange:'smb', userScale:[10,60], estimatedCostUSD:1800,
    features:['PoE+ 370W','ArubaOS-Switch','AirWave','802.1X','ClearPass-ready','VLAN','QoS','SNMPv3'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'92 Gbps', macTable:'16K', vlans:'4094',
      routing:'Static + RIP + OSPF', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Solid SMB/mid-market access switch. Strong PoE budget and ClearPass NAC integration. Good alternative when Cisco cost is a concern.'
    }
  },
  'extreme-x435-24p': {
    id:'extreme-x435-24p', vendor:'Extreme', vlClass:'vl-extreme',
    model:'ExtremeSwitching X435-24P', series:'X435',
    layer:'access', subLayer:'campus-access',
    ports:'24x 1GbE PoE+', uplinks:'4x 10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:370, bufferGB:0.016,
    latencyNs:3000, asic:'Marvell Prestera',
    priceRange:'smb', userScale:[10,60], estimatedCostUSD:1600,
    features:['PoE+ 370W','ExtremeXOS','ExtremeCloud IQ','802.1X','VLAN','Universal Port','ZTP'],
    useCases:['campus'],
    detail:{
      throughput:'88 Gbps', macTable:'32K', vlans:'4094',
      routing:'Static + OSPF', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Cloud-managed access via ExtremeCloud IQ. Universal Port profiles auto-configure ports based on connected device type. Good for education and hospitality.'
    }
  },

  /* ── Mid / Enterprise Access ─────────────────────────────── */
  'cat9300-24p': {
    id:'cat9300-24p', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9300-24P', series:'Catalyst 9300',
    layer:'access', subLayer:'campus-access',
    ports:'24x 1GbE PoE+', uplinks:'4x 1/10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:890, bufferGB:0.032,
    latencyNs:3500, asic:'UADP 2.0',
    priceRange:'mid', userScale:[50,200], estimatedCostUSD:6500,
    features:['PoE+ 740W','802.1X','MACSEC','Stacking (StackWise-320)','SD-Access','DNA Center','NETCONF/YANG'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'208 Gbps', macTable:'32K', vlans:'4094',
      routing:'Full L3 (RIP,OSPF,EIGRP,BGP)', ipv6:'Yes',
      formFactor:'1RU fixed', warranty:'Limited Lifetime',
      certifications:'FIPS 140-2, TAA',
      notes:'Best-in-class campus access. Native SD-Access fabric edge. Ideal for medium to large enterprise floors.'
    }
  },
  'cat9300-48p': {
    id:'cat9300-48p', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9300-48P', series:'Catalyst 9300',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 1/10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:1100, bufferGB:0.032,
    latencyNs:3500, asic:'UADP 2.0',
    priceRange:'mid', userScale:[100,400], estimatedCostUSD:8500,
    features:['PoE+ 740W','802.1X','MACSEC','Stacking','SD-Access','NETCONF/YANG','Trustworthy Systems'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'208 Gbps', macTable:'32K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU fixed',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2, TAA',
      notes:'High-density campus access. Dual PoE budget 740W. Ideal for open office deployments.'
    }
  },
  'aruba-cx6300m': {
    id:'aruba-cx6300m', vendor:'HPE Aruba', vlClass:'vl-aruba',
    model:'Aruba CX 6300M 48G', series:'CX 6300',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 10/25GbE SFP28',
    speed:'1G', upSpeed:'25G', powerW:1100, bufferGB:0.064,
    latencyNs:2500, asic:'Broadcom Trident3',
    priceRange:'mid', userScale:[100,400], estimatedCostUSD:7200,
    features:['PoE++ 720W','ArubaOS-CX','ClearPass NAC','VSX stacking','802.1X','Analytics','NETCONF/YANG','REST API'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'336 Gbps', macTable:'64K', vlans:'4094',
      routing:'Full L3 BGP/OSPF', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Modern CX OS with first-class REST API and analytics. VSX (Virtual Switching Extension) for HA pairs. Strong Aruba Wi-Fi integration.'
    }
  },
  'fortiswitch-248e-fpoe': {
    id:'fortiswitch-248e-fpoe', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiSwitch 248E-FPOE', series:'FortiSwitch 200E',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:1440, bufferGB:0.016,
    latencyNs:3000, asic:'Broadcom',
    priceRange:'mid', userScale:[80,300], estimatedCostUSD:3800,
    features:['PoE+ 1440W full-budget','Security Fabric','FortiLink','802.1X','FortiManager','VLAN','QoS','LLDP-MED'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'176 Gbps', macTable:'32K', vlans:'4094',
      routing:'L2 + limited L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Highest PoE budget in the FortiSwitch line — powers high-density Wi-Fi 6E APs and IP cameras simultaneously. Full FortiGate integration.'
    }
  },
  'extreme-x465-48p': {
    id:'extreme-x465-48p', vendor:'Extreme', vlClass:'vl-extreme',
    model:'ExtremeSwitching X465-48P', series:'X465',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 10/25GbE SFP28',
    speed:'1G', upSpeed:'25G', powerW:1100, bufferGB:0.032,
    latencyNs:2800, asic:'Broadcom Trident3',
    priceRange:'mid', userScale:[100,400], estimatedCostUSD:5500,
    features:['PoE+ 780W','ExtremeXOS','ExtremeCloud IQ','802.1X','SLX stacking','VXLAN access','Universal Port'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'336 Gbps', macTable:'64K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Flexible mid-market access. Runs ExtremeXOS or VOSS depending on model. Cloud-managed via ExtremeCloud IQ. Good price/performance for education and government.'
    }
  },
  'arista-720xp-48zc2': {
    id:'arista-720xp-48zc2', vendor:'Arista', vlClass:'vl-arista',
    model:'720XP-48ZC2', series:'720XP',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1/2.5GbE PoE++', uplinks:'2x 100GbE QSFP28',
    speed:'2.5G', upSpeed:'100G', powerW:2000, bufferGB:0.064,
    latencyNs:2000, asic:'Broadcom Trident3',
    priceRange:'enterprise', userScale:[200,600], estimatedCostUSD:14000,
    features:['PoE++ 90W per port','Multi-gig (mGig)','VXLAN access','EOS','CloudVision','ZTP','RESTCONF'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'510 Gbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 BGP/OSPF', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year hw', certifications:'TAA',
      notes:'Multi-gigabit access ideal for Wi-Fi 6E APs requiring 2.5G. High PoE++ budget and 100G uplinks future-proof the access layer.'
    }
  },
  'ex2300-48p': {
    id:'ex2300-48p', vendor:'Juniper', vlClass:'vl-juniper',
    model:'EX2300-48P', series:'EX2300',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1GbE PoE+', uplinks:'4x 10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:820, bufferGB:0.016,
    latencyNs:3000, asic:'Marvell Prestera',
    priceRange:'mid', userScale:[100,400], estimatedCostUSD:5800,
    features:['PoE+ 370W','802.1X','Virtual Chassis (VC)','Junos','NETCONF/YANG','ZTP','Mist AI-ready'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'176 Gbps', macTable:'16K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Compact, cost-effective campus access. Mist AI integration for cloud-managed deployments. Virtual Chassis up to 10 units.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     CAMPUS DISTRIBUTION
  ══════════════════════════════════════════════════════════════ */
  'fortiswitch-424e': {
    id:'fortiswitch-424e', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiSwitch 424E', series:'FortiSwitch 400E',
    layer:'distribution', subLayer:'campus-dist',
    ports:'24x 1/10GbE SFP+', uplinks:'4x 40GbE QSFP+',
    speed:'10G', upSpeed:'40G', powerW:550, bufferGB:0.032,
    latencyNs:2000, asic:'Broadcom Trident2',
    priceRange:'smb', userScale:[50,300], estimatedCostUSD:4500,
    features:['Security Fabric','FortiLink','BGP/OSPF','VLAN','RSTP','FortiManager','802.1Q','QoS'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'480 Gbps', macTable:'64K', vlans:'4094',
      routing:'Full L3 BGP/OSPF', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Distribution-tier FortiSwitch. Fully integrated with FortiGate for centralized policy. Ideal distribution layer for Fortinet Security Fabric deployments.'
    }
  },
  'fortiswitch-548d': {
    id:'fortiswitch-548d', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiSwitch 548D', series:'FortiSwitch 500D',
    layer:'distribution', subLayer:'campus-dist',
    ports:'48x 10GbE SFP+', uplinks:'6x 40GbE QSFP+',
    speed:'10G', upSpeed:'40G', powerW:650, bufferGB:0.064,
    latencyNs:1800, asic:'Broadcom Trident2+',
    priceRange:'mid', userScale:[200,800], estimatedCostUSD:7500,
    features:['Security Fabric','FortiLink','Full L3','BGP/OSPF/VRRP','VXLAN','FortiManager','Analytics','NETCONF'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'960 Gbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 + MPLS', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'High-density distribution for mid-to-large Fortinet campuses. Acts as FortiGate uplink aggregation and policy enforcement boundary. Supports VXLAN for segmented campus fabrics.'
    }
  },
  'aruba-cx6405': {
    id:'aruba-cx6405', vendor:'HPE Aruba', vlClass:'vl-aruba',
    model:'Aruba CX 6405 Core Switch', series:'CX 6400',
    layer:'distribution', subLayer:'campus-dist',
    ports:'Up to 48x 10/25GbE + 8x 100GbE', uplinks:'Up to 8x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:1200, bufferGB:0.256,
    latencyNs:1500, asic:'Broadcom Jericho+',
    priceRange:'enterprise', userScale:[500,5000], estimatedCostUSD:32000,
    features:['Modular 5-slot','VSX HA','BGP/OSPF/IS-IS','VXLAN/EVPN','ArubaOS-CX','Hitless failover','NETCONF/YANG','Analytics'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'9.6 Tbps', macTable:'512K', vlans:'4094',
      routing:'Full L3 + MPLS + SR', ipv6:'Yes', formFactor:'Modular 5-slot',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Modular enterprise distribution/core. VSX active-active HA. Scales from 5 to multiple chassis. Native Aruba Central integration. Competes with Cat9600 at lower cost.'
    }
  },
  'cat9500-48y4c': {
    id:'cat9500-48y4c', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9500-48Y4C', series:'Catalyst 9500',
    layer:'distribution', subLayer:'campus-dist',
    ports:'48x 25GbE SFP28', uplinks:'4x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:850, bufferGB:0.096,
    latencyNs:1800, asic:'UADP 3.0',
    priceRange:'enterprise', userScale:[500,3000], estimatedCostUSD:28000,
    features:['MACSEC-256','SD-Access border','VXLAN','BGP','ECMP','NetFlow','NETCONF/YANG','StackWise-T'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'2.88 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 + MPLS', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2',
      notes:'Flagship fixed distribution/aggregation switch. Acts as SD-Access policy plane boundary. Non-blocking at 25G density.'
    }
  },
  'arista-7280r2a': {
    id:'arista-7280r2a', vendor:'Arista', vlClass:'vl-arista',
    model:'7280R2A-30', series:'7280R2',
    layer:'distribution', subLayer:'campus-dist',
    ports:'30x 100GbE QSFP28', uplinks:'2x 400GbE QSFP-DD',
    speed:'100G', upSpeed:'400G', powerW:750, bufferGB:0.512,
    latencyNs:900, asic:'Broadcom Jericho2',
    priceRange:'enterprise', userScale:[1000,5000], estimatedCostUSD:35000,
    features:['Deep buffer 512MB','BGP-LU','MPLS','VXLAN/EVPN','CloudVision','RESTCONF','gNMI'],
    useCases:['campus','hybrid','dc'],
    detail:{
      throughput:'7.2 Tbps', macTable:'512K', vlans:'4094',
      routing:'Full L3 + MPLS + SR', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Deep buffer makes this ideal for distribution where bursty traffic from access is absorbed. Also used as DC border leaf.'
    }
  },
  'ex4650-48y': {
    id:'ex4650-48y', vendor:'Juniper', vlClass:'vl-juniper',
    model:'EX4650-48Y', series:'EX4650',
    layer:'distribution', subLayer:'campus-dist',
    ports:'48x 25GbE SFP28', uplinks:'8x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:680, bufferGB:0.064,
    latencyNs:1500, asic:'Broadcom Trident3 X5',
    priceRange:'enterprise', userScale:[500,3000], estimatedCostUSD:22000,
    features:['Virtual Chassis','EVPN-VXLAN','BGP','Mist AI','NETCONF/YANG','Analytics'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'2.88 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'High-density 25G distribution. Pairs naturally with EX2300/EX3400 access via Virtual Chassis Fabric.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     CAMPUS CORE
  ══════════════════════════════════════════════════════════════ */
  'cat9600-32c': {
    id:'cat9600-32c', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9600-32C', series:'Catalyst 9600',
    layer:'core', subLayer:'campus-core',
    ports:'32x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:1400, bufferGB:0.256,
    latencyNs:1200, asic:'UADP 3.0',
    priceRange:'enterprise', userScale:[2000,20000], estimatedCostUSD:95000,
    features:['Non-blocking','MACSEC-256','BGP','MPLS','SD-Access core','NetFlow','NETCONF/YANG','In-Service Upgrade'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'6.4 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3 + MPLS', ipv6:'Yes', formFactor:'Modular 7-slot',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2, TAA',
      notes:'Modular core switch. Up to 7 line cards. Dual supervisor for full HA. Acts as SD-Access control-plane anchor for large campuses.'
    }
  },
  'arista-7500r3': {
    id:'arista-7500r3', vendor:'Arista', vlClass:'vl-arista',
    model:'7500R3', series:'7500R3',
    layer:'core', subLayer:'campus-core',
    ports:'Up to 576x 100GbE', uplinks:'Up to 144x 400GbE',
    speed:'100G', upSpeed:'400G', powerW:3200, bufferGB:2.0,
    latencyNs:800, asic:'Broadcom Jericho2 / Petra2',
    priceRange:'hyperscale', userScale:[5000,50000], estimatedCostUSD:180000,
    features:['Deep buffer 2GB','VXLAN/EVPN','BGP SR-MPLS','CloudVision','gNMI/gRPC','Hot-swap LC','Hitless ISSU'],
    useCases:['campus','dc','hybrid'],
    detail:{
      throughput:'57.6 Tbps', macTable:'1M', vlans:'16M (VNI)',
      routing:'Full L3 + MPLS + SR-MPLS', ipv6:'Yes',
      formFactor:'Modular 8-slot', warranty:'1-year',
      certifications:'TAA', notes:'Carrier-grade modular core. Used by hyperscalers as border leaf. Suitable for very large enterprise or DC core.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     DATA CENTER — LEAF
  ══════════════════════════════════════════════════════════════ */
  'nexus-93180yc-fx': {
    id:'nexus-93180yc-fx', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 93180YC-FX', series:'Nexus 9300',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'48x 25GbE SFP28', uplinks:'6x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:650, bufferGB:0.04,
    latencyNs:1100, asic:'Cisco Cloud Scale (Algo Boost)',
    priceRange:'enterprise', userScale:[500,5000], estimatedCostUSD:22000,
    features:['VXLAN/EVPN','FabricPath','ACI-ready','NX-OS','NETCONF/YANG','Telemetry streaming','MACSEC'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'3.6 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 BGP/OSPF/IS-IS', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'Workhorse DC leaf. High-density 25G server connectivity. Commonly deployed in pairs for vPC redundancy. ACI or standalone NX-OS.'
    }
  },
  'nexus-93360yc-fx2': {
    id:'nexus-93360yc-fx2', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 93360YC-FX2', series:'Nexus 9300',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'96x 25GbE SFP28', uplinks:'12x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:900, bufferGB:0.064,
    latencyNs:1100, asic:'Cisco Cloud Scale',
    priceRange:'enterprise', userScale:[1000,8000], estimatedCostUSD:35000,
    features:['VXLAN/EVPN','96-port density','vPC','NX-OS','Streaming telemetry','MACSEC','NetFlow'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'7.2 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'High-density DC leaf for large server pods. 96 servers at 25G per leaf. Double-density vs 93180.'
    }
  },
  'arista-7050cx3-32s': {
    id:'arista-7050cx3-32s', vendor:'Arista', vlClass:'vl-arista',
    model:'7050CX3-32S', series:'7050CX3',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'32x 100GbE QSFP28', uplinks:'2x 400GbE QSFP-DD',
    speed:'100G', upSpeed:'400G', powerW:550, bufferGB:0.032,
    latencyNs:900, asic:'Broadcom Trident3',
    priceRange:'enterprise', userScale:[500,5000], estimatedCostUSD:20000,
    features:['VXLAN/EVPN','BGP EVPN','CloudVision','EOS','gNMI/gRPC','ZTP','RESTCONF'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'6.4 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 + SR', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'100G server-facing DC leaf. Used in hyperscale-style leaf-spine fabrics. ZTP and EOS automation make it ops-friendly.'
    }
  },
  'qfx5120-48y': {
    id:'qfx5120-48y', vendor:'Juniper', vlClass:'vl-juniper',
    model:'QFX5120-48Y', series:'QFX5120',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'48x 25GbE SFP28', uplinks:'8x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:650, bufferGB:0.032,
    latencyNs:1000, asic:'Broadcom Trident3',
    priceRange:'enterprise', userScale:[500,5000], estimatedCostUSD:19000,
    features:['VXLAN/EVPN','BGP','Junos','NETCONF/YANG','Analytics','ZTP','Multi-chassis LAG'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'2.88 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Consistent Junos across DC and campus. Strong analytics with Juniper Apstra integration for intent-based networking.'
    }
  },
  'dell-s5248f-on': {
    id:'dell-s5248f-on', vendor:'Dell EMC', vlClass:'vl-dell',
    model:'PowerSwitch S5248F-ON', series:'S5200',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'48x 25GbE SFP28', uplinks:'6x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:600, bufferGB:0.032,
    latencyNs:1000, asic:'Broadcom Trident3',
    priceRange:'mid', userScale:[200,2000], estimatedCostUSD:12000,
    features:['SONiC / OS10','Open Networking','VXLAN/EVPN','BGP','ONIE','ZTP','SmartFabric','Dell EMC fabric'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'3.6 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Open networking DC leaf. Runs SONiC or Dell OS10. SmartFabric Director automates CLOS fabric deployment. Good cost alternative to Cisco/Arista for standard DC workloads.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     DATA CENTER — SPINE
  ══════════════════════════════════════════════════════════════ */
  'nexus-9336c-fx2': {
    id:'nexus-9336c-fx2', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 9336C-FX2', series:'Nexus 9300',
    layer:'spine', subLayer:'dc-spine',
    ports:'36x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:650, bufferGB:0.04,
    latencyNs:900, asic:'Cisco Cloud Scale',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:28000,
    features:['VXLAN/EVPN spine','BGP RR','IS-IS underlay','NX-OS','Streaming telemetry','MACSEC','ECMP 64-way'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'7.2 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3 BGP/OSPF/IS-IS', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'Industry-standard DC spine. Deployed in pairs or quads. Acts as BGP Route Reflector for EVPN fabric. ACI spine-ready.'
    }
  },
  'nexus-9364d-gx': {
    id:'nexus-9364d-gx', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 9364D-GX', series:'Nexus 9300',
    layer:'spine', subLayer:'dc-spine',
    ports:'64x 400GbE QSFP-DD', uplinks:'—',
    speed:'400G', upSpeed:'—', powerW:2200, bufferGB:0.256,
    latencyNs:800, asic:'Cisco Cloud Scale NEXT',
    priceRange:'hyperscale', userScale:[5000,50000], estimatedCostUSD:120000,
    features:['400G spine','VXLAN/EVPN','BGP RR','ECMP 128-way','NX-OS','Streaming telemetry','MACSEC-256'],
    useCases:['dc','hybrid','gpu'],
    detail:{
      throughput:'51.2 Tbps', macTable:'256K', vlans:'16M (VNI)',
      routing:'Full L3 + SR-MPLS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'Next-gen 400G spine for hyperscale or AI/GPU fabrics. Connects GPU TOR switches at 400G. Future-proof for 800G migration.'
    }
  },
  'arista-7280r3': {
    id:'arista-7280r3', vendor:'Arista', vlClass:'vl-arista',
    model:'7280R3-48YC6', series:'7280R3',
    layer:'spine', subLayer:'dc-spine',
    ports:'48x 25GbE + 6x 100GbE', uplinks:'2x 400GbE',
    speed:'100G', upSpeed:'400G', powerW:700, bufferGB:0.512,
    latencyNs:850, asic:'Broadcom Jericho2',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:38000,
    features:['Deep buffer 512MB','VXLAN/EVPN','BGP RR','SR-MPLS','CloudVision','gNMI','ECMP'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'7.2 Tbps', macTable:'512K', vlans:'16M (VNI)',
      routing:'Full L3 + SR-MPLS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Deep-buffer spine ideal for large VXLAN fabrics with bursty east-west traffic. Also used as border spine or route reflector.'
    }
  },
  'qfx10002-60c': {
    id:'qfx10002-60c', vendor:'Juniper', vlClass:'vl-juniper',
    model:'QFX10002-60C', series:'QFX10002',
    layer:'spine', subLayer:'dc-spine',
    ports:'60x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'—', powerW:1200, bufferGB:2.0,
    latencyNs:900, asic:'Juniper Express 2',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:42000,
    features:['Deep buffer 2GB','VXLAN/EVPN','BGP RR','Segment Routing','Apstra','NETCONF/YANG','Analytics'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'12 Tbps', macTable:'512K', vlans:'16M (VNI)',
      routing:'Full L3 + SR + MPLS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Large-buffer DC spine. Deep 2GB buffer absorbs microburst storms. Integrated Apstra intent-based control.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     GPU / AI — TOR
  ══════════════════════════════════════════════════════════════ */
  'nexus-9336c-fx2-gpu': {
    id:'nexus-9336c-fx2-gpu', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 9336C-FX2 (GPU TOR)', series:'Nexus 9300',
    layer:'tor', subLayer:'gpu-tor',
    ports:'36x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:650, bufferGB:0.04,
    latencyNs:900, asic:'Cisco Cloud Scale',
    priceRange:'enterprise', userScale:[100,1000], estimatedCostUSD:28000,
    features:['RoCEv2','PFC/ECN','DCQCN','Lossless queuing','NX-OS','Streaming telemetry','ECMP'],
    useCases:['gpu'],
    detail:{
      throughput:'7.2 Tbps', macTable:'128K', vlans:'4094',
      routing:'L3 BGP', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'Configured in lossless mode for RoCEv2 GPU traffic. PFC enables pause-free RDMA. Each TOR connects 8-16 GPU servers at 100G.'
    }
  },
  'arista-7060x4-32s': {
    id:'arista-7060x4-32s', vendor:'Arista', vlClass:'vl-arista',
    model:'7060X4-32S', series:'7060X4',
    layer:'tor', subLayer:'gpu-tor',
    ports:'32x 400GbE QSFP-DD', uplinks:'—',
    speed:'400G', upSpeed:'800G', powerW:1050, bufferGB:0.064,
    latencyNs:650, asic:'Broadcom Trident4',
    priceRange:'hyperscale', userScale:[500,5000], estimatedCostUSD:65000,
    features:['400G native','RoCEv2','PFC/ECN','DCQCN','Ultra-low latency','EOS','CloudVision','gNMI'],
    useCases:['gpu'],
    detail:{
      throughput:'12.8 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3 BGP', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'400G GPU TOR — connects H100/A100 servers with 400G NICs. Rail-optimized deployment pairs each TOR with 8 GPUs.'
    }
  },
  'nvidia-sn4600c': {
    id:'nvidia-sn4600c', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum-3 SN4600C', series:'Spectrum-3',
    layer:'tor', subLayer:'gpu-tor',
    ports:'64x 400GbE QSFP-DD', uplinks:'—',
    speed:'400G', upSpeed:'800G', powerW:1200, bufferGB:0.128,
    latencyNs:300, asic:'NVIDIA Spectrum-3',
    priceRange:'hyperscale', userScale:[500,5000], estimatedCostUSD:75000,
    features:['Ultra-low 300ns latency','RoCEv2 native','Adaptive Routing','PFC/ECN','SHARP in-network computing','ConnectX integration'],
    useCases:['gpu'],
    detail:{
      throughput:'25.6 Tbps', macTable:'512K', vlans:'4094',
      routing:'Full L3 BGP', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Best-in-class for NVIDIA GPU clusters. SHARP offloads collective operations in-network (AllReduce). Adaptive routing eliminates hotspots. Native DGX SuperPOD integration.'
    }
  },
  'nvidia-sn2700': {
    id:'nvidia-sn2700', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum SN2700', series:'Spectrum',
    layer:'tor', subLayer:'gpu-tor',
    ports:'32x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'—', powerW:450, bufferGB:0.016,
    latencyNs:500, asic:'NVIDIA Spectrum',
    priceRange:'enterprise', userScale:[100,500], estimatedCostUSD:18000,
    features:['RoCEv2','PFC/ECN','Low latency','Open Ethernet','Cumulus Linux','SONiC compatible'],
    useCases:['gpu'],
    detail:{
      throughput:'6.4 Tbps', macTable:'64K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Entry GPU TOR for 100G server NICs. Cost-effective starting point for RoCEv2 clusters. Runs Cumulus Linux or SONiC.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     GPU / AI — SPINE
  ══════════════════════════════════════════════════════════════ */
  'nvidia-sn4800': {
    id:'nvidia-sn4800', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum-3 SN4800', series:'Spectrum-3',
    layer:'spine', subLayer:'gpu-spine',
    ports:'64x 400GbE QSFP-DD (modular)', uplinks:'—',
    speed:'400G', upSpeed:'—', powerW:4000, bufferGB:0.512,
    latencyNs:300, asic:'NVIDIA Spectrum-3',
    priceRange:'hyperscale', userScale:[2000,20000], estimatedCostUSD:250000,
    features:['SHARP collective offload','Adaptive Routing','Lossless RoCEv2','In-network computing','Modular chassis','Hot-swap'],
    useCases:['gpu'],
    detail:{
      throughput:'25.6 Tbps/blade', macTable:'512K', vlans:'4094',
      routing:'Full L3 BGP', ipv6:'Yes', formFactor:'Modular 8-slot',
      warranty:'1-year', certifications:'TAA',
      notes:'Hyperscale GPU spine. Used in DGX SuperPOD and Selene clusters. SHARP v2 accelerates distributed ML training by offloading AllReduce to the network.'
    }
  },
  'arista-7800r3-gpu': {
    id:'arista-7800r3-gpu', vendor:'Arista', vlClass:'vl-arista',
    model:'7800R3 (GPU Spine)', series:'7800R3',
    layer:'spine', subLayer:'gpu-spine',
    ports:'Up to 576x 100GbE / 144x 400GbE', uplinks:'—',
    speed:'400G', upSpeed:'—', powerW:3500, bufferGB:2.0,
    latencyNs:700, asic:'Broadcom Jericho2',
    priceRange:'hyperscale', userScale:[2000,20000], estimatedCostUSD:200000,
    features:['Deep buffer 2GB','RoCEv2','PFC/ECN','CloudVision','BGP EVPN','Hitless ISSU','ECMP 512-way'],
    useCases:['gpu','dc'],
    detail:{
      throughput:'57.6 Tbps', macTable:'1M', vlans:'16M',
      routing:'Full L3 + SR', ipv6:'Yes', formFactor:'Modular 8-slot',
      warranty:'1-year', certifications:'TAA',
      notes:'Large modular spine for GPU or DC. Deep buffer essential for bursty AllReduce patterns. Up to 144x 400G ports per chassis.'
    }
  },

  /* ══════════════════════════════════════════════════════════════
     FIREWALLS / SECURITY
  ══════════════════════════════════════════════════════════════ */
  'fp4145': {
    id:'fp4145', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Firepower 4145', series:'Firepower 4100',
    layer:'firewall', subLayer:'fw',
    ports:'16x 10GbE + 2x 40GbE', uplinks:'—',
    speed:'10G', upSpeed:'40G', powerW:800, bufferGB:0,
    latencyNs:0, asic:'Intel CPU + FPGA',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:55000,
    features:['IPS/IDS','TLS 1.3 inspection','AMP','URL filtering','RA VPN','FMC managed','FTD software','Zero-Trust ready'],
    useCases:['campus','dc','hybrid','wan'],
    detail:{
      throughput:'45 Gbps FW / 20 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF (ASA mode)', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'FIPS 140-2, Common Criteria',
      notes:'Enterprise perimeter NGFW. Managed by Firepower Management Center or Cisco Defense Orchestrator.'
    }
  },
  'pa-3440': {
    id:'pa-3440', vendor:'Palo Alto', vlClass:'vl-paloalto',
    model:'PA-3440', series:'PA-3400',
    layer:'firewall', subLayer:'fw',
    ports:'8x 25GbE SFP28 + 4x 100GbE QSFP28', uplinks:'—',
    speed:'25G', upSpeed:'100G', powerW:600, bufferGB:0,
    latencyNs:0, asic:'Custom DPDK',
    priceRange:'enterprise', userScale:[500,5000], estimatedCostUSD:45000,
    features:['App-ID','User-ID','ML-based IPS','TLS inspection','DNS Security','Panorama managed','SD-WAN','ZTNA'],
    useCases:['campus','dc','hybrid'],
    detail:{
      throughput:'22 Gbps FW / 10 Gbps threat', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Best-of-breed NGFW with App-ID. ML-powered inline threat prevention. Ideal for DC perimeter or distributed campus FW.'
    }
  },
  'pa-5445': {
    id:'pa-5445', vendor:'Palo Alto', vlClass:'vl-paloalto',
    model:'PA-5445', series:'PA-5400',
    layer:'firewall', subLayer:'fw',
    ports:'16x 100GbE QSFP28 + 4x 400GbE', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:1500, bufferGB:0,
    latencyNs:0, asic:'Custom CN-NGFW',
    priceRange:'hyperscale', userScale:[5000,50000], estimatedCostUSD:185000,
    features:['100G+ throughput','App-ID','ML IPS','TLS 1.3','CN-Series Kubernetes','Panorama','ZTNA 2.0'],
    useCases:['dc','hybrid','gpu'],
    detail:{
      throughput:'200 Gbps FW / 100 Gbps threat', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'4RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Hyperscale NGFW for large DC edge. 200 Gbps FW throughput. Supports Kubernetes and container micro-segmentation.'
    }
  },
  'fortigate-100f': {
    id:'fortigate-100f', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiGate 100F', series:'FortiGate F',
    layer:'firewall', subLayer:'fw',
    ports:'22x 1GbE + 2x 10GbE SFP+', uplinks:'—',
    speed:'1G', upSpeed:'10G', powerW:50, bufferGB:0,
    latencyNs:0, asic:'NP6lite ASIC',
    priceRange:'smb', userScale:[10,200], estimatedCostUSD:2800,
    features:['NP6lite ASIC offload','IPS','SSL inspection','SD-WAN built-in','FortiManager','Security Fabric','ZTNA','FortiSwitch integration'],
    useCases:['campus','wan'],
    detail:{
      throughput:'20 Gbps FW / 1 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF', ipv6:'Yes', formFactor:'1RU desktop',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2',
      notes:'Best SMB firewall. Manages FortiSwitch and FortiAP via Security Fabric for unified campus control. Ideal for small branches and SMB campuses under 200 users.'
    }
  },
  'fortigate-600f': {
    id:'fortigate-600f', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiGate 600F', series:'FortiGate F',
    layer:'firewall', subLayer:'fw',
    ports:'16x 1GbE + 8x 25GbE SFP28 + 2x 100GbE', uplinks:'—',
    speed:'25G', upSpeed:'100G', powerW:200, bufferGB:0,
    latencyNs:0, asic:'NP7 + CP9 ASIC',
    priceRange:'mid', userScale:[200,1000], estimatedCostUSD:12000,
    features:['NP7 ASIC offload','IPS','SSL inspection','SD-WAN','Security Fabric','ZTNA','FortiManager','SASE-ready'],
    useCases:['campus','dc','hybrid','wan'],
    detail:{
      throughput:'36 Gbps FW / 10 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2',
      notes:'Mid-market NGFW. Excellent price/performance via NP7. Perfect pair with FortiSwitch 400/500 for full Fortinet campus fabric.'
    }
  },
  'fortigate-1800f': {
    id:'fortigate-1800f', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiGate 1800F', series:'FortiGate F',
    layer:'firewall', subLayer:'fw',
    ports:'16x 25GbE SFP28 + 4x 100GbE QSFP28', uplinks:'—',
    speed:'25G', upSpeed:'100G', powerW:750, bufferGB:0,
    latencyNs:0, asic:'NP7 + CP9 ASIC',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:48000,
    features:['NP7 ASIC offload','IPS','SSL inspection','SD-WAN built-in','FortiManager','Security Fabric','ZTNA','SASE'],
    useCases:['campus','dc','hybrid','wan'],
    detail:{
      throughput:'198 Gbps FW / 35 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'2RU',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Best price/performance via NP7 ASIC. Built-in SD-WAN makes it ideal for WAN edge + FW consolidation. Security Fabric for unified visibility.'
    }
  },
  'srx4600': {
    id:'srx4600', vendor:'Juniper', vlClass:'vl-juniper',
    model:'SRX4600', series:'SRX4000',
    layer:'firewall', subLayer:'fw',
    ports:'6x 100GbE QSFP28 + 24x 10GbE SFP+', uplinks:'—',
    speed:'100G', upSpeed:'—', powerW:850, bufferGB:0,
    latencyNs:0, asic:'Juniper Penta',
    priceRange:'enterprise', userScale:[1000,10000], estimatedCostUSD:52000,
    features:['Junos UTM','IDP','AppSecure','Sky ATP','JSA SIEM','NETCONF/YANG','Sky Enterprise'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'80 Gbps FW / 20 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'Full L3 BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'DC-focused NGFW with consistent Junos. Ideal for all-Juniper DC deployments. Integrates with QFX via Security Director.'
    }
  },
};
