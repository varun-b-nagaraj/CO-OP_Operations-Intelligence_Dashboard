import { SupabaseClient } from '@supabase/supabase-js';

import { resolvePreferredTable } from '@/lib/server/common';
import { applyApprovedShiftExchanges, monthWindow } from '@/lib/server/schedule';
import { errorResult, Result, ShiftChangeRequest, successResult } from '@/lib/types';
import { fetchScheduleWithCache } from './external-apis';

type BuildParams = {
  year: number;
  month: number;
  anchorDate: string;
  anchorDay: 'A' | 'B';
  seed: number;
  forceRefresh?: boolean;
  forceRebuild?: boolean;
};

type ScheduleAssignment = {
  date: string;
  period: number;
  shiftSlotKey: string;
  studentSNumber: string;
  effectiveWorkerSNumber: string;
};

const DEFAULT_OFF_PERIODS = [4, 8] as const;

export async function monthHasShiftAttendance(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<boolean> {
  const shiftAttendanceTable = await resolvePreferredTable(
    supabase,
    'hr_shift_attendance',
    'shift_attendance',
    'id'
  );
  const window = monthWindow(year, month);
  const { count } = await supabase
    .from(shiftAttendanceTable)
    .select('id', { count: 'exact', head: true })
    .gte('shift_date', window.from)
    .lte('shift_date', window.to);

  return (count ?? 0) > 0;
}

async function syncAttendanceTable(
  supabase: SupabaseClient,
  tableName: string,
  assignments: ScheduleAssignment[],
  window: { from: string; to: string },
  forceRebuild: boolean
): Promise<Result<{ created: number; updated: number }>> {
  if (forceRebuild) {
    const { error: clearError } = await supabase
      .from(tableName)
      .delete()
      .gte('shift_date', window.from)
      .lte('shift_date', window.to)
      .is('marked_by', null)
      .in('source', ['scheduler', 'shift_exchange']);

    if (clearError) {
      return errorResult('shift-sync', 'DB_ERROR', clearError.message);
    }
  }

  const { data: existingRows, error: existingRowsError } = await supabase
    .from(tableName)
    .select('id, shift_date, shift_period, shift_slot_key, employee_s_number, source, marked_by')
    .gte('shift_date', window.from)
    .lte('shift_date', window.to);

  if (existingRowsError) {
    return errorResult('shift-sync', 'DB_ERROR', existingRowsError.message);
  }

  const existingByKey = new Map<
    string,
    {
      id: string | number;
      source: 'scheduler' | 'manual' | 'shift_exchange' | 'rebuild';
      marked_by: string | null;
    }
  >();

  for (const row of existingRows ?? []) {
    const key = [row.shift_date, row.shift_period, row.shift_slot_key, row.employee_s_number].join('|');
    existingByKey.set(key, {
      id: row.id,
      source: row.source,
      marked_by: row.marked_by
    });
  }

  const rowsToUpsert: Array<{
    shift_date: string;
    shift_period: number;
    shift_slot_key: string;
    employee_s_number: string;
    status: 'present';
    raw_status: 'present';
    source: 'scheduler' | 'shift_exchange';
    reason: null;
    marked_by: null;
  }> = [];

  let created = 0;
  let updated = 0;
  const desiredKeys = new Set<string>();

  for (const assignment of assignments) {
    const row = {
      shift_date: assignment.date,
      shift_period: assignment.period,
      shift_slot_key: assignment.shiftSlotKey,
      employee_s_number: assignment.effectiveWorkerSNumber,
      status: 'present' as const,
      raw_status: 'present' as const,
      source:
        assignment.effectiveWorkerSNumber === assignment.studentSNumber
          ? ('scheduler' as const)
          : ('shift_exchange' as const),
      reason: null,
      marked_by: null
    };

    const key = [row.shift_date, row.shift_period, row.shift_slot_key, row.employee_s_number].join('|');
    desiredKeys.add(key);

    const existing = existingByKey.get(key);
    if (!existing) {
      created += 1;
      rowsToUpsert.push(row);
      continue;
    }

    const isSystemSeeded =
      existing.marked_by === null && (existing.source === 'scheduler' || existing.source === 'shift_exchange');
    if (isSystemSeeded) {
      updated += 1;
      rowsToUpsert.push(row);
    }
  }

  const staleSystemSeededIds: Array<string | number> = [];
  for (const row of existingRows ?? []) {
    const key = [row.shift_date, row.shift_period, row.shift_slot_key, row.employee_s_number].join('|');
    const isSystemSeeded =
      row.marked_by === null && (row.source === 'scheduler' || row.source === 'shift_exchange');
    if (isSystemSeeded && !desiredKeys.has(key)) {
      staleSystemSeededIds.push(row.id);
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await supabase.from(tableName).upsert(rowsToUpsert, {
      onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
    });
    if (upsertError) {
      return errorResult('shift-sync', 'DB_ERROR', upsertError.message);
    }
  }

  if (staleSystemSeededIds.length > 0) {
    const { error: deleteError } = await supabase.from(tableName).delete().in('id', staleSystemSeededIds);
    if (deleteError) {
      return errorResult('shift-sync', 'DB_ERROR', deleteError.message);
    }
  }

  return successResult({ created, updated }, 'shift-sync');
}

export async function buildExpectedShiftsInternal(
  supabase: SupabaseClient,
  params: BuildParams,
  correlationId: string
): Promise<Result<{ created: number; updated: number }>> {
  try {
    const scheduleResult = await fetchScheduleWithCache(
      supabase,
      {
        year: params.year,
        month: params.month,
        anchorDate: params.anchorDate,
        anchorDay: params.anchorDay,
        seed: params.seed,
        forceRefresh: params.forceRefresh
      },
      correlationId
    );

    const window = monthWindow(params.year, params.month);
    const shiftChangeRequestTable = await resolvePreferredTable(
      supabase,
      'hr_shift_change_requests',
      'shift_change_requests',
      'id'
    );
    const employeeSettingsTable = await resolvePreferredTable(
      supabase,
      'hr_employee_settings',
      'employee_settings',
      'employee_id'
    );
    const shiftAttendanceTable = await resolvePreferredTable(
      supabase,
      'hr_shift_attendance',
      'shift_attendance',
      'id'
    );
    const morningShiftAttendanceTable = await resolvePreferredTable(
      supabase,
      'hr_morning_shift_attendance',
      'morning_shift_attendance',
      'id'
    );
    const offPeriodShiftAttendanceTable = await resolvePreferredTable(
      supabase,
      'hr_off_period_shift_attendance',
      'off_period_shift_attendance',
      'id'
    );

    const { data: approvedExchanges, error: exchangeError } = await supabase
      .from(shiftChangeRequestTable)
      .select('*')
      .eq('status', 'approved')
      .gte('shift_date', window.from)
      .lte('shift_date', window.to);

    if (exchangeError) {
      return errorResult(correlationId, 'DB_ERROR', exchangeError.message);
    }

    const effectiveSchedule = applyApprovedShiftExchanges(
      scheduleResult.schedule,
      (approvedExchanges ?? []) as ShiftChangeRequest[]
    );

    const { data: employeeSettings, error: settingsError } = await supabase
      .from(employeeSettingsTable)
      .select('employee_s_number,off_periods');

    if (settingsError) {
      return errorResult(correlationId, 'DB_ERROR', settingsError.message);
    }

    const offPeriodsBySNumber = new Map<string, number[]>();
    for (const row of employeeSettings ?? []) {
      const sNumber = String(row.employee_s_number ?? '').trim();
      if (!sNumber) continue;
      offPeriodsBySNumber.set(
        sNumber,
        Array.isArray(row.off_periods) && row.off_periods.length > 0
          ? (row.off_periods as number[])
          : [...DEFAULT_OFF_PERIODS]
      );
    }

    const allAssignments = effectiveSchedule.schedule;
    const morningAssignments = allAssignments.filter((assignment) => assignment.period === 0);
    const offPeriodAssignments = allAssignments.filter((assignment) => {
      const offPeriods = offPeriodsBySNumber.get(assignment.effectiveWorkerSNumber) ?? [...DEFAULT_OFF_PERIODS];
      return offPeriods.includes(assignment.period);
    });

    const regularResult = await syncAttendanceTable(
      supabase,
      shiftAttendanceTable,
      allAssignments,
      window,
      params.forceRebuild === true
    );
    if (!regularResult.ok) {
      return errorResult(correlationId, 'DB_ERROR', regularResult.error.message);
    }

    const morningResult = await syncAttendanceTable(
      supabase,
      morningShiftAttendanceTable,
      morningAssignments,
      window,
      params.forceRebuild === true
    );
    if (!morningResult.ok) {
      return errorResult(correlationId, 'DB_ERROR', morningResult.error.message);
    }

    const offPeriodResult = await syncAttendanceTable(
      supabase,
      offPeriodShiftAttendanceTable,
      offPeriodAssignments,
      window,
      params.forceRebuild === true
    );
    if (!offPeriodResult.ok) {
      return errorResult(correlationId, 'DB_ERROR', offPeriodResult.error.message);
    }

    return successResult(
      {
        created: regularResult.data.created + morningResult.data.created + offPeriodResult.data.created,
        updated: regularResult.data.updated + morningResult.data.updated + offPeriodResult.data.updated
      },
      correlationId
    );
  } catch (error) {
    return errorResult(
      correlationId,
      'UNKNOWN_ERROR',
      error instanceof Error ? error.message : 'Failed to build expected shifts'
    );
  }
}
