"""
NetDesign AI — Device Credential Store
=========================================
Retrieves device credentials from HashiCorp Vault (KV v2).
Falls back to direct dict lookup for dev/lab environments where Vault
is not available (no Vault env vars set).

Usage:
    from credentials import CredentialStore

    store = CredentialStore()
    creds = store.get_device_creds("SPINE-01")
    # returns {"username": "admin", "password": "..."}

Vault path convention:
    netdesign/devices/{hostname}  → {"username": ..., "password": ...}

Dev mode (VAULT_ADDR not set):
    Falls back to DEVICE_DEFAULT_USER / DEVICE_DEFAULT_PASS env vars.
    Credentials can also be passed inline in the inventory dict.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("netdesign.credentials")

_VAULT_ADDR  = os.environ.get("VAULT_ADDR", "")
_VAULT_TOKEN = os.environ.get("VAULT_TOKEN", "")
_KV_MOUNT    = os.environ.get("VAULT_KV_MOUNT", "secret")
_DEV_USER    = os.environ.get("DEVICE_DEFAULT_USER", "admin")
_DEV_PASS    = os.environ.get("DEVICE_DEFAULT_PASS", "")


class CredentialStore:
    """
    Unified credential store. Vault-backed in production; env-based in dev.
    Instantiate once and reuse across requests.
    """

    def __init__(self) -> None:
        self._client: Any = None
        self._vault_available = False

        if _VAULT_ADDR and _VAULT_TOKEN:
            try:
                import hvac
                self._client = hvac.Client(url=_VAULT_ADDR, token=_VAULT_TOKEN)
                if self._client.is_authenticated():
                    self._vault_available = True
                    log.info("Vault connected at %s", _VAULT_ADDR)
                else:
                    log.warning("Vault token not authenticated — falling back to env creds")
            except ImportError:
                log.warning("hvac not installed — pip install hvac to use Vault")
            except Exception as exc:
                log.warning("Vault connection failed (%s) — falling back to env creds", exc)
        else:
            log.info("VAULT_ADDR/VAULT_TOKEN not set — using env-based credentials (dev mode)")

    def get_device_creds(self, hostname: str) -> dict[str, str]:
        """
        Retrieve credentials for a device hostname.

        Lookup order:
          1. Vault KV v2 at netdesign/devices/{hostname}  (prod)
          2. Environment variables DEVICE_DEFAULT_USER / DEVICE_DEFAULT_PASS  (dev)
        """
        if self._vault_available and self._client:
            try:
                secret = self._client.secrets.kv.v2.read_secret_version(
                    path=f"netdesign/devices/{hostname}",
                    mount_point=_KV_MOUNT,
                )
                data = secret["data"]["data"]
                return {"username": data["username"], "password": data["password"]}
            except Exception as exc:
                log.warning(
                    "Vault lookup failed for %s (%s) — using env defaults", hostname, exc
                )

        return {"username": _DEV_USER, "password": _DEV_PASS}

    def store_device_creds(
        self, hostname: str, username: str, password: str
    ) -> None:
        """
        Store or update credentials for a device in Vault.
        Raises RuntimeError if Vault is not available.
        """
        if not self._vault_available or not self._client:
            raise RuntimeError(
                "Vault is not configured. Set VAULT_ADDR and VAULT_TOKEN to store credentials."
            )
        self._client.secrets.kv.v2.create_or_update_secret(
            path=f"netdesign/devices/{hostname}",
            mount_point=_KV_MOUNT,
            secret={"username": username, "password": password},
        )
        log.info("Credentials stored in Vault for %s", hostname)

    def enrich_inventory(self, inventory: dict[str, Any]) -> dict[str, Any]:
        """
        Fill in missing username/password fields in an inventory dict from the
        credential store. Inventory entries that already have credentials are
        left unchanged (inline creds take precedence over Vault).
        """
        enriched = {}
        for hostname, host_data in inventory.items():
            entry = dict(host_data)
            if not entry.get("username") or not entry.get("password"):
                creds = self.get_device_creds(hostname)
                entry.setdefault("username", creds["username"])
                entry.setdefault("password", creds["password"])
            enriched[hostname] = entry
        return enriched


# Module-level singleton — import this in main.py / nornir_tasks.py
_store: CredentialStore | None = None


def get_store() -> CredentialStore:
    """Lazy singleton accessor."""
    global _store
    if _store is None:
        _store = CredentialStore()
    return _store
