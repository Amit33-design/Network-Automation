import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, UseCase, AppType, Scale, Redundancy, Compliance, BOMDevice, CableLink, OpticsEntry } from '@/types'

interface AppStore extends AppState {
  // Navigation
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  showLanding: boolean
  startProject: () => void
  goHome: () => void

  // Step 1 setters
  setUseCase: (useCase: UseCase | '') => void
  setAppTypes: (types: AppType[]) => void
  setSiteName: (name: string) => void
  setSiteCode: (code: string) => void
  setScale: (scale: Scale) => void
  setRedundancy: (r: Redundancy) => void
  setCompliance: (c: Compliance[]) => void
  setLinkDistance: (key: string, metres: number) => void
  setBudget: (budget: number | null) => void

  // Design computed results
  setDevices: (devices: BOMDevice[]) => void
  setCabling: (cabling: CableLink[]) => void
  setOptics: (optics: OpticsEntry[]) => void
  setConfigs: (configs: Record<string, string>) => void

  // Scripts / outputs
  setPreCheckScript: (s: string) => void
  setPostCheckScript: (s: string) => void
  setPrometheusAlerts: (s: string) => void

  reset: () => void
}

const DEFAULT_STATE: AppState = {
  useCase: '',
  appTypes: [],
  siteName: '',
  siteCode: '',
  budget: null,
  scale: 'small',
  redundancy: 'dual',
  linkDistances: {
    'spine-leaf': 100,
    'dist-access': 50,
    'core-dist': 200,
    'wan-edge': 5000,
  },
  devices: [],
  cabling: [],
  optics: [],
  configs: {},
  ztpConfig: {},
  policies: [],
  preCheckScript: '',
  postCheckScript: '',
  prometheusAlerts: '',
  grafanaDashboard: {},
  ansiblePlaybook: {},
  compliance: [],
  step: 1,
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      showLanding: true,

      setStep: step => set({ step }),
      nextStep: () => set(s => ({ step: Math.min(s.step + 1, 6) })),
      prevStep: () => set(s => ({ step: Math.max(s.step - 1, 1) })),
      startProject: () => set({ showLanding: false, step: 1 }),
      goHome: () => set({ showLanding: true, step: 1 }),

      setUseCase: useCase => set({ useCase }),
      setAppTypes: appTypes => set({ appTypes }),
      setSiteName: siteName => set({ siteName }),
      setSiteCode: siteCode => set({ siteCode }),
      setScale: scale => set({ scale }),
      setRedundancy: redundancy => set({ redundancy }),
      setCompliance: compliance => set({ compliance }),
      setLinkDistance: (key, metres) =>
        set(s => ({ linkDistances: { ...s.linkDistances, [key]: metres } })),
      setBudget: budget => set({ budget }),

      setDevices: devices => set({ devices }),
      setCabling: cabling => set({ cabling }),
      setOptics: optics => set({ optics }),
      setConfigs: configs => set({ configs }),

      setPreCheckScript: preCheckScript => set({ preCheckScript }),
      setPostCheckScript: postCheckScript => set({ postCheckScript }),
      setPrometheusAlerts: prometheusAlerts => set({ prometheusAlerts }),

      reset: () => set(DEFAULT_STATE),
    }),
    { name: 'netdesign-app-state' }
  )
)
