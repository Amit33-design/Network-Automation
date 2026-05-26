import { useState } from 'react'
import { useTopologyDevices } from '@/hooks/useTopology'
import { useRunChecks } from '@/hooks/useChecks'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'
import type { CheckResult } from '@/types'

const CHECK_OPTIONS = [
  'interfaces_up',
  'bgp_sessions',
  'routing_table',
  'cpu_baseline',
  'stp_mode',
  'vlans_active',
  'ha_sync',
  'virtual_servers',
  'pool_members',
]

export function Step5Checks() {
  const { prevStep, nextStep } = useAppStore()
  const { showToast } = useToast()
  const { data: allDevices = [] } = useTopologyDevices()

  const [failDevice, setFailDevice] = useState('')
  const [failCheck, setFailCheck] = useState('interfaces_up')
  const [phase, setPhase] = useState<'pre' | 'post' | null>(null)
  const [results, setResults] = useState<CheckResult[]>([])

  const { mutate: runPre,  isPending: prePending }  = useRunChecks('pre')
  const { mutate: runPost, isPending: postPending } = useRunChecks('post')

  function handleRun(p: 'pre' | 'post') {
    const req = failDevice && failCheck
      ? { fail_devices: { [failDevice]: [failCheck] } }
      : {}
    const mutate = p === 'pre' ? runPre : runPost
    mutate(req, {
      onSuccess(data) {
        setPhase(p)
        setResults(data.results)
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

  const pass = results.filter(r => r.status === 'PASS').length
  const fail = results.filter(r => r.status === 'FAIL').length
  const warn = results.filter(r => r.status === 'WARN').length

  const badgeVariant = (status: string) =>
    ({ PASS: 'pass', FAIL: 'fail', WARN: 'warn', SKIP: 'skip' } as const)[status] ?? 'neutral'
  const badgeIcon = (status: string) =>
    ({ PASS: '✔', FAIL: '✘', WARN: '⚠', SKIP: '–' } as const)[status] ?? '–'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Pre / Post-Deploy Checks</h2>
        <p className="text-sm text-gray-400">Validate device readiness before and after config push</p>
      </div>

      {/* Fault injection + run buttons */}
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
            <Button onClick={() => handleRun('pre')} disabled={prePending || postPending}>
              {prePending ? 'Running…' : '▶ Pre-Checks'}
            </Button>
            <Button variant="secondary" onClick={() => handleRun('post')} disabled={prePending || postPending}>
              {postPending ? 'Running…' : '▶ Post-Checks'}
            </Button>
            <Button variant="ghost" onClick={() => { setResults([]); setPhase(null) }}>
              Clear
            </Button>
          </div>
        </div>
      </Card>

      {/* Summary */}
      {results.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="text-center">
            <div className="text-lg font-bold text-gray-300">{phase?.toUpperCase()}-DEPLOY</div>
            <div className="text-xs text-gray-500">Phase</div>
          </Card>
          <Card className="text-center">
            <div className="text-xl font-bold text-green-400">{pass}</div>
            <div className="text-xs text-gray-500">PASS</div>
          </Card>
          <Card className="text-center">
            <div className="text-xl font-bold text-red-400">{fail}</div>
            <div className="text-xs text-gray-500">FAIL</div>
          </Card>
          <Card className="text-center">
            <div className="text-xl font-bold text-yellow-400">{warn}</div>
            <div className="text-xs text-gray-500">WARN</div>
          </Card>
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
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
              {results.map((r, i) => (
                <tr
                  key={i}
                  className={`border-b border-white/5 ${r.status === 'FAIL' ? 'bg-red-500/5' : ''}`}
                >
                  <td className="px-4 py-2 font-semibold text-gray-200">{r.device}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs text-blue-400">{r.name}</code>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={badgeVariant(r.status)}>
                      {badgeIcon(r.status)} {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{r.message}</td>
                  <td className="px-4 py-2 text-xs text-yellow-500">{r.remediation ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep}>Next: Monitor →</Button>
      </div>
    </div>
  )
}
