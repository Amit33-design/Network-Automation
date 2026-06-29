import { describe, it, expect } from 'vitest'
import { validateConfigs, validationReportText } from '@/lib/config-validator'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import type { BOMDevice } from '@/types'

const device = (hostname: string, vendor = 'Cisco'): BOMDevice => ({
  id: hostname,
  hostname,
  role: 'leaf',
  subLayer: 'leaf',
  model: 'N9K-C93180YC-EX',
  vendor,
  count: 1,
  unitPrice: 20000,
  totalPrice: 20000,
  speed: '25G',
  ports: 48,
  uplinks: 6,
  features: [],
})

const baseConfig = (hostname: string) => `
! ── MANAGEMENT ──────────────────────────────────────────────────────────────────
hostname ${hostname}
ip domain-name <CHANGE-ME-domain.example.com>
ntp server 10.0.0.1
logging host 10.0.0.2
snmp-server community <CHANGE-ME-snmp-community> RO
username admin privilege 15 algorithm-type sha256 secret <CHANGE-ME-admin-password>

interface Loopback0
 ip address 10.255.0.1/32

router bgp 65001
 router-id 10.255.0.1
 neighbor 10.1.0.1 remote-as 65000

router isis UNDERLAY
 is-type level-2
 net 49.0001.0100.0000.0001.00
`

const dcConfig = (hostname: string, rid: string, nbrIp: string) => `
! ── MANAGEMENT ──────────────────────────────────────────────────────────────────
hostname ${hostname}
ip domain-name <CHANGE-ME-domain.example.com>
ntp server 10.0.0.1
logging host 10.0.0.2
snmp-server community <CHANGE-ME-snmp-community> RO
username admin privilege 15 algorithm-type sha256 secret <CHANGE-ME-admin-password>

interface Loopback0
 ip address ${rid}/32

interface nve1
 no shutdown
 host-reachability protocol bgp
 source-interface loopback1
 member vni 100010
   ingress-replication protocol bgp

router bgp 65001
 router-id ${rid}
 neighbor ${nbrIp} remote-as 65000
 address-family l2vpn evpn
   send-community extended

router isis UNDERLAY
 is-type level-2

evpn
 vni 100010 l2
   rd auto
   route-target import auto
   route-target export auto

bfd interval 50 min-rx 50 multiplier 3
`

describe('config-validator', () => {
  describe('validateConfigs', () => {
    it('returns fail when no configs provided', () => {
      const result = validateConfigs({ configs: {}, devices: [], useCase: 'dc' })
      expect(result.summary.fail).toBe(1)
      expect(result.checks[0].id).toBe('V-00')
    })

    it('runs all 14 checks on valid DC configs', () => {
      const configs: Record<string, string> = {
        'LEAF-01': dcConfig('LEAF-01', '10.255.0.1', '10.1.0.1'),
        'LEAF-02': dcConfig('LEAF-02', '10.255.0.2', '10.1.0.2'),
        'SPINE-01': dcConfig('SPINE-01', '10.255.1.1', '10.1.0.1'),
      }
      const result = validateConfigs({
        configs,
        devices: [device('LEAF-01'), device('LEAF-02'), device('SPINE-01')],
        useCase: 'dc',
      })
      expect(result.checks).toHaveLength(14)
      expect(result.summary.fail).toBe(0)
    })

    it('detects duplicate router-IDs', () => {
      const configs = {
        'LEAF-01': dcConfig('LEAF-01', '10.255.0.1', '10.1.0.1'),
        'LEAF-02': dcConfig('LEAF-02', '10.255.0.1', '10.1.0.2'),
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const rid = result.checks.find(c => c.id === 'V-02')!
      expect(rid.severity).toBe('fail')
      expect(rid.detail).toContain('duplicate')
    })

    it('detects mixed IS-IS + OSPF underlay', () => {
      const configs = {
        'R1': `hostname R1\nrouter isis UNDERLAY\nrouter ospf 1\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v01 = result.checks.find(c => c.id === 'V-01')!
      expect(v01.severity).toBe('fail')
      expect(v01.detail).toContain('BOTH')
    })

    it('warns when DC use case has OSPF instead of IS-IS', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\nrouter ospf 1\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>\nrouter bgp 65001\n router-id 10.0.0.1\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v01 = result.checks.find(c => c.id === 'V-01')!
      expect(v01.severity).toBe('warn')
      expect(v01.detail).toContain('IS-IS')
    })

    it('detects missing BGP in DC use case', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\nrouter isis UNDERLAY\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v03 = result.checks.find(c => c.id === 'V-03')!
      expect(v03.severity).toBe('fail')
    })

    it('warns about BGP neighbors referencing unknown IPs', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\nrouter bgp 65001\n router-id 10.0.0.1\n neighbor 192.168.99.99 remote-as 65002\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v04 = result.checks.find(c => c.id === 'V-04')!
      expect(v04.severity).toBe('warn')
      expect(v04.detail).toContain('192.168.99.99')
    })

    it('detects empty configs', () => {
      const configs = { 'LEAF-01': '', 'LEAF-02': dcConfig('LEAF-02', '10.0.0.2', '10.0.0.1') }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v11 = result.checks.find(c => c.id === 'V-11')!
      expect(v11.severity).toBe('fail')
      expect(v11.devices).toContain('LEAF-01')
    })

    it('detects missing hostname command', () => {
      const configs = {
        'LEAF-01': `router bgp 65001\n router-id 10.0.0.1\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v06 = result.checks.find(c => c.id === 'V-06')!
      expect(v06.severity).toBe('warn')
    })

    it('detects missing management block', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\nrouter bgp 65001\n router-id 10.0.0.1\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v07 = result.checks.find(c => c.id === 'V-07')!
      expect(v07.severity).toBe('warn')
    })

    it('warns when NVE present but no EVPN on DC', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\ninterface nve1\n no shutdown\nntp server 1.1.1.1\nrouter bgp 65001\n router-id 10.0.0.1\nusername admin secret <CHANGE-ME-pw>\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v08 = result.checks.find(c => c.id === 'V-08')!
      expect(v08.severity).toBe('warn')
    })

    it('EVPN check returns info for campus use case', () => {
      const configs = {
        'SW-01': baseConfig('SW-01'),
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'campus' })
      const v08 = result.checks.find(c => c.id === 'V-08')!
      expect(v08.severity).toBe('info')
    })

    it('detects missing GPU QoS for gpu use case', () => {
      const configs = {
        'LEAF-01': dcConfig('LEAF-01', '10.0.0.1', '10.0.0.2'),
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'gpu' })
      const v09 = result.checks.find(c => c.id === 'V-09')!
      expect(v09.severity).toBe('fail')
      expect(v09.detail).toContain('PFC')
    })

    it('passes GPU QoS when PFC/ECN/RDMA present', () => {
      const gpuCfg = dcConfig('LEAF-01', '10.0.0.1', '10.0.0.2') +
        '\npriority-flow-control mode on\npriority-flow-control priority 3 no-drop\n' +
        'random-detect ecn\nrdma qos-group 3\ndcqcn enable\n'
      const configs = { 'LEAF-01': gpuCfg }
      const result = validateConfigs({ configs, devices: [], useCase: 'gpu' })
      const v09 = result.checks.find(c => c.id === 'V-09')!
      expect(v09.severity).toBe('pass')
    })

    it('GPU QoS returns info for non-gpu use case', () => {
      const configs = { 'LEAF-01': dcConfig('LEAF-01', '10.0.0.1', '10.0.0.2') }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v09 = result.checks.find(c => c.id === 'V-09')!
      expect(v09.severity).toBe('info')
    })

    it('detects routing devices missing loopback', () => {
      const configs = {
        'LEAF-01': `hostname LEAF-01\nrouter bgp 65001\n router-id 10.0.0.1\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v12 = result.checks.find(c => c.id === 'V-12')!
      expect(v12.severity).toBe('warn')
      expect(v12.devices).toContain('LEAF-01')
    })

    it('warns about missing BFD in DC use case', () => {
      const noBfdCfg = `hostname LEAF-01\nrouter bgp 65001\n router-id 10.0.0.1\nntp server 1.1.1.1\nusername admin secret <CHANGE-ME-pw>\ninterface Loopback0\n ip address 10.0.0.1/32\nrouter isis UNDERLAY`
      const configs = { 'LEAF-01': noBfdCfg }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const v13 = result.checks.find(c => c.id === 'V-13')!
      expect(v13.severity).toBe('warn')
    })

    it('BFD check returns info for wan use case', () => {
      const configs = { 'R1': baseConfig('R1') }
      const result = validateConfigs({ configs, devices: [], useCase: 'wan' })
      const v13 = result.checks.find(c => c.id === 'V-13')!
      expect(v13.severity).toBe('info')
    })

    it('summary counts match check severities', () => {
      const configs = {
        'LEAF-01': dcConfig('LEAF-01', '10.255.0.1', '10.1.0.1'),
        'LEAF-02': dcConfig('LEAF-02', '10.255.0.2', '10.1.0.2'),
      }
      const result = validateConfigs({ configs, devices: [device('LEAF-01'), device('LEAF-02')], useCase: 'dc' })
      const counted = result.checks.reduce(
        (acc, c) => { acc[c.severity]++; return acc },
        { pass: 0, fail: 0, warn: 0, info: 0 },
      )
      expect(result.summary).toEqual(counted)
    })
  })

  describe('validationReportText', () => {
    it('produces a text report with all checks', () => {
      const result = validateConfigs({
        configs: { 'LEAF-01': dcConfig('LEAF-01', '10.0.0.1', '10.0.0.2') },
        devices: [device('LEAF-01')],
        useCase: 'dc',
      })
      const text = validationReportText(result)
      expect(text).toContain('# Network Config Validation Report')
      expect(text).toContain('PASS')
      expect(text).toContain('V-01')
      expect(text).toContain('V-13')
    })

    it('includes device list for failing checks', () => {
      const configs = {
        'LEAF-01': dcConfig('LEAF-01', '10.0.0.1', '10.0.0.2'),
        'LEAF-02': dcConfig('LEAF-02', '10.0.0.1', '10.0.0.3'),
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'dc' })
      const text = validationReportText(result)
      expect(text).toContain('Devices:')
    })
  })

  describe('edge cases', () => {
    it('handles configs with only non-routing devices', () => {
      const configs = {
        'FW-01': `hostname FW-01\nntp server 1.1.1.1\nlogging host 1.1.1.2\nsnmp-server host 1.1.1.3\nusername admin secret <CHANGE-ME-pw>`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'campus' })
      expect(result.summary.fail).toBe(0)
    })

    it('handles single-device campus design', () => {
      const configs = {
        'CORE-01': `hostname CORE-01\nrouter ospf 1\n router-id 10.0.0.1\nntp server 1.1.1.1\nlogging host 1.1.1.2\nsnmp-server host 1.1.1.3\nusername admin secret <CHANGE-ME-pw>\ninterface Loopback0\n ip address 10.0.0.1/32`,
      }
      const result = validateConfigs({ configs, devices: [device('CORE-01')], useCase: 'campus' })
      expect(result.summary.fail).toBe(0)
    })

    it('handles O-RAN use case gracefully', () => {
      const configs = {
        'CU-01': `hostname CU-01\nntp server 1.1.1.1\nlogging host 1.1.1.2\nsnmp-server host 1.1.1.3\nusername admin secret <CHANGE-ME-pw>`,
      }
      const result = validateConfigs({ configs, devices: [], useCase: 'oran' })
      expect(result.checks.length).toBeGreaterThan(0)
    })
  })

  // M3 — validator must recognize non-Cisco syntax (Juniper Junos `set`,
  // Nokia SR Linux YANG `{ }`) and not false-fail multi-vendor designs.
  describe('vendor-aware syntax detection (M3)', () => {
    const check = (result: ReturnType<typeof validateConfigs>, id: string) =>
      result.checks.find(c => c.id === id)!

    it('Nokia SR Linux DC fabric: BGP detected (no false V-03 fail)', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Nokia'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      const bgp = check(result, 'V-03')
      expect(bgp.severity).not.toBe('fail')
      expect(bgp.severity).toBe('pass')
    })

    it('Nokia SR Linux DC fabric: management plane detected (no false V-07 warn)', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Nokia'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      const mgmt = check(result, 'V-07')
      expect(mgmt.severity).toBe('pass')
    })

    it('Nokia SR Linux DC fabric: IS-IS underlay detected', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Nokia'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      const underlay = check(result, 'V-01')
      expect(underlay.severity).toBe('pass')
      expect(underlay.detail).toMatch(/IS-IS/)
    })

    it('Juniper campus: host-name recognized as hostname (no false V-06 warn)', () => {
      const devices = buildDeviceList({
        useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'],
      })
      const configs = generateAllConfigs(devices, 'campus')
      const result = validateConfigs({ configs, devices, useCase: 'campus' })
      const hn = check(result, 'V-06')
      expect(hn.severity).toBe('pass')
    })

    it('Juniper campus: OSPF underlay detected via Junos protocols syntax', () => {
      const devices = buildDeviceList({
        useCase: 'campus', scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'],
      })
      const configs = generateAllConfigs(devices, 'campus')
      const result = validateConfigs({ configs, devices, useCase: 'campus' })
      const underlay = check(result, 'V-01')
      expect(underlay.severity).toBe('pass')
    })

    it('Juniper WAN: BGP detected via Junos autonomous-system syntax', () => {
      const devices = buildDeviceList({
        useCase: 'wan', scale: 'small', siteCode: 'T', vendorPrefs: ['Juniper'],
      })
      const configs = generateAllConfigs(devices, 'wan')
      const result = validateConfigs({ configs, devices, useCase: 'wan' })
      const bgp = check(result, 'V-03')
      // WAN is not a fabric use case, but BGP should still be detected → pass
      expect(bgp.severity).toBe('pass')
    })

    it('V-14: real generated DC fabrics carry a jumbo underlay MTU', () => {
      for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks']) {
        const devices = buildDeviceList({
          useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: [vendor],
        })
        if (devices.length === 0) continue
        const configs = generateAllConfigs(devices, 'dc')
        const result = validateConfigs({ configs, devices, useCase: 'dc' })
        const mtu = result.checks.find(c => c.id === 'V-14')!
        expect(mtu.severity, `${vendor}: ${mtu.detail}`).toBe('pass')
      }
    })

    it('V-14: warns when a VXLAN device lacks a jumbo MTU', () => {
      const configs = {
        'LEAF-01': 'hostname LEAF-01\ninterface nve1\n source-interface loopback1\nntp server 1.1.1.1\nlogging host 1.1.1.2\nrouter bgp 65001\n router-id 10.0.0.1\ninterface Loopback0\n ip address 10.0.0.1/32\nusername a secret <CHANGE-ME>',
      }
      const result = validateConfigs({ configs, devices: [device('LEAF-01')], useCase: 'dc' })
      const mtu = result.checks.find(c => c.id === 'V-14')!
      expect(mtu.severity).toBe('warn')
      expect(mtu.devices).toContain('LEAF-01')
    })

    it('V-04: commented-out example neighbor lines are not parsed as live peers', () => {
      // NX-OS spine emits `! neighbor 10.255.2.1 inherit peer ...` as docs;
      // the validator must not treat that as an unreachable live peer.
      const configs = {
        'SPINE-01': 'hostname SPINE-01\nrouter bgp 65000\n router-id 10.255.1.1\n template peer LEAF\n  remote-as 65001\n ! neighbor 10.255.2.1 inherit peer LEAF\ninterface Loopback0\n ip address 10.255.1.1/32\nntp server 1.1.1.1\nlogging host 1.1.1.2\nusername a secret <CHANGE-ME>',
      }
      const result = validateConfigs({ configs, devices: [device('SPINE-01')], useCase: 'dc' })
      const v04 = result.checks.find(c => c.id === 'V-04')!
      expect(v04.severity).not.toBe('warn')
    })

    it('V-04: real generated fabrics have no phantom BGP peers', () => {
      for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks']) {
        const devices = buildDeviceList({
          useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: vendor === 'Cisco' ? [] : [vendor],
        })
        if (devices.length === 0) continue
        const configs = generateAllConfigs(devices, 'dc')
        const result = validateConfigs({ configs, devices, useCase: 'dc' })
        const v04 = result.checks.find(c => c.id === 'V-04')!
        expect(v04.severity, `${vendor}: ${v04.detail}`).not.toBe('warn')
      }
    })

    it('V-06: Extreme EXOS sysName is recognized as the hostname', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Extreme Networks'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      expect(result.checks.find(c => c.id === 'V-06')!.severity).toBe('pass')
    })

    it('V-12: Dell OS10 emits a loopback interface (no false warn)', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['Dell EMC'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      expect(result.checks.find(c => c.id === 'V-12')!.severity).toBe('pass')
    })

    it('V-12: NVIDIA Cumulus loopback (iface lo + placeholder IP) is not false-warned', () => {
      const devices = buildDeviceList({
        useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: ['NVIDIA'],
      })
      const configs = generateAllConfigs(devices, 'dc')
      const result = validateConfigs({ configs, devices, useCase: 'dc' })
      const lo = result.checks.find(c => c.id === 'V-12')!
      expect(lo.severity, lo.detail).not.toBe('warn')
    })

    it('V-03: BGP detected for vendors that use a <CHANGE-ME-asn> placeholder', () => {
      // NVIDIA Cumulus / Dell OS10 emit `router bgp <CHANGE-ME-asn>` (no digit);
      // Extreme uses `configure bgp AS-number` — all must register as BGP.
      for (const vendor of ['NVIDIA', 'Dell EMC', 'Extreme Networks']) {
        const devices = buildDeviceList({
          useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: [vendor],
        })
        if (devices.length === 0) continue
        const configs = generateAllConfigs(devices, 'dc')
        const result = validateConfigs({ configs, devices, useCase: 'dc' })
        const bgp = result.checks.find(c => c.id === 'V-03')!
        expect(bgp.severity, `${vendor}: ${bgp.detail}`).toBe('pass')
      }
    })

    it('Juniper GPU fabric passes GPU QoS (V-09) — RoCEv2 lossless emitted', () => {
      const devices = buildDeviceList({
        useCase: 'gpu', scale: 'small', siteCode: 'T', vendorPrefs: ['Juniper'],
      })
      const configs = generateAllConfigs(devices, 'gpu')
      const result = validateConfigs({ configs, devices, useCase: 'gpu' })
      const qos = result.checks.find(c => c.id === 'V-09')!
      expect(qos.severity).toBe('pass')
    })

    it('multi-vendor design has zero false-positive failures', () => {
      for (const vendor of ['Nokia', 'Juniper', 'Arista']) {
        const devices = buildDeviceList({
          useCase: 'dc', scale: 'small', siteCode: 'T', vendorPrefs: [vendor],
        })
        if (devices.length === 0) continue
        const configs = generateAllConfigs(devices, 'dc')
        const result = validateConfigs({ configs, devices, useCase: 'dc' })
        expect(
          result.summary.fail,
          `${vendor} DC produced ${result.summary.fail} validation failure(s)`,
        ).toBe(0)
      }
    })
  })
})
