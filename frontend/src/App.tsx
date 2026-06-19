import { useState, useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/wizard/Sidebar'
import { TroubleshootingEngine } from '@/components/TroubleshootingEngine'
import { LandingPage } from '@/components/LandingPage'
import { BackendToggle, BackendToggleProvider } from '@/components/BackendToggle'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAppStore } from '@/store/useAppStore'
import { Step1UseCase } from '@/pages/Step1UseCase'
import { Step2Requirements } from '@/pages/Step2Requirements'
import { Step2Design } from '@/pages/Step2Design'
import { Step4NetworkDesign } from '@/pages/Step4NetworkDesign'
import { Step3Config } from '@/pages/Step3Config'
import { Step6Deploy } from '@/pages/Step6Deploy'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
})

const STEP_NAMES = [
  'Use Case',
  'Network Requirements',
  'Products & BOM',
  'Network Design',
  'Config Generation',
  'Deploy & Validate',
]

function BreadcrumbBar({ step }: { step: number }) {
  const pct = Math.round((step / STEP_NAMES.length) * 100)
  const label = STEP_NAMES[step - 1] ?? ''

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-400">
          Step {step} of {STEP_NAMES.length}
        </span>
        <span className="text-xs text-gray-600">›</span>
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="ml-auto text-xs text-gray-500">{pct}%</span>
      </div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function WizardContent({ onBackToLanding }: { onBackToLanding: () => void }) {
  const step = useAppStore(s => s.step)

  switch (step) {
    case 1: return <Step1UseCase onBack={onBackToLanding} />
    case 2: return <Step2Requirements />
    case 3: return <Step2Design />
    case 4: return <Step4NetworkDesign />
    case 5: return <Step3Config />
    case 6: return <Step6Deploy />
    default: return <Step1UseCase onBack={onBackToLanding} />
  }
}

export default function App() {
  const [showLanding, setShowLanding] = useState(true)
  const [showTroubleshooting, setShowTroubleshooting] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [backendUrl, setBackendUrl] = useState('http://localhost:8000')
  const setStep = useAppStore(s => s.setStep)
  const step = useAppStore(s => s.step)
  const theme = useAppStore(s => s.theme)

  // Apply the light/dark theme to <html> so the CSS variable overrides kick in.
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  // M-57: on mount, check for ?design= param and restore state
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('design')
    if (param) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(param)))
        useAppStore.setState(decoded)
        setShowLanding(false)
      } catch {
        // ignore malformed design param
      }
    }
  }, [])

  function goHome() {
    setShowLanding(true)
    setShowTroubleshooting(false)
    setStep(1)
  }

  if (showLanding) {
    return (
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <LandingPage onStart={() => setShowLanding(false)} />
          </ToastProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BackendToggleProvider value={{ isLive, baseUrl: backendUrl }}>
            <div className="relative flex min-h-screen bg-gray-950 text-gray-200">
              <Sidebar
                onGoHome={goHome}
                onShowTroubleshooting={() => setShowTroubleshooting(t => !t)}
                showTroubleshooting={showTroubleshooting}
                onNavigate={() => setShowTroubleshooting(false)}
                mobileOpen={mobileNavOpen}
                onMobileClose={() => setMobileNavOpen(false)}
              />
              <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
                {/* Mobile top bar — visible only on small screens */}
                <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-gray-950/95 backdrop-blur border-b border-white/10">
                  <button
                    onClick={() => setMobileNavOpen(true)}
                    className="text-gray-400 hover:text-gray-200 text-xl leading-none cursor-pointer"
                    aria-label="Open navigation"
                  >
                    ☰
                  </button>
                  <button onClick={goHome} className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
                    <img src="/favicon.svg" alt="" className="w-5 h-5" />
                    <span className="font-bold text-white text-sm">NetDesign <span className="text-blue-400">AI</span></span>
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <ThemeToggle compact />
                    <BackendToggle
                      isLive={isLive}
                      baseUrl={backendUrl}
                      onToggle={setIsLive}
                      onUrlChange={setBackendUrl}
                    />
                  </div>
                </div>

                {/* Page content */}
                <div className="flex-1 px-4 sm:px-6 py-4 sm:py-8">
                  {/* Desktop backend toggle — floating top-right, hidden on mobile */}
                  <div className="hidden lg:flex items-center gap-2 absolute top-4 right-6 z-40">
                    <ThemeToggle compact />
                    <BackendToggle
                      isLive={isLive}
                      baseUrl={backendUrl}
                      onToggle={setIsLive}
                      onUrlChange={setBackendUrl}
                    />
                  </div>
                  {showTroubleshooting
                    ? <TroubleshootingEngine />
                    : (
                      <>
                        <BreadcrumbBar step={step} />
                        <WizardContent onBackToLanding={() => setShowLanding(true)} />
                      </>
                    )
                  }
                </div>
              </main>
            </div>
          </BackendToggleProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
