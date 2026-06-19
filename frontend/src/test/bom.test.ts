import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM, SCALE_DEFS, alphaLabel, generateHostnames, GPUS_PER_SERVER } from '@/lib/bom'
import { haPairInfo } from '@/lib/configgen'
import type { BOMDevice } from '@/types'

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

describe('alphaLabel — bijective base-26 (no overflow past Z)', () => {
  it('maps single letters A–Z', () => {
    expect(alphaLabel(0)).toBe('A')
    expect(alphaLabel(25)).toBe('Z')
  })

  it('continues with AA, AB … beyond 26 (no ASCII symbols)', () => {
    expect(alphaLabel(26)).toBe('AA')
    expect(alphaLabel(27)).toBe('AB')
    expect(alphaLabel(51)).toBe('AZ')
    expect(alphaLabel(52)).toBe('BA')
  })

  it('only ever emits A–Z characters', () => {
    for (let i = 0; i < 1000; i++) {
      expect(alphaLabel(i)).toMatch(/^[A-Z]+$/)
    }
  })
})

describe('generateHostnames at large scale (regression: leaf > 52)', () => {
  function leaves(n: number): BOMDevice[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `l${i}`, hostname: '', vendor: 'Arista', model: '7050CX3-32S',
      role: 'leaf', subLayer: 'leaf', count: 1, ports: 32, speed: '100G',
      features: [], unitPrice: 1, totalPrice: 1,
    }))
  }

  it('produces only alphanumeric hostnames for 70 leaves (no [ \\ ] ^ _ )', () => {
    const named = generateHostnames(leaves(70), 'IAD')
    for (const d of named) {
      expect(d.hostname).toMatch(/^IAD-LEAF-[A-Z]+0[12]$/)
    }
  })

  it('uses AA label for the 27th pair (53rd device) instead of overflowing', () => {
    const named = generateHostnames(leaves(70), 'IAD')
    // pair 27 = devices index 52 (01) and 53 (02)
    expect(named[52].hostname).toBe('IAD-LEAF-AA01')
    expect(named[53].hostname).toBe('IAD-LEAF-AA02')
  })

  it('haPairInfo still resolves peer/domain for two-letter labels', () => {
    const named = generateHostnames(leaves(70), 'IAD')
    const primary = named[52] // IAD-LEAF-AA01
    const info = haPairInfo(primary, 52)
    expect(info.isPrimary).toBe(true)
    expect(info.peerHostname).toBe('IAD-LEAF-AA02')
    expect(info.domainId).toBe('IAD-LEAF-AA')
  })
})

describe('Clos spine count for high-density GPU fabrics', () => {
  it('NVIDIA 2048 GPUs @ 100G 1:1 oversub → 14 spines (not 3)', () => {
    // SN4600C leaf: 64 ports - 8 uplinks = 56 downlinks, 100G
    // SN5600 spine: 64 ports, 400G
    // rawLeaves = ceil(2048/56) = 37 → 38; capPerLeaf = 56*100 = 5600
    // rawUplinks = ceil(5600/1/400) = 14; spinesByFanout = ceil(38/64) = 1
    // spineCount = max(14, 1, 2) = 14
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(38)
    expect(spines.length).toBe(14)
  })

  it('Cisco 2048 GPUs @ 100G 1:1 oversub → 8 spines', () => {
    // NX-9332C leaf: 32-2 = 30 downlinks, 100G
    // NX-9364C spine: 64 ports, 400G
    // rawLeaves = ceil(2048/30) = 69 → 70; cap = 30*100 = 3000
    // rawUplinks = ceil(3000/1/400) = 8; fanout = ceil(70/64) = 2
    // spineCount = max(8, 2, 2) = 8
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(70)
    expect(spines.length).toBe(8)
  })

  it('Arista 2048 GPUs @ 100G 1:1 oversub → 8 spines', () => {
    // 7050CX3 leaf: 32-2 = 30 downlinks, 100G
    // 7800R3 spine: 48 ports, 400G
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['Arista'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(70)
    expect(spines.length).toBe(8)
  })

  it('3:1 oversub needs fewer spines than 1:1', () => {
    // Cisco NX-9332C/9364C: cap = 3000; rawUplinks = ceil(3000/3/400) = 3
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 3,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(3)
  })

  it('spine fan-out constraint applies when leaves exceed spine port count', () => {
    // With 70 Cisco leaves and 64-port spines, fan-out = ceil(70/64) = 2
    // With 25G BW and 3:1 oversub, rawUplinks = ceil(750/3/400) = 1
    // spineCount = max(1, 2, 2) = 2 (fan-out forces at least 2)
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '25G', oversubscription: 3,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(2)
  })

  it('smaller GPU fabric (256 GPUs) produces correct spine count at 1:1', () => {
    // NVIDIA SN4600C: downlinks = 56; leaves = ceil(256/56) = 5 → 6
    // cap = 56*100 = 5600; rawUplinks = ceil(5600/1/400) = 14
    // fanout = ceil(6/64) = 1; spines = max(14, 1, 2) = 14
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'medium', siteCode: 'GPU',
      totalEndpoints: 256, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(14)
  })
})

describe('GPU compute server injection', () => {
  it('adds compute servers when GPU use case has totalEndpoints', () => {
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'small', siteCode: 'IAD', totalEndpoints: 64,
    })
    const compute = devices.filter(d => d.subLayer === 'gpu-compute')
    expect(compute.length).toBe(Math.ceil(64 / GPUS_PER_SERVER)) // 8 servers
  })

  it('does not add compute servers when totalEndpoints is 0', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'small', siteCode: 'IAD' })
    const compute = devices.filter(d => d.subLayer === 'gpu-compute')
    expect(compute.length).toBe(0)
  })

  it('does not add compute servers for DC use case', () => {
    const devices = buildDeviceList({
      useCase: 'dc', scale: 'small', siteCode: 'IAD', totalEndpoints: 500,
    })
    const compute = devices.filter(d => d.subLayer === 'gpu-compute')
    expect(compute.length).toBe(0)
  })

  it('compute servers have sequential hostnames (not HA-paired)', () => {
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'small', siteCode: 'IAD', totalEndpoints: 24,
    })
    const compute = devices.filter(d => d.subLayer === 'gpu-compute')
    expect(compute.length).toBe(3) // 24/8 = 3
    expect(compute[0].hostname).toBe('IAD-GPU-001')
    expect(compute[1].hostname).toBe('IAD-GPU-002')
    expect(compute[2].hostname).toBe('IAD-GPU-003')
  })

  it('derives correct server count for large GPU fabric (2048 GPUs)', () => {
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'IAD',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const compute = devices.filter(d => d.subLayer === 'gpu-compute')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(compute.length).toBe(256) // 2048 / 8
    expect(leaves.length).toBeGreaterThan(0)
    expect(spines.length).toBeGreaterThanOrEqual(2)
  })

  it('compute servers included in BOM summary and grandTotal', () => {
    const { summary, grandTotal, devices } = buildBOM({
      useCase: 'gpu', scale: 'small', siteCode: 'IAD', totalEndpoints: 16,
    })
    const gpuRow = Object.values(summary).find(r => r.subLayer === 'gpu-compute')
    expect(gpuRow).toBeDefined()
    expect(gpuRow!.qty).toBe(2) // 16/8 = 2
    expect(gpuRow!.totalCost).toBe(gpuRow!.unitCost * gpuRow!.qty)
    const total = devices.reduce((s, d) => s + d.unitPrice, 0)
    expect(grandTotal).toBe(total)
  })
})
