import { cn } from '@/lib/utils'
import type { IconProps } from '@/components/icons'

interface CardProps {
  className?: string
  children: React.ReactNode
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('mb-3 border-b border-white/10 pb-3', className)}>
      {children}
    </div>
  )
}

/**
 * `Icon` renders a glyph before the title. Card titles used to lead with an
 * emoji baked into the string (`🛟 Rollback Advisor`), which sized and
 * coloured itself independently of the heading (AH6).
 */
export function CardTitle({ className, children, Icon }: CardProps & {
  Icon?: (p: IconProps) => React.ReactElement
}) {
  return (
    <h3 className={cn(
      'flex items-center gap-2 text-sm font-semibold text-gray-200 uppercase tracking-wide',
      className,
    )}>
      {Icon && <Icon size={15} className="shrink-0 text-gray-500" />}
      {children}
    </h3>
  )
}
