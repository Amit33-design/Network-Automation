/**
 * StatCard — a single figure with its label and an optional device glyph.
 *
 * The summary rows were centred numbers on a flat card: the label sat below
 * the value in the same visual weight, so the eye had no entry point and the
 * row read as three unrelated boxes. Enterprise dashboards lead with the
 * label, left-align, and give the tile an accent so a row of them scans as
 * one strip (AH5).
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { IconProps } from '@/components/icons'

const TONES = {
  blue:   { text: 'text-blue-300',   accent: 'bg-blue-500',   glyph: 'text-blue-400/70' },
  purple: { text: 'text-purple-300', accent: 'bg-purple-500', glyph: 'text-purple-400/70' },
  green:  { text: 'text-emerald-300', accent: 'bg-emerald-500', glyph: 'text-emerald-400/70' },
  amber:  { text: 'text-amber-300',  accent: 'bg-amber-500',  glyph: 'text-amber-400/70' },
  gray:   { text: 'text-gray-200',   accent: 'bg-gray-500',   glyph: 'text-gray-400/70' },
} as const

export type StatTone = keyof typeof TONES

interface StatCardProps {
  label: string
  value: ReactNode
  /** Small line under the value — a unit, a delta, a qualifier. */
  hint?: ReactNode
  tone?: StatTone
  Icon?: (p: IconProps) => React.ReactElement
  className?: string
}

export function StatCard({ label, value, hint, tone = 'gray', Icon, className }: StatCardProps) {
  const t = TONES[tone]
  return (
    <div className={cn(
      'relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]',
      'px-4 py-3.5 transition-colors hover:bg-white/[0.05]',
      className,
    )}>
      {/* A hairline accent gives the row a rhythm without adding chrome. */}
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', t.accent)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
            {label}
          </div>
          <div className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight truncate', t.text)}>
            {value}
          </div>
          {hint && <div className="mt-0.5 text-[11px] text-gray-500 truncate">{hint}</div>}
        </div>
        {Icon && <Icon size={20} className={cn('shrink-0 mt-0.5', t.glyph)} />}
      </div>
    </div>
  )
}
