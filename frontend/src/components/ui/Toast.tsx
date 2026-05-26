import { useState, createContext, useContext, useCallback } from 'react'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'warning' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  const variantClasses: Record<ToastVariant, string> = {
    success: 'bg-green-600/90 border-green-500/50 text-white',
    warning: 'bg-yellow-600/90 border-yellow-500/50 text-white',
    error:   'bg-red-600/90 border-red-500/50 text-white',
    info:    'bg-blue-600/90 border-blue-500/50 text-white',
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'px-4 py-3 rounded-lg border shadow-xl text-sm font-medium',
              'animate-in slide-in-from-right-8 fade-in duration-200',
              variantClasses[t.variant],
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
