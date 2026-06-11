# NetDesign AI — Code Reference

**Purpose:** This document is a function-by-function map of the codebase so a
new Claude session can understand "what does what" without re-reading every
file from scratch. Read this first, then jump straight to the specific
file/line you need with `Read`/`Grep`.

Linked from `CLAUDE.md` (see "Project Status" section). Keep this in sync
when you add/rename/remove exported functions, types, or major UI sections —
stale docs cost more tokens than no docs.

Scope: covers the **active React frontend** (`frontend/src/`) and the
**FastAPI backend** (`backend/`). The legacy vanilla-JS app (`src/js/*.js`,
root `index.html`) is a feature-reference only (see `AGENT_ROADMAP.md`) and
is NOT documented here.

---

## Table of Contents

1. [Frontend — Types (`types/index.ts`)](#frontend--types-typesindexts)
2. [Frontend — `lib/bom.ts` (BOM / port-math)](#frontend--libbomts-bom--port-math)
3. [Frontend — `lib/configgen.ts` (config generation)](#frontend--libconfiggents-config-generation)
4. [Frontend — `lib/policies.ts` / `lib/customPolicy.ts`](#frontend--libpoliciests--libcustompolicyts)
5. [Frontend — `lib/products.ts` / `lib/utils.ts`](#frontend--libproductsts--libutilsts)
6. [Frontend — `store/useAppStore.ts`](#frontend--storeuseappstorets)
7. [Frontend — `api/client.ts` / hooks](#frontend--apiclientts--hooks)
8. [Frontend — `data/demoTopologies.ts` / `BackendToggle.tsx`](#frontend--datademotopologiests--backendtoggletsx)
9. [Frontend — Pages (Step1–Step6)](#frontend--pages-step1step6)
10. [Frontend — Components (`HLDTopologyDiagram`, Sidebar, panels)](#frontend--components)
11. [Backend — app entry, routers, core engines](#backend--app-entry-routers-core-engines)
12. [Backend — integrations, telemetry, ZTP, policies, export](#backend--integrations-telemetry-ztp-policies-export)

---

## Frontend — Types (`types/index.ts`)

`frontend/src/types/index.ts` (360 lines) is the single source of truth for
shared TypeScript types. New backend-facing types go here (CLAUDE.md rule
#2).

**Use-case / scale enums** (top of file):
- `UseCase` = `'campus'|'dc'|'gpu'|'wan'|'multisite'|'multicloud'|'aviatrix'`
- `AppType` = `'voice'|'video'|'storage'|'hpc'|'internet'`
- `Scale` = `'small'|'medium'|'large'`
- `Redundancy` = `'single'|'dual'`
- `Compliance` = `'QoS'|'PCI'|'HIPAA'|'SOC2'|'FedRAMP'|'NIST_CSF'|'ISO27001'`
- `VpnType`, `RedundancyModel`, `TrafficPattern`, `BandwidthPerServer`,
  `UnderlayProtocol`, `OrgSize`, `BudgetTier`, `FirewallModel`, `DcTopology`

**Product catalog**
- `Product` — one SKU: `{ id, model, vendor, subLayer, ports, uplinks, speed, asic, powerW, priceUSD, features, useCases, detail }`. Backed by `lib/products.ts`.

**Design output types**
- `BOMDevice` — `{ id, hostname, role, subLayer, model, vendor, count, unitPrice, totalPrice, speed, ports, uplinks?, features }`. This is what `buildDeviceList()` returns and what `configgen.ts` consumes. **No topology/pairing metadata is stored here** — pairing is *derived* at config-gen time from `hostname` + `idx` via `haPairInfo()` (see configgen section).
- `CableLink` — one cabling BOM row (`fromLayer/toLayer`, cable type, qty, price).
- `OpticsEntry` — one optics BOM row (form factor, speed, reach, qty, price).
- `LinkDistances` — `{ 'spine-leaf', 'dist-access', 'core-dist', 'wan-edge', [key: string]: number }` — user-editable cable run lengths used by `buildCabling()`/`buildOptics()`.

**`AppState`** (the Zustand store shape — see section 6 for actions):
Grouped fields: design (`useCase, appTypes, siteName, siteCode, scale,
redundancy, linkDistances, devices, cabling, optics, configs, ztpConfig,
policies, compliance`), wizard nav (`step, activeDeployTab, theme`), Step 1
org fields (`orgName, orgSize, budgetTier, vendorPrefs, industry,
primaryContact, customPolicyRules`), Step 2 requirement fields
(`trafficPattern, totalEndpoints, bandwidthPerServer, oversubscription,
underlayProtocol, overlayProtocols, protoFeatures, firewallModel,
redundancyModel, numSites, vpnType, nacOptions, additionalNotes,
policyBlocks`), multi-cloud fields (`cloudProviders, dcTopology,
coloProvider, dcEdgeVendor, bgpAsn, orgCidr, aviatrixOptions`), and
`demoTopologyId`.

**Lab Demo API types** (used by Step 6 simulation + `useTopology`/`useZTP`/`useChecks`/`useMonitoring`):
- `TopologySummary`, `TopologyDevice` — demo inventory shape.
- `ZTPEvent`, `ZTPResult` — ZTP state-machine event log + summary counts.
- `CheckResult`, `ChecksResult`, `CheckResponse` — pre/post check rows (`status: PASS|FAIL|WARN|SKIP`).
- `DeviceHealth`, `MonitoringResult` — per-device health (`status: healthy|degraded|down|unknown`, `metrics`, `alerts`) + summary.

**Observability**
- `Alert` — `{ id, device, severity: critical|warning|info, summary, detail?, timestamp, resolved }`.
- `RcaHypothesis` — `{ rank, cause, confidence, evidence[], remediation }`.

**Deploy pipeline**
- `DeployStage` = `'queued'|'connecting'|'pre_checks'|'pushing_config'|'post_checks'|'done'|'failed'`
- `DeployEvent` — one WS message from `/ws/deploy/{id}` (`stage, device?, message, progress, timestamp`).
- `DesignState`, `DeployRequest`, `DeployResponse` — payloads for `/api/deploy`.

**Design / Deployment records** (persisted designs, `MyDesigns.tsx`)
- `Design` — `{ id, name, use_case, state: DesignState, created_at, updated_at }`.
- `Deployment` — `{ id, design_id, status, started_at, finished_at?, events: DeployEvent[] }`.

**Demo topology catalog**
- `DemoTopology` — one entry in `data/demoTopologies.ts` (id, label, icon, useCase, scale, description, siteCode/siteName/orgName, trafficPattern, underlayProtocol, totalEndpoints, devices/cabling/optics).

**Metrics**
- `DeviceMetrics` — gNMI/Prometheus-style per-device metrics (`cpu_util, mem_util, interface_errors_in/out, bgp_sessions_up, bgp_prefixes_received, pfc_drops, throughput_mbps`).
- `MetricsSummary` — `{ timestamp, devices: Record<string, DeviceMetrics> }`.

---

## Frontend — `lib/bom.ts` (BOM / port-math)

`frontend/src/lib/bom.ts` (448 lines). Turns the intent (`useCase`, `scale`,
`totalEndpoints`, `bandwidthPerServer`, `oversubscription`, `vendorPrefs`,
`firewallModel`, `trafficPattern`) into a concrete device list, BOM summary,
cabling, and optics. **Never hardcode device counts — always go through
`buildDeviceList()`** (CLAUDE.md rule #5).

### Catalog/lookup tables
- `SCALE_DEFS: Record<Scale, Record<UseCase, RoleCounts>>` — fallback device
  counts per role when `totalEndpoints` is 0 or port-math doesn't apply
  (e.g. `small.dc = { spine: 2, leaf: 4 }`, `medium.campus = { distribution:
  4, access: 12, firewall: 2 }`).
- `PREFERRED_PRODUCTS: Record<UseCase, Record<role, productId>>` — Cisco-
  default SKU per role per use case (e.g. `dc.spine = 'nxos-9336c'`).
- `VENDOR_PRODUCT_MAP: Record<vendor, Partial<Record<UseCase, Record<role,
  productId>>>>` — per-vendor SKU overrides for Arista, Juniper, Palo Alto,
  Fortinet, Dell EMC, HPE Aruba, NVIDIA, Extreme.
- `ROLE_CODE: Record<subLayer, hostnameCode>` — `spine→SPINE, leaf→LEAF,
  distribution→DIST, access→ACC, wan-edge→WAN, firewall→FW, cloud-gw→CGW,
  cloud-transit→CTGW, core→CORE`.

### Functions
- **`resolvePrefs(useCase, vendorPrefs): Record<role, productId>`** — starts
  from `PREFERRED_PRODUCTS[useCase]` (Cisco defaults) then layers each vendor
  in `vendorPrefs` on top via `VENDOR_PRODUCT_MAP`. Later vendors in the
  array win on role conflicts.
- **`rackLabel(idx): string`** — `String.fromCharCode(65 + Math.floor(idx /
  2))` → `A, A, B, B, C, C, ...`. Two consecutive devices of the same role
  share a rack letter (an HA pair).
- **`generateHostnames(devices, siteCode): BOMDevice[]`** — assigns
  `hostname = ${SITE}-${ROLE_CODE}-${rack}${unit}` where `unit =
  String((idx % 2) + 1).padStart(2, '0')` (per-role counter `idx`, reset for
  each subLayer/role code). Result: `IAD-LEAF-A01, IAD-LEAF-A02,
  IAD-LEAF-B01, IAD-LEAF-B02, ...` — **idx 0&1 are an HA pair, idx 2&3 are
  the next pair, etc.** This pairing convention is what `configgen.ts`'s
  `haPairInfo()` relies on (see below) to derive vPC/MLAG/HSRP pairing
  without needing extra state.
- **`buildDeviceList(state): BOMDevice[]`** — the core port-math engine:
  - Resolves `prefs` via `resolvePrefs()` (or Cisco defaults if no
    `vendorPrefs`).
  - Decides if a firewall is needed: `fwAllowed = prefs['firewall'] &&
    firewallModel !== 'none'`; `needFirewall = fwAllowed && (scale !==
    'small' || trafficPattern is 'ns'/'both')`.
  - **If `totalEndpoints > 0`** and useCase is `dc|gpu|campus|multisite`,
    computes `scaleDef` from port math:
    - **dc/gpu**: `downlinkPorts = leafSku.ports - leafSku.uplinks`;
      `leafCount = ceil(endpoints / downlinkPorts)`, rounded up to even.
      `uplinksNeeded = min(leafSku.uplinks, ceil((downlinkPorts * bwGbps) /
      oversub / spineSku.speed))`. `spineCount = max(ceil(leafCount *
      uplinksNeeded / spineSku.ports), 2)`. Firewalls: 2 if `spineCount <=
      4` else 4.
    - **campus**: `accessPorts = accessSku.ports - accessSku.uplinks` (default
      48-4=44). `accessCount = ceil(endpoints / accessPorts)`, rounded to
      even. `distCount = max(2, ceil(accessCount / 8))`, rounded to even.
      Firewalls: 2 if `distCount <= 4` else 4.
    - else: falls back to `SCALE_DEFS[scale][useCase]`.
  - **Else** (no endpoint count, or other use cases): `scaleDef =
    SCALE_DEFS[scale][useCase]` (+ firewall bump if needed).
  - For each `(role, qty)` in `scaleDef`, looks up the `Product` (via
    `prefs[role]` or first product matching `subLayer===role &&
    useCases.includes(useCase)`), and pushes `qty` `BOMDevice` entries
    (`id = ${product.id}-${globalIdx}`, `hostname: ''` — filled in by
    `generateHostnames()` at the end).
  - **Note**: the intermediate `leafCount/spineCount/uplinksNeeded` numbers
    are computed but NOT attached to the returned `BOMDevice[]` — this is
    why `configgen.ts` re-derives uplink/pairing info from `idx`/`hostname`
    rather than reading it off the device. (Tracked as backlog item A5 —
    "topology-driven uplink counts" — in `CLAUDE.md` §22.)

### BOM summary
- **`BOMSummaryRow`** — one row per unique `model` (`unitCost, qty,
  totalCost, speed, ports, uplinks, features, detail`).
- **`buildBOM(state): { devices, summary, grandTotal }`** — calls
  `buildDeviceList()`, groups by `model` into `BOMSummaryRow`s, sums
  `grandTotal`.
- `export { SCALE_DEFS }` — re-exported for UI display (e.g. scale picker
  showing device counts).

### Cabling
- `CABLE_SPECS: CableSpec[]` — DAC (≤5m), AOC (≤30m), MPO (≤100m), LC-LC
  (≤10km) with `unitCost` + `costPerM`, each tagged with supported speeds.
- `CABLE_PRIORITY = { DAC: 0, AOC: 1, MPO: 2, 'LC-LC': 3 }` — cheaper/shorter
  options preferred.
- **`selectCable(distM, speed): CableSpec`** — filters specs that support
  `speed` and `maxDist >= distM`, returns the lowest-priority (cheapest)
  match; falls back to LC-LC if nothing matches.
- `LAYER_CONNECTS: {from, to, key}[]` — defines which subLayers connect to
  which, and which `linkDistances` key governs the run length:
  `spine↔leaf (spine-leaf)`, `core↔distribution (core-dist)`,
  `distribution↔access (dist-access)`, `wan-edge↔distribution|spine
  (wan-edge)`, `firewall↔distribution (wan-edge)`, `firewall↔spine
  (spine-leaf)`.
- **`buildCabling(devices, linkDistances): CableLink[]`** — for each
  `LAYER_CONNECTS` entry where both layers have devices, picks a cable via
  `selectCable()`, computes `quantity = froms.length * tos.length` and
  `totalPrice = (unitCost + costPerM*distM) * quantity`. **Note**: this is
  an aggregate "N×layer to M×layer" link, not per-pair cabling — it doesn't
  know about HA pairing.

### Optics
- `OPTIC_CATALOG: OpticSpec[]` — SFP+/SFP28/QSFP28/QSFP-DD across
  10G/25G/100G/400G, multiple reaches (SR/LR/PSM4/FR4) with `priceUSD`.
- **`buildOptics(devices, linkDistances): OpticsEntry[]`** — calls
  `buildCabling()`, then for each cable link picks the cheapest optic
  matching `speed` and `reachM >= lengthM`. `quantity = link.quantity * 2`
  (one optic per end), `totalPrice = priceUSD * quantity`.

---

## Frontend — `lib/configgen.ts` (config generation)

`frontend/src/lib/configgen.ts` (~2030 lines). Generates per-device CLI
configs. Header comment encodes the **5 design rules** enforced by 42+
Vitest tests in `frontend/src/test/configgen.test.ts` (run `cd frontend &&
npm test` after ANY change here):

1. One self-contained block per device — `mgmtBlock()` called exactly once,
   no "POLICY BLOCKS appended" duplication.
2. IS-IS underlay for DC/GPU spine-leaf; OSPF for campus/WAN. Never both.
3. All credentials use `<CHANGE-ME-*>` placeholders.
4. Firewall roles get real zone-based/vendor-native firewall configs, not
   router configs.
5. GPU QoS = ECN + WRED + PFC priority-3 + DCQCN buffer carving.

### Shared helpers
- **`mgmtBlock(hostname, mgmtVlan = 10): string`** — the ONE management
  block: hostname, domain/DNS, security hardening (`no ip http server`,
  `service password-encryption`, login block-for), banner, MGMT-ACL,
  local + TACACS+ AAA (`TACACS-PRIMARY`/`TACACS-SECONDARY` servers,
  `TACACS-GROUP`), SNMPv3-only (no community strings), authenticated NTP,
  syslog, SSHv2 + `line vty` ACL — all sourced from `Vlan${mgmtVlan}`. Used
  by `ciscoFirewallConfig`, `iosxeWanConfig`, `iosxeCampusConfig`,
  `genericConfig`.
- **`haPairInfo(dev, idx): { pairId, isPrimary, peerHostname, domainId }`**
  *(added 2026-06-11, Enterprise Upgrade A1)* — derives HA-pair metadata
  purely from `idx` and `dev.hostname`, matching `generateHostnames()`'s
  pairing convention:
  - `pairId = Math.floor(idx/2) + 1` — shared by idx 0&1, 2&3, ...
  - `isPrimary = idx % 2 === 0` — even idx = primary/active/root.
  - `peerHostname` — flips the trailing `01`↔`02` on `dev.hostname` (e.g.
    `IAD-LEAF-A01` ↔ `IAD-LEAF-A02`).
  - `domainId` — `dev.hostname` with the trailing `01`/`02` stripped (e.g.
    `IAD-LEAF-A`) — a stable ID shared by both pair members, used for vPC
    domain numbers / MLAG domain-id / STP comments.
  - Used by `nxosLeafConfig`, `aristaLeafConfig`, and `iosxeCampusConfig`.

### NX-OS (Cisco) — DC/GPU spine-leaf
- **`nxosSpineConfig(dev, idx, isGpu): string`** — `spineAsn = 65000`
  (constant), `routerId = 10.255.1.${idx+1}`, `isisNet =
  49.0001.0102.5500.${pad(idx+1,4)}.00`. IS-IS L2-only underlay, BGP EVPN
  with route-reflector `template peer LEAF-RR-CLIENT`, NX-API gRPC telemetry
  block (`destination-group`/`sensor-group`/`subscription`), QoS via
  `nxosGpuQoS()` or `nxosStdQoS()`.
- **`nxosLeafConfig(dev, idx, isGpu): string`** — `leafAsn = 65001+idx`,
  `routerId = 10.255.2.${idx+1}`, `vtepIp = 10.254.0.${idx+1}`, `isisNet =
  49.0001.0102.5501.${pad(idx+1,4)}.00`. IS-IS underlay, BGP EVPN
  `template peer SPINE-RR`, VXLAN `interface nve1` (VNI 10010 + L3VNI
  50000), NX-API telemetry. **vPC block** (post Enterprise Upgrade A1): `vpc
  domain ${pairId}` (shared by the HA pair), `role priority` 8192
  (primary)/16384 (secondary), `peer-switch`, `peer-keepalive destination
  <CHANGE-ME-${peerHostname}-mgmt-ip> ...`, `peer-gateway`, `ip arp
  synchronize`, `auto-recovery`.
- **`nxosStdQoS(): string`** / **`nxosGpuQoS(): string`** — standard 4-class
  DSCP QoS vs full RoCEv2 QoS (PFC priority-3 lossless `pause no-drop`,
  RDMA class `bandwidth percent 60`, ECN `congestion-control ecn` +
  `random-detect` on lossy queues, `hardware qos pfc-watchdog on`, DCQCN).

### Arista EOS — DC/GPU spine-leaf
- **`aristaSpineConfig(dev, idx, isGpu): string`** — `asn = 65000`,
  `routerId = 10.255.1.${idx+1}`, `isisNet = 0101.0255.000${idx+1}`.
  `service routing protocols model multi-agent`, `router isis UNDERLAY`
  (level-2, `fast-reroute ti-lfa`), BGP EVPN `peer-group LEAF-RR-CLIENTS`
  (route-reflector-client, `bfd`). QoS via `aristaGpuQoS()` if GPU.
- **`aristaLeafConfig(dev, idx, isGpu): string`** — `leafAsn = 65001+idx`,
  `routerId = 10.255.2.${idx+1}`, `vtepIp = 10.254.0.${idx+1}`, `isisNet =
  0101.0255.000${idx+101}`. BGP `peer-group SPINE-RR` with `bfd`, VXLAN
  `interface Vxlan1` (`vxlan vlan 10 vni 10010`). **MLAG block** (post
  Enterprise Upgrade A2, previously absent): `vlan 4094`/`interface Vlan4094`
  for peer L3 peering, `interface Port-Channel${pairId}00` peer-link,
  `mlag configuration` with `domain-id ${domainId}MLAG${pairId}`,
  `peer-address <CHANGE-ME-${peerHostname}-mlag-peer-ip>`, `peer-link
  Port-Channel${pairId}00`.
- **`aristaGpuQoS(): string`** — PFC priority 3 RoCEv2 (`pfc enable`, `pfc
  priority 3 no-drop`), ECN on lossy queues.

### Juniper JunOS
- **`juniperLeafConfig(dev, idx): string`** — set-style config, used for
  BOTH `leaf` and `spine` (no separate Juniper spine generator exists
  yet). `leafAsn = 65001+idx`, `lo0ip = 10.255.2.${idx+1}`. IS-IS level 2
  with auth key, BGP group `SPINE-RR` (external), EVPN/VXLAN with
  `vrf-target target:65000:1`.

### Firewalls
- **`ciscoFirewallConfig(dev, idx): string`** — IOS-XE Zone-Based Firewall:
  `zone security {OUTSIDE,DMZ,INSIDE,MGMT}`, ACLs, `class-map`/`policy-map
  type inspect`, `zone-pair security`, NAT, IP SLA tracking for HA
  failover. Calls `mgmtBlock(dev.hostname, 10)` once.
- **`paloAltoFirewallConfig(dev, idx): string`** — PAN-OS `set` commands:
  zones, security rules (INSIDE→OUTSIDE w/ threat profiles, OUTSIDE→DMZ,
  default-deny), NAT, `set profiles {virus,spyware,vulnerability}`,
  commented-out HA config.
- **`fortinetFirewallConfig(dev, idx): string`** — FortiOS config-style:
  system global hardening, admin, interfaces (mgmt/port1/port2), static
  route, DNS, syslog, NTP, SNMPv3, firewall policies (Allow-Outbound,
  Deny-Inbound), IPS sensor.

### WAN
- **`iosxeWanConfig(dev, idx): string`** — Cisco WAN-edge ROUTER (not a
  campus switch — see "Cisco IOS-XE Campus" below for the distinction):
  OSPF underlay with `passive-interface default` + explicit `no
  passive-interface` on WAN/LAN ports, eBGP to ISP with `prefix-list
  PL-OUT/PL-IN`, commented-out IPSec/DMVPN stub, QoS shaping `policy-map
  PM-WAN-SHAPING`. Calls `mgmtBlock(dev.hostname, 10)`.

### Cisco IOS-XE Campus (Distribution / Access) — *added 2026-06-11, Enterprise Upgrade A3*
- **`iosxeCampusConfig(dev, idx, appTypes): string`** — replaces the old
  (incorrect) dispatch to `iosxeWanConfig` for campus
  `distribution`/`access` devices. Branches on `dev.subLayer`:
  - **Distribution**: `mgmtBlock(dev.hostname, 99)`, VLANs (10=DATA, 20=VOICE
    if `appTypes` includes `'voice'`, 99=MGMT-NATIVE). STP: primary
    (`isPrimary`) gets `spanning-tree vlan 1-4094 priority 4096` (root),
    secondary gets `8192` (secondary-root). HSRPv2 SVIs on Vlan10 (+Vlan20 if
    voice): primary `standby <id> priority 110`, secondary `priority 90`,
    both `preempt`/`track 1 decrement 20`. OSPF underlay (`router ospf 1`,
    no IS-IS — rule 2). If `appTypes` includes `'voice'` or `'video'`: `ip
    igmp snooping` + `ip igmp snooping querier` + per-VLAN querier address.
  - **Access**: `mgmtBlock(dev.hostname, 99)`, same VLAN set. STP always
    `priority 32768` (never root) + `spanning-tree portfast bpduguard
    default`. DHCP snooping + port-security on edge ports
    (`GigabitEthernet1/0/1-${ports-2}`, voice VLAN added if applicable).
    IGMP snooping (no querier) if voice/video. Last 2 ports form
    `Port-channel${pairId}` trunk uplink to the distribution HA pair (MEC).
  - Both branches use `haPairInfo()` for `pairId`/`isPrimary`/`peerHostname`.

### Other vendor switches (DC/GPU spine-leaf)
- **`dellOs10SwitchConfig(dev, idx, isGpu)`** — Dell OS10, BGP-unnumbered
  EVPN (`advertise-all-vni`); spine peers `ethernet1/1/1-1/1/32 peer-group
  LEAVES`; leaf has two `<CHANGE-ME-spine{1,2}-ip>` neighbors;
  `interface virtual-network 1 / vxlan-vni 10001`. If GPU: full DCB/PFC/ECN
  block (`qos-map dscp-tc RDMA-DSCP-MAP`, `dcb-map RDMA-LOSSLESS`),
  interface ranges sized from `dev.ports`.
- **`arubaOsCxConfig(dev, idx)`** — ArubaOS-CX. Spine/distribution →
  BGP+EVPN+VXLAN; access → VLANs (Mgmt/Data/Voice) + PoE +
  `bpduguard`/`admin-edge` on `1/1/1-1/1/${dev.ports}`.
- **`nvidiaSpectrumConfig(dev, idx, isGpu)`** — Cumulus Linux:
  `/etc/network/interfaces` + FRR `frr.conf` BGP-unnumbered EVPN (spine:
  `neighbor swp1-swp${ports} interface peer-group FABRIC`; leaf: last 2
  `swp` ports to spines). GPU PFC/ECN comments.
- **`extremeExosConfig(dev, idx)`** — EXOS. Spine → BGP+EVPN (VNI 10001);
  access → VLANs+PoE+STP edge-safeguard.
- **`genericConfig(dev)`** — fallback: `mgmtBlock()` + TODO comment.

### Dispatch
- **`generateConfig(dev: BOMDevice, idx: number, useCase: UseCase|'' = '',
  appTypes: AppType[] = []): string`** *(signature extended 2026-06-11 to add
  `appTypes`)* — the big if/else dispatcher by `(dev.vendor, dev.subLayer)`.
  `needsRoce = isGpu || ((vendor==='Dell EMC'||vendor==='NVIDIA') &&
  useCase==='dc')` — Dell/NVIDIA DC fabrics always get lossless QoS;
  Cisco/Arista only when `useCase==='gpu'`. Cisco
  `distribution`/`access` → `iosxeCampusConfig(dev, idx, appTypes)`.
- **`generateAllConfigs(devices, useCase = '', policyBlocks = [], appTypes =
  [])`** *(signature extended 2026-06-11)* — maps `generateConfig()` over all
  devices, then runs `applyPolicies()` (from `lib/policies.ts`) if
  `policyBlocks.length`. Called from `Step3Config.tsx` with `appTypes` from
  the store.

---

## Frontend — `lib/policies.ts` / `lib/customPolicy.ts`

### `lib/policies.ts`
**Purpose:** Client-side mirror of `backend/policies/*.py` — a catalog of ~21 platform-aware/role-aware enterprise config policies that get appended as overlay sections to generated device configs.

**`POLICY_CATALOG: PolicyDef[]`** — each entry:
```ts
interface PolicyDef {
  id: string; label: string; icon: string
  category: 'Management'|'Security'|'L2 Switching'|'L3 Routing'|'QoS & Voice'
  description: string
  appliesTo: string[]      // device subLayer/role match list, '*' = all
  useCases?: UseCase[]      // optional restriction
  render: (dev: BOMDevice, useCase: UseCase|'') => string | null
}
```

**Policies by category (21 total):**
- **Management (6):** `ntp` (NTP MD5 auth), `snmp` (SNMPv3 auth/priv, no v2c), `syslog` (remote syslog from Loopback0), `lldp` (LLDP on, CDP off for Cisco), `banner` (login warning banner), `archive` (Cisco-only config archive/rollback)
- **Security (7):** `aaa` (TACACS+ AAA), `ssh` (SSHv2 hardening, no Telnet), `copp` (Control-Plane Policing, L3 roles only — Cisco ACL/class-map or Arista built-in CoPP), `dot1x` (802.1X+MAB IBNS 2.0, access roles, campus/multisite only, Cisco only), `dhcp-snooping` (DHCP snooping+DAI+IPSG, edge roles, campus/multisite/dc, Cisco only), `port-security` (sticky MAC limiting, access roles, Cisco only), `storm-control` (broadcast/multicast/unicast storm suppression, edge roles), `mgmt-acl` (VTY/SNMP ACL restricted to mgmt subnet)
- **L2 Switching (2):** `stp-harden` (Rapid-PVST + BPDU Guard/Root Guard/Loop Guard, edge roles), `vlan-policy` (prune unused VLANs, dedicated native VLAN, disable DTP, Cisco only)
- **L3 Routing (3):** `bgp-policy` (prefix-lists, route-maps, max-prefix, dampening, routing roles), `igp-auth` (OSPF/IS-IS key-chain auth — IS-IS for `dc`/`gpu` use cases, OSPF otherwise), `static-track` (floating static + IP SLA tracking, wan-edge/distribution/border, wan/campus/multisite/multicloud, Cisco only)
- **QoS & Voice (2):** `qos` (DSCP marking/queuing for access/distribution/leaf/spine — skipped entirely for `gpu` use case, Cisco only), `voice` (voice VLAN + LLDP-MED + PoE on access ports, campus/multisite, Cisco only)

**Key exports:**
- `applicablePolicies(dev: BOMDevice, useCase: UseCase|'', selectedIds: string[]): PolicyDef[]` — filters `POLICY_CATALOG` to entries whose `id` is in `selectedIds`, whose `useCases` (if set) include the current use case, whose `appliesTo` matches the device's `subLayer`/`role` (via `roleIn()`), and whose `render(dev, useCase)` returns non-null (i.e., applicable to this vendor/platform)
- `applyPolicies(baseConfig: string, dev: BOMDevice, useCase: UseCase|'', selectedIds: string[]): string` — if `selectedIds` empty or no applicable policies, returns `baseConfig` unchanged; otherwise appends a `POLICY OVERLAY` banner followed by one `! ====== POLICY: <LABEL> ======` block per applicable policy (label uppercased, includes description comment + rendered CLI)
- `policyByCategory(): Record<PolicyCategory, PolicyDef[]>` — groups catalog by category for UI rendering
- `POLICY_CATEGORIES: PolicyCategory[]` — ordered list `['Management','Security','L2 Switching','L3 Routing','QoS & Voice']`

**Notes:** Selected policy IDs persist in `useAppStore().policyBlocks`. Vendor checks use `isCisco/isArista/isJuniper` helpers based on `dev.vendor === 'Cisco'/'Arista'/'Juniper'`. Role matching uses `roleIn(d, roles)` checking both `d.subLayer` and `d.role` (lowercased, substring match) against role-group constants `L3_ROLES`, `ACCESS_ROLES`, `EDGE_ROLES`, `ROUTING_ROLES`.

---

### `lib/customPolicy.ts`
**Purpose:** Client-side rule engine (M-55) — demo-mode counterpart to `backend/policies/user_rule_engine.py`. Parses a constrained YAML-like rule format and evaluates each rule's `when` expression against the current intent + generated configs.

**Rule format:**
```yaml
rules:
  - id: "CUSTOM-01"
    severity: "error"   # info|warning|error|block → INFO|WARN|FAIL|BLOCK
    message: "..."
    fix: "..."
    when: "<field> <op> <value>"
```

**Key types:**
- `RuleSeverity = 'INFO'|'WARN'|'FAIL'|'BLOCK'`
- `ParsedRule { id, severity, message, fix, when, lineNo }`
- `RuleFinding { id, severity, message, fix }`
- `EvalResult { ruleCount, firedCount, violations[], warnings[], infos[], gateStatus, evaluatedRules[] }`
- `ParseOutcome { ok, rules, errors }`
- `EvalContext { intent: Record<string,unknown>, configBlob: string }`

**Key exports:**
- `parseRules(yamlText: string): ParseOutcome` — line-by-line parser (no YAML dependency); requires top-level `rules:` key; each `- id:` starts a new rule; subsequent indented `key: value` lines populate `severity/message/fix/when` via `assignField()`; collects errors for missing `id`/`severity`/unknown ops
- `evalWhen(expr: string, ctx: EvalContext): boolean` — evaluates `"<field> <op> <value>"`. Field supports dotted-path traversal into `ctx.intent` via `getField()`. Supported ops: `eq, neq, contains, not_contains, in, not_in, gt, lt, gte, lte, is_empty, is_not_empty, config_contains, config_not_contains` (last two check `ctx.configBlob`)
- `evaluateCustomPolicy(yamlText: string, ctx: EvalContext): EvalResult & {parseErrors: string[]}` — parses then evaluates every rule; rules with no `when` never fire (documentation-only); buckets fired rules into `violations` (FAIL/BLOCK), `warnings` (WARN), `infos` (INFO); computes `gateStatus`: `BLOCK` if any BLOCK violation, else `FAIL` if any violation, else `WARN` if any warning, else `PASS`

**Notes:** `safeEval()` wraps `evalWhen` in try/catch (returns `false` on error). Used by Deploy Pipeline policy gate alongside the built-in `CONSTRAINTS` (R-01..R-06) — `customPolicyRules` text comes from `useAppStore().customPolicyRules`.

---

## Frontend — `lib/products.ts` / `lib/utils.ts`

### `lib/products.ts`
**Purpose:** Static hardware product catalog (31 SKUs) used by `lib/bom.ts` for BOM generation and Step 3 product selection.

**Structure:** `PRODUCTS: Product[]` — 31 entries using the `Product` interface from `types/index.ts`:
```ts
interface Product {
  id: string; model: string; vendor: string; subLayer: string
  ports: number; uplinks: number; speed: string; asic: string
  powerW: number; priceUSD: number; features: string[]
  useCases: UseCase[]; detail: string
}
```

**Vendor/category coverage:**
- Spine/Core: Cisco Nexus 9336C-FX2 / 9364C-GX, Arista 7800R3, Juniper QFX10002-72Q, Dell Z9332F, Aruba CX 10000, NVIDIA Spectrum SN5600, Extreme 8720
- Leaf/ToR: Cisco Nexus 93180YC-FX / 9332C, Arista 7050CX3-32S, Juniper QFX5120-48Y, Dell S5248F, NVIDIA Spectrum SN4600C, Extreme 8520
- Distribution/Access (campus): Catalyst 9500-48Y4C, 9300L-48T-4G, 9200-48P, FortiSwitch T1024E/148F-POE, Aruba CX 6400/6300M, Extreme 5720/5420
- WAN/Edge: ASR 1002-HX, Catalyst SD-WAN vEdge 2000
- Aviatrix cloud gateways: Aviatrix Gateway (c5.xlarge), Aviatrix Transit GW (c5.2xlarge)
- Firewalls: Firepower 4145 NGFW, PA-5260 NGFW, FortiGate 2600F

**Other exports:**
- `LAYER_PAIRS: Record<UseCase, string[]>` — maps each use case to its relevant cabling-layer pair keys (e.g. `dc: ['spine-leaf']`, `campus: ['distribution-access','core-distribution']`, `multicloud/aviatrix: ['cloud-gw','cloud-transit']`)
- `productsByUseCase(useCase: UseCase): Product[]` — filters `PRODUCTS` where `useCases.includes(useCase)`

---

### `lib/utils.ts`
**Purpose:** Small generic utility helpers used across the UI.

**Key exports:**
- `cn(...inputs: ClassValue[]): string` — merges Tailwind class names via `clsx` + `tailwind-merge`
- `formatUSD(n: number): string` — formats a number as USD currency (no decimals)
- `formatUptime(seconds: number): string` — converts seconds to `"Nd"` / `"Nh"` / `"Ns"` (days > hours > seconds)
- `downloadCSV(filename, content)` — triggers browser download of a CSV blob
- `downloadText(filename, content)` — triggers browser download of a plain-text blob

---

## Frontend — `store/useAppStore.ts`

### `store/useAppStore.ts`
**Purpose:** Central Zustand 5 store (with `persist` middleware) holding the entire wizard intent state — single source of truth for Steps 1–6.

**Persist config:** `persist(..., { name: 'netdesign-app-state' })` — persists the **entire** `AppStore` (all of `AppState` + actions are stored in the closure, but only state fields serialize) to `localStorage` under key `netdesign-app-state`.

**State fields (grouped):**

- **Navigation:** `step: number` (1–6, default 1)
- **Step 1 — Use case / org:**
  `useCase: UseCase | ''`, `appTypes: AppType[]`, `siteName`, `siteCode`, `scale: Scale` (default `'small'`), `redundancy: Redundancy` (default `'dual'`), `compliance: Compliance[]`, `linkDistances: Record<string, number>` (defaults: `spine-leaf:100`, `dist-access:50`, `core-dist:200`, `wan-edge:5000`), `orgName`, `orgSize`, `budgetTier`, `vendorPrefs: string[]`, `industry`, `primaryContact`, `customPolicyRules: string` (M-55), `activeDeployTab: string` (default `'deploy'`), `theme: 'dark'|'light'` (default `'dark'`)
- **Step 2 — Network requirements:**
  `trafficPattern` (default `'ew'`), `totalEndpoints` (default 500), `bandwidthPerServer` (default `'25G'`), `oversubscription` (default 3), `underlayProtocol` (default `'ospf'`), `overlayProtocols: string[]`, `protoFeatures: string[]`, `firewallModel`, `redundancyModel` (default `'ha'`), `numSites` (default 1), `vpnType`, `nacOptions: string[]`, `additionalNotes`, `policyBlocks: string[]` (selected `POLICY_CATALOG` IDs)
- **M-11 Multi-cloud fields:** `cloudProviders: string[]`, `dcTopology: DcTopology`, `coloProvider`, `dcEdgeVendor`, `bgpAsn`, `orgCidr`, `aviatrixOptions: string[]`
- **Design outputs:** `devices: BOMDevice[]`, `cabling: CableLink[]`, `optics: OpticsEntry[]`, `configs: Record<string,string>`, `ztpConfig: {}`, `policies: []`
- **Scripts/outputs:** `preCheckScript`, `postCheckScript`, `prometheusAlerts`, `grafanaDashboard: {}`, `ansiblePlaybook: {}`
- **Demo topology:** `demoTopologyId: string`

**Key actions/setters (1 line each):**
- `setStep(n)` — set step directly
- `nextStep()` / `prevStep()` — clamp step to [1,6]
- `setUseCase(uc)` — sets useCase **and clears `configs`** (forces regen)
- `setAppTypes`, `setSiteName`, `setSiteCode`, `setRedundancy`, `setCompliance` — plain setters
- `setScale(scale)` — sets scale **and clears `configs`**
- `setLinkDistance(key, metres)` — merges into `linkDistances` map
- `setOrgName/setOrgSize/setBudgetTier/setIndustry/setPrimaryContact` — plain setters
- `setVendorPrefs(prefs)` — sets vendorPrefs **and clears `configs`** (so Step 3 regenerates for new hardware)
- `setCustomPolicyRules(rules)` — M-55 custom policy YAML text
- `setActiveDeployTab(tab)` — Step 6 sidebar deep-nav
- `setTheme(theme)` / `toggleTheme()` — dark/light toggle
- Step 2 setters: `setTrafficPattern`, `setTotalEndpoints`, `setBandwidthPerServer`, `setOversubscription`, `setUnderlayProtocol`, `setOverlayProtocols`, `setProtoFeatures`, `setFirewallModel`, `setRedundancyModel`, `setNumSites`, `setVpnType`, `setNacOptions`, `setAdditionalNotes` — all plain setters
- M-11 setters: `setCloudProviders`, `setDcTopology`, `setColoProvider`, `setDcEdgeVendor`, `setBgpAsn`, `setOrgCidr`, `setAviatrixOptions` — plain setters
- `setDevices/setCabling/setOptics/setConfigs` — write design output arrays/maps
- `setPreCheckScript/setPostCheckScript/setPrometheusAlerts` — write generated scripts
- `setPolicyBlocks(blocks)` — set selected policy IDs (used by `lib/policies.ts`)
- `loadDemoTopology(t: DemoTopology)` — bulk-loads a `data/demoTopologies.ts` entry: sets useCase/scale/site fields/devices/cabling/optics, clears `configs`, sets `demoTopologyId`, and **jumps to step 3**
- `reset()` — restores `DEFAULT_STATE` entirely

**Notes:** Any change to vendor, use case, or scale wipes `configs` so Step 4 regenerates configs lazily. `activeDeployTab` is the mechanism that lets `Sidebar.tsx` deep-link into Step 6 sub-tabs (per CLAUDE.md §17).

---

## Frontend — `api/client.ts` / hooks

### `api/client.ts`
**Purpose:** Typed fetch + WebSocket wrapper providing the raw async functions consumed by TanStack Query hooks; reads backend URL/token/live-mode from `localStorage['nd_backend_settings']`.

**Key exports:**
- `getBackendUrl(): string` — reads `backendUrl` from settings (default `''`)
- `getToken(): string` — reads bearer token
- `isLiveMode(): boolean` — true only if `liveMode` flag set **and** `backendUrl` non-empty
- `saveSettings(patch: Partial<BackendSettings>)` — merges into `localStorage['nd_backend_settings']`
- `login(username, password): Promise<{token, role}>` — POST `{baseUrl}/api/auth/token`; saves token via `saveSettings`
- `fetchAlerts(): Promise<Alert[]>` — GET `/api/alerts`
- `runRca(symptom, affectedDevices, designId?): Promise<RcaHypothesis[]>` — POST `/api/rca/analyze` with `{symptom, affected_devices, design_id}`
- `generateConfigs(state: DesignState): Promise<{configs, generated_at}>` — POST `/api/generate-configs`
- `runPreChecks(req: DeployRequest): Promise<CheckResponse>` — POST `/api/pre-checks`
- `runPostChecks(req: DeployRequest): Promise<CheckResponse>` — POST `/api/post-checks`
- `deploy(req: DeployRequest): Promise<DeployResponse>` — POST `/api/deploy`
- `listDesigns(uc?): Promise<{designs: Design[]}>` — GET `/api/designs[?use_case=]`
- `fetchDesign(id): Promise<Design>` — GET `/api/designs/{id}`
- `createDesign(body): Promise<Design>` — POST `/api/designs`
- `updateDesign(id, body): Promise<Design>` — PUT `/api/designs/{id}`
- `deleteDesign(id): Promise<null>` — DELETE `/api/designs/{id}`
- `listDeployments(designId?): Promise<{deployments: Deployment[]}>` — GET `/api/deployments[?design_id=]`
- `rollbackDeployment(id): Promise<{ok}>` — POST `/api/deployments/{id}/rollback`
- `openDeployStream(deploymentId, onEvent, onClose?, onError?): WebSocket` — opens `ws(s)://{base}/ws/deploy/{deploymentId}`, parses JSON `DeployEvent` messages, ignores `{type:'ping'}` keepalives

**Notes:** Internal `request<T>(method, path, body?)` builds URL as `getBackendUrl() + path` (or relative path if no backend URL configured), attaches `Authorization: Bearer <token>` if present, throws `Error(detail || 'HTTP <status>')` on non-OK responses.

---

### Hooks (`hooks/useAlerts.ts`, `useChecks.ts`, `useMonitoring.ts`, `useRca.ts`, `useTopology.ts`, `useZTP.ts`)

#### `hooks/useAlerts.ts`
- `useAlerts(enabled = true)` — `useQuery({ queryKey: ['alerts'], queryFn: fetchAlerts, refetchInterval: 30_000, enabled: enabled && isLiveMode() })`. Calls `GET /api/alerts` (via `api/client.ts`). Returns `Alert[]`. **No client-side simulation** — query is simply disabled (`enabled: false`) when `isLiveMode()` is false, so it returns no data in demo mode.

#### `hooks/useChecks.ts`
- `useRunChecks(phase: 'pre'|'post')` — `useMutation<ChecksResult, Error, ChecksRequest>` where `ChecksRequest = { fail_devices?: Record<string, string[]> }`. `mutationFn` POSTs to `/api/checks/${phase}` (relative URL, own `postJSON` helper — does NOT use `api/client.ts`). Returns `ChecksResult`.
- **Fallback:** Consumers (`Step6Deploy.tsx`, `Step5Checks.tsx`) call `runPre`/`runPost`; on error (or in demo mode) `Step6Deploy.tsx` calls `simulateChecksResult(simDevices, phase, failCheckDevice, failCheck)` (defined locally in `Step6Deploy.tsx`, not exported from hooks) to produce the same `ChecksResult` shape — 8–12 checks/device, ~85/10/5% PASS/WARN/FAIL distribution.

#### `hooks/useMonitoring.ts`
- `useMonitoringPoll(enabled = false)` — `useQuery<MonitoringResult>({ queryKey: ['monitoring','poll'], queryFn: GET '/api/monitoring/poll', enabled, refetchInterval: enabled ? 15_000 : false })`
- `useMetricsSummary()` — reads `isLive` from `useBackendMode()`; `useQuery<MetricsSummary>({ queryKey: ['metrics-summary'], queryFn: GET '/api/metrics/summary', refetchInterval: 15_000, enabled: isLive })`
- `usePollMonitoring()` — `useMutation<MonitoringResult, Error, MonitoringRequest>` where `MonitoringRequest = { fail_devices?: Record<string,string[]> }`; if `fail_devices` non-empty, POSTs `/api/monitoring/poll` with body, else GETs it.
- **Fallback:** `Step6Deploy.tsx` and `Step6Monitor.tsx` call `usePollMonitoring().mutate`; on error/demo, `Step6Deploy.tsx` falls back to local `simulateMonitoringMetrics(simDevices, tick)` returning a `MonitoringResult`-shaped object, polled on a local interval (`monitorTick`).

#### `hooks/useRca.ts`
- `useRunRca()` — `useMutation<RcaHypothesis[], Error, RcaRequest>` where `RcaRequest = { symptom, devices: string[], designId? }`; `mutationFn` calls `runRca(symptom, devices, designId)` from `api/client.ts` → POST `/api/rca/analyze`. Returns `RcaHypothesis[]`. No simulation fallback defined in this file (consumed by `RcaPanel`/`TroubleshootingEngine`).

#### `hooks/useTopology.ts`
- `useTopologySummary()` — `useQuery<TopologySummary>({ queryKey: ['topology','summary'], queryFn: GET '/api/topology', staleTime: 30_000 })`
- `useTopologyDevices()` — `useQuery<TopologyDevice[]>({ queryKey: ['topology','devices'], queryFn: GET '/api/topology/devices', staleTime: 30_000 })`
- No simulation fallback in this file; both use a local `fetchJSON` helper (relative URLs, not `api/client.ts`).

#### `hooks/useZTP.ts`
- `useRunZTP()` — `useMutation<ZTPResult, Error, ZTPRequest>` where `ZTPRequest = { fail_device?, fail_at? }`; POSTs `/api/ztp/run` via local `postJSON`. Returns `ZTPResult`.
- **Fallback:** `Step6Deploy.tsx`/`Step4ZTP.tsx` call `runZTP`; on error/demo, `Step6Deploy.tsx` falls back to local `simulateZTPResult(simDevices, failDevice, failAt)` — implements the state machine described in CLAUDE.md §11 (`REGISTERED → ... → ONLINE | FAILED`), returns `ZTPResult` with per-device events + summary.

**General note:** All three simulate* functions (`simulateMonitoringMetrics`, `simulateZTPResult`, `simulateChecksResult`) are defined **inline in `pages/Step6Deploy.tsx`** (lines ~883, ~968, ~1030 respectively), not in the `hooks/` or `lib/` directories — hooks themselves contain no simulation logic, just live-API mutation/query wrappers.

---

## Frontend — `data/demoTopologies.ts` / `BackendToggle.tsx`

### `data/demoTopologies.ts`
**Purpose:** Catalog of 5 pre-built demo topologies that can be loaded via `useAppStore().loadDemoTopology()`, jumping straight to Step 3 with populated BOM/cabling/optics.

**Structure:** `DEMO_TOPOLOGIES: DemoTopology[]` — 5 entries, each containing `id, label, icon, useCase, scale, description, siteCode, siteName, orgName, trafficPattern, underlayProtocol, totalEndpoints, devices: BOMDevice[], cabling: CableLink[], optics: OpticsEntry[]`.

**Entries:**
1. `dc-medium` — "Data Center Leaf-Spine": Cisco NX-OS, 2 spines (Nexus 9336C-FX2) + 4 leaves (93180YC-FX) + 2 PA-5260 firewalls, IS-IS underlay, 500 endpoints, IAD/Ashburn DC1
2. `gpu-large` — "AI/GPU Cluster Fabric": Cisco 400G, 2 spines (9364C-GX) + 4 GPU leaves (9332C, RoCEv2/DCQCN/PFC-Watchdog) + 2 PA-5260 firewalls, IS-IS, 256 endpoints, SJC/San Jose GPU Cluster
3. `campus-medium` — "Enterprise Campus": Cisco IOS-XE, 2 cores (Catalyst 9500-48Y4C) + 4 access (9300L-48T-4G, PoE+/802.1X) + 1 Firepower 4145, OSPF, 800 endpoints, NYC HQ Campus
4. `wan-small` — "WAN Edge / SD-WAN": 2x ASR 1002-HX + 2x Catalyst SD-WAN vEdge 2000, OSPF, 200 endpoints, CHI WAN Hub
5. `multisite-medium` — "Multi-Site DCI": Arista 7050CX3-32S spines + Juniper QFX5120-48Y leaves + 2 PA-5260 firewalls, IS-IS, 600 endpoints, LON Multi-Site DCI

Helper builders: `spineLeafCabling(spines, leaves, speed, cableType, pricePerUnit)` generates full-mesh `CableLink[]`; `basicOptics(linkGroup, formFactor, speed, qty, priceUSD, vendor, partNumber)` builds an `OpticsEntry`.

**Other export:** `getDemoTopology(id: string): DemoTopology | undefined` — lookup by id.

---

### `components/BackendToggle.tsx`
**Purpose:** Provides the app-wide live/demo backend mode context plus the UI toggle widget shown in the header.

**Key exports:**
- `useBackendMode(): { isLive: boolean; baseUrl: string }` — `useContext(BackendModeContext)`; default context value is `{ isLive: false, baseUrl: 'http://localhost:8000' }`
- `BackendToggleProvider({ children, value })` — wraps children in `BackendModeContext.Provider`; mounted in `App.tsx` with the actual `{isLive, baseUrl}` state
- `BackendToggle({ isLive, baseUrl, onToggle, onUrlChange })` — controlled UI component: renders a `LIVE`/`SIM` badge, a pill switch (`onToggle(!isLive)`), and (when live, on `sm+` screens) an editable backend-URL field that commits via `onUrlChange(trimmedUrl)` on Enter/blur, reverting on Escape

**Notes:** `App.tsx` owns the actual `isLive`/`baseUrl` state (likely synced with `localStorage['nd_backend_settings']` via `api/client.ts`'s `saveSettings`/`loadSettings`) and passes it both to `BackendToggleProvider` (for `useBackendMode()` consumers like `useMonitoring.ts`, `Step6Deploy.tsx`, `TroubleshootingEngine.tsx`) and to the `BackendToggle` UI component. `isLiveMode()` in `api/client.ts` is a separate, localStorage-only check used by `useAlerts.ts` — these two "live mode" signals are not strictly the same code path, so be careful when reasoning about demo vs. live behavior across files.

---

## Frontend — Pages (Step1–Step6)

### Routing / Page-Mounting Structure (confirmed via `App.tsx`)

`frontend/src/App.tsx` maps `useAppStore().step` (1-6) to page components via `WizardContent`:

```typescript
case 1: return <Step1UseCase onBack={onBackToLanding} />
case 2: return <Step2Requirements />
case 3: return <Step2Design />          // ⚠ filename says "Step2" but this is Step 3 (BOM)
case 4: return <Step4NetworkDesign />
case 5: return <Step3Config />          // ⚠ filename says "Step3" but this is Step 5 (Config Gen)
case 6: return <Step6Deploy />
```

**Confirmed live mapping** (matches `STEP_NAMES` in App.tsx and `BreadcrumbBar`):

| Step | Component file | Wizard label |
|------|----------------|--------------|
| 1 | `Step1UseCase.tsx` | Use Case |
| 2 | `Step2Requirements.tsx` | Network Requirements |
| 3 | `Step2Design.tsx` | Products & BOM |
| 4 | `Step4NetworkDesign.tsx` | Network Design |
| 5 | `Step3Config.tsx` | Config Generation |
| 6 | `Step6Deploy.tsx` | Deploy & Validate |

#### ⚠ Legacy/unused files (NOT imported by App.tsx)

- **`frontend/src/pages/Step4ZTP.tsx`** — older standalone ZTP demo page (lab topology + fault injection via `useRunZTP`). Superseded by the `ztp` sub-tab in `Step6Deploy.tsx`. Only referenced by `frontend/src/test/e2e-features.test.ts`.
- **`frontend/src/pages/Step5Checks.tsx`** — older standalone pre/post-checks demo page (`useRunChecks`). Superseded by the `checks` sub-tab in `Step6Deploy.tsx`. Only referenced by `e2e-features.test.ts`.
- **`frontend/src/pages/Step6Monitor.tsx`** — older standalone monitoring demo page (`usePollMonitoring`). Superseded by the `monitor` sub-tab in `Step6Deploy.tsx`. Only referenced by `e2e-features.test.ts`.
- **`frontend/src/components/wizard/WizardNav.tsx`** — a horizontal step-nav bar (steps 1-6, click to jump). Not rendered by `App.tsx` (the `Sidebar` handles nav instead). Only referenced by `e2e-features.test.ts`.

These four files appear to be retained purely so `e2e-features.test.ts` can smoke-test that the modules export valid components — they are dead code from the user's perspective. Safe to leave as-is or remove in a future cleanup pass (not currently tracked as a gap in CLAUDE.md §20).

#### Other important top-level observations

- `App.tsx` also wires: `Sidebar`, `TroubleshootingEngine` (toggled via `showTroubleshooting` state, NOT a wizard step), `LandingPage` (shown before `showLanding=false`), `BackendToggleProvider`/`BackendToggle`, `ThemeToggle`, `ToastProvider`, `ErrorBoundary`, TanStack `QueryClientProvider`.
- `M-57`: on mount, `App.tsx` checks `?design=` URL param, base64+JSON-decodes it, and calls `useAppStore.setState(decoded)` to restore a shared design (used by `ExportModal`'s "Share Design" feature in `Sidebar.tsx`).
- `frontend/src/components/LiveProgressFeed.tsx`, `AlertsPanel.tsx`, and `RcaPanel.tsx` are **not currently mounted anywhere** in the live UI — only referenced by `e2e-features.test.ts`. (CLAUDE.md describes an "Observability panel" with these, but it isn't wired into `App.tsx`/`Step6Deploy.tsx` yet.)

---

### Pages

#### `frontend/src/pages/Step1UseCase.tsx`
**Purpose:** Step 1 — use-case selection (7 tiles: campus/dc/gpu/wan/multisite/multicloud/aviatrix) plus organisation details form.

**Key exports / structure:**
- `export function Step1UseCase({ onBack }: { onBack?: () => void })`
- Constants: `USE_CASES` (7 tiles with icon/label/desc), `VENDORS` (9 vendor chips), `INDUSTRIES` (10 industry chips)
- Reads/writes via `useAppStore`: `useCase, orgName, orgSize, budgetTier, vendorPrefs, industry, primaryContact` + setters; calls `nextStep()`
- `toggleVendor(v)`, `toggleIndustry(label)` — local toggle helpers for multi-select chips

**Notes:**
- "Continue" disabled until `useCase` is set.
- `onBack` (optional prop) returns to `LandingPage` (only passed when this is truly the first screen).

---

#### `frontend/src/pages/Step2Requirements.tsx`
**Purpose:** Step 2 — network requirements form (redundancy, traffic pattern, capacity, VPN/NAC, underlay/overlay protocols, protocol features, compliance, app types, multi-cloud config) with live constraint validation.

**Key exports / structure:**
- `export function Step2Requirements()`
- Constants: `REDUNDANCY_OPTIONS`, `TRAFFIC_PATTERNS`, `BW_OPTIONS`, `UNDERLAY_OPTIONS`, `OVERLAY_OPTIONS` (incl. GENEVE, M-08), `PROTO_FEATURES` (20 features, M-09), `COMPLIANCE_OPTIONS` (incl. FedRAMP/NIST_CSF/ISO27001, M-07), `APP_TYPES`, `OVERSUBSCRIPTION_OPTIONS`, `VPN_TYPES` (M-04), `NAC_OPTIONS` (M-05), `CLOUD_PROVIDERS`/`DC_TOPOLOGY_OPTIONS`/`DC_EDGE_VENDORS`/`AVIATRIX_OPTIONS` (M-11, multi-cloud)
- `interface Violation { id, severity: 'error'|'warning', msg, fix }`
- `function runConstraints(state): Violation[]` — implements rules **R-01 through R-05** (a subset of CLAUDE.md §7's CONSTRAINTS array; R-06 GPU/InfiniBand rule is NOT implemented here, only in configgen-side checks elsewhere)
- Local component: `SummaryCard({ label, value })` — small live-summary pill
- Local state: `numSitesDraft` (string draft to avoid mobile input-clamping bug on backspace)

**Notes:**
- Two-column layout: main form (left, scrollable) + sticky "Current Selections" live summary sidebar (right, `hidden lg:block`).
- M-13: violations rendered as red (error)/yellow (warning) banners above the form; "Continue" disabled if `errors.length > 0`.
- Multi-cloud section (`cloudProviders`, `dcTopology`, `coloProvider`, `dcEdgeVendor`, `bgpAsn`, `orgCidr`, `aviatrixOptions`) only rendered when `useCase === 'multicloud' || useCase === 'aviatrix'`.

---

#### `frontend/src/pages/Step2Design.tsx` (Step 3 — Products & BOM)
**Purpose:** BOM/cabling/optics/topology/IP-plan/rack/port-capacity workbench — generates the device list from intent via `buildBOM()` and feeds it into the rest of the wizard.

**Key exports / structure:**
- `export function Step2Design()`
- 7 sub-tabs (`type Tab = 'devices'|'cabling'|'optics'|'topology'|'ipplan'|'rack'|'capacity'`):
  - **devices** — TanStack Table (`useReactTable`) of BOM rows with vendor filter chips, AI Score column
  - **cabling** — cable schedule table (`buildCabling()`)
  - **optics** — optics table (`buildOptics()`)
  - **topology** — renders `<HLDTopologyDiagram devices={generatedDevices} useCase underlayProtocol siteCode />`
  - **ipplan** (M-19) — `buildIPPlan()` derives Management/OOB/Loopback/P2P/VTEP/Overlay subnet blocks from `siteToOctet(siteCode)` (deterministic hash → `10.X.0.0/16`)
  - **rack** (M-17) — ASCII-art 42U rack diagram, devices ordered by `roleOrder`
  - **capacity** (M-18) — port utilization table (uplinks/downlinks/used % bar) per device model
- M-15 **AI Product Scoring**: `computeScore(row, useCase, underlayProtocol, compliance)` → `{ total, factors: ScoreFactors }` where `ScoreFactors = { protocolFit(0-25), complianceFit(0-20), useCaseFit(0-25), portDensity(0-15), priceTier(0-15) }`. `<ScoreBadge score>` renders green/yellow/red pill. "AI Product Recommendations" panel shows top-5 by score.
- M-16 **EOL Table**: `EOL_TABLE: EOLEntry[]` (hardcoded model→EOL-date→replacement map for Nexus 9300-EX, Arista 7050X2, EX4300, ASR 1002-HX, Catalyst 9200-48P); `getEolStatus()`/`findEOLHits()` flag critical (past EOL) vs warning (within 12 months).
- Export helpers: `exportBOM()`, `exportCabling()`, `exportOptics()` — all via `downloadCSV()` from `@/lib/utils`.

**Notes:**
- `useMemo(() => { setDevices(generatedDevices) }, ...)` — side-effect-in-useMemo anti-pattern (same pattern repeated in `Step4NetworkDesign.tsx`) syncs computed BOM devices into the Zustand store.
- Imports `buildBOM, buildCabling, buildOptics` from `@/lib/bom`; `HLDTopologyDiagram` from `@/components/HLDTopologyDiagram`.
- "Next: Config →" disabled until `devices.length > 0`.

---

#### `frontend/src/pages/Step3Config.tsx` (Step 5 — Config Generation)
**Purpose:** Per-device generated-config viewer with CodeMirror editor, section navigation, collapse/expand, layer filtering, and a config diff viewer.

**Key exports / structure:**
- `export function Step3Config()`
- Auto-(re)generates configs via `generateAllConfigs(devices, useCase, policyBlocks, appTypes)` from `@/lib/configgen` whenever devices/useCase/policy selection changes (tracked via `policySig` ref comparison).
- **Layer filter (M-35)**: `type LayerFilter = 'All'|'Spine'|'Leaf'|'Firewall'|'Border'|'Access'`; `matchesLayer(device, filter)` checks `role`/`subLayer` substring match. Chips filter the device sidebar list.
- **Section nav (M-33)**: `parseSections(configText): ConfigSection[]` regex-parses lines like `! === MANAGEMENT ===` into `{ label, lineIndex }`; chips jump CodeMirror cursor via `scrollToSection(lineIndex)`.
- **Collapse/Expand All (M-36)**: `sectionsCollapsed` state toggles between full CodeMirror view and a clickable list of section chips (`expandAndScrollTo`).
- **Diff viewer (M-34)**: `type DiffLine = {kind:'add'|'remove'|'same', text}`; `lineDiff(a,b): DiffLine[]` — classic LCS-based line diff (O(mn) DP table). Two-pane UI: left = current generated config (read-only), right = user-pasted "Previous Config" textarea; unified diff rendered below with +/− line counts.
- `downloadAll()` — concatenates all device configs into `all-configs.txt`.

**Notes:**
- CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `oneDark` theme) mounted/destroyed in a `useEffect` keyed on `[selectedId, configs]`.
- "Next: ZTP →" button label is stale/legacy text (actual next step is Step 6 Deploy & Validate, not a ZTP-specific step).

---

#### `frontend/src/pages/Step4NetworkDesign.tsx` (Step 4 — Network Design / HLD Review)
**Purpose:** Renders the "Network Design" wizard step — a 9-tab Design Workbench (HLD topology, IP plan, VLAN/VNI design, routing/protocols, physical cabling, Mermaid diagram, failure simulation, full design summary, and reference designs) auto-derived from the intent and BOM.

**Key exports / structure:**
- `export function Step4NetworkDesign()` (~1500 lines: ~700 lines helpers/data + ~790 lines JSX)
- `type DesignTab = 'hld'|'ipplan'|'vlan'|'routing'|'physical'|'mermaid'|'simulate'|'summary'|'refdesigns'` + `TAB_LABELS`
- Tabs:
  - **hld** — `<HLDTopologyDiagram>` inside a `ref`'d div (for SVG export); "Regenerate" re-syncs `setDevices(generatedDevices)`
  - **ipplan** — IP block cards (`genIPBlocks`) + per-device IP table (`genIPRows`)
  - **vlan** — VLAN table (`genVLANs`) + (DC only) VNI/EVPN table (`genVNIs`)
  - **routing** — BGP peer table, protocol summary, OSPF area table from `genRoutingData()`
  - **physical** (M-23) — cabling schedule (`genPhysicalLinks()`) + cable-type guide
  - **mermaid** (M-25) — Mermaid diagram **text** (`genMermaidDiagram()`/`sanitizeId()`) with copy/download `.mmd` (no rendering library — text only, per "no d3/mermaid render" convention)
  - **simulate** (M-26) — device-failure simulator: `simulateFailure()` (blast radius + convergence calc), `genReachabilityMatrix()` (✓/✗ grid via `getTopDevices()`), `genRoutePropagation()`
  - **summary** (M-27) — Intent/Topology/BOM/Compliance cards + `buildSummaryText()` plain-text export with copy
  - **refdesigns** (M-24) — static `REF_DESIGNS` map (campus/dc/gpu/wan/multisite/multicloud) with `VENDOR_BADGE_COLORS`, active use case sorted first
- Shared types: `RefDesign, IPBlock, IPRow, VLANRow, VNIRow, BGPRow, ProtoRow, OSPFRow, CableRow, ReachabilityEntry, RoutePropRow`
- Export helpers: `exportLLDCSV()` (multi-section CSV: IP plan + VLAN + BGP + device list), `handleExportSVG()` (XMLSerializer on the HLD `<svg>`)

**Notes:**
- Reads from `useAppStore`: `useCase, scale, siteCode, numSites, underlayProtocol, overlayProtocols, protoFeatures, redundancyModel, totalEndpoints, bandwidthPerServer, oversubscription, trafficPattern, firewallModel, compliance, vendorPrefs, devices, nextStep, prevStep`. Writes `setDevices(generatedDevices)`.
- Same `useMemo`-as-side-effect pattern as `Step2Design.tsx` to sync `generatedDevices` from `buildBOM()` into the store.
- `simulateFailure()` HA logic: spine failure with ≥2 spines remaining only reduces ECMP paths; firewall failure → 2000ms convergence; presence of a spare device of same `subLayer` caps convergence at 300ms.
- IS-IS vs OSPF vs eBGP underlay branching in `genRoutingData()` mirrors CLAUDE.md §6 Rule 4 (IS-IS/eBGP for DC, OSPF for campus/WAN) but only affects this page's tables, not `configgen.ts`.
- Per CLAUDE.md G-A2/D1: HLD diagram functionally complete; topology-aware computed data (MLAG pairs, FHRP VIPs, DCI links from configgen items A1–A3) is the still-open D1 item.

---

#### `frontend/src/pages/Step6Deploy.tsx` (Step 6 — Deploy & Validate, ~3209 lines)

**Purpose:** Single large component implementing all 7 "Deploy & Validate" sub-tabs (`deploy`, `ztp`, `checks`, `netconf`, `monitor`, `day2ops`, `batfish`), switched via Zustand `activeDeployTab`/`setActiveDeployTab` (no local tab state).

**Top-level imports/structure:**
- Hooks: `useTopologySummary, useTopologyDevices` (`@/hooks/useTopology`), `useRunZTP` (`@/hooks/useZTP`), `useRunChecks` (`@/hooks/useChecks`), `usePollMonitoring, useMetricsSummary` (`@/hooks/useMonitoring`), `useToast` (`@/components/ui/Toast`), `useBackendMode` (`@/components/BackendToggle`)
- UI: `Button`, `Card/CardHeader/CardTitle`, `Badge` from `@/components/ui/*`; `TopologyDiagram` from `@/components/TopologyDiagram` (the older simple diagram, NOT HLDTopologyDiagram)
- Utils: `formatUptime, cn` from `@/lib/utils`
- Types: `ZTPEvent, BOMDevice, CheckResult, MonitoringResult, ZTPResult, ChecksResult, DeviceMetrics, MetricsSummary` from `@/types`
- `STATUS_BADGE`: maps `healthy/degraded/down/unknown` → `pass/warn/fail/neutral` Badge variants
- `type Tab = 'deploy'|'ztp'|'checks'|'monitor'|'netconf'|'day2ops'|'batfish'`
- `type PipelineStage = 'precheck'|'backup'|'push'|'verify'|'postcheck'`, `type StageStatus = 'pending'|'running'|'done'|'failed'`
- `PIPELINE_STAGES` (5-stage array with id/label/desc), `ZTP_SIM_STAGES` (8 stages REGISTERED→ONLINE), `ZTP_STAGE_MSGS`, `CHECK_TEMPLATES` (12 checks across Connectivity/Protocols/Config/Hardware, each `{cat, name, ok(hostname): string}`)
- Shared UI helper components: `ArcGauge({value,max,color,label,size})` (SVG circular gauge), `Sparkline({values,color})` (SVG mini line chart, returns `null` if <2 points)
- Deterministic pseudo-random helpers: `_seed(name)` (char-code sum), `_pseudoRandom(seed,offset)` (Math.sin-based PRNG) — used by monitoring simulation
- Script/config generators (module-level, lines ~757-1253): `buildPreCheckScript()`, `buildPostCheckScript()`, `buildPushConfigsScript()`, `buildGrokPatternsConfig()`, `buildNetflowConfig()`, `buildAnsiblePlaybook(logLines, deviceNames)`, `buildNetconfScript()`, `buildNetconfXMLForOp(op, datastore, vendor)`, `buildNetconfMockResponse(op)`, `buildAnsibleInventory(deviceNames)`, `buildTerraformMain(provider, deviceNames)`, `buildTerraformVars(deviceNames)`, `buildTerraformPlanOutput(deviceNames)`, `downloadBlob`/`downloadText`
- `simDevices` (useMemo): flattens store `devices` (capped at 4 per model, suffixed `-01..04`) into `{name, role}[]`, falling back to `useTopologyDevices()`
- Background `useEffect`: when `tab === 'monitor' && !isLive`, runs `simulateMonitoringMetrics` immediately then every 15s

##### Tab: Deploy Pipeline (`deploy`)
- **State:** `stageStatus`, `deployLog: string[]`, `isDeploying`, `deployDone`, `deviceStatuses: Record<string,StageStatus>`, `stageTimestamps`, `showRollbackModal`, `rollbackScope`, `deviceView: 'grid'|'table'`, `canaryMode`, `awaitingCanaryConfirm`, `canaryHostname`, `canaryResolveRef`, `policyConfirmed`, `policyApproved`, plus Config-Automation state (`automationTab`, `towerUrl`, `towerTemplate`, `towerJobId`, `towerJobStatus`, `towerJobRunning`, `tfProvider`, `tfPlanOutput`, `tfPlanRunning`, `scriptType`)
- **UI:**
  1. Policy & Approval Gate (shown pre-deploy) — change window, custom policy rules/peer review, blast radius (`simDevices.length`), rollback plan, confirm checkbox + "Approve & Lock" gating `policyApproved`
  2. Canary Mode toggle + "Start Deploy" (disabled until `policyApproved`) + Reset/Rollback after completion
  3. Canary confirmation banner (`awaitingCanaryConfirm`) — Abort/Continue Rollout resolve `canaryResolveRef` Promise
  4. 5-stage pipeline visual (`PIPELINE_STAGES`) with status colors + start/end timestamps
  5. Device Status grid/table toggle, per-row "Retry" in table view
  6. Color-coded terminal log (`deployLog`)
  7. Downloads card (Pre/Post-check scripts, push_configs.py, Ansible Playbook — enabled after `deployDone`)
  8. **Config Automation** card, 3 sub-tabs:
     - **Ansible Tower/AWX** — Tower URL, Job Template select, extra-vars JSON preview, "Launch Job" (`handleTowerLaunch`: fake job ID + status progression Pending→Waiting→Running×3→Successful), download inventory.ini/playbook
     - **Terraform** — provider select (cisco_nso/netbox/nautobot/generic), `main.tf` preview, "Terraform Plan (Demo)" (`handleTfPlan`), download main.tf/terraform.tfvars
     - **Manual/Script** — script type toggle (push/precheck/postcheck), truncated preview + download
- **Key function:** `async function handleStartDeploy()` — runs precheck→backup→push (optional canary single-device pause/confirm via Promise)→verify→postcheck sequentially with simulated delays, updating `stageStatus`/`stageTimestamps`/`deviceStatuses`/`deployLog`.
- **M-41 Rollback Modal** (lines ~3132-3202, rendered after Batfish tab content): radio choice `rollbackScope: 'stage'|'full'`, Cancel/Confirm → toast `Rollback initiated (${rollbackScope})`.

##### Tab: ZTP Provisioning (`ztp`)
- **State:** `failDevice`, `failAt` (default `CONFIG_APPLYING`), `ztpEvents: ZTPEvent[]`, `ztpSummary`; `useRunZTP()` → `runZTP`, `ztpPending`
- **UI:** topology summary cards (`useTopologySummary()`), `<TopologyDiagram devices={bomDevices}/>`, Fault Injection card (Fail Device select from `simDevices.slice(0,20)`, Fail At Stage select from `ZTP_SIM_STAGES`, Run/Reset), summary cards (Events/Online/Failed), per-device State Machine strip (8-stage icons: done/failed/pending), Events table
- **`handleRunZTP()`** — if `!isLive`, calls `simulateZTPResult()` directly; if live, calls `runZTP({fail_device, fail_at})` with simulation fallback `onError`
- **`simulateZTPResult(devList: {name,role}[], failDevice, failAt): ZTPResult`** — iterates each device through `ZTP_SIM_STAGES` (8 stages: REGISTERED→POWERED_ON→DHCP_ACK→SCRIPT_DOWNLOADED→CONFIG_APPLYING→CALLBACK_RECEIVED→VERIFIED→ONLINE), emitting success events via `ZTP_STAGE_MSGS`; if `dev.name === failDevice` and stage matches `failAt`, emits `[FAULT INJECTED]` failure and stops. Returns `{ results: Record<name,'ONLINE'|'FAILED'>, events: ZTPEvent[], summary: {total_events, online, failed} }`.

##### Tab: Pre/Post Checks (`checks`)
- **State:** `failCheckDevice`, `failCheck` (default `'interfaces_up'`), `checkPhase: 'pre'|'post'|null`, `checkResults`, `preResults`/`postResults: CheckResult[]`, `expandedCheckDevices: Set<string>`; `useRunChecks('pre')` and `useRunChecks('post')` mutations
- **UI:** Fault Injection card (Fail Device + Fail Check from `CHECK_TEMPLATES` + Pre/Post/Clear buttons), summary bar (Phase/PASS/FAIL/WARN counts), Pre→Post Delta panel (shown only when both phases run — diffs status changes per device/check), grouped-by-device expandable rows (FAIL/WARN/ALL-PASS pill headers; expanded table shows Category/Check/Status/Message+remediation)
- **`applyChecksResult(data, phase)`** — sets phase + results + pre/post storage, toasts PASS/FAIL summary
- **`handleRunChecks(phase)`** — `!isLive` → `simulateChecksResult()` directly; live → `runPre`/`runPost` mutation with `{fail_devices: {[failCheckDevice]: [failCheck]}}`, fallback to simulation on error
- **`badgeVariant(s)`/`badgeIcon(s)`** — map PASS/FAIL/WARN/SKIP → Badge variant/glyph
- **`simulateChecksResult(devList, phase, failDevice, failCheck): ChecksResult`** — for each device × 12 `CHECK_TEMPLATES`: forced FAIL if device+check match fault injection; else random roll (~85% PASS / 10% WARN / 5% FAIL). `message` from `tpl.ok(hostname)` (suffixed for WARN/FAIL); `remediation` non-null only on FAIL. Returns `{ phase, results: CheckResult[] }`.

##### Tab: NETCONF (`netconf`, lines ~2812-2907)
- **UI:** header card (RFC 6241, NETCONF/SSH port 830, vendor support notes); 3-column controls (Device select from store `devices`, Operation select `get-config|edit-config|get|lock|unlock`, Datastore select `running|candidate|startup`); two-column RPC panes — "RPC Request" (`netconfXML` via `buildNetconfXMLForOp(op, datastore, vendor)`) and "RPC Response" (`netconfResponse` state); "Execute (Demo)" → `handleNetconfExecute()` (800ms delay, sets response via `buildNetconfMockResponse(op)`); "Download NETCONF Script (Python)"; "Supported YANG Models" reference grid (ietf-interfaces/ietf-ip/ietf-routing/openconfig-bgp/openconfig-vlan/Cisco-IOS-XE-native)
- **`buildNetconfScript()`** — Python `ncclient`-based script: `DEVICES` list, `INTERFACE_CONFIG_XML` (ietf-interfaces edit-config for `GigabitEthernet1`), `push_config()` (`edit_config()` + `validate()`), `get_interfaces()` (subtree filter + lxml pretty-print)
- **`buildNetconfXMLForOp(op, datastore, vendor)`** — RFC 6241 RPC XML: `get-config` (subtree filter on ietf-interfaces); `edit-config` (vendor-aware: JunOS branch uses `<configuration xmlns="http://xml.juniper.net/xnm/1.1/xnm">` for `ge-0/0/0`, else generic ietf-interfaces/ietf-ip for `GigabitEthernet1` @ `10.0.0.1/24`); `get` (interfaces-state filter); `lock`/`unlock` (target datastore)
- **`buildNetconfMockResponse(op)`** — mock `<rpc-reply>`: `get-config` returns ietf-interfaces payload (GigabitEthernet1, "WAN Uplink", `10.0.0.1/30`); `get` returns interfaces-state (admin/oper up, zeroed counters); other ops return `<ok/>`

##### Tab: Monitoring (`monitor`, lines ~2547-2810)
- **State:** `monitorData: MonitoringResult|null`, `usePollMonitoring()` → `poll`/`pollPending`, `useMetricsSummary()` → `liveMetrics`, `monitorTick`, `demoMetrics: MetricsSummary|null`, `sparkRef` (last 8 throughput samples per device)
- **UI:** header (live/demo status dot, tick counter, Grafana link if live, Poll/Simulate Degraded/Clear buttons); live-mode summary cards + device table; demo-mode dashboard — fleet Avg CPU/Mem `ArcGauge`s + total BGP sessions + interface errors, per-device cards (BGP peers/prefixes, CPU/Mem gauges, throughput `Sparkline`, error/PFC badges, red border if `cpu_util>80`, purple if `pfc_drops>100`), BGP Session Summary table; Alert Ticker (devices with `cpu_util>75 || pfc_drops>150 || interface_errors_in>5`); Observability Downloads (Grok Patterns, NetFlow Config)
- **`handlePoll(failDevices?)`** — calls `poll()` mutation, toasts health summary
- **`simulateMonitoringMetrics(devList, tick): MetricsSummary`** — per device, deterministic seed via `_seed(name)`/`_pseudoRandom`. Base CPU by role (GPU=62, spine=42, fw=28, else=22); computes `cpu_util, mem_util, interface_errors_in/out, bgp_sessions_up` (0 for access/vedge, else 2-6), `bgp_prefixes_received`, `pfc_drops` (GPU only, up to 300), `throughput_mbps` (spine base 8000, others 2000, scaled 0.4-1.0)

##### Tab: Day-2 Ops (`day2ops`, lines ~2909-3028)
- **State:** `changeWindow` (`'immediate'|'scheduled'|'emergency'`, default immediate), `driftChecking`, `driftDone`
- **UI:** Change Window card (scheduled shows "Sun 02:00-04:00 UTC"; emergency shows CAB-approval warning); Config Drift Detection card (static 3-row table: leaf1/BGP AS 65001, spine1/IS-IS NET 49.0001, fw1/Zone-pair inspect — Expected==Actual hardcoded; "Run Drift Check" → `handleDriftCheck()` 2s async sets `driftDone=true`); Compliance Audit card (7 hardcoded "✓ PASS" checks: password complexity, SSHv2, NTP, syslog, SNMP strings, unused interfaces shut, logging buffered)

##### Tab: Batfish Validate (`batfish`, lines ~3030-3130)
- **State:** `batfishRunning`, `batfishStep` (default -1), `batfishDone`, local `BATFISH_STEPS` (5 labels: Initializing snapshot / Parsing configs / Forwarding analysis / BGP reachability / Validation complete)
- **UI:** header card + bullet list (forwarding analysis, BGP reachability, undefined references, duplicate router IDs); "Run Batfish Validation" → `handleBatfishValidation()` (900ms/step async progression through `BATFISH_STEPS`); Validation Results card (5 hardcoded PASS rows: route reachability, undefined references, BGP peer reachability, duplicate router-ids, invalid BGP configs)

**Notes (whole file):**
- Component closes at line 3209; **all helpers are module-level functions defined BEFORE the component** (lines ~757-1253) — nothing after the component's closing brace.
- Final element before close: "← Back" button (`prevStep()`).
- Uses the **older** `TopologyDiagram` (not `HLDTopologyDiagram`) for the ZTP tab's lab topology view.

---

#### `frontend/src/pages/Step4ZTP.tsx` (LEGACY/UNUSED)
**Purpose:** Lab-topology ZTP demo page that runs the ZTP pipeline against demo devices via `useRunZTP`, with fault injection.
**Key exports / structure:**
- Exports `Step4ZTP` component
- Renders topology summary cards, `TopologyDiagram` (lab devices via `useTopologyDevices`), fault-injection form (`failDevice`/`failAt` from `ZTP_STAGES`), result summary cards, events table
- Uses `useRunZTP`, `useTopologySummary`, `useTopologyDevices`, `useToast`, Zustand `prevStep`/`nextStep`

**Notes:** NOT wired into live `App.tsx` routing — superseded by the `ztp` sub-tab in `Step6Deploy.tsx`. Only referenced by `e2e-features.test.ts`.

---

#### `frontend/src/pages/Step5Checks.tsx` (LEGACY/UNUSED)
**Purpose:** Demo page for running pre-/post-deploy checks against lab devices with optional fault injection.
**Key exports / structure:**
- Exports `Step5Checks` component
- Fault-injection card (fail device + `CHECK_OPTIONS`), Pre-Checks/Post-Checks/Clear via `useRunChecks('pre'|'post')`
- Summary cards (PASS/FAIL/WARN) + results table with status badges and remediation column

**Notes:** NOT wired into live `App.tsx` routing — superseded by the `checks` sub-tab in `Step6Deploy.tsx`. Only referenced by `e2e-features.test.ts`.

---

#### `frontend/src/pages/Step6Monitor.tsx` (LEGACY/UNUSED)
**Purpose:** Demo monitoring page that polls device health/alerts via `usePollMonitoring` and displays status in a table.
**Key exports / structure:**
- Exports `Step6Monitor` component
- "Poll Now"/"Simulate Degraded"/"Clear" controls; `STATUS_BADGE` map for healthy/degraded/down/unknown
- Summary cards (total/healthy/degraded/down/alerts), per-device health table (CPU, uptime via `formatUptime`, alerts), active-alerts panel

**Notes:** NOT wired into live `App.tsx` routing — superseded by the `monitor` sub-tab in `Step6Deploy.tsx`. Only referenced by `e2e-features.test.ts`.

---

---

## Frontend — Components

### Components

#### `frontend/src/components/HLDTopologyDiagram.tsx`
**Purpose:** Renders a pure-SVG, use-case-aware HLD topology diagram with security-zone bands, animated packet-flow scenarios, ambient link animation, and an interactive device-inspect panel.

**Key exports / structure:**
- Single export: `export function HLDTopologyDiagram({ devices, useCase, underlayProtocol, overlayProtocols, siteCode })`
- `Props` (file-local): `{ devices: BOMDevice[]; useCase?: string (default 'dc'); underlayProtocol?: string (default 'isis'); overlayProtocols?: string[] (default ['vxlan_evpn']); siteCode?: string (default '') }`
- Internal types: `HLDNode` (id, label, model, layer, vendor, loopback, mgmtIp, asn?, role, x/y/w/h, isCloud?, haRole?: 'active'|'standby'|'none', features[], color/border/textColor), `HLDLink` (id, from, to, speed, protocol, fromPort, toPort, linkSubnet, isHaSync?, isOob?), `SecurityZone` (id, label, sublabel, yStart/yEnd, fill, stroke, icon), `PacketFlow` (id, icon, label, desc, nodeSeq: string[], color, animDur), `Topo` (nodes, links, zones, flows, title, subtitle, svgH)
- Layout constants: `SVG_W=1280`, `LEFT_W=148`, `RIGHT_PAD=16`, `CONTENT_W = SVG_W - LEFT_W - RIGHT_PAD`, `NW=136`, `NH=66`; `svgH` per-topology (760-920) drives `viewBox`
- `LAYER_STYLE` maps layer names (internet, wan-edge, corp-fw, edge-fw, spine, core, distribution, leaf, access, host, gpu, storage, oob, cloud-gw) → `{ color, border, textColor }`
- Helpers: `style(layer)`, `xCentered(count, gap)`, `mkLink(...)`, `mkNode(...)`, `linkPath(n1, n2, isHa?)` (bezier paths; HA-sync = horizontal dashed)
- **Per-use-case topology builders** (each returns `Topo`): `buildDCTopology(devices, underlay, overlay, sc)` (used for `dc`, `multisite`, `multicloud`, `aviatrix`), `buildCampusTopology(devices, underlay, sc)`, `buildGPUTopology(devices, sc)`, `buildWANTopology(devices, underlay, sc)` — dispatched via `buildTopology(devices, useCase, underlay, overlay, sc)`
- Each builder defines fixed `Y` per-layer y-centers, `zones[]` (colored bands w/ left-column labels/icons), `nodes` via `xCentered()`, `links` (full-mesh spine↔leaf, HA-sync pairs, OOB)
- **Packet-flow scenarios:** `Topo.flows: PacketFlow[]` — DC has 6 (N-S inbound/egress, E-W VXLAN, HA failover, GPU RDMA, OOB mgmt); Campus has 6 (N-S inbound/egress, intra-campus, voice, HA failover, 802.1X); GPU has 4 (GPU↔GPU RDMA, NVMe-oF read, AllReduce, OOB mgmt); WAN has 4 (HQ→branch, local breakout, PE failover, branch-to-branch)
- **Flow selection/highlighting:** `activeFlow` state (defaults to `topo.flows[0]?.id`), pill buttons in "Packet Flow" bar; `flowLinkIds`/`flowNodeIds` (Sets from `nodeSeq`, bidirectional `from--to`/`to--from`); `flowPath` chains `linkPath()` segments into one combined SVG path for `<animateMotion>`
- **Device-inspect panel:** clicking a node `<g>` (or background to deselect) sets `selectedNode`; panel shows label, model, HA badge, layer, vendor, loopback, mgmt IP, ASN, feature/protocol chips, "Connected Links" list (peer/ports/speed/protocol/subnet from `topo.links`)
- **"Primary Path Only" toggle:** pill button (visible only when `activeFlow` set) flips `primaryPathOnly`; when true, both `topo.links` and `topo.nodes` filtered to only `flowLinkIds`/`flowNodeIds` (non-flow elements fully hidden, not dimmed)
- **Cloud overlays:** `isCloud` flag on `HLDNode` renders `<ellipse>` + 🌐 emoji (used for `internet`/`isp` nodes); multicloud/multisite/aviatrix reuse `buildDCTopology` — no dedicated cloud builder
- **Animation:** (1) ambient background packets on every non-OOB, non-active-flow link via per-link `<circle>` + `<animateMotion>` riding `<mpath>` (staggered dur/begin by link index); (2) active-flow packets — glowing trail (`<path opacity=0.25>`) + 3 staggered `<circle>` packets along `#flow-path` at offsets 0%/40%/70% of `animDur`

**Notes:**
- Used by `Step2Design.tsx` and `Step4NetworkDesign.tsx` (both pass `devices, useCase, underlayProtocol, overlayProtocols, siteCode`).
- Responsive SVG: no fixed `width`/`height`, `style={{ width:'100%', height:'auto', display:'block' }}`, `viewBox="0 0 SVG_W svgH"` (per CLAUDE.md §16).
- Per CLAUDE.md G-A2/D1: functionally complete; topology-aware computed data (MLAG pairs, FHRP VIPs, DCI links from configgen A1-A3) is the open D1 follow-up — node/link generation is still template-driven from device counts.
- No external graph libraries (pure SVG/JSX) — per Implementation Rule 9.
- `multisite`, `multicloud`, `aviatrix` all fall through to `buildDCTopology` (no dedicated builders yet).

---

#### `frontend/src/components/TopologyDiagram.tsx`
**Purpose:** Older, simpler pure-SVG topology diagram rendering devices in fixed horizontal "zone" bands (wan-edge, firewall, core, spine, distribution, leaf, access, cloud-transit, cloud-gw) with animated packet particles along static zone-to-zone connections.

**Key exports / structure:**
- `export function TopologyDiagram({ devices, underlayProtocol?, overlayProtocols? })` — props typed against `BOMDevice[]`
- Static config: `ZONE_CFG` (per-zone styling/labels/annotations), `ZONE_ORDER`, `ZONE_ICONS`, `CONNECTS` (fixed zone adjacency list), `CONN_COLORS`
- Layout constants (`MAX_PER_ROW`, `NODE_W/H`, `DIAGRAM_W`) drive `zoneLayouts`/`connPaths`, capped at 6 nodes/row with "+N more" overflow badge
- Renders capacity summary line, animated `<circle>` packets via `<animateMotion>`/`<mpath>`, zone bands, device nodes, bottom legend

**Notes:**
- Still actively used — imported by `frontend/src/pages/Step4ZTP.tsx` (legacy) and `frontend/src/pages/Step6Deploy.tsx` (ZTP tab's lab topology, line ~2255).
- NOT used by `Step2Design.tsx`/`Step4NetworkDesign.tsx` (those use `HLDTopologyDiagram`).
- Key difference from HLD version: no use-case awareness, no clickable flow scenarios, no device-inspect panel, no "Primary Path Only" toggle — purely a static role-based layered view with fixed zone ordering/connections. Both files coexist intentionally: `TopologyDiagram` = lightweight reference diagram for ZTP/Deploy contexts; `HLDTopologyDiagram` = rich design-review diagram for Steps 3/4.

---

#### `frontend/src/components/wizard/Sidebar.tsx`
**Purpose:** Main left-nav sidebar — wizard step navigation, Step 6 deep-linking, and access to all secondary tools/modals.

**Key exports / structure:**
- `export function Sidebar({ onGoHome, onShowTroubleshooting, showTroubleshooting, mobileOpen?, onMobileClose? })`
- Nav groups: `DESIGN_STEPS` (1 Use Case, 2 Requirements), `CONFIG_STEPS` (3 Products & BOM, 4 Network Design, 5 Config Gen), `DEPLOY_STEPS` (6 Deploy & Validate), `DEPLOY_SUB_ITEMS` (deploy/ztp/checks/netconf/monitor/day2ops/batfish — matches CLAUDE.md §17)
- "Tools" group: Troubleshooting Engine toggle, My Designs, Config Policy, Export, Share Design (clipboard-copies base64-encoded full Zustand state as `?design=` URL param), Policy Rules
- "Enterprise" group: Approvals (`EnterpriseApprovals`), Integrations (`IntegrationsPanel`)
- Always-mounted modals: `MyDesigns`, `ConfigPolicyModal`, `ExportModal`, `PolicyRulesEditor`, `EnterpriseApprovals`, `IntegrationsPanel`, `DemoLoader`
- Three layout modes sharing `NavContent`: collapsed icon-strip (desktop), expanded sidebar (desktop), mobile drawer overlay

**Notes:**
- "Deploy & Validate" group is collapsible (`deployOpen`, default open); clicking step-6 header sets `activeDeployTab='deploy'`; sub-items call `setActiveDeployTab(sub.tab)`.
- Active styling for sub-items requires `step === 6 && activeDeployTab === sub.tab`.
- Bottom of sidebar shows "Step N of 6" progress bar.
- "Troubleshooting" is a single Tools-group toggle (`showTroubleshooting` prop), not a wizard step.

---

#### `frontend/src/components/wizard/WizardNav.tsx` (LEGACY/UNUSED)
**Purpose:** Horizontal step-nav bar (steps 1-6, click-to-jump via `setStep`).
**Key exports / structure:** `export function WizardNav()`; `STEPS` array of 6 labels (Use Case, Requirements, Products & BOM, Network Design, Config Gen, Deploy & Validate); active/done/pending styling.
**Notes:** NOT rendered by `App.tsx` (Sidebar handles nav). Only referenced by `e2e-features.test.ts`.

---

#### `frontend/src/components/LiveProgressFeed.tsx`
**Purpose:** WebSocket-driven live deploy event log with progress bar and stage badge.

**Key exports / structure:**
- `export function LiveProgressFeed({ deploymentId, onDone? })` — opens `openDeployStream(deploymentId, onEvent, onClose)` from `@/api/client` (connects to `ws(s)://<backend>/ws/deploy/{id}`)
- `STAGE_VARIANT` maps `DeployEvent.stage` (`done`, `failed`, `pre_checks`, `post_checks`, `pushing_config`, `connecting`, `queued`) → Badge variants
- Renders status header (pulse dot + deployment ID + stage badge), animated progress bar, scrollable monospace event log (auto-scroll)

**Notes:**
- Calls `onDone?.()` and sets `closed=true` on `done`/`failed`; cleans up socket on unmount/`deploymentId` change.
- Renders "No active deployment" placeholder when `deploymentId` is `null`.
- Only referenced by `e2e-features.test.ts` — **not currently mounted in any page** (not yet wired into `Step6Deploy.tsx`).

---

#### `frontend/src/components/AlertsPanel.tsx`
**Purpose:** Displays live BGP/interface/health alerts via `useAlerts` (TanStack Query) with active/resolved grouping and severity badges.

**Key exports / structure:**
- `export function AlertsPanel()` — no props; uses `useAlerts()` and `isLiveMode()` from `@/api/client`
- `SEV_VARIANT` maps `Alert.severity` (critical/warning/info) → Badge variants (fail/warn/info)
- Internal `AlertRow` — severity badge, device, summary/detail, resolved state (dimmed), timestamp

**Notes:**
- States: "configure backend" placeholder when `!isLiveMode()`, loading, error+retry, "All clear", counts summary + `dataUpdatedAt`.
- Only referenced from `e2e-features.test.ts` — **not yet mounted in any page**.

---

#### `frontend/src/components/RcaPanel.tsx`
**Purpose:** Form-driven Root Cause Analysis panel — submits symptom + optional device list to `useRunRca` (TanStack Query mutation), renders ranked hypothesis cards.

**Key exports / structure:**
- `export function RcaPanel({ deviceNames? })` — uses `useRunRca()` and `isLiveMode()`
- `ConfidenceBar({ value })` — colored progress bar (red ≥75%, yellow ≥50%, blue otherwise)
- `HypothesisCard({ h })` — rank badge, cause, confidence bar, evidence bullets, remediation callout (`RcaHypothesis`)

**Notes:**
- "configure backend" placeholder when `!isLiveMode()`; textarea for symptom + toggleable device-name chips.
- "Run RCA" disabled while pending or symptom empty; "Clear" calls `reset()`.
- Only referenced from `e2e-features.test.ts` — **not yet mounted in any page**.

---

#### `frontend/src/components/TroubleshootingEngine.tsx`
**Purpose:** Troubleshooting hub combining 12 deterministic AI fault-diagnosis scenarios, a symptom classifier, BGP convergence predictor, RCA playbook generator, and an incident knowledge base. Toggled from `App.tsx` (`showTroubleshooting`), not a wizard step.

**Key exports / structure:**
- `export function TroubleshootingEngine()` — renders all sub-sections in `space-y-6`
- `SCENARIOS: Scenario[]` (12 entries) — each has `id, icon, title, severity ('critical'|'high'|'medium'), useCaseTag, summary, relevantRoles, signals: SignalDef[]` (name/weight/threshold/unit/higherIsWorse), `rootCauses: RootCauseRule[]` (description/severity/affectedDeviceRoles/`requires`/`mode:'all'|'any'`), `remediation: RemediationStep[]` (title + `cli` map keyed by subLayer or `'*'`), `verification: string[]`, `mttrMinutes: [number,number]`. IDs: `wifi-campus, san-dc, gpu-slow, ecmp-broken, bgp-slow, ospf-adjacency, vlan-l2, dhcp-fail, mtu-blackhole, interface-errors, stp-loop, high-cpu`
- `runDiagnosis(scenario, devices)` — deterministic (djb2-hash-seeded) diagnosis: simulates 0-100 metric per signal, marks `triggered` vs threshold, scores `rootCauses` by summed weight → `confidence` (0-100), filters/sorts by confidence+severity, builds per-device `remediationCLI`. Returns `DiagnosisResult` (signals, rootCauses, affectedDevices, remediationCLI, mttrMinutes, diagnosedAt)
- `LiveScenarioDiagnostics()` — renders 12 `ScenarioCard`s in a grid; click → `runScenario()` runs `runDiagnosis` against `useAppStore(s => s.devices)`, animates signal reveal/progress, shows ranked root causes/affected devices/CLI+Verification tabbed remediation (`CliCopyBlock`)
- `SYMPTOMS` array (15 keyword-tagged entries) + `classifySymptom(query)` — free-text → root cause/fix/RFC reference matcher
- `RCA_PLAYBOOKS` (keys: `bgp, ospf, vxlan, interface, cpu, pfc, stp`) — `{title, steps[], commands[]}`, downloadable via `downloadPlaybook()`
- `predictConvergence(devices, underlayProtocol)` — BGP convergence estimator (worst-case/typical/with-BFD)

**Notes:**
- All "AI" diagnosis is fully client-side/deterministic (no LLM call); when `isLive`, fires fire-and-forget `POST /api/troubleshoot` (ignored on failure).
- Reads `useAppStore(s => s.devices)` and `s.underlayProtocol`; reads `useBackendMode()` for `isLive`.

---

#### `frontend/src/components/EnterpriseApprovals.tsx`
**Purpose:** Modal implementing a mock enterprise change-approval workflow (pending/all/new-request tabs) with risk-score gating.

**Key exports / structure:**
- `export function EnterpriseApprovals({ open, onClose }: { open: boolean; onClose: () => void })`
- `Approval` interface (`id, status, environment, summary, risk_score, device_count, requested_by, reviewer_note?, created_at`); seeded with `MOCK_APPROVALS` (3 entries)
- Tabs: `pending | all | new`; "new" submits environment/summary/risk-slider (0-100)
- Handlers: `handleApprove`, `handleReject` (prompt for reason), `handleCancel` (confirm dialog), `handleSubmit` (simulated 800ms delay)

**Notes:** Reads `useAppStore` for `orgName, devices, useCase` (prefill placeholders/`device_count`). Local state only — no persistence, no API calls.

---

#### `frontend/src/components/IntegrationsPanel.tsx`
**Purpose:** Modal for configuring (mock) external integrations — Slack, Teams, ServiceNow, Jira, NetBox, AWX/AAP, GitOps.

**Key exports / structure:**
- `export function IntegrationsPanel({ open, onClose }: { open: boolean; onClose: () => void })`
- `PROVIDERS` array of 7 (`id, label, icon, desc, urlPlaceholder, tokenLabel, extraLabel?`)
- `IntegrationConfig` type (`enabled, url, token, extra, status: 'idle'|'testing'|'ok'|'error', error?`); per-provider config map in local state
- `handleTest()` — simulated 1.2s connection test (passes if URL starts with `http`); `handleSave()` — sets status `ok`

**Notes:** Entirely local/mock — comments note real implementation would call `/api/integrations/test` and `/api/integrations`.

---

#### `frontend/src/components/ExportModal.tsx`
**Purpose:** Modal offering three client-side download formats for the current design (LLD CSV, configs bundle, HTML report).

**Key exports / structure:**
- `export function ExportModal({ open, onClose, devices, configs }: ExportModalProps)` — `devices: BOMDevice[]`, `configs: Record<string,string>`
- `downloadFile(filename, content, mimeType?)` — generic Blob download helper
- `exportLldCsv(devices)` — CSV of LLD fields + summary rows
- `exportConfigsZip(configs)` — concatenates all configs into one `.txt` (despite the name, not an actual zip)
- `exportHtmlReport(devices, configs)` — self-contained dark-themed HTML report with BOM table + config blocks (`escapeHtml()`)

**Notes:** Pure utility component, no store reads — caller supplies `devices`/`configs` from `useAppStore`. Closes on Escape.

---

#### `frontend/src/components/ConfigPolicyModal.tsx`
**Purpose:** Modal letting users select enterprise config-policy blocks (from `lib/policies.ts`) to overlay onto generated configs, grouped by category with live CLI previews.

**Key exports / structure:**
- `export function ConfigPolicyModal({ open, onClose }: ConfigPolicyModalProps)`
- Imports `POLICY_CATALOG, POLICY_CATEGORIES, policyByCategory(), type PolicyDef` from `@/lib/policies`
- `CATEGORY_ICON` map for 5 categories (Management, Security, L2 Switching, L3 Routing, QoS & Voice)
- Local `selected: Set<string>` synced from `useAppStore(s => s.policyBlocks)`; `handleSave()` → `setPolicyBlocks(Array.from(selected))`
- `toggleBlock`, `toggleCategory`, `handleSelectAll`, `handleClearAll`, `renderBlock(block)`, `previewFor(block: PolicyDef)` (builds synthetic `SAMPLE-DEVICE`, calls `block.render(sample, useCase)`)

**Notes:** Reads/writes `useAppStore.policyBlocks: string[]` (consumed by `configgen.ts`). Escape closes.

---

#### `frontend/src/components/PolicyRulesEditor.tsx`
**Purpose:** Modal YAML DSL editor for custom governance/constraint rules, with validation and live evaluation against the current intent.

**Key exports / structure:**
- `export function PolicyRulesEditor({ open, onClose }: PolicyRulesEditorProps)`
- `YAML_TEMPLATE` — example rules (`CUSTOM-01..03`) demonstrating the `when: "<field> <op> <value>"` DSL (ops: `eq, neq, contains, not_contains, in, not_in, gt, lt, gte, lte, is_empty, is_not_empty, config_contains, config_not_contains`)
- Imports `parseRules, evaluateCustomPolicy, type EvalResult` from `@/lib/customPolicy`
- `handleValidate()` — parses YAML, shows rule count or errors
- `handleEvaluate()` — reads `useAppStore.getState()` directly, builds `intent` object (`useCase, scale, redundancy, compliance, protoFeatures, overlayProtocols, underlayProtocol, vendorPrefs, totalEndpoints, oversubscription, firewallModel, vpnType`) + `configBlob` from `store.configs`, calls `evaluateCustomPolicy()`; renders `gateStatus` (PASS/WARN/BLOCK/FAIL) + per-finding violations/warnings/infos
- `handleSave()` — `setCustomPolicyRules(text)`

**Notes:** Reads/writes `useAppStore.customPolicyRules: string` (M-55, used by Deploy policy gate per CLAUDE.md §15).

---

#### `frontend/src/components/MyDesigns.tsx`
**Purpose:** Modal for saving/loading/deleting full app-state snapshots ("designs") to `localStorage`.

**Key exports / structure:**
- `export function MyDesigns({ open, onClose }: MyDesignsProps)`
- `SavedDesign` interface (`id, name, savedAt, state: AppState`); persisted under localStorage key `'netdesign-saved-designs'` via `loadDesigns()`/`persistDesigns()`
- `handleSave()` — `window.prompt`s for name, snapshots `useAppStore.getState()`, prepends to list
- `handleLoad(design)` — `useAppStore.setState(design.state)` (full overwrite), closes modal
- `handleDelete(id)` — two-click confirm pattern (`confirmDeleteId`)

**Notes:** `AppState` type from `@/types`. Only component performing a full Zustand `setState` replacement — loading a design discards all current in-memory state. Escape closes.

---

#### `frontend/src/components/DemoLoader.tsx`
**Purpose:** Sidebar dropdown for loading a pre-built demo topology (devices/intent) into the BOM store with one click.

**Key exports / structure:**
- `export function DemoLoader()` — no props
- Imports `DEMO_TOPOLOGIES` from `@/data/demoTopologies`
- Reads `useAppStore(s => s.loadDemoTopology)` and `s.demoTopologyId`; calls `loadDemoTopology(topo)` on selection
- `USE_CASE_COLORS`, `SCALE_LABELS` maps for badge styling
- Each row shows icon, label, use-case badge, scale letter, description, siteCode, device count; highlights active topology

**Notes:** Depends on `useAppStore` action `loadDemoTopology` and field `demoTopologyId`.

---

#### `frontend/src/components/LandingPage.tsx`
**Purpose:** Marketing/landing page shown before entering the wizard — hero, feature cards, stats, use-case chips, entry buttons.

**Key exports / structure:**
- `export function LandingPage({ onStart }: { onStart: () => void })`
- `FEATURES` (6 cards), `USE_CASES` (6 chips: Campus, DC Leaf-Spine, AI/GPU, WAN/SD-WAN, Hybrid, Multi-Site DCI), `STATS` (40+ SKUs, 5 OS Platforms, 6 Use Cases, 100% Browser-Native)
- `handleDemo()` — `setUseCase('dc')` + `setScale('medium')` then `onStart()`
- Header: `/favicon.svg` logo + `ThemeToggle`; hero: `/logo-brand.jpg`
- "Start Designing →" and "Try Demo" CTAs both call `onStart`

**Notes:** Per CLAUDE.md, `favicon.svg` = circuit-board "N" icon, `logo-brand.jpg` = AI-robot brand image (both in `frontend/public/`). Footer links to GitHub repo. Rendered directly by `App.tsx` before wizard `step` navigation begins (gated by `showLanding` state).

---

#### `frontend/src/components/BackendToggle.tsx`
**Purpose:** Provides the `useBackendMode()` context (`{ isLive, baseUrl }`) plus the LIVE/SIM toggle pill UI shown in the header.

**Key exports / structure:**
- `export function useBackendMode(): { isLive: boolean; baseUrl: string }` — context hook (default `{ isLive: false, baseUrl: 'http://localhost:8000' }`)
- `export function BackendToggleProvider({ children, value })` — context provider, instantiated once in `App.tsx`
- `export function BackendToggle({ isLive, baseUrl, onToggle, onUrlChange })` — renders LIVE/SIM badge, pill switch, and (when live) an editable backend-URL field (hidden on small screens)

**Notes:** `App.tsx` owns the actual `isLive`/`backendUrl` state (`useState`) and passes both the controlled props to `BackendToggle` AND wraps children in `BackendToggleProvider` with the same values — so `useBackendMode()` anywhere in the tree reflects the toggle. This is the central "demo vs live" switch referenced throughout CLAUDE.md §3.

---

### Summary of Key Cross-File Relationships

- **`useAppStore` (Zustand)** is the single source of truth; almost every page reads/writes a slice of it. `Step2Design.tsx` and `Step4NetworkDesign.tsx` both call `buildBOM()` and sync results into `devices` via a `useMemo`-side-effect anti-pattern.
- **`HLDTopologyDiagram`** (new, rich, use-case-aware) is used in Step 3 (`Step2Design.tsx`) and Step 4 (`Step4NetworkDesign.tsx`). **`TopologyDiagram`** (old, simple, zone-based) is used only in `Step6Deploy.tsx`'s ZTP tab and the legacy `Step4ZTP.tsx`.
- **Simulation functions** (`simulateZTPResult`, `simulateChecksResult`, `simulateMonitoringMetrics`) all live inside `Step6Deploy.tsx` and are gated by `useBackendMode().isLive` — this is the actual implementation of CLAUDE.md §3's "Demo Mode."

---

## Backend — app entry, routers, core engines

*(Filled in from research agent — see below for full detail.)*

---

## Backend — integrations, telemetry, ZTP, policies, export

### 1. NetBox / Nautobot Integration

#### `backend/integrations/netbox.py`
**Purpose:** NetBox DCIM/IPAM client — IP prefix allocation, device sync (DCIM), and config-context push (used to surface rendered configs inside NetBox).

**Config (`IntegrationConfig` row, `provider="netbox"`):**
```
base_url   — https://netbox.yourcompany.com
token      — NetBox API token (sent as "Authorization: Token <token>")
site_slug  — default site slug for device creation (optional, default "default")
tenant_id  — default tenant ID assigned to allocated prefixes (optional)
```

**Key exports** (all `async`, return `None`/falsy on failure — never raise to caller):

- `async def get_available_prefix(org_id: str, within: str, prefix_length: int) -> str | None`
  Calls `GET /api/ipam/prefixes/?prefix={within}&limit=1` to find the parent prefix, then `GET /api/ipam/prefixes/{parent_id}/available-prefixes/?limit=1`. Returns the first available CIDR rewritten to the requested `prefix_length` (e.g. `"10.0.1.0/24"`), or `None` if no parent/availability found.

- `async def allocate_prefix(org_id: str, prefix: str, description: str = "", tags: list[str] | None = None) -> dict | None`
  `POST /api/ipam/prefixes/` with `{prefix, status: "active", description, tenant?, tags?}`. Returns the created NetBox prefix object, or `None` on failure. **This is the function to call to "claim" a prefix found via `get_available_prefix`.**

- `async def sync_devices(org_id: str, devices: list[dict]) -> list[str]`
  Bulk upsert into NetBox DCIM. Each `dev` dict expects `{hostname, mgmt_ip, platform, vendor, model, role, site}`.
  - `GET /api/dcim/devices/?limit=1000` to build an existing-device map by `name`.
  - For each device: `PATCH /api/dcim/devices/{id}/` if it exists, else `POST /api/dcim/devices/`. Payload: `{name, device_role: {slug: role.lower()}, device_type: {model}, site: {slug}, platform: {slug: platform.lower()}, status: "active"}`.
  - If `mgmt_ip` present: `POST /api/ipam/ip-addresses/` (assigned to `dcim.device`/device id), then `PATCH /api/dcim/devices/{id}/` to set `primary_ip4`.
  - Returns a list of error strings (empty list = all succeeded; `["Netbox not configured"]` if no config row).

- `async def push_config_context(org_id: str, hostname: str, config: str, platform: str) -> bool`
  Creates/updates a NetBox **Config Context** named `"{hostname}-running-config"` containing `{rendered_config, platform}` in its `data` field. Searches `GET /api/extras/config-contexts/?name={context_name}&limit=1`; `PATCH` if found, else `POST /api/extras/config-contexts/`. Returns `True`/`False`.

- `async def push_device_config(org_id: str, hostname: str, config: str, platform: str) -> dict`
  Higher-level wrapper around `push_config_context`. Returns `{success, hostname, url, error?}` where `url` is a deep link to the NetBox config-context list filtered by name.

**Notes:**
- All functions call private `_get_config(org_id)` which queries `IntegrationConfig` table (`provider="netbox", enabled=True`) via `db._SessionLocal`. If DB not configured or row missing/disabled, all functions degrade gracefully (return `None`/empty/`False`).
- `_client(cfg)` builds an `httpx.AsyncClient` with `Authorization: Token <token>` header, 10s timeout.
- **For the "ZTP + NetBox" feature**: there is currently **no function that reads device inventory FROM NetBox** (no `fetch_inventory`/`get_devices` call) and **no IP allocation specifically for ZTP mgmt IPs** — `get_available_prefix` + `allocate_prefix` are generic IPAM helpers usable for that purpose, but ZTP (`ztp/server.py`, `ztp/router.py`) does not currently call into `integrations/netbox.py` at all (see ZTP section below — this is the integration gap to close).

---

### 2. Other Integrations

All five files share the same `_get_config(org_id)` pattern: query `IntegrationConfig` where `provider=<name>` and `enabled=True`, return `.config` dict or `None`.

#### `backend/integrations/gitops.py`
**Purpose:** Commit generated device configs to a Git repo (GitHub/GitLab/Bitbucket via HTTPS token), optionally opening a GitHub PR.

**Config keys:** `repo_url, token, branch (default "main"), base_path (default "configs/"), author_name, author_email, create_pr ("true"/"false"), pr_base`

**Key exports:**
- `async def commit_configs(org_id: str, design_id: str, design_name: str, configs: dict[str, str], commit_message: str = "") -> dict[str, str]`
  Clones repo (shallow, via `gitpython`) into a temp dir, writes each config to `{base_path}{design_name}/{hostname}.conf`, commits, and pushes. If `create_pr=true`, pushes to a `netdesign/{design_id[:8]}` branch and calls `_open_github_pr`. Returns `{commit_sha, branch, pr_url}` or `{"error": "..."}`.
- `async def _open_github_pr(cfg, head, base, title, design_name) -> str` (private) — calls **GitHub API** `POST /repos/{owner}/{repo}/pulls` (`api.github.com`), returns PR URL or `""`.

**Notes:** Requires `gitpython` installed (`pip install gitpython`); returns `{"error": "gitpython not installed..."}` if missing. Token injected into clone URL for HTTPS auth (`https://netdesign:{token}@...`).

---

#### `backend/integrations/jira.py`
**Purpose:** Create/transition/comment on Jira issues for change approvals (Atlassian Cloud REST API v3).

**Config keys:** `base_url, email, api_token, project_key, issue_type (default "Change Request"), priority (default "Medium"), label (default "netdesign-ai")`

**Key exports:**
- `async def create_change_issue(approval, design) -> tuple[str, str]` — `POST /rest/api/3/issue`. Builds an ADF (Atlassian Document Format) description with design name, environment, risk score, device count, requester, summary. Returns `(issue_key, issue_url)` or `("", "")`.
- `async def transition_issue(issue_key: str | None, org_id: str, transition_name: str) -> None` — `GET /rest/api/3/issue/{key}/transitions` then `POST .../transitions` matching transition by name (case-insensitive), e.g. `"Approve"`, `"Reject"`, `"Done"`.
- `async def add_comment(issue_key: str | None, org_id: str, text: str) -> None` — `POST /rest/api/3/issue/{key}/comment`.

**Notes:** Auth = HTTP Basic with `email:api_token` base64-encoded.

---

#### `backend/integrations/servicenow.py`
**Purpose:** Create/update/close ServiceNow Normal Change Requests (`change_request` table).

**Config keys:** `instance_url, username, password, assignment_group (optional), category (default "Network"), cmdb_ci (optional)`

**Key exports:**
- `async def create_change_ticket(approval, design) -> tuple[str, str]` — `POST /api/now/table/change_request`. Sets `type="normal"`, `risk` derived from `approval.risk_score` (≥75 high / ≥40 medium / else low), `state="assess"`. Returns `(sys_id, ticket_url)` or `("", "")`.
- `async def update_change_ticket(sys_id: str | None, state: str, note: str = "") -> None` — looks up the owning `ApprovalRequest` by `itsm_ticket_id == sys_id` to resolve `org_id`/config, then `PATCH /api/now/table/change_request/{sys_id}` with `state` (`-3`=authorized if `state=="approved"`, else `4`=cancelled) and optional `work_notes`.
- `async def close_change_ticket(sys_id: str | None, org_id: str, outcome: str) -> None` — `PATCH` with `state=3` (closed) or `4` (cancelled), `close_code`, `close_notes`.

**Notes:** Auth = HTTP Basic (`username`/`password`). State codes are ServiceNow standard change states (`-5 new, -4 assess, -3 authorize, -2 scheduled, -1 implement, 0 review, 3 closed, 4 cancelled`).

---

#### `backend/integrations/slack.py`
**Purpose:** Slack Incoming Webhook notifications (Block Kit) for approvals and deployments.

**Config keys:** `webhook_url (required), channel (optional), mention_group (optional Slack group ID)`

**Key exports** (all `async def ... -> None`, POST raw JSON `{"blocks": [...]}` to `webhook_url`):
- `notify_approval_requested(approval, design, *, escalated: bool = False)` — header + fields (design, environment, risk emoji 🔴/🟡/🟢, device count, requester, expiry), optional `<!subteam^...>` mention, Approve/Reject buttons linking to `{APP_URL}/approvals/{id}`.
- `notify_approval_decided(approval, decision: str)` — ✅/❌ + reviewer + note.
- `notify_deploy_complete(deployment, outcome: str, org_id: str)` — 🚀/💥 + triggered_by, confidence %, ITSM ticket URL.

---

#### `backend/integrations/teams.py`
**Purpose:** Microsoft Teams Adaptive Card notifications via Incoming Webhook.

**Config keys:** `webhook_url (required)`

**Key exports** (mirror `slack.py` semantics, POST `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content": <card>}]}`):
- `async def notify_approval_requested(approval, design, *, escalated: bool = False) -> None`
- `async def notify_approval_decided(approval, decision: str) -> None`
- `async def notify_deploy_complete(deployment, outcome: str, org_id: str) -> None`
- `_approval_card(approval, design, decision=None, escalated=False) -> dict` (private) — builds the AdaptiveCard JSON (v1.4 schema), color-coded by risk (`attention`/`warning`/`good`).

---

### 3. `backend/routers/integrations.py`

**Purpose:** Per-org CRUD for `IntegrationConfig` rows + on-demand trigger endpoints for the integrations above.

**Routes** (prefix `/api/integrations`, tag `integrations`):

| Route | Purpose | Calls |
|---|---|---|
| `GET /api/integrations` | List all configured integrations for caller's org (requires `designs:read`) | DB query only |
| `POST /api/integrations` | Upsert config for `provider` ∈ `{slack, teams, servicenow, jira, netbox, gitops}` (requires `*`) | DB upsert |
| `DELETE /api/integrations/{provider}` | Remove an integration config (requires `*`) | DB delete |
| `POST /api/integrations/test/{provider}` | Send a test notification/probe using a `_FakeApproval` stub | `slack.notify_approval_requested`, `teams.notify_approval_requested`, `servicenow.create_change_ticket`, `jira.create_change_issue`, `netbox.get_available_prefix("10.0.0.0/8", 24)`, or no-op for `gitops` |
| `POST /api/integrations/netbox/sync-devices` | Push device inventory to NetBox (requires `designs:write`) | `integrations.netbox.sync_devices(org_id, body["devices"])` |
| `GET /api/integrations/netbox/prefix?within=&prefix_length=` | Get next available IPAM prefix (requires `designs:read`) | `integrations.netbox.get_available_prefix` |
| `POST /api/integrations/gitops/commit` | Commit configs to Git (requires `configs:generate`) | `integrations.gitops.commit_configs` |

**Notes:**
- `_org(payload)` extracts `org_id` from JWT; raises `400` if missing (client must call `POST /api/auth/switch-org` first).
- `_VALID_PROVIDERS = {"slack", "teams", "servicenow", "jira", "netbox", "gitops"}`.
- All mutating actions call `audit.record(...)` for audit trail.
- This router is the natural place to add new NetBox-related endpoints for the ZTP+NetBox feature (e.g. `GET /api/integrations/netbox/devices` to fetch inventory, or `POST /api/integrations/netbox/allocate-mgmt-ip`).

---

### 4. ZTP Subsystem

#### `backend/ztp/server.py`
**Purpose:** Core ZTP engine — in-memory + JSON-file-backed device registry, Day-0 config rendering (Jinja2), and platform-specific bootstrap script generation (POAP/PnP/EOS-ZTP).

**State machine** (`ZTPState` enum):
```
WAITING → CONTACTED → PROVISIONING → PROVISIONED
                                   ↘ FAILED
(UNKNOWN = serial not in registry)
```
Note: this is a **simpler 5-state machine** than the frontend's 8-stage demo simulation (`REGISTERED → POWERED_ON → DHCP_ACK → SCRIPT_DOWNLOADED → CONFIG_APPLYING → CALLBACK_RECEIVED → VERIFIED → ONLINE | FAILED` per CLAUDE.md section 11). The backend's real state machine is coarser-grained.

**`ZTPDevice` dataclass fields:** `serial, hostname, platform (ios-xe|nxos|eos|junos|sonic), role (e.g. campus-access, dc-leaf, dc-spine), mgmt_ip, mgmt_mask, mgmt_gw, loopback_ip, bgp_asn, vlans: list, state: ZTPState, registered_at, contacted_at, provisioned_at, last_seen, error, bake_policies: bool, policy_flags: dict, extra: dict`.

**`ZTPServer` class** — singleton instance `ztp_server = ZTPServer()`:
- `register(device: ZTPDevice) -> ZTPDevice` — add/overwrite, persist to `backend/ztp_registry.json`.
- `register_bulk(devices: list[dict]) -> list[ZTPDevice]` — bulk register from dicts.
- `get(serial: str) -> ZTPDevice | None`
- `all_devices() -> list[ZTPDevice]`
- `stats() -> dict[str, int]` — count of devices per `ZTPState`.
- `delete(serial: str) -> bool`
- `get_bootstrap_config(serial: str) -> tuple[str, str]` — transitions device to `CONTACTED`, returns `(config_text, "text/plain")`. Unknown serials get `_generic_bootstrap()`.
- `get_platform_script(platform: str, server_url: str) -> str` — dispatches to `_nxos_poap_script`, `_eos_ztp_script`, or `_iosxe_pnp_template`.
- `checkin(serial: str, success: bool, detail: str = "") -> ZTPDevice | None` — sets `PROVISIONED` (success) or `FAILED` (with `error=detail`).
- `mark_provisioning(serial: str) -> None` — sets `PROVISIONING`.
- `_render_day0(dev: ZTPDevice) -> str` — **the key rendering function**. Loads `backend/ztp/templates/{platform_dir}/day0.j2` via Jinja2 with context `{hostname, serial, platform, role, mgmt_ip, mgmt_mask, mgmt_gw, loopback_ip, bgp_asn, vlans, **dev.extra}`.
  - **If `dev.bake_policies == False`** (default): returns the Day-0 minimal template only (mgmt IP, SSH, NTP, syslog — per CLAUDE.md section 11).
  - **If `dev.bake_policies == True`**: builds a `state_for_policy` dict (mapping role→use-case via `_role_to_uc()`, plus per-policy boolean flags from `dev.policy_flags`, default all `True`) and a `device_ctx` dict, then calls `config_gen._append_policies(base, device_ctx, platform_key, state_for_policy)` to append ALL enabled policy blocks (BGP, ACL, 802.1X, QoS, AAA, static routing, VLAN, trunk, wireless) — i.e. full production config on first boot.
- `_role_to_uc(role: str) -> str` (module-level helper) — maps role substrings (`campus`/`gpu`/`wan|cpe|hub`/`dc|spine|leaf`) to use-case keys, default `"campus"`.
- `_generic_bootstrap(serial, dev=None) -> str` — fallback minimal config when no template exists.
- `_nxos_poap_script(server_url) -> str` (static) — full NX-OS POAP Python 2 script (urllib2-based) that fetches `/ztp/bootstrap/{serial}`, applies via `cli.cli(...)`, and POSTs `/ztp/checkin/{serial}`.
- `_eos_ztp_script(server_url) -> str` (static) — Arista EOS Python 3 script using `FastCli` and `urllib.request`.
- `_iosxe_pnp_template(server_url) -> str` (static) — returns DHCP option-43 string format + PnP profile snippet (informational, not executable).

**Notes:** `REGISTRY_PATH = backend/ztp_registry.json`; `TEMPLATE_DIR = backend/ztp/templates/`.

---

#### `backend/ztp/router.py`
**Purpose:** FastAPI router (`ztp_router = APIRouter(prefix="/ztp", tags=["ZTP"])`) exposing the ZTP server to both booting devices and operators.

**Routes:**

| Route | Purpose |
|---|---|
| `GET /ztp/bootstrap/{serial}` | Booting device fetches Day-0 config (or NX-OS POAP script content). Calls `ztp_server.get_bootstrap_config(serial)`, transitions device to `CONTACTED`. |
| `GET /ztp/script/{platform}` | Returns POAP/ZTP Python script for `nxos`/`eos`/`ios-xe` (device downloads once, then calls `/ztp/bootstrap/{serial}`). |
| `POST /ztp/checkin/{serial}` | Device reports `{success: bool, detail: str}` after applying config. Transitions to `PROVISIONED`/`FAILED`. Returns `{status, serial, hostname}` or `{"status":"unknown","serial":...}` for unregistered serials. |
| `POST /ztp/register` | Pre-register a single device (`DeviceRegisterRequest` body). Returns `DeviceStatusResponse`. |
| `POST /ztp/register/bulk` | Bulk pre-register (`BulkRegisterRequest` = `{devices: [DeviceRegisterRequest, ...]}`). Returns `{registered: int, devices: [...]}`. |
| `GET /ztp/status` | Returns `{stats: {waiting,contacted,provisioning,provisioned,failed,unknown: int}, devices: [DeviceStatusResponse, ...]}`. |
| `GET /ztp/device/{serial}` | Single device status (404 if not registered). |
| `DELETE /ztp/device/{serial}` | Remove from registry (404 if not found). |
| `POST /ztp/device/{serial}/reset` | Reset device back to `WAITING` (clears `contacted_at`, `provisioned_at`, `error`). |
| `GET /ztp/dhcp-options` | Returns ready-to-paste DHCP option 43/67 snippets for ISC-DHCP and Kea, per platform (uses `_server_url(request)` which reads `ZTP_SERVER_URL` env var or falls back to `request.base_url`). |

**Pydantic models:**
- `DeviceRegisterRequest`: `serial, hostname, platform="ios-xe", role="campus-access", mgmt_ip, mgmt_mask="255.255.255.0", mgmt_gw="", loopback_ip="", bgp_asn=65000, vlans: list[dict]=[], bake_policies: bool=False, policy_flags: dict[str,bool]={}, extra: dict={}`
- `BulkRegisterRequest`: `{devices: list[DeviceRegisterRequest]}`
- `CheckinRequest`: `{success: bool, detail: str=""}`
- `DeviceStatusResponse`: `{serial, hostname, platform, role, mgmt_ip, state, bake_policies, registered_at, contacted_at, provisioned_at, last_seen, error}`

**Notes:** This router is mounted directly on the FastAPI app (no `/api` prefix) — devices hit `http://<server>/ztp/...` directly (matches DHCP-served bootfile URLs).

---

#### `backend/ztp/dhcp_gen.py`
**Purpose:** Generates an ISC-DHCP `dhcpd.conf` fragment (host stanzas) for ZTP onboarding — the missing piece between "device registered in NetDesign AI" and "device actually gets the right bootfile-name from DHCP."

**Key exports:**
- `generate_dhcp_config(devices: list[dict], ztp_server_ip: str, gateway: str, dns: str, subnet: str = "", subnet_mask: str = "", domain_name: str = "netdesign.local", lease_time: int = 600) -> str`
  For each device dict (`hostname, platform, mgmt_ip`, optional `mac` or `extra.mac`), emits a `host {name} { hardware ethernet ...; fixed-address ...; next-server ...; filename "..."; }` stanza. Optional `subnet {...} {...}` block if `subnet`+`subnet_mask` given. IOS-XE devices additionally get a commented PnP option-43 hint and `vendor-class-identifier "ciscopnp"`.
- `_boot_filename(platform: str, hostname: str) -> str` (private) — maps platform → `ztp/script/{platform}` path (e.g. `nxos`/`nxos9k` → `ztp/script/nxos`, `ios-xe`/`iosxe`/`ios_xe` → `ztp/script/ios-xe`); unknown platforms fall back to `ztp/bootstrap/{hostname}`.
- `_normalise_mac(mac: str) -> str` (private) — normalizes `00:1A:2B:3C:4D:5E` / `001a.2b3c.4d5e` / `001A2B3C4D5E` → lowercase colon-separated.

**Relation to NetBox IPAM:** Currently **none** — `mgmt_ip` for each device dict comes from whatever caller supplies (e.g. the ZTP registry's `ZTPDevice.mgmt_ip`, set manually at registration time via `/ztp/register`). There is no code path where `dhcp_gen.py` or `ztp/server.py` calls `integrations/netbox.get_available_prefix`/`allocate_prefix` to source mgmt IPs from NetBox IPAM, and `sync_devices()` (NetBox DCIM push) is not invoked from anywhere in `ztp/`. **This is the exact gap the upcoming "ZTP + NetBox" feature needs to bridge** — e.g.: (1) before `/ztp/register`, allocate a mgmt IP from a NetBox prefix via `allocate_prefix`; (2) after `checkin` → `PROVISIONED`, call `sync_devices`/`push_device_config` to record the device + its rendered config in NetBox.

---

### 5. Telemetry Subsystem

#### `backend/telemetry/gnmi_collector.py`
**Purpose:** Background gNMI streaming-telemetry collector — subscribes to OpenConfig paths per device and writes values into in-process `prometheus_client` Gauges/Counters.

**Prometheus metrics (module-level singletons, only if `prometheus_client` installed):**
- `BGP_PREFIXES` (Gauge) — labels `[hostname, peer, afi]`
- `INTERFACE_ERRS` (Counter) — labels `[hostname, interface, direction]` (direction = `in`/`out`)
- `CPU_UTIL` (Gauge) — labels `[hostname]`
- `MEM_UTIL` (Gauge) — labels `[hostname]`
- `PFC_DROPS` (Counter) — labels `[hostname, interface, priority]`

**OpenConfig path map (`_OPENCONFIG_PATHS`)** — per platform (`eos`, `nxos`, `sonic`, `ios_xe`): BGP neighbor prefixes, interface counters, CPU state, (EOS only) QoS queue state.

**Key exports:**
- `@dataclass DeviceTarget`: `hostname, mgmt_ip, port=6030, platform="eos", username="", password="", insecure=True`
- `class TelemetryCollector(devices: list[DeviceTarget])`
  - `async def start() -> None` — spawns one `asyncio.to_thread` task per device running `_subscribe_with_backoff`.
  - `async def stop() -> None` — cancels all tasks.
  - `_subscribe_with_backoff(dev)` — wraps `_subscribe` with exponential backoff (10s → 60s cap) on failure.
  - `_subscribe(dev)` — uses `pygnmi.client.gNMIclient` to issue a `STREAM`/`sample` subscription (30s sample interval, `json_ietf` encoding) over the device's OpenConfig paths; calls `_process` per response.
  - `_process(hostname, response)` / `_map_to_metric(hostname, path, val)` — parses gNMI update paths and routes values to the appropriate Prometheus metric (matches on substrings: `bgp`+`prefix`, `interface`+`in-errors`/`out-errors`, `cpu`+`instant`, `memory`, `pfc`/`watchdog`).
- `_extract_path_key(path, key, default) -> str` / `_coerce_float(val) -> float` — helpers.

**Notes:** Requires `pygnmi` and `prometheus_client`; degrades to no-op (logs warning) if either missing.

---

#### `backend/telemetry/alerting.py`
**Purpose:** Evaluates static alert rules directly against the in-process Prometheus registry (no external Prometheus server needed).

**Data structures:**
- `class Severity(str, Enum)`: `CRITICAL, WARN, INFO`
- `@dataclass Alert`: `hostname, check, severity, message, metric_value, fired_at` + `.to_dict()`

**Key exports:**
- `_collect_metrics() -> dict[str, list[dict]]` (private) — reads `prometheus_client.REGISTRY.collect()`, returns `{metric_name: [{"labels": {...}, "value": float}, ...]}`.
- `def evaluate(metrics: dict | None = None) -> list[Alert]` — runs 5 hardcoded rules:
  1. `bgp_prefix_zero` (CRITICAL) — any `bgp_prefixes` sample == 0
  2. `cpu_high` (WARN) — `cpu_util` > 80%
  3. `pfc_storm` (CRITICAL) — `pfc_drops_total` aggregated per host > 100
  4. `interface_error_rate` (WARN) — `interface_errs_total` aggregated per (host, iface) > 50
  5. `memory_high` (CRITICAL) — `mem_util` > 90%
- `def evaluate_with_drift(intended_state: dict, metrics: dict | None = None) -> dict[str, list]` — runs `evaluate()` PLUS `telemetry.drift_detector.DriftDetector().compare(intended_state, metrics)`. Returns `{"alerts": [Alert.to_dict()...], "drift": [DriftAlert.to_dict()...]}`.

**Alert rule format:** Python dataclass-based, hardcoded thresholds (not YAML-configurable) — contrast with `policies/user_rule_engine.py` which IS YAML-configurable for config/policy checks.

---

#### `backend/telemetry/drift_detector.py`
**Purpose:** Compares the design-time **intended state** (frontend `STATE`/intent object — `uc, redundancy, overlayProto, totalHosts, bwPerServer, protoFeatures, compliance, orgSize`, etc.) against **live gNMI metric snapshots** to detect configuration/operational drift.

**Data structures:**
- `class DriftSeverity(str, Enum)`: `CRITICAL, WARN, INFO`
- `@dataclass DriftAlert`: `check, severity, message, intended_value, observed_value, hostname="fabric", fired_at` + `.to_dict()`

**`class DriftDetector(bgp_prefix_warn_pct=0.8, cpu_warn_pct=75.0, pfc_storm_threshold=50)`:**
- `def compare(intended_state: dict, live_metrics: dict[str, list[dict]]) -> list[DriftAlert]` — runs all 6 checks below and concatenates results.

**Drift checks (algorithm summary):**
1. `_check_redundancy` — if `state.redundancy in ("ha","full")`, group `bgp_prefixes` samples by hostname counting peers with `value > 0`; CRITICAL if any host has < 2 active peers.
2. `_check_bgp` — if overlay includes `evpn`/`bgp`, CRITICAL if BGP prefix samples exist but ALL report 0 (possible session down).
3. `_check_pfc` — if `uc in ("gpu","ai_fabric")` or `protoFeatures` mentions `pfc`/`roce`, CRITICAL if `pfc_drops_total` aggregated per host > `pfc_storm_threshold` (default 50).
4. `_check_bandwidth` — if `bwPerServer in ("100g","400g")`, WARN if any `interface_errs_total` sample > 100 (proxy for optic/link issues).
5. `_check_overlay` — if `"VXLAN"`/`"vxlan"` in overlay, WARN if a host's total BGP prefix count is between 1 and 9 (suggests EVPN not fully converged — expects "many" type-2/3/5 routes).
6. `_check_cpu` — WARN if any `cpu_util` sample > `cpu_warn_pct` (default 75%).

**Notes:** This is essentially the **G-A4 / G-A16 "config drift detection"** backend piece referenced in CLAUDE.md's Known Gaps — it compares *live telemetry* vs *intended design*, not *running-config* vs *intended-config* text diff (that's a different/complementary drift concept the frontend gap refers to).

---

### 6. Policy Generators (`backend/policies/`)

All generators follow the same pattern: `generate_X(ctx: dict[str, Any], platform: str) -> str`, dispatching to private per-platform functions (`_ios_xe_X`, `_nxos_X`, `_eos_X`, `_junos_X`, `_sonic_X`), returning `""` when not applicable to the device's `layer`/`uc`/platform. They are invoked by `config_gen._append_policies()` via a `_POLICY_REGISTRY` of `(state_flag_key, generator_fn)` pairs, and can also be baked into ZTP Day-0 configs (`ztp/server.py._render_day0`).

| File | Generates | Main export |
|---|---|---|
| `aaa_policy.py` | TACACS+ (mgmt AAA), RADIUS (802.1X), SNMPv3, syslog, NTP auth | `generate_aaa(ctx, platform) -> str` |
| `acl.py` | Infrastructure ACLs (iACL), VLAN ACLs, mgmt ACLs (RIPE-399 style) | `generate_acl(ctx, platform) -> str` |
| `bgp_policy.py` | Prefix-lists, route-maps, communities, AS-path filters, max-prefix per use-case ASN scheme (`UC_ASN`) | `generate_bgp_policy(ctx, platform) -> str` |
| `control_plane.py` | CoPP (8-class model), routing-protocol auth (BGP MD5/OSPF SHA256/IS-IS HMAC-MD5), GTSM, uRPF, management-plane protection | `generate_control_plane(ctx, platform) -> str` |
| `custom_policy.py` | User-authored device configs from explicit `CustomPolicyInput` (VLANs, BGP peers, prefix-lists, interfaces) for `cisco_ios/cisco_nxos/juniper_junos/arista_eos` | `class CustomPolicy.generate(policy_input: CustomPolicyInput) -> dict[str,str]`; `class CustomPolicyInput(BaseModel)`; `CustomPolicy.validate(policy_input) -> list[str]` |
| `dot1x.py` | Full 802.1X/NAC (RADIUS, CoA, guest/auth-fail/critical VLANs, MAB, IBNS 2.0); campus-only | `generate_dot1x(ctx, platform) -> str` |
| `evpn_policy.py` | EVPN/VXLAN overlay — tenant VRFs (L3VNI), L2VNI↔VLAN mapping, BGP EVPN AF route-targets, RT/community scheme (`L2VNI_BASE=10000`, `L3VNI_BASE=19000`); dc/gpu/hybrid only | `generate_evpn_policy(ctx, platform) -> str` |
| `firewall_policy.py` | IOS-XE ZBF, Cisco ASA, FortiGate, Palo Alto firewall configs (zones, NAT, security policies); auto-detects vendor | `generate_firewall_policy(ctx, platform) -> str` |
| `qos_policy.py` | Per-use-case QoS: campus 8-class CoS/DSCP, dc PFC queues, gpu PFC pri 3/4 + ECN/DCQCN, wan LLQ/CBWFQ | `generate_qos(ctx, platform) -> str` |
| `security_hardening.py` | L2 security (port-security, BPDU/Root/Loop guard, DAI, DHCP snooping, storm control) + device hardening (SSH, AAA login, banners, VTY/console) | `generate_security_hardening(ctx, platform) -> str` |
| `static_routing.py` | Default routes, mgmt-VRF statics, floating backups, summarization, Null0 blackholes, IPv6 default | `generate_static_routing(ctx, platform) -> str` |
| `trunk_policy.py` | Uplink port-channels (LACP), allowed-VLAN lists, native VLAN hardening, storm control, BPDU/Root guard, MTU 9214 for DC/GPU | `generate_trunk_policy(ctx, platform) -> str` |
| `user_rule_engine.py` | Not a config generator — evaluates user-authored YAML rule packs (`policies/packs/`) against design intent + generated configs; extends `gate_engine` DSL (`config_contains`, `gte/lte`, custom severities `Info/Warn/Fail/Block`) | `parse_ruleset(yaml_content) -> list[UserRule]`; `validate_yaml(yaml_content) -> tuple[bool, list[str], int]` |
| `vlan_policy.py` | VLAN database per use-case (campus VLANs 10-999, DC VLANs 100-600, GPU VLANs 100-400), STP priorities, PVLANs, voice/IoT/guest VLANs | `generate_vlan_policy(ctx, platform) -> str` |
| `wireless_policy.py` | Cisco IOS-XE EWC/WLC, Arista CloudVision Wi-Fi, generic CAPWAP — SSIDs (CORP/GUEST/IOT/LEGACY), RF profiles, fast roaming, rogue AP detection | `generate_wireless_policy(ctx, platform) -> str` |

**Relation to `frontend/src/lib/policies.ts`:** The frontend file is a **separate, much smaller catalog** (`POLICY_CATALOG: PolicyDef[]`, `applicablePolicies()`, `applyPolicies()`, `policyByCategory()`) used for the UI's policy-selection/preview features in the wizard — it is a **client-side metadata/preview layer**, NOT a code-generation engine. The actual production-grade config text is generated server-side by `backend/policies/*.py` (via `config_gen.generate_all_configs` → `_append_policies`). The two are not 1:1 — the backend generators are far more detailed (full CLI syntax per platform) than the frontend catalog's preview snippets. `frontend/src/lib/customPolicy.ts` is the frontend counterpart most aligned with `backend/policies/custom_policy.py`.

---

### 7. Export Modules (`backend/export/`)

#### `backend/export/ansible.py`
**Purpose:** Generate a ready-to-run Ansible playbook + inventory from design state and rendered configs.

**Key exports:**
- `generate_ansible(design_state: dict, configs: dict[str,str] | None = None, ip_plan: dict | None = None) -> tuple[str, str]` — returns `(playbook_yaml, inventory_yaml)`. Devices come from `ip_plan["devices"]` if present, else synthesized from `design_state` counts (`numCore`, `numSpine`, `numLeaf`, etc.) per use-case (`campus/enterprise`, `datacenter/dc`, `gpu/ai_fabric`, default).
- Playbook maps platform → Ansible module via `_MODULE` dict (`ios_xe→cisco.ios.ios_config`, `nxos→cisco.nxos.nxos_config`, `eos→arista.eos.eos_config`, `junos→junipernetworks.junos.junos_config`, `palo_alto→paloaltonetworks.panos.panos_config_element`, `sonic→community.general.sonic_config`, default `ansible.netcommon.cli_config`). Each device gets a `*_config: {lines: [...]}` task (or a `show version` reachability check if no config available), plus pre-flight `wait_for_connection` and post-deploy `show version` collection play.
- `_ROLE_PLATFORM` maps device role → default platform (used when `platform` not explicit).

---

#### `backend/export/drawio.py`
**Purpose:** Generate a draw.io / diagrams.net `.drawio` (mxGraph XML) topology diagram from design state.

**Key exports:**
- `generate_drawio(state: dict, ip_plan: dict | None = None) -> str` — returns full mxGraph XML string with title, per-layer device nodes (positioned via `_row_positions`), inter-layer links (full-mesh capped 6×6), and a legend.
- `_build_layers(state: dict) -> dict[str, list[dict]]` — builds role→devices map (capped 20/layer) for `campus/enterprise`, `datacenter/dc`, `gpu/ai_fabric`, default topologies — same device-count logic pattern as `ansible.py`/`terraform.py`.
- `_draw_links`, `_legend`, `_node_style`, `_cell`, `_edge` (private helpers) — XML cell/edge builders. `_SHAPE`/`_COLOR` dicts map role → Cisco mxgraph shape + fill color.

---

#### `backend/export/runbook.py`
**Purpose:** Generate a Markdown change-management runbook (and optional PDF) covering overview, pre-checklist, device inventory, deployment procedure, verification, rollback, contacts, sign-off, config hashes.

**Key exports:**
- `generate_runbook(design_state: dict, approval, configs: dict[str,str], ip_plan: dict | None = None, deployment_id: str = "") -> str` — returns full Markdown document. Pulls risk score/environment/device count from `approval` object (or defaults if `None`).
- `runbook_to_pdf(markdown_text: str) -> bytes` — converts via `markdown` + `weasyprint` (raises `RuntimeError` if not installed).
- Private helpers: `_device_table`, `_deployment_order` (use-case-specific ordering: DC = firewalls→spine→leaf-pairs; GPU = spine→ToR with PFC/ECN check; default = firewall→core→dist→access), `_verification_steps` (adds `show nve peers`/`show bgp l2vpn evpn summary`/`show vpc` for DC, PFC/RoCE counters for GPU), `_config_hashes` (SHA-256 first 16 hex chars per device config).

---

#### `backend/export/terraform.py`
**Purpose:** Generate Terraform HCL — NetBox provider resources (always) plus AWS/Azure/GCP hub stacks for multicloud designs.

**Key exports:**
- `generate_terraform(state: dict) -> dict[str, str]` — **top-level dispatcher**. Always includes `"netbox"`. Adds `"aws"`/`"azure"`/`"gcp"` if `state["use_case"]=="multicloud"` or the provider is in `state["cloud_providers"]`.
- `generate_netbox_terraform(design_state: dict, ip_plan: dict | None = None) -> str` — `main.tf`-style HCL defining `netbox_device`/`netbox_ip_address` resources, plus `data` sources for site/tenant/role/platform/device-type, and an `output "device_ids"` map. Device list derived same way as `ansible.py`/`drawio.py`. `_ROLE_DEVICE_TYPE` maps role → realistic hardware model strings (e.g. `leaf → "Cisco Nexus 93180YC-FX"`).
- `generate_aws_terraform(state: dict) -> str` — renders `templates/multicloud/aws_tgw_stack.tf.j2` (Transit Gateway hub) via Jinja2; vars: `org_name, stack_name, region, env, cidr, hub_cidr, amazon_asn, customer_asn, azs, dx_prefixes`.
- `generate_azure_terraform(state: dict) -> str` — renders `azure_vwan_stack.tf.j2` (Virtual WAN hub); vars include `location, er_asn, rg_name`.
- `generate_gcp_terraform(state: dict) -> str` — renders `gcp_ncc_stack.tf.j2` (Network Connectivity Center); vars include `project, cloud_router_asn`.

**Notes:** Multicloud templates live in `backend/templates/multicloud/*.tf.j2` and use `StrictUndefined` — missing template vars raise errors.

---

### 8. `backend/jobs/deploy_job.py`

**Purpose:** Async deployment pipeline (`pre_checks → deploy → post_checks`, with auto-rollback) executed via Celery (if `REDIS_URL` set) or synchronously as a fallback. Publishes stage events to Redis pub/sub channel `deploy:{deployment_id}` for the WebSocket relay (`api/ws.py`).

**Key exports/classes:**
- `celery_app` — `Celery("netdesign", broker=REDIS_URL, backend=REDIS_URL)` if `REDIS_URL` set and `celery` importable, else `None`. `CELERY_AVAILABLE: bool`.
- `_get_sync_redis()` — returns sync `redis.Redis` client or `None`.
- `_publish_event(r_client, deployment_id, stage, status, detail="", data=None)` — publishes JSON `{deployment_id, stage, status, detail, ts, **data}` to `deploy:{deployment_id}`.
- `_update_deployment_status(deployment_id, status, extra=None)` — updates the `Deployment` SQLAlchemy row's `.status` (and `.completed_at` if terminal) — runs its own asyncio loop inside the Celery worker thread.
- `_run_pipeline(deployment_id, state, inventory, dry_run, configs, r_client) -> str` — **core pipeline**, shared by Celery task and sync fallback:
  1. `pre_checks` stage → `nornir_tasks.run_pre_checks(state, inventory, deployment_id)`. If any fail → publish `error/terminal`, mark `failed`, return `"failed"`.
  2. `deploy` stage → `nornir_tasks.deploy_configs(configs, inventory, dry_run, deployment_id)`. On exception or failure (non-dry-run) → `_initiate_rollback`, return `"rolled_back"`.
  3. `post_checks` stage → `nornir_tasks.run_post_checks(state, inventory)`. On exception or failure (non-dry-run) → `_initiate_rollback`, return `"rolled_back"`.
  4. On full success → publish `post_checks/terminal`, mark `success`, return `"success"`.
- `_initiate_rollback(r_client, deployment_id, inventory)` — restores per-device backups from `{BACKUP_DIR}/{deployment_id}/{hostname}.cfg` via `nornir_netmiko.tasks.netmiko_send_config`; publishes `rollback/terminal`; marks deployment `rolled_back`.
- **If Celery available:** `@celery_app.task run_deployment(self, deployment_id, state, inventory, dry_run, configs) -> dict` — `{"deployment_id":..., "status": final_status}`. Call via `.delay(...)`.
- **If Celery NOT available:** `run_deployment = _SyncDeployStub()` — exposes `.delay(...)` (blocking, runs `_run_pipeline` synchronously) and `__call__(...)` for direct invocation, so `from jobs.deploy_job import run_deployment; run_deployment.delay(...)` always works regardless of Celery availability.

**Relation to `WS /ws/deploy/{id}`:** `_run_pipeline`'s `_publish_event` calls are the sole producer for the Redis channel `deploy:{deployment_id}`; `api/ws.py`'s `deployment_stream` is the consumer that relays these JSON messages verbatim to the browser over WebSocket.

---

### 9. Licensing System (`backend/licensing/`)

#### `backend/licensing/fingerprint.py`
**Purpose:** Generate/persist a stable per-instance machine ID used to bind license keys to a specific deployment.

**Key export:**
- `get_machine_id() -> str` — resolution order: (1) `{BACKUP_DIR}/.machine_id` (Docker volume-persisted UUID, created on first call), (2) `/etc/machine-id` (systemd), (3) `~/.netdesign_machine_id` (dev fallback), (4) ephemeral `_derive_from_system()` (hostname + first non-loopback MAC, SHA-256 hashed).
- `_normalize(raw: str) -> str` — returns lowercase 32-hex-char ID (SHA-256 if input < 32 chars after stripping `-`/`:`).

---

#### `backend/licensing/models.py`
**Purpose:** License tier definitions, feature flags, device limits.

**Key exports:**
- `class LicenseTier(str, Enum)`: `COMMUNITY, PROFESSIONAL, ENTERPRISE`
- `_TIER_FEATURES: dict[LicenseTier, set[str]]` — COMMUNITY = `{config_gen, mcp_tools, simulation, policy_engine, static_analysis}`; PROFESSIONAL adds `{deploy, ztp, backup, rollback, jwt_auth, design_persistence}`; ENTERPRISE adds `{rca, telemetry, audit_export, white_label, sso, priority_support}`.
- `_TIER_MAX_DEVICES`: COMMUNITY=0 (deploy blocked entirely), PROFESSIONAL=50, ENTERPRISE=9999.
- `@dataclass LicenseInfo`: `tier, licensee, machine_id, license_id, issued_at, expires_at, max_devices, features, valid=True, expiry_warning=False, error=None`. Methods: `has_feature(feature) -> bool`, `to_dict() -> dict`.
- `COMMUNITY_LICENSE: LicenseInfo` — always-available free fallback (`machine_id="*"`, `max_devices=0`, no expiry).
- `features_for_tier(tier) -> set[str]`, `max_devices_for_tier(tier) -> int`.

---

#### `backend/licensing/validator.py`
**Purpose:** Offline validation of `nd.<base64url(payload_json)>.<base64url(ed25519_sig)>` license keys.

**Key export:**
- `validate_license_key(license_key: str) -> LicenseInfo` — steps: (1) empty key → `COMMUNITY_LICENSE`; (2) must start `"nd."` and have 3 dot-separated parts; (3) base64url-decode payload+signature; (4) verify Ed25519 signature against hardcoded `_PUBLIC_KEY_B64` (skips check with warning if `cryptography` not installed); (5) parse JSON payload, require fields `{license_id, licensee, tier, machine_id, issued_at, max_devices, features}`; (6) if `machine_id != "*"`, must match `get_machine_id()`; (7) check `expires_at` against now + 72h grace period (`_EXPIRY_GRACE`), set `expiry_warning=True` if within 14 days (`_EXPIRY_WARN_DAYS`); (8) merge payload features with tier baseline features. On any failure returns a copy of `COMMUNITY_LICENSE` with `valid=False, error=<reason>` via `_invalid(reason)`.

**Notes:** The actual signing key (private Ed25519 key) is never present in this repo — only the public key for verification.

---

### 10. Services (`backend/services/`)

#### `backend/services/email_service.py`
**Purpose:** Transactional email via Resend API (`api.resend.com`). No-ops gracefully if `RESEND_API_KEY` env var unset.

**Key exports** (all `async`, return `bool`):
- `async def send_purchase_confirmation(to: str, license_key: str, plan: str, seats: int, expires_at: str) -> bool` — sends license key + activation instructions (web/Docker/desktop) after Stripe payment. `plan` ∈ `{pro, team, dept}`.
- `async def send_deploy_report(to: str, design_name: str, deployment_id: str, status: str, summary: dict[str, Any]) -> bool` — `status` ∈ `{success, failed, partial}`; renders `summary` dict as HTML table rows.
- `async def send_renewal_reminder(to: str, license_key: str, plan: str, expires_at: str, days_left: int) -> bool` — 30-day-out warning, urgent styling if `days_left <= 7`.
- `_send(to, subject, html) -> bool` (private) — `POST https://api.resend.com/emails` with `{from, to, subject, html}`.

**Env vars:** `RESEND_API_KEY`, `EMAIL_FROM` (default `"NetDesign AI <noreply@netdesignai.com>"`), `STRIPE_BILLING_PORTAL_URL`.

---

#### `backend/services/pinecone_service.py`
**Purpose:** Design-similarity search — embeds design intents via OpenAI and stores/queries vectors in Pinecone. No-ops if env vars not set.

**Key exports:**
- `async def embed_design(design_id: str, intent: dict, topology_params: dict, use_case: str = "unknown", vendor: str = "multi", design_name: str = "", owner_id: str = "", saved_at: str = "") -> bool` — builds embed text via `_build_embed_text`, calls OpenAI `text-embedding-3-small` (`POST https://api.openai.com/v1/embeddings`), upserts to Pinecone (`POST {PINECONE_HOST}/vectors/upsert`, namespace `"designs"`).
- `async def find_similar(intent: dict, topology_params: dict | None = None, use_case: str = "", vendor: str = "", top_k: int = 3) -> list[dict]` — embeds query, `POST {PINECONE_HOST}/query`, filters results by `score >= SIMILARITY_THRESHOLD (0.75)`. Returns list of `{id, design_name, use_case, vendor, intent_summary, score, saved_at}`.
- `_build_embed_text(intent, topology_params, use_case, vendor) -> str` (private) — concatenates `use_case:`, `vendor:`, `intent: <json[:400]>`, `topology: <json[:400]>`.

**Env vars:** `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX` (default `"netdesign-designs"`), `PINECONE_HOST`. `EMBED_DIM = 1536`.

---

### 11. `backend/api/ws.py` — WebSocket Endpoints

**Purpose:** Bridges Redis pub/sub deployment events (published by `jobs/deploy_job.py`) to the browser over WebSocket.

**Endpoint:**
- `WS /ws/deploy/{deployment_id}` (wired in `main.py` calling `deployment_stream(websocket, deployment_id)`)

**Key export:**
- `async def deployment_stream(websocket: WebSocket, deployment_id: str) -> None`
  1. `await websocket.accept()`.
  2. If `REDIS_URL` not set → send one terminal error message `{deployment_id, stage:"error", status:"terminal", detail:"Redis not configured — live streaming unavailable"}` and close.
  3. If `redis.asyncio` (`redis[hiredis]`) not installed → similar terminal error message.
  4. Otherwise: subscribe to Redis channel `deploy:{deployment_id}`, drain the subscribe-confirmation, then loop:
     - `pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)`.
     - If no message → send `{"type":"ping"}` keepalive.
     - If message → forward `message["data"]` **verbatim** (raw JSON string) to the WebSocket client.
     - Parse the forwarded JSON; if `stage in {"post_checks","error","rollback"}` and `status == "terminal"` → break (close stream).
  5. `finally`: unsubscribe, close pubsub + Redis connection, close WebSocket.

**Message format (forwarded verbatim from `_publish_event` in `jobs/deploy_job.py`):**
```json
{
  "deployment_id": "...",
  "stage": "pre_checks | deploy | post_checks | rollback | error",
  "status": "running | passed | failed | success | error | terminal",
  "detail": "human-readable string",
  "ts": 1234567890.123,
  "results": [ ... ]   // optional, stage-specific data
}
```
Plus periodic `{"type": "ping"}` keepalives (no `stage`/`status` fields — client should ignore these for terminal-detection but may use them to reset its own timeout).
