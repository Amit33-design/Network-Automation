"""
DC Operational Readiness Orchestrator.
Coordinates pre/post checks across all fabric devices and produces
a consolidated readiness verdict with per-device detail.
"""

from __future__ import annotations
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional, Dict

from .models import Fabric, Spine, Leaf
from .checks import PreDeployChecker, PostDeployChecker
from .checks.base import CheckSuite
from .collector.mock_collector import MockCollector


@dataclass
class ReadinessReport:
    fabric_name: str
    phase: str                              # pre | post | both
    start_time: str = field(default_factory=lambda: datetime.now().isoformat())
    end_time: str = ""
    suites: List[CheckSuite] = field(default_factory=list)

    @property
    def total_passed(self) -> int:
        return sum(s.passed for s in self.suites)

    @property
    def total_failed(self) -> int:
        return sum(s.failed for s in self.suites)

    @property
    def total_warnings(self) -> int:
        return sum(s.warnings for s in self.suites)

    @property
    def is_ready(self) -> bool:
        return all(s.is_ready for s in self.suites)

    @property
    def verdict(self) -> str:
        if self.is_ready:
            return "READY" if self.total_warnings == 0 else "READY_WITH_WARNINGS"
        return "NOT_READY"

    def to_dict(self) -> dict:
        return {
            "fabric": self.fabric_name,
            "phase": self.phase,
            "verdict": self.verdict,
            "is_ready": self.is_ready,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "summary": {
                "total_passed": self.total_passed,
                "total_failed": self.total_failed,
                "total_warnings": self.total_warnings,
                "devices_checked": len(self.suites),
                "devices_ready": sum(1 for s in self.suites if s.is_ready),
            },
            "devices": [s.to_dict() for s in self.suites],
        }


class DCReadiness:
    """
    Runs pre and/or post-deployment checks across all fabric devices.

    Usage:
        fabric = Fabric.from_yaml("topology.yaml")
        dr = DCReadiness(fabric)

        # Dry-run with mock data
        report = dr.run_pre(mock=True)
        report = dr.run_post(mock=True)

        # Live against real devices
        report = dr.run_pre()
        report = dr.run_post()
    """

    def __init__(self, fabric: Fabric, max_workers: int = 10):
        self.fabric = fabric
        self.max_workers = max_workers

    def _get_collector(self, device, mock: bool, fail_checks: List[str] = None):
        if mock:
            return MockCollector(fail_checks=fail_checks)
        from .collector.ssh_collector import SSHCollector
        return SSHCollector(
            host=device.host,
            username=device.username,
            password=device.password,
            platform=device.platform,
        )

    def _run_pre_device(self, device, mock: bool, fail_checks: List[str]) -> CheckSuite:
        is_spine = isinstance(device, Spine)
        collector = self._get_collector(device, mock, fail_checks)
        checker = PreDeployChecker(device_name=device.name)

        if not mock:
            with collector:
                collected = collector.collect_all_pre(device, self.fabric)
        else:
            collected = collector.collect_all_pre(device, self.fabric)

        return checker.run_all(self.fabric, device, collected)

    def _run_post_device(self, device, mock: bool, fail_checks: List[str]) -> CheckSuite:
        is_spine = isinstance(device, Spine)
        collector = self._get_collector(device, mock, fail_checks)
        checker = PostDeployChecker(device_name=device.name)

        if not mock:
            with collector:
                collected = collector.collect_all_post(device, self.fabric, is_spine)
        else:
            collected = collector.collect_all_post(device, self.fabric, is_spine)

        return checker.run_all(self.fabric, device, collected, is_spine=is_spine)

    def run_pre(
        self,
        mock: bool = False,
        fail_checks: Optional[List[str]] = None,
        devices: Optional[List[str]] = None,
    ) -> ReadinessReport:
        """Run pre-deployment checks across all (or specified) fabric devices."""
        report = ReadinessReport(fabric_name=self.fabric.name, phase="pre")
        targets = self._filter_devices(devices)

        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {
                pool.submit(self._run_pre_device, dev, mock, fail_checks or []): dev
                for dev in targets
            }
            for future in as_completed(futures):
                dev = futures[future]
                try:
                    suite = future.result()
                except Exception as e:
                    from .checks.base import CheckSuite, CheckResult, CheckStatus
                    suite = CheckSuite(device=dev.name, phase="pre")
                    suite.add(CheckResult(
                        name="collector_error", device=dev.name,
                        status=CheckStatus.ERROR,
                        message=f"Failed to collect from {dev.host}: {e}",
                        remediation="Check SSH credentials and device reachability",
                    ))
                report.suites.append(suite)

        report.suites.sort(key=lambda s: s.device)
        report.end_time = datetime.now().isoformat()
        return report

    def run_post(
        self,
        mock: bool = False,
        fail_checks: Optional[List[str]] = None,
        devices: Optional[List[str]] = None,
    ) -> ReadinessReport:
        """Run post-deployment checks across all (or specified) fabric devices."""
        report = ReadinessReport(fabric_name=self.fabric.name, phase="post")
        targets = self._filter_devices(devices)

        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {
                pool.submit(self._run_post_device, dev, mock, fail_checks or []): dev
                for dev in targets
            }
            for future in as_completed(futures):
                dev = futures[future]
                try:
                    suite = future.result()
                except Exception as e:
                    from .checks.base import CheckSuite, CheckResult, CheckStatus
                    suite = CheckSuite(device=dev.name, phase="post")
                    suite.add(CheckResult(
                        name="collector_error", device=dev.name,
                        status=CheckStatus.ERROR,
                        message=f"Failed to collect from {dev.host}: {e}",
                        remediation="Check SSH credentials and device reachability",
                    ))
                report.suites.append(suite)

        report.suites.sort(key=lambda s: s.device)
        report.end_time = datetime.now().isoformat()
        return report

    def run_both(
        self,
        mock: bool = False,
        fail_checks: Optional[List[str]] = None,
    ) -> Dict[str, ReadinessReport]:
        """Run pre then post checks. Returns {'pre': report, 'post': report}."""
        return {
            "pre": self.run_pre(mock=mock, fail_checks=fail_checks),
            "post": self.run_post(mock=mock, fail_checks=fail_checks),
        }

    def _filter_devices(self, names: Optional[List[str]]):
        all_devs = self.fabric.all_devices()
        if not names:
            return all_devs
        return [d for d in all_devs if d.name in names]
