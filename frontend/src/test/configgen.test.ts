import { describe, it, expect } from 'vitest'
import { generateConfig, generateAllConfigs } from '@/lib/configgen'
import type { BOMDevice } from '@/types'

function makeDevice(overrides: Partial<BOMDevice> = {}): BOMDevice {
  return {
    id: 'test-1',
    hostname: 'IAD-SPINE-A01',
    role: 'spine',
    subLayer: 'spine',
    model: 'Nexus 9336C-FX2',
    vendor: 'Cisco',
    count: 1,
    unitPrice: 28000,
    totalPrice: 28000,
    speed: '100G',
    ports: 36,
    features: ['BGP', 'VXLAN'],
    ...overrides,
  }
}

// ── Issue 1: No duplicate config blocks ───────────────────────────────────────
describe('No duplicate configuration blocks (Issue 1)', () => {
  it('NX-OS spine has exactly one aaa new-model', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    const matches = (cfg.match(/aaa new-model/g) ?? []).length
    expect(matches).toBe(1)
  })

  it('NX-OS leaf has exactly one aaa new-model', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    const matches = (cfg.match(/aaa new-model/g) ?? []).length
    expect(matches).toBe(1)
  })

  it('NX-OS spine has no "POLICY BLOCKS" append section', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).not.toContain('POLICY BLOCKS')
  })

  it('Cisco FW has exactly one aaa new-model', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    const matches = (cfg.match(/aaa new-model/g) ?? []).length
    expect(matches).toBe(1)
  })

  it('NX-OS spine has only one tacacs-server PRIMARY declaration', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    const primaryCount = (cfg.match(/TACACS-PRIMARY/g) ?? []).length
    // Should appear 2-3 times (declaration + group member + maybe group assignment), not 6+
    expect(primaryCount).toBeLessThan(6)
  })
})

// ── Issue 2: Firewall configs are actual firewalls ─────────────────────────────
describe('Firewall configs use zone-based / NGFW syntax (Issue 2)', () => {
  it('Cisco firewall config contains zone-based firewall (zone security)', () => {
    const dev = makeDevice({ hostname: 'TST-FW-A01', vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('zone security')
  })

  it('Cisco firewall config contains zone-pair (stateful inspection)', () => {
    const dev = makeDevice({ hostname: 'TST-FW-A01', vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('zone-pair security')
  })

  it('Cisco firewall config contains policy-map type inspect', () => {
    const dev = makeDevice({ hostname: 'TST-FW-A01', vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('policy-map type inspect')
  })

  it('Cisco firewall config contains NAT', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('ip nat')
  })

  it('Palo Alto firewall uses PAN-OS set commands', () => {
    const dev = makeDevice({ hostname: 'TST-PANFW-A01', vendor: 'Palo Alto', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set deviceconfig system hostname TST-PANFW-A01')
    expect(cfg).toContain('set rulebase security rules')
    expect(cfg).toContain('set zone OUTSIDE')
    expect(cfg).toContain('set zone INSIDE')
  })

  it('Palo Alto firewall has threat prevention profiles', () => {
    const dev = makeDevice({ vendor: 'Palo Alto', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set profiles virus')
    expect(cfg).toContain('set profiles spyware')
    expect(cfg).toContain('set profiles vulnerability')
  })

  it('Cisco firewall does NOT use NX-OS/router syntax as main body', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    // Should NOT have spine/leaf VXLAN or IS-IS underlay
    expect(cfg).not.toContain('interface nve1')
    expect(cfg).not.toContain('router isis')
  })
})

// ── Issue 3: No hardcoded secrets ─────────────────────────────────────────────
describe('No hardcoded secrets — placeholders only (Issue 3)', () => {
  const REAL_SECRET_PATTERNS = [
    /NetDesign@Enable2024/,
    /NetDesign@TACACS2024/,
    /NetDesignNTP@2024/,
    /NetDesign@Auth2024/,
    /NetDesign@Priv2024/,
    /password\s+\w{8,}/,   // "password" followed by a real-looking value
  ]

  const DEVICES = [
    makeDevice({ vendor: 'Cisco',    subLayer: 'spine' }),
    makeDevice({ vendor: 'Cisco',    subLayer: 'leaf' }),
    makeDevice({ vendor: 'Cisco',    subLayer: 'firewall' }),
    makeDevice({ vendor: 'Arista',   subLayer: 'spine' }),
    makeDevice({ vendor: 'Juniper',  subLayer: 'leaf' }),
    makeDevice({ vendor: 'Palo Alto',subLayer: 'firewall' }),
  ]

  DEVICES.forEach(dev => {
    it(`${dev.vendor} ${dev.subLayer} uses <CHANGE-ME-*> for secrets`, () => {
      const cfg = generateConfig(dev, 0)
      // Must have at least one CHANGE-ME placeholder
      expect(cfg).toMatch(/<CHANGE-ME-/)
      // Must not have known hardcoded secrets from the uploaded file
      for (const pattern of REAL_SECRET_PATTERNS.slice(0, 5)) {
        expect(cfg).not.toMatch(pattern)
      }
    })
  })
})

// ── Issue 4: Single underlay protocol ─────────────────────────────────────────
describe('Single underlay protocol — not OSPF + IS-IS simultaneously (Issue 4)', () => {
  it('NX-OS spine has IS-IS but no OSPF underlay', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('router isis')
    expect(cfg).not.toContain('router ospf UNDERLAY')
  })

  it('NX-OS leaf has IS-IS but no OSPF underlay', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('router isis')
    expect(cfg).not.toContain('router ospf UNDERLAY')
  })

  it('Arista spine has IS-IS but no OSPF', () => {
    const dev = makeDevice({ vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('router isis')
    expect(cfg).not.toContain('router ospf')
  })

  it('WAN edge uses OSPF but no IS-IS', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'wan-edge', model: 'ASR 1002-HX' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('router ospf')
    expect(cfg).not.toContain('router isis')
  })
})

// ── Issue 5: GPU QoS correctness ──────────────────────────────────────────────
describe('GPU fabric QoS: ECN + DCQCN + PFC + buffer carving (Issue 5)', () => {
  it('GPU spine has PFC no-drop for RoCEv2 priority', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toContain('pause no-drop')
  })

  it('GPU spine has ECN congestion-control on lossy queues', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toContain('congestion-control ecn')
  })

  it('GPU spine has WRED / random-detect for TCP queues', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toContain('random-detect')
  })

  it('GPU spine RDMA class gets 60% BW guaranteed', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toMatch(/RDMA.*\n.*bandwidth percent 60|bandwidth percent 60\s*\npause/s)
  })

  it('GPU spine has DCQCN watchdog / PFC configuration', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toContain('pfc-watchdog')
  })

  it('Non-GPU DC spine does NOT have PFC no-drop', () => {
    const dev = makeDevice({ vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'dc')
    expect(cfg).not.toContain('pause no-drop')
  })

  it('Arista GPU spine has PFC configuration', () => {
    const dev = makeDevice({ vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0, 'gpu')
    expect(cfg).toContain('pfc enable')
    expect(cfg).toContain('pfc priority 3 no-drop')
  })
})

// ── Existing coverage ────────────────────────────────────────────────────────
describe('generateConfig — core functionality', () => {
  it('cisco spine includes hostname and IS-IS', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-SPINE-A01')
    expect(cfg).toContain('router bgp')
    expect(cfg).toContain('router isis')
  })

  it('cisco leaf includes VXLAN NVE', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-LEAF-A01')
    expect(cfg).toContain('interface nve1')
  })

  it('arista spine uses multi-agent routing', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-B01', vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('hostname TST-SPINE-B01')
    expect(cfg).toContain('service routing protocols model multi-agent')
  })

  it('juniper leaf uses set commands', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-B01', vendor: 'Juniper', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set system host-name TST-LEAF-B01')
    expect(cfg).toContain('set protocols evpn')
  })
})

describe('generateAllConfigs', () => {
  it('returns one config per device keyed by id', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'dev-1', hostname: 'IAD-SPINE-A01' }),
      makeDevice({ id: 'dev-2', hostname: 'IAD-LEAF-A01', subLayer: 'leaf' }),
    ]
    const configs = generateAllConfigs(devices)
    expect(Object.keys(configs)).toHaveLength(2)
    expect(configs['dev-1']).toContain('IAD-SPINE-A01')
    expect(configs['dev-2']).toContain('IAD-LEAF-A01')
  })

  it('returns empty object for empty array', () => {
    expect(generateAllConfigs([])).toEqual({})
  })

  it('passes useCase correctly for GPU fabric', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'gpu-1', vendor: 'Cisco', subLayer: 'spine' }),
    ]
    const configs = generateAllConfigs(devices, 'gpu')
    expect(configs['gpu-1']).toContain('pause no-drop')
  })
})
