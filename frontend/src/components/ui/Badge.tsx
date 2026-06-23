import { cn } from '@/lib/utils'

interface BadgeProps {
  variant?: 'pass' | 'fail' | 'warn' | 'skip' | 'info' | 'neutral'
  className?: string
  children: React.ReactNode
}

const variantClasses = {
  pass:    'bg-green-500/20 text-green-400 border-green-500/30',
  fail:    'bg-red-500/20 text-red-400 border-red-500/30',
  warn:    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  skip:    'bg-gray-500/20 text-gray-400 border-gray-500/30',
  info:    'bg-blue-500/20 text-blue-400 border-blue-500/30',
  neutral: 'bg-white/10 text-gray-300 border-white/20',
}

export function Badge({ variant = 'neutral', className, children }: BadgeProps) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
