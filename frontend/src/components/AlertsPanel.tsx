/**
 * AlertsPanel — displays live Prometheus alerts from /api/alerts.
 * Uses TanStack Query for automatic 30 s polling (replaces useEffect + setInterval).
 */
import React from 'react'
import { useAlerts } from '@/hooks/useAlerts'
import { useStore, selectAlerts } from '@/store'
import { isLiveMode } from '@/api/client'

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  warning:  '🟡',
  info:     '🔵',
}

export function AlertsPanel() {
  const cachedAlerts = useStore(selectAlerts)
  const { isLoading, isError, error, dataUpdatedAt, refetch } = useAlerts()

  if (!isLiveMode()) {
    return (
      <div className="ap-empty">
        ⚙️ Backend not configured — enable Live Mode in settings to see alerts.
      </div>
    )
  }

  if (isLoading && cachedAlerts.length === 0) {
    return <div className="ap-empty">⏳ Loading alerts…</div>
  }

  if (isError && cachedAlerts.length === 0) {
    return (
      <div className="ap-error">
        ❌ {error?.message ?? 'Failed to load alerts'}
        {' '}
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  if (cachedAlerts.length === 0) {
    return <div className="ap-empty">✅ No active alerts</div>
  }

  return (
    <>
      {dataUpdatedAt > 0 && (
        <p className="ap-meta" style={{ fontSize: '0.75rem', opacity: 0.6 }}>
          Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
        </p>
      )}
      <ul className="ap-list" role="list">
        {cachedAlerts.map((a, i) => (
          <li key={i} className={`ap-item ap-item-${a.severity}`}>
            <span className="ap-icon">{SEVERITY_ICON[a.severity] ?? '⚪'}</span>
            <span className="ap-host">{a.hostname}</span>
            <span className="ap-check">{a.check}</span>
            <span className="ap-msg">{a.message}</span>
            <span className="ap-val">{a.metric_value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}
