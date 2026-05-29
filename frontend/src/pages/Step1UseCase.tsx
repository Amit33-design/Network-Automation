import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { UseCase, OrgSize, BudgetTier } from '@/types'

const USE_CASES: Array<{ id: UseCase; label: string; icon: string; desc: string }> = [
  { id: 'campus',     icon: '🏢', label: 'Campus',       desc: 'Access/dist/core with PoE, QoS, SDA' },
  { id: 'dc',         icon: '🖥️',  label: 'Data Centre',  desc: 'Spine-leaf with VXLAN/EVPN BGP' },
  { id: 'gpu',        icon: '🤖', label: 'GPU Cluster',   desc: 'AI/ML fabric with RoCE & PFC/ECN' },
  { id: 'wan',        icon: '🌐', label: 'WAN / SD-WAN',  desc: 'Edge routers and SD-WAN gateways' },
  { id: 'multisite',  icon: '🔗', label: 'Multi-Site',    desc: 'Spine-leaf with WAN interconnect' },
  { id: 'multicloud', icon: '☁️',  label: 'Multi-Cloud',   desc: 'Cloud transit and spoke gateways' },
  { id: 'aviatrix',   icon: '🚀', label: 'Aviatrix',      desc: 'Cloud-native Aviatrix overlay mesh' },
]

const VENDORS = ['Cisco', 'Fortinet', 'HPE Aruba', 'Arista', 'Juniper', 'Extreme Networks', 'Dell EMC', 'NVIDIA']

const INDUSTRIES: Array<{ icon: string; label: string }> = [
  { icon: '💰', label: 'Financial' },
  { icon: '🏥', label: 'Healthcare' },
  { icon: '🎓', label: 'Education' },
  { icon: '💻', label: 'Technology' },
  { icon: '🏗️', label: 'Manufacturing' },
  { icon: '🛒', label: 'Retail' },
  { icon: '🏛️', label: 'Government' },
  { icon: '📡', label: 'Media/Telecom' },
  { icon: '⚡', label: 'Energy' },
  { icon: '🔧', label: 'Other' },
]

interface Props {
  onBack?: () => void
}

export function Step1UseCase({ onBack }: Props) {
  const {
    useCase, orgName, orgSize, budgetTier, vendorPrefs, industry,
    setUseCase, setOrgName, setOrgSize, setBudgetTier, setVendorPrefs, setIndustry,
    nextStep,
  } = useAppStore()

  function toggleVendor(v: string) {
    setVendorPrefs(
      vendorPrefs.includes(v) ? vendorPrefs.filter(x => x !== v) : [...vendorPrefs, v]
    )
  }

  function toggleIndustry(label: string) {
    setIndustry(industry === label ? '' : label)
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
              'p-4 rounded-xl border text-left transition-all cursor-pointer',
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

      {/* Organisation Details */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Organisation Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Org Name</label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder="Acme Corporation"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Org Size</label>
            <select
              value={orgSize}
              onChange={e => setOrgSize(e.target.value as OrgSize)}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              <option value="">— select —</option>
              <option value="startup">Startup (&lt;50 employees)</option>
              <option value="smb">SMB (50-500)</option>
              <option value="midmarket">Mid-market (500-5000)</option>
              <option value="enterprise">Enterprise (5000+)</option>
              <option value="hyperscale">Hyperscale</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Budget Tier</label>
            <select
              value={budgetTier}
              onChange={e => setBudgetTier(e.target.value as BudgetTier)}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              <option value="">— any budget —</option>
              <option value="smb">SMB (&lt;$50K)</option>
              <option value="mid">Mid-market ($50K-$500K)</option>
              <option value="enterprise">Enterprise ($500K-$2M)</option>
              <option value="hyperscale">Hyperscale ($5M+)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Preferred Vendors */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-1">
          Preferred Vendors <span className="text-gray-500 font-normal">(optional)</span>
        </h3>
        <div className="flex flex-wrap gap-2 mt-3">
          {VENDORS.map(v => (
            <button
              key={v}
              onClick={() => toggleVendor(v)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                vendorPrefs.includes(v)
                  ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </Card>

      {/* Industry */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Industry</h3>
        <div className="flex flex-wrap gap-2">
          {INDUSTRIES.map(ind => (
            <button
              key={ind.label}
              onClick={() => toggleIndustry(ind.label)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                industry === ind.label
                  ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
              )}
            >
              {ind.icon} {ind.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>← Back</Button>
        ) : (
          <span />
        )}
        <Button onClick={nextStep} disabled={!useCase} size="lg">
          Continue →
        </Button>
      </div>
    </div>
  )
}
