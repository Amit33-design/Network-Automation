import { useEffect, useCallback } from 'react'
import type { BOMDevice } from '@/types'

interface ExportModalProps {
  open: boolean
  onClose: () => void
  devices: BOMDevice[]
  configs: Record<string, string>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportLldCsv(devices: BOMDevice[]) {
  const header = 'Hostname,Role,Layer,Model,Vendor,Count,Ports,Speed,Unit Price (USD),Total Price (USD),Features'
  const rows = devices.map(d =>
    [
      d.hostname,
      d.role,
      d.subLayer,
      d.model,
      d.vendor,
      d.count,
      d.ports,
      d.speed,
      d.unitPrice,
      d.totalPrice,
      `"${d.features.join('; ')}"`,
    ].join(',')
  )

  // BOM summary rows
  const totalCost = devices.reduce((sum, d) => sum + d.totalPrice, 0)
  const summaryRows = [
    '',
    'SUMMARY',
    `Total devices,${devices.reduce((s, d) => s + d.count, 0)}`,
    `Total BOM cost (USD),${totalCost.toLocaleString()}`,
  ]

  downloadFile(
    `netdesign-lld-${new Date().toISOString().slice(0, 10)}.csv`,
    [header, ...rows, ...summaryRows].join('\n'),
    'text/csv',
  )
}

function exportConfigsZip(configs: Record<string, string>) {
  if (Object.keys(configs).length === 0) {
    alert('No configs generated yet. Complete Step 5 first.')
    return
  }
  const bundle = Object.entries(configs)
    .map(([hostname, cfg]) => `! ===== DEVICE: ${hostname} =====\n${cfg}\n`)
    .join('\n')
  downloadFile(
    `netdesign-configs-${new Date().toISOString().slice(0, 10)}.txt`,
    bundle,
  )
}

function exportHtmlReport(devices: BOMDevice[], configs: Record<string, string>) {
  const now = new Date().toLocaleString()
  const totalCost = devices.reduce((s, d) => s + d.totalPrice, 0)

  const bomRows = devices
    .map(
      d => `<tr>
        <td>${d.hostname}</td><td>${d.role}</td><td>${d.subLayer}</td>
        <td>${d.model}</td><td>${d.vendor}</td><td>${d.count}</td>
        <td>$${d.unitPrice.toLocaleString()}</td><td>$${d.totalPrice.toLocaleString()}</td>
      </tr>`,
    )
    .join('')

  const configBlocks = Object.entries(configs)
    .map(
      ([host, cfg]) => `<h3>${host}</h3><pre class="config">${escapeHtml(cfg)}</pre>`,
    )
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NetDesign AI — Design Report (${now})</title>
<style>
  body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:2rem}
  h1{color:#60a5fa}h2{color:#94a3b8;margin-top:2rem}h3{color:#a5b4fc;margin-top:1.5rem}
  table{border-collapse:collapse;width:100%;margin-top:1rem}
  th,td{border:1px solid #334155;padding:.5rem .75rem;font-size:.875rem;text-align:left}
  th{background:#1e293b;color:#94a3b8}tr:nth-child(even){background:#1e293b33}
  .config{background:#1e293b;padding:1rem;border-radius:.5rem;font-size:.75rem;overflow-x:auto;white-space:pre;color:#86efac;border:1px solid #334155}
  .summary{display:flex;gap:2rem;margin-top:1rem}
  .stat{background:#1e293b;padding:.75rem 1.25rem;border-radius:.5rem;border:1px solid #334155}
  .stat-label{font-size:.75rem;color:#64748b}
  .stat-value{font-size:1.25rem;font-weight:700;color:#60a5fa}
  footer{margin-top:3rem;border-top:1px solid #334155;padding-top:1rem;color:#64748b;font-size:.75rem}
</style>
</head>
<body>
<h1>NetDesign AI — Design Report</h1>
<p style="color:#64748b">Generated: ${now}</p>

<h2>Design Summary</h2>
<div class="summary">
  <div class="stat"><div class="stat-label">Total Devices</div><div class="stat-value">${devices.reduce((s, d) => s + d.count, 0)}</div></div>
  <div class="stat"><div class="stat-label">Device Types</div><div class="stat-value">${devices.length}</div></div>
  <div class="stat"><div class="stat-label">BOM Cost</div><div class="stat-value">$${totalCost.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Configs Generated</div><div class="stat-value">${Object.keys(configs).length}</div></div>
</div>

<h2>Bill of Materials</h2>
${devices.length > 0
  ? `<table><thead><tr><th>Hostname</th><th>Role</th><th>Layer</th><th>Model</th><th>Vendor</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${bomRows}</tbody></table>`
  : '<p style="color:#64748b">No devices in BOM yet.</p>'
}

<h2>Device Configurations</h2>
${Object.keys(configs).length > 0 ? configBlocks : '<p style="color:#64748b">No configs generated yet.</p>'}

<footer>NetDesign AI &mdash; netdesignai.com &mdash; Report generated ${now}</footer>
</body>
</html>`

  downloadFile(
    `netdesign-report-${new Date().toISOString().slice(0, 10)}.html`,
    html,
    'text/html',
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ExportModal({ open, onClose, devices, configs }: ExportModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

  const options: Array<{
    id: string
    icon: string
    label: string
    description: string
    onClick: () => void
  }> = [
    {
      id: 'lld-csv',
      icon: '📊',
      label: 'LLD CSV',
      description: 'IP plan, VLAN, BGP & device list as a spreadsheet-ready CSV file.',
      onClick: () => exportLldCsv(devices),
    },
    {
      id: 'configs-txt',
      icon: '📄',
      label: 'All Configs as Bundle',
      description: 'All device configs concatenated in a single .txt file, delimited by device name.',
      onClick: () => exportConfigsZip(configs),
    },
    {
      id: 'html-report',
      icon: '🌐',
      label: 'HTML Report',
      description: 'Self-contained HTML page with design summary, BOM table, and all device configs.',
      onClick: () => exportHtmlReport(devices, configs),
    },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-label="Export Design"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-gray-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Export Design</h2>
            <p className="text-xs text-gray-400 mt-0.5">Download your network design in multiple formats</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 transition-colors cursor-pointer text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-3">
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => { opt.onClick(); onClose() }}
              className="flex items-start gap-4 w-full text-left px-4 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all cursor-pointer group"
            >
              <span className="text-2xl mt-0.5 shrink-0">{opt.icon}</span>
              <div>
                <div className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">
                  {opt.label}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 leading-snug">{opt.description}</div>
              </div>
              <span className="ml-auto text-gray-600 group-hover:text-blue-400 transition-colors text-sm self-center">↓</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 text-xs text-gray-600">
          Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
