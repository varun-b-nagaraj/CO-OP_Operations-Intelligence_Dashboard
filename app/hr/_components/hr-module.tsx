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

  const onModuleChange = (module: PrimaryModule) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('module', module);
    if (module === 'hr') {
      nextParams.set('tab', resolvedHRTab ?? 'schedule');
    } else {
      nextParams.set('tab', activeCFATab);
    }
    replaceWithParams(nextParams);
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
    <main className="min-h-screen w-full p-3 md:p-6">
      <section className="border border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 p-4">
          <h1 className="text-xl font-semibold text-neutral-900">Inventory Operations Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-700">
            Switch between HR operations and Chick-fil-A operations in one place.
          </p>
        </header>

        <nav aria-label="Primary modules" className="border-b border-neutral-300 bg-white" role="tablist">
          <div className="grid grid-cols-2 gap-2 p-2 md:flex md:flex-wrap">
            {([
              { id: 'hr', label: 'HR' },
              { id: 'cfa', label: 'Chick-fil-A' }
            ] as const).map((module) => {
              const isActive = resolvedModule === module.id;
              return (
                <button
                  aria-controls={`module-panel-${module.id}`}
                  aria-selected={isActive}
                  className={`min-h-[44px] min-w-[44px] border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'border-brand-maroon bg-brand-maroon text-white'
                      : 'border-neutral-300 bg-white text-neutral-800 hover:border-brand-maroon'
                  }`}
                  id={`module-tab-${module.id}`}
                  key={module.id}
                  onClick={() => onModuleChange(module.id)}
                  role="tab"
                  type="button"
                >
                  {module.label}
                </button>
              );
            })}
          </div>
        </nav>

        {resolvedModule === 'hr' ? (
          <section aria-labelledby="module-tab-hr" id="module-panel-hr" role="tabpanel">
            <header className="border-b border-neutral-300 p-4">
              <h2 className="text-lg font-semibold text-neutral-900">HR Module</h2>
              <p className="mt-1 text-sm text-neutral-700">
                Single-page dashboard with separate meeting and shift attendance systems.
              </p>
            </header>

            <TabNavigation activeTab={resolvedHRTab ?? 'schedule'} onTabChange={onHRTabChange} tabs={visibleTabs} />

            <section
              aria-labelledby={`tab-${resolvedHRTab}`}
              className="p-3 md:p-5"
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
          <section aria-labelledby="module-tab-cfa" id="module-panel-cfa" role="tabpanel">
            <CFAModule activeTab={activeCFATab} onTabChange={onCFATabChange} />
          </section>
        )}
      </section>
    </main>
  );
}
