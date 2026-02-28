'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragEvent, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { buildExpectedShifts } from '@/app/actions/expected-shifts';
import { approveShiftExchange, submitShiftExchange } from '@/app/actions/shift-requests';
import { excuseShiftAbsence, markShiftAbsent, markShiftPresent } from '@/app/actions/shift-attendance';
import { fetchSchedule } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';
import { ScheduleAssignment, ShiftAttendanceStatus } from '@/lib/types';

import { getTodayDateKey, isDateTodayOrPast, useBrowserSupabase } from './utils';

const ScheduleFormSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  anchorDate: z.string().min(10),
  anchorDay: z.enum(['A', 'B']),
  seed: z.number().int()
});

type ScheduleFormValues = z.infer<typeof ScheduleFormSchema>;
type GenericRow = Record<string, unknown>;

type CalendarDayCell = {
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
};

type EditableAssignment = ScheduleAssignment & {
  uid: string;
};

type EditableRosterRow = {
  localId: string;
  id: number | string;
  name: string;
  s_number: string;
  scheduleable: boolean;
  Schedule: number;
};

type SummaryRow = {
  localId: string;
  student: string;
  studentSNumber: string;
  role: string;
  group: string;
  regularShifts: number;
  alternateShifts: number;
  totalShifts: number;
  periodsWorked: string;
};

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PERIOD_BANDS: Array<{ id: string; label: string; periods: number[] }> = [
  { id: 'morning', label: '8:20 - 9 AM', periods: [0] },
  { id: 'p1-5', label: 'Period 1 / 5', periods: [1, 5] },
  { id: 'p2-6', label: 'Period 2 / 6', periods: [2, 6] },
  { id: 'p3-7', label: 'Period 3 / 7', periods: [3, 7] },
  { id: 'p4-8', label: 'Period 4 / 8', periods: [4, 8] }
];

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toMonthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

function buildMonthWeeks(year: number, month: number): CalendarDayCell[][] {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));

  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - monthStart.getUTCDay());

  const gridEnd = new Date(monthEnd);
  gridEnd.setUTCDate(monthEnd.getUTCDate() + (6 - monthEnd.getUTCDay()));

  const days: CalendarDayCell[] = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push({
      dateKey: toDateKey(cursor),
      dayNumber: cursor.getUTCDate(),
      inCurrentMonth: cursor.getUTCMonth() + 1 === month
    });
  }

  const weeks: CalendarDayCell[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

function getDefaultValues(): ScheduleFormValues {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    anchorDate: now.toISOString().slice(0, 10),
    anchorDay: 'A',
    seed: Number(`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`)
  };
}

function isAlternateAssignment(assignment: Pick<ScheduleAssignment, 'role' | 'type'>): boolean {
  return /alternate/i.test(`${assignment.role} ${assignment.type}`);
}

function normalizeAttendanceStatus(value: unknown): ShiftAttendanceStatus {
  if (value === 'present' || value === 'absent' || value === 'excused' || value === 'expected') {
    return value;
  }
  return 'expected';
}

function toValidNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function attendanceStatusClasses(status: ShiftAttendanceStatus): string {
  if (status === 'absent') return 'border-red-400 bg-red-100 text-red-700';
  if (status === 'excused') return 'border-blue-400 bg-blue-100 text-blue-700';
  if (status === 'present') return 'border-green-400 bg-green-100 text-green-700';
  return 'border-neutral-500 bg-white text-neutral-700';
}

function buildSummaryFromAssignments(
  assignments: EditableAssignment[],
  rosterNameBySNumber: Map<string, string>
): SummaryRow[] {
  type Aggregate = {
    student: string;
    studentSNumber: string;
    role: string;
    group: string;
    regularShifts: number;
    alternateShifts: number;
    periods: Set<number>;
  };

  const aggregateBySNumber = new Map<string, Aggregate>();
  for (const assignment of assignments) {
    const existing = aggregateBySNumber.get(assignment.effectiveWorkerSNumber) ?? {
      student: rosterNameBySNumber.get(assignment.effectiveWorkerSNumber) ?? assignment.studentName,
      studentSNumber: assignment.effectiveWorkerSNumber,
      role: assignment.role,
      group: assignment.group,
      regularShifts: 0,
      alternateShifts: 0,
      periods: new Set<number>()
    };
    if (isAlternateAssignment(assignment)) {
      existing.alternateShifts += 1;
    } else {
      existing.regularShifts += 1;
    }
    existing.periods.add(assignment.period);
    if (existing.role !== assignment.role) existing.role = 'Mixed';
    if (existing.group !== assignment.group) existing.group = 'Mixed';
    aggregateBySNumber.set(assignment.effectiveWorkerSNumber, existing);
  }

  return [...aggregateBySNumber.values()]
    .sort((left, right) => left.student.localeCompare(right.student))
    .map((entry, index) => ({
      localId: `summary-${entry.studentSNumber}-${index}`,
      student: entry.student,
      studentSNumber: entry.studentSNumber,
      role: entry.role,
      group: entry.group,
      regularShifts: entry.regularShifts,
      alternateShifts: entry.alternateShifts,
      totalShifts: entry.regularShifts + entry.alternateShifts,
      periodsWorked: [...entry.periods].sort((left, right) => left - right).join(', ')
    }));
}

export function ScheduleTab() {
  const canApproveRequests = usePermission('hr.schedule.edit');
  const defaultValues = useMemo(() => getDefaultValues(), []);
  const [params, setParams] = useState(defaultValues);
  const [message, setMessage] = useState<string | null>(null);
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [editableAssignments, setEditableAssignments] = useState<EditableAssignment[]>([]);
  const [editableRoster, setEditableRoster] = useState<EditableRosterRow[]>([]);
  const [isSwapModeEnabled, setIsSwapModeEnabled] = useState(false);
  const [isGenerateConfirmOpen, setIsGenerateConfirmOpen] = useState(false);
  const [actingEmployeeSNumber, setActingEmployeeSNumber] = useState('');
  const [dragSourceUid, setDragSourceUid] = useState<string | null>(null);
  const [dragTargetUid, setDragTargetUid] = useState<string | null>(null);
  const [attendanceModalUid, setAttendanceModalUid] = useState<string | null>(null);
  const [attendanceReason, setAttendanceReason] = useState('');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();

  const form = useForm<ScheduleFormValues>({
    resolver: zodResolver(ScheduleFormSchema),
    defaultValues
  });

  const scheduleQuery = useQuery({
    queryKey: ['hr-schedule', params],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const result = await fetchSchedule(params);
      if (!result.ok) {
        throw new Error(`${result.error.message} (${result.correlationId})`);
      }
      return result.data;
    }
  });

  const settingsQuery = useQuery({
    queryKey: ['employee-settings-for-schedule'],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_settings').select('employee_s_number, off_periods');
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const studentsRosterQuery = useQuery({
    queryKey: ['hr-schedule-students-roster'],
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id, name, s_number, scheduleable, Schedule')
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const selectedMonthRange = useMemo(() => toMonthRange(params.year, params.month), [params.month, params.year]);

  const shiftAttendanceQuery = useQuery({
    queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_attendance')
        .select('*')
        .gte('shift_date', selectedMonthRange.from)
        .lte('shift_date', selectedMonthRange.to);
      if (error) throw new Error(error.message);
      return (data ?? []) as GenericRow[];
    }
  });

  const manualRefresh = useMutation({
    mutationFn: async (input: ScheduleFormValues) => {
      const result = await fetchSchedule({ ...input, forceRefresh: true });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['hr-schedule', variables], data);
      setMessage('Generated a new schedule table from the live API.');
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to generate a new table.');
    }
  });

  const buildExpectedMutation = useMutation({
    mutationFn: async (input: ScheduleFormValues) => {
      const result = await buildExpectedShifts(input.year, input.month, {
        forceRebuild: true,
        anchorDate: input.anchorDate,
        anchorDay: input.anchorDay,
        seed: input.seed
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data) => {
      setMessage(`Expected shifts rebuilt. Created ${data.created}, updated ${data.updated}.`);
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to build expected shifts.');
    }
  });

  const updateAttendanceMutation = useMutation({
    mutationFn: async (payload: {
      assignment: EditableAssignment;
      status: 'present' | 'absent' | 'excused';
      reason?: string;
    }) => {
      if (payload.status === 'present') {
        const result = await markShiftPresent(
          payload.assignment.effectiveWorkerSNumber,
          payload.assignment.date,
          payload.assignment.period,
          payload.assignment.shiftSlotKey
        );
        if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
        return result.data;
      }
      if (payload.status === 'absent') {
        const result = await markShiftAbsent(
          payload.assignment.effectiveWorkerSNumber,
          payload.assignment.date,
          payload.assignment.period,
          payload.assignment.shiftSlotKey
        );
        if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
        return result.data;
      }
      const result = await excuseShiftAbsence(
        payload.assignment.effectiveWorkerSNumber,
        payload.assignment.date,
        payload.assignment.period,
        payload.assignment.shiftSlotKey,
        payload.reason ?? ''
      );
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
      });
      setMessage('Attendance updated.');
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to update attendance.');
    }
  });

  const updateRosterScheduleableMutation = useMutation({
    mutationFn: async (payload: { id: number | string; scheduleable: boolean; name: string }) => {
      const { error } = await supabase
        .from('students')
        .update({ scheduleable: payload.scheduleable })
        .eq('id', payload.id);
      if (error) throw new Error(error.message);
      return payload;
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-students-roster'] });
      setMessage(
        `${payload.name} is now ${payload.scheduleable ? 'schedulable (on roster)' : 'not schedulable (off roster)'}.`
      );
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to update schedulable status.');
    }
  });

  const volunteerForShiftMutation = useMutation({
    mutationFn: async (payload: { assignment: EditableAssignment; volunteerSNumber: string }) => {
      const reason = 'Self-volunteered for shift';
      const submitResult = await submitShiftExchange(
        payload.assignment.date,
        payload.assignment.period,
        payload.assignment.shiftSlotKey,
        payload.assignment.effectiveWorkerSNumber,
        payload.volunteerSNumber,
        reason
      );
      if (!submitResult.ok) throw new Error(`${submitResult.error.message} (${submitResult.correlationId})`);

      if (canApproveRequests) {
        const approveResult = await approveShiftExchange(submitResult.data.id);
        if (!approveResult.ok) throw new Error(`${approveResult.error.message} (${approveResult.correlationId})`);
      }

      return submitResult.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-schedule'] });
      queryClient.invalidateQueries({
        queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
      });
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
      setMessage(
        canApproveRequests
          ? 'Volunteer assignment confirmed.'
          : 'Volunteer request submitted for approval.'
      );
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to volunteer for this shift.');
    }
  });

  const settingsMap = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      map.set(row.employee_s_number as string, (row.off_periods as number[]) ?? [4, 8]);
    }
    return map;
  }, [settingsQuery.data]);

  const schedule = scheduleQuery.data;

  useEffect(() => {
    if (!schedule) return;
    setEditableAssignments(
      schedule.schedule.map((assignment, index) => ({
        ...assignment,
        uid: `${assignment.date}|${assignment.period}|${assignment.shiftSlotKey}|${assignment.studentSNumber}|${index}`
      }))
    );
    setActiveWeekIndex(0);
    setDragSourceUid(null);
    setDragTargetUid(null);
    setAttendanceModalUid(null);
  }, [schedule]);

  useEffect(() => {
    if (!studentsRosterQuery.data) return;
    setEditableRoster(
      studentsRosterQuery.data.map((entry, index) => ({
        localId: `roster-${entry.s_number}-${index}`,
        id: entry.id,
        name: entry.name,
        s_number: entry.s_number,
        scheduleable: Boolean(entry.scheduleable),
        Schedule: typeof entry.Schedule === 'number' ? entry.Schedule : 0
      }))
    );
  }, [studentsRosterQuery.data]);

  const monthTitle = useMemo(() => {
    if (!schedule) return '';
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(Date.UTC(schedule.meta.year, schedule.meta.month - 1, 1)));
  }, [schedule]);

  const calendarWeeks = useMemo(() => {
    if (!schedule) return [];
    return buildMonthWeeks(schedule.meta.year, schedule.meta.month);
  }, [schedule]);

  const activeWeek = calendarWeeks[activeWeekIndex] ?? [];

  const rosterNameBySNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of editableRoster) {
      map.set(employee.s_number, employee.name);
    }
    if (!schedule) return map;
    for (const employee of schedule.roster) {
      if (!map.has(employee.s_number)) {
        map.set(employee.s_number, employee.name);
      }
    }
    return map;
  }, [editableRoster, schedule]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, EditableAssignment[]>();
    for (const assignment of editableAssignments) {
      const key = `${assignment.date}|${assignment.period}`;
      const bucket = map.get(key) ?? [];
      bucket.push(assignment);
      map.set(key, bucket);
    }
    return map;
  }, [editableAssignments]);
  const assignmentByUid = useMemo(() => {
    const map = new Map<string, EditableAssignment>();
    for (const assignment of editableAssignments) {
      map.set(assignment.uid, assignment);
    }
    return map;
  }, [editableAssignments]);

  const rosterMetaBySNumber = useMemo(() => {
    const map = new Map<string, { scheduleable: boolean; classPeriod: number | null }>();
    for (const employee of editableRoster) {
      map.set(employee.s_number, {
        scheduleable: employee.scheduleable,
        classPeriod: toValidNumber(employee.Schedule)
      });
    }
    return map;
  }, [editableRoster]);
  const actingEmployeeOptions = useMemo(
    () =>
      editableRoster
        .filter((employee) => employee.scheduleable && employee.s_number)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((employee) => ({
          value: employee.s_number,
          label: `${employee.name} (${employee.s_number})`
        })),
    [editableRoster]
  );
  useEffect(() => {
    if (actingEmployeeOptions.length === 0) {
      if (actingEmployeeSNumber) setActingEmployeeSNumber('');
      return;
    }
    const allowedValues = new Set(actingEmployeeOptions.map((item) => item.value));
    if (!actingEmployeeSNumber || !allowedValues.has(actingEmployeeSNumber)) {
      setActingEmployeeSNumber(actingEmployeeOptions[0].value);
    }
  }, [actingEmployeeOptions, actingEmployeeSNumber]);

  const canEmployeeWorkPeriod = (employeeSNumber: string, period: number): boolean => {
    const rosterMeta = rosterMetaBySNumber.get(employeeSNumber);
    if (!rosterMeta || !rosterMeta.scheduleable) return false;
    if (period === 0) return true;
    const offPeriods = settingsMap.get(employeeSNumber) ?? [4, 8];
    return rosterMeta.classPeriod === period || offPeriods.includes(period);
  };

  const canSwapAssignments = (sourceUid: string, targetUid: string): boolean => {
    if (!sourceUid || !targetUid || sourceUid === targetUid) return false;
    const source = assignmentByUid.get(sourceUid);
    const target = assignmentByUid.get(targetUid);
    if (!source || !target) return false;

    const sourceWorkerCanTakeTarget = canEmployeeWorkPeriod(source.effectiveWorkerSNumber, target.period);
    const targetWorkerCanTakeSource = canEmployeeWorkPeriod(target.effectiveWorkerSNumber, source.period);
    return sourceWorkerCanTakeTarget && targetWorkerCanTakeSource;
  };

  const summaryRows = useMemo(
    () => buildSummaryFromAssignments(editableAssignments, rosterNameBySNumber),
    [editableAssignments, rosterNameBySNumber]
  );

  const attendanceByAssignmentKey = useMemo(() => {
    const map = new Map<string, GenericRow>();
    for (const row of shiftAttendanceQuery.data ?? []) {
      const key = [
        String(row.shift_date ?? ''),
        String(row.shift_period ?? ''),
        String(row.shift_slot_key ?? ''),
        String(row.employee_s_number ?? '')
      ].join('|');
      map.set(key, row);
    }
    return map;
  }, [shiftAttendanceQuery.data]);

  const selectedAssignment = useMemo(
    () => editableAssignments.find((assignment) => assignment.uid === attendanceModalUid) ?? null,
    [attendanceModalUid, editableAssignments]
  );
  const todayKey = getTodayDateKey();
  const selectedShiftIsFuture = selectedAssignment
    ? !isDateTodayOrPast(selectedAssignment.date, todayKey)
    : false;

  const onOptionsSubmit = (values: ScheduleFormValues) => {
    setParams(values);
    setMessage(null);
  };
  const targetYearMonthLabel = `${form.watch('year')}-${String(form.watch('month')).padStart(2, '0')}`;

  const handleSwapWorkers = (sourceUid: string, targetUid: string) => {
    if (!sourceUid || !targetUid || sourceUid === targetUid) return;
    setEditableAssignments((previous) => {
      const sourceIndex = previous.findIndex((assignment) => assignment.uid === sourceUid);
      const targetIndex = previous.findIndex((assignment) => assignment.uid === targetUid);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const source = previous[sourceIndex];
      const target = previous[targetIndex];
      if (
        !canEmployeeWorkPeriod(source.effectiveWorkerSNumber, target.period) ||
        !canEmployeeWorkPeriod(target.effectiveWorkerSNumber, source.period)
      ) {
        setMessage(
          'Swap blocked: employees can only be moved into periods where they are eligible (class period or off period).'
        );
        return previous;
      }
      const next = [...previous];
      next[sourceIndex] = { ...source, effectiveWorkerSNumber: target.effectiveWorkerSNumber };
      next[targetIndex] = { ...target, effectiveWorkerSNumber: source.effectiveWorkerSNumber };
      return next;
    });
    setDragSourceUid(null);
    setDragTargetUid(null);
  };

  return (
    <section className="space-y-4">
      {message && <p className="text-sm text-brand-maroon">{message}</p>}
      {scheduleQuery.isLoading && <p className="text-sm text-neutral-600">Loading schedule...</p>}
      {scheduleQuery.error && <p className="text-sm text-red-700">{(scheduleQuery.error as Error).message}</p>}

      {schedule && (
        <div className="space-y-4">
          <div className="grid gap-3 border border-neutral-300 bg-white p-3 md:grid-cols-4">
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Generated at</p>
              <p className="text-sm font-medium">{new Date(schedule.meta.generatedAt).toLocaleString()}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Assignments</p>
              <p className="text-sm font-medium">{schedule.schedule.length}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Roster</p>
              <p className="text-sm font-medium">{editableRoster.length}</p>
            </div>
            <div className="border border-neutral-300 p-3">
              <p className="text-xs text-neutral-500">Calendar days</p>
              <p className="text-sm font-medium">{Object.keys(schedule.calendar).length}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-300 bg-neutral-50 p-2">
              <h3 className="text-sm font-semibold">Schedule — {monthTitle}</h3>
              <div className="flex items-center gap-2">
                <button
                  className={`min-h-[44px] border px-3 text-sm ${
                    isSwapModeEnabled
                      ? 'border-brand-maroon bg-brand-maroon text-white'
                      : 'border-neutral-500 bg-white text-neutral-900'
                  }`}
                  onClick={() => {
                    setIsSwapModeEnabled((previous) => {
                      const next = !previous;
                      if (!next) {
                        setDragSourceUid(null);
                        setDragTargetUid(null);
                      }
                      return next;
                    });
                  }}
                  type="button"
                >
                  {isSwapModeEnabled ? 'Drag employees to switch' : 'Enable Drag Mode'}
                </button>
                <label className="text-sm">
                  Volunteer As
                  <select
                    className="ml-2 min-h-[44px] border border-neutral-500 px-2"
                    disabled={actingEmployeeOptions.length === 0}
                    onChange={(event) => setActingEmployeeSNumber(event.target.value)}
                    value={actingEmployeeSNumber}
                  >
                    {actingEmployeeOptions.length === 0 && (
                      <option value="">No schedulable employees</option>
                    )}
                    {actingEmployeeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="min-h-[44px] border border-neutral-500 px-3 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={activeWeekIndex <= 0}
                  onClick={() => setActiveWeekIndex((previous) => Math.max(0, previous - 1))}
                  type="button"
                >
                  Previous Week
                </button>
                <p className="text-sm text-neutral-700">
                  Week {activeWeekIndex + 1} / {Math.max(calendarWeeks.length, 1)}
                </p>
                <button
                  className="min-h-[44px] border border-neutral-500 px-3 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={activeWeekIndex >= calendarWeeks.length - 1}
                  onClick={() => setActiveWeekIndex((previous) => Math.min(calendarWeeks.length - 1, previous + 1))}
                  type="button"
                >
                  Next Week
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-neutral-300">
              <table className="w-full min-w-[1150px] text-xs md:text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-r border-neutral-300 p-2 text-left">Week {activeWeekIndex + 1}</th>
                    {WEEKDAY_LABELS.map((label) => (
                      <th className="border-b border-neutral-300 p-2 text-left" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="border-b border-r border-neutral-300 p-2 text-left">Date</th>
                    {activeWeek.map((day) => {
                      const dayType = schedule.calendar[day.dateKey];
                      const dateCellClass = day.inCurrentMonth
                        ? 'bg-white text-neutral-900'
                        : 'bg-neutral-100 text-neutral-400';
                      return (
                        <th className={`border-b border-neutral-300 p-2 text-left ${dateCellClass}`} key={`${day.dateKey}-date`}>
                          <div className="flex items-center justify-between gap-2">
                            <span>{day.dayNumber}</span>
                            {dayType && (
                              <span className="border border-neutral-400 px-1 text-[10px] uppercase tracking-wide">
                                {dayType}
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {PERIOD_BANDS.map((periodBand) => (
                    <tr key={`${activeWeekIndex}-${periodBand.id}`}>
                      <th className="border-b border-r border-neutral-300 bg-blue-50 p-2 text-left font-medium text-neutral-800">
                        {periodBand.label}
                      </th>
                      {activeWeek.map((day) => {
                        const dayType = schedule.calendar[day.dateKey];
                        const baseCellTone = !day.inCurrentMonth
                          ? 'bg-neutral-100'
                          : dayType === 'A'
                            ? 'bg-amber-50'
                            : dayType === 'B'
                              ? 'bg-violet-50'
                              : 'bg-white';

                        const assignments = periodBand.periods
                          .flatMap((period) => assignmentMap.get(`${day.dateKey}|${period}`) ?? [])
                          .sort((left, right) => {
                            if (left.period !== right.period) return left.period - right.period;
                            return left.shiftSlotKey.localeCompare(right.shiftSlotKey);
                          });

                        return (
                          <td className={`border-b border-neutral-300 p-2 align-top ${baseCellTone}`} key={`${day.dateKey}-${periodBand.id}`}>
                            {!day.inCurrentMonth && <span className="text-[11px] text-neutral-400">—</span>}
                            {day.inCurrentMonth && assignments.length === 0 && (
                              <span className="text-[11px] text-neutral-500">No assignment</span>
                            )}
                            {day.inCurrentMonth && assignments.length > 0 && (
                              <div className="space-y-1">
                                {assignments.map((assignment) => {
                                  const offPeriods = settingsMap.get(assignment.effectiveWorkerSNumber) ?? [4, 8];
                                  const isOffPeriod = offPeriods.includes(assignment.period);
                                  const exchanged = assignment.studentSNumber !== assignment.effectiveWorkerSNumber;
                                  const isAlternate = isAlternateAssignment(assignment);
                                  const effectiveName =
                                    rosterNameBySNumber.get(assignment.effectiveWorkerSNumber) ??
                                    assignment.effectiveWorkerSNumber;
                                  const attendanceKey = [
                                    assignment.date,
                                    assignment.period,
                                    assignment.shiftSlotKey,
                                    assignment.effectiveWorkerSNumber
                                  ].join('|');
                                  const attendanceStatus = normalizeAttendanceStatus(
                                    attendanceByAssignmentKey.get(attendanceKey)?.status
                                  );
                                  const actingEmployeeCanVolunteer = Boolean(
                                    actingEmployeeSNumber &&
                                      actingEmployeeSNumber !== assignment.effectiveWorkerSNumber &&
                                      attendanceStatus === 'expected' &&
                                      (assignment.period === 0 ||
                                        (settingsMap.get(actingEmployeeSNumber) ?? [4, 8]).includes(assignment.period))
                                  );
                                  const actingEmployeeOwnsThisShift = Boolean(
                                    actingEmployeeSNumber &&
                                      actingEmployeeSNumber === assignment.effectiveWorkerSNumber &&
                                      attendanceStatus === 'expected'
                                  );
                                  const isDragTarget = dragTargetUid === assignment.uid;
                                  const isValidDropTarget = dragSourceUid
                                    ? canSwapAssignments(dragSourceUid, assignment.uid)
                                    : true;

                                  return (
                                    <div
                                      className={`${isSwapModeEnabled ? 'cursor-grab' : 'cursor-pointer'} border p-1 ${isAlternate ? 'border-sky-400 bg-sky-100/80' : 'border-neutral-300 bg-white/90'} ${
                                        isDragTarget ? 'ring-2 ring-brand-maroon' : ''
                                      } ${dragSourceUid && !isValidDropTarget ? 'opacity-60' : ''}`}
                                      draggable={isSwapModeEnabled}
                                      key={assignment.uid}
                                      onClick={() => {
                                        setAttendanceModalUid(assignment.uid);
                                        setAttendanceReason('');
                                      }}
                                      onDragEnd={() => {
                                        if (!isSwapModeEnabled) return;
                                        setDragSourceUid(null);
                                        setDragTargetUid(null);
                                      }}
                                      onDragOver={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled) return;
                                        event.preventDefault();
                                        if (dragSourceUid && dragSourceUid !== assignment.uid) {
                                          setDragTargetUid(
                                            canSwapAssignments(dragSourceUid, assignment.uid) ? assignment.uid : null
                                          );
                                        }
                                      }}
                                      onDragStart={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled) return;
                                        setDragSourceUid(assignment.uid);
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', assignment.uid);
                                      }}
                                      onDrop={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled) return;
                                        event.preventDefault();
                                        const sourceUid = event.dataTransfer.getData('text/plain') || dragSourceUid;
                                        if (sourceUid) {
                                          if (!canSwapAssignments(sourceUid, assignment.uid)) {
                                            setMessage(
                                              'Swap blocked: employees can only be moved into periods where they are eligible (class period or off period).'
                                            );
                                            setDragSourceUid(null);
                                            setDragTargetUid(null);
                                            return;
                                          }
                                          handleSwapWorkers(sourceUid, assignment.uid);
                                        }
                                      }}
                                      role="button"
                                      tabIndex={0}
                                    >
                                      <p className="font-medium leading-tight">
                                        {periodBand.periods.length > 1 && (
                                          <span className="mr-1 text-[10px] text-neutral-500">P{assignment.period}</span>
                                        )}
                                        {effectiveName}
                                      </p>
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {isAlternate && (
                                          <span className="border border-sky-500 bg-sky-200 px-1 text-[10px] text-sky-900">
                                            Alternate employee
                                          </span>
                                        )}
                                        {exchanged && (
                                          <span className="border border-brand-maroon px-1 text-[10px] text-brand-maroon">
                                            Swapped
                                          </span>
                                        )}
                                        {isOffPeriod && (
                                          <span className="border border-neutral-500 px-1 text-[10px] text-neutral-700">
                                            Off-period
                                          </span>
                                        )}
                                        <span
                                          className={`border px-1 text-[10px] uppercase ${attendanceStatusClasses(attendanceStatus)}`}
                                        >
                                          {attendanceStatus === 'excused' ? 'pardoned' : attendanceStatus}
                                        </span>
                                      </div>
                                      {isSwapModeEnabled && (
                                        <p className="mt-1 text-[10px] text-neutral-500">
                                          Drag to another employee to swap.
                                        </p>
                                      )}
                                      {actingEmployeeCanVolunteer && (
                                        <button
                                          className="mt-1 min-h-[30px] border border-neutral-500 px-2 text-[10px] disabled:opacity-40"
                                          disabled={volunteerForShiftMutation.isPending}
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            volunteerForShiftMutation.mutate({
                                              assignment,
                                              volunteerSNumber: actingEmployeeSNumber
                                            });
                                          }}
                                          type="button"
                                        >
                                          Assign/Volunteer for this shift
                                        </button>
                                      )}
                                      {actingEmployeeOwnsThisShift && (
                                        <button
                                          className="mt-1 min-h-[30px] border border-neutral-400 px-2 text-[10px]"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setMessage(
                                              'To remove yourself from this shift, submit a shift change request from the Requests tab.'
                                            );
                                          }}
                                          type="button"
                                        >
                                          Request to unassign
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Statistics</h3>
              <div className="max-h-60 overflow-auto p-2 text-sm">
                {schedule.statistics.map((stat) => (
                  <p key={stat.metric}>
                    {stat.metric}: {stat.value}
                  </p>
                ))}
              </div>
            </div>
            <div className="border border-neutral-300">
              <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Balance Analysis</h3>
              <div className="max-h-60 overflow-auto p-2 text-sm">
                {schedule.balanceAnalysis.map((item) => (
                  <p key={`${item.category}-${item.metric}`}>
                    {item.category} — {item.metric}: {item.value}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="overflow-x-auto border border-neutral-300">
              <div className="border-b border-neutral-300 bg-neutral-50 p-2">
                <h3 className="text-sm font-semibold">Roster (Students Table)</h3>
                <p className="text-xs text-neutral-600">
                  Comprehensive list comes from `public.students`. `Scheduleable` controls roster inclusion.
                </p>
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Name</th>
                    <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Scheduleable</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Schedule</th>
                  </tr>
                </thead>
                <tbody>
                  {editableRoster.map((entry) => (
                    <tr className="border-b border-neutral-200" key={entry.localId}>
                      <td className="p-2">{entry.name}</td>
                      <td className="p-2">{entry.s_number}</td>
                      <td className="p-2">
                        <label className="flex items-center gap-2">
                          <input
                            checked={entry.scheduleable}
                            disabled={updateRosterScheduleableMutation.isPending}
                            onChange={(event) => {
                              const nextValue = event.target.checked;
                              setEditableRoster((previous) =>
                                previous.map((item) =>
                                  item.localId === entry.localId
                                    ? { ...item, scheduleable: nextValue }
                                    : item
                                )
                              );
                              updateRosterScheduleableMutation.mutate({
                                id: entry.id,
                                scheduleable: nextValue,
                                name: entry.name
                              });
                            }}
                            type="checkbox"
                          />
                          <span>{entry.scheduleable ? 'On roster' : 'Off roster'}</span>
                        </label>
                      </td>
                      <td className="p-2">{entry.Schedule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto border border-neutral-300">
              <div className="border-b border-neutral-300 bg-neutral-50 p-2">
                <h3 className="text-sm font-semibold">Summary</h3>
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Student</th>
                    <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Regular</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Alternate</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Total</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Periods</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((entry) => (
                    <tr className="border-b border-neutral-200" key={entry.localId}>
                      <td className="p-2">{entry.student}</td>
                      <td className="p-2">{entry.studentSNumber}</td>
                      <td className="p-2">{entry.regularShifts}</td>
                      <td className="p-2">{entry.alternateShifts}</td>
                      <td className="p-2">{entry.totalShifts}</td>
                      <td className="p-2">{entry.periodsWorked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <section className="space-y-3 border border-neutral-300 bg-neutral-50 p-3">
            <details className="border border-neutral-300 bg-white">
              <summary className="cursor-pointer p-3 text-sm font-medium">Extra options</summary>
              <form className="grid gap-3 border-t border-neutral-300 p-3 md:grid-cols-6" onSubmit={form.handleSubmit(onOptionsSubmit)}>
                <label className="text-sm">
                  Year
                  <input
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    type="number"
                    {...form.register('year', { valueAsNumber: true })}
                  />
                </label>
                <label className="text-sm">
                  Month
                  <input
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    type="number"
                    {...form.register('month', { valueAsNumber: true })}
                  />
                </label>
                <label className="text-sm">
                  Anchor Date
                  <input
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    type="date"
                    {...form.register('anchorDate')}
                  />
                </label>
                <label className="text-sm">
                  Anchor Day
                  <select className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2" {...form.register('anchorDay')}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </label>
                <label className="text-sm">
                  Seed
                  <input
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    type="number"
                    {...form.register('seed', { valueAsNumber: true })}
                  />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <button className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white" type="submit">
                    Apply Options
                  </button>
                  <button
                    className="min-h-[44px] border border-neutral-500 px-3 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={buildExpectedMutation.isPending}
                    onClick={() => buildExpectedMutation.mutate(form.getValues())}
                    type="button"
                  >
                    Rebuild Expected
                  </button>
                </div>
              </form>
            </details>
            <button
              className="min-h-[44px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={manualRefresh.isPending}
              onClick={() => setIsGenerateConfirmOpen(true)}
              type="button"
            >
              Generate New Table
            </button>
            <p className="text-xs text-neutral-600">
              Future month generation is supported. Set year/month above (for example, `{targetYearMonthLabel}`) and generate.
            </p>
          </section>
        </div>
      )}

      {selectedAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg border border-neutral-400 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">Edit Attendance</h3>
                <p className="mt-1 text-sm text-neutral-700">
                  {rosterNameBySNumber.get(selectedAssignment.effectiveWorkerSNumber) ??
                    selectedAssignment.effectiveWorkerSNumber}{' '}
                  • {selectedAssignment.date} • P{selectedAssignment.period}
                </p>
              </div>
              <button
                className="min-h-[36px] border border-neutral-500 px-2 text-sm"
                onClick={() => setAttendanceModalUid(null)}
                type="button"
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm text-neutral-700">
              Current status:{' '}
              <span className="font-medium">
                {normalizeAttendanceStatus(
                  attendanceByAssignmentKey.get(
                    [
                      selectedAssignment.date,
                      selectedAssignment.period,
                      selectedAssignment.shiftSlotKey,
                      selectedAssignment.effectiveWorkerSNumber
                    ].join('|')
                  )?.status
                )}
              </span>
            </p>
            <label className="mt-3 block text-sm">
              Reason (required for Excused)
              <textarea
                className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
                onChange={(event) => setAttendanceReason(event.target.value)}
                value={attendanceReason}
              />
            </label>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                className="min-h-[44px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                disabled={updateAttendanceMutation.isPending || selectedShiftIsFuture}
                onClick={() =>
                  updateAttendanceMutation.mutate({
                    assignment: selectedAssignment,
                    status: 'present'
                  })
                }
                type="button"
              >
                Mark Present
              </button>
              <button
                className="min-h-[44px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                disabled={updateAttendanceMutation.isPending}
                onClick={() =>
                  updateAttendanceMutation.mutate({
                    assignment: selectedAssignment,
                    status: 'absent'
                  })
                }
                type="button"
              >
                Mark Absent
              </button>
              <button
                className="min-h-[44px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                disabled={updateAttendanceMutation.isPending || !attendanceReason.trim() || selectedShiftIsFuture}
                onClick={() =>
                  updateAttendanceMutation.mutate({
                    assignment: selectedAssignment,
                    status: 'excused',
                    reason: attendanceReason.trim()
                  })
                }
                type="button"
              >
                Mark Excused
              </button>
            </div>
            {selectedShiftIsFuture && (
              <p className="mt-2 text-xs text-neutral-600">
                Present and excused overrides are only allowed on the shift date or after.
              </p>
            )}
          </div>
        </div>
      )}

      {isGenerateConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg border border-neutral-400 bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">Confirm Table Generation</h3>
            <p className="mt-2 text-sm text-neutral-700">
              Are you sure? Generating a new table can overwrite expected shift data for the selected month and replace
              what is currently staged.
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              Target month: <span className="font-medium">{targetYearMonthLabel}</span>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                onClick={() => setIsGenerateConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-40"
                disabled={manualRefresh.isPending}
                onClick={() => {
                  const values = form.getValues();
                  setParams(values);
                  manualRefresh.mutate(values);
                  setIsGenerateConfirmOpen(false);
                }}
                type="button"
              >
                I Understand, Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
