"""Base classes for all pre/post deployment checks."""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Any, Dict
import time


class CheckStatus(Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARN = "WARN"
    SKIP = "SKIP"
    ERROR = "ERROR"


@dataclass
class CheckResult:
    name: str
    device: str
    status: CheckStatus
    message: str
    detail: str = ""
    expected: Any = None
    actual: Any = None
    remediation: str = ""
    elapsed: float = 0.0

    @property
    def passed(self) -> bool:
        return self.status == CheckStatus.PASS

    @property
    def failed(self) -> bool:
        return self.status in (CheckStatus.FAIL, CheckStatus.ERROR)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "device": self.device,
            "status": self.status.value,
            "message": self.message,
            "detail": self.detail,
            "expected": str(self.expected) if self.expected is not None else "",
            "actual": str(self.actual) if self.actual is not None else "",
            "remediation": self.remediation,
            "elapsed": round(self.elapsed, 3),
        }


@dataclass
class CheckSuite:
    """Collection of results from a full check run on one device."""
    device: str
    phase: str                              # pre | post
    results: List[CheckResult] = field(default_factory=list)
    start_time: float = field(default_factory=time.time)
    end_time: float = 0.0

    def add(self, result: CheckResult) -> None:
        self.results.append(result)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.PASS)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.failed)

    @property
    def warnings(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.WARN)

    @property
    def is_ready(self) -> bool:
        return self.failed == 0

    def summary(self) -> str:
        total = len(self.results)
        return (f"[{self.phase.upper()}] {self.device}: "
                f"{self.passed}/{total} passed, "
                f"{self.failed} failed, {self.warnings} warnings")

    def to_dict(self) -> dict:
        return {
            "device": self.device,
            "phase": self.phase,
            "is_ready": self.is_ready,
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "total": len(self.results),
            "results": [r.to_dict() for r in self.results],
        }


class BaseChecker:
    """
    Base class for pre/post checkers.
    Subclasses implement individual check methods; the collector
    provides parsed show command output as dicts.
    """

    def __init__(self, device_name: str, collector=None):
        self.device = device_name
        self.collector = collector          # SSHCollector or MockCollector

    def _result(
        self,
        name: str,
        status: CheckStatus,
        message: str,
        detail: str = "",
        expected=None,
        actual=None,
        remediation: str = "",
        elapsed: float = 0.0,
    ) -> CheckResult:
        return CheckResult(
            name=name,
            device=self.device,
            status=status,
            message=message,
            detail=detail,
            expected=expected,
            actual=actual,
            remediation=remediation,
            elapsed=elapsed,
        )

    def _pass(self, name: str, message: str, **kwargs) -> CheckResult:
        return self._result(name, CheckStatus.PASS, message, **kwargs)

    def _fail(self, name: str, message: str, remediation: str = "", **kwargs) -> CheckResult:
        return self._result(name, CheckStatus.FAIL, message, remediation=remediation, **kwargs)

    def _warn(self, name: str, message: str, **kwargs) -> CheckResult:
        return self._result(name, CheckStatus.WARN, message, **kwargs)

    def _skip(self, name: str, reason: str) -> CheckResult:
        return self._result(name, CheckStatus.SKIP, reason)

    def _error(self, name: str, exc: Exception) -> CheckResult:
        return self._result(name, CheckStatus.ERROR, f"Check error: {exc}",
                            remediation="Check SSH connectivity and credentials")
