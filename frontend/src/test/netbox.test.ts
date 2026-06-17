import { describe, it, expect, vi } from 'vitest'
import {
  normalizeVendor, roleToUseCase, orgSizeFromDeviceCount,
  fetchNetBoxInventory, summarizeInventory, inventoryToStorePatch,
  toImportedDevices, SAMPLE_INVENTORY,
  type NetBoxInventory,
} from '@/lib/netbox'

describe('normalizeVendor', () => {
  it('maps NetBox manufacturer names to app vendor labels', () => {
    expect(normalizeVendor('Cisco')).toBe('Cisco')
    expect(normalizeVendor('Arista Networks')).toBe('Arista')
    expect(normalizeVendor('Juniper Networks')).toBe('Juniper')
    expect(normalizeVendor('Dell EMC')).toBe('Dell EMC')
    expect(normalizeVendor('Dell Technologies')).toBe('Dell EMC')
    expect(normalizeVendor('Mellanox')).toBe('NVIDIA')
    expect(normalizeVendor('HPE-Aruba')).toBe('HPE Aruba')
    expect(normalizeVendor('Palo Alto Networks')).toBe('Palo Alto')
  })

  it('returns null for unknown or empty manufacturers', () => {
    expect(normalizeVendor('Frobozz Networking')).toBeNull()
    expect(normalizeVendor('')).toBeNull()
    expect(normalizeVendor(undefined)).toBeNull()
  })
})

describe('roleToUseCase', () => {
  it('maps device-role slugs to use cases', () => {
    expect(roleToUseCase('leaf')).toBe('dc')
    expect(roleToUseCase('spine')).toBe('dc')
    expect(roleToUseCase('Top of Rack')).toBe('dc')
    expect(roleToUseCase('access-switch')).toBe('campus')
    expect(roleToUseCase('gpu')).toBe('gpu')
    expect(roleToUseCase('edge router')).toBe('wan')
  })

  it('returns null for unknown roles', () => {
    expect(roleToUseCase('toaster')).toBeNull()
    expect(roleToUseCase('')).toBeNull()
  })
})

describe('orgSizeFromDeviceCount', () => {
  it('buckets device counts into OrgSize values', () => {
    expect(orgSizeFromDeviceCount(5)).toBe('startup')
    expect(orgSizeFromDeviceCount(50)).toBe('smb')
    expect(orgSizeFromDeviceCount(200)).toBe('midmarket')
    expect(orgSizeFromDeviceCount(1000)).toBe('enterprise')
    expect(orgSizeFromDeviceCount(5000)).toBe('hyperscale')
  })
})

describe('summarizeInventory', () => {
  it('summarizes the sample inventory', () => {
    const p = summarizeInventory(SAMPLE_INVENTORY)
    expect(p.orgName).toBe('Acme Corporation')
    expect(p.siteCount).toBe(2)
    expect(p.deviceCount).toBe(24)
    expect(p.orgSize).toBe('smb')
    expect(p.vendors).toContain('Cisco')
    expect(p.vendors).toContain('Arista')
    expect(p.useCaseHint).toBe('dc')
    expect(p.useCaseVotes).toBe(24)
  })

  it('falls back to first site name when no tenants exist', () => {
    const inv: NetBoxInventory = { sites: [{ name: 'HQ' }], devices: [], prefixes: [], tenants: [] }
    expect(summarizeInventory(inv).orgName).toBe('HQ')
  })

  it('supports the legacy device_role field (NetBox <3.6)', () => {
    const inv: NetBoxInventory = {
      sites: [], prefixes: [], tenants: [],
      devices: [{ name: 'sw1', device_role: { slug: 'access' } }],
    }
    expect(summarizeInventory(inv).useCaseHint).toBe('campus')
  })
})

describe('inventoryToStorePatch / toImportedDevices', () => {
  it('builds a store patch with normalized devices', () => {
    const patch = inventoryToStorePatch(SAMPLE_INVENTORY)
    expect(patch.orgName).toBe('Acme Corporation')
    expect(patch.numSites).toBe(2)
    expect(patch.orgSize).toBe('smb')
    expect(patch.vendorPrefs).toEqual(expect.arrayContaining(['Cisco', 'Arista']))
    expect(patch.netboxDevices).toHaveLength(24)
    const first = patch.netboxDevices[0]
    expect(first.name).toBe('IAD-SPINE-A01')
    expect(first.vendor).toBe('Cisco')
    expect(first.role).toBe('spine')
    expect(first.primaryIp).toBe('10.255.1.1/32')
  })

  it('omits fields the inventory cannot infer and skips unnamed devices', () => {
    const inv: NetBoxInventory = {
      sites: [], prefixes: [], tenants: [],
      devices: [{ name: null }, { name: 'sw1' }],
    }
    const patch = inventoryToStorePatch(inv)
    expect(patch.orgName).toBeUndefined()
    expect(patch.numSites).toBeUndefined()
    expect(patch.vendorPrefs).toBeUndefined()
    expect(toImportedDevices(inv)).toHaveLength(1)
  })
})

describe('fetchNetBoxInventory', () => {
  function mockFetch(routes: Record<string, unknown>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const key = Object.keys(routes).find(k => url.includes(k))
      if (!key) return { ok: false, status: 404, json: async () => ({}) } as Response
      return { ok: true, status: 200, json: async () => routes[key] } as Response
    }) as unknown as typeof fetch
  }

  it('fetches all four endpoints and sends the auth token', async () => {
    const fetchImpl = mockFetch({
      '/api/dcim/sites/': { count: 1, results: [{ name: 'HQ' }] },
      '/api/dcim/devices/': { count: 1, results: [{ name: 'sw1' }] },
      '/api/ipam/prefixes/': { count: 0, results: [] },
      '/api/tenancy/tenants/': { count: 0, results: [] },
    })
    const inv = await fetchNetBoxInventory('https://nb.example.com/', 'tok123', fetchImpl)
    expect(inv.sites).toHaveLength(1)
    expect(inv.devices[0].name).toBe('sw1')
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.some(c => String(c[0]).startsWith('https://nb.example.com/api/'))).toBe(true)
    expect(calls.every(c => (c[1] as RequestInit).headers
      && (c[1] as { headers: Record<string, string> }).headers.Authorization === 'Token tok123')).toBe(true)
  })

  it('paginates when count exceeds the page size', async () => {
    const page = (offset: number) => ({
      count: 450,
      results: Array.from({ length: Math.min(200, 450 - offset) }, (_, i) => ({ name: `d${offset + i}` })),
    })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/api/dcim/devices/')) return { ok: true, status: 200, json: async () => ({ count: 0, results: [] }) } as Response
      const offset = Number(new URL(url).searchParams.get('offset') ?? 0)
      return { ok: true, status: 200, json: async () => page(offset) } as Response
    }) as unknown as typeof fetch
    const inv = await fetchNetBoxInventory('https://nb.example.com', '', fetchImpl)
    expect(inv.devices).toHaveLength(450)
    expect(inv.devices[449].name).toBe('d449')
  })

  it('fails soft on prefixes/tenants but hard on devices', async () => {
    const fetchImpl = mockFetch({
      '/api/dcim/sites/': { count: 0, results: [] },
      '/api/dcim/devices/': { count: 0, results: [] },
      // prefixes + tenants 404 → caught, [] returned
    })
    const inv = await fetchNetBoxInventory('https://nb.example.com', '', fetchImpl)
    expect(inv.prefixes).toEqual([])
    expect(inv.tenants).toEqual([])

    const failing = mockFetch({ '/api/dcim/sites/': { count: 0, results: [] } })
    await expect(fetchNetBoxInventory('https://nb.example.com', '', failing)).rejects.toThrow()
  })
})
