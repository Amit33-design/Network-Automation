import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import {
  POLICY_CATALOG,
  POLICY_CATEGORIES,
  policyByCategory,
  type PolicyDef,
} from '@/lib/policies'

// ── Component ─────────────────────────────────────────────────────────────────

interface ConfigPolicyModalProps {
  open: boolean
  onClose: () => void
}

const CATEGORY_ICON: Record<string, string> = {
  'Management': '🛠️',
  'Security': '🛡️',
  'L2 Switching': '🔀',
  'L3 Routing': '🧭',
  'QoS & Voice': '📶',
}

export function ConfigPolicyModal({ open, onClose }: ConfigPolicyModalProps) {
  const policyBlocks = useAppStore(s => s.policyBlocks)
  const setPolicyBlocks = useAppStore(s => s.setPolicyBlocks)

  // Local copy so we can cancel without persisting
  const [selected, setSelected] = useState<Set<string>>(new Set(policyBlocks))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const grouped = policyByCategory()

  // Sync when modal opens
  useEffect(() => {
    if (open) setSelected(new Set(policyBlocks))
  }, [open, policyBlocks])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  function toggleBlock(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    setPolicyBlocks(Array.from(selected))
    onClose()
  }

  function handleSelectAll() {
    setSelected(new Set(POLICY_CATALOG.map(b => b.id)))
  }

  function handleClearAll() {
    setSelected(new Set())
  }

  function toggleCategory(cat: string) {
    const ids = (grouped[cat as keyof typeof grouped] ?? []).map(p => p.id)
    setSelected(prev => {
      const next = new Set(prev)
      const allOn = ids.every(id => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  if (!open) return null

  function renderBlock(block: PolicyDef) {
    const isSelected = selected.has(block.id)
    const isExpanded = expandedId === block.id

    return (
      <div
        key={block.id}
        className={[
          'rounded-xl border transition-all',
          isSelected ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/10 bg-white/5',
        ].join(' ')}
      >
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => toggleBlock(block.id)}
            className={[
              'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer',
              isSelected ? 'bg-blue-600 border-blue-500 text-white' : 'border-gray-600 bg-transparent hover:border-gray-400',
            ].join(' ')}
            aria-checked={isSelected}
            role="checkbox"
          >
            {isSelected && (
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <span className="text-lg shrink-0">{block.icon}</span>
          <div className="flex-1 min-w-0">
            <div className={['text-sm font-semibold', isSelected ? 'text-blue-200' : 'text-gray-300'].join(' ')}>
              {block.label}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">{block.description}</div>
          </div>

          <button
            onClick={() => setExpandedId(isExpanded ? null : block.id)}
            className="shrink-0 text-xs text-gray-600 hover:text-gray-300 cursor-pointer transition-colors px-2 py-1 rounded hover:bg-white/5"
            title={isExpanded ? 'Hide preview' : 'Show preview'}
          >
            {isExpanded ? '▲ Hide' : '▼ Preview'}
          </button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-3">
            <pre className="text-xs text-green-400 bg-gray-950 rounded-lg p-3 overflow-x-auto border border-white/5 font-mono leading-relaxed whitespace-pre">
              {previewFor(block)}
            </pre>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal="true" role="dialog" aria-label="Config Policy Blocks">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Config Policy Library</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Select enterprise policies to overlay onto generated device configs — applied per role &amp; platform
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors cursor-pointer text-xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-white/5 shrink-0">
          <span className="text-xs text-gray-500">
            {selected.size} of {POLICY_CATALOG.length} policies selected
          </span>
          <div className="flex gap-2">
            <button onClick={handleSelectAll} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer transition-colors">
              Select all
            </button>
            <span className="text-gray-700">|</span>
            <button onClick={handleClearAll} className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
              Clear all
            </button>
          </div>
        </div>

        {/* Body — categorized policy list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-5">
          {POLICY_CATEGORIES.map(cat => {
            const blocks = grouped[cat] ?? []
            if (!blocks.length) return null
            const onCount = blocks.filter(b => selected.has(b.id)).length
            return (
              <div key={cat} className="flex flex-col gap-2">
                {/* Category header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{CATEGORY_ICON[cat] ?? '📦'}</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">{cat}</h3>
                    <span className="text-[10px] text-gray-600">({onCount}/{blocks.length})</span>
                  </div>
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="text-[11px] text-blue-400/80 hover:text-blue-300 transition-colors cursor-pointer"
                  >
                    {blocks.every(b => selected.has(b.id)) ? 'Deselect group' : 'Select group'}
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {blocks.map(renderBlock)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <span className="text-xs text-gray-600">
            Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">Esc</kbd> to cancel
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
            >
              Apply {selected.size} Polic{selected.size === 1 ? 'y' : 'ies'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Build a representative preview from a synthetic device so the modal can show
// realistic CLI without a real BOM device in scope.
function previewFor(block: PolicyDef): string {
  const sampleRole = block.appliesTo.includes('*')
    ? 'leaf'
    : block.appliesTo[0]
  const sample = {
    id: 'preview',
    hostname: 'SAMPLE-DEVICE',
    role: sampleRole,
    subLayer: sampleRole,
    model: '',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 0,
    totalPrice: 0,
    speed: '',
    ports: 0,
    features: [],
  }
  const uc = block.useCases?.[0] ?? ''
  return block.render(sample as never, uc as never) ?? '! (applies on supported platforms only)'
}
