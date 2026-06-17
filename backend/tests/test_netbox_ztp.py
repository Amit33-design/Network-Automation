"""
Tests for ZTP → NetBox sync (Enterprise upgrade B3):
  - sync_ztp_status:        ZTP state → NetBox device status PATCH
  - create_dhcp_reservation: ip-address upsert with status="dhcp"

The NetBox HTTP client and integration-config lookup are faked so no
network or database is required.
"""
import asyncio

import pytest

import integrations.netbox as nb


# ── Fakes ─────────────────────────────────────────────────────────────────────

class FakeResponse:
    def __init__(self, json_data, status_code=200):
        self._json = json_data
        self.status_code = status_code
        self.is_success = status_code < 400

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeClient:
    """Records calls; routes GET/PATCH/POST by path prefix."""

    def __init__(self, routes):
        self.routes = routes          # (method, path-prefix) -> FakeResponse
        self.calls = []               # (method, path, params/json)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _route(self, method, path, payload):
        self.calls.append((method, path, payload))
        for (m, prefix), resp in self.routes.items():
            if m == method and path.startswith(prefix):
                return resp
        return FakeResponse({}, 404)

    async def get(self, path, params=None):
        return await self._route("GET", path, params)

    async def patch(self, path, json=None):
        return await self._route("PATCH", path, json)

    async def post(self, path, json=None):
        return await self._route("POST", path, json)


CFG = {"base_url": "https://netbox.example.com", "token": "tok"}


@pytest.fixture
def patch_netbox(monkeypatch):
    """Patch config lookup + client factory; returns a holder for the client."""
    holder = {}

    def install(routes, cfg=CFG):
        client = FakeClient(routes)
        holder["client"] = client

        async def fake_get_config(org_id):
            return cfg

        monkeypatch.setattr(nb, "_get_config", fake_get_config)
        monkeypatch.setattr(nb, "_client", lambda c: client)
        return client

    return install


def run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


# ── sync_ztp_status ───────────────────────────────────────────────────────────

def test_state_map_covers_all_ztp_states():
    from ztp.server import ZTPState
    for state in ZTPState:
        if state is ZTPState.UNKNOWN:
            continue
        assert state.value in nb.ZTP_STATE_TO_NETBOX_STATUS


def test_sync_ztp_status_patches_device(patch_netbox):
    client = patch_netbox({
        ("GET", "/api/dcim/devices/"): FakeResponse({"results": [{"id": 42}]}),
        ("PATCH", "/api/dcim/devices/42/"): FakeResponse({"id": 42}),
    })
    ok = run(nb.sync_ztp_status("org1", "IAD-LEAF-A01", "provisioned"))
    assert ok is True
    method, path, body = client.calls[-1]
    assert (method, path) == ("PATCH", "/api/dcim/devices/42/")
    assert body["status"] == "active"
    assert "ZTP state: provisioned" in body["comments"]


def test_sync_ztp_status_failed_state_maps_to_failed(patch_netbox):
    client = patch_netbox({
        ("GET", "/api/dcim/devices/"): FakeResponse({"results": [{"id": 7}]}),
        ("PATCH", "/api/dcim/devices/7/"): FakeResponse({"id": 7}),
    })
    assert run(nb.sync_ztp_status("org1", "sw1", "failed")) is True
    assert client.calls[-1][2]["status"] == "failed"


def test_sync_ztp_status_unknown_state_is_noop(patch_netbox):
    client = patch_netbox({})
    assert run(nb.sync_ztp_status("org1", "sw1", "bogus")) is False
    assert client.calls == []


def test_sync_ztp_status_device_not_found(patch_netbox):
    patch_netbox({("GET", "/api/dcim/devices/"): FakeResponse({"results": []})})
    assert run(nb.sync_ztp_status("org1", "ghost", "provisioned")) is False


def test_sync_ztp_status_soft_fails_without_config(monkeypatch):
    async def no_config(org_id):
        return None
    monkeypatch.setattr(nb, "_get_config", no_config)
    assert run(nb.sync_ztp_status("org1", "sw1", "provisioned")) is False


# ── create_dhcp_reservation ───────────────────────────────────────────────────

def test_create_dhcp_reservation_creates_ip(patch_netbox):
    client = patch_netbox({
        ("GET", "/api/ipam/ip-addresses/"): FakeResponse({"results": []}),
        ("POST", "/api/ipam/ip-addresses/"): FakeResponse({"id": 9, "address": "10.0.0.5/32"}),
    })
    result = run(nb.create_dhcp_reservation("org1", "sw1", "10.0.0.5", "aa:bb:cc:dd:ee:ff"))
    assert result["id"] == 9
    method, path, body = client.calls[-1]
    assert method == "POST"
    assert body["address"] == "10.0.0.5/32"      # /32 appended
    assert body["status"] == "dhcp"
    assert body["dns_name"] == "sw1"
    assert "aa:bb:cc:dd:ee:ff" in body["description"]


def test_create_dhcp_reservation_updates_existing(patch_netbox):
    client = patch_netbox({
        ("GET", "/api/ipam/ip-addresses/"): FakeResponse({"results": [{"id": 3}]}),
        ("PATCH", "/api/ipam/ip-addresses/3/"): FakeResponse({"id": 3}),
    })
    result = run(nb.create_dhcp_reservation("org1", "sw1", "10.0.0.5/24"))
    assert result["id"] == 3
    method, path, body = client.calls[-1]
    assert (method, path) == ("PATCH", "/api/ipam/ip-addresses/3/")
    assert body["address"] == "10.0.0.5/24"      # existing mask kept
    assert "MAC" not in body["description"]      # no MAC given


def test_create_dhcp_reservation_requires_ip(patch_netbox):
    client = patch_netbox({})
    assert run(nb.create_dhcp_reservation("org1", "sw1", "")) is None
    assert client.calls == []


def test_create_dhcp_reservation_includes_tenant(patch_netbox):
    client = patch_netbox(
        {
            ("GET", "/api/ipam/ip-addresses/"): FakeResponse({"results": []}),
            ("POST", "/api/ipam/ip-addresses/"): FakeResponse({"id": 1}),
        },
        cfg={**CFG, "tenant_id": "5"},
    )
    run(nb.create_dhcp_reservation("org1", "sw1", "10.0.0.5"))
    assert client.calls[-1][2]["tenant"] == 5


# ── Router wiring (fire-and-forget guard) ─────────────────────────────────────

def test_router_noop_without_org_env(monkeypatch):
    """With ZTP_NETBOX_ORG unset the helpers must not schedule anything."""
    import ztp.router as zr
    monkeypatch.setattr(zr, "_NETBOX_ORG", "")
    from ztp.server import ZTPDevice
    dev = ZTPDevice(serial="S1", hostname="sw1", platform="nxos",
                    role="dc-leaf", mgmt_ip="10.0.0.5")
    # No running loop + no org: both paths must be safe no-ops
    zr._netbox_sync_state(dev)
    zr._netbox_reserve_dhcp(dev)


def test_router_handles_no_running_loop(monkeypatch):
    """With an org set but no running event loop, helpers must not raise."""
    import ztp.router as zr
    monkeypatch.setattr(zr, "_NETBOX_ORG", "org1")
    from ztp.server import ZTPDevice
    dev = ZTPDevice(serial="S2", hostname="sw2", platform="eos",
                    role="dc-leaf", mgmt_ip="10.0.0.6")
    zr._netbox_sync_state(dev)
    zr._netbox_reserve_dhcp(dev)
