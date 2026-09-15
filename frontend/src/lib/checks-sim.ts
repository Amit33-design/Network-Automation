/**
 * NetDesign AI — pre/post check simulation (AK2)
 * ===============================================
 * Demo-mode pre/post checks (§12). Extracted out of `Step6Deploy.tsx` because
 * it was buried in a 6000-line component, which is why nobody measured it.
 *
 * Two defects it exists to fix, both of which made the **Rollback Advisor**
 * (K1) recommend rolling back deployments that changed nothing:
 *
 * 1. **Each phase rolled its own dice.** `Math.random()` was called per check
 *    per phase, so the same device+check could be PASS in pre and FAIL in post
 *    by chance alone. Measured on 14 devices × 13 checks with NOTHING deployed
 *    between the phases: an average of **24.5 regressions per run** (21–34),
 *    including ~7.8 critical PASS→FAIL. Every run advised a rollback.
 *    A simulation of a network should model the network, not re-roll it — the
 *    baseline is now a stable property of (device, check), so post differs
 *    from pre only where something actually changed.
 *
 * 2. **Checks were role-blind.** Every device ran all 13, so an access switch
 *    and a firewall reported "2 BGP peers Established", and a DC fabric
 *    reported an OSPF adjacency for a protocol §6 rule 4 says it must not run
 *    (IS-IS for DC/GPU, OSPF for WAN/campus — never both). The checks now
 *    follow the device's role and the design's underlay, and the fabric gets
 *    an IS-IS adjacency check it never had.
 */
import type { CheckResult, ChecksResult, UseCase } from '@/types'
import { BGP_LAYERS } from '@/lib/monitoring'

export type CheckPhase = 'pre' | 'post'

export interface SimDevice { name: string; role: string }

/** §6 rule 4 — IS-IS underlays DC/GPU fabrics; OSPF underlays WAN/campus. */
export type Underlay = 'isis' | 'ospf'

export function underlayFor(useCase: UseCase | ''): Underlay {
  return useCase === 'dc' || useCase === 'gpu' || useCase === 'multisite' ? 'isis' : 'ospf'
}

interface CheckTemplate {
  cat: string
  name: string
  ok: (h: string) => string
  /** Undefined = runs on every device. */
  applies?: (role: string, underlay: Underlay) => boolean
}

const runsBgp = (role: string) => BGP_LAYERS.has(role)

export const CHECK_TEMPLATES: CheckTemplate[] = [
  // Connectivity — every managed device.
  { cat: 'Connectivity', name: 'ICMP Reachability', ok: h => `Ping ${h} 0% loss, RTT 0.8ms` },
  { cat: 'Connectivity', name: 'SSH Access',        ok: h => `SSH ${h}:22 ok in 0.3s` },
  { cat: 'Connectivity', name: 'LLDP Neighbors',    ok: h => `${h}: 4 LLDP neighbors` },

  // Protocols — only where the protocol actually runs.
  {
    cat: 'Protocols', name: 'BGP Session State',
    ok: h => `${h}: 2 BGP peers Established`,
    applies: role => runsBgp(role),
  },
  {
    cat: 'Protocols', name: 'OSPF Adjacency',
    ok: h => `${h}: FULL state on 3 interfaces`,
    // A DC/GPU fabric runs IS-IS by design — reporting an OSPF adjacency there
    // was claiming a protocol the generated config deliberately omits.
    applies: (role, underlay) => underlay === 'ospf' && runsBgp(role),
  },
  {
    cat: 'Protocols', name: 'IS-IS Adjacency',
    ok: h => `${h}: 2 adjacencies UP in level-2`,
    applies: (role, underlay) => underlay === 'isis' && runsBgp(role),
  },
  { cat: 'Protocols', name: 'Interface Status', ok: h => `${h}: 46/48 interfaces Up` },

  // Config — every managed device.
  { cat: 'Config',   name: 'Hostname Match',     ok: h => `Running hostname matches: ${h}` },
  { cat: 'Config',   name: 'Running vs Startup', ok: () => 'Startup config in sync' },
  { cat: 'Config',   name: 'ACL Present',        ok: () => 'Management ACL MGMT-ACCESS found' },

  // Hardware — every managed device.
  { cat: 'Hardware', name: 'CPU Utilization',    ok: () => 'CPU: 18% (threshold 75%)' },
  { cat: 'Hardware', name: 'Memory Utilization', ok: () => 'Memory: 34% (threshold 85%)' },
  { cat: 'Hardware', name: 'Interface Errors',   ok: () => '0 errors on all interfaces' },
  { cat: 'Hardware', name: 'Power & Fan Status', ok: () => 'All PSUs OK, all fans OK' },
]

/** The checks that apply to one device in one design. */
export function checksForDevice(role: string, underlay: Underlay): CheckTemplate[] {
  return CHECK_TEMPLATES.filter(t => !t.applies || t.applies(role, underlay))
}

/**
 * Stable 32-bit hash. The baseline must be a property of the device and the
 * check, not of when the function was called — that is the whole fix.
 */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * A device's standing status for one check. §3 documents roughly 85% PASS /
 * 10% WARN / 5% FAIL, which is preserved — but as a stable property rather
 * than a coin flip, so an unchanged network looks unchanged across phases.
 */
export function baselineStatus(device: string, checkName: string): CheckResult['status'] {
  const r = hash(`${device}::${checkName}`)
  return r < 0.05 ? 'FAIL' : r < 0.15 ? 'WARN' : 'PASS'
}

export function simulateChecks(
  devices: SimDevice[],
  phase: CheckPhase,
  failDevice: string,
  failCheck: string,
  useCase: UseCase | '' = 'dc',
): ChecksResult {
  const underlay = underlayFor(useCase)
  const results: CheckResult[] = []

  for (const dev of devices) {
    for (const tpl of checksForDevice(dev.role, underlay)) {
      // An injected fault is the only thing that moves a status, and it moves
      // it in the POST phase — a fault injected into the baseline would show
      // up in pre as well and cancel out of the regression diff.
      const injected = dev.name === failDevice && tpl.name === failCheck && phase === 'post'
      const status: CheckResult['status'] = injected ? 'FAIL' : baselineStatus(dev.name, tpl.name)

      results.push({
        device: dev.name,
        name: tpl.name,
        status,
        message: status === 'PASS' ? tpl.ok(dev.name)
          : status === 'WARN' ? `${tpl.ok(dev.name)} — minor deviation`
          : `FAILED: ${tpl.name} check failed on ${dev.name}`,
        remediation: status === 'FAIL'
          ? `Review ${tpl.name} on ${dev.name}; check ${phase === 'pre' ? 'connectivity and baseline' : 'post-deploy state'}`
          : null,
      })
    }
  }
  return { phase, results }
}
