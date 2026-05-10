/**
 * Typed API client — wraps fetch with auth header injection and error handling.
 * Mirrors BackendClient in src/js/backend.js but fully typed.
 */
import type {
  CheckResponse,
  DeployRequest,
  DeployResponse,
  DesignState,
  Alert,
  RcaHypothesis,
  Design,
  Deployment,
} from '@/types'

const STORAGE_KEY = 'nd_backend_settings'

function loadSettings(): { backendUrl?: string; token?: string; liveMode?: boolean } {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  catch { return {} }
}

export function getBackendUrl(): string  { return loadSettings().backendUrl ?? '' }
export function getToken(): string       { return loadSettings().token ?? '' }
export function isLiveMode(): boolean    { return !!(loadSettings().liveMode && getBackendUrl()) }

function authHeaders(): Record<string, string> {
  const tok = getToken()
  return tok ? { Authorization: `Bearer ${tok}` } : {}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = getBackendUrl().replace(/\/$/, '') + path
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText })) as { detail?: string }
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

const get  = <T>(path: string)              => request<T>('GET',  path)
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body)
const put  = <T>(path: string, body: unknown) => request<T>('PUT',  path, body)
const del  = <T>(path: string)              => request<T>('DELETE', path)

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const url = getBackendUrl().replace(/\/$/, '') + '/api/auth/token'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error('Login failed')
  const data = await res.json() as { access_token: string; role: string }
  const s = loadSettings()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, token: data.access_token }))
  return data
}

// ── Config generation ─────────────────────────────────────────────────────────

export const generateConfigs = (state: DesignState) =>
  post<{ configs: Record<string, string>; generated_at: number }>('/api/generate-configs', state)

// ── Pre / Post checks ─────────────────────────────────────────────────────────

export const runPreChecks  = (req: DeployRequest) => post<CheckResponse>('/api/pre-checks', req)
export const runPostChecks = (req: DeployRequest) => post<CheckResponse>('/api/post-checks', req)

// ── Deploy ────────────────────────────────────────────────────────────────────

export const deploy = (req: DeployRequest) => post<DeployResponse>('/api/deploy', req)

// ── Designs ───────────────────────────────────────────────────────────────────

export const listDesigns   = (uc?: string) =>
  get<{ designs: Design[] }>(`/api/designs${uc ? `?use_case=${encodeURIComponent(uc)}` : ''}`)
export const fetchDesign   = (id: string) => get<Design>(`/api/designs/${id}`)
export const createDesign  = (body: { name: string; use_case: string; state: DesignState }) =>
  post<Design>('/api/designs', body)
export const updateDesign  = (id: string, body: Partial<Design>) => put<Design>(`/api/designs/${id}`, body)
export const deleteDesign  = (id: string) => del<null>(`/api/designs/${id}`)

// ── Deployments ───────────────────────────────────────────────────────────────

export const listDeployments    = (designId?: string) =>
  get<{ deployments: Deployment[] }>(`/api/deployments${designId ? `?design_id=${designId}` : ''}`)
export const rollbackDeployment = (id: string) => post<{ ok: boolean }>(`/api/deployments/${id}/rollback`, {})

// ── Observability ─────────────────────────────────────────────────────────────

export const fetchAlerts = () => get<Alert[]>('/api/alerts')

export const runRca = (symptom: string, affectedDevices: string[], designId?: string) =>
  post<RcaHypothesis[]>('/api/rca/analyze', { symptom, affected_devices: affectedDevices, design_id: designId })

// ── WebSocket deploy stream ───────────────────────────────────────────────────

export type StreamCallback = (event: import('@/types').DeployEvent) => void

export function openDeployStream(
  deploymentId: string,
  onEvent: StreamCallback,
  onClose?: () => void,
  onError?: (err: Event) => void,
): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base  = getBackendUrl().replace(/^https?/, proto.slice(0, -1)).replace(/\/$/, '')
  const url   = `${base}/ws/deploy/${deploymentId}`
  const ws    = new WebSocket(url)

  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data as string) as import('@/types').DeployEvent
      if ((payload as { type?: string }).type === 'ping') return
      onEvent(payload)
    } catch { /* non-JSON keepalive */ }
  }
  ws.onclose = () => onClose?.()
  ws.onerror = (err) => onError?.(err)
  return ws
}
