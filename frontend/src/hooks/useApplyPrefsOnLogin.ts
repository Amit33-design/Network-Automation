import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'
import {
  isLiveMode, getToken, fetchUserPrefs, fetchUserActivity,
} from '@/api/client'
import type { UserPrefs } from '@/store/useAuthStore'

/**
 * Apply the signing-in user's saved preferences.
 *
 * AE2: this used to read the local Zustand store only, so a preference set on
 * one machine never followed the user to another — the half of §22 J2 that
 * was recorded as shipped and was not. When signed in against a live backend
 * the server copy is fetched first and merged in; the local copy stays the
 * fallback so demo mode and an offline backend both behave exactly as before.
 */
export function useApplyPrefsOnLogin() {
  const user = useAuthStore(s => s.user)
  const prefsByUser = useAuthStore(s => s.prefsByUser)
  const prevUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user || user.id === prevUserId.current) {
      prevUserId.current = user?.id ?? null
      return
    }
    prevUserId.current = user.id
    let cancelled = false

    const apply = (prefs: UserPrefs | undefined) => {
      if (!prefs || cancelled) return
      const store = useAppStore.getState()
      if (prefs.theme && prefs.theme !== store.theme) store.setTheme(prefs.theme)
      if (prefs.vendorPrefs?.length) store.setVendorPrefs(prefs.vendorPrefs)
      if (prefs.lastUseCase && !store.useCase) {
        store.setUseCase(prefs.lastUseCase as Parameters<typeof store.setUseCase>[0])
      }
    }

    const local = prefsByUser[user.id]

    if (!(isLiveMode() && getToken())) {
      apply(local)
      return
    }

    // Server first, local as the fallback and as the base to merge onto — a
    // preference set while offline must not be erased by a sparse server copy.
    void fetchUserPrefs()
      .then(remote => apply({ ...local, ...(remote as UserPrefs) }))
      .catch(() => apply(local))

    // Activity is display-only, so a failure here is silent.
    void fetchUserActivity().catch(() => undefined)

    return () => { cancelled = true }
  }, [user, prefsByUser])
}
