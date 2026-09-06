/**
 * EmptyState — what a panel shows before it has anything to show.
 *
 * The app had a dozen of these written inline as bare grey text, or as a 4xl
 * emoji over a sentence. An empty panel is a moment where the user does not
 * know what to do next, so it should say three things: what is missing, why,
 * and the one action that fixes it. Enterprise tools are judged on this more
 * than on the populated state, which people only reach if they get past it.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { IconProps } from '@/components/icons'

interface EmptyStateProps {
  Icon?: (p: IconProps) => React.ReactElement
  title: string
  /** One sentence on why it is empty, in the user's terms not the code's. */
  description?: ReactNode
  /** The single action that resolves it. */
  action?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export function EmptyState({
  Icon, title, description, action, size = 'md', className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center text-center',
      size === 'sm' ? 'py-8 px-4' : 'py-14 px-6',
      className,
    )}>
      {Icon && (
        <div className={cn(
          'flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-gray-600',
          size === 'sm' ? 'w-10 h-10 mb-3' : 'w-14 h-14 mb-4',
        )}>
          <Icon size={size === 'sm' ? 20 : 26} />
        </div>
      )}
      <p className={cn('font-medium text-gray-300', size === 'sm' ? 'text-[13px]' : 'text-sm')}>
        {title}
      </p>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
