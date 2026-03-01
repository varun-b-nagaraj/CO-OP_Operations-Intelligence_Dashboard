'use server';

import { z } from 'zod';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentBySNumber } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  errorResult,
  generateCorrelationId,
  Result,
  ShiftChangeRequest,
  ShiftRequestSource,
  ShiftRequestStatus,
  successResult
} from '@/lib/types';
import { ShiftExchangeRequestSchema, ShiftExchangeReviewSchema, zodFieldErrors } from '@/lib/validation';

function toValidNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return null;
}

async function findScheduleAssignment(input: {
  shiftDate: string;
  shiftPeriod: number;
  shiftSlotKey: string;
}) {
  const supabase = createServerClient();
  const date = new Date(`${input.shiftDate}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const { data: scheduleRow } = await supabase
    .from('schedules')
    .select('schedule_data')
    .eq('year', year)
    .eq('month', month)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const scheduleData = scheduleRow?.schedule_data as
    | {
        schedule?: Array<{
          date: string;
          period: number;
          shiftSlotKey: string;
          studentSNumber: string;
        }>;
      }
    | undefined;

  const assignment = scheduleData?.schedule?.find(
    (item) =>
      item.date === input.shiftDate &&
      item.period === input.shiftPeriod &&
      item.shiftSlotKey === input.shiftSlotKey
  );

  return assignment ?? null;
}

async function resolveExpectedWorkerForSlot(input: {
  shiftDate: string;
  shiftPeriod: number;
  shiftSlotKey: string;
  baseWorkerSNumber: string;
}) {
  const supabase = createServerClient();
  const { data: approved } = await supabase
    .from('shift_change_requests')
    .select('from_employee_s_number, to_employee_s_number, requested_at')
    .eq('status', 'approved')
    .eq('shift_date', input.shiftDate)
    .eq('shift_period', input.shiftPeriod)
    .eq('shift_slot_key', input.shiftSlotKey)
    .order('requested_at', { ascending: true });

  let currentWorker = input.baseWorkerSNumber;
  for (const item of approved ?? []) {
    if (item.from_employee_s_number === currentWorker) {
      currentWorker = item.to_employee_s_number;
    }
  }
  return currentWorker;
}

export async function submitShiftExchange(
  shiftDate: string,
  shiftPeriod: number,
  shiftSlotKey: string,
  fromSNumber: string,
  toSNumber: string,
  reason: string,
  requestSource: ShiftRequestSource = 'employee_form'
): Promise<Result<ShiftChangeRequest>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.requests.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to submit requests.');
    }

    const parsed = ShiftExchangeRequestSchema.safeParse({
      shift_date: shiftDate,
      shift_period: shiftPeriod,
      shift_slot_key: shiftSlotKey,
      from_employee_s_number: fromSNumber,
      to_employee_s_number: toSNumber,
      reason,
      request_source: requestSource
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid shift exchange request',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const [fromStudent, toStudent] = await Promise.all([
      getStudentBySNumber(supabase, parsed.data.from_employee_s_number),
      getStudentBySNumber(supabase, parsed.data.to_employee_s_number)
    ]);

    if (!fromStudent || !toStudent) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Employee references are invalid', {
        from_employee_s_number: !fromStudent ? 'from employee does not exist' : '',
        to_employee_s_number: !toStudent ? 'to employee does not exist' : ''
      });
    }

    const { data: toStudentRow, error: toStudentRowError } = await supabase
      .from('students')
      .select('*')
      .eq('s_number', parsed.data.to_employee_s_number)
      .maybeSingle();

    if (toStudentRowError || !toStudentRow) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Target employee is invalid', {
        to_employee_s_number: 'to employee does not exist in students table'
      });
    }

    const toScheduleable =
      toBoolean((toStudentRow as Record<string, unknown>).scheduleable) ??
      toBoolean((toStudentRow as Record<string, unknown>).schedulable) ??
      false;
    if (!toScheduleable) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Target employee is not schedulable and cannot be assigned as a replacement.',
        { to_employee_s_number: 'employee must be schedulable' }
      );
    }

    const toClassPeriod = toValidNumber((toStudentRow as Record<string, unknown>).Schedule);
    const [{ data: toSettingsRow }, { data: fromSettingsRow }] = await Promise.all([
      supabase
        .from('employee_settings')
        .select('off_periods')
        .eq('employee_s_number', parsed.data.to_employee_s_number)
        .maybeSingle(),
      supabase
        .from('employee_settings')
        .select('off_periods')
        .eq('employee_s_number', parsed.data.from_employee_s_number)
        .maybeSingle()
    ]);

    const toOffPeriods = Array.isArray(toSettingsRow?.off_periods)
      ? toSettingsRow.off_periods.filter((value) => Number.isInteger(value) && value >= 1 && value <= 8)
      : [4, 8];
    const fromOffPeriods = Array.isArray(fromSettingsRow?.off_periods)
      ? fromSettingsRow.off_periods.filter((value) => Number.isInteger(value) && value >= 1 && value <= 8)
      : [4, 8];

    const shiftIsMorning = parsed.data.shift_period === 0;
    const shiftIsOffPeriodForCurrentWorker = fromOffPeriods.includes(parsed.data.shift_period);
    const toEligibleForPeriod =
      shiftIsMorning ||
      shiftIsOffPeriodForCurrentWorker ||
      toClassPeriod === parsed.data.shift_period ||
      toOffPeriods.includes(parsed.data.shift_period);
    if (!toEligibleForPeriod) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Target employee is not eligible for this period (unless the shift is morning or off-period).',
        { to_employee_s_number: 'employee is not eligible for this period' }
      );
    }

    const assignment = await findScheduleAssignment({
      shiftDate: parsed.data.shift_date,
      shiftPeriod: parsed.data.shift_period,
      shiftSlotKey: parsed.data.shift_slot_key
    });

    if (!assignment) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'No such shift slot for that date/period', {
        shift_slot_key: 'No such shift slot for that date/period'
      });
    }

    const expectedWorker = await resolveExpectedWorkerForSlot({
      shiftDate: parsed.data.shift_date,
      shiftPeriod: parsed.data.shift_period,
      shiftSlotKey: parsed.data.shift_slot_key,
      baseWorkerSNumber: assignment.studentSNumber
    });

    if (expectedWorker !== parsed.data.from_employee_s_number) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'from_employee_s_number must match current expected worker for this slot',
        {
          from_employee_s_number: 'from employee is not the current expected worker'
        }
      );
    }

    const { data, error } = await supabase
      .from('shift_change_requests')
      .insert({
        shift_date: parsed.data.shift_date,
        shift_period: parsed.data.shift_period,
        shift_slot_key: parsed.data.shift_slot_key,
        from_employee_s_number: parsed.data.from_employee_s_number,
        to_employee_s_number: parsed.data.to_employee_s_number,
        reason: parsed.data.reason,
        status: 'pending',
        request_source: parsed.data.request_source ?? 'employee_form'
      })
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to create request');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'shift_exchange_submitted',
        tableName: 'shift_change_requests',
        recordId: data.id,
        oldValue: null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('shift_exchange_submitted', {
      correlationId,
      requestId: data.id
    });

    return successResult(data as ShiftChangeRequest, correlationId);
  } catch (error) {
    logError('submit_shift_exchange_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to submit shift exchange request.');
  }
}

export async function approveShiftExchange(requestId: string): Promise<Result<ShiftChangeRequest>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.schedule.edit');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to approve requests.');
    }

    const parsed = ShiftExchangeReviewSchema.safeParse({ request_id: requestId });
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid request id',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const { data: request, error: requestError } = await supabase
      .from('shift_change_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return errorResult(correlationId, 'NOT_FOUND', 'Shift exchange request not found.');
    }

    if (request.status !== 'pending') {
      return errorResult(correlationId, 'CONFLICT', 'Only pending requests can be approved.');
    }

    const { data: fromAttendance } = await supabase
      .from('shift_attendance')
      .select('*')
      .eq('shift_date', request.shift_date)
      .eq('shift_period', request.shift_period)
      .eq('shift_slot_key', request.shift_slot_key)
      .eq('employee_s_number', request.from_employee_s_number)
      .maybeSingle();

    if (
      fromAttendance &&
      ['present', 'absent', 'excused'].includes(fromAttendance.status as string)
    ) {
      return errorResult(
        correlationId,
        'CONFLICT',
        'Exchange cannot be approved because the original worker attendance has already been finalized.'
      );
    }

    const { data: toAttendance } = await supabase
      .from('shift_attendance')
      .select('*')
      .eq('shift_date', request.shift_date)
      .eq('shift_period', request.shift_period)
      .eq('shift_slot_key', request.shift_slot_key)
      .eq('employee_s_number', request.to_employee_s_number)
      .maybeSingle();

    if (toAttendance && ['present', 'absent', 'excused'].includes(toAttendance.status as string)) {
      return errorResult(
        correlationId,
        'CONFLICT',
        'Exchange cannot be approved because the target worker already has a finalized attendance record for this shift.'
      );
    }

    const { data: existingApproved } = await supabase
      .from('shift_change_requests')
      .select('id')
      .eq('status', 'approved')
      .eq('shift_date', request.shift_date)
      .eq('shift_period', request.shift_period)
      .eq('shift_slot_key', request.shift_slot_key)
      .eq('from_employee_s_number', request.from_employee_s_number)
      .neq('id', request.id)
      .limit(1);

    if ((existingApproved ?? []).length > 0) {
      return errorResult(
        correlationId,
        'CONFLICT',
        'An approved exchange already exists for this assignment.'
      );
    }

    await supabase
      .from('shift_attendance')
      .delete()
      .eq('shift_date', request.shift_date)
      .eq('shift_period', request.shift_period)
      .eq('shift_slot_key', request.shift_slot_key)
      .eq('employee_s_number', request.from_employee_s_number);

    await supabase.from('shift_attendance').upsert(
      {
        shift_date: request.shift_date,
        shift_period: request.shift_period,
        shift_slot_key: request.shift_slot_key,
        employee_s_number: request.to_employee_s_number,
        status: 'expected',
        source: 'shift_exchange',
        reason: null,
        marked_by: 'open_access'
      },
      {
        onConflict: 'shift_date,shift_period,shift_slot_key,employee_s_number'
      }
    );

    const { data: updated, error: updateError } = await supabase
      .from('shift_change_requests')
      .update({
        status: 'approved',
        reviewed_by: 'open_access',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', request.id)
      .select('*')
      .single();

    if (updateError || !updated) {
      return errorResult(correlationId, 'DB_ERROR', updateError?.message ?? 'Unable to approve request');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'shift_exchange_approved',
        tableName: 'shift_change_requests',
        recordId: request.id,
        oldValue: request,
        newValue: updated,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('shift_exchange_approved', {
      correlationId,
      requestId
    });

    return successResult(updated as ShiftChangeRequest, correlationId);
  } catch (error) {
    logError('approve_shift_exchange_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to approve shift exchange request.');
  }
}

export async function denyShiftExchange(requestId: string): Promise<Result<ShiftChangeRequest>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.schedule.edit');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to deny requests.');
    }

    const parsed = ShiftExchangeReviewSchema.safeParse({ request_id: requestId });
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid request id',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const { data: existing, error: existingError } = await supabase
      .from('shift_change_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (existingError || !existing) {
      return errorResult(correlationId, 'NOT_FOUND', 'Shift exchange request not found.');
    }

    const { data, error } = await supabase
      .from('shift_change_requests')
      .update({
        status: 'denied',
        reviewed_by: 'open_access',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .select('*')
      .single();

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to deny request');
    }

    await insertAuditEntry(
      supabase,
      {
        action: 'shift_exchange_denied',
        tableName: 'shift_change_requests',
        recordId: requestId,
        oldValue: existing,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('shift_exchange_denied', {
      correlationId,
      requestId
    });

    return successResult(data as ShiftChangeRequest, correlationId);
  } catch (error) {
    logError('deny_shift_exchange_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to deny shift exchange request.');
  }
}

const ShiftRequestQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'denied']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional()
});

export async function getShiftExchangeRequests(
  status?: ShiftRequestStatus,
  limit?: number,
  cursor?: string
): Promise<Result<{ requests: ShiftChangeRequest[]; nextCursor: string | null }>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.requests.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view requests.');
    }

    const parsed = ShiftRequestQuerySchema.safeParse({ status, limit, cursor });
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid shift request query',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const effectiveLimit = parsed.data.limit ?? 50;

    let query = supabase
      .from('shift_change_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(effectiveLimit + 1);

    if (parsed.data.status) query = query.eq('status', parsed.data.status);
    if (parsed.data.cursor) {
      const [timestamp, id] = parsed.data.cursor.split('|');
      if (timestamp && id) {
        query = query.or(`requested_at.lt.${timestamp},and(requested_at.eq.${timestamp},id.lt.${id})`);
      }
    }

    const { data, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    const rows = (data ?? []) as ShiftChangeRequest[];
    const hasMore = rows.length > effectiveLimit;
    const requests = hasMore ? rows.slice(0, effectiveLimit) : rows;
    const nextCursor = hasMore
      ? `${requests[requests.length - 1].requested_at}|${requests[requests.length - 1].id}`
      : null;

    logInfo('shift_exchange_requests_read', {
      correlationId,
      status: parsed.data.status ?? 'all',
      returned: requests.length,
      hasMore
    });

    return successResult({ requests, nextCursor }, correlationId);
  } catch (error) {
    logError('get_shift_exchange_requests_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load shift exchange requests.');
  }
}
