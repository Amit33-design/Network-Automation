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

// ── M-47: RCA playbook generator ─────────────────────────────────
const RCA_PLAYBOOKS: Record<string, { title: string; steps: string[]; commands: string[] }> = {
  bgp: {
    title: 'BGP Session Failure Playbook',
    steps: [
      '1. Verify TCP/179 is open between peers — telnet <peer> 179',
      '2. Confirm hold-timer configuration matches on both sides',
      '3. Check BGP authentication (MD5 key mismatch is common)',
      '4. Verify route policy / prefix-list is not filtering all routes',
      '5. Confirm BFD session is up if BFD is configured',
      '6. Review syslog for BGP notification codes (code 4 = Hold Timer Expired)',
    ],
    commands: ['show bgp summary', 'show bgp neighbors <ip>', 'show ip bgp flap-statistics', 'debug ip bgp <ip> events'],
  },
  ospf: {
    title: 'OSPF Adjacency Playbook',
    steps: [
      '1. Verify both interfaces are in the same OSPF area',
      '2. Check MTU matches on both sides — or set ip ospf mtu-ignore',
      '3. Verify hello and dead timer intervals match (default 10/40 broadcast)',
      '4. Check OSPF authentication type and key',
      '5. Verify network type (broadcast vs point-to-point) matches',
      '6. Confirm stub/NSSA flags are identical on both routers',
    ],
    commands: ['show ip ospf neighbor', 'show ip ospf interface', 'debug ip ospf adj', 'show ip ospf database'],
  },
  vxlan: {
    title: 'VXLAN/EVPN Playbook',
    steps: [
      '1. Ping VTEP loopback from all other VTEPs (ping source loopback0)',
      '2. Check BGP EVPN address-family — all peers sending type-2/type-5',
      '3. Verify VNI-to-VLAN mapping is consistent across all VTEPs',
      '4. Check ARP suppression and MAC aging settings match',
      '5. Verify anycast gateway MAC (GARP) is same on all leaf switches',
      '6. Inspect BGP type-2 (MAC/IP) and type-5 (IP prefix) route counts',
    ],
    commands: ['show bgp l2vpn evpn', 'show nve peers', 'show nve vni', 'show mac address-table'],
  },
  interface: {
    title: 'Interface Flap / Error Playbook',
    steps: [
      '1. Check CRC/input error counters on both ends of the link',
      '2. Replace SFP/DAC cable if CRC or FCS errors are incrementing',
      '3. Verify auto-negotiation — hardcode speed/duplex if mismatched',
      '4. Check cable length vs SFP reach spec (SMF vs MMF)',
      '5. Inspect DOM diagnostics — Tx/Rx optical power within spec',
      '6. Test with a known-good cable or SFP to isolate HW fault',
    ],
    commands: ['show interface <intf>', 'show interface <intf> counters errors', 'show transceiver detail', 'show log | include <intf>'],
  },
  cpu: {
    title: 'High CPU Playbook',
    steps: [
      '1. Identify top CPU processes and correlate with recent events',
      '2. Check if a route flap is driving reconvergence',
      '3. Rate-limit SNMP polling — reduce frequency or scope',
      '4. Verify CoPP is configured and not exhausted',
      '5. Check for logging storms — reduce logging level if needed',
      '6. Tune BGP scan-time and update-delay to reduce background load',
    ],
    commands: ['show proc cpu sorted', 'show proc cpu history', 'show ip bgp summary', 'show policy-map control-plane'],
  },
  pfc: {
    title: 'PFC/RoCEv2 Lossless Fabric Playbook',
    steps: [
      '1. Identify ports where PFC watchdog triggered and action taken (drop/pause)',
      '2. Verify ECN thresholds — min/max marking thresholds consistent across switches',
      '3. Review DCQCN parameters — Rp/Np/Cp rates and timer settings',
      '4. Check for fabric congestion — buffer drops on spine uplinks',
      '5. Confirm RDMA NIC QoS priority matches switch PFC priority 3',
      '6. Ensure no-drop class (PFC priority 3) is set end-to-end including ToR',
    ],
    commands: ['show pfc watchdog', 'show interface counters pfc', 'show qos interface', 'show hardware buffer'],
  },
  stp: {
    title: 'Spanning Tree Loop Playbook',
    steps: [
      '1. Identify port generating topology changes (TC flood)',
      '2. Enable BPDU Guard on all access ports — auto-error-disable on BPDU receipt',
      '3. Enable Root Guard on designated ports toward untrusted switches',
      '4. Verify PortFast is only on server-facing and end-device ports',
      '5. Consider migrating to MSTP for multi-VLAN scale',
      '6. Check for rogue/unmanaged consumer switches on the network',
    ],
    commands: ['show spanning-tree', 'show spanning-tree detail', 'show log | include STP|TCN', 'show spanning-tree inconsistentports'],
  },
}

type PlaybookKey = keyof typeof RCA_PLAYBOOKS

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
  const [selectedPlaybook, setSelectedPlaybook] = useState<PlaybookKey>('bgp')
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  const results = useMemo(() => classifySymptom(symptomQuery), [symptomQuery])
  const convergence = useMemo(() => predictConvergence(devices.length || 10, underlayProtocol), [devices.length, underlayProtocol])

  const incidentFiltered = useMemo(() => {
    if (!incidentQuery.trim()) return SYMPTOMS
    const q = incidentQuery.toLowerCase()
    return SYMPTOMS.filter(s => s.cause.toLowerCase().includes(q) || s.keywords.some(k => k.includes(q)))
  }, [incidentQuery])

  const playbook = RCA_PLAYBOOKS[selectedPlaybook]

  function copyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).catch(() => {})
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 1500)
  }

  function downloadPlaybook() {
    const text = [
      `# ${playbook.title}`,
      '',
      '## Steps',
      ...playbook.steps,
      '',
      '## Commands',
      ...playbook.commands.map(c => `  ${c}`),
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `rca_playbook_${String(selectedPlaybook)}.txt`
    a.click()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-100 mb-1">Troubleshooting Engine</h2>
        <p className="text-sm text-gray-400">Symptom classifier, BGP convergence predictor, RCA playbooks, and incident knowledge base</p>
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

      {/* M-47: RCA Playbook Generator */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300">📋 RCA Playbook Generator</h3>
          <button
            onClick={downloadPlaybook}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-400 hover:bg-blue-600/30 transition-colors"
          >
            ↓ Download .txt
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {(Object.keys(RCA_PLAYBOOKS) as PlaybookKey[]).map(key => (
            <button
              key={key}
              onClick={() => setSelectedPlaybook(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${selectedPlaybook === key ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'}`}
            >
              {String(key).toUpperCase()}
            </button>
          ))}
        </div>
        <div className="bg-white/[0.02] border border-white/10 rounded-lg p-4">
          <div className="text-sm font-semibold text-gray-200 mb-3">{playbook.title}</div>
          <div className="space-y-1.5 mb-4">
            {playbook.steps.map((step, i) => (
              <div key={i} className="text-xs text-gray-400">{step}</div>
            ))}
          </div>
          <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Commands</div>
          <div className="space-y-1">
            {playbook.commands.map((cmd, i) => (
              <div key={i} className="flex items-center justify-between gap-2 group">
                <code className="text-xs text-green-400 font-mono bg-black/30 px-2 py-1 rounded flex-1">{cmd}</code>
                <button
                  onClick={() => copyCmd(cmd)}
                  className="text-xs text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded"
                >
                  {copiedCmd === cmd ? '✓' : 'copy'}
                </button>
              </div>
            ))}
          </div>
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
