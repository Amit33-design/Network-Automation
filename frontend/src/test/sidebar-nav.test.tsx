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

/** Click the button whose label text node matches `label` exactly. */
function clickButtonByLabel(label: string, requireIcon?: string) {
  const nodes = screen.getAllByText(label)
  const btns = nodes.map(n => n.closest('button')).filter(Boolean) as HTMLButtonElement[]
  const btn = requireIcon ? btns.find(b => b.textContent?.includes(requireIcon)) : btns[0]
  if (!btn) throw new Error(`No button for label "${label}"`)
  fireEvent.click(btn)
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
    clickButtonByLabel('Deploy & Validate', '🚀') // the step button, not the group toggle
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
