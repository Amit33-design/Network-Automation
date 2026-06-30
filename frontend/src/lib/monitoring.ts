/**
 * monitoring.ts — client-side monitoring analysis / alerting engine
 *
 * The Step 6 Monitoring tab samples per-device metrics (CPU, memory, interface
 * errors, BGP sessions/prefixes, PFC drops, throughput) every tick, but in
 * demo mode it only drew gauges — it never *analyzed* them. This turns the raw
 * `MetricsSummary` into a real NOC view:
 *   - threshold-based, severity-ranked alerts computed from the metrics,
 *   - per-device health (healthy / degraded / down),
 *   - fleet roll-up + an exportable alert feed.
 *
 * Works without a backend (demo mode) and over live `/api/metrics/summary`.
 * Pure + dependency-free + unit-tested.
 */

import type { DeviceMetrics, MetricsSummary } from '@/types'

export type HealthStatus = 'healthy' | 'degraded' | 'down'
export type AlertSeverity = 'critical' | 'warning' | 'info'

// ── Thresholds ──────────────────────────────────────────────────────────────

export interface MetricThreshold {
  metric: keyof DeviceMetrics
  label: string
  unit: string
  /** Breach direction: value ABOVE (util/errors) or BELOW (sessions) the limit. */
  direction: 'above' | 'below'
  warn: number
  critical: number
}

// NOC-style default thresholds. Tunable via `evaluateFleet(..., {thresholds})`.
export const METRIC_THRESHOLDS: MetricThreshold[] = [
  { metric: 'cpu_util', label: 'CPU', unit: '%', direction: 'above', warn: 75, critical: 90 },
  { metric: 'mem_util', label: 'Memory', unit: '%', direction: 'above', warn: 80, critical: 92 },
  { metric: 'interface_errors_in', label: 'Iface errors (in)', unit: '', direction: 'above', warn: 5, critical: 50 },
  { metric: 'interface_errors_out', label: 'Iface errors (out)', unit: '', direction: 'above', warn: 5, critical: 50 },
  { metric: 'pfc_drops', label: 'PFC drops', unit: '', direction: 'above', warn: 50, critical: 200 },
]

// ── Alerts + health ─────────────────────────────────────────────────────────

export interface MonAlert {
  device: string
  metric: string
  severity: AlertSeverity
  message: string
  value: number
  threshold: number
}

export interface DeviceHealthEval {
  device: string
  role: string
  status: HealthStatus
  alerts: MonAlert[]
  metrics: DeviceMetrics
}

export interface FleetHealth {
  devices: DeviceHealthEval[]
  summary: {
    total: number
    healthy: number
    degraded: number
    down: number
    critical: number   // count of critical alerts
    warning: number    // count of warning alerts
  }
  /** All alerts across the fleet, most severe first. */
  alerts: MonAlert[]
  timestamp: string
}

const ROUTING_HINTS = ['spine', 'leaf', 'core', 'wan', 'edge', 'border', 'pe', 'hub', 'rtr', 'router']

function isRoutingDevice(name: string, role: string): boolean {
  const s = `${name} ${role}`.toLowerCase()
  return ROUTING_HINTS.some(h => s.includes(h))
}

/** Evaluate one device's metrics → health + alerts. */
export function evaluateDevice(
  device: string,
  role: string,
  m: DeviceMetrics,
  thresholds: MetricThreshold[] = METRIC_THRESHOLDS,
): DeviceHealthEval {
  const alerts: MonAlert[] = []

  for (const t of thresholds) {
    const value = Number(m[t.metric] ?? 0)
    const breach = t.direction === 'above'
      ? (value >= t.critical ? 'critical' : value >= t.warn ? 'warning' : null)
      : (value <= t.critical ? 'critical' : value <= t.warn ? 'warning' : null)
    if (breach) {
      const limit = breach === 'critical' ? t.critical : t.warn
      alerts.push({
        device, metric: String(t.metric), severity: breach, value, threshold: limit,
        message: `${t.label} ${value}${t.unit} ${t.direction === 'above' ? '≥' : '≤'} ${limit}${t.unit} (${breach})`,
      })
    }
  }

  // Control-plane down: a routing device with zero BGP sessions up.
  let controlPlaneDown = false
  if (isRoutingDevice(device, role) && m.bgp_sessions_up === 0) {
    controlPlaneDown = true
    alerts.push({
      device, metric: 'bgp_sessions_up', severity: 'critical', value: 0, threshold: 1,
      message: 'All BGP sessions down (0 established) — control plane isolated',
    })
  }

  // CPU pegged → treat as down (device effectively unresponsive).
  const pegged = m.cpu_util >= 99

  const status: HealthStatus = (controlPlaneDown || pegged)
    ? 'down'
    : alerts.length > 0 ? 'degraded' : 'healthy'

  return { device, role, status, alerts, metrics: m }
}

const SEV_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

/** Evaluate the whole fleet from a MetricsSummary. */
export function evaluateFleet(
  summary: MetricsSummary,
  opts: { roles?: Record<string, string>; thresholds?: MetricThreshold[] } = {},
): FleetHealth {
  const roles = opts.roles ?? {}
  const devices: DeviceHealthEval[] = []
  for (const [name, m] of Object.entries(summary.devices)) {
    devices.push(evaluateDevice(name, roles[name] ?? '', m, opts.thresholds))
  }

  const alerts = devices.flatMap(d => d.alerts)
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.value - a.value)

  return {
    devices: devices.sort((a, b) => a.device.localeCompare(b.device)),
    summary: {
      total: devices.length,
      healthy: devices.filter(d => d.status === 'healthy').length,
      degraded: devices.filter(d => d.status === 'degraded').length,
      down: devices.filter(d => d.status === 'down').length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
    },
    alerts,
    timestamp: summary.timestamp,
  }
}

/** Export the active alerts as a plain-text NOC feed (most severe first). */
export function alertsToText(fleet: FleetHealth): string {
  const lines = [
    '# Active Alerts — NetDesign AI Monitoring',
    `# ${fleet.timestamp}`,
    `# ${fleet.summary.critical} critical · ${fleet.summary.warning} warning · `
      + `${fleet.summary.down} down / ${fleet.summary.degraded} degraded / ${fleet.summary.healthy} healthy`,
    '',
  ]
  if (fleet.alerts.length === 0) {
    lines.push('No active alerts — all devices within thresholds.')
    return lines.join('\n')
  }
  for (const a of fleet.alerts) {
    const tag = a.severity === 'critical' ? 'CRIT' : a.severity === 'warning' ? 'WARN' : 'INFO'
    lines.push(`[${tag}] ${a.device}: ${a.message}`)
  }
  return lines.join('\n')
}
