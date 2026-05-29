import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { MyDesigns } from '@/components/MyDesigns'
import { ConfigPolicyModal } from '@/components/ConfigPolicyModal'
import { ExportModal } from '@/components/ExportModal'
import { PolicyRulesEditor } from '@/components/PolicyRulesEditor'

interface SidebarProps {
  onGoHome: () => void
  onShowTroubleshooting: () => void
  showTroubleshooting: boolean
}

const DESIGN_STEPS = [
  { step: 1, label: 'Use Case',      icon: '🎯' },
  { step: 2, label: 'Requirements',  icon: '📋' },
]
const CONFIG_STEPS = [
  { step: 3, label: 'Products & BOM',  icon: '🛒' },
  { step: 4, label: 'Network Design',  icon: '📐' },
  { step: 5, label: 'Config Gen',      icon: '⚙️' },
]
const DEPLOY_STEPS = [
  { step: 6, label: 'Deploy & Validate', icon: '🚀' },
]

export function Sidebar({ onGoHome, onShowTroubleshooting, showTroubleshooting }: SidebarProps) {
  const step    = useAppStore(s => s.step)
  const setStep = useAppStore(s => s.setStep)
  const devices = useAppStore(s => s.devices)
  const configs = useAppStore(s => s.configs)
  const [collapsed, setCollapsed] = useState(false)
  const [deployOpen, setDeployOpen] = useState(true)
  const [showMyDesigns, setShowMyDesigns] = useState(false)
  const [showConfigPolicy, setShowConfigPolicy] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showPolicyRules, setShowPolicyRules] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  function nav(n: number) { setStep(n) }

  function handleShare() {
    const json = JSON.stringify(useAppStore.getState())
    const encoded = btoa(encodeURIComponent(json))
    const url = `${window.location.origin}${window.location.pathname}?design=${encoded}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    }).catch(() => {
      // fallback: still update URL
      window.history.replaceState(null, '', `?design=${encoded}`)
    })
  }

  const itemCls = (n: number) => cn(
    'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-left',
    step === n
      ? 'bg-blue-600/20 border border-blue-500/30 text-blue-300 font-semibold'
      : n < step
      ? 'text-green-400 hover:bg-white/5'
      : 'text-gray-400 hover:bg-white/5 hover:text-gray-200',
  )

  if (collapsed) {
    return (
      <aside className="w-12 bg-gray-900/80 border-r border-white/10 flex flex-col items-center py-4 gap-4 shrink-0">
        <button onClick={() => setCollapsed(false)} className="text-gray-400 hover:text-gray-200 cursor-pointer text-lg" title="Expand sidebar">☰</button>
        {[...DESIGN_STEPS, ...CONFIG_STEPS, ...DEPLOY_STEPS].map(s => (
          <button key={s.step} onClick={() => nav(s.step)} title={s.label}
            className={cn('w-8 h-8 rounded-lg text-base flex items-center justify-center cursor-pointer',
              step === s.step ? 'bg-blue-600/30 text-blue-300' : 'text-gray-500 hover:text-gray-300')}>
            {s.icon}
          </button>
        ))}
        <div className="mt-auto">
          <button onClick={onShowTroubleshooting} title="Troubleshooting Engine"
            className={cn('w-8 h-8 rounded-lg text-base flex items-center justify-center cursor-pointer',
              showTroubleshooting ? 'bg-orange-600/30 text-orange-300' : 'text-gray-500 hover:text-gray-300')}>
            🔬
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-56 shrink-0 bg-gray-900/80 border-r border-white/10 flex flex-col py-4 overflow-y-auto">
      {/* Logo + collapse */}
      <div className="flex items-center justify-between px-4 mb-6">
        <button onClick={onGoHome} className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
          <img src="/favicon.svg" alt="" className="w-6 h-6" />
          <span className="font-bold text-white text-sm">NetDesign <span className="text-blue-400">AI</span></span>
        </button>
        <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-gray-300 cursor-pointer text-sm" title="Collapse">◀</button>
      </div>

      {/* DESIGN group */}
      <div className="px-3 mb-1">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Design</div>
        {DESIGN_STEPS.map(s => (
          <button key={s.step} onClick={() => nav(s.step)} className={itemCls(s.step)}>
            <span className="text-base">{s.icon}</span>
            <span>{s.label}</span>
            {s.step < step && <span className="ml-auto text-xs text-green-500">✓</span>}
          </button>
        ))}
      </div>

      {/* CONFIGURATION group */}
      <div className="px-3 mb-1 mt-3">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Configuration</div>
        {CONFIG_STEPS.map(s => (
          <button key={s.step} onClick={() => nav(s.step)} className={itemCls(s.step)}>
            <span className="text-base">{s.icon}</span>
            <span>{s.label}</span>
            {s.step < step && <span className="ml-auto text-xs text-green-500">✓</span>}
          </button>
        ))}
      </div>

      {/* DEPLOY & VALIDATE group */}
      <div className="px-3 mb-1 mt-3">
        <button onClick={() => setDeployOpen(o => !o)}
          className="flex items-center justify-between w-full text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2 cursor-pointer hover:text-gray-300">
          <span>Deploy & Validate</span>
          <span>{deployOpen ? '▼' : '▶'}</span>
        </button>
        {deployOpen && DEPLOY_STEPS.map(s => (
          <button key={s.step} onClick={() => nav(s.step)} className={itemCls(s.step)}>
            <span className="text-base">{s.icon}</span>
            <span>{s.label}</span>
            {s.step < step && <span className="ml-auto text-xs text-green-500">✓</span>}
          </button>
        ))}
      </div>

      {/* TOOLS group */}
      <div className="px-3 mt-3">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Tools</div>
        <button onClick={onShowTroubleshooting}
          className={cn('flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer',
            showTroubleshooting
              ? 'bg-orange-600/20 border border-orange-500/30 text-orange-300 font-semibold'
              : 'text-gray-400 hover:bg-white/5 hover:text-gray-200')}>
          <span className="text-base">🔬</span>
          <span>Troubleshooting Engine</span>
        </button>
        <button onClick={() => setShowMyDesigns(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="text-base">💾</span>
          <span>My Designs</span>
        </button>
        <button onClick={() => setShowConfigPolicy(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="text-base">📜</span>
          <span>Config Policy</span>
        </button>
        <button onClick={() => setShowExport(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="text-base">📤</span>
          <span>Export</span>
        </button>
        <button onClick={handleShare}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="text-base">🔗</span>
          <span>{shareCopied ? 'Copied!' : 'Share Design'}</span>
        </button>
        <button onClick={() => setShowPolicyRules(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
          <span className="text-base">📋</span>
          <span>Policy Rules</span>
        </button>
      </div>

      {/* Step indicator at bottom */}
      <div className="mt-auto px-4 pt-4 border-t border-white/10">
        <div className="text-xs text-gray-600">Step {step} of 6</div>
        <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(step / 6) * 100}%` }} />
        </div>
      </div>

      {/* Modals */}
      <MyDesigns open={showMyDesigns} onClose={() => setShowMyDesigns(false)} />
      <ConfigPolicyModal open={showConfigPolicy} onClose={() => setShowConfigPolicy(false)} />
      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        devices={devices}
        configs={configs}
      />
      <PolicyRulesEditor open={showPolicyRules} onClose={() => setShowPolicyRules(false)} />
    </aside>
  )
}
