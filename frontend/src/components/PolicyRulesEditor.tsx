import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'

interface PolicyRulesEditorProps {
  open: boolean
  onClose: () => void
}

const YAML_TEMPLATE = `# Custom constraint rules
# Each rule is evaluated against your current design settings
rules:
  - id: "CUSTOM-01"
    severity: "error"
    description: "Require BFD with aggressive BGP timers"
    message: "BFD must be enabled when BGP keepalive <= 3s"
    fix: "Add 'BFD' to Protocol Features"

  - id: "CUSTOM-02"
    severity: "warning"
    description: "QoS recommended for video workloads"
    message: "Enable QoS when video application type is selected"
    fix: "Add 'QoS' to Protocol Features"
`

export function PolicyRulesEditor({ open, onClose }: PolicyRulesEditorProps) {
  const customPolicyRules = useAppStore(s => s.customPolicyRules)
  const setCustomPolicyRules = useAppStore(s => s.setCustomPolicyRules)

  const [text, setText] = useState(customPolicyRules || YAML_TEMPLATE)
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  if (!open) return null

  function handleValidate() {
    try {
      // Simple YAML → JSON substitution check: replace YAML-style keys and values
      // We do a best-effort parse by converting basic YAML to a JSON-parseable structure
      const lines = text.split('\n')
      const nonComment = lines.filter(l => !l.trimStart().startsWith('#') && l.trim() !== '')
      if (nonComment.length === 0) {
        setValidationMsg({ ok: false, msg: 'No content to validate.' })
        return
      }
      // Attempt to detect basic structure by checking for "rules:" keyword
      if (!text.includes('rules:')) {
        throw new Error('Missing top-level "rules:" key')
      }
      // Check each rule block has required id and severity fields
      const ruleMatches = text.matchAll(/id:\s*["']?([^"'\n]+)["']?/g)
      const ids = Array.from(ruleMatches).map(m => m[1].trim())
      if (ids.length === 0) {
        throw new Error('No rules found — each rule must have an "id" field')
      }
      const severityMatches = text.matchAll(/severity:\s*["']?(error|warning|info)["']?/g)
      const severities = Array.from(severityMatches)
      if (severities.length !== ids.length) {
        throw new Error(`Found ${ids.length} rule(s) but ${severities.length} severity field(s) — each rule needs a severity`)
      }
      setValidationMsg({ ok: true, msg: `Valid — ${ids.length} rule(s) found: ${ids.join(', ')}` })
    } catch (err) {
      setValidationMsg({ ok: false, msg: `Invalid: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  function handleSave() {
    setCustomPolicyRules(text)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl mx-4 bg-gray-900 border border-white/10 rounded-xl shadow-2xl flex flex-col"
           style={{ height: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-100">Policy Rules Editor</h2>
            <p className="text-xs text-gray-500 mt-0.5">Define custom constraint rules in YAML DSL</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 p-4 overflow-hidden">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setValidationMsg(null) }}
            spellCheck={false}
            className="w-full h-full bg-gray-950 border border-white/10 rounded-lg px-4 py-3 text-sm
                       text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500
                       placeholder-gray-600"
            placeholder={YAML_TEMPLATE}
          />
        </div>

        {/* Validation message */}
        {validationMsg && (
          <div className={`mx-4 mb-2 px-4 py-2 rounded-lg text-sm font-medium ${
            validationMsg.ok
              ? 'bg-green-900/30 border border-green-500/30 text-green-300'
              : 'bg-red-900/30 border border-red-500/30 text-red-300'
          }`}>
            {validationMsg.ok ? '✓ ' : '✗ '}{validationMsg.msg}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleValidate}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-white/20 text-gray-300
                       hover:bg-white/5 transition-colors cursor-pointer"
          >
            Validate
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500
                         text-white transition-colors cursor-pointer"
            >
              Save Rules
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
