'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { excuseShiftAbsence, markShiftAbsent, markShiftPresent } from '@/app/actions/shift-attendance';
import { calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { usePermission } from '@/lib/permissions';

import {
  currentMonthRange,
  formatRate,
  getStudentDisplayName,
  getStudentSNumber,
  getTodayDateKey,
  isDateTodayOrPast,
  StudentRow,
  useBrowserSupabase
} from './utils';

export function ShiftAttendanceTab() {
  const canView = usePermission('hr.attendance.view');
  const canOverride = usePermission('hr.attendance.override');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const [range, setRange] = useState(currentMonthRange());
  const [employeeSNumber, setEmployeeSNumber] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const attendanceQuery = useQuery({
    queryKey: ['hr-shift-attendance', range, employeeSNumber, periodFilter],
    queryFn: async () => {
      let query = supabase
        .from('shift_attendance')
        .select('*')
        .gte('shift_date', range.from)
        .lte('shift_date', range.to)
        .order('shift_date', { ascending: false })
        .order('shift_period', { ascending: true });

      if (employeeSNumber.trim()) query = query.eq('employee_s_number', employeeSNumber.trim());
      if (periodFilter.trim()) query = query.eq('shift_period', Number(periodFilter));

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const studentsQuery = useQuery({
    queryKey: ['hr-shift-attendance-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const mutationBase = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance'] });
      setStatusMessage('Shift attendance updated.');
    },
    onError: (error: unknown) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to update shift attendance.');
    }
  };

  const presentMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; period: number; shiftSlotKey: string }) => {
      const result = await markShiftPresent(payload.sNumber, payload.date, payload.period, payload.shiftSlotKey);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationBase
  });

  const absentMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; period: number; shiftSlotKey: string }) => {
      const result = await markShiftAbsent(payload.sNumber, payload.date, payload.period, payload.shiftSlotKey);
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationBase
  });

  const excuseMutation = useMutation({
    mutationFn: async (payload: {
      sNumber: string;
      date: string;
      period: number;
      shiftSlotKey: string;
      reason: string;
    }) => {
      const result = await excuseShiftAbsence(
        payload.sNumber,
        payload.date,
        payload.period,
        payload.shiftSlotKey,
        payload.reason
      );
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    ...mutationBase
  });

  const byEmployee = useMemo(() => {
    const todayKey = getTodayDateKey();
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const row of attendanceQuery.data ?? []) {
      const key = row.employee_s_number as string;
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()].map(([sNumber, rows]) => {
      const eligibleRows = rows.filter((row) => isDateTodayOrPast(String(row.shift_date ?? ''), todayKey));
      const rates = calculateShiftAttendanceRate({
        shiftAttendanceRecords: rows.map((row) => ({
          status: row.status as 'expected' | 'present' | 'absent' | 'excused',
          date: String(row.shift_date ?? '')
        }))
      });
      const student = (studentsQuery.data ?? []).find((item) => getStudentSNumber(item) === sNumber);
      return {
        sNumber,
        name: student ? getStudentDisplayName(student) : sNumber,
        expected: rates.expected_shifts,
        present: eligibleRows.filter((row) => row.status === 'present').length,
        absent: eligibleRows.filter((row) => row.status === 'absent').length,
        excused: eligibleRows.filter((row) => row.status === 'excused').length,
        raw: rates.raw_rate,
        adjusted: rates.adjusted_rate
      };
    });
  }, [attendanceQuery.data, studentsQuery.data]);

  const todayKey = getTodayDateKey();

  if (!canView) {
    return <p className="text-sm text-neutral-700">You do not have permission to view shift attendance.</p>;
  }

  return (
    <section className="space-y-4">
      <p className="text-xs text-neutral-600">
        Shift attendance (periods 0-8) is tracked independently from meeting attendance.
      </p>

      <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-5">
        <label className="text-sm">
          From
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) => setRange((previous) => ({ ...previous, from: event.target.value }))}
            type="date"
            value={range.from}
          />
        </label>
        <label className="text-sm">
          To
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) => setRange((previous) => ({ ...previous, to: event.target.value }))}
            type="date"
            value={range.to}
          />
        </label>
        <label className="text-sm">
          Employee s_number
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            onChange={(event) => setEmployeeSNumber(event.target.value)}
            placeholder="optional"
            value={employeeSNumber}
          />
        </label>
        <label className="text-sm">
          Period
          <input
            className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
            max={8}
            min={0}
            onChange={(event) => setPeriodFilter(event.target.value)}
            placeholder="0-8"
            type="number"
            value={periodFilter}
          />
        </label>
      </div>

      {statusMessage && <p className="text-sm text-brand-maroon">{statusMessage}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">Expected</th>
              <th className="border-b border-neutral-300 p-2 text-left">Present</th>
              <th className="border-b border-neutral-300 p-2 text-left">Absent</th>
              <th className="border-b border-neutral-300 p-2 text-left">Excused</th>
              <th className="border-b border-neutral-300 p-2 text-left">Raw</th>
              <th className="border-b border-neutral-300 p-2 text-left">Adjusted</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map((employee) => (
              <tr className="border-b border-neutral-200" key={employee.sNumber}>
                <td className="p-2">{employee.name}</td>
                <td className="p-2">{employee.expected}</td>
                <td className="p-2">{employee.present}</td>
                <td className="p-2">{employee.absent}</td>
                <td className="p-2">{employee.excused}</td>
                <td className="p-2">{formatRate(employee.raw)}</td>
                <td className="p-2">{formatRate(employee.adjusted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Date</th>
              <th className="border-b border-neutral-300 p-2 text-left">Period</th>
              <th className="border-b border-neutral-300 p-2 text-left">Slot</th>
              <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
              <th className="border-b border-neutral-300 p-2 text-left">Status</th>
              <th className="border-b border-neutral-300 p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(attendanceQuery.data ?? []).slice(0, 300).map((row) => {
              const isFutureShift = !isDateTodayOrPast(String(row.shift_date ?? ''), todayKey);
              return (
                <tr className="border-b border-neutral-200" key={row.id as string}>
                  <td className="p-2">{row.shift_date as string}</td>
                  <td className="p-2">{row.shift_period as number}</td>
                  <td className="p-2">{row.shift_slot_key as string}</td>
                  <td className="p-2">{row.employee_s_number as string}</td>
                  <td className="p-2">{row.status as string}</td>
                  <td className="p-2">
                    {canOverride && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                          disabled={isFutureShift}
                          onClick={() =>
                            presentMutation.mutate({
                              sNumber: row.employee_s_number as string,
                              date: row.shift_date as string,
                              period: row.shift_period as number,
                              shiftSlotKey: row.shift_slot_key as string
                            })
                          }
                          type="button"
                        >
                          Present
                        </button>
                        <button
                          className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                          onClick={() =>
                            absentMutation.mutate({
                              sNumber: row.employee_s_number as string,
                              date: row.shift_date as string,
                              period: row.shift_period as number,
                              shiftSlotKey: row.shift_slot_key as string
                            })
                          }
                          type="button"
                        >
                          Absent
                        </button>
                        <button
                          className="min-h-[44px] border border-neutral-500 px-2 text-xs"
                          disabled={isFutureShift}
                          onClick={() => {
                            const reason = window.prompt('Reason for excused absence') ?? '';
                            if (!reason.trim()) return;
                            excuseMutation.mutate({
                              sNumber: row.employee_s_number as string,
                              date: row.shift_date as string,
                              period: row.shift_period as number,
                              shiftSlotKey: row.shift_slot_key as string,
                              reason
                            });
                          }}
                          type="button"
                        >
                          Excuse
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
