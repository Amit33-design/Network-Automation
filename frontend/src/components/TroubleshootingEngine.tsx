import { useState, useMemo } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { Card } from '@/components/ui/Card'

// ── Symptom → root cause knowledge base ─────────────────────────
const SYMPTOMS: Array<{ keywords: string[]; cause: string; severity: string; fix: string; ref: string }> = [
  { keywords: ['bgp','down','neighbor','session','drop'], cause: 'BGP session failure — TCP/179 blocked or hold-timer expired', severity: 'critical', fix: 'Check: ip bgp summary | sh tcp brief | firewall rules port 179. Verify hold-timers match. Check BFD linkage.', ref: 'RFC 4271 §6.5' },
  { keywords: ['ospf','adjacency','stuck','exstart','exchange'], cause: 'OSPF adjacency stuck in EXSTART/EXCHANGE — MTU mismatch', severity: 'high', fix: 'Set "ip ospf mtu-ignore" on both ends, or match MTU. Check: show ip ospf neighbor | debug ip ospf adj', ref: 'RFC 2328 §10.6' },
  { keywords: ['interface','flap','up','down','crc','error'], cause: 'Physical layer issue — bad cable, SFP, or auto-neg mismatch', severity: 'high', fix: 'Check: show interface | show log | Replace SFP. Hardcode speed/duplex. Check cable length vs SFP reach.', ref: 'IEEE 802.3' },
  { keywords: ['vxlan','vtep','mac','arp','flood'], cause: 'VXLAN MAC/ARP learning issue — EVPN type-2 route missing', severity: 'high', fix: 'Check: show bgp l2vpn evpn | show mac address-table | Verify NVE source loopback reachable', ref: 'RFC 7432' },
  { keywords: ['cpu','high','spike','100','process'], cause: 'High CPU — routing protocol reconvergence or ACL/SNMP polling', severity: 'high', fix: 'Check: show proc cpu sorted | show ip bgp summary. Tune BGP scan-time. Rate-limit SNMP. Check for route flap.', ref: 'Vendor CVD' },
  { keywords: ['memory','exhausted','oom','heap'], cause: 'Memory exhaustion — leaked process or BGP table too large', severity: 'critical', fix: 'Check: show proc mem sorted | show ip bgp summary. Reduce BGP table with prefix limits. Restart leaking process.', ref: 'Vendor TAC' },
  { keywords: ['packet','loss','latency','ping','delay'], cause: 'Packet loss — congestion, queue drop, or hardware error', severity: 'medium', fix: 'Check: show interface counters | show queue | show policy-map interface. Enable QoS / adjust queue weights.', ref: 'RFC 2309' },
  { keywords: ['stp','loop','blocked','topology','change'], cause: 'Spanning Tree loop or topology change storm', severity: 'critical', fix: 'Check: show spanning-tree | show log | Enable BPDU Guard, Root Guard, PortFast. Consider MSTP.', ref: 'IEEE 802.1D' },
  { keywords: ['mlag','lacp','bond','lag','trunk'], cause: 'MLAG/LACP bundle failure — peer keepalive or sync issue', severity: 'high', fix: 'Check: show mlag | show lacp neighbor | Verify peer-link up. Check keepalive reachability.', ref: 'IEEE 802.1AX' },
  { keywords: ['evpn','type5','prefix','route','missing'], cause: 'EVPN Type-5 prefix route missing — VRF or RD mismatch', severity: 'medium', fix: 'Check: show bgp l2vpn evpn route-type 5 | Verify VRF RD/RT matches on all VTEPs.', ref: 'RFC 9136' },
  { keywords: ['pfc','watchdog','rdma','roce','lossless'], cause: 'PFC watchdog triggered — deadlock in lossless queue', severity: 'critical', fix: 'Check: show pfc watchdog | Verify ECN thresholds. Reduce PFC storm. Enable DCQCN. Check fabric congestion.', ref: 'RFC 8168' },
  { keywords: ['nat','translation','port','exhausted','overload'], cause: 'NAT port exhaustion — too many concurrent flows', severity: 'medium', fix: 'Add NAT pool IPs or use PAT. Check: show ip nat translations total | show ip nat stat', ref: 'RFC 3022' },
  { keywords: ['dns','resolve','timeout','nxdomain'], cause: 'DNS resolution failure — forwarder unreachable or NXDOMAIN', severity: 'low', fix: 'Check: dig @server name | ping DNS server IP. Verify ACL/FW allows UDP/53. Check split-DNS config.', ref: 'RFC 1034' },
  { keywords: ['acl','blocked','deny','permit','firewall'], cause: 'ACL/firewall blocking legitimate traffic', severity: 'medium', fix: 'Check: show access-lists | show ip inspect sessions | packet-tracer. Use "debug ip packet" with care.', ref: 'RFC 3704' },
  { keywords: ['routing','blackhole','null','drop','unreachable'], cause: 'Routing blackhole — static route to null0 or missing prefix', severity: 'high', fix: 'Check: show ip route | traceroute | Verify next-hop reachable. Check for null0 summarization.', ref: 'RFC 1918' },
]

function classifySymptom(query: string): typeof SYMPTOMS {
  if (!query.trim()) return []
  const words = query.toLowerCase().split(/\s+/)
  return SYMPTOMS
    .map(s => ({ ...s, score: s.keywords.filter(k => words.some(w => w.includes(k) || k.includes(w))).length }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

// ── BGP convergence predictor ────────────────────────────────────
function predictConvergence(devices: number, underlayProtocol: string) {
  const peers = Math.max(2, Math.ceil(Math.sqrt(devices)))
  const holdTimer = underlayProtocol === 'ebgp' ? 9 : 180
  const scanTime = 60
  const convergence = holdTimer + scanTime + (peers * 0.5)
  return {
    worstCase: `~${Math.round(convergence)}s`,
    typical: `~${Math.round(convergence * 0.3)}s with BFD`,
    withBFD: '~300ms (BFD + subsecond failover)',
    peers,
    holdTimer,
  }
}

export function TroubleshootingEngine() {
  const underlayProtocol = useAppStore(s => s.underlayProtocol)
  const devices = useAppStore(s => s.devices)
  const [symptomQuery, setSymptomQuery] = useState('')
  const [incidentQuery, setIncidentQuery] = useState('')

  const results = useMemo(() => classifySymptom(symptomQuery), [symptomQuery])
  const convergence = useMemo(() => predictConvergence(devices.length || 10, underlayProtocol), [devices.length, underlayProtocol])

  const incidentFiltered = useMemo(() => {
    if (!incidentQuery.trim()) return SYMPTOMS
    const q = incidentQuery.toLowerCase()
    return SYMPTOMS.filter(s => s.cause.toLowerCase().includes(q) || s.keywords.some(k => k.includes(q)))
  }, [incidentQuery])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Troubleshooting Engine</h2>
        <p className="text-sm text-gray-400">Symptom classifier, BGP convergence predictor, and incident knowledge base</p>
      </div>

      {/* Symptom classifier */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">🔍 Symptom Classifier</h3>
        <p className="text-xs text-gray-500 mb-3">Describe what you're seeing — the engine classifies the root cause.</p>
        <textarea
          value={symptomQuery}
          onChange={e => setSymptomQuery(e.target.value)}
          placeholder="e.g. BGP neighbor session keeps going down and coming back up every few minutes..."
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200
                     placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
        />
        {results.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Top {results.length} matches:</div>
            {results.map((r, i) => (
              <div key={i} className={`p-3 rounded-lg border ${r.severity === 'critical' ? 'border-red-500/40 bg-red-500/5' : r.severity === 'high' ? 'border-orange-500/40 bg-orange-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                <div className="flex items-start gap-2 mb-1">
                  <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${r.severity === 'critical' ? 'bg-red-500/20 text-red-400' : r.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{r.severity}</span>
                  <span className="text-sm font-semibold text-gray-200">{r.cause}</span>
                </div>
                <div className="text-xs text-gray-400 mb-1">{r.fix}</div>
                <div className="text-xs text-gray-600">Ref: {r.ref}</div>
              </div>
            ))}
          </div>
        )}
        {symptomQuery && results.length === 0 && (
          <div className="mt-3 text-sm text-gray-500">No matches — try different keywords (bgp, ospf, interface, cpu, latency…)</div>
        )}
      </Card>

      {/* BGP convergence predictor */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">⏱ BGP Convergence Predictor</h3>
        <p className="text-xs text-gray-500 mb-4">Based on your design: {devices.length} devices · {underlayProtocol.toUpperCase()} underlay</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="text-xl font-bold text-red-400">{convergence.worstCase}</div>
            <div className="text-xs text-gray-500 mt-1">Worst Case (no BFD)</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
            <div className="text-xl font-bold text-yellow-400">{convergence.typical}</div>
            <div className="text-xs text-gray-500 mt-1">Typical (with BFD)</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="text-xl font-bold text-green-400">{convergence.withBFD}</div>
            <div className="text-xs text-gray-500 mt-1">Fast (BFD + aggressive timers)</div>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Hold timer: {convergence.holdTimer}s · Estimated BGP peers: {convergence.peers} · Enable BFD for sub-second failover
        </div>
      </Card>

      {/* Incident knowledge base */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📚 Incident Knowledge Base</h3>
        <input
          type="text"
          value={incidentQuery}
          onChange={e => setIncidentQuery(e.target.value)}
          placeholder="Search incidents… (bgp, ospf, stp, vxlan, pfc…)"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200
                     placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-4"
        />
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {incidentFiltered.map((inc, i) => (
            <div key={i} className="p-3 rounded-lg border border-white/10 bg-white/[0.02] hover:border-white/20 transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${inc.severity === 'critical' ? 'bg-red-500/20 text-red-400' : inc.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : inc.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{inc.severity}</span>
                <span className="text-xs text-gray-400">{inc.keywords.slice(0, 4).join(' · ')}</span>
              </div>
              <div className="text-sm font-medium text-gray-200 mb-1">{inc.cause}</div>
              <div className="text-xs text-gray-500">{inc.fix}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
