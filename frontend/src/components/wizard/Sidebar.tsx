import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/store/useAuthStore'
import { LoginModal } from '@/components/LoginModal'
import { MyDesigns } from '@/components/MyDesigns'
import { ConfigPolicyModal } from '@/components/ConfigPolicyModal'
import { ExportModal } from '@/components/ExportModal'
import { PolicyRulesEditor } from '@/components/PolicyRulesEditor'
import { EnterpriseApprovals } from '@/components/EnterpriseApprovals'
import { IntegrationsPanel } from '@/components/IntegrationsPanel'
import { DemoLoader } from '@/components/DemoLoader'

interface SidebarProps {
  onGoHome: () => void
  onShowTroubleshooting: () => void
  showTroubleshooting: boolean
  /** Called whenever the user navigates to a wizard step — lets the host
   *  exit any full-page overlay (e.g. the Troubleshooting Engine) in a
   *  single click instead of requiring a separate toggle-off. */
  onNavigate?: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
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

const DEPLOY_SUB_ITEMS = [
  { tab: 'deploy',   icon: '🚀', label: 'Deploy Pipeline'  },
  { tab: 'ztp',      icon: '📡', label: 'ZTP Provisioning' },
  { tab: 'checks',   icon: '✅', label: 'Pre/Post Checks'  },
  { tab: 'netconf',  icon: '🖧', label: 'NETCONF'          },
  { tab: 'monitor',  icon: '📊', label: 'Monitoring'       },
  { tab: 'day2ops',  icon: '⚙️', label: 'Day-2 Ops'       },
  { tab: 'troubleshoot', icon: '🩺', label: 'Troubleshoot' },
  { tab: 'batfish',  icon: '🦟', label: 'Batfish Validate' },
]

export function Sidebar({ onGoHome, onShowTroubleshooting, showTroubleshooting, onNavigate, mobileOpen = false, onMobileClose }: SidebarProps) {
  const step              = useAppStore(s => s.step)
  const setStep           = useAppStore(s => s.setStep)
  const devices           = useAppStore(s => s.devices)
  const configs           = useAppStore(s => s.configs)
  const activeDeployTab   = useAppStore(s => s.activeDeployTab)
  const setActiveDeployTab = useAppStore(s => s.setActiveDeployTab)
  const user              = useAuthStore(s => s.user)
  const logout            = useAuthStore(s => s.logout)
  const can               = useAuthStore(s => s.can)
  const profiles          = useAuthStore(s => s.profiles)
  const switchProfile     = useAuthStore(s => s.switchProfile)
  const [collapsed, setCollapsed] = useState(false)
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false)
  const [deployOpen, setDeployOpen] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [showMyDesigns, setShowMyDesigns] = useState(false)
  const [showConfigPolicy, setShowConfigPolicy] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showPolicyRules, setShowPolicyRules] = useState(false)
  const [showApprovals, setShowApprovals] = useState(false)
  const [showIntegrations, setShowIntegrations] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  function nav(n: number) {
    onNavigate?.()
    setStep(n)
    onMobileClose?.()
  }

  // Role-gating: features hide only for a logged-in user lacking the
  // permission. Guests (no login) keep full access — demo-first philosophy.
  const gated = (permission: string) => !user || can(permission)

  function handleShare() {
    const json = JSON.stringify(useAppStore.getState())
    const encoded = btoa(encodeURIComponent(json))
    const url = `${window.location.origin}${window.location.pathname}?design=${encoded}`
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    }).catch(() => {
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

  // ── Modals (always mounted so they work regardless of sidebar state) ─────────
  const modals = (
    <>
      <MyDesigns open={showMyDesigns} onClose={() => setShowMyDesigns(false)} />
      <ConfigPolicyModal open={showConfigPolicy} onClose={() => setShowConfigPolicy(false)} />
      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        devices={devices}
        configs={configs}
      />
      <PolicyRulesEditor open={showPolicyRules} onClose={() => setShowPolicyRules(false)} />
      <EnterpriseApprovals open={showApprovals} onClose={() => setShowApprovals(false)} />
      <IntegrationsPanel open={showIntegrations} onClose={() => setShowIntegrations(false)} />
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  )

  const ROLE_BADGE: Record<string, string> = {
    viewer:   'bg-gray-500/20 text-gray-300',
    designer: 'bg-blue-500/20 text-blue-300',
    operator: 'bg-purple-500/20 text-purple-300',
    admin:    'bg-amber-500/20 text-amber-300',
  }

  const otherProfiles = profiles.filter(p => p.id !== user?.id)

  const accountBlock = (
    <div className="px-3 mb-4">
      {user ? (
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => otherProfiles.length > 0 && setShowProfileSwitcher(v => !v)}
              className={cn(
                'w-7 h-7 rounded-full bg-blue-600/30 text-blue-200 flex items-center justify-center text-xs font-bold uppercase shrink-0',
                otherProfiles.length > 0 ? 'cursor-pointer hover:bg-blue-600/50' : '',
              )}
              title={otherProfiles.length > 0 ? 'Switch profile' : user.name}
            >
              {(user.name || user.email || '?').slice(0, 2)}
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-200 truncate">{user.name || user.email}</div>
              <span className={cn('inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase', ROLE_BADGE[user.role] ?? ROLE_BADGE.viewer)}>
                {user.role}{user.source === 'local' ? ' · demo' : ''}
              </span>
            </div>
            <button onClick={logout} title="Sign out"
              className="text-gray-500 hover:text-gray-200 cursor-pointer text-sm shrink-0">&#x23CF;</button>
          </div>
          {/* Profile switcher dropdown */}
          {showProfileSwitcher && otherProfiles.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider px-1 mb-1">Switch profile</div>
              {otherProfiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => { switchProfile(p.id); setShowProfileSwitcher(false) }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-white/5 hover:text-gray-200 cursor-pointer transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-gray-700 text-gray-300 flex items-center justify-center text-[9px] font-bold uppercase shrink-0">
                    {(p.name || '?').slice(0, 2)}
                  </span>
                  <span className="truncate">{p.name}</span>
                  <span className={cn('ml-auto px-1 py-0.5 rounded text-[9px] font-semibold uppercase', ROLE_BADGE[p.role] ?? ROLE_BADGE.viewer)}>
                    {p.role}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setShowLogin(true)}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors cursor-pointer">
          <span className="text-base">&#x1F464;</span>
          <span>Sign in</span>
        </button>
      )}
    </div>
  )

  // ── Expanded nav content (shared between desktop + mobile drawer) ────────────
  function NavContent({ onClose }: { onClose?: () => void }) {
    function closeAndNav(n: number) { onNavigate?.(); setStep(n); onClose?.() }

    return (
      <>
        {/* Logo + collapse (desktop only) / close (mobile) */}
        <div className="flex items-center justify-between px-4 mb-6">
          <button onClick={() => { onGoHome(); onClose?.() }} className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
            <img src="/favicon.svg" alt="" className="w-6 h-6" />
            <span className="font-bold text-white text-sm">NetDesign <span className="text-blue-400">AI</span></span>
          </button>
          {onClose ? (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 cursor-pointer text-xl leading-none" title="Close">✕</button>
          ) : (
            <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-gray-300 cursor-pointer text-sm" title="Collapse">◀</button>
          )}
        </div>

        {/* ACCOUNT */}
        {accountBlock}

        {/* DEMO LOADER */}
        <div className="px-3 mb-4">
          <DemoLoader />
        </div>

        {/* DESIGN group */}
        <div className="px-3 mb-1">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Design</div>
          {DESIGN_STEPS.map(s => (
            <button key={s.step} onClick={() => closeAndNav(s.step)} className={itemCls(s.step)}>
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
            <button key={s.step} onClick={() => closeAndNav(s.step)} className={itemCls(s.step)}>
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
            <span className={cn('transition-transform', deployOpen ? 'rotate-90' : '')}>{deployOpen ? '▼' : '▶'}</span>
          </button>
          {deployOpen && (
            <>
              {/* Top-level step 6 header */}
              {DEPLOY_STEPS.map(s => (
                <button key={s.step} onClick={() => { onNavigate?.(); setStep(6); setActiveDeployTab('deploy'); onClose?.() }}
                  className={itemCls(s.step)}>
                  <span className="text-base">{s.icon}</span>
                  <span>{s.label}</span>
                  {s.step < step && <span className="ml-auto text-xs text-green-500">✓</span>}
                </button>
              ))}
              {/* Sub-items */}
              <div className="mt-1 space-y-0.5">
                {DEPLOY_SUB_ITEMS.map(sub => (
                  <button
                    key={sub.tab}
                    onClick={() => { onNavigate?.(); setStep(6); setActiveDeployTab(sub.tab); onClose?.() }}
                    className={cn(
                      'flex items-center gap-2 w-full pl-8 pr-3 py-1.5 rounded-lg text-xs transition-colors cursor-pointer',
                      step === 6 && activeDeployTab === sub.tab
                        ? 'bg-blue-600/15 text-blue-300 font-semibold'
                        : 'text-gray-500 hover:bg-white/5 hover:text-gray-300',
                    )}
                  >
                    <span>{sub.icon}</span>
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* TOOLS group */}
        <div className="px-3 mt-3">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Tools</div>
          <button onClick={() => { onShowTroubleshooting(); onClose?.() }}
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
          {gated('designs:write') && (
            <button onClick={() => setShowConfigPolicy(true)}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
              <span className="text-base">📜</span>
              <span>Config Policy</span>
            </button>
          )}
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
          {gated('designs:write') && (
            <button onClick={() => setShowPolicyRules(true)}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
              <span className="text-base">📋</span>
              <span>Policy Rules</span>
            </button>
          )}
        </div>

        {/* ENTERPRISE group — gated by role when signed in */}
        {(gated('approvals:read') || gated('org:admin')) && (
          <div className="px-3 mt-3">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest px-3 mb-2">Enterprise</div>
            {gated('approvals:read') && (
              <button onClick={() => setShowApprovals(true)}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
                <span className="text-base">✅</span>
                <span>Approvals</span>
              </button>
            )}
            {gated('org:admin') && (
              <button onClick={() => setShowIntegrations(true)}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-gray-400 hover:bg-white/5 hover:text-gray-200">
                <span className="text-base">🔌</span>
                <span>Integrations</span>
              </button>
            )}
          </div>
        )}

        {/* Step indicator at bottom */}
        <div className="mt-auto px-4 pt-4 border-t border-white/10">
          <div className="text-xs text-gray-600">Step {step} of 6</div>
          <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${(step / 6) * 100}%` }} />
          </div>
        </div>
      </>
    )
  }

  // ── Collapsed icon strip (desktop only) ──────────────────────────────────────
  if (collapsed) {
    return (
      <>
        <aside className="hidden lg:flex w-12 bg-gray-900/80 border-r border-white/10 flex-col items-center py-4 gap-4 shrink-0">
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
        {/* Mobile drawer (no collapsed icon strip on mobile) */}
        {mobileOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onMobileClose} />
            <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-gray-900 border-r border-white/10 flex flex-col overflow-y-auto lg:hidden">
              <NavContent onClose={onMobileClose} />
            </aside>
          </>
        )}
        {modals}
      </>
    )
  }

  // ── Expanded sidebar ─────────────────────────────────────────────────────────
  return (
    <>
      {/* Desktop expanded sidebar — hidden on mobile */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-gray-900/80 border-r border-white/10 overflow-y-auto">
        <NavContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={onMobileClose} />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-gray-900 border-r border-white/10 flex flex-col overflow-y-auto lg:hidden">
            <NavContent onClose={onMobileClose} />
          </aside>
        </>
      )}

      {modals}
    </>
  )
}
