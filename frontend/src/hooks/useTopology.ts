import { useQuery } from '@tanstack/react-query'
import type { TopologySummary, TopologyDevice } from '@/types'

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function useTopologySummary() {
  return useQuery<TopologySummary>({
    queryKey: ['topology', 'summary'],
    queryFn: () => fetchJSON('/api/topology'),
    staleTime: 30_000,
  })
}

export function useTopologyDevices() {
  return useQuery<TopologyDevice[]>({
    queryKey: ['topology', 'devices'],
    queryFn: () => fetchJSON('/api/topology/devices'),
    staleTime: 30_000,
  })
}
