# NetDesign AI — Autonomous Agent Roadmap

> This file is read by the scheduled development agent every 5 hours.
> It defines the product vision, feature backlog, tech stack constraints,
> and coding conventions. Update this file to steer the agent's priorities.

---

## Product Vision

**NetDesign AI** is the single tool for network engineers — from blank slate to running network.
It covers the full lifecycle in one browser-native 6-step wizard:

| Step | What it does |
|------|-------------|
| 1 | Use case selection + org sizing |
| 2 | Requirements (redundancy, bandwidth, protocols, compliance) |
| 3 | AI product recommendations + BOM |
| 4 | High-level + low-level design generation |
| 5 | Config generation (IOS-XE, NX-OS, EOS, JunOS, SONiC, Terraform) |
| 6 | Deploy & Validate (ZTP, monitoring, RCA, troubleshooting) |

---

## Tech Stack (CRITICAL — agent must respect these constraints)

- **Frontend**: Plain global JS (`'use strict'`), no ES modules, no build step, no npm for browser code
- **Styling**: Single CSS file, CSS variables for theming
- **Backend**: FastAPI (Python 3.11+), Uvicorn, Pydantic v2
- **MCP server**: `backend/mcp_server.py` (21 tools)
- **Hosting**: Vercel (frontend static) + Railway (backend)
- **Repo**: https://github.com/Amit33-design/Network-Automation
- **State**: Single global `STATE` object in `src/js/state.js`
- **No dependencies**: No React, no Vue, no webpack — pure DOM APIs

### File map
```
index.html              — Main app (all 6 steps)
src/js/
  state.js              — Global STATE + STEPS + UC_LABELS
  app.js                — Navigation, progress bar, sidebar, validation
  products.js           — PRODUCTS catalog (hardware SKUs with specs)
  scoring.js            — getLayersForUC(), scoreProduct(), estimateCounts()
  capacity.js           — Campus/DC/GPU/WAN capacity models
  recommendations.js    — BOM generation, product cards, vendor filter
  configgen.js          — Config dispatch + IOS-XE/NX-OS/EOS/JunOS/SONiC generators
  multicloud.js         — Multicloud + Aviatrix Terraform generators
  topology.js           — SVG HLD/LLD diagrams
  ztp.js                — Zero Touch Provisioning panel
  policyengine.js       — Policy rules engine
  observability.js      — Monitoring + alerts panel
  ts_engine.js          — Troubleshooting engine + RCA
  simulation.js         — Link failure simulation
  intentmodel.js        — Natural language intent parser
  export.js             — PDF/CSV export, design summary
  diffengine.js         — Config diff viewer
  gate.js               — Deployment gate checks
  deploy.js             — Deployment panel
  analytics.js          — PostHog funnel tracking
  paywall.js            — Clerk auth gate
  similar_designs.js    — Pinecone similarity search
  enterprise.js         — Enterprise feature flags
backend/
  main.py               — FastAPI app entry
  design_engine.py      — Core design computation
  mcp_server.py         — 21 MCP tools
  templates/            — Jinja2 config templates
```

---

## GitHub Issues
All backlog items are tracked as GitHub Issues:
https://github.com/Amit33-design/Network-Automation/issues

> **Agent**: when you complete a feature, close the corresponding issue with:
> `gh issue close <N> --repo Amit33-design/Network-Automation --comment "Implemented in commit <hash>"`

---

## Feature Backlog (priority order)

### TIER 1 — Core gaps (ship these first)

#### BOM Enhancements
- [x] **Cabling matrix** [#4](https://github.com/Amit33-design/Network-Automation/issues/4): For each BOM layer pair (e.g. spine↔leaf), generate a cable schedule: port A device/interface → port B device/interface, cable type (DAC/AOC/LC-LC), length (1m/3m/5m), quantity, part number
- [x] **Optics catalog** [#5](https://github.com/Amit33-design/Network-Automation/issues/5): Add optics to PRODUCTS or a separate OPTICS catalog — SFP-10G-SR, QSFP-100G-SR4, QSFP-DD-400G-DR4, etc. with vendor (Cisco OEM, Finisar, Lumentum), reach, cost, and compatibility matrix
- [x] **Price database** [#6](https://github.com/Amit33-design/Network-Automation/issues/6): Add `estimatedCostUSD` to all PRODUCTS entries (currently missing on most). Pull reference pricing from public sources. Add total BOM cost estimate in the BOM footer
- [x] **Device naming convention** [#7](https://github.com/Amit33-design/Network-Automation/issues/7): Systematic hostname generator — `{site}-{role}-{rack}-{idx}` e.g. `IAD-LEAF-A01-01` based on STATE.orgName, numSites, role
- [x] **Rack unit planning**: Add `rackU` field to PRODUCTS. Generate rack diagram data showing U consumption per device

#### Config Generation Gaps
- [x] **OSPF underlay** [#8](https://github.com/Amit33-design/Network-Automation/issues/8): Currently BGP-only. Add OSPF area 0 underlay config for campus and DC use cases
- [x] **STP/RSTP config**: Add Rapid-PVST+/MST config blocks for campus switches (port types, portfast, BPDU guard)
- [x] **QoS policies** [#9](https://github.com/Amit33-design/Network-Automation/issues/9): Add QoS classification + marking + queuing configs per vendor (DSCP 46 for voice, 34 for video, etc.)
- [x] **AAA/TACACS+** [#10](https://github.com/Amit33-design/Network-Automation/issues/10): Add TACACS+ / RADIUS config blocks for all vendors
- [x] **NTP + SNMP v3** [#11](https://github.com/Amit33-design/Network-Automation/issues/11): Add NTP server hierarchy + SNMP v3 auth+priv config to all vendors
- [x] **interface descriptions**: Auto-generate `description` lines from the cabling matrix (e.g. `description TO: IAD-SPINE-01 Eth1/1`)

#### ZTP (Zero Touch Provisioning)
- [x] **DHCP option 67 + Netmiko** [#12](https://github.com/Amit33-design/Network-Automation/issues/12): Generate ISC DHCP / Cisco IOS DHCP config for ZTP boot file delivery + Netmiko onboarding script
- [x] **Ansible playbook** [#13](https://github.com/Amit33-design/Network-Automation/issues/13): Generate `site.yml` + roles for pushing generated configs via NAPALM/netconf
- [x] **Serial number → hostname mapping**: ZTP lookup table (CSV/YAML) mapping serial numbers to hostnames for Cisco ZTP / Arista ZTP
- [x] **POAP (Cisco)**: Generate Cisco POAP Python script
- [x] **EOS ZTP**: Generate Arista EOS ZTP script

#### Policy Management
- [x] **ACL generator** [#14](https://github.com/Amit33-design/Network-Automation/issues/14): Generate named ACLs / prefix-lists from compliance selections (PCI, HIPAA zones)
- [x] **BGP route-policy validator**: Check generated BGP policies for common mistakes (missing default deny, wrong community syntax)
- [x] **Firewall rule consistency check**: Cross-check FW rules with network segmentation design — flag any policy that contradicts the HLD
- [x] **Policy diff**: Show what changed between two policy versions (already have diffengine.js — extend it for policies)

#### Pre/Post Deployment Checks
- [x] **Pre/Post-check scripts** [#15](https://github.com/Amit33-design/Network-Automation/issues/15): Generate Python/Bash scripts that SSH to devices and verify: interface states, BGP neighbor count, routing table prefixes, LLDP neighbors match expected topology
- [x] **NetBox sync** [#20](https://github.com/Amit33-design/Network-Automation/issues/20): Generate Python script to sync deployed topology to NetBox (using pynetbox)
- [x] **Change window validator**: Check if proposed changes violate any maintenance window rules

### TIER 2 — Monitoring & Observability

- [x] **Prometheus alert rules** [#16](https://github.com/Amit33-design/Network-Automation/issues/16): Generate `alert.rules.yml` for device-specific alerts (BGP session down, interface error rate, CPU > 80%)
- [x] **Grafana dashboard JSON** [#17](https://github.com/Amit33-design/Network-Automation/issues/17): Generate Grafana dashboard for the designed topology (panels per device/layer)
- [x] **SNMP MIB mapping**: Map key SNMP OIDs to human-readable labels for each vendor in the product catalog
- [x] **Syslog parsing rules**: Generate Logstash/Fluentd parsing rules for vendor-specific syslog formats
- [x] **Netflow/sFlow collector config**: Generate nfcapd / pmacct config for flow collection from designed devices
- [x] **Real-time topology sync**: observability.js poll loop that refreshes topology from backend health-check API

### TIER 3 — ML-Based Troubleshooting & RCA

- [ ] **Symptom classifier**: Train/embed a simple nearest-neighbor classifier over a dataset of (symptom, root cause) pairs for common network issues. Use it in ts_engine.js to suggest root causes from free-text symptoms
- [x] **BGP convergence predictor** [#19](https://github.com/Amit33-design/Network-Automation/issues/19): Given the topology (AS count, path count, policy complexity), estimate convergence time and flag risks
- [ ] **Anomaly detection**: Add a time-series anomaly detector in observability.js — flag metrics deviating > 2σ from rolling baseline
- [x] **RCA playbook generator** [#18](https://github.com/Amit33-design/Network-Automation/issues/18): Given an alert type (e.g. "BGP neighbor down"), generate a step-by-step RCA playbook as a downloadable Markdown/PDF
- [ ] **Historical incident database**: Embed a JSONL of common network incident patterns with resolution steps; use cosine similarity to find relevant past incidents
- [ ] **Confidence scoring**: Each RCA suggestion should include a confidence %, reasoning chain, and evidence references

### TIER 4 — Integrations

- [ ] **NetBox API**: Read existing inventory from NetBox to pre-fill STATE fields
- [ ] **Nautobot**: Same as NetBox
- [ ] **DNAC / Catalyst Center**: Push configs via DNAC intent API
- [ ] **Ansible Tower / AWX**: Generate and launch AWX job templates via API
- [ ] **ServiceNow CMDB**: Push BOM + topology to ServiceNow CMDB
- [ ] **PeeringDB**: Pull IX peering data for WAN/multicloud use cases
- [ ] **Cisco EoL / EoS API**: Flag any product in BOM that is end-of-life or end-of-sale

---

## Coding Conventions (agent must follow exactly)

1. **Global JS only** — No `export`, `import`, `require`. Expose via `window.fnName = fnName`
2. **`'use strict'`** at top of every JS file
3. **`var` preferred** in new multicloud/aviatrix code (legacy style); `const`/`let` OK in existing files
4. **No external CDN** dependencies added without discussion
5. **Toast notifications**: use `toast('message', 'info'|'success'|'error')` for user feedback
6. **STATE updates**: always update `STATE.fieldName` AND re-call `updateSummary()` after UI changes
7. **Python**: FastAPI + Pydantic v2, type-annotated, async where possible
8. **Commit messages**: conventional commits format (`feat:`, `fix:`, `chore:`, `docs:`)
9. **No breaking changes**: new features must not break existing use cases (campus/dc/gpu/wan/multisite/multicloud)
10. **Test before committing**: for Python, run `python -m pytest` if tests exist; for JS, manually trace through the logic

---

## Agent Instructions

Each run, the agent should:

0. **Ensure correct branch**: Run `git fetch origin && git checkout main && git pull origin main` — ALWAYS start on `main`, never work on `master` or any other branch
1. **Read this file** (`AGENT_ROADMAP.md`) to understand current priorities
2. **Check git log** (`git log --oneline -20`) to see what was recently done
3. **Grep for TODOs** (`grep -r "TODO\|FIXME\|HACK\|XXX" src/js/ backend/ --include="*.js" --include="*.py" -n`)
4. **Pick the highest-priority incomplete feature** from TIER 1 that hasn't been implemented yet (pick the first unchecked `[ ]` item)
5. **Implement it** following the coding conventions above
6. **Verify** it doesn't break existing functionality (trace through affected code paths)
7. **Commit** with a descriptive conventional-commit message, e.g. `feat: price database — estimatedCostUSD for all PRODUCTS (#6)`
8. **Close the GitHub issue**: `gh issue close <N> --repo Amit33-design/Network-Automation --comment "Implemented in commit $(git rev-parse --short HEAD)"`
9. **Update this file** — mark completed items with `[x]` and add any new discoveries to the backlog
10. **Document** what was done in a `## Agent Log` section at the bottom of this file

The agent should aim to complete **1-2 full features** per 5-hour run, not start many things partially.

---

## Agent Log

<!-- The agent appends entries here after each run -->

### Run 2026-05-19 (manual — interactive session)
**Implemented**: Optics catalog (#5), ZTP DHCP+Netmiko (#12), ACL generator (#14), Prometheus alerts (#16), Grafana dashboard (#17)
**Files changed**: src/js/optics.js (new), src/js/ztp.js, src/js/policyengine.js, src/js/observability.js, src/js/recommendations.js, index.html
**Summary**: Added 16-SKU optics catalog (1G–400G, auto-selected by layer/distance) with BOM table and CSV export. Added ISC DHCP config generator (option 43/67 for all vendors) and Python Netmiko script with inventory CSV support to ZTP panel. Added named ACL generator for PCI/HIPAA/SOC2 compliance covering all 4 vendors. Added Prometheus alert rules (BGP, interface, CPU, memory, error rate) and Grafana dashboard JSON (per-device panels per BOM layer) with download buttons.

### 2026-05-19

**Features completed this run:**

1. **Price database (#6)** — `81bea99`
   - All PRODUCTS already had `estimatedCostUSD`; wired it into the BOM UI.
   - `updateBOMTable()` computes Unit Price + Extended Cost per row; Total BOM Cost shown in footer (green).
   - `exportBOM()` CSV now includes Unit Price (USD) and Extended Cost (USD) columns plus a TOTAL row.
   - BOM table `<thead>` updated with two new right-aligned columns.

2. **Device hostname generator (#7)** — `aff2de8`
   - Created `src/js/naming.js` with `window.generateHostnames(devices, state)`.
   - Pattern: `{SITE}-{ROLE}-{RACK}-{IDX:02d}` (e.g. `NYC-LEAF-A01-01`, `HQ-CORE-A01-01`).
   - Site code derived from `STATE.orgName` (multi-word → initials, single-word → first 4 chars).
   - Leaf/dist/TOR devices grouped 2-per-rack (A01, A02…); all others in A01.
   - `buildDeviceList()` calls it automatically for campus/dc/gpu/wan/hybrid (skips multisite/multicloud).
   - BOM table shows `first … last` hostname range per layer; CSV export includes full hostname list.

**Issues closed:** #6, #7

### 2026-05-19 (run 2)

**Features completed this run:**

1. **Cabling matrix (#4)** — `144bc10`
   - Created `src/js/cabling.js` with four public functions exposed via `window.*`.
   - `generateCablingMatrix(layers, state)` — builds cable rows per layer pair.
   - Cable-type rules: DAC ≤3 m, AOC ≤100 m, LC-LC SMF >100 m.
   - Link pairs: campus access↔dist (5 m AOC), dist↔core (20 m AOC), DC leaf↔spine (3 m DAC), GPU TOR↔spine (3 m DAC), WAN branch↔hub (500 m LC-LC SMF).
   - Full-mesh uplink model for DC/GPU; each campus access gets exactly 2 uplinks to its dist pair.
   - Generic reference part numbers keyed by `{speed}-{cableType}` (e.g. `QSFP-100G-CU3M`, `SFP-10G-AOC5M`, `QSFP-100G-LR4`).
   - `updateCablingMatrix()` renders a collapsible table inside `#bom-section`; called automatically from `updateBOMTable()`.
   - `getCablingCSVSection()` appends full per-device-pair cable schedule to `exportBOM()` CSV.
   - CSS: `.cable-type-badge`, `.cable-dac` (green), `.cable-aoc` (cyan), `.cable-smf` (purple), `.cable-speed` (blue) added to `src/css/main.css`.
   - `#cabling-section` div added inside `#bom-section` in `index.html`; script tag added after `recommendations.js`.

**Issues closed:** #4

### 2026-05-19 (run 3)

**Features completed this run:**

1. **NTP + SNMP v3 (#11)** — `16fcf57`
   - Added `_genNTP(vendor)` and `_genSNMPv3(vendor)` private helpers to `configgen.js` (inserted before CONFIG GENERATION TEMPLATES section).
   - **IOS-XE**: `ntp authenticate` + md5 key 1; SNMP v3 group/view/user (SHA auth + AES-128 priv); removes v2c communities; appended via `cfg +=` in common footer.
   - **NX-OS**: same pattern with `use-vrf management`; `snmp-server user` localizedkey syntax; appended via `cfg +=` after mgmt interface block.
   - **EOS**: `ntp authenticate`; `snmp-server user … priv aes128`; injected via `${…}` interpolation in return template.
   - **JunOS**: NTP auth-key block inside `system { ntp {} }`; top-level `snmp { v3 { usm/vacm } }` block — also fixes pre-existing bug where `snmp {}` was incorrectly nested inside `system {}`.
   - **SONiC**: `config_db.json` NTP stanza + `/etc/snmp/snmpd.conf` net-snmp v3 `createUser`/`group`/`access`/`rouser`/`trapsess` lines.
   - `SECTION_MARKERS` extended with `'SNMP'` so the section-nav jump bar gains an SNMP button.

**Issues closed:** #11

### 2026-05-19 (run 4)

**Features completed this run:**

1. **AAA/TACACS+ (#10)** — `3642210`
   - Added `_genAAA(vendor, state)` helper in `configgen.js` covering all 5 vendors.
   - **IOS-XE**: `tacacs server` named objects + `TACACS-GROUP` aaa-group with source-interface; full `aaa authentication/authorization/accounting` for login, enable, exec, commands 1 + 15; `line vty` uses `login authentication default` (removes hardcoded `login local`).
   - **NX-OS**: `tacacs-server host` entries + `TACACS-GROUP` with `use-vrf management` + `source-interface mgmt0`; aaa auth/authz/accounting for login, console, enable.
   - **EOS**: `tacacs-server` hosts + `TACACS-GROUP`; aaa auth login/enable/exec/commands all + accounting exec+commands.
   - **JunOS**: `tacplus-server` block with `single-connection`; `authentication-order [ tacplus password ]`; `accounting events [ login change-log interactive-commands ]` — appended as a top-level `system {}` stanza (JunOS merges on load).
   - **SONiC**: `TACPLUS_SERVER` + `AAA` stanza in `config_db.json` with `failthrough=true`; comment shows apply command.
   - `SECTION_MARKERS` extended with `'AAA'` for the section-nav jump bar.

**Issues closed:** #10

### 2026-05-19 (run 5)

**Features completed this run:**

1. **OSPF underlay (#8)** — `5efd87f`
   - Added `_genOSPFUnderlay(vendor, state, dev, layer, idx)` helper in `configgen.js` for NX-OS, EOS, JunOS, SONiC.
   - **NX-OS**: `feature ospf` added conditionally; `router ospf UNDERLAY` with MD5 auth area 0; passive-interface default + no-passive on spine (Eth1/1–4) or leaf uplinks (Eth1/49–50); per-interface `ip ospf point-to-point` + `mtu-ignore`.
   - **EOS**: `router ospf 1` with `bfd all-interfaces`, passive-interface default, per-uplink no-passive; `ip ospf network point-to-point` per interface.
   - **JunOS**: `protocols { ospf { area 0.0.0.0 { ... } } }` with p2p interface-type and MD5 auth; appended after the BGP block as a separate `protocols {}` merge stanza.
   - **SONiC**: FRRouting `/etc/frr/frr.conf` OSPF stanza with passive-interface default, MD5 auth on uplinks, `sudo systemctl restart frr` apply comment.
   - **IOS-XE campus**: already had inline OSPF (unchanged).
   - `hasOSPF` derived from `STATE.underlayProto.includes('OSPF')` via `_rs()`; GPU TOR excluded.
   - `'OSPF'` added to `SECTION_MARKERS` for section-nav jump bar.

**Issues closed:** #8

### 2026-05-20 (run 6)

**Features completed this run:**

1. **QoS policies (#9)** — `02c70c2`
   - Added `_genQoS(vendor, state)` helper in `configgen.js` covering all 5 vendors.
   - **IOS-XE**: `class-map match-any VOICE/VIDEO/CRITICAL-DATA` (DSCP ef/af41/af31); `policy-map MARK-INGRESS` + `QUEUING-POLICY` (priority 15%, bandwidth 20%/25%); applied to `interface range Gi1/0/1-48`.
   - **NX-OS**: `class-map type qos` CLASSIFY mapping to qos-groups 5/4/3; `class-map type queuing` + `policy-map type queuing QUEUING-POLICY` applied via `system qos`.
   - **EOS**: `class-map type traffic` + `policy-map type quality-of-service QUEUING-POLICY`; explicit `qos map dscp to traffic-class` lines (46→6, 34→4, 26→3); applied to `interface Ethernet1-48`.
   - **JunOS**: full `class-of-service {}` block — `forwarding-classes`, DSCP `classifiers`, per-class `schedulers` (strict-high for voice, WRR for others), `scheduler-maps`, interface `<*>` binding.
   - **SONiC**: `config_db.json` excerpt with `DSCP_TO_TC_MAP`, `TC_TO_QUEUE_MAP`, `SCHEDULER` (STRICT for voice, WRR for rest), `QUEUE` entries; apply via `sudo config qos reload`.
   - `_genQoS` injected before NTP/SNMP/AAA in every vendor's config footer.
   - `'QoS'` was already in `SECTION_MARKERS`; section-nav jump button works without additional changes.

**Issues closed:** #9

### 2026-05-20 (run 6, continued)

**Features completed this run:**

1. **QoS policies (#9)** — `02c70c2` *(logged above)*

2. **Pre/Post-check scripts (#15)** — `98637e3`
   - Created `src/js/checks.js` with five `window.*` public functions.
   - `genPreCheckScript(state)` — Python+Netmiko script: SSHs to all BOM devices (inventory auto-built from `buildDeviceList()`), captures baseline interface states, BGP peer count, routing table summary, LLDP neighbors; saves `pre_check_baseline_<ts>.json`.
   - `genPostCheckScript(state)` — SSHs post-deploy, diffs against baseline; flags BGP peer drop, interface loss, route count shrinkage; exits 1 on failures; JSON report saved.
   - Per-vendor show commands for ios-xe, nxos, eos, junos, sonic (6 commands each).
   - Device inventory uses same mgmt IP convention (`10.0.0.3x`) and `getOS()` as configgen.js.
   - `downloadPreCheckScript()` / `downloadPostCheckScript()` trigger browser download.
   - `renderChecksPanel()` renders a 2-card download panel into `#checks-download-panel`.
   - `index.html`: `#checks-download-panel` div added above deploy action bar; `<script>` tag added after `ztp.js`.
   - `app.js`: `renderChecksPanel()` called in `jumpStep(6)` init block.
   - `main.css`: 10 `.checks-*` rule blocks for panel styling.

**Issues closed:** #9, #15

### Run 2026-05-19 (manual — interactive session, batch 2)
**Implemented**: Ansible (#13), ZTP serial/POAP/EOS ZTP, BGP validator, RCA playbooks (#18), BGP convergence (#19), NetBox sync (#20)
**Files changed**: src/js/ansible.js (new), src/js/ztp.js, src/js/policyengine.js, src/js/ts_engine.js, src/js/observability.js, index.html
**Summary**: Ansible playbook generator produces 10+ files (site.yml, roles, inventory, host_vars). ZTP panel now has serial→hostname CSV, Cisco POAP script, Arista EOS ZTP script. BGP validator checks 6 common policy mistakes. RCA playbook generator covers 4 alert types with vendor-specific verify commands. BGP convergence predictor estimates failover time with BFD/no-BFD and flags risks. NetBox sync script uses pynetbox with DRY_RUN mode.

### 2026-05-20 (run 7)

**Features completed this run:**

1. **Rack unit planning** — `b5c67ee`
   - Added `rackU` field to all 42 PRODUCTS entries via Python script: 1U for fixed/pizza-box, 2U for 2RU devices, 4U for PA-5445, 7U for Aruba CX 6405 (5-slot chassis), 10U for Cat 9600 (7-slot), 14U for Arista 7500R3 / NVIDIA SN4800 / Arista 7800R3 (8-slot chassis).
   - Updated products.js header comment to document `rackU` field.
   - BOM table gains a "Rack U" column displaying `{rackU}U × {qty}` per layer.
   - BOM footer extended with: "Rack U consumed: XU" and "Racks needed: N × 42U" (80% fill rule).
   - Collapsible `#rack-plan-section` rendered below cabling matrix: per-layer table with fill bar (% of 42U rack) and summary footer.
   - `exportBOM()` CSV updated: "Rack U each", "Total Rack U" columns plus "RACKS NEEDED" summary row.
   - CSS: `.rack-fill-bar` + `.rack-fill-inner` with blue→cyan gradient for fill bars.

2. **STP/RSTP config** — `b5c67ee`
   - Added `_genSTP(vendor, layer)` helper in `configgen.js` covering IOS-XE, EOS, JunOS, NX-OS.
   - Root bridge priority: campus-core=4096 (root primary), campus-dist=8192 (root secondary), campus-access=32768 (defer) — correct Cisco STP best practice hierarchy.
   - **IOS-XE**: Rapid-PVST+, extend system-id, pathcost long, loopguard default, BPDU guard default; also fixes pre-existing bug where dist had priority 4096 instead of 8192.
   - **EOS**: spanning-tree mode rapid-pvst, vlan-id priority, loopguard default, portfast/bpduguard default on access.
   - **JunOS**: Full `protocols { rstp { bridge-priority N; interface all { edge; no-root-port; } bpdu-block-on-edge; } }` block; replaces the previous stub `rstp { bridge-priority 32768; }` inline.
   - **NX-OS**: Rapid-PVST+, port type network default (dist/core), port type edge bpduguard default (access).
   - Called from genIOSXE (access/dist/core blocks), genEOS footer, genJunos footer, genNXOS footer; returns `''` for non-campus layers (DC/GPU/WAN) — no-op.
   - `'STP'` added to `SECTION_MARKERS` for section-nav jump bar.

**Issues closed:** none (no GitHub issue numbers for these backlog items)

3. **Interface descriptions from cabling matrix** — `b894b33`
   - Added `buildInterfaceDescMap()` to `cabling.js`: builds `{ deviceName: [{ remote, remotePort }, …] }` from `generateCablingMatrix()`.
   - Added `getUplinkDescs(devName)` → ordered `['TO: <remote> <port>', …]` strings; both exposed via `window.*`.
   - **IOS-XE**: GigabitEthernet0/1-2 (access uplinks), TenGigE uplinks to core + Gi downlinks to access (dist), TenGigE2/1-4 (core downlinks to dist) all use cabling-derived descriptions with fallback.
   - **NX-OS**: Ethernet1/1-4 spine downlinks + Ethernet1/49-50 leaf uplinks → cabling-derived.
   - **EOS**: Ethernet49/1, Ethernet50/1 uplinks → cabling-derived.
   - **JunOS**: et-0/0/48, et-0/0/49 uplinks → cabling-derived.
   - Fallback to original hardcoded string if cabling data not ready (STATE/BOM not yet selected).

### 2026-05-20 (run 8)

**Features completed this run:**

1. **Firewall rule consistency check** — `7823c5f`
   - Added `checkFWConsistency(state)` + `renderFWConsistencyPanel()` to `policyengine.js`.
   - 10 checks: compliance→FW required, PCI CHD zone, HIPAA PHI zone, WAN edge, campus internet edge, DC east-west, multicloud, IoT/OT isolation, FW-without-zones, FW-without-compliance.
   - Severity levels: error (contradictions) / warning (best practice) / info (advisory).
   - Renders as colored rows (red/yellow/grey) in `#fw-consistency-panel` inside Step 6.
   - Auto-called by `jumpStep(6)` via app.js hook.

2. **Policy diff** — `7823c5f`
   - Added `takePolicySnapshot()` and `renderPolicyDiff()` to `policyengine.js`.
   - `takePolicySnapshot()` deep-copies `POLICY_RESULTS` into `_POLICY_SNAPSHOT`.
   - `renderPolicyDiff()` re-runs policies, computes added/removed/unchanged entries, renders green/red diff rows.
   - `#policy-diff-panel` section in Step 6 with Take Snapshot + Show Diff buttons.

3. **Change window validator** — `6fe729c`
   - Created `src/js/changewindow.js` (215 lines) with `window.*` public API.
   - `CHANGE_WINDOWS` config array persisted in `localStorage` (key: `netdesign_change_windows`).
   - Defaults: Weekend (Sat/Sun all-day) + Weeknight Off-Hours (Mon–Fri 22:00–06:00).
   - `checkChangeWindow()` handles overnight windows (e.g. 22:00→06:00 next-day).
   - `renderChangeWindowPanel()` shows live status bar + config table; per-row toggle (ON/OFF), ACTIVE NOW badge, delete; Add Window / Reset Defaults / Refresh buttons.
   - `deploy.js simulateCheck('Change window')` now calls real `checkChangeWindow()` — returns FAIL when outside window, PASS when inside, info when unconfigured (previously always hardcoded PASS).
   - CSS: `.cw-*` rules for status bar, table, badges, and delete button.

**Issues closed:** none (these items had no GitHub issue numbers)

### 2026-05-20 (run 9)

**Features completed this run:**

1. **SNMP MIB mapping** — `7232ce6`
   - Added `SNMP_MIBS` static array (55 entries) to `observability.js` covering: SNMPv2-MIB (sysDescr/sysUpTime/sysName), IF-MIB (32-bit + 64-bit counters, ifAdminStatus/ifOperStatus, ifAlias), BGP4-MIB (peer state/FSM time/prefixes/updates), OSPF-MIB (neighbor state + interface state), ENTITY-MIB (physical description/name/serial).
   - Vendor-private: Cisco CISCO-PROCESS-MIB (cpmCPUTotal5minRev, cpmCPUMemory*), CISCO-MEMORY-POOL-MIB, CISCO-ENVMON-MIB (temp + fan), CISCO-BGP4-MIB (cbgpPeer2State + cbgpPeer2PrefixAccepted), CISCO-VTP-MIB, CISCO-STACKWISE-MIB; Arista ARISTA-BGP4V2-MIB, ARISTA-PROCESS-MIB, ARISTA-SYSDB-MIB, ARISTA-ENVMON-MIB; Juniper JUNIPER-MIB (CPU/mem/temp/state), JUNIPER-BGP-TYPES, JUNIPER-ALARM-MIB; SONiC HOST-RESOURCES-MIB (hrProcessorLoad, hrStorageUsed/Size, hrSystemUptime).
   - `genSNMPMIBMapping(state)` filters by `STATE.vendor` and generates annotated CSV + `snmp_exporter` walk config comments.
   - `renderSNMPMIBPanel()` builds a striped HTML table with vendor color coding; auto-called via `jumpStep(6)`.
   - Download button: `⬇ MIB Map CSV` in the new "📋 SNMP MIB Reference" obs-block.

2. **Syslog parsing rules** — `7232ce6`
   - Added `_SYSLOG_PATTERNS` map covering IOS-XE, NX-OS, EOS, JunOS, SONiC with example log lines, Logstash grok patterns, and Fluentd regexp patterns.
   - `genSyslogParsingRules(state)` produces a 3-part config file: (1) Logstash `network-syslog.conf` (input UDP/TCP 514, per-vendor conditional grok, severity normalisation, date parsing, Elasticsearch output); (2) Fluentd `td-agent` config (syslog source UDP+TCP, per-vendor parser filter, record_transformer for severity_text, Elasticsearch match); (3) Device syslog client snippets for all 5 vendors.
   - Download button: `⬇ Logstash/Fluentd Syslog Rules` in the new "📥 Log Pipeline & Flow Collector" obs-block.

3. **NetFlow/sFlow collector config** — `7232ce6`
   - `genNetflowConfig(state)` produces a 4-part config: (1) nfcapd startup command + systemd unit (NFDUMP suite, NetFlow v5/v9/IPFIX on UDP 9995); (2) pmacct nfacctd.conf (Prometheus memory plugin + CSV rotation every 5 min); (3) pmacct sfacctd.conf (sFlow on UDP 6343); (4) per-device exporter snippets auto-generated from BOM — IOS-XE IPFIX `flow exporter`/`flow monitor`, NX-OS `feature netflow` + v9 exporter, EOS `flow tracking hardware` IPFIX, JunOS `forwarding-options sampling` inline-jflow, SONiC hsflowd.conf snippet.
   - Download button: `⬇ NetFlow/sFlow Collector Config`.

4. **Real-time topology sync** — `7232ce6`
   - `_TOPO_SYNC` object with handle, interval (15 s), and cached data.
   - `startTopoSync()` / `stopTopoSync()` manage `setInterval`; start button disables on start, stop button enables.
   - `_fetchTopoHealth()` calls `/api/topology/health`, caches response, calls `_renderTopoSync()`.
   - `_renderTopoSync()` renders a responsive device-card grid (up=green / down=red) with summary badges and latency labels; graceful placeholders for no-backend / API-error states.
   - `renderTopoSyncPanel()` called from `jumpStep(6)` to paint initial placeholder.
   - Last-polled timestamp shown next to Start/Stop buttons.

**Issues closed:** none (Tier 2 items had no GitHub issue numbers)
