import { describe, it, expect } from 'vitest'
import {
  createWatcher,
  exportCronTab,
  exportSystemdTimer,
  exportScanScript,
  simulateScanHistory,
  watcherSummaryText,
  INTERVAL_PRESETS,
  type WatcherConfig,
} from '@/lib/scheduled-scans'

function watcher(overrides: Partial<WatcherConfig> = {}): WatcherConfig {
  return createWatcher({
    name: 'Test Watcher',
    scanType: 'both',
    intervalMinutes: 60,
    frameworks: ['PCI', 'SOC2'],
    action: 'report',
    enabled: true,
    ...overrides,
  })
}

describe('K3 — createWatcher', () => {
  it('assigns unique IDs', () => {
    const a = createWatcher()
    const b = createWatcher()
    expect(a.id).not.toBe(b.id)
  })

  it('fills defaults for empty partial', () => {
    const w = createWatcher()
    expect(w.name).toBe('Untitled Watcher')
    expect(w.scanType).toBe('both')
    expect(w.intervalMinutes).toBe(60)
    expect(w.enabled).toBe(true)
    expect(w.action).toBe('report')
    expect(w.scope).toBe('all')
  })

  it('respects overrides', () => {
    const w = createWatcher({ name: 'Nightly drift', scanType: 'drift', intervalMinutes: 1440 })
    expect(w.name).toBe('Nightly drift')
    expect(w.scanType).toBe('drift')
    expect(w.intervalMinutes).toBe(1440)
  })
})

describe('K3 — INTERVAL_PRESETS', () => {
  it('has at least 5 presets from 15m to weekly', () => {
    expect(INTERVAL_PRESETS.length).toBeGreaterThanOrEqual(5)
    expect(INTERVAL_PRESETS[0].minutes).toBe(15)
    expect(INTERVAL_PRESETS[INTERVAL_PRESETS.length - 1].minutes).toBe(10080)
  })
})

describe('K3 — exportCronTab', () => {
  it('generates a valid crontab with one enabled watcher', () => {
    const w = watcher({ intervalMinutes: 60 })
    const cron = exportCronTab([w])
    expect(cron).toContain('0 */1 * * *')
    expect(cron).toContain('scan-runner')
    expect(cron).toContain('--compliance --drift')
    expect(cron).toContain('--frameworks PCI,SOC2')
    expect(cron).toContain('--action report')
    expect(cron).toContain(w.name)
  })

  it('skips disabled watchers', () => {
    const w = watcher({ enabled: false })
    const cron = exportCronTab([w])
    expect(cron).not.toContain('scan-runner')
  })

  it('generates 15-min cron expression', () => {
    const w = watcher({ intervalMinutes: 15 })
    const cron = exportCronTab([w])
    expect(cron).toContain('*/15 * * * *')
  })

  it('generates daily cron (0 2 */1 * *)', () => {
    const w = watcher({ intervalMinutes: 1440 })
    const cron = exportCronTab([w])
    expect(cron).toMatch(/0 2 \*\/1 \* \*/)
  })

  it('generates weekly cron (0 2 * * 0)', () => {
    const w = watcher({ intervalMinutes: 10080 })
    const cron = exportCronTab([w])
    expect(cron).toContain('0 2 * * 0')
  })

  it('includes --drift-only for drift-only watcher', () => {
    const w = watcher({ scanType: 'drift' })
    const cron = exportCronTab([w])
    expect(cron).toContain('--drift-only')
    expect(cron).not.toContain('--compliance-only')
  })

  it('includes --compliance-only for compliance-only watcher', () => {
    const w = watcher({ scanType: 'compliance' })
    const cron = exportCronTab([w])
    expect(cron).toContain('--compliance-only')
    expect(cron).not.toContain('--drift-only')
  })

  it('includes --notify flag when email is set', () => {
    const w = watcher({ notifyEmail: 'ops@example.com' })
    const cron = exportCronTab([w])
    expect(cron).toContain('--notify ops@example.com')
  })

  it('includes --scope drifted when scope is drifted', () => {
    const w = watcher({ scope: 'drifted' })
    const cron = exportCronTab([w])
    expect(cron).toContain('--scope drifted')
  })

  it('handles multiple watchers', () => {
    const watchers = [
      watcher({ name: 'W1', intervalMinutes: 15 }),
      watcher({ name: 'W2', intervalMinutes: 1440, enabled: false }),
      watcher({ name: 'W3', intervalMinutes: 240 }),
    ]
    const cron = exportCronTab(watchers)
    expect(cron).toContain('W1')
    expect(cron).not.toContain('W2')
    expect(cron).toContain('W3')
  })
})

describe('K3 — exportSystemdTimer', () => {
  it('generates timer + service unit files', () => {
    const w = watcher({ name: 'Hourly compliance', intervalMinutes: 60 })
    const { timer, service } = exportSystemdTimer(w)
    expect(timer).toContain('[Timer]')
    expect(timer).toContain('OnUnitActiveSec=3600')
    expect(timer).toContain('timers.target')
    expect(timer).toContain('Hourly compliance')

    expect(service).toContain('[Service]')
    expect(service).toContain('Type=oneshot')
    expect(service).toContain('scan-runner')
    expect(service).toContain('--compliance --drift')
  })

  it('includes --remediate action flag', () => {
    const w = watcher({ action: 'remediate' })
    const { service } = exportSystemdTimer(w)
    expect(service).toContain('--action remediate')
  })
})

describe('K3 — exportScanScript', () => {
  it('generates a bash script with argument parsing', () => {
    const script = exportScanScript([watcher()])
    expect(script).toContain('#!/usr/bin/env bash')
    expect(script).toContain('set -euo pipefail')
    expect(script).toContain('--compliance-only')
    expect(script).toContain('--drift-only')
    expect(script).toContain('curl -sS -X POST')
    expect(script).toContain('/api/compliance/scan')
    expect(script).toContain('/api/drift/config')
  })
})

describe('K3 — simulateScanHistory', () => {
  it('returns the requested number of entries', () => {
    const w = watcher()
    const history = simulateScanHistory([w], 10, 8)
    expect(history).toHaveLength(8)
  })

  it('returns empty when no enabled watchers', () => {
    const w = watcher({ enabled: false })
    expect(simulateScanHistory([w], 10)).toHaveLength(0)
  })

  it('returns empty when device count is zero', () => {
    const w = watcher()
    expect(simulateScanHistory([w], 0)).toHaveLength(0)
  })

  it('populates all fields on each entry', () => {
    const w = watcher()
    const [entry] = simulateScanHistory([w], 5, 1)
    expect(entry.id).toBeTruthy()
    expect(entry.watcherId).toBe(w.id)
    expect(entry.watcherName).toBe(w.name)
    expect(entry.scanType).toBe('both')
    expect(entry.timestamp).toBeTruthy()
    expect(entry.durationMs).toBeGreaterThan(0)
    expect(entry.deviceCount).toBe(5)
    expect(['ok', 'warn', 'fail']).toContain(entry.status)
    expect(entry.detail).toBeTruthy()
  })

  it('entries are ordered most-recent first', () => {
    const history = simulateScanHistory([watcher()], 10, 5)
    for (let i = 0; i < history.length - 1; i++) {
      expect(new Date(history[i].timestamp).getTime())
        .toBeGreaterThanOrEqual(new Date(history[i + 1].timestamp).getTime())
    }
  })

  it('compliance-only scans have complianceScore but no driftCount', () => {
    const w = watcher({ scanType: 'compliance' })
    const history = simulateScanHistory([w], 10, 3)
    for (const e of history) {
      expect(e.complianceScore).not.toBeNull()
      expect(e.driftCount).toBeNull()
    }
  })

  it('drift-only scans have driftCount but no complianceScore', () => {
    const w = watcher({ scanType: 'drift' })
    const history = simulateScanHistory([w], 10, 3)
    for (const e of history) {
      expect(e.driftCount).not.toBeNull()
      expect(e.complianceScore).toBeNull()
    }
  })

  it('distributes entries across enabled watchers round-robin', () => {
    const w1 = watcher({ name: 'W1' })
    const w2 = watcher({ name: 'W2' })
    const history = simulateScanHistory([w1, w2], 10, 6)
    const w1Entries = history.filter(e => e.watcherName === 'W1')
    const w2Entries = history.filter(e => e.watcherName === 'W2')
    expect(w1Entries.length).toBe(3)
    expect(w2Entries.length).toBe(3)
  })
})

describe('K3 — watcherSummaryText', () => {
  it('returns "No active watchers" when all disabled', () => {
    expect(watcherSummaryText([watcher({ enabled: false })])).toBe('No active watchers')
  })

  it('summarizes enabled watchers', () => {
    const text = watcherSummaryText([
      watcher({ name: 'Hourly all', scanType: 'both', intervalMinutes: 60, action: 'report' }),
    ])
    expect(text).toContain('Hourly all')
    expect(text).toContain('both scan')
    expect(text).toContain('Every hour')
    expect(text).toContain('report')
  })
})
