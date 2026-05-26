import { useMemo } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { PageTabs } from '@/components/ui/PageTabs';
import { CodeBlock, CopyButton } from '@/components/ui/CodeBlock';
import { generateBom } from '@/domain/bom';
import {
  genPrometheusAlerts,
  genAnomalyRecordingRules,
  genAnomalyAlertRules,
  genGnmicConfig,
  genDockerComposeMonitoring,
  genScrapeConfigYaml,
} from '@/domain/monitoring';
import { PRODUCTS } from '@/domain/products';

function CodePanel({ title, code, filename, note }: { title: string; code: string; filename: string; note?: string }) {
  function download() {
    const blob = new Blob([code], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click();
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
        </div>
        <div className="flex gap-2">
          <CopyButton text={code} />
          <button onClick={download} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Download</button>
        </div>
      </div>
      <CodeBlock code={code} maxHeight="500px" />
    </div>
  );
}

const TABS = [
  { id: 'prom',    label: 'Alert Rules',    icon: '🔔' },
  { id: 'anomaly', label: 'Anomaly Rules',  icon: '📈' },
  { id: 'gnmi',    label: 'gNMI Config',    icon: '📡' },
  { id: 'scrape',  label: 'Scrape Config',  icon: '🕷️' },
  { id: 'stack',   label: 'Docker Stack',   icon: '🐳' },
];

export function Step5MonitorPage() {
  const { intent } = useIntentStore();
  const siteCode = (intent.org.name || 'SITE').toUpperCase().slice(0, 6);
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const devices = bomResult.devices;

  const promAlerts  = useMemo(() => genPrometheusAlerts(devices, intent, siteCode), [devices, intent, siteCode]);
  const anomalyRec  = useMemo(() => genAnomalyRecordingRules(devices), [devices]);
  const anomalyAlert= useMemo(() => genAnomalyAlertRules(devices, 3), [devices]);
  const gnmi        = useMemo(() => genGnmicConfig(devices, siteCode), [devices, siteCode]);
  const scrape      = useMemo(() => genScrapeConfigYaml(devices, siteCode), [devices, siteCode]);
  const stack       = useMemo(() => genDockerComposeMonitoring(siteCode), [siteCode]);

  const anomaly = `${anomalyRec}\n---\n${anomalyAlert}`;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white mb-1">Step 5 — Monitoring</h1>
        <p className="text-slate-400 text-sm">
          VictoriaMetrics + Grafana + snmp-exporter + gnmic · Site: <span className="text-blue-400 font-mono">{siteCode}</span> · {devices.length} devices
        </p>
      </div>

      {devices.length === 0 && (
        <div className="mb-4 bg-yellow-900/20 border border-yellow-800 rounded-lg px-4 py-3 text-sm text-yellow-300">
          ⚠️ No devices — complete Step 2 (BOM) first. Outputs will be empty.
        </div>
      )}

      <PageTabs tabs={TABS}>
        {(active) => {
          if (active === 'prom')    return <CodePanel title="Prometheus Alert Rules (prometheus.alerts.yml)" code={promAlerts} filename={`${siteCode.toLowerCase()}_alerts.yml`} note="Compliance-aware thresholds — PCI/HIPAA tighten CPU and error-rate limits" />;
          if (active === 'anomaly') return <CodePanel title="Anomaly Recording + Alert Rules" code={anomaly} filename="anomaly_rules.yml" note="3σ z-score baseline on 10-min sliding window for 6 key metrics" />;
          if (active === 'gnmi')   return <CodePanel title="gNMI Telemetry Config (gnmic.yml)" code={gnmi} filename="gnmic.yml" note="OpenConfig subscriptions: interfaces (SAMPLE 10s), BGP (ON_CHANGE), CPU (SAMPLE 30s)" />;
          if (active === 'scrape') return <CodePanel title="Prometheus Scrape Config" code={scrape} filename={`scrape_${siteCode.toLowerCase()}.yml`} />;
          if (active === 'stack')  return <CodePanel title="Monitoring Docker Compose Stack" code={stack} filename="docker-compose.monitoring.yml" note="VictoriaMetrics :8428  Grafana :3000  SNMP Exporter :9116" />;
          return null;
        }}
      </PageTabs>

      <NavButtons prev="/deploy" next="/ztp" />
    </div>
  );
}
