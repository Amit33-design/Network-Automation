import { useMemo } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { PageTabs } from '@/components/ui/PageTabs';
import { CodeBlock, CopyButton } from '@/components/ui/CodeBlock';
import { generateBom } from '@/domain/bom';
import { generateAllConfigs } from '@/domain/configgen';
import {
  genPreCheckScript,
  genPostCheckScript,
  genCanaryDeployScript,
  genDriftDetectionScript,
  genBatfishScript,
} from '@/domain/deploy';
import { genRollbackScript, type DeviceForRollback } from '@/domain/rollback';
import { PRODUCTS } from '@/domain/products';

function ScriptPanel({ title, code, filename }: { title: string; code: string; filename: string }) {
  function download() {
    const ext = filename.endsWith('.sh') || filename.endsWith('.py') ? '' : '';
    void ext;
    const blob = new Blob([code], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    a.click();
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex gap-2">
          <CopyButton text={code} />
          <button onClick={download} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">
            Download
          </button>
        </div>
      </div>
      <CodeBlock code={code} maxHeight="500px" />
    </div>
  );
}

const TABS = [
  { id: 'precheck',  label: 'Pre-Check',       icon: '🔍' },
  { id: 'canary',    label: 'Canary Deploy',    icon: '🐤' },
  { id: 'postcheck', label: 'Post-Check',       icon: '✅' },
  { id: 'drift',     label: 'Drift Detection',  icon: '📊' },
  { id: 'batfish',   label: 'Batfish Dry-Run',  icon: '🐟' },
  { id: 'rollback',  label: 'Rollback Plan',    icon: '⏪' },
];

export function Step4DeployPage() {
  const { intent } = useIntentStore();
  const siteCode = (intent.org.name || 'SITE').toUpperCase().slice(0, 6);

  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const devices = bomResult.devices;

  const configs = useMemo(() => {
    if (!devices.length) return {} as Record<string, string>;
    return generateAllConfigs(intent, devices);
  }, [intent, devices]);

  const preCheck   = useMemo(() => genPreCheckScript(devices, siteCode), [devices, siteCode]);
  const postCheck  = useMemo(() => genPostCheckScript(devices, siteCode), [devices, siteCode]);
  const canary     = useMemo(() => genCanaryDeployScript(devices, configs, siteCode), [devices, configs, siteCode]);
  const drift      = useMemo(() => genDriftDetectionScript(devices, configs, siteCode), [devices, configs, siteCode]);
  const batfish    = useMemo(() => genBatfishScript(devices, configs, siteCode), [devices, configs, siteCode]);
  const rollback   = useMemo(() => genRollbackScript(devices as unknown as DeviceForRollback[]), [devices]);

  const empty = devices.length === 0;

  function warningPanel() {
    return (
      <div className="flex items-center justify-center h-32 border border-slate-700 rounded-lg text-slate-500 text-sm">
        No devices — complete Step 2 (BOM) first.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white mb-1">Step 4 — Deploy & Validate</h1>
        <p className="text-slate-400 text-sm">
          Site: <span className="text-blue-400 font-mono">{siteCode}</span> ·
          Devices: <span className="text-blue-400 font-mono">{devices.length}</span> ·
          Credentials via <span className="font-mono text-slate-300">NET_USER / NET_PASS / NET_ENABLE</span> env vars
        </p>
      </div>

      <PageTabs tabs={TABS}>
        {(active) => {
          if (empty) return warningPanel();
          if (active === 'precheck')  return <ScriptPanel title="Pre-Check Baseline Script (Python/Netmiko)" code={preCheck}  filename="pre_check.py" />;
          if (active === 'canary')    return <ScriptPanel title="Canary Deploy Script — leaf-01 first" code={canary}    filename="canary_deploy.py" />;
          if (active === 'postcheck') return <ScriptPanel title="Post-Check Script — diff vs baseline" code={postCheck} filename="post_check.py" />;
          if (active === 'drift')     return <ScriptPanel title="Config Drift Detection Script" code={drift}     filename="drift_detect.py" />;
          if (active === 'batfish')   return <ScriptPanel title="Batfish Dry-Run Validation" code={batfish}   filename="batfish_check.py" />;
          if (active === 'rollback')  return <ScriptPanel title="Platform-Native Rollback Plan (CLAUDE.md §7)" code={rollback}  filename="rollback.py" />;
          return null;
        }}
      </PageTabs>

      <NavButtons prev="/config" next="/monitor" />
    </div>
  );
}
