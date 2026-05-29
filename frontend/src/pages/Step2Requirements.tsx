import { useMemo, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { AppType, Compliance, BandwidthPerServer, UnderlayProtocol, TrafficPattern, RedundancyModel, VpnType, DcTopology } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const REDUNDANCY_OPTIONS: Array<{ id: RedundancyModel; label: string; desc: string }> = [
  { id: 'none',  label: 'None',  desc: 'PoC / Lab' },
  { id: 'basic', label: 'Basic', desc: 'Single uplinks' },
  { id: 'ha',    label: 'HA',    desc: 'Dual uplinks, MLAG' },
  { id: 'full',  label: 'Full',  desc: 'Dual everything' },
]

const TRAFFIC_PATTERNS: Array<{ id: TrafficPattern; label: string }> = [
  { id: 'ns',   label: 'North-South' },
  { id: 'ew',   label: 'East-West' },
  { id: 'both', label: 'Both' },
]

const BW_OPTIONS: BandwidthPerServer[] = ['1G', '10G', '25G', '100G', '400G']

const UNDERLAY_OPTIONS: Array<{ id: UnderlayProtocol; label: string }> = [
  { id: 'ospf',   label: 'OSPF' },
  { id: 'isis',   label: 'IS-IS' },
  { id: 'ebgp',   label: 'eBGP' },
  { id: 'static', label: 'Static' },
]

// M-08: added GENEVE
const OVERLAY_OPTIONS = ['VXLAN/EVPN', 'MPLS/SR', 'GRE', 'IPsec', 'SD-WAN', 'GENEVE']

// M-09: richer feature list
const PROTO_FEATURES = [
  'ECMP', 'MLAG', 'BFD', 'LACP', 'QoS', 'PFC', 'ECN', 'RDMA',
  'SHARP', 'VLAN pruning', '802.1X', 'MACsec',
  'IPv6 Dual-Stack', 'Multicast (PIM-SM)', 'Route Reflectors',
  'PBR', 'VRF/Tenant', 'Anycast GW', 'FlowSpec', 'BGP Unnumbered',
]

// M-07: added FedRAMP + NIST CSF + ISO27001
const COMPLIANCE_OPTIONS: Array<{ id: Compliance; label: string }> = [
  { id: 'PCI',      label: 'PCI-DSS' },
  { id: 'HIPAA',    label: 'HIPAA' },
  { id: 'SOC2',     label: 'SOC2' },
  { id: 'ISO27001', label: 'ISO 27001' },
  { id: 'FedRAMP',  label: 'FedRAMP' },
  { id: 'NIST_CSF', label: 'NIST CSF' },
]

const APP_TYPES: Array<{ id: AppType; label: string }> = [
  { id: 'voice',    label: 'Voice' },
  { id: 'video',    label: 'Video' },
  { id: 'storage',  label: 'Storage' },
  { id: 'hpc',      label: 'HPC' },
  { id: 'internet', label: 'Internet' },
]

const OVERSUBSCRIPTION_OPTIONS = [
  { value: 1, label: '1:1' },
  { value: 2, label: '2:1' },
  { value: 3, label: '3:1' },
  { value: 4, label: '4:1' },
  { value: 8, label: '8:1' },
]

// M-04: VPN types
const VPN_TYPES: Array<{ id: VpnType; label: string; desc: string }> = [
  { id: 'none',  label: 'None',  desc: 'No VPN' },
  { id: 'ipsec', label: 'IPsec', desc: 'Site-to-site tunnel' },
  { id: 'ssl',   label: 'SSL/TLS', desc: 'Remote access VPN' },
  { id: 'ztna',  label: 'ZTNA',  desc: 'Zero-trust network access' },
]

// M-05: NAC options
const NAC_OPTIONS = ['802.1X Wired', '802.1X Wireless', 'MAB', 'Guest VLAN', 'Posture Assessment']

// M-11: Multi-cloud / Aviatrix constants
const CLOUD_PROVIDERS = ['AWS', 'Azure', 'GCP', 'OCI', 'Alibaba']

const DC_TOPOLOGY_OPTIONS: Array<{ id: DcTopology; label: string; desc: string }> = [
  { id: 'hub-spoke',    label: 'Hub-Spoke',    desc: 'Central hub, branches spoke' },
  { id: 'full-mesh',    label: 'Full-Mesh',    desc: 'All sites interconnected' },
  { id: 'partial-mesh', label: 'Partial-Mesh', desc: 'Selected site pairs' },
]

const DC_EDGE_VENDORS = ['Cisco', 'Arista', 'Juniper', 'NVIDIA', 'Fortinet']

const AVIATRIX_OPTIONS = ['Transit Gateway', 'FireNet', 'Edge Gateway', 'Controller HA']

// M-13: constraint rules from CLAUDE.md
interface Violation { id: string; severity: 'error' | 'warning'; msg: string; fix: string }

function runConstraints(state: {
  underlayProtocol: UnderlayProtocol
  overlayProtocols: string[]
  protoFeatures: string[]
  useCase: string
  redundancyModel: RedundancyModel
  vendorPrefs: string[]
}): Violation[] {
  const { underlayProtocol, overlayProtocols, protoFeatures, useCase, redundancyModel, vendorPrefs } = state
  const violations: Violation[] = []

  if (underlayProtocol === 'static' && overlayProtocols.some(o => o.includes('VXLAN')))
    violations.push({ id: 'R-01', severity: 'error', msg: 'EIGRP/Static cannot underlay VXLAN/EVPN — EVPN requires BGP.', fix: 'Change underlay to eBGP or IS-IS.' })

  if (overlayProtocols.includes('GENEVE') && vendorPrefs.includes('Cisco'))
    violations.push({ id: 'R-02', severity: 'error', msg: 'GENEVE is not supported on Cisco IOS-XE or NX-OS in hardware.', fix: 'Use VXLAN, or switch to SONiC.' })

  if (protoFeatures.includes('FlowSpec') && underlayProtocol !== 'ebgp')
    violations.push({ id: 'R-03', severity: 'error', msg: 'FlowSpec (BGP-FS) requires BGP as underlay.', fix: 'Change underlay to eBGP.' })

  if (redundancyModel === 'full' && underlayProtocol === 'static')
    violations.push({ id: 'R-04', severity: 'error', msg: 'Static routing cannot provide full redundancy.', fix: 'Use BGP or OSPF with BFD.' })

  if (useCase === 'campus' && underlayProtocol === 'isis')
    violations.push({ id: 'R-05', severity: 'warning', msg: 'IS-IS is uncommon for campus. CVD/AVD recommend OSPF.', fix: 'Consider OSPF for campus LAN.' })

  return violations
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Step2Requirements() {
  const {
    useCase,
    redundancyModel, trafficPattern, totalEndpoints, bandwidthPerServer, oversubscription,
    underlayProtocol, overlayProtocols, protoFeatures, compliance, appTypes, numSites,
    vpnType, nacOptions, additionalNotes, vendorPrefs,
    cloudProviders, dcTopology, coloProvider, dcEdgeVendor, bgpAsn, orgCidr, aviatrixOptions,
    setRedundancyModel, setTrafficPattern, setTotalEndpoints, setBandwidthPerServer,
    setOversubscription, setUnderlayProtocol, setOverlayProtocols, setProtoFeatures,
    setCompliance, setAppTypes, setNumSites, setVpnType, setNacOptions, setAdditionalNotes,
    setCloudProviders, setDcTopology, setColoProvider, setDcEdgeVendor, setBgpAsn, setOrgCidr, setAviatrixOptions,
    nextStep, prevStep,
  } = useAppStore()

  // Local draft for numSites — avoids mobile controlled-input clamping bug
  // where backspace snaps back to min="1" before user can retype.
  const [numSitesDraft, setNumSitesDraft] = useState(String(numSites))

  function toggleOverlay(o: string) {
    setOverlayProtocols(overlayProtocols.includes(o) ? overlayProtocols.filter(x => x !== o) : [...overlayProtocols, o])
  }
  function toggleFeature(f: string) {
    setProtoFeatures(protoFeatures.includes(f) ? protoFeatures.filter(x => x !== f) : [...protoFeatures, f])
  }
  function toggleCompliance(id: Compliance) {
    setCompliance(compliance.includes(id) ? compliance.filter(c => c !== id) : [...compliance, id])
  }
  function toggleAppType(id: AppType) {
    setAppTypes(appTypes.includes(id) ? appTypes.filter(t => t !== id) : [...appTypes, id])
  }
  function toggleNac(n: string) {
    setNacOptions(nacOptions.includes(n) ? nacOptions.filter(x => x !== n) : [...nacOptions, n])
  }

  // M-13: run constraint validator
  const violations = useMemo(() => runConstraints({ underlayProtocol, overlayProtocols, protoFeatures, useCase, redundancyModel, vendorPrefs }), [underlayProtocol, overlayProtocols, protoFeatures, useCase, redundancyModel, vendorPrefs])
  const errors = violations.filter(v => v.severity === 'error')
  const warnings = violations.filter(v => v.severity === 'warning')

  return (
    <div className="flex gap-6">
      {/* ── Left: main form ── */}
      <div className="flex-1 min-w-0 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-1">Network Requirements</h2>
          <p className="text-sm text-gray-400">Define topology, capacity, and protocol requirements</p>
        </div>

        {/* M-13: Constraint violations */}
        {violations.length > 0 && (
          <div className="space-y-2">
            {errors.map(v => (
              <div key={v.id} className="flex gap-3 p-3 rounded-lg bg-red-900/30 border border-red-700/50">
                <span className="text-red-400 font-bold text-xs mt-0.5">✕ {v.id}</span>
                <div>
                  <div className="text-sm text-red-300">{v.msg}</div>
                  <div className="text-xs text-red-400 mt-0.5">Fix: {v.fix}</div>
                </div>
              </div>
            ))}
            {warnings.map(v => (
              <div key={v.id} className="flex gap-3 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700/50">
                <span className="text-yellow-400 font-bold text-xs mt-0.5">⚠ {v.id}</span>
                <div>
                  <div className="text-sm text-yellow-300">{v.msg}</div>
                  <div className="text-xs text-yellow-500 mt-0.5">Fix: {v.fix}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Redundancy */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Redundancy Model</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {REDUNDANCY_OPTIONS.map(r => (
              <button
                key={r.id}
                onClick={() => setRedundancyModel(r.id)}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all cursor-pointer',
                  redundancyModel === r.id ? 'border-blue-500 bg-blue-600/20' : 'border-white/10 bg-white/5 hover:border-white/30',
                )}
              >
                <div className={cn('text-sm font-semibold', redundancyModel === r.id ? 'text-blue-300' : 'text-gray-200')}>{r.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{r.desc}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* Traffic Pattern */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Traffic Pattern</h3>
          <div className="flex gap-2">
            {TRAFFIC_PATTERNS.map(tp => (
              <button
                key={tp.id}
                onClick={() => setTrafficPattern(tp.id)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer',
                  trafficPattern === tp.id
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200',
                )}
              >
                {tp.label}
              </button>
            ))}
          </div>
        </Card>

        {/* Capacity */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Capacity</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Total Endpoints</label>
              <input
                type="number" min={1} max={100000} value={totalEndpoints}
                onChange={e => setTotalEndpoints(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Bandwidth per Server</label>
              <select
                value={bandwidthPerServer}
                onChange={e => setBandwidthPerServer(e.target.value as BandwidthPerServer)}
                className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {BW_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Oversubscription</label>
              <select
                value={oversubscription}
                onChange={e => setOversubscription(Number(e.target.value))}
                className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {OVERSUBSCRIPTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Number of Sites</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={numSitesDraft}
                onChange={e => {
                  const raw = e.target.value.replace(/\D/g, '')
                  setNumSitesDraft(raw)
                  const n = parseInt(raw, 10)
                  if (!isNaN(n) && n >= 1 && n <= 500) setNumSites(n)
                }}
                onBlur={() => {
                  const n = Math.max(1, Math.min(500, parseInt(numSitesDraft, 10) || 1))
                  setNumSites(n)
                  setNumSitesDraft(String(n))
                }}
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </Card>

        {/* M-04: VPN Type */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">VPN Type</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {VPN_TYPES.map(v => (
              <button
                key={v.id}
                onClick={() => setVpnType(v.id)}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all cursor-pointer',
                  vpnType === v.id ? 'border-indigo-500 bg-indigo-600/20' : 'border-white/10 bg-white/5 hover:border-white/30',
                )}
              >
                <div className={cn('text-sm font-semibold', vpnType === v.id ? 'text-indigo-300' : 'text-gray-200')}>{v.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{v.desc}</div>
              </button>
            ))}
          </div>
        </Card>

        {/* M-05: NAC */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Network Access Control (NAC)</h3>
          <div className="flex flex-wrap gap-2">
            {NAC_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => toggleNac(n)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                  nacOptions.includes(n)
                    ? 'bg-teal-600/30 border-teal-500 text-teal-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </Card>

        {/* Routing */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Routing</h3>
          <div className="mb-4">
            <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Underlay Protocol</label>
            <div className="flex gap-2 flex-wrap">
              {UNDERLAY_OPTIONS.map(u => (
                <button
                  key={u.id}
                  onClick={() => setUnderlayProtocol(u.id)}
                  className={cn(
                    'px-4 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer',
                    underlayProtocol === u.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30 hover:text-gray-200',
                  )}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Overlay Protocols</label>
            <div className="flex gap-2 flex-wrap">
              {OVERLAY_OPTIONS.map(o => (
                <button
                  key={o}
                  onClick={() => toggleOverlay(o)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                    overlayProtocols.includes(o) ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Protocol Features */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Protocol Features</h3>
          <div className="flex flex-wrap gap-2">
            {PROTO_FEATURES.map(f => (
              <button
                key={f}
                onClick={() => toggleFeature(f)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                  protoFeatures.includes(f) ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </Card>

        {/* Compliance */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Compliance <span className="text-gray-500 font-normal">(optional)</span></h3>
          <div className="flex flex-wrap gap-2">
            {COMPLIANCE_OPTIONS.map(c => (
              <button
                key={c.id}
                onClick={() => toggleCompliance(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                  compliance.includes(c.id) ? 'bg-purple-600/30 border-purple-500 text-purple-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Card>

        {/* App Types */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Application Types <span className="text-gray-500 font-normal">(optional)</span></h3>
          <div className="flex flex-wrap gap-2">
            {APP_TYPES.map(at => (
              <button
                key={at.id}
                onClick={() => toggleAppType(at.id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                  appTypes.includes(at.id) ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30',
                )}
              >
                {at.label}
              </button>
            ))}
          </div>
        </Card>

        {/* M-11: Multi-cloud / Aviatrix fields */}
        {(useCase === 'multicloud' || useCase === 'aviatrix') && (
          <Card>
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Multi-Cloud Configuration</h3>

            <div className="mb-4">
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Cloud Providers</label>
              <div className="flex flex-wrap gap-2">
                {CLOUD_PROVIDERS.map(p => (
                  <button key={p} onClick={() => setCloudProviders(cloudProviders.includes(p) ? cloudProviders.filter(x => x !== p) : [...cloudProviders, p])}
                    className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                      cloudProviders.includes(p) ? 'bg-sky-600/30 border-sky-500 text-sky-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30')}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">DC Topology</label>
              <div className="grid grid-cols-3 gap-2">
                {DC_TOPOLOGY_OPTIONS.map(t => (
                  <button key={t.id} onClick={() => setDcTopology(t.id)}
                    className={cn('p-2.5 rounded-lg border text-left transition-all cursor-pointer',
                      dcTopology === t.id ? 'border-blue-500 bg-blue-600/20' : 'border-white/10 bg-white/5 hover:border-white/30')}>
                    <div className={cn('text-sm font-semibold', dcTopology === t.id ? 'text-blue-300' : 'text-gray-200')}>{t.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Colo Provider</label>
                <input type="text" value={coloProvider} onChange={e => setColoProvider(e.target.value)}
                  placeholder="Equinix, Digital Realty, CoreSite…"
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">DC Edge Vendor</label>
                <select value={dcEdgeVendor} onChange={e => setDcEdgeVendor(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500">
                  <option value="">Select vendor…</option>
                  {DC_EDGE_VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">BGP ASN</label>
                <input type="text" value={bgpAsn} onChange={e => setBgpAsn(e.target.value)}
                  placeholder="65000"
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Org CIDR Block</label>
                <input type="text" value={orgCidr} onChange={e => setOrgCidr(e.target.value)}
                  placeholder="10.0.0.0/8"
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500" />
              </div>
            </div>

            {useCase === 'aviatrix' && (
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Aviatrix Options</label>
                <div className="flex flex-wrap gap-2">
                  {AVIATRIX_OPTIONS.map(o => (
                    <button key={o} onClick={() => setAviatrixOptions(aviatrixOptions.includes(o) ? aviatrixOptions.filter(x => x !== o) : [...aviatrixOptions, o])}
                      className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer',
                        aviatrixOptions.includes(o) ? 'bg-purple-600/30 border-purple-500 text-purple-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30')}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* M-06: Additional notes */}
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Additional Notes / Special Requirements</h3>
          <textarea
            rows={4}
            value={additionalNotes}
            onChange={e => setAdditionalNotes(e.target.value)}
            placeholder="Any special requirements, constraints, or notes for the design team…"
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </Card>

        <div className="flex justify-between">
          <Button variant="secondary" onClick={prevStep}>← Back</Button>
          <Button onClick={nextStep} disabled={errors.length > 0}>Continue →</Button>
        </div>
      </div>

      {/* M-10: Live summary sidebar (right column) */}
      <div className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-6 space-y-3">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Current Selections</div>

          <SummaryCard label="Use Case" value={useCase || '—'} />
          <SummaryCard label="Redundancy" value={redundancyModel || '—'} />
          <SummaryCard label="Traffic" value={trafficPattern || '—'} />
          <SummaryCard label="Sites" value={String(numSites)} />
          <SummaryCard label="Endpoints" value={String(totalEndpoints)} />
          <SummaryCard label="BW / Server" value={bandwidthPerServer} />
          <SummaryCard label="Oversubscription" value={`${oversubscription}:1`} />
          <SummaryCard label="VPN" value={vpnType || 'None'} />
          <SummaryCard label="Underlay" value={underlayProtocol.toUpperCase()} />
          {overlayProtocols.length > 0 && (
            <SummaryCard label="Overlay" value={overlayProtocols.join(', ')} />
          )}
          {compliance.length > 0 && (
            <SummaryCard label="Compliance" value={compliance.join(', ')} />
          )}
          {nacOptions.length > 0 && (
            <SummaryCard label="NAC" value={nacOptions.join(', ')} />
          )}
          {protoFeatures.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1.5">Features</div>
              <div className="flex flex-wrap gap-1">
                {protoFeatures.map(f => (
                  <span key={f} className="text-xs bg-cyan-900/40 text-cyan-300 px-1.5 py-0.5 rounded">{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Validation status */}
          {violations.length === 0 ? (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-900/20 border border-green-700/40 text-xs text-green-400">
              <span>✓</span> No constraint violations
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-900/20 border border-red-700/40 text-xs text-red-400">
              <span>✕</span> {errors.length} error{errors.length !== 1 ? 's' : ''}{warnings.length > 0 ? `, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-200 font-medium truncate max-w-[120px] text-right">{value}</span>
    </div>
  )
}
