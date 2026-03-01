'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { approveShiftExchange, submitShiftExchange } from '@/app/actions/shift-requests';
import { excuseShiftAbsence, markShiftAbsent, markShiftPresent } from '@/app/actions/shift-attendance';
import { fetchSchedule } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';
import { ScheduleAssignment, ScheduleParams, ShiftAttendanceStatus } from '@/lib/types';

import { getTodayDateKey, isDateBeforeToday, useBrowserSupabase } from './utils';

type GenericRow = Record<string, unknown>;
type YearMonthSelection = { year: number; month: number };
type GenerationSelection = {
  year: number;
  month: number;
  anchorDate: string;
  anchorDay: 'A' | 'B';
  seed: number;
};
type AccessMode = 'employee' | 'manager';
type ShiftActionChoice = 'volunteer' | 'remove';
type EmptySlotTarget = {
  date: string;
  period: number;
};
type PendingManualEdit =
  | {
      mode: 'assign';
      date: string;
      period: number;
      employeeSNumber: string;
      asAlternate: boolean;
    }
  | {
      mode: 'remove';
      date: string;
      period: number;
      shiftSlotKey: string;
      employeeSNumber: string;
    };

type StoredScheduleTableRow = {
  year: number;
  month: number;
  anchor_date: string;
  anchor_day: 'A' | 'B';
  seed: number;
  generated_at: string;
};

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

const MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];

const COLLAPSED_ROSTER_SUMMARY_ROWS = 12;
const COLLAPSED_OVERVIEW_MAX_HEIGHT_CLASS = 'max-h-[560px]';
const MAX_REGULAR_ASSIGNMENTS_PER_SHIFT = 3;
const MAX_ALTERNATE_ASSIGNMENTS_PER_SHIFT = 1;
const LEAVE_WITH_UNSAVED_CHANGES_MESSAGE =
  'You have unsaved schedule changes. Save before leaving, or your changes will be lost.';

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isWeekendDateKey(dateKey: string): boolean {
  const value = new Date(`${dateKey}T00:00:00Z`);
  const day = value.getUTCDay();
  return day === 0 || day === 6;
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

function toYearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getFirstMondayOfMonth(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = first.getUTCDay();
  const offsetToMonday = (8 - day) % 7;
  first.setUTCDate(1 + offsetToMonday);
  return first.toISOString().slice(0, 10);
}

function buildGenerationSelection(year: number, month: number, anchorDay: 'A' | 'B' = 'A'): GenerationSelection {
  return {
    year,
    month,
    anchorDate: getFirstMondayOfMonth(year, month),
    anchorDay,
    seed: Number(`${year}${String(month).padStart(2, '0')}`)
  };
}

function generateScheduleSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function resolvePeriodForDay(periods: number[], dayType: string | undefined): number {
  if (periods.length <= 1) return periods[0] ?? 0;
  if (dayType === 'B') return periods[1] ?? periods[0] ?? 0;
  return periods[0] ?? 0;
}

function buildManualShiftSlotKey(
  date: string,
  period: number,
  employeeSNumber: string,
  asAlternate = false
): string {
  const prefix = asAlternate ? 'manual_alt' : 'manual';
  return `${prefix}|${date}|${period}|${employeeSNumber}`;
}

function isManualShiftSlotKey(shiftSlotKey: string): boolean {
  return shiftSlotKey.startsWith('manual|') || shiftSlotKey.startsWith('manual_alt|');
}

function isManualAlternateShiftSlotKey(shiftSlotKey: string): boolean {
  return shiftSlotKey.startsWith('manual_alt|');
}

function parseDraggedAssignmentUid(rawPayload: string): string | null {
  if (!rawPayload) return null;
  if (rawPayload.startsWith('assignment:')) {
    return rawPayload.slice('assignment:'.length);
  }
  if (rawPayload.startsWith('roster:')) {
    return null;
  }
  return rawPayload;
}

function rosterSnapshotKey(id: number | string): string {
  return String(id);
}

function getDefaultGenerationSelection(): GenerationSelection {
  const now = new Date();
  return buildGenerationSelection(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

function buildScheduleParams(selection: GenerationSelection): ScheduleParams {
  return {
    year: selection.year,
    month: selection.month,
    anchorDate: selection.anchorDate,
    anchorDay: selection.anchorDay,
    seed: selection.seed
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
  const hasScheduleEditPermission = usePermission('hr.schedule.edit');
  const canChangeAccessMode = hasScheduleEditPermission;
  const searchParams = useSearchParams();
  const defaultGenerationSelection = useMemo(() => getDefaultGenerationSelection(), []);
  const [generationSelection, setGenerationSelection] = useState<GenerationSelection>(defaultGenerationSelection);
  const [monthSelection, setMonthSelection] = useState<YearMonthSelection>({
    year: defaultGenerationSelection.year,
    month: defaultGenerationSelection.month
  });
  const [params, setParams] = useState<ScheduleParams>(() => buildScheduleParams(defaultGenerationSelection));
  const [scheduleAccessMode, setScheduleAccessMode] = useState<AccessMode>('employee');
  const [message, setMessage] = useState<string | null>(null);
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [editableAssignments, setEditableAssignments] = useState<EditableAssignment[]>([]);
  const [manualAssignments, setManualAssignments] = useState<EditableAssignment[]>([]);
  const [editableRoster, setEditableRoster] = useState<EditableRosterRow[]>([]);
  const [isSwapModeEnabled, setIsSwapModeEnabled] = useState(false);
  const [isGenerateConfirmOpen, setIsGenerateConfirmOpen] = useState(false);
  const [actingEmployeeSNumber, setActingEmployeeSNumber] = useState('');
  const [shiftActionModalUid, setShiftActionModalUid] = useState<string | null>(null);
  const [shiftActionChoice, setShiftActionChoice] = useState<ShiftActionChoice>('volunteer');
  const [assignmentTargetSNumber, setAssignmentTargetSNumber] = useState('');
  const [managerAssigneeSearch, setManagerAssigneeSearch] = useState('');
  const [isRosterSummaryExpanded, setIsRosterSummaryExpanded] = useState(false);
  const [dragSourceUid, setDragSourceUid] = useState<string | null>(null);
  const [dragTargetUid, setDragTargetUid] = useState<string | null>(null);
  const [emptySlotTarget, setEmptySlotTarget] = useState<EmptySlotTarget | null>(null);
  const [attendanceReason, setAttendanceReason] = useState('');
  const [savedAssignmentWorkersByUid, setSavedAssignmentWorkersByUid] = useState<Record<string, string>>({});
  const [savedRosterScheduleableById, setSavedRosterScheduleableById] = useState<Record<string, boolean>>({});
  const [pendingManualEdits, setPendingManualEdits] = useState<PendingManualEdit[]>([]);
  const [isPersistingEdits, setIsPersistingEdits] = useState(false);
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const isManagerMode = hasScheduleEditPermission && scheduleAccessMode === 'manager';

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

  const storedTablesQuery = useQuery({
    queryKey: ['hr-schedule-table-index'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedules')
        .select('year, month, anchor_date, anchor_day, seed, generated_at')
        .order('generated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as StoredScheduleTableRow[];
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
    mutationFn: async (input: ScheduleParams) => {
      const result = await fetchSchedule({ ...input, forceRefresh: true });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['hr-schedule', variables], data);
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-table-index'] });
      setMessage(
        `Generated table for ${variables.year}-${String(variables.month).padStart(2, '0')} using reference ${variables.anchorDate} (${variables.anchorDay} day).`
      );
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to generate a new table.');
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

  const volunteerForShiftMutation = useMutation({
    mutationFn: async (payload: {
      assignment: EditableAssignment;
      targetSNumber: string;
      reason: string;
      autoApprove: boolean;
      mode: 'volunteer' | 'remove' | 'assign';
    }) => {
      const submitResult = await submitShiftExchange(
        payload.assignment.date,
        payload.assignment.period,
        payload.assignment.shiftSlotKey,
        payload.assignment.effectiveWorkerSNumber,
        payload.targetSNumber,
        payload.reason,
        'manager_schedule'
      );
      if (!submitResult.ok) throw new Error(`${submitResult.error.message} (${submitResult.correlationId})`);

      if (payload.autoApprove) {
        const approveResult = await approveShiftExchange(submitResult.data.id);
        if (!approveResult.ok) throw new Error(`${approveResult.error.message} (${approveResult.correlationId})`);
      }

      return submitResult.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hr-schedule'] });
      queryClient.invalidateQueries({
        queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
      });
      queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] });
      queryClient.invalidateQueries({ queryKey: ['hr-schedule-table-index'] });
      setShiftActionModalUid(null);
      setEmptySlotTarget(null);
      setAssignmentTargetSNumber('');
      if (!variables.autoApprove) {
        setMessage('Volunteer request submitted for approval.');
        return;
      }

      if (variables.mode === 'remove') {
        setMessage('Removed you from this shift.');
      } else if (variables.mode === 'volunteer') {
        setMessage('You are now signed up for this shift.');
      } else {
        setMessage(
          variables.targetSNumber === variables.assignment.effectiveWorkerSNumber
            ? 'No change: this employee is already assigned.'
            : 'Shift assignment confirmed.'
        );
      }
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to volunteer for this shift.');
    }
  });

  const manualSlotMutation = useMutation({
    mutationFn: async (payload: {
      mode: 'assign' | 'remove' | 'reassign';
      date: string;
      period: number;
      employeeSNumber: string;
      asAlternate?: boolean;
      shiftSlotKey?: string;
      previousEmployeeSNumber?: string;
    }) => {
      if (payload.mode === 'assign' || payload.mode === 'reassign') {
        if (payload.mode === 'reassign') {
          if (!payload.shiftSlotKey || !payload.previousEmployeeSNumber) {
            throw new Error('shiftSlotKey and previousEmployeeSNumber are required when reassigning a manual slot');
          }
          const { error: deleteError } = await supabase
            .from('shift_attendance')
            .delete()
            .eq('shift_date', payload.date)
            .eq('shift_period', payload.period)
            .eq('shift_slot_key', payload.shiftSlotKey)
            .eq('employee_s_number', payload.previousEmployeeSNumber);
          if (deleteError) throw new Error(deleteError.message);
        }

        const shiftSlotKey = buildManualShiftSlotKey(
          payload.date,
          payload.period,
          payload.employeeSNumber,
          payload.asAlternate === true
        );
        const { error } = await supabase.from('shift_attendance').upsert(
          {
            shift_date: payload.date,
            shift_period: payload.period,
            shift_slot_key: shiftSlotKey,
            employee_s_number: payload.employeeSNumber,
            status: 'expected',
            source: 'manual',
            reason: null,
            marked_by: 'open_access',
            marked_at: new Date().toISOString()
          },
          {
            onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
          }
        );
        if (error) throw new Error(error.message);
        return { ...payload, shiftSlotKey };
      }

      if (!payload.shiftSlotKey) throw new Error('shiftSlotKey is required when removing a manual slot');

      const { error } = await supabase
        .from('shift_attendance')
        .delete()
        .eq('shift_date', payload.date)
        .eq('shift_period', payload.period)
        .eq('shift_slot_key', payload.shiftSlotKey)
        .eq('employee_s_number', payload.employeeSNumber);
      if (error) throw new Error(error.message);
      return payload;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
      });
      setShiftActionModalUid(null);
      setEmptySlotTarget(null);
      setAssignmentTargetSNumber('');
      if (variables.mode === 'remove') {
        setMessage('Removed you from this shift.');
      } else if (isManagerMode) {
        setMessage('Shift assignment confirmed.');
      } else {
        setMessage('You are now signed up for this shift.');
      }
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to update this shift slot.');
    }
  });

  const settingsMap = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of settingsQuery.data ?? []) {
      map.set(row.employee_s_number as string, (row.off_periods as number[]) ?? [4, 8]);
    }
    return map;
  }, [settingsQuery.data]);

  const latestStoredTableByMonth = useMemo(() => {
    const map = new Map<string, GenerationSelection>();
    for (const row of storedTablesQuery.data ?? []) {
      const year = Number(row.year);
      const month = Number(row.month);
      const seed = Number(row.seed);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(seed)) continue;
      const key = toYearMonthKey(year, month);
      if (map.has(key)) continue;
      map.set(key, {
        year,
        month,
        anchorDate: String(row.anchor_date),
        anchorDay: row.anchor_day === 'B' ? 'B' : 'A',
        seed
      });
    }
    return map;
  }, [storedTablesQuery.data]);

  const resolveMonthConfig = (selection: YearMonthSelection): GenerationSelection => {
    const key = toYearMonthKey(selection.year, selection.month);
    return latestStoredTableByMonth.get(key) ?? buildGenerationSelection(selection.year, selection.month);
  };

  const schedule = scheduleQuery.data;

  useEffect(() => {
    if (!schedule) return;
    const loadedConfig: GenerationSelection = {
      year: schedule.meta.year,
      month: schedule.meta.month,
      anchorDate: schedule.meta.anchorDate,
      anchorDay: schedule.meta.anchorDay,
      seed: schedule.meta.seed
    };
    setMonthSelection({ year: loadedConfig.year, month: loadedConfig.month });
    setGenerationSelection(loadedConfig);
    const loadedAssignments = schedule.schedule.map((assignment, index) => ({
      ...assignment,
      uid: `${assignment.date}|${assignment.period}|${assignment.shiftSlotKey}|${assignment.studentSNumber}|${index}`
    }));
    setEditableAssignments(loadedAssignments);
    setSavedAssignmentWorkersByUid(
      Object.fromEntries(
        loadedAssignments.map((assignment) => [assignment.uid, assignment.effectiveWorkerSNumber])
      )
    );
    setActiveWeekIndex(0);
    setDragSourceUid(null);
    setDragTargetUid(null);
    setShiftActionModalUid(null);
    setEmptySlotTarget(null);
    setPendingManualEdits([]);
  }, [schedule]);

  useEffect(() => {
    if (!studentsRosterQuery.data) return;
    const loadedRoster = studentsRosterQuery.data.map((entry, index) => ({
      localId: `roster-${entry.s_number}-${index}`,
      id: entry.id,
      name: entry.name,
      s_number: entry.s_number,
      scheduleable: Boolean(entry.scheduleable),
      Schedule: typeof entry.Schedule === 'number' ? entry.Schedule : 0
    }));
    setEditableRoster(loadedRoster);
    setSavedRosterScheduleableById(
      Object.fromEntries(
        loadedRoster.map((entry) => [rosterSnapshotKey(entry.id), entry.scheduleable])
      )
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

  useEffect(() => {
    if (!schedule) {
      setManualAssignments([]);
      return;
    }

    const scheduledKeys = new Set(
      editableAssignments.map((assignment) =>
        [assignment.date, assignment.period, assignment.shiftSlotKey, assignment.effectiveWorkerSNumber].join('|')
      )
    );

    const nextManualAssignments: EditableAssignment[] = [];
    for (const row of shiftAttendanceQuery.data ?? []) {
      const source = String(row.source ?? '');
      const employeeSNumber = String(row.employee_s_number ?? '');
      const shiftDate = String(row.shift_date ?? '');
      const shiftSlotKey = String(row.shift_slot_key ?? '');
      const period = Number(row.shift_period);
      if (source !== 'manual' || !employeeSNumber || !shiftDate || !shiftSlotKey || !Number.isFinite(period)) {
        continue;
      }

      const dedupeKey = [shiftDate, period, shiftSlotKey, employeeSNumber].join('|');
      if (scheduledKeys.has(dedupeKey)) continue;
      const isManualAlternate = isManualAlternateShiftSlotKey(shiftSlotKey);

      nextManualAssignments.push({
        uid: `manual|${dedupeKey}`,
        date: shiftDate,
        day: schedule.calendar[shiftDate] ?? '',
        period,
        shiftSlotKey,
        studentName: rosterNameBySNumber.get(employeeSNumber) ?? employeeSNumber,
        studentSNumber: employeeSNumber,
        type: isManualAlternate ? 'Alternate' : 'Manual',
        group: 'Manual',
        role: isManualAlternate ? 'alternate employee' : 'employee',
        effectiveWorkerSNumber: employeeSNumber
      });
    }

    setManualAssignments(nextManualAssignments);
  }, [editableAssignments, rosterNameBySNumber, schedule, shiftAttendanceQuery.data]);

  const visibleAssignments = useMemo(
    () => [...editableAssignments, ...manualAssignments],
    [editableAssignments, manualAssignments]
  );

  const assignmentMap = useMemo(() => {
    const map = new Map<string, EditableAssignment[]>();
    for (const assignment of visibleAssignments) {
      const key = `${assignment.date}|${assignment.period}`;
      const bucket = map.get(key) ?? [];
      bucket.push(assignment);
      map.set(key, bucket);
    }
    return map;
  }, [visibleAssignments]);
  const assignmentByUid = useMemo(() => {
    const map = new Map<string, EditableAssignment>();
    for (const assignment of visibleAssignments) {
      map.set(assignment.uid, assignment);
    }
    return map;
  }, [visibleAssignments]);

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
  const requestedEmployeeSNumber = (searchParams.get('employee') ?? '').trim();
  const requestedAccessMode = (searchParams.get('access') ?? '').trim().toLowerCase();

  useEffect(() => {
    if (!canChangeAccessMode) {
      if (scheduleAccessMode !== 'employee') setScheduleAccessMode('employee');
      return;
    }

    if (requestedAccessMode === 'manager' || requestedAccessMode === 'employee') {
      const nextMode = requestedAccessMode as AccessMode;
      if (scheduleAccessMode !== nextMode) setScheduleAccessMode(nextMode);
    }
  }, [canChangeAccessMode, requestedAccessMode, scheduleAccessMode]);

  useEffect(() => {
    if (isManagerMode || !isSwapModeEnabled) return;
    setIsSwapModeEnabled(false);
    setDragSourceUid(null);
    setDragTargetUid(null);
  }, [isManagerMode, isSwapModeEnabled]);

  useEffect(() => {
    if (actingEmployeeOptions.length === 0) {
      if (actingEmployeeSNumber) setActingEmployeeSNumber('');
      return;
    }

    const allowedValues = new Set(actingEmployeeOptions.map((item) => item.value));
    if (requestedEmployeeSNumber && allowedValues.has(requestedEmployeeSNumber)) {
      if (actingEmployeeSNumber !== requestedEmployeeSNumber) {
        setActingEmployeeSNumber(requestedEmployeeSNumber);
      }
      return;
    }

    if (!actingEmployeeSNumber || !allowedValues.has(actingEmployeeSNumber)) {
      setActingEmployeeSNumber(actingEmployeeOptions[0].value);
    }
  }, [actingEmployeeOptions, actingEmployeeSNumber, requestedEmployeeSNumber]);

  const canEmployeeWorkPeriod = useCallback(
    (employeeSNumber: string, period: number): boolean => {
      const rosterMeta = rosterMetaBySNumber.get(employeeSNumber);
      if (!rosterMeta || !rosterMeta.scheduleable) return false;
      if (period === 0) return true;
      const offPeriods = settingsMap.get(employeeSNumber) ?? [4, 8];
      return rosterMeta.classPeriod === period || offPeriods.includes(period);
    },
    [rosterMetaBySNumber, settingsMap]
  );

  const isEmployeeOffPeriod = useCallback(
    (employeeSNumber: string, period: number): boolean => {
      const offPeriods = settingsMap.get(employeeSNumber) ?? [4, 8];
      return offPeriods.includes(period);
    },
    [settingsMap]
  );

  const isOpenVolunteerAssignment = useCallback(
    (assignment: EditableAssignment): boolean => {
      if (assignment.period === 0) return true;
      return isEmployeeOffPeriod(assignment.effectiveWorkerSNumber, assignment.period);
    },
    [isEmployeeOffPeriod]
  );

  const canEmployeeTakeAssignment = useCallback(
    (employeeSNumber: string, assignment: EditableAssignment): boolean => {
      const rosterMeta = rosterMetaBySNumber.get(employeeSNumber);
      if (!rosterMeta || !rosterMeta.scheduleable) return false;
      if (assignment.period === 0) return true;
      if (isEmployeeOffPeriod(assignment.effectiveWorkerSNumber, assignment.period)) return true;
      return rosterMeta.classPeriod === assignment.period || isEmployeeOffPeriod(employeeSNumber, assignment.period);
    },
    [isEmployeeOffPeriod, rosterMetaBySNumber]
  );

  const canEmployeeSelfSignUpForPeriod = useCallback(
    (employeeSNumber: string, date: string, period: number): boolean => {
      const rosterMeta = rosterMetaBySNumber.get(employeeSNumber);
      if (!rosterMeta || !rosterMeta.scheduleable) return false;
      if (isWeekendDateKey(date)) return false;
      if (period === 0) return true;
      return isEmployeeOffPeriod(employeeSNumber, period);
    },
    [isEmployeeOffPeriod, rosterMetaBySNumber]
  );

  const getShiftAssignments = useCallback(
    (date: string, period: number): EditableAssignment[] => assignmentMap.get(`${date}|${period}`) ?? [],
    [assignmentMap]
  );

  const getShiftSlotCapacity = useCallback(
    (date: string, period: number) => {
      const assignments = getShiftAssignments(date, period);
      const alternateCount = assignments.filter((assignment) => isAlternateAssignment(assignment)).length;
      const regularCount = assignments.length - alternateCount;
      return {
        assignments,
        regularCount,
        alternateCount,
        openRegularSlots: Math.max(0, MAX_REGULAR_ASSIGNMENTS_PER_SHIFT - regularCount),
        openAlternateSlots: Math.max(0, MAX_ALTERNATE_ASSIGNMENTS_PER_SHIFT - alternateCount)
      };
    },
    [getShiftAssignments]
  );

  const resolveOpenSlotMode = useCallback(
    (date: string, period: number): 'regular' | 'alternate' | null => {
      const { openRegularSlots, openAlternateSlots } = getShiftSlotCapacity(date, period);
      if (openRegularSlots > 0) return 'regular';
      if (openAlternateSlots > 0) return 'alternate';
      return null;
    },
    [getShiftSlotCapacity]
  );

  const canAssignEmployeeToOpenSlot = useCallback(
    (employeeSNumber: string, date: string, period: number): boolean => {
      if (!employeeSNumber) return false;
      if (isWeekendDateKey(date)) return false;
      if (!canEmployeeWorkPeriod(employeeSNumber, period)) return false;
      const { assignments } = getShiftSlotCapacity(date, period);
      const openSlotMode = resolveOpenSlotMode(date, period);
      if (!openSlotMode) return false;
      return !assignments.some((assignment) => assignment.effectiveWorkerSNumber === employeeSNumber);
    },
    [canEmployeeWorkPeriod, getShiftSlotCapacity, resolveOpenSlotMode]
  );

  const getDraggedEmployeeSNumber = useCallback(
    (rawPayload: string): string | null => {
      if (!rawPayload) return null;
      if (rawPayload.startsWith('roster:')) {
        const employeeSNumber = rawPayload.slice('roster:'.length).trim();
        return employeeSNumber || null;
      }
      const assignmentUid = parseDraggedAssignmentUid(rawPayload);
      if (!assignmentUid) return null;
      return assignmentByUid.get(assignmentUid)?.effectiveWorkerSNumber ?? null;
    },
    [assignmentByUid]
  );

  const canSwapAssignments = (sourceUid: string, targetUid: string): boolean => {
    if (!sourceUid || !targetUid || sourceUid === targetUid) return false;
    const source = assignmentByUid.get(sourceUid);
    const target = assignmentByUid.get(targetUid);
    if (!source || !target) return false;
    if (isManualShiftSlotKey(source.shiftSlotKey) || isManualShiftSlotKey(target.shiftSlotKey)) return false;
    if (source.date === target.date && source.period === target.period) return false;

    const sourceWorkerCanTakeTarget = canEmployeeWorkPeriod(source.effectiveWorkerSNumber, target.period);
    const targetWorkerCanTakeSource = canEmployeeWorkPeriod(target.effectiveWorkerSNumber, source.period);
    return sourceWorkerCanTakeTarget && targetWorkerCanTakeSource;
  };

  const summaryRows = useMemo(
    () => buildSummaryFromAssignments(visibleAssignments, rosterNameBySNumber),
    [rosterNameBySNumber, visibleAssignments]
  );
  const canExpandScheduleOverview = Boolean(
    schedule &&
      (editableRoster.length > COLLAPSED_ROSTER_SUMMARY_ROWS ||
        summaryRows.length > COLLAPSED_ROSTER_SUMMARY_ROWS ||
        schedule.statistics.length > 4 ||
        schedule.balanceAnalysis.length > 4)
  );
  const changedAssignmentRows = useMemo(
    () => {
      const rawChanges = editableAssignments
        .map((assignment) => {
          const fromWorker = savedAssignmentWorkersByUid[assignment.uid];
          if (!fromWorker || fromWorker === assignment.effectiveWorkerSNumber) return null;
          return {
            assignment,
            fromWorker,
            toWorker: assignment.effectiveWorkerSNumber
          };
        })
        .filter((value): value is { assignment: EditableAssignment; fromWorker: string; toWorker: string } =>
          Boolean(value)
        );

      if (rawChanges.length === 0) return rawChanges;

      const byShift = new Map<string, typeof rawChanges>();
      for (const change of rawChanges) {
        const key = `${change.assignment.date}|${change.assignment.period}`;
        const bucket = byShift.get(key) ?? [];
        bucket.push(change);
        byShift.set(key, bucket);
      }

      const ignoredUids = new Set<string>();
      for (const [shiftKey] of byShift) {
        const [date, periodRaw] = shiftKey.split('|');
        const period = Number(periodRaw);
        if (!date || !Number.isFinite(period)) continue;
        const groupAssignments = editableAssignments.filter(
          (assignment) => assignment.date === date && assignment.period === period
        );
        const currentWorkers = groupAssignments
          .map((assignment) => assignment.effectiveWorkerSNumber)
          .sort();
        const savedWorkers = groupAssignments
          .map((assignment) => savedAssignmentWorkersByUid[assignment.uid] ?? assignment.effectiveWorkerSNumber)
          .sort();
        if (currentWorkers.join('|') !== savedWorkers.join('|')) continue;
        for (const assignment of groupAssignments) {
          ignoredUids.add(assignment.uid);
        }
      }

      return rawChanges.filter((change) => !ignoredUids.has(change.assignment.uid));
    },
    [editableAssignments, savedAssignmentWorkersByUid]
  );
  const changedRosterRows = useMemo(
    () =>
      editableRoster
        .map((entry) => {
          const key = rosterSnapshotKey(entry.id);
          const savedValue = savedRosterScheduleableById[key];
          if (savedValue === undefined || savedValue === entry.scheduleable) return null;
          return {
            id: entry.id,
            key,
            name: entry.name,
            scheduleable: entry.scheduleable
          };
        })
        .filter((value): value is { id: number | string; key: string; name: string; scheduleable: boolean } =>
          Boolean(value)
        ),
    [editableRoster, savedRosterScheduleableById]
  );
  const hasUnsavedChanges =
    changedAssignmentRows.length > 0 || changedRosterRows.length > 0 || pendingManualEdits.length > 0;

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

  const selectedShiftActionAssignment = useMemo(
    () => visibleAssignments.find((assignment) => assignment.uid === shiftActionModalUid) ?? null,
    [shiftActionModalUid, visibleAssignments]
  );
  const isShiftActionModalOpen = Boolean(selectedShiftActionAssignment || emptySlotTarget);
  const selectedShiftActionAttendanceStatus = useMemo(() => {
    if (!selectedShiftActionAssignment) return 'expected' as ShiftAttendanceStatus;
    const key = [
      selectedShiftActionAssignment.date,
      selectedShiftActionAssignment.period,
      selectedShiftActionAssignment.shiftSlotKey,
      selectedShiftActionAssignment.effectiveWorkerSNumber
    ].join('|');
    return normalizeAttendanceStatus(attendanceByAssignmentKey.get(key)?.status);
  }, [attendanceByAssignmentKey, selectedShiftActionAssignment]);
  const selectedShiftIsManualAssignment = Boolean(
    selectedShiftActionAssignment && isManualShiftSlotKey(selectedShiftActionAssignment.shiftSlotKey)
  );
  const selectedActionDate = selectedShiftActionAssignment?.date ?? emptySlotTarget?.date ?? '';
  const selectedActionIsWeekend = selectedActionDate ? isWeekendDateKey(selectedActionDate) : false;
  const selectedActionPeriod = selectedShiftActionAssignment?.period ?? emptySlotTarget?.period ?? null;
  const managerAssignableOptions = useMemo(() => {
    if (selectedActionIsWeekend) return [];
    if (selectedShiftActionAssignment) {
      return actingEmployeeOptions.filter((option) =>
        canEmployeeTakeAssignment(option.value, selectedShiftActionAssignment)
      );
    }
    if (emptySlotTarget) {
      return actingEmployeeOptions.filter((option) =>
        canAssignEmployeeToOpenSlot(option.value, emptySlotTarget.date, emptySlotTarget.period)
      );
    }
    return [];
  }, [
    actingEmployeeOptions,
    canAssignEmployeeToOpenSlot,
    canEmployeeTakeAssignment,
    emptySlotTarget,
    selectedActionIsWeekend,
    selectedShiftActionAssignment
  ]);
  const filteredManagerAssignableOptions = useMemo(() => {
    const term = managerAssigneeSearch.trim().toLowerCase();
    if (!term) return managerAssignableOptions;
    return managerAssignableOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(term) || option.value.toLowerCase().includes(term)
    );
  }, [managerAssigneeSearch, managerAssignableOptions]);
  const selectedShiftSupportsOpenVolunteer = Boolean(
    selectedShiftActionAssignment && isOpenVolunteerAssignment(selectedShiftActionAssignment)
  );
  const currentEmployeeCanVolunteerSelectedShift = Boolean(
    actingEmployeeSNumber &&
      ((selectedShiftActionAssignment &&
        selectedShiftSupportsOpenVolunteer &&
        selectedShiftActionAttendanceStatus === 'expected' &&
        actingEmployeeSNumber !== selectedShiftActionAssignment.effectiveWorkerSNumber &&
        canEmployeeSelfSignUpForPeriod(
          actingEmployeeSNumber,
          selectedShiftActionAssignment.date,
          selectedShiftActionAssignment.period
        )) ||
        (emptySlotTarget &&
          canEmployeeSelfSignUpForPeriod(
            actingEmployeeSNumber,
            emptySlotTarget.date,
            emptySlotTarget.period
          )))
  );
  const currentEmployeeOwnsSelectedShift = Boolean(
    selectedShiftActionAssignment &&
      actingEmployeeSNumber &&
      actingEmployeeSNumber === selectedShiftActionAssignment.effectiveWorkerSNumber
  );
  const currentEmployeeCanRemoveSelfSelectedShift = Boolean(
    selectedShiftActionAssignment &&
      currentEmployeeOwnsSelectedShift &&
      selectedShiftActionAttendanceStatus === 'expected' &&
      (selectedShiftIsManualAssignment ||
        selectedShiftActionAssignment.effectiveWorkerSNumber !== selectedShiftActionAssignment.studentSNumber)
  );
  const canEditSelectedShiftAttendance = Boolean(
    selectedShiftActionAssignment && (isManagerMode || currentEmployeeOwnsSelectedShift)
  );

  useEffect(() => {
    if (!selectedShiftActionAssignment && !emptySlotTarget) {
      if (assignmentTargetSNumber) setAssignmentTargetSNumber('');
      return;
    }

    if (!isManagerMode) {
      setAssignmentTargetSNumber(actingEmployeeSNumber);
      return;
    }

    const available = new Set(managerAssignableOptions.map((option) => option.value));
    if (available.size === 0) {
      if (assignmentTargetSNumber) setAssignmentTargetSNumber('');
      return;
    }

    if (available.has(assignmentTargetSNumber)) return;
    if (selectedShiftActionAssignment && available.has(selectedShiftActionAssignment.effectiveWorkerSNumber)) {
      setAssignmentTargetSNumber(selectedShiftActionAssignment.effectiveWorkerSNumber);
      return;
    }
    setAssignmentTargetSNumber(managerAssignableOptions[0].value);
  }, [
    actingEmployeeSNumber,
    assignmentTargetSNumber,
    emptySlotTarget,
    isManagerMode,
    managerAssignableOptions,
    selectedShiftActionAssignment
  ]);

  useEffect(() => {
    if (!isShiftActionModalOpen || isManagerMode) return;
    if (!selectedShiftActionAssignment) {
      if (shiftActionChoice !== 'volunteer') setShiftActionChoice('volunteer');
      return;
    }
    if (currentEmployeeCanVolunteerSelectedShift) {
      if (shiftActionChoice !== 'volunteer') setShiftActionChoice('volunteer');
      return;
    }
    if (currentEmployeeCanRemoveSelfSelectedShift && shiftActionChoice !== 'remove') {
      setShiftActionChoice('remove');
    }
  }, [
    currentEmployeeCanRemoveSelfSelectedShift,
    currentEmployeeCanVolunteerSelectedShift,
    isShiftActionModalOpen,
    isManagerMode,
    selectedShiftActionAssignment,
    shiftActionChoice
  ]);

  useEffect(() => {
    setAttendanceReason('');
    setManagerAssigneeSearch('');
  }, [emptySlotTarget, shiftActionModalUid]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = LEAVE_WITH_UNSAVED_CHANGES_MESSAGE;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const todayKey = getTodayDateKey();
  const selectedShiftDayPassed = selectedActionDate ? isDateBeforeToday(selectedActionDate, todayKey) : false;

  const targetYearMonthLabel = `${generationSelection.year}-${String(generationSelection.month).padStart(2, '0')}`;
  const openMonthLabel = `${monthSelection.year}-${String(monthSelection.month).padStart(2, '0')}`;

  const confirmDiscardUnsavedChanges = (): boolean => {
    if (!hasUnsavedChanges) return true;
    return window.confirm(LEAVE_WITH_UNSAVED_CHANGES_MESSAGE);
  };

  const handleApplyMonthSelection = () => {
    if (!confirmDiscardUnsavedChanges()) return;
    const nextConfig = resolveMonthConfig(monthSelection);
    setGenerationSelection(nextConfig);
    setParams(buildScheduleParams(nextConfig));
    setMessage(`Opened schedule table for ${openMonthLabel}.`);
  };

  const handleGenerationMonthOrYearChange = (nextSelection: YearMonthSelection) => {
    const resolved = resolveMonthConfig(nextSelection);
    setGenerationSelection(resolved);
  };

  const handleSaveChanges = async () => {
    if (!hasUnsavedChanges || isPersistingEdits) return;
    let savedAssignmentCount = 0;
    let savedRosterCount = 0;
    let savedManualCount = 0;
    const nextSavedRosterScheduleableById = { ...savedRosterScheduleableById };
    const nextSavedAssignmentWorkersByUid = { ...savedAssignmentWorkersByUid };
    setIsPersistingEdits(true);
    try {
      for (const change of changedRosterRows) {
        const { error } = await supabase
          .from('students')
          .update({ scheduleable: change.scheduleable })
          .eq('id', change.id);
        if (error) {
          throw new Error(`Failed to update roster for ${change.name}: ${error.message}`);
        }
        nextSavedRosterScheduleableById[change.key] = change.scheduleable;
        savedRosterCount += 1;
      }

      for (const change of changedAssignmentRows) {
        const submitResult = await submitShiftExchange(
          change.assignment.date,
          change.assignment.period,
          change.assignment.shiftSlotKey,
          change.fromWorker,
          change.toWorker,
          'Saved schedule edits',
          'manager_schedule'
        );
        if (!submitResult.ok) {
          throw new Error(`${submitResult.error.message} (${submitResult.correlationId})`);
        }
        const approveResult = await approveShiftExchange(submitResult.data.id);
        if (!approveResult.ok) {
          throw new Error(`${approveResult.error.message} (${approveResult.correlationId})`);
        }
        nextSavedAssignmentWorkersByUid[change.assignment.uid] = change.toWorker;
        savedAssignmentCount += 1;
      }

      for (const edit of pendingManualEdits) {
        if (edit.mode === 'assign') {
          const shiftSlotKey = buildManualShiftSlotKey(
            edit.date,
            edit.period,
            edit.employeeSNumber,
            edit.asAlternate
          );
          const { error } = await supabase.from('shift_attendance').upsert(
            {
              shift_date: edit.date,
              shift_period: edit.period,
              shift_slot_key: shiftSlotKey,
              employee_s_number: edit.employeeSNumber,
              status: 'expected',
              source: 'manual',
              reason: null,
              marked_by: 'open_access',
              marked_at: new Date().toISOString()
            },
            {
              onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
            }
          );
          if (error) throw new Error(error.message);
          savedManualCount += 1;
          continue;
        }

        const { error } = await supabase
          .from('shift_attendance')
          .delete()
          .eq('shift_date', edit.date)
          .eq('shift_period', edit.period)
          .eq('shift_slot_key', edit.shiftSlotKey)
          .eq('employee_s_number', edit.employeeSNumber);
        if (error) throw new Error(error.message);
        savedManualCount += 1;
      }

      setSavedRosterScheduleableById(nextSavedRosterScheduleableById);
      setSavedAssignmentWorkersByUid(nextSavedAssignmentWorkersByUid);
      setPendingManualEdits([]);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['hr-schedule'] }),
        queryClient.invalidateQueries({
          queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
        }),
        queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['hr-schedule-table-index'] }),
        queryClient.invalidateQueries({ queryKey: ['hr-schedule-students-roster'] })
      ]);

      const savedParts: string[] = [];
      if (savedAssignmentCount > 0) savedParts.push(`${savedAssignmentCount} assignment update(s)`);
      if (savedRosterCount > 0) savedParts.push(`${savedRosterCount} roster update(s)`);
      if (savedManualCount > 0) savedParts.push(`${savedManualCount} manual shift update(s)`);
      setMessage(`Saved changes: ${savedParts.join(', ')}.`);
      setIsSwapModeEnabled(false);
      setDragSourceUid(null);
      setDragTargetUid(null);
    } catch (error) {
      if (savedAssignmentCount > 0 || savedRosterCount > 0 || savedManualCount > 0) {
        setSavedRosterScheduleableById(nextSavedRosterScheduleableById);
        setSavedAssignmentWorkersByUid(nextSavedAssignmentWorkersByUid);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['hr-schedule'] }),
          queryClient.invalidateQueries({
            queryKey: ['hr-schedule-shift-attendance', selectedMonthRange.from, selectedMonthRange.to]
          }),
          queryClient.invalidateQueries({ queryKey: ['hr-shift-requests'] }),
          queryClient.invalidateQueries({ queryKey: ['hr-schedule-students-roster'] })
        ]);
      }
      const fallbackMessage = 'Unable to save changes.';
      const errorMessage = error instanceof Error ? error.message : fallbackMessage;
      if (savedAssignmentCount > 0 || savedRosterCount > 0 || savedManualCount > 0) {
        setMessage(
          `Partially saved (${savedAssignmentCount} assignment, ${savedRosterCount} roster, ${savedManualCount} manual). ${errorMessage}`
        );
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setIsPersistingEdits(false);
    }
  };

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

  const handleDropRosterEmployeeOnAssignment = (
    targetAssignment: EditableAssignment,
    employeeSNumber: string
  ) => {
    if (!employeeSNumber) return;
    if (targetAssignment.effectiveWorkerSNumber === employeeSNumber) {
      setMessage('No change: this employee is already assigned.');
      return;
    }
    if (!canEmployeeTakeAssignment(employeeSNumber, targetAssignment)) {
      setMessage(
        'Drop blocked: employee is not eligible for this shift (must be morning, class period, or configured off-period).'
      );
      return;
    }
    const periodAssignments = getShiftAssignments(targetAssignment.date, targetAssignment.period);
    const alreadyAssignedInShift = periodAssignments.some(
      (assignment) =>
        assignment.uid !== targetAssignment.uid &&
        assignment.effectiveWorkerSNumber === employeeSNumber
    );
    if (alreadyAssignedInShift) {
      setMessage('Drop blocked: employee is already assigned in this shift.');
      return;
    }

    if (isManualShiftSlotKey(targetAssignment.shiftSlotKey)) {
      const asAlternate = isAlternateAssignment(targetAssignment);
      stageManualRemove({
        date: targetAssignment.date,
        period: targetAssignment.period,
        shiftSlotKey: targetAssignment.shiftSlotKey,
        employeeSNumber: targetAssignment.effectiveWorkerSNumber
      });
      stageManualAssign({
        date: targetAssignment.date,
        period: targetAssignment.period,
        employeeSNumber,
        asAlternate
      });
      setMessage('Manual assignment updated. Save changes to persist.');
      return;
    }

    setEditableAssignments((previous) =>
      previous.map((assignment) =>
        assignment.uid === targetAssignment.uid
          ? { ...assignment, effectiveWorkerSNumber: employeeSNumber }
          : assignment
      )
    );
    setMessage('Assignment updated. Save changes to persist.');
  };

  const closeShiftActionModal = () => {
    setShiftActionModalUid(null);
    setEmptySlotTarget(null);
    setManagerAssigneeSearch('');
  };

  const stageManualAssign = (payload: {
    date: string;
    period: number;
    employeeSNumber: string;
    asAlternate: boolean;
  }) => {
    const shiftSlotKey = buildManualShiftSlotKey(
      payload.date,
      payload.period,
      payload.employeeSNumber,
      payload.asAlternate
    );
    setManualAssignments((previous) => {
      const dedupeKey = `${payload.date}|${payload.period}|${shiftSlotKey}|${payload.employeeSNumber}`;
      if (
        previous.some(
          (entry) =>
            `${entry.date}|${entry.period}|${entry.shiftSlotKey}|${entry.effectiveWorkerSNumber}` === dedupeKey
        )
      ) {
        return previous;
      }
      const displayName = rosterNameBySNumber.get(payload.employeeSNumber) ?? payload.employeeSNumber;
      return [
        ...previous,
        {
          uid: `manual|${payload.date}|${payload.period}|${shiftSlotKey}|${payload.employeeSNumber}`,
          date: payload.date,
          day: schedule?.calendar[payload.date] ?? '',
          period: payload.period,
          shiftSlotKey,
          studentName: displayName,
          studentSNumber: payload.employeeSNumber,
          type: payload.asAlternate ? 'Alternate' : 'Manual',
          group: 'Manual',
          role: payload.asAlternate ? 'alternate employee' : 'employee',
          effectiveWorkerSNumber: payload.employeeSNumber
        }
      ];
    });
    setPendingManualEdits((previous) => [
      ...previous,
      {
        mode: 'assign',
        date: payload.date,
        period: payload.period,
        employeeSNumber: payload.employeeSNumber,
        asAlternate: payload.asAlternate
      }
    ]);
  };

  const stageManualRemove = (payload: {
    date: string;
    period: number;
    shiftSlotKey: string;
    employeeSNumber: string;
  }) => {
    setManualAssignments((previous) =>
      previous.filter(
        (entry) =>
          !(
            entry.date === payload.date &&
            entry.period === payload.period &&
            entry.shiftSlotKey === payload.shiftSlotKey &&
            entry.effectiveWorkerSNumber === payload.employeeSNumber
          )
      )
    );
    setPendingManualEdits((previous) => [
      ...previous,
      {
        mode: 'remove',
        date: payload.date,
        period: payload.period,
        shiftSlotKey: payload.shiftSlotKey,
        employeeSNumber: payload.employeeSNumber
      }
    ]);
  };

  const handleSubmitShiftAction = () => {
    if (!isManagerMode) {
      if (!actingEmployeeSNumber) {
        setMessage('No active employee context was found for sign-up.');
        return;
      }

      if (shiftActionChoice === 'volunteer') {
        if (selectedShiftActionAssignment) {
          if (!currentEmployeeCanVolunteerSelectedShift) {
            setMessage('You can only sign up on weekdays for morning shifts and your configured off-periods.');
            return;
          }
          volunteerForShiftMutation.mutate({
            assignment: selectedShiftActionAssignment,
            targetSNumber: actingEmployeeSNumber,
            reason: 'Self-volunteered for shift',
            autoApprove: hasScheduleEditPermission,
            mode: 'volunteer'
          });
          return;
        }

        if (
          !emptySlotTarget ||
          !canEmployeeSelfSignUpForPeriod(
            actingEmployeeSNumber,
            emptySlotTarget.date,
            emptySlotTarget.period
          )
        ) {
          setMessage('You can only sign up for weekday morning shifts or your configured off-periods.');
          return;
        }
        if (!canAssignEmployeeToOpenSlot(actingEmployeeSNumber, emptySlotTarget.date, emptySlotTarget.period)) {
          setMessage('This shift is full (max 3 regular + 1 alternate) or you are already assigned.');
          return;
        }
        const emptySlotMode = resolveOpenSlotMode(emptySlotTarget.date, emptySlotTarget.period);
        if (!emptySlotMode) {
          setMessage('This shift is full (max 3 regular + 1 alternate).');
          return;
        }
        manualSlotMutation.mutate({
          mode: 'assign',
          date: emptySlotTarget.date,
          period: emptySlotTarget.period,
          employeeSNumber: actingEmployeeSNumber,
          asAlternate: emptySlotMode === 'alternate'
        });
        return;
      }

      if (!currentEmployeeCanRemoveSelfSelectedShift) {
        setMessage('You can only remove yourself from a shift you currently volunteered for.');
        return;
      }
      if (!selectedShiftActionAssignment) return;

      if (selectedShiftIsManualAssignment) {
        manualSlotMutation.mutate({
          mode: 'remove',
          date: selectedShiftActionAssignment.date,
          period: selectedShiftActionAssignment.period,
          shiftSlotKey: selectedShiftActionAssignment.shiftSlotKey,
          employeeSNumber: selectedShiftActionAssignment.effectiveWorkerSNumber
        });
      } else {
        volunteerForShiftMutation.mutate({
          assignment: selectedShiftActionAssignment,
          targetSNumber: selectedShiftActionAssignment.studentSNumber,
          reason: 'Self-removed from volunteered shift',
          autoApprove: hasScheduleEditPermission,
          mode: 'remove'
        });
      }
      return;
    }

    if (!assignmentTargetSNumber) {
      setMessage('Select an employee to assign.');
      return;
    }

    if (selectedActionIsWeekend) {
      setMessage('Assignments are disabled on Saturdays and Sundays.');
      return;
    }

    if (selectedShiftActionAssignment) {
      if (assignmentTargetSNumber === selectedShiftActionAssignment.effectiveWorkerSNumber) {
        setMessage('No change: this employee is already assigned.');
        return;
      }

      if (selectedShiftIsManualAssignment) {
        const asAlternate = isAlternateAssignment(selectedShiftActionAssignment);
        stageManualRemove({
          date: selectedShiftActionAssignment.date,
          period: selectedShiftActionAssignment.period,
          shiftSlotKey: selectedShiftActionAssignment.shiftSlotKey,
          employeeSNumber: selectedShiftActionAssignment.effectiveWorkerSNumber
        });
        stageManualAssign({
          date: selectedShiftActionAssignment.date,
          period: selectedShiftActionAssignment.period,
          employeeSNumber: assignmentTargetSNumber,
          asAlternate
        });
        closeShiftActionModal();
        setMessage('Manual assignment updated. Save changes to persist.');
        return;
      }

      setEditableAssignments((previous) =>
        previous.map((assignment) =>
          assignment.uid === selectedShiftActionAssignment.uid
            ? { ...assignment, effectiveWorkerSNumber: assignmentTargetSNumber }
            : assignment
        )
      );
      closeShiftActionModal();
      setMessage('Assignment updated. Save changes to persist.');
      return;
    }

    if (!emptySlotTarget) return;
    if (!canAssignEmployeeToOpenSlot(assignmentTargetSNumber, emptySlotTarget.date, emptySlotTarget.period)) {
      setMessage(
        'Selected employee is not eligible for this period, already assigned, or this shift has reached capacity (3 regular + 1 alternate).'
      );
      return;
    }
    const emptySlotMode = resolveOpenSlotMode(emptySlotTarget.date, emptySlotTarget.period);
    if (!emptySlotMode) {
      setMessage('This shift is full (max 3 regular + 1 alternate).');
      return;
    }
    stageManualAssign({
      date: emptySlotTarget.date,
      period: emptySlotTarget.period,
      employeeSNumber: assignmentTargetSNumber,
      asAlternate: emptySlotMode === 'alternate'
    });
    closeShiftActionModal();
    setMessage('Manual assignment added. Save changes to persist.');
  };

  return (
    <section className="space-y-4">
      {message && <p className="text-sm text-brand-maroon">{message}</p>}
      {scheduleQuery.isLoading && <p className="text-sm text-neutral-600">Loading schedule...</p>}
      {scheduleQuery.error && <p className="text-sm text-red-700">{(scheduleQuery.error as Error).message}</p>}

      {schedule && (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-300 bg-neutral-50 p-2">
              <h3 className="text-sm font-semibold">Schedule — {monthTitle}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {isManagerMode && (
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
                    {isSwapModeEnabled ? 'Drag to switch/assign' : 'Enable Drag Mode'}
                  </button>
                )}
                {canChangeAccessMode && (
                  <button
                    className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!hasUnsavedChanges || isPersistingEdits}
                    onClick={() => {
                      void handleSaveChanges();
                    }}
                    type="button"
                  >
                    {isPersistingEdits ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
                {hasUnsavedChanges && (
                  <p className="text-xs text-brand-maroon">
                    Unsaved changes: {changedAssignmentRows.length} assignment, {changedRosterRows.length} roster,{' '}
                    {pendingManualEdits.length} manual.
                  </p>
                )}
                {canChangeAccessMode && (
                  <label className="text-xs text-neutral-700">
                    Access
                    <select
                      className="ml-2 min-h-[36px] border border-neutral-300 px-2 text-sm"
                      onChange={(event) => setScheduleAccessMode(event.target.value as AccessMode)}
                      value={scheduleAccessMode}
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                )}
                {!isManagerMode && (
                  <label className="text-xs text-neutral-700">
                    Acting employee
                    <select
                      className="ml-2 min-h-[36px] border border-neutral-300 px-2 text-sm"
                      disabled={actingEmployeeOptions.length === 0}
                      onChange={(event) => setActingEmployeeSNumber(event.target.value)}
                      value={actingEmployeeSNumber}
                    >
                      {actingEmployeeOptions.length === 0 && <option value="">No schedulable employees</option>}
                      {actingEmployeeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="text-xs text-neutral-700">
                  Open month
                  <span className="ml-2 inline-flex items-center gap-2">
                    <input
                      className="min-h-[36px] w-24 border border-neutral-300 px-2 text-sm"
                      max={2100}
                      min={2000}
                      onChange={(event) =>
                        setMonthSelection((previous) => ({
                          ...previous,
                          year: Number(event.target.value) || previous.year
                        }))
                      }
                      type="number"
                      value={monthSelection.year}
                    />
                    <select
                      className="min-h-[36px] border border-neutral-300 px-2 text-sm"
                      onChange={(event) =>
                        setMonthSelection((previous) => ({
                          ...previous,
                          month: Number(event.target.value)
                        }))
                      }
                      value={monthSelection.month}
                    >
                      {MONTH_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="min-h-[36px] border border-neutral-500 px-2 text-xs"
                      onClick={handleApplyMonthSelection}
                      type="button"
                    >
                      Open
                    </button>
                  </span>
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
                        const isWeekend = isWeekendDateKey(day.dateKey);
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
                        const targetPeriod = resolvePeriodForDay(periodBand.periods, dayType);
                        const {
                          openRegularSlots: targetOpenRegularSlots,
                          openAlternateSlots: targetOpenAlternateSlots
                        } = getShiftSlotCapacity(day.dateKey, targetPeriod);
                        const canShowOpenSlotButton =
                          day.inCurrentMonth &&
                          !isWeekend &&
                          (targetOpenRegularSlots > 0 || targetOpenAlternateSlots > 0);

                        return (
                          <td className={`border-b border-neutral-300 p-2 align-top ${baseCellTone}`} key={`${day.dateKey}-${periodBand.id}`}>
                            {!day.inCurrentMonth && <span className="text-[11px] text-neutral-400">—</span>}
                            {day.inCurrentMonth && assignments.length === 0 && isWeekend && (
                              <p className="min-h-[44px] border border-dashed border-neutral-300 px-2 py-2 text-left text-[11px] text-neutral-500">
                                Weekend unavailable
                              </p>
                            )}
                            {day.inCurrentMonth && assignments.length > 0 && (
                              <div className="space-y-1">
                                {assignments.map((assignment) => {
                                  const offPeriods = settingsMap.get(assignment.effectiveWorkerSNumber) ?? [4, 8];
                                  const isOffPeriod = offPeriods.includes(assignment.period);
                                  const savedWorker = savedAssignmentWorkersByUid[assignment.uid];
                                  const hasUnsavedWorkerChange =
                                    Boolean(savedWorker) && savedWorker !== assignment.effectiveWorkerSNumber;
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
                                  const isDragTarget = dragTargetUid === assignment.uid;
                                  const isValidDropTarget = dragSourceUid
                                    ? canSwapAssignments(dragSourceUid, assignment.uid)
                                    : true;
                                  const isManualAssignment = isManualShiftSlotKey(assignment.shiftSlotKey);

                                  return (
                                    <div
                                      className={`${isSwapModeEnabled && !isManualAssignment ? 'cursor-grab' : 'cursor-pointer'} border p-1 ${isAlternate ? 'border-sky-400 bg-sky-100/80' : 'border-neutral-300 bg-white/90'} ${
                                        isDragTarget ? 'ring-2 ring-brand-maroon' : ''
                                      } ${dragSourceUid && !isValidDropTarget ? 'opacity-60' : ''}`}
                                      draggable={isSwapModeEnabled && !isManualAssignment}
                                      key={assignment.uid}
                                      onClick={() => {
                                        if (isSwapModeEnabled) return;
                                        setShiftActionModalUid(assignment.uid);
                                        setEmptySlotTarget(null);
                                      }}
                                      onDragEnd={() => {
                                        if (!isSwapModeEnabled || isManualAssignment) return;
                                        setDragSourceUid(null);
                                        setDragTargetUid(null);
                                      }}
                                      onDragOver={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled) return;
                                        const rawPayload = event.dataTransfer.getData('text/plain');
                                        const draggedEmployeeSNumber = getDraggedEmployeeSNumber(rawPayload);
                                        if (draggedEmployeeSNumber) {
                                          if (!canEmployeeTakeAssignment(draggedEmployeeSNumber, assignment)) return;
                                          event.preventDefault();
                                          setDragTargetUid(assignment.uid);
                                          return;
                                        }
                                        if (isManualAssignment) return;
                                        event.preventDefault();
                                        if (dragSourceUid && dragSourceUid !== assignment.uid) {
                                          setDragTargetUid(
                                            canSwapAssignments(dragSourceUid, assignment.uid) ? assignment.uid : null
                                          );
                                        }
                                      }}
                                      onDragStart={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled || isManualAssignment) return;
                                        setDragSourceUid(assignment.uid);
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', `assignment:${assignment.uid}`);
                                      }}
                                      onDrop={(event: DragEvent<HTMLDivElement>) => {
                                        if (!isSwapModeEnabled) return;
                                        event.preventDefault();
                                        const rawPayload = event.dataTransfer.getData('text/plain');
                                        const draggedEmployeeSNumber = getDraggedEmployeeSNumber(rawPayload);
                                        if (draggedEmployeeSNumber) {
                                          handleDropRosterEmployeeOnAssignment(assignment, draggedEmployeeSNumber);
                                          setDragSourceUid(null);
                                          setDragTargetUid(null);
                                          return;
                                        }

                                        if (isManualAssignment) return;
                                        const sourceUid = parseDraggedAssignmentUid(rawPayload) || dragSourceUid;
                                        if (sourceUid) {
                                          if (!canSwapAssignments(sourceUid, assignment.uid)) {
                                            const sourceAssignment = assignmentByUid.get(sourceUid);
                                            if (
                                              sourceAssignment &&
                                              sourceAssignment.date === assignment.date &&
                                              sourceAssignment.period === assignment.period
                                            ) {
                                              setMessage(
                                                'Reordering within the same shift does not count as a swap.'
                                              );
                                            } else {
                                              setMessage(
                                                'Swap blocked: employees can only be moved into periods where they are eligible (class period or off period).'
                                              );
                                            }
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
                                        {hasUnsavedWorkerChange && (
                                          <span className="border border-brand-maroon px-1 text-[10px] text-brand-maroon">
                                            Unsaved
                                          </span>
                                        )}
                                        {isOffPeriod && (
                                          <span className="border border-neutral-500 px-1 text-[10px] text-neutral-700">
                                            Off-period
                                          </span>
                                        )}
                                        {isManualAssignment && (
                                          <span className="border border-emerald-500 bg-emerald-100 px-1 text-[10px] text-emerald-800">
                                            Manual
                                          </span>
                                        )}
                                        <span
                                          className={`border px-1 text-[10px] uppercase ${attendanceStatusClasses(attendanceStatus)}`}
                                        >
                                          {attendanceStatus === 'excused' ? 'pardoned' : attendanceStatus}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {canShowOpenSlotButton && (
                              <button
                                className="mt-1 min-h-[44px] w-full border border-dashed border-brand-maroon px-2 py-2 text-left text-[11px] text-brand-maroon hover:bg-brand-maroon/5"
                                onClick={() => {
                                  setEmptySlotTarget({ date: day.dateKey, period: targetPeriod });
                                  setShiftActionModalUid(null);
                                }}
                                onDragOver={(event: DragEvent<HTMLButtonElement>) => {
                                  if (!isManagerMode || !isSwapModeEnabled || manualSlotMutation.isPending) return;
                                  const draggedEmployeeSNumber = getDraggedEmployeeSNumber(
                                    event.dataTransfer.getData('text/plain')
                                  );
                                  if (
                                    !draggedEmployeeSNumber ||
                                    !canAssignEmployeeToOpenSlot(draggedEmployeeSNumber, day.dateKey, targetPeriod)
                                  ) {
                                    return;
                                  }
                                  event.preventDefault();
                                }}
                                onDrop={(event: DragEvent<HTMLButtonElement>) => {
                                  if (!isManagerMode || !isSwapModeEnabled || manualSlotMutation.isPending) return;
                                  event.preventDefault();
                                  const draggedEmployeeSNumber = getDraggedEmployeeSNumber(
                                    event.dataTransfer.getData('text/plain')
                                  );
                                  if (!draggedEmployeeSNumber) {
                                    setMessage('Drop failed: unable to determine the employee.');
                                    return;
                                  }
                                  if (!canAssignEmployeeToOpenSlot(draggedEmployeeSNumber, day.dateKey, targetPeriod)) {
                                    setMessage(
                                      'Drop blocked: employee is not eligible, already assigned, or this shift is full.'
                                    );
                                    return;
                                  }
                                  const openSlotMode = resolveOpenSlotMode(day.dateKey, targetPeriod);
                                  if (!openSlotMode) {
                                    setMessage('Drop blocked: this shift is full.');
                                    return;
                                  }
                                  stageManualAssign({
                                    date: day.dateKey,
                                    period: targetPeriod,
                                    employeeSNumber: draggedEmployeeSNumber,
                                    asAlternate: openSlotMode === 'alternate'
                                  });
                                  setMessage('Manual assignment added. Save changes to persist.');
                                  setDragSourceUid(null);
                                  setDragTargetUid(null);
                                }}
                                type="button"
                              >
                                Open spot ({targetOpenRegularSlots} regular left
                                {targetOpenAlternateSlots > 0 ? `, ${targetOpenAlternateSlots} alternate left` : ''})
                              </button>
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

          <div className="relative">
            <div
              className={`grid gap-4 md:grid-cols-2 ${
                !isRosterSummaryExpanded && canExpandScheduleOverview
                  ? `${COLLAPSED_OVERVIEW_MAX_HEIGHT_CLASS} overflow-hidden`
                  : ''
              }`}
            >
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
                    <tr
                      className={`border-b border-neutral-200 ${isManagerMode && isSwapModeEnabled ? 'cursor-grab' : ''}`}
                      draggable={isManagerMode && isSwapModeEnabled}
                      key={entry.localId}
                      onDragEnd={() => {
                        if (!isManagerMode || !isSwapModeEnabled) return;
                        setDragSourceUid(null);
                        setDragTargetUid(null);
                      }}
                      onDragStart={(event: DragEvent<HTMLTableRowElement>) => {
                        if (!isManagerMode || !isSwapModeEnabled) return;
                        event.dataTransfer.effectAllowed = 'copyMove';
                        event.dataTransfer.setData('text/plain', `roster:${entry.s_number}`);
                      }}
                    >
                      <td className="p-2">{entry.name}</td>
                      <td className="p-2">{entry.s_number}</td>
                      <td className="p-2">
                        <label className="flex items-center gap-2">
                          <input
                            checked={entry.scheduleable}
                            disabled={isPersistingEdits}
                            onChange={(event) => {
                              const nextValue = event.target.checked;
                              setEditableRoster((previous) =>
                                previous.map((item) =>
                                  item.localId === entry.localId
                                    ? { ...item, scheduleable: nextValue }
                                    : item
                                )
                              );
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
              <div className="space-y-4">
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

                <div className="grid gap-3 border border-neutral-300 bg-white p-3 md:grid-cols-2">
                <div className="border border-neutral-300 p-3">
                  <p className="text-xs text-neutral-500">Generated at</p>
                  <p className="text-sm font-medium">{new Date(schedule.meta.generatedAt).toLocaleString()}</p>
                </div>
                <div className="border border-neutral-300 p-3">
                  <p className="text-xs text-neutral-500">Assignments</p>
                  <p className="text-sm font-medium">{visibleAssignments.length}</p>
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

                <div className="border border-neutral-300">
                <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Statistics</h3>
                <div className="p-2 text-sm">
                  {schedule.statistics.map((stat) => (
                    <p key={stat.metric}>
                      {stat.metric}: {stat.value}
                    </p>
                  ))}
                </div>
                </div>

                <div className="border border-neutral-300">
                <h3 className="border-b border-neutral-300 bg-neutral-50 p-2 text-sm font-semibold">Balance Analysis</h3>
                <div className="p-2 text-sm">
                  {schedule.balanceAnalysis.map((item) => (
                    <p key={`${item.category}-${item.metric}`}>
                      {item.category} — {item.metric}: {item.value}
                    </p>
                  ))}
                </div>
                </div>
              </div>
            </div>
            {!isRosterSummaryExpanded && canExpandScheduleOverview && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
            )}
          </div>
          {canExpandScheduleOverview && (
            <div className="flex justify-end">
              <button
                className="min-h-[44px] border border-neutral-300 px-3 text-sm hover:bg-neutral-100"
                onClick={() => setIsRosterSummaryExpanded((previous) => !previous)}
                type="button"
              >
                {isRosterSummaryExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
          )}

          <section className="space-y-3 border border-neutral-300 bg-neutral-50 p-3">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-sm">
                Year
                <input
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  max={2100}
                  min={2000}
                  onChange={(event) =>
                    handleGenerationMonthOrYearChange({
                      year: Number(event.target.value) || generationSelection.year,
                      month: generationSelection.month
                    })
                  }
                  type="number"
                  value={generationSelection.year}
                />
              </label>
              <label className="text-sm">
                Month
                <select
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    handleGenerationMonthOrYearChange({
                      year: generationSelection.year,
                      month: Number(event.target.value)
                    })
                  }
                  value={generationSelection.month}
                >
                  {MONTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Reference date
                <input
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setGenerationSelection((previous) => ({
                      ...previous,
                      anchorDate: event.target.value || previous.anchorDate
                    }))
                  }
                  type="date"
                  value={generationSelection.anchorDate}
                />
              </label>
              <label className="text-sm">
                Reference day
                <select
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setGenerationSelection((previous) => ({
                      ...previous,
                      anchorDay: event.target.value === 'B' ? 'B' : 'A'
                    }))
                  }
                  value={generationSelection.anchorDay}
                >
                  <option value="A">A Day</option>
                  <option value="B">B Day</option>
                </select>
              </label>
            </div>
            <button
              className="min-h-[44px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={manualRefresh.isPending}
              onClick={() => {
                if (!confirmDiscardUnsavedChanges()) return;
                setIsGenerateConfirmOpen(true);
              }}
              type="button"
            >
              Generate New Table
            </button>
            <p className="text-xs text-neutral-600">
              Generation is month-specific. Creating a new month table does not delete other months; use Open month to switch.
            </p>
            <p className="text-xs text-neutral-600">
              Reference date/day are editable here. The values you set are used for the next generated table.
            </p>
            <p className="text-xs text-neutral-600">Seed is auto-generated each time you create a new table.</p>
          </section>
        </div>
      )}

      {isShiftActionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg border border-neutral-400 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">{isManagerMode ? 'Assign Shift' : 'Shift Sign-Up'}</h3>
                <p className="mt-1 text-sm text-neutral-700">
                  {selectedShiftActionAssignment
                    ? (rosterNameBySNumber.get(selectedShiftActionAssignment.effectiveWorkerSNumber) ??
                      selectedShiftActionAssignment.effectiveWorkerSNumber)
                    : 'Open slot'}{' '}
                  • {selectedActionDate} {selectedActionPeriod !== null ? `• P${selectedActionPeriod}` : ''}
                </p>
              </div>
              <button
                className="min-h-[36px] border border-neutral-500 px-2 text-sm"
                onClick={closeShiftActionModal}
                type="button"
              >
                Close
              </button>
            </div>

            {selectedShiftActionAssignment && (
              <p className="mt-3 text-sm text-neutral-700">
                Current status:{' '}
                <span className="font-medium">
                  {selectedShiftActionAttendanceStatus === 'excused'
                    ? 'pardoned'
                    : selectedShiftActionAttendanceStatus}
                </span>
              </p>
            )}
            {selectedShiftSupportsOpenVolunteer && (
              <p className="mt-2 text-xs text-neutral-600">
                Open slot: this shift is morning or off-period for the current worker, so eligible employees can volunteer.
              </p>
            )}
            {!selectedShiftActionAssignment && (
              <p className="mt-2 text-xs text-neutral-600">
                Open slot: assign an employee directly for this date/period.
              </p>
            )}
            {selectedActionIsWeekend && (
              <p className="mt-2 text-xs text-neutral-600">
                Assigning and volunteering are disabled on Saturdays and Sundays.
              </p>
            )}

            {isManagerMode ? (
              <div className="mt-3 space-y-3">
                <label className="block text-sm">
                  Search employee
                  <input
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    onChange={(event) => setManagerAssigneeSearch(event.target.value)}
                    placeholder="Type name or s_number"
                    value={managerAssigneeSearch}
                  />
                </label>
                <label className="block text-sm">
                  Assign to employee
                  <select
                    className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                    disabled={
                      selectedActionIsWeekend ||
                      filteredManagerAssignableOptions.length === 0 ||
                      volunteerForShiftMutation.isPending ||
                      manualSlotMutation.isPending
                    }
                    onChange={(event) => setAssignmentTargetSNumber(event.target.value)}
                    value={assignmentTargetSNumber}
                  >
                    {filteredManagerAssignableOptions.length === 0 && (
                      <option value="">No eligible employees</option>
                    )}
                    {filteredManagerAssignableOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex justify-end gap-2">
                  {selectedShiftActionAssignment && (
                    <button
                      className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                      onClick={() => {
                        if (!selectedShiftActionAssignment) return;
                        if (!isManualShiftSlotKey(selectedShiftActionAssignment.shiftSlotKey)) {
                          setMessage('Only manual/open-slot assignments can be removed.');
                          return;
                        }
                        stageManualRemove({
                          date: selectedShiftActionAssignment.date,
                          period: selectedShiftActionAssignment.period,
                          shiftSlotKey: selectedShiftActionAssignment.shiftSlotKey,
                          employeeSNumber: selectedShiftActionAssignment.effectiveWorkerSNumber
                        });
                        closeShiftActionModal();
                        setMessage('Manual assignment removed. Save changes to persist.');
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  )}
                  <button
                    className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                    onClick={closeShiftActionModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-40"
                    disabled={
                      selectedActionIsWeekend ||
                      volunteerForShiftMutation.isPending ||
                      manualSlotMutation.isPending ||
                      !assignmentTargetSNumber ||
                      (selectedShiftActionAssignment
                        ? assignmentTargetSNumber === selectedShiftActionAssignment.effectiveWorkerSNumber
                        : false)
                    }
                    onClick={handleSubmitShiftAction}
                    type="button"
                  >
                    Assign
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {!actingEmployeeSNumber && (
                  <p className="text-sm text-neutral-700">No active employee context is set for self sign-up.</p>
                )}
                {actingEmployeeSNumber && (
                  <>
                    <label className="block text-sm">
                      Action
                      <select
                        className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                        onChange={(event) => setShiftActionChoice(event.target.value as ShiftActionChoice)}
                        value={shiftActionChoice}
                      >
                        <option disabled={!currentEmployeeCanVolunteerSelectedShift} value="volunteer">
                          Volunteer me for this shift
                        </option>
                        <option disabled={!currentEmployeeCanRemoveSelfSelectedShift} value="remove">
                          Remove me from this shift
                        </option>
                      </select>
                    </label>
                    {!currentEmployeeCanVolunteerSelectedShift && shiftActionChoice === 'volunteer' && (
                      <p className="text-sm text-neutral-700">
                        Volunteer is only available on weekdays for morning shifts and your configured off-periods.
                      </p>
                    )}
                    {!currentEmployeeCanRemoveSelfSelectedShift && shiftActionChoice === 'remove' && (
                      <p className="text-sm text-neutral-700">
                        Remove is only available when you are the current volunteer on this shift.
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                        onClick={closeShiftActionModal}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:opacity-40"
                        disabled={
                          volunteerForShiftMutation.isPending ||
                          manualSlotMutation.isPending ||
                          (shiftActionChoice === 'volunteer' && !currentEmployeeCanVolunteerSelectedShift) ||
                          (shiftActionChoice === 'remove' && !currentEmployeeCanRemoveSelfSelectedShift)
                        }
                        onClick={handleSubmitShiftAction}
                        type="button"
                      >
                        {shiftActionChoice === 'remove' ? 'Remove me' : 'Sign me up'}
                      </button>
                    </div>
                  </>
                )}
                {!actingEmployeeSNumber && (
                    <div className="flex justify-end">
                      <button
                        className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                        onClick={closeShiftActionModal}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  )}
              </div>
            )}

            {selectedShiftActionAssignment && (
              <div className="mt-4 border-t border-neutral-200 pt-3">
                <p className="text-sm font-medium text-neutral-900">Attendance</p>
                {!canEditSelectedShiftAttendance && (
                  <p className="mt-2 text-sm text-neutral-700">
                    You can only edit attendance for your own shift entries.
                  </p>
                )}
                {canEditSelectedShiftAttendance && (
                  <>
                    <label className="mt-2 block text-sm">
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
                        disabled={updateAttendanceMutation.isPending || !selectedShiftDayPassed}
                        onClick={() =>
                          updateAttendanceMutation.mutate({
                            assignment: selectedShiftActionAssignment,
                            status: 'present'
                          })
                        }
                        type="button"
                      >
                        Mark Present
                      </button>
                      <button
                        className="min-h-[44px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={updateAttendanceMutation.isPending || !selectedShiftDayPassed}
                        onClick={() =>
                          updateAttendanceMutation.mutate({
                            assignment: selectedShiftActionAssignment,
                            status: 'absent'
                          })
                        }
                        type="button"
                      >
                        Mark Absent
                      </button>
                    </div>
                    {!selectedShiftDayPassed && (
                      <p className="mt-2 text-xs text-neutral-600">
                        Present/absent updates are only allowed after the shift date has passed.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {isGenerateConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-lg border border-neutral-400 bg-white p-4">
            <h3 className="text-base font-semibold text-neutral-900">Confirm Table Generation</h3>
            <p className="mt-2 text-sm text-neutral-700">
              Generate a fresh table for this month and reference point. Other month tables are kept and can still be opened.
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              Target month: <span className="font-medium">{targetYearMonthLabel}</span>
            </p>
            <p className="mt-2 text-sm text-neutral-700">
              Reference: <span className="font-medium">{generationSelection.anchorDate}</span> (
              <span className="font-medium">{generationSelection.anchorDay}</span> day)
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
                  if (!confirmDiscardUnsavedChanges()) return;
                  const nextSeed = generateScheduleSeed();
                  const nextGenerationSelection = { ...generationSelection, seed: nextSeed };
                  const nextParams = buildScheduleParams(nextGenerationSelection);
                  setGenerationSelection(nextGenerationSelection);
                  setParams(nextParams);
                  setMonthSelection({ year: generationSelection.year, month: generationSelection.month });
                  manualRefresh.mutate(nextParams);
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
