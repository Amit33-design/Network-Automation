import { useNavigate } from 'react-router-dom';

interface NavButtonsProps {
  prev?: string;
  next?: string;
  nextLabel?: string;
  onNext?: () => void;
}

export function NavButtons({ prev, next, nextLabel = 'Continue →', onNext }: NavButtonsProps) {
  const navigate = useNavigate();
  return (
    <div className="mt-6 flex justify-between items-center">
      {prev ? (
        <button
          onClick={() => navigate(prev)}
          className="border border-slate-600 text-slate-300 hover:border-slate-400 px-5 py-2 rounded-lg text-sm transition-colors"
        >
          ← Back
        </button>
      ) : <div />}
      {next && (
        <button
          onClick={() => { onNext?.(); navigate(next); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          {nextLabel}
        </button>
      )}
    </div>
  );
}
