/**
 * config-update.ts — Day-N incremental config change engine
 *
 * After a device is built by ZTP (Day-0 mgmt + Day-N production), operators
 * still need to push SUBSEQUENT, targeted changes to already-live devices —
 * add a BGP neighbor/route-policy, a firewall/ACL rule, a VLAN, a static
 * route, etc. This engine turns a parameterized change into the vendor-correct
 * INCREMENTAL commands (a delta, not a full config), generates the matching
 * ROLLBACK (the inverse), and builds a change-set scoped to the selected
 * live devices with a push script + rollback runbook.
 *
 * Pure + dependency-free + fully unit-tested. Distinct from policies.ts (full-
 * config-bake placeholder snippets) and rollback.ts (checkpoint-based device
 * rollback): this is per-command, parameterized, and reversible.
 */

import type { BOMDevice } from '@/types'

// ── CLI families ───────────────────────────────────────────────────────────
// Day-2 deltas only need the operator-CLI family, not the full platform key.
export type CliFamily = 'ios' | 'junos' | 'nokia' | 'fortios' | 'panos'

export function cliFamily(vendor: string): CliFamily {
  switch (vendor) {
    case 'Juniper':          return 'junos'
    case 'Nokia':            return 'nokia'
    case 'Fortinet':         return 'fortios'
    case 'Palo Alto':        return 'panos'
    // Cisco / Arista / Dell EMC / Extreme / HPE Aruba / NVIDIA → IOS-like CLI
    default:                 return 'ios'
  }
}

export const FAMILY_LABEL: Record<CliFamily, string> = {
  ios: 'Cisco/Arista IOS-style', junos: 'Juniper Junos',
  nokia: 'Nokia SR Linux', fortios: 'Fortinet FortiOS', panos: 'Palo Alto PAN-OS',
}

// ── Change operations ──────────────────────────────────────────────────────

export interface ChangeFieldSpec {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  default?: string
}

export interface RenderResult {
  /** Forward (apply) command lines. Empty → not templated for this family. */
  commands: string[]
  /** Inverse (rollback) command lines. */
  rollback: string[]
}

export interface ChangeOperation {
  id: string
  label: string
  icon: string
  category: 'Routing' | 'Security' | 'L2' | 'Management'
  description: string
  /** Device subLayers this change typically targets ('*' = any). */
  appliesTo: string[]
  fields: ChangeFieldSpec[]
  /** CLI families this op is templated for. */
  families: CliFamily[]
  render: (family: CliFamily, p: Record<string, string>) => RenderResult
}

const v = (p: Record<string, string>, k: string, dflt = ''): string => (p[k]?.trim() || dflt)

// ── BGP neighbor ────────────────────────────────────────────────────────────
const bgpNeighbor: ChangeOperation = {
  id: 'bgp-neighbor',
  label: 'BGP neighbor',
  icon: '🔗',
  category: 'Routing',
  description: 'Add a BGP neighbor (peer IP, remote-AS, optional in/out policy).',
  appliesTo: ['spine', 'leaf', 'core', 'wan-edge', 'border', 'distribution'],
  families: ['ios', 'junos', 'nokia'],
  fields: [
    { key: 'local_as', label: 'Local ASN', default: '<CHANGE-ME-local-asn>', required: true },
    { key: 'peer_ip', label: 'Neighbor IP', placeholder: '10.0.0.2', required: true },
    { key: 'remote_as', label: 'Remote ASN', placeholder: '65010', required: true },
    { key: 'description', label: 'Description', placeholder: 'to-PE-2' },
    { key: 'rmap_in', label: 'Inbound policy', placeholder: 'RM-IN' },
    { key: 'rmap_out', label: 'Outbound policy', placeholder: 'RM-OUT' },
  ],
  render: (fam, p) => {
    const peer = v(p, 'peer_ip'), ras = v(p, 'remote_as'), las = v(p, 'local_as', '<CHANGE-ME-local-asn>')
    const desc = v(p, 'description'), rin = v(p, 'rmap_in'), rout = v(p, 'rmap_out')
    if (fam === 'ios') {
      const c = [`router bgp ${las}`, ` neighbor ${peer} remote-as ${ras}`]
      if (desc) c.push(` neighbor ${peer} description ${desc}`)
      c.push(' address-family ipv4 unicast', `  neighbor ${peer} activate`)
      if (rin) c.push(`  neighbor ${peer} route-map ${rin} in`)
      if (rout) c.push(`  neighbor ${peer} route-map ${rout} out`)
      return { commands: c, rollback: [`router bgp ${las}`, ` no neighbor ${peer}`] }
    }
    if (fam === 'junos') {
      const c = [`set protocols bgp group EXTERNAL neighbor ${peer} peer-as ${ras}`]
      if (desc) c.push(`set protocols bgp group EXTERNAL neighbor ${peer} description "${desc}"`)
      if (rin) c.push(`set protocols bgp group EXTERNAL neighbor ${peer} import ${rin}`)
      if (rout) c.push(`set protocols bgp group EXTERNAL neighbor ${peer} export ${rout}`)
      return { commands: c, rollback: [`delete protocols bgp group EXTERNAL neighbor ${peer}`] }
    }
    // nokia
    const base = `set / network-instance default protocols bgp neighbor ${peer}`
    const c = [`${base} peer-as ${ras}`, `${base} admin-state enable`]
    if (rin) c.push(`${base} afi-safi ipv4-unicast import-policy ${rin}`)
    if (rout) c.push(`${base} afi-safi ipv4-unicast export-policy ${rout}`)
    return { commands: c, rollback: [`delete / network-instance default protocols bgp neighbor ${peer}`] }
  },
}

// ── BGP route policy (prefix-list + route-map / policy) ──────────────────────
const bgpRoutePolicy: ChangeOperation = {
  id: 'bgp-route-policy',
  label: 'BGP route policy',
  icon: '🧭',
  category: 'Routing',
  description: 'Add a route policy: a prefix-list match + permit/deny, optional set local-pref.',
  appliesTo: ['spine', 'leaf', 'core', 'wan-edge', 'border'],
  families: ['ios', 'junos', 'nokia'],
  fields: [
    { key: 'name', label: 'Policy name', placeholder: 'RM-CUSTOMER-IN', required: true },
    { key: 'action', label: 'Action (permit/deny)', default: 'permit', required: true },
    { key: 'prefix', label: 'Prefix', placeholder: '10.20.0.0/16', required: true },
    { key: 'local_pref', label: 'Set local-pref (optional)', placeholder: '200' },
  ],
  render: (fam, p) => {
    const name = v(p, 'name'), act = v(p, 'action', 'permit').toLowerCase()
    const prefix = v(p, 'prefix'), lp = v(p, 'local_pref')
    const pl = `${name}-PL`
    if (fam === 'ios') {
      const c = [
        `ip prefix-list ${pl} seq 10 ${act} ${prefix}`,
        `route-map ${name} ${act} 10`,
        ` match ip address prefix-list ${pl}`,
      ]
      if (act === 'permit' && lp) c.push(` set local-preference ${lp}`)
      return { commands: c, rollback: [`no route-map ${name}`, `no ip prefix-list ${pl}`] }
    }
    if (fam === 'junos') {
      const jact = act === 'deny' ? 'reject' : 'accept'
      const c = [
        `set policy-options prefix-list ${pl} ${prefix}`,
        `set policy-options policy-statement ${name} term 10 from prefix-list ${pl}`,
      ]
      if (jact === 'accept' && lp) c.push(`set policy-options policy-statement ${name} term 10 then local-preference ${lp}`)
      c.push(`set policy-options policy-statement ${name} term 10 then ${jact}`)
      return { commands: c, rollback: [`delete policy-options policy-statement ${name}`, `delete policy-options prefix-list ${pl}`] }
    }
    // nokia
    const c = [
      `set / routing-policy prefix-set ${pl} prefix ${prefix} mask-length-range exact`,
      `set / routing-policy policy ${name} statement 10 match prefix-set ${pl}`,
      `set / routing-policy policy ${name} statement 10 action policy-result ${act === 'deny' ? 'reject' : 'accept'}`,
    ]
    if (act === 'permit' && lp) c.push(`set / routing-policy policy ${name} statement 10 action bgp local-preference set ${lp}`)
    return { commands: c, rollback: [`delete / routing-policy policy ${name}`, `delete / routing-policy prefix-set ${pl}`] }
  },
}

// ── Firewall / ACL rule ──────────────────────────────────────────────────────
const firewallRule: ChangeOperation = {
  id: 'firewall-rule',
  label: 'Firewall / ACL rule',
  icon: '🛡',
  category: 'Security',
  description: 'Add a firewall/ACL rule (action, protocol, source, destination, port).',
  appliesTo: ['*'],
  families: ['ios', 'junos', 'fortios', 'panos'],
  fields: [
    { key: 'name', label: 'ACL / policy name', placeholder: 'ACL-INSIDE-IN', required: true },
    { key: 'action', label: 'Action (permit/deny)', default: 'permit', required: true },
    { key: 'protocol', label: 'Protocol', default: 'tcp', placeholder: 'tcp/udp/ip' },
    { key: 'source', label: 'Source', placeholder: '10.1.0.0/24', required: true },
    { key: 'destination', label: 'Destination', placeholder: '10.2.0.0/24', required: true },
    { key: 'port', label: 'Dest port (optional)', placeholder: '443' },
  ],
  render: (fam, p) => {
    const name = v(p, 'name'), act = v(p, 'action', 'permit').toLowerCase()
    const proto = v(p, 'protocol', 'tcp'), src = v(p, 'source'), dst = v(p, 'destination'), port = v(p, 'port')
    if (fam === 'ios') {
      const ace = `${act} ${proto} ${iosWild(src)} ${iosWild(dst)}${port ? ` eq ${port}` : ''}`
      return {
        commands: [`ip access-list extended ${name}`, ` ${ace}`],
        rollback: [`ip access-list extended ${name}`, ` no ${ace}`],
      }
    }
    if (fam === 'junos') {
      const term = `T-${(src + dst).replace(/[^0-9]/g, '').slice(0, 6) || '10'}`
      const jact = act === 'deny' ? 'discard' : 'accept'
      const f = `firewall family inet filter ${name} term ${term}`
      const c = [
        `set ${f} from source-address ${src}`,
        `set ${f} from destination-address ${dst}`,
        `set ${f} from protocol ${proto}`,
      ]
      if (port) c.push(`set ${f} from destination-port ${port}`)
      c.push(`set ${f} then ${jact}`)
      return { commands: c, rollback: [`delete firewall family inet filter ${name} term ${term}`] }
    }
    if (fam === 'fortios') {
      const id = 100
      const c = [
        `config firewall policy`,
        `  edit ${id}`,
        `    set name "${name}"`,
        `    set srcaddr "${src}"`,
        `    set dstaddr "${dst}"`,
        `    set action ${act === 'deny' ? 'deny' : 'accept'}`,
        `    set service "${proto.toUpperCase()}${port ? '-' + port : ''}"`,
        `    set schedule "always"`,
        `  next`,
        `end`,
      ]
      return { commands: c, rollback: [`config firewall policy`, `  delete ${id}`, `end`] }
    }
    // panos
    const c = [
      `set rulebase security rules ${name} from any to any`,
      `set rulebase security rules ${name} source ${src} destination ${dst}`,
      `set rulebase security rules ${name} application any service ${proto === 'ip' ? 'any' : `service-${proto}${port ? '-' + port : ''}`}`,
      `set rulebase security rules ${name} action ${act === 'deny' ? 'deny' : 'allow'}`,
    ]
    return { commands: c, rollback: [`delete rulebase security rules ${name}`] }
  },
}

// ── VLAN ──────────────────────────────────────────────────────────────────────
const vlanAdd: ChangeOperation = {
  id: 'vlan',
  label: 'VLAN',
  icon: '🔢',
  category: 'L2',
  description: 'Add a VLAN (id + name) and optional SVI gateway.',
  appliesTo: ['leaf', 'access', 'distribution', 'core'],
  families: ['ios', 'junos'],
  fields: [
    { key: 'vlan_id', label: 'VLAN ID', placeholder: '120', required: true },
    { key: 'name', label: 'VLAN name', placeholder: 'PCI-DATA', required: true },
    { key: 'svi_ip', label: 'SVI gateway (optional)', placeholder: '10.120.0.1/24' },
  ],
  render: (fam, p) => {
    const id = v(p, 'vlan_id'), name = v(p, 'name'), svi = v(p, 'svi_ip')
    if (fam === 'ios') {
      const c = [`vlan ${id}`, ` name ${name}`]
      const rb = [`no vlan ${id}`]
      if (svi) {
        const [ip, mask] = svi.split('/')
        c.push(`interface Vlan${id}`, ` ip address ${ip}${mask ? ` /${mask}` : ''}`, ' no shutdown')
        rb.unshift(`no interface Vlan${id}`)
      }
      return { commands: c, rollback: rb }
    }
    // junos
    const c = [`set vlans ${name} vlan-id ${id}`]
    const rb = [`delete vlans ${name}`]
    if (svi) {
      c.push(`set vlans ${name} l3-interface irb.${id}`, `set interfaces irb unit ${id} family inet address ${svi}`)
      rb.unshift(`delete interfaces irb unit ${id}`)
    }
    return { commands: c, rollback: rb }
  },
}

// ── Static route ─────────────────────────────────────────────────────────────
const staticRoute: ChangeOperation = {
  id: 'static-route',
  label: 'Static route',
  icon: '🧱',
  category: 'Routing',
  description: 'Add a static route (prefix → next-hop), optional VRF.',
  appliesTo: ['*'],
  families: ['ios', 'junos', 'nokia'],
  fields: [
    { key: 'prefix', label: 'Prefix', placeholder: '10.50.0.0/24', required: true },
    { key: 'next_hop', label: 'Next hop', placeholder: '10.0.0.1', required: true },
    { key: 'vrf', label: 'VRF (optional)', placeholder: 'TENANT-A' },
  ],
  render: (fam, p) => {
    const prefix = v(p, 'prefix'), nh = v(p, 'next_hop'), vrf = v(p, 'vrf')
    if (fam === 'ios') {
      const [net, mask] = prefix.split('/')
      const vrfPart = vrf ? `vrf ${vrf} ` : ''
      const cmd = `ip route ${vrfPart}${net} ${mask ? `/${mask}` : ''} ${nh}`.replace(/\s+/g, ' ').trim()
      return { commands: [cmd], rollback: [`no ${cmd}`] }
    }
    if (fam === 'junos') {
      const ri = vrf ? `routing-instances ${vrf} routing-options` : 'routing-options'
      return {
        commands: [`set ${ri} static route ${prefix} next-hop ${nh}`],
        rollback: [`delete ${ri} static route ${prefix}`],
      }
    }
    // nokia
    const ni = vrf || 'default'
    return {
      commands: [
        `set / network-instance ${ni} static-routes route ${prefix} next-hop-group nh-${nh.replace(/\./g, '-')}`,
        `set / network-instance ${ni} next-hop-groups group nh-${nh.replace(/\./g, '-')} nexthop 1 ip-address ${nh}`,
      ],
      rollback: [`delete / network-instance ${ni} static-routes route ${prefix}`],
    }
  },
}

// ── Management server (NTP / syslog / SNMP host) ─────────────────────────────
const mgmtServer: ChangeOperation = {
  id: 'mgmt-server',
  label: 'Management server (NTP/Syslog/SNMP)',
  icon: '🛰',
  category: 'Management',
  description: 'Add an NTP, syslog, or SNMP trap host to live devices.',
  appliesTo: ['*'],
  families: ['ios', 'junos', 'nokia'],
  fields: [
    { key: 'service', label: 'Service (ntp/syslog/snmp)', default: 'ntp', required: true },
    { key: 'server', label: 'Server IP', placeholder: '10.0.0.100', required: true },
  ],
  render: (fam, p) => {
    const svc = v(p, 'service', 'ntp').toLowerCase()
    const ip = v(p, 'server')
    if (fam === 'ios') {
      const cmd = svc === 'syslog' ? `logging host ${ip}`
        : svc === 'snmp' ? `snmp-server host ${ip} version 3 priv <CHANGE-ME-snmp-user>`
        : `ntp server ${ip}`
      return { commands: [cmd], rollback: [`no ${cmd}`] }
    }
    if (fam === 'junos') {
      const cmd = svc === 'syslog' ? `system syslog host ${ip} any info`
        : svc === 'snmp' ? `snmp trap-group NMS targets ${ip}`
        : `system ntp server ${ip}`
      return { commands: [`set ${cmd}`], rollback: [`delete ${cmd}`] }
    }
    // nokia
    const cmd = svc === 'syslog' ? `/ system logging remote-server ${ip}`
      : svc === 'snmp' ? `/ system snmp trap-group NMS target ${ip}`
      : `/ system ntp server ${ip}`
    return { commands: [`set ${cmd}`], rollback: [`delete ${cmd}`] }
  },
}

// ── Interface config (description / admin state / access VLAN) ────────────────
const interfaceConfig: ChangeOperation = {
  id: 'interface-config',
  label: 'Interface config',
  icon: '🔌',
  category: 'L2',
  description: 'Set an interface description, admin state, and optional access VLAN.',
  appliesTo: ['*'],
  families: ['ios', 'junos'],
  fields: [
    { key: 'iface', label: 'Interface', placeholder: 'GigabitEthernet1/0/1', required: true },
    { key: 'description', label: 'Description', placeholder: 'uplink-to-core' },
    { key: 'admin_state', label: 'Admin state (up/down)', default: 'up', required: true },
    { key: 'access_vlan', label: 'Access VLAN (optional)', placeholder: '120' },
  ],
  render: (fam, p) => {
    const iface = v(p, 'iface'), desc = v(p, 'description')
    const up = v(p, 'admin_state', 'up').toLowerCase() !== 'down'
    const vlan = v(p, 'access_vlan')
    if (fam === 'ios') {
      const c = [`interface ${iface}`]
      if (desc) c.push(` description ${desc}`)
      c.push(up ? ' no shutdown' : ' shutdown')
      if (vlan) c.push(` switchport access vlan ${vlan}`)
      // rollback: undo what we set (remove description, opposite admin state, no access vlan)
      const rb = [`interface ${iface}`]
      if (desc) rb.push(' no description')
      rb.push(up ? ' shutdown' : ' no shutdown')
      if (vlan) rb.push(' no switchport access vlan')
      return { commands: c, rollback: rb }
    }
    // junos
    const c: string[] = []
    if (desc) c.push(`set interfaces ${iface} description "${desc}"`)
    c.push(up ? `delete interfaces ${iface} disable` : `set interfaces ${iface} disable`)
    if (vlan) c.push(`set interfaces ${iface} unit 0 family ethernet-switching vlan members ${vlan}`)
    const rb: string[] = []
    if (desc) rb.push(`delete interfaces ${iface} description`)
    rb.push(up ? `set interfaces ${iface} disable` : `delete interfaces ${iface} disable`)
    if (vlan) rb.push(`delete interfaces ${iface} unit 0 family ethernet-switching vlan members ${vlan}`)
    return { commands: c, rollback: rb }
  },
}

export const CHANGE_CATALOG: ChangeOperation[] = [
  bgpNeighbor, bgpRoutePolicy, firewallRule, vlanAdd, staticRoute,
  mgmtServer, interfaceConfig,
]

export function getChangeOp(id: string): ChangeOperation | undefined {
  return CHANGE_CATALOG.find(o => o.id === id)
}

// IOS uses wildcard masks for hosts/subnets in some contexts, but named ACLs
// accept CIDR-ish `a.b.c.d/p` poorly; emit `host`/`any`/`x.x.x.x y.y.y.y` form.
function iosWild(addr: string): string {
  const a = addr.trim()
  if (a === 'any' || a === '0.0.0.0/0') return 'any'
  if (a.includes('/')) {
    const [net, plen] = a.split('/')
    if (plen === '32') return `host ${net}`
    return `${net} ${wildcardMask(parseInt(plen, 10))}`
  }
  return `host ${a}`
}

function wildcardMask(prefixLen: number): string {
  const bits = 32 - (isNaN(prefixLen) ? 32 : prefixLen)
  const hostCount = bits >= 32 ? 0xffffffff : (2 ** bits) - 1
  return [24, 16, 8, 0].map(s => (hostCount >>> s) & 0xff).join('.')
}

// ── Change set (scoped to selected devices) ─────────────────────────────────

export interface ChangeSetDevice {
  device: BOMDevice
  family: CliFamily
  /** Op is templated for this device's family + applies to its role. */
  supported: boolean
  commands: string[]
  rollback: string[]
}

export interface ChangeSet {
  op: ChangeOperation
  params: Record<string, string>
  devices: ChangeSetDevice[]
  summary: { total: number; supported: number; byFamily: Record<string, number> }
}

function roleApplies(op: ChangeOperation, dev: BOMDevice): boolean {
  if (op.appliesTo.includes('*')) return true
  const l = (dev.subLayer || '').toLowerCase()
  const r = (dev.role || '').toLowerCase()
  return op.appliesTo.some(x => l.includes(x) || r.includes(x))
}

/** List missing required fields for an operation. */
export function validateChangeParams(op: ChangeOperation, params: Record<string, string>): string[] {
  return op.fields
    .filter(f => f.required && !((params[f.key] ?? f.default ?? '').trim()))
    .map(f => f.label)
}

/** Build a change-set: per-device delta + rollback, scoped to `devices`. */
export function buildChangeSet(
  op: ChangeOperation,
  params: Record<string, string>,
  devices: BOMDevice[],
): ChangeSet {
  // Merge field defaults into params so render sees complete input.
  const merged: Record<string, string> = {}
  for (const f of op.fields) merged[f.key] = (params[f.key] ?? f.default ?? '')
  for (const k of Object.keys(params)) if (params[k] != null) merged[k] = params[k]

  const byFamily: Record<string, number> = {}
  const entries: ChangeSetDevice[] = devices.map(device => {
    const family = cliFamily(device.vendor)
    const applies = roleApplies(op, device)
    const templated = op.families.includes(family)
    const supported = applies && templated
    if (supported) byFamily[family] = (byFamily[family] ?? 0) + 1
    const r = supported
      ? op.render(family, merged)
      : { commands: [`! ${op.label} not applicable to ${device.hostname} (${family}/${device.subLayer}) — review manually`], rollback: [] }
    return { device, family, supported, commands: r.commands, rollback: r.rollback }
  })

  return {
    op,
    params: merged,
    devices: entries,
    summary: {
      total: entries.length,
      supported: entries.filter(e => e.supported).length,
      byFamily,
    },
  }
}

/** A human-readable, copy/paste push runbook (forward commands per device). */
export function changeSetToScript(cs: ChangeSet): string {
  const ts = '<apply during approved change window>'
  const lines = [
    `# ── Day-N config change: ${cs.op.label} ──────────────────────────────`,
    `# ${cs.op.description}`,
    `# Targets: ${cs.summary.supported}/${cs.summary.total} device(s). ${ts}`,
    '',
  ]
  for (const e of cs.devices) {
    if (!e.supported) continue
    lines.push(`# ── ${e.device.hostname} (${e.device.vendor}, ${FAMILY_LABEL[e.family]}) ──`)
    lines.push(...e.commands)
    lines.push('')
  }
  return lines.join('\n')
}

/** The rollback runbook (inverse commands per device). */
export function changeSetRollbackScript(cs: ChangeSet): string {
  const lines = [
    `# ── ROLLBACK for: ${cs.op.label} ─────────────────────────────────────`,
    `# Apply only if the change must be reverted.`,
    '',
  ]
  for (const e of cs.devices) {
    if (!e.supported || e.rollback.length === 0) continue
    lines.push(`# ── ${e.device.hostname} (${e.device.vendor}) ──`)
    lines.push(...e.rollback)
    lines.push('')
  }
  return lines.join('\n')
}

// ── Pre-flight safety analysis ──────────────────────────────────────────────

export type ChangeWarnSeverity = 'info' | 'warn' | 'danger'

export interface ChangeWarning {
  severity: ChangeWarnSeverity
  message: string
  devices?: string[]
}

const FABRIC_ROLES = ['spine', 'leaf', 'core', 'super-spine', 'border']

/**
 * Pre-flight safety check on a change set, surfaced before the operator pushes.
 * Flags skipped devices, unfilled `<CHANGE-ME>` placeholders, irreversible
 * (no-rollback) changes, and a couple of genuinely risky patterns
 * (shutting a fabric interface, a broad deny-any firewall rule).
 */
export function analyzeChangeSet(cs: ChangeSet): ChangeWarning[] {
  const warnings: ChangeWarning[] = []
  const supported = cs.devices.filter(d => d.supported)

  // 1. Skipped devices (role/vendor not applicable).
  const skipped = cs.devices.filter(d => !d.supported)
  if (skipped.length) {
    warnings.push({
      severity: 'info',
      message: `${skipped.length} selected device(s) will be skipped — ${cs.op.label} doesn't apply to their role/vendor.`,
      devices: skipped.map(d => d.device.hostname),
    })
  }

  // 2. Unfilled placeholders in the generated commands.
  const withPlaceholder = supported
    .filter(d => d.commands.some(c => c.includes('<CHANGE-ME')))
    .map(d => d.device.hostname)
  if (withPlaceholder.length) {
    warnings.push({
      severity: 'warn',
      message: `Generated commands still contain <CHANGE-ME-*> placeholders — fill every parameter before deploying.`,
      devices: withPlaceholder,
    })
  }

  // 3. Irreversible — supported device with no rollback.
  const noRollback = supported.filter(d => d.rollback.length === 0).map(d => d.device.hostname)
  if (noRollback.length) {
    warnings.push({
      severity: 'danger',
      message: `${noRollback.length} device(s) have no generated rollback — this change cannot be auto-reverted.`,
      devices: noRollback,
    })
  }

  // 4. Risky: shutting an interface on a fabric device may isolate it.
  if (cs.op.id === 'interface-config' && (cs.params.admin_state ?? '').toLowerCase() === 'down') {
    const fabric = supported
      .filter(d => FABRIC_ROLES.some(r => (d.device.subLayer || '').toLowerCase().includes(r)))
      .map(d => d.device.hostname)
    if (fabric.length) {
      warnings.push({
        severity: 'danger',
        message: `Admin-down on a fabric interface (${cs.params.iface}) can isolate a spine/leaf/core device — verify it's not an active uplink.`,
        devices: fabric,
      })
    }
  }

  // 5. Risky: broad deny-any firewall rule could block management.
  if (cs.op.id === 'firewall-rule'
    && (cs.params.action ?? '').toLowerCase() === 'deny'
    && isAny(cs.params.source) && isAny(cs.params.destination)) {
    warnings.push({
      severity: 'danger',
      message: `Broad "deny any → any" rule — confirm it won't lock out management/SSH access.`,
      devices: supported.map(d => d.device.hostname),
    })
  }

  return warnings
}

function isAny(addr?: string): boolean {
  const a = (addr ?? '').trim().toLowerCase()
  return a === 'any' || a === '0.0.0.0/0' || a === ''
}
