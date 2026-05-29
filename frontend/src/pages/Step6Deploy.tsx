import { useState } from 'react'
import { useTopologySummary, useTopologyDevices } from '@/hooks/useTopology'
import { useRunZTP } from '@/hooks/useZTP'
import { useRunChecks } from '@/hooks/useChecks'
import { usePollMonitoring } from '@/hooks/useMonitoring'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import { formatUptime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { ZTPEvent, BOMDevice, CheckResult, MonitoringResult } from '@/types'

const ZTP_STAGES = [
  'dhcp_requested', 'bootstrap_downloaded', 'config_applied',
  'registered', 'pre_checks_running', 'pre_checks_passed', 'online', 'failed',
]

const CHECK_OPTIONS = [
  'interfaces_up', 'bgp_sessions', 'routing_table', 'cpu_baseline',
  'stp_mode', 'vlans_active', 'ha_sync', 'virtual_servers', 'pool_members',
]

const STATUS_BADGE: Record<string, 'pass' | 'warn' | 'fail' | 'neutral'> = {
  healthy: 'pass', degraded: 'warn', down: 'fail', unknown: 'neutral',
}

type Tab = 'ztp' | 'checks' | 'monitor'

export function Step6Deploy() {
  const { prevStep } = useAppStore()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('ztp')

  // ── topology ──────────────────────────────────────────────────────────────
  const { data: summary } = useTopologySummary()
  const { data: allDevices = [] } = useTopologyDevices()

  const bomDevices: BOMDevice[] = allDevices.map(d => ({
    id: d.name, hostname: d.name, role: d.role, subLayer: d.role,
    model: d.model || d.platform, vendor: d.platform, count: 1,
    unitPrice: 0, totalPrice: 0, speed: '100G', ports: 48, features: d.tags ?? [],
  }))

  // ── ZTP state ─────────────────────────────────────────────────────────────
  const [failDevice, setFailDevice] = useState('')
  const [failAt, setFailAt] = useState('config_applied')
  const [ztpEvents, setZtpEvents] = useState<ZTPEvent[]>([])
  const [ztpSummary, setZtpSummary] = useState<{ total_events: number; online: number; failed: number } | null>(null)
  const { mutate: runZTP, isPending: ztpPending } = useRunZTP()

  function handleRunZTP() {
    const req = failDevice ? { fail_device: failDevice, fail_at: failAt } : {}
    runZTP(req, {
      onSuccess(data) {
        setZtpEvents(data.events)
        setZtpSummary(data.summary)
        showToast(
          `ZTP complete — ${data.summary.online} online, ${data.summary.failed} failed`,
          data.summary.failed ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('ZTP failed: ' + e.message, 'error') },
    })
  }

  // ── Checks state ──────────────────────────────────────────────────────────
  const [failCheckDevice, setFailCheckDevice] = useState('')
  const [failCheck, setFailCheck] = useState('interfaces_up')
  const [checkPhase, setCheckPhase] = useState<'pre' | 'post' | null>(null)
  const [checkResults, setCheckResults] = useState<CheckResult[]>([])
  const { mutate: runPre,  isPending: prePending }  = useRunChecks('pre')
  const { mutate: runPost, isPending: postPending } = useRunChecks('post')

  function handleRunChecks(p: 'pre' | 'post') {
    const req = failCheckDevice && failCheck
      ? { fail_devices: { [failCheckDevice]: [failCheck] } }
      : {}
    const mutate = p === 'pre' ? runPre : runPost
    mutate(req, {
      onSuccess(data) {
        setCheckPhase(p)
        setCheckResults(data.results)
        const pass = data.results.filter(r => r.status === 'PASS').length
        const fail = data.results.filter(r => r.status === 'FAIL').length
        showToast(
          `${p.toUpperCase()}-checks done — ${pass} PASS, ${fail} FAIL`,
          fail ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('Checks failed: ' + e.message, 'error') },
    })
  }

  const checkPass = checkResults.filter(r => r.status === 'PASS').length
  const checkFail = checkResults.filter(r => r.status === 'FAIL').length
  const checkWarn = checkResults.filter(r => r.status === 'WARN').length

  const badgeVariant = (s: string) =>
    ({ PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' } as const)[s] ?? 'neutral'
  const badgeIcon = (s: string) =>
    ({ PASS: '✔', FAIL: '✘', WARN: '⚠', SKIP: '–' } as const)[s] ?? '–'

  // ── Monitor state ─────────────────────────────────────────────────────────
  const [monitorData, setMonitorData] = useState<MonitoringResult | null>(null)
  const { mutate: poll, isPending: pollPending } = usePollMonitoring()

  function handlePoll(failDevices?: Record<string, string[]>) {
    poll(failDevices ? { fail_devices: failDevices } : {}, {
      onSuccess(d) {
        setMonitorData(d)
        const { healthy, degraded, down } = d.summary
        showToast(
          `Monitoring: ${healthy} healthy, ${degraded} degraded, ${down} down`,
          degraded || down ? 'warning' : 'success',
        )
      },
      onError(e) { showToast('Monitoring failed: ' + e.message, 'error') },
    })
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'ztp',     label: 'ZTP Provisioning' },
    { id: 'checks',  label: 'Pre / Post Checks' },
    { id: 'monitor', label: 'Monitoring' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Deploy & Validate</h2>
        <p className="text-sm text-gray-400">Zero-touch provisioning, pre/post checks, and live monitoring</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer',
              tab === t.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ZTP tab ─────────────────────────────────────────────────────── */}
      {tab === 'ztp' && (
        <div className="space-y-6">
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

          {bomDevices.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Lab Topology</CardTitle></CardHeader>
              <div className="mt-2">
                <TopologyDiagram devices={bomDevices} />
              </div>
            </Card>
          )}

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
                <Button onClick={handleRunZTP} disabled={ztpPending}>
                  {ztpPending ? 'Running…' : '▶ Run ZTP'}
                </Button>
                <Button variant="secondary" onClick={() => { setZtpEvents([]); setZtpSummary(null); setFailDevice('') }}>
                  Reset
                </Button>
              </div>
            </div>
          </Card>

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

          {ztpEvents.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Stage', 'Message', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs text-gray-400 font-semibold uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ztpEvents.map((evt, i) => (
                    <tr key={i} className={`border-b border-white/5 ${evt.success ? '' : 'bg-red-500/5'}`}>
                      <td className="px-4 py-2 font-semibold text-gray-200">{evt.device_name}</td>
                      <td className="px-4 py-2">
                        <code className="text-xs text-blue-400">{evt.state.replace(/_/g, ' ').toUpperCase()}</code>
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
        </div>
      )}

      {/* ── Checks tab ──────────────────────────────────────────────────── */}
      {tab === 'checks' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Fault Injection (optional)</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Fail Device</label>
                <select
                  value={failCheckDevice}
                  onChange={e => setFailCheckDevice(e.target.value)}
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
                <label className="text-xs text-gray-400 block mb-1">Fail Check</label>
                <select
                  value={failCheck}
                  onChange={e => setFailCheck(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200
                             focus:outline-none focus:border-blue-500"
                >
                  {CHECK_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleRunChecks('pre')} disabled={prePending || postPending}>
                  {prePending ? 'Running…' : '▶ Pre-Checks'}
                </Button>
                <Button variant="secondary" onClick={() => handleRunChecks('post')} disabled={prePending || postPending}>
                  {postPending ? 'Running…' : '▶ Post-Checks'}
                </Button>
                <Button variant="ghost" onClick={() => { setCheckResults([]); setCheckPhase(null) }}>Clear</Button>
              </div>
            </div>
          </Card>

          {checkResults.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              <Card className="text-center">
                <div className="text-lg font-bold text-gray-300">{checkPhase?.toUpperCase()}-DEPLOY</div>
                <div className="text-xs text-gray-500">Phase</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-green-400">{checkPass}</div>
                <div className="text-xs text-gray-500">PASS</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-red-400">{checkFail}</div>
                <div className="text-xs text-gray-500">FAIL</div>
              </Card>
              <Card className="text-center">
                <div className="text-xl font-bold text-yellow-400">{checkWarn}</div>
                <div className="text-xs text-gray-500">WARN</div>
              </Card>
            </div>
          )}

          {checkResults.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    {['Device', 'Check', 'Status', 'Message', 'Remediation'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {checkResults.map((r, i) => (
                    <tr key={i} className={`border-b border-white/5 ${r.status === 'FAIL' ? 'bg-red-500/5' : ''}`}>
                      <td className="px-4 py-2 font-semibold text-gray-200">{r.device}</td>
                      <td className="px-4 py-2"><code className="text-xs text-blue-400">{r.name}</code></td>
                      <td className="px-4 py-2">
                        <Badge variant={badgeVariant(r.status)}>{badgeIcon(r.status)} {r.status}</Badge>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-400">{r.message}</td>
                      <td className="px-4 py-2 text-xs text-yellow-500">{r.remediation ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Monitor tab ─────────────────────────────────────────────────── */}
      {tab === 'monitor' && (
        <div className="space-y-6">
          <div className="flex gap-3">
            <Button onClick={() => handlePoll()} disabled={pollPending}>
              {pollPending ? 'Polling…' : '⟳ Poll Now'}
            </Button>
            <Button variant="secondary" onClick={() => handlePoll({ 'edge-rtr1': ['interfaces_up'], 'lb1': ['virtual_servers'], 'gpu-fw1': ['rdma_policy'] })} disabled={pollPending}>
              Simulate Degraded
            </Button>
            <Button variant="ghost" onClick={() => setMonitorData(null)}>Clear</Button>
          </div>

          {monitorData && (
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Total',    val: monitorData.summary.total,   cls: 'text-gray-300' },
                { label: 'Healthy',  val: monitorData.summary.healthy,  cls: 'text-green-400' },
                { label: 'Degraded', val: monitorData.summary.degraded, cls: 'text-yellow-400' },
                { label: 'Down',     val: monitorData.summary.down,     cls: 'text-red-400' },
                { label: 'Alerts',   val: monitorData.summary.alerts.length, cls: 'text-orange-400' },
              ].map(({ label, val, cls }) => (
                <Card key={label} className="text-center">
                  <div className={`text-2xl font-bold ${cls}`}>{val}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </Card>
              ))}
            </div>
          )}

          {monitorData && (
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
                  {Object.values(monitorData.health)
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
                          <Badge variant={STATUS_BADGE[h.status] ?? 'neutral'}>{h.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-gray-300">{h.metrics.cpu}%</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{formatUptime(h.metrics.uptime_seconds)}</td>
                        <td className="px-4 py-2 text-xs text-yellow-400">
                          {h.alerts.length > 0 ? h.alerts.join(' · ') : <span className="text-gray-600">—</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {monitorData && monitorData.summary.alerts.length > 0 && (
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-orange-400 mb-2">
                Active Alerts ({monitorData.summary.alerts.length})
              </h3>
              {monitorData.summary.alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="font-semibold text-orange-300 shrink-0">{a.device}</span>
                  <span className="text-gray-400">{a.alert}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-start">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
      </div>
    </div>
  )
}
