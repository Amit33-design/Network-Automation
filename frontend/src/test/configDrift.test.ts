import { describe, it, expect } from 'vitest'
import { simulateConfigDrift, simulateRemediation } from '@/pages/Step6Deploy'

const CONFIGS: Record<string, string> = {
  'dev-1': 'hostname leaf1\ninterface Eth1\n  no shutdown\n',
  'dev-2': 'hostname spine1\nlogging console\n',
  'dev-3': 'hostname fw1\nntp server 10.0.0.1\n',
}

describe('simulateConfigDrift (G-A4 demo mode)', () => {
  it('returns an empty result for an empty config set', () => {
    const result = simulateConfigDrift({})
    expect(result.devices).toEqual([])
    expect(result.device_count).toBe(0)
    expect(result.drift_count).toBe(0)
  })

  it('reports all devices in sync when no fault device is specified', () => {
    const result = simulateConfigDrift(CONFIGS)
    expect(result.device_count).toBe(3)
    expect(result.drift_count).toBe(0)
    for (const dev of result.devices) {
      expect(dev.has_drift).toBe(false)
      expect(dev.no_baseline).toBe(false)
      expect(dev.added).toEqual([])
      expect(dev.removed).toEqual([])
      expect(dev.unified_diff).toBe('')
    }
  })

  it('injects drift only on the specified fault device', () => {
    const result = simulateConfigDrift(CONFIGS, 'dev-2')
    expect(result.device_count).toBe(3)
    expect(result.drift_count).toBe(1)

    const byHost = Object.fromEntries(result.devices.map(d => [d.hostname, d]))
    expect(byHost['dev-1'].has_drift).toBe(false)
    expect(byHost['dev-3'].has_drift).toBe(false)

    const faulted = byHost['dev-2']
    expect(faulted.has_drift).toBe(true)
    expect(faulted.no_baseline).toBe(false)
    expect(faulted.added.length + faulted.removed.length).toBeGreaterThan(0)
    expect(faulted.unified_diff).toContain('--- intended')
    expect(faulted.unified_diff).toContain('+++ running')
  })

  it('produces a unified diff whose +/- lines match added/removed', () => {
    const result = simulateConfigDrift(CONFIGS, 'dev-1')
    const dev = result.devices.find(d => d.hostname === 'dev-1')!
    for (const line of dev.added) {
      expect(dev.unified_diff).toContain(`+${line}`)
    }
    for (const line of dev.removed) {
      expect(dev.unified_diff).toContain(`-${line}`)
    }
  })
})

describe('simulateRemediation (G-A16 demo mode)', () => {
  it('restores missing intended lines and negates extra cisco lines', () => {
    const res = simulateRemediation([
      { hostname: 'dev-1', platform: 'ios-xe', added: ['  ip access-group TEMP in'], removed: ['  ntp server 10.0.0.1'] },
    ])
    const dev = res.devices[0]
    // restores (removed) first, then prunes (added)
    expect(dev.commands).toEqual(['  ntp server 10.0.0.1', '  no ip access-group TEMP in'])
    expect(dev.command_count).toBe(2)
  })

  it('re-enables an extra `no shutdown` and preserves indentation', () => {
    const res = simulateRemediation([
      { hostname: 'sw', platform: 'eos', added: ['    no shutdown'], removed: [] },
    ])
    expect(res.devices[0].commands).toEqual(['    shutdown'])
  })

  it('uses set/delete syntax for junos', () => {
    const res = simulateRemediation([
      { hostname: 'mx', platform: 'juniper-junos', added: ['set system services telnet'], removed: ['set system host-name mx01'] },
    ])
    expect(res.devices[0].commands).toContain('set system host-name mx01')
    expect(res.devices[0].commands).toContain('delete system services telnet')
  })

  it('returns no commands when there is no drift', () => {
    const res = simulateRemediation([{ hostname: 'sw', platform: 'ios-xe', added: [], removed: [] }])
    expect(res.devices[0].commands).toEqual([])
  })
})
