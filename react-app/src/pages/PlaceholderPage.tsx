interface PlaceholderPageProps {
  step: number;
  title: string;
  icon: string;
  sourceFile: string;
  description: string;
  prev: string;
  next?: string;
}

import { useNavigate } from 'react-router-dom';

export function PlaceholderPage({ step, title, icon, sourceFile, description, prev, next }: PlaceholderPageProps) {
  const navigate = useNavigate();
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-white mb-2">Step {step} — {title}</h1>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-400">
        <div className="text-4xl mb-3">{icon}</div>
        <div className="font-medium text-white mb-1">{title} — Phase 3</div>
        <div className="text-sm">
          {description}
          <br/>
          Domain logic lives in <code className="text-blue-400">{sourceFile}</code>
        </div>
      </div>
      <div className="mt-6 flex justify-between">
        <button
          onClick={() => navigate(prev)}
          className="border border-slate-600 text-slate-300 hover:border-slate-400 px-6 py-2 rounded-lg text-sm transition-colors"
        >
          ← Back
        </button>
        {next && (
          <button
            onClick={() => navigate(next)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
