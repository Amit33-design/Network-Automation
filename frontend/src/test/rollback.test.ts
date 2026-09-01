import { describe, it, expect } from 'vitest'
import {
  ROLLBACK_STRATEGIES,
  vendorToPlatform,
  detectRegressions,
  generateRollbackPlan,
  rollbackCommandsFor,
  rollbackTimestamp,
  rollbackPlanToText,
  type Platform,
} from '@/lib/rollback'
import type { CheckResult, BOMDevice } from '@/types'

function check(device: string, name: string, status: CheckResult['status'], message = ''): CheckResult {
  return { device, name, status, message, remediation: null }
}

function dev(hostname: string, vendor: string, subLayer: string): BOMDevice {
  return {
    id: hostname, hostname, role: subLayer, subLayer, model: 'M', vendor,
    count: 1, unitPrice: 0, totalPrice: 0, speed: '100G', ports: 32, features: [],
  }
}

describe('K1 — vendorToPlatform', () => {
  it('Cisco spine/leaf → nxos, edge/campus → iosxe', () => {
    expect(vendorToPlatform('Cisco', 'spine')).toBe('nxos')
    expect(vendorToPlatform('Cisco', 'leaf')).toBe('nxos')
    expect(vendorToPlatform('Cisco', 'wan-edge')).toBe('iosxe')
    expect(vendorToPlatform('Cisco', 'distribution')).toBe('iosxe')
  })

  it('maps every catalogue vendor to the NOS it actually runs', () => {
    // Dell EMC and NVIDIA used to both return 'sonic', and everything else
    // fell through to 'iosxe' — so a Palo Alto firewall, a Nokia SR Linux
    // switch, a FortiSwitch, an Aruba CX and an EXOS box were all handed
    // Cisco `configure replace` as their recovery command (AG5).
    expect(vendorToPlatform('Arista', 'leaf')).toBe('eos')
    expect(vendorToPlatform('Juniper', 'leaf')).toBe('junos')
    expect(vendorToPlatform('Dell EMC', 'spine')).toBe('dellos10')
    expect(vendorToPlatform('NVIDIA', 'leaf')).toBe('cumulus')
    expect(vendorToPlatform('Nokia', 'leaf')).toBe('srl')
    expect(vendorToPlatform('Extreme Networks', 'access')).toBe('exos')
    expect(vendorToPlatform('Fortinet', 'firewall')).toBe('fortios')
    expect(vendorToPlatform('HPE Aruba', 'access')).toBe('arubaoscx')
    expect(vendorToPlatform('Palo Alto', 'firewall')).toBe('panos')
  })

  it('resolves Cisco by model when one is given', () => {
    expect(vendorToPlatform('Cisco', 'wan-edge', 'ASR 9904')).toBe('iosxr')
    expect(vendorToPlatform('Cisco', 'leaf', 'Nexus 93180YC-FX')).toBe('nxos')
    expect(vendorToPlatform('Cisco', 'access', 'Catalyst 9200')).toBe('iosxe')
  })

  it('defaults unknown vendors to iosxe', () => {
    expect(vendorToPlatform('Acme', 'leaf')).toBe('iosxe')
  })

  it('gives every catalogue vendor a complete, usable strategy', () => {
    // A recovery runbook that omits the restore step, or prescribes another
    // vendor's, is discovered during an outage.
    const vendors = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC',
                     'Extreme Networks', 'Fortinet', 'HPE Aruba', 'Palo Alto']
    for (const v of vendors) {
      for (const role of ['spine', 'leaf', 'access', 'firewall', 'wan-edge']) {
        const p = vendorToPlatform(v, role)
        const strat = ROLLBACK_STRATEGIES[p]
        expect(strat, `${v}/${role} → ${p} has no strategy`).toBeTruthy()
        expect(strat.pre, `${v}/${role} → ${p} has no checkpoint step`).toBeTruthy()
        expect(strat.exec, `${v}/${role} → ${p} has no restore step`).toBeTruthy()
      }
    }
  })

  it('never prescribes one vendor\'s CLI to another', () => {
    // Spot-check the commands that were actually being mis-issued.
    expect(ROLLBACK_STRATEGIES.panos.exec).not.toContain('configure replace')
    expect(ROLLBACK_STRATEGIES.srl.exec).not.toContain('configure replace')
    expect(ROLLBACK_STRATEGIES.fortios.exec).not.toContain('configure replace')
    expect(ROLLBACK_STRATEGIES.dellos10.exec).not.toContain('config load')
    expect(ROLLBACK_STRATEGIES.panos.exec).toContain('load config from')
    expect(ROLLBACK_STRATEGIES.srl.exec).toContain('checkpoint')
  })
})

describe('K1 — ROLLBACK_STRATEGIES mirrors CLAUDE.md §9', () => {
  it('has an exec command for every platform it declares', () => {
    // Was a hard-coded list of five. The catalogue produces twelve NOSes, and
    // the seven that were missing all silently resolved to Cisco IOS-XE (AG5),
    // so enumerate the record rather than a list that can fall behind it.
    const platforms = Object.keys(ROLLBACK_STRATEGIES) as Platform[]
    expect(platforms.length).toBeGreaterThanOrEqual(12)
    for (const p of platforms) {
      expect(ROLLBACK_STRATEGIES[p], p).toBeDefined()
      expect(ROLLBACK_STRATEGIES[p].exec, `${p} has no restore step`).toBeTruthy()
    }
  })

  it('junos uses commit confirmed for auto-rollback', () => {
    expect(ROLLBACK_STRATEGIES.junos.deployCmd).toContain('commit confirmed')
  })

  it('nxos uses atomic checkpoint rollback', () => {
    expect(ROLLBACK_STRATEGIES.nxos.exec).toContain('rollback running-config checkpoint')
    expect(ROLLBACK_STRATEGIES.nxos.exec).toContain('atomic')
  })
})

describe('K1 — rollbackCommandsFor', () => {
  it('substitutes the {ts} token', () => {
    const cmds = rollbackCommandsFor('iosxe', '20260622-053000')
    expect(cmds).toEqual(['configure replace flash:pre-deploy-20260622-053000.cfg force'])
  })

  it('splits multi-line junos rollback into two commands', () => {
    const cmds = rollbackCommandsFor('junos', '20260622-053000')
    expect(cmds).toEqual(['rollback 1', 'commit'])
  })
})

describe('K1 — rollbackTimestamp', () => {
  it('formats as YYYYMMDD-HHMMSS', () => {
    const ts = rollbackTimestamp(new Date(2026, 5, 22, 5, 30, 9))
    expect(ts).toBe('20260622-053009')
  })
})

describe('K1 — detectRegressions', () => {
  it('flags PASS → FAIL as critical', () => {
    const pre = [check('leaf-01', 'BGP Session State', 'PASS')]
    const post = [check('leaf-01', 'BGP Session State', 'FAIL', 'session down')]
    const regs = detectRegressions(pre, post)
    expect(regs).toHaveLength(1)
    expect(regs[0].severity).toBe('critical')
    expect(regs[0].fromStatus).toBe('PASS')
    expect(regs[0].toStatus).toBe('FAIL')
    expect(regs[0].message).toBe('session down')
  })

  it('flags WARN → FAIL as major', () => {
    const pre = [check('leaf-01', 'CPU Utilization', 'WARN')]
    const post = [check('leaf-01', 'CPU Utilization', 'FAIL')]
    expect(detectRegressions(pre, post)[0].severity).toBe('major')
  })

  it('flags PASS → WARN as minor', () => {
    const pre = [check('leaf-01', 'Memory Utilization', 'PASS')]
    const post = [check('leaf-01', 'Memory Utilization', 'WARN')]
    expect(detectRegressions(pre, post)[0].severity).toBe('minor')
  })

  it('does NOT flag improvements (FAIL → PASS)', () => {
    const pre = [check('leaf-01', 'BGP Session State', 'FAIL')]
    const post = [check('leaf-01', 'BGP Session State', 'PASS')]
    expect(detectRegressions(pre, post)).toHaveLength(0)
  })

  it('does NOT flag unchanged checks', () => {
    const pre = [check('leaf-01', 'ICMP Reachability', 'PASS')]
    const post = [check('leaf-01', 'ICMP Reachability', 'PASS')]
    expect(detectRegressions(pre, post)).toHaveLength(0)
  })

  it('ignores SKIP on either side', () => {
    const pre1 = [check('leaf-01', 'X', 'SKIP')]
    const post1 = [check('leaf-01', 'X', 'FAIL')]
    expect(detectRegressions(pre1, post1)).toHaveLength(0)
    const pre2 = [check('leaf-01', 'X', 'PASS')]
    const post2 = [check('leaf-01', 'X', 'SKIP')]
    expect(detectRegressions(pre2, post2)).toHaveLength(0)
  })

  it('ignores checks with no pre-baseline match', () => {
    const pre = [check('leaf-01', 'A', 'PASS')]
    const post = [check('leaf-02', 'A', 'FAIL')] // different device
    expect(detectRegressions(pre, post)).toHaveLength(0)
  })

  it('handles multiple devices and checks', () => {
    const pre = [
      check('leaf-01', 'BGP', 'PASS'),
      check('leaf-01', 'CPU', 'PASS'),
      check('leaf-02', 'BGP', 'PASS'),
    ]
    const post = [
      check('leaf-01', 'BGP', 'FAIL'),
      check('leaf-01', 'CPU', 'PASS'),
      check('leaf-02', 'BGP', 'WARN'),
    ]
    const regs = detectRegressions(pre, post)
    expect(regs).toHaveLength(2)
  })
})

describe('K1 — generateRollbackPlan', () => {
  const devices = [
    dev('leaf-01', 'Cisco', 'leaf'),
    dev('leaf-02', 'Arista', 'leaf'),
    dev('edge-01', 'Juniper', 'wan-edge'),
  ]
  const ts = '20260622-053000'

  it('recommends rollback when a critical regression exists', () => {
    const pre = [check('leaf-01', 'BGP', 'PASS')]
    const post = [check('leaf-01', 'BGP', 'FAIL')]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.recommended).toBe(true)
    expect(plan.summary.critical).toBe(1)
    expect(plan.devices).toHaveLength(1)
    expect(plan.devices[0].platform).toBe('nxos')
    expect(plan.devices[0].commands[0]).toContain('rollback running-config checkpoint pre-deploy-20260622-053000')
  })

  it('does NOT recommend rollback for minor-only regressions', () => {
    const pre = [check('leaf-01', 'Memory', 'PASS')]
    const post = [check('leaf-01', 'Memory', 'WARN')]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.recommended).toBe(false)
    expect(plan.summary.minor).toBe(1)
  })

  it('emits platform-correct commands per device', () => {
    const pre = [
      check('leaf-01', 'BGP', 'PASS'),
      check('leaf-02', 'BGP', 'PASS'),
      check('edge-01', 'OSPF', 'PASS'),
    ]
    const post = [
      check('leaf-01', 'BGP', 'FAIL'),
      check('leaf-02', 'BGP', 'FAIL'),
      check('edge-01', 'OSPF', 'FAIL'),
    ]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.devices).toHaveLength(3)
    const byHost = Object.fromEntries(plan.devices.map(d => [d.device, d]))
    expect(byHost['leaf-01'].platform).toBe('nxos')
    expect(byHost['leaf-02'].platform).toBe('eos')
    expect(byHost['leaf-02'].commands[0]).toContain('rollback clean-config checkpoint')
    expect(byHost['edge-01'].platform).toBe('junos')
    expect(byHost['edge-01'].commands).toEqual(['rollback 1', 'commit'])
  })

  it('sorts most-affected device first', () => {
    const pre = [
      check('leaf-01', 'BGP', 'PASS'),
      check('leaf-02', 'BGP', 'PASS'),
      check('leaf-02', 'CPU', 'PASS'),
    ]
    const post = [
      check('leaf-01', 'BGP', 'FAIL'),
      check('leaf-02', 'BGP', 'FAIL'),
      check('leaf-02', 'CPU', 'FAIL'),
    ]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.devices[0].device).toBe('leaf-02') // 2 regressions
    expect(plan.devices[1].device).toBe('leaf-01') // 1 regression
  })

  it('returns an empty, non-recommended plan when no regressions', () => {
    const pre = [check('leaf-01', 'BGP', 'PASS')]
    const post = [check('leaf-01', 'BGP', 'PASS')]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.recommended).toBe(false)
    expect(plan.devices).toHaveLength(0)
    expect(plan.summary.total).toBe(0)
  })

  it('falls back to iosxe when device not in BOM', () => {
    const pre = [check('mystery-01', 'BGP', 'PASS')]
    const post = [check('mystery-01', 'BGP', 'FAIL')]
    const plan = generateRollbackPlan(pre, post, devices, ts)
    expect(plan.devices[0].platform).toBe('iosxe')
  })
})

describe('K1 — rollbackPlanToText', () => {
  const ts = '20260622-053000'
  it('renders a runbook with per-device blocks', () => {
    const pre = [check('leaf-01', 'BGP', 'PASS')]
    const post = [check('leaf-01', 'BGP', 'FAIL')]
    const plan = generateRollbackPlan(pre, post, [dev('leaf-01', 'Cisco', 'leaf')], ts)
    const text = rollbackPlanToText(plan, ts)
    expect(text).toContain('leaf-01 (nxos)')
    expect(text).toContain('BGP: PASS -> FAIL [critical]')
    expect(text).toContain('rollback running-config checkpoint pre-deploy-20260622-053000 atomic')
  })

  it('renders a no-op message when there are no regressions', () => {
    const plan = generateRollbackPlan([], [], [], ts)
    expect(rollbackPlanToText(plan, ts)).toContain('No regressions detected')
  })
})
