// ── Domain types mirroring the backend Pydantic models ─────────────────────

export interface DesignState {
  uc: string
  orgName: string
  orgSize: 'small' | 'medium' | 'large'
  redundancy: 'none' | 'ha' | 'full'
  fwModel: string | null
  selectedProducts: Record<string, string>
  protocols: string[]
  security: string[]
  compliance: string[]
  vlans: Vlan[]
  appFlows: AppFlow[]
  include_bgp_policy: boolean
  include_acl: boolean
  include_dot1x: boolean
  include_qos: boolean
  include_aaa: boolean
}

export interface Vlan {
  id: number
  name: string
  description?: string
  subnet?: string
}

export interface AppFlow {
  name: string
  src: string
  dst: string
  protocol: string
  port?: number
}

export interface DeviceInventory {
  [hostId: string]: {
    hostname: string
    platform: string
    username: string
    password: string
    port?: number
  }
}

export interface DeployRequest {
  state: DesignState
  inventory: DeviceInventory
  dry_run: boolean
}

export interface CheckResult {
  host: string
  check: string
  passed: boolean
  detail: string
}

export interface CheckResponse {
  results: CheckResult[]
  all_passed: boolean
  duration_s: number
}

export interface AsyncDeployResponse {
  deployment_id: string
  status: 'queued'
  message: string
}

export interface SyncDeployResponse {
  results: Record<string, unknown>
  dry_run: boolean
  duration_s: number
  deployment_id: string
}

export type DeployResponse = AsyncDeployResponse | SyncDeployResponse

// ── Deploy stream event (WebSocket) ─────────────────────────────────────────

export type DeployStage = 'pre_checks' | 'deploy' | 'post_checks' | 'rollback' | 'error'
export type DeployStatus = 'running' | 'passed' | 'success' | 'failed' | 'terminal' | 'error'

export interface DeployEvent {
  deployment_id: string
  stage: DeployStage
  status: DeployStatus
  detail: string
  timestamp?: number
}

// ── Observability ────────────────────────────────────────────────────────────

export interface Alert {
  hostname: string
  check: string
  severity: 'critical' | 'warning' | 'info'
  message: string
  metric_value: number
  fired_at: number
}

export interface RcaHypothesis {
  root_cause: string
  confidence: number
  evidence: string[]
  blast_radius: string[]
  remediation_steps: string[]
  automation_available: boolean
  automation_playbook: string | null
}

// ── Design/Deployment persistence ────────────────────────────────────────────

export interface Design {
  id: string
  name: string
  use_case: string
  created_at: string
  updated_at: string
  owner_id: string
}

export interface Deployment {
  id: string
  design_id: string
  environment: string
  status: string
  triggered_by: string
  started_at: string
  completed_at: string | null
}
