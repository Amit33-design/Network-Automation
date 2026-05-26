import { useQuery } from '@tanstack/react-query'
import { fetchAlerts, isLiveMode } from '@/api/client'
import { useStore } from '@/store'

export function useAlerts(enabled = true) {
  const setAlerts = useStore((s) => s.setAlerts)

  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const data = await fetchAlerts()
      setAlerts(data) // keep Zustand in sync for components that read the store directly
      return data
    },
    refetchInterval: 30_000,
    enabled: enabled && isLiveMode(),
  })
}
