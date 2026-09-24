/**
 * NetDesign AI — drift remediation dialect (AL1)
 * ================================================
 * Turns a config-drift diff (lines `added` to the running config, lines
 * `removed` from it) into the commands that restore the intended state.
 *
 * The defect this exists to fix: the generator was a **binary** Junos-or-Cisco
 * split, so 8 of 10 catalogue vendors received Cisco IOS `no <line>` negation.
 * Four of those (Cisco, Arista, Dell OS10, Aruba AOS-CX) genuinely are
 * IOS-style for this, but Nokia SR Linux, NVIDIA Cumulus, Extreme EXOS,
 * FortiOS and PAN-OS are not — none accepts `no <line>`.
 *
 * Severity is the AG5 argument: remediation runs when the device is ALREADY
 * wrong, so a wrong command lands on a box someone is mid-way through fixing.
 *
 * The dialect comes from AG8's `cliFamily` rather than a seventh private
 * vendor table — ZTP, rollback, telemetry, the Day-N change tool, NETCONF and
 * now this one all resolve vendors through shared maps, because every time
 * this codebase has duplicated one it has drifted.
 */
import { cliFamily, type CliFamily } from '@/lib/config-update'

export interface DeviceRemediation {
  commands: string[]
  /**
   * False when the dialect's negation cannot be derived from a config line
   * alone. Those devices are reported rather than handed invented CLI.
   */
  supported: boolean
  /** Why it is unsupported, naming the real mechanism. Empty when supported. */
  note: string
}

/**
 * Families whose "undo this line" form is mechanically derivable from the line.
 *
 * EXOS and FortiOS are deliberately absent. EXOS negation is per-command
 * (`unconfigure` / `disable` / `delete` depending on what the line configured)
 * and FortiOS needs the enclosing `config` path to emit `unset`, so neither
 * can be produced from an arbitrary diff line. Emitting a plausible
 * `unconfigure <line>` would be exactly the guess AG5 stopped making — worse
 * than saying so, because it looks runnable.
 */
const DERIVABLE: ReadonlySet<CliFamily> = new Set<CliFamily>(['ios', 'junos', 'nokia', 'panos', 'nvue'])

const UNSUPPORTED_NOTE: Partial<Record<CliFamily, string>> = {
  exos: 'EXOS negation is per-command (unconfigure / disable / delete depending on what the line set), '
      + 'so it cannot be derived from a diff line. Review each line against the EXOS command reference.',
  fortios: 'FortiOS needs the enclosing `config` path to emit `unset`, which a diff line does not carry. '
         + 'Review each line inside its `config … end` block.',
}

/** Restore a line that drift REMOVED from the running config. */
function restoreLine(family: CliFamily, line: string): string {
  const s = line.trim()
  switch (family) {
    case 'junos':
    case 'panos':
      if (s.startsWith('set ')) return s
      if (s.startsWith('delete ')) return `set ${s.slice(7)}`
      return `set ${s}`
    case 'nokia':
      if (s.startsWith('set ')) return s
      if (s.startsWith('delete ')) return `set ${s.slice(7)}`
      return `set ${s}`
    case 'nvue':
      if (s.startsWith('nv set ')) return s
      if (s.startsWith('nv unset ')) return `nv set ${s.slice(9)}`
      return `nv set ${s}`
    case 'ios':
    default:
      // The intended line is simply re-applied, indentation preserved.
      return line
  }
}

/** Undo a line that drift ADDED to the running config. */
function negateLine(family: CliFamily, line: string): string {
  const s = line.trim()
  switch (family) {
    case 'junos':
    case 'panos':
      if (s.startsWith('set ')) return `delete ${s.slice(4)}`
      if (s.startsWith('delete ')) return s
      return `delete ${s}`
    case 'nokia':
      if (s.startsWith('set ')) return `delete ${s.slice(4)}`
      if (s.startsWith('delete ')) return s
      return `delete ${s}`
    case 'nvue':
      if (s.startsWith('nv set ')) return `nv unset ${s.slice(7)}`
      if (s.startsWith('nv unset ')) return s
      return `nv unset ${s}`
    case 'ios':
    default: {
      const stripped = line.replace(/^\s+/, '')
      const indent = line.slice(0, line.length - stripped.length)
      if (stripped.startsWith('no ')) return `${indent}${stripped.slice(3)}`
      return `${indent}no ${stripped}`
    }
  }
}

/**
 * Resolve a dialect from EITHER a catalogue vendor name or a platform/NOS
 * string — both are live inputs. The UI passes `d.vendor` ("Nokia"), while the
 * API's field is literally named `platform` and receives NOS tokens
 * ("juniper-junos", "ios-xe"). `cliFamily` exact-matches vendor names, so
 * resolving a NOS token through it alone silently returned `ios` — which is
 * how the first draft of AL1 broke Juniper, caught by an existing test.
 */
export function remediationFamily(token: string): CliFamily {
  const viaVendor = cliFamily(token)
  if (viaVendor !== 'ios') return viaVendor          // matched a catalogue vendor
  const t = token.toLowerCase()
  if (/jun/.test(t)) return 'junos'
  if (/srl|srlinux|nokia/.test(t)) return 'nokia'
  if (/cumulus|nvue|nvidia/.test(t)) return 'nvue'
  if (/exos|extreme/.test(t)) return 'exos'
  if (/forti/.test(t)) return 'fortios'
  if (/pan-?os|palo/.test(t)) return 'panos'
  // ios-xe, iosxr, nxos, eos, dellos10, arubaoscx and anything unknown.
  return 'ios'
}

/**
 * Remediation for one device. `vendor` may be a catalogue vendor name or a
 * platform/NOS string — see `remediationFamily`.
 */
export function remediationFor(
  vendor: string,
  added: string[],
  removed: string[],
): DeviceRemediation {
  const family = remediationFamily(vendor)

  if (!DERIVABLE.has(family)) {
    return {
      commands: [],
      supported: false,
      note: UNSUPPORTED_NOTE[family]
        ?? `No remediation dialect for ${vendor}; review the diff manually.`,
    }
  }

  const commands: string[] = []
  for (const line of removed) commands.push(restoreLine(family, line))
  for (const line of added) commands.push(negateLine(family, line))
  return { commands, supported: true, note: '' }
}
