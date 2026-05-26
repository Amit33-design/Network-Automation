import { useMutation } from '@tanstack/react-query'
import type { ChecksResult } from '@/types'

interface ChecksRequest {
  fail_devices?: Record<string, string[]>
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

export function useRunChecks(phase: 'pre' | 'post') {
  return useMutation<ChecksResult, Error, ChecksRequest>({
    mutationFn: (req: ChecksRequest) => postJSON(`/api/checks/${phase}`, req),
  })
}
