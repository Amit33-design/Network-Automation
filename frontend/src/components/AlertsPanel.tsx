import { useAlerts } from '@/hooks/useAlerts'
import { isLiveMode } from '@/api/client'
import { Badge } from '@/components/ui/Badge'
import type { Alert } from '@/types'

const SEV_VARIANT: Record<Alert['severity'], 'fail' | 'warn' | 'info'> = {
  critical: 'fail',
  warning:  'warn',
  info:     'info',
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b border-white/5 last:border-0
      ${alert.resolved ? 'opacity-50' : ''}`}>
      <Badge variant={SEV_VARIANT[alert.severity]} className="mt-0.5 shrink-0">
        {alert.severity}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm text-gray-200">{alert.device}</span>
          {alert.resolved && (
            <span className="text-xs text-green-500 font-medium">resolved</span>
          )}
        </div>
        <div className="text-sm text-gray-400 mt-0.5">{alert.summary}</div>
        {alert.detail && (
          <div className="text-xs text-gray-600 mt-0.5">{alert.detail}</div>
        )}
      </div>
      <div className="text-xs text-gray-600 shrink-0">
        {new Date(alert.timestamp).toLocaleTimeString()}
      </div>
    </div>
  )
}

export function AlertsPanel() {
  const { data: alerts, isLoading, isError, error, dataUpdatedAt, refetch } = useAlerts()
  const liveMode = isLiveMode()

  if (!liveMode) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-sm text-gray-500">
          Configure a backend URL in settings to enable live alerts.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-sm text-gray-500 animate-pulse">Loading alerts…</div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm text-red-400">Failed to load alerts: {error?.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-2 text-xs text-red-300 underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    )
  }

  const active   = alerts?.filter(a => !a.resolved) ?? []
  const resolved = alerts?.filter(a => a.resolved)  ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {active.length > 0 && (
            <Badge variant="fail">{active.length} active</Badge>
          )}
          {resolved.length > 0 && (
            <Badge variant="neutral">{resolved.length} resolved</Badge>
          )}
          {(alerts?.length ?? 0) === 0 && (
            <Badge variant="pass">All clear</Badge>
          )}
        </div>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-gray-600">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {(alerts?.length ?? 0) > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5">
          {[...active, ...resolved].map(a => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4 text-center">
          <p className="text-sm text-green-400">No active alerts — all systems nominal.</p>
        </div>
      )}
    </div>
  )
}
