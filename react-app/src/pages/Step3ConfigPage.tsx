import { useMemo, useState } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { CodeBlock, CopyButton } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { generateBom } from '@/domain/bom';
import { generateAllConfigs } from '@/domain/configgen';
import { PRODUCTS } from '@/domain/products';

const SECTIONS = ['All', 'Interfaces', 'BGP', 'QoS', 'VXLAN', 'RoCEv2', 'Security', 'NTP/Logging'] as const;

function filterSection(code: string, section: string): string {
  if (section === 'All') return code;
  const key = section.toLowerCase();
  const patterns: Record<string, RegExp[]> = {
    interfaces:   [/^interface\b/im, /^  ip address/im],
    bgp:          [/^router bgp/im, /^  neighbor/im, /^address-family/im],
    qos:          [/^class-map/im, /^policy-map/im, /^service-policy/im, /qos/im],
    vxlan:        [/^feature nv/im, /^interface nve/im, /^evpn/im, /vxlan/im, /vni/im],
    rocev2:       [/rocev2/im, /pfc/im, /ecn/im, /rdma/im, /dcqcn/im],
    security:     [/^username/im, /^ip ssh/im, /^aaa/im, /^no .*(telnet|http)/im],
    'ntp/logging':[/^ntp/im, /^logging/im, /^clock/im],
  };
  const regs = patterns[key] ?? [];
  if (!regs.length) return code;

  const lines = code.split('\n');
  const result: string[] = [];
  let capturing = false;
  let indent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const curIndent = line.length - trimmed.length;

    if (regs.some((r) => r.test(line))) {
      capturing = true;
      indent = curIndent;
      result.push(line);
    } else if (capturing) {
      if (curIndent > indent || trimmed === '') {
        result.push(line);
      } else {
        capturing = false;
        result.push('');
      }
    }
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function Step3ConfigPage() {
  const { intent } = useIntentStore();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [section, setSection] = useState<string>('All');

  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);

  const configs = useMemo(() => {
    if (!bomResult.devices.length) return {} as Record<string, string>;
    return generateAllConfigs(intent, bomResult.devices);
  }, [intent, bomResult.devices]);

  const deviceList = useMemo(() => bomResult.devices.map((d) => d.hostname ?? d.id), [bomResult.devices]);

  const active = selectedDevice ?? deviceList[0] ?? '';
  const rawConfig = configs[active] ?? '# No config generated — check BOM step first.\n';
  const displayedConfig = filterSection(rawConfig, section);

  function downloadAll() {
    const entries = Object.entries(configs);
    if (!entries.length) return;
    const blob = new Blob(
      entries.map(([h, c]) => `! ===== ${h} =====\n${c}\n\n`),
      { type: 'text/plain' }
    );
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'configs.txt' });
    a.click();
  }

  function downloadOne() {
    if (!active || !rawConfig) return;
    const blob = new Blob([rawConfig], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${active}.cfg` });
    a.click();
  }

  const roleColor: Record<string, string> = {
    spine: 'text-blue-400', leaf: 'text-green-400', 'border-leaf': 'text-green-300',
    core: 'text-purple-400', distribution: 'text-purple-300', access: 'text-yellow-400',
    'pe-router': 'text-red-400', 'p-router': 'text-red-300',
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="px-6 pt-6 pb-3 flex-none">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white mb-1">Step 3 — Config Generator</h1>
            <p className="text-slate-400 text-sm">
              {deviceList.length} devices · {intent.use_case} · {intent.vendors.join(', ')}
            </p>
          </div>
          <div className="flex gap-2">
            <CopyButton text={rawConfig} />
            <button onClick={downloadOne} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">
              Download
            </button>
            <button onClick={downloadAll} className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1 rounded transition-colors">
              Export All
            </button>
          </div>
        </div>
      </div>

      {/* Section filter bar */}
      <div className="px-6 pb-2 flex-none flex gap-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              section === s
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden gap-4 px-6 pb-6">
        {/* Device list */}
        <div className="w-52 flex-none overflow-y-auto border border-slate-700 rounded-lg bg-slate-900/50">
          <div className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-700">
            Devices
          </div>
          {deviceList.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-500">No devices — complete Step 2 first.</div>
          ) : (
            deviceList.map((hostname) => {
              const dev = bomResult.devices.find((d) => (d.hostname ?? d.id) === hostname);
              return (
                <button
                  key={hostname}
                  onClick={() => { setSelectedDevice(hostname); setSection('All'); }}
                  className={`w-full text-left px-3 py-2 text-xs border-b border-slate-800 last:border-0 hover:bg-slate-800 transition-colors ${
                    active === hostname ? 'bg-slate-800 border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  <div className={`font-mono font-medium ${roleColor[dev?.subLayer ?? ''] ?? 'text-slate-300'}`}>
                    {hostname}
                  </div>
                  <div className="text-slate-500 text-xs">{dev?.subLayer} · {dev?.vendor}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Config viewer */}
        <div className="flex-1 overflow-hidden flex flex-col gap-2">
          {active && (
            <div className="flex items-center gap-2 flex-none">
              <span className="font-mono text-sm text-blue-300">{active}</span>
              {bomResult.devices.find((d) => (d.hostname ?? d.id) === active) && (
                <>
                  <Badge variant="blue">{bomResult.devices.find((d) => (d.hostname ?? d.id) === active)?.subLayer}</Badge>
                  <Badge variant="slate">{bomResult.devices.find((d) => (d.hostname ?? d.id) === active)?.model}</Badge>
                </>
              )}
              {section !== 'All' && <Badge variant="yellow">Filtered: {section}</Badge>}
            </div>
          )}
          <CodeBlock
            code={displayedConfig || '# No config output for this filter.'}
            maxHeight="calc(100vh - 280px)"
            className="flex-1"
          />
        </div>
      </div>

      <div className="px-6 pb-4">
        <NavButtons prev="/bom" next="/deploy" />
      </div>
    </div>
  );
}
