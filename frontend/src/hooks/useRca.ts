import { useMutation } from '@tanstack/react-query'
import { runRca } from '@/api/client'
import type { RcaHypothesis } from '@/types'

interface RcaRequest {
  symptom: string
  devices: string[]
  designId?: string
}

export function useRunRca() {
  return useMutation<RcaHypothesis[], Error, RcaRequest>({
    mutationFn: ({ symptom, devices, designId }) =>
      runRca(symptom, devices, designId),
  })
}
