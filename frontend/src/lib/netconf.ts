/**
 * NetDesign AI — NETCONF capability model (AK1)
 * ==============================================
 * The NETCONF tab's own blurb states the limit — "Supported on Juniper JunOS,
 * Cisco IOS-XE 16.6+, Cisco NX-OS, Arista EOS" — but the device dropdown
 * listed every device in the BOM. Measured before this existed: an NVIDIA DC
 * design offered NETCONF on 12 of 14 Cumulus boxes (NVUE REST, no NETCONF
 * server at all) and a Fortinet campus design on 18 of 18. Picking one built a
 * Cisco-flavoured `ietf-interfaces` RPC that can never run.
 *
 * Capability is resolved through `ztpPlatform()` — the same single vendor→NOS
 * map AG5, AG6 and AG10 consolidated onto. A fifth private vendor table is
 * exactly the drift this codebase keeps paying for.
 *
 * Where a platform has no NETCONF server this says what it DOES speak, so the
 * operator is redirected rather than just refused.
 */
import type { BOMDevice } from '@/types'
import { ztpPlatform, type ZTPPlatform } from '@/lib/ztp'

export type NetconfDatastore = 'running' | 'candidate' | 'startup'
export type NetconfOp = 'get-config' | 'edit-config' | 'get' | 'lock' | 'unlock' | 'commit'

export interface NetconfProfile {
  /** Platform label for the UI. */
  label: string
  /** Datastores this platform's NETCONF server actually exposes. */
  datastores: NetconfDatastore[]
  /**
   * An edit to `candidate` is only applied after an explicit <commit>. Without
   * this the panel's own workflow was a dead end: it offered edit-config to
   * candidate and no way to commit it.
   */
  needsCommit: boolean
  /** YANG flavour used for the sample payload. */
  yang: 'ietf' | 'junos-xnm' | 'openconfig' | 'srl' | 'dell'
  /** A real interface name on this platform — `GigabitEthernet1` is not one on EOS. */
  sampleIface: string
  /** Enablement the operator must have done first, shown as a hint. */
  enableHint: string
  /** Caveat worth stating in the UI (empty when there is none). */
  note?: string
}

/**
 * Platforms with no NETCONF server, and the interface they use instead.
 * Stated as "the automation interface this tool targets", not as a claim that
 * NETCONF can never be bolted on — the point is that this panel does not
 * generate RPCs for them rather than emitting something that cannot run.
 */
export const NON_NETCONF_PLATFORMS: Record<string, { label: string; instead: string }> = {
  cumulus:   { label: 'NVIDIA Cumulus',  instead: 'NVUE REST API (and the `nv set` CLI this tool generates)' },
  fortios:   { label: 'FortiOS',         instead: 'FortiOS REST API' },
  panos:     { label: 'PAN-OS',          instead: 'PAN-OS XML API over HTTPS (not NETCONF, despite also being XML)' },
  exos:      { label: 'Extreme EXOS',    instead: 'EXOS REST / JSON-RPC' },
  arubaoscx: { label: 'Aruba AOS-CX',    instead: 'AOS-CX REST API' },
}

export const NETCONF_PROFILES: Partial<Record<ZTPPlatform, NetconfProfile>> = {
  junos: {
    label: 'Juniper JunOS',
    datastores: ['running', 'candidate'],
    needsCommit: true,
    yang: 'junos-xnm',
    sampleIface: 'ge-0/0/0',
    enableHint: 'set system services netconf ssh',
  },
  'ios-xe': {
    label: 'Cisco IOS-XE',
    datastores: ['running', 'candidate'],
    needsCommit: true,
    yang: 'ietf',
    sampleIface: 'GigabitEthernet1',
    enableHint: 'netconf-yang',
    note: 'The candidate datastore needs `netconf-yang feature candidate-datastore` (17.x+); on 16.6 only running is writable.',
  },
  iosxr: {
    label: 'Cisco IOS-XR',
    datastores: ['running', 'candidate'],
    needsCommit: true,
    yang: 'ietf',
    sampleIface: 'GigabitEthernet0/0/0/0',
    enableHint: 'netconf-yang agent ssh',
  },
  nxos: {
    label: 'Cisco NX-OS',
    // NX-OS exposes running only — selecting candidate returned an RPC error.
    datastores: ['running'],
    needsCommit: false,
    yang: 'ietf',
    sampleIface: 'Ethernet1/1',
    enableHint: 'feature netconf',
    note: 'NX-OS has no candidate datastore — edits apply to running immediately, so there is nothing to commit.',
  },
  eos: {
    label: 'Arista EOS',
    datastores: ['running'],
    needsCommit: false,
    yang: 'openconfig',
    sampleIface: 'Ethernet1',
    enableHint: 'management api netconf / transport ssh',
    note: 'EOS stages changes in a config session rather than a NETCONF candidate datastore.',
  },
  srl: {
    label: 'Nokia SR Linux',
    datastores: ['running', 'candidate'],
    needsCommit: true,
    yang: 'srl',
    sampleIface: 'ethernet-1/1',
    enableHint: 'system management netconf-server',
  },
  dellos10: {
    label: 'Dell OS10',
    datastores: ['running', 'candidate'],
    needsCommit: true,
    yang: 'dell',
    sampleIface: 'ethernet1/1/1',
    enableHint: 'netconf enable',
  },
}

/** The profile for a device, or null when the platform has no NETCONF server. */
export function netconfProfile(dev: BOMDevice): NetconfProfile | null {
  return NETCONF_PROFILES[ztpPlatform(dev)] ?? null
}

export function netconfSupported(dev: BOMDevice): boolean {
  return netconfProfile(dev) != null
}

/** What a non-NETCONF device speaks instead, for the UI to say so. */
export function netconfAlternative(dev: BOMDevice): { label: string; instead: string } | null {
  return NON_NETCONF_PLATFORMS[ztpPlatform(dev)] ?? null
}

export interface NetconfCoverage {
  supported: BOMDevice[]
  unsupported: BOMDevice[]
  /** Distinct "NVIDIA Cumulus — use NVUE REST API" lines for the notice. */
  alternatives: string[]
}

export function netconfCoverage(devices: BOMDevice[]): NetconfCoverage {
  const supported: BOMDevice[] = []
  const unsupported: BOMDevice[] = []
  const alts = new Map<string, string>()
  for (const dev of devices) {
    if (netconfSupported(dev)) { supported.push(dev); continue }
    unsupported.push(dev)
    const alt = netconfAlternative(dev)
    if (alt) alts.set(alt.label, `${alt.label} — use ${alt.instead}`)
    else alts.set(ztpPlatform(dev), `${ztpPlatform(dev)} — no NETCONF server`)
  }
  return { supported, unsupported, alternatives: [...alts.values()].sort() }
}

/** Operations valid for a profile — `commit` only where a candidate is committed. */
export function netconfOps(profile: NetconfProfile): NetconfOp[] {
  const ops: NetconfOp[] = ['get-config', 'edit-config', 'get', 'lock', 'unlock']
  if (profile.needsCommit) ops.push('commit')
  return ops
}

// ── RPC construction ─────────────────────────────────────────────────────────

const RPC_OPEN = '<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="1">'

/** The subtree filter / config body for a platform's own YANG flavour. */
function ifaceBody(p: NetconfProfile, forEdit: boolean): string {
  switch (p.yang) {
    case 'junos-xnm':
      return forEdit
        ? `      <configuration xmlns="http://xml.juniper.net/xnm/1.1/xnm">
        <interfaces>
          <interface>
            <name>${p.sampleIface}</name>
            <description>NetDesign AI managed</description>
          </interface>
        </interfaces>
      </configuration>`
        : `      <configuration xmlns="http://xml.juniper.net/xnm/1.1/xnm">
        <interfaces/>
      </configuration>`
    case 'openconfig':
      return forEdit
        ? `      <interfaces xmlns="http://openconfig.net/yang/interfaces">
        <interface>
          <name>${p.sampleIface}</name>
          <config>
            <name>${p.sampleIface}</name>
            <description>NetDesign AI managed</description>
            <enabled>true</enabled>
          </config>
        </interface>
      </interfaces>`
        : `      <interfaces xmlns="http://openconfig.net/yang/interfaces"/>`
    case 'srl':
      return forEdit
        ? `      <interface xmlns="urn:nokia.com:srlinux:chassis:interfaces">
        <name>${p.sampleIface}</name>
        <description>NetDesign AI managed</description>
        <admin-state>enable</admin-state>
      </interface>`
        : `      <interface xmlns="urn:nokia.com:srlinux:chassis:interfaces"/>`
    case 'dell':
    case 'ietf':
    default:
      return forEdit
        ? `      <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces">
        <interface>
          <name>${p.sampleIface}</name>
          <description>NetDesign AI managed</description>
          <enabled>true</enabled>
        </interface>
      </interfaces>`
        : `      <interfaces xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/>`
  }
}

/**
 * Build a NETCONF RPC for one platform.
 *
 * Previously only `edit-config` branched on Juniper, so `get-config` handed a
 * Juniper box `ietf-interfaces` while its own edit used the `xnm` model — the
 * panel disagreed with itself about one vendor — and every non-Cisco platform
 * got `GigabitEthernet1`, an interface name none of them have.
 */
export function buildNetconfRpc(
  op: NetconfOp,
  datastore: NetconfDatastore,
  profile: NetconfProfile,
): string {
  const ds = profile.datastores.includes(datastore) ? datastore : profile.datastores[0]
  switch (op) {
    case 'get-config':
      return `${RPC_OPEN}
  <get-config>
    <source><${ds}/></source>
    <filter type="subtree">
${ifaceBody(profile, false)}
    </filter>
  </get-config>
</rpc>`
    case 'edit-config':
      return `${RPC_OPEN}
  <edit-config>
    <target><${ds}/></target>
    <default-operation>merge</default-operation>
    <error-option>rollback-on-error</error-option>
    <config>
${ifaceBody(profile, true)}
    </config>
  </edit-config>
</rpc>`
    case 'get':
      return `${RPC_OPEN}
  <get>
    <filter type="subtree">
${ifaceBody(profile, false)}
    </filter>
  </get>
</rpc>`
    case 'lock':
      return `${RPC_OPEN}
  <lock><target><${ds}/></target></lock>
</rpc>`
    case 'unlock':
      return `${RPC_OPEN}
  <unlock><target><${ds}/></target></unlock>
</rpc>`
    case 'commit':
      return `${RPC_OPEN}
  <commit/>
</rpc>`
  }
}
