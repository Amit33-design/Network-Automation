/**
 * Auth store — frontend login wired to the existing backend auth
 * (`backend/auth.py`: JWT / OIDC / TOTP / RBAC) with graceful demo-mode
 * fallback to local "profiles" (no backend required).
 *
 * Two login paths:
 *   - Backend: POST /api/auth/token → JWT; user identity + role come from
 *     the token response. Survives reload via persisted token.
 *   - Local profile (demo mode): a named, role-tagged identity stored only
 *     in the browser — lets the per-user experience (My Designs, prefs,
 *     role-gated UI) work with no backend, matching the app's demo-first
 *     philosophy.
 *
 * Role/permission model mirrors backend `ROLE_PERMISSIONS` so the UI can
 * gate features client-side (the backend remains the real enforcement point
 * for live deployments).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { login as apiLogin, verifyTotp as apiVerifyTotp, saveSettings } from '@/api/client'
import type { UserActivity, ActivityAction } from '@/types'

export type Role = 'viewer' | 'designer' | 'operator' | 'admin'

export const ROLES: Role[] = ['viewer', 'designer', 'operator', 'admin']

/** Mirror of backend auth.ROLE_PERMISSIONS — keep in sync with backend/auth.py. */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  viewer:   ['designs:read', 'deployments:read', 'audit:read'],
  designer: ['designs:read', 'designs:write', 'configs:generate', 'deployments:read'],
  operator: [
    'designs:read', 'designs:write', 'configs:generate',
    'deployments:read', 'deploy:lab', 'deploy:staging', 'approvals:read',
  ],
  admin: [
    'designs:read', 'designs:write', 'configs:generate',
    'deployments:read', 'deploy:lab', 'deploy:staging', 'deploy:prod',
    'approvals:read', 'audit:read', 'users:manage', 'org:admin',
  ],
}

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  orgId: string | null
  source: 'backend' | 'local'
}

/** Per-user preferences remembered across sessions (scope item: Preferences). */
export interface UserPrefs {
  theme?: 'light' | 'dark'
  vendorPrefs?: string[]
  lastUseCase?: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  mfaPending: boolean
  /** Saved local (demo) profiles for quick switching. */
  profiles: AuthUser[]
  /** Per-user prefs keyed by user id. */
  prefsByUser: Record<string, UserPrefs>
  /** Per-user activity log (most recent first, capped at 50). */
  activitiesByUser: Record<string, UserActivity[]>

  // ── actions ──
  loginBackend: (username: string, password: string, totp?: string) => Promise<{ mfaRequired: boolean }>
  verifyTotp: (code: string) => Promise<void>
  loginLocal: (name: string, role: Role) => void
  switchProfile: (id: string) => void
  removeProfile: (id: string) => void
  logout: () => void
  setPrefs: (patch: UserPrefs) => void
  logActivity: (action: ActivityAction, designName: string, useCase: string) => void
  getActivities: () => UserActivity[]

  // ── selectors (pure) ──
  can: (permission: string) => boolean
}

function roleFrom(raw: string | undefined): Role {
  return (ROLES as string[]).includes(raw ?? '') ? (raw as Role) : 'viewer'
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user'
}


export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      mfaPending: false,
      profiles: [],
      prefsByUser: {},
      activitiesByUser: {},

      loginBackend: async (username, password, totp) => {
        const res = await apiLogin(username, password, totp)
        saveSettings({ token: res.token })
        if (res.mfaRequired) {
          // token is a short-lived pre-MFA token; hold it until TOTP verified
          set({ token: res.token, mfaPending: true })
          return { mfaRequired: true }
        }
        const user: AuthUser = {
          id: username,
          email: username,
          name: username.split('@')[0] || username,
          role: roleFrom(res.role),
          orgId: res.orgId ?? null,
          source: 'backend',
        }
        set({ user, token: res.token, mfaPending: false })
        return { mfaRequired: false }
      },

      verifyTotp: async (code) => {
        const res = await apiVerifyTotp(code)
        saveSettings({ token: res.token })
        const prev = get().user
        const user: AuthUser = {
          id: prev?.id ?? 'user',
          email: prev?.email ?? '',
          name: prev?.name ?? (prev?.email?.split('@')[0] ?? 'user'),
          role: roleFrom(res.role),
          orgId: res.orgId ?? null,
          source: 'backend',
        }
        set({ user, token: res.token, mfaPending: false })
      },

      loginLocal: (name, role) => {
        const id = `local:${slug(name)}`
        const user: AuthUser = {
          id, name: name.trim() || 'User', email: '', role, orgId: null, source: 'local',
        }
        const profiles = get().profiles.filter(p => p.id !== id)
        set({ user, token: null, mfaPending: false, profiles: [user, ...profiles].slice(0, 8) })
      },

      switchProfile: (id) => {
        const p = get().profiles.find(x => x.id === id)
        if (p) set({ user: p, token: null, mfaPending: false })
      },

      removeProfile: (id) => {
        set(s => ({
          profiles: s.profiles.filter(p => p.id !== id),
          user: s.user?.id === id ? null : s.user,
        }))
      },

      logout: () => {
        saveSettings({ token: '' })
        set({ user: null, token: null, mfaPending: false })
      },

      setPrefs: (patch) => {
        const u = get().user
        if (!u) return
        set(s => ({
          prefsByUser: { ...s.prefsByUser, [u.id]: { ...s.prefsByUser[u.id], ...patch } },
        }))
      },

      logActivity: (action, designName, useCase) => {
        const u = get().user
        if (!u) return
        const activity: UserActivity = {
          id: crypto.randomUUID(),
          action,
          designName,
          useCase,
          timestamp: new Date().toISOString(),
        }
        set(s => {
          const key = u.id
          const prev = s.activitiesByUser[key] ?? []
          return {
            activitiesByUser: {
              ...s.activitiesByUser,
              [key]: [activity, ...prev].slice(0, 50),
            },
          }
        })
      },

      getActivities: () => {
        const u = get().user
        if (!u) return []
        return get().activitiesByUser[u.id] ?? []
      },

      can: (permission) => {
        const u = get().user
        if (!u) return false
        return ROLE_PERMISSIONS[u.role]?.includes(permission) ?? false
      },
    }),
    {
      name: 'nd-auth',
      partialize: (s) => ({
        user: s.user, token: s.token, profiles: s.profiles,
        prefsByUser: s.prefsByUser, activitiesByUser: s.activitiesByUser,
      }),
    },
  ),
)

/** Storage-key suffix so per-user data (e.g. My Designs) is namespaced. */
export function authScopeKey(): string {
  return useAuthStore.getState().user?.id ?? 'guest'
}
