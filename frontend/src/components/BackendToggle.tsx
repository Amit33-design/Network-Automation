import { createContext, useContext, useState, type ReactNode } from 'react'

// ── Context ───────────────────────────────────────────────────────────────────

interface BackendModeValue {
  isLive: boolean
  baseUrl: string
}

const BackendModeContext = createContext<BackendModeValue>({
  isLive: false,
  baseUrl: 'http://localhost:8000',
})

export function useBackendMode(): BackendModeValue {
  return useContext(BackendModeContext)
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface BackendToggleProviderProps {
  children: ReactNode
  value: BackendModeValue
}

export function BackendToggleProvider({ children, value }: BackendToggleProviderProps) {
  return (
    <BackendModeContext.Provider value={value}>
      {children}
    </BackendModeContext.Provider>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BackendToggleProps {
  isLive: boolean
  baseUrl: string
  onToggle: (isLive: boolean) => void
  onUrlChange: (url: string) => void
}

export function BackendToggle({ isLive, baseUrl, onToggle, onUrlChange }: BackendToggleProps) {
  const [editing, setEditing] = useState(false)
  const [urlDraft, setUrlDraft] = useState(baseUrl)

  function handleToggle() {
    onToggle(!isLive)
  }

  function commitUrl() {
    const trimmed = urlDraft.trim()
    if (trimmed) {
      onUrlChange(trimmed)
    } else {
      setUrlDraft(baseUrl)
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-2 select-none">
      {/* Badge */}
      {isLive ? (
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400 border border-green-500/40 tracking-wide">
          LIVE
        </span>
      ) : (
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-700/60 text-gray-400 border border-gray-600/40 tracking-wide">
          SIM
        </span>
      )}

      {/* Pill toggle */}
      <button
        onClick={handleToggle}
        title={isLive ? 'Switch to Simulation mode' : 'Switch to Live mode'}
        className={[
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200',
          isLive
            ? 'bg-green-500 border-green-500'
            : 'bg-gray-600 border-gray-600',
        ].join(' ')}
        role="switch"
        aria-checked={isLive}
      >
        <span
          className={[
            'pointer-events-none inline-block h-3.5 w-3.5 mt-px rounded-full bg-white shadow transition-transform duration-200',
            isLive ? 'translate-x-3.5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>

      {/* URL input — only shown in Live mode, hidden on small screens */}
      {isLive && (
        editing ? (
          <div className="hidden sm:flex items-center gap-1">
            <input
              className="h-6 px-2 text-xs bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-green-500 w-44"
              value={urlDraft}
              onChange={e => setUrlDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitUrl()
                if (e.key === 'Escape') { setUrlDraft(baseUrl); setEditing(false) }
              }}
              autoFocus
            />
            <button
              onClick={commitUrl}
              className="text-xs text-green-400 hover:text-green-300 px-1 cursor-pointer"
            >
              OK
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setUrlDraft(baseUrl); setEditing(true) }}
            title="Click to edit backend URL"
            className="hidden sm:block text-xs text-gray-400 hover:text-green-300 font-mono truncate max-w-[160px] cursor-pointer transition-colors"
          >
            {baseUrl}
          </button>
        )
      )}
    </div>
  )
}
