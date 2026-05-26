import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { WizardNav } from '@/components/wizard/WizardNav'
import { useAppStore } from '@/store/useAppStore'
import { Step1UseCase } from '@/pages/Step1UseCase'
import { Step2Design } from '@/pages/Step2Design'
import { Step3Config } from '@/pages/Step3Config'
import { Step4ZTP } from '@/pages/Step4ZTP'
import { Step5Checks } from '@/pages/Step5Checks'
import { Step6Monitor } from '@/pages/Step6Monitor'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
})

function WizardContent() {
  const { step } = useAppStore()
  const pages = [Step1UseCase, Step2Design, Step3Config, Step4ZTP, Step5Checks, Step6Monitor]
  const Page = pages[step - 1] ?? Step1UseCase
  return <Page />
}

function Header() {
  const { step, setStep } = useAppStore()

  return (
    <header className="border-b border-white/10 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">

        {/* Logo + brand — always clickable to go home */}
        <button
          onClick={() => setStep(1)}
          className="flex items-center gap-3 group focus:outline-none"
          title="Return to Step 1 — Use Case"
        >
          <img
            src="/logo.svg"
            alt="NetDesign AI"
            className="w-9 h-9 rounded-xl transition-transform group-hover:scale-105"
          />
          <div className="flex flex-col leading-tight">
            <span className="font-bold text-white text-sm tracking-wide">NetDesign AI</span>
            <span className="text-[10px] text-blue-400 font-medium tracking-widest uppercase">
              Intent‑Driven Automation
            </span>
          </div>
        </button>

        {/* Right side — step indicator + Home button */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden sm:block">
            Step {step} of 6
          </span>

          {step > 1 && (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                         bg-white/5 border border-white/10 text-gray-400
                         hover:bg-blue-600/20 hover:border-blue-500/40 hover:text-blue-300
                         transition-colors"
              title="Return to Use Case selection"
            >
              {/* Home icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Home
            </button>
          )}
        </div>

      </div>
    </header>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="min-h-screen bg-gray-950 text-gray-200">
          <Header />
          <main className="max-w-6xl mx-auto px-6 py-8">
            <WizardNav />
            <WizardContent />
          </main>
        </div>
      </ToastProvider>
    </QueryClientProvider>
  )
}
