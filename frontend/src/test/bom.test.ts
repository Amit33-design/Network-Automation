import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM, SCALE_DEFS } from '@/lib/bom'

describe('buildDeviceList', () => {
  it('returns correct device count for dc/small', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TST' })
    expect(devices.length).toBe(6) // 2 spine + 4 leaf
  })

  it('returns correct device count for gpu/large', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'large', siteCode: 'TST' })
    expect(devices.length).toBe(24) // 8 spine + 16 leaf
  })

  it('all devices have hostnames when siteCode given', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'IAD' })
    devices.forEach(d => {
      expect(d.hostname).toMatch(/^IAD-/)
    })
  })

  it('devices have positive prices', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'IAD' })
    devices.forEach(d => expect(d.unitPrice).toBeGreaterThan(0))
  })
})

describe('buildBOM', () => {
  it('grandTotal is sum of all device costs', () => {
    const { devices, grandTotal } = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'IAD' })
    const expected = devices.reduce((s, d) => s + d.unitPrice, 0)
    expect(grandTotal).toBe(expected)
  })

  it('summary rows match unique models', () => {
    const { summary } = buildBOM({ useCase: 'campus', scale: 'medium', siteCode: 'SJC' })
    const rows = Object.values(summary)
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach(r => {
      expect(r.qty).toBeGreaterThan(0)
      expect(r.totalCost).toBe(r.qty * r.unitCost)
    })
  })

  it('works for every use case at small scale', () => {
    const useCases = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix', 'oran'] as const
    for (const uc of useCases) {
      const { devices } = buildBOM({ useCase: uc, scale: 'small', siteCode: 'TST' })
      expect(devices.length).toBeGreaterThan(0)
    }
  })
})

describe('generateHostnames', () => {
  it('applies site code prefix', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'NYC' })
    devices.forEach(d => expect(d.hostname.startsWith('NYC-')).toBe(true))
  })

  it('uses SITE when siteCode is empty', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: '' })
    devices.forEach(d => expect(d.hostname.startsWith('SITE-')).toBe(true))
  })

  it('truncates site codes longer than 5 chars', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TOOLONGCODE' })
    devices.forEach(d => expect(d.hostname.startsWith('TOOOO-') || d.hostname.startsWith('TOOLO-')).toBe(true))
  })
})

describe('SCALE_DEFS', () => {
  it('all scales and use cases are defined', () => {
    const scales = ['small', 'medium', 'large'] as const
    const useCases = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix', 'oran'] as const
    for (const scale of scales) {
      for (const uc of useCases) {
        expect(SCALE_DEFS[scale][uc]).toBeDefined()
      }
    }
  })
})
