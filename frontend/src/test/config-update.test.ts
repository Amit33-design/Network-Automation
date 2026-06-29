import { describe, it, expect } from 'vitest'
import {
  cliFamily, getChangeOp, CHANGE_CATALOG, validateChangeParams,
  buildChangeSet, changeSetToScript, changeSetRollbackScript,
} from '@/lib/config-update'
import type { BOMDevice } from '@/types'

const dev = (o: Partial<BOMDevice>): BOMDevice => ({
  id: o.hostname ?? 'd', hostname: 'H', role: 'leaf', subLayer: 'leaf',
  model: 'M', vendor: 'Cisco', count: 1, unitPrice: 0, totalPrice: 0,
  speed: '100G', ports: 32, uplinks: 4, features: [], ...o,
})

describe('cliFamily', () => {
  it('maps vendors to CLI families', () => {
    expect(cliFamily('Cisco')).toBe('ios')
    expect(cliFamily('Arista')).toBe('ios')
    expect(cliFamily('Dell EMC')).toBe('ios')
    expect(cliFamily('Juniper')).toBe('junos')
    expect(cliFamily('Nokia')).toBe('nokia')
    expect(cliFamily('Fortinet')).toBe('fortios')
    expect(cliFamily('Palo Alto')).toBe('panos')
  })
})

describe('CHANGE_CATALOG', () => {
  it('has the requested change ops with fields + families', () => {
    const ids = CHANGE_CATALOG.map(o => o.id)
    expect(ids).toContain('bgp-neighbor')
    expect(ids).toContain('bgp-route-policy')
    expect(ids).toContain('firewall-rule')
    expect(ids).toContain('vlan')
    expect(ids).toContain('static-route')
    for (const op of CHANGE_CATALOG) {
      expect(op.fields.length).toBeGreaterThan(0)
      expect(op.families.length).toBeGreaterThan(0)
    }
  })
})

describe('validateChangeParams', () => {
  it('reports missing required fields by label', () => {
    const op = getChangeOp('bgp-neighbor')!
    const missing = validateChangeParams(op, { local_as: '65000' })
    expect(missing).toContain('Neighbor IP')
    expect(missing).toContain('Remote ASN')
    expect(missing).not.toContain('Local ASN')
  })
})

// ── BGP neighbor ────────────────────────────────────────────────────────────
describe('bgp-neighbor render', () => {
  const op = getChangeOp('bgp-neighbor')!
  const p = { local_as: '65000', peer_ip: '10.0.0.2', remote_as: '65010', rmap_in: 'RM-IN' }

  it('ios: emits router bgp + neighbor, rollback removes it', () => {
    const r = op.render('ios', p)
    expect(r.commands).toContain('router bgp 65000')
    expect(r.commands.join('\n')).toContain('neighbor 10.0.0.2 remote-as 65010')
    expect(r.commands.join('\n')).toContain('route-map RM-IN in')
    expect(r.rollback.join('\n')).toContain('no neighbor 10.0.0.2')
  })

  it('junos: set protocols bgp ... rollback deletes neighbor', () => {
    const r = op.render('junos', p)
    expect(r.commands.join('\n')).toContain('set protocols bgp group EXTERNAL neighbor 10.0.0.2 peer-as 65010')
    expect(r.rollback[0]).toBe('delete protocols bgp group EXTERNAL neighbor 10.0.0.2')
  })

  it('nokia: network-instance default protocols bgp neighbor', () => {
    const r = op.render('nokia', p)
    expect(r.commands.join('\n')).toContain('network-instance default protocols bgp neighbor 10.0.0.2 peer-as 65010')
    expect(r.rollback[0]).toContain('delete / network-instance default protocols bgp neighbor 10.0.0.2')
  })
})

// ── BGP route policy ─────────────────────────────────────────────────────────
describe('bgp-route-policy render', () => {
  const op = getChangeOp('bgp-route-policy')!
  const p = { name: 'RM-CUST', action: 'permit', prefix: '10.20.0.0/16', local_pref: '200' }

  it('ios: prefix-list + route-map + set local-preference', () => {
    const r = op.render('ios', p)
    const t = r.commands.join('\n')
    expect(t).toContain('ip prefix-list RM-CUST-PL seq 10 permit 10.20.0.0/16')
    expect(t).toContain('route-map RM-CUST permit 10')
    expect(t).toContain('set local-preference 200')
    expect(r.rollback).toEqual(['no route-map RM-CUST', 'no ip prefix-list RM-CUST-PL'])
  })

  it('junos: policy-statement with accept + local-preference', () => {
    const r = op.render('junos', p)
    const t = r.commands.join('\n')
    expect(t).toContain('set policy-options prefix-list RM-CUST-PL 10.20.0.0/16')
    expect(t).toContain('then local-preference 200')
    expect(t).toContain('then accept')
  })

  it('deny maps to reject/deny and omits local-pref', () => {
    const r = op.render('ios', { name: 'RM-X', action: 'deny', prefix: '10.0.0.0/8', local_pref: '150' })
    const t = r.commands.join('\n')
    expect(t).toContain('route-map RM-X deny 10')
    expect(t).not.toContain('set local-preference')
  })
})

// ── Firewall / ACL rule ──────────────────────────────────────────────────────
describe('firewall-rule render', () => {
  const op = getChangeOp('firewall-rule')!
  const p = { name: 'ACL-IN', action: 'permit', protocol: 'tcp', source: '10.1.0.0/24', destination: '10.2.0.0/24', port: '443' }

  it('ios: extended ACL ACE + matching no-rollback', () => {
    const r = op.render('ios', p)
    expect(r.commands[0]).toBe('ip access-list extended ACL-IN')
    expect(r.commands[1]).toContain('permit tcp')
    expect(r.commands[1]).toContain('eq 443')
    expect(r.rollback[1].startsWith(' no ')).toBe(true)
  })

  it('junos: firewall filter term with rollback delete', () => {
    const r = op.render('junos', p)
    const t = r.commands.join('\n')
    expect(t).toContain('firewall family inet filter ACL-IN term')
    expect(t).toContain('then accept')
    expect(r.rollback[0]).toContain('delete firewall family inet filter ACL-IN term')
  })

  it('fortios: config firewall policy block + delete rollback', () => {
    const r = op.render('fortios', p)
    const t = r.commands.join('\n')
    expect(t).toContain('config firewall policy')
    expect(t).toContain('set action accept')
    expect(r.rollback.join('\n')).toContain('delete 100')
  })

  it('panos: security rule set + delete rollback', () => {
    const r = op.render('panos', { ...p, action: 'deny' })
    const t = r.commands.join('\n')
    expect(t).toContain('set rulebase security rules ACL-IN')
    expect(t).toContain('action deny')
    expect(r.rollback[0]).toBe('delete rulebase security rules ACL-IN')
  })
})

// ── VLAN + static route ──────────────────────────────────────────────────────
describe('vlan + static-route render', () => {
  it('vlan ios: vlan + SVI, rollback removes both', () => {
    const r = getChangeOp('vlan')!.render('ios', { vlan_id: '120', name: 'PCI', svi_ip: '10.120.0.1/24' })
    expect(r.commands.join('\n')).toContain('vlan 120')
    expect(r.commands.join('\n')).toContain('interface Vlan120')
    expect(r.rollback).toContain('no vlan 120')
    expect(r.rollback).toContain('no interface Vlan120')
  })

  it('static-route ios: ip route + no-rollback', () => {
    const r = getChangeOp('static-route')!.render('ios', { prefix: '10.50.0.0/24', next_hop: '10.0.0.1' })
    expect(r.commands[0]).toContain('ip route')
    expect(r.commands[0]).toContain('10.0.0.1')
    expect(r.rollback[0].startsWith('no ')).toBe(true)
  })

  it('static-route junos with VRF uses routing-instances', () => {
    const r = getChangeOp('static-route')!.render('junos', { prefix: '10.50.0.0/24', next_hop: '10.0.0.1', vrf: 'TENANT-A' })
    expect(r.commands[0]).toContain('routing-instances TENANT-A routing-options static route 10.50.0.0/24 next-hop 10.0.0.1')
  })
})

// ── Management server ─────────────────────────────────────────────────────────
describe('mgmt-server render', () => {
  const op = getChangeOp('mgmt-server')!
  it('ios: ntp/syslog/snmp each with no-rollback', () => {
    expect(op.render('ios', { service: 'ntp', server: '10.0.0.100' }).commands[0]).toBe('ntp server 10.0.0.100')
    expect(op.render('ios', { service: 'syslog', server: '10.0.0.100' }).commands[0]).toBe('logging host 10.0.0.100')
    const snmp = op.render('ios', { service: 'snmp', server: '10.0.0.100' })
    expect(snmp.commands[0]).toContain('snmp-server host 10.0.0.100')
    expect(snmp.rollback[0].startsWith('no ')).toBe(true)
  })
  it('junos/nokia: set + delete rollback', () => {
    const j = op.render('junos', { service: 'ntp', server: '10.0.0.100' })
    expect(j.commands[0]).toBe('set system ntp server 10.0.0.100')
    expect(j.rollback[0]).toBe('delete system ntp server 10.0.0.100')
    const n = op.render('nokia', { service: 'syslog', server: '10.0.0.100' })
    expect(n.commands[0]).toContain('set / system logging remote-server 10.0.0.100')
    expect(n.rollback[0]).toContain('delete / system logging remote-server')
  })
})

// ── Interface config ──────────────────────────────────────────────────────────
describe('interface-config render', () => {
  const op = getChangeOp('interface-config')!
  it('ios: description + no shutdown + access vlan, rollback inverts', () => {
    const r = op.render('ios', { iface: 'Gi1/0/1', description: 'uplink', admin_state: 'up', access_vlan: '120' })
    const t = r.commands.join('\n')
    expect(t).toContain('interface Gi1/0/1')
    expect(t).toContain(' description uplink')
    expect(t).toContain(' no shutdown')
    expect(t).toContain(' switchport access vlan 120')
    const rb = r.rollback.join('\n')
    expect(rb).toContain(' no description')
    expect(rb).toContain(' shutdown')          // inverse of no shutdown
    expect(rb).toContain(' no switchport access vlan')
  })
  it('ios down state rollback brings it back up', () => {
    const r = op.render('ios', { iface: 'Gi1/0/2', admin_state: 'down' })
    expect(r.commands.join('\n')).toContain(' shutdown')
    expect(r.rollback.join('\n')).toContain(' no shutdown')
  })
  it('junos: set description + disable handling', () => {
    const r = op.render('junos', { iface: 'ge-0/0/1', description: 'x', admin_state: 'down' })
    expect(r.commands.join('\n')).toContain('set interfaces ge-0/0/1 disable')
    expect(r.rollback.join('\n')).toContain('delete interfaces ge-0/0/1 disable')
  })
})

// ── Change set ───────────────────────────────────────────────────────────────
describe('buildChangeSet', () => {
  const op = getChangeOp('bgp-neighbor')!
  const params = { local_as: '65000', peer_ip: '10.0.0.2', remote_as: '65010' }
  const devices = [
    dev({ id: 'sp1', hostname: 'SP-01', vendor: 'Cisco', subLayer: 'spine' }),
    dev({ id: 'lf1', hostname: 'LF-01', vendor: 'Juniper', subLayer: 'leaf' }),
    dev({ id: 'ac1', hostname: 'AC-01', vendor: 'Cisco', subLayer: 'access', role: 'access' }), // BGP not for access
  ]

  it('marks each device supported/unsupported by role + family', () => {
    const cs = buildChangeSet(op, params, devices)
    const sp = cs.devices.find(d => d.device.id === 'sp1')!
    const lf = cs.devices.find(d => d.device.id === 'lf1')!
    const ac = cs.devices.find(d => d.device.id === 'ac1')!
    expect(sp.supported).toBe(true)
    expect(lf.supported).toBe(true)
    expect(ac.supported).toBe(false)       // BGP neighbor not for access role
    expect(cs.summary.supported).toBe(2)
    expect(cs.summary.byFamily).toMatchObject({ ios: 1, junos: 1 })
  })

  it('merges field defaults so local_as falls back to placeholder', () => {
    const cs = buildChangeSet(op, { peer_ip: '10.0.0.5', remote_as: '65020' }, [devices[0]])
    expect(cs.devices[0].commands.join('\n')).toContain('router bgp <CHANGE-ME-local-asn>')
  })

  it('push + rollback scripts include only supported devices', () => {
    const cs = buildChangeSet(op, params, devices)
    const push = changeSetToScript(cs)
    const rb = changeSetRollbackScript(cs)
    expect(push).toContain('SP-01')
    expect(push).toContain('LF-01')
    expect(push).not.toContain('AC-01')     // unsupported excluded
    expect(rb).toContain('no neighbor 10.0.0.2')
    expect(rb).toContain('delete protocols bgp group EXTERNAL neighbor 10.0.0.2')
  })
})
