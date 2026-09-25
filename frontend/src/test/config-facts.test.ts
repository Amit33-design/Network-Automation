import { describe, it, expect } from 'vitest'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { ztpPlatform } from '@/lib/ztp'
import {
  FACT_NAMES,
  RULES,
  extractFacts,
  factPlatform,
  fleetFact,
  type FactPlatform,
} from '@/lib/config-facts'
import type { BOMDevice } from '@/types'

const VENDORS = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC',
  'Extreme Networks', 'Fortinet', 'Palo Alto', 'HPE Aruba']

function dev(partial: Partial<BOMDevice>): BOMDevice {
  return {
    id: 'd1', hostname: 'T-01', role: 'leaf', subLayer: 'leaf', model: '',
    vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0, speed: '', ports: 0,
    features: [], ...partial,
  } as BOMDevice
}

describe('normalized config facts (AM1)', () => {
  it('every catalogue platform has a rule for every fact', () => {
    // RULES is a full Record, so a missing cell is a compile error. This also
    // checks the runtime side: every platform a real vendor resolves to must
    // be a key — otherwise that vendor would silently match nothing.
    for (const vendor of VENDORS) {
      for (const uc of ['dc', 'campus', 'wan'] as const) {
        for (const d of buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })) {
          const p = factPlatform(d)
          expect(RULES[p], `${vendor} ${d.subLayer} → ${p} has no rules`).toBeTruthy()
          for (const f of FACT_NAMES) expect(RULES[p][f], `${p}.${f}`).toBeDefined()
        }
      }
    }
  })

  it('no longer false-FAILS dialects the old regex did not know', () => {
    // Each of these configs is correct; the old compliance regex said FAIL.
    const cases: Array<[FactPlatform, string, (typeof FACT_NAMES)[number]]> = [
      ['cumulus', 'nv set service ntp mgmt server 10.0.0.1 iburst on', 'ntp'],
      ['panos', 'set deviceconfig system ntp-servers primary-ntp-server ntp-server-address 10.0.0.1', 'ntp'],
      ['arubaoscx', 'ssh server vrf mgmt', 'sshV2'],
      ['fortios', '    set admin-ssh-v1 disable', 'sshV2'],
    ]
    for (const [p, cfg, f] of cases) {
      expect(extractFacts(cfg, p)[f].state, `${p}.${f}`).toBe('present')
    }
  })

  it('does not credit centralized AAA to a local-only admin account', () => {
    // The old `/aaa|radius|tacacs/` matched the word `aaa` here and passed
    // PCI-8.1 on Nokia, Cumulus and Aruba fabrics with no TACACS+/RADIUS.
    const localOnly: Array<[FactPlatform, string]> = [
      ['srl', 'system {\n  aaa {\n    authentication {\n      user admin { password "x" }\n    }\n  }\n}'],
      ['cumulus', 'nv set system aaa user admin password x\nnv set system aaa user admin role system-admin'],
      ['arubaoscx', 'aaa authentication login default local'],
    ]
    for (const [p, cfg] of localOnly) {
      expect(extractFacts(cfg, p).aaa.state, p).toBe('absent')
    }
    // …while a real TACACS+/RADIUS reference does count.
    expect(extractFacts('tacacs-server host 10.0.0.3 key x', 'nxos').aaa.state).toBe('present')
    expect(extractFacts('configure radius mgmt-access primary server 10.0.0.3 1812', 'exos').aaa.state).toBe('present')
  })

  it('a comment can never satisfy a fact', () => {
    // Z6 fixed this in the validator; the fix never reached the compliance
    // scanner, so an FTD passed PCI-6.1 on its commented FMC manifest.
    const onlyComments = [
      '!   syslog: logging host 10.0.0.1 (level informational, mgmt intf)',
      '! ntp server 10.0.0.2',
      '# ssh version 2',
      '// tacacs-server host 10.0.0.3',
    ].join('\n')
    for (const p of ['nxos', 'ios-xe', 'eos'] as FactPlatform[]) {
      const f = extractFacts(onlyComments, p)
      for (const name of FACT_NAMES) expect(f[name].state, `${p}.${name}`).toBe('absent')
    }
  })

  it('does not mistake look-alike lines for the fact', () => {
    // Each of these contains the keyword but is not the fact — exactly what a
    // broad cross-vendor regex matches.
    expect(extractFacts(
      'set security zones security-zone TRUST host-inbound-traffic system-services [ ping ssh dhcp ntp ]', 'junos',
    )).toMatchObject({ sshV2: { state: 'absent' }, ntp: { state: 'absent' } })
    expect(extractFacts('  log-adjacency-changes', 'nxos').syslog.state).toBe('absent')
    expect(extractFacts('    set ssl-ssh-profile "certificate-inspection"', 'fortios').sshV2.state).toBe('absent')
  })

  it('reports FMC-managed facts as unverifiable, not missing', () => {
    // FTD logging and AAA are set in FMC, not the device CLI. Reporting them
    // absent would be a failure the user can do nothing about in the design.
    const f = extractFacts('configure ssh-access-list 10.0.0.0/8\nconfigure ntp servers 10.0.0.2', 'ftd')
    expect(f.sshV2.state).toBe('present')
    expect(f.ntp.state).toBe('present')
    for (const name of ['syslog', 'aaa'] as const) {
      expect(f[name].state).toBe('unknown')
      expect(f[name].note).toMatch(/FMC/)
    }
    // …and the FTD resolves to its own dialect, not the IOS-XE ztpPlatform picks.
    const ftd = dev({ vendor: 'Cisco', model: 'FTD 4145', subLayer: 'firewall' })
    expect(ztpPlatform(ftd)).toBe('ios-xe')
    expect(factPlatform(ftd)).toBe('ftd')
  })

  it('carries the matching line as evidence', () => {
    const f = extractFacts('hostname X\nssh version 2\nntp server 10.0.0.2 prefer', 'nxos')
    expect(f.sshV2.evidence).toBe('ssh version 2')
    expect(f.ntp.evidence).toBe('ntp server 10.0.0.2 prefer')
  })

  it('reads IOS-XR nested NTP', () => {
    expect(extractFacts('ntp\n server 10.0.0.2 prefer\n!', 'iosxr').ntp.state).toBe('present')
    expect(extractFacts('ntp\n!', 'iosxr').ntp.state).toBe('absent')
  })

  it('reports an unresolvable config instead of guessing its dialect', () => {
    const f = fleetFact({ 'NO-SUCH-DEVICE': 'ssh version 2' }, [], 'sshV2')
    expect(f.unresolved).toEqual(['NO-SUCH-DEVICE'])
    expect(f.present).toEqual([])
  })

  it('matches the verified ground truth on real generated configs', () => {
    // Read by eye from the generators' actual output. AM1 pinned the real
    // gaps it found as `A` cells; AM4 fixed the generators and flipped them.
    // No platform may regress to `A` — the sweep below also asserts that.
    const truth: Partial<Record<FactPlatform, string>> = {
      nxos: 'P P P P P', eos: 'P P P P P', exos: 'P P P P P', 'ios-xe': 'P P P P P',
      junos: 'P P P P P', iosxr: 'P P P P P',
      // Columns: hostname sshV2 ntp syslog aaa. AM4 closed every AAA gap AM1
    // exposed; AM2 fixed Nokia SRL's invalid `hostname` (now `name host-name`).
      cumulus: 'P P P P P', srl: 'P P P P P', dellos10: 'P P P P P',
      arubaoscx: 'P P P P P', fortios: 'P P P P P',
      panos: 'P P P P P',     // AM4: telnet/http disabled (was 'A P P P')
      viptela: 'P U P P P',   // SSH is v2-only by design, no statement exists
      'oran-nf': 'P P P P P',
      'oran-ru': 'P P U P U', // PTP timing; accounts via O-DU/SMO NETCONF
      ftd: 'P P P U U',       // syslog/AAA live in FMC
    }
    const code = { present: 'P', absent: 'A', unknown: 'U' } as const
    const seen = new Map<FactPlatform, Set<string>>()
    for (const vendor of VENDORS) {
      for (const uc of ['dc', 'campus', 'wan', 'multisite', 'multicloud', 'oran'] as const) {
        const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
        const cfgs = generateAllConfigs(devs, uc)
        for (const d of devs) {
          // Cloud gateways and hosts have no device CLI (AA1) — nothing to read.
          if (!cfgs[d.id]) continue
          const p = factPlatform(d)
          const f = extractFacts(cfgs[d.id], p)
          const row = FACT_NAMES.map(n => code[f[n].state]).join(' ')
          seen.set(p, (seen.get(p) ?? new Set()).add(row))
        }
      }
    }
    for (const [p, expected] of Object.entries(truth) as Array<[FactPlatform, string]>) {
      expect(seen.get(p), `${p} never appeared`).toBeTruthy()
      expect([...seen.get(p)!], p).toContain(expected)
    }
    // AM4: no generated device, on any platform, is missing a management fact.
    const gaps = [...seen].flatMap(([p, rows]) => [...rows].filter(r => r.includes('A')).map(r => `${p}: ${r}`))
    expect(gaps).toEqual([])
  })

  it('AM4: Junos TACACS+ uses the real statement, not the invalid `set access`', () => {
    // `set access tacacs-server` is not a Junos statement; the switches had
    // `authentication-order [ tacplus password ]` with no tacplus server
    // behind it, so every login silently fell through to the local password.
    for (const uc of ['dc', 'campus', 'wan'] as const) {
      const devs = buildDeviceList({ useCase: uc, scale: 'medium', siteCode: 'T', vendorPrefs: ['Juniper'] })
      const cfgs = generateAllConfigs(devs, uc)
      for (const d of devs.filter(x => factPlatform(x) === 'junos')) {
        const c = cfgs[d.id] ?? ''
        expect(c, d.hostname).not.toMatch(/^set access tacacs-server/m)
        if (/authentication-order \[ tacplus/.test(c)) expect(c, d.hostname).toMatch(/^set system tacplus-server \S+ secret/m)
      }
    }
  })

  it('AM4: a vEdge names a TACACS+ server rather than an auth-order with none', () => {
    // It used to say `auth-order local radius` with no radius server — which
    // the old `/radius/` match counted as central AAA.
    expect(extractFacts('system\n  aaa\n    auth-order local radius\n  !\n!', 'viptela').aaa.state).toBe('absent')
    expect(extractFacts('system\n  tacacs\n    server 10.0.0.3\n      vpn 512', 'viptela').aaa.state).toBe('present')
  })

  it('AM4: O-RAN elements resolve to their own dialect, not the server vendor', () => {
    expect(factPlatform(dev({ vendor: 'Dell EMC', model: 'O-CU Server (Dell R750)', subLayer: 'oran-cu' }))).toBe('oran-nf')
    expect(factPlatform(dev({ vendor: 'Fujitsu', model: 'O-RU', subLayer: 'oran-ru' }))).toBe('oran-ru')
    // The fronthaul switch IS a NOS box and keeps its NOS dialect.
    expect(factPlatform(dev({ vendor: 'Cisco', model: 'Nexus 93180YC-FX3', subLayer: 'oran-fronthaul' }))).toBe('nxos')
  })

  it('AM4: IOS-XR flat `ntp server` counts', () => {
    expect(extractFacts('ntp server 10.0.0.2', 'iosxr').ntp.state).toBe('present')
  })

  it('AM3: every fabric vendor exposes its routing facts in its own dialect', () => {
    // One matrix, seven vendors: the checks no longer know any syntax, so a
    // vendor whose dialect a rule misses shows up here, not as a silent pass.
    const FABRIC = ['Cisco', 'Arista', 'Juniper', 'Nokia', 'NVIDIA', 'Dell EMC', 'Extreme Networks', 'HPE Aruba']
    const gaps: string[] = []
    for (const vendor of FABRIC) {
      const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const cfgs = generateAllConfigs(devs, 'dc')
      for (const d of devs.filter(x => x.subLayer === 'spine' || x.subLayer === 'leaf')) {
        const f = extractFacts(cfgs[d.id], factPlatform(d))
        const want: Array<keyof typeof f> = ['bgp', 'loopback', 'bfd', 'jumboMtu']
        // NVIDIA is a pure eBGP L3 fabric (Y6, RFC 7938) — no overlay by design.
        if (vendor !== 'NVIDIA') want.push('evpn')
        if (vendor !== 'NVIDIA' && d.subLayer === 'leaf') want.push('vxlan')
        for (const k of want) if (f[k].state !== 'present') gaps.push(`${vendor} ${d.subLayer} ${d.hostname}: no ${k}`)
      }
    }
    expect([...new Set(gaps)]).toEqual([])
  })

  it('AM3: a spine is not a VTEP', () => {
    // An eBGP spine carries EVPN routes but terminates no tunnels (Z1).
    for (const vendor of ['Cisco', 'Arista', 'Juniper', 'Nokia', 'Dell EMC', 'Extreme Networks', 'HPE Aruba']) {
      const devs = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'T', vendorPrefs: [vendor] })
      const cfgs = generateAllConfigs(devs, 'dc')
      for (const d of devs.filter(x => x.subLayer === 'spine')) {
        expect(extractFacts(cfgs[d.id], factPlatform(d)).vxlan.state, `${vendor} ${d.hostname}`).toBe('absent')
      }
    }
  })

  it('AM3: the word "vxlan" is not a tunnel endpoint', () => {
    // The old V-08/V-14 detector counted any occurrence of the word.
    expect(extractFacts('interface Ethernet1/1\n description vxlan uplink to spine', 'nxos').vxlan.state).toBe('absent')
    expect(extractFacts('set routing-instances T protocols evpn ip-prefix-routes encapsulation vxlan', 'junos').vxlan.state).toBe('absent')
    expect(extractFacts('set vlans V10 vxlan vni 10010', 'junos').vxlan.state).toBe('present')
  })
})

