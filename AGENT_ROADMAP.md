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

## Feature Backlog (priority order)

### TIER 1 — Core gaps (ship these first)

#### BOM Enhancements
- [ ] **Cabling matrix**: For each BOM layer pair (e.g. spine↔leaf), generate a cable schedule: port A device/interface → port B device/interface, cable type (DAC/AOC/LC-LC), length (1m/3m/5m), quantity, part number
- [ ] **Optics catalog**: Add optics to PRODUCTS or a separate OPTICS catalog — SFP-10G-SR, QSFP-100G-SR4, QSFP-DD-400G-DR4, etc. with vendor (Cisco OEM, Finisar, Lumentum), reach, cost, and compatibility matrix
- [ ] **Price database**: Add `estimatedCostUSD` to all PRODUCTS entries (currently missing on most). Pull reference pricing from public sources. Add total BOM cost estimate in the BOM footer
- [ ] **Device naming convention**: Systematic hostname generator — `{site}-{role}-{rack}-{idx}` e.g. `IAD-LEAF-A01-01` based on STATE.orgName, numSites, role
- [ ] **Rack unit planning**: Add `rackU` field to PRODUCTS. Generate rack diagram data showing U consumption per device

#### Config Generation Gaps
- [ ] **OSPF underlay**: Currently BGP-only. Add OSPF area 0 underlay config for campus and DC use cases
- [ ] **STP/RSTP config**: Add Rapid-PVST+/MST config blocks for campus switches (port types, portfast, BPDU guard)
- [ ] **QoS policies**: Add QoS classification + marking + queuing configs per vendor (DSCP 46 for voice, 34 for video, etc.)
- [ ] **AAA/TACACS+**: Add TACACS+ / RADIUS config blocks for all vendors
- [ ] **NTP config**: Add NTP server hierarchy config to all generated configs
- [ ] **SNMP v3**: Add SNMP v3 auth+priv config to all vendors
- [ ] **interface descriptions**: Auto-generate `description` lines from the cabling matrix (e.g. `description TO: IAD-SPINE-01 Eth1/1`)

#### ZTP (Zero Touch Provisioning)
- [ ] **DHCP option 67**: Generate ISC DHCP / Cisco IOS DHCP config for ZTP boot file delivery
- [ ] **Netmiko/NAPALM onboarding script**: Generate Python script using netmiko to push day-0 config to a list of devices (reads from a CSV inventory)
- [ ] **Ansible playbook**: Generate `site.yml` + roles for pushing generated configs via NAPALM/netconf
- [ ] **Serial number → hostname mapping**: ZTP lookup table (CSV/YAML) mapping serial numbers to hostnames for Cisco ZTP / Arista ZTP
- [ ] **POAP (Cisco)**: Generate Cisco POAP Python script
- [ ] **EOS ZTP**: Generate Arista EOS ZTP script

#### Policy Management
- [ ] **ACL generator**: Generate named ACLs / prefix-lists from compliance selections (PCI, HIPAA zones)
- [ ] **BGP route-policy validator**: Check generated BGP policies for common mistakes (missing default deny, wrong community syntax)
- [ ] **Firewall rule consistency check**: Cross-check FW rules with network segmentation design — flag any policy that contradicts the HLD
- [ ] **Policy diff**: Show what changed between two policy versions (already have diffengine.js — extend it for policies)

#### Pre/Post Deployment Checks
- [ ] **Pre-check scripts**: Generate Python/Bash scripts that SSH to devices and verify: interface states, BGP neighbor count, routing table prefixes, LLDP neighbors match expected topology
- [ ] **Post-check scripts**: After config push — verify same checks pass, diff before/after states
- [ ] **NetBox sync**: Generate Python script to sync deployed topology to NetBox (using pynetbox)
- [ ] **Change window validator**: Check if proposed changes violate any maintenance window rules

### TIER 2 — Monitoring & Observability

- [ ] **Prometheus alert rules**: Generate `alert.rules.yml` for device-specific alerts (BGP session down, interface error rate, CPU > 80%)
- [ ] **Grafana dashboard JSON**: Generate Grafana dashboard for the designed topology (panels per device/layer)
- [ ] **SNMP MIB mapping**: Map key SNMP OIDs to human-readable labels for each vendor in the product catalog
- [ ] **Syslog parsing rules**: Generate Logstash/Fluentd parsing rules for vendor-specific syslog formats
- [ ] **Netflow/sFlow collector config**: Generate nfcapd / pmacct config for flow collection from designed devices
- [ ] **Real-time topology sync**: observability.js poll loop that refreshes topology from backend health-check API

### TIER 3 — ML-Based Troubleshooting & RCA

- [ ] **Symptom classifier**: Train/embed a simple nearest-neighbor classifier over a dataset of (symptom, root cause) pairs for common network issues. Use it in ts_engine.js to suggest root causes from free-text symptoms
- [ ] **BGP convergence predictor**: Given the topology (AS count, path count, policy complexity), estimate convergence time and flag risks
- [ ] **Anomaly detection**: Add a time-series anomaly detector in observability.js — flag metrics deviating > 2σ from rolling baseline
- [ ] **RCA playbook generator**: Given an alert type (e.g. "BGP neighbor down"), generate a step-by-step RCA playbook as a downloadable Markdown/PDF
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

1. **Read this file** (`AGENT_ROADMAP.md`) to understand current priorities
2. **Check git log** (`git log --oneline -20`) to see what was recently done
3. **Grep for TODOs** (`grep -r "TODO\|FIXME\|HACK\|XXX" src/js/ backend/ --include="*.js" --include="*.py" -n`)
4. **Pick the highest-priority incomplete feature** from TIER 1 that hasn't been implemented yet
5. **Implement it** following the coding conventions above
6. **Verify** it doesn't break existing functionality (trace through affected code paths)
7. **Commit** with a descriptive conventional-commit message
8. **Update this file** — mark completed items with `[x]` and add any new discoveries to the backlog
9. **Document** what was done in a `## Agent Log` section at the bottom of this file

The agent should aim to complete **1-2 full features** per 5-hour run, not start many things partially.

---

## Agent Log

<!-- The agent appends entries here after each run -->
