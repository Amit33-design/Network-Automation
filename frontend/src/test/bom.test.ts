import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM, buildCabling, buildOptics, SCALE_DEFS, alphaLabel, generateHostnames, GPUS_PER_SERVER, validateBOM, BUDGET_BANDS } from '@/lib/bom'
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
  it('NVIDIA 2048 GPUs @ 100G 1:1 oversub → 8 spines (uplink-capped)', () => {
    // SN4600C leaf: 64 ports - 8 uplinks = 56 downlinks, 100G
    // SN5600 spine: 64 ports, 400G
    // rawLeaves = ceil(2048/56) = 37 → 38; capPerLeaf = 56*100 = 5600
    // rawUplinks = ceil(5600/1/400) = 14 → capped at the SKU's 8 uplink ports
    // portSupply = ceil(38*8/64) = 5; spineCount = max(8, 5, 2) = 8
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(38)
    expect(spines.length).toBe(8)
  })

  it('Cisco 2048 GPUs @ 100G 1:1 oversub → 9 spines (port supply governs)', () => {
    // NX-9332C leaf: 32-8 = 24 downlinks, 100G
    // NX-9364C spine: 64 ports, 400G
    // rawLeaves = ceil(2048/24) = 86; cap = 24*100 = 2400
    // rawUplinks = ceil(2400/1/400) = 6 (≤ 8 SKU uplinks)
    // portSupply = ceil(86*6/64) = 9; spineCount = max(6, 9, 2) = 9
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(86)
    expect(spines.length).toBe(9)
  })

  it('Arista 2048 GPUs @ 100G 1:1 oversub → 11 spines (48-port spine)', () => {
    // 7050CX3 leaf: 32-8 = 24 downlinks, 100G
    // 7800R3 spine: 48 ports, 400G
    // rawUplinks = 6; portSupply = ceil(86*6/48) = 11 → max(6, 11, 2) = 11
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['Arista'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves.length).toBe(86)
    expect(spines.length).toBe(11)
  })

  it('3:1 oversub needs fewer spines than 1:1', () => {
    // Cisco NX-9332C (24 downlinks): cap = 2400; rawUplinks = ceil(2400/3/400) = 2
    // portSupply = ceil(86*2/64) = 3 → spineCount = max(2, 3, 2) = 3
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 3,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(3)
  })

  it('spine port-supply constraint applies when leaf uplinks exceed spine capacity', () => {
    // 86 Cisco leaves × 2 uplinks (25G/3:1 floor) = 172 links on 64-port
    // spines → ceil(172/64) = 3 spines (redundancy floor is 2)
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '25G', oversubscription: 3,
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(3)
  })

  it('smaller GPU fabric (256 GPUs) produces correct spine count at 1:1', () => {
    // NVIDIA SN4600C: downlinks = 56; leaves = ceil(256/56) = 5 → 6
    // cap = 56*100 = 5600; rawUplinks = ceil(5600/1/400) = 14 → capped at 8
    // portSupply = ceil(6*8/64) = 1; spines = max(8, 1, 2) = 8
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'medium', siteCode: 'GPU',
      totalEndpoints: 256, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(8)
  })

  it('leaf uplinks reflect bandwidth need, capped by the SKU', () => {
    // Cisco NX-9332C: rawUplinks = ceil(2400/1/400) = 6 ≤ 8 SKU ports → 6
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(9)
    expect(leaves[0].uplinks).toBe(6)
  })

  it('NVIDIA leaf uplinks capped at physical ports when spines exceed', () => {
    // SN4600C has 8 uplinks, 14 spines → uplinks = min(14, 8) = 8
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'medium', siteCode: 'GPU',
      totalEndpoints: 256, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    expect(leaves[0].uplinks).toBe(8)
  })

  it('leaf uplinks follow the bandwidth need at 3:1 (redundancy floor 2)', () => {
    // Cisco NX-9332C, 3:1 → rawUplinks = ceil(2400/3/400) = 2 → uplinks 2;
    // port supply ceil(86*2/64) = 3 spines
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 3,
    })
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(3)
    expect(leaves[0].uplinks).toBe(2)
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

describe('validateBOM — design validation', () => {
  function makeFabric(opts: {
    leafCount: number; leafPorts: number; leafUplinks: number; leafSpeed: string; leafModel: string;
    spineCount: number; spinePorts: number; spineSpeed: string; spineModel: string;
  }): BOMDevice[] {
    const devices: BOMDevice[] = []
    for (let i = 0; i < opts.leafCount; i++) {
      devices.push({
        id: `leaf-${i}`, hostname: `LF-${i}`, role: 'leaf', subLayer: 'leaf',
        model: opts.leafModel, vendor: 'Test', count: 1,
        unitPrice: 10000, totalPrice: 10000,
        speed: opts.leafSpeed, ports: opts.leafPorts, uplinks: opts.leafUplinks, features: [],
      })
    }
    for (let i = 0; i < opts.spineCount; i++) {
      devices.push({
        id: `spine-${i}`, hostname: `SP-${i}`, role: 'spine', subLayer: 'spine',
        model: opts.spineModel, vendor: 'Test', count: 1,
        unitPrice: 30000, totalPrice: 30000,
        speed: opts.spineSpeed, ports: opts.spinePorts, uplinks: 0, features: [],
      })
    }
    return devices
  }

  it('warns when uplinks needed exceed SKU physical uplinks', () => {
    // 30 downlinks * 100G / 1:1 / 400G = 8 uplinks needed, SKU has 2
    const devices = makeFabric({
      leafCount: 4, leafPorts: 32, leafUplinks: 2, leafSpeed: '100G', leafModel: 'NX-9332C',
      spineCount: 8, spinePorts: 64, spineSpeed: '400G', spineModel: 'NX-9364C',
    })
    const issues = validateBOM(devices, { bandwidthPerServer: '100G', oversubscription: 1 })
    const oversub = issues.find(i => i.category === 'oversubscription')
    expect(oversub).toBeTruthy()
    expect(oversub!.severity).toBe('warning')
    expect(oversub!.message).toContain('8 uplinks')
    expect(oversub!.message).toContain('has 2')
  })

  it('no oversubscription warning when uplinks sufficient', () => {
    // 56 downlinks * 25G / 3:1 / 400G = 1.17 → 2 uplinks, SKU has 8
    const devices = makeFabric({
      leafCount: 4, leafPorts: 64, leafUplinks: 8, leafSpeed: '100G', leafModel: 'SN4600C',
      spineCount: 2, spinePorts: 64, spineSpeed: '400G', spineModel: 'SN5600',
    })
    const issues = validateBOM(devices, { bandwidthPerServer: '25G', oversubscription: 3 })
    expect(issues.find(i => i.category === 'oversubscription')).toBeUndefined()
  })

  it('warns when leaves exceed spine port count', () => {
    const devices = makeFabric({
      leafCount: 70, leafPorts: 32, leafUplinks: 2, leafSpeed: '100G', leafModel: 'NX-9332C',
      spineCount: 8, spinePorts: 48, spineSpeed: '400G', spineModel: '7800R3',
    })
    const issues = validateBOM(devices)
    const fanout = issues.find(i => i.category === 'fan-out' && i.message.includes('70 leaves'))
    expect(fanout).toBeTruthy()
  })

  it('warns when spines exceed leaf uplink count', () => {
    const devices = makeFabric({
      leafCount: 4, leafPorts: 32, leafUplinks: 2, leafSpeed: '100G', leafModel: 'NX-9332C',
      spineCount: 8, spinePorts: 64, spineSpeed: '400G', spineModel: 'NX-9364C',
    })
    const issues = validateBOM(devices)
    const partial = issues.find(i => i.category === 'fan-out' && i.message.includes('8 spines'))
    expect(partial).toBeTruthy()
    expect(partial!.message).toContain('uplink count (2)')
  })

  it('errors when endpoints exceed total downlink capacity', () => {
    const devices = makeFabric({
      leafCount: 2, leafPorts: 32, leafUplinks: 2, leafSpeed: '100G', leafModel: 'NX-9332C',
      spineCount: 2, spinePorts: 64, spineSpeed: '400G', spineModel: 'NX-9364C',
    })
    const issues = validateBOM(devices, { totalEndpoints: 100 })
    const cap = issues.find(i => i.category === 'capacity' && i.severity === 'error')
    expect(cap).toBeTruthy()
    expect(cap!.message).toContain('100 endpoints')
    expect(cap!.message).toContain('60 ports')
  })

  it('info for heavily over-provisioned fabric', () => {
    const devices = makeFabric({
      leafCount: 10, leafPorts: 48, leafUplinks: 4, leafSpeed: '25G', leafModel: 'TestLeaf',
      spineCount: 4, spinePorts: 64, spineSpeed: '100G', spineModel: 'TestSpine',
    })
    const issues = validateBOM(devices, { totalEndpoints: 20 })
    const info = issues.find(i => i.category === 'capacity' && i.severity === 'info')
    expect(info).toBeTruthy()
    expect(info!.message).toContain('over-provisioned')
  })

  it('returns no issues for a well-sized fabric', () => {
    const devices = makeFabric({
      leafCount: 4, leafPorts: 48, leafUplinks: 6, leafSpeed: '25G', leafModel: 'TestLeaf',
      spineCount: 2, spinePorts: 64, spineSpeed: '100G', spineModel: 'TestSpine',
    })
    const issues = validateBOM(devices, {
      totalEndpoints: 100, bandwidthPerServer: '25G', oversubscription: 3,
    })
    expect(issues.filter(i => i.severity === 'error').length).toBe(0)
  })

  it('returns empty for no devices', () => {
    expect(validateBOM([])).toEqual([])
  })

  it('works with real buildDeviceList output (GPU 2048)', () => {
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const issues = validateBOM(devices, {
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const errors = issues.filter(i => i.severity === 'error')
    expect(errors.length).toBe(0)
    // NVIDIA SN4600C has 8 uplinks but needs 14 → should warn about oversub
    const oversubWarn = issues.find(i => i.category === 'oversubscription')
    expect(oversubWarn).toBeTruthy()
  })
})

describe('Port speed × GPU host count matrix', () => {
  // Cisco GPU defaults: NX-9332C leaf (32 ports, 2 uplinks, 100G), NX-9364C spine (64 ports, 400G)
  // downlinks = 30 per leaf; spinePortSpeed = 400G

  const scenarios: Array<{
    label: string; endpoints: number; bw: string; oversub: number;
    expectedLeaves: number; expectedSpines: number; expectedServers: number;
  }> = [
    // Cisco NX-9332C leaf: 24 downlinks / 8 uplink ports; NX-9364C spine: 64×400G.
    // spines = max(uplinksPerLeaf, ceil(leaves×uplinks / 64), 2)

    // 25G BW, 3:1 oversub (common enterprise) — uplinks floor at 2 for redundancy
    { label: '1024 GPU, 25G, 3:1', endpoints: 1024, bw: '25G', oversub: 3,
      expectedLeaves: 44, expectedSpines: 2, expectedServers: 128 },
    { label: '2048 GPU, 25G, 3:1', endpoints: 2048, bw: '25G', oversub: 3,
      expectedLeaves: 86, expectedSpines: 3, expectedServers: 256 },
    { label: '4096 GPU, 25G, 3:1', endpoints: 4096, bw: '25G', oversub: 3,
      expectedLeaves: 172, expectedSpines: 6, expectedServers: 512 },

    // 100G BW, 1:1 oversub (GPU/HPC) — rawUplinks = ceil(2400/400) = 6
    { label: '1024 GPU, 100G, 1:1', endpoints: 1024, bw: '100G', oversub: 1,
      expectedLeaves: 44, expectedSpines: 6, expectedServers: 128 },
    { label: '2048 GPU, 100G, 1:1', endpoints: 2048, bw: '100G', oversub: 1,
      expectedLeaves: 86, expectedSpines: 9, expectedServers: 256 },
    { label: '4096 GPU, 100G, 1:1', endpoints: 4096, bw: '100G', oversub: 1,
      expectedLeaves: 172, expectedSpines: 17, expectedServers: 512 },

    // 400G BW, 1:1 (ultra-high bandwidth) — wants 24 uplinks, capped at SKU's 8
    { label: '1024 GPU, 400G, 1:1', endpoints: 1024, bw: '400G', oversub: 1,
      expectedLeaves: 44, expectedSpines: 8, expectedServers: 128 },
    { label: '2048 GPU, 400G, 1:1', endpoints: 2048, bw: '400G', oversub: 1,
      expectedLeaves: 86, expectedSpines: 11, expectedServers: 256 },

    // 100G BW, 3:1 oversub (balanced) — rawUplinks = 2, port supply → 3
    { label: '2048 GPU, 100G, 3:1', endpoints: 2048, bw: '100G', oversub: 3,
      expectedLeaves: 86, expectedSpines: 3, expectedServers: 256 },
  ]

  for (const s of scenarios) {
    it(`${s.label} → ${s.expectedLeaves} leaves, ${s.expectedSpines} spines, ${s.expectedServers} servers`, () => {
      const devices = buildDeviceList({
        useCase: 'gpu', scale: 'large', siteCode: 'GPU',
        totalEndpoints: s.endpoints,
        bandwidthPerServer: s.bw,
        oversubscription: s.oversub,
      })
      const leaves = devices.filter(d => d.subLayer === 'leaf')
      const spines = devices.filter(d => d.subLayer === 'spine')
      const servers = devices.filter(d => d.subLayer === 'gpu-compute')

      expect(leaves.length).toBe(s.expectedLeaves)
      expect(spines.length).toBe(s.expectedSpines)
      expect(servers.length).toBe(s.expectedServers)
    })
  }

  it('higher BW always needs more or equal spines than lower BW', () => {
    const low = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '25G', oversubscription: 1,
    })
    const high = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
    })
    const lowSpines = low.filter(d => d.subLayer === 'spine').length
    const highSpines = high.filter(d => d.subLayer === 'spine').length
    expect(highSpines).toBeGreaterThanOrEqual(lowSpines)
  })

  it('NVIDIA vendor: 2048 GPU, 100G, 1:1 → 8 spines (denser leaf → fewer than Cisco 9)', () => {
    // SN4600C has 56 downlinks (vs Cisco 24) → 38 leaves instead of 86, so
    // the uplink cap (8) governs instead of spine port supply.
    const devices = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 1,
      vendorPrefs: ['NVIDIA'],
    })
    const spines = devices.filter(d => d.subLayer === 'spine')
    expect(spines.length).toBe(8)
  })

  it('leaf count is independent of bandwidth (only depends on endpoint count)', () => {
    const bw25 = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '25G', oversubscription: 3,
    })
    const bw100 = buildDeviceList({
      useCase: 'gpu', scale: 'large', siteCode: 'GPU',
      totalEndpoints: 2048, bandwidthPerServer: '100G', oversubscription: 3,
    })
    const leaves25 = bw25.filter(d => d.subLayer === 'leaf').length
    const leaves100 = bw100.filter(d => d.subLayer === 'leaf').length
    expect(leaves25).toBe(leaves100)
  })
})

describe('Endpoint-driven port-math for all use cases', () => {
  describe('campus', () => {
    it('access count scales with endpoints (Cat9200: 44 downlinks)', () => {
      const devices = buildDeviceList({
        useCase: 'campus', scale: 'medium', siteCode: 'SJC',
        totalEndpoints: 500,
      })
      const access = devices.filter(d => d.subLayer === 'access')
      // Cat9200: 48 ports - 4 uplinks = 44 downlinks
      // rawAccess = ceil(500/44) = 12 → 12 (even)
      expect(access.length).toBe(12)
    })

    it('distribution count scales with access count', () => {
      const devices = buildDeviceList({
        useCase: 'campus', scale: 'medium', siteCode: 'SJC',
        totalEndpoints: 2000,
      })
      const access = devices.filter(d => d.subLayer === 'access')
      const dist = devices.filter(d => d.subLayer === 'distribution')
      // rawAccess = ceil(2000/44) = 46 → 46
      expect(access.length).toBe(46)
      // Cat9500: 48-4=44 downlinks; rawDist = ceil(46/44) = 2 → 2
      expect(dist.length).toBeGreaterThanOrEqual(2)
    })

    it('more endpoints → more access switches', () => {
      const small = buildDeviceList({ useCase: 'campus', scale: 'small', siteCode: 'SJC', totalEndpoints: 100 })
      const large = buildDeviceList({ useCase: 'campus', scale: 'small', siteCode: 'SJC', totalEndpoints: 2000 })
      const smallAccess = small.filter(d => d.subLayer === 'access').length
      const largeAccess = large.filter(d => d.subLayer === 'access').length
      expect(largeAccess).toBeGreaterThan(smallAccess)
    })
  })

  describe('wan', () => {
    it('WAN edge count scales with endpoints', () => {
      const devices = buildDeviceList({
        useCase: 'wan', scale: 'medium', siteCode: 'WAN',
        totalEndpoints: 1000,
      })
      const wan = devices.filter(d => d.subLayer === 'wan-edge')
      expect(wan.length).toBeGreaterThanOrEqual(2)
    })

    it('more endpoints → more WAN routers', () => {
      const small = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'WAN', totalEndpoints: 100 })
      const large = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'WAN', totalEndpoints: 10000 })
      const smallWan = small.filter(d => d.subLayer === 'wan-edge').length
      const largeWan = large.filter(d => d.subLayer === 'wan-edge').length
      expect(largeWan).toBeGreaterThanOrEqual(smallWan)
    })

    it('always produces even WAN router count (HA pairs)', () => {
      const devices = buildDeviceList({
        useCase: 'wan', scale: 'small', siteCode: 'WAN',
        totalEndpoints: 500,
      })
      const wan = devices.filter(d => d.subLayer === 'wan-edge')
      expect(wan.length % 2).toBe(0)
    })
  })

  describe('multisite', () => {
    it('spine-leaf count derives from endpoints (like DC)', () => {
      const devices = buildDeviceList({
        useCase: 'multisite', scale: 'medium', siteCode: 'MSI',
        totalEndpoints: 500, bandwidthPerServer: '25G', oversubscription: 3,
      })
      const leaves = devices.filter(d => d.subLayer === 'leaf')
      const spines = devices.filter(d => d.subLayer === 'spine')
      const wan = devices.filter(d => d.subLayer === 'wan-edge')
      // NX-93180YC: 48-6=42 downlinks; rawLeaves = ceil(500/42) = 12
      expect(leaves.length).toBe(12)
      expect(spines.length).toBeGreaterThanOrEqual(2)
      expect(wan.length).toBeGreaterThanOrEqual(2)
    })

    it('more sites → more WAN edges', () => {
      const few = buildDeviceList({
        useCase: 'multisite', scale: 'medium', siteCode: 'MSI',
        totalEndpoints: 500, numSites: 2,
      })
      const many = buildDeviceList({
        useCase: 'multisite', scale: 'medium', siteCode: 'MSI',
        totalEndpoints: 500, numSites: 20,
      })
      const fewWan = few.filter(d => d.subLayer === 'wan-edge').length
      const manyWan = many.filter(d => d.subLayer === 'wan-edge').length
      expect(manyWan).toBeGreaterThanOrEqual(fewWan)
    })
  })

  describe('oran', () => {
    it('O-RU count matches endpoint count directly', () => {
      const devices = buildDeviceList({
        useCase: 'oran', scale: 'medium', siteCode: 'RAN',
        totalEndpoints: 100,
      })
      const ru = devices.filter(d => d.subLayer === 'oran-ru')
      expect(ru.length).toBe(100)
    })

    it('O-DU count = ceil(RU/3)', () => {
      const devices = buildDeviceList({
        useCase: 'oran', scale: 'medium', siteCode: 'RAN',
        totalEndpoints: 30,
      })
      const du = devices.filter(d => d.subLayer === 'oran-du')
      expect(du.length).toBe(10)
    })

    it('fronthaul switches scale with RU count', () => {
      const small = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: 'RAN', totalEndpoints: 10 })
      const large = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: 'RAN', totalEndpoints: 200 })
      const smallFh = small.filter(d => d.subLayer === 'oran-fronthaul').length
      const largeFh = large.filter(d => d.subLayer === 'oran-fronthaul').length
      expect(largeFh).toBeGreaterThan(smallFh)
    })

    it('all O-RAN roles present', () => {
      const devices = buildDeviceList({
        useCase: 'oran', scale: 'medium', siteCode: 'RAN',
        totalEndpoints: 50,
      })
      const roles = new Set(devices.map(d => d.subLayer))
      expect(roles.has('oran-cu')).toBe(true)
      expect(roles.has('oran-du')).toBe(true)
      expect(roles.has('oran-ru')).toBe(true)
      expect(roles.has('oran-fronthaul')).toBe(true)
      expect(roles.has('oran-midhaul')).toBe(true)
      expect(roles.has('oran-core')).toBe(true)
      expect(roles.has('oran-timing')).toBe(true)
    })
  })

  describe('multicloud / aviatrix', () => {
    it('gateway count scales with endpoints', () => {
      const devices = buildDeviceList({
        useCase: 'multicloud', scale: 'medium', siteCode: 'CLD',
        totalEndpoints: 2000,
      })
      const gw = devices.filter(d => d.subLayer === 'cloud-gw')
      // ceil(2000/500) = 4
      expect(gw.length).toBe(4)
    })

    it('transit count scales with numSites', () => {
      const devices = buildDeviceList({
        useCase: 'aviatrix', scale: 'medium', siteCode: 'AVX',
        totalEndpoints: 500, numSites: 5,
      })
      const transit = devices.filter(d => d.subLayer === 'cloud-transit')
      expect(transit.length).toBe(5)
    })
  })

  it('all use cases produce devices when totalEndpoints > 0', () => {
    const useCases = ['campus', 'dc', 'gpu', 'wan', 'multisite', 'multicloud', 'aviatrix', 'oran'] as const
    for (const uc of useCases) {
      const devices = buildDeviceList({
        useCase: uc, scale: 'medium', siteCode: 'TST',
        totalEndpoints: 500, numSites: 3,
      })
      expect(devices.length).toBeGreaterThan(0)
    }
  })
})

describe('budget-aware BOM', () => {
  it('SMB tier selects cheaper Cisco models for DC', () => {
    const smb = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'smb' })
    const enterprise = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'enterprise' })
    const smbSpine = smb.find(d => d.subLayer === 'spine')
    const entSpine = enterprise.find(d => d.subLayer === 'spine')
    expect(smbSpine!.unitPrice).toBeLessThan(entSpine!.unitPrice)
  })

  it('SMB tier selects cheaper leaf switches', () => {
    const smb = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'smb' })
    const leaf = smb.find(d => d.subLayer === 'leaf')
    expect(leaf!.unitPrice).toBeLessThanOrEqual(10000)
  })

  it('SMB BOM total is lower than enterprise for same topology', () => {
    const smb = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'smb' })
    const ent = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'enterprise' })
    expect(smb.grandTotal).toBeLessThan(ent.grandTotal)
  })

  it('mid tier selects intermediate pricing', () => {
    const smb = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'smb' })
    const mid = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'mid' })
    const ent = buildBOM({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'enterprise' })
    expect(mid.grandTotal).toBeGreaterThanOrEqual(smb.grandTotal)
    expect(mid.grandTotal).toBeLessThanOrEqual(ent.grandTotal)
  })

  it('SMB + vendor override selects budget-aware vendor models', () => {
    const smb = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'smb', vendorPrefs: ['Arista'] })
    const ent = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'enterprise', vendorPrefs: ['Arista'] })
    const smbTotal = smb.reduce((s, d) => s + d.unitPrice, 0)
    const entTotal = ent.reduce((s, d) => s + d.unitPrice, 0)
    expect(smbTotal).toBeLessThan(entTotal)
  })

  it('campus SMB uses cheaper firewall', () => {
    const smb = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', budgetTier: 'smb' })
    const ent = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', budgetTier: 'enterprise' })
    const smbFw = smb.find(d => d.subLayer === 'firewall')
    const entFw = ent.find(d => d.subLayer === 'firewall')
    expect(smbFw!.unitPrice).toBeLessThan(entFw!.unitPrice)
  })

  it('WAN SMB uses cheaper router', () => {
    const smb = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'T', budgetTier: 'smb' })
    const ent = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'T', budgetTier: 'enterprise' })
    const smbWan = smb.find(d => d.subLayer === 'wan-edge')
    const entWan = ent.find(d => d.subLayer === 'wan-edge')
    expect(smbWan!.unitPrice).toBeLessThan(entWan!.unitPrice)
  })

  it('no budget tier uses default (enterprise-grade) products', () => {
    const noBudget = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T' })
    const enterprise = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', budgetTier: 'enterprise' })
    const nbSpine = noBudget.find(d => d.subLayer === 'spine')
    const entSpine = enterprise.find(d => d.subLayer === 'spine')
    expect(nbSpine!.model).toBe(entSpine!.model)
  })

  it('BUDGET_BANDS defines sensible ceiling for each tier', () => {
    expect(BUDGET_BANDS.smb.maxUSD).toBeLessThan(BUDGET_BANDS.mid.maxUSD)
    expect(BUDGET_BANDS.mid.maxUSD).toBeLessThan(BUDGET_BANDS.enterprise.maxUSD)
    expect(BUDGET_BANDS.hyperscale.maxUSD).toBe(Infinity)
  })

  it('validateBOM flags budget exceeded for SMB with large topology', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'T', budgetTier: 'smb' })
    const issues = validateBOM(devices, { budgetTier: 'smb' })
    const budgetIssue = issues.find(i => i.category === 'budget')
    expect(budgetIssue).toBeDefined()
    expect(budgetIssue!.severity).toBe('error')
  })

  it('validateBOM does not flag budget for hyperscale', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'T', budgetTier: 'hyperscale' })
    const issues = validateBOM(devices, { budgetTier: 'hyperscale' })
    const budgetIssue = issues.find(i => i.category === 'budget')
    expect(budgetIssue).toBeUndefined()
  })

  it('Nokia vendor preference selects Nokia products', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Nokia'] })
    const spine = devices.find(d => d.subLayer === 'spine')
    const leaf = devices.find(d => d.subLayer === 'leaf')
    expect(spine!.vendor).toBe('Nokia')
    expect(leaf!.vendor).toBe('Nokia')
  })

  it('Juniper vendor preference populates campus/wan/firewall roles', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'] })
    const dist = devices.find(d => d.subLayer === 'distribution')
    const access = devices.find(d => d.subLayer === 'access')
    const fw = devices.find(d => d.subLayer === 'firewall')
    expect(dist!.vendor).toBe('Juniper')
    expect(access!.vendor).toBe('Juniper')
    expect(fw!.vendor).toBe('Juniper')
  })
})

// ── X7: optics BOM completeness / no double-counting ─────────────────────────

describe('buildOptics correctness (group X7)', () => {
  const DIST = { 'spine-leaf': 100, 'core-dist': 200, 'dist-access': 50, 'wan-edge': 5000 }

  it('DAC/AOC links carry NO separate optics (integrated transceivers)', () => {
    // 3m spine-leaf → selectCable picks DAC → optics for that link must be skipped
    const devices = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'X', totalEndpoints: 500, bandwidthPerServer: '25G', oversubscription: 3 })
    const shortDist = { ...DIST, 'spine-leaf': 3 }
    const cabling = buildCabling(devices, shortDist)
    const optics = buildOptics(devices, shortDist)
    const sl = cabling.find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')!
    expect(sl.cableType).toBe('DAC')
    expect(optics.find(o => o.linkGroup === 'spine → leaf')).toBeUndefined()
  })

  it('fiber links still get optics (2 per run) at 100m', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'X', totalEndpoints: 500, bandwidthPerServer: '25G', oversubscription: 3 })
    const cabling = buildCabling(devices, DIST)
    const optics = buildOptics(devices, DIST)
    const sl = cabling.find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')!
    const o = optics.find(x => x.linkGroup === 'spine → leaf')!
    expect(sl.cableType).toBe('MPO')
    expect(o.quantity).toBe(sl.quantity * 2)
  })

  it('40G firewall uplink fiber runs are no longer silently dropped', () => {
    // dc with firewalls: firewall→spine link runs at the FW speed (40G).
    const devices = buildDeviceList({ useCase: 'dc', scale: 'large', siteCode: 'X', totalEndpoints: 500, bandwidthPerServer: '25G', oversubscription: 3 })
    const fw = devices.find(d => d.subLayer === 'firewall')
    expect(fw).toBeTruthy()
    const cabling = buildCabling(devices, DIST)
    const fwLink = cabling.find(c => c.fromLayer === 'firewall')!
    const optics = buildOptics(devices, DIST)
    if (fwLink.cableType !== 'DAC' && fwLink.cableType !== 'AOC') {
      const o = optics.find(x => x.linkGroup.startsWith('firewall'))
      expect(o, `no optic for ${fwLink.speed} ${fwLink.cableType} firewall link`).toBeTruthy()
      expect(o!.quantity).toBe(fwLink.quantity * 2)
    }
  })
})

// ── Z2: BOM ↔ config physical honesty ────────────────────────────────────────

describe('BOM physical honesty (group Z2)', () => {
  const DIST = { 'spine-leaf': 100, 'core-dist': 200, 'dist-access': 50, 'wan-edge': 5000 }
  const DC = { useCase: 'dc' as const, scale: 'large' as const, siteCode: 'Z2', totalEndpoints: 500, bandwidthPerServer: '25G' as const, oversubscription: 3 }

  it('a link is billed at the SLOWER end, never the faster one', () => {
    const devices = buildDeviceList(DC)
    const spine = devices.find(d => d.subLayer === 'spine')!
    const leaf  = devices.find(d => d.subLayer === 'leaf')!
    const cabling = buildCabling(devices, DIST)
    const sl = cabling.find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')!
    const gbps = (s: string) => parseFloat(s)
    const leafUplink = leaf.uplinkSpeed ?? leaf.speed
    expect(gbps(sl.speed)).toBeLessThanOrEqual(gbps(spine.speed))
    expect(gbps(sl.speed)).toBeLessThanOrEqual(gbps(leafUplink))
    expect(sl.speed).toBe(gbps(spine.speed) <= gbps(leafUplink) ? spine.speed : leafUplink)
  })

  it('a leaf reaches the fabric on its UPLINK speed, not its host-port speed', () => {
    // 93180YC-FX: 48x25G host + 6x100G uplinks — the fabric link is 100G.
    const devices = buildDeviceList(DC)
    const leaf = devices.find(d => d.subLayer === 'leaf')!
    if (!leaf.uplinkSpeed) return          // SKU without a dedicated uplink block
    expect(leaf.uplinkSpeed).not.toBe(leaf.speed)
    const sl = buildCabling(devices, DIST).find(c => c.fromLayer === 'spine' && c.toLayer === 'leaf')!
    expect(sl.speed).not.toBe(leaf.speed)
  })

  it('optics fit the cage: no optic faster than either end of its link', () => {
    const devices = buildDeviceList(DC)
    const cabling = buildCabling(devices, DIST)
    const optics  = buildOptics(devices, DIST)
    for (const o of optics) {
      const link = cabling.find(c => `${c.fromLayer} → ${c.toLayer}` === o.linkGroup)!
      expect(o.speed).toBe(link.speed)
    }
  })

  it('HA peer-links are cabled (2 members per pair), not just configured', () => {
    const devices = buildDeviceList(DC)
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    const pairs = Math.floor(leaves.length / 2)
    expect(pairs).toBeGreaterThan(0)
    const peer = buildCabling(devices, DIST).find(c => c.fromLayer === 'leaf' && c.toLayer === 'leaf')
    expect(peer, 'leaf vPC/MLAG peer-link missing from cabling').toBeTruthy()
    expect(peer!.quantity).toBe(pairs * 2)
  })

  it('campus distribution peer-links are cabled too', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'medium', siteCode: 'Z2', totalEndpoints: 600 })
    const dists = devices.filter(d => d.subLayer === 'distribution')
    const peer = buildCabling(devices, DIST).find(c => c.fromLayer === 'distribution' && c.toLayer === 'distribution')
    if (dists.length >= 2) {
      expect(peer).toBeTruthy()
      expect(peer!.quantity).toBe(Math.floor(dists.length / 2) * 2)
    }
  })

  it('host links never exceed leaf downlink supply OR server NIC supply', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'medium', siteCode: 'Z2', totalEndpoints: 512, bandwidthPerServer: '400G', oversubscription: 1 })
    const leaves = devices.filter(d => d.subLayer === 'leaf')
    const hosts  = devices.filter(d => d.subLayer === 'compute' || d.role === 'gpu-compute')
    expect(hosts.length).toBeGreaterThan(0)
    const link = buildCabling(devices, DIST).find(c => c.toLayer === 'gpu-compute' || c.fromLayer === 'gpu-compute')!
    const leafSupply = leaves.reduce((s, d) => s + (d.ports - (d.uplinks ?? 0)), 0)
    const nicSupply  = hosts.reduce((s, d) => s + Math.max(1, d.ports || 1), 0)
    expect(link.quantity).toBeLessThanOrEqual(leafSupply)
    expect(link.quantity).toBeLessThanOrEqual(nicSupply)
    expect(link.quantity).toBe(Math.min(leafSupply, nicSupply))
  })

  it('validateBOM ERRORS when firewall handoffs do not fit the border-leaf port budget', () => {
    // Hand-built: an 8-port border leaf whose 4 uplinks + peer-link leave 2
    // host ports cannot terminate 4 firewall handoffs — the generator would
    // silently drop the extras while the BOM still bills the cables (Z2/Z3).
    const mk = (over: Partial<BOMDevice>): BOMDevice => ({
      id: over.id!, hostname: over.hostname ?? over.id!, role: over.role ?? '', subLayer: over.subLayer!,
      model: over.model ?? 'M', vendor: over.vendor ?? 'Cisco', count: 1, unitPrice: 1000, totalPrice: 1000,
      speed: over.speed ?? '100G', ports: over.ports ?? 36, uplinks: over.uplinks, features: [],
    })
    const devices: BOMDevice[] = [
      ...Array.from({ length: 2 }, (_, i) => mk({ id: `sp${i}`, subLayer: 'spine', ports: 36 })),
      ...Array.from({ length: 4 }, (_, i) => mk({ id: `lf${i}`, subLayer: 'leaf', ports: 8, uplinks: 4 })),
      ...Array.from({ length: 4 }, (_, i) => mk({ id: `fw${i}`, subLayer: 'firewall', ports: 8, speed: '40G' })),
    ]
    const issues = validateBOM(devices, { useCase: 'dc', totalEndpoints: 500 })
    const err = issues.find(i => i.severity === 'error' && /firewall handoff/i.test(i.message))
    expect(err, `expected a firewall port-budget error, got: ${issues.map(i => i.message).join(' | ')}`).toBeTruthy()
  })

  it('firewalls are cabled to the BORDER LEAVES, never to the spines (Z3)', () => {
    const devices = buildDeviceList(DC)
    expect(devices.some(d => d.subLayer === 'firewall')).toBe(true)
    const cabling = buildCabling(devices, DIST)
    expect(cabling.find(c => c.fromLayer === 'firewall' && c.toLayer === 'spine')).toBeUndefined()
    const fwLeaf = cabling.find(c => c.fromLayer === 'firewall' && c.toLayer === 'leaf')!
    expect(fwLeaf).toBeTruthy()
    const fwCount = devices.filter(d => d.subLayer === 'firewall').length
    expect(fwLeaf.quantity).toBe(fwCount * 2)   // 2 border leaves, not every leaf
  })
})
