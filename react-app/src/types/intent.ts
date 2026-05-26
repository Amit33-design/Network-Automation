// Intent Object — mirrors CLAUDE.md §3 schema exactly
// All domain functions take IntentObject, return plain data — no React deps

export type UseCaseType =
  | 'campus'
  | 'dc_fabric'
  | 'gpu_cluster'
  | 'hybrid'
  | 'wan'
  | 'dci'
  | 'multicloud'
  | 'sp_mpls'
  | 'private_5g'
  | 'storage';

export type VendorType =
  | 'cisco'
  | 'arista'
  | 'juniper'
  | 'nvidia'
  | 'fortinet'
  | 'hpe'
  | 'dell'
  | 'extreme';

export type RedundancyType = 'none' | 'basic' | 'ha' | 'full';
export type TrafficPatternType = 'ns' | 'ew' | 'both';
export type BandwidthGbps = 1 | 10 | 25 | 100 | 400;
export type UnderlayType = 'bgp' | 'ospf' | 'is-is' | 'eigrp' | 'static';
export type OverlayType = 'vxlan_evpn' | 'mpls_sr' | 'gre' | 'ipsec' | 'geneve' | 'none' | 'otv';
export type FirewallType = 'perimeter' | 'distributed' | 'microseg' | 'none';
export type VPNType = 'ikev2' | 'ssl' | 'ztna' | 'none';
export type LatencySLAType = 'best_effort' | 'low' | 'ultra_low';
export type AutomationType = 'manual' | 'ansible' | 'terraform' | 'netconf' | 'napalm' | 'nso';
export type GPUTransportType = 'ib' | 'rocev2' | 'none';
export type CloudProviderType = 'aws' | 'azure' | 'gcp';
export type BudgetTierType = 'low' | 'mid' | 'high' | 'enterprise';

export interface OrgConfig {
  name: string;
  size: string;
  sites: number;
  budget_tier: BudgetTierType | '';
}

export interface TopologyConfig {
  redundancy: RedundancyType;
  traffic_pattern: TrafficPatternType;
  endpoint_count: number;
  bandwidth_gbps: BandwidthGbps;
  oversubscription: number;
}

export interface ProtocolConfig {
  underlay: UnderlayType;
  overlay: OverlayType[];
  features: string[];
}

export interface SecurityConfig {
  firewall: FirewallType;
  vpn: VPNType;
  nac: string[];
  compliance: string[];
}

export interface ApplicationConfig {
  types: string[];
  latency_sla: LatencySLAType;
  automation: AutomationType;
}

export interface GPUConfig {
  transport: GPUTransportType;
  pfc: boolean;
  ecn_dcqcn: boolean;
  rail_optimized: boolean;
  nvlink: boolean;
}

export interface CloudConfig {
  providers: CloudProviderType[];
  topology: string;
  orchestration: 'native' | 'aviatrix';
}

export interface MulticastConfig {
  enabled: boolean;
  mode: 'sparse' | 'ssm' | 'bidir';
  rp_address: string;
  group_acl: string;
}

export interface BFDConfig {
  enabled: boolean;
  interval_ms: number;
  min_rx_ms: number;
  multiplier: number;
}

export interface ECMPConfig {
  enabled: boolean;
  max_paths: number;
  hash_algorithm: 'symmetric' | 'resilient' | 'default';
}

export interface IntentObject {
  use_case: UseCaseType;
  org: OrgConfig;
  vendors: VendorType[];
  industry: string;
  topology: TopologyConfig;
  protocols: ProtocolConfig;
  security: SecurityConfig;
  applications: ApplicationConfig;
  gpu: GPUConfig;
  cloud: CloudConfig;
  multicast?: MulticastConfig;
  bfd?: BFDConfig;
  ecmp?: ECMPConfig;
  policies?: unknown[];
}

export const DEFAULT_INTENT: IntentObject = {
  use_case: 'dc_fabric',
  org: { name: '', size: 'medium', sites: 1, budget_tier: '' },
  vendors: ['cisco'],
  industry: 'technology',
  topology: {
    redundancy: 'full',
    traffic_pattern: 'ew',
    endpoint_count: 100,
    bandwidth_gbps: 25,
    oversubscription: 3,
  },
  protocols: {
    underlay: 'bgp',
    overlay: ['vxlan_evpn'],
    features: ['bfd', 'ecmp'],
  },
  security: {
    firewall: 'perimeter',
    vpn: 'none',
    nac: [],
    compliance: [],
  },
  applications: {
    types: [],
    latency_sla: 'low',
    automation: 'ansible',
  },
  gpu: {
    transport: 'none',
    pfc: false,
    ecn_dcqcn: false,
    rail_optimized: false,
    nvlink: false,
  },
  cloud: {
    providers: [],
    topology: 'single_dc',
    orchestration: 'native',
  },
  policies: [],
};
