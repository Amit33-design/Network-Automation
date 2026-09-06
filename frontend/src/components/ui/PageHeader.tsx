/**
 * PageHeader — the title block every step page opens with.
 *
 * The five step pages each wrote their own: Step 1 used `text-xl font-bold
 * tracking-tight`, the rest `text-lg font-semibold`, and the ones with
 * actions laid them out ad hoc. A page title should be the same size and
 * weight everywhere, and its actions should sit in the same place, or the
 * product reads as several products (AH5).
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  /** One line under the title. Nodes allowed so a page can highlight a figure. */
  description?: ReactNode
  /** Right-aligned controls — exports, filters, primary actions. */
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between flex-wrap gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[22px] font-semibold text-gray-50 tracking-[-0.022em] leading-tight">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-[13px] text-gray-400 leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  )
}
