import { describe, it, expect } from 'vitest'
import {
  buildContainerlabTopology,
  topologyToYAML,
  generateStartupConfigs,
  containerlabReadme,
  containerlabBundle,
} from '@/lib/containerlab'
import { buildDeviceList, buildCabling } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
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

// ── AG1: the export must reproduce the design, not just name it ──────────────
// Audited the way a user experiences it — build a real design, export, read
// what you get. A 20-device DC produced 20 nodes, ZERO links and ZERO startup
// configs: twenty isolated, unconfigured switches. Every test in this file
// passed over the top of that, because the helper above builds a CableLink
// with a HOSTNAME in `fromDevice`, and `buildCabling` puts a summary string
// like "16x leaf" there.
describe('AG1 — a real design round-trips into a usable lab', () => {
  const real = () => {
    const state = {
      useCase: 'dc' as const, scale: 'medium' as const, siteCode: 'AG1',
      totalEndpoints: 512, oversubscription: 3, bandwidthPerServer: '25G',
    }
    const devices = buildDeviceList(state)
    const cabling = buildCabling(devices, {
      'spine-leaf': 100, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000,
    })
    const configs = generateAllConfigs(devices, 'dc')
    return {
      devices, cabling, configs,
      topo: buildContainerlabTopology(devices, cabling, configs, 'AG1'),
    }
  }

  it('wires the nodes together', () => {
    const { topo } = real()
    expect(topo.nodes.length).toBeGreaterThan(10)
    expect(topo.links.length, 'a lab with no links is isolated devices').toBeGreaterThan(0)
  })

  it('emits exactly as many links as the BOM bills cables', () => {
    // The lab and the cable schedule must describe the same wiring.
    const { cabling, topo } = real()
    const billed = cabling.reduce((n, c) => n + c.quantity, 0)
    expect(topo.links.length).toBe(billed)
  })

  it('gives every node its generated startup config', () => {
    // `generateAllConfigs` keys by BOM id; this looked up by hostname, so the
    // match never happened and every device booted bare.
    const { topo, configs } = real()
    const withConfig = topo.nodes.filter(n => n.startupConfig)
    expect(withConfig.length).toBe(topo.nodes.filter(n => configs[n.deviceId]).length)
    expect(withConfig.length).toBe(topo.nodes.length)
  })

  it('writes the config files the topology references', () => {
    const { topo, configs } = real()
    const files = generateStartupConfigs(topo, configs)
    const referenced = topo.nodes.map(n => n.startupConfig).filter(Boolean)
    expect(files.length).toBe(referenced.length)
    for (const path of referenced) {
      expect(files.some(f => f.filename === path), `${path} referenced but not written`).toBe(true)
    }
    for (const f of files) expect(f.content.length).toBeGreaterThan(100)
  })

  it('bundles the topology and every config into one runnable script', () => {
    const { topo, configs } = real()
    const sh = containerlabBundle(topo, configs)
    expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
    expect(sh).toContain(`${topo.name}.clab.yml`)
    expect(sh).toContain('clab deploy')
    // Every referenced config is written by the script, not just named.
    for (const node of topo.nodes) {
      if (!node.startupConfig) continue
      expect(sh, `${node.startupConfig} is referenced but never written`)
        .toContain(`cat > '${node.startupConfig}'`)
    }
    // The heredoc delimiter must not occur inside any payload, or the script
    // terminates early and writes a truncated config.
    const delim = 'NETDESIGN_EOF'
    const opens = (sh.match(new RegExp(`<<'${delim}'`, 'g')) ?? []).length
    const closes = (sh.match(new RegExp(`^${delim}$`, 'gm')) ?? []).length
    expect(closes).toBe(opens)
  })

  it('never links a node to itself', () => {
    const { topo } = real()
    for (const l of topo.links) {
      expect(l.a.split(':')[0], `self-link on ${l.a}`).not.toBe(l.b.split(':')[0])
    }
  })

  it('uses each container interface at most once', () => {
    const { topo } = real()
    const seen = new Set<string>()
    for (const l of topo.links) {
      for (const ep of [l.a, l.b]) {
        expect(seen.has(ep), `${ep} used twice`).toBe(false)
        seen.add(ep)
      }
    }
  })
})
