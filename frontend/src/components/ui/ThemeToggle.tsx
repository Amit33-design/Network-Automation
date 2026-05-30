import { useAppStore } from '@/store/useAppStore'

interface Props {
  /** Compact icon-only button (for tight headers). */
  compact?: boolean
  className?: string
}

/**
 * Light / dark theme toggle. Flips useAppStore().theme; App applies the
 * `light` class on <html>, which remaps the Tailwind color variables.
 */
export function ThemeToggle({ compact = false, className = '' }: Props) {
  const theme = useAppStore(s => s.theme)
  const toggleTheme = useAppStore(s => s.toggleTheme)
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={[
        'inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer',
        'border-white/15 bg-white/5 text-gray-300 hover:text-blue-300 hover:border-blue-500/40 hover:bg-blue-500/10',
        compact ? 'w-8 h-8' : 'gap-2 px-3 h-9 text-sm font-medium',
        className,
      ].join(' ')}
    >
      {isDark ? (
        // Sun — click to go light
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Moon — click to go dark
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
      {!compact && <span>{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
