/**
 * Closed-loop automation — auto-rollback on post-check regression (K1).
 *
 * When a deployment's post-checks regress relative to the pre-deploy baseline
 * (a check that was PASS before the change now FAILs/WARNs), the change has
 * likely caused damage and should be rolled back. This module:
 *
 *   1. detectRegressions(pre, post)  — diffs pre vs post CheckResult[] and
 *      classifies every check that got *worse* by severity.
 *   2. generateRollbackPlan(...)     — for the affected devices, emits the
 *      platform-native rollback commands (CLAUDE.md §9 ROLLBACK_STRATEGIES,
 *      ported here from backend Python) so an operator can restore the
 *      pre-deploy checkpoint.
 *
 * Pure functions, no backend required — works in demo mode. The backend
 * (`backend/jobs/deploy_job.py::_initiate_rollback`) performs the *actual*
 * restore from captured backups; this is the design-time advisor + the
 * exact commands that restore would run.
 */
import type { CheckResult, BOMDevice } from '@/types'

// ── Platform model ──────────────────────────────────────────────────────────

export type Platform = 'nxos' | 'iosxe' | 'eos' | 'junos' | 'sonic'

export interface RollbackStrategy {
  /** Checkpoint/backup command to run *before* deploy (uses `{ts}` token). */
  pre?: string
  /** Restore command to run to roll back (uses `{ts}` token). */
  exec?: string
  /** Junos-style: deploy with auto-rollback if not confirmed. */
  deployCmd?: string
  note?: string
}

/**
 * Platform-native rollback strategies — mirror of CLAUDE.md §9
 * `ROLLBACK_STRATEGIES` (kept identical so the doc and code stay in sync).
 */
export const ROLLBACK_STRATEGIES: Record<Platform, RollbackStrategy> = {
  nxos: {
    pre: 'checkpoint pre-deploy-{ts}',
    exec: 'rollback running-config checkpoint pre-deploy-{ts} atomic',
  },
  iosxe: {
    pre: 'copy running-config flash:pre-deploy-{ts}.cfg',
    exec: 'configure replace flash:pre-deploy-{ts}.cfg force',
  },
  eos: {
    pre: 'copy running-config checkpoint://pre-deploy-{ts}',
    exec: 'rollback clean-config checkpoint://pre-deploy-{ts}',
  },
  junos: {
    deployCmd: 'commit confirmed 5',
    exec: 'rollback 1\ncommit',
    note: 'commit confirmed auto-reverts if the change is not confirmed within the window',
  },
  sonic: {
    pre: 'config save /etc/sonic/config_db_pre_{ts}.json',
    exec: 'config load /etc/sonic/config_db_pre_{ts}.json -y',
  },
}

/**
 * Map a BOM device's vendor + role to its rollback platform key. Mirrors the
 * config-gen dispatch (Cisco spine/leaf = NX-OS, Cisco edge/campus = IOS-XE)
 * and `telemetry-gen.ts::deviceOS`.
 */
export function vendorToPlatform(vendor: string, subLayer: string): Platform {
  switch (vendor) {
    case 'Cisco':
      return subLayer === 'spine' || subLayer === 'leaf' ? 'nxos' : 'iosxe'
    case 'Arista':
      return 'eos'
    case 'Juniper':
      return 'junos'
    case 'Dell EMC':
    case 'NVIDIA':
      return 'sonic'
    default:
      return 'iosxe'
  }
}

// ── Regression detection ────────────────────────────────────────────────────

export type CheckStatus = CheckResult['status']

export type Severity = 'critical' | 'major' | 'minor'

export interface Regression {
  device: string
  checkName: string
  fromStatus: CheckStatus
  toStatus: CheckStatus
  severity: Severity
  message: string
}

/** Ordinal health ranking — higher is worse. SKIP is neutral (excluded). */
const STATUS_RANK: Record<CheckStatus, number> = { PASS: 0, WARN: 1, FAIL: 2, SKIP: -1 }

function severityFor(from: CheckStatus, to: CheckStatus): Severity {
  if (from === 'PASS' && to === 'FAIL') return 'critical'
  if (to === 'FAIL') return 'major' // WARN → FAIL
  return 'minor' // PASS → WARN
}

/**
 * Compare pre-deploy and post-deploy checks, returning every check that
 * regressed (got strictly worse). Checks are matched on `device` + `name`.
 * SKIP results on either side are ignored (nothing meaningful to compare).
 */
export function detectRegressions(pre: CheckResult[], post: CheckResult[]): Regression[] {
  const preIndex = new Map<string, CheckResult>()
  for (const c of pre) preIndex.set(`${c.device}::${c.name}`, c)

  const regressions: Regression[] = []
  for (const p of post) {
    const baseline = preIndex.get(`${p.device}::${p.name}`)
    if (!baseline) continue
    const fromRank = STATUS_RANK[baseline.status]
    const toRank = STATUS_RANK[p.status]
    // Ignore SKIP on either side, and only flag a strict worsening.
    if (fromRank < 0 || toRank < 0 || toRank <= fromRank) continue
    regressions.push({
      device: p.device,
      checkName: p.name,
      fromStatus: baseline.status,
      toStatus: p.status,
      severity: severityFor(baseline.status, p.status),
      message: p.message,
    })
  }
  return regressions
}

// ── Rollback plan generation ────────────────────────────────────────────────

export interface DeviceRollbackPlan {
  device: string
  platform: Platform
  regressions: Regression[]
  /** Restore commands to roll the device back to its pre-deploy checkpoint. */
  commands: string[]
}

export interface RollbackPlan {
  regressions: Regression[]
  devices: DeviceRollbackPlan[]
  /** True when a rollback is advised (any critical or major regression). */
  recommended: boolean
  summary: { total: number; critical: number; major: number; minor: number; devices: number }
}

/** Format a Date as a checkpoint timestamp token, e.g. `20260622-053000`. */
export function rollbackTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** Build the platform-native restore commands for one device. */
export function rollbackCommandsFor(platform: Platform, ts: string): string[] {
  const strat = ROLLBACK_STRATEGIES[platform]
  if (!strat.exec) return []
  return strat.exec.replace(/\{ts\}/g, ts).split('\n')
}

/**
 * Diff pre/post checks, then for every device with a regression emit a
 * platform-native rollback command block. Rollback is *recommended* when any
 * regression is critical or major (a PASS/WARN → FAIL).
 */
export function generateRollbackPlan(
  pre: CheckResult[],
  post: CheckResult[],
  devices: BOMDevice[],
  ts: string = rollbackTimestamp(),
): RollbackPlan {
  const regressions = detectRegressions(pre, post)

  // Resolve hostname → platform via the BOM (fallback to iosxe).
  const platformByHost = new Map<string, Platform>()
  for (const d of devices) {
    platformByHost.set(d.hostname, vendorToPlatform(d.vendor, d.subLayer))
  }

  const byDevice = new Map<string, Regression[]>()
  for (const r of regressions) {
    const list = byDevice.get(r.device) ?? []
    list.push(r)
    byDevice.set(r.device, list)
  }

  const devicePlans: DeviceRollbackPlan[] = []
  for (const [device, regs] of byDevice) {
    const platform = platformByHost.get(device) ?? 'iosxe'
    devicePlans.push({
      device,
      platform,
      regressions: regs,
      commands: rollbackCommandsFor(platform, ts),
    })
  }
  // Stable order: worst-affected (most regressions) first, then by name.
  devicePlans.sort((a, b) => b.regressions.length - a.regressions.length || a.device.localeCompare(b.device))

  const summary = {
    total: regressions.length,
    critical: regressions.filter(r => r.severity === 'critical').length,
    major: regressions.filter(r => r.severity === 'major').length,
    minor: regressions.filter(r => r.severity === 'minor').length,
    devices: devicePlans.length,
  }

  return {
    regressions,
    devices: devicePlans,
    recommended: summary.critical > 0 || summary.major > 0,
    summary,
  }
}

/** Render a rollback plan as a copy/paste runbook (one block per device). */
export function rollbackPlanToText(plan: RollbackPlan, ts: string = rollbackTimestamp()): string {
  if (plan.devices.length === 0) return '! No regressions detected — no rollback required.\n'
  const lines: string[] = [
    `! Rollback runbook — generated ${new Date().toISOString()}`,
    `! Checkpoint tag: pre-deploy-${ts}`,
    `! ${plan.summary.total} regression(s) across ${plan.summary.devices} device(s)`,
    `! ${plan.summary.critical} critical, ${plan.summary.major} major, ${plan.summary.minor} minor`,
    '',
  ]
  for (const d of plan.devices) {
    lines.push(`! ===== ${d.device} (${d.platform}) =====`)
    for (const r of d.regressions) {
      lines.push(`!  ${r.checkName}: ${r.fromStatus} -> ${r.toStatus} [${r.severity}]`)
    }
    for (const c of d.commands) lines.push(c)
    lines.push('')
  }
  return lines.join('\n')
}
