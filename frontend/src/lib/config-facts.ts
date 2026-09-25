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
import { isFtdModel } from '@/lib/configgen'
import { stripComments } from '@/lib/config-validator'

/** The facts this slice models. Management-plane first: that is where the
 *  measured defects lived. */
export type FactName = 'sshV2' | 'ntp' | 'syslog' | 'aaa'

export const FACT_NAMES: readonly FactName[] = ['sshV2', 'ntp', 'syslog', 'aaa'] as const

export const FACT_LABEL: Record<FactName, string> = {
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

export type FactPlatform = ZTPPlatform | 'ftd'

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
    sshV2: /^\s*ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging server\b/m,
    aaa: CENTRAL_AAA,
  },
  'ios-xe': {
    sshV2: /^\s*ip ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging (?:host|server)\b/m,
    aaa: CENTRAL_AAA,
  },
  iosxr: {
    sshV2: /^\s*ssh server v2\b/m,
    // IOS-XR nests servers under a bare `ntp` line.
    ntp: /^\s*ntp\s*\n\s+server\b/m,
    syslog: /^\s*logging\s+(?:\d{1,3}(?:\.\d{1,3}){3}|<CHANGE-ME)/m,
    aaa: CENTRAL_AAA,
  },
  eos: {
    sshV2: /^\s*management ssh\b|^\s*ip ssh version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging (?:vrf \S+ )?host\b/m,
    aaa: CENTRAL_AAA,
  },
  junos: {
    // Not `system-services [ … ssh … ]` — that is a zone host-inbound rule.
    sshV2: /^\s*set system services ssh protocol-version v2\b/m,
    ntp: /^\s*set system ntp server\b/m,
    syslog: /^\s*set system syslog host\b/m,
    aaa: CENTRAL_AAA,
  },
  srl: {
    sshV2: /^\s*ssh-server\s*\{/m,
    ntp: /^\s*ntp\s*\{/m,
    syslog: /^\s*remote-server\s+\S/m,
    aaa: CENTRAL_AAA,
  },
  cumulus: {
    sshV2: /^\s*nv set system ssh-server state enabled\b/m,
    ntp: /^\s*nv set service ntp \S+ server\b/m,
    syslog: /^\s*nv set service syslog \S+ server\b/m,
    aaa: CENTRAL_AAA,
  },
  dellos10: {
    sshV2: /^\s*ip ssh server version 2\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging server\b/m,
    aaa: CENTRAL_AAA,
  },
  exos: {
    sshV2: /^\s*enable ssh2\b/m,
    ntp: /^\s*configure ntp server add\b/m,
    syslog: /^\s*configure syslog add\b/m,
    aaa: CENTRAL_AAA,
  },
  fortios: {
    // Disabling SSHv1 is FortiOS's v2-only statement. Not `ssl-ssh-profile`.
    sshV2: /^\s*set admin-ssh-v1 disable\b/m,
    ntp: /^\s*config system ntp\b/m,
    syslog: /^\s*config log syslogd setting\b/m,
    aaa: CENTRAL_AAA,
  },
  arubaoscx: {
    sshV2: /^\s*ssh server vrf\b/m,
    ntp: /^\s*ntp server\b/m,
    syslog: /^\s*logging\s+(?:\d{1,3}(?:\.\d{1,3}){3}|<CHANGE-ME)/m,
    aaa: CENTRAL_AAA,
  },
  panos: {
    sshV2: /^\s*set deviceconfig system (?:service disable-telnet yes|ssh\b)/m,
    ntp: /^\s*set deviceconfig system ntp-servers\b/m,
    syslog: /^\s*set (?:shared )?server-profile syslog\b/m,
    aaa: CENTRAL_AAA,
  },
  ftd: {
    // The only SSH / NTP statements a Firepower CLI accepts (X6).
    sshV2: /^\s*configure ssh-access-list\b/m,
    ntp: /^\s*configure ntp servers\b/m,
    syslog: { unsupported: FMC },
    aaa: { unsupported: FMC },
  },
}

/** The dialect a device's config is written in. */
export function factPlatform(dev: Pick<BOMDevice, 'vendor' | 'model'> & Partial<BOMDevice>): FactPlatform {
  return isFtdModel(dev.model ?? '') ? 'ftd' : ztpPlatform(dev as BOMDevice)
}

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
