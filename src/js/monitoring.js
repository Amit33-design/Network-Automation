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
