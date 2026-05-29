import { describe, it, expect } from 'vitest'
import { buildBOM, buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'

// Regression coverage for vendor-aware BOM + config generation.
// User report: "when I select Arista/Fortinet/Dell it still gives Cisco devices".

describe('vendor-aware BOM selection', () => {
  it('defaults to Cisco when no vendorPrefs given', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBeGreaterThan(0)
    expect(spines.every(d => d.vendor === 'Cisco')).toBe(true)
  })

  it('Arista DC → Arista spine + leaf', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Arista'] })
    expect(devices.filter(d => d.subLayer === 'spine').every(d => d.vendor === 'Arista')).toBe(true)
    expect(devices.filter(d => d.subLayer === 'leaf').every(d => d.vendor === 'Arista')).toBe(true)
  })

  it('Juniper DC → Juniper spine + leaf', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'] })
    expect(devices.filter(d => d.subLayer === 'spine').every(d => d.vendor === 'Juniper')).toBe(true)
    expect(devices.filter(d => d.subLayer === 'leaf').every(d => d.vendor === 'Juniper')).toBe(true)
  })

  it('Dell EMC DC → Dell spine + leaf', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Dell EMC'] })
    expect(devices.filter(d => d.subLayer === 'spine').every(d => d.vendor === 'Dell EMC')).toBe(true)
  })

  it('NVIDIA GPU → NVIDIA spine + leaf', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'medium', siteCode: 'T', vendorPrefs: ['NVIDIA'] })
    expect(devices.filter(d => d.subLayer === 'spine').every(d => d.vendor === 'NVIDIA')).toBe(true)
    expect(devices.filter(d => d.subLayer === 'leaf').every(d => d.vendor === 'NVIDIA')).toBe(true)
  })

  it('Fortinet campus → Fortinet firewall + switches', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Fortinet'] })
    const fws = devices.filter(d => d.subLayer === 'firewall')
    expect(fws.length).toBeGreaterThan(0)
    expect(fws.every(d => d.vendor === 'Fortinet')).toBe(true)
    expect(devices.filter(d => d.subLayer === 'access').every(d => d.vendor === 'Fortinet')).toBe(true)
  })

  it('Extreme Networks campus → Extreme switches (no silent Cisco fallback)', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Extreme Networks'] })
    expect(devices.filter(d => d.subLayer === 'access').every(d => d.vendor === 'Extreme Networks')).toBe(true)
  })

  it('combining vendors layers correctly: Arista switches + Palo Alto firewall', () => {
    const { devices } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Arista', 'Palo Alto'] })
    expect(devices.filter(d => d.subLayer === 'spine').every(d => d.vendor === 'Arista')).toBe(true)
    expect(devices.filter(d => d.subLayer === 'firewall').every(d => d.vendor === 'Palo Alto')).toBe(true)
  })

  it('roles a vendor does not make stay on the Cisco default (Arista keeps Cisco firewall)', () => {
    const { devices } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Arista'] })
    const fws = devices.filter(d => d.subLayer === 'firewall')
    expect(fws.length).toBeGreaterThan(0)
    expect(fws.every(d => d.vendor === 'Cisco')).toBe(true)
  })
})

describe('vendor-native config generation', () => {
  function fwConfig(vendorPrefs: string[]) {
    const { devices } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs })
    const fw = devices.find(d => d.subLayer === 'firewall')!
    return generateAllConfigs(devices, 'dc')[fw.id]
  }

  it('Palo Alto firewall emits a security rulebase + NAT', () => {
    const cfg = fwConfig(['Palo Alto'])
    expect(cfg).toContain('set rulebase security rules')
    expect(cfg).toContain('set rulebase nat rules')
    expect(cfg).toContain('PAN-OS')
  })

  it('Fortinet firewall emits firewall policy + IPS', () => {
    const cfg = fwConfig(['Fortinet'])
    expect(cfg).toContain('config firewall policy')
    expect(cfg).toContain('FortiOS')
  })

  it('Cisco firewall (default) emits zone-based policy', () => {
    const cfg = fwConfig([])
    // Cisco IOS-XE ZBF
    expect(cfg.toLowerCase()).toMatch(/zone/)
  })

  it('Dell EMC switch emits OS10 config (not generic stub)', () => {
    const { devices } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Dell EMC'] })
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    const cfg = generateAllConfigs(devices, 'dc')[leaf.id]
    expect(cfg).toContain('OS10')
    expect(cfg).toContain('router bgp')
  })

  it('NVIDIA GPU leaf emits Cumulus/FRR config with RoCEv2 QoS', () => {
    const { devices } = buildBOM({ useCase: 'gpu', scale: 'medium', siteCode: 'T', vendorPrefs: ['NVIDIA'] })
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    const cfg = generateAllConfigs(devices, 'gpu')[leaf.id]
    expect(cfg).toContain('Cumulus')
    expect(cfg.toLowerCase()).toContain('roce')
  })

  it('Extreme Networks switch emits EXOS config (not generic stub)', () => {
    const { devices } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: ['Extreme Networks'] })
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    const cfg = generateAllConfigs(devices, 'dc')[leaf.id]
    expect(cfg).toContain('EXOS')
  })
})
