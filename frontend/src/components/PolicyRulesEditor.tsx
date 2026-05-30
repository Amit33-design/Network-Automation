import { useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { parseRules, evaluateCustomPolicy, type EvalResult } from '@/lib/customPolicy'

interface PolicyRulesEditorProps {
  open: boolean
  onClose: () => void
}

const YAML_TEMPLATE = `# Custom governance rules — evaluated against your live design.
# A rule FIRES (becomes a finding) when its "when" expression is true.
# when: "<field> <op> <value>"
#   ops: eq neq contains not_contains in not_in gt lt gte lte
#        is_empty is_not_empty config_contains config_not_contains
#   fields: useCase scale redundancy protoFeatures overlayProtocols
#           underlayProtocol compliance vendorPrefs totalEndpoints
#           oversubscription firewallModel vpnType
rules:
  - id: "CUSTOM-01"
    severity: "error"
    message: "BFD must be enabled for fast convergence in DC fabrics"
    fix: "Add 'BFD' to Protocol Features (Step 2)"
    when: "protoFeatures not_contains BFD"

  - id: "CUSTOM-02"
    severity: "warning"
    message: "EVPN overlay recommended for DC leaf-spine"
    fix: "Add 'EVPN' to overlay protocols"
    when: "overlayProtocols not_contains EVPN"

  - id: "CUSTOM-03"
    severity: "error"
    message: "Oversubscription above 4:1 risks congestion"
    fix: "Lower oversubscription ratio in Step 2"
    when: "oversubscription gt 4"
`

export function PolicyRulesEditor({ open, onClose }: PolicyRulesEditorProps) {
  const customPolicyRules = useAppStore(s => s.customPolicyRules)
  const setCustomPolicyRules = useAppStore(s => s.setCustomPolicyRules)

  const [text, setText] = useState(customPolicyRules || YAML_TEMPLATE)
  const [validationMsg, setValidationMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null)

  if (!open) return null

  function handleValidate() {
    setEvalResult(null)
    const parsed = parseRules(text)
    if (parsed.ok) {
      setValidationMsg({ ok: true, msg: `Valid — ${parsed.rules.length} rule(s): ${parsed.rules.map(r => r.id).join(', ')}` })
    } else {
      setValidationMsg({ ok: false, msg: parsed.errors.join('  •  ') })
    }
  }

  function handleEvaluate() {
    // Read the live design state at click-time (no whole-store subscription).
    const store = useAppStore.getState()
    // Build a flat intent context from the current design store.
    const intent: Record<string, unknown> = {
      useCase: store.useCase,
      scale: store.scale,
      redundancy: store.redundancy,
      compliance: store.compliance,
      protoFeatures: store.protoFeatures,
      overlayProtocols: store.overlayProtocols,
      underlayProtocol: store.underlayProtocol,
      vendorPrefs: store.vendorPrefs,
      totalEndpoints: store.totalEndpoints,
      oversubscription: store.oversubscription,
      firewallModel: store.firewallModel,
      vpnType: store.vpnType,
    }
    const configBlob = Object.values(store.configs ?? {}).join('\n')
    const result = evaluateCustomPolicy(text, { intent, configBlob })
    setEvalResult(result)
    if (result.parseErrors.length) {
      setValidationMsg({ ok: false, msg: result.parseErrors.join('  •  ') })
    } else {
      setValidationMsg(null)
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

        {/* Evaluation results — fired rules against the live design */}
        {evalResult && (
          <div className="mx-4 mb-2 rounded-lg border border-white/10 bg-gray-950/60 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 text-xs">
              <span className={`px-2 py-0.5 rounded font-bold ${
                evalResult.gateStatus === 'PASS'  ? 'bg-green-600/30 text-green-300' :
                evalResult.gateStatus === 'WARN'  ? 'bg-yellow-600/30 text-yellow-300' :
                evalResult.gateStatus === 'BLOCK' ? 'bg-red-700/40 text-red-200' :
                'bg-red-600/30 text-red-300'
              }`}>
                GATE: {evalResult.gateStatus}
              </span>
              <span className="text-gray-400">
                {evalResult.firedCount} of {evalResult.ruleCount} rule(s) fired
              </span>
              <span className="ml-auto text-gray-500">
                <span className="text-red-400">{evalResult.violations.length} violations</span>
                {' · '}
                <span className="text-yellow-400">{evalResult.warnings.length} warnings</span>
                {' · '}
                <span className="text-blue-400">{evalResult.infos.length} info</span>
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto divide-y divide-white/5">
              {[...evalResult.violations, ...evalResult.warnings, ...evalResult.infos].length === 0 ? (
                <div className="px-4 py-3 text-xs text-green-300">
                  ✓ No rules fired — the current design satisfies all custom policies.
                </div>
              ) : (
                [...evalResult.violations, ...evalResult.warnings, ...evalResult.infos].map(f => (
                  <div key={f.id} className="px-4 py-2 text-xs flex items-start gap-2">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
                      f.severity === 'BLOCK' ? 'bg-red-700/40 text-red-200' :
                      f.severity === 'FAIL'  ? 'bg-red-600/30 text-red-300' :
                      f.severity === 'WARN'  ? 'bg-yellow-600/30 text-yellow-300' :
                      'bg-blue-600/30 text-blue-300'
                    }`}>
                      {f.severity}
                    </span>
                    <div className="min-w-0">
                      <span className="text-gray-300 font-semibold">{f.id}</span>
                      <span className="text-gray-400"> — {f.message}</span>
                      {f.fix && <div className="text-gray-500 mt-0.5">→ {f.fix}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-white/20 text-gray-300
                         hover:bg-white/5 transition-colors cursor-pointer"
            >
              Validate
            </button>
            <button
              onClick={handleEvaluate}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-blue-500/40 text-blue-300
                         hover:bg-blue-500/10 transition-colors cursor-pointer"
            >
              Evaluate against design
            </button>
          </div>
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
