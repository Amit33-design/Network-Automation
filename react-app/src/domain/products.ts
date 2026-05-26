import type { IntentObject } from '../types/intent';

export interface Product {
  id: string;
  model: string;
  vendor: string;
  subLayer: string;
  ports: number;
  uplinks: number;
  uplink_speed_gbps?: number;
  downlink_count?: number;  // alias for ports used in BOM math
  speed: string;
  asic: string;
  powerW: number;
  priceUSD: number;
  features: string[];
  useCases: string[];
  detail: string;
  eol_date: string | null;
  eos_date: string | null;
  successor: string | null;
}

export const PRODUCTS: Product[] = [
  // ─── Spine / Core ────────────────────────────────────────────────────────
  {
    id: 'nxos-9336c', model: 'Nexus 9336C-FX2', vendor: 'Cisco', subLayer: 'spine',
    ports: 36, uplinks: 0, speed: '100G', asic: 'Cloud Scale', powerW: 650, priceUSD: 28000,
    features: ['VXLAN','EVPN','BGP','PFC','ECN','LLDP'], useCases: ['dc','gpu','multisite'],
    detail: '36x100G QSFP28, MACsec, CloudScale ASIC, 3.6Tbps',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'nxos-9364c', model: 'Nexus 9364C-GX', vendor: 'Cisco', subLayer: 'spine',
    ports: 64, uplinks: 0, speed: '400G', asic: 'Cloud Scale GX', powerW: 1200, priceUSD: 72000,
    features: ['VXLAN','EVPN','BGP','PFC','ECN','LLDP'], useCases: ['dc','gpu','multicloud'],
    detail: '64x400G QSFP-DD, AI/ML optimised, 25.6Tbps',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'arista-7800r3', model: 'Arista 7800R3', vendor: 'Arista', subLayer: 'spine',
    ports: 48, uplinks: 0, speed: '400G', asic: 'Jericho2+', powerW: 1400, priceUSD: 95000,
    features: ['VXLAN','EVPN','BGP','MPLS','FlowSpec'], useCases: ['dc','wan','multisite','multicloud'],
    detail: '48x400G QSFP-DD, segment routing, 19.2Tbps',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'juniper-qfx10002', model: 'QFX10002-72Q', vendor: 'Juniper', subLayer: 'spine',
    ports: 72, uplinks: 0, speed: '40G', asic: 'Q5', powerW: 800, priceUSD: 35000,
    features: ['VXLAN','EVPN','BGP','MPLS'], useCases: ['dc','multisite'],
    detail: '72x40G QSFP+, 2.88Tbps, VC-capable',
    eol_date: '2025-07-31', eos_date: '2030-07-31', successor: 'QFX10002-60C (Q5C ASIC, 60x100G)',
  },

  // ─── Leaf / ToR ──────────────────────────────────────────────────────────
  {
    id: 'nxos-93180yc', model: 'Nexus 93180YC-FX', vendor: 'Cisco', subLayer: 'leaf',
    ports: 48, uplinks: 6, uplink_speed_gbps: 100, downlink_count: 48,
    speed: '25G', asic: 'Cloud Scale', powerW: 480, priceUSD: 14000,
    features: ['VXLAN','EVPN','BGP','PFC','ECN','LLDP'], useCases: ['dc','gpu','multisite'],
    detail: '48x25G SFP28 + 6x100G QSFP28 uplinks',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'nxos-9332c', model: 'Nexus 9332C', vendor: 'Cisco', subLayer: 'leaf',
    ports: 32, uplinks: 2, uplink_speed_gbps: 100, downlink_count: 32,
    speed: '100G', asic: 'Cloud Scale', powerW: 550, priceUSD: 18000,
    features: ['VXLAN','EVPN','BGP','PFC'], useCases: ['dc','gpu'],
    detail: '32x100G QSFP28 + 2x100G uplinks, GPU-optimised',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'arista-7050cx3', model: 'Arista 7050CX3-32S', vendor: 'Arista', subLayer: 'leaf',
    ports: 32, uplinks: 2, uplink_speed_gbps: 100, downlink_count: 32,
    speed: '100G', asic: 'Trident3', powerW: 460, priceUSD: 16000,
    features: ['VXLAN','EVPN','BGP','PFC','ECMP'], useCases: ['dc','multisite'],
    detail: '32x100G QSFP28 + 2x100G uplinks, Trident3',
    eol_date: '2027-03-31', eos_date: '2032-03-31', successor: 'Arista 7050X4 (Trident4)',
  },
  {
    id: 'juniper-qfx5120', model: 'QFX5120-48Y', vendor: 'Juniper', subLayer: 'leaf',
    ports: 48, uplinks: 8, uplink_speed_gbps: 100, downlink_count: 48,
    speed: '25G', asic: 'Trident3', powerW: 440, priceUSD: 12000,
    features: ['VXLAN','EVPN','BGP','LLDP'], useCases: ['dc','multisite'],
    detail: '48x25G SFP28 + 8x100G QSFP28 uplinks',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── Distribution / Access ───────────────────────────────────────────────
  {
    id: 'cat9500', model: 'Catalyst 9500-48Y4C', vendor: 'Cisco', subLayer: 'distribution',
    ports: 48, uplinks: 4, uplink_speed_gbps: 100,
    speed: '25G', asic: 'UADP 3.0', powerW: 715, priceUSD: 22000,
    features: ['SDA','VXLAN','EVPN','BGP','QoS','MACsec'], useCases: ['campus','multisite'],
    detail: '48x25G + 4x100G, Cisco SDA-ready',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'cat9300l', model: 'Catalyst 9300L-48T-4G', vendor: 'Cisco', subLayer: 'access',
    ports: 48, uplinks: 4, uplink_speed_gbps: 1,
    speed: '1G', asic: 'UADP 2.0', powerW: 390, priceUSD: 4800,
    features: ['PoE+','SDA','QoS','LLDP','MACsec'], useCases: ['campus'],
    detail: '48x1G PoE+ + 4x1G SFP uplinks, 740W PoE budget',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'cat9200', model: 'Catalyst 9200-48P', vendor: 'Cisco', subLayer: 'access',
    ports: 48, uplinks: 4, uplink_speed_gbps: 1,
    speed: '1G', asic: 'UADP 2.0 Lite', powerW: 370, priceUSD: 3200,
    features: ['PoE+','QoS','LLDP'], useCases: ['campus'],
    detail: '48x1G PoE+ + 4x1G SFP uplinks',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── WAN / Edge ──────────────────────────────────────────────────────────
  {
    id: 'asr1002hx', model: 'ASR 1002-HX', vendor: 'Cisco', subLayer: 'wan-edge',
    ports: 4, uplinks: 0, speed: '10G', asic: 'QuantumFlow', powerW: 280, priceUSD: 18000,
    features: ['BGP','MPLS','OSPF','IPSec','DMVPN','SD-WAN'], useCases: ['wan','multisite'],
    detail: '4x10G, 60Gbps aggregate, crypto capable',
    eol_date: '2024-01-31', eos_date: '2029-01-31', successor: 'ASR 1001-X / Catalyst 8200',
  },
  {
    id: 'viptela-vedge', model: 'Catalyst SD-WAN vEdge 2000', vendor: 'Cisco', subLayer: 'wan-edge',
    ports: 8, uplinks: 0, speed: '1G', asic: 'Software', powerW: 150, priceUSD: 9500,
    features: ['SD-WAN','BGP','IPSec','ZTP','AppQoE'], useCases: ['wan','multisite','multicloud'],
    detail: '8x1G, SD-WAN ZTP, AppQoE, 20Gbps',
    eol_date: '2024-08-31', eos_date: '2026-08-31', successor: 'Catalyst 8300 / Catalyst SD-WAN',
  },

  // ─── Aviatrix ─────────────────────────────────────────────────────────────
  {
    id: 'aviatrix-gw', model: 'Aviatrix Gateway (c5.xlarge)', vendor: 'Aviatrix', subLayer: 'cloud-gw',
    ports: 0, uplinks: 0, speed: '10G', asic: 'Software', powerW: 0, priceUSD: 4200,
    features: ['BGP','IPSec','SNAT','DNAT','FireNet','TGW'], useCases: ['aviatrix','multicloud'],
    detail: 'Cloud-native gateway, AWS/Azure/GCP',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'aviatrix-transit', model: 'Aviatrix Transit GW (c5.2xlarge)', vendor: 'Aviatrix', subLayer: 'cloud-transit',
    ports: 0, uplinks: 0, speed: '25G', asic: 'Software', powerW: 0, priceUSD: 9800,
    features: ['BGP','EVPN','Segmentation','FireNet','TGW'], useCases: ['aviatrix','multicloud'],
    detail: 'Cloud transit, multi-cloud meshing',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── Firewalls / Security ─────────────────────────────────────────────────
  {
    id: 'ftd4145', model: 'Firepower 4145 NGFW', vendor: 'Cisco', subLayer: 'firewall',
    ports: 8, uplinks: 0, speed: '40G', asic: 'Liqid', powerW: 800, priceUSD: 65000,
    features: ['IPS','AVC','TLS-decrypt','AMP','HA'], useCases: ['campus','dc','multisite','multicloud'],
    detail: '8x40G, 80Gbps FW throughput, HA pair',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'panos-pa5260', model: 'PA-5260 NGFW', vendor: 'Palo Alto', subLayer: 'firewall',
    ports: 16, uplinks: 0, speed: '100G', asic: 'CN-Series', powerW: 1100, priceUSD: 120000,
    features: ['IPS','URL-filter','GlobalProtect','TLS-decrypt','HA'], useCases: ['campus','dc','multicloud'],
    detail: '16x100G, 200Gbps threat prevention',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── IOS-XR SP/MPLS ───────────────────────────────────────────────────────
  {
    id: 'asr9001', model: 'ASR 9001', vendor: 'Cisco', subLayer: 'pe-router',
    ports: 24, uplinks: 0, speed: '10G', asic: 'nPower', powerW: 1200, priceUSD: 45000,
    features: ['MPLS','SR-MPLS','BGP-VPNv4','IS-IS','BFD','TE'], useCases: ['sp_mpls'],
    detail: '24x10G SFP+, nPower ASIC, SR-MPLS PE, 200Gbps',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'asr9006', model: 'ASR 9006', vendor: 'Cisco', subLayer: 'pe-router',
    ports: 96, uplinks: 0, speed: '100G', asic: 'nPower/CRS', powerW: 3200, priceUSD: 120000,
    features: ['MPLS','SR-MPLS','BGP-VPNv4','IS-IS','BFD','TE','EVPN'], useCases: ['sp_mpls','multicloud'],
    detail: '6-slot chassis, up to 96x100G, SR-MPLS, BGP EVPN',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'ncs5501', model: 'NCS 5501', vendor: 'Cisco', subLayer: 'p-router',
    ports: 48, uplinks: 6, uplink_speed_gbps: 100,
    speed: '25G', asic: 'Jericho', powerW: 650, priceUSD: 55000,
    features: ['MPLS','SR-MPLS','IS-IS','BFD','RSVP-TE'], useCases: ['sp_mpls'],
    detail: '48x25G SFP28 + 6x100G QSFP28, Jericho ASIC, SR-MPLS P-router',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'ncs5502', model: 'NCS 5502', vendor: 'Cisco', subLayer: 'p-router',
    ports: 48, uplinks: 0, speed: '100G', asic: 'Jericho+', powerW: 1800, priceUSD: 95000,
    features: ['MPLS','SR-MPLS','IS-IS','BFD','FlowSpec','RSVP-TE'], useCases: ['sp_mpls'],
    detail: '48x100G QSFP28, Jericho+ ASIC, 4.8Tbps',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── Private 5G / O-RAN ───────────────────────────────────────────────────
  {
    id: 'oran-fh-sw', model: 'Nexus 3264Q-B2 (O-RAN FH)', vendor: 'Cisco', subLayer: 'fronthaul',
    ports: 64, uplinks: 8, uplink_speed_gbps: 100,
    speed: '25G', asic: 'Cloud Scale', powerW: 350, priceUSD: 18000,
    features: ['PTP','eCPRI','SyncE','LLDP','QoS','VLAN'], useCases: ['private_5g'],
    detail: '64x25G SFP28 + 8x100G, PTP/IEEE 1588v2, SyncE, eCPRI fronthaul',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'oran-mh-rtr', model: 'ASR 1001-X (O-RAN MH)', vendor: 'Cisco', subLayer: 'midhaul',
    ports: 8, uplinks: 0, speed: '10G', asic: 'QuantumFlow', powerW: 350, priceUSD: 22000,
    features: ['MPLS','PTP','SyncE','BGP','QoS','FlexE'], useCases: ['private_5g'],
    detail: '8x10G SFP+, midhaul transport, PTP Boundary Clock, 20Gbps',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── Storage Networking ───────────────────────────────────────────────────
  {
    id: 'mds9396t', model: 'MDS 9396T', vendor: 'Cisco', subLayer: 'storage-fabric',
    ports: 96, uplinks: 0, speed: '32G', asic: 'SAN Scale', powerW: 850, priceUSD: 35000,
    features: ['FC','FCoE','NVMe-FC','FCIP','iSCSI','VSAN'], useCases: ['storage'],
    detail: '96x32G FC, NVMe/FC, VSAN, SmartZoning, FCIP gateway',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'nxos-93600cd', model: 'Nexus 93600CD-GX', vendor: 'Cisco', subLayer: 'storage-leaf',
    ports: 28, uplinks: 8, uplink_speed_gbps: 400,
    speed: '100G', asic: 'Cloud Scale GX', powerW: 1200, priceUSD: 65000,
    features: ['NVMe-oF','RoCEv2','PFC','ECN','iSCSI','VXLAN','RDMA'], useCases: ['storage'],
    detail: '28x100G + 8x400G QSFP-DD, NVMe-oF over RoCEv2/TCP/FC',
    eol_date: null, eos_date: null, successor: null,
  },

  // ─── SD-WAN Controllers ───────────────────────────────────────────────────
  {
    id: 'sdwan-vsmart', model: 'Catalyst SD-WAN vSmart', vendor: 'Cisco', subLayer: 'sdwan-controller',
    ports: 0, uplinks: 0, speed: '10G', asic: 'Software', powerW: 0, priceUSD: 12000,
    features: ['OMP','SD-WAN','PolicyEngine','TLS','DTLS','ZTP'], useCases: ['wan','multisite'],
    detail: 'SD-WAN control plane, OMP routing policy, 5000 vEdge capacity',
    eol_date: null, eos_date: null, successor: null,
  },
  {
    id: 'sdwan-vbond', model: 'Catalyst SD-WAN vBond', vendor: 'Cisco', subLayer: 'sdwan-orchestrator',
    ports: 0, uplinks: 0, speed: '1G', asic: 'Software', powerW: 0, priceUSD: 5000,
    features: ['NAT-traversal','SD-WAN','DTLS','ZTP','Bootstrap'], useCases: ['wan','multisite'],
    detail: 'SD-WAN orchestrator, NAT traversal, WAN Edge zero-touch onboarding',
    eol_date: null, eos_date: null, successor: null,
  },
];

export const LAYER_PAIRS: Record<string, string[]> = {
  dc:         ['spine-leaf'],
  gpu:        ['spine-leaf'],
  campus:     ['distribution-access', 'core-distribution'],
  wan:        ['wan-edge', 'sdwan-controller'],
  multisite:  ['spine-leaf', 'wan-edge'],
  multicloud: ['cloud-gw', 'cloud-transit'],
  aviatrix:   ['cloud-gw', 'cloud-transit'],
  sp_mpls:    ['pe-router', 'p-router'],
  private_5g: ['fronthaul', 'midhaul'],
  storage:    ['storage-fabric', 'storage-leaf'],
};

export type ScaleSize = 'small' | 'medium' | 'large';

export const SCALE_DEFS: Record<ScaleSize, Record<string, Record<string, number>>> = {
  small: {
    dc:         { spine: 2, leaf: 4 },
    gpu:        { spine: 2, leaf: 4 },
    campus:     { distribution: 2, access: 4 },
    wan:        { 'wan-edge': 2, 'sdwan-controller': 1, 'sdwan-orchestrator': 1 },
    multisite:  { spine: 2, leaf: 4, 'wan-edge': 2 },
    multicloud: { 'cloud-transit': 1, 'cloud-gw': 2 },
    aviatrix:   { 'cloud-transit': 1, 'cloud-gw': 2 },
    sp_mpls:    { 'pe-router': 2, 'p-router': 2 },
    private_5g: { fronthaul: 4, midhaul: 2 },
    storage:    { 'storage-fabric': 2, 'storage-leaf': 4 },
  },
  medium: {
    dc:         { spine: 4, leaf: 8, firewall: 2 },
    gpu:        { spine: 4, leaf: 8 },
    campus:     { distribution: 4, access: 12, firewall: 2 },
    wan:        { 'wan-edge': 4, 'sdwan-controller': 2, 'sdwan-orchestrator': 1 },
    multisite:  { spine: 4, leaf: 8, 'wan-edge': 4, firewall: 2 },
    multicloud: { 'cloud-transit': 2, 'cloud-gw': 4 },
    aviatrix:   { 'cloud-transit': 2, 'cloud-gw': 4 },
    sp_mpls:    { 'pe-router': 4, 'p-router': 4 },
    private_5g: { fronthaul: 8, midhaul: 4 },
    storage:    { 'storage-fabric': 4, 'storage-leaf': 8 },
  },
  large: {
    dc:         { spine: 8, leaf: 24, firewall: 4 },
    gpu:        { spine: 8, leaf: 16 },
    campus:     { distribution: 8, access: 32, firewall: 4 },
    wan:        { 'wan-edge': 8, 'sdwan-controller': 2, 'sdwan-orchestrator': 2 },
    multisite:  { spine: 8, leaf: 24, 'wan-edge': 8, firewall: 4 },
    multicloud: { 'cloud-transit': 4, 'cloud-gw': 8 },
    aviatrix:   { 'cloud-transit': 4, 'cloud-gw': 8 },
    sp_mpls:    { 'pe-router': 8, 'p-router': 8 },
    private_5g: { fronthaul: 16, midhaul: 8 },
    storage:    { 'storage-fabric': 8, 'storage-leaf': 16 },
  },
};

const PREFERRED_PRODUCTS_CISCO: Record<string, Record<string, string>> = {
  dc:         { spine: 'nxos-9336c', leaf: 'nxos-93180yc', firewall: 'ftd4145' },
  gpu:        { spine: 'nxos-9364c', leaf: 'nxos-9332c' },
  campus:     { distribution: 'cat9500', access: 'cat9200', firewall: 'ftd4145' },
  wan:        { 'wan-edge': 'asr1002hx', 'sdwan-controller': 'sdwan-vsmart', 'sdwan-orchestrator': 'sdwan-vbond' },
  multisite:  { spine: 'nxos-9336c', leaf: 'nxos-93180yc', 'wan-edge': 'asr1002hx', firewall: 'ftd4145' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  aviatrix:   { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
  sp_mpls:    { 'pe-router': 'asr9001', 'p-router': 'ncs5501' },
  private_5g: { fronthaul: 'oran-fh-sw', midhaul: 'oran-mh-rtr' },
  storage:    { 'storage-fabric': 'mds9396t', 'storage-leaf': 'nxos-93600cd' },
};

const PREFERRED_PRODUCTS_ARISTA: Record<string, Record<string, string>> = {
  dc:         { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  gpu:        { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  campus:     { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  multisite:  { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  wan:        { spine: 'arista-7800r3', leaf: 'arista-7050cx3' },
  multicloud: { 'cloud-transit': 'aviatrix-transit', 'cloud-gw': 'aviatrix-gw' },
};

const PREFERRED_PRODUCTS_JUNIPER: Record<string, Record<string, string>> = {
  dc:        { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  gpu:       { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  campus:    { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120' },
  multisite: { spine: 'juniper-qfx10002', leaf: 'juniper-qfx5120', 'wan-edge': 'asr1002hx' },
};

export function getPreferredProducts(
  useCase: string,
  vendors: string[],
): Record<string, string> {
  const primary = (vendors[0] ?? 'cisco').toLowerCase();
  const map =
    primary === 'arista'  ? PREFERRED_PRODUCTS_ARISTA :
    primary === 'juniper' ? PREFERRED_PRODUCTS_JUNIPER :
    PREFERRED_PRODUCTS_CISCO;
  const UC_ALIAS: Record<string, string> = { dc_fabric: 'dc', gpu_cluster: 'gpu' };
  const uc = UC_ALIAS[useCase] ?? useCase;
  return map[uc] ?? PREFERRED_PRODUCTS_CISCO[uc] ?? PREFERRED_PRODUCTS_CISCO.dc;
}

export function lookupProduct(id: string, products: Product[] = PRODUCTS): Product | null {
  return products.find((p) => p.id === id) ?? null;
}

export type LifecycleStatus = 'eol' | 'eos' | 'eol-soon' | 'active';

export function getLifecycleStatus(product: Product, today = new Date()): LifecycleStatus {
  const todayMs = today.getTime();
  const eolMs   = product.eol_date ? new Date(product.eol_date).getTime() : null;
  const eosMs   = product.eos_date ? new Date(product.eos_date).getTime() : null;
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  if (eolMs !== null && todayMs >= eolMs) return 'eol';
  if (eosMs !== null && todayMs >= eosMs) return 'eos';
  if (eolMs !== null && eolMs - todayMs <= ninetyDays) return 'eol-soon';
  return 'active';
}

// Re-exported for use by bom.ts
export { PREFERRED_PRODUCTS_CISCO };

export function getScaleSize(intent: IntentObject): ScaleSize {
  const count = intent.topology.endpoint_count;
  if (count <= 100) return 'small';
  if (count <= 500) return 'medium';
  return 'large';
}
