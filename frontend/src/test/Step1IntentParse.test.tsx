import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { BackendToggleProvider } from '@/components/BackendToggle'
import { Step1UseCase } from '@/pages/Step1UseCase'
import type { IntentParseResult } from '@/types'

function renderStep1(isLive: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BackendToggleProvider value={{ isLive, baseUrl: 'http://localhost:8000' }}>
        <Step1UseCase />
      </BackendToggleProvider>
    </QueryClientProvider>,
  )
}

const AI_RESULT: IntentParseResult = {
  use_case: 'dc',
  app_types: ['storage'],
  scale: 'large',
  redundancy: 'dual',
  compliance: ['PCI'],
  org_name: 'Acme Corp',
  org_size: 'enterprise',
  budget_tier: 'enterprise',
  vendor_prefs: ['Cisco'],
  industry: 'Financial',
  primary_contact: 'Jane Smith',
  confidence: 0.92,
  notes: 'Inferred storage-heavy DC fabric from description.',
  source: 'ai',
}

beforeEach(() => {
  useAppStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Step1UseCase — AI intent parser (G-A1)', () => {
  it('renders the free-text description card with a disabled button until text is entered', () => {
    renderStep1(true)
    expect(screen.getByText(/Describe Your Network/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /Parse with AI/i })
    expect(button).toBeDisabled()
  })

  it('disables the Parse button and shows a hint when backend is not live', () => {
    renderStep1(false)
    const textarea = screen.getByPlaceholderText(/redundant data center fabric/i)
    fireEvent.change(textarea, { target: { value: 'A redundant DC for Acme Corp' } })

    const button = screen.getByRole('button', { name: /Parse with AI/i })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Requires live backend/i)).toBeInTheDocument()
  })

  it('parses free text via the API and populates Step 1 store fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => AI_RESULT,
    })
    vi.stubGlobal('fetch', fetchMock)

    renderStep1(true)

    const textarea = screen.getByPlaceholderText(/redundant data center fabric/i)
    fireEvent.change(textarea, {
      target: { value: 'A redundant DC for Acme Corp, PCI compliant, Cisco gear, storage traffic.' },
    })

    const button = screen.getByRole('button', { name: /Parse with AI/i })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    await waitFor(() => expect(screen.getByText(/AI-parsed/i)).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/intent/parse',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ description: 'A redundant DC for Acme Corp, PCI compliant, Cisco gear, storage traffic.' }),
      }),
    )

    const state = useAppStore.getState()
    expect(state.useCase).toBe('dc')
    expect(state.appTypes).toEqual(['storage'])
    expect(state.scale).toBe('large')
    expect(state.redundancy).toBe('dual')
    expect(state.compliance).toEqual(['PCI'])
    expect(state.orgName).toBe('Acme Corp')
    expect(state.orgSize).toBe('enterprise')
    expect(state.budgetTier).toBe('enterprise')
    expect(state.vendorPrefs).toEqual(['Cisco'])
    expect(state.industry).toBe('Financial')
    expect(state.primaryContact).toBe('Jane Smith')

    expect(screen.getByText(/92%/)).toBeInTheDocument()
    expect(screen.getByText(/Inferred storage-heavy DC fabric/i)).toBeInTheDocument()
  })

  it('shows the heuristic-parsed badge when the backend falls back', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...AI_RESULT, source: 'heuristic', notes: 'Heuristic keyword-based extraction.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderStep1(true)

    const textarea = screen.getByPlaceholderText(/redundant data center fabric/i)
    fireEvent.change(textarea, { target: { value: 'A campus network for a school.' } })
    fireEvent.click(screen.getByRole('button', { name: /Parse with AI/i }))

    await waitFor(() => expect(screen.getByText(/Heuristic-parsed/i)).toBeInTheDocument())
  })

  it('shows an error message when the API call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ detail: 'AI parsing failed' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderStep1(true)

    const textarea = screen.getByPlaceholderText(/redundant data center fabric/i)
    fireEvent.change(textarea, { target: { value: 'A campus network for a school.' } })
    fireEvent.click(screen.getByRole('button', { name: /Parse with AI/i }))

    await waitFor(() => expect(screen.getByText(/AI parsing failed/i)).toBeInTheDocument())
  })
})
