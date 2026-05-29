"""ZTP (Zero Touch Provisioning) engine for demo lab devices.

Simulates the full bootstrap lifecycle without real DHCP/TFTP servers:
  UNPROVISIONED → DHCP_REQUESTED → BOOTSTRAP_DOWNLOADED → CONFIG_APPLIED
  → REGISTERED → PRE_CHECKS_RUNNING → PRE_CHECKS_PASSED → ONLINE

Each stage can be forced to fail for fault-injection demos.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .devices import LabDevice, ZTPState

# Ordered ZTP pipeline
_PIPELINE: List[ZTPState] = [
    ZTPState.DHCP_REQUESTED,
    ZTPState.BOOTSTRAP_DOWNLOADED,
    ZTPState.CONFIG_APPLIED,
    ZTPState.REGISTERED,
    ZTPState.PRE_CHECKS_RUNNING,
    ZTPState.PRE_CHECKS_PASSED,
    ZTPState.ONLINE,
]

_MESSAGES: Dict[ZTPState, str] = {
    ZTPState.DHCP_REQUESTED: "DHCP offer received, management IP assigned",
    ZTPState.BOOTSTRAP_DOWNLOADED: "Bootstrap config downloaded via TFTP/HTTP",
    ZTPState.CONFIG_APPLIED: "Full device config applied from config server",
    ZTPState.REGISTERED: "Device registered in CMDB / network inventory",
    ZTPState.PRE_CHECKS_RUNNING: "Automated pre-deployment checks running",
    ZTPState.PRE_CHECKS_PASSED: "All pre-deployment checks passed",
    ZTPState.ONLINE: "Device is online and operational",
}


@dataclass
class ZTPEvent:
    device_name: str
    state: ZTPState
    message: str
    success: bool = True
    timestamp: float = field(default_factory=time.time)


class ZTPEngine:
    """Drives each device through the ZTP state machine.

    Args:
        on_event: Optional callback invoked after every state transition.
        stage_delay: Seconds to sleep between stages (default 0 for speed).
    """

    def __init__(
        self,
        on_event: Optional[Callable[[ZTPEvent], None]] = None,
        stage_delay: float = 0.0,
    ) -> None:
        self._on_event = on_event or (lambda _: None)
        self.stage_delay = stage_delay
        self.history: List[ZTPEvent] = []

    def provision_device(
        self,
        device: LabDevice,
        fail_at: Optional[ZTPState] = None,
    ) -> bool:
        """Provision one device through the full ZTP pipeline.

        Args:
            device: The device to provision (mutated in place).
            fail_at: If set, inject a failure at this stage.

        Returns:
            True on success, False if the device ended in FAILED.
        """
        device.ztp_state = ZTPState.UNPROVISIONED

        for state in _PIPELINE:
            if self.stage_delay:
                time.sleep(self.stage_delay)

            if fail_at == state:
                device.ztp_state = ZTPState.FAILED
                evt = ZTPEvent(
                    device_name=device.name,
                    state=ZTPState.FAILED,
                    message=f"Injected failure at stage '{state.value}'",
                    success=False,
                )
                self.history.append(evt)
                self._on_event(evt)
                return False

            device.ztp_state = state
            msg = _MESSAGES[state]
            if state == ZTPState.DHCP_REQUESTED:
                msg = f"{msg}: {device.management_ip}"
            elif state == ZTPState.CONFIG_APPLIED:
                msg = f"{msg} (platform={device.platform.value})"

            evt = ZTPEvent(device_name=device.name, state=state, message=msg)
            self.history.append(evt)
            self._on_event(evt)

        return True

    def provision_topology(
        self,
        devices: List[LabDevice],
        fail_devices: Optional[Dict[str, ZTPState]] = None,
    ) -> Dict[str, bool]:
        """Provision all devices in a topology.

        Args:
            devices: All devices to provision.
            fail_devices: Maps ``device_name`` → ``ZTPState`` to fail at.

        Returns:
            Dict mapping device name → True (success) / False (failed).
        """
        fail_devices = fail_devices or {}
        return {
            device.name: self.provision_device(
                device, fail_at=fail_devices.get(device.name)
            )
            for device in devices
        }

    def summary(self) -> Dict[str, int]:
        online = sum(
            1 for e in self.history if e.state == ZTPState.ONLINE and e.success
        )
        failed = sum(1 for e in self.history if e.state == ZTPState.FAILED)
        return {
            "total_events": len(self.history),
            "online": online,
            "failed": failed,
        }
