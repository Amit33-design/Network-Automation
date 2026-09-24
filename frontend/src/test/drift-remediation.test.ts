import { describe, it, expect } from 'vitest'
import { cliFamily } from '@/lib/config-update'
import { remediationFor } from '@/lib/drift-remediation'
import { simulateRemediation } from '@/pages/Step6Deploy'

const ADDED = ['  ip access-group TEMP-BLOCK in']
const REMOVED = ['  ntp server 10.0.0.1']
const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA',
  'Dell EMC', 'Extreme Networks', 'Fortinet', 'Palo Alto', 'HPE Aruba']

describe('drift remediation dialect (AL1)', () => {
  it('no longer hands non-IOS vendors Cisco `no` negation', () => {
    // Measured before AL1: 8 of 10 vendors got `no <line>`. Four are genuinely
    // IOS-style; Nokia SR Linux, Cumulus, EXOS, FortiOS and PAN-OS are not.
    for (const v of ['Nokia', 'NVIDIA', 'Palo Alto']) {
      const r = remediationFor(v, ADDED, REMOVED)
      expect(r.supported, v).toBe(true)
      expect(r.commands.join('\n'), v).not.toMatch(/^\s*no /m)
      expect(r.commands.length, v).toBeGreaterThan(0)
    }
  })

  it('keeps `no` for the vendors that genuinely are IOS-style', () => {
    // Narrowing the dialect must not break what was already correct.
    for (const v of ['Cisco', 'Arista', 'Dell EMC', 'HPE Aruba']) {
      const r = remediationFor(v, ADDED, REMOVED)
      expect(r.supported, v).toBe(true)
      expect(r.commands.some(c => c.trim().startsWith('no ')), v).toBe(true)
    }
  })

  it('uses each derivable dialect its own form', () => {
    expect(remediationFor('Juniper', ADDED, REMOVED).commands)
      .toEqual(['set ntp server 10.0.0.1', 'delete ip access-group TEMP-BLOCK in'])
    const nv = remediationFor('NVIDIA', ADDED, REMOVED).commands
    expect(nv[0]).toMatch(/^nv set /)
    expect(nv[1]).toMatch(/^nv unset /)
  })

  it('refuses rather than guessing where negation is not derivable', () => {
    // EXOS negation is per-command and FortiOS needs the enclosing config
    // path; a plausible `unconfigure <line>` would look runnable and not be.
    for (const v of ['Extreme Networks', 'Fortinet']) {
      const r = remediationFor(v, ADDED, REMOVED)
      expect(r.supported, v).toBe(false)
      expect(r.commands, v).toEqual([])
      expect(r.note.length, v).toBeGreaterThan(40)
    }
  })

  it('every catalogue vendor is either served or explained', () => {
    // A vendor in neither state renders an empty block with no reason.
    for (const v of VENDORS) {
      const r = remediationFor(v, ADDED, REMOVED)
      expect(r.supported || r.note.length > 0, v).toBe(true)
      if (r.supported) expect(r.commands.length, v).toBeGreaterThan(0)
    }
  })

  it('resolves the dialect through the shared cliFamily map, not a new one', () => {
    // A seventh private vendor table is the drift this codebase keeps paying
    // for — so the same vendor must get the same family everywhere.
    expect(cliFamily('Nokia')).toBe('nokia')
    expect(cliFamily('NVIDIA')).toBe('nvue')
    // and remediation must agree with it
    expect(remediationFor('Nokia', [], ['x']).commands[0]).toMatch(/^set /)
    expect(remediationFor('NVIDIA', [], ['x']).commands[0]).toMatch(/^nv set /)
  })

  it('simulateRemediation carries supported/note through to the UI', () => {
    const r = simulateRemediation([
      { hostname: 'A', platform: 'Nokia', added: ADDED, removed: REMOVED },
      { hostname: 'B', platform: 'Extreme Networks', added: ADDED, removed: REMOVED },
    ])
    expect(r.devices[0].supported).toBe(true)
    expect(r.devices[0].command_count).toBe(2)
    expect(r.devices[1].supported).toBe(false)
    expect(r.devices[1].command_count).toBe(0)
    expect(r.devices[1].note).toBeTruthy()
  })
})
