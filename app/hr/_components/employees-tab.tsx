'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useState } from 'react';

import {
  clearMeetingOverride,
  markMeetingAbsent,
  overrideMeetingAttendance,
  pardonMeetingAbsence
} from '@/app/actions/attendance';
import { awardPoints } from '@/app/actions/points';
import {
  getEmployeeLoginProfiles,
  updateEmployeeLoginCredentials
} from '@/app/actions/employee-login';
import { addStrike, removeStrike } from '@/app/actions/strikes';
import { updateEmployeeOffPeriods } from '@/app/actions/employee-settings';
import { excuseShiftAbsence, markShiftPresent } from '@/app/actions/shift-attendance';
import { fetchMeetingAttendance } from '@/lib/api-client';
import { usePermission } from '@/lib/permissions';
import { calculateMeetingAttendanceRate, calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { AttendanceOverride } from '@/lib/types';

import {
  formatRate,
  getStudentDisplayName,
  getStudentId,
  getStudentSNumber,
  getTodayDateKey,
  isDateBeforeToday,
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
  shiftRate: number | null;
  meetingSessions: number;
  meetingAttended: number;
  meetingExcused: number;
  meetingRate: number | null;
  points: number;
}

interface EmployeeRecordDraft {
  id: string;
  name: string;
  sNumber: string;
  scheduleable: boolean;
  assignedPeriods: string;
}

type EmployeePanelId =
  | 'overview'
  | 'meeting'
  | 'shift'
  | 'record'
  | 'login'
  | 'offperiods'
  | 'strikes'
  | 'points';

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function buildEmployeeRecordDraft(row: StudentRow): EmployeeRecordDraft {
  return {
    id: getStudentId(row),
    name: getStudentDisplayName(row),
    sNumber: getStudentSNumber(row),
    scheduleable: readBooleanField(row, ['scheduleable', 'schedulable'], true),
    assignedPeriods:
      ((row.assigned_periods as string | undefined) ?? String(row.Schedule ?? row.schedule ?? '')).trim()
  };
}

function shiftRowKey(row: GenericRow): string {
  return `${String(row.shift_date ?? '')}|${String(row.shift_period ?? '')}|${String(row.shift_slot_key ?? '')}`;
}

function getMeetingSessionVisual(status: 'present' | 'absent' | null, overrideType: string | null): {
  label: string;
  badgeClass: string;
} {
  if (overrideType === 'present_override') {
    return {
      label: 'Present (override)',
      badgeClass: 'border-emerald-500 bg-emerald-100 text-emerald-800'
    };
  }
  if (overrideType === 'excused') {
    return {
      label: 'Pardoned',
      badgeClass: 'border-sky-500 bg-sky-100 text-sky-800'
    };
  }
  if (status === 'present') {
    return {
      label: 'Present',
      badgeClass: 'border-emerald-400 bg-emerald-50 text-emerald-700'
    };
  }
  if (status === 'absent') {
    return {
      label: 'Absent',
      badgeClass: 'border-red-400 bg-red-50 text-red-700'
    };
  }
  return {
    label: 'No check-in',
    badgeClass: 'border-neutral-300 bg-neutral-100 text-neutral-700'
  };
}

type FancyOption = {
  value: string;
  label: string;
  meta?: string;
  metaClassName?: string;
};

function FancyDropdown(props: {
  label?: string;
  value: string;
  options: FancyOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = props.options.find((option) => option.value === props.value) ?? null;

  return (
    <div className="space-y-1">
      {props.label && <p className="text-sm text-neutral-800">{props.label}</p>}
      <button
        className="flex min-h-[40px] w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-left text-sm transition-colors hover:border-neutral-500"
        onClick={() => setOpen((previous) => !previous)}
        type="button"
      >
        <span className="truncate">{selected?.label ?? props.placeholder ?? 'Select'}</span>
        <span aria-hidden="true" className="text-xs text-neutral-500">
          {open ? '▴' : '▾'}
        </span>
      </button>
      <div className={`grid transition-all duration-200 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-300 bg-white shadow-md">
            {props.options.length === 0 && <p className="px-3 py-2 text-xs text-neutral-600">No options</p>}
            {props.options.map((option) => (
              <button
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-neutral-100 ${
                  option.value === props.value ? 'bg-neutral-100' : ''
                }`}
                key={option.value}
                onClick={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="font-medium text-neutral-800">{option.label}</span>
                {option.meta && (
                  <span
                    className={`rounded border px-1 py-0.5 ${
                      option.metaClassName ?? 'border-neutral-300 bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {option.meta}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmployeesTab(props: { dateRange: { from: string; to: string } }) {
  const canViewAttendance = usePermission('hr.attendance.view');
  const canOverrideAttendance = usePermission('hr.attendance.override');
  const canEditSettings = usePermission('hr.settings.edit');
  const canManageStrikes = usePermission('hr.strikes.manage');
  const supabase = useBrowserSupabase();
  const queryClient = useQueryClient();
  const range = props.dateRange;
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const [offPeriodDrafts, setOffPeriodDrafts] = useState<Record<string, number[]>>({});
  const [strikeReasonDrafts, setStrikeReasonDrafts] = useState<Record<string, string>>({});
  const [meetingReasonDrafts, setMeetingReasonDrafts] = useState<Record<string, string>>({});
  const [meetingDateDrafts, setMeetingDateDrafts] = useState<Record<string, string>>({});
  const [shiftReasonDrafts, setShiftReasonDrafts] = useState<Record<string, string>>({});
  const [selectedShiftDrafts, setSelectedShiftDrafts] = useState<Record<string, string>>({});
  const [loginUsernameDrafts, setLoginUsernameDrafts] = useState<Record<string, string>>({});
  const [loginPasswordDrafts, setLoginPasswordDrafts] = useState<Record<string, string>>({});
  const [employeeRecordDrafts, setEmployeeRecordDrafts] = useState<Record<string, EmployeeRecordDraft>>({});
  const [newEmployeeDraft, setNewEmployeeDraft] = useState({
    name: '',
    sNumber: '',
    scheduleable: true,
    assignedPeriods: ''
  });
  const [isAddEmployeeModalOpen, setIsAddEmployeeModalOpen] = useState(false);
  const [activePanelByEmployeeId, setActivePanelByEmployeeId] = useState<Record<string, EmployeePanelId>>({});
  const [strikeScopeByEmployeeId, setStrikeScopeByEmployeeId] = useState<Record<string, 'active' | 'all'>>({});
  const [pointsDrafts, setPointsDrafts] = useState<Record<string, { points: string; type: string; note: string }>>({});
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

  useEffect(() => {
    if (!studentsQuery.data) return;
    setEmployeeRecordDrafts((previous) => {
      const next: Record<string, EmployeeRecordDraft> = {};
      for (const student of studentsQuery.data) {
        const id = getStudentId(student);
        if (!id) continue;
        next[id] = previous[id] ?? buildEmployeeRecordDraft(student);
      }
      return next;
    });
  }, [studentsQuery.data]);

  const strikesQuery = useQuery({
    queryKey: ['hr-strikes-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('strikes').select('*');
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

  const loginProfilesQuery = useQuery({
    queryKey: ['hr-login-profiles'],
    enabled: canEditSettings,
    queryFn: async () => {
      const result = await getEmployeeLoginProfiles();
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
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
      queryClient.invalidateQueries({ queryKey: ['hr-strikes-all'] });
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
      queryClient.invalidateQueries({ queryKey: ['hr-strikes-all'] });
      setStatusMessage('Strike removed.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to remove strike.');
    }
  });

  const saveLoginMutation = useMutation({
    mutationFn: async (payload: { employeeId: string; username: string; password: string }) => {
      const result = await updateEmployeeLoginCredentials(
        payload.employeeId,
        payload.username,
        payload.password
      );
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['hr-login-profiles'] });
      setLoginPasswordDrafts((previous) => ({ ...previous, [payload.employeeId]: '' }));
      setStatusMessage(`Updated login credentials for employee ${payload.employeeId}.`);
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to update login credentials.');
    }
  });

  const invalidateEmployeeViews = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-students'] });
    queryClient.invalidateQueries({ queryKey: ['hr-settings-employee-overview'] });
    queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance-for-employees'] });
    queryClient.invalidateQueries({ queryKey: ['hr-meeting-data-for-employees'] });
    queryClient.invalidateQueries({ queryKey: ['hr-meeting-overrides'] });
    queryClient.invalidateQueries({ queryKey: ['hr-points-ledger'] });
    queryClient.invalidateQueries({ queryKey: ['hr-strikes-all'] });
    queryClient.invalidateQueries({ queryKey: ['hr-login-profiles'] });
  };

  const saveEmployeeRecordMutation = useMutation({
    mutationFn: async (employeeId: string) => {
      const sourceRow = (studentsQuery.data ?? []).find((row) => getStudentId(row) === employeeId);
      if (!sourceRow) {
        throw new Error('Employee record not found.');
      }
      const draft = employeeRecordDrafts[employeeId];
      if (!draft) {
        throw new Error('No draft found for employee.');
      }

      const previousSNumber = getStudentSNumber(sourceRow);
      const updatePayload: GenericRow = {};
      const normalizedName = draft.name.trim();
      const normalizedSNumber = draft.sNumber.trim();

      if ('name' in sourceRow || !('full_name' in sourceRow)) updatePayload.name = normalizedName;
      if ('full_name' in sourceRow) updatePayload.full_name = normalizedName;
      if ('student_name' in sourceRow) updatePayload.student_name = normalizedName;
      if ('s_number' in sourceRow || !('student_number' in sourceRow)) updatePayload.s_number = normalizedSNumber;
      if ('student_number' in sourceRow) updatePayload.student_number = normalizedSNumber;
      if ('scheduleable' in sourceRow) updatePayload.scheduleable = draft.scheduleable;
      if ('schedulable' in sourceRow) updatePayload.schedulable = draft.scheduleable;
      if ('assigned_periods' in sourceRow) updatePayload.assigned_periods = draft.assignedPeriods;
      if ('Schedule' in sourceRow) updatePayload.Schedule = draft.assignedPeriods;

      const { error: updateError } = await supabase.from('students').update(updatePayload).eq('id', employeeId);
      if (updateError) {
        throw new Error(updateError.message);
      }

      if (previousSNumber && normalizedSNumber && previousSNumber !== normalizedSNumber) {
        await supabase
          .from('employee_settings')
          .update({ employee_s_number: normalizedSNumber })
          .eq('employee_id', employeeId);
        await supabase.from('shift_attendance').update({ employee_s_number: normalizedSNumber }).eq(
          'employee_s_number',
          previousSNumber
        );
        await supabase.from('attendance_overrides').update({ s_number: normalizedSNumber }).eq(
          's_number',
          previousSNumber
        );
        await supabase.from('shift_change_requests').update({ from_employee_s_number: normalizedSNumber }).eq(
          'from_employee_s_number',
          previousSNumber
        );
        await supabase.from('shift_change_requests').update({ to_employee_s_number: normalizedSNumber }).eq(
          'to_employee_s_number',
          previousSNumber
        );
      }
    },
    onSuccess: () => {
      invalidateEmployeeViews();
      setStatusMessage('Employee record saved.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to save employee record.');
    }
  });

  const addEmployeeRecordMutation = useMutation({
    mutationFn: async (payload: { name: string; sNumber: string; scheduleable: boolean; assignedPeriods: string }) => {
      const referenceRow = (studentsQuery.data ?? [])[0] ?? {};
      const normalizedName = payload.name.trim();
      const normalizedSNumber = payload.sNumber.trim();
      const insertPayload: GenericRow = {};

      if ('name' in referenceRow || !('full_name' in referenceRow)) insertPayload.name = normalizedName;
      if ('full_name' in referenceRow) insertPayload.full_name = normalizedName;
      if ('student_name' in referenceRow) insertPayload.student_name = normalizedName;
      if ('s_number' in referenceRow || !('student_number' in referenceRow)) insertPayload.s_number = normalizedSNumber;
      if ('student_number' in referenceRow) insertPayload.student_number = normalizedSNumber;
      if ('scheduleable' in referenceRow || Object.keys(referenceRow).length === 0) {
        insertPayload.scheduleable = payload.scheduleable;
      }
      if ('schedulable' in referenceRow) insertPayload.schedulable = payload.scheduleable;
      if ('assigned_periods' in referenceRow || Object.keys(referenceRow).length === 0) {
        insertPayload.assigned_periods = payload.assignedPeriods;
      }
      if ('Schedule' in referenceRow) insertPayload.Schedule = payload.assignedPeriods;

      const { data, error } = await supabase.from('students').insert(insertPayload).select('*').single();
      if (error || !data) {
        throw new Error(error?.message ?? 'Unable to add employee.');
      }

      const insertedRow = data as StudentRow;
      const employeeId = getStudentId(insertedRow);
      const employeeSNumber = getStudentSNumber(insertedRow) || normalizedSNumber;
      if (employeeId && employeeSNumber) {
        await supabase.from('employee_settings').upsert(
          {
            employee_id: employeeId,
            employee_s_number: employeeSNumber,
            off_periods: [4, 8]
          },
          {
            onConflict: 'employee_id'
          }
        );
      }
    },
    onSuccess: () => {
      invalidateEmployeeViews();
      setNewEmployeeDraft({
        name: '',
        sNumber: '',
        scheduleable: true,
        assignedPeriods: ''
      });
      setIsAddEmployeeModalOpen(false);
      setStatusMessage('Employee added.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to add employee.');
    }
  });

  const removeEmployeeRecordMutation = useMutation({
    mutationFn: async (employeeId: string) => {
      const sourceRow = (studentsQuery.data ?? []).find((row) => getStudentId(row) === employeeId);
      if (!sourceRow) {
        throw new Error('Employee record not found.');
      }
      const employeeSNumber = getStudentSNumber(sourceRow);

      await supabase.from('employee_login_credentials').delete().eq('employee_id', employeeId);
      await supabase.from('employee_settings').delete().eq('employee_id', employeeId);
      await supabase.from('strikes').delete().eq('employee_id', employeeId);
      await supabase.from('points_ledger').delete().eq('employee_id', employeeId);
      if (employeeSNumber) {
        await supabase.from('shift_attendance').delete().eq('employee_s_number', employeeSNumber);
        await supabase.from('attendance_overrides').delete().eq('s_number', employeeSNumber);
        await supabase.from('shift_change_requests').delete().eq('from_employee_s_number', employeeSNumber);
        await supabase.from('shift_change_requests').delete().eq('to_employee_s_number', employeeSNumber);
      }

      const { error: deleteError } = await supabase.from('students').delete().eq('id', employeeId);
      if (deleteError) {
        throw new Error(deleteError.message);
      }
    },
    onSuccess: (_, employeeId) => {
      invalidateEmployeeViews();
      setEmployeeRecordDrafts((previous) => {
        const next = { ...previous };
        delete next[employeeId];
        return next;
      });
      setStatusMessage('Employee removed.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to remove employee.');
    }
  });

  const pardonMeetingMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await pardonMeetingAbsence(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-data-for-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-overrides'] });
      setStatusMessage('Meeting absence pardoned.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to pardon meeting absence.');
    }
  });

  const markMeetingPresentMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await overrideMeetingAttendance(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-data-for-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-overrides'] });
      setStatusMessage('Meeting attendance marked present.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to mark meeting present.');
    }
  });

  const markMeetingAbsentMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string; reason: string }) => {
      const result = await markMeetingAbsent(payload.sNumber, payload.date, payload.reason);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-data-for-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-overrides'] });
      setStatusMessage('Meeting marked absent (attendance row removed).');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to mark meeting absent.');
    }
  });

  const clearMeetingOverrideMutation = useMutation({
    mutationFn: async (payload: { sNumber: string; date: string }) => {
      const result = await clearMeetingOverride(payload.sNumber, payload.date);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-data-for-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-meeting-overrides'] });
      setStatusMessage('Meeting override cleared.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to clear meeting override.');
    }
  });

  const pardonShiftMutation = useMutation({
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
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance-for-employees'] });
      setStatusMessage('Shift attendance pardoned (excused).');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to pardon shift attendance.');
    }
  });

  const markShiftPresentMutation = useMutation({
    mutationFn: async (payload: {
      sNumber: string;
      date: string;
      period: number;
      shiftSlotKey: string;
    }) => {
      const result = await markShiftPresent(
        payload.sNumber,
        payload.date,
        payload.period,
        payload.shiftSlotKey
      );
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-shift-attendance-for-employees'] });
      setStatusMessage('Shift marked present.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to mark shift present.');
    }
  });

  const awardPointsMutation = useMutation({
    mutationFn: async (payload: { employeeId: string; points: number; type: string; note: string }) => {
      const pointType =
        payload.type === 'meeting' ||
        payload.type === 'morning_shift' ||
        payload.type === 'off_period_shift' ||
        payload.type === 'project'
          ? payload.type
          : 'manual';
      const result = await awardPoints(payload.employeeId, pointType, payload.points, payload.note);
      if (!result.ok) throw new Error(`${result.error.message} (${result.correlationId})`);
      return result.data;
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['hr-points-ledger'] });
      setPointsDrafts((previous) => ({
        ...previous,
        [payload.employeeId]: { points: '1', type: 'manual', note: '' }
      }));
      setStatusMessage('Points updated.');
    },
    onError: (error) => {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to update points.');
    }
  });

  const derived = useMemo(() => {
    const strikesByEmployee = new Map<string, GenericRow[]>();
    const activeStrikesByEmployee = new Map<string, GenericRow[]>();
    for (const row of strikesQuery.data ?? []) {
      const employeeId = String(row.employee_id ?? '');
      if (!employeeId) continue;
      const bucket = strikesByEmployee.get(employeeId) ?? [];
      bucket.push(row);
      strikesByEmployee.set(employeeId, bucket);
      if (row.active === true) {
        const activeBucket = activeStrikesByEmployee.get(employeeId) ?? [];
        activeBucket.push(row);
        activeStrikesByEmployee.set(employeeId, activeBucket);
      }
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
    for (const [key, rows] of shiftBySNumber.entries()) {
      rows.sort((left, right) => {
        const byDate = String(right.shift_date ?? '').localeCompare(String(left.shift_date ?? ''));
        if (byDate !== 0) return byDate;
        return toNumber(right.shift_period) - toNumber(left.shift_period);
      });
      shiftBySNumber.set(key, rows);
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
    const overrideTypeBySNumberDate = new Map<string, Map<string, string>>();
    for (const row of overridesQuery.data ?? []) {
      const sNumber = String(row.s_number ?? '');
      const date = String(row.checkin_date ?? '');
      const overrideType = String(row.override_type ?? '');
      if (!sNumber || !date || !overrideType) continue;
      const bucket = overrideTypeBySNumberDate.get(sNumber) ?? new Map<string, string>();
      bucket.set(date, overrideType);
      overrideTypeBySNumberDate.set(sNumber, bucket);
    }

    const meetingStatusBySNumberDate = new Map<string, Map<string, 'present' | 'absent'>>();
    for (const record of meetingAttendanceQuery.data?.records ?? []) {
      const bucket = meetingStatusBySNumberDate.get(record.s_number) ?? new Map();
      bucket.set(record.date, record.status);
      meetingStatusBySNumberDate.set(record.s_number, bucket);
    }

    const recentMeetingDatesBySNumber = new Map<string, string[]>();
    const globalMeetingDates = [...(meetingAttendanceQuery.data?.dates ?? [])].sort((left, right) =>
      right.localeCompare(left)
    );
    for (const student of studentsQuery.data ?? []) {
      const sNumber = getStudentSNumber(student);
      const statusMap = meetingStatusBySNumberDate.get(sNumber);
      const dates = statusMap
        ? [...statusMap.keys()].sort((left, right) => right.localeCompare(left))
        : globalMeetingDates;
      recentMeetingDatesBySNumber.set(sNumber, dates.slice(0, 20));
    }

    const loginUsernameByEmployeeId = new Map<string, string>();
    for (const row of loginProfilesQuery.data ?? []) {
      loginUsernameByEmployeeId.set(String(row.employee_id), String(row.username));
    }

    const metrics: EmployeeMetric[] = (studentsQuery.data ?? []).map((student) => {
      const id = getStudentId(student);
      const sNumber = getStudentSNumber(student);
      const shifts = shiftBySNumber.get(sNumber) ?? [];
      const offPeriods = settingsByEmployeeId.get(id) ?? settingsBySNumber.get(sNumber) ?? [4, 8];
      const shiftRates = calculateShiftAttendanceRate({
        shiftAttendanceRecords: shifts.map((item) => ({
          status: item.status as 'expected' | 'present' | 'absent' | 'excused',
          rawStatus: (item.raw_status as 'expected' | 'present' | 'absent' | 'excused' | null) ?? null,
          date: String(item.shift_date ?? '')
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

      const basePoints = meetingRates.attended + morningShifts + offPeriodShifts;
      return {
        id,
        name: getStudentDisplayName(student),
        sNumber,
        username:
          loginUsernameByEmployeeId.get(id) ??
          ((student.username as string | undefined) ?? null),
        assignedPeriods:
          ((student.assigned_periods as string | undefined) ?? String(student.Schedule ?? '')).trim(),
        offPeriods,
        strikesCount: (activeStrikesByEmployee.get(id) ?? []).length,
        totalShifts: shifts.length,
        morningShifts,
        offPeriodShifts,
        shiftPresent,
        shiftAbsent,
        shiftExcused,
        shiftRate: shiftRates.adjusted_rate ?? shiftRates.raw_rate,
        meetingSessions: meetingRates.total_sessions,
        meetingAttended: meetingRates.attended,
        meetingExcused: meetingRates.excused,
        meetingRate: meetingRates.adjusted_rate ?? meetingRates.raw_rate,
        points: basePoints + (pointsByEmployee.get(id) ?? 0)
      };
    });

    metrics.sort((left, right) => left.name.localeCompare(right.name));

    return {
      metrics,
      strikesByEmployee,
      activeStrikesByEmployee,
      shiftBySNumber,
      meetingStatusBySNumberDate,
      recentMeetingDatesBySNumber,
      overrideTypeBySNumberDate
    };
  }, [
    loginProfilesQuery.data,
    meetingAttendanceQuery.data?.records,
    meetingAttendanceQuery.data?.dates,
    overridesQuery.data,
    pointsQuery.data,
    settingsQuery.data,
    shiftAttendanceQuery.data,
    strikesQuery.data,
    studentsQuery.data
  ]);

  const toggleEmployeeExpansion = (employeeId: string, defaultOffPeriods: number[]) => {
    setExpandedEmployeeId((previous) => {
      const next = previous === employeeId ? null : employeeId;
      if (next) {
        setActivePanelByEmployeeId((panelPrevious) => ({
          ...panelPrevious,
          [employeeId]: panelPrevious[employeeId] ?? 'meeting'
        }));
      }
      return next;
    });
    setOffPeriodDrafts((previous) => {
      if (previous[employeeId]) return previous;
      return { ...previous, [employeeId]: defaultOffPeriods };
    });
  };

  const initializeEmployeeDrafts = (employee: EmployeeMetric) => {
    setLoginUsernameDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      return { ...previous, [employee.id]: employee.username ?? '' };
    });
    setLoginPasswordDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      return { ...previous, [employee.id]: '' };
    });
    setMeetingReasonDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      return { ...previous, [employee.id]: '' };
    });
    setMeetingDateDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      const firstDate = derived.recentMeetingDatesBySNumber.get(employee.sNumber)?.[0] ?? '';
      return { ...previous, [employee.id]: firstDate };
    });
    setShiftReasonDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      return { ...previous, [employee.id]: '' };
    });
    setSelectedShiftDrafts((previous) => {
      if (previous[employee.id] !== undefined) return previous;
      const firstShift = (derived.shiftBySNumber.get(employee.sNumber) ?? [])[0];
      return { ...previous, [employee.id]: firstShift ? shiftRowKey(firstShift) : '' };
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

  const todayKey = getTodayDateKey();

  if (!canViewAttendance && !canOverrideAttendance && !canEditSettings && !canManageStrikes) {
    return <p className="text-sm text-neutral-700">You do not have permission to view employee management.</p>;
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-300 bg-neutral-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Employee Management</h3>
          <p className="text-xs text-neutral-600">
            Shift rates only include shifts on or before today.
          </p>
        </div>
        <button
          className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canEditSettings}
          onClick={() => setIsAddEmployeeModalOpen(true)}
          type="button"
        >
          Add Employee
        </button>
      </div>

      {statusMessage && <p className="text-sm text-brand-maroon">{statusMessage}</p>}

      <div className="overflow-x-auto border border-neutral-300">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-100">
            <tr>
              <th className="border-b border-neutral-300 p-2 text-left">Employee</th>
              <th className="border-b border-neutral-300 p-2 text-left">s_number</th>
              <th className="border-b border-neutral-300 p-2 text-left">Strikes</th>
              <th className="border-b border-neutral-300 p-2 text-left">Meeting</th>
              <th className="border-b border-neutral-300 p-2 text-left">Shift</th>
              <th className="border-b border-neutral-300 p-2 text-left">Off Periods</th>
              <th className="border-b border-neutral-300 p-2 text-left">Points</th>
            </tr>
          </thead>
          <tbody>
            {derived.metrics.map((employee) => {
              const isExpanded = expandedEmployeeId === employee.id;
              const draftOffPeriods = offPeriodDrafts[employee.id] ?? employee.offPeriods;
              const strikeReason = strikeReasonDrafts[employee.id] ?? '';
              const meetingReason = meetingReasonDrafts[employee.id] ?? '';
              const meetingDate = meetingDateDrafts[employee.id] ?? '';
              const shiftReason = shiftReasonDrafts[employee.id] ?? '';
              const loginUsername = loginUsernameDrafts[employee.id] ?? employee.username ?? '';
              const loginPassword = loginPasswordDrafts[employee.id] ?? '';
              const employeeStrikesAll = derived.strikesByEmployee.get(employee.id) ?? [];
              const activeEmployeeStrikes = derived.activeStrikesByEmployee.get(employee.id) ?? [];
              const strikeScope = strikeScopeByEmployeeId[employee.id] ?? 'active';
              const employeeStrikes = strikeScope === 'all' ? employeeStrikesAll : activeEmployeeStrikes;
              const recentMeetingDates = derived.recentMeetingDatesBySNumber.get(employee.sNumber) ?? [];
              const recentShiftRows = (derived.shiftBySNumber.get(employee.sNumber) ?? []).slice(0, 30);
              const selectedShiftKey = selectedShiftDrafts[employee.id] ?? '';
              const selectedShift =
                recentShiftRows.find((row) => shiftRowKey(row) === selectedShiftKey) ?? null;
              const selectedShiftIsFuture = selectedShift
                ? !isDateBeforeToday(String(selectedShift.shift_date ?? ''), todayKey)
                : false;
              const selectedMeetingStatus =
                derived.meetingStatusBySNumberDate.get(employee.sNumber)?.get(meetingDate) ?? null;
              const selectedMeetingOverride =
                derived.overrideTypeBySNumberDate.get(employee.sNumber)?.get(meetingDate) ?? null;
              const employeeRecordDraft = employeeRecordDrafts[employee.id] ?? {
                id: employee.id,
                name: employee.name,
                sNumber: employee.sNumber,
                scheduleable: true,
                assignedPeriods: employee.assignedPeriods
              };
              const pointsDraft = pointsDrafts[employee.id] ?? { points: '1', type: 'manual', note: '' };
              const activePanel = activePanelByEmployeeId[employee.id] ?? 'meeting';

              return (
                <Fragment key={employee.id}>
                  <tr
                    className={`cursor-pointer border-b border-neutral-200 ${isExpanded ? 'bg-neutral-50' : ''}`}
                    onClick={() => {
                      initializeEmployeeDrafts(employee);
                      toggleEmployeeExpansion(employee.id, employee.offPeriods);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        initializeEmployeeDrafts(employee);
                        toggleEmployeeExpansion(employee.id, employee.offPeriods);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td className="p-2">
                      <div className="flex min-h-[44px] items-center gap-2 text-left">
                        <span aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                        <span>{employee.name}</span>
                      </div>
                    </td>
                    <td className="p-2">{employee.sNumber || 'N/A'}</td>
                    <td className="p-2">{employee.strikesCount}</td>
                    <td className="p-2">
                      {formatRate(employee.meetingRate)}
                    </td>
                    <td className="p-2">
                      {formatRate(employee.shiftRate)}
                    </td>
                    <td className="p-2">{employee.offPeriods.join(', ')}</td>
                    <td className="p-2">{employee.points}</td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <td className="p-3" colSpan={7}>
                        <div className="space-y-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <div className="border border-neutral-300 bg-white px-2 py-1 text-xs">
                              Meeting: {formatRate(employee.meetingRate)}
                            </div>
                            <div className="border border-neutral-300 bg-white px-2 py-1 text-xs">
                              Shift: {formatRate(employee.shiftRate)}
                            </div>
                            <div className="border border-neutral-300 bg-white px-2 py-1 text-xs">
                              Shift P/A/E: {employee.shiftPresent}/{employee.shiftAbsent}/{employee.shiftExcused}
                            </div>
                            <div className="border border-neutral-300 bg-white px-2 py-1 text-xs">
                              Points: {employee.points} • Strikes: {employee.strikesCount}
                            </div>
                          </div>
                          <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
                            <div className="border border-neutral-300 bg-white p-3">
                              <p className="text-sm font-semibold text-neutral-900">General Overview</p>
                              <div className="mt-2 space-y-1 text-sm text-neutral-700">
                                <p>Username: {employee.username ?? 'N/A'}</p>
                                <p>s_number: {employee.sNumber || 'N/A'}</p>
                                <p>Assigned periods: {employee.assignedPeriods || 'N/A'}</p>
                                <p>Off periods: {employee.offPeriods.join(', ')}</p>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-1 rounded-md border border-neutral-300 bg-white p-1">
                                {([
                                  ['meeting', 'Meeting'],
                                  ['shift', 'Shift'],
                                  ['record', 'Record'],
                                  ['login', 'Login'],
                                  ['offperiods', 'Off-Periods'],
                                  ['strikes', 'Strikes'],
                                  ['points', 'Points']
                                ] as Array<[EmployeePanelId, string]>).map(([panelId, label]) => (
                                  <button
                                    className={`min-h-[32px] rounded px-2 text-xs ${
                                      activePanel === panelId
                                        ? 'bg-brand-maroon text-white'
                                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                                    }`}
                                    key={`${employee.id}-panel-${panelId}`}
                                    onClick={() =>
                                      setActivePanelByEmployeeId((previous) => ({
                                        ...previous,
                                        [employee.id]: panelId
                                      }))
                                    }
                                    type="button"
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'meeting' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Meeting Attendance</p>
                              <div className="mt-2 space-y-2">
                                <p className="text-xs text-neutral-600">
                                  {employee.meetingAttended}/{employee.meetingSessions} attended, {employee.meetingExcused} excused
                                </p>
                                <FancyDropdown
                                  label="Session Date"
                                  onChange={(value) =>
                                    setMeetingDateDrafts((previous) => ({ ...previous, [employee.id]: value }))
                                  }
                                  options={recentMeetingDates.map((date) => {
                                    const baseStatus =
                                      derived.meetingStatusBySNumberDate.get(employee.sNumber)?.get(date) ?? null;
                                    const overrideType =
                                      derived.overrideTypeBySNumberDate.get(employee.sNumber)?.get(date) ?? null;
                                    const visual = getMeetingSessionVisual(baseStatus, overrideType);
                                    return {
                                      value: date,
                                      label: date,
                                      meta: visual.label,
                                      metaClassName: visual.badgeClass
                                    };
                                  })}
                                  placeholder="No session selected"
                                  value={meetingDate}
                                />
                                <p className="text-xs text-neutral-600">
                                  Current status: {selectedMeetingStatus ? selectedMeetingStatus : 'No record for selected session'}
                                </p>
                                <p className="text-xs text-neutral-600">
                                  Current override: {selectedMeetingOverride ? selectedMeetingOverride : 'none'}
                                </p>
                                <label className="block text-sm">
                                  Reason
                                  <textarea
                                    className="mt-1 min-h-[72px] w-full border border-neutral-300 p-2"
                                    onChange={(event) =>
                                      setMeetingReasonDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: event.target.value
                                      }))
                                    }
                                    value={meetingReason}
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !meetingDate || pardonMeetingMutation.isPending}
                                    onClick={() => {
                                      if (!meetingReason.trim()) {
                                        setStatusMessage('Meeting pardon reason is required.');
                                        return;
                                      }
                                      pardonMeetingMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: meetingDate,
                                        reason: meetingReason.trim()
                                      });
                                    }}
                                    type="button"
                                  >
                                    Pardon
                                  </button>
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !meetingDate || markMeetingPresentMutation.isPending}
                                    onClick={() => {
                                      if (!meetingReason.trim()) {
                                        setStatusMessage('Meeting present reason is required.');
                                        return;
                                      }
                                      markMeetingPresentMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: meetingDate,
                                        reason: meetingReason.trim()
                                      });
                                    }}
                                    type="button"
                                  >
                                    Mark Present
                                  </button>
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !meetingDate || markMeetingAbsentMutation.isPending}
                                    onClick={() => {
                                      markMeetingAbsentMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: meetingDate,
                                        reason: meetingReason.trim() || 'Marked absent from manager panel'
                                      });
                                    }}
                                    type="button"
                                  >
                                    Mark Absent
                                  </button>
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !meetingDate || clearMeetingOverrideMutation.isPending}
                                    onClick={() => {
                                      clearMeetingOverrideMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: meetingDate
                                      });
                                    }}
                                    type="button"
                                  >
                                    Clear Override
                                  </button>
                                </div>
                              </div>
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'shift' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Shift Attendance</p>
                              <div className="mt-2 space-y-2">
                                <FancyDropdown
                                  label="Recent Shift"
                                  onChange={(value) =>
                                    setSelectedShiftDrafts((previous) => ({ ...previous, [employee.id]: value }))
                                  }
                                  options={recentShiftRows.map((row) => ({
                                    value: shiftRowKey(row),
                                    label: `${String(row.shift_date)} P${String(row.shift_period)}`,
                                    meta: String(row.status ?? 'expected')
                                  }))}
                                  placeholder="No recent shifts"
                                  value={selectedShiftKey}
                                />
                                <p className="text-xs text-neutral-600">
                                  Selected status: {selectedShift ? String(selectedShift.status) : 'N/A'}
                                </p>
                                <label className="block text-sm">
                                  Reason
                                  <textarea
                                    className="mt-1 min-h-[72px] w-full border border-neutral-300 p-2"
                                    onChange={(event) =>
                                      setShiftReasonDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: event.target.value
                                      }))
                                    }
                                    value={shiftReason}
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !selectedShift || selectedShiftIsFuture || pardonShiftMutation.isPending}
                                    onClick={() => {
                                      if (!selectedShift) {
                                        setStatusMessage('Select a shift first.');
                                        return;
                                      }
                                      if (!shiftReason.trim()) {
                                        setStatusMessage('Shift pardon reason is required.');
                                        return;
                                      }
                                      pardonShiftMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: String(selectedShift.shift_date),
                                        period: toNumber(selectedShift.shift_period),
                                        shiftSlotKey: String(selectedShift.shift_slot_key),
                                        reason: shiftReason.trim()
                                      });
                                    }}
                                    type="button"
                                  >
                                    Pardon Shift
                                  </button>
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canOverrideAttendance || !selectedShift || selectedShiftIsFuture || markShiftPresentMutation.isPending}
                                    onClick={() => {
                                      if (!selectedShift) {
                                        setStatusMessage('Select a shift first.');
                                        return;
                                      }
                                      markShiftPresentMutation.mutate({
                                        sNumber: employee.sNumber,
                                        date: String(selectedShift.shift_date),
                                        period: toNumber(selectedShift.shift_period),
                                        shiftSlotKey: String(selectedShift.shift_slot_key)
                                      });
                                    }}
                                    type="button"
                                  >
                                    Mark Present
                                  </button>
                                </div>
                                {selectedShiftIsFuture && (
                                  <p className="text-xs text-neutral-600">Shift overrides are available on the shift date or after.</p>
                                )}
                              </div>
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'record' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Employee Record</p>
                              <div className="mt-2 space-y-2">
                                <label className="block text-sm">
                                  Name
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setEmployeeRecordDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: { ...employeeRecordDraft, name: event.target.value }
                                      }))
                                    }
                                    value={employeeRecordDraft.name}
                                  />
                                </label>
                                <label className="block text-sm">
                                  s_number
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setEmployeeRecordDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: { ...employeeRecordDraft, sNumber: event.target.value }
                                      }))
                                    }
                                    value={employeeRecordDraft.sNumber}
                                  />
                                </label>
                                <label className="block text-sm">
                                  Assigned periods
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setEmployeeRecordDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: {
                                          ...employeeRecordDraft,
                                          assignedPeriods: event.target.value
                                        }
                                      }))
                                    }
                                    value={employeeRecordDraft.assignedPeriods}
                                  />
                                </label>
                                <label className="flex min-h-[44px] items-center gap-2 text-sm">
                                  <input
                                    checked={employeeRecordDraft.scheduleable}
                                    onChange={(event) =>
                                      setEmployeeRecordDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: {
                                          ...employeeRecordDraft,
                                          scheduleable: event.target.checked
                                        }
                                      }))
                                    }
                                    type="checkbox"
                                  />
                                  Schedulable
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    className="min-h-[38px] border border-brand-maroon bg-brand-maroon px-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canEditSettings || saveEmployeeRecordMutation.isPending}
                                    onClick={() => saveEmployeeRecordMutation.mutate(employee.id)}
                                    type="button"
                                  >
                                    Save Record
                                  </button>
                                  <button
                                    className="min-h-[38px] border border-neutral-500 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!canEditSettings || removeEmployeeRecordMutation.isPending}
                                    onClick={() => removeEmployeeRecordMutation.mutate(employee.id)}
                                    type="button"
                                  >
                                    Remove Employee
                                  </button>
                                </div>
                              </div>
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'login' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Login Credentials</p>
                              <div className="mt-2 space-y-2">
                                <label className="block text-sm">
                                  Username
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setLoginUsernameDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: event.target.value
                                      }))
                                    }
                                    value={loginUsername}
                                  />
                                </label>
                                <label className="block text-sm">
                                  Password
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setLoginPasswordDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: event.target.value
                                      }))
                                    }
                                    type="password"
                                    value={loginPassword}
                                  />
                                </label>
                                <button
                                  className="min-h-[38px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!canEditSettings || saveLoginMutation.isPending}
                                  onClick={() => {
                                    if (!loginUsername.trim()) {
                                      setStatusMessage('Username is required.');
                                      return;
                                    }
                                    if (loginPassword.length < 8) {
                                      setStatusMessage('Password must be at least 8 characters.');
                                      return;
                                    }
                                    saveLoginMutation.mutate({
                                      employeeId: employee.id,
                                      username: loginUsername.trim(),
                                      password: loginPassword
                                    });
                                  }}
                                  type="button"
                                >
                                  Save Login
                                </button>
                              </div>
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'offperiods' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Off-Period Settings</p>
                              <div className="mt-2 space-y-2">
                                <div className="grid grid-cols-4 gap-2">
                                  {Array.from({ length: 8 }, (_, index) => index + 1).map((period) => {
                                    const selected = draftOffPeriods.includes(period);
                                    return (
                                      <button
                                        className={`min-h-[36px] border px-2 text-xs ${
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
                                  className="min-h-[38px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                              </div>

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'strikes' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Strike Management</p>
                              <div className="mt-2 space-y-2">
                                <FancyDropdown
                                  label="Strike View"
                                  onChange={(value) =>
                                    setStrikeScopeByEmployeeId((previous) => ({
                                      ...previous,
                                      [employee.id]: value === 'all' ? 'all' : 'active'
                                    }))
                                  }
                                  options={[
                                    { value: 'active', label: 'Active strikes' },
                                    { value: 'all', label: 'All-time strikes' }
                                  ]}
                                  value={strikeScope}
                                />
                                <label className="block text-sm">
                                  Reason
                                  <textarea
                                    className="mt-1 min-h-[72px] w-full border border-neutral-300 p-2"
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
                                  className="min-h-[38px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                                    <p className="text-sm text-neutral-600">
                                      {strikeScope === 'all' ? 'No strike history.' : 'No active strikes.'}
                                    </p>
                                  )}
                                  {employeeStrikes.map((strike) => (
                                    <div className="border border-neutral-300 p-2" key={String(strike.id)}>
                                      <p className="text-sm text-neutral-800">{String(strike.reason ?? 'No reason')}</p>
                                      <div className="mt-2 flex items-center justify-between gap-2">
                                        <p className="text-xs text-neutral-600">
                                          {new Date(String(strike.issued_at ?? '')).toLocaleDateString()}
                                        </p>
                                        <button
                                          className="min-h-[36px] border border-neutral-400 px-2 text-xs"
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

                              <div className={`border border-neutral-300 bg-white p-2 ${activePanel === 'points' ? '' : 'hidden'}`}>
                                <p className="text-sm font-semibold text-neutral-900">Points Management</p>
                              <div className="mt-2 space-y-2">
                                <FancyDropdown
                                  label="Type"
                                  onChange={(value) =>
                                    setPointsDrafts((previous) => ({
                                      ...previous,
                                      [employee.id]: { ...pointsDraft, type: value }
                                    }))
                                  }
                                  options={[
                                    { value: 'manual', label: 'Manual' },
                                    { value: 'meeting', label: 'Meeting' },
                                    { value: 'morning_shift', label: 'Morning Shift' },
                                    { value: 'off_period_shift', label: 'Off-Period Shift' },
                                    { value: 'project', label: 'Project' }
                                  ]}
                                  value={pointsDraft.type}
                                />
                                <label className="block text-sm">
                                  Points
                                  <input
                                    className="mt-1 min-h-[40px] w-full border border-neutral-300 px-2"
                                    onChange={(event) =>
                                      setPointsDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: { ...pointsDraft, points: event.target.value }
                                      }))
                                    }
                                    type="number"
                                    value={pointsDraft.points}
                                  />
                                </label>
                                <label className="block text-sm">
                                  Note
                                  <textarea
                                    className="mt-1 min-h-[72px] w-full border border-neutral-300 p-2"
                                    onChange={(event) =>
                                      setPointsDrafts((previous) => ({
                                        ...previous,
                                        [employee.id]: { ...pointsDraft, note: event.target.value }
                                      }))
                                    }
                                    value={pointsDraft.note}
                                  />
                                </label>
                                <button
                                  className="min-h-[38px] w-full border border-brand-maroon bg-brand-maroon px-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!canEditSettings || awardPointsMutation.isPending}
                                  onClick={() => {
                                    const points = Number(pointsDraft.points);
                                    if (!Number.isFinite(points) || points === 0) {
                                      setStatusMessage('Points must be a non-zero number.');
                                      return;
                                    }
                                    awardPointsMutation.mutate({
                                      employeeId: employee.id,
                                      points: Math.trunc(points),
                                      type: pointsDraft.type,
                                      note: pointsDraft.note.trim() || 'Manual points adjustment'
                                    });
                                  }}
                                  type="button"
                                >
                                  Apply Points
                                </button>
                              </div>
                              </div>
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

      {isAddEmployeeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-2xl border border-neutral-400 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-neutral-900">Add Employee</h3>
              <button
                className="min-h-[36px] border border-neutral-500 px-2 text-sm"
                onClick={() => setIsAddEmployeeModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Name
                <input
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setNewEmployeeDraft((previous) => ({ ...previous, name: event.target.value }))
                  }
                  value={newEmployeeDraft.name}
                />
              </label>
              <label className="text-sm">
                s_number
                <input
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setNewEmployeeDraft((previous) => ({ ...previous, sNumber: event.target.value }))
                  }
                  value={newEmployeeDraft.sNumber}
                />
              </label>
              <label className="text-sm md:col-span-2">
                Assigned periods
                <input
                  className="mt-1 min-h-[44px] w-full border border-neutral-300 px-2"
                  onChange={(event) =>
                    setNewEmployeeDraft((previous) => ({ ...previous, assignedPeriods: event.target.value }))
                  }
                  value={newEmployeeDraft.assignedPeriods}
                />
              </label>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  checked={newEmployeeDraft.scheduleable}
                  onChange={(event) =>
                    setNewEmployeeDraft((previous) => ({ ...previous, scheduleable: event.target.checked }))
                  }
                  type="checkbox"
                />
                Schedulable
              </label>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="min-h-[44px] border border-neutral-500 px-3 text-sm"
                onClick={() => setIsAddEmployeeModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-[44px] border border-brand-maroon bg-brand-maroon px-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !canEditSettings ||
                  addEmployeeRecordMutation.isPending ||
                  !newEmployeeDraft.name.trim() ||
                  !newEmployeeDraft.sNumber.trim()
                }
                onClick={() =>
                  addEmployeeRecordMutation.mutate({
                    name: newEmployeeDraft.name,
                    sNumber: newEmployeeDraft.sNumber,
                    scheduleable: newEmployeeDraft.scheduleable,
                    assignedPeriods: newEmployeeDraft.assignedPeriods
                  })
                }
                type="button"
              >
                Create Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
