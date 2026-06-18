import type { BOMDevice } from '@/types'

// ── IPAM data model ──────────────────────────────────────────────────────────
// Canonical IP / VLAN / VNI planning, derived from the BOM + intent. This is
// the single source of truth for the Step 4 "IP Plan" / "VLAN & VNI" tabs and
// for the NetBox-importable CSV export below (NetBox/Nautobot parity, IPAM).

export interface IPBlock { label: string; subnet: string; detail: string; range: string }
export interface IPRow { device: string; layer: string; iface: string; ip: string; prefix: string; purpose: string }
export interface VLANRow { id: number; name: string; subnet: string; gw: string; dhcp: string; purpose: string; layer: string }
export interface VNIRow { vni: number; vlan: string; type: string; vrf: string; irb: string; rt: string }

// ── Aggregate prefix plan ────────────────────────────────────────────────────

export function genIPBlocks(useCase: string, totalEndpoints: number, numSites: number, devices: BOMDevice[]): IPBlock[] {
  const isDC    = useCase === 'dc' || useCase === 'multisite'
  const isGPU   = useCase === 'gpu'
  const nSpines = devices.filter(d => d.subLayer === 'spine').length
  const nLeaves = devices.filter(d => d.subLayer === 'leaf').length
  const nDist   = devices.filter(d => d.subLayer === 'distribution').length
  const nAccess = devices.filter(d => d.subLayer === 'access').length
  const totalInfra = devices.length

  const p2pTotal = isDC ? nLeaves * nSpines : nAccess + nDist
  const p2pPrefix = p2pTotal <= 256 ? '/23' : '/21'

  const blocks: IPBlock[] = [
    { label: 'MANAGEMENT OOB',   subnet: '10.0.0.0/24',  detail: `VLAN 10 · ${totalInfra} network devices across ${numSites} site(s)`, range: `10.0.0.1 – 10.0.0.${Math.min(totalInfra + 1, 254)}` },
    { label: 'LOOPBACKS',        subnet: '10.255.0.0/24',detail: `/32 per device · ${totalInfra} addresses needed`, range: `10.255.0.1 – 10.255.0.${Math.min(totalInfra, 254)}` },
    { label: 'P2P FABRIC LINKS', subnet: `10.100.0.0${p2pPrefix}`, detail: `/31 per link · ${p2pTotal} links`, range: `10.100.0.0 – covers ${p2pTotal} /31 pairs` },
    { label: 'CORPORATE DATA',   subnet: '10.10.0.0/22', detail: `VLAN 20 · ${totalEndpoints || 0} endpoints`, range: '10.10.0.1 – 10.10.3.254 (1022 hosts)' },
    { label: 'VOICE / UC',       subnet: '10.20.0.0/23', detail: 'VLAN 30 · IP Phones, UC', range: '10.20.0.1 – 10.20.1.254 (510 hosts)' },
    { label: 'SERVER / DMZ',     subnet: '10.50.0.0/22', detail: 'VLAN 50/60 · Physical & VM servers', range: '10.50.0.1 – 10.50.3.254 (1022 hosts)' },
    { label: 'IoT / GUEST',      subnet: '10.60.0.0/23', detail: 'VLAN 61/21 · Isolated · internet-only ACL', range: '10.60.0.1 – 10.60.1.254 (510 hosts)' },
  ]

  if (isDC) {
    blocks.push({ label: `DC UNDERLAY /31 (${nLeaves} leaf × ${nSpines} spine = ${nLeaves * nSpines} links)`, subnet: '10.1.0.0/20', detail: `P2P /31 links · ECMP · BFD`, range: `10.1.0.0 – covers ${nLeaves * nSpines} /31 pairs` })
    blocks.push({ label: 'DC OVERLAY — VXLAN tenant subnets', subnet: '10.200.0.0/14', detail: `VXLAN VNI space · PROD/STOR/DEV tenants · ${nLeaves} VTEPs`, range: '10.200.0.0 – 10.203.255.255 (262K hosts)' })
  }
  if (isGPU) {
    blocks.push({ label: `GPU COMPUTE fabric`, subnet: '192.168.100.0/22', detail: `RoCEv2 RDMA fabric · lossless · PFC priority 3`, range: '192.168.100.1 – 192.168.103.254' })
    blocks.push({ label: 'STORAGE — NVMe-oF / GPUDirect', subnet: '192.168.200.0/23', detail: 'NVMe-oF storage fabric · GPUDirect RDMA', range: '192.168.200.1 – 192.168.201.254' })
  }
  return blocks
}

// ── Per-device IP allocations ────────────────────────────────────────────────

export function genIPRows(_useCase: string, devices: BOMDevice[]): IPRow[] {
  const rows: IPRow[] = []
  const spines = devices.filter(d => d.subLayer === 'spine')
  const leaves = devices.filter(d => d.subLayer === 'leaf')
  const dists  = devices.filter(d => d.subLayer === 'distribution')
  const access = devices.filter(d => d.subLayer === 'access')
  const fws    = devices.filter(d => d.subLayer === 'firewall')

  fws.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Firewall', iface: 'Loopback0', ip: `10.255.0.${i + 1}`, prefix: '/32', purpose: 'Router-ID / BGP peering' })
    rows.push({ device: d.hostname, layer: 'Firewall', iface: 'Gi0/0', ip: `10.0.0.${i + 1}`, prefix: '/30', purpose: 'Outside / Internet uplink' })
  })

  spines.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Spine', iface: 'Loopback0', ip: `10.255.1.${i + 1}`, prefix: '/32', purpose: `BGP Router-ID · spine ${i + 1} of ${spines.length}` })
  })

  const showLeaves = leaves.slice(0, 10)
  showLeaves.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Leaf', iface: 'Loopback0', ip: `10.255.2.${i + 1}`, prefix: '/32', purpose: `BGP Router-ID · leaf ${i + 1} of ${leaves.length}` })
    rows.push({ device: d.hostname, layer: 'Leaf', iface: 'Loopback1 (VTEP)', ip: `10.255.3.${i + 1}`, prefix: '/32', purpose: 'VXLAN NVE source (anycast)' })
  })
  if (leaves.length > 10) {
    rows.push({ device: `… +${leaves.length - 10} more`, layer: 'Leaf', iface: '—', ip: `10.255.2.11 – 10.255.2.${leaves.length}`, prefix: '/32', purpose: 'Same scheme continues' })
  }

  dists.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Distribution', iface: 'Loopback0', ip: `10.255.0.${20 + i}`, prefix: '/32', purpose: `Router-ID · device ${i + 1} of ${dists.length}` })
  })

  const showAccess = access.slice(0, 8)
  showAccess.forEach((d, i) => {
    rows.push({ device: d.hostname, layer: 'Access', iface: 'Vlan10', ip: `10.0.0.${31 + i}`, prefix: '/24', purpose: 'OOB management' })
  })
  if (access.length > 8) {
    rows.push({ device: `… +${access.length - 8} more`, layer: 'Access', iface: 'Vlan10', ip: `10.0.0.${31 + 8} – .${Math.min(30 + access.length, 254)}`, prefix: '/24', purpose: 'OOB management — same scheme' })
  }

  return rows
}

// ── VLAN / VNI plan ──────────────────────────────────────────────────────────

export function genVLANs(useCase: string): VLANRow[] {
  const isDC = useCase === 'dc' || useCase === 'multisite' || useCase === 'gpu'
  const base: VLANRow[] = [
    { id: 10,  name: 'MGMT',          subnet: '10.0.0.0/24',   gw: '10.0.0.1',   dhcp: '10.0.0.10–250',   purpose: 'Network device OOB management',  layer: 'mgmt'  },
    { id: 20,  name: 'CORP-DATA',     subnet: '10.10.0.0/22',  gw: '10.10.0.1',  dhcp: '10.10.0.10–1000', purpose: 'Corporate user endpoints',        layer: 'access'},
    { id: 21,  name: 'GUEST',         subnet: '10.11.0.0/23',  gw: '10.11.0.1',  dhcp: '10.11.0.10–500',  purpose: 'Guest / BYOD (internet only)',    layer: 'access'},
    { id: 30,  name: 'VOICE',         subnet: '10.20.0.0/23',  gw: '10.20.0.1',  dhcp: '10.20.0.10–500',  purpose: 'IP Telephony / UC',               layer: 'dist'  },
    { id: 40,  name: 'WIRELESS-CORP', subnet: '10.30.0.0/22',  gw: '10.30.0.1',  dhcp: '10.30.0.10–1000', purpose: 'Corporate SSID (802.1X)',         layer: 'access'},
    { id: 50,  name: 'SERVER-FARM',   subnet: '10.50.0.0/22',  gw: '10.50.0.1',  dhcp: 'Static only',     purpose: 'Physical & VM servers',          layer: 'dist'  },
    { id: 60,  name: 'DMZ',           subnet: '10.60.0.0/24',  gw: '10.60.0.1',  dhcp: 'Static only',     purpose: 'Internet-facing / public SVC',   layer: 'fw'    },
    { id: 99,  name: 'NATIVE-TRUNK',  subnet: '—',             gw: '—',          dhcp: '—',               purpose: 'Native VLAN on trunk links',     layer: 'mgmt'  },
  ]
  if (isDC) {
    base.push({ id: 100, name: 'DC-TENANT-A', subnet: '10.200.0.0/22', gw: '10.200.0.1', dhcp: 'Dynamic', purpose: 'DC tenant A (VNI 100000)', layer: 'leaf' })
    base.push({ id: 101, name: 'DC-TENANT-B', subnet: '10.200.4.0/22', gw: '10.200.4.1', dhcp: 'Dynamic', purpose: 'DC tenant B (VNI 100001)', layer: 'leaf' })
    base.push({ id: 200, name: 'DC-STORAGE',  subnet: '10.201.0.0/22', gw: '10.201.0.1', dhcp: 'Static',  purpose: 'Storage network (iSCSI/NFS)', layer: 'dist' })
  }
  return base
}

export function genVNIs(): VNIRow[] {
  return [
    { vni: 100000, vlan: '100', type: 'L2',       vrf: 'TENANT-A', irb: '10.200.0.1/22',   rt: '65000:100'  },
    { vni: 100001, vlan: '101', type: 'L2',       vrf: 'TENANT-B', irb: '10.200.4.1/22',   rt: '65000:101'  },
    { vni: 100050, vlan: '50',  type: 'L2',       vrf: 'DEFAULT',  irb: '10.50.0.1/22',    rt: '65000:50'   },
    { vni: 999000, vlan: '—',   type: 'L3 IP-VRF',vrf: 'TENANT-A', irb: 'Anycast 10.200.0.1', rt: '65000:9000' },
    { vni: 999001, vlan: '—',   type: 'L3 IP-VRF',vrf: 'TENANT-B', irb: 'Anycast 10.200.4.1', rt: '65000:9001' },
  ]
}

// ── NetBox-importable CSV export (IPAM source-of-truth sync) ──────────────────
// NetBox bulk CSV import uses headers matching model field names. These match
// NetBox 3.x / 4.x ipam.prefix, ipam.vlan and ipam.ipaddress importers.

/** Quote a CSV cell when it contains a comma, quote or newline (RFC 4180). */
function csvCell(value: string): string {
  const v = value ?? ''
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

/** True when a string is a single, importable CIDR (not a range or placeholder). */
function isCidr(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(s.trim())
}

/**
 * NetBox `ipam.prefix` import CSV. Aggregate plan blocks become `container`
 * prefixes (they're parent supernets carved into smaller subnets); per-VLAN
 * subnets become `active` prefixes carrying their VLAN id. Prefixes are
 * de-duplicated by CIDR (first occurrence wins).
 */
export function toNetBoxPrefixCsv(blocks: IPBlock[], vlans: VLANRow[]): string {
  const header = 'prefix,status,role,vlan_vid,description'
  const seen = new Set<string>()
  const lines: string[] = []

  for (const b of blocks) {
    if (!isCidr(b.subnet) || seen.has(b.subnet)) continue
    seen.add(b.subnet)
    lines.push(csvRow([b.subnet, 'container', 'infrastructure', '', b.label]))
  }
  for (const v of vlans) {
    if (!isCidr(v.subnet) || seen.has(v.subnet)) continue
    seen.add(v.subnet)
    lines.push(csvRow([v.subnet, 'active', v.layer, String(v.id), `${v.name} — ${v.purpose}`]))
  }
  return [header, ...lines].join('\n') + '\n'
}

/** NetBox `ipam.vlan` import CSV. */
export function toNetBoxVlanCsv(vlans: VLANRow[]): string {
  const header = 'vid,name,status,description'
  const lines = vlans.map(v => csvRow([String(v.id), v.name, 'active', v.purpose]))
  return [header, ...lines].join('\n') + '\n'
}

/**
 * NetBox `ipam.ipaddress` import CSV. Summary rows (ranges / "… +N more")
 * are skipped — only concrete per-device host/loopback addresses are emitted.
 */
export function toNetBoxIpAddressCsv(rows: IPRow[]): string {
  const header = 'address,status,dns_name,description'
  const lines: string[] = []
  for (const r of rows) {
    if (r.device.startsWith('…') || /[–-]\s/.test(r.ip) || !/^\d{1,3}(\.\d{1,3}){3}$/.test(r.ip.trim())) continue
    const address = `${r.ip}${r.prefix}`
    const dns = r.device.toLowerCase()
    lines.push(csvRow([address, 'active', dns, `${r.layer} ${r.iface} — ${r.purpose}`]))
  }
  return [header, ...lines].join('\n') + '\n'
}

export interface NetBoxIpamExport {
  prefixesCsv: string
  vlansCsv: string
  ipAddressesCsv: string
}

/** Build all three NetBox IPAM CSVs from the computed design. */
export function buildNetBoxIpamExport(
  useCase: string,
  totalEndpoints: number,
  numSites: number,
  devices: BOMDevice[],
): NetBoxIpamExport {
  const blocks = genIPBlocks(useCase, totalEndpoints, numSites, devices)
  const vlans  = genVLANs(useCase)
  const rows   = genIPRows(useCase, devices)
  return {
    prefixesCsv: toNetBoxPrefixCsv(blocks, vlans),
    vlansCsv: toNetBoxVlanCsv(vlans),
    ipAddressesCsv: toNetBoxIpAddressCsv(rows),
  }
}
