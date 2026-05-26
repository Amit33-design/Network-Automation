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
export type Compliance = 'QoS' | 'PCI' | 'HIPAA' | 'SOC2'

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
