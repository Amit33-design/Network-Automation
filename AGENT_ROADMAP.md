# NetDesign AI — Agent Roadmap

## Platform Status
Browser-native (plain global JS + FastAPI backend) network design wizard.
Main entry: `index.html` | JS: `src/js/` | Backend: `backend/`

## Tier-1 Features

- [x] **Platform foundation** — 6-step wizard, index.html, state.js, products.js, init.js
- [x] **Cabling matrix** — `src/js/cabling.js`: cable schedule per layer pair (DAC/AOC/LC-LC/MPO), Cabling tab in Step 2, CSV export, `window.generateCablingMatrix(layers, devices, state)`
- [x] **Device hostname generator** — `src/js/naming.js`: `window.generateHostnames(devices, state)`, pattern `{SITE}-{ROLE}-{RACK}{IDX:02d}` (e.g. IAD-LEAF-A01), integrated into buildDeviceList()
- [x] **Optics catalog + BOM pricing** — `src/js/optics.js`: 10-transceiver catalog (SFP-10G-SR/LR, SFP28-25G-SR/LR, QSFP-28-100G-SR4/LR4/PSM4, QSFP-DD-400G-DR4/FR4/LR4), `window.recommendOptics()` selects cheapest compatible optic per link group, Optics tab in Step 2, CSV export, total rolled into BOM grand total.
- [x] **Pre/post check scripts** — `src/js/checks.js`: `window.genPreCheckScript(devices, state)` and `window.genPostCheckScript(devices, state)` generating Netmiko Python scripts; Step 5 with 3 sub-tabs (pre / post / usage guide), download buttons per script.
- [x] **Prometheus alert rules** — `src/js/monitoring.js`: `window.genPrometheusAlerts(devices, state)` outputs alert.rules.yml YAML; BGP session/prefix, interface errors/utilization, CPU/memory, device unreachable; PCI/HIPAA tightened thresholds; GPU RoCEv2 CNP + PFC watchdog alerts. Downloadable from Step 6.
- [x] **Grafana dashboard JSON** — `window.genGrafanaDashboard(devices, state)` outputs Grafana import JSON; overview stats row, interface utilization, error rates, BGP sessions/prefixes, system CPU/mem, GPU fabric panels (RoCEv2 use case). Downloadable from Step 6.
- [ ] **RCA playbook generator** — `src/js/ts_engine.js`: `window.genRCAPlaybook(symptom, devices, state)` returns structured Markdown (symptom → causes → verify commands → remediation).
- [ ] **Ansible playbook generator** — `src/js/ansible.js`: `window.genAnsiblePlaybook(devices, state)` outputs site.yml + host_vars/ using NAPALM/netconf; downloadable ZIP from Step 5.
- [ ] **QoS policy config blocks** — In `configgen.js`: per-vendor DSCP markings, queuing policies, WRED; shown when `compliance` includes 'QoS' or `appTypes` includes 'voice'/'video'.
- [ ] **BGP route-policy validator** — In `policyengine.js`: `window.validateBGPPolicies(configs)` flags missing default deny, asymmetric policies, communities not stripped on export, max-prefix not set.

## Agent Log

### Run 2026-05-24 00:00Z
**Implemented**: Pre/post check scripts + Prometheus alerts + Grafana dashboard + CLAUDE.md saved
**Files changed**:
- `CLAUDE.md` (created) — project context file for future sessions
- `src/js/checks.js` (created) — `window.genPreCheckScript()` + `window.genPostCheckScript()`: Netmiko Python scripts, per-platform show commands (NX-OS/EOS/JunOS/IOS-XE/SONiC), BGP peer count / route count diff logic, structured JSON baseline
- `src/js/monitoring.js` (created) — `window.genPrometheusAlerts()`: BGP/interface/system/GPU alert groups, PCI+HIPAA threshold tightening; `window.genGrafanaDashboard()`: 6 panel rows, device variable, GPU fabric row for RoCEv2 use case
- `index.html` (updated) — Steps 5 & 6 replaced "coming soon" with real UI; 3-tab sub-nav in each step; script and monitoring output containers
- `src/js/init.js` (updated) — `renderChecks()`, `downloadPreCheck()`, `downloadPostCheck()`, `renderMonitoring()`, `downloadPrometheus()`, `downloadGrafana()`, `escapeHtml()`, `wireSubTabs()` helper, step-guard for 5/6
- `AGENT_ROADMAP.md` (updated) — marked 3 features complete
**Summary**: Steps 5 and 6 are now fully functional. Pre-check generates a Netmiko Python script that SSH-connects to every BOM device, runs platform-correct `show` commands, and saves a JSON baseline. Post-check re-runs the same commands and diffs BGP peer count and route count against baseline (alerts on >5% route drop). Prometheus YAML covers BGP, interface errors/utilization, CPU/memory, and device reachability — with GPU-specific RoCEv2/PFC alerts when use_case=gpu. Grafana JSON is Grafana-import ready with 6 panel rows and a device selector variable.

### Run 2026-05-18 01:00Z
**Implemented**: Optics catalog + BOM pricing integration
**Files changed**: `src/js/optics.js` (created), `src/js/bom.js` (updated), `src/js/init.js` (updated), `index.html` (updated)
**Summary**: Added a 10-transceiver optics catalog covering SFP-10G through QSFP-DD-400G form factors. `window.recommendOptics()` groups cabling links by speed/distance/layer and selects the cheapest compatible optic for each group, populating STATE.optics. A new Optics tab in Step 2 displays the recommendations table, an Export button downloads CSV, and the BOM grand total now includes hardware + cabling + optics costs.

### Run 2026-05-18 00:00Z
**Implemented**: Platform foundation + Cabling matrix + Device hostname generator
**Files changed**:
- `index.html` (created) — 6-step wizard UI, dark theme, BOM/Cabling sub-tabs, config viewer
- `src/js/state.js` (created) — global STATE object with all fields
- `src/js/products.js` (created) — 17 products (Cisco NX-OS, Arista, Juniper, Aviatrix, Palo Alto), all required fields present
- `src/js/naming.js` (created) — `window.generateHostnames()`, ROLE_CODE map, `{SITE}-{ROLE}-{RACK}{IDX:02d}` pattern
- `src/js/cabling.js` (created) — `window.generateCablingMatrix()`, `renderCablingTable()`, `exportCablingCSV()`, 11 cable types (DAC/AOC/LC-LC/MPO), distance-aware selection
- `src/js/bom.js` (created) — `window.buildBOM()`, `buildDeviceList()`, `renderBOMTable()`, `exportBOMCSV()`, scale defs for all 7 use cases
- `src/js/configgen.js` (created) — vendor config generators (Cisco NX-OS spine/leaf, Arista EOS, Juniper QFX), `window.generateAllConfigs()`, `renderConfigViewer()`
- `src/js/init.js` (created) — UI wiring, toast notifications, step navigation, form handlers, file download utility
- `AGENT_ROADMAP.md` (created) — this file
**Summary**: Built the complete NetDesign AI platform foundation from scratch. The 6-step wizard handles all 7 use cases (campus/dc/gpu/wan/multisite/multicloud/aviatrix) with 3 scale tiers. Feature #3 (hostname generator) produces `{SITE}-{ROLE}-{RACK}{IDX:02d}` names (e.g. IAD-LEAF-A01) for every device. Feature #1 (cabling matrix) generates a full cable schedule per layer pair selecting DAC/AOC/MPO/LC-LC based on link distance and speed, exposed in a Cabling tab in Step 2 with CSV export.
