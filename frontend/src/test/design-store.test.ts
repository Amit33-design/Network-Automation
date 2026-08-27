/**
 * Where a saved design actually lives (AE2).
 *
 * The two properties worth testing are both about failure: a save that
 * reports success must have landed somewhere, and a backend outage must not
 * make the user's list look empty.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { AppState } from '@/types'

vi.mock('@/api/client', () => ({
  isLiveMode: vi.fn(() => false),
  getToken: vi.fn(() => ''),
  listDesigns: vi.fn(),
  createDesign: vi.fn(),
  deleteDesign: vi.fn(),
}))
vi.mock('@/store/useAuthStore', () => ({ authScopeKey: () => 'guest' }))

import * as client from '@/api/client'
import {
  loadAllDesigns, saveDesign, removeDesign, isRemote, storageKey,
  type SavedDesign,
} from '@/lib/design-store'

const state = { useCase: 'dc', scale: 'medium' } as unknown as AppState
const mocked = client as unknown as Record<string, ReturnType<typeof vi.fn>>

function goLive() {
  mocked.isLiveMode.mockReturnValue(true)
  mocked.getToken.mockReturnValue('jwt')
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocked.isLiveMode.mockReturnValue(false)
  mocked.getToken.mockReturnValue('')
})
afterEach(() => localStorage.clear())

describe('demo mode — no backend', () => {
  it('is not remote without both a live backend and a token', () => {
    expect(isRemote()).toBe(false)
    mocked.isLiveMode.mockReturnValue(true)
    expect(isRemote(), 'live but signed out is not remote').toBe(false)
    mocked.getToken.mockReturnValue('jwt')
    expect(isRemote()).toBe(true)
  })

  it('saves and lists locally, and never calls the API', async () => {
    const { design } = await saveDesign('Fabric A', state, [])
    expect(design.origin).toBe('local')
    expect(client.createDesign).not.toHaveBeenCalled()

    const { designs, error } = await loadAllDesigns()
    expect(error).toBeUndefined()
    expect(designs.map(d => d.name)).toEqual(['Fabric A'])
  })

  it('deletes locally', async () => {
    const { design } = await saveDesign('Gone', state, [])
    expect(await removeDesign(design, [design])).toBeUndefined()
    expect((await loadAllDesigns()).designs).toEqual([])
  })
})

describe('live mode — signed in', () => {
  beforeEach(goLive)

  it('saves to the server and marks the design as synced', async () => {
    mocked.createDesign.mockResolvedValue({
      id: 'srv-1', name: 'Fabric A', created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    const { design, degraded } = await saveDesign('Fabric A', state, [])
    expect(degraded).toBeUndefined()
    expect(design.origin).toBe('server')
    expect(design.id).toBe('srv-1')
    // ...and it is NOT duplicated into local storage
    expect(localStorage.getItem(storageKey())).toBeNull()
  })

  it('merges server designs with ones saved while signed out', async () => {
    mocked.isLiveMode.mockReturnValue(false)
    await saveDesign('Offline draft', state, [])   // saved as a guest
    goLive()
    mocked.listDesigns.mockResolvedValue({
      designs: [{
        id: 'srv-1', name: 'On the server', use_case: 'dc', state,
        created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
      }],
    })
    const { designs } = await loadAllDesigns()
    expect(designs.map(d => d.name).sort())
      .toEqual(['Offline draft', 'On the server'])
  })
})

describe('when the server fails', () => {
  beforeEach(goLive)

  it('keeps the design locally and SAYS the save was degraded', async () => {
    // The failure mode worth preventing: reporting success on a design that
    // was stored nowhere.
    mocked.createDesign.mockRejectedValue(new Error('503'))
    const { design, degraded } = await saveDesign('Important', state, [])
    expect(degraded).toMatch(/locally only/i)
    expect(design.origin).toBe('local')

    mocked.listDesigns.mockRejectedValue(new Error('503'))
    const { designs } = await loadAllDesigns()
    expect(designs.map(d => d.name), 'the design survived the outage').toEqual(['Important'])
  })

  it('still shows local designs when the listing fails, with an explanation', async () => {
    mocked.isLiveMode.mockReturnValue(false)
    await saveDesign('Local one', state, [])
    goLive()
    mocked.listDesigns.mockRejectedValue(new Error('network down'))

    const { designs, error } = await loadAllDesigns()
    expect(designs.map(d => d.name), 'an outage must not look like an empty account').toEqual(['Local one'])
    expect(error).toMatch(/network down/)
  })

  it('does not drop a design from the list when the server refuses the delete', async () => {
    const srv: SavedDesign = {
      id: 'srv-1', name: 'Stubborn', savedAt: '2026-01-01T00:00:00Z',
      state, origin: 'server',
    }
    mocked.deleteDesign.mockRejectedValue(new Error('403'))
    const err = await removeDesign(srv, [srv])
    expect(err).toMatch(/still there/i)
  })
})
