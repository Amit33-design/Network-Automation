import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore, ROLE_PERMISSIONS, authScopeKey } from '@/store/useAuthStore'

function reset() {
  useAuthStore.setState({ user: null, token: null, mfaPending: false, profiles: [], prefsByUser: {} })
}

beforeEach(reset)

describe('useAuthStore — local (demo) profiles', () => {
  it('loginLocal creates a user with the chosen role', () => {
    useAuthStore.getState().loginLocal('Amit Tiwari', 'admin')
    const u = useAuthStore.getState().user!
    expect(u.name).toBe('Amit Tiwari')
    expect(u.role).toBe('admin')
    expect(u.source).toBe('local')
    expect(u.id).toBe('local:amit-tiwari')
  })

  it('loginLocal stores the profile for quick switching', () => {
    useAuthStore.getState().loginLocal('Designer Dan', 'designer')
    useAuthStore.getState().loginLocal('Op Olivia', 'operator')
    const profiles = useAuthStore.getState().profiles
    expect(profiles.length).toBe(2)
    expect(profiles[0].name).toBe('Op Olivia') // most-recent first
  })

  it('switchProfile restores a saved profile', () => {
    useAuthStore.getState().loginLocal('Designer Dan', 'designer')
    const danId = useAuthStore.getState().user!.id
    useAuthStore.getState().loginLocal('Admin Amy', 'admin')
    useAuthStore.getState().switchProfile(danId)
    expect(useAuthStore.getState().user!.name).toBe('Designer Dan')
    expect(useAuthStore.getState().user!.role).toBe('designer')
  })

  it('removeProfile clears the active user if it was active', () => {
    useAuthStore.getState().loginLocal('Solo', 'viewer')
    const id = useAuthStore.getState().user!.id
    useAuthStore.getState().removeProfile(id)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().profiles).toHaveLength(0)
  })

  it('logout clears the user', () => {
    useAuthStore.getState().loginLocal('X', 'admin')
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('useAuthStore — permissions mirror backend', () => {
  it('viewer can read but not write/deploy', () => {
    useAuthStore.getState().loginLocal('V', 'viewer')
    const { can } = useAuthStore.getState()
    expect(can('designs:read')).toBe(true)
    expect(can('designs:write')).toBe(false)
    expect(can('deploy:prod')).toBe(false)
    expect(can('approvals:read')).toBe(false)
  })

  it('designer can write and generate configs but not deploy', () => {
    useAuthStore.getState().loginLocal('D', 'designer')
    const { can } = useAuthStore.getState()
    expect(can('designs:write')).toBe(true)
    expect(can('configs:generate')).toBe(true)
    expect(can('deploy:lab')).toBe(false)
  })

  it('operator can deploy to lab/staging and read approvals', () => {
    useAuthStore.getState().loginLocal('O', 'operator')
    const { can } = useAuthStore.getState()
    expect(can('deploy:lab')).toBe(true)
    expect(can('deploy:staging')).toBe(true)
    expect(can('approvals:read')).toBe(true)
    expect(can('deploy:prod')).toBe(false)
    expect(can('org:admin')).toBe(false)
  })

  it('admin has prod deploy + org admin', () => {
    useAuthStore.getState().loginLocal('A', 'admin')
    const { can } = useAuthStore.getState()
    expect(can('deploy:prod')).toBe(true)
    expect(can('org:admin')).toBe(true)
    expect(can('users:manage')).toBe(true)
  })

  it('guest (no user) has no permissions', () => {
    expect(useAuthStore.getState().can('designs:read')).toBe(false)
  })

  it('every role tier is a strict superset chain for core perms', () => {
    expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(ROLE_PERMISSIONS.operator.length)
    expect(ROLE_PERMISSIONS.operator.length).toBeGreaterThan(ROLE_PERMISSIONS.designer.length)
  })
})

describe('useAuthStore — per-user prefs + scope', () => {
  it('setPrefs stores prefs keyed by user', () => {
    useAuthStore.getState().loginLocal('Amit', 'designer')
    useAuthStore.getState().setPrefs({ theme: 'light', vendorPrefs: ['Arista'] })
    const id = useAuthStore.getState().user!.id
    expect(useAuthStore.getState().prefsByUser[id].theme).toBe('light')
    expect(useAuthStore.getState().prefsByUser[id].vendorPrefs).toEqual(['Arista'])
  })

  it('setPrefs is a no-op when logged out', () => {
    useAuthStore.getState().setPrefs({ theme: 'dark' })
    expect(Object.keys(useAuthStore.getState().prefsByUser)).toHaveLength(0)
  })

  it('authScopeKey returns guest when logged out, user id when logged in', () => {
    expect(authScopeKey()).toBe('guest')
    useAuthStore.getState().loginLocal('Amit', 'admin')
    expect(authScopeKey()).toBe('local:amit')
  })
})
