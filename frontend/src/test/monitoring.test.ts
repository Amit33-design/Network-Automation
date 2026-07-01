import { describe, it, expect } from 'vitest'
import {
  evaluateDevice, evaluateFleet, alertsToText, METRIC_THRESHOLDS, forecastMetric, correlateAlerts,
  recordAvailability, availabilityReport, type AvailabilityAcc,
  updateAlertHistory, ackAlert, alertHistoryList, type AlertHistory,
  simulateInterfaces, analyzeInterfaces, type InterfaceMetric,
} from '@/lib/monitoring'
import type { DeviceMetrics, MetricsSummary } from '@/types'

const m = (o: Partial<DeviceMetrics> = {}): DeviceMetrics => ({
  cpu_util: 20, mem_util: 40, interface_errors_in: 0, interface_errors_out: 0,
  bgp_sessions_up: 3, bgp_prefixes_received: 500, pfc_drops: 0, throughput_mbps: 1000, ...o,
})

describe('evaluateDevice', () => {
  it('healthy when all metrics are within thresholds', () => {
    const d = evaluateDevice('SPINE-01', 'spine', m())
    expect(d.status).toBe('healthy')
    expect(d.alerts).toHaveLength(0)
  })

  it('warning CPU → degraded with a warning alert', () => {
    const d = evaluateDevice('SPINE-01', 'spine', m({ cpu_util: 80 }))
    expect(d.status).toBe('degraded')
    const a = d.alerts.find(x => x.metric === 'cpu_util')!
    expect(a.severity).toBe('warning')
    expect(a.threshold).toBe(75)
  })

  it('critical memory → degraded with a critical alert', () => {
    const d = evaluateDevice('LF-01', 'leaf', m({ mem_util: 95 }))
    expect(d.status).toBe('degraded')
    expect(d.alerts.some(a => a.metric === 'mem_util' && a.severity === 'critical')).toBe(true)
  })

  it('routing device with 0 BGP sessions → down (control plane isolated)', () => {
    const d = evaluateDevice('SPINE-01', 'spine', m({ bgp_sessions_up: 0 }))
    expect(d.status).toBe('down')
    expect(d.alerts.some(a => a.metric === 'bgp_sessions_up' && a.severity === 'critical')).toBe(true)
  })

  it('access device with 0 BGP sessions is NOT down (no BGP expected)', () => {
    const d = evaluateDevice('ACC-01', 'access', m({ bgp_sessions_up: 0 }))
    expect(d.status).toBe('healthy')
    expect(d.alerts).toHaveLength(0)
  })

  it('CPU pegged at 99 → down', () => {
    const d = evaluateDevice('SPINE-01', 'spine', m({ cpu_util: 99 }))
    expect(d.status).toBe('down')
  })

  it('PFC drops over critical → degraded with alert', () => {
    const d = evaluateDevice('GPU-LEAF-01', 'leaf', m({ pfc_drops: 250 }))
    expect(d.alerts.some(a => a.metric === 'pfc_drops' && a.severity === 'critical')).toBe(true)
  })

  it('interface errors warn vs critical boundaries', () => {
    expect(evaluateDevice('X', 'spine', m({ interface_errors_in: 6 })).alerts[0].severity).toBe('warning')
    expect(evaluateDevice('X', 'spine', m({ interface_errors_in: 60 })).alerts[0].severity).toBe('critical')
  })

  it('honors custom thresholds', () => {
    const d = evaluateDevice('X', 'spine', m({ cpu_util: 50 }),
      METRIC_THRESHOLDS.map(t => t.metric === 'cpu_util' ? { ...t, warn: 40, critical: 45 } : t))
    expect(d.alerts.some(a => a.metric === 'cpu_util' && a.severity === 'critical')).toBe(true)
  })
})

describe('evaluateFleet', () => {
  const summary = (): MetricsSummary => ({
    timestamp: '2026-06-29T00:00:00Z',
    devices: {
      'SP-01': m(),                                  // healthy
      'LF-01': m({ cpu_util: 80 }),                  // degraded (warn)
      'LF-02': m({ bgp_sessions_up: 0 }),            // down (routing, no bgp)
      'AC-01': m({ bgp_sessions_up: 0 }),            // access (role via map), healthy
    },
  })

  it('rolls up health + alert counts, sorted most-severe-first', () => {
    const f = evaluateFleet(summary(), { roles: { 'SP-01': 'spine', 'LF-01': 'leaf', 'LF-02': 'leaf', 'AC-01': 'access' } })
    expect(f.summary.total).toBe(4)
    expect(f.summary.down).toBe(1)        // LF-02
    expect(f.summary.degraded).toBe(1)    // LF-01
    expect(f.summary.healthy).toBe(2)     // SP-01, AC-01
    expect(f.summary.critical).toBeGreaterThanOrEqual(1)
    expect(f.alerts[0].severity).toBe('critical')   // sorted critical-first
  })

  it('infers routing role from the device name when roles map absent', () => {
    const f = evaluateFleet({ timestamp: 't', devices: { 'DC-SPINE-09': m({ bgp_sessions_up: 0 }) } })
    expect(f.summary.down).toBe(1)        // name contains "spine" → routing
  })

  it('forecastMetric: rising series gives a positive slope + ETA to limit', () => {
    const f = forecastMetric([50, 55, 60, 65, 70], 90)
    expect(f.trend).toBe('rising')
    expect(f.slope).toBeGreaterThan(0)
    expect(f.etaTicks).toBe(4)   // 70→90 at ~5/tick
  })

  it('forecastMetric: flat series → flat, no ETA', () => {
    const f = forecastMetric([60, 60, 61, 60, 60], 90)
    expect(f.trend).toBe('flat')
    expect(f.etaTicks).toBeNull()
  })

  it('forecastMetric: falling series → falling, no ETA', () => {
    const f = forecastMetric([80, 70, 60, 50, 40], 90)
    expect(f.trend).toBe('falling')
    expect(f.etaTicks).toBeNull()
  })

  it('forecastMetric: too few samples → flat', () => {
    expect(forecastMetric([90, 95], 90).trend).toBe('flat')
  })

  it('alertsToText lists critical alerts and a clean message when none', () => {
    const f = evaluateFleet({ timestamp: 't', devices: { 'SP-01': m() } }, { roles: { 'SP-01': 'spine' } })
    expect(alertsToText(f)).toContain('No active alerts')
    const f2 = evaluateFleet({ timestamp: 't', devices: { 'SP-01': m({ cpu_util: 95 }) } }, { roles: { 'SP-01': 'spine' } })
    expect(alertsToText(f2)).toMatch(/\[CRIT\] SP-01: CPU/)
  })
})

describe('correlateAlerts', () => {
  const roles = (names: string[]) => Object.fromEntries(names.map(n => [n, 'spine']))

  it('collapses the same metric across many devices into one fleet-wide event', () => {
    const devices = Object.fromEntries(['SP-01', 'SP-02', 'LF-01', 'LF-02'].map(n => [n, m({ cpu_util: 95 })]))
    const fleet = evaluateFleet({ timestamp: 't', devices }, { roles: roles(Object.keys(devices)) })
    const events = correlateAlerts(fleet)
    const fleetEvt = events.find(e => e.scope === 'fleet')!
    expect(fleetEvt.title).toMatch(/Fleet-wide: High CPU on 4 devices/)
    expect(fleetEvt.members).toHaveLength(4)
    expect(fleetEvt.rootCauseHint).toMatch(/control-plane/i)
  })

  it('groups a single device with multiple issues into a device-level event', () => {
    const fleet = evaluateFleet(
      { timestamp: 't', devices: { 'SP-01': m({ cpu_util: 95, mem_util: 95 }) } },
      { roles: { 'SP-01': 'spine' } })
    const events = correlateAlerts(fleet)
    const dev = events.find(e => e.scope === 'device')!
    expect(dev.devices).toEqual(['SP-01'])
    expect(dev.members.length).toBeGreaterThanOrEqual(2)
    expect(dev.rootCauseHint).toMatch(/resource exhaustion/i)
  })

  it('device control-plane-down hint when bgp is among the device issues', () => {
    const fleet = evaluateFleet(
      { timestamp: 't', devices: { 'SP-01': m({ cpu_util: 95, bgp_sessions_up: 0 }) } },
      { roles: { 'SP-01': 'spine' } })
    const dev = correlateAlerts(fleet).find(e => e.scope === 'device')!
    expect(dev.rootCauseHint).toMatch(/control plane down/i)
  })

  it('passes isolated alerts through as single events, sorted critical-first', () => {
    const fleet = evaluateFleet(
      { timestamp: 't', devices: { 'SP-01': m({ cpu_util: 80 }), 'LF-09': m({ mem_util: 95 }) } },
      { roles: { 'SP-01': 'spine', 'LF-09': 'leaf' } })
    const events = correlateAlerts(fleet)
    expect(events.every(e => e.scope === 'single')).toBe(true)
    expect(events[0].severity).toBe('critical')   // LF-09 mem critical before SP-01 cpu warning
  })

  it('no alerts → no events', () => {
    const fleet = evaluateFleet({ timestamp: 't', devices: { 'SP-01': m() } }, { roles: { 'SP-01': 'spine' } })
    expect(correlateAlerts(fleet)).toHaveLength(0)
  })
})

describe('availability / SLA tracking', () => {
  const roles = { 'SP-01': 'spine', 'SP-02': 'spine' }
  const fleetAt = (sp1Bgp: number) => evaluateFleet(
    { timestamp: 't', devices: { 'SP-01': m({ bgp_sessions_up: sp1Bgp }), 'SP-02': m() } },
    { roles })

  it('accumulates up/total per device across ticks', () => {
    let acc: AvailabilityAcc = {}
    acc = recordAvailability(acc, fleetAt(3))   // SP-01 up
    acc = recordAvailability(acc, fleetAt(0))   // SP-01 down (routing, 0 bgp)
    acc = recordAvailability(acc, fleetAt(3))   // SP-01 up
    expect(acc['SP-01']).toEqual({ up: 2, total: 3 })
    expect(acc['SP-02']).toEqual({ up: 3, total: 3 })
  })

  it('availabilityReport computes pct, sorts worst-first, and rolls up fleet', () => {
    let acc: AvailabilityAcc = {}
    for (const b of [3, 0, 3, 3]) acc = recordAvailability(acc, fleetAt(b))  // SP-01 down 1/4
    const r = availabilityReport(acc)
    expect(r.samples).toBe(4)
    expect(r.devices[0].device).toBe('SP-01')      // worst first
    expect(r.devices[0].pct).toBe(75)              // 3/4 up
    expect(r.devices[0].down).toBe(1)
    expect(r.devices[1].pct).toBe(100)             // SP-02 always up
    expect(r.fleetPct).toBe(87.5)                  // (75 + 100) / 2
  })

  it('empty accumulator → 100% fleet, 0 samples', () => {
    const r = availabilityReport({})
    expect(r.fleetPct).toBe(100)
    expect(r.samples).toBe(0)
  })
})

describe('alert history + acknowledge', () => {
  const alertsAt = (cpu: number) => evaluateFleet(
    { timestamp: 't', devices: { 'SP-01': m({ cpu_util: cpu }) } }, { roles: { 'SP-01': 'spine' } }).alerts

  it('creates an entry on first fire and bumps count while firing', () => {
    let h: AlertHistory = {}
    h = updateAlertHistory(h, alertsAt(95), '2026-06-29T00:00:00Z')
    h = updateAlertHistory(h, alertsAt(96), '2026-06-29T00:00:15Z')
    const e = h['SP-01|cpu_util']
    expect(e.count).toBe(2)
    expect(e.firstSeen).toBe('2026-06-29T00:00:00Z')
    expect(e.lastSeen).toBe('2026-06-29T00:00:15Z')
    expect(e.clearedAt).toBeNull()
  })

  it('sets clearedAt when the alert stops firing', () => {
    let h: AlertHistory = {}
    h = updateAlertHistory(h, alertsAt(95), 't1')
    h = updateAlertHistory(h, alertsAt(20), 't2')   // healthy now → no alert
    const e = h['SP-01|cpu_util']
    expect(e.clearedAt).toBe('t1')                  // cleared at last-seen
  })

  it('re-fire after clear resets lifecycle (new firstSeen, ack cleared)', () => {
    let h: AlertHistory = {}
    h = updateAlertHistory(h, alertsAt(95), 't1')
    h = ackAlert(h, 'SP-01|cpu_util')
    h = updateAlertHistory(h, alertsAt(20), 't2')   // cleared
    h = updateAlertHistory(h, alertsAt(95), 't3')   // re-fired
    const e = h['SP-01|cpu_util']
    expect(e.firstSeen).toBe('t3')
    expect(e.clearedAt).toBeNull()
    expect(e.acked).toBe(false)
  })

  it('ackAlert is idempotent and preserved while firing', () => {
    let h: AlertHistory = {}
    h = updateAlertHistory(h, alertsAt(95), 't1')
    h = ackAlert(h, 'SP-01|cpu_util')
    h = ackAlert(h, 'SP-01|cpu_util')               // idempotent
    h = updateAlertHistory(h, alertsAt(96), 't2')   // still firing
    expect(h['SP-01|cpu_util'].acked).toBe(true)
  })

  it('alertHistoryList puts active before cleared', () => {
    let h: AlertHistory = {}
    h = updateAlertHistory(h, alertsAt(95), 't1')                  // SP-01 active
    // a separate device that clears
    const lf = evaluateFleet({ timestamp: 't', devices: { 'LF-01': m({ mem_util: 95 }) } }, { roles: { 'LF-01': 'leaf' } }).alerts
    h = updateAlertHistory(h, [...alertsAt(95), ...lf], 't2')
    h = updateAlertHistory(h, alertsAt(95), 't3')                 // LF-01 cleared, SP-01 active
    const list = alertHistoryList(h)
    expect(list[0].clearedAt).toBeNull()                          // active first
  })
})

describe('per-interface drill-down (T7)', () => {
  it('is deterministic for the same device + tick', () => {
    const a = simulateInterfaces('SP-01', 'spine', 5)
    const b = simulateInterfaces('SP-01', 'spine', 5)
    expect(a).toEqual(b)
  })

  it('role-aware naming and speed (access Gi @1G, spine Eth @400G, leaf @100G)', () => {
    expect(simulateInterfaces('AC-01', 'access', 1)[0].name).toMatch(/^Gi1\/0\/1$/)
    expect(simulateInterfaces('AC-01', 'access', 1)[0].speedGbps).toBe(1)
    expect(simulateInterfaces('SP-01', 'spine', 1)[0].name).toMatch(/^Eth1\/1$/)
    expect(simulateInterfaces('SP-01', 'spine', 1)[0].speedGbps).toBe(400)
    expect(simulateInterfaces('LF-01', 'leaf', 1)[0].speedGbps).toBe(100)
  })

  it('pins the device aggregate errors onto exactly one culprit port', () => {
    const ifaces = simulateInterfaces('LF-01', 'leaf', 3, { errorsIn: 42, errorsOut: 7 })
    const withErrors = ifaces.filter(f => f.errorsIn > 0 || f.errorsOut > 0)
    expect(withErrors).toHaveLength(1)
    expect(withErrors[0].errorsIn).toBe(42)
    expect(withErrors[0].errorsOut).toBe(7)
    // and the culprit port is stable across ticks
    const later = simulateInterfaces('LF-01', 'leaf', 9, { errorsIn: 10 })
    expect(later.find(f => f.errorsIn > 0)!.name).toBe(withErrors[0].name)
  })

  it('analyzeInterfaces: down port → critical, clean ports → no issues', () => {
    const down: InterfaceMetric = {
      name: 'Eth1/3', operUp: false, speedGbps: 100,
      utilInPct: 0, utilOutPct: 0, errorsIn: 0, errorsOut: 0, crcErrors: 0, discards: 0,
    }
    const clean: InterfaceMetric = { ...down, name: 'Eth1/1', operUp: true, utilInPct: 20, utilOutPct: 15 }
    const r = analyzeInterfaces([down, clean])
    expect(r.downCount).toBe(1)
    expect(r.upCount).toBe(1)
    expect(r.issues[0].severity).toBe('critical')
    expect(r.issues[0].message).toMatch(/DOWN/)
  })

  it('analyzeInterfaces: CRC + congestion thresholds', () => {
    const base: InterfaceMetric = {
      name: 'Eth1/1', operUp: true, speedGbps: 100,
      utilInPct: 10, utilOutPct: 10, errorsIn: 0, errorsOut: 0, crcErrors: 0, discards: 0,
    }
    const crcWarn = analyzeInterfaces([{ ...base, crcErrors: 60 }])
    expect(crcWarn.issues.some(i => i.severity === 'warning' && /CRC/.test(i.message))).toBe(true)
    const crcCrit = analyzeInterfaces([{ ...base, crcErrors: 250 }])
    expect(crcCrit.issues.some(i => i.severity === 'critical' && /CRC/.test(i.message))).toBe(true)
    const cong = analyzeInterfaces([{ ...base, utilInPct: 96 }])
    expect(cong.issues.some(i => i.severity === 'critical' && /congested/.test(i.message))).toBe(true)
    const warm = analyzeInterfaces([{ ...base, utilOutPct: 88 }])
    expect(warm.issues.some(i => i.severity === 'warning' && /capacity/.test(i.message))).toBe(true)
  })

  it('issues are sorted critical-first', () => {
    const base: InterfaceMetric = {
      name: 'Eth1/1', operUp: true, speedGbps: 100,
      utilInPct: 88, utilOutPct: 10, errorsIn: 0, errorsOut: 0, crcErrors: 0, discards: 0,
    }
    const down: InterfaceMetric = { ...base, name: 'Eth1/2', operUp: false, utilInPct: 0 }
    const r = analyzeInterfaces([base, down])
    expect(r.issues[0].severity).toBe('critical')
  })
})
