'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { fetchMeetingAttendance } from '@/lib/api-client';
import { calculateMeetingAttendanceRate, calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { AttendanceOverride } from '@/lib/types';

import { currentMonthRange, formatRate, useBrowserSupabase } from './utils';

type StudentRow = {
  id: string;
  name?: string;
  full_name?: string;
  s_number?: string;
  username?: string;
  assigned_periods?: string;
  Schedule?: number;
};

export function EmployeesTab() {
  const supabase = useBrowserSupabase();
  const [range, setRange] = useState(currentMonthRange());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const studentsQuery = useQuery({
    queryKey: ['hr-students'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const strikesQuery = useQuery({
    queryKey: ['hr-strikes-active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('strikes').select('*').eq('active', true);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const shiftAttendanceQuery = useQuery({
    queryKey: ['hr-shift-attendance-for-employees', range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_attendance')
        .select('*')
        .gte('shift_date', range.from)
        .lte('shift_date', range.to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const pointsQuery = useQuery({
    queryKey: ['hr-points-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('points_ledger').select('*');
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['hr-settings-employee-overview'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_settings').select('*');
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const overridesQuery = useQuery({
    queryKey: ['hr-meeting-overrides', range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_overrides')
        .select('*')
        .eq('scope', 'meeting')
        .gte('checkin_date', range.from)
        .lte('checkin_date', range.to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const meetingAttendanceQuery = useQuery({
    queryKey: ['hr-meeting-data-for-employees', range],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const result = await fetchMeetingAttendance({ from: range.from, to: range.to });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const metrics = useMemo(() => {
    const strikesByEmployee = new Map<string, number>();
    for (const row of strikesQuery.data ?? []) {
      const current = strikesByEmployee.get(row.employee_id as string) ?? 0;
      strikesByEmployee.set(row.employee_id as string, current + 1);
    }

    const settingsBySNumber = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      settingsBySNumber.set(row.employee_s_number as string, (row.off_periods as number[]) ?? [4, 8]);
    }

    const shiftBySNumber = new Map<string, Array<Record<string, unknown>>>();
    for (const row of shiftAttendanceQuery.data ?? []) {
      const key = row.employee_s_number as string;
      const bucket = shiftBySNumber.get(key) ?? [];
      bucket.push(row);
      shiftBySNumber.set(key, bucket);
    }

    const pointsByEmployee = new Map<string, number>();
    for (const row of pointsQuery.data ?? []) {
      const current = pointsByEmployee.get(row.employee_id as string) ?? 0;
      pointsByEmployee.set(row.employee_id as string, current + Number(row.points ?? 0));
    }

    const overridesBySNumber = new Map<string, Array<Record<string, unknown>>>();
    for (const row of overridesQuery.data ?? []) {
      const key = row.s_number as string;
      const bucket = overridesBySNumber.get(key) ?? [];
      bucket.push(row);
      overridesBySNumber.set(key, bucket);
    }

    return (studentsQuery.data ?? []).map((student) => {
      const sNumber = student.s_number ?? '';
      const shifts = shiftBySNumber.get(sNumber) ?? [];
      const offPeriods = settingsBySNumber.get(sNumber) ?? [4, 8];
      const shiftRates = calculateShiftAttendanceRate({
        shiftAttendanceRecords: shifts.map((item) => ({
          status: item.status as 'expected' | 'present' | 'absent' | 'excused'
        }))
      });

      const attendanceRecords =
        meetingAttendanceQuery.data?.records.filter((record) => record.s_number === sNumber) ?? [];
      const meetingRates = calculateMeetingAttendanceRate({
        attendanceRecords,
        overrides: (overridesBySNumber.get(sNumber) ?? []) as unknown as AttendanceOverride[]
      });

      return {
        id: student.id,
        name: student.name ?? student.full_name ?? 'Unknown',
        sNumber,
        username: student.username ?? null,
        assignedPeriods: student.assigned_periods ?? String(student.Schedule ?? ''),
        offPeriods,
        strikesCount: strikesByEmployee.get(student.id) ?? 0,
        totalShifts: shifts.length,
        morningShifts: shifts.filter((item) => item.shift_period === 0 && item.status === 'present').length,
        offPeriodShifts: shifts.filter(
          (item) => offPeriods.includes(item.shift_period as number) && item.status === 'present'
        ).length,
        shiftRawRate: shiftRates.raw_rate,
        shiftAdjustedRate: shiftRates.adjusted_rate,
        meetingRawRate: meetingRates.raw_rate,
        meetingAdjustedRate: meetingRates.adjusted_rate,
        points: pointsByEmployee.get(student.id) ?? 0
      };
    });
  }, [
    meetingAttendanceQuery.data?.records,
    overridesQuery.data,
    pointsQuery.data,
    settingsQuery.data,
    shiftAttendanceQuery.data,
    strikesQuery.data,
    studentsQuery.data
  ]);

  const selectedEmployee = metrics.find((employee) => employee.id === selectedId) ?? null;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-4">
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
      </div>

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">Strikes</th>
              <th className="border-b border-neutral-300 p-2 text-left">Meeting (Raw/Adj)</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift (Raw/Adj)</th>
              <th className="border-b border-neutral-300 p-2 text-left">Total Shifts</th>
              <th className="border-b border-neutral-300 p-2 text-left">Morning</th>
              <th className="border-b border-neutral-300 p-2 text-left">Off-period</th>
              <th className="border-b border-neutral-300 p-2 text-left">Points</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((employee) => (
              <tr
                className={`cursor-pointer border-b border-neutral-200 ${selectedId === employee.id ? 'bg-neutral-100' : ''}`}
                key={employee.id}
                onClick={() => setSelectedId(employee.id)}
              >
                <td className="p-2">{employee.name}</td>
                <td className="p-2">{employee.strikesCount}</td>
                <td className="p-2">
                  {formatRate(employee.meetingRawRate)} / {formatRate(employee.meetingAdjustedRate)}
                </td>
                <td className="p-2">
                  {formatRate(employee.shiftRawRate)} / {formatRate(employee.shiftAdjustedRate)}
                </td>
                <td className="p-2">{employee.totalShifts}</td>
                <td className="p-2">{employee.morningShifts}</td>
                <td className="p-2">{employee.offPeriodShifts}</td>
                <td className="p-2">{employee.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedEmployee && (
        <div className="border border-neutral-300 p-3">
          <h3 className="text-base font-semibold">{selectedEmployee.name}</h3>
          <p className="text-sm text-neutral-700">s_number: {selectedEmployee.sNumber}</p>
          <p className="text-sm text-neutral-700">username: {selectedEmployee.username ?? 'N/A'}</p>
          <p className="text-sm text-neutral-700">
            assigned periods: {selectedEmployee.assignedPeriods || 'N/A'}
          </p>
          <p className="text-sm text-neutral-700">
            off periods: {selectedEmployee.offPeriods.join(', ') || '4, 8'}
          </p>
        </div>
      )}
    </section>
  );
}
