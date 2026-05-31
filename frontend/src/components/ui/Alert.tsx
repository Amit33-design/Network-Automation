import { cn } from '@/lib/utils'
import { Info, CheckCircle, AlertTriangle, AlertCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'

interface AlertProps {
  variant: 'info' | 'success' | 'warning' | 'error'
  title?: string
  children: ReactNode
  onDismiss?: () => void
  className?: string
}

const variantClasses = {
  info:    'bg-blue-500/10 border-l-blue-500 text-blue-300',
  success: 'bg-green-500/10 border-l-green-500 text-green-300',
  warning: 'bg-amber-500/10 border-l-amber-500 text-amber-300',
  error:   'bg-red-500/10 border-l-red-500 text-red-300',
}

const variantIcons = {
  info:    Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error:   AlertCircle,
}

export function Alert({ variant, title, children, onDismiss, className }: AlertProps) {
  const Icon = variantIcons[variant]

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border border-white/10 border-l-4 p-4',
        variantClasses[variant],
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && (
          <p className="text-sm font-semibold mb-1">{title}</p>
        )}
        <div className="text-sm opacity-90">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
