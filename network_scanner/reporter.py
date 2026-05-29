"""Output formatters: text table, JSON, CSV."""

import json
import csv
import io
from typing import List, Union

from .models import ScanResult, HostResult


def _port_line(p) -> str:
    flags = []
    if p.https:
        flags.append("HTTPS")
    elif p.service in ("http", "http-alt"):
        flags.append("HTTP")
    flag_str = f" [{', '.join(flags)}]" if flags else ""
    title = f" | {p.http_title}" if p.http_title else ""
    banner = f" | {p.banner[:60]}" if p.banner and not p.http_title else ""
    return f"  {p.port:<6} {p.protocol.upper():<4} {p.state:<14} {p.service:<22}{flag_str}{title}{banner}"


def to_text(results: Union[ScanResult, List[ScanResult]]) -> str:
    if isinstance(results, ScanResult):
        results = [results]

    lines = []
    for scan in results:
        lines.append("=" * 72)
        lines.append(f"Network : {scan.network}")
        lines.append(f"Started : {scan.start_time}")
        lines.append(f"Finished: {scan.end_time}")
        alive = [h for h in scan.hosts if h.is_alive]
        lines.append(f"Hosts   : {len(alive)} alive / {len(scan.hosts)} scanned")
        lines.append(f"Ports   : {scan.total_open_ports} open")
        lines.append("")

        for host in scan.hosts:
            if not host.open_ports:
                continue
            hostname = f" ({host.hostname})" if host.hostname else ""
            lines.append(f"  Host: {host.ip}{hostname}  [{len(host.open_ports)} open ports]")
            lines.append(f"  {'PORT':<6} {'PROTO':<4} {'STATE':<14} {'SERVICE':<22}")
            lines.append("  " + "-" * 60)
            for p in host.open_ports:
                lines.append(_port_line(p))
            lines.append("")

    return "\n".join(lines)


def to_json(results: Union[ScanResult, List[ScanResult]], indent: int = 2) -> str:
    if isinstance(results, ScanResult):
        data = results.to_dict()
    else:
        data = [r.to_dict() for r in results]
    return json.dumps(data, indent=indent)


def to_csv(results: Union[ScanResult, List[ScanResult]]) -> str:
    if isinstance(results, ScanResult):
        results = [results]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "network", "ip", "hostname", "port", "protocol",
        "state", "service", "https", "http_title", "banner",
    ])

    for scan in results:
        for host in scan.hosts:
            for p in host.open_ports:
                writer.writerow([
                    scan.network, host.ip, host.hostname,
                    p.port, p.protocol, p.state, p.service,
                    p.https, p.http_title, p.banner,
                ])

    return buf.getvalue()


def save(results: Union[ScanResult, List[ScanResult]], path: str, fmt: str = "text") -> None:
    """Write results to a file. fmt: 'text' | 'json' | 'csv'."""
    formatters = {"text": to_text, "json": to_json, "csv": to_csv}
    if fmt not in formatters:
        raise ValueError(f"Unknown format '{fmt}'. Choose: text, json, csv")
    content = formatters[fmt](results)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
