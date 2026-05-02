"""
QoS Policy Generator
======================
Generates platform-appropriate QoS config per use case:
  campus  — 8-class Cisco QoS (voice EF, video AF41, signaling CS3, data BE)
  dc      — DSCP-based marking, PFC queues for storage/RDMA
  gpu     — PFC priority 3+4, ECN, DCQCN for RoCEv2
  wan     — Traffic shaping, LLQ, CBWFQ

Platforms: ios-xe, nxos, eos, junos, sonic
"""
from __future__ import annotations
from typing import Any


def generate_qos(ctx: dict[str, Any], platform: str) -> str:
    """Return QoS config block for device context + platform."""
    fn = {
        "ios-xe": _ios_xe_qos,
        "nxos":   _nxos_qos,
        "eos":    _eos_qos,
        "junos":  _junos_qos,
        "sonic":  _sonic_qos,
    }.get(platform, _ios_xe_qos)
    return fn(ctx)


# ── IOS-XE ──────────────────────────────────────────────────────────────

def _ios_xe_qos(ctx: dict) -> str:
    uc    = ctx.get("uc", "campus")
    layer = ctx.get("layer", "campus-access")

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════╗",
        "!-- ║   QoS POLICY — IOS-XE            ║",
        "!-- ╚══════════════════════════════════╝",
        "!",
    ]

    if uc == "campus" or layer.startswith("campus"):
        # 8-class campus QoS model
        lines += [
            "!-- Class Maps",
            "class-map match-any CM-VOICE",
            " match ip dscp ef",
            " description VoIP RTP (EF/46)",
            "class-map match-any CM-VOICE-SIGNALING",
            " match ip dscp cs3",
            " description SIP/SCCP signaling (CS3/24)",
            "class-map match-any CM-INTERACTIVE-VIDEO",
            " match ip dscp af41",
            " description Cisco TelePresence / Video (AF41/34)",
            "class-map match-any CM-STREAMING-VIDEO",
            " match ip dscp cs4",
            " description Streaming Video (CS4/32)",
            "class-map match-any CM-CRITICAL-DATA",
            " match ip dscp af21 af22 af23",
            " description Business-critical apps (AF2x)",
            "class-map match-any CM-BULK-DATA",
            " match ip dscp af11 af12 af13",
            " description Bulk / backup data (AF1x)",
            "class-map match-any CM-SCAVENGER",
            " match ip dscp cs1",
            " description Scavenger / P2P (CS1/8)",
            "class-map match-any CM-NETWORK-MGMT",
            " match ip dscp cs2",
            " description SNMP / NTP / Syslog (CS2/16)",
            "!",
            "!-- Access-layer marking policy (ingress)",
            "policy-map PM-CAMPUS-ACCESS-INGRESS",
            " class CM-VOICE",
            "  set dscp ef",
            "  police rate 128 kbps burst 8000",
            "   conform-action transmit",
            "   exceed-action drop",
            " class CM-VOICE-SIGNALING",
            "  set dscp cs3",
            " class CM-INTERACTIVE-VIDEO",
            "  set dscp af41",
            " class class-default",
            "  set dscp default",
            "!",
            "!-- Distribution/Core queuing policy (egress)",
            "policy-map PM-CAMPUS-QUEUING-EGRESS",
            " class CM-VOICE",
            "  priority percent 15",
            "  police rate percent 15",
            "   conform-action transmit",
            "   exceed-action drop",
            " class CM-INTERACTIVE-VIDEO",
            "  bandwidth percent 15",
            "  queue-limit 20 ms",
            " class CM-VOICE-SIGNALING",
            "  bandwidth percent 5",
            " class CM-STREAMING-VIDEO",
            "  bandwidth percent 10",
            " class CM-CRITICAL-DATA",
            "  bandwidth percent 20",
            "  fair-queue",
            " class CM-BULK-DATA",
            "  bandwidth percent 10",
            "  fair-queue",
            " class CM-SCAVENGER",
            "  bandwidth percent 1",
            " class class-default",
            "  bandwidth percent 24",
            "  fair-queue",
            "!",
        ]

    elif uc in ("dc", "hybrid"):
        lines += [
            "!-- DC QoS — DSCP trust + lossless storage",
            "mls qos trust dscp",
            "!",
            "class-map match-any CM-STORAGE",
            " match ip dscp 40",
            " description NFS/iSCSI storage (CS5)",
            "class-map match-any CM-RDMA",
            " match ip dscp 26",
            " description RoCE/RDMA (AF31)",
            "class-map match-any CM-NETWORK-CTRL",
            " match ip dscp cs6 cs7",
            " description Routing protocols",
            "class-map match-any CM-DC-DATA",
            " match ip dscp af21 af22",
            "!",
            "policy-map PM-DC-EGRESS",
            " class CM-NETWORK-CTRL",
            "  priority level 1 percent 5",
            " class CM-STORAGE",
            "  priority level 2 percent 30",
            " class CM-RDMA",
            "  bandwidth percent 25",
            "  queue-limit 512 bytes",
            " class CM-DC-DATA",
            "  bandwidth percent 25",
            "  fair-queue",
            " class class-default",
            "  bandwidth percent 15",
            "  fair-queue",
            "!",
        ]

    elif uc == "wan":
        lines += [
            "!-- WAN QoS — LLQ + CBWFQ + traffic shaping",
            "class-map match-any CM-WAN-VOICE",
            " match ip dscp ef",
            "class-map match-any CM-WAN-VIDEO",
            " match ip dscp af41",
            "class-map match-any CM-WAN-CRITICAL",
            " match ip dscp af21 af22 af23",
            "class-map match-any CM-WAN-BEST-EFFORT",
            " match ip dscp default",
            "!",
            "policy-map PM-WAN-CHILD",
            " class CM-WAN-VOICE",
            "  priority 512",
            "  police 512000",
            " class CM-WAN-VIDEO",
            "  bandwidth percent 20",
            " class CM-WAN-CRITICAL",
            "  bandwidth percent 30",
            "  fair-queue",
            " class class-default",
            "  bandwidth percent 25",
            "  fair-queue",
            "!",
            "policy-map PM-WAN-SHAPER",
            " class class-default",
            "  shape average 10000000",
            "  service-policy PM-WAN-CHILD",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── NX-OS ────────────────────────────────────────────────────────────────

def _nxos_qos(ctx: dict) -> str:
    uc  = ctx.get("uc", "dc")
    gpu = ctx.get("roce_enabled", False) or uc == "gpu"

    lines: list[str] = []
    lines += [
        "!",
        "!-- ╔══════════════════════════════════╗",
        "!-- ║   QoS POLICY — NX-OS             ║",
        "!-- ╚══════════════════════════════════╝",
        "!",
        "!-- DSCP-to-Queue mapping",
        "class-map type qos match-any QOS-NETWORK-CTRL",
        "  match dscp cs6 cs7",
        "class-map type qos match-any QOS-STORAGE",
        "  match dscp cs5",
        "class-map type qos match-any QOS-RDMA",
        "  match dscp af31",
        "class-map type qos match-any QOS-BUSINESS",
        "  match dscp af21 af22",
        "class-map type qos match-any QOS-BEST-EFFORT",
        "  match dscp default",
        "!",
        "policy-map type qos QOS-CLASSIFY",
        "  class QOS-NETWORK-CTRL",
        "    set qos-group 7",
        "  class QOS-STORAGE",
        "    set qos-group 4",
        "  class QOS-RDMA",
        "    set qos-group 3",
        "  class QOS-BUSINESS",
        "    set qos-group 2",
        "  class QOS-BEST-EFFORT",
        "    set qos-group 0",
        "!",
        "class-map type queuing QUEUE-7",
        "  match qos-group 7",
        "class-map type queuing QUEUE-4",
        "  match qos-group 4",
        "class-map type queuing QUEUE-3",
        "  match qos-group 3",
        "class-map type queuing QUEUE-2",
        "  match qos-group 2",
        "class-map type queuing QUEUE-0",
        "  match qos-group 0",
        "!",
        "policy-map type queuing EGRESS-QUEUING",
        "  class QUEUE-7",
        "    priority level 1",
        "    bandwidth percent 5",
        "  class QUEUE-4",
        "    bandwidth percent 30",
        "    random-detect dscp-based",
        "  class QUEUE-3",
        "    bandwidth percent 25",
        "    pause no-drop",
        "  class QUEUE-2",
        "    bandwidth percent 20",
        "  class QUEUE-0",
        "    bandwidth percent 20",
        "!",
    ]

    if gpu:
        lines += [
            "!-- PFC for RoCEv2 lossless queues",
            "class-map type network-qos QOS-PFC-3",
            "  match qos-group 3",
            "class-map type network-qos QOS-PFC-4",
            "  match qos-group 4",
            "!",
            "policy-map type network-qos NETWORK-QOS-POLICY",
            "  class QOS-PFC-3",
            "    pause no-drop",
            "    mtu 9216",
            "  class QOS-PFC-4",
            "    pause no-drop",
            "    mtu 9216",
            "  class class-default",
            "    mtu 9216",
            "!",
            "system qos",
            "  service-policy type qos input QOS-CLASSIFY",
            "  service-policy type queuing output EGRESS-QUEUING",
            "  service-policy type network-qos NETWORK-QOS-POLICY",
            "!",
        ]

    return "\n".join(lines) + "\n"


# ── EOS ─────────────────────────────────────────────────────────────────

def _eos_qos(ctx: dict) -> str:
    uc  = ctx.get("uc", "dc")
    gpu = ctx.get("roce_enabled", False) or uc == "gpu"

    lines: list[str] = []
    lines += [
        "!",
        "! ╔══════════════════════════════════╗",
        "! ║   QoS POLICY — Arista EOS        ║",
        "! ╚══════════════════════════════════╝",
        "!",
        "qos map dscp 46 to traffic-class 7",
        "qos map dscp 40 to traffic-class 6",
        "qos map dscp 26 to traffic-class 5",
        "qos map dscp 34 to traffic-class 4",
        "qos map dscp 18 to traffic-class 3",
        "qos map dscp 16 to traffic-class 2",
        "qos map dscp 0 to traffic-class 0",
        "!",
        "qos map traffic-class 7 to dscp 46",
        "qos map traffic-class 5 to dscp 26",
        "!",
    ]

    if gpu:
        lines += [
            "!-- PFC for RoCEv2 (queues 3 and 4)",
            "priority-flow-control mode on",
            "priority-flow-control priority 3 no-drop",
            "priority-flow-control priority 4 no-drop",
            "!",
            "!-- ECN for DCQCN",
            "queue-monitor ecn",
            "  ecn dscp 26",
            "  ecn dscp 34",
            "!",
            "!-- Watchdog (lossless flow safety)",
            "hardware counter feature priority-flow-control out",
            "!",
        ]

    lines += [
        "!-- Apply to fabric interfaces (example)",
        "! interface Ethernet1",
        "!   qos trust dscp",
        "!",
    ]

    return "\n".join(lines) + "\n"


# ── Junos ────────────────────────────────────────────────────────────────

def _junos_qos(ctx: dict) -> str:
    uc = ctx.get("uc", "dc")

    lines: list[str] = []
    lines += [
        "#",
        "# ╔══════════════════════════════════╗",
        "# ║   QoS POLICY — Junos             ║",
        "# ╚══════════════════════════════════╝",
        "#",
        "class-of-service {",
        "    classifiers {",
        "        dscp DSCP-CLASSIFIER {",
        "            forwarding-class NETWORK-CTRL {",
        "                loss-priority low code-points [ cs6 cs7 ];",
        "            }",
        "            forwarding-class EXPEDITED {",
        "                loss-priority low code-points ef;",
        "            }",
        "            forwarding-class ASSURED-1 {",
        "                loss-priority low code-points [ af41 af42 ];",
        "            }",
        "            forwarding-class ASSURED-2 {",
        "                loss-priority medium-low code-points [ af21 af22 ];",
        "            }",
        "            forwarding-class BEST-EFFORT {",
        "                loss-priority high code-points be;",
        "            }",
        "        }",
        "    }",
        "    drop-profiles {",
        "        DP-ASSURED {",
        "            interpolate {",
        "                fill-level [  0 25 50 75 100 ];",
        "                drop-probability [ 0 0 10 50 100 ];",
        "            }",
        "        }",
        "    }",
        "    scheduling-maps {",
        "        SM-DEFAULT {",
        "            forwarding-class NETWORK-CTRL {",
        "                priority strict-high;",
        "            }",
        "            forwarding-class EXPEDITED {",
        "                priority strict-high;",
        "                transmit-rate percent 15;",
        "            }",
        "            forwarding-class ASSURED-1 {",
        "                priority high;",
        "                transmit-rate percent 20;",
        "            }",
        "            forwarding-class ASSURED-2 {",
        "                priority low;",
        "                transmit-rate percent 30;",
        "            }",
        "            forwarding-class BEST-EFFORT {",
        "                priority low;",
        "                transmit-rate remainder;",
        "            }",
        "        }",
        "    }",
        "}",
    ]

    return "\n".join(lines) + "\n"


# ── SONiC ────────────────────────────────────────────────────────────────

def _sonic_qos(ctx: dict) -> str:
    lines: list[str] = []
    lines += [
        "!",
        "! SONiC QoS — configure via CONFIG_DB JSON",
        "! Apply with: config qos reload",
        "!",
        "! DSCP_TO_TC_MAP: GPU-QOS-MAP",
        "!   DSCP 46 → TC 7 (VoIP/EF)",
        "!   DSCP 26 → TC 5 (RoCEv2/RDMA)",
        "!   DSCP 40 → TC 6 (NFS/Storage)",
        "!   DSCP 0  → TC 0 (Best Effort)",
        "!",
        "! TC_TO_QUEUE_MAP: GPU-TC-QUEUE",
        "!   TC 7 → Q7, TC 6 → Q6, TC 5 → Q5",
        "!",
        "! PFC_PRIORITY_TO_QUEUE_MAP: GPU-PFC-MAP",
        "!   PFC priority 3 → Q3 (lossless RDMA)",
        "!   PFC priority 4 → Q4 (lossless storage)",
        "!",
        "! SCHEDULER: WRRS + SP for Q7",
        "!   Q7: weight=100 type=STRICT",
        "!   Q5: weight=40  type=WRR",
        "!   Q3: weight=30  type=WRR",
        "!",
    ]
    return "\n".join(lines) + "\n"
