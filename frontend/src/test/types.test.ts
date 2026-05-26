import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import type { BOMDevice, UseCase } from '@/types'

// Verify runtime shape of BOMDevice matches the TypeScript interface
function assertBOMDevice(d: unknown): asserts d is BOMDevice {
  expect(d).toMatchObject({
    id: expect.any(String),
    hostname: expect.any(String),
    role: expect.any(String),
    subLayer: expect.any(String),
    model: expect.any(String),
    vendor: expect.any(String),
    count: expect.any(Number),
    unitPrice: expect.any(Number),
    totalPrice: expect.any(Number),
    speed: expect.any(String),
    ports: expect.any(Number),
    features: expect.any(Array),
  })
}

describe('BOMDevice runtime shape', () => {
  const useCases: UseCase[] = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix']

  useCases.forEach(uc => {
    it(`buildDeviceList for ${uc} produces valid BOMDevice objects`, () => {
      const devices = buildDeviceList({ useCase: uc, scale: 'small', siteCode: 'TST' })
      expect(devices.length).toBeGreaterThan(0)
      devices.forEach(assertBOMDevice)
    })
  })
})
