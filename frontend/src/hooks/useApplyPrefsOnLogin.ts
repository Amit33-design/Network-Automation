import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { useAppStore } from '@/store/useAppStore'

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
    const prefs = prefsByUser[user.id]
    if (!prefs) return

    const store = useAppStore.getState()
    if (prefs.theme && prefs.theme !== store.theme) store.setTheme(prefs.theme)
    if (prefs.vendorPrefs?.length) store.setVendorPrefs(prefs.vendorPrefs)
    if (prefs.lastUseCase && !store.useCase) store.setUseCase(prefs.lastUseCase as Parameters<typeof store.setUseCase>[0])
  }, [user, prefsByUser])
}
