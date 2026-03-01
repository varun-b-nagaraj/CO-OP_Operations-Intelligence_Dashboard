'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { usePermission } from '@/lib/permissions';

import {
  formatRate,
  getStudentDisplayName,
  getStudentSNumber,
  StudentRow,
  useBrowserSupabase
} from './utils';

export function ShiftAttendanceTab(props: { dateRange: { from: string; to: string } }) {
  const canView = usePermission('hr.attendance.view');
  const supabase = useBrowserSupabase();
  const [employeeSNumber, setEmployeeSNumber] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const range = props.dateRange;

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

  const byEmployee = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const row of attendanceQuery.data ?? []) {
      const key = row.employee_s_number as string;
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return [...map.entries()].map(([sNumber, rows]) => {
      const rates = calculateShiftAttendanceRate({
        shiftAttendanceRecords: rows.map((row) => ({
          status: row.status as 'expected' | 'present' | 'absent' | 'excused',
          rawStatus: (row.raw_status as 'expected' | 'present' | 'absent' | 'excused' | null) ?? null,
          date: String(row.shift_date ?? '')
        }))
      });
      const student = (studentsQuery.data ?? []).find((item) => getStudentSNumber(item) === sNumber);
      return {
        sNumber,
        name: student ? getStudentDisplayName(student) : sNumber,
        expected: rates.expected_shifts,
        present: rows.filter((row) => row.status === 'present').length,
        absent: rows.filter((row) => row.status === 'absent').length,
        excused: rows.filter((row) => row.status === 'excused').length,
        shiftRate: rates.adjusted_rate ?? rates.raw_rate
      };
    });
  }, [attendanceQuery.data, studentsQuery.data]);

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
    </section>
  );
}
