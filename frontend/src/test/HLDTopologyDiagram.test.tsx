import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import {
  HLDTopologyDiagram,
  simulateNodeHealth,
  HEALTH_COLOR,
  HEALTH_LABEL,
  type HLDNode,
} from '@/components/HLDTopologyDiagram'

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
