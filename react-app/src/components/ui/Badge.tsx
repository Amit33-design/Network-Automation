interface BadgeProps {
  variant?: 'green' | 'yellow' | 'red' | 'blue' | 'slate';
  children: React.ReactNode;
}

const VARIANTS: Record<string, string> = {
  green:  'bg-green-900/40 text-green-400 border-green-800',
  yellow: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  red:    'bg-red-900/40 text-red-400 border-red-800',
  blue:   'bg-blue-900/40 text-blue-400 border-blue-800',
  slate:  'bg-slate-800 text-slate-400 border-slate-700',
};

export function Badge({ variant = 'slate', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 rounded text-xs font-medium ${VARIANTS[variant]}`}>
      {children}
    </span>
  );
}
