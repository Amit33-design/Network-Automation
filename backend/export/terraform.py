"""
Terraform HCL export for NetDesign AI.

Generates a Terraform configuration that provisions network device
resources via the NetBox provider (primary) plus stub outputs and
variables.  Users can swap the provider block for their target
platform (Cisco DCNM, Arista CloudVision, etc.).
"""
from __future__ import annotations

import textwrap
from typing import Any


_ROLE_PLATFORM: dict[str, str] = {
    "spine":        "nxos",
    "leaf":         "nxos",
    "gpu-spine":    "sonic",
    "gpu-tor":      "sonic",
    "core":         "ios_xe",
    "distribution": "ios_xe",
    "access":       "ios_xe",
    "firewall":     "palo_alto",
    "wan-router":   "ios_xe",
}

_ROLE_DEVICE_TYPE: dict[str, str] = {
    "spine":        "Cisco Nexus 93180YC-FX",
    "leaf":         "Cisco Nexus 93180YC-FX",
    "gpu-spine":    "Arista 7800R3",
    "gpu-tor":      "Arista 7050CX3-32S",
    "core":         "Cisco Catalyst 9500",
    "distribution": "Cisco Catalyst 9300",
    "access":       "Cisco Catalyst 9200",
    "firewall":     "Palo Alto PA-3260",
    "wan-router":   "Cisco ASR 1002-X",
}


def _hcl_device(dev: dict, site_slug: str, tenant_slug: str) -> str:
    hostname  = dev["hostname"]
    role      = dev.get("role", "default")
    platform  = dev.get("platform", _ROLE_PLATFORM.get(role, "default"))
    dev_type  = dev.get("device_type", _ROLE_DEVICE_TYPE.get(role, "Generic Device"))
    ip        = dev.get("ip", "")
    res_name  = hostname.lower().replace("-", "_")

    ip_block = ""
    if ip and ip != "REPLACE_ME":
        ip_block = f'\n  primary_ip4 = netbox_ip_address.{res_name}_mgmt.id'

    return textwrap.dedent(f"""\
        resource "netbox_device" "{res_name}" {{
          name            = "{hostname}"
          device_type_id  = data.netbox_device_type.{_slug(dev_type)}.id
          role_id         = data.netbox_device_role.{_slug(role)}.id
          site_id         = data.netbox_site.primary.id
          tenant_id       = data.netbox_tenant.{tenant_slug}.id
          platform_id     = data.netbox_platform.{_slug(platform)}.id
          status          = "planned"{ip_block}

          tags = ["netdesign-ai", "auto-generated"]
        }}
        """)


def _hcl_ip(dev: dict) -> str:
    hostname = dev["hostname"]
    ip       = dev.get("ip", "")
    if not ip or "REPLACE_ME" in ip:
        return ""
    res_name = hostname.lower().replace("-", "_")
    cidr     = ip if "/" in ip else ip + "/32"
    return textwrap.dedent(f"""\
        resource "netbox_ip_address" "{res_name}_mgmt" {{
          ip_address  = "{cidr}"
          status      = "active"
          description = "{hostname} management"
        }}
        """)


def _slug(s: str) -> str:
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def generate_terraform(
    design_state: dict[str, Any],
    ip_plan:      dict[str, Any] | None = None,
) -> str:
    """
    Returns a Terraform HCL string (main.tf).
    """
    ip_plan  = ip_plan or {}
    org_name = design_state.get("orgName", "network")
    use_case = design_state.get("uc", "campus")
    site_slug   = _slug(org_name + "_primary")
    tenant_slug = _slug(org_name)

    # Build device list
    devices: list[dict] = []
    ip_devices = ip_plan.get("devices", [])
    if ip_devices:
        for dev in ip_devices:
            devices.append({
                "hostname": dev.get("hostname", "device"),
                "ip":       dev.get("loopback", dev.get("ip", "")),
                "role":     dev.get("role", "default"),
                "platform": dev.get("platform", _ROLE_PLATFORM.get(dev.get("role",""), "default")),
            })
    else:
        def _gen(role, prefix, count, platform):
            return [
                {"hostname": f"{prefix}{i+1:02d}", "role": role, "platform": platform}
                for i in range(min(count, 20))
            ]
        uc = use_case
        if uc in ("campus", "enterprise"):
            devices += _gen("firewall",     "FW-",    design_state.get("numFirewalls", 1), "ios_xe")
            devices += _gen("core",         "CORE-",  design_state.get("numCore", 2),      "ios_xe")
            devices += _gen("distribution", "DIST-",  design_state.get("numDist", 4),      "ios_xe")
            devices += _gen("access",       "ACC-",   design_state.get("numAccess", 8),    "ios_xe")
        elif uc in ("datacenter", "dc"):
            devices += _gen("firewall", "FW-",    design_state.get("numFirewalls", 2), "palo_alto")
            devices += _gen("spine",    "SPINE-", design_state.get("numSpine", 2),     "nxos")
            devices += _gen("leaf",     "LEAF-",  design_state.get("numLeaf", 8),      "nxos")
        elif uc in ("gpu", "ai_fabric"):
            devices += _gen("gpu-spine", "GPUSPINE-", design_state.get("numSpine", 2), "sonic")
            devices += _gen("gpu-tor",   "TOR-",      design_state.get("numLeaf", 8),  "sonic")
        else:
            devices += _gen("core",   "CORE-", design_state.get("numCore", 2),   "ios_xe")
            devices += _gen("access", "ACC-",  design_state.get("numAccess", 4), "ios_xe")

    # Collect unique roles / platforms / device types for data sources
    roles     = sorted({d.get("role","default") for d in devices})
    platforms = sorted({d.get("platform", _ROLE_PLATFORM.get(d.get("role",""), "default")) for d in devices})
    dev_types = sorted({_ROLE_DEVICE_TYPE.get(d.get("role",""), "Generic Device") for d in devices})

    role_data = "\n".join(
        f'data "netbox_device_role" "{_slug(r)}" {{ name = "{r}" }}' for r in roles
    )
    platform_data = "\n".join(
        f'data "netbox_platform" "{_slug(p)}" {{ name = "{p}" }}' for p in platforms
    )
    devtype_data = "\n".join(
        f'data "netbox_device_type" "{_slug(dt)}" {{ model = "{dt}" }}' for dt in dev_types
    )

    device_blocks = "\n".join(_hcl_device(d, site_slug, tenant_slug) for d in devices)
    ip_blocks     = "\n".join(_hcl_ip(d) for d in devices)

    output_ids = "\n".join(
        f'  {d["hostname"].lower().replace("-","_")}_id = netbox_device.{d["hostname"].lower().replace("-","_")}.id'
        for d in devices
    )

    return textwrap.dedent(f"""\
        # =============================================================
        # NetDesign AI — Terraform Configuration
        # Organisation : {org_name}
        # Use-case     : {use_case}
        # Generated by : NetDesign AI v2.4.0
        #
        # Apply:
        #   terraform init
        #   terraform plan -out=netdesign.tfplan
        #   terraform apply netdesign.tfplan
        #
        # Replace NETBOX_URL / NETBOX_TOKEN with your values,
        # or set env vars TF_VAR_netbox_url / TF_VAR_netbox_token.
        # =============================================================

        terraform {{
          required_providers {{
            netbox = {{
              source  = "e-breuninger/netbox"
              version = "~> 3.0"
            }}
          }}
          required_version = ">= 1.5"
        }}

        provider "netbox" {{
          server_url = var.netbox_url
          api_token  = var.netbox_token
        }}

        # ── Variables ────────────────────────────────────────────────

        variable "netbox_url" {{
          description = "NetBox server URL"
          type        = string
          default     = "https://netbox.example.com"
        }}

        variable "netbox_token" {{
          description = "NetBox API token"
          type        = string
          sensitive   = true
        }}

        # ── Data sources — must exist in NetBox before apply ─────────

        data "netbox_site" "primary" {{
          name = "{org_name} Primary"
        }}

        data "netbox_tenant" "{tenant_slug}" {{
          name = "{org_name}"
        }}

        {role_data}

        {platform_data}

        {devtype_data}

        # ── IP Addresses ─────────────────────────────────────────────

        {ip_blocks}

        # ── Devices ──────────────────────────────────────────────────

        {device_blocks}

        # ── Outputs ──────────────────────────────────────────────────

        output "device_ids" {{
          description = "NetBox device IDs for all provisioned devices"
          value = {{
        {output_ids}
          }}
        }}
    """)
