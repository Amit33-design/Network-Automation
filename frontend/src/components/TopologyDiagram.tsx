import type { BOMDevice } from '@/types'

interface Props {
  devices: BOMDevice[]
}

const LAYER_ORDER = ['wan-edge','cloud-transit','core','spine','firewall','distribution','cloud-gw','leaf','access']

const LAYER_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  spine:           { fill: '#1e3a5f', stroke: '#3b82f6', text: '#93c5fd' },
  leaf:            { fill: '#14532d', stroke: '#22c55e', text: '#86efac' },
  distribution:    { fill: '#1e3a5f', stroke: '#3b82f6', text: '#93c5fd' },
  core:            { fill: '#3b0764', stroke: '#a855f7', text: '#d8b4fe' },
  access:          { fill: '#052e16', stroke: '#16a34a', text: '#4ade80' },
  'wan-edge':      { fill: '#1c1917', stroke: '#78716c', text: '#d6d3d1' },
  firewall:        { fill: '#7f1d1d', stroke: '#ef4444', text: '#fca5a5' },
  'cloud-transit': { fill: '#1e3a5f', stroke: '#0ea5e9', text: '#7dd3fc' },
  'cloud-gw':      { fill: '#14532d', stroke: '#10b981', text: '#6ee7b7' },
}

const DEFAULT_COLORS = { fill: '#1e2030', stroke: '#4b5563', text: '#9ca3af' }

const LAYER_ICONS: Record<string, string> = {
  spine: '⬡', leaf: '⬡', distribution: '⬡', core: '⬡', access: '⬡',
  'wan-edge': '⟳', firewall: '🛡', 'cloud-transit': '☁', 'cloud-gw': '☁',
}

const CONNECTS: Array<[string, string]> = [
  ['wan-edge', 'core'], ['wan-edge', 'spine'], ['wan-edge', 'distribution'],
  ['core', 'distribution'], ['core', 'spine'], ['spine', 'leaf'],
  ['spine', 'firewall'], ['distribution', 'access'], ['distribution', 'firewall'],
  ['cloud-transit', 'cloud-gw'],
]

export function TopologyDiagram({ devices }: Props) {
  if (!devices.length) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-500 border border-white/10 rounded-xl">
        Generate a BOM first to see the topology diagram.
      </div>
    )
  }

  const byLayer = devices.reduce<Record<string, BOMDevice[]>>((acc, d) => {
    acc[d.subLayer] = [...(acc[d.subLayer] ?? []), d]
    return acc
  }, {})

  const rows = LAYER_ORDER
    .filter(l => byLayer[l]?.length)
    .map((layer, row) => ({ layer, devices: byLayer[layer], row }))

  if (!rows.length) return null

  const NODE_W = 100, NODE_H = 48, GAP_X = 24, GAP_Y = 72, PAD = 40
  const maxCols = Math.max(...rows.map(r => r.devices.length))
  const svgW = Math.max(600, maxCols * (NODE_W + GAP_X) + PAD * 2)
  const svgH = rows.length * (NODE_H + GAP_Y) + PAD * 2

  const layerRowMap = new Map(rows.map((r, i) => [r.layer, i]))

  function nodeX(devCount: number, colIdx: number) {
    const totalW = devCount * NODE_W + (devCount - 1) * GAP_X
    return (svgW - totalW) / 2 + colIdx * (NODE_W + GAP_X)
  }
  function nodeY(rowIdx: number) { return PAD + rowIdx * (NODE_H + GAP_Y) }
  function cx(devCount: number, colIdx: number) { return nodeX(devCount, colIdx) + NODE_W / 2 }
  function cy(rowIdx: number) { return nodeY(rowIdx) + NODE_H / 2 }

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = []
  for (const [fl, tl] of CONNECTS) {
    const fr = rows.find(r => r.layer === fl)
    const tr = rows.find(r => r.layer === tl)
    if (!fr || !tr) continue
    const fri = layerRowMap.get(fl)!
    const tri = layerRowMap.get(tl)!
    for (let fi = 0; fi < fr.devices.length; fi++)
      for (let ti = 0; ti < tr.devices.length; ti++)
        lines.push({ x1: cx(fr.devices.length, fi), y1: cy(fri), x2: cx(tr.devices.length, ti), y2: cy(tri), key: `${fl}-${fi}-${tl}-${ti}` })
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${svgW} ${svgH}`} width={svgW} height={svgH} className="max-w-full" style={{ fontFamily: 'monospace' }}>
        {lines.map(l => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#334155" strokeWidth={1.5} strokeDasharray="4 3" />
        ))}
        {rows.map((row, rowIdx) => {
          const colors = LAYER_COLORS[row.layer] ?? DEFAULT_COLORS
          const icon = LAYER_ICONS[row.layer] ?? '⬡'
          return row.devices.map((dev, colIdx) => {
            const x = nodeX(row.devices.length, colIdx)
            const y = nodeY(rowIdx)
            return (
              <g key={dev.id}>
                <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={8} fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} />
                <text x={x + NODE_W / 2} y={y + 16} textAnchor="middle" fill={colors.stroke} fontSize={14}>{icon}</text>
                <text x={x + NODE_W / 2} y={y + 30} textAnchor="middle" fill={colors.text} fontSize={9} fontWeight="bold">
                  {(dev.hostname || dev.id).slice(0, 14)}
                </text>
                <text x={x + NODE_W / 2} y={y + 41} textAnchor="middle" fill="#6b7280" fontSize={8}>
                  {dev.model.slice(0, 14)}
                </text>
              </g>
            )
          })
        })}
        {rows.map((row, rowIdx) => (
          <text key={row.layer} x={8} y={nodeY(rowIdx) + NODE_H / 2 + 4} fill="#6b7280" fontSize={9}>
            {row.layer.toUpperCase().replace(/-/g, ' ')}
          </text>
        ))}
      </svg>
    </div>
  )
}
