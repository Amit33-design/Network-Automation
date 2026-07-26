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
>
> 📚 **Technical guide**: [`docs/TECHNICAL_GUIDE.md`](./docs/TECHNICAL_GUIDE.md)
> — current architecture, engine map, frontend/backend parity pattern,
> testing strategy, gotchas/tribal knowledge (§7 there), and extension
> recipes. [`AGENTS.md`](./AGENTS.md) is the condensed operating manual
> for any coding agent (reading order, commands, hard rules).

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
| C4 | Unify the HLD health overlay onto the shared monitoring engine (T-series) — `simulateNodeHealth()` had its own duplicated health thresholds/alert-text (cpu>85→down, cpu>65→degraded…), drifting from `lib/monitoring.ts`. It now builds a `DeviceMetrics` from its deterministic generation and delegates status+alerts to `evaluateDevice(...)`, so the design-time overlay and the Step 6 Monitoring tab agree on health semantics. Added an `expectsBgp` param to `evaluateDevice` (overrides the name/role routing heuristic — an `edge-fw` name would otherwise false-match the "edge" hint); the overlay passes `HEALTH_BGP_LAYERS.has(layer)` explicitly. 2 new tests | [x] | `HLDTopologyDiagram.tsx` `simulateNodeHealth` + `lib/monitoring.ts` `evaluateDevice(expectsBgp?)`; `monitoring.test.ts` (+2); 1111 tests |

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
| F2 | DCIM cable-plant export — devices + IPAM synced to NetBox but the physical layer (interfaces + cables) did not. New `lib/netbox-dcim.ts`: `expandCablePlan(devices, cabling)` (pure mirror of `RackElevation.buildCableSchedule` — expands the aggregate `CableLink` plan into concrete leaf×spine runs with UNIQUE sequential per-device interface names `Ethernet1/N`), `toNetBoxDeviceCsv`/`toNetBoxInterfaceCsv`/`toNetBoxCableCsv` (NetBox 4.x `dcim.device`/`dcim.interface`/`dcim.cable` headers, `side_a/side_b` interface endpoints), `netboxInterfaceType(speed)` (400G→qsfpdd, 100G→qsfp28, 25G→sfp28…) + `netboxCableType(cableType)` (DAC→dac-passive, AOC, SMF/MMF, Cat6) enum mappers, `buildNetBoxDcimExport`. 3 export buttons in Step 4 "IP Plan" tab; 9 tests in `test/netbox-dcim.test.ts` | [x] | `lib/netbox-dcim.ts` + `Step4NetworkDesign.tsx`; 1134 tests, tsc + build green |
| F3 | DCIM rack + device-position export — completes the physical-layer story: F2 exported devices/interfaces/cables but not racks or device placement. `lib/netbox-dcim.ts` gains `RackExport`/`RackExportSlot` structural types (assignable from `RackElevation.computeRackLayout` output without importing a component), `netboxRackPosition(slot, totalU)` (converts the top-counted 1-based `startU` to NetBox's bottom-counted lowest-occupied-U `position`), `toNetBoxRackCsv` (`dcim.rack`: `name,site,status,u_height`), and `toNetBoxDeviceCsv`/`buildNetBoxDcimExport` gain an optional `racks` param — device CSV adds `rack,position,face` columns (empty for unplaced devices; original header unchanged without racks). "↓ Racks CSV" button + rack count in the Step 4 IP Plan DCIM card; 5 new tests | [x] | `lib/netbox-dcim.ts` + `Step4NetworkDesign.tsx`; `netbox-dcim.test.ts` 9→14; 1148 tests, tsc + build green |

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
| H6 | Capacity planning bandwidth/oversubscription dimension — H3 modeled *port count only*, so a fabric could show "OK" while its effective oversubscription drifted far past the design target (offered load grows with endpoints; uplink capacity is fixed). `computeCapacityPlan` gains a 5th `CapacityOpts` param (`{bandwidthPerServer: '25G'\|number, oversubTarget}` — backward compatible): per-year `offeredGbps` (endpoints × bw), `effectiveOversub` (offered ÷ totalLeafUplinks × spine fabric speed), `oversubStatus` ok/warn(>target)/critical(>1.5×target), plan-level `hasBandwidthModel`/`oversubTarget`/`oversubExceededYear`/`uplinkCapacityGbps` + drift recommendations; new exported `parseSpeedGbps()` ('400G'→400, '1T'→1000). Step 4 Capacity card passes store `bandwidthPerServer`+`oversubscription` and shows "Offered Load" + "Oversub (target N:1)" columns (color-coded) when active; 9 new tests | [x] | `lib/capacity-planning.ts` + `Step4NetworkDesign.tsx`; `capacity-planning.test.ts` 15→24; 1143 tests, tsc + build green |

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
| I4 | Wire the enterprise ZTP plan (R-series) into the e2e harness — `assertZTPPlanInvariants` runs `buildZTPPlan(devices, configs)` in the universal matrix + vendor matrix (all ~190 scenarios) and asserts: one plan entry per BOM device; every device fully identified (platform/method/DHCP vendor-class/boot file); Day-0 is a real mgmt-plane bootstrap (contains hostname, no `ChangeMe!`/`NetDesignZTP1!`, no `router bgp` production leak); **Day-N pairing matches reality** (`hasDayN` ⇔ a config exists for that BOM id; `withDayN` summary agrees); and `generateDhcpConfig` emits an option-60 class for every vendor present. All 193 scenarios pass — locks in R1–R4 across every use case × scale × vendor | [x] | `test/e2e-journey.test.ts` `assertZTPPlanInvariants`; 1109 tests |
| I5 | Wire the DCIM export (F2/F3) + capacity plan (H6) into the e2e harness — `assertDcimExportInvariants` (universal + vendor matrices): every BOM device in the device CSV, cable-CSV rows = expanded plan count, every cable endpoint's interface exists in the interface CSV, rack positions in-bounds + no U double-booking (via `netboxRackPosition`), device rows reference only real racks. `assertCapacityPlanInvariants` (universal + speed×oversub matrices): year-0 endpoints mirror the design input, growth monotonic, bandwidth model engages on every fabric, and **capacity-view agreement** — when year-0 effective oversub exceeds the design target (leaf SKU uplink limit), `validateBOM` MUST have raised the `oversubscription` warning (a silent breach = the H6 plan and H4 validator drifted apart; the first strict draft of this invariant flagged 28 such known-degradation scenarios, all correctly warned). All 193 scenarios pass | [x] | `test/e2e-journey.test.ts` `assertDcimExportInvariants`/`assertCapacityPlanInvariants`; 1148 tests |

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
| T5 | SLA / availability tracking — addresses the audit's "no SLA/uptime tracking" gap. `recordAvailability(acc, fleet)` folds each per-tick fleet evaluation into a per-device up/total accumulator (up = healthy or degraded; only `down` subtracts); `availabilityReport(acc)` → per-device availability % (worst-first) + fleet mean + sample count. Monitor tab accumulates into `availRef` once per metrics sample and shows a color-coded **"SLA {fleetPct}%"** chip (green ≥99.9 / yellow ≥99 / red below) with a worst-device tooltip. 3 new tests | [x] | `lib/monitoring.ts` `recordAvailability`/`availabilityReport` + `Step6Deploy.tsx` SLA chip; `monitoring.test.ts` 21→24; 1098 tests |
| T6 | Alert history + acknowledge (session-scoped) — addresses the audit's top quick win ("no alert history / no ack"). `updateAlertHistory(prev, alerts, nowIso)` is a pure reducer tracking each alert's lifecycle keyed by device\|metric (firstSeen→lastSeen, `count`, `clearedAt` when it stops firing, re-fire resets lifecycle); `ackAlert(history, key)` marks acknowledged; `alertHistoryList` sorts active-first then severity/recency. Monitor tab folds history in the per-sample effect (`alertHistRef`) and adds a collapsible **"Alert history (session)"** with ACTIVE/cleared status, observe count, and per-alert **ack** buttons (+ unacked count). 5 new tests | [x] | `lib/monitoring.ts` `updateAlertHistory`/`ackAlert`/`alertHistoryList` + `Step6Deploy.tsx` history section; `monitoring.test.ts` 24→29; 1103 tests |
| T7 | Per-interface drill-down — the device model only carried AGGREGATE interface errors, so the NOC couldn't see WHICH port was the problem (audit gap "no per-interface drill-down"). `simulateInterfaces(device, role, tick, aggHint, portCount=8)` deterministically models each device's ports (role-aware naming/speed: access `Gi1/0/N`@1G, leaf `Eth1/N`@100G, spine@400G; sticky ~8-tick oper-down; utilization split from device throughput) and **pins the device's aggregate error counters onto one stable culprit port** so the drill-down agrees with the card. `analyzeInterfaces(ifaces)` → per-port issues (DOWN critical, CRC 50/200 warn/crit, util 85/95 capacity/congested, discards, generic errors) + up/down summary, critical-first. Device cards get a "▸ ports" toggle → compact per-port table (In%/Out%/Errs/CRC/Status, row-colored) + top-3 issue lines. 6 new tests | [x] | `lib/monitoring.ts` `simulateInterfaces`/`analyzeInterfaces` + `Step6Deploy.tsx` drill-down; `monitoring.test.ts` 29→35; 1109 tests |

---

### U. RCA engine — demo-mode parity + rich output + un-shadow (sourced 2026-07-05)

> Audit found the RCA feature had two coupled defects. (1) **Route
> shadowing**: `backend/routers/lab.py` registers a static 3-hypothesis stub
> at `/api/rca/analyze` *before* the real correlation engine (`backend/rca/
> engine.py`, `@app.post` at `main.py:1083`) — Starlette matches in
> registration order, so the stub wins and the real `RCAEngine` (blast-radius,
> multi-step remediation, automation playbooks) is dead code. (2) **No demo
> mode**: unlike every other Step 6 feature (§3 — the app is fully functional
> without a backend), `RcaPanel` short-circuited to "configure a backend URL"
> when `!isLive`, and the frontend `RcaHypothesis` type only modeled the
> stub's flat `{rank,cause,remediation}` shape — the engine's rich output was
> discarded even in live mode.

| # | Item | Status | Notes |
|---|------|--------|-------|
| U1 | Client-side RCA engine + rich output — new `lib/rca.ts` (`analyzeRca(input)` mirroring the backend's 5 hypothesis checkers: BGP session loss, PFC/RDMA deadlock, EVPN/VXLAN overlay, underlay/IGP, recent-change; keyword + design-state driven, deterministic blast-radius from role adjacency, dedup+rank, generic fallback) + `normalizeRcaResponse()` mapping BOTH the real engine (snake_case) and the legacy stub shape → the canonical rich `RcaHypothesis`. Rich `RcaHypothesis` type (`rootCause/confidence/evidence/blastRadius/remediationSteps/automationAvailable/automationPlaybook`); `client.runRca` normalizes; `useRunRca` falls back to `analyzeRca` in demo mode; `RcaPanel` renders blast-radius chips + remediation steps + automation playbook affordance and works in demo mode. Tests in `test/rca.test.ts` | [x] | `lib/rca.ts` + `types/index.ts` + `api/client.ts` + `hooks/useRca.ts` + `components/RcaPanel.tsx`; `test/rca.test.ts` (14); 1125 tests, tsc + build green |
| U2 | Un-shadow the real engine — rename the `lab.py` stub route to `/api/lab/rca` so `/api/rca/analyze` resolves to the real `RCAEngine` (`main.py:1083`); backend suite stays green | [x] | `backend/routers/lab.py` (`@router.post("/api/lab/rca")`); backend lab/rca pytest 21 pass (pre-existing unrelated `test_config_gen.py` failures untouched) |

---

### V. Backend config-gen repair — green suite (sourced 2026-07-06)

> The backend pytest suite had 21 standing failures on `main`, masking real
> regressions. 8 were environment (`cryptography` missing `_cffi_backend` in
> the web container → all JWT/auth tests panic). 13 were `test_config_gen.py`
> drift — and investigating exposed a REAL production bug: `_build_device_
> context` stopped supplying variables the Jinja2 templates reference
> (StrictUndefined), so `/api/generate-configs` returned "! CONFIG GENERATION
> ERROR" comments instead of configs for NX-OS leaf, IOS-XE access, and
> IOS-XE distribution.

| # | Item | Status | Notes |
|---|------|--------|-------|
| V1 | Repair the backend config-gen context + tests → whole suite green — `_build_device_context` now supplies `spine_ips` (IP-plan spine loopbacks by role, else the `10.0.i.i` scheme — leaf RR sessions point at the loopbacks spines actually get), `voice_vlan` (from VLAN list by name), `dot1x_enabled` (security list), `dai_enabled`/`dhcp_snooping` (campus default), `mgmt_mask`, plus the documented contract flags `bgp_evpn`, `vxlan_vni_base`, `pfc_queues`, and `roce_enabled` now true for GPU use cases per §6.5 (qos_policy already OR'd `uc=="gpu"`). Tests updated where behavior intentionally changed (hostname `DC-SPINE-01` w/o org prefix; empty `selectedProducts` → default-sizing fallback; dash not underscore in hostname filters). Session-start hook installs `cffi` to fix the auth-test env panic. Backend suite 321 passed/21 failed → **342 passed/0 failed**. Follow-up noted: `ios_xe/firewall.j2` doesn't exist → `fw` devices get a stub comment | [x] | `backend/config_gen.py` + `backend/tests/test_config_gen.py` (27 pass) + `.claude/hooks/session-start.sh` |
| V2 | Perimeter firewall base template + hardcoded-credential purge — (1) new `templates/ios_xe/firewall.j2` (V1's follow-up): base FW device config (hostname/domain/AAA/SSH, OOB MGMT VRF, loopback, OUTSIDE/INSIDE/DMZ data-plane interfaces w/ `<CHANGE-ME-*>` addressing, default route, logging/NTP, VTY ACL) — zones/zone-pairs/NAT stay in the policy generator; (2) `include_firewall_policy` now defaults ON for `layer == "fw"` (a dedicated fw without its policy was just a router — FW devices now get the full ZBF appended, 1.5k-line config); (3) **credential purge**: 19 hardcoded `ChangeMe!`/`$6$ChangeMe` literals across 7 device templates (ios_xe access/core/distribution/wan_router admin secrets, BGP password, IPsec PSKs, SNMPv3 keys; junos root hashes, IS-IS auth, SNMPv3) + 17 `*-CHANGEME` non-canonical placeholders in `policies/security_hardening.py`/`control_plane.py` → all normalized to canonical `<CHANGE-ME-*>` per §6.3. 4 new tests incl. a rendered-config no-hardcoded-credentials sweep across dc/campus/gpu | [x] | `templates/ios_xe/firewall.j2` (new) + 7 templates + 2 policies + `config_gen.py`; backend pytest 342→346 |

---

### W. Design diff / change review (sourced 2026-07-07)

> §23 sourcing priority 4 (richer change review). H1 serializes a full design
> (`DesignExport`: intent + requirements + BOM + configs) and imports it, but
> there is no way to **compare two designs** — e.g. a saved baseline vs. the
> current working design — before re-deploying. Enterprise change review needs
> a field-level diff (what intent/requirements changed), a BOM delta
> (added/removed/changed devices, cost delta), and a per-device config diff
> (unified hunks) so an operator can see exactly what a redeploy will change.

| # | Item | Status | Notes |
|---|------|--------|-------|
| W1 | Design diff engine — new `lib/design-diff.ts` (`diffDesigns(a, b)` over two `DesignExport`s → `{intentChanges, requirementChanges, bomDelta, configDelta, summary}`): field-level intent/requirements changes (added/removed/changed w/ before→after), BOM delta by device id (added/removed/changed + capex delta), per-device **LCS-based unified config diff** (added/removed/modified files w/ line-level hunks, long unchanged runs elided w/ context), `diffToMarkdown` report. Wired into Step 4 Summary tab "Compare Designs (Change Review)" card (upload a baseline JSON → summary chips + intent/requirement tables + BOM delta + colored config hunks + download .md report). Pure + 10 tests | [x] | `lib/design-diff.ts` + `test/design-diff.test.ts` (10) + `Step4NetworkDesign.tsx`; 1158 tests, tsc + build green |

---

### X. Production-grade config hardening (sourced 2026-07-10)

> User directive: "keep improving until it produces production-grade BOM,
> network design and config." A pre-deployment audit — generated real DC
> (Cisco/Arista/Juniper), GPU and campus designs and had senior network
> architects review them — found the configs **NOT deployable as generated**.
> This group tracks each finding to closure. Method: `frontend/src/test/_dump`
> harness (temporary) dumps BOM+configs for realistic scenarios; review each
> vendor's output against real syntax; fix generator + add regression tests.
>
> **Audit findings (severity from the review):**
> - **CRIT** NX-OS/Arista/Juniper overlay BGP has ZERO real neighbors — every
>   peer line was a commented `<CHANGE-ME-spineN-loopback>` stub → fabric dead.
> - **CRIT** ASN model incoherent — spine iBGP-RR (`route-reflector-client`,
>   same-AS) but leaves use unique ASNs (eBGP) → OPEN mismatch, no session.
> - **CRIT** NX-OS IOS-isms: `aaa new-model`, `username … privilege 15`,
>   tacacs without `feature tacacs+` → NX-OS parser rejects.
> - **CRIT** Arista leaf IS-IS NET malformed (14 hex digits); Juniper has no
>   `family iso`/NET at all → underlay never starts.
> - **CRIT** Juniper eBGP-over-loopback missing `local-address lo0.0` +
>   `multihop`; leaf jumbo MTU on the wrong interfaces; no `vlans`/VNI map.
> - **MAJOR** NX-OS leaf had no anycast-gateway SVI (no default gateway);
>   Arista VLAN 10 referenced but never created + no shared MLAG VTEP;
>   vPC/MLAG peer-links commented out (never initialize).
> - **MAJOR** firewall device mislabeled (Firepower 4145 emitting IOS-XE ZBF).
> - **VALIDATOR BUG** V-10 misparsed `access-group name <ACL>` → false
>   "undefined ACL named 'name'". BOM: optics list omits host-facing DACs and
>   firewall-uplink optics; GPU spine count balloons (40 spines for 512 GPUs).

| # | Item | Status | Notes |
|---|------|--------|-------|
| X1 | NX-OS control plane made deployable — (1) **real eBGP EVPN neighbors**: `nxosSpineConfig` emits one `neighbor <leaf-lo0>\n inherit peer LEAF-PEER\n remote-as <leaf-asn>` per leaf derived from `allDevices` (leaf lo0 `10.255.2.(i+1)`, ASN `65001+i`); `nxosLeafConfig` emits one `neighbor <spine-lo0>\n inherit peer SPINE-PEER` per spine (`10.255.1.(i+1)`, template `remote-as 65000`) — no more commented `<CHANGE-ME-spine*>` stubs; (2) **coherent eBGP**: dropped `route-reflector-client` (iBGP-only) from the spine, kept `retain route-target all`; (3) **IOS-ism purge**: removed `aaa new-model`, `username admin privilege 15 … password 5` → `username admin password <CHANGE-ME> role network-admin`, added `feature tacacs+`; (4) **anycast gateway**: leaf now emits `fabric forwarding anycast-gateway-mac` + `interface Vlan10` (anycast-gateway, `<CHANGE-ME-tenant-anycast-gw>`) + L3VNI `Vlan900 ip forward`. 6 new configgen tests (fabric wiring, AAA, anycast); rewrote 2 tests that had asserted the `aaa new-model` bug | [x] | `configgen.ts` `nxosSpineConfig`/`nxosLeafConfig`; `configgen.test.ts` (110→116) |
| X2 | Validator V-10 access-group parse fix — `checkAcl` misparsed `match access-group name <ACL>` (captured the literal `name`) → false "undefined ACL" warn on every firewall; now skips the optional `name` keyword + trailing `in`/`out` direction, and recognizes NX-OS `ip access-list NAME` (no standard/extended) as a definition. 3 new tests | [x] | `config-validator.ts`; `config-validator.test.ts` (40→43) |
| X3 | Arista EOS fabric deployability — (1) **real eBGP neighbors** from `allDevices`: spine emits flat EOS `neighbor <leaf-lo0> peer group LEAF-PEER` + `remote-as <leaf-asn>` per leaf; leaf emits `neighbor <spine-lo0> peer group SPINE-PEER` per spine (no more `<CHANGE-ME-spine*>` stubs); (2) dropped `route-reflector-client` + the invalid indented `peer-group NAME` block → flat EOS `neighbor NAME peer group` form; (3) **fixed malformed IS-IS NET** — `0101.0255.000${idx+101}` overflowed to 13/14 hex digits (EOS rejected it → underlay dead); now `padStart(4)` 12-hex system-id on spine + leaf; (4) created the referenced global `vlan 10 name SERVERS` (Vxlan1 mapped it but it was never defined). 3 new tests. Remaining (shared MLAG VTEP `ip address virtual`, MLAG peer-link members) rolled into X5 | [x] | `configgen.ts` `aristaSpineConfig`/`aristaLeafConfig`; `configgen.test.ts` (116→119) |
| X4 | Juniper JunOS fabric deployability — (1) **`family iso` NET** on lo0 (`49.0001.<12hex>.00`) + on every IS-IS transit unit (et-0/0/0-1 spine, et-0/0/48-49 leaf) — IS-IS was completely dead without it; (2) eBGP-over-loopback now has `local-address lo0.0` + `multihop ttl 3` on both groups (sessions couldn't establish without them); (3) **real neighbors** from `allDevices` — spine `group LEAVES neighbor <leaf-lo0> peer-as <leaf-asn>` per leaf, leaf `group SPINE-RR neighbor <spine-lo0> peer-as 65000` per spine (was `<CHANGE-ME-*>` stubs; threaded `allDevices` into both generators + dispatch); (4) `set vlans V10 vlan-id 10 / vxlan vni 10010` (overlay advertised nothing without it); (5) `set switch-options route-distinguisher <lo0>:1`; (6) **jumbo MTU moved to the real uplinks** et-0/0/48-49 (was on unused et-0/0/0-1 → VXLAN frames dropped); (7) converted bare `!` separator lines to `#` (invalid in Junos) via a `.replace(/^!$/gm,'#')` post-pass. 4 new tests | [x] | `configgen.ts` `juniperSpineConfig`/`juniperLeafConfig` + dispatch; `configgen.test.ts` (119→123) |
| X5 | **GPU/DC spine-tier sizing made physically honest** — the audit's two BOM findings fixed together: (1) `computeSpineLeaf` used `rawUplinksNeeded` (a BANDWIDTH quantity) directly as the spine SWITCH count → 512 GPUs @400G/1:1 produced **56 spines / $15.4M**; now `uplinksPerLeaf = clamp(rawUplinksNeeded, 2, leafSku.uplinks)` (redundancy floor 2, capped by physical ports) and `spineCount = max(uplinksPerLeaf, ceil(leafCount×uplinksPerLeaf / spinePorts), 2)`; (2) the old `ceil(leafCount/spinePorts)` fan-out **under-built the spine tier** — dc/2048ep/25G quoted 200 spine-leaf cables on 4×36=144 spine ports; the port-supply term fixes it (now 6 spines / 216 ports). Also fixed the unrealistic GPU-leaf SKU specs: NX-9332C + 7050CX3 (32×100G boxes) had `uplinks: 2` → now 8 (24 down / 8 up production split). 512-GPU NVIDIA BOM: 56→**8 spines**, $15.4M→**$10.7M**, and `validateBOM` correctly warns the 1:1 target degrades on an 8-uplink leaf (capacity views agree per I5). New e2e invariant **8a′**: spine tier must supply ≥ leafCount×uplinks ports + leaf uplinks ≤ leaf SKU ports (all 193 scenarios). ~20 `bom.test.ts` assertions recomputed with corrected math comments | [x] | `bom.ts` `computeSpineLeaf` + `products.ts` (9332c/7050cx3 uplinks 2→8) + `bom.test.ts` + `e2e-journey.test.ts`; 1172 tests, tsc + build green |
| X6 | Firewall device platform correctness — the BOM's Cisco firewalls (FTD 4145/1150) emitted IOS-XE ZBF CLI that Firepower hardware cannot run. New `ciscoFtdFirewallConfig()`: section 1 is the REAL FTD CLI bootstrap (`configure network hostname/ipv4 manual/dns`, `configure ssh-access-list`, `configure manager add <fmc-ip> <reg-key>` — the only CLI a real FTD accepts); section 2 is a declarative **FMC policy manifest** (interfaces+zones, static routing, access-control policy w/ IPS+file inspection + default-block, NAT (PAT + static DMZ), platform settings NTP/syslog/SSH, SNMPv3 health) since FTD policy is FMC-managed, never flat CLI. Exported `isFtdModel()` (`ftd|firepower|fpr`) dispatches Cisco firewalls by model — router-class boxes (ISR/Catalyst) keep genuine IOS-XE ZBF; dropped the old "this is really IOS-XE" apology note from the ZBF header. 3 new tests | [x] | `configgen.ts` `ciscoFtdFirewallConfig`/`isFtdModel` + dispatch; `configgen.test.ts` (123→126); 1175 tests, tsc + build green |
| X7 | vPC / MLAG data-plane completeness + optics BOM correctness — (a) **NX-OS**: real vPC peer-link (`interface port-channel<pairId>` + `vpc peer-link` + 2 member interfaces at the ports just below the fabric uplinks — was all comments, so vPC never initialized) + **anycast VTEP VIP**: loopback1 gains a pair-shared `10.254.1.<pairId>/32 secondary` advertised in BGP (vPC pairs previously appeared as 2 separate VTEPs); (b) **Arista**: real MLAG peer-link members (Ethernet just below uplinks, `channel-group <pairId>00 mode active`), **deterministic /31 MLAG peering** on Vlan4094 (`10.253.<pairId>.0/.1`, primary/secondary — was `<CHANGE-ME-*-mlag-peer-ip>` placeholders), and **shared anycast VTEP** — both pair members now use ONE Loopback1 IP `10.254.0.<pairId>` (audit A-M4: unique VTEPs black-hole multihomed traffic); (c) **optics BOM**: `buildOptics` no longer buys 2 transceivers for DAC/AOC runs (integrated — was double-counting) and the catalog gains 40G (QSFP-40G-SR4/LR4) + 1G (GLC-SX/LH) optics, so 40G firewall-uplink fiber runs are no longer silently dropped from the BOM. 3 configgen + 3 bom tests; 2 stale tests updated (placeholder assertion, uplink counting) | [x] | `configgen.ts` (nxos/arista leaf) + `bom.ts` (`buildOptics`, `OPTIC_CATALOG`); 1181 tests, tsc + build green |

---

### Y. Production-grade hardening, 2nd-pass audit (sourced 2026-07-11)

> Second architect review of the post-group-X output (same dump-and-review
> method; scenarios in `frontend/src/test/_dump.test.ts` pattern, dumps under
> scratchpad/audit2). **All group-X fixes held**; these are the next tier.
> Key theme: **fix-parity** — each first-audit fix landed on some vendors only.
>
> **Remaining findings (by area, severity from review):**
> - **NX-OS DC**: DC-4 spine configures Ethernet1/37-50 on a 36-port 9336C
>   (port overflow) + leaves wire uplinks only to spines 1-4 but BGP-peer all
>   6 (spines 5-6 dark) — link *distribution* must round-robin across all
>   spines & respect spine port count; DC-6 93180YC-FX uplinks emitted on 25G
>   server ports Eth1/45-48 instead of the 100G ports Eth1/49-54 (uplink ports
>   should use the SKU's real uplink port range); DC-7 no server-facing vPC
>   member ports (day-N note at minimum); MINORs: `version 10.3(x)` artifact,
>   `$(date -u …)` unrendered banner, dead CONNECTED-TO-ISIS tag-100 map,
>   unused spine features, missing advertise-pip/virtual-rmac.
> - **Campus IOS-XE**: C-1 mgmt plane sourced from `Vlan99` SVI that is never
>   created (both dist+access unmanageable — add `interface Vlan99` w/ mgmt
>   IP); C-3 access MEC (both uplinks in one LACP Po) toward two standalone
>   C9500s requires StackWise Virtual on the dist pair (or split uplinks+STP);
>   C-4 access uplink trunk missing `ip dhcp snooping trust` (all client DHCP
>   dropped); C-5 OSPF area auth enabled with no md5 keys on any interface;
>   C-6 no dot1x at all despite A3 scope; C-7 verify STP 4096/8192 split;
>   dist still has no downlink trunks to access / uplink-to-core.
> - **Arista**: A-M1 no tenant gateway (no Vlan10 SVI `ip address virtual`,
>   no L3VNI/VRF — NX-OS got this in X1, Arista parity missing); A-M2 MLAG
>   pair should share one ASN + iBGP across Vlan4094; A-M3 firewall↔fabric
>   integration absent (24 cables land on unconfigured spine ports); MINORs:
>   `dns server` → `ip name-server`, snmp user syntax, MLAG pair-id derived
>   from global idx (fragile), no host-port config.
> - **Juniper**: J-C1 fabric interfaces have `family iso` but NO `family
>   inet` address → underlay carries no IPv4 (BGP can never establish);
>   J-C2 spine configures only et-0/0/0-1 for 26 leaves / leaf only 2 uplink
>   ports for 4 spines (topology-driven port counts missing — Arista/NX-OS
>   have `closFabricLinks`, Juniper doesn't); J-C3 leaf missing global
>   `set routing-options autonomous-system`; J-M1 spine local-as == global AS
>   (remove); J-M2 SRX still emits bare `!` lines (X4 post-pass not applied);
>   J-M3 SRX zones bind nonexistent ge- interfaces + cluster has no fab/reth;
>   J-M4 no ESI-LAG / IRB gateway; MINOR: isis auth-key without
>   authentication-type md5.
> - **NVIDIA Cumulus**: N-C1 RoCE/PFC/ECN is ALL COMMENTS (traffic.conf
>   lines commented; only a software fq_codel qdisc on swp1) — GPU fabric is
>   lossy, violates §6.5; N-C2 `router bgp <CHANGE-ME-asn>` + placeholder
>   loopbacks (all other vendors auto-assign; identical placeholder on both
>   roles → same-ASN eBGP = zero sessions); N-C3 spine `neighbor swp1-swp64
>   interface peer-group` is invalid FRR range syntax; N-C4 leaf peers only
>   swp63-64 (2 spines) vs BOM's 8; N-M1 bare `route-reflector-client` line
>   on eBGP; N-M2 deprecated NCLU `net add` cmds on Cumulus 5.x (NVUE);
>   N-M3 `auto swp1-64` invalid ifupdown2 range + broken mgmt VRF stanza;
>   N-M4 EVPN with zero VNIs. Generator likely needs a full NVUE rewrite.
> - **FTD manifest**: byte-identical across DC and campus (no design-specific
>   INSIDE-NETS/subnets); fabric-side firewall handoff ports unconfigured on
>   leaf/dist (ties to A-M3).

| # | Item | Status | Notes |
|---|------|--------|-------|
| Y1 | Overlay-establishment parity criticals — (1) **NX-OS**: `ebgp-multihop 2` on BOTH peer templates (loopback eBGP never established — same class as X4's Juniper fix); spine **NH-UNCHANGED** route-map out on the EVPN AF (`set ip next-hop unchanged` — spine is not a VTEP; without it leaves tunnel to the spine loopback and blackhole); **explicit fabric-wide RTs `65000:<vni>`** replacing `route-target auto` (auto derives ASN:VNI — with unique per-leaf eBGP ASNs no leaf imports any other leaf); eBGP ECMP (`maximum-paths 64` not `ibgp`, `bestpath as-path multipath-relax` — needed for the vPC VIP advertised from 2 ASNs); LOOPBACKS prefix-list now covers the VTEP 10.254/16 range. (2) **Arista**: `ip routing` (+`ip routing vrf MGMT`) — EOS is L2-only by default, fabric didn't forward; `vrf instance MGMT` created + `Management1` joined to it (route/eAPI referenced a nonexistent VRF); leaf gains its missing `interface Management1` block entirely; `ebgp-multihop 3` on both peer groups; leaf `maximum-paths 64 ecmp 64` (was 4 on a 6-spine fabric). (3) **Campus**: dist gains `interface Loopback0` (10.255.3.x router-id, in OSPF — clears the V-12 warn) and a REAL peer-link Port-channel + 2 TenGig members (was commented, C-2 class). 7 new tests; 2 auto-RT tests rewritten (they asserted the DC-2 bug) | [x] | `configgen.ts` (nxos spine/leaf, arista spine/leaf, iosxeCampusConfig); `configgen.test.ts` 129→136; 1189 tests, tsc + build green |
| Y2 | NX-OS/Arista wiring honesty — (1) **staggered round-robin**: `closFabricLinks` now lands leaf uplink `i` on spine `(leafIdx+i) % spineCount` instead of the old `i % spineCount` that started every leaf at spine 1 → with `uplinks < spineCount` the remaining spines were **dark** (DC-4: spines 5-6 had zero links yet were still BGP-peered → Idle forever) while spines 1-4 over-subscribed; now all 6 spines get ~equal downlinks (33/34/34/34/33/32 for 50 leaves × 4) and total downlinks == total uplinks; (2) **spine port cap**: a spine truncates its link list at `dev.ports` (was emitting Ethernet1/37-50 on a 36-port 9336C); (3) **dedicated uplink ports**: new `Product.uplinkStart`/`BOMDevice.uplinkStart` (93180YC-FX = 49) threaded through `buildDeviceList`; `renderNxosFabricLinks`/`renderAristaFabricLinks` put fabric uplinks on Eth1/49+ (the 100G ports) not the 25G server ports Eth1/45-48 (DC-6 — 25G↔100G won't link), and vPC/MLAG peer-link members move to the leftover dedicated ports. 4 configgen tests + permanent e2e invariant 8a″ (no dark spine, no port>SKU, leaf uplinks in-range, all Cisco/Arista scenarios) | [x] | `configgen.ts` `closFabricLinks`/`renderNxos/AristaFabricLinks` + `products.ts`/`types` `uplinkStart` + `bom.ts`; `configgen.test.ts` 136→140 + `e2e-journey.test.ts`; 1192 tests, tsc + build green |
| Y3 | Campus deployability (C-1..C-6) — (1) **C-1**: `interface Vlan99` mgmt SVI on BOTH dist (`10.255.99.<idx+1>/24`) and access (+ `ip default-gateway`) — the whole mgmt plane (TACACS/NTP/syslog/SSH) sourced from an SVI that never existed; (2) **C-2**: dist gains real access-facing `DOWNLINK-TO-ACCESS` trunk range (Ten1/0/1-42) + a routed `UPLINK-TO-CORE` interface on its first uplink port (concrete, replaces `<CHANGE-ME-uplink-to-core>` refs in track/OSPF); (3) **C-3**: access MEC replaced with **split uplinks** (UPLINK-1→A01, UPLINK-2→A02, no port-channel — cross-chassis LACP to two standalone C9500s would suspend a member; RPVST+HSRP handle failover); (4) **C-4**: `ip dhcp snooping trust` on both access uplink trunks (client DHCP was 100% dropped); (5) **C-5**: `ip ospf message-digest-key 1 md5` on the core uplink to match the area auth; (6) **C-6**: 802.1X — global `dot1x system-auth-control` + radius server + `aaa authentication dot1x`, per-port `authentication port-control auto`/`dot1x pae authenticator`/`mab` fallback; + `switchport trunk native vlan 99` on campus trunks (native-VLAN minor). 5 new tests; 1 rewritten (it asserted the C-3 MEC bug) | [x] | `configgen.ts` `iosxeCampusConfig`; `configgen.test.ts` 140→145; 1197 tests, tsc + build green |
| Y4 | Arista tenant gateway + MLAG ASN model — (1) **A-M1 tenant gateway parity with NX-OS X1**: leaf now emits `vrf instance TENANT-A` + `ip routing vrf TENANT-A`, `ip virtual-router mac-address`, `interface Vlan10` w/ `ip address virtual <CHANGE-ME-tenant-anycast-gw>/24`, `vxlan vrf TENANT-A vni 50000` on Vxlan1, and a BGP `vrf TENANT-A` block (rd `<routerId>:50000`, RTs `65000:50000`, redistribute connected) — servers in VLAN 10 previously had no first-hop and no inter-VNI routing; multisite adds stretched `65100:50000` DCI RTs (A7 parity); (2) **A-M2 MLAG pair single-ASN + peer-link iBGP**: leaf ASN is now pair-based (`65000 + pairId` — both MLAG members share one ASN; spine's per-leaf `remote-as` updated to match `65000 + floor(i/2)+1`) and the pair runs iBGP across the Vlan4094 /31 (`neighbor MLAG-PEER remote-as <pairAsn>` + `next-hop-self`) so a member that loses all uplinks still has routes via its peer; (3) EOS minors: `dns server` → `ip name-server`, SNMPv3 fixed to `snmp-server group NETDESIGN-RO v3 priv` + `user NETDESIGN-USER NETDESIGN-RO v3` (was malformed `priv-v3` group). 4 new tests; 1 X3 assertion updated (per-leaf → pair ASN) | [x] | `configgen.ts` `aristaLeafConfig`/`aristaSpineConfig`; `configgen.test.ts` 145→149; 1201 tests, tsc + build green |
| Y5 | Juniper underlay IPv4 + topology-driven ports + SRX cluster — (1) **J-C1**: new `renderJuniperFabricLinks()` (reuses `closFabricLinks`): every fabric interface now gets `family inet <10.99.x.y/31>` + `family iso` + jumbo MTU + its IS-IS statement — before, links carried only `family iso`, so IS-IS formed ISO adjacencies but the underlay had NO IPv4 and BGP-over-loopback could never establish; (2) **J-C2**: spine downlink count is topology-driven (one et-0/0/N per assigned leaf link with staggered round-robin + matching /31s both ends — was hardcoded et-0/0/0-1 for 26 leaves), leaf uplinks land at et-0/0/<ports>+ (0-based, after the access ports); (3) **J-C3/J-M1**: leaf gains global `set routing-options autonomous-system <asn>` (Junos won't run BGP without it) and the redundant `local-as` dropped on both roles; (4) isis `authentication-type md5` added next to the auth-key (silently unapplied otherwise); (5) **J-M2/J-M3 SRX**: `!`→`#` post-pass applied; real cluster data-plane — xe- members → reth0/1/2 (UNTRUST/TRUST/DMZ) w/ family inet, fab0/fab1 links, zones bind reth units instead of nonexistent ge-0/0/x. 5 new tests; X4 fixture updated to real QFX port specs | [x] | `configgen.ts` `renderJuniperFabricLinks` + juniper spine/leaf/srx; `configgen.test.ts` 149→154; 1206 tests, tsc + build green |
| Y6 | NVIDIA Cumulus rewritten to NVUE (5.x) — `nvidiaSpectrumConfig` is now a pure `nv set` config (NCLU was removed in 5.x; the old `/etc/network/interfaces` used invalid `iface swp1-64` range stanzas + a contradictory `iface mgmt` dhcp/static/vrf block): (1) **N-C1**: `nv set qos roce enable on` + `mode lossless` — REAL Spectrum lossless (PFC pri-3, ECN/WRED, buffer carving in one profile); the old output had PFC/ECN as comments only → the GPU fabric shipped LOSSY (§6.5 violation); (2) **N-C2**: auto identity like every other vendor — spine ASN 65000 / lo `10.255.1.<i+1>`, leaf `65001+idx` / `10.255.2.<i+1>` (was `<CHANGE-ME-asn>` on BOTH roles → same-ASN eBGP = zero sessions); (3) **N-C3/N-C4**: per-port BGP-unnumbered neighbors (`neighbor swpN remote-as external` + unnumbered + BFD + 3/9 timers) — leaf peers ALL its uplink ports (top `uplinks` swps), spine one per assigned link via `closFabricLinks` (no more invalid `neighbor swp1-swp64` FRR range); (4) **N-M1/M4**: dropped `route-reflector-client`-on-eBGP and the empty EVPN AF (pure eBGP L3 per RFC 7938); (5) **N-M3**: `eth0` in the mgmt VRF via NVUE. Validator: `extractLoopbacks` now parses the NVUE loopback (`nv set interface lo ip address X/32`) so V-02/V-12 see real IPs. 5 new tests | [x] | `configgen.ts` `nvidiaSpectrumConfig` + dispatch (`allDevices`) + `config-validator.ts` `extractLoopbacks`; `configgen.test.ts` 154→159; 1211 tests, tsc + build green |
| Y7 | Firewall↔fabric integration (A-M3 + FTD manifest) — the BOM cabled every FW to every spine (DC) / dist (campus) but **neither end configured those ports**, so 24 cables landed on unconfigured interfaces and the FW was an island. New shared `fwHandoffPlan(dev, allDevices, role)`: one routed **/31 per firewall** — fabric side `10.98.<peerIdx+1>.<fwIdx*2>`, FW side `.1` — ports allocated after the fabric links (spine) / core uplink (dist) and dropped rather than overflowed past the SKU. Emitted by NX-OS spine, Arista spine, and IOS-XE distribution. `ciscoFtdFirewallConfig` now takes `useCase` + `allDevices` and is **design-specific** (was byte-identical across every design): per-spine/dist INSIDE interfaces with the matching `/31`, ECMP static routes back to the fabric, and use-case INSIDE-NETS (DC/GPU/multisite → tenant `10.10.0.0/16` + fabric loopbacks `10.255.0.0/16`; campus → VLAN 10 `10.10.10.0/24` + mgmt `10.255.99.0/24`). Both ends verified address-coherent. 4 new tests | [x] | `configgen.ts` `fwHandoffPlan` + nxos/arista spine + `iosxeCampusConfig` + `ciscoFtdFirewallConfig`; `configgen.test.ts` 159→163; 1215 tests, tsc + build green |

---

### Z. Production-grade hardening, 3rd-pass audit (sourced 2026-07-19)

> Third architect review (two independent reviewers: Cisco/campus + multi-vendor)
> of the post-group-Y output; dumps under `scratchpad/audit3`. All Y fixes held.
> **Both reviewers independently identified the same two structural themes**, which
> is the most useful output of this audit:
> 1. **fix-parity** — a Y-series fix landed on 1–2 vendors of 5 (the Y1 NX-OS
>    EVPN next-hop fix was never ported to Arista/Juniper → both blackholed).
> 2. **BOM↔config disagreement** — the config truncates/ignores what the BOM bills.
>
> Both are mechanically testable; the recommended shape is a **per-vendor
> invariant matrix** ("every vendor with an eBGP EVPN spine asserts a
> next-hop-unchanged token"; "cable qty ≤ available ports and == Σ configured
> interfaces"). Z1 introduced the first such matrix.
>
> **Verified-correct by both reviewers** (so the prior 14 PRs hold): NX-OS real
> per-leaf eBGP + multihop + NH-UNCHANGED + explicit RTs + anycast GW/L3VNI/NVE
> mutually consistent + PIP/VIP loopback1 + real vPC peer-link + uplinks on 100G
> ports + no dark spine + valid NETs; Arista shared VTEP w/ unique RDs + MLAG
> /31s + tenant VRF; Juniper `family iso`+`family inet` both ends + topology-driven
> ports + global AS + SRX reth/fab; Cumulus NVUE identity + per-port unnumbered
> neighbors + mgmt VRF (**the only vendor that gets the mgmt VRF fully right**).
> **Address plan verified non-overlapping** across 10.98/10.99/10.253/10.254/
> 10.255.x/10.10 at all tested scales, and I separately verified zero port
> collisions and zero duplicate /31s across all 4 designs.

| # | Item | Status | Notes |
|---|------|--------|-------|
| Z1 | Fabric-forwarding criticals — (1) **XC-1 fix-parity, the highest-value finding**: the Y1 NX-OS EVPN next-hop fix existed on NX-OS only; Arista and Juniper spines had NO next-hop treatment, so an eBGP spine (not a VTEP) rewrote every EVPN next-hop to its own loopback → **100% overlay blackhole on 2 of 3 vendors**. Added `neighbor LEAF-PEER next-hop-unchanged` (EOS) + `multihop no-nexthop-change` (Junos); (2) **C-1**: NX-OS had `feature nv overlay` but never the global `nv overlay evpn` (§10) — the l2vpn evpn AF, the `evpn` MAC-VRF block and `host-reachability protocol bgp` were all inert on 56 devices; (3) **M-1**: leaves BGP-peered ALL spines while the staggered planner wires a subset, so with `uplinks < spineCount` each leaf carried permanently-Idle sessions to spines >2 hops away (`ebgp-multihop 2` can never reach them) — now derived from `closFabricLinks`, one session per *distinct linked* spine, on all 3 EVPN vendors; (4) **XC-3**: NO vendor configured a single host/server port — VLAN 10, the anycast GW and the NVE served nothing that could physically attach. Added server-access ports (NX-OS `switchport access vlan 10` + edge/BPDU-guard + `vpc orphan-port suspend`, EOS equivalent, Junos `family ethernet-switching`, Cumulus routed /31 host ports for rail-optimized GPU); (5) **A3-2**: EOS trunk-group semantics filtered VLAN 10 OFF the MLAG peer-link (only group-carrying VLANs traverse it) → added `trunk group MLAG_PEER` to vlan 10; (6) **J3-2/J3-6/J3-7**: Juniper was the last vendor with no tenant gateway — added `irb.10` + `virtual-gateway-address` + `TENANT-A` VRF w/ `ip-prefix-routes`, plus `forwarding-table export LOAD-BALANCE` (Junos programs ONE FIB next-hop without it — a 4-spine fabric forwarded on one spine) and `isis level 1 disable` (L1 was left enabled + unauthenticated). New **cross-vendor parity matrix** in the tests: every EVPN vendor asserts its own next-hop token, peers-only-linked-spines, and host ports. 13 new tests | [x] | `configgen.ts` (nxos/arista/juniper spine+leaf, cumulus); `configgen.test.ts` 163→176; 1228 tests, tsc + build green |
| Z2 | **BOM↔config physical honesty** (both reviewers, independently the #2 theme) — (a) **link speed now `min(both ends)`**: cabling took the `from` device's speed, so a 400G spine facing a 100G leaf billed `QSFP-DD-400G-SR4` modules that do not fit the leaf's QSFP28 cages (the reverted-fix check flagged **56 of 193** e2e scenarios). New `speedGbps`/`portSpeed`/`linkSpeed` in `bom.ts` + `uplinkSide` on `LAYER_CONNECTS`: the end that terminates on its DEDICATED uplink block (leaf→spine, access→dist, dist→core) presents `uplinkSpeed`, not its host-port `speed` — new `Product.uplinkSpeed`/`BOMDevice.uplinkSpeed` set on the 16 SKUs whose uplink block differs (93180YC-FX 25G host/100G uplink, QFX5120, SN4600C, EX4400, 720XP, …); without it `min()` would have rated a 93180YC-FX fabric link at its 25G server-port speed. (b) **fabric rate mismatch is now configured**: `fabricRateMismatch()` in `configgen.ts` pins the faster end to the billed rate on all 3 EVPN vendors — NX-OS `speed 100000`, EOS `speed forced 100gfull`, Junos `set interfaces et-0/0/N speed 100g`; most catalog spines are 400G against 100G leaf uplinks, so those ports previously never linked. (c) **HA peer-links are cabled**: `buildCabling` emits a 2-member peer-link per leaf (vPC/MLAG) and per distribution pair — the configs have emitted them since X7/Y1 but the BOM billed none. (d) **phantom host links removed**: `leaf→gpu-compute` was a froms×tos full mesh (640 runs); now `min(leaf downlink supply, server NIC supply)`. (e) **cap-vs-truncate is a `validateBOM` error**: a spine whose free ports after the fabric links cannot seat every firewall handoff now errors instead of silently dropping the extras. New permanent e2e invariant **8a‴** (all 193 scenarios): no cable billed faster than its slower end, and every optic matches its own link's rate. 7 bom + 7 configgen tests | [x] | `bom.ts` `linkSpeed`/`buildCabling`/`validateBOM` + `products.ts`/`types` `uplinkSpeed` + `configgen.ts` `fabricRateMismatch` + `e2e-journey.test.ts`; 1242 tests, tsc + build green |
| Z3 | **North-south handoff re-homed onto border leaves** (XC-2) — the firewall was cabled to the **spines**, which cannot work in any design: an eBGP spine is not a VTEP and carries no tenant VRF, so it had nothing to route the firewall's traffic *into*; the handoff /31s were in no IGP; and no default was ever originated, so north-south traffic was impossible everywhere. New exported `borderLeaves(allDevices)` / `isBorderLeaf(dev, allDevices)` — the **last leaf pair** (already a vPC/MLAG pair, so the handoff is redundant) owns the handoff; `fwHandoffPlan(…, 'border-leaf')` allocates its ports from the top of the host block and `leafHostPortMax()` shrinks the server-access range by the same amount, so the two can never collide. Emitted on all three tenant-VRF vendors: **NX-OS** (`vrf member TENANT-A` on the handoff, `vrf context TENANT-A / ip route 0.0.0.0/0 <fw>`, and a new `vrf TENANT-A` block under `router bgp` with `advertise l2vpn evpn` — which also closes Z5's M-3 — plus `default-information originate always` on the border leaf); **EOS** (`vrf TENANT-A` interface, `ip route vrf TENANT-A`, `redistribute static` + `network 0.0.0.0/0` in the BGP VRF); **Junos** (`routing-instances TENANT-A interface xe-…`, VRF static default, `ORIGINATE-DEFAULT` policy exported into `ip-prefix-routes`). **Campus**: the distribution handoff /31s now sit in OSPF area 0 with a `network` statement and `default-information originate` (they were in no IGP, so nothing else could reach the perimeter). BOM: `LAYER_CONNECTS` cables `firewall→leaf` (qty = firewalls × 2 border leaves) instead of `firewall→spine`; the Z2 port-budget error re-homed onto the border-leaf host-port budget; the FTD manifest derives its INSIDE side from the border leaves. New permanent e2e invariant **8a⁗**: no firewall may be cabled to a spine, no spine may configure a handoff, only leaf/distribution may own one, and the tenant-VRF vendors must actually configure it. 14 configgen + 1 bom test | [x] | `configgen.ts` `borderLeaves`/`isBorderLeaf`/`leafHostPortMax`/`nextIp` + nxos/arista/juniper leaf + `iosxeCampusConfig` + `ciscoFtdFirewallConfig`; `bom.ts` `LAYER_CONNECTS`/`validateBOM`; 1258 tests, tsc + build green |
| Z3b | Border-leaf firewall handoff parity for the remaining fabric vendors — the Z3 e2e invariant (8a⁗) proved Nokia SR Linux, NVIDIA Cumulus, Dell OS10 and Extreme EXOS leaves configure **no** handoff at all, so their designs still bill firewall cables that terminate on nothing. These four also have no tenant VRF on the leaf (Cumulus is pure eBGP L3 per Y6), so each needs a VRF + handoff + default-origination story of its own. As each lands, add its vendor to `TENANT_VRF_VENDORS` in `e2e-journey.test.ts` so the gap cannot silently reopen | [ ] | `configgen.ts` `nokiaSrLinuxConfig`/`nvidiaSpectrumConfig`/`dellOs10SwitchConfig`/`extremeExosConfig` |
| Z4 | **Campus physical-layer correctness** — the C9500-48Y4C is **48×25G SFP28 (`TwentyFiveGigE1/0/x`) + 4×100G (`HundredGigE1/0/49-52`)** and has NO `TenGigabitEthernet` at all, yet every distribution data-plane command named one: all trunks, the core uplink, the FW handoff, the peer-link AND the HSRP tracked object were **rejected by the platform** (C-5). New `Product.portIf`/`uplinkIf` (+ `BOMDevice`) with `iosIfPrefix(speed)` / `hostIf(dev,n)` / `uplinkIf(dev,n)` helpers in `configgen.ts`; campus SKUs now carry real interface naming and uplink blocks — C9500 (`TwentyFiveGigE1/0/` + `HundredGigE1/0/`, `uplinkStart 49`), C9200-48P (`GigabitEthernet1/0/` + **C9200-NM-4X** `TenGigabitEthernet1/1/`, `uplinkStart 1`), C9300L (`GigabitEthernet1/1/`), C9300-48UXM (`TenGigabitEthernet1/1/`) — giving campus the `uplinkStart` parity Y2 gave the DC. Distribution now puts the peer-link on `HundredGigE1/0/49-50` and the core uplink on `1/0/51`, downlink trunks on the 25G block, and the FW handoff on the **top** of the 25G block (same discipline as the Z3 border leaf, so it can never collide with the trunk range). Access keeps all 48 in-chassis ports (C-6 — uplinks are a module, not front-panel copper). **C-7**: `ip default-gateway 10.255.99.254` was owned by nobody → Vlan99 now runs HSRP group 99 owning `.254`; `10.255.99.0/24` was in no OSPF `network` statement → added, so RADIUS/TACACS/syslog/NTP are reachable at all; and `port-control auto` had no critical-auth fallback → added `authentication event server dead action authorize vlan 10` so a RADIUS outage no longer fails every access port closed. New permanent e2e invariant **8a⁙**: no config may name a port type outside its SKU's declared prefixes (breaking one prefix trips it in 17 scenarios). 5 new configgen tests; 3 campus tests rewritten onto real SKU port naming | [x] | `types`/`products.ts` `portIf`/`uplinkIf` + `configgen.ts` `iosIfPrefix`/`hostIf`/`uplinkIf`/`iosxeCampusConfig`/`fwHandoffPlan`; 1263 tests, tsc + build green |
| Z5 | **Identity is tier-scoped + NX-OS vPC completeness** (first slice) — **M-7/A3-7** was the fabric-fatal one both reviewers flagged: `pairId`, the loopback, the VTEP and the ASN all derived from the **GLOBAL** device index, so an ODD number of preceding devices (three spines, say) split an HA pair across two pairIds — mismatched vPC domain, anycast VTEP, peer-link and ASN, silently. New exported `roleIndex(dev, allDevices, fallback)`; every generator and every peer-list now indexes **within its own tier**, so the first leaf is `10.255.2.1` / ASN 65001 no matter how many spines precede it (the regression test proves 3 and 5 spines used to split the pair: `expected '2' to be '3'`). **M-2**: `advertise-pip` + `advertise virtual-rmac` on the EVPN AF — mandatory with a PIP+VIP vPC VTEP *and* an L3VNI, or the peer imports type-5 routes with the VIP next-hop and symmetric-IRB traffic dies on the wrong-MAC check. **M-6**: NX-OS leaf ASN is now **pair-based** (`65000 + pairId`, parity with the Arista Y4 fix — the shared anycast VTEP must have one origin AS) plus a real backup routed path: `vlan 3999` / `interface Vlan3999` /31 over the peer-link with an iBGP session, so a member that loses every uplink reaches the fabric via its peer instead of black-holing. **M-5**: `policy-map type network-qos PM-JUMBO` under `system qos` — the routed fabric ports set MTU per-interface, but the **switched** paths (vPC peer-link, server access ports) inherited 1500 and dropped VXLAN-encapsulated frames. **M-3** was already closed by Z3 (the `vrf TENANT-A` BGP block). 9 new tests | [x] | `configgen.ts` `roleIndex`/`haPairInfo`/`nxosSpineConfig`/`nxosLeafConfig`/`nxosStdQoS` + all peer lists; `configgen.test.ts` 208→217; 1282 tests, tsc + build green |
| Z5b | Per-vendor remainders after the Z5 slice — **NX-OS**: multihop BFD inert (M-4). **Arista**: mgmt services (tacacs/ntp/syslog/snmp) left in the default VRF while Management1 is in `vrf MGMT` → all non-functional (A3-3); leaf mgmt plane is a subset of the spine's (A3-4); loopbacks re-advertised into BGP create a recursive next-hop on EOS (A3-5); 7800R3 is modular so `Ethernet<slot>/<port>` naming (A3-6). **Juniper**: OOB default route sits in `inet.0` — a data-plane default out the mgmt port; needs `management-instance` (J3-4); no ESI-LAG for dual-homed servers (J3-3); SRX node-1 FPC offset likely `xe-8/0/x` not `xe-7/0/x` (J3-8). **Cumulus**: apply header says `nv config replace` but the artifact is `nv set` lines (must be sourced) (N3-3); no host-side RoCE/NIC manifest — lossless is a host+network contract (N3-4); mgmt by DHCP vs static everywhere else (N3-5). | [ ] | `configgen.ts` per-vendor + `haPairInfo` pairId derivation |
| Z6 | **Comment lines are never configuration** — V-08 warned "18 devices have NVE/VXLAN but no EVPN" on a `gpu-nvidia` design with no VXLAN anywhere; all 18 hits were the comment `# … (jumbo MTU for RoCE/VXLAN payloads)`. Rather than patch one detector, generalized the M9 `isCommentLine()` fix: new `stripComments`/`stripCommentsAll`, and **every content check** now runs against the comment-stripped config (V-11 keeps the raw text — it asks whether generation produced anything at all). The audit was worth doing: reverting the strip trips the new tests on **four** checks, not one — V-01 (a commented-out `router ospf` counted as a second underlay), V-05 (a `! username admin password Cisco123 <- do NOT do this` warning counted as a hardcoded secret), V-08 and V-10 (an ACL named only in a comment counted as an undefined reference). Stripping then exposed two REAL defects the comments had been masking: (a) the **FTD** bootstrap had no live NTP at all — its NTP/syslog/SNMP lived entirely in the commented FMC manifest — so V-07 was passing on comment text; added the genuine `configure ntp servers` CLI line. (b) **V-09 was Cisco/Arista-keyword-only** (same class as M3/M4): NVIDIA Cumulus expresses the whole lossless contract in ONE NVUE profile (`nv set qos roce enable on` + `mode lossless` = PFC + ECN/WRED + buffer carving), so a correctly-lossless GPU fabric FAILED "PFC/ECN/RDMA not configured on any device" — detector is now NVUE-aware. 5 new tests | [x] | `config-validator.ts` `stripComments`/`stripCommentsAll`/`checkGPUQoS` + `configgen.ts` FTD NTP; `config-validator.test.ts` 43→48; 1268 tests, tsc + build green |
| Z7 | **Address-scheme scale ceilings** (same class as the `alphaLabel` overflow fixed in E3) — every scheme built addresses by interpolating into a single octet, so past **16 spines** (`10.99.<leaf>.<16·spine+n>`), **254 leaves** (`10.255.2.<idx+1>`, `10.254.0.<pairId>`, `10.253.<pairId>.x`) or **254 campus switches** the generator SILENTLY emitted invalid IPs like `10.99.1.256`. All of it now goes through real 32-bit arithmetic: new `ipToInt`/`intToIp`/`ipAdd`. Fabric P2P links use a **flat /31 index** inside `10.99.0.0/16` (32 768 links) derived identically on both ends from (leafIdx, spineIdx, linkNum); the firewall handoff uses a shared `fwHandoffIp(peerIdx, fwIdx, fwCount)` so the fabric side and the FTD manifest can never drift; MLAG /31s are a flat index in `10.253.0.0/16`. Roles that address out of a single /24 (spine/leaf/campus loopbacks, VTEP, vPC VIP, campus mgmt SVI) go through `roleIp(primary, slot, idx)`: the first 254 devices keep their documented /24 so **existing designs are byte-identical**, and device 255 onward continues in a reserved scale-overflow supernet `10.100.0.0/14` instead of overflowing an octet. 5 new tests including 32-spine and 600-leaf fabrics and a 300-switch campus asserting **no octet > 255 anywhere**, plus both-ends-agree and no-duplicate-/31 checks at scale — reverting the fix trips them with `10.99.1.256`. Note: the tests exclude IS-IS NETs (`49.0001.0102.5500.0001.00`) via lookarounds, since those are not IPv4 | [x] | `configgen.ts` `ipToInt`/`intToIp`/`ipAdd`/`roleIp`/`RoleSlot`/`fwHandoffIp` + `closFabricLinks` + every address site; `configgen.test.ts` 203→208; 1273 tests, tsc + build green |

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
- **Verify the Vercel deploy after merging user-facing changes** — do not
  assume the Git integration succeeded. Incident 2026-07-11: the X5/X6
  production deploys failed with a Vercel platform error
  (`sts_credentials_fetch_failed` at `build-container-init`, before the
  build ran), so netdesignai.com silently served the pre-fix build and the
  user re-tested against old code. Check via the Vercel MCP tools
  (project `project-pk174`, team `netdesign-team` — it is the
  `Network-Automation` repo's project despite the name) that the latest
  production deployment is `READY` **and its `githubCommitSha` is your
  merge commit**; a platform-errored deploy is fixed by an empty commit to
  `main` to retrigger.
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
