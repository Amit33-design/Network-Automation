import { describe, it, expect } from 'vitest'
import { buildDeviceList, computeTCO, DEFAULT_TCO_OPTS } from '@/lib/bom'
import type { BOMDevice } from '@/types'

function dev(partial: Partial<BOMDevice>): BOMDevice {
  return {
    id: 'nxos-93180yc-1',
    hostname: 'TST-LEAF-A01',
    role: 'leaf',
    subLayer: 'leaf',
    model: 'Nexus 93180YC-FX',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 14000,
    totalPrice: 14000,
    speed: '25G',
    ports: 48,
    uplinks: 6,
    features: [],
    ...partial,
  }
}

describe('computeTCO', () => {
  it('capex equals sum of device totalPrice', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TST' })
    const tco = computeTCO(devices)
    const expected = devices.reduce((s, d) => s + d.totalPrice, 0)
    expect(tco.capex).toBe(expected)
  })

  it('support cost = 15% × capex × 3 years by default', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TST' })
    const tco = computeTCO(devices)
    expect(tco.support).toBeCloseTo(tco.capex * 0.15 * 3, 6)
    expect(tco.annual.support).toBeCloseTo(tco.capex * 0.15, 6)
  })

  it('3-year total = capex + 3 × annual opex', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'SJC' })
    const tco = computeTCO(devices)
    expect(tco.total).toBeCloseTo(tco.capex + 3 * tco.annual.total, 6)
    expect(tco.opex).toBeCloseTo(tco.power + tco.support + tco.rackspace, 6)
  })

  it('power cost scales with aggregate powerW and the energy rate', () => {
    const devices = [dev({})] // single 480W leaf
    const tco = computeTCO(devices)
    const { pue, energyCostPerKwh } = DEFAULT_TCO_OPTS
    const expectedAnnualPower = ((480 * 24 * 365) / 1000) * pue * energyCostPerKwh
    expect(tco.totalPowerW).toBe(480)
    expect(tco.annual.power).toBeCloseTo(expectedAnnualPower, 6)
    // Doubling the energy rate doubles power cost.
    const tco2 = computeTCO(devices, { energyCostPerKwh: energyCostPerKwh * 2 })
    expect(tco2.annual.power).toBeCloseTo(tco.annual.power * 2, 6)
  })

  it('looks up powerW from PRODUCTS by model', () => {
    // Nexus 9336C-FX2 spine = 650W in PRODUCTS
    const spine = dev({ id: 'nxos-9336c-1', model: 'Nexus 9336C-FX2', subLayer: 'spine', unitPrice: 28000, totalPrice: 28000 })
    const tco = computeTCO([spine])
    expect(tco.totalPowerW).toBe(650)
  })

  it('falls back to a role default when model has no powerW match', () => {
    const unknown = dev({ id: 'mystery-box-1', model: 'Totally Unknown 9000', subLayer: 'spine' })
    const tco = computeTCO([unknown])
    expect(tco.totalPowerW).toBe(800) // ROLE_DEFAULT_POWER_W.spine
  })

  it('rack cost = RU × $/RU/mo × 12 × years', () => {
    // one spine (2RU) + one leaf (1RU) = 3RU
    const devices = [
      dev({ id: 'nxos-9336c-1', model: 'Nexus 9336C-FX2', subLayer: 'spine' }),
      dev({ id: 'nxos-93180yc-1', model: 'Nexus 93180YC-FX', subLayer: 'leaf' }),
    ]
    const tco = computeTCO(devices)
    expect(tco.totalRackUnits).toBe(3)
    expect(tco.annual.rackspace).toBeCloseTo(3 * 150 * 12, 6)
    expect(tco.rackspace).toBeCloseTo(3 * 150 * 12 * 3, 6)
  })

  it('respects configurable opts overrides', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TST' })
    const tco = computeTCO(devices, {
      supportRatePerYear: 0.2,
      years: 5,
      pue: 1.0,
      energyCostPerKwh: 0.1,
      rackCostPerRuMonth: 100,
    })
    expect(tco.byYear.length).toBe(5)
    expect(tco.support).toBeCloseTo(tco.capex * 0.2 * 5, 6)
    expect(tco.total).toBeCloseTo(tco.capex + 5 * tco.annual.total, 6)
    expect(tco.rates.years).toBe(5)
  })

  it('builds one byYear entry per modeled year with equal opex', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'TST' })
    const tco = computeTCO(devices)
    expect(tco.byYear.length).toBe(3)
    tco.byYear.forEach(y => {
      expect(y.total).toBeCloseTo(tco.annual.total, 6)
      expect(y.year).toBeGreaterThanOrEqual(1)
    })
  })

  it('empty device list → all zeros', () => {
    const tco = computeTCO([])
    expect(tco.capex).toBe(0)
    expect(tco.power).toBe(0)
    expect(tco.support).toBe(0)
    expect(tco.rackspace).toBe(0)
    expect(tco.opex).toBe(0)
    expect(tco.total).toBe(0)
    expect(tco.totalPowerW).toBe(0)
    expect(tco.totalRackUnits).toBe(0)
    expect(tco.byYear.every(y => y.total === 0)).toBe(true)
  })
})
