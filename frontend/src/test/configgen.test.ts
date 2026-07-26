import { describe, it, expect } from 'vitest'
import { generateConfig, generateAllConfigs, isFtdModel } from '@/lib/configgen'
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
  it('NX-OS spine uses NX-OS AAA, not the IOS-only aaa new-model', () => {
    const dev = makeDevice({ hostname: 'TST-SPINE-A01', vendor: 'Cisco', subLayer: 'spine' })
    const cfg = generateConfig(dev, 0)
    // NX-OS has no `aaa new-model` (AAA is always on) and no IOS `privilege` keyword.
    expect(cfg).not.toMatch(/aaa new-model/)
    expect(cfg).not.toMatch(/username .* privilege \d+/)
    expect(cfg).toMatch(/feature tacacs\+/)
    expect(cfg).toMatch(/aaa authentication login default/)
  })

  it('NX-OS leaf uses NX-OS AAA, not the IOS-only aaa new-model', () => {
    const dev = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).not.toMatch(/aaa new-model/)
    expect(cfg).not.toMatch(/username .* privilege \d+/)
    expect(cfg).toMatch(/feature tacacs\+/)
    expect(cfg).toMatch(/aaa authentication login default/)
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

// GPU RoCEv2 lossless parity (V-09) — Juniper GPU leaf/spine must emit
// PFC + ECN + RDMA, not just Cisco/Arista/Dell/NVIDIA.
describe('Juniper GPU RoCEv2 lossless fabric', () => {
  it('Juniper leaf in a GPU fabric emits PFC + ECN + RDMA', () => {
    const leaf = generateConfig(makeDevice({ vendor: 'Juniper', subLayer: 'leaf' }), 0, 'gpu')
    expect(leaf).toMatch(/pfc/i)
    expect(leaf).toMatch(/explicit-congestion-notification/i)
    expect(leaf).toContain('class RDMA')
    expect(leaf).toContain('no-loss')
  })

  it('Juniper spine in a GPU fabric emits the lossless block', () => {
    const spine = generateConfig(makeDevice({ vendor: 'Juniper', subLayer: 'spine' }), 0, 'gpu')
    expect(spine).toMatch(/pfc/i)
    expect(spine).toContain('RDMA-PFC')
  })

  it('Juniper DC (non-GPU) leaf does NOT emit the lossless block', () => {
    const leaf = generateConfig(makeDevice({ vendor: 'Juniper', subLayer: 'leaf' }), 0, 'dc')
    expect(leaf).not.toContain('RDMA-PFC')
  })
})

// Storage lossless (NVMe-oF/iSCSI) appType parity — Juniper + Nokia DC leaves
// must emit a PFC priority-6 no-drop storage class when the storage app type
// is set, matching nxosStorageBlock/aristaStorageBlock.
describe('Storage lossless appType — Juniper + Nokia', () => {
  it('Juniper leaf emits a storage class only when storage app type is set', () => {
    const dev = makeDevice({ vendor: 'Juniper', subLayer: 'leaf' })
    const withStorage = generateConfig(dev, 0, 'dc', ['storage'])
    const without = generateConfig(dev, 0, 'dc', [])
    expect(withStorage).toContain('STORAGE-PFC')
    expect(withStorage).toContain('class STORAGE')
    expect(without).not.toContain('STORAGE-PFC')
  })

  it('Juniper GPU leaf does not double-define STORAGE (RoCE block already has it)', () => {
    const cfg = generateConfig(makeDevice({ vendor: 'Juniper', subLayer: 'leaf' }), 0, 'gpu', ['storage'])
    // exactly one STORAGE forwarding-class definition
    const count = (cfg.match(/forwarding-classes class STORAGE/g) ?? []).length
    expect(count).toBe(1)
  })

  it('Nokia leaf emits storage PFC only when storage app type is set', () => {
    const dev = makeDevice({ vendor: 'Nokia', subLayer: 'leaf' })
    const withStorage = generateConfig(dev, 0, 'dc', ['storage'])
    const without = generateConfig(dev, 0, 'dc', [])
    expect(withStorage).toContain('forwarding-class storage')
    expect(withStorage).toMatch(/pfc/i)
    expect(without).not.toContain('forwarding-class storage')
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

  it('Arista leaf MLAG peer-addresses are deterministic /31 mirrors (X7)', () => {
    const dev0 = makeDevice({ hostname: 'TST-LEAF-A01', vendor: 'Arista', subLayer: 'leaf' })
    const dev1 = makeDevice({ hostname: 'TST-LEAF-A02', vendor: 'Arista', subLayer: 'leaf' })
    const cfg0 = generateConfig(dev0, 0)
    const cfg1 = generateConfig(dev1, 1)
    // primary owns .0, secondary .1; each points at the other — no placeholders
    expect(cfg0).toContain('ip address 10.253.1.0/31')
    expect(cfg0).toContain('peer-address 10.253.1.1')
    expect(cfg1).toContain('ip address 10.253.1.1/31')
    expect(cfg1).toContain('peer-address 10.253.1.0')
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
    // Count fabric UPLINK interfaces only (X7 also emits 2 vPC peer-link members)
    const count = (cfg: string) => (cfg.match(/description UPLINK:/g) ?? []).length
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

  it('multisite NX-OS leaf: DCI RTs on L3VNI VRF and L2VNI MAC-VRF alongside site RTs', () => {
    const cfg = generateConfig(nxosLeaf(), 0, 'multisite')
    // Explicit fabric-wide site RTs (Y1: auto-RT derives ASN:VNI, which never
    // matches across unique per-leaf eBGP ASNs)
    expect(cfg).toContain('route-target import 65000:50000 evpn')
    expect(cfg).toContain('route-target export 65000:50000 evpn')
    expect(cfg).toContain('route-target import 65100:50000 evpn')
    expect(cfg).toContain('route-target export 65100:50000 evpn')
    expect(cfg).toContain('route-target import 65100:10010')
    expect(cfg).toContain('route-target export 65100:10010')
  })

  it('NX-OS leaf always has an EVPN MAC-VRF block with fabric-wide RTs and correct NVE VNI roles', () => {
    const cfg = generateConfig(nxosLeaf(), 0, 'dc')
    expect(cfg).toContain('vni 10010 l2')
    expect(cfg).toContain('route-target import 65000:10010')
    expect(cfg).not.toContain('route-target import auto')
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

  it('Cisco campus access uses SPLIT uplinks (Y3/C-3 — a cross-chassis LACP MEC to two standalone dist chassis would suspend a member)', () => {
    const dev0 = makeDevice({ hostname: 'TST-ACC-A01', vendor: 'Cisco', subLayer: 'access', ports: 48 })
    const cfg0 = generateConfig(dev0, 0, 'campus')
    expect(cfg0).toContain('description UPLINK-1 to distribution A01')
    expect(cfg0).toContain('description UPLINK-2 to distribution A02')
    // no cross-chassis port-channel on the access uplinks
    expect(cfg0).not.toContain('UPLINK-TO-DISTRIBUTION-PAIR (MEC)')
    expect(cfg0).not.toMatch(/UPLINK[\s\S]{0,120}channel-group/)
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

// ── X1: NX-OS eBGP EVPN fabric is actually wired (production-grade) ──────────────

describe('NX-OS eBGP EVPN fabric wiring (group X)', () => {
  function fabric() {
    // 2 spines + 2 leaves in one BOM so generators can derive real peer IPs.
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', role: 'spine' }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor: 'Cisco', subLayer: 'spine', role: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf' }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf' }),
    ]
    return { devices, configs: generateAllConfigs(devices, 'dc') }
  }

  it('spine emits a REAL eBGP neighbor per leaf with the leaf ASN (no placeholders, no RR-client)', () => {
    const { configs } = fabric()
    const spine = configs['s1']
    // leaves are at global index 2,3 → lo0 10.255.2.3 / .4, ASN 65003 / 65004
    expect(spine).toMatch(/neighbor 10\.255\.2\.3\n\s+inherit peer LEAF-PEER\n\s+remote-as 65003/)
    expect(spine).toMatch(/neighbor 10\.255\.2\.4\n\s+inherit peer LEAF-PEER\n\s+remote-as 65004/)
    expect(spine).not.toMatch(/route-reflector-client/)   // eBGP, not iBGP-RR
    expect(spine).not.toMatch(/inherit peer LEAF-RR-CLIENT/)
    expect(spine).not.toMatch(/! neighbor .* inherit/)     // no commented stub peers
  })

  it('leaf emits a REAL eBGP neighbor per spine (no <CHANGE-ME> peer placeholders)', () => {
    const { configs } = fabric()
    const leaf = configs['l1']
    expect(leaf).toMatch(/neighbor 10\.255\.1\.1\n\s+inherit peer SPINE-PEER/)
    expect(leaf).toMatch(/neighbor 10\.255\.1\.2\n\s+inherit peer SPINE-PEER/)
    expect(leaf).not.toMatch(/CHANGE-ME-spine\d?-lo/)      // deterministic peer, must be filled
    expect(leaf).toMatch(/template peer SPINE-PEER\n\s+remote-as 65000/)  // spines share ASN 65000
  })

  it('leaf has a working anycast default gateway (distributed IRB)', () => {
    const { configs } = fabric()
    const leaf = configs['l1']
    expect(leaf).toMatch(/fabric forwarding anycast-gateway-mac/)
    expect(leaf).toMatch(/interface Vlan10[\s\S]*fabric forwarding mode anycast-gateway/)
  })

  it('spine and leaf ASNs are coherent for eBGP (spine 65000, leaves 65000+idx, all distinct)', () => {
    const { configs } = fabric()
    expect(configs['s1']).toMatch(/router bgp 65000/)
    expect(configs['l1']).toMatch(/router bgp 65003/)  // global idx 2
    expect(configs['l2']).toMatch(/router bgp 65004/)  // global idx 3
  })
})

// ── X3: Arista EOS eBGP EVPN fabric is deployable ───────────────────────────────

describe('Arista EOS eBGP EVPN fabric wiring (group X3)', () => {
  function fabric() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Arista', subLayer: 'spine', role: 'spine' }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor: 'Arista', subLayer: 'spine', role: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf' }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Arista', subLayer: 'leaf', role: 'leaf' }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('IS-IS NET is a valid 12-hex system-id (3×4 groups) on spine and leaf', () => {
    const c = fabric()
    const netRe = /net 49\.0001\.[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\.00\b/
    expect(c['s1']).toMatch(netRe)
    expect(c['l1']).toMatch(netRe)
    // and NOT the old 13/14-digit overflow
    expect(c['l1']).not.toMatch(/net 49\.0001\.\d{4}\.\d{4}\.\d{5,}/)
  })

  it('spine emits real eBGP leaf peers (flat EOS syntax, pair-based remote-as, no RR-client)', () => {
    const c = fabric()
    const spine = c['s1']
    expect(spine).toMatch(/neighbor 10\.255\.2\.3 peer group LEAF-PEER/)
    // leaves at global idx 2,3 are ONE MLAG pair (pairId 2) → shared ASN 65002 (Y4)
    expect(spine).toMatch(/neighbor 10\.255\.2\.3 remote-as 65002/)
    expect(spine).toMatch(/neighbor 10\.255\.2\.4 remote-as 65002/)
    // eBGP: no reflector-client in actual config lines (comments allowed)
    expect(spine.split('\n').filter(l => !l.trim().startsWith('!')).join('\n')).not.toMatch(/route-reflector-client/)
    expect(spine).not.toMatch(/peer-group LEAF-RR-CLIENTS/)   // no invalid indented block
  })

  it('leaf emits real spine peers + creates the referenced global vlan 10', () => {
    const c = fabric()
    const leaf = c['l1']
    expect(leaf).toMatch(/neighbor 10\.255\.1\.1 peer group SPINE-PEER/)
    expect(leaf).toMatch(/neighbor 10\.255\.1\.2 peer group SPINE-PEER/)
    expect(leaf).not.toMatch(/CHANGE-ME-spine\d?-lo/)
    expect(leaf).toMatch(/^vlan 10\n\s+name SERVERS/m)          // global VLAN, not just the MAC-VRF
    expect(leaf).toMatch(/neighbor SPINE-PEER remote-as 65000/)
  })
})

// ── X4: Juniper JunOS eBGP EVPN fabric is deployable ────────────────────────────

describe('Juniper JunOS eBGP EVPN fabric wiring (group X4)', () => {
  function fabric() {
    // QFX5120-48Y-like leaves: 48 access ports → uplinks at et-0/0/48+ (0-based)
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Juniper', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor: 'Juniper', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Juniper', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Juniper', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('IS-IS has a family iso NET on lo0 and on every transit interface', () => {
    const c = fabric()
    expect(c['s1']).toMatch(/set interfaces lo0 unit 0 family iso address 49\.0001\.[0-9a-f.]+\.00/)
    expect(c['s1']).toMatch(/set interfaces et-0\/0\/0 unit 0 family iso/)
    expect(c['l1']).toMatch(/set interfaces lo0 unit 0 family iso address 49\.0001\.[0-9a-f.]+\.00/)
    expect(c['l1']).toMatch(/set interfaces et-0\/0\/48 unit 0 family iso/)
  })

  it('eBGP over loopback has local-address + multihop and real neighbors (no placeholders)', () => {
    const c = fabric()
    const spine = c['s1']; const leaf = c['l1']
    expect(spine).toMatch(/group LEAVES local-address lo0\.0/)
    expect(spine).toMatch(/group LEAVES multihop/)
    expect(spine).toMatch(/group LEAVES neighbor 10\.255\.2\.3 peer-as 65003/)
    expect(spine).toMatch(/group LEAVES neighbor 10\.255\.2\.4 peer-as 65004/)
    expect(leaf).toMatch(/group SPINE-RR local-address lo0\.0/)
    expect(leaf).toMatch(/group SPINE-RR multihop/)
    expect(leaf).toMatch(/group SPINE-RR neighbor 10\.255\.1\.1 peer-as 65000/)
    expect(leaf).not.toMatch(/CHANGE-ME-spine\d?-lo0/)
    expect(leaf).not.toMatch(/CHANGE-ME-leaf\d?-lo0/)
  })

  it('leaf defines vlans + VNI map, a route-distinguisher, and jumbo MTU on the real uplinks', () => {
    const c = fabric()
    const leaf = c['l1']
    expect(leaf).toMatch(/set vlans V10 vlan-id 10/)
    expect(leaf).toMatch(/set vlans V10 vxlan vni 10010/)
    expect(leaf).toMatch(/set switch-options route-distinguisher 10\.255\.2\.3:1/)
    expect(leaf).toMatch(/set interfaces et-0\/0\/48 mtu 9216/)
    expect(leaf).not.toMatch(/set interfaces et-0\/0\/0 mtu 9216/)   // MTU no longer on the wrong ports
  })

  it('uses # comments (no bare ! lines, which are invalid Junos)', () => {
    const c = fabric()
    expect(c['s1'].split('\n').some(l => l === '!')).toBe(false)
    expect(c['l1'].split('\n').some(l => l === '!')).toBe(false)
  })
})

// ── X6: firewall platform correctness (FTD ≠ IOS-XE) ────────────────────────────

describe('Cisco firewall platform dispatch (group X6)', () => {
  it('Firepower/FTD hardware gets an FTD bootstrap + FMC manifest, not IOS-XE ZBF', () => {
    const dev = makeDevice({ hostname: 'IAD-FW-A01', vendor: 'Cisco', subLayer: 'firewall', model: 'Firepower 4145 NGFW' })
    const cfg = generateConfig(dev, 0)
    // Real FTD CLI bootstrap
    expect(cfg).toContain('configure network hostname IAD-FW-A01')
    expect(cfg).toContain('configure manager add <CHANGE-ME-fmc-ip>')
    expect(cfg).toContain('FMC POLICY MANIFEST')
    // The wrong-OS constructs must be gone: FTD accepts none of these
    expect(cfg).not.toMatch(/zone security/)
    expect(cfg).not.toMatch(/policy-map type inspect/)
    expect(cfg).not.toMatch(/aaa new-model/)
    expect(cfg).not.toMatch(/ip nat inside/)
  })

  it('router-class Cisco firewalls (non-FTD models) still get IOS-XE ZBF', () => {
    const dev = makeDevice({ hostname: 'IAD-FW-A01', vendor: 'Cisco', subLayer: 'firewall', model: 'ISR 4461 Security' })
    const cfg = generateConfig(dev, 0)
    expect(cfg).toContain('zone security OUTSIDE')
    expect(cfg).toContain('policy-map type inspect')
  })

  it('isFtdModel matches Firepower/FTD/FPR naming and rejects routers/switches', () => {
    for (const m of ['Firepower 4145 NGFW', 'FTD 1150', 'FPR-2130', 'Secure Firewall FTD 3105']) {
      expect(isFtdModel(m), m).toBe(true)
    }
    for (const m of ['ISR 4461', 'Catalyst 8300', 'Nexus 9336C-FX2', 'ASR 1002-HX']) {
      expect(isFtdModel(m), m).toBe(false)
    }
  })
})

// ── X7: vPC / MLAG data-plane completeness ──────────────────────────────────────

describe('vPC / MLAG peer-link data plane (group X7)', () => {
  it('NX-OS leaf emits a REAL vPC peer-link (port-channel + members), not comments', () => {
    const dev = makeDevice({ hostname: 'DC-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 4 })
    const cfg = generateConfig(dev, 0, 'dc')
    expect(cfg).toMatch(/^interface port-channel1$/m)          // real, not "! interface"
    expect(cfg).toMatch(/vpc peer-link/)
    expect(cfg).not.toMatch(/^! interface port-channel/m)
    // members just below the 4 uplinks on a 48-port leaf: Eth1/43-44
    expect(cfg).toMatch(/interface Ethernet1\/43[\s\S]*?channel-group 1 mode active/)
    expect(cfg).toMatch(/interface Ethernet1\/44[\s\S]*?channel-group 1 mode active/)
  })

  it('NX-OS vPC pair shares an anycast VTEP VIP (loopback1 secondary, advertised in BGP)', () => {
    const d1 = makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf' })
    const d2 = makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf' })
    const c1 = generateConfig(d1, 0, 'dc'); const c2 = generateConfig(d2, 1, 'dc')
    // both members of pair 1 carry the same secondary VIP
    expect(c1).toMatch(/ip address 10\.254\.1\.1\/32 secondary/)
    expect(c2).toMatch(/ip address 10\.254\.1\.1\/32 secondary/)
    expect(c1).toMatch(/network 10\.254\.1\.1\/32/)
    // primary VTEP IPs stay unique
    expect(c1).toMatch(/ip address 10\.254\.0\.1\/32\n/)
    expect(c2).toMatch(/ip address 10\.254\.0\.2\/32\n/)
  })

  it('Arista MLAG pair: real peer-link members, deterministic /31 peering, SHARED anycast VTEP', () => {
    const d1 = makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf', ports: 32, uplinks: 8 })
    const d2 = makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Arista', subLayer: 'leaf', role: 'leaf', ports: 32, uplinks: 8 })
    const c1 = generateConfig(d1, 0, 'dc'); const c2 = generateConfig(d2, 1, 'dc')
    // no placeholder or commented member stubs
    expect(c1).not.toMatch(/CHANGE-ME-.*mlag-peer-ip/)
    expect(c1).not.toMatch(/^! interface EthernetN-M/m)
    // deterministic /31: primary .0 peers .1, secondary mirrors it
    expect(c1).toMatch(/ip address 10\.253\.1\.0\/31/)
    expect(c1).toMatch(/peer-address 10\.253\.1\.1/)
    expect(c2).toMatch(/ip address 10\.253\.1\.1\/31/)
    expect(c2).toMatch(/peer-address 10\.253\.1\.0/)
    // real members just below the 8 uplinks on a 32-port leaf: Ethernet23-24
    expect(c1).toMatch(/interface Ethernet23[\s\S]*?channel-group 100 mode active/)
    expect(c1).toMatch(/interface Ethernet24[\s\S]*?channel-group 100 mode active/)
    // SHARED anycast VTEP: both members use the same Loopback1 IP (audit A-M4)
    expect(c1).toMatch(/interface Loopback1[\s\S]*?ip address 10\.254\.0\.1\/32/)
    expect(c2).toMatch(/interface Loopback1[\s\S]*?ip address 10\.254\.0\.1\/32/)
  })
})

// ── Y1: overlay-establishment parity (2nd-pass audit) ───────────────────────────

describe('eBGP overlay establishment parity (group Y1)', () => {
  function nxFabric() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', role: 'spine' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf' }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('NX-OS: ebgp-multihop on both peer templates (loopback eBGP never established without it)', () => {
    const c = nxFabric()
    expect(c['s1']).toMatch(/template peer LEAF-PEER[\s\S]*?ebgp-multihop 2/)
    expect(c['l1']).toMatch(/template peer SPINE-PEER[\s\S]*?ebgp-multihop 2/)
  })

  it('NX-OS spine preserves the EVPN next-hop (NH-UNCHANGED out) — spine is not a VTEP', () => {
    const c = nxFabric()
    expect(c['s1']).toMatch(/address-family l2vpn evpn\n\s+send-community both\n\s+route-map NH-UNCHANGED out/)
    expect(c['s1']).toMatch(/route-map NH-UNCHANGED permit 10\n\s+set ip next-hop unchanged/)
  })

  it('NX-OS: eBGP ECMP (maximum-paths 64 + as-path multipath-relax), not ibgp-only', () => {
    const c = nxFabric()
    for (const cfg of [c['s1'], c['l1']]) {
      expect(cfg).toMatch(/maximum-paths 64/)
      expect(cfg).not.toMatch(/maximum-paths ibgp/)
      expect(cfg).toMatch(/bestpath as-path multipath-relax/)
    }
  })

  it('NX-OS: LOOPBACKS prefix-list covers the VTEP range 10.254/16', () => {
    const c = nxFabric()
    expect(c['s1']).toMatch(/ip prefix-list LOOPBACKS seq 10 permit 10\.254\.0\.0\/16 ge 32/)
  })

  it('Arista: ip routing enabled (EOS is L2-only by default) + MGMT VRF actually exists', () => {
    const spine = generateConfig(makeDevice({ hostname: 'DC-SPINE-A01', vendor: 'Arista', subLayer: 'spine', role: 'spine' }), 0, 'dc')
    const leaf = generateConfig(makeDevice({ hostname: 'DC-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf' }), 0, 'dc')
    for (const cfg of [spine, leaf]) {
      expect(cfg).toMatch(/^ip routing$/m)
      expect(cfg).toMatch(/^vrf instance MGMT$/m)
      expect(cfg).toMatch(/interface Management1\n\s+description OOB-MANAGEMENT\n\s+vrf MGMT/)
    }
  })

  it('Arista: ebgp-multihop on both peer groups + full-width leaf ECMP', () => {
    const spine = generateConfig(makeDevice({ hostname: 'DC-SPINE-A01', vendor: 'Arista', subLayer: 'spine', role: 'spine' }), 0, 'dc')
    const leaf = generateConfig(makeDevice({ hostname: 'DC-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf' }), 0, 'dc')
    expect(spine).toMatch(/neighbor LEAF-PEER ebgp-multihop 3/)
    expect(leaf).toMatch(/neighbor SPINE-PEER ebgp-multihop 3/)
    expect(leaf).toMatch(/maximum-paths 64 ecmp 64/)
  })

  it('campus distribution now has a loopback + real peer-link (V-12 / C-2)', () => {
    const dist = generateConfig(makeDevice({ hostname: 'IAD-DIST-A01', vendor: 'Cisco', subLayer: 'distribution', role: 'distribution', ports: 48, uplinks: 4 }), 0, 'campus')
    expect(dist).toMatch(/interface Loopback0\n\s+description ROUTER-ID\n\s+ip address 10\.255\.3\.1 255\.255\.255\.255/)
    expect(dist).toMatch(/router ospf 1\n\s+router-id 10\.255\.3\.1/)
    expect(dist).toMatch(/^interface Port-channel1$/m)
    expect(dist).not.toMatch(/^! interface Port-channel/m)
    expect(dist).toMatch(/interface TenGigabitEthernet1\/0\/43[\s\S]*?channel-group 1 mode active/)
  })
})

// ── Y2: NX-OS fabric wiring honesty (2nd-pass audit DC-4/DC-6) ───────────────────

describe('NX-OS fabric wiring honesty (group Y2)', () => {
  function dcFabric(spineCount: number, leafCount: number) {
    const devices: BOMDevice[] = []
    for (let i = 0; i < spineCount; i++) devices.push(makeDevice({ id: `s${i}`, hostname: `IAD-SPINE-${String.fromCharCode(65 + Math.floor(i / 2))}0${(i % 2) + 1}`, vendor: 'Cisco', subLayer: 'spine', role: 'spine', model: 'Nexus 9336C-FX2', ports: 36, uplinks: 0 }))
    for (let i = 0; i < leafCount; i++) devices.push(makeDevice({ id: `l${i}`, hostname: `IAD-LEAF-${String.fromCharCode(65 + Math.floor(i / 2))}0${(i % 2) + 1}`, vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', model: 'Nexus 93180YC-FX', ports: 48, uplinks: 4, uplinkStart: 49 }))
    return { devices, configs: generateAllConfigs(devices, 'dc') }
  }

  it('leaf uplinks round-robin across ALL spines — no spine is dark', () => {
    const { devices, configs } = dcFabric(6, 50)
    for (const s of devices.filter(d => d.subLayer === 'spine')) {
      const downlinks = (configs[s.id].match(/description DOWNLINK:/g) ?? []).length
      expect(downlinks, `${s.hostname} has no downlinks (dark spine)`).toBeGreaterThan(0)
    }
  })

  it('no spine configures a port beyond its physical port count', () => {
    const { devices, configs } = dcFabric(6, 50)
    for (const s of devices.filter(d => d.subLayer === 'spine')) {
      const maxPort = Math.max(0, ...[...configs[s.id].matchAll(/interface Ethernet1\/(\d+)\n\s+description DOWNLINK/g)].map(m => +m[1]))
      expect(maxPort, `${s.hostname} port ${maxPort} > ${s.ports}`).toBeLessThanOrEqual(s.ports)
    }
  })

  it('leaf fabric uplinks land on the SKU dedicated uplink range (Eth1/49+), not 25G server ports', () => {
    const { configs } = dcFabric(4, 4)
    const uplinkPorts = [...configs['l0'].matchAll(/interface Ethernet1\/(\d+)\n\s+description UPLINK:/g)].map(m => +m[1])
    expect(uplinkPorts.length).toBeGreaterThan(0)
    for (const p of uplinkPorts) expect(p, `uplink on port ${p} is in the 25G server range`).toBeGreaterThanOrEqual(49)
  })

  it('total spine downlinks equal total leaf uplinks (conservation)', () => {
    const { devices, configs } = dcFabric(6, 50)
    const spineDl = devices.filter(d => d.subLayer === 'spine').reduce((n, s) => n + (configs[s.id].match(/description DOWNLINK:/g) ?? []).length, 0)
    const leafUl = devices.filter(d => d.subLayer === 'leaf').reduce((n, l) => n + (configs[l.id].match(/description UPLINK:/g) ?? []).length, 0)
    expect(spineDl).toBe(leafUl)
    expect(spineDl).toBe(50 * 4)
  })
})

// ── Y3: campus deployability (2nd-pass audit C-1..C-6) ──────────────────────────

describe('Campus deployability (group Y3)', () => {
  const dist = () => generateConfig(makeDevice({ hostname: 'IAD-DIST-A01', vendor: 'Cisco', subLayer: 'distribution', role: 'distribution', ports: 48, uplinks: 4 }), 0, 'campus')
  const access = () => generateConfig(makeDevice({ hostname: 'IAD-ACC-A01', vendor: 'Cisco', subLayer: 'access', role: 'access', ports: 48, uplinks: 4 }), 2, 'campus')

  it('C-1: Vlan99 mgmt SVI exists on BOTH dist and access (mgmt plane sources from it)', () => {
    expect(dist()).toMatch(/interface Vlan99\n\s+description MGMT\n\s+ip address 10\.255\.99\.1 255\.255\.255\.0/)
    expect(access()).toMatch(/interface Vlan99\n\s+description MGMT\n\s+ip address 10\.255\.99\.3 255\.255\.255\.0/)
    expect(access()).toContain('ip default-gateway 10.255.99.254')
  })

  it('C-2: distribution has real access-facing downlink trunks and a routed core uplink', () => {
    const d = dist()
    expect(d).toMatch(/interface range TenGigabitEthernet1\/0\/1-42\n\s+description DOWNLINK-TO-ACCESS/)
    expect(d).toMatch(/interface TenGigabitEthernet1\/0\/45\n\s+description UPLINK-TO-CORE\n\s+no switchport/)
    expect(d).toContain('no passive-interface TenGigabitEthernet1/0/45')
    expect(d).not.toContain('<CHANGE-ME-uplink-to-core>')
  })

  it('C-4: access uplink trunks are DHCP-snooping trusted', () => {
    const a = access()
    const uplinkBlocks = a.split('interface GigabitEthernet1/0/4')  // uplinks 47/48
    expect(a).toMatch(/UPLINK-1[\s\S]*?ip dhcp snooping trust/)
    expect(a).toMatch(/UPLINK-2[\s\S]*?ip dhcp snooping trust/)
    expect(uplinkBlocks.length).toBeGreaterThan(1)
  })

  it('C-5: OSPF md5 key present on the core uplink to match area auth', () => {
    expect(dist()).toMatch(/UPLINK-TO-CORE[\s\S]*?ip ospf message-digest-key 1 md5 <CHANGE-ME-ospf-md5-key>/)
  })

  it('C-6: 802.1X with MAB fallback on access ports + global dot1x/radius', () => {
    const a = access()
    expect(a).toContain('dot1x system-auth-control')
    expect(a).toContain('aaa authentication dot1x default group radius')
    expect(a).toMatch(/authentication port-control auto\n\s+dot1x pae authenticator\n\s+mab/)
  })
})

// ── Y4: Arista tenant gateway + MLAG pair single-ASN + peer-link iBGP ───────────

describe('Arista tenant gateway + MLAG ASN model (group Y4)', () => {
  function pair() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf', ports: 32, uplinks: 8 }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Arista', subLayer: 'leaf', role: 'leaf', ports: 32, uplinks: 8 }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('A-M1: leaf has an anycast tenant gateway (Vlan10 ip address virtual + L3VNI/VRF)', () => {
    const leaf = pair()['l1']
    expect(leaf).toMatch(/vrf instance TENANT-A/)
    expect(leaf).toMatch(/ip routing vrf TENANT-A/)
    expect(leaf).toMatch(/ip virtual-router mac-address/)
    expect(leaf).toMatch(/interface Vlan10\n\s+description TENANT-A-ANYCAST-GW\n\s+vrf TENANT-A\n\s+ip address virtual <CHANGE-ME-tenant-anycast-gw>\/24/)
    expect(leaf).toMatch(/vxlan vrf TENANT-A vni 50000/)
    expect(leaf).toMatch(/vrf TENANT-A\n\s+rd 10\.255\.2\.1:50000\n\s+route-target import evpn 65000:50000/)
  })

  it('A-M2: MLAG pair shares ONE ASN and runs peer-link iBGP with next-hop-self', () => {
    const c = pair()
    // both members of pair 1 → ASN 65001
    expect(c['l1']).toMatch(/router bgp 65001/)
    expect(c['l2']).toMatch(/router bgp 65001/)
    // iBGP across Vlan4094: each peers the other's /31 with its own ASN
    expect(c['l1']).toMatch(/neighbor MLAG-PEER remote-as 65001/)
    expect(c['l1']).toMatch(/neighbor MLAG-PEER next-hop-self/)
    expect(c['l1']).toMatch(/neighbor 10\.253\.1\.1 peer group MLAG-PEER/)
    expect(c['l2']).toMatch(/neighbor 10\.253\.1\.0 peer group MLAG-PEER/)
  })

  it('EOS minors: ip name-server (not "dns server") and valid SNMPv3 user+group', () => {
    const spine = generateConfig(makeDevice({ hostname: 'DC-SPINE-A01', vendor: 'Arista', subLayer: 'spine', role: 'spine' }), 0, 'dc')
    expect(spine).toContain('ip name-server <CHANGE-ME-dns-ip>')
    expect(spine).not.toMatch(/^dns server /m)
    expect(spine).toContain('snmp-server group NETDESIGN-RO v3 priv')
    expect(spine).toMatch(/snmp-server user NETDESIGN-USER NETDESIGN-RO v3 auth sha/)
    expect(spine).not.toContain('priv-v3')
  })

  it('multisite Arista leaf: stretched DCI RTs on the L3VNI VRF too', () => {
    const dev = makeDevice({ id: 'l1', hostname: 'IAD-LEAF-A01', vendor: 'Arista', subLayer: 'leaf', role: 'leaf' })
    const cfg = generateConfig(dev, 0, 'multisite')
    expect(cfg).toContain('route-target import evpn 65100:50000')
    expect(cfg).toContain('route-target export evpn 65100:50000')
  })
})

// ── Y5: Juniper underlay IPv4 + topology-driven ports + SRX cluster ─────────────

describe('Juniper fabric wiring + SRX (group Y5)', () => {
  function fabric() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Juniper', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor: 'Juniper', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Juniper', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Juniper', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
      makeDevice({ id: 'l3', hostname: 'DC-LEAF-B01', vendor: 'Juniper', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('J-C1: every fabric interface carries a family inet /31 (underlay had no IPv4)', () => {
    const c = fabric()
    // leaf uplinks: family inet on et-0/0/48 and 49
    expect(c['l1']).toMatch(/set interfaces et-0\/0\/48 unit 0 family inet address 10\.99\.\d+\.\d+\/31/)
    expect(c['l1']).toMatch(/set interfaces et-0\/0\/49 unit 0 family inet address 10\.99\.\d+\.\d+\/31/)
    // spine downlinks too
    expect(c['s1']).toMatch(/set interfaces et-0\/0\/0 unit 0 family inet address 10\.99\.\d+\.\d+\/31/)
  })

  it('J-C2: spine port count is topology-driven (one interface per assigned leaf link, not 2)', () => {
    const c = fabric()
    // 3 leaves × 2 uplinks staggered over 2 spines → ~3 downlinks per spine
    const dl = (c['s1'].match(/description "DOWNLINK:/g) ?? []).length
    expect(dl).toBeGreaterThanOrEqual(2)
    const dl2 = (c['s2'].match(/description "DOWNLINK:/g) ?? []).length
    expect(dl + dl2).toBe(3 * 2)   // conservation
  })

  it('J-C3/J-M1: leaf has a global autonomous-system; no redundant local-as anywhere', () => {
    const c = fabric()
    expect(c['l1']).toMatch(/set routing-options autonomous-system 65003/)
    expect(c['l1']).not.toMatch(/local-as/)
    expect(c['s1']).toMatch(/set routing-options autonomous-system 65000/)
    expect(c['s1']).not.toMatch(/local-as/)
  })

  it('IS-IS auth-type md5 accompanies the auth key (silently unapplied otherwise)', () => {
    const c = fabric()
    for (const id of ['s1', 'l1']) {
      expect(c[id]).toMatch(/set protocols isis level 2 authentication-type md5/)
    }
  })

  it('J-M2/J-M3: SRX uses # comments, reth+fab cluster interfaces, zones bind reth units', () => {
    const srx = generateConfig(makeDevice({ hostname: 'IAD-FW-A01', vendor: 'Juniper', subLayer: 'firewall', model: 'SRX4600' }), 0, 'dc')
    expect(srx.split('\n').some(l => l === '!')).toBe(false)
    expect(srx).toMatch(/set interfaces fab0 fabric-options member-interfaces/)
    expect(srx).toMatch(/set interfaces reth0 unit 0 family inet address/)
    expect(srx).toMatch(/set security zones security-zone TRUST interfaces reth1\.0/)
    expect(srx).not.toMatch(/security-zone \w+ interfaces ge-0\/0\//)
  })
})

// ── Y6: NVIDIA Cumulus NVUE rewrite ─────────────────────────────────────────────

describe('NVIDIA Cumulus NVUE (group Y6)', () => {
  function gpuFabric() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'GPU-SPINE-A01', vendor: 'NVIDIA', subLayer: 'spine', role: 'spine', model: 'NVIDIA Spectrum SN5600', ports: 64, uplinks: 0 }),
      makeDevice({ id: 's2', hostname: 'GPU-SPINE-A02', vendor: 'NVIDIA', subLayer: 'spine', role: 'spine', model: 'NVIDIA Spectrum SN5600', ports: 64, uplinks: 0 }),
      makeDevice({ id: 'l1', hostname: 'GPU-LEAF-A01', vendor: 'NVIDIA', subLayer: 'leaf', role: 'leaf', model: 'NVIDIA Spectrum SN4600C', ports: 64, uplinks: 8 }),
      makeDevice({ id: 'l2', hostname: 'GPU-LEAF-A02', vendor: 'NVIDIA', subLayer: 'leaf', role: 'leaf', model: 'NVIDIA Spectrum SN4600C', ports: 64, uplinks: 8 }),
    ]
    return generateAllConfigs(devices, 'gpu')
  }

  it('N-C1: GPU fabric is genuinely lossless — real nv set qos roce, not comments', () => {
    const c = gpuFabric()
    for (const id of ['s1', 'l1']) {
      expect(c[id]).toContain('nv set qos roce enable on')
      expect(c[id]).toContain('nv set qos roce mode lossless')
      expect(c[id]).not.toMatch(/^# pfc\.pfc_port_list/m)   // no comment-only PFC
    }
  })

  it('N-C2: real auto-assigned identity (ASN + loopback), roles distinct', () => {
    const c = gpuFabric()
    expect(c['s1']).toContain('nv set router bgp autonomous-system 65000')
    expect(c['s1']).toContain('nv set interface lo ip address 10.255.1.1/32')
    expect(c['l1']).toContain('nv set router bgp autonomous-system 65003')  // global idx 2
    expect(c['l1']).toContain('nv set interface lo ip address 10.255.2.3/32')
    expect(c['l1']).not.toContain('<CHANGE-ME-asn>')
    expect(c['l1']).not.toContain('<CHANGE-ME-loopback-ip>')
  })

  it('N-C3/N-C4: per-port unnumbered neighbors — leaf peers ALL its uplinks, spine per assigned link', () => {
    const c = gpuFabric()
    // leaf: 8 uplinks on the top ports swp57-64
    for (let p = 57; p <= 64; p++) {
      expect(c['l1']).toContain(`nv set vrf default router bgp neighbor swp${p} remote-as external`)
    }
    // no invalid FRR range syntax anywhere
    expect(c['s1']).not.toMatch(/neighbor swp\d+-swp\d+/)
    // spine: one neighbor per assigned link (2 leaves × 8 uplinks staggered over 2 spines = 8 each)
    const spineNbrs = (c['s1'].match(/neighbor swp\d+ remote-as external/g) ?? []).length
    expect(spineNbrs).toBe(8)
  })

  it('N-M1/N-M2/N-M4: no NCLU, no route-reflector-client, no empty EVPN', () => {
    const c = gpuFabric()
    for (const id of ['s1', 'l1']) {
      expect(c[id]).not.toMatch(/^net add /m)          // NCLU removed in 5.x
      expect(c[id]).not.toContain('route-reflector-client')
      expect(c[id]).not.toContain('l2vpn evpn')        // pure eBGP L3 GPU fabric
      expect(c[id]).not.toContain('advertise-all-vni')
    }
  })

  it('N-M3: valid mgmt design (eth0 in the mgmt VRF, no contradictory iface stanzas)', () => {
    const c = gpuFabric()
    expect(c['s1']).toContain('nv set interface eth0 ip vrf mgmt')
    expect(c['s1']).not.toMatch(/iface mgmt inet dhcp/)
    expect(c['s1']).not.toMatch(/^auto swp\d+-\d+$/m)  // invalid ifupdown2 range
  })
})

// ── Y7: firewall ↔ fabric integration ───────────────────────────────────────────

describe('Firewall/fabric handoff (group Y7)', () => {
  function dcDesign() {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'IAD-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', role: 'spine', ports: 36 }),
      makeDevice({ id: 's2', hostname: 'IAD-SPINE-A02', vendor: 'Cisco', subLayer: 'spine', role: 'spine', ports: 36 }),
      makeDevice({ id: 'l1', hostname: 'IAD-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2, uplinkStart: 49 }),
      makeDevice({ id: 'f1', hostname: 'IAD-FW-A01', vendor: 'Cisco', subLayer: 'firewall', role: 'firewall', model: 'Firepower 4145 NGFW' }),
      makeDevice({ id: 'f2', hostname: 'IAD-FW-A02', vendor: 'Cisco', subLayer: 'firewall', role: 'firewall', model: 'Firepower 4145 NGFW' }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  it('spine configures a routed handoff port per firewall (BOM cabled them; nothing was configured before)', () => {
    const c = dcDesign()
    expect(c['s1']).toMatch(/description FW-HANDOFF: IAD-FW-A01/)
    expect(c['s1']).toMatch(/description FW-HANDOFF: IAD-FW-A02/)
    expect(c['s1']).toMatch(/FW-HANDOFF: IAD-FW-A01[\s\S]*?no switchport[\s\S]*?ip address 10\.98\.1\.0\/31/)
  })

  it('the FTD manifest INSIDE side matches the fabric handoff /31s (both ends agree)', () => {
    const c = dcDesign()
    // spine owns .0, firewall claims .1 of the same /31
    expect(c['s1']).toMatch(/ip address 10\.98\.1\.0\/31/)
    expect(c['f1']).toMatch(/zone=INSIDE\s+ip=10\.98\.1\.1\/31\s+← IAD-SPINE-A01/)
    expect(c['f1']).toMatch(/zone=INSIDE\s+ip=10\.98\.2\.1\/31\s+← IAD-SPINE-A02/)
    // second firewall takes the next /31 in each spine's block
    expect(c['s1']).toMatch(/FW-HANDOFF: IAD-FW-A02[\s\S]*?ip address 10\.98\.1\.2\/31/)
    expect(c['f2']).toMatch(/zone=INSIDE\s+ip=10\.98\.1\.3\/31/)
  })

  it('FTD manifest is design-specific: DC gets tenant/fabric INSIDE-NETS, campus gets VLAN/mgmt', () => {
    const dcFw = dcDesign()['f1']
    expect(dcFw).toContain('10.10.0.0/16 (tenant subnets), 10.255.0.0/16 (fabric loopbacks)')

    const campusDevices: BOMDevice[] = [
      makeDevice({ id: 'd1', hostname: 'IAD-DIST-A01', vendor: 'Cisco', subLayer: 'distribution', role: 'distribution', ports: 48, uplinks: 4 }),
      makeDevice({ id: 'f1', hostname: 'IAD-FW-A01', vendor: 'Cisco', subLayer: 'firewall', role: 'firewall', model: 'Firepower 4145 NGFW' }),
    ]
    const campus = generateAllConfigs(campusDevices, 'campus')
    expect(campus['f1']).toContain('10.10.10.0/24 (VLAN 10 DATA), 10.255.99.0/24 (campus MGMT)')
    // campus distribution also emits its FW handoff port
    expect(campus['d1']).toMatch(/description FW-HANDOFF: IAD-FW-A01[\s\S]*?ip address 10\.98\.1\.0 255\.255\.255\.254/)
    // and the two manifests are no longer byte-identical
    expect(campus['f1']).not.toBe(dcFw)
  })

  it('a design with no firewalls emits no handoff block', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'IAD-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', role: 'spine', ports: 36 }),
      makeDevice({ id: 'l1', hostname: 'IAD-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 2 }),
    ]
    expect(generateAllConfigs(devices, 'dc')['s1']).not.toContain('FW-HANDOFF')
  })
})

// ── Z1: fabric-forwarding criticals (3rd-pass audit) ────────────────────────────

describe('Fabric actually forwards (group Z1)', () => {
  function fabricFor(vendor: string, ports: number, uplinks: number, uplinkStart?: number) {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 's3', hostname: 'DC-SPINE-B01', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0 }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, uplinkStart }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, uplinkStart }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  // The parity invariant the 3rd audit asked for: EVERY vendor whose spine
  // re-advertises EVPN must preserve the originating VTEP as next-hop.
  const EVPN_VENDORS: Array<[string, number, number, RegExp]> = [
    ['Cisco', 48, 4, /set ip next-hop unchanged/],
    ['Arista', 32, 6, /neighbor LEAF-PEER next-hop-unchanged/],
    ['Juniper', 48, 4, /multihop no-nexthop-change/],
  ]

  for (const [vendor, ports, uplinks, re] of EVPN_VENDORS) {
    it(`${vendor}: eBGP EVPN spine preserves the overlay next-hop (no VXLAN blackhole)`, () => {
      const c = fabricFor(vendor, ports, uplinks)
      expect(c['s1'], `${vendor} spine rewrites EVPN next-hop to itself`).toMatch(re)
    })

    it(`${vendor}: leaf BGP-peers ONLY the spines it has links to (no permanently-Idle sessions)`, () => {
      // 2 leaves, 3 spines. With uplinks < spineCount the staggered planner
      // wires a SUBSET, so peering every spine leaves unreachable (>2 hop)
      // sessions Idle forever. One session per DISTINCT linked spine.
      const few = fabricFor(vendor, ports, 2)
      const leafFew = few['l1']
      const peersFew = (leafFew.match(/inherit peer SPINE-PEER|peer group SPINE-PEER|group SPINE-RR neighbor 10\.255\.1\./g) ?? []).length
      const linked = new Set(leafFew.match(/(?:UPLINK[:,][^\n]*?)(DC-SPINE-\w+)/g) ?? [])
      expect(peersFew, `${vendor}: peered ${peersFew} spines but only links to ${linked.size}`).toBe(linked.size)
      expect(peersFew, `${vendor}: must not peer all 3 spines with only 2 uplinks`).toBeLessThan(3)

      // With uplinks >= spineCount every spine is linked → one session each.
      const many = fabricFor(vendor, ports, uplinks)
      const peersMany = (many['l1'].match(/inherit peer SPINE-PEER|peer group SPINE-PEER|group SPINE-RR neighbor 10\.255\.1\./g) ?? []).length
      expect(peersMany).toBe(3)
    })

    it(`${vendor}: leaf has host-facing ports so the tenant VLAN can actually attach workloads`, () => {
      const c = fabricFor(vendor, ports, uplinks)
      expect(c['l1']).toMatch(/SERVER-ACCESS|ethernet-switching interface-mode access/)
    })
  }

  it('NX-OS enables the EVPN control plane (nv overlay evpn — §10; the AF is inert without it)', () => {
    const c = fabricFor('Cisco', 48, 4)
    expect(c['s1']).toMatch(/^nv overlay evpn$/m)
    expect(c['l1']).toMatch(/^nv overlay evpn$/m)
  })

  it('Arista: VLAN 10 carries the MLAG trunk group (EOS filters non-group VLANs off the peer-link)', () => {
    const c = fabricFor('Arista', 32, 6)
    expect(c['l1']).toMatch(/^vlan 10\n\s+name SERVERS\n[\s\S]*?trunk group MLAG_PEER/m)
  })

  it('Juniper: IRB anycast gateway + TENANT-A VRF + FIB load-balance (Junos needs all three)', () => {
    const c = fabricFor('Juniper', 48, 4)
    const leaf = c['l1']
    expect(leaf).toMatch(/set vlans V10 l3-interface irb\.10/)
    expect(leaf).toMatch(/set interfaces irb unit 10 family inet address .*virtual-gateway-address/)
    expect(leaf).toMatch(/set routing-instances TENANT-A instance-type vrf/)
    expect(leaf).toMatch(/set routing-options forwarding-table export LOAD-BALANCE/)
    expect(leaf).toMatch(/set protocols isis level 1 disable/)   // single underlay
  })

  it('NVIDIA leaf gives GPU servers real routed host ports (512 GPUs had no network)', () => {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'GPU-SPINE-A01', vendor: 'NVIDIA', subLayer: 'spine', role: 'spine', ports: 64, uplinks: 0 }),
      makeDevice({ id: 'l1', hostname: 'GPU-LEAF-A01', vendor: 'NVIDIA', subLayer: 'leaf', role: 'leaf', ports: 64, uplinks: 8 }),
    ]
    const c = generateAllConfigs(devices, 'gpu')
    expect(c['l1']).toMatch(/nv set interface swp1-56 ip address <CHANGE-ME-host-p2p>\/31/)
    expect(c['s1']).not.toMatch(/CHANGE-ME-host-p2p/)   // spines have no host ports
  })
})

// ── Z2: BOM ↔ config physical honesty (fabric rate mismatch) ─────────────────

describe('Fabric ports run at the rate the BOM bills (group Z2)', () => {
  function mixedRateFabric(vendor: string, ports: number, uplinks: number, uplinkStart?: number) {
    // 400G spine cages facing 100G leaf uplinks — the catalog's common case
    // (most spine SKUs are 400G, most leaf uplink blocks are 100G).
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '400G' }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '400G' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, uplinkStart, speed: '25G', uplinkSpeed: '100G' }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, uplinkStart, speed: '25G', uplinkSpeed: '100G' }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  function matchedRateFabric(vendor: string, ports: number, uplinks: number) {
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '100G' }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor, subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '100G' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, speed: '100G' }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor, subLayer: 'leaf', role: 'leaf', ports, uplinks, speed: '100G' }),
    ]
    return generateAllConfigs(devices, 'dc')
  }

  const RATE_VENDORS: Array<[string, number, number, RegExp]> = [
    ['Cisco',   48, 4, /\n {2}speed 100000\b/],
    ['Arista',  32, 4, /\n {2}speed forced 100gfull\b/],
    ['Juniper', 48, 4, /set interfaces et-0\/0\/\d+ speed 100g\b/],
  ]

  for (const [vendor, ports, uplinks, re] of RATE_VENDORS) {
    it(`${vendor}: a 400G spine cage is pinned to the 100G optic the BOM bills`, () => {
      const c = mixedRateFabric(vendor, ports, uplinks)
      expect(c['s1'], `${vendor} spine leaves its 400G port at native rate — it will never link`).toMatch(re)
    })

    it(`${vendor}: no rate is forced when both ends already match`, () => {
      const c = matchedRateFabric(vendor, ports, uplinks)
      expect(c['s1']).not.toMatch(re)
      expect(c['l1']).not.toMatch(re)
    })
  }

  it('the leaf side is pinned when ITS uplink block is the faster end', () => {
    // 400G leaf uplinks facing 100G spine ports — mismatch on the leaf.
    const devices: BOMDevice[] = [
      makeDevice({ id: 's1', hostname: 'DC-SPINE-A01', vendor: 'Cisco', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '100G' }),
      makeDevice({ id: 's2', hostname: 'DC-SPINE-A02', vendor: 'Cisco', subLayer: 'spine', role: 'spine', ports: 32, uplinks: 0, speed: '100G' }),
      makeDevice({ id: 'l1', hostname: 'DC-LEAF-A01', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 4, speed: '100G', uplinkSpeed: '400G' }),
      makeDevice({ id: 'l2', hostname: 'DC-LEAF-A02', vendor: 'Cisco', subLayer: 'leaf', role: 'leaf', ports: 48, uplinks: 4, speed: '100G', uplinkSpeed: '400G' }),
    ]
    const c = generateAllConfigs(devices, 'dc')
    expect(c['l1']).toMatch(/\n {2}speed 100000\b/)
    expect(c['s1']).not.toMatch(/\n {2}speed \d+\b/)
  })
})
