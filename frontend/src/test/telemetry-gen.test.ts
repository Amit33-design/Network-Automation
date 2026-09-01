import { describe, it, expect } from 'vitest'
import {
  buildTelemetryTargets,
  genGNMICCollectorConfig,
  genTelegrafGNMIConfig,
  genPrometheusAlertRules,
  genGrafanaDashboardJSON,
  genSNMPExporterConfig,
  genSNMPPrometheusJob,
  GNMI_PORT,
  speaksGnmi,
} from '@/lib/telemetry-gen'
import { buildDeviceList } from '@/lib/bom'
import type { BOMDevice } from '@/types'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'test-1',
    hostname: 'IAD-SPINE-A01',
    role: 'spine',
    subLayer: 'spine',
    model: 'Nexus 9336C-FX2',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 28000,
    totalPrice: 28000,
    speed: '100G',
    ports: 36,
    features: ['BGP', 'VXLAN'],
    ...overrides,
  }
}

// ── buildTelemetryTargets ───────────────────────────────────────────────────
describe('buildTelemetryTargets', () => {
  it('returns empty list for no devices', () => {
    expect(buildTelemetryTargets([])).toEqual([])
  })

  it('excludes firewall devices', () => {
    const devs = [makeDevice({ subLayer: 'firewall', vendor: 'Palo Alto', count: 1 })]
    expect(buildTelemetryTargets(devs)).toEqual([])
  })

  it('caps expansion at 4 instances per device and assigns sequential mgmt IPs', () => {
    const devs = [makeDevice({ hostname: 'IAD-LEAF-A', subLayer: 'leaf', count: 6 })]
    const targets = buildTelemetryTargets(devs)
    expect(targets).toHaveLength(4)
    expect(targets.map(t => t.name)).toEqual([
      'IAD-LEAF-A-01', 'IAD-LEAF-A-02', 'IAD-LEAF-A-03', 'IAD-LEAF-A-04',
    ])
    expect(targets.map(t => t.mgmtIp)).toEqual([
      '10.0.0.11', '10.0.0.12', '10.0.0.13', '10.0.0.14',
    ])
  })

  it('maps Cisco spine/leaf to NX-OS gNMI port, Cisco edge to IOS-XE', () => {
    const devs = [
      makeDevice({ hostname: 'NX-LEAF', subLayer: 'leaf', vendor: 'Cisco', count: 1 }),
      makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1, model: 'Catalyst 8300 Edge' }),
    ]
    const targets = buildTelemetryTargets(devs)
    expect(targets[0].os).toBe('nxos')
    expect(targets[0].port).toBe(GNMI_PORT.nxos)
    expect(targets[1].os).toBe('ios-xe')
    expect(targets[1].port).toBe(GNMI_PORT['ios-xe'])
  })

  it('maps Arista to EOS and Juniper to JunOS', () => {
    const devs = [
      makeDevice({ hostname: 'AR-LEAF', subLayer: 'leaf', vendor: 'Arista', count: 1 }),
      makeDevice({ hostname: 'JU-LEAF', subLayer: 'leaf', vendor: 'Juniper', count: 1 }),
    ]
    const targets = buildTelemetryTargets(devs)
    expect(targets[0].os).toBe('eos')
    expect(targets[1].os).toBe('junos')
  })
})

// ── genGNMICCollectorConfig ──────────────────────────────────────────────────
describe('genGNMICCollectorConfig', () => {
  it('emits placeholder targets block when no devices', () => {
    const cfg = genGNMICCollectorConfig([], 'Acme')
    expect(cfg).toContain('targets: {}')
    expect(cfg).toContain('No devices found')
  })

  it('emits per-device targets with address, subscriptions, and prometheus output', () => {
    const devs = [makeDevice({ hostname: 'IAD-SPINE-A01', subLayer: 'spine', vendor: 'Cisco', count: 1 })]
    const cfg = genGNMICCollectorConfig(devs, 'Acme Corp')
    expect(cfg).toContain('# Site   : ACME-CORP')
    expect(cfg).toContain('IAD-SPINE-A01-01:')
    expect(cfg).toContain(`address: 10.0.0.11:${GNMI_PORT.nxos}`)
    expect(cfg).toContain('insecure: true')
    expect(cfg).toContain('subscriptions:')
    expect(cfg).toContain('- interface-state')
    expect(cfg).toContain('listen: :9804')
  })

  it('marks IOS-XE targets as not insecure (TLS)', () => {
    const devs = [makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1, model: 'Catalyst 8300 Edge' })]
    const cfg = genGNMICCollectorConfig(devs)
    expect(cfg).toContain('insecure: false')
  })
})

// ── genTelegrafGNMIConfig ─────────────────────────────────────────────────────
describe('genTelegrafGNMIConfig', () => {
  it('emits placeholder comment when no devices', () => {
    const cfg = genTelegrafGNMIConfig([])
    expect(cfg).toContain('No devices found')
    expect(cfg).toContain('[[outputs.prometheus_client]]')
  })

  it('groups devices by OS into separate [[inputs.gnmi]] blocks', () => {
    const devs = [
      makeDevice({ hostname: 'NX-LEAF', subLayer: 'leaf', vendor: 'Cisco', count: 1 }),
      makeDevice({ hostname: 'AR-SPINE', subLayer: 'spine', vendor: 'Arista', count: 1 }),
    ]
    const cfg = genTelegrafGNMIConfig(devs, 'Acme')
    const matches = cfg.match(/\[\[inputs\.gnmi\]\]/g) ?? []
    expect(matches).toHaveLength(2)
    expect(cfg).toContain('NX-OS devices')
    expect(cfg).toContain('EOS devices')
    expect(cfg).toContain('"10.0.0.11:50051"')
    expect(cfg).toContain('"10.0.0.12:6030"')
  })

  it('sets TLS verification for IOS-XE and skips for other NOS', () => {
    const devs = [
      makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1, model: 'Catalyst 8300 Edge' }),
      makeDevice({ hostname: 'AR-SPINE', subLayer: 'spine', vendor: 'Arista', count: 1 }),
    ]
    const cfg = genTelegrafGNMIConfig(devs)
    expect(cfg).toContain('insecure_skip_verify = false')
    expect(cfg).toContain('insecure_skip_verify = true')
  })

  it('includes interface, bgp, cpu, and memory subscriptions per OS group', () => {
    const devs = [makeDevice({ hostname: 'NX-LEAF', subLayer: 'leaf', vendor: 'Cisco', count: 1 })]
    const cfg = genTelegrafGNMIConfig(devs)
    expect(cfg).toContain('name              = "interface"')
    expect(cfg).toContain('name              = "bgp"')
    expect(cfg).toContain('name              = "cpu"')
    expect(cfg).toContain('name              = "memory"')
  })
})

// ── genPrometheusAlertRules ───────────────────────────────────────────────────
describe('genPrometheusAlertRules', () => {
  it('produces the core alert groups for non-GPU use cases', () => {
    const devs = [makeDevice()]
    const rules = genPrometheusAlertRules(devs, 'dc')
    expect(rules).toContain('groups:')
    expect(rules).toContain('DeviceUnreachable')
    expect(rules).toContain('BGPSessionDown')
    expect(rules).toContain('BGPPrefixCountDropped')
    expect(rules).toContain('InterfaceErrorRateHigh')
    expect(rules).toContain('InterfaceOperDown')
    expect(rules).toContain('HighCPUUtilization')
    expect(rules).toContain('HighMemoryUtilization')
    expect(rules).not.toContain('gpu-fabric')
    expect(rules).not.toContain('PFCWatchdogTriggered')
  })

  it('adds GPU fabric alerts (PFC watchdog + RoCEv2 CNP) for gpu use case', () => {
    const devs = [makeDevice({ subLayer: 'spine' })]
    const rules = genPrometheusAlertRules(devs, 'gpu')
    expect(rules).toContain('gpu-fabric')
    expect(rules).toContain('PFCWatchdogTriggered')
    expect(rules).toContain('RoCEv2CNPRateHigh')
  })
})

// ── genGrafanaDashboardJSON ───────────────────────────────────────────────────
describe('genGrafanaDashboardJSON', () => {
  it('produces valid JSON with core panels', () => {
    const devs = [makeDevice()]
    const json = genGrafanaDashboardJSON(devs, 'Acme Corp', 'dc')
    const parsed = JSON.parse(json)
    expect(parsed.dashboard.title).toContain('Acme Corp')
    expect(parsed.dashboard.panels.length).toBeGreaterThanOrEqual(7)
    const titles = parsed.dashboard.panels.map((p: { title: string }) => p.title)
    expect(titles).toContain('Devices Reporting')
    expect(titles).toContain('Fleet Avg CPU %')
    expect(titles).toContain('BGP Sessions Established')
  })

  it('adds a GPU fabric panel for gpu use case', () => {
    const devs = [makeDevice({ subLayer: 'spine' })]
    const json = genGrafanaDashboardJSON(devs, 'Acme', 'gpu')
    const parsed = JSON.parse(json)
    const titles = parsed.dashboard.panels.map((p: { title: string }) => p.title)
    expect(titles.some((t: string) => t.includes('PFC'))).toBe(true)
  })

  it('omits GPU fabric panel for non-gpu use cases', () => {
    const devs = [makeDevice()]
    const json = genGrafanaDashboardJSON(devs, 'Acme', 'dc')
    const parsed = JSON.parse(json)
    const titles = parsed.dashboard.panels.map((p: { title: string }) => p.title)
    expect(titles.some((t: string) => t.includes('PFC'))).toBe(false)
  })
})

// ── SNMP Exporter Config (G-A17) ─────────────────────────────────────────────
describe('genSNMPExporterConfig (G-A17)', () => {
  it('generates snmp.yml with auth and module sections', () => {
    const devs = [makeDevice({ hostname: 'SPINE-A01', subLayer: 'spine', vendor: 'Cisco' })]
    const cfg = genSNMPExporterConfig(devs)
    expect(cfg).toContain('auths:')
    expect(cfg).toContain('netdesign_v3')
    expect(cfg).toContain('auth_protocol: SHA')
    expect(cfg).toContain('priv_protocol: AES')
    expect(cfg).toContain('modules:')
  })

  it('includes IF-MIB, HOST-RESOURCES, BGP4, ENTITY-SENSOR modules', () => {
    const devs = [makeDevice()]
    const cfg = genSNMPExporterConfig(devs)
    expect(cfg).toContain('if_mib:')
    expect(cfg).toContain('host_resources:')
    expect(cfg).toContain('bgp4:')
    expect(cfg).toContain('entity_sensor:')
    expect(cfg).toContain('tcp_udp:')
  })

  it('lists target devices in header comment', () => {
    const devs = [
      makeDevice({ hostname: 'SPINE-A01', subLayer: 'spine', vendor: 'Cisco' }),
      makeDevice({ hostname: 'LEAF-A01', subLayer: 'leaf', vendor: 'Arista' }),
    ]
    const cfg = genSNMPExporterConfig(devs)
    expect(cfg).toContain('SPINE-A01')
    expect(cfg).toContain('LEAF-A01')
  })

  it('uses CHANGE-ME placeholders for credentials', () => {
    const cfg = genSNMPExporterConfig([makeDevice()])
    expect(cfg).toContain('<CHANGE-ME-snmp-auth-pass>')
    expect(cfg).toContain('<CHANGE-ME-snmp-priv-pass>')
    expect(cfg).toContain('<CHANGE-ME-community>')
  })

  it('includes IF-MIB OID walks', () => {
    const cfg = genSNMPExporterConfig([makeDevice()])
    expect(cfg).toContain('1.3.6.1.2.1.2')
    expect(cfg).toContain('1.3.6.1.2.1.31.1.1')
  })
})

describe('genSNMPPrometheusJob (G-A17)', () => {
  it('generates Prometheus scrape job config for snmp-exporter', () => {
    const devs = [makeDevice({ hostname: 'SPINE-A01', subLayer: 'spine', vendor: 'Cisco' })]
    const cfg = genSNMPPrometheusJob(devs)
    expect(cfg).toContain('job_name: snmp-if-mib')
    expect(cfg).toContain('job_name: snmp-host-resources')
    expect(cfg).toContain('job_name: snmp-bgp4')
    expect(cfg).toContain('job_name: snmp-entity-sensor')
  })

  it('sets metrics_path to /snmp with module param', () => {
    const cfg = genSNMPPrometheusJob([makeDevice()])
    expect(cfg).toContain('metrics_path: /snmp')
    expect(cfg).toContain('module: [if_mib]')
    expect(cfg).toContain('auth: [netdesign_v3]')
  })

  it('includes device management IPs as targets', () => {
    const devs = [
      makeDevice({ hostname: 'SPINE-A01', subLayer: 'spine' }),
      makeDevice({ hostname: 'LEAF-A01', subLayer: 'leaf' }),
    ]
    const cfg = genSNMPPrometheusJob(devs)
    expect(cfg).toContain('10.0.0.11')
    expect(cfg).toContain('10.0.0.12')
    expect(cfg).toContain('# SPINE-A01')
    expect(cfg).toContain('# LEAF-A01')
  })

  it('configures relabel to route through snmp-exporter:9116', () => {
    const cfg = genSNMPPrometheusJob([makeDevice()])
    expect(cfg).toContain('replacement: snmp-exporter:9116')
    expect(cfg).toContain('target_label: __param_target')
    expect(cfg).toContain('target_label: instance')
  })
})

// ── AG6: the NOS in a telemetry target must be the NOS the device runs ───────
// `deviceOS` was a third independent vendor map (after ZTP's and rollback's).
// It knew five platforms and defaulted the rest to **Arista EOS**, so a Nokia
// SR Linux or Aruba CX switch went into the generated gNMI collector as an
// EOS target on port 6030, with EOS subscription paths.
describe('AG6 — telemetry targets name the real NOS', () => {
  const build = (vendor: string) => {
    const devices = buildDeviceList({
      useCase: 'dc', scale: 'medium', siteCode: 'AG6',
      totalEndpoints: 512, oversubscription: 3, bandwidthPerServer: '25G',
      vendorPrefs: [vendor],
    })
    return { devices, targets: buildTelemetryTargets(devices) }
  }

  it('resolves each vendor to its own NOS, never a stand-in', () => {
    const expected: Record<string, string> = {
      Arista: 'eos', Juniper: 'junos', Nokia: 'srl',
      NVIDIA: 'cumulus', 'Dell EMC': 'dellos10',
    }
    for (const [vendor, os] of Object.entries(expected)) {
      const { targets } = build(vendor)
      const own = targets.filter(t => t.role === 'spine' || t.role === 'leaf')
      expect(own.length, `${vendor}: no fabric targets`).toBeGreaterThan(0)
      for (const t of own) expect(t.os, `${vendor}/${t.hostname}`).toBe(os)
    }
  })

  it('gives every target the port its own NOS listens on', () => {
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC']) {
      for (const t of build(vendor).targets) {
        expect(GNMI_PORT[t.os], `${vendor}/${t.os} has no port`).toBeDefined()
        expect(t.port).toBe(GNMI_PORT[t.os])
      }
    }
  })

  it('excludes a NOS with no gNMI server rather than mislabelling it', () => {
    // A target the collector cannot speak to is worse than an absent one,
    // because it looks monitored.
    expect(speaksGnmi('fortios')).toBe(false)
    expect(speaksGnmi('panos')).toBe(false)
    expect(speaksGnmi('exos')).toBe(false)
    for (const vendor of ['Fortinet', 'Palo Alto', 'Extreme Networks']) {
      for (const t of build(vendor).targets) expect(speaksGnmi(t.os)).toBe(true)
    }
  })
})
