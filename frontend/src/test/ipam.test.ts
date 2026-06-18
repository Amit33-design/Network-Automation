import { describe, it, expect } from 'vitest'
import {
  genIPBlocks, genIPRows, genVLANs, genVNIs,
  toNetBoxPrefixCsv, toNetBoxVlanCsv, toNetBoxIpAddressCsv, buildNetBoxIpamExport,
} from '../lib/ipam'
import type { BOMDevice } from '@/types'

function dev(subLayer: string, hostname: string, idx: number): BOMDevice {
  return {
    id: `${subLayer}-${idx}`, hostname, vendor: 'Cisco', model: 'Test',
    role: 'Switch', subLayer, count: 1, ports: 48, speed: '25G',
    features: [], unitPrice: 1000, totalPrice: 1000,
  }
}

const dcDevices: BOMDevice[] = [
  dev('spine', 'IAD-SPINE-A01', 0),
  dev('spine', 'IAD-SPINE-A02', 1),
  dev('leaf', 'IAD-LEAF-A01', 0),
  dev('leaf', 'IAD-LEAF-A02', 1),
  dev('firewall', 'IAD-FW-A01', 0),
]

describe('lib/ipam — data generators', () => {
  it('genIPBlocks returns DC-specific overlay/underlay blocks for dc', () => {
    const blocks = genIPBlocks('dc', 500, 1, dcDevices)
    const labels = blocks.map(b => b.label).join(' | ')
    expect(labels).toContain('MANAGEMENT OOB')
    expect(labels).toContain('DC UNDERLAY')
    expect(labels).toContain('DC OVERLAY')
  })

  it('genIPBlocks adds GPU/storage blocks for gpu', () => {
    const blocks = genIPBlocks('gpu', 64, 1, dcDevices)
    const labels = blocks.map(b => b.label).join(' | ')
    expect(labels).toContain('GPU COMPUTE')
    expect(labels).toContain('STORAGE')
  })

  it('genIPRows emits loopbacks for spine/leaf/firewall', () => {
    const rows = genIPRows('dc', dcDevices)
    expect(rows.some(r => r.layer === 'Spine' && r.iface === 'Loopback0')).toBe(true)
    expect(rows.some(r => r.layer === 'Leaf' && r.iface.includes('VTEP'))).toBe(true)
    expect(rows.some(r => r.layer === 'Firewall')).toBe(true)
  })

  it('genVLANs includes DC tenant VLANs only for fabric use cases', () => {
    expect(genVLANs('dc').some(v => v.name === 'DC-TENANT-A')).toBe(true)
    expect(genVLANs('campus').some(v => v.name === 'DC-TENANT-A')).toBe(false)
  })

  it('genVNIs returns L2 and L3 VNI rows', () => {
    const vnis = genVNIs()
    expect(vnis.some(v => v.type === 'L2')).toBe(true)
    expect(vnis.some(v => v.type.includes('L3'))).toBe(true)
  })
})

describe('lib/ipam — NetBox CSV export', () => {
  const blocks = genIPBlocks('dc', 500, 1, dcDevices)
  const vlans = genVLANs('dc')
  const rows = genIPRows('dc', dcDevices)

  it('prefix CSV has NetBox header and only valid CIDRs', () => {
    const csv = toNetBoxPrefixCsv(blocks, vlans)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('prefix,status,role,vlan_vid,description')
    for (const line of lines.slice(1)) {
      const cidr = line.split(',')[0]
      expect(cidr).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/)
    }
  })

  it('prefix CSV marks aggregate blocks as container and VLAN subnets as active', () => {
    const csv = toNetBoxPrefixCsv(blocks, vlans)
    expect(csv).toContain(',container,infrastructure,')
    expect(csv).toContain(',active,')
  })

  it('prefix CSV de-duplicates by CIDR', () => {
    const csv = toNetBoxPrefixCsv(blocks, vlans)
    const cidrs = csv.trim().split('\n').slice(1).map(l => l.split(',')[0])
    expect(new Set(cidrs).size).toBe(cidrs.length)
  })

  it('VLAN CSV emits one row per VLAN with active status', () => {
    const csv = toNetBoxVlanCsv(vlans)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('vid,name,status,description')
    expect(lines.length - 1).toBe(vlans.length)
    expect(lines[1]).toContain(',active,')
  })

  it('IP address CSV skips summary/range rows and appends prefix length', () => {
    const csv = toNetBoxIpAddressCsv(rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('address,status,dns_name,description')
    for (const line of lines.slice(1)) {
      const addr = line.split(',')[0]
      expect(addr).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/)
    }
    expect(csv).not.toContain('…')
    expect(csv).not.toContain(' – ')
  })

  it('IP address CSV uses lowercase hostname as dns_name', () => {
    const csv = toNetBoxIpAddressCsv(rows)
    expect(csv).toContain('iad-spine-a01')
  })

  it('buildNetBoxIpamExport returns all three CSVs', () => {
    const x = buildNetBoxIpamExport('dc', 500, 1, dcDevices)
    expect(x.prefixesCsv).toContain('prefix,status,role,vlan_vid,description')
    expect(x.vlansCsv).toContain('vid,name,status,description')
    expect(x.ipAddressesCsv).toContain('address,status,dns_name,description')
  })

  it('CSV cells with commas are quoted', () => {
    const csv = toNetBoxVlanCsv(genVLANs('dc'))
    // purpose strings contain no commas in defaults, but quoting must be safe:
    // craft a row by checking the escape helper indirectly via a comma value
    const withComma = toNetBoxPrefixCsv(
      [{ label: 'A, B', subnet: '10.9.0.0/24', detail: '', range: '' }],
      [],
    )
    expect(withComma).toContain('"A, B"')
    expect(csv).toBeTruthy()
  })
})
