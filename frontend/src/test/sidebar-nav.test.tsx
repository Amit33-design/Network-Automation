import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { useAppStore } from '@/store/useAppStore'
import { Sidebar } from '@/components/wizard/Sidebar'

beforeEach(() => {
  useAppStore.getState().reset()
})
afterEach(() => cleanup())

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const onNavigate = vi.fn()
  const onShowTroubleshooting = vi.fn()
  const onGoHome = vi.fn()
  render(
    <Sidebar
      onGoHome={onGoHome}
      onShowTroubleshooting={onShowTroubleshooting}
      showTroubleshooting={false}
      onNavigate={onNavigate}
      {...overrides}
    />,
  )
  return { onNavigate, onShowTroubleshooting, onGoHome }
}

/** Click the button whose label text node matches `label` exactly.
 *
 *  This used to disambiguate the step button from the section toggle by the
 *  emoji in its text. Nav icons are SVG now, so there is no text to match —
 *  and the two buttons sharing one accessible name was a real a11y defect,
 *  not just a testing inconvenience. The toggle now names what it does, so
 *  filtering it out by accessible name is both stabler and truer. */
function clickButtonByLabel(label: string) {
  const nodes = screen.getAllByText(label)
  const btns = (nodes.map(n => n.closest('button')).filter(Boolean) as HTMLButtonElement[])
    .filter(b => !/Collapse|Expand/i.test(b.getAttribute('aria-label') ?? ''))
  if (!btns.length) throw new Error(`No button for label "${label}"`)
  fireEvent.click(btns[0])
}

describe('Sidebar navigation — single-click exit from overlays', () => {
  it('clicking a Design step calls onNavigate AND sets the step (one click)', () => {
    const { onNavigate } = renderSidebar()
    clickButtonByLabel('Use Case')
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().step).toBe(1)
  })

  it('clicking a Configuration step navigates in one click', () => {
    const { onNavigate } = renderSidebar()
    clickButtonByLabel('Network Design')
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().step).toBe(4)
  })

  it('clicking the Deploy & Validate step header navigates to step 6 + deploy tab in one click', () => {
    const { onNavigate } = renderSidebar()
    clickButtonByLabel('Deploy & Validate') // the step button, not the section toggle
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().step).toBe(6)
    expect(useAppStore.getState().activeDeployTab).toBe('deploy')
  })

  it('clicking a Deploy sub-item (Troubleshoot tab) navigates in one click', () => {
    const { onNavigate } = renderSidebar()
    clickButtonByLabel('Troubleshoot')
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().step).toBe(6)
    expect(useAppStore.getState().activeDeployTab).toBe('troubleshoot')
  })

  it('the Tools "Troubleshooting Engine" button toggles the overlay (does NOT call onNavigate)', () => {
    const { onNavigate, onShowTroubleshooting } = renderSidebar()
    clickButtonByLabel('Troubleshooting Engine')
    expect(onShowTroubleshooting).toHaveBeenCalledTimes(1)
    expect(onNavigate).not.toHaveBeenCalled()
  })
})
