import type { IntentObject } from '../types/intent';
import type { DeviceEntry } from './bom';

export interface SymptomEntry {
  id: string;
  cat: string;
  symptom: string;
  causes: string[];
  fix: string;
  cmds: {
    nxos?: string[];
    eos?: string[];
    junos?: string[];
    sonic?: string[];
    iosxe?: string[];
    iosxr?: string[];
  };
}

export const SYMPTOM_DB: SymptomEntry[] = [

  // ── BGP ──────────────────────────────────────────────────────────────────
  { id:'BGP-01', cat:'BGP', symptom:'BGP neighbor stuck in Idle state',
    causes:['TCP reachability failure','ACL blocking port 179','Wrong source interface'],
    fix:'Verify TCP reachability: ping <neighbor> source <lo0>. Check ACLs on both ends.',
    cmds:{ nxos:['show bgp neighbors <ip>','show bgp summary','ping <ip> source loopback0'],
           eos: ['show bgp neighbors <ip>','show bgp summary','ping <ip> source loopback0'],
           junos:['show bgp neighbor <ip>','show bgp summary','ping <ip> routing-instance default'],
           sonic:['vtysh -c "show bgp neighbors <ip>"','vtysh -c "show bgp summary"'] }},

  { id:'BGP-02', cat:'BGP', symptom:'BGP neighbor in Active state (TCP connection failing)',
    causes:['Route to neighbor missing','Wrong update-source','BGP password mismatch'],
    fix:'Check "show ip route <neighbor>". Verify update-source loopback. Check MD5 key.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc State','show ip route <ip>','show run bgp | inc password'],
           eos: ['show bgp neighbors <ip>','show ip route <ip>'],
           junos:['show bgp neighbor <ip>','show route <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip>"','ip route show <ip>'] }},

  { id:'BGP-03', cat:'BGP', symptom:'BGP session flapping repeatedly',
    causes:['BFD misconfiguration','Hold timer too low','MTU mismatch on P2P link','CPU overload'],
    fix:'Check BFD timers match both ends. Verify MTU with "ping size 9100 df-bit". Check CPU.',
    cmds:{ nxos:['show bgp neighbors <ip> flap-statistics','show bfd neighbors','show ip mtu'],
           eos: ['show bgp neighbors <ip>','show bfd peers','ping <ip> size 9100 df-bit'],
           junos:['show bgp neighbor <ip>','show bfd session'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-04', cat:'BGP', symptom:'BGP neighbor established but no routes received',
    causes:['Missing send-community','No network/redistribute statement','Route-map filtering all'],
    fix:'Verify send-community extended. Check inbound route-maps. Verify neighbor advertises prefixes.',
    cmds:{ nxos:['show bgp neighbors <ip> received-routes','show bgp neighbors <ip> | inc Community'],
           eos: ['show bgp neighbors <ip> received-routes','show bgp neighbors <ip> advertised-routes'],
           junos:['show bgp neighbor <ip> received-routes','show route receive-protocol bgp <ip>'],
           sonic:['vtysh -c "show bgp neighbors <ip> received-routes"'] }},

  { id:'BGP-05', cat:'BGP', symptom:'BGP routes not installed in RIB (best-path not selected)',
    causes:['Higher AD from another protocol','AS path loop (iBGP)','ECMP disabled','Next-hop unreachable'],
    fix:'Check "show bgp <prefix> detail" for best-path selection. Verify next-hop reachability.',
    cmds:{ nxos:['show bgp <prefix>','show ip route <prefix>','show bgp nexthop'],
           eos: ['show bgp <prefix> detail','show ip route <prefix>'],
           junos:['show route <prefix> detail','show bgp summary'],
           sonic:['vtysh -c "show bgp <prefix>"','ip route show <prefix>'] }},

  { id:'BGP-06', cat:'BGP', symptom:'BGP prefix limit reached — neighbor shutdown',
    causes:['Unexpected route leak','Route reflector sending full table','No maximum-prefix warning'],
    fix:'Temporarily raise maximum-prefix with warning-only. Identify leak source with received-routes.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc prefix','show bgp <vrf> all summary'],
           eos: ['show bgp neighbors <ip> | grep "maximum prefix"','show bgp summary'],
           junos:['show bgp neighbor <ip> | match "prefix"'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-07', cat:'BGP', symptom:'BGP convergence slow after link failure (>30s)',
    causes:['BGP hold timer default 180s','BFD not configured','No advertisement-interval 0'],
    fix:'Enable BFD. Set timers to 3/9 (DC) or 10/30 (WAN). Set advertisement-interval 0.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc timer','show bfd neighbors'],
           eos: ['show bgp neighbors <ip> | grep "BGP state"','show bfd peers'],
           junos:['show bgp neighbor <ip> | match "timer"','show bfd session'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  { id:'BGP-08', cat:'BGP', symptom:'eBGP ECMP paths not installed (CLOS fabric)',
    causes:['Missing bestpath as-path multipath-relax','Maximum-paths not configured','Different AS paths'],
    fix:'Add "bestpath as-path multipath-relax" and "maximum-paths 8" under BGP.',
    cmds:{ nxos:['show bgp <prefix>','show run bgp | inc multipath'],
           eos: ['show bgp <prefix> detail','show run | section router bgp'],
           junos:['show route forwarding-table destination <prefix>'],
           sonic:['vtysh -c "show bgp <prefix> detail"'] }},

  { id:'BGP-09', cat:'BGP', symptom:'BGP route reflector not reflecting routes to clients',
    causes:['Missing route-reflector-client under neighbor','Cluster-ID misconfiguration','Originator-ID loop'],
    fix:'Verify "route-reflector-client" configured. Check cluster-id matches across RR cluster.',
    cmds:{ nxos:['show bgp neighbors <ip> | inc reflector','show bgp <prefix>'],
           eos: ['show bgp neighbors <ip>','show bgp <prefix> detail'],
           junos:['show bgp neighbor <ip>','show route <prefix> detail'],
           sonic:['vtysh -c "show bgp neighbors <ip>"'] }},

  // ── EVPN ─────────────────────────────────────────────────────────────────
  { id:'EVPN-01', cat:'EVPN', symptom:'EVPN Type-2 (MAC/IP) routes not being advertised',
    causes:['NVE interface not up','VNI not mapped to VLAN','EVPN address-family not activated under BGP'],
    fix:'Verify NVE interface is up. Check "show nve interface". Verify EVPN AF active.',
    cmds:{ nxos:['show nve interface','show bgp l2vpn evpn summary','show evpn evi'],
           eos: ['show bgp evpn','show vxlan address-table','show interfaces vxlan1'],
           junos:['show evpn instance','show bgp summary','show route table bgp.evpn.0'] }},

  { id:'EVPN-02', cat:'EVPN', symptom:'EVPN Type-3 (IMET) routes missing — BUM traffic flooding broken',
    causes:['Ingress replication not configured','Multicast underlay not set up','VTEP not in peer list'],
    fix:'Check ingress-replication protocol bgp in NVE config. Verify IMET routes in BGP.',
    cmds:{ nxos:['show bgp l2vpn evpn | inc IMET','show nve peers','show nve vni'],
           eos: ['show bgp evpn route-type imet','show vxlan vtep','show interfaces vxlan1'],
           junos:['show route table bgp.evpn.0 match-prefix "3:"'] }},

  { id:'EVPN-03', cat:'EVPN', symptom:'VMs in same VLAN cannot communicate across VTEPs',
    causes:['ARP suppression blocking unknown ARP','Anycast gateway MAC not consistent','VNI mismatch'],
    fix:'Check ARP suppression state. Verify anycast-gateway MAC is the same on all leafs.',
    cmds:{ nxos:['show ip arp suppression-cache','show vlan id <vlan>','show nve vni'],
           eos: ['show bgp evpn route-type macip','show arp','show vxlan address-table'],
           junos:['show evpn database','show arp'] }},

  { id:'EVPN-04', cat:'EVPN', symptom:'Asymmetric IRB not routing between VLANs',
    causes:['SVI missing on leaf','VRF not configured','Route-target mismatch'],
    fix:'Verify SVI exists for every VLAN on every leaf. Check VRF RT import/export matches.',
    cmds:{ nxos:['show ip interface brief','show vrf','show bgp l2vpn evpn | inc RT'],
           eos: ['show ip interface brief','show bgp evpn route-type prefix'],
           junos:['show evpn instance','show route table <vrf>.inet.0'] }},

  // ── STP ──────────────────────────────────────────────────────────────────
  { id:'STP-01', cat:'STP', symptom:'STP topology change (TCN) flooding MAC table',
    causes:['PortFast not enabled on host ports','Rogue BPDU on uplink','Flapping edge port'],
    fix:'Enable PortFast on all host-facing ports. Enable BPDU Guard. Check logs for port events.',
    cmds:{ nxos:['show spanning-tree detail | inc "Number of topology"','show spanning-tree inconsistentports'],
           eos: ['show spanning-tree topology change','show spanning-tree detail'],
           junos:['show spanning-tree bridge','show spanning-tree statistics'] }},

  { id:'STP-02', cat:'STP', symptom:'STP root bridge elected on unexpected switch',
    causes:['Default priority (32768) — switch with lowest MAC wins','Priority not configured'],
    fix:'Set "spanning-tree vlan <X> priority 4096" on intended root. Use root guard on non-root ports.',
    cmds:{ nxos:['show spanning-tree vlan <vlan> | inc Root','show spanning-tree bridge'],
           eos: ['show spanning-tree root','show spanning-tree detail'],
           junos:['show spanning-tree bridge'] }},

  { id:'STP-03', cat:'STP', symptom:'BPDU Guard triggered — port in error-disabled state',
    causes:['Hub or unmanaged switch connected to PortFast port','Rogue switch on access segment'],
    fix:'Identify device on err-disabled port. Remove rogue switch. Re-enable: "shut/no shut" or auto-recovery.',
    cmds:{ nxos:['show interface status err-disabled','show log | inc BPDU'],
           eos: ['show interfaces status err-disabled','show log last 50'],
           junos:['show interfaces extensive | match "error|BPDU"'] }},

  // ── QoS ──────────────────────────────────────────────────────────────────
  { id:'QOS-01', cat:'QoS', symptom:'VoIP/video traffic experiencing high jitter',
    causes:['EF/AF41 not prioritised','DSCP markings stripped at network boundary','Insufficient bandwidth'],
    fix:'Verify DSCP markings preserved. Check EF queue is strict-priority. Monitor queue drops.',
    cmds:{ nxos:['show queueing interface <if>','show policy-map interface <if>'],
           eos: ['show qos interface <if>','show policy-map type qos <name>'],
           junos:['show class-of-service interface <if>','show interfaces queue <if>'] }},

  { id:'QOS-02', cat:'QoS', symptom:'DSCP markings being reset to CS0 (best-effort)',
    causes:['No trust DSCP at ingress','Overwriting policy applied','Upstream device not marking'],
    fix:'Apply "mls qos trust dscp" (IOS) / "qos trust dscp" (NX-OS) on all uplinks.',
    cmds:{ nxos:['show running-config interface <if> | inc qos','show policy-map interface <if>'],
           eos: ['show qos interface <if>','show policy-map interface <if>'],
           junos:['show class-of-service interface <if>','show firewall filter'] }},

  // ── WAN ──────────────────────────────────────────────────────────────────
  { id:'WAN-01', cat:'WAN', symptom:'SD-WAN tunnel not forming (vEdge to vSmart)',
    causes:['DTLS port 12346 blocked','vBond not reachable','Certificate mismatch'],
    fix:'Verify DTLS 12346 not blocked. Confirm vBond IP reachable. Check certificates.',
    cmds:{ iosxe:['show sdwan control connections','show sdwan control connection-history','show sdwan certificate validity'] }},

  { id:'WAN-02', cat:'WAN', symptom:'DMVPN hub-to-spoke tunnel down',
    causes:['NHRP registration failed','IPsec phase-1 failure','NAT translation issue'],
    fix:'Check NHRP: "show dmvpn detail". Verify IPsec: "show crypto isakmp sa". Check NAT translations.',
    cmds:{ iosxe:['show dmvpn detail','show crypto isakmp sa','show crypto ipsec sa','show ip nhrp'] }},

  // ── Routing ──────────────────────────────────────────────────────────────
  { id:'ROUTE-01', cat:'Routing', symptom:'OSPF neighbors stuck in EXSTART or EXCHANGE',
    causes:['MTU mismatch','Duplicate router-id','Authentication mismatch'],
    fix:'Check MTU mismatch: "ip ospf mtu-ignore" as workaround. Verify unique router-ids.',
    cmds:{ nxos:['show ip ospf neighbor detail','show ip ospf interface'],
           eos: ['show ip ospf neighbor detail','show ip ospf'],
           junos:['show ospf neighbor detail','show ospf interface'] }},

  { id:'ROUTE-02', cat:'Routing', symptom:'IS-IS adjacency not forming',
    causes:['Area type mismatch (L1 vs L2)','Hello authentication failure','NET address error'],
    fix:'Verify IS-IS level matches. Check authentication key. Verify NET format (49.xxxx.xxxx.xxxx.00).',
    cmds:{ nxos:['show isis adjacency','show isis interface','show isis database'],
           eos: ['show isis adjacency','show isis interface'],
           junos:['show isis adjacency','show isis interface detail'] }},

  // ── Interface / Physical ─────────────────────────────────────────────────
  { id:'IF-01', cat:'Interface', symptom:'Interface input errors increasing rapidly',
    causes:['Duplex mismatch','Cable or SFP fault','CRC errors from bad fiber connection'],
    fix:'Check duplex: "show interface <if>". Replace SFP or cable. Clean fiber connector.',
    cmds:{ nxos:['show interface <if>','show interface <if> counters errors'],
           eos: ['show interfaces <if>','show interfaces <if> counters errors'],
           junos:['show interfaces <if> extensive','show interfaces diagnostics optics <if>'],
           sonic:['show interfaces counters <if>','ip link show <if>'] }},

  { id:'IF-02', cat:'Interface', symptom:'Port flapping (carrier transitions)',
    causes:['SFP power level out of range','Fiber contamination','Faulty cable'],
    fix:'Check Tx/Rx power: "show interfaces diagnostics". Check fiber physical layer.',
    cmds:{ nxos:['show interface <if> transceiver','show log | inc LINEPROTO'],
           eos: ['show interfaces <if> transceiver','show log | grep LINEPROTO'],
           junos:['show interfaces diagnostics optics <if>','show log messages | match "link"'] }},

  // ── CPU / System ─────────────────────────────────────────────────────────
  { id:'CPU-01', cat:'CPU', symptom:'High CPU utilization on control plane',
    causes:['BGP/OSPF route churn','ACL logging flooding CPU','ARP/MAC storm'],
    fix:'Identify top process. Check for BGP prefix limit, routing loops, broadcast storms.',
    cmds:{ nxos:['show processes cpu sort','show system resources','show ip traffic'],
           eos: ['show processes top once','show system environment all','show ip counters'],
           junos:['show system processes extensive','show chassis routing-engine'],
           sonic:['top -b -n1','cat /proc/loadavg'] }},

  { id:'CPU-02', cat:'CPU', symptom:'Punt police drop counter increasing',
    causes:['ICMP storm','Control plane ACL not configured','SSH scanning'],
    fix:'Apply CoPP policy. Rate-limit ICMP. Block external SSH scanning with iACL.',
    cmds:{ nxos:['show copp status','show policy-map interface control-plane'],
           eos: ['show platform trident counters','show policy-map interface control-plane'],
           junos:['show firewall filter __default_bpdu_filter__','show ddos-protection protocols statistics'] }},

  // ── ZTP / Day-0 ──────────────────────────────────────────────────────────
  { id:'ZTP-01', cat:'ZTP', symptom:'Device not downloading ZTP script from DHCP option 67',
    causes:['DHCP server not providing option 67','TFTP/HTTP server unreachable','Wrong filename in option'],
    fix:'Check DHCP lease: "debug dhcp detail". Verify TFTP service. Confirm filename matches.',
    cmds:{ nxos:['show dhcp lease','debug dhcp detail','show poap status'],
           eos: ['show zerotouch','show dhcp lease'],
           iosxe:['show pnp status','debug pnp trace'] }},

  { id:'ZTP-02', cat:'ZTP', symptom:'ZTP script runs but config not applied (callback missing)',
    causes:['Script error (check syslog)','HTTP callback URL unreachable','Python syntax error in script'],
    fix:'SSH to device. Check /tmp/ for error logs. Manually run script. Verify callback URL.',
    cmds:{ nxos:['show poap log','debug poap'],
           eos: ['show zerotouch detail','bash sudo cat /var/log/messages | grep ZTP'],
           iosxe:['show pnp status','show log | inc PnP'] }},

  // ── Storage ──────────────────────────────────────────────────────────────
  { id:'STOR-01', cat:'Storage', symptom:'NVMe-oF over RoCEv2 — high latency / packet loss',
    causes:['PFC not enabled','ECN thresholds not configured','Queue congestion on storage leaf'],
    fix:'Verify PFC enabled on RoCEv2 VLAN. Check ECN/DSCP marking on storage traffic.',
    cmds:{ nxos:['show queuing interface <if>','show interface <if> priority-flow-control','show hardware access-list resources'] }},

  { id:'STOR-02', cat:'Storage', symptom:'FC zone not allowing initiator to see target LUNs',
    causes:['Zone not in active zoneset','WWN typo in zone member','Zoneset not committed'],
    fix:'Check active zoneset. Verify WWNs. Run "zoneset activate" after changes.',
    cmds:{ nxos:['show zone active','show zone member <wwn>','show zoneset active','show flogi database'] }},
];

export const SYMPTOM_CATEGORIES = [...new Set(SYMPTOM_DB.map((e) => e.cat))];

function matchScore(entry: SymptomEntry, query: string): number {
  const q = query.toLowerCase();
  const fields = [
    entry.symptom,
    entry.id,
    entry.cat,
    entry.fix,
    ...entry.causes,
  ].join(' ').toLowerCase();
  if (!fields.includes(q)) return 0;
  // Boost: id exact match
  if (entry.id.toLowerCase() === q) return 100;
  // Boost: symptom contains query
  if (entry.symptom.toLowerCase().includes(q)) return 10;
  return 1;
}

export function classifySymptom(query: string, category?: string): SymptomEntry[] {
  let results = SYMPTOM_DB.filter((e) => {
    if (category && category !== 'All' && e.cat !== category) return false;
    if (!query.trim()) return true;
    return matchScore(e, query.trim()) > 0;
  });
  if (query.trim()) {
    results = results.sort((a, b) => matchScore(b, query.trim()) - matchScore(a, query.trim()));
  }
  return results;
}

// ─── BGP Convergence Predictor ───────────────────────────────────────────────

export interface ConvergencePhase {
  phase: string;
  ms: number;
  note: string;
}

export interface ConvergenceSlaTarget {
  target_ms: number;
  label: string;
}

export interface ConvergenceEstimate {
  best_ms: number;
  worst_ms: number;
  breakdown: ConvergencePhase[];
  warnings: string[];
  sla: ConvergenceSlaTarget;
  meets_sla: boolean;
}

export interface ConvergenceParams {
  hold_timer?: number;
  adv_interval?: number;
  route_count?: number;
  has_bfd?: boolean;
  has_rr?: boolean;
  rr_count?: number;
  use_case?: string;
}

const SLA_TARGETS: Record<string, ConvergenceSlaTarget> = {
  dc_fabric:  { target_ms: 1000,  label: 'DC Fabric < 1s'     },
  gpu_cluster:{ target_ms: 500,   label: 'GPU Cluster < 500ms' },
  wan:        { target_ms: 30000, label: 'WAN < 30s'           },
  campus:     { target_ms: 10000, label: 'Campus < 10s'        },
  multisite:  { target_ms: 5000,  label: 'Multi-site < 5s'     },
  sp_mpls:    { target_ms: 2000,  label: 'SP/MPLS < 2s'        },
};

export function bgpConvergencePredictor(
  params: ConvergenceParams,
  _intent?: IntentObject,
  _devices?: DeviceEntry[],
): ConvergenceEstimate {
  const hold_timer   = params.hold_timer   ?? 90;
  const adv_interval = params.adv_interval ?? (params.use_case === 'dc_fabric' ? 0 : 5);
  const route_count  = params.route_count  ?? 10000;
  const has_bfd      = params.has_bfd      ?? false;
  const has_rr       = params.has_rr       ?? false;
  const rr_count     = params.rr_count     ?? 0;
  const use_case     = params.use_case     ?? 'dc_fabric';
  const scanner_ms   = 60000;

  const breakdown: ConvergencePhase[] = [];
  const warnings: string[] = [];

  // 1. Failure detection
  const detection_ms = has_bfd ? 900 : hold_timer * 1000;
  if (has_bfd) {
    breakdown.push({ phase: 'Failure Detection (BFD)', ms: detection_ms, note: '300ms interval × 3 multiplier' });
  } else {
    breakdown.push({ phase: 'Failure Detection (hold timer)', ms: detection_ms, note: `${hold_timer}s hold timer — no BFD` });
    if (hold_timer >= 90) warnings.push(`Hold timer is ${hold_timer}s. Use BFD + DC Aggressive timers (3/9s) for sub-second detection.`);
  }

  // 2. Best-path recalculation (~50ms per 1K prefixes)
  const calc_ms = Math.ceil(route_count / 1000) * 50;
  breakdown.push({ phase: 'Best-path Recalculation', ms: calc_ms, note: `${route_count.toLocaleString()} routes × 50ms/1K` });

  // 3. Advertisement interval
  const update_ms = adv_interval * 1000;
  if (adv_interval > 0) {
    breakdown.push({ phase: 'Advertisement Interval', ms: update_ms, note: `${adv_interval}s MRAI` });
    if (adv_interval >= 5 && (use_case === 'dc_fabric' || use_case === 'gpu_cluster')) {
      warnings.push(`MRAI of ${adv_interval}s is too high for DC fabric. Set advertisement-interval 0.`);
    }
  }

  // 4. RR propagation
  const rr_ms = (has_rr && rr_count > 0) ? rr_count * (adv_interval * 1000 + 10) : 0;
  if (rr_ms > 0) {
    breakdown.push({ phase: 'Route Reflector Propagation', ms: rr_ms, note: `${rr_count} RR level(s)` });
  }

  // 5. BGP scanner (indirect next-hop without BFD)
  if (!has_bfd) {
    breakdown.push({ phase: 'BGP Scanner (indirect NH)', ms: scanner_ms, note: 'Worst case: 60s scanner cycle' });
    warnings.push('Without BFD, indirect next-hop changes rely on 60s BGP scanner. Enable BFD on all peers.');
  }

  // 6. FIB programming (~100ms per 5K routes)
  const fib_ms = Math.ceil(route_count / 5000) * 100;
  breakdown.push({ phase: 'FIB / Hardware Programming', ms: fib_ms, note: `${route_count.toLocaleString()} routes → ASIC` });

  const best_ms  = detection_ms + calc_ms + fib_ms;
  const worst_ms = detection_ms + calc_ms + update_ms + rr_ms + (has_bfd ? 0 : scanner_ms) + fib_ms;
  const sla      = SLA_TARGETS[use_case] ?? SLA_TARGETS['dc_fabric'];

  return { best_ms, worst_ms, breakdown, warnings, sla, meets_sla: worst_ms <= sla.target_ms };
}
