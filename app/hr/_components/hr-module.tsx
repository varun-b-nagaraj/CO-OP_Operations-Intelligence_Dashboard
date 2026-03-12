'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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
const SharedCalendarTab = dynamic(() =>
  import('@/app/_components/shared-calendar-tab').then((module) => module.SharedCalendarTab)
);

const tabs: Array<HRTabItem & { permission: PermissionFlag }> = [
  { id: 'schedule', label: 'Schedule', icon: 'schedule', permission: 'hr.schedule.view' },
  { id: 'employees', label: 'Employee Management', icon: 'employees', permission: 'hr.attendance.view' },
  { id: 'meeting-attendance', label: 'Meeting Attendance', icon: 'meeting', permission: 'hr.attendance.view' },
  { id: 'shift-attendance', label: 'Shift Attendance', icon: 'shift', permission: 'hr.attendance.view' },
  { id: 'requests', label: 'Requests', icon: 'requests', permission: 'hr.requests.view' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', permission: 'hr.schedule.view' }
];

type PrimaryModule = 'hr' | 'cfa';

function isTab(value: string | null): value is HRTabItem['id'] {
  return Boolean(value && tabs.some((tab) => tab.id === value));
}

const HR_DATE_RANGE_SESSION_KEY = 'hr_global_date_range_v1';

export function HRModule(props?: { forcedModule?: PrimaryModule }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const visibleTabs = tabs.filter((tab) => hasPermission(tab.permission));
  const [globalDateRange, setGlobalDateRange] = useState(currentMonthRange());
  const [openAddEmployeeSignal, setOpenAddEmployeeSignal] = useState(0);
  const [panelVisible, setPanelVisible] = useState(false);

  const resolvedModule: PrimaryModule = props?.forcedModule ?? 'hr';

  const requestedTabRaw = searchParams.get('tab');
  const requestedTab =
    requestedTabRaw === 'settings' || requestedTabRaw === 'hr_strikes'
      ? 'employees'
      : requestedTabRaw;

  const activeHRTab = isTab(requestedTab) ? requestedTab : 'schedule';
  const resolvedHRTab = visibleTabs.some((tab) => tab.id === activeHRTab) ? activeHRTab : visibleTabs[0]?.id;

  const activeCFATab: CFATabId = isCFATab(requestedTabRaw) ? requestedTabRaw : 'daily-log';
  const canReadCfaLogs = hasPermission('cfa.logs.read');
  const canManageCfaMenu = hasPermission('cfa.menu.manage');
  const cfaVisibleTabs = CFA_TABS.filter((tab) => {
    if (tab.id === 'menu') return canManageCfaMenu;
    return canReadCfaLogs;
  });
  const resolvedCFATab = cfaVisibleTabs.some((tab) => tab.id === activeCFATab)
    ? activeCFATab
    : cfaVisibleTabs[0]?.id;

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(HR_DATE_RANGE_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { from?: unknown; to?: unknown };
      if (typeof parsed.from !== 'string' || typeof parsed.to !== 'string') return;
      setGlobalDateRange({ from: parsed.from, to: parsed.to });
    } catch {
      // Ignore malformed session cache.
    }
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(HR_DATE_RANGE_SESSION_KEY, JSON.stringify(globalDateRange));
  }, [globalDateRange]);

  useEffect(() => {
    setPanelVisible(false);
    const frame = window.requestAnimationFrame(() => setPanelVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [resolvedModule, resolvedHRTab, activeCFATab]);

  useEffect(() => {
    if (resolvedModule !== 'cfa') return;
    if (!resolvedCFATab) return;
    if (requestedTabRaw === resolvedCFATab) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!props?.forcedModule) {
      nextParams.set('module', 'cfa');
    } else {
      nextParams.delete('module');
    }
    nextParams.set('tab', resolvedCFATab);
    replaceWithParams(nextParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedModule, resolvedCFATab, requestedTabRaw, searchParams, props?.forcedModule]);

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
    if (!props?.forcedModule) {
      nextParams.set('module', 'cfa');
    } else {
      nextParams.delete('module');
    }
    nextParams.set('tab', tab);
    replaceWithParams(nextParams);
  };

  const activeNavId = resolvedModule === 'hr' ? (resolvedHRTab ?? 'schedule') : (resolvedCFATab ?? 'daily-log');
  const navItems =
    resolvedModule === 'hr'
      ? visibleTabs.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon }))
      : cfaVisibleTabs.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon }));
  const activeNavLabel = navItems.find((item) => item.id === activeNavId)?.label ?? 'Overview';
  const canEditHRSettings = hasPermission('hr.settings.edit');
  const showHRDateRange = resolvedModule === 'hr' && resolvedHRTab !== 'schedule';

  return (
    <DepartmentShell
      activeNavId={activeNavId}
      contentHeading={resolvedModule === 'cfa' ? activeNavLabel : undefined}
      departmentIcon={resolvedModule === 'hr' ? 'dashboard' : 'menu'}
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
      <section className="min-w-0 border-x border-b border-neutral-300 bg-white">
        {resolvedModule === 'hr' && (
          <header className="border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{activeNavLabel}</h2>
              {showHRDateRange ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
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
                  {resolvedHRTab === 'employees' && canEditHRSettings ? (
                    <button
                      className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white hover:bg-[#6a0000]"
                      onClick={() => setOpenAddEmployeeSignal((previous) => previous + 1)}
                      type="button"
                    >
                      Add Employee
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>
        )}

        {resolvedModule === 'hr' ? (
          <section className="min-w-0" id="module-panel-hr">
            <section
              className={`min-w-0 p-0 transition-all duration-200 ${
                panelVisible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
              }`}
              id={`panel-${resolvedHRTab}`}
              role="tabpanel"
            >
              {resolvedHRTab === 'schedule' && <ScheduleTab />}
              {resolvedHRTab === 'calendar' && <SharedCalendarTab sourceDepartment="hr" />}
              {resolvedHRTab === 'employees' && (
                <EmployeesTab dateRange={globalDateRange} openAddEmployeeSignal={openAddEmployeeSignal} />
              )}
              {resolvedHRTab === 'meeting-attendance' && <MeetingAttendanceTab dateRange={globalDateRange} />}
              {resolvedHRTab === 'shift-attendance' && <ShiftAttendanceTab dateRange={globalDateRange} />}
              {resolvedHRTab === 'requests' && <RequestsTab />}
            </section>
          </section>
        ) : (
          <section id="module-panel-cfa">
            {resolvedCFATab ? (
              <CFAModule activeTab={resolvedCFATab} />
            ) : (
              <p className="p-4 text-sm text-neutral-700">
                You do not have permission to access CFA modules.
              </p>
            )}
          </section>
        )}
      </section>
    </DepartmentShell>
  );
}
