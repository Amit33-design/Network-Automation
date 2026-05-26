import { useMemo, useState } from 'react';
import { useIntentStore } from '@/store/intentStore';
import { NavButtons } from '@/components/ui/NavButtons';
import { PageTabs } from '@/components/ui/PageTabs';
import { Badge } from '@/components/ui/Badge';
import { generateBom } from '@/domain/bom';
import { assignRackPositions, calcRackPower, exportRackLayoutCSV } from '@/domain/rack';
import { classifySymptom, bgpConvergencePredictor, SYMPTOM_CATEGORIES } from '@/domain/troubleshoot';
import { PRODUCTS } from '@/domain/products';

// ─── Symptom Classifier ───────────────────────────────────────────────────────

function TroubleshootPanel() {
  const { intent } = useIntentStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('');

  const results = useMemo(() => {
    if (query.trim().length < 3) return [];
    return classifySymptom(query, category || undefined);
  }, [query, category]);

  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);
  const convergence = useMemo(() => bgpConvergencePredictor({}, intent, bomResult.devices), [intent, bomResult.devices]);

  return (
    <div className="space-y-6">
      {/* Symptom search */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-white">Symptom Classifier ({SYMPTOM_CATEGORIES.length} categories)</h3>
        <div className="flex gap-3">
          <input
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            placeholder="Describe the symptom… e.g. BGP session flapping, interface CRC errors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {SYMPTOM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {query.trim().length >= 3 && results.length === 0 && (
          <div className="text-slate-500 text-sm">No matching symptoms. Try different keywords.</div>
        )}

        <div className="space-y-3">
          {results.map((r, i) => (
            <div key={i} className="bg-slate-800/60 border border-slate-700 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="blue">{r.cat}</Badge>
                <span className="text-xs text-slate-400 font-mono">{r.id}</span>
              </div>
              <div className="text-sm font-medium text-white mb-1">{r.symptom}</div>
              <div className="text-xs text-green-300 mb-2">{r.fix}</div>
              <div className="text-xs font-medium text-slate-300 mb-1">Root Causes:</div>
              <ul className="text-xs text-slate-400 list-disc list-inside space-y-0.5">
                {r.causes.map((c, j) => <li key={j}>{c}</li>)}
              </ul>
              {(r.cmds.nxos?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-blue-400 cursor-pointer">Show NX-OS diagnostic commands</summary>
                  <div className="mt-1 font-mono text-xs text-green-300 bg-slate-900 rounded p-2 space-y-0.5">
                    {r.cmds.nxos?.map((c, j) => <div key={j}>{c}</div>)}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Convergence predictor */}
      <div className="space-y-3 border-t border-slate-700 pt-6">
        <h3 className="text-sm font-semibold text-white">BGP Convergence Predictor</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-2">
            <div className="text-sm font-medium text-white mb-2">Convergence Time Breakdown</div>
            {convergence.breakdown.map(({ phase, ms, note }) => (
              <div key={phase} className="flex justify-between text-xs gap-2">
                <div>
                  <span className="text-slate-300">{phase}</span>
                  {note && <span className="text-slate-500 ml-1">— {note}</span>}
                </div>
                <span className="font-mono text-slate-300 shrink-0">{ms}ms</span>
              </div>
            ))}
            <div className="border-t border-slate-700 pt-2 flex justify-between text-sm font-semibold">
              <span className="text-slate-400">Best / Worst</span>
              <span className="font-mono">
                <span className="text-green-400">{convergence.best_ms}ms</span>
                <span className="text-slate-500"> / </span>
                <span className="text-yellow-400">{convergence.worst_ms}ms</span>
              </span>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 space-y-2">
            <div className="text-sm font-medium text-white mb-2">SLA & Status</div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">SLA Target</span>
              <span className="font-mono text-slate-300">{convergence.sla.target_ms}ms ({convergence.sla.label})</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Meets SLA?</span>
              <Badge variant={convergence.meets_sla ? 'green' : 'red'}>
                {convergence.meets_sla ? 'Within SLA' : 'Exceeds SLA'}
              </Badge>
            </div>
            {convergence.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {convergence.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-yellow-300">⚠️ {w}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Rack Layout ─────────────────────────────────────────────────────────────

function RackLayoutPanel() {
  const { intent } = useIntentStore();
  const bomResult = useMemo(() => generateBom(intent, PRODUCTS), [intent]);

  const racks = useMemo(() => assignRackPositions(bomResult.devices), [bomResult.devices]);
  const power = useMemo(() => calcRackPower(bomResult.devices), [bomResult.devices]);

  function download() {
    const blob = new Blob([exportRackLayoutCSV(bomResult.devices)], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'rack_layout.csv' });
    a.click();
  }

  if (!bomResult.devices.length) {
    return <div className="text-slate-500 text-sm py-8 text-center">No devices — complete Step 2 first.</div>;
  }

  const tot = power.totals;
  return (
    <div className="space-y-6">
      {/* Power summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total IT Load',    val: `${tot.totalITKw.toFixed(1)} kW` },
          { label: `Facility (PUE ${power.pue})`, val: `${tot.facilityKw.toFixed(1)} kW` },
          { label: 'Annual Power Cost', val: `$${tot.annualCostUSD.toLocaleString()}` },
          { label: 'Cooling',          val: `${tot.coolingTons.toFixed(1)} tons` },
        ].map(({ label, val }) => (
          <div key={label} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className="text-sm font-semibold text-white">{val}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-white">{racks.length} Rack{racks.length !== 1 ? 's' : ''}</h3>
        <button onClick={download} className="text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors">Export CSV</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {racks.map((rack) => {
          const usedU = 42 - rack.freeU;
          return (
            <div key={rack.id} className="border border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-800/80 px-4 py-2 flex justify-between text-xs font-medium">
                <span className="text-white">{rack.id}</span>
                <span className="text-slate-400">{rack.devices.length} devices · {usedU}U / 42U</span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-700 bg-slate-800/50">
                    <tr>{['U', 'Hostname', 'Model', 'Role'].map((h) => (
                      <th key={h} className="text-left font-medium text-slate-400 px-3 py-1.5">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {rack.devices.map((d, i) => (
                      <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="px-3 py-1.5 font-mono text-slate-400">U{d.unit}</td>
                        <td className="px-3 py-1.5 font-mono text-blue-300">{d.hostname ?? d.id}</td>
                        <td className="px-3 py-1.5 text-slate-300">{d.model}</td>
                        <td className="px-3 py-1.5 text-slate-400">{d.subLayer}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'trouble', label: 'Troubleshoot', icon: '🔬' },
  { id: 'rack',    label: 'Rack Layout',  icon: '🗄️' },
];

export function Step7ToolsPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white mb-1">Step 7 — Engine & Tools</h1>
        <p className="text-slate-400 text-sm">Symptom classifier · BGP convergence predictor · Rack layout</p>
      </div>

      <PageTabs tabs={TABS}>
        {(active) => {
          if (active === 'trouble') return <TroubleshootPanel />;
          if (active === 'rack')    return <RackLayoutPanel />;
          return null;
        }}
      </PageTabs>

      <NavButtons prev="/ztp" />
    </div>
  );
}
