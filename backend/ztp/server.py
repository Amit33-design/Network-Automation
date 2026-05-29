"""
ZTP Server — Core Logic
========================
Manages device onboarding via Zero Touch Provisioning.

Supported protocols:
  IOS-XE   — Cisco Plug-and-Play (PnP) HTTP redirect + script URL
  NX-OS    — POAP (Power On Auto Provisioning) Python script
  EOS      — Arista ZTP (fetches startup-config or Python script)
  Junos    — Juniper ZTP (fetches config via DHCP option 67)
  SONiC    — ZTP JSON config

Workflow:
  1. Device boots → DHCP gives option 67 (bootfile-name) or option 43 (PnP)
  2. Device fetches: GET /ztp/bootstrap/{serial}  or  GET /ztp/script/{platform}
  3. Server looks up the serial in registry → returns Day 0 config
  4. Device applies config → POSTs /ztp/checkin/{serial} with status
  5. Server marks device as PROVISIONED, records timestamp

Device registry is in-memory + persisted to ztp_registry.json on writes.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from jinja2 import Environment, FileSystemLoader

log = logging.getLogger(__name__)


def _role_to_uc(role: str) -> str:
    """Map device role string to use-case key."""
    role = role.lower()
    if "campus" in role:
        return "campus"
    if "gpu" in role:
        return "gpu"
    if "wan" in role or "cpe" in role or "hub" in role:
        return "wan"
    if "dc" in role or "spine" in role or "leaf" in role:
        return "dc"
    return "campus"

REGISTRY_PATH  = Path(__file__).parent.parent / "ztp_registry.json"
TEMPLATE_DIR   = Path(__file__).parent / "templates"


# ── State machine ────────────────────────────────────────────────────────

class ZTPState(str, Enum):
    WAITING      = "waiting"        # registered, waiting for device contact
    CONTACTED    = "contacted"      # device fetched bootstrap
    PROVISIONING = "provisioning"   # device applying config
    PROVISIONED  = "provisioned"    # device checked in success
    FAILED       = "failed"         # device reported failure
    UNKNOWN      = "unknown"        # serial not in registry


# ── Device record ────────────────────────────────────────────────────────

@dataclass
class ZTPDevice:
    serial:      str
    hostname:    str
    platform:    str            # ios-xe | nxos | eos | junos | sonic
    role:        str            # campus-access | dc-leaf | dc-spine | etc.
    mgmt_ip:     str
    mgmt_mask:   str = "255.255.255.0"
    mgmt_gw:     str = ""
    loopback_ip: str = ""
    bgp_asn:     int = 65000
    vlans:       list = field(default_factory=list)
    state:       ZTPState = ZTPState.WAITING
    registered_at: float = field(default_factory=time.time)
    contacted_at:  Optional[float] = None
    provisioned_at: Optional[float] = None
    last_seen:     Optional[float] = None
    error:         Optional[str] = None
    # ── Policy baking flag ───────────────────────────────────────────────
    # When True: ZTP bootstrap = Day 0 minimal + ALL enabled policy blocks
    # When False: ZTP bootstrap = Day 0 minimal only (SSH + mgmt IP)
    # Individual policy flags in policy_flags override per-device
    bake_policies: bool = False
    policy_flags:  dict = field(default_factory=dict)
    # Extra context passed to Jinja2 template
    extra:         dict = field(default_factory=dict)


# ── ZTP Server ───────────────────────────────────────────────────────────

class ZTPServer:
    """In-memory + file-backed ZTP device registry."""

    def __init__(self) -> None:
        self._devices: dict[str, ZTPDevice] = {}
        self._jinja_envs: dict[str, Environment] = {}
        self._load_registry()

    # ── Registry persistence ─────────────────────────────────────────────

    def _load_registry(self) -> None:
        if REGISTRY_PATH.exists():
            try:
                data = json.loads(REGISTRY_PATH.read_text())
                for serial, rec in data.items():
                    rec["state"] = ZTPState(rec.get("state", "waiting"))
                    rec.setdefault("extra", {})
                    rec.setdefault("vlans", [])
                    self._devices[serial] = ZTPDevice(**rec)
                log.info("ZTP: loaded %d devices from registry", len(self._devices))
            except Exception as exc:
                log.warning("ZTP: failed to load registry: %s", exc)

    def _save_registry(self) -> None:
        try:
            data = {s: {**asdict(d), "state": d.state.value} for s, d in self._devices.items()}
            REGISTRY_PATH.write_text(json.dumps(data, indent=2))
        except Exception as exc:
            log.warning("ZTP: failed to save registry: %s", exc)

    # ── Device management ────────────────────────────────────────────────

    def register(self, device: ZTPDevice) -> ZTPDevice:
        """Register a device for ZTP onboarding."""
        self._devices[device.serial] = device
        self._save_registry()
        log.info("ZTP: registered %s (%s %s)", device.serial, device.platform, device.role)
        return device

    def register_bulk(self, devices: list[dict[str, Any]]) -> list[ZTPDevice]:
        """Bulk-register devices from a list of dicts."""
        result = []
        for d in devices:
            dev = ZTPDevice(
                serial      = d["serial"],
                hostname    = d.get("hostname", f"DEVICE-{d['serial'][-4:].upper()}"),
                platform    = d.get("platform", "ios-xe"),
                role        = d.get("role", "campus-access"),
                mgmt_ip     = d.get("mgmt_ip", "10.100.0.1"),
                mgmt_mask   = d.get("mgmt_mask", "255.255.255.0"),
                mgmt_gw       = d.get("mgmt_gw", ""),
                loopback_ip   = d.get("loopback_ip", ""),
                bgp_asn       = d.get("bgp_asn", 65000),
                vlans         = d.get("vlans", []),
                bake_policies = d.get("bake_policies", False),
                policy_flags  = d.get("policy_flags", {}),
                extra         = d.get("extra", {}),
            )
            result.append(self.register(dev))
        return result

    def get(self, serial: str) -> Optional[ZTPDevice]:
        return self._devices.get(serial)

    def all_devices(self) -> list[ZTPDevice]:
        return list(self._devices.values())

    def stats(self) -> dict[str, int]:
        counts = {s.value: 0 for s in ZTPState}
        for d in self._devices.values():
            counts[d.state.value] += 1
        return counts

    def delete(self, serial: str) -> bool:
        if serial in self._devices:
            del self._devices[serial]
            self._save_registry()
            return True
        return False

    # ── Config serving ───────────────────────────────────────────────────

    def get_bootstrap_config(self, serial: str) -> tuple[str, str]:
        """
        Return (config_text, content_type) for a device.
        Updates device state to CONTACTED.
        """
        dev = self._devices.get(serial)
        if not dev:
            return self._generic_bootstrap(serial), "text/plain"

        dev.state       = ZTPState.CONTACTED
        dev.contacted_at = time.time()
        dev.last_seen   = time.time()
        self._save_registry()
        log.info("ZTP: bootstrap served for %s (%s)", serial, dev.hostname)

        config = self._render_day0(dev)
        mime   = "text/plain"
        return config, mime

    def get_platform_script(self, platform: str, server_url: str) -> str:
        """
        Return a POAP/ZTP script for NX-OS or EOS that will:
          1. Identify the device serial
          2. Fetch its specific bootstrap config
          3. Apply it
        """
        if platform == "nxos":
            return self._nxos_poap_script(server_url)
        elif platform == "eos":
            return self._eos_ztp_script(server_url)
        elif platform == "ios-xe":
            return self._iosxe_pnp_template(server_url)
        else:
            return f"# ZTP script for {platform}\n# Fetch config from {server_url}/ztp/bootstrap/SERIAL\n"

    # ── State transitions ────────────────────────────────────────────────

    def checkin(self, serial: str, success: bool, detail: str = "") -> ZTPDevice | None:
        """Device reports provisioning result."""
        dev = self._devices.get(serial)
        if not dev:
            return None
        if success:
            dev.state          = ZTPState.PROVISIONED
            dev.provisioned_at = time.time()
        else:
            dev.state = ZTPState.FAILED
            dev.error = detail
        dev.last_seen = time.time()
        self._save_registry()
        log.info("ZTP: checkin %s → %s | %s", serial, dev.state.value, detail)
        return dev

    def mark_provisioning(self, serial: str) -> None:
        dev = self._devices.get(serial)
        if dev:
            dev.state     = ZTPState.PROVISIONING
            dev.last_seen = time.time()
            self._save_registry()

    # ── Jinja2 rendering ─────────────────────────────────────────────────

    def _get_env(self, platform: str) -> Environment:
        if platform not in self._jinja_envs:
            tpl_dir = TEMPLATE_DIR / platform
            if not tpl_dir.exists():
                tpl_dir = TEMPLATE_DIR  # fallback to root
            self._jinja_envs[platform] = Environment(
                loader=FileSystemLoader(str(tpl_dir)),
                trim_blocks=True,
                lstrip_blocks=True,
            )
        return self._jinja_envs[platform]

    def _render_day0(self, dev: ZTPDevice) -> str:
        """
        Render Day 0 bootstrap config.

        If dev.bake_policies is True, append all enabled policy blocks
        (static routing, VLAN, trunk, wireless, BGP, ACL, 802.1X, QoS, AAA)
        so the device gets its full production config on first boot.

        If bake_policies is False, return the minimal Day 0 template only
        (SSH reachable, mgmt IP, NTP, syslog — enough for Netmiko to connect).
        """
        platform_dir = dev.platform.replace("-", "_")
        tpl_name     = "day0.j2"
        tpl_dir      = TEMPLATE_DIR / platform_dir

        if not (tpl_dir / tpl_name).exists():
            log.warning("ZTP: no day0 template for %s — using generic", platform_dir)
            base = self._generic_bootstrap(dev.serial, dev)
        else:
            env = self._get_env(platform_dir)
            tpl = env.get_template(tpl_name)
            ctx = {
                "hostname":    dev.hostname,
                "serial":      dev.serial,
                "platform":    dev.platform,
                "role":        dev.role,
                "mgmt_ip":     dev.mgmt_ip,
                "mgmt_mask":   dev.mgmt_mask,
                "mgmt_gw":     dev.mgmt_gw,
                "loopback_ip": dev.loopback_ip or dev.mgmt_ip,
                "bgp_asn":     dev.bgp_asn,
                "vlans":       dev.vlans,
                **dev.extra,
            }
            base = tpl.render(**ctx)

        if not dev.bake_policies:
            return base

        # ── Bake policies into ZTP config ────────────────────────────────
        # Build a state-like dict that the policy generators understand
        log.info("ZTP: baking policies into bootstrap for %s", dev.hostname)
        state_for_policy = {
            "uc":           _role_to_uc(dev.role),
            "orgName":      dev.hostname.split("-")[0] if "-" in dev.hostname else dev.hostname,
            "redundancy":   "single",
            "protocols":    dev.extra.get("protocols", []),
            "security":     dev.extra.get("security", []),
            "vlans":        dev.vlans,
            "appFlows":     [],
            # Policy flags: per-device overrides, default all True
            **{k: dev.policy_flags.get(k, True) for k in [
                "include_bgp_policy", "include_acl", "include_dot1x",
                "include_qos", "include_aaa", "include_static_routing",
                "include_vlan_policy", "include_trunk_policy", "include_wireless",
            ]},
        }

        device_ctx = {
            "hostname":    dev.hostname,
            "layer":       dev.role,
            "uc":          state_for_policy["uc"],
            "org":         state_for_policy["orgName"],
            "redundancy":  "single",
            "index":       1,
            "product_id":  "",
            "protocols":   state_for_policy["protocols"],
            "security":    state_for_policy["security"],
            "vlans":       dev.vlans,
            "app_flows":   [],
            "mgmt_ip":     dev.mgmt_ip,
            "mgmt_mask":   dev.mgmt_mask,
            "loopback_ip": dev.loopback_ip or dev.mgmt_ip,
            "bgp_asn":     dev.bgp_asn,
            **dev.extra,
        }

        # Import here to avoid circular imports at module load
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).parent.parent))
            from config_gen import _append_policies, _platform_from_dir
            platform_key = _platform_from_dir(platform_dir)
            return _append_policies(base, device_ctx, platform_key, state_for_policy)
        except Exception as exc:
            log.error("ZTP: policy bake failed for %s: %s", dev.hostname, exc)
            return base + f"\n! POLICY BAKE ERROR: {exc}\n"

    def _generic_bootstrap(self, serial: str, dev: ZTPDevice | None = None) -> str:
        hostname = dev.hostname if dev else f"DEVICE-{serial[-4:].upper()}"
        mgmt_ip  = dev.mgmt_ip if dev else "10.100.0.1"
        return (
            f"! NetDesign AI — ZTP Bootstrap (generic)\n"
            f"! Serial: {serial}\n"
            f"hostname {hostname}\n"
            f"interface Loopback0\n"
            f" ip address {mgmt_ip} 255.255.255.255\n"
            f"ip ssh version 2\n"
            f"crypto key generate rsa modulus 2048\n"
            f"end\n"
        )

    # ── Platform scripts ─────────────────────────────────────────────────

    @staticmethod
    def _nxos_poap_script(server_url: str) -> str:
        """NX-OS POAP Python script — device runs this at first boot."""
        return f'''#!/usr/bin/env python
"""
NetDesign AI — NX-OS POAP Script
Fetches device-specific Day 0 config from ZTP server.
"""
import urllib2
import os
import socket
import time

ZTP_SERVER = "{server_url}"

def get_serial():
    """Read serial number from NX-OS."""
    try:
        import cli
        output = cli.cli("show inventory | include Chassis")
        for line in output.split("\\n"):
            if "SN:" in line:
                return line.split("SN:")[-1].strip().split()[0]
    except Exception:
        pass
    return socket.gethostname()

def fetch_config(serial):
    url = f"{{ZTP_SERVER}}/ztp/bootstrap/{{serial}}"
    print(f"POAP: Fetching config from {{url}}")
    try:
        resp = urllib2.urlopen(url, timeout=30)
        return resp.read()
    except Exception as e:
        print(f"POAP: Error fetching config: {{e}}")
        return None

def apply_config(config_text):
    config_file = "/tmp/nd_day0.cfg"
    with open(config_file, "w") as f:
        f.write(config_text)
    try:
        import cli
        cli.cli(f"copy {{config_file}} running-config")
        cli.cli(f"copy running-config startup-config")
        print("POAP: Config applied successfully")
        return True
    except Exception as e:
        print(f"POAP: Failed to apply config: {{e}}")
        return False

def checkin(serial, success):
    url = f"{{ZTP_SERVER}}/ztp/checkin/{{serial}}"
    data = f'{{"success": {"true" if success else "false"}, "detail": "POAP complete"}}'
    try:
        req = urllib2.Request(url, data, {{"Content-Type": "application/json"}})
        urllib2.urlopen(req, timeout=10)
    except Exception as e:
        print(f"POAP: Checkin failed: {{e}}")

if __name__ == "__main__":
    serial = get_serial()
    print(f"POAP: Device serial = {{serial}}")
    config = fetch_config(serial)
    if config:
        ok = apply_config(config)
        checkin(serial, ok)
    else:
        checkin(serial, False)
'''

    @staticmethod
    def _eos_ztp_script(server_url: str) -> str:
        """Arista EOS ZTP Python script."""
        return f'''#!/usr/bin/env python3
"""
NetDesign AI — Arista EOS ZTP Script
Fetches device-specific Day 0 config from ZTP server.
"""
import urllib.request
import json
import subprocess
import os

ZTP_SERVER = "{server_url}"

def get_serial():
    try:
        result = subprocess.run(["FastCli", "-p", "15", "-c", "show version | grep Serial"],
                                capture_output=True, text=True)
        for line in result.stdout.split("\\n"):
            if "Serial" in line:
                return line.split()[-1]
    except Exception:
        pass
    return "UNKNOWN"

def fetch_config(serial):
    url = f"{{ZTP_SERVER}}/ztp/bootstrap/{{serial}}"
    print(f"ZTP: Fetching from {{url}}")
    with urllib.request.urlopen(url, timeout=30) as resp:
        return resp.read().decode("utf-8")

def apply_config(config_text):
    config_path = "/tmp/nd_day0.eos"
    with open(config_path, "w") as f:
        f.write(config_text)
    result = subprocess.run(
        ["FastCli", "-p", "15", "-c", f"copy {{config_path}} running-config\\ncopy running-config startup-config"],
        capture_output=True, text=True
    )
    return result.returncode == 0

def checkin(serial, success, detail=""):
    url = f"{{ZTP_SERVER}}/ztp/checkin/{{serial}}"
    payload = json.dumps({{"success": success, "detail": detail}}).encode()
    req = urllib.request.Request(url, data=payload,
                                  headers={{"Content-Type": "application/json"}})
    urllib.request.urlopen(req, timeout=10)

if __name__ == "__main__":
    serial = get_serial()
    print(f"ZTP: Serial = {{serial}}")
    try:
        config = fetch_config(serial)
        ok = apply_config(config)
        checkin(serial, ok, "EOS ZTP complete")
    except Exception as e:
        checkin(serial, False, str(e))
'''

    @staticmethod
    def _iosxe_pnp_template(server_url: str) -> str:
        """IOS-XE Plug-and-Play redirect info (for DHCP option 43)."""
        return (
            f"! IOS-XE PnP Server Configuration\n"
            f"! Set DHCP option 43 to redirect to:\n"
            f"!   5A;K4;B2;I{server_url.replace('http://', '').replace('https://', '')};J80\n"
            f"!\n"
            f"! Or configure PnP agent on device:\n"
            f"!   pnp profile NetDesign-ZTP\n"
            f"!    transport https host {server_url.split('/')[-1]} port 443\n"
            f"!\n"
        )


# ── Module singleton ─────────────────────────────────────────────────────

ztp_server = ZTPServer()
