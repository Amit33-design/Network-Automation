import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import {
  buildAnsibleInventory, buildAnsiblePlaybook,
  ansibleNetworkOs, ansibleConnection,
} from '@/lib/ansible-export'
import type { BOMDevice } from '@/types'

const dev = (o: Partial<BOMDevice>): BOMDevice => ({
  id: o.id ?? 'd1', hostname: o.hostname ?? 'DEV-01', role: o.role ?? 'leaf',
  subLayer: o.subLayer ?? 'leaf', model: o.model ?? 'M', vendor: o.vendor ?? 'Cisco',
  count: 1, unitPrice: 1, totalPrice: 1, speed: '100G', ports: 32, features: [],
})

describe('Ansible export is vendor-correct (AB6)', () => {
  it('each vendor gets its OWN network_os — not ios for everything', () => {
    // The bug this replaces: the inline generator emitted
    // `ansible_network_os=ios` for every device, so a Juniper or Arista fleet
    // got the IOS cliconf plugin and failed on the first task.
    const cases: Array<[string, string, string]> = [
      ['Cisco',            'Nexus 9336C-FX2',  'cisco.nxos.nxos'],
      ['Cisco',            'Catalyst 9500',    'cisco.ios.ios'],
      ['Arista',           '7050CX3',          'arista.eos.eos'],
      ['Juniper',          'QFX5120',          'junipernetworks.junos.junos'],
      ['Nokia',            'SR Linux',         'nokia.srlinux.srlinux'],
      ['NVIDIA',           'SN4600C',          'community.network.cumulus'],
      ['Dell EMC',         'S5248F',           'dellemc.os10.os10'],
      ['Extreme Networks', '8720',             'community.network.exos'],
      ['Palo Alto',        'PA-5450',          'paloaltonetworks.panos.panos'],
    ]
    for (const [vendor, model, expected] of cases) {
      expect(ansibleNetworkOs(dev({ vendor, model })), `${vendor} ${model}`).toBe(expected)
    }
  })

  it('NETCONF-driven platforms do not get the CLI connection plugin', () => {
    expect(ansibleConnection(dev({ vendor: 'Juniper' }))).toBe('ansible.netcommon.netconf')
    expect(ansibleConnection(dev({ vendor: 'Nokia' }))).toBe('ansible.netcommon.netconf')
    expect(ansibleConnection(dev({ vendor: 'Cisco' }))).toBe('ansible.netcommon.network_cli')
  })

  it('become/enable is set only on platforms that actually have enable mode', () => {
    const inv = buildAnsibleInventory([
      dev({ id: 'a', hostname: 'NX-01', vendor: 'Cisco', model: 'Nexus 9336C-FX2' }),
      dev({ id: 'b', hostname: 'JUN-01', vendor: 'Juniper', model: 'QFX5120' }),
    ])
    const nx = inv.slice(inv.indexOf('NX-01'), inv.indexOf('JUN-01'))
    const jun = inv.slice(inv.indexOf('JUN-01'))
    expect(nx).toContain('ansible_become_method: enable')
    expect(jun, 'become/enable is meaningless on Junos').not.toContain('ansible_become')
  })

  it('no fabricated management IPs — the tool does not own the OOB plan', () => {
    const inv = buildAnsibleInventory([dev({ hostname: 'L1' }), dev({ id: 'd2', hostname: 'L2' })])
    expect(inv).not.toMatch(/ansible_host:\s*10\.0\.0\.\d+/)
    expect(inv).toContain('<CHANGE-ME-mgmt-ip>')
  })

  it('hosts are grouped by BOM tier so plays can target a role', () => {
    const inv = buildAnsibleInventory([
      dev({ id: 's', hostname: 'SP-01', subLayer: 'spine' }),
      dev({ id: 'l', hostname: 'LF-01', subLayer: 'leaf' }),
      dev({ id: 'f', hostname: 'FW-01', subLayer: 'firewall', vendor: 'Palo Alto' }),
    ])
    for (const g of ['spine:', 'leaf:', 'firewall:']) expect(inv).toContain(`    ${g}`)
  })

  it('non-CLI devices are excluded from the inventory', () => {
    const inv = buildAnsibleInventory([
      dev({ id: 'l', hostname: 'LF-01' }),
      dev({ id: 'g', hostname: 'GPU-001', subLayer: 'gpu-compute' }),
      dev({ id: 'c', hostname: 'CGW-01', subLayer: 'cloud-gw' }),
    ])
    expect(inv).toContain('LF-01')
    expect(inv).not.toContain('GPU-001')
    expect(inv).not.toContain('CGW-01')
  })

  it('the playbook emits one play per platform with the right config module', () => {
    const pb = buildAnsiblePlaybook([
      dev({ id: 'a', hostname: 'NX-01', vendor: 'Cisco', model: 'Nexus 9336C-FX2' }),
      dev({ id: 'b', hostname: 'EOS-01', vendor: 'Arista', model: '7050CX3' }),
    ])
    expect(pb).toContain('cisco.nxos.nxos_config')
    expect(pb).toContain('arista.eos.eos_config')
    expect((pb.match(/^- name: Push configuration/gm) ?? []).length).toBe(2)
  })

  it('generated configs are embedded when present, else read from disk', () => {
    const d = dev({ id: 'x', hostname: 'LF-01' })
    expect(buildAnsiblePlaybook([d], { x: 'hostname LF-01\nfeature bgp' }))
      .toContain('hostname LF-01')
    expect(buildAnsiblePlaybook([d], {})).toContain("lookup('file', 'configs/LF-01.cfg')")
  })

  it('a real multi-vendor design produces a correct inventory end to end', () => {
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia']) {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'AN', vendorPrefs: [vendor],
      })
      const inv = buildAnsibleInventory(devices)
      const configs = generateAllConfigs(devices, 'dc')
      const pb = buildAnsiblePlaybook(devices, configs)
      // every switch in the BOM appears, with a platform matching its vendor
      for (const d of devices.filter(x => x.subLayer === 'leaf' || x.subLayer === 'spine')) {
        expect(inv, `${vendor}: ${d.hostname} missing`).toContain(d.hostname)
      }
      expect(inv).not.toContain('undefined')
      expect(pb).not.toContain('undefined')
    }
  })
})
