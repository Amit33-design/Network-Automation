import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

// Mirror of the effect that App.tsx runs so we can assert the DOM side-effect
// that actually drives the light-mode CSS variable overrides.
function ThemeHost() {
  const theme = useAppStore(s => s.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])
  return <ThemeToggle />
}

beforeEach(() => {
  useAppStore.getState().reset()
  document.documentElement.classList.remove('light')
})

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('light')
})

describe('ThemeToggle', () => {
  it('defaults to dark theme with no light class on <html>', () => {
    render(<ThemeHost />)
    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('shows "Switch to light mode" affordance while dark', () => {
    render(<ThemeHost />)
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument()
  })

  it('clicking the toggle flips store theme to light and adds html.light', () => {
    render(<ThemeHost />)
    fireEvent.click(screen.getByRole('button'))
    expect(useAppStore.getState().theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('clicking again flips back to dark and removes html.light', () => {
    render(<ThemeHost />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn) // → light
    fireEvent.click(btn) // → dark
    expect(useAppStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('toggleTheme store action alternates deterministically', () => {
    const { toggleTheme } = useAppStore.getState()
    toggleTheme()
    expect(useAppStore.getState().theme).toBe('light')
    toggleTheme()
    expect(useAppStore.getState().theme).toBe('dark')
  })
})
