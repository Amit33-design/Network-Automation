import { useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table'
import { useAppStore } from '@/store/useAppStore'
import { buildBOM } from '@/lib/bom'
import type { BOMSummaryRow } from '@/lib/bom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { formatUSD, downloadCSV } from '@/lib/utils'

const helper = createColumnHelper<BOMSummaryRow & { model: string }>()

const columns = [
  helper.accessor('vendor', { header: 'Vendor', cell: i => <span className="text-gray-300">{i.getValue()}</span> }),
  helper.accessor('model', {
    header: 'Model',
    cell: i => (
      <div>
        <div className="font-medium text-gray-100">{i.getValue()}</div>
        <div className="text-xs text-gray-500">{i.row.original.detail}</div>
      </div>
    ),
  }),
  helper.accessor('subLayer', { header: 'Layer', cell: i => <code className="text-xs text-blue-400">{i.getValue()}</code> }),
  helper.accessor('speed', { header: 'Speed' }),
  helper.accessor('qty', { header: 'Qty', cell: i => <span className="font-semibold text-gray-200">{i.getValue()}</span> }),
  helper.accessor('unitCost', { header: 'Unit $', cell: i => formatUSD(i.getValue()) }),
  helper.accessor('totalCost', {
    header: 'Total $',
    cell: i => <span className="font-semibold text-green-400">{formatUSD(i.getValue())}</span>,
  }),
]

export function Step2Design() {
  const { useCase, scale, siteCode, devices, setDevices, nextStep, prevStep } = useAppStore()

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode }),
    [useCase, scale, siteCode]
  )

  // Sync computed devices into store once
  useMemo(() => {
    setDevices(generatedDevices)
  }, [generatedDevices, setDevices])

  const rows = Object.values(summary)

  const table = useReactTable({
    data: rows as (BOMSummaryRow & { model: string })[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function exportCSV() {
    const header = ['Vendor', 'Model', 'Layer', 'Speed', 'Qty', 'Unit $', 'Total $']
    const dataRows = rows.map(r =>
      [r.vendor, r.model, r.subLayer, r.speed, r.qty, r.unitCost, r.totalCost].join(',')
    )
    downloadCSV('bom.csv', [header.join(','), ...dataRows].join('\n'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Bill of Materials</h2>
          <p className="text-sm text-gray-400">
            {devices.length} devices · Grand total: <span className="text-green-400 font-semibold">{formatUSD(grandTotal)}</span>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={exportCSV}>
          ↓ Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="text-center">
          <div className="text-2xl font-bold text-blue-400">{devices.length}</div>
          <div className="text-xs text-gray-400 mt-1">Total Devices</div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-bold text-purple-400">{rows.length}</div>
          <div className="text-xs text-gray-400 mt-1">Unique Models</div>
        </Card>
        <Card className="text-center">
          <div className="text-2xl font-bold text-green-400">{formatUSD(grandTotal)}</div>
          <div className="text-xs text-gray-400 mt-1">Grand Total</div>
        </Card>
      </div>

      {/* BOM table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                className={`border-b border-white/5 transition-colors hover:bg-white/5 ${
                  i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'
                }`}
              >
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3 text-gray-300">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-white/5 border-t border-white/10">
              <td colSpan={6} className="px-4 py-3 text-sm text-gray-400 font-medium">
                Grand Total (hardware)
              </td>
              <td className="px-4 py-3 font-bold text-green-400 text-base">
                {formatUSD(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep} disabled={devices.length === 0}>Next: Config →</Button>
      </div>
    </div>
  )
}
