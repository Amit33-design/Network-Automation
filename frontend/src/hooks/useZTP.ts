import { useMutation } from '@tanstack/react-query'
import type { ZTPResult } from '@/types'

interface ZTPRequest {
  fail_device?: string
  fail_at?: string
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

export function useRunZTP() {
  return useMutation<ZTPResult, Error, ZTPRequest>({
    mutationFn: (req: ZTPRequest) => postJSON('/api/ztp/run', req),
  })
}
