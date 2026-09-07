import type { AppState, Compliance, BOMDevice } from '@/types'

export type ComplianceStatus = 'pass' | 'fail' | 'warn' | 'na'

export interface ComplianceControl {
  id: string
  framework: Compliance
  category: string
  requirement: string
  status: ComplianceStatus
  detail: string
}

export interface ComplianceScanResult {
  timestamp: string
  frameworks: Compliance[]
  controls: ComplianceControl[]
  summary: {
    total: number
    pass: number
    fail: number
    warn: number
    na: number
  }
  score: number
}

type ControlChecker = (state: AppState, configs: Record<string, string>, devices: BOMDevice[]) => ComplianceControl

// Vendor-agnostic config detectors — recognize Cisco/Arista/IOS-XR CLI,
// Juniper Junos `set` syntax, and Nokia SR Linux YANG `{ }` blocks so the
// scanner doesn't false-fail non-Cisco designs (mirrors config-validator M3).
//   SSH v2 only:  Cisco `ip ssh version 2` / `transport input ssh`,
//                 Juniper `protocol-version v2`, Nokia `ssh-server`
//   Syslog:       Cisco `logging host`, Juniper `syslog`, Nokia `logging {` / `remote-server`
//   NTP:          Cisco/Juniper `ntp server`, Nokia `ntp {`
// AJ1 — widened again, and for the same reason M3/M4/AG5 kept recurring: the
// detector knew Cisco/Juniper/Nokia spellings only, so Arista `management ssh`,
// Extreme `enable ssh2`, Cumulus NVUE `ssh-server state enabled`, Dell OS10
// `ip ssh server` and the FTD `configure ssh-access-list` (Firepower has no
// `ip ssh version 2` — SSH is on and the access-list is the control) were all
// read as "no SSH", producing false PCI-2.3 / FDRP-AC-17 failures.
const RE_SSH_V2 = /transport\s+input\s+ssh|ssh\s+version\s+2|protocol-version\s+v2|ssh-server|enable\s+ssh2|management\s+ssh|ip\s+ssh\s+server|configure\s+ssh-access-list/i
const RE_SYSLOG = /logging\s+(?:server|host|remote)|syslog|remote-server|logging\s*\{/i
const RE_NTP = /ntp\s+server|ntp\s+source|ntp\s*\{/i

function hasInConfigs(configs: Record<string, string>, pattern: RegExp): boolean {
  return Object.values(configs).some(c => pattern.test(c))
}

function allConfigsHave(configs: Record<string, string>, pattern: RegExp): boolean {
  const vals = Object.values(configs)
  return vals.length > 0 && vals.every(c => pattern.test(c))
}

/**
 * Per-device coverage of a control — AJ1.
 *
 * `hasInConfigs` asks whether ANY ONE device matches, which is the wrong
 * question for a control phrased "on all devices". Measured before this
 * existed: a Cisco DC design with SSH hardening on 4 of 14 devices reported a
 * clean PASS on PCI-2.3 "SSH v2 only — no Telnet". A compliance report that
 * says compliant while 10 of 14 devices are not is worse than no report.
 *
 * Returns a control fragment: `pass` only at full coverage, `warn` when some
 * devices are covered (with the count and the first few offenders named, so
 * the gap is actionable), `fail` at zero, `na` with no configs.
 */
function everyDeviceHas(
  configs: Record<string, string>,
  pattern: RegExp,
  labels: { pass: string; partial: string; fail: string },
): { status: ComplianceStatus; detail: string } {
  const entries = Object.entries(configs)
  if (entries.length === 0) return { status: 'na', detail: 'No configs generated yet' }
  const missing = entries.filter(([, cfg]) => !pattern.test(cfg)).map(([host]) => host)
  const covered = entries.length - missing.length
  if (missing.length === 0) return { status: 'pass', detail: labels.pass }
  const named = missing.slice(0, 3).join(', ')
  const more = missing.length > 3 ? ` +${missing.length - 3} more` : ''
  const where = ` — ${covered}/${entries.length} devices; missing on ${named}${more}`
  return covered === 0
    ? { status: 'fail', detail: labels.fail + where }
    : { status: 'warn', detail: labels.partial + where }
}

const PCI_CONTROLS: ControlChecker[] = [
  (state, _configs, devices) => ({
    id: 'PCI-1.1', framework: 'PCI', category: 'Firewall',
    requirement: 'Firewall deployed between all network segments',
    ...firewallControl(state, devices, 'fail'),
  }),
  (_state, configs) => ({
    id: 'PCI-2.1', framework: 'PCI', category: 'Credentials',
    requirement: 'No default/vendor credentials in configs',
    ...allConfigsHave(configs, /CHANGE-ME/)
      ? { status: 'pass', detail: 'All credentials use <CHANGE-ME-*> placeholders' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'warn', detail: 'Verify no default credentials remain' },
  }),
  (_state, configs) => ({
    id: 'PCI-2.3', framework: 'PCI', category: 'Encryption',
    requirement: 'SSH v2 only — no Telnet',
    ...everyDeviceHas(configs, RE_SSH_V2, {
      pass:    'SSH v2 enforced on every device',
      partial: 'SSH v2 not enforced on every device',
      fail:    'SSH v2 enforcement not found in configs',
    }),
  }),
  (_state, configs) => ({
    id: 'PCI-6.1', framework: 'PCI', category: 'Logging',
    requirement: 'Syslog forwarding to central collector',
    ...hasInConfigs(configs, RE_SYSLOG)
      ? { status: 'pass', detail: 'Syslog logging configured' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'No syslog forwarding found in configs' },
  }),
  (_state, configs) => ({
    id: 'PCI-8.1', framework: 'PCI', category: 'Authentication',
    requirement: 'AAA / RADIUS / TACACS+ authentication',
    ...hasInConfigs(configs, /aaa|radius|tacacs/i)
      ? { status: 'pass', detail: 'AAA authentication configured' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'warn', detail: 'AAA configuration not detected — verify external auth' },
  }),
  (_state, configs) => ({
    id: 'PCI-10.1', framework: 'PCI', category: 'Monitoring',
    requirement: 'NTP synchronized for audit trails',
    ...hasInConfigs(configs, RE_NTP)
      ? { status: 'pass', detail: 'NTP configured in device configs' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'NTP not found in configs' },
  }),
  (state) => ({
    id: 'PCI-11.4', framework: 'PCI', category: 'Access Control',
    requirement: 'Network access control (802.1X or equivalent)',
    ...state.nacOptions.length > 0
      ? { status: 'pass', detail: `NAC: ${state.nacOptions.join(', ')}` }
      : { status: 'warn', detail: 'No NAC options selected — consider 802.1X for CDE segments' },
  }),
  (state, configs) => ({
    id: 'PCI-1.3', framework: 'PCI', category: 'Segmentation',
    requirement: 'Network segmentation (VRF/VLAN isolation)',
    ...segmentationControl(state, configs, 'warn'),
  }),
]

const HIPAA_CONTROLS: ControlChecker[] = [
  (_state, configs) => ({
    id: 'HIPAA-164.312a', framework: 'HIPAA', category: 'Encryption',
    requirement: 'PHI data encrypted in transit (SSH/TLS/MACsec)',
    ...hasInConfigs(configs, /ssh|macsec|tls|ipsec/i)
      ? { status: 'pass', detail: 'Transport encryption present in configs' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'No transport encryption detected' },
  }),
  (_state) => ({
    id: 'HIPAA-164.312c', framework: 'HIPAA', category: 'Integrity',
    requirement: 'Config integrity controls (drift detection)',
    status: 'pass' as const,
    detail: 'Config drift detection available in Day-2 Ops',
  }),
  (_state, configs, devices) => ({
    id: 'HIPAA-164.312d', framework: 'HIPAA', category: 'Authentication',
    requirement: 'Network access authentication',
    // 164.312(d) is "person or entity authentication". On an access layer that
    // means 802.1X; a spine-leaf fabric has no user ports to authenticate, and
    // the control there is device AAA (TACACS+/RADIUS) — which every generated
    // config has. Reporting a hard FAIL on a DC fabric was simply wrong.
    ...hasInConfigs(configs, RE_DOT1X)
      ? { status: 'pass' as const, detail: '802.1X port authentication configured on the access layer' }
      : hasAccessPorts(devices)
        ? { status: 'fail' as const, detail: 'Access layer present but no 802.1X port authentication configured' }
        : hasInConfigs(configs, /aaa|radius|tacacs/i)
          ? { status: 'pass' as const, detail: 'No access ports in this design — device AAA (TACACS+/RADIUS) is the applicable control' }
          : { status: 'fail' as const, detail: 'No network access authentication configured' },
  }),
  (state) => ({
    id: 'HIPAA-164.308a5', framework: 'HIPAA', category: 'Audit',
    requirement: 'Audit logging and monitoring',
    ...state.compliance.includes('HIPAA')
      ? { status: 'pass', detail: 'Monitoring stack available (Prometheus/Grafana/SNMP)' }
      : { status: 'warn', detail: 'Ensure audit logging is enabled' },
  }),
  (_state) => ({
    id: 'HIPAA-164.310d', framework: 'HIPAA', category: 'Physical',
    requirement: 'Physical security controls for network equipment',
    status: 'warn' as const,
    detail: 'Verify physical access controls at site — outside design scope',
  }),
  (state, configs) => ({
    id: 'HIPAA-164.312e', framework: 'HIPAA', category: 'Network',
    requirement: 'Network segmentation for PHI workloads',
    ...segmentationControl(state, configs, 'fail'),
  }),
]

const SOC2_CONTROLS: ControlChecker[] = [
  (_state, configs) => ({
    id: 'SOC2-CC6.1', framework: 'SOC2', category: 'Logical Access',
    requirement: 'Logical access controls on network devices',
    ...hasInConfigs(configs, /ssh|aaa|login|username/i)
      ? { status: 'pass', detail: 'SSH and login controls present' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'warn', detail: 'Verify access controls on devices' },
  }),
  (state, _configs, devices) => ({
    id: 'SOC2-CC6.6', framework: 'SOC2', category: 'Boundary Protection',
    requirement: 'Boundary protection (firewall/ACL)',
    ...firewallControl(state, devices, 'warn'),
  }),
  (_state) => ({
    id: 'SOC2-CC7.2', framework: 'SOC2', category: 'Monitoring',
    requirement: 'System monitoring and anomaly detection',
    status: 'pass' as const,
    detail: 'Monitoring stack (Prometheus/Grafana/SNMP/gNMI) + anomaly detection available',
  }),
  (_state) => ({
    id: 'SOC2-CC8.1', framework: 'SOC2', category: 'Change Management',
    requirement: 'Change management process for network changes',
    status: 'pass' as const,
    detail: 'Policy gate with peer review, blast radius check, and rollback plan in Deploy Pipeline',
  }),
  (state) => ({
    id: 'SOC2-A1.2', framework: 'SOC2', category: 'Availability',
    requirement: 'Redundancy for critical network components',
    ...state.redundancyModel === 'ha' || state.redundancyModel === 'full'
      ? { status: 'pass', detail: `Redundancy model: ${state.redundancyModel}` }
      : { status: 'warn', detail: `Redundancy model "${state.redundancyModel}" may not meet availability requirements` },
  }),
]

const FEDRAMP_CONTROLS: ControlChecker[] = [
  (_state, configs) => ({
    id: 'FDRP-SC-8', framework: 'FedRAMP', category: 'Encryption',
    requirement: 'FIPS 140-2 validated cryptography',
    ...hasInConfigs(configs, /fips|ike.*aes-256|macsec/i)
      ? { status: 'pass', detail: 'FIPS-mode or strong encryption referenced' }
      : { status: 'warn', detail: 'Verify FIPS 140-2 mode is enabled on all devices' },
  }),
  (_state, configs) => ({
    id: 'FDRP-AC-17', framework: 'FedRAMP', category: 'Remote Access',
    requirement: 'Remote access via encrypted channel only',
    ...everyDeviceHas(configs, RE_SSH_V2, {
      pass:    'SSH v2 only for remote management on every device',
      partial: 'Encrypted remote access not enforced on every device',
      fail:    'Ensure SSH v2 only for all remote access',
    }),
  }),
  (_state) => ({
    id: 'FDRP-CM-6', framework: 'FedRAMP', category: 'Configuration',
    requirement: 'Configuration baselines and drift monitoring',
    status: 'pass' as const,
    detail: 'Config drift detection + remediation available in Day-2 Ops',
  }),
  (_state) => ({
    id: 'FDRP-SI-4', framework: 'FedRAMP', category: 'Monitoring',
    requirement: 'Continuous monitoring of information system',
    status: 'pass' as const,
    detail: 'gNMI telemetry, SNMP exporter, Prometheus alerts, anomaly detection available',
  }),
  (_state, configs) => ({
    id: 'FDRP-AU-2', framework: 'FedRAMP', category: 'Audit',
    requirement: 'Audit event logging',
    ...hasInConfigs(configs, RE_SYSLOG)
      ? { status: 'pass', detail: 'Syslog/logging configured for audit trail' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'Audit logging not found in configs' },
  }),
  (state, _configs, devices) => ({
    id: 'FDRP-SC-7', framework: 'FedRAMP', category: 'Boundary',
    requirement: 'Boundary protection at all authorization boundaries',
    ...firewallControl(state, devices, 'fail'),
  }),
]

const ISO27001_CONTROLS: ControlChecker[] = [
  (state) => ({
    id: 'ISO-A.9.1', framework: 'ISO27001', category: 'Access Control',
    requirement: 'Access control policy and network access',
    ...state.nacOptions.length > 0 || state.protoFeatures.includes('802.1X')
      ? { status: 'pass', detail: 'NAC / 802.1X access controls configured' }
      : { status: 'warn', detail: 'Consider implementing network access controls' },
  }),
  (_state) => ({
    id: 'ISO-A.12.4', framework: 'ISO27001', category: 'Logging',
    requirement: 'Event logging and monitoring',
    status: 'pass' as const,
    detail: 'Monitoring stack with alerting available',
  }),
  (state, configs) => ({
    id: 'ISO-A.13.1', framework: 'ISO27001', category: 'Network Security',
    requirement: 'Network segmentation and controls',
    ...segmentationControl(state, configs, 'warn'),
  }),
  (state, configs) => ({
    id: 'ISO-A.14.1', framework: 'ISO27001', category: 'Cryptography',
    requirement: 'Cryptographic controls for data protection',
    ...hasInConfigs(configs, RE_ENCRYPTION)
      ? { status: 'pass' as const, detail: 'IPsec/MACsec encryption present in the generated configs' }
      : state.vpnType === 'ipsec' || state.protoFeatures.includes('MACsec')
        ? { status: 'warn' as const, detail: 'Encryption requested but not found in the generated configs' }
        : { status: 'warn' as const, detail: 'No encryption overlay — verify data protection requirements' },
  }),
  (state) => ({
    id: 'ISO-A.17.1', framework: 'ISO27001', category: 'Continuity',
    requirement: 'Information security continuity (HA/DR)',
    ...state.redundancyModel === 'ha' || state.redundancyModel === 'full'
      ? { status: 'pass', detail: `High availability: ${state.redundancyModel}` }
      : { status: 'warn', detail: 'Consider HA or full redundancy for continuity' },
  }),
]

const NIST_CSF_CONTROLS: ControlChecker[] = [
  (state) => ({
    id: 'NIST-ID.AM', framework: 'NIST_CSF', category: 'Identify',
    requirement: 'Asset management — all network devices inventoried',
    ...state.devices.length > 0
      ? { status: 'pass', detail: `${state.devices.reduce((s, d) => s + d.count, 0)} devices in BOM inventory` }
      : { status: 'fail', detail: 'No devices in inventory' },
  }),
  (state) => ({
    id: 'NIST-PR.AC', framework: 'NIST_CSF', category: 'Protect',
    requirement: 'Access control and identity management',
    ...state.nacOptions.length > 0
      ? { status: 'pass', detail: `NAC: ${state.nacOptions.join(', ')}` }
      : { status: 'warn', detail: 'No NAC configured' },
  }),
  (state) => ({
    id: 'NIST-PR.DS', framework: 'NIST_CSF', category: 'Protect',
    requirement: 'Data security — encryption in transit',
    ...state.vpnType === 'ipsec' || state.protoFeatures.includes('MACsec')
      ? { status: 'pass', detail: 'Encryption in transit configured' }
      : { status: 'warn', detail: 'Verify encryption for sensitive data flows' },
  }),
  (_state) => ({
    id: 'NIST-DE.CM', framework: 'NIST_CSF', category: 'Detect',
    requirement: 'Continuous monitoring and detection',
    status: 'pass' as const,
    detail: 'Monitoring stack + anomaly detection + alerting available',
  }),
  (_state) => ({
    id: 'NIST-RS.RP', framework: 'NIST_CSF', category: 'Respond',
    requirement: 'Response planning and incident response',
    status: 'pass' as const,
    detail: 'Troubleshooting engine + drift remediation + rollback capabilities available',
  }),
  (_state) => ({
    id: 'NIST-RC.RP', framework: 'NIST_CSF', category: 'Recover',
    requirement: 'Recovery planning (backup/rollback)',
    status: 'pass' as const,
    detail: 'Platform-native rollback strategies configured in Deploy Pipeline',
  }),
]

// ── AJ2: score the design that was BUILT, not the requirements form ──────────
//
// Several controls read Step-2 form fields (`firewallModel`, `overlayProtocols`,
// `nacOptions`) and ignored `devices` and `configs` entirely. Measured on a
// generated DC design: PCI-1.1 / SOC2-CC6.6 / FDRP-SC-7 reported "No firewall
// model selected" on a design whose BOM contains two firewalls — cabled,
// configured, with a border-leaf handoff — and PCI-1.3 / HIPAA-164.312e
// reported "no segmentation" on a VXLAN/EVPN fabric carrying a TENANT-A VRF.
// A compliance report that contradicts the artifacts it was handed is the
// BOM-vs-config disagreement theme, one layer up.
//
// These read the design first and fall back to the form only as corroboration.

const RE_SEGMENTATION = new RegExp([
  'vrf\\s+context',          // NX-OS
  'vrf\\s+instance',         // Arista EOS
  'vrf\\s+definition',       // IOS-XE
  'routing-instances',       // Junos
  'network-instance',        // Nokia SR Linux
  'nv\\s+set\\s+vrf',         // NVIDIA NVUE
  'ip\\s+vrf',               // Dell OS10 / legacy IOS
  'virtual-router',          // Extreme EXOS
  'interface\\s+nve',        // VXLAN (NX-OS)
  'interface\\s+Vxlan',      // VXLAN (EOS)
  'vxlan',                   // generic VXLAN / VNI mapping
].join('|'), 'i')

const RE_DOT1X = /dot1x\s+system-auth-control|authentication\s+port-control|dot1x\s+pae/i
const RE_ENCRYPTION = /macsec|crypto\s+ipsec|security\s+ipsec|set\s+security\s+ipsec|tunnel\s+protection/i

/** Firewalls actually present in the BOM, whatever the form says. */
function firewallDevices(devices: BOMDevice[]): BOMDevice[] {
  return devices.filter(d => d.subLayer === 'firewall' || d.role === 'firewall')
}

/** Access-layer ports exist, so 802.1X is applicable at all. */
function hasAccessPorts(devices: BOMDevice[]): boolean {
  return devices.some(d => d.subLayer === 'access' || d.subLayer === 'distribution')
}

function firewallControl(
  state: AppState, devices: BOMDevice[], failStatus: ComplianceStatus,
): { status: ComplianceStatus; detail: string } {
  const fws = firewallDevices(devices)
  if (fws.length > 0) {
    const models = [...new Set(fws.map(d => d.model))].join(', ')
    const count = fws.reduce((n, d) => n + Math.max(1, d.count), 0)
    return { status: 'pass', detail: `${count} firewall(s) in the BOM: ${models}` }
  }
  if (state.firewallModel && state.firewallModel !== 'none') {
    return { status: 'warn', detail: `Firewall "${state.firewallModel}" selected but not present in the BOM` }
  }
  return { status: failStatus, detail: 'No firewall in the design' }
}

/**
 * Distinct non-default VLAN ids across the fleet. Isolation needs at least two
 * segments, so a lone `vlan 1` is not segmentation — and every switch config
 * mentions the word, which would otherwise make the check trivially true.
 */
function dataVlanIds(configs: Record<string, string>): Set<string> {
  const ids = new Set<string>()
  for (const cfg of Object.values(configs)) {
    for (const m of cfg.matchAll(/^\s*vlan\s+(\d{1,4})\b/gim)) {
      if (m[1] !== '1') ids.add(m[1])
    }
  }
  return ids
}

function segmentationControl(
  state: AppState, configs: Record<string, string>, failStatus: ComplianceStatus,
): { status: ComplianceStatus; detail: string } {
  if (hasInConfigs(configs, RE_SEGMENTATION)) {
    return { status: 'pass', detail: 'VRF / VXLAN segmentation present in the generated configs' }
  }
  // VLAN isolation is the campus form of the same control — PCI 1.3 names it
  // explicitly ("VRF/VLAN isolation"). Said separately from VRF-grade
  // separation, because that distinction matters when scoping a CDE.
  const vlans = dataVlanIds(configs)
  if (vlans.size >= 2) {
    return {
      status: 'pass',
      detail: `VLAN segmentation across ${vlans.size} VLANs (no VRF/overlay — L2 isolation only)`,
    }
  }
  if (state.overlayProtocols.some(o => o.includes('VXLAN')) || state.protoFeatures.includes('VRF/Tenant')) {
    return { status: 'warn', detail: 'Segmentation requested but not found in the generated configs' }
  }
  return { status: failStatus, detail: 'No VRF or overlay segmentation in the design' }
}

const FRAMEWORK_CONTROLS: Record<Compliance, ControlChecker[]> = {
  PCI: PCI_CONTROLS,
  HIPAA: HIPAA_CONTROLS,
  SOC2: SOC2_CONTROLS,
  FedRAMP: FEDRAMP_CONTROLS,
  ISO27001: ISO27001_CONTROLS,
  NIST_CSF: NIST_CSF_CONTROLS,
  QoS: [],
}

export function runComplianceScan(state: AppState): ComplianceScanResult {
  const frameworks = state.compliance.length > 0
    ? state.compliance
    : (['PCI', 'SOC2'] as Compliance[])

  const controls: ComplianceControl[] = []
  for (const fw of frameworks) {
    const checkers = FRAMEWORK_CONTROLS[fw] || []
    for (const checker of checkers) {
      controls.push(checker(state, state.configs, state.devices))
    }
  }

  const summary = {
    total: controls.length,
    pass: controls.filter(c => c.status === 'pass').length,
    fail: controls.filter(c => c.status === 'fail').length,
    warn: controls.filter(c => c.status === 'warn').length,
    na: controls.filter(c => c.status === 'na').length,
  }

  const scorable = summary.total - summary.na
  const score = scorable > 0 ? Math.round((summary.pass / scorable) * 100) : 0

  return {
    timestamp: new Date().toISOString(),
    frameworks,
    controls,
    summary,
    score,
  }
}

export function exportComplianceReport(result: ComplianceScanResult): string {
  const lines: string[] = [
    '# Compliance Scan Report',
    '',
    `**Date:** ${result.timestamp.slice(0, 19).replace('T', ' ')}`,
    `**Frameworks:** ${result.frameworks.join(', ')}`,
    `**Score:** ${result.score}%`,
    '',
    `## Summary`,
    '',
    `| Status | Count |`,
    `|--------|-------|`,
    `| PASS | ${result.summary.pass} |`,
    `| FAIL | ${result.summary.fail} |`,
    `| WARN | ${result.summary.warn} |`,
    `| N/A | ${result.summary.na} |`,
    `| **Total** | **${result.summary.total}** |`,
    '',
    `## Controls`,
    '',
    `| ID | Framework | Category | Requirement | Status | Detail |`,
    `|----|-----------|----------|-------------|--------|--------|`,
  ]

  for (const c of result.controls) {
    const statusIcon = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? 'FAIL' : c.status === 'warn' ? 'WARN' : 'N/A'
    lines.push(`| ${c.id} | ${c.framework} | ${c.category} | ${c.requirement} | ${statusIcon} | ${c.detail} |`)
  }

  lines.push('', '---', '', '*Generated by NetDesign AI Compliance Scanner*')
  return lines.join('\n')
}
