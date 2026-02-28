'use client';

export interface HRTabItem {
  id:
    | 'schedule'
    | 'employees'
    | 'meeting-attendance'
    | 'shift-attendance'
    | 'requests'
    | 'audit';
  label: string;
}

interface TabNavigationProps {
  tabs: HRTabItem[];
  activeTab: HRTabItem['id'];
  onTabChange: (tab: HRTabItem['id']) => void;
}

export function TabNavigation({ tabs, activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav
      aria-label="HR module tabs"
      className="border-b border-neutral-300 bg-white"
      role="tablist"
    >
      <div className="grid grid-cols-2 gap-2 p-2 md:flex md:flex-wrap">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              aria-controls={`panel-${tab.id}`}
              aria-selected={isActive}
              className={`min-h-[44px] min-w-[44px] border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'border-brand-maroon bg-brand-maroon text-white'
                  : 'border-neutral-300 bg-white text-neutral-800 hover:border-brand-maroon'
              }`}
              id={`tab-${tab.id}`}
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
