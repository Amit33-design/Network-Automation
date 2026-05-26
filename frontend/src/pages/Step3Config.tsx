import { useState, useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { useAppStore } from '@/store/useAppStore'
import { generateAllConfigs } from '@/lib/configgen'
import { Button } from '@/components/ui/Button'
import { downloadText } from '@/lib/utils'

export function Step3Config() {
  const { devices, configs, setConfigs, useCase, nextStep, prevStep } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Generate configs once
  useEffect(() => {
    if (devices.length && Object.keys(configs).length === 0) {
      setConfigs(generateAllConfigs(devices, useCase))
    }
  }, [devices, configs, setConfigs])

  useEffect(() => {
    if (devices.length && !selectedId) {
      setSelectedId(devices[0].id)
    }
  }, [devices, selectedId])

  // Mount/update CodeMirror editor
  useEffect(() => {
    if (!editorRef.current) return
    const content = selectedId ? (configs[selectedId] ?? '') : ''

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    viewRef.current = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [oneDark, EditorView.lineWrapping],
      }),
      parent: editorRef.current,
    })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [selectedId, configs])

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
        <Button variant="secondary" size="sm" onClick={downloadAll}>↓ Download All</Button>
      </div>

      <div className="flex gap-4 min-h-[500px]">
        {/* Device list sidebar */}
        <div className="w-56 flex-shrink-0 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2 space-y-1">
          {devices.map(dev => (
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
          ))}
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
                ↓ Download
              </Button>
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
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep}>Next: ZTP →</Button>
      </div>
    </div>
  )
}
