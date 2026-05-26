import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useIntentStore } from '@/store/intentStore';

const STEPS = [
  { to: '/', label: 'Intent', num: 1 },
  { to: '/bom', label: 'BOM', num: 2 },
  { to: '/config', label: 'Config', num: 3 },
  { to: '/deploy', label: 'Deploy', num: 4 },
  { to: '/monitor', label: 'Monitor', num: 5 },
  { to: '/ztp', label: 'ZTP', num: 6 },
  { to: '/tools', label: 'Engine', num: 7 },
];

export function AppShell() {
  const { intent, resetIntent } = useIntentStore();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-900/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-blue-400">⚡ NetDesign AI</span>
            <span className="text-xs text-slate-500 font-mono border border-slate-700 rounded px-2 py-0.5">v2.0 beta</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">{intent.use_case}</span>
            <span className="text-slate-600">·</span>
            <span>{intent.topology.endpoint_count} endpoints</span>
            <button
              onClick={() => { resetIntent(); navigate('/'); }}
              className="ml-2 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white px-3 py-1 rounded text-xs transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
        {/* Step tabs */}
        <div
          role="tablist"
          aria-label="Design workflow steps"
          className="max-w-7xl mx-auto px-4 flex gap-1 pb-2 overflow-x-auto"
        >
          {STEPS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === '/'}
              role="tab"
              aria-label={`Step ${s.num}: ${s.label}`}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              <span className="text-slate-500 font-mono">{s.num}</span>
              {s.label}
            </NavLink>
          ))}
        </div>
      </header>

      {/* Page content */}
      <main id="main-content" className="flex-1 overflow-auto" role="main">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 text-center text-xs text-slate-600 py-3">
        NetDesign AI v2.0 — React + TypeScript + Vite · All credentials via env vars NET_USER / NET_PASS / NET_ENABLE
      </footer>
    </div>
  );
}
