/**
 * drawio-export.ts — editable topology export (draw.io / diagrams.net XML).
 *
 * The frontend could already export the HLD/LLD as SVG, but an SVG is a
 * picture: an engineer who wants to move a box, add an annotation or drop the
 * diagram into a Confluence page has to redraw it. draw.io XML is editable,
 * and it is the format network teams actually keep their diagrams in.
 *
 * NOT a mirror of `backend/export/drawio.py`, deliberately. That generator
 * receives a `DesignState` without the BOM, so it *synthesises* devices from
 * capacity counts — `SPINE-01`, `LEAF-01`, capped at 20 per layer — and has no
 * access to real hostnames, vendors, models or cable quantities. The browser
 * has all of it, so this builds from `BOMDevice[]` + `CableLink[]` the way
 * `containerlab.ts` does. The shapes, colours and layer order match the
 * backend's so both produce a recognisably identical diagram.
 *
 * Cell IDs are derived from the hostname rather than a UUID (the backend uses
 * `uuid4()`), so exporting the same design twice produces the same file and
 * the diagram can be committed and diffed.
 */
import type { BOMDevice, CableLink } from '@/types'

/** role → draw.io shape, matching backend/export/drawio.py. */
const SHAPE: Record<string, string> = {
  spine: 'mxgraph.cisco.routers.router',
  leaf: 'mxgraph.cisco.switches.workgroup_switch',
  core: 'mxgraph.cisco.switches.layer_3_switch',
  distribution: 'mxgraph.cisco.switches.workgroup_switch',
  access: 'mxgraph.cisco.switches.catalyst_702x_702x',
  firewall: 'mxgraph.cisco.firewalls.firewall',
  'wan-edge': 'mxgraph.cisco.routers.router',
  'gpu-compute': 'mxgraph.cisco.servers.standard_server',
  'cloud-gw': 'mxgraph.cisco.storage.cloud',
  'cloud-transit': 'mxgraph.cisco.storage.cloud',
  default: 'mxgraph.cisco.switches.workgroup_switch',
}

const COLOR: Record<string, string> = {
  spine: '#dae8fc',
  leaf: '#d5e8d4',
  core: '#fff2cc',
  distribution: '#ffe6cc',
  access: '#f8cecc',
  firewall: '#e1d5e7',
  'wan-edge': '#ffe6cc',
  'gpu-compute': '#f5f5f5',
  'cloud-gw': '#dae8fc',
  'cloud-transit': '#dae8fc',
  default: '#f5f5f5',
}

/**
 * Vertical order, top to bottom. Anything not listed lands below the known
 * tiers rather than being dropped, so a new subLayer still appears.
 */
const ROW_ORDER = [
  'firewall', 'wan-edge', 'core', 'spine', 'cloud-transit', 'cloud-gw',
  'distribution', 'leaf', 'access', 'oran-cu', 'oran-du', 'oran-fronthaul',
  'oran-ru', 'gpu-compute',
]

const ROW_HEIGHT = 140
const FIRST_ROW_Y = 90
const CANVAS_W = 1100
/** Past this many devices a tier is collapsed to a single summary node. */
const MAX_PER_ROW = 12

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Stable, XML-safe id derived from the hostname — no UUIDs, so exports diff. */
function cellId(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9]/g, '_')
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return `nd_${safe}_${(h >>> 0).toString(36)}`
}

function nodeStyle(role: string): string {
  const shape = SHAPE[role] ?? SHAPE.default
  const color = COLOR[role] ?? COLOR.default
  return `shape=${shape};fillColor=${color};strokeColor=#666666;` +
    'fontStyle=1;fontSize=10;verticalLabelPosition=bottom;verticalAlign=top;'
}

function vertex(id: string, label: string, style: string, x: number, y: number,
                w = 90, h = 60): string {
  return `    <mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1">\n` +
    `      <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>\n` +
    '    </mxCell>\n'
}

function edge(id: string, src: string, tgt: string, label: string): string {
  return `    <mxCell id="${id}" value="${esc(label)}" ` +
    'style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;fontSize=9;" ' +
    `edge="1" source="${src}" target="${tgt}" parent="1">\n` +
    '      <mxGeometry relative="1" as="geometry"/>\n' +
    '    </mxCell>\n'
}

/** Evenly spaced x positions, centred on the canvas. */
function rowX(count: number, i: number): number {
  const gap = Math.min(150, Math.floor((CANVAS_W - 160) / Math.max(1, count)))
  const total = (count - 1) * gap
  return Math.round((CANVAS_W - total) / 2 - 45 + i * gap)
}

interface Placed { id: string; role: string }

/**
 * Build a draw.io XML document for a design.
 *
 * @param devices  the real BOM — hostnames, vendors and models all appear
 * @param cabling  aggregate link rows; each becomes one labelled edge
 * @param title    diagram title, usually the org or site name
 */
export function buildDrawio(
  devices: BOMDevice[],
  cabling: CableLink[] = [],
  title = 'Network Topology',
): string {
  const byRole = new Map<string, BOMDevice[]>()
  for (const d of devices) {
    byRole.set(d.subLayer, [...(byRole.get(d.subLayer) ?? []), d])
  }
  const roles = [...byRole.keys()].sort((a, b) => {
    const ia = ROW_ORDER.indexOf(a), ib = ROW_ORDER.indexOf(b)
    return (ia < 0 ? ROW_ORDER.length : ia) - (ib < 0 ? ROW_ORDER.length : ib)
  })

  let cells = ''
  // One representative cell per tier, used as the endpoint for tier links.
  const anchor = new Map<string, Placed>()

  roles.forEach((role, rowIdx) => {
    const devs = byRole.get(role) ?? []
    const y = FIRST_ROW_Y + rowIdx * ROW_HEIGHT

    if (devs.length > MAX_PER_ROW) {
      // Collapse: 256 GPU servers as 256 boxes is unreadable and unusable.
      const id = cellId(`${role}__group`)
      const model = devs[0].model
      cells += vertex(id, `${devs.length} × ${role}\n${model}`, nodeStyle(role),
                      rowX(1, 0), y, 190, 60)
      anchor.set(role, { id, role })
      return
    }

    devs.forEach((d, i) => {
      const id = cellId(d.hostname || d.id)
      const label = [d.hostname || d.id, d.model].filter(Boolean).join('\n')
      cells += vertex(id, label, nodeStyle(role), rowX(devs.length, i), y)
      if (i === 0) anchor.set(role, { id, role })
    })
  })

  // Links come from the real cable schedule, so the labels carry the actual
  // quantity and negotiated speed rather than a guessed full mesh.
  let edgeN = 0
  for (const c of cabling) {
    const a = anchor.get(c.fromLayer)
    const b = anchor.get(c.toLayer)
    if (!a || !b || a.id === b.id) continue
    const label = `${c.quantity} × ${c.speed} ${c.cableType}`
    cells += edge(`nd_edge_${edgeN++}`, a.id, b.id, label)
  }

  const height = FIRST_ROW_Y + roles.length * ROW_HEIGHT + 80

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="NetDesignAI" type="device">
  <diagram name="Topology">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${CANVAS_W}" pageHeight="${height}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
    <mxCell id="nd_title" value="${esc(title)}" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=16;fontStyle=1;" vertex="1" parent="1">
      <mxGeometry x="${Math.round(CANVAS_W / 2 - 300)}" y="20" width="600" height="40" as="geometry"/>
    </mxCell>
${cells}      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`
}

/** Filename draw.io / diagrams.net expects. */
export function drawioFilename(siteCode: string): string {
  const slug = (siteCode || 'network').replace(/[^A-Za-z0-9-]/g, '') || 'network'
  return `${slug}-topology.drawio`
}
