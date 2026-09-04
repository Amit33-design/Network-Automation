/**
 * TabBar — the one tab control.
 *
 * The app had three: a segmented control in Step 6, bordered standalone
 * buttons for the BOM sub-tabs, and an underlined row for the observability
 * views. Three looks for one interaction, and only the first had arrow-key
 * navigation or complete ARIA — so the other two were unreachable by
 * keyboard in the way a tablist is expected to be (AH3).
 *
 * Roving tabindex per the WAI-ARIA tabs pattern: exactly one tab is in the
 * tab order, and Arrow/Home/End move between them.
 */
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import type { IconProps } from '@/components/icons'

export interface TabItem<T extends string = string> {
  id: T
  label: string
  Icon?: (p: IconProps) => React.ReactElement
  /** Small trailing count, e.g. a number of findings. */
  badge?: string | number
}

interface TabBarProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (id: T) => void
  /** Names the group for assistive tech — required, never decorative. */
  label: string
  /** `panelIdPrefix`-<id> must be the id of the panel each tab controls. */
  panelIdPrefix?: string
  size?: 'sm' | 'md'
  className?: string
}

export function TabBar<T extends string>({
  items, value, onChange, label, panelIdPrefix, size = 'md', className,
}: TabBarProps<T>) {
  const ref = useRef<HTMLDivElement>(null)

  const move = (delta: number | 'first' | 'last') => {
    const i = items.findIndex(t => t.id === value)
    const next =
      delta === 'first' ? 0
      : delta === 'last' ? items.length - 1
      : (i + delta + items.length) % items.length
    onChange(items[next].id)
    // Follow focus, or the roving tabindex leaves focus on a tab that is no
    // longer selected.
    requestAnimationFrame(() => {
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    })
  }

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/10 overflow-x-auto',
        className,
      )}
    >
      {items.map(t => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={panelIdPrefix ? `tab-${t.id}` : undefined}
            aria-selected={active}
            aria-controls={panelIdPrefix ? `${panelIdPrefix}-${t.id}` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
              if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
              if (e.key === 'Home') { e.preventDefault(); move('first') }
              if (e.key === 'End') { e.preventDefault(); move('last') }
            }}
            className={cn(
              'group flex items-center gap-2 rounded-lg whitespace-nowrap font-medium',
              'tracking-[-0.01em] transition-all duration-150 cursor-pointer',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-[13px]',
              active
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-900/40'
                : 'text-gray-400 hover:text-gray-100 hover:bg-white/[0.07]',
            )}
          >
            {t.Icon && (
              <t.Icon
                size={size === 'sm' ? 14 : 16}
                className={cn('shrink-0 transition-opacity',
                  active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100')}
              />
            )}
            {t.label}
            {t.badge !== undefined && t.badge !== '' && (
              <span className={cn(
                'ml-0.5 px-1.5 rounded-full text-[10px] font-semibold tabular-nums',
                active ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-400',
              )}>
                {t.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
