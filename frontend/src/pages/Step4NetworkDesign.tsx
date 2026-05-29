import { useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { buildBOM } from '@/lib/bom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import { formatUSD } from '@/lib/utils'

const USE_CASE_LABELS: Record<string, string> = {
  campus:     'Campus / Enterprise',
  dc:         'Data Center Leaf-Spine',
  gpu:        'AI / GPU Cluster',
  wan:        'WAN / SD-WAN',
  multisite:  'Multi-Site DCI',
  multicloud: 'Multi-Cloud',
  aviatrix:   'Aviatrix Overlay',
}

export function Step4NetworkDesign() {
  const {
    useCase, scale, siteCode, linkDistances,
    underlayProtocol, overlayProtocols, redundancyModel,
    totalEndpoints, bandwidthPerServer, oversubscription,
    devices, setDevices,
    nextStep, prevStep,
  } = useAppStore()

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription }),
    [useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription]
  )

  // Sync generated devices into store
  useMemo(() => { setDevices(generatedDevices) }, [generatedDevices, setDevices])

  const useCaseLabel = (useCase && USE_CASE_LABELS[useCase]) || useCase || '—'
  const uniqueModels = Object.values(summary).length
  const scaleLabel = scale ? scale.charAt(0).toUpperCase() + scale.slice(1) : '—'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Network Design</h2>
        <p className="text-sm text-gray-400">Auto-generated HLD topology and IP plan</p>
      </div>

      {/* Topology — main feature */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-300">HLD Topology Diagram</h3>
          <button
            onClick={() => setDevices(generatedDevices)}
            className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5
                       text-gray-400 hover:border-white/30 hover:text-gray-200 transition-colors cursor-pointer"
          >
            ↺ Regenerate
          </button>
        </div>
        <TopologyDiagram
          devices={generatedDevices}
          underlayProtocol={underlayProtocol}
          overlayProtocols={overlayProtocols}
        />
      </Card>

      {/* Design Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="text-center">
          <div className="text-xl font-bold text-blue-400">{generatedDevices.length}</div>
          <div className="text-xs text-gray-500 mt-1">Devices</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-purple-400">{uniqueModels}</div>
          <div className="text-xs text-gray-500 mt-1">Unique Models</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-green-400">{formatUSD(grandTotal)}</div>
          <div className="text-xs text-gray-500 mt-1">Est. Hardware Cost</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl font-bold text-orange-400">{scaleLabel}</div>
          <div className="text-xs text-gray-500 mt-1">Scale</div>
        </Card>
      </div>

      {/* Design Details */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Design Summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Use Case</span>
              <span className="text-gray-200 font-medium">{useCaseLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Scale</span>
              <span className="text-gray-200 font-medium">{scaleLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Site Code</span>
              <span className="text-gray-200 font-mono">{siteCode || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Redundancy</span>
              <span className="text-gray-200 font-medium capitalize">{redundancyModel}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Underlay</span>
              <span className="text-blue-300 font-mono uppercase">{underlayProtocol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Overlay</span>
              <span className="text-indigo-300 font-mono text-xs">
                {overlayProtocols.length > 0 ? overlayProtocols.join(', ') : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Spine ↔ Leaf</span>
              <span className="text-gray-200">{linkDistances['spine-leaf']}m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">WAN Edge</span>
              <span className="text-gray-200">{linkDistances['wan-edge']}m</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep} disabled={devices.length === 0}>
          Next: Config Gen →
        </Button>
      </div>
    </div>
  )
}
