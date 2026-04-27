# 🌐 NetDesign AI — Intelligent Network Design Platform

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-blue?style=flat-square&logo=github)](https://amit33-design.github.io/Network-Automation/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![No Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen?style=flat-square)](index.html)

> **Design campus, data center, GPU/AI cluster, and WAN networks in minutes.**  
> Requirements → product selection → topology diagrams → device configs → deployment validation — entirely in your browser, zero install.

![NetDesign AI Preview](preview.svg)

---

## 🚀 Live Demo

**[amit33-design.github.io/Network-Automation](https://amit33-design.github.io/Network-Automation/)**

No login required. Works on any modern browser. Click **⚡ Demo** for an instant pre-filled walkthrough.

---

## ✨ What It Does — 6 Steps

| Step | What you get |
|---|---|
| **1 — Use Case** | Pick Campus / DC / GPU Cluster / Hybrid / WAN + org details |
| **2 — Requirements** | Protocols, security, compliance, app flows, GPU/RoCEv2 options |
| **3 — Products** | AI-scored hardware SKUs from Cisco, Arista, Juniper, NVIDIA, PA, Fortinet |
| **4 — Design** | Interactive SVG topology (HLD) + IP plan, VLAN, BGP, physical tables (LLD) |
| **5 — Configs** | Production-ready IOS-XE / NX-OS / EOS / Junos / SONiC per device |
| **6 — Deploy** | Pre-checks → backup → push → commit-guard → post-checks dashboard |

---

## 🏗 Architecture Coverage

### Campus / Enterprise LAN
```
Internet → Firewall (HA) → Core → Distribution → Access → Endpoints
```
Cisco Cat9300/9500/9600 · OSPF/BGP · 802.1X · DHCP snooping · QoS/Voice

### Data Center Leaf-Spine (CLOS)
```
Border FW → Spine (×2) → Leaf (×N) → Servers
```
Nexus 93180/9336C · Arista 7050CX3/7280R3 · IS-IS underlay · BGP EVPN · VXLAN overlay

### AI / GPU Cluster
```
GPU Spine → GPU TOR → H100/A100 GPU Servers
Storage Spine → Storage Leaf → GPU Servers (NVMe-oF / NFS)
OOB Management → All devices
```
NVIDIA SN4600C/SN4800 · Arista 7060X4 · RoCEv2 · PFC · ECN/DCQCN · SHARP in-network compute

### WAN / SD-WAN
```
HQ Core ↔ MPLS/Internet ↔ Branch CPEs (×N)
```
Cisco ISR/ASR · Fortinet FortiGate · BGP · VRF · ZTP

---

## 📦 25+ Hardware SKUs Evaluated

| Layer | Cisco | Arista | Juniper | NVIDIA |
|---|---|---|---|---|
| Campus Access | Cat9300-24P/48P | 720XP-48ZC2 | EX2300-48P | — |
| Distribution | Cat9500-48Y4C | 7280R2A-30 | EX4650-48Y | — |
| Core | Cat9600-32C | 7500R3 | — | — |
| DC Leaf | Nexus 93180YC-FX / 93360YC-FX2 | 7050CX3-32S | QFX5120-48Y | — |
| DC Spine | Nexus 9336C-FX2 / 9364D-GX | 7280R3-48YC6 | QFX10002-60C | — |
| GPU TOR | Nexus 9336C-FX2 | 7060X4-32S | — | SN4600C / SN2700 |
| GPU Spine | — | 7800R3 | — | SN4800 |
| Firewall | Firepower 4145 | — | SRX4600 | — |
| Firewall | PA-3440 / PA-5445 | — | — | — |
| Firewall | FortiGate 1800F | — | — | — |

---

## ⚙️ Config Platforms

| Platform | Devices | Notable configs generated |
|---|---|---|
| **Cisco IOS-XE** | Campus access/dist/core | VLANs, STP, 802.1X, DHCP snooping, DAI, OSPF/BGP, PortFast/BPDUguard |
| **Cisco NX-OS** | DC spine/leaf, GPU TOR | IS-IS, BGP EVPN, VXLAN NVE, vPC, anycast GW, PFC/ECN/DCQCN, telemetry |
| **Arista EOS** | DC spine/leaf alt | BGP EVPN, VXLAN, IRB, gNMI, CloudVision-ready |
| **Juniper Junos** | Any layer | Hierarchical config, EVPN, Apstra-ready |
| **NVIDIA SONiC** | GPU TOR | config_db.json + PFC/WRED/ECN QoS JSON |

---

## 🚀 Quick Start

### Try it (no setup)
```
https://amit33-design.github.io/Network-Automation/
```

### Run locally
```bash
git clone https://github.com/Amit33-design/Network-Automation.git
cd Network-Automation
open index.html       # macOS
start index.html      # Windows
xdg-open index.html   # Linux
```
Single static HTML file — no npm, no build step, no server.

---

## 🗂 Project Structure

```
Network-Automation/
├── index.html           # Full frontend (~6000 lines, zero dependencies)
├── preview.svg          # OG social-share preview image
├── .nojekyll            # GitHub Pages — disable Jekyll processing
├── README.md
├── backend/             # Python backend (FastAPI + Nornir)
│   ├── main.py          # REST API endpoints
│   ├── config_gen.py    # Jinja2 config generation
│   ├── nornir_tasks.py  # Parallel deployment via Netmiko/NETCONF
│   ├── requirements.txt
│   └── templates/       # Per-platform Jinja2 templates
│       ├── ios_xe/
│       ├── nxos/
│       ├── eos/
│       └── junos/
└── playbooks/           # Ansible automation
    ├── deploy_campus.yml
    ├── deploy_dc.yml
    ├── pre_checks.yml
    ├── post_checks.yml
    ├── inventory/hosts.yml
    └── group_vars/all.yml
```

---

## 🛠 Tech Stack

**Frontend** — zero dependencies, pure browser
- HTML5 · CSS3 · Vanilla ES2020 JavaScript
- SVG with `animateMotion` for live packet-flow topology diagrams
- CSS custom properties, Grid, Flexbox, `@keyframes` animations
- `localStorage` session persistence · Web Share API

**Backend** (Python, optional — for real device push)
| Library | Role |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | REST API |
| [Nornir](https://nornir.readthedocs.io/) | Parallel task runner |
| [Netmiko](https://github.com/ktbyers/netmiko) | SSH to devices |
| [ncclient](https://github.com/ncclient/ncclient) | NETCONF transport |
| [Jinja2](https://jinja.palletsprojects.com/) | Config templating |
| [NAPALM](https://napalm.readthedocs.io/) | Multi-vendor abstraction |
| [TextFSM](https://github.com/google/textfsm) | CLI output parsing |

---

## 🗺 Roadmap

- [x] 6-step design wizard
- [x] AI product recommendation with fit scoring
- [x] Interactive SVG HLD topology diagrams with animated packet flow
- [x] Full LLD: IP plan, VLAN, BGP, physical connectivity
- [x] Multi-platform config generator (5 OS families)
- [x] Deploy pipeline + pre/post check dashboard
- [x] Demo mode, keyboard shortcuts, localStorage, mobile responsive
- [x] GitHub Pages live hosting
- [x] Python FastAPI + Nornir backend scaffold
- [x] Ansible playbooks
- [ ] PDF design document export
- [ ] Multi-site combined topology view
- [ ] Live NAPALM device connectivity
- [ ] Cisco NSO / Crosswork integration
- [ ] Arista CloudVision API integration
- [ ] IPv6-only design mode

---

## 📄 License

MIT © 2024 Amit Tiwari — contributions welcome!
