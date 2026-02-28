import { SupabaseClient } from '@supabase/supabase-js';

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

export async function monthHasShiftAttendance(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<boolean> {
  const window = monthWindow(year, month);
  const { count } = await supabase
    .from('shift_attendance')
    .select('id', { count: 'exact', head: true })
    .gte('shift_date', window.from)
    .lte('shift_date', window.to);

  return (count ?? 0) > 0;
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
    const { data: approvedExchanges, error: exchangeError } = await supabase
      .from('shift_change_requests')
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

    if (params.forceRebuild) {
      await supabase
        .from('shift_attendance')
        .delete()
        .gte('shift_date', window.from)
        .lte('shift_date', window.to)
        .eq('status', 'expected');
    }

    const { data: existingRows, error: existingRowsError } = await supabase
      .from('shift_attendance')
      .select('id, shift_date, shift_period, shift_slot_key, employee_s_number, status')
      .gte('shift_date', window.from)
      .lte('shift_date', window.to);

    if (existingRowsError) {
      return errorResult(correlationId, 'DB_ERROR', existingRowsError.message);
    }

    const existingByKey = new Map<
      string,
      {
        id: string;
        status: 'expected' | 'present' | 'absent' | 'excused';
      }
    >();

    for (const row of existingRows ?? []) {
      const key = [row.shift_date, row.shift_period, row.shift_slot_key, row.employee_s_number].join(
        '|'
      );
      existingByKey.set(key, {
        id: row.id,
        status: row.status
      });
    }

    const rowsToUpsert: Array<{
      shift_date: string;
      shift_period: number;
      shift_slot_key: string;
      employee_s_number: string;
      status: 'expected';
      source: 'scheduler' | 'shift_exchange';
      reason: null;
      marked_by: null;
    }> = [];

    let created = 0;
    let updated = 0;

    for (const assignment of effectiveSchedule.schedule) {
      const row = {
        shift_date: assignment.date,
        shift_period: assignment.period,
        shift_slot_key: assignment.shiftSlotKey,
        employee_s_number: assignment.effectiveWorkerSNumber,
        status: 'expected' as const,
        source:
          assignment.effectiveWorkerSNumber === assignment.studentSNumber
            ? ('scheduler' as const)
            : ('shift_exchange' as const),
        reason: null,
        marked_by: null
      };

      const key = [row.shift_date, row.shift_period, row.shift_slot_key, row.employee_s_number].join(
        '|'
      );
      const existing = existingByKey.get(key);
      if (!existing) {
        created += 1;
        rowsToUpsert.push(row);
        continue;
      }

      if (existing.status === 'expected') {
        updated += 1;
        rowsToUpsert.push(row);
      }
    }

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase.from('shift_attendance').upsert(rowsToUpsert, {
        onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
      });
      if (upsertError) {
        return errorResult(correlationId, 'DB_ERROR', upsertError.message);
      }
    }

    return successResult({ created, updated }, correlationId);
  } catch (error) {
    return errorResult(
      correlationId,
      'UNKNOWN_ERROR',
      error instanceof Error ? error.message : 'Failed to build expected shifts'
    );
  }
}
