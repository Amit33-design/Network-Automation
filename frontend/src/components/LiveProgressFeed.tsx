/**
 * LiveProgressFeed — real-time WebSocket deploy event stream.
 *
 * Connects to /ws/deploy/{deploymentId} and renders each stage event
 * as a timeline card. Replaces the vanilla-JS LiveDeployFeed in deploy.js.
 *
 * Usage:
 *   <LiveProgressFeed deploymentId={id} onComplete={handleComplete} />
 */
import React, { useEffect, useRef } from 'react'
import { useStore, selectDeployFlow } from '@/store'
import { openDeployStream } from '@/api/client'
import type { DeployEvent, DeployStage } from '@/types'

// ── Stage metadata ────────────────────────────────────────────────────────────

const STAGE_META: Record<DeployStage, { label: string; icon: string }> = {
  pre_checks:  { label: 'Pre-Checks',   icon: '🔍' },
  deploy:      { label: 'Push Configs', icon: '🚀' },
  post_checks: { label: 'Post-Checks',  icon: '✅' },
  rollback:    { label: 'Rollback',     icon: '↩️' },
  error:       { label: 'Error',        icon: '❌' },
}

const TERMINAL_STAGES = new Set<DeployStage>(['post_checks', 'error', 'rollback'])

// ── Status → CSS class ────────────────────────────────────────────────────────

function statusClass(stage: DeployStage, status: string): string {
  if (stage === 'error' || status === 'failed' || status === 'error') return 'lp-err'
  if (stage === 'rollback') return 'lp-warn'
  if (status === 'passed' || status === 'success' || status === 'terminal') return 'lp-ok'
  if (status === 'running') return 'lp-info'
  return 'lp-dim'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  deploymentId: string
  onComplete?: (finalStatus: 'success' | 'failed' | 'rolled_back') => void
}

export function LiveProgressFeed({ deploymentId, onComplete }: Props) {
  const { deployEvents, deployStatus, addDeployEvent, setDeployStatus } = useStore(selectDeployFlow)
  const wsRef    = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!deploymentId) return

    wsRef.current = openDeployStream(
      deploymentId,
      (event: DeployEvent) => {
        addDeployEvent(event)

        // Update aggregate status
        if (event.stage === 'pre_checks' && event.status === 'running') setDeployStatus('pre_checks')
        if (event.stage === 'deploy'     && event.status === 'running') setDeployStatus('deploying')
        if (event.stage === 'post_checks'&& event.status === 'running') setDeployStatus('post_checks')

        // Terminal events
        if (TERMINAL_STAGES.has(event.stage) && event.status === 'terminal') {
          const final =
            event.stage === 'post_checks' ? 'success'
            : event.stage === 'rollback'  ? 'rolled_back'
            : 'failed'
          setDeployStatus(final === 'success' ? 'done' : 'failed')
          wsRef.current?.close()
          onComplete?.(final)
        }
      },
      () => { /* onClose — no-op, handled via terminal event above */ },
      () => { setDeployStatus('failed') },
    )

    return () => { wsRef.current?.close() }
  }, [deploymentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [deployEvents.length])

  const statusLabel: Record<string, string> = {
    idle:        '⏸ Idle',
    pre_checks:  '🔍 Running Pre-Checks…',
    deploying:   '🚀 Pushing Configs…',
    post_checks: '✅ Verifying…',
    done:        '✅ Complete',
    failed:      '❌ Failed',
  }

  return (
    <div className="lp-feed">
      <div className="lp-status-bar">
        <span className={`lp-badge lp-badge-${deployStatus}`}>
          {statusLabel[deployStatus] ?? deployStatus}
        </span>
        <span className="lp-dep-id">ID: {deploymentId.slice(0, 8)}…</span>
      </div>

      <div className="lp-events" role="log" aria-live="polite">
        {deployEvents.length === 0 && (
          <div className="lp-placeholder">Connecting to deploy stream…</div>
        )}
        {deployEvents.map((ev, i) => {
          const meta = STAGE_META[ev.stage]
          return (
            <div key={i} className={`lp-event ${statusClass(ev.stage, ev.status)}`}>
              <span className="lp-event-icon">{meta?.icon ?? 'ℹ️'}</span>
              <span className="lp-event-stage">{meta?.label ?? ev.stage}</span>
              <span className="lp-event-status">{ev.status}</span>
              {ev.detail && <span className="lp-event-detail">{ev.detail}</span>}
              {ev.timestamp && (
                <span className="lp-event-ts">
                  {new Date(ev.timestamp * 1000).toLocaleTimeString()}
                </span>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
