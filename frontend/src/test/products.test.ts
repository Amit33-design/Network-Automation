import { describe, it, expect } from 'vitest'
import { PRODUCTS, productsByUseCase, LAYER_PAIRS } from '@/lib/products'

describe('PRODUCTS catalog', () => {
  it('has at least 17 products', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(17)
  })

  it('every product has required fields', () => {
    for (const p of PRODUCTS) {
      expect(p.id).toBeTruthy()
      expect(p.model).toBeTruthy()
      expect(p.vendor).toBeTruthy()
      expect(p.subLayer).toBeTruthy()
      expect(typeof p.priceUSD).toBe('number')
      expect(Array.isArray(p.useCases)).toBe(true)
      expect(Array.isArray(p.features)).toBe(true)
    }
  })

  it('productsByUseCase returns only matching products', () => {
    const dc = productsByUseCase('dc')
    expect(dc.length).toBeGreaterThan(0)
    dc.forEach(p => expect(p.useCases).toContain('dc'))
  })

  it('LAYER_PAIRS covers all use cases', () => {
    const useCases = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix']
    useCases.forEach(uc => {
      expect(LAYER_PAIRS).toHaveProperty(uc)
    })
  })
})
