import { useQuery } from '@tanstack/react-query'
import { fetchAlerts, isLiveMode } from '@/api/client'

export function useAlerts(enabled = true) {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    refetchInterval: 30_000,
    enabled: enabled && isLiveMode(),
  })
}
