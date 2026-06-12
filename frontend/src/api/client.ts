/**
 * Typed API client — mirrors main branch api/client.ts, adapted for our stack.
 * All data fetching goes through TanStack Query hooks; this module provides
 * the raw async functions they call.
 */

// ── Settings ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nd_backend_settings'

interface BackendSettings {
  backendUrl?: string
  token?: string
  liveMode?: boolean
}

function loadSettings(): BackendSettings {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as BackendSettings }
  catch { return {} }
}

export function getBackendUrl(): string { return loadSettings().backendUrl ?? '' }
export function getToken(): string      { return loadSettings().token ?? '' }
export function isLiveMode(): boolean   { return !!(loadSettings().liveMode && getBackendUrl()) }

export function saveSettings(patch: Partial<BackendSettings>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...patch }))
}

function authHeaders(): Record<string, string> {
  const tok = getToken()
  return tok ? { Authorization: `Bearer ${tok}` } : {}
}

// ── Core request ──────────────────────────────────────────────────────────────

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = getBackendUrl().replace(/\/$/, '')
  const url  = base ? base + path : path          // fall back to relative URL
  const res  = await fetch(url, {
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

const get  = <T>(path: string)               => request<T>('GET',  path)
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body)
const put  = <T>(path: string, body: unknown) => request<T>('PUT',  path, body)
const del  = <T>(path: string)               => request<T>('DELETE', path)

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<{ token: string; role: string }> {
  const url = getBackendUrl().replace(/\/$/, '') + '/api/auth/token'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error('Login failed')
  const data = await res.json() as { access_token: string; role: string }
  saveSettings({ token: data.access_token })
  return { token: data.access_token, role: data.role }
}

// ── Observability ─────────────────────────────────────────────────────────────

import type { Alert, RcaHypothesis } from '@/types'

export const fetchAlerts = () => get<Alert[]>('/api/alerts')

export const runRca = (
  symptom: string,
  affectedDevices: string[],
  designId?: string,
) => post<RcaHypothesis[]>('/api/rca/analyze', {
  symptom,
  affected_devices: affectedDevices,
  design_id: designId,
})

// ── Intent NLP parser (G-A1) ──────────────────────────────────────────────────

import type { IntentParseResult } from '@/types'

export const parseIntent = (description: string) =>
  post<IntentParseResult>('/api/intent/parse', { description })

// ── Config drift detection (G-A4) ───────────────────────────────────────────────

import type { ConfigDriftResponse } from '@/types'

export const checkConfigDrift = (configs: Record<string, string>, deploymentId?: string) =>
  post<ConfigDriftResponse>('/api/drift/config', { configs, deployment_id: deploymentId })

// ── Config generation ─────────────────────────────────────────────────────────

import type { DesignState } from '@/types'

export const generateConfigs = (state: DesignState) =>
  post<{ configs: Record<string, string>; generated_at: number }>('/api/generate-configs', state)

// ── Pre / Post checks ─────────────────────────────────────────────────────────

import type { DeployRequest, CheckResponse } from '@/types'

export const runPreChecks  = (req: DeployRequest) => post<CheckResponse>('/api/pre-checks', req)
export const runPostChecks = (req: DeployRequest) => post<CheckResponse>('/api/post-checks', req)

// ── Deploy ────────────────────────────────────────────────────────────────────

import type { DeployResponse, Design, Deployment } from '@/types'

export const deploy = (req: DeployRequest) => post<DeployResponse>('/api/deploy', req)

export const listDesigns  = (uc?: string) =>
  get<{ designs: Design[] }>(`/api/designs${uc ? `?use_case=${encodeURIComponent(uc)}` : ''}`)
export const fetchDesign  = (id: string) => get<Design>(`/api/designs/${id}`)
export const createDesign = (body: { name: string; use_case: string; state: DesignState }) =>
  post<Design>('/api/designs', body)
export const updateDesign = (id: string, body: Partial<Design>) => put<Design>(`/api/designs/${id}`, body)
export const deleteDesign = (id: string) => del<null>(`/api/designs/${id}`)

export const listDeployments    = (designId?: string) =>
  get<{ deployments: Deployment[] }>(`/api/deployments${designId ? `?design_id=${designId}` : ''}`)
export const rollbackDeployment = (id: string) => post<{ ok: boolean }>(`/api/deployments/${id}/rollback`, {})

// ── WebSocket deploy stream ───────────────────────────────────────────────────

import type { DeployEvent } from '@/types'

export type StreamCallback = (event: DeployEvent) => void

export function openDeployStream(
  deploymentId: string,
  onEvent: StreamCallback,
  onClose?: () => void,
  onError?: (err: Event) => void,
): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base  = getBackendUrl().replace(/^https?/, proto.slice(0, -1)).replace(/\/$/, '')
  const ws    = new WebSocket(`${base}/ws/deploy/${deploymentId}`)

  ws.onmessage = (e) => {
    try {
      const payload = JSON.parse(e.data as string) as DeployEvent
      if ((payload as { type?: string }).type === 'ping') return
      onEvent(payload)
    } catch { /* non-JSON keepalive */ }
  }
  ws.onclose  = () => onClose?.()
  ws.onerror  = (err) => onError?.(err)
  return ws
}
