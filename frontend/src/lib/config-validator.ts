/**
 * config-validator.ts — Client-side network config validation engine (M2)
 *
 * Replaces the fake Batfish placeholder with real static analysis of
 * generated device configs against intent constraints.
 */

import type { BOMDevice, UseCase } from '@/types'
import { isCommentLine, stripComments } from '@/lib/config-text'
import { deviceForConfig, extractFacts, extractFactsAnyDialect, factPlatform, type DeviceFacts, type FactName } from '@/lib/config-facts'

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

// A config line that is a comment in any supported vendor syntax — `!`
// (Cisco/Arista/Dell), `#` (Nokia/Cumulus/Junos/Fortinet headers), `//`.
// Commented-out example lines (e.g. `! neighbor 10.255.2.1 inherit ...`) must
// NOT be parsed as live config, or they produce phantom BGP peers.

/**
 * Z6 — the whole-config regex checks scanned COMMENT lines as if they were
 * live config. V-08 warned "18 devices have NVE/VXLAN but no EVPN" on a
 * gpu-nvidia design with no VXLAN anywhere: all 18 hits were the comment
 * `# … (jumbo MTU for RoCE/VXLAN payloads)`. Same class as the M9
 * `extractBgpNeighborIPs` fix, generalized — every content check now runs
 * against the comment-stripped config, so documentation can never be
 * mistaken for configuration.
 */
// Defined once in config-text.ts; re-exported for existing importers.
export { stripComments }

function stripCommentsAll(configs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [host, cfg] of Object.entries(configs)) out[host] = stripComments(cfg)
  return out
}

function extractBgpNeighborIPs(cfg: string): string[] {
  const ips: string[] = []
  for (const line of cfg.split('\n')) {
    if (isCommentLine(line)) continue
    const m = line.match(/neighbor\s+(\d+\.\d+\.\d+\.\d+)/)
    if (m && !ips.includes(m[1])) ips.push(m[1])
  }
  return ips
}

function extractLoopbacks(configs: Record<string, string>): Map<string, string[]> {
  const loopbacks = new Map<string, string[]>()
  for (const [host, cfg] of Object.entries(configs)) {
    const ips: string[] = []
    // Cisco / Arista / IOS-XR — `interface Loopback0` … `ip address X`
    const loMatch = cfg.match(/interface [Ll]oopback\d+[\s\S]*?(?=\ninterface |\n!|\n$)/g) ?? []
    for (const block of loMatch) {
      const ipMatch = block.match(/ip address\s+(\d+\.\d+\.\d+\.\d+)/)
      if (ipMatch) ips.push(ipMatch[1])
    }
    // Juniper Junos — `set interfaces lo0 unit 0 family inet address X/32`
    const junosLo = cfg.match(/interfaces lo0[\s\S]*?address\s+(\d+\.\d+\.\d+\.\d+)/g) ?? []
    for (const m of junosLo) {
      const ip = m.match(/address\s+(\d+\.\d+\.\d+\.\d+)/)
      if (ip) ips.push(ip[1])
    }
    // Nokia SR Linux — `interface system0 { … address X/32 }`
    const srlLo = cfg.match(/interface system0[\s\S]*?address\s+(\d+\.\d+\.\d+\.\d+)/g) ?? []
    for (const m of srlLo) {
      const ip = m.match(/address\s+(\d+\.\d+\.\d+\.\d+)/)
      if (ip) ips.push(ip[1])
    }
    // NVIDIA Cumulus NVUE — `nv set interface lo ip address X/32`
    for (const m of cfg.matchAll(/nv set interface lo ip address\s+(\d+\.\d+\.\d+\.\d+)/g)) {
      ips.push(m[1])
    }
    // Extreme EXOS — the loopback is a VLAN: `configure vlan Loopback0
    // ipaddress X 255.255.255.255` (Z8, same vendor-awareness class as M3/M4).
    for (const m of cfg.matchAll(/configure vlan \S*[Ll]oopback\S* ipaddress\s+(\d+\.\d+\.\d+\.\d+)/g)) {
      ips.push(m[1])
    }
    if (ips.length > 0) loopbacks.set(host, [...new Set(ips)])
  }
  return loopbacks
}

// Vendor-agnostic syntax detectors — Cisco/Arista/IOS-XR CLI, Juniper Junos
// `set` style, and Nokia SR Linux YANG `{ }` blocks all express the same
// concepts with different keywords. These regexes recognize all three so the
// validator doesn't false-fail multi-vendor designs.

/** Cloud-native tiers: provisioned via Terraform/API, no device CLI exists. */
const CLOUD_SUBLAYERS = new Set(['cloud-gw', 'cloud-transit'])

// ── Validation checks ─────────────────────────────────────────────────────────

/**
 * Facts for every config, computed once (AM3). The routing and fabric checks
 * used to carry their own cross-vendor regexes (`RE_BGP`, `RE_ISIS`, …) — the
 * site of M3, M6, M7 and Z6. They now query the per-dialect facts in
 * `config-facts.ts`, so no check here knows any vendor's syntax.
 */
type FactMap = Record<string, DeviceFacts>

function hostsWith(facts: FactMap, name: FactName): string[] {
  return Object.entries(facts).filter(([, f]) => f[name].state === 'present').map(([h]) => h)
}


function checkSingleUnderlay(
  facts: FactMap,
  useCase: UseCase | '',
): ValidationCheck {
  const hasISIS = hostsWith(facts, 'isis')
  const hasOSPF = hostsWith(facts, 'ospf')
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

  const expectedISIS = EVPN_FABRIC_USE_CASES.includes(useCase)
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

/**
 * The use cases that build an EVPN/VXLAN fabric out of physical switches.
 *
 * This list was duplicated five times and four copies wrongly included
 * `multicloud` and `aviatrix`. Those designs are cloud gateways and transit
 * VPCs — Terraform-provisioned virtual appliances with no CLI (AA1) — plus
 * the SD-WAN on-ramp added in AA2, whose overlay is OMP. There is no VXLAN
 * fabric, no EVPN and no IS-IS underlay to find, so a clean multicloud design
 * reported a hard V-03 FAIL ("requires BGP for EVPN/VXLAN"). It stayed latent
 * until AA2 gave those designs any configs to validate at all.
 *
 * The fifth copy — V-14's — had already been written with the correct three
 * entries, which is what a duplicated constant does: one copy learns and the
 * others do not.
 */
const EVPN_FABRIC_USE_CASES: (UseCase | '')[] = ['dc', 'gpu', 'multisite']

/** Designs whose overlay belongs to the cloud provider or the SD-WAN fabric. */
const CLOUD_OVERLAY_USE_CASES: (UseCase | '')[] = ['multicloud', 'aviatrix']

function checkBGPPresence(
  facts: FactMap,
  useCase: UseCase | '',
): ValidationCheck {
  const hasBGP = hostsWith(facts, 'bgp')

  if (CLOUD_OVERLAY_USE_CASES.includes(useCase) && hasBGP.length === 0) {
    return {
      id: 'V-03',
      name: 'BGP fabric configuration',
      category: 'Fabric',
      severity: 'info',
      detail: 'Cloud design — the transit overlay is provider-managed (see the Cloud Terraform export) and the on-prem on-ramp runs OMP, so no BGP is expected in the device CLI',
    }
  }

  if (EVPN_FABRIC_USE_CASES.includes(useCase) && hasBGP.length === 0) {
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
    // `ip address X` (IOS/NX-OS/EOS/OS10) and EXOS `ipaddress X MASK` (AM6 —
    // without the second form every EXOS underlay peer read as a phantom).
    for (const m of cfg.matchAll(/\bip ?address\s+(\d+\.\d+\.\d+\.\d+)/g)) allIPs.add(m[1])
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

/**
 * AM2 — V-06/V-07 read the normalized facts (config-facts.ts) instead of
 * their own cross-vendor regexes. The old V-07 detector began with the bare
 * word `MANAGEMENT`, which matched a comment banner or any `vrf management`
 * line, so it passed almost every config; and it accepted ANY one of NTP,
 * syslog or SNMP. It now requires NTP and remote syslog, per device, in that
 * device's own dialect. A config that cannot be matched to a BOM device is
 * read with `extractFactsAnyDialect` rather than a guessed dialect.
 */
function factsFor(host: string, cfg: string, devices: BOMDevice[]): DeviceFacts {
  const dev = deviceForConfig(host, devices)
  return dev ? extractFacts(cfg, factPlatform(dev)) : extractFactsAnyDialect(cfg)
}

function checkHostnameConsistency(
  configs: Record<string, string>,
  facts: FactMap,
  devices: BOMDevice[],
): ValidationCheck {
  const missing = Object.entries(facts).filter(([, f]) => f.hostname.state === 'absent').map(([h]) => h)

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

function checkManagementBlock(configs: Record<string, string>, facts: FactMap): ValidationCheck {
  const missingMgmt: string[] = []
  const gaps: string[] = []
  for (const [host, f] of Object.entries(facts)) {
    // `unknown` (e.g. FTD syslog lives in FMC, O-RU time comes from PTP) is
    // not a gap the design can close, so only `absent` counts.
    const lacking = (['ntp', 'syslog'] as const).filter(n => f[n].state === 'absent')
    if (lacking.length) {
      missingMgmt.push(host)
      gaps.push(`${host} (no ${lacking.map(n => n === 'ntp' ? 'NTP' : 'remote syslog').join(' / ')})`)
    }
  }

  if (missingMgmt.length > 0) {
    return {
      id: 'V-07',
      name: 'Management plane config',
      category: 'Security',
      severity: 'warn',
      detail: `${missingMgmt.length} device(s) missing management-plane services: ${gaps.slice(0, 3).join(', ')}`,
      devices: missingMgmt,
    }
  }

  return {
    id: 'V-07',
    name: 'Management plane config',
    category: 'Security',
    severity: 'pass',
    detail: `All ${Object.keys(configs).length} config(s) configure NTP and remote syslog`,
  }
}

function checkEVPNConsistency(
  facts: FactMap,
  useCase: UseCase | '',
): ValidationCheck {
  if (!EVPN_FABRIC_USE_CASES.includes(useCase)) {
    return {
      id: 'V-08',
      name: 'EVPN/VXLAN consistency',
      category: 'Fabric',
      severity: 'info',
      detail: CLOUD_OVERLAY_USE_CASES.includes(useCase)
        ? 'Cloud design — segmentation is the provider\'s (transit gateway / VPC), not a VXLAN fabric'
        : 'EVPN/VXLAN not expected for this use case',
    }
  }

  const hasNVE = hostsWith(facts, 'vxlan')
  const hasEVPN = hostsWith(facts, 'evpn')

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

  // Vendor-aware (Z6, same class as M3/M4). NVIDIA Cumulus NVUE expresses the
  // whole lossless contract in ONE profile — `nv set qos roce enable on` +
  // `mode lossless` configures PFC, ECN/WRED and buffer carving together — so
  // the Cisco/Arista keyword scan false-FAILED a correctly lossless fabric
  // once the explanatory comments were stripped.
  const hasPFC = hostnamesWithPattern(configs, /priority-flow-control|pfc|nv set qos roce\b/i)
  const hasECN = hostnamesWithPattern(configs, /ecn|explicit-congestion|nv set qos roce\b/i)
  const hasRDMA = hostnamesWithPattern(configs, /rdma|rocev2|dcqcn|nv set qos roce\b/i)

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
    // IOS/IOS-XE: `ip access-list [standard|extended] NAME`; NX-OS/EOS: `ip access-list NAME`.
    for (const m of cfg.matchAll(/^\s*ip access-list (?:standard |extended )?(\S+)/gm)) {
      definedACLs.add(m[1])
    }

    // References: interface `ip access-group NAME in|out` AND class-map
    // `match access-group name NAME`. The optional `name` keyword must be
    // skipped (it is not the ACL) and the trailing direction ignored.
    for (const m of cfg.matchAll(/access-group\s+(?:name\s+)?(\S+)/g)) {
      const name = m[1]
      if (name === 'in' || name === 'out' || name === 'name') continue
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

// Loopback *interface* presence across vendor syntaxes — Cisco/Arista

function checkLoopbackPresence(configs: Record<string, string>, facts: FactMap): ValidationCheck {
  const loopbacks = extractLoopbacks(configs)
  // A routing device is one running BGP, IS-IS or OSPF in its OWN dialect.
  // The old cross-vendor detector did not recognise EXOS (`enable bgp`), so
  // EXOS spines and leaves were never asked whether they had a loopback.
  const routingDevices = Object.entries(facts).filter(
    ([, f]) => f.bgp.state === 'present' || f.isis.state === 'present' || f.ospf.state === 'present',
  )
  const hasLoopback = (host: string, f: DeviceFacts) => loopbacks.has(host) || f.loopback.state === 'present'
  const missingLo = routingDevices
    .filter(([host, f]) => !hasLoopback(host, f))
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

  const withLoopback = routingDevices.filter(([host, f]) => hasLoopback(host, f)).length
  return {
    id: 'V-12',
    name: 'Loopback interfaces',
    category: 'Routing',
    severity: 'pass',
    detail: `${withLoopback} routing device(s) with loopback interfaces configured`,
  }
}

function checkBFDEnabled(
  facts: FactMap,
  useCase: UseCase | '',
): ValidationCheck {
  if (!EVPN_FABRIC_USE_CASES.includes(useCase)) {
    return {
      id: 'V-13',
      name: 'BFD for fast failover',
      category: 'Protocol',
      severity: 'info',
      detail: 'BFD check not critical for this use case',
    }
  }

  const hasBFD = hostsWith(facts, 'bfd')
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

// V-14: VXLAN/EVPN fabrics need a jumbo underlay MTU (≥9000) — VXLAN adds 50B
// of encap, so a default 1500 MTU underlay silently drops/fragments overlay
// traffic. Recognizes Cisco/Arista (`mtu 9216`, `system mtu`, `l2 mtu`),
// Junos (`mtu 9216`), Nokia (`mtu 9232`), Cumulus (`mtu 9216`), EXOS
// (`jumbo-frame-size 9216`). Only flags devices that actually run VXLAN/NVE.
function checkJumboMtu(
  facts: FactMap,
  useCase: UseCase | '',
): ValidationCheck {
  if (!EVPN_FABRIC_USE_CASES.includes(useCase)) {
    return {
      id: 'V-14',
      name: 'Jumbo MTU on VXLAN fabric',
      category: 'Fabric',
      severity: 'info',
      detail: 'Jumbo-MTU check applies to VXLAN/EVPN fabrics only',
    }
  }

  // A VTEP in its own dialect, and a jumbo MTU in its own dialect.
  const missing: string[] = []
  let vxlanDevices = 0
  for (const [host, f] of Object.entries(facts)) {
    if (f.vxlan.state !== 'present') continue
    vxlanDevices++
    if (f.jumboMtu.state !== 'present') missing.push(host)
  }

  if (vxlanDevices === 0) {
    return {
      id: 'V-14',
      name: 'Jumbo MTU on VXLAN fabric',
      category: 'Fabric',
      severity: 'info',
      detail: 'No VXLAN/NVE devices found to check',
    }
  }

  if (missing.length > 0) {
    return {
      id: 'V-14',
      name: 'Jumbo MTU on VXLAN fabric',
      category: 'Fabric',
      severity: 'warn',
      detail: `${missing.length} VXLAN device(s) lack a jumbo (≥9000) underlay MTU — overlay traffic may be dropped/fragmented: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
      devices: missing,
    }
  }

  return {
    id: 'V-14',
    name: 'Jumbo MTU on VXLAN fabric',
    category: 'Fabric',
    severity: 'pass',
    detail: `All ${vxlanDevices} VXLAN device(s) carry a jumbo underlay MTU`,
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
    // AA1: a multicloud/Aviatrix design is made entirely of cloud gateways and
    // transit VPCs, which are API/Terraform-provisioned and have no CLI at
    // all. Reporting that as a validation FAILURE was wrong — the design is
    // legitimate and complete; there is simply nothing CLI-shaped to check.
    const allCloud = devices.length > 0 && devices.every(d => CLOUD_SUBLAYERS.has(d.subLayer))
    return {
      checks: [{
        id: 'V-00',
        name: 'Configurations present',
        category: 'Identity',
        severity: allCloud ? 'info' : 'fail',
        detail: allCloud
          ? `All ${devices.length} device(s) are cloud-native (gateways / transit VPCs) — provisioned via Terraform or the provider API, so there is no device CLI to validate`
          : 'No generated configs to validate — generate configs in Step 3 first',
      }],
      summary: { pass: 0, fail: allCloud ? 0 : 1, warn: 0, info: allCloud ? 1 : 0 },
      timestamp: Date.now(),
    }
  }

  // Z6: every CONTENT check runs against the comment-stripped config so a
  // documentation line can never be read as configuration. V-11 keeps the raw
  // text — it asks whether generation produced anything at all.
  const live = stripCommentsAll(configs)
  const facts: FactMap = Object.fromEntries(
    Object.entries(configs).map(([host, cfg]) => [host, factsFor(host, cfg, devices)]),
  )

  const checks: ValidationCheck[] = [
    checkNonEmptyConfigs(configs),
    checkSingleUnderlay(facts, useCase),
    checkDuplicateRouterIds(live),
    checkBGPPresence(facts, useCase),
    checkBGPPeerSymmetry(live),
    checkEVPNConsistency(facts, useCase),
    checkHostnameConsistency(live, facts, devices),
    checkManagementBlock(live, facts),
    checkNoHardcodedSecrets(live),
    checkUndefinedACLReferences(live),
    checkGPUQoS(live, useCase),
    checkLoopbackPresence(live, facts),
    checkBFDEnabled(facts, useCase),
    checkJumboMtu(facts, useCase),
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
