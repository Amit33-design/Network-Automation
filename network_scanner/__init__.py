"""Network Port Scanner - scan TCP, UDP, HTTP, HTTPS across network segments."""

__version__ = "1.0.0"
__author__ = "Network-Automation"

from .scanner import NetworkScanner
from .models import ScanResult, HostResult, PortResult

__all__ = ["NetworkScanner", "ScanResult", "HostResult", "PortResult"]
