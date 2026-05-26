import { useMemo, useState } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { PageTabs } from '@/components/ui/PageTabs';
import { CodeBlock, CopyButton } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { generateBom } from '@/domain/bom';
import {
  ztpInitDevices,
  ztpAdvanceState,
  ztpMarkFailed,
  genDay0Config,
  genZtpDockerCompose,
  genZtpNginxConf,
  genZtpDhcpScope,
  genOsImageManifest,
  type ZtpDeviceState,
} from '@/domain/ztp';
import { PRODUCTS } from '@/domain/products';

// ─── ZTP State Board ──────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, 'slate' | 'blue' | 'yellow' | 'green' | 'red'> = {
  REGISTERED:        'slate',
  POWERED_ON:        'blue',
  DHCP_ACK:          'blue',
  SCRIPT_DOWNLOADED: 'blue',
  CONFIG_APPLYING:   'yellow',
  CALLBACK_RECEIVED: 'yellow',
  VERIFIED:          'yellow',
  ONLINE:            'green',
  FAILED:            'red',
};

function ZTPStateBoard() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const [states, setStates] = useState<ZtpDeviceState[]>(() => ztpInitDevices(bomResult.devices));

  function advance(hostname: string) {
    setStates((prev) => prev.map((d) => d.hostname === hostname ? ztpAdvanceState(d) : d));
  }
  function fail(hostname: string) {
    setStates((prev) => prev.map((d) => d.hostname === hostname ? ztpMarkFailed(d, 'Simulated failure') : d));
  }
  function reset() {
    setStates(ztpInitDevices(bomResult.devices));
  }

  const online = states.filter((d) => d.state === 'ONLINE').length;
  const failed = states.filter((d) => d.state === 'FAILED').length;

  if (states.length === 0) {
    return <div className="text-slate-500 text-sm py-8 text-center">No devices — complete Step 2 first.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex gap-4 text-sm">
          <span className="text-slate-400">Total: <span className="text-blue-400 font-mono">{states.length}</span></span>
          <span className="text-slate-400">Online: <span className="text-green-400 font-mono">{online}</span></span>
          <span className="text-slate-400">Failed: <span className="text-red-400 font-mono">{failed}</span></span>
          <span className="text-slate-400">In Progress: <span className="text-yellow-400 font-mono">{states.length - online - failed}</span></span>
        </div>
        <button onClick={reset} className="ml-auto text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Reset All</button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/80 border-b border-slate-700">
            <tr>
              {['Hostname', 'Platform', 'State', 'Last Updated', 'Actions'].map((h) => (
                <th key={h} className="text-left text-xs font-medium text-slate-400 uppercase tracking-wide px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {states.map((d) => (
              <tr key={d.hostname} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="px-3 py-2 font-mono text-blue-300 text-xs">{d.hostname}</td>
                <td className="px-3 py-2 text-slate-400 text-xs">{d.platform}</td>
                <td className="px-3 py-2"><Badge variant={STATE_COLOR[d.state] ?? 'slate'}>{d.state}</Badge></td>
                <td className="px-3 py-2 text-slate-500 text-xs font-mono">{new Date(d.lastUpdated).toLocaleTimeString()}</td>
                <td className="px-3 py-2">
                  {d.state !== 'ONLINE' && d.state !== 'FAILED' && (
                    <div className="flex gap-1">
                      <button onClick={() => advance(d.hostname)} className="text-xs bg-blue-800 hover:bg-blue-700 text-white px-2 py-0.5 rounded">Advance</button>
                      <button onClick={() => fail(d.hostname)} className="text-xs bg-red-900 hover:bg-red-800 text-white px-2 py-0.5 rounded">Fail</button>
                    </div>
                  )}
                  {d.state === 'FAILED' && d.error && <span className="text-xs text-red-400">{d.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Simulated state board — in production, states are driven by DHCP polling, nginx access logs, and POST /api/ztp/callback.</p>
    </div>
  );
}

// ─── Day-0 Configs ────────────────────────────────────────────────────────────

function Day0Configs() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const [selected, setSelected] = useState(0);

  const devices = bomResult.devices;
  if (!devices.length) return <div className="text-slate-500 text-sm py-8 text-center">No devices — complete Step 2 first.</div>;

  const dev = devices[selected];
  const config = dev ? genDay0Config(dev, intent) : '';

  return (
    <div className="flex gap-4 h-96">
      <div className="w-48 flex-none overflow-y-auto border border-slate-700 rounded-lg">
        <div className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-700">Devices</div>
        {devices.map((d, i) => (
          <button key={i} onClick={() => setSelected(i)} className={`w-full text-left px-3 py-2 text-xs border-b border-slate-800 hover:bg-slate-800 transition-colors ${selected === i ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''}`}>
            <div className="font-mono text-slate-300">{d.hostname ?? d.id}</div>
            <div className="text-slate-500">{d.subLayer}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between flex-none">
          <span className="text-xs text-slate-400">Management-plane ONLY — NO BGP, VLANs, VXLAN (CLAUDE.md §9)</span>
          <CopyButton text={config} />
        </div>
        <CodeBlock code={config} maxHeight="340px" className="flex-1" />
      </div>
    </div>
  );
}

// ─── DHCP + Infra ────────────────────────────────────────────────────────────

function InfraPanel() {
  const { intent } = useIntentStore();
  const siteCode = (intent.org.name || 'SITE').toUpperCase().slice(0, 6);
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);

  const dhcp    = useMemo(() => genZtpDhcpScope(bomResult.devices, siteCode), [bomResult.devices, siteCode]);
  const compose = useMemo(() => genZtpDockerCompose(siteCode), [siteCode]);
  const nginx   = useMemo(() => genZtpNginxConf(), []);
  const manifest = useMemo(() => genOsImageManifest(bomResult.devices, 'stable'), [bomResult.devices]);

  const panels = [
    { label: 'DHCP Scope (ISC)', code: dhcp, file: 'dhcpd.conf' },
    { label: 'Docker Compose (ZTP Stack)', code: compose, file: 'docker-compose.ztp.yml' },
    { label: 'Nginx Config', code: nginx, file: 'nginx.conf' },
    { label: 'OS Image Manifest', code: manifest, file: 'stage_images.sh' },
  ];

  const [active, setActive] = useState(0);
  const p = panels[active];

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {panels.map((pan, i) => (
          <button key={i} onClick={() => setActive(i)} className={`text-xs px-3 py-1.5 rounded border transition-colors ${active === i ? 'bg-blue-700 border-blue-600 text-white' : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white'}`}>
            {pan.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400 font-mono">{p.file}</span>
        <CopyButton text={p.code} />
      </div>
      <CodeBlock code={p.code} maxHeight="460px" />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'board',  label: 'State Board',    icon: '📊' },
  { id: 'day0',   label: 'Day-0 Configs',  icon: '🖥️' },
  { id: 'infra',  label: 'ZTP Infra',      icon: '🐳' },
];

export function Step6ZTPPage() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white mb-1">Step 6 — Zero-Touch Provisioning</h1>
        <p className="text-slate-400 text-sm">
          9-state ZTP machine · {bomResult.devices.length} devices · Site: <span className="text-blue-400 font-mono">{(intent.org.name || 'SITE').toUpperCase().slice(0, 6)}</span>
        </p>
      </div>

      <PageTabs tabs={TABS}>
        {(active) => {
          if (active === 'board') return <ZTPStateBoard />;
          if (active === 'day0')  return <Day0Configs />;
          if (active === 'infra') return <InfraPanel />;
          return null;
        }}
      </PageTabs>

      <NavButtons prev="/monitor" next="/tools" />
    </div>
  );
}
