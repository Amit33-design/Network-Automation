import { describe, it, expect } from 'vitest'
import { generateConfig } from '../lib/configgen'
import type { BOMDevice, AppType } from '@/types'

function makeCiscoLeaf(idx: number): BOMDevice {
  return {
    id: `leaf-${idx}`,
    hostname: `DC1-LEAF-${idx + 1}`,
    vendor: 'Cisco',
    model: 'N9K-C93180YC-FX',
    role: 'Switch',
    subLayer: 'leaf',
    count: 1,
    ports: 48,
    speed: '25GE',
    features: ['NX-OS', 'VXLAN', 'BGP'],
    unitPrice: 15000,
    totalPrice: 15000,
  }
}

function makeAristaLeaf(idx: number): BOMDevice {
  return {
    id: `leaf-${idx}`,
    hostname: `DC1-LEAF-${idx + 1}`,
    vendor: 'Arista',
    model: '7050SX3-48YC12',
    role: 'Switch',
    subLayer: 'leaf',
    count: 1,
    ports: 48,
    speed: '25GE',
    features: ['EOS', 'VXLAN', 'BGP'],
    unitPrice: 15000,
    totalPrice: 15000,
  }
}

describe('G-A11 — Storage Networking (NVMe-oF / FCoE / iSCSI)', () => {
  describe('NX-OS leaf with storage appType', () => {
    const dev = makeCiscoLeaf(0)
    const cfg = generateConfig(dev, 0, 'dc', ['storage'] as AppType[])

    it('includes FCoE feature and VSAN database', () => {
      expect(cfg).toContain('feature fcoe')
      expect(cfg).toContain('vsan database')
      expect(cfg).toContain('vsan 100 name STORAGE-VSAN')
    })

    it('includes FCoE VLAN 200', () => {
      expect(cfg).toContain('vlan 200')
      expect(cfg).toContain('name STORAGE-FCOE')
    })

    it('includes iSCSI VLAN 201', () => {
      expect(cfg).toContain('vlan 201')
      expect(cfg).toContain('name STORAGE-ISCSI')
      expect(cfg).toContain('ip address <CHANGE-ME-iscsi-gw-ip>/24')
    })

    it('includes NVMe-oF VLAN 202', () => {
      expect(cfg).toContain('vlan 202')
      expect(cfg).toContain('name STORAGE-NVMEOF')
      expect(cfg).toContain('ip address <CHANGE-ME-nvmeof-gw-ip>/24')
    })

    it('includes storage QoS with PFC priority 6', () => {
      expect(cfg).toContain('CM-STORAGE-FCOE')
      expect(cfg).toContain('match cos 6')
      expect(cfg).toContain('PM-STORAGE-CLASSIFY')
      expect(cfg).toContain('PM-STORAGE-QUEUING')
    })

    it('includes jumbo MTU 9216', () => {
      expect(cfg).toContain('system jumbomtu 9216')
    })

    it('includes FIP snooping', () => {
      expect(cfg).toContain('feature fip-snooping')
      expect(cfg).toContain('fcoe fcmap 0E:FC:00')
    })

    it('includes iSCSI ACL for port 3260', () => {
      expect(cfg).toContain('ACL-ISCSI')
      expect(cfg).toContain('permit tcp any any eq 3260')
    })

    it('uses CHANGE-ME placeholders for IPs', () => {
      expect(cfg).not.toMatch(/\d+\.\d+\.\d+\.\d+\/24/)
    })
  })

  describe('NX-OS leaf without storage appType', () => {
    const dev = makeCiscoLeaf(0)
    const cfg = generateConfig(dev, 0, 'dc', [])

    it('does not include storage blocks', () => {
      expect(cfg).not.toContain('STORAGE-FCOE')
      expect(cfg).not.toContain('STORAGE-ISCSI')
      expect(cfg).not.toContain('STORAGE-NVMEOF')
      expect(cfg).not.toContain('feature fcoe')
      expect(cfg).not.toContain('vsan database')
    })
  })

  describe('NX-OS leaf with non-storage appTypes', () => {
    const dev = makeCiscoLeaf(0)
    const cfg = generateConfig(dev, 0, 'dc', ['voice', 'video'] as AppType[])

    it('does not include storage blocks', () => {
      expect(cfg).not.toContain('STORAGE-FCOE')
      expect(cfg).not.toContain('STORAGE-NVMEOF')
    })
  })

  describe('Arista leaf with storage appType', () => {
    const dev = makeAristaLeaf(0)
    const cfg = generateConfig(dev, 0, 'dc', ['storage'] as AppType[])

    it('includes iSCSI VLAN 201', () => {
      expect(cfg).toContain('vlan 201')
      expect(cfg).toContain('name STORAGE-ISCSI')
    })

    it('includes NVMe-oF VLAN 202', () => {
      expect(cfg).toContain('vlan 202')
      expect(cfg).toContain('name STORAGE-NVMEOF')
    })

    it('does NOT include FCoE (Arista unsupported)', () => {
      expect(cfg).not.toContain('feature fcoe')
      expect(cfg).not.toContain('vsan database')
      expect(cfg).not.toContain('STORAGE-FCOE')
    })

    it('includes storage QoS with PFC priority 6 no-drop', () => {
      expect(cfg).toContain('priority-flow-control priority 6 no-drop')
    })

    it('includes jumbo MTU 9214', () => {
      expect(cfg).toContain('system mtu jumbo 9214')
    })

    it('includes iSCSI ACL for port 3260', () => {
      expect(cfg).toContain('ACL-ISCSI')
      expect(cfg).toContain('permit tcp any any eq 3260')
    })
  })

  describe('Arista leaf without storage appType', () => {
    const dev = makeAristaLeaf(0)
    const cfg = generateConfig(dev, 0, 'dc', [])

    it('does not include storage blocks', () => {
      expect(cfg).not.toContain('STORAGE-ISCSI')
      expect(cfg).not.toContain('STORAGE-NVMEOF')
      expect(cfg).not.toContain('priority-flow-control priority 6 no-drop')
    })
  })

  describe('GPU use case with storage', () => {
    const dev = makeCiscoLeaf(0)
    const cfg = generateConfig(dev, 0, 'gpu', ['storage', 'hpc'] as AppType[])

    it('includes both GPU QoS and storage blocks', () => {
      expect(cfg).toContain('CM-RDMA')
      expect(cfg).toContain('STORAGE-FCOE')
      expect(cfg).toContain('STORAGE-NVMEOF')
    })
  })
})
