"""
NetDesign AI — ISC DHCP Config Generator
==========================================
Generates ISC DHCP server config snippets (dhcpd.conf fragments) for ZTP.

Public API:
    generate_dhcp_config(devices, ztp_server_ip, gateway, dns) -> str

Each device produces a host stanza with:
  - fixed-address (mgmt_ip)
  - hardware ethernet (mac, if present in device.extra)
  - filename / next-server directives for the correct ZTP protocol

Platform boot-filename mapping via _boot_filename(platform, hostname).
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Platform → boot filename mapping
# ---------------------------------------------------------------------------

# G-A6: filenames relative to the ztp-tftp / ztp-files static file root
# (ZTP_FILES_DIR, exported via POST /ztp/export-files)
_TFTP_MAP = {
    "nxos":      "scripts/nxos_poap.py",
    "nxos9k":    "scripts/nxos_poap.py",
    "eos":       "scripts/eos_ztp.py",
    "ios-xe":    "scripts/ios_xe_pnp.py",
    "iosxe":     "scripts/ios_xe_pnp.py",
    "ios_xe":    "scripts/ios_xe_pnp.py",
    "iosxr":     "scripts/iosxr_ztp.sh",
    "junos":     "scripts/junos_ztp.slax",
    "srl":       "scripts/srl_ztp.json",
    "cumulus":   "scripts/cumulus_ztp.sh",
    "dellos10":  "scripts/os10_ztd.py",
}


# DHCP option 60 (vendor-class-identifier) advertised per platform — used to
# classify booting devices and serve the correct boot file per vendor. Mirrors
# frontend lib/ztp.ts ZTP_VENDOR_PROFILES so demo and live agree.
_VENDOR_CLASS = {
    "nxos":      "Cisco-POAP",
    "nxos9k":    "Cisco-POAP",
    "ios-xe":    "ciscopnp",
    "iosxe":     "ciscopnp",
    "ios_xe":    "ciscopnp",
    "iosxr":     "PXEClient:Arch",
    "eos":       "Arista",
    "junos":     "Juniper",
    "srl":       "Nokia-SRLinux",
    "cumulus":   "cumulus-linux",
    "dellos10":  "Dell-OS10",
    "fortios":   "FortiGate",
    "arubaoscx": "ArubaInstantOn",
    "exos":      "Extreme",
    "panos":     "PaloAltoNetworks",
}


def _boot_filename(platform: str, hostname: str, tftp: bool = False) -> str:
    """
    Return the DHCP bootfile-name value for the given platform.

    The bootfile-name tells the device where to fetch its ZTP script / config.
    This value is placed in DHCP option 67 (bootfile-name).

    Supported platforms:
        nxos        — NX-OS POAP Python script
        eos         — Arista EOS ZTP script
        ios-xe      — IOS-XE PnP redirect (option 43 encoded string)
        junos       — Junos ZTP config file
        sonic       — SONiC JSON ZTP descriptor

    For unknown platforms the generic bootstrap endpoint is used.

    If `tftp` is True (G-A6), return a path relative to the ztp-tftp /
    ztp-files static file root instead of the HTTP API path — for legacy
    devices that fetch their boot file over plain TFTP (DHCP `next-server`
    + `filename`) rather than calling the FastAPI ZTP endpoints directly.
    """
    platform = platform.lower().strip()

    if tftp:
        return _TFTP_MAP.get(platform, f"configs/{hostname}.cfg")

    _MAP = {
        "nxos":   "ztp/script/nxos",
        "nxos9k": "ztp/script/nxos",
        "eos":    "ztp/script/eos",
        "ios-xe": "ztp/script/ios-xe",
        "iosxe":  "ztp/script/ios-xe",
        "ios_xe": "ztp/script/ios-xe",
        "junos":  "ztp/script/junos",
        "sonic":  "ztp/script/sonic",
    }
    return _MAP.get(platform, f"ztp/bootstrap/{hostname}")


# ---------------------------------------------------------------------------
# DHCP config generation
# ---------------------------------------------------------------------------

def generate_dhcp_config(
    devices: list[dict[str, Any]],
    ztp_server_ip: str,
    gateway: str,
    dns: str,
    subnet: str = "",
    subnet_mask: str = "",
    domain_name: str = "netdesign.local",
    lease_time: int = 600,
    tftp: bool = False,
) -> str:
    """
    Generate an ISC DHCP server config fragment for ZTP onboarding.

    Args:
        devices:       List of device dicts. Each must have at minimum:
                         hostname (str), platform (str), mgmt_ip (str).
                       Optional: mac (str), mgmt_mask (str), extra.mac (str).
        ztp_server_ip: IP address of the ZTP / TFTP server.
        gateway:       Default gateway for the management subnet.
        dns:           DNS server IP (comma-separated for multiple).
        subnet:        Optional subnet network address (e.g. 10.100.0.0).
        subnet_mask:   Subnet mask (e.g. 255.255.255.0).
        domain_name:   Domain name option (default: netdesign.local).
        lease_time:    DHCP lease time in seconds (default: 600).
        tftp:          (G-A6) When True, `filename` directives point at the
                       ztp-tftp / ztp-files static file root (`scripts/...`,
                       `configs/{hostname}.cfg`) instead of the FastAPI HTTP
                       ZTP endpoints — for devices that boot via plain TFTP.

    Returns:
        A dhcpd.conf fragment as a string ready to append/include into
        the ISC DHCP server main config.
    """
    lines: list[str] = [
        "# ── NetDesign AI — Auto-generated ZTP DHCP config ───────────────────",
        "# Generated by backend/ztp/dhcp_gen.py",
        "# Include this file in dhcpd.conf with:  include \"/etc/dhcp/ztp.conf\";",
        "#",
        f"# ZTP Server: {ztp_server_ip}",
        f"# Gateway:    {gateway}",
        f"# DNS:        {dns}",
    ]
    if tftp:
        lines.append("# Mode:       TFTP (G-A6 ztp-tftp file server)")
    lines.append("")

    # Optional subnet declaration
    if subnet and subnet_mask:
        lines += [
            f"subnet {subnet} netmask {subnet_mask} {{",
            f"  option routers {gateway};",
            f"  option domain-name-servers {dns};",
            f"  option domain-name \"{domain_name}\";",
            f"  default-lease-time {lease_time};",
            f"  max-lease-time {lease_time * 2};",
            "",
            f"  # ZTP server for all devices in this subnet",
            f"  next-server {ztp_server_ip};",
            "}}",
            "",
        ]

    # Option-60 vendor classes — classify booting devices by their advertised
    # vendor-class-identifier and serve the correct per-vendor boot file. This
    # is what makes ZTP work for a mixed-vendor fleet without per-MAC config.
    seen_classes: set[str] = set()
    for dev in devices:
        platform = (dev.get("platform", "ios-xe") or "ios-xe").lower()
        vclass = _VENDOR_CLASS.get(platform)
        if not vclass or vclass in seen_classes:
            continue
        seen_classes.add(vclass)
        safe = "".join(c if c.isalnum() else "-" for c in vclass)
        boot = _boot_filename(platform, "device", tftp=tftp)
        lines.append(f"# {platform} → option-60 class")
        lines.append(f"class \"{safe}\" {{")
        lines.append(
            f"  match if substring(option vendor-class-identifier, 0, "
            f"{len(vclass)}) = \"{vclass}\";"
        )
        if not tftp and platform in ("ios-xe", "iosxe", "ios_xe"):
            lines.append(f"  option vendor-class-identifier \"ciscopnp\";")
            lines.append(
                f"  option vendor-encapsulated-options \"5A;K4;B2;I{ztp_server_ip};J80\";"
            )
        lines.append(f"  filename \"{boot}\";")
        lines.append(f"  next-server {ztp_server_ip};")
        lines.append("}")
        lines.append("")

    # Per-device host stanzas
    for dev in devices:
        hostname = dev.get("hostname", "unknown")
        platform = dev.get("platform", "ios-xe")
        mgmt_ip  = dev.get("mgmt_ip", "")

        # MAC address — look in top-level 'mac' key or nested 'extra.mac'
        mac = (
            dev.get("mac", "")
            or (dev.get("extra") or {}).get("mac", "")
        )

        if not mgmt_ip:
            lines.append(f"# Skipped {hostname} — mgmt_ip not set")
            continue

        boot_file = _boot_filename(platform, hostname, tftp=tftp)
        safe_name = hostname.replace(".", "-").replace("_", "-")

        lines.append(f"# ── {hostname} ({platform}) ────────────────────────────────")
        lines.append(f"host {safe_name} {{")

        if mac:
            # Normalise MAC to colon-separated lowercase
            normalised_mac = _normalise_mac(mac)
            lines.append(f"  hardware ethernet {normalised_mac};")

        lines.append(f"  fixed-address {mgmt_ip};")
        lines.append(f"  next-server {ztp_server_ip};")
        lines.append(f"  filename \"{boot_file}\";")

        # IOS-XE PnP: add option 43 redirect in addition to filename (HTTP mode only)
        if not tftp and platform.lower() in ("ios-xe", "iosxe", "ios_xe"):
            pnp_option = (
                f"5A;K4;B2;I{ztp_server_ip};J80"
            )
            lines.append(f"  option vendor-class-identifier \"ciscopnp\";")
            lines.append(f"  # PnP option 43 for IOS-XE:")
            lines.append(f"  # option 43 ascii \"{pnp_option}\";")

        lines.append("}")
        lines.append("")

    return "\n".join(lines)


def _normalise_mac(mac: str) -> str:
    """
    Normalise a MAC address to lowercase colon-separated format.

    Accepts: 00:1A:2B:3C:4D:5E  001a.2b3c.4d5e  001A2B3C4D5E
    Returns: 00:1a:2b:3c:4d:5e
    """
    raw = mac.replace(":", "").replace("-", "").replace(".", "").lower()
    if len(raw) != 12:
        return mac  # return as-is if not parsable
    return ":".join(raw[i:i+2] for i in range(0, 12, 2))
