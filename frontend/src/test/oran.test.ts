import { describe, it, expect } from 'vitest'
import { generateConfig } from '../lib/configgen'
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
