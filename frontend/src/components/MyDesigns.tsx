import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { AppState } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SavedDesign {
  id: string
  name: string
  savedAt: string
  state: AppState
}

const STORAGE_KEY = 'netdesign-saved-designs'

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadDesigns(): SavedDesign[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedDesign[]) : []
  } catch {
    return []
  }
}

function persistDesigns(designs: SavedDesign[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(designs))
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

// ── Component ─────────────────────────────────────────────────────────────────

interface MyDesignsProps {
  open: boolean
  onClose: () => void
}

export function MyDesigns({ open, onClose }: MyDesignsProps) {
  const [designs, setDesigns] = useState<SavedDesign[]>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)

  // Load from localStorage whenever the panel opens
  useEffect(() => {
    if (open) setDesigns(loadDesigns())
  }, [open])

  // Escape to close
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
    if (rawName === null) return // user cancelled
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
    showNote(`"${name}" saved successfully.`)
  }

  function handleLoad(design: SavedDesign) {
    useAppStore.setState(design.state)
    showNote(`"${design.name}" loaded.`)
    onClose()
  }

  function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    const updated = designs.filter(d => d.id !== id)
    persistDesigns(updated)
    setDesigns(updated)
    setConfirmDeleteId(null)
    showNote('Design deleted.')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal="true" role="dialog" aria-label="My Designs">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">My Designs</h2>
            <p className="text-xs text-gray-400 mt-0.5">Save, load, or delete design snapshots</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors cursor-pointer"
            >
              + Save Current Design
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors cursor-pointer text-xl leading-none" aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {/* Notification banner */}
        {notification && (
          <div className="mx-6 mt-3 px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm shrink-0">
            {notification}
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {designs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-3">💾</div>
              <div className="text-sm">No saved designs yet.</div>
              <div className="text-xs mt-1">Click &quot;Save Current Design&quot; to create one.</div>
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

                  {/* Load button */}
                  <button
                    onClick={() => handleLoad(design)}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/40 transition-colors cursor-pointer"
                  >
                    Load
                  </button>

                  {/* Delete button (with confirm) */}
                  <button
                    onClick={() => handleDelete(design.id)}
                    onBlur={() => setConfirmDeleteId(null)}
                    className={[
                      'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      confirmDeleteId === design.id
                        ? 'bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/40'
                        : 'bg-white/5 text-gray-500 border border-white/10 hover:text-red-400 hover:border-red-500/30',
                    ].join(' ')}
                    title={confirmDeleteId === design.id ? 'Click again to confirm delete' : 'Delete design'}
                  >
                    {confirmDeleteId === design.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 pt-2 text-xs text-gray-600 shrink-0 border-t border-white/5">
          {designs.length} design{designs.length !== 1 ? 's' : ''} saved &middot; Press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
