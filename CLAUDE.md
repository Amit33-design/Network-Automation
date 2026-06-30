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

> 📖 **Code map**: [`CODE_REFERENCE.md`](./CODE_REFERENCE.md) is a
> function-by-function reference for the entire codebase (frontend +
> backend) — read it first in any new session to understand what exists
> and where, before grepping/reading source files from scratch.

**Active branch**: `main`
**Stack**: React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4 + Zustand 5 + TanStack Query v5
**React migration**: ✅ COMPLETE (PR #23 merged 2026-05-26)

### Frontend structure
```
frontend/
  src/
    pages/          ← Step1UseCase – Step6Deploy (6-step wizard)
    lib/            ← bom.ts, configgen.ts, products.ts, utils.ts
    hooks/          ← useAlerts, useRca, useZTP, useChecks, useMonitoring, useTopology
    components/
      ui/           ← Badge, Button, Card, Toast
      wizard/       ← Sidebar.tsx (deep-nav with Deploy sub-items)
      HLDTopologyDiagram.tsx  ← pure-SVG HLD topology with packet-flow scenarios
      BackendToggle.tsx       ← useBackendMode() context: { isLive, baseUrl }
      LandingPage.tsx         ← brand logo hero, feature cards, use-case chips
    store/          ← useAppStore (Zustand 5 + persist)
    api/client.ts   ← typed fetch + WebSocket wrapper
    test/           ← 127 Vitest tests across 8 suites
  public/
    favicon.svg     ← circuit-board "N" SVG icon (no thunder symbol)
    logo-brand.jpg  ← brand image: AI robot + "NetDesign AI" + "INTENT-DRIVEN NETWORK AUTOMATION"
```

### Quick start
```bash
git checkout main && git pull origin main
cd frontend && npm ci && npm test   # 127 tests
npm run build                       # Vite build
npm run dev                         # dev server :5173, proxies /api → :8000
```

### Commit format
`feat:`, `fix:`, `chore:`, `docs:`, `test:` — conventional commits
Always work on `main` (not `master` — that is a separate project)

### Branch & merge policy (REQUIRED)
**Everything must end up on `main`.** All work — features, fixes, docs,
autonomous backlog items — is expected to land on the `main` branch and be
deployed from there (netdesignai.com runs from `main`). The standing
expectation:

1. Develop on a short-lived feature branch (e.g.
   `claude/<topic>`), commit + push as you go.
2. When the work is complete and verified (tests + tsc + build green),
   **open a PR to `main` and merge it** — do not leave finished work
   stranded on a feature branch.
3. If a session is handed a specific feature branch in its task setup,
   still merge that branch into `main` once the work is done (squash or
   merge commit), unless the user explicitly says to hold off.
4. **After merge, delete the feature branch** (both local and remote)
   using `git push origin --delete <branch>`. `main` is the single
   source of truth that gets deployed. Stale feature branches cause
   divergence, duplicate commits, and merge confusion.
5. **Never merge `main` back into a feature branch** — this creates
   criss-cross merge histories. Instead, rebase the feature branch on
   `main` before the PR, or simply work directly on `main` if the
   change is small.

### Git identity (REQUIRED for Vercel deployment)
Every commit must use `noreply@anthropic.com` as the author email.
The session-start hook (`.claude/hooks/session-start.sh`) sets this
automatically in remote sessions. If you see "Unverified" warnings
on GitHub, run:
```bash
git config user.email "noreply@anthropic.com"
git config user.name "Claude"
```

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
       ├─ Step 1: Use Case selection (7 use cases + org details)
       ├─ Step 2: Network Requirements (traffic, protocols, compliance)
       ├─ Step 3: BOM (TanStack Table, port-math sizing, 40+ SKUs)
       ├─ Step 4: Config generation + HLD Topology diagram
       ├─ Step 5: HLD Review / Design Workbench
       └─ Step 6: Deploy & Validate (9 sub-tabs — see below)

Step 6 sub-tabs (sidebar deep-nav via activeDeployTab store field):
  🚀 deploy   — Deploy Pipeline (policy gate, canary, terminal log, Config Automation)
  📡 ztp      — ZTP Provisioning (state-machine visual, fault injection, demo simulation)
  ✅ checks   — Pre/Post Checks (grouped by device, pre→post diff panel)
  🖧 netconf  — NETCONF (interactive XML editor, per-vendor RPC, mock responses)
  📊 monitor  — Monitoring (health polling, alerts, degraded simulation)
  ⚙️ day2ops  — Day-2 Ops (drift detection, re-push, compliance scan)
  🦟 batfish  — Batfish Validate (dry-run validation placeholder)

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
POST /api/pre-checks          ← Step 6 checks tab
POST /api/post-checks         ← Step 6 checks tab
POST /api/deploy              ← deploy trigger
WS   /ws/deploy/{id}         ← LiveProgressFeed stream
GET  /api/lab/topology        ← demo devices list
POST /api/lab/ztp             ← ZTP simulation
POST /api/lab/checks          ← checks simulation
POST /api/lab/monitoring      ← health simulation
POST /api/ztp/run             ← ZTP run (falls back to client-side sim when not live)
POST /api/checks/pre          ← pre-checks (falls back to client-side sim when not live)
POST /api/checks/post         ← post-checks (falls back to client-side sim when not live)
```

---

## 3. Demo Mode (no backend required)

The app is fully functional without a backend. The `BackendToggle` component
provides `useBackendMode()` context: `{ isLive: boolean, baseUrl: string }`.

When `!isLive`, Step 6 uses client-side simulation functions:

### ZTP simulation (`simulateZTPResult`)
- State machine per device: `REGISTERED → POWERED_ON → DHCP_ACK → SCRIPT_DOWNLOADED → CONFIG_APPLYING → CALLBACK_RECEIVED → VERIFIED → ONLINE`
- Fault injection: specify `failDevice` + `failAt` stage → device gets FAILED event at that stage
- Returns `ZTPResult` with per-device events + summary

### Checks simulation (`simulateChecksResult`)
- 8–12 checks per device across categories: Connectivity, Protocols, Config, Hardware
- Status distribution: ~85% PASS, 10% WARN, 5% FAIL
- Fault injection: `failDevice` + `failCheck` → targeted FAIL injection
- Pre and post results stored separately for delta diff panel

---

## 4. Zustand Store — Key Fields

`frontend/src/store/useAppStore.ts` — Zustand 5 + persist middleware

```typescript
// Navigation
step: number                  // current wizard step (1–6)
setStep(step: number)
nextStep() / prevStep()

// Step 6 sub-tab deep-navigation
activeDeployTab: string       // default: 'deploy' — synced with Sidebar sub-items
setActiveDeployTab(tab: string)

// Step 1 — site / org
useCase: UseCase | ''
scale: Scale                  // 'small' | 'medium' | 'large'
redundancy: Redundancy        // 'single' | 'dual'
compliance: Compliance[]
orgName, orgSize, budgetTier, vendorPrefs, industry, primaryContact

// Step 2 — requirements
trafficPattern, totalEndpoints, bandwidthPerServer, oversubscription
underlayProtocol, overlayProtocols, protoFeatures
firewallModel, redundancyModel, numSites, vpnType, nacOptions

// Design outputs
devices: BOMDevice[]
cabling: CableLink[]
optics: OpticsEntry[]
configs: Record<string, string>

// Policy
customPolicyRules: string     // custom policy rules for deploy gate (M-55)

// Scripts
preCheckScript, postCheckScript, prometheusAlerts
policyBlocks: string[]

// M-11: Multi-cloud fields
cloudProviders, dcTopology, coloProvider, dcEdgeVendor, bgpAsn, orgCidr, aviatrixOptions
```

---

## 5. Intent Object Schema

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

## 6. Config Generation Rules (configgen.ts)

These 5 rules are tested by 36 Vitest tests. Never break them.

1. **No duplicate blocks** — `mgmtBlock()` called exactly once per device. No appended section.
2. **Real firewall configs** — Cisco = IOS-XE ZBF (`zone security`, `zone-pair`, `policy-map type inspect`); Palo Alto = PAN-OS set commands.
3. **No hardcoded secrets** — all credentials use `<CHANGE-ME-*>` placeholders.
4. **Single underlay** — IS-IS for DC/GPU spine-leaf; OSPF for WAN/campus. Never both.
5. **GPU QoS** — PFC priority 3 no-drop (RoCEv2), ECN on lossy queues, WRED, RDMA 60% BW, `pfc-watchdog`, DCQCN.

Run `cd frontend && npm test` after any configgen.ts change to verify all 36 pass.

---

## 7. Constraint Rules — Intent Coherence

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

## 8. Port-Math BOM Formulas

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

## 9. Platform-Native Rollback

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

## 10. EVPN Config Reference — NX-OS Complete Leaf Template

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

## 11. ZTP Architecture

```
State machine per device:
  REGISTERED → POWERED_ON → DHCP_ACK → SCRIPT_DOWNLOADED →
  CONFIG_APPLYING → CALLBACK_RECEIVED → VERIFIED → ONLINE | FAILED

ZTP Provisioning tab features:
  - Device list from BOM store (expanded by count, capped at 4 per model)
  - Fault injection: select fail device + fail stage
  - Per-device state-machine visual: horizontal step strip
    (green=done, yellow=current, red=failed, gray=pending)
  - Events table with timestamps
  - Demo simulation when backend not live (simulateZTPResult)

API endpoints:
  POST /api/ztp/register    ← pre-register device
  POST /api/ztp/callback    ← device calls when ZTP completes
  GET  /api/ztp/state       ← per-device provisioning state
  POST /api/ztp/run         ← run ZTP (client fallback when not live)

Day-0 bootstrap (management plane ONLY):
  mgmt IP + gateway · SSH v2 only · NTP · Syslog → tool IP
  LLDP enabled · hostname · local credentials · callback URL
  NO BGP, NO VLANs, NO VXLAN, NO ACLs

Day-N: full production config pushed after VERIFIED state
```

---

## 12. Pre/Post Checks Architecture

```
Check categories per device (8–12 checks):
  Connectivity : ICMP reachability, management SSH, LLDP neighbors
  Protocols    : BGP session state, OSPF adjacency, interface state
  Config       : Hostname match, running vs startup diff, ACL presence
  Hardware     : CPU/memory thresholds, interface error counters, power/fan status

Display:
  - Grouped by device (expandable rows)
  - Summary pill badges: PASS (green) / WARN (yellow) / FAIL (red) counts
  - Pre→Post delta panel when both phases completed (highlights changed checks)
  - Demo simulation (simulateChecksResult) when backend not live

API endpoints:
  POST /api/checks/pre      ← pre-checks
  POST /api/checks/post     ← post-checks
```

---

## 13. NETCONF Interactive Panel

```
Controls:
  Device selector    ← dropdown from BOM devices
  Operation          ← get-config | edit-config | get | lock | unlock
  Datastore          ← running | candidate | startup
  XML editor pane    ← pre-populated per vendor (JunOS/IOS-XE/EOS/NX-OS) and operation
  Execute (Demo)     ← shows mock NETCONF response (<ok/> or realistic config XML)
  Download Script    ← downloads full NETCONF Python script

Vendor XML patterns:
  JunOS   — <get-configuration> with <format>text</format>
  IOS-XE  — ietf-interfaces YANG model
  EOS     — <get-config> with arista-specific namespaces
  Generic — RFC 6241 standard RPC
```

---

## 14. Config Automation Section (Deploy Pipeline tab)

Three sub-tabs inside the "Config Automation" section at the bottom of the Deploy Pipeline:

### Ansible Tower / AWX
- Tower URL input (default: `http://tower.corp.local`)
- Job Template selector: Deploy Network Config | ZTP Bootstrap | Pre-check Baseline | Post-check Validation | Config Rollback
- Extra vars editor: JSON pre-populated from intent (`site_code`, `use_case`, `devices`)
- Launch Job button (demo: fake job ID + status progression)
- Download Ansible Inventory (INI format from BOM devices)
- Download Playbook (existing netmiko scripts)

### Terraform
- Provider selector: Cisco NSO | Netbox | Nautobot | Ansible | Generic
- Shows `main.tf`, `variables.tf`, `terraform.tfvars` snippets for selected provider
- Download all three files
- "Terraform Plan (Demo)" shows realistic plan output

### Manual / Script
- Script type: Push Configs | Pre-check | Post-check | Rollback
- Shows existing Python netmiko scripts prominently
- Copy + Download buttons

---

## 15. Policy & Approval Gate (Deploy Pipeline tab)

```
Panel appears before "Start Deployment" button:
  ✅ Change window: Business hours (Mon–Fri 06:00–22:00)
  ✅ Peer review: Required (0 of 1 approver confirmed)
  ⚠️  Blast radius: N devices (>3 triggers approval gate)
  ✅ Rollback plan: Checkpoint backup strategy selected

  [ ] I confirm this change has been reviewed  ← checkbox
                                  [Approve & Lock] ← button

Start Deployment button is DISABLED until policyApproved = true.
Reset button clears policyApproved and policyConfirmed.
Custom rules drawn from useAppStore().customPolicyRules (M-55).
```

---

## 16. HLD Topology Diagram (`HLDTopologyDiagram.tsx`)

```
Pure SVG — no react-flow, no d3, no cytoscape.

Features:
  - Multi-layer topology (core/spine/leaf/access/firewall/wan-edge)
  - Packet-flow scenarios (clickable flows highlight active path)
  - "Primary Path Only" toggle (shows/hides non-flow devices when flow active)
  - Device-inspect panel on click (shows hostname, role, IP, protocols)
  - Cloud provider node overlays for multicloud use case
  - Animated ambient particles on links

SVG sizing fix (responsive):
  - No fixed width/height attrs on <svg>
  - style={{ width: '100%', height: 'auto', display: 'block' }}
  - viewBox set from computed topo dimensions

Non-flow nodes: always fully visible (no dimming/opacity reduction).
```

---

## 17. Sidebar Deep-Navigation

`frontend/src/components/wizard/Sidebar.tsx` — "Deploy & Validate" section
expands into 7 sub-items when step === 6 (or user expands):

```typescript
const DEPLOY_SUB_ITEMS = [
  { tab: 'deploy',   icon: '🚀', label: 'Deploy Pipeline'  },
  { tab: 'ztp',      icon: '📡', label: 'ZTP Provisioning' },
  { tab: 'checks',   icon: '✅', label: 'Pre/Post Checks'  },
  { tab: 'netconf',  icon: '🖧', label: 'NETCONF'          },
  { tab: 'monitor',  icon: '📊', label: 'Monitoring'       },
  { tab: 'day2ops',  icon: '⚙️', label: 'Day-2 Ops'       },
  { tab: 'batfish',  icon: '🦟', label: 'Batfish Validate' },
]
```

Click handler: `setStep(6); setActiveDeployTab(sub.tab); onClose?.()`
Active style: `step === 6 && activeDeployTab === sub.tab`
Indentation: `pl-8` to nest under group header

---

## 18. BGP Timer Presets

```javascript
const BGP_TIMER_PRESETS = {
  dc_aggressive:  { keepalive: 3,  hold: 9,   adv_interval: 0,  note: "Use with BFD" },
  wan_standard:   { keepalive: 10, hold: 30,  adv_interval: 5 },
  conservative:   { keepalive: 60, hold: 180, adv_interval: 30, note: "Default — avoid in DC" }
}
// Warn if use_case=dc and timers=conservative
```

---

## 19. Monitoring Stack

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

## 20. Known Gaps (open items)

All items below are **open** (not yet implemented in the React wizard).
Use gap IDs in commit messages and conversations.

| ID | Gap | Priority |
|----|-----|----------|
| G-A1 | ✅ 2026-06-11 Intent NLP parser — free-text → Step 1 form fields (Claude API) | P1 |
| G-A2 | ✅ 2026-05-29 Professional HLD diagram — all layers interlinked, packet-flow scenarios, device-inspect panel | P1 |
| G-A3 | ✅ 2026-05-29 Batfish/pyATS dry-run validation placeholder tab (Batfish Validate in Step 6) | P1 |
| G-A4 | ✅ 2026-06-12 Config drift detection (running vs intended config text diff) — `POST /api/drift/config` (`backend/config_drift.py`) + Day-2 Ops "Config Drift Detection" UI; v1 slice — inline remediation tracked separately as G-A16 | P1 |
| G-A5 | ✅ 2026-05-29 Canary deployment (1 device first, confirm gate) — canary mode in Deploy Pipeline | P1 |
| G-A6 | ✅ 2026-06-12 ZTP file server (nginx + TFTP in docker-compose) — `ztp-files` (nginx, HTTP :8069) + `ztp-tftp` (`atmoz/tftpd`, UDP :69) services on a shared `ztp_files` volume; `backend/ztp/file_export.py` writes Day-0 configs/scripts, `POST /ztp/export-files` regenerates the tree, `generate_dhcp_config(..., tftp=True)` emits TFTP-relative filenames | P1 |
| G-A7 | ✅ 2026-06-13 Embedded monitoring stack (VictoriaMetrics + Grafana auto-provision) — `victoriametrics` service (long-term TSDB, `--retentionPeriod=12`, `vmdata` volume) in `docker-compose.yml` (always-on) + `docker-compose.dist.yml` (observability profile); Prometheus `remote_write`→VM in both `backend/prometheus/prometheus.yml` & `ops/prometheus.yml`; VM auto-provisioned as a 2nd Grafana datasource (`backend/grafana/.../datasources/prometheus.yml` + new `ops/grafana/datasources/datasources.yaml`); snmp-exporter split out as G-A18 | P1 |
| G-A8 | ✅ 2026-06-13 gNMI / streaming telemetry — **already implemented**: `backend/telemetry/gnmi_collector.py` (`TelemetryCollector`/`DeviceTarget`, OpenConfig subscriptions → `prometheus_client` metrics) wired into the app lifespan (`main.py` startup `.start()` / shutdown `.stop()`); collector configs generated by `lib/telemetry-gen.ts` (gnmic.yml, telegraf-gnmi.conf — C1). Stale "SNMP polling only" description | P2 |
| G-A9 | ✅ 2026-06-18 IOS-XR platform support (SP/WAN — SR-MPLS, L3VPN) — `iosxrPeConfig()` in `configgen.ts` emits true IOS-XR syntax (GigabitEthernet0/0/0/0, Loopback0, `!` separators, `route-policy`, IS-IS+SR `prefix-sid index` + TI-LFA, `vrf` L3VPN import/export RTs, `router bgp ... address-family vpnv4 unicast` RR + PE-CE eBGP, gNMI telemetry); `isIosXrPlatform()` dispatch (features `IOS-XR` or model ASR 9xxx/NCS/CRS/IOS-XRv); ASR 9904 + NCS 540 SKUs in `products.ts`; single underlay IS-IS+SR (no OSPF); 9 new tests | P2 |
| G-A10 | ✅ 2026-06-18 Private 5G / O-RAN use case (eCPRI, PTP timing) — new `oran` UseCase end-to-end: 7 O-RAN products (O-CU/O-DU/O-RU/fronthaul-sw/midhaul-rtr/5GC-UPF/PTP-GM) in `products.ts`; SCALE_DEFS + PREFERRED_PRODUCTS + ROLE_CODE + power/rack maps in `bom.ts`; 7 config generators in `configgen.ts` (`oranConfig` dispatch via `isOranSubLayer`): O-CU (F1/E1/NG SCTP), O-DU (eCPRI 7.2x split, n78 TDD, FAPI/L1), O-RU (64T64R mMIMO, beamforming, ZTP), fronthaul switch (PTP transparent-clock, eCPRI C7 QoS, PFC), midhaul router (PTP boundary-clock, IS-IS+SR, SyncE, telemetry), 5GC UPF (N3/N6/N9/N4, DPDK, 5QI), PTP grandmaster (GNSS, G.8275.1, SyncE PRC); HLD (`buildORANTopology`) + LLD (`buildORANLLD`) diagram builders; Step 1 use-case tile; 34 tests | P2 |
| G-A11 | ✅ 2026-06-18 Storage networking use case (NVMe-oF, FCoE, iSCSI) — `nxosStorageBlock(appTypes)` + `aristaStorageBlock(appTypes)` in `configgen.ts`: NX-OS FCoE (VSAN 100, vfc1, FIP snooping) + iSCSI VLAN 201 + NVMe-oF VLAN 202 + storage QoS (PFC pri 6, ACL-ISCSI port 3260, PM-STORAGE-QUEUING) + jumbo MTU; Arista same minus FCoE; wired into `nxosLeafConfig`/`aristaLeafConfig` via `appTypes` param; 19 tests | P2 |
| G-A12 | ✅ 2026-06-18 SD-WAN design (vEdge/vSmart/vBond architecture) — `sdwanEdgeConfig()` cEdge/vEdge config (system/site-id/org, VPN 0 transport dual-WAN IPSec tunnels, VPN 512 mgmt, VPN 1+2 service, OMP, zone-based FW, app-aware routing with SLA classes, DPI QoS); `sdwanControllerConfig()` for vManage/vSmart/vBond (OMP RR send-path-limit/ecmp-limit, vBond local orchestration, vManage NMS+VPN 512); `isSdWanEdge()` dispatch; BOM: `overlayProtocols` param on `buildDeviceList`/`buildBOM` injects vManage(1)+vSmart(2 HA)+vBond(2 HA) + swaps edges to Catalyst 8300 cEdge; 4 new SKUs (vManage, vSmart, vBond, Cat 8300); 28 tests | P2 |
| G-A13 | ✅ 2026-06-18 TCO / 3-year cost model in BOM — `computeTCO(devices, opts?)` in `bom.ts` (`TCOModel`/`TCOOpts`/`DEFAULT_TCO_OPTS`): capex (Σ device price) + 3-yr opex = power (ΣpowerW→kWh/yr × PUE 1.5 × $0.12/kWh, per-model lookup from PRODUCTS) + support (15%/yr × capex) + rack/colo (RU by subLayer × $150/RU/mo); per-category + byYear breakdown, all rates configurable. Step 4 Summary tab "3-Year Total Cost of Ownership" card w/ assumptions small-print; 11 tests | P2 |
| G-A14 | ✅ 2026-06-18 Rack layout and cable schedule in BOM — `RackElevation.tsx` pure-SVG 42U rack elevation with role-ordered device placement, power bar, color-coded by subLayer; `computeRackLayout()` assigns devices to racks with auto-overflow; `buildCableSchedule()` generates per-port cable runs; cable schedule + rack assignment tables; integrated as "Rack & Cabling" tab in Step 4; 11 tests | P2 |
| G-A15 | ✅ 2026-06-13 Intent NLP: free-text → structured wizard fields via Claude API — **duplicate of G-A1** (implemented 2026-06-11: `parseIntent`/`IntentParseResult` + `POST /api/intent/parse`) | P1 |
| G-A16 | ✅ 2026-06-13 Config drift detection: running vs intended diff with inline remediation — `POST /api/drift/remediate` (`config_drift.generate_remediation`/`build_remediation`, platform-aware Cisco `no`/Junos `set`+`delete`, restore-then-prune) + Day-2 Ops "Inline remediation" UI (per-device command blocks, copy/download); generation-only, no auto-push | P1 |
| G-A17 | ✅ 2026-06-18 SNMP exporter for monitoring stack — `genSNMPExporterConfig()` generates `snmp.yml` with SNMPv3 auth + 5 modules (IF-MIB, HOST-RESOURCES, ENTITY-SENSOR, BGP4, TCP/UDP); `genSNMPPrometheusJob()` generates Prometheus scrape jobs with relabel config routing through snmp-exporter:9116; `snmp-exporter` docker-compose service (prometheuscommunity/snmp-exporter:v0.26.0); download buttons in Step 6 Monitoring tab; 9 tests | P2 |
| G-A18 | ✅ 2026-06-17 LLD (Low-Level Design) diagrams for all 7 use cases — `LLDTopologyDiagram.tsx` pure-SVG component with per-device IP addresses, interface mappings, VLANs, config snippets, port-to-port link labels, physical cabling matrix; 7 builders (DC, Campus, GPU, WAN, Multisite, Multicloud, Aviatrix); integrated as "Low Level Design" tab in Step 4 Network Design | P1 |
| G-A19 | ✅ 2026-06-18 Troubleshooting Tooling Engine — symptom-driven diagnostic playbooks for 8 categories (bgp_down, ospf_adjacency, interface_flap, high_latency, packet_loss, high_cpu, vxlan_evpn, pfc_rocev2 + generic fallback); platform-specific show commands (NX-OS/IOS-XE/EOS/JunOS), ranked likely causes w/ confidence, remediation steps. `backend/troubleshoot.py` + `POST /api/troubleshoot` (57 pytest) + new "🩺 Troubleshoot" Step 6 sub-tab w/ demo-mode `simulateTroubleshoot()` + `useTroubleshoot` hook | P1 |

---

## 21. Implementation Rules

1. Run `cd frontend && npm test` after every change to `lib/configgen.ts` — 36 tests cover all config rules.
2. New backend types go in `frontend/src/types/index.ts`.
3. All server state uses TanStack Query (`useQuery` / `useMutation`) — no `useEffect + fetch`.
4. New UI components go in `frontend/src/components/ui/` (Badge, Button, Card, Toast pattern).
5. Never hardcode device counts — use `buildDeviceList()` in `lib/bom.ts`.
6. Secrets always use `<CHANGE-ME-*>` — never hardcode credentials in generated configs.
7. IS-IS for DC/GPU underlay; OSPF for WAN/campus. Never emit both in one config.
8. Demo mode: when `!isLive` (from `useBackendMode()`), use client-side simulation instead of API calls.
9. No new npm packages for UI — pure React + Tailwind only (no react-flow, d3, cytoscape, etc.).
10. `activeDeployTab` in Zustand store (not local state) enables sidebar-to-Step6 deep-linking.

---

## 22. Enterprise Upgrade Tracker (2026-06-11 →)

Working backlog for the "enterprise-grade" pass requested 2026-06-11
(config-gen topology-awareness, NetBox-driven ZTP, monitoring, HLD/design
polish). Any session picking this up should scan the status column, pick
the next `[ ]` item, implement + test + commit + push to
`claude/network-automation-enterprise-lifybd`, then flip the row to `[x]`
with the commit hash. Keep this table in sync — it is the single source of
truth for resuming this work after a context reset.

Status legend: `[ ]` pending · `[~]` in progress · `[x]` done (commit hash)

### A. Config generation — topology-aware (`frontend/src/lib/configgen.ts`)

| # | Item | Status | Notes |
|---|------|--------|-------|
| A1 | NX-OS leaf vPC domain: pair-based (`Math.floor(idx/2)+1`) instead of per-device; derive peer hostname + role priority | [x] | `nxosLeafConfig()`, `leafPairInfo()` helper |
| A2 | Arista leaf MLAG config (currently absent) | [x] | `aristaLeafConfig()`, uses `leafPairInfo()` helper |
| A3 | Cisco campus distribution/access: dedicated config generator (HSRP/FHRP, STP priority hierarchy, IGMP snooping, voice/data VLANs) — replace `iosxeWanConfig` dispatch for `distribution`/`access` | [x] | new `iosxeCampusConfig()`; `generateConfig`/`generateAllConfigs` now take `appTypes` |
| A4 | Arista gNMI / eAPI telemetry block (currently none) | [x] (`2643316`) | `aristaTelemetryBlock()` used by `aristaSpineConfig`/`aristaLeafConfig` |
| A5 | Topology-driven uplink counts (consume `buildDeviceList()` port-math instead of static comments) | [x] (`5b163df`) | `closFabricLinks()`/`renderNxosFabricLinks()`/`renderAristaFabricLinks()`; `generateConfig`/`generateAllConfigs` now take `allDevices` |
| A6 | IPv6 dual-stack underlay (stretch) | [x] (`d3165bb`) | NX-OS + Arista IS-IS spine-leaf (loopbacks + fabric P2P links), gated by `protoFeatures.includes('IPv6 Dual-Stack')`; OSPFv3 campus/WAN is a possible follow-up |
| A7 | Multisite EVPN DCI route-targets (stretch) | [x] (`35035f1`) | `DCI_RT_ASN=65100`; NX-OS + Arista leaf emit stretched `65100:<vni>` RTs alongside site-local RTs when `useCase==='multisite'`; also added missing EVPN MAC-VRF blocks + fixed NVE VNI roles |

Run `cd frontend && npm test` after each change in this section (36+ existing
config-gen tests must keep passing; add new tests alongside).

### B. ZTP + NetBox enterprise integration

| # | Item | Status | Notes |
|---|------|--------|-------|
| B1 | NetBox/Nautobot inventory import panel (Step 1) — port `src/js/netbox.js` to React/TS | [x] (`5ef5d88`) | `lib/netbox.ts` + `NetBoxImportPanel.tsx` in Step 1; imported devices in new `netboxDevices` store field for B2 |
| B2 | Wire ZTP device list (Step 6 ZTP tab) to optional NetBox-imported inventory | [x] (`e64b529`) | Device Source toggle in ZTP tab; `simDevices` consumes `netboxDevices` (also drives checks/monitoring demo lists) |
| B3 | Backend: ZTP→NetBox status sync + DHCP reservations via `backend/integrations/netbox.py` (stretch) | [x] (`c049627`) | `sync_ztp_status()` + `create_dhcp_reservation()`; wired into `/ztp/register`, `/ztp/register/bulk`, `/ztp/checkin` (fire-and-forget, gated by `ZTP_NETBOX_ORG` env) |

### C. Monitoring improvements

| # | Item | Status | Notes |
|---|------|--------|-------|
| C1 | Telemetry config generation: Prometheus alert rules, Grafana dashboard JSON, gNMI collector config, SNMP/syslog/NetFlow — port from `src/js/telemetry.js` | [x] | `frontend/src/lib/telemetry-gen.ts` + Step6Deploy Monitoring tab "Observability Downloads" buttons (gnmic.yml, telegraf-gnmi.conf, prometheus-alerts.yml, grafana-dashboard.json); SNMP/syslog/NetFlow already covered by M-51/M-52 |
| C2 | HLD topology health overlay — color nodes by `useMonitoring()` status, click drill-down | [x] (`826c75c`) | `HLDTopologyDiagram.tsx` — self-contained `simulateNodeHealth()`, "🩺 Health Overlay" toggle, status badges + "Live Health" drill-down panel |
| C3 | Anomaly detection (z-score baselines) (stretch) | [x] (`67f161b`) | `backend/telemetry/anomaly.py` — `AnomalyDetector` rolling z-score; `GET /api/anomalies` in `main.py` |

### D. Enterprise HLD / design polish

| # | Item | Status | Notes |
|---|------|--------|-------|
| D1 | HLD diagram + design summary reflect computed topology (MLAG pairs, FHRP VIPs, DCI links) once A1–A3 land | [x] (`e3492a7`) | `pairInfo()` + node annotations/peer-links in `HLDTopologyDiagram.tsx`; `genComputedTopology()` + summary card in `Step4NetworkDesign.tsx`; exported `haPairInfo`/`DCI_RT_ASN` from `configgen.ts` |
| D2 | LLD diagram vendor-awareness — the LLD builders (`buildCampusLLD`, `buildWANLLD`) received the BOM `devices` array but ignored it (`_devices`) and hardcoded Cisco SKUs (C9500/C9300/ASR), so picking Juniper/Arista/Nokia showed wrong hardware in the Low-Level Design (inconsistent with the HLD, which already derives from BOM per E3). Add shared `bomRole(devices, subLayer, fallback)` helper; campus core/distribution/access/wan-edge + WAN PE routers now derive vendor/model/hostname from the BOM (fallback to the Cisco defaults only when the BOM lacks that role); 5 new tests | [x] | `LLDTopologyDiagram.tsx`; new `test/LLDTopologyDiagram.test.tsx` (5) |
| D3 | HLD diagram vendor-awareness for firewall / WAN-edge / core — the HLD already derived spine/leaf/dist/access from the BOM (E3/D1) but still hardcoded the **firewall** (PA-5450/PA-3430), **wan-edge** (ASR-1002-HX/ASR-1001X/ASR-9001), and campus **core** (C9500-32QC) nodes, so picking Fortinet/Juniper/etc. showed a Palo Alto firewall + Cisco routers in the most-viewed diagram. `buildDCTopology`/`buildCampusTopology`/`buildWANTopology` now derive firewall + wan-edge (+ campus core) vendor/model from the BOM (Cisco/Palo-Alto SKUs are fallback only); 4 new tests | [x] | `HLDTopologyDiagram.tsx`; `test/HLDTopologyDiagram.test.tsx` (16→20) |
| D4 | LLD vendor-awareness for the remaining use cases (multisite / multicloud / aviatrix) — these LLD builders still ignored `devices` (`_devices`) and hardcoded Cisco N9K/ASR. `buildMultisiteLLD` now derives spine/leaf + DCI-gateway vendor/model from the BOM (keeps site-specific hostnames; DCI follows wan-edge → spine vendor fallback); `buildMulticloudLLD` derives the on-prem DC spine; `buildAviatrixLLD` derives the on-prem DC-edge routers from BOM wan-edge. Cloud-native nodes (AWS/Azure/GCP/Aviatrix) stay provider-native. Completes diagram vendor-correctness across all 8 use cases (HLD + LLD); 4 new tests | [x] | `LLDTopologyDiagram.tsx`; `test/LLDTopologyDiagram.test.tsx` (5→9) |

### E. Dead-code / consistency cleanup (sourced 2026-06-18 — §20+§22 A–D exhausted)

| # | Item | Status | Notes |
|---|------|--------|-------|
| E1 | Remove LEGACY/UNUSED wizard pages + nav superseded by Step6Deploy sub-tabs / Sidebar (`Step4ZTP.tsx`, `Step5Checks.tsx`, `Step6Monitor.tsx`, `WizardNav.tsx`) — only referenced by `e2e-features.test.ts`; fix that test to assert the real live page set | [x] (`f86ace8`) | files deleted; `e2e-features.test.ts` "App structure" now lists the 6 live pages (Step1UseCase, Step2Requirements, Step2Design, Step4NetworkDesign, Step3Config, Step6Deploy) + drops WizardNav; CODE_REFERENCE.md LEGACY sections removed; live hooks (`useRunZTP`/`useRunChecks`/`usePollMonitoring`) retained (still used by Step6Deploy) |
| E2 | Fix stale "Next: ZTP →" button label on the Config Gen page (Step3Config, wizard step 5) — actual next step is Step 6 Deploy & Validate | [x] | now "Next: Deploy & Validate →" (matches Sidebar label); CODE_REFERENCE.md note updated |
| E3 | Fix label/vendor correctness bugs at large scale (reported on a 2048-GPU design): (a) `rackLabel` hostname generator overflowed past `Z` into ASCII symbols (`[ \ ] ^ _`) for >26 leaf pairs; (b) `computeRackLayout` rack labels had the same overflow; (c) GPU HLD/LLD builders hardcoded NVIDIA spine/leaf instead of the BOM vendor/model | [x] | new exported `alphaLabel()` bijective base-26 (A–Z, AA, AB…) in `bom.ts`, used by `rackLabel` + `RackElevation.computeRackLayout`; `buildGPUTopology`/`buildGPULLD` now derive spine/leaf vendor+model+hostname from the BOM (fallback to NVIDIA only when absent); `haPairInfo` unaffected (still keys off trailing `01`/`02`); 6 regression tests in `bom.test.ts` |

### F. NetBox / Nautobot parity — IPAM (sourced 2026-06-18)

| # | Item | Status | Notes |
|---|------|--------|-------|
| F1 | IPAM source-of-truth export — push the computed IP/VLAN/prefix plan to NetBox/Nautobot as bulk-import CSVs | [x] | new `lib/ipam.ts` (single source of truth): moved `genIPBlocks`/`genIPRows`/`genVLANs`/`genVNIs` out of `Step4NetworkDesign.tsx` + added `toNetBoxPrefixCsv`/`toNetBoxVlanCsv`/`toNetBoxIpAddressCsv`/`buildNetBoxIpamExport` (NetBox 3.x/4.x ipam.prefix/vlan/ipaddress headers, CIDR validation, de-dup, RFC-4180 quoting); 3 export buttons in Step 4 "IP Plan" tab; 13 tests in `test/ipam.test.ts` |

### G. Rack model — ToR + GPU compute (sourced 2026-06-18)

| # | Item | Status | Notes |
|---|------|--------|-------|
| G1 | ToR + GPU compute server rack model — derive compute servers from endpoint count (2048 GPUs → 256 servers), ToR-based rack placement (leaf MLAG pair + N servers per rack), spines in dedicated network rack(s) | [x] | new `gpu-server-4u` product (4U, 8×H100, 6.5kW, $150k); `GPUS_PER_SERVER=8` constant; GPU compute injection in `buildDeviceList`; sequential hostnames (`GPU-001`); `computeToRLayout` in `RackElevation.tsx` (10 servers/rack); SVG capped at 12 racks; 13 new tests |

### H. Design export/import & documentation (sourced 2026-06-18)

| # | Item | Status | Notes |
|---|------|--------|-------|
| H1 | Design export (JSON + Markdown report) and import — full intent+BOM+configs serialization, round-trip validation, Markdown design report with TCO | [x] | new `lib/design-export.ts` (`serializeDesign`/`validateDesignImport`/`applyDesignImport`/`buildDesignMarkdown`/`downloadDesignJSON`/`downloadDesignMarkdown`); 3 export/import buttons in Step 4 Summary tab; 18 tests in `test/design-export.test.ts` |
| H2 | Compliance Scanner — framework-aware design validation (PCI/HIPAA/SOC2/FedRAMP/ISO27001/NIST CSF) with per-control pass/fail/warn, score, and exportable report | [x] | new `lib/compliance-scan.ts` (`runComplianceScan`/`exportComplianceReport`, 6 frameworks × 5-8 controls each checking design state + generated configs); replaced static Day-2 Ops "Compliance Audit" with live scanner UI (score badge, grouped controls, export report button); 22 tests in `test/compliance-scan.test.ts` |
| H3 | Capacity Planning — compound growth projection with utilization thresholds and expansion recommendations | [x] | new `lib/capacity-planning.ts` (`computeCapacityPlan`); Step 4 Summary tab "Capacity Planning" card with growth-rate selector and projection table; 15 tests in `test/capacity-planning.test.ts` |
| H4 | BOM design validation — detect oversubscription degradation, fan-out limits, capacity issues, power draw | [x] | `validateBOM()` in `bom.ts`; "Design Validation" card in Step 4 between stats and tabs; 9 tests in `test/bom.test.ts` |
| H5 | Endpoint-driven port-math for ALL use cases — device counts derived from totalEndpoints, bandwidthPerServer, oversubscription, numSites for all 8 use cases (DC, GPU, campus, WAN, multisite, multicloud, aviatrix, O-RAN) | [x] | Refactored `buildDeviceList` port-math: extracted `computeSpineLeaf()` helper; added WAN (router count from endpoints), multisite (spine-leaf + WAN edges from numSites), O-RAN (RU→DU→CU→fronthaul→midhaul cascading ratios), multicloud/aviatrix (transit per site, GW per 500 endpoints); `validateBOM` expanded for campus/WAN validation; `numSites` param added to `buildDeviceList`/`buildBOM`; 15 new tests across all use cases |

### I. End-to-end test harness & trust (sourced 2026-06-19)

> **Why this group exists**: the port-math bugs (spine count, uplinks,
> cabling, per-use-case sizing) shipped for *months* despite daily review
> because the unit tests never exercised the integrated path with real
> endpoint counts and only asserted weak bounds (`>= 2`). The fix is a
> full-journey harness with EXACT, cross-checked invariants.

| # | Item | Status | Notes |
|---|------|--------|-------|
| I1 | E2E "user journey" regression harness — simulates the real wizard flow (intent → BOM → configs → cabling → optics → racks → validation) for **all 8 use cases × scales × port speeds × oversub × site counts × vendors** (~190 scenarios) and asserts exact physical invariants: fabric capacity ≥ endpoints, spine-leaf cable qty = leaves×uplinks, TCO capex = grandTotal, every network device has a non-empty config, single underlay (no IS-IS+OSPF), fabric has BGP, GPU has PFC, hostnames alnum at extreme scale, device-count monotonic in endpoints, spine-count monotonic in bandwidth, no hardcoded secrets | [x] | `test/e2e-journey.test.ts`; this is the standing regression net — **add a scenario here for any new use case / sizing rule**. Runs in CI (`frontend-test` job) on every push/PR. |
| I2 | SessionStart hook so Claude Code web sessions auto-install frontend deps and can run the suite immediately | [x] | `.claude/hooks/session-start.sh` + `.claude/settings.json` (synchronous, remote-only via `$CLAUDE_CODE_REMOTE`, idempotent `npm install`) |
| I3 | Expand the e2e vendor matrix + wire it to the config-validator — `VENDOR_SETS` grew from 4 (Cisco/Arista/NVIDIA/Juniper) to 7 (+ Nokia, Dell EMC, Extreme), and the vendor-matrix scenarios now run `validateConfigs()` and assert zero hard FAILs per vendor + `assertConfigCorrectness`. This immediately caught a real validator false-negative: `RE_BGP` required `router bgp` + a literal digit, but NVIDIA Cumulus/Dell emit `router bgp <CHANGE-ME-asn>` (placeholder) and Extreme uses `configure bgp AS-number` → false V-03 "no BGP" FAIL. Broadened `RE_BGP` (`router bgp\b` + `configure bgp\b`); added a V-03 placeholder-ASN unit test | [x] | `test/e2e-journey.test.ts` (VENDOR_SETS + validator assertion); `lib/config-validator.ts` `RE_BGP`; `test/config-validator.test.ts` (+1); 1001 tests total |

### J. User accounts & per-user experience (sourced 2026-06-19)

> User-requested: a NetBox-like login / per-user design experience. Approach
> chosen: **frontend login wired to the existing backend auth** (`backend/
> auth.py` already has JWT/OIDC/TOTP/RBAC) with graceful demo-mode fallback
> to local profiles. Scope: per-user My Designs, preferences, activity, and
> role-based UI gating.

| # | Item | Status | Notes |
|---|------|--------|-------|
| J1 | Auth foundation + login UI + per-user My Designs + role gating | [x] | `store/useAuthStore.ts` (backend login via `/api/auth/token`+`/totp-verify`, demo local profiles, `can()` mirroring backend `ROLE_PERMISSIONS`, per-user `prefsByUser`, `authScopeKey()`); `LoginModal.tsx` (account + demo-profile tabs, MFA step); Sidebar account block (user badge, role chip, sign in/out) + role-gated Enterprise/policy items (gating only applies when signed in — guests keep full access); `MyDesigns` storage key namespaced per user; `client.ts` `login()`/`verifyTotp()`; 14 tests `auth-store.test.ts` |
| J2 | Per-user activity dashboard + full preferences sync + backend-persisted designs (`/api/designs`) — apply saved theme/vendorPrefs on login, "recent designs" view, profile switcher UI, server-side design storage when live | [x] | `activitiesByUser` in auth store (per-user, capped 50, persisted); `logActivity()` action tracks create/load/delete/deploy/export; `getActivities()` selector; `useApplyPrefsOnLogin` hook (theme, vendorPrefs, lastUseCase synced on login); MyDesigns: tabs (Saved/Recent Activity), activity timeline with action icons + relative timestamps; Sidebar: profile switcher dropdown (avatar click reveals other saved profiles); `client.ts`: `fetchUserPrefs`/`saveUserPrefs`/`fetchUserActivity`/`postUserActivity` for backend sync when live; 7 new tests in `auth-store.test.ts` (21 total) |

### K. Closed-loop automation (sourced 2026-06-22 — §20 + §22 A–J exhausted)

> Per §23 "Sourcing new work" priority 3: drift detection → auto-remediation,
> auto-rollback on post-check regression. Builds on existing pre/post checks
> (§12), drift remediation (G-A4/G-A16), and the documented platform-native
> rollback strategies (§9 ROLLBACK_STRATEGIES — currently Python-only, not
> exposed in the frontend).

| # | Item | Status | Notes |
|---|------|--------|-------|
| K1 | Auto-rollback on post-check regression — detect checks that regressed PASS→FAIL/WARN between pre and post phases, classify severity, and generate platform-native rollback commands (§9 strategies) per affected device; surface as a "Rollback Advisor" in Step 6 | [x] | new `lib/rollback.ts` (`ROLLBACK_STRATEGIES` ported from §9, `vendorToPlatform`, `detectRegressions` PASS→FAIL=critical/WARN→FAIL=major/PASS→WARN=minor, `generateRollbackPlan`, `rollbackCommandsFor`, `rollbackTimestamp`, `rollbackPlanToText`); "🛟 Rollback Advisor" card in Step 6 Checks tab (after Pre→Post Delta) — recommendation banner, per-device regression list + platform-native restore commands, download runbook; 25 tests in `test/rollback.test.ts` |
| K2 | Closed-loop orchestration view — a single Day-2 Ops panel that runs the full loop end-to-end: drift detect → generate remediation → (demo) re-push → re-check → show converged/diverged status. Ties together existing `simulateConfigDrift`/`simulateRemediation` (G-A4/G-A16) + checks into one stepped workflow with a loop-status timeline | [x] | new `lib/closed-loop.ts` (`runClosedLoop(drift, remediation, opts)` → 5-stage pipeline detect/plan/apply/verify/done + per-device convergence; `closedLoopToText` report); "🔁 Closed-Loop Remediation" card in Step 6 Day-2 Ops tab — Run Loop button, divergence-demo checkbox, stage timeline, per-device CONVERGED/DIVERGED, download report; composes existing demo simulators; 12 tests in `test/closed-loop.test.ts` |
| K3 | Scheduled/periodic compliance + drift scans — a "watchers" config (interval, scope, action) that the UI can define and export as a cron/systemd-timer + script bundle; demo-mode shows a simulated scan history timeline | [x] | `lib/scheduled-scans.ts` (WatcherConfig, exportCronTab, exportSystemdTimer, exportScanScript, simulateScanHistory); "📅 Scheduled Scans" card in Day-2 Ops; 27 tests in `test/scheduled-scans.test.ts` |

### L. Dead-code cleanup + observability wiring (sourced 2026-06-23)

| # | Item | Status | Notes |
|---|------|--------|-------|
| L1 | Remove unused UI primitives (`ui/index.ts` barrel, `ui/Input.tsx`, `ui/Select.tsx`, `ui/Dialog.tsx`, `ui/Skeleton.tsx`, `ui/Tabs.tsx`) and wire orphaned observability panels (`AlertsPanel`, `RcaPanel`, `LiveProgressFeed`) into Step 6 Deploy tab as a collapsible observability sidebar | [x] | 6 dead UI files removed; observability panels wired into Deploy tab as collapsible panel with tabbed Alerts/RCA/Feed views |

### M. Accessibility + validation quality (sourced 2026-06-23)

| # | Item | Status | Notes |
|---|------|--------|-------|
| M1 | Accessibility pass — add ARIA attributes, roles, labels, and keyboard navigation to Step 6 tabs, HLD/LLD SVG diagrams, interactive controls, and all Card/Button/Badge UI primitives | [x] | ARIA tablist/tab/tabpanel + keyboard nav on Step 6 tabs; `role="img"` + `aria-label` + `<title>` on HLD/LLD/Rack SVGs; `nav` landmarks + `aria-current` + `aria-expanded` on Sidebar; `role="status"` on Badge; observability panel `aria-expanded`/`aria-controls` |
| M2 | Batfish validation engine — replace the fake 5-step setTimeout animation with real client-side config validation (parse generated configs against intent constraints, check reachability invariants, protocol consistency, ACL coverage) | [x] | `lib/config-validator.ts` — 13 checks (V-01…V-13): single underlay, duplicate router-IDs, BGP presence/peer reachability, EVPN consistency, hostname/management/loopback, no hardcoded secrets, undefined ACL refs, GPU QoS, BFD; `ValidationResult` w/ summary counts; `validationReportText` export; wired into Step 6 Batfish tab with real results + download report; 24 tests |
| M3 | Vendor-aware validator syntax detection — the M2 validator's regexes were Cisco/Arista-CLI-only and produced FALSE failures on the Q1 Nokia/Juniper configs (Nokia DC fabric `bgp {`/`autonomous-system` → false V-03 FAIL; Nokia `ntp {`/`logging {` → false V-07 WARN; Juniper `host-name` → false V-06 WARN). Add `RE_BGP`/`RE_ISIS`/`RE_OSPF`/`RE_HOSTNAME`/`RE_MGMT`/`RE_ROUTING_DEVICE` detectors recognizing Junos `set` syntax + Nokia SR Linux YANG blocks; extend `extractLoopbacks()` for Junos `lo0` + Nokia `system0` | [x] | `lib/config-validator.ts`; 7 new tests using real generated Nokia/Juniper/Arista configs (24→31); also fixed stale CODE_REFERENCE.md legacy-file references (E1 files were deleted but still documented) |
| M4 | Vendor-aware compliance scanner (H2) syntax detection — the same Cisco-only-regex bug as M3, in `lib/compliance-scan.ts`: SSH-v2 check `ssh.*version 2` missed Juniper `protocol-version v2` (the `v` breaks `version\s*2`) and Nokia `ssh-server` → false PCI-2.3 + FDRP-AC-17 FAIL; syslog check `logging (host|remote)` missed Nokia `logging {`/`remote-server` → false PCI-6.1 FAIL; NTP check `ntp server` missed Nokia `ntp {` → false PCI-10.1 FAIL. These distorted the compliance **score** for non-Cisco designs. Add `RE_SSH_V2`/`RE_SYSLOG`/`RE_NTP` detectors | [x] | `lib/compliance-scan.ts`; 7 new tests using real generated Nokia/Juniper configs (22→29) |
| M5 | Jumbo-MTU correctness on VXLAN fabrics + new validator check — audit found Nokia/NVIDIA/Extreme spine-leaf (and the non-GPU Dell OS10 path) emitted **no jumbo MTU**, so a VXLAN underlay defaulted to 1500 and silently dropped/fragmented the 50B-larger encapsulated frames. (1) Add jumbo MTU to those fabrics — Nokia `interface ethernet-1/1 mtu 9232`, NVIDIA Cumulus `swp1-N mtu 9216`, Extreme `enable jumbo-frame ports all`/`jumbo-frame-size 9216`, Dell `interface range ethernet … mtu 9216`. (2) New validator check **V-14** (Fabric): flags VXLAN/NVE devices lacking a jumbo (≥9000) underlay MTU, vendor-aware (`mtu`/`jumbo-frame-size 9xxx`), only in fabric use-cases. 3 new tests (incl. all-vendor pass + a warn case); validator now 14 checks | [x] | `configgen.ts` (4 vendors) + `config-validator.ts` `checkJumboMtu`; configgen 109, config-validator 31→34 |
| M6 | V-12 loopback false-WARN on NVIDIA Cumulus — V-12 flagged "missing loopback interface" for any routing device whose loopback `extractLoopbacks()` couldn't parse a numeric IP from. NVIDIA Cumulus declares its loopback as `iface lo` with a `<CHANGE-ME-loopback-ip>` placeholder, so a routing device that *does* have a loopback was false-warned. Add `RE_LOOPBACK_IFACE` (recognizes `interface Loopback`, Junos `interfaces lo0`, Nokia `interface system0`, Cumulus `iface lo`/`auto lo`) and treat a device as having a loopback if either a numeric IP was extracted OR a loopback interface is declared; 1 new test | [x] | `lib/config-validator.ts` `checkLoopbackPresence`; `config-validator.test.ts` (+1, 35) |
| M7 | Two multi-vendor gaps surfaced by a full validator audit (ran the validator over all 7 vendors × dc/gpu, inspected every WARN): (1) **Dell OS10 had no loopback interface** at all — used `<CHANGE-ME-loopback-ip>` for the BGP router-id but never declared `interface loopback 0` → real config gap + V-12 warn; added the loopback interface. (2) **Extreme EXOS** sets its identity via `configure snmp sysName` (no `hostname` keyword in classic EXOS) → false V-06 warn; `RE_HOSTNAME` now recognizes `sysName`. 2 new tests | [x] | `configgen.ts` (Dell loopback) + `config-validator.ts` (`RE_HOSTNAME` += `sysName`); config-validator.test.ts 35→37 |
| M8 | BFD for fast failover across all DC fabrics — V-13 was warning for Cisco/Juniper/Nokia/Extreme (only Arista/Dell/NVIDIA emitted BFD). Add it to the fabric BGP: NX-OS `feature bfd` + `bfd` in the SPINE-RR/LEAF-RR-CLIENT peer templates; Juniper `bfd-liveness-detection minimum-interval 300 multiplier 3` on the LEAVES/SPINE-RR groups; Nokia `failure-detection { enable-bfd true fast-failover true }`; Extreme `configure bgp neighbor all bfd on`. Also hardened the e2e harness: the vendor matrix now asserts the **config-controlled checks** (V-01/03/06/07/12/13/14) are WARN-free for every vendor (V-04 placeholder-peer warn excluded by design) — locks in M3–M8 | [x] | `configgen.ts` (4 vendors) + `e2e-journey.test.ts` controlled-WARN gate; 1004 tests |
| M9 | V-04 false-positive on commented-out example neighbors — `extractBgpNeighborIPs` regex-scanned the whole config, so the NX-OS spine's documentation line `! neighbor 10.255.2.1 inherit peer LEAF-RR-CLIENT` was parsed as a live BGP peer → "peer not reachable" WARN (no device owns that example IP). Add `isCommentLine()` (skips `!`/`#`/`//` lines) and parse neighbors line-by-line. V-04 is now clean for all 7 vendors and was promoted into the e2e harness's controlled-WARN gate (now V-01/03/04/06/07/12/13/14). 2 new tests | [x] | `config-validator.ts` `extractBgpNeighborIPs`/`isCommentLine`; `config-validator.test.ts` (+2); `e2e-journey.test.ts` gate; 1006 tests |

### N. Lab topology export + interop (sourced 2026-06-23)

> Network engineers need to test designs in virtual labs before production
> deployment. Exporting the BOM-derived topology as lab-tool-native formats
> (containerlab, CML, GNS3) lets users spin up a faithful replica of their
> design with one command. This is a major differentiator vs. NetBox/Nautobot.

| # | Item | Status | Notes |
|---|------|--------|-------|
| N1 | Containerlab topology export — generate `containerlab.yml` from BOM devices + cabling with vendor-correct container images (ceos, crpd, nxos, srl), links derived from cable schedule, startup-config bind mounts from generated configs; download button in Step 4 | [x] | `lib/containerlab.ts` — `buildContainerlabTopology`/`topologyToYAML`/`generateStartupConfigs`/`containerlabReadme`; vendor→image mapping (Cisco NX-OS/IOS-XE/IOS-XR, Arista cEOS, Juniper cRPD, Nokia SRL, NVIDIA CVX, PAN-OS); multi-count device expansion; link generation from cabling; "Containerlab (.yml)" button in Step 4 Summary tab; 19 tests |
| N2 | SVG diagram download — export HLD and LLD topology diagrams as standalone SVG files for inclusion in design documents | [x] | HLD already had SVG export; added LLD SVG export (`handleExportLLDSVG` + `lldRef`) with "⬇ SVG" button in LLD tab header |

### O. Troubleshooting engine — TAC KB expansion (sourced 2026-06-23)

> Expand the troubleshooting engine from 8 symptom categories to 20
> TAC-knowledge-base-level playbooks, grouped by category. Each playbook
> provides platform-specific diagnostic commands (NX-OS/IOS-XE/EOS/JunOS),
> ranked likely causes with confidence scores, and step-by-step remediation.

| # | Item | Status | Notes |
|---|------|--------|-------|
| O1 | TAC KB troubleshooting expansion — 12 new symptom playbooks (stp_loop, dhcp_failure, mtu_blackhole, aaa_auth_failure, hsrp_vrrp, mac_flap, vpc_mlag, ntp_sync, hardware_failure, memory_exhaustion, routing_loop, isis_adjacency) with category-grouped `<optgroup>` dropdown UI | [x] | `TROUBLESHOOT_SYMPTOMS` expanded to 20 entries with `group` field; `TROUBLESHOOT_PLAYBOOKS` expanded to 20 full playbooks; UI dropdown uses `<optgroup>` by group (Routing, Overlay, Physical/L2, Performance, Device Health, Services, Redundancy, GPU Fabric) |
| O2 | Spine-Leaf Fabric troubleshooting workflow (from the "SPINE-LEAF FABRIC TROUBLESHOOTING — Cisco + Juniper" reference) — audited the 10 fabric steps vs the engine: physical links (interface_flap), underlay routing (bgp_down/ospf/isis), MTU (mtu_blackhole), overlay/EVPN (vxlan_evpn), end-to-end (packet_loss/high_latency) were covered; the **4 fabric-specific steps were missing**, now added as playbooks with the exact Cisco(nxos/iosxe/eos)+Juniper commands: **loopback_reachability** (step 3 — loopback advertised/reachable, source-iface), **ecmp_inconsistency** (step 4 — equal-cost next-hops, FIB install, exact-route polarization, LAG hash), **border_leaf** (step 6 — external/DCI peering, import/export, advertised-routes, route-map), **services_leaf** (step 7 — service iface, VLAN↔VRF, in-VRF route, symmetric path). New "Spine-Leaf Fabric" `<optgroup>` | [x] | `Step6Deploy.tsx` `TROUBLESHOOT_SYMPTOMS` 20→24 + 4 playbooks; tsc + build green; 1074 tests |
| O3 (backend) | Backend `/api/troubleshoot` parity for the 4 spine-leaf fabric playbooks — `backend/troubleshoot.py` `PLAYBOOKS` 8→12 (loopback_reachability, ecmp_inconsistency, border_leaf, services_leaf) mirroring the frontend O2 playbooks (same Cisco/Juniper commands, causes, remediation) so the API returns the fabric workflow too | [x] | `backend/troubleshoot.py`; 57 troubleshoot pytest pass |

### P. Product catalog expansion & budget-aware BOM (sourced 2026-06-24)

> Expand the hardware product catalog with realistic, price-tiered models
> per vendor (entry/mid/premium), and wire `budgetTier` into BOM generation
> so SMB/mid-market designs don't produce million-dollar BOMs. Budget bands
> validate that the generated BOM stays within the user's budget ceiling.

| # | Item | Status | Notes |
|---|------|--------|-------|
| P1 | Expanded product catalog + budget-aware BOM — 30+ new SKUs across all major vendors (Nokia SRL, Arista 7020R/7060X/720XP, Juniper QFX5130/EX4400/EX4650/SRX/MX204, Palo Alto PA-460/PA-3260, Cisco Nexus 3232C/93108TC/ISR4331/FTD1150/Cat9300, Dell S5232F/N3248TE, HPE Aruba CX6200, Fortinet FG100F/FG600F); `budgetTier` wired into `buildDeviceList`/`buildBOM`/`validateBOM` via `BUDGET_TIER_PREFS`/`BUDGET_VENDOR_OVERRIDES`/`BUDGET_BANDS`; budget validation (error when BOM > ceiling, warning at 80%); 13 new tests | [x] | products.ts: 45→75+ SKUs; bom.ts: `BUDGET_BANDS` (smb<$100K, mid<$500K, enterprise<$2M, hyperscale=∞), `BUDGET_TIER_PREFS` (Cisco tier overrides), `BUDGET_VENDOR_OVERRIDES` (per-vendor tier overrides for 8 vendors); Step4/Step2 pass `budgetTier` to BOM calls |

### Q. Vendor config generator expansion (sourced 2026-06-24)

> Ensure every vendor that has products in the catalog also has proper
> config generation — no silent fallback to `genericConfig` for roles
> the vendor covers. Adds platform-authentic config generators for
> Nokia SR Linux, Juniper campus/WAN/firewall, and Arista campus.

| # | Item | Status | Notes |
|---|------|--------|-------|
| Q1 | Vendor-specific config generators + dispatch wiring — `nokiaSrLinuxConfig` (YANG-style: system, ISIS, BGP/EVPN, mac-vrf, VXLAN), `juniperCampusConfig` (EX dist: VLANs, VRRP, OSPF, RSTP; access: trunk, RSTP portfast), `juniperSrxConfig` (SRX: security zones TRUST/UNTRUST/DMZ, policies, IPS, NAT, HA cluster), `juniperWanConfig` (MX: OSPF, BGP, MPLS/LDP, BFD), `aristaCampusConfig` (EOS dist: VLANs, virtual-router, OSPF; access: switchport, RSTP); dispatch in `generateConfig()` updated; 15 new tests | [x] | configgen.ts: 5 new generators + dispatch routes; configgen.test.ts: 78→93 tests |
| Q2 | Fortinet FortiSwitch campus config generator — the Q1/P1 catalog has FortiSwitch T1024E (distribution) + 148F-POE (access) and `VENDOR_PRODUCT_MAP.Fortinet.campus` assigns them, but `generateConfig()` only handled `Fortinet && firewall` → FortiSwitch campus devices fell through to the `genericConfig` TODO stub. Add `fortinetCampusConfig(dev, idx, appTypes)` (FortiSwitchOS 7.x `config … end`: system/admin/DNS/syslog/NTP/SNMPv3, VLAN db, MSTP, dist L3 SVIs+VRRP+OSPF/BFD, access L2 PoE+/802.1X/BPDU-guard, voice VLAN gated on `appTypes`, storm-control, LLDP); dispatch wired for distribution/access; 5 new tests | [x] | configgen.ts: `fortinetCampusConfig` + dispatch; configgen.test.ts: 93→98 tests |
| Q3 | Juniper spine vs leaf differentiation — `generateConfig()` routed BOTH Juniper spine and leaf to `juniperLeafConfig`, so a Juniper spine got a leaf config (header "DC Leaf", lo0 in the `10.255.2.x` leaf range, leaf ASN `65001+idx`, BGP peering UP to spines, EVPN VTEP). Add `juniperSpineConfig` (role "DC Spine", lo0 `10.255.1.x`, `autonomous-system 65000`, `bgp group LEAVES` eBGP peering DOWN to leaves, IS-IS underlay, NOT a VTEP — no `vtep-source-interface`/`vrf-target`); split dispatch into spine→`juniperSpineConfig`, leaf→`juniperLeafConfig`; 2 new tests | [x] | configgen.ts: `juniperSpineConfig` + dispatch split; configgen.test.ts: 98→100 tests |
| Q4 | Multisite DCI route-target parity for Juniper + Nokia — only Cisco/Arista leaves emitted the stretched `DCI_RT_ASN` (65100):`<vni>` route-targets when `isMultisite` (A7); the dispatch never passed `isMultisite` to the Juniper/Nokia leaves, so multisite designs on those vendors had no inter-site VNI leaking. Thread `useCase === 'multisite'` to `juniperLeafConfig`/`nokiaSrLinuxConfig`; Juniper leaf emits `vni-options vni 10010 vrf-target target:65100:10010` (+ L3 `routing-instances EVPN-L3 vrf-target target:65100:50000`); Nokia mac-vrf `bgp-vpn bgp-instance 1 route-target export-rt/import-rt target:65100:10010`; both gated on multisite (DC designs unchanged); 3 new tests | [x] | configgen.ts: `juniperLeafConfig`/`nokiaSrLinuxConfig` `isMultisite` param + dispatch; configgen.test.ts: 100→103 tests |
| Q5 | IPv6 dual-stack underlay parity for Juniper + Nokia — the `IPv6 Dual-Stack` protoFeature (selectable in Step 2) was only honored by Cisco NX-OS + Arista EOS (A6); Juniper/Nokia silently ignored it. Thread `protoFeatures` to `juniperSpineConfig`/`juniperLeafConfig`/`nokiaSrLinuxConfig`; Juniper adds `family inet6 address` on lo0 + fabric ports and `set protocols isis topologies ipv6-unicast`; Nokia adds `system0` ipv6 address + IS-IS `ipv6-unicast { admin-state enable }`; gated on the feature (v4-only designs unchanged); 3 new tests | [x] | configgen.ts: `protoFeatures` param on the 3 generators + dispatch; configgen.test.ts: 103→106 tests |
| Q6 | GPU RoCEv2 lossless parity for Juniper — Juniper is a selectable GPU-fabric vendor (`juniper-qfx5130`/`qfx5120` in `VENDOR_PRODUCT_MAP.gpu`), but `juniperSpineConfig`/`juniperLeafConfig` emitted no PFC/ECN/RDMA, so a Juniper GPU fabric was non-deployable and failed validator V-09 (GPU QoS). Add `juniperRoceBlock()` (Junos CoS: RDMA no-loss forwarding-class queue-3, DSCP-26 classifier, `congestion-notification-profile … pfc`, ECN WRED drop-profile, 60%-BW scheduler with `explicit-congestion-notification`) wired into both Juniper spine+leaf when `needsRoce`; thread `needsRoce` through dispatch. 3 configgen tests + 1 validator integration test (Juniper GPU now passes V-09) | [x] | configgen.ts: `juniperRoceBlock` + dispatch; configgen.test.ts 106→109; config-validator.test.ts 31→32 |
| Q7 | Storage lossless (NVMe-oF/iSCSI) appType parity for Juniper + Nokia — Cisco/Arista leaves emit `nxosStorageBlock`/`aristaStorageBlock` (PFC priority-6 no-drop storage class) when the `storage` app type is set, but Juniper/Nokia leaves ignored `appTypes`. Thread `appTypes` to `juniperLeafConfig`/`nokiaSrLinuxConfig`; add `juniperStorageBlock()` (Junos CoS STORAGE FC queue-5 no-loss, DSCP-48 classifier, `congestion-notification-profile … pfc`) gated on `storage && !needsRoce` (RoCE block already defines a STORAGE class — avoids double-definition); Nokia leaf adds a `qos` PFC priority-6 block. 3 new tests | [x] | configgen.ts: `juniperStorageBlock` + `appTypes` on the 2 leaves + dispatch; configgen.test.ts 109→112 |

### R. Enterprise ZTP — any-vendor identify-and-provision (sourced 2026-06-29)

> User-requested: make ZTP work as a standard enterprise tool — work for ANY
> vendor, identify which hardware + device role, and push the right config.
> Audit found the backend ZTP covered only 4 platforms (nxos/ios-xe/eos/junos),
> had **hardcoded credentials** (`ChangeMe!`/`NetDesignZTP1!`) and hardcoded
> NTP/syslog IPs in the Day-0 templates, no DHCP option-60 vendor classification,
> and no device identification (vendor/model/role) — it required manual
> pre-registration. The frontend ZTP sim was fully vendor-agnostic (name+role).

| # | Item | Status | Notes |
|---|------|--------|-------|
| R1 | ZTP engine (`lib/ztp.ts`) — vendor identification + per-vendor mechanism + Day-0 + provisioning plan. `ZTP_VENDOR_PROFILES` (11 platforms: nxos/ios-xe/iosxr/eos/junos/srl/cumulus/dellos10/fortios/arubaoscx/exos/panos) each with ZTP method (POAP/PnP/ZTP/eZTP/FortiZTP/Aruba-ZTP/ZTP+/Panorama-ZTP), DHCP option-60 vendor-class, boot protocol, redirect mechanism. `ztpPlatform(dev)` (Cisco model-aware: Nexus→nxos POAP, Catalyst/ISR→ios-xe PnP, ASR9k/NCS→iosxr ZTP), `ztpRole`, `identifyDevice`. `generateDay0Config` — vendor-correct **management-plane-only** bootstrap for all 12 platforms (mgmt IP/SSH/NTP/syslog/callback, `<CHANGE-ME-*>` secrets — fixes the backend hardcoded-credential bug; NO production config per §11). `generateDhcpConfig` — ISC dhcpd.conf with one option-60 class per vendor (true multi-vendor auto-classification) + IOS-XE option-43 PnP redirect. `buildZTPPlan(devices, configs)` — identifies every device, generates Day-0, and pairs it with its Day-N production config by BOM id ("push the right config"); summary byVendor/byMethod/byRole. `ztpPlanToCsv`. 39 tests in `test/ztp.test.ts` | [x] | new `lib/ztp.ts` + `test/ztp.test.ts` (39) |
| R2 | Wire the ZTP engine into the Step 6 ZTP tab — "🏭 Enterprise ZTP Plan" card: per-device identification table (hostname/vendor/model/role/platform/ZTP-method/DHCP opt-60/Day-N-ready), method+role summary chips, expandable per-device Day-0 viewer + download, and downloads for the multi-vendor option-60 DHCP config and the provisioning-manifest CSV. Computed via `buildZTPPlan(storeDevices, storeConfigs)` | [x] | `Step6Deploy.tsx` (`ztpPlan` memo + card); tsc + build green; 1045 tests |
| R3 (backend) | Backend ZTP security + multi-vendor DHCP — **critical fix**: the 4 day0.j2 templates baked literal passwords (`ChangeMe!`/`NetDesignZTP1!`) and hardcoded NTP/syslog IPs (10.100.0.1/100). Parameterized via the `_render_day0` ctx (`admin_password`/`netdesign_password`/`ntp_server`/`syslog_server` default to `<CHANGE-ME-*>`, overridable through `dev.extra`); all 4 templates updated. `dhcp_gen.py`: `_VENDOR_CLASS` (option-60 per platform) + per-class blocks in `generate_dhcp_config` (mixed-vendor auto-classification; IOS-XE option-43 only in HTTP mode); `_TFTP_MAP` extended to iosxr/junos/srl/cumulus/dellos10. New `test_ztp_day0_secrets.py` (16) asserts no hardcoded creds + placeholders + `extra` override; 65 backend ZTP tests pass | [x] | `backend/ztp/server.py`, `templates/{nxos,eos,ios_xe,junos}/day0.j2`, `dhcp_gen.py`; backend pytest 65 |
| R4 (backend) | Backend Day-0 templates for the 8 remaining platforms — added `templates/{iosxr,srl,cumulus,dellos10,fortios,arubaoscx,exos,panos}/day0.j2` (management-plane-only, parameterized `<CHANGE-ME-*>` secrets + ntp/syslog, mirrors the tested frontend `generateDay0Config`). Backend ZTP now renders a correct Day-0 for **all 12 platforms** (was 4). `test_ztp_day0_secrets.py` extended to all 12 (no hardcoded creds / admin placeholder / ntp+syslog parameterized / hostname+mgmt+ssh render); 113 backend ZTP tests pass | [x] | `backend/ztp/templates/<8 platforms>/day0.j2`; `test_ztp_day0_secrets.py` (16→64 cases); backend pytest 113 |

---

### S. Day-N incremental config change tool (sourced 2026-06-29)

> User-requested: after ZTP builds a device, a tool to push **subsequent**
> targeted config changes to already-live devices (a BGP policy, a firewall
> policy, an ACL, a VLAN, a static route …). Audit confirmed this "incremental
> policy push" was the one **missing** Day-2 capability — `policies.ts` renders
> full-config placeholder snippets (no rollback, not parameterized), and
> drift remediation is reactive-only. The new tool is proactive, parameterized,
> per-vendor, and reversible.

| # | Item | Status | Notes |
|---|------|--------|-------|
| S1 | Day-N change engine (`lib/config-update.ts`) — `CHANGE_CATALOG` of parameterized change ops (bgp-neighbor, bgp-route-policy[prefix-list+route-map], firewall-rule[ACL/zone], vlan, static-route), each with per-CLI-family forward + **rollback** generation. `cliFamily(vendor)` (ios/junos/nokia/fortios/panos). `buildChangeSet(op, params, devices)` scopes to selected live devices, marks each supported by role+family, summary byFamily; `changeSetToScript`/`changeSetRollbackScript` push + rollback runbooks; `validateChangeParams`. firewall-rule covers ios/junos ACL + **fortios/panos NGFW** policy. 19 tests in `test/config-update.test.ts` | [x] | new `lib/config-update.ts` + `test/config-update.test.ts` (19) |
| S2 | Wire into Day-2 Ops tab — "🔧 Push Incremental Change (Day-N)" card: change-type picker + dynamic param form, multi-select target devices (from BOM, select-all/clear), "Generate change + rollback" → side-by-side delta vs rollback panes, download push script + rollback runbook, per-device supported count + required-field validation | [x] | `Step6Deploy.tsx` (change-op state + card); tsc + build green; 1064 tests |
| S3 | Expand `CHANGE_CATALOG` with the two highest-frequency Day-2 changes not yet covered — **mgmt-server** (add an NTP/syslog/SNMP host; ios `ntp server`/`logging host`/`snmp-server host`, junos `set system ...`, nokia `set / system ...`, each with no/delete rollback) and **interface-config** (description + admin up/down + optional access VLAN; ios `interface … / no shutdown / switchport access vlan`, junos `set interfaces … disable`/members — rollback inverts what was set). UI picks them up automatically from the catalog. 5 new tests | [x] | `config-update.ts` (`mgmtServer`/`interfaceConfig`); `config-update.test.ts` 19→24; 1069 tests |
| S4 | Pre-flight safety analysis for the Day-N change — `analyzeChangeSet(cs)` returns `ChangeWarning[]` (info/warn/danger) before the operator pushes: skipped (unsupported) devices, unfilled `<CHANGE-ME>` placeholders in the generated commands, **irreversible** changes (supported device with no rollback), and two genuinely-risky patterns — admin-down on a fabric (spine/leaf/core) interface, and a broad `deny any → any` firewall rule. Surfaced as a severity-colored warning banner in the Day-2 Ops change card before the delta/rollback preview. 5 new tests | [x] | `config-update.ts` (`analyzeChangeSet`/`ChangeWarning`) + `Step6Deploy.tsx` banner; `config-update.test.ts` 24→29; 1074 tests, build green |
| S5 (backend) | Backend parity for the Day-N change tool — `backend/change_update.py` mirrors the frontend engine (same 7 ops × ios/junos/nokia/fortios/panos forward+rollback, `build_change_set`, `analyze_change_set`, `validate_change_params`, `CHANGE_CATALOG`); new `GET /api/change/catalog` + `POST /api/change/preview` (generation only, like /api/drift/remediate — returns per-device delta+rollback + pre-flight warnings + summary). 16 pytest in `test_change_update.py` | [x] | `backend/change_update.py` + `main.py` endpoints; backend pytest 16 (108 with ztp suites) |

### T. Monitoring engine — computed alerting + fleet health (sourced 2026-06-29)

> A full audit of the monitoring engine found it "feature-rich but data-
> limited": the demo Monitoring tab sampled per-device metrics each tick but
> only drew gauges — it never *analyzed* them into alerts/health. Real
> alerting only existed in live mode (`/api/alerts`, telemetry-gated) or as
> hardcoded lab alerts. Top quick win: client-side threshold alerting + health
> that works in demo mode (the app's emphasis), with tunable thresholds.

| # | Item | Status | Notes |
|---|------|--------|-------|
| T1 | Monitoring analysis/alerting engine (`lib/monitoring.ts`) — turns a `MetricsSummary` into a NOC view: `METRIC_THRESHOLDS` (cpu/mem/iface-errors/pfc, warn+critical, tunable), `evaluateDevice(name, role, m, thresholds?)` → per-device health (healthy/degraded/down) + severity-ranked `MonAlert[]` (routing device with 0 BGP sessions → down/control-plane-isolated; cpu≥99 → down), `evaluateFleet(summary, {roles, thresholds})` → fleet rollup + sorted alert list, `alertsToText` NOC feed export. Pure + 12 tests | [x] | new `lib/monitoring.ts` + `test/monitoring.test.ts` (12) |
| T2 | Wire into the Monitoring tab — "🔔 Active Alerts & Fleet Health" card computes `evaluateFleet(metrics, {roles})` from the live/demo metrics each tick: health chips (healthy/degraded/down + critical/warning counts), severity-colored alert feed (sorted critical-first), and an "Export alert feed" download. Works in demo mode (previously alert-less) | [x] | `Step6Deploy.tsx` monitor tab; tsc + build green; 1086 tests |
| T3 | Capacity trending / forecast — `forecastMetric(history, limit)` in `lib/monitoring.ts` does a least-squares linear regression over a metric's per-tick history → `{slope, trend: rising/falling/flat, etaTicks}` (ticks-to-limit when rising). Monitor tab accumulates per-device CPU history (`cpuHistRef`, last 12 ticks) and shows an "↗ CPU ~Nt to 90%" capacity-trend badge on device cards trending toward critical. Addresses the audit's "no capacity trending" gap. 4 new tests | [x] | `lib/monitoring.ts` `forecastMetric` + `Step6Deploy.tsx` badge; `monitoring.test.ts` 12→16; 1090 tests |
| T4 | Alert correlation / grouping — `correlateAlerts(fleet)` collapses the flat alert list into `CorrelatedEvent[]` with a root-cause hint, addressing the audit's "no root-cause detection / no causality" gap: (1) **fleet-wide** — the same metric breached on ≥3 devices → one event (e.g. "Fleet-wide: BGP sessions down on 6 devices" → hint "check route-reflectors/spines or shared underlay"); (2) **device-level** — a device with ≥2 issues → one event (CPU+mem → "resource exhaustion"; bgp among them → "control plane down"); (3) **single** passthrough. Sorted critical-first then fleet→device→single. Monitor tab "🔔 Active Alerts" card gets a **◉ Correlate** toggle (default on) showing grouped events + "N events from M alerts" + scope chips + hints. 5 new tests | [x] | `lib/monitoring.ts` `correlateAlerts`/`CorrelatedEvent` + `Step6Deploy.tsx` toggle; `monitoring.test.ts` 16→21; 1095 tests |

---

## 23. Autonomous "Start Improving" Mode (2026-06-11 →)

### Purpose

This section turns CLAUDE.md into a **self-driving work order**. The
standing goal: make NetDesign AI the best intent-driven network design +
automation platform — covering and exceeding what NetBox (DCIM/IPAM),
Nautobot, Itential, and Forward Networks do individually, combined into one
browser-native tool. The user should be able to open a fresh session, type a
short trigger phrase, and have Claude pick up the next highest-value backlog
item, implement it end-to-end, and leave the repo in a working, committed
state — with zero per-session re-explanation.

### Trigger phrases

If the user's message is (or clearly amounts to) one of: `start improving` ·
`keep improving` · `continue improving` · `work on the backlog` ·
`resume autonomous work` · `next item` · `do the next thing` — treat it as
**"run the loop below without asking clarifying questions"**. Do not ask the
user which item to do — pick it yourself per the priority order below.

### The loop

1. **Orient** — read this file (`CLAUDE.md`) and `CODE_REFERENCE.md`. Create
   a short-lived feature branch from latest `main` (e.g.
   `claude/<topic-slug>`). Set git identity:
   `git config user.email noreply@anthropic.com && git config user.name Claude`.
2. **Pick the next item**, in this priority order:
   - Section 22 (Enterprise Upgrade Tracker), table A → B → C → D, top to
     bottom: the first row with status `[ ]`.
   - If §22 has only `[x]`/stretch items left: Section 20 (Known Gaps),
     lowest-numbered open `P1` gap, then `P2`.
   - If both are exhausted: see "Sourcing new work" below.
   - Before starting, mark the chosen row `[~]` (in-progress) so a parallel
     session doesn't duplicate it; if you find a row already `[~]`, check
     `git log`/branches — if it looks stale/abandoned, take it over.
3. **Implement** the item completely — code + tests. Follow all existing
   rules in this file: §6 config-gen rules, §7 constraints, §8 BOM formulas,
   §21 implementation rules (TanStack Query for server state, new types in
   `types/index.ts`, `<CHANGE-ME-*>` secrets only, no new UI/graph libraries,
   `activeDeployTab` deep-linking, etc.).
4. **Verify**:
   - Any change under `frontend/src/lib/configgen.ts` (or other `lib/`
     files with existing test coverage) → `cd frontend && npm test` — all
     tests must pass; add new tests for new behavior.
   - Any non-trivial `frontend/` change → `npx tsc --noEmit -p
     tsconfig.app.json` (and `npm run build` if it touches build config or
     many files).
   - Any `backend/` change → run the relevant suite under `backend/tests/`
     with `pytest` if present.
5. **Update `CODE_REFERENCE.md`** if you added/renamed/removed exported
   functions, types, files, or major UI sections — keep it accurate; it
   exists specifically so future sessions don't have to re-read source.
6. **Commit + push**: conventional commit (`feat:`/`fix:`/`docs:`/`test:`)
   referencing the item ID, e.g. `feat: A4 — Arista gNMI/eAPI telemetry
   block`. Push the feature branch
   (`git push -u origin claude/<topic-slug>`).
7. **Flip the tracker row** to `[x] (commitHash)` — can be the same commit as
   step 6 or a small follow-up `docs:` commit.
8. **Merge to `main` + delete the feature branch**: open a PR to `main` and
   squash-merge it once the item is complete and green (tests + tsc + build).
   After merge, delete the remote branch (`git push origin --delete <branch>`).
   Finished work must not be left stranded on a feature branch —
   `main` is what gets deployed to netdesignai.com.
9. **Continue or stop**:
   - If there's clearly enough context budget left, loop back to step 2 for
     the next item.
   - If context is getting tight, or you hit a decision that needs the
     user's input (architecture choice, new dependency, pricing/billing, or
     anything touching `licensing/`), STOP and leave a short status note:
     what finished (with commit hashes), what's next, and any blocking
     question. Never leave a tracker row stuck at `[~]` — finish it (`[x]`)
     or revert it to `[ ]` before stopping.

### Sourcing new work (when §20 + §22 are exhausted)

Re-derive the backlog from first principles, in priority order:
1. **Dead code / consistency cleanup** flagged in `CODE_REFERENCE.md` (e.g.
   components/pages marked "LEGACY/UNUSED") — wire them up properly or
   remove them.
2. **NetBox/Nautobot parity gaps**: full DCIM (racks/power/cable plant beyond
   G-A14), IPAM beyond `lib/bom.ts`'s IP planning, source-of-truth sync
   (extends B1–B3), webhook/event-driven automation.
3. **Closed-loop automation**: drift detection → auto-remediation (extends
   G-A4/G-A16/C1–C3), scheduled compliance scans, auto-rollback on
   post-check regression.
4. **AI differentiation**: intent NLP (G-A1/G-A15), richer RCA, predictive
   capacity planning from `useMonitoring()` history.

Append new items to §22 (new letter group or extend an existing one) or §20
(`G-A17`, `G-A18`, ...) with status `[ ]` *before* implementing them, so the
tracker stays the single source of truth.

### Guardrails (apply always, including in autonomous mode)

- **Merge finished work to `main` and delete the branch** (see §0 Branch &
  merge policy): develop on a feature branch, PR to `main`, squash-merge,
  then delete the remote branch. No long-lived feature branches — `main`
  is the single source of truth.
- **Git identity**: always set `user.email=noreply@anthropic.com` and
  `user.name=Claude` before committing (session-start hook does this
  automatically in remote sessions). Commits with other emails show as
  "Unverified" on GitHub and break Vercel deployments.
- Never modify `licensing/` pricing/entitlement logic, billing, or auth
  secrets without stopping to ask first.
- Never use `--no-verify`, force-push, or `git reset --hard`.
- If a chosen item turns out much larger than its tracker description
  implies, implement a focused first slice, commit it, re-scope the rest
  into new sub-rows (status `[ ]`), and stop for user review.

---

*Last updated: 2026-05-29. Step 6 enterprise-grade overhaul complete.*
*HLD topology diagram complete (G-A2 ✅). Sidebar deep-nav complete. ZTP/Checks demo simulation complete. NETCONF interactive complete. Config Automation (Ansible Tower + Terraform + Manual) complete. Policy Gate complete.*
*Mark resolved gaps with ✅ and date. Add new gaps as G-A17, G-A18, etc.*
*Section 22 (Enterprise Upgrade Tracker) added 2026-06-11 — see it for current in-flight work.*
*Section 23 (Autonomous "Start Improving" Mode) added 2026-06-11 — say "start improving" in any new session to resume the backlog without re-prompting.*
