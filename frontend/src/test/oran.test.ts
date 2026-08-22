import { describe, it, expect } from 'vitest'
import {
  generateConfig, generateAllConfigs,
  ORAN_FRONTHAUL_VLAN, ORAN_PTP_VLAN, ORAN_MGMT_VLAN, ORAN_PTP_DOMAIN,
} from '../lib/configgen'
import { buildDeviceList, buildBOM } from '../lib/bom'
import { PRODUCTS } from '../lib/products'
import type { BOMDevice } from '@/types'

function makeOranDevice(subLayer: string, model: string, vendor: string, idx: number): BOMDevice {
  return {
    id: `${subLayer}-${idx}`,
    hostname: `5G1-${subLayer.toUpperCase()}-${idx + 1}`,
    vendor,
    model,
    role: 'O-RAN',
    subLayer,
    count: 1,
    ports: 4,
    speed: '25G',
    features: ['eCPRI', 'PTP', '5G-NR'],
    unitPrice: 10000,
    totalPrice: 10000,
  }
}

describe('G-A10 — Private 5G / O-RAN use case', () => {
  describe('BOM generation', () => {
    it('builds O-RAN device list at small scale', () => {
      const devices = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: '5G1' })
      expect(devices.length).toBeGreaterThan(0)
      // small: 1 CU + 2 DU + 4 RU + 1 FH + 1 MH + 1 core + 1 timing = 11
      expect(devices.length).toBe(11)
    })

    it('includes all O-RAN sub-layers', () => {
      const devices = buildDeviceList({ useCase: 'oran', scale: 'medium', siteCode: '5G1' })
      const subLayers = new Set(devices.map(d => d.subLayer))
      expect(subLayers).toContain('oran-cu')
      expect(subLayers).toContain('oran-du')
      expect(subLayers).toContain('oran-ru')
      expect(subLayers).toContain('oran-fronthaul')
      expect(subLayers).toContain('oran-midhaul')
      expect(subLayers).toContain('oran-core')
      expect(subLayers).toContain('oran-timing')
    })

    it('scales up RU count from small to large', () => {
      const small = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: '5G1' })
      const large = buildDeviceList({ useCase: 'oran', scale: 'large', siteCode: '5G1' })
      const smallRu = small.filter(d => d.subLayer === 'oran-ru').length
      const largeRu = large.filter(d => d.subLayer === 'oran-ru').length
      expect(largeRu).toBeGreaterThan(smallRu)
    })

    it('assigns O-RAN role codes in hostnames', () => {
      const devices = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: 'NYC' })
      const ru = devices.find(d => d.subLayer === 'oran-ru')
      expect(ru?.hostname).toMatch(/^NYC-ORU-/)
    })

    it('grandTotal sums device costs for O-RAN', () => {
      const { devices, grandTotal } = buildBOM({ useCase: 'oran', scale: 'small', siteCode: '5G1' })
      const expected = devices.reduce((s, d) => s + d.unitPrice, 0)
      expect(grandTotal).toBe(expected)
    })
  })

  describe('Product catalog', () => {
    it('has O-RAN products for the oran use case', () => {
      const oranProducts = PRODUCTS.filter(p => p.useCases.includes('oran'))
      expect(oranProducts.length).toBeGreaterThanOrEqual(7)
    })

    it('includes a PTP grandmaster timing product', () => {
      const gm = PRODUCTS.find(p => p.subLayer === 'oran-timing')
      expect(gm).toBeDefined()
      expect(gm?.features).toContain('PTP')
      expect(gm?.features).toContain('IEEE-1588')
    })
  })

  describe('O-CU config', () => {
    const cfg = generateConfig(makeOranDevice('oran-cu', 'O-CU Server', 'Dell EMC', 0), 0, 'oran')

    it('includes F1 and E1 interfaces', () => {
      expect(cfg).toContain('f1-c')
      expect(cfg).toContain('e1')
      expect(cfg).toContain('sctp-port 38472')
    })

    it('includes NG interface to 5GC AMF', () => {
      expect(cfg).toContain('ng-c')
      expect(cfg).toContain('amf-address')
    })

    it('includes PTP G.8275.1 timing', () => {
      expect(cfg).toContain('profile g8275.1')
      expect(cfg).toContain('domain 24')
    })

    it('uses CHANGE-ME placeholders for PLMN', () => {
      expect(cfg).toContain('<CHANGE-ME-mcc>')
      expect(cfg).toContain('<CHANGE-ME-mnc>')
    })
  })

  describe('O-DU config', () => {
    const cfg = generateConfig(makeOranDevice('oran-du', 'O-DU Server', 'Dell EMC', 0), 0, 'oran')

    it('includes eCPRI fronthaul with 7.2x split', () => {
      expect(cfg).toContain('ecpri')
      expect(cfg).toContain('7.2x')
      expect(cfg).toContain('block-floating-point')
    })

    it('includes NR cell config with n78 band', () => {
      expect(cfg).toContain('band n78')
      expect(cfg).toContain('tdd')
    })

    it('includes L1 offload / real-time processing', () => {
      expect(cfg).toContain('l1-offload')
      expect(cfg).toContain('fapi-interface')
    })

    it('includes PTP timing', () => {
      expect(cfg).toContain('g8275.1')
    })
  })

  describe('O-RU config', () => {
    const cfg = generateConfig(makeOranDevice('oran-ru', 'O-RU Radio', 'Fujitsu', 0), 0, 'oran')

    it('includes radio config with 64T64R MIMO', () => {
      expect(cfg).toContain('64T64R')
      expect(cfg).toContain('beamforming')
    })

    it('includes eCPRI to DU', () => {
      expect(cfg).toContain('ecpri')
      expect(cfg).toContain('block-floating-point')
    })

    it('includes PTP slave timing', () => {
      expect(cfg).toContain('clock-class slave-only')
    })

    it('includes ZTP bootstrap', () => {
      expect(cfg).toContain('ztp')
      expect(cfg).toContain('dhcp-vendor-class')
    })
  })

  describe('Fronthaul switch config', () => {
    const cfg = generateConfig(makeOranDevice('oran-fronthaul', 'N9K-93180YC-FX3', 'Cisco', 0), 0, 'oran')

    it('configures PTP transparent-clock', () => {
      expect(cfg).toContain('ptp mode transparent')
      expect(cfg).toContain('ptp profile g8275.1')
    })

    it('includes eCPRI Class C7 QoS', () => {
      expect(cfg).toContain('CM-ECPRI')
      expect(cfg).toContain('PM-FRONTHAUL')
    })

    it('enables PFC and jumbo MTU', () => {
      expect(cfg).toContain('priority-flow-control mode on')
      expect(cfg).toContain('mtu 9216')
    })
  })

  describe('Midhaul router config', () => {
    const cfg = generateConfig(makeOranDevice('oran-midhaul', 'ASR 9901', 'Cisco', 0), 0, 'oran')

    it('configures PTP boundary-clock', () => {
      expect(cfg).toContain('ptp clock boundary')
    })

    it('includes IS-IS + segment routing transport', () => {
      expect(cfg).toContain('router isis XHAUL')
      expect(cfg).toContain('segment-routing mpls')
    })

    it('includes SyncE frequency synchronization', () => {
      expect(cfg).toContain('frequency synchronization')
    })

    it('includes model-driven telemetry', () => {
      expect(cfg).toContain('telemetry model-driven')
    })
  })

  describe('5G Core UPF config', () => {
    const cfg = generateConfig(makeOranDevice('oran-core', '5G Core UPF', 'Dell EMC', 0), 0, 'oran')

    it('includes N3/N6/N9/N4 interfaces', () => {
      expect(cfg).toContain('n3:')
      expect(cfg).toContain('n6:')
      expect(cfg).toContain('n4:')
      expect(cfg).toContain('gtp-u-port 2152')
    })

    it('includes DPDK / SmartNIC offload', () => {
      expect(cfg).toContain('dpdk')
      expect(cfg).toContain('gtp-u-decap')
    })

    it('includes 5QI QoS enforcement', () => {
      expect(cfg).toContain('5qi-to-dscp')
    })
  })

  describe('PTP Grandmaster config', () => {
    const cfg = generateConfig(makeOranDevice('oran-timing', 'Calnex PTP GM', 'Calnex', 0), 0, 'oran')

    it('includes GNSS receiver config', () => {
      expect(cfg).toContain('gnss:')
      expect(cfg).toContain('constellation')
    })

    it('configures grandmaster clock-class', () => {
      expect(cfg).toContain('clock-class grandmaster')
      expect(cfg).toContain('time-source gps')
    })

    it('includes SyncE PRC', () => {
      expect(cfg).toContain('synce')
      expect(cfg).toContain('quality-level prc')
    })
  })

  describe('end-to-end config generation', () => {
    it('generates a non-empty config for every O-RAN device', () => {
      const devices = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: '5G1' })
      devices.forEach((dev, i) => {
        const cfg = generateConfig(dev, i, 'oran')
        expect(cfg.length).toBeGreaterThan(100)
        expect(cfg).toContain(dev.hostname)
      })
    })

    it('never emits hardcoded credentials', () => {
      const devices = buildDeviceList({ useCase: 'oran', scale: 'small', siteCode: '5G1' })
      devices.forEach((dev, i) => {
        const cfg = generateConfig(dev, i, 'oran')
        // any password/secret reference must be a placeholder
        const pwLines = cfg.split('\n').filter(l => /password|secret|community/i.test(l))
        pwLines.forEach(l => expect(l).toContain('<CHANGE-ME'))
      })
    })
  })
})

// ── AD1: fronthaul coherence + cell identity ─────────────────────────────────
// A 5th-pass audit dumped a 41-device O-RAN design and reviewed the configs.
// The fronthaul — the defining link of the architecture — was broken by
// construction, and 24 radios were byte-identical apart from their hostname.
describe('AD1 — O-RAN fabric coherence', () => {
  const design = (endpoints = 24) => {
    const devices = buildDeviceList({
      useCase: 'oran', scale: 'medium', siteCode: 'AUD', totalEndpoints: endpoints,
    })
    const configs = generateAllConfigs(devices, 'oran')
    return { devices, configs, byRole: (r: string) => devices.filter(d => d.subLayer === r) }
  }
  const cfgOf = (d: { devices: BOMDevice[]; configs: Record<string, string> }, dev: BOMDevice) =>
    d.configs[dev.id] ?? ''

  it('puts every device on ONE fronthaul VLAN', () => {
    // Was `idx + 100` — the switch's GLOBAL device index — so the two
    // fronthaul switches at one site came out as VLAN 134 and 135, and a
    // radio homed to one could not reach a DU behind the other. The radios
    // and DUs meanwhile carried a <CHANGE-ME-ecpri-vlan> placeholder, so
    // nothing reconciled the two ends.
    const d = design()
    const seen = new Set<string>()
    for (const cfg of Object.values(d.configs)) {
      for (const re of [/vlan-id (\d+)/g, /^vlan (\d+)$/gm, /ptp vlan (\d+)/g]) {
        for (const m of cfg.matchAll(re)) {
          // PTP and mgmt VLANs are separate services, not fronthaul
          if (m[1] !== String(ORAN_PTP_VLAN) && m[1] !== String(ORAN_MGMT_VLAN)) seen.add(m[1])
        }
      }
    }
    expect([...seen], 'the fronthaul is one broadcast domain').toEqual([String(ORAN_FRONTHAUL_VLAN)])
  })

  it('trunks the fronthaul VLAN on every fronthaul switch', () => {
    const d = design()
    const switches = d.byRole('oran-fronthaul')
    expect(switches.length).toBeGreaterThan(1)
    for (const sw of switches) {
      const cfg = cfgOf(d, sw)
      expect(cfg, sw.hostname).toContain(`switchport trunk allowed vlan ${ORAN_FRONTHAUL_VLAN},`)
      expect(cfg, sw.hostname).toContain(`vlan ${ORAN_FRONTHAUL_VLAN}`)
    }
  })

  it('gives every radio a distinct, in-range PCI', () => {
    const d = design()
    const rus = d.byRole('oran-ru')
    expect(rus.length).toBe(24)
    const pcis = rus.map(r => Number(/^pci (\d+)$/m.exec(cfgOf(d, r))?.[1]))
    expect(pcis.every(n => Number.isInteger(n) && n >= 0 && n < 1008)).toBe(true)
    expect(new Set(pcis).size, 'PCI collision — the classic 5G RAN outage').toBe(rus.length)
    // PCI mod 3 sets the SSB shift, so neighbours must not share one.
    for (let i = 1; i < pcis.length; i++) {
      expect(pcis[i] % 3, `RU ${i} and ${i - 1} share an SSB shift`).not.toBe(pcis[i - 1] % 3)
    }
  })

  it('no longer emits 24 identical radios', () => {
    const d = design()
    const bodies = d.byRole('oran-ru').map(r => cfgOf(d, r).replace(new RegExp(r.hostname, 'g'), ''))
    expect(new Set(bodies).size, 'radios differ only by hostname').toBe(bodies.length)
  })

  it('homes each DU to a real CU at that CU own F1 address', () => {
    const d = design()
    const cus = d.byRole('oran-cu')
    const dus = d.byRole('oran-du')
    expect(cus.length).toBe(2)
    const cuF1c = cus.map(c => /^  local-address (\S+)$/m.exec(cfgOf(d, c))?.[1])
    const homed = dus.map(du => /cu-address (\S+)/.exec(cfgOf(d, du))?.[1])
    for (const h of homed) expect(cuF1c, 'DU points at an address no CU owns').toContain(h)
    // and the DUs are spread over the CUs rather than all piled on one
    expect(new Set(homed).size).toBe(cus.length)
  })

  it('scopes gnb ids to their tier, not the whole BOM', () => {
    // Two CUs precede the DUs in the BOM, so a global index started the DU
    // ids at 3 and shifted them whenever the BOM composition changed.
    const d = design()
    const ids = (role: string, key: string) => d.byRole(role)
      .map(x => Number(new RegExp(`^${key} (\\d+)$`, 'm').exec(cfgOf(d, x))?.[1]))
      .sort((a, b) => a - b)
    expect(ids('oran-cu', 'gnb-cu-id')).toEqual([1, 2])
    expect(ids('oran-du', 'gnb-du-id')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('gives every radio and DU its own fronthaul address', () => {
    const d = design()
    const addrs = [...d.byRole('oran-ru'), ...d.byRole('oran-du')]
      .map(x => /^  local-address (\S+)$/m.exec(cfgOf(d, x))?.[1])
      .filter(Boolean)
    expect(addrs.length).toBe(32)
    expect(new Set(addrs).size, 'duplicate fronthaul address').toBe(addrs.length)
    expect(addrs.some(a => a!.includes('CHANGE-ME'))).toBe(false)
  })

  it('agrees on one PTP domain fleet-wide', () => {
    const d = design()
    const domains = new Set(
      Object.values(d.configs).flatMap(c => [...c.matchAll(/domain (\d+)/g)].map(m => m[1])))
    expect([...domains]).toEqual([String(ORAN_PTP_DOMAIN)])
  })

  it('keeps every address inside a valid octet at scale', () => {
    // The Z7 overflow class: 240 radios must not produce 10.242.128.256.
    const d = design(240)
    for (const [id, cfg] of Object.entries(d.configs)) {
      for (const m of cfg.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
        for (const oct of m.slice(1)) {
          expect(Number(oct), `${id}: invalid IP ${m[0]}`).toBeLessThanOrEqual(255)
        }
      }
    }
  })
})
