import { describe, it, expect } from 'vitest'
import { runClosedLoop, closedLoopToText } from '@/lib/closed-loop'
import type { ConfigDriftResponse, ConfigRemediationResponse } from '@/types'

function drift(devices: Array<{ host: string; added?: string[]; removed?: string[] }>): ConfigDriftResponse {
  const ds = devices.map(d => {
    const added = d.added ?? []
    const removed = d.removed ?? []
    const has_drift = added.length + removed.length > 0
    return { hostname: d.host, has_drift, added, removed, unified_diff: '', no_baseline: false }
  })
  return { devices: ds, drift_count: ds.filter(d => d.has_drift).length, device_count: ds.length }
}

function remediation(devices: Array<{ host: string; platform: string; commands: string[] }>): ConfigRemediationResponse {
  return {
    devices: devices.map(d => ({
      hostname: d.host, platform: d.platform, commands: d.commands, command_count: d.commands.length,
    })),
  }
}

describe('K2 — runClosedLoop convergence', () => {
  it('converges when all drifted devices remediate', () => {
    const d = drift([
      { host: 'leaf-01', added: ['  shutdown'], removed: ['  no shutdown'] },
      { host: 'leaf-02' }, // clean
    ])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown', '  no shutdown'] }])
    const result = runClosedLoop(d, r)
    expect(result.converged).toBe(true)
    expect(result.summary.drifted).toBe(1)
    expect(result.summary.converged).toBe(1)
    expect(result.summary.diverged).toBe(0)
    expect(result.devices).toHaveLength(1)
    expect(result.devices[0].driftLinesAfter).toBe(0)
    expect(result.devices[0].converged).toBe(true)
  })

  it('reports a clean system (no drift) as converged with skipped stages', () => {
    const d = drift([{ host: 'leaf-01' }, { host: 'leaf-02' }])
    const r = remediation([])
    const result = runClosedLoop(d, r)
    expect(result.converged).toBe(true)
    expect(result.summary.drifted).toBe(0)
    expect(result.devices).toHaveLength(0)
    const plan = result.stages.find(s => s.name === 'plan')!
    expect(plan.status).toBe('skipped')
    const done = result.stages.find(s => s.name === 'done')!
    expect(done.status).toBe('ok')
    expect(done.detail).toContain('in sync')
  })

  it('diverges when a fail device does not converge', () => {
    const d = drift([
      { host: 'leaf-01', added: ['  shutdown'] },
      { host: 'leaf-02', removed: ['  ntp server 10.0.0.1'] },
    ])
    const r = remediation([
      { host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] },
      { host: 'leaf-02', platform: 'eos', commands: ['  ntp server 10.0.0.1'] },
    ])
    const result = runClosedLoop(d, r, { failDevices: ['leaf-02'] })
    expect(result.converged).toBe(false)
    expect(result.summary.converged).toBe(1)
    expect(result.summary.diverged).toBe(1)
    const verify = result.stages.find(s => s.name === 'verify')!
    expect(verify.status).toBe('failed')
    const failDev = result.devices.find(x => x.hostname === 'leaf-02')!
    expect(failDev.converged).toBe(false)
    expect(failDev.driftLinesAfter).toBe(failDev.driftLinesBefore)
  })
})

describe('K2 — runClosedLoop stages', () => {
  it('emits the five pipeline stages in order', () => {
    const d = drift([{ host: 'leaf-01', added: ['  shutdown'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] }])
    const result = runClosedLoop(d, r)
    expect(result.stages.map(s => s.name)).toEqual(['detect', 'plan', 'apply', 'verify', 'done'])
  })

  it('detect stage warns when drift is present', () => {
    const d = drift([{ host: 'leaf-01', added: ['  shutdown'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] }])
    const detect = runClosedLoop(d, r).stages.find(s => s.name === 'detect')!
    expect(detect.status).toBe('warn')
    expect(detect.detail).toContain('1 of 1')
  })

  it('apply stage warns when some devices will diverge', () => {
    const d = drift([{ host: 'leaf-01', added: ['  shutdown'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] }])
    const apply = runClosedLoop(d, r, { failDevices: ['leaf-01'] }).stages.find(s => s.name === 'apply')!
    expect(apply.status).toBe('warn')
  })
})

describe('K2 — runClosedLoop device accounting', () => {
  it('counts drift lines and commands per device', () => {
    const d = drift([{ host: 'leaf-01', added: ['  a', '  b'], removed: ['  c'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  c', '  no a', '  no b'] }])
    const dev = runClosedLoop(d, r).devices[0]
    expect(dev.driftLinesBefore).toBe(3)
    expect(dev.commandsApplied).toBe(3)
    expect(dev.platform).toBe('nxos')
  })

  it('falls back to drift-line count when remediation is missing for a device', () => {
    const d = drift([{ host: 'leaf-01', added: ['  a', '  b'] }])
    const r = remediation([]) // no remediation entry
    const dev = runClosedLoop(d, r).devices[0]
    expect(dev.commandsApplied).toBe(2)
    expect(dev.platform).toBe('unknown')
  })

  it('aggregates total commands across devices', () => {
    const d = drift([
      { host: 'leaf-01', added: ['  a'] },
      { host: 'leaf-02', added: ['  b', '  c'] },
    ])
    const r = remediation([
      { host: 'leaf-01', platform: 'nxos', commands: ['  no a'] },
      { host: 'leaf-02', platform: 'eos', commands: ['  no b', '  no c'] },
    ])
    expect(runClosedLoop(d, r).summary.commands).toBe(3)
  })
})

describe('K2 — closedLoopToText', () => {
  it('renders a converged report', () => {
    const d = drift([{ host: 'leaf-01', added: ['  shutdown'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] }])
    const text = closedLoopToText(runClosedLoop(d, r))
    expect(text).toContain('Result: CONVERGED')
    expect(text).toContain('leaf-01 (nxos)')
    expect(text).toContain('CONVERGED')
  })

  it('renders a diverged report', () => {
    const d = drift([{ host: 'leaf-01', added: ['  shutdown'] }])
    const r = remediation([{ host: 'leaf-01', platform: 'nxos', commands: ['  no shutdown'] }])
    const text = closedLoopToText(runClosedLoop(d, r, { failDevices: ['leaf-01'] }))
    expect(text).toContain('Result: DIVERGED')
    expect(text).toContain('DIVERGED')
  })

  it('handles the no-drift case', () => {
    const text = closedLoopToText(runClosedLoop(drift([{ host: 'leaf-01' }]), remediation([])))
    expect(text).toContain('no drifted devices')
  })
})
