'use client';

import { useMemo, useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { SharedCalendarTab } from '@/app/_components/shared-calendar-tab';
import { FinanceReportsTab } from '@/app/finance/_components/finance-reports-tab';
import { FinanceUploadTab } from '@/app/finance/_components/finance-upload-tab';

type FinanceTabId = 'upload' | 'reports' | 'calendar';

const TABS: Array<{ id: FinanceTabId; label: string; icon: 'reports' | 'history' | 'calendar' }> = [
  { id: 'upload', label: 'Upload + Generate', icon: 'reports' },
  { id: 'reports', label: 'Previous Reports', icon: 'history' },
  { id: 'calendar', label: 'General Calendar', icon: 'calendar' }
];

export function FinanceDashboard() {
  const [activeTab, setActiveTab] = useState<FinanceTabId>('upload');

  const activeLabel = useMemo(
    () => TABS.find((tab) => tab.id === activeTab)?.label ?? 'Finance',
    [activeTab]
  );

  return (
    <DepartmentShell
      activeNavId={activeTab}
      contentHeading={activeLabel}
      departmentIcon="reports"
      navAriaLabel="Finance navigation"
      navItems={TABS}
      onNavSelect={(id) => setActiveTab(id as FinanceTabId)}
      subtitle="Sales ingestion, accounting-ready transformation, and persistent report exports"
      title="Finance Dashboard"
    >
      <section className="w-full border-x border-b border-neutral-300 bg-white">
        {activeTab === 'upload' ? <FinanceUploadTab /> : null}
        {activeTab === 'reports' ? <FinanceReportsTab /> : null}
        {activeTab === 'calendar' ? <SharedCalendarTab sourceDepartment="finance" /> : null}
      </section>
    </DepartmentShell>
  );
}
