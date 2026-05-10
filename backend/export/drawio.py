"""
draw.io / diagrams.net XML topology export.

Generates a .drawio file (XML) from a NetDesign AI design state.
The file can be opened directly in draw.io desktop, Confluence,
or imported into Lucidchart / Visio via the draw.io plugin.

Supported topology types: campus, dc-spine-leaf, gpu-fabric, wan
"""

from __future__ import annotations
import html
import math
import uuid
from typing import Any


# ── Icon map: role → draw.io shape ──────────────────────────────────────────

_SHAPE: dict[str, str] = {
    "spine":          "mxgraph.cisco.routers.router",
    "leaf":           "mxgraph.cisco.switches.workgroup_switch",
    "core":           "mxgraph.cisco.switches.layer_3_switch",
    "distribution":   "mxgraph.cisco.switches.workgroup_switch",
    "access":         "mxgraph.cisco.switches.catalyst_702x_702x",
    "firewall":       "mxgraph.cisco.firewalls.firewall",
    "gpu-spine":      "mxgraph.cisco.routers.router",
    "gpu-tor":        "mxgraph.cisco.switches.workgroup_switch",
    "wan-router":     "mxgraph.cisco.routers.router",
    "load-balancer":  "mxgraph.cisco.servers.standard_server",
    "default":        "mxgraph.cisco.switches.workgroup_switch",
}

_COLOR: dict[str, str] = {
    "spine":        "#dae8fc",   # light blue
    "leaf":         "#d5e8d4",   # light green
    "core":         "#fff2cc",   # light yellow
    "distribution": "#ffe6cc",   # light orange
    "access":       "#f8cecc",   # light red
    "firewall":     "#e1d5e7",   # light purple
    "gpu-spine":    "#dae8fc",
    "gpu-tor":      "#d5e8d4",
    "default":      "#f5f5f5",
}


def _eid() -> str:
    return str(uuid.uuid4()).replace("-", "")[:16]


def _cell(cell_id: str, value: str, style: str, x: int, y: int, w: int = 80, h: int = 60) -> str:
    v = html.escape(value)
    return (
        f'<mxCell id="{cell_id}" value="{v}" style="{style}" '
        f'vertex="1" parent="1">'
        f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
        f'</mxCell>\n'
    )


def _edge(edge_id: str, src: str, tgt: str, label: str = "") -> str:
    v = html.escape(label)
    return (
        f'<mxCell id="{edge_id}" value="{v}" '
        f'style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;" '
        f'edge="1" source="{src}" target="{tgt}" parent="1">'
        f'<mxGeometry relative="1" as="geometry"/>'
        f'</mxCell>\n'
    )


def _node_style(role: str) -> str:
    shape = _SHAPE.get(role, _SHAPE["default"])
    color = _COLOR.get(role, _COLOR["default"])
    return (
        f"shape={shape};fillColor={color};strokeColor=#666666;"
        f"fontStyle=1;fontSize=10;verticalLabelPosition=bottom;verticalAlign=top;"
    )


# ── Layout helpers ────────────────────────────────────────────────────────────

def _row_positions(count: int, y: int, x_start: int = 100, gap: int = 140) -> list[tuple[int, int]]:
    total_w = (count - 1) * gap
    start   = x_start + (800 - total_w) // 2
    return [(start + i * gap, y) for i in range(count)]


# ── Main export function ──────────────────────────────────────────────────────

def generate_drawio(state: dict[str, Any], ip_plan: dict | None = None) -> str:
    """
    Generate a draw.io XML string from a design state dict.
    """
    use_case = state.get("uc", "campus")
    org_name = html.escape(state.get("orgName", "Network Design"))

    cells  = ""
    layers: dict[str, list[dict]] = _build_layers(state)

    node_ids: dict[str, str] = {}   # hostname → cell id

    y_positions = {
        "firewall":     80,
        "core":         220,
        "spine":        220,
        "gpu-spine":    220,
        "distribution": 360,
        "leaf":         360,
        "access":       500,
        "gpu-tor":      500,
    }

    for role, devices in layers.items():
        y = y_positions.get(role, 500)
        positions = _row_positions(len(devices), y)
        for dev, (x, y_pos) in zip(devices, positions):
            cid = _eid()
            node_ids[dev["hostname"]] = cid
            label = f"{dev['hostname']}\n{dev.get('ip','')}"
            cells += _cell(cid, label, _node_style(role), x, y_pos)

    # Draw links based on canonical topology rules
    cells += _draw_links(layers, node_ids, use_case, state)

    # Legend
    cells += _legend(layers, use_case)

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1"
  connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827"
  math="0" shadow="0">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="title" value="{org_name} — Network Topology" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontSize=16;fontStyle=1;" vertex="1" parent="1">
      <mxGeometry x="200" y="10" width="600" height="40" as="geometry"/>
    </mxCell>
{cells}  </root>
</mxGraphModel>"""
    return xml


def _build_layers(state: dict) -> dict[str, list[dict]]:
    """Build layer→devices mapping from capacity counts in state."""
    uc = state.get("uc", "campus")
    layers: dict[str, list[dict]] = {}

    def _devs(role: str, prefix: str, count: int, platform: str = "nxos") -> list[dict]:
        return [{"hostname": f"{prefix}{i+1:02d}", "role": role, "platform": platform}
                for i in range(min(count, 20))]   # cap display at 20 per layer

    if uc in ("campus", "enterprise"):
        layers["firewall"]     = _devs("firewall",     "FW-",    state.get("numFirewalls", 1), "ios_xe")
        layers["core"]         = _devs("core",         "CORE-",  state.get("numCore", 2),      "ios_xe")
        layers["distribution"] = _devs("distribution", "DIST-",  state.get("numDist", 4),      "ios_xe")
        layers["access"]       = _devs("access",       "ACC-",   state.get("numAccess", 8),    "ios_xe")
    elif uc in ("datacenter", "dc"):
        layers["firewall"] = _devs("firewall", "FW-",    state.get("numFirewalls", 2), "palo_alto")
        layers["spine"]    = _devs("spine",    "SPINE-", state.get("numSpine", 2),     "nxos")
        layers["leaf"]     = _devs("leaf",     "LEAF-",  state.get("numLeaf", 8),      "nxos")
    elif uc in ("gpu", "ai_fabric"):
        layers["gpu-spine"] = _devs("gpu-spine", "GPUSPINE-", state.get("numSpine", 2),  "sonic")
        layers["gpu-tor"]   = _devs("gpu-tor",   "TOR-",      state.get("numLeaf", 8),   "sonic")
    else:
        layers["core"]   = _devs("core",   "CORE-", state.get("numCore", 2),  "ios_xe")
        layers["access"] = _devs("access", "ACC-",  state.get("numAccess", 4),"ios_xe")

    return {k: v for k, v in layers.items() if v}


def _draw_links(layers: dict, node_ids: dict, use_case: str, state: dict) -> str:
    cells = ""
    role_order = ["firewall", "core", "spine", "gpu-spine", "distribution", "leaf", "access", "gpu-tor"]
    roles = [r for r in role_order if r in layers]

    for i in range(len(roles) - 1):
        upper_role = roles[i]
        lower_role = roles[i + 1]
        upper_devs = layers[upper_role]
        lower_devs = layers[lower_role]

        # Full mesh between adjacent tiers (capped at 6×6 for readability)
        for u in upper_devs[:6]:
            uid = node_ids.get(u["hostname"])
            for d in lower_devs[:6]:
                did = node_ids.get(d["hostname"])
                if uid and did:
                    label = state.get("bwPerServer", "") or ""
                    cells += _edge(_eid(), uid, did, label)

    return cells


def _legend(layers: dict, use_case: str) -> str:
    items = ""
    y = 680
    x = 50
    for role in layers:
        if not layers[role]:
            continue
        color = _COLOR.get(role, _COLOR["default"])
        style = f"rounded=1;fillColor={color};strokeColor=#666666;fontSize=9;fontStyle=1;"
        eid   = _eid()
        items += f'<mxCell id="{eid}" value="{role.title()} ({len(layers[role])})" style="{style}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="110" height="28" as="geometry"/></mxCell>\n'
        x += 120
    return items
