'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getAuditLog } from '@/app/actions/audit';
import { usePermission } from '@/lib/permissions';

type AuditFiltersState = {
  userId: string;
  actionType: string;
  tableName: string;
};

export function AuditTab(props: { dateRange: { from: string; to: string } }) {
  const canView = usePermission('hr.audit.view');
  const [filters, setFilters] = useState<AuditFiltersState>({
    userId: '',
    actionType: '',
    tableName: ''
  });
  const [cursorTrail, setCursorTrail] = useState<Array<string | null>>([null]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const currentCursor = cursorTrail[cursorIndex];

  const normalizedFilters = useMemo(
    () => ({
      dateFrom: props.dateRange.from || undefined,
      dateTo: props.dateRange.to || undefined,
      userId: filters.userId || undefined,
      actionType: filters.actionType || undefined,
      tableName: filters.tableName || undefined,
      cursor: currentCursor ?? undefined,
      limit: 50
    }),
    [currentCursor, filters, props.dateRange.from, props.dateRange.to]
  );

  const auditQuery = useQuery({
    queryKey: ['hr-audit-log', normalizedFilters],
    queryFn: async () => {
      const result = await getAuditLog(normalizedFilters);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  if (!canView) {
    return <p className="text-sm text-neutral-700">You do not have permission to view audit logs.</p>;
  }

  return (
    <section className="space-y-4">
      <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-3">
        <label className="text-sm">
          User
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                userId: event.target.value
              }))
            }
            placeholder="open_access"
            value={filters.userId}
          />
        </label>
        <label className="text-sm">
          Action
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                actionType: event.target.value
              }))
            }
            placeholder="strike"
            value={filters.actionType}
          />
        </label>
        <label className="text-sm">
          Table
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                tableName: event.target.value
              }))
            }
            placeholder="shift_attendance"
            value={filters.tableName}
          />
        </label>
      </div>

      {auditQuery.error && <p className="text-sm text-red-700">{(auditQuery.error as Error).message}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Timestamp</th>
              <th className="border-b border-neutral-300 p-2 text-left">User</th>
              <th className="border-b border-neutral-300 p-2 text-left">Action</th>
              <th className="border-b border-neutral-300 p-2 text-left">Table</th>
              <th className="border-b border-neutral-300 p-2 text-left">Record</th>
            </tr>
          </thead>
          <tbody>
            {(auditQuery.data?.entries ?? []).map((entry) => (
              <tr className="border-b border-neutral-200" key={entry.id}>
                <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                <td className="p-2">{entry.user_id ?? 'open_access'}</td>
                <td className="p-2">{entry.action}</td>
                <td className="p-2">{entry.table_name}</td>
                <td className="p-2">{entry.record_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          className="min-h-[44px] border border-neutral-300 px-3 disabled:opacity-40"
          disabled={cursorIndex === 0}
          onClick={() => setCursorIndex((previous) => Math.max(0, previous - 1))}
          type="button"
        >
          Previous
        </button>
        <button
          className="min-h-[44px] border border-neutral-300 px-3 disabled:opacity-40"
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
