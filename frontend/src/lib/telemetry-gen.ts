/**
 * telemetry-gen.ts — Streaming telemetry & observability config generators
 * (Enterprise upgrade C1, ported from legacy `src/js/telemetry.js`)
 *
 * Pairs with the gNMI/eAPI telemetry blocks emitted by configgen.ts:
 *   genGNMICCollectorConfig  → gnmic.yml           (gnmic OpenConfig collector)
 *   genTelegrafGNMIConfig    → telegraf-gnmi.conf  (Telegraf gNMI input plugin)
 *   genPrometheusAlertRules  → prometheus-alerts.yml
 *   genGrafanaDashboardJSON  → grafana-dashboard.json
 *   genSNMPExporterConfig    → snmp.yml            (prom/snmp-exporter modules, G-A17)
 *   genSNMPPrometheusJob     → snmp-scrape.yml     (Prometheus scrape job, G-A17)
 *
 * SNMP/syslog/NetFlow collector configs already exist as
 * buildGrokPatternsConfig()/buildNetflowConfig() (M-51/M-52, Step6Deploy.tsx).
 */

import type { BOMDevice, UseCase } from '@/types'

// ── OpenConfig gNMI subscription paths ──────────────────────────────────────
export const GNMI_SUBS: Array<{ name: string; interval: string; paths: string[] }> = [
  {
    name: 'interface-state', interval: '10s', paths: [
      '/interfaces/interface/state',
      '/interfaces/interface/state/counters',
    ],
  },
  {
    name: 'bgp-neighbors', interval: '30s', paths: [
      '/network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state',
    ],
  },
  {
    name: 'platform-cpu', interval: '30s', paths: [
      '/components/component/cpu/utilization/state',
    ],
  },
  {
    name: 'platform-memory', interval: '30s', paths: [
      '/components/component/memory/state',
    ],
  },
  {
    name: 'igp-neighbors', interval: '30s', paths: [
      '/network-instances/network-instance/protocols/protocol/isis/levels/level/adjacencies/adjacency/state',
      '/network-instances/network-instance/protocols/protocol/ospf/areas/area/interfaces/interface/state',
    ],
  },
]

// ── gNMI port per OS ─────────────────────────────────────────────────────────
export const GNMI_PORT: Record<string, number> = {
  'ios-xe': 9339,
  'nxos':   50051,
  'eos':    6030,
  'junos':  32767,
  'sonic':  8080,
}

const OS_LABELS: Record<string, string> = {
  'ios-xe': 'IOS-XE', nxos: 'NX-OS', eos: 'EOS', junos: 'JunOS', sonic: 'SONiC',
}

/** Map BOM vendor + role to a gNMI-capable NOS identifier. */
function deviceOS(vendor: string, subLayer: string): string {
  if (vendor === 'Cisco')                          return (subLayer === 'spine' || subLayer === 'leaf') ? 'nxos' : 'ios-xe'
  if (vendor === 'Arista')                         return 'eos'
  if (vendor === 'Juniper')                        return 'junos'
  if (vendor === 'Dell EMC' || vendor === 'NVIDIA') return 'sonic'
  return 'eos'
}

export interface TelemetryTarget {
  name:     string
  hostname: string
  mgmtIp:   string
  port:     number
  os:       string
  role:     string
}

/** Expand BOM devices (capped at 4 instances each) into per-device gNMI targets. */
export function buildTelemetryTargets(devices: BOMDevice[]): TelemetryTarget[] {
  const targets: TelemetryTarget[] = []
  let octet = 11
  for (const dev of devices) {
    if (dev.subLayer === 'firewall' || dev.subLayer === 'gpu-compute') continue
    const os   = deviceOS(dev.vendor, dev.subLayer)
    const port = GNMI_PORT[os] ?? 6030
    const count = Math.min(dev.count, 4)
    for (let i = 1; i <= count; i++) {
      targets.push({
        name:     `${dev.hostname}-${String(i).padStart(2, '0')}`,
        hostname: dev.hostname,
        mgmtIp:   `10.0.0.${octet}`,
        port,
        os,
        role:     dev.subLayer,
      })
      octet++
    }
  }
  return targets
}

// ══════════════════════════════════════════════════════════════════════════
// gnmic YAML collector config
// Install: go install github.com/openconfig/gnmic@latest
// Docs:    https://gnmic.openconfig.net
// ══════════════════════════════════════════════════════════════════════════
export function genGNMICCollectorConfig(devices: BOMDevice[], orgName = ''): string {
  const targets  = buildTelemetryTargets(devices)
  const siteName = orgName ? orgName.toUpperCase().replace(/\s+/g, '-') : 'SITE'
  const date     = new Date().toISOString().slice(0, 10)

  const lines: string[] = []
  lines.push('# NetDesign AI — gnmic Streaming Telemetry Collector Config')
  lines.push(`# Site   : ${siteName}`)
  lines.push(`# Generated: ${date}`)
  lines.push('#')
  lines.push('# Install : go install github.com/openconfig/gnmic@latest')
  lines.push('# Usage   : gnmic subscribe --config gnmic.yml')
  lines.push('# Docs    : https://gnmic.openconfig.net')
  lines.push('')

  if (targets.length === 0) {
    lines.push('# No devices found — complete Steps 1-3 first to populate targets.')
    lines.push('targets: {}')
  } else {
    lines.push('targets:')
    for (const t of targets) {
      lines.push(`  ${t.name}:`)
      lines.push(`    address: ${t.mgmtIp}:${t.port}`)
      lines.push('    username: admin')
      lines.push('    password: ${DEVICE_PASSWORD}')
      lines.push('    skip-verify: true')
      lines.push('    timeout: 10s')
      lines.push(`    insecure: ${t.os === 'ios-xe' ? 'false' : 'true'}`)
      lines.push('    outputs:')
      lines.push('      - prometheus')
      lines.push('    subscriptions:')
      for (const sub of GNMI_SUBS) lines.push(`      - ${sub.name}`)
    }
  }
  lines.push('')

  lines.push('subscriptions:')
  for (const sub of GNMI_SUBS) {
    lines.push(`  ${sub.name}:`)
    lines.push('    paths:')
    for (const p of sub.paths) lines.push(`      - "${p}"`)
    lines.push('    mode: stream')
    lines.push('    stream-mode: sample')
    lines.push(`    sample-interval: ${sub.interval}`)
    lines.push('    encoding: json_ietf')
    lines.push('    heartbeat-interval: 5m')
    lines.push('')
  }

  lines.push('outputs:')
  lines.push('  prometheus:')
  lines.push('    type: prometheus')
  lines.push('    listen: :9804')
  lines.push('    path: /metrics')
  lines.push('    expiration: 2m')
  lines.push('    event-processors:')
  lines.push('      - add-labels')
  lines.push('')
  lines.push('  file-debug:')
  lines.push('    type: file')
  lines.push('    format: event')
  lines.push('    file-type: stdout')
  lines.push('')

  lines.push('processors:')
  lines.push('  add-labels:')
  lines.push('    event-strings:')
  lines.push('      - value-names:')
  lines.push('          - ".*"')
  lines.push('        transforms:')
  lines.push('          - path-base:')
  lines.push('              apply-on: ""')
  lines.push('              keep: false')
  lines.push('')

  lines.push('loader:')
  lines.push('  type: file')
  lines.push('  path: gnmic-targets.yml')
  lines.push('  watch-config: true')
  lines.push('')

  lines.push('# Prometheus scrape config (add to prometheus.yml):')
  lines.push('# scrape_configs:')
  lines.push('#   - job_name: gnmic')
  lines.push('#     static_configs:')
  lines.push('#       - targets: ["localhost:9804"]')

  return lines.join('\n')
}

// ══════════════════════════════════════════════════════════════════════════
// Telegraf gNMI input plugin + Prometheus output
// Install: https://docs.influxdata.com/telegraf/latest/install/
// Usage  : telegraf --config telegraf-gnmi.conf
// ══════════════════════════════════════════════════════════════════════════
export function genTelegrafGNMIConfig(devices: BOMDevice[], orgName = ''): string {
  const targets  = buildTelemetryTargets(devices)
  const siteName = orgName ? orgName.toUpperCase().replace(/\s+/g, '-') : 'SITE'
  const date     = new Date().toISOString().slice(0, 10)

  const byOS: Record<string, TelemetryTarget[]> = {}
  for (const t of targets) (byOS[t.os] ??= []).push(t)

  const lines: string[] = []
  lines.push('# NetDesign AI — Telegraf gNMI Input Plugin Config')
  lines.push(`# Site     : ${siteName}`)
  lines.push(`# Generated: ${date}`)
  lines.push('#')
  lines.push('# Install : https://docs.influxdata.com/telegraf/latest/install/')
  lines.push('# Usage   : telegraf --config telegraf-gnmi.conf')
  lines.push('')

  lines.push('[agent]')
  lines.push('  interval       = "10s"')
  lines.push('  flush_interval = "10s"')
  lines.push('  omit_hostname  = false')
  lines.push('')

  lines.push('[[outputs.prometheus_client]]')
  lines.push('  listen              = ":9804"')
  lines.push('  metric_version      = 2')
  lines.push('  expiration_interval = "2m"')
  lines.push('')

  if (targets.length === 0) {
    lines.push('# No devices found — complete Steps 1-3 first to populate targets.')
    lines.push('# [[inputs.gnmi]]')
    lines.push('#   addresses = ["10.0.0.11:6030"]')
  } else {
    const subs: Array<[string, string, string]> = [
      ['interface',       '/interfaces/interface/state/counters', '10s'],
      ['interface_state', '/interfaces/interface/state',          '10s'],
      ['bgp',             '/network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state', '30s'],
      ['cpu',             '/components/component/cpu/utilization/state', '30s'],
      ['memory',          '/components/component/memory/state',          '30s'],
    ]

    for (const os of Object.keys(byOS)) {
      const group   = byOS[os]
      const addrs   = group.map(t => `"${t.mgmtIp}:${t.port}"`)
      const osLabel = OS_LABELS[os] ?? os.toUpperCase()

      lines.push(`# ── ${osLabel} devices ──────────────────────────────────────────`)
      lines.push('[[inputs.gnmi]]')
      lines.push(`  addresses = [${addrs.join(', ')}]`)
      lines.push('  username  = "admin"')
      lines.push('  password  = "${DEVICE_PASSWORD}"')
      lines.push('  redial    = "10s"')
      if (os === 'ios-xe') {
        lines.push('  tls_server_name      = "device.local"')
        lines.push('  insecure_skip_verify = false')
      } else {
        lines.push('  insecure_skip_verify = true')
      }
      lines.push('')

      for (const [name, path, interval] of subs) {
        lines.push('  [[inputs.gnmi.subscription]]')
        lines.push(`    name              = "${name}"`)
        lines.push('    origin            = "openconfig"')
        lines.push(`    path              = "${path}"`)
        lines.push('    subscription_mode = "sample"')
        lines.push(`    sample_interval   = "${interval}"`)
        lines.push('')
      }
    }
  }

  lines.push('# Prometheus scrape config (add to prometheus.yml):')
  lines.push('# scrape_configs:')
  lines.push('#   - job_name: telegraf-gnmi')
  lines.push('#     static_configs:')
  lines.push('#       - targets: ["localhost:9804"]')

  return lines.join('\n')
}

// ══════════════════════════════════════════════════════════════════════════
// Prometheus alerting rules
// Pairs with gnmic/Telegraf scrape on :9804. Load via prometheus.yml
// `rule_files:`. Alert groups follow CLAUDE.md §19: BGP sessions/prefixes,
// interface errors/utilization, CPU/memory, device reachability, and
// (GPU use case) RoCEv2 CNP rate + PFC watchdog.
// ══════════════════════════════════════════════════════════════════════════
export function genPrometheusAlertRules(devices: BOMDevice[], useCase: UseCase | '' = ''): string {
  const targets = buildTelemetryTargets(devices)
  const date    = new Date().toISOString().slice(0, 10)
  const isGpu   = useCase === 'gpu'

  const lines: string[] = []
  lines.push('# NetDesign AI — Prometheus Alerting Rules (Enterprise upgrade C1)')
  lines.push(`# Generated: ${date}`)
  lines.push(`# Devices  : ${targets.length}`)
  lines.push('#')
  lines.push('# Pair with gnmic.yml / telegraf-gnmi.conf (scrape :9804) and load via')
  lines.push('# prometheus.yml `rule_files:`. Metric names follow the gnmic default')
  lines.push('# OpenConfig-path → Prometheus-name mapping; adjust label selectors')
  lines.push('# (source/name/neighbor_address/...) to match your collector output.')
  lines.push('')
  lines.push('groups:')

  // ── Device reachability ──────────────────────────────────────────────────
  lines.push('  - name: device-reachability')
  lines.push('    rules:')
  lines.push('      - alert: DeviceUnreachable')
  lines.push('        expr: up{job=~"gnmic|telegraf-gnmi"} == 0')
  lines.push('        for: 2m')
  lines.push('        labels:')
  lines.push('          severity: critical')
  lines.push('        annotations:')
  lines.push('          summary: "{{ $labels.source }} gNMI target unreachable"')
  lines.push('          description: "No telemetry received from {{ $labels.source }} for 2m."')
  lines.push('')

  // ── BGP sessions/prefixes ────────────────────────────────────────────────
  lines.push('  - name: bgp-sessions')
  lines.push('    rules:')
  lines.push('      - alert: BGPSessionDown')
  lines.push('        expr: |')
  lines.push('          network_instances_network_instance_protocols_protocol_bgp_neighbors_neighbor_state_session_state')
  lines.push('            != 6  # 6 = ESTABLISHED in OpenConfig bgp-types.yang')
  lines.push('        for: 1m')
  lines.push('        labels:')
  lines.push('          severity: critical')
  lines.push('        annotations:')
  lines.push('          summary: "BGP session down on {{ $labels.source }}"')
  lines.push('          description: "Neighbor {{ $labels.neighbor_address }} on {{ $labels.source }} is not ESTABLISHED."')
  lines.push('')
  lines.push('      - alert: BGPPrefixCountDropped')
  lines.push('        expr: |')
  lines.push('          network_instances_network_instance_protocols_protocol_bgp_neighbors_neighbor_state_prefixes_received_pre_policy')
  lines.push('            < (network_instances_network_instance_protocols_protocol_bgp_neighbors_neighbor_state_prefixes_received_pre_policy offset 15m) * 0.5')
  lines.push('        for: 5m')
  lines.push('        labels:')
  lines.push('          severity: warning')
  lines.push('        annotations:')
  lines.push('          summary: "BGP received-prefix count dropped >50% on {{ $labels.source }}"')
  lines.push('          description: "Neighbor {{ $labels.neighbor_address }} prefix count fell sharply vs. 15m ago."')
  lines.push('')

  // ── Interface errors / utilization ───────────────────────────────────────
  lines.push('  - name: interface-health')
  lines.push('    rules:')
  lines.push('      - alert: InterfaceErrorRateHigh')
  lines.push('        expr: |')
  lines.push('          rate(interfaces_interface_state_counters_in_errors[5m]) > 1')
  lines.push('            or rate(interfaces_interface_state_counters_out_errors[5m]) > 1')
  lines.push('        for: 5m')
  lines.push('        labels:')
  lines.push('          severity: warning')
  lines.push('        annotations:')
  lines.push('          summary: "Interface errors on {{ $labels.source }}/{{ $labels.name }}"')
  lines.push('          description: "Error rate > 1/s for 5m — check cabling/optics/CRC."')
  lines.push('')
  lines.push('      - alert: InterfaceOperDown')
  lines.push('        expr: interfaces_interface_state_oper_status != 1  # 1 = UP')
  lines.push('        for: 2m')
  lines.push('        labels:')
  lines.push('          severity: critical')
  lines.push('        annotations:')
  lines.push('          summary: "Interface {{ $labels.name }} down on {{ $labels.source }}"')
  lines.push('          description: "Operational status != UP for 2m."')
  lines.push('')

  // ── CPU / memory ──────────────────────────────────────────────────────────
  lines.push('  - name: system-resources')
  lines.push('    rules:')
  lines.push('      - alert: HighCPUUtilization')
  lines.push('        expr: components_component_cpu_utilization_state_instant > 85')
  lines.push('        for: 10m')
  lines.push('        labels:')
  lines.push('          severity: warning')
  lines.push('        annotations:')
  lines.push('          summary: "High CPU on {{ $labels.source }}"')
  lines.push('          description: "CPU utilization {{ $value }}% for 10m — check `show proc cpu sorted`."')
  lines.push('')
  lines.push('      - alert: HighMemoryUtilization')
  lines.push('        expr: |')
  lines.push('          (components_component_memory_state_utilized / components_component_memory_state_available) * 100 > 85')
  lines.push('        for: 10m')
  lines.push('        labels:')
  lines.push('          severity: warning')
  lines.push('        annotations:')
  lines.push('          summary: "High memory on {{ $labels.source }}"')
  lines.push('          description: "Memory utilization {{ $value }}% for 10m."')
  lines.push('')

  // ── GPU fabric (RoCEv2 / PFC) ─────────────────────────────────────────────
  if (isGpu) {
    lines.push('  - name: gpu-fabric')
    lines.push('    rules:')
    lines.push('      - alert: PFCWatchdogTriggered')
    lines.push('        expr: increase(interfaces_interface_state_counters_pfc_watchdog_events[5m]) > 0')
    lines.push('        for: 0m')
    lines.push('        labels:')
    lines.push('          severity: critical')
    lines.push('        annotations:')
    lines.push('          summary: "PFC watchdog fired on {{ $labels.source }}/{{ $labels.name }}"')
    lines.push('          description: "Priority-3 (RoCEv2 no-drop) queue paused — check for storage/incast congestion."')
    lines.push('')
    lines.push('      - alert: RoCEv2CNPRateHigh')
    lines.push('        expr: rate(qos_interfaces_interface_output_queues_queue_state_dropped_pkts{queue="3"}[5m]) > 1000')
    lines.push('        for: 5m')
    lines.push('        labels:')
    lines.push('          severity: warning')
    lines.push('        annotations:')
    lines.push('          summary: "High RoCEv2 CNP/ECN rate on {{ $labels.source }}/{{ $labels.name }}"')
    lines.push('          description: "Priority-3 queue drop/CNP rate > 1000/s for 5m — possible incast congestion."')
    lines.push('')
  }

  return lines.join('\n').replace(/\n+$/, '\n')
}

// ══════════════════════════════════════════════════════════════════════════
// Grafana dashboard JSON model
// Import via Grafana UI ("Import dashboard") or provision under
// /etc/grafana/provisioning/dashboards/. Datasource UID is templated as
// ${DS_PROMETHEUS} — point it at gnmic/Telegraf's :9804 scrape target
// (or VictoriaMetrics, see CLAUDE.md §19 docker-compose).
// ══════════════════════════════════════════════════════════════════════════
export function genGrafanaDashboardJSON(devices: BOMDevice[], orgName = '', useCase: UseCase | '' = ''): string {
  const targets  = buildTelemetryTargets(devices)
  const siteName = orgName || 'NetDesign AI Site'
  const isGpu    = useCase === 'gpu'
  const ds       = { type: 'prometheus', uid: '${DS_PROMETHEUS}' }

  const panels: Record<string, unknown>[] = [
    {
      id: 1, type: 'stat', title: 'Devices Reporting',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
      datasource: ds,
      targets: [{ expr: 'count(up{job=~"gnmic|telegraf-gnmi"} == 1)', legendFormat: 'up' }],
    },
    {
      id: 2, type: 'gauge', title: 'Fleet Avg CPU %',
      gridPos: { x: 6, y: 0, w: 6, h: 4 },
      datasource: ds,
      fieldConfig: { defaults: { unit: 'percent', max: 100, thresholds: { steps: [
        { color: 'green', value: null }, { color: 'yellow', value: 60 }, { color: 'red', value: 85 },
      ] } } },
      targets: [{ expr: 'avg(components_component_cpu_utilization_state_instant)', legendFormat: 'cpu' }],
    },
    {
      id: 3, type: 'gauge', title: 'Fleet Avg Memory %',
      gridPos: { x: 12, y: 0, w: 6, h: 4 },
      datasource: ds,
      fieldConfig: { defaults: { unit: 'percent', max: 100, thresholds: { steps: [
        { color: 'green', value: null }, { color: 'yellow', value: 70 }, { color: 'red', value: 85 },
      ] } } },
      targets: [{ expr: 'avg((components_component_memory_state_utilized / components_component_memory_state_available) * 100)', legendFormat: 'mem' }],
    },
    {
      id: 4, type: 'stat', title: 'BGP Sessions Established',
      gridPos: { x: 18, y: 0, w: 6, h: 4 },
      datasource: ds,
      targets: [{ expr: 'count(network_instances_network_instance_protocols_protocol_bgp_neighbors_neighbor_state_session_state == 6)', legendFormat: 'established' }],
    },
    {
      id: 5, type: 'timeseries', title: 'Interface Error Rate (per sec)',
      gridPos: { x: 0, y: 4, w: 12, h: 8 },
      datasource: ds,
      targets: [
        { expr: 'rate(interfaces_interface_state_counters_in_errors[5m])',  legendFormat: '{{source}}/{{name}} in' },
        { expr: 'rate(interfaces_interface_state_counters_out_errors[5m])', legendFormat: '{{source}}/{{name}} out' },
      ],
    },
    {
      id: 6, type: 'timeseries', title: 'Interface Throughput (bps)',
      gridPos: { x: 12, y: 4, w: 12, h: 8 },
      datasource: ds,
      targets: [
        { expr: 'rate(interfaces_interface_state_counters_in_octets[5m]) * 8',  legendFormat: '{{source}}/{{name}} rx' },
        { expr: 'rate(interfaces_interface_state_counters_out_octets[5m]) * 8', legendFormat: '{{source}}/{{name}} tx' },
      ],
    },
    {
      id: 7, type: 'table', title: 'Device Inventory',
      gridPos: { x: 0, y: 12, w: 24, h: 6 },
      datasource: ds,
      targets: [{ expr: 'up{job=~"gnmic|telegraf-gnmi"}', format: 'table', instant: true }],
    },
  ]

  if (isGpu) {
    panels.push({
      id: 8, type: 'timeseries', title: 'GPU Fabric — PFC Priority-3 Drops (RoCEv2)',
      gridPos: { x: 0, y: 18, w: 24, h: 8 },
      datasource: ds,
      targets: [
        { expr: 'rate(qos_interfaces_interface_output_queues_queue_state_dropped_pkts{queue="3"}[5m])', legendFormat: '{{source}}/{{name}} q3 drops' },
        { expr: 'increase(interfaces_interface_state_counters_pfc_watchdog_events[5m])', legendFormat: '{{source}}/{{name}} pfc-watchdog' },
      ],
    })
  }

  const dashboard = {
    title: `${siteName} — Network Telemetry`,
    description: `Auto-generated by NetDesign AI for ${targets.length} gNMI device target(s).`,
    uid: 'netdesign-telemetry',
    schemaVersion: 39,
    version: 1,
    tags: ['netdesign-ai', 'gnmi', 'network'],
    time: { from: 'now-6h', to: 'now' },
    refresh: '30s',
    templating: {
      list: [
        { name: 'DS_PROMETHEUS', type: 'datasource', query: 'prometheus', current: { text: 'Prometheus', value: 'Prometheus' } },
      ],
    },
    annotations: { list: [] },
    panels,
  }

  return JSON.stringify({ dashboard, overwrite: true, folderTitle: 'NetDesign AI' }, null, 2)
}

// ── SNMP Exporter Config (G-A17) ─────────────────────────────────────────────

const SNMP_MODULES: Array<{ name: string; walk: string[]; lookups?: string[]; comment: string }> = [
  {
    name: 'if_mib',
    walk: [
      '1.3.6.1.2.1.2',       // IF-MIB::interfaces
      '1.3.6.1.2.1.31.1.1',  // IF-MIB::ifXTable
    ],
    lookups: ['ifAlias', 'ifDescr', 'ifName'],
    comment: 'Interface counters (in/out octets, errors, discards, oper status)',
  },
  {
    name: 'host_resources',
    walk: [
      '1.3.6.1.2.1.25.3.3', // HOST-RESOURCES-MIB::hrProcessorTable (CPU)
      '1.3.6.1.2.1.25.2',   // HOST-RESOURCES-MIB::hrStorage (memory/disk)
    ],
    comment: 'CPU utilization, memory/disk usage',
  },
  {
    name: 'entity_sensor',
    walk: [
      '1.3.6.1.2.1.47.1.1', // ENTITY-MIB::entPhysicalTable
      '1.3.6.1.2.1.99',     // ENTITY-SENSOR-MIB::entPhySensorTable
    ],
    comment: 'Hardware entity sensors (temperature, fan, power supply)',
  },
  {
    name: 'bgp4',
    walk: [
      '1.3.6.1.2.1.15',     // BGP4-MIB
    ],
    comment: 'BGP peer state, prefixes received/advertised',
  },
  {
    name: 'tcp_udp',
    walk: [
      '1.3.6.1.2.1.6',  // TCP-MIB
      '1.3.6.1.2.1.7',  // UDP-MIB
    ],
    comment: 'TCP/UDP connection stats',
  },
]

export function genSNMPExporterConfig(devices: BOMDevice[]): string {
  const targets = buildTelemetryTargets(devices)
  const deviceList = targets.map(t => `#   ${t.hostname} (${t.os}) — ${t.mgmtIp}:161`)
  const lines: string[] = [
    '# ═══════════════════════════════════════════════════════════════',
    '# snmp.yml — Prometheus SNMP Exporter configuration',
    '# Generated by NetDesign AI — derived from BOM device list',
    '# Deploy alongside prom/snmp-exporter container',
    '# ═══════════════════════════════════════════════════════════════',
    '#',
    '# Target devices:',
    ...deviceList,
    '#',
    '',
    'auths:',
    '  # SNMPv3 authentication (recommended for production)',
    '  netdesign_v3:',
    '    community: ""',
    '    security_level: authPriv',
    '    username: netmon',
    '    password: <CHANGE-ME-snmp-auth-pass>',
    '    auth_protocol: SHA',
    '    priv_protocol: AES',
    '    priv_password: <CHANGE-ME-snmp-priv-pass>',
    '',
    '  # SNMPv2c fallback (lab/demo only — not for production)',
    '  netdesign_v2:',
    '    community: <CHANGE-ME-community>',
    '    version: 2',
    '',
    'modules:',
  ]

  for (const mod of SNMP_MODULES) {
    lines.push(`  # ${mod.comment}`)
    lines.push(`  ${mod.name}:`)
    lines.push('    walk:')
    for (const oid of mod.walk) {
      lines.push(`      - ${oid}`)
    }
    if (mod.lookups) {
      lines.push('    lookups:')
      for (const lu of mod.lookups) {
        lines.push(`      - source_indexes: [${lu}]`)
        lines.push(`        lookup: ${lu}`)
      }
    }
    lines.push('    auth:')
    lines.push('      - netdesign_v3')
    lines.push('')
  }

  return lines.join('\n')
}

export function genSNMPPrometheusJob(devices: BOMDevice[]): string {
  const targets = buildTelemetryTargets(devices)
  const targetIps = targets.map(t => `        - ${t.mgmtIp}  # ${t.hostname}`)

  const lines: string[] = [
    '# ═══════════════════════════════════════════════════════════════',
    '# Prometheus scrape job for prom/snmp-exporter',
    '# Add this block to your prometheus.yml scrape_configs section',
    '# Generated by NetDesign AI',
    '# ═══════════════════════════════════════════════════════════════',
    '',
    '  # ── SNMP Exporter: Interface counters + system health ───────',
    '  - job_name: snmp-if-mib',
    '    scrape_interval: 60s',
    '    scrape_timeout: 30s',
    '    metrics_path: /snmp',
    '    params:',
    '      module: [if_mib]',
    '      auth: [netdesign_v3]',
    '    static_configs:',
    '      - targets:',
    ...targetIps,
    '    relabel_configs:',
    '      - source_labels: [__address__]',
    '        target_label: __param_target',
    '      - source_labels: [__param_target]',
    '        target_label: instance',
    '      - target_label: __address__',
    '        replacement: snmp-exporter:9116',
    '',
    '  # ── SNMP Exporter: CPU/memory/disk ─────────────────────────',
    '  - job_name: snmp-host-resources',
    '    scrape_interval: 120s',
    '    scrape_timeout: 30s',
    '    metrics_path: /snmp',
    '    params:',
    '      module: [host_resources]',
    '      auth: [netdesign_v3]',
    '    static_configs:',
    '      - targets:',
    ...targetIps,
    '    relabel_configs:',
    '      - source_labels: [__address__]',
    '        target_label: __param_target',
    '      - source_labels: [__param_target]',
    '        target_label: instance',
    '      - target_label: __address__',
    '        replacement: snmp-exporter:9116',
    '',
    '  # ── SNMP Exporter: BGP peer state ─────────────────────────',
    '  - job_name: snmp-bgp4',
    '    scrape_interval: 60s',
    '    scrape_timeout: 30s',
    '    metrics_path: /snmp',
    '    params:',
    '      module: [bgp4]',
    '      auth: [netdesign_v3]',
    '    static_configs:',
    '      - targets:',
    ...targetIps,
    '    relabel_configs:',
    '      - source_labels: [__address__]',
    '        target_label: __param_target',
    '      - source_labels: [__param_target]',
    '        target_label: instance',
    '      - target_label: __address__',
    '        replacement: snmp-exporter:9116',
    '',
    '  # ── SNMP Exporter: Hardware sensors (temperature/fan/PSU) ──',
    '  - job_name: snmp-entity-sensor',
    '    scrape_interval: 120s',
    '    scrape_timeout: 30s',
    '    metrics_path: /snmp',
    '    params:',
    '      module: [entity_sensor]',
    '      auth: [netdesign_v3]',
    '    static_configs:',
    '      - targets:',
    ...targetIps,
    '    relabel_configs:',
    '      - source_labels: [__address__]',
    '        target_label: __param_target',
    '      - source_labels: [__param_target]',
    '        target_label: instance',
    '      - target_label: __address__',
    '        replacement: snmp-exporter:9116',
  ]

  return lines.join('\n')
}
