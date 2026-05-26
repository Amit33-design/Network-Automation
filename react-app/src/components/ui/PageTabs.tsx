import { useState } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: string;
}

interface PageTabsProps {
  tabs: Tab[];
  children: (activeId: string) => React.ReactNode;
  defaultTab?: string;
}

export function PageTabs({ tabs, children, defaultTab }: PageTabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id ?? '');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-slate-700 overflow-x-auto pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              active === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-white hover:border-slate-500'
            }`}
          >
            {tab.icon && <span className="mr-1.5">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
      <div>{children(active)}</div>
    </div>
  );
}
