/**
 * The diagrams say what the configs say, and change when the inputs do (AQ4).
 *
 * The LLD's row captions were static text: the Cisco and Arista DC LLDs said
 * "eBGP underlay /31s" over an IS-IS underlay, every campus said "802.1X ·
 * PoE" and listed a voice VLAN whether or not one was configured, and the
 * perimeter still said "routed /31 handoff" after AN10 made it a transit VLAN
 * /29. Neither diagram received the inputs (app types, protocol features)
 * that change the configs, so selecting IPv6 dual-stack changed nothing on
 * either. Captions are now read from the generated configs (lib/design-caption).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AppType, UseCase } from '@/types'
import { buildDeviceList } from '@/lib/bom'
import { generateAllConfigs } from '@/lib/configgen'
import { designFacts, codeOnlyConfigs } from '@/lib/design-caption'
import { buildLLDTopology, LLDTopologyDiagram } from '@/components/LLDTopologyDiagram'

afterEach(() => cleanup())

function lld(vendor: string, useCase: UseCase, appTypes: AppType[] = [], protoFeatures: string[] = []) {
  const devices = buildDeviceList({ useCase, scale: 'medium', siteCode: 'AQ4', vendorPrefs: [vendor], totalEndpoints: 512 })
  const configs = generateAllConfigs(devices, useCase, [], appTypes, protoFeatures)
  const topo = buildLLDTopology(devices, useCase, 'AQ4', configs)
  const zone = (id: string) => topo.zones.find(z => z.id === id)?.sublabel ?? ''
  return { devices, configs, topo, zone }
}

describe('LLD captions are read from the configs (AQ4)', () => {
  it('Cisco DC: the spine row names the IS-IS underlay it runs, not eBGP', () => {
    const { zone } = lld('Cisco', 'dc')
    expect(zone('z-spine')).toMatch(/^IS-IS underlay · EVPN route exchange/)
    expect(zone('z-spine')).not.toMatch(/eBGP/)
  })

  it('Dell DC: eBGP underlay, VLT multihoming (AP5)', () => {
    const { zone } = lld('Dell EMC', 'dc')
    expect(zone('z-spine')).toMatch(/eBGP underlay \/31s/)
    expect(zone('z-leaf')).toMatch(/VLT multihoming/)
  })

  it('the perimeter describes the AN10 transit-VLAN handoff, not a /31', () => {
    for (const uc of ['dc', 'campus'] as const) {
      const fw = lld('Cisco', uc).zone('z-fw')
      expect(fw, uc).toMatch(/Firewall HA cluster · transit VLAN \/29 handoff/)
      expect(fw, uc).not.toMatch(/\/31/)
    }
  })

  it('campus distribution names the first-hop protocol its vendor configures', () => {
    expect(lld('Cisco', 'campus').zone('z-dist')).toMatch(/HSRP VIP 10\.255\.99\.254/)
    expect(lld('Arista', 'campus').zone('z-dist')).toMatch(/VRRP VIP 10\.255\.99\.254/)
  })

  it('802.1X is claimed only where the access configs configure it', () => {
    expect(lld('Cisco', 'campus').zone('z-access')).toMatch(/802\.1X/)
    expect(lld('Arista', 'campus').zone('z-access')).not.toMatch(/802\.1X/)
  })

  it('no row caption names a protocol its tier\'s configs do not run', () => {
    const CLAIMS: Array<[RegExp, 'isis' | 'ospf' | 'bgp' | 'vxlan' | 'pfc']> = [
      [/IS-IS/, 'isis'], [/OSPF/, 'ospf'], [/eBGP|\bBGP\b/, 'bgp'], [/VXLAN/, 'vxlan'], [/PFC/, 'pfc'],
    ]
    const TIER: Record<string, string> = { 'z-fw': 'firewall', 'z-spine': 'spine', 'z-leaf': 'leaf', 'z-dist': 'distribution', 'z-access': 'access' }
    for (const [vendor, uc] of [['Cisco', 'dc'], ['Arista', 'dc'], ['Dell EMC', 'dc'], ['Juniper', 'dc'], ['NVIDIA', 'gpu'], ['Cisco', 'campus'], ['Juniper', 'campus']] as const) {
      const { devices, configs, topo } = lld(vendor, uc)
      const facts = designFacts(devices, codeOnlyConfigs(configs))
      for (const z of topo.zones) {
        const tier = TIER[z.id] ?? z.id.replace(/^z-/, '')
        const devs = devices.filter(d => d.subLayer === tier)
        if (!devs.length) continue
        for (const [re, fact] of CLAIMS) {
          if (!re.test(z.sublabel)) continue
          expect(devs.some(d => facts.get(d.id)?.[fact].state === 'present'), `${vendor} ${uc} ${z.label}: "${z.sublabel}" claims ${fact}`).toBe(true)
        }
      }
    }
  })
})

describe('the diagrams change when the inputs do (AQ4)', () => {
  it('IPv6 dual-stack appears on the leaf row only when selected', () => {
    expect(lld('Cisco', 'dc').zone('z-leaf')).not.toMatch(/IPv6/)
    expect(lld('Cisco', 'dc', [], ['IPv6 Dual-Stack']).zone('z-leaf')).toMatch(/IPv6 dual-stack/)
  })

  it('the storage class appears only when the storage app type is selected — never from a comment', () => {
    expect(lld('Cisco', 'dc').zone('z-leaf')).not.toMatch(/storage/)
    expect(lld('Dell EMC', 'dc').zone('z-leaf')).not.toMatch(/storage/)
    expect(lld('Cisco', 'dc', ['storage']).zone('z-leaf')).toMatch(/storage lossless class/)
  })

  it('the voice VLAN is listed only when the voice app type is selected', () => {
    expect(lld('Cisco', 'campus').zone('z-ep')).not.toMatch(/VOICE/)
    expect(lld('Cisco', 'campus', ['voice']).zone('z-ep')).toMatch(/VLAN 20 VOICE/)
  })

  it('the LLD component passes its input props into the configs it describes', () => {
    const devices = buildDeviceList({ useCase: 'dc', scale: 'medium', siteCode: 'AQ4', vendorPrefs: ['Cisco'], totalEndpoints: 512 })
    render(<LLDTopologyDiagram devices={devices} useCase="dc" protoFeatures={['IPv6 Dual-Stack']} />)
    expect(screen.getAllByText(/IPv6 dual-stack/).length).toBeGreaterThan(0)
  })
})
