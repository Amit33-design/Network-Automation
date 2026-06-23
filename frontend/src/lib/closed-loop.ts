/**
 * Closed-loop remediation orchestration (K2).
 *
 * Models the full Day-2 remediation loop as a deterministic, demo-friendly
 * pipeline that composes the *existing* building blocks:
 *
 *   detect  → drift detection (ConfigDriftResponse, G-A4)
 *   plan    → remediation generation (ConfigRemediationResponse, G-A16)
 *   apply   → (simulated) push of remediation commands
 *   verify  → re-check: did the drift clear?
 *   done    → converged (all drift cleared) or diverged (some remain)
 *
 * Pure functions — no backend required. The orchestrator takes the drift and
 * remediation results (produced by the existing `simulateConfigDrift` /
 * `simulateRemediation` in demo mode, or the `/api/drift/*` endpoints when
 * live) and returns a stage timeline + per-device convergence so the UI can
 * render the loop as a single workflow.
 */
import type { ConfigDriftResponse, ConfigRemediationResponse } from '@/types'

export type LoopStageName = 'detect' | 'plan' | 'apply' | 'verify' | 'done'
export type LoopStatus = 'ok' | 'warn' | 'failed' | 'skipped'

export interface LoopStage {
  name: LoopStageName
  label: string
  status: LoopStatus
  detail: string
}

export interface DeviceLoopResult {
  hostname: string
  platform: string
  driftLinesBefore: number
  commandsApplied: number
  driftLinesAfter: number
  converged: boolean
}

export interface ClosedLoopResult {
  stages: LoopStage[]
  devices: DeviceLoopResult[]
  /** True when every drifted device converged (no residual drift). */
  converged: boolean
  summary: {
    devices: number
    drifted: number
    converged: number
    diverged: number
    commands: number
  }
}

export interface ClosedLoopOpts {
  /**
   * Hostnames where remediation fails to converge — the loop applies the
   * commands but the drift persists on verify (simulates a stubborn device
   * or an out-of-band change). Used for demo fault injection.
   */
  failDevices?: string[]
}

const STAGE_LABELS: Record<LoopStageName, string> = {
  detect: 'Detect drift',
  plan: 'Plan remediation',
  apply: 'Apply remediation',
  verify: 'Verify convergence',
  done: 'Loop complete',
}

/**
 * Run the closed-loop remediation pipeline over a drift + remediation result.
 * Only devices that actually drifted go through the loop; clean devices are
 * left untouched.
 */
export function runClosedLoop(
  drift: ConfigDriftResponse,
  remediation: ConfigRemediationResponse,
  opts: ClosedLoopOpts = {},
): ClosedLoopResult {
  const fail = new Set(opts.failDevices ?? [])
  const cmdByHost = new Map<string, { platform: string; count: number }>()
  for (const d of remediation.devices) {
    cmdByHost.set(d.hostname, { platform: d.platform, count: d.command_count })
  }

  const drifted = drift.devices.filter(d => d.has_drift)

  const devices: DeviceLoopResult[] = drifted.map(d => {
    const driftLinesBefore = d.added.length + d.removed.length
    const rem = cmdByHost.get(d.hostname)
    const commandsApplied = rem?.count ?? driftLinesBefore
    const converged = !fail.has(d.hostname)
    return {
      hostname: d.hostname,
      platform: rem?.platform ?? 'unknown',
      driftLinesBefore,
      commandsApplied,
      driftLinesAfter: converged ? 0 : driftLinesBefore,
      converged,
    }
  })

  const convergedCount = devices.filter(d => d.converged).length
  const divergedCount = devices.length - convergedCount
  const totalCommands = devices.reduce((n, d) => n + d.commandsApplied, 0)
  const allConverged = divergedCount === 0

  const stages: LoopStage[] = [
    {
      name: 'detect',
      label: STAGE_LABELS.detect,
      status: drifted.length > 0 ? 'warn' : 'ok',
      detail: `${drifted.length} of ${drift.device_count} device(s) drifted`,
    },
    {
      name: 'plan',
      label: STAGE_LABELS.plan,
      status: drifted.length > 0 ? 'ok' : 'skipped',
      detail: drifted.length > 0
        ? `Generated ${totalCommands} remediation command(s) across ${devices.length} device(s)`
        : 'No drift — nothing to remediate',
    },
    {
      name: 'apply',
      label: STAGE_LABELS.apply,
      status: drifted.length === 0 ? 'skipped' : divergedCount > 0 ? 'warn' : 'ok',
      detail: drifted.length === 0
        ? 'Skipped'
        : `Pushed ${totalCommands} command(s) to ${devices.length} device(s)`,
    },
    {
      name: 'verify',
      label: STAGE_LABELS.verify,
      status: drifted.length === 0 ? 'skipped' : allConverged ? 'ok' : 'failed',
      detail: drifted.length === 0
        ? 'Skipped'
        : `${convergedCount} converged, ${divergedCount} still drifting`,
    },
    {
      name: 'done',
      label: STAGE_LABELS.done,
      status: drifted.length === 0 ? 'ok' : allConverged ? 'ok' : 'failed',
      detail: drifted.length === 0
        ? 'No drift detected — system in sync'
        : allConverged
          ? 'All drift remediated — system converged'
          : `${divergedCount} device(s) failed to converge — escalate / roll back`,
    },
  ]

  return {
    stages,
    devices,
    converged: allConverged,
    summary: {
      devices: drift.device_count,
      drifted: drifted.length,
      converged: convergedCount,
      diverged: divergedCount,
      commands: totalCommands,
    },
  }
}

/** Render a closed-loop run as a plain-text report for download. */
export function closedLoopToText(result: ClosedLoopResult): string {
  const lines: string[] = [
    `# Closed-loop remediation report — ${new Date().toISOString()}`,
    '',
    '## Pipeline',
  ]
  for (const s of result.stages) {
    lines.push(`  [${s.status.toUpperCase().padEnd(7)}] ${s.label} — ${s.detail}`)
  }
  lines.push('', '## Devices')
  if (result.devices.length === 0) {
    lines.push('  (no drifted devices)')
  } else {
    for (const d of result.devices) {
      lines.push(
        `  ${d.hostname} (${d.platform}): ${d.driftLinesBefore} drift line(s) → ` +
        `${d.commandsApplied} command(s) → ${d.converged ? 'CONVERGED' : 'DIVERGED'}`,
      )
    }
  }
  lines.push(
    '',
    `## Result: ${result.converged ? 'CONVERGED' : 'DIVERGED'}`,
    `  ${result.summary.converged}/${result.summary.drifted} drifted device(s) converged ` +
    `(${result.summary.commands} command(s) applied)`,
    '',
  )
  return lines.join('\n')
}
