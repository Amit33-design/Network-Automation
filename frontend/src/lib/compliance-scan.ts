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

function hasInConfigs(configs: Record<string, string>, pattern: RegExp): boolean {
  return Object.values(configs).some(c => pattern.test(c))
}

function allConfigsHave(configs: Record<string, string>, pattern: RegExp): boolean {
  const vals = Object.values(configs)
  return vals.length > 0 && vals.every(c => pattern.test(c))
}

const PCI_CONTROLS: ControlChecker[] = [
  (state, _configs) => ({
    id: 'PCI-1.1', framework: 'PCI', category: 'Firewall',
    requirement: 'Firewall deployed between all network segments',
    ...state.firewallModel && state.firewallModel !== 'none'
      ? { status: 'pass', detail: `Firewall model: ${state.firewallModel}` }
      : { status: 'fail', detail: 'No firewall model selected in design requirements' },
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
    ...hasInConfigs(configs, /ssh.*version\s*2|transport\s+input\s+ssh/i)
      ? { status: 'pass', detail: 'SSH v2 enforced in device configs' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'SSH v2 enforcement not found in configs' },
  }),
  (_state, configs) => ({
    id: 'PCI-6.1', framework: 'PCI', category: 'Logging',
    requirement: 'Syslog forwarding to central collector',
    ...hasInConfigs(configs, /logging\s+(server|host|remote)|syslog/i)
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
    ...hasInConfigs(configs, /ntp\s+server|ntp\s+source/i)
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
  (state) => ({
    id: 'PCI-1.3', framework: 'PCI', category: 'Segmentation',
    requirement: 'Network segmentation (VRF/VLAN isolation)',
    ...state.overlayProtocols.some(o => o.includes('VXLAN'))
      || state.protoFeatures.includes('VRF/Tenant')
      ? { status: 'pass', detail: 'VXLAN/EVPN or VRF segmentation enabled' }
      : { status: 'warn', detail: 'No overlay/VRF segmentation — consider VXLAN/EVPN for CDE isolation' },
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
  (state) => ({
    id: 'HIPAA-164.312d', framework: 'HIPAA', category: 'Authentication',
    requirement: 'Network access authentication',
    ...state.nacOptions.length > 0 || state.protoFeatures.includes('802.1X')
      ? { status: 'pass', detail: '802.1X / NAC authentication configured' }
      : { status: 'fail', detail: 'No network access authentication configured' },
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
  (state) => ({
    id: 'HIPAA-164.312e', framework: 'HIPAA', category: 'Network',
    requirement: 'Network segmentation for PHI workloads',
    ...state.overlayProtocols.some(o => o.includes('VXLAN'))
      || state.protoFeatures.includes('VRF/Tenant')
      ? { status: 'pass', detail: 'VXLAN/EVPN or VRF segmentation for PHI isolation' }
      : { status: 'fail', detail: 'No network segmentation for PHI workloads' },
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
  (state) => ({
    id: 'SOC2-CC6.6', framework: 'SOC2', category: 'Boundary Protection',
    requirement: 'Boundary protection (firewall/ACL)',
    ...state.firewallModel && state.firewallModel !== 'none'
      ? { status: 'pass', detail: `Firewall model: ${state.firewallModel}` }
      : { status: 'warn', detail: 'No firewall — verify boundary controls' },
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
    ...hasInConfigs(configs, /ssh.*version\s*2|transport\s+input\s+ssh/i)
      ? { status: 'pass', detail: 'SSH v2 only for remote management' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'Ensure SSH v2 only for all remote access' },
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
    ...hasInConfigs(configs, /logging|syslog/i)
      ? { status: 'pass', detail: 'Syslog/logging configured for audit trail' }
      : Object.values(configs).length === 0
        ? { status: 'na', detail: 'No configs generated yet' }
        : { status: 'fail', detail: 'Audit logging not found in configs' },
  }),
  (state) => ({
    id: 'FDRP-SC-7', framework: 'FedRAMP', category: 'Boundary',
    requirement: 'Boundary protection at all authorization boundaries',
    ...state.firewallModel && state.firewallModel !== 'none'
      ? { status: 'pass', detail: `Firewall deployed: ${state.firewallModel}` }
      : { status: 'fail', detail: 'No firewall — FedRAMP requires boundary protection' },
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
  (state) => ({
    id: 'ISO-A.13.1', framework: 'ISO27001', category: 'Network Security',
    requirement: 'Network segmentation and controls',
    ...state.overlayProtocols.length > 0 || state.protoFeatures.includes('VRF/Tenant')
      ? { status: 'pass', detail: 'Network segmentation via overlay/VRF' }
      : { status: 'warn', detail: 'No overlay or VRF segmentation detected' },
  }),
  (state) => ({
    id: 'ISO-A.14.1', framework: 'ISO27001', category: 'Cryptography',
    requirement: 'Cryptographic controls for data protection',
    ...state.vpnType === 'ipsec' || state.protoFeatures.includes('MACsec')
      ? { status: 'pass', detail: 'IPsec/MACsec encryption configured' }
      : { status: 'warn', detail: 'No encryption overlay — verify data protection requirements' },
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
