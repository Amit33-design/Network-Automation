// ── Use-case / scale enums ────────────────────────────────────────────────────

export type UseCase =
  | 'campus'
  | 'dc'
  | 'gpu'
  | 'wan'
  | 'multisite'
  | 'multicloud'
  | 'aviatrix'

export type AppType = 'voice' | 'video' | 'storage' | 'hpc' | 'internet'
export type Scale = 'small' | 'medium' | 'large'
export type Redundancy = 'single' | 'dual'
export type Compliance = 'QoS' | 'PCI' | 'HIPAA' | 'SOC2' | 'FedRAMP' | 'NIST_CSF' | 'ISO27001'
export type VpnType = '' | 'ipsec' | 'ssl' | 'ztna' | 'none'
export type RedundancyModel = 'none' | 'basic' | 'ha' | 'full'
export type TrafficPattern = 'ns' | 'ew' | 'both'
export type BandwidthPerServer = '1G' | '10G' | '25G' | '100G' | '400G'
export type UnderlayProtocol = 'ospf' | 'isis' | 'ebgp' | 'static'
export type OrgSize = '' | 'startup' | 'smb' | 'midmarket' | 'enterprise' | 'hyperscale'
export type BudgetTier = '' | 'smb' | 'mid' | 'enterprise' | 'hyperscale'
export type FirewallModel = '' | 'perimeter' | 'distributed' | 'microseg' | 'none'
export type DcTopology = 'hub-spoke' | 'full-mesh' | 'partial-mesh' | ''

// ── Product catalog ───────────────────────────────────────────────────────────

export interface Product {
  id: string
  model: string
  vendor: string
  subLayer: string
  ports: number
  uplinks: number
  speed: string
  asic: string
  powerW: number
  priceUSD: number
  features: string[]
  useCases: UseCase[]
  detail: string
}

// ── BOM device entry ──────────────────────────────────────────────────────────

export interface BOMDevice {
  id: string
  hostname: string
  role: string
  subLayer: string
  model: string
  vendor: string
  count: number
  unitPrice: number
  totalPrice: number
  speed: string
  ports: number
  uplinks?: number
  features: string[]
}

// ── Cabling entry ─────────────────────────────────────────────────────────────

export interface CableLink {
  id: string
  fromLayer: string
  toLayer: string
  fromDevice: string
  toDevice: string
  cableType: string
  speed: string
  lengthM: number
  quantity: number
  pricePerUnit: number
  totalPrice: number
}

// ── Optics entry ──────────────────────────────────────────────────────────────

export interface OpticsEntry {
  id: string
  linkGroup: string
  formFactor: string
  speed: string
  reach: string
  priceUSD: number
  quantity: number
  totalPrice: number
  vendor: string
  partNumber: string
}

// ── Link distances ────────────────────────────────────────────────────────────

export interface LinkDistances {
  'spine-leaf': number
  'dist-access': number
  'core-dist': number
  'wan-edge': number
  [key: string]: number
}

// ── App-wide state ────────────────────────────────────────────────────────────

export interface AppState {
  useCase: UseCase | ''
  appTypes: AppType[]
  siteName: string
  siteCode: string
  scale: Scale
  redundancy: Redundancy
  linkDistances: LinkDistances
  devices: BOMDevice[]
  cabling: CableLink[]
  optics: OpticsEntry[]
  configs: Record<string, string>
  ztpConfig: Record<string, unknown>
  policies: unknown[]
  preCheckScript: string
  postCheckScript: string
  prometheusAlerts: string
  grafanaDashboard: Record<string, unknown>
  ansiblePlaybook: Record<string, unknown>
  compliance: Compliance[]
  step: number
  // Step 1 — Organisation Details
  orgName: string
  orgSize: OrgSize
  budgetTier: BudgetTier
  vendorPrefs: string[]
  industry: string
  primaryContact: string
  // Custom policy rules (M-55)
  customPolicyRules: string
  // Active deploy sub-tab
  activeDeployTab: string
  // UI theme — light / dark mode
  theme: 'dark' | 'light'
  // Step 2 — Network Requirements
  trafficPattern: TrafficPattern
  totalEndpoints: number
  bandwidthPerServer: BandwidthPerServer
  oversubscription: number
  underlayProtocol: UnderlayProtocol
  overlayProtocols: string[]
  protoFeatures: string[]
  firewallModel: FirewallModel
  redundancyModel: RedundancyModel
  numSites: number
  vpnType: VpnType
  nacOptions: string[]
  additionalNotes: string
  policyBlocks: string[]
  // M-11: Multi-cloud fields
  cloudProviders: string[]
  dcTopology: DcTopology
  coloProvider: string
  dcEdgeVendor: string
  bgpAsn: string
  orgCidr: string
  aviatrixOptions: string[]
  // Demo topology tracking
  demoTopologyId: string
}

// ── Lab Demo API types ────────────────────────────────────────────────────────

export interface TopologySummary {
  total: number
  routers: number
  switches: number
  firewalls: number
  load_balancers: number
  gpu_firewalls: number
  gpu_servers: number
}

export interface TopologyDevice {
  name: string
  role: string
  platform: string
  management_ip: string
  model: string
  ztp_state: string
  tags: string[]
}

export interface ZTPEvent {
  device_name: string
  state: string
  message: string
  success: boolean
  timestamp: string
}

export interface ZTPResult {
  results: Record<string, string>
  events: ZTPEvent[]
  summary: {
    total_events: number
    online: number
    failed: number
  }
}

export interface CheckResult {
  device: string
  name: string
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'
  message: string
  remediation: string | null
}

export interface ChecksResult {
  phase: string
  results: CheckResult[]
}

export interface DeviceHealth {
  device_name: string
  role: string
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  metrics: { cpu: number; uptime_seconds: number; [key: string]: number }
  alerts: string[]
}

export interface MonitoringResult {
  health: Record<string, DeviceHealth>
  summary: {
    total: number
    healthy: number
    degraded: number
    down: number
    alerts: Array<{ device: string; alert: string }>
  }
}

// ── Observability (alerts / RCA) ──────────────────────────────────────────────

export interface Alert {
  id: string
  device: string
  severity: 'critical' | 'warning' | 'info'
  summary: string
  detail?: string
  timestamp: string
  resolved: boolean
}

export interface RcaHypothesis {
  rank: number
  cause: string
  confidence: number
  evidence: string[]
  remediation: string
}

// ── Deploy pipeline ───────────────────────────────────────────────────────────

export type DeployStage =
  | 'queued'
  | 'connecting'
  | 'pre_checks'
  | 'pushing_config'
  | 'post_checks'
  | 'done'
  | 'failed'

export interface DeployEvent {
  deployment_id: string
  stage: DeployStage
  device?: string
  message: string
  progress: number
  timestamp: string
}

export interface DesignState {
  useCase: string
  scale: string
  siteCode: string
  devices: BOMDevice[]
}

export interface DeployRequest {
  design_id?: string
  state?: DesignState
  target_devices?: string[]
}

export interface DeployResponse {
  deployment_id: string
  status: string
  started_at: number
}

export interface CheckResponse {
  phase: string
  ok: boolean
  results: CheckResult[]
}

// ── Design / Deployment records ───────────────────────────────────────────────

export interface Design {
  id: string
  name: string
  use_case: string
  state: DesignState
  created_at: string
  updated_at: string
}

export interface Deployment {
  id: string
  design_id: string
  status: string
  started_at: string
  finished_at?: string
  events: DeployEvent[]
}

// ── Demo topology catalog ─────────────────────────────────────────────────────

export interface DemoTopology {
  id: string
  label: string
  icon: string
  useCase: UseCase
  scale: Scale
  description: string
  siteCode: string
  siteName: string
  orgName: string
  trafficPattern: TrafficPattern
  underlayProtocol: UnderlayProtocol
  totalEndpoints: number
  devices: BOMDevice[]
  cabling: CableLink[]
  optics: OpticsEntry[]
}

// ── Metrics summary (gNMI simulator / Prometheus) ─────────────────────────────

export interface DeviceMetrics {
  cpu_util: number
  mem_util: number
  interface_errors_in: number
  interface_errors_out: number
  bgp_sessions_up: number
  bgp_prefixes_received: number
  pfc_drops: number
  throughput_mbps: number
}

export interface MetricsSummary {
  timestamp: string
  devices: Record<string, DeviceMetrics>
}
