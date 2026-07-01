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

// ── Capacity trending / forecast ────────────────────────────────────────────

export interface MetricForecast {
  /** Least-squares slope in metric-units per tick. */
  slope: number
  trend: 'rising' | 'falling' | 'flat'
  /** Ticks until the metric reaches `limit` if rising toward it, else null. */
  etaTicks: number | null
}

/**
 * Linear-regression forecast over a metric's recent history (one value per
 * tick). Used for capacity trending — e.g. "CPU rising, ~6 ticks to 90%".
 */
export function forecastMetric(history: number[], limit: number, flatEps = 0.2): MetricForecast {
  const n = history.length
  if (n < 3) return { slope: 0, trend: 'flat', etaTicks: null }

  // Least-squares slope with x = 0..n-1.
  const xMean = (n - 1) / 2
  const yMean = history.reduce((s, v) => s + v, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (history[i] - yMean)
    den += (i - xMean) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const trend: MetricForecast['trend'] = slope > flatEps ? 'rising' : slope < -flatEps ? 'falling' : 'flat'

  let etaTicks: number | null = null
  const current = history[n - 1]
  if (trend === 'rising' && current < limit) {
    etaTicks = Math.max(1, Math.ceil((limit - current) / slope))
  }
  return { slope: Math.round(slope * 100) / 100, trend, etaTicks }
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

// ── Alert history + acknowledge (session-scoped) ─────────────────────────────
// Track each alert's lifecycle across ticks (first seen → last seen → cleared)
// with an ack flag, so the NOC has a history rather than only a point-in-time
// snapshot. Keyed by device|metric. Pure reducer (caller holds the map).

export interface AlertHistoryEntry {
  key: string
  device: string
  metric: string
  severity: AlertSeverity
  message: string
  firstSeen: string
  lastSeen: string
  clearedAt: string | null   // set when the alert stops firing
  count: number              // ticks observed firing
  acked: boolean
}

export type AlertHistory = Record<string, AlertHistoryEntry>

const alertKey = (a: MonAlert): string => `${a.device}|${a.metric}`

/**
 * Fold the current tick's alerts into the running history (pure):
 *  - new alert → create entry (firstSeen = nowIso),
 *  - still firing → bump lastSeen/severity/message/count, clearedAt = null,
 *  - previously firing, now gone → set clearedAt (once).
 * Ack state is preserved across updates.
 */
export function updateAlertHistory(prev: AlertHistory, alerts: MonAlert[], nowIso: string): AlertHistory {
  const next: AlertHistory = {}
  const active = new Set<string>()

  // Carry forward existing entries.
  for (const [k, e] of Object.entries(prev)) next[k] = { ...e }

  for (const a of alerts) {
    const k = alertKey(a)
    active.add(k)
    const e = next[k]
    if (e && e.clearedAt === null) {
      next[k] = { ...e, lastSeen: nowIso, severity: a.severity, message: a.message, count: e.count + 1 }
    } else {
      // brand new, or re-fired after a clear (reset lifecycle, keep ack=false)
      next[k] = {
        key: k, device: a.device, metric: a.metric, severity: a.severity, message: a.message,
        firstSeen: nowIso, lastSeen: nowIso, clearedAt: null, count: 1, acked: false,
      }
    }
  }

  // Anything previously active but not in this tick → cleared.
  for (const [k, e] of Object.entries(next)) {
    if (!active.has(k) && e.clearedAt === null) next[k] = { ...e, clearedAt: e.lastSeen }
  }

  return next
}

/** Mark an alert acknowledged (idempotent, pure). */
export function ackAlert(history: AlertHistory, key: string): AlertHistory {
  const e = history[key]
  if (!e || e.acked) return history
  return { ...history, [key]: { ...e, acked: true } }
}

/** Entries sorted for display: active-first, then most-recent, severity-ranked. */
export function alertHistoryList(history: AlertHistory): AlertHistoryEntry[] {
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }
  return Object.values(history).sort((a, b) =>
    (a.clearedAt === null ? 0 : 1) - (b.clearedAt === null ? 0 : 1) ||
    rank[a.severity] - rank[b.severity] ||
    b.lastSeen.localeCompare(a.lastSeen))
}

// ── SLA / availability tracking ──────────────────────────────────────────────
// Accumulate per-device up/down samples across monitoring ticks to derive an
// availability % (uptime). A device counts as "up" when healthy or degraded;
// only `down` (control-plane isolated / CPU pegged) subtracts from uptime.

export interface AvailabilityAcc {
  [device: string]: { up: number; total: number }
}

/** Fold one fleet evaluation into the running availability accumulator (pure). */
export function recordAvailability(acc: AvailabilityAcc, fleet: FleetHealth): AvailabilityAcc {
  const next: AvailabilityAcc = { ...acc }
  for (const d of fleet.devices) {
    const cur = next[d.device] ?? { up: 0, total: 0 }
    next[d.device] = {
      up: cur.up + (d.status === 'down' ? 0 : 1),
      total: cur.total + 1,
    }
  }
  return next
}

export interface DeviceAvailability {
  device: string
  pct: number      // 0-100, rounded to 2 dp
  samples: number
  down: number
}

export interface AvailabilityReport {
  devices: DeviceAvailability[]   // sorted worst-first
  fleetPct: number                // mean availability across devices
  samples: number                 // ticks observed (max across devices)
}

/** Summarize the accumulator into per-device + fleet availability. */
export function availabilityReport(acc: AvailabilityAcc): AvailabilityReport {
  const devices: DeviceAvailability[] = Object.entries(acc).map(([device, c]) => ({
    device,
    pct: c.total ? Math.round((c.up / c.total) * 10000) / 100 : 100,
    samples: c.total,
    down: c.total - c.up,
  })).sort((a, b) => a.pct - b.pct || b.down - a.down)

  const fleetPct = devices.length
    ? Math.round((devices.reduce((s, d) => s + d.pct, 0) / devices.length) * 100) / 100
    : 100
  const samples = devices.reduce((m, d) => Math.max(m, d.samples), 0)
  return { devices, fleetPct, samples }
}

// ── Alert correlation / grouping ────────────────────────────────────────────
// Collapse a noisy flat alert list into a few correlated events with a
// root-cause hint, so the NOC sees "fleet-wide BGP loss" rather than 12 rows.

export interface CorrelatedEvent {
  id: string
  title: string
  severity: AlertSeverity
  scope: 'fleet' | 'device' | 'single'
  devices: string[]
  members: MonAlert[]
  rootCauseHint?: string
}

const METRIC_LABEL: Record<string, string> = {
  cpu_util: 'High CPU', mem_util: 'High memory',
  interface_errors_in: 'Interface errors (in)', interface_errors_out: 'Interface errors (out)',
  pfc_drops: 'PFC drops', bgp_sessions_up: 'BGP sessions down',
}

const FLEET_HINT: Record<string, string> = {
  bgp_sessions_up: 'Multiple devices lost BGP — check route-reflectors/spines or a shared underlay fault',
  cpu_util: 'Fleet-wide high CPU — possible control-plane event (route churn / scan / DDoS)',
  mem_util: 'Fleet-wide high memory — possible leak after a common change/image',
  interface_errors_in: 'Widespread interface errors — check a shared optics/cabling/SFP batch',
  interface_errors_out: 'Widespread interface errors — check a shared optics/cabling/SFP batch',
  pfc_drops: 'Fleet-wide PFC drops — RoCEv2 congestion / PFC storm across the fabric',
}

function maxSev(alerts: MonAlert[]): AlertSeverity {
  return alerts.some(a => a.severity === 'critical') ? 'critical'
    : alerts.some(a => a.severity === 'warning') ? 'warning' : 'info'
}

/**
 * Correlate the fleet's flat alert list into grouped events:
 *  1. fleet-wide  — the same metric breached on ≥ `fleetMin` devices,
 *  2. device-level — a single device with ≥2 (remaining) alerts,
 *  3. single      — everything else, passed through.
 * Each event carries the collapsed member alerts + a root-cause hint.
 */
export function correlateAlerts(fleet: FleetHealth, fleetMin = 3): CorrelatedEvent[] {
  const events: CorrelatedEvent[] = []
  const claimed = new Set<MonAlert>()

  // 1. Fleet-wide: same metric across many devices.
  const byMetric = new Map<string, MonAlert[]>()
  for (const a of fleet.alerts) (byMetric.get(a.metric) ?? byMetric.set(a.metric, []).get(a.metric)!).push(a)
  for (const [metric, list] of byMetric) {
    const devices = [...new Set(list.map(a => a.device))]
    if (devices.length >= fleetMin) {
      list.forEach(a => claimed.add(a))
      events.push({
        id: `fleet:${metric}`,
        title: `Fleet-wide: ${METRIC_LABEL[metric] ?? metric} on ${devices.length} devices`,
        severity: maxSev(list), scope: 'fleet', devices, members: list,
        rootCauseHint: FLEET_HINT[metric],
      })
    }
  }

  // 2. Device-level: a device with ≥2 remaining alerts.
  const remaining = fleet.alerts.filter(a => !claimed.has(a))
  const byDevice = new Map<string, MonAlert[]>()
  for (const a of remaining) (byDevice.get(a.device) ?? byDevice.set(a.device, []).get(a.device)!).push(a)
  for (const [device, list] of byDevice) {
    if (list.length >= 2) {
      list.forEach(a => claimed.add(a))
      const metrics = new Set(list.map(a => a.metric))
      let hint: string | undefined
      if (metrics.has('bgp_sessions_up')) hint = 'Control plane down on this device — triage first'
      else if (metrics.has('cpu_util') && metrics.has('mem_util')) hint = 'Resource exhaustion (CPU + memory) on this device'
      events.push({
        id: `device:${device}`,
        title: `${device}: ${list.length} correlated issues (${[...metrics].map(m => METRIC_LABEL[m] ?? m).join(', ')})`,
        severity: maxSev(list), scope: 'device', devices: [device], members: list,
        rootCauseHint: hint,
      })
    }
  }

  // 3. Singletons.
  for (const a of fleet.alerts) {
    if (claimed.has(a)) continue
    events.push({
      id: `single:${a.device}:${a.metric}`,
      title: `${a.device}: ${a.message}`,
      severity: a.severity, scope: 'single', devices: [a.device], members: [a],
    })
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }
  const scopeRank: Record<CorrelatedEvent['scope'], number> = { fleet: 0, device: 1, single: 2 }
  return events.sort((a, b) =>
    rank[a.severity] - rank[b.severity] || scopeRank[a.scope] - scopeRank[b.scope])
}

// ── Per-interface drill-down (T7) ────────────────────────────────────────────
// The device-level model only carries AGGREGATE interface errors, so the NOC
// can't see WHICH port is the problem. This models a deterministic set of
// interfaces per device (same device+tick → same output), distributes the
// device's aggregate error counters onto a "culprit" port, and analyzes each
// interface into up/degraded/down with actionable issues.

export interface InterfaceMetric {
  name: string
  operUp: boolean
  speedGbps: number
  utilInPct: number
  utilOutPct: number
  errorsIn: number
  errorsOut: number
  crcErrors: number
  discards: number
}

export interface InterfaceIssue {
  iface: string
  severity: AlertSeverity
  message: string
}

export interface InterfaceAnalysis {
  issues: InterfaceIssue[]     // sorted most-severe first
  upCount: number
  downCount: number
}

// Self-contained deterministic PRNG (FNV-1a hash + sine fract) so the lib
// stays pure and the drill-down is stable for a given device + tick.
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function prand(seed: number, tick: number): number {
  const x = Math.sin((seed % 100000) * 12.9898 + tick * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Aggregate hints from the device-level sample so the drill-down agrees
 *  with the card (the device's error counters land on real ports). */
export interface InterfaceAggHint {
  errorsIn?: number
  errorsOut?: number
  throughputMbps?: number
}

/**
 * Deterministically model a device's interfaces for one tick. Role-aware
 * naming/speed (access → Gi1/0/N @1G, leaf → Eth1/N @100G, spine → Eth1/N
 * @400G). A port occasionally goes oper-down and stays down for ~8 ticks;
 * aggregate error counters are pinned to one deterministic culprit port.
 */
export function simulateInterfaces(
  device: string,
  role: string,
  tick: number,
  agg: InterfaceAggHint = {},
  portCount = 8,
): InterfaceMetric[] {
  const r = role.toLowerCase()
  const isAccess = r.includes('access')
  const isSpine = r.includes('spine') || r.includes('core')
  const prefix = isAccess ? 'Gi1/0/' : 'Eth1/'
  const speedGbps = isAccess ? 1 : isSpine ? 400 : 100

  const devSeed = hashStr(device)
  const culprit = devSeed % portCount           // port that owns the aggregate errors
  const ifaces: InterfaceMetric[] = []

  for (let i = 0; i < portCount; i++) {
    const seed = devSeed + i * 97
    // Sticky oper-down: re-rolled every 8 ticks so a down port stays down a while.
    const operUp = prand(seed + 7, Math.floor(tick / 8)) <= 0.97

    // Utilization: split the device throughput across up ports + variance.
    const share = agg.throughputMbps
      ? (agg.throughputMbps / portCount) / (speedGbps * 1000) * 100
      : 15
    const congested = prand(seed + 3, tick) > 0.93
    const base = Math.min(99, share * (0.5 + prand(seed + 1, tick)))
    const utilIn = operUp ? Math.round(Math.min(99, congested ? 88 + prand(seed + 4, tick) * 11 : base) * 10) / 10 : 0
    const utilOut = operUp ? Math.round(Math.min(99, base * (0.6 + prand(seed + 2, tick) * 0.8)) * 10) / 10 : 0

    const isCulprit = i === culprit
    ifaces.push({
      name: `${prefix}${i + 1}`,
      operUp,
      speedGbps,
      utilInPct: utilIn,
      utilOutPct: utilOut,
      errorsIn: isCulprit ? (agg.errorsIn ?? 0) : 0,
      errorsOut: isCulprit ? (agg.errorsOut ?? 0) : 0,
      crcErrors: isCulprit && (agg.errorsIn ?? 0) > 0 ? Math.floor((agg.errorsIn ?? 0) * 0.6) : 0,
      discards: congested ? Math.floor(prand(seed + 5, tick) * 40) : 0,
    })
  }
  return ifaces
}

/** Analyze modeled interfaces into per-port issues + an up/down summary. */
export function analyzeInterfaces(ifaces: InterfaceMetric[]): InterfaceAnalysis {
  const issues: InterfaceIssue[] = []
  let upCount = 0

  for (const f of ifaces) {
    if (!f.operUp) {
      issues.push({ iface: f.name, severity: 'critical', message: `${f.name} operationally DOWN` })
      continue
    }
    upCount++
    if (f.crcErrors >= 200) {
      issues.push({ iface: f.name, severity: 'critical', message: `${f.name}: ${f.crcErrors} CRC errors — replace optic/cable` })
    } else if (f.crcErrors >= 50) {
      issues.push({ iface: f.name, severity: 'warning', message: `${f.name}: ${f.crcErrors} CRC errors — check optic/cable` })
    }
    const util = Math.max(f.utilInPct, f.utilOutPct)
    if (util >= 95) {
      issues.push({ iface: f.name, severity: 'critical', message: `${f.name}: ${util}% utilization — congested` })
    } else if (util >= 85) {
      issues.push({ iface: f.name, severity: 'warning', message: `${f.name}: ${util}% utilization — approaching capacity` })
    }
    if (f.discards >= 30) {
      issues.push({ iface: f.name, severity: 'warning', message: `${f.name}: ${f.discards} discards — queue drops` })
    }
    if ((f.errorsIn + f.errorsOut) >= 50 && f.crcErrors < 50) {
      issues.push({ iface: f.name, severity: 'warning', message: `${f.name}: ${f.errorsIn + f.errorsOut} interface errors` })
    }
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }
  issues.sort((a, b) => rank[a.severity] - rank[b.severity])
  return { issues, upCount, downCount: ifaces.length - upCount }
}
