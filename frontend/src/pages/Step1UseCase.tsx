import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { UseCase, AppType, Scale, Redundancy, Compliance } from '@/types'

const USE_CASES: Array<{ id: UseCase; label: string; icon: string; desc: string }> = [
  { id: 'campus',     icon: '🏢', label: 'Campus',      desc: 'Access/dist/core with PoE, QoS, SDA' },
  { id: 'dc',         icon: '🖥️',  label: 'Data Centre', desc: 'Spine-leaf with VXLAN/EVPN BGP' },
  { id: 'gpu',        icon: '🤖', label: 'GPU Cluster',  desc: 'AI/ML fabric with RoCE & PFC/ECN' },
  { id: 'wan',        icon: '🌐', label: 'WAN / SD-WAN', desc: 'Edge routers and SD-WAN gateways' },
  { id: 'multisite',  icon: '🔗', label: 'Multi-Site',   desc: 'Spine-leaf with WAN interconnect' },
  { id: 'multicloud', icon: '☁️',  label: 'Multi-Cloud',  desc: 'Cloud transit and spoke gateways' },
  { id: 'aviatrix',   icon: '🚀', label: 'Aviatrix',     desc: 'Cloud-native Aviatrix overlay mesh' },
]

const APP_TYPES: Array<{ id: AppType; label: string }> = [
  { id: 'voice',    label: 'Voice' },
  { id: 'video',    label: 'Video' },
  { id: 'storage',  label: 'Storage' },
  { id: 'hpc',      label: 'HPC' },
  { id: 'internet', label: 'Internet' },
]

const SCALES: Array<{ id: Scale; label: string; desc: string }> = [
  { id: 'small',  label: 'Small',  desc: 'Up to ~50 devices' },
  { id: 'medium', label: 'Medium', desc: 'Up to ~200 devices' },
  { id: 'large',  label: 'Large',  desc: '200+ devices' },
]

const COMPLIANCE_OPTIONS: Array<{ id: Compliance; label: string }> = [
  { id: 'QoS',   label: 'QoS' },
  { id: 'PCI',   label: 'PCI-DSS' },
  { id: 'HIPAA', label: 'HIPAA' },
  { id: 'SOC2',  label: 'SOC 2' },
]

export function Step1UseCase() {
  const {
    useCase, appTypes, siteName, siteCode, scale, redundancy, compliance, linkDistances,
    setUseCase, setAppTypes, setSiteName, setSiteCode, setScale, setRedundancy, setCompliance,
    setLinkDistance, nextStep,
  } = useAppStore()

  function toggleAppType(id: AppType) {
    setAppTypes(
      appTypes.includes(id) ? appTypes.filter(t => t !== id) : [...appTypes, id]
    )
  }

  function toggleCompliance(id: Compliance) {
    setCompliance(
      compliance.includes(id) ? compliance.filter(c => c !== id) : [...compliance, id]
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Select Use Case</h2>
        <p className="text-sm text-gray-400">Choose the network topology that matches your deployment</p>
      </div>

      {/* Use case tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {USE_CASES.map(uc => (
          <button
            key={uc.id}
            onClick={() => setUseCase(uc.id)}
            className={cn(
              'p-4 rounded-xl border text-left transition-all',
              useCase === uc.id
                ? 'border-blue-500 bg-blue-600/20 text-gray-100'
                : 'border-white/10 bg-white/5 text-gray-400 hover:border-white/30 hover:text-gray-200',
            )}
          >
            <div className="text-2xl mb-2">{uc.icon}</div>
            <div className="text-sm font-semibold">{uc.label}</div>
            <div className="text-xs text-gray-500 mt-1">{uc.desc}</div>
          </button>
        ))}
      </div>

      {/* Site info */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Site Information</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Site Name</label>
            <input
              type="text"
              value={siteName}
              onChange={e => setSiteName(e.target.value)}
              placeholder="e.g. Washington DC Datacenter"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Site Code (for hostnames)</label>
            <input
              type="text"
              value={siteCode}
              onChange={e => setSiteCode(e.target.value.toUpperCase().slice(0, 5))}
              placeholder="e.g. IAD"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </Card>

      {/* Scale + Redundancy */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Scale</h3>
          <div className="space-y-2">
            {SCALES.map(s => (
              <label key={s.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="radio"
                  name="scale"
                  value={s.id}
                  checked={scale === s.id}
                  onChange={() => setScale(s.id)}
                  className="accent-blue-500"
                />
                <div>
                  <div className="text-sm text-gray-200 group-hover:text-white">{s.label}</div>
                  <div className="text-xs text-gray-500">{s.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Redundancy</h3>
          <div className="space-y-2">
            {(['single', 'dual'] as Redundancy[]).map(r => (
              <label key={r} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="redundancy"
                  value={r}
                  checked={redundancy === r}
                  onChange={() => setRedundancy(r)}
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-200 capitalize">{r}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>

      {/* Link Distances */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Link Distances</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {([
            { key: 'spine-leaf',  label: 'Spine ↔ Leaf' },
            { key: 'dist-access', label: 'Dist ↔ Access' },
            { key: 'core-dist',   label: 'Core ↔ Dist' },
            { key: 'wan-edge',    label: 'WAN Edge' },
          ] as const).map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs text-gray-400 block mb-1">{label}</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={80000}
                  value={linkDistances[key]}
                  onChange={e => setLinkDistance(key, Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm
                             text-gray-200 focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-gray-500 whitespace-nowrap">m</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* App types */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Application Types (optional)</h3>
        <div className="flex flex-wrap gap-2">
          {APP_TYPES.map(at => (
            <button
              key={at.id}
              onClick={() => toggleAppType(at.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                appTypes.includes(at.id)
                  ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
              )}
            >
              {at.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Compliance */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Compliance Requirements (optional)</h3>
        <div className="flex flex-wrap gap-2">
          {COMPLIANCE_OPTIONS.map(c => (
            <button
              key={c.id}
              onClick={() => toggleCompliance(c.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                compliance.includes(c.id)
                  ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={nextStep} disabled={!useCase} size="lg">
          Next: Design →
        </Button>
      </div>
    </div>
  )
}
