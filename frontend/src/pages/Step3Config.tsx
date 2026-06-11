import { useState, useEffect, useRef, useMemo } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAppStore } from '@/store/useAppStore'
import { generateAllConfigs } from '@/lib/configgen'
import { Button } from '@/components/ui/Button'
import { downloadText } from '@/lib/utils'

// ── Diff engine (M-34) ────────────────────────────────────────────────────────

type DiffLine =
  | { kind: 'add';     text: string }
  | { kind: 'remove';  text: string }
  | { kind: 'same';    text: string }

/**
 * LCS-based line diff.
 * Returns an array of DiffLine records representing the unified diff of a vs b.
 */
function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a === '' ? [] : a.split('\n')
  const bLines = b === '' ? [] : b.split('\n')

  const m = aLines.length
  const n = bLines.length

  // Build LCS table (only need two rows for O(mn) space)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aLines[i - 1] === bLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Back-track to build diff
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      result.push({ kind: 'same', text: aLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ kind: 'add', text: bLines[j - 1] })
      j--
    } else {
      result.push({ kind: 'remove', text: aLines[i - 1] })
      i--
    }
  }
  result.reverse()
  return result
}

// ── Layer filter helpers ──────────────────────────────────────────────────────

type LayerFilter = 'All' | 'Spine' | 'Leaf' | 'Firewall' | 'Border' | 'Access'

const LAYER_FILTERS: LayerFilter[] = ['All', 'Spine', 'Leaf', 'Firewall', 'Border', 'Access']

function matchesLayer(device: { role?: string; subLayer?: string }, filter: LayerFilter): boolean {
  if (filter === 'All') return true
  const haystack = `${device.role ?? ''} ${device.subLayer ?? ''}`.toLowerCase()
  return haystack.includes(filter.toLowerCase())
}

// ── Section nav helpers ───────────────────────────────────────────────────────

interface ConfigSection {
  label: string
  lineIndex: number  // 0-based line index inside the config text
}

/**
 * Parse config text for section headers like:
 *   ! === MANAGEMENT ===
 *   ! ====== VLANS ======
 *   ! --- INTERFACES ---
 */
function parseSections(configText: string): ConfigSection[] {
  const sections: ConfigSection[] = []
  const lines = configText.split('\n')
  const sectionRe = /^!\s*[=\-]{2,}\s*([A-Z][A-Z0-9 /\-_]+?)\s*[=\-]{2,}/i
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(sectionRe)
    if (m) {
      sections.push({ label: m[1].trim().toUpperCase(), lineIndex: i })
    }
  }
  return sections
}

export function Step3Config() {
  const { devices, configs, setConfigs, useCase, policyBlocks, appTypes, nextStep, prevStep } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('All')
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // M-34 — diff viewer state
  type ViewMode = 'config' | 'diff'
  const [viewMode, setViewMode] = useState<ViewMode>('config')
  const [prevConfig, setPrevConfig] = useState('')

  // Generate (or re-generate) configs whenever devices, useCase, or the selected
  // policy overlay changes. Regenerate when any device is missing a config (empty
  // store / stale from a previous use-case or scale selection) OR when the policy
  // block selection changed since the last generation.
  const policySig = policyBlocks.join(',')
  const prevPolicySig = useRef<string>('')
  useEffect(() => {
    if (!devices.length) return
    const needsRegen = devices.some(d => !configs[d.id])
    if (needsRegen || prevPolicySig.current !== policySig) {
      setConfigs(generateAllConfigs(devices, useCase, policyBlocks, appTypes))
      prevPolicySig.current = policySig
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, useCase, policySig, appTypes])

  // Filtered device list (M-35)
  const filteredDevices = useMemo(
    () => devices.filter(d => matchesLayer(d, layerFilter)),
    [devices, layerFilter],
  )

  // Auto-select first visible device when filter changes
  useEffect(() => {
    if (!selectedId && devices.length) {
      setSelectedId(devices[0].id)
    }
  }, [devices, selectedId])

  useEffect(() => {
    if (filteredDevices.length > 0) {
      const stillVisible = filteredDevices.some(d => d.id === selectedId)
      if (!stillVisible) setSelectedId(filteredDevices[0].id)
    }
  }, [filteredDevices, selectedId])

  // Current config text
  const configText = selectedId ? (configs[selectedId] ?? '') : ''

  // Parse sections for the section nav (M-33)
  const sections = useMemo(() => parseSections(configText), [configText])

  // M-36 — collapse/expand all sections toggle (reset when device or view mode changes)
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false)
  useEffect(() => { setSectionsCollapsed(false) }, [selectedId, viewMode])

  // M-34 — diff computation (current = configText, previous = prevConfig textarea)
  const diffLines = useMemo<DiffLine[]>(() => {
    if (viewMode !== 'diff') return []
    return lineDiff(prevConfig, configText)
  }, [viewMode, prevConfig, configText])

  const diffAdded   = useMemo(() => diffLines.filter(l => l.kind === 'add').length,    [diffLines])
  const diffRemoved = useMemo(() => diffLines.filter(l => l.kind === 'remove').length, [diffLines])
  const diffSame    = useMemo(() => diffLines.filter(l => l.kind === 'same').length,   [diffLines])

  // Mount/update CodeMirror editor
  useEffect(() => {
    if (!editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    viewRef.current = new EditorView({
      state: EditorState.create({
        doc: configText,
        extensions: [oneDark, EditorView.lineWrapping],
      }),
      parent: editorRef.current,
    })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [selectedId, configs])

  // Jump to a section line in the CodeMirror editor (M-33)
  function scrollToSection(lineIndex: number) {
    const view = viewRef.current
    if (!view) return
    // CodeMirror line numbers are 1-based
    const line = view.state.doc.line(lineIndex + 1)
    view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
    })
    view.focus()
  }

  // M-36 — expand from collapsed view and scroll to the chosen section
  function expandAndScrollTo(lineIndex: number) {
    setSectionsCollapsed(false)
    // Scroll after React re-renders and CodeMirror is visible again
    setTimeout(() => scrollToSection(lineIndex), 50)
  }

  const selectedDevice = devices.find(d => d.id === selectedId)

  function downloadAll() {
    const zip = Object.entries(configs)
      .map(([id, cfg]) => {
        const dev = devices.find(d => d.id === id)
        return `! ====== ${dev?.hostname ?? id} ======\n${cfg}\n`
      })
      .join('\n')
    downloadText('all-configs.txt', zip)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Device Configurations</h2>
          <p className="text-sm text-gray-400">{devices.length} configs generated</p>
        </div>
        <Button variant="secondary" size="sm" onClick={downloadAll}>&#8595; Download All</Button>
      </div>

      <div className="flex gap-4 min-h-[500px]">
        {/* Device list sidebar with layer filter chips (M-35) */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-2">
          {/* Layer filter chips */}
          <div className="flex flex-wrap gap-1">
            {LAYER_FILTERS.map(layer => (
              <button
                key={layer}
                onClick={() => setLayerFilter(layer)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  layerFilter === layer
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200 border border-white/10'
                }`}
              >
                {layer}
              </button>
            ))}
          </div>

          {/* Device list */}
          <div className="flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
            {filteredDevices.length === 0 ? (
              <p className="text-xs text-gray-600 px-2 py-3 text-center">No devices match</p>
            ) : (
              filteredDevices.map(dev => (
                <button
                  key={dev.id}
                  onClick={() => setSelectedId(dev.id)}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                    selectedId === dev.id
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                      : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
                  }`}
                >
                  <div className="font-mono font-semibold">{dev.hostname}</div>
                  <div className="text-gray-500 mt-0.5">{dev.subLayer}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col gap-2">
          {selectedDevice && (
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-gray-300 font-mono font-semibold">
                {selectedDevice.hostname}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadText(`${selectedDevice.hostname}.txt`, configs[selectedDevice.id] ?? '')}
              >
                &#8595; Download
              </Button>
            </div>
          )}

          {/* M-34 — View toggle: Config / Diff */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-gray-500 font-medium mr-1">View:</span>
            {(['config', 'diff'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-0.5 rounded text-xs font-semibold border transition-colors ${
                  viewMode === mode
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Section nav chips (M-33) + Collapse All / Expand All toggle (M-36) */}
          {viewMode === 'config' && sections.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-1">
              {/* Collapse / Expand All button */}
              <button
                onClick={() => setSectionsCollapsed(prev => !prev)}
                title={sectionsCollapsed ? 'Expand All' : 'Collapse All'}
                className="px-2 py-0.5 rounded text-xs font-semibold border transition-colors
                           bg-white/5 border-white/20 text-gray-300
                           hover:bg-blue-600/20 hover:text-blue-300 hover:border-blue-500/30
                           mr-1 flex-shrink-0"
              >
                {sectionsCollapsed ? '⊞ Expand All' : '⊟ Collapse All'}
              </button>

              {/* Section chips — still visible in both states so user can jump directly */}
              {sections.map(sec => (
                <button
                  key={`${sec.label}-${sec.lineIndex}`}
                  onClick={() => sectionsCollapsed
                    ? expandAndScrollTo(sec.lineIndex)
                    : scrollToSection(sec.lineIndex)}
                  className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-white/5 border border-white/10
                             text-gray-400 hover:bg-blue-600/20 hover:text-blue-300 hover:border-blue-500/30
                             transition-colors"
                >
                  {sec.label}
                </button>
              ))}
            </div>
          )}

          {/* CodeMirror viewer — hidden in diff mode or when sections collapsed (M-36) */}
          <div
            ref={editorRef}
            className={`flex-1 rounded-xl overflow-hidden border border-white/10 text-sm ${
              viewMode === 'diff' || sectionsCollapsed ? 'hidden' : ''
            }`}
            style={{ minHeight: 460 }}
          />

          {/* M-36 — Collapsed section list view */}
          {viewMode === 'config' && sectionsCollapsed && sections.length > 0 && (
            <div
              className="flex-1 rounded-xl border border-white/10 bg-white/5 overflow-y-auto divide-y divide-white/5"
              style={{ minHeight: 460 }}
            >
              {sections.map(sec => (
                <button
                  key={`collapsed-${sec.label}-${sec.lineIndex}`}
                  onClick={() => expandAndScrollTo(sec.lineIndex)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left
                             text-gray-300 hover:bg-white/5 hover:text-blue-300
                             transition-colors group"
                >
                  <span className="text-gray-500 group-hover:text-blue-400 transition-colors flex-shrink-0">
                    &#62;
                  </span>
                  <span className="font-mono text-sm font-medium">{sec.label}</span>
                  <span className="ml-auto text-xs text-gray-600 group-hover:text-gray-400 transition-colors">
                    line {sec.lineIndex + 1}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* M-34 — Diff pane */}
          {viewMode === 'diff' && (
            <div className="flex-1 flex flex-col gap-2" style={{ minHeight: 460 }}>
              {/* Two-column inputs */}
              <div className="grid grid-cols-2 gap-2">
                {/* Left: current generated config (read-only) */}
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400 font-medium px-1">Current Config (generated)</span>
                  <textarea
                    readOnly
                    value={configText}
                    className="w-full h-40 rounded-lg border border-white/10 bg-[#080E1A] font-mono text-xs
                               text-gray-300 p-2 resize-none focus:outline-none"
                  />
                </div>
                {/* Right: paste previous config */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs text-gray-400 font-medium">Previous Config</span>
                    <button
                      onClick={() => setPrevConfig('')}
                      className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <textarea
                    value={prevConfig}
                    onChange={e => setPrevConfig(e.target.value)}
                    placeholder="Paste previous config here..."
                    className="w-full h-40 rounded-lg border border-white/10 bg-white/5 font-mono text-xs
                               text-gray-300 p-2 resize-none focus:outline-none focus:border-blue-500/50
                               placeholder:text-gray-600"
                  />
                </div>
              </div>

              {/* Summary bar */}
              {(diffAdded + diffRemoved + diffSame) > 0 && (
                <div className="flex items-center gap-4 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono">
                  <span className="text-green-400">+{diffAdded} added</span>
                  <span className="text-red-400">−{diffRemoved} removed</span>
                  <span className="text-gray-500">{diffSame} unchanged</span>
                </div>
              )}

              {/* Unified diff output */}
              {diffLines.length > 0 ? (
                <div className="flex-1 rounded-xl border border-white/10 bg-[#080E1A] p-3 font-mono text-xs overflow-y-auto"
                     style={{ minHeight: 200 }}>
                  {diffLines.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.kind === 'add'    ? 'text-green-400 bg-green-500/5' :
                        line.kind === 'remove' ? 'text-red-400 bg-red-500/5' :
                        'text-gray-600'
                      }
                    >
                      <span className="select-none mr-2 w-4 inline-block">
                        {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                      </span>
                      {line.text || ' '}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 rounded-xl border border-white/10 bg-[#080E1A] p-4 flex items-center justify-center"
                     style={{ minHeight: 200 }}>
                  <p className="text-xs text-gray-600">
                    {prevConfig ? 'No differences found.' : 'Paste a previous config on the right to see the diff.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>&#8592; Back</Button>
        <Button onClick={nextStep}>Next: ZTP &#8594;</Button>
      </div>
    </div>
  )
}
