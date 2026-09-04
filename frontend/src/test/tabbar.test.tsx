/**
 * The shared tab control (AH3).
 *
 * The app had three tab styles for one interaction, and only one of them had
 * arrow-key navigation or complete ARIA — so two of the three were not
 * reachable by keyboard the way a tablist is expected to be. These tests pin
 * the WAI-ARIA tabs behaviour so a future tab row cannot quietly lose it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { TabBar, type TabItem } from '@/components/ui/TabBar'

const ITEMS: ReadonlyArray<TabItem<'a' | 'b' | 'c'>> = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta', badge: 3 },
  { id: 'c', label: 'Gamma' },
]

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a')
  return (
    <TabBar
      label="Test views" items={ITEMS} value={v}
      onChange={id => { setV(id); onChange?.(id) }}
    />
  )
}

describe('TabBar', () => {
  it('exposes a labelled tablist with one selected tab', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Test views' })).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })

  it('keeps exactly one tab in the tab order (roving tabindex)', () => {
    render(<Harness />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter(t => t.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(tabs[0].getAttribute('tabindex')).toBe('0')
  })

  it('moves selection with the arrow keys and wraps', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('b')
    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('a')
    // wrapping backwards from the first lands on the last
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('c')
  })

  it('jumps to the first and last tab with Home and End', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(screen.getAllByRole('tab')[0], { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('c')
    fireEvent.keyDown(screen.getAllByRole('tab')[2], { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('a')
  })

  it('selects on click', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: /Gamma/ }))
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.getByRole('tab', { name: /Gamma/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('renders a badge without breaking the accessible name', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: /Beta/ }).textContent).toContain('3')
  })

  it('links each tab to its panel when a prefix is given', () => {
    render(
      <TabBar label="L" items={ITEMS} value="a" onChange={() => {}} panelIdPrefix="panel" />,
    )
    const tab = screen.getByRole('tab', { name: 'Alpha' })
    expect(tab.getAttribute('aria-controls')).toBe('panel-a')
    expect(tab.id).toBe('tab-a')
  })
})
