/**
 * RcaPanel — run hypothesis-based root cause analysis.
 * Submits to /api/rca/analyze and renders ranked hypotheses.
 */
import React, { useState } from 'react'
import { runRca } from '@/api/client'
import { useStore, selectRca } from '@/store'
import type { RcaHypothesis } from '@/types'

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const colour = pct >= 80 ? '#e53' : pct >= 50 ? '#f90' : '#09f'
  return (
    <div className="rca-bar-wrap" title={`${pct}% confidence`}>
      <div className="rca-bar" style={{ width: `${pct}%`, background: colour }} />
      <span className="rca-bar-label">{pct}%</span>
    </div>
  )
}

function HypothesisCard({ h, rank }: { h: RcaHypothesis; rank: number }) {
  const [open, setOpen] = useState(rank === 0)
  return (
    <div className={`rca-card ${open ? 'rca-card-open' : ''}`}>
      <button className="rca-card-header" onClick={() => setOpen(!open)}>
        <span className="rca-rank">#{rank + 1}</span>
        <span className="rca-cause">{h.root_cause}</span>
        <ConfidenceBar value={h.confidence} />
        <span className="rca-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="rca-card-body">
          {h.evidence.length > 0 && (
            <section>
              <h4>Evidence</h4>
              <ul>{h.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </section>
          )}
          {h.blast_radius.length > 0 && (
            <section>
              <h4>Blast Radius</h4>
              <ul>{h.blast_radius.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </section>
          )}
          {h.remediation_steps.length > 0 && (
            <section>
              <h4>Remediation Steps</h4>
              <ol>{h.remediation_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </section>
          )}
          {h.automation_available && h.automation_playbook && (
            <div className="rca-playbook">
              🤖 Automation available: <code>{h.automation_playbook}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function RcaPanel() {
  const results    = useStore(selectRca)
  const setResults = useStore((s) => s.setRcaResults)
  const [symptom, setSymptom]   = useState('')
  const [devices, setDevices]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!symptom.trim()) return
    setLoading(true)
    setError(null)
    try {
      const affected = devices.split(',').map((s) => s.trim()).filter(Boolean)
      setResults(await runRca(symptom.trim(), affected))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RCA failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rca-panel">
      <form className="rca-form" onSubmit={handleSubmit}>
        <input
          className="rca-input"
          placeholder="Describe the symptom (e.g. BGP session flapping on core-01)"
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
        />
        <input
          className="rca-input"
          placeholder="Affected devices (comma-separated, optional)"
          value={devices}
          onChange={(e) => setDevices(e.target.value)}
        />
        <button className="rca-btn" type="submit" disabled={loading || !symptom.trim()}>
          {loading ? '🔍 Analyzing…' : '🔍 Analyze'}
        </button>
      </form>

      {error && <div className="rca-error">❌ {error}</div>}

      {results.length > 0 && (
        <div className="rca-results">
          <p className="rca-count">{results.length} hypothesis{results.length !== 1 ? 'es' : ''} found</p>
          {results.map((h, i) => <HypothesisCard key={i} h={h} rank={i} />)}
        </div>
      )}
    </div>
  )
}
