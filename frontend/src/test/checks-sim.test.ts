import { describe, it, expect } from 'vitest'
import { detectRegressions, generateRollbackPlan } from '@/lib/rollback'
import { buildDeviceList } from '@/lib/bom'
import {
  CHECK_TEMPLATES,
  baselineStatus,
  checksForDevice,
  simulateChecks,
  underlayFor,
  type SimDevice,
} from '@/lib/checks-sim'

function simDevices(useCase: 'dc' | 'campus' = 'dc'): SimDevice[] {
  return buildDeviceList({ useCase, scale: 'medium', siteCode: 'T' })
    .map(d => ({ name: d.hostname, role: d.subLayer }))
}

describe('pre/post check simulation (AK2)', () => {
  it('an unchanged network produces ZERO regressions', () => {
    // The defect this module exists to fix: each phase called Math.random()
    // per check, so 14 devices × 13 checks with nothing deployed between the
    // phases averaged 24.5 regressions per run (21–34), ~7.8 of them critical
    // PASS→FAIL. Every single run advised rolling back a no-op deployment.
    const devices = simDevices()
    expect(devices.length).toBeGreaterThan(10)
    for (let run = 0; run < 25; run++) {
      const pre = simulateChecks(devices, 'pre', '', '', 'dc')
      const post = simulateChecks(devices, 'post', '', '', 'dc')
      expect(detectRegressions(pre.results, post.results)).toEqual([])
    }
  })

  it('surfaces exactly the injected fault, and nothing else', () => {
    const devices = simDevices()
    const target = devices.find(d => d.role === 'leaf')!
    const pre = simulateChecks(devices, 'pre', target.name, 'Interface Status', 'dc')
    const post = simulateChecks(devices, 'post', target.name, 'Interface Status', 'dc')
    const regs = detectRegressions(pre.results, post.results)
    expect(regs.length).toBe(1)
    expect(regs[0].device).toBe(target.name)
    expect(regs[0].checkName).toBe('Interface Status')
    expect(regs[0].toStatus).toBe('FAIL')
    // and the advisor acts on it
    const plan = generateRollbackPlan(
      pre.results, post.results,
      buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T' }),
    )
    expect(plan.regressions.length).toBe(1)
  })

  it('is deterministic across calls', () => {
    const devices = simDevices()
    const a = simulateChecks(devices, 'pre', '', '', 'dc')
    const b = simulateChecks(devices, 'pre', '', '', 'dc')
    expect(a.results.map(r => `${r.device}|${r.name}|${r.status}`))
      .toEqual(b.results.map(r => `${r.device}|${r.name}|${r.status}`))
  })

  it('keeps the documented ~85/10/5 distribution', () => {
    // Stable is not the same as uniform — the mix §3 documents must survive.
    let pass = 0, warn = 0, fail = 0
    for (let i = 0; i < 4000; i++) {
      const s = baselineStatus(`DEV-${i}`, CHECK_TEMPLATES[i % CHECK_TEMPLATES.length].name)
      if (s === 'PASS') pass++; else if (s === 'WARN') warn++; else fail++
    }
    expect(pass / 4000).toBeGreaterThan(0.80)
    expect(pass / 4000).toBeLessThan(0.90)
    expect(warn / 4000).toBeGreaterThan(0.05)
    expect(fail / 4000).toBeGreaterThan(0.02)
  })

  it('does not run a BGP check on devices that have no BGP', () => {
    // An access switch and a firewall were reporting "2 BGP peers Established".
    for (const role of ['access', 'firewall', 'gpu-compute']) {
      const names = checksForDevice(role, 'isis').map(t => t.name)
      expect(names, role).not.toContain('BGP Session State')
    }
    for (const role of ['spine', 'leaf', 'core', 'wan-edge']) {
      expect(checksForDevice(role, 'isis').map(t => t.name), role).toContain('BGP Session State')
    }
  })

  it('checks the underlay the design actually runs, never both', () => {
    // §6 rule 4: IS-IS for DC/GPU, OSPF for WAN/campus — never both. A DC
    // fabric was reporting an OSPF adjacency for a protocol its generated
    // config deliberately omits.
    const dc = checksForDevice('leaf', underlayFor('dc')).map(t => t.name)
    expect(dc).toContain('IS-IS Adjacency')
    expect(dc).not.toContain('OSPF Adjacency')

    const campus = checksForDevice('distribution', underlayFor('campus')).map(t => t.name)
    expect(campus).toContain('OSPF Adjacency')
    expect(campus).not.toContain('IS-IS Adjacency')
  })

  it('never reports both underlays on any role in any use case', () => {
    const roles = ['spine', 'leaf', 'core', 'distribution', 'access', 'wan-edge', 'firewall']
    for (const uc of ['dc', 'gpu', 'campus', 'wan', 'multisite', 'multicloud'] as const) {
      for (const role of roles) {
        const names = checksForDevice(role, underlayFor(uc)).map(t => t.name)
        const both = names.includes('OSPF Adjacency') && names.includes('IS-IS Adjacency')
        expect(both, `${uc}/${role}`).toBe(false)
      }
    }
  })

  it('every device still gets the universal checks', () => {
    // Role-awareness must narrow the protocol checks, not strand a device
    // with nothing checked at all.
    for (const role of ['spine', 'leaf', 'access', 'firewall', 'gpu-compute', 'unknown-role']) {
      const names = checksForDevice(role, 'isis').map(t => t.name)
      for (const universal of ['ICMP Reachability', 'SSH Access', 'Hostname Match', 'CPU Utilization']) {
        expect(names, `${role} missing ${universal}`).toContain(universal)
      }
      expect(names.length).toBeGreaterThanOrEqual(10)
    }
  })

  it('a campus design and a DC design get different protocol checks', () => {
    const dcNames = new Set(simulateChecks(simDevices('dc'), 'pre', '', '', 'dc').results.map(r => r.name))
    const campusNames = new Set(simulateChecks(simDevices('campus'), 'pre', '', '', 'campus').results.map(r => r.name))
    expect(dcNames.has('IS-IS Adjacency')).toBe(true)
    expect(dcNames.has('OSPF Adjacency')).toBe(false)
    expect(campusNames.has('OSPF Adjacency')).toBe(true)
    expect(campusNames.has('IS-IS Adjacency')).toBe(false)
  })
})
