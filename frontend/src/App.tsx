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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="min-h-screen bg-gray-950 text-gray-200">
          <header className="border-b border-white/10 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
            <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                  N
                </div>
                <span className="font-semibold text-gray-100">NetDesign AI</span>
              </div>
              <span className="text-xs text-gray-500">Network Design Wizard</span>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-6 py-8">
            <WizardNav />
            <WizardContent />
          </main>
        </div>
      </ToastProvider>
    </QueryClientProvider>
  )
}
