import { useMutation } from '@tanstack/react-query'
import { runRca } from '@/api/client'
import { useStore } from '@/store'
import type { RcaHypothesis } from '@/types'

interface RcaRequest {
  symptom: string
  devices: string[]
}

export function useRunRca() {
  const setRcaResults = useStore((s) => s.setRcaResults)

  return useMutation<RcaHypothesis[], Error, RcaRequest>({
    mutationFn: ({ symptom, devices }) => runRca(symptom, devices),
    onSuccess: (data) => setRcaResults(data),
  })
}
