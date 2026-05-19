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
- [ ] **Optics catalog** [#5](https://github.com/Amit33-design/Network-Automation/issues/5): Add optics to PRODUCTS or a separate OPTICS catalog — SFP-10G-SR, QSFP-100G-SR4, QSFP-DD-400G-DR4, etc. with vendor (Cisco OEM, Finisar, Lumentum), reach, cost, and compatibility matrix
- [x] **Price database** [#6](https://github.com/Amit33-design/Network-Automation/issues/6): Add `estimatedCostUSD` to all PRODUCTS entries (currently missing on most). Pull reference pricing from public sources. Add total BOM cost estimate in the BOM footer
- [x] **Device naming convention** [#7](https://github.com/Amit33-design/Network-Automation/issues/7): Systematic hostname generator — `{site}-{role}-{rack}-{idx}` e.g. `IAD-LEAF-A01-01` based on STATE.orgName, numSites, role
- [ ] **Rack unit planning**: Add `rackU` field to PRODUCTS. Generate rack diagram data showing U consumption per device

#### Config Generation Gaps
- [ ] **OSPF underlay** [#8](https://github.com/Amit33-design/Network-Automation/issues/8): Currently BGP-only. Add OSPF area 0 underlay config for campus and DC use cases
- [ ] **STP/RSTP config**: Add Rapid-PVST+/MST config blocks for campus switches (port types, portfast, BPDU guard)
- [ ] **QoS policies** [#9](https://github.com/Amit33-design/Network-Automation/issues/9): Add QoS classification + marking + queuing configs per vendor (DSCP 46 for voice, 34 for video, etc.)
- [ ] **AAA/TACACS+** [#10](https://github.com/Amit33-design/Network-Automation/issues/10): Add TACACS+ / RADIUS config blocks for all vendors
- [x] **NTP + SNMP v3** [#11](https://github.com/Amit33-design/Network-Automation/issues/11): Add NTP server hierarchy + SNMP v3 auth+priv config to all vendors
- [ ] **interface descriptions**: Auto-generate `description` lines from the cabling matrix (e.g. `description TO: IAD-SPINE-01 Eth1/1`)

#### ZTP (Zero Touch Provisioning)
- [ ] **DHCP option 67 + Netmiko** [#12](https://github.com/Amit33-design/Network-Automation/issues/12): Generate ISC DHCP / Cisco IOS DHCP config for ZTP boot file delivery + Netmiko onboarding script
- [ ] **Ansible playbook** [#13](https://github.com/Amit33-design/Network-Automation/issues/13): Generate `site.yml` + roles for pushing generated configs via NAPALM/netconf
- [ ] **Serial number → hostname mapping**: ZTP lookup table (CSV/YAML) mapping serial numbers to hostnames for Cisco ZTP / Arista ZTP
- [ ] **POAP (Cisco)**: Generate Cisco POAP Python script
- [ ] **EOS ZTP**: Generate Arista EOS ZTP script

#### Policy Management
- [ ] **ACL generator** [#14](https://github.com/Amit33-design/Network-Automation/issues/14): Generate named ACLs / prefix-lists from compliance selections (PCI, HIPAA zones)
- [ ] **BGP route-policy validator**: Check generated BGP policies for common mistakes (missing default deny, wrong community syntax)
- [ ] **Firewall rule consistency check**: Cross-check FW rules with network segmentation design — flag any policy that contradicts the HLD
- [ ] **Policy diff**: Show what changed between two policy versions (already have diffengine.js — extend it for policies)

#### Pre/Post Deployment Checks
- [ ] **Pre/Post-check scripts** [#15](https://github.com/Amit33-design/Network-Automation/issues/15): Generate Python/Bash scripts that SSH to devices and verify: interface states, BGP neighbor count, routing table prefixes, LLDP neighbors match expected topology
- [ ] **NetBox sync** [#20](https://github.com/Amit33-design/Network-Automation/issues/20): Generate Python script to sync deployed topology to NetBox (using pynetbox)
- [ ] **Change window validator**: Check if proposed changes violate any maintenance window rules

### TIER 2 — Monitoring & Observability

- [ ] **Prometheus alert rules** [#16](https://github.com/Amit33-design/Network-Automation/issues/16): Generate `alert.rules.yml` for device-specific alerts (BGP session down, interface error rate, CPU > 80%)
- [ ] **Grafana dashboard JSON** [#17](https://github.com/Amit33-design/Network-Automation/issues/17): Generate Grafana dashboard for the designed topology (panels per device/layer)
- [ ] **SNMP MIB mapping**: Map key SNMP OIDs to human-readable labels for each vendor in the product catalog
- [ ] **Syslog parsing rules**: Generate Logstash/Fluentd parsing rules for vendor-specific syslog formats
- [ ] **Netflow/sFlow collector config**: Generate nfcapd / pmacct config for flow collection from designed devices
- [ ] **Real-time topology sync**: observability.js poll loop that refreshes topology from backend health-check API

### TIER 3 — ML-Based Troubleshooting & RCA

- [ ] **Symptom classifier**: Train/embed a simple nearest-neighbor classifier over a dataset of (symptom, root cause) pairs for common network issues. Use it in ts_engine.js to suggest root causes from free-text symptoms
- [ ] **BGP convergence predictor** [#19](https://github.com/Amit33-design/Network-Automation/issues/19): Given the topology (AS count, path count, policy complexity), estimate convergence time and flag risks
- [ ] **Anomaly detection**: Add a time-series anomaly detector in observability.js — flag metrics deviating > 2σ from rolling baseline
- [ ] **RCA playbook generator** [#18](https://github.com/Amit33-design/Network-Automation/issues/18): Given an alert type (e.g. "BGP neighbor down"), generate a step-by-step RCA playbook as a downloadable Markdown/PDF
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
