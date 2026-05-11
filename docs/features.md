# NetDesign AI — Full Feature Reference

## 6-Step Design Wizard

| Step | What you get |
|---|---|
| **1 — Use Case** | Campus · DC · GPU Cluster · WAN · Hybrid · Multi-Site DCI |
| **2 — Requirements** | Protocols, security, compliance, GPU/RoCEv2, budget, vendors |
| **3 — Products** | 40+ SKUs scored 0–100 across 8 signals — auto-selects best fit per layer |
| **4 — Design** | Animated SVG topology (HLD) + IP plan, VLAN, BGP, physical tables (LLD) |
| **5 — Configs** | Per-device configs with syntax highlighting + Myers LCS diff |
| **6 — Deploy** | Policy → Gate → Pre-checks → Backup → Delta push → Post-checks → Rollback |

---

## Policy Engine — 15 Rules

| Rule | Action | Triggered when |
|---|---|---|
| `PRODUCT_SELECTION_REQUIRED` | BLOCK | No products selected |
| `EVPN_REQUIRES_VRF` | BLOCK | EVPN overlay with no tenant VRF |
| `VLAN_RANGE` | BLOCK | VLAN ID outside 1–4094 |
| `SUBNET_OVERLAP` | BLOCK | Overlapping IP prefixes |
| `VNI_UNIQUENESS` | BLOCK | Duplicate VNI assignments |
| `MTU_VXLAN_HEADROOM` | FAIL | Host MTU < 9000 with VXLAN |
| `PFC_LOSSLESS_CONFIG` | FAIL | GPU/RDMA workload without PFC + ECN |
| `REDUNDANCY_REQUIRED` | FAIL | Spine count < 2 (single SPOF) |
| `SPINE_RR_REQUIRED` | FAIL | EVPN without RR on spines |
| `GPU_PFC_REQUIRED` | AUTO_FIX | GPU use case, PFC missing → added automatically |
| `EVPN_REQUIRES_BGP` | AUTO_FIX | EVPN set, BGP missing → added automatically |
| `GPU_ROCE_ECN` | WARN | GPU without RoCEv2/ECN configured |
| `SINGLE_SPINE_SPOF` | WARN | Only one spine defined |
| `WAN_ENCRYPTION` | WARN | WAN design without MACsec/IPsec |
| `BGP_AUTH_PROD` | WARN | Production BGP without MD5 auth |

---

## Deployment Gate

```
Confidence = simulation(40) + precheck(30) + policy(20) + zero-warn bonus(10)
```

| Score | Status | Meaning |
|---|---|---|
| 80–100 | 🟢 APPROVED | Safe to deploy |
| 50–79 | 🟡 CONDITIONAL | Review warnings first |
| 0–49 | 🔴 BLOCKED | Fix blocking issues |

---

## EVPN / VXLAN Generation

| Component | Detail |
|---|---|
| L2VNI | `10000 + vlan_id` per VLAN per leaf |
| L3VNI | `19000 + vrf_index` per tenant VRF (symmetric IRB) |
| Route-Targets | `ASN:VNI` format, per-VNI import + export |
| Spine RR | `retain route-target all` + `advertise-pip` + `route-reflector-client` |
| NVE VTEP | `suppress-arp` + `ingress-replication protocol bgp` per L2VNI |
| Anycast GW | Per-SVI `ip anycast-gateway` with shared MAC |

---

## H100 GPU / RoCEv2 Config

| Feature | Value |
|---|---|
| Host port speed | 400GbE |
| MTU | 9214 bytes |
| FEC | RS-FEC |
| DSCP marking | DSCP 24/26 → TC3 (lossless), DSCP 46 → TC5 (strict priority) |
| PFC priorities | 3 + 4 |
| ECN / DCQCN | WRED Kmin=50KB Kmax=100KB, mark-only |
| PFC Watchdog | detection=400ms, restoration=2000ms |

---

## Export Options

| Format | Contents |
|---|---|
| Config bundle | `.txt` — one file per device |
| HTML report | Dark theme — intent, topology, BOM, all configs |
| HLD topology | `.svg` animated diagram |
| LLD tables | `.csv` — IP plan, VLAN, BGP, physical connectivity |
| Runbook | Markdown / PDF step-by-step deploy guide |
| Ansible | Playbook + inventory |
| Terraform | HCL for supported platforms |
| draw.io | Editable topology diagram |

---

## Roadmap

- [x] 6-step intent-driven design wizard
- [x] 40+ hardware SKUs with 8-signal product scoring
- [x] Interactive SVG topology (campus, DC, GPU, WAN)
- [x] Multi-platform config generator (NX-OS · EOS · SONiC · IOS-XE · JunOS)
- [x] EVPN/VXLAN full overlay (L2VNI, L3VNI, symmetric IRB, RT scheme)
- [x] H100 GPU TOR config (PFC, DCQCN, ECN, 400GbE)
- [x] Myers LCS config diff engine
- [x] Failure simulation (BFS partition, BGP/EVPN impact)
- [x] Policy engine — 15 rules
- [x] Deployment gate — confidence score
- [x] Delta deploy + granular rollback
- [x] MCP server — 20 tools
- [x] Async deploy (Celery + Redis) + WebSocket live feed
- [x] ZTP — Cisco POAP, Arista EOS-ZTP, SONiC
- [x] JWT RBAC — viewer / designer / operator / admin
- [x] PostgreSQL persistence + HashiCorp Vault
- [x] Mac desktop app (Electron)
- [x] PWA — Add to Home Screen on iOS/Android
- [x] SaaS stack — Vercel · Clerk · Stripe · Supabase · Pinecone
- [ ] gNMI streaming telemetry + Prometheus metrics
- [ ] Intelligent RCA engine
- [ ] React/TypeScript frontend migration
- [ ] NetBox / Nautobot integration
- [ ] >80% test coverage
