import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Sidebar } from '@/components/wizard/Sidebar'
import { TroubleshootingEngine } from '@/components/TroubleshootingEngine'
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
  const [showTroubleshooting, setShowTroubleshooting] = useState(false)
  const setStep = useAppStore(s => s.setStep)

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
          <div className="flex min-h-screen bg-gray-950 text-gray-200">
            <Sidebar
              onGoHome={goHome}
              onShowTroubleshooting={() => setShowTroubleshooting(t => !t)}
              showTroubleshooting={showTroubleshooting}
            />
            <main className="flex-1 px-6 py-8 overflow-y-auto">
              {showTroubleshooting
                ? <TroubleshootingEngine />
                : <WizardContent onBackToLanding={() => setShowLanding(true)} />
              }
            </main>
          </div>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
