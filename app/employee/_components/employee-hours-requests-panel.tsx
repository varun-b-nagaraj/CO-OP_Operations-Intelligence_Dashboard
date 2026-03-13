'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

type HourRequest = {
  id: string;
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

export function EmployeeHoursRequestsPanel() {
  const queryClient = useQueryClient();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [hoursDate, setHoursDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectName, setProjectName] = useState('');
  const [commitmentName, setCommitmentName] = useState('');
  const [submittedHours, setSubmittedHours] = useState('1');
  const [description, setDescription] = useState('');

  const requestsQuery = useQuery({
    queryKey: ['employee-hours-requests'],
    queryFn: async () => {
      const response = await fetch('/api/employee/hours', { cache: 'no-store' });
      const payload = (await response.json()) as { ok: boolean; requests?: HourRequest[]; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Unable to load hours history');
      }
      return payload.requests ?? [];
    }
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/employee/hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours_date: hoursDate,
          project_name: projectName,
          commitment_name: commitmentName,
          submitted_hours: Number(submittedHours),
          description
        })
      });
      const payload = (await response.json()) as { ok: boolean; request?: HourRequest; error?: string };
      if (!response.ok || !payload.ok || !payload.request) {
        throw new Error(payload.error ?? 'Unable to submit hours');
      }
      return payload.request;
    },
    onSuccess: () => {
      setStatusMessage('Hours submission sent to executive approvals.');
      setProjectName('');
      setCommitmentName('');
      setSubmittedHours('1');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['employee-hours-requests'] });
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to submit hours');
    }
  });

  const pendingCount = useMemo(
    () => (requestsQuery.data ?? []).filter((row) => row.status === 'pending').length,
    [requestsQuery.data]
  );

  return (
    <section className="space-y-3 border border-neutral-300 p-3">
      <header>
        <h3 className="text-sm font-semibold">Hours submission request</h3>
        <p className="text-xs text-neutral-600">
          Submit daily commitment/project hours for executive review and long-term trend tracking.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          Hours date
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setHoursDate(event.target.value)}
            type="date"
            value={hoursDate}
          />
        </label>
        <label className="text-sm">
          Hours worked
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            max="24"
            min="0.25"
            onChange={(event) => setSubmittedHours(event.target.value)}
            step="0.25"
            type="number"
            value={submittedHours}
          />
        </label>
        <label className="text-sm">
          Project
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Inventory migration"
            value={projectName}
          />
        </label>
        <label className="text-sm">
          Commitment (optional)
          <input
            className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
            onChange={(event) => setCommitmentName(event.target.value)}
            placeholder="Weekly stock reconciliation"
            value={commitmentName}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Description
          <textarea
            className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What work was done during these hours?"
            value={description}
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm text-white disabled:opacity-40"
          disabled={submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          type="button"
        >
          Submit to Executive
        </button>
        <p className="text-xs text-neutral-600">Pending requests: {pendingCount}</p>
      </div>

      {statusMessage ? <p className="text-sm text-brand-maroon">{statusMessage}</p> : null}
      {requestsQuery.error ? <p className="text-sm text-red-700">{(requestsQuery.error as Error).message}</p> : null}

      <section className="border border-neutral-300">
        <header className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium">
          Your hour request history
        </header>
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Submitted</th>
              <th className="border-b border-neutral-300 p-2 text-left">Date</th>
              <th className="border-b border-neutral-300 p-2 text-left">Project</th>
              <th className="border-b border-neutral-300 p-2 text-left">Hours</th>
              <th className="border-b border-neutral-300 p-2 text-left">Status</th>
              <th className="border-b border-neutral-300 p-2 text-left">Review</th>
            </tr>
          </thead>
          <tbody>
            {(requestsQuery.data ?? []).map((row) => (
              <tr className="border-b border-neutral-200" key={row.id}>
                <td className="p-2">{new Date(row.created_at).toLocaleString()}</td>
                <td className="p-2">{row.hours_date}</td>
                <td className="p-2">
                  <p>{row.project_name}</p>
                  {row.commitment_name ? <p className="text-xs text-neutral-600">{row.commitment_name}</p> : null}
                </td>
                <td className="p-2">
                  {Number(row.submitted_hours).toFixed(2)}
                  {row.approved_hours !== null ? ` -> ${Number(row.approved_hours).toFixed(2)}` : ''}
                </td>
                <td className="p-2">{row.status}</td>
                <td className="p-2 text-xs text-neutral-700">
                  {row.reviewed_at ? `${new Date(row.reviewed_at).toLocaleString()} by ${row.reviewed_by ?? 'exec'}` : 'Pending'}
                  {row.review_notes ? <p className="mt-1">{row.review_notes}</p> : null}
                </td>
              </tr>
            ))}
            {!requestsQuery.isLoading && (requestsQuery.data?.length ?? 0) === 0 ? (
              <tr>
                <td className="p-3 text-sm text-neutral-600" colSpan={6}>
                  No hour submissions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </section>
  );
}
