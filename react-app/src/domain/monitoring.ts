import type { IntentObject } from '../types/intent';
import type { DeviceEntry } from './bom';

function complianceThresholds(compliance: string[]) {
  const strict = compliance.some((c) => c.includes('PCI') || c.includes('HIPAA'));
  return {
    cpuWarnPct:  strict ? 70  : 80,
    cpuCritPct:  strict ? 85  : 95,
    errRateWarn: strict ? 50  : 100,
    errRateCrit: strict ? 200 : 500,
    bgpDownSec:  strict ? 30  : 60,
    ifDownSec:   strict ? 10  : 30,
  };
}

function hostRegex(devices: DeviceEntry[]): string {
  return devices.map((d) => d.hostname).join('|');
}

export function genPrometheusAlerts(
  devices: DeviceEntry[],
  intent: IntentObject,
  siteCode = 'SITE',
): string {
  if (!devices.length) return '# No devices — complete Step 1 first.\n';

  const thresh  = complianceThresholds(intent.security.compliance);
  const useCase = intent.use_case;
  const regex   = hostRegex(devices);
  const ts      = new Date().toISOString();

  return (
    `# NetDesign AI — Prometheus Alert Rules\n` +
    `# Site: ${siteCode} | Use-case: ${useCase}\n` +
    `# Generated: ${ts}\n` +
    `\ngroups:\n` +
    `\n  - name: ${siteCode}_bgp\n    rules:\n` +
    `\n    - alert: BGPSessionDown\n` +
    `      expr: bgp_session_up{instance=~"${regex}"} == 0\n` +
    `      for: ${thresh.bgpDownSec}s\n` +
    `      labels:\n        severity: critical\n        site: ${siteCode}\n` +
    `      annotations:\n        summary: "BGP session down on {{ $labels.instance }}"\n\n` +
    `    - alert: BGPPeerCountDrop\n` +
    `      expr: delta(bgp_session_up{instance=~"${regex}"}[5m]) < 0\n` +
    `      for: 2m\n` +
    `      labels:\n        severity: warning\n        site: ${siteCode}\n` +
    `      annotations:\n        summary: "BGP peer count decreased on {{ $labels.instance }}"\n\n` +
    `  - name: ${siteCode}_interfaces\n    rules:\n` +
    `\n    - alert: InterfaceDown\n` +
    `      expr: ifOperStatus{instance=~"${regex}",ifOperStatus="down"} == 1\n` +
    `      for: ${thresh.ifDownSec}s\n` +
    `      labels:\n        severity: critical\n        site: ${siteCode}\n` +
    `      annotations:\n        summary: "Interface down: {{ $labels.ifDescr }} on {{ $labels.instance }}"\n\n` +
    `    - alert: InterfaceErrorRateHigh\n` +
    `      expr: |\n` +
    `        rate(ifInErrors{instance=~"${regex}"}[5m]) +\n` +
    `        rate(ifOutErrors{instance=~"${regex}"}[5m]) > ${thresh.errRateWarn}\n` +
    `      for: 5m\n` +
    `      labels:\n        severity: warning\n        site: ${siteCode}\n` +
    `      annotations:\n        summary: "High error rate on {{ $labels.ifDescr }}"\n\n` +
    `  - name: ${siteCode}_cpu\n    rules:\n` +
    `\n    - alert: CPUHigh\n` +
    `      expr: cpu_usage_percent{instance=~"${regex}"} > ${thresh.cpuWarnPct}\n` +
    `      for: 10m\n` +
    `      labels:\n        severity: warning\n        site: ${siteCode}\n` +
    `      annotations:\n        summary: "CPU > ${thresh.cpuWarnPct}% on {{ $labels.instance }}"\n`
  );
}

export function genAnomalyRecordingRules(devices: DeviceEntry[]): string {
  if (!devices.length) return '# No devices.\n';
  const regex = hostRegex(devices);
  const metrics = [
    'ifInOctets', 'ifOutOctets', 'ifInErrors', 'ifOutErrors',
    'bgp_session_up', 'cpu_usage_percent',
  ];
  const groups = metrics.map((m) =>
    `    - record: ${m}_mean_10m\n` +
    `      expr: avg_over_time(${m}{instance=~"${regex}"}[10m])\n\n` +
    `    - record: ${m}_stddev_10m\n` +
    `      expr: stddev_over_time(${m}{instance=~"${regex}"}[10m])\n\n` +
    `    - record: ${m}_zscore\n` +
    `      expr: |\n` +
    `        (${m}{instance=~"${regex}"} - ${m}_mean_10m{instance=~"${regex}"})\n` +
    `        / (${m}_stddev_10m{instance=~"${regex}"} + 0.001)\n`,
  ).join('\n');

  return (
    `# NetDesign AI — Anomaly Recording Rules\n` +
    `# Generated: ${new Date().toISOString()}\n` +
    `groups:\n  - name: anomaly_recording\n    rules:\n\n` +
    groups
  );
}

export function genAnomalyAlertRules(devices: DeviceEntry[], sigmaThreshold = 3): string {
  if (!devices.length) return '# No devices.\n';
  const regex = hostRegex(devices);
  const metrics = ['ifInOctets', 'ifOutOctets', 'ifInErrors', 'cpu_usage_percent'];

  const rules = metrics.map((m) =>
    `    - alert: AnomalyDetected_${m}\n` +
    `      expr: abs(${m}_zscore{instance=~"${regex}"}) > ${sigmaThreshold}\n` +
    `      for: 5m\n` +
    `      labels:\n        severity: warning\n        type: anomaly\n` +
    `      annotations:\n` +
    `        summary: "Anomaly on {{ $labels.instance }}: ${m} z-score > ${sigmaThreshold}σ"\n` +
    `        description: "Metric ${m} deviates by {{ $value | humanize }}σ from 10-min baseline."\n`,
  ).join('\n');

  return (
    `# NetDesign AI — Anomaly Alert Rules (${sigmaThreshold}σ)\n` +
    `groups:\n  - name: anomaly_alerts\n    rules:\n\n` + rules
  );
}

export function genGnmicConfig(devices: DeviceEntry[], siteCode = 'SITE'): string {
  if (!devices.length) return '# No devices.\n';

  const targets = devices
    .filter((d) => ['spine','leaf','distribution'].includes(d.subLayer))
    .map((d) => `  ${d.hostname}:\n    address: ${d.hostname}:57400\n    username: \${NET_USER}\n    password: \${NET_PASS}\n    tls: false`)
    .join('\n');

  return (
    `# NetDesign AI — gNMI telemetry config (gnmic.yml)\n` +
    `# Site: ${siteCode}\n` +
    `targets:\n${targets}\n\n` +
    `subscriptions:\n` +
    `  if-stats:\n    paths:\n` +
    `      - /interfaces/interface/state/counters\n` +
    `    stream-mode: SAMPLE\n    sample-interval: 10s\n\n` +
    `  bgp-state:\n    paths:\n` +
    `      - /network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state\n` +
    `    stream-mode: ON_CHANGE\n\n` +
    `  system-cpu:\n    paths:\n` +
    `      - /system/cpus/cpu/state\n` +
    `    stream-mode: SAMPLE\n    sample-interval: 30s\n\n` +
    `outputs:\n  victoriametrics:\n    type: prometheus\n    listen: ":9273"\n    expiration-time: 5m\n`
  );
}

export function genDockerComposeMonitoring(siteCode = 'SITE'): string {
  return (
    `# NetDesign AI — Monitoring Stack (docker-compose.monitoring.yml)\n` +
    `# Site: ${siteCode}\n` +
    `version: "3.9"\nservices:\n\n` +
    `  victoriametrics:\n    image: victoriametrics/victoria-metrics:latest\n` +
    `    ports: ["8428:8428"]\n` +
    `    volumes:\n      - vm_data:/storage\n` +
    `    command: -retentionPeriod=90d\n\n` +
    `  grafana:\n    image: grafana/grafana:latest\n` +
    `    ports: ["3000:3000"]\n` +
    `    volumes:\n` +
    `      - grafana_data:/var/lib/grafana\n` +
    `      - ./monitoring/dashboards:/var/lib/grafana/dashboards:ro\n` +
    `      - ./monitoring/provisioning:/etc/grafana/provisioning:ro\n` +
    `    environment:\n      - GF_AUTH_ANONYMOUS_ENABLED=true\n\n` +
    `  snmp-exporter:\n    image: prom/snmp-exporter:latest\n` +
    `    ports: ["9116:9116"]\n` +
    `    volumes: ["./monitoring/snmp.yml:/etc/snmp_exporter/snmp.yml:ro"]\n\n` +
    `volumes:\n  vm_data:\n  grafana_data:\n`
  );
}

export function genScrapeConfigYaml(devices: DeviceEntry[], siteCode = 'SITE'): string {
  const targets = devices
    .filter((d) => d.hostname)
    .map((d) => `      - targets: ["${d.hostname}:9116"]\n        labels:\n          job: snmp\n          site: ${siteCode}\n          role: ${d.subLayer}`)
    .join('\n');

  return (
    `# Prometheus scrape config — generated by NetDesign AI\n` +
    `scrape_configs:\n` +
    `  - job_name: snmp_${siteCode.toLowerCase()}\n` +
    `    scrape_interval: 60s\n` +
    `    static_configs:\n${targets}\n`
  );
}

// Re-export intent for callers that need it inline
export type { IntentObject };
