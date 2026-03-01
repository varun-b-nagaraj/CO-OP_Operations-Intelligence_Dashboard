'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { calculateShiftAttendanceRate, summarizeShiftAttendanceCounts } from '@/lib/server/attendance';
import { usePermission } from '@/lib/permissions';
import { AttendanceOverride } from '@/lib/types';

import {
  formatRate,
  getStudentDisplayName,
  getStudentSNumber,
  StudentRow,
  useBrowserSupabase
} from './utils';

export function ShiftAttendanceTab(props: { dateRange: { from: string; to: string } }) {
  const canView = usePermission('hr.attendance.view');
  const canOverride = usePermission('hr.attendance.override');
  const supabase = useBrowserSupabase();
  const [employeeSNumber, setEmployeeSNumber] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const range = props.dateRange;

  const attendanceQuery = useQuery({
    queryKey: ['hr-shift-attendance', range, employeeSNumber, periodFilter, canOverride],
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
      return (data ?? []) as Array<Record<string, unknown>>;
    }
  });

  const shiftOverridesQuery = useQuery({
    queryKey: ['hr-shift-attendance-overrides', range, employeeSNumber, periodFilter],
    queryFn: async () => {
      let query = supabase
        .from('attendance_overrides')
        .select('*')
        .eq('scope', 'shift')
        .gte('checkin_date', range.from)
        .lte('checkin_date', range.to);

      if (employeeSNumber.trim()) query = query.eq('s_number', employeeSNumber.trim());
      if (periodFilter.trim()) query = query.eq('shift_period', Number(periodFilter));

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<Record<string, unknown>>;
    }
  });

  const requestLogQuery = useQuery({
    queryKey: ['hr-shift-attendance-request-log', range, employeeSNumber, periodFilter],
    queryFn: async () => {
      let query = supabase
        .from('shift_change_requests')
        .select('*')
        .eq('request_source', 'employee_form')
        .eq('status', 'approved')
        .gte('shift_date', range.from)
        .lte('shift_date', range.to)
        .order('requested_at', { ascending: false })
        .limit(500);

      if (employeeSNumber.trim()) {
        const sNumber = employeeSNumber.trim();
        query = query.or(`from_employee_s_number.eq.${sNumber},to_employee_s_number.eq.${sNumber}`);
      }
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

  const byEmployee = useMemo(() => {
    const shiftOverridesBySNumber = new Map<string, AttendanceOverride[]>();
    for (const row of shiftOverridesQuery.data ?? []) {
      const sNumber = String(row.s_number ?? '');
      if (!sNumber) continue;
      const bucket = shiftOverridesBySNumber.get(sNumber) ?? [];
      bucket.push(row as unknown as AttendanceOverride);
      shiftOverridesBySNumber.set(sNumber, bucket);
    }

    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const row of attendanceQuery.data ?? []) {
      const key = row.employee_s_number as string;
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()].map(([sNumber, rows]) => {
      const overrides = shiftOverridesBySNumber.get(sNumber) ?? [];
      const counts = summarizeShiftAttendanceCounts({
        shiftAttendanceRecords: rows.map((row) => ({
          status: row.status as 'expected' | 'present' | 'absent' | 'excused',
          date: String(row.shift_date ?? ''),
          shiftPeriod: Number(row.shift_period ?? -1)
        })),
        throughTodayOnly: false,
        overrides
      });
      const rates = calculateShiftAttendanceRate({
        shiftAttendanceRecords: rows.map((row) => ({
          status: row.status as 'expected' | 'present' | 'absent' | 'excused',
          rawStatus: (row.raw_status as 'expected' | 'present' | 'absent' | 'excused' | null) ?? null,
          date: String(row.shift_date ?? ''),
          shiftPeriod: Number(row.shift_period ?? -1)
        })),
        overrides
      });
      const student = (studentsQuery.data ?? []).find((item) => getStudentSNumber(item) === sNumber);
      return {
        sNumber,
        name: student ? getStudentDisplayName(student) : sNumber,
        expected: counts.expected,
        present: counts.present,
        absent: counts.absent,
        excused: counts.excused,
        shiftRate: rates.adjusted_rate ?? rates.raw_rate
      };
    });
  }, [attendanceQuery.data, shiftOverridesQuery.data, studentsQuery.data]);

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

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">Expected</th>
              <th className="border-b border-neutral-300 p-2 text-left">Present</th>
              <th className="border-b border-neutral-300 p-2 text-left">Absent</th>
              <th className="border-b border-neutral-300 p-2 text-left">Excused</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift</th>
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
                <td className="p-2">{formatRate(employee.shiftRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto border border-neutral-300">
        <div className="border-b border-neutral-300 bg-neutral-50 p-2">
          <h3 className="text-sm font-semibold text-neutral-900">Applied Shift Exchanges</h3>
          <p className="text-xs text-neutral-600">
            Shows employee-form exchanges that were approved and applied to shift ownership.
          </p>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Requested</th>
              <th className="border-b border-neutral-300 p-2 text-left">Approved</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift</th>
              <th className="border-b border-neutral-300 p-2 text-left">From</th>
              <th className="border-b border-neutral-300 p-2 text-left">To</th>
              <th className="border-b border-neutral-300 p-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(requestLogQuery.data ?? []).length === 0 && (
              <tr>
                <td className="p-2 text-neutral-600" colSpan={6}>
                  No approved employee-form shift exchanges in this range.
                </td>
              </tr>
            )}
            {(requestLogQuery.data ?? []).map((request) => {
              const fromSNumber = String(request.from_employee_s_number ?? '');
              const toSNumber = String(request.to_employee_s_number ?? '');
              const fromName =
                (studentsQuery.data ?? []).find((item) => getStudentSNumber(item) === fromSNumber) ??
                null;
              const toName =
                (studentsQuery.data ?? []).find((item) => getStudentSNumber(item) === toSNumber) ??
                null;

              return (
                <tr className="border-b border-neutral-200" key={String(request.id)}>
                  <td className="p-2">{new Date(String(request.requested_at ?? '')).toLocaleString()}</td>
                  <td className="p-2">
                    {request.reviewed_at ? new Date(String(request.reviewed_at)).toLocaleString() : 'Approved'}
                  </td>
                  <td className="p-2">
                    {String(request.shift_date ?? '')} P{String(request.shift_period ?? '')} (
                    {String(request.shift_slot_key ?? '')})
                  </td>
                  <td className="p-2">
                    {fromName ? getStudentDisplayName(fromName) : fromSNumber || 'N/A'}
                  </td>
                  <td className="p-2">
                    {toName ? getStudentDisplayName(toName) : toSNumber || 'N/A'}
                  </td>
                  <td className="p-2">{String(request.reason ?? '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
