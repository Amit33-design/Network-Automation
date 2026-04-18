"""Command-line interface for the network port scanner."""

import argparse
import sys
import json
import time
from typing import List, Optional

from .scanner import NetworkScanner, ScanConfig
from .network_discovery import get_local_networks
from .tcp_scanner import TOP_PORTS_TCP
from .udp_scanner import TOP_PORTS_UDP
from . import reporter


def _parse_ports(port_str: str) -> List[int]:
    """Parse port spec like '22,80,443' or '1-1024' or '22,80-90,443'."""
    ports = set()
    for part in port_str.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            ports.update(range(int(lo), int(hi) + 1))
        else:
            ports.add(int(part))
    return sorted(ports)


def _progress(network: str, ip: str, current: int, total: int) -> None:
    bar_len = 30
    filled = int(bar_len * current / total) if total else bar_len
    bar = "#" * filled + "." * (bar_len - filled)
    print(f"\r  [{bar}] {current}/{total}  {ip:<18}", end="", flush=True)
    if current == total:
        print()


def cmd_discover(args) -> None:
    print("Detecting local network segments...")
    networks = get_local_networks()
    if not networks:
        print("  No networks detected.")
        return
    for net in networks:
        print(f"  {net}")


def cmd_scan(args) -> None:
    # Build port lists
    tcp_ports = _parse_ports(args.tcp_ports) if args.tcp_ports else TOP_PORTS_TCP
    udp_ports = _parse_ports(args.udp_ports) if args.udp_ports else TOP_PORTS_UDP

    cfg = ScanConfig(
        tcp_ports=tcp_ports,
        udp_ports=udp_ports,
        tcp_timeout=args.tcp_timeout,
        udp_timeout=args.udp_timeout,
        http_timeout=args.http_timeout,
        host_timeout=args.host_timeout,
        max_host_workers=args.host_workers,
        max_port_workers=args.port_workers,
        scan_tcp=not args.no_tcp,
        scan_udp=not args.no_udp,
        scan_http=not args.no_http,
        grab_banners=not args.no_banners,
        udp_confirmed_only=args.udp_confirmed,
        resolve_hostnames=not args.no_resolve,
    )
    scanner = NetworkScanner(config=cfg)

    # Determine networks to scan
    networks = args.networks if args.networks else get_local_networks()
    if not networks:
        print("Error: No networks found. Specify with --networks 192.168.1.0/24")
        sys.exit(1)

    print(f"Scanning {len(networks)} network(s): {', '.join(networks)}")
    all_results = []

    for net in networks:
        print(f"\n[+] Network: {net}")
        start = time.time()

        def progress(ip, cur, tot):
            _progress(net, ip, cur, tot)

        result = scanner.scan_network(net, progress_callback=progress)
        elapsed = time.time() - start
        alive = sum(1 for h in result.hosts if h.is_alive)
        print(f"    Done in {elapsed:.1f}s — {alive} hosts alive, {result.total_open_ports} open ports")
        all_results.append(result)

    # Print results
    output = reporter.to_text(all_results)
    print("\n" + output)

    # Save if requested
    if args.output:
        fmt = args.format
        reporter.save(all_results, args.output, fmt=fmt)
        print(f"Results saved to: {args.output} ({fmt})")


def cmd_host(args) -> None:
    """Scan a single host."""
    tcp_ports = _parse_ports(args.tcp_ports) if args.tcp_ports else TOP_PORTS_TCP
    udp_ports = _parse_ports(args.udp_ports) if args.udp_ports else TOP_PORTS_UDP

    cfg = ScanConfig(
        tcp_ports=tcp_ports,
        udp_ports=udp_ports,
        scan_tcp=not args.no_tcp,
        scan_udp=not args.no_udp,
        scan_http=not args.no_http,
        grab_banners=not args.no_banners,
        udp_confirmed_only=args.udp_confirmed,
    )
    scanner = NetworkScanner(config=cfg)

    print(f"Scanning host: {args.ip}")
    result = scanner.scan_host(args.ip)

    if not result.open_ports:
        print("  No open ports found.")
        return

    print(f"\n  {len(result.open_ports)} open ports on {args.ip}:\n")
    print(f"  {'PORT':<6} {'PROTO':<5} {'STATE':<14} {'SERVICE':<20} INFO")
    print("  " + "-" * 70)
    for p in result.open_ports:
        info = p.http_title or p.banner or ""
        flag = " [HTTPS]" if p.https else (" [HTTP]" if p.http_title else "")
        print(f"  {p.port:<6} {p.protocol.upper():<5} {p.state:<14} {p.service:<20} {info[:40]}{flag}")

    if args.json:
        print("\nJSON:\n" + json.dumps(result.to_dict(), indent=2))

    if args.output:
        from .models import ScanResult
        from datetime import datetime
        scan = ScanResult(network=args.ip, hosts=[result])
        scan.total_open_ports = len(result.open_ports)
        scan.end_time = datetime.now().isoformat()
        reporter.save(scan, args.output, fmt=args.format)
        print(f"\nResults saved to: {args.output}")


def _add_common_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--tcp-ports", metavar="PORTS",
                   help="TCP ports to scan, e.g. '22,80,443' or '1-1024'")
    p.add_argument("--udp-ports", metavar="PORTS",
                   help="UDP ports to scan")
    p.add_argument("--no-tcp", action="store_true", help="Skip TCP scanning")
    p.add_argument("--no-udp", action="store_true", help="Skip UDP scanning")
    p.add_argument("--no-http", action="store_true", help="Skip HTTP/HTTPS probing")
    p.add_argument("--no-banners", action="store_true", help="Skip banner grabbing")
    p.add_argument("--no-resolve", action="store_true", help="Skip reverse DNS")
    p.add_argument("--udp-confirmed", action="store_true",
                   help="Only report UDP ports with confirmed responses")
    p.add_argument("--tcp-timeout", type=float, default=1.5, metavar="SEC")
    p.add_argument("--udp-timeout", type=float, default=2.0, metavar="SEC")
    p.add_argument("--http-timeout", type=float, default=4.0, metavar="SEC")
    p.add_argument("--host-timeout", type=float, default=1.0, metavar="SEC")
    p.add_argument("--port-workers", type=int, default=50, metavar="N",
                   help="Concurrent port scan threads per host")
    p.add_argument("-o", "--output", metavar="FILE", help="Save results to file")
    p.add_argument("-f", "--format", choices=["text", "json", "csv"], default="text",
                   help="Output format (default: text)")
    p.add_argument("--json", action="store_true", help="Also print JSON to stdout")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="netscan",
        description="Network Port Scanner — TCP, UDP, HTTP, HTTPS across network segments",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  netscan discover                         # Show local network segments
  netscan scan                             # Scan all detected local networks
  netscan scan --networks 192.168.1.0/24   # Scan a specific subnet
  netscan scan --no-udp --tcp-ports 1-1024 # TCP-only, full port range
  netscan host 192.168.1.1                 # Scan a single host
  netscan host 10.0.0.1 --json -o out.json # Single host, save as JSON
        """,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # discover
    sub.add_parser("discover", help="List detected local network segments")

    # scan
    scan_p = sub.add_parser("scan", help="Scan network segments")
    scan_p.add_argument("networks", nargs="*", metavar="CIDR",
                        help="Networks to scan (default: auto-detect)")
    scan_p.add_argument("--host-workers", type=int, default=20, metavar="N",
                        help="Concurrent host scan threads")
    _add_common_args(scan_p)

    # host
    host_p = sub.add_parser("host", help="Scan a single host")
    host_p.add_argument("ip", metavar="IP", help="Target IP or hostname")
    _add_common_args(host_p)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {"discover": cmd_discover, "scan": cmd_scan, "host": cmd_host}
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
