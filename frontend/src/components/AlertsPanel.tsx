/**
 * AlertsPanel — displays live Prometheus alerts from /api/alerts.
 * Auto-refreshes every 30 s when backend is reachable.
 */
import React, { useEffect, useCallback } from 'react'
import { fetchAlerts } from '@/api/client'
import { useStore, selectAlerts } from '@/store'

const SEVERITY_ICON: Record<string, string> = {
  critical: '🔴',
  warning:  '🟡',
  info:     '🔵',
}

export function AlertsPanel() {
  const alerts    = useStore(selectAlerts)
  const setAlerts = useStore((s) => s.setAlerts)

  const refresh = useCallback(async () => {
    try { setAlerts(await fetchAlerts()) }
    catch { /* backend unreachable — keep stale data */ }
  }, [setAlerts])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  if (alerts.length === 0) {
    return <div className="ap-empty">✅ No active alerts</div>
  }

  return (
    <ul className="ap-list" role="list">
      {alerts.map((a, i) => (
        <li key={i} className={`ap-item ap-item-${a.severity}`}>
          <span className="ap-icon">{SEVERITY_ICON[a.severity] ?? '⚪'}</span>
          <span className="ap-host">{a.hostname}</span>
          <span className="ap-check">{a.check}</span>
          <span className="ap-msg">{a.message}</span>
          <span className="ap-val">{a.metric_value.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  )
}
