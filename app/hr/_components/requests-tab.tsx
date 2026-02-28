'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  approveShiftExchange,
  denyShiftExchange,
  submitShiftExchange
} from '@/app/actions/shift-requests';
import { usePermission } from '@/lib/permissions';

import { getStudentDisplayName, getStudentSNumber, StudentRow, useBrowserSupabase } from './utils';

const ShiftRequestFormSchema = z.object({
  shift_date: z.string().min(10),
  shift_period: z.number().int().min(0).max(8),
  shift_slot_key: z.string().trim().min(1).max(200),
  from_employee_s_number: z.string().trim().min(1),
  to_employee_s_number: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500)
});

type ShiftRequestFormValues = z.infer<typeof ShiftRequestFormSchema>;
type StatusFilter = 'all' | 'pending' | 'approved' | 'denied';
const PAGE_SIZE = 50;

export function RequestsTab() {
  const canView = usePermission('hr.requests.view');
  const canApprove = usePermission('hr.schedule.edit');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const form = useForm<ShiftRequestFormValues>({
    resolver: zodResolver(ShiftRequestFormSchema),
    defaultValues: {
      shift_date: new Date().toISOString().slice(0, 10),
      shift_period: 1,
      shift_slot_key: '',
      from_employee_s_number: '',
      to_employee_s_number: '',
      reason: ''
    }
  });

  const studentsQuery = useQuery({
    queryKey: ['hr-requests-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const requestsQuery = useQuery({
    queryKey: ['hr-shift-requests', statusFilter, page],
    queryFn: async () => {
      let query = supabase
        .from('shift_change_requests')
        .select('*')
        .order('requested_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const studentNameBySNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of studentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(student);
      if (!sNumber) continue;
      map.set(sNumber, getStudentDisplayName(student));
    }
    return map;
  }, [studentsQuery.data]);

  const submitMutation = useMutation({
    mutationFn: async (values: ShiftRequestFormValues) => {
      const result = await submitShiftExchange(
        values.shift_date,
        values.shift_period,
        values.shift_slot_key,
        values.from_employee_s_number,
        values.to_employee_s_number,
        values.reason
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatusMessage('Shift exchange request submitted.');
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
      form.reset({
        ...form.getValues(),
        shift_slot_key: '',
        reason: ''
      });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : 'Unable to submit request.')
  });

  const approveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const result = await approveShiftExchange(requestId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatusMessage('Request approved.');
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : 'Unable to approve request.')
  });

  const denyMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const result = await denyShiftExchange(requestId);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatusMessage('Request denied.');
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : 'Unable to deny request.')
  });

  if (!canView) {
    return <p className="text-sm text-neutral-700">You do not have permission to view shift requests.</p>;
  }

  return (
    <section className="space-y-4">
      <form
        className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-3"
        onSubmit={form.handleSubmit((values) => submitMutation.mutate(values))}
      >
        <label className="text-sm">
          Shift Date
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" type="date" {...form.register('shift_date')} />
        </label>
        <label className="text-sm">
          Shift Period
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            type="number"
            {...form.register('shift_period', { valueAsNumber: true })}
          />
        </label>
        <label className="text-sm">
          Shift Slot Key
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('shift_slot_key')} />
        </label>
        <label className="text-sm">
          From s_number
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('from_employee_s_number')} />
        </label>
        <label className="text-sm">
          To s_number
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('to_employee_s_number')} />
        </label>
        <label className="text-sm md:col-span-2">
          Reason
          <textarea className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2" {...form.register('reason')} />
        </label>
        <div className="flex items-end">
          <button className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white" type="submit">
            Submit Request
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 border border-neutral-300 p-3">
        <label className="text-sm">
          Status filter
          <select
            className="ml-2 min-h-[44px] border border-neutral-300 px-2"
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setPage(0);
            }}
            value={statusFilter}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </label>
      </div>

      {statusMessage && <p className="text-sm text-brand-maroon">{statusMessage}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Requested</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift</th>
              <th className="border-b border-neutral-300 p-2 text-left">From</th>
              <th className="border-b border-neutral-300 p-2 text-left">To</th>
              <th className="border-b border-neutral-300 p-2 text-left">Reason</th>
              <th className="border-b border-neutral-300 p-2 text-left">Status</th>
              <th className="border-b border-neutral-300 p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(requestsQuery.data ?? []).map((request) => (
              <tr className="border-b border-neutral-200" key={request.id as string}>
                <td className="p-2">{new Date(request.requested_at as string).toLocaleString()}</td>
                <td className="p-2">
                  {(request.shift_date as string) +
                    ` P${request.shift_period as number}` +
                    ` (${request.shift_slot_key as string})`}
                </td>
                <td className="p-2">
                  {studentNameBySNumber.get(request.from_employee_s_number as string) ??
                    (request.from_employee_s_number as string)}
                </td>
                <td className="p-2">
                  {studentNameBySNumber.get(request.to_employee_s_number as string) ??
                    (request.to_employee_s_number as string)}
                </td>
                <td className="p-2">{request.reason as string}</td>
                <td className="p-2">{request.status as string}</td>
                <td className="p-2">
                  {canApprove && request.status === 'pending' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                        onClick={() => approveMutation.mutate(request.id as string)}
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                        onClick={() => denyMutation.mutate(request.id as string)}
                        type="button"
                      >
                        Deny
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          className="min-h-[44px] border border-neutral-300 px-3 disabled:opacity-40"
          disabled={page === 0}
          onClick={() => setPage((previous) => Math.max(0, previous - 1))}
          type="button"
        >
          Previous
        </button>
        <button
          className="min-h-[44px] border border-neutral-300 px-3"
          onClick={() => setPage((previous) => previous + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </section>
  );
}
