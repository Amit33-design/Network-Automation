import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'

// ── Policy block definitions ──────────────────────────────────────────────────

interface PolicyBlock {
  id: string
  label: string
  icon: string
  description: string
  preview: string
}

const POLICY_BLOCKS: PolicyBlock[] = [
  {
    id: 'ntp',
    label: 'NTP',
    icon: '🕐',
    description: 'Configure NTP server with authentication',
    preview: `ntp server <NTP-SERVER-IP> prefer
ntp authenticate
ntp authentication-key 1 md5 <CHANGE-ME-NTP-KEY>
ntp trusted-key 1`,
  },
  {
    id: 'aaa',
    label: 'AAA',
    icon: '🔐',
    description: 'RADIUS-based authentication, authorization, and accounting',
    preview: `radius-server host <CHANGE-ME-RADIUS-IP> auth-port 1812 acct-port 1813
radius-server key <CHANGE-ME-RADIUS-KEY>
aaa new-model
aaa authentication login default group radius local
aaa authorization exec default group radius local
aaa accounting exec default start-stop group radius`,
  },
  {
    id: 'snmp',
    label: 'SNMP',
    icon: '📡',
    description: 'SNMP v2c read-only community and v3 auth, plus trap receiver',
    preview: `snmp-server community <CHANGE-ME-COMMUNITY> RO
snmp-server group NETOPS v3 auth
snmp-server user netops-user NETOPS v3 auth sha <CHANGE-ME-SNMP-KEY>
snmp-server trap-source Loopback0
snmp-server host <CHANGE-ME-TRAP-HOST> version 2c <CHANGE-ME-COMMUNITY>
snmp-server enable traps`,
  },
  {
    id: 'lldp',
    label: 'LLDP',
    icon: '🔗',
    description: 'Enable LLDP for neighbor discovery (replaces CDP on non-Cisco)',
    preview: `! IOS-XE / NX-OS
lldp run
feature lldp

! Arista EOS
lldp run

! Junos
set protocols lldp interface all`,
  },
  {
    id: 'syslog',
    label: 'Syslog',
    icon: '📋',
    description: 'Remote syslog with informational trap level',
    preview: `logging host <CHANGE-ME-SYSLOG-HOST>
logging trap informational
logging source-interface Loopback0
logging on`,
  },
  {
    id: 'banner',
    label: 'Banner MOTD',
    icon: '⚠️',
    description: 'Unauthorized access warning banner',
    preview: `banner motd ^
*******************************************************************************
*  AUTHORIZED ACCESS ONLY                                                     *
*  Unauthorized access to this system is prohibited and will be prosecuted    *
*  under applicable law. All activities on this system are monitored.         *
*******************************************************************************
^`,
  },
  {
    id: 'ssh',
    label: 'SSH Hardening',
    icon: '🛡️',
    description: 'SSHv2 only, max sessions, idle timeout, key exchange hardening',
    preview: `ip ssh version 2
ip ssh time-out 60
ip ssh authentication-retries 3
ip ssh maxstartups 10
no ip ssh version 1
line vty 0 15
 transport input ssh
 exec-timeout 10 0
 session-timeout 10`,
  },
  {
    id: 'disable-services',
    label: 'Disable Unused Services',
    icon: '🚫',
    description: 'Disable HTTP server, CDP (if LLDP selected), service pad, and Finger',
    preview: `no ip http server
no ip http secure-server
no service finger
no service pad
no ip source-route
no service tcp-small-servers
no service udp-small-servers`,
  },
  {
    id: 'password-policy',
    label: 'Password Policy',
    icon: '🔑',
    description: 'Minimum length 12, complexity requirements, encryption',
    preview: `security passwords min-length 12
service password-encryption
enable secret <CHANGE-ME-ENABLE-SECRET>
username admin privilege 15 secret <CHANGE-ME-ADMIN-PASS>
aaa password restriction
 minimum-length 12
 upper-case 1
 lower-case 1
 numeric-count 1
 special-char 1`,
  },
  {
    id: 'archive',
    label: 'Archive / Rollback',
    icon: '💾',
    description: 'Config archive with automatic logging on change',
    preview: `archive
 path flash:archive/config-$h-$t
 maximum 10
 time-period 1440
 write-memory
 log config
  logging enable
  notify syslog contenttype plaintext
  hidekeys`,
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface ConfigPolicyModalProps {
  open: boolean
  onClose: () => void
}

export function ConfigPolicyModal({ open, onClose }: ConfigPolicyModalProps) {
  const policyBlocks = useAppStore(s => s.policyBlocks)
  const setPolicyBlocks = useAppStore(s => s.setPolicyBlocks)

  // Local copy so we can cancel without persisting
  const [selected, setSelected] = useState<Set<string>>(new Set(policyBlocks))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Sync when modal opens
  useEffect(() => {
    if (open) setSelected(new Set(policyBlocks))
  }, [open, policyBlocks])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  function toggleBlock(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    setPolicyBlocks(Array.from(selected))
    onClose()
  }

  function handleSelectAll() {
    setSelected(new Set(POLICY_BLOCKS.map(b => b.id)))
  }

  function handleClearAll() {
    setSelected(new Set())
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" aria-modal="true" role="dialog" aria-label="Config Policy Blocks">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Config Policy Blocks</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Select policy blocks to prepend to all generated device configs
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 transition-colors cursor-pointer text-xl leading-none" aria-label="Close">
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-white/5 shrink-0">
          <span className="text-xs text-gray-500">
            {selected.size} of {POLICY_BLOCKS.length} blocks selected
          </span>
          <div className="flex gap-2">
            <button onClick={handleSelectAll} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer transition-colors">
              Select all
            </button>
            <span className="text-gray-700">|</span>
            <button onClick={handleClearAll} className="text-xs text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
              Clear all
            </button>
          </div>
        </div>

        {/* Body — policy block list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-2">
          {POLICY_BLOCKS.map(block => {
            const isSelected = selected.has(block.id)
            const isExpanded = expandedId === block.id

            return (
              <div
                key={block.id}
                className={[
                  'rounded-xl border transition-all',
                  isSelected
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-white/10 bg-white/5',
                ].join(' ')}
              >
                {/* Row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleBlock(block.id)}
                    className={[
                      'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'border-gray-600 bg-transparent hover:border-gray-400',
                    ].join(' ')}
                    aria-checked={isSelected}
                    role="checkbox"
                  >
                    {isSelected && (
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>

                  {/* Icon + Label */}
                  <span className="text-lg shrink-0">{block.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={['text-sm font-semibold', isSelected ? 'text-blue-200' : 'text-gray-300'].join(' ')}>
                      {block.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{block.description}</div>
                  </div>

                  {/* Preview toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : block.id)}
                    className="shrink-0 text-xs text-gray-600 hover:text-gray-300 cursor-pointer transition-colors px-2 py-1 rounded hover:bg-white/5"
                    title={isExpanded ? 'Hide preview' : 'Show preview'}
                  >
                    {isExpanded ? '▲ Hide' : '▼ Preview'}
                  </button>
                </div>

                {/* Preview panel */}
                {isExpanded && (
                  <div className="px-4 pb-3">
                    <pre className="text-xs text-green-400 bg-gray-950 rounded-lg p-3 overflow-x-auto border border-white/5 font-mono leading-relaxed whitespace-pre">
                      {block.preview}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <span className="text-xs text-gray-600">
            Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">Esc</kbd> to cancel
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 border border-white/10 hover:border-white/20 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
            >
              Save Policy ({selected.size} block{selected.size !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
