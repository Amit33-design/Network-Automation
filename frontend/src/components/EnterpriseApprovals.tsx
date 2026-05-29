import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useAppStore } from '@/store/useAppStore'

interface Approval {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
  environment: string
  summary: string
  risk_score: number
  device_count: number
  requested_by: string
  reviewer_note?: string
  created_at: string
}

const MOCK_APPROVALS: Approval[] = [
  {
    id: 'apr-001-abc', status: 'pending', environment: 'Production',
    summary: 'Spine layer EVPN BGP config push — 4 devices', risk_score: 72,
    device_count: 4, requested_by: 'Jane Smith', created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'apr-002-def', status: 'approved', environment: 'Staging',
    summary: 'Leaf VXLAN config deployment — 8 devices', risk_score: 35,
    device_count: 8, requested_by: 'Bob Lee', reviewer_note: 'LGTM — change window approved',
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'apr-003-ghi', status: 'rejected', environment: 'Production',
    summary: 'Core router BGP policy update', risk_score: 90,
    device_count: 2, requested_by: 'Alice Chen', reviewer_note: 'Too risky without Batfish validation',
    created_at: new Date(Date.now() - 172800000).toISOString(),
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function EnterpriseApprovals({ open, onClose }: Props) {
  const { orgName, devices, useCase } = useAppStore()
  const [tab, setTab] = useState<'pending' | 'all' | 'new'>('pending')
  const [approvals, setApprovals] = useState<Approval[]>(MOCK_APPROVALS)
  const [newEnv, setNewEnv] = useState('production')
  const [newSummary, setNewSummary] = useState('')
  const [newRisk, setNewRisk] = useState(50)
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const pending = approvals.filter(a => a.status === 'pending')
  const displayed = tab === 'pending' ? pending : tab === 'all' ? approvals : []

  function statusColor(s: Approval['status']): 'warn' | 'pass' | 'fail' | 'neutral' {
    if (s === 'pending') return 'warn'
    if (s === 'approved') return 'pass'
    if (s === 'rejected') return 'fail'
    return 'neutral'
  }

  function riskColor(score: number) {
    if (score >= 80) return 'text-red-400'
    if (score >= 50) return 'text-yellow-400'
    return 'text-green-400'
  }

  function handleApprove(id: string) {
    setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'approved', reviewer_note: 'Approved via NetDesign AI' } : a))
  }
  function handleReject(id: string) {
    const note = prompt('Rejection reason (required):')
    if (!note) return
    setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'rejected', reviewer_note: note } : a))
  }
  function handleCancel(id: string) {
    if (!confirm('Cancel this approval request?')) return
    setApprovals(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a))
  }

  async function handleSubmit() {
    if (!newSummary.trim()) return
    setSubmitting(true)
    await new Promise(r => setTimeout(r, 800))
    const id = `apr-${Date.now().toString(36)}`
    setApprovals(prev => [{
      id, status: 'pending', environment: newEnv,
      summary: newSummary, risk_score: newRisk,
      device_count: devices.length || 1,
      requested_by: orgName || 'You',
      created_at: new Date().toISOString(),
    }, ...prev])
    setNewSummary('')
    setTab('pending')
    setSubmitting(false)
  }

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Enterprise Approvals</h2>
            <p className="text-xs text-gray-500 mt-0.5">Review and manage deployment approval workflows</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl cursor-pointer">✕</button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-white/10 px-6">
          {(['pending', 'all', 'new'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer capitalize ${
                tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}>
              {t === 'pending' ? `Pending (${pending.length})` : t === 'all' ? 'All Approvals' : '+ New Request'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {tab === 'new' ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Environment</label>
                <select value={newEnv} onChange={e => setNewEnv(e.target.value)} className={inputCls}>
                  <option value="production">Production</option>
                  <option value="staging">Staging</option>
                  <option value="dev">Development</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Summary</label>
                <textarea value={newSummary} onChange={e => setNewSummary(e.target.value)} rows={3}
                  placeholder={`Deploy ${useCase || 'network'} config to ${devices.length || 0} device(s)`}
                  className={inputCls + ' resize-none'} />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Risk Score: <span className={riskColor(newRisk)}>{newRisk}/100</span></label>
                <input type="range" min={0} max={100} value={newRisk} onChange={e => setNewRisk(+e.target.value)}
                  className="w-full accent-blue-500" />
                <div className="flex justify-between text-xs text-gray-600 mt-1">
                  <span>Low risk</span><span>High risk</span>
                </div>
              </div>
              <div className="text-xs text-gray-500 bg-white/5 rounded-lg p-3">
                This will request approval from your team lead. Devices: <strong className="text-gray-300">{devices.length || 1}</strong>
              </div>
              <Button onClick={handleSubmit} disabled={!newSummary.trim() || submitting}>
                {submitting ? 'Submitting…' : 'Submit for Approval'}
              </Button>
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="text-3xl mb-3">📭</div>
              <div>No {tab === 'pending' ? 'pending' : ''} approvals</div>
            </div>
          ) : (
            displayed.map(a => (
              <div key={a.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={statusColor(a.status)}>{a.status.toUpperCase()}</Badge>
                    <span className="font-semibold text-gray-200 text-sm">{a.environment}</span>
                    <span className="text-xs text-gray-500 font-mono">#{a.id.slice(0, 8)}</span>
                  </div>
                  <span className="text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-300 mb-3">{a.summary}</p>
                <div className="flex gap-4 text-xs text-gray-400 mb-3">
                  <span>Risk: <strong className={riskColor(a.risk_score)}>{a.risk_score}/100</strong></span>
                  <span>Devices: <strong className="text-gray-300">{a.device_count}</strong></span>
                  <span>By: <strong className="text-gray-300">{a.requested_by}</strong></span>
                </div>
                {a.reviewer_note && (
                  <div className="text-xs text-gray-500 italic mb-3">Note: {a.reviewer_note}</div>
                )}
                {a.status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => handleApprove(a.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600/20 border border-green-500/30 text-green-300 hover:bg-green-600/30 cursor-pointer">
                      ✓ Approve
                    </button>
                    <button onClick={() => handleReject(a.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 cursor-pointer">
                      ✕ Reject
                    </button>
                    <button onClick={() => handleCancel(a.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 cursor-pointer">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
