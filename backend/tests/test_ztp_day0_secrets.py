"""
R3 — Day-0 template security: no hardcoded credentials, parameterized services.

The Day-0 Jinja templates previously baked literal passwords (ChangeMe! /
NetDesignZTP1!) and hardcoded NTP/syslog IPs (10.100.0.1 / 10.100.0.100).
These tests render every platform's Day-0 via the real ZTP server and assert:
  - no hardcoded credential literals,
  - `<CHANGE-ME-*>` placeholders are present for secrets,
  - NTP/syslog default to `<CHANGE-ME-*>` (and can be overridden via `extra`).
"""
import pytest

from ztp.server import ZTPDevice, ztp_server

# All platforms that now have a backend Day-0 template (R3 + R4).
PLATFORMS = [
    "nxos", "eos", "ios-xe", "junos", "iosxr", "srl",
    "cumulus", "dellos10", "fortios", "arubaoscx", "exos", "panos",
]
# Templates that define a secondary `netdesign` admin account (original four).
PLATFORMS_WITH_NETDESIGN = ["nxos", "eos", "ios-xe", "junos"]


def _render(platform: str, extra: dict | None = None) -> str:
    dev = ZTPDevice(
        serial=f"SN-{platform}",
        hostname=f"T-{platform}",
        platform=platform,
        role="dc-leaf",
        mgmt_ip="10.0.0.11",
        mgmt_gw="10.0.0.1",
        extra=extra or {},
    )
    return ztp_server.render_config(dev)


@pytest.mark.parametrize("platform", PLATFORMS)
def test_no_hardcoded_credentials(platform):
    cfg = _render(platform)
    assert "ChangeMe!" not in cfg
    assert "NetDesignZTP1!" not in cfg


@pytest.mark.parametrize("platform", PLATFORMS)
def test_admin_placeholder_present(platform):
    cfg = _render(platform)
    assert "<CHANGE-ME-admin-password>" in cfg


@pytest.mark.parametrize("platform", PLATFORMS_WITH_NETDESIGN)
def test_netdesign_placeholder_present(platform):
    cfg = _render(platform)
    assert "<CHANGE-ME-netdesign-password>" in cfg


@pytest.mark.parametrize("platform", PLATFORMS)
def test_renders_hostname_and_mgmt(platform):
    cfg = _render(platform)
    assert "T-" + platform in cfg
    assert "10.0.0.11" in cfg          # mgmt_ip
    assert "ssh" in cfg.lower()


@pytest.mark.parametrize("platform", PLATFORMS)
def test_ntp_syslog_default_to_placeholders(platform):
    cfg = _render(platform)
    assert "<CHANGE-ME-ntp-ip>" in cfg
    assert "<CHANGE-ME-syslog-ip>" in cfg
    assert "10.100.0.1" not in cfg
    assert "10.100.0.100" not in cfg


@pytest.mark.parametrize("platform", PLATFORMS)
def test_extra_overrides_services_and_secrets(platform):
    cfg = _render(platform, extra={
        "ntp_server": "10.5.5.5",
        "syslog_server": "10.6.6.6",
        "admin_password": "$6$realhash",
    })
    assert "10.5.5.5" in cfg
    assert "10.6.6.6" in cfg
    assert "$6$realhash" in cfg
    assert "<CHANGE-ME-admin-password>" not in cfg
