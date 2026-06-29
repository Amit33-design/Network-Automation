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

  it('juniper SPINE gets a distinct spine config (not the leaf template)', () => {
    const spine = generateConfig(makeDevice({ hostname: 'TST-SPINE-B01', vendor: 'Juniper', subLayer: 'spine' }), 0)
    // spine identity + loopback in the spine range, not leaf
    expect(spine).toContain('DC Spine')
    expect(spine).toContain('10.255.1.1/32')
    expect(spine).not.toContain('10.255.2.1/32')
    // spine is the RR (AS 65000) peering DOWN to leaves, and is NOT a VTEP
    expect(spine).toContain('set routing-options autonomous-system 65000')
    expect(spine).toContain('set protocols bgp group LEAVES')
    expect(spine).not.toContain('vtep-source-interface')
  })

  it('juniper leaf remains a VTEP with leaf loopback range', () => {
    const leaf = generateConfig(makeDevice({ hostname: 'TST-LEAF-B01', vendor: 'Juniper', subLayer: 'leaf' }), 0)
    expect(leaf).toContain('DC Leaf')
    expect(leaf).toContain('10.255.2.1/32')
    expect(leaf).toContain('vtep-source-interface lo0.0')
    expect(leaf).toContain('set protocols bgp group SPINE-RR')
  })
})

// Multisite DCI route-target parity (A7) — Juniper + Nokia leaves must emit
// the stretched 65100:<vni> RT for multisite, matching NX-OS/Arista.
describe('Multisite DCI route-targets — Juniper + Nokia', () => {
  it('Juniper leaf emits the stretched DCI RT only for multisite', () => {
    const dev = makeDevice({ vendor: 'Juniper', subLayer: 'leaf' })
    const multi = generateConfig(dev, 0, 'multisite')
    const dc = generateConfig(dev, 0, 'dc')
    expect(multi).toContain('target:65100:10010')
    expect(multi).toContain('vni-options vni 10010')
    expect(dc).not.toContain('65100')
  })

  it('Nokia leaf emits the stretched DCI RT only for multisite', () => {
    const dev = makeDevice({ vendor: 'Nokia', subLayer: 'leaf' })
    const multi = generateConfig(dev, 0, 'multisite')
    const dc = generateConfig(dev, 0, 'dc')
    expect(multi).toContain('export-rt target:65100:10010')
    expect(multi).toContain('import-rt target:65100:10010')
    expect(dc).not.toContain('65100')
  })

  it('Nokia spine does not get the leaf DCI RT', () => {
    const spine = generateConfig(makeDevice({ vendor: 'Nokia', subLayer: 'spine' }), 0, 'multisite')
    expect(spine).not.toContain('export-rt target:65100')
  })
})

// IPv6 dual-stack underlay parity (A6) — Juniper + Nokia must honor the
// 'IPv6 Dual-Stack' protoFeature, not just Cisco/Arista.
describe('IPv6 dual-stack underlay — Juniper + Nokia', () => {
  const v6 = ['IPv6 Dual-Stack']
  it('Juniper spine adds inet6 loopback + IS-IS ipv6-unicast only when selected', () => {
    const dev = makeDevice({ vendor: 'Juniper', subLayer: 'spine' })
    const on = generateConfig(dev, 0, 'dc', [], [], v6)
    const off = generateConfig(dev, 0, 'dc', [], [], [])
    expect(on).toContain('family inet6 address')
    expect(on).toContain('topologies ipv6-unicast')
    expect(off).not.toContain('family inet6')
  })

  it('Juniper leaf adds inet6 dual-stack when selected', () => {
    const on = generateConfig(makeDevice({ vendor: 'Juniper', subLayer: 'leaf' }), 0, 'dc', [], [], v6)
    expect(on).toContain('family inet6 address')
    expect(on).toContain('topologies ipv6-unicast')
  })

  it('Nokia leaf adds system0 ipv6 + IS-IS ipv6-unicast when selected', () => {
    const dev = makeDevice({ vendor: 'Nokia', subLayer: 'leaf' })
    const on = generateConfig(dev, 0, 'dc', [], [], v6)
    const off = generateConfig(dev, 0, 'dc', [], [], [])
    expect(on).toContain('ipv6-unicast {')
    expect(on).toContain('<CHANGE-ME-system0-v6>/128')
    expect(off).not.toContain('ipv6-unicast {')
  })
})

// ── Enterprise upgrade A1/A2: MLAG / vPC HA-pair pairing ──────────────────────
describe('vPC / MLAG HA-pair config (Enterprise upgrade A1/A2)', () => {
  it('NX-OS leaf pair (idx 0 & 1) share the same vPC domain', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('vpc domain 1')
    expect(cfg1).toContain('vpc domain 1')
  })

  it('NX-OS leaf next pair (idx 2 & 3) get a different vPC domain', () => {
    const dev2 = makeDevice({ hostname: 'TST-LEAF-B01', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg2 = generateConfig(dev2, 2)
    expect(cfg2).toContain('vpc domain 2')
  })

  it('NX-OS leaf peer-keepalive references the paired peer hostname', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('<CHANGE-ME-TST-LEAF-A02-mgmt-ip>')
    expect(cfg1).toContain('<CHANGE-ME-TST-LEAF-A01-mgmt-ip>')
  })

  it('NX-OS leaf pair members get distinct vPC role priorities (primary/secondary)', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('role priority 8192')
    expect(cfg1).toContain('role priority 16384')
  })

  it('Arista leaf pair share an MLAG domain-id and peer-link', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Arista', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Arista', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('mlag configuration')
    expect(cfg0).toContain('domain-id TST-LEAF-AMLAG1')
    expect(cfg1).toContain('domain-id TST-LEAF-AMLAG1')
    expect(cfg0).toContain('peer-link Port-Channel100')
    expect(cfg1).toContain('peer-link Port-Channel100')
  })

  it('Arista leaf MLAG peer-address points at the paired peer hostname', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Arista', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Arista', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    expect(cfg0).toContain('<CHANGE-ME-TST-LEAF-A02-mlag-peer-ip>')
    expect(cfg1).toContain('<CHANGE-ME-TST-LEAF-A01-mlag-peer-ip>')
  })
})

// ── Enterprise upgrade A4: Arista gNMI / eAPI streaming telemetry ─────────────
describe('Arista gNMI/eAPI telemetry block (Enterprise upgrade A4)', () => {
  it('Arista spine config enables gNMI transport', () => {
    const dev = makeDevice({ vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('management api gnmi')
    expect(cfg).toContain('transport grpc default')
  })

  it('Arista spine config enables eAPI (http-commands) over HTTPS', () => {
    const dev = makeDevice({ vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('management api http-commands')
    expect(cfg).toContain('protocol https port 443')
  })

  it('Arista spine config streams to a TerminAttr collector with placeholder IP', () => {
    const dev = makeDevice({ vendor: 'Arista', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('daemon TerminAttr')
    expect(cfg).toContain('<CHANGE-ME-telemetry-collector-ip>')
  })

  it('Arista leaf config also includes gNMI/eAPI/TerminAttr telemetry', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Arista', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('management api gnmi')
    expect(cfg).toContain('management api http-commands')
    expect(cfg).toContain('daemon TerminAttr')
  })
})

// ── Enterprise upgrade A5: topology-driven uplink/downlink interfaces ─────────
describe('CLOS fabric link plan from BOM port-math (Enterprise upgrade A5)', () => {
  it('NX-OS leaf without a full device list still generates real (non-comment) uplink interfaces', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('interface Ethernet1/43')
    expect(cfg).toContain('ip address 10.99.1.1/31')
    expect(cfg).not.toMatch(/!\s*interface Ethernet1\/43/)
  })

  it('NX-OS spine downlink and leaf uplink agree on the same /31 subnet', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'sp1', hostname: 'IAD-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 }),
      makeDevice({ id: 'sp2', hostname: 'IAD-SPINE-A02', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 }),
      makeDevice({ id: 'lf1', hostname: 'IAD-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 }),
      makeDevice({ id: 'lf2', hostname: 'IAD-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 }),
    ]
    const configs = generateAllConfigs(devices, 'dc')

    // Leaf 1's first uplink (Ethernet1/43) goes to spine 1 on 10.99.1.1/31
    expect(configs['lf1']).toContain('interface Ethernet1/43')
    expect(configs['lf1']).toContain('ip address 10.99.1.1/31')
    expect(configs['lf1']).toContain('description UPLINK: IAD-SPINE-A01')

    // Spine 1's matching downlink to leaf 1 (link 1) is 10.99.1.0/31 — same /31
    expect(configs['sp1']).toContain('ip address 10.99.1.0/31')
    expect(configs['sp1']).toContain('description DOWNLINK: IAD-LEAF-A01')
  })

  it('Arista spine downlink and leaf uplink agree on the same /31 subnet', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'sp1', hostname: 'IAD-SPINE-A01', vendor: 'Arista', subLayer: 'spine', ports: 48, uplinks: 0 }),
      makeDevice({ id: 'sp2', hostname: 'IAD-SPINE-A02', vendor: 'Arista', subLayer: 'spine', ports: 48, uplinks: 0 }),
      makeDevice({ id: 'lf1', hostname: 'IAD-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', ports: 32, uplinks: 2 }),
      makeDevice({ id: 'lf2', hostname: 'IAD-LEAF-A02', vendor: 'Arista', subLayer: 'leaf', ports: 32, uplinks: 2 }),
    ]
    const configs = generateAllConfigs(devices, 'dc')

    // Leaf 1's first uplink (Ethernet31) goes to spine 1 on 10.99.1.1/31
    expect(configs['lf1']).toContain('interface Ethernet31')
    expect(configs['lf1']).toContain('ip address 10.99.1.1/31')

    // Spine 1's matching downlink to leaf 1 is 10.99.1.0/31 — same /31
    expect(configs['sp1']).toContain('ip address 10.99.1.0/31')
    expect(configs['sp1']).toContain('description DOWNLINK: IAD-LEAF-A01')
  })

  it('leaf uplink count scales with the SKU uplinks field from buildDeviceList()', () => {
    const dev2 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 32, uplinks: 2 })
    const dev6 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 })
    const cfg2 = generateConfig(dev2, 0)
    const cfg6 = generateConfig(dev6, 0)
    const count = (cfg: string) => (cfg.match(/^interface Ethernet1\/\d+$/gm) ?? []).length
    expect(count(cfg2)).toBe(2)
    expect(count(cfg6)).toBe(6)
  })
})

// ── Enterprise upgrade A6: IPv6 dual-stack underlay ───────────────────────────
describe('IPv6 dual-stack underlay (Enterprise upgrade A6)', () => {
  const ipv6Feature = ['IPv6 Dual-Stack']

  it('is OFF by default — no IPv6 lines on NX-OS spine/leaf', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 })
    const cfg = generateConfig(dev, 0, 'dc')
    expect(cfg).not.toContain('ipv6 address')
    expect(cfg).not.toContain('address-family ipv6 unicast')
  })

  it('NX-OS spine: enables dual-stack IS-IS and IPv6 loopback', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 })
    const cfg = generateConfig(dev, 0, 'dc', [], [], ipv6Feature)
    expect(cfg).toContain('ipv6 address fd00:255:1::1/128')
    expect(cfg).toContain('ipv6 router isis 1')
    expect(cfg).toContain('address-family ipv6 unicast')
  })

  it('NX-OS leaf: enables dual-stack IS-IS and IPv6 loopback', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 })
    const cfg = generateConfig(dev, 0, 'dc', [], [], ipv6Feature)
    expect(cfg).toContain('ipv6 address fd00:255:2::1/128')
    expect(cfg).toContain('address-family ipv6 unicast')
  })

  it('NX-OS spine/leaf fabric P2P links get matching IPv6 /127 addresses', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'sp1', hostname: 'IAD-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 }),
      makeDevice({ id: 'sp2', hostname: 'IAD-SPINE-A02', vendor: 'Cisco', subLayer: 'spine', ports: 36, uplinks: 0 }),
      makeDevice({ id: 'lf1', hostname: 'IAD-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 }),
      makeDevice({ id: 'lf2', hostname: 'IAD-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 }),
    ]
    const configs = generateAllConfigs(devices, 'dc', [], [], ipv6Feature)

    expect(configs['lf1']).toContain('ipv6 address fd00:99:1::1/127')
    expect(configs['sp1']).toContain('ipv6 address fd00:99:1::0/127')
  })

  it('Arista spine/leaf: enables dual-stack IS-IS, IPv6 loopback, and matching fabric IPv6', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'sp1', hostname: 'IAD-SPINE-A01', vendor: 'Arista', subLayer: 'spine', ports: 48, uplinks: 0 }),
      makeDevice({ id: 'sp2', hostname: 'IAD-SPINE-A02', vendor: 'Arista', subLayer: 'spine', ports: 48, uplinks: 0 }),
      makeDevice({ id: 'lf1', hostname: 'IAD-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', ports: 32, uplinks: 2 }),
      makeDevice({ id: 'lf2', hostname: 'IAD-LEAF-A02', vendor: 'Arista', subLayer: 'leaf', ports: 32, uplinks: 2 }),
    ]
    const configs = generateAllConfigs(devices, 'dc', [], [], ipv6Feature)

    // lf1 is at global devices[] index 2, so its loopback router-id is
    // 10.255.2.3 / fd00:255:2::3 (router-id numbering follows global index,
    // unlike the fabric-link leafNum which follows position among leaves).
    expect(configs['sp1']).toContain('ipv6 address fd00:255:1::1/128')
    expect(configs['lf1']).toContain('ipv6 address fd00:255:2::3/128')
    expect(configs['sp1']).toContain('address-family ipv6 unicast')
    expect(configs['lf1']).toContain('ipv6 address fd00:99:1::1/127')
    expect(configs['sp1']).toContain('ipv6 address fd00:99:1::0/127')
  })
})

// ── Enterprise upgrade A7: Multisite EVPN DCI route-targets ───────────────────
describe('Multisite EVPN DCI route-targets (Enterprise upgrade A7)', () => {
  const nxosLeaf = () => makeDevice({ hostname: 'IAD-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', ports: 48, uplinks: 6 })
  const aristaLeaf = () => makeDevice({ hostname: 'IAD-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', ports: 32, uplinks: 2 })

  it('dc use case: no DCI route-targets emitted', () => {
    expect(generateConfig(nxosLeaf(), 0, 'dc')).not.toContain('65100:')
    expect(generateConfig(aristaLeaf(), 0, 'dc')).not.toContain('65100:')
  })

  it('multisite NX-OS leaf: DCI RTs on L3VNI VRF and L2VNI MAC-VRF alongside auto RTs', () => {
    const cfg = generateConfig(nxosLeaf(), 0, 'multisite')
    expect(cfg).toContain('route-target both auto evpn')
    expect(cfg).toContain('route-target import 65100:50000 evpn')
    expect(cfg).toContain('route-target export 65100:50000 evpn')
    expect(cfg).toContain('route-target import 65100:10010')
    expect(cfg).toContain('route-target export 65100:10010')
  })

  it('NX-OS leaf always has an EVPN MAC-VRF block with auto RTs and correct NVE VNI roles', () => {
    const cfg = generateConfig(nxosLeaf(), 0, 'dc')
    expect(cfg).toContain('vni 10010 l2')
    expect(cfg).toContain('route-target import auto')
    // L2VNI gets ingress-replication; L3VNI gets associate-vrf (CLAUDE.md §10)
    expect(cfg).toMatch(/member vni 10010\n\s+ingress-replication protocol bgp/)
    expect(cfg).toContain('member vni 50000 associate-vrf')
  })

  it('multisite Arista leaf: MAC-VRF with site RT plus stretched DCI RTs', () => {
    const cfg = generateConfig(aristaLeaf(), 0, 'multisite')
    expect(cfg).toContain('route-target both 65000:10010')
    expect(cfg).toContain('route-target import evpn 65100:10010')
    expect(cfg).toContain('route-target export evpn 65100:10010')
  })

  it('Arista leaf always has a MAC-VRF vlan section under router bgp', () => {
    const cfg = generateConfig(aristaLeaf(), 0, 'dc')
    expect(cfg).toContain('rd 10.255.2.1:10010')
    expect(cfg).toContain('route-target both 65000:10010')
    expect(cfg).toContain('redistribute learned')
  })
})

// ── Enterprise upgrade A3: Campus distribution/access — FHRP, STP, IGMP ───────
describe('Campus distribution/access config (Enterprise upgrade A3)', () => {
  it('Cisco campus distribution uses OSPF, not IS-IS', () => {
    const dev = makeDevice({ hostname: 'TST-DIST-A01', vendor: 'Cisco', subLayer: 'distribution' })
    const cfg = generateConfig(dev, 0, 'campus')
    expect(cfg).toContain('router ospf')
    expect(cfg).not.toContain('router isis')
  })

  it('Cisco campus distribution primary (idx 0) is STP root with HSRP active priority', () => {
    const dev = makeDevice({ hostname: 'TST-DIST-A01', vendor: 'Cisco', subLayer: 'distribution' })
    const cfg = generateConfig(dev, 0, 'campus')
    expect(cfg).toContain('spanning-tree vlan 1-4094 priority 4096')
    expect(cfg).toContain('standby 10 priority 110')
  })

  it('Cisco campus distribution secondary (idx 1) is STP secondary-root with HSRP standby priority', () => {
    const dev = makeDevice({ hostname: 'TST-DIST-A02', vendor: 'Cisco', subLayer: 'distribution' })
    const cfg = generateConfig(dev, 1, 'campus')
    expect(cfg).toContain('spanning-tree vlan 1-4094 priority 8192')
    expect(cfg).toContain('standby 10 priority 90')
  })

  it('Cisco campus access switch is never STP root and has PortFast/BPDU Guard', () => {
    const dev = makeDevice({ hostname: 'TST-ACC-A01', vendor: 'Cisco', subLayer: 'access', ports: 48 })
    const cfg = generateConfig(dev, 0, 'campus')
    expect(cfg).toContain('spanning-tree vlan 1-4094 priority 32768')
    expect(cfg).toContain('spanning-tree portfast')
    expect(cfg).toContain('spanning-tree bpduguard enable')
  })

  it('Cisco campus access uplinks form a port-channel shared with the HA-paired switch', () => {
    const dev0 = makeDevice({ hostname: 'TST-ACC-A01', vendor: 'Cisco', subLayer: 'access', ports: 48 })
    const dev1 = makeDevice({ hostname: 'TST-ACC-A02', vendor: 'Cisco', subLayer: 'access', ports: 48 })
    const cfg0 = generateConfig(dev0, 0, 'campus')
    const cfg1 = generateConfig(dev1, 1, 'campus')
    expect(cfg0).toContain('interface Port-channel1')
    expect(cfg1).toContain('interface Port-channel1')
  })

  it('IGMP snooping/querier added on distribution only when voice app type present', () => {
    const dev = makeDevice({ hostname: 'TST-DIST-A01', vendor: 'Cisco', subLayer: 'distribution' })
    const cfgNoVoice = generateConfig(dev, 0, 'campus', [])
    const cfgVoice = generateConfig(dev, 0, 'campus', ['voice'])
    expect(cfgNoVoice).not.toContain('ip igmp snooping')
    expect(cfgVoice).toContain('ip igmp snooping querier')
    expect(cfgVoice).toContain('vlan 20')
  })

  it('Cisco campus access has exactly one aaa new-model (no duplicate mgmt blocks)', () => {
    const dev = makeDevice({ hostname: 'TST-ACC-A01', vendor: 'Cisco', subLayer: 'access', ports: 48 })
    const cfg = generateConfig(dev, 0, 'campus')
    const matches = (cfg.match(/aaa new-model/g) ?? []).length
    expect(matches).toBe(1)
  })

  it('generateAllConfigs threads appTypes through to campus distribution IGMP querier', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'dist-1', hostname: 'TST-DIST-A01', vendor: 'Cisco', subLayer: 'distribution' }),
    ]
    const configs = generateAllConfigs(devices, 'campus', [], ['voice', 'video'])
    expect(configs['dist-1']).toContain('ip igmp snooping querier')
  })
})

// ── Gap G-A9: IOS-XR SP/WAN PE support (SR-MPLS + L3VPN) ──────────────────────
describe('Cisco IOS-XR SP/WAN PE config (Gap G-A9)', () => {
  const xrDevice = (overrides: Partial<BOMDevice> = {}) =>
    makeDevice({
      hostname: 'IAD-PE-A01',
      vendor: 'Cisco',
      subLayer: 'wan-edge',
      model: 'ASR 9904',
      features: ['IOS-XR', 'BGP', 'MPLS', 'SR-MPLS', 'L3VPN', 'IS-IS'],
      ...overrides,
    })

  it('ASR 9000 wan-edge dispatches to the IOS-XR generator (not IOS-XE)', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('OS     : Cisco IOS-XR')
    expect(cfg).toContain('hostname IAD-PE-A01')
    // IOS-XR interface naming, not IOS-XE GigabitEthernet0/0/0
    expect(cfg).toContain('GigabitEthernet0/0/0/0')
    expect(cfg).toContain('interface Loopback0')
  })

  it('NCS and explicit IOS-XR feature also select IOS-XR; ASR 1002-HX stays IOS-XE', () => {
    const ncs = generateConfig(xrDevice({ model: 'NCS 540', features: ['BGP'] }), 0, 'wan')
    expect(ncs).toContain('OS     : Cisco IOS-XR')

    const featOnly = generateConfig(
      xrDevice({ model: 'Mystery-Router', features: ['IOS-XR'] }), 0, 'wan')
    expect(featOnly).toContain('OS     : Cisco IOS-XR')

    // ASR 1002-HX is IOS-XE — must NOT route to IOS-XR
    const iosxe = generateConfig(
      makeDevice({ vendor: 'Cisco', subLayer: 'wan-edge', model: 'ASR 1002-HX',
        features: ['BGP', 'MPLS', 'OSPF'] }), 0, 'wan')
    expect(iosxe).toContain('OS     : Cisco IOS-XE')
    expect(iosxe).not.toContain('Cisco IOS-XR')
  })

  it('emits L3VPN VPNv4 BGP overlay with route-targets and a VRF', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('router bgp 65000')
    expect(cfg).toContain('address-family vpnv4 unicast')
    expect(cfg).toContain('vrf CUST-A')
    expect(cfg).toContain('import route-target')
    expect(cfg).toContain('export route-target')
    expect(cfg).toContain('rd 65000:100')
  })

  it('emits SR-MPLS underlay with prefix-SID on Loopback0', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('segment-routing')
    expect(cfg).toContain('segment-routing mpls')
    expect(cfg).toContain('prefix-sid index')
    expect(cfg).toContain('global-block 16000 23999')
  })

  it('uses route-policy (IOS-XR), not route-map (IOS-XE)', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('route-policy PASS-ALL')
    expect(cfg).toContain('end-policy')
    expect(cfg).not.toContain('route-map ')
  })

  it('uses a single IGP — IS-IS, never OSPF as well', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('router isis CORE')
    expect(cfg).not.toContain('router ospf')
  })

  it('uses <CHANGE-ME-*> placeholders and no plaintext secrets', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toMatch(/<CHANGE-ME-/)
    expect(cfg).not.toMatch(/password\s+\w{8,}/)
    expect(cfg).toContain('<CHANGE-ME-admin-password>')
    expect(cfg).toContain('<CHANGE-ME-tacacs-key>')
  })

  it('IOS-XR config is internally consistent (no duplicate hostname/bgp blocks)', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect((cfg.match(/^hostname /gm) ?? []).length).toBe(1)
    expect((cfg.match(/^router bgp /gm) ?? []).length).toBe(1)
    expect((cfg.match(/^router isis /gm) ?? []).length).toBe(1)
  })

  it('per-device prefix-sid index follows the device index', () => {
    const cfg0 = generateConfig(xrDevice({ hostname: 'IAD-PE-A01' }), 0, 'wan')
    const cfg1 = generateConfig(xrDevice({ hostname: 'IAD-PE-A02' }), 1, 'wan')
    expect(cfg0).toContain('prefix-sid index 1')
    expect(cfg1).toContain('prefix-sid index 2')
    expect(cfg0).toContain('ipv4 address 10.255.10.1 255.255.255.255')
    expect(cfg1).toContain('ipv4 address 10.255.10.2 255.255.255.255')
  })

  it('streams model-driven telemetry to a placeholder collector', () => {
    const cfg = generateConfig(xrDevice(), 0, 'wan')
    expect(cfg).toContain('telemetry model-driven')
    expect(cfg).toContain('<CHANGE-ME-telemetry-collector-ip>')
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

// ── Vendor config expansion tests ──────────────────────────────────────

describe('Nokia SR Linux config', () => {
  it('spine generates YANG-style config with system + ISIS + BGP', () => {
    const dev = makeDevice({ hostname: 'DC-SPINE-A01', vendor: 'Nokia', subLayer: 'spine', model: 'Nokia 7250 IXR-10' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('system')
    expect(cfg).toContain('isis')
    expect(cfg).toContain('bgp')
    expect(cfg).not.toContain('aaa new-model')
  })

  it('leaf generates YANG-style config with mac-vrf + vxlan', () => {
    const dev = makeDevice({ hostname: 'DC-LEAF-A01', vendor: 'Nokia', subLayer: 'leaf', model: 'Nokia 7220 D3' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('system')
    expect(cfg).toContain('mac-vrf')
    expect(cfg).toContain('vxlan-interface')
    expect(cfg).not.toContain('aaa new-model')
  })

  it('uses CHANGE-ME placeholders for credentials', () => {
    const dev = makeDevice({ hostname: 'DC-SPINE-A01', vendor: 'Nokia', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('CHANGE-ME')
    expect(cfg).not.toMatch(/password\s+[a-zA-Z0-9]{4,}(?!.*CHANGE-ME)/)
  })
})

describe('Juniper campus config (EX distribution/access)', () => {
  it('distribution generates Junos set commands with VRRP + OSPF', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-DIST-A01', vendor: 'Juniper', subLayer: 'distribution', model: 'Juniper EX4650' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set')
    expect(cfg).toContain('vrrp')
    expect(cfg).toContain('ospf')
    expect(cfg).not.toContain('feature bgp')
  })

  it('access generates Junos set commands with RSTP', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-ACC-A01', vendor: 'Juniper', subLayer: 'access', model: 'Juniper EX4400' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set')
    expect(cfg).toContain('rstp')
    expect(cfg).not.toContain('feature bgp')
  })

  it('uses CHANGE-ME placeholders', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-DIST-A01', vendor: 'Juniper', subLayer: 'distribution' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('CHANGE-ME')
  })
})

describe('Juniper SRX firewall config', () => {
  it('generates Junos set commands with security zones', () => {
    const dev = makeDevice({ hostname: 'FW-A01', vendor: 'Juniper', subLayer: 'firewall', model: 'Juniper SRX1500' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set security zones')
    expect(cfg).toContain('TRUST')
    expect(cfg).toContain('UNTRUST')
    expect(cfg).not.toContain('zone security')
  })

  it('has security policies', () => {
    const dev = makeDevice({ hostname: 'FW-A01', vendor: 'Juniper', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('security policies')
  })

  it('uses CHANGE-ME placeholders', () => {
    const dev = makeDevice({ hostname: 'FW-A01', vendor: 'Juniper', subLayer: 'firewall' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('CHANGE-ME')
  })
})

describe('Juniper WAN config (MX router)', () => {
  it('generates Junos set commands with OSPF + BGP', () => {
    const dev = makeDevice({ hostname: 'WAN-EDGE-A01', vendor: 'Juniper', subLayer: 'wan-edge', model: 'Juniper MX204' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('set')
    expect(cfg).toContain('ospf')
    expect(cfg).toContain('bgp')
    expect(cfg).not.toContain('router ospf')
  })

  it('has MPLS / LDP config', () => {
    const dev = makeDevice({ hostname: 'WAN-EDGE-A01', vendor: 'Juniper', subLayer: 'wan-edge' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('mpls')
    expect(cfg).toContain('ldp')
  })

  it('uses CHANGE-ME placeholders', () => {
    const dev = makeDevice({ hostname: 'WAN-EDGE-A01', vendor: 'Juniper', subLayer: 'wan-edge' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('CHANGE-ME')
  })
})

describe('Arista campus config (EOS distribution/access)', () => {
  it('distribution generates EOS config with OSPF + virtual-router', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-DIST-A01', vendor: 'Arista', subLayer: 'distribution', model: 'Arista 750' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('router ospf')
    expect(cfg).toContain('ip virtual-router')
    expect(cfg).toContain('!')
    expect(cfg).not.toContain('feature bgp')
  })

  it('access generates EOS switchport config with RSTP', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-ACC-A01', vendor: 'Arista', subLayer: 'access', model: 'Arista 720XP' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('switchport')
    expect(cfg).toContain('spanning-tree')
    expect(cfg).toContain('!')
  })

  it('uses CHANGE-ME placeholders', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-DIST-A01', vendor: 'Arista', subLayer: 'distribution' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('CHANGE-ME')
  })
})

describe('Fortinet FortiSwitch campus config', () => {
  it('distribution generates FortiSwitchOS config with VRRP + OSPF', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-DIST-A01', vendor: 'Fortinet', subLayer: 'distribution', model: 'FortiSwitch T1024E' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('config system global')
    expect(cfg).toContain('config vrrp')
    expect(cfg).toContain('config router ospf')
    expect(cfg).toContain('config switch vlan')
    // distribution is STP root-ish (low priority)
    expect(cfg).toContain('set priority 4096')
  })

  it('access generates L2 FortiSwitchOS config with PoE + 802.1X', () => {
    const dev = makeDevice({ hostname: 'CAMPUS-ACC-A01', vendor: 'Fortinet', subLayer: 'access', model: 'FortiSwitch 148F-POE' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('config switch interface')
    expect(cfg).toContain('set poe-status enable')
    expect(cfg).toContain('set security-mode 802.1X')
    expect(cfg).toContain('set stp-bpdu-guard enabled')
    // access does NOT run OSPF
    expect(cfg).not.toContain('config router ospf')
  })

  it('does NOT fall through to the genericConfig stub', () => {
    const dist = generateConfig(makeDevice({ vendor: 'Fortinet', subLayer: 'distribution', model: 'FortiSwitch T1024E' }), 0)
    const acc = generateConfig(makeDevice({ vendor: 'Fortinet', subLayer: 'access', model: 'FortiSwitch 148F-POE' }), 1)
    expect(dist).not.toContain('TODO: Add')
    expect(acc).not.toContain('TODO: Add')
  })

  it('adds voice VLAN only when voice app type is selected', () => {
    const withVoice = generateConfig(makeDevice({ vendor: 'Fortinet', subLayer: 'access' }), 0, 'campus', ['voice'])
    const without = generateConfig(makeDevice({ vendor: 'Fortinet', subLayer: 'access' }), 0, 'campus', [])
    expect(withVoice).toContain('set voice-vlan 20')
    expect(without).not.toContain('set voice-vlan 20')
  })

  it('uses CHANGE-ME placeholders, no hardcoded secrets', () => {
    const cfg = generateConfig(makeDevice({ vendor: 'Fortinet', subLayer: 'distribution' }), 0)
    expect(cfg).toContain('<CHANGE-ME-admin-password>')
    expect(cfg).toContain('<CHANGE-ME-snmp-auth-pass>')
  })
})
