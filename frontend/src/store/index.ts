/**
 * Zustand global store — replaces the global STATE object from state.js.
 * Each slice is a logical unit; slices are composed into one store.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DesignState, Deployment, Alert, RcaHypothesis, DeployEvent } from '@/types'

// ── Design slice ─────────────────────────────────────────────────────────────

interface DesignSlice {
  design: DesignState
  setDesign: (patch: Partial<DesignState>) => void
  resetDesign: () => void
}

const defaultDesign: DesignState = {
  uc: 'enterprise',
  orgName: 'My Network',
  orgSize: 'medium',
  redundancy: 'ha',
  fwModel: null,
  selectedProducts: {},
  protocols: [],
  security: [],
  compliance: [],
  vlans: [],
  appFlows: [],
  include_bgp_policy: true,
  include_acl: true,
  include_dot1x: true,
  include_qos: true,
  include_aaa: true,
}

// ── Deploy slice ─────────────────────────────────────────────────────────────

interface DeploySlice {
  deploymentId: string | null
  deployEvents: DeployEvent[]
  deployStatus: 'idle' | 'pre_checks' | 'deploying' | 'post_checks' | 'done' | 'failed'
  deployments: Deployment[]
  setDeploymentId: (id: string | null) => void
  addDeployEvent: (event: DeployEvent) => void
  clearDeployEvents: () => void
  setDeployStatus: (s: DeploySlice['deployStatus']) => void
  setDeployments: (d: Deployment[]) => void
}

// ── Observability slice ───────────────────────────────────────────────────────

interface ObsSlice {
  alerts: Alert[]
  rcaResults: RcaHypothesis[]
  setAlerts: (a: Alert[]) => void
  setRcaResults: (r: RcaHypothesis[]) => void
}

// ── Auth slice ────────────────────────────────────────────────────────────────

interface AuthSlice {
  token: string | null
  role: string | null
  setAuth: (token: string, role: string) => void
  clearAuth: () => void
}

// ── Combined store ────────────────────────────────────────────────────────────

type Store = DesignSlice & DeploySlice & ObsSlice & AuthSlice

export const useStore = create<Store>()(
  persist(
    (set) => ({
      // Design
      design: defaultDesign,
      setDesign: (patch) => set((s) => ({ design: { ...s.design, ...patch } })),
      resetDesign: () => set({ design: defaultDesign }),

      // Deploy
      deploymentId: null,
      deployEvents: [],
      deployStatus: 'idle',
      deployments: [],
      setDeploymentId: (id) => set({ deploymentId: id }),
      addDeployEvent:  (ev) => set((s) => ({ deployEvents: [...s.deployEvents, ev] })),
      clearDeployEvents: () => set({ deployEvents: [], deployStatus: 'idle', deploymentId: null }),
      setDeployStatus: (status) => set({ deployStatus: status }),
      setDeployments: (deployments) => set({ deployments }),

      // Observability
      alerts: [],
      rcaResults: [],
      setAlerts: (alerts) => set({ alerts }),
      setRcaResults: (rcaResults) => set({ rcaResults }),

      // Auth
      token: null,
      role: null,
      setAuth: (token, role) => set({ token, role }),
      clearAuth: () => set({ token: null, role: null }),
    }),
    {
      name: 'netdesign-store',
      // Only persist design + auth — deploy state is ephemeral
      partialize: (s) => ({ design: s.design, token: s.token, role: s.role }),
    },
  ),
)

// Typed selectors for common access patterns
export const selectDesign     = (s: Store) => s.design
export const selectDeployFlow = (s: Store) => ({
  deploymentId: s.deploymentId,
  deployEvents: s.deployEvents,
  deployStatus: s.deployStatus,
})
export const selectAlerts     = (s: Store) => s.alerts
export const selectRca        = (s: Store) => s.rcaResults
export const selectAuth       = (s: Store) => ({ token: s.token, role: s.role })
