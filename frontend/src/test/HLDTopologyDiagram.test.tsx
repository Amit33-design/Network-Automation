import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import {
  HLDTopologyDiagram,
  simulateNodeHealth,
  HEALTH_COLOR,
  HEALTH_LABEL,
  type HLDNode,
} from '@/components/HLDTopologyDiagram'
import type { BOMDevice } from '@/types'

afterEach(() => cleanup())

const bomDev = (overrides: Partial<BOMDevice>): BOMDevice => ({
  id: overrides.hostname ?? 'd', hostname: 'H', role: 'leaf', subLayer: 'leaf',
  model: 'M', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
  speed: '10G', ports: 48, uplinks: 4, features: [], ...overrides,
})

function makeNode(overrides: Partial<HLDNode> = {}): HLDNode {
  return {
    id: 'lf1', label: 'LEAF-01', model: 'N9K', layer: 'leaf', vendor: 'Cisco',
    loopback: '10.255.2.1', mgmtIp: '10.0.0.51', role: 'leaf',
    x: 0, y: 0, w: 136, h: 66, features: [],
    color: '#000', border: '#fff', textColor: '#fff',
    ...overrides,
  }
}

// ── HLDTopologyDiagram health overlay (C2) ─────────────────────────────────
describe('HLDTopologyDiagram — health overlay (C2)', () => {
  it('does not render health badges by default', () => {
    const { container } = render(<HLDTopologyDiagram devices={[]} />)
    expect(screen.getByRole('button', { name: /health overlay: off/i })).toBeInTheDocument()
    expect(container.querySelector('circle[stroke="#080E1A"]')).toBeNull()
  })

  it('toggling Health Overlay renders status badges on device nodes', () => {
    const { container } = render(<HLDTopologyDiagram devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /health overlay: off/i }))
    expect(screen.getByRole('button', { name: /health overlay: on/i })).toBeInTheDocument()
    const badges = container.querySelectorAll('circle[stroke="#080E1A"]')
    expect(badges.length).toBeGreaterThan(0)
    // every badge fill must be one of the known health colors
    const validFills = new Set(Object.values(HEALTH_COLOR))
    badges.forEach(b => expect(validFills.has(b.getAttribute('fill') ?? '')).toBe(true))
  })

  it('selecting a node with the overlay on shows a Live Health drill-down', () => {
    render(<HLDTopologyDiagram devices={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /health overlay: off/i }))
    fireEvent.click(screen.getByText('SPINE-01'))
    expect(screen.getByText('Live Health')).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Iface Errors')).toBeInTheDocument()
  })

  it('does not show the Live Health section when the overlay is off', () => {
    render(<HLDTopologyDiagram devices={[]} />)
    fireEvent.click(screen.getByText('SPINE-01'))
    expect(screen.queryByText('Live Health')).toBeNull()
  })
})

// ── simulateNodeHealth ───────────────────────────────────────────────────────
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

// ── Computed topology — vPC/MLAG pairs, FHRP VIPs, DCI (D1) ────────────────────
describe('HLDTopologyDiagram — computed topology (D1)', () => {
  it('DC leaves are paired into vPC/MLAG pairs with peer labels', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="dc" />)
    fireEvent.click(screen.getByText('LEAF-001'))
    expect(screen.getByText('Fabric Pairing')).toBeInTheDocument()
    expect(screen.getByText(/vPC\/MLAG Pair #1.*peer: LEAF-002/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('✕'))
    fireEvent.click(screen.getByText('LEAF-002'))
    expect(screen.getByText(/vPC\/MLAG Pair #1.*peer: LEAF-001/)).toBeInTheDocument()
  })

  it('DC leaf pairs render a vPC/MLAG peer-link in connected links', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="dc" />)
    fireEvent.click(screen.getByText('LEAF-001'))
    expect(screen.getAllByText('vPC/MLAG Peer-Link').length).toBeGreaterThan(0)
  })

  it('multisite leaves include EVPN DCI route-target features', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="multisite" />)
    fireEvent.click(screen.getByText('LEAF-001'))
    expect(screen.getByText(/EVPN DCI Type-5 · RT 65100:10010 \(L2\) \/ 65100:50000 \(L3\)/)).toBeInTheDocument()
  })

  it('GPU ToR leaves are paired into vPC/MLAG pairs', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="gpu" />)
    fireEvent.click(screen.getByText('GPU-LEAF-01'))
    expect(screen.getByText(/vPC\/MLAG Pair #1.*peer: GPU-LEAF-02/)).toBeInTheDocument()
  })

  it('campus distribution switches are paired with an HSRP FHRP gateway', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="campus" underlayProtocol="ospf" />)
    fireEvent.click(screen.getByText('DIST-SW-01'))
    expect(screen.getByText('Fabric Pairing')).toBeInTheDocument()
    expect(screen.getByText(/vPC\/MLAG Pair #1.*peer: DIST-SW-02/)).toBeInTheDocument()
    expect(screen.getByText('FHRP Gateway')).toBeInTheDocument()
    expect(screen.getByText(/HSRP VIP \(Vlan10\/DATA\): 10\.10\.0\.1/)).toBeInTheDocument()
  })

  it('campus access switches annotate their MEC uplink to a distribution vPC pair', () => {
    render(<HLDTopologyDiagram devices={[]} useCase="campus" underlayProtocol="ospf" />)
    fireEvent.click(screen.getByText('ACC-SW-001'))
    expect(screen.getByText(/MEC uplink: Port-channel1 → DIST-SW-01 \(vPC pair #1\)/)).toBeInTheDocument()
  })
})

// HLD vendor-awareness (D2 follow-up): firewall / wan-edge / core nodes must
// reflect the BOM vendor/model, not hardcoded Cisco/Palo Alto SKUs.
describe('HLDTopologyDiagram — vendor-aware firewall / WAN / core', () => {
  it('DC HLD shows the BOM firewall + wan-edge model/vendor', () => {
    const devices = [
      bomDev({ hostname: 'SPINE-01', subLayer: 'spine', vendor: 'Arista', model: '7050CX3' }),
      bomDev({ hostname: 'FW-01', subLayer: 'firewall', vendor: 'Fortinet', model: 'FortiGate 600F' }),
      bomDev({ hostname: 'WAN-01', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX204' }),
    ]
    const { container } = render(<HLDTopologyDiagram devices={devices} useCase="dc" />)
    const text = container.textContent ?? ''
    expect(text).toContain('FortiGate 600F')
    expect(text).toContain('MX204')
    expect(text).not.toContain('PA-5450')      // hardcoded FW default gone
    expect(text).not.toContain('ASR-1002-HX')  // hardcoded WAN default gone
  })

  it('DC HLD falls back to Palo Alto / Cisco when BOM lacks fw/wan', () => {
    const devices = [bomDev({ hostname: 'SPINE-01', subLayer: 'spine', vendor: 'Cisco', model: 'N9K' })]
    const { container } = render(<HLDTopologyDiagram devices={devices} useCase="dc" />)
    const text = container.textContent ?? ''
    expect(text).toContain('PA-5450')
    expect(text).toContain('ASR-1002-HX')
  })

  it('Campus HLD shows the BOM firewall + core model from the BOM', () => {
    const devices = [
      bomDev({ hostname: 'DIST-01', subLayer: 'distribution', vendor: 'Juniper', model: 'EX4650' }),
      bomDev({ hostname: 'FW-01', subLayer: 'firewall', vendor: 'Fortinet', model: 'FortiGate 100F' }),
      bomDev({ hostname: 'CORE-01', subLayer: 'core', vendor: 'Arista', model: '7280R3' }),
    ]
    const { container } = render(<HLDTopologyDiagram devices={devices} useCase="campus" />)
    const text = container.textContent ?? ''
    expect(text).toContain('FortiGate 100F')
    expect(text).toContain('7280R3')
    expect(text).not.toContain('PA-3430')
  })

  it('WAN HLD shows the BOM wan-edge model for the HQ PE routers', () => {
    const devices = [
      bomDev({ hostname: 'PE-01', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX304' }),
      bomDev({ hostname: 'PE-02', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX304' }),
    ]
    const { container } = render(<HLDTopologyDiagram devices={devices} useCase="wan" />)
    const text = container.textContent ?? ''
    expect(text).toContain('MX304')
    expect(text).not.toContain('ASR-9001')
  })
})

// ─── Tier bifurcation (user request) ────────────────────────────────────────
// The security zones give coarse trust bands; an engineer reading a
// spine-leaf diagram also wants the ROW names called out, the fabric enclosed
// and labelled with its protocol, the border-leaf pair highlighted, and the
// two traffic axes annotated.

describe('DC tier bifurcation', () => {
  const dcDevices: BOMDevice[] = [
    ...Array.from({ length: 2 }, (_, i) =>
      bomDev({ hostname: `SP-0${i + 1}`, subLayer: 'spine', role: 'spine', model: 'N9K-C9336C' })),
    ...Array.from({ length: 6 }, (_, i) =>
      bomDev({ hostname: `LF-0${i + 1}`, subLayer: 'leaf', role: 'leaf', model: 'N9K-C93180YC' })),
    bomDev({ hostname: 'FW-01', subLayer: 'firewall', role: 'firewall', model: 'PA-5450', vendor: 'Palo Alto' }),
  ]
  const dc = () => render(<HLDTopologyDiagram devices={dcDevices} useCase="dc" />)

  const texts = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('text')).map(t => t.textContent ?? '')

  it('labels every tier row so the layers are named, not just colour-coded', () => {
    const { container } = dc()
    const t = texts(container)
    for (const tier of ['SPINE', 'LEAF', 'SERVER FARM', 'FIREWALL', 'WAN EDGE']) {
      expect(t, `tier label "${tier}" missing`).toContain(tier)
    }
  })

  it('encloses the fabric and states the protocol running on it', () => {
    const { container } = dc()
    const t = texts(container)
    expect(t).toContain('FABRIC')
    // the protocol caption names the underlay and the overlay
    expect(t.some(x => /underlay/.test(x) && /VXLAN\/EVPN/.test(x))).toBe(true)
    // the caption reads as a protocol name, not the raw `vxlan_evpn` enum
    expect(t.some(x => /vxlan_evpn/.test(x) && /FABRIC|underlay/.test(x))).toBe(false)
    // …drawn as a dashed enclosure, not just a label
    expect(container.querySelector('rect[stroke="#38BDF8"][stroke-dasharray]')).not.toBeNull()
  })

  it('calls out the border-leaf pair — the same devices configgen hands off to', () => {
    const { container } = dc()
    expect(texts(container)).toContain('BORDER LEAF')
    expect(container.querySelector('rect[stroke="#F87171"][stroke-dasharray]')).not.toBeNull()
  })

  it('annotates both traffic axes', () => {
    const { container } = dc()
    const t = texts(container)
    expect(t).toContain('NORTH–SOUTH')
    expect(t).toContain('EAST–WEST')
    // each rail is a dashed line carrying arrowheads at both ends
    const ns = container.querySelector('line[marker-start="url(#axisArrowUp)"]')
    const ew = container.querySelector('line[marker-start="url(#axisArrowLeft)"]')
    expect(ns).not.toBeNull()
    expect(ew).not.toBeNull()
  })

  it('arrowheads use explicit fills — currentColor does not resolve inside defs', () => {
    const { container } = dc()
    for (const id of ['axisArrowUp', 'axisArrowDown', 'axisArrowLeft', 'axisArrowRight']) {
      const path = container.querySelector(`#${id} path`)
      expect(path, `${id} missing`).not.toBeNull()
      expect(path!.getAttribute('fill')).toMatch(/^#/)
    }
  })

  it('the border-leaf callout is fabric-specific — it must not leak elsewhere', () => {
    // multicloud/aviatrix reuse the DC builder but have no on-prem border pair.
    for (const useCase of ['campus', 'gpu', 'wan', 'oran', 'multicloud', 'aviatrix'] as const) {
      cleanup()
      const { container } = render(<HLDTopologyDiagram devices={dcDevices} useCase={useCase} />)
      expect(container.querySelector('svg')).not.toBeNull()
      expect(texts(container), useCase).not.toContain('BORDER LEAF')
    }
  })

  it('…but multisite IS a real fabric, so it keeps the callout', () => {
    const { container } = render(<HLDTopologyDiagram devices={dcDevices} useCase="multisite" />)
    expect(texts(container)).toContain('BORDER LEAF')
  })
})

// AC2 — the same bifurcation applied to the remaining builders.
describe('Tier bifurcation across every use case', () => {
  const devs: BOMDevice[] = [
    bomDev({ hostname: 'SP-01', subLayer: 'spine', role: 'spine' }),
    bomDev({ hostname: 'LF-01', subLayer: 'leaf', role: 'leaf' }),
    bomDev({ hostname: 'DS-01', subLayer: 'distribution', role: 'distribution' }),
    bomDev({ hostname: 'AC-01', subLayer: 'access', role: 'access' }),
    bomDev({ hostname: 'WE-01', subLayer: 'wan-edge', role: 'wan-edge' }),
  ]
  const texts = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('text')).map(t => t.textContent ?? '')

  const EXPECTED: Record<string, { tiers: string[]; region: string }> = {
    campus: { tiers: ['CORE', 'DISTRIBUTION', 'ACCESS'],       region: 'CAMPUS LAN' },
    gpu:    { tiers: ['SPINE', 'ToR / LEAF', 'GPU COMPUTE'],   region: 'LOSSLESS FABRIC' },
    wan:    { tiers: ['HUB / DC EDGE', 'WAN EDGE', 'BRANCH'],  region: 'WAN OVERLAY' },
    oran:   { tiers: ['5GC / UPF', 'O-CU', 'O-RU (RADIO)'],    region: 'FRONTHAUL' },
  }

  for (const [useCase, want] of Object.entries(EXPECTED)) {
    it(`${useCase}: rows are named and the region is enclosed`, () => {
      const { container } = render(<HLDTopologyDiagram devices={devs} useCase={useCase} />)
      const t = texts(container)
      for (const tier of want.tiers) {
        expect(t, `${useCase}: tier "${tier}" missing`).toContain(tier)
      }
      expect(t, `${useCase}: region "${want.region}" missing`).toContain(want.region)
    })
  }

  it('every use case annotates at least one traffic axis', () => {
    for (const useCase of ['dc', 'campus', 'gpu', 'wan', 'oran'] as const) {
      cleanup()
      const { container } = render(<HLDTopologyDiagram devices={devs} useCase={useCase} />)
      const hasAxis = container.querySelector('line[marker-start^="url(#axisArrow"]')
      expect(hasAxis, `${useCase}: no traffic axis drawn`).not.toBeNull()
    }
  })

  it('no builder leaks a raw store enum into a caption', () => {
    for (const useCase of ['dc', 'campus', 'gpu', 'wan', 'oran'] as const) {
      cleanup()
      const { container } = render(<HLDTopologyDiagram devices={devs} useCase={useCase} />)
      for (const txt of texts(container)) {
        expect(txt, `${useCase}: raw enum in "${txt}"`).not.toMatch(/[a-z]+_[a-z]+/)
      }
    }
  })
})
