import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore, authScopeKey } from '@/store/useAuthStore'
import { cn } from '@/lib/utils'
import type { AppState, UserActivity } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SavedDesign {
  id: string
  name: string
  savedAt: string
  state: AppState
}

const STORAGE_KEY_BASE = 'netdesign-saved-designs'

function storageKey(): string {
  const scope = authScopeKey()
  return scope === 'guest' ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}:${scope}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadDesigns(): SavedDesign[] {
  try {
    const raw = localStorage.getItem(storageKey())
    return raw ? (JSON.parse(raw) as SavedDesign[]) : []
  } catch {
    return []
  }
}

function persistDesigns(designs: SavedDesign[]) {
  localStorage.setItem(storageKey(), JSON.stringify(designs))
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const ACTION_ICONS: Record<string, string> = {
  created: '+',
  updated: '~',
  loaded: '^',
  deployed: '>',
  exported: 'v',
  deleted: 'x',
}

const ACTION_COLORS: Record<string, string> = {
  created: 'text-green-400',
  updated: 'text-blue-400',
  loaded: 'text-cyan-400',
  deployed: 'text-purple-400',
  exported: 'text-amber-400',
  deleted: 'text-red-400',
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MyDesignsProps {
  open: boolean
  onClose: () => void
}

export function MyDesigns({ open, onClose }: MyDesignsProps) {
  const [designs, setDesigns] = useState<SavedDesign[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [tab, setTab] = useState<'designs' | 'activity'>('designs')
  const logActivity = useAuthStore(s => s.logActivity)
  const getActivities = useAuthStore(s => s.getActivities)
  const user = useAuthStore(s => s.user)
  const [activities, setActivities] = useState<UserActivity[]>([])

  useEffect(() => {
    if (open) {
      setDesigns(loadDesigns())
      setActivities(getActivities())
    }
  }, [open, getActivities])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  function showNote(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 2500)
  }

  function handleSave() {
    const rawName = window.prompt('Enter a name for this design:', 'My Design')
    if (rawName === null) return
    const name = rawName.trim() || `Design ${new Date().toLocaleString()}`

    const currentState = useAppStore.getState() as AppState
    const newDesign: SavedDesign = {
      id: crypto.randomUUID(),
      name,
      savedAt: new Date().toISOString(),
      state: currentState,
    }

    const updated = [newDesign, ...designs]
    persistDesigns(updated)
    setDesigns(updated)
    logActivity('created', name, currentState.useCase || 'unknown')
    setActivities(getActivities())

    if (user) {
      useAuthStore.getState().setPrefs({ lastUseCase: currentState.useCase || undefined })
    }

    showNote(`"${name}" saved successfully.`)
  }

  function handleLoad(design: SavedDesign) {
    useAppStore.setState(design.state)
    logActivity('loaded', design.name, design.state.useCase || 'unknown')
    showNote(`"${design.name}" loaded.`)
    onClose()
  }

  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    const target = designs.find(d => d.id === id)
    const updated = designs.filter(d => d.id !== id)
    persistDesigns(updated)
    setDesigns(updated)
    setConfirmDeleteId(null)
    if (target) {
      logActivity('deleted', target.name, target.state.useCase || 'unknown')
      setActivities(getActivities())
    }
    showNote('Design deleted.')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal="true" role="dialog" aria-label="My Designs">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">My Designs</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {user ? `Signed in as ${user.name}` : 'Guest mode — sign in to namespace designs'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors cursor-pointer"
            >
              + Save Current
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors cursor-pointer text-xl leading-none" aria-label="Close">
              x
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 shrink-0">
          <button
            onClick={() => setTab('designs')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors',
              tab === 'designs' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200',
            )}
          >
            Saved ({designs.length})
          </button>
          <button
            onClick={() => setTab('activity')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors',
              tab === 'activity' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200',
            )}
          >
            Recent Activity
          </button>
        </div>

        {/* Notification banner */}
        {notification && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm shrink-0">
            {notification}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {tab === 'designs' ? (
            designs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-3">&#x1F4BE;</div>
                <div className="text-sm">No saved designs yet.</div>
                <div className="text-xs mt-1">Click &quot;Save Current&quot; to create one.</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {designs.map(design => (
                  <div
                    key={design.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-200 truncate">{design.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                        <span>{formatDate(design.savedAt)}</span>
                        {design.state.useCase && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wide text-[10px] font-bold">
                            {design.state.useCase}
                          </span>
                        )}
                        {design.state.scale && (
                          <span className="text-gray-600">{design.state.scale}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleLoad(design)}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/40 transition-colors cursor-pointer"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => handleDelete(design.id)}
                      onBlur={() => setConfirmDeleteId(null)}
                      className={cn(
                        'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                        confirmDeleteId === design.id
                          ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/40'
                          : 'bg-white/5 text-gray-500 border border-white/10 hover:text-red-400 hover:border-red-500/30',
                      )}
                      title={confirmDeleteId === design.id ? 'Click again to confirm delete' : 'Delete design'}
                    >
                      {confirmDeleteId === design.id ? 'Confirm?' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            // ── Activity tab ──
            activities.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-3">&#x1F4CB;</div>
                <div className="text-sm">No activity yet.</div>
                <div className="text-xs mt-1">{user ? 'Your design actions will appear here.' : 'Sign in to track activity.'}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {activities.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors">
                    <span className={cn('w-5 h-5 rounded flex items-center justify-center text-xs font-bold bg-white/5', ACTION_COLORS[a.action] ?? 'text-gray-400')}>
                      {ACTION_ICONS[a.action] ?? '?'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">
                        <span className="capitalize">{a.action}</span>{' '}
                        <span className="font-semibold">{a.designName}</span>
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span>{relativeTime(a.timestamp)}</span>
                        {a.useCase && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wide text-[10px] font-bold">
                            {a.useCase}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 pt-2 text-xs text-gray-600 shrink-0 border-t border-white/5">
          {tab === 'designs'
            ? `${designs.length} design${designs.length !== 1 ? 's' : ''} saved`
            : `${activities.length} action${activities.length !== 1 ? 's' : ''} tracked`}
          {' '}&middot; Press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
