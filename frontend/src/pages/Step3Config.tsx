import { useState, useEffect, useRef, useMemo } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAppStore } from '@/store/useAppStore'
import { generateAllConfigs } from '@/lib/configgen'
import { Button } from '@/components/ui/Button'
import { downloadText } from '@/lib/utils'

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
  const { devices, configs, setConfigs, useCase, nextStep, prevStep } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>('All')
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Generate configs once
  useEffect(() => {
    if (devices.length && Object.keys(configs).length === 0) {
      setConfigs(generateAllConfigs(devices, useCase))
    }
  }, [devices, configs, setConfigs])

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

          {/* Section nav chips (M-33) — only shown when sections exist */}
          {sections.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1">
              {sections.map(sec => (
                <button
                  key={`${sec.label}-${sec.lineIndex}`}
                  onClick={() => scrollToSection(sec.lineIndex)}
                  className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-white/5 border border-white/10
                             text-gray-400 hover:bg-blue-600/20 hover:text-blue-300 hover:border-blue-500/30
                             transition-colors"
                >
                  {sec.label}
                </button>
              ))}
            </div>
          )}

          <div
            ref={editorRef}
            className="flex-1 rounded-xl overflow-hidden border border-white/10 text-sm"
            style={{ minHeight: 460 }}
          />
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>&#8592; Back</Button>
        <Button onClick={nextStep}>Next: ZTP &#8594;</Button>
      </div>
    </div>
  )
}
