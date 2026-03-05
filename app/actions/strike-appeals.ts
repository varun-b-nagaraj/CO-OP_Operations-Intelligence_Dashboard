'use server';

import { ensureServerPermission } from '@/lib/permissions';
import { insertAuditEntry } from '@/lib/server/audit';
import { getStudentById } from '@/lib/server/employees';
import { logError, logInfo } from '@/lib/server/common';
import { createServerClient } from '@/lib/supabase';
import {
  errorResult,
  generateCorrelationId,
  Result,
  StrikeAppeal,
  StrikeAppealStatus,
  successResult
} from '@/lib/types';
import {
  StrikeAppealRequestSchema,
  StrikeAppealReviewSchema,
  zodFieldErrors
} from '@/lib/validation';

export async function submitStrikeAppeal(
  strikeId: string,
  employeeId: string,
  employeeSNumber: string,
  reason: string
): Promise<Result<StrikeAppeal>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.requests.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to submit appeals.');
    }

    const parsed = StrikeAppealRequestSchema.safeParse({
      strike_id: strikeId,
      employee_id: employeeId,
      employee_s_number: employeeSNumber,
      reason
    });

    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid strike appeal payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const student = await getStudentById(supabase, parsed.data.employee_id);
    if (!student) {
      return errorResult(correlationId, 'VALIDATION_ERROR', 'Employee does not exist', {
        employee_id: 'employee was not found in students table'
      });
    }

    const { data: strike, error: strikeError } = await supabase
      .from('hr_strikes')
      .select('*')
      .eq('id', parsed.data.strike_id)
      .eq('employee_id', parsed.data.employee_id)
      .maybeSingle();

    if (strikeError || !strike) {
      return errorResult(correlationId, 'NOT_FOUND', 'Strike record was not found for this employee.');
    }

    const { data: existingPending } = await supabase
      .from('hr_strike_appeals')
      .select('*')
      .eq('strike_id', parsed.data.strike_id)
      .eq('employee_id', parsed.data.employee_id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let data: StrikeAppeal | null = null;
    let error: { message?: string } | null = null;

    if (existingPending) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('hr_strike_appeals')
        .update({
          reason: parsed.data.reason,
          employee_s_number: parsed.data.employee_s_number,
          requested_at: new Date().toISOString(),
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null
        })
        .eq('id', existingPending.id)
        .select('*')
        .single();
      data = (updatedRows as StrikeAppeal | null) ?? null;
      error = updateError ? { message: updateError.message } : null;
    } else {
      const { data: insertedRow, error: insertError } = await supabase
        .from('hr_strike_appeals')
        .insert({
          strike_id: parsed.data.strike_id,
          employee_id: parsed.data.employee_id,
          employee_s_number: parsed.data.employee_s_number,
          reason: parsed.data.reason,
          status: 'pending'
        })
        .select('*')
        .single();
      data = (insertedRow as StrikeAppeal | null) ?? null;
      error = insertError ? { message: insertError.message } : null;
    }

    if (error || !data) {
      return errorResult(correlationId, 'DB_ERROR', error?.message ?? 'Unable to create strike appeal');
    }

    await insertAuditEntry(
      supabase,
      {
        action: existingPending ? 'strike_appeal_pending_updated' : 'strike_appeal_submitted',
        tableName: 'hr_strike_appeals',
        recordId: String(data.id ?? ''),
        oldValue: existingPending ?? null,
        newValue: data,
        userId: 'open_access'
      },
      correlationId
    );

    logInfo('strike_appeal_submitted', {
      correlationId,
      appealId: String(data.id ?? '')
    });

    return successResult(data as StrikeAppeal, correlationId);
  } catch (error) {
    logError('submit_strike_appeal_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to submit strike appeal.');
  }
}

async function reviewStrikeAppeal(
  appealId: string,
  status: Exclude<StrikeAppealStatus, 'pending'>,
  reviewNotes?: string
): Promise<Result<StrikeAppeal>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.strikes.manage');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to review appeals.');
    }

    const parsed = StrikeAppealReviewSchema.safeParse({ appeal_id: appealId, review_notes: reviewNotes });
    if (!parsed.success) {
      return errorResult(
        correlationId,
        'VALIDATION_ERROR',
        'Invalid strike appeal review payload',
        zodFieldErrors(parsed.error)
      );
    }

    const supabase = createServerClient();
    const { data: existing, error: existingError } = await supabase
      .from('hr_strike_appeals')
      .select('*')
      .eq('id', parsed.data.appeal_id)
      .single();

    if (existingError || !existing) {
      return errorResult(correlationId, 'NOT_FOUND', 'Strike appeal not found.');
    }

    if (existing.status !== 'pending') {
      return errorResult(correlationId, 'CONFLICT', 'Only pending appeals can be reviewed.');
    }

    const { data: updated, error: updateError } = await supabase
      .from('hr_strike_appeals')
      .update({
        status,
        reviewed_by: 'open_access',
        reviewed_at: new Date().toISOString(),
        review_notes: parsed.data.review_notes ?? null
      })
      .eq('id', parsed.data.appeal_id)
      .select('*')
      .single();

    if (updateError || !updated) {
      return errorResult(correlationId, 'DB_ERROR', updateError?.message ?? 'Unable to review strike appeal');
    }

    await insertAuditEntry(
      supabase,
      {
        action: status === 'approved' ? 'strike_appeal_approved' : 'strike_appeal_denied',
        tableName: 'hr_strike_appeals',
        recordId: String(updated.id ?? ''),
        oldValue: existing,
        newValue: updated,
        userId: 'open_access'
      },
      correlationId
    );

    if (status === 'approved') {
      await supabase
        .from('hr_strikes')
        .update({ active: false })
        .eq('id', String(updated.strike_id));
    }

    return successResult(updated as StrikeAppeal, correlationId);
  } catch (error) {
    logError('review_strike_appeal_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to review strike appeal.');
  }
}

export async function approveStrikeAppeal(
  appealId: string,
  reviewNotes?: string
): Promise<Result<StrikeAppeal>> {
  return reviewStrikeAppeal(appealId, 'approved', reviewNotes);
}

export async function denyStrikeAppeal(
  appealId: string,
  reviewNotes?: string
): Promise<Result<StrikeAppeal>> {
  return reviewStrikeAppeal(appealId, 'denied', reviewNotes);
}

export async function getStrikeAppeals(
  status?: StrikeAppealStatus
): Promise<Result<StrikeAppeal[]>> {
  const correlationId = generateCorrelationId();

  try {
    const allowed = await ensureServerPermission('hr.requests.view');
    if (!allowed) {
      return errorResult(correlationId, 'FORBIDDEN', 'You do not have permission to view appeals.');
    }

    const supabase = createServerClient();
    let query = supabase
      .from('hr_strike_appeals')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(500);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      return errorResult(correlationId, 'DB_ERROR', error.message);
    }

    return successResult((data ?? []) as StrikeAppeal[], correlationId);
  } catch (error) {
    logError('get_strike_appeals_failed', {
      correlationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return errorResult(correlationId, 'UNKNOWN_ERROR', 'Failed to load strike appeals.');
  }
}
