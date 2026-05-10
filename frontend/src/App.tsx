/**
 * App shell — houses the new React components.
 * Incremental migration: renders alongside the existing vanilla-JS index.html
 * by mounting into a dedicated <div id="root"> widget when embedded,
 * or as a full SPA when running `npm run dev`.
 */
import React, { useState } from 'react'
import { LiveProgressFeed } from './components/LiveProgressFeed'
import { AlertsPanel } from './components/AlertsPanel'
import { RcaPanel } from './components/RcaPanel'
import { useStore } from './store'
import { isLiveMode } from './api/client'

type Tab = 'deploy' | 'alerts' | 'rca'

export function App() {
  const [tab, setTab] = useState<Tab>('deploy')
  const deploymentId  = useStore((s) => s.deploymentId)
  const clearEvents   = useStore((s) => s.clearDeployEvents)

  if (!isLiveMode()) {
    return (
      <div className="nd-shell nd-offline">
        <h2>⚙️ NetDesign AI — React Shell</h2>
        <p>Backend not configured. Open the backend settings panel and enable Live Mode.</p>
      </div>
    )
  }

  return (
    <div className="nd-shell">
      <nav className="nd-tabs">
        {(['deploy', 'alerts', 'rca'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`nd-tab ${tab === t ? 'nd-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {{ deploy: '🚀 Deploy', alerts: '🔔 Alerts', rca: '🔬 RCA' }[t]}
          </button>
        ))}
      </nav>

      {tab === 'deploy' && (
        <section className="nd-panel">
          {deploymentId ? (
            <>
              <LiveProgressFeed
                deploymentId={deploymentId}
                onComplete={() => setTimeout(clearEvents, 5000)}
              />
            </>
          ) : (
            <div className="nd-placeholder">
              No active deployment. Trigger a deploy from the main panel.
            </div>
          )}
        </section>
      )}

      {tab === 'alerts' && (
        <section className="nd-panel">
          <AlertsPanel />
        </section>
      )}

      {tab === 'rca' && (
        <section className="nd-panel">
          <RcaPanel />
        </section>
      )}
    </div>
  )
}
