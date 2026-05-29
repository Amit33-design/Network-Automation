import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { WizardNav } from '@/components/wizard/WizardNav'
import { LandingPage } from '@/components/LandingPage'
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
  const step    = useAppStore(s => s.step)
  const setStep = useAppStore(s => s.setStep)

  function goHome() {
    setShowLanding(true)
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
        <div className="min-h-screen bg-gray-950 text-gray-200">

          {/* ── Header ──────────────────────────────────────────────────── */}
          <header className="border-b border-white/10 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
            <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">

              <button
                type="button"
                onClick={goHome}
                className="flex items-center gap-3 cursor-pointer select-none
                           hover:opacity-80 active:opacity-60 transition-opacity"
                aria-label="NetDesign AI — go to home"
              >
                <img src="/favicon.svg" alt="" className="w-8 h-8" />
                <div className="flex flex-col leading-tight text-left">
                  <span className="font-bold text-white text-[15px] tracking-wide">
                    NetDesign <span className="text-blue-400">AI</span>
                  </span>
                  <span className="text-[10px] text-gray-500 tracking-widest uppercase">
                    Intent‑Driven Automation
                  </span>
                </div>
              </button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-600 tabular-nums hidden sm:block">
                  Step {step} / 6
                </span>
                <button
                  type="button"
                  onClick={goHome}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                             text-xs font-semibold cursor-pointer
                             bg-white/5 border border-white/10 text-gray-400
                             hover:bg-blue-600/20 hover:border-blue-500/40 hover:text-blue-300
                             active:bg-blue-600/30 transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4
                             10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1
                             1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                  </svg>
                  Home
                </button>
              </div>

            </div>
          </header>

          {/* ── Wizard ──────────────────────────────────────────────────── */}
          <main className="max-w-6xl mx-auto px-6 py-8">
            <WizardNav />
            <WizardContent onBackToLanding={() => setShowLanding(true)} />
          </main>

        </div>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
