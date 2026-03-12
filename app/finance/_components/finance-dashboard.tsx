'use client';

import { useEffect, useMemo, useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { SharedCalendarTab } from '@/app/_components/shared-calendar-tab';
import { FinanceReportsTab } from '@/app/finance/_components/finance-reports-tab';
import { FinanceUploadTab } from '@/app/finance/_components/finance-upload-tab';
import { usePermission } from '@/lib/permissions';

type FinanceTabId = 'upload' | 'reports' | 'calendar';

const TABS: Array<{ id: FinanceTabId; label: string; icon: 'reports' | 'history' | 'calendar' }> = [
  { id: 'upload', label: 'Upload + Generate', icon: 'reports' },
  { id: 'reports', label: 'Previous Reports', icon: 'history' },
  { id: 'calendar', label: 'General Calendar', icon: 'calendar' }
];

export function FinanceDashboard() {
  const canViewUpload = usePermission('finance.upload.view');
  const canViewReports = usePermission('finance.reports.view');
  const canViewCalendar = usePermission('finance.calendar.view');

  const navTabs = useMemo(
    () =>
      TABS.filter((tab) => {
        if (tab.id === 'upload') return canViewUpload;
        if (tab.id === 'reports') return canViewReports;
        if (tab.id === 'calendar') return canViewCalendar;
        return false;
      }),
    [canViewCalendar, canViewReports, canViewUpload]
  );

  const [activeTab, setActiveTab] = useState<FinanceTabId>('upload');

  const activeLabel = useMemo(
    () => navTabs.find((tab) => tab.id === activeTab)?.label ?? 'Finance',
    [activeTab, navTabs]
  );

  useEffect(() => {
    if (navTabs.length === 0) return;
    if (!navTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(navTabs[0].id);
    }
  }, [activeTab, navTabs]);

  if (navTabs.length === 0) {
    return (
      <main className="p-4 text-sm text-neutral-700">
        You do not have permission to access finance modules.
      </main>
    );
  }

  return (
    <DepartmentShell
      activeNavId={activeTab}
      contentHeading={activeLabel}
      departmentIcon="reports"
      navAriaLabel="Finance navigation"
      navItems={navTabs}
      onNavSelect={(id) => setActiveTab(id as FinanceTabId)}
      subtitle="Sales ingestion, accounting-ready transformation, and persistent report exports"
      title="Finance Dashboard"
    >
      <section className="w-full border-x border-b border-neutral-300 bg-white">
        {activeTab === 'upload' && canViewUpload ? <FinanceUploadTab /> : null}
        {activeTab === 'reports' && canViewReports ? <FinanceReportsTab /> : null}
        {activeTab === 'calendar' && canViewCalendar ? <SharedCalendarTab sourceDepartment="finance" /> : null}
      </section>
    </DepartmentShell>
  );
}
