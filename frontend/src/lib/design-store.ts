/**
 * design-store.ts — where a saved design actually lives.
 *
 * §22 J2 recorded "backend-persisted designs (/api/designs)" as delivered.
 * It was not: the typed client functions were written and never called, so
 * `MyDesigns` was `localStorage` only and a design vanished if the user
 * changed browser (AE1 corrected the tracker; this closes the gap).
 *
 * The rule here is that the browser stays authoritative for demo mode — the
 * app is fully functional with no backend (§3) — and the server is used only
 * when the user is signed in against a live backend. Two properties matter
 * more than elegance:
 *
 *   1. A save that appears to succeed must have succeeded SOMEWHERE. If the
 *      server rejects it we write locally and say so, rather than reporting
 *      success on a design that no longer exists anywhere.
 *   2. Signing in must not hide designs saved while signed out. A remote
 *      listing is merged with the local one rather than replacing it.
 */
import type { AppState } from '@/types'
import { isLiveMode, getToken, listDesigns, createDesign, deleteDesign } from '@/api/client'
import { authScopeKey } from '@/store/useAuthStore'

export interface SavedDesign {
  id: string
  name: string
  savedAt: string
  state: AppState
  /** Where this record came from, so the UI can say so. */
  origin: 'local' | 'server'
}

/** Outcome of a write, so the caller can tell the user the truth. */
export interface SaveResult {
  design: SavedDesign
  /** Set when the server was tried and refused; the design is local-only. */
  degraded?: string
}

const STORAGE_KEY_BASE = 'netdesign-saved-designs'

export function storageKey(): string {
  const scope = authScopeKey()
  return scope === 'guest' ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}:${scope}`
}

/** Server-backed only when signed in AND pointed at a live backend. */
export function isRemote(): boolean {
  return isLiveMode() && !!getToken()
}

function readLocal(): SavedDesign[] {
  try {
    const raw = localStorage.getItem(storageKey())
    const parsed = raw ? (JSON.parse(raw) as SavedDesign[]) : []
    // `origin` post-dates the first release of this format.
    return parsed.map(d => ({ ...d, origin: d.origin ?? 'local' }))
  } catch {
    return []
  }
}

function writeLocal(designs: SavedDesign[]) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(designs.filter(d => d.origin === 'local')))
  } catch {
    /* quota or private mode — the in-memory list still works for this session */
  }
}

const newest = (a: SavedDesign, b: SavedDesign) => b.savedAt.localeCompare(a.savedAt)

/**
 * Every design the user can open, newest first.
 *
 * `error` is set when the server was tried and failed. The local designs are
 * still returned — a backend outage must not make the list look empty.
 */
export async function loadAllDesigns(): Promise<{ designs: SavedDesign[]; error?: string }> {
  const local = readLocal()
  if (!isRemote()) return { designs: local.sort(newest) }

  try {
    const { designs } = await listDesigns()
    const remote: SavedDesign[] = designs.map(d => ({
      id: d.id,
      name: d.name,
      savedAt: d.updated_at || d.created_at,
      state: d.state as unknown as AppState,
      origin: 'server',
    }))
    const remoteIds = new Set(remote.map(d => d.id))
    return { designs: [...remote, ...local.filter(d => !remoteIds.has(d.id))].sort(newest) }
  } catch (e) {
    return {
      designs: local.sort(newest),
      error: `Could not reach the design server (${(e as Error).message}). Showing locally saved designs.`,
    }
  }
}

export async function saveDesign(
  name: string, state: AppState, existing: SavedDesign[],
): Promise<SaveResult> {
  const asLocal = (): SavedDesign => ({
    id: crypto.randomUUID(), name, savedAt: new Date().toISOString(), state, origin: 'local',
  })

  if (!isRemote()) {
    const design = asLocal()
    writeLocal([design, ...existing])
    return { design }
  }

  try {
    const created = await createDesign({
      name, use_case: state.useCase || '', state,
    })
    return {
      design: {
        id: created.id,
        name: created.name,
        savedAt: created.updated_at || created.created_at || new Date().toISOString(),
        state,
        origin: 'server',
      },
    }
  } catch (e) {
    // Never report success on a design that was not stored anywhere.
    const design = asLocal()
    writeLocal([design, ...existing])
    return { design, degraded: `Saved locally only — the server refused it (${(e as Error).message}).` }
  }
}

/** Returns an error string when the server refused; the caller reports it. */
export async function removeDesign(
  design: SavedDesign, existing: SavedDesign[],
): Promise<string | undefined> {
  const remaining = existing.filter(d => d.id !== design.id)
  if (design.origin === 'server' && isRemote()) {
    try {
      await deleteDesign(design.id)
    } catch (e) {
      return `Could not delete on the server (${(e as Error).message}). It is still there.`
    }
  }
  writeLocal(remaining)
  return undefined
}
