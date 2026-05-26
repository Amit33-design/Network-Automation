import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'

const STEPS = [
  { label: 'Use Case' },
  { label: 'Design' },
  { label: 'Config' },
  { label: 'ZTP' },
  { label: 'Checks' },
  { label: 'Monitor' },
]

export function WizardNav() {
  const { step, setStep } = useAppStore()

  return (
    <nav className="flex items-center justify-center gap-0 mb-8 flex-wrap">
      {STEPS.map((s, i) => {
        const n = i + 1
        const active = n === step
        const done = n < step
        const isHome = n === 1
        return (
          <button
            key={n}
            onClick={() => setStep(n)}
            title={isHome && step > 1 ? 'Return to Use Case (Home)' : undefined}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2',
              active && 'border-blue-500 text-blue-400',
              done && 'border-green-500/50 text-green-400 hover:text-green-300',
              !active && !done && 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            <span
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                active && 'bg-blue-600 text-white',
                done && 'bg-green-600 text-white',
                !active && !done && 'bg-white/10 text-gray-400',
              )}
            >
              {/* Step 1 shows a home icon when you're past it */}
              {done && isHome ? (
                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
              ) : done ? '✓' : n}
            </span>
            {s.label}
          </button>
        )
      })}
    </nav>
  )
}
