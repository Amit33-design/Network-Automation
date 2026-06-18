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
10. [Frontend — Components (`HLDTopologyDiagram`, `LLDTopologyDiagram`, Sidebar, panels)](#frontend--components)
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

**Intent NLP parser (G-A1)**
- `IntentParseResult` — `{ use_case, app_types[], scale, redundancy, compliance[], org_name, org_size, budget_tier, vendor_prefs[], industry, primary_contact, confidence, notes, source: 'ai'|'heuristic' }`. Mirrors `backend/intent_ai.RESPONSE_SCHEMA` + `source`.

**Config drift detection (G-A4)**
- `ConfigDriftDevice` — `{ hostname, has_drift, added: string[], removed: string[], unified_diff, no_baseline }`. Mirrors `backend.main.ConfigDriftDevice`.
- `ConfigDriftResponse` — `{ devices: ConfigDriftDevice[], drift_count, device_count }`. Mirrors `backend.main.ConfigDriftResponse`.

**Config drift remediation (G-A16)**
- `RemediationDeviceInput` — `{ hostname, platform, added: string[], removed: string[] }`. Request shape per device.
- `RemediationDevice` — `{ hostname, platform, commands: string[], command_count }`. Mirrors `backend.main.RemediationDevice`.
- `ConfigRemediationResponse` — `{ devices: RemediationDevice[] }`. Mirrors `backend.main.ConfigRemediationResponse`.

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
- **`computeTCO(devices, opts?): TCOModel`** *(G-A13, 2026-06-18)* — 3-year
  TCO layered on the BOM (additive; does not affect device-count/capex math).
  Capex = Σ `device.totalPrice`. 3-yr opex = power (Σ `powerW` looked up per
  model from `PRODUCTS` → kWh/yr × PUE × $/kWh) + support (%/yr × capex) +
  rack/colo (RU by `subLayer` × $/RU/mo × 12). Rates via `TCOOpts` /
  `DEFAULT_TCO_OPTS` (default $0.12/kWh, PUE 1.5, support 15%/yr, $150/RU/mo,
  3 yrs, 400W fallback). Returns per-category 3-yr subtotals, `annual`,
  `byYear[]`, `total`, `totalPowerW`, `totalRackUnits`, echoed `rates`.
  Surfaced as the "3-Year Total Cost of Ownership" card in Step 4 Summary
  tab. Tests: `test/tco.test.ts` (11).
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
  *(added 2026-06-11, Enterprise Upgrade A1; exported for D1)* — derives
  HA-pair metadata purely from `idx` and `dev.hostname`, matching
  `generateHostnames()`'s pairing convention:
  - `pairId = Math.floor(idx/2) + 1` — shared by idx 0&1, 2&3, ...
  - `isPrimary = idx % 2 === 0` — even idx = primary/active/root.
  - `peerHostname` — flips the trailing `01`↔`02` on `dev.hostname` (e.g.
    `IAD-LEAF-A01` ↔ `IAD-LEAF-A02`).
  - `domainId` — `dev.hostname` with the trailing `01`/`02` stripped (e.g.
    `IAD-LEAF-A`) — a stable ID shared by both pair members, used for vPC
    domain numbers / MLAG domain-id / STP comments.
  - Used by `nxosLeafConfig`, `aristaLeafConfig`, and `iosxeCampusConfig`.
  - Exported (Enterprise Upgrade D1, 2026-06-11) and re-used by
    `Step4NetworkDesign.tsx`'s `genComputedTopology()` to derive the same
    vPC/MLAG pairing + FHRP gateway summary from real BOM devices, so the
    design summary/HLD agree with the generated configs.
- **`closFabricLinks(role, dev, allDevices): FabricLink[]`** *(added
  2026-06-11, Enterprise Upgrade A5)* — derives the spine↔leaf CLOS link
  plan from BOM port-math instead of a static comment block:
  - `spineCount`/`leafCount` = counts of `subLayer==='spine'|'leaf'` in
    `allDevices` (fallback 2/1 if `allDevices` is empty, e.g. existing
    single-device test calls).
  - `leafUplinks = leaves[0]?.uplinks || dev.uplinks || 2` — number of
    fabric-facing ports per leaf, taken from the leaf SKU's `uplinks` field
    (set by `buildDeviceList()` from `PRODUCTS`).
  - For `role==='leaf'`: distributes the leaf's `leafUplinks` ports
    round-robin across spines (`spineIdx = i % spineCount`, `linkNum =
    floor(i/spineCount)` for parallel links to the same spine).
  - For `role==='spine'`: iterates every leaf and reproduces only the links
    that round-robin to *this* spine, so both ends compute the same plan
    independently.
  - Each `FabricLink` carries `ifIndex` (0-based local port offset),
    `peerHostname` (real hostname from `allDevices`, else `SPINE-N`/`LEAF-N`),
    `peerLabel` (e.g. `"spine 1"`), `linkNum`, and `localIp` — a `/31`
    computed as `10.99.${leafNum}.${(spineNum-1)*16 + linkNum*2 [+1 for
    leaf]}` so the spine and leaf side of each link always agree on the same
    subnet without manual cabling notes.
- **`renderNxosFabricLinks(role, dev, allDevices, ipv6Enabled = false): string`**
  / **`renderAristaFabricLinks(role, dev, allDevices, ipv6Enabled = false):
  string`** *(added 2026-06-11, Enterprise Upgrade A5; `ipv6Enabled` param
  added same day, Enterprise Upgrade A6)* — render `closFabricLinks()` output
  as real (uncommented) interface stanzas:
  - NX-OS: `interface Ethernet1/${portBase + ifIndex + 1}` with `ip router
    isis 1`, `isis network point-to-point`, `isis metric 10`, `mtu 9216`.
  - Arista: `interface Ethernet${portBase + ifIndex + 1}` with `isis enable
    UNDERLAY`, `isis network point-to-point`, `isis metric 10`, `mtu 9214`.
  - `portBase = (dev.ports - dev.uplinks)` for leaves (uplinks start after
    the downlink ports), `0` for spines (all ports face leaves).
  - `dirLabel` = `"UPLINK"` for leaves, `"DOWNLINK"` for spines.
  - When `ipv6Enabled`, each stanza also gets `ipv6 address ${link.localIpv6}`
    (a `/127` mirroring the IPv4 `/31`, e.g. `fd00:99:1::1/127` for
    `10.99.1.1/31`); NX-OS additionally gets `ipv6 router isis 1`.
- **IPv6 dual-stack underlay helpers (Enterprise Upgrade A6, 2026-06-11)** —
  gated by `protoFeatures.includes('IPv6 Dual-Stack')` (the existing
  `'IPv6 Dual-Stack'` chip in Step 2's Protocol Features list, previously
  unused by configgen). Applies to NX-OS + Arista IS-IS DC/GPU spine-leaf
  only (loopbacks + fabric P2P links); OSPFv3 for campus/WAN is a possible
  follow-up.
  - `FabricLink.localIpv6` — `/127` ULA address on each fabric link, computed
    by `closFabricLinks()` as `fd00:99:${leafNum}::${octet[+1]}/127` (same
    `octet` formula as the IPv4 `/31`).
  - `nxosIpv6LoopbackLines(addr, ipv6Enabled)` /
    `aristaIpv6LoopbackLines(addr, ipv6Enabled)` — append `ipv6 address
    ${addr}/128` (NX-OS also adds `ipv6 router isis 1`) to a loopback
    interface when enabled, else `''`.
  - `nxosIsisIpv6AddressFamily(ipv6Enabled, redistribute = false)` /
    `aristaIsisIpv6AddressFamily(ipv6Enabled)` — render `address-family ipv6
    unicast` (with `maximum-paths 64`, plus `redistribute direct route-map
    CONNECTED-TO-ISIS` when `redistribute` is true — used for spines, mirrors
    the IPv4 AF) under `router isis`/`router isis UNDERLAY`, else `''`.
  - Router-ID loopback IPv6 addresses follow `fd00:255:1::${idx+1}` (spine)
    and `fd00:255:2::${idx+1}` (leaf), mirroring `10.255.1.${idx+1}` /
    `10.255.2.${idx+1}`. The VTEP loopback (`loopback1`/`Loopback1`) stays
    IPv4-only — VXLAN underlay transport is unchanged by this flag.
- **`DCI_RT_ASN = 65100` (Enterprise Upgrade A7, 2026-06-11)** — module-level
  constant: the shared multisite DCI route-target namespace. When
  `useCase === 'multisite'`, `generateConfig` passes `isMultisite = true` to
  `nxosLeafConfig`/`aristaLeafConfig` (new 6th param, default `false`), which
  then emit explicit `${DCI_RT_ASN}:<vni>` import/export RTs *alongside* the
  site-local RTs (`auto` on NX-OS, fabric-ASN `65000:<vni>` on Arista) — so
  cross-site EVPN leaking is opt-in per VNI and identical on every site.
  Spine RRs need no change (`retain route-target all` already present).
  Exported (Enterprise Upgrade D1, 2026-06-11) and re-used by
  `Step4NetworkDesign.tsx`'s `genComputedTopology()` and by
  `HLDTopologyDiagram.tsx`'s multisite leaf feature annotations
  (`EVPN DCI Type-5 · RT ${DCI_RT_ASN}:10010 (L2) / ${DCI_RT_ASN}:50000 (L3)`).

### NX-OS (Cisco) — DC/GPU spine-leaf
- **`nxosSpineConfig(dev, idx, isGpu, allDevices = [], protoFeatures = []):
  string`** *(`allDevices` param added 2026-06-11, Enterprise Upgrade A5;
  `protoFeatures` param added same day, Enterprise Upgrade A6)* —
  `spineAsn = 65000` (constant), `routerId = 10.255.1.${idx+1}`, `isisNet =
  49.0001.0102.5500.${pad(idx+1,4)}.00`. IS-IS L2-only underlay, BGP EVPN
  with route-reflector `template peer LEAF-RR-CLIENT`, **SPINE FABRIC
  INTERFACES** generated via `renderNxosFabricLinks('spine', dev,
  allDevices, ipv6Underlay)` (replaces the old static comment template),
  NX-API gRPC telemetry block (`destination-group`/`sensor-group`/
  `subscription`), QoS via `nxosGpuQoS()` or `nxosStdQoS()`. When
  `protoFeatures.includes('IPv6 Dual-Stack')`, also adds `ipv6 address
  fd00:255:1::${idx+1}/128` + `ipv6 router isis 1` to `loopback0` and
  `address-family ipv6 unicast` (with redistribute) under `router isis 1`
  (Enterprise Upgrade A6).
- **`nxosLeafConfig(dev, idx, isGpu, allDevices = [], protoFeatures = []):
  string`** *(`allDevices` param added 2026-06-11, Enterprise Upgrade A5;
  `protoFeatures` param added same day, Enterprise Upgrade A6)* —
  `leafAsn = 65001+idx`, `routerId = 10.255.2.${idx+1}`, `vtepIp =
  10.254.0.${idx+1}`, `isisNet = 49.0001.0102.5501.${pad(idx+1,4)}.00`. IS-IS
  underlay, BGP EVPN `template peer SPINE-RR`, VXLAN `interface nve1` (VNI
  10010 + L3VNI 50000), **UPLINKS** generated via `renderNxosFabricLinks('leaf',
  dev, allDevices, ipv6Underlay)`, NX-API telemetry. **vPC block** (post
  Enterprise Upgrade A1): `vpc domain ${pairId}` (shared by the HA pair),
  `role priority` 8192 (primary)/16384 (secondary), `peer-switch`,
  `peer-keepalive destination <CHANGE-ME-${peerHostname}-mgmt-ip> ...`,
  `peer-gateway`, `ip arp synchronize`, `auto-recovery`. IPv6 dual-stack
  (A6) adds `ipv6 address fd00:255:2::${idx+1}/128` + `ipv6 router isis 1`
  to `loopback0` and `address-family ipv6 unicast` under `router isis 1`
  when `protoFeatures.includes('IPv6 Dual-Stack')`. Post A7 (2026-06-11):
  signature gains `isMultisite = false` (6th param); always emits an **EVPN
  MAC-VRF block** (`evpn` → `vni 10010 l2` → `rd auto` + auto RTs) and the
  NVE member-VNI roles were fixed to match CLAUDE.md §10 (L2VNI 10010 →
  `ingress-replication protocol bgp`, L3VNI 50000 → `associate-vrf`); when
  `isMultisite`, the TENANT-A VRF and the MAC-VRF additionally import/export
  `65100:50000` / `65100:10010` DCI route-targets.
- **`nxosStdQoS(): string`** / **`nxosGpuQoS(): string`** — standard 4-class
  DSCP QoS vs full RoCEv2 QoS (PFC priority-3 lossless `pause no-drop`,
  RDMA class `bandwidth percent 60`, ECN `congestion-control ecn` +
  `random-detect` on lossy queues, `hardware qos pfc-watchdog on`, DCQCN).

### Arista EOS — DC/GPU spine-leaf
- **`aristaSpineConfig(dev, idx, isGpu, allDevices = [], protoFeatures = []):
  string`** *(`allDevices` param added 2026-06-11, Enterprise Upgrade A5;
  `protoFeatures` param added same day, Enterprise Upgrade A6)* —
  `asn = 65000`, `routerId = 10.255.1.${idx+1}`, `isisNet =
  0101.0255.000${idx+1}`. `service routing protocols model multi-agent`,
  `router isis UNDERLAY` (level-2, `fast-reroute ti-lfa`), BGP EVPN
  `peer-group LEAF-RR-CLIENTS` (route-reflector-client, `bfd`),
  **DOWNLINK INTERFACES** generated via `renderAristaFabricLinks('spine',
  dev, allDevices, ipv6Underlay)`, QoS via `aristaGpuQoS()` if GPU, plus
  `aristaTelemetryBlock()` (gNMI/eAPI/TerminAttr — see below). When
  `protoFeatures.includes('IPv6 Dual-Stack')`, also adds `address-family
  ipv6 unicast` under `router isis UNDERLAY` and `ipv6 address
  fd00:255:1::${idx+1}/128` to `Loopback0` (Enterprise Upgrade A6).
- **`aristaLeafConfig(dev, idx, isGpu, allDevices = [], protoFeatures = []):
  string`** *(`allDevices` param added 2026-06-11, Enterprise Upgrade A5;
  `protoFeatures` param added same day, Enterprise Upgrade A6)* —
  `leafAsn = 65001+idx`, `routerId = 10.255.2.${idx+1}`, `vtepIp =
  10.254.0.${idx+1}`, `isisNet = 0101.0255.000${idx+101}`. BGP
  `peer-group SPINE-RR` with `bfd`, VXLAN `interface Vxlan1` (`vxlan vlan 10
  vni 10010`), **UPLINKS to spines** generated via
  `renderAristaFabricLinks('leaf', dev, allDevices, ipv6Underlay)`. **MLAG
  block** (post Enterprise Upgrade A2, previously absent): `vlan
  4094`/`interface Vlan4094` for peer L3 peering, `interface
  Port-Channel${pairId}00` peer-link, `mlag configuration` with `domain-id
  ${domainId}MLAG${pairId}`, `peer-address
  <CHANGE-ME-${peerHostname}-mlag-peer-ip>`, `peer-link
  Port-Channel${pairId}00`, plus `aristaTelemetryBlock()`. IPv6 dual-stack
  (A6) adds `address-family ipv6 unicast` under `router isis UNDERLAY` and
  `ipv6 address fd00:255:2::${idx+1}/128` to `Loopback0` when
  `protoFeatures.includes('IPv6 Dual-Stack')`. Post A7 (2026-06-11):
  signature gains `isMultisite = false` (6th param); always emits a
  **MAC-VRF `vlan 10` section** under `router bgp` (`rd
  ${routerId}:10010`, `route-target both 65000:10010` — fabric-ASN-scoped
  so all leaves in the site share it — `redistribute learned`, previously
  absent entirely); when `isMultisite`, adds `route-target import/export
  evpn 65100:10010` DCI RTs.
- **`aristaGpuQoS(): string`** — PFC priority 3 RoCEv2 (`pfc enable`, `pfc
  priority 3 no-drop`), ECN on lossy queues.
- **`aristaTelemetryBlock(): string`** *(added 2026-06-11, Enterprise Upgrade
  A4)* — Arista streaming-telemetry/automation block, appended to both
  `aristaSpineConfig` and `aristaLeafConfig`: `management api gnmi` (gRPC
  transport on port 6030, `provider eos-native`), `management api
  http-commands` (eAPI over HTTPS/443, `vrf MGMT`), and `daemon TerminAttr`
  streaming to `<CHANGE-ME-telemetry-collector-ip>:9910` (CloudVision/gNMI
  collector ingest).

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

### Cisco Catalyst SD-WAN (cEdge / vEdge / Controllers) — *added 2026-06-18, gap G-A12*
- **`isSdWanEdge(dev): boolean`** — dispatch discriminator: true when device
  has `subLayer === 'wan-edge'` AND `features` includes `'SD-WAN'` AND NOT
  `'IOS-XR'`. Ensures IOS-XR platforms (ASR 9xxx) are not misrouted.
- **`sdwanEdgeConfig(dev, idx): string`** — Cisco Catalyst SD-WAN cEdge/vEdge
  configuration in SD-WAN CLI syntax (NOT traditional IOS-XE):
  `system` block (`system-ip`, `site-id`, `organization-name`, `vbond`),
  `vpn 0` transport (dual WAN — INET `color biz-internet` + MPLS `color mpls`,
  `tunnel-interface` with `encapsulation ipsec`),
  `vpn 512` management (OOB),
  `vpn 1` service (CORPORATE-LAN) + `vpn 2` (GUEST-IOT),
  `omp` (graceful-restart, advertise connected/static/ospf),
  zone-based firewall (EDGE-FW policy, zone-pair LAN→WAN, default-action drop),
  `app-route-policy` (VOICE-VIDEO → SLA `preferred-color mpls`, SAAS-APPS →
  `preferred-color biz-internet`), SLA classes (VOICE-SLA: latency 150 /
  loss 1 / jitter 30), `qos-map` (4 queues: LLQ voice, WRR
  interactive-video / critical-data / best-effort). Unique `site-id` per
  device index (100 + idx). Secrets `<CHANGE-ME-*>`.
- **`sdwanControllerConfig(dev, idx): string`** — SD-WAN controller config
  generator for vManage, vSmart, and vBond. Detects role from `dev.model`:
  - **vSmart**: OMP route reflector (`send-path-limit 4`, `ecmp-limit 4`,
    `send-backup-paths`), VPN 0 transport.
  - **vBond**: `vbond … local` directive, `ge0/0` WAN-facing interface,
    VPN 0 transport with IPSec.
  - **vManage**: VPN 0 transport + VPN 512 OOB management.
  All controllers use `site-id 1000`. Secrets `<CHANGE-ME-*>`.
- **Dispatch order** in `generateConfig`: SD-WAN controller → `sdwanControllerConfig`;
  SD-WAN edge → `sdwanEdgeConfig`; IOS-XR → `iosxrPeConfig`; else → `iosxeWanConfig`.
- **BOM integration**: `buildDeviceList` accepts optional `overlayProtocols`.
  When overlay includes 'SD-WAN' and use case is wan/multisite/multicloud:
  injects vManage (1) + vSmart (2 HA) + vBond (2 HA) as `sdwan-controller`
  subLayer; swaps non-AppQoE WAN edges to Catalyst 8300 cEdge.
- **Products**: `sdwan-vmanage`, `sdwan-vsmart`, `sdwan-vbond` (subLayer
  `sdwan-controller`), `cat8300-edge` (subLayer `wan-edge`).
- **Tests**: 28 tests in `test/sdwan.test.ts`.

### Cisco IOS-XR SP/WAN (PE/P) — *added 2026-06-18, gap G-A9*
- **`iosxrPeConfig(dev, idx): string`** — full IOS-XR PE/P generator emitting
  true IOS-XR syntax (NOT IOS-XE): `GigabitEthernet0/0/0/0`/`Loopback0`/
  `MgmtEth0/RP0/CPU0/0` naming, `!` separators, IOS-XR AAA (`secret 10`),
  `route-policy … end-policy` (not `route-map`), `segment-routing` global
  block + `router isis CORE … segment-routing mpls` with `prefix-sid index`
  on Loopback0 + TI-LFA, L3VPN `vrf CUST-A` import/export route-targets,
  `router bgp … address-family vpnv4 unicast` (RR-client neighbor-group +
  PE-CE eBGP in VRF), gNMI telemetry. Single underlay **IS-IS+SR only** (no
  OSPF, per §6 rule 4). Secrets `<CHANGE-ME-*>`, one mgmt/AAA block.
- **`isIosXrPlatform(dev): boolean`** — dispatch discriminator: true when
  `dev.features` includes `IOS-XR` or model matches `ASR 9xxx`/`NCS`/`CRS`/
  `IOS-XRv`. Dispatch order in `generateConfig`: Cisco wan-edge + IOS-XR →
  `iosxrPeConfig`; else Cisco wan-edge → `iosxeWanConfig` (ASR 1xxx, vEdge).
  SKUs `ASR 9904` + `NCS 540` added to `lib/products.ts`. Tests: 9 in the
  `Gap G-A9` describe block of `test/configgen.test.ts`.

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
  appTypes: AppType[] = [], allDevices: BOMDevice[] = [], protoFeatures:
  string[] = []): string`** *(signature extended 2026-06-11 to add
  `appTypes`, then `allDevices` — Enterprise Upgrade A5 — then
  `protoFeatures` — Enterprise Upgrade A6)* — the big if/else dispatcher by
  `(dev.vendor, dev.subLayer)`. `needsRoce = isGpu ||
  ((vendor==='Dell EMC'||vendor==='NVIDIA') && useCase==='dc')` — Dell/NVIDIA
  DC fabrics always get lossless QoS; Cisco/Arista only when
  `useCase==='gpu'`. Cisco `distribution`/`access` →
  `iosxeCampusConfig(dev, idx, appTypes)`. The Cisco/Arista spine and leaf
  branches (`nxosSpineConfig`, `nxosLeafConfig`, `aristaSpineConfig`,
  `aristaLeafConfig`) receive `allDevices` so they can compute
  topology-driven CLOS fabric links via
  `closFabricLinks()`/`renderNxosFabricLinks()`/`renderAristaFabricLinks()`,
  and `protoFeatures` so they can enable the IPv6 dual-stack underlay (A6)
  when `protoFeatures.includes('IPv6 Dual-Stack')`. The two leaf branches
  additionally receive `useCase === 'multisite'` as `isMultisite` to emit
  DCI route-targets (A7 — see `DCI_RT_ASN` under Shared helpers).
- **`generateAllConfigs(devices, useCase = '', policyBlocks = [], appTypes =
  [], protoFeatures = [])`** *(signature extended 2026-06-11; A5 — threads
  `allDevices`; A6 — threads `protoFeatures`)* — maps `generateConfig(dev, i,
  useCase, appTypes, devices, protoFeatures)` over all devices (passing the
  full `devices` array as `allDevices` to every call), then runs
  `applyPolicies()` (from `lib/policies.ts`) if `policyBlocks.length`. Called
  from `Step3Config.tsx` with `appTypes` and `protoFeatures` from the store.

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
- WAN/Edge: ASR 1002-HX, Catalyst SD-WAN vEdge 2000, Catalyst 8300 Edge (cEdge)
- SD-WAN Controllers: vManage, vSmart Controller, vBond Orchestrator
- IOS-XR SP/WAN: ASR 9904, NCS 540
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

## Frontend — `lib/netbox.ts` (NetBox/Nautobot import — Enterprise Upgrade B1)

**Purpose:** Reads existing inventory from a NetBox or Nautobot instance
(same REST paths: `/api/dcim/sites/`, `/api/dcim/devices/`,
`/api/ipam/prefixes/`, `/api/tenancy/tenants/`) and maps it to Step 1 form
fields plus a normalized device list (`netboxDevices` store field) for the
Step 6 ZTP tab (B2). Ported from legacy `src/js/netbox.js` 2026-06-11.
Browser fetch requires CORS configured on the NetBox instance for this
app's origin.

**Key exports:**
- Raw API shapes (subset): `NetBoxRawDevice` (handles both `role` —
  NetBox ≥3.6/Nautobot — and legacy `device_role`), `NetBoxRawSite`,
  `NetBoxRawTenant`, `NetBoxRawPrefix`, `NetBoxInventory { sites, devices,
  prefixes, tenants }`.
- `normalizeVendor(name): string | null` — manufacturer name → app vendor
  label via slugified lookup (e.g. `"Arista Networks"` → `"Arista"`,
  `"Mellanox"` → `"NVIDIA"`, `"Dell Technologies"` → `"Dell EMC"`); null if
  unknown.
- `roleToUseCase(roleSlug): UseCase | null` — device-role heuristic
  (leaf/spine/tor → `dc`, access/distribution/core/wlc → `campus`,
  gpu/compute/storage → `gpu`, wan/cpe/router/sdwan → `wan`).
- `orgSizeFromDeviceCount(n): OrgSize` — <15 `startup`, <80 `smb`, <400
  `midmarket`, <2000 `enterprise`, else `hyperscale` (matches the Step 1
  OrgSize select, unlike the legacy small/medium/large buckets).
- `fetchNetBoxInventory(url, token, fetchImpl = fetch): Promise<NetBoxInventory>`
  — fetches all four endpoints in parallel with `Authorization: Token …`;
  paginates at 200/page (first page sequential, remaining pages parallel);
  prefixes/tenants fail soft to `[]`, sites/devices throw. `fetchImpl` is
  injectable for tests.
- `summarizeInventory(inv): NetBoxImportPreview { orgName, siteCount,
  deviceCount, orgSize, vendors, useCaseHint, useCaseVotes }` — org name from
  first tenant else first site; use-case hint by role-vote majority.
- `toImportedDevices(inv): NetBoxImportedDevice[]` — normalized `{ name,
  vendor, model, role, site, primaryIp }` rows (skips unnamed devices).
- `inventoryToStorePatch(inv): NetBoxStorePatch` — pure mapping to
  `{ orgName?, numSites?, orgSize?, vendorPrefs?, netboxDevices }`; optional
  fields omitted when the inventory can't infer them.
- `SAMPLE_INVENTORY` — canned 24-device 2-site inventory (Cisco spines/leaves
  + Arista leaves) powering the panel's "Try sample data" demo flow.

**UI:** `components/NetBoxImportPanel.tsx` — Card rendered in
`Step1UseCase.tsx` between the use-case tiles and Organisation Details. URL +
API-token inputs (URL persisted to localStorage key `netdesign_netbox_url`;
token deliberately kept in memory only), "Connect & Preview" (live fetch,
CORS hint shown on error), "Try sample data" (loads `SAMPLE_INVENTORY`),
preview table (org name / sites / org size / vendors / use-case hint with
"Will set" column), "Apply to Form" (calls `setOrgName`/`setNumSites`/
`setOrgSize`/`setVendorPrefs`/`setNetboxDevices`) and "Clear". Uses
`useToast()` for status messages.

**Tests:** `src/test/netbox.test.ts` — 13 tests covering vendor/role/size
mapping, summarize/patch behavior (including legacy `device_role` and
fallbacks), pagination (450 devices → 3 pages), auth-header propagation, and
fail-soft vs fail-hard endpoints.

---

## Frontend — `lib/telemetry-gen.ts` (streaming telemetry / observability — Enterprise Upgrade C1)

**Purpose:** Generates collector- and dashboard-side observability configs
that pair with the gNMI/eAPI telemetry blocks `configgen.ts` already emits
on-device. Ported from legacy `src/js/telemetry.js` 2026-06-11, rebased onto
`BOMDevice[]` instead of the legacy `buildDeviceList()`. SNMP/syslog/NetFlow
collector configs were already covered by `buildGrokPatternsConfig()` /
`buildNetflowConfig()` (M-51/M-52, in `Step6Deploy.tsx`) — this module adds
the gNMI/Prometheus/Grafana side.

**Key exports:**
- `GNMI_SUBS: { name, interval, paths[] }[]` — 5 OpenConfig subscription
  groups: `interface-state` (10s), `bgp-neighbors` (30s), `platform-cpu`
  (30s), `platform-memory` (30s), `igp-neighbors` (30s, IS-IS + OSPF
  adjacency paths).
- `GNMI_PORT: Record<string, number>` — gNMI port per NOS:
  `ios-xe:9339, nxos:50051, eos:6030, junos:32767, sonic:8080`.
- `TelemetryTarget { name, hostname, mgmtIp, port, os, role }` and
  `buildTelemetryTargets(devices: BOMDevice[]): TelemetryTarget[]` —
  expands each `BOMDevice` into up to 4 numbered instances
  (`${hostname}-01..04`), skips `subLayer === 'firewall'`, derives `os` from
  vendor+subLayer (Cisco spine/leaf → `nxos`, other Cisco → `ios-xe`,
  Arista → `eos`, Juniper → `junos`, Dell EMC/NVIDIA → `sonic`, else `eos`),
  and assigns sequential `10.0.0.11`, `.12`, ... management IPs.
- `genGNMICCollectorConfig(devices, orgName = ''): string` — `gnmic.yml`:
  per-target `targets:` entries (address:port, `${DEVICE_PASSWORD}`,
  `insecure: false` only for `ios-xe`), `subscriptions:` block from
  `GNMI_SUBS`, Prometheus output on `:9804` + file-debug output, `add-labels`
  processor, file-based target `loader`. Empty device list → `targets: {}`
  placeholder comment.
- `genTelegrafGNMIConfig(devices, orgName = ''): string` —
  `telegraf-gnmi.conf`: `[agent]` + `[[outputs.prometheus_client]]` (`:9804`),
  one `[[inputs.gnmi]]` block per NOS group (addresses from
  `buildTelemetryTargets`, TLS verify on for `ios-xe` only) with
  `interface`/`interface_state`/`bgp`/`cpu`/`memory` subscriptions.
- `genPrometheusAlertRules(devices, useCase = ''): string` —
  `prometheus-alerts.yml`: `device-reachability` (`DeviceUnreachable`),
  `bgp-sessions` (`BGPSessionDown`, `BGPPrefixCountDropped`),
  `interface-health` (`InterfaceErrorRateHigh`, `InterfaceOperDown`),
  `system-resources` (`HighCPUUtilization`, `HighMemoryUtilization`); when
  `useCase === 'gpu'` adds a `gpu-fabric` group (`PFCWatchdogTriggered`,
  `RoCEv2CNPRateHigh`) — matches the alert groups listed in CLAUDE.md §19.
- `genGrafanaDashboardJSON(devices, orgName = '', useCase = ''): string` —
  `grafana-dashboard.json`: importable Grafana dashboard model
  (`schemaVersion: 39`, `${DS_PROMETHEUS}` datasource template var) with
  panels for Devices Reporting, Fleet Avg CPU/Memory gauges, BGP Sessions
  Established, Interface Error Rate + Throughput timeseries, and a Device
  Inventory table; adds a "GPU Fabric — PFC Priority-3 Drops (RoCEv2)" panel
  when `useCase === 'gpu'`.

**UI:** Step 6 → Monitoring tab → "Observability Downloads" card
(`Step6Deploy.tsx`) — buttons for `gnmic.yml`, `telegraf-gnmi.conf`,
`prometheus-alerts.yml`, `grafana-dashboard.json`, alongside the existing
Grok/NetFlow downloads. All four use `storeDevices`/`orgName`/`storeUseCase`
from `useAppStore`.

**Tests:** `src/test/telemetry-gen.test.ts` — 17 tests covering target
expansion/capping/IP assignment/OS+port mapping, gnmic/Telegraf config
content (placeholders, per-OS grouping, TLS flags, subscriptions), Prometheus
alert groups (core vs. GPU-only), and Grafana dashboard JSON validity/panels
(core vs. GPU).

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
- **NetBox import (B1):** `netboxDevices: NetBoxImportedDevice[]` (default `[]`) + `setNetboxDevices(devices)` — normalized inventory imported via `NetBoxImportPanel`, consumed by Step 6 ZTP (B2)

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
- `parseIntent(description: string): Promise<IntentParseResult>` — POST `/api/intent/parse` with `{description}` (G-A1)
- `checkConfigDrift(configs: Record<string,string>, deploymentId?: string): Promise<ConfigDriftResponse>` — POST `/api/drift/config` with `{configs, deployment_id}` (G-A4)
- `generateRemediation(devices: RemediationDeviceInput[]): Promise<ConfigRemediationResponse>` — POST `/api/drift/remediate` with `{devices}` (G-A16)
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

#### `hooks/useIntentParse.ts` (G-A1)
- `useIntentParse()` — `useMutation<IntentParseResult, Error, string>`; `mutationFn` calls `parseIntent(description)` from `api/client.ts` → POST `/api/intent/parse`. Returns `IntentParseResult` (`source: 'ai'|'heuristic'`). Consumed by `Step1UseCase.tsx`'s free-text "Describe Your Network" card. No client-side simulation — requires a live backend (`useBackendMode().isLive`); the Parse button is disabled otherwise.

#### `hooks/useConfigDrift.ts` (G-A4)
- `useConfigDrift()` — `useMutation<ConfigDriftResponse, Error, { configs: Record<string,string>; deploymentId?: string }>`; `mutationFn` calls `checkConfigDrift(configs, deploymentId)` from `api/client.ts` → POST `/api/drift/config`. Returns `ConfigDriftResponse`.
- **Fallback:** `Step6Deploy.tsx` Day-2 Ops tab calls `useConfigDrift().mutate` when `isLive`; in demo mode (`!isLive`) calls local `simulateConfigDrift(configs, faultDeviceId?)` (exported from `Step6Deploy.tsx`) which marks all devices `has_drift: false` unless `faultDeviceId` is given, in which case that device gets a synthetic `unified_diff` (one added/removed line from `DRIFT_FAULT_LINES`).
- `useConfigRemediation()` (G-A16) — `useMutation<ConfigRemediationResponse, Error, RemediationDeviceInput[]>`; `mutationFn` calls `generateRemediation(devices)` → POST `/api/drift/remediate`. Demo-mode fallback: `simulateRemediation(devices)` (exported from `Step6Deploy.tsx`), which mirrors `backend/config_drift.py generate_remediation()` — restores intended lines that drifted away, then negates extra on-device lines (Cisco `no` prefix / Junos `set`↔`delete`).

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
- **G-A1 — "Describe Your Network" card** (first card, above use-case tiles): free-text `<textarea>` + "✨ Parse with AI" button wired to `useIntentParse()` (`hooks/useIntentParse.ts`). On success, applies non-empty fields from `IntentParseResult` to the store via `setUseCase`, `setAppTypes`, `setScale`, `setRedundancy`, `setCompliance`, `setOrgName`, `setOrgSize`, `setBudgetTier`, `setVendorPrefs`, `setIndustry`, `setPrimaryContact`, and shows a result banner (`source: 'ai'|'heuristic'`, `confidence`, `notes`). Button disabled when textarea empty, mutation pending, or `useBackendMode().isLive` is false (shows "Requires live backend" hint) — no client-side simulation, this feature always calls the backend.

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
- `type DesignTab = 'hld'|'lld'|'ipplan'|'vlan'|'routing'|'physical'|'mermaid'|'simulate'|'summary'|'refdesigns'` + `TAB_LABELS`
- Tabs:
  - **hld** — `<HLDTopologyDiagram>` inside a `ref`'d div (for SVG export); "Regenerate" re-syncs `setDevices(generatedDevices)`
  - **lld** — `<LLDTopologyDiagram>` with per-device IP addresses, interface mappings, config snippets, and physical cabling matrix; 7 use-case-specific detailed topologies
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
- **Computed topology (Enterprise Upgrade D1, 2026-06-11)** — exported types
  `MlagPairSummary` (`{pairId, primary, secondary, domainId}`),
  `FhrpVipSummary` (`{pairId, vlan, name, vip, primary, secondary}`),
  `DciSummary` (`{rtAsn, l2Rt, l3Rt, leaves: string[]}`), `ComputedTopology`
  (`{mlagPairs, fhrpVips, dci}`), and `genComputedTopology(useCase, devices,
  appTypes): ComputedTopology`:
  - For `dc|multisite|gpu|multicloud|aviatrix`: pairs `subLayer==='leaf'`
    devices two-at-a-time via `haPairInfo(dev, idx)` into `mlagPairs`
    (`pairId`/`domainId` from `haPairInfo`, `primary`/`secondary` =
    hostnames). For `multisite` with ≥1 leaf, also returns `dci` using
    `DCI_RT_ASN` (`l2Rt = "${DCI_RT_ASN}:10010"`, `l3Rt =
    "${DCI_RT_ASN}:50000"`, `leaves` = all leaf hostnames).
  - For `campus`: pairs `subLayer==='distribution'` devices the same way
    into `mlagPairs`, plus a `fhrpVips` entry per pair (`Vlan10/DATA`, VIP
    `10.10.${pairId-1}.1`); if `appTypes.includes('voice')`, an additional
    `Vlan20/VOICE` VIP (`10.20.${pairId-1}.1`) per pair.
  - `computedTopology` is computed via `useMemo(() => genComputedTopology(useCase, generatedDevices, appTypes), ...)` and threaded into both `buildSummaryText()` (new "── COMPUTED TOPOLOGY (D1) ──" text section) and a new "Computed Topology" `Card` in the **summary** tab (vPC/MLAG pair table, FHRP gateway table, DCI route-target info) — rendered only when `mlagPairs.length > 0 || dci`.
  - Tested by `frontend/src/test/Step4NetworkDesign.test.ts` (pure-function tests, no rendering).

**Notes:**
- Reads from `useAppStore`: `useCase, scale, siteCode, numSites, underlayProtocol, overlayProtocols, protoFeatures, redundancyModel, totalEndpoints, bandwidthPerServer, oversubscription, trafficPattern, firewallModel, compliance, vendorPrefs, appTypes, devices, nextStep, prevStep`. Writes `setDevices(generatedDevices)`.
- Same `useMemo`-as-side-effect pattern as `Step2Design.tsx` to sync `generatedDevices` from `buildBOM()` into the store.
- `simulateFailure()` HA logic: spine failure with ≥2 spines remaining only reduces ECMP paths; firewall failure → 2000ms convergence; presence of a spare device of same `subLayer` caps convergence at 300ms.
- IS-IS vs OSPF vs eBGP underlay branching in `genRoutingData()` mirrors CLAUDE.md §6 Rule 4 (IS-IS/eBGP for DC, OSPF for campus/WAN) but only affects this page's tables, not `configgen.ts`.
- Per CLAUDE.md G-A2/D1: D1 complete (2026-06-11) — see "Computed topology" above; HLD diagram + design summary now both reflect `haPairInfo`-derived MLAG pairs, FHRP VIPs, and multisite DCI route-targets from `configgen.ts` items A1–A3/A7.

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
- `simDevices` (useMemo): when `deviceSource === 'netbox'` and the store's `netboxDevices` (B1 import) is non-empty, maps the imported inventory to `{name, role}[]` (Enterprise Upgrade B2); otherwise flattens store `devices` (capped at 4 per model, suffixed `-01..04`), falling back to `useTopologyDevices()`
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
- **State:** `failDevice`, `failAt` (default `CONFIG_APPLYING`), `ztpEvents: ZTPEvent[]`, `ztpSummary`, `deviceSource: 'design' | 'netbox'` (B2, default `'design'`); `useRunZTP()` → `runZTP`, `ztpPending`
- **UI:** topology summary cards (`useTopologySummary()`), `<TopologyDiagram devices={bomDevices}/>`, **Device Source card** (B2 — only rendered when `netboxDevices.length > 0`; chip toggle between "BOM design (N devices)" and "NetBox import (N devices)"; switching resets `failDevice`; the choice flows through `simDevices` so it also drives the checks and monitoring demo lists), Fault Injection card (Fail Device select from `simDevices.slice(0,20)`, Fail At Stage select from `ZTP_SIM_STAGES`, Run/Reset), summary cards (Events/Online/Failed), per-device State Machine strip (8-stage icons: done/failed/pending), Events table
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
- **UI:** header (live/demo status dot, tick counter, Grafana link if live, Poll/Simulate Degraded/Clear buttons); live-mode summary cards + device table; demo-mode dashboard — fleet Avg CPU/Mem `ArcGauge`s + total BGP sessions + interface errors, per-device cards (BGP peers/prefixes, CPU/Mem gauges, throughput `Sparkline`, error/PFC badges, red border if `cpu_util>80`, purple if `pfc_drops>100`), BGP Session Summary table; Alert Ticker (devices with `cpu_util>75 || pfc_drops>150 || interface_errors_in>5`); Observability Downloads (Grok Patterns, NetFlow Config, gnmic.yml, Telegraf gNMI Config, Prometheus Alert Rules, Grafana Dashboard — Enterprise upgrade C1, see `lib/telemetry-gen.ts`)
- **`handlePoll(failDevices?)`** — calls `poll()` mutation, toasts health summary
- **`simulateMonitoringMetrics(devList, tick): MetricsSummary`** — per device, deterministic seed via `_seed(name)`/`_pseudoRandom`. Base CPU by role (GPU=62, spine=42, fw=28, else=22); computes `cpu_util, mem_util, interface_errors_in/out, bgp_sessions_up` (0 for access/vedge, else 2-6), `bgp_prefixes_received`, `pfc_drops` (GPU only, up to 300), `throughput_mbps` (spine base 8000, others 2000, scaled 0.4-1.0)

##### Tab: Day-2 Ops (`day2ops`, lines ~2909-3050+)
- **State:** `changeWindow` (`'immediate'|'scheduled'|'emergency'`, default immediate); G-A4: `driftResult: ConfigDriftResponse|null`, `driftFaultDevice` (id of device to simulate drift on, demo mode only), `expandedDriftDevices: Set<string>` (per-device diff expand/collapse), `useConfigDrift()` → `runConfigDrift`/`driftChecking`; G-A16: `remediationResult: ConfigRemediationResponse|null`, `useConfigRemediation()` → `runRemediation`/`remediationPending`, `configIdToPlatform` (id→vendor map), cleared via `useEffect` whenever `driftResult` changes
- **UI:** Change Window card (scheduled shows "Sun 02:00-04:00 UTC"; emergency shows CAB-approval warning); **Config Drift Detection card (G-A4)** — reads `configs` from the Zustand store (generated in Step 3); if empty, shows "No generated configs yet" prompt. Otherwise: demo-mode-only "Simulate drift on" device selector, "Run Drift Check" button → `handleDriftCheck()` (live: `runConfigDrift({configs})`→`/api/drift/config`; demo: `simulateConfigDrift(configs, driftFaultDevice)`); results table (Device / Status — "✓ In sync", "⚠ Drift detected", or "— no baseline" / Added count / Removed count / "View diff" toggle) with an expandable colorized unified-diff row (`toggleDriftDevice`); summary line shows `drift_count`/`device_count`. **Inline remediation (G-A16)** — when `drift_count > 0`, a "🛠 Generate Remediation" button (`handleGenerateRemediation()`; live → `runRemediation` to `/api/drift/remediate`, demo → `simulateRemediation`) renders per-device platform-aware command blocks (restore-then-prune) with Copy-all / Download (`remediation.txt` via `downloadBlob`); platform comes from `configIdToPlatform` (device vendor). Compliance Audit card (7 hardcoded "✓ PASS" checks: password complexity, SSHv2, NTP, syslog, SNMP strings, unused interfaces shut, logging buffered)

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
- Internal types: `HLDNode` (id, label, model, layer, vendor, loopback, mgmtIp, asn?, role, x/y/w/h, isCloud?, haRole?: 'active'|'standby'|'none', features[], color/border/textColor, plus D1 fields `mlagPairId?: number`, `mlagPeerLabel?: string`, `fhrpVip?: string`), `HLDLink` (id, from, to, speed, protocol, fromPort, toPort, linkSubnet, isHaSync?, isOob?), `SecurityZone` (id, label, sublabel, yStart/yEnd, fill, stroke, icon), `PacketFlow` (id, icon, label, desc, nodeSeq: string[], color, animDur), `Topo` (nodes, links, zones, flows, title, subtitle, svgH)
- Layout constants: `SVG_W=1280`, `LEFT_W=148`, `RIGHT_PAD=16`, `CONTENT_W = SVG_W - LEFT_W - RIGHT_PAD`, `NW=136`, `NH=66`; `svgH` per-topology (760-920) drives `viewBox`
- `LAYER_STYLE` maps layer names (internet, wan-edge, corp-fw, edge-fw, spine, core, distribution, leaf, access, host, gpu, storage, oob, cloud-gw) → `{ color, border, textColor }`
- Helpers: `style(layer)`, `xCentered(count, gap)`, `mkLink(...)`, `mkNode(...)`, `linkPath(n1, n2, isHa?)` (bezier paths; HA-sync = horizontal dashed)
- **`pairInfo(i, count): { pairId, isPrimary, peerIdx } | null`** *(Enterprise
  Upgrade D1, 2026-06-11)* — mirrors `configgen.ts`'s `haPairInfo()`
  `pairId`/`isPrimary` formula (`Math.floor(i/2)+1`, `i%2===0`) for the
  synthetic, sequentially-numbered HLD node arrays (which don't fit
  `haPairInfo`'s `01`/`02`-hostname-suffix regex). Returns `null` when
  `peerIdx` falls outside `[0, count)` (odd one out). Callers resolve
  `peerIdx` to a peer label by indexing into the same node array *after* it's
  fully built (`array[pair.peerIdx].label`) — label formats vary by layer
  (3-digit `LEAF-001`/`ACC-SW-001` vs 2-digit `DIST-SW-01`/`GPU-LEAF-01`), so
  no string formula is assumed.
- **Per-use-case topology builders** (each returns `Topo`): `buildDCTopology(devices, underlay, overlay, sc, useCase='dc')` (used for `dc`, `multisite`, `multicloud`, `aviatrix`), `buildCampusTopology(devices, underlay, sc)`, `buildGPUTopology(devices, sc)`, `buildWANTopology(devices, underlay, sc)` — dispatched via `buildTopology(devices, useCase, underlay, overlay, sc)`
- **D1 computed-topology annotations** (2026-06-11), all derived in-builder via `pairInfo()`:
  - DC/multisite/multicloud/aviatrix leaves (`buildDCTopology`) and GPU ToR
    leaves (`buildGPUTopology`): adjacent leaf pairs get `mlagPairId` +
    `mlagPeerLabel` + a `vPC/MLAG Pair #N` feature chip; a dashed
    `vPC/MLAG Peer-Link` (`isHaSync: true`) is added between each pair's two
    nodes. Multisite leaves additionally get an `EVPN DCI Type-5 · RT
    ${DCI_RT_ASN}:10010 (L2) / ${DCI_RT_ASN}:50000 (L3)` feature chip.
  - Campus distribution switches (`buildCampusTopology`): adjacent dist pairs
    get `mlagPairId` + `mlagPeerLabel` + a `vPC/MLAG Pair #N` feature chip, a
    dashed `vPC/MLAG Peer-Link`, and an `fhrpVip` (`10.10.${pairId-1}.1`,
    HSRP VIP for Vlan10/DATA).
  - Campus access switches: each gets a `MEC uplink: Port-channel${i+1} →
    DIST-SW-0${di+1} (vPC pair #${distPairId})` feature chip, computed from
    the access switch's index within its `perDist`-sized slice of the
    distribution array.
- Each builder defines fixed `Y` per-layer y-centers, `zones[]` (colored bands w/ left-column labels/icons), `nodes` via `xCentered()`, `links` (full-mesh spine↔leaf, HA-sync pairs, OOB)
- **Packet-flow scenarios:** `Topo.flows: PacketFlow[]` — DC has 6 (N-S inbound/egress, E-W VXLAN, HA failover, GPU RDMA, OOB mgmt); Campus has 6 (N-S inbound/egress, intra-campus, voice, HA failover, 802.1X); GPU has 4 (GPU↔GPU RDMA, NVMe-oF read, AllReduce, OOB mgmt); WAN has 4 (HQ→branch, local breakout, PE failover, branch-to-branch)
- **Flow selection/highlighting:** `activeFlow` state (defaults to `topo.flows[0]?.id`), pill buttons in "Packet Flow" bar; `flowLinkIds`/`flowNodeIds` (Sets from `nodeSeq`, bidirectional `from--to`/`to--from`); `flowPath` chains `linkPath()` segments into one combined SVG path for `<animateMotion>`
- **Device-inspect panel:** clicking a node `<g>` (or background to deselect) sets `selectedNode`; panel shows label, model, HA badge, layer, vendor, loopback, mgmt IP, ASN, feature/protocol chips, "Connected Links" list (peer/ports/speed/protocol/subnet from `topo.links`)
  - **D1 (2026-06-11):** when `selectedNodeObj.mlagPairId !== undefined`, a
    "Fabric Pairing" section shows `vPC/MLAG Pair #${mlagPairId}` plus `—
    peer: ${mlagPeerLabel}` if set; when `selectedNodeObj.fhrpVip` is set, an
    "FHRP Gateway" section shows `HSRP VIP (Vlan10/DATA): ${fhrpVip}` (the VIP
    is intentionally *not* duplicated in the feature-chip list, to avoid
    `getByText` ambiguity / visual repetition).
- **"Primary Path Only" toggle:** pill button (visible only when `activeFlow` set) flips `primaryPathOnly`; when true, both `topo.links` and `topo.nodes` filtered to only `flowLinkIds`/`flowNodeIds` (non-flow elements fully hidden, not dimmed)
- **Cloud overlays:** `isCloud` flag on `HLDNode` renders `<ellipse>` + 🌐 emoji (used for `internet`/`isp` nodes); multicloud/multisite/aviatrix reuse `buildDCTopology` — no dedicated cloud builder
- **Animation:** (1) ambient background packets on every non-OOB, non-active-flow link via per-link `<circle>` + `<animateMotion>` riding `<mpath>` (staggered dur/begin by link index); (2) active-flow packets — glowing trail (`<path opacity=0.25>`) + 3 staggered `<circle>` packets along `#flow-path` at offsets 0%/40%/70% of `animDur`
- **Health overlay (Enterprise Upgrade C2):** additional exports `HealthStatus` (`'healthy'|'degraded'|'down'|'unknown'`), `NodeHealth` (`{ status, cpu, mem, uptimeSec, bgpSessionsUp, ifaceErrors, pfcDrops, alerts: string[] }`), `HEALTH_COLOR`/`HEALTH_LABEL` (status→color/label maps, colors match `MonitoringResult` statuses), and `simulateNodeHealth(node: HLDNode): NodeHealth` (deterministic per-node telemetry snapshot seeded from `node.id`, with per-layer CPU baselines via `HEALTH_BASELINE_CPU`; thresholds mirror `genPrometheusAlertRules` — cpu>85% or PFC>200 → `down`, cpu>65%/iface-errors>8/PFC>100 → `degraded`, else `healthy`; PFC drops only for `gpu` layer, BGP session counts only for routing layers `spine|core|leaf|distribution|wan-edge`)
  - "🩺 Health Overlay: On/Off" pill toggle (`showHealth` state, top-right of the Packet Flow bar, always visible)
  - When on: every non-cloud node renders a small status-color `<circle r=5 stroke="#080E1A">` badge at its top-left corner; `down` status additionally pulses via `<animate>` on a surrounding ring
  - Device-inspect panel gains a "Live Health" drill-down section (status badge + CPU/Mem/Uptime/BGP-sessions/iface-errors/PFC-drops grid + alert list) when a node is selected and the overlay is on
  - Self-contained simulation — no new props/hooks/backend calls; works identically in Step 2/4 design views without `useBackendMode()`/`useMonitoring()` wiring

**Notes:**
- Used by `Step2Design.tsx` and `Step4NetworkDesign.tsx` (both pass `devices, useCase, underlayProtocol, overlayProtocols, siteCode`).
- Responsive SVG: no fixed `width`/`height`, `style={{ width:'100%', height:'auto', display:'block' }}`, `viewBox="0 0 SVG_W svgH"` (per CLAUDE.md §16).
- Per CLAUDE.md G-A2/D1: D1 complete (2026-06-11) — vPC/MLAG pairs, FHRP VIPs,
  and multisite DCI route-targets are now reflected as node annotations,
  peer-links, and inspect-panel sections (see "D1 computed-topology
  annotations" above). Node/link *positions* remain template-driven from
  device counts (port-math-driven layout is a possible future refinement).
- No external graph libraries (pure SVG/JSX) — per Implementation Rule 9.
- `multisite`, `multicloud`, `aviatrix` all fall through to `buildDCTopology` (no dedicated builders yet).

---

#### `frontend/src/components/RackElevation.tsx` — *added 2026-06-18, gap G-A14*
**Purpose:** Pure-SVG 42U rack elevation diagram with cable schedule and rack assignment tables.

**Key exports:**
- `RackElevation({ devices, cabling, siteCode })` — main React component rendering:
  - SVG rack elevation per rack (auto-splits when >42U), color-coded by subLayer
  - Power bar (green/yellow/red based on capacity)
  - Cable schedule table (per-port cable runs with type/speed/length)
  - Rack assignment schedule table (device → rack position/RU/power/ports)
  - Role-color legend
- `computeRackLayout(devices): RackAssignment[]` — assigns devices to racks:
  - Sorts by role priority (sdwan-controller → firewall → wan-edge → core → spine → dist → leaf → access)
  - 2U for spine/core/wan-edge/sdwan-controller, 1U for leaf/access/firewall/distribution
  - 0U for cloud-gw/cloud-transit (excluded from physical rack)
  - Auto-overflow to next rack when capacity exceeded
- `buildCableSchedule(devices, cabling): CableRun[]` — expands aggregate CableLink entries
  into per-device-pair cable runs with hostname/port/type/speed/length

**Types:** `RackSlot`, `RackAssignment`, `CableRun` (locally defined)

**Integration:** Step 4 "Rack & Cabling" tab. Tests: 11 in `test/rack.test.ts`.

#### `frontend/src/components/LLDTopologyDiagram.tsx`
**Purpose:** Renders pure-SVG, use-case-aware Low-Level Design (LLD) topology diagrams with per-device IP addresses, interface mappings, VLANs, config snippets, port-to-port link labels, and a companion Physical Cabling Matrix table. Provides deeper implementation detail than the HLD diagram.

**Key exports / structure:**
- Single export: `export function LLDTopologyDiagram({ devices, useCase, siteCode })`
- `Props`: `{ devices: BOMDevice[]; useCase?: string (default 'dc'); siteCode?: string (default '') }`
- Internal types: `LLDInterface` (name, ip, vlan?, mac?, speed?), `LLDNode` (id, hostname, model, tier, vendor, interfaces[], configLines[], services[], specs, haRole?, x/y/w/h, color/border/textColor, icon), `LLDLink` (id, from, to, fromPort, toPort, speed, vlan?, subnet?, protocol, isDashed?), `LLDZone` (id, label, sublabel, yStart/yEnd, fill, stroke), `CablingEntry` (server, serverPort, ipv4, switchPort, mgmtPort, vlan), `LLDTopo` (nodes, links, zones, cabling, title, subtitle, svgH)
- Layout constants: `SVG_W=1400`, `LEFT_W=160`, `RIGHT_PAD=16`, `CONTENT_W = SVG_W - LEFT_W - RIGHT_PAD`
- `TIER_STYLE` maps tier names (internet, dmz, internal, loadbalancer, server, application, database, wan, core, distribution, access, endpoint, spine, leaf, gpu, storage, oob, cloud, transit, spoke, branch) → `{ color, border, textColor }`
- Helpers: `sty(tier)`, `xCenter(count, gap, nodeW)`, `mkNode(...)`, `mkLink(...)`, `lldLinkPath(n1, n2, isDashed?)`
- **7 per-use-case topology builders** (each returns `LLDTopo`):
  - `buildDCLLD` — Internet → Firewall HA (PA-5450) → Core/Edge routers → F5 LB cluster → 3× Web Servers → API GW + App Server + Database; mirrors the reference datacenter LLD image
  - `buildCampusLLD` — WAN Edge (ASR pair) → Core VSS (C9500 HSRP) → 4× Distribution MLAG → 4× Access 802.1X/PoE+ → 5× Endpoints (PC, Phone, AP, Printer, Server)
  - `buildGPULLD` — OOB MGMT → 2× GPU Spine (SN4800) → 4× GPU Leaf/ToR (SN4600C MLAG) → 4× DGX A100 servers → 2× NVMe-oF storage; PFC P3, ECN, DCQCN detail
  - `buildWANLLD` — SP Backbone → HQ PE pair (BGP RR, MPLS, SR-MPLS) → 3× WAN CPE → 3× Branch routers → 3× Branch endpoints; QoS DSCP 6-class, L3VPN, SD-WAN
  - `buildMultisiteLLD` — Site A + Site B with DCI GW pair, EVPN Type-5 stretched RT 65100, per-site spine/leaf/server with vPC domains
  - `buildMulticloudLLD` — On-prem spine pair → AWS DirectConnect + Azure ExpressRoute + GCP Cloud Interconnect → VPCs/VNets → Cloud workloads (EC2/AKS/GKE)
  - `buildAviatrixLLD` — DC Edge pair → Aviatrix Transit GWs (AWS/Azure/GCP) with multi-cloud peering → Spoke GWs with network segmentation → Cloud workloads
  - Dispatched via `buildLLDTopology(devices, useCase, sc)`
- **SVG rendering:** zone bands with left-column labels, larger device nodes (w=160-260, h=70-140) with interface IPs, config lines, port indicator dots, HA badges. Links show port labels at endpoints on hover with speed/protocol/VLAN/subnet
- **Device-inspect panel:** clicking a node shows full interface table (name/IP/speed/VLAN/MAC), config snippet (green monospace), services/protocols chips, connected links list, specs
- **Physical Cabling Matrix:** HTML table below the SVG showing server→port→IPv4→switch-port→management→VLAN for all devices

**Notes:**
- Used by `Step4NetworkDesign.tsx` (LLD tab, added alongside HLD).
- No external graph libraries (pure SVG/JSX) — per Implementation Rule 9.
- Complements the HLD diagram: HLD shows network-wide topology flow; LLD shows per-device implementation detail.

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

### Backend — App Entry, Routers & MCP Server

#### `backend/main.py`

FastAPI application entry point (`app = FastAPI(title="NetDesign AI Backend", version="2.4.0")`).

**Setup:**
- Sentry initialized if `SENTRY_DSN` set (10% trace sample, 5% profile sample, `send_default_pii=False`).
- CORS: reads `CORS_ORIGINS` env var. `*` allowed only if explicitly set or if `JWT_SECRET` is unset (dev mode). If `JWT_SECRET` is set but `CORS_ORIGINS` is not, the app **refuses to start** (`RuntimeError`).
- `CORSMiddleware`: methods `GET/POST/PUT/PATCH/DELETE/OPTIONS`, headers `Authorization/Content-Type/X-API-Key`, `allow_credentials=True`.
- `/metrics` mounted via `prometheus_client.make_asgi_app()` if telemetry packages available.
- Graceful optional imports (each wrapped in try/except, sets `_AVAILABLE` flags): Celery deploy job (`jobs.deploy_job`), telemetry (`telemetry.gnmi_collector`, `telemetry.alerting`, `telemetry.anomaly`), RCA engine (`rca.engine`), licensing (`licensing.validator`/`licensing.models`).

**Lifespan (`@asynccontextmanager lifespan`)**:
- Startup: `create_all_tables()` if `AUTO_CREATE_TABLES=true`; calls `_bootstrap_admin()` (creates admin `UserProfile` from `ADMIN_USER`/`ADMIN_PASS`, default Org "default", and admin org membership); loads license from `LICENSE_KEY` env (`validate_license_key`); starts `TelemetryCollector` if `ENABLE_TELEMETRY=true` (devices from `_load_telemetry_devices()`, parses `GNMI_DEVICES` env).
- Shutdown: stops telemetry collector, calls `dispose_engine()`.

**Routers mounted** (prefixes from each router file):
- `ztp_router` (from `ztp.router`, unauthenticated)
- `designs_router` → `/api/designs`
- `deployments_router` → `/api/deployments`
- `devices_router` → `/api/devices`
- `custom_policy_router` → `/api/custom-policy`
- `user_policies_router` → `/api/user-policies`
- `users_router` → (no prefix; routes under `/api/auth/*`, `/api/users/*`)
- `orgs_router` → `/api/orgs`
- `approvals_router` → `/api/approvals`
- `integrations_router` (documented elsewhere)
- `export_router` → `/api/export`
- `lab_router` (no prefix; `/api/*` lab simulation routes)

**Helper functions:**
- `_load_telemetry_devices()` — parses `GNMI_DEVICES` env (`hostname:mgmt_ip[:port[:platform]]`) into `DeviceTarget` list.
- `_bootstrap_admin()` — async; ensures admin `UserProfile` + default `Org` + `OrgMember` exist.
- `get_active_license()` — returns `_active_license` or `COMMUNITY_LICENSE`.

**Routes defined directly in main.py:**

| Method & Path | Purpose |
|---|---|
| `WS /ws/deploy/{deployment_id}` | Subscribes to Redis pub/sub `deploy:{id}` and streams JSON deploy events to client (`api.ws.deployment_stream`) |
| `GET /` | Service info `{service, version, status}` |
| `GET /health` | Docker healthcheck — `{status, timestamp}` |
| `GET /api/license` | Return current license info (tier/features/expiry); perm `designs:read` |
| `POST /api/auth/token` | Dev/admin JWT issuance — open in dev mode (no `JWT_SECRET`), else checks `ADMIN_USER`/`ADMIN_PASS` (note: also re-defined in `routers/users.py` with DB-backed login — last router wins / overrides this) |
| `GET /api/inventory` | Return Nornir inventory hosts; perm `designs:read` |
| `GET /api/policy-rules` | Serve `policies/rules.yaml` as JSON for frontend (fallback to `gate_engine`) |
| `POST /api/generate-configs` | Generate Jinja2 configs for all devices from `DesignState`; perm `configs:generate`; records audit via `record_config_gen` |
| `POST /api/greenfield/plan` | Build full greenfield bring-up plan (inventory + day-0/day-N configs + 6-stage workflow) via `greenfield.plan_greenfield`; perm `configs:generate` |
| `POST /api/pre-checks` | Run pre-deploy checks (ICMP, SSH, mandatory config backup) via Nornir/Netmiko (`run_pre_checks`); perm `deploy:staging` |
| `POST /api/deploy` | Dispatch deployment — async via Celery+Redis (returns `AsyncDeployResponse` w/ `deployment_id`, persists `Deployment` row status=pending) or sync fallback (blocking `deploy_configs`, returns `DeployResponse`); perm `deploy:staging` |
| `POST /api/post-checks` | Run post-deploy validation (BGP/OSPF/IS-IS adjacency, interface errors, ping) via `run_post_checks`; perm `deploy:staging` |
| `POST /api/ztp/dhcp-config` | Generate ISC DHCP config snippet for ZTP via `generate_dhcp_config`; perm `configs:generate` |
| `GET /api/alerts` | Return active alerts from in-process telemetry (`telemetry.alerting.evaluate`); empty list if telemetry disabled; perm `designs:read` |
| `GET /api/anomalies` | Return rolling z-score anomalies (`telemetry.anomaly.detect_anomalies`, Enterprise Upgrade C3); empty list if telemetry disabled; perm `designs:read` |
| `POST /api/drift` | Compare intended state vs live gNMI metrics via `telemetry.alerting.evaluate_with_drift`; perm `designs:read` |
| `POST /api/drift/config` | G-A4: compare intended (Jinja2-generated) configs vs latest running-config backup via `config_drift.check_config_drift()`; perm `designs:read` |
| `POST /api/drift/remediate` | G-A16: turn detected drift into reviewable platform-aware remediation commands via `config_drift.build_remediation()`; perm `configs:generate`; generation-only (no push) |
| `POST /api/rca/analyze` | Hypothesis-based RCA (`rca.engine.RCAEngine`), correlates telemetry + recent deployments (last 2h) + design state; perm `designs:read`; 503 if RCA engine unavailable |
| `POST /api/intent/parse` | G-A1: free-text → structured Step 1 fields via `intent_ai.parse_intent_ai()` (Claude API, `output_config` json_schema) with `intent_ai.heuristic_fallback()` (wraps `nl_parser.parse_intent`) when `ANTHROPIC_API_KEY` unset or the call fails; perm `designs:read`; 400 if `description` empty |

**Key Pydantic models**: `DesignState` (mirrors frontend STATE — `uc`, `orgName`, `selectedProducts`, `protocols`, `vlans`, `appFlows`, `include_*` flags), `DeployRequest`, `ConfigResponse`, `CheckResult`/`CheckResponse`, `DeployResponse`/`AsyncDeployResponse`, `DhcpConfigRequest`, `TokenRequest`/`TokenResponse`, `AlertResponse`, `AnomalyResponse`, `DriftRequest`, `ConfigDriftRequest`/`ConfigDriftDevice`/`ConfigDriftResponse` (G-A4), `RemediationDeviceInput`/`ConfigRemediationRequest`/`RemediationDevice`/`ConfigRemediationResponse` (G-A16), `RCARequest`/`HypothesisResponse`, `IntentParseRequest`/`IntentParseResponse` (G-A1).

---

#### `backend/routers/approvals.py`

Prefix: `/api/approvals`. Human-in-the-loop change-approval workflow. TTL via `APPROVAL_TTL_HOURS` env (default 72h).

| Route | Purpose / Permission |
|---|---|
| `POST /api/approvals` | Request approval for a design→environment; perm `configs:generate`. Blocks if a pending approval already exists for design+env (409). Fires Slack/ServiceNow notifications. |
| `GET /api/approvals` | List approvals (org-scoped, filter by `status`/`environment`, paged); perm `approvals:read`. Auto-expires stale pending approvals (`expires_at < now` → `status=expired`). |
| `GET /api/approvals/{id}` | Get single approval; perm `approvals:read`. |
| `POST /api/approvals/{id}/approve` | Approve; perm `deploy:staging`. Enforces 4-eyes (requester cannot self-approve unless ADMIN); checks expiry; activates linked `Deployment` (status `pending_approval`→`approved`). |
| `POST /api/approvals/{id}/reject` | Reject; perm `deploy:staging`. Sets linked `Deployment.status = "rejected"`. |
| `POST /api/approvals/{id}/escalate` | Escalate (extend TTL +`APPROVAL_TTL_HOURS`, bump `risk_score` by 20, capped at 100); perm `configs:generate`. |
| `DELETE /api/approvals/{id}` | Cancel (requester or ADMIN only, must be pending); perm `configs:generate`. |

**Helpers**: `_assert_approval_access()` (org/admin check), `_notify_approval_requested()` / `_notify_approval_decided()` (best-effort Slack + ServiceNow integration calls, exceptions swallowed).

---

#### `backend/routers/custom_policy.py`

Prefix: `/api/custom-policy`. No auth currently enforced (placeholder comment). Wraps `policies.custom_policy.CustomPolicy` engine.

| Route | Purpose |
|---|---|
| `POST /api/custom-policy/generate` | Accepts `CustomPolicyInput`, returns `GenerateResponse{configs: dict[hostname, str]}` via `_policy_engine.generate(body)` |
| `POST /api/custom-policy/validate` | Accepts raw dict, validates against `CustomPolicyInput`, returns `ValidateResponse{valid, warnings, errors}` (catches `ValidationError`/general exceptions without 422) |
| `GET /api/custom-policy/schema` | Returns `CustomPolicyInput.model_json_schema()` |

Models: `GenerateResponse`, `ValidateResponse`.

---

#### `backend/routers/deployments.py`

Prefix: `/api/deployments`. Deployment history/status/rollback.

| Route | Purpose / Permission |
|---|---|
| `GET /api/deployments` | List deployments (filter `design_id`/`environment`/`status`, paged via `skip`/`limit`); perm `deployments:read`. Currently scoped to `triggered_by == user["sub"]` regardless of role (docstring says operators/admins see all, but code filters by current user only). |
| `GET /api/deployments/{id}` | Fetch deployment detail incl. pre/post check results; perm `deployments:read`. |
| `GET /api/deployments/{id}/diff` | Return `config_snapshot` stored at deploy time for diff viewer; perm `deployments:read`. |
| `POST /api/deployments/{id}/rollback` | Trigger rollback — only allowed if status is `success`/`failed`; sets `status = "rollback_requested"`; perm `deploy:staging`. Phase 3 will wire actual Celery rollback job. |

**Helper**: `_get_deployment(deployment_id, user_id, db)` — fetches deployment scoped to `triggered_by == user_id`, 404 if not found.

---

#### `backend/routers/designs.py`

Prefix: `/api/designs`. Design CRUD + Pinecone similarity search.

| Route | Purpose / Permission |
|---|---|
| `GET /api/designs` | List user's non-deleted designs (filter `use_case`, paged); perm `designs:read`. |
| `POST /api/designs` | Create design (`name`, `use_case`, `state`); perm `designs:write`. Fires background `asyncio.create_task` to embed design in Pinecone via `services.pinecone_service.embed_design`. |
| `GET /api/designs/{id}` | Fetch full design (incl. `ip_plan`/`vlan_plan`/`bgp_design`); perm `designs:read`. |
| `GET /api/designs/{id}/state` | Return raw state dict + plans for wizard mid-session restore; perm `designs:read`. |
| `GET /api/designs/quota` | Return remaining config-gen quota for current hour via `middleware.rate_limit.get_user_quota` (Upstash rate limit); perm `designs:read`. **Note**: declared after `/{design_id}` routes — path-ordering risk if `quota` could match `{design_id}` (FastAPI matches literal routes registered, but order matters; here `/quota` is registered after `/{design_id}` GET but is a separate path so should still resolve correctly since `/api/designs/quota` ≠ `/api/designs/{design_id}` only by literal match priority — FastAPI prioritizes static paths). |
| `POST /api/designs/similar` | Returns top-k similar designs from Pinecone (`SimilarRequest`: `intent`, `topology_params`, `use_case`, `vendor`, `top_k` capped at 5) via `services.pinecone_service.find_similar`; perm `designs:read`. |
| `PUT /api/designs/{id}` | Partial update — only `name`/`state`/`ip_plan`/`vlan_plan`/`bgp_design` fields applied; perm `designs:write`. |
| `DELETE /api/designs/{id}` | Soft-delete (`is_deleted = True`); perm `designs:write`. |

**Helper**: `_get_owned(design_id, user_id, db)` — fetch design scoped to owner + not deleted, 404 otherwise.
**Model**: `SimilarRequest`.

---

#### `backend/routers/devices.py`

Prefix: `/api/devices`. Device inventory registry (Nornir/ZTP/monitoring source).

| Route | Purpose / Permission |
|---|---|
| `GET /api/devices` | List devices, filters: `site`, `role`, `platform`, `ztp_state`, `design_id`, paged (`skip`/`limit`, max 1000); perm `designs:read`. |
| `POST /api/devices` | Register device; 409 if `hostname` already exists; perm `designs:write`. |
| `GET /api/devices/{id}` | Get device detail; perm `designs:read`. |
| `PUT /api/devices/{id}` | Update device — allowed fields: `mgmt_ip`, `platform`, `vendor`, `model`, `role`, `site`, `design_id`, `ztp_state`; perm `designs:write`. |
| `DELETE /api/devices/{id}` | Remove device; perm `designs:write`. |

**Helper**: `_get_device(device_id, db)` — 404 if not found.

---

#### `backend/routers/export.py`

Prefix: `/api/export`. All routes return `Response` with `Content-Disposition: attachment` and require perm `designs:read`.

| Route | Purpose |
|---|---|
| `POST /api/export/ansible` | Generate Ansible playbook + inventory (`export.ansible.generate_ansible`) → JSON bundle download |
| `POST /api/export/terraform` | Generate Terraform HCL map (`export.terraform.generate_terraform` + optional `generate_netbox_terraform` if `ip_plan` provided) → keys: `netbox` (always), plus cloud providers for multicloud |
| `POST /api/export/drawio` | Generate draw.io XML topology (`export.drawio.generate_drawio`) → `.drawio` XML download |
| `POST /api/export/runbook` | Generate Markdown runbook (`export.runbook.generate_runbook`); optionally loads `ApprovalRequest` by `approval_id` → `.md` download |
| `POST /api/export/runbook/pdf` | Same as above but converts to PDF via `export.runbook.runbook_to_pdf` (501 if weasyprint unavailable) → `.pdf` download |

**Models**: `DrawioRequest`, `RunbookRequest`, `AnsibleRequest`, `TerraformRequest` (all carry `design_state`, optional `configs`/`ip_plan`).

All routes call `audit.record(...)` with action names `export.ansible`, `export.terraform`, `export.drawio`, `export.runbook`, `export.runbook_pdf`.

---

#### `backend/routers/lab.py`

No prefix (routes are `/api/*` directly), tags `["lab"]`. **No auth, no DB** — pure in-memory demo/simulation data for offline wizard demo (Steps 4-6). Static `_DEVICES` list of 12 demo devices (spines/leaves/firewalls/wan-edge/gpu-leaf across nxos/iosxe/panos/eos/junos).

| Route | Purpose |
|---|---|
| `GET /api/topology` | Summary counts of demo devices by role (`total`, `routers`, `switches`, `firewalls`, etc.) |
| `GET /api/topology/devices` | Returns full `_DEVICES` list |
| `POST /api/ztp/run` | Simulates ZTP state machine (`_ZTP_STAGES`: dhcp_requested → ... → online) across all devices; supports `fail_device`/`fail_at` fault injection; returns `{results, events, summary}` |
| `POST /api/checks/pre` | Simulated pre-checks via `_build_checks("pre", fail_devices)` — 10 check types per device, ~4% random WARN, forced FAIL via `fail_devices` map |
| `POST /api/checks/post` | Same as above with `phase="post"` |
| `GET/POST /api/monitoring/poll` | Simulated health poll per device (cpu/uptime/errors), status `healthy`/`degraded`/`down` (8% random degraded, or forced via `fail_devices`); returns `{health, summary}` |
| `GET /api/alerts` | Returns 3 static demo alerts (BGP prefix drop warning, interface flap info, PFC watchdog critical) |
| `POST /api/rca/analyze` | Returns 3 static RCA hypotheses (BGP hold-timer, CRC errors, ECMP polarization); prepends a 4th "RoCEv2 PFC deadlock" hypothesis (rank 0) if `symptom` contains "pfc" |

**Helpers**: `_ts()` (UTC ISO timestamp), `_uptime()` (random uptime seconds), `_build_checks(phase, fail_devices)`. Constants: `_ZTP_STAGES`, `_CHECK_NAMES`, `_REMEDIATION` dict.

---

#### `backend/routers/orgs.py`

Prefix: `/api/orgs`. Multi-tenant org management + audit log.

| Route | Purpose / Permission |
|---|---|
| `POST /api/orgs` | Create org; validates slug regex `^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$`, 409 if slug taken; creator becomes org admin; perm `*` (system admin only). |
| `GET /api/orgs` | List orgs the caller is an active member of; perm `designs:read`. |
| `GET /api/orgs/{org_id}` | Get org detail; perm `designs:read`; requires membership (`_assert_member`). |
| `POST /api/orgs/{org_id}/members/invite` | Invite user by email (must already have a `UserProfile`, 404 if not); perm `designs:write`; requires org admin (`_assert_org_admin`). Reactivates inactive memberships. |
| `GET /api/orgs/{org_id}/members` | List active members; perm `designs:read`; requires membership. |
| `PATCH /api/orgs/{org_id}/members/{user_id}` | Change member role (`viewer`/`designer`/`operator`/`admin`); perm `designs:write`; requires org admin. |
| `DELETE /api/orgs/{org_id}/members/{user_id}` | Remove member (soft — `is_active=False`); cannot remove self; perm `designs:write`; requires org admin. |
| `GET /api/orgs/{org_id}/audit` | Paged audit log, filter by `action` prefix / `user_id`; perm `audit:read`; requires membership. |
| `GET /api/orgs/{org_id}/audit/export` | JSONL audit export (filter `since`/`until`); perm `audit:read`; requires org admin. |

**Helpers**: `_caller_org_role()`, `_assert_org_admin()` (403 unless system ADMIN or org admin), `_assert_member()` (403 unless system ADMIN or active member).

---

#### `backend/routers/user_policies.py`

Prefix: `/api/user-policies`. User-defined YAML policy rulesets (in-memory store `_store: dict[str, dict]` — no DB persistence; no auth enforced). Wraps `policies.user_rule_engine`.

| Route | Purpose |
|---|---|
| `GET /api/user-policies/packs` | List built-in compliance packs (`list_packs()`) |
| `GET /api/user-policies/packs/{pack_id}` | Fetch pack YAML (`get_pack_yaml`); 404 if not found |
| `POST /api/user-policies/validate` | Validate YAML without saving (`validate_yaml`) → `{valid, rule_count, errors}` |
| `POST /api/user-policies` | Create ruleset (validates YAML first, 422 if invalid); returns 201 |
| `GET /api/user-policies` | List all active rulesets |
| `GET /api/user-policies/{id}` | Get ruleset detail incl. YAML + version history |
| `PUT /api/user-policies/{id}` | Update — re-validates if `yaml_content` changed; bumps `version`, appends to `version_history` |
| `DELETE /api/user-policies/{id}` | Soft-delete (`is_active=False`), returns 204 |
| `POST /api/user-policies/{id}/evaluate` | Evaluate stored ruleset against `EvaluateRequest{intent, configs}` via `_engine_evaluate`; returns gate_status/violations/warnings/infos |
| `POST /api/user-policies/evaluate-yaml` | Evaluate raw inline YAML (for live editor) without saving |

**Helpers**: `_now_str()`, `_make_record(body, rule_count)` (builds new ruleset record with v1 history), `_to_read(r)`, `_to_detail(r)`.

---

#### `backend/routers/users.py`

No prefix — tags `["auth", "users"]`. User profiles, local auth, MFA (TOTP), OIDC SSO, API keys, org-admin user listing. **Note**: this router re-defines `POST /api/auth/token` (DB-backed login) which overlaps with the dev-mode token endpoint in `main.py` — whichever is registered last in `app.include_router()` order takes precedence for routing (users_router is included after the inline main.py route definitions execute, but FastAPI route matching is based on registration order — `users_router` is included via `app.include_router(users_router)` which adds its routes; both `/api/auth/token` definitions exist in the route table, first match wins, so the main.py one (registered at decoration time before routers are included) likely wins — worth checking if dev token logic ever bypasses DB login).

| Route | Purpose |
|---|---|
| `POST /api/auth/token` | DB-backed local login (email/password [+TOTP]); returns pre-MFA token if TOTP enabled and no code given; resolves primary org membership |
| `POST /api/auth/totp-verify` | Second MFA step — verifies TOTP code against pre-MFA token (`mfa_pending=True`), issues full token |
| `GET /api/auth/oidc/login` | Start OIDC flow — returns `{authorization_url, state}` (state stored in-process `_oidc_states` dict) |
| `GET /api/auth/oidc/callback` | OIDC code exchange; upserts `UserProfile`, auto-joins org if email domain matches `Org.sso_domain`; redirects to UI with token in URL fragment |
| `POST /api/auth/switch-org` | Swap active org in token (must be active member of target org) |
| `GET /api/users/me` | Own profile; perm `designs:read` |
| `PATCH /api/users/me` | Update `display_name` and/or password (requires `current_password` to change password) |
| `POST /api/users/me/totp/setup` | Generate TOTP secret + otpauth URI (not yet enabled); 409 if already enabled |
| `POST /api/users/me/totp/enable` | Verify code → set `totp_enabled=True` |
| `DELETE /api/users/me/totp` | Disable TOTP (requires password verification) |
| `POST /api/users/me/api-keys` | Generate new API key — returns raw key once (`generate_api_key()`), stores hash |
| `DELETE /api/users/me/api-keys` | Revoke API key (clears `api_key_hash`) |
| `GET /api/users` | List users in caller's org; perm `*` (system admin); requires `org_id` in token |
| `GET /api/users/{uid}` | Get user profile by id; perm `*` |

**Models**: `TOTPVerifyBody`, `SwitchOrgBody`, `ProfileUpdate`, `DisableTOTPBody` (local); imports `TokenRequest`/`TokenResponse`/`TOTPSetupResponse`/`TOTPVerifyRequest`/`UserProfileRead` from `models`.

---

#### `backend/mcp_server.py`

MCP (Model Context Protocol) server exposing NetDesign AI as an AI-native toolset, built with `FastMCP` (`mcp.server.fastmcp`). Requires Python ≥3.10 and `mcp[cli]>=1.0.0` (exits with clear error messages if unmet). Server name: `"NetDesign AI"`.

**Transports**: CLI args `--transport stdio|sse` (default `stdio` for Claude Desktop), `--port` (default 8001), `--host` (default `0.0.0.0`), `--log-level`. Entry point at bottom (`if __name__ == "__main__"`) parses args and calls `mcp.run(transport=...)`.

**Static reference data** (module-level dicts):
- `PRODUCT_CATALOGUE` — 7 hardware products (cisco_nexus, arista_eos, sonic_onie, cisco_cat9k, juniper_qfx, fortinet_fortigate, palo_alto_pan) with vendor/family/platform/use_cases/roles/speeds/features/notes.
- `ARCH_CARDS` — 4 architecture reference cards (dc_fabric, gpu_cluster, campus, branch) with tiers/underlay/overlay/scale/ip_scheme/bgp_scheme/community_scheme/redundancy.
- `POLICY_RULES_REF` — 15 policy rules (P001–P015) with id/name/action(BLOCK/FAIL/WARN/SUGGEST/INFO)/description.

**Server `instructions`** documents an "auto-chaining workflow": `design_network()` should be called first (auto-chains design + validate + simulate + gate); then `generate_configs()` if `gate.can_deploy`. Includes a tool-reference table and response-formatting guidance.

##### MCP Tools

| Tool | Parameters | Purpose |
|---|---|---|
| `design_network` | `description: str` | **Primary entry point.** NL → structured intent (`parse_intent`) → full design (`generate_full_design`: IP/VLAN/BGP/topology/rationale) → auto policy validation (`run_policies`) → auto worst-case spine-failure simulation (`simulate_failure`) → deployment gate (`compute_confidence`/`can_deploy`) → `next_steps`. Returns `{ok, state, design, rationale, validation, simulation, gate, summary, next_steps}`. |
| `generate_configs` | `state: dict, platforms: list[str]\|None` | Render device configs via `generate_all_configs`. Optional `platforms` filter sets `state["_platform_filter"]`. Returns `{ok, configs, device_count, platforms_generated}`. Supported platforms: nxos, eos, sonic, iosxe, junos, panos, fortios. |
| `validate_policies` | `state: dict` | Runs all 15 policy rules (`run_policies`). Returns `{ok, can_proceed, gate_status, blocked, auto_fixed, warnings, info, total_issues, details[], resolved_state}` — `details` unifies blocks/violations/warnings/fixes/infos with `category`. |
| `explain_design` | `state: dict` | Architecture rationale via `generate_design_rationale`. Returns `{ok, decisions[], summary, warnings, decision_count}`. |
| `simulate_failure` | `state: dict, failed_devices: list[str]` | BFS partition detection + per-role impact + BGP/EVPN/ECMP impact via `simulate_failure` (sim_engine). Returns severity/partitioned/impacted/ecmp/bgp_impact/evpn_impact/remediation/summary. |
| `simulate_link_failure_tool` | `state: dict, link_a: str, link_b: str` | Single link failure analysis via `simulate_link_failure`. Returns alternate paths, rerouted bool, severity, latency_delta, summary. |
| `check_deployment_gate` | `state: dict, sim_severity="none", precheck_status="pass", acknowledge_warnings=False` | Combines policy + sim severity + precheck into confidence score (0-100) and gate decision (APPROVED/CONDITIONAL/BLOCKED) via `compute_confidence`/`can_deploy`. |
| `get_ip_plan` | `state: dict` | IP addressing plan (`generate_ip_plan`) — loopbacks, P2P /31 links, mgmt, VTEP pool, GPU host sessions. |
| `get_vlan_plan` | `state: dict` | VLAN/VNI table (`generate_vlan_plan`) — VLAN/VNI/L3VNI/VRF/RT/anycast GW/transit VLANs. |
| `get_bgp_topology` | `state: dict` | BGP design (`generate_bgp_design`) — ASN table, peer topology, RR nodes, communities, EVPN RTs, Mermaid diagram. |
| `get_topology_graph` | `state: dict` | Adjacency graph (`generate_topology`) — nodes, edges, critical_nodes, spof_risk, Mermaid diagram. |
| `list_products` | `use_case: str\|None, vendor: str\|None, platform: str\|None` | Filters `PRODUCT_CATALOGUE` by use_case/vendor(substring,ci)/platform. Returns `{ok, count, products}`. |
| `diagnose_network` | `state: dict, symptoms: list[str], top_n=8` | Matches symptoms against 45+ issue types / 12 categories via `monitor_engine.diagnose`. Returns ranked `matches[]` (issue_id, name, category, severity, confidence, root_causes, diagnostic_commands, remediation_steps, verification_commands, tags), `categories`, `summary`. |
| `run_health_check` | `state: dict` | Static health check via `monitor_engine.health_check` — spine redundancy, EVPN VRF/L3VNI, VXLAN MTU, GPU PFC, BGP ASN, NTP, OSPF adjacency. Returns `{ok, overall, score, summary, items[], failed_checks, warning_checks}`. |
| `get_issue_detail` | `issue_id: str, platform="nxos"` | Full drill-down for a known issue ID (45 total, listed in docstring across L2/Routing/BGP/EVPN/VXLAN/DHCP/DataPlane/RDMA-GPU/ControlPlane/E2E/WiFi/Infra categories) via `monitor_engine.get_issue`. Returns commands (requested platform + all platforms), remediation_steps, verification_commands, tags. |
| `troubleshoot` | `state: dict, symptoms: list[str]` | Multi-symptom RCA via `troubleshoot_engine.quick_triage` — correlates symptoms into one of 11 root-cause patterns (UNDERLAY_FAILURE, SPINE_FAILURE, EVPN_POLICY_MISCONFIGURATION, PFC_DEADLOCK_GPU, VXLAN_ENCAP_MISCONFIGURATION, L2_DOMAIN_ISOLATION, MTU_BLACKHOLE, BGP_POLICY_FILTER, DHCP_INFRASTRUCTURE_FAILURE, PHYSICAL_LAYER_FAILURE, WIRELESS_INFRASTRUCTURE). Returns root_cause, alternative_hypotheses, runbook, fault_tree_diagram (Mermaid), confidence_summary. |
| `run_static_analysis` | `state: dict` | 26 deterministic design checks across 6 domains (ip, vlan, bgp, evpn, fabric, security) via `static_analysis.run_analysis`. Returns overall/score/summary/check_count/fail_count/warn_count/pass_count/domain_scores/findings[] (check_id, domain, severity, status, title, detail, fix, affected). |
| `run_pre_checks` | `state: dict, inventory: dict\|None, deployment_id=""` | Pre-deploy checks (reachability, SSH+version, **mandatory config backup** to `BACKUP_DIR/{deployment_id}/{hostname}.cfg`) via `nornir_tasks.run_pre_checks`; simulated if `inventory` empty. Returns `{ok, results[], summary}`. |
| `run_post_checks` | `state: dict, inventory: dict\|None` | Post-deploy checks (BGP summary, LLDP neighbors, ECN/WRED, PFC storm counters, jumbo-MTU DF-bit ping using `peer_ip`) via `nornir_tasks.run_post_checks`; simulated if `inventory` empty. Returns `{ok, results[], summary}`. |
| `monitor_network` | `state: dict, symptoms: list[str]\|None, include_troubleshoot=True, top_n=5` | **Unified monitor**: always runs `run_health_check` + `run_static_analysis`; if `symptoms` given, also runs `diagnose_network`; if ≥2 symptoms and `include_troubleshoot`, also runs `troubleshoot`. Computes combined `monitor_status` (healthy/degraded/critical) and `monitor_score` (45% health + 45% analysis − diagnosis severity penalty), plus deduplicated `action_items[]` and a combined `summary`. |
| `design_multicloud_network` | `use_case="multicloud", clouds, dc_count=2, colo_provider="equinix", dc_edge_vendor="iosxr", enterprise_asn=65000, org_cidr="10.0.0.0/9", aws_regions, azure_regions, gcp_regions` | Multicloud plan via `multicloud_ip_plan` (design_engine) — IP plan, BGP peer table, ASN assignments, circuit summary, Terraform stack descriptors (AWS TGW/Azure vWAN/GCP NCC), Ansible summary. Errors if `use_case != "multicloud"`. |
| `plan_greenfield_deployment` | `state: dict, include_configs=True` | End-to-end greenfield bring-up plan via `greenfield.plan_greenfield` + `render_inventory_files` — Nornir/Ansible inventory, day-0/day-N configs, 6-stage workflow (register→ZTP→reachability→pre-checks→tier-push→post-checks) with rollback semantics. |
| `execute_greenfield_deployment` | `state: dict, dry_run=True, deployment_id="greenfield"` | Executes greenfield pipeline via `greenfield.execute_greenfield` (pre-checks→push→post-checks); dry_run validates/simulates only. Returns stages[] with ok+result, aborted_at if gate failed. |
| `list_policy_packs` | (none) | Lists built-in governance policy packs from `policies.user_rule_engine.list_packs()` — `{id, name, description, rule_count, tags}`. |
| `evaluate_policy_pack` | `intent: dict, pack_id="", yaml_content="", configs: dict\|None` | Evaluates a built-in pack (by `pack_id`) or inline `yaml_content` ruleset against `intent`/`configs` via `policies.user_rule_engine.evaluate`. Returns gate_status, rule_count, fired_count, violations/warnings/infos. |
| `generate_automation_exports` | `state: dict, formats: list[str]\|None` | Generates IaC artifacts — `formats` subset of `["ansible","terraform"]` (default both). Ansible via `export.ansible.generate_ansible` (includes rendered configs); Terraform via `export.terraform.generate_terraform`. |
| `full_automation_pipeline` | `description: str, acknowledge_warnings=False, generate_device_configs=True` | End-to-end: parse+design → policy validation → spine-failure simulation → deployment gate → optional config generation (skipped if gate not approved unless `acknowledge_warnings`). Returns `{ok, errors, stage_results, gate_decision, confidence, can_deploy, state, configs, summary}` (5-stage `stages` dict: design/validation/simulation/gate/configs). |

##### MCP Resources

| Resource URI | Returns |
|---|---|
| `netdesign://products` | Full `PRODUCT_CATALOGUE` JSON |
| `netdesign://architectures/{use_case}` | One of `ARCH_CARDS` (dc_fabric, gpu_cluster, campus, branch); error+available list if unknown |
| `netdesign://policy-rules` | Full `POLICY_RULES_REF` (15 rules) JSON |
| `netdesign://community-scheme` | BGP community colouring scheme (standard communities, EVPN RT format, GPU communities) |

##### MCP Prompts

| Prompt | Parameters | Purpose |
|---|---|---|
| `design_campus_network` | `org_name, floors=3, users_per_floor=100, wireless=True, redundancy="high"` | Generates a campus design prompt (3-tier, OSPF+BFD, 802.1X/TACACS+, Cisco Catalyst 9000) |
| `design_dc_fabric` | `org_name, spine_count=2, leaf_count=8, tenant_vrfs=None, underlay="ospf", vendor="cisco"` | Generates DC EVPN/VXLAN fabric design prompt with community scheme (AS:100/300/9999), spine RRs |
| `design_gpu_cluster` | `org_name, gpu_model="H100", gpus_per_rack=8, rack_count=8, spine_count=2, vendor="sonic"` | Generates GPU fabric design prompt (RoCEv2 PFC 3+4, DCQCN, eBGP, SONiC CONFIG_DB) |
| `validate_and_deploy` | `state_json: str, environment="production", change_window="Saturday 02:00-06:00 UTC"` | Generates a 5-step validate→simulate→gate→configs workflow prompt for an existing state |

### Backend — Core Engines (config_gen, design_engine, gate_engine, greenfield, nl_parser, models, db, auth, credentials, audit, rate_limit)

#### `backend/config_gen.py`

**Purpose:** Renders per-device configurations using platform-specific Jinja2 templates, then appends a registry of policy blocks (security, AAA, BGP, EVPN, QoS, etc.).

**Key exports:**
- `generate_device_config(state, layer, index, platform_override=None) -> tuple[hostname, full_config_text]` — renders a single device: builds context, renders base template, appends policies, prepends header.
- `generate_all_configs(state) -> dict[hostname, config_text]` — main entry point. Derives layer/device counts via `_derive_layers()`, detects vendor override via `_detect_primary_vendor()`, iterates layers × counts, renders + appends policies for each device. Honors `state["_platform_filter"]` (list of platform keys) to restrict output (used by MCP).
- `_POLICY_REGISTRY: list[tuple[flag_key, generator_fn]]` — ordered list of 13 policy generators (security_hardening → control_plane → aaa → vlan_policy → trunk_policy → dot1x → bgp_policy → evpn_policy → acl → qos → static_routing → wireless → firewall_policy). Order is significant; each generator returns `""` if not applicable to the UC/platform/layer. Imported from `policies/*.py`.
- `LAYER_PLATFORM_MAP: dict[layer_key, (platform_dir, template_file)]` — dispatch table, e.g. `"dc-leaf" -> ("nxos","leaf.j2")`, `"campus-access" -> ("ios_xe","access.j2")`, `"gpu-tor" -> ("sonic","gpu_tor.j2")`, `"gpu-spine" -> ("eos","gpu_spine.j2")`, `"fw" -> ("ios_xe","firewall.j2")`.
- `VENDOR_PLATFORM_OVERRIDE: dict[vendor, platform_dir]` — `Arista->eos`, `Juniper->junos`, `NVIDIA->sonic`. Applied only to `dc-spine`/`dc-leaf` layers, and only if the vendor template file exists (else falls back).
- `_build_device_context(state, layer, index) -> dict` — assembles the full Jinja context: hostname/loopback/mgmt IP from `state.ipPlan.devices[index-1]` (fallback to formula-derived defaults `10.0.{index}.{index}` etc.), uplinks list, RoCEv2/DCQCN flags (detected via protocol/overlay membership), and all `include_*` policy flags (default `True` except `include_wireless`/`include_firewall_policy` default `False`).
- `_derive_layers(state) -> dict[layer, count]` — if `state.ipPlan.devices` exists, counts by `dev["role"]`; else falls back to use-case sizing dispatch: campus → access/dist/core(+fw); dc/hybrid → spine/leaf(+fw); gpu → gpu-spine/gpu-tor; wan → wan-router(+fw); other → generic fallback.
- `_build_config_header(ctx, state) -> str` — comment-block header with hostname/role/platform/timestamp and a `sha256(json(state))[:12]` "intent hash" for traceability. Comment char is `#` for sonic/eos, `!` otherwise.
- `_render(platform_dir, template_file, ctx) -> str` — Jinja2 render with `StrictUndefined`; on `UndefinedError`/`TemplateSyntaxError`/other exceptions returns a `! CONFIG GENERATION ERROR — ...` comment string instead of raising (errors surface inline in generated config).
- `_append_policies(base_config, ctx, platform, state) -> str` — runs `_POLICY_REGISTRY` generators in order, skipping disabled flags, appending non-empty results; logs (doesn't raise) on generator exceptions.
- `_platform_from_dir(platform_dir) -> str` — maps template dir name → policy-generator platform key (`ios_xe -> "ios-xe"`, others pass through).
- `_detect_primary_vendor(state) -> str` — inspects `state.vendors`/`state.selectedVendors[0]` for "arista"/"juniper"/"nvidia"/"sonic" substrings → `"Arista"|"Juniper"|"NVIDIA"|""`.

**Notes:**
- `TEMPLATE_DIR = backend/templates/`.
- `generate_all_configs` is called by `greenfield.build_production_bundle()` for Day-N configs.
- 5 invariant config rules from CLAUDE.md §6 (no dup blocks, real FW configs, no hardcoded secrets, single underlay, GPU QoS) are enforced collectively by templates + policy generators, not directly in this file.
- Mirrors `frontend/src/lib/configgen.ts` conceptually but is the server-side Jinja2-based generator (separate codepath, not a 1:1 port).

---

#### `backend/design_engine.py`

**Purpose:** Pure functions (no I/O) that derive structured design artefacts — IP plan, VLAN/VNI plan, BGP design, topology graph, design rationale, and multicloud IP plan — from a state dict.

**Key exports:**
- `generate_ip_plan(state) -> dict` — returns `{loopbacks, p2p_links, management, vtep_pool, vlan_subnets, summary}` (plus `h100_hosts` for GPU). Per-UC addressing schemes:
  - **dc/hybrid**: spine loopbacks `10.0.1.x/32` (router-ID) + `10.1.1.x/32` (VTEP/NVE); leaf loopbacks `10.0.2.x/32` + `10.1.2.x/32`, leaves labeled via `_make_leaf_labels()`. Spine↔leaf P2P `/31`s at `10.2.{spine}.{(leaf-1)*2}/31`. VLAN subnets `10.{vlan_id}.0.0/24`, anycast GW `.1`, VNI = `10000 + vlan_id`.
  - **gpu**: GPU-spine loopbacks `10.200.1.x/32`, GPU-TOR loopbacks `10.200.2.x/32`. P2P TOR↔spine `10.3.{spine}.{(tor-1)*2}/31`. H100 host BGP sessions at `10.220.{rack}.{gpu}/32` with per-host ASN `65300 + (rack-1)*gpus_per_rack + gpu`. `gpus_per_rack` derived from `gpu_count // tor_count` (default 8).
  - **campus**: CORE/DIST/ACCESS loopbacks at `10.0.10/11/12.x/32`; Dist↔Core `/31` uplinks at `10.4.{dist}.{(core-1)*2}/31`; VLAN subnets `192.168.{vlan_id}.0/24`.
  - **wan**: WAN-HUB loopbacks `10.0.200.x/32`.
- `generate_vlan_plan(state) -> dict` — returns `{vlans, l3vni_vlans, total_vlans, summary}`. For dc/hybrid: assigns VRF (PROD/DEV/STORAGE) by VLAN name keyword match, `l3vni = 19000 + vrf_idx`, `rt = "65000:{vni}"`, `vni = 10000 + vlan_id`. STP priority 4096 if name contains "CORE" else 32768. Falls back to `nl_parser._generate_vlans()` if no vlans in state.
- `generate_bgp_design(state) -> dict` — returns `{asns, peers, communities, rt_scheme, evpn_enabled, summary, mermaid, ...}`.
  - **dc/hybrid**: spine-as-RR (all spines + leaves share `spine_asn`, default 65000); communities table includes LocalPref tagging (`:100`=primary/200, `:300`=backup/100), EVPN type-2/-5 community tags, RTBH `:9999`. Per-VNI `rt_scheme` (L2VNI + L3VNI for PROD/DEV/STORAGE).
  - **gpu**: eBGP fabric, spine ASN fixed `65200`, each TOR gets unique ASN `65300+i`. ECMP paths = `spine_count * 2`. Hash policy: symmetric 5-tuple.
  - **campus**: single `CAMPUS-CORE` ASN 65001, OSPF-primary with optional BGP upstream.
- `generate_topology(state) -> dict` — returns `{nodes, edges, node_count, edge_count, critical_nodes, mermaid, summary}`. Builds CLOS mesh (full spine↔leaf mesh + spine ISL mesh) for dc/hybrid; spine/TOR/H100-server 3-tier for gpu; core/dist/access tree for campus. Firewall pair added for dc if `"fw" in products`.
- `generate_design_rationale(state) -> dict` — returns `{decisions, summary, warnings, decision_count}`. Produces a list of `{area, choice, rationale, alternatives}` covering: CLOS topology choice, underlay (eBGP for gpu / IS-IS / OSPF), overlay (EVPN/VXLAN symmetric IRB), BGP RR placement, GPU lossless fabric (PFC 3+4, DCQCN ECN Kmin=50KB/Kmax=100KB, MTU 9214), redundancy model, vendor rationale (lookup table for Cisco/Arista/Juniper/NVIDIA/Open-SONiC), compliance/NAC. Also emits `warnings` (e.g. single-spine SPOF, GPU count unspecified, >32 leaves needing 3-stage CLOS).
- `generate_full_design(state) -> dict` — aggregates `ip_plan`, `vlan_plan`, `bgp_design`, `topology`, `rationale` into one dict with a combined `summary`.
- `multicloud_ip_plan(intent) -> dict` — returns `{ip_plan, bgp_peers, asn_assignments, circuit_summary, summary}`. Uses reference tables `_MC_CLOUD_ASN` (aws/azure/gcp provider+customer ASNs), `_MC_REGIONS` (region→CIDR/hub_cidr/site), `_MC_DC_SITES` (DC-EAST/DC-WEST), `_MC_CIRCUIT_TYPE` (DX/ExpressRoute/Cloud Interconnect). Builds enterprise super-summary, DC mgmt CIDRs, colo hub CIDRs (`100.64.10.0/24` IAD, `100.64.20.0/24` SEA, AS 65010/65011), and per-cloud-region BGP peer table with primary/backup link-local peer IPs. Mirrors `frontend` multicloud.js reference data.
- `_make_leaf_labels(leaf_count) -> list[str]` — distributes leaves into `LEAF-PROD-NN` / `LEAF-STOR-NN` / `LEAF-DEV-NN` proportionally (≈50% PROD, 25% STOR, 25% DEV, min 1 each), padded/trimmed to exact count.
- `_dc_bgp_mermaid()`, `_gpu_bgp_mermaid()`, `_topology_mermaid()` — generate Mermaid `graph TD` diagram strings (capped at 6 leaves / 4 TORs for readability).

**Notes:**
- All functions pure/no I/O. `generate_ip_plan` is called by `greenfield.build_inventory()` to source mgmt IPs/loopbacks/hostnames.
- VLAN/VNI/RT conventions here must stay consistent with `config_gen.py`'s EVPN policy generator and the NX-OS EVPN template referenced in CLAUDE.md §10.

---

#### `backend/gate_engine.py`

**Purpose:** Python port of the frontend `gate.js`/`policyengine.js` — evaluates policy rules against a design state, computes a confidence score, and decides the deployment gate (can_deploy).

**Key exports:**
- `PolicyRule` (dataclass): `id, name, description, severity (BLOCK|FAIL|WARN|INFO|PASS), action_type (BLOCK|FAIL|AUTO_FIX|SUGGEST|NOOP), priority (int, lower = first), condition: Callable[[state], bool], apply: Callable[[state], None] | None, message_fn`.
- `PolicyResults` (dataclass): `violations, warnings, infos, fixes, blocks` (lists of dicts), `gate_status (PASS|WARN|FAIL|BLOCK)`, `resolved_state`.
- `run_policies(intent) -> PolicyResults` — **two-phase evaluation**:
  1. Phase 1 (AUTO_FIX): deep-copies state, sorts AUTO_FIX rules by `priority`, applies each whose condition fires (mutates the copy), records in `result.fixes`.
  2. Phase 2: evaluates ALL rules (sorted by priority) against the resolved state; routes by `action_type` — `BLOCK`→`blocks`+`violations`, `FAIL`→`violations`, `SUGGEST`/`WARN`→`warnings`, `NOOP`/`INFO`→`infos`.
  - `gate_status` = `BLOCK` if any blocks, else `FAIL` if any violations, else `WARN` if any warnings, else `PASS`.
- `compute_confidence(policy_results, sim_severity="PENDING", precheck_status="PENDING") -> dict{score, label, breakdown}` — 0-100 score, mirrors JS `computeConfidenceScore()` exactly:
  - Simulation: PASS=40, WARN=24, FAIL=0, PENDING=20
  - Pre-checks: PASS=30, FAIL=0, PENDING=15
  - Policy gate: PASS=20, WARN=12, FAIL=4, BLOCK=0, PENDING=10
  - AUTO_FIX bonus: `min(fixes*2, 8)`
  - Zero-warning bonus: +10 if gate==PASS and no warnings
  - `label`: "High Confidence" (≥80), "Moderate" (≥50), else "Low Confidence".
- `can_deploy(policy_results, sim_severity, precheck_status, policy_fail_acknowledged=False) -> dict{allowed, status, blockers, warnings}` — hard blocks (cannot override): sim FAIL, precheck FAIL, policy BLOCK. Soft block: policy FAIL without acknowledgement. `status` ∈ `CLEAR_TO_DEPLOY | PROCEED_WITH_CAUTION | REQUIRES_ACKNOWLEDGEMENT | BLOCKED`.
- Rule loading: `_make_rules()` tries `_load_rules_from_yaml(backend/policies/rules.yaml)` first (DSL with `_compile_condition`/`_compile_auto_fix` supporting `all/any/not` boolean trees and leaf ops `eq|neq|contains|not_contains|in|not_in|gt|lt|is_empty|is_not_empty`, and auto-fix ops `append|set` on dotted field paths); falls back to `_make_hardcoded_rules()` if YAML missing/fails.
- `_make_hardcoded_rules()` — ~14 built-in rules including: `no-products-selected` (BLOCK), `evpn-requires-bgp` (AUTO_FIX appends "BGP"), `gpu-requires-pfc` (AUTO_FIX appends "PFC" to gpuSpecifics), `campus-enable-dot1x` (AUTO_FIX), `gpu-requires-roce`/`gpu-requires-ecn` (SUGGEST), `vxlan-requires-evpn-or-flood`, `single-spine-spof`, `large-no-redundancy`, `campus-no-nac`, `wan-no-encryption`, `no-compliance-framework`, `dc-no-evpn`, `gpu-lossless-required` (FAIL if neither PFC nor ECN), `evpn-no-bgp-at-deploy` (FAIL).

**Notes:**
- All functions pure (no I/O); called directly by the MCP server.
- Designed to be driven by user-editable YAML rulesets stored via `models.UserRuleset` (see `models.py`); `EvaluateRequest`/`ValidateRequest` Pydantic schemas in `models.py` support a ruleset-evaluation API.

---

#### `backend/greenfield.py`

**Purpose:** Orchestrates an end-to-end greenfield bring-up pipeline — generates a Nornir inventory from a design, builds Day-0/Day-N config bundles, produces a staged deployment plan, and (optionally) executes it via `nornir_tasks`.

**Key exports:**
- `build_inventory(state) -> dict[hostname, host_dict]` — Nornir SimpleInventory shape: `{hostname(=mgmt_ip), platform, username, password, port:22, groups, data{role, layer, ztp_platform, ansible_network_os, mgmt_ip, mgmt_mask, mgmt_gw, loopback_ip, bgp_asn, serial}}`. Sources mgmt IPs/loopbacks from `design_engine.generate_ip_plan()`. Username/password default to `<CHANGE-ME-USER>`/`<CHANGE-ME-PASS>`.
- `render_inventory_files(state, inventory=None) -> {"hosts.yml":str, "groups.yml":str, "ansible_hosts.ini":str}` — renders Jinja2 templates from `templates/inventory/`.
- `build_bootstrap_bundle(state, inventory=None) -> dict[hostname, day0_config]` — renders Day-0 config (mgmt IP/SSH/NTP only) per device using `ztp/templates/{ztp_platform}/day0.j2`; falls back to `_generic_day0()` if template missing.
- `build_production_bundle(state) -> dict[hostname, dayN_config]` — thin wrapper calling `config_gen.generate_all_configs(state)`.
- `deployment_order(inventory) -> list[hostname]` — sorts by `(_ROLE_TIER[role], hostname)`.
- `plan_greenfield(state, include_configs=True) -> GreenfieldPlan` — builds inventory, push order, bootstrap+production bundles, and a fixed **6-stage pipeline**:
  1. **register** — bulk ZTP registration + DHCP config (`ztp.dhcp_gen.generate_dhcp_config()`)
  2. **bootstrap** — Day-0 ZTP/POAP, device → PROVISIONED
  3. **reachability** — `nornir_tasks._icmp_reachable()` gate
  4. **pre_checks** — `run_pre_checks()` + mandatory running-config backup
  5. **push** — `deploy_configs()` in tier order (spine/core → leaf/dist → access → edge → firewall), platform-native commit
  6. **post_checks** — `run_post_checks()` (BGP/EVPN/LLDP/ECN/PFC/MTU validation)
  Each stage is a `GreenfieldStage` dataclass: `id, name, description, devices, actions, task, success_criteria, on_failure, estimated_minutes`.
- `execute_greenfield(state, dry_run=True, deployment_id="greenfield") -> dict` — runs `pre_checks → push → post_checks` via `nornir_tasks` (imports `run_pre_checks`, `run_post_checks`, `deploy_configs`); aborts early on stage failure (`aborted_at`); degrades to simulation if `nornir_tasks` unavailable.
- Role inference: `_role_from_name(name)` matches hostname substrings against `_ROLE_PATTERNS` (ordered most-specific first, e.g. `GPU-SPINE` before `SPINE`) → role string. `_ROLE_TIER` maps role→push-order rank (spine/gpu_spine/core=0, leaf/gpu_tor/distribution=1, access=2, wan_edge/border=3, firewall=4). `_ROLE_TO_LAYER` maps role→`config_gen.LAYER_PLATFORM_MAP` key.
- `_platforms_for(role, vendor) -> (nornir_platform, ztp_platform_dir, ansible_network_os)` — vendor-first dispatch (Arista→eos, Juniper→junos, NVIDIA/SONiC/Cumulus→sonic/linux), else role-based Cisco defaults (spine/leaf→nxos, gpu_spine→eos, gpu_tor→sonic, else ios).
- `_gateway_for(mgmt_ip) -> str` — derives `.254` of the `/24` as default gateway.

**Notes:**
- Deterministic/pure except `execute_greenfield()`. Credentials always emitted as `<CHANGE-ME-*>` placeholders (consistent with CLAUDE.md §9 rollback strategy / §6 secrets rule).
- Depends on `design_engine.generate_ip_plan()` and `config_gen.generate_all_configs()`.

---

#### `backend/nl_parser.py`

**Purpose:** Converts free-form natural-language network design descriptions into the structured state dict consumed by `design_engine`/`config_gen`/`gate_engine` (this is the backend implementation behind G-A1/G-A15 "Intent NLP parser").

**Key exports:**
- `parse_intent(description) -> dict` — main entry. Returns a state dict with: `uc, orgName, orgSize, redundancy, protocols, underlayProto, overlayProto, security, compliance, selectedProducts, vlans, gpuSpecifics, spine_count, leaf_count, gpu_count, rack_count, floor_count, user_count, bgp_asn, spineLoopbacks`, plus all `include_*` policy flags and `_raw_description`/`_detected_vendor`/`_detected_scale`/`_topology_extracted`.
- `describe_intent(state) -> str` — renders a state dict back into a human-readable design brief (org/UC/scale/redundancy/protocols/products/VLANs).
- Detection pipeline (all keyword-scored via `_score_keywords`):
  - `_detect_uc(text)` — scores against `_UC_KEYWORDS` (campus/dc/gpu/wan/hybrid/multisite); ties broken by `_UC_PRIORITY = [gpu, multisite, wan, hybrid, dc, campus]` (most-specific wins). Default "campus".
  - `_detect_redundancy(text)` — full/ha/single via `_REDUNDANCY_KEYWORDS`. Default "ha".
  - `_detect_scale(text, uc)` — first tries numeric extraction (`\b(\d{2,6})\b`); for GPU UC, sizes by GPU count via `_extract_gpu_count()` (≥512 GPUs or ≥10000 → hyperscale, ≥64 → large, ≥16 → medium, else small); for other UCs, thresholds at 10000/2000/500/100 → hyperscale/large/medium/small. Falls back to keyword scoring, then UC-based default.
  - `_detect_vendor(text, uc)` — via `_VENDOR_KEYWORDS` (Cisco/Arista/Juniper/Palo Alto/Fortinet/NVIDIA/SONiC); default per UC (gpu→NVIDIA, others→Cisco).
  - `_detect_protocols(text, uc)` — via `_PROTOCOL_KEYWORDS` (15 protocols incl. OSPF/IS-IS/BGP/EVPN/VXLAN/PFC/RoCEv2/DCQCN); if none found, applies UC-based smart defaults (dc→[OSPF,BGP,EVPN,VXLAN], gpu→[BGP,RoCEv2,PFC,ECN], campus→[OSPF], wan→[BGP,OSPF,MPLS]). Forces BGP if EVPN present for dc.
  - `_detect_security(text)`, `_detect_compliance(text)` — keyword maps for 802.1x/dhcp-snooping/dai/macsec/ipsec/etc. and PCI-DSS/HIPAA/SOC2/FedRAMP/ISO27001/NIST.
  - `_has_wireless(text)` — wifi/wireless/wlan/802.11/AP/SSID/WLC keywords.
- `_recommend_products(uc, scale, vendor) -> dict[layer, product_id]` — lookup table `(uc, scale, vendor) -> {layer: product_id}` over `_PRODUCTS` catalogue (Cisco Cat9xxx/Nexus, Arista 7050/7800, Juniper EX/QFX, NVIDIA SNxxxx, Palo Alto/Fortinet/ASA firewalls, Cisco ASR/ISR WAN). Falls back: drop vendor → try medium/large+Cisco → absolute UC-based fallback.
- `_generate_vlans(uc, text) -> list[dict]` — UC-specific VLAN templates: campus (DATA/VOICE/WIFI-CORP/WIFI-GUEST/SERVERS/IoT/MGMT, pruned by keyword presence), dc (PROD-SERVERS/PROD-APPS/DEV-SERVERS/DEV-APPS/STORAGE/MGMT), gpu (GPU-COMPUTE/GPU-STORAGE/MGMT), wan (TRANSIT/LOOPBACK/MGMT). **Used by `design_engine.generate_vlan_plan()` as fallback when `state.vlans` is empty.**
- `_extract_topology_counts(text) -> dict[str,int]` — regex extraction of explicit counts: `"N-spine"/"N spine"`, `"N-leaf"`, `"N TOR"` (also sets leaf_count if unset), `"N access switch(es)"`, `"N distribution switch(es)"`, `"N core switch(es)"`, `"N H100/A100/H200/GPU"`, `"N rack(s)"`, `"N floor(s)"`, `"N users/people/employees/seats"`, `"ASN/AS number/BGP AS NNNNN"`.
- `_extract_org(description) -> str | None` — regex-based org-name extraction (`"for <Name> with/using/..."` or `"company called/named/is <Name>"`).

**Notes:**
- `parse_intent()` output feeds directly into `design_engine.generate_full_design()`, `config_gen.generate_all_configs()`, and `gate_engine.run_policies()`.
- Also used as the fallback engine behind `intent_ai.heuristic_fallback()` (see below) for the `/api/intent/parse` endpoint (G-A1).

---

#### `backend/intent_ai.py` (G-A1)

**Purpose:** Claude-powered intent parser for `POST /api/intent/parse` — extracts structured Step 1 wizard fields (`use_case, app_types, scale, redundancy, compliance, org_name, org_size, budget_tier, vendor_prefs, industry, primary_contact, confidence, notes`) from a free-text network design description, mirroring the enums in `frontend/src/types/index.ts`.

**Key exports:**
- `RESPONSE_SCHEMA: dict` — JSON Schema (`additionalProperties: False`) for `output_config.format` passed to `client.messages.create()`; enums mirror `USE_CASES, APP_TYPES, SCALES, REDUNDANCY, COMPLIANCE, ORG_SIZES, BUDGET_TIERS, VENDORS, INDUSTRIES` constants defined at module top.
- `AI_AVAILABLE: bool` — `bool(ANTHROPIC_API_KEY)`; logs at import time if unset.
- `parse_intent_ai(description: str) -> dict | None` — calls `anthropic.Anthropic().messages.create(model=ANTHROPIC_MODEL, system=SYSTEM_PROMPT, messages=[...], output_config={"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}})`. Returns `None` (caller falls back to heuristic) if: `AI_AVAILABLE` is False, any `anthropic.APIStatusError`/`APIConnectionError` subclass is raised (auth/permission/not-found/rate-limit/connection/generic all logged distinctly), or the response has no parseable JSON text block.
- `heuristic_fallback(description: str) -> dict` — wraps `nl_parser.parse_intent()`: maps `uc` → `use_case` (unknown/"hybrid"→"dc", other unknowns→"campus"), `orgSize` → `scale` via `scale_map` (xsmall/small→small, medium→medium, large/hyperscale→large), `redundancy` "single"→"single" else "dual", `compliance` via `compliance_map` (PCI-DSS→PCI, NIST→NIST_CSF, others pass through), strips the `"NetDesign-Corp"` default `orgName` to `""`, filters `_detected_vendor` to the frontend `VENDORS` list (drops SONiC etc.), derives `app_types` from keyword search (voice/video/storage/hpc/internet). Always sets `confidence: 0.5` and a fixed `notes` string.

**Notes:**
- Both functions return dicts matching `RESPONSE_SCHEMA`'s required keys exactly (validated by `tests/test_intent_ai.py::TestHeuristicFallback::test_result_matches_response_schema_keys`); the `/api/intent/parse` endpoint adds `source: "ai"|"heuristic"` before returning `IntentParseResponse`.
- `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` (default `claude-opus-4-8`) read from env — see `.env.example`.
- Tests (`tests/test_intent_ai.py`) mock `anthropic.Anthropic` and construct real `httpx.Request`/`httpx.Response` objects for `AuthenticationError`/`RateLimitError`/`APIConnectionError`/etc. (MagicMock alone doesn't satisfy `APIStatusError.__init__`'s typed `response` param at runtime cleanly).

---

#### `backend/config_drift.py` (G-A4 + G-A16)

**Purpose:** Config drift detection for `POST /api/drift/config` — text diff between the *intended* device configs (sent by the frontend as `{hostname: config_text}`, generated client-side by `lib/configgen.ts`) and the *running-config* backups written by `nornir_tasks.run_pre_checks()` to `BACKUP_DIR/{deployment_id}/{hostname}.cfg`. This is distinct from `telemetry/drift_detector.py` (intent vs live gNMI **metrics**). Also hosts the G-A16 remediation generator for `POST /api/drift/remediate`.

**Key exports (G-A4 detection):**
- `BACKUP_DIR: Path` — `os.environ.get("BACKUP_DIR", "/tmp/netdesign_backups")`, same env var as `nornir_tasks.BACKUP_DIR`.
- `diff_configs(intended: str, running: str) -> dict` — normalizes both texts (`_normalize`: strips trailing whitespace, drops blank lines), then `difflib.unified_diff`. Returns `{has_drift, added: list[str], removed: list[str], unified_diff: str}`; `has_drift=False` and empty lists/`""` if normalized texts are equal.
- `latest_backup_dir() -> Path | None` — most recently modified (`st_mtime`) subdirectory of `BACKUP_DIR`, or `None` if `BACKUP_DIR` doesn't exist or has no subdirectories.
- `get_running_config(hostname: str, deployment_id: str | None = None) -> str | None` — reads `BACKUP_DIR/{deployment_id}/{hostname}.cfg`; if `deployment_id` is omitted, uses `latest_backup_dir()`. Returns `None` if the deployment dir or `.cfg` file doesn't exist.
- `check_config_drift(configs: dict[str,str], deployment_id: str | None = None) -> dict` — for each `(hostname, intended)` in `configs`, looks up the running config and either marks `no_baseline: True` (no backup found) or runs `diff_configs()`. Returns `{devices: [{hostname, has_drift, added, removed, unified_diff, no_baseline}, ...], drift_count, device_count}`.

**Key exports (G-A16 remediation):**
- `generate_remediation(hostname, platform, added, removed) -> dict` — builds the per-device remediation command list: **restore** intended lines that drifted away (the `removed` list, re-applied as-is for Cisco-like / `set …` for Junos via `_restore_junos`), then **prune** extra on-device lines (the `added` list, negated via `_negate_cisco` — `no `-prefix, indentation-preserving, `no `-toggle aware — or `_negate_junos` — `delete …`). Returns `{hostname, platform, commands: list[str], command_count}`. Order is restore-then-prune.
- `build_remediation(devices: list[dict]) -> dict` — batch wrapper; each device dict `{hostname, platform, added, removed}` (platform defaults to `ios-xe`). Returns `{devices: [generate_remediation(...), ...]}`.
- Helpers: `_is_junos(platform)` (`"jun" in platform.lower()`), `_negate_cisco`, `_restore_junos`, `_negate_junos`.
- Generation-only — never pushes to a device; applying remediation stays a deliberate, separate human action.

**Notes:**
- Tests: `tests/test_config_drift.py` (23 tests) — G-A4: `diff_configs` (identical/blank-line-normalization/added/removed/changed-line), `get_running_config`/`latest_backup_dir` (missing dir, no deployments, missing host file, explicit `deployment_id`, fallback to latest via `tmp_path` + `monkeypatch.setattr(config_drift, "BACKUP_DIR", ...)`), `check_config_drift` (no-baseline, in-sync, multi-device drift). G-A16: `generate_remediation` (restore cisco, negate cisco, indentation, double-negation re-enable, restore-then-prune order, junos set/delete, junos bare-line wrap, no-drift) + `build_remediation` (batch, platform default).
- The `configs` dict keys are whatever the caller uses as "hostname" — the frontend currently sends `dev.id` (e.g. `dev-1`, `lf1`), which does not necessarily match the Nornir inventory hostnames used when `nornir_tasks.run_pre_checks()` writes backups. When keys don't match, those devices come back `no_baseline: True` rather than erroring — a known v1 limitation.

---

#### `backend/troubleshoot.py` (G-A19)

**Purpose:** Symptom-driven troubleshooting playbook engine for `POST /api/troubleshoot`. Given a symptom + affected devices + platform, returns an ordered diagnostic playbook (platform-specific show commands), ranked likely causes with confidence, and remediation steps. Pure-Python, no external deps. Distinct from `rca/engine.py` (telemetry-driven hypotheses) and `monitor_engine` (symptom-text fault tree) — this is a guided, vendor-aware diagnostic runbook generator.

**Key exports:**
- `PLAYBOOKS: dict` — keyed by symptom: `bgp_down`, `ospf_adjacency`, `interface_flap`, `high_latency`, `packet_loss`, `high_cpu`, `vxlan_evpn`, `pfc_rocev2`. Each playbook defines a `category` label, `summary`, ordered `steps` (description + per-platform command + `look_for`), ranked `causes` (confidence 0–1), and `remediation`.
- `GENERIC_PLAYBOOK` — fallback (category "General") for unknown symptoms.
- `_cmd(...)` — per-platform command resolver (nxos/iosxe/eos/junos; unknown → nxos).
- `build_troubleshooting(symptom, affected_devices, platform="nxos") -> dict` — normalizes symptom (lowercase, `-`/space → `_`) + platform, resolves the playbook, assigns sequential step `order`, rounds + sorts causes by confidence desc, echoes affected devices into the summary. Returns `{symptom, category, summary, diagnostic_steps, likely_causes, remediation}`.

**Notes:**
- Endpoint in `main.py`: `@app.post("/api/troubleshoot", response_model=TroubleshootResponse)` guarded by `require_permission("designs:read")`; Pydantic models `TroubleshootRequest`/`DiagnosticStepModel`/`LikelyCauseModel`/`TroubleshootResponse`.
- Tests: `tests/test_troubleshoot.py` (57 tests) — contract shape, non-empty sections, cause ranking, category labels, platform-specific command divergence (junos vs nxos), unknown-platform default, unknown/empty-symptom fallback, symptom normalization, affected-device echoing.
- Frontend mirror: `simulateTroubleshoot(symptom, platform)` exported from `Step6Deploy.tsx` (demo mode), `useTroubleshoot()` hook (live mode → `runTroubleshoot` in `api/client.ts`), and the "🩺 Troubleshoot" Step 6 sub-tab (added to `Sidebar.tsx` `DEPLOY_SUB_ITEMS` + `Step6Deploy.tsx` `Tab` union). Types `DiagnosticStep`/`LikelyCause`/`TroubleshootResult` in `types/index.ts`. Frontend tests: `frontend/src/test/troubleshoot.test.ts` (7 tests).

---

#### `backend/models.py`

**Purpose:** SQLAlchemy 2.0 ORM models (multi-tenant schema) + Pydantic request/response schemas for the FastAPI app.

**Key exports (ORM tables, all gated behind `ORM_AVAILABLE` try/except on SQLAlchemy import):**
- `Org` — tenant root: `id, name, slug (unique), tier (community|professional|enterprise), sso_domain, is_active`. Has many `OrgMember`, `Design`.
- `OrgMember` — user↔org membership: `org_id, user_id, org_role (viewer|designer|operator|admin), invited_by, is_active`.
- `UserProfile` — one row per user (cross-org): `user_id (PK), email (unique), hashed_password (nullable=SSO-only), totp_secret, totp_enabled, sso_subject, sso_provider, api_key_hash (sha256), last_login_at`.
- `Design` — `org_id, name, owner_id, use_case, state (JSONB), ip_plan/vlan_plan/bgp_design (JSONB), git_commit, is_deleted`. Has many `Deployment`.
- `Deployment` — `org_id, design_id, environment (lab|staging|prod), triggered_by, status (pending_approval→approved/rejected→running→success/failed/rolled_back), approval_id (FK), config_snapshot (JSONB), pre_check_results/post_check_results (JSONB), confidence_score, itsm_ticket_id/url, git_pr_url`.
- `ApprovalRequest` — human-in-the-loop gate: `org_id, design_id, requested_by, environment, status (pending|approved|rejected|expired), reviewed_by/at/note, summary, risk_score (0-100), device_count, expires_at, itsm_ticket_id/url`.
- `IntegrationConfig` — per-org integration settings: `org_id, provider (slack|teams|servicenow|jira|netbox|gitops), config (JSONB), enabled`.
- `Device` — inventory: `org_id, hostname, mgmt_ip, platform, vendor, model, role, site, design_id (FK nullable), ztp_state, last_seen`.
- `UserRuleset` — user-authored YAML policy rules (consumed by `gate_engine`'s `_load_rules_from_yaml` pattern): `org_id, name, description, yaml_content, is_active, rule_count, version, version_history (JSONB list of {version, yaml_content, changed_by, changed_at, note})`.
- `AuditEvent` — maps to `audit_log` table: `timestamp (indexed), org_id, user_id, action, resource_id, resource_type, outcome, ip_address, detail (JSONB)`. Written by `audit.py`.

**Pydantic schemas (always available):**
- Org: `OrgCreate, OrgRead, OrgMemberInvite, OrgMemberRead`
- User: `UserProfileRead, TOTPSetupResponse{secret, otpauth_url}, TOTPVerifyRequest{code}`
- Approval: `ApprovalRequestCreate, ApprovalRequestRead, ApprovalDecision{decision, note}`
- Integration: `IntegrationConfigCreate, IntegrationConfigRead`
- Design: `DesignCreate, DesignRead`
- Deployment: `DeploymentCreate{design_id, environment, dry_run}, DeploymentRead`
- Device: `DeviceCreate, DeviceRead`
- Auth: `TokenRequest{username, password, totp_code}, TokenResponse{access_token, token_type, expires_in, role, org_id, mfa_required}`
- Ruleset: `UserRulesetCreate, UserRulesetUpdate, UserRulesetRead, UserRulesetDetail (+yaml_content, version_history), EvaluateRequest{intent, configs}, ValidateRequest{yaml_content}`
- Audit: `AuditEventRead`

**Notes:**
- `_now()` returns naive UTC datetime (asyncpg TIMESTAMP columns require naive — don't change to tz-aware without a migration).
- `Base` (DeclarativeBase) is re-exported via `db.py` for Alembic `env.py`.
- `EvaluateRequest`/`ValidateRequest` support an API for testing `UserRuleset` YAML against `gate_engine.run_policies()`.

---

#### `backend/db.py`

**Purpose:** Provides the async SQLAlchemy engine/session factory and the FastAPI `get_db()` dependency; the app runs fully without a database when `DATABASE_URL` is unset.

**Key exports:**
- `DATABASE_URL: str` — from `os.environ["DATABASE_URL"]`, default `""`.
- `_engine`, `_SessionLocal` (module-level, `None` if no `DATABASE_URL` or SQLAlchemy[asyncio] not installed) — `create_async_engine(..., pool_size=10, max_overflow=20, pool_pre_ping=True)` and `async_sessionmaker(expire_on_commit=False, autoflush=False)`.
- `SQLALCHEMY_AVAILABLE: bool` — False if `sqlalchemy.ext.asyncio` import fails.
- `get_db() -> AsyncGenerator[AsyncSession, None]` — FastAPI dependency. Raises `HTTPException(503, "Database not configured...")` if `_SessionLocal is None`. Otherwise yields a session, commits on success, rolls back on exception.
- `create_all_tables() -> None` — dev-only; `conn.run_sync(Base.metadata.create_all)`. (Use Alembic in prod.)
- `dispose_engine() -> None` — closes engine connections on app shutdown.

**Notes:**
- Re-exports `Base` from `models.py` for Alembic's `env.py`.
- `audit.py._write_db()` imports `_SessionLocal` directly from this module (bypasses `get_db()` since it runs outside request scope).
- `auth.py._validate_api_key()` uses raw `asyncpg` (not this session factory) for API-key lookups, converting `postgresql+asyncpg://` → `postgresql://`.

---

#### `backend/auth.py`

**Purpose:** Authentication (local JWT, OIDC/SSO, API keys) + RBAC (4 roles) + TOTP MFA + password hashing for the FastAPI app.

**Key exports:**
- `Role(str, Enum)`: `VIEWER, DESIGNER, OPERATOR, ADMIN`.
- `ROLE_PERMISSIONS: dict[Role, set[str]]` — permission sets:
  - VIEWER: `designs:read, deployments:read, audit:read`
  - DESIGNER: + `designs:write, configs:generate`
  - OPERATOR: + `deploy:lab, deploy:staging, approvals:read`
  - ADMIN: explicit superset of OPERATOR + `deploy:prod, audit:read, users:manage, org:admin` (no wildcard, deliberately enumerated for test correctness).
- `create_token(user_id, role, *, org_id=None, expires_hours=JWT_EXPIRY_HOURS(8), mfa_pending=False, extra_claims=None) -> str` — JWT (HS256) with `sub, role, exp, iat, mfa_pending, org_id?`. `mfa_pending=True` → short 5-min expiry (`_MFA_EXPIRY_MIN`).
- `decode_token(token) -> dict` — decodes JWT; raises 401 on `ExpiredSignatureError`/`InvalidTokenError`.
- `require_permission(permission: str)` — FastAPI dependency factory. Returns `_dep(creds, request)`:
  - **Dev mode** (no `JWT_SECRET` set): all requests pass as synthetic `{"sub":"dev-user","role":"admin","org_id":None,"dev_mode":True}` — i.e. **auth is fully open** unless `JWT_SECRET` env var is set.
  - **API key**: `X-API-Key` header or Bearer token starting with `nd-key-` → `_validate_api_key()`.
  - **Bearer JWT**: decodes, rejects `mfa_pending=True` tokens (403, must call `/api/auth/totp-verify`), checks `_has_permission(role, permission)`.
- `_validate_api_key(raw_key, permission) -> dict` — SHA-256 hashes the key, looks up `user_profiles.api_key_hash` via raw `asyncpg` (sync wrapper via `asyncio.run()`); returns role=DESIGNER on success.
- `generate_api_key() -> (raw_key, sha256_hash)` — `raw = "nd-key-" + token_urlsafe(32)`.
- OIDC/SSO: `get_oidc_login_url(state) -> str` (builds provider-specific authorize URL for okta/azure/google), `exchange_oidc_code(code) -> dict` (async, exchanges code for tokens, decodes `id_token` claims **without signature verification** — noted as simplified).
- TOTP: `generate_totp_secret()`, `get_totp_uri(secret, user_email)`, `verify_totp(secret, code)` (±30s window via pyotp, `valid_window=1`).
- Password: `hash_password(plain)`, `verify_password(plain, hashed)` — bcrypt via passlib, falls back to **weak SHA-256** if passlib not installed (logged as dev-only).

**Notes:**
- Env vars: `JWT_SECRET`, `JWT_EXPIRY_HOURS`, `OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/PROVIDER/REDIRECT_URI`, `SIEM_WEBHOOK_URL` (declared here but actually used in `audit.py`).
- `require_permission()` is the gate used by routers (e.g. `configs:generate`, `deploy:prod`); combine with `middleware.rate_limit.config_gen_limit()` for free-tier throttling.
- Critical: with `JWT_SECRET` unset, the entire API is unauthenticated (admin) — relevant when reviewing deployment configs.

---

#### `backend/credentials.py`

**Purpose:** Unified device-credential store — HashiCorp Vault KV-v2 backed in production, env-var fallback for dev/lab.

**Key exports:**
- `CredentialStore` class:
  - `__init__()` — connects to Vault if `VAULT_ADDR` + `VAULT_TOKEN` set and `hvac` installed and `client.is_authenticated()`; else `_vault_available=False`.
  - `get_device_creds(hostname) -> {"username":str, "password":str}` — reads Vault path `netdesign/devices/{hostname}` (mount = `VAULT_KV_MOUNT`, default `"secret"`); on any failure or if Vault unavailable, falls back to `DEVICE_DEFAULT_USER`/`DEVICE_DEFAULT_PASS` env vars (default user=`"admin"`, pass=`""`).
  - `store_device_creds(hostname, username, password) -> None` — writes to Vault KV-v2; raises `RuntimeError` if Vault not configured.
  - `enrich_inventory(inventory: dict) -> dict` — for each host missing `username`/`password`, fills from `get_device_creds()`. Inline creds in inventory take precedence over Vault.
- `get_store() -> CredentialStore` — module-level lazy singleton.

**Notes:**
- Env vars: `VAULT_ADDR, VAULT_TOKEN, VAULT_KV_MOUNT (default "secret"), DEVICE_DEFAULT_USER, DEVICE_DEFAULT_PASS`.
- Used by `nornir_tasks.py` (not in this batch) to enrich `greenfield.build_inventory()` output before live device connections. The greenfield/config-gen modules themselves only ever emit `<CHANGE-ME-USER>`/`<CHANGE-ME-PASS>` placeholders — actual creds are injected at execution time via this store.

---

#### `backend/audit.py`

**Purpose:** Writes immutable, structured audit events to up to 3 destinations (stdout logger, Postgres `audit_log` table, SIEM webhook), all best-effort except the logger.

**Key exports:**
- `record(user_id, action, resource_id, resource_type, outcome, *, org_id=None, ip_address="", detail=None) -> None` — async core function. Always logs structured event via `log.info(..., extra={"audit": True, ...})`. Then calls `_write_db()` and (if `SIEM_WEBHOOK_URL` set) `_write_siem()`.
  - Documented `action` dot-notation taxonomy: `auth.login|logout|totp_verify|sso_callback`, `design.create|update|delete`, `config.generate|export`, `deploy.push|rollback|dry_run`, `approval.request|approve|reject`, `integration.trigger`, `export.runbook|drawio`, `audit.export`.
- `_write_db(event) -> None` — imports `_SessionLocal` from `db.py` (skips silently if `None`); inserts an `AuditEvent` row (from `models.py`); catches/logs all exceptions.
- `_write_siem(event) -> None` — POSTs `{"event":..., "sourcetype":"netdesign:audit"}` to `SIEM_WEBHOOK_URL`. Auth header: `"Splunk <token>"` if URL contains "splunk", else `"Bearer <token>"`. 4s timeout, logs on >=400 or exception.
- Convenience wrappers (all async):
  - `record_deploy(user_id, deployment_id, outcome, *, org_id=None, dry_run, device_count, environment="staging", ip_address="")` → `action="deploy.push"`.
  - `record_config_gen(user_id, design_id, device_count, org_id=None)` → `action="config.generate"`, `outcome="success"`.
  - `record_login(user_id, outcome, *, ip_address="", method="local", org_id=None)` → `action="auth.login"`, `detail={"method": ...}`.
  - `record_approval(user_id, approval_id, action, outcome, org_id=None, ip_address="")` → `resource_type="approval"`.

**Notes:**
- Env vars: `SIEM_WEBHOOK_URL`, `SIEM_TOKEN`.
- `AuditEvent` ORM model and `AuditEventRead` Pydantic schema defined in `models.py`.
- Designed to be called from routers after auth/design/deploy/approval operations; failures here never raise (won't break the primary request).

---

#### `backend/middleware/rate_limit.py`

**Purpose:** Upstash Redis (REST API) based rate limiting — per-user config-gen quota for free-tier users, plus a global per-IP request limiter.

**Key exports:**
- `RateLimitExceeded(HTTPException)` — 429 with `Retry-After` header; `__init__(detail="Rate limit exceeded", retry_after=60)`.
- `config_gen_limit(user_id, plan: Literal["free","pro","team","dept"]="free") -> None` — for `plan != "free"` or when Redis not configured, no-op. For free plan: `INCR ratelimit:config_gen:{user_id}` with 1hr TTL; raises `RateLimitExceeded(retry_after=3600)` if count exceeds `FREE_CONFIG_GEN_LIMIT` (env `FREE_CONFIG_GEN_PER_HR`, default 10).
- `api_rate_limit(ip) -> None` — global guard: `INCR ratelimit:api:{ip}` with 60s TTL; raises `RateLimitExceeded(retry_after=60)` if count exceeds `API_REQ_PER_MIN` (env, default 120).
- `get_user_quota(user_id) -> dict{used, limit, remaining?, unlimited}` — reads current count for UI display; returns `{"unlimited": True}` if Redis disabled.
- `_incr(key, ttl_seconds) -> int`, `_get(key) -> str|None` — low-level Upstash REST helpers (`GET /incr/{key}`, `GET /expire/{key}/{ttl}`, `GET /get/{key}`), Bearer-token auth.

**Notes:**
- Env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (both required to enable; otherwise `_enabled=False` and all functions are no-ops — dev mode unaffected), `FREE_CONFIG_GEN_PER_HR`, `API_REQ_PER_MIN`.
- Intended usage: `await config_gen_limit(user["sub"], plan=user.get("plan","free"))` inside `POST /api/generate-configs`, after `require_permission("configs:generate")` from `auth.py`.

### Backend — Operations Engines (nornir_tasks, monitor_engine, sim_engine, static_analysis, troubleshoot_engine, rca/engine, lab_server)

#### `backend/nornir_tasks.py`

**Purpose:** Nornir/Netmiko task runner for live device operations — pre/post deployment checks and config push. Falls back to simulated results when Nornir/Netmiko isn't installed or no inventory is provided.

**Key exports:**
- `_init_nornir(inventory: dict) -> Nornir | None` — builds an in-memory Nornir instance from a dict-format inventory (`{name: {hostname, platform, username, password, port, data}}`), bypassing SimpleInventory files.
- `get_inventory_hosts() -> list[dict]` — reads `playbooks/inventory/hosts.yml`, returns `[]` if missing.
- `_icmp_reachable(host, timeout=2) -> bool` — reachability probe via TCP connect to port 22 (not real ICMP).
- `run_pre_checks(state, inventory, deployment_id=None) -> list[dict]` — per host: (1) reachability (TCP/22), (2) SSH login + `show version`, (3) **mandatory** `show running-config` backup written to `BACKUP_DIR/{deployment_id}/{hostname}.cfg` (env `BACKUP_DIR`, default `/tmp/netdesign_backups`). Backup failure is reported as `passed: False` with detail `"BACKUP FAILED ... deploy blocked"`. If a host is unreachable, all subsequent checks for it are marked `skipped`. Empty inventory → returns 4 simulated checks for `"demo-device"`.
- `run_post_checks(state, inventory) -> list[dict]` — for each host runs platform-specific commands from `_POST_CHECK_COMMANDS` (BGP/ISIS-or-OSPF/interface-errors/route-summary, keyed by `cisco_nxos`/`cisco_ios`/`arista_eos`/`juniper_junos`), plus 4 additional structured checks:
  - `collect_lldp()` — runs `_LLDP_COMMANDS` (JSON for NX-OS/EOS via `| json`, text for IOS/JunOS), parsed by `_parse_lldp_json()` (NX-OS `TABLE_nbor_detail/ROW_nbor_detail` shape) or `_parse_lldp_text()` (regex-based interface-pattern heuristic: first matched intf = local, last = remote).
  - `ecn_thresholds` — runs `_ECN_COMMANDS` (nxos/eos/sonic only); passes if output non-empty and contains `"ecn"`.
  - `pfc_counters` — runs `_PFC_COMMANDS`; fails if any line containing "storm"/"drop" has a non-zero numeric token (PFC storm drop detection).
  - `mtu_ping_9000` — only for `uc in ("dc","gpu")`; pings `host_data["peer_ip"]`/`loopback_peer` with 9000-byte DF-bit packet via `_MTU_PING_COMMANDS`; success determined by `_MTU_SUCCESS_STRINGS` (`"!!!"`, `"3/3"`, `"bytes from"`, `"Success rate is 100"`). Skipped (simulated) for campus.
- `deploy_configs(configs, inventory, dry_run=True, deployment_id=None) -> dict` — `dry_run=True` returns per-host line counts without pushing. `dry_run=False` pushes via `netmiko_send_config` (note: despite the docstring describing platform-native confirm-commit guards for NX-OS/EOS/JunOS, the implementation here is a single generic `netmiko_send_config` push for all platforms — no checkpoint/commit-confirmed logic is actually implemented in this function). Hosts not in inventory get `status: "not_in_inventory"`.

**Notes:** Mirrors backend equivalent of frontend's `simulateChecksResult`/ZTP simulation but operates on real devices via Netmiko when available. Backup step here is the actual implementation behind CLAUDE.md §9's rollback strategy precondition (config saved before any push). `_POST_CHECK_COMMANDS`/ECN/PFC/MTU checks correspond to CLAUDE.md §12 categories (Protocols/Hardware) and §6 GPU QoS rule (PFC priority 3, ECN/DCQCN). Used by routers that implement `/api/checks/pre`, `/api/checks/post`, `/api/deploy`.

---

#### `backend/monitor_engine.py`

**Purpose:** Static issue-taxonomy + symptom-matching engine — 24 documented issues across 11 categories, each with symptoms/root-causes/per-platform diagnostic & verification commands/remediation steps. Provides symptom→issue diagnosis and a design-state health check, all without live device access.

**Key exports:**
- `DiagnosticMatch` (dataclass) — `issue_id, name, category, severity, score, root_causes, commands (platform→cmds), remediation, verification, tags`.
- `HealthItem` (dataclass) — `check, status ("pass"|"warn"|"fail"), message, issue_id`.
- `HealthReport` (dataclass) — `overall ("healthy"|"degraded"|"critical"), score (0-100), items, summary`.
- `ISSUES: dict[str, dict]` — the 24-entry registry. Categories and issue IDs:
  - `l2_vlan`: `VLAN_MISMATCH`(high), `NATIVE_VLAN_MISMATCH`(medium), `STP_TOPOLOGY_CHANGE`(high), `PORT_ERRORDISABLED`(high), `MAC_TABLE_EXHAUSTION`(medium)
  - `l3_routing`: `ROUTE_MISSING`(critical), `ROUTE_BLACKHOLE`(critical), `ASYMMETRIC_ROUTING`(medium), `NO_DEFAULT_ROUTE`(high)
  - `bgp`: `BGP_NEIGHBOR_DOWN`(critical), `BGP_PREFIX_NOT_SENT`(high), `BGP_MAX_PREFIX`(high), `BGP_AS_PATH_LOOP`(medium)
  - `evpn`: `EVPN_TYPE2_MISSING`(critical), `EVPN_TYPE3_MISSING`(high), `EVPN_TYPE5_MISSING`(critical), `EVPN_RT_MISMATCH`(critical)
  - `vxlan_vtep`: `VTEP_UNREACHABLE`(critical), `VNI_MISMATCH`(critical), `NVE_INTERFACE_DOWN`(critical), `L3VNI_MISSING`(critical), `ANYCAST_GW_NOT_RESPONDING`(high)
  - `dhcp`: `DHCP_NO_ADDRESS`(high), `DHCP_SNOOPING_DROP`(high), `DHCP_POOL_EXHAUSTED`(high)
  - `data_plane`: `MTU_MISMATCH`(high), `ACL_BLOCKING`(high), `INTERFACE_ERRORS`(high), `ECMP_IMBALANCE`(medium)
  - `rdma_gpu`: `PFC_STORM`(critical), `DCQCN_NOT_CONFIGURED`(high), `RDMA_LOSSLESS_DROPS`(critical), `PFC_PRIORITY_WRONG`(high)
  - `control_plane`: `CPU_HIGH_COPP`(high), `OSPF_NEIGHBOR_DOWN`(critical), `NTP_OUT_OF_SYNC`(medium)
  - `e2e_connectivity`: `PING_FAILURE`(critical), `PORT_NOT_OPEN`(high), `TRACEROUTE_LOOP`(critical)
  - `wifi`: `AP_NOT_JOINING`(high), `WIFI_AUTH_FAILURE`(high), `SSID_VLAN_MISMATCH`(high)
  - `infrastructure`: `INTERFACE_DOWN`(critical), `LINK_FLAPPING`(high), `OPTICS_LOW_POWER`(high)

  Each entry: `name, category, severity, affected_layers, symptoms[], root_causes[], diagnostic_commands{platform:[cmds]}, remediation_steps[], verification_commands{platform:[cmds]}, tags[]`.

- `_score(issue, symptom_text, state) -> float` — match score (0-1): +0.15 per matched symptom keyword found in `symptom_text`; +0.1 use-case context boost (gpu→`rdma_gpu/vxlan_vtep/bgp/evpn`; dc/hybrid→`vxlan_vtep/evpn/bgp/l3_routing` at +0.05; campus→`l2_vlan/wifi/dhcp/control_plane`); + severity boost (`critical`+0.05, `high`+0.03, `medium`+0.01). Capped at 1.0.
- `diagnose(state, symptoms: list[str], top_n=10) -> list[DiagnosticMatch]` — joins symptoms, scores all issues via `_score`, returns top_n sorted descending, each with commands for `_best_platform(state)`.
- `_best_platform(state) -> str` — dispatch: vendor `Arista`→`eos`, `Juniper`→`junos`; `uc=="gpu"`→`sonic`; `uc=="campus"`→`iosxe`; default `nxos`.
- `health_check(state) -> HealthReport` — static design-level checks (no live devices): spine redundancy (fail if `spine_count<2` for dc/hybrid/gpu → `ROUTE_MISSING`), EVPN VRF presence (warn if EVPN but no VLANs → `L3VNI_MISSING`), VXLAN MTU reminder (warn, `MTU_MISMATCH`), GPU PFC/lossless (fail if `gpuSpecifics.pfc` falsy → `PFC_PRIORITY_WRONG`), BGP ASN range validity (`BGP_NEIGHBOR_DOWN` if invalid), anycast gateway reminder, NTP redundancy reminder (`NTP_OUT_OF_SYNC`), OSPF adjacency count = `spine_count × leaf_count`. Score formula: `100 - fails*20 - warns*5`; `overall = "critical" if fails>0 else "degraded" if warns>2 else "healthy"`.
- `get_issue(issue_id) -> dict | None`, `list_categories() -> list[str]`, `list_issues_by_category(category) -> list[str]`.

**Notes:** `ISSUES` and `diagnose()` are imported and reused by `troubleshoot_engine.py` (RCA evidence matching) and `_best_platform` is duplicated there too. `health_check()` aligns with CLAUDE.md §6/§19 (GPU QoS, monitoring alert groups). Backing engine for `/api/rca/analyze`-style endpoints and the Monitoring tab (§19 alert groups: BGP, interface errors, CPU/memory, RoCEv2 CNP, PFC watchdog all map to issue categories here).

---

#### `backend/sim_engine.py`

**Purpose:** "What-if" failure simulation against a pure in-memory topology graph derived from design state — computes blast radius, partition risk, ECMP/BGP/EVPN impact, and remediation, with no live device queries.

**Key exports:**
- `simulate_failure(state, failed_devices: list[str]) -> dict` — main entry. Pipeline:
  1. `_build_graph(state)` — adjacency list built per use-case (see below).
  2. Per failed device: `_analyze_device_failure()` → impact record.
  3. `_check_partition(graph, found)` — BFS-based: True if removing failed nodes disconnects the remaining graph.
  4. `_analyze_bgp_impact()`, `_analyze_evpn_impact()`, `_surviving_paths()`.
  5. Severity: `"FAIL"` if partition or any record severity FAIL; else `"WARN"` if any critical-role device failed; else `"PASS"`. `confidence_delta` = 40/20/5 for FAIL/WARN/PASS.
  6. ECMP summary: `paths_before=spine_count`, `paths_after=spine_count - failed_spines`, `bandwidth_remaining_pct = 100*after/before`.
  7. Returns dict with `failed, found_in_topology, not_found, partitioned/partition_risk, severity (mapped to "none"/"minor"/"critical"), impacted (human-readable via _build_impacted_segments), impact_records, surviving_paths, ecmp, bgp_impact, evpn_impact, remediation, confidence_delta, summary`.
- `simulate_link_failure(state, link_a, link_b) -> dict` — removes one edge from graph, runs `_bfs_paths()` to find up to 5 alternate paths (max depth 6); severity `"PASS"` if alt paths exist, else `"WARN"` (if dual redundancy) or `"FAIL"`.
- `_build_graph(state) -> dict[str, list[str]]` — topology construction per `uc`:
  - `dc`/`hybrid`: spine full-mesh ISL + spine↔leaf CLOS full mesh (`SPINE-NN`, leaves from `design_engine._make_leaf_labels` or `LEAF-NN` fallback); if `"fw" in selectedProducts`, adds a 2-tier firewall chain (`CORP-FW-01/02` ↔ spines, `INET-FW-01/02`, `WAN-EDGE-01/02`); 2 servers per leaf (`SRV-{i}-{01,02}`).
  - `gpu`: `GPU-SPINE-NN` full mesh + `GPU-SPINE` ↔ `GPU-TOR-NN` full mesh; GPUs per rack = `gpu_count // tor_count` (default 8) attached as `H100-R{i}-GPU{g}`.
  - `campus`: `CORE-01`(+`CORE-02` if dual) ↔ 4 distributions (`DIST-FL1/FL2/SRV/IoT`) ↔ matching `ACC-*`; optional FW chain to `INTERNET`.
- `_device_role(device_id, uc) -> str` — name-based role classifier: `dc-spine`/`gpu-spine`, `campus-core`, `dc-leaf`/`gpu-tor`, `campus-dist`, `fw`, `wan-hub`, `server`, `unknown`. `_CRITICAL_ROLES = {campus-core, dc-spine, gpu-spine, fw, wan-hub}`.
- `_analyze_device_failure(device, role, peers, graph, state, dual, has_evpn) -> dict` — role-specific impact text + severity:
  - `dc-spine`: WARN if another spine survives (EVPN re-establishes via it), else FAIL ("fabric BLACK-HOLED").
  - `gpu-spine`: WARN if surviving GPU spines (ECMP continues), else FAIL.
  - `campus-core`: WARN if dual+surviving core (VSS/StackWise failover), else FAIL.
  - `dc-leaf`/`gpu-tor`: always WARN (vPC/MLAG peer covers).
  - `fw`: WARN if surviving FW (HA failover), else FAIL.
  - `server`: PASS (no fabric impact).
  - returns `{device, role, critical, severity, description, affected_peers (capped 8), evpn_impacted}`.
- `_check_partition(graph, failed) -> bool` — BFS connectivity check on graph minus failed nodes.
- `_analyze_bgp_impact(failed, state, has_evpn) -> dict` — for dc/hybrid: `rr_failed` (failed spines), `surviving_rr`, `evpn_control_plane` ("UP"/"DEGRADED"/"DOWN"), `session_impact = len(rr_failed)*4` sessions disrupted (assumes 4 leaves), `reconvergence`. For gpu: `ecmp_paths_lost = len(failed gpu-spines)*4` (assumes 4 TORs/spine).
- `_analyze_evpn_impact(failed, state, has_evpn) -> dict` — `mac_ip_routes_lost ≈ vtep_failed*200`, `type5_routes_lost ≈ vtep_failed*10`, `arp_suppression` cleared on 30s timer, `control_plane` status derived from spine RR survival.
- `_surviving_paths(graph, failed, uc, dual) -> list[str]` — text descriptions of remaining ECMP paths per use-case.
- `_bfs_paths(graph, src, dst, max_depth=6) -> list[list[str]]` — BFS shortest-paths enumeration, returns max 5.
- `_build_remediation(impacts, bgp, evpn, partition, dual, uc) -> list[str]` — emoji-prefixed action list (🚨 partition, 🔴 EVPN CP down / FAIL devices, ⚠️ no redundancy / WARN devices, 🔧 ARP/MAC flush hints for VTEP loss); falls back to "✅ No immediate action required".
- `_sim_summary(...)` / `_build_impacted_segments(...)` — human-readable summary string and per-segment impact descriptions (spine/leaf/fw/core/server/BGP/EVPN), used to populate the `impacted` list.

**Notes:** `_build_graph` imports `design_engine._make_leaf_labels` for naming consistency. Used by RCA endpoints and the "what-if" failure-simulation feature in Step 6 (Day-2 Ops / Batfish-adjacent tooling). `rca/engine.py` also imports `_build_graph` for blast-radius computation.

---

#### `backend/static_analysis.py`

**Purpose:** 26-check deterministic design-validation engine run against generated design objects (Step 3) — catches IP/VLAN/BGP/EVPN/fabric/security misconfigurations before deployment, entirely offline.

**Key exports:**
- `Finding` (dataclass) — `check_id, domain (ip|vlan|bgp|evpn|fabric|security), severity (critical|high|medium|low|info), status (fail|warn|pass|info), title, detail, fix, affected[]`.
- `AnalysisReport` (dataclass) — `overall (critical|fail|warn|pass), score (0-100), findings[], summary, domain_scores{domain:int}, check_count, fail_count, warn_count, pass_count`.
- `_score_domain(findings) -> int` — `100 - crits*30 - (fails-crits)*15 - warns*5`, floored at 0.
- Domain check functions (each returns `list[Finding]`), all reading from `design.ip_plan` / `design.vlan_plan` / `design.bgp_design`:
  - `_check_ip(state, design)`: **IP-1** duplicate loopback IPs (critical/fail); **IP-2** P2P /31 subnet overlap (critical/fail, via `ipaddress.IPv4Network.overlaps`); **IP-3** VLAN subnet overlap (critical/fail); **IP-4** VTEP pool overlapping P2P space (high/fail); **IP-5** management address info (reminds about MGMT VRF).
  - `_check_vlan(state, design)`: **VLAN-1** duplicate VNI across `vlans`+`l3vni_vlans` (critical/fail); **VLAN-2** VRF missing L3VNI transit VLAN — `vrfs_with_vlans - vrfs_with_l3vni` (critical/fail); **VLAN-3** L2VNI naming convention check, expects `vni == 10000 + vlan_id` (medium/warn if violated); **VLAN-4** VLAN count >3500 → approaching 4094 limit (high/warn); **VLAN-5** route-target format must contain `:` (high/fail).
  - `_check_bgp(state, design)`: **BGP-1** ASN range validity (1-4294967295), flags private 2-byte range 64512-65534 as info/pass; **BGP-2** spine-as-RR for EVPN (dc/hybrid) — checks `bgp_design.rr_topology` text; **BGP-3** EVPN AF enabled flag (`bgp_design.evpn_enabled`) — critical/fail if EVPN protocols present but flag false; **BGP-4** community-colouring completeness — requires `primary/backup/blackhole` keys; **BGP-5** ECMP path count — critical/fail if `spine_count < 2`.
  - `_check_evpn(state, design)`: skipped (EVPN-0 info) if no EVPN/VXLAN protocol. **EVPN-1** RT scheme — pass if `"auto"` in `bgp_design.rt_scheme`, else warn (manual RT consistency risk); **EVPN-2** VTEP pool allocated info; **EVPN-3** symmetric IRB completeness — `vrfs <= l3vni_vrfs` (critical/fail if any VRF lacks L3VNI); **EVPN-4** ARP suppression reminder (medium/warn, always emitted); **EVPN-5** anycast gateway info.
  - `_check_fabric(state, design)`: **FABRIC-1** VXLAN MTU 9216 reminder (high/warn) for dc/hybrid/gpu with EVPN; for plain `gpu` use-case checks `gpuSpecifics.mtu >= 9000` (critical/fail if not, info/pass if so); **FABRIC-2** BFD presence in protocols (medium/warn if absent for dc/hybrid/gpu); **FABRIC-3** CLOS mesh completeness — `actual P2P links == spine_count*leaf_count` (high/fail if mismatch); **FABRIC-4**/**FABRIC-4b** GPU PFC lossless (critical/fail if `gpuSpecifics.pfc` false) and DCQCN/ECN confirmation (high/warn if `gpuSpecifics.dcqcn` false); **FABRIC-5** NTP ≥2 servers reminder (medium/warn, always emitted); **FABRIC-6** OSPF passive-interface reminder if OSPF underlay (medium/warn).
  - `_check_security(state, design)`: **SEC-1** SSH-only/telnet-disabled reminder (high/warn, always); **SEC-2** AAA/TACACS+/RADIUS/802.1X presence check; **SEC-3** management VRF isolation reminder (medium/warn, always); **SEC-4** SNMPv3 presence check (medium/warn if absent); **SEC-5** CoPP reminder (medium/warn, always); **SEC-6** compliance framework detection (PCI/HIPAA/SOC2/ISO27001) — info only.
- `run_analysis_with_design(state, design) -> AnalysisReport` — runs all 6 domain checkers, computes `domain_scores`, counts, and `overall_score = 100 - crit*25 - (fail-crit)*12 - warn*4`; `overall = "critical"` if any critical/fail, else `"fail"` if any fail, else `"warn"` if `warn_count>3`, else `"pass"`.
- `_state_has_design_data(state) -> bool` — True if state already has `ip_plan`/`spineLoopbacks`/`p2pLinks`/`selectedProducts`.
- `run_analysis(state) -> AnalysisReport` — top-level entry: calls `design_engine.generate_full_design(state)` if state lacks design data (and injects a `META-1` info Finding noting that defaults were synthesized), then `run_analysis_with_design`.

**Notes:** Depends on `design_engine.generate_full_design()` for state→design expansion. This is the Step 3 BOM/design "lint" pass — distinct from `monitor_engine` (which is symptom/runtime-oriented) and `troubleshoot_engine` (RCA). The L2VNI/L3VNI conventions and RT format checks mirror CLAUDE.md §10 (EVPN config reference) and §6 rule 5 (GPU QoS) / rule 4 (single underlay).

---

#### `backend/troubleshoot_engine.py`

**Purpose:** Step 2 root-cause-analysis correlator — maps symptom text (via `monitor_engine.diagnose()`) to one of 11 weighted root-cause hypotheses, then generates a platform-aware investigation runbook and a Mermaid fault-tree diagram.

**Key exports:**
- `Hypothesis` (dataclass) — `root_cause_id, title, confidence (0-100), evidence (issue IDs), explanation, blast_radius (isolated|rack|fabric|full-network), urgency (critical|high|medium|low), first_check, resolution_path[]`.
- `RootCauseAnalysis` (dataclass) — `hypotheses[], top, supporting_issues[], categories_hit[], symptom_count, confidence_summary`.
- `RunbookStep` (dataclass) — `phase (verify|isolate|fix|confirm), step_num, title, description, commands{platform:[cmds]}, expected, escalate_if`.
- `Runbook` (dataclass) — `title, hypothesis, platform, steps[], total_steps, estimated_minutes`.
- `_RCA_RULES: list[dict]` — 11 rules, each `{id, title, description, evidence_weights {issue_id: weight}, blast_radius, urgency, first_check, resolution_path[], uc_relevance[]}`:
  - `UNDERLAY_FAILURE` (critical, fabric) — weighted heavily on `OSPF_NEIGHBOR_DOWN`(0.45), `BGP_NEIGHBOR_DOWN`(0.35), `VTEP_UNREACHABLE`(0.30).
  - `SPINE_FAILURE` (critical, fabric) — `ECMP_IMBALANCE`(0.30), `BGP_NEIGHBOR_DOWN`(0.30), `VTEP_UNREACHABLE`(0.25), `INTERFACE_DOWN`(0.25).
  - `EVPN_POLICY_MISCONFIGURATION` (high, rack) — `EVPN_RT_MISMATCH`(0.50), `VNI_MISMATCH`(0.40), `EVPN_TYPE5_MISSING`(0.35).
  - `PFC_DEADLOCK_GPU` (critical, fabric, gpu-only) — `PFC_STORM`(0.60), `RDMA_LOSSLESS_DROPS`(0.40), `PFC_PRIORITY_WRONG`(0.30).
  - `VXLAN_ENCAP_MISCONFIGURATION` (high, rack) — `NVE_INTERFACE_DOWN`(0.50), `L3VNI_MISSING`(0.40), `VNI_MISMATCH`(0.35).
  - `L2_DOMAIN_ISOLATION` (high, isolated, dc/campus/hybrid) — `VLAN_MISMATCH`(0.55), `NATIVE_VLAN_MISMATCH`(0.25).
  - `MTU_BLACKHOLE` (high, fabric) — `MTU_MISMATCH`(0.60).
  - `BGP_POLICY_FILTER` (high, isolated) — `BGP_PREFIX_NOT_SENT`(0.55), `ROUTE_MISSING`(0.30).
  - `DHCP_INFRASTRUCTURE_FAILURE` (high, rack) — `DHCP_NO_ADDRESS`(0.55), `DHCP_SNOOPING_DROP`(0.35).
  - `PHYSICAL_LAYER_FAILURE` (high, isolated) — `INTERFACE_ERRORS`(0.50), `OPTICS_LOW_POWER`(0.50), `LINK_FLAPPING`(0.45).
  - `WIRELESS_INFRASTRUCTURE` (high, rack, campus-only) — `AP_NOT_JOINING`(0.50), `WIFI_AUTH_FAILURE`(0.45).
- `correlate(state, symptom_texts, top_n=5) -> RootCauseAnalysis` — algorithm:
  1. `monitor_engine.diagnose(state, symptom_texts, top_n=20)`; keep matches with `score >= 0.15` as `matched_issue_ids` (filters out pure use-case context boosts of 0.10).
  2. For each rule: if `state.uc not in rule.uc_relevance`, apply `uc_factor=0.4` (penalize irrelevant rules) else `1.0`.
  3. `score = sum(weight for issue_id in matched_issue_ids if issue_id in rule.evidence_weights)`; `norm_score = (score / sum(all weights)) * uc_factor`.
  4. Sort descending, take `top_n`; `confidence = min(int(norm_score*100), 95)` (capped at 95% — "never certain").
- `build_runbook(state, rca) -> Runbook` — looks up `_RUNBOOKS[top.root_cause_id]` (dedicated multi-phase runbooks exist for `UNDERLAY_FAILURE`, `PFC_DEADLOCK_GPU`, `EVPN_POLICY_MISCONFIGURATION`, `L2_DOMAIN_ISOLATION`); falls back to `_GENERIC_RUNBOOK` (4 generic verify/isolate/fix/confirm steps) for other hypotheses or if `rca.top is None`. `estimated_minutes = len(steps) * 4`.
- `_step_from_dict(num, d, platform) -> RunbookStep` — picks `d["commands"][platform]` else `["all"]` else first available.
- `_best_platform(state) -> str` — same dispatch logic as `monitor_engine._best_platform` (duplicated): Arista→eos, Juniper→junos, gpu→sonic, campus→iosxe, default nxos.
- `fault_tree_mermaid(rca) -> str` — generates a Mermaid `graph TD` flowchart: root-cause node (styled `rootcause`), blast-radius/urgency meta node, evidence-issue nodes (colored by severity: critnode/highnode/mednode/lownode), up to 2 alternate hypotheses (dashed `altnode`), and a "▶ Start: {first_check}" action node.
- `quick_triage(state, symptom_texts) -> dict` — one-shot wrapper combining `correlate` + `build_runbook` + `fault_tree_mermaid` into a single JSON-serializable response (`root_cause`, `alternative_hypotheses`, `runbook`, `fault_tree_diagram`, `confidence_summary`, `supporting_issues`, `categories_affected`).

**Notes:** Imports `diagnose` and `ISSUES` directly from `monitor_engine`. This is the Step 2 / RCA-panel backing engine (`useRunRca` mutation → `POST /api/rca/analyze`), distinct from `rca/engine.py` (which is telemetry/live-metrics-driven rather than symptom-text-driven). The Mermaid output is consumable directly by the frontend RCA panel for fault-tree visualization.

---

#### `backend/rca/engine.py`

**Purpose:** Telemetry-driven RCA engine — correlates a free-text symptom + affected device list against live Prometheus-style metrics, recent deployment history, and topology adjacency to produce ranked, automatable hypotheses.

**Key exports:**
- `Hypothesis` (dataclass) — `root_cause, confidence (0.0-1.0), evidence[], blast_radius[], remediation_steps[], automation_available (bool), automation_playbook (str|None)`. `.to_dict()` rounds confidence to 2 decimals.
- `RCAEngine` — stateless; `analyze(symptom, affected_devices, design_state=None, recent_deploys=None) -> list[Hypothesis]`:
  1. Loads `topology = _load_topology(design_state)` (calls `sim_engine._build_graph`).
  2. Loads `metrics = _snapshot_metrics()` (calls `telemetry.alerting._collect_metrics()`; returns `{}` on any import/exec failure).
  3. Runs 5 checker methods, concatenates results.
  4. Deduplicates by `root_cause`, keeping highest-confidence instance; returns sorted descending by confidence.
- Checker methods (each returns `[]` if not triggered, else `[Hypothesis]`):
  - `_check_bgp_session_loss` — triggers on symptom containing `bgp/prefix/neighbor/session` OR any affected host has `bgp_prefixes` metric == 0. Confidence: base 0.1, +0.4 if zero-prefix hosts found, +0.2 for "bgp" in symptom, +0.15 for "prefix"/"neighbor". → `"BGP Session Loss"`, automation playbook `playbooks/rca/bgp_session_restore.yml`.
  - `_check_pfc_deadlock` — triggers on `pfc/gpu/rdma/roce/deadlock` OR `pfc_drops_total` metric sum > 100 for an affected host (`storm_hosts`). Confidence: base 0.1, +0.5 if storm hosts, +0.2 if `design_state.uc=="gpu"`, +0.15 if "pfc" in symptom. → `"PFC Watchdog Deadlock"`, playbook `playbooks/rca/pfc_reset.yml`.
  - `_check_recent_deployment` — only fires if `recent_deploys` non-empty AND any deploy `started_at` within last 7200s (2 hours). Confidence: base 0.1, +0.5 per `status=="failed"` deploy, +0.3 per `rolled_back`/`rollback_requested`, +0.1 for any other recent status. → `"Recent Deployment Change"`, playbook `playbooks/rca/rollback_verify.yml`.
  - `_check_evpn_vxlan` — triggers on `evpn/vxlan/vtep/vni/l2vpn/overlay` in symptom. Confidence: base 0.2, +0.3 if `design_state.protocols` includes EVPN/VXLAN, +0.25 if any SPINE host has `bgp_prefixes==0`. → `"EVPN/VXLAN Overlay Fault"`, `automation_available=False`.
  - `_check_underlay_failure` — triggers on `ospf/isis/link/interface/flap/underlay/igp`. Confidence: base 0.15, +0.3 if any affected host's `interface_errs_total` sum > 10, +0.2 if ≥2 affected devices contain "SPINE". → `"Underlay / IGP Failure"`, playbook `playbooks/rca/underlay_check.yml`.
- `_blast_radius(affected, topology) -> list[str]` — 2-hop BFS expansion from affected devices over the topology graph, returns sorted unique node list.
- `_load_topology(design_state) -> dict` — wraps `sim_engine._build_graph`, returns `{}` on failure.
- `_snapshot_metrics() -> dict` — wraps `telemetry.alerting._collect_metrics()`, returns `{}` on failure.
- `_parse_ts(ts: str) -> float` — module-level helper; parses ISO8601 (handles trailing `Z`) to Unix timestamp, returns 0.0 on failure.

**Notes:** This is a *different* RCA engine from `troubleshoot_engine.py` — this one is metrics/deployment-history-driven (live Prometheus + deploy log), the other is symptom-text/issue-taxonomy-driven (static). Both can coexist; `RCAEngine.analyze` is likely the implementation behind a live-mode `/api/rca/analyze` when `isLive=true`, while `troubleshoot_engine.quick_triage` backs the demo/static mode. Depends on `sim_engine._build_graph` and `telemetry/alerting.py` (`_collect_metrics`), both imported lazily/defensively (try/except).

---

#### `backend/lab_server.py`

**Purpose:** Standalone, dependency-light FastAPI app (no DB/Redis/Vault) that serves all endpoints needed by wizard Steps 1-6 for local lab/demo testing.

**Key exports:**
- `app: FastAPI` — title "NetDesign AI — Lab Server", CORS wide open (`allow_origins=["*"]`, all methods/headers). Mounts `routers.lab.router` (the `lab_router`) — all actual endpoint logic lives in `routers/lab.py`.
- `health() -> {"status": "ok", "server": "lab"}` — `GET /health`.
- `root() -> dict` — `GET /`, returns server metadata and an endpoint list documenting: `GET /api/topology`, `GET /api/topology/devices`, `POST /api/ztp/run`, `POST /api/checks/pre`, `POST /api/checks/post`, `GET|POST /api/monitoring/poll`, `GET /api/alerts`, `POST /api/rca/analyze`.
- `__main__` block — argparse `--host` (default `127.0.0.1`), `--port` (default `8000`), `--reload`; runs via `uvicorn.run("lab_server:app", ...)`.

**Notes:** This is the entry point referenced in CLAUDE.md's "Quick start" / dev-server section as the `:8000` backend that the Vite dev server proxies `/api` to (`isLive=true` mode). All real endpoint implementations (ZTP, checks, monitoring, RCA, deploy) are in `backend/routers/lab.py`, which presumably calls into `nornir_tasks`, `monitor_engine`, `sim_engine`, `static_analysis`, `troubleshoot_engine`, and `rca/engine` documented above.

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

- **ZTP → NetBox sync (Enterprise Upgrade B3, 2026-06-11):**
  - `ZTP_STATE_TO_NETBOX_STATUS: dict[str, str]` — maps `ztp/server.py`
    `ZTPState` values to NetBox device-status choices: `waiting→planned`,
    `contacted/provisioning→staged`, `provisioned→active`, `failed→failed`
    (`unknown` intentionally unmapped → no-op).
  - `async def sync_ztp_status(org_id, hostname, ztp_state) -> bool` —
    looks the device up by name and PATCHes its `status` (+ a `comments`
    audit line). Soft-fails (`False`) on missing config, unknown state,
    device not found, or any HTTP error — ZTP must never block on NetBox.
  - `async def create_dhcp_reservation(org_id, hostname, mgmt_ip, mac="")
    -> dict | None` — upserts an IPAM ip-address with `status="dhcp"`
    (NetBox's native DHCP status), `dns_name=hostname`, MAC in description;
    appends `/32` if `mgmt_ip` has no mask, honors `cfg.tenant_id`. Search
    by address → PATCH if found else POST.
  - **Router wiring** (`ztp/router.py`): `_NETBOX_ORG = os.getenv(
    "ZTP_NETBOX_ORG", "")` — ZTP endpoints are unauthenticated, so the org
    comes from the environment; when unset all sync is a no-op.
    `_netbox_fire_and_forget(coro)` schedules on the running loop (closes
    the coroutine when no org/loop); `_netbox_sync_state(dev)` /
    `_netbox_reserve_dhcp(dev)` are called from `/ztp/register` (reservation
    + status `planned`), `/ztp/register/bulk` (per device), and
    `/ztp/checkin` (status `provisioned`/`failed`). MAC is read from
    `dev.extra["mac"]` when supplied at registration.
  - Tests: `backend/tests/test_netbox_ztp.py` — 12 tests with a fake
    httpx client + patched `_get_config` (state-map coverage, PATCH/POST
    upsert paths, soft-fail paths, router no-op guards).

**Notes:**
- All functions call private `_get_config(org_id)` which queries `IntegrationConfig` table (`provider="netbox", enabled=True`) via `db._SessionLocal`. If DB not configured or row missing/disabled, all functions degrade gracefully (return `None`/empty/`False`).
- `_client(cfg)` builds an `httpx.AsyncClient` with `Authorization: Token <token>` header, 10s timeout.
- Reading device inventory **from** NetBox is implemented client-side in `frontend/src/lib/netbox.ts` (B1) — the backend module remains write/sync-oriented.

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
- `render_config(dev: ZTPDevice) -> str` — public wrapper around `_render_day0(dev)` that does **not** mutate device state (unlike `get_bootstrap_config`). Used by `ztp/file_export.py` (G-A6) to regenerate static files without marking devices `CONTACTED`.
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
| `GET /ztp/dhcp-options` | Returns ready-to-paste DHCP option 43/67 snippets for ISC-DHCP and Kea, per platform (uses `_server_url(request)` which reads `ZTP_SERVER_URL` env var or falls back to `request.base_url`). Also returns a `tftp_file_server` block (G-A6) documenting the `ztp-tftp`/`ztp-files` containers and example TFTP filenames. |
| `POST /ztp/export-files` | **(G-A6)** Regenerates the static ZTP file tree under `ZTP_FILES_DIR` — calls `file_export.export_all(server_url)`. Returns `{files_dir, exported_configs, exported_scripts}`. |

**Pydantic models:**
- `DeviceRegisterRequest`: `serial, hostname, platform="ios-xe", role="campus-access", mgmt_ip, mgmt_mask="255.255.255.0", mgmt_gw="", loopback_ip="", bgp_asn=65000, vlans: list[dict]=[], bake_policies: bool=False, policy_flags: dict[str,bool]={}, extra: dict={}`
- `BulkRegisterRequest`: `{devices: list[DeviceRegisterRequest]}`
- `CheckinRequest`: `{success: bool, detail: str=""}`
- `DeviceStatusResponse`: `{serial, hostname, platform, role, mgmt_ip, state, bake_policies, registered_at, contacted_at, provisioned_at, last_seen, error}`

**Notes:** This router is mounted directly on the FastAPI app (no `/api` prefix) — devices hit `http://<server>/ztp/...` directly (matches DHCP-served bootfile URLs). `register_device`/`register_bulk` now also call `file_export.export_device_config(dev)` (G-A6) so the nginx/TFTP static file tree stays in sync as devices are (re)registered.

---

#### `backend/ztp/file_export.py` (G-A6)
**Purpose:** Writes rendered Day-0 configs and platform POAP/ZTP scripts to `ZTP_FILES_DIR` (default `/tmp/netdesign_ztp_files`, mapped to `/app/ztp_files` and the shared `ztp_files` Docker volume) — the directory served by the new `ztp-files` (nginx, HTTP :8069) and `ztp-tftp` (`atmoz/tftpd`, UDP :69) containers added to all three docker-compose files. Lets legacy devices fetch their boot config/script via plain TFTP or a plain HTTP file mirror instead of calling the FastAPI `/ztp/bootstrap`/`/ztp/script` endpoints directly.

**Layout under `ZTP_FILES_DIR`:**
```
configs/{hostname}.cfg   — per-device Day 0 config (ztp_server.render_config(dev))
scripts/{platform}.py    — POAP/ZTP scripts: nxos_poap.py, eos_ztp.py, ios_xe_pnp.py
```

**Key exports:**
- `ZTP_FILES_DIR: Path` — `Path(os.environ.get("ZTP_FILES_DIR", "/tmp/netdesign_ztp_files"))`.
- `PLATFORM_SCRIPTS: dict[str, str]` — `{"nxos": "nxos_poap.py", "eos": "eos_ztp.py", "ios-xe": "ios_xe_pnp.py"}`.
- `export_device_config(dev: ZTPDevice, base_dir: Path | None = None) -> Path` — writes `{base_dir}/configs/{dev.hostname}.cfg` via `ztp_server.render_config(dev)` (no state mutation), returns the path.
- `export_platform_scripts(server_url: str, base_dir: Path | None = None) -> list[Path]` — writes `{base_dir}/scripts/{filename}` for each entry in `PLATFORM_SCRIPTS` via `ztp_server.get_platform_script(platform, server_url)`.
- `export_all(server_url: str, base_dir: Path | None = None) -> dict[str, list[str]]` — exports configs for every `ztp_server.all_devices()` plus all platform scripts; returns `{"configs": [...], "scripts": [...]}` (absolute path strings).

---

#### `backend/ztp/dhcp_gen.py`
**Purpose:** Generates an ISC-DHCP `dhcpd.conf` fragment (host stanzas) for ZTP onboarding — the missing piece between "device registered in NetDesign AI" and "device actually gets the right bootfile-name from DHCP."

**Key exports:**
- `generate_dhcp_config(devices: list[dict], ztp_server_ip: str, gateway: str, dns: str, subnet: str = "", subnet_mask: str = "", domain_name: str = "netdesign.local", lease_time: int = 600, tftp: bool = False) -> str`
  For each device dict (`hostname, platform, mgmt_ip`, optional `mac` or `extra.mac`), emits a `host {name} { hardware ethernet ...; fixed-address ...; next-server ...; filename "..."; }` stanza. Optional `subnet {...} {...}` block if `subnet`+`subnet_mask` given. IOS-XE devices in HTTP mode (`tftp=False`) additionally get a commented PnP option-43 hint and `vendor-class-identifier "ciscopnp"`.
  - **`tftp=False`** (default, unchanged): `filename` = `_boot_filename(platform, hostname)` → HTTP API path (e.g. `ztp/script/nxos`, `ztp/bootstrap/{hostname}`).
  - **`tftp=True`** (G-A6): `filename` = `_boot_filename(platform, hostname, tftp=True)` → path relative to the `ztp-tftp`/`ztp-files` static file root (e.g. `scripts/nxos_poap.py`, `configs/{hostname}.cfg`); header gets an extra `# Mode: TFTP (G-A6 ztp-tftp file server)` comment; IOS-XE PnP option-43 block is omitted (not applicable to plain TFTP).
- `_boot_filename(platform: str, hostname: str, tftp: bool = False) -> str` (private) — HTTP mode (default) maps platform → `ztp/script/{platform}` path (e.g. `nxos`/`nxos9k` → `ztp/script/nxos`, `ios-xe`/`iosxe`/`ios_xe` → `ztp/script/ios-xe`); unknown platforms fall back to `ztp/bootstrap/{hostname}`. TFTP mode (`tftp=True`, G-A6) maps platform → `scripts/{name}.py` via `_TFTP_MAP` (matching `file_export.PLATFORM_SCRIPTS`); unknown platforms fall back to `configs/{hostname}.cfg`.
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

#### `backend/telemetry/anomaly.py` (Enterprise Upgrade C3)
**Purpose:** Adaptive anomaly detection via rolling z-score baselines over in-process telemetry metrics — complements `alerting.py`'s static thresholds (CPU > 80%, memory > 90%, etc.) by flagging values that deviate sharply from each series' own recent history (catches gradual drift or spikes still below a fixed alert threshold).

**Data structures:**
- `@dataclass Anomaly`: `hostname, metric, labels: dict[str,str], value, baseline_mean, baseline_stddev, z_score, detected_at` + `.to_dict()` (rounds `value`/`baseline_mean`/`baseline_stddev` to 3 decimals, `z_score` to 2).
- `_series_key(metric_name, labels) -> tuple[str, tuple]` — `(metric_name, sorted(labels.items()))`; identifies an independent rolling series per (metric, label-set) combination (e.g. per device + interface).

**`class AnomalyDetector`** — stateful rolling-window detector:
- `__init__(window=20, min_samples=5, z_threshold=3.0)` — `window` = samples retained per series, `min_samples` = minimum history before z-scores are computed, `z_threshold` = `|z| >=` this flags an anomaly.
- `observe(metrics: dict[str, list[dict]]) -> list[Anomaly]` — for each `{metric_name: [{"labels":..., "value":...}, ...]}` sample: if the series has `>= min_samples` prior observations and `stddev > 0`, computes `z = (value - mean) / stddev` against the rolling history and appends an `Anomaly` if `|z| >= z_threshold`; always appends the new value to the series' `deque(maxlen=window)` afterward (division-by-zero safe for constant series).
- `baseline(metric_name, labels) -> dict | None` — current `{"mean", "stddev", "samples"}` for a series, or `None` if `< min_samples`.
- `reset()` — clears all series history.

**Module-level:**
- `_detector = AnomalyDetector()` — shared in-process singleton (mirrors `alerting.py`'s module-level pattern).
- `detect_anomalies(metrics=None, detector=None) -> list[Anomaly]` — `metrics=None` reads the live registry via `telemetry.alerting._collect_metrics()`; `detector=None` uses the shared `_detector` (pass an isolated instance in tests to avoid touching shared state).
- `reset_detector()` — clears the shared `_detector`'s history.

**Tests:** `backend/tests/test_anomaly.py` (12 tests) — `Anomaly.to_dict()` rounding/keys, min-samples gating, stable-series no-flag, spike detection (`|z| >= 3`), zero-variance no-divide-by-zero, window cap, independent label-set tracking, baseline stats, reset, and `detect_anomalies()` with an isolated detector leaving the shared singleton untouched.

**Wired into `backend/main.py`:** `GET /api/anomalies` (perm `designs:read`, response model `AnomalyResponse` mirroring `Anomaly.to_dict()`) — returns `[]` if telemetry deps unavailable (`_TELEMETRY_AVAILABLE` guard, same pattern as `/api/alerts`); 500 on unexpected errors.

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

#### Embedded monitoring stack (docker-compose, G-A7)

**Purpose:** Self-contained observability stack shipped in the compose files — the backend exposes Prometheus metrics at `/metrics` (`prometheus_client.make_asgi_app()`, see `main.py`), Prometheus scrapes them, **VictoriaMetrics** stores them long-term, and Grafana visualizes via auto-provisioned datasources + dashboards. No external/SaaS monitoring needed.

**Topology:**
```
api:8000/metrics ──scrape──> prometheus:9090 ──remote_write──> victoriametrics:8428
                                   │                                   │
                                   └────────── Grafana queries ────────┘
                                        (both are Grafana datasources)
```

**Services (`docker-compose.yml` always-on; `docker-compose.dist.yml` behind the `observability` profile):**
- `victoriametrics` (`victoriametrics/victoria-metrics:v1.97.1`, :8428) — long-term TSDB, Prometheus remote-write + query-API compatible; `--retentionPeriod=12` (months), data on the `vmdata` volume. (G-A7)
- `prometheus` (`prom/prometheus:v2.52.0`, :9090) — scrapes `api`/`worker`; now `remote_write`s to `http://victoriametrics:8428/api/v1/write` and `depends_on: [victoriametrics]`.
- `grafana` (`grafana/grafana:11.0.0`, :3000) — `depends_on: [prometheus, victoriametrics]`.

**Config files:**
- `backend/prometheus/prometheus.yml` (dev/full) and `ops/prometheus.yml` (dist) — both gained a `remote_write` block targeting VictoriaMetrics.
- `backend/grafana/provisioning/datasources/prometheus.yml` (dev/full) — now declares **two** datasources: `NetDesign Prometheus` (uid `netdesign-prometheus`, default — existing dashboards stay pinned to it) and `NetDesign VictoriaMetrics` (uid `netdesign-victoriametrics`, for long-term queries).
- `ops/grafana/datasources/datasources.yaml` (dist) — **new** file (dist Grafana previously had no datasource provisioning); same two datasources, mounted at `/etc/grafana/provisioning/datasources`.
- Dashboards: `backend/grafana/dashboards/{network-overview,gpu-fabric}.json` (dev), `ops/grafana/dashboards/network_health.json` (dist) — unchanged; pinned to the default Prometheus datasource.

**Note:** `docker-compose.local.yml` (minimal source-build stack) intentionally ships **no** monitoring services. `snmp-exporter` (from CLAUDE.md §19's stack list) is **not** included here — it needs a generated `snmp.yml`/MIB modules and is tracked separately as a follow-up (see CLAUDE.md §20 G-A17).

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
