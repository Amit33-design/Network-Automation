import { useQuery, useMutation } from '@tanstack/react-query'
import type { MonitoringResult } from '@/types'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function useMonitoringPoll(enabled = false) {
  return useQuery<MonitoringResult>({
    queryKey: ['monitoring', 'poll'],
    queryFn: () => fetchJSON('/api/monitoring/poll'),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  })
}

interface MonitoringRequest {
  fail_devices?: Record<string, string[]>
}

export function usePollMonitoring() {
  return useMutation<MonitoringResult, Error, MonitoringRequest>({
    mutationFn: (req: MonitoringRequest) =>
      req.fail_devices && Object.keys(req.fail_devices).length > 0
        ? postJSON('/api/monitoring/poll', req)
        : fetchJSON('/api/monitoring/poll'),
  })
}
