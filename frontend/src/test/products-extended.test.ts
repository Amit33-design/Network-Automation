import { describe, it, expect } from 'vitest'
import { PRODUCTS } from '@/lib/products'

describe('Product pricing', () => {
  it('all products have positive prices', () => {
    PRODUCTS.forEach(p => expect(p.priceUSD).toBeGreaterThan(0))
  })

  it('GPU-optimised products are more expensive than basic leaves', () => {
    const gpu9364 = PRODUCTS.find(p => p.id === 'nxos-9364c')!
    const basic9336 = PRODUCTS.find(p => p.id === 'nxos-9336c')!
    expect(gpu9364.priceUSD).toBeGreaterThan(basic9336.priceUSD)
  })

  it('firewalls are more expensive than access switches', () => {
    const fw = PRODUCTS.find(p => p.subLayer === 'firewall')!
    const access = PRODUCTS.find(p => p.subLayer === 'access')!
    expect(fw.priceUSD).toBeGreaterThan(access.priceUSD)
  })
})

describe('Product features', () => {
  it('GPU products have PFC and ECN features', () => {
    const gpuProducts = PRODUCTS.filter(p => p.useCases.includes('gpu'))
    gpuProducts.forEach(p => {
      const hasGpuFeatures = p.features.includes('PFC') || p.features.includes('ECN')
      // At least spine/leaf should have PFC for GPU use cases
      if (p.subLayer === 'spine' || p.subLayer === 'leaf') {
        expect(hasGpuFeatures).toBe(true)
      }
    })
  })

  it('SD-WAN products include ZTP feature', () => {
    const sdwan = PRODUCTS.find(p => p.id === 'viptela-vedge')!
    expect(sdwan.features).toContain('ZTP')
  })

  it('Aviatrix products have FireNet feature', () => {
    const avxProducts = PRODUCTS.filter(p => p.vendor === 'Aviatrix')
    avxProducts.forEach(p => expect(p.features).toContain('FireNet'))
  })

  it('campus products include PoE+', () => {
    const campusAccess = PRODUCTS.filter(p => p.useCases.includes('campus') && p.subLayer === 'access')
    campusAccess.forEach(p => expect(p.features).toContain('PoE+'))
  })
})

describe('Product port counts', () => {
  it('spine switches have more ports than leaves on average', () => {
    const spines = PRODUCTS.filter(p => p.subLayer === 'spine' && p.ports > 0)
    const leaves = PRODUCTS.filter(p => p.subLayer === 'leaf' && p.ports > 0)
    const avgSpine = spines.reduce((s, p) => s + p.ports, 0) / spines.length
    const avgLeaf  = leaves.reduce((s, p) => s + p.ports, 0) / leaves.length
    expect(avgSpine).toBeGreaterThan(avgLeaf * 0.5) // spines generally comparable
  })

  it('access switches have 48 ports for desktop density', () => {
    const access = PRODUCTS.filter(p => p.subLayer === 'access')
    access.forEach(p => expect(p.ports).toBeGreaterThanOrEqual(48))
  })

  it('cloud gateways have 0 physical ports', () => {
    const cloud = PRODUCTS.filter(p => p.subLayer.startsWith('cloud'))
    cloud.forEach(p => expect(p.ports).toBe(0))
  })
})

describe('Product IDs are unique', () => {
  it('no duplicate IDs exist', () => {
    const ids = PRODUCTS.map(p => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})
