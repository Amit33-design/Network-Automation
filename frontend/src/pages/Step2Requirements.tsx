import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { AppType, Compliance, BandwidthPerServer, UnderlayProtocol, TrafficPattern, RedundancyModel } from '@/types'

const REDUNDANCY_OPTIONS: Array<{ id: RedundancyModel; label: string; desc: string }> = [
  { id: 'none',  label: 'None',  desc: 'PoC / Lab' },
  { id: 'basic', label: 'Basic', desc: 'Single uplinks' },
  { id: 'ha',    label: 'HA',    desc: 'Dual uplinks, MLAG' },
  { id: 'full',  label: 'Full',  desc: 'Dual everything' },
]

const TRAFFIC_PATTERNS: Array<{ id: TrafficPattern; label: string }> = [
  { id: 'ns',   label: 'North-South' },
  { id: 'ew',   label: 'East-West' },
  { id: 'both', label: 'Both' },
]

const BW_OPTIONS: BandwidthPerServer[] = ['1G', '10G', '25G', '100G', '400G']

const UNDERLAY_OPTIONS: Array<{ id: UnderlayProtocol; label: string }> = [
  { id: 'ospf',   label: 'OSPF' },
  { id: 'isis',   label: 'IS-IS' },
  { id: 'ebgp',   label: 'eBGP' },
  { id: 'static', label: 'Static' },
]

const OVERLAY_OPTIONS = ['VXLAN/EVPN', 'MPLS/SR', 'GRE', 'IPsec', 'SD-WAN']

const PROTO_FEATURES = [
  'ECMP', 'MLAG', 'BFD', 'LACP', 'QoS', 'PFC', 'ECN', 'RDMA',
  'SHARP', 'VLAN pruning', '802.1X', 'MACsec',
]

const COMPLIANCE_OPTIONS: Array<{ id: Compliance; label: string }> = [
  { id: 'PCI',   label: 'PCI-DSS' },
  { id: 'HIPAA', label: 'HIPAA' },
  { id: 'SOC2',  label: 'SOC2' },
  { id: 'QoS',   label: 'ISO27001' },
]

const APP_TYPES: Array<{ id: AppType; label: string }> = [
  { id: 'voice',    label: 'Voice' },
  { id: 'video',    label: 'Video' },
  { id: 'storage',  label: 'Storage' },
  { id: 'hpc',      label: 'HPC' },
  { id: 'internet', label: 'Internet' },
]

const OVERSUBSCRIPTION_OPTIONS = [
  { value: 1, label: '1:1' },
  { value: 2, label: '2:1' },
  { value: 3, label: '3:1' },
  { value: 4, label: '4:1' },
  { value: 8, label: '8:1' },
]

export function Step2Requirements() {
  const {
    redundancyModel, trafficPattern, totalEndpoints, bandwidthPerServer, oversubscription,
    underlayProtocol, overlayProtocols, protoFeatures, compliance, appTypes,
    setRedundancyModel, setTrafficPattern, setTotalEndpoints, setBandwidthPerServer,
    setOversubscription, setUnderlayProtocol, setOverlayProtocols, setProtoFeatures,
    setCompliance, setAppTypes,
    nextStep, prevStep,
  } = useAppStore()

  function toggleOverlay(o: string) {
    setOverlayProtocols(
      overlayProtocols.includes(o) ? overlayProtocols.filter(x => x !== o) : [...overlayProtocols, o]
    )
  }

  function toggleFeature(f: string) {
    setProtoFeatures(
      protoFeatures.includes(f) ? protoFeatures.filter(x => x !== f) : [...protoFeatures, f]
    )
  }

  function toggleCompliance(id: Compliance) {
    setCompliance(
      compliance.includes(id) ? compliance.filter(c => c !== id) : [...compliance, id]
    )
  }

  function toggleAppType(id: AppType) {
    setAppTypes(
      appTypes.includes(id) ? appTypes.filter(t => t !== id) : [...appTypes, id]
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Network Requirements</h2>
        <p className="text-sm text-gray-400">Define topology, capacity, and protocol requirements</p>
      </div>

      {/* Redundancy */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Redundancy Model</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {REDUNDANCY_OPTIONS.map(r => (
            <button
              key={r.id}
              onClick={() => setRedundancyModel(r.id)}
              className={cn(
                'p-3 rounded-xl border text-left transition-all cursor-pointer',
                redundancyModel === r.id
                  ? 'border-blue-500 bg-blue-600/20'
                  : 'border-white/10 bg-white/5 hover:border-white/30',
              )}
            >
              <div className={cn('text-sm font-semibold', redundancyModel === r.id ? 'text-blue-300' : 'text-gray-200')}>
                {r.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{r.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Traffic Pattern */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Traffic Pattern</h3>
        <div className="flex gap-2">
          {TRAFFIC_PATTERNS.map(tp => (
            <button
              key={tp.id}
              onClick={() => setTrafficPattern(tp.id)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer',
                trafficPattern === tp.id
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200',
              )}
            >
              {tp.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Capacity */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Capacity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Total Endpoints</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={totalEndpoints}
              onChange={e => setTotalEndpoints(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Bandwidth per Server</label>
            <select
              value={bandwidthPerServer}
              onChange={e => setBandwidthPerServer(e.target.value as BandwidthPerServer)}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              {BW_OPTIONS.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Oversubscription Ratio</label>
            <select
              value={oversubscription}
              onChange={e => setOversubscription(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              {OVERSUBSCRIPTION_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Routing */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Routing</h3>

        {/* Underlay */}
        <div className="mb-4">
          <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Underlay Protocol</label>
          <div className="flex gap-2 flex-wrap">
            {UNDERLAY_OPTIONS.map(u => (
              <button
                key={u.id}
                onClick={() => setUnderlayProtocol(u.id)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer',
                  underlayProtocol === u.id
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200',
                )}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overlay */}
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Overlay Protocols</label>
          <div className="flex gap-2 flex-wrap">
            {OVERLAY_OPTIONS.map(o => (
              <button
                key={o}
                onClick={() => toggleOverlay(o)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                  overlayProtocols.includes(o)
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Protocol Features */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Protocol Features</h3>
        <div className="flex flex-wrap gap-2">
          {PROTO_FEATURES.map(f => (
            <button
              key={f}
              onClick={() => toggleFeature(f)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                protoFeatures.includes(f)
                  ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </Card>

      {/* Compliance */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Compliance Requirements <span className="text-gray-500 font-normal">(optional)</span></h3>
        <div className="flex flex-wrap gap-2">
          {COMPLIANCE_OPTIONS.map(c => (
            <button
              key={c.id}
              onClick={() => toggleCompliance(c.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
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

      {/* App Types */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Application Types <span className="text-gray-500 font-normal">(optional)</span></h3>
        <div className="flex flex-wrap gap-2">
          {APP_TYPES.map(at => (
            <button
              key={at.id}
              onClick={() => toggleAppType(at.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
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

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep}>Continue →</Button>
      </div>
    </div>
  )
}
