'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

type ExecutiveHourRequest = {
  id: string;
  employee_id: number;
  employee_name: string;
  employee_s_number: string;
  hours_date: string;
  project_name: string;
  commitment_name: string | null;
  description: string;
  submitted_hours: number;
  approved_hours: number | null;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

type ExecutiveHoursResponse = {
  ok: boolean;
  requests?: ExecutiveHourRequest[];
  analytics?: {
    pending_count: number;
    approved_hours_total: number;
    project_totals: Array<{ project_name: string; hours: number }>;
    employee_totals: Array<{ employee_s_number: string; hours: number }>;
  };
  error?: string;
};

function defaultFromDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  return date.toISOString().slice(0, 10);
}

export function ExecutiveHoursApprovalsTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'denied'>('pending');
  const [from, setFrom] = useState(defaultFromDate());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [employee, setEmployee] = useState('');
  const [project, setProject] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ['executive-hours-requests', status, from, to, employee, project],
    [status, from, to, employee, project]
  );

  const requestsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        status,
        from,
        to,
        employee,
        project
      });
      const response = await fetch(`/api/executive/hours?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as ExecutiveHoursResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Unable to load hours approvals');
      }
      return payload;
    }
  });

  const reviewMutation = useMutation({
    mutationFn: async (input: {
      requestId: string;
      status: 'approved' | 'denied';
      approvedHours?: number;
      reviewNotes?: string;
    }) => {
      const response = await fetch(`/api/executive/hours/${input.requestId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: input.status,
          approved_hours: input.approvedHours,
          review_notes: input.reviewNotes
        })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        request?: ExecutiveHourRequest;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.request) {
        throw new Error(payload.error ?? 'Unable to review hour request');
      }
      return payload.request;
    },
    onSuccess: (row) => {
      setStatusMessage(
        row.status === 'approved'
          ? `Approved ${row.employee_s_number} for ${Number(row.approved_hours ?? row.submitted_hours).toFixed(2)} hours.`
          : `Denied hour request from ${row.employee_s_number}.`
      );
      queryClient.invalidateQueries({ queryKey: ['executive-hours-requests'] });
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to review request');
    }
  });

  const pendingRows = useMemo(
    () => (requestsQuery.data?.requests ?? []).filter((row) => row.status === 'pending'),
    [requestsQuery.data?.requests]
  );

  return (
    <section className="space-y-4 border border-neutral-300 bg-white p-4">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">Hours Approvals</h2>
        <p className="text-sm text-neutral-600">
          Executive-only approvals for employee project/commitment hours with trend visibility in one place.
        </p>
      </div>

      <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm">
          Status
          <select
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setStatus(event.target.value as 'all' | 'pending' | 'approved' | 'denied')}
            value={status}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </label>
        <label className="text-sm">
          From
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setFrom(event.target.value)}
            type="date"
            value={from}
          />
        </label>
        <label className="text-sm">
          To
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setTo(event.target.value)}
            type="date"
            value={to}
          />
        </label>
        <label className="text-sm">
          Employee ID
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setEmployee(event.target.value)}
            placeholder="s151579"
            value={employee}
          />
        </label>
        <label className="text-sm">
          Project
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setProject(event.target.value)}
            placeholder="Inventory"
            value={project}
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-600">Pending approvals</p>
          <p className="text-lg font-semibold">{requestsQuery.data?.analytics?.pending_count ?? 0}</p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-600">Approved hours total</p>
          <p className="text-lg font-semibold">
            {Number(requestsQuery.data?.analytics?.approved_hours_total ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="border border-neutral-300 p-3">
          <p className="text-xs text-neutral-600">Rows in current filter</p>
          <p className="text-lg font-semibold">{requestsQuery.data?.requests?.length ?? 0}</p>
        </div>
      </div>

      {statusMessage ? <p className="text-sm text-brand-maroon">{statusMessage}</p> : null}
      {requestsQuery.error ? <p className="text-sm text-red-700">{(requestsQuery.error as Error).message}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="border border-neutral-300 p-3">
          <h3 className="text-sm font-semibold text-neutral-900">Top Projects by Hours</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {(requestsQuery.data?.analytics?.project_totals ?? []).slice(0, 6).map((row) => (
              <li className="flex items-center justify-between" key={row.project_name}>
                <span>{row.project_name}</span>
                <span className="font-medium">{row.hours.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="border border-neutral-300 p-3">
          <h3 className="text-sm font-semibold text-neutral-900">Top Employees by Hours</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {(requestsQuery.data?.analytics?.employee_totals ?? []).slice(0, 6).map((row) => (
              <li className="flex items-center justify-between" key={row.employee_s_number}>
                <span>{row.employee_s_number}</span>
                <span className="font-medium">{row.hours.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Submitted</th>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">Date</th>
              <th className="border-b border-neutral-300 p-2 text-left">Project</th>
              <th className="border-b border-neutral-300 p-2 text-left">Description</th>
              <th className="border-b border-neutral-300 p-2 text-left">Hours</th>
              <th className="border-b border-neutral-300 p-2 text-left">Status</th>
              <th className="border-b border-neutral-300 p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(requestsQuery.data?.requests ?? []).map((row) => (
              <tr className="border-b border-neutral-200" key={row.id}>
                <td className="p-2">{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-2">
                  <p>{row.employee_name}</p>
                  <p className="text-xs text-neutral-600">{row.employee_s_number}</p>
                </td>
                <td className="p-2">{row.hours_date}</td>
                <td className="p-2">
                  <p>{row.project_name}</p>
                  {row.commitment_name ? <p className="text-xs text-neutral-600">{row.commitment_name}</p> : null}
                </td>
                <td className="max-w-[260px] p-2 text-xs text-neutral-700">{row.description}</td>
                <td className="p-2">
                  {Number(row.submitted_hours).toFixed(2)}
                  {row.approved_hours !== null ? ` -> ${Number(row.approved_hours).toFixed(2)}` : ''}
                </td>
                <td className="p-2">{row.status}</td>
                <td className="p-2">
                  {row.status === 'pending' ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="min-h-[36px] border border-neutral-500 px-2 text-xs"
                        disabled={reviewMutation.isPending}
                        onClick={() =>
                          reviewMutation.mutate({
                            requestId: row.id,
                            status: 'approved',
                            approvedHours: row.submitted_hours
                          })
                        }
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        className="min-h-[36px] border border-neutral-500 px-2 text-xs"
                        disabled={reviewMutation.isPending}
                        onClick={() => reviewMutation.mutate({ requestId: row.id, status: 'denied' })}
                        type="button"
                      >
                        Deny
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-600">
                      {row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : ''}
                      {row.reviewed_by ? ` by ${row.reviewed_by}` : ''}
                    </p>
                  )}
                </td>
              </tr>
            ))}
            {!requestsQuery.isLoading && (requestsQuery.data?.requests?.length ?? 0) === 0 ? (
              <tr>
                <td className="p-3 text-sm text-neutral-600" colSpan={8}>
                  No hour requests match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pendingRows.length > 0 ? (
        <p className="text-xs text-neutral-600">
          {pendingRows.length} pending request(s) require executive review in this filtered window.
        </p>
      ) : null}
    </section>
  );
}
