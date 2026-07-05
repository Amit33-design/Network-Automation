import { useMemo, useState } from 'react'
import { useRunRca } from '@/hooks/useRca'
import { isLiveMode } from '@/api/client'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { RcaHypothesis } from '@/types'

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <div className="flex items-center gap-2 w-28">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  )
}

function HypothesisCard({ h }: { h: RcaHypothesis }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="text-xs">#{h.rank}</Badge>
          <span className="font-semibold text-gray-200 text-sm">{h.rootCause}</span>
        </div>
        <ConfidenceBar value={h.confidence} />
      </div>

      {h.evidence.length > 0 && (
        <ul className="space-y-1">
          {h.evidence.map((e, i) => (
            <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
              <span className="text-gray-600 shrink-0">·</span>
              {e}
            </li>
          ))}
        </ul>
      )}

      {h.blastRadius.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">
            Blast radius · {h.blastRadius.length} device{h.blastRadius.length !== 1 ? 's' : ''}
          </span>
          <div className="flex flex-wrap gap-1">
            {h.blastRadius.map(d => (
              <span key={d} className="px-1.5 py-0.5 rounded text-[11px] bg-amber-500/10 border border-amber-500/20 text-amber-300">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 space-y-1">
        <span className="text-xs font-medium text-blue-400">Remediation</span>
        <ol className="space-y-0.5">
          {h.remediationSteps.map((step, i) => (
            <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
              <span className="text-blue-500/70 shrink-0 tabular-nums">{i + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {h.automationAvailable && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-emerald-400">⚙️ Automated remediation available</div>
            {h.automationPlaybook && (
              <div className="text-[11px] text-gray-400 truncate font-mono">{h.automationPlaybook}</div>
            )}
          </div>
          <Button type="button" variant="ghost" className="text-xs shrink-0" disabled title="Demo — playbook run is a live-mode action">
            ▶ Run playbook
          </Button>
        </div>
      )}
    </div>
  )
}

export function RcaPanel({ deviceNames }: { deviceNames?: string[] }) {
  const [symptom, setSymptom]   = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const { mutate, data, isPending, isError, error, reset } = useRunRca()
  const liveMode = isLiveMode()

  const storeDevices      = useAppStore(s => s.devices)
  const useCase           = useAppStore(s => s.useCase)
  const overlayProtocols  = useAppStore(s => s.overlayProtocols)
  const underlayProtocol  = useAppStore(s => s.underlayProtocol)

  const devicePool = useMemo(
    () => (deviceNames && deviceNames.length ? deviceNames : storeDevices.map(d => d.hostname).filter(Boolean)),
    [deviceNames, storeDevices],
  )

  const design = useMemo(() => ({
    useCase,
    protocols: [...(overlayProtocols || []), ...(underlayProtocol ? [underlayProtocol] : [])],
    devices: storeDevices.map(d => ({ hostname: d.hostname, role: d.role, subLayer: d.subLayer })),
  }), [useCase, overlayProtocols, underlayProtocol, storeDevices])

  function toggleDevice(name: string) {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name],
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!symptom.trim()) return
    mutate({ symptom: symptom.trim(), devices: selected, design })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        {!liveMode && (
          <p className="text-[11px] text-gray-500">
            Demo mode — running the client-side RCA engine. Configure a backend URL to correlate live telemetry.
          </p>
        )}
        <div>
          <label className="text-xs text-gray-400 block mb-1">Symptom description</label>
          <textarea
            value={symptom}
            onChange={e => setSymptom(e.target.value)}
            placeholder="e.g. High packet loss between spine-01 and leaf-03 after maintenance window"
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm
                       text-gray-200 placeholder-gray-600 resize-none
                       focus:outline-none focus:border-blue-500"
          />
        </div>

        {devicePool.length > 0 && (
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Affected devices (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {devicePool.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleDevice(name)}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${
                    selected.includes(name)
                      ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={isPending || !symptom.trim()}>
            {isPending ? 'Analyzing…' : '⚡ Run RCA'}
          </Button>
          {(data || isError) && (
            <Button type="button" variant="ghost" onClick={reset}>Clear</Button>
          )}
        </div>
      </form>

      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">RCA failed: {error?.message}</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-300">
            {data.length} Root Cause Hypothes{data.length !== 1 ? 'es' : 'is'}
          </h4>
          {data.map(h => <HypothesisCard key={h.rank} h={h} />)}
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
          <p className="text-sm text-gray-500">No hypotheses generated for this symptom.</p>
        </div>
      )}
    </div>
  )
}
