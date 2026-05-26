import { useState } from 'react'
import { usePollMonitoring } from '@/hooks/useMonitoring'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { formatUptime } from '@/lib/utils'
import type { MonitoringResult } from '@/types'

const STATUS_BADGE: Record<string, 'pass' | 'warn' | 'fail' | 'neutral'> = {
  healthy:  'pass',
  degraded: 'warn',
  down:     'fail',
  unknown:  'neutral',
}

export function Step6Monitor() {
  const { prevStep } = useAppStore()
  const { showToast } = useToast()
  const [data, setData] = useState<MonitoringResult | null>(null)
  const { mutate: poll, isPending } = usePollMonitoring()

  function handlePoll(failDevices?: Record<string, string[]>) {
    poll(
      failDevices ? { fail_devices: failDevices } : {},
      {
        onSuccess(d) {
          setData(d)
          const { healthy, degraded, down } = d.summary
          showToast(
            `Monitoring: ${healthy} healthy, ${degraded} degraded, ${down} down`,
            degraded || down ? 'warning' : 'success',
          )
        },
        onError(e) { showToast('Monitoring failed: ' + e.message, 'error') },
      },
    )
  }

  function handleDegraded() {
    handlePoll({
      'edge-rtr1': ['interfaces_up'],
      'lb1':       ['virtual_servers'],
      'gpu-fw1':   ['rdma_policy'],
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Continuous Monitoring</h2>
        <p className="text-sm text-gray-400">Poll device health and surface active alerts</p>
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        <Button onClick={() => handlePoll()} disabled={isPending}>
          {isPending ? 'Polling…' : '⟳ Poll Now'}
        </Button>
        <Button variant="secondary" onClick={handleDegraded} disabled={isPending}>
          Simulate Degraded
        </Button>
        <Button variant="ghost" onClick={() => setData(null)}>Clear</Button>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Total',    val: data.summary.total,   cls: 'text-gray-300' },
            { label: 'Healthy',  val: data.summary.healthy,  cls: 'text-green-400' },
            { label: 'Degraded', val: data.summary.degraded, cls: 'text-yellow-400' },
            { label: 'Down',     val: data.summary.down,     cls: 'text-red-400' },
            { label: 'Alerts',   val: data.summary.alerts.length, cls: 'text-orange-400' },
          ].map(({ label, val, cls }) => (
            <Card key={label} className="text-center">
              <div className={`text-2xl font-bold ${cls}`}>{val}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Health table */}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                {['Device', 'Role', 'Status', 'CPU', 'Uptime', 'Alerts'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(data.health)
                .sort((a, b) => a.device_name.localeCompare(b.device_name))
                .map(h => (
                  <tr
                    key={h.device_name}
                    className={`border-b border-white/5 ${
                      h.status === 'degraded' ? 'bg-yellow-500/5' :
                      h.status === 'down'     ? 'bg-red-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-2 font-semibold text-gray-200">{h.device_name}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{h.role}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_BADGE[h.status] ?? 'neutral'}>
                        {h.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-gray-300">{h.metrics.cpu}%</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {formatUptime(h.metrics.uptime_seconds)}
                    </td>
                    <td className="px-4 py-2 text-xs text-yellow-400">
                      {h.alerts.length > 0 ? h.alerts.join(' · ') : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active alerts */}
      {data && data.summary.alerts.length > 0 && (
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
          <h3 className="text-sm font-semibold text-orange-400 mb-2">
            Active Alerts ({data.summary.alerts.length})
          </h3>
          {data.summary.alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="font-semibold text-orange-300 shrink-0">{a.device}</span>
              <span className="text-gray-400">{a.alert}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
      </div>
    </div>
  )
}
