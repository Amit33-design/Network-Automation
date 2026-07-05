// ── RCA (Root Cause Analysis) — client-side engine (group U) ──────────────────
//
// Mirrors the backend hypothesis engine (backend/rca/engine.py) so RCA works in
// demo mode (no backend), like every other Step 6 feature (§3). Given a symptom
// string + affected devices + design state, it runs a set of keyword/design
// driven hypothesis checkers, each producing a rich hypothesis (blast radius,
// multi-step remediation, automation playbook), then dedups + confidence-ranks.
//
// Also exposes normalizeRcaResponse() so live-mode responses from EITHER the
// real engine (snake_case rich shape) OR the legacy lab stub ({rank, cause,
// remediation}) map onto the same canonical RcaHypothesis the UI renders.

import type { RcaHypothesis } from '@/types'

export interface RcaDesignDevice {
  hostname: string
  role?: string
  subLayer?: string
}

export interface RcaDesignState {
  useCase?: string
  protocols?: string[]
  devices?: RcaDesignDevice[]
}

export interface RcaInput {
  symptom: string
  affectedDevices?: string[]
  design?: RcaDesignState
}

const has = (s: string, ...keys: string[]) => keys.some(k => s.includes(k))
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Build a role-based adjacency: every spine peers every leaf, and border/edge
 *  nodes (firewall/wan-edge/core) attach to the spine/core tier. Deterministic. */
function buildAdjacency(devices: RcaDesignDevice[]): Record<string, string[]> {
  const roleOf = (d: RcaDesignDevice) => (d.role || d.subLayer || '').toLowerCase()
  const spines = devices.filter(d => roleOf(d).includes('spine')).map(d => d.hostname)
  const leaves = devices.filter(d => roleOf(d).includes('leaf')).map(d => d.hostname)
  const cores  = devices.filter(d => roleOf(d).includes('core')).map(d => d.hostname)
  const edges  = devices.filter(d => {
    const r = roleOf(d)
    return r.includes('firewall') || r.includes('wan') || r.includes('edge') || r.includes('border')
  }).map(d => d.hostname)

  const adj: Record<string, Set<string>> = {}
  const link = (a: string, b: string) => {
    if (a === b) return
    ;(adj[a] ??= new Set()).add(b)
    ;(adj[b] ??= new Set()).add(a)
  }
  // Clos: spine <-> leaf full mesh
  for (const s of spines) for (const l of leaves) link(s, l)
  // Edge/border attach to the aggregation tier (spine, or core when present)
  const agg = spines.length ? spines : cores
  for (const e of edges) for (const a of agg) link(e, a)
  // Core <-> spine (collapsed campus/DC border)
  for (const c of cores) for (const s of spines) link(c, s)

  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(adj)) out[k] = [...v].sort()
  return out
}

/** Two-hop blast radius from the affected set over the role adjacency. */
function blastRadius(affected: string[], adj: Record<string, string[]>): string[] {
  const visited = new Set(affected)
  let frontier = [...affected]
  for (let hop = 0; hop < 2; hop++) {
    const next: string[] = []
    for (const node of frontier) {
      for (const nb of adj[node] || []) {
        if (!visited.has(nb)) { visited.add(nb); next.push(nb) }
      }
    }
    frontier = next
  }
  return [...visited].sort()
}

interface Checker {
  (input: RcaInput, symptom: string, affected: string[], adj: Record<string, string[]>):
    RcaHypothesis | null
}

const rich = (
  rootCause: string,
  confidence: number,
  evidence: string[],
  affected: string[],
  adj: Record<string, string[]>,
  remediationSteps: string[],
  automationPlaybook: string | null,
): RcaHypothesis => ({
  rank: 0,
  rootCause,
  confidence: clamp01(confidence),
  evidence,
  blastRadius: blastRadius(affected, adj),
  remediationSteps,
  automationAvailable: !!automationPlaybook,
  automationPlaybook,
})

const spinesIn = (affected: string[]) => affected.filter(h => /spine/i.test(h))

const CHECKERS: Checker[] = [
  // 1. BGP session loss
  (input, s, affected, adj) => {
    if (!has(s, 'bgp', 'prefix', 'neighbor', 'session', 'peer', 'adjacency')) return null
    let conf = 0.35
    const ev: string[] = []
    if (has(s, 'bgp')) conf += 0.2
    if (has(s, 'prefix', 'neighbor', 'peer')) conf += 0.15
    if (affected.length) ev.push(`Reported on: ${affected.join(', ')}`)
    ev.push(`Symptom matches BGP session-loss pattern: "${input.symptom.trim()}"`)
    return rich('BGP Session Loss', conf, ev, affected, adj, [
      'show bgp summary / show ip bgp neighbors',
      'Verify BGP neighbor timers and hold-time',
      'Check for recent route-map / prefix-list policy changes',
      'Review interface status on the peering links',
    ], 'playbooks/rca/bgp_session_restore.yml')
  },
  // 2. PFC / RDMA deadlock
  (input, s, affected, adj) => {
    const gpu = input.design?.useCase === 'gpu'
    if (!has(s, 'pfc', 'rdma', 'roce', 'deadlock', 'watchdog') && !(gpu && has(s, 'gpu', 'drop', 'stall'))) return null
    let conf = 0.4
    const ev: string[] = []
    if (has(s, 'pfc', 'watchdog')) conf += 0.2
    if (has(s, 'rdma', 'roce', 'deadlock')) conf += 0.15
    if (gpu) { conf += 0.15; ev.push('Design is a GPU/RDMA fabric — PFC deadlock risk elevated') }
    if (affected.length) ev.push(`Reported on: ${affected.join(', ')}`)
    ev.push(`Symptom matches PFC/RDMA deadlock pattern: "${input.symptom.trim()}"`)
    return rich('PFC Watchdog Deadlock', conf, ev, affected, adj, [
      'show pfc watchdog status',
      'Verify DCQCN / ECN configuration on the lossless queues',
      'Check PFC priority groups and queue depths',
      'Temporarily disable the PFC watchdog to restore traffic if a queue is stuck',
    ], 'playbooks/rca/pfc_reset.yml')
  },
  // 3. EVPN / VXLAN overlay fault
  (input, s, affected, adj) => {
    if (!has(s, 'evpn', 'vxlan', 'vtep', 'vni', 'l2vpn', 'overlay', 'mac')) return null
    let conf = 0.35
    const ev: string[] = []
    const protos = (input.design?.protocols || []).map(p => p.toUpperCase())
    if (protos.some(p => p.includes('EVPN') || p.includes('VXLAN'))) {
      conf += 0.2; ev.push('Design uses an EVPN/VXLAN overlay')
    }
    const spines = spinesIn(affected)
    if (spines.length) { conf += 0.15; ev.push(`Spine/RR device(s) affected: ${spines.join(', ')} — possible route-reflector fault`) }
    ev.push(`Symptom matches EVPN/VXLAN fault pattern: "${input.symptom.trim()}"`)
    return rich('EVPN/VXLAN Overlay Fault', conf, ev, affected, adj, [
      'show bgp l2vpn evpn summary',
      'Verify NVE interface state and VTEP reachability',
      'Check VNI-to-VLAN bindings on all leaves',
      'Confirm the route-reflector is advertising EVPN type-2/type-5 routes',
    ], null)
  },
  // 4. Underlay / IGP failure
  (input, s, affected, adj) => {
    if (!has(s, 'ospf', 'isis', 'is-is', 'link', 'interface', 'flap', 'underlay', 'igp', 'crc', 'error', 'cable', 'sfp', 'optic')) return null
    let conf = 0.3
    const ev: string[] = []
    if (has(s, 'flap', 'link', 'interface', 'crc', 'error', 'sfp', 'optic', 'cable')) conf += 0.15
    if (has(s, 'ospf', 'isis', 'is-is', 'igp', 'underlay')) conf += 0.15
    const spines = spinesIn(affected)
    if (spines.length >= 2) { conf += 0.2; ev.push(`Multiple spine devices affected: ${spines.join(', ')}`) }
    if (affected.length) ev.push(`Reported on: ${affected.join(', ')}`)
    ev.push(`Symptom matches underlay/IGP failure pattern: "${input.symptom.trim()}"`)
    return rich('Underlay / IGP Failure', conf, ev, affected, adj, [
      'Check interface error counters and the physical layer (SFP, cable)',
      'Verify OSPF/IS-IS adjacency state',
      'Confirm BFD sessions are up',
      'Review recent interface or cabling changes',
    ], 'playbooks/rca/underlay_check.yml')
  },
  // 5. Recent deployment / config change
  (_input, s, affected, adj) => {
    if (!has(s, 'deploy', 'change', 'maintenance', 'window', 'push', 'rollback', 'config', 'after', 'upgrade')) return null
    let conf = 0.3
    const ev: string[] = []
    if (has(s, 'after', 'maintenance', 'window')) conf += 0.2
    if (has(s, 'deploy', 'push', 'change', 'config', 'upgrade')) conf += 0.15
    if (has(s, 'rollback')) conf += 0.1
    ev.push('Symptom is temporally correlated with a recent change ("after maintenance/deploy")')
    if (affected.length) ev.push(`Reported on: ${affected.join(', ')}`)
    return rich('Recent Deployment Change', conf, ev, affected, adj, [
      'Review the deployment diff (running vs pre-deploy checkpoint)',
      'Check the rollback status and post-check results',
      'Re-run post-deployment checks',
      'Trigger a rollback to the pre-deploy checkpoint if the change is confirmed at fault',
    ], 'playbooks/rca/rollback_verify.yml')
  },
]

/**
 * Run the client-side RCA engine. Returns confidence-ranked hypotheses. Falls
 * back to a single generic low-confidence hypothesis when nothing matches, so
 * the demo UI is never empty for a free-text symptom.
 */
export function analyzeRca(input: RcaInput): RcaHypothesis[] {
  const symptom = (input.symptom || '').toLowerCase()
  const affected = (input.affectedDevices || []).filter(Boolean)
  const adj = buildAdjacency(input.design?.devices || [])

  const raw: RcaHypothesis[] = []
  for (const check of CHECKERS) {
    const h = check(input, symptom, affected, adj)
    if (h) raw.push(h)
  }

  // Dedup by rootCause, keep highest confidence
  const byCause = new Map<string, RcaHypothesis>()
  for (const h of raw) {
    const prev = byCause.get(h.rootCause)
    if (!prev || h.confidence > prev.confidence) byCause.set(h.rootCause, h)
  }

  let ranked = [...byCause.values()].sort((a, b) => b.confidence - a.confidence)

  if (ranked.length === 0) {
    ranked = [rich(
      'Undetermined Root Cause',
      0.15,
      [
        `No known fault pattern matched: "${input.symptom.trim()}"`,
        'Falling back to general fabric diagnostics',
      ],
      affected,
      adj,
      [
        'Confirm device reachability (ping / SSH) to the affected devices',
        'show logging last 200 — look for the first error in the time window',
        'show interface status / counters errors on the involved links',
        'Compare running-config against the intended design (drift check)',
      ],
      null,
    )]
  }

  return ranked.map((h, i) => ({ ...h, rank: i + 1 }))
}

// ── Live-mode response normalization ──────────────────────────────────────────

type RawHypothesis = Record<string, unknown>

const asStr = (v: unknown): string => (typeof v === 'string' ? v : '')
const asNum = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/**
 * Map a live-mode `/api/rca/analyze` response onto the canonical rich shape.
 * Tolerant of BOTH the real engine (snake_case: root_cause, blast_radius,
 * remediation_steps, automation_available, automation_playbook) AND the legacy
 * lab stub (rank, cause, remediation:string). Missing ranks are assigned by
 * descending confidence.
 */
export function normalizeRcaResponse(raw: unknown): RcaHypothesis[] {
  if (!Array.isArray(raw)) return []
  const mapped: RcaHypothesis[] = raw.map((r0): RcaHypothesis => {
    const r = (r0 && typeof r0 === 'object' ? r0 : {}) as RawHypothesis
    const rootCause = asStr(r.root_cause) || asStr(r.cause) || asStr(r.rootCause) || 'Unknown'
    // remediation: rich array (remediation_steps) or a single stub string
    let steps = asStrArr(r.remediation_steps)
    if (steps.length === 0) steps = asStrArr(r.remediationSteps)
    if (steps.length === 0 && asStr(r.remediation)) steps = [asStr(r.remediation)]
    const playbook = asStr(r.automation_playbook) || asStr(r.automationPlaybook) || null
    const autoFlag = typeof r.automation_available === 'boolean'
      ? r.automation_available
      : typeof r.automationAvailable === 'boolean'
        ? r.automationAvailable
        : !!playbook
    return {
      rank: asNum(r.rank),
      rootCause,
      confidence: clamp01(asNum(r.confidence)),
      evidence: asStrArr(r.evidence),
      blastRadius: asStrArr(r.blast_radius).length ? asStrArr(r.blast_radius) : asStrArr(r.blastRadius),
      remediationSteps: steps,
      automationAvailable: autoFlag,
      automationPlaybook: playbook || null,
    }
  })

  // If the backend didn't supply ranks (all 0), assign by descending confidence.
  if (mapped.every(h => h.rank === 0) && mapped.length > 0) {
    return [...mapped]
      .sort((a, b) => b.confidence - a.confidence)
      .map((h, i) => ({ ...h, rank: i + 1 }))
  }
  return mapped
}
