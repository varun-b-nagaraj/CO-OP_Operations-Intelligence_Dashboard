'use client';

import { useEffect, useState } from 'react';

import { usePermission } from '@/lib/permissions';

type InventoryAttendanceAnalytics = {
  totalChecks: number;
  totalSignups: number;
  totalPresent: number;
  totalAbsent: number;
  totalExcused: number;
  attendanceRate: number;
  noShowRate: number;
  excusedRate: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `Request failed (${response.status})`);
  }
  return payload;
}

export function InventoryAttendanceSummary() {
  const canViewInventoryAttendance = usePermission('inventory.attendance.view');
  const [analytics, setAnalytics] = useState<InventoryAttendanceAnalytics | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!canViewInventoryAttendance) return;
    void fetchJson<{ ok: true; analytics: InventoryAttendanceAnalytics }>('/api/inventory/checks/analytics')
      .then((payload) => {
        setAnalytics(payload.analytics);
        setStatus('');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Unable to load inventory attendance snapshot.');
      });
  }, [canViewInventoryAttendance]);

  if (!canViewInventoryAttendance) return null;

  return (
    <section className="border border-neutral-300 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Inventory Attendance Snapshot</h3>
          <p className="mt-1 text-xs text-neutral-600">
            Live attendance metrics from inventory checks and roster outcomes.
          </p>
        </div>
      </div>
      {status ? <p className="mt-2 text-xs text-brand-maroon">{status}</p> : null}
      {analytics ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border border-neutral-200 p-2 text-xs">
            <p className="text-neutral-500">Checks</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">{analytics.totalChecks}</p>
          </div>
          <div className="border border-neutral-200 p-2 text-xs">
            <p className="text-neutral-500">Signups</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">{analytics.totalSignups}</p>
          </div>
          <div className="border border-neutral-200 p-2 text-xs">
            <p className="text-neutral-500">Attendance Rate</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">{analytics.attendanceRate.toFixed(1)}%</p>
          </div>
          <div className="border border-neutral-200 p-2 text-xs">
            <p className="text-neutral-500">No-show Rate</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">{analytics.noShowRate.toFixed(1)}%</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
