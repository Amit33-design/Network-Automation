/**
 * runbook.ts — the deployment runbook the product's own tagline promises.
 *
 * `backend/export/runbook.py` builds one behind `/api/export/runbook`, which
 * no UI calls. It also receives only `{hostname: config}`, so its device table
 * emits `| host | — | — |` — role and platform are always em-dashes because it
 * never sees the BOM. Like the draw.io export, this is written natively rather
 * than mirrored, so the table carries real roles, vendors and platforms, the
 * deployment order is derived from the tiers actually present, and the
 * pre-flight section reports what the BOM and config validators actually said.
 *
 * The pre-deploy backup and rollback commands come from the same
 * `ROLLBACK_STRATEGIES` the Rollback Advisor uses, so the runbook and the
 * advisor cannot prescribe different recovery steps.
 */
import type { BOMDevice } from '@/types'
import { ztpPlatform } from '@/lib/ztp'
import {
  ROLLBACK_STRATEGIES, vendorToPlatform, rollbackTimestamp, type Platform,
} from '@/lib/rollback'
import type { BOMValidationIssue } from '@/lib/bom'
import type { ValidationResult } from '@/lib/config-validator'

/** Tiers touched during a push, in the order they must be changed. */
const DEPLOY_ORDER = [
  'firewall', 'wan-edge', 'core', 'spine', 'distribution', 'leaf', 'access',
  'oran-core', 'oran-cu', 'oran-midhaul', 'oran-fronthaul', 'oran-du', 'oran-ru',
]

/** Why each tier goes where it does — a runbook should say, not just list. */
const ORDER_RATIONALE: Record<string, string> = {
  firewall: 'Verify HA state before and after; a failover mid-change loses sessions.',
  'wan-edge': 'One at a time; confirm the peer holds the routes before touching the second.',
  core: 'One at a time; verify the IGP reconverges and the STP root is unchanged.',
  spine: 'One at a time; every leaf loses a path per spine, so confirm ECMP reconverges.',
  distribution: 'In HA pairs; verify FHRP mastership and access uplinks after each.',
  leaf: 'In vPC/MLAG pairs — both members of a pair together, never split.',
  access: 'Batch by wiring closet; verify one port per closet before moving on.',
}

const NON_DEPLOYABLE = new Set(['gpu-compute', 'cloud-gw', 'cloud-transit'])

export interface RunbookInput {
  devices: BOMDevice[]
  configs?: Record<string, string>
  orgName?: string
  siteCode?: string
  useCase?: string
  /** BOM issues from `validateBOM`. */
  bomIssues?: BOMValidationIssue[]
  /** Config findings from `validateConfigs`. */
  validation?: ValidationResult
  /** Injected so the output is deterministic in tests. */
  now?: Date
}

/** Short, stable fingerprint so the pushed config can be confirmed on-box. */
export function configFingerprint(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    h1 = ((h1 ^ text.charCodeAt(i)) * 16777619) >>> 0
    h2 = ((h2 + text.charCodeAt(i) * (i + 1)) * 2246822519) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12)
}

function mdTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return '_None._\n'
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ].join('\n') + '\n'
}

/** Tiers present in this design, in deployment order. */
function orderedTiers(devices: BOMDevice[]): string[] {
  const present = new Set(devices.filter(d => !NON_DEPLOYABLE.has(d.subLayer)).map(d => d.subLayer))
  const known = DEPLOY_ORDER.filter(t => present.has(t))
  const unknown = [...present].filter(t => !DEPLOY_ORDER.includes(t)).sort()
  return [...known, ...unknown]
}

export function buildRunbook(input: RunbookInput): string {
  const {
    devices, configs = {}, orgName = 'Unnamed organisation', siteCode = '',
    useCase = '', bomIssues = [], validation, now = new Date(),
  } = input

  const deployable = devices.filter(d => !NON_DEPLOYABLE.has(d.subLayer))
  const ts = rollbackTimestamp(now)
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const tiers = orderedTiers(devices)

  const out: string[] = []
  const h = (t: string) => out.push(`\n## ${t}\n`)

  out.push(`# Deployment Runbook — ${orgName}`)
  out.push('')
  out.push(mdTable(['Field', 'Value'], [
    ['Site', siteCode || '—'],
    ['Use case', useCase || '—'],
    ['Devices in scope', String(deployable.length)],
    ['Configs generated', String(Object.keys(configs).length)],
    ['Generated', stamp],
    ['Rollback checkpoint tag', `\`pre-deploy-${ts}\``],
  ]))

  // ── 1. Pre-flight ────────────────────────────────────────────────────────
  h('1. Pre-flight — resolve before you start')
  const errors = bomIssues.filter(i => i.severity === 'error')
  const warns = bomIssues.filter(i => i.severity === 'warning')
  const failed = (validation?.checks ?? []).filter(c => c.severity === 'fail')
  const warned = (validation?.checks ?? []).filter(c => c.severity === 'warn')

  if (errors.length || failed.length) {
    out.push('> **STOP.** The design has blocking findings. Do not deploy until they are cleared.\n')
  } else if (warns.length || warned.length) {
    out.push('> Warnings present — review each before proceeding.\n')
  } else {
    out.push('> No blocking findings. Design and configs validated clean.\n')
  }
  out.push(mdTable(['Severity', 'Source', 'Finding'], [
    ...errors.map(i => ['🔴 error', 'BOM', i.message]),
    ...failed.map(c => ['🔴 fail', c.id, c.detail]),
    ...warns.map(i => ['🟡 warning', 'BOM', i.message]),
    ...warned.map(c => ['🟡 warn', c.id, c.detail]),
  ]))

  // ── 2. Devices ───────────────────────────────────────────────────────────
  h('2. Devices in scope')
  out.push(mdTable(
    ['Hostname', 'Role', 'Vendor', 'Model', 'Platform', 'Config'],
    deployable.map(d => [
      `\`${d.hostname || d.id}\``, d.subLayer, d.vendor, d.model,
      ztpPlatform(d),
      configs[d.id] ? `\`${configFingerprint(configs[d.id])}\`` : '_none_',
    ]),
  ))

  // ── 3. Backup ────────────────────────────────────────────────────────────
  h('3. Capture a restore point — every device, before any change')
  out.push('A rollback is only as good as the checkpoint taken beforehand. Run these first and confirm each succeeded.\n')
  const platforms = [...new Set(deployable.map(d => vendorToPlatform(d.vendor, d.subLayer, d.model)))]
  for (const p of platforms) {
    const pre = ROLLBACK_STRATEGIES[p as Platform]?.pre
    const hosts = deployable
      .filter(d => vendorToPlatform(d.vendor, d.subLayer, d.model) === p)
      .map(d => d.hostname || d.id)
    out.push(`**${p}** — ${hosts.length} device(s): ${hosts.slice(0, 6).map(x => `\`${x}\``).join(', ')}${hosts.length > 6 ? ` … +${hosts.length - 6}` : ''}\n`)
    out.push('```\n' + (pre ? pre.replace(/\{ts\}/g, ts) : '! no platform-native checkpoint — take an offline config backup') + '\n```\n')
  }

  // ── 4. Order ─────────────────────────────────────────────────────────────
  h('4. Deployment order')
  out.push('Derived from the tiers actually present in this design.\n')
  tiers.forEach((tier, i) => {
    const n = deployable.filter(d => d.subLayer === tier).length
    out.push(`${i + 1}. **${tier}** (${n} device${n === 1 ? '' : 's'}) — ${ORDER_RATIONALE[tier] ?? 'Change in pairs where redundant; verify before continuing.'}`)
  })
  out.push('')

  // ── 5. Verify ────────────────────────────────────────────────────────────
  h('5. Verification after each tier')
  out.push([
    '- Management reachability: the device answers SSH on its OOB address.',
    '- Interface state: no new down/errdisabled ports versus the pre-check baseline.',
    '- Routing adjacency: every neighbour that was up before is up again.',
    '- Overlay (fabric designs): the VTEP count and EVPN route count match the pre-check.',
    '- Data plane: an end-to-end probe across the changed tier still passes.',
  ].join('\n'))
  out.push('')

  // ── 6. Rollback ──────────────────────────────────────────────────────────
  h('6. Rollback')
  out.push(`Restores the \`pre-deploy-${ts}\` checkpoint captured in step 3. Roll back the **whole tier** you were changing, not one device — a half-changed pair is worse than either state.\n`)
  for (const p of platforms) {
    const strat = ROLLBACK_STRATEGIES[p as Platform]
    out.push(`**${p}**\n`)
    out.push('```\n' + (strat?.exec ? strat.exec.replace(/\{ts\}/g, ts) : '! no platform-native rollback — restore the offline backup manually') + '\n```\n')
  }

  return out.join('\n')
}

export function runbookFilename(siteCode: string): string {
  const slug = (siteCode || 'network').replace(/[^A-Za-z0-9-]/g, '') || 'network'
  return `${slug}-deployment-runbook.md`
}
