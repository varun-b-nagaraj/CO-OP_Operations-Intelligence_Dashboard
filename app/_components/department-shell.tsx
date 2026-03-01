'use client';

import { ReactNode } from 'react';

export interface DepartmentShellNavItem {
  id: string;
  label: string;
  badge?: number | string;
}

interface DepartmentShellProps {
  title: string;
  subtitle: string;
  navAriaLabel: string;
  navItems: DepartmentShellNavItem[];
  activeNavId: string;
  onNavSelect: (id: string) => void;
  children: ReactNode;
}

export function DepartmentShell({
  title,
  subtitle,
  navAriaLabel,
  navItems,
  activeNavId,
  onNavSelect,
  children
}: DepartmentShellProps) {
  return (
    <main className="min-h-screen w-full text-neutral-900">
      <div className="grid min-h-screen w-full grid-cols-1 border border-neutral-300 bg-white md:grid-cols-[240px_1fr]">
        <aside className="w-full border-b border-neutral-300 bg-white md:min-h-screen md:border-b-0 md:border-r">
          <div className="border-b border-neutral-300 px-4 py-4">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-1 text-xs text-neutral-600">{subtitle}</p>
          </div>
          <nav aria-label={navAriaLabel} className="p-0" role="tablist">
            {navItems.map((item) => {
              const isActive = activeNavId === item.id;
              return (
                <button
                  key={item.id}
                  aria-selected={isActive}
                  className={`ui-click flex min-h-[44px] w-full items-center justify-between border-b border-neutral-300 px-4 py-3 text-left text-sm font-medium ${
                    isActive ? 'bg-brand-maroon text-white' : 'bg-white text-neutral-800 hover:bg-neutral-50'
                  }`}
                  onClick={() => onNavSelect(item.id)}
                  role="tab"
                  type="button"
                >
                  <span>{item.label}</span>
                  {item.badge ? <span className="text-xs tabular-nums">{item.badge}</span> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="ui-fade-in w-full flex-1">{children}</section>
      </div>
    </main>
  );
}
