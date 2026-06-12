import { useMutation } from '@tanstack/react-query'
import { checkConfigDrift } from '@/api/client'
import type { ConfigDriftResponse } from '@/types'

export interface ConfigDriftVars {
  configs: Record<string, string>
  deploymentId?: string
}

export function useConfigDrift() {
  return useMutation<ConfigDriftResponse, Error, ConfigDriftVars>({
    mutationFn: ({ configs, deploymentId }) => checkConfigDrift(configs, deploymentId),
  })
}
