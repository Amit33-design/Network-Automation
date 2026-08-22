/**
 * The API client's exports must be reachable, or declared as pending.
 *
 * `client.ts` had grown 21 typed functions of which **14 had no caller
 * anywhere** in `src/`. Two of those groups — the `/api/designs` CRUD and the
 * user prefs/activity sync — back capabilities the tracker recorded as
 * delivered (§22 J2), so the project's own source of truth was claiming
 * behaviour the code did not have.
 *
 * An unwired export is not automatically wrong: it can be scaffolding for
 * work in flight. What is wrong is for it to be *silent*. Anything unwired
 * must be listed below with the tracker item that will wire it, so the gap
 * is visible in the repo rather than discoverable only by grep.
 */
import { describe, it, expect } from 'vitest'

// Vite's glob import keeps this free of node APIs, so it type-checks under
// the app tsconfig like every other test.
const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>

const CLIENT_KEY = Object.keys(SOURCES).find(k => k.endsWith('api/client.ts'))!

/** Unwired on purpose, each with the tracker item that will wire it. */
const PENDING: Record<string, string> = {
  fetchUserPrefs:     'AE2 — prefs sync',
  saveUserPrefs:      'AE2 — prefs sync',
  fetchUserActivity:  'AE2 — activity sync',
  postUserActivity:   'AE2 — activity sync',
  listDesigns:        'AE2 — server-side designs',
  fetchDesign:        'AE2 — server-side designs',
  createDesign:       'AE2 — server-side designs',
  updateDesign:       'AE2 — server-side designs',
  deleteDesign:       'AE2 — server-side designs',
  runPreChecks:       'AE2 — Step 6 checks use the useChecks hook path',
  runPostChecks:      'AE2 — Step 6 checks use the useChecks hook path',
  listDeployments:    'AE2 — deployment history is not surfaced yet',
  rollbackDeployment: 'AE2 — rollback is generated, never pushed',
}

describe('API client surface', () => {
  const client = SOURCES[CLIENT_KEY]
  const names = [...client.matchAll(/^export const (\w+)/gm)].map(m => m[1])
  const others = Object.entries(SOURCES)
    .filter(([k]) => k !== CLIENT_KEY && !k.includes('/test/'))
    .map(([, v]) => v)
    .join('\n')

  it('found the exports at all', () => {
    expect(names.length).toBeGreaterThan(10)
  })

  it('every export is either used or declared pending', () => {
    const orphans = names.filter(n =>
      !(n in PENDING) && !new RegExp(`\\b${n}\\b`).test(others))
    expect(orphans, 'add a caller, or list it in PENDING with its tracker item').toEqual([])
  })

  it('nothing sits in PENDING after it has been wired', () => {
    const stale = Object.keys(PENDING).filter(n => new RegExp(`\\b${n}\\b`).test(others))
    expect(stale, 'these are wired now — remove them from PENDING').toEqual([])
  })

  it('does not offer the weaker server-side config generator', () => {
    // The browser engine covers 10 vendors; the API has 4 and refuses the
    // rest (AB7/AD4). A client function pointing at it is a trap.
    expect(client).not.toMatch(/^export const generateConfigs/m)
  })
})
