import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

type Provider = 'slack' | 'teams' | 'servicenow' | 'jira' | 'netbox' | 'awx' | 'gitops'
type Status = 'idle' | 'testing' | 'ok' | 'error'

interface IntegrationConfig {
  enabled: boolean
  url: string
  token: string
  extra: string
  status: Status
  error?: string
}

const DEFAULT_CONFIG: IntegrationConfig = { enabled: false, url: '', token: '', extra: '', status: 'idle' }

const PROVIDERS: Array<{ id: Provider; label: string; icon: string; desc: string; extraLabel?: string; urlPlaceholder: string; tokenLabel: string }> = [
  { id: 'slack',       icon: '💬', label: 'Slack',       desc: 'Post deploy events to a Slack channel',          urlPlaceholder: 'https://hooks.slack.com/services/...', tokenLabel: 'Webhook URL' },
  { id: 'teams',       icon: '🔵', label: 'MS Teams',    desc: 'Post deploy events to a Teams channel',          urlPlaceholder: 'https://outlook.office.com/webhook/...', tokenLabel: 'Webhook URL' },
  { id: 'servicenow',  icon: '🎫', label: 'ServiceNow',  desc: 'Auto-create ITSM change tickets on deploy',      urlPlaceholder: 'https://company.service-now.com', tokenLabel: 'API Token', extraLabel: 'Username' },
  { id: 'jira',        icon: '📋', label: 'Jira',        desc: 'Create Jira issues for change requests',         urlPlaceholder: 'https://company.atlassian.net', tokenLabel: 'API Token', extraLabel: 'Project Key' },
  { id: 'netbox',      icon: '📦', label: 'NetBox',      desc: 'Sync device inventory to NetBox IPAM/DCIM',      urlPlaceholder: 'https://netbox.company.com', tokenLabel: 'API Token' },
  { id: 'awx',         icon: '⚙️',  label: 'AWX / AAP',  desc: 'Trigger Ansible AWX job templates on deploy',    urlPlaceholder: 'https://awx.company.com', tokenLabel: 'API Token', extraLabel: 'Job Template ID' },
  { id: 'gitops',      icon: '🌿', label: 'GitOps',      desc: 'Push generated configs to a Git repository',     urlPlaceholder: 'https://github.com/org/repo', tokenLabel: 'Personal Access Token', extraLabel: 'Branch name' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function IntegrationsPanel({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Provider>('slack')
  const [configs, setConfigs] = useState<Record<Provider, IntegrationConfig>>(
    Object.fromEntries(PROVIDERS.map(p => [p.id, { ...DEFAULT_CONFIG }])) as Record<Provider, IntegrationConfig>
  )

  if (!open) return null

  const prov = PROVIDERS.find(p => p.id === activeTab)!
  const cfg  = configs[activeTab]

  function update(patch: Partial<IntegrationConfig>) {
    setConfigs(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], ...patch } }))
  }

  async function handleTest() {
    if (!cfg.url.trim()) return
    update({ status: 'testing', error: undefined })
    await new Promise(r => setTimeout(r, 1200))
    // In a real implementation, this would call /api/integrations/test
    const ok = cfg.url.startsWith('http')
    update({ status: ok ? 'ok' : 'error', error: ok ? undefined : 'Could not reach the endpoint' })
  }

  async function handleSave() {
    // In a real implementation, POST to /api/integrations
    update({ status: 'ok' })
  }

  const enabledCount = Object.values(configs).filter(c => c.enabled && c.status === 'ok').length

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Integrations</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Connect to external systems  ·  {enabledCount} active integration{enabledCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl cursor-pointer">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Left provider list */}
          <div className="w-44 border-r border-white/10 py-3 shrink-0 overflow-y-auto">
            {PROVIDERS.map(p => {
              const c = configs[p.id]
              return (
                <button key={p.id} onClick={() => setActiveTab(p.id)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors cursor-pointer text-left ${
                    activeTab === p.id ? 'bg-blue-600/20 text-blue-300' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                  }`}>
                  <span className="text-base">{p.icon}</span>
                  <span className="flex-1">{p.label}</span>
                  {c.enabled && c.status === 'ok' && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
                </button>
              )
            })}
          </div>

          {/* Right config form */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl">{prov.icon}</span>
              <div>
                <h3 className="font-semibold text-gray-100">{prov.label}</h3>
                <p className="text-xs text-gray-500">{prov.desc}</p>
              </div>
              {cfg.status === 'ok' && <Badge variant="pass" className="ml-auto">Connected</Badge>}
              {cfg.status === 'error' && <Badge variant="fail" className="ml-auto">Error</Badge>}
            </div>

            <div className="space-y-4">
              {/* Enable toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`relative w-10 h-6 rounded-full transition-colors ${cfg.enabled ? 'bg-blue-600' : 'bg-white/20'}`}
                  onClick={() => update({ enabled: !cfg.enabled })}>
                  <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${cfg.enabled ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-sm text-gray-300">Enable {prov.label} integration</span>
              </label>

              {cfg.enabled && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">{prov.id === 'slack' || prov.id === 'teams' ? prov.tokenLabel : 'Base URL'}</label>
                    <input type="text" value={prov.id === 'slack' || prov.id === 'teams' ? cfg.token : cfg.url}
                      onChange={e => prov.id === 'slack' || prov.id === 'teams' ? update({ token: e.target.value }) : update({ url: e.target.value })}
                      placeholder={prov.urlPlaceholder} className={inputCls} />
                  </div>

                  {prov.id !== 'slack' && prov.id !== 'teams' && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">{prov.tokenLabel}</label>
                      <input type="password" value={cfg.token} onChange={e => update({ token: e.target.value })}
                        placeholder="••••••••••••••••" className={inputCls} />
                    </div>
                  )}

                  {prov.extraLabel && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">{prov.extraLabel}</label>
                      <input type="text" value={cfg.extra} onChange={e => update({ extra: e.target.value })}
                        placeholder={prov.extraLabel} className={inputCls} />
                    </div>
                  )}

                  {cfg.status === 'error' && cfg.error && (
                    <div className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg px-3 py-2">{cfg.error}</div>
                  )}
                  {cfg.status === 'ok' && (
                    <div className="text-xs text-green-400 bg-green-600/10 border border-green-500/20 rounded-lg px-3 py-2">
                      Connection successful — {prov.label} is ready to receive events
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={handleTest} disabled={cfg.status === 'testing'}
                      size="sm">
                      {cfg.status === 'testing' ? 'Testing…' : 'Test Connection'}
                    </Button>
                    <Button onClick={handleSave} disabled={!cfg.url.trim() && !cfg.token.trim()} size="sm">
                      Save
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Integration-specific notes */}
            {prov.id === 'netbox' && (
              <div className="mt-5 text-xs text-gray-500 bg-white/5 rounded-lg p-3">
                NetBox sync will push BOM devices, IP assignments, and interface details after each design generation.
              </div>
            )}
            {prov.id === 'awx' && (
              <div className="mt-5 text-xs text-gray-500 bg-white/5 rounded-lg p-3">
                AWX will trigger the specified job template with device inventory automatically derived from the current BOM.
              </div>
            )}
            {prov.id === 'gitops' && (
              <div className="mt-5 text-xs text-gray-500 bg-white/5 rounded-lg p-3">
                Generated configs will be committed to a <code>configs/</code> directory in the repo after each successful Config Gen step.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
