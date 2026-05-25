# CLAUDE.md — NetDesign AI (NDAL)
> Claude Code context file. Read this first on every session. Do not re-explain what is already here.

---

## 1. Project Identity

| Key | Value |
|-----|-------|
| Name | NetDesign AI (NDAL v1.0) |
| Type | Browser-native, AI-powered, intent-driven network design & automation tool |
| Stack | Vanilla JS/HTML/CSS frontend · Python (Flask) backend · Nornir + Netmiko · Claude API (Anthropic) |
| Author | Amit Tiwari — solo build via Claude Code |
| Deployment | Docker Compose (local/offline) · GitHub Pages (demo) |
| Repo | https://github.com/Amit33-design/Network-Automation |
| Live demo | https://netdesignai.com |

---

## 2. Architecture — Read Before Every Session

```
INTENT OBJECT (JSON)  ←  single source of truth for everything downstream
       │
       ├─ Step 1: Use Case selection (7 use cases)
       ├─ Step 2: Requirements form → populates intent fields
       ├─ Step 3: AI hardware scoring → BOM (40+ SKUs, 13 signals)
       ├─ Step 4: Auto-topology HLD/LLD (SVG + tables)
       ├─ Step 5: Config generator (per-device, per-platform)
       └─ Step 6: Deploy & Validate (pre-checks → push → post-checks → rollback)

Sidebar tools (independent of 6-step flow):
  📡 ZTP          — POAP · EOS-ZTP · PnP · Junos-ZTP
  📊 Monitoring   — Prometheus rules export · Grafana dashboard export
  🔬 Troubleshoot — CDP/LLDP discovery · symptom classifier · RCA engine
  ✅ Approvals    — 4-eyes change management
  🔌 Integrations — Slack · ServiceNow · Jira · GitHub · NetBox
```

### Supported platforms (config generation)
`IOS-XE` · `NX-OS` · `Arista EOS` · `Juniper JunOS` · `NVIDIA SONiC` · `FortiOS` · `PAN-OS`

### Supported use cases (Step 1)
`Campus/Enterprise LAN` · `Data Center Leaf-Spine` · `AI/GPU Cluster` · `Hybrid Campus+DC` · `WAN/SD-WAN` · `Multi-Site DCI` · `Enterprise→Multicloud`

### Key files (assumed structure — confirm on first session)
```
index.html              ← entire frontend (single-file monolith)
js/
  intent.js             ← intent object schema + management
  bom.js                ← hardware SKU database + scoring
  topology.js           ← SVG HLD generation
  config_gen.js         ← per-platform config templates
  deploy.js             ← deployment pipeline logic
  ztp.js                ← ZTP script generation
  troubleshoot.js       ← symptom classifier + playbooks
backend/
  app.py                ← Flask API
  nornir_tasks.py       ← Nornir + Netmiko device tasks
  requirements.txt
docker-compose.local.yml
```

---

## 3. Intent Object Schema — Reference

```jsonc
{
  "use_case": "dc_fabric",           // campus|dc_fabric|gpu_cluster|hybrid|wan|dci|multicloud
  "org": { "name": "", "size": "", "sites": 1, "budget_tier": "" },
  "vendors": ["cisco","arista"],     // any subset of: cisco|arista|juniper|nvidia|fortinet|hpe|dell|extreme
  "industry": "technology",
  "topology": {
    "redundancy": "full",            // none|basic|ha|full
    "traffic_pattern": "ew",         // ns|ew|both
    "endpoint_count": 500,
    "bandwidth_gbps": 25,            // per server: 1|10|25|100|400
    "oversubscription": 3            // ratio N:1
  },
  "protocols": {
    "underlay": "bgp",               // bgp|ospf|is-is|eigrp|static
    "overlay": ["vxlan_evpn"],       // vxlan_evpn|mpls_sr|gre|ipsec|geneve|none
    "features": ["bfd","ecmp","vrf","anycast_gw","ipv6","multicast","qos","flowspec","pbr","rr"]
  },
  "security": {
    "firewall": "perimeter",         // perimeter|distributed|microseg|none
    "vpn": "none",                   // ikev2|ssl|ztna|none
    "nac": ["dot1x_wired","mab"],
    "compliance": ["pci_dss"]        // pci_dss|hipaa|soc2|fedramp|iso27001|nist|none
  },
  "applications": {
    "types": ["database","object_storage"],
    "latency_sla": "low",            // best_effort|low|ultra_low
    "automation": "ansible"          // manual|ansible|terraform|netconf|napalm|nso
  },
  "gpu": {
    "transport": "rocev2",           // ib|rocev2|none
    "pfc": true,
    "ecn_dcqcn": true,
    "rail_optimized": false,
    "nvlink": false
  },
  "cloud": {
    "providers": [],                 // aws|azure|gcp
    "topology": "single_dc",
    "orchestration": "native"        // native|aviatrix
  }
}
```

---

## 4. Known Gaps — Current State (v1.0)

Priority codes: `P0` = blocks production · `P1` = high value · `P2` = medium · `P3` = enhancement
Status: ✅ = resolved · ⚠️ = partial · ❌ = open

### 4.1 Intent & BOM

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-01~~ | ~~No NLP intent parser — free text not parsed to form fields~~ | P1 | ✅ 2026-05-25 — heuristic regex parser + optional Claude AI tier; `nlp_intent.js` |
| ~~G-02~~ | ~~No intent coherence validation — impossible protocol combos accepted silently~~ | P0 | ✅ 2026-05-25 — 8 constraint rules (R-01→R-08) in `intent_constraints.js`; errors block, warnings advisory |
| ~~G-03~~ | ~~Oversubscription is a label, not a port-math calculation~~ | P0 | ✅ — ratio-driven uplink math: `uplinksNeeded = ceil(serverCap / oversubRatio / uplinkSpeed)` in `bom_calculator.js` |
| ~~G-04~~ | ~~BOM quantities AI-estimated, not computed from port density math~~ | P0 | ✅ — `calculateBOM()` in `bom_calculator.js` per §6 formula; leaf/spine counts fully deterministic |
| ~~G-05~~ | ~~No rack layout, cable schedule, or physical plant in BOM~~ | P1 | ✅ — `racklayout.js` (42U rack assignment, U-slot placement, power/cooling); `cabling.js` (cable schedule, distances, part #s, cost) |
| ~~G-06~~ | ~~No software license or 3-year TCO in BOM~~ | P1 | ✅ — `tco.js` — per-vendor SW license %, annual support %, power cost; 3-year CapEx+OpEx rollup |
| ~~G-07~~ | ~~Optics selection ignores fiber type/distance — always wrong without this~~ | P1 | ✅ — `optics.js` — 12 SKUs with fiberFamily (mmf/smf), reach per fiber grade, constraint-aware `recommendOptics()` |
| G-08 | 40 SKUs only — no EoL/EoS tracking | P2 | ❌ — SKUs lack lifecycle metadata (EoL date, support timeline) |

### 4.2 Protocol Depth

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-09~~ | ~~BFD checkbox only — no timer values, no interface-level config~~ | P0 | ✅ — `configgen.js` generates `bfd interval <ms> min_rx <ms> multiplier <n>` per platform (NX-OS/EOS/JunOS) from `state.bfd` object |
| ~~G-10~~ | ~~ECMP checkbox only — no max-paths, no hashing algorithm config~~ | P0 | ✅ — `maximum-paths <N>` + hash algorithm (symmetric/resilient) per platform from `state.ecmp` |
| ~~G-11~~ | ~~EVPN treated as overlay toggle — no RD/RT design, no ESI multi-homing~~ | P0 | ✅ — `_evpnDesign()` covers RD/RT auto+manual, RT-2/RT-3/RT-5, ESI multi-homing toggle, anycast-gw, ARP suppression |
| ~~G-12~~ | ~~BGP timers not surfaced — default 60/180s used even for DC fabric~~ | P0 | ✅ — `BGP_TIMER_PRESETS` (dc_aggressive 3/9, wan_standard 10/30, conservative 60/180); auto-selected by use_case |
| ~~G-13~~ | ~~BGP bestpath as-path multipath-relax missing (required for eBGP CLOS ECMP)~~ | P0 | ✅ — `bestpath as-path multipath-relax` + `bestpath compare-routerid` in all eBGP CLOS configs (NX-OS/EOS/JunOS) |
| ~~G-14~~ | ~~STP design missing for DC — no BPDU guard, PortFast, MST instances~~ | P1 | ✅ — `_nxosStpBlock()` / `_eosStpBlock()` / `_junosStpBlock()` — mode (pvst/rpvst/mstp), BPDU guard, PortFast, MST instance-VLAN mapping |
| ~~G-15~~ | ~~QoS generates policy header only — no 8-class map, no DSCP marking~~ | P1 | ✅ — 8-class DSCP map (EF/AF41/AF31/AF21/AF11/CS3/CS2/CS1) with policy-map + priority/bandwidth per platform |
| ~~G-16~~ | ~~VRF-lite config incomplete — definition only, no RT import/export~~ | P1 | ✅ — `_nxosVrfLiteBlock()` etc. — RD, RT import/export, BGP AF redistribute direct, max-paths per VRF (MGMT/PROD/DEV) |
| G-17 | IPv6 dual-stack is checkbox only — no OSPFv3, BGP IPv6 AF config | P2 | ❌ — no IPv6 AF, no OSPFv3, no dual-stack loopback/P2P addressing |
| G-18 | Multicast checkbox only — no RP address, PIM mode, interface joins | P2 | ❌ — no PIM, no RP config, no IGMP joins |
| G-19 | BGP unnumbered not supported (eliminates P2P IP addressing in DC CLOS) | P2 | ❌ — all P2P links use numbered IPs (/30) |

### 4.3 Config Generation Quality

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-20~~ | ~~NX-OS EVPN leaf missing: NVE interface, VRF context, EVPN section, SVI anycast-gw~~ | P0 | ✅ — full §8 template: `feature nv overlay`, NVE1, member VNI L2+L3, VRF context RD/RT, SVI anycast-gw, transit VLAN, BGP EVPN AF |
| ~~G-21~~ | ~~BGP peer templates not generated (NX-OS template peer, EOS peer group)~~ | P1 | ✅ — NX-OS `template peer SPINES/LEAFS`, EOS peer-group SPINES, JunOS group SPINES — all with timers, bfd, send-community |
| G-22 | No IOS-XR platform (critical for SP/WAN use case) | P2 | ❌ — platforms: NX-OS, EOS, JunOS, SONiC only |

### 4.4 Deployment Pipeline

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-23~~ | ~~Pre-checks do not capture device state baseline (show bgp/route/interface)~~ | P0 | ✅ — `genPreCheckScript()` in `checks.js` captures: bgp summary, ip route summary, interface errors, CPU, LLDP neighbors → baseline JSON |
| ~~G-24~~ | ~~No Batfish/pyATS dry-run validation before push~~ | P0 | ✅ 2026-05-25 — `window.genBatfishScript()` in `checks.js`; writes configs, runs undefinedReferences/bgpSessionStatus/routes checks via pybatfish; Batfish Dry-Run tab in Step 5 |
| ~~G-25~~ | ~~Rollback is config paste — not platform-native (checkpoint/configure replace)~~ | P1 | ✅ — `rollback.js` with `ROLLBACK_STRATEGIES` per platform (NX-OS checkpoint, IOS-XE configure replace, EOS rollback, JunOS commit confirmed 5, SONiC config load) |
| ~~G-26~~ | ~~Post-checks too shallow — no reachability matrix, no ECMP path verification~~ | P1 | ✅ 2026-05-25 — loopback ping matrix + ECMP via-count check in post-check script; failure banner + per-device matrix/ECMP rows in HTML renderer |
| ~~G-27~~ | ~~No config drift detection (running vs intended diff)~~ | P1 | ✅ — `genDriftDetectionScript()` in `checks.js` — captures running-config, base64-encodes, diffs vs intended; outputs `drift_report_<site>.json` |
| ~~G-28~~ | ~~No canary deployment (1 device first)~~ | P1 | ✅ — `genCanaryDeployScript()` in `deploy.js` — canary leaf first → BGP verify → confirmation gate → remaining devices |

### 4.5 ZTP

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-29~~ | ~~No embedded ZTP file server — scripts generated but not served~~ | P0 | ✅ 2026-05-25 — `ztp.js` `genZtpDockerCompose()`: nginx:alpine (8080) + tftp + Flask API; `genZtpNginxConf()`, `genZtpDhcpScope()` with static MAC bindings; File Server tab in Step 4 ZTP |
| ~~G-30~~ | ~~No ZTP state machine — no per-device provisioning state tracking~~ | P0 | ✅ 2026-05-25 — `ztp.js` 9-state machine (REGISTERED→ONLINE\|FAILED); `window.ZTP_STATES`; `ztpSetState/ztpAdvanceState/ztpMarkFailed/renderZtpStateBoard()`; Flask API stubs; State Board tab in Step 4 ZTP |
| ~~G-31~~ | ~~Day-0 bootstrap and Day-N production config conflated ("Bake Policies")~~ | P1 | ✅ 2026-05-25 — `ztp.js` `genDay0Config()`: mgmt-plane only (hostname/mgmt IP/SSH/NTP/syslog/LLDP/callback URL); NO BGP/VLANs/VXLAN; Day-0 Bootstrap tab in Step 4 ZTP |
| G-32 | No OS image version management in ZTP pipeline | P2 | ❌ — no image staging, download, or boot-device config |

### 4.6 Monitoring

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-33~~ | ~~Monitoring is export-only — no embedded TSDB or visualization~~ | P1 | ✅ 2026-05-25 — `monitoring-stack.yml` (VictoriaMetrics + Grafana + snmp-exporter + gnmic); scrape.yml, datasource/dashboard provisioning YAMLs; "Stack Setup" tab in Step 6 with live Grafana/VM links |
| ~~G-34~~ | ~~No gNMI/streaming telemetry — SNMP polling only~~ | P1 | ✅ 2026-05-25 — `gnmic.yml` with 4 OpenConfig subscriptions (interface SAMPLE/ON_CHANGE, BGP, CPU/memory); per-platform device-side gNMI config (NX-OS/EOS/JunOS/SONiC); "gNMI Telemetry" tab in Step 6 |
| G-35 | Anomaly detection uses 2σ/30-sample window — too many false positives | P2 | ❌ — no statistical anomaly detection; thresholds are static |

### 4.7 Troubleshooting

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| ~~G-36~~ | ~~LLDP/CDP topology requires manual paste — no automated SSH crawl~~ | P1 | ✅ — `topodisc.js` generates BFS Python crawler: Netmiko SSH → `show lldp neighbors detail` + CDP fallback → crawls until no new devices (MAX_HOPS=5) |
| ~~G-37~~ | ~~Symptom classifier has 35 pairs — needs 150+ covering EVPN, QoS, STP, DHCP~~ | P1 | ✅ — `troubleshoot.js` SYMPTOM_DB has 151 entries across BGP, EVPN, STP, QoS, WAN, Routing, Interface, CPU, ZTP/Day-0, Storage categories |
| G-38 | BGP convergence predictor ignores RR topology and route table size | P2 | ❌ — symptom classifier only; no predictive convergence modeling |

### 4.8 Use Case Coverage

| ID | Gap | Priority | Status |
|----|-----|----------|--------|
| G-39 | No Service Provider / MPLS core use case (IOS-XR, JunOS MX, SR-MPLS) | P2 | ❌ — blocked by G-22 (no IOS-XR); no SR-MPLS, LDP, BGP-LU config |
| G-40 | No Private 5G / O-RAN use case (fronthaul eCPRI, PTP timing) | P2 | ❌ — no eCPRI, PTP, 5G NR fronthaul/midhaul/backhaul design |
| G-41 | No dedicated Storage Networking use case (NVMe-oF, FCoE, iSCSI) | P2 | ❌ — no NVMe-oF, FCoE, or iSCSI topology design |
| G-42 | SD-WAN design shallow — no vEdge/vSmart/vBond architecture | P2 | ⚠️ — wan-edge role + vEdge/Aviatrix SKUs present; no orchestration architecture, no policy-based steering |

---

## 5. Constraint Rules — Intent Coherence Engine

These combinations are **invalid** and must be flagged before Step 3.

```javascript
// intent_constraints.js — implement these rules exactly
const CONSTRAINTS = [
  {
    id: "R-01", severity: "error",
    check: (i) => i.protocols.underlay === "eigrp" && i.protocols.overlay.includes("vxlan_evpn"),
    msg: "EIGRP cannot underlay VXLAN/EVPN — EVPN requires BGP as control plane.",
    fix: "Change underlay to BGP."
  },
  {
    id: "R-02", severity: "error",
    check: (i) => i.protocols.overlay.includes("geneve") && i.vendors.includes("cisco"),
    msg: "GENEVE is not supported on Cisco IOS-XE or NX-OS in hardware.",
    fix: "Use VXLAN, or switch to Linux-based SONiC."
  },
  {
    id: "R-03", severity: "error",
    check: (i) => i.protocols.features.includes("flowspec") && i.protocols.underlay !== "bgp",
    msg: "FlowSpec (BGP-FS) requires BGP as underlay.",
    fix: "Change underlay to BGP."
  },
  {
    id: "R-04", severity: "error",
    check: (i) => i.topology.redundancy === "full" && i.protocols.underlay === "static",
    msg: "Static routing cannot provide full redundancy (no SPOF).",
    fix: "Use BGP or OSPF with BFD."
  },
  {
    id: "R-05", severity: "warning",
    check: (i) => i.use_case === "campus" && i.protocols.underlay === "is-is",
    msg: "IS-IS is uncommon for campus. Cisco CVD and Arista AVD both recommend OSPF.",
    fix: "Consider OSPF for campus LAN."
  },
  {
    id: "R-06", severity: "warning",
    check: (i) => i.gpu.transport === "ib" && !i.vendors.includes("nvidia"),
    msg: "InfiniBand requires NVIDIA Quantum switches.",
    fix: "Add NVIDIA to vendor preferences, or use RoCEv2 for Ethernet-based GPU fabric."
  },
  {
    id: "R-07", severity: "error",
    check: (i) => i.protocols.overlay.includes("otv") && i.org.sites <= 1,
    msg: "OTV is a multi-site DCI technology. Meaningless for single-site designs.",
    fix: "Use VXLAN/EVPN for L2 extension within a single site."
  }
];
```

---

## 6. Port-Math BOM Formulas — Use These Exactly

```javascript
// bom_calculator.js — deterministic sizing, never AI-estimate quantities
function calculateBOM(intent, leafSku, spineSku) {
  const {endpoint_count, bandwidth_gbps, oversubscription} = intent.topology;

  // Leaf sizing
  const rawLeaves = Math.ceil(endpoint_count / leafSku.downlink_count);
  const leafCount = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1; // always even (HA pairs)

  // Uplink validation
  const serverCapacityPerLeaf = leafSku.downlink_count * bandwidth_gbps; // Gbps
  const uplinksNeeded = Math.ceil(serverCapacityPerLeaf / oversubscription / leafSku.uplink_speed_gbps);
  const uplinkOk = uplinksNeeded <= leafSku.uplink_count;

  // Spine sizing
  const totalLeafUplinks = leafCount * uplinksNeeded;
  const rawSpines = Math.ceil(totalLeafUplinks / spineSku.port_count);
  const spineCount = Math.max(rawSpines, 2); // minimum 2 for HA

  return {
    leaf_count: leafCount,
    spine_count: spineCount,
    uplinks_per_leaf: uplinksNeeded,
    uplink_capacity_ok: uplinkOk,
    trace: {
      servers_per_leaf: leafSku.downlink_count,
      raw_leaf_count: rawLeaves,
      server_capacity_gbps: serverCapacityPerLeaf,
      required_uplink_gbps: serverCapacityPerLeaf / oversubscription,
      total_leaf_uplinks: totalLeafUplinks
    },
    warning: !uplinkOk
      ? `${leafSku.model} has only ${leafSku.uplink_count}×${leafSku.uplink_speed_gbps}GbE uplinks but ${uplinksNeeded} needed at ${oversubscription}:1 oversubscription`
      : null
  };
}
```

---

## 7. Platform-Native Rollback — Use These, Not Config Paste

```python
# backend/rollback.py — platform-correct rollback per OS
ROLLBACK_STRATEGIES = {
    "nxos": {
        "pre":  "checkpoint pre-deploy-{ts}",
        "exec": "rollback running-config checkpoint pre-deploy-{ts} atomic",
        "verify": "show checkpoint summary"
    },
    "iosxe": {
        "pre":  "copy running-config flash:pre-deploy-{ts}.cfg",
        "exec": "configure replace flash:pre-deploy-{ts}.cfg force",
        "verify": "show archive"
    },
    "eos": {
        "pre":  "copy running-config checkpoint://pre-deploy-{ts}",
        "exec": "rollback clean-config checkpoint://pre-deploy-{ts}",
        "verify": "show checkpoint"
    },
    "junos": {
        "pre":  None,  # JunOS commit history is automatic
        "exec": "rollback 1",
        "commit": "commit",
        "deploy_cmd": "commit confirmed 5"  # auto-rollback if not confirmed within 5min
    },
    "sonic": {
        "pre":  "config save /etc/sonic/config_db_pre_{ts}.json",
        "exec": "config load /etc/sonic/config_db_pre_{ts}.json",
        "verify": "show runningconfiguration all"
    }
}
```

---

## 8. EVPN Config Reference — NX-OS Complete Leaf Template

This is what G-20 (NVE/VRF/SVI/EVPN section) must generate. Use as template.

```
feature bgp
feature nv overlay
feature vn-segment-vlan-based
feature interface-vlan
nv overlay evpn

! --- Per VLAN in VLAN design table ---
vlan {vlan_id}
  vn-segment {l2vni}

! --- NVE interface ---
interface nve1
  no shutdown
  host-reachability protocol bgp
  source-interface loopback1
  member vni {l2vni}
    ingress-replication protocol bgp
  member vni {l3vni} associate-vrf   ! one per VRF

! --- Per VRF ---
vrf context {vrf_name}
  vni {l3vni}
  rd auto
  address-family ipv4 unicast
    route-target both auto evpn

! --- SVIs ---
interface Vlan{vlan_id}
  no shutdown
  vrf member {vrf_name}
  ip address {anycast_gw_ip}/{prefix}
  fabric forwarding mode anycast-gateway

interface Vlan{l3vni_vlan}   ! transit VLAN for L3VNI
  no shutdown
  vrf member {vrf_name}
  ip forward

! --- BGP ---
router bgp {leaf_asn}
  router-id {loopback0_ip}
  bestpath as-path multipath-relax
  bestpath compare-routerid
  address-family l2vpn evpn
    advertise-pip
  template peer SPINES
    remote-as {spine_asn}
    timers {keepalive} {hold}       ! DC: 3 9 | WAN: 10 30
    advertisement-interval 0
    bfd
    send-community extended
    address-family ipv4 unicast
      maximum-prefix 12000 warning-only
    address-family l2vpn evpn
      send-community extended
  neighbor {spine_p2p_ip}
    inherit peer SPINES
    description {spine_hostname}
  vrf {vrf_name}
    address-family ipv4 unicast
      redistribute direct route-map RMAP-CONNECTED
      maximum-paths 8

! --- EVPN section ---
evpn
  vni {l2vni} l2
    rd auto
    route-target import auto
    route-target export auto
```

---

## 9. ZTP Architecture — Target State

```
docker-compose stack (add these services):
  ┌─ nginx (port 8080/8443) ─── serves: /ztp/scripts/ + /ztp/configs/
  ├─ tftpd (port 69/udp) ─────── serves: poap.py scripts
  └─ backend ZTP API endpoints:
       POST /api/ztp/register        ← pre-register device
       POST /api/ztp/callback        ← device calls this when ZTP completes
       GET  /api/ztp/state           ← get per-device provisioning state

ZTP state machine per device:
  REGISTERED → POWERED_ON → DHCP_ACK → SCRIPT_DOWNLOADED →
  CONFIG_APPLYING → CALLBACK_RECEIVED → VERIFIED → ONLINE | FAILED

State driven by:
  POWERED_ON:        dhcpd.leases polling
  DHCP_ACK:          DHCP server event
  SCRIPT_DOWNLOADED: nginx access log
  CONFIG_APPLYING:   ZTP script "phone home" at start
  CALLBACK_RECEIVED: POST /api/ztp/callback
  VERIFIED:          SSH reachable + hostname/version check

Day-0 bootstrap config (minimal — management plane only):
  mgmt IP + gateway · SSH v2 only · NTP · Syslog → tool IP ·
  LLDP enabled · hostname · local credentials · callback URL
  NO BGP, NO VLANs, NO VXLAN, NO ACLs

Day-N config: full production pushed after VERIFIED state reached
```

---

## 10. BGP Timer Presets — Surface in Step 4

```javascript
const BGP_TIMER_PRESETS = {
  "dc_aggressive": {
    label: "Data Center Aggressive",
    keepalive: 3, hold: 9,
    advertisement_interval: 0,
    note: "Use with BFD for sub-second convergence"
  },
  "wan_standard": {
    label: "WAN Standard",
    keepalive: 10, hold: 30,
    advertisement_interval: 5,
    note: "Balanced for WAN links with variable latency"
  },
  "conservative": {
    label: "Conservative",
    keepalive: 60, hold: 180,
    advertisement_interval: 30,
    note: "Default Cisco/Juniper. Avoid for DC fabrics."
  }
};

// Warning rule — add to intent validator
// If use_case is dc_fabric and bgp_timers is conservative → WARN
// "Default BGP timers (60/180s) in a DC fabric mean 3-minute convergence on
//  BGP failure without BFD. Use DC Aggressive preset (3/9s) + BFD."
```

---

## 11. Monitoring Stack — Docker Services to Add

```yaml
# Add to docker-compose.local.yml
  victoriametrics:
    image: victoriametrics/victoria-metrics:latest
    ports: ["8428:8428"]
    volumes: [vm_data:/storage]
    command: -retentionPeriod=90d

  grafana:
    image: grafana/grafana:latest
    ports: ["3000:3000"]
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/dashboards:/var/lib/grafana/dashboards:ro
      - ./monitoring/provisioning:/etc/grafana/provisioning:ro
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true

  snmp-exporter:
    image: prom/snmp-exporter:latest
    ports: ["9116:9116"]
    volumes: ["./monitoring/snmp.yml:/etc/snmp_exporter/snmp.yml:ro"]
```

Auto-provision on design commit: scrape configs for all BOM devices → victoriametrics.
Surface Grafana URL in Step 6 Monitoring section.

---

## 12. Implementation Order for New Features

When building any new feature, follow this sequence:

```
1. Read intent_object schema (Section 3) — does the feature need new intent fields?
2. If yes → add field to schema and to Step 2 form
3. Read gap table (Section 4) — which gap ID does this feature address?
4. Check constraint rules (Section 5) — does this feature interact with any rule?
5. For BOM changes → use port-math formulas (Section 6), never AI estimates
6. For config generation → use platform-specific complete templates (Section 8)
7. For ZTP → follow state machine (Section 9)
8. For rollback → use platform-native (Section 7), never config paste
9. Update gap table — mark resolved gaps, add new gaps discovered
10. Test: does the intent object fully drive the new output? No hardcoded values.
```

---

## 13. Token-Saving Rules for Claude Code Sessions

**DO** reference gap IDs (G-01, G-11) instead of re-describing the problem.
**DO** reference section numbers for context ("implement per Section 8 template").
**DO** assume all architecture in Section 2 is already understood — no need to re-explain.
**DO** use the constraint rule format in Section 5 — copy/extend, do not redesign.
**DO** use the BOM formula in Section 6 — copy/extend, do not re-derive.

**DON'T** ask Claude Code to re-read the full analysis doc (1700 lines) — this file has everything needed.
**DON'T** let Claude Code invent new SKU quantities — always use port-math formulas.
**DON'T** let Claude Code generate config paste rollback — always use Section 7 strategies.
**DON'T** generate EVPN config without the complete NVE+VRF+SVI+EVPN blocks from Section 8.
**DON'T** add a new protocol feature as a checkbox only — it must produce parameterized config output.

---

## 14. Quick-Start Prompts for Each Phase

Copy these directly into Claude Code. Each is self-contained using this file as context.

### Phase 1 — P0 Fixes (run first)

```
Using CLAUDE.md as full context:
Implement G-02 (intent coherence validation).
Use the CONSTRAINTS array from Section 5 exactly as written.
Add validateIntent(intentObject) called on Step 2 "Continue →" click.
Errors block progression. Warnings allow with advisory banner.
Highlight affected form fields inline.
```

```
Using CLAUDE.md as full context:
Implement G-03 + G-04 (port-math BOM sizing).
Use calculateBOM() from Section 6 exactly.
Add "Capacity Math" expandable panel to Step 4.
Show red badge on BOM if hardware cannot satisfy intent.
Update BOM quantities from this calculation, not AI inference.
```

```
Using CLAUDE.md as full context:
Implement G-09 + G-10 (BFD and ECMP config depth).
BFD must generate: interval values + per-interface commands per platform
  (NX-OS: bfd interval 300 min_rx 300 multiplier 3 + neighbor bfd)
  (EOS:   neighbor X bfd + bfd slow-timer 5000)
  (JunOS: bfd-liveness-detection minimum-interval 300 multiplier 3)
ECMP must generate: maximum-paths N + hashing algorithm per platform.
Add BGP timer preset selector from Section 10 to Step 4.
```

```
Using CLAUDE.md as full context:
Implement G-11 + G-20 (complete EVPN design + NX-OS leaf config).
Add EVPN design section to Step 4: RD format, RT auto/manual, RT-2/3/5 activation, ESI toggle.
Regenerate NX-OS leaf config using the complete template in Section 8.
All values (VNIs, IPs, ASNs, VRFs) must come from the intent object and design tables.
No hardcoded values.
```

```
Using CLAUDE.md as full context:
Implement G-23 (device state baseline capture in pre-checks).
For each BOM device, collect: show bgp summary, show ip route summary,
show interface counters errors, show processes cpu, show lldp neighbors.
Store as structured JSON with timestamp.
Post-checks must diff current state vs stored baseline.
Alert on: BGP peer count drop, route count drop >5%, interface errors increased >100/s.
Show before/after diff table in post-check results panel.
```

### Phase 2 — ZTP (G-29, G-30, G-31)

```
Using CLAUDE.md as full context:
Implement G-29 + G-30 + G-31 (production ZTP).
Add nginx + TFTP services to docker-compose.local.yml per Section 11.
Implement ZTP state machine from Section 9 exactly.
Add POST /api/ztp/callback endpoint.
Separate Day-0 (management plane only) from Day-N config per Section 9.
Show real-time per-device state in onboarding board.
```

### Phase 3 — Monitoring (G-33, G-34)

```
Using CLAUDE.md as full context:
Implement G-33 (embedded monitoring stack).
Add VictoriaMetrics + Grafana + snmp-exporter to docker-compose per Section 11.
On design commit: auto-generate scrape configs for all BOM devices.
Auto-provision Grafana with dashboard (device names from BOM as variables).
Surface Grafana link in Step 6 Monitoring section.
```

### Phase 4 — Intent NLP (G-01)

```
Using CLAUDE.md as full context:
Implement G-01 (NLP intent parser).
Add a free-text input at top of Step 2.
On "Parse Intent" button: call Claude API (claude-sonnet-4-20250514, max_tokens 1000).
System prompt: extract structured params matching intent schema from Section 3.
Return JSON only. Map to form fields. Highlight auto-filled fields in blue.
Show confidence: "extracted" vs "inferred" vs "default" per field.
```

---

## 15. What NOT to Rebuild

These are working well in v1.0 — do not refactor without a specific reason:

- Troubleshooting playbook structure (symptom→platform-commands format) — just expand entries
- ITSM integration surface (Slack/ServiceNow/Jira/GitHub hooks) — just fix server-side enforcement
- ZTP multi-vendor script templates (POAP/EOS-ZTP/PnP/Junos-ZTP) — just add file server + state machine
- GPU/AI cluster RoCEv2 + PFC/ECN design intent — one of the strongest areas, only expand
- GitOps GitHub commit flow — works, just add PR creation and branch protection guidance
- Intent object JSON schema structure — extend fields, never redesign the schema

---

*CLAUDE.md — keep this file updated as gaps are resolved.*
*Mark resolved gaps: ~~G-XX~~ ✅ with date.*
*Add new gaps discovered during implementation as G-43, G-44, etc.*
