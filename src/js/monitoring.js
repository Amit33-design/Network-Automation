'use strict';

// ─── Prometheus Alert Rules ───────────────────────────────────────────────────

function _complianceThresholds(compliance) {
  // Tighten CPU/error thresholds for regulated workloads
  var strict = compliance && (compliance.includes('PCI') || compliance.includes('HIPAA'));
  return {
    cpuWarnPct:    strict ? 70  : 80,
    cpuCritPct:    strict ? 85  : 95,
    errRateWarn:   strict ? 50  : 100,
    errRateCrit:   strict ? 200 : 500,
    bgpDownSec:    strict ? 30  : 60,
    ifDownSec:     strict ? 10  : 30
  };
}

window.genPrometheusAlerts = function(devices, state) {
  if (!devices || !devices.length) return '# No devices — complete Step 1 first.\n';

  var site = (state && state.siteCode) || 'SITE';
  var thresh = _complianceThresholds(state && state.compliance);
  var useCase = (state && state.useCase) || 'dc';

  // Build label selector from device hostnames
  var hostRegex = devices.map(function(d) { return d.hostname; }).join('|');

  var lines = [
    '# NetDesign AI — Prometheus Alert Rules',
    '# Site: ' + site + ' | Use-case: ' + useCase,
    '# Generated: ' + new Date().toISOString(),
    '# Apply with: kubectl apply -f alerts-' + site.toLowerCase() + '.yml',
    '#             or copy to /etc/prometheus/rules/',
    '',
    'groups:',
    '',
    '  - name: ' + site + '_bgp',
    '    rules:',
    '',
    '    - alert: BGPSessionDown',
    '      expr: |',
    '        bgp_session_up{instance=~"' + hostRegex + '"} == 0',
    '      for: ' + thresh.bgpDownSec + 's',
    '      labels:',
    '        severity: critical',
    '        site: ' + site,
    '      annotations:',
    '        summary: "BGP session down on {{ $labels.instance }}"',
    '        description: |',
    '          BGP session {{ $labels.peer }} on {{ $labels.instance }} has been down',
    '          for more than ' + thresh.bgpDownSec + ' seconds.',
    '',
    '    - alert: BGPPeerCountDrop',
    '      expr: |',
    '        (bgp_session_up{instance=~"' + hostRegex + '"} unless bgp_session_up offset 5m)',
    '        < 0',
    '      for: 2m',
    '      labels:',
    '        severity: warning',
    '        site: ' + site,
    '      annotations:',
    '        summary: "BGP peer count decreased on {{ $labels.instance }}"',
    '        description: "One or more BGP sessions have gone down in the last 5 minutes."',
    '',
    '    - alert: BGPPrefixLimitExceeded',
    '      expr: |',
    '        bgp_prefix_received{instance=~"' + hostRegex + '"} > 12000',
    '      for: 1m',
    '      labels:',
    '        severity: warning',
    '        site: ' + site,
    '      annotations:',
    '        summary: "BGP prefix limit approaching on {{ $labels.instance }}"',
    '        description: "Received {{ $value }} prefixes from peer {{ $labels.peer }}."',
    '',
    '  - name: ' + site + '_interfaces',
    '    rules:',
    '',
    '    - alert: InterfaceDown',
    '      expr: |',
    '        ifOperStatus{instance=~"' + hostRegex + '", ifOperStatus="down"} == 1',
    '      for: ' + thresh.ifDownSec + 's',
    '      labels:',
    '        severity: critical',
    '        site: ' + site,
    '      annotations:',
    '        summary: "Interface down: {{ $labels.ifDescr }} on {{ $labels.instance }}"',
    '        description: |',
    '          Interface {{ $labels.ifDescr }} on {{ $labels.instance }} is operationally',
    '          down for more than ' + thresh.ifDownSec + ' seconds.',
    '',
    '    - alert: InterfaceErrorRateHigh',
    '      expr: |',
    '        rate(ifInErrors{instance=~"' + hostRegex + '"}[5m]) +',
    '        rate(ifOutErrors{instance=~"' + hostRegex + '"}[5m]) > ' + thresh.errRateWarn,
    '      for: 5m',
    '      labels:',
    '        severity: warning',
    '        site: ' + site,
    '      annotations:',
    '        summary: "High interface error rate on {{ $labels.instance }}"',
    '        description: |',
    '          Interface {{ $labels.ifDescr }} error rate is {{ $value | humanize }}/s',
    '          (threshold: ' + thresh.errRateWarn + '/s).',
    '',
    '    - alert: InterfaceErrorRateCritical',
    '      expr: |',
    '        rate(ifInErrors{instance=~"' + hostRegex + '"}[5m]) +',
    '        rate(ifOutErrors{instance=~"' + hostRegex + '"}[5m]) > ' + thresh.errRateCrit,
    '      for: 2m',
    '      labels:',
    '        severity: critical',
    '        site: ' + site,
    '      annotations:',
    '        summary: "Critical interface error rate on {{ $labels.instance }}"',
    '        description: |',
    '          Error rate {{ $value | humanize }}/s exceeds critical threshold of ' + thresh.errRateCrit + '/s.',
    '',
    '    - alert: InterfaceUtilizationHigh',
    '      expr: |',
    '        (rate(ifHCInOctets{instance=~"' + hostRegex + '"}[5m]) * 8)',
    '        / (ifHighSpeed{instance=~"' + hostRegex + '"} * 1e6) > 0.80',
    '      for: 10m',
    '      labels:',
    '        severity: warning',
    '        site: ' + site,
    '      annotations:',
    '        summary: "Interface utilization >80% on {{ $labels.instance }}"',
    '        description: |',
    '          {{ $labels.ifDescr }} is at {{ $value | humanizePercentage }} utilization.',
    '',
    '  - name: ' + site + '_system',
    '    rules:',
    '',
    '    - alert: DeviceCPUHigh',
    '      expr: |',
    '        system_cpu_util{instance=~"' + hostRegex + '"} > ' + thresh.cpuWarnPct,
    '      for: 10m',
    '      labels:',
    '        severity: warning',
    '        site: ' + site,
    '      annotations:',
    '        summary: "CPU high on {{ $labels.instance }}"',
    '        description: "CPU utilization is {{ $value }}% (warn: ' + thresh.cpuWarnPct + '%)."',
    '',
    '    - alert: DeviceCPUCritical',
    '      expr: |',
    '        system_cpu_util{instance=~"' + hostRegex + '"} > ' + thresh.cpuCritPct,
    '      for: 5m',
    '      labels:',
    '        severity: critical',
    '        site: ' + site,
    '      annotations:',
    '        summary: "CPU critical on {{ $labels.instance }}"',
    '        description: "CPU utilization is {{ $value }}% (crit: ' + thresh.cpuCritPct + '%)."',
    '',
    '    - alert: DeviceUnreachable',
    '      expr: |',
    '        up{instance=~"' + hostRegex + '"} == 0',
    '      for: 2m',
    '      labels:',
    '        severity: critical',
    '        site: ' + site,
    '      annotations:',
    '        summary: "Device unreachable: {{ $labels.instance }}"',
    '        description: "SNMP/API scrape for {{ $labels.instance }} has been failing for 2+ minutes."',
  ];

  // GPU-specific alerts
  if (useCase === 'gpu') {
    lines = lines.concat([
      '',
      '  - name: ' + site + '_gpu_fabric',
      '    rules:',
      '',
      '    - alert: RoCEv2CongestDrops',
      '      expr: |',
      '        rate(roce_cnp_sent{instance=~"' + hostRegex + '"}[1m]) > 1000',
      '      for: 1m',
      '      labels:',
      '        severity: warning',
      '        site: ' + site,
      '      annotations:',
      '        summary: "RoCEv2 congestion on {{ $labels.instance }}"',
      '        description: "High CNP (Congestion Notification Packet) rate: {{ $value }}/s. Check PFC/ECN config."',
      '',
      '    - alert: PFCWatchdogTriggered',
      '      expr: |',
      '        pfc_watchdog_detected{instance=~"' + hostRegex + '"} > 0',
      '      for: 0s',
      '      labels:',
      '        severity: critical',
      '        site: ' + site,
      '      annotations:',
      '        summary: "PFC watchdog triggered on {{ $labels.instance }}"',
      '        description: "PFC deadlock detected on interface {{ $labels.ifDescr }}."',
    ]);
  }

  lines.push('');
  return lines.join('\n');
};

// ─── Grafana Dashboard JSON ───────────────────────────────────────────────────

function _grafanaPanel(id, title, expr, unit, gridPos) {
  return {
    id: id,
    title: title,
    type: 'timeseries',
    gridPos: gridPos,
    datasource: { type: 'prometheus', uid: 'prometheus' },
    fieldConfig: {
      defaults: {
        unit: unit || 'short',
        color: { mode: 'palette-classic' },
        custom: { lineWidth: 1, fillOpacity: 8 }
      }
    },
    options: { tooltip: { mode: 'multi' } },
    targets: [{
      expr: expr,
      legendFormat: '{{instance}} — {{ifDescr}}',
      refId: 'A'
    }]
  };
}

function _grafanaStatPanel(id, title, expr, unit, gridPos) {
  return {
    id: id,
    title: title,
    type: 'stat',
    gridPos: gridPos,
    datasource: { type: 'prometheus', uid: 'prometheus' },
    fieldConfig: {
      defaults: {
        unit: unit || 'short',
        thresholds: {
          mode: 'absolute',
          steps: [
            { color: 'green', value: null },
            { color: 'yellow', value: 0.7 },
            { color: 'red', value: 0.9 }
          ]
        }
      }
    },
    options: { reduceOptions: { calcs: ['lastNotNull'] }, orientation: 'auto', textMode: 'auto', colorMode: 'background' },
    targets: [{ expr: expr, legendFormat: '{{instance}}', refId: 'A' }]
  };
}

window.genGrafanaDashboard = function(devices, state) {
  if (!devices || !devices.length) return '{}';

  var site    = (state && state.siteCode) || 'SITE';
  var useCase = (state && state.useCase) || 'dc';
  var hostRegex = devices.map(function(d) { return d.hostname; }).join('|');

  // Group devices by role for variable options
  var roles = {};
  devices.forEach(function(d) {
    var r = d.subLayer || d.role || 'device';
    if (!roles[r]) roles[r] = [];
    roles[r].push(d.hostname);
  });

  var panels = [];
  var pid = 1;

  // Row: Overview stats
  panels.push({
    id: pid++, title: site + ' — Overview',
    type: 'row', gridPos: { x: 0, y: 0, w: 24, h: 1 }, collapsed: false
  });

  panels.push(_grafanaStatPanel(pid++, 'Devices Reachable',
    'count(up{instance=~"' + hostRegex + '"} == 1)',
    'short', { x: 0, y: 1, w: 4, h: 4 }));

  panels.push(_grafanaStatPanel(pid++, 'BGP Sessions Up',
    'sum(bgp_session_up{instance=~"' + hostRegex + '"}) or vector(0)',
    'short', { x: 4, y: 1, w: 4, h: 4 }));

  panels.push(_grafanaStatPanel(pid++, 'Interfaces Down',
    'count(ifOperStatus{instance=~"' + hostRegex + '", ifOperStatus="down"}) or vector(0)',
    'short', { x: 8, y: 1, w: 4, h: 4 }));

  panels.push(_grafanaStatPanel(pid++, 'Avg CPU %',
    'avg(system_cpu_util{instance=~"' + hostRegex + '"}) or vector(0)',
    'percent', { x: 12, y: 1, w: 4, h: 4 }));

  // Row: Interface Utilization
  panels.push({
    id: pid++, title: 'Interface Utilization',
    type: 'row', gridPos: { x: 0, y: 5, w: 24, h: 1 }, collapsed: false
  });

  panels.push(_grafanaPanel(pid++, 'Inbound Traffic (bps)',
    '(rate(ifHCInOctets{instance=~"' + hostRegex + '"}[5m]) * 8)',
    'bps', { x: 0, y: 6, w: 12, h: 8 }));

  panels.push(_grafanaPanel(pid++, 'Outbound Traffic (bps)',
    '(rate(ifHCOutOctets{instance=~"' + hostRegex + '"}[5m]) * 8)',
    'bps', { x: 12, y: 6, w: 12, h: 8 }));

  // Row: Errors
  panels.push({
    id: pid++, title: 'Interface Errors',
    type: 'row', gridPos: { x: 0, y: 14, w: 24, h: 1 }, collapsed: false
  });

  panels.push(_grafanaPanel(pid++, 'Input Error Rate (errors/s)',
    'rate(ifInErrors{instance=~"' + hostRegex + '"}[5m])',
    'short', { x: 0, y: 15, w: 12, h: 8 }));

  panels.push(_grafanaPanel(pid++, 'Output Error Rate (errors/s)',
    'rate(ifOutErrors{instance=~"' + hostRegex + '"}[5m])',
    'short', { x: 12, y: 15, w: 12, h: 8 }));

  // Row: BGP
  panels.push({
    id: pid++, title: 'BGP',
    type: 'row', gridPos: { x: 0, y: 23, w: 24, h: 1 }, collapsed: false
  });

  panels.push(_grafanaPanel(pid++, 'BGP Sessions Up/Down',
    'bgp_session_up{instance=~"' + hostRegex + '"}',
    'short', { x: 0, y: 24, w: 12, h: 8 }));

  panels.push(_grafanaPanel(pid++, 'BGP Prefixes Received',
    'bgp_prefix_received{instance=~"' + hostRegex + '"}',
    'short', { x: 12, y: 24, w: 12, h: 8 }));

  // Row: System
  panels.push({
    id: pid++, title: 'System Resources',
    type: 'row', gridPos: { x: 0, y: 32, w: 24, h: 1 }, collapsed: false
  });

  panels.push(_grafanaPanel(pid++, 'CPU Utilization (%)',
    'system_cpu_util{instance=~"' + hostRegex + '"}',
    'percent', { x: 0, y: 33, w: 12, h: 8 }));

  panels.push(_grafanaPanel(pid++, 'Memory Utilization (%)',
    'system_mem_util{instance=~"' + hostRegex + '"}',
    'percent', { x: 12, y: 33, w: 12, h: 8 }));

  // GPU panels when use_case = gpu
  if (useCase === 'gpu') {
    panels.push({
      id: pid++, title: 'GPU Fabric (RoCEv2)',
      type: 'row', gridPos: { x: 0, y: 41, w: 24, h: 1 }, collapsed: false
    });
    panels.push(_grafanaPanel(pid++, 'CNP Rate (congestion notifications/s)',
      'rate(roce_cnp_sent{instance=~"' + hostRegex + '"}[1m])',
      'short', { x: 0, y: 42, w: 12, h: 8 }));
    panels.push(_grafanaPanel(pid++, 'PFC Watchdog Events',
      'increase(pfc_watchdog_detected{instance=~"' + hostRegex + '"}[5m])',
      'short', { x: 12, y: 42, w: 12, h: 8 }));
  }

  var dashboard = {
    uid: 'ndal-' + site.toLowerCase(),
    title: 'NetDesign AI — ' + site,
    description: 'Auto-generated by NetDesign AI for site ' + site + ' (' + useCase + ')',
    tags: ['netdesign-ai', site.toLowerCase(), useCase],
    timezone: 'browser',
    refresh: '30s',
    schemaVersion: 38,
    version: 1,
    time: { from: 'now-1h', to: 'now' },
    templating: {
      list: [{
        name: 'instance',
        type: 'query',
        label: 'Device',
        datasource: { type: 'prometheus', uid: 'prometheus' },
        definition: 'label_values(up, instance)',
        query: 'label_values(up{instance=~"' + hostRegex + '"}, instance)',
        multi: true,
        includeAll: true,
        current: { selected: true, text: 'All', value: '$__all' }
      }]
    },
    panels: panels
  };

  return JSON.stringify({ dashboard: dashboard, overwrite: true, folderId: 0 }, null, 2);
};

// ─── G-33: Docker Compose Monitoring Stack ────────────────────────────────────

window.genDockerComposeMonitoring = function(devices, state) {
  var site = (state && state.siteCode) || 'SITE';
  return [
    '# NetDesign AI — Monitoring Stack',
    '# Site: ' + site + ' | Generated: ' + new Date().toISOString(),
    '# Usage: docker compose -f monitoring-stack.yml up -d',
    '',
    'services:',
    '',
    '  victoriametrics:',
    '    image: victoriametrics/victoria-metrics:latest',
    '    ports: ["8428:8428"]',
    '    volumes:',
    '      - vm_data:/storage',
    '      - ./monitoring/scrape.yml:/etc/prometheus/prometheus.yml:ro',
    '    command:',
    '      - -retentionPeriod=90d',
    '      - -promscrape.config=/etc/prometheus/prometheus.yml',
    '    restart: unless-stopped',
    '',
    '  grafana:',
    '    image: grafana/grafana:latest',
    '    ports: ["3000:3000"]',
    '    volumes:',
    '      - grafana_data:/var/lib/grafana',
    '      - ./monitoring/dashboards:/var/lib/grafana/dashboards:ro',
    '      - ./monitoring/provisioning:/etc/grafana/provisioning:ro',
    '    environment:',
    '      - GF_AUTH_ANONYMOUS_ENABLED=true',
    '      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin',
    '      - GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH=/var/lib/grafana/dashboards/network.json',
    '    restart: unless-stopped',
    '    depends_on: [victoriametrics]',
    '',
    '  snmp-exporter:',
    '    image: prom/snmp-exporter:latest',
    '    ports: ["9116:9116"]',
    '    volumes:',
    '      - ./monitoring/snmp.yml:/etc/snmp_exporter/snmp.yml:ro',
    '    restart: unless-stopped',
    '',
    '  gnmic:',
    '    image: ghcr.io/openconfig/gnmic:latest',
    '    ports: ["9804:9804"]',
    '    volumes:',
    '      - ./monitoring/gnmic.yml:/app/gnmic.yml:ro',
    '    command: subscribe --config /app/gnmic.yml',
    '    restart: unless-stopped',
    '    environment:',
    '      - NET_USER=${NET_USER:-admin}',
    '      - NET_PASS=${NET_PASS:-}',
    '',
    'volumes:',
    '  vm_data:',
    '  grafana_data:',
  ].join('\n');
};

window.genScrapeConfigYaml = function(devices, state) {
  var site = (state && state.siteCode) || 'SITE';
  var targets = (devices || []).map(function(d) {
    return '      - ' + (d.mgmtIp || ('192.168.1.' + (d.unit || 1))) + '  # ' + d.hostname;
  }).join('\n');
  return [
    '# monitoring/scrape.yml — VictoriaMetrics scrape config',
    '# Site: ' + site + ' | Generated: ' + new Date().toISOString(),
    '',
    'global:',
    '  scrape_interval: 30s',
    '  evaluation_interval: 30s',
    '',
    'scrape_configs:',
    '',
    '  - job_name: network_snmp',
    '    metrics_path: /snmp',
    '    params:',
    '      module: [if_mib, bgp4_v2]',
    '    static_configs:',
    '      - targets:',
    targets,
    '    relabel_configs:',
    '      - source_labels: [__address__]',
    '        target_label: __param_target',
    '      - source_labels: [__param_target]',
    '        target_label: instance',
    '      - target_label: __address__',
    '        replacement: snmp-exporter:9116',
    '',
    '  - job_name: gnmic_streaming',
    '    honor_labels: true',
    '    static_configs:',
    '      - targets: ["gnmic:9804"]',
    '',
    '  - job_name: victoriametrics_self',
    '    static_configs:',
    '      - targets: ["victoriametrics:8428"]',
  ].join('\n');
};

window.genGrafanaDatasourceYaml = function() {
  return [
    '# monitoring/provisioning/datasources/victoria.yml',
    '# Grafana auto-provisions this datasource on startup.',
    'apiVersion: 1',
    '',
    'datasources:',
    '  - name: VictoriaMetrics',
    '    type: prometheus',
    '    uid: prometheus',
    '    url: http://victoriametrics:8428',
    '    access: proxy',
    '    isDefault: true',
    '    editable: false',
    '    jsonData:',
    '      timeInterval: "30s"',
  ].join('\n');
};

window.genGrafanaDashboardProvisionYaml = function() {
  return [
    '# monitoring/provisioning/dashboards/dashboards.yml',
    '# Grafana auto-loads dashboard JSON files from the dashboards/ directory.',
    'apiVersion: 1',
    '',
    'providers:',
    '  - name: NetDesign AI',
    '    folder: Network',
    '    type: file',
    '    disableDeletion: false',
    '    updateIntervalSeconds: 30',
    '    allowUiUpdates: true',
    '    options:',
    '      path: /var/lib/grafana/dashboards',
  ].join('\n');
};

// ─── G-34: gNMI / Streaming Telemetry ────────────────────────────────────────

// Per-platform gNMI device-side configuration
var GNMI_DEVICE_CONFIGS = {
  nxos: function(collectorIp) {
    return [
      '! NX-OS — enable gNMI/telemetry (dial-out to gnmic collector)',
      'feature telemetry',
      '!',
      'telemetry',
      '  destination-group 1',
      '    ip address ' + collectorIp + ' port 57000 protocol gRPC encoding GPB',
      '  !',
      '  sensor-group 1',
      '    data-source NX-API',
      '    path sys/intf depth unbounded',
      '    path sys/bgp/inst depth unbounded',
      '  !',
      '  sensor-group 2',
      '    data-source DME',
      '    path sys/procsys/syscpusummary depth unbounded',
      '    path sys/procsys depth unbounded',
      '  !',
      '  subscription 1',
      '    dst-grp 1',
      '    snsr-grp 1 sample-interval 30000',
      '    snsr-grp 2 sample-interval 60000',
    ].join('\n');
  },
  eos: function(collectorIp) {
    return [
      '! Arista EOS — enable gNMI (dial-in mode; gnmic connects to device port 6030)',
      'management api gnmi',
      '   transport grpc default',
      '   !',
      '   provider eos-native',
      '!',
      '! Optional: dial-out streaming',
      'management telemetry',
      '   interval 30000',
      '! gnmic dials in — ensure device is reachable from collector at port 6030',
      '! Collector IP for reference: ' + collectorIp,
    ].join('\n');
  },
  junos: function(collectorIp) {
    return [
      '# Juniper JunOS — enable gNMI (dial-in port 57400) + dial-out streaming',
      'set system services extension-service request-response grpc clear-text port 57400',
      'set system services extension-service request-response grpc max-connections 30',
      '# Dial-out streaming to gnmic collector:',
      'set services analytics streaming-server ndal-gnmic remote-address ' + collectorIp,
      'set services analytics streaming-server ndal-gnmic remote-port 57000',
      'set services analytics export-profile ndal-profile local-address 0.0.0.0',
      'set services analytics export-profile ndal-profile local-port 57400',
      'set services analytics export-profile ndal-profile reporting-rate 30000',
      'set services analytics export-profile ndal-profile format gpb',
      'set services analytics sensor if-sensor server-name ndal-gnmic',
      'set services analytics sensor if-sensor export-name ndal-profile',
      'set services analytics sensor if-sensor resource /interfaces/',
      'set services analytics sensor bgp-sensor resource /network-instances/',
    ].join('\n');
  },
  sonic: function(collectorIp) {
    return [
      '# NVIDIA SONiC — gNMI telemetry is built-in on port 8080',
      '# Verify it is running:',
      'sudo systemctl status telemetry',
      '',
      '# Start / enable if not running:',
      'sudo systemctl enable telemetry',
      'sudo systemctl start telemetry',
      '',
      '# gnmic connects to port 8080 (insecure) or 57400 (TLS):',
      '# No device-side subscription config needed for dial-in mode.',
      '# Collector IP for reference: ' + collectorIp,
    ].join('\n');
  }
};

window.genGnmicYaml = function(devices, state) {
  var collectorIp = (state && state.monitoringCollectorIp) || '10.0.0.100';

  function gnmiPort(dev) {
    var v = (dev.vendor || '').toLowerCase();
    if (v.includes('arista')) return '6030';
    if (v.includes('nvidia') || v.includes('sonic')) return '8080';
    return '57400';  // NX-OS, JunOS, standard
  }

  var targetLines = (devices || []).map(function(d) {
    var ip   = d.mgmtIp || ('192.168.1.' + (d.unit || 1));
    var port = gnmiPort(d);
    return [
      '  ' + ip + ':' + port + ':',
      '    name: ' + d.hostname,
      '    insecure: true',
      '    skip-verify: true',
    ].join('\n');
  }).join('\n\n');

  return [
    '# monitoring/gnmic.yml — gnmic gNMI collector config (G-34)',
    '# Site: ' + ((state && state.siteCode) || 'SITE') + ' | Generated: ' + new Date().toISOString(),
    '# Run via docker compose (monitoring-stack.yml) or standalone:',
    '#   gnmic subscribe --config monitoring/gnmic.yml',
    '',
    'username: ${NET_USER}',
    'password: ${NET_PASS}',
    'insecure: true',
    'skip-verify: true',
    'encoding: proto',
    'log: true',
    '',
    'targets:',
    targetLines,
    '',
    'subscriptions:',
    '',
    '  interface-counters:',
    '    paths:',
    '      - /interfaces/interface/state/counters',
    '    mode: stream',
    '    stream-mode: sample',
    '    sample-interval: 30s',
    '    encoding: proto',
    '',
    '  interface-oper-state:',
    '    paths:',
    '      - /interfaces/interface/state/oper-status',
    '    mode: stream',
    '    stream-mode: on_change',
    '    encoding: proto',
    '',
    '  bgp-session-state:',
    '    paths:',
    '      - /network-instances/network-instance/protocols/protocol/bgp/neighbors/neighbor/state',
    '    mode: stream',
    '    stream-mode: sample',
    '    sample-interval: 60s',
    '    encoding: proto',
    '',
    '  system-resources:',
    '    paths:',
    '      - /system/cpus/cpu/state',
    '      - /system/memory/state',
    '    mode: stream',
    '    stream-mode: sample',
    '    sample-interval: 60s',
    '    encoding: proto',
    '',
    'outputs:',
    '',
    '  prometheus-output:',
    '    type: prometheus',
    '    listen: :9804',
    '    path: /metrics',
    '    expiration-time: 10m',
    '    metric-name-prefix: gnmi_',
    '    strings-as-labels: true',
  ].join('\n');
};

window.genGnmiDeviceConfigs = function(devices, state) {
  var collectorIp = (state && state.monitoringCollectorIp) || '10.0.0.100';

  function platformKey(dev) {
    var v = (dev.vendor || '').toLowerCase();
    if (v.includes('arista'))  return 'eos';
    if (v.includes('juniper')) return 'junos';
    if (v.includes('nvidia') || v.includes('sonic')) return 'sonic';
    return 'nxos';
  }

  // Group devices by platform — one config block per platform
  var seen = {};
  var blocks = [];
  (devices || []).forEach(function(dev) {
    var key = platformKey(dev);
    if (!seen[key]) {
      seen[key] = true;
      var fn = GNMI_DEVICE_CONFIGS[key];
      if (fn) blocks.push('! ─── ' + key.toUpperCase() + ' ───────────────────────\n' + fn(collectorIp));
    }
  });
  return blocks.join('\n\n');
};

// ─── G-35: Statistical Anomaly Detection ──────────────────────────────────────

var ANOMALY_WINDOWS = {
  short:  '5m',
  medium: '30m',
  long:   '2h'
};

/**
 * Generate Prometheus recording rules for rolling statistics.
 * These rules compute mean and stddev over a sliding window,
 * enabling z-score alerting that adapts to baseline (2σ = ~95.4% confidence).
 */
window.genAnomalyRecordingRules = function(devices) {
  var devFilter = (devices || []).length > 0
    ? '{instance=~"(' + (devices || []).map(function(d) { return d.hostname; }).join('|') + ').*"}'
    : '{}';

  var lines = [
    '# Prometheus Recording Rules — Statistical Anomaly Detection (G-35)',
    '# Generated by NetDesign AI. Deploy to /etc/prometheus/rules/anomaly.yml',
    '---',
    'groups:',
    '  - name: ndal_anomaly_stats',
    '    interval: 1m',
    '    rules:'
  ];

  var metrics = [
    { name: 'ifInErrors',   metric: 'ifInErrors',   label: 'Interface Input Errors',   window: '30m' },
    { name: 'ifOutErrors',  metric: 'ifOutErrors',  label: 'Interface Output Errors',  window: '30m' },
    { name: 'ifInOctets',   metric: 'ifInOctets',   label: 'Interface Input Bytes',    window: '1h'  },
    { name: 'ifOutOctets',  metric: 'ifOutOctets',  label: 'Interface Output Bytes',   window: '1h'  },
    { name: 'cpu_avg',      metric: 'cpmCPUTotal1minRev', label: 'CPU Utilization',    window: '30m' },
    { name: 'bgp_prefixes', metric: 'cbgpPrefixAcceptedPrefixes', label: 'BGP Prefixes Accepted', window: '1h' }
  ];

  metrics.forEach(function(m) {
    // Rolling mean
    lines.push('      # ' + m.label);
    lines.push('      - record: ndal:' + m.name + ':mean' + m.window.replace(/[^0-9a-z]/g, ''));
    lines.push('        expr: avg_over_time(' + m.metric + devFilter + '[' + m.window + '])');
    lines.push('');

    // Rolling stddev
    lines.push('      - record: ndal:' + m.name + ':stddev' + m.window.replace(/[^0-9a-z]/g, ''));
    lines.push('        expr: stddev_over_time(' + m.metric + devFilter + '[' + m.window + '])');
    lines.push('');

    // Z-score (current - mean) / stddev
    lines.push('      - record: ndal:' + m.name + ':zscore');
    lines.push('        expr: >-');
    lines.push('          (' + m.metric + devFilter);
    lines.push('          - ndal:' + m.name + ':mean' + m.window.replace(/[^0-9a-z]/g, '') + ')');
    lines.push('          / (ndal:' + m.name + ':stddev' + m.window.replace(/[^0-9a-z]/g, '') + ' > 0)');
    lines.push('');
  });

  return lines.join('\n') + '\n';
};

/**
 * Generate Prometheus alert rules for 2σ anomalies.
 * Fires when |z-score| > 2 (outside 95.4% of normal distribution).
 */
window.genAnomalyAlertRules = function(devices, sensitivity) {
  sensitivity = sensitivity || 2; // default 2σ; 3σ for fewer false positives

  var lines = [
    '# Prometheus Alert Rules — 2σ Anomaly Detection (G-35)',
    '# Generated by NetDesign AI',
    '---',
    'groups:',
    '  - name: ndal_anomaly_alerts',
    '    rules:'
  ];

  var alerts = [
    {
      name: 'AnomalyInterfaceErrors',
      expr: 'abs(ndal:ifInErrors:zscore) > ' + sensitivity + ' or abs(ndal:ifOutErrors:zscore) > ' + sensitivity,
      duration: '2m',
      severity: 'warning',
      summary: 'Interface error rate anomaly detected (z-score > ' + sensitivity + 'σ)',
      description: 'Device {{ $labels.instance }} interface errors are {{ $value | printf "%.1f" }}σ from baseline.'
    },
    {
      name: 'AnomalyBandwidth',
      expr: 'abs(ndal:ifInOctets:zscore) > ' + sensitivity + ' or abs(ndal:ifOutOctets:zscore) > ' + sensitivity,
      duration: '5m',
      severity: 'warning',
      summary: 'Bandwidth anomaly detected (z-score > ' + sensitivity + 'σ)',
      description: 'Device {{ $labels.instance }} traffic is {{ $value | printf "%.1f" }}σ from baseline.'
    },
    {
      name: 'AnomalyCPU',
      expr: 'abs(ndal:cpu_avg:zscore) > ' + sensitivity,
      duration: '3m',
      severity: 'warning',
      summary: 'CPU utilization anomaly detected (z-score > ' + sensitivity + 'σ)',
      description: 'Device {{ $labels.instance }} CPU is {{ $value | printf "%.1f" }}σ from baseline.'
    },
    {
      name: 'AnomalyBGPPrefixes',
      expr: 'ndal:bgp_prefixes:zscore < -' + sensitivity,
      duration: '1m',
      severity: 'critical',
      summary: 'BGP prefix count dropped anomalously (z-score < -' + sensitivity + 'σ)',
      description: 'Device {{ $labels.instance }} BGP prefixes dropped {{ $value | printf "%.1f" }}σ below baseline — possible BGP session issue.'
    }
  ];

  alerts.forEach(function(a) {
    lines.push('      - alert: ' + a.name);
    lines.push('        expr: ' + a.expr);
    lines.push('        for: ' + a.duration);
    lines.push('        labels:');
    lines.push('          severity: ' + a.severity);
    lines.push('        annotations:');
    lines.push('          summary: "' + a.summary + '"');
    lines.push('          description: "' + a.description + '"');
    lines.push('');
  });

  return lines.join('\n') + '\n';
};

/**
 * Render the anomaly detection config panel for the Monitoring sidebar.
 */
window.renderAnomalyPanel = function(state) {
  var devices = state.devices || [];
  var lines = [
    '<h3 style="margin:0 0 12px">Statistical Anomaly Detection</h3>',
    '<p style="color:var(--text-dim);margin:0 0 16px;font-size:13px;">',
    'Generates Prometheus recording rules (rolling mean + stddev) and 2σ alert rules.',
    'Replaces static thresholds with adaptive baselines — adapts to traffic patterns over time.',
    '</p>',
    '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center;">',
    '<label style="font-size:13px;font-weight:600;">Sensitivity (σ):',
    '<select id="anomaly-sigma" style="margin-left:8px;padding:4px 8px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:4px;">',
    '<option value="2">2σ — Aggressive (fewer misses)</option>',
    '<option value="3">3σ — Balanced (recommended)</option>',
    '<option value="4">4σ — Conservative (fewer false positives)</option>',
    '</select></label>',
    '<button class="btn btn-secondary" onclick="window.downloadAnomalyRecordingRules()">&#8595; Recording Rules</button>',
    '<button class="btn btn-secondary" onclick="window.downloadAnomalyAlertRules()">&#8595; Alert Rules</button>',
    '</div>',
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:14px;font-size:12px;color:var(--text-dim);">',
    '<strong style="color:var(--text);">How it works:</strong><br>',
    '1. Recording rules compute <code>avg_over_time()</code> and <code>stddev_over_time()</code> over 30m–2h windows<br>',
    '2. Z-score = (current − mean) / stddev for each metric<br>',
    '3. Alert fires when |z-score| > σ threshold (2σ = outside 95.4% of baseline)<br>',
    '4. Requires ~2h of data to establish a meaningful baseline',
    '</div>'
  ];

  if (devices.length === 0) {
    lines.push('<p class="empty-state" style="margin-top:12px;">No devices — complete Step 1 first.</p>');
  } else {
    lines.push('<p style="margin-top:12px;font-size:13px;color:var(--text-dim);">' + devices.length + ' devices in scope for anomaly monitoring.</p>');
  }

  return lines.join('\n');
};

window.downloadAnomalyRecordingRules = function() {
  var sigma = parseInt((document.getElementById('anomaly-sigma') || {}).value || '2', 10);
  var yaml = window.genAnomalyRecordingRules(window.STATE ? window.STATE.devices : []);
  var blob = new Blob([yaml], {type: 'text/yaml'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'anomaly-recording-rules.yml'; a.click();
};

window.downloadAnomalyAlertRules = function() {
  var sigma = parseInt((document.getElementById('anomaly-sigma') || {}).value || '2', 10);
  var yaml = window.genAnomalyAlertRules(window.STATE ? window.STATE.devices : [], sigma);
  var blob = new Blob([yaml], {type: 'text/yaml'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'anomaly-alert-rules.yml'; a.click();
};
