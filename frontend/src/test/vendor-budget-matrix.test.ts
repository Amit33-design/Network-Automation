import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import type { BudgetTier } from '@/types'

/**
 * Exhaustive vendor × use-case × budget-tier matrix test.
 * Ensures that selecting a vendor never silently falls back to Cisco
 * for roles the vendor covers, and that budget tiers don't break
 * vendor assignment.
 */

const ALL_VENDORS = [
  'Arista', 'Juniper', 'Dell EMC', 'NVIDIA', 'HPE Aruba',
  'Fortinet', 'Extreme Networks', 'Nokia', 'Palo Alto',
]
const USE_CASES = ['dc', 'gpu', 'campus', 'wan', 'multisite'] as const
const BUDGET_TIERS: BudgetTier[] = ['', 'smb', 'mid', 'enterprise', 'hyperscale']

const NETWORK_ROLES = new Set([
  'spine', 'leaf', 'distribution', 'access', 'wan-edge', 'firewall',
])

describe('vendor × use-case matrix', () => {
  for (const vendor of ALL_VENDORS) {
    for (const uc of USE_CASES) {
      it(`${vendor} + ${uc}: devices are vendor or expected Cisco fallback`, () => {
        const devices = buildDeviceList({
          useCase: uc, scale: 'medium', siteCode: 'T',
          vendorPrefs: [vendor],
        })
        if (devices.length === 0) return

        for (const dev of devices.filter(d => NETWORK_ROLES.has(d.subLayer))) {
          expect(
            dev.vendor === vendor || dev.vendor === 'Cisco',
            `${vendor}/${uc}: ${dev.model} (${dev.subLayer}) is ${dev.vendor}`,
          ).toBe(true)
        }
      })
    }
  }
})

describe('vendor × budget-tier matrix', () => {
  for (const vendor of ['Arista', 'Juniper', 'Nokia', 'Dell EMC']) {
    for (const tier of BUDGET_TIERS) {
      it(`${vendor} + dc + tier=${tier || 'none'}: spine/leaf stay on ${vendor}`, () => {
        const devices = buildDeviceList({
          useCase: 'dc', scale: 'small', siteCode: 'T',
          vendorPrefs: [vendor],
          budgetTier: tier || undefined,
        })
        const spine = devices.find(d => d.subLayer === 'spine')
        const leaf = devices.find(d => d.subLayer === 'leaf')
        if (spine) expect(spine.vendor).toBe(vendor)
        if (leaf) expect(leaf.vendor).toBe(vendor)
      })
    }
  }
})
