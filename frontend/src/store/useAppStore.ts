import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppState, UseCase, AppType, Scale, Redundancy, Compliance, BOMDevice, CableLink, OpticsEntry,
  OrgSize, BudgetTier, TrafficPattern, BandwidthPerServer, UnderlayProtocol, FirewallModel, RedundancyModel,
  VpnType, DcTopology, DemoTopology, NetBoxImportedDevice,
} from '@/types'

interface AppStore extends AppState {
  // Navigation
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void

  // Step 1 setters — site / org
  setUseCase: (useCase: UseCase | '') => void
  setAppTypes: (types: AppType[]) => void
  setSiteName: (name: string) => void
  setSiteCode: (code: string) => void
  setScale: (scale: Scale) => void
  setRedundancy: (r: Redundancy) => void
  setCompliance: (c: Compliance[]) => void
  setLinkDistance: (key: string, metres: number) => void
  setOrgName: (name: string) => void
  setOrgSize: (size: OrgSize) => void
  setBudgetTier: (tier: BudgetTier) => void
  setVendorPrefs: (prefs: string[]) => void
  setIndustry: (industry: string) => void
  setPrimaryContact: (contact: string) => void
  // B1 — NetBox/Nautobot imported inventory
  setNetboxDevices: (devices: NetBoxImportedDevice[]) => void
  // M-55
  setCustomPolicyRules: (rules: string) => void
  setActiveDeployTab: (tab: string) => void
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void

  // Step 2 setters — requirements
  setTrafficPattern: (p: TrafficPattern) => void
  setTotalEndpoints: (n: number) => void
  setBandwidthPerServer: (b: BandwidthPerServer) => void
  setOversubscription: (r: number) => void
  setUnderlayProtocol: (p: UnderlayProtocol) => void
  setOverlayProtocols: (o: string[]) => void
  setProtoFeatures: (f: string[]) => void
  setFirewallModel: (m: FirewallModel) => void
  setRedundancyModel: (m: RedundancyModel) => void
  setNumSites: (n: number) => void
  setVpnType: (v: VpnType) => void
  setNacOptions: (o: string[]) => void
  setAdditionalNotes: (n: string) => void
  // M-11: Multi-cloud setters
  setCloudProviders: (providers: string[]) => void
  setDcTopology: (topology: DcTopology) => void
  setColoProvider: (provider: string) => void
  setDcEdgeVendor: (vendor: string) => void
  setBgpAsn: (asn: string) => void
  setOrgCidr: (cidr: string) => void
  setAviatrixOptions: (options: string[]) => void

  // Design computed results
  setDevices: (devices: BOMDevice[]) => void
  setCabling: (cabling: CableLink[]) => void
  setOptics: (optics: OpticsEntry[]) => void
  setConfigs: (configs: Record<string, string>) => void

  // Scripts / outputs
  setPreCheckScript: (s: string) => void
  setPostCheckScript: (s: string) => void
  setPrometheusAlerts: (s: string) => void

  // Config policy blocks
  setPolicyBlocks: (blocks: string[]) => void

  // Demo topology loader
  demoTopologyId: string
  loadDemoTopology: (t: DemoTopology) => void

  reset: () => void
}

const DEFAULT_STATE: AppState = {
  useCase: '',
  appTypes: [],
  siteName: '',
  siteCode: '',
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
  // Step 1 — Organisation Details
  orgName: '',
  orgSize: '',
  budgetTier: '',
  vendorPrefs: [],
  industry: '',
  primaryContact: '',
  customPolicyRules: '',
  activeDeployTab: 'deploy',
  theme: 'dark',
  // Step 2 — Network Requirements
  trafficPattern: 'ew',
  totalEndpoints: 500,
  bandwidthPerServer: '25G',
  oversubscription: 3,
  underlayProtocol: 'ospf',
  overlayProtocols: [],
  protoFeatures: [],
  firewallModel: '',
  redundancyModel: 'ha',
  numSites: 1,
  vpnType: '',
  nacOptions: [],
  additionalNotes: '',
  policyBlocks: [],
  // M-11: Multi-cloud fields
  cloudProviders: [],
  dcTopology: '',
  coloProvider: '',
  dcEdgeVendor: '',
  bgpAsn: '',
  orgCidr: '',
  aviatrixOptions: [],
  demoTopologyId: '',
  netboxDevices: [],
  _savedAt: Date.now(),
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setStep: step => set({ step }),
      nextStep: () => set(s => ({ step: Math.min(s.step + 1, 6) })),
      prevStep: () => set(s => ({ step: Math.max(s.step - 1, 1) })),

      setUseCase: useCase => set({ useCase, configs: {}, devices: [], cabling: [], optics: [] }),
      setAppTypes: appTypes => set({ appTypes }),
      setSiteName: siteName => set({ siteName }),
      setSiteCode: siteCode => set({ siteCode }),
      setScale: scale => set({ scale, configs: {} }),
      setRedundancy: redundancy => set({ redundancy }),
      setCompliance: compliance => set({ compliance }),
      setLinkDistance: (key, metres) =>
        set(s => ({ linkDistances: { ...s.linkDistances, [key]: metres } })),
      setOrgName: orgName => set({ orgName }),
      setOrgSize: orgSize => set({ orgSize }),
      setBudgetTier: budgetTier => set({ budgetTier }),
      // Vendor change invalidates generated configs so Step 3 regenerates them
      // for the newly-selected hardware instead of showing stale (e.g. Cisco) output.
      setVendorPrefs: vendorPrefs => set({ vendorPrefs, configs: {} }),
      setIndustry: industry => set({ industry }),
      setPrimaryContact: primaryContact => set({ primaryContact }),
      setNetboxDevices: netboxDevices => set({ netboxDevices }),
      setCustomPolicyRules: customPolicyRules => set({ customPolicyRules }),
      setActiveDeployTab: activeDeployTab => set({ activeDeployTab }),
      setTheme: theme => set({ theme }),
      toggleTheme: () => set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

      setTrafficPattern: trafficPattern => set({ trafficPattern }),
      setTotalEndpoints: totalEndpoints => set({ totalEndpoints }),
      setBandwidthPerServer: bandwidthPerServer => set({ bandwidthPerServer }),
      setOversubscription: oversubscription => set({ oversubscription }),
      setUnderlayProtocol: underlayProtocol => set({ underlayProtocol }),
      setOverlayProtocols: overlayProtocols => set({ overlayProtocols }),
      setProtoFeatures: protoFeatures => set({ protoFeatures }),
      setFirewallModel: firewallModel => set({ firewallModel }),
      setRedundancyModel: redundancyModel => set({ redundancyModel }),
      setNumSites: numSites => set({ numSites }),
      setVpnType: vpnType => set({ vpnType }),
      setNacOptions: nacOptions => set({ nacOptions }),
      setAdditionalNotes: additionalNotes => set({ additionalNotes }),
      // M-11: Multi-cloud setters
      setCloudProviders: cloudProviders => set({ cloudProviders }),
      setDcTopology: dcTopology => set({ dcTopology }),
      setColoProvider: coloProvider => set({ coloProvider }),
      setDcEdgeVendor: dcEdgeVendor => set({ dcEdgeVendor }),
      setBgpAsn: bgpAsn => set({ bgpAsn }),
      setOrgCidr: orgCidr => set({ orgCidr }),
      setAviatrixOptions: aviatrixOptions => set({ aviatrixOptions }),

      setDevices: devices => set({ devices }),
      setCabling: cabling => set({ cabling }),
      setOptics: optics => set({ optics }),
      setConfigs: configs => set({ configs }),

      setPreCheckScript: preCheckScript => set({ preCheckScript }),
      setPostCheckScript: postCheckScript => set({ postCheckScript }),
      setPrometheusAlerts: prometheusAlerts => set({ prometheusAlerts }),

      setPolicyBlocks: policyBlocks => set({ policyBlocks }),

      demoTopologyId: '',
      loadDemoTopology: (t: DemoTopology) => set({
        useCase: t.useCase,
        scale: t.scale,
        siteCode: t.siteCode,
        siteName: t.siteName,
        orgName: t.orgName,
        trafficPattern: t.trafficPattern,
        underlayProtocol: t.underlayProtocol,
        totalEndpoints: t.totalEndpoints,
        devices: t.devices,
        cabling: t.cabling,
        optics: t.optics,
        configs: {},
        demoTopologyId: t.id,
        step: 3,
      }),

      reset: () => set({ ...DEFAULT_STATE, _savedAt: Date.now() }),
    }),
    {
      name: 'netdesign-app-state',
      version: 2,
      migrate: () => ({ ...DEFAULT_STATE, _savedAt: Date.now() }) as never,
      partialize: (state) => ({
        useCase: state.useCase,
        appTypes: state.appTypes,
        siteName: state.siteName,
        siteCode: state.siteCode,
        scale: state.scale,
        redundancy: state.redundancy,
        linkDistances: state.linkDistances,
        compliance: state.compliance,
        step: state.step,
        orgName: state.orgName,
        orgSize: state.orgSize,
        budgetTier: state.budgetTier,
        vendorPrefs: state.vendorPrefs,
        industry: state.industry,
        primaryContact: state.primaryContact,
        customPolicyRules: state.customPolicyRules,
        activeDeployTab: state.activeDeployTab,
        theme: state.theme,
        trafficPattern: state.trafficPattern,
        totalEndpoints: state.totalEndpoints,
        bandwidthPerServer: state.bandwidthPerServer,
        oversubscription: state.oversubscription,
        underlayProtocol: state.underlayProtocol,
        overlayProtocols: state.overlayProtocols,
        protoFeatures: state.protoFeatures,
        firewallModel: state.firewallModel,
        redundancyModel: state.redundancyModel,
        numSites: state.numSites,
        vpnType: state.vpnType,
        nacOptions: state.nacOptions,
        additionalNotes: state.additionalNotes,
        policyBlocks: state.policyBlocks,
        cloudProviders: state.cloudProviders,
        dcTopology: state.dcTopology,
        coloProvider: state.coloProvider,
        dcEdgeVendor: state.dcEdgeVendor,
        bgpAsn: state.bgpAsn,
        orgCidr: state.orgCidr,
        aviatrixOptions: state.aviatrixOptions,
        demoTopologyId: state.demoTopologyId,
        netboxDevices: state.netboxDevices,
        _savedAt: Date.now(),
      }) as never,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (state._savedAt && Date.now() - state._savedAt > 7 * 24 * 60 * 60 * 1000) {
          state.reset()
        }
      },
    }
  )
)
