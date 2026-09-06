/**
 * CloseButton — the dismiss control on every modal and panel.
 *
 * There were eight of these written inline, using `✕`, `×` or `X`, at
 * different sizes, and several with no accessible name at all — a button
 * whose only content is a glyph announces as that glyph, or as nothing.
 * They were also bare text with no padding, so the tap target was roughly
 * 12px square (AH9).
 */
import { cn } from '@/lib/utils'
import { IconClose } from '@/components/icons'

interface CloseButtonProps {
  onClick: () => void
  /** Names what is being closed, e.g. "Close My Designs". */
  label?: string
  className?: string
}

export function CloseButton({ onClick, label = 'Close', className }: CloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'shrink-0 grid place-items-center w-8 h-8 rounded-lg text-gray-500',
        'hover:text-gray-200 hover:bg-white/[0.08] transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
        className,
      )}
    >
      <IconClose size={16} />
    </button>
  )
}
