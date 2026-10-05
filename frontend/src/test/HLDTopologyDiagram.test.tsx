import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import {
  HLDTopologyDiagram,
  buildTopology,
  simulateNodeHealth,
  HEALTH_COLOR,
  HEALTH_LABEL,
  type HLDNode,
} from '@/components/HLDTopologyDiagram'
import type { UseCase } from '@/types'
import { buildDeviceList, buildCabling } from '@/lib/bom'
import { generateAllConfigs, borderLeaves, physicalPortMap } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

afterEach(() => cleanup())

function makeNode(overrides: Partial<HLDNode> = {}): HLDNode {
  return {
    id: 'lf1', label: 'LEAF-01', model: 'N9K', layer: 'leaf', vendor: 'Cisco',
    loopback: '10.255.2.1', mgmtIp: '10.0.0.51', role: 'leaf',
    x: 0, y: 0, w: 136, h: 66, features: [],
    color: '#000', border: '#fff', textColor: '#fff',
    ...overrides,
  }
}

/** A real design: BOM + the configs generated from it (with optional inputs). */
function design(vendor: string, useCase: UseCase, inputs: { appTypes?: never[] | string[]; protoFeatures?: string[] } = {}) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ1', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, useCase, [], (inputs.appTypes ?? []) as never, inputs.protoFeatures ?? [])
  const topo = buildTopology(devices, useCase, 'isis', ['vxlan_evpn'], 'AQ1', configs)
  return { devices, configs, topo, byHost: new Map(devices.map(d => [d.hostname, d])) }
}
const ipsIn = (s: string) => s.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []
const texts = (c: HTMLElement) => Array.from(c.querySelectorAll('text')).map(t => t.textContent ?? '')

const MATRIX: Array<[string, UseCase]> = [
  ['Cisco', 'dc'], ['Arista', 'dc'], ['Juniper', 'dc'], ['NVIDIA', 'dc'], ['Dell EMC', 'dc'], ['HPE Aruba', 'dc'],
  ['Cisco', 'gpu'], ['NVIDIA', 'gpu'], ['Cisco', 'campus'], ['Arista', 'campus'], ['Juniper', 'campus'],
  ['Cisco', 'wan'], ['Juniper', 'wan'], ['Cisco', 'multisite'], ['Cisco', 'multicloud'], ['Cisco', 'oran'],
]

// ── AQ1: the HLD is drawn from the design ───────────────────────────────────
describe('HLD is drawn from the design, not a reference architecture (AQ1)', () => {
  it.each(MATRIX)('%s %s: every node is a BOM device and every address is in that device\'s config', (vendor, uc) => {
    const { topo, configs, byHost } = design(vendor, uc)
    expect(topo.nodes.length).toBeGreaterThan(0)
    const cfgOf = (host: string) => stripComments(configs[byHost.get(host)?.id ?? ''] ?? '')
    const nodeHost = new Map(topo.nodes.map(n => [n.id, n.label]))
    for (const n of topo.nodes) {
      expect(byHost.has(n.label), `${n.label} is not in the BOM`).toBe(true)
      for (const ip of ipsIn(n.loopback)) expect(cfgOf(n.label), `${n.label} loopback ${ip}`).toContain(ip)
    }
    for (const l of topo.links) for (const ip of ipsIn(l.linkSubnet)) {
      const ends = `${cfgOf(nodeHost.get(l.from)!)}\n${cfgOf(nodeHost.get(l.to)!)}`
      expect(ends, `${l.id} subnet ${ip}`).toContain(ip)
    }
  })

  it.each(MATRIX)('%s %s: draws exactly the tiers the BOM contains', (vendor, uc) => {
    const { topo, devices } = design(vendor, uc)
    const layers = new Set(devices.map(d => d.subLayer))
    for (const t of topo.tiers ?? []) {
      const sub = t.id.replace(/^t-/, '')
      expect(layers.has(sub), `tier ${t.label} has no ${sub} in the BOM`).toBe(true)
    }
  })

  it.each([['Cisco', 'dc'], ['Arista', 'campus'], ['NVIDIA', 'gpu']] as const)('%s %s: link speeds are the BOM cabling speeds', (vendor, uc) => {
    const { topo, devices } = design(vendor, uc)
    const cab = buildCabling(devices, {} as never)
    const sub = new Map(topo.nodes.map(n => [n.id, devices.find(d => d.hostname === n.label)!.subLayer]))
    for (const l of topo.links) {
      if (!l.speed) continue
      const a = sub.get(l.from)!, b = sub.get(l.to)!
      const billed = cab.find(c => (c.fromLayer === a && c.toLayer === b) || (c.fromLayer === b && c.toLayer === a))
      expect(billed, `${a}↔${b} is drawn but not cabled`).toBeTruthy()
      expect(l.speed.replace(/^\d+×/, ''), `${l.id}`).toBe(billed!.speed)
    }
  })

  it('fabric links carry the interfaces the configs configure', () => {
    const { topo, devices } = design('Arista', 'dc')
    const host = new Map(topo.nodes.map(n => [n.id, n.label]))
    const ports = new Set(physicalPortMap(devices, 'dc').flatMap(p => [`${p.a.device}:${p.a.iface}`, `${p.b.device}:${p.b.iface}`]))
    const fabric = topo.links.filter(l => l.fromPort && l.toPort)
    expect(fabric.length).toBeGreaterThan(0)
    for (const l of fabric) {
      expect(ports.has(`${host.get(l.from)}:${l.fromPort}`), `${host.get(l.from)}:${l.fromPort}`).toBe(true)
      expect(ports.has(`${host.get(l.to)}:${l.toPort}`), `${host.get(l.to)}:${l.toPort}`).toBe(true)
    }
  })

  it('firewalls connect to the border leaves, never to a spine (Z3)', () => {
    const { topo, devices } = design('Cisco', 'dc')
    const dev = new Map(topo.nodes.map(n => [n.id, devices.find(d => d.hostname === n.label)!]))
    const border = new Set(borderLeaves(devices).map(d => d.hostname))
    const fwLinks = topo.links.filter(l => dev.get(l.from)!.subLayer === 'firewall' || dev.get(l.to)!.subLayer === 'firewall')
    const toSwitch = fwLinks.filter(l => !l.isHaSync)
    expect(toSwitch.length).toBeGreaterThan(0)
    for (const l of toSwitch) {
      const other = dev.get(l.from)!.subLayer === 'firewall' ? dev.get(l.to)! : dev.get(l.from)!
      expect(other.subLayer).toBe('leaf')
      expect(border.has(other.hostname), `${other.hostname} is not a border leaf`).toBe(true)
    }
  })

  it('every packet flow runs through nodes the design has; north–south starts at a firewall', () => {
    for (const [vendor, uc] of MATRIX) {
      const { topo, devices } = design(vendor, uc)
      const ids = new Set(topo.nodes.map(n => n.id))
      for (const f of topo.flows) for (const id of f.nodeSeq) expect(ids.has(id), `${uc} ${f.id}: ${id}`).toBe(true)
      const ns = topo.flows.find(f => f.id === 'ns')
      if (ns) {
        const first = topo.nodes.find(n => n.id === ns.nodeSeq[0])!
        expect(devices.find(d => d.hostname === first.label)!.subLayer).toBe('firewall')
      }
    }
  })
})

// ── AQ1: captions come from the configs, not the store selection ───────────
describe('HLD protocol captions are read from the generated configs (AQ1)', () => {
  const CASES: Array<[string, UseCase, RegExp, RegExp?]> = [
    ['Cisco', 'dc', /IS-IS underlay · VXLAN\/EVPN overlay/],
    ['Dell EMC', 'dc', /eBGP underlay · VXLAN\/EVPN overlay/, /IS-IS/],
    ['HPE Aruba', 'dc', /eBGP underlay/, /IS-IS/],
    ['NVIDIA', 'gpu', /eBGP unnumbered \(RFC 7938\) · pure L3 fabric · RoCEv2 lossless/, /VXLAN/],
    ['Cisco', 'campus', /OSPF · HSRP first hop/, /IS-IS/],
    ['Arista', 'campus', /OSPF · VRRP first hop/, /HSRP/],
    ['Cisco', 'wan', /SD-WAN overlay \(OMP · IPsec\)/, /VXLAN|selected/],
    ['Cisco', 'oran', /IS-IS \+ Segment Routing · PTP timing/, /selected/],
  ]
  it.each(CASES)('%s %s', (vendor, uc, want, never) => {
    const { topo } = design(vendor, uc)
    expect(topo.subtitle).toMatch(want)
    if (never) expect(topo.subtitle).not.toMatch(never)
  })

  it('the underlay selection does not override what the configs run', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ1', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    const topo = buildTopology(devices, 'dc', 'ospf', ['vxlan_evpn'], 'AQ1')
    expect(topo.subtitle).toMatch(/IS-IS underlay/)
    expect(topo.subtitle).not.toMatch(/OSPF/)
  })
})

// ── AQ4: inputs the configs honour show up on the diagram ──────────────────
describe('HLD reflects the selected inputs (AQ4)', () => {
  const leafFeatures = (inputs: { appTypes?: string[]; protoFeatures?: string[] }) => {
    const { topo, devices } = design('Cisco', 'dc', inputs)
    const leaf = topo.nodes.find(n => devices.find(d => d.hostname === n.label)?.subLayer === 'leaf')!
    return leaf.features
  }
  it('IPv6 dual-stack appears only when selected', () => {
    expect(leafFeatures({})).not.toContain('IPv6 dual-stack')
    expect(leafFeatures({ protoFeatures: ['IPv6 Dual-Stack'] })).toContain('IPv6 dual-stack')
  })
  it('the storage lossless class appears only when the storage app type is selected', () => {
    expect(leafFeatures({})).not.toContain('Storage lossless class')
    expect(leafFeatures({ appTypes: ['storage'] })).toContain('Storage lossless class')
  })
  it('the component passes its input props into the configs it describes', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ1', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    render(<HLDTopologyDiagram devices={devices} useCase="dc" protoFeatures={['IPv6 Dual-Stack']} />)
    fireEvent.click(screen.getByText(leaf.hostname))
    expect(screen.getByText('IPv6 dual-stack')).toBeInTheDocument()
  })
})

// ── Pairing + FHRP read from the configs ───────────────────────────────────
describe('HLD pairing and first-hop details name what the config builds', () => {
  const pairText = (vendor: string, uc: UseCase, sub: string) => {
    const devices = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'AQ1', vendorPrefs: [vendor], totalEndpoints: 512 })
    const dev = devices.find(d => d.subLayer === sub)!
    render(<HLDTopologyDiagram devices={devices} useCase={uc} />)
    fireEvent.click(screen.getByText(dev.hostname))
    return document.body.textContent ?? ''
  }
  it('Cisco leaf: vPC pair with its peer', () => {
    expect(pairText('Cisco', 'dc', 'leaf')).toMatch(/vPC pair #1 — peer: \S+-LEAF-A02/)
  })
  it('Dell leaf: VLT pair (AP5), not "vPC/MLAG"', () => {
    const t = pairText('Dell EMC', 'dc', 'leaf')
    expect(t).toMatch(/VLT pair #1/)
    expect(t).not.toMatch(/vPC\/MLAG/)
  })
  it('Arista campus distribution: the VRRP VIP its config owns', () => {
    expect(pairText('Arista', 'campus', 'distribution')).toMatch(/VRRP VIP \(Vlan99 mgmt\): 10\.255\.99\.254/)
  })
})

// ── Health overlay (C2), on a real design ──────────────────────────────────
describe('HLDTopologyDiagram — health overlay (C2)', () => {
  const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'C2', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
  const spine = devices.find(d => d.subLayer === 'spine')!.hostname

  it('does not render health badges by default', () => {
    const { container } = render(<HLDTopologyDiagram devices={devices} />)
    expect(screen.getByRole('button', { name: /health overlay: off/i })).toBeInTheDocument()
    expect(container.querySelector('circle[stroke="#080E1A"]')).toBeNull()
  })

  it('toggling Health Overlay renders status badges on device nodes', () => {
    const { container } = render(<HLDTopologyDiagram devices={devices} />)
    fireEvent.click(screen.getByRole('button', { name: /health overlay: off/i }))
    const badges = container.querySelectorAll('circle[stroke="#080E1A"]')
    expect(badges.length).toBeGreaterThan(0)
    const validFills = new Set(Object.values(HEALTH_COLOR))
    badges.forEach(b => expect(validFills.has(b.getAttribute('fill') ?? '')).toBe(true))
  })

  it('selecting a node with the overlay on shows a Live Health drill-down', () => {
    render(<HLDTopologyDiagram devices={devices} />)
    fireEvent.click(screen.getByRole('button', { name: /health overlay: off/i }))
    fireEvent.click(screen.getByText(spine))
    expect(screen.getByText('Live Health')).toBeInTheDocument()
  })

  it('does not show the Live Health section when the overlay is off', () => {
    render(<HLDTopologyDiagram devices={devices} />)
    fireEvent.click(screen.getByText(spine))
    expect(screen.queryByText('Live Health')).toBeNull()
  })
})

describe('simulateNodeHealth', () => {
  it('is deterministic for the same node id/layer', () => {
    const node = makeNode({ id: 'sp1', layer: 'spine' })
    expect(simulateNodeHealth(node)).toEqual(simulateNodeHealth(node))
  })

  it('returns a valid status and bounded metrics', () => {
    const h = simulateNodeHealth(makeNode({ id: 'lf3', layer: 'leaf' }))
    expect(['healthy', 'degraded', 'down', 'unknown']).toContain(h.status)
    expect(h.cpu).toBeGreaterThan(0)
    expect(h.cpu).toBeLessThanOrEqual(99)
    expect(h.mem).toBeGreaterThan(0)
    expect(h.mem).toBeLessThanOrEqual(99)
  })

  it('only assigns PFC drops to gpu-layer nodes', () => {
    expect(simulateNodeHealth(makeNode({ id: 'lf1', layer: 'leaf' })).pfcDrops).toBe(0)
    expect(simulateNodeHealth(makeNode({ id: 'fw1', layer: 'corp-fw' })).pfcDrops).toBe(0)
  })

  it('only reports BGP sessions for routing layers', () => {
    expect(simulateNodeHealth(makeNode({ id: 'host1', layer: 'host' })).bgpSessionsUp).toBe(0)
    expect(simulateNodeHealth(makeNode({ id: 'oob', layer: 'oob' })).bgpSessionsUp).toBe(0)
  })

  it('flags degraded/down status with at least one alert message', () => {
    // Scan a range of synthetic ids to find a degraded and a down case.
    const statuses = new Map<string, string[]>()
    for (let i = 0; i < 200; i++) {
      const h = simulateNodeHealth(makeNode({ id: `gpu${i}`, layer: 'gpu' }))
      if (h.status !== 'healthy') statuses.set(h.status, h.alerts)
    }
    for (const [, alerts] of statuses) {
      expect(alerts.length).toBeGreaterThan(0)
    }
  })
})

// ── Health palette ────────────────────────────────────────────────────────────
describe('HEALTH_COLOR / HEALTH_LABEL', () => {
  it('covers all health statuses with hex colors and labels', () => {
    for (const status of ['healthy', 'degraded', 'down', 'unknown'] as const) {
      expect(HEALTH_COLOR[status]).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(HEALTH_LABEL[status]).toBeTruthy()
    }
  })
})


// ── Layout annotations (AC1/AC2), now on real designs ──────────────────────
describe('HLD annotations', () => {
  const render_ = (vendor: string, uc: UseCase) => {
    const devices = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'AC', vendorPrefs: [vendor], totalEndpoints: 512 })
    return render(<HLDTopologyDiagram devices={devices} useCase={uc} />)
  }

  it('names every tier row and encloses the fabric with its protocol', () => {
    const { container } = render_('Cisco', 'dc')
    const t = texts(container)
    for (const tier of ['FIREWALL', 'SPINE', 'LEAF']) expect(t, tier).toContain(tier)
    expect(t).toContain('FABRIC')
    expect(container.querySelector('rect[stroke="#38BDF8"][stroke-dasharray]')).not.toBeNull()
  })

  it('calls out the border-leaf pair on DC and multisite only', () => {
    for (const [uc, want] of [['dc', true], ['multisite', true], ['campus', false], ['gpu', false], ['wan', false]] as const) {
      cleanup()
      const { container } = render_('Cisco', uc)
      expect(texts(container).includes('BORDER LEAF'), uc).toBe(want)
    }
  })

  it('annotates both traffic axes with explicit-fill arrowheads', () => {
    const { container } = render_('Cisco', 'dc')
    const t = texts(container)
    expect(t).toContain('NORTH–SOUTH')
    expect(t).toContain('EAST–WEST')
    for (const id of ['axisArrowUp', 'axisArrowDown', 'axisArrowLeft', 'axisArrowRight']) {
      expect(container.querySelector(`#${id} path`)!.getAttribute('fill')).toMatch(/^#/)
    }
  })

  it('no caption leaks a raw store enum', () => {
    for (const uc of ['dc', 'campus', 'gpu', 'wan', 'oran'] as const) {
      cleanup()
      const { container } = render_('Cisco', uc)
      for (const txt of texts(container)) expect(txt, `${uc}: "${txt}"`).not.toMatch(/\b[a-z]+_[a-z]+\b/)
    }
  })

  it('an empty design shows an empty state, not an invented topology', () => {
    const { container } = render(<HLDTopologyDiagram devices={[]} useCase="dc" />)
    expect(container.querySelector('svg[role="img"]')).toBeNull()
    expect(screen.getByText(/No devices in the design yet/)).toBeInTheDocument()
  })
})

// ── AH10: the exported SVG must not depend on emoji fonts ───────────────────
describe('HLD diagram — export safety', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
  for (const uc of ['dc', 'campus', 'gpu', 'wan', 'oran'] as const) {
    it(`${uc}: renders no emoji into the SVG`, () => {
      const devices = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'AH', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
      const { container } = render(<HLDTopologyDiagram devices={devices} useCase={uc} />)
      const svg = container.querySelector('svg[role="img"]') ?? container.querySelector('svg')
      const found = (svg!.outerHTML.match(new RegExp(EMOJI, 'gu')) ?? [])
      expect(found, `${uc}: emoji in exported SVG: ${found.join(' ')}`).toEqual([])
    })
  }

  it('draws zone swatches as real marks tinted with the zone colour', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AH', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    const { container } = render(<HLDTopologyDiagram devices={devices} useCase="dc" />)
    const zoneDots = [...container.querySelectorAll('circle[r="3.5"]')]
    expect(zoneDots.length).toBeGreaterThan(0)
    for (const d of zoneDots) expect(d.getAttribute('fill')).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})
