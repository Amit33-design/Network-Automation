"""
VLAN Policy Generator
======================
Generates a comprehensive VLAN database with:
  - Standard VLAN-ID assignments per use case
  - STP root bridge priority per VLAN
  - VLAN access-maps (traffic filtering inside VLANs)
  - Private VLAN (PVLAN) for server isolation
  - VLAN pruning lists for trunks
  - Voice VLAN, IoT VLAN, Guest VLAN, Quarantine VLAN

Standard VLAN plan:
  Campus:
    10   DATA          (user workstations)
    20   VOICE         (IP telephony)
    30   PRINTERS      (print servers)
    40   WIFI-CORP     (802.1X enterprise SSID)
    50   WIFI-GUEST    (captive portal)
    60   IOT           (IoT devices / MAB)
    70   SECURITY      (cameras, badge readers)
    99   MGMT          (device management)
    998  AUTHFAIL      (802.1X failure)
    999  QUARANTINE    (guest / default)

  Data Center:
    100  MGMT          (out-of-band management)
    200  STORAGE       (iSCSI / NFS)
    300  VMOTION       (VMware vMotion)
    400  VMDATA        (VM data plane)
    500  BACKUP        (backup traffic)
    600  DMZ           (perimeter DMZ)

  GPU Fabric:
    100  MGMT
    200  GPU-COMPUTE   (RDMA / RoCE)
    300  GPU-STORAGE   (NVMe-oF)
    400  GPU-INBAND    (in-band management)

Platforms: ios-xe, nxos, eos, junos
"""
from __future__ import annotations
from typing import Any

# ── VLAN databases ────────────────────────────────────────────────────────

CAMPUS_VLANS = [
    {"id":  10, "name": "DATA",        "desc": "User workstations"},
    {"id":  20, "name": "VOICE",       "desc": "IP telephony (CDP/LLDP auto)"},
    {"id":  30, "name": "PRINTERS",    "desc": "Network printers"},
    {"id":  40, "name": "WIFI-CORP",   "desc": "Corporate 802.1X SSID"},
    {"id":  50, "name": "WIFI-GUEST",  "desc": "Guest captive portal"},
    {"id":  60, "name": "IOT",         "desc": "IoT / MAB authenticated"},
    {"id":  70, "name": "SECURITY",    "desc": "Cameras and badge readers"},
    {"id":  80, "name": "SERVERS",     "desc": "On-premise servers"},
    {"id":  99, "name": "MGMT",        "desc": "OOB device management"},
    {"id": 998, "name": "AUTHFAIL",    "desc": "802.1X auth-failure holding"},
    {"id": 999, "name": "QUARANTINE",  "desc": "Default / untagged / quarantine"},
]

DC_VLANS = [
    {"id": 100, "name": "MGMT",        "desc": "Out-of-band management"},
    {"id": 200, "name": "STORAGE",     "desc": "iSCSI / NFS storage"},
    {"id": 300, "name": "VMOTION",     "desc": "VMware vMotion"},
    {"id": 400, "name": "VMDATA",      "desc": "VM data plane"},
    {"id": 500, "name": "BACKUP",      "desc": "Backup traffic"},
    {"id": 600, "name": "DMZ",         "desc": "Perimeter DMZ"},
    {"id": 700, "name": "REPLICATION", "desc": "DR / replication"},
]

GPU_VLANS = [
    {"id": 100, "name": "MGMT",         "desc": "GPU cluster management"},
    {"id": 200, "name": "GPU-COMPUTE",  "desc": "RDMA / RoCEv2 compute"},
    {"id": 300, "name": "GPU-STORAGE",  "desc": "NVMe-oF / storage"},
    {"id": 400, "name": "GPU-INBAND",   "desc": "In-band monitoring"},
]


def _vlan_list(ctx: dict) -> list[dict]:
    """Return appropriate VLAN list, merging user-defined VLANs."""
    uc = ctx.get("uc", "campus")
    user_vlans = ctx.get("vlans", [])

    if user_vlans:
        return user_vlans

    if uc in ("dc", "hybrid"):
        return DC_VLANS
    if uc == "gpu":
        return GPU_VLANS
    return CAMPUS_VLANS


def generate_vlan_policy(ctx: dict[str, Any], platform: str) -> str:
    """Return VLAN policy config block."""
    fn = {
        "ios-xe": _ios_xe_vlan,
        "nxos":   _nxos_vlan,
        "eos":    _eos_vlan,
        "junos":  _junos_vlan,
        "sonic":  _sonic_vlan,
    }.get(platform, _ios_xe_vlan)
    return fn(ctx)


# ── IOS-XE ───────────────────────────────────────────────────────────────

def _ios_xe_vlan(ctx: dict) -> str:
    layer  = ctx.get("layer", "campus-access")
    uc     = ctx.get("uc", "campus")
    vlans  = _vlan_list(ctx)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════╗",
        "!-- ║   VLAN POLICY — IOS-XE               ║",
        "!-- ╚══════════════════════════════════════╝",
        "!",
        "!-- VLAN Database",
    ]

    for v in vlans:
        lines += [
            f"vlan {v['id']}",
            f" name {v['name']}",
        ]
    lines.append("!")

    # STP root bridge / secondary
    if "core" in layer or "dist" in layer or "spine" in layer:
        lines.append("!-- STP — this device is ROOT for all VLANs")
        lines.append("spanning-tree mode rapid-pvst")
        lines.append("spanning-tree extend system-id")
        for v in vlans:
            lines.append(f"spanning-tree vlan {v['id']} priority 4096")
        lines.append("!")
    elif "access" in layer:
        lines.append("!-- STP — access layer: PortFast on access ports, not root")
        lines.append("spanning-tree mode rapid-pvst")
        lines.append("spanning-tree extend system-id")
        for v in vlans:
            lines.append(f"spanning-tree vlan {v['id']} priority 32768")
        lines.append("!")

    # VLAN access-maps for campus (filter inter-VLAN via VACL)
    if uc == "campus" and ("core" in layer or "dist" in layer):
        lines += [
            "!-- VLAN Access-Maps (VACLs) — block IoT from reaching DATA",
            "ip access-list extended BLOCK-IOT-TO-DATA",
            " deny ip 192.168.60.0 0.0.0.255 192.168.10.0 0.0.0.255 log",
            " permit ip any any",
            "!",
            "vlan access-map VACL-IOT-ISOLATION 10",
            " match ip address BLOCK-IOT-TO-DATA",
            " action drop",
            "vlan access-map VACL-IOT-ISOLATION 20",
            " action forward",
            "!",
            "vlan filter VACL-IOT-ISOLATION vlan-list 60",
            "!",
            "!-- Private VLAN — server isolation",
            "vlan 80",
            " private-vlan primary",
            "vlan 81",
            " private-vlan community",
            "vlan 82",
            " private-vlan isolated",
            "!",
            "vlan 80",
            " private-vlan association 81,82",
            "!",
        ]

    # Management VLAN SVI
    mgmt_vlan = 99 if uc == "campus" else 100
    mgmt_ip   = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_mask = ctx.get("mgmt_mask", "255.255.255.0")
    lines += [
        f"!-- Management SVI",
        f"interface Vlan{mgmt_vlan}",
        f" description MGMT-SVI",
        f" ip address {mgmt_ip} {mgmt_mask}",
        " no shutdown",
        " ip helper-address 10.100.0.10",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_vlan(ctx: dict) -> str:
    uc    = ctx.get("uc", "dc")
    vlans = _vlan_list(ctx)

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════════╗",
        "!-- ║   VLAN POLICY — NX-OS                ║",
        "!-- ╚══════════════════════════════════════╝",
        "!",
    ]

    for v in vlans:
        lines += [
            f"vlan {v['id']}",
            f"  name {v['name']}",
            f"  state active",
        ]
    lines.append("!")

    # VN-Segment (VXLAN VNI) mapping for DC
    if uc in ("dc", "hybrid", "gpu"):
        vni_base = ctx.get("vxlan_vni_base", 10000)
        lines.append("!-- VXLAN VNI mapping")
        for i, v in enumerate(vlans):
            vni = vni_base + v["id"]
            lines += [
                f"vlan {v['id']}",
                f"  vn-segment {vni}",
            ]
        lines.append("!")

    # Management SVI
    mgmt_ip = ctx.get("mgmt_ip", "10.100.1.1")
    mgmt_vlan = 100
    lines += [
        f"interface Vlan{mgmt_vlan}",
        f"  description MGMT-SVI",
        f"  ip address {mgmt_ip}/24",
        "  no shutdown",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── EOS ──────────────────────────────────────────────────────────────────

def _eos_vlan(ctx: dict) -> str:
    vlans  = _vlan_list(ctx)
    uc     = ctx.get("uc", "dc")
    mgmt_ip= ctx.get("mgmt_ip", "10.100.1.1")

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════════╗",
        "! ║   VLAN POLICY — Arista EOS           ║",
        "! ╚══════════════════════════════════════╝",
        "!",
    ]

    for v in vlans:
        lines += [
            f"vlan {v['id']}",
            f"   name {v['name']}",
        ]
    lines.append("!")

    # VXLAN VNI
    if uc in ("dc", "hybrid", "gpu"):
        vni_base = ctx.get("vxlan_vni_base", 10000)
        lines.append("!-- VXLAN VNI mapping")
        lines.append("interface Vxlan1")
        for v in vlans:
            vni = vni_base + v["id"]
            lines.append(f"   vxlan vlan {v['id']} vni {vni}")
        lines.append("!")

    # MLAG (if HA)
    if ctx.get("redundancy", "") in ("ha", "full"):
        lines += [
            "!-- MLAG configuration",
            "mlag configuration",
            f"   domain-id MLAG-DOMAIN-{ctx.get('index', 1)}",
            "   local-interface Vlan4094",
            "   peer-address 10.255.255.2",
            "   peer-link Port-Channel999",
            "!",
        ]

    lines += [
        f"interface Vlan{100 if uc in ('dc','gpu') else 99}",
        f"   description MGMT-SVI",
        f"   ip address {mgmt_ip}/24",
        "   no shutdown",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos ─────────────────────────────────────────────────────────────────

def _junos_vlan(ctx: dict) -> str:
    vlans = _vlan_list(ctx)

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════════╗",
        "# ║   VLAN POLICY — Junos                ║",
        "# ╚══════════════════════════════════════╝",
        "#",
        "vlans {",
    ]
    for v in vlans:
        lines += [
            f"    {v['name']} {{",
            f"        vlan-id {v['id']};",
            f"        description \"{v.get('desc', v['name'])}\";",
            "    }",
        ]
    lines += [
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ─────────────────────────────────────────────────────────────────

def _sonic_vlan(ctx: dict) -> str:
    vlans = _vlan_list(ctx)

    lines: list[str] = []
    lines += [
        "!",
        "! SONiC VLAN config — via CONFIG_DB or sonic-cli",
        "!",
    ]
    for v in vlans:
        lines += [
            f"! config vlan add {v['id']}",
            f"! config interface ip add Vlan{v['id']} <IP/prefix>",
        ]
    lines.append("!")

    return "\n".join(lines) + "\n"
