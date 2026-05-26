import { useEffect, useRef, useState } from 'react'
import { openDeployStream } from '@/api/client'
import { Badge } from '@/components/ui/Badge'
import type { DeployEvent } from '@/types'

const STAGE_VARIANT: Record<string, 'pass' | 'fail' | 'warn' | 'info' | 'neutral'> = {
  done:          'pass',
  failed:        'fail',
  pre_checks:    'info',
  post_checks:   'info',
  pushing_config:'warn',
  connecting:    'neutral',
  queued:        'neutral',
}

interface Props {
  deploymentId: string | null
  onDone?: () => void
}

export function LiveProgressFeed({ deploymentId, onDone }: Props) {
  const [events, setEvents]       = useState<DeployEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [closed, setClosed]       = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!deploymentId) return

    setEvents([])
    setConnected(false)
    setClosed(false)

    const ws = openDeployStream(
      deploymentId,
      (evt) => {
        setEvents(prev => [...prev, evt])
        if (evt.stage === 'done' || evt.stage === 'failed') {
          setClosed(true)
          onDone?.()
        }
      },
      () => setClosed(true),
    )

    wsRef.current = ws
    setConnected(true)

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [deploymentId, onDone])

  // Auto-scroll to latest event
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  if (!deploymentId) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-sm text-gray-500">No active deployment.</p>
      </div>
    )
  }

  const latest = events[events.length - 1]
  const progress = latest?.progress ?? 0

  return (
    <div className="space-y-3">
      {/* Header status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!closed && connected && (
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          )}
          <span className="text-sm font-medium text-gray-300">
            Deployment <code className="text-blue-400 text-xs">{deploymentId}</code>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {latest && (
            <Badge variant={STAGE_VARIANT[latest.stage] ?? 'neutral'}>
              {latest.stage.replace(/_/g, ' ')}
            </Badge>
          )}
          {closed && <Badge variant={latest?.stage === 'done' ? 'pass' : 'fail'}>
            {latest?.stage === 'done' ? 'Complete' : 'Failed'}
          </Badge>}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            latest?.stage === 'failed' ? 'bg-red-500' :
            latest?.stage === 'done'   ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Event log */}
      <div className="rounded-xl border border-white/10 bg-black/30 overflow-y-auto max-h-64 font-mono text-xs">
        {events.length === 0 ? (
          <div className="p-4 text-gray-600 text-center">Waiting for events…</div>
        ) : (
          <div className="p-3 space-y-1">
            {events.map((evt, i) => (
              <div key={i} className="flex gap-3 items-start">
                <span className="text-gray-600 shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString()}
                </span>
                {evt.device && (
                  <span className="text-blue-400 shrink-0">{evt.device}</span>
                )}
                <span className={
                  evt.stage === 'failed' ? 'text-red-400' :
                  evt.stage === 'done'   ? 'text-green-400' : 'text-gray-300'
                }>
                  {evt.message}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
