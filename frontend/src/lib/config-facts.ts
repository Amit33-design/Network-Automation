/**
 * NetDesign AI — normalized configuration facts (AM1)
 * ====================================================
 * Turns one device's configuration, in whatever dialect it is written, into a
 * small set of dialect-free FACTS that checks can query instead of scanning
 * raw text.
 *
 * Why this exists
 * ---------------
 * Every compliance and validation check used to carry its own regex listing
 * every vendor's spelling of the thing it looked for. Each time a dialect was
 * missed the check silently gave the wrong answer, and this codebase fixed that
 * one vendor at a time: M3, M4, M6, M7, Z6, AJ1, AL1. Measured before AM1, the
 * compliance scanner's management-plane checks were wrong in BOTH directions:
 *
 *   false FAIL — the config was right, the regex did not know the dialect:
 *     NVIDIA Cumulus NTP  `nv set service ntp mgmt server …`
 *     Palo Alto NTP       `set deviceconfig system ntp-servers …`
 *     HPE Aruba SSH       `ssh server vrf mgmt`
 *     FortiOS SSH         `set admin-ssh-v1 disable`
 *
 *   false PASS — the regex matched something that was not the fact:
 *     Cisco FTD syslog    only a COMMENT (`!   syslog: logging host …`) —
 *                         Z6 fixed comment-matching in the validator but the
 *                         fix never reached the compliance scanner
 *     Nokia / Cumulus /   the word `aaa` in a LOCAL admin-user block, reported
 *     Aruba "AAA"         as TACACS+/RADIUS authentication that does not exist
 *
 * The structural fix
 * ------------------
 * 1. **One place per dialect.** `RULES` holds every platform's spelling of
 *    every fact. A check no longer knows any vendor.
 * 2. **Completeness is compiler-enforced.** `RULES` is a full
 *    `Record<FactPlatform, Record<FactName, Rule>>`, so adding a platform or a
 *    fact without deciding every cell is a type error — not a silent `false`.
 * 3. **Three states, not two.** `unknown` is distinct from `absent`. A fact the
 *    device config genuinely cannot express (FTD logging and AAA live in FMC,
 *    not the device CLI) is reported as unverifiable with the reason, instead
 *    of as a failure the user can do nothing about.
 * 4. **Comments can never satisfy a fact.** Extraction always strips them, so
 *    the Z6 rule cannot be forgotten by the next consumer.
 * 5. **Evidence.** A present fact carries the config line that satisfied it,
 *    so a compliance result can show its working.
 *
 * Platforms resolve through `ztpPlatform` — the single vendor→NOS map that
 * ZTP, rollback, telemetry, NETCONF and drift remediation all use — plus FTD,
 * which `ztpPlatform` folds into IOS-XE but whose CLI is not IOS-XE.
 */
import type { BOMDevice } from '@/types'
import { ztpPlatform, type ZTPPlatform } from '@/lib/ztp'
import { isFtdModel, isViptelaOs } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

/** The facts this slice models. Management-plane first: that is where the
 *  measured defects lived. */
export type MgmtFactName = 'hostname' | 'sshV2' | 'ntp' | 'syslog' | 'aaa'

/**
 * Routing and fabric facts (AM3). Kept as a separate group so the management
 * checks and their ground-truth tables do not change shape when these grow.
 */
export type RoutingFactName =
  'bgp' | 'isis' | 'ospf' | 'loopback' | 'vxlan' | 'evpn' | 'bfd' | 'jumboMtu'

export type FactName = MgmtFactName | RoutingFactName

/** The management-plane facts. */
export const FACT_NAMES: readonly MgmtFactName[] = ['hostname', 'sshV2', 'ntp', 'syslog', 'aaa'] as const

export const ROUTING_FACT_NAMES: readonly RoutingFactName[] =
  ['bgp', 'isis', 'ospf', 'loopback', 'vxlan', 'evpn', 'bfd', 'jumboMtu'] as const

export const ALL_FACT_NAMES: readonly FactName[] = [...FACT_NAMES, ...ROUTING_FACT_NAMES]

export const FACT_LABEL: Record<FactName, string> = {
  hostname: 'Hostname set',
  sshV2: 'SSH v2 enforced',
  ntp: 'NTP server configured',
  syslog: 'Remote syslog configured',
  aaa: 'Centralized AAA (TACACS+ / RADIUS)',
  bgp: 'BGP configured',
  isis: 'IS-IS configured',
  ospf: 'OSPF configured',
  loopback: 'Loopback interface',
  vxlan: 'VXLAN tunnel endpoint (VTEP)',
  evpn: 'EVPN control plane',
  bfd: 'BFD enabled',
  jumboMtu: 'Jumbo MTU (≥ 9000)',
}

export type FactState = 'present' | 'absent' | 'unknown'

export interface Fact {
  state: FactState
  /** The config line that satisfied the fact (present only). */
  evidence?: string
  /** Why the fact cannot be verified from device config (unknown only). */
  note?: string
}

export type DeviceFacts = Record<FactName, Fact>

/**
 * `ztpPlatform` covers switch/router NOSes. Three dialects here are not one:
 *   ftd      — Firepower CLI is not IOS-XE
 *   viptela  — a vEdge runs Viptela OS, not the IOS-XE of a cEdge
 *   oran-nf / oran-ru — O-RAN network functions and radios are configured by
 *              a management manifest, not a vendor switch CLI; resolving them
 *              through the server/appliance vendor gave Dell OS10 or IOS-XE
 *              rules and false-FAILED every fact.
 */
export type FactPlatform = ZTPPlatform | 'ftd' | 'viptela' | 'oran-nf' | 'oran-ru'

/** A dialect pattern, or a declaration that this platform's device config
 *  cannot express the fact — with the reason. */
type Rule = RegExp | { unsupported: string }

const FMC = 'Cisco FTD sets this in FMC Platform Settings / policy, not in the device CLI — verify it in FMC.'

/**
 * `aaa` means CENTRALIZED authentication: the live config must reference
 * TACACS+ or RADIUS. A local admin account is not it — that is the false PASS
 * Nokia, Cumulus and Aruba were getting from a bare `/aaa/` match.
 */
const CENTRAL_AAA = /\b(?:tacacs\+?|tacplus|radius)\b/i

/**
 * Every platform × every fact. Patterns are anchored to lines the generators
 * actually emit (see the AM1 measurement), and deliberately narrow: a broad
 * pattern is exactly what matched `system-services [ ssh ntp ]` (a Junos zone
 * rule), `log-adjacency-changes` (an IS-IS knob) and `ssl-ssh-profile` (a TLS
 * inspection profile) as if they were SSH / syslog.
 */
export const RULES: Record<FactPlatform, Record<MgmtFactName, Rule>> = {
  nxos: {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging server\b/m,
    aaa: CENTRAL_AAA,
  },
  'ios-xe': {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*ip ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging (?:host|server)\b/m,
    aaa: CENTRAL_AAA,
  },
  iosxr: {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*ssh server v2\b/m,
    // IOS-XR accepts `ntp server X` and renders it nested under a bare `ntp`.
    ntp: /^\s*ntp(?:\s*\n\s+|[ \t]+)server\b/m,
    syslog: /^\s*logging\s+(?:\d{1,3}(?:\.\d{1,3}){3}|<CHANGE-ME)/m,
    aaa: CENTRAL_AAA,
  },
  eos: {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*management ssh\b|^\s*ip ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging (?:vrf \S+ )?host\b/m,
    aaa: CENTRAL_AAA,
  },
  junos: {
    hostname: /^\s*set system host-name\s+\S/m,
    // Not `system-services [ … ssh … ]` — that is a zone host-inbound rule.
    sshV2: /^\s*set system services ssh protocol-version v2\b/m,
    ntp: /^\s*set system ntp server\b/m,
    syslog: /^\s*set system syslog host\b/m,
    aaa: CENTRAL_AAA,
  },
  srl: {
    hostname: /^\s*host-name\s+\S/m,
    sshV2: /^\s*ssh-server\s*\{/m,
    ntp: /^\s*ntp\s*\{/m,
    syslog: /^\s*remote-server\s+\S/m,
    aaa: CENTRAL_AAA,
  },
  cumulus: {
    hostname: /^\s*nv set system hostname\s+\S/m,
    sshV2: /^\s*nv set system ssh-server state enabled\b/m,
    ntp: /^\s*nv set service ntp \S+ server\b/m,
    syslog: /^\s*nv set service syslog \S+ server\b/m,
    aaa: CENTRAL_AAA,
  },
  dellos10: {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*ip ssh server version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging server\b/m,
    aaa: CENTRAL_AAA,
  },
  exos: {
    hostname: /^\s*configure snmp sysName\s+\S/m,
    sshV2: /^\s*enable ssh2\b/m,
    ntp: /^\s*configure ntp server add\b/m,
    syslog: /^\s*configure syslog add\b/m,
    aaa: CENTRAL_AAA,
  },
  fortios: {
    hostname: /^\s*set hostname\s+\S/m,
    // Disabling SSHv1 is FortiOS's v2-only statement. Not `ssl-ssh-profile`.
    sshV2: /^\s*set admin-ssh-v1 disable\b/m,
    ntp: /^\s*config system ntp\b/m,
    syslog: /^\s*config log syslogd setting\b/m,
    aaa: CENTRAL_AAA,
  },
  arubaoscx: {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*ssh server vrf\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging\s+(?:\d{1,3}(?:\.\d{1,3}){3}|<CHANGE-ME)/m,
    aaa: CENTRAL_AAA,
  },
  panos: {
    hostname: /^\s*set deviceconfig system hostname\s+\S/m,
    sshV2: /^\s*set deviceconfig system (?:service disable-telnet yes|ssh\b)/m,
    ntp: /^\s*set deviceconfig system ntp-servers\b/m,
    syslog: /^\s*set (?:shared )?server-profile syslog\b/m,
    aaa: CENTRAL_AAA,
  },
  viptela: {
    hostname: /^\s*host-name\s+\S/m,
    sshV2: { unsupported: 'Viptela OS implements SSH v2 only and has no protocol-version statement — there is no v1 to disable.' },
    ntp: /^\s*ntp\s*\n\s+server\s+\S/m,
    syslog: /^\s*logging\s*\n(?:[ \t]+\S.*\n)*?[ \t]+server\s+\S/m,
    aaa: /^\s*tacacs\s*\n\s+server\s+\S|^\s*radius\s*\n\s+server\s+\S/m,
  },
  'oran-nf': {
    hostname: /^\s*hostname\s+\S/m,
    // OpenSSH-based NF management plane; OpenSSH dropped SSHv1 in 7.6.
    sshV2: /^\s*ssh(?:-server)? enabled\b/m,
    ntp: /^\s*ntp-server\s+\S/m,
    syslog: /^\s*syslog-server\s+\S/m,
    aaa: /^\s*(?:tacacs|radius)-server\s+\S/m,
  },
  'oran-ru': {
    hostname: /^\s*hostname\s+\S/m,
    sshV2: /^\s*transport netconf-over-ssh\b/m,
    ntp: { unsupported: 'An O-RU takes time from PTP (G.8275.1) on the fronthaul, not NTP — see the fronthaul/grandmaster timing config.' },
    // The O1 VES collector is the radio's remote event/fault log.
    syslog: /^\s*ves-collector\s+\S/m,
    aaa: { unsupported: 'O-RU M-plane accounts are provisioned over NETCONF by the O-DU/SMO (O-RAN WG4 o-ran-usermgmt / NACM); an O-RU has no TACACS+/RADIUS client.' },
  },
  ftd: {
    hostname: /^\s*configure network hostname\s+\S/m,
    // The only SSH / NTP statements a Firepower CLI accepts (X6).
    sshV2: /^\s*configure ssh-access-list\b/m,
    ntp: /^\s*configure ntp servers\b/m,
    syslog: { unsupported: FMC },
    aaa: { unsupported: FMC },
  },
}

/** A construct the platform does not have — the fact is simply absent. */
const NEVER = /(?!)/

const FMC_ROUTING = 'Cisco FTD routing and interfaces are configured in FMC, not the device CLI — verify it in FMC.'
const NOT_A_ROUTER = /(?!)/

// Shared by the IOS-shaped CLIs (NX-OS, IOS-XE, IOS-XR, EOS, OS10, AOS-CX).
const IOS_BGP = /^\s*router bgp\b/m
const IOS_ISIS = /^\s*router isis\b/m
const IOS_OSPF = /^\s*router ospf\b/m
const IOS_JUMBO = /^\s*mtu\s+9\d{3}\b/m

/**
 * Routing and fabric facts, every platform × every fact (AM3). Same contract
 * as RULES: a missing cell is a type error. Each replaces one of the
 * validator's cross-vendor regexes, which is where M3, M6, M7 and Z6 lived.
 * Notable dialect points the old detectors got wrong or never saw:
 *   - EXOS routing (`enable bgp`, `configure ospf`) matched no routing
 *     detector at all, so V-12 never asked whether an EXOS router had a
 *     loopback.
 *   - VXLAN was any occurrence of the word, so a Junos `encapsulation vxlan`
 *     inside an EVPN type-5 block and an NX-OS `vxlan` in a description both
 *     counted as a tunnel endpoint.
 */
export const ROUTING_RULES: Record<FactPlatform, Record<RoutingFactName, Rule>> = {
  nxos: {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface loopback\d/mi,
    vxlan: /^\s*interface nve\d/m,
    evpn: /^\s*nv overlay evpn\b|^\s*address-family l2vpn evpn\b/m,
    // A peer template that USES bfd, not just `feature bfd` (which enables
    // the process and protects nothing on its own).
    bfd: /^\s*bfd(?:\s+multihop)?\s*$/m,
    jumboMtu: IOS_JUMBO,
  },
  'ios-xe': {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface Loopback\d/mi,
    vxlan: /^\s*interface nve\d/m,
    evpn: /^\s*l2vpn evpn\b|^\s*address-family l2vpn evpn\b/m,
    bfd: /^\s*bfd (?:interval|template)\b|^\s*neighbor \S+ fall-over bfd\b/m,
    jumboMtu: /^\s*(?:system )?mtu\s+9\d{3}\b/m,
  },
  iosxr: {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface Loopback\d/mi,
    vxlan: /^\s*interface nve\d/m,
    evpn: /^\s*evpn\s*$|^\s*address-family l2vpn evpn\b/m,
    bfd: /^\s*bfd fast-detect\b/m,
    jumboMtu: IOS_JUMBO,
  },
  eos: {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface Loopback\d/mi,
    vxlan: /^\s*interface Vxlan\d/m,
    evpn: /^\s*address-family evpn\b/m,
    bfd: /^\s*neighbor \S+ bfd\b/m,
    jumboMtu: IOS_JUMBO,
  },
  junos: {
    bgp: /^\s*set protocols bgp\b/m,
    isis: /^\s*set protocols isis\b/m,
    ospf: /^\s*set protocols ospf\b/m,
    loopback: /^\s*set interfaces lo0 unit\b/m,
    // A VNI mapped to a VLAN, or a VTEP source — not the word `vxlan` in an
    // EVPN type-5 block.
    vxlan: /^\s*set vlans \S+ vxlan vni\b|^\s*set switch-options vtep-source-interface\b/m,
    evpn: /^\s*set protocols (?:bgp group \S+ family evpn|evpn)\b|^\s*set routing-instances \S+ protocols evpn\b/m,
    bfd: /\bbfd-liveness-detection\b/m,
    jumboMtu: /^\s*set interfaces \S+ mtu 9\d{3}\b/m,
  },
  srl: {
    bgp: /^\s*bgp\s*\{/m,
    isis: /^\s*isis\s*\{/m,
    ospf: /^\s*ospf\s*\{/m,
    loopback: /^\s*interface system0\b/m,
    vxlan: /^\s*vxlan-interface\s+\S+\s*\{/m,
    evpn: /^\s*afi-safi evpn\s*\{|^\s*bgp-evpn\s*\{/m,
    bfd: /^\s*enable-bfd true\b/m,
    jumboMtu: /^\s*mtu\s+9\d{3}\b/m,
  },
  cumulus: {
    bgp: /^\s*nv set router bgp (?:enable on|autonomous-system)\b/m,
    isis: /^\s*nv set (?:vrf \S+ )?router isis\b/m,
    ospf: /^\s*nv set (?:vrf \S+ )?router ospf\b/m,
    loopback: /^\s*nv set interface lo ip address\b/m,
    vxlan: /^\s*nv set nve vxlan enable on\b/m,
    evpn: /^\s*nv set evpn enable on\b/m,
    bfd: /^\s*nv set .*\bbfd enable on\b/m,
    jumboMtu: /^\s*nv set interface \S+ link mtu 9\d{3}\b/m,
  },
  dellos10: {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface loopback\s*\d/mi,
    // `interface virtual-network N` is the IRB SVI, not the tunnel.
    vxlan: /^\s*vxlan-vni\s+\d/m,
    evpn: /^\s*address-family l2vpn evpn\b/m,
    bfd: /^\s*bfd\b/m,
    jumboMtu: IOS_JUMBO,
  },
  exos: {
    bgp: /^\s*enable bgp\s*$|^\s*configure bgp AS-number\b/m,
    isis: /^\s*(?:enable|configure) isis\b/m,
    ospf: /^\s*(?:enable|configure) ospf\b/m,
    loopback: /^\s*enable loopback-mode vlan\b/m,
    vxlan: /^\s*create virtual-network\s+\S+\s+vxlan vni\b/m,
    evpn: /\bcapability evpn\b|\baddress-family l2vpn-evpn\b/m,
    bfd: /^\s*configure bgp neighbor \S+ bfd on\b/m,
    jumboMtu: /^\s*configure jumbo-frame-size 9\d{3}\b/m,
  },
  fortios: {
    bgp: /^\s*config router bgp\b/m,
    isis: /^\s*config router isis\b/m,
    ospf: /^\s*config router ospf\b/m,
    loopback: /^\s*set type loopback\b/m,
    vxlan: /^\s*config system vxlan\b/m,
    evpn: /^\s*config system evpn\b/m,
    bfd: /^\s*set bfd enable\b/m,
    jumboMtu: /^\s*set mtu 9\d{3}\b/m,
  },
  arubaoscx: {
    bgp: IOS_BGP, isis: IOS_ISIS, ospf: IOS_OSPF,
    loopback: /^\s*interface loopback\s*\d/mi,
    vxlan: /^\s*interface vxlan\s*\d/m,
    evpn: /^\s*address-family l2vpn evpn\b/m,
    bfd: /^\s*(?:neighbor \S+ )?(?:fall-over )?bfd\b/m,
    jumboMtu: IOS_JUMBO,
  },
  panos: {
    bgp: /^\s*set network virtual-router \S+ protocol bgp enable yes\b/m,
    isis: NEVER, // PAN-OS has no IS-IS
    ospf: /^\s*set network virtual-router \S+ protocol ospf enable yes\b/m,
    loopback: /^\s*set network interface loopback\b/m,
    vxlan: NEVER,
    evpn: NEVER,
    bfd: /^\s*set network virtual-router \S+ protocol \S+ .*\bbfd\b/m,
    jumboMtu: /^\s*set network interface ethernet \S+ layer3 mtu 9\d{3}\b/m,
  },
  viptela: {
    bgp: /^\s*router\s*\n\s+bgp\s+\d/m,
    isis: NEVER,
    ospf: /^\s*router\s*\n\s+ospf\b/m,
    loopback: /^\s*interface loopback\d/m,
    vxlan: NEVER,
    evpn: NEVER,
    bfd: NEVER,
    jumboMtu: IOS_JUMBO,
  },
  'oran-nf': {
    bgp: NOT_A_ROUTER, isis: NOT_A_ROUTER, ospf: NOT_A_ROUTER, loopback: NOT_A_ROUTER,
    vxlan: NOT_A_ROUTER, evpn: NOT_A_ROUTER, bfd: NOT_A_ROUTER,
    jumboMtu: /^\s*mtu\s+9\d{3}\b/m,
  },
  'oran-ru': {
    bgp: NOT_A_ROUTER, isis: NOT_A_ROUTER, ospf: NOT_A_ROUTER, loopback: NOT_A_ROUTER,
    vxlan: NOT_A_ROUTER, evpn: NOT_A_ROUTER, bfd: NOT_A_ROUTER, jumboMtu: NOT_A_ROUTER,
  },
  ftd: {
    bgp: { unsupported: FMC_ROUTING }, isis: NEVER, ospf: { unsupported: FMC_ROUTING },
    loopback: { unsupported: FMC_ROUTING }, vxlan: NEVER, evpn: NEVER,
    bfd: { unsupported: FMC_ROUTING }, jumboMtu: { unsupported: FMC_ROUTING },
  },
}

function ruleFor(platform: FactPlatform, name: FactName): Rule {
  return (ROUTING_FACT_NAMES as readonly string[]).includes(name)
    ? ROUTING_RULES[platform][name as RoutingFactName]
    : RULES[platform][name as MgmtFactName]
}

/** The dialect a device's config is written in. */
export function factPlatform(dev: Pick<BOMDevice, 'vendor' | 'model'> & Partial<BOMDevice>): FactPlatform {
  if (dev.subLayer === 'oran-ru') return 'oran-ru'
  if (dev.subLayer && ORAN_NF_SUBLAYERS.has(dev.subLayer)) return 'oran-nf'
  if (isFtdModel(dev.model ?? '')) return 'ftd'
  if (isViptelaOs(dev as BOMDevice)) return 'viptela'
  return ztpPlatform(dev as BOMDevice)
}

/** O-RAN elements configured by a management manifest rather than a NOS CLI.
 *  The fronthaul switch and midhaul router are real NOS boxes and are not here. */
const ORAN_NF_SUBLAYERS = new Set(['oran-cu', 'oran-du', 'oran-core', 'oran-timing'])

/**
 * The whole config line a match starts on — the evidence a report can show.
 * The pattern only matches a prefix (`ntp server`), and a prefix proves
 * nothing to an auditor; the line (`ntp server 10.0.0.2 prefer`) does.
 */
function evidenceOf(text: string, match: RegExpExecArray): string {
  // Skip leading whitespace/newlines the pattern consumed, so a multi-line
  // match (IOS-XR's nested `ntp` block) reports its first real line.
  let start = match.index
  while (start < text.length && /\s/.test(text[start])) start++
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', start)
  return text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
}

/** Extract every fact from one device's configuration. */
export function extractFacts(config: string, platform: FactPlatform): DeviceFacts {
  const live = stripComments(config)
  const out = {} as DeviceFacts
  for (const name of ALL_FACT_NAMES) {
    const rule = ruleFor(platform, name)
    if (!(rule instanceof RegExp)) {
      out[name] = { state: 'unknown', note: rule.unsupported }
      continue
    }
    const m = rule.exec(live)
    out[name] = m ? { state: 'present', evidence: evidenceOf(live, m) } : { state: 'absent' }
  }
  return out
}

/**
 * Facts for a config whose device — and so whose dialect — is not known.
 * A fact is present if ANY platform's rule matches. This is deliberately the
 * lenient direction: it can only say "a recognisable statement exists", never
 * attribute a dialect, and consumers that can resolve the device should use
 * `extractFacts` instead.
 */
export function extractFactsAnyDialect(config: string): DeviceFacts {
  const live = stripComments(config)
  const out = {} as DeviceFacts
  for (const name of ALL_FACT_NAMES) {
    out[name] = { state: 'absent' }
    for (const platform of Object.keys(RULES) as FactPlatform[]) {
      const rule = ruleFor(platform, name)
      if (!(rule instanceof RegExp)) continue
      const m = rule.exec(live)
      if (m) { out[name] = { state: 'present', evidence: evidenceOf(live, m) }; break }
    }
  }
  return out
}

/**
 * Resolve the device a config belongs to. Configs are keyed by BOM id
 * (`generateAllConfigs`), but some callers and fixtures key by hostname.
 */
export function deviceForConfig(key: string, devices: BOMDevice[]): BOMDevice | undefined {
  return devices.find(d => d.id === key) ?? devices.find(d => d.hostname === key)
}

export interface FleetFact {
  /** Configs whose platform could be determined and the fact verified. */
  present: string[]
  absent: string[]
  /** Fact not expressible in this platform's device config. */
  unknown: Array<{ key: string; note: string }>
  /** Configs whose device could not be resolved to a platform. */
  unresolved: string[]
  /** Evidence lines by config key, for present facts. */
  evidence: Record<string, string>
}

/**
 * One fact across a fleet. A config whose device cannot be resolved is
 * reported as `unresolved` rather than tested against a guessed dialect —
 * guessing the dialect is the defect this module exists to remove.
 */
export function fleetFact(
  configs: Record<string, string>,
  devices: BOMDevice[],
  name: FactName,
): FleetFact {
  const r: FleetFact = { present: [], absent: [], unknown: [], unresolved: [], evidence: {} }
  for (const [key, cfg] of Object.entries(configs)) {
    const dev = deviceForConfig(key, devices)
    if (!dev) { r.unresolved.push(key); continue }
    const fact = extractFacts(cfg, factPlatform(dev))[name]
    if (fact.state === 'present') {
      r.present.push(key)
      if (fact.evidence) r.evidence[key] = fact.evidence
    } else if (fact.state === 'absent') {
      r.absent.push(key)
    } else {
      r.unknown.push({ key, note: fact.note ?? 'not verifiable from device config' })
    }
  }
  return r
}
