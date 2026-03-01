'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  approveShiftExchange,
  denyShiftExchange,
  submitShiftExchange
} from '@/app/actions/shift-requests';
import { fetchSchedule } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';

import { getStudentDisplayName, getStudentSNumber, StudentRow, useBrowserSupabase } from './utils';

const ShiftRequestFormSchema = z.object({
  shift_date: z.string().min(10),
  shift_period: z.number().int().min(1).max(8),
  from_employee_s_number: z.string().trim().min(1),
  to_employee_s_number: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500)
});

type ShiftRequestFormValues = z.infer<typeof ShiftRequestFormSchema>;
type StatusFilter = 'all' | 'pending' | 'approved' | 'denied';
type StoredScheduleConfigRow = {
  year: number | null;
  month: number | null;
  anchor_date: string | null;
  anchor_day: 'A' | 'B' | null;
  seed: number | null;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBooleanField(row: StudentRow, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    if (typeof value === 'number') return value !== 0;
  }
  return fallback;
}

export function RequestsTab() {
  const canView = usePermission('hr.requests.view');
  const canApprove = usePermission('hr.schedule.edit');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const form = useForm<ShiftRequestFormValues>({
    resolver: zodResolver(ShiftRequestFormSchema),
    defaultValues: {
      shift_date: new Date().toISOString().slice(0, 10),
      shift_period: 1,
      from_employee_s_number: '',
      to_employee_s_number: '',
      reason: ''
    }
  });

  const selectedShiftDate = form.watch('shift_date');
  const selectedShiftPeriod = form.watch('shift_period');
  const selectedFromSNumber = form.watch('from_employee_s_number');
  const selectedToSNumber = form.watch('to_employee_s_number');

  const studentsQuery = useQuery({
    queryKey: ['hr-requests-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const selectedYearMonth = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedShiftDate ?? '')) return null;
    return {
      year: Number(selectedShiftDate.slice(0, 4)),
      month: Number(selectedShiftDate.slice(5, 7))
    };
  }, [selectedShiftDate]);

  const scheduleConfigQuery = useQuery({
    queryKey: ['hr-requests-schedule-config', selectedYearMonth?.year, selectedYearMonth?.month],
    enabled: Boolean(selectedYearMonth),
    queryFn: async () => {
      if (!selectedYearMonth) return null;
      const { data, error } = await supabase
        .from('schedules')
        .select('year, month, anchor_date, anchor_day, seed')
        .eq('year', selectedYearMonth.year)
        .eq('month', selectedYearMonth.month)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as StoredScheduleConfigRow | null) ?? null;
    }
  });

  const scheduleMonthQuery = useQuery({
    queryKey: [
      'hr-requests-effective-schedule-month',
      selectedYearMonth?.year,
      selectedYearMonth?.month,
      scheduleConfigQuery.data?.anchor_date,
      scheduleConfigQuery.data?.anchor_day,
      scheduleConfigQuery.data?.seed
    ],
    enabled:
      Boolean(selectedYearMonth) &&
      Boolean(scheduleConfigQuery.data?.anchor_date) &&
      Boolean(scheduleConfigQuery.data?.anchor_day) &&
      Number.isFinite(Number(scheduleConfigQuery.data?.seed)),
    queryFn: async () => {
      if (!selectedYearMonth || !scheduleConfigQuery.data) return null;
      const scheduleConfig = scheduleConfigQuery.data;
      const result = await fetchSchedule({
        year: selectedYearMonth.year,
        month: selectedYearMonth.month,
        anchorDate: String(scheduleConfig.anchor_date),
        anchorDay: scheduleConfig.anchor_day === 'B' ? 'B' : 'A',
        seed: Number(scheduleConfig.seed)
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const requestsQuery = useQuery({
    queryKey: ['hr-shift-requests', statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('shift_change_requests')
        .select('*')
        .eq('request_source', 'employee_form')
        .order('requested_at', { ascending: false })
        .limit(500);

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

  const studentEligibilityBySNumber = useMemo(() => {
    const map = new Map<string, { scheduleable: boolean; classPeriod: number | null }>();
    for (const student of studentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(student);
      if (!sNumber) continue;
      map.set(sNumber, {
        scheduleable: readBooleanField(student, ['scheduleable', 'schedulable'], false),
        classPeriod: toNumber(student.Schedule ?? student.schedule ?? student.assigned_periods)
      });
    }
    return map;
  }, [studentsQuery.data]);

  const scheduleAssignmentsForSelection = useMemo(() => {
    const allRows = scheduleMonthQuery.data?.schedule ?? [];
    return allRows.filter(
      (row) =>
        row.date === selectedShiftDate &&
        row.period === selectedShiftPeriod &&
        typeof row.effectiveWorkerSNumber === 'string' &&
        row.effectiveWorkerSNumber.trim() &&
        typeof row.shiftSlotKey === 'string' &&
        row.shiftSlotKey.trim()
    );
  }, [scheduleMonthQuery.data, selectedShiftDate, selectedShiftPeriod]);

  const selectedDayType = useMemo(
    () => scheduleMonthQuery.data?.calendar?.[selectedShiftDate] ?? null,
    [scheduleMonthQuery.data, selectedShiftDate]
  );

  const allowedShiftPeriods = useMemo(() => {
    if (selectedDayType === 'A') return [1, 2, 3, 4];
    if (selectedDayType === 'B') return [5, 6, 7, 8];
    return [1, 2, 3, 4, 5, 6, 7, 8];
  }, [selectedDayType]);

  const currentWorkers = useMemo(() => {
    const workers = new Set<string>();
    for (const row of scheduleAssignmentsForSelection) {
      workers.add(String(row.effectiveWorkerSNumber));
    }
    return Array.from(workers);
  }, [scheduleAssignmentsForSelection]);

  const fromOptions = useMemo(() => {
    const options = currentWorkers.map((sNumber) => ({
      value: sNumber,
      label: `${studentNameBySNumber.get(sNumber) ?? sNumber} (${sNumber})`
    }));
    options.sort((left, right) => left.label.localeCompare(right.label));
    return options;
  }, [currentWorkers, studentNameBySNumber]);

  const eligibleToOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [];
    const acceptableClassPeriods = new Set<number>([selectedShiftPeriod]);
    if (selectedShiftPeriod >= 1 && selectedShiftPeriod <= 4) {
      acceptableClassPeriods.add(selectedShiftPeriod + 4);
    }
    if (selectedShiftPeriod >= 5 && selectedShiftPeriod <= 8) {
      acceptableClassPeriods.add(selectedShiftPeriod - 4);
    }

    const canWorkSelectedPeriod = (sNumber: string): boolean => {
      const eligibility = studentEligibilityBySNumber.get(sNumber);
      if (!eligibility || !eligibility.scheduleable) return false;
      if (eligibility.classPeriod === null) return false;
      return acceptableClassPeriods.has(eligibility.classPeriod);
    };

    for (const student of studentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(student);
      if (!sNumber || sNumber === selectedFromSNumber) continue;
      if (!canWorkSelectedPeriod(sNumber)) continue;

      options.push({
        value: sNumber,
        label: `${studentNameBySNumber.get(sNumber) ?? sNumber} (${sNumber})`
      });
    }

    options.sort((left, right) => left.label.localeCompare(right.label));
    return options;
  }, [
    selectedFromSNumber,
    selectedShiftPeriod,
    studentEligibilityBySNumber,
    studentNameBySNumber,
    studentsQuery.data
  ]);

  useEffect(() => {
    if (allowedShiftPeriods.length === 0) return;
    if (allowedShiftPeriods.includes(selectedShiftPeriod)) return;
    form.setValue('shift_period', allowedShiftPeriods[0], {
      shouldDirty: true,
      shouldValidate: true
    });
  }, [allowedShiftPeriods, form, selectedShiftPeriod]);

  useEffect(() => {
    const values = new Set(fromOptions.map((option) => option.value));
    if (fromOptions.length === 0) {
      if (selectedFromSNumber) {
        form.setValue('from_employee_s_number', '', { shouldDirty: true, shouldValidate: true });
      }
      return;
    }
    if (!selectedFromSNumber || !values.has(selectedFromSNumber)) {
      form.setValue('from_employee_s_number', fromOptions[0].value, {
        shouldDirty: true,
        shouldValidate: true
      });
    }
  }, [form, fromOptions, selectedFromSNumber]);

  useEffect(() => {
    const values = new Set(eligibleToOptions.map((option) => option.value));
    if (eligibleToOptions.length === 0) {
      if (selectedToSNumber) {
        form.setValue('to_employee_s_number', '', { shouldDirty: true, shouldValidate: true });
      }
      return;
    }
    if (!selectedToSNumber || !values.has(selectedToSNumber)) {
      form.setValue('to_employee_s_number', eligibleToOptions[0].value, {
        shouldDirty: true,
        shouldValidate: true
      });
    }
  }, [eligibleToOptions, form, selectedToSNumber]);

  const resolvedShiftSlotKey = useMemo(() => {
    if (!selectedFromSNumber) return null;
    const slot = scheduleAssignmentsForSelection.find(
      (row) => String(row.effectiveWorkerSNumber) === selectedFromSNumber
    );
    return slot ? String(slot.shiftSlotKey) : null;
  }, [scheduleAssignmentsForSelection, selectedFromSNumber]);

  const submitMutation = useMutation({
    mutationFn: async (input: { values: ShiftRequestFormValues; shiftSlotKey: string }) => {
      const { values, shiftSlotKey } = input;
      const result = await submitShiftExchange(
        values.shift_date,
        values.shift_period,
        shiftSlotKey,
        values.from_employee_s_number,
        values.to_employee_s_number,
        values.reason,
        'employee_form'
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () => {
      setStatusMessage('Shift exchange request submitted.');
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
      form.reset({
        ...form.getValues(),
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
      setStatusMessage('Request approved. Schedule updated.');
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-table-index'] });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-shift-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance-request-log'] });
      queryClient.invalidateQueries({ queryKey: ['hr-requests-effective-schedule-month'] });
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
        onSubmit={form.handleSubmit((values) => {
          const eligibleTargets = new Set(eligibleToOptions.map((option) => option.value));
          if (!eligibleTargets.has(values.to_employee_s_number)) {
            setStatusMessage('Selected replacement employee is not eligible for this period.');
            return;
          }
          if (!resolvedShiftSlotKey) {
            setStatusMessage(
              'Unable to find a shift slot for the selected date, period, and from employee.'
            );
            return;
          }
          submitMutation.mutate({ values, shiftSlotKey: resolvedShiftSlotKey });
        })}
      >
        <label className="text-sm">
          Shift Date
          <input className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" type="date" {...form.register('shift_date')} />
        </label>
        <label className="text-sm">
          Shift Period
          <select
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            {...form.register('shift_period', { valueAsNumber: true })}
          >
            {allowedShiftPeriods.map((period) => (
              <option key={period} value={period}>
                Period {period}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-600">
            {selectedDayType === 'A'
              ? 'A-day selected: period options are 1-4.'
              : selectedDayType === 'B'
                ? 'B-day selected: period options are 5-8.'
                : 'A/B day not found for this date; showing periods 1-8.'}
          </p>
        </label>
        <label className="text-sm">
          From s_number
          <select
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            disabled={fromOptions.length === 0}
            {...form.register('from_employee_s_number')}
          >
            {fromOptions.length === 0 ? (
              <option value="">No workers expected in this slot</option>
            ) : (
              fromOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm">
          To s_number (eligible)
          <select
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            disabled={eligibleToOptions.length === 0}
            {...form.register('to_employee_s_number')}
          >
            {eligibleToOptions.length === 0 ? (
              <option value="">No eligible employees for this period</option>
            ) : (
              eligibleToOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm md:col-span-2">
          Reason
          <textarea className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2" {...form.register('reason')} />
        </label>
        <p className="text-xs text-neutral-600 md:col-span-3">
          Shift slot key is resolved automatically from the selected date, period, and from employee.
          {resolvedShiftSlotKey ? ` Slot: ${resolvedShiftSlotKey}` : ' Slot: not found yet.'}
        </p>
        <div className="flex items-end">
          <button
            className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white disabled:opacity-40"
            disabled={
              submitMutation.isPending ||
              fromOptions.length === 0 ||
              eligibleToOptions.length === 0 ||
              !resolvedShiftSlotKey
            }
            type="submit"
          >
            Submit Request
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2 border border-neutral-300 p-3">
        <label className="text-sm">
          Status filter
          <select
            className="ml-2 min-h-[44px] border border-neutral-300 px-2"
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
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

    </section>
  );
}
