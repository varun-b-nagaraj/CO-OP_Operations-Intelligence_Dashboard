'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { DepartmentShell } from '@/app/_components/department-shell';
import { Select } from '@/app/_components/ui/select';
import { submitShiftExchange } from '@/app/actions/shift-requests';
import { submitStrikeAppeal } from '@/app/actions/strike-appeals';
import { fetchMeetingAttendance, fetchSchedule } from '@/lib/api-client';
import { ScheduleTab } from '@/app/hr/_components/schedule-tab';

import { getStudentDisplayName, getStudentSNumber, StudentRow, useBrowserSupabase } from '@/app/hr/_components/utils';

type EmployeeTabId = 'schedule' | 'accountability' | 'requests';
type ShiftRequestAssignment = {
  date: string;
  period: number;
  shiftSlotKey: string;
  fromSNumber: string;
  label: string;
};

const EMPLOYEE_S_NUMBER_SESSION_KEY = 'employee_dashboard_s_number_v1';

function toMonthSelection(date: Date): { year: number; month: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateRangeForMonth(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(1)}%`;
}

function formatPeriodDisplay(period: unknown): string {
  const parsed = Number(period);
  if (Number.isFinite(parsed) && parsed === 0) return 'Morning Shift';
  return `P${String(period)}`;
}

export function EmployeeModule() {
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<EmployeeTabId>('schedule');
  const [sNumberInput, setSNumberInput] = useState('');
  const [sessionSNumber, setSessionSNumber] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [monthSelection, setMonthSelection] = useState(() => toMonthSelection(new Date()));
  const [requestAssignmentKey, setRequestAssignmentKey] = useState('');
  const [requestToSNumber, setRequestToSNumber] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [appealStrikeId, setAppealStrikeId] = useState('');
  const [appealReason, setAppealReason] = useState('');

  const [accountabilityRange, setAccountabilityRange] = useState(() => ({
    from: `${new Date().getUTCFullYear()}-01-01`,
    to: todayKey()
  }));

  useEffect(() => {
    try {
      const cached = window.sessionStorage.getItem(EMPLOYEE_S_NUMBER_SESSION_KEY);
      if (cached) {
        setSessionSNumber(cached);
        setSNumberInput(cached);
      }
    } catch {
      // no-op
    }
  }, []);

  const studentQuery = useQuery({
    queryKey: ['employee-student', sessionSNumber],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('s_number', sessionSNumber)
        .maybeSingle();
      if (error || !data) throw new Error('Employee was not found for that s_number.');
      return data as StudentRow;
    }
  });

  const employeeSettingsQuery = useQuery({
    queryKey: ['employee-settings', sessionSNumber],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_employee_settings')
        .select('*')
        .eq('employee_s_number', sessionSNumber)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { off_periods?: number[] | null } | null) ?? null;
    }
  });

  const allStudentsQuery = useQuery({
    queryKey: ['employee-all-students'],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('*');
      if (error) throw new Error(error.message);
      return (data ?? []) as StudentRow[];
    }
  });

  const allSettingsQuery = useQuery({
    queryKey: ['employee-all-settings'],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase.from('hr_employee_settings').select('employee_s_number,off_periods');
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ employee_s_number: string; off_periods: number[] | null }>;
    }
  });

  const scheduleConfigQuery = useQuery({
    queryKey: ['employee-schedule-config', monthSelection.year, monthSelection.month],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_schedules')
        .select('year,month,anchor_date,anchor_day,seed')
        .eq('year', monthSelection.year)
        .eq('month', monthSelection.month)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) throw new Error('No schedule configuration exists for this month yet.');
      return data as {
        year: number;
        month: number;
        anchor_date: string;
        anchor_day: 'A' | 'B';
        seed: number;
      };
    }
  });

  const scheduleQuery = useQuery({
    queryKey: [
      'employee-schedule',
      monthSelection.year,
      monthSelection.month,
      scheduleConfigQuery.data?.anchor_date,
      scheduleConfigQuery.data?.anchor_day,
      scheduleConfigQuery.data?.seed,
      sessionSNumber
    ],
    enabled: Boolean(sessionSNumber && scheduleConfigQuery.data),
    queryFn: async () => {
      const config = scheduleConfigQuery.data;
      if (!config) return null;
      const result = await fetchSchedule({
        year: monthSelection.year,
        month: monthSelection.month,
        anchorDate: config.anchor_date,
        anchorDay: config.anchor_day,
        seed: config.seed
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const shiftRequestHistoryQuery = useQuery({
    queryKey: ['employee-shift-request-history', sessionSNumber],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_shift_change_requests')
        .select('*')
        .eq('from_employee_s_number', sessionSNumber)
        .order('requested_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const strikeQuery = useQuery({
    queryKey: ['employee-strikes', studentQuery.data?.id],
    enabled: Boolean(studentQuery.data?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_strikes')
        .select('*')
        .eq('employee_id', String(studentQuery.data?.id))
        .order('issued_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const appealHistoryQuery = useQuery({
    queryKey: ['employee-appeal-history', studentQuery.data?.id],
    enabled: Boolean(studentQuery.data?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_strike_appeals')
        .select('*')
        .eq('employee_id', String(studentQuery.data?.id))
        .order('requested_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const shiftAttendanceQuery = useQuery({
    queryKey: ['employee-shift-attendance', sessionSNumber, accountabilityRange.from, accountabilityRange.to],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_shift_attendance')
        .select('*')
        .eq('employee_s_number', sessionSNumber)
        .gte('shift_date', accountabilityRange.from)
        .lte('shift_date', accountabilityRange.to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const morningAttendanceQuery = useQuery({
    queryKey: ['employee-morning-attendance', sessionSNumber, accountabilityRange.from, accountabilityRange.to],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_morning_shift_attendance')
        .select('*')
        .eq('employee_s_number', sessionSNumber)
        .gte('shift_date', accountabilityRange.from)
        .lte('shift_date', accountabilityRange.to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const offPeriodAttendanceQuery = useQuery({
    queryKey: ['employee-off-period-attendance', sessionSNumber, accountabilityRange.from, accountabilityRange.to],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hr_off_period_shift_attendance')
        .select('*')
        .eq('employee_s_number', sessionSNumber)
        .gte('shift_date', accountabilityRange.from)
        .lte('shift_date', accountabilityRange.to);
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  });

  const meetingAttendanceQuery = useQuery({
    queryKey: ['employee-meeting-attendance', sessionSNumber, accountabilityRange.from, accountabilityRange.to],
    enabled: Boolean(sessionSNumber),
    queryFn: async () => {
      const result = await fetchMeetingAttendance({
        from: accountabilityRange.from,
        to: accountabilityRange.to
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    }
  });

  const studentNameBySNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allStudentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(row);
      if (!sNumber) continue;
      map.set(sNumber, getStudentDisplayName(row));
    }
    return map;
  }, [allStudentsQuery.data]);

  const offPeriods = useMemo(() => {
    const values = employeeSettingsQuery.data?.off_periods;
    if (!Array.isArray(values) || values.length === 0) return [4, 8];
    return values.filter((value) => Number.isInteger(value) && value >= 1 && value <= 8);
  }, [employeeSettingsQuery.data]);

  const classPeriod = useMemo(() => {
    const value = studentQuery.data?.Schedule ?? studentQuery.data?.schedule ?? null;
    return toNumber(value);
  }, [studentQuery.data]);

  const ownAssignments = useMemo(() => {
    const sNumber = sessionSNumber ?? '';
    return (scheduleQuery.data?.schedule ?? [])
      .filter((assignment) => assignment.effectiveWorkerSNumber === sNumber)
      .sort((left, right) => {
        const leftKey = `${left.date}|${String(left.period).padStart(2, '0')}`;
        const rightKey = `${right.date}|${String(right.period).padStart(2, '0')}`;
        return leftKey.localeCompare(rightKey);
      });
  }, [scheduleQuery.data?.schedule, sessionSNumber]);

  const coworkersByDatePeriod = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of scheduleQuery.data?.schedule ?? []) {
      const key = `${row.date}|${row.period}`;
      const bucket = map.get(key) ?? [];
      const name = studentNameBySNumber.get(row.effectiveWorkerSNumber) ?? row.studentName;
      if (!bucket.includes(name)) bucket.push(name);
      map.set(key, bucket);
    }
    return map;
  }, [scheduleQuery.data?.schedule, studentNameBySNumber]);

  const requestableAssignments = useMemo<ShiftRequestAssignment[]>(() => {
    const today = todayKey();
    return ownAssignments
      .filter((assignment) => assignment.date >= today)
      .filter((assignment) => assignment.period > 0)
      .filter((assignment) => !offPeriods.includes(assignment.period))
      .map((assignment) => ({
        date: assignment.date,
        period: assignment.period,
        shiftSlotKey: assignment.shiftSlotKey,
        fromSNumber: assignment.effectiveWorkerSNumber,
        label: `${assignment.date} - Period ${assignment.period} (${assignment.shiftSlotKey})`
      }));
  }, [offPeriods, ownAssignments]);

  useEffect(() => {
    if (requestableAssignments.length === 0) {
      setRequestAssignmentKey('');
      return;
    }
    const exists = requestableAssignments.some((assignment) => assignment.shiftSlotKey === requestAssignmentKey);
    if (!exists) setRequestAssignmentKey(requestableAssignments[0].shiftSlotKey);
  }, [requestAssignmentKey, requestableAssignments]);

  const offPeriodsBySNumber = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const row of allSettingsQuery.data ?? []) {
      const sNumber = String(row.employee_s_number ?? '').trim();
      if (!sNumber) continue;
      const periods = Array.isArray(row.off_periods)
        ? row.off_periods.filter((value) => Number.isInteger(value) && value >= 1 && value <= 8)
        : [4, 8];
      map.set(sNumber, periods.length > 0 ? periods : [4, 8]);
    }
    return map;
  }, [allSettingsQuery.data]);

  const replacementOptions = useMemo(() => {
    const assignment = requestableAssignments.find((item) => item.shiftSlotKey === requestAssignmentKey);
    if (!assignment) return [] as Array<{ value: string; label: string }>;

    const rows: Array<{ value: string; label: string }> = [];
    for (const student of allStudentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(student);
      if (!sNumber || sNumber === assignment.fromSNumber) continue;
      const scheduleable = toBoolean(student.scheduleable ?? student.schedulable);
      if (!scheduleable) continue;

      const targetClassPeriod = toNumber(student.Schedule ?? student.schedule);
      const targetOffPeriods = offPeriodsBySNumber.get(sNumber) ?? [4, 8];
      if (targetClassPeriod !== assignment.period && !targetOffPeriods.includes(assignment.period)) continue;

      rows.push({
        value: sNumber,
        label: `${getStudentDisplayName(student)} (${sNumber})`
      });
    }

    rows.sort((left, right) => left.label.localeCompare(right.label));
    return rows;
  }, [allStudentsQuery.data, offPeriodsBySNumber, requestAssignmentKey, requestableAssignments]);

  useEffect(() => {
    if (replacementOptions.length === 0) {
      setRequestToSNumber('');
      return;
    }
    const exists = replacementOptions.some((option) => option.value === requestToSNumber);
    if (!exists) setRequestToSNumber(replacementOptions[0].value);
  }, [replacementOptions, requestToSNumber]);

  const activeStrikeRows = useMemo(
    () => (strikeQuery.data ?? []).filter((row) => row.active === true),
    [strikeQuery.data]
  );

  useEffect(() => {
    if (activeStrikeRows.length === 0) {
      setAppealStrikeId('');
      return;
    }
    const exists = activeStrikeRows.some((row) => String(row.id) === appealStrikeId);
    if (!exists) setAppealStrikeId(String(activeStrikeRows[0].id));
  }, [activeStrikeRows, appealStrikeId]);

  const submitShiftRequestMutation = useMutation({
    mutationFn: async () => {
      const assignment = requestableAssignments.find((item) => item.shiftSlotKey === requestAssignmentKey);
      if (!assignment) throw new Error('Select a shift first.');
      if (!requestToSNumber) throw new Error('Select a replacement employee.');
      if (!requestReason.trim()) throw new Error('Provide a reason.');

      const result = await submitShiftExchange(
        assignment.date,
        assignment.period,
        assignment.shiftSlotKey,
        assignment.fromSNumber,
        requestToSNumber,
        requestReason.trim(),
        'employee_form'
      );
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      setMessage('Shift exchange request submitted to HR.');
      setRequestReason('');
      queryClient.invalidateQueries({ queryKey: ['employee-shift-request-history'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to submit shift request.')
  });

  const submitAppealMutation = useMutation({
    mutationFn: async () => {
      const studentId = String(studentQuery.data?.id ?? '').trim();
      if (!studentId) throw new Error('Your employee record is missing.');
      if (!appealStrikeId) throw new Error('Select a strike/warning to appeal.');
      if (!appealReason.trim()) throw new Error('Provide an appeal reason.');
      if (!sessionSNumber) throw new Error('Not logged in.');

      const result = await submitStrikeAppeal(
        appealStrikeId,
        studentId,
        sessionSNumber,
        appealReason.trim()
      );
      if (!result.ok) throw new Error(result.error.message);
    },
    onSuccess: () => {
      setMessage('Appeal submitted to HR requests.');
      setAppealReason('');
      queryClient.invalidateQueries({ queryKey: ['employee-appeal-history'] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Unable to submit appeal.')
  });

  const accountabilityStats = useMemo(() => {
    const isPresentLike = (status: unknown) => status === 'present' || status === 'excused';

    const allShiftRows = shiftAttendanceQuery.data ?? [];
    const morningRowsFromShift = allShiftRows.filter((row) => Number(row.shift_period) === 0);
    const offRowsFromShift = allShiftRows.filter((row) => offPeriods.includes(Number(row.shift_period)));
    const morningRows =
      (morningAttendanceQuery.data ?? []).length > 0
        ? (morningAttendanceQuery.data ?? [])
        : morningRowsFromShift;
    const offRows =
      (offPeriodAttendanceQuery.data ?? []).length > 0
        ? (offPeriodAttendanceQuery.data ?? [])
        : offRowsFromShift;

    const morningPresent = morningRows.filter((row) => isPresentLike(row.status)).length;
    const offPresent = offRows.filter((row) => isPresentLike(row.status)).length;
    const totalPresent = allShiftRows.filter((row) => isPresentLike(row.status)).length;

    const meetingStudent = (meetingAttendanceQuery.data?.analytics.students ?? []).find(
      (row) => row.s_number === sessionSNumber
    );

    return {
      morningTotal: morningRows.length,
      morningPresent,
      morningRate: morningRows.length === 0 ? 0 : (morningPresent / morningRows.length) * 100,
      offTotal: offRows.length,
      offPresent,
      offRate: offRows.length === 0 ? 0 : (offPresent / offRows.length) * 100,
      shiftTotal: allShiftRows.length,
      shiftPresent: totalPresent,
      shiftRate: allShiftRows.length === 0 ? 0 : (totalPresent / allShiftRows.length) * 100,
      strikes: (strikeQuery.data ?? []).filter((row) => row.record_type !== 'warning' && row.active).length,
      warnings: (strikeQuery.data ?? []).filter((row) => row.record_type === 'warning' && row.active).length,
      meetingsPresent: meetingStudent?.present_count ?? 0,
      meetingsAbsent: meetingStudent?.absent_count ?? 0,
      meetingRate:
        meetingStudent?.adjusted_attendance_rate ??
        meetingStudent?.raw_attendance_rate ??
        meetingStudent?.attendance_rate ??
        0
    };
  }, [
    meetingAttendanceQuery.data?.analytics.students,
    offPeriods,
    morningAttendanceQuery.data,
    offPeriodAttendanceQuery.data,
    sessionSNumber,
    shiftAttendanceQuery.data,
    strikeQuery.data
  ]);

  const navItems = [
    { id: 'schedule', label: 'Schedule', icon: 'schedule' as const },
    { id: 'accountability', label: 'Accountability', icon: 'audit' as const },
    { id: 'requests', label: 'Requests', icon: 'requests' as const }
  ];

  const loginMutation = useMutation({
    mutationFn: async (sNumber: string) => {
      const { data, error } = await supabase.from('students').select('s_number').eq('s_number', sNumber).maybeSingle();
      if (error || !data) throw new Error('No employee found for that s_number.');
      return sNumber;
    },
    onSuccess: (sNumber) => {
      setSessionSNumber(sNumber);
      setLoginError(null);
      setMessage(`Logged in as ${sNumber}.`);
      window.sessionStorage.setItem(EMPLOYEE_S_NUMBER_SESSION_KEY, sNumber);
    },
    onError: (error) => setLoginError(error instanceof Error ? error.message : 'Login failed.')
  });

  const logout = () => {
    setSessionSNumber(null);
    setMessage('Logged out.');
    setSNumberInput('');
    setLoginError(null);
    window.sessionStorage.removeItem(EMPLOYEE_S_NUMBER_SESSION_KEY);
    queryClient.removeQueries({ queryKey: ['employee-student'] });
  };

  if (!sessionSNumber) {
    return (
      <main className="min-h-screen w-full p-6">
        <section className="mx-auto max-w-lg border border-neutral-300 bg-white p-5">
          <h1 className="text-xl font-semibold">General Employee Dashboard</h1>
          <p className="mt-2 text-sm text-neutral-700">Enter your s_number to continue.</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const value = sNumberInput.trim();
              if (!value) {
                setLoginError('Enter your s_number.');
                return;
              }
              loginMutation.mutate(value);
            }}
          >
            <label className="block text-sm">
              s_number
              <input
                className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                onChange={(event) => setSNumberInput(event.target.value)}
                value={sNumberInput}
              />
            </label>
            <button
              className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-4 text-sm font-medium text-white disabled:opacity-40"
              disabled={loginMutation.isPending}
              type="submit"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          {loginError ? <p className="mt-3 text-sm text-red-700">{loginError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <DepartmentShell
      activeNavId={activeTab}
      departmentIcon="employees"
      navAriaLabel="Employee dashboard navigation"
      navItems={navItems}
      onNavSelect={(id) => setActiveTab(id as EmployeeTabId)}
      subtitle="Self-service schedule, attendance, and requests"
      title="Employee Dashboard"
    >
      <section className="min-w-0 overflow-x-hidden border-x border-b border-neutral-300 bg-white">
        <header className="border-b border-neutral-300 bg-white px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {studentQuery.data ? `${getStudentDisplayName(studentQuery.data)} (${sessionSNumber})` : sessionSNumber}
              </h2>
              <p className="text-xs text-neutral-600">
                You can only view and edit your own records. Regular shift removals require HR-approved exchange requests.
              </p>
            </div>
            <button
              className="min-h-[40px] border border-neutral-500 px-3 text-sm"
              onClick={logout}
              type="button"
            >
              Log out
            </button>
          </div>
        </header>

        {message ? <p className="border-b border-neutral-300 px-4 py-2 text-sm text-brand-maroon">{message}</p> : null}

        {activeTab === 'schedule' && (
          <section className="p-4 md:p-6">
            <ScheduleTab forcedAccessMode="employee" lockedEmployeeSNumber={sessionSNumber} />
          </section>
        )}

        {activeTab === 'accountability' && (
          <section className="space-y-4 p-4 md:p-6">
            <div className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-2">
              <label className="text-sm">
                From
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setAccountabilityRange((previous) => ({ ...previous, from: event.target.value }))
                  }
                  type="date"
                  value={accountabilityRange.from}
                />
              </label>
              <label className="text-sm">
                To
                <input
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setAccountabilityRange((previous) => ({ ...previous, to: event.target.value }))
                  }
                  type="date"
                  value={accountabilityRange.to}
                />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">Morning attendance</p>
                <p className="text-sm font-medium">
                  {accountabilityStats.morningPresent}/{accountabilityStats.morningTotal} ({formatPercent(accountabilityStats.morningRate)})
                </p>
              </div>
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">Off-period attendance</p>
                <p className="text-sm font-medium">
                  {accountabilityStats.offPresent}/{accountabilityStats.offTotal} ({formatPercent(accountabilityStats.offRate)})
                </p>
              </div>
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">All shift attendance</p>
                <p className="text-sm font-medium">
                  {accountabilityStats.shiftPresent}/{accountabilityStats.shiftTotal} ({formatPercent(accountabilityStats.shiftRate)})
                </p>
              </div>
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">Meeting attendance</p>
                <p className="text-sm font-medium">
                  {accountabilityStats.meetingsPresent} present, {accountabilityStats.meetingsAbsent} absent ({formatPercent(accountabilityStats.meetingRate)})
                </p>
              </div>
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">Active strikes</p>
                <p className="text-sm font-medium">{accountabilityStats.strikes}</p>
              </div>
              <div className="border border-neutral-300 p-3">
                <p className="text-xs text-neutral-500">Active warnings</p>
                <p className="text-sm font-medium">{accountabilityStats.warnings}</p>
              </div>
            </div>

            <section className="overflow-x-auto border border-neutral-300">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Issued At</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Type</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Reason</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(strikeQuery.data ?? []).map((strike) => (
                    <tr className="border-b border-neutral-200" key={String(strike.id)}>
                      <td className="p-2">{new Date(String(strike.issued_at)).toLocaleString()}</td>
                      <td className="p-2">{String(strike.record_type ?? 'strike')}</td>
                      <td className="p-2">{String(strike.reason ?? '')}</td>
                      <td className="p-2">{strike.active ? 'Active' : 'Inactive'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        )}

        {activeTab === 'requests' && (
          <section className="space-y-4 p-4 md:p-6">
            <section className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-2">
              <h3 className="md:col-span-2 text-sm font-semibold">Shift exchange request (regular shifts only)</h3>
              <label className="text-sm">
                Your shift
                <Select
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setRequestAssignmentKey(event.target.value)}
                  value={requestAssignmentKey}
                >
                  {requestableAssignments.length === 0 ? (
                    <option value="">No requestable regular shifts</option>
                  ) : (
                    requestableAssignments.map((assignment) => (
                      <option key={assignment.shiftSlotKey} value={assignment.shiftSlotKey}>
                        {assignment.label}
                      </option>
                    ))
                  )}
                </Select>
              </label>
              <label className="text-sm">
                Replacement employee
                <Select
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setRequestToSNumber(event.target.value)}
                  value={requestToSNumber}
                >
                  {replacementOptions.length === 0 ? (
                    <option value="">No eligible replacements</option>
                  ) : (
                    replacementOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))
                  )}
                </Select>
              </label>
              <label className="text-sm md:col-span-2">
                Reason
                <textarea
                  className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
                  onChange={(event) => setRequestReason(event.target.value)}
                  value={requestReason}
                />
              </label>
              <div>
                <button
                  className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm text-white disabled:opacity-40"
                  disabled={submitShiftRequestMutation.isPending || requestableAssignments.length === 0}
                  onClick={() => submitShiftRequestMutation.mutate()}
                  type="button"
                >
                  Submit to HR
                </button>
              </div>
            </section>

            <section className="grid gap-3 border border-neutral-300 p-3 md:grid-cols-2">
              <h3 className="md:col-span-2 text-sm font-semibold">Strike/Warning appeal</h3>
              <label className="text-sm">
                Active strike/warning
                <Select
                  className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                  onChange={(event) => setAppealStrikeId(event.target.value)}
                  value={appealStrikeId}
                >
                  {activeStrikeRows.length === 0 ? (
                    <option value="">No active strikes/warnings</option>
                  ) : (
                    activeStrikeRows.map((row) => (
                      <option key={String(row.id)} value={String(row.id)}>
                        {String(row.record_type ?? 'strike')} - {String(row.reason ?? '')}
                      </option>
                    ))
                  )}
                </Select>
              </label>
              <label className="text-sm md:col-span-2">
                Appeal reason
                <textarea
                  className="mt-1 min-h-[88px] w-full border border-neutral-300 p-2"
                  onChange={(event) => setAppealReason(event.target.value)}
                  value={appealReason}
                />
              </label>
              <div>
                <button
                  className="min-h-[40px] border border-brand-maroon bg-brand-maroon px-4 text-sm text-white disabled:opacity-40"
                  disabled={submitAppealMutation.isPending || activeStrikeRows.length === 0}
                  onClick={() => submitAppealMutation.mutate()}
                  type="button"
                >
                  Submit appeal
                </button>
              </div>
            </section>

            <section className="overflow-x-auto border border-neutral-300">
              <header className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium">
                Your shift exchange request history
              </header>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Requested</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Shift</th>
                    <th className="border-b border-neutral-300 p-2 text-left">To</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(shiftRequestHistoryQuery.data ?? []).map((row) => (
                    <tr className="border-b border-neutral-200" key={String(row.id)}>
                      <td className="p-2">{new Date(String(row.requested_at)).toLocaleString()}</td>
                      <td className="p-2">
                        {String(row.shift_date)} {formatPeriodDisplay(row.shift_period)} ({String(row.shift_slot_key)})
                      </td>
                      <td className="p-2">
                        {studentNameBySNumber.get(String(row.to_employee_s_number ?? '')) ??
                          String(row.to_employee_s_number ?? '')}
                      </td>
                      <td className="p-2">{String(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="overflow-x-auto border border-neutral-300">
              <header className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium">
                Your strike appeal history
              </header>
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100">
                  <tr>
                    <th className="border-b border-neutral-300 p-2 text-left">Requested</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Appeal reason</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Status</th>
                    <th className="border-b border-neutral-300 p-2 text-left">Reviewed at</th>
                  </tr>
                </thead>
                <tbody>
                  {(appealHistoryQuery.data ?? []).map((row) => (
                    <tr className="border-b border-neutral-200" key={String(row.id)}>
                      <td className="p-2">{new Date(String(row.requested_at)).toLocaleString()}</td>
                      <td className="p-2">{String(row.reason ?? '')}</td>
                      <td className="p-2">{String(row.status ?? '')}</td>
                      <td className="p-2">
                        {row.reviewed_at ? new Date(String(row.reviewed_at)).toLocaleString() : 'Pending'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </section>
        )}
      </section>
    </DepartmentShell>
  );
}
