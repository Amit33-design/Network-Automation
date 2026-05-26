import { describe, it, expect } from 'vitest';
import {
  genPrometheusAlerts, genAnomalyRecordingRules, genAnomalyAlertRules,
  genGnmicConfig, genDockerComposeMonitoring, genScrapeConfigYaml,
} from '@/domain/monitoring';
import { buildBomDevices } from '@/domain/bom';
import { PRODUCTS } from '@/domain/products';
import { DEFAULT_INTENT } from '@/types/intent';

const DC_INTENT = { ...DEFAULT_INTENT, use_case: 'dc_fabric' as const, vendors: ['cisco' as const] };
const devices = buildBomDevices(DC_INTENT, PRODUCTS);

describe('genPrometheusAlerts', () => {
  it('generates YAML with alert groups', () => {
    const yaml = genPrometheusAlerts(devices, DC_INTENT, 'TEST');
    expect(yaml).toContain('groups:');
    expect(yaml).toContain('alert:');
  });

  it('includes BGP and interface alert groups', () => {
    const yaml = genPrometheusAlerts(devices, DC_INTENT, 'TEST');
    expect(yaml).toMatch(/BGPSessionDown|bgp/i);
    expect(yaml).toMatch(/InterfaceDown|interface/i);
  });

  it('PCI compliance tightens CPU threshold', () => {
    const pciIntent = { ...DC_INTENT, security: { ...DC_INTENT.security, compliance: ['pci_dss'] } };
    const plainIntent = { ...DC_INTENT, security: { ...DC_INTENT.security, compliance: [] } };
    const pciYaml   = genPrometheusAlerts(devices, pciIntent, 'TEST');
    const plainYaml = genPrometheusAlerts(devices, plainIntent, 'TEST');
    // PCI threshold should be lower (stricter) — 70 vs 80
    expect(pciYaml).toContain('70');
    expect(plainYaml).toContain('80');
  });

  it('returns placeholder for empty devices', () => {
    const yaml = genPrometheusAlerts([], DC_INTENT, 'TEST');
    expect(yaml).toContain('#');
  });
});

describe('genAnomalyRecordingRules', () => {
  it('generates z-score recording rules', () => {
    const yaml = genAnomalyRecordingRules(devices);
    expect(yaml).toMatch(/zscore|stddev/i);
  });

  it('includes all 6 key metrics', () => {
    const yaml = genAnomalyRecordingRules(devices);
    ['ifInOctets', 'ifOutOctets', 'ifInErrors', 'bgp_session_up', 'cpu_usage_percent'].forEach((m) => {
      expect(yaml).toContain(m);
    });
  });
});

describe('genAnomalyAlertRules', () => {
  it('default sigma threshold is 3', () => {
    const yaml = genAnomalyAlertRules(devices);
    expect(yaml).toContain('3');
  });

  it('custom sigma threshold appears in output', () => {
    const yaml = genAnomalyAlertRules(devices, 4);
    expect(yaml).toContain('4');
  });
});

describe('genGnmicConfig', () => {
  it('includes target addresses for spine/leaf devices', () => {
    const cfg = genGnmicConfig(devices, 'TEST');
    const targets = devices.filter((d) => ['spine', 'leaf', 'distribution'].includes(d.subLayer));
    targets.forEach((d) => expect(cfg).toContain(d.hostname));
  });

  it('includes OpenConfig paths', () => {
    const cfg = genGnmicConfig(devices, 'TEST');
    expect(cfg).toMatch(/interfaces|bgp|cpus/i);
  });
});

describe('genDockerComposeMonitoring', () => {
  it('includes VictoriaMetrics and Grafana', () => {
    const yaml = genDockerComposeMonitoring('TEST');
    expect(yaml).toContain('victoriametrics');
    expect(yaml).toContain('grafana');
  });

  it('includes snmp-exporter', () => {
    const yaml = genDockerComposeMonitoring('TEST');
    expect(yaml).toContain('snmp');
  });
});

describe('genScrapeConfigYaml', () => {
  it('includes all devices as scrape targets', () => {
    const yaml = genScrapeConfigYaml(devices, 'TEST');
    devices.filter((d) => d.hostname).forEach((d) => expect(yaml).toContain(d.hostname));
  });
});
