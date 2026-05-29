import { useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table'
import { useAppStore } from '@/store/useAppStore'
import { buildBOM, buildCabling, buildOptics } from '@/lib/bom'
import type { BOMSummaryRow } from '@/lib/bom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn, formatUSD, downloadCSV } from '@/lib/utils'
import { TopologyDiagram } from '@/components/TopologyDiagram'
import type { CableLink, OpticsEntry } from '@/types'

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

const CABLE_COLORS: Record<string, string> = {
  DAC:    'bg-blue-900/50 text-blue-300',
  AOC:    'bg-purple-900/50 text-purple-300',
  MPO:    'bg-orange-900/50 text-orange-300',
  'LC-LC':'bg-green-900/50 text-green-300',
}

type Tab = 'devices' | 'cabling' | 'optics' | 'topology'

export function Step2Design() {
  const { useCase, scale, siteCode, linkDistances, devices, setDevices,
          totalEndpoints, bandwidthPerServer, oversubscription,
          nextStep, prevStep } = useAppStore()
  const [activeTab, setActiveTab] = useState<Tab>('devices')

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription }),
    [useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription]
  )

  useMemo(() => { setDevices(generatedDevices) }, [generatedDevices, setDevices])

  const cabling = useMemo(() => buildCabling(generatedDevices, linkDistances), [generatedDevices, linkDistances])
  const optics  = useMemo(() => buildOptics(generatedDevices, linkDistances),  [generatedDevices, linkDistances])

  const rows = Object.values(summary)

  const [vendorFilter, setVendorFilter] = useState<string>('All')

  const vendors = useMemo(() => {
    const vs = Array.from(new Set(Object.values(summary).map(r => r.vendor)))
    return ['All', ...vs.sort()]
  }, [summary])

  const tableData = useMemo(() => {
    const allRows = Object.entries(summary).map(([model, row]) => ({ ...row, model }))
    if (vendorFilter === 'All') return allRows
    return allRows.filter(r => r.vendor === vendorFilter)
  }, [summary, vendorFilter])

  const table = useReactTable({
    data: tableData as (BOMSummaryRow & { model: string })[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const cablingTotal = cabling.reduce((s, c) => s + c.totalPrice, 0)
  const opticsTotal  = optics.reduce((s, o)  => s + o.totalPrice,  0)

  function exportBOM() {
    const header = ['Vendor','Model','Layer','Speed','Qty','Unit $','Total $']
    downloadCSV('bom.csv', [header.join(','), ...rows.map(r =>
      [r.vendor, r.model, r.subLayer, r.speed, r.qty, r.unitCost, r.totalCost].join(',')
    )].join('\n'))
  }

  function exportCabling() {
    const header = ['From Layer','To Layer','Cable','Speed','Length (m)','Qty','Unit $','Total $']
    downloadCSV('cabling.csv', [header.join(','), ...(cabling as CableLink[]).map(c =>
      [c.fromLayer, c.toLayer, c.cableType, c.speed, c.lengthM, c.quantity, c.pricePerUnit, c.totalPrice].join(',')
    )].join('\n'))
  }

  function exportOptics() {
    const header = ['Link Group','Form Factor','Speed','Reach','Part #','Qty','Unit $','Total $']
    downloadCSV('optics.csv', [header.join(','), ...(optics as OpticsEntry[]).map(o =>
      [o.linkGroup, o.formFactor, o.speed, o.reach, o.partNumber, o.quantity, o.priceUSD, o.totalPrice].join(',')
    )].join('\n'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Bill of Materials &amp; Cabling</h2>
          <p className="text-sm text-gray-400">
            {devices.length} devices · <span className="text-green-400 font-semibold">{formatUSD(grandTotal)}</span> hardware
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={exportBOM}>↓ BOM CSV</Button>
          <Button variant="secondary" size="sm" onClick={exportCabling}>↓ Cabling CSV</Button>
          <Button variant="secondary" size="sm" onClick={exportOptics}>↓ Optics CSV</Button>
        </div>
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

      {/* Sub-tabs */}
      <div className="flex gap-1 flex-wrap">
        {([
          { id: 'devices',  label: 'Devices & BOM' },
          { id: 'cabling',  label: 'Cabling Schedule' },
          { id: 'optics',   label: 'Optics' },
          { id: 'topology', label: 'HLD Topology' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm rounded-lg border transition-colors',
              activeTab === tab.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/30',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Devices & BOM */}
      {activeTab === 'devices' && (
        <>
        {/* Vendor filter tabs */}
        <div className="flex gap-1 flex-wrap mb-4">
          {vendors.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setVendorFilter(v)}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer',
                vendorFilter === v
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id} className="border-b border-white/10 bg-white/5">
                  {hg.headers.map(h => (
                    <th key={h.id} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, i) => (
                <tr key={row.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
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
                <td colSpan={6} className="px-4 py-3 text-sm text-gray-400 font-medium">Grand Total (hardware)</td>
                <td className="px-4 py-3 font-bold text-green-400 text-base">{formatUSD(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {/* Cabling Schedule */}
      {activeTab === 'cabling' && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          {cabling.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No cabling data — generate a BOM first.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {['From Layer','To Layer','Cable','Speed','Length','Qty','Unit $','Total $'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(cabling as CableLink[]).map((c, i) => (
                  <tr key={c.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                    <td className="px-4 py-3"><code className="text-xs text-blue-400">{c.fromLayer}</code></td>
                    <td className="px-4 py-3"><code className="text-xs text-blue-400">{c.toLayer}</code></td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded text-xs font-bold uppercase', CABLE_COLORS[c.cableType] ?? 'bg-gray-700 text-gray-300')}>
                        {c.cableType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{c.speed}</td>
                    <td className="px-4 py-3 text-gray-300">{c.lengthM}m</td>
                    <td className="px-4 py-3 font-semibold text-gray-200">{c.quantity}</td>
                    <td className="px-4 py-3 text-gray-400">{formatUSD(c.pricePerUnit)}</td>
                    <td className="px-4 py-3 font-semibold text-green-400">{formatUSD(c.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-white/5 border-t border-white/10">
                  <td colSpan={7} className="px-4 py-3 text-sm text-gray-400 font-medium">Total Cabling</td>
                  <td className="px-4 py-3 font-bold text-green-400 text-base">{formatUSD(cablingTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Optics */}
      {activeTab === 'optics' && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          {optics.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No optics data — generate a BOM first.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {['Link Group','Form Factor','Speed','Reach','Part #','Qty','Unit $','Total $'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(optics as OpticsEntry[]).map((o, i) => (
                  <tr key={o.id} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                    <td className="px-4 py-3 text-gray-300 text-xs">{o.linkGroup}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-900/50 text-indigo-300">{o.formFactor}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{o.speed}</td>
                    <td className="px-4 py-3 text-gray-400">{o.reach}</td>
                    <td className="px-4 py-3"><code className="text-xs text-gray-400">{o.partNumber}</code></td>
                    <td className="px-4 py-3 font-semibold text-gray-200">{o.quantity}</td>
                    <td className="px-4 py-3 text-gray-400">{formatUSD(o.priceUSD)}</td>
                    <td className="px-4 py-3 font-semibold text-green-400">{formatUSD(o.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-white/5 border-t border-white/10">
                  <td colSpan={7} className="px-4 py-3 text-sm text-gray-400 font-medium">Total Optics</td>
                  <td className="px-4 py-3 font-bold text-green-400 text-base">{formatUSD(opticsTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* HLD Topology */}
      {activeTab === 'topology' && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <TopologyDiagram devices={generatedDevices} />
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>← Back</Button>
        <Button onClick={nextStep} disabled={devices.length === 0}>Next: Config →</Button>
      </div>
    </div>
  )
}
