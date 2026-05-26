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
  const step    = useAppStore(s => s.step)
  const setStep = useAppStore(s => s.setStep)

  return (
    <nav className="flex items-center justify-center gap-0 mb-8 flex-wrap">
      {STEPS.map((s, i) => {
        const n      = i + 1
        const active = n === step
        const done   = n < step
        return (
          <button
            key={n}
            type="button"
            onClick={() => setStep(n)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors',
              'border-b-2 cursor-pointer',
              active && 'border-blue-500 text-blue-400',
              done   && 'border-green-500/50 text-green-400 hover:text-green-300',
              !active && !done && 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            <span
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
                active && 'bg-blue-600 text-white',
                done   && 'bg-green-600 text-white',
                !active && !done && 'bg-white/10 text-gray-400',
              )}
            >
              {done ? '✓' : n}
            </span>
            {s.label}
          </button>
        )
      })}
    </nav>
  )
}
