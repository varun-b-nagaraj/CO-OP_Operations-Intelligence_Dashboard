'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { hasPermission } from '@/lib/permissions';
import { PermissionFlag } from '@/lib/types';

import { CFATabId, CFAModule, isCFATab } from './cfa-module';
import { HRTabItem, TabNavigation } from './tab-navigation';

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

  return (
    <main className="min-h-screen w-full">
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-4">
          <h1 className="text-xl font-semibold text-neutral-900">
            {resolvedModule === 'hr' ? 'HR Dashboard' : 'Chick-fil-A Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-neutral-700">
            Module view is selected at launch and stays locked on this page.
          </p>
        </header>

        {resolvedModule === 'hr' ? (
          <section id="module-panel-hr">
            <TabNavigation activeTab={resolvedHRTab ?? 'schedule'} onTabChange={onHRTabChange} tabs={visibleTabs} />

            <section
              aria-labelledby={`tab-${resolvedHRTab}`}
              className="p-0"
              id={`panel-${resolvedHRTab}`}
              role="tabpanel"
            >
              {resolvedHRTab === 'schedule' && <ScheduleTab />}
              {resolvedHRTab === 'employees' && <EmployeesTab />}
              {resolvedHRTab === 'meeting-attendance' && <MeetingAttendanceTab />}
              {resolvedHRTab === 'shift-attendance' && <ShiftAttendanceTab />}
              {resolvedHRTab === 'requests' && <RequestsTab />}
              {resolvedHRTab === 'audit' && <AuditTab />}
            </section>
          </section>
        ) : (
          <section id="module-panel-cfa">
            <CFAModule activeTab={activeCFATab} onTabChange={onCFATabChange} />
          </section>
        )}
      </section>
    </main>
  );
}
