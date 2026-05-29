# React Migration Gap Analysis — Progress Tracker

## Sprint Status (updated after each push)

| ID | Feature | Status | Commit |
|----|---------|--------|--------|
| M-02 | numSites field | ✅ Done | 98c075c |
| M-14 | Vendor filter tabs Step 3 | ✅ Done | 975e00a |
| M-20 | IP Plan tab Step 4 | ✅ Done | c7d1efc |
| M-21 | VLAN Design tab Step 4 | ✅ Done | c7d1efc |
| M-22 | Routing & Protocols tab Step 4 | ✅ Done | c7d1efc |
| M-28 | Export HLD SVG | ✅ Done | c7d1efc |
| M-29 | Export LLD CSV | ✅ Done | c7d1efc |
| M-37 | Deploy pipeline 5-stage UI | ✅ Done | a3bca3e |
| M-43 | Troubleshooting Engine panel | ✅ Done | 0910dd1 |
| M-53 | Collapsible sidebar navigation | ✅ Done | 0910dd1 |
| M-04 | VPN type select Step 2 | ✅ Done | afb1382 |
| M-05 | NAC chip group Step 2 | ✅ Done | afb1382 |
| M-06 | Additional notes textarea Step 2 | ✅ Done | afb1382 |
| M-07 | FedRAMP + NIST CSF compliance chips | ✅ Done | afb1382 |
| M-08 | GENEVE overlay option | ✅ Done | afb1382 |
| M-09 | Richer routing features list | ✅ Done | afb1382 |
| M-10 | Live summary sidebar Step 2 | ✅ Done | afb1382 |
| M-13 | Requirement validator | ✅ Done | afb1382 |
| M-15 | AI product scoring badges | ✅ Done | dd6fb03 |
| M-16 | EOL alert panel | ✅ Done | dd6fb03 |
| M-19 | IP plan tab Step 3 | ✅ Done | dd6fb03 |
| M-23 | Physical Links tab Step 4 | ✅ Done | 8f88526 |
| M-25 | Mermaid Diagram tab Step 4 | ✅ Done | 8f88526 |
| M-26 | Simulate tab Step 4 | ✅ Done | 8f88526 |
| M-27 | Summary tab Step 4 | ✅ Done | 8f88526 |
| M-33 | Config section nav Step 5 | ✅ Done | 94e3a3c |
| M-35 | Layer filter tabs Step 5 | ✅ Done | 94e3a3c |
| M-44 | BGP convergence predictor | ✅ Done | 0910dd1 |
| M-45 | Symptom classifier | ✅ Done | 0910dd1 |
| M-46 | Incident search / KB | ✅ Done | 0910dd1 |
| M-47 | RCA Playbook Generator | ✅ Done | cc01ab9 |
| M-48 | Download pre-check script | ✅ Done | 94e3a3c |
| M-49 | Download post-check script | ✅ Done | 94e3a3c |
| M-50 | Download push_configs.py | ✅ Done | 94e3a3c |
| M-51 | Grok log parsing config download | ✅ Done | 94e3a3c |
| M-52 | NetFlow/sFlow exporter config | ✅ Done | 94e3a3c |
| M-54 | Config Policy modal | ✅ Done | fdca43e |
| M-56 | My Designs panel | ✅ Done | fdca43e |
| M-58 | Backend toggle | ✅ Done | fdca43e |
| M-59 | Export modal | ✅ Done | fdca43e |
| M-11 | Multi-cloud specific fields Step 2 | ✅ Done | 408d05f |
| M-17 | Rack plan section Step 3 | ✅ Done | 408d05f |
| M-18 | Port capacity table Step 3 | ✅ Done | 408d05f |
| M-24 | Reference Designs tab Step 4 | ✅ Done | 408d05f |
| M-01 | Primary contact field Step 1 | ✅ Done | 7ee48d6 |
| M-30 | Export All Configs .txt bundle | ✅ Done | fdca43e |
| M-31 | Full HTML Design Report | ✅ Done | fdca43e |
| M-34 | Config diff viewer | ✅ Done | 7ee48d6 |
| M-38 | Per-device deploy status table | ✅ Done | 7ee48d6 |
| M-39 | Canary deployment option | ✅ Done | 7ee48d6 |
| M-55 | Policy Rules Editor (YAML DSL) | ✅ Done | 7ee48d6 |
| M-57 | Share button / shareable URL | ✅ Done | 7ee48d6 |
| M-60 | Breadcrumb / progress bar | ✅ Done | 7ee48d6 |
| M-36 | Toggle all sections collapse | ✅ Done | fda6298 |
| M-40 | Live deploy feed (WebSocket API in client.ts, simulation complete) | ✅ Done | a3bca3e |
| M-41 | Rollback modal | ✅ Done | 76d5125 |
| M-42 | Pipeline timestamp display | ✅ Done | 76d5125 |
| M-64 | Ansible playbook generation | ✅ Done | 76d5125 |
| M-65 | Netconf push UI | ✅ Done | 76d5125 |
| M-67 | Day-2 Ops panel | ✅ Done | 76d5125 |
| M-68 | Batfish dry-run validation | ✅ Done | 76d5125 |
| M-61 | Enterprise Approvals workflow | ✅ Done | 511a64b |
| M-62 | Integrations panel (Slack/Teams/ServiceNow/Jira/NetBox/AWX/GitOps) | ✅ Done | 511a64b |
| M-66 | AWX integration | ✅ Done | 511a64b |
| M-63 | Profile / Login (Clerk auth) | ⏳ P3 — requires Clerk.dev account | — |

> **Session resume**: check this table first — start from first row that is not ✅ Done.
> Implement in order. After each item: run `cd frontend && npm test -- --run && npm run build`, commit, push to `main`.

---

# React Migration Gap Analysis
*Audited: 2026-05-29 | Source: `src/js/*.js` + `index.html` (3708 lines) vs `frontend/src/`*

This document records every feature present in the original vanilla-JS app
(`index.html` / `src/js/`) that is absent or incomplete in the React migration
(`frontend/src/`). Use gap IDs in commit messages and PR descriptions.

---

## How to read priority

| P | Meaning |
|---|---------|
| P0 | Blocking — user can clearly see it missing today |
| P1 | Core feature — needed for the app to be functionally equivalent |
| P2 | Enhancement — present in original but lower visibility |
| P3 | Enterprise / backend-only — requires live API key |

---

## Step 1 — Use Case Selection

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-01 | "Primary contact" input field | `index.html:800` | P2 |
| M-02 | "Number of sites / locations" number input | `index.html:804` | **P0** (added in current sprint) |
| M-03 | NetBox import panel | `src/js/netbox.js` | P3 |

---

## Step 2 — Network Requirements

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-04 | VPN type select (IPsec/SSL/ZTNA/None) | `index.html:1082` | P1 |
| M-05 | NAC chip group (802.1X wired, 802.1X wireless) | `index.html:1093` | P1 |
| M-06 | Additional notes / special requirements textarea | `index.html:1301` | P1 |
| M-07 | Compliance options: FedRAMP, NIST CSF missing (only PCI/HIPAA/SOC2 present) | `index.html:1095` | P1 |
| M-08 | GENEVE option in overlay protocols | `index.html:1047` | P2 |
| M-09 | Routing features richer list: IPv6 Dual-Stack, Multicast (PIM-SM), Route Reflectors, PBR, VRF/Tenant, Anycast GW, FlowSpec, BGP Unnumbered | `index.html:1055–1067` | P1 |
| M-10 | Live summary sidebar panel (right column, shows current selections) | `index.html:1310–1335` | P1 |
| M-11 | Multi-cloud specific fields (cloud providers, DC topology, colo provider, DC edge vendor, ASN, org CIDR, Aviatrix opts) | `index.html:1200–1280` | P2 |
| M-12 | PeeringDB integration panel | `src/js/peeringdb.js` | P3 |
| M-13 | Requirement validator (shows errors/warnings inline) | `src/js/validator.js` + `index.html:1344` | P1 |

---

## Step 3 — Products & BOM

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-14 | Vendor filter tabs on product list (All / Cisco / Arista / Juniper / NVIDIA / PA / Fortinet) | `index.html:1371–1380` | **P0** |
| M-15 | AI product scoring/recommendations section | `src/js/scoring.js`, `src/js/recommendations.js` | P1 |
| M-16 | EOL (End-of-Life) alert panel per product | `src/js/eol.js` | P1 |
| M-17 | Rack plan section (rack U diagram) | `index.html:1422` | P2 |
| M-18 | Port capacity section (port utilisation table) | `index.html:1425`, `src/js/capacity.js` | P2 |
| M-19 | IP plan section embedded in BOM step | `index.html:1428`, `src/js/ipplan.js` | P1 |

---

## Step 4 — Network Design  ← **Biggest gap**

### Missing design tabs (original has 9 tabs)

| ID | Tab | Original code | Priority |
|----|-----|---------------|----------|
| M-20 | **IP Plan tab** — address blocks per device type / use case | `src/js/topology.js:1136 renderIPPlan()` + `src/js/ipplan.js` | **P0** |
| M-21 | **VLAN Design tab** — VLAN table with VLAN IDs, VNIs, VRFs, gateway IPs | `src/js/topology.js:1342 renderVLANPlan()` | **P0** |
| M-22 | **Routing & Protocols tab** — BGP peer table, OSPF areas, EIGRP AS, IS-IS, VNI table | `src/js/topology.js:1398 renderBGPDesign()` | **P0** |
| M-23 | **Physical Links tab** — cabling schedule with port, speed, SFP type per link | `src/js/topology.js:1551 renderPhysical()` | P1 |
| M-24 | **Reference Designs tab** — reference architecture documents per use case | `src/js/topology.js:1606 REF_DOCS + renderRefArchitectures()` | P2 |
| M-25 | **Mermaid Diagram tab** — auto-generated Mermaid flowchart rendered in browser | `src/js/mermaid_export.js` | P1 |
| M-26 | **Simulate tab** — failure simulation, reachability matrix, route propagation table | `src/js/simulation.js:renderSimulationTab()` | P1 |
| M-27 | **Summary tab** — full design summary (intent, BOM, topology, protocol summary) | `src/js/export.js:renderDesignSummary()` | P1 |

### Missing export actions on Step 4

| ID | Feature | Original code | Priority |
|----|---------|---------------|----------|
| M-28 | **Export HLD as SVG** button | `src/js/topology.js:1752 exportSVG()` | **P0** |
| M-29 | **Export LLD as CSV** (IP plan, VLAN, BGP, physical) | `src/js/topology.js:1763 exportLLD()` | **P0** |
| M-30 | **Export All Configs** as .txt bundle | `src/js/export.js:exportAllConfigs()` | P1 |
| M-31 | **Full HTML Design Report** (self-contained) | `src/js/export.js:exportHTMLReport()` | P1 |
| M-32 | **Print** button | `src/js/topology.js:1776 printDesign()` | P2 |

---

## Step 5 — Config Generation

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-33 | Section navigation inside config (jump to MANAGEMENT / VLANs / INTERFACES / OSPF / BGP etc.) | `src/js/configgen.js:328 renderSectionNav()` | P1 |
| M-34 | Config diff viewer (compare with previous version) | `src/js/diffengine.js` + `index.html:1747` | P2 |
| M-35 | Layer filter tabs on device list (All / Spine / Leaf / Firewall etc.) | `src/js/configgen.js:211 filterDevLayer()` | P1 |
| M-36 | "Toggle all sections" collapse button | `src/js/configgen.js:347` | P2 |

---

## Step 6 — Deploy & Validate

### Deploy pipeline (currently missing entirely from React)

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-37 | Deploy pipeline UI with 5 stages: Pre-checks → Backup → Push → Verify → Post-checks | `src/js/deploy.js:pipelineStageStart()` | **P0** |
| M-38 | Per-device status table during deploy (Pending/Deploying/Done/Failed) | `src/js/deploy.js:initDeviceStatusTable()` | P1 |
| M-39 | Canary deployment option (deploy 1 device first, confirm gate) | CLAUDE.md gap G-A5 | P1 |
| M-40 | Live deploy feed via WebSocket stream | `src/js/deploy.js:LiveDeployFeed()` + `/ws/deploy/{id}` | P1 |
| M-41 | Rollback modal with scope (stage / full) | `src/js/deploy.js:openRollbackModal()` | P1 |
| M-42 | Pipeline timestamp display | `src/js/deploy.js:renderPipelineTimestamp()` | P2 |

### Troubleshooting Engine (missing from React entirely)

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-43 | **Troubleshooting Engine** — full panel in sidebar | `src/js/ts_engine.js` (2337 lines) | **P0** |
| M-44 | BGP convergence predictor | `src/js/ts_engine.js:1292 predictBGPConvergence()` | P1 |
| M-45 | Symptom classifier (NLP → root cause) | `src/js/ts_engine.js:1724 classifySymptom()` | P1 |
| M-46 | Incident search / KB | `src/js/ts_engine.js:2223 searchIncidentDB()` | P1 |
| M-47 | RCA playbook generator (per alert type) | `src/js/ts_engine.js:1203 genRCAPlaybook()` | P1 |

### Observability & ZTP downloads (partially missing)

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-48 | Download pre-check script (Python/Netmiko) | `src/js/checks.js:590 downloadPreCheckScript()` | P1 |
| M-49 | Download post-check script | `src/js/checks.js:596 downloadPostCheckScript()` | P1 |
| M-50 | Download push_configs.py (Netmiko push script) | `index.html:2161` | P1 |
| M-51 | Grok/regexp log parsing configs download | `index.html:2099` | P2 |
| M-52 | NetFlow/sFlow exporter config download | `index.html:2106` | P2 |

---

## Global / Cross-cutting Features

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-53 | **Collapsible sidebar** navigation (vs tab-based WizardNav) — sidebar has DESIGN / CONFIGURATION / DEPLOY & VALIDATE / TOOLS / ENTERPRISE groups | `index.html:541–671` | **P0** |
| M-54 | **Config Policy modal** — 10+ pre-built policy blocks (NTP, AAA, SNMP, LLDP, etc.) that get appended to every config | `src/js/custom_policy.js`, `src/js/policy_blocks.js` | P1 |
| M-55 | **Policy Rules Editor** — YAML DSL for custom constraint rules | `src/js/policy_rules_editor.js` | P2 |
| M-56 | **My Designs** — save / load / list saved designs | `src/js/designs.js` | P1 |
| M-57 | **Share** button — shareable URL/link for design | `index.html:695` | P2 |
| M-58 | **Backend toggle** — Live mode vs Simulation mode, backend URL config | `src/js/backend.js` | P1 |
| M-59 | **Export modal** — unified export dialog with options (LLD CSV, All Configs, HTML Report) | `src/js/export.js:showExportModal()` | P1 |
| M-60 | **Breadcrumb / progress bar** in header (shows current step name) | `index.html:691` | P2 |

---

## Enterprise Features (P3 — requires auth)

| ID | Gap | Original code | Priority |
|----|-----|---------------|----------|
| M-61 | Enterprise Approvals workflow | `src/js/enterprise.js` | P3 |
| M-62 | Integrations panel (ServiceNow, AWX, Batfish, DNAC, NetBox) | `src/js/enterprise.js`, various | P3 |
| M-63 | Profile / Login (Clerk auth) | `index.html:660`, `src/js/gate.js` | P3 |
| M-64 | Ansible playbook generation | `src/js/ansible.js` | P2 |
| M-65 | Netconf push | `src/js/netconf.js` | P2 |
| M-66 | AWX integration | `src/js/awx.js` | P3 |
| M-67 | Day-2 ops (change window, config drift, compliance audit) | `src/js/day2ops.js`, `src/js/changewindow.js` | P2 |
| M-68 | Batfish dry-run validation | `src/js/batfish.js` | P2 (CLAUDE.md G-A3) |

---

## What IS already in the React migration ✅

- Landing page (hero, features, use-case chips, CTA) ✅
- Step 1: Use Case tiles, Org details, Vendor chips, Industry chips ✅
- Step 2: Redundancy, traffic pattern, endpoints, bandwidth, oversubscription, underlay/overlay protocols, basic protocol features, compliance chips ✅
- Step 3: Products & BOM table, cabling schedule tab, optics tab, topology tab ✅
- Step 4: HLD topology SVG (basic → being upgraded to rich animated version) ✅
- Step 5: Config generation — device list + config viewer + per-device download ✅
- Step 6: ZTP simulation, Pre/Post checks, Monitoring tabs ✅
- Alerts panel, RCA panel, deploy WebSocket feed ✅
- 127 Vitest tests covering configgen.ts (36), bom.ts, utils.ts ✅

---

## Implementation order suggestion (P0 first)

```
Sprint 1 (P0 — visible gaps):
  M-02  numSites field        (done in current sprint)
  M-14  Vendor filter tabs in Step 3
  M-20  IP Plan tab in Step 4
  M-21  VLAN Design tab in Step 4
  M-22  Routing & Protocols tab in Step 4
  M-28  Export HLD SVG button
  M-29  Export LLD CSV button
  M-37  Deploy pipeline UI with 5 stages
  M-43  Troubleshooting Engine panel
  M-53  Collapsible sidebar navigation

Sprint 2 (P1 — feature parity):
  M-04/05/06/07/08/09  Step 2 missing fields
  M-10  Live summary sidebar in Step 2
  M-13  Requirement validator
  M-15  AI product scoring
  M-16  EOL panel
  M-19  IP plan in BOM step
  M-23  Physical Links tab
  M-25  Mermaid Diagram tab
  M-26  Simulate tab
  M-27  Summary tab
  M-30/31  Export All Configs + HTML Report
  M-33/35  Config section nav + layer filter
  M-38–42  Deploy pipeline details
  M-44–47  Troubleshooting Engine sub-features
  M-48–52  Script downloads
  M-54  Config Policy modal
  M-56  My Designs
  M-58  Backend toggle
  M-59  Export modal

Sprint 3 (P2 + P3):
  M-24  Reference Designs tab
  M-32  Print
  M-34  Diff viewer
  M-36  Toggle all sections
  M-57  Share
  M-60  Breadcrumb
  M-61–68  Enterprise features
```

---

*Last updated: 2026-05-29*
*Source audit: `index.html` (3708 lines), `src/js/` (34,769 lines across 52 files)*
