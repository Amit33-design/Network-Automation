import { useNavigate } from 'react-router-dom';
import { useIntentStore } from '@/store/intentStore';

export function Step2BOMPage() {
  const { intent } = useIntentStore();
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-2">Hardware BOM & Topology</h1>
      <p className="text-slate-400 mb-6">
        Use case: <span className="text-blue-400 font-mono">{intent.use_case}</span> ·
        Endpoints: <span className="text-blue-400 font-mono">{intent.topology.endpoint_count}</span> ·
        Vendors: <span className="text-blue-400 font-mono">{intent.vendors.join(', ')}</span>
      </p>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-400">
        <div className="text-4xl mb-3">🗄️</div>
        <div className="font-medium text-white mb-1">BOM Calculator — Phase 2</div>
        <div className="text-sm">
          Port-math BOM engine will be ported here from <code className="text-blue-400">src/js/bom_calculator.js</code> in Phase 2.
          <br/>Leaf/spine counts, TCO, optics, rack layout, cable schedule.
        </div>
      </div>
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => navigate('/')}
          className="border border-slate-600 text-slate-300 hover:border-slate-400 px-6 py-2 rounded-lg text-sm transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={() => navigate('/config')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
