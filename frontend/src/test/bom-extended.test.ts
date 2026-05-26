import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM } from '@/lib/bom'

describe('buildDeviceList scale scaling', () => {
  it('large dc has more devices than small dc', () => {
    const small = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T' })
    const large = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'T' })
    expect(large.length).toBeGreaterThan(small.length)
  })

  it('medium has devices between small and large for dc', () => {
    const small  = buildDeviceList({ useCase: 'dc', scale: 'small',  siteCode: 'T' })
    const medium = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const large  = buildDeviceList({ useCase: 'dc', scale: 'large',  siteCode: 'T' })
    expect(medium.length).toBeGreaterThan(small.length)
    expect(large.length).toBeGreaterThan(medium.length)
  })

  it('campus small has distribution and access devices', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'small', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'distribution')).toBe(true)
    expect(devices.some(d => d.subLayer === 'access')).toBe(true)
  })

  it('wan has wan-edge devices', () => {
    const devices = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'wan-edge')).toBe(true)
  })

  it('multicloud has cloud-transit and cloud-gw devices', () => {
    const devices = buildDeviceList({ useCase: 'multicloud', scale: 'small', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'cloud-transit')).toBe(true)
    expect(devices.some(d => d.subLayer === 'cloud-gw')).toBe(true)
  })

  it('aviatrix uses Aviatrix vendor products', () => {
    const devices = buildDeviceList({ useCase: 'aviatrix', scale: 'small', siteCode: 'T' })
    expect(devices.every(d => d.vendor === 'Aviatrix')).toBe(true)
  })

  it('medium dc includes firewalls', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'firewall')).toBe(true)
  })
})

describe('buildBOM cost properties', () => {
  it('dc large costs more than dc small', () => {
    const small = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T' })
    const large = buildBOM({ useCase: 'dc', scale: 'large', siteCode: 'T' })
    expect(large.grandTotal).toBeGreaterThan(small.grandTotal)
  })

  it('grandTotal matches sum of all device unit prices', () => {
    const { devices, grandTotal } = buildBOM({ useCase: 'gpu', scale: 'medium', siteCode: 'T' })
    const manual = devices.reduce((s, d) => s + d.unitPrice, 0)
    expect(grandTotal).toBe(manual)
  })

  it('summary rows qty sums to device count', () => {
    const { devices, summary } = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T' })
    const totalQty = Object.values(summary).reduce((s, r) => s + r.qty, 0)
    expect(totalQty).toBe(devices.length)
  })

  it('each summary row totalCost equals qty * unitCost', () => {
    const { summary } = buildBOM({ useCase: 'dc', scale: 'large', siteCode: 'T' })
    Object.values(summary).forEach(r => {
      expect(r.totalCost).toBe(r.qty * r.unitCost)
    })
  })

  it('all use cases produce non-zero BOM at all scales', () => {
    const useCases = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix'] as const
    const scales   = ['small', 'medium', 'large'] as const
    for (const uc of useCases) {
      for (const sc of scales) {
        const { grandTotal } = buildBOM({ useCase: uc, scale: sc, siteCode: 'T' })
        expect(grandTotal).toBeGreaterThan(0)
      }
    }
  })
})
