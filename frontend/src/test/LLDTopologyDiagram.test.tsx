import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { LLDTopologyDiagram } from '@/components/LLDTopologyDiagram'
import type { BOMDevice } from '@/types'

afterEach(() => cleanup())

const dev = (overrides: Partial<BOMDevice>): BOMDevice => ({
  id: overrides.hostname ?? 'd', hostname: 'H', role: 'leaf', subLayer: 'leaf',
  model: 'M', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
  speed: '10G', ports: 48, uplinks: 4, features: [], ...overrides,
})

// LLD vendor-awareness (D2): the campus/WAN LLD builders must render the BOM's
// actual vendor/model, not hardcoded Cisco SKUs.
describe('LLDTopologyDiagram — vendor-aware (D2)', () => {
  it('campus LLD shows Juniper distribution/access models from the BOM', () => {
    // The campus LLD renders a fixed 4-dist / 4-acc layout, so supply a full
    // set to confirm every tier node derives from the BOM (no Cisco fallback).
    const devices = [
      ...Array.from({ length: 4 }, (_, i) =>
        dev({ hostname: `CAMP-DIST-0${i + 1}`, subLayer: 'distribution', vendor: 'Juniper', model: 'EX4650-48Y' })),
      ...Array.from({ length: 4 }, (_, i) =>
        dev({ hostname: `CAMP-ACC-0${i + 1}`, subLayer: 'access', vendor: 'Juniper', model: 'EX4400-48P' })),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="campus" />)
    const text = container.textContent ?? ''
    expect(text).toContain('EX4650-48Y')
    expect(text).toContain('EX4400-48P')
    expect(text).toContain('Juniper')
    // with a full BOM set, the hardcoded Cisco SKUs must NOT appear
    expect(text).not.toContain('C9500-48Y4C')
    expect(text).not.toContain('C9300-48P')
  })

  it('campus LLD partial BOM: derives present devices, falls back for the rest', () => {
    const devices = [
      dev({ hostname: 'CAMP-DIST-01', subLayer: 'distribution', vendor: 'Juniper', model: 'EX4650-48Y' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="campus" />)
    const text = container.textContent ?? ''
    expect(text).toContain('EX4650-48Y')      // index 0 derived from BOM
    expect(text).toContain('C9500-48Y4C')     // indices 1-3 fall back to Cisco
  })

  it('campus LLD falls back to Cisco defaults when BOM has no campus devices', () => {
    const { container } = render(<LLDTopologyDiagram devices={[]} useCase="campus" />)
    const text = container.textContent ?? ''
    expect(text).toContain('C9500-48Y4C')
    expect(text).toContain('C9300-48P')
  })

  it('WAN LLD shows Juniper wan-edge model from the BOM', () => {
    const devices = [
      dev({ hostname: 'WAN-PE-01', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX204' }),
      dev({ hostname: 'WAN-PE-02', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX204' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="wan" />)
    const text = container.textContent ?? ''
    expect(text).toContain('MX204')
    expect(text).toContain('WAN-PE-01')
    expect(text).not.toContain('ASR-9001')
  })

  it('campus LLD reflects Arista when selected', () => {
    const devices = [
      dev({ hostname: 'CAMP-DIST-01', subLayer: 'distribution', vendor: 'Arista', model: 'Arista 750' }),
      dev({ hostname: 'CAMP-ACC-01', subLayer: 'access', vendor: 'Arista', model: 'Arista 720XP' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="campus" />)
    const text = container.textContent ?? ''
    expect(text).toContain('Arista 750')
    expect(text).toContain('Arista 720XP')
  })

  it('multisite LLD derives spine/leaf model from the BOM', () => {
    const devices = [
      dev({ hostname: 'SP-01', subLayer: 'spine', vendor: 'Arista', model: '7280R3' }),
      dev({ hostname: 'SP-02', subLayer: 'spine', vendor: 'Arista', model: '7280R3' }),
      dev({ hostname: 'LF-01', subLayer: 'leaf', vendor: 'Arista', model: '7050SX3' }),
      dev({ hostname: 'LF-02', subLayer: 'leaf', vendor: 'Arista', model: '7050SX3' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="multisite" />)
    const text = container.textContent ?? ''
    expect(text).toContain('7280R3')
    expect(text).toContain('7050SX3')
    expect(text).not.toContain('N9K-C9508')
    expect(text).not.toContain('N9K-C9332C')
  })

  it('multisite LLD falls back to Cisco N9K when BOM lacks fabric devices', () => {
    const { container } = render(<LLDTopologyDiagram devices={[]} useCase="multisite" />)
    const text = container.textContent ?? ''
    expect(text).toContain('N9K-C9508')
    expect(text).toContain('N9K-C9332C')
  })

  it('multicloud LLD derives on-prem spine from the BOM', () => {
    const devices = [
      dev({ hostname: 'SP-01', subLayer: 'spine', vendor: 'Juniper', model: 'QFX5220' }),
      dev({ hostname: 'SP-02', subLayer: 'spine', vendor: 'Juniper', model: 'QFX5220' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="multicloud" />)
    const text = container.textContent ?? ''
    expect(text).toContain('QFX5220')
    // cloud providers stay provider-native
    expect(text).toContain('AWS')
  })

  it('aviatrix LLD derives on-prem DC-edge from the BOM wan-edge', () => {
    const devices = [
      dev({ hostname: 'EDGE-01', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX240' }),
      dev({ hostname: 'EDGE-02', subLayer: 'wan-edge', vendor: 'Juniper', model: 'MX240' }),
    ]
    const { container } = render(<LLDTopologyDiagram devices={devices} useCase="aviatrix" />)
    const text = container.textContent ?? ''
    expect(text).toContain('MX240')
    expect(text).not.toContain('ASR-1002-HX')
    // transit/spoke gateways stay Aviatrix-native
    expect(text).toContain('Aviatrix')
  })
})
