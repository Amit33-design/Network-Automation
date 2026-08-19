import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildCabling } from '@/lib/bom'
import { buildDrawio, drawioFilename } from '@/lib/drawio-export'
import type { BOMDevice } from '@/types'

const DIST = { 'spine-leaf': 100, 'core-dist': 200, 'dist-access': 50, 'wan-edge': 5000 }
const dc = () => buildDeviceList({
  useCase: 'dc', scale: 'small', siteCode: 'IAD', totalEndpoints: 200,
})

/** Minimal well-formedness check — draw.io rejects unbalanced XML outright. */
function tagsBalance(xml: string): boolean {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w.-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, attrs, selfClose] = m
    if (attrs.startsWith('?') || name === 'xml') continue
    if (selfClose) continue
    if (close) { if (stack.pop() !== name) return false }
    else stack.push(name)
  }
  return stack.length === 0
}

describe('draw.io topology export (AB6)', () => {
  it('produces well-formed XML draw.io can open', () => {
    const xml = buildDrawio(dc(), buildCabling(dc(), DIST), 'IAD')
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true)
    expect(xml).toContain('<mxfile')
    expect(xml).toContain('<mxGraphModel')
    expect(tagsBalance(xml), 'unbalanced XML — draw.io would refuse the file').toBe(true)
  })

  it('uses the REAL BOM hostnames and models, not synthesised names', () => {
    // The backend generator invents SPINE-01/LEAF-01 from capacity counts
    // because it never receives the BOM. The browser has the real thing.
    const devices = dc()
    const xml = buildDrawio(devices, [], 'IAD')
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    expect(xml).toContain(leaf.hostname)
    expect(xml).toContain(leaf.model)
    expect(leaf.hostname).toMatch(/^IAD-/)
  })

  it('is deterministic — the same design exports byte-identically', () => {
    // IDs are hashed from hostnames rather than uuid4(), so the file can be
    // committed and diffed across design revisions.
    const devices = dc(); const cabling = buildCabling(devices, DIST)
    expect(buildDrawio(devices, cabling, 'IAD')).toBe(buildDrawio(devices, cabling, 'IAD'))
    expect(buildDrawio(devices, cabling, 'IAD')).not.toMatch(/[0-9a-f]{16}/)
  })

  it('edges carry the real cable quantity and speed', () => {
    const devices = dc()
    const cabling = buildCabling(devices, DIST)
    const xml = buildDrawio(devices, cabling, 'IAD')
    const sl = cabling.find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')!
    expect(xml).toContain(`${sl.quantity} × ${sl.speed} ${sl.cableType}`)
  })

  it('collapses a huge tier instead of emitting hundreds of unreadable boxes', () => {
    const gpu = buildDeviceList({
      useCase: 'gpu', scale: 'medium', siteCode: 'GPU',
      totalEndpoints: 512, bandwidthPerServer: '400G', oversubscription: 1,
    })
    const servers = gpu.filter(d => d.subLayer === 'gpu-compute')
    expect(servers.length).toBeGreaterThan(12)
    const xml = buildDrawio(gpu, [], 'GPU')
    expect(xml).toContain(`${servers.length} × gpu-compute`)
    // …and does not emit a cell per server
    expect((xml.match(/vertex="1"/g) ?? []).length).toBeLessThan(60)
  })

  it('special characters in hostnames are escaped, not injected raw', () => {
    const d: BOMDevice = {
      id: 'x', hostname: 'A&B <test> "q"', role: 'leaf', subLayer: 'leaf',
      model: 'M&M', vendor: 'Cisco', count: 1, unitPrice: 1, totalPrice: 1,
      speed: '100G', ports: 32, features: [],
    }
    const xml = buildDrawio([d], [], 'T&T')
    expect(xml).toContain('A&amp;B &lt;test&gt;')
    expect(xml).not.toContain('<test>')
    expect(tagsBalance(xml)).toBe(true)
  })

  it('every use case exports without throwing or emitting undefined', () => {
    for (const useCase of ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'oran'] as const) {
      const devices = buildDeviceList({ useCase, scale: 'small', siteCode: 'X', totalEndpoints: 400, numSites: 3 })
      const xml = buildDrawio(devices, buildCabling(devices, DIST), useCase)
      expect(xml, useCase).not.toContain('undefined')
      expect(tagsBalance(xml), useCase).toBe(true)
    }
  })

  it('filenames are slugged', () => {
    expect(drawioFilename('IAD')).toBe('IAD-topology.drawio')
    expect(drawioFilename('')).toBe('network-topology.drawio')
  })
})
