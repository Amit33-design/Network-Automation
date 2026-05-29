"""Config generation engine — renders Jinja2 templates for each device."""

import os
from pathlib import Path
from typing import Dict, List, Optional

try:
    from jinja2 import Environment, FileSystemLoader, StrictUndefined
    HAS_JINJA2 = True
except ImportError:
    HAS_JINJA2 = False

from ..models import Fabric, Spine, Leaf

TEMPLATE_DIR = Path(__file__).parent / "templates"


class ConfigBuilder:
    def __init__(self, fabric: Fabric, template_dir: Optional[Path] = None):
        self.fabric = fabric
        self.template_dir = template_dir or TEMPLATE_DIR
        if HAS_JINJA2:
            self.env = Environment(
                loader=FileSystemLoader(str(self.template_dir)),
                undefined=StrictUndefined,
                trim_blocks=True,
                lstrip_blocks=True,
            )
        else:
            self.env = None

    def _render(self, template_name: str, ctx: dict) -> str:
        if not HAS_JINJA2:
            raise RuntimeError("jinja2 is required for config generation: pip install jinja2")
        tmpl = self.env.get_template(template_name)
        return tmpl.render(**ctx)

    def build_spine_config(self, spine: Spine) -> str:
        return self._render("nxos_spine.j2", {
            "spine": spine,
            "leaves": self.fabric.leaves,
            "fabric": self.fabric,
        })

    def build_leaf_config(self, leaf: Leaf) -> str:
        return self._render("nxos_leaf.j2", {
            "leaf": leaf,
            "spines": self.fabric.spines,
            "fabric": self.fabric,
        })

    def build_qos_config(self) -> str:
        return self._render("nxos_rocev2_qos.j2", {
            "rocev2": self.fabric.rocev2,
        })

    def build_all(self) -> Dict[str, str]:
        """Return dict of device_name → config string for every device."""
        configs = {}

        qos = self.build_qos_config()

        for spine in self.fabric.spines:
            configs[spine.name] = self.build_spine_config(spine)

        for leaf in self.fabric.leaves:
            # Leaf config = VXLAN/EVPN body + RoCEv2 QoS appended
            configs[leaf.name] = self.build_leaf_config(leaf) + "\n\n" + qos

        return configs

    def save_all(self, output_dir: str) -> List[str]:
        """Write per-device config files to output_dir. Returns list of file paths."""
        os.makedirs(output_dir, exist_ok=True)
        configs = self.build_all()
        paths = []
        for name, cfg in configs.items():
            path = os.path.join(output_dir, f"{name}.cfg")
            with open(path, "w") as f:
                f.write(cfg)
            paths.append(path)
        return paths
