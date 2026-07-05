import { useMutation } from '@tanstack/react-query'
import { runRca, isLiveMode } from '@/api/client'
import { analyzeRca, type RcaDesignState } from '@/lib/rca'
import type { RcaHypothesis } from '@/types'

interface RcaRequest {
  symptom: string
  devices: string[]
  designId?: string
  design?: RcaDesignState
}

export function useRunRca() {
  return useMutation<RcaHypothesis[], Error, RcaRequest>({
    mutationFn: async ({ symptom, devices, designId, design }) => {
      // Demo mode (no backend): run the client-side RCA engine, like every
      // other Step 6 feature (§3). Live mode hits the real backend engine.
      if (!isLiveMode()) {
        return analyzeRca({ symptom, affectedDevices: devices, design })
      }
      return runRca(symptom, devices, designId)
    },
  })
}
