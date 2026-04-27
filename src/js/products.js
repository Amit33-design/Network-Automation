'use strict';

/* ════════════════════════════════════════════════════════════════
   PART 2 — Product Recommendation Engine
════════════════════════════════════════════════════════════════ */

/* ── Product Database ────────────────────────────────────────────
   Each product: { id, vendor, vlClass, model, series, layer,
     ports, uplinks, speed, powerW, asic, bufferGB, latencyNs,
     features[], useCases[], score fn, detail{} }
─────────────────────────────────────────────────────────────── */
const PRODUCTS = {

  /* ── CAMPUS ACCESS LAYER ──────────────────────────────────── */
  'cat9300-24p': {
    id:'cat9300-24p', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9300-24P', series:'Catalyst 9300',
    layer:'access', subLayer:'campus-access',
    ports:'24x 1GbE PoE+', uplinks:'4x 1/10GbE SFP+',
    speed:'1G', upSpeed:'10G', powerW:890, bufferGB:0.032,
    latencyNs:3500, asic:'UADP 2.0',
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
    features:['PoE+ 740W','802.1X','MACSEC','Stacking','SD-Access','NETCONF/YANG','Trustworthy Systems'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'208 Gbps', macTable:'32K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU fixed',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2, TAA',
      notes:'High-density campus access. Dual PoE budget 740W. Ideal for open office deployments.'
    }
  },
  'arista-720xp-48zc2': {
    id:'arista-720xp-48zc2', vendor:'Arista', vlClass:'vl-arista',
    model:'720XP-48ZC2', series:'720XP',
    layer:'access', subLayer:'campus-access',
    ports:'48x 1/2.5GbE PoE++', uplinks:'2x 100GbE QSFP28',
    speed:'2.5G', upSpeed:'100G', powerW:2000, bufferGB:0.064,
    latencyNs:2000, asic:'Broadcom Trident3',
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
    features:['PoE+ 370W','802.1X','Virtual Chassis (VC)','Junos','NETCONF/YANG','ZTP','Mist AI-ready'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'176 Gbps', macTable:'16K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'Compact, cost-effective campus access. Mist AI integration for cloud-managed deployments. Virtual Chassis up to 10 units.'
    }
  },

  /* ── CAMPUS DISTRIBUTION ──────────────────────────────────── */
  'cat9500-48y4c': {
    id:'cat9500-48y4c', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9500-48Y4C', series:'Catalyst 9500',
    layer:'distribution', subLayer:'campus-dist',
    ports:'48x 25GbE SFP28', uplinks:'4x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:850, bufferGB:0.096,
    latencyNs:1800, asic:'UADP 3.0',
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
    features:['Virtual Chassis','EVPN-VXLAN','BGP','Mist AI','NETCONF/YANG','Analytics'],
    useCases:['campus','hybrid'],
    detail:{
      throughput:'2.88 Tbps', macTable:'128K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'Limited Lifetime', certifications:'TAA',
      notes:'High-density 25G distribution. Pairs naturally with EX2300/EX3400 access via Virtual Chassis Fabric.'
    }
  },

  /* ── CAMPUS CORE ──────────────────────────────────────────── */
  'cat9600-32c': {
    id:'cat9600-32c', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Catalyst 9600-32C', series:'Catalyst 9600',
    layer:'core', subLayer:'campus-core',
    ports:'32x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:1400, bufferGB:0.256,
    latencyNs:1200, asic:'UADP 3.0',
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
    features:['Deep buffer 2GB','VXLAN/EVPN','BGP SR-MPLS','CloudVision','gNMI/gRPC','Hot-swap LC','Hitless ISSU'],
    useCases:['campus','dc','hybrid'],
    detail:{
      throughput:'57.6 Tbps', macTable:'1M', vlans:'16M (VNI)',
      routing:'Full L3 + MPLS + SR-MPLS', ipv6:'Yes',
      formFactor:'Modular 8-slot', warranty:'1-year',
      certifications:'TAA', notes:'Carrier-grade modular core. Used by hyperscalers as border leaf. Suitable for very large enterprise or DC core.'
    }
  },

  /* ── DC LEAF ──────────────────────────────────────────────── */
  'nexus-93180yc-fx': {
    id:'nexus-93180yc-fx', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 93180YC-FX', series:'Nexus 9300',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'48x 25GbE SFP28', uplinks:'6x 100GbE QSFP28',
    speed:'25G', upSpeed:'100G', powerW:650, bufferGB:0.04,
    latencyNs:1100, asic:'Cisco Cloud Scale (Algo Boost)',
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
    features:['VXLAN/EVPN','96-port density','vPC','NX-OS','Streaming telemetry','MACSEC','NetFlow'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'7.2 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2',
      notes:'High-density DC leaf for large server pods. 96 servers at 25G per leaf. Double-density vs 93180. Reduces pod leaf count by 50%.'
    }
  },
  'arista-7050cx3-32s': {
    id:'arista-7050cx3-32s', vendor:'Arista', vlClass:'vl-arista',
    model:'7050CX3-32S', series:'7050CX3',
    layer:'leaf', subLayer:'dc-leaf',
    ports:'32x 100GbE QSFP28', uplinks:'2x 400GbE QSFP-DD',
    speed:'100G', upSpeed:'400G', powerW:550, bufferGB:0.032,
    latencyNs:900, asic:'Broadcom Trident3',
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
    features:['VXLAN/EVPN','BGP','Junos','NETCONF/YANG','Analytics','ZTP','Multi-chassis LAG'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'2.88 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Consistent Junos across DC and campus. Strong analytics with Juniper Apstra integration for intent-based networking.'
    }
  },

  /* ── DC SPINE ─────────────────────────────────────────────── */
  'nexus-9336c-fx2': {
    id:'nexus-9336c-fx2', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 9336C-FX2', series:'Nexus 9300',
    layer:'spine', subLayer:'dc-spine',
    ports:'36x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:650, bufferGB:0.04,
    latencyNs:900, asic:'Cisco Cloud Scale',
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
    features:['Deep buffer 2GB','VXLAN/EVPN','BGP RR','Segment Routing','Apstra','NETCONF/YANG','Analytics'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'12 Tbps', macTable:'512K', vlans:'16M (VNI)',
      routing:'Full L3 + SR + MPLS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Large-buffer DC spine. Deep 2GB buffer absorbs microburst storms in high-throughput fabrics. Integrated Apstra intent-based control.'
    }
  },

  /* ── GPU / AI TOR ─────────────────────────────────────────── */
  'nexus-9336c-fx2-gpu': {
    id:'nexus-9336c-fx2-gpu', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Nexus 9336C-FX2 (GPU TOR)', series:'Nexus 9300',
    layer:'tor', subLayer:'gpu-tor',
    ports:'36x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:650, bufferGB:0.04,
    latencyNs:900, asic:'Cisco Cloud Scale',
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
    features:['400G native','RoCEv2','PFC/ECN','DCQCN','Ultra-low latency','EOS','CloudVision','gNMI'],
    useCases:['gpu'],
    detail:{
      throughput:'12.8 Tbps', macTable:'256K', vlans:'4094',
      routing:'Full L3 BGP', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'400G GPU TOR — connects H100/A100 servers with 400G NICs (e.g. CX7). Rail-optimized deployment pairs each TOR with 8 GPUs.'
    }
  },
  'nvidia-sn4600c': {
    id:'nvidia-sn4600c', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum-3 SN4600C', series:'Spectrum-3',
    layer:'tor', subLayer:'gpu-tor',
    ports:'64x 400GbE QSFP-DD', uplinks:'—',
    speed:'400G', upSpeed:'800G', powerW:1200, bufferGB:0.128,
    latencyNs:300, asic:'NVIDIA Spectrum-3',
    features:['Ultra-low 300ns latency','RoCEv2 native','Adaptive Routing','PFC/ECN','SHARP in-network computing','ConnectX integration'],
    useCases:['gpu'],
    detail:{
      throughput:'25.6 Tbps', macTable:'512K', vlans:'4094',
      routing:'Full L3 BGP', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Best-in-class for NVIDIA GPU clusters. SHARP offloads collective operations in-network (AllReduce). Adaptive routing eliminates hotspots. Native integration with DGX SuperPOD.'
    }
  },
  'nvidia-sn2700': {
    id:'nvidia-sn2700', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum SN2700', series:'Spectrum',
    layer:'tor', subLayer:'gpu-tor',
    ports:'32x 100GbE QSFP28', uplinks:'—',
    speed:'100G', upSpeed:'—', powerW:450, bufferGB:0.016,
    latencyNs:500, asic:'NVIDIA Spectrum',
    features:['RoCEv2','PFC/ECN','Low latency','Open Ethernet','Cumulus Linux','SONiC compatible'],
    useCases:['gpu'],
    detail:{
      throughput:'6.4 Tbps', macTable:'64K', vlans:'4094',
      routing:'Full L3', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'TAA',
      notes:'Entry GPU TOR for 100G server NICs. Cost-effective starting point for RoCEv2 clusters. Runs Cumulus Linux or SONiC.'
    }
  },

  /* ── GPU / AI SPINE ───────────────────────────────────────── */
  'nvidia-sn4800': {
    id:'nvidia-sn4800', vendor:'NVIDIA', vlClass:'vl-nvidia',
    model:'Spectrum-3 SN4800', series:'Spectrum-3',
    layer:'spine', subLayer:'gpu-spine',
    ports:'64x 400GbE QSFP-DD (modular)', uplinks:'—',
    speed:'400G', upSpeed:'—', powerW:4000, bufferGB:0.512,
    latencyNs:300, asic:'NVIDIA Spectrum-3',
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
    features:['Deep buffer 2GB','RoCEv2','PFC/ECN','CloudVision','BGP EVPN','Hitless ISSU','ECMP 512-way'],
    useCases:['gpu','dc'],
    detail:{
      throughput:'57.6 Tbps', macTable:'1M', vlans:'16M',
      routing:'Full L3 + SR', ipv6:'Yes', formFactor:'Modular 8-slot',
      warranty:'1-year', certifications:'TAA',
      notes:'Large modular spine for GPU or DC. Deep buffer essential for bursty AllReduce patterns. Up to 144x 400G ports per chassis.'
    }
  },

  /* ── FIREWALLS ────────────────────────────────────────────── */
  'fp4145': {
    id:'fp4145', vendor:'Cisco', vlClass:'vl-cisco',
    model:'Firepower 4145', series:'Firepower 4100',
    layer:'firewall', subLayer:'fw',
    ports:'16x 10GbE + 2x 40GbE', uplinks:'—',
    speed:'10G', upSpeed:'40G', powerW:800, bufferGB:0,
    latencyNs:0, asic:'Intel CPU + FPGA',
    features:['IPS/IDS','TLS 1.3 inspection','AMP','URL filtering','RA VPN','FMC managed','FTD software','Zero-Trust ready'],
    useCases:['campus','dc','hybrid','wan'],
    detail:{
      throughput:'45 Gbps FW / 20 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF (ASA mode)', ipv6:'Yes', formFactor:'1RU',
      warranty:'1-year', certifications:'FIPS 140-2, Common Criteria',
      notes:'Enterprise perimeter NGFW. Managed by Firepower Management Center or Cisco Defense Orchestrator. Supports threat-centric micro-segmentation.'
    }
  },
  'pa-3440': {
    id:'pa-3440', vendor:'Palo Alto', vlClass:'vl-paloalto',
    model:'PA-3440', series:'PA-3400',
    layer:'firewall', subLayer:'fw',
    ports:'8x 25GbE SFP28 + 4x 100GbE QSFP28', uplinks:'—',
    speed:'25G', upSpeed:'100G', powerW:600, bufferGB:0,
    latencyNs:0, asic:'Custom DPDK',
    features:['App-ID','User-ID','ML-based IPS','TLS inspection','DNS Security','Panorama managed','SD-WAN','ZTNA'],
    useCases:['campus','dc','hybrid'],
    detail:{
      throughput:'22 Gbps FW / 10 Gbps threat', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Best-of-breed NGFW with App-ID eliminating port-based policy. ML-powered inline threat prevention. Ideal for DC perimeter or distributed campus FW.'
    }
  },
  'pa-5445': {
    id:'pa-5445', vendor:'Palo Alto', vlClass:'vl-paloalto',
    model:'PA-5445', series:'PA-5400',
    layer:'firewall', subLayer:'fw',
    ports:'16x 100GbE QSFP28 + 4x 400GbE', uplinks:'—',
    speed:'100G', upSpeed:'400G', powerW:1500, bufferGB:0,
    latencyNs:0, asic:'Custom CN-NGFW',
    features:['100G+ throughput','App-ID','ML IPS','TLS 1.3','CN-Series Kubernetes','Panorama','ZTNA 2.0'],
    useCases:['dc','hybrid','gpu'],
    detail:{
      throughput:'200 Gbps FW / 100 Gbps threat', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'4RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Hyperscale NGFW for large DC edge. 200 Gbps FW throughput. Supports Kubernetes and container micro-segmentation with CN-Series.'
    }
  },
  'fortigate-1800f': {
    id:'fortigate-1800f', vendor:'Fortinet', vlClass:'vl-fortinet',
    model:'FortiGate 1800F', series:'FortiGate F',
    layer:'firewall', subLayer:'fw',
    ports:'16x 25GbE SFP28 + 4x 100GbE QSFP28', uplinks:'—',
    speed:'25G', upSpeed:'100G', powerW:750, bufferGB:0,
    latencyNs:0, asic:'NP7 + CP9 ASIC',
    features:['NP7 ASIC offload','IPS','SSL inspection','SD-WAN built-in','FortiManager','Security Fabric','ZTNA','SASE'],
    useCases:['campus','dc','hybrid','wan'],
    detail:{
      throughput:'198 Gbps FW / 35 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'2RU',
      warranty:'Limited Lifetime', certifications:'FIPS 140-2, CC EAL4+',
      notes:'Best price/performance via NP7 ASIC hardware offload. Built-in SD-WAN makes it ideal for WAN edge + FW consolidation. Security Fabric for unified visibility.'
    }
  },
  'srx4600': {
    id:'srx4600', vendor:'Juniper', vlClass:'vl-juniper',
    model:'SRX4600', series:'SRX4000',
    layer:'firewall', subLayer:'fw',
    ports:'6x 100GbE QSFP28 + 24x 10GbE SFP+', uplinks:'—',
    speed:'100G', upSpeed:'—', powerW:850, bufferGB:0,
    latencyNs:0, asic:'Juniper Penta',
    features:['Junos UTM','IDP','AppSecure','Sky ATP','JSA SIEM','NETCONF/YANG','Sky Enterprise'],
    useCases:['dc','hybrid'],
    detail:{
      throughput:'80 Gbps FW / 20 Gbps IPS', macTable:'—', vlans:'4094',
      routing:'Full L3 BGP / OSPF / IS-IS', ipv6:'Yes', formFactor:'2RU',
      warranty:'1-year', certifications:'FIPS 140-2, CC EAL4+',
      notes:'DC-focused NGFW with consistent Junos across routing and security. Ideal for all-Juniper DC deployments. Integrates with QFX via Security Director.'
    }
  },
};

