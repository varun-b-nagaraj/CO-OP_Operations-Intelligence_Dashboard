'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';

import { addStrike, removeStrike } from '@/app/actions/strikes';
import { updateEmployeeOffPeriods } from '@/app/actions/employee-settings';
import { fetchMeetingAttendance } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';
import { calculateMeetingAttendanceRate, calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { AttendanceOverride } from '@/lib/types';

import {
  currentMonthRange,
  formatRate,
  getStudentDisplayName,
  getStudentId,
  getStudentSNumber,
  StudentRow,
  useBrowserSupabase
} from './utils';

type GenericRow = {
  [key: string]: unknown;
};

interface EmployeeMetric {
  id: string;
  name: string;
  sNumber: string;
  username: string | null;
  assignedPeriods: string;
  offPeriods: number[];
  strikesCount: number;
  totalShifts: number;
  morningShifts: number;
  offPeriodShifts: number;
  shiftPresent: number;
  shiftAbsent: number;
  shiftExcused: number;
  shiftRawRate: number | null;
  shiftAdjustedRate: number | null;
  meetingSessions: number;
  meetingAttended: number;
  meetingExcused: number;
  meetingRawRate: number | null;
  meetingAdjustedRate: number | null;
  points: number;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function EmployeesTab() {
  const canViewAttendance = usePermission('hr.attendance.view');
  const canEditSettings = usePermission('hr.settings.edit');
  const canManageStrikes = usePermission('hr.strikes.manage');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const [range, setRange] = useState(currentMonthRange());
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const [offPeriodDrafts, setOffPeriodDrafts] = useState<Record<string, number[]>>({});
  const [strikeReasonDrafts, setStrikeReasonDrafts] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
      return (data ?? []) as GenericRow[];
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
      return (data ?? []) as GenericRow[];
    }
  });

  const pointsQuery = useQuery({
    queryKey: ['hr-points-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('points_ledger').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as GenericRow[];
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['hr-settings-employee-overview'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_settings').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as GenericRow[];
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
      return (data ?? []) as GenericRow[];
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

  const saveOffPeriodsMutation = useMutation({
    mutationFn: async (payload: { employeeId: string; offPeriods: number[] }) => {
      const result = await updateEmployeeOffPeriods(payload.employeeId, payload.offPeriods);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['hr-settings-employee-overview'] });
      setStatusMessage(`Saved off-periods for employee ${payload.employeeId}.`);
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to save off-period settings.');
    }
  });

  const addStrikeMutation = useMutation({
    mutationFn: async (payload: { employeeId: string; reason: string }) => {
      const result = await addStrike(payload.employeeId, payload.reason);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['hr-strikes-active'] });
      setStrikeReasonDrafts((previous) => ({ ...previous, [payload.employeeId]: '' }));
      setStatusMessage(`Added strike for employee ${payload.employeeId}.`);
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to add strike.');
    }
  });

  const removeStrikeMutation = useMutation({
    mutationFn: async (strikeId: string) => {
      const result = await removeStrike(strikeId);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-strikes-active'] });
      setStatusMessage('Strike removed.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to remove strike.');
    }
  });

  const derived = useMemo(() => {
    const strikesByEmployee = new Map<string, GenericRow[]>();
    for (const row of strikesQuery.data ?? []) {
      const employeeId = String(row.employee_id ?? '');
      if (!employeeId) continue;
      const bucket = strikesByEmployee.get(employeeId) ?? [];
      bucket.push(row);
      strikesByEmployee.set(employeeId, bucket);
    }

    const settingsByEmployeeId = new Map<string, number[]>();
    const settingsBySNumber = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      const employeeId = String(row.employee_id ?? '');
      const employeeSNumber = String(row.employee_s_number ?? '');
      const offPeriods =
        Array.isArray(row.off_periods) && row.off_periods.length > 0
          ? row.off_periods.map((value) => toNumber(value)).filter((value) => value >= 1 && value <= 8)
          : [4, 8];
      if (employeeId) settingsByEmployeeId.set(employeeId, offPeriods);
      if (employeeSNumber) settingsBySNumber.set(employeeSNumber, offPeriods);
    }

    const shiftBySNumber = new Map<string, GenericRow[]>();
    for (const row of shiftAttendanceQuery.data ?? []) {
      const key = String(row.employee_s_number ?? '');
      if (!key) continue;
      const bucket = shiftBySNumber.get(key) ?? [];
      bucket.push(row);
      shiftBySNumber.set(key, bucket);
    }

    const pointsByEmployee = new Map<string, number>();
    for (const row of pointsQuery.data ?? []) {
      const employeeId = String(row.employee_id ?? '');
      if (!employeeId) continue;
      const current = pointsByEmployee.get(employeeId) ?? 0;
      pointsByEmployee.set(employeeId, current + toNumber(row.points));
    }

    const overridesBySNumber = new Map<string, GenericRow[]>();
    for (const row of overridesQuery.data ?? []) {
      const key = String(row.s_number ?? '');
      if (!key) continue;
      const bucket = overridesBySNumber.get(key) ?? [];
      bucket.push(row);
      overridesBySNumber.set(key, bucket);
    }

    const metrics: EmployeeMetric[] = (studentsQuery.data ?? []).map((student) => {
      const id = getStudentId(student);
      const sNumber = getStudentSNumber(student);
      const shifts = shiftBySNumber.get(sNumber) ?? [];
      const offPeriods = settingsByEmployeeId.get(id) ?? settingsBySNumber.get(sNumber) ?? [4, 8];
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

      const shiftPresent = shifts.filter((item) => item.status === 'present').length;
      const shiftAbsent = shifts.filter((item) => item.status === 'absent').length;
      const shiftExcused = shifts.filter((item) => item.status === 'excused').length;
      const morningShifts = shifts.filter(
        (item) => toNumber(item.shift_period) === 0 && item.status === 'present'
      ).length;
      const offPeriodShifts = shifts.filter(
        (item) => offPeriods.includes(toNumber(item.shift_period)) && item.status === 'present'
      ).length;

      return {
        id,
        name: getStudentDisplayName(student),
        sNumber,
        username: (student.username as string | undefined) ?? null,
        assignedPeriods:
          ((student.assigned_periods as string | undefined) ?? String(student.Schedule ?? '')).trim(),
        offPeriods,
        strikesCount: (strikesByEmployee.get(id) ?? []).length,
        totalShifts: shifts.length,
        morningShifts,
        offPeriodShifts,
        shiftPresent,
        shiftAbsent,
        shiftExcused,
        shiftRawRate: shiftRates.raw_rate,
        shiftAdjustedRate: shiftRates.adjusted_rate,
        meetingSessions: meetingRates.total_sessions,
        meetingAttended: meetingRates.attended,
        meetingExcused: meetingRates.excused,
        meetingRawRate: meetingRates.raw_rate,
        meetingAdjustedRate: meetingRates.adjusted_rate,
        points: pointsByEmployee.get(id) ?? 0
      };
    });

    metrics.sort((left, right) => left.name.localeCompare(right.name));

    return {
      metrics,
      strikesByEmployee
    };
  }, [
    meetingAttendanceQuery.data?.records,
    overridesQuery.data,
    pointsQuery.data,
    settingsQuery.data,
    shiftAttendanceQuery.data,
    strikesQuery.data,
    studentsQuery.data
  ]);

  const toggleEmployeeExpansion = (employeeId: string, defaultOffPeriods: number[]) => {
    setExpandedEmployeeId((previous) => (previous === employeeId ? null : employeeId));
    setOffPeriodDrafts((previous) => {
      if (previous[employeeId]) return previous;
      return { ...previous, [employeeId]: defaultOffPeriods };
    });
  };

  const toggleOffPeriodDraft = (employeeId: string, period: number, defaultOffPeriods: number[]) => {
    setOffPeriodDrafts((previous) => {
      const current = previous[employeeId] ?? defaultOffPeriods;
      const next = current.includes(period)
        ? current.filter((value) => value !== period)
        : [...current, period].sort((left, right) => left - right);
      return { ...previous, [employeeId]: next };
    });
  };

  if (!canViewAttendance && !canEditSettings && !canManageStrikes) {
    return <p className="text-sm text-neutral-700">You do not have permission to view employee management.</p>;
  }

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

      {statusMessage && <p className="text-sm text-brand-maroon">{statusMessage}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
              <th className="border-b border-neutral-300 p-2 text-left">Strikes</th>
              <th className="border-b border-neutral-300 p-2 text-left">Meeting (Raw/Adj)</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift (Raw/Adj)</th>
              <th className="border-b border-neutral-300 p-2 text-left">Off Periods</th>
              <th className="border-b border-neutral-300 p-2 text-left">Points</th>
            </tr>
          </thead>
          <tbody>
            {derived.metrics.map((employee) => {
              const isExpanded = expandedEmployeeId === employee.id;
              const draftOffPeriods = offPeriodDrafts[employee.id] ?? employee.offPeriods;
              const strikeReason = strikeReasonDrafts[employee.id] ?? '';
              const employeeStrikes = derived.strikesByEmployee.get(employee.id) ?? [];

              return (
                <Fragment key={employee.id}>
                  <tr className={`border-b border-neutral-200 ${isExpanded ? 'bg-neutral-50' : ''}`}>
                    <td className="p-2">
                      <button
                        className="flex min-h-[44px] items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-brand-maroon"
                        onClick={() => toggleEmployeeExpansion(employee.id, employee.offPeriods)}
                        type="button"
                      >
                        <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                        <span>{employee.name}</span>
                      </button>
                    </td>
                    <td className="p-2">{employee.sNumber || 'N/A'}</td>
                    <td className="p-2">{employee.strikesCount}</td>
                    <td className="p-2">
                      {formatRate(employee.meetingRawRate)} / {formatRate(employee.meetingAdjustedRate)}
                    </td>
                    <td className="p-2">
                      {formatRate(employee.shiftRawRate)} / {formatRate(employee.shiftAdjustedRate)}
                    </td>
                    <td className="p-2">{employee.offPeriods.join(', ')}</td>
                    <td className="p-2">{employee.points}</td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <td className="p-3" colSpan={7}>
                        <div className="grid gap-4 lg:grid-cols-3">
                          <div className="space-y-2 border border-neutral-300 bg-white p-3">
                            <h3 className="text-sm font-semibold text-neutral-900">Attendance</h3>
                            <p className="text-sm text-neutral-700">Username: {employee.username ?? 'N/A'}</p>
                            <p className="text-sm text-neutral-700">
                              Assigned periods: {employee.assignedPeriods || 'N/A'}
                            </p>
                            <p className="text-sm text-neutral-700">
                              Meeting: {employee.meetingAttended}/{employee.meetingSessions} attended,{' '}
                              {employee.meetingExcused} excused
                            </p>
                            <p className="text-sm text-neutral-700">
                              Shift: {employee.shiftPresent} present, {employee.shiftAbsent} absent,{' '}
                              {employee.shiftExcused} excused
                            </p>
                            <p className="text-sm text-neutral-700">
                              Morning shift presents: {employee.morningShifts}
                            </p>
                            <p className="text-sm text-neutral-700">
                              Off-period presents: {employee.offPeriodShifts}
                            </p>
                          </div>

                          <div className="space-y-3 border border-neutral-300 bg-white p-3">
                            <h3 className="text-sm font-semibold text-neutral-900">Off-Period Settings</h3>
                            <div className="grid grid-cols-4 gap-2">
                              {Array.from({ length: 8 }, (_, index) => index + 1).map((period) => {
                                const selected = draftOffPeriods.includes(period);
                                return (
                                  <button
                                    className={`min-h-[44px] border px-2 text-sm ${
                                      selected
                                        ? 'border-brand-maroon bg-brand-maroon text-white'
                                        : 'border-neutral-300 bg-white text-neutral-900'
                                    }`}
                                    key={`${employee.id}-period-${period}`}
                                    onClick={() => toggleOffPeriodDraft(employee.id, period, employee.offPeriods)}
                                    type="button"
                                  >
                                    P{period}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              className="min-h-[44px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!canEditSettings || saveOffPeriodsMutation.isPending || draftOffPeriods.length === 0}
                              onClick={() => {
                                if (draftOffPeriods.length === 0) {
                                  setStatusMessage('At least one off-period must be selected.');
                                  return;
                                }
                                saveOffPeriodsMutation.mutate({
                                  employeeId: employee.id,
                                  offPeriods: draftOffPeriods
                                });
                              }}
                              type="button"
                            >
                              Save Off-Periods
                            </button>
                          </div>

                          <div className="space-y-3 border border-neutral-300 bg-white p-3">
                            <h3 className="text-sm font-semibold text-neutral-900">Strike Management</h3>
                            <label className="block text-sm">
                              Reason
                              <textarea
                                className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
                                onChange={(event) =>
                                  setStrikeReasonDrafts((previous) => ({
                                    ...previous,
                                    [employee.id]: event.target.value
                                  }))
                                }
                                value={strikeReason}
                              />
                            </label>
                            <button
                              className="min-h-[44px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!canManageStrikes || addStrikeMutation.isPending}
                              onClick={() => {
                                const reason = strikeReason.trim();
                                if (!reason) {
                                  setStatusMessage('Strike reason is required.');
                                  return;
                                }
                                addStrikeMutation.mutate({
                                  employeeId: employee.id,
                                  reason
                                });
                              }}
                              type="button"
                            >
                              Add Strike
                            </button>
                            <div className="space-y-2">
                              {employeeStrikes.length === 0 && (
                                <p className="text-sm text-neutral-600">No active strikes.</p>
                              )}
                              {employeeStrikes.map((strike) => (
                                <div className="border border-neutral-300 p-2" key={String(strike.id)}>
                                  <p className="text-sm text-neutral-800">{String(strike.reason ?? 'No reason')}</p>
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <p className="text-xs text-neutral-600">
                                      {new Date(String(strike.issued_at ?? '')).toLocaleDateString()}
                                    </p>
                                    <button
                                      className="min-h-[44px] border border-neutral-400 px-2 text-xs"
                                      disabled={!canManageStrikes || removeStrikeMutation.isPending}
                                      onClick={() => removeStrikeMutation.mutate(String(strike.id))}
                                      type="button"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
