'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { ExecutiveAuditEntry, getExecutiveAuditLog } from '@/app/actions/executive-audit';

type AuditFiltersState = {
  dateFrom: string;
  dateTo: string;
  department: string;
  source: 'all' | 'hr_audit_log' | 'finance_report_activity_log';
  actor: string;
  action: string;
  tableName: string;
  search: string;
};

function formatDetails(entry: ExecutiveAuditEntry): string {
  const details = entry.details ?? {};
  const entries = Object.entries(details);
  if (!entries.length) return '-';
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' | ');
}

export function ExecutiveAuditLog() {
  const [filters, setFilters] = useState<AuditFiltersState>({
    dateFrom: '',
    dateTo: '',
    department: 'all',
    source: 'all',
    actor: '',
    action: '',
    tableName: '',
    search: ''
  });
  const [cursorTrail, setCursorTrail] = useState<Array<string | null>>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);

  const currentCursor = cursorTrail[cursorIndex];
  const queryFilters = useMemo(
    () => ({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      department: filters.department || undefined,
      source: filters.source,
      actor: filters.actor || undefined,
      action: filters.action || undefined,
      tableName: filters.tableName || undefined,
      search: filters.search || undefined,
      cursor: currentCursor ?? undefined,
      limit: 50
    }),
    [currentCursor, filters]
  );

  const auditQuery = useQuery({
    queryKey: ['executive-audit-log', queryFilters],
    queryFn: async () => {
      const result = await getExecutiveAuditLog(queryFilters);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const resetPagination = () => {
    setCursorTrail([null]);
    setCursorIndex(0);
  };

  return (
    <section className="space-y-4 border border-neutral-300 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">Executive Audit Log</h2>
        <p className="text-sm text-neutral-600">Cross-department change tracking with filters.</p>
      </div>

      <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">
          From
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, dateFrom: event.target.value }));
              resetPagination();
            }}
            type="date"
            value={filters.dateFrom}
          />
        </label>
        <label className="text-sm">
          To
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, dateTo: event.target.value }));
              resetPagination();
            }}
            type="date"
            value={filters.dateTo}
          />
        </label>
        <label className="text-sm">
          Department
          <select
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, department: event.target.value }));
              resetPagination();
            }}
            value={filters.department}
          >
            <option value="all">All departments</option>
            <option value="HR">HR</option>
            <option value="Finance">Finance</option>
            <option value="Product">Product</option>
            <option value="Marketing">Marketing</option>
            <option value="Inventory">Inventory</option>
            <option value="Chick-fil-A">Chick-fil-A</option>
            <option value="Executive">Executive</option>
            <option value="Employee">Employee</option>
          </select>
        </label>
        <label className="text-sm">
          Source
          <select
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({
                ...previous,
                source: event.target.value as AuditFiltersState['source']
              }));
              resetPagination();
            }}
            value={filters.source}
          >
            <option value="all">All sources</option>
            <option value="hr_audit_log">HR/Core Audit</option>
            <option value="finance_report_activity_log">Finance Activity</option>
          </select>
        </label>
        <label className="text-sm">
          Actor
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, actor: event.target.value }));
              resetPagination();
            }}
            placeholder="open_access"
            value={filters.actor}
          />
        </label>
        <label className="text-sm">
          Action
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, action: event.target.value }));
              resetPagination();
            }}
            placeholder="report_created"
            value={filters.action}
          />
        </label>
        <label className="text-sm">
          Table
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, tableName: event.target.value }));
              resetPagination();
            }}
            placeholder="hr_shift_attendance"
            value={filters.tableName}
          />
        </label>
        <label className="text-sm">
          Search
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => {
              setFilters((previous) => ({ ...previous, search: event.target.value }));
              resetPagination();
            }}
            placeholder="employee, strike, csv"
            value={filters.search}
          />
        </label>
      </div>

      {auditQuery.error ? <p className="text-sm text-red-700">{(auditQuery.error as Error).message}</p> : null}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Timestamp</th>
              <th className="border-b border-neutral-300 p-2 text-left">Department</th>
              <th className="border-b border-neutral-300 p-2 text-left">Source</th>
              <th className="border-b border-neutral-300 p-2 text-left">Actor</th>
              <th className="border-b border-neutral-300 p-2 text-left">Action</th>
              <th className="border-b border-neutral-300 p-2 text-left">Table</th>
              <th className="border-b border-neutral-300 p-2 text-left">Record</th>
              <th className="border-b border-neutral-300 p-2 text-left">Relevant Info</th>
            </tr>
          </thead>
          <tbody>
            {(auditQuery.data?.entries ?? []).map((entry) => (
              <tr className="border-b border-neutral-200" key={`${entry.source}:${entry.id}`}>
                <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                <td className="p-2">{entry.department}</td>
                <td className="p-2">{entry.source}</td>
                <td className="p-2">{entry.actor}</td>
                <td className="p-2">{entry.action}</td>
                <td className="p-2">{entry.tableName}</td>
                <td className="p-2">{entry.recordId || '-'}</td>
                <td className="max-w-[420px] p-2 text-xs text-neutral-700">{formatDetails(entry)}</td>
              </tr>
            ))}
            {!auditQuery.isLoading && (auditQuery.data?.entries.length ?? 0) === 0 ? (
              <tr>
                <td className="p-3 text-sm text-neutral-600" colSpan={8}>
                  No audit records match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-[40px] border border-neutral-300 px-3 disabled:opacity-40"
          disabled={cursorIndex === 0}
          onClick={() => setCursorIndex((previous) => Math.max(0, previous - 1))}
          type="button"
        >
          Previous
        </button>
        <button
          className="min-h-[40px] border border-neutral-300 px-3 disabled:opacity-40"
          disabled={!auditQuery.data?.nextCursor}
          onClick={() => {
            if (!auditQuery.data?.nextCursor) return;
            const next = auditQuery.data.nextCursor;
            const nextTrail = [...cursorTrail.slice(0, cursorIndex + 1), next];
            setCursorTrail(nextTrail);
            setCursorIndex(cursorIndex + 1);
          }}
          type="button"
        >
          Next
        </button>
      </div>
    </section>
  );
}
