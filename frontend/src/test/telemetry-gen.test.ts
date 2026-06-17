import { describe, it, expect } from 'vitest'
import {
  buildTelemetryTargets,
  genGNMICCollectorConfig,
  genTelegrafGNMIConfig,
  genPrometheusAlertRules,
  genGrafanaDashboardJSON,
  GNMI_PORT,
} from '@/lib/telemetry-gen'
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
      makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1 }),
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
    const devs = [makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1 })]
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
      makeDevice({ hostname: 'EDGE', subLayer: 'wan-edge', vendor: 'Cisco', count: 1 }),
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
