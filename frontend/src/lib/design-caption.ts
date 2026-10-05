/**
 * What the generated configs actually say, in words a diagram can show (AQ1,
 * AQ4). The HLD and the LLD both caption tiers and annotate nodes; reading
 * those words from the configs, in one place, is what keeps the diagrams from
 * drifting into claims the configs do not make — the HLD said "ISIS underlay"
 * for eBGP fabrics, the LLD said "eBGP underlay /31s" for IS-IS ones.
 */
import type { BOMDevice } from '@/types'
import { extractFacts, factPlatform, type DeviceFacts } from '@/lib/config-facts'
import { CAMPUS_VLANS, TENANT_OVERLAY } from '@/lib/configgen'
import { stripComments } from '@/lib/config-text'

/**
 * Configs with comments removed — whole-line comments AND trailing inline ones
 * (`dscp 34 traffic-class 5   ! TC5 (Storage lossless)`). Comments are never
 * configuration (Z6); without this a caption read "storage lossless class"
 * off an OS10 RoCE block's inline remark.
 */
export function codeOnlyConfigs(configs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(configs).map(([k, v]) =>
    // A Firepower's policy is declared in its FMC manifest, written as comment
    // lines because FTD policy is FMC-managed, not device CLI (X6/AN10).
    [k, v.includes('FMC POLICY MANIFEST') ? v
      : stripComments(v).split('\n').map(l => l.replace(/\s+[!#]\s.*$/, '')).join('\n')]))
}

/** The storage blocks' own names (G-A11 / Q7) — not the word "storage" anywhere. */
const RE_STORAGE = /STORAGE-(?:ISCSI|NVMEOF|FCOE|PFC|DSCP)|\bvsan \d+/

/** Facts for every device that has a config. */
export function designFacts(devices: BOMDevice[], configs: Record<string, string>): Map<string, DeviceFacts> {
  return new Map(devices.map(d => [d.id, extractFacts(configs[d.id] ?? '', factPlatform(d))]))
}

/** Read the BGP ASN a config declares, in any of the generated dialects. */
export function configAsn(cfg: string): string | undefined {
  const m = cfg.match(/^\s*router bgp (\d+)/m)
    ?? cfg.match(/^set routing-options autonomous-system (\d+)/m)
    ?? cfg.match(/^configure bgp AS-number (\d+)/m)
    ?? cfg.match(/^nv set router bgp autonomous-system (\d+)/m)
    ?? cfg.match(/^\s*autonomous-system (\d+)/m)
  return m?.[1]
}

/** The construct a config uses to pair two devices (AP5 / AN7 / AN10). */
export function pairTech(cfg: string): string | undefined {
  if (/^\s*vpc peer-link/m.test(cfg)) return 'vPC'
  if (/^mlag configuration/m.test(cfg) || /^create mlag peer/m.test(cfg)) return 'MLAG'
  if (/^vlt-domain /m.test(cfg)) return 'VLT'
  if (/esi \S+|ethernet-segment|evpn multihoming segment/.test(cfg)) return 'EVPN ESI'
  return undefined
}

export function fhrpKind(cfg: string): string | undefined {
  if (/^\s*standby \d+ ip /m.test(cfg)) return 'HSRP'
  if (/vrrp/i.test(cfg) || /ip virtual-router/.test(cfg) || /virtual-gateway-address/.test(cfg)) return 'VRRP'
  return undefined
}

/** Feature chips for a node, read from its own generated config (AQ1/AQ4). */
export function nodeFeatures(dev: BOMDevice, cfg: string, f: DeviceFacts | undefined, border: boolean): string[] {
  const out: string[] = []
  const on = (n: keyof DeviceFacts) => f?.[n]?.state === 'present'
  if (on('isis')) out.push('IS-IS')
  if (on('ospf')) out.push('OSPF')
  if (on('bgp')) out.push(/unnumbered/.test(cfg) ? 'eBGP unnumbered' : 'BGP')
  if (on('vxlan')) out.push('VXLAN VTEP')
  if (on('evpn')) out.push('EVPN')
  if (on('bfd')) out.push('BFD')
  if (on('jumboMtu')) out.push('Jumbo MTU')
  if (on('pfc')) out.push('PFC no-drop')
  if (on('ecnLossless')) out.push('ECN (RoCE)')
  const pt = pairTech(cfg)
  if (pt) out.push(`${pt} pair`)
  const fh = dev.subLayer === 'distribution' ? fhrpKind(cfg) : undefined
  if (fh) out.push(fh)
  if (/^\s*(ipv6 address|.*family inet6 address|nv set interface \S+ ip address [0-9a-f:]+\/|.*ipv6-unicast)/m.test(cfg)) out.push('IPv6 dual-stack')
  if (RE_STORAGE.test(cfg) && dev.subLayer === 'leaf') out.push('Storage lossless class')
  if (/dot1x|authentication port-control|802\.1X/i.test(cfg) && dev.subLayer === 'access') out.push('802.1X')
  if (/high-availability|chassis cluster|config system ha|failover/i.test(cfg) && dev.subLayer === 'firewall') out.push('HA cluster')
  if (border) out.push('Firewall handoff (border leaf)')
  if (dev.subLayer.startsWith('cloud-')) out.push('Provisioned by Terraform')
  return out
}

/**
 * Caption for designs with no switching fabric — WAN, multi-cloud, O-RAN —
 * read from the edge / RAN configs. The store's underlay selection is shown
 * only when no device has a config at all, and is labelled as a selection.
 */
export function transportCaption(devs: BOMDevice[], facts: Map<string, DeviceFacts>, configs: Record<string, string>, fallback: string): string {
  const net = devs.filter(d => !d.subLayer.startsWith('cloud-') && configs[d.id])
  const parts: string[] = []
  if (devs.some(d => d.subLayer.startsWith('cloud-'))) parts.push('Cloud transit (Terraform)')
  if (!net.length) return parts.join(' · ') || fallback
  const text = net.map(d => configs[d.id]).join('\n')
  const has = (n: keyof DeviceFacts) => net.some(d => facts.get(d.id)?.[n]?.state === 'present')
  if (/tunnel mode sdwan|^\s*sdwan\b|^\s*omp\b|vbond/m.test(text)) parts.push('SD-WAN overlay (OMP · IPsec)')
  if (has('isis')) parts.push(/segment-routing|prefix-sid/.test(text) ? 'IS-IS + Segment Routing' : 'IS-IS')
  else if (has('ospf')) parts.push('OSPF')
  if (has('bgp') && !parts.some(p => p.startsWith('SD-WAN'))) parts.push('BGP')
  if (/\bptp\b/i.test(text)) parts.push('PTP timing')
  return parts.join(' · ') || fallback
}

/** One-line protocol summary of the fabric, from the configs (never the selection). */
export function fabricCaption(devs: BOMDevice[], facts: Map<string, DeviceFacts>, configs: Record<string, string>, fallback: string): string {
  const fab = devs.filter(d => ['spine', 'leaf', 'core', 'distribution'].includes(d.subLayer))
  if (!fab.length) return transportCaption(devs, facts, configs, fallback)
  const has = (n: keyof DeviceFacts) => fab.some(d => facts.get(d.id)?.[n]?.state === 'present')
  const parts: string[] = []
  if (has('isis')) parts.push('IS-IS underlay')
  else if (has('ospf')) parts.push('OSPF')
  else if (has('bgp')) parts.push(fab.some(d => /unnumbered/.test(configs[d.id] ?? '')) ? 'eBGP unnumbered (RFC 7938)' : 'eBGP underlay')
  if (has('vxlan') && has('evpn')) parts.push('VXLAN/EVPN overlay')
  else if (fab.some(d => d.subLayer === 'spine') && has('bgp')) parts.push('pure L3 fabric')
  if (has('pfc')) parts.push('RoCEv2 lossless (PFC · ECN)')
  const fh = fab.map(d => d.subLayer === 'distribution' ? fhrpKind(configs[d.id] ?? '') : undefined).find(Boolean)
  if (fh) parts.push(`${fh} first hop`)
  return parts.join(' · ') || fallback
}

/**
 * One-line caption for a tier, read from the configs of the devices in it.
 * Returns undefined when the tier has no devices or no config to read.
 */
export function tierCaption(
  sub: string, devices: BOMDevice[], configs: Record<string, string>, facts: Map<string, DeviceFacts>,
): string | undefined {
  const tier = devices.filter(d => d.subLayer === sub && configs[d.id])
  if (!tier.length) return undefined
  const text = tier.map(d => configs[d.id]).join('\n')
  const has = (n: keyof DeviceFacts) => tier.some(d => facts.get(d.id)?.[n]?.state === 'present')
  const underlay = has('isis') ? 'IS-IS underlay'
    : has('ospf') ? 'OSPF'
    : has('bgp') ? (/unnumbered/.test(text) ? 'eBGP unnumbered (RFC 7938)' : 'eBGP underlay /31s') : undefined
  const parts: string[] = []
  const t = TENANT_OVERLAY
  switch (sub) {
    case 'firewall': {
      const peers = devices.some(d => d.subLayer === 'leaf') ? 'the border leaves' : 'the distribution pair'
      parts.push(/high-availability|chassis cluster|config system ha|failover/i.test(text) ? 'Firewall HA cluster' : 'Firewalls')
      parts.push(`transit VLAN /29 handoff to ${peers}`)
      break
    }
    case 'spine':
      if (underlay) parts.push(underlay)
      parts.push(has('evpn') ? 'EVPN route exchange (not a VTEP)' : 'pure L3 · ECMP')
      break
    case 'leaf': {
      if (has('vxlan') && has('evpn')) parts.push(`VXLAN · VLAN ${t.vlan} ↔ VNI ${t.l2vni} · ${t.vrf} L3VNI ${t.l3vni}`)
      else parts.push(`${underlay ?? 'Routed'} uplinks · routed host ports`)
      const pt = pairTech(text)
      if (pt) parts.push(`${pt} multihoming`)
      if (has('pfc')) parts.push('RoCEv2 PFC/ECN')
      if (tier.some(d => featuresOf(d, configs, facts).includes('IPv6 dual-stack'))) parts.push('IPv6 dual-stack')
      if (RE_STORAGE.test(text)) parts.push('storage lossless class')
      break
    }
    case 'distribution': {
      if (underlay) parts.push(underlay === 'OSPF' ? 'OSPF area 0' : underlay)
      const fh = fhrpKind(text)
      if (fh) parts.push(`${fh} VIP ${CAMPUS_VLANS.mgmt.vip} on VLAN ${CAMPUS_VLANS.mgmt.id}`)
      parts.push(`L3 gateway for VLAN ${CAMPUS_VLANS.data.id}`)
      break
    }
    case 'access':
      if (/dot1x|authentication port-control|802\.1X|port-security 802-1x/i.test(text)) parts.push('802.1X')
      if (/\bpoe\b|power inline/i.test(text)) parts.push('PoE')
      parts.push('split uplinks to the distribution pair')
      break
    default: {
      if (/tunnel mode sdwan|^\s*sdwan\b|^\s*omp\b|vbond/m.test(text)) parts.push('SD-WAN overlay (OMP · IPsec)')
      if (has('isis')) parts.push(/segment-routing|prefix-sid/.test(text) ? 'IS-IS + Segment Routing' : 'IS-IS')
      else if (has('ospf')) parts.push('OSPF')
      if (has('bgp') && !parts.some(p => p.startsWith('SD-WAN'))) parts.push('BGP')
      if (/\bptp\b/i.test(text)) parts.push('PTP')
    }
  }
  return parts.join(' · ') || undefined
}

/** The endpoint VLANs the access configs actually create (voice only when selected). */
export function campusEndpointCaption(devices: BOMDevice[], configs: Record<string, string>): string {
  const text = devices.filter(d => d.subLayer === 'access').map(d => configs[d.id] ?? '').join('\n')
  const { data, voice, mgmt } = CAMPUS_VLANS
  const hasVoice = new RegExp(`\\bvlan(?:[- ]id)?\\s*${voice.id}\\b|\\b${voice.id}\\b.*VOICE|VOICE.*\\b${voice.id}\\b`, 'i').test(text)
  return [`VLAN ${data.id} ${data.name}`, ...(hasVoice ? [`VLAN ${voice.id} ${voice.name}`] : []), `native VLAN ${mgmt.id}`].join(' · ')
}

/** Feature chips for one device, from its own config. */
export function featuresOf(d: BOMDevice, configs: Record<string, string>, facts: Map<string, DeviceFacts>, border = false): string[] {
  return nodeFeatures(d, configs[d.id] ?? '', facts.get(d.id), border)
}
