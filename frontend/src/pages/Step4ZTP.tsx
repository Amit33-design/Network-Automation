import { useState } from 'react'
import { useTopologySummary, useTopologyDevices } from '@/hooks/useTopology'
import { useRunZTP } from '@/hooks/useZTP'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import type { ZTPEvent } from '@/types'

const ZTP_STAGES = [
  'dhcp_requested',
  'bootstrap_downloaded',
  'config_applied',
  'registered',
  'pre_checks_running',
  'pre_checks_passed',
  'online',
  'failed',
]

export function Step4ZTP() {
  const { prevStep, nextStep } = useAppStore()
  const { showToast } = useToast()

  const { data: summary } = useTopologySummary()
  const { data: allDevices = [] } = useTopologyDevices()

  const [failDevice, setFailDevice] = useState('')
  const [failAt, setFailAt] = useState('config_applied')
  const [events, setEvents] = useState<ZTPEvent[]>([])
  const [ztpSummary, setZtpSummary] = useState<{ total_events: number; online: number; failed: number } | null>(null)

  const { mutate: runZTP, isPending } = useRunZTP()

  function handleRun() {
    const req = failDevice ? { fail_device: failDevice, fail_at: failAt } : {}
    runZTP(req, {
      onSuccess(data) {
        setEvents(data.events)
        setZtpSummary(data.summary)
        showToast(
          `ZTP complete — ${data.summary.online} online, ${data.summary.failed} failed`,
          data.summary.failed ? 'warning' : 'success',
        )
      },
      onError(e) {
        showToast('ZTP failed: ' + e.message, 'error')
      },
    })
  }

  function handleReset() {
    setEvents([])
    setZtpSummary(null)
    setFailDevice('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Zero-Touch Provisioning</h2>
        <p className="text-sm text-gray-400">Run the ZTP pipeline against the demo lab topology</p>
      </div>

      {/* Topology summary cards */}
      {summary && (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {[
            { label: 'Total',     val: summary.total },
            { label: 'Routers',   val: summary.routers },
            { label: 'Switches',  val: summary.switches },
            { label: 'Firewalls', val: summary.firewalls },
            { label: 'LBs',       val: summary.load_balancers },
            { label: 'GPU-FWs',   val: summary.gpu_firewalls },
            { label: 'GPU Srvs',  val: summary.gpu_servers },
          ].map(({ label, val }) => (
            <Card key={label} className="text-center py-3">
              <div className="text-xl font-bold text-blue-400">{val}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Fault injection */}
      <Card>
        <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
            <select
              value={failDevice}
              onChange={e => setFailDevice(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              <option value="">— none —</option>
              {allDevices.map(d => (
                <option key={d.name} value={d.name}>{d.name} ({d.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fail At Stage</label>
            <select
              value={failAt}
              onChange={e => setFailAt(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-blue-500"
            >
              {ZTP_STAGES.map(s => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleRun} disabled={isPending}>
              {isPending ? 'Running…' : '▶ Run ZTP'}
            </Button>
            <Button variant="secondary" onClick={handleReset}>Reset</Button>
          </div>
        </div>
      </Card>

      {/* Result summary */}
      {ztpSummary && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="text-center">
            <div className="text-2xl font-bold text-gray-300">{ztpSummary.total_events}</div>
            <div className="text-xs text-gray-500">Events</div>
          </Card>
          <Card className="text-center">
            <div className="text-2xl font-bold text-green-400">{ztpSummary.online}</div>
            <div className="text-xs text-gray-500">Online</div>
          </Card>
          <Card className="text-center">
            <div className="text-2xl font-bold text-red-400">{ztpSummary.failed}</div>
            <div className="text-xs text-gray-500">Failed</div>
          </Card>
        </div>
      )}

      {/* Event log */}
      {events.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">Device</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">Stage</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">Message</th>
                <th className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt, i) => (
                <tr
                  key={i}
                  className={`border-b border-white/5 ${evt.success ? '' : 'bg-red-500/5'}`}
                >
                  <td className="px-4 py-2 font-semibold text-gray-200">{evt.device_name}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs text-blue-400">
                      {evt.state.replace(/_/g, ' ').toUpperCase()}
                    </code>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{evt.message}</td>
                  <td className="px-4 py-2">
                    <Badge variant={evt.success ? 'pass' : 'fail'}>
                      {evt.success ? '✔ OK' : '✘ FAILED'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep}>Next: Checks →</Button>
      </div>
    </div>
  )
}
