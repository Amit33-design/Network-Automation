# Network-Automation — Port Scanner

A Python package that scans your internal network and discovers open TCP, UDP, HTTP, and HTTPS services across every host in every detected subnet.

## Features

| Capability | Details |
|---|---|
| **Auto segment discovery** | Detects local network interfaces and CIDRs automatically |
| **Host discovery** | ICMP ping + TCP probe fallback to find alive hosts |
| **TCP scanning** | Concurrent connect scan across top ports or custom ranges |
| **UDP scanning** | Payload-based probing for DNS, NTP, SNMP, TFTP, mDNS, SSDP, and more |
| **HTTP/HTTPS detection** | Probes every open TCP port for HTTP/HTTPS, extracts page title and Server header |
| **Banner grabbing** | Captures first-line service banners on open TCP ports |
| **Reverse DNS** | Resolves hostnames for discovered IPs |
| **Output formats** | Text table, JSON, CSV |
| **Parallelism** | Configurable thread pools for hosts and ports |

## Installation

```bash
pip install -r requirements.txt
pip install -e .
```

## Usage

### CLI

```bash
# Discover local network segments
netscan discover

# Scan all auto-detected local networks
netscan scan

# Scan a specific subnet
netscan scan 192.168.1.0/24

# Scan multiple subnets
netscan scan 10.0.0.0/24 10.0.1.0/24

# TCP-only scan, all ports 1-1024, save as JSON
netscan scan 192.168.0.0/24 --no-udp --tcp-ports 1-1024 -o results.json -f json

# Scan a single host
netscan host 192.168.1.1

# Single host, show JSON, save CSV
netscan host 10.0.0.1 --json -o host.csv -f csv

# Fast scan: more workers, no banners, no UDP
netscan scan --no-udp --no-banners --host-workers 50 --port-workers 100

# Conservative scan: longer timeouts, UDP confirmed only
netscan scan --udp-confirmed --tcp-timeout 3 --udp-timeout 5
```

### Python API

```python
from network_scanner import NetworkScanner
from network_scanner.scanner import ScanConfig
from network_scanner import reporter

# Default scan of all detected local networks
scanner = NetworkScanner()
results = scanner.scan_networks()

# Print text table
print(reporter.to_text(results))

# Save as JSON
reporter.save(results, "scan.json", fmt="json")

# Custom config: TCP only, specific ports
cfg = ScanConfig(
    tcp_ports=[22, 80, 443, 8080, 8443],
    scan_udp=False,
    scan_http=True,
    tcp_timeout=2.0,
    max_host_workers=30,
)
scanner = NetworkScanner(config=cfg)

# Scan a single network with progress bar
def progress(ip, cur, tot):
    print(f"\r  {cur}/{tot} {ip}", end="")

result = scanner.scan_network("192.168.1.0/24", progress_callback=progress)
print(f"\n{result.total_open_ports} open ports found")

# Scan a single host
host = scanner.scan_host("192.168.1.1")
for port in host.open_ports:
    print(f"{port.port}/{port.protocol}  {port.service}  {port.http_title}")
```

## Project Structure

```
network_scanner/
├── __init__.py          # Public API
├── models.py            # PortResult, HostResult, ScanResult dataclasses
├── network_discovery.py # Interface detection, host ping/probe
├── tcp_scanner.py       # TCP connect scan + banner grabbing
├── udp_scanner.py       # UDP probe scanner with per-service payloads
├── http_scanner.py      # HTTP/HTTPS title and server detection
├── scanner.py           # Orchestrator: NetworkScanner + ScanConfig
├── reporter.py          # Text, JSON, CSV formatters
└── cli.py               # argparse CLI: discover / scan / host
tests/
├── test_models.py
├── test_tcp_scanner.py
├── test_reporter.py
└── test_network_discovery.py
```

## Running Tests

```bash
pip install pytest
pytest tests/ -v
```

## Notes

- UDP scanning is inherently imprecise: ports with no response are `open|filtered`.
  Use `--udp-confirmed` to show only ports that sent back a confirmed response.
- Scanning large networks takes time. Tune `--host-workers` and `--port-workers`
  to balance speed vs. network load.
- Run with `sudo` / administrator privileges for ICMP ping; without it the scanner
  falls back to TCP probes for host discovery automatically.
