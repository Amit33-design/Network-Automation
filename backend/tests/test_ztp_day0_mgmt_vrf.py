"""
AN2 — Day-0 must boot the device into the management VRF its Day-N expects.

The Day-N push travels over the session Day-0 creates. If Day-N moves the
management interface into a different VRF, the push cuts its own session:
EOS clears an interface's address when its VRF changes, and Cumulus / Junos
re-home the default route. The frontend Day-0 had the same three defects; see
frontend/src/test/ztp.test.ts for the matching Day-0 ⇄ Day-N agreement test.
"""
import re

from ztp.server import ZTPDevice, ztp_server


def _render(platform: str) -> str:
    return ztp_server.render_config(ZTPDevice(
        serial=f"SN-{platform}", hostname=f"T-{platform}", platform=platform,
        role="dc-leaf", mgmt_ip="10.0.0.11", mgmt_gw="10.0.0.1", extra={},
    ))


def test_eos_management_interface_and_route_share_vrf_mgmt():
    cfg = _render("eos")
    assert re.search(r"^vrf instance MGMT$", cfg, re.M)
    assert re.search(r"interface Management1\n(?:\s+.*\n)*?\s+vrf MGMT", cfg)
    # The route used to sit in the default VRF — no route for a MGMT address.
    assert re.search(r"^ip route vrf MGMT 0\.0\.0\.0/0 10\.0\.0\.1$", cfg, re.M)
    assert not re.search(r"^ip route 0\.0\.0\.0/0", cfg, re.M)


def test_junos_oob_default_lives_in_the_management_instance():
    cfg = _render("junos")
    assert "management-instance;" in cfg
    assert re.search(r"mgmt_junos \{(?:.|\n)*?route 0\.0\.0\.0/0 next-hop 10\.0\.0\.1;", cfg)


def test_cumulus_day0_is_nvue_and_joins_the_mgmt_vrf():
    cfg = _render("cumulus")
    assert not re.search(r"^net add", cfg, re.M)   # NCLU was removed in Cumulus 5.x
    assert "nv set interface eth0 ip vrf mgmt" in cfg
    assert "nv set vrf mgmt router static 0.0.0.0/0 via 10.0.0.1" in cfg


# ── AN3: a DHCP class never names a per-device file ─────────────────────────
from ztp.dhcp_gen import generate_dhcp_config  # noqa: E402


def test_dhcp_classes_never_point_at_a_placeholder_device_file():
    devs = [{"hostname": f"H-{p}", "platform": p, "mac": "aa:bb:cc:dd:ee:0" + str(i), "mgmt_ip": f"10.0.0.{10 + i}"}
            for i, p in enumerate(["nxos", "fortios", "arubaoscx", "exos", "panos", "srl"])]
    for tftp in (False, True):
        cfg = generate_dhcp_config(devs, ztp_server_ip="10.0.0.100", gateway="10.0.0.1", dns="10.0.0.53", tftp=tftp)
        # The class blocks used to hand out a file for a host literally named "device".
        assert "configs/device.cfg" not in cfg
        assert "ztp/bootstrap/device" not in cfg
        # Every device still gets its own reservation.
        for d in devs:
            assert f"host H-{d['platform']}" in cfg
