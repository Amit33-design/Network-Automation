import { describe, it, expect } from 'vitest'
import { runComplianceScan, exportComplianceReport } from '../lib/compliance-scan'
import type { ComplianceScanResult } from '../lib/compliance-scan'
import { buildDeviceList } from '../lib/bom'
import { generateAllConfigs } from '../lib/configgen'
import type { AppState } from '../types'

const BASE_STATE: AppState = {
  useCase: 'dc',
  appTypes: [],
  siteName: 'Test DC',
  siteCode: 'TST',
  scale: 'medium',
  redundancy: 'dual',
  linkDistances: { 'spine-leaf': 100, 'dist-access': 50, 'core-dist': 200, 'wan-edge': 5000 },
  devices: [
    { id: 's1', hostname: 'TST-SP-01', role: 'spine', subLayer: 'spine', model: 'N9K', vendor: 'Cisco', count: 2, unitPrice: 35000, totalPrice: 70000, speed: '100G', ports: 64, uplinks: 0, features: [] },
  ],
  cabling: [],
  optics: [],
  configs: {
    'TST-SP-01': `hostname TST-SP-01\nip ssh version 2\nlogging server 10.0.0.1\nntp server 10.0.0.2\nusername admin password <CHANGE-ME-ADMIN>`,
  },
  ztpConfig: {},
  policies: [],
  preCheckScript: '',
  postCheckScript: '',
  prometheusAlerts: '',
  grafanaDashboard: {},
  ansiblePlaybook: {},
  compliance: ['PCI'],
  step: 6,
  orgName: 'Test Corp',
  orgSize: 'enterprise',
  budgetTier: 'enterprise',
  vendorPrefs: ['Cisco'],
  industry: 'Finance',
  primaryContact: 'test@test.com',
  customPolicyRules: '',
  activeDeployTab: 'day2ops',
  theme: 'dark',
  trafficPattern: 'ew',
  totalEndpoints: 500,
  bandwidthPerServer: '25G',
  oversubscription: 3,
  underlayProtocol: 'isis',
  overlayProtocols: ['VXLAN/EVPN'],
  protoFeatures: ['ECMP', 'BFD'],
  firewallModel: 'perimeter',
  redundancyModel: 'ha',
  numSites: 1,
  vpnType: 'ipsec',
  nacOptions: ['802.1X Wired'],
  additionalNotes: '',
  policyBlocks: [],
  cloudProviders: [],
  dcTopology: '',
  coloProvider: '',
  dcEdgeVendor: '',
  bgpAsn: '',
  orgCidr: '',
  aviatrixOptions: [],
  demoTopologyId: '',
  netboxDevices: [],
  _savedAt: Date.now(),
}

describe('runComplianceScan', () => {
  it('uses selected compliance frameworks', () => {
    const result = runComplianceScan(BASE_STATE)
    expect(result.frameworks).toEqual(['PCI'])
    expect(result.controls.every(c => c.framework === 'PCI')).toBe(true)
  })

  it('defaults to PCI + SOC2 when no frameworks selected', () => {
    const state = { ...BASE_STATE, compliance: [] as any }
    const result = runComplianceScan(state)
    expect(result.frameworks).toEqual(['PCI', 'SOC2'])
  })

  it('produces pass for well-configured design', () => {
    const result = runComplianceScan(BASE_STATE)
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.summary.pass).toBeGreaterThan(0)
  })

  it('detects missing firewall', () => {
    const state = { ...BASE_STATE, firewallModel: '' as any }
    const result = runComplianceScan(state)
    const fwControl = result.controls.find(c => c.id === 'PCI-1.1')
    expect(fwControl?.status).toBe('fail')
  })

  it('validates SSH v2 in configs', () => {
    const result = runComplianceScan(BASE_STATE)
    const sshControl = result.controls.find(c => c.id === 'PCI-2.3')
    expect(sshControl?.status).toBe('pass')
  })

  it('validates NTP in configs', () => {
    const result = runComplianceScan(BASE_STATE)
    const ntpControl = result.controls.find(c => c.id === 'PCI-10.1')
    expect(ntpControl?.status).toBe('pass')
  })

  it('detects missing NTP', () => {
    const state = { ...BASE_STATE, configs: { 'TST-SP-01': 'hostname TST-SP-01\nip ssh version 2' } }
    const result = runComplianceScan(state)
    const ntpControl = result.controls.find(c => c.id === 'PCI-10.1')
    expect(ntpControl?.status).toBe('fail')
  })

  it('validates syslog logging', () => {
    const result = runComplianceScan(BASE_STATE)
    const logControl = result.controls.find(c => c.id === 'PCI-6.1')
    expect(logControl?.status).toBe('pass')
  })

  it('validates network segmentation', () => {
    const result = runComplianceScan(BASE_STATE)
    const segControl = result.controls.find(c => c.id === 'PCI-1.3')
    expect(segControl?.status).toBe('pass')
  })

  it('validates credential placeholders', () => {
    const result = runComplianceScan(BASE_STATE)
    const credControl = result.controls.find(c => c.id === 'PCI-2.1')
    expect(credControl?.status).toBe('pass')
  })

  it('validates NAC controls', () => {
    const result = runComplianceScan(BASE_STATE)
    const nacControl = result.controls.find(c => c.id === 'PCI-11.4')
    expect(nacControl?.status).toBe('pass')
  })

  it('handles no configs gracefully', () => {
    const state = { ...BASE_STATE, configs: {} }
    const result = runComplianceScan(state)
    const naControls = result.controls.filter(c => c.status === 'na')
    expect(naControls.length).toBeGreaterThan(0)
  })

  it('scans HIPAA controls', () => {
    const state = { ...BASE_STATE, compliance: ['HIPAA'] as any }
    const result = runComplianceScan(state)
    expect(result.controls.every(c => c.framework === 'HIPAA')).toBe(true)
    expect(result.controls.length).toBeGreaterThanOrEqual(5)
  })

  it('scans SOC2 controls', () => {
    const state = { ...BASE_STATE, compliance: ['SOC2'] as any }
    const result = runComplianceScan(state)
    expect(result.controls.every(c => c.framework === 'SOC2')).toBe(true)
    expect(result.controls.length).toBeGreaterThanOrEqual(4)
  })

  it('scans FedRAMP controls', () => {
    const state = { ...BASE_STATE, compliance: ['FedRAMP'] as any }
    const result = runComplianceScan(state)
    expect(result.controls.every(c => c.framework === 'FedRAMP')).toBe(true)
    expect(result.controls.length).toBeGreaterThanOrEqual(5)
  })

  it('scans ISO27001 controls', () => {
    const state = { ...BASE_STATE, compliance: ['ISO27001'] as any }
    const result = runComplianceScan(state)
    expect(result.controls.every(c => c.framework === 'ISO27001')).toBe(true)
    expect(result.controls.length).toBeGreaterThanOrEqual(4)
  })

  it('scans NIST CSF controls', () => {
    const state = { ...BASE_STATE, compliance: ['NIST_CSF'] as any }
    const result = runComplianceScan(state)
    expect(result.controls.every(c => c.framework === 'NIST_CSF')).toBe(true)
    expect(result.controls.length).toBeGreaterThanOrEqual(5)
  })

  it('scans multiple frameworks', () => {
    const state = { ...BASE_STATE, compliance: ['PCI', 'HIPAA', 'SOC2'] as any }
    const result = runComplianceScan(state)
    expect(result.frameworks).toEqual(['PCI', 'HIPAA', 'SOC2'])
    expect(result.controls.filter(c => c.framework === 'PCI').length).toBeGreaterThan(0)
    expect(result.controls.filter(c => c.framework === 'HIPAA').length).toBeGreaterThan(0)
    expect(result.controls.filter(c => c.framework === 'SOC2').length).toBeGreaterThan(0)
  })

  it('calculates score correctly', () => {
    const result = runComplianceScan(BASE_STATE)
    const scorable = result.summary.total - result.summary.na
    const expected = scorable > 0 ? Math.round((result.summary.pass / scorable) * 100) : 0
    expect(result.score).toBe(expected)
  })

  it('summary counts add up', () => {
    const result = runComplianceScan(BASE_STATE)
    const summed = result.summary.pass + result.summary.fail + result.summary.warn + result.summary.na
    expect(summed).toBe(result.summary.total)
  })
})

describe('exportComplianceReport', () => {
  it('generates valid markdown', () => {
    const result = runComplianceScan(BASE_STATE)
    const md = exportComplianceReport(result)
    expect(md).toContain('# Compliance Scan Report')
    expect(md).toContain('PCI')
    expect(md).toContain('PASS')
    expect(md).toContain('Score')
  })

  it('includes all controls', () => {
    const result = runComplianceScan(BASE_STATE)
    const md = exportComplianceReport(result)
    for (const c of result.controls) {
      expect(md).toContain(c.id)
    }
  })

  // Vendor-aware config-text checks — the scanner must recognize Juniper Junos
  // and Nokia SR Linux syntax, not just Cisco CLI, or it false-fails the
  // SSH/syslog/NTP controls on non-Cisco designs (mirrors validator M3).
  describe('vendor-aware config checks', () => {
    const stateWith = (
      vendor: string, useCase: AppState['useCase'], compliance: AppState['compliance'],
    ): AppState => {
      const devices = buildDeviceList({
        useCase, scale: 'small', siteCode: 'TST', vendorPrefs: [vendor],
      })
      const configs = generateAllConfigs(devices, useCase)
      return { ...BASE_STATE, vendorPrefs: [vendor], useCase, devices, configs, compliance }
    }
    const control = (r: ComplianceScanResult, id: string) => r.controls.find(c => c.id === id)

    it('Nokia DC: SSH v2 (PCI-2.3) detected via ssh-server', () => {
      const r = runComplianceScan(stateWith('Nokia', 'dc', ['PCI']))
      expect(control(r, 'PCI-2.3')?.status).toBe('pass')
    })

    it('Nokia DC: syslog (PCI-6.1) detected via logging block', () => {
      const r = runComplianceScan(stateWith('Nokia', 'dc', ['PCI']))
      expect(control(r, 'PCI-6.1')?.status).toBe('pass')
    })

    it('Nokia DC: NTP (PCI-10.1) detected via ntp block', () => {
      const r = runComplianceScan(stateWith('Nokia', 'dc', ['PCI']))
      expect(control(r, 'PCI-10.1')?.status).toBe('pass')
    })

    it('Juniper campus: SSH v2 (PCI-2.3) detected via protocol-version v2', () => {
      const r = runComplianceScan(stateWith('Juniper', 'campus', ['PCI']))
      expect(control(r, 'PCI-2.3')?.status).toBe('pass')
    })

    it('Juniper campus: syslog + NTP detected', () => {
      const r = runComplianceScan(stateWith('Juniper', 'campus', ['PCI']))
      expect(control(r, 'PCI-6.1')?.status).toBe('pass')
      expect(control(r, 'PCI-10.1')?.status).toBe('pass')
    })

    it('Juniper WAN: FedRAMP SSH (FDRP-AC-17) + audit (FDRP-AU-2) pass', () => {
      const r = runComplianceScan(stateWith('Juniper', 'wan', ['FedRAMP']))
      expect(control(r, 'FDRP-AC-17')?.status).toBe('pass')
      expect(control(r, 'FDRP-AU-2')?.status).toBe('pass')
    })

    it('no false config-text FAILs for Nokia/Juniper PCI scan', () => {
      for (const [vendor, uc] of [['Nokia', 'dc'], ['Juniper', 'campus']] as const) {
        const r = runComplianceScan(stateWith(vendor, uc, ['PCI']))
        const ssh = control(r, 'PCI-2.3')
        const log = control(r, 'PCI-6.1')
        const ntp = control(r, 'PCI-10.1')
        expect(ssh?.status, `${vendor} SSH`).not.toBe('fail')
        expect(log?.status, `${vendor} syslog`).not.toBe('fail')
        expect(ntp?.status, `${vendor} NTP`).not.toBe('fail')
      }
    })
  })
})
