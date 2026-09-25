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
export type FactName = 'hostname' | 'sshV2' | 'ntp' | 'syslog' | 'aaa'

export const FACT_NAMES: readonly FactName[] = ['hostname', 'sshV2', 'ntp', 'syslog', 'aaa'] as const

export const FACT_LABEL: Record<FactName, string> = {
  hostname: 'Hostname set',
  sshV2: 'SSH v2 enforced',
  ntp: 'NTP server configured',
  syslog: 'Remote syslog configured',
  aaa: 'Centralized AAA (TACACS+ / RADIUS)',
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
export const RULES: Record<FactPlatform, Record<FactName, Rule>> = {
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
  const rules = RULES[platform]
  const out = {} as DeviceFacts
  for (const name of FACT_NAMES) {
    const rule = rules[name]
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
  for (const name of FACT_NAMES) {
    out[name] = { state: 'absent' }
    for (const rules of Object.values(RULES)) {
      const rule = rules[name]
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
