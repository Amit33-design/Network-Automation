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
