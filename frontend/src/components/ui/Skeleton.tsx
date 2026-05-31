import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  lines?: number
}

export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  if (lines <= 1) {
    return (
      <div
        className={cn('bg-white/10 animate-pulse rounded', className)}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'bg-white/10 animate-pulse rounded h-4',
            i === lines - 1 && 'w-[60%]',
            className,
          )}
        />
      ))}
    </div>
  )
}
