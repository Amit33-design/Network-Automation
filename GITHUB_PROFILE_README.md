<div align="center">

# Amit Tiwari
### Senior Network & Security Engineer

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Amit_Tiwari-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/amit-tiwari-65051b44)
[![Email](https://img.shields.io/badge/Email-atiwari824@gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:atiwari824@gmail.com)
[![Location](https://img.shields.io/badge/Seattle%2C_WA-USA-4285F4?style=for-the-badge&logo=googlemaps&logoColor=white)](#)

</div>

---

## About Me

Network Development Engineer II at **Amazon Web Services**, designing and securing hyperscale cloud infrastructure at **petabit-scale** (~1,000 Tbps annual capacity delivery). 13+ years spanning hyperscale cloud, AI/GPU cluster networking, data center fabric engineering, and enterprise security across AWS, Carnival Cruise Lines, British Telecom, and IBM.

```text
Focus Areas  →  BGP/EVPN fabric · RoCEv2/RDMA GPU networking · Zero Trust · Network Automation
Current      →  AWS NDE II | Multi-region production edge networks
Pursuing     →  Palo Alto PCNSE · AWS Advanced Networking Specialty
```

---

## Core Expertise

### Routing & WAN
![BGP](https://img.shields.io/badge/BGP-iBGP%2FeBGP%2FECMP%2FRPKI-005C99?style=flat-square)
![OSPF](https://img.shields.io/badge/OSPF-Multi--Area%2FLSAs-005C99?style=flat-square)
![MPLS](https://img.shields.io/badge/MPLS-L3--VPN%2FDMVPN-005C99?style=flat-square)
![SD-WAN](https://img.shields.io/badge/SD--WAN-Design%2FPolicy-005C99?style=flat-square)
![IPSec](https://img.shields.io/badge/IPSec-IKEv2%2FVPN-005C99?style=flat-square)

### Data Center & Fabric
![VXLAN](https://img.shields.io/badge/VXLAN%2FEVPN-Type--2%2F5%20Routes-6B3FA0?style=flat-square)
![Spine-Leaf](https://img.shields.io/badge/Spine--Leaf-Anycast_GW-6B3FA0?style=flat-square)
![Nexus](https://img.shields.io/badge/Cisco_Nexus-9K%2F7K%2F5K%2FACI-6B3FA0?style=flat-square)
![Juniper QFX](https://img.shields.io/badge/Juniper-QFX%2FSeries-6B3FA0?style=flat-square)

### AI / GPU Networking
![RoCEv2](https://img.shields.io/badge/RoCEv2%2FRDMA-Lossless_Fabric-FF6B35?style=flat-square)
![PFC/ECN](https://img.shields.io/badge/PFC%2FECN-Congestion_Tuning-FF6B35?style=flat-square)
![OFED](https://img.shields.io/badge/OFED%2Fmlx5-GPUDirect_RDMA-FF6B35?style=flat-square)
![HPC](https://img.shields.io/badge/GPU_Cluster-HPC_Networking-FF6B35?style=flat-square)

### Network Security
![Palo Alto](https://img.shields.io/badge/Palo_Alto-PA--5520%20NGFW-E01A22?style=flat-square)
![Juniper SRX](https://img.shields.io/badge/Juniper-SRX%2FvSRX%2FIDP-E01A22?style=flat-square)
![Zero Trust](https://img.shields.io/badge/Zero_Trust-ZTNA%2FMicroseg-E01A22?style=flat-square)
![DDoS](https://img.shields.io/badge/DDoS-BGP_RTBH%2FScrubbing-E01A22?style=flat-square)
![AWS Security](https://img.shields.io/badge/AWS-Shield%2FGuardDuty%2FWAF-E01A22?style=flat-square)

### Cloud & Automation
![AWS](https://img.shields.io/badge/AWS-VPC%2FTGW%2FDirect_Connect-FF9900?style=flat-square&logo=amazonaws)
![Python](https://img.shields.io/badge/Python-Automation%2FTooling-3776AB?style=flat-square&logo=python&logoColor=white)
![Ansible](https://img.shields.io/badge/Ansible-Network_Config-EE0000?style=flat-square&logo=ansible&logoColor=white)
![Netconf](https://img.shields.io/badge/Netconf%2FYANG-Telemetry-3776AB?style=flat-square)

### Load Balancing & OS
![F5](https://img.shields.io/badge/F5-LTM%2FGTM%2FiRules-CC0000?style=flat-square)
![Linux](https://img.shields.io/badge/Linux-RHEL%2FUbuntu%2Ftcpdump-FCC624?style=flat-square&logo=linux&logoColor=black)

---

## Experience Highlights

| Period | Role | Company |
|--------|------|---------|
| Dec 2024 – Present | **Network Development Engineer II** | Amazon Web Services |
| Mar 2022 – Dec 2024 | Network Development Engineer I | Amazon Web Services |
| Sep 2017 – Mar 2022 | Principal Network Engineer | Hughes Systique / Carnival Cruise Lines |
| Apr 2015 – Sep 2017 | Network Support / Project Engineer | British Telecom / Royal Bank of Scotland |
| Dec 2012 – Apr 2015 | Senior Practitioner – Network Operations | IBM India |

### Key Wins
- **~1,000 Tbps** new capacity delivered annually across multi-region AWS edge networks
- **40%+ toil reduction** via Python/Ansible pipelines (security compliance checks, EVPN validation, alerting)
- **200+ stale firewall rules** eliminated across production regions through quarterly audits
- **60% reduction** in unauthorized lateral movement incidents at Carnival via Palo Alto NGFW + Zero Trust zones
- **35% lower east-west latency** after VXLAN/EVPN spine-leaf migration at Carnival data centers
- **99.99% uptime SLA** across 100+ vessels and 50,000+ daily users in maritime environments
- **1,000+ switches** zero-touch provisioned via Cisco DNA Center (weeks → hours)

---

## Certifications

| Certification | Status |
|---|---|
| Cisco CCNP — Routing & Switching | ✅ Achieved |
| Cisco CCNA — Routing & Switching | ✅ Achieved |
| Palo Alto PCNSE | 🎯 In Progress |
| AWS Certified Advanced Networking – Specialty | 🎯 In Progress |

---

## Featured Projects

### [Network Port Scanner](https://github.com/Amit33-design/Network-Automation)
> Internal network scanner — discovers live hosts across subnets, scans TCP/UDP ports, detects HTTP/HTTPS services with banner grabbing. Built in Python with concurrent scanning, JSON/CSV/text output, and a clean CLI.

```bash
netscan discover                     # auto-detect local segments
netscan scan 192.168.1.0/24          # scan a subnet
netscan host 10.0.0.1 --no-udp      # scan a single host
```

---

## GitHub Stats

<div align="center">

![Amit's GitHub Stats](https://github-readme-stats.vercel.app/api?username=Amit33-design&show_icons=true&theme=dark&hide_border=true&include_all_commits=true)
&nbsp;
![Top Languages](https://github-readme-stats.vercel.app/api/top-langs/?username=Amit33-design&layout=compact&theme=dark&hide_border=true)

</div>

---

## Open To

`Senior Network Security Engineer` · `Senior Network Development Engineer` · `Principal Network Engineer` · `Senior Infrastructure / AI Networking Engineer`

---

<div align="center">

*"Automate the toil. Harden the perimeter. Scale the fabric."*

[![LinkedIn](https://img.shields.io/badge/Let's_Connect-LinkedIn-0A66C2?style=for-the-badge&logo=linkedin)](https://linkedin.com/in/amit-tiwari-65051b44)

</div>
