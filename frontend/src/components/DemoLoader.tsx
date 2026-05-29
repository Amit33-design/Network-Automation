import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { DEMO_TOPOLOGIES } from '@/data/demoTopologies'

const USE_CASE_COLORS: Record<string, string> = {
  dc:         'bg-blue-500/20 text-blue-300 border-blue-500/30',
  gpu:        'bg-purple-500/20 text-purple-300 border-purple-500/30',
  campus:     'bg-green-500/20 text-green-300 border-green-500/30',
  wan:        'bg-orange-500/20 text-orange-300 border-orange-500/30',
  multisite:  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  multicloud: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
}

const SCALE_LABELS: Record<string, string> = {
  small:  'S',
  medium: 'M',
  large:  'L',
}

export function DemoLoader() {
  const [open, setOpen] = useState(false)
  const loadDemoTopology = useAppStore(s => s.loadDemoTopology)
  const demoTopologyId = useAppStore(s => s.demoTopologyId)

  const active = DEMO_TOPOLOGIES.find(t => t.id === demoTopologyId)

  function handleLoad(id: string) {
    const topo = DEMO_TOPOLOGIES.find(t => t.id === id)
    if (topo) {
      loadDemoTopology(topo)
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border
          transition-all cursor-pointer
          ${active
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
            : 'bg-white/5 border-white/10 text-gray-400 hover:border-blue-500/30 hover:text-blue-300'
          }`}
      >
        <span className="text-base">{active ? active.icon : '🚀'}</span>
        <span className="flex-1 text-left truncate">
          {active ? active.label : 'Load Demo Topology'}
        </span>
        {active && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            DEMO
          </span>
        )}
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-white/10
          bg-gray-900/95 backdrop-blur-sm shadow-2xl shadow-black/60 overflow-hidden">
          <div className="px-3 py-2 border-b border-white/8">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Select a pre-built demo topology
            </p>
          </div>

          <div className="p-2 space-y-1 max-h-80 overflow-y-auto">
            {DEMO_TOPOLOGIES.map(t => {
              const isActive = t.id === demoTopologyId
              const colorClass = USE_CASE_COLORS[t.useCase] ?? 'bg-gray-500/20 text-gray-300 border-gray-500/30'
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleLoad(t.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-all cursor-pointer
                    ${isActive
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'border border-transparent hover:bg-white/5 hover:border-white/10'
                    }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base leading-none">{t.icon}</span>
                    <span className="font-semibold text-xs text-white flex-1 truncate">{t.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${colorClass}`}>
                      {t.useCase.toUpperCase()}
                    </span>
                    <span className="text-[9px] text-gray-500 font-mono">
                      {SCALE_LABELS[t.scale]}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-snug pl-6 line-clamp-2">
                    {t.description}
                  </p>
                  <div className="flex items-center gap-2 pl-6 mt-1">
                    <span className="text-[9px] text-gray-600">{t.siteCode}</span>
                    <span className="text-[9px] text-gray-600">·</span>
                    <span className="text-[9px] text-gray-600">{t.devices.length} devices</span>
                    {isActive && (
                      <span className="text-[9px] text-emerald-400 font-semibold ml-auto">✓ Active</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="px-3 py-2 border-t border-white/8 text-[10px] text-gray-600">
            Demo data loads into BOM — no backend required
          </div>
        </div>
      )}
    </div>
  )
}
