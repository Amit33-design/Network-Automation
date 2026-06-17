"""
Tests for ztp/dhcp_gen.py — ISC DHCP config generation for ZTP.
"""
import pytest
from ztp.dhcp_gen import generate_dhcp_config, _boot_filename


# ── _boot_filename ────────────────────────────────────────────────────────────

class TestBootFilename:
    @pytest.mark.parametrize("platform,expected_fragment", [
        ("nxos",   "nxos"),
        ("eos",    "eos"),
        ("ios-xe", "ios"),
        ("junos",  "junos"),
        ("sonic",  "sonic"),
    ])
    def test_known_platform(self, platform, expected_fragment):
        filename = _boot_filename(platform, "sw-01")
        assert expected_fragment.lower() in filename.lower()

    def test_unknown_platform_returns_generic(self):
        filename = _boot_filename("unknown-platform", "sw-01")
        assert isinstance(filename, str) and len(filename) > 0

    def test_hostname_is_included_or_generic(self):
        """Hostname MAY appear in the filename for device-specific scripts."""
        filename = _boot_filename("eos", "leaf-99")
        assert isinstance(filename, str)


# ── _boot_filename (G-A6 TFTP mode) ─────────────────────────────────────────────

class TestBootFilenameTftp:
    @pytest.mark.parametrize("platform,expected", [
        ("nxos",   "scripts/nxos_poap.py"),
        ("eos",    "scripts/eos_ztp.py"),
        ("ios-xe", "scripts/ios_xe_pnp.py"),
    ])
    def test_known_platform_returns_script_path(self, platform, expected):
        assert _boot_filename(platform, "sw-01", tftp=True) == expected

    def test_unknown_platform_returns_per_device_config(self):
        filename = _boot_filename("junos", "leaf-99", tftp=True)
        assert filename == "configs/leaf-99.cfg"

    def test_tftp_paths_differ_from_http_paths(self):
        http_path = _boot_filename("nxos", "sw-01")
        tftp_path = _boot_filename("nxos", "sw-01", tftp=True)
        assert http_path != tftp_path


# ── generate_dhcp_config ───────────────────────────────────────────────────────

@pytest.fixture
def devices():
    return [
        {"hostname": "spine-01", "platform": "nxos",   "mgmt_ip": "10.0.0.1",
         "extra": {"mac": "aa:bb:cc:dd:ee:01"}},
        {"hostname": "leaf-01",  "platform": "eos",    "mgmt_ip": "10.0.0.2",
         "extra": {"mac": "aa:bb:cc:dd:ee:02"}},
        {"hostname": "fw-01",    "platform": "ios-xe", "mgmt_ip": "10.0.0.3"},
    ]


@pytest.fixture
def dhcp_kwargs():
    return dict(
        ztp_server_ip="10.0.0.100",
        gateway="10.0.0.254",
        dns="8.8.8.8",
        subnet="10.0.0.0",
        subnet_mask="255.255.255.0",
        domain_name="lab.local",
        lease_time=600,
    )


class TestGenerateDhcpConfig:
    def test_returns_string(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert isinstance(config, str) and len(config) > 0

    def test_contains_host_stanzas(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        for dev in devices:
            assert dev["hostname"] in config

    def test_contains_fixed_addresses(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        for dev in devices:
            assert dev["mgmt_ip"] in config

    def test_contains_next_server(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert dhcp_kwargs["ztp_server_ip"] in config

    def test_contains_gateway(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert dhcp_kwargs["gateway"] in config

    def test_contains_lease_time(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "600" in config

    def test_mac_address_included_when_present(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "aa:bb:cc:dd:ee:01" in config
        assert "aa:bb:cc:dd:ee:02" in config

    def test_empty_device_list_returns_string(self, dhcp_kwargs):
        config = generate_dhcp_config(devices=[], **dhcp_kwargs)
        assert isinstance(config, str)

    def test_domain_name_included(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "lab.local" in config

    def test_no_devices_without_mac_still_works(self, dhcp_kwargs):
        devs = [{"hostname": "sw-01", "platform": "eos", "mgmt_ip": "10.0.0.10"}]
        config = generate_dhcp_config(devices=devs, **dhcp_kwargs)
        assert "sw-01" in config

    def test_subnet_stanza_present_when_provided(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "10.0.0.0" in config

    def test_custom_lease_time(self, devices, dhcp_kwargs):
        dhcp_kwargs["lease_time"] = 3600
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "3600" in config


# ── generate_dhcp_config (G-A6 TFTP mode) ───────────────────────────────────────

class TestGenerateDhcpConfigTftp:
    def test_tftp_mode_uses_static_file_paths(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, tftp=True, **dhcp_kwargs)
        assert "scripts/nxos_poap.py" in config
        assert "scripts/eos_ztp.py" in config

    def test_tftp_mode_notes_mode_in_header(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, tftp=True, **dhcp_kwargs)
        assert "TFTP" in config

    def test_tftp_mode_omits_pnp_option_43(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, tftp=True, **dhcp_kwargs)
        assert "ciscopnp" not in config

    def test_http_mode_unaffected(self, devices, dhcp_kwargs):
        config = generate_dhcp_config(devices=devices, **dhcp_kwargs)
        assert "ztp/script/nxos" in config
        assert "scripts/nxos_poap.py" not in config
