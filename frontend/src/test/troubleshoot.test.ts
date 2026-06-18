import { describe, it, expect } from 'vitest'
import { simulateTroubleshoot } from '@/pages/Step6Deploy'

const SYMPTOMS = [
  'bgp_down',
  'ospf_adjacency',
  'interface_flap',
  'high_latency',
  'packet_loss',
  'high_cpu',
  'vxlan_evpn',
  'pfc_rocev2',
]

describe('simulateTroubleshoot (G-A19 demo mode)', () => {
  it('returns non-empty steps/causes/remediation for every known symptom', () => {
    for (const sym of SYMPTOMS) {
      const r = simulateTroubleshoot(sym, 'nxos')
      expect(r.symptom).toBe(sym)
      expect(r.category).not.toBe('General')
      expect(r.summary.length).toBeGreaterThan(0)
      expect(r.diagnostic_steps.length).toBeGreaterThan(0)
      expect(r.likely_causes.length).toBeGreaterThan(0)
      expect(r.remediation.length).toBeGreaterThan(0)
      // every step is well-formed
      for (const step of r.diagnostic_steps) {
        expect(step.command.length).toBeGreaterThan(0)
        expect(step.description.length).toBeGreaterThan(0)
        expect(step.look_for.length).toBeGreaterThan(0)
      }
    }
  })

  it('orders diagnostic steps sequentially from 1', () => {
    const r = simulateTroubleshoot('bgp_down', 'iosxe')
    r.diagnostic_steps.forEach((s, i) => expect(s.order).toBe(i + 1))
  })

  it('ranks likely causes by confidence descending', () => {
    for (const sym of SYMPTOMS) {
      const causes = simulateTroubleshoot(sym, 'eos').likely_causes
      for (let i = 1; i < causes.length; i++) {
        expect(causes[i - 1].confidence).toBeGreaterThanOrEqual(causes[i].confidence)
      }
    }
  })

  it('emits platform-specific commands (junos differs from nxos for bgp_down)', () => {
    const nxos = simulateTroubleshoot('bgp_down', 'nxos').diagnostic_steps[0].command
    const junos = simulateTroubleshoot('bgp_down', 'junos').diagnostic_steps[0].command
    expect(nxos).not.toBe(junos)
    expect(nxos).toContain('show ip bgp summary')
    expect(junos).toContain('show bgp summary')
  })

  it('uses no-drop / PFC concepts for pfc_rocev2 remediation', () => {
    const r = simulateTroubleshoot('pfc_rocev2', 'nxos')
    const text = r.remediation.join(' ').toLowerCase()
    expect(text).toContain('pfc')
    expect(text).toContain('no-drop')
  })

  it('flags route-target mismatch as the top cause for vxlan_evpn', () => {
    const r = simulateTroubleshoot('vxlan_evpn', 'nxos')
    expect(r.likely_causes[0].cause.toLowerCase()).toContain('route-target')
  })

  it('falls back to a generic playbook for an unknown symptom', () => {
    const r = simulateTroubleshoot('something_unknown', 'iosxe')
    expect(r.category).toBe('General')
    expect(r.diagnostic_steps.length).toBeGreaterThan(0)
    expect(r.likely_causes.length).toBeGreaterThan(0)
    expect(r.remediation.length).toBeGreaterThan(0)
  })
})
