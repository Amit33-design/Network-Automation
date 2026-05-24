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

- [x] **Symptom classifier**: Train/embed a simple nearest-neighbor classifier over a dataset of (symptom, root cause) pairs for common network issues. Use it in ts_engine.js to suggest root causes from free-text symptoms
- [x] **BGP convergence predictor** [#19](https://github.com/Amit33-design/Network-Automation/issues/19): Given the topology (AS count, path count, policy complexity), estimate convergence time and flag risks
- [x] **Anomaly detection**: Add a time-series anomaly detector in observability.js — flag metrics deviating > 2σ from rolling baseline
- [x] **RCA playbook generator** [#18](https://github.com/Amit33-design/Network-Automation/issues/18): Given an alert type (e.g. "BGP neighbor down"), generate a step-by-step RCA playbook as a downloadable Markdown/PDF
- [x] **Historical incident database**: Embed a JSONL of common network incident patterns with resolution steps; use cosine similarity to find relevant past incidents
- [x] **Confidence scoring**: Each RCA suggestion should include a confidence %, reasoning chain, and evidence references

### TIER 4 — Integrations

- [x] **NetBox API**: Read existing inventory from NetBox to pre-fill STATE fields
- [x] **Nautobot**: Same as NetBox
- [x] **DNAC / Catalyst Center**: Push configs via DNAC intent API
- [x] **Ansible Tower / AWX**: Generate and launch AWX job templates via API
- [x] **ServiceNow CMDB**: Push BOM + topology to ServiceNow CMDB
- [x] **PeeringDB**: Pull IX peering data for WAN/multicloud use cases
- [x] **Cisco EoL / EoS API**: Flag any product in BOM that is end-of-life or end-of-sale

### TIER 5 — Day-2 Operations

- [x] **Day-2 Operations Toolkit**: Config backup (git + rotation), rolling firmware upgrade (health-gated, per-vendor), maintenance-mode drain (OSPF max-metric + BGP graceful-shutdown) scripts for all 5 NOS

### TIER 6 — Config Quality & UX

- [x] **Config Parameters Panel**: Step 5 collapsible form to customize NTP/TACACS/SNMP/syslog server IPs, domain name, BGP ASNs, and credentials before generating configs. Values persist in localStorage and update all vendor configs on Apply.
- [ ] **Config Linter**: Analyze generated vendor configs for missing mandatory sections, known anti-patterns (e.g. `no shutdown` on management, NTP without auth, BGP without `maximum-paths`). Show as a badge count + panel in Step 5 config viewer.
- [ ] **Port Capacity Report**: Per-device table showing fabric ports used vs. total, oversubscription ratio, and uplink headroom. Flag devices near capacity. Available in BOM step.
- [ ] **Multi-vendor Consistency Checker**: Verify that NTP servers, TACACS+ servers, SNMP trap targets, and domain name are consistent across ALL generated configs. Surface mismatches as a summary panel.

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

### 2026-05-20 (run 10)

**Features completed this run:**

1. **Symptom classifier** (Tier 3) — `e2d4fc5`
   - Added 35-entry curated training dataset (`_SC_DATASET`) covering BGP (session/prefix/flap/AS-path/community), OSPF (adjacency/LSA), routing (loop/MTU/asymmetric/IPSec), interface (flapping/CRC/duplex/LACP/VLAN), STP (loop/BPDU-guard), hardware (CPU/memory/thermal/PSU), overlay (VXLAN/EVPN/PFC), QoS (queue-drops/microbursts), management (DHCP/DNS/NTP/SNMP/ZTP/syslog), security (ACL/port-security).
   - Pure client-side TF cosine-similarity engine: `_scTokenize()` (stopword filtering), `_scUnitVec()` (TF normalization), `_scCosine()` (dot-product on unit vectors), `_scBuildIndex()` (lazy pre-computation of training vectors).
   - `classifySymptom(text, topN)` public API — returns top-N ranked results with `{ rootCause, category, confidence%, verify[], fix[] }`.
   - `renderSymptomClassifier()` — renders collapsible result cards with BEST MATCH badge, color-coded category, confidence bar, ▸ Verify commands (code blocks), ▸ Fix steps (ordered list).
   - `"🧠 Symptom Classifier"` ts-section added before "🔬 AI Root Cause Analysis" — Enter key triggers classification.
   - No backend required — runs entirely in the browser; index pre-built lazily on first call (~35 dot-products per query).

**Issues closed:** none (no GitHub issue number for symptom classifier)

### 2026-05-20 (run 10)

**Features completed this run:**

1. **Anomaly detection** — `889bb3c`
   - Added `_ANOMALY` state object + `detectAnomalies()` + `renderAnomalyPanel()` to `observability.js`.
   - 30-sample sliding window per device; seeded with 25 stable baseline readings on first call.
   - Metrics tracked: CPU %, memory %, interface error rate /s, BGP peer count.
   - CRITICAL (>3σ) / WARNING (>2σ) severity with z-score badge, colored bar, layer label.
   - `#anomaly-detection-panel` obs-block added to Step 6 obs-section; `renderAnomalyPanel()` auto-called in `jumpStep(6)` + Scan button.

2. **Historical incident database** — `889bb3c`
   - Added `_INCIDENT_DB` (20 curated incidents, INC-001..INC-020) to `ts_engine.js`.
   - Covers: BGP full-table OOM, STP loop, VXLAN MAC flap, OSPF partition, PFC storm, TACACS+ lockout, BGP RR SPOF, DHCP exhaustion, MTU black hole, IPSec mismatch, NTP drift, LACP flap, SNMP engine ID, asymmetric routing, DNS loop, QoS mis-marking, OSPF EXSTART, TCAM exhaustion, multicast RP failure, ZTP POAP failure.
   - `searchIncidentDB(query, topN)` reuses cosine similarity engine; returns similarity %, impact, MTTR, lastSeen, reasoning chain, resolution steps.
   - `renderIncidentSearch()` renders expandable result cards with similarity bars.
   - `#inc-search-results` panel added before NetBox Sync in troubleshooting engine section.

3. **Confidence scoring** — `889bb3c`
   - Enhanced `classifySymptom()` in `ts_engine.js` to return `reasoning[]` (top-5 token contributions with weights) and `evidence[]` (category + verify command references).
   - Updated `renderSymptomClassifier()`: confidence progress bar, collapsible Reasoning chain panel, collapsible Evidence & references panel per result card.

**Issues closed:** none (Tier 3 items had no GitHub issue numbers)

### 2026-05-21 (run 11)

**Features completed this run:**

1. **NetBox API + Nautobot (#Tier4-1, #Tier4-2)** — `a9a5ea5`
   - Created `src/js/netbox.js` (330 lines) with full public API:
   - `fetchNetboxInventory(url, token)` — browser fetch to NetBox/Nautobot REST v3/v4;
     paginated (200/page) for sites, devices, prefixes, tenants; parallel page fetching.
   - `applyNetboxToState(inventory)` — maps data → STATE.orgName, numSites, orgSize,
     preferredVendors; fills `#org-name`, `#org-size`, `#num-sites` inputs; toggles vendor chips.
   - `renderNetboxImportPanel()` — "Import from NetBox / Nautobot" form-card in Step 1
     with URL + token inputs, Connect & Preview button, preview table, Apply / Clear buttons.
   - Vendor slug normalization covers 12 manufacturer mappings (Cisco, Arista, Juniper,
     Fortinet, HPE Aruba, Dell EMC, NVIDIA, Extreme Networks).
   - Org-size heuristic: device count → small / medium / large / enterprise thresholds.
   - Use-case heuristic: device role votes → campus / dc / gpu / wan (advisory, not auto-set).
   - CORS advisory note shown automatically on fetch failure.
   - Credentials persisted in localStorage (`netdesign_netbox_creds`).
   - Nautobot uses the same /api/dcim/ and /api/ipam/ paths as NetBox — same code covers both.
   - `#netbox-import-panel` div added before org-details form in Step 1 of index.html.
   - Script tag added after naming.js; `renderNetboxImportPanel()` called in app.js init block.
   - 15 `.nb-*` CSS rules added to main.css (card border, badge, inputs, preview table, actions).

**Issues closed:** none (Tier 4 items have no GitHub issue numbers in this repo)

2. **DNAC / Catalyst Center (#T4-3)** — `35adabf`
   - Created `src/js/dnac.js` with `genDNACPushScript()`, `downloadDNACScript()`, `renderDNACPanel()`.
   - Python script: OAuth via `/dna/system/api/v1/auth/token`, device lookup, Template Programmer
     create/commit/deploy/poll workflow; DNAC 2.2+ / Catalyst Center 2.3+.
   - `#dnac-panel` div in Step 6; rendered in `jumpStep(6)`.

3. **Ansible Tower / AWX (#T4-4)** — `d6503d4`
   - Created `src/js/awx.js` with `genAWXScript()`, `downloadAWXScript()`, `renderAWXPanel()`.
   - Python script: Bearer token auth, get-or-create inventory + platform groups + hosts +
     SSH credential + job template; job launch + 5s poll; AWX 21+ / Tower 3.8+.
   - `#awx-panel` div in Step 6; rendered in `jumpStep(6)`.

4. **ServiceNow CMDB (#T4-5)** — `714a046`
   - Created `src/js/servicenow.js` with `genServiceNowScript()`, `downloadServiceNowScript()`, `renderServiceNowPanel()`.
   - Python script: Table API upsert to cmdb_ci_netgear / cmdb_ci_ip_router CIs,
     cmdb_rel_ci topology relationships (access→dist→core, leaf→spine, etc.); dry-run mode.
   - `#snow-panel` div in Step 6; rendered in `jumpStep(6)`.

5. **PeeringDB (#T4-6)** — `714a046`
   - Created `src/js/peeringdb.js` with `fetchPeeringData(asn)`, `renderPeeringPanel()`,
     `peeringSearch()`, `downloadPeeringReport()`.
   - Browser fetch to PeeringDB public CORS API; paginated netixlan lookup; parallel peer
     fetches for first 5 IXPs; IXP table + CSV export.
   - `#peeringdb-panel` div in Step 2 (visible for WAN/multicloud/multisite UCs);
     rendered in `jumpStep(2)`.

6. **Cisco EoL / EoS API (#T4-7)** — `dd37f82`
   - Created `src/js/eol.js` with static `_EOL_DB` (10 Cisco products from catalog),
     `checkEoL()`, `renderEoLPanel()`, `genCiscoEoLScript()`, `downloadCiscoEoLScript()`.
   - `renderEoLPanel()` called from `updateBOMTable()` — live feedback as user selects products.
   - Nexus 93180YC-FX flagged as End-of-Sale (static data).
   - Python script: Cisco Support EoX v4 API with OAuth 2.0 for live data.
   - `#eol-panel` div in BOM section above cabling matrix.

**All 7 Tier 4 integration items complete. All tiers (1-4) now fully implemented.**

**Files added this run**: src/js/netbox.js, src/js/dnac.js, src/js/awx.js, src/js/servicenow.js, src/js/peeringdb.js, src/js/eol.js
**Files modified**: index.html, src/css/main.css, src/js/app.js, src/js/recommendations.js

### 2026-05-21 (run 12)

**Features completed this run:**

1. **HSRP v2 / VRRP — First Hop Redundancy Protocol (FHRP)** — `3f3a6db`
   - Added `_genFHRP(vendor, layer, idx)` helper to `configgen.js` covering IOS-XE, EOS, NX-OS.
   - **IOS-XE campus-dist**: HSRPv2 on Vlan10/20/30/40; Dist-01 (idx=0) is ACTIVE with priority 110, preempt, and `track 1 TenGig1/1 decrement 20` (failover on uplink loss). Dist-02 (idx=1) is STANDBY with priority 100. Both use MD5 key `HSRP_NetD@2024`, sub-second timers (250 ms hello / 750 ms hold).
   - **EOS campus-dist**: VRRPv3 equivalent on same VLAN groups, same priority model.
   - **NX-OS campus-dist**: HSRPv2 per-SVI in NX-OS nested-command style.
   - Called automatically from `genIOSXE()` `isDist` block; returns '' for all other layers.
   - `'FHRP'` added to `SECTION_MARKERS` for section-nav jump bar.
   - **Why**: Without FHRP, dual-distribution campus designs have duplicate gateway IPs and no election — a critical correctness gap.

2. **IGMP snooping — campus / DC fabric multicast** — `8e0f921`
   - Added `_genIGMP(vendor, layer)` helper to `configgen.js` covering IOS-XE, NX-OS, EOS, JunOS, SONiC.
   - Conditional on `STATE.appTypes` including 'voice' or 'video', or VXLAN enabled.
   - **IOS-XE campus-dist/core**: querier role (owns L3 SVIs); access gets immediate-leave; report-suppression global.
   - **NX-OS dc-leaf**: per-tenant-VLAN snooping + querier + immediate-leave.
   - **EOS dc-leaf**: vlan-config-block IGMP snooping + querier.
   - **JunOS**: `protocols { igmp-snooping { vlan all; immediate-leave; proxy; } }`.
   - Wired into common footer of all 4 vendor generators.
   - `'IGMP'` added to `SECTION_MARKERS` for section-nav jump bar.
   - **Why**: Without IGMP snooping, all multicast (IP phones, video conferencing, wireless AP discovery) is flooded as unknown unicast — a production correctness gap for voice/video campuses.

**Issues closed:** None (no GitHub issue numbers; these were Tier 5 infrastructure gaps found during audit)

### 2026-05-21 (run 13)

**Features completed this run:**

1. **WAN router config — DMVPN hub/spoke (IOS-XE) + GRE/IPSec (JunOS)** — `45a62c2`
   - **Root cause**: WAN use case assigned `layer:'campus-access'` to Branch CPE and `layer:'campus-core'` to HQ Core Router. Both generated campus switch configs (VLANs, PoE, DHCP snooping) — completely wrong for WAN routers.
   - Added `_genWANRouterIOSXE(dev, isHub, idx)` (~250 lines):
     - **HQ Hub**: dual-ISP GigabitEthernet WAN interfaces (DHCP from ISP), LAN downlink, `Tunnel0` as DMVPN Phase 3 mGRE hub (IKEv2 keyring/proposal/profile, IPSec transform-set + ipsec-profile, NHRP multicast-dynamic + redirect), OSPFv2 area 0 with `default-information originate always`, eBGP toward ISP with `prefix-list DENY-RFC1918-OUT`, IP SLA 1/2 with `track`-based dual-ISP failover static routes, NAT overload.
     - **Branch CPE**: ISP DHCP WAN, LAN (users + voice subnets), `Tunnel0` as mGRE spoke (NHRP map/nhs/shortcut, priority 0 non-DR), OSPFv2, NAT overload, `WAN-IN` ACL + CBAC `ip inspect` for stateful WAN protection.
   - Added `_genWANRouterJunOS(dev, isHub, idx)` (~200 lines):
     - **HQ Hub**: `ge-0/0/0/1` ISP interfaces (DHCP), `ge-0/0/2` LAN, `gr-0/0/0` GRE tunnel sourced from Loopback0, OSPFv2, eBGP with `DENY-RFC1918-OUT` policy-statement, SRX `source-nat interface` + `security policies` trust↔untrust.
     - **Branch CPE**: DHCP WAN, LAN, GRE spoke to hub, OSPF, NAT, deny-inbound security policy.
   - `genIOSXE` / `genJunos`: check `dev.role` at entry and delegate — zero impact on campus/DC/GPU configs.
   - `genNXOS` / `genEOS` / `genSONiC`: return advisory note redirecting users to IOS-XE/JunOS for WAN (DC OSes lack DMVPN/NHRP support).
   - Added `'WAN'`, `'DMVPN'`, `'NAT'` to `SECTION_MARKERS` for section-nav jump bar.
   - **Why**: WAN is one of the 6 core use cases; generating L2 switch configs for routers was a complete functional gap.

**Issues closed:** None (no GitHub issue number for this gap; self-identified audit)

2. **IPv6 dual-stack config for all 5 vendors** — `a0365c1`
   - **Root cause**: `STATE.protoFeatures` can include `'IPv6 Dual-Stack'` (Step 2 proto-card toggle, also set by DC/GPU demo presets), but no config generator used it. IPv6 configs were completely missing from all vendor outputs.
   - Added `_genIPv6Underlay(vendor, layer, idx)` helper (~180 lines) covering all 5 vendors:
     - **IOS-XE campus**: `ipv6 unicast-routing` + `ipv6 cef`, ULA loopbacks (`FD00:0:0:N::1/128`), `/127` P2P on distribution TenGig uplinks, SLAAC RA on Vlan20 (data) + suppress-ra on Vlan30 (voice), `ipv6 router ospf 1` with passive-interface default, no-passive on uplinks, OSPFv3 area 0 IPSec auth.
     - **NX-OS DC/GPU**: `feature ipv6`, ULA loopback, P2P on Ethernet1/49, `ipv6 router ospf UNDERLAY-V6` (named OSPF instance, same style as IPv4 UNDERLAY), BGP IPv6 address-family with `maximum-paths 4`.
     - **EOS DC/GPU**: IPv6 on Loopback0 + Ethernet49/1, `router ospf 1 address-family ipv6`, `router bgp N address-family ipv6` with `neighbor SPINES/LEAVES activate`.
     - **JunOS DC/GPU**: `family inet6` on lo0 + et-0/0/48-49, `ospf3` area 0, BGP `group SPINES-V6` with `family inet6 unicast`.
     - **SONiC DC/GPU**: `LOOPBACK_INTERFACE` + `INTERFACE` IPv6 entries in `config_db.json`, FRRouting `ipv6 router ospf6` stanza as comments (apply via vtysh).
   - Guard: `(STATE.protoFeatures || []).includes('IPv6 Dual-Stack')` — zero impact unless IPv6 is toggled on in Step 2.
   - Added `'IPv6'` to `SECTION_MARKERS` for section-nav jump bar.
   - **Why**: IPv6 dual-stack is standard practice in modern DC/campus; the proto-card UI already offered it but silently had no effect on generated configs.

### 2026-05-22 (run 14)

**Features completed this run:**

1. **Day-2 Operations Toolkit** — `10e5fc5`
   - Created `src/js/day2ops.js` (860 lines) with three public generator functions and a rendered download panel.
   - **`genConfigBackupScript(state)` → `backup_configs.py`**:
     - SSH to all BOM devices, fetch running config (per-vendor: IOS-XE/NX-OS/EOS: `show running-config`; JunOS: `show configuration | display set | no-more`; SONiC: `show runningconfiguration all` via vtysh).
     - Archives to `backups/YYYYMMDD/<hostname>_<HHMMSS>.cfg`.
     - Git auto-commit after successful run (`git add backups/<date>/ && git commit -m "chore: config backup ..."`).
     - Rotation: deletes per-day directories older than `--retention` days (default 30).
     - `--dry-run` flag skips SSH; `--no-git` skips auto-commit; rich table summary + JSON report.
   - **`genRollingUpgradeScript(state)` → `rolling_upgrade.py`**:
     - Per-vendor upgrade dispatch: IOS-XE `install add file <tftp> activate commit` (install mode); NX-OS `copy tftp: bootflash: + install all nxos`; EOS `copy tftp: flash: + boot system + reload`; JunOS `request system software add + request system reboot`; SONiC `sonic-installer install + sudo reboot`.
     - Rolling loop: one device at a time — trigger upgrade → wait for reload (configurable 180 s + 20 reconnect tries × 30 s) → BGP health gate (`BGP_MIN_PEERS`, default 1) → next device.
     - Aborts rollout on first health-gate failure and logs rollback instructions.
     - `--dry-run` simulates without SSH; `--skip-health` bypasses BGP gate; JSON upgrade log.
   - **`genMaintenanceModeScript(state)` → `maintenance_mode.py`**:
     - `--enter`: IOS-XE `router ospf 1 / max-metric router-lsa` + `bgp graceful-shutdown all neighbors 300`; NX-OS same pattern with `UNDERLAY` ospf process; EOS `max-metric router-lsa + bgp graceful-shutdown`; JunOS routing policy `MAINTENANCE-DRAIN` with metric 65535 applied to OSPF + BGP export; SONiC `vtysh router ospf max-metric router-lsa + router bgp graceful-shutdown`.
     - Waits `DRAIN_WAIT` (default 60 s) then prints live BGP peer count table to verify drain.
     - `--exit`: reverses all maintenance config (`no max-metric`, `no graceful-shutdown`, JunOS `delete` policy).
     - `--status`: show-only mode, prints reachability + BGP peer count table.
     - `--device <hostname>` targets a single device; persists `maintenance_state.json` for audit trail.
   - All three scripts: env-var credentials, rich console tables, JSON output/log files.
   - `renderDay2OpsPanel()` injects 3-card responsive grid into `#day2ops-panel` in Step 6.
   - `#day2ops-panel` div added to `index.html` after `#snow-panel`; `<script src="src/js/day2ops.js">` added after `checks.js`; `renderDay2OpsPanel()` called in `jumpStep(6)` in `app.js`.
   - CSS: `.d2ops-*` 16 rules — 3-col responsive grid, card layout, usage code block.
   - All 3 generated Python scripts validated with `python3 -m py_compile`.

**Issues closed:** N/A (new Tier-5 feature, no pre-existing issue)

### 2026-05-22 (run 15)

**Features completed this run:**

1. **Streaming Telemetry / gNMI** — `366ac17`
   - Added `_genGNMI(vendor)` helper to `configgen.js`; appended to ALL 5 vendor footers and both WAN router generators.
   - **IOS-XE**: `netconf-yang` + `restconf` + `gnmi-yang` (port 9339, secure-server); 4 YANG-Push subscriptions (interface/state, interface/counters, BGP neighbor state, CPU utilization) → collector at 10.0.0.210:57500.
   - **NX-OS**: replaced the previous NX-API-only inline `telemetry {}` block with an upgraded block using `data-source YANG` + OpenConfig paths (openconfig-interfaces, openconfig-network-instance, openconfig-platform) in sensor-group 1; NX-API paths retained in sensor-group 2. Port 50051. `feature grpc` note included.
   - **EOS**: `management gnmi` transport grpc port 6030 vrf MGMT + `management api gnmi` no shutdown.
   - **JunOS**: `system { services { extension-service { request-response { grpc { clear-text { port 32767; } max-connections 30; routing-instance mgmt_junos; } } } } }` merge stanza + `netconf { rfc-compliant; }`.
   - **SONiC**: `GNMI` key in config_db.json + `systemctl enable/start sonic-gnmi` instructions.
   - `'gNMI'` added to `SECTION_MARKERS` so section-nav jump bar gains a gNMI button.
   - Created `src/js/telemetry.js` (400 lines) with 5 public functions:
     - `genGNMICCollectorConfig(state)` → `gnmic.yml` (gnmic YAML): per-device targets with layer-aware mgmt IPs + gNMI ports per vendor, 5 OpenConfig subscription paths (interface state/counters, BGP neighbors, CPU, memory, OSPF), Prometheus output on :9804, hot-reload file loader.
     - `genTelegrafGNMIConfig(state)` → `telegraf-gnmi.conf` (TOML): per-OS [[inputs.gnmi]] blocks (separate block per NOS), prometheus_client output, 5 subscription paths per OS group.
     - `downloadGNMICConfig()` / `downloadTelegrafGNMIConfig()` — browser download triggers.
     - `renderTelemetryPanel()` — 2-card download panel with device count, gNMI port info, and quick-start instructions.
   - `#telemetry-panel` div added after `#day2ops-panel` in Step 6 of `index.html`.
   - `<script src="src/js/telemetry.js">` added after `day2ops.js`.
   - `renderTelemetryPanel()` called in `jumpStep(6)` in `app.js`.
   - 12 `.telemetry-*` CSS rules added to `main.css` (matches `.checks-*` panel style).

**Files changed**: `src/js/configgen.js`, `src/js/telemetry.js` (new), `src/js/app.js`, `index.html`, `src/css/main.css`

**Issues closed:** None (no GitHub issue; self-identified gap — device-side gNMI was completely missing from all vendor configs)

### 2026-05-22 (run 16)

**Features completed this run:**

1. **IS-IS underlay for EOS, JunOS, and SONiC** — `3d1fa34`
   - Added `_isisNet(ip)` helper: converts dotted-decimal IP to IS-IS NET address (format `49.0001.XXYY.ZZZZ.WWWW.00`).
   - Added `_genISISUnderlay(vendor, layer, idx)` helper after `_genOSPFUnderlay`:
     - **EOS**: `router isis UNDERLAY`, `level-2-only`, TI-LFA enabled, `fast-reroute ti-lfa mode link-protection`, `maximum-paths 4`; per-uplink `isis enable UNDERLAY` + `isis network point-to-point` + `isis circuit-type level-2`; Loopback0 passive. Uplinks: Ethernet49/1+50/1 (leaf) or Ethernet1/1–4 (spine).
     - **JunOS**: `interfaces { lo0 { unit 0 { family iso { address <net>; } } } }` merge stanza + `protocols { isis { level 1 disable; per-interface p2p with MD5 auth; lo0.0 passive; fxp0.0 disable; } }`.
     - **SONiC**: FRRouting `/etc/frr/frr.conf` stanza: `router isis UNDERLAY`, `metric-style wide`, Ethernet112/116 activated, `isis passive` on Loopback0.
   - Added `const hasISIS = _rs('isisEnabled', ...)` in `genEOS`, `genJunos`, and `genSONiC`; zero-impact if IS-IS not selected.
   - `'IS-IS'` added to `SECTION_MARKERS` for section-nav jump bar.
   - **Why**: IS-IS is one of the most common DC fabric underlay protocols (often preferred over OSPF at scale); NX-OS already had IS-IS inline but EOS/JunOS/SONiC were missing it entirely.

2. **MLAG peer-link for Arista EOS DC leaf** — `3d1fa34`
   - Added `_genMLAG(layer, idx)` helper (EOS `dc-leaf` only):
     - `vlan 4094` with `trunk group MLAG-PEER-LINK`.
     - `Ethernet51/1` + `Ethernet52/1` as `channel-group 1000 mode active` (peer-link members).
     - `Port-Channel1000` as the MLAG peer-link trunk.
     - `interface Vlan4094` with `ip address 10.254.<pairIdx>.<1-or-2>/30`, `no autostate` (MLAG peering SVI).
     - `mlag configuration` block: `domain-id DC-MLAG-PAIR-<N>`, `local-interface Vlan4094`, `peer-address <peer-IP>`, `reload-delay mlag 300`, `reload-delay non-mlag 330`.
     - Example dual-homed server ports with `channel-group N mode active` + `mlag N`.
   - MLAG pair assignment: Leaf-0/1 = pair 1 (10.254.0.1/2), Leaf-2/3 = pair 2 (10.254.1.1/2).
   - Always generated for `dc-leaf` — matches how NX-OS always generates vPC for every leaf.
   - `'MLAG'` added to `SECTION_MARKERS`.
   - **Why**: Arista MLAG is mandatory for dual-homed server connectivity in any production EOS DC fabric; the config was completely missing it.

3. **NX-OS DC leaf server ports: vPC port-channels** — `56c14ed`
   - Fixed `isLeaf` block in `genNXOS`: server-facing ports now use LACP + vPC bindings:
     - `Ethernet1/1` → `channel-group 1 mode active` (SERVER-01-Bond0-eth0)
     - `Ethernet1/2` → `channel-group 2 mode active` (SERVER-02-Bond0-eth0)
     - `port-channel1` + `vpc 1` (SERVER-01-Bond0), `port-channel2` + `vpc 2` (SERVER-02-Bond0).
   - Matches real production NX-OS vPC deployments where servers use bonded NICs.
   - Consistent with EOS MLAG server port style added above.

**Files changed**: `src/js/configgen.js` only

**Issues closed:** None (self-identified production correctness gaps)

### 2026-05-22 (run 17)

**Features completed this run:**

1. **SONiC DC fabric config (dc-leaf / dc-spine)** — `3c5b52f`
   - Added `_genSONiCDCFabric(dev, layer, idx, hasVxlan)` helper (~170 lines) before `genSONiC`.
   - `genSONiC()` now branches: `dc-leaf` and `dc-spine` layers use the new DC helper; `gpu-tor`/`gpu-spine` keep the existing RoCEv2/PFC-focused config unchanged.
   - **DC leaf config_db.json**: `"type": "LeafRouter"`, Dell S5248F platform, Loopback0 (router-id) + Loopback1 (VTEP source when VXLAN selected), Ethernet48/50 uplinks to spines, `VXLAN_TUNNEL` + `VXLAN_TUNNEL_MAP` + `VRF` (L3VNI) when VXLAN/EVPN overlay selected.
   - **DC leaf FRRouting frr.conf**: `SPINES` peer-group (eBGP to AS 65000), BFD, `address-family ipv4 unicast` with Loopback0 + Loopback1 networks, `address-family l2vpn evpn` with `advertise-all-vni` + `advertise-svi-ip` when VXLAN selected.
   - **DC spine config_db.json**: `"type": "SpineRouter"`, NVIDIA SN4800C platform, 8 leaf downlinks (Ethernet0/4/8… with consistent /31 addressing).
   - **DC spine FRRouting frr.conf**: `LEAVES` peer-group (`remote-as external` eBGP), BFD, `address-family l2vpn evpn` with `route-server-client` when VXLAN selected.
   - **IP addressing consistency**: SPINE-01 (idx=0) uses 10.1.0.0/2/4…; SPINE-02 (idx=1) uses 10.1.0.8/10/12…; exactly matches leaf uplink addresses (`idx*2+1` for SPINE-01, `idx*2+9` for SPINE-02).

2. **JunOS complete EVPN/VXLAN** — `3c5b52f`
   - Added `hasVxlan` guard — VXLAN vlans and EVPN config are now conditional on overlay protocol selection (were unconditionally generated before, even for non-VXLAN designs).
   - Added `switch-options { vtep-source-interface lo0.0; route-distinguisher; vrf-target; vrf-table-label; }` when VXLAN selected.
   - Added `VTEP-LOOPBACK` policy-statement for BGP loopback advertisement.
   - BGP group `SPINES`: now includes `family inet unicast` + `family evpn signaling` + `export [CONNECTED VTEP-LOOPBACK]` when VXLAN selected.
   - `protocols evpn`: added `ingress-node-replication` per vlan, `vni-options` with per-VNI import/export route-targets (target:100000:1, target:100001:1).
   - Added IRB interfaces (`irb.100`/`irb.101`) with per-leaf anycast gateway IPs for L3VNI.
   - Added `routing-instances TENANT-A`/`TENANT-B` (vrf type) with RD/RT and IRB bindings.

**Files changed**: `src/js/configgen.js` only

### 2026-05-23 (run 18)

**Features completed this run:**

1. **Multi-Site DCI / EVPN Multi-Site Border Gateway** — `d00937d`
   - All Tier 1-5 roadmap items were already complete; identified the multisite use case as having a critical functional gap: dc-spine devices got normal single-site fabric config with zero inter-site connectivity.
   - Added `_genDCI(vendor, dev, state)` helper (~220 lines) injected into all 4 vendor generators when `STATE.uc === 'multisite' && layer === 'dc-spine'`.
   - **IP plan**: Per-site ASNs (`DCA=65100, DCB=65200, DCC=65300, DCD=65400`) for eBGP between sites. DCI P2P /31 links in `10.201.0.0/24` (avoids conflict with JunOS IRB `10.200.x` addresses). BGW loopback `10.201.254.{siteIdx*2+spineIdx+1}/32`.
   - **NX-OS**: `evpn multisite border-gateway {N}`, `Loopback2` DCI-VTEP, `Ethernet3/1-N` DCI links with `evpn multisite dci-tracking`, eBGP neighbors with `rewrite-evpn-rt-asn` + `delay-restore time 300`. Includes note to update spine ASN from 65000 to site ASN.
   - **EOS**: `Loopback2` DCI-VTEP, `Ethernet51-N/1` DCI links, `DCI-PEERS` peer-group with `next-hop-unchanged`, activated in both `address-family ipv4` and `address-family evpn`. `maximum-routes 100000 warning-only` on DCI peers.
   - **JunOS**: `et-0/2/N` DCI interfaces, `lo0 unit 2` DCI-VTEP, `DCI-PEERS` BGP group (`type external`, `family evpn signaling`), `routing-options autonomous-system {siteASN}` override.
   - **SONiC**: Generates commented config_db.json additions (`INTERFACE`, `BGP_NEIGHBOR`) and frr.conf router bgp additions with per-site DCI neighbors and `l2vpn evpn` address-family, with apply instructions.
   - `_DCI_LINK` IIFE builds a lookup table of all 12 /31 DCI link subnets (6 site-pairs × 2 spines) at script load time.
   - `'DCI'` added to `SECTION_MARKERS` — jump bar gains DCI button for multisite spine configs.

**Files changed**: `src/js/configgen.js`
**Issues closed**: None (self-identified functional gap; no pre-existing issue number)

### 2026-05-23 (run 19)

**Features completed this run:**

1. **PIM Sparse-Mode multicast routing + BFD** — `6331576`
   - **Root cause for PIM**: IGMP snooping was already configured on all vendors, but without PIM-SM on routed interfaces (SVIs, uplinks), inter-subnet multicast traffic (IP phones, video conferencing) silently drops. This is a real production gap for any campus with voice/video or any DC with multicast.
   - Added `_genPIM(vendor, layer, idx)` helper covering all 5 vendors.
   - Guard: only activates when `STATE.appTypes` includes 'voice' or 'video'. Zero-impact for all other designs.
   - **IOS-XE** campus-dist/core: `ip multicast-routing`, `ip pim rp-address 10.255.0.20`, `ip pim sparse-mode` on all SVIs (Vlan20/21/30/40) and TenGig uplinks, Loopback0; core-01 (idx=0) auto-elected as RP via `ip pim send-rp-announce` + `send-rp-discovery`.
   - **NX-OS** dc-leaf/spine: `feature pim`, `ip pim rp-address` on loopback0 + Ethernet1/49-50 (leaf) or 1/1-4 (spine); spine-01 announces RP via `send-rp-announce`.
   - **EOS** dc-leaf/spine: `ip multicast-routing`, `router pim sparse-mode` with `ipv4 { rp-address N; }`, BSR + RP-candidate on dc-spine, `ip pim sparse-mode` on Loopback0 and Ethernet49/1 + 50/1 (leaf) or 1/1–4/1 (spine).
   - **JunOS** dc-leaf/spine: `protocols { pim { rp { static/local-address + bootstrap rp-candidate }; interface lo0.0/et-0/0/48-49 mode sparse } }` merge stanza.
   - **SONiC** dc-leaf/spine: `/etc/frr/frr.conf` PIM stanza with `pimd=yes` daemons note; spine gets `bsr-candidate` + `rp-candidate Loopback0`; leaf gets static RP address.
   - **Root cause for BFD**: EOS already had `bfd all-interfaces` in OSPF/ISIS blocks; SONiC already had `neighbor bfd` in FRRouting peer-groups. IOS-XE, NX-OS, and JunOS had no BFD, meaning their OSPF/BGP convergence after link failure relied entirely on hold-down timers (default 40 s for OSPF).
   - Added `_genBFD(vendor, layer)` helper for IOS-XE, NX-OS, JunOS. EOS and SONiC return '' (already have BFD inline).
   - **IOS-XE**: `bfd slow-timers 5000`, `bfd interval 300 min_rx 300 multiplier 3` on all L3 uplinks, `router ospf 1 bfd all-interfaces`.
   - **NX-OS**: `feature bfd`, `bfd interval 300 min_rx 300 multiplier 3` on uplinks, `router ospf UNDERLAY bfd`.
   - **JunOS**: `bfd-liveness-detection { minimum-interval 300; multiplier 3; }` merge stanza on OSPF area 0 uplinks + IS-IS level 2.
   - Both helpers skipped for campus-access (no L3 uplinks), GPU/WAN layers.
   - `'PIM'` and `'BFD'` added to `SECTION_MARKERS` — section-nav jump bar gains two new buttons.
   - 26/26 unit tests pass.

**Files changed**: `src/js/configgen.js`
**Issues closed**: None (self-identified production gaps; no pre-existing issue numbers)

### 2026-05-23 (run 20)

**Features completed this run:**

1. **BGP Unnumbered (RFC 5549) + MACSec link encryption** — `6447af4`
   - **Root cause**: All DC fabric configs used numbered /31 subnets for eBGP peering. Modern DC fabrics (SONiC, NVIDIA Cumulus, cloud-scale) eliminate fabric link IP addressing entirely via BGP unnumbered (RFC 5549), using IPv6 link-local addresses for eBGP peer discovery. This simplifies fabric design and eliminates IP allocation overhead. MACSec was similarly absent — inter-switch links carried plaintext traffic even in high-security environments.
   - Added `'BGP Unnumbered (RFC 5549)'` and `'MACSec Link Encryption'` proto-feature cards in Step 2 UI.
   - Added `_genBGPUnnumbered(vendor, layer, idx, hasVxlan)` covering all 5 vendors:
     - **EOS**: `ipv6 enable` on Ethernet49/1 + 50/1 (no IP address); `neighbor SPINES remote-as external` + `neighbor interface Ethernet49/1 peer group SPINES` — full eBGP unnumbered with EVPN support preserved.
     - **JunOS**: `et-0/0/48.0 { family inet6; }` (no /31); `dynamic-neighbor DC-SPINES-DYN { peer-auto-discovery { family inet6; } }` for auto-peering.
     - **SONiC/FRR**: `config_db.json` uses `ipv6_use_link_local_only` on fabric interfaces (no BGP_NEIGHBOR entries); `frr.conf` uses `neighbor Ethernet48 interface remote-as external` with BFD.
     - **NX-OS**: Detailed advisory note with NX-OS 10.2+ equivalent syntax (NX-OS has limited unnumbered BGP support).
   - Added `_genMACSec(vendor, layer, idx)` covering all 5 vendors:
     - **EOS**: `mac security profile MKA-FABRIC-PSK` (AES-256-GCM, PSK CAK/CKN) + `macsec profile` applied per uplink.
     - **NX-OS**: `feature macsec` + `key chain FABRIC-KS macsec` + `macsec policy FABRIC-MACSEC` (GCM-AES-XPN-256) + per-interface binding.
     - **JunOS**: `security { macsec { connectivity-association FABRIC-CA { cipher-suite GCM-AES-XPN-256; security-mode static-cak; } } }` — per-uplink interface binding.
     - **SONiC**: Advisory note pointing to wpa_supplicant MKA daemon approach (SONiC 202211+).
   - `genEOS`: conditional on `hasBGPUnnumbered` — numbered /31 + BGP group OR unnumbered interfaces + interface-based peers.
   - `genJunos`: same conditional on `hasBGPUnnumberedJ` — `family inet` vs `family inet6` on uplinks + numbered vs dynamic-neighbor BGP.
   - `_genSONiCDCFabric`: early-return path for unnumbered mode with link-local-only config_db.json and FRR config delegated to helper.
   - `genNXOS`: appends BGP unnumbered advisory + MACSec config when flags set.
   - `SECTION_MARKERS` extended with `'MACSEC'` and `'UNNUMBERED'` for section-nav jump bar.
   - All JS files pass `node --check` syntax validation.

**Files changed**: `src/js/configgen.js`, `index.html`
**Issues closed**: None (new feature — no pre-existing issue number)

### 2026-05-23 (run 21)

**Features completed this run:**

1. **Route Reflectors, Policy Routing (PBR), FlowSpec/BGP-FS proto-cards** — `d78cf20`
   - **Root cause**: Three proto-feature cards in Step 2 ("Route Reflectors", "Policy Routing (PBR)", "FlowSpec / BGP-FS") were complete UI no-ops — selecting them produced zero change in any generated vendor config. This was a silent correctness gap for users who toggled these features expecting actual config output.
   - Added `_genRouteReflector(vendor, layer, idx)`:
     - **IOS-XE campus-core**: `bgp cluster-id ${loIP}` + `neighbor 10.100.0.1/3 route-reflector-client` in `address-family ipv4` — turns the campus core into an iBGP RR server for both DIST peers.
     - **NX-OS dc-spine**: Appends `cluster-id ${loIP}` advisory block noting RR is already active (spine BGP was already hardcoded with `route-reflector-client` for all leaves).
     - **EOS dc-spine**: Same advisory + `bgp cluster-id` for dual-RR loop prevention.
     - **JunOS dc-spine**: Full `cluster ${loIP}` + `group LEAVES-RR { type internal; cluster; family inet unicast; family evpn signaling; neighbor ... }` BGP merge stanza + `rib-groups RR-RIB`.
     - **SONiC dc-spine**: Commented FRRouting stub with `bgp cluster-id`, `LEAVES` peer-group, `route-reflector-client`, and l2vpn evpn AF activation.
   - Added `_genPBR(vendor, layer, idx)`:
     - Policy-Based Routing for voice (10.20.0.0/15) and video (10.30.0.0/15) traffic steering to preferred WAN/FW uplink.
     - **IOS-XE campus-dist/core**: `ip access-list extended PBR-VOICE/VIDEO-ACL` + `route-map PBR-PRIORITY` with `set ip next-hop verify-availability ... track 10` + applied on Vlan20/30/40 SVIs + `ip sla 10` reachability tracking.
     - **NX-OS dc-leaf/spine**: NX-OS `ip access-list` + `route-map PBR-PRIORITY` + `ip policy route-map` on Ethernet1/1.
     - **EOS dc-leaf/campus-dist**: `ip access-list` + `route-map PBR-PRIORITY permit 10/20/30` + `ip policy route-map` on Ethernet1.
     - **JunOS dc-leaf/spine**: Filter-Based Forwarding — `routing-instances PBR-PRIORITY { instance-type forwarding; static default }` + `firewall family inet filter PBR-CLASSIFY { term VOICE/VIDEO/DEFAULT }` applied as input filter on et-0/0/48.
     - **SONiC dc-leaf/spine**: FRR prefix-list + route-map + `ip rule` + `ip route table 200` iproute2 instructions.
   - Added `_genFlowSpec(vendor, layer, idx)`:
     - BGP FlowSpec (RFC 5575 / RFC 8955) for DDoS mitigation and traffic redirect via a FlowSpec controller (ExaBGP/GoBGP/BIRD2) at 10.0.0.210.
     - **IOS-XE campus-core/dc-spine**: `bgp flowspec redirect ip` + `address-family ipv4 flowspec` with neighbor activation + `ip flowspec enable` on WAN uplink.
     - **NX-OS dc-spine**: `address-family ipv4 flowspec` + `flowspec external interface Ethernet1/1-2 address-family ipv4`.
     - **EOS dc-spine/campus-dist**: `neighbor FLOWSPEC-CTL peer group` + `address-family flow-spec ipv4` neighbor activation.
     - **JunOS dc-spine/campus-dist**: `routing-options { flow { interface-specific; route-distinguisher; term-order standard; } }` + `protocols bgp group FLOWSPEC-CTL { family inet { flow; } }` + `policy-statement FLOWSPEC-ACCEPT`.
     - **SONiC dc-spine/leaf**: FRR `address-family ipv4 flowspec` stub + `sysctl rp_filter` instructions.
   - All three helpers guarded by `STATE.protoFeatures.includes(...)` — zero output when not selected.
   - `SECTION_MARKERS` extended with `'RR'`, `'PBR'`, `'FLOWSPEC'` — section-nav jump bar gains three new buttons.
   - All JS files pass `node --check`; no ES module imports.

**Files changed**: `src/js/configgen.js`
**Issues closed**: None (no GitHub issue numbers; self-identified proto-card no-op gaps)

2. **MPLS/SR (Segment Routing) overlay chip** — `c2b657b`
   - **Root cause**: "MPLS / SR" overlay chip in Step 2 was a complete UI no-op — zero config was generated regardless of selection.
   - Added `_genMPLSSR(vendor, layer, idx)` covering all 5 vendors and both SONiC paths (dc and GPU).
   - **IOS-XE campus-core/dist**: `segment-routing mpls` global block + SRGB prefix-SID `absolute ${16000+idx}` on Loopback0 + `router ospf 1 segment-routing mpls + fast-reroute per-prefix ti-lfa` or `router isis CAMPUS-FABRIC address-family ipv4 unicast segment-routing mpls + TI-LFA`.
   - **NX-OS dc-leaf/spine**: `feature segment-routing-mpls` + `isis prefix-sid absolute ${16000+idx}` on loopback0 + `router isis UNDERLAY address-family ipv4 unicast segment-routing mpls + fast-reroute ti-lfa level-2`.
   - **EOS dc-leaf/spine**: `mpls ip` + `interface Loopback0 node-segment ipv4 index ${idx}` + `router isis UNDERLAY segment-routing mpls + fast-reroute ti-lfa mode link-protection`.
   - **JunOS dc-leaf/spine**: `interfaces family mpls` on uplinks + lo0 + `protocols mpls` + `isis source-packet-routing { srgb start-label 16000 index-range 8000; node-segment ipv4-index ${idx}; }` — appended as merge stanzas.
   - **SONiC dc/GPU**: FRR `segment-routing global-block 16000 23999` + `node ${idx} prefix ${loIP}/32 index ${idx}` stub + `sysctl net.mpls.conf.*input=1 + platform_labels=100000` kernel instructions.
   - Guard: returns advisory note when OSPF/IS-IS not selected (SR-MPLS requires IGP underlay). Skipped for campus-access, gpu-tor, gpu-spine.
   - `SECTION_MARKERS` extended with `'SR-MPLS'` and `'SEGMENT'`.

**Files changed**: `src/js/configgen.js`
**Issues closed**: None (no GitHub issue number; self-identified overlay chip no-op gap)

### 2026-05-24 (run 22)

**Features completed this run:**

1. **IP Address & VLAN Allocation Plan** — `41cd0c3`
   - Created `src/js/ipplan.js` (519 lines) with four `window.*` public functions.
   - `genIPAddressPlan(state)` — per-UC structured plan rows matching the exact IPs used in
     `configgen.js`: User VLANs + subnets (VLAN 10/20/21/30/40/41), HSRP VIPs, loopbacks
     (campus 10.255.0.20+, DC spines 10.255.1.x, DC leaves 10.255.2.x, GPU TOR 10.255.5–6.x),
     P2P fabric /31 links (10.1.0.0/24 block), BGP ASNs (65000 spine, 65001+ leaves), VXLAN
     overlay (VNIs 100000/100001/999000/999001, anycast GW 10.200.0.1/22 + 10.200.4.1/22),
     MLAG peer-link SVIs (10.254.x.x/30), DMVPN tunnel subnet (172.16.0.0/24), branch LAN
     (192.168.100+.0/24), multi-site DCI P2P links (10.201.0.0/24), shared services block
     (NTP 10.0.0.1/2, TACACS+ 10.0.0.101/102, SNMP 10.0.0.200, syslog 10.0.0.201, gNMI 10.0.0.210).
   - `renderIPPlanPanel()` — collapsible table in `#ipplan-section` with category badges
     colour-coded by type (VLANs=blue, loopbacks=purple, overlay=purple, routing=green, services=grey).
   - `downloadIPPlanCSV()` — browser CSV download (6 columns: category, resource, VLAN, subnet, purpose, notes).
   - `downloadIPPlanMarkdown()` — Markdown table download with org name and date header.
   - `index.html`: `#ipplan-section` div in BOM section after `#rack-plan-section`; script tag after `eol.js`.
   - `src/js/recommendations.js`: `renderIPPlanPanel()` called from `updateBOMTable()`.
   - `src/css/main.css`: 14 `.ipplan-*` rules (table, category badges, subnet code, footnote).

2. **Security hardening baseline for all 5 vendor configs** — `22cc022`
   - Audited all vendor config generators and added missing CIS/NIST network hardening commands.
   - **IOS-XE**: `no service finger/tcp-small-servers/udp-small-servers`, `no ip http server`,
     `ip http secure-server` + `ip http authentication aaa`, `no ip source-route`,
     `no ip finger`, `no ip bootp server`, `login block-for 60 attempts 5 within 30`,
     `login delay 2`, `banner motd` with device name, `ip access-list MGMT-ACL` (10.0.0.0/24 only).
   - **NX-OS**: `no feature telnet`, `no feature http-server`, `banner motd`.
   - **EOS**: `management api gnmi` (TLS), `no management api restconf`, `management security ssl profile`
     (TLS 1.2/1.3 only), `management ssh idle-timeout 10`, `banner motd`.
   - **JunOS** (both WAN and DC templates): `ssh max-sessions-per-connection 1`, `connection-limit 10`,
     `rate-limit 5`, `xnm-clear-text { no }`, login `announcement` + `retry-options` (lockout 5 min),
     `syslog file security { authorization any; interactive-commands any }`, `no-multicast-echo`,
     `no-ping-record-route`, `no-redirects`.
   - **SONiC** (GPU TOR): `/etc/ssh/sshd_config` hardening comments (`PermitRootLogin no`,
     `PasswordAuthentication no`, `MaxAuthTries 3`, `Banner /etc/issue.net`), `/etc/issue.net` content.

**Issues closed:** None (self-identified production correctness / security gaps)

### 2026-05-24 (run 23)

**Features completed this run:**

1. **Live Requirements Validator + Capacity Preview (Step 2)** — `4553bad`
   - **Root cause**: Step 2 provided no live feedback — users could select incompatible protocols (EIGRP + non-Cisco, FlowSpec without BGP, MPLS without IGP) or mismatched compliance/security choices without any warning until Step 5 generated incorrect or incomplete configs. Capacity/cost estimates were only visible in Step 3/4.
   - Created `src/js/validator.js` (257 lines) with two `window.*` public functions.
   - `validateRequirements(state)` — evaluates 16 rules across four categories (protocol compatibility, security/compliance, application/latency, use-case scale):
     - **Protocol**: EIGRP with non-Cisco vendors (error), VXLAN without BGP (warn), FlowSpec without BGP (error), MPLS without IGP underlay (warn), BGP Unnumbered outside DC (info).
     - **Security/Compliance**: PCI without MACSec/IPsec (warn), HIPAA without NAC (warn), FedRAMP/DoD/CMMC without MACSec (warn).
     - **Application**: Voice/video without BFD (warn), ultra-low-latency without RDMA (info), block storage without overlay (info), PIM-SM without multicast app (info).
     - **Scale**: GPU without RDMA spec (info), WAN without routing protocol (info), campus >15K endpoints (warn), DC <8 servers (info).
     - Returns `{ issues, errorCount, warnCount, infoCount }`.
   - `renderRequirementsPreview()` — renders `#req-validator` panel (after `#peeringdb-panel` in Step 2) showing:
     - **Header**: title + badge row with counts (colored red/orange/blue/green per level).
     - **Issue list**: each issue shows icon, bold message, and "Fix:" suggestion with appropriate border color.
     - **Capacity preview table**: calls `getLayersForUC()` + `estimateCounts(layerKey)` + `PRODUCTS[selectedProductId]` to build a per-layer table with device qty, product name, unit cost, and extended cost; footer row shows totals.
   - **Integration**: `updateSummary()` in `app.js` now calls `renderRequirementsPreview()` as its last step (guarded by `typeof` check — safe if validator.js hasn't loaded yet). All existing Step 2 `onchange` events already call `updateSummary()`, so validation fires automatically on every state change.
   - `index.html`: `<div id="req-validator">` added after peeringdb-panel; `<script src="src/js/validator.js">` added between scoring.js and recommendations.js.
   - `src/css/main.css`: 35 new `.rval-*` rules using design-system CSS variables.

2. **`'use strict'` added to 5 JS files** — `4553bad`
   - `analytics.js`, `init.js`, `paywall.js`, `policy_rules_editor.js`, `similar_designs.js` were missing the `'use strict'` directive required by the tech stack constraints.
   - Added to the first executable line of each file (after JSDoc block where present).

**Files changed**: `src/js/validator.js` (new), `index.html`, `src/css/main.css`, `src/js/app.js`, `src/js/analytics.js`, `src/js/init.js`, `src/js/paywall.js`, `src/js/policy_rules_editor.js`, `src/js/similar_designs.js`
**Issues closed:** None (self-identified UX gap + tech constraint violations)

### 2026-05-24 (run 24)

**Features completed this run:**

1. **NETCONF / eAPI Config Push** — `cbc748a`
   - Created `src/js/netconf.js` (520 lines) — fills the gap between "config generated" (Step 5) and "config deployed" without requiring Ansible or manual SSH.
   - `genNetconfPushScript(state)` embeds pre-generated BOM device configs as base64-encoded constants in a self-contained `netconf_push.py` Python script.
   - **JunOS**: `ncclient` NETCONF `load_configuration(format='text', action='merge')` + `commit()` — accepts the exact JunOS text/set CLI generated in Step 5 without transformation.
   - **IOS-XE**: `ncclient` NETCONF with `Cisco-IOS-XE-native` YANG model (hostname push) + `cisco-ia:sync-from` RPC (IOS-XE 16.12+) for full CLI synchronisation.
   - **NX-OS**: `ncclient` NETCONF with `Cisco-NX-OS-device` YANG model (hostname + advisory for full config push via NAPALM/Ansible).
   - **EOS**: Arista `eAPI` `runCmds` over HTTPS JSON-RPC — parses the EOS CLI config into a command list and applies via `enable` + `configure`.
   - **SONiC**: OpenConfig RESTCONF REST API hostname push + `sonic-cfggen` advisory for full `config_db.json` apply.
   - Script flags: `--dry-run` (connectivity only, no config changes), `--device HOSTNAME` (single device), `--no-commit` (skip commit / JunOS discard-changes), `--yes` (skip interactive confirmation).
   - Credentials from `NETCONF_USER` / `NETCONF_PASSWORD` env vars; no hardcoded secrets in script.
   - `rich` console table summary + JSON report file saved per run; graceful fallback when `rich` not installed.
   - `renderNetconfPanel()` renders a download card with API method table and quick-start code block in Step 6; auto-called in `jumpStep(6)` via `app.js`.

2. **Mermaid Topology Export** — `cbc748a`
   - Created `src/js/mermaid_export.js` (316 lines) — converts the BOM topology to Mermaid `graph TD` syntax for pasting into GitHub markdown, Confluence, Notion, or mermaid.live.
   - `genMermaidTopology(state)`: builds Mermaid with YAML front-matter title, `subgraph` per layer (icon + device count), device nodes with product model subtitle, and edge labels (speed + cable type).
   - Edge source: uses the live cabling matrix (`generateCablingMatrix()` → `details[]` → `deviceA`/`deviceB`) for exact device-pair connections; falls back to layer-pair mesh derivation when cabling data is not yet ready.
   - Per-layer `classDef` colour coding: core=blue, dist=orange, access=green, spine=purple, leaf=cyan, GPU TOR=gold, GPU spine=pink, fw=red.
   - `copyMermaidToClipboard()` — `navigator.clipboard` with `execCommand` fallback.
   - `downloadMermaidFile()` — downloads `<orgSlug>-topology.mmd`.
   - **New "📊 Mermaid Diagram" tab** added to Step 4 design tab bar; `renderMermaidPanel()` called on tab click (same lazy-render pattern as Reference Designs / Summary tabs).
   - 10 `.mmd-*` CSS rules added to `main.css`.

**Files added**: `src/js/netconf.js`, `src/js/mermaid_export.js`
**Files changed**: `index.html`, `src/css/main.css`, `src/js/app.js`
**Issues closed:** None (self-identified deployment gap + documentation gap; no pre-existing issue numbers)

### 2026-05-24 (run 25)

**Features completed this run:**

1. **Config Parameters Panel** — `e379720`
   - Created `src/js/params.js` (220 lines): `PARAMS` object with 17 configurable values
     (ntp1/2, tacacs1/2, snmpTrap, syslog, gnmiCollector, dnsServer, domainName,
     spineAsn, leafAsnBase, ntpKey, snmpUser, snmpAuthPw, snmpPrivPw, tacacsKey,
     hsrpKey, enableSecret). Persists to localStorage (`netdesign_params_v1`).
   - `_P(key)` returns string value (empty → fallback to default, backward-safe).
     `_PI(key)` returns integer, safe for BGP ASN arithmetic.
   - Collapsible panel (▼ Expand) rendered at top of Step 5 via `renderParamsPanel()`.
     Three sections: Infrastructure Servers, Network Config, Credentials.
     Password-type inputs for all secrets. Apply & Regenerate + Reset to Defaults.
   - Wired into configgen.js helper functions — all 5 vendor blocks updated:
     - `_genGNMI`:   gnmiCollector → `10.0.0.210`
     - `_genNTP`:    ntp1/ntp2/ntpKey/syslog — all 5 vendors
     - `_genSNMPv3`: snmpUser/snmpAuthPw/snmpPrivPw/snmpTrap/syslog — all 5 vendors
     - `_genAAA`:    tacacs1/tacacs2/tacacsKey — all 5 vendors
     - `genIOSXE` campus: domainName, dnsServer, enableSecret
     - `genNXOS`:    domainName, spineAsn, leafAsnBase
     - `genEOS`:     spineAsn, leafAsnBase; remote-as uses variables
     - `genJunos`:   domainName, autonomous-system, peer-as, vrf-target
     - `_genWANRouterIOSXE` / `_genWANRouterJunOS`: domainName, enableSecret
     - `_genBGPUnnumbered`: spineAsn / leafAsnBase
     - `_genRouteReflector`: spineAsn for NX-OS and EOS spine `router bgp N`
   - `index.html`: `#params-panel` div before `.cfg-layout`; script tag before configgen.js.
   - `topology.js`: `renderParamsPanel()` called in `jumpStep(5)` hook.
   - `main.css`: 30 `.prm-*` CSS rules (panel, header, grid, fields, inputs, actions).
   - All 50 JS files pass `node --check`; no ES module violations; `'use strict'` in all files.

**Issues closed:** None (self-identified UX gap; no pre-existing issue number)

**Files changed**: `src/js/params.js` (new), `src/js/configgen.js`, `src/js/topology.js`, `index.html`, `src/css/main.css`
