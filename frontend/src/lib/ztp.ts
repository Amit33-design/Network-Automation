/**
 * ztp.ts — Enterprise Zero-Touch Provisioning engine
 *
 * Makes ZTP work like a standard enterprise tool for ANY vendor:
 *   1. Identify the device — vendor, hardware model, platform, and role.
 *   2. Select the correct ZTP mechanism + DHCP classification for that vendor
 *      (POAP / PnP / ZTP / eZTP / FortiZTP / Aruba Activate / ZTP+ / …).
 *   3. Push the RIGHT config — a vendor-correct Day-0 management-plane
 *      bootstrap (per CLAUDE.md §11: mgmt plane ONLY, no production config),
 *      then pair the device with its Day-N production config for the
 *      identified role (from `generateAllConfigs`).
 *
 * Pure, dependency-free, fully unit-tested. The Step 6 ZTP tab and the
 * backend file/DHCP exporters consume these helpers so demo and live mode
 * agree on vendor handling.
 */

import type { BOMDevice } from '@/types'

// ── ZTP mechanisms ─────────────────────────────────────────────────────────

export type ZTPPlatform =
  | 'nxos' | 'ios-xe' | 'iosxr' | 'eos' | 'junos' | 'srl'
  | 'cumulus' | 'dellos10' | 'fortios' | 'arubaoscx' | 'exos' | 'panos'

export type ZTPMethod =
  | 'POAP'        // Cisco NX-OS
  | 'PnP'         // Cisco IOS-XE (Plug-and-Play / DNA)
  | 'ZTP'         // Cisco IOS-XR, Juniper, Dell, Cumulus, Nokia, generic
  | 'eZTP'        // Arista (Zero Touch Provisioning)
  | 'FortiZTP'    // Fortinet
  | 'Aruba-ZTP'   // HPE Aruba Central / Activate
  | 'ZTP+'        // Extreme
  | 'Panorama-ZTP'// Palo Alto

export interface ZTPVendorProfile {
  vendor: string
  platform: ZTPPlatform
  method: ZTPMethod
  /** DHCP option 60 (vendor-class-identifier) the device advertises, used to
   *  classify it on the DHCP server and serve the correct boot file. */
  dhcpVendorClass: string
  /** Transport the device uses to fetch its boot artifact. */
  bootProtocol: 'http' | 'https' | 'tftp'
  /** DHCP option used to redirect the device to the provisioning server. */
  dhcpRedirect: 'option67-bootfile' | 'option43-vendor' | 'dns-srv' | 'option239-script'
  notes: string
}

// Per-vendor ZTP capability profile. Cisco is model-dependent (NX-OS vs
// IOS-XE vs IOS-XR) and resolved in `ztpPlatform()` / `identifyDevice()`.
export const ZTP_VENDOR_PROFILES: Record<ZTPPlatform, ZTPVendorProfile> = {
  nxos: {
    vendor: 'Cisco', platform: 'nxos', method: 'POAP',
    dhcpVendorClass: 'Cisco-POAP', bootProtocol: 'http',
    dhcpRedirect: 'option67-bootfile',
    notes: 'NX-OS PowerOn Auto Provisioning — DHCP option 67 → POAP python script.',
  },
  'ios-xe': {
    vendor: 'Cisco', platform: 'ios-xe', method: 'PnP',
    dhcpVendorClass: 'ciscopnp', bootProtocol: 'http',
    dhcpRedirect: 'option43-vendor',
    notes: 'IOS-XE Network Plug-and-Play — DHCP option 43 (5A;K4;B2;I<ip>;J80).',
  },
  iosxr: {
    vendor: 'Cisco', platform: 'iosxr', method: 'ZTP',
    dhcpVendorClass: 'PXEClient:Arch', bootProtocol: 'http',
    dhcpRedirect: 'option67-bootfile',
    notes: 'IOS-XR ZTP — DHCP option 67 → ztp.script (bash/python).',
  },
  eos: {
    vendor: 'Arista', platform: 'eos', method: 'eZTP',
    dhcpVendorClass: 'Arista', bootProtocol: 'http',
    dhcpRedirect: 'option67-bootfile',
    notes: 'Arista ZTP — DHCP option 67 → bootstrap script; CloudVision Studios capable.',
  },
  junos: {
    vendor: 'Juniper', platform: 'junos', method: 'ZTP',
    dhcpVendorClass: 'Juniper', bootProtocol: 'http',
    dhcpRedirect: 'option43-vendor',
    notes: 'Junos ZTP — DHCP options 43 (sub-opt 00 image, 01 config) + 150/66.',
  },
  srl: {
    vendor: 'Nokia', platform: 'srl', method: 'ZTP',
    dhcpVendorClass: 'Nokia-SRLinux', bootProtocol: 'http',
    dhcpRedirect: 'option67-bootfile',
    notes: 'Nokia SR Linux ZTP — DHCP option 67 → provisioning JSON; gNMI day-N.',
  },
  cumulus: {
    vendor: 'NVIDIA', platform: 'cumulus', method: 'ZTP',
    dhcpVendorClass: 'cumulus-linux', bootProtocol: 'http',
    dhcpRedirect: 'option239-script',
    notes: 'NVIDIA Cumulus Linux ZTP — DHCP option 239 → ZTP shell script.',
  },
  dellos10: {
    vendor: 'Dell EMC', platform: 'dellos10', method: 'ZTP',
    dhcpVendorClass: 'Dell-OS10', bootProtocol: 'http',
    dhcpRedirect: 'option67-bootfile',
    notes: 'Dell OS10 ZTD — DHCP option 67 → config/script; SmartFabric capable.',
  },
  fortios: {
    vendor: 'Fortinet', platform: 'fortios', method: 'FortiZTP',
    dhcpVendorClass: 'FortiGate', bootProtocol: 'https',
    dhcpRedirect: 'dns-srv',
    notes: 'FortiZTP cloud provisioning — device calls FortiZTP/FortiManager by serial.',
  },
  arubaoscx: {
    vendor: 'HPE Aruba', platform: 'arubaoscx', method: 'Aruba-ZTP',
    dhcpVendorClass: 'ArubaInstantOn', bootProtocol: 'https',
    dhcpRedirect: 'dns-srv',
    notes: 'Aruba Central / Activate ZTP — device phones home to Activate by serial/MAC.',
  },
  exos: {
    vendor: 'Extreme Networks', platform: 'exos', method: 'ZTP+',
    dhcpVendorClass: 'Extreme', bootProtocol: 'https',
    dhcpRedirect: 'dns-srv',
    notes: 'Extreme ZTP+ — device discovered by XIQ / Extreme Management Center.',
  },
  panos: {
    vendor: 'Palo Alto', platform: 'panos', method: 'Panorama-ZTP',
    dhcpVendorClass: 'PaloAltoNetworks', bootProtocol: 'https',
    dhcpRedirect: 'dns-srv',
    notes: 'PAN-OS ZTP — firewall registers to the ZTP service, claimed by Panorama.',
  },
}

// ── Device identification ──────────────────────────────────────────────────

export interface ZTPIdentity {
  /** BOM device id (stable key). */
  id: string
  hostname: string
  vendor: string
  model: string
  /** Normalised device role (spine, leaf, distribution, access, wan-edge,
   *  firewall, core, …) derived from the BOM subLayer. */
  role: string
  /** Human role label including the fabric tier, e.g. "DC Spine". */
  roleLabel: string
  platform: ZTPPlatform
  method: ZTPMethod
  dhcpVendorClass: string
  bootProtocol: 'http' | 'https' | 'tftp'
  dhcpRedirect: string
  /** Relative boot-file path the DHCP server hands the device. */
  bootFile: string
}

const RE_NXOS = /nexus|\bn9k|\bn3k|\bn5k|\bn7k|nx-?os|3232c|93108|93180|9336|9364|9500-32/i
const RE_IOSXR = /asr ?9|\bncs\b|\bcrs\b|xrv|ios-?xr|8201|8202/i

/** Resolve the ZTP platform key for a device — Cisco is model-dependent. */
export function ztpPlatform(dev: BOMDevice): ZTPPlatform {
  const v = dev.vendor
  const m = dev.model ?? ''
  if (v === 'Cisco') {
    if (RE_IOSXR.test(m)) return 'iosxr'
    if (RE_NXOS.test(m)) return 'nxos'
    return 'ios-xe'           // Catalyst / ISR / FTD-as-IOS-XE etc.
  }
  if (v === 'Arista') return 'eos'
  if (v === 'Juniper') return 'junos'
  if (v === 'Nokia') return 'srl'
  if (v === 'NVIDIA') return 'cumulus'
  if (v === 'Dell EMC') return 'dellos10'
  if (v === 'Fortinet') return 'fortios'
  if (v === 'HPE Aruba') return 'arubaoscx'
  if (v === 'Extreme Networks') return 'exos'
  if (v === 'Palo Alto') return 'panos'
  // Unknown vendor → assume a generic ZTP-capable NOS (option-67 bootfile).
  return 'ios-xe'
}

const ROLE_LABELS: Record<string, string> = {
  spine: 'Spine', leaf: 'Leaf / ToR', 'super-spine': 'Super-Spine',
  distribution: 'Distribution', access: 'Access', core: 'Core',
  'wan-edge': 'WAN Edge', firewall: 'Firewall', 'sdwan-controller': 'SD-WAN Controller',
}

/** Normalise the BOM subLayer into a ZTP role + label. */
export function ztpRole(dev: BOMDevice): { role: string; label: string } {
  const role = (dev.subLayer || dev.role || 'access').toLowerCase()
  return { role, label: ROLE_LABELS[role] ?? role.replace(/(^|-)\w/g, s => s.toUpperCase()) }
}

/** Boot-file path the DHCP server hands a device of this platform. */
export function ztpBootFile(platform: ZTPPlatform, hostname: string): string {
  const safe = hostname.replace(/[^A-Za-z0-9-]/g, '-') || 'device'
  switch (platform) {
    case 'nxos':     return 'scripts/nxos_poap.py'
    case 'ios-xe':   return 'scripts/ios_xe_pnp.py'
    case 'iosxr':    return 'scripts/iosxr_ztp.sh'
    case 'eos':      return 'scripts/eos_ztp.sh'
    case 'junos':    return 'scripts/junos_ztp.slax'
    case 'srl':      return `configs/${safe}.json`
    case 'cumulus':  return 'scripts/cumulus_ztp.sh'
    case 'dellos10': return 'scripts/os10_ztd.py'
    // Cloud-claimed platforms boot off their cloud service, not a TFTP file.
    case 'fortios':
    case 'arubaoscx':
    case 'exos':
    case 'panos':    return `configs/${safe}.cfg`
    default:         return `configs/${safe}.cfg`
  }
}

/** Identify a device fully for ZTP: vendor, hardware, role, mechanism. */
export function identifyDevice(dev: BOMDevice): ZTPIdentity {
  const platform = ztpPlatform(dev)
  const profile = ZTP_VENDOR_PROFILES[platform]
  const { role, label } = ztpRole(dev)
  return {
    id: dev.id,
    hostname: dev.hostname || `${dev.vendor}-${role}`.toUpperCase(),
    vendor: dev.vendor,
    model: dev.model,
    role,
    roleLabel: label,
    platform,
    method: profile.method,
    dhcpVendorClass: profile.dhcpVendorClass,
    bootProtocol: profile.bootProtocol,
    dhcpRedirect: profile.dhcpRedirect,
    bootFile: ztpBootFile(platform, dev.hostname || dev.id),
  }
}

// ── Day-0 management-plane bootstrap ───────────────────────────────────────
// Per CLAUDE.md §11: Day-0 is the MANAGEMENT PLANE ONLY — mgmt IP + gateway,
// SSH v2, NTP, syslog, LLDP, hostname, local credentials, callback URL.
// NO BGP / VLANs / VXLAN / ACLs — those come in the Day-N production push.

export interface Day0Opts {
  mgmtIp?: string
  mgmtGw?: string
  ntp?: string
  syslog?: string
  callbackUrl?: string
}

const D: Required<Day0Opts> = {
  mgmtIp: '<CHANGE-ME-mgmt-ip>',
  mgmtGw: '<CHANGE-ME-mgmt-gw>',
  ntp: '<CHANGE-ME-ntp-ip>',
  syslog: '<CHANGE-ME-syslog-ip>',
  callbackUrl: '<CHANGE-ME-ztp-callback-url>',
}

function header(id: ZTPIdentity, comment: string): string {
  return [
    `${comment} ═══════════════════════════════════════════════════════════`,
    `${comment} Device   : ${id.hostname}`,
    `${comment} Role     : ${id.roleLabel}`,
    `${comment} Model    : ${id.model} (${id.vendor})`,
    `${comment} Platform : ${id.platform}  ·  ZTP: ${id.method}`,
    `${comment} DAY-0 MANAGEMENT-PLANE BOOTSTRAP — no production config here.`,
    `${comment} Generated by NetDesign AI ZTP — replace <CHANGE-ME-*>.`,
    `${comment} ═══════════════════════════════════════════════════════════`,
  ].join('\n')
}

export function generateDay0Config(id: ZTPIdentity, opts: Day0Opts = {}): string {
  const o = { ...D, ...opts }
  switch (id.platform) {
    case 'nxos':
      return `${header(id, '!')}
hostname ${id.hostname}
feature ssh
feature lldp
no feature telnet
username admin password <CHANGE-ME-admin-password> role network-admin
vrf context management
  ip route 0.0.0.0/0 ${o.mgmtGw}
interface mgmt0
  vrf member management
  ip address ${o.mgmtIp}/24
  no shutdown
ntp server ${o.ntp} use-vrf management
logging server ${o.syslog} 6 use-vrf management
! ZTP callback: ${o.callbackUrl}
`
    case 'ios-xe':
      return `${header(id, '!')}
hostname ${id.hostname}
ip domain name ztp.local
crypto key generate rsa modulus 2048
ip ssh version 2
username admin privilege 15 secret <CHANGE-ME-admin-password>
line vty 0 4
 transport input ssh
 login local
vrf definition Mgmt-intf
 address-family ipv4
interface GigabitEthernet0
 vrf forwarding Mgmt-intf
 ip address ${o.mgmtIp} 255.255.255.0
 no shutdown
ip route vrf Mgmt-intf 0.0.0.0 0.0.0.0 ${o.mgmtGw}
ntp server ${o.ntp}
logging host ${o.syslog}
! PnP/ZTP callback: ${o.callbackUrl}
`
    case 'iosxr':
      return `${header(id, '!')}
hostname ${id.hostname}
ssh server v2
username admin group root-lr secret <CHANGE-ME-admin-password>
interface MgmtEth0/RP0/CPU0/0
 ipv4 address ${o.mgmtIp} 255.255.255.0
 no shutdown
router static vrf default address-family ipv4 unicast 0.0.0.0/0 ${o.mgmtGw}
ntp server ${o.ntp}
logging ${o.syslog}
! ZTP callback: ${o.callbackUrl}
commit
`
    case 'eos':
      return `${header(id, '!')}
hostname ${id.hostname}
username admin privilege 15 role network-admin secret <CHANGE-ME-admin-password>
management ssh
 no shutdown
interface Management1
 ip address ${o.mgmtIp}/24
 no shutdown
ip route vrf MGMT 0.0.0.0/0 ${o.mgmtGw}
ntp server ${o.ntp}
logging host ${o.syslog}
! eZTP callback: ${o.callbackUrl}
`
    case 'junos':
      return `${header(id, '#')}
set system host-name ${id.hostname}
set system root-authentication encrypted-password "<CHANGE-ME-admin-password>"
set system login user admin class super-user authentication encrypted-password "<CHANGE-ME-admin-password>"
set system services ssh protocol-version v2
set interfaces fxp0 unit 0 family inet address ${o.mgmtIp}/24
set routing-options static route 0.0.0.0/0 next-hop ${o.mgmtGw}
set system ntp server ${o.ntp}
set system syslog host ${o.syslog} any info
# ZTP callback: ${o.callbackUrl}
`
    case 'srl':
      return `${header(id, '#')}
set / system name host-name ${id.hostname}
set / system aaa authentication admin-user password <CHANGE-ME-admin-password>
set / system ssh-server admin-state enable
set / system gnmi-server admin-state enable network-instance mgmt
set / interface mgmt0 admin-state enable subinterface 0 ipv4 address ${o.mgmtIp}/24
set / network-instance mgmt interface mgmt0.0
set / network-instance mgmt static-routes route 0.0.0.0/0 next-hop-group mgmt-gw
set / system ntp server ${o.ntp}
set / system logging remote-server ${o.syslog}
# ZTP callback (gNMI day-N): ${o.callbackUrl}
`
    case 'cumulus':
      return `${header(id, '#')}
# NVIDIA Cumulus Linux — Day-0 (NCLU)
# Admin password set by the ZTP script: usermod → <CHANGE-ME-admin-password>
net add hostname ${id.hostname}
net add interface eth0 ip address ${o.mgmtIp}/24
net add interface eth0 ip gateway ${o.mgmtGw}
net add time ntp server ${o.ntp} iburst
net add syslog host ${o.syslog}
net add ssh-server
net commit
# ZTP callback: ${o.callbackUrl}
`
    case 'dellos10':
      return `${header(id, '!')}
hostname ${id.hostname}
username admin password <CHANGE-ME-admin-password> role sysadmin
ip ssh server enable
interface mgmt 1/1/1
 no shutdown
 ip address ${o.mgmtIp}/24
management route 0.0.0.0/0 ${o.mgmtGw}
ntp server ${o.ntp}
logging server ${o.syslog}
! ZTD callback: ${o.callbackUrl}
`
    case 'fortios':
      return `${header(id, '#')}
config system global
  set hostname "${id.hostname}"
  set admin-ssh-v1 disable
end
config system admin
  edit "admin"
    set password <CHANGE-ME-admin-password>
  next
end
config system interface
  edit "mgmt"
    set ip ${o.mgmtIp}/24
    set allowaccess ping https ssh
  next
end
config router static
  edit 1
    set gateway ${o.mgmtGw}
    set device "mgmt"
  next
end
config system ntp
  set ntpsync enable
  config ntpserver
    edit 1
      set server "${o.ntp}"
    next
  end
end
config log syslogd setting
  set status enable
  set server "${o.syslog}"
end
# FortiZTP callback: ${o.callbackUrl}
`
    case 'arubaoscx':
      return `${header(id, '!')}
hostname ${id.hostname}
user admin group administrators password plaintext <CHANGE-ME-admin-password>
ssh server vrf mgmt
interface mgmt
 no shutdown
 ip static ${o.mgmtIp}/24
 default-gateway ${o.mgmtGw}
ntp server ${o.ntp}
logging ${o.syslog} vrf mgmt
! Aruba Central/Activate callback: ${o.callbackUrl}
`
    case 'exos':
      return `${header(id, '#')}
configure snmp sysName "${id.hostname}"
create account admin admin encrypted "<CHANGE-ME-admin-password>"
configure vlan Mgmt ipaddress ${o.mgmtIp}/24
configure iproute add default ${o.mgmtGw} vr VR-Mgmt
enable ssh2
disable telnet
configure ntp server add ${o.ntp} vr VR-Mgmt
enable ntp
configure syslog add ${o.syslog}:514 vr VR-Mgmt local0
enable syslog
# ZTP+ callback (XIQ): ${o.callbackUrl}
`
    case 'panos':
      return `${header(id, '#')}
set deviceconfig system hostname ${id.hostname}
set mgt-config users admin permissions role-based superuser yes
set mgt-config users admin password <CHANGE-ME-admin-password>
set deviceconfig system ip-address ${o.mgmtIp} netmask 255.255.255.0 default-gateway ${o.mgmtGw}
set deviceconfig system service disable-ssh no
set deviceconfig system ntp-servers primary-ntp-server ntp-server-address ${o.ntp}
set deviceconfig system server-verification yes
set shared log-settings syslog ZTP server ${o.syslog}
# Panorama ZTP callback: ${o.callbackUrl}
`
    default:
      return `${header(id, '#')}\n# No Day-0 template for platform ${id.platform}\n`
  }
}

// ── DHCP server config (multi-vendor, option-60 aware) ─────────────────────

export interface DhcpOpts {
  ztpServerIp?: string
  gateway?: string
  dns?: string
  subnet?: string
  subnetMask?: string
  domainName?: string
  leaseTime?: number
}

/**
 * Generate an ISC dhcpd.conf fragment that classifies booting devices by
 * their DHCP option-60 vendor-class and serves the correct per-vendor boot
 * file — the core of true multi-vendor ZTP. Devices with a known MAC also get
 * a fixed-address host stanza so they receive their planned mgmt IP.
 */
export function generateDhcpConfig(ids: ZTPIdentity[], opts: DhcpOpts = {}): string {
  const o = {
    ztpServerIp: opts.ztpServerIp ?? '<CHANGE-ME-ztp-server-ip>',
    gateway: opts.gateway ?? '<CHANGE-ME-mgmt-gw>',
    dns: opts.dns ?? '<CHANGE-ME-dns-ip>',
    subnet: opts.subnet ?? '10.100.0.0',
    subnetMask: opts.subnetMask ?? '255.255.255.0',
    domainName: opts.domainName ?? 'ztp.local',
    leaseTime: opts.leaseTime ?? 600,
  }

  const lines: string[] = [
    '# ── NetDesign AI — Multi-vendor ZTP DHCP config ────────────────────────',
    '# ISC DHCP. Classifies devices by option 60 (vendor-class-identifier) and',
    '# serves the correct boot file per vendor. Include from dhcpd.conf.',
    'option space ztp;',
    'option ztp-encap code 43 = encapsulated ztp;',
    '',
  ]

  // One class per distinct vendor-class present in the plan.
  const byClass = new Map<string, ZTPIdentity>()
  for (const id of ids) if (!byClass.has(id.dhcpVendorClass)) byClass.set(id.dhcpVendorClass, id)

  for (const [vclass, sample] of byClass) {
    const safe = vclass.replace(/[^A-Za-z0-9]/g, '-')
    lines.push(`# ${sample.vendor} (${sample.platform}, ${sample.method})`)
    lines.push(`class "${safe}" {`)
    lines.push(`  match if substring(option vendor-class-identifier, 0, ${vclass.length}) = "${vclass}";`)
    if (sample.dhcpRedirect === 'option43-vendor') {
      lines.push(`  # ${sample.vendor} uses option 43 vendor-encapsulated redirect`)
      if (sample.platform === 'ios-xe') {
        lines.push(`  option vendor-class-identifier "ciscopnp";`)
        lines.push(`  option vendor-encapsulated-options "5A;K4;B2;I${o.ztpServerIp};J80";`)
      } else {
        lines.push(`  option vendor-encapsulated-options "01:04:${o.ztpServerIp}";`)
      }
    }
    lines.push(`  filename "${ztpBootFile(sample.platform, 'device')}";`)
    lines.push(`  next-server ${o.ztpServerIp};`)
    lines.push('}')
    lines.push('')
  }

  lines.push(`subnet ${o.subnet} netmask ${o.subnetMask} {`)
  lines.push(`  option routers ${o.gateway};`)
  lines.push(`  option domain-name-servers ${o.dns};`)
  lines.push(`  option domain-name "${o.domainName}";`)
  lines.push(`  default-lease-time ${o.leaseTime};`)
  lines.push(`  max-lease-time ${o.leaseTime * 2};`)
  lines.push(`  next-server ${o.ztpServerIp};`)
  lines.push(`  pool { range ${rangeFrom(o.subnet)}; }`)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function rangeFrom(subnet: string): string {
  const parts = subnet.split('.')
  if (parts.length !== 4) return '10.100.0.50 10.100.0.250'
  const base = `${parts[0]}.${parts[1]}.${parts[2]}`
  return `${base}.50 ${base}.250`
}

// ── Full provisioning plan ─────────────────────────────────────────────────

export interface ZTPPlanEntry {
  identity: ZTPIdentity
  /** Day-0 management-plane bootstrap config. */
  day0: string
  /** Whether a Day-N production config exists for this device. */
  hasDayN: boolean
  /** The Day-N production config id (BOM device id) to push after VERIFIED. */
  dayNConfigId: string | null
}

export interface ZTPPlan {
  entries: ZTPPlanEntry[]
  summary: {
    total: number
    byVendor: Record<string, number>
    byMethod: Record<string, number>
    byRole: Record<string, number>
    withDayN: number
  }
}

/**
 * Build the end-to-end ZTP plan: identify every device, generate its Day-0
 * bootstrap, and pair it with the correct Day-N production config (matched by
 * BOM id in `configs` from `generateAllConfigs`). This is "push the right
 * config" — each identified device is bound to its own role-correct config.
 */
export function buildZTPPlan(
  devices: BOMDevice[],
  configs: Record<string, string> = {},
  day0Opts: Day0Opts = {},
): ZTPPlan {
  const entries: ZTPPlanEntry[] = []
  const byVendor: Record<string, number> = {}
  const byMethod: Record<string, number> = {}
  const byRole: Record<string, number> = {}
  let withDayN = 0

  for (const dev of devices) {
    const identity = identifyDevice(dev)
    const dayN = configs[dev.id]
    const hasDayN = typeof dayN === 'string' && dayN.trim().length > 0
    if (hasDayN) withDayN++
    byVendor[identity.vendor] = (byVendor[identity.vendor] ?? 0) + 1
    byMethod[identity.method] = (byMethod[identity.method] ?? 0) + 1
    byRole[identity.roleLabel] = (byRole[identity.roleLabel] ?? 0) + 1
    entries.push({
      identity,
      day0: generateDay0Config(identity, day0Opts),
      hasDayN,
      dayNConfigId: hasDayN ? dev.id : null,
    })
  }

  return {
    entries,
    summary: {
      total: entries.length,
      byVendor, byMethod, byRole,
      withDayN,
    },
  }
}

/** Export the plan as a provisioning manifest CSV (one row per device). */
export function ztpPlanToCsv(plan: ZTPPlan): string {
  const rows = ['hostname,vendor,model,role,platform,ztp_method,dhcp_vendor_class,boot_file,has_day_n']
  for (const e of plan.entries) {
    const i = e.identity
    rows.push([
      i.hostname, i.vendor, i.model, i.roleLabel, i.platform, i.method,
      i.dhcpVendorClass, i.bootFile, e.hasDayN ? 'yes' : 'no',
    ].map(csv).join(','))
  }
  return rows.join('\n')
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
