import { describe, it, expect } from 'vitest'
import {
  buildContainerlabTopology,
  topologyToYAML,
  generateStartupConfigs,
  containerlabReadme,
} from '@/lib/containerlab'
import type { BOMDevice, CableLink } from '@/types'

const leaf = (hostname: string, vendor = 'Cisco', count = 1): BOMDevice => ({
  id: hostname,
  hostname,
  role: 'leaf',
  subLayer: 'leaf',
  model: 'N9K-C93180YC-EX',
  vendor,
  count,
  unitPrice: 20000,
  totalPrice: 20000 * count,
  speed: '25G',
  ports: 48,
  uplinks: 6,
  features: [],
})

const spine = (hostname: string, vendor = 'Cisco', count = 1): BOMDevice => ({
  id: hostname,
  hostname,
  role: 'spine',
  subLayer: 'spine',
  model: 'N9K-C9364C',
  vendor,
  count,
  unitPrice: 40000,
  totalPrice: 40000 * count,
  speed: '100G',
  ports: 64,
  features: [],
})

const cable = (from: string, to: string, qty = 1): CableLink => ({
  id: `${from}-${to}`,
  fromLayer: 'leaf',
  toLayer: 'spine',
  fromDevice: from,
  toDevice: to,
  cableType: 'DAC',
  speed: '100G',
  lengthM: 3,
  quantity: qty,
  pricePerUnit: 50,
  totalPrice: 50 * qty,
})

describe('containerlab', () => {
  describe('buildContainerlabTopology', () => {
    it('creates nodes from single-count devices', () => {
      const devices = [leaf('LEAF-01'), spine('SPINE-01')]
      const topo = buildContainerlabTopology(devices, [], {}, 'test-lab')
      expect(topo.nodes).toHaveLength(2)
      expect(topo.nodes[0].name).toBe('leaf-01')
      expect(topo.nodes[1].name).toBe('spine-01')
    })

    it('expands multi-count devices with suffixes', () => {
      const devices = [leaf('LEAF', 'Cisco', 3)]
      const topo = buildContainerlabTopology(devices, [], {}, 'test')
      expect(topo.nodes).toHaveLength(3)
      expect(topo.nodes[0].hostname).toBe('LEAF-01')
      expect(topo.nodes[1].hostname).toBe('LEAF-02')
      expect(topo.nodes[2].hostname).toBe('LEAF-03')
    })

    it('assigns correct container images by vendor', () => {
      const devices = [
        leaf('L1', 'Cisco'),
        leaf('L2', 'Arista'),
        leaf('L3', 'Juniper'),
      ]
      const topo = buildContainerlabTopology(devices, [], {}, 'multi-vendor')
      expect(topo.nodes[0].kind).toBe('cisco_n9kv')
      expect(topo.nodes[1].kind).toBe('ceos')
      expect(topo.nodes[2].kind).toBe('crpd')
    })

    it('assigns IOS-XE image for Cisco Catalyst models', () => {
      const dev: BOMDevice = {
        ...leaf('R1', 'Cisco'),
        model: 'C9300-48U',
        features: ['IOS-XE'],
      }
      const topo = buildContainerlabTopology([dev], [], {}, 'test')
      expect(topo.nodes[0].kind).toBe('cisco_csr1000v')
    })

    it('assigns IOS-XR image for ASR/NCS models', () => {
      const dev: BOMDevice = {
        ...leaf('R1', 'Cisco'),
        model: 'ASR-9904',
        features: ['IOS-XR'],
      }
      const topo = buildContainerlabTopology([dev], [], {}, 'test')
      expect(topo.nodes[0].kind).toBe('cisco_xrv9k')
    })

    it('assigns linux kind for unknown vendors', () => {
      const dev = leaf('X1', 'CustomVendor')
      const topo = buildContainerlabTopology([dev], [], {}, 'test')
      expect(topo.nodes[0].kind).toBe('linux')
    })

    it('sets startup-config when config exists for hostname', () => {
      const devices = [leaf('LEAF-01')]
      const configs = { 'LEAF-01': 'hostname LEAF-01\n!' }
      const topo = buildContainerlabTopology(devices, [], configs, 'test')
      expect(topo.nodes[0].startupConfig).toBe('configs/LEAF-01.cfg')
    })

    it('does not set startup-config when no config exists', () => {
      const devices = [leaf('LEAF-01')]
      const topo = buildContainerlabTopology(devices, [], {}, 'test')
      expect(topo.nodes[0].startupConfig).toBeUndefined()
    })

    it('generates links from cabling', () => {
      const devices = [leaf('LEAF-01'), spine('SPINE-01')]
      const cabling = [cable('LEAF-01', 'SPINE-01', 2)]
      const topo = buildContainerlabTopology(devices, cabling, {}, 'test')
      expect(topo.links).toHaveLength(2)
      expect(topo.links[0].a).toContain('leaf-01:')
      expect(topo.links[0].b).toContain('spine-01:')
    })

    it('skips links for devices not in topology', () => {
      const devices = [leaf('LEAF-01')]
      const cabling = [cable('LEAF-01', 'MISSING-SPINE')]
      const topo = buildContainerlabTopology(devices, cabling, {}, 'test')
      expect(topo.links).toHaveLength(0)
    })

    it('sanitizes topology name', () => {
      const topo = buildContainerlabTopology([], [], {}, 'My Lab @ DC-1!')
      expect(topo.name).toBe('my-lab-dc-1')
    })
  })

  describe('topologyToYAML', () => {
    it('produces valid YAML structure', () => {
      const topo = buildContainerlabTopology(
        [leaf('LEAF-01'), spine('SPINE-01')],
        [cable('LEAF-01', 'SPINE-01')],
        { 'LEAF-01': 'hostname LEAF-01' },
        'dc-lab',
      )
      const yaml = topologyToYAML(topo)
      expect(yaml).toContain('name: dc-lab')
      expect(yaml).toContain('topology:')
      expect(yaml).toContain('nodes:')
      expect(yaml).toContain('leaf-01:')
      expect(yaml).toContain('kind: cisco_n9kv')
      expect(yaml).toContain('startup-config: configs/LEAF-01.cfg')
      expect(yaml).toContain('links:')
      expect(yaml).toContain('endpoints:')
    })

    it('includes deploy/destroy comments', () => {
      const yaml = topologyToYAML(buildContainerlabTopology([], [], {}, 'test'))
      expect(yaml).toContain('clab deploy')
      expect(yaml).toContain('clab destroy')
    })

    it('omits links section when no links', () => {
      const yaml = topologyToYAML(buildContainerlabTopology([leaf('L1')], [], {}, 'test'))
      expect(yaml).not.toContain('links:')
    })

    it('omits startup-config when not set', () => {
      const yaml = topologyToYAML(buildContainerlabTopology([leaf('L1')], [], {}, 'test'))
      expect(yaml).not.toContain('startup-config')
    })
  })

  describe('generateStartupConfigs', () => {
    it('returns config files for nodes with configs', () => {
      const configs = { 'LEAF-01': 'hostname LEAF-01\n!', 'SPINE-01': 'hostname SPINE-01\n!' }
      const topo = buildContainerlabTopology(
        [leaf('LEAF-01'), spine('SPINE-01')],
        [],
        configs,
        'test',
      )
      const files = generateStartupConfigs(topo, configs)
      expect(files).toHaveLength(2)
      expect(files[0].filename).toBe('configs/LEAF-01.cfg')
      expect(files[0].content).toBe('hostname LEAF-01\n!')
    })

    it('skips nodes without configs', () => {
      const topo = buildContainerlabTopology([leaf('L1'), leaf('L2')], [], { 'L1': 'cfg' }, 'test')
      const files = generateStartupConfigs(topo, { 'L1': 'cfg' })
      expect(files).toHaveLength(1)
    })
  })

  describe('containerlabReadme', () => {
    it('generates README with node and link tables', () => {
      const topo = buildContainerlabTopology(
        [leaf('LEAF-01'), spine('SPINE-01')],
        [cable('LEAF-01', 'SPINE-01')],
        {},
        'dc-lab',
      )
      const readme = containerlabReadme(topo)
      expect(readme).toContain('dc-lab')
      expect(readme).toContain('Nodes (2)')
      expect(readme).toContain('Links (1)')
      expect(readme).toContain('leaf-01')
      expect(readme).toContain('spine-01')
      expect(readme).toContain('clab deploy')
    })
  })

  describe('multi-vendor topology', () => {
    it('builds a full multi-vendor lab topology', () => {
      const devices = [
        spine('SPINE-01', 'Arista'),
        spine('SPINE-02', 'Arista'),
        leaf('LEAF-01', 'Cisco'),
        leaf('LEAF-02', 'Cisco'),
        leaf('LEAF-03', 'Juniper'),
        leaf('LEAF-04', 'Juniper'),
      ]
      const cabling = [
        cable('LEAF-01', 'SPINE-01', 2),
        cable('LEAF-01', 'SPINE-02', 2),
        cable('LEAF-02', 'SPINE-01', 2),
        cable('LEAF-02', 'SPINE-02', 2),
        cable('LEAF-03', 'SPINE-01', 2),
        cable('LEAF-03', 'SPINE-02', 2),
        cable('LEAF-04', 'SPINE-01', 2),
        cable('LEAF-04', 'SPINE-02', 2),
      ]
      const topo = buildContainerlabTopology(devices, cabling, {}, 'multi-vendor-dc')
      expect(topo.nodes).toHaveLength(6)
      expect(topo.links).toHaveLength(16)

      const yaml = topologyToYAML(topo)
      expect(yaml).toContain('kind: ceos')
      expect(yaml).toContain('kind: cisco_n9kv')
      expect(yaml).toContain('kind: crpd')
    })
  })
})
