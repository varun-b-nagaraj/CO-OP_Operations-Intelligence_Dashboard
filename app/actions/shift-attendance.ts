'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentBySNumber } from '@/lib/server/employees';
import { calculateShiftAttendanceRate } from '@/lib/server/attendance';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  errorResult,
  generateCorrelationId,
  Result,
  ShiftAttendance,
  ShiftAttendanceFilters,
  successResult
} from '@/lib/types';
import { ShiftAttendanceMarkSchema, zodFieldErrors } from '@/lib/validation';

function getTodayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function isShiftDateTodayOrPast(shiftDate: string): boolean {
  return shiftDate <= getTodayDateKey();
}

async function maybeAwardShiftPoints(
  params: {
    employeeSNumber: string;
    shiftPeriod: number;
    previousStatus?: string;
    currentStatus: string;
  }
): Promise<void> {
  if (params.currentStatus !== 'present' || params.previousStatus === 'present') {
    return;
  }

  const supabase = createServerClient();
  const student = await getStudentBySNumber(supabase, params.employeeSNumber);
  if (!student) return;

  if (params.shiftPeriod === 0) {
    await supabase.from('points_ledger').insert({
      employee_id: student.id,
      point_type: 'morning_shift',
      points: 1,
      description: 'Morning shift completed',
      awarded_by: 'open_access'
    });
    return;
  }

  const { data: settings } = await supabase
    .from('employee_settings')
    .select('off_periods')
    .eq('employee_s_number', params.employeeSNumber)
    .maybeSingle();

  const offPeriods = (settings?.off_periods as number[] | undefined) ?? [4, 8];
  if (offPeriods.includes(params.shiftPeriod)) {
    await supabase.from('points_ledger').insert({
      employee_id: student.id,
      point_type: 'off_period_shift',
      points: 1,
      description: 'Off-period shift completed',
      awarded_by: 'open_access'
    });
  }
}

async function upsertShiftAttendanceStatus(input: {
  sNumber: string;
  date: string;
  period: number;
  shiftSlotKey: string;
  status: 'present' | 'absent' | 'excused';
  reason?: string;
  correlationId: string;
}): Promise<Result<ShiftAttendance>> {
  try {
    const parsed = ShiftAttendanceMarkSchema.safeParse({
      s_number: input.sNumber,
      date: input.date,
      period: input.period,
      shift_slot_key: input.shiftSlotKey,
      reason: input.reason
    });

    if (!parsed.success) {
      return errorResult(
        input.correlationId,
        'VALIDATION_ERROR',
        'Invalid shift attendance payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const student = await getStudentBySNumber(supabase, input.sNumber);
    if (!student) {
      return errorResult(input.correlationId, 'VALIDATION_ERROR', 'Employee does not exist', {
        s_number: 's_number was not found in students table'
      });
    }

    const { data: existing } = await supabase
      .from('shift_attendance')
      .select('*')
      .eq('shift_date', input.date)
      .eq('shift_period', input.period)
      .eq('shift_slot_key', input.shiftSlotKey)
      .eq('employee_s_number', input.sNumber)
      .maybeSingle();

    const { data, error } = await supabase
      .from('shift_attendance')
      .upsert(
        {
          shift_date: input.date,
          shift_period: input.period,
          shift_slot_key: input.shiftSlotKey,
          employee_s_number: input.sNumber,
          status: input.status,
          source: existing?.source ?? 'manual',
          reason: input.reason ?? null,
          marked_by: 'open_access',
          marked_at: new Date().toISOString()
        },
        {
          onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
        }
      )
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(input.correlationId, 'DB_ERROR', error?.message ?? 'Unable to save shift attendance');
    }

    await maybeAwardShiftPoints(
      {
        employeeSNumber: input.sNumber,
        shiftPeriod: input.period,
        previousStatus: existing?.status,
        currentStatus: data.status
      }
    );

    await insertAuditEntry(
      supabase,
      {
        action: `shift_marked_${input.status}`,
        tableName: 'shift_attendance',
        recordId: data.id,
        oldValue: existing ?? null,
        newValue: data,
        userId: 'open_access'
      },
      input.correlationId
    );

    logInfo('shift_attendance_upserted', {
      correlationId: input.correlationId,
      sNumber: input.sNumber,
      date: input.date,
      period: input.period,
      shiftSlotKey: input.shiftSlotKey,
      status: input.status
    });

    return successResult(data as ShiftAttendance, input.correlationId);
  } catch (error) {
    logError('upsert_shift_attendance_failed', {
      correlationId: input.correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(input.correlationId, 'UNKNOWN_ERROR', 'Failed to update shift attendance.');
  }
}

export async function markShiftPresent(
  sNumber: string,
  date: string,
  period: number,
  shiftSlotKey: string
): Promise<Result<ShiftAttendance>> {
  const correlationId = generateCorrelationId();
  const allowed = await ensureServerPermission('hr.attendance.override');
  if (!allowed) {
    return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to mark attendance.');
  }
  if (!isShiftDateTodayOrPast(date)) {
    return errorResult(
      correlationId,
      'VALIDATION_ERROR',
      'You can only mark a shift present on the shift date or after.'
    );
  }

  return upsertShiftAttendanceStatus({
    sNumber,
    date,
    period,
    shiftSlotKey,
    status: 'present',
    correlationId
  });
}

export async function markShiftAbsent(
  sNumber: string,
  date: string,
  period: number,
  shiftSlotKey: string
): Promise<Result<ShiftAttendance>> {
  const correlationId = generateCorrelationId();
  const allowed = await ensureServerPermission('hr.attendance.override');
  if (!allowed) {
    return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to mark attendance.');
  }

  return upsertShiftAttendanceStatus({
    sNumber,
    date,
    period,
    shiftSlotKey,
    status: 'absent',
    correlationId
  });
}

export async function excuseShiftAbsence(
  sNumber: string,
  date: string,
  period: number,
  shiftSlotKey: string,
  reason: string
): Promise<Result<ShiftAttendance>> {
  const correlationId = generateCorrelationId();
  const allowed = await ensureServerPermission('hr.attendance.override');
  if (!allowed) {
    return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to excuse attendance.');
  }
  if (!isShiftDateTodayOrPast(date)) {
    return errorResult(
      correlationId,
      'VALIDATION_ERROR',
      'You can only pardon a shift absence on the shift date or after.'
    );
  }

  return upsertShiftAttendanceStatus({
    sNumber,
    date,
    period,
    shiftSlotKey,
    status: 'excused',
    reason,
    correlationId
  });
}

export async function getShiftAttendance(
  filters: ShiftAttendanceFilters
): Promise<Result<ShiftAttendance[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.attendance.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view attendance.');
    }

    const supabase = createServerClient();
    let query = supabase
      .from('shift_attendance')
      .select('*')
      .order('shift_date', { ascending: false })
      .order('shift_period', { ascending: true });

    if (filters.from) query = query.gte('shift_date', filters.from);
    if (filters.to) query = query.lte('shift_date', filters.to);
    if (filters.employeeSNumber) query = query.eq('employee_s_number', filters.employeeSNumber);
    if (typeof filters.period === 'number') query = query.eq('shift_period', filters.period);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const rows = (data ?? []) as ShiftAttendance[];
    calculateShiftAttendanceRate({
      shiftAttendanceRecords: rows.map((row) => ({ status: row.status, date: row.shift_date }))
    });

    logInfo('shift_attendance_read', {
      correlationId,
      rows: rows.length
    });

    return successResult(rows, correlationId);
  } catch (error) {
    logError('get_shift_attendance_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load shift attendance.');
  }
}
