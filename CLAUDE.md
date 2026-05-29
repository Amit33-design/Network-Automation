# NetDesign AI — Claude Instructions

## CRITICAL: Tool Restrictions

This is a **personal open-source project**. The following tools are
**STRICTLY FORBIDDEN** and must NEVER be used:

- `builder-mcp` / `ReadInternalWebsites` / `InternalCodeSearch` / `InternalSearch`
- `aws-api-mcp` / `mcp__aws-api-mcp__*`
- `aws-knowledge-mcp-server-mcp` / `mcp__aws-knowledge-mcp-server-mcp__*`
- Any tool with `amazon`, `aws-internal`, `isengard`, `midway`, `brazil`, or `a2z` in its name

Allowed tools: `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Agent`, `mcp__github__*`

---

## 0. Project Status — READ THIS FIRST

**Active branch**: `main`
**Stack**: React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4 + Zustand 5 + TanStack Query v5
**React migration**: ✅ COMPLETE (PR #23 merged 2026-05-26)

### Frontend structure
```
frontend/
  src/
    pages/          ← Step1UseCase – Step6Monitor (6-step wizard)
    lib/            ← bom.ts, configgen.ts, products.ts, utils.ts
    hooks/          ← useAlerts, useRca, useZTP, useChecks, useMonitoring, useTopology
    components/ui/  ← Badge, Button, Card, Toast
    store/          ← useAppStore (Zustand 5 + persist)
    api/client.ts   ← typed fetch + WebSocket wrapper
    test/           ← 101 Vitest tests across 8 suites
```

### Quick start
```bash
git checkout main && git pull origin main
cd frontend && npm ci && npm test   # 101 tests
npm run build                       # Vite build
npm run dev                         # dev server :5173, proxies /api → :8000
```

### Commit format
`feat:`, `fix:`, `chore:`, `docs:`, `test:` — conventional commits
Always work on `main` (not `master` — that is a separate project)

---

## 1. Project Identity

| Key | Value |
|-----|-------|
| Name | NetDesign AI (NDAL) |
| Type | Browser-native, AI-powered, intent-driven network design & automation tool |
| Stack | React 19 + TypeScript + Vite (frontend) · FastAPI + Python 3.11 (backend) · Nornir + Netmiko · Claude API |
| Author | Amit Tiwari — solo build via Claude Code |
| Deployment | Docker Compose (local) · Vercel (frontend) · Railway (backend) |
| Repo | https://github.com/Amit33-design/Network-Automation (branch: `main`) |
| Live | https://netdesignai.com |

---

## 2. Architecture

```
INTENT OBJECT (JSON)  ←  single source of truth
       │
       ├─ Step 1: Use Case selection (7 use cases)
       ├─ Step 2: BOM (TanStack Table, port-math sizing, 17 SKUs)
       ├─ Step 3: Config generation (CodeMirror viewer, per-device download)
       ├─ Step 4: ZTP demo (fault injection, per-device state machine)
       ├─ Step 5: Pre/Post checks (PASS/FAIL/WARN, remediation hints)
       └─ Step 6: Monitoring (health polling, alerts, degraded simulation)

Observability panel (alongside wizard):
  🔔 Alerts    — useAlerts (TanStack Query, 30 s refetch)
  🔬 RCA       — useRunRca (TanStack Query useMutation)
  🚀 Deploy   — LiveProgressFeed (WebSocket stream)
```

### Supported platforms (config generation)
`NX-OS` · `IOS-XE` · `Arista EOS` · `Juniper JunOS` · `PAN-OS`

### Supported use cases
`campus` · `dc` · `gpu` · `wan` · `multisite` · `multicloud` · `aviatrix`

### Backend API endpoints (FastAPI)
```
GET  /api/alerts              ← AlertsPanel polling
POST /api/rca/analyze         ← RcaPanel mutation
POST /api/generate-configs    ← Step 3 config generation
POST /api/pre-checks          ← Step 5
POST /api/post-checks         ← Step 5
POST /api/deploy              ← deploy trigger
WS   /ws/deploy/{id}         ← LiveProgressFeed stream
GET  /api/lab/topology        ← Step 4 demo devices
POST /api/lab/ztp             ← Step 4 ZTP simulation
POST /api/lab/checks          ← Step 5 check simulation
POST /api/lab/monitoring      ← Step 6 health simulation
```

---

## 3. Intent Object Schema

```jsonc
{
  "use_case": "dc",              // campus|dc|gpu|wan|multisite|multicloud|aviatrix
  "scale": "medium",             // small|medium|large
  "siteCode": "IAD",
  "siteName": "Ashburn DC",
  "redundancy": "dual",          // single|dual
  "appTypes": ["storage","hpc"],
  "compliance": ["PCI","SOC2"],
  "topology": {
    "traffic_pattern": "ew",
    "endpoint_count": 500,
    "bandwidth_gbps": 25,
    "oversubscription": 3
  },
  "protocols": {
    "underlay": "isis",          // isis (DC/GPU) | ospf (campus/WAN)
    "overlay": "vxlan_evpn",
    "features": ["bfd","ecmp","pfc","ecn"]
  },
  "gpu": {
    "transport": "rocev2",       // rocev2|ib|none
    "pfc_priority": 3,           // RoCEv2 priority (no-drop)
    "ecn_dcqcn": true
  }
}
```

---

## 4. Config Generation Rules (configgen.ts)

These 5 rules are tested by 36 Vitest tests. Never break them.

1. **No duplicate blocks** — `mgmtBlock()` called exactly once per device. No appended section.
2. **Real firewall configs** — Cisco = IOS-XE ZBF (`zone security`, `zone-pair`, `policy-map type inspect`); Palo Alto = PAN-OS set commands.
3. **No hardcoded secrets** — all credentials use `<CHANGE-ME-*>` placeholders.
4. **Single underlay** — IS-IS for DC/GPU spine-leaf; OSPF for WAN/campus. Never both.
5. **GPU QoS** — PFC priority 3 no-drop (RoCEv2), ECN on lossy queues, WRED, RDMA 60% BW, `pfc-watchdog`, DCQCN.

Run `cd frontend && npm test` after any configgen.ts change to verify all 36 pass.

---

## 5. Constraint Rules — Intent Coherence

```javascript
const CONSTRAINTS = [
  {
    id: "R-01", severity: "error",
    check: (i) => i.protocols.underlay === "eigrp" && i.protocols.overlay === "vxlan_evpn",
    msg: "EIGRP cannot underlay VXLAN/EVPN — EVPN requires BGP as control plane.",
    fix: "Change underlay to BGP."
  },
  {
    id: "R-02", severity: "error",
    check: (i) => i.protocols.overlay === "geneve" && i.vendors.includes("cisco"),
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
    msg: "Static routing cannot provide full redundancy.",
    fix: "Use BGP or OSPF with BFD."
  },
  {
    id: "R-05", severity: "warning",
    check: (i) => i.use_case === "campus" && i.protocols.underlay === "isis",
    msg: "IS-IS is uncommon for campus. CVD/AVD recommend OSPF.",
    fix: "Consider OSPF for campus LAN."
  },
  {
    id: "R-06", severity: "warning",
    check: (i) => i.gpu?.transport === "ib" && !i.vendors?.includes("nvidia"),
    msg: "InfiniBand requires NVIDIA Quantum switches.",
    fix: "Add NVIDIA, or use RoCEv2 for Ethernet-based GPU fabric."
  }
]
```

---

## 6. Port-Math BOM Formulas

```javascript
// lib/bom.ts — always derive quantities from port math, never hardcode
function calculateBOM(intent, leafSku, spineSku) {
  const { endpoint_count, bandwidth_gbps, oversubscription } = intent.topology

  // Leaf count (always even for HA)
  const rawLeaves = Math.ceil(endpoint_count / leafSku.downlink_count)
  const leafCount = rawLeaves % 2 === 0 ? rawLeaves : rawLeaves + 1

  // Uplink validation
  const serverCapacityPerLeaf = leafSku.downlink_count * bandwidth_gbps
  const uplinksNeeded = Math.ceil(serverCapacityPerLeaf / oversubscription / leafSku.uplink_speed_gbps)

  // Spine count (minimum 2)
  const totalLeafUplinks = leafCount * uplinksNeeded
  const spineCount = Math.max(Math.ceil(totalLeafUplinks / spineSku.port_count), 2)

  return { leafCount, spineCount, uplinksPerLeaf: uplinksNeeded }
}
```

---

## 7. Platform-Native Rollback

```python
ROLLBACK_STRATEGIES = {
    "nxos":  { "pre": "checkpoint pre-deploy-{ts}",
               "exec": "rollback running-config checkpoint pre-deploy-{ts} atomic" },
    "iosxe": { "pre": "copy running-config flash:pre-deploy-{ts}.cfg",
               "exec": "configure replace flash:pre-deploy-{ts}.cfg force" },
    "eos":   { "pre": "copy running-config checkpoint://pre-deploy-{ts}",
               "exec": "rollback clean-config checkpoint://pre-deploy-{ts}" },
    "junos": { "deploy_cmd": "commit confirmed 5" },  # auto-rollback if not confirmed
    "sonic": { "pre": "config save /etc/sonic/config_db_pre_{ts}.json",
               "exec": "config load /etc/sonic/config_db_pre_{ts}.json" }
}
```

---

## 8. EVPN Config Reference — NX-OS Complete Leaf Template

```
feature bgp
feature nv overlay
feature vn-segment-vlan-based
nv overlay evpn

vlan {vlan_id}
  vn-segment {l2vni}

interface nve1
  no shutdown
  host-reachability protocol bgp
  source-interface loopback1
  member vni {l2vni}
    ingress-replication protocol bgp
  member vni {l3vni} associate-vrf

vrf context {vrf_name}
  vni {l3vni}
  rd auto
  address-family ipv4 unicast
    route-target both auto evpn

interface Vlan{vlan_id}
  no shutdown
  vrf member {vrf_name}
  ip address {anycast_gw_ip}/{prefix}
  fabric forwarding mode anycast-gateway

router bgp {leaf_asn}
  bestpath as-path multipath-relax
  bestpath compare-routerid
  template peer SPINES
    remote-as {spine_asn}
    timers 3 9
    advertisement-interval 0
    bfd
    send-community extended
    address-family l2vpn evpn
      send-community extended
  neighbor {spine_p2p_ip}
    inherit peer SPINES

evpn
  vni {l2vni} l2
    rd auto
    route-target import auto
    route-target export auto
```

---

## 9. ZTP Architecture

```
State machine per device:
  REGISTERED → POWERED_ON → DHCP_ACK → SCRIPT_DOWNLOADED →
  CONFIG_APPLYING → CALLBACK_RECEIVED → VERIFIED → ONLINE | FAILED

API endpoints:
  POST /api/ztp/register    ← pre-register device
  POST /api/ztp/callback    ← device calls when ZTP completes
  GET  /api/ztp/state       ← per-device provisioning state

Day-0 bootstrap (management plane ONLY):
  mgmt IP + gateway · SSH v2 only · NTP · Syslog → tool IP
  LLDP enabled · hostname · local credentials · callback URL
  NO BGP, NO VLANs, NO VXLAN, NO ACLs

Day-N: full production config pushed after VERIFIED state
```

---

## 10. BGP Timer Presets

```javascript
const BGP_TIMER_PRESETS = {
  dc_aggressive:  { keepalive: 3,  hold: 9,   adv_interval: 0,  note: "Use with BFD" },
  wan_standard:   { keepalive: 10, hold: 30,  adv_interval: 5 },
  conservative:   { keepalive: 60, hold: 180, adv_interval: 30, note: "Default — avoid in DC" }
}
// Warn if use_case=dc and timers=conservative
```

---

## 11. Monitoring Stack

```yaml
# Add to docker-compose.local.yml
victoriametrics:
  image: victoriametrics/victoria-metrics:latest
  ports: ["8428:8428"]
grafana:
  image: grafana/grafana:latest
  ports: ["3000:3000"]
snmp-exporter:
  image: prom/snmp-exporter:latest
  ports: ["9116:9116"]
```

Alert groups: BGP sessions/prefixes, interface errors/utilization, CPU/memory,
device reachability, RoCEv2 CNP rate (GPU), PFC watchdog events (GPU).

---

## 12. Known Gaps (open items)

All items below are **open** (not yet implemented in the React wizard).
Use gap IDs in commit messages and conversations.

| ID | Gap | Priority |
|----|-----|----------|
| G-A1 | Intent NLP parser — free-text → Step 1 form fields (Claude API) | P1 |
| G-A2 | ✅ 2026-05-29 Professional HLD diagram — all layers interlinked, packet-flow scenarios, device-inspect panel | P1 |
| G-A3 | Batfish/pyATS dry-run validation before config push | P1 |
| G-A4 | Config drift detection (running vs intended diff) | P1 |
| G-A5 | Canary deployment (1 device first, confirm gate) | P1 |
| G-A6 | ZTP file server (nginx + TFTP in docker-compose) | P1 |
| G-A7 | Embedded monitoring stack (VictoriaMetrics + Grafana auto-provision) | P1 |
| G-A8 | gNMI / streaming telemetry (currently SNMP polling only) | P2 |
| G-A9 | IOS-XR platform support (SP/WAN — SR-MPLS, L3VPN) | P2 |
| G-A10 | Private 5G / O-RAN use case (eCPRI, PTP timing) | P2 |
| G-A11 | Storage networking use case (NVMe-oF, FCoE, iSCSI) | P2 |
| G-A12 | SD-WAN design (vEdge/vSmart/vBond architecture) | P2 |
| G-A13 | TCO / 3-year cost model in BOM | P2 |
| G-A14 | Rack layout and cable schedule in BOM | P2 |

---

## 13. Implementation Rules

1. Run `cd frontend && npm test` after every change to `lib/configgen.ts` — 36 tests cover all config rules.
2. New backend types go in `frontend/src/types/index.ts`.
3. All server state uses TanStack Query (`useQuery` / `useMutation`) — no `useEffect + fetch`.
4. New UI components go in `frontend/src/components/ui/` (Badge, Button, Card, Toast pattern).
5. Never hardcode device counts — use `buildDeviceList()` in `lib/bom.ts`.
6. Secrets always use `<CHANGE-ME-*>` — never hardcode credentials in generated configs.
7. IS-IS for DC/GPU underlay; OSPF for WAN/campus. Never emit both in one config.

---

*Last updated: 2026-05-26. React 19 migration complete (PR #23).*
*Mark resolved gaps with ✅ and date. Add new gaps as G-A15, G-A16, etc.*
