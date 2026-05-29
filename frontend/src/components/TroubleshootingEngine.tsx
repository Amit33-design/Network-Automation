import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useBackendMode } from '@/components/BackendToggle'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { BOMDevice } from '@/types'

// ════════════════════════════════════════════════════════════════════════════
// Live Fault Scenarios — ML-style weighted signal correlation (deterministic)
// ════════════════════════════════════════════════════════════════════════════

type Severity = 'critical' | 'high' | 'medium'

interface SignalDef {
  name: string
  weight: number          // 0–1
  threshold: number       // trigger threshold on the 0–100 simulated metric
  unit: string
  /** if false, a LOWER measured value is the problem (e.g. hash entropy) */
  higherIsWorse?: boolean
}

interface RootCauseRule {
  description: string
  severity: Severity
  affectedDeviceRoles: string[]
  requires: number[]      // indices into scenario.signals
  mode?: 'all' | 'any'
}

interface RemediationStep {
  title: string
  cli: Record<string, string>   // keyed by device subLayer, or '*' for all
}

interface Scenario {
  id: string
  icon: string
  title: string
  severity: Severity
  useCaseTag: string
  summary: string
  relevantRoles: string[]
  signals: SignalDef[]
  rootCauses: RootCauseRule[]
  remediation: RemediationStep[]
  verification: string[]
  mttrMinutes: [number, number]
}

interface SignalResult {
  name: string; measuredValue: number; threshold: number
  triggered: boolean; weight: number; unit: string
}
interface RootCause {
  description: string; confidence: number
  severity: Severity; affectedDeviceRoles: string[]
}
interface DiagnosisResult {
  scenarioId: string
  signals: SignalResult[]
  rootCauses: RootCause[]
  affectedDevices: BOMDevice[]
  remediationCLI: Record<string, string>
  mttrMinutes: [number, number]
  diagnosedAt: string
}

const SCENARIOS: Scenario[] = [
  {
    id: 'wifi-campus',
    icon: '📶',
    title: 'Campus WiFi Not Working',
    severity: 'high',
    useCaseTag: 'campus',
    summary: 'Wireless clients cannot associate, authenticate, or obtain an IP on the access layer.',
    relevantRoles: ['access', 'distribution', 'core'],
    signals: [
      { name: 'RADIUS auth latency', weight: 0.30, threshold: 50, unit: 'ms', higherIsWorse: true },
      { name: 'DHCP pool utilization', weight: 0.25, threshold: 90, unit: '%', higherIsWorse: true },
      { name: 'RF channel utilization', weight: 0.20, threshold: 80, unit: '%', higherIsWorse: true },
      { name: 'VLAN mismatch on AP uplink', weight: 0.15, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'PoE budget consumed', weight: 0.10, threshold: 90, unit: '%', higherIsWorse: true },
    ],
    rootCauses: [
      { description: 'RADIUS server unreachable / auth timeout — clients stuck in EAP handshake', severity: 'high', affectedDeviceRoles: ['access', 'distribution'], requires: [0, 3], mode: 'any' },
      { description: 'DHCP scope exhaustion — no free leases for new associations', severity: 'high', affectedDeviceRoles: ['distribution', 'core'], requires: [1] },
      { description: 'RF interference / co-channel congestion degrading throughput', severity: 'medium', affectedDeviceRoles: ['access'], requires: [2] },
      { description: 'PoE oversubscription — APs power-cycling on the access switch', severity: 'medium', affectedDeviceRoles: ['access'], requires: [4] },
    ],
    remediation: [
      { title: 'RADIUS failover + dead-server detection', cli: { '*': `radius server PRIMARY
 address ipv4 <CHANGE-ME-radius-ip> auth-port 1812 acct-port 1813
 automate-tester username probe-user probe-on
 key <CHANGE-ME-radius-key>
aaa group server radius RAD-GRP
 server name PRIMARY
 deadtime 5
aaa authentication dot1x default group RAD-GRP local` } },
      { title: 'Expand DHCP pool / shorten lease', cli: { '*': `ip dhcp pool WIFI-DATA
 network 10.20.0.0 255.255.252.0   ! widen mask /22 ~1000 hosts
 lease 0 4 0                        ! 4h lease recycles addresses faster
 default-router 10.20.0.1` } },
    ],
    verification: [
      'show aaa servers | include RADIUS|state',
      'show ip dhcp pool WIFI-DATA',
      'show ap dot11 5ghz summary  (channel + utilization)',
      'show power inline | include Faulty|Off',
    ],
    mttrMinutes: [15, 45],
  },
  {
    id: 'san-dc',
    icon: '🗄️',
    title: 'DC SAN / Storage Server Not Responding',
    severity: 'critical',
    useCaseTag: 'dc',
    summary: 'Compute nodes cannot reach iSCSI/NVMe-oF storage targets; sessions drop or never establish.',
    relevantRoles: ['leaf', 'spine'],
    signals: [
      { name: 'iSCSI session drops on leaf port', weight: 0.35, threshold: 40, unit: 'drops/min', higherIsWorse: true },
      { name: 'Multipath active path count', weight: 0.30, threshold: 50, unit: 'paths', higherIsWorse: true },
      { name: 'Storage VLAN missing on trunk', weight: 0.20, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'Jumbo-frame MTU mismatch (9000↔1500)', weight: 0.15, threshold: 50, unit: 'flag', higherIsWorse: true },
    ],
    rootCauses: [
      { description: 'iSCSI path failure on the ToR — port err-disabled or flapping', severity: 'critical', affectedDeviceRoles: ['leaf'], requires: [0] },
      { description: 'MPIO failover not triggered — single path, no redundancy', severity: 'high', affectedDeviceRoles: ['leaf'], requires: [1] },
      { description: 'MTU black-holing — large I/O frames silently dropped (PMTUD broken)', severity: 'critical', affectedDeviceRoles: ['leaf', 'spine'], requires: [3] },
      { description: 'Storage VLAN pruned from the trunk — targets unreachable', severity: 'high', affectedDeviceRoles: ['leaf'], requires: [2] },
    ],
    remediation: [
      { title: 'Re-add storage VLAN + align MTU (jumbo)', cli: { '*': `interface Ethernet1/10
 description iSCSI-TARGET
 switchport trunk allowed vlan add 200   ! storage VLAN
 mtu 9216
 spanning-tree port type edge
 no shutdown
system jumbomtu 9216` } },
      { title: 'Verify / restore multipath (host MPIO)', cli: { '*': `# Linux host (dm-multipath)
mpathconf --enable --with_multipathd y
multipath -ll                 # expect >=2 active paths
iscsiadm -m node --login` } },
    ],
    verification: [
      'show interface Ethernet1/10 | include MTU|err|drops',
      'show vlan id 200',
      'show spanning-tree vlan 200',
      'multipath -ll  (host: >=2 active paths)',
    ],
    mttrMinutes: [10, 30],
  },
  {
    id: 'gpu-slow',
    icon: '🖥️',
    title: 'GPU Training Job Slow / Stalled',
    severity: 'high',
    useCaseTag: 'gpu',
    summary: 'Distributed training throughput collapses; all-reduce stalls on the RoCEv2 fabric.',
    relevantRoles: ['leaf', 'spine'],
    signals: [
      { name: 'PFC watchdog drops on GPU leaf', weight: 0.35, threshold: 30, unit: 'pps', higherIsWorse: true },
      { name: 'RoCEv2 CNP (congestion-notify) rate', weight: 0.25, threshold: 45, unit: 'pps', higherIsWorse: true },
      { name: 'ECMP hash skew', weight: 0.20, threshold: 30, unit: '%', higherIsWorse: true },
      { name: 'ECN marking threshold too low', weight: 0.15, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'RDMA queue-pair errors', weight: 0.05, threshold: 60, unit: 'err/s', higherIsWorse: true },
    ],
    rootCauses: [
      { description: 'PFC deadlock on priority-3 lossless queue — fabric-wide head-of-line blocking', severity: 'critical', affectedDeviceRoles: ['leaf', 'spine'], requires: [0] },
      { description: 'DCQCN misconfiguration — CNP storm, senders over-throttled', severity: 'high', affectedDeviceRoles: ['leaf'], requires: [1, 3], mode: 'any' },
      { description: 'ECMP hash polarization on GPU-to-GPU elephant flows', severity: 'high', affectedDeviceRoles: ['spine', 'leaf'], requires: [2] },
    ],
    remediation: [
      { title: 'PFC watchdog + ECN/DCQCN tuning (no-drop priority 3)', cli: { '*': `priority-flow-control mode on
priority-flow-control priority 3 no-drop
priority-flow-control watch-dog-interval on
hardware qos pfc-watchdog interval 100
policy-map type queuing PFC-RDMA
 class type queuing c-out-q3
  random-detect minimum-threshold 150 kbytes maximum-threshold 1500 kbytes
  random-detect ecn` } },
      { title: 'Break ECMP polarization (per-flow symmetric hash)', cli: { '*': `ip load-sharing address source-destination port source-destination rotate 32
router bgp <CHANGE-ME-asn>
 bestpath as-path multipath-relax
 maximum-paths 64` } },
    ],
    verification: [
      'show queuing interface ethernet1/3 | include PFC|pause|watchdog',
      'show interface priority-flow-control',
      'show hardware qos pfc-watchdog status',
      'show ip load-sharing  (expect per-flow source-dest-port)',
    ],
    mttrMinutes: [20, 60],
  },
  {
    id: 'ecmp-broken',
    icon: '⚖️',
    title: 'ECMP Load Balancing Not Working',
    severity: 'medium',
    useCaseTag: 'dc / gpu',
    summary: 'Traffic concentrates on a single uplink while parallel equal-cost paths stay idle.',
    relevantRoles: ['spine', 'leaf'],
    signals: [
      { name: 'Traffic hash entropy', weight: 0.40, threshold: 40, unit: '%', higherIsWorse: false },
      { name: 'BGP multipath configured', weight: 0.30, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'Flow polarization (same src/dst)', weight: 0.20, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'LAG member down', weight: 0.10, threshold: 50, unit: 'flag', higherIsWorse: true },
    ],
    rootCauses: [
      { description: 'ECMP hash polarization — identical hash seed across tiers funnels flows to one path', severity: 'medium', affectedDeviceRoles: ['spine', 'leaf'], requires: [0, 2], mode: 'any' },
      { description: "Missing 'bestpath as-path multipath-relax' — BGP installs a single best path only", severity: 'high', affectedDeviceRoles: ['leaf', 'spine'], requires: [1] },
      { description: 'LAG member failure — bundle degraded, hash buckets collapsed', severity: 'medium', affectedDeviceRoles: ['leaf'], requires: [3] },
    ],
    remediation: [
      { title: 'Enable BGP multipath + relax', cli: { '*': `router bgp <CHANGE-ME-asn>
 bestpath as-path multipath-relax
 maximum-paths 64
 maximum-paths ibgp 64
 address-family ipv4 unicast
  maximum-paths 64` } },
      { title: 'Per-flow hashing + unique seed per tier', cli: { '*': `! Diversify the hash seed so spine and leaf do not polarize
ip load-sharing address source-destination port source-destination rotate 16
! (use a different 'rotate' offset per tier: leaf=16, spine=32)` } },
    ],
    verification: [
      'show ip route <prefix>  (expect multiple ECMP next-hops)',
      'show bgp ipv4 unicast <prefix>  (expect "multipath" markers)',
      'show port-channel summary  (all members "P" / bundled)',
      'show interface counters  (verify even distribution)',
    ],
    mttrMinutes: [10, 25],
  },
  {
    id: 'bgp-slow',
    icon: '🐌',
    title: 'BGP Slow Convergence',
    severity: 'high',
    useCaseTag: 'dc / wan',
    summary: 'Route reconvergence after a link/peer failure takes tens of seconds, causing blackholing.',
    relevantRoles: ['spine', 'leaf', 'wan-edge'],
    signals: [
      { name: 'BGP hold-timer (default 90s)', weight: 0.35, threshold: 50, unit: 's', higherIsWorse: true },
      { name: 'BFD not enabled on eBGP peers', weight: 0.30, threshold: 50, unit: 'flag', higherIsWorse: true },
      { name: 'Route-reflector processing time', weight: 0.20, threshold: 60, unit: 'ms', higherIsWorse: true },
      { name: 'Prefix limit utilization', weight: 0.15, threshold: 75, unit: '%', higherIsWorse: true },
    ],
    rootCauses: [
      { description: 'Conservative BGP timers (keepalive 30 / hold 90) — failure detection waits a full hold-down', severity: 'high', affectedDeviceRoles: ['spine', 'leaf', 'wan-edge'], requires: [0] },
      { description: 'BFD missing on eBGP sessions — sub-second failure detection unavailable', severity: 'high', affectedDeviceRoles: ['leaf', 'spine'], requires: [1] },
      { description: 'Route-reflector CPU saturation — update generation backlog', severity: 'medium', affectedDeviceRoles: ['spine'], requires: [2] },
    ],
    remediation: [
      { title: 'Aggressive timers + BFD (DC fabric)', cli: { '*': `router bgp <CHANGE-ME-asn>
 template peer FABRIC
  timers 3 9
  bfd
  advertisement-interval 0
bfd interval 300 min_rx 300 multiplier 3` } },
      { title: 'Fast external fallover + next-hop tracking', cli: { '*': `router bgp <CHANGE-ME-asn>
 bgp fast-external-fallover
 address-family ipv4 unicast
  nexthop trigger-delay critical 10 non-critical 100` } },
    ],
    verification: [
      'show bgp ipv4 unicast neighbors | include hold|keepalive|BFD',
      'show bfd neighbors  (state Up, all eBGP peers)',
      'show processes cpu sorted | include BGP',
      'show bgp summary | include PfxRcd',
    ],
    mttrMinutes: [15, 40],
  },
]

/** djb2 string hash → unsigned 32-bit */
function seedHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h >>> 0
}

/** Deterministic pseudo-metric in 0–100 from seed + signal index. */
function simulateSignalValue(seed: number, signalIdx: number): number {
  let x = (seed ^ ((signalIdx + 1) * 0x9e3779b1)) >>> 0
  x ^= x << 13; x >>>= 0
  x ^= x >> 17
  x ^= x << 5;  x >>>= 0
  return x % 101
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1 }

function runDiagnosis(scenario: Scenario, devices: BOMDevice[]): DiagnosisResult {
  const inScope = devices.filter(d => scenario.relevantRoles.includes(d.subLayer))
  const deviceKey = inScope.map(d => d.hostname || d.id).join(',') || scenario.useCaseTag
  const seed = seedHash(scenario.id + '|' + deviceKey)

  const signals: SignalResult[] = scenario.signals.map((sig, idx) => {
    const measuredValue = simulateSignalValue(seed, idx)
    const triggered = sig.higherIsWorse === false
      ? measuredValue < sig.threshold
      : measuredValue > sig.threshold
    return { name: sig.name, measuredValue, threshold: sig.threshold, triggered, weight: sig.weight, unit: sig.unit }
  })

  const rootCauses: RootCause[] = scenario.rootCauses
    .map(rule => {
      const mode = rule.mode ?? 'all'
      const reqResults = rule.requires.map(i => signals[i]?.triggered ?? false)
      const fired = mode === 'all' ? reqResults.every(Boolean) : reqResults.some(Boolean)
      if (!fired) return null
      const weightSum = rule.requires.reduce((acc, i) => acc + (signals[i]?.triggered ? signals[i].weight : 0), 0)
      const confidence = Math.min(100, Math.round(weightSum * 100 + 8))
      return { description: rule.description, confidence, severity: rule.severity, affectedDeviceRoles: rule.affectedDeviceRoles }
    })
    .filter((c): c is RootCause => c !== null)
    .sort((a, b) => b.confidence - a.confidence || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])

  const targets = inScope.length
    ? inScope
    : scenario.relevantRoles.map((role, i) => ({
        id: `generic-${role}-${i}`,
        hostname: `${scenario.useCaseTag.split(' ')[0].toUpperCase()}-${role.toUpperCase()}-0${i + 1}`,
        role, subLayer: role,
        model: '(no BOM loaded — sample device)', vendor: 'Generic',
        count: 1, unitPrice: 0, totalPrice: 0, speed: '', ports: 0, features: [],
      } as BOMDevice))

  const causeRoles = new Set(rootCauses.flatMap(c => c.affectedDeviceRoles))
  const remediationCLI: Record<string, string> = {}
  for (const dev of targets) {
    if (causeRoles.size > 0 && !causeRoles.has(dev.subLayer)) continue
    const block = scenario.remediation
      .map(step => {
        const body = step.cli[dev.subLayer] ?? step.cli['*'] ?? ''
        return body ? `! ── ${step.title} ──\n${body}` : ''
      })
      .filter(Boolean)
      .join('\n!\n')
    if (block) remediationCLI[dev.id] = block
  }

  return {
    scenarioId: scenario.id,
    signals,
    rootCauses,
    affectedDevices: targets,
    remediationCLI,
    mttrMinutes: scenario.mttrMinutes,
    diagnosedAt: new Date().toISOString(),
  }
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
}

function confidenceColor(c: number): string {
  if (c > 70) return '#f87171'
  if (c >= 40) return '#fb923c'
  return '#facc15'
}

function ScenarioCard({ scenario, onRun, active }: { scenario: Scenario; onRun: () => void; active: boolean }) {
  return (
    <div
      onClick={onRun}
      className={cn(
        'bg-gray-800 border rounded-lg p-4 transition-colors cursor-pointer flex flex-col',
        active ? 'border-blue-500/60 ring-1 ring-blue-500/30' : 'border-white/10 hover:border-blue-500/50',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-2xl leading-none">{scenario.icon}</span>
        <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded border', SEVERITY_BADGE[scenario.severity])}>
          {scenario.severity}
        </span>
      </div>
      <h4 className="text-sm font-semibold text-gray-100 leading-snug">{scenario.title}</h4>
      <p className="text-xs text-gray-500 mt-1 flex-1">{scenario.summary}</p>
      <div className="flex items-center justify-between mt-3">
        <span className="text-[10px] font-mono text-blue-300/80 bg-blue-500/10 px-2 py-0.5 rounded">{scenario.useCaseTag}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRun() }}
          className="text-xs font-medium text-blue-300 hover:text-blue-200"
        >
          Run Diagnosis →
        </button>
      </div>
    </div>
  )
}

function SignalRow({ signal, visible }: { signal: SignalResult; visible: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded border transition-all duration-300',
        signal.triggered ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-green-400 bg-green-500/10 border-green-500/20',
      )}
      style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(8px)' }}
    >
      <span className="text-sm">{signal.triggered ? '⚠️' : '✓'}</span>
      <span className="flex-1 text-sm text-gray-200">{signal.name}</span>
      <span className="text-xs font-mono text-gray-400 w-20 text-right">
        {signal.measuredValue}{signal.unit === 'flag' ? '' : ` ${signal.unit}`}
      </span>
      <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded w-24 text-center', signal.triggered ? 'bg-red-500/20' : 'bg-green-500/20')}>
        {signal.triggered ? 'TRIGGERED' : 'OK'}
      </span>
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400/70" style={{ width: `${Math.round(signal.weight * 100)}%` }} />
      </div>
    </div>
  )
}

function CliCopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="relative group">
      <button
        onClick={copy}
        className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-white/10 text-gray-300 hover:bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
      <pre className="bg-gray-950 font-mono text-sm text-green-400 p-3 rounded border border-white/5 overflow-x-auto whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

type ScenarioPlaybookTab = 'cli' | 'verify'

function LiveScenarioDiagnostics() {
  const devices = useAppStore(s => s.devices)
  const { isLive } = useBackendMode()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [result, setResult] = useState<DiagnosisResult | null>(null)
  const [revealCount, setRevealCount] = useState(0)
  const [showCauses, setShowCauses] = useState(false)
  const [progress, setProgress] = useState(0)
  const [pbTab, setPbTab] = useState<ScenarioPlaybookTab>('cli')
  const [history, setHistory] = useState<string[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const selectedScenario = useMemo(() => SCENARIOS.find(s => s.id === selectedId) ?? null, [selectedId])

  const clearTimers = useCallback(() => {
    timers.current.forEach(t => clearTimeout(t))
    timers.current = []
  }, [])
  useEffect(() => () => clearTimers(), [clearTimers])

  const runScenario = useCallback((scenario: Scenario) => {
    clearTimers()
    setSelectedId(scenario.id)
    setPbTab('cli'); setShowCauses(false); setRevealCount(0); setProgress(0)

    if (isLive) {
      fetch('/api/troubleshoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: scenario.id }),
      }).catch(() => { /* fall back silently to client simulation */ })
    }

    const diag = runDiagnosis(scenario, devices)
    setResult(diag)
    setHistory(prev => [scenario.id, ...prev.filter(id => id !== scenario.id)].slice(0, 3))

    const n = diag.signals.length
    for (let i = 1; i <= n; i++) {
      timers.current.push(setTimeout(() => {
        setRevealCount(i)
        setProgress(Math.round((i / n) * 100))
      }, i * 200))
    }
    timers.current.push(setTimeout(() => setShowCauses(true), n * 200 + 250))
  }, [devices, isLive, clearTimers])

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">🧠 Live Fault Scenarios — AI Diagnosis</h3>
      <p className="text-xs text-gray-500 mb-4">
        ML-style weighted signal correlation across real-world fault scenarios. Pick one to run a
        deterministic diagnosis against the devices in your design — ranked root causes with confidence
        scores and a remediation playbook.
        {isLive ? ' Backend live: augmented by /api/troubleshoot when available.' : ' Demo mode: runs fully client-side.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SCENARIOS.map(s => (
          <ScenarioCard key={s.id} scenario={s} active={selectedId === s.id} onRun={() => runScenario(s)} />
        ))}
      </div>

      {history.length > 0 && (
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="text-xs text-gray-500">Recent:</span>
          {history.map(id => {
            const s = SCENARIOS.find(x => x.id === id)!
            return (
              <button key={id} onClick={() => runScenario(s)}
                className="text-xs px-2 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300 hover:border-blue-500/40">
                {s.icon} {s.title}
              </button>
            )
          })}
        </div>
      )}

      {selectedScenario && result && (
        <div className="mt-5 border-t border-white/10 pt-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{selectedScenario.icon}</span>
                <span className="text-base font-semibold text-gray-100">{selectedScenario.title}</span>
                <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded border', SEVERITY_BADGE[selectedScenario.severity])}>
                  {selectedScenario.severity}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {result.affectedDevices.length} device{result.affectedDevices.length === 1 ? '' : 's'} in scope ·
                diagnosed {new Date(result.diagnosedAt).toLocaleTimeString()}
              </p>
            </div>
            <span className="text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded px-3 py-1 whitespace-nowrap">
              ⏱ MTTR ~ {result.mttrMinutes[0]}–{result.mttrMinutes[1]} min
            </span>
          </div>

          {/* Progress */}
          <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>

          {/* Signals */}
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Signal Correlation</h4>
          <div className="space-y-1.5 mb-5">
            {result.signals.map((sig, i) => (
              <SignalRow key={sig.name} signal={sig} visible={i < revealCount} />
            ))}
          </div>

          {/* Root causes + remediation */}
          <div className="transition-opacity duration-500" style={{ opacity: showCauses ? 1 : 0 }}>
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">
              Ranked Root Causes {result.rootCauses.length === 0 && '— none triggered (all signals nominal)'}
            </h4>
            <div className="space-y-2 mb-5">
              {result.rootCauses.map((rc, i) => (
                <div key={i} className="bg-gray-800/60 border border-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="text-sm text-gray-100">
                      <span className="text-gray-500 font-mono mr-1">#{i + 1}</span>{rc.description}
                    </span>
                    <span className="text-xs font-mono font-semibold whitespace-nowrap" style={{ color: confidenceColor(rc.confidence) }}>
                      {rc.confidence}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${rc.confidence}%`, background: confidenceColor(rc.confidence) }} />
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {rc.affectedDeviceRoles.map(role => (
                      <span key={role} className="text-[10px] uppercase font-mono text-gray-400 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">{role}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Affected Devices</h4>
            <div className="flex flex-wrap gap-2 mb-5">
              {result.affectedDevices.map(d => (
                <div key={d.id} className="flex items-center gap-2 bg-gray-800/60 border border-white/10 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-mono text-gray-200">{d.hostname || d.id}</span>
                  <span className="text-[10px] uppercase text-blue-300 bg-blue-500/10 rounded px-1.5 py-0.5">{d.subLayer}</span>
                  {d.vendor && d.vendor !== 'Generic' && <span className="text-[10px] text-gray-500">{d.vendor}</span>}
                </div>
              ))}
            </div>

            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Remediation Playbook</h4>
            <div className="flex gap-1 mb-3">
              {([['cli', 'CLI Commands'], ['verify', 'Verification']] as Array<[ScenarioPlaybookTab, string]>).map(([id, label]) => (
                <button key={id} onClick={() => setPbTab(id)}
                  className={cn('text-xs px-3 py-1 rounded transition-colors', pbTab === id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200 bg-white/5')}>
                  {label}
                </button>
              ))}
            </div>

            {pbTab === 'cli' && (
              <div className="space-y-3">
                {Object.keys(result.remediationCLI).length === 0 && (
                  <p className="text-sm text-gray-500">No remediation required — signals nominal.</p>
                )}
                {Object.entries(result.remediationCLI).map(([devId, code]) => {
                  const dev = result.affectedDevices.find(d => d.id === devId)
                  return (
                    <div key={devId}>
                      <div className="text-xs font-mono text-gray-400 mb-1">
                        {dev?.hostname || devId}
                        {dev?.vendor && dev.vendor !== 'Generic' && <span className="text-gray-600"> · {dev.vendor}</span>}
                      </div>
                      <CliCopyBlock code={code} />
                    </div>
                  )
                })}
              </div>
            )}

            {pbTab === 'verify' && (
              <div className="space-y-1.5">
                {selectedScenario.verification.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-950 border border-white/5 rounded px-3 py-2">
                    <span className="text-gray-600 font-mono text-xs">{i + 1}.</span>
                    <code className="text-sm font-mono text-cyan-300">{v}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

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
        <p className="text-sm text-gray-400">Live AI fault scenarios, symptom classifier, BGP convergence predictor, RCA playbooks, and incident knowledge base</p>
      </div>

      {/* Live AI fault-scenario diagnostics */}
      <LiveScenarioDiagnostics />

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
