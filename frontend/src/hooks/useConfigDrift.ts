import { useMutation } from '@tanstack/react-query'
import { checkConfigDrift, generateRemediation } from '@/api/client'
import type { ConfigDriftResponse, ConfigRemediationResponse, RemediationDeviceInput } from '@/types'

export interface ConfigDriftVars {
  configs: Record<string, string>
  deploymentId?: string
}

export function useConfigDrift() {
  return useMutation<ConfigDriftResponse, Error, ConfigDriftVars>({
    mutationFn: ({ configs, deploymentId }) => checkConfigDrift(configs, deploymentId),
  })
}

// G-A16: turn detected drift into reviewable remediation commands.
export function useConfigRemediation() {
  return useMutation<ConfigRemediationResponse, Error, RemediationDeviceInput[]>({
    mutationFn: (devices) => generateRemediation(devices),
  })
}
