/**
 * Login modal — backend auth (username/password + TOTP) with a demo-mode
 * "local profile" quick-login fallback so the per-user experience works
 * without a backend.
 */
import { useState, type FormEvent } from 'react'
import { useAuthStore, ROLES, type Role } from '@/store/useAuthStore'
import { getBackendUrl } from '@/api/client'

interface LoginModalProps {
  open: boolean
  onClose: () => void
}

export function LoginModal({ open, onClose }: LoginModalProps) {
  const loginBackend = useAuthStore(s => s.loginBackend)
  const verifyTotp   = useAuthStore(s => s.verifyTotp)
  const loginLocal   = useAuthStore(s => s.loginLocal)
  const mfaPending   = useAuthStore(s => s.mfaPending)

  const [mode, setMode] = useState<'backend' | 'local'>(getBackendUrl() ? 'backend' : 'local')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [localName, setLocalName] = useState('')
  const [localRole, setLocalRole] = useState<Role>('designer')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  async function handleBackendLogin(e: FormEvent) {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      if (mfaPending) {
        await verifyTotp(totp)
        onClose()
      } else {
        const { mfaRequired } = await loginBackend(username, password)
        if (!mfaRequired) onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  function handleLocalLogin(e: FormEvent) {
    e.preventDefault()
    if (!localName.trim()) { setError('Enter a name for your profile'); return }
    loginLocal(localName, localRole)
    onClose()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-gray-800 border border-white/10 text-sm text-gray-100 focus:border-blue-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-6 h-6" />
            <h2 className="text-lg font-bold text-white">Sign in to NetDesign <span className="text-blue-400">AI</span></h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 cursor-pointer text-xl leading-none" aria-label="Close">×</button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 px-6 pt-4">
          <button onClick={() => { setMode('backend'); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${mode === 'backend' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
            Account
          </button>
          <button onClick={() => { setMode('local'); setError('') }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${mode === 'local' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
            Demo profile
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{error}</div>
        )}

        {mode === 'backend' ? (
          <form onSubmit={handleBackendLogin} className="px-6 py-4 space-y-3">
            {!mfaPending ? (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Email / username</label>
                  <input className={inputCls} value={username} onChange={e => setUsername(e.target.value)}
                    autoComplete="username" placeholder="you@company.com" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Password</label>
                  <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password" placeholder="••••••••" />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Authenticator code</label>
                <input className={inputCls} value={totp} onChange={e => setTotp(e.target.value)}
                  inputMode="numeric" placeholder="6-digit code" autoFocus />
                <p className="text-xs text-gray-500 mt-1">MFA is enabled on this account.</p>
              </div>
            )}
            <button type="submit" disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">
              {busy ? 'Signing in…' : mfaPending ? 'Verify code' : 'Sign in'}
            </button>
            {!getBackendUrl() && (
              <p className="text-xs text-amber-400/80">No backend URL configured — set one in the backend toggle, or use a Demo profile.</p>
            )}
          </form>
        ) : (
          <form onSubmit={handleLocalLogin} className="px-6 py-4 space-y-3">
            <p className="text-xs text-gray-400">
              Demo profiles are stored only in this browser (no password). They namespace your saved designs, preferences, and recent activity.
            </p>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Your name</label>
              <input className={inputCls} value={localName} onChange={e => setLocalName(e.target.value)} placeholder="Amit Tiwari" autoFocus />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Role (controls which features are visible)</label>
              <select className={inputCls} value={localRole} onChange={e => setLocalRole(e.target.value as Role)}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button type="submit"
              className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold cursor-pointer">
              Continue
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
