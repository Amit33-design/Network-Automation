import { useMutation } from '@tanstack/react-query'
import { runTroubleshoot } from '@/api/client'
import type { TroubleshootResult } from '@/types'

interface TroubleshootRequest {
  symptom: string
  devices: string[]
  platform: string
}

export function useTroubleshoot() {
  return useMutation<TroubleshootResult, Error, TroubleshootRequest>({
    mutationFn: ({ symptom, devices, platform }) =>
      runTroubleshoot(symptom, devices, platform),
  })
}
