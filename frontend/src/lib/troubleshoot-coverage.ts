/**
 * NetDesign AI — Troubleshooting platform coverage (AG10)
 * ========================================================
 * The diagnostic playbooks (Step 6 Troubleshoot, and `POST /api/troubleshoot`)
 * carry per-platform command variants for FOUR NOSes: NX-OS, IOS-XE, Arista EOS
 * and Juniper JunOS. Every other NOS in the product catalogue — Nokia SR Linux,
 * Extreme EXOS, NVIDIA Cumulus, Dell OS10, FortiOS, Aruba AOS-CX, PAN-OS,
 * IOS-XR — falls through to the Cisco-family base, so a Nokia operator
 * investigating a down session used to be handed `show ip bgp summary`, which
 * SR Linux does not have.
 *
 * The product decision (2026-09-07) is to SURFACE that rather than write
 * 24 playbooks × 8 platforms of variants on both sides of the stack. This
 * module states, for a given design, which devices the playbooks actually
 * cover and which they do not — using `ztpPlatform()` as the single vendor→NOS
 * map (AG5/AG6: two mappings that must agree is the drift this codebase keeps
 * paying for).
 */
import type { BOMDevice } from '@/types'
import { ztpPlatform, type ZTPPlatform } from '@/lib/ztp'

/** The four NOSes the playbooks carry real command variants for. */
export type TroubleshootPlatform = 'nxos' | 'iosxe' | 'eos' | 'junos'

export const TROUBLESHOOT_PLATFORMS: readonly TroubleshootPlatform[] = [
  'nxos', 'iosxe', 'eos', 'junos',
] as const

export const TROUBLESHOOT_PLATFORM_LABEL: Record<TroubleshootPlatform, string> = {
  nxos: 'Cisco NX-OS',
  iosxe: 'Cisco IOS-XE',
  eos: 'Arista EOS',
  junos: 'Juniper JunOS',
}

/** Display names for the NOSes the playbooks do NOT cover. */
export const UNCOVERED_PLATFORM_LABEL: Record<string, string> = {
  srl: 'Nokia SR Linux',
  cumulus: 'NVIDIA Cumulus',
  dellos10: 'Dell OS10',
  exos: 'Extreme EXOS',
  fortios: 'FortiOS',
  arubaoscx: 'Aruba AOS-CX',
  panos: 'PAN-OS',
  iosxr: 'Cisco IOS-XR',
}

/**
 * Map a ZTP platform id onto a troubleshooting platform, or null when the
 * playbooks carry no variant for it. Deliberately NOT a silent fallback —
 * returning null is what lets the caller say so.
 */
export function toTroubleshootPlatform(p: ZTPPlatform): TroubleshootPlatform | null {
  if (p === 'nxos') return 'nxos'
  if (p === 'ios-xe') return 'iosxe'
  if (p === 'eos') return 'eos'
  if (p === 'junos') return 'junos'
  return null
}

export interface PlatformCoverage {
  /** Covered NOSes present in this design, in TROUBLESHOOT_PLATFORMS order. */
  covered: TroubleshootPlatform[]
  /** Uncovered NOS ids present in this design, sorted. */
  uncovered: string[]
  /** Human labels for `uncovered`, sorted. */
  uncoveredLabels: string[]
  /** Hostnames of devices running an uncovered NOS (capped by the caller). */
  uncoveredDevices: string[]
  /** Number of devices (by BOM count) the playbooks cannot serve. */
  uncoveredCount: number
  /** Number of devices the playbooks can serve. */
  coveredCount: number
  /** Best default for the platform selector: a covered NOS actually in the fleet. */
  suggested: TroubleshootPlatform
}

/**
 * Which of a design's devices the troubleshooting playbooks can actually serve.
 * `count` on a BOMDevice is a quantity, so a 16× leaf row counts as 16 devices —
 * the operator cares how much of the fleet is dark, not how many BOM rows.
 */
export function troubleshootCoverage(devices: BOMDevice[]): PlatformCoverage {
  const covered = new Set<TroubleshootPlatform>()
  const uncovered = new Set<string>()
  const uncoveredDevices: string[] = []
  let coveredCount = 0
  let uncoveredCount = 0

  for (const dev of devices) {
    const qty = Math.max(1, dev.count ?? 1)
    const tp = toTroubleshootPlatform(ztpPlatform(dev))
    if (tp) {
      covered.add(tp)
      coveredCount += qty
    } else {
      uncovered.add(ztpPlatform(dev))
      uncoveredDevices.push(dev.hostname)
      uncoveredCount += qty
    }
  }

  const coveredList = TROUBLESHOOT_PLATFORMS.filter(p => covered.has(p))
  const uncoveredList = [...uncovered].sort()

  return {
    covered: coveredList,
    uncovered: uncoveredList,
    uncoveredLabels: uncoveredList.map(p => UNCOVERED_PLATFORM_LABEL[p] ?? p).sort(),
    uncoveredDevices,
    uncoveredCount,
    coveredCount,
    // Prefer a NOS the fleet actually runs over the historical hardcoded 'nxos'.
    suggested: coveredList[0] ?? 'nxos',
  }
}
