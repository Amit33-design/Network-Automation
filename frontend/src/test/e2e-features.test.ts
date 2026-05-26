/**
 * End-to-end feature verification — all 6 wizard steps tested programmatically.
 * No browser required: tests the business logic, library functions, and hook signatures.
 */
import { describe, it, expect } from 'vitest'
import { buildDeviceList, buildBOM } from '@/lib/bom'
import { generateConfig, generateAllConfigs } from '@/lib/configgen'
import { PRODUCTS, productsByUseCase, LAYER_PAIRS } from '@/lib/products'
import { formatUSD, formatUptime, downloadText } from '@/lib/utils'
import type { BOMDevice } from '@/types'

// ── Step 1: Use Case selection ────────────────────────────────────────────────

describe('Step 1 — Use Case selection', () => {
  const USE_CASES = ['campus','dc','gpu','wan','multisite','multicloud','aviatrix'] as const

  it('all 7 use cases are defined in LAYER_PAIRS', () => {
    for (const uc of USE_CASES) {
      expect(LAYER_PAIRS[uc], `${uc} missing from LAYER_PAIRS`).toBeDefined()
      expect(LAYER_PAIRS[uc].length).toBeGreaterThan(0)
    }
  })

  it('every use case has products in the catalog', () => {
    for (const uc of USE_CASES) {
      const prods = productsByUseCase(uc)
      expect(prods.length, `${uc} has no products`).toBeGreaterThan(0)
    }
  })

  it('products have all required fields', () => {
    for (const p of PRODUCTS) {
      expect(p.id).toBeTruthy()
      expect(p.model).toBeTruthy()
      expect(p.vendor).toBeTruthy()
      expect(p.priceUSD).toBeGreaterThan(0)
      expect(Array.isArray(p.features)).toBe(true)
      expect(Array.isArray(p.useCases)).toBe(true)
    }
  })
})

// ── Step 2: BOM generation ────────────────────────────────────────────────────

describe('Step 2 — BOM / design generation', () => {
  const USE_CASES = ['campus','dc','gpu','wan','multisite','multicloud','aviatrix'] as const
  const SCALES    = ['small','medium','large'] as const

  it('all 21 use-case/scale combos produce devices and non-zero cost', () => {
    for (const uc of USE_CASES) {
      for (const sc of SCALES) {
        const { devices, grandTotal } = buildBOM({ useCase: uc, scale: sc, siteCode: 'IAD' })
        expect(devices.length, `${uc}/${sc}: no devices`).toBeGreaterThan(0)
        expect(grandTotal, `${uc}/${sc}: zero cost`).toBeGreaterThan(0)
      }
    }
  })

  it('large scale always has more devices than small', () => {
    for (const uc of USE_CASES) {
      const small = buildDeviceList({ useCase: uc, scale: 'small', siteCode: 'T' })
      const large = buildDeviceList({ useCase: uc, scale: 'large', siteCode: 'T' })
      expect(large.length, `${uc}: large not > small`).toBeGreaterThan(small.length)
    }
  })

  it('hostnames are unique within a BOM', () => {
    for (const uc of USE_CASES) {
      const devices = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'IAD' })
      const names = devices.map(d => d.hostname)
      const unique = new Set(names)
      expect(unique.size, `${uc}: duplicate hostnames`).toBe(names.length)
    }
  })

  it('BOM summary totals match device list', () => {
    const { devices, summary, grandTotal } = buildBOM({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const summaryQty = Object.values(summary).reduce((s, r) => s + r.qty, 0)
    const summaryTotal = Object.values(summary).reduce((s, r) => s + r.totalCost, 0)
    expect(summaryQty).toBe(devices.length)
    expect(summaryTotal).toBe(grandTotal)
  })

  it('dc medium includes spines, leaves, and firewalls', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'spine')).toBe(true)
    expect(devices.some(d => d.subLayer === 'leaf')).toBe(true)
    expect(devices.some(d => d.subLayer === 'firewall')).toBe(true)
  })

  it('gpu fabric includes gpu-spine and gpu-leaf or spine/leaf', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'medium', siteCode: 'T' })
    const hasGpuLayers = devices.some(d => ['spine','leaf','gpu-spine','gpu-leaf'].includes(d.subLayer))
    expect(hasGpuLayers).toBe(true)
  })

  it('campus includes distribution and access', () => {
    const devices = buildDeviceList({ useCase: 'campus', scale: 'small', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'distribution')).toBe(true)
    expect(devices.some(d => d.subLayer === 'access')).toBe(true)
  })

  it('wan includes wan-edge devices', () => {
    const devices = buildDeviceList({ useCase: 'wan', scale: 'small', siteCode: 'T' })
    expect(devices.some(d => d.subLayer === 'wan-edge')).toBe(true)
  })
})

// ── Step 3: Config generation ─────────────────────────────────────────────────

describe('Step 3 — Config generation', () => {
  function dev(overrides: Partial<BOMDevice> = {}): BOMDevice {
    return {
      id: 'test-1', hostname: 'IAD-SPINE-A01', role: 'spine', subLayer: 'spine',
      model: 'Nexus 9336C-FX2', vendor: 'Cisco', count: 1,
      unitPrice: 28000, totalPrice: 28000, speed: '100G', ports: 36,
      features: ['BGP','VXLAN'], ...overrides,
    }
  }

  it('generates config for every vendor/role combination', () => {
    const combos = [
      { vendor: 'Cisco',    subLayer: 'spine'    },
      { vendor: 'Cisco',    subLayer: 'leaf'     },
      { vendor: 'Cisco',    subLayer: 'firewall' },
      { vendor: 'Cisco',    subLayer: 'wan-edge' },
      { vendor: 'Arista',   subLayer: 'spine'    },
      { vendor: 'Arista',   subLayer: 'leaf'     },
      { vendor: 'Juniper',  subLayer: 'leaf'     },
      { vendor: 'Palo Alto',subLayer: 'firewall' },
    ]
    for (const c of combos) {
      const cfg = generateConfig(dev(c), 0)
      expect(cfg.length, `${c.vendor}/${c.subLayer}: empty config`).toBeGreaterThan(100)
    }
  })

  it('generateAllConfigs keys match device IDs', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'small', siteCode: 'IAD' })
    const configs = generateAllConfigs(devices)
    for (const d of devices) {
      expect(configs[d.id], `missing config for ${d.hostname}`).toBeTruthy()
      expect(configs[d.id]).toContain(d.hostname)
    }
  })

  it('GPU use-case configs have PFC/ECN, standard DC does not', () => {
    const devices = buildDeviceList({ useCase: 'gpu', scale: 'small', siteCode: 'T' })
    const gpuConfigs = generateAllConfigs(devices, 'gpu')
    const dcDevices  = buildDeviceList({ useCase: 'dc',  scale: 'small', siteCode: 'T' })
    const dcConfigs  = generateAllConfigs(dcDevices, 'dc')

    const gpuSpine = devices.find(d => d.vendor === 'Cisco' && d.subLayer === 'spine')
    if (gpuSpine) expect(gpuConfigs[gpuSpine.id]).toContain('pause no-drop')

    const dcSpine = dcDevices.find(d => d.vendor === 'Cisco' && d.subLayer === 'spine')
    if (dcSpine) expect(dcConfigs[dcSpine.id]).not.toContain('pause no-drop')
  })

  it('no hardcoded secrets in any config for a dc/medium BOM', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' })
    const configs = generateAllConfigs(devices, 'dc')
    const BAD = [/NetDesign@Enable2024/, /NetDesign@TACACS2024/, /NetDesignNTP@2024/]
    for (const [id, cfg] of Object.entries(configs)) {
      for (const pat of BAD) {
        expect(cfg, `hardcoded secret in ${id}`).not.toMatch(pat)
      }
      expect(cfg, `no CHANGE-ME placeholder in ${id}`).toMatch(/<CHANGE-ME-/)
    }
  })
})

// ── Step 4: ZTP hooks wiring ──────────────────────────────────────────────────

describe('Step 4 — ZTP hooks (offline/mock)', () => {
  it('useRunZTP and useTopology hooks export correctly', async () => {
    const { useRunZTP } = await import('@/hooks/useZTP')
    const { useTopologySummary, useTopologyDevices } = await import('@/hooks/useTopology')
    expect(typeof useRunZTP).toBe('function')
    expect(typeof useTopologySummary).toBe('function')
    expect(typeof useTopologyDevices).toBe('function')
  })
})

// ── Step 5: Checks hooks wiring ───────────────────────────────────────────────

describe('Step 5 — Pre/Post checks hooks (offline/mock)', () => {
  it('useRunChecks hook exports correctly', async () => {
    const { useRunChecks } = await import('@/hooks/useChecks')
    expect(typeof useRunChecks).toBe('function')
  })
})

// ── Step 6: Monitor hooks wiring ──────────────────────────────────────────────

describe('Step 6 — Monitoring hooks (offline/mock)', () => {
  it('usePollMonitoring hook exports correctly', async () => {
    const { usePollMonitoring } = await import('@/hooks/useMonitoring')
    expect(typeof usePollMonitoring).toBe('function')
  })

  it('useAlerts hook exports correctly', async () => {
    const { useAlerts } = await import('@/hooks/useAlerts')
    expect(typeof useAlerts).toBe('function')
  })

  it('useRunRca hook exports correctly', async () => {
    const { useRunRca } = await import('@/hooks/useRca')
    expect(typeof useRunRca).toBe('function')
  })
})

// ── Utilities ─────────────────────────────────────────────────────────────────

describe('Utility functions', () => {
  it('formatUSD works correctly', () => {
    expect(formatUSD(0)).toBe('$0')
    expect(formatUSD(1000)).toBe('$1,000')
    expect(formatUSD(1234567)).toBe('$1,234,567')
  })

  it('formatUptime handles all ranges', () => {
    expect(formatUptime(45)).toContain('s')
    expect(formatUptime(3700)).toContain('h')
    expect(formatUptime(90000)).toContain('d')
  })

  it('downloadText is exported as a function', () => {
    expect(typeof downloadText).toBe('function')
  })
})

// ── App structure sanity ──────────────────────────────────────────────────────

describe('App structure', () => {
  it('all 6 page components export named functions', async () => {
    const pages = [
      ['@/pages/Step1UseCase', 'Step1UseCase'],
      ['@/pages/Step2Design',  'Step2Design'],
      ['@/pages/Step3Config',  'Step3Config'],
      ['@/pages/Step4ZTP',     'Step4ZTP'],
      ['@/pages/Step5Checks',  'Step5Checks'],
      ['@/pages/Step6Monitor', 'Step6Monitor'],
    ]
    for (const [mod, name] of pages) {
      const m = await import(mod)
      expect(typeof m[name], `${name} not exported`).toBe('function')
    }
  })

  it('all UI components export named functions', async () => {
    const components = [
      ['@/components/ui/Badge',  'Badge'],
      ['@/components/ui/Button', 'Button'],
      ['@/components/ui/Card',   'Card'],
      ['@/components/ui/Toast',  'ToastProvider'],
      ['@/components/AlertsPanel',      'AlertsPanel'],
      ['@/components/RcaPanel',         'RcaPanel'],
      ['@/components/LiveProgressFeed', 'LiveProgressFeed'],
      ['@/components/wizard/WizardNav', 'WizardNav'],
    ]
    for (const [mod, name] of components) {
      const m = await import(mod)
      expect(typeof m[name], `${name} not exported`).toBe('function')
    }
  })

  it('useAppStore exposes all wizard actions', async () => {
    const { useAppStore } = await import('@/store/useAppStore')
    const state = useAppStore.getState()
    const required = [
      'step','useCase','scale','redundancy','siteName','siteCode',
      'devices','configs','appTypes','compliance',
      'nextStep','prevStep','setStep','setUseCase','setScale',
      'setRedundancy','setSiteName','setSiteCode','setDevices','setConfigs','reset',
    ]
    for (const key of required) {
      expect(key in state, `missing store key: ${key}`).toBe(true)
    }
  })
})
