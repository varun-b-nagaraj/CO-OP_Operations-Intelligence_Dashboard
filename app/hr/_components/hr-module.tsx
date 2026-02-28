'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { hasPermission } from '@/lib/permissions';
import { PermissionFlag } from '@/lib/types';

import { HRTabItem, TabNavigation } from './tab-navigation';

const ScheduleTab = dynamic(() => import('./schedule-tab').then((module) => module.ScheduleTab));
const EmployeesTab = dynamic(() => import('./employees-tab').then((module) => module.EmployeesTab));
const SettingsTab = dynamic(() => import('./settings-tab').then((module) => module.SettingsTab));
const StrikesTab = dynamic(() => import('./strikes-tab').then((module) => module.StrikesTab));
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
  { id: 'employees', label: 'Employees', permission: 'hr.attendance.view' },
  { id: 'settings', label: 'Settings', permission: 'hr.settings.edit' },
  { id: 'strikes', label: 'Strikes', permission: 'hr.strikes.manage' },
  { id: 'meeting-attendance', label: 'Meeting Attendance', permission: 'hr.attendance.view' },
  { id: 'shift-attendance', label: 'Shift Attendance', permission: 'hr.attendance.view' },
  { id: 'requests', label: 'Requests', permission: 'hr.requests.view' },
  { id: 'audit', label: 'Audit', permission: 'hr.audit.view' }
];

function isTab(value: string | null): value is HRTabItem['id'] {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

export function HRModule() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visibleTabs = tabs.filter((tab) => hasPermission(tab.permission));

  const requestedTab = searchParams.get('tab');
  const activeTab = isTab(requestedTab) ? requestedTab : 'schedule';
  const resolvedTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : visibleTabs[0]?.id;

  const onTabChange = (tab: HRTabItem['id']) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', tab);
    const href = `${pathname}?${nextParams.toString()}` as Route;
    router.replace(href, { scroll: false });
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] p-3 md:p-6">
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-4">
          <h1 className="text-xl font-semibold text-neutral-900">HR Module</h1>
          <p className="mt-1 text-sm text-neutral-700">
            Single-page dashboard with separate meeting and shift attendance systems.
          </p>
        </header>

        <TabNavigation activeTab={resolvedTab ?? 'schedule'} onTabChange={onTabChange} tabs={visibleTabs} />

        <section
          aria-labelledby={`tab-${resolvedTab}`}
          className="p-3 md:p-5"
          id={`panel-${resolvedTab}`}
          role="tabpanel"
        >
          {resolvedTab === 'schedule' && <ScheduleTab />}
          {resolvedTab === 'employees' && <EmployeesTab />}
          {resolvedTab === 'settings' && <SettingsTab />}
          {resolvedTab === 'strikes' && <StrikesTab />}
          {resolvedTab === 'meeting-attendance' && <MeetingAttendanceTab />}
          {resolvedTab === 'shift-attendance' && <ShiftAttendanceTab />}
          {resolvedTab === 'requests' && <RequestsTab />}
          {resolvedTab === 'audit' && <AuditTab />}
        </section>
      </section>
    </main>
  );
}
