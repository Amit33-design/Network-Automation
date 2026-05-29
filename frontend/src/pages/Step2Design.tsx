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
import { HLDTopologyDiagram } from '@/components/HLDTopologyDiagram'
import type { CableLink, OpticsEntry } from '@/types'

// ── M-15: AI Product Scoring ─────────────────────────────────────────────────

interface ScoreFactors {
  protocolFit: number    // 0-25: IS-IS/OSPF/BGP support vs intent
  complianceFit: number  // 0-20: PCI/HIPAA features
  useCaseFit: number     // 0-25: use-case alignment
  portDensity: number    // 0-15: ports per dollar
  priceTier: number      // 0-15: value tier
}

function computeScore(
  row: BOMSummaryRow & { model: string },
  useCase: string,
  underlayProtocol: string,
  compliance: string[],
): { total: number; factors: ScoreFactors } {
  const features = row.features ?? []

  // Protocol fit (0-25)
  let protocolFit = 0
  if (underlayProtocol === 'isis' && features.includes('BGP') && features.some(f => f === 'VXLAN')) protocolFit = 25
  else if (underlayProtocol === 'ospf' && features.includes('BGP')) protocolFit = 22
  else if (underlayProtocol === 'ebgp' && features.includes('BGP')) protocolFit = 25
  else if (underlayProtocol === 'static') protocolFit = 15
  else if (features.includes('BGP')) protocolFit = 18
  else protocolFit = 10

  // Compliance fit (0-20)
  let complianceFit = 14 // baseline
  if (compliance.includes('PCI') && features.some(f => ['IPS','TLS-decrypt','AMP'].includes(f))) complianceFit = 20
  else if (compliance.includes('HIPAA') && features.some(f => ['IPS','TLS-decrypt'].includes(f))) complianceFit = 20
  else if (compliance.length === 0) complianceFit = 16
  else if (features.includes('MACsec') || features.includes('IPS')) complianceFit = 18

  // Use-case fit (0-25)
  const ucMap: Record<string, Record<string, number>> = {
    dc:         { spine: 25, leaf: 25, firewall: 20 },
    gpu:        { spine: 25, leaf: 25 },
    campus:     { distribution: 25, access: 25, firewall: 22 },
    wan:        { 'wan-edge': 25 },
    multisite:  { spine: 22, leaf: 22, 'wan-edge': 25, firewall: 20 },
    multicloud: { 'cloud-transit': 25, 'cloud-gw': 25 },
    aviatrix:   { 'cloud-transit': 25, 'cloud-gw': 25 },
  }
  const useCaseFit = ucMap[useCase]?.[row.subLayer] ?? 14

  // Port density score (0-15) — ports relative to price bracket
  const portsPerKdollar = row.ports / (row.unitCost / 1000)
  const portDensity =
    portsPerKdollar >= 3 ? 15 :
    portsPerKdollar >= 1.5 ? 12 :
    portsPerKdollar >= 0.5 ? 9 :
    6

  // Price tier score (0-15) — mid-tier products score higher
  const priceTier =
    row.unitCost <= 5000   ? 13 :
    row.unitCost <= 20000  ? 15 :
    row.unitCost <= 50000  ? 13 :
    row.unitCost <= 100000 ? 10 :
    8

  const total = Math.min(100, protocolFit + complianceFit + useCaseFit + portDensity + priceTier)
  return { total, factors: { protocolFit, complianceFit, useCaseFit, portDensity, priceTier } }
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80 ? 'bg-green-900/60 text-green-300 border-green-700' :
    score >= 60 ? 'bg-yellow-900/60 text-yellow-300 border-yellow-700' :
                  'bg-red-900/60 text-red-300 border-red-700'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border', cls)}>
      {score}
    </span>
  )
}

// ── M-16: EOL Table ───────────────────────────────────────────────────────────

interface EOLEntry {
  modelFragment: string  // substring match
  eolDate: string        // ISO date YYYY-MM-DD
  replacement: string
}

const EOL_TABLE: EOLEntry[] = [
  { modelFragment: 'Nexus 9300-EX',     eolDate: '2027-06-01', replacement: 'Nexus 9300-FX3 / 9300-GX2' },
  { modelFragment: 'Arista 7050X2',     eolDate: '2026-12-01', replacement: 'Arista 7050X4 / 7060X5'    },
  { modelFragment: 'EX4300',            eolDate: '2025-09-01', replacement: 'Juniper EX4400'             },
  { modelFragment: 'ASR 1002-HX',       eolDate: '2027-03-01', replacement: 'ASR 1001-HX / Catalyst 8200' },
  { modelFragment: 'Catalyst 9200-48P', eolDate: '2028-01-01', replacement: 'Catalyst 9200L / 9300L'    },
]

function getEolStatus(eolDateStr: string): 'critical' | 'warning' | null {
  const eolDate = new Date(eolDateStr)
  const now = new Date()
  const twelveMonths = new Date(now)
  twelveMonths.setMonth(twelveMonths.getMonth() + 12)

  if (eolDate <= now) return 'critical'
  if (eolDate <= twelveMonths) return 'warning'
  return null
}

interface EOLHit {
  model: string
  eolDate: string
  replacement: string
  status: 'critical' | 'warning'
}

function findEOLHits(rows: (BOMSummaryRow & { model: string })[]): EOLHit[] {
  const hits: EOLHit[] = []
  for (const row of rows) {
    for (const entry of EOL_TABLE) {
      if (row.model.toLowerCase().includes(entry.modelFragment.toLowerCase())) {
        const status = getEolStatus(entry.eolDate)
        if (status) {
          hits.push({ model: row.model, eolDate: entry.eolDate, replacement: entry.replacement, status })
        }
      }
    }
  }
  return hits
}

// ── M-19: IP Plan ─────────────────────────────────────────────────────────────

interface IPBlock {
  purpose: string
  subnet: string
  numAddresses: number
  assignedTo: string
}

/**
 * Derive a deterministic base octet (10.X.0.0/8) from the siteCode string.
 * Uses a simple char-code hash so different sites get distinct /16 blocks.
 */
function siteToOctet(siteCode: string): number {
  if (!siteCode) return 10
  let h = 0
  for (let i = 0; i < siteCode.length; i++) h = (h * 31 + siteCode.charCodeAt(i)) & 0xff
  return Math.max(1, Math.min(254, h))
}

function buildIPPlan(
  rows: (BOMSummaryRow & { model: string })[],
  siteCode: string,
  useCase: string,
): IPBlock[] {
  const b = siteToOctet(siteCode)
  const blocks: IPBlock[] = []

  // Management /24
  blocks.push({
    purpose: 'Management (OOB)',
    subnet: `10.${b}.0.0/24`,
    numAddresses: 254,
    assignedTo: 'All devices — mgmt VRF',
  })

  // OOB /24
  blocks.push({
    purpose: 'Out-of-Band (OOBM)',
    subnet: `10.${b}.1.0/24`,
    numAddresses: 254,
    assignedTo: 'Console servers, PDUs, BMC',
  })

  // Loopbacks /32 per device
  const totalDevices = rows.reduce((s, r) => s + r.qty, 0)
  blocks.push({
    purpose: 'Loopback /32 (per device)',
    subnet: `10.${b}.255.0/24`,
    numAddresses: totalDevices,
    assignedTo: `${totalDevices} devices — router-id / BGP VTEP`,
  })

  // P2P Links /31
  const spineCount = rows.filter(r => r.subLayer === 'spine').reduce((s, r) => s + r.qty, 0)
  const leafCount  = rows.filter(r => r.subLayer === 'leaf' || r.subLayer === 'distribution').reduce((s, r) => s + r.qty, 0)
  const pairCount  = Math.max(spineCount * leafCount, 2)
  blocks.push({
    purpose: 'P2P Fabric Links /31',
    subnet: `10.${b}.254.0/24`,
    numAddresses: pairCount * 2,
    assignedTo: `${pairCount} link pairs (spine↔leaf / dist↔access)`,
  })

  // VXLAN VTEP /32 per leaf (DC/GPU only)
  if (useCase === 'dc' || useCase === 'gpu') {
    const vtepCount = rows.filter(r => r.subLayer === 'leaf').reduce((s, r) => s + r.qty, 0)
    blocks.push({
      purpose: 'VXLAN VTEP Loopbacks /32',
      subnet: `10.${b}.253.0/24`,
      numAddresses: vtepCount,
      assignedTo: `${vtepCount} leaf switches — NVE source-interface`,
    })
  }

  // Overlay / tenant /16
  blocks.push({
    purpose: 'Overlay / Tenant Space',
    subnet: `172.${(b % 14) + 16}.0.0/16`,
    numAddresses: 65534,
    assignedTo: 'VRF tenant workloads',
  })

  return blocks
}

// ── Column helper ─────────────────────────────────────────────────────────────

const helper = createColumnHelper<BOMSummaryRow & { model: string; _score?: number }>()

// ── Tab type ─────────────────────────────────────────────────────────────────

const CABLE_COLORS: Record<string, string> = {
  DAC:    'bg-blue-900/50 text-blue-300',
  AOC:    'bg-purple-900/50 text-purple-300',
  MPO:    'bg-orange-900/50 text-orange-300',
  'LC-LC':'bg-green-900/50 text-green-300',
}

type Tab = 'devices' | 'cabling' | 'optics' | 'topology' | 'ipplan' | 'rack' | 'capacity'

// ── Component ────────────────────────────────────────────────────────────────

export function Step2Design() {
  const { useCase, scale, siteCode, linkDistances, devices, setDevices,
          totalEndpoints, bandwidthPerServer, oversubscription,
          underlayProtocol, compliance, vendorPrefs,
          nextStep, prevStep } = useAppStore()
  const [activeTab, setActiveTab] = useState<Tab>('devices')

  const { summary, grandTotal, devices: generatedDevices } = useMemo(
    () => buildBOM({ useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription, vendorPrefs }),
    [useCase, scale, siteCode, totalEndpoints, bandwidthPerServer, oversubscription, vendorPrefs]
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

  // M-15: compute scores for all rows
  const scoreMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const [model, row] of Object.entries(summary)) {
      map[model] = computeScore(
        { ...row, model },
        useCase,
        underlayProtocol,
        compliance,
      ).total
    }
    return map
  }, [summary, useCase, underlayProtocol, compliance])

  // M-16: EOL hits
  const allRows = useMemo(
    () => Object.entries(summary).map(([model, row]) => ({ ...row, model })),
    [summary]
  )
  const eolHits = useMemo(() => findEOLHits(allRows), [allRows])

  // M-19: IP plan
  const ipBlocks = useMemo(
    () => buildIPPlan(allRows, siteCode, useCase),
    [allRows, siteCode, useCase]
  )

  // M-15: top recommendations (top 3 scoring, across all rows)
  const recommendations = useMemo(() => {
    return [...allRows]
      .map(r => ({ ...r, score: scoreMap[r.model] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(5, allRows.length))
  }, [allRows, scoreMap])

  const tableData = useMemo(() => {
    const base = allRows.map(r => ({ ...r, _score: scoreMap[r.model] ?? 0 }))
    if (vendorFilter === 'All') return base
    return base.filter(r => r.vendor === vendorFilter)
  }, [allRows, vendorFilter, scoreMap])

  const columns = useMemo(() => [
    helper.accessor('vendor',   { header: 'Vendor',  cell: i => <span className="text-gray-300">{i.getValue()}</span> }),
    helper.accessor('model',    {
      header: 'Model',
      cell: i => (
        <div>
          <div className="font-medium text-gray-100">{i.getValue()}</div>
          <div className="text-xs text-gray-500">{i.row.original.detail}</div>
        </div>
      ),
    }),
    helper.accessor('subLayer', { header: 'Layer',   cell: i => <code className="text-xs text-blue-400">{i.getValue()}</code> }),
    helper.accessor('speed',    { header: 'Speed' }),
    helper.accessor('qty',      { header: 'Qty',     cell: i => <span className="font-semibold text-gray-200">{i.getValue()}</span> }),
    helper.accessor('unitCost', { header: 'Unit $',  cell: i => formatUSD(i.getValue()) }),
    helper.accessor('totalCost',{
      header: 'Total $',
      cell: i => <span className="font-semibold text-green-400">{formatUSD(i.getValue())}</span>,
    }),
    helper.accessor('_score', {
      header: 'AI Score',
      cell: i => <ScoreBadge score={i.getValue() ?? 0} />,
    }),
  ], [])

  const table = useReactTable({
    data: tableData as (BOMSummaryRow & { model: string; _score?: number })[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const cablingTotal = cabling.reduce((s, c) => s + c.totalPrice, 0)
  const opticsTotal  = optics.reduce((s, o)  => s + o.totalPrice,  0)

  function exportBOM() {
    const header = ['Vendor','Model','Layer','Speed','Qty','Unit $','Total $','AI Score']
    downloadCSV('bom.csv', [header.join(','), ...rows.map(r =>
      [r.vendor, r.model, r.subLayer, r.speed, r.qty, r.unitCost, r.totalCost, scoreMap[r.model] ?? 0].join(',')
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
          <Button variant="secondary" size="sm" onClick={exportBOM}>&#8595; BOM CSV</Button>
          <Button variant="secondary" size="sm" onClick={exportCabling}>&#8595; Cabling CSV</Button>
          <Button variant="secondary" size="sm" onClick={exportOptics}>&#8595; Optics CSV</Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="text-center">
          <div className="text-xl sm:text-2xl font-bold text-blue-400">{devices.length}</div>
          <div className="text-xs text-gray-400 mt-1">Total Devices</div>
        </Card>
        <Card className="text-center">
          <div className="text-xl sm:text-2xl font-bold text-purple-400">{rows.length}</div>
          <div className="text-xs text-gray-400 mt-1">Unique Models</div>
        </Card>
        <Card className="col-span-2 sm:col-span-1 text-center">
          <div className="text-xl sm:text-2xl font-bold text-green-400 truncate">{formatUSD(grandTotal)}</div>
          <div className="text-xs text-gray-400 mt-1">Grand Total</div>
        </Card>
      </div>

      {/* M-16: EOL Alert Panel */}
      {eolHits.length > 0 && (
        <div className="space-y-2">
          {eolHits.map(hit => (
            <div
              key={hit.model}
              className={cn(
                'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
                hit.status === 'critical'
                  ? 'border-red-700 bg-red-950/40 text-red-300'
                  : 'border-yellow-700 bg-yellow-950/30 text-yellow-300',
              )}
            >
              <span className="mt-0.5 shrink-0 text-base leading-none">
                {hit.status === 'critical' ? '⛔' : '⚠️'}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold">{hit.status === 'critical' ? 'PAST EOL' : 'EOL Warning'}</span>
                {' — '}
                <span className="font-medium">{hit.model}</span>
                {' reaches End-of-Life on '}
                <span className="font-mono">{hit.eolDate.slice(0, 7)}</span>
                {hit.status === 'critical' && ' (already past)'}
                {'. Recommended replacement: '}
                <span className="font-medium">{hit.replacement}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* M-15: AI Recommendations Panel */}
      {recommendations.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base font-semibold text-gray-100">AI Product Recommendations</span>
            <span className="text-xs text-gray-500 ml-1">— scored for this intent</span>
          </div>
          <div className="flex flex-col gap-2">
            {recommendations.map((rec, idx) => (
              <div key={rec.model} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="text-xs text-gray-500 w-4 shrink-0 text-right">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-100 text-sm truncate">{rec.model}</span>
                    <code className="text-xs text-blue-400">{rec.subLayer}</code>
                    <span className="text-xs text-gray-500">{rec.vendor}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">{rec.detail}</div>
                </div>
                <ScoreBadge score={rec.score} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 flex-wrap">
        {([
          { id: 'devices',  label: 'Devices & BOM' },
          { id: 'cabling',  label: 'Cabling Schedule' },
          { id: 'optics',   label: 'Optics' },
          { id: 'topology', label: 'HLD Topology' },
          { id: 'ipplan',   label: 'IP Plan' },
          { id: 'rack',     label: 'Rack Plan' },
          { id: 'capacity', label: 'Port Capacity' },
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
                <td colSpan={7} className="px-4 py-3 text-sm text-gray-400 font-medium">Grand Total (hardware)</td>
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
          <HLDTopologyDiagram
            devices={generatedDevices}
            useCase={useCase}
            underlayProtocol={underlayProtocol}
            siteCode={siteCode}
          />
        </div>
      )}

      {/* M-19: IP Plan */}
      {activeTab === 'ipplan' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">IP Address Plan</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Auto-derived from site code <code className="text-blue-400">{siteCode || 'SITE'}</code>
                {' — '}base block <code className="text-blue-400">10.{siteToOctet(siteCode)}.0.0/16</code>
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const header = ['Purpose','Subnet','# Addresses','Assigned To']
                downloadCSV('ip-plan.csv', [
                  header.join(','),
                  ...ipBlocks.map(b => [b.purpose, b.subnet, b.numAddresses, `"${b.assignedTo}"`].join(',')),
                ].join('\n'))
              }}
            >
              &#8595; IP Plan CSV
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {['Purpose','Subnet','# Addresses','Assigned To'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ipBlocks.map((block, i) => (
                  <tr key={block.subnet} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                    <td className="px-4 py-3 text-gray-200 font-medium">{block.purpose}</td>
                    <td className="px-4 py-3"><code className="text-blue-400 text-xs">{block.subnet}</code></td>
                    <td className="px-4 py-3 text-gray-300">{block.numAddresses.toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{block.assignedTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(useCase === 'dc' || useCase === 'gpu') && (
            <div className="rounded-lg border border-blue-800/50 bg-blue-950/20 px-4 py-3 text-xs text-blue-300">
              <span className="font-semibold">VXLAN note:</span> VTEP loopbacks are separate from router-id loopbacks (NVE source-interface = Loopback1, BGP router-id = Loopback0). Ensure VTEP /32s are redistributed into the underlay IGP.
            </div>
          )}
        </div>
      )}

      {/* M-17: Rack Plan tab */}
      {activeTab === 'rack' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Rack Plan</h3>
            <p className="text-xs text-gray-500 mt-0.5">42U rack layout — devices ordered by role (firewall → spine → leaf → access → servers)</p>
          </div>
          {(() => {
            const RACK_U = 42
            const roleOrder = ['firewall','wan-edge','border','spine','distribution','leaf','access','server','gpu']
            const sorted = [...allRows].sort((a, b) => {
              const ai = roleOrder.findIndex(r => a.subLayer?.includes(r))
              const bi = roleOrder.findIndex(r => b.subLayer?.includes(r))
              return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
            })
            const usedU = sorted.reduce((sum, r) => sum + r.qty, 0)
            const freeU = Math.max(0, RACK_U - usedU)
            return (
              <div className="font-mono text-xs bg-black/60 border border-white/10 rounded-xl p-4 overflow-x-auto">
                <div className="text-gray-500 mb-2">┌{'─'.repeat(54)}┐</div>
                <div className="text-yellow-400 mb-1">│{'  '}42U Network Rack — {siteCode || 'SITE'}{' '.repeat(Math.max(0, 38 - (siteCode || 'SITE').length))}│</div>
                <div className="text-gray-500 mb-2">├{'─'.repeat(54)}┤</div>
                {sorted.map(r => {
                  const bar = `[== ${r.model} (×${r.qty}) ==]`
                  const pad = Math.max(0, 52 - bar.length)
                  return (
                    <div key={r.model} className="text-green-400">
                      {'│ '}{bar}{' '.repeat(pad)}{' │'}
                    </div>
                  )
                })}
                {freeU > 0 && Array.from({ length: Math.min(freeU, 6) }).map((_, i) => (
                  <div key={`empty-${i}`} className="text-gray-700">│ {'─'.repeat(52)} │</div>
                ))}
                {freeU > 6 && <div className="text-gray-700">│ {'·'.repeat(20)} {freeU - 6}U free {'·'.repeat(20)} │</div>}
                <div className="text-gray-500 mt-2">└{'─'.repeat(54)}┘</div>
                <div className="mt-3 flex gap-6 text-gray-400">
                  <span>Used: <span className="text-yellow-400">{usedU}U</span></span>
                  <span>Free: <span className="text-green-400">{freeU}U</span></span>
                  <span>Capacity: <span className="text-gray-300">42U</span></span>
                  {usedU > RACK_U && <span className="text-red-400">⚠ Overflow — needs {Math.ceil(usedU / RACK_U)} racks</span>}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* M-18: Port Capacity tab */}
      {activeTab === 'capacity' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Port Capacity</h3>
            <p className="text-xs text-gray-500 mt-0.5">Port utilisation per device type based on BOM sizing</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  {['Device Model','Layer','Qty','Total Ports','Uplink Ports','Downlink Ports','Used %','Headroom'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allRows.map((r, i) => {
                  const uplinks  = r.subLayer === 'leaf' ? Math.max(2, Math.ceil(r.ports / (oversubscription || 3))) : 0
                  const downlinks = r.subLayer === 'leaf' ? r.ports - uplinks : r.ports
                  const usedPct  = r.subLayer === 'leaf'
                    ? Math.min(100, Math.round((totalEndpoints / Math.max(1, allRows.filter(x => x.subLayer === 'leaf').reduce((s, x) => s + x.qty * downlinks, 0))) * 100))
                    : r.subLayer === 'spine' ? Math.min(100, Math.round((allRows.filter(x => x.subLayer === 'leaf').length * uplinks / Math.max(1, r.qty * r.ports)) * 100))
                    : 50
                  const bar = '█'.repeat(Math.round(usedPct / 10)) + '░'.repeat(10 - Math.round(usedPct / 10))
                  return (
                    <tr key={r.model} className={`border-b border-white/5 hover:bg-white/5 ${i % 2 ? 'bg-white/[0.02]' : ''}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-100">{r.model}</td>
                      <td className="px-3 py-2.5"><code className="text-xs text-blue-400">{r.subLayer}</code></td>
                      <td className="px-3 py-2.5 text-gray-300">{r.qty}</td>
                      <td className="px-3 py-2.5 text-gray-300">{r.ports}</td>
                      <td className="px-3 py-2.5 text-gray-400">{uplinks || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-300">{r.subLayer === 'leaf' ? downlinks : r.ports}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs ${usedPct >= 80 ? 'text-red-400' : usedPct >= 60 ? 'text-yellow-400' : 'text-green-400'}`}>{bar} {usedPct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{100 - usedPct}% free</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ['Total Downlink Ports', allRows.filter(r => r.subLayer === 'leaf').reduce((s, r) => s + r.qty * (r.ports - Math.max(2, Math.ceil(r.ports / (oversubscription || 3)))), 0).toString()],
              ['Max Endpoint Capacity', allRows.filter(r => r.subLayer === 'leaf').reduce((s, r) => s + r.qty * (r.ports - Math.max(2, Math.ceil(r.ports / (oversubscription || 3)))), 0).toLocaleString()],
              ['Current Load', `${totalEndpoints.toLocaleString()} endpoints`],
            ].map(([label, val]) => (
              <div key={label} className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className="text-sm font-semibold text-gray-200">{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={prevStep}>&#8592; Back</Button>
        <Button onClick={nextStep} disabled={devices.length === 0}>Next: Config &#8594;</Button>
      </div>
    </div>
  )
}
