'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { hasPermission } from '@/lib/permissions';
import { PermissionFlag } from '@/lib/types';

import { CFATabId, CFAModule, CFA_TABS, isCFATab } from './cfa-module';
import { HRTabItem } from './tab-navigation';
import { currentMonthRange } from './utils';

const ScheduleTab = dynamic(() => import('./schedule-tab').then((module) => module.ScheduleTab));
const EmployeesTab = dynamic(() => import('./employees-tab').then((module) => module.EmployeesTab));
const MeetingAttendanceTab = dynamic(() =>
  import('./meeting-attendance-tab').then((module) => module.MeetingAttendanceTab)
);
const ShiftAttendanceTab = dynamic(() =>
  import('./shift-attendance-tab').then((module) => module.ShiftAttendanceTab)
);
const RequestsTab = dynamic(() => import('./requests-tab').then((module) => module.RequestsTab));
const AuditTab = dynamic(() => import('./audit-tab').then((module) => module.AuditTab));

const tabs: Array<HRTabItem & { permission: PermissionFlag }> = [
  { id: 'schedule', label: 'Schedule', permission: 'hr.schedule.view' },
  { id: 'employees', label: 'Employee Management', permission: 'hr.attendance.view' },
  { id: 'meeting-attendance', label: 'Meeting Attendance', permission: 'hr.attendance.view' },
  { id: 'shift-attendance', label: 'Shift Attendance', permission: 'hr.attendance.view' },
  { id: 'requests', label: 'Requests', permission: 'hr.requests.view' },
  { id: 'audit', label: 'Audit', permission: 'hr.audit.view' }
];

type PrimaryModule = 'hr' | 'cfa';

function isTab(value: string | null): value is HRTabItem['id'] {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

export function HRModule() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visibleTabs = tabs.filter((tab) => hasPermission(tab.permission));
  const [globalDateRange, setGlobalDateRange] = useState(currentMonthRange());

  const requestedModule = searchParams.get('module');
  const resolvedModule: PrimaryModule = requestedModule === 'cfa' ? 'cfa' : 'hr';

  const requestedTabRaw = searchParams.get('tab');
  const requestedTab =
    requestedTabRaw === 'settings' || requestedTabRaw === 'strikes'
      ? 'employees'
      : requestedTabRaw;

  const activeHRTab = isTab(requestedTab) ? requestedTab : 'schedule';
  const resolvedHRTab = visibleTabs.some((tab) => tab.id === activeHRTab) ? activeHRTab : visibleTabs[0]?.id;

  const activeCFATab: CFATabId = isCFATab(requestedTabRaw) ? requestedTabRaw : 'daily-log';

  const replaceWithParams = (nextParams: URLSearchParams) => {
    const href = `${pathname}?${nextParams.toString()}` as Route;
    router.replace(href, { scroll: false });
  };

  const onHRTabChange = (tab: HRTabItem['id']) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('module', 'hr');
    nextParams.set('tab', tab);
    replaceWithParams(nextParams);
  };

  const onCFATabChange = (tab: CFATabId) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('module', 'cfa');
    nextParams.set('tab', tab);
    replaceWithParams(nextParams);
  };

  const activeNavId = resolvedModule === 'hr' ? (resolvedHRTab ?? 'schedule') : activeCFATab;
  const navItems =
    resolvedModule === 'hr'
      ? visibleTabs.map((tab) => ({ id: tab.id, label: tab.label }))
      : CFA_TABS.map((tab) => ({ id: tab.id, label: tab.label }));

  return (
    <DepartmentShell
      activeNavId={activeNavId}
      navAriaLabel={resolvedModule === 'hr' ? 'HR navigation' : 'Chick-fil-A navigation'}
      navItems={navItems}
      onNavSelect={(id) => {
        if (resolvedModule === 'hr') {
          onHRTabChange(id as HRTabItem['id']);
          return;
        }
        onCFATabChange(id as CFATabId);
      }}
      subtitle={resolvedModule === 'hr' ? 'People operations and attendance controls' : 'Sales log and forecast operations'}
      title={resolvedModule === 'hr' ? 'HR Dashboard' : 'Chick-fil-A Dashboard'}
    >
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-neutral-900">{resolvedModule === 'hr' ? 'HR Workspace' : 'CFA Workspace'}</h2>
              <p className="mt-1 text-sm text-neutral-700">
                Module view is selected at launch and stays locked on this page.
              </p>
            </div>
            {resolvedModule === 'hr' && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-neutral-700">
                  From
                  <input
                    className="ml-2 min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) =>
                      setGlobalDateRange((previous) => ({ ...previous, from: event.target.value }))
                    }
                    type="date"
                    value={globalDateRange.from}
                  />
                </label>
                <label className="text-xs text-neutral-700">
                  To
                  <input
                    className="ml-2 min-h-[36px] border border-neutral-300 px-2 text-sm"
                    onChange={(event) =>
                      setGlobalDateRange((previous) => ({ ...previous, to: event.target.value }))
                    }
                    type="date"
                    value={globalDateRange.to}
                  />
                </label>
              </div>
            )}
          </div>
        </header>

        {resolvedModule === 'hr' ? (
          <section id="module-panel-hr">
            <section
              className="p-0"
              id={`panel-${resolvedHRTab}`}
              role="tabpanel"
            >
              {resolvedHRTab === 'schedule' && <ScheduleTab />}
              {resolvedHRTab === 'employees' && <EmployeesTab dateRange={globalDateRange} />}
              {resolvedHRTab === 'meeting-attendance' && <MeetingAttendanceTab dateRange={globalDateRange} />}
              {resolvedHRTab === 'shift-attendance' && <ShiftAttendanceTab dateRange={globalDateRange} />}
              {resolvedHRTab === 'requests' && <RequestsTab />}
              {resolvedHRTab === 'audit' && <AuditTab dateRange={globalDateRange} />}
            </section>
          </section>
        ) : (
          <section id="module-panel-cfa">
            <CFAModule activeTab={activeCFATab} />
          </section>
        )}
      </section>
    </DepartmentShell>
  );
}
