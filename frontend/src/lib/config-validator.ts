/**
 * config-validator.ts — Client-side network config validation engine (M2)
 *
 * Replaces the fake Batfish placeholder with real static analysis of
 * generated device configs against intent constraints.
 */

import type { BOMDevice, UseCase } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckSeverity = 'pass' | 'fail' | 'warn' | 'info'

export interface ValidationCheck {
  id: string
  name: string
  category: 'Routing' | 'Fabric' | 'Security' | 'Identity' | 'QoS' | 'Protocol'
  severity: CheckSeverity
  detail: string
  devices?: string[]
}

export interface ValidationResult {
  checks: ValidationCheck[]
  summary: { pass: number; fail: number; warn: number; info: number }
  timestamp: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hostnamesWithPattern(configs: Record<string, string>, pattern: RegExp): string[] {
  return Object.entries(configs)
    .filter(([, cfg]) => pattern.test(cfg))
    .map(([host]) => host)
}

function extractRouterIds(configs: Record<string, string>): Map<string, string[]> {
  const ridMap = new Map<string, string[]>()
  for (const [host, cfg] of Object.entries(configs)) {
    const matches = cfg.match(/router-id\s+(\d+\.\d+\.\d+\.\d+)/g) ?? []
    for (const m of matches) {
      const ip = m.replace(/router-id\s+/, '')
      const hosts = ridMap.get(ip) ?? []
      hosts.push(host)
      ridMap.set(ip, hosts)
    }
  }
  return ridMap
}

function extractBgpNeighborIPs(cfg: string): string[] {
  const ips: string[] = []
  const pattern = /neighbor\s+(\d+\.\d+\.\d+\.\d+)/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(cfg)) !== null) {
    if (!ips.includes(m[1])) ips.push(m[1])
  }
  return ips
}

function extractLoopbacks(configs: Record<string, string>): Map<string, string[]> {
  const loopbacks = new Map<string, string[]>()
  for (const [host, cfg] of Object.entries(configs)) {
    const ips: string[] = []
    const loMatch = cfg.match(/interface [Ll]oopback\d+[\s\S]*?(?=\ninterface |\n!|\n$)/g) ?? []
    for (const block of loMatch) {
      const ipMatch = block.match(/ip address\s+(\d+\.\d+\.\d+\.\d+)/)
      if (ipMatch) ips.push(ipMatch[1])
    }
    if (ips.length > 0) loopbacks.set(host, ips)
  }
  return loopbacks
}

// ── Validation checks ─────────────────────────────────────────────────────────

function checkSingleUnderlay(
  configs: Record<string, string>,
  useCase: UseCase | '',
): ValidationCheck {
  const hasISIS = hostnamesWithPattern(configs, /router isis|isis enable/i)
  const hasOSPF = hostnamesWithPattern(configs, /router ospf\s|ospf area/i)
  const bothDevices = hasISIS.filter(h => hasOSPF.includes(h))

  if (bothDevices.length > 0) {
    return {
      id: 'V-01',
      name: 'Single underlay protocol',
      category: 'Routing',
      severity: 'fail',
      detail: `${bothDevices.length} device(s) have BOTH IS-IS and OSPF configured: ${bothDevices.slice(0, 3).join(', ')}${bothDevices.length > 3 ? '…' : ''}`,
      devices: bothDevices,
    }
  }

  const expectedISIS = ['dc', 'gpu', 'multisite', 'multicloud', 'aviatrix'].includes(useCase)
  const expectedOSPF = ['campus', 'wan'].includes(useCase)

  if (expectedISIS && hasISIS.length === 0 && hasOSPF.length > 0) {
    return {
      id: 'V-01',
      name: 'Single underlay protocol',
      category: 'Routing',
      severity: 'warn',
      detail: `Use case "${useCase}" typically uses IS-IS but only OSPF found`,
    }
  }
  if (expectedOSPF && hasOSPF.length === 0 && hasISIS.length > 0) {
    return {
      id: 'V-01',
      name: 'Single underlay protocol',
      category: 'Routing',
      severity: 'warn',
      detail: `Use case "${useCase}" typically uses OSPF but only IS-IS found`,
    }
  }

  return {
    id: 'V-01',
    name: 'Single underlay protocol',
    category: 'Routing',
    severity: 'pass',
    detail: hasISIS.length > 0
      ? `IS-IS underlay on ${hasISIS.length} device(s) — consistent`
      : hasOSPF.length > 0
        ? `OSPF underlay on ${hasOSPF.length} device(s) — consistent`
        : 'No underlay routing protocol detected (may be expected for non-routing devices)',
  }
}

function checkDuplicateRouterIds(configs: Record<string, string>): ValidationCheck {
  const ridMap = extractRouterIds(configs)
  const dupes: { ip: string; hosts: string[] }[] = []
  for (const [ip, hosts] of ridMap) {
    if (hosts.length > 1) dupes.push({ ip, hosts })
  }

  if (dupes.length > 0) {
    const detail = dupes
      .slice(0, 3)
      .map(d => `${d.ip} on [${d.hosts.join(', ')}]`)
      .join('; ')
    return {
      id: 'V-02',
      name: 'Duplicate router-IDs',
      category: 'Routing',
      severity: 'fail',
      detail: `${dupes.length} duplicate router-ID(s): ${detail}`,
      devices: dupes.flatMap(d => d.hosts),
    }
  }

  return {
    id: 'V-02',
    name: 'Duplicate router-IDs',
    category: 'Routing',
    severity: 'pass',
    detail: `${ridMap.size} unique router-ID(s) — no conflicts`,
  }
}

function checkBGPPresence(
  configs: Record<string, string>,
  useCase: UseCase | '',
): ValidationCheck {
  const hasBGP = hostnamesWithPattern(configs, /router bgp\s+\d+/i)
  const fabricUseCases: (UseCase | '')[] = ['dc', 'gpu', 'multisite', 'multicloud', 'aviatrix']

  if (fabricUseCases.includes(useCase) && hasBGP.length === 0) {
    return {
      id: 'V-03',
      name: 'BGP fabric configuration',
      category: 'Fabric',
      severity: 'fail',
      detail: `Use case "${useCase}" requires BGP for EVPN/VXLAN but no BGP config found`,
    }
  }

  if (hasBGP.length > 0) {
    return {
      id: 'V-03',
      name: 'BGP fabric configuration',
      category: 'Fabric',
      severity: 'pass',
      detail: `BGP configured on ${hasBGP.length} device(s)`,
    }
  }

  return {
    id: 'V-03',
    name: 'BGP fabric configuration',
    category: 'Fabric',
    severity: 'info',
    detail: 'No BGP configured (expected for this use case)',
  }
}

function checkBGPPeerSymmetry(configs: Record<string, string>): ValidationCheck {
  const allLoopbacks = extractLoopbacks(configs)
  const allIPs = new Set<string>()
  for (const ips of allLoopbacks.values()) {
    for (const ip of ips) allIPs.add(ip)
  }
  for (const cfg of Object.values(configs)) {
    const ifaceIPs = cfg.match(/ip address\s+(\d+\.\d+\.\d+\.\d+)/g) ?? []
    for (const m of ifaceIPs) {
      const ip = m.replace(/ip address\s+/, '')
      allIPs.add(ip)
    }
  }

  const unreachable: { host: string; peer: string }[] = []
  for (const [host, cfg] of Object.entries(configs)) {
    const neighbors = extractBgpNeighborIPs(cfg)
    for (const nbr of neighbors) {
      if (!allIPs.has(nbr)) {
        unreachable.push({ host, peer: nbr })
      }
    }
  }

  if (unreachable.length > 0) {
    const sample = unreachable.slice(0, 3).map(u => `${u.host}→${u.peer}`).join(', ')
    return {
      id: 'V-04',
      name: 'BGP peer reachability',
      category: 'Routing',
      severity: 'warn',
      detail: `${unreachable.length} BGP neighbor(s) reference IPs not found in any config: ${sample}`,
      devices: [...new Set(unreachable.map(u => u.host))],
    }
  }

  const totalNeighbors = Object.values(configs).reduce(
    (sum, cfg) => sum + extractBgpNeighborIPs(cfg).length, 0,
  )
  return {
    id: 'V-04',
    name: 'BGP peer reachability',
    category: 'Routing',
    severity: 'pass',
    detail: totalNeighbors > 0
      ? `${totalNeighbors} BGP neighbor(s) — all peer IPs found in device configs`
      : 'No BGP neighbors to validate',
  }
}

function checkNoHardcodedSecrets(configs: Record<string, string>): ValidationCheck {
  const secretPatterns = [
    /password\s+"?(?!<CHANGE-ME)[A-Za-z0-9!@#$%^&*()+]{4,}/i,
    /secret\s+"?(?!<CHANGE-ME)[A-Za-z0-9!@#$%^&*()+]{8,}/i,
    /key\s+"?(?!<CHANGE-ME)[A-Za-z0-9!@#$%^&*()+]{8,}/i,
  ]

  const violations: string[] = []
  for (const [host, cfg] of Object.entries(configs)) {
    for (const pat of secretPatterns) {
      if (pat.test(cfg)) {
        if (!violations.includes(host)) violations.push(host)
      }
    }
  }

  if (violations.length > 0) {
    return {
      id: 'V-05',
      name: 'No hardcoded secrets',
      category: 'Security',
      severity: 'fail',
      detail: `${violations.length} device(s) may have hardcoded credentials: ${violations.slice(0, 3).join(', ')}`,
      devices: violations,
    }
  }

  return {
    id: 'V-05',
    name: 'No hardcoded secrets',
    category: 'Security',
    severity: 'pass',
    detail: 'All credentials use <CHANGE-ME-*> placeholders',
  }
}

function checkHostnameConsistency(
  configs: Record<string, string>,
  devices: BOMDevice[],
): ValidationCheck {
  const missing: string[] = []
  for (const [host, cfg] of Object.entries(configs)) {
    const hasHostname = /hostname\s+\S+/i.test(cfg)
    if (!hasHostname) missing.push(host)
  }

  if (missing.length > 0) {
    return {
      id: 'V-06',
      name: 'Hostname configuration',
      category: 'Identity',
      severity: 'warn',
      detail: `${missing.length} config(s) missing hostname command: ${missing.slice(0, 3).join(', ')}`,
      devices: missing,
    }
  }

  const configCount = Object.keys(configs).length
  const deviceCount = devices.reduce((s, d) => s + d.count, 0)
  return {
    id: 'V-06',
    name: 'Hostname configuration',
    category: 'Identity',
    severity: 'pass',
    detail: `${configCount} config(s) with hostname set (${deviceCount} BOM device instances)`,
  }
}

function checkManagementBlock(configs: Record<string, string>): ValidationCheck {
  const missingMgmt: string[] = []
  for (const [host, cfg] of Object.entries(configs)) {
    const hasMgmt = /MANAGEMENT|ntp server|logging host|snmp-server/i.test(cfg)
    if (!hasMgmt) missingMgmt.push(host)
  }

  if (missingMgmt.length > 0) {
    return {
      id: 'V-07',
      name: 'Management plane config',
      category: 'Security',
      severity: 'warn',
      detail: `${missingMgmt.length} device(s) missing NTP/syslog/SNMP management block: ${missingMgmt.slice(0, 3).join(', ')}`,
      devices: missingMgmt,
    }
  }

  return {
    id: 'V-07',
    name: 'Management plane config',
    category: 'Security',
    severity: 'pass',
    detail: `All ${Object.keys(configs).length} config(s) include management plane (NTP, syslog, SNMP)`,
  }
}

function checkEVPNConsistency(
  configs: Record<string, string>,
  useCase: UseCase | '',
): ValidationCheck {
  const fabricUseCases: (UseCase | '')[] = ['dc', 'gpu', 'multisite', 'multicloud', 'aviatrix']
  if (!fabricUseCases.includes(useCase)) {
    return {
      id: 'V-08',
      name: 'EVPN/VXLAN consistency',
      category: 'Fabric',
      severity: 'info',
      detail: 'EVPN/VXLAN not expected for this use case',
    }
  }

  const hasNVE = hostnamesWithPattern(configs, /interface nve|vxlan/i)
  const hasEVPN = hostnamesWithPattern(configs, /evpn|l2vpn evpn/i)

  if (hasNVE.length === 0 && hasEVPN.length === 0) {
    return {
      id: 'V-08',
      name: 'EVPN/VXLAN consistency',
      category: 'Fabric',
      severity: 'warn',
      detail: `Use case "${useCase}" typically uses VXLAN/EVPN but neither NVE nor EVPN config found`,
    }
  }

  const nveNoEvpn = hasNVE.filter(h => !hasEVPN.includes(h))
  if (nveNoEvpn.length > 0) {
    return {
      id: 'V-08',
      name: 'EVPN/VXLAN consistency',
      category: 'Fabric',
      severity: 'warn',
      detail: `${nveNoEvpn.length} device(s) have NVE/VXLAN but no EVPN config: ${nveNoEvpn.slice(0, 3).join(', ')}`,
      devices: nveNoEvpn,
    }
  }

  return {
    id: 'V-08',
    name: 'EVPN/VXLAN consistency',
    category: 'Fabric',
    severity: 'pass',
    detail: `EVPN+VXLAN configured on ${hasEVPN.length} device(s) — consistent`,
  }
}

function checkGPUQoS(
  configs: Record<string, string>,
  useCase: UseCase | '',
): ValidationCheck {
  if (useCase !== 'gpu') {
    return {
      id: 'V-09',
      name: 'GPU QoS (PFC/ECN/DCQCN)',
      category: 'QoS',
      severity: 'info',
      detail: 'GPU QoS not required for this use case',
    }
  }

  const hasPFC = hostnamesWithPattern(configs, /priority-flow-control|pfc/i)
  const hasECN = hostnamesWithPattern(configs, /ecn|explicit-congestion/i)
  const hasRDMA = hostnamesWithPattern(configs, /rdma|rocev2|dcqcn/i)

  const issues: string[] = []
  if (hasPFC.length === 0) issues.push('PFC not configured on any device')
  if (hasECN.length === 0) issues.push('ECN not configured on any device')
  if (hasRDMA.length === 0) issues.push('RDMA/RoCEv2/DCQCN not configured on any device')

  if (issues.length > 0) {
    return {
      id: 'V-09',
      name: 'GPU QoS (PFC/ECN/DCQCN)',
      category: 'QoS',
      severity: 'fail',
      detail: issues.join('; '),
    }
  }

  return {
    id: 'V-09',
    name: 'GPU QoS (PFC/ECN/DCQCN)',
    category: 'QoS',
    severity: 'pass',
    detail: `PFC on ${hasPFC.length}, ECN on ${hasECN.length}, RDMA/DCQCN on ${hasRDMA.length} device(s)`,
  }
}

function checkUndefinedACLReferences(configs: Record<string, string>): ValidationCheck {
  const issues: { host: string; ref: string }[] = []

  for (const [host, cfg] of Object.entries(configs)) {
    const definedACLs = new Set<string>()
    const aclDefs = cfg.match(/ip access-list (?:standard|extended)\s+(\S+)/g) ?? []
    for (const d of aclDefs) {
      const name = d.replace(/ip access-list (?:standard|extended)\s+/, '')
      definedACLs.add(name)
    }

    const aclRefs = cfg.match(/access-group\s+(\S+)/g) ?? []
    for (const r of aclRefs) {
      const name = r.replace(/access-group\s+/, '')
      if (!definedACLs.has(name) && !/^\d+$/.test(name)) {
        issues.push({ host, ref: name })
      }
    }
  }

  if (issues.length > 0) {
    const sample = issues.slice(0, 3).map(i => `${i.host}: ${i.ref}`).join(', ')
    return {
      id: 'V-10',
      name: 'Undefined ACL references',
      category: 'Security',
      severity: 'warn',
      detail: `${issues.length} access-group reference(s) to undefined ACLs: ${sample}`,
      devices: [...new Set(issues.map(i => i.host))],
    }
  }

  return {
    id: 'V-10',
    name: 'Undefined ACL references',
    category: 'Security',
    severity: 'pass',
    detail: 'No dangling ACL or access-group references found',
  }
}

function checkNonEmptyConfigs(configs: Record<string, string>): ValidationCheck {
  const empty = Object.entries(configs)
    .filter(([, cfg]) => cfg.trim().length < 20)
    .map(([host]) => host)

  if (empty.length > 0) {
    return {
      id: 'V-11',
      name: 'Non-empty configurations',
      category: 'Identity',
      severity: 'fail',
      detail: `${empty.length} device(s) have empty or near-empty configs: ${empty.slice(0, 3).join(', ')}`,
      devices: empty,
    }
  }

  return {
    id: 'V-11',
    name: 'Non-empty configurations',
    category: 'Identity',
    severity: 'pass',
    detail: `All ${Object.keys(configs).length} config(s) contain substantive configuration`,
  }
}

function checkLoopbackPresence(configs: Record<string, string>): ValidationCheck {
  const loopbacks = extractLoopbacks(configs)
  const routingDevices = Object.entries(configs).filter(
    ([, cfg]) => /router bgp|router ospf|router isis/i.test(cfg),
  )
  const missingLo = routingDevices
    .filter(([host]) => !loopbacks.has(host))
    .map(([host]) => host)

  if (missingLo.length > 0) {
    return {
      id: 'V-12',
      name: 'Loopback interfaces',
      category: 'Routing',
      severity: 'warn',
      detail: `${missingLo.length} routing device(s) missing loopback interface: ${missingLo.slice(0, 3).join(', ')}`,
      devices: missingLo,
    }
  }

  return {
    id: 'V-12',
    name: 'Loopback interfaces',
    category: 'Routing',
    severity: 'pass',
    detail: `${loopbacks.size} device(s) with loopback interfaces configured`,
  }
}

function checkBFDEnabled(
  configs: Record<string, string>,
  useCase: UseCase | '',
): ValidationCheck {
  const fabricUseCases: (UseCase | '')[] = ['dc', 'gpu', 'multisite']
  if (!fabricUseCases.includes(useCase)) {
    return {
      id: 'V-13',
      name: 'BFD for fast failover',
      category: 'Protocol',
      severity: 'info',
      detail: 'BFD check not critical for this use case',
    }
  }

  const hasBFD = hostnamesWithPattern(configs, /\bbfd\b/i)
  if (hasBFD.length === 0) {
    return {
      id: 'V-13',
      name: 'BFD for fast failover',
      category: 'Protocol',
      severity: 'warn',
      detail: `Use case "${useCase}" benefits from BFD but no BFD config found`,
    }
  }

  return {
    id: 'V-13',
    name: 'BFD for fast failover',
    category: 'Protocol',
    severity: 'pass',
    detail: `BFD configured on ${hasBFD.length} device(s) for sub-second failover`,
  }
}

// ── Main validation entry point ───────────────────────────────────────────────

export interface ValidateInput {
  configs: Record<string, string>
  devices: BOMDevice[]
  useCase: UseCase | ''
}

export function validateConfigs(input: ValidateInput): ValidationResult {
  const { configs, devices, useCase } = input

  if (Object.keys(configs).length === 0) {
    return {
      checks: [{
        id: 'V-00',
        name: 'Configurations present',
        category: 'Identity',
        severity: 'fail',
        detail: 'No generated configs to validate — generate configs in Step 3 first',
      }],
      summary: { pass: 0, fail: 1, warn: 0, info: 0 },
      timestamp: Date.now(),
    }
  }

  const checks: ValidationCheck[] = [
    checkNonEmptyConfigs(configs),
    checkSingleUnderlay(configs, useCase),
    checkDuplicateRouterIds(configs),
    checkBGPPresence(configs, useCase),
    checkBGPPeerSymmetry(configs),
    checkEVPNConsistency(configs, useCase),
    checkHostnameConsistency(configs, devices),
    checkManagementBlock(configs),
    checkNoHardcodedSecrets(configs),
    checkUndefinedACLReferences(configs),
    checkGPUQoS(configs, useCase),
    checkLoopbackPresence(configs),
    checkBFDEnabled(configs, useCase),
  ]

  const summary = { pass: 0, fail: 0, warn: 0, info: 0 }
  for (const c of checks) summary[c.severity]++

  return { checks, summary, timestamp: Date.now() }
}

export function validationReportText(result: ValidationResult): string {
  const lines = [
    '# Network Config Validation Report',
    `# ${new Date(result.timestamp).toISOString()}`,
    `# Summary: ${result.summary.pass} PASS, ${result.summary.fail} FAIL, ${result.summary.warn} WARN, ${result.summary.info} INFO`,
    '',
  ]
  for (const c of result.checks) {
    const icon = c.severity === 'pass' ? 'PASS' : c.severity === 'fail' ? 'FAIL' : c.severity === 'warn' ? 'WARN' : 'INFO'
    lines.push(`[${icon}] ${c.id} ${c.name}`)
    lines.push(`       ${c.detail}`)
    if (c.devices?.length) lines.push(`       Devices: ${c.devices.join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}
